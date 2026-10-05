"""Campus Customs API: the FastAPI app the website talks to.

    /api/products...   catalogue with live per-size stock, plus similar / complete-the-look
                       picks (tools.py)
    /api/categories    garment types, collections and colours, with counts, for the menu and
                       the shop filters
    /api/size-advice   the size & fit helper: measurements in, a size out
    /media/products/   product photos, cleaned for a white page (below)
    /api/auth/...      sign-up, login, logout, who-am-I ("Accounts" section)
    /api/chat          one shopper message in; the agent's reply, chat cards and any page
                       showcase out (agent.py). Saved for logged-in shoppers
    /api/chat/stream   the same, streamed: each step of the agent team live (SSE)
    /api/chat/session  whether this browser's chat is open or was ended ("Chat safety" section)
    /api/chat/history  a logged-in shopper's saved chat and memory: reload or clear
    /api/chat/memory   forget what the assistant remembers about a shopper

Sections of this file:
    Accounts, login and sessions   password hashing (Argon2id), sessions, throttling
    Chat safety                    chat sessions, ending a chat, strikes, rate limits, the
                                   rudeness filter
    The API routes                 product photo cleanup, app startup, every route except
                                   /api/auth/..., and the chat turn itself

Every chat turn passes the safety checks first and is written to the append-only audit
trail, output/audit_trail.json (agent.py), whatever happens.

Run from this folder (backend/) with the project's virtualenv active:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import agent  # first: it loads .env, which settings below (COOKIE_SECURE) are read from

import asyncio
import hashlib
import hmac
import io
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded

import tools
from models import (
    CategoryInfo,
    ChatActivity,
    ChatHistory,
    ChatRequest,
    ChatResponse,
    ChatSession,
    ColourInfo,
    LabelCount,
    LoginRequest,
    MemoryNotes,
    Product,
    ProductRecommendations,
    ProductShowcase,
    PublicUser,
    RecommendedProduct,
    SafetyFlag,
    SessionInfo,
    ShopCategories,
    ShopReply,
    SignupRequest,
    SizeAdvice,
    SizeAdviceRequest,
    SuggestionCards,
)
from tools import DATA_DIR, connect, load_products

log = logging.getLogger("campus_customs")


# ==================================================================================================
# Accounts, login and sessions
# ==================================================================================================
# Passwords
#     New passwords are hashed with Argon2id (argon2-cffi defaults: 64 MiB of
#     memory, 3 passes, 4 lanes, random 16-byte salt; the salt and parameters are
#     stored inside the hash string). The seed accounts were hashed with
#     PBKDF2-SHA256 at 120,000 iterations. Those still verify, and each one is
#     re-hashed with Argon2id the first time its owner logs in.
#
# Sessions
#     Logging in creates a random 256-bit token, sent to the browser as an
#     HttpOnly, SameSite=Lax cookie. The database keeps only the token's SHA-256,
#     so a copy of the database can't be replayed as live sessions. Logging out
#     deletes the row, which ends the session server-side.
#
# Nothing in this section returns password_hash, and no other code reads that column.
# Request / response types and the password rules live in models.py.

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE = "cc_session"
SESSION_DAYS = 7
# Browsers only send Secure cookies over HTTPS, and local dev is plain http.
# Set COOKIE_SECURE=true wherever the site is served over HTTPS.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"

LEGACY_PBKDF2_ITERATIONS = 120_000

# Failed logins allowed inside the window before further attempts are refused.
MAX_FAILURES_PER_EMAIL = 5
MAX_FAILURES_PER_IP = 20
FAILURE_WINDOW_SECONDS = 15 * 60

hasher = PasswordHasher()  # Argon2id with the RFC 9106 low-memory parameters
# Checked when an email has no account, so a wrong email costs the same time
# as a wrong password and response times don't reveal who has an account.
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))


def public_user(row: sqlite3.Row) -> PublicUser:
    # Older rows may predate the first_name / last_name columns.
    first, _, last = row["name"].partition(" ")
    return PublicUser(
        id=row["id"],
        first_name=row["first_name"] or first,
        last_name=row["last_name"] or last,
        name=row["name"],
        email=row["email"],
    )


# ---- Passwords ----


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("pbkdf2_sha256$"):
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        _, salt, digest = parts
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), LEGACY_PBKDF2_ITERATIONS)
        return hmac.compare_digest(candidate.hex(), digest)
    try:
        return hasher.verify(stored, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    return stored.startswith("pbkdf2_sha256$") or hasher.check_needs_rehash(stored)


# ---- Brute-force throttling (in memory; resets when the server restarts) ----

_failures: dict[str, deque[float]] = defaultdict(deque)
_failures_lock = threading.Lock()


def _recent_failures(key: str, now: float) -> int:
    attempts = _failures[key]
    while attempts and now - attempts[0] > FAILURE_WINDOW_SECONDS:
        attempts.popleft()
    return len(attempts)


def login_blocked(email: str, ip: str) -> bool:
    now = time.monotonic()
    with _failures_lock:
        return (
            _recent_failures(f"email:{email}", now) >= MAX_FAILURES_PER_EMAIL
            or _recent_failures(f"ip:{ip}", now) >= MAX_FAILURES_PER_IP
        )


def record_failure(email: str, ip: str) -> None:
    now = time.monotonic()
    with _failures_lock:
        _failures[f"email:{email}"].append(now)
        _failures[f"ip:{ip}"].append(now)


def clear_failures(email: str) -> None:
    with _failures_lock:
        _failures.pop(f"email:{email}", None)


# ---- Sessions ----


def ensure_auth_schema() -> None:
    with closing(connect(readonly=False)) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            )
            """
        )


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(conn: sqlite3.Connection, response: Response, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
        (token_hash(token), user_id, f"+{SESSION_DAYS} days"),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


SessionCookie = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


def current_user(session: SessionCookie = None) -> PublicUser | None:
    """The logged-in user for this request, or None. Usable as a dependency."""
    if not session:
        return None
    with closing(connect()) as conn:
        row = conn.execute(
            """
            SELECT u.id, u.name, u.first_name, u.last_name, u.email
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > datetime('now')
            """,
            (token_hash(session),),
        ).fetchone()
    return public_user(row) if row else None


# ---- Endpoints ----


@router.post("/signup", status_code=201)
def signup(body: SignupRequest, response: Response) -> PublicUser:
    name = f"{body.first_name} {body.last_name}"
    password_hash = hasher.hash(body.password)
    try:
        with closing(connect(readonly=False)) as conn, conn:
            cursor = conn.execute(
                "INSERT INTO users (name, first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?, ?)",
                (name, body.first_name, body.last_name, body.email, password_hash),
            )
            user_id = cursor.lastrowid
            assert user_id is not None
            start_session(conn, response, user_id)
    except sqlite3.IntegrityError:
        # Emails are stored lower-case, so the UNIQUE constraint catches any casing.
        raise HTTPException(status_code=409, detail="An account with that email already exists. Try logging in instead.") from None
    return PublicUser(id=user_id, first_name=body.first_name, last_name=body.last_name, name=name, email=body.email)


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response) -> PublicUser:
    ip = client_ip(request)
    if login_blocked(body.email, ip):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Please wait a few minutes and try again.")

    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, name, first_name, last_name, email, password_hash FROM users WHERE email = ?",
            (body.email,),
        ).fetchone()
    # Always run one hash check, so unknown emails and wrong passwords look alike.
    password_ok = verify_password(body.password, row["password_hash"] if row else DUMMY_HASH)
    if row is None or not password_ok:
        record_failure(body.email, ip)
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")

    clear_failures(body.email)
    with closing(connect(readonly=False)) as conn, conn:
        if needs_rehash(row["password_hash"]):
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hasher.hash(body.password), row["id"]))
        start_session(conn, response, row["id"])
    return public_user(row)


@router.post("/logout", status_code=204)
def logout(response: Response, session: SessionCookie = None) -> None:
    if session:
        with closing(connect(readonly=False)) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(session),))
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=COOKIE_SECURE)


@router.get("/me")
def me(user: Annotated[PublicUser | None, Depends(current_user)]) -> SessionInfo:
    # 200 with user=null rather than a 401, so a logged-out visit isn't an error.
    return SessionInfo(user=user)


# ==================================================================================================
# Chat safety rules the code enforces
# ==================================================================================================
# The rules Dan follows himself are in prompts/prompt.md ("Safety rules"); this section makes
# the important ones stick.
#
#     Chat sessions    every browser gets a cc_chat cookie: a random id naming its chat session. A
#                      chat is tracked under that id and, when logged in, under the account too.
#     Ending a chat    an abusive message ends the chat at once; MAX_STRIKES off-topic or
#                      manipulation messages in a row end it too (with a warning one message
#                      before). An ended chat refuses new messages for LOCK_MINUTES, without
#                      calling any model (chat_safety table).
#     Rate limits      at most RATE_LIMIT messages per RATE_WINDOW_SECONDS per chat session and per
#                      account, and IP_RATE_LIMIT per network address (catches scripts that
#                      drop the cookie), so no one can run up the model bill.
#     Rudeness filter  looks_abusive() catches unmistakable abuse aimed at Dan before any model
#                      call, at no cost. Subtler cases are flagged by the agent itself
#                      (ShopReply.safety = "abusive").
#
# answer() below runs these for every chat message; see output/harness.md, "Safety rules".

CHAT_COOKIE = "cc_chat"
CHAT_COOKIE_MAX_AGE = 30 * 24 * 3600

LOCK_MINUTES = 15  # how long an ended chat stays closed
MAX_STRIKES = 3  # off-topic / manipulation messages in a row before the chat is closed
RATE_LIMIT = 20  # messages per chat session or account...
IP_RATE_LIMIT = 60  # ...and per network address...
RATE_WINDOW_SECONDS = 300  # ...in any 5 minutes

ABUSIVE_GOODBYE = (
    "I'm going to end our chat here. If you'd like help finding Yale gear later, "
    "you can start a new chat in {minutes} minutes."
)
STRIKES_GOODBYE = (
    "I can only help with Campus Customs shopping, so I'm closing this chat for now. "
    "You can start a new one in {minutes} minutes."
)
STRIKE_WARNING = (
    "Just a heads-up: I can only help with Campus Customs shopping. "
    "If the next message isn't about the shop, I'll close this chat."
)

# Unmistakable abuse aimed at Dan: swearing at him, "you're a/an <insult>" ending the clause, and
# "(you) stupid dog/bot" said to him. Kept narrow on purpose, so ordinary shopping talk never trips it
# ("shut up and take my money", "my dumb dog needs a sweater", "you're so stupid fast", "is ur trash
# talk tee in stock?" all pass); the agent judges everything else. Every repeat is bounded and no two
# alternatives overlap, so a long message can't make a pattern backtrack (the review measured a
# 1,000-character message freezing the server for days with an earlier version).
_INSULT = (
    r"(?:stupid|dumb|idiot(?:ic)?|moron(?:ic)?|useless|worthless|pathetic|trash|garbage|"
    r"loser|bitch|asshole|bastard|dickhead|jerk|clown|piece\s+of\s+(?:shit|crap|garbage|trash))"
)
_YOU_ARE = r"(?:you\s*['’]?\s*re|you\s+are|u\s+r|u\s+are)"
_FILLER = r"(?:(?:such|so|a|an|the|total|complete|f\w*ing)\s+){0,6}"
_TARGET = r"(?:dog|mutt|mongrel|bot|robot|ai|machine)"
ABUSE_PATTERNS = [
    # "f*** you", "fuck off", "fk you": needs a k or a masking symbol, so the name "Fu" doesn't count.
    re.compile(r"\bf(?:u{0,3}c{0,3}k{1,3}|u{0,3}[*#@$!%]{1,6}k?)\s{0,3}(?:you|u|off|ur\s*self|your\s*self)\b", re.IGNORECASE),
    re.compile(r"\b(?:screw\s+(?:you|u|off)|piss\s+off|eat\s+shit|stfu|gtfo)\b", re.IGNORECASE),
    re.compile(r"\bshut\s+the\s+f\w*\s+up\b", re.IGNORECASE),
    re.compile(r"\b(?:kys|kill\s+your\s*self)\b", re.IGNORECASE),
    re.compile(rf"\b{_YOU_ARE}\s+{_FILLER}{_INSULT}(?:\s+{_TARGET})?\s*(?:[.!?,;]|$)", re.IGNORECASE),
    re.compile(
        rf"(?:^\s*|\b(?:you|u|ya)\s+)(?:stupid|dumb|useless|worthless|idiot|mangy|filthy)\s+{_TARGET}\b",
        re.IGNORECASE,
    ),
]


def looks_abusive(message: str) -> bool:
    """True for unmistakable abuse, caught before any model call."""
    return any(pattern.search(message) for pattern in ABUSE_PATTERNS)


# ---- Who is chatting ----


def chat_token(request: Request) -> tuple[str, bool]:
    """This browser's chat-session id from its cookie, or a new one. Returns (token, is_new)."""
    token = request.cookies.get(CHAT_COOKIE)
    if token and 16 <= len(token) <= 64:
        return token, False
    return secrets.token_urlsafe(24), True


def set_chat_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        CHAT_COOKIE, token, max_age=CHAT_COOKIE_MAX_AGE, httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/"
    )


def subjects(token: str | None, user: PublicUser | None) -> list[str]:
    """What a chat is tracked under: the browser's chat session (only its hash is stored), plus the account."""
    keys = ["chat:" + hashlib.sha256(token.encode()).hexdigest()[:32]] if token else []
    if user is not None:
        keys.append(f"user:{user.id}")
    return keys


def who(subject_keys: list[str]) -> str:
    """How the audit trail names the shopper: their user id, or a short tag for a guest's chat."""
    for key in subject_keys:
        if key.startswith("user:"):
            return "user " + key.removeprefix("user:")
    return "guest " + subject_keys[0].removeprefix("chat:")[:6] if subject_keys else "guest"


# ---- Ended chats and strikes (chat_safety table) ----


def ensure_safety_schema() -> None:
    with closing(connect(readonly=False)) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_safety (
                subject TEXT PRIMARY KEY,
                strikes INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT,
                lock_reason TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )


def _now() -> datetime:
    return datetime.now(UTC)


def _chat_safety_rows(conn, subject_keys: list[str]) -> list:
    if not subject_keys:
        return []
    marks = ",".join("?" * len(subject_keys))
    return conn.execute(
        f"SELECT strikes, locked_until, lock_reason FROM chat_safety WHERE subject IN ({marks})", subject_keys
    ).fetchall()


def _chat_state(rows: list) -> ChatSession:
    """Ended if any of the chat's subjects is locked; strikes are the highest count."""
    now = _now()
    state = ChatSession()
    for row in rows:
        state.strikes = max(state.strikes, row["strikes"])
        until = datetime.fromisoformat(row["locked_until"]) if row["locked_until"] else None
        if until and until > now and (state.until is None or until.isoformat() > state.until):
            state.ended, state.reason, state.until = True, row["lock_reason"], until.isoformat()
    return state


def session_state(subject_keys: list[str]) -> ChatSession:
    """Whether this chat is open."""
    if not subject_keys:
        return ChatSession()
    with closing(connect()) as conn:
        return _chat_state(_chat_safety_rows(conn, subject_keys))


def _save_chat_state(conn, subject_keys: list[str], strikes: int, locked_until: str | None, reason: str | None) -> None:
    conn.executemany(
        """
        INSERT INTO chat_safety (subject, strikes, locked_until, lock_reason) VALUES (?, ?, ?, ?)
        ON CONFLICT (subject) DO UPDATE SET
            strikes = excluded.strikes, locked_until = excluded.locked_until,
            lock_reason = excluded.lock_reason, updated_at = datetime('now')
        """,
        [(key, strikes, locked_until, reason) for key in subject_keys],
    )


def _lock_chat(conn, subject_keys: list[str], reason: str) -> ChatSession:
    until = (_now() + timedelta(minutes=LOCK_MINUTES)).isoformat()
    _save_chat_state(conn, subject_keys, 0, until, reason)
    return ChatSession(ended=True, reason=reason, until=until, strikes=0)


def _safety_transaction():
    """A write transaction that holds the database's write lock from the first read, so two replies
    finishing at once can't both read the same strike count, or undo each other's lock."""
    conn = connect(readonly=False)
    conn.isolation_level = None  # manage the transaction explicitly
    conn.execute("BEGIN IMMEDIATE")
    return conn


def end_chat(subject_keys: list[str], reason: str) -> ChatSession:
    """Close the chat for LOCK_MINUTES. Strikes start again from zero afterwards."""
    with closing(_safety_transaction()) as conn:
        state = _lock_chat(conn, subject_keys, reason)
        conn.execute("COMMIT")
    return state


def record_safety_flag(subject_keys: list[str], flag: SafetyFlag) -> ChatSession:
    """Apply the agent's safety flag for one reply: count strikes, end the chat when the rules say so.

    A reply that finishes after the chat was ended (by another message in flight) leaves it ended.
    """
    with closing(_safety_transaction()) as conn:
        try:
            state = _chat_state(_chat_safety_rows(conn, subject_keys))
            if state.ended:
                result = state
            elif flag == "abusive":
                result = _lock_chat(conn, subject_keys, "abusive")
            else:
                strikes = state.strikes + 1 if flag in ("off_topic", "manipulation") else 0
                if strikes >= MAX_STRIKES:
                    result = _lock_chat(conn, subject_keys, "off_topic_strikes")
                else:
                    if strikes != state.strikes:
                        _save_chat_state(conn, subject_keys, strikes, None, None)
                    result = ChatSession(strikes=strikes)
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    return result


def minutes_left(state: ChatSession) -> int:
    if not state.until:
        return LOCK_MINUTES
    seconds = (datetime.fromisoformat(state.until) - _now()).total_seconds()
    return max(1, math.ceil(seconds / 60))


def goodbye(state: ChatSession) -> str:
    template = ABUSIVE_GOODBYE if state.reason == "abusive" else STRIKES_GOODBYE
    return template.format(minutes=minutes_left(state))


def ended_detail(state: ChatSession) -> str:
    return f"This chat has ended. You can start a new one in {minutes_left(state)} minutes."


# ---- Rate limits (in memory, like the login throttle) ----

_recent_messages: dict[str, deque[float]] = {}
_recent_messages_lock = threading.Lock()
SWEEP_AT = 10_000  # keys kept before the stale ones are swept out


def rate_limit_wait(subject_keys: list[str], ip: str) -> int:
    """Seconds to wait if this message is over a limit (it isn't counted then); 0 if it may go ahead."""
    now = time.monotonic()
    limits = [(key, RATE_LIMIT) for key in subject_keys] + [(f"ip:{ip}", IP_RATE_LIMIT)]
    with _recent_messages_lock:
        if len(_recent_messages) > SWEEP_AT:  # a script without cookies makes a new key every time
            for key in [k for k, times in _recent_messages.items() if not times or now - times[-1] > RATE_WINDOW_SECONDS]:
                del _recent_messages[key]
        wait = 0.0
        for key, limit in limits:
            recent = _recent_messages.get(key)
            while recent and now - recent[0] > RATE_WINDOW_SECONDS:
                recent.popleft()
            if recent is not None and not recent:
                del _recent_messages[key]
            elif recent is not None and len(recent) >= limit:
                wait = max(wait, RATE_WINDOW_SECONDS - (now - recent[0]))
        if wait:
            return max(1, math.ceil(wait))
        for key, _ in limits:
            _recent_messages.setdefault(key, deque()).append(now)
    return 0


def rate_detail(seconds: int) -> str:
    return f"That's a lot of messages! Give me {seconds} seconds to catch my breath, then try again."


# ==================================================================================================
# The API routes
# ==================================================================================================
# ---- Product photos: black backgrounds turned white ----

# Many product photos are transparent PNGs that were flattened onto black.
# Pixels darker than this, connected to the image border, are treated as
# background and turned white. Higher values start eating navy garment edges.
# After changing any of this, bump tools.IMAGE_VERSION so browsers refetch.
BACKGROUND_THRESHOLD = 10
EDGE_TRIM_PX = 2
# Mean garment brightness above which enclosed black gaps count as background.
LIGHT_GARMENT_LUMINANCE = 100


@lru_cache(maxsize=1)
def product_image_paths() -> dict[str, Path]:
    """Filename -> file on disk, for every image the catalogue references.

    Only these files are served, so a request can't reach anything else in data/.
    """
    with closing(connect()) as conn:
        paths = [r[0] for r in conn.execute("SELECT image_file_path FROM catalogue")]
    return {Path(p).name: DATA_DIR / p for p in paths}


@lru_cache(maxsize=None)
def web_ready_jpeg(filename: str) -> bytes:
    """The product photo with any black flattened background replaced by white."""
    image = Image.open(product_image_paths()[filename]).convert("RGB")
    w, h = image.size
    luminance = image.convert("L")

    # Mark near-black pixels, frame them in a 1px dark border, and flood-fill
    # from the corner: one fill reaches every dark region touching an edge.
    # Afterwards 128 = dark and touching an edge, 255 = dark but enclosed.
    dark = luminance.point(lambda v: 255 if v < BACKGROUND_THRESHOLD else 0)
    framed = Image.new("L", (w + 2, h + 2), 255)
    framed.paste(dark, (1, 1))
    ImageDraw.floodfill(framed, (0, 0), 128)
    framed = framed.crop((1, 1, w + 1, h + 1))
    background = framed.point(lambda v: 255 if v == 128 else 0)

    # Black gaps enclosed by the garment (between an arm and the body) can't be
    # reached from the edge. On a light garment shot on black they can only be
    # background, so fill them too. On a dark garment they may be the inside of
    # a hood, so leave them. Opening (erode, then dilate) skips thin specks.
    black_backdrop = ImageStat.Stat(background).mean[0] / 255 > 0.1
    garment_luminance = ImageStat.Stat(luminance, ImageChops.invert(background)).mean[0]
    if black_backdrop and garment_luminance > LIGHT_GARMENT_LUMINANCE:
        enclosed = framed.point(lambda v: 255 if v == 255 else 0)
        gaps = enclosed.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))
        background = ImageChops.lighter(background, ImageChops.darker(gaps, enclosed))

    # The flattening left a speckled dark halo a pixel or two wide around each
    # garment. Trim a uniform 2px into the edge, then feather it so the outline
    # doesn't look cut out.
    background = background.filter(ImageFilter.MaxFilter(2 * EDGE_TRIM_PX + 1))
    background = background.filter(ImageFilter.GaussianBlur(0.8))

    cleaned = Image.composite(Image.new("RGB", (w, h), "white"), image, background)
    buffer = io.BytesIO()
    cleaned.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def warm_image_cache() -> None:
    for filename in product_image_paths():
        web_ready_jpeg(filename)


@lru_cache(maxsize=1)
def start_image_warmup() -> None:
    # Cleaning all ~100 photos takes several seconds; do it once per process,
    # in the background, so the first visit to Products doesn't wait on it.
    threading.Thread(target=warm_image_cache, daemon=True).start()


# ---- The app ----


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not tools.db_path().exists():
        raise RuntimeError(
            f"No shop database at {tools.db_path()}. Place the data pack in hw4/data/ (see README.md)."
        )
    ensure_auth_schema()
    agent.ensure_chat_schema()
    ensure_safety_schema()
    tools.ensure_size_schema()
    start_image_warmup()
    yield


app = FastAPI(title="Campus Customs API", lifespan=lifespan)
app.include_router(router)


@app.get("/api/products")
def list_products() -> list[Product]:
    return load_products()


@app.get("/api/categories")
def list_categories() -> ShopCategories:
    """Every garment type and collection with its product count and a cover photo, plus colour counts."""
    products = load_products()

    def info(entry: dict, members: list[Product], labels: list[str] | None = None) -> CategoryInfo:
        # Cover: the best-stocked product, so the photo is something you can buy.
        cover = max(members, key=lambda p: p.total_stock, default=None)
        counts: dict[str, int] = {}
        for label in labels or []:
            counts[label] = counts.get(label, 0) + 1
        return CategoryInfo(
            **entry,
            count=len(members),
            cover_image=cover.image_url if cover else None,
            affiliations=[LabelCount(label=k, count=v) for k, v in sorted(counts.items())],
        )

    types = [info(t, [p for p in products if p.category == t["slug"]]) for t in tools.TYPES]
    collections = []
    for c in tools.COLLECTIONS:
        members = [p for p in products if c["slug"] in p.collections]
        # Each product's affiliations within this collection (a product sits in one collection).
        labels = [label for p in members for label in p.affiliations]
        collections.append(info(c, members, labels))
    colours = [
        ColourInfo(**c, count=sum(p.color_family == c["slug"] for p in products)) for c in tools.COLOURS
    ]
    return ShopCategories(types=types, collections=collections, colours=colours)


@app.post("/api/size-advice")
def size_advice(body: SizeAdviceRequest) -> SizeAdvice:
    """The size & fit helper: height, weight (and chest, if known) and fit preference in; a size out.

    With a product_id, the advice includes that garment's fit and live stock in the size.
    """
    if body.product_id and not load_products([body.product_id]):
        raise HTTPException(status_code=404, detail="Product not found")
    return tools.recommend_size(body)


@app.get("/api/products/{product_id}")
def get_product(product_id: str) -> Product:
    products = load_products([product_id])
    if not products:
        raise HTTPException(status_code=404, detail="Product not found")
    return products[0]


@app.get("/api/products/{product_id}/recommendations")
def get_recommendations(
    product_id: str,
    size: Annotated[str | None, Query(pattern="^(XS|S|M|L|XL|XXL)$")] = None,
) -> ProductRecommendations:
    """Similar styles and "complete the look" pairings for a product page, in stock (in `size` if given)."""
    products = load_products([product_id])
    if not products:
        raise HTTPException(status_code=404, detail="Product not found")
    product = products[0]
    similar = tools.similar_products(product, size, limit=4)
    look = tools.complete_the_look(product, size, limit=3)
    cards = {p.product_id: p for p in load_products([rec.product_id for rec in similar + look])}

    def with_cards(recs):
        return [
            RecommendedProduct(product=cards[rec.product_id], role=rec.role, reason=rec.reason)
            for rec in recs
            if rec.product_id in cards
        ]

    return ProductRecommendations(
        product_id=product.product_id,
        size=size,
        size_sold_out=any(row.size == size and row.quantity == 0 for row in product.inventory),
        similar=with_cards(similar),
        complete_the_look=with_cards(look),
    )


@app.get("/media/products/{filename}")
def product_image(filename: str) -> Response:
    if filename not in product_image_paths():
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(
        content=web_ready_jpeg(filename),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ---- One chat turn ----

# The turn's stop reason in the audit trail, from the agent's safety flag.
STOP_REASONS = {
    "ok": "answered",
    "off_topic": "declined_off_topic",
    "manipulation": "declined_manipulation",
    "abusive": "chat_ended_abusive",
}


async def answer(
    body: ChatRequest,
    user: PublicUser | None,
    token: str,
    ip: str,
    events: agent.EventSink | None = None,
) -> ChatResponse:
    """Run one chat turn end to end. Raises HTTPException on failure. Shared by both chat routes.

    Safety checks first ("Chat safety" above), then the agent, then its safety flag is acted on.
    The whole turn is recorded in the audit trail (agent.py) however it ends.
    """
    started = time.perf_counter()
    keys = subjects(token, user)
    turn = agent.Turn()
    turn.add(
        "turn_start",
        who=who(keys),
        page=body.page.path if body.page else None,
        product=body.page.product_id if body.page else None,
        message=agent.preview(body.message),
    )
    end: dict = {"stop_reason": "error", "status": 500}  # filled in as the turn goes
    try:
        response = await _turn(body, user, keys, ip, turn, events, end, started)
        end.pop("status", None)
        return response
    except asyncio.CancelledError:  # the shopper closed the page mid-answer
        end.update(stop_reason="cancelled")
        end.pop("status", None)
        raise
    except HTTPException:
        raise  # _turn already recorded why
    except Exception:
        end.update(stop_reason="error", status=500)
        raise
    finally:
        turn.add("turn_end", **end, seconds=round(time.perf_counter() - started, 2))
        await run_in_threadpool(turn.flush)


async def _turn(
    body: ChatRequest,
    user: PublicUser | None,
    keys: list[str],
    ip: str,
    turn: agent.Turn,
    events: agent.EventSink | None,
    end: dict,
    started: float,
) -> ChatResponse:
    # 1. Rules that apply before any model call, so they cost nothing.
    session = await run_in_threadpool(session_state, keys)
    if session.ended:
        turn.add("guard", check="chat_ended", result="refused", reason=session.reason)
        end.update(stop_reason="refused_chat_ended", status=423)
        raise HTTPException(status_code=423, detail=ended_detail(session))
    wait = rate_limit_wait(keys, ip)
    if wait:
        turn.add("guard", check="rate_limit", result=f"refused; retry in {wait}s")
        end.update(stop_reason="refused_rate_limited", status=429)
        raise HTTPException(status_code=429, detail=rate_detail(wait), headers={"Retry-After": str(wait)})
    if await run_in_threadpool(looks_abusive, body.message):
        session = await run_in_threadpool(end_chat, keys, "abusive")
        turn.add("guard", check="rudeness_filter", result="ended the chat before any model call")
        end.update(stop_reason="chat_ended_abusive", safety="abusive", detected_by="rudeness_filter")
        # No activity panel: no agent ran.
        return ChatResponse(reply=goodbye(session), products=[], session=session, keep_in_history=False)

    # 2. The agent. Who is chatting (name and email, never the id or hash), what we remember
    # about them, and what page they're on, resolved against the database.
    deps = await run_in_threadpool(agent.make_deps, user, body.page)
    deps.events = events
    deps.audit = turn
    # A logged-in shopper's conversation comes from the database, so it
    # includes earlier visits and can't be rewritten by the browser. Guests
    # have nothing saved, so their widget sends the recent turns.
    if user:
        history = await run_in_threadpool(agent.load_turns, user.id)
    else:
        history = body.history
    try:
        reply = await agent.ask(body.message, history, deps)
    except agent.ChatUnavailable:
        end.update(stop_reason="unavailable", status=503)
        raise HTTPException(status_code=503, detail="The shopping assistant isn't available right now.") from None
    except UsageLimitExceeded:
        log.warning("Chat run hit a usage limit")
        end.update(stop_reason="usage_limit", status=502)
        raise HTTPException(
            status_code=502, detail="Sorry, that one tripped me up. Could you ask it a different way?"
        ) from None
    except UnexpectedModelBehavior as error:
        # Includes a reply that kept quoting prices or stock no tool returned:
        # better no answer than an invented number.
        log.warning("Chat run failed validation (e.g. ungrounded price or stock)", exc_info=True)
        end.update(stop_reason=agent.stop_reason(error), status=502)
        raise HTTPException(
            status_code=502, detail="Sorry, I couldn't double-check that against our stock just now. Please try again."
        ) from None
    except Exception as error:
        log.exception("Chat run failed")
        stop = agent.stop_reason(error)
        end.update(stop_reason="model_error" if stop == "error" else stop, status=502)
        raise HTTPException(
            status_code=502, detail="Sorry, I couldn't answer just now. Please try again in a moment."
        ) from None

    # 3. Act on the agent's safety flag. Abuse ends the chat with a fixed goodbye (no
    # engaging, no cards); off-topic and manipulation messages are strikes.
    session = await run_in_threadpool(record_safety_flag, keys, reply.safety)
    stop = STOP_REASONS[reply.safety]
    blocked = reply is agent.CARE_REPLY or reply is agent.BLOCKED_REPLY
    if blocked:
        end["blocked_by"] = "provider_content_filter"
        stop = "care_reply" if reply is agent.CARE_REPLY else stop
    if reply.safety == "abusive":
        reply = ShopReply(safety="abusive", message=goodbye(session))
    elif session.ended:  # the third strike, or another message ended the chat while this one ran
        reply = ShopReply(safety=reply.safety, message=goodbye(session))
        stop = "chat_ended_strikes" if session.reason == "off_topic_strikes" else "refused_chat_ended"
    elif session.strikes == MAX_STRIKES - 1:
        reply = reply.model_copy(update={"message": f"{reply.message}\n\n{STRIKE_WARNING}"})
    # Recorded once the reply is ready to send (below), so a later failure isn't logged as answered.
    outcome = {"stop_reason": stop, "safety": reply.safety, "detected_by": "agent" if reply.safety == "abusive" else None}

    # Cards come from the database, not from the model: unknown ids are
    # dropped, and price and stock are re-read at this moment.
    products = await run_in_threadpool(load_products, reply.product_ids)
    showcase = None
    if reply.showcase:
        # An empty id list means "everything the Scout found", in its order.
        showcase_ids = reply.showcase.product_ids or deps.scout_ids
        showcase_products = await run_in_threadpool(load_products, showcase_ids)
        if showcase_products:
            showcase = ProductShowcase(title=reply.showcase.title, products=showcase_products)
    suggestions = []
    for group in reply.suggestions:
        cards = {p.product_id: p for p in await run_in_threadpool(load_products, group.product_ids)}
        items = [
            RecommendedProduct(product=cards[pid], role=deps.recommended[pid].role, reason=deps.recommended[pid].reason)
            for pid in group.product_ids
            if pid in cards and pid in deps.recommended
        ]
        if items:
            suggestions.append(SuggestionCards(kind=group.kind, title=group.title, items=items))
    # Saved only once the agent has answered, as a question-and-reply pair. An abusive message
    # isn't kept, and neither is one the provider's filter blocked: replayed as history, it
    # would get every later message blocked too. Then the memory clerk folds an on-topic
    # exchange into the customer's notes in the background.
    keep = reply.safety != "abusive" and not blocked and not session.ended
    if user and keep:
        await run_in_threadpool(agent.save_exchange, user.id, body.message, reply.message, products)
        if reply.safety == "ok":
            remember_later(user.id, turn)
    end.update(
        outcome,
        cards=len(products) or None,
        showcase=len(showcase.products) if showcase else None,
        suggestions=sum(len(group.items) for group in suggestions) or None,
        strikes=session.strikes or None,
    )

    agents_used = list(dict.fromkeys(entry.agent for entry in deps.usage_log))
    activity = ChatActivity(seconds=round(time.perf_counter() - started, 2), agents=agents_used, usage=deps.usage_log)
    return ChatResponse(
        reply=reply.message,
        products=products,
        showcase=showcase,
        suggestions=suggestions,
        activity=activity,
        session=session,
        keep_in_history=keep,
    )


_background: set[asyncio.Task] = set()


def remember_later(user_id: int, turn: agent.Turn | None = None) -> None:
    """Update the customer's memory notes after the reply has gone out; never delays the shopper."""

    async def run() -> None:
        try:
            await agent.update_memory(user_id, turn=turn)
        except Exception:
            log.warning("Memory update failed for user %s", user_id, exc_info=True)

    task = asyncio.create_task(run())
    _background.add(task)  # keep a reference until it finishes
    task.add_done_callback(_background.discard)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@app.post("/api/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    response: Response,
    user: Annotated[PublicUser | None, Depends(current_user)],
) -> ChatResponse:
    """One shopper message in; the agent's reply and any product cards out."""
    token, new = chat_token(request)
    if new:
        set_chat_cookie(response, token)
    return await answer(body, user, token, client_ip(request))


@app.post("/api/chat/stream")
async def chat_stream(
    body: ChatRequest,
    request: Request,
    user: Annotated[PublicUser | None, Depends(current_user)],
) -> StreamingResponse:
    """Same as /api/chat, streamed as server-sent events: every team step as it happens, then the reply.

    Events: team, status, delegate, tool, report (the live view), then exactly one
    `final` ({response: ChatResponse}) or `error` ({status, detail}).
    """
    sink = agent.EventSink()
    token, new = chat_token(request)
    ip = client_ip(request)

    async def run() -> None:
        try:
            response = await answer(body, user, token, ip, sink)
            sink.emit("final", response=response.model_dump(mode="json"))
        except HTTPException as error:
            sink.emit("error", status=error.status_code, detail=error.detail)
        except Exception:
            log.exception("Streamed chat failed")
            sink.emit("error", status=500, detail="Sorry, I couldn't answer just now. Please try again in a moment.")

    async def events():
        task = asyncio.create_task(run())
        try:
            while True:
                event = await sink.queue.get()
                yield f"data: {json.dumps(event)}\n\n"
                if event["type"] in ("final", "error"):
                    break
        finally:
            if not task.done():
                task.cancel()  # the shopper closed the page mid-answer

    stream = StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
    if new:
        set_chat_cookie(stream, token)
    return stream


@app.get("/api/chat/session")
def chat_session(request: Request, user: Annotated[PublicUser | None, Depends(current_user)]) -> ChatSession:
    """Whether this browser's chat is open. The widget asks on load, so an ended chat stays ended after a reload."""
    return session_state(subjects(request.cookies.get(CHAT_COOKIE), user))


@app.get("/api/chat/history")
def get_chat_history(user: Annotated[PublicUser | None, Depends(current_user)]) -> ChatHistory:
    """The logged-in shopper's saved conversation (oldest first) and what we remember about them."""
    if user is None:
        return ChatHistory(saved=False, messages=[])
    memory, _ = agent.load_memory(user.id)
    return ChatHistory(saved=True, messages=agent.load_history(user.id), memory=memory)


@app.get("/api/chat/memory")
def get_memory(user: Annotated[PublicUser | None, Depends(current_user)]) -> MemoryNotes | None:
    """Just the memory notes, so the chat can refresh them after the background update."""
    if user is None:
        return None
    memory, _ = agent.load_memory(user.id)
    return memory


@app.delete("/api/chat/memory", status_code=204)
def forget_me(user: Annotated[PublicUser | None, Depends(current_user)]) -> None:
    """Let a shopper wipe what the assistant remembers about them (their chat history stays)."""
    if user is None:
        raise HTTPException(status_code=401, detail="Log in to manage what we remember.")
    agent.clear_memory(user.id)


@app.delete("/api/chat/history", status_code=204)
def delete_chat_history(user: Annotated[PublicUser | None, Depends(current_user)]) -> None:
    """Let a shopper wipe their own saved chat."""
    if user is None:
        raise HTTPException(status_code=401, detail="Log in to manage your saved chats.")
    agent.clear_history(user.id)

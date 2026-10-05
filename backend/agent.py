"""The Campus Customs shop assistant: a small team of PydanticAI agents, with its memory and audit trail.

    Dan           CONCIERGE_MODEL (gpt-5.6-terra)  the concierge, a bulldog mascot: talks
                                                   to the shopper, checks price, stock
                                                   and sizes itself, delegates, and
                                                   writes the reply (models.ShopReply)
    Scout         TEAM_MODEL (gpt-5.6-luna)        browsing searches: reads the long
                                                   result lists so the concierge doesn't
    Stylist       TEAM_MODEL                       outfit pairings and close alternatives
    Memory clerk  TEAM_MODEL                       after a logged-in reply, updates the
                                                   customer's memory notes (background)

Sections of this file:
    The audit trail    output/audit_trail.json: every model call, tool call, retry and stop
                       reason, recorded by a PydanticAI capability on every agent (first,
                       because each agent is built with it)
    Saved chats        chat_messages and customer_memory: a logged-in shopper's history,
                       the agent's history window, and the memory notes
    The agent team     the four agents, their per-request context, delegation, the checks
                       on every answer (grounding), and ask() / update_memory()

Each agent's instructions are one section of prompts/prompt.md. The tools are in tools.py
and every type in models.py. main.py calls make_deps() and ask() for each message, and
update_memory() after saving a logged-in exchange.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import logging
import math
import os
import re
import secrets
import threading
import time
from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, NamedTuple

try:
    import fcntl  # macOS / Linux: lock the audit file across server processes
except ImportError:  # Windows has no fcntl; the thread lock still orders writes within one process
    fcntl = None

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # keep the server log clean

from dotenv import find_dotenv, load_dotenv
from openai import AsyncOpenAI
from pydantic import BaseModel
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.exceptions import (
    ContentFilterError,
    IncompleteToolCall,
    ModelAPIError,
    ModelHTTPError,
    ToolRetryError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

# Looks for a .env from this folder upward (backend/, then hw4/, then any folder above). Loaded
# before the project's own modules, and main.py imports this file first, so settings read at
# import time (COOKIE_SECURE in main.py) see the .env too.
load_dotenv(find_dotenv())

import tools
from models import (
    MAX_HISTORY_TURNS,
    MAX_SHOWCASE,
    ChatTurn,
    CustomerProfile,
    Highlight,
    MemoryNotes,
    ModelUsage,
    PageContext,
    PriceQuote,
    Product,
    ProductDescription,
    ProductRef,
    PublicUser,
    Recommendation,
    SavedChatMessage,
    ScoutFindings,
    ScoutReport,
    SearchResults,
    ShopDeps,
    ShopReply,
    Size,
    SizeFitCheck,
    StockCheck,
    StylistReport,
    ViewedProduct,
)
from tools import connect, load_products

log = logging.getLogger("campus_customs")


# ==================================================================================================
# The audit trail: output/audit_trail.json
# ==================================================================================================
# An append-only record of agent-loop activity.
#
# One entry per event, each stamped with the UTC time and the chat turn it belongs to:
#
#     turn_start   a shopper message arrives: who (guest or user id), the page, a short preview
#     guard        a safety rule stepped in: before the agent ran (chat ended, rate limit,
#                  rudeness filter) or inside it (the Scout trip cap)
#     model_call   one model request: agent, model, step, finish reason, the tools it asked
#                  for, tokens, milliseconds
#     tool_call    one tool call: agent, tool, short args, short result, status, milliseconds
#     retry        an answer the harness sent back to the model (failed a check), and why
#     loop_end     one agent loop finished: its stop reason, model calls, tool calls, seconds
#     turn_end     the turn's outcome (stop reason), the safety flag, what the shopper got
#
# A step's `time` is when it started (`ms` says how long it took); loop_end and turn_end are
# stamped when they finish.
#
# The file is a JSON array with one entry per line, and it is only ever appended to: each write
# replaces the closing "]" with the new entries and a fresh "]". Earlier bytes are never
# rewritten, and nothing in the app truncates or deletes the file, so it survives restarts and
# reloads. CAMPUS_CUSTOMS_AUDIT points it somewhere else (e.g. a temporary file for testing).
#
# Model and tool events come from AuditTrail, a PydanticAI capability attached to every agent,
# so the loop reports on itself; tools the code calls directly (the teammates' up-front
# lookups) are recorded with tool_entry(). Each turn's entries collect in a Turn and are
# written together when the turn finishes, so one turn's lines sit together in the file.

DEFAULT_AUDIT_PATH = Path(__file__).resolve().parent.parent / "output" / "audit_trail.json"

# "Short args/result": long values are cut to these lengths.
ARG_CHARS = 80
RESULT_CHARS = 200
PREVIEW_CHARS = 120

# The shopper's message is previewed with contact details and long numbers masked.
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Card, phone and ID numbers: 7+ digits, however they're spaced ("4111 1111…", "203.555.0199").
LONG_NUMBER_RE = re.compile(r"\d(?:[ .\-/]{0,3}\d){6,}")


def audit_path() -> Path:
    return Path(os.environ.get("CAMPUS_CUSTOMS_AUDIT") or DEFAULT_AUDIT_PATH)


class Stamp(NamedTuple):
    """When a step started: the time written to the file (to the millisecond), plus nanoseconds to sort by."""

    iso: str
    ns: int


def stamp() -> Stamp:
    ns = time.time_ns()
    iso = datetime.fromtimestamp(ns / 1e9, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return Stamp(iso, ns)


def short(value: Any, limit: int = RESULT_CHARS) -> str:
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def preview(message: str) -> str:
    """The first words of a shopper's message, with emails and long numbers masked."""
    text = " ".join(message.split())  # collapse whitespace first, so spacing can't split a number
    return short(LONG_NUMBER_RE.sub("[number]", EMAIL_RE.sub("[email]", text)), PREVIEW_CHARS)


def _jsonable(value: Any) -> Any:
    """Infinity and NaN aren't JSON; a model can pass them as a float argument ("under $1e999")."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def short_args(args: Any) -> Any:
    if not isinstance(args, dict):
        return short(args, ARG_CHARS)
    return {
        key: short(value, ARG_CHARS) if isinstance(value, str) else value
        for key, value in args.items()
        if value is not None
    }


def _names(items: list[Any], limit: int = 3) -> str:
    names = ", ".join(item.name for item in items[:limit])
    return names + (f" (+{len(items) - limit} more)" if len(items) > limit else "")


def summarize(result: Any) -> str:
    """One short line for a tool's result: the answer it gave, not the whole object."""
    if isinstance(result, PriceQuote):
        text = f"{result.name}: {result.display}"
    elif isinstance(result, StockCheck):
        text = result.summary
        if result.similar_in_size:
            text += f" {len(result.similar_in_size)} in-stock alternatives offered."
    elif isinstance(result, SearchResults):
        text = f"{result.total_matches} match{'es' * (result.total_matches != 1)}"
        if result.matches:
            text += ": " + _names(result.matches)
        if result.unmatched_terms:
            text += f"; nothing matched {', '.join(result.unmatched_terms)}"
    elif isinstance(result, ProductDescription):
        text = f"{result.name} ({result.garment_type}): {result.description}"
    elif isinstance(result, SizeFitCheck):
        text = f"size {result.size}" + (f" (or {result.alternative})" if result.alternative else "")
        if result.product_name:
            stock = f"{result.quantity} in stock" if result.in_stock else "SOLD OUT in that size"
            text += f"; {result.product_name}: {stock}"
    elif isinstance(result, ScoutFindings):
        text = f"{result.title or 'no title'}: {result.match_count} matches"
        if result.highlights:
            text += "; highlights " + _names(result.highlights)
        if result.unmatched:
            text += f"; not carried: {', '.join(result.unmatched)}"
    elif isinstance(result, StylistReport):
        text = f"{result.kind}: {len(result.picks)} picks" + (": " + _names(result.picks) if result.picks else "")
    elif isinstance(result, list) and all(isinstance(item, Recommendation) for item in result):
        text = f"{len(result)} pick{'s' * (len(result) != 1)}" + (": " + _names(result) if result else "")
    elif isinstance(result, BaseModel):
        text = result.model_dump_json()
    else:
        text = str(result)
    return short(text)


def provider_blocked(error: BaseException) -> bool:
    """The model provider's content filter stopped the turn: it rejects some prompts with a 400 before the
    model runs, and can also cut off a response (PydanticAI's ContentFilterError)."""
    if isinstance(error, ContentFilterError):
        return True
    return (
        isinstance(error, ModelHTTPError)
        and error.status_code == 400
        and "content management policy" in str(error.body)
    )


def stop_reason(error: BaseException | None) -> str:
    """Why an agent loop stopped."""
    if error is None:
        return "final_result"  # the model gave an answer and it passed every check
    if isinstance(error, UsageLimitExceeded):
        return "usage_limit"  # hit a request, tool-call or token limit
    if provider_blocked(error):
        return "provider_content_filter"
    if isinstance(error, ModelHTTPError):
        return f"model_http_{error.status_code}"
    if isinstance(error, IncompleteToolCall):
        return "max_tokens"  # the reply ran into the length cap (agent.MAX_REPLY_TOKENS) mid-answer
    if isinstance(error, UnexpectedModelBehavior):
        text = str(error)
        if text.startswith("Exceeded maximum output retries"):
            return "output_retries_exhausted"  # the answer kept failing a check
        if text.startswith("Tool ") and "exceeded max retries" in text:
            return "tool_retries_exhausted"  # a tool kept rejecting the model's arguments
        return "unexpected_model_behavior"
    if isinstance(error, asyncio.CancelledError):
        return "cancelled"  # the shopper closed the page mid-answer
    if (
        isinstance(error, TimeoutError)
        or type(error.__cause__).__name__ == "APITimeoutError"
        or (isinstance(error, ModelAPIError) and "timed out" in str(error).lower())
    ):
        return "timeout"
    return "error"


def _retry_text(content: Any) -> str:
    if isinstance(content, list):  # validation errors
        return "; ".join(f"{'.'.join(map(str, error.get('loc', ())))}: {error.get('msg', '')}" for error in content)
    return str(content)


# ---- Writing the file ----

_write_lock = threading.Lock()


def append_entries(entries: list[dict]) -> None:
    """Add entries to the end of the trail, creating it the first time. Never rewrites what's there.

    The only bytes ever replaced are the closing "]" and the whitespace around it.
    """
    if not entries:
        return
    dumped = [json.dumps(_jsonable(entry), ensure_ascii=False, default=str, allow_nan=False) for entry in entries]
    lines = ",\n".join(dumped)
    path = audit_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _write_lock, open(path, "a+b") as file:
        if fcntl:
            fcntl.flock(file, fcntl.LOCK_EX)  # another server process may be appending too
        try:
            size = file.seek(0, os.SEEK_END)
            file.seek(0)
            head = file.read(1)
            window = min(size, 65536)
            file.seek(size - window)
            tail = file.read(window).rstrip()
            if not tail and size == window:  # new or blank file
                file.truncate(0)
                file.write(f"[\n{lines}\n]\n".encode())
            elif head == b"[" and tail.endswith(b"\n]") and _ends_in_entry(tail[:-1].rstrip()):
                body = tail[:-1].rstrip()
                file.truncate(size - window + len(body))  # drop just the "]" and its whitespace
                file.write(f"{'' if body.endswith(b'[') else ','}\n{lines}\n]\n".encode())
            elif head == b"[" and tail.endswith(b"}") and _ends_in_entry(tail):
                # Interrupted between dropping "]" and writing: close the array with the new entries.
                file.write(f",\n{lines}\n]\n".encode())
            else:
                # Not something this code wrote, or a write cut off mid-entry. Leave it alone and
                # keep the new entries beside it.
                log.error("%s doesn't end like this trail; writing new entries to a side file", path)
                with open(path.with_suffix(".unappended.jsonl"), "a", encoding="utf-8") as side:
                    side.write("\n".join(dumped) + "\n")
        finally:
            if fcntl:
                fcntl.flock(file, fcntl.LOCK_UN)


def _ends_in_entry(body: bytes) -> bool:
    """Whether the text before the closing "]" ends with "[" or with one complete entry line."""
    last = body.rsplit(b"\n", 1)[-1].strip()
    if last == b"[":
        return True
    try:
        return isinstance(json.loads(last.rstrip(b",")), dict)
    except ValueError:
        return False


# ---- One turn's entries ----


class Turn:
    """One chat turn's audit entries, written together when the turn finishes (flush)."""

    def __init__(self) -> None:
        self.id = secrets.token_hex(4)
        self._entries: list[tuple[int, int, dict]] = []  # (start ns, order added, entry)
        self._lock = threading.Lock()  # sync tools record from worker threads
        self.logged_retries: set[str] = set()  # tool calls already recorded as retries

    def add(self, event: str, *, at: Stamp | None = None, **fields: Any) -> None:
        at = at or stamp()
        entry = {"time": at.iso, "turn": self.id, "event": event}
        entry.update((key, value) for key, value in fields.items() if value is not None)
        with self._lock:
            self._entries.append((at.ns, len(self._entries), entry))

    def flush(self) -> None:
        """Append everything recorded so far to the file, in the order the steps started.

        Safe to call again for entries that arrive later (the memory clerk runs after the reply).
        """
        with self._lock:
            pending, self._entries = self._entries, []
        entries = [entry for _, _, entry in sorted(pending, key=lambda item: item[:2])]
        try:
            append_entries(entries)
        except Exception:
            log.warning("Couldn't write %d audit entries", len(entries), exc_info=True)


def tool_entry(
    deps: Any, tool: str, args: dict, result: Any, *, at: Stamp, ms: float, via: str | None = None
) -> None:
    """Record a tool the code called directly, outside a model's loop (a teammate's up-front lookup)."""
    turn = getattr(deps, "audit", None)
    if turn is not None:
        turn.add(
            "tool_call", at=at, agent=deps.agent_id, tool=tool, args=short_args(args),
            status="ok", result=summarize(result), ms=round(ms), via=via,
        )


# ---- The capability: every agent's loop reports on itself ----


@dataclass
class AuditTrail(AbstractCapability[Any]):
    """Records one agent's loop in the turn's audit trail (`ctx.deps.audit`): each model call, tool
    call and retry, and the stop reason when the loop ends. Attached to every agent; a fresh copy
    per run keeps the counts per loop. With no Turn in the deps (a run outside a chat turn) it does nothing.
    """

    agent: str
    model_calls: int = 0
    tool_calls: int = 0

    async def for_run(self, ctx: Any) -> AuditTrail:
        return AuditTrail(self.agent)

    @staticmethod
    def _turn(ctx: Any) -> Turn | None:
        return getattr(ctx.deps, "audit", None)

    async def wrap_run(self, ctx: Any, *, handler: Any) -> Any:
        started = time.perf_counter()
        error: BaseException | None = None
        try:
            return await handler()
        except BaseException as exc:
            error = exc
            raise
        finally:
            if (turn := self._turn(ctx)) is not None:
                turn.add(
                    "loop_end", agent=self.agent, stop_reason=stop_reason(error),
                    detail=short(error, 160) if error is not None and str(error) else None,
                    model_calls=self.model_calls, tool_calls=self.tool_calls,
                    seconds=round(time.perf_counter() - started, 2),
                )

    def _record_retries(self, turn: Turn, request_context: Any) -> None:
        # The newest request carries what the harness sent back since the last call. Tool retries
        # are already recorded with their tool call; this catches answers that failed a check.
        last = request_context.messages[-1] if request_context.messages else None
        if not isinstance(last, ModelRequest):
            return
        output_tools = {tool.name for tool in request_context.model_request_parameters.output_tools}
        for part in last.parts:
            if isinstance(part, RetryPromptPart) and part.tool_call_id not in turn.logged_retries:
                tool = "answer" if part.tool_name is None or part.tool_name in output_tools else part.tool_name
                turn.add("retry", agent=self.agent, tool=tool, reason=short(_retry_text(part.content)))

    async def wrap_model_request(self, ctx: Any, *, request_context: Any, handler: Any) -> Any:
        if (turn := self._turn(ctx)) is not None:
            self._record_retries(turn, request_context)  # stamped before the call they lead to
        at, started = stamp(), time.perf_counter()
        try:
            response = await handler(request_context)
        except BaseException as error:  # including a cancel: the request was sent and may be billed
            self.model_calls += 1
            if (turn := self._turn(ctx)) is not None:
                turn.add(
                    "model_call", at=at, agent=self.agent, model=request_context.model.model_name,
                    step=ctx.run_step, error=stop_reason(error), ms=round((time.perf_counter() - started) * 1000),
                )
            raise
        self.model_calls += 1
        if (turn := self._turn(ctx)) is not None:
            output_tools = {tool.name for tool in request_context.model_request_parameters.output_tools}
            wants = [
                "answer" if part.tool_name in output_tools else part.tool_name
                for part in response.parts
                if isinstance(part, ToolCallPart)
            ]
            usage = response.usage
            turn.add(
                "model_call", at=at, agent=self.agent, model=response.model_name or request_context.model.model_name,
                step=ctx.run_step, finish_reason=response.finish_reason, wants=wants or ["text"],
                tokens={"in": usage.input_tokens, "cached": usage.cache_read_tokens, "out": usage.output_tokens},
                ms=round((time.perf_counter() - started) * 1000),
            )
        return response

    async def wrap_tool_execute(self, ctx: Any, *, call: ToolCallPart, tool_def: Any, args: Any, handler: Any) -> Any:
        turn = self._turn(ctx)
        at, started = stamp(), time.perf_counter()

        def record(status: str, result: str) -> None:
            if turn is not None:
                turn.add(
                    "tool_call", at=at, agent=self.agent, tool=call.tool_name, args=short_args(args),
                    status=status, result=result, ms=round((time.perf_counter() - started) * 1000),
                )

        self.tool_calls += 1
        try:
            result = await handler(args)
        except ToolRetryError as retry:  # the tool raised ModelRetry: the model is asked to fix its call
            if turn is not None:
                turn.logged_retries.add(call.tool_call_id)
            record("retry", short(retry))
            raise
        except asyncio.CancelledError:
            record("cancelled", "the shopper left before it finished")
            raise
        except Exception as error:
            record("error", short(f"{type(error).__name__}: {error}"))
            raise
        record("ok", summarize(result))
        return result


# ==================================================================================================
# Saved chats and memory notes (chat_messages, customer_memory)
# ==================================================================================================
# Logged-in shoppers' chats, one chat_messages row per message, in the format the seed data uses:
#
# One row per message, in the format the seed data already uses:
#     user rows       role='user',      products_json NULL
#     assistant rows  role='assistant', products_json = JSON list of the product
#                     cards shown with the reply ('[]' when there were none)
#
# Every function takes the logged-in user's id from the session, never from the
# request body, so a shopper can only ever read or clear their own history.
# Guests have no user id, so their chats are never stored.
#
# Memory and the history window (customer_memory table)
#     The memory clerk (update_memory(), in "The agent team" below) keeps short notes about each
#     customer: sizes, likes, who they shop for. The agent's view of the
#     conversation is a window that only grows until it reaches WINDOW_FOLD_AT
#     messages, then jumps forward to keep the last WINDOW_KEEP; anything that
#     falls out is already in the notes. Because the window is append-only
#     between jumps, consecutive requests start with the same prefix, which the
#     model provider serves from its prompt cache.

# How much history the chat panel reloads on return.
MAX_SAVED_MESSAGES_SHOWN = 50
# The agent's history window: grows to WINDOW_FOLD_AT messages, then keeps the last WINDOW_KEEP.
WINDOW_FOLD_AT = 16
WINDOW_KEEP = 6


def ensure_chat_schema() -> None:
    # History is always read per shopper, newest last.
    with closing(connect(readonly=False)) as conn, conn:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages (user_id, id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS customer_memory (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                notes_json TEXT NOT NULL,
                through_message_id INTEGER NOT NULL,
                window_start_id INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )


def _memory_row(user_id: int):
    with closing(connect()) as conn:
        return conn.execute(
            "SELECT notes_json, through_message_id, window_start_id FROM customer_memory WHERE user_id = ?", (user_id,)
        ).fetchone()


def load_memory(user_id: int) -> tuple[MemoryNotes | None, int]:
    """The customer's memory notes (None if there are none) and the last message id they cover (0 if none yet)."""
    row = _memory_row(user_id)
    if row is None:
        return None, 0
    notes = MemoryNotes.model_validate_json(row["notes_json"])
    return (None if notes.is_empty() else notes), row["through_message_id"]


def save_memory(
    user_id: int, notes: MemoryNotes, through_message_id: int, expected_through: int | None = None
) -> bool:
    """Store the clerk's notes. With `expected_through` (the checkpoint the clerk started from), skip the
    write if Forget or Clear happened meanwhile, so an update already in flight can't undo them."""
    with closing(connect(readonly=False)) as conn, conn:
        if expected_through is not None:
            row = conn.execute(
                "SELECT through_message_id FROM customer_memory WHERE user_id = ?", (user_id,)
            ).fetchone()
            still_there = conn.execute(
                "SELECT 1 FROM chat_messages WHERE id = ? AND user_id = ?", (through_message_id, user_id)
            ).fetchone()
            if (row["through_message_id"] if row else 0) != expected_through or not still_there:
                return False
        conn.execute(
            """
            INSERT INTO customer_memory (user_id, notes_json, through_message_id) VALUES (?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
                notes_json = excluded.notes_json,
                through_message_id = excluded.through_message_id,
                updated_at = datetime('now')
            """,
            (user_id, notes.model_dump_json(), through_message_id),
        )
    return True


def clear_memory(user_id: int) -> None:
    """Forget the notes. The messages they came from are still in the chat history, so mark those as
    read; deleting the row instead would let the next update learn everything again."""
    with closing(connect(readonly=False)) as conn, conn:
        (latest,) = conn.execute(
            "SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE user_id = ?", (user_id,)
        ).fetchone()
        conn.execute(
            """
            INSERT INTO customer_memory (user_id, notes_json, through_message_id) VALUES (?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
                notes_json = excluded.notes_json,
                through_message_id = excluded.through_message_id,
                updated_at = datetime('now')
            """,
            (user_id, MemoryNotes().model_dump_json(), latest),
        )


def messages_since(user_id: int, after_id: int) -> list:
    """(id, role, content) of every message after `after_id`, oldest first: what the memory hasn't seen."""
    with closing(connect()) as conn:
        return conn.execute(
            "SELECT id, role, content FROM chat_messages WHERE user_id = ? AND id > ? ORDER BY id",
            (user_id, after_id),
        ).fetchall()


def _recent_rows(user_id: int, limit: int) -> list:
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT id, role, content, products_json, created_at FROM chat_messages"
            " WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return list(reversed(rows))  # oldest first


def _window_rows(user_id: int) -> list:
    """The agent's history window: append-only until it folds (see "Memory and the history window" above)."""
    state = _memory_row(user_id)
    start = state["window_start_id"] if state else 0
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT id, role, content, products_json FROM chat_messages WHERE user_id = ? AND id > ? ORDER BY id",
            (user_id, start),
        ).fetchall()
    if len(rows) > WINDOW_FOLD_AT and state and state["through_message_id"] >= rows[-WINDOW_KEEP - 1]["id"]:
        # Everything before the last WINDOW_KEEP is in the memory notes: jump the window forward.
        new_start = rows[-WINDOW_KEEP - 1]["id"]
        with closing(connect(readonly=False)) as conn, conn:
            conn.execute("UPDATE customer_memory SET window_start_id = ? WHERE user_id = ?", (new_start, user_id))
        rows = rows[-WINDOW_KEEP:]
    return rows[-MAX_HISTORY_TURNS:]  # hard cap if the memory is lagging behind


def load_turns(user_id: int) -> list[ChatTurn]:
    """The shopper's messages in the current window, as plain turns for the agent's message history.

    An assistant turn that showed product cards gets a note naming them, so a
    later "the one you showed me" or "that crewneck" still resolves after the
    page it was asked on is long gone.
    """
    turns = []
    for row in _window_rows(user_id):
        content = row["content"]
        cards = json.loads(row["products_json"] or "[]")
        if cards:
            shown = "; ".join(f"{card['name']} (`{card['product_id']}`)" for card in cards)
            content = f"{content}\n\n[Product cards shown with this reply: {shown}]"
        turns.append(ChatTurn(role=row["role"], content=content[:4000]))
    return turns


def load_history(user_id: int) -> list[SavedChatMessage]:
    """The shopper's recent messages for the chat panel, with product cards re-read from the catalogue.

    products_json is a snapshot of what was shown at the time; only its product ids are used,
    so reloaded cards show today's price and stock rather than stale numbers.
    """
    rows = _recent_rows(user_id, MAX_SAVED_MESSAGES_SHOWN)
    ids_per_row = {row["id"]: [card["product_id"] for card in json.loads(row["products_json"] or "[]")] for row in rows}
    cards = {p.product_id: p for p in load_products(sorted({pid for ids in ids_per_row.values() for pid in ids}))}
    return [
        SavedChatMessage(
            id=row["id"],
            role=row["role"],
            content=row["content"],
            products=[cards[pid] for pid in ids_per_row[row["id"]] if pid in cards],
            created_at=row["created_at"],
        )
        for row in rows
    ]


def save_exchange(user_id: int, message: str, reply: str, products: list[Product]) -> None:
    """Store one question and its answer together, so history never holds half an exchange."""
    with closing(connect(readonly=False)) as conn, conn:
        conn.execute(
            "INSERT INTO chat_messages (user_id, role, content, products_json) VALUES (?, 'user', ?, NULL)",
            (user_id, message),
        )
        conn.execute(
            "INSERT INTO chat_messages (user_id, role, content, products_json) VALUES (?, 'assistant', ?, ?)",
            (user_id, reply, json.dumps([product.model_dump() for product in products])),
        )


def clear_history(user_id: int) -> int:
    """Delete all of this shopper's saved messages and what we remember about them."""
    with closing(connect(readonly=False)) as conn, conn:
        conn.execute("DELETE FROM customer_memory WHERE user_id = ?", (user_id,))
        return conn.execute("DELETE FROM chat_messages WHERE user_id = ?", (user_id,)).rowcount


# ==================================================================================================
# The agent team
# ==================================================================================================
# Sub-agents share the concierge's ShopDeps (a copy with their own agent_id), so
# every price, stock count, search hit and recommendation they see lands in one
# ledger, and the concierge's reply is checked against it before it's accepted.
# Every step is also posted to an optional EventSink, which main.py streams to the
# chat's live view.
#
# Requests are laid out for the model provider's prompt cache: static
# instructions and the customer's identity first, then the customer's
# append-only conversation window, then the volatile bits (memory notes, page
# context, the new message) last. Each account gets its own prompt_cache_key.
#
# Every agent carries AuditTrail (above), a capability that writes each model
# call, tool call, retry and stop reason to output/audit_trail.json, and every
# loop runs under the limits below (model calls, tool calls, tokens, reply length).

PROMPT_PATH = Path(__file__).parent / "prompts" / "prompt.md"
# prompt.md holds every agent's instructions under its own top-level "# " heading.
PROMPT_TITLES = {
    "concierge": "Campus Customs shop assistant",
    "scout": "Campus Customs Scout",
    "stylist": "Campus Customs Stylist",
    "memory_clerk": "Campus Customs memory clerk",
}

# The concierge needs judgment and a good voice; the teammates do narrower,
# token-heavy jobs on the cheaper tier. Override either with an env var.
CONCIERGE_MODEL = os.getenv("CAMPUS_CUSTOMS_MODEL", "gpt-5.6-terra")
TEAM_MODEL = os.getenv("CAMPUS_CUSTOMS_TEAM_MODEL", "gpt-5.6-luna")

# ---- Limits: every agent loop is bounded, so no message can run up the model bill ----
# The concierge, per shopper message: lookups, delegation, the answer and a
# grounding retry fit in 8 model calls (measured turns use 2-3).
MAX_MODEL_REQUESTS = 8
MAX_TOOL_CALLS = 12
MAX_TURN_TOKENS = 60_000  # about 5x the largest measured turn (12.3k tokens): a cost backstop
MAX_REPLY_TOKENS = 1_000  # per model response; measured replies use 100-400, so no essays
# Each teammate run (Scout, Stylist).
MAX_TEAMMATE_REQUESTS = 4
MAX_TEAMMATE_TOOL_CALLS = 4
MAX_TEAMMATE_TOKENS = 15_000
MAX_TEAMMATE_REPLY_TOKENS = 800
# The memory clerk's background update.
MAX_MEMORY_REQUESTS = 2
MAX_MEMORY_TOKENS = 8_000
MAX_MEMORY_MESSAGES = 30  # the newest messages it reads in one update
# Scout searches per shopper message. Found by testing: on an off-topic message
# the concierge could keep re-sending the Scout for "Yale apparel" until it hit
# its request limit; a third trip now just tells it to answer.
MAX_SCOUT_TRIPS = 2

CONCIERGE_LIMITS = UsageLimits(
    request_limit=MAX_MODEL_REQUESTS, tool_calls_limit=MAX_TOOL_CALLS, total_tokens_limit=MAX_TURN_TOKENS
)
TEAMMATE_LIMITS = UsageLimits(
    request_limit=MAX_TEAMMATE_REQUESTS, tool_calls_limit=MAX_TEAMMATE_TOOL_CALLS, total_tokens_limit=MAX_TEAMMATE_TOKENS
)
MEMORY_LIMITS = UsageLimits(request_limit=MAX_MEMORY_REQUESTS, total_tokens_limit=MAX_MEMORY_TOKENS)

# Extra headers sent with every model call; empty by default. {"x-portkey-cache-force-refresh": "true"},
# for example, makes Portkey skip its cache (the development benchmark used that).
EXTRA_HEADERS: dict[str, str] = {}

# "$58", "$58.00", "$ 1,200"
DOLLAR_RE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")
# "8 left", "12 in stock", "25 available", "only 2"
QUANTITY_RE = re.compile(
    r"\b(\d+)\s+(?:left|in stock|available|remaining|units?)\b|\bonly\s+(\d+)\b", re.IGNORECASE
)
SOLD_OUT_RE = re.compile(r"sold out|out of stock", re.IGNORECASE)

# Sent when the model provider's own content filter blocks a message (it
# rejects obvious jailbreak attempts with an HTTP 400 before the model runs).
BLOCKED_REPLY = ShopReply(
    safety="manipulation",
    message="Sorry, I can't help with that one. I'm happy to help you find some Yale gear, though!",
)
# The same filter also blocks messages about self-harm. Those get care, not a refusal or a strike.
CARE_REPLY = ShopReply(
    safety="ok",
    message=(
        "I'm really sorry you're going through this, and you don't have to handle it alone. "
        "If you might act on these thoughts or you're in danger, call 911 now. You can also call or text "
        "**988** (the Suicide & Crisis Lifeline) any time to talk with someone, and Yale students can reach "
        "Yale Mental Health & Counseling."
    ),
)


# Signs a message is about self-harm. Only checked when the model provider's content filter
# has blocked a message (Portkey's error doesn't say which rule fired), so that someone who may
# be at risk gets CARE_REPLY (above) instead of a refusal and a strike.
DISTRESS_RE = re.compile(
    r"\b(?:suicid\w*|kill(?:ing)?\s+my\s*self|hurt(?:ing)?\s+my\s*self|harm(?:ing)?\s+my\s*self|self[-\s]?harm"
    r"|cut(?:ting)?\s+my\s*self|end(?:ing)?\s+(?:my\s+life|it\s+all)|want\s+to\s+die|better\s+off\s+dead"
    r"|no\s+reason\s+to\s+live|don'?t\s+want\s+to\s+(?:live|be\s+alive|be\s+here)|overdos\w*|hopeless)\b",
    re.IGNORECASE,
)


def sounds_like_distress(message: str) -> bool:
    return bool(DISTRESS_RE.search(message))

# Who's on the team, for the chat's live view.
TEAM = [
    {"id": "concierge", "name": "Dan", "model": CONCIERGE_MODEL, "job": "Bulldog concierge: talks to you, checks prices, stock and sizes"},
    {"id": "scout", "name": "Scout", "model": TEAM_MODEL, "job": "Searches the catalogue"},
    {"id": "stylist", "name": "Stylist", "model": TEAM_MODEL, "job": "Outfits and alternatives"},
]


class ChatUnavailable(RuntimeError):
    """The agent can't run, e.g. no API key is configured."""


class EventSink:
    """Collects the team's steps for the chat's live view; main.py streams them as SSE.

    Sync tools run in worker threads, so events are handed to the event loop thread-safely.
    """

    def __init__(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.queue: asyncio.Queue = asyncio.Queue()
        self.started = time.perf_counter()

    def emit(self, event_type: str, **data: Any) -> None:
        event = {"type": event_type, "data": {"t": round(time.perf_counter() - self.started, 2), **data}}
        self.loop.call_soon_threadsafe(self.queue.put_nowait, event)


def _emit(deps: ShopDeps, event_type: str, **data: Any) -> None:
    if deps.events is not None:
        deps.events.emit(event_type, **data)


# ---- Models and agents ----

_client = AsyncOpenAI(
    # AsyncOpenAI refuses an empty key, so use a placeholder and let ask()
    # report the missing key; the rest of the site keeps working without one.
    api_key=os.getenv("PORTKEY_API_KEY") or "missing",
    base_url=os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1"),
    default_headers={"x-portkey-provider": os.getenv("PORTKEY_PROVIDER", "openai")},
    timeout=60.0,
    max_retries=2,
)


def build_model(name: str) -> OpenAIChatModel:
    return OpenAIChatModel(name, provider=OpenAIProvider(openai_client=_client))


def load_prompt(agent_id: str) -> str:
    """One agent's instructions: its section of prompt.md, from its "# " heading to the next one."""
    sections: dict[str, list[str]] = {}
    current = None
    for line in PROMPT_PATH.read_text(encoding="utf-8").splitlines(keepends=True):
        if line.startswith("# "):
            current = line[2:].strip()
            sections[current] = []
        if current is not None:  # anything before the first heading is a note for people, not a model
            sections[current].append(line)
    title = PROMPT_TITLES[agent_id]
    if title not in sections:
        raise RuntimeError(f'prompts/prompt.md has no "# {title}" heading; agent.PROMPT_TITLES must match its headings.')
    return "".join(sections[title]).strip() + "\n"


concierge = Agent(
    build_model(CONCIERGE_MODEL),
    name="concierge",
    deps_type=ShopDeps,
    output_type=ShopReply,
    instructions=load_prompt("concierge"),
    tools=[
        tools.find_product,
        tools.get_product_description,
        tools.get_price,
        tools.check_stock,
        tools.find_similar,
        tools.size_advice,
    ],
    capabilities=[AuditTrail("concierge")],
    retries=2,
)
shop_agent = concierge  # an older name for the concierge, from before the team

scout = Agent(
    build_model(TEAM_MODEL),
    name="scout",
    deps_type=ShopDeps,
    output_type=ScoutReport,
    instructions=load_prompt("scout"),
    tools=[tools.search_products],
    capabilities=[AuditTrail("scout")],
    retries=2,
)

stylist = Agent(
    build_model(TEAM_MODEL),
    name="stylist",
    deps_type=ShopDeps,
    output_type=StylistReport,
    instructions=load_prompt("stylist"),
    tools=[tools.outfit_candidates, tools.find_similar],
    capabilities=[AuditTrail("stylist")],
    retries=2,
)

memory_clerk = Agent(
    build_model(TEAM_MODEL),
    name="memory_clerk",
    deps_type=ShopDeps,  # only for its audit trail; it has no tools
    output_type=MemoryNotes,
    instructions=load_prompt("memory_clerk"),
    capabilities=[AuditTrail("memory_clerk")],
    retries=1,
)


def _settings(cache_key: str, max_tokens: int) -> dict:
    """Per-request model settings: this account's prompt cache, a cap on reply length, any extra headers."""
    settings: dict = {"openai_prompt_cache_key": cache_key, "max_tokens": max_tokens}
    if EXTRA_HEADERS:
        settings["extra_headers"] = dict(EXTRA_HEADERS)
    return settings


def cache_key(deps: ShopDeps) -> str:
    """One prompt-cache lane per customer (a hash, never the email itself), one shared lane for guests."""
    if deps.customer is None:
        return "campus-customs:guest"
    return "campus-customs:" + hashlib.sha256(deps.customer.email.encode()).hexdigest()[:16]


def _log_usage(deps: ShopDeps, agent_id: str, model: str, result: Any) -> None:
    usage = result.usage
    deps.usage_log.append(
        ModelUsage(
            agent=agent_id,
            model=model,
            requests=usage.requests,
            input_tokens=usage.input_tokens,
            cached_tokens=usage.cache_read_tokens,
            output_tokens=usage.output_tokens,
        )
    )


# ---- Per-request context ----


def make_deps(user: PublicUser | None, page: PageContext | None) -> ShopDeps:
    """Per-request context: who is chatting, what we remember, what they're looking at; all from the database."""
    customer, memory = None, None
    if user:
        customer = CustomerProfile(first_name=user.first_name, last_name=user.last_name, name=user.name, email=user.email)
        memory, _ = load_memory(user.id)
    viewing, shelf = None, []
    if page:
        if page.product_id:
            found = load_products([page.product_id])
            if found:
                p = found[0]
                viewing = ViewedProduct(
                    product_id=p.product_id, name=p.name, garment_type=p.garment_type, description=p.description, colors=p.colors
                )
        shelf = [ProductRef(product_id=p.product_id, name=p.name) for p in load_products(page.showcase_product_ids)]
    return ShopDeps(customer=customer, memory=memory, page=page, viewing=viewing, shelf=shelf)


@concierge.instructions
def who_is_chatting(ctx: RunContext[ShopDeps]) -> str:
    # Stable for an account, so it stays inside the cached part of every request.
    customer = ctx.deps.customer
    if customer is None:
        return (
            "## Who you're talking to\n"
            "A guest who isn't logged in. You don't know their name or email, and this chat isn't saved."
        )
    return (
        "## Who you're talking to\n"
        f"A logged-in customer. Name: {customer.name} (first name {customer.first_name}). Email: {customer.email}.\n"
        "Their chats are saved to their account, so earlier messages may be from previous visits."
    )


def render_memory(notes: MemoryNotes) -> str:
    parts = [
        ("Sizes", notes.sizes),
        ("Likes", notes.likes),
        ("Avoids", notes.avoids),
        ("Shopping for", notes.shopping_for),
        ("Looked at", notes.considered),
    ]
    lines = [f"- {label}: {', '.join(values)}" for label, values in parts if values]
    if notes.notes:
        lines.append(f"- Notes: {notes.notes}")
    return "\n".join(lines)


def context_block(deps: ShopDeps) -> str:
    """Memory and page context, sent with the new message (the part of each request that changes)."""
    sections = []
    if deps.memory and not deps.memory.is_empty():
        sections.append("## What you remember about them (from earlier visits)\n" + render_memory(deps.memory))
    page, viewing, shelf = deps.page, deps.viewing, deps.shelf
    if page is None:
        sections.append("## Where they are on the site\nUnknown.")
    else:
        lines = ["## Where they are on the site", f"Page: {page.path}"]
        if viewing:
            colours = ", ".join(viewing.colors) or "not listed"
            lines.append(
                f"They have the product page for **{viewing.name}** open (product_id `{viewing.product_id}`, "
                f"{viewing.garment_type}). Description: {viewing.description} Colours on it: {colours}.\n"
                'If they say "this", "it", "this one" or "this hoodie", they mean this product.'
            )
        if shelf:
            title = page.showcase_title or "products from the chat"
            items = "; ".join(f"{ref.name} (`{ref.product_id}`)" for ref in shelf)
            lines.append(f'The chat\'s product shelf on the page shows "{title}": {items}.')
        sections.append("\n".join(lines))
    return "[Context from the website for this message; not written by the shopper]\n\n" + "\n\n".join(sections)


# ---- Delegation: the concierge's teammates ----


class _TeammateContext:
    """Just enough of a RunContext to call a tool directly on a teammate's behalf."""

    def __init__(self, deps: ShopDeps) -> None:
        self.deps = deps


async def _run_teammate(
    ctx: RunContext[ShopDeps],
    member: Agent,
    member_id: str,
    label: str,
    prepare: Any,
) -> Any:
    """Run one teammate on a task, sharing the ledger; stream the hand-off both ways.

    `prepare(teammate_ctx)` does the teammate's database lookup up front (instant, no model call)
    and returns either the finished report, when the lookup alone settles it, or the prompt with
    the results in it, so the teammate needs a single model call instead of a tool round trip.
    It keeps its tools for a second look if the results miss.
    """
    boss = ctx.deps.agent_id
    _emit(ctx.deps, "delegate", **{"from": boss, "to": member_id, "task": label})
    _emit(ctx.deps, "status", agent=member_id, state="working")
    member_deps = dataclasses.replace(ctx.deps, agent_id=member_id)
    model = TEAM_MODEL
    started = time.perf_counter()
    looked_up = False
    try:
        prompt = await asyncio.to_thread(prepare, _TeammateContext(member_deps))
        looked_up = True
        if not isinstance(prompt, str):  # settled by the lookup: no model call at all
            if ctx.deps.audit is not None:
                ctx.deps.audit.add(
                    "loop_end", agent=member_id, stop_reason="settled_by_lookup", model_calls=0, tool_calls=1,
                    seconds=round(time.perf_counter() - started, 2),
                )
            _emit(ctx.deps, "report", **{"from": member_id, "to": boss, "summary": prompt.summary, "instant": True})
            _emit(ctx.deps, "status", agent=member_id, state="done")
            _emit(ctx.deps, "status", agent=boss, state="thinking")
            return prompt
        result = await member.run(
            prompt,
            deps=member_deps,
            usage_limits=TEAMMATE_LIMITS,
            model_settings=_settings(f"campus-customs:{member_id}", MAX_TEAMMATE_REPLY_TOKENS),
        )
    except Exception as error:  # a teammate failing degrades the answer; it never sinks it
        log.warning("Teammate %s failed: %s", member_id, error)
        if not looked_up and ctx.deps.audit is not None:  # failed before its loop started (its loop logs itself)
            ctx.deps.audit.add(
                "loop_end", agent=member_id, stop_reason=stop_reason(error), detail=short(error, 160),
                model_calls=0, tool_calls=0, seconds=round(time.perf_counter() - started, 2),
            )
        _emit(ctx.deps, "report", **{"from": member_id, "to": boss, "summary": "couldn't finish"})
        _emit(ctx.deps, "status", agent=member_id, state="done")
        return None
    _log_usage(ctx.deps, member_id, model, result)
    _emit(ctx.deps, "report", **{"from": member_id, "to": boss, "summary": result.output.summary})
    _emit(ctx.deps, "status", agent=member_id, state="done")
    _emit(ctx.deps, "status", agent=boss, state="thinking")
    return result.output


def _quick_scout_report(request: str, max_price: float | None, size: str | None, found: Any) -> ScoutReport | None:
    """The Scout's instant path. When every search word matched real products there's nothing to
    judge, so the search's own ranking is the report; when nothing at all matched there's nothing to
    judge either. Only a partial match ("pink hoodies", "a gift for dad") goes to the model."""
    if not found.matches:
        missing = ", ".join(found.unmatched_terms) or "those filters"
        return ScoutReport(
            title="",
            highlights=[],
            unmatched=found.unmatched_terms,
            summary=f"Nothing in the shop matches {missing}.",
        )
    if found.unmatched_terms:
        return None
    title = request.strip().rstrip(".?!").capitalize()
    if max_price:
        title += f" under ${max_price:g}"
    if size:
        title += f" in {size}"

    def first_words(description: str) -> str:
        words = description.split()
        text = " ".join(words[:12])
        return text if len(words) <= 12 else text.rstrip(",.;") + "…"

    return ScoutReport(
        title=title[:60],
        highlights=[Highlight(product_id=m.product_id, name=m.name, note=first_words(m.description)) for m in found.matches[:3]],
        summary=f"{found.total_matches} clean matches straight from the catalogue search.",
    )


@concierge.tool
async def ask_scout(
    ctx: RunContext[ShopDeps], request: str, max_price: float | None = None, size: Size | None = None
) -> ScoutFindings:
    """Send the Scout (a faster, cheaper teammate) to search the whole catalogue for a browsing request.

    Use it for "what hoodies do you have?", "show me Morse stuff", "gifts for my dad", "tees under $40",
    "do you have pink hoodies?". To put the matches on the page, set `showcase` with the Scout's `title`
    and leave its product_ids empty: the website shows all `match_count` matches. `highlights` are the
    standouts to name; `unmatched` lists words the shop doesn't carry.

    Args:
        request: What the shopper is looking for, in a few words ("hoodies", "a gift for dad").
        max_price: Only products at or below this price, if they gave a budget.
        size: Only products in stock in this size, if they named one.
    """
    ctx.deps.scout_trips += 1
    if ctx.deps.scout_trips > MAX_SCOUT_TRIPS:
        if ctx.deps.audit is not None:
            ctx.deps.audit.add(
                "guard", check="scout_trip_cap", result=f"trip {ctx.deps.scout_trips} refused (max {MAX_SCOUT_TRIPS})"
            )
        return ScoutFindings(
            title="",
            match_count=len(ctx.deps.scout_ids),
            highlights=[],
            unmatched=[],
            summary="You've already sent the Scout out twice for this message. Answer the shopper now with what you have.",
        )
    filters = "".join([f" Max price: ${max_price:g}." if max_price else "", f" Size: {size}." if size else ""])

    def prepare(scout_ctx: _TeammateContext) -> str | ScoutReport:
        at, began = stamp(), time.perf_counter()
        args = {"query": request, "max_price": max_price, "size": size, "limit": MAX_SHOWCASE}
        found = tools.search_products(scout_ctx, **args)
        tool_entry(scout_ctx.deps, "search_products", args, found, at=at,
                   ms=(time.perf_counter() - began) * 1000, via="up-front lookup")
        quick = _quick_scout_report(request, max_price, size, found)
        if quick is not None:
            return quick
        listing = "\n".join(
            f"- {m.product_id} | {m.name} | {m.garment_type} | {m.description[:80]}" for m in found.matches
        )
        return (
            f"Request: {request}.{filters}\n\nI already searched the catalogue for it: {found.total_matches} matches; "
            f"words nothing matched: {', '.join(found.unmatched_terms) or 'none'}.\n{listing or '(no matches)'}\n\n"
            "Report on these. Search again only if they clearly miss the request."
        )

    report = await _run_teammate(ctx, scout, "scout", f"Find {request}", prepare)
    if report is None:
        return ScoutFindings(
            title="", match_count=0, highlights=[], unmatched=[], summary="The Scout couldn't finish; use find_product."
        )
    # The Scout only says what to drop; the search's own ranking orders the rest.
    dropped = set(report.drop_ids)
    ctx.deps.scout_ids = [pid for pid in ctx.deps.search_order if pid not in dropped][:MAX_SHOWCASE]
    # Highlights are the closest real options; they may be shown as "Closest we have" cards.
    for highlight in report.highlights:
        ctx.deps.recommended.setdefault(
            highlight.product_id,
            Recommendation(product_id=highlight.product_id, name=highlight.name, role="Closest match", reason=highlight.note),
        )
    return ScoutFindings(
        title=report.title,
        match_count=len(ctx.deps.scout_ids),
        highlights=report.highlights,
        unmatched=report.unmatched,
        summary=report.summary,
    )


@concierge.tool
async def ask_stylist(
    ctx: RunContext[ShopDeps],
    product_id: str,
    goal: Literal["complete_the_look", "similar"],
    size: Size | None = None,
) -> StylistReport:
    """Send the Stylist (a faster, cheaper teammate) to pick pieces that pair with a product
    (goal="complete_the_look": "what goes with this?") or close alternatives (goal="similar").
    Its `picks` are ready for `suggestions`.

    Args:
        product_id: The product to style around or find alternatives for.
        goal: "complete_the_look" or "similar".
        size: The shopper's size, if known, so every pick is in stock in it.
    """
    known = ctx.deps.memory
    notes = f" What we know about the shopper: {render_memory(known)}" if known and not known.is_empty() else ""
    label = ("Style around " if goal == "complete_the_look" else "Find alternatives to ") + product_id.replace("-", " ")

    def prepare(stylist_ctx: _TeammateContext) -> str:
        fetch = tools.outfit_candidates if goal == "complete_the_look" else tools.find_similar
        at, began = stamp(), time.perf_counter()
        candidates = fetch(stylist_ctx, product_id, size)
        tool_entry(stylist_ctx.deps, fetch.__name__, {"product_id": product_id, "size": size}, candidates,
                   at=at, ms=(time.perf_counter() - began) * 1000, via="up-front lookup")
        listing = "\n".join(f"- {c.product_id} | {c.name} | {c.role} | {c.reason}" for c in candidates)
        return (
            f"Goal: {goal}. Product: {product_id}. Size: {size or 'any'}.{notes}\n\n"
            f"Candidates (already fetched with {fetch.__name__}):\n{listing or '(none in stock)'}\n\n"
            "Pick from these."
        )

    report = await _run_teammate(ctx, stylist, "stylist", label, prepare)
    if report is None:
        return StylistReport(kind=goal, picks=[], summary="The Stylist couldn't finish; use find_similar.")
    # The Stylist's wording replaces the rule-based reason on the cards.
    for pick in report.picks:
        if pick.product_id in ctx.deps.recommended:
            ctx.deps.recommended[pick.product_id] = ctx.deps.recommended[pick.product_id].model_copy(
                update={"role": pick.role, "reason": pick.why}
            )
    return report


@scout.output_validator
def scout_found_it(ctx: RunContext[ShopDeps], report: ScoutReport) -> ScoutReport:
    if not ctx.deps.search_order:
        raise ModelRetry("Call search_products before reporting.")
    unseen = [h.product_id for h in report.highlights if h.product_id not in ctx.deps.searched_ids]
    if unseen:
        raise ModelRetry(f"Highlight only products search_products returned; not: {', '.join(unseen)}.")
    dropped = set(report.drop_ids)
    return report.model_copy(update={"highlights": [h for h in report.highlights if h.product_id not in dropped]})


@stylist.output_validator
def stylist_picked_candidates(ctx: RunContext[ShopDeps], report: StylistReport) -> StylistReport:
    unseen = [pick.product_id for pick in report.picks if pick.product_id not in ctx.deps.recommended]
    if unseen:
        raise ModelRetry(f"Pick only from your tools' candidates; not: {', '.join(unseen)}.")
    return report


# ---- Grounding: nothing reaches the shopper that the database didn't say ----


def dollar_amounts(text: str) -> set[float]:
    return {float(amount.replace(",", "")) for amount in DOLLAR_RE.findall(text)}


def ungrounded_claims(message: str, deps: ShopDeps) -> list[str]:
    """Problems with a reply's prices and stock numbers, judged against this run's tool ledger.

    Every dollar figure must be a price a tool returned this turn (or one the shopper typed, like
    "under $70"); every "N left / N in stock" must be a count a tool returned this turn; and a
    size check_stock found sold out must be called sold out.
    """
    problems = []
    allowed_prices = deps.prices_seen | deps.shopper_amounts
    for amount in sorted(dollar_amounts(message) - allowed_prices):
        problems.append(
            f"You wrote ${amount:,.2f}, but no tool returned that price in this turn. "
            "Call get_price and quote its `display` value exactly; don't total or estimate prices."
        )
    for match in QUANTITY_RE.finditer(message):
        count = int(match.group(1) or match.group(2))
        if count not in deps.quantities_seen:
            problems.append(
                f'You wrote "{match.group(0)}", but no tool returned that stock count in this turn. '
                "Call check_stock and use its numbers; earlier messages may be out of date."
            )
    if deps.sold_out_checks and not SOLD_OUT_RE.search(message):
        problems.append(
            f"check_stock found {', '.join(deps.sold_out_checks)} SOLD OUT. Say clearly that it is sold out "
            "in that size, then offer the sizes that are in stock."
        )
    return problems


def ungrounded_showcase(reply: ShopReply, deps: ShopDeps) -> list[str]:
    """A page showcase may only hold products a search returned in this turn (the Scout's or the concierge's)."""
    if reply.showcase is None:
        return []
    if not reply.showcase.product_ids:
        if deps.scout_ids:
            return []  # the website shows the Scout's matches
        return ["Your showcase is empty and the Scout found nothing this turn. Ask the Scout first, or drop the showcase."]
    unsearched = [pid for pid in reply.showcase.product_ids if pid not in deps.searched_ids]
    if not unsearched:
        return []
    return [
        f"Your showcase lists {', '.join(unsearched)}, which no search returned in this turn. "
        "Ask the Scout and build the showcase only from its product_ids."
    ]


def ungrounded_suggestions(reply: ShopReply, deps: ShopDeps) -> list[str]:
    """Suggestion cards may only show products a recommender offered this turn."""
    unoffered = [pid for group in reply.suggestions for pid in group.product_ids if pid not in deps.recommended]
    if not unoffered:
        return []
    return [
        f"Your suggestions list {', '.join(unoffered)}, which no recommender offered in this turn. Use only "
        "check_stock's similar_in_size, find_similar, or the Stylist's / Scout's picks."
    ]


@concierge.output_validator
def check_reply_is_grounded(ctx: RunContext[ShopDeps], reply: ShopReply) -> ShopReply:
    """Send the reply back if it quotes an unchecked price or count, or shows cards no tool produced."""
    problems = (
        ungrounded_claims(reply.message, ctx.deps)
        + ungrounded_showcase(reply, ctx.deps)
        + ungrounded_suggestions(reply, ctx.deps)
    )
    if problems:
        raise ModelRetry("Fix your reply before sending it: " + " ".join(problems))
    return reply


# ---- Running a turn ----


def to_message_history(turns: list[ChatTurn]) -> list[ModelMessage]:
    """Plain-text turns as PydanticAI messages, oldest first."""
    history: list[ModelMessage] = []
    for turn in turns:
        if turn.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=turn.content)]))
        else:
            history.append(ModelResponse(parts=[TextPart(content=turn.content)]))
    return history


async def ask(message: str, history: list[ChatTurn], deps: ShopDeps) -> ShopReply:
    """Run the team on one shopper message and return the concierge's structured reply."""
    if not os.getenv("PORTKEY_API_KEY"):
        raise ChatUnavailable("PORTKEY_API_KEY is not set.")
    # Dollar figures the shopper typed ("under $70") may be repeated back.
    deps.shopper_amounts |= dollar_amounts(message)
    for turn in history:
        if turn.role == "user":
            deps.shopper_amounts |= dollar_amounts(turn.content)
    _emit(deps, "team", members=TEAM)
    _emit(deps, "status", agent="concierge", state="thinking")
    try:
        result = await concierge.run(
            [context_block(deps), message],
            message_history=to_message_history(history),
            deps=deps,
            usage_limits=CONCIERGE_LIMITS,
            model_settings=_settings(cache_key(deps), MAX_REPLY_TOKENS),
        )
    except (ModelHTTPError, ContentFilterError) as error:
        if provider_blocked(error):
            return CARE_REPLY if sounds_like_distress(message) else BLOCKED_REPLY
        raise
    finally:
        _emit(deps, "status", agent="concierge", state="done")
    _log_usage(deps, "concierge", CONCIERGE_MODEL, result)
    return result.output


# ---- Memory ----

_memory_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


async def update_memory(
    user_id: int, usage_log: list[ModelUsage] | None = None, turn: Turn | None = None
) -> MemoryNotes | None:
    """Fold a customer's newest messages into their memory notes (run in the background after a reply).

    `turn` is the chat turn that prompted it, so the clerk's loop lands in that turn's audit trail.
    `usage_log`, if given, gets the clerk's usage (the live chat doesn't pass one; a benchmark can).
    """
    async with _memory_locks[user_id]:
        notes, through = await asyncio.to_thread(load_memory, user_id)
        rows = await asyncio.to_thread(messages_since, user_id, through)
        if not rows:
            return notes
        transcript = "\n".join(f"{row['role']}: {row['content'][:600]}" for row in rows[-MAX_MEMORY_MESSAGES:])
        prompt = f"Current notes (JSON): {(notes or MemoryNotes()).model_dump_json()}\n\nNewest messages:\n{transcript}"
        try:
            result = await memory_clerk.run(
                prompt,
                deps=ShopDeps(agent_id="memory_clerk", audit=turn),
                usage_limits=MEMORY_LIMITS,
                model_settings=_settings("campus-customs:memory", MAX_TEAMMATE_REPLY_TOKENS),
            )
        finally:
            if turn is not None:
                await asyncio.to_thread(turn.flush)
        # Skipped if the shopper pressed Forget or Clear while the clerk was working.
        await asyncio.to_thread(save_memory, user_id, result.output, rows[-1]["id"], through)
        if usage_log is not None:
            usage = result.usage
            usage_log.append(
                ModelUsage(
                    agent="memory_clerk",
                    model=TEAM_MODEL,
                    requests=usage.requests,
                    input_tokens=usage.input_tokens,
                    cached_tokens=usage.cache_read_tokens,
                    output_tokens=usage.output_tokens,
                )
            )
        return result.output

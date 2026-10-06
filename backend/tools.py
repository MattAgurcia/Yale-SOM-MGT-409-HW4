"""Everything that reads the shop database, and the tools the agents call.

Sections of this file:
    The shop database   connections to data/campus_customs.db and load_products(), shared by
                        the API routes and the tools
    Shop categories     Shop by type, collections, affiliations and colour families, filled in
                        on every product as it loads (fixed rules, no model calls)
    Recommendations     similar styles and complete-the-look pairings (fixed rules, no model calls)
    Size & fit helper   the size_guide and fit_notes tables and recommend_size()
    The agents' tools   find_product, search_products, get_product_description, get_price,
                        check_stock, find_similar, outfit_candidates, size_advice

Every fact the agents state about a product comes from here, read live from the database.
Nothing in this file reads users, sessions or chat history.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections import Counter
from collections.abc import Sequence
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_ai import ModelRetry, RunContext

from models import (
    LOW_STOCK,
    SIZE_ORDER,
    PriceQuote,
    Product,
    ProductDescription,
    ProductMatch,
    Recommendation,
    SearchResults,
    ShopDeps,
    Size,
    SizeAdvice,
    SizeAdviceRequest,
    SizeAvailability,
    SizeChartRow,
    SizeFitCheck,
    SizeStock,
    StockCheck,
)


# ==================================================================================================
# The shop database: connections and product loading (data/campus_customs.db)
# ==================================================================================================
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DEFAULT_DB_PATH = DATA_DIR / "campus_customs.db"

# Added to image URLs so browsers refetch after the photo cleanup in main.py
# changes. Bump it whenever that cleanup changes.
IMAGE_VERSION = 3


def db_path() -> Path:
    # CAMPUS_CUSTOMS_DB points the app at another copy (e.g. a throwaway one for testing).
    return Path(os.environ.get("CAMPUS_CUSTOMS_DB") or DEFAULT_DB_PATH)


def connect(*, readonly: bool = True) -> sqlite3.Connection:
    """Open the shop database, read-only unless the caller needs to write.

    For writes, use `with closing(connect(readonly=False)) as conn, conn:` so the
    transaction commits on success and rolls back on an exception.
    """
    # mode=rw, not SQLite's default rwc: a missing data pack must fail, not become an empty database.
    uri = db_path().as_uri() + ("?mode=ro" if readonly else "?mode=rw")
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def load_products(product_ids: Sequence[str] | None = None) -> list[Product]:
    """Products with their per-size stock: all of them, or just `product_ids`.

    With ids, results come back in the order given and unknown ids are skipped.
    """
    if product_ids is not None and not product_ids:
        return []
    where, params = "", ()
    if product_ids is not None:
        where = f"WHERE product_id IN ({','.join('?' * len(product_ids))})"
        params = tuple(product_ids)

    with closing(connect()) as conn:
        rows = conn.execute(f"SELECT * FROM catalogue {where} ORDER BY name", params).fetchall()
        stock: dict[str, list[SizeStock]] = {}
        for r in conn.execute(f"SELECT product_id, size, quantity FROM inventory {where}", params):
            stock.setdefault(r["product_id"], []).append(SizeStock(size=r["size"], quantity=r["quantity"]))

    products = []
    for r in rows:
        sizes = sorted(stock.get(r["product_id"], []), key=lambda s: SIZE_ORDER.index(s.size))
        products.append(
            Product(
                product_id=r["product_id"],
                name=r["name"],
                garment_type=r["garment_type"],
                description=r["description"],
                colors=json.loads(r["colors"]),
                search_tags=json.loads(r["search_tags"]),
                image_file_path=r["image_file_path"],
                image_url=f"/media/{r['image_file_path']}?v={IMAGE_VERSION}",
                price=r["price"],
                inventory=sizes,
                total_stock=sum(s.quantity for s in sizes),
            )
        )

    if product_ids is not None:
        by_id = {p.product_id: p for p in products}
        products = [by_id[pid] for pid in dict.fromkeys(product_ids) if pid in by_id]
    return annotate(products)


# ==================================================================================================
# Shop categories: types, collections, affiliations, colour families (no model calls)
# ==================================================================================================
# What kind of garment each product is, and which collection it belongs to.
#
# Everything Campus Customs sells is a unisex top, so categories follow what the
# catalogue really holds rather than tops / bottoms / men / women:
#
#     Shop by type    hoodies, crewnecks, quarter-zips, tees & long sleeves,
#                     jackets & zip-ups (from garment_type)
#     Collections     residential colleges, varsity sports, graduate &
#                     professional schools, the whole family, and Yale classics
#                     for everything else (from the product's name and tags)
#
# Each product also gets its garment colour family for the colour filter. All of
# it is derived from catalogue data by fixed rules: no model calls.

TYPES = [
    {"slug": "hoodies", "name": "Hoodies", "blurb": "Pullover hoodies with a kangaroo pocket and drawstring hood."},
    {"slug": "crewnecks", "name": "Crewnecks", "blurb": "Classic crew sweatshirts, from left-chest logos to big arched YALE."},
    {"slug": "quarter-zips", "name": "Quarter-zips", "blurb": "Polished pullovers with a stand collar, great over a tee."},
    {"slug": "tees", "name": "Tees & long sleeves", "blurb": "Soft tees and performance long sleeves for every day."},
    {"slug": "jackets", "name": "Jackets & zip-ups", "blurb": "Fleece jackets, full-zip hoodies and a bomber to layer on top."},
]

COLLECTIONS = [
    {"slug": "colleges", "name": "Residential colleges", "blurb": "Crests from Morse to Grace Hopper, for the college you call home."},
    {"slug": "sports", "name": "Varsity sports", "blurb": "Hockey, sailing, fencing and more. Gear that cheers as loud as you do."},
    {"slug": "schools", "name": "Graduate & professional schools", "blurb": "Law, Art, Architecture, Music, Medicine and more."},
    {"slug": "family", "name": "The whole family", "blurb": "Yale Mom, Dad, Grandpa, Aunt… pride runs in the family."},
    {"slug": "classics", "name": "Yale classics", "blurb": "Big YALE, vintage bulldogs and The Game: pure school spirit."},
]

COLOURS = [
    {"slug": "navy", "name": "Navy"},
    {"slug": "gray", "name": "Heather gray"},
    {"slug": "charcoal", "name": "Charcoal"},
    {"slug": "cream", "name": "Cream & white"},
    {"slug": "coral", "name": "Coral"},
]

# Affiliation keywords per collection, matched against the product's name and
# tags as whole words. Each maps to the label shown to shoppers.
COLLEGES = {
    "benjamin franklin": "Benjamin Franklin", "berkeley": "Berkeley", "branford": "Branford",
    "davenport": "Davenport", "ezra stiles": "Ezra Stiles", "grace hopper": "Grace Hopper",
    "jonathan edwards": "Jonathan Edwards", "morse": "Morse", "pauli murray": "Pauli Murray",
    "pierson": "Pierson", "saybrook": "Saybrook", "silliman": "Silliman", "timothy dwight": "Timothy Dwight",
    "trumbull": "Trumbull",
}
SPORTS = {
    "baseball": "Baseball", "basketball": "Basketball", "football": "Football", "field hockey": "Field hockey",
    "ice hockey": "Hockey", "hockey": "Hockey", "soccer": "Soccer", "tennis": "Tennis", "track": "Track & field",
    "diving": "Diving", "swimming": "Swimming", "golf": "Golf", "volleyball": "Volleyball", "lacrosse": "Lacrosse",
    "fencing": "Fencing", "sailing": "Sailing", "squash": "Squash", "crew": "Crew", "the game": "Football",
}
SCHOOLS = {
    "law school": "Law", "school of art": "Art", "architecture": "Architecture", "school of music": "Music",
    "engineering": "Engineering", "public health": "Public Health", "medicine": "Medicine", "medical": "Medicine",
    "nursing": "Nursing", "management": "Management", "divinity": "Divinity", "forest school": "Forest School",
    "drama": "Drama",
}
FAMILY = {
    "mom": "Mom", "dad": "Dad", "grandma": "Grandma", "grandpa": "Grandpa", "brother": "Brother",
    "sister": "Sister", "aunt": "Aunt", "uncle": "Uncle", "cousin": "Cousin",
}
AFFILIATIONS = [("colleges", COLLEGES), ("sports", SPORTS), ("schools", SCHOOLS), ("family", FAMILY)]

# For the shop's colour filter, white counts as "Cream & white" (see COLOURS). The recommender
# keeps white separate for pairings (PAIRING_COLOUR_PHRASES, below).
COLOUR_PHRASES = [
    ("dark heather charcoal", "charcoal"), ("dark heather gray", "charcoal"), ("charcoal gray", "charcoal"),
    ("charcoal", "charcoal"), ("navy blue heathered", "navy"), ("navy blue", "navy"), ("dark navy", "navy"),
    ("navy", "navy"), ("light heather gray", "gray"), ("light gray heathered", "gray"), ("light gray", "gray"),
    ("heather gray", "gray"), ("gray", "gray"), ("grey", "gray"), ("classic cream", "cream"), ("cream", "cream"),
    ("ivory", "cream"), ("white", "cream"), ("dusty coral", "coral"), ("coral", "coral"), ("black", "black"),
]


def garment_type_slug(product: Product) -> str:
    kind = product.garment_type.lower()
    if "jacket" in kind or "full-zip" in kind:
        return "jackets"
    if "quarter-zip" in kind:
        return "quarter-zips"
    if "hood" in kind:
        return "hoodies"
    if "t-shirt" in kind or "performance" in kind:
        return "tees"
    return "crewnecks"  # crewneck, raglan and mockneck sweatshirts


def colour_family(product: Product) -> str | None:
    """The garment's own colour (not its print), from the start of the description; None if unknown."""
    opening = product.description.lower()[:40]
    for phrase, colour_group in COLOUR_PHRASES:
        if opening.startswith(phrase):
            return colour_group
    for colour in product.colors:
        for phrase, colour_group in COLOUR_PHRASES:
            if phrase in colour.lower():
                return colour_group
    return None


def _text(product: Product) -> str:
    # The name and tags, without "crewneck" / "raglan crew" (so "crew" means rowing) or brand names.
    text = " ".join([product.name, *product.search_tags]).lower().replace("-", " ").replace("&", " ")
    text = re.sub(r"\bcrewnecks?\b|\bcrew neck\b|\braglan crew\b|under armour", " ", text)
    return f" {re.sub(r'[^a-z0-9 ]+', ' ', text)} "


def affiliations(product: Product) -> list[tuple[str, str]]:
    """(collection slug, label) pairs, e.g. [("colleges", "Morse")] or [("sports", "Squash"), ("sports", "Tennis")]."""
    text, found = _text(product), []
    for collection, keywords in AFFILIATIONS:
        labels = []
        for keyword, label in keywords.items():
            if f" {keyword} " in text and label not in labels:
                labels.append(label)
        found.extend((collection, label) for label in labels)
    # "Field hockey" is not also ice hockey.
    if ("sports", "Field hockey") in found and " ice hockey " not in text:
        found = [pair for pair in found if pair != ("sports", "Hockey")]
    return found


def annotate(products: list[Product]) -> list[Product]:
    """Fill in category, collections, affiliations and colour_family on each product (in place)."""
    for product in products:
        found = affiliations(product)
        product.category = garment_type_slug(product)
        product.collections = list(dict.fromkeys(slug for slug, _ in found)) or ["classics"]
        product.affiliations = [label for _, label in found]
        product.color_family = colour_family(product)
    return products


# ==================================================================================================
# Recommendations: similar styles and complete-the-look pairings (no model calls)
# ==================================================================================================
# Every product is read for four traits, all from catalogue data:
#     colour   the garment's own colour family (navy, gray, charcoal, cream,
#              white, coral), from the start of its description
#     layer    base (tees, long sleeves), mid (crewnecks, hoodies, quarter-zips)
#              or outer (jackets, fleece, full-zip hoodies)
#     weight   how loud the graphic is: "statement" (large, across the chest,
#              arched) or "subtle" (small, left chest)
#     themes   distinctive words it shares with few other products: a college,
#              sport, school or family role ("morse", "hockey", "mom")
#
# similar_products()   same kind of garment, same colour family and themes, in
#                      stock (in the shopper's size when one is given). For
#                      "sold out in XS" and "you don't have pink?".
# complete_the_look()  pieces from the other layers that coordinate: classic
#                      colour pairings, a quiet piece next to a loud one, a
#                      matching college or team (and never two different ones).
#                      Also in stock.
#
# Both return a reason a shopper can read, built from the same rules.

# Colour phrases, longest first, grouped into families.
# The same phrases as COLOUR_PHRASES (above), except that white stays its own family here,
# because navy-and-white and navy-and-cream pair differently.
PAIRING_COLOUR_PHRASES = [
    ("dark heather charcoal", "charcoal"),
    ("dark heather gray", "charcoal"),
    ("charcoal gray", "charcoal"),
    ("charcoal", "charcoal"),
    ("navy blue heathered", "navy"),
    ("navy blue", "navy"),
    ("dark navy", "navy"),
    ("navy", "navy"),
    ("light heather gray", "gray"),
    ("light gray heathered", "gray"),
    ("light gray", "gray"),
    ("heather gray", "gray"),
    ("gray", "gray"),
    ("grey", "gray"),
    ("classic cream", "cream"),
    ("cream", "cream"),
    ("ivory", "cream"),
    ("white", "white"),
    ("dusty coral", "coral"),
    ("coral", "coral"),
    ("black", "black"),
]
COLOUR_NAMES = {
    "navy": "navy",
    "gray": "heather gray",
    "charcoal": "charcoal",
    "cream": "cream",
    "white": "white",
    "coral": "dusty coral",
    "black": "black",
}

# How well two colour families sit together in one outfit (0 = avoid, 3 = classic).
HARMONY = {
    frozenset({"navy", "gray"}): 3,
    frozenset({"navy", "white"}): 3,
    frozenset({"navy", "cream"}): 3,
    frozenset({"charcoal", "white"}): 3,
    frozenset({"navy", "charcoal"}): 2,
    frozenset({"gray", "white"}): 2,
    frozenset({"gray", "charcoal"}): 2,
    frozenset({"charcoal", "cream"}): 2,
    frozenset({"gray", "cream"}): 2,
    frozenset({"coral", "navy"}): 2,
    frozenset({"coral", "white"}): 2,
    frozenset({"coral", "gray"}): 2,
    frozenset({"navy"}): 1,  # tonal navy-on-navy: fine, not exciting
    frozenset({"gray"}): 1,
    frozenset({"charcoal"}): 1,
    frozenset({"black", "white"}): 3,
    frozenset({"black", "gray"}): 2,
}
HARMONY_REASONS = {
    frozenset({"navy", "gray"}): "navy and heather gray is the classic Yale pairing",
    frozenset({"navy", "white"}): "crisp white keeps navy sharp",
    frozenset({"navy", "cream"}): "cream softens navy for a vintage feel",
    frozenset({"charcoal", "white"}): "white pops against charcoal",
    frozenset({"navy", "charcoal"}): "two deep tones for an understated look",
    frozenset({"gray", "white"}): "light, easy neutrals",
    frozenset({"gray", "charcoal"}): "light and dark gray for a tonal layer",
    frozenset({"charcoal", "cream"}): "cream warms up charcoal",
    frozenset({"gray", "cream"}): "soft neutrals that layer easily",
    frozenset({"coral", "navy"}): "navy grounds the coral",
    frozenset({"coral", "white"}): "white keeps the coral fresh",
    frozenset({"coral", "gray"}): "gray calms the coral",
    frozenset({"navy"}): "tonal navy for a matched look",
    frozenset({"gray"}): "head-to-toe heather gray, campus-casual",
    frozenset({"charcoal"}): "tonal charcoal, low-key",
}

LAYER_PAIRINGS = {
    "base": [("mid", "Layer over"), ("outer", "Top it with")],
    "mid": [("base", "Wear under"), ("outer", "Layer over")],
    "outer": [("base", "Wear under"), ("mid", "Layer under")],
}

STATEMENT_WORDS = ("large", "across the chest", "across the front", "arched", "oversized", "big ")
SUBTLE_WORDS = ("left chest", "left-chest", "small")

# Words too common to say two items "match" (every product is Yale apparel).
GENERIC_WORDS = {
    "yale", "campus", "customs", "college", "apparel", "merch", "sweatshirt", "hoodie", "hooded", "crewneck",
    "shirt", "tee", "sleeve", "long", "short", "pullover", "zip", "quarter", "full", "jacket", "fleece", "logo",
    "chest", "left", "graphic", "navy", "gray", "heather", "white", "blue", "cream", "charcoal", "classic",
    "university", "wordmark", "lettering", "print", "sports", "sport", "team", "athletic", "the", "and", "with",
    "for", "ivy", "league", "pocket", "kangaroo", "drawstring", "vintage", "crest", "school", "tri", "blend",
    "hood", "men", "mens", "women", "neck", "crew", "block", "big", "arched", "collegiate", "embroidered",
    "double", "knit", "heavyweight", "performance", "reverse", "weave", "premium", "soft", "cotton", "style",
    "text", "trim", "sweater", "spirit", "stub", "filename", "based", "photo", "product", "unisex", "casual",
    # Brands: a Champion hoodie and a Morse tee aren't rival affiliations.
    "champion", "district", "vit", "brooks", "brothers", "under", "armour", "hype", "vice", "maplehouse", "diana",
    "mockneck", "dry", "zone", "tech",
}

# Outfit scoring. A matching college / team is worth a lot; two different
# ones in one outfit is a styling miss, so those pairs are never suggested.
THEME_MATCH_BONUS = 3.0
MIN_LOOK_SCORE = 3.0


def garment_colour(product: Product) -> str:
    """The colour family of the garment itself (not its print), or "unknown"."""
    opening = product.description.lower()[:60]
    for phrase, colour_group in PAIRING_COLOUR_PHRASES:
        if opening.startswith(phrase) or f" {phrase} " in f" {opening.split(' with ')[0]} "[:40]:
            return colour_group
    for colour in product.colors:
        for phrase, colour_group in PAIRING_COLOUR_PHRASES:
            if phrase in colour.lower():
                return colour_group
    return "unknown"


def layer(product: Product) -> str:
    kind = product.garment_type.lower()
    if "jacket" in kind or "full-zip" in kind:
        return "outer"
    if "t-shirt" in kind or "performance shirt" in kind:
        return "base"
    return "mid"


def family(product: Product) -> str:
    """A shopper's word for the garment: hoodie, crewneck, tee, quarter-zip..."""
    kind = product.garment_type.lower()
    for needle, name in (
        ("fleece", "fleece jacket"),
        ("bomber", "jacket"),
        ("full-zip hooded", "zip hoodie"),
        ("hood", "hoodie"),
        ("quarter-zip", "quarter-zip"),
        ("mockneck", "mockneck"),
        ("crewneck", "crewneck"),
        ("performance", "long sleeve"),
        ("t-shirt", "tee"),
        ("jacket", "jacket"),
    ):
        if needle in kind:
            return name
    return kind


def weight(product: Product) -> str:
    # A big front graphic decides it, even if a small logo sits on the sleeve too.
    text = product.description.lower()
    if any(word in text for word in STATEMENT_WORDS):
        return "statement"
    if any(word in text for word in SUBTLE_WORDS):
        return "subtle"
    return "medium"


def _words(product: Product) -> set[str]:
    text = " ".join([product.name, *product.search_tags]).lower()
    return {w for w in re.findall(r"[a-z]+", text) if len(w) >= 3 and w not in GENERIC_WORDS}


@lru_cache(maxsize=1)
def _theme_vocabulary() -> frozenset[str]:
    """Words on at most 12 products: colleges, sports, schools, family roles, brands.

    Words on one product count too: "Law" or "Divinity" is still an affiliation.
    """
    counts = Counter(word for product in load_products() for word in _words(product))
    return frozenset(word for word, n in counts.items() if n <= 12)


def themes(product: Product) -> set[str]:
    return _words(product) & _theme_vocabulary()


def _in_stock(product: Product, size: str | None) -> bool:
    if size:
        return any(row.size == size and row.quantity > 0 for row in product.inventory)
    return product.total_stock > 0


def _colour_phrase(product: Product) -> str:
    return COLOUR_NAMES.get(garment_colour(product), "")


def similar_products(product: Product, size: str | None = None, limit: int = 4) -> list[Recommendation]:
    """Close substitutes for `product`, in stock (in `size` if given), best first."""
    colour, kind, my_themes = garment_colour(product), family(product), themes(product)
    scored = []
    for other in load_products():
        if other.product_id == product.product_id or not _in_stock(other, size):
            continue
        score, reasons = 0.0, []
        if family(other) == kind:
            score += 4
            reasons.append(f"Also a {kind}")
        elif layer(other) == layer(product):
            score += 2
            reasons.append(f"A {family(other)} instead")
        else:
            continue  # a tee isn't a substitute for a hoodie
        other_colour = garment_colour(other)
        if other_colour == colour and colour != "unknown":
            score += 2
            reasons.append(f"in {_colour_phrase(other)}")
        elif other_colour != "unknown":
            reasons.append(f"in {_colour_phrase(other)}")
        shared = themes(other) & my_themes
        if shared:
            score += min(3, 1.5 * len(shared))
            reasons.append("same " + " / ".join(sorted(w.title() for w in shared)))
        if abs(other.price - product.price) <= 10:
            score += 1
        if weight(other) == weight(product):
            score += 1.5  # same look: small left-chest logo vs. big front graphic
        if size:
            reasons.append(f"in stock in {size}")
        scored.append((score, other.total_stock, other, reasons))
    scored.sort(key=lambda entry: (-entry[0], -entry[1], entry[2].name))
    return [
        Recommendation(product_id=p.product_id, name=p.name, role="Similar style", reason=_sentence(reasons))
        for _, _, p, reasons in scored[:limit]
    ]


def complete_the_look(product: Product, size: str | None = None, limit: int = 3) -> list[Recommendation]:
    """Pieces from the other layers that coordinate with `product`, best first."""
    colour, my_weight, my_themes = garment_colour(product), weight(product), themes(product)
    picks: list[tuple[float, Product, str, list[str]]] = []
    for target_layer, role in LAYER_PAIRINGS[layer(product)]:
        candidates = []
        for other in load_products():
            if other.product_id == product.product_id or layer(other) != target_layer:
                continue
            if not _in_stock(other, size):
                continue
            other_colour = garment_colour(other)
            pair = frozenset({colour, other_colour})
            harmony = HARMONY.get(pair, 0)
            if harmony == 0 or "unknown" in pair:
                continue  # no clashing or unknown colours in an outfit
            score = harmony * 2.0
            reasons = [f"{_colour_phrase(other).capitalize()} {family(other)}"]
            reasons.append(HARMONY_REASONS.get(pair, "colours that sit well together"))
            other_weight = weight(other)
            if my_weight == "statement" and other_weight == "subtle":
                score += 1.5
                reasons.append(f"its small logo lets your {family(product)}'s big graphic lead")
            elif my_weight == "subtle" and other_weight == "statement":
                score += 1.0
                reasons.append("its bold front graphic balances your small logo")
            elif my_weight == other_weight == "statement":
                score -= 1.5  # two loud graphics fight each other
            other_themes = themes(other)
            shared = other_themes & my_themes
            if shared:
                score += THEME_MATCH_BONUS
                reasons.append("matching " + " / ".join(sorted(w.title() for w in shared)) + " for a set")
            elif other_themes and my_themes:
                continue  # two different colleges / teams / schools in one outfit
            if score >= MIN_LOOK_SCORE:
                candidates.append((score, other.total_stock, other, reasons))
        candidates.sort(key=lambda entry: (-entry[0], -entry[1], entry[2].name))
        picks.extend((score, other, role, reasons) for score, _, other, reasons in candidates[:2])

    # One per role first, then the next best overall, so the look has variety.
    by_role: dict[str, list] = {}
    for pick in picks:
        by_role.setdefault(pick[2], []).append(pick)
    ordered = [options[0] for options in by_role.values()]
    ordered.sort(key=lambda pick: -pick[0])
    rest = sorted((p for options in by_role.values() for p in options[1:]), key=lambda pick: -pick[0])
    chosen = (ordered + rest)[:limit]
    # If a matching set exists (same college, team or family role), always offer it.
    matched = [p for p in picks if themes(p[1]) & my_themes]
    if matched and not any(p in matched for p in chosen):
        chosen = chosen[: limit - 1] + [max(matched, key=lambda pick: pick[0])]
    return [
        Recommendation(product_id=p.product_id, name=p.name, role=role, reason=_sentence(reasons))
        for _, p, role, reasons in chosen
    ]


def _sentence(parts: list[str]) -> str:
    if not parts:
        return ""
    text = parts[0] + (": " + ", ".join(parts[1:]) if len(parts) > 1 else "")
    return text[0].upper() + text[1:] + "."


# ==================================================================================================
# Size & fit helper: the size_guide and fit_notes tables
# ==================================================================================================
# A size from height, weight (and chest, if known), from two database tables.
#
# Two small tables, created and filled on startup if empty:
#
#     size_guide   one row per size: the body chest, height and weight it fits.
#                  A standard unisex adult chart for the tops Campus Customs sells.
#     fit_notes    one row per garment type: how it fits, and how much that should
#                  nudge the size ("bias", in sizes; +0.4 = lean a size up).
#
# recommend_size() places the shopper on the chart (chest first if they gave it,
# otherwise weight weighted over height), nudges for the garment and the fit they
# like, and says when they're between two sizes. With a product it also reports
# live stock in the recommended and alternative sizes.

# size, chest min/max (in), height min/max (in), weight min/max (lb)
SIZE_GUIDE = [
    ("XS", 31, 34, 60, 65, 100, 128),
    ("S", 34, 37, 64, 68, 125, 150),
    ("M", 38, 41, 67, 71, 145, 175),
    ("L", 42, 45, 70, 73, 170, 200),
    ("XL", 46, 49, 72, 75, 195, 230),
    ("XXL", 50, 53, 74, 78, 225, 265),
]

# garment type, how it fits, bias in sizes
FIT_NOTES = [
    ("hoodies", "Relaxed fit with room to layer underneath.", 0.0),
    ("crewnecks", "Classic sweatshirt fit; true to size.", 0.0),
    ("quarter-zips", "Classic fit, a little trimmer through the body than a hoodie.", 0.15),
    ("tees", "Standard tee fit; tri-blends sit a touch closer to the body.", 0.1),
    ("jackets", "Cut to layer over a tee or crewneck; take your usual size.", 0.0),
]
FIT_PREFERENCE = {"snug": -0.45, "regular": 0.0, "relaxed": 0.45}


def ensure_size_schema() -> None:
    with closing(connect(readonly=False)) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS size_guide (
                size TEXT PRIMARY KEY,
                chest_min REAL NOT NULL, chest_max REAL NOT NULL,
                height_min REAL NOT NULL, height_max REAL NOT NULL,
                weight_min REAL NOT NULL, weight_max REAL NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fit_notes (category TEXT PRIMARY KEY, note TEXT NOT NULL, bias REAL NOT NULL)"
        )
        if conn.execute("SELECT COUNT(*) FROM size_guide").fetchone()[0] == 0:
            conn.executemany("INSERT INTO size_guide VALUES (?, ?, ?, ?, ?, ?, ?)", SIZE_GUIDE)
        if conn.execute("SELECT COUNT(*) FROM fit_notes").fetchone()[0] == 0:
            conn.executemany("INSERT INTO fit_notes VALUES (?, ?, ?)", FIT_NOTES)


def _feet(inches: float) -> str:
    return f"{int(inches // 12)}'{int(round(inches % 12))}\""


def describe(request: SizeAdviceRequest) -> str:
    """The measurements in a few words, for the chat's live view: 5'10", 170 lb, regular fit."""
    chest = f", {request.chest_in:g}\" chest" if request.chest_in else ""
    return f"{_feet(request.height_in)}, {request.weight_lb:g} lb{chest}, {request.fit} fit"


def _position(value: float, ranges: list[tuple[float, float]]) -> float:
    """Where a measurement sits on the chart: 0 = XS centre, 1 = S centre, ... interpolated, clamped."""
    centres = [(lo + hi) / 2 for lo, hi in ranges]
    if value <= centres[0]:
        return max(-0.6, (value - centres[0]) / (centres[1] - centres[0]))
    for i in range(len(centres) - 1):
        if value <= centres[i + 1]:
            return i + (value - centres[i]) / (centres[i + 1] - centres[i])
    last = len(centres) - 1
    return min(last + 0.6, last + (value - centres[last]) / (centres[last] - centres[last - 1]))


def recommend_size(request: SizeAdviceRequest) -> SizeAdvice:
    with closing(connect()) as conn:
        rows = conn.execute("SELECT * FROM size_guide").fetchall()
        rows = sorted(rows, key=lambda r: SIZE_ORDER.index(r["size"]))
        notes = {r["category"]: (r["note"], r["bias"]) for r in conn.execute("SELECT * FROM fit_notes")}

    weight_pos = _position(request.weight_lb, [(r["weight_min"], r["weight_max"]) for r in rows])
    height_pos = _position(request.height_in, [(r["height_min"], r["height_max"]) for r in rows])
    if request.chest_in:
        chest_pos = _position(request.chest_in, [(r["chest_min"], r["chest_max"]) for r in rows])
        body = 0.6 * chest_pos + 0.25 * weight_pos + 0.15 * height_pos
        basis = f"your {request.chest_in:g}\" chest"
    else:
        body = 0.65 * weight_pos + 0.35 * height_pos
        basis = f"your height ({_feet(request.height_in)}) and weight ({request.weight_lb:g} lb)"

    product, fit_note, bias = None, None, 0.0
    if request.product_id:
        found = load_products([request.product_id])
        if found:
            product = found[0]
            fit_note, bias = notes.get(garment_type_slug(product), (None, 0.0))

    position = body + bias + FIT_PREFERENCE[request.fit]
    index = min(len(rows) - 1, max(0, round(position)))
    size = rows[index]["size"]
    fraction = position - round(position)
    between = abs(fraction) >= 0.3 and 0 <= index + (1 if fraction > 0 else -1) < len(rows)
    alternative = rows[index + (1 if fraction > 0 else -1)]["size"] if between else None

    explanation = f"Based on {basis}, {size} is your best match on our size chart."
    if request.fit != "regular":
        explanation += f" We leaned {'up' if request.fit == 'relaxed' else 'down'} for the {request.fit} fit you like."
    if between:
        roomier = alternative if SIZE_ORDER.index(alternative) > index else size
        explanation += f" You're between {min(size, alternative, key=SIZE_ORDER.index)} and " \
                       f"{max(size, alternative, key=SIZE_ORDER.index)}: pick {roomier} for a roomier fit."

    advice = SizeAdvice(
        size=size,
        alternative=alternative,
        between_sizes=between,
        explanation=explanation,
        fit_note=fit_note,
        chart=[
            SizeChartRow(
                size=r["size"],
                chest_in=f"{r['chest_min']:g}–{r['chest_max']:g}",
                height=f"{_feet(r['height_min'])}–{_feet(r['height_max'])}",
                weight_lb=f"{r['weight_min']:g}–{r['weight_max']:g}",
            )
            for r in rows
        ],
    )
    if product:
        stock = {row.size: row.quantity for row in product.inventory}
        advice.product_name = product.name
        advice.quantity = stock.get(size, 0)
        advice.in_stock = advice.quantity > 0
        advice.alternative_quantity = stock.get(alternative) if alternative else None
    return advice


# ==================================================================================================
# The agents' tools
# ==================================================================================================
# Each agent gets only its own tools (see agent.py):
#
#     find_product             quick lookup of one item by name (the concierge)
#     search_products          find products by keyword, price and size (the Scout)
#     get_product_description  what an item is and what's printed on it
#     get_price                the price to quote
#     check_stock              live stock, per size when asked; alternatives if sold out
#     find_similar             close alternatives in stock (Recommendations, above)
#     outfit_candidates        pieces that pair with an item (Recommendations, the Stylist)
#     size_advice              a size from height / weight / chest, with fit and stock (Size & fit)
#
# Every fact the agent states about a product comes from one of these, read live
# from data/campus_customs.db. Each tool also writes the prices and stock counts
# it returned into the run's ShopDeps ledger, so agent.py can reject a reply that
# quotes a number no tool produced, and posts a one-line note to the chat's live
# view (`_note`). The tools are read-only and only read the catalogue, inventory,
# size_guide and fit_notes tables; nothing here can reach users, sessions or chat history.

MAX_RESULTS = 30  # matches models.MAX_SHOWCASE, so a browse search can fill the page

# Words that carry no signal in a catalogue where everything is Yale apparel.
STOPWORDS = {
    "a", "an", "and", "any", "anything", "are", "do", "for", "from", "have", "i", "in", "is", "it",
    "me", "my", "of", "on", "or", "show", "some", "something", "that", "the", "to", "want", "with",
    "you", "your", "yale", "campus", "customs", "merch", "gear", "item", "items", "apparel",
    # Price, size and stock words: those go in the max_price / size filters instead.
    "under", "below", "less", "than", "cheap", "cheaper", "price", "priced", "dollar", "dollars",
    "size", "sizes", "stock", "available", "color", "colour", "colors", "colours",
}

# Shopper words mapped to the words the catalogue actually uses.
SYNONYMS = {
    "tee": "t shirt",
    "tshirt": "t shirt",
    "hoody": "hoodie",
    "hood": "hoodie",
    "sweater": "sweat",
    "crew": "crewneck",
    "grey": "gray",
    "quarterzip": "quarter zip",
    "zipper": "zip",
    "fleece": "fleece",
    "mother": "mom",
    "father": "dad",
    "grandmother": "grandma",
    "grandfather": "grandpa",
    "bulldog": "bulldog",
    "harvard": "harvard",
}

# Where a word matches matters: a hit in the name beats one in the description.
FIELD_WEIGHTS = (("name", 3.0), ("garment_type", 3.0), ("search_tags", 2.0), ("colors", 2.0), ("description", 1.0))


def _terms(query: str) -> list[str]:
    terms = []
    for word in re.findall(r"[a-z0-9]+", query.lower().replace("t-shirt", "tshirt").replace("1/4", "quarter")):
        if word in STOPWORDS or len(word) < 2:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]  # hoodies -> hoodie, colleges -> college
        terms.append(SYNONYMS.get(word, word))
    return terms


def _fields(product: Product) -> dict[str, str]:
    # Hyphens become spaces so "t-shirt", "T Shirt" and "quarter-zip" all match.
    texts = {
        "name": product.name,
        "garment_type": product.garment_type,
        "search_tags": " ".join(product.search_tags),
        "colors": " ".join(product.colors),
        "description": product.description,
    }
    return {field: text.lower().replace("-", " ") for field, text in texts.items()}


def _score(product: Product, patterns: dict[str, re.Pattern[str]]) -> tuple[int, float, set[str]]:
    """(terms matched, weighted score, which terms) for one product.

    Terms match at the start of a word, so "shirt" finds "T Shirt" but not "sweatshirt".
    """
    fields = _fields(product)
    matched, score = set(), 0.0
    for term, pattern in patterns.items():
        hits = [field_weight for field, field_weight in FIELD_WEIGHTS if pattern.search(fields[field])]
        if hits:
            matched.add(term)
            score += max(hits)
    return len(matched), score, matched


def _note(ctx: RunContext[ShopDeps], tool: str, summary: str) -> None:
    """Tell the chat's live view what this team member just did (no-op outside a stream)."""
    events = getattr(ctx.deps, "events", None)
    if events is not None:
        events.emit("tool", agent=ctx.deps.agent_id, tool=tool, summary=summary)


def _offer(ctx: RunContext[ShopDeps], recs: list[Recommendation]) -> list[Recommendation]:
    """Record recommendations in the ledger: only these may appear as suggestion cards."""
    for rec in recs:
        ctx.deps.recommended.setdefault(rec.product_id, rec)
    return recs


class _Quiet:
    """Wraps a RunContext so a tool reused inside another doesn't post its own note."""

    quiet = True

    def __init__(self, ctx: RunContext[ShopDeps]) -> None:
        self.deps = ctx.deps


def _match(product: Product) -> ProductMatch:
    return ProductMatch(
        product_id=product.product_id,
        name=product.name,
        garment_type=product.garment_type,
        description=product.description,
        price=product.price,
        colors=product.colors,
        sizes_in_stock=[row.size for row in product.inventory if row.quantity > 0],
        total_stock=product.total_stock,
    )


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _resolve(product_id: str) -> Product:
    """The product for an id, or failing that for its exact name ("Yale Mom Crewneck")."""
    found = load_products([product_id]) or load_products([_slug(product_id)])
    if not found:
        found = [p for p in load_products() if p.name.lower() == product_id.strip().lower()]
    if not found:
        raise ModelRetry(
            f"No product matches {product_id!r}. Look it up first to get its product_id: "
            "find_product if you're Dan, search_products if you're the Scout."
        )
    return found[0]


# Shopper ways of writing a size, mapped to the catalogue's six sizes.
SIZE_ALIASES = {
    "xs": "XS", "xsmall": "XS", "extrasmall": "XS",
    "s": "S", "small": "S", "sm": "S",
    "m": "M", "medium": "M", "med": "M",
    "l": "L", "large": "L", "lg": "L",
    "xl": "XL", "xlarge": "XL", "extralarge": "XL",
    "xxl": "XXL", "2xl": "XXL", "2x": "XXL", "xxlarge": "XXL", "2xlarge": "XXL",
}


def normalise_size(size: str) -> str:
    """'medium' -> 'M', '2XL' -> 'XXL'. Anything unrecognised comes back upper-cased as asked."""
    key = re.sub(r"[^a-z0-9]", "", size.lower())
    return SIZE_ALIASES.get(key, size.strip().upper())


def _availability(size: str, quantity: int) -> SizeAvailability:
    status = "sold out" if quantity == 0 else "low stock" if quantity <= LOW_STOCK else "in stock"
    return SizeAvailability(size=size, quantity=quantity, status=status)


def _sizes_with_counts(rows: list[SizeAvailability]) -> str:
    return ", ".join(f"{row.size} ({row.quantity})" for row in rows)


def _stock_summary(name: str, asked: str | None, requested: SizeAvailability | None, rows: list[SizeAvailability]) -> str:
    in_stock = [row for row in rows if row.quantity > 0]
    sold_out = [row.size for row in rows if row.quantity == 0]
    elsewhere = f"In stock: {_sizes_with_counts(in_stock)}." if in_stock else "It is sold out in every size."
    if asked and requested is None:
        return f"{name} doesn't come in {asked}; sizes run XS to XXL. {elsewhere}"
    if requested and requested.status == "sold out":
        return f"{name} is SOLD OUT in {requested.size}. {elsewhere}"
    if requested and requested.status == "low stock":
        return f"{name}: only {requested.quantity} left in {requested.size}."
    if requested:
        return f"{name}: {requested.quantity} in stock in {requested.size}."
    if not in_stock:
        return f"{name} is SOLD OUT in every size."
    sold_note = f" Sold out in {', '.join(sold_out)}." if sold_out else " Every size is in stock."
    return f"{name}: {sum(r.quantity for r in in_stock)} in stock. {elsewhere}{sold_note}"


def search_products(
    ctx: RunContext[ShopDeps],
    query: str,
    max_price: float | None = None,
    size: Size | None = None,
    limit: int = 6,
) -> SearchResults:
    """Search the Campus Customs catalogue. Use this before naming, pricing or recommending any product.

    Matching is by keyword over each product's name, garment type, colours, tags and description.
    Products matching the most keywords come back first; `unmatched_terms` lists keywords that no
    product matched at all (e.g. "pink" when nothing is pink), which means the shop doesn't carry
    that. Keep queries short: one to three words such as "navy hoodie", "morse", "hockey", "dad",
    "quarter zip", "vintage bulldog". Put price limits and sizes in the filters, not the query.
    Pass an empty query to browse using only the filters. Results include each product's price
    and which sizes are in stock; for exact counts in a size, call check_stock.

    When the shopper is browsing a kind of item ("what hoodies do you have?"), use limit=30 so
    every match can go into the page showcase.

    Args:
        query: Keywords for what the shopper wants.
        max_price: Only include products at or below this price in US dollars.
        size: Only include products with at least one unit in stock in this size.
        limit: Maximum number of products to return (1-30).
    """
    patterns = {term: re.compile(r"\b" + re.escape(term)) for term in dict.fromkeys(_terms(query))}
    scored, matched_anywhere = [], set()
    for product in load_products():
        if max_price is not None and product.price > max_price:
            continue
        if size is not None and not any(row.size == size and row.quantity > 0 for row in product.inventory):
            continue
        count, score, matched = _score(product, patterns) if patterns else (0, 0.0, set())
        matched_anywhere |= matched
        if count or not patterns:
            scored.append((count, score, product))

    # Keep only the products that match the most terms, so "navy hoodie" returns
    # navy hoodies rather than every navy item and every hoodie.
    best = max((count for count, _, _ in scored), default=0)
    scored = [entry for entry in scored if entry[0] == best]
    # Best match first; among equals, more stock first, then name.
    scored.sort(key=lambda entry: (-entry[1], -entry[2].total_stock, entry[2].name))
    limit = max(1, min(limit, MAX_RESULTS))
    matches = [_match(product) for _, _, product in scored[:limit]]
    for match in matches:
        ctx.deps.prices_seen.add(match.price)
        ctx.deps.quantities_seen.add(match.total_stock)
        if match.product_id not in ctx.deps.search_order:  # each run's own list (a Scout trip gets a fresh one)
            ctx.deps.search_order.append(match.product_id)
        ctx.deps.searched_ids.add(match.product_id)
    if not getattr(ctx, "quiet", False):
        filters = "".join([f", max ${max_price:g}" if max_price else "", f", size {size}" if size else ""])
        _note(ctx, "search_products", f'searched "{query or "everything"}"{filters}: {len(scored)} match{"es" * (len(scored) != 1)}')
    return SearchResults(
        matches=matches,
        total_matches=len(scored),
        unmatched_terms=[term for term in patterns if term not in matched_anywhere],
    )


def get_product_description(ctx: RunContext[ShopDeps], product_id: str) -> ProductDescription:
    """What a product is and what's printed on it: garment type, full description, colours and tags.

    Use this for "what does it look like?", "what's on the front?", "is it a hoodie or a crew?" and
    similar questions. It has no price or stock; use get_price and check_stock for those.

    Args:
        product_id: The product_id from search_products (the exact product name also works).
    """
    product = _resolve(product_id)
    _note(ctx, "get_product_description", f"read the description of {product.name}")
    return ProductDescription(
        product_id=product.product_id,
        name=product.name,
        garment_type=product.garment_type,
        description=product.description,
        colors=product.colors,
        search_tags=product.search_tags,
    )


def get_price(ctx: RunContext[ShopDeps], product_id: str) -> PriceQuote:
    """The current price of one product, from the shop database. Call this for any price question.

    Quote `display` exactly as given. Never round it, discount it or add prices together.

    Args:
        product_id: The product_id from search_products (the exact product name also works).
    """
    product = _resolve(product_id)
    ctx.deps.prices_seen.add(product.price)
    _note(ctx, "get_price", f"{product.name}: ${product.price:,.2f}")
    return PriceQuote(
        product_id=product.product_id,
        name=product.name,
        price=product.price,
        display=f"${product.price:,.2f}",
    )


def check_stock(ctx: RunContext[ShopDeps], product_id: str, size: str | None = None) -> StockCheck:
    """Live stock for one product: how many are on the shelf, per size. Call this for any stock question.

    Pass `size` whenever the shopper names one ("medium", "XL", "2XL" are all understood). The result
    says plainly whether that size is in stock, low, or SOLD OUT, and lists the sizes that are in
    stock so you can offer an alternative. Leave `size` out to get every size.

    Args:
        product_id: The product_id from search_products (the exact product name also works).
        size: The size the shopper asked about, if any.
    """
    product = _resolve(product_id)
    by_size = sorted(
        (_availability(row.size, row.quantity) for row in product.inventory),
        key=lambda row: SIZE_ORDER.index(row.size),
    )
    asked = normalise_size(size) if size else None
    requested = next((row for row in by_size if row.size == asked), None)

    ctx.deps.quantities_seen.update(row.quantity for row in by_size)
    ctx.deps.quantities_seen.add(product.total_stock)
    alternatives: list[Recommendation] = []
    if requested and requested.status == "sold out":
        ctx.deps.sold_out_checks.append(f"{product.name} in {requested.size}")
        alternatives = _offer(ctx, similar_products(product, requested.size, limit=3))
    status = requested.status if requested else f"{product.total_stock} in stock"
    _note(ctx, "check_stock", f"{product.name}{f' in {asked}' if asked else ''}: {status}")

    return StockCheck(
        product_id=product.product_id,
        name=product.name,
        requested_size=asked,
        size_offered=asked is None or requested is not None,
        requested=requested,
        by_size=by_size,
        sizes_in_stock=[row.size for row in by_size if row.quantity > 0],
        sizes_sold_out=[row.size for row in by_size if row.quantity == 0],
        total_stock=product.total_stock,
        summary=_stock_summary(product.name, asked, requested, by_size),
        similar_in_size=alternatives,
    )


def find_product(ctx: RunContext[ShopDeps], name: str) -> SearchResults:
    """Look up one specific product by its name or a few words of it ("mom crewneck", "boola tee").

    Returns up to five matches with id, price and sizes in stock. Use it to get a product_id
    before get_price / check_stock. For browsing a whole category, send the Scout instead.

    Args:
        name: The product's name, or the words the shopper used for it.
    """
    results = search_products(_Quiet(ctx), name, limit=5)
    _note(ctx, "find_product", f'looked up "{name}": {results.total_matches} match{"es" * (results.total_matches != 1)}')
    return results


def find_similar(ctx: RunContext[ShopDeps], product_id: str, size: Size | None = None) -> list[Recommendation]:
    """Close alternatives to a product that are in stock (in `size` if given): same kind of garment,
    colour and theme where possible, each with a reason. Use when an item is sold out in their size,
    or they want "something like this".

    Args:
        product_id: The product to find alternatives for.
        size: Only suggest items in stock in this size.
    """
    product = _resolve(product_id)
    recs = _offer(ctx, similar_products(product, size, limit=4))
    noun = "alternative" + "s" * (len(recs) != 1)
    _note(ctx, "find_similar", f"{len(recs)} {noun} to {product.name}{f' in {size}' if size else ''}")
    return recs


def outfit_candidates(ctx: RunContext[ShopDeps], product_id: str, size: Size | None = None) -> list[Recommendation]:
    """Pieces from the other layers that coordinate with a product (tee under a hoodie, jacket over),
    scored on classic colour pairings, graphic balance and matching college or team, in stock.
    Each comes with a role ("Wear under", "Layer over") and the reasons it works.

    Args:
        product_id: The product to build a look around.
        size: Only suggest items in stock in this size.
    """
    product = _resolve(product_id)
    recs = _offer(ctx, complete_the_look(product, size, limit=5))
    _note(ctx, "outfit_candidates", f"{len(recs)} piece{'s' * (len(recs) != 1)} that pair with {product.name}")
    return recs


def size_advice(
    ctx: RunContext[ShopDeps],
    height_in: float,
    weight_lb: float,
    chest_in: float | None = None,
    fit: Literal["snug", "regular", "relaxed"] = "regular",
    product_id: str | None = None,
) -> SizeFitCheck:
    """Recommend a size from the shopper's measurements, using the shop's size chart and fit notes.

    Call this when a shopper asks what size to get and gives their height and weight (ask for them
    if they haven't; chest is optional). Convert to US units first: 5'10" = 70 inches, 80 kg = 176 lb,
    180 cm = 71 inches. Pass the product_id when they're sizing a particular item (on a product page,
    the one they're viewing): the result then includes that garment's fit and live stock in the size,
    and in-stock alternatives if it's sold out.

    Args:
        height_in: Height in inches.
        weight_lb: Weight in pounds.
        chest_in: Chest measurement in inches, if they gave one.
        fit: How they like it to fit: "snug", "regular" or "relaxed" (roomy, oversized).
        product_id: The product they're sizing, if any.
    """
    product = _resolve(product_id) if product_id else None
    try:
        request = SizeAdviceRequest(
            height_in=height_in, weight_lb=weight_lb, chest_in=chest_in, fit=fit,
            product_id=product.product_id if product else None,
        )
    except ValueError as error:
        raise ModelRetry(f"Those measurements look off ({error.errors()[0]['msg']}). Check the units.") from None
    advice = recommend_size(request)
    result = SizeFitCheck(**advice.model_dump(), product_id=request.product_id)
    if product:
        ctx.deps.quantities_seen.update(row.quantity for row in product.inventory)
        if not advice.in_stock:
            ctx.deps.sold_out_checks.append(f"{product.name} in {advice.size}")
            result.similar_in_size = _offer(ctx, similar_products(product, advice.size, limit=3))
    pick = advice.size + (f" (or {advice.alternative})" if advice.alternative else "")
    _note(ctx, "size_advice", f"sized {describe(request)}: {pick}" + (f" in {product.name}" if product else ""))
    return result

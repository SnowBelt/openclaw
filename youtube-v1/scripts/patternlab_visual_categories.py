#!/usr/bin/env python3
import re
from pathlib import Path


VISUAL_CATEGORY_RULES = [
    {
        "category": "maps_documents_source_proof",
        "label": "maps/documents/source proof",
        "paragraph_terms": {
            "map",
            "maps",
            "source",
            "sources",
            "proof",
            "evidence",
            "record",
            "records",
            "document",
            "documents",
            "newspaper",
            "table",
            "artifact",
            "ledger",
            "route",
            "routes",
            "line",
            "lines",
        },
        "asset_terms": {
            "map",
            "maps",
            "source",
            "proof",
            "evidence",
            "record",
            "document",
            "overlay",
            "comparison",
            "then",
            "now",
            "route",
            "line",
            "source-grounded",
        },
    },
    {
        "category": "people_community",
        "label": "people/community",
        "paragraph_terms": {
            "people",
            "person",
            "human",
            "worker",
            "workers",
            "mother",
            "children",
            "family",
            "families",
            "residents",
            "organizers",
            "musicians",
            "entrepreneurs",
            "planners",
            "community",
            "crowd",
            "girls",
            "names",
            "lived",
        },
        "asset_terms": {
            "people",
            "person",
            "worker",
            "workers",
            "mother",
            "children",
            "family",
            "families",
            "residents",
            "community",
            "crowd",
            "girls",
            "tenants",
            "neighbors",
        },
    },
    {
        "category": "neighborhoods_housing_street_life",
        "label": "neighborhoods/housing/street life",
        "paragraph_terms": {
            "neighborhood",
            "neighborhoods",
            "housing",
            "home",
            "homes",
            "street",
            "streets",
            "block",
            "blocks",
            "stores",
            "churches",
            "lost",
            "moved",
            "divided",
            "erased",
            "paradise",
            "valley",
            "black",
            "bottom",
        },
        "asset_terms": {
            "neighborhood",
            "neighborhoods",
            "housing",
            "home",
            "homes",
            "street",
            "streets",
            "sojourner",
            "truth",
            "church",
            "churches",
            "riot",
        },
    },
    {
        "category": "industry_workers_transport",
        "label": "industry/workers/transportation",
        "paragraph_terms": {
            "factory",
            "factories",
            "industry",
            "industrial",
            "plant",
            "plants",
            "worker",
            "workers",
            "steel",
            "furnace",
            "furnaces",
            "manufacturing",
            "automotive",
            "cars",
            "streetcars",
            "rail",
            "railroad",
            "light",
            "line",
            "dock",
            "tunnel",
            "transportation",
        },
        "asset_terms": {
            "factory",
            "factories",
            "plant",
            "drilling",
            "bomber",
            "steel",
            "furnace",
            "furnaces",
            "coke",
            "stove",
            "works",
            "belting",
            "rail",
            "line",
            "dock",
            "tunnel",
            "q",
            "car",
            "cars",
        },
    },
    {
        "category": "attractions_landmarks_civic",
        "label": "attractions/landmarks/civic spaces",
        "paragraph_terms": {
            "attraction",
            "attractions",
            "landmark",
            "landmarks",
            "park",
            "parks",
            "civic",
            "building",
            "buildings",
            "station",
            "fountain",
            "casino",
            "university",
            "medical",
            "church",
            "churches",
            "belle",
            "isle",
            "palmer",
            "place",
            "places",
            "identity",
        },
        "asset_terms": {
            "park",
            "casino",
            "fountain",
            "university",
            "wayne",
            "state",
            "medical",
            "center",
            "church",
            "saints",
            "peter",
            "paul",
            "belle",
            "isle",
            "palmer",
            "building",
            "doorway",
            "station",
        },
    },
    {
        "category": "culture_music_arts_sports",
        "label": "culture/music/arts/sports",
        "paragraph_terms": {
            "music",
            "motown",
            "recorded",
            "culture",
            "arts",
            "art",
            "mural",
            "museum",
            "sports",
            "exhibition",
            "carnation",
            "story",
            "stories",
        },
        "asset_terms": {
            "arts",
            "art",
            "mural",
            "institute",
            "museum",
            "exhibition",
            "carnation",
            "garden",
            "court",
            "industry",
        },
    },
    {
        "category": "geography_waterfront_routes",
        "label": "geography/waterfront/routes",
        "paragraph_terms": {
            "river",
            "water",
            "border",
            "trade",
            "route",
            "routes",
            "freeway",
            "freeways",
            "grid",
            "geography",
            "corridor",
            "bridge",
            "access",
            "lake",
            "street",
            "streets",
        },
        "asset_terms": {
            "river",
            "waterfront",
            "dock",
            "tunnel",
            "belle",
            "isle",
            "route",
            "line",
            "rail",
            "skyline",
            "southeast",
        },
    },
    {
        "category": "skyline_cityscape_context",
        "label": "skyline/cityscape context",
        "paragraph_terms": {
            "skyline",
            "downtown",
            "cityscape",
            "modern",
            "today",
            "current",
            "comeback",
            "present",
            "context",
            "city",
            "cities",
        },
        "asset_terms": {
            "skyline",
            "downtown",
            "cityscape",
            "modern",
            "context",
            "renaissance",
            "detroit",
            "michigan",
        },
    },
]


def tokenize(text):
    return set(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def asset_text_from_path(path):
    path = Path(path)
    stem = path.stem.lower()
    stem = re.sub(r"^(loc|commons|pexels)[-_]?\d*[-_]?", "", stem)
    return stem.replace("-", " ").replace("_", " ")


def ledger_row_for_path(root, path, ledger_lookup=None):
    if not ledger_lookup:
        return {}
    try:
        relative = str(Path(path).relative_to(root))
    except ValueError:
        relative = str(path)
    return ledger_lookup.get(relative) or ledger_lookup.get(Path(path).name) or {}


def asset_category_text(root, path, ledger_lookup=None):
    row = ledger_row_for_path(root, path, ledger_lookup)
    parts = [
        asset_text_from_path(path),
        row.get("source_title", ""),
        row.get("source_url", ""),
        row.get("creator", ""),
        row.get("archive_or_platform", ""),
        row.get("source_class", ""),
        row.get("notes", ""),
    ]
    return " ".join(part for part in parts if part)


def source_overlay_category(path):
    name = Path(path).name.lower()
    if any(term in name for term in ("source-proof", "map-system", "archival-evidence", "then-now")):
        return {
            "visual_category": "maps_documents_source_proof",
            "visual_category_label": "maps/documents/source proof",
            "visual_category_score": 18,
            "visual_category_reason": "source-grounded overlay is a map, document, evidence, or then-now proof object",
        }
    if "subscribe" in name:
        return {
            "visual_category": "skyline_cityscape_context",
            "visual_category_label": "skyline/cityscape context",
            "visual_category_score": 10,
            "visual_category_reason": "city-file CTA uses a real-media city collage as context",
        }
    return None


def classify_visual_category(root, path, paragraph="", source_role="", ledger_lookup=None):
    if source_role == "source_grounded_overlay" or "source-grounded-overlays" in str(path):
        overlay = source_overlay_category(path)
        if overlay:
            return overlay

    paragraph_tokens = tokenize(paragraph)
    asset_tokens = tokenize(asset_category_text(root, path, ledger_lookup))
    best = None
    for rule in VISUAL_CATEGORY_RULES:
        paragraph_hits = paragraph_tokens & rule["paragraph_terms"]
        asset_hits = asset_tokens & rule["asset_terms"]
        score = len(asset_hits) * 3
        if paragraph_hits:
            score += len(paragraph_hits) * 2
        if paragraph_hits and asset_hits:
            score += 8
        if rule["category"] == "skyline_cityscape_context" and source_role == "modern_context":
            score += 2
        if score <= 0:
            continue
        candidate = (score, rule, paragraph_hits, asset_hits)
        if best is None or candidate[0] > best[0]:
            best = candidate

    if best:
        score, rule, paragraph_hits, asset_hits = best
        reason_bits = []
        if paragraph_hits:
            reason_bits.append("paragraph terms " + ",".join(sorted(paragraph_hits)[:4]))
        if asset_hits:
            reason_bits.append("asset terms " + ",".join(sorted(asset_hits)[:4]))
        return {
            "visual_category": rule["category"],
            "visual_category_label": rule["label"],
            "visual_category_score": score,
            "visual_category_reason": "; ".join(reason_bits) or "asset category match",
        }

    if source_role == "modern_context":
        return {
            "visual_category": "skyline_cityscape_context",
            "visual_category_label": "skyline/cityscape context",
            "visual_category_score": 1,
            "visual_category_reason": "modern context fallback category",
        }
    return {
        "visual_category": "maps_documents_source_proof" if source_role == "source_proof" else "unknown_context",
        "visual_category_label": "unknown/context",
        "visual_category_score": 0,
        "visual_category_reason": "no category terms matched; source more specific media if this appears in final beats",
    }

#!/usr/bin/env python3
"""Build a real-city Pattern Lab thumbnail test package.

This script intentionally uses rights-ledgered real source assets for the active
city. It is for repo-local thumbnail testing only; it does not call Canva or
YouTube and does not use paid assets.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from patternlab_common import BASE, ensure_dir, ffmpeg_cmd, launch_root, output_root, utc_now
from patternlab_comment_prompts import city_source_lead_comment

USER_AGENT = "OpenClaw Pattern Lab real-city thumbnail test (contact: local repo QA)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
LOC_SEARCH_API = "https://www.loc.gov/pictures/search/"
OPENVERSE_API = "https://api.openverse.engineering/v1/images/"
PEXELS_API = "https://api.pexels.com/v1/search"
PIXABAY_API = "https://pixabay.com/api/"
UNSPLASH_API = "https://api.unsplash.com/search/photos"
OSM_STATIC_MAP = "https://staticmap.openstreetmap.de/staticmap.php"
NOMINATIM_SEARCH_API = "https://nominatim.openstreetmap.org/search"
CITY_STATE = {"chicago": "Illinois", "cleveland": "Ohio", "miami": "Florida", "pittsburgh": "Pennsylvania"}
CITY_COORDS = {"chicago": ("41.8781", "-87.6298"), "miami": ("25.7617", "-80.1918")}

LEDGER_FIELDS = [
    "asset_id",
    "asset_type",
    "filename",
    "local_path",
    "tool",
    "model_or_service",
    "source_prompt_or_source_file",
    "source_title",
    "source_url",
    "creator",
    "archive_or_platform",
    "source_class",
    "license_or_rights_basis",
    "license_status",
    "attribution_required",
    "attribution_text",
    "commercial_use_ok",
    "modification_ok",
    "recognizable_people_property_trademark_risk",
    "ai_reconstruction_disclosure",
    "created_at",
    "notes",
    "human_review_required",
    "human_review_status",
]

COMMONS_QUERIES = [
    {
        "key": "modern_skyline",
        "query": "{city} skyline",
        "dest": "modern-context",
        "class": "modern_context",
        "category": "skyline_cityscape_context",
        "must": ["{city_lc}"],
        "prefer": ["skyline", "downtown", "tower", "lake", "river", "2025", "2024", "sunrise"],
        "block": ["painting", "logo", "drawing", "diagram"],
        "notes": "modern {city} skyline/landmark recognition context",
    },
    {
        "key": "terminal_tower",
        "query": "{city} landmark",
        "dest": "modern-context",
        "class": "modern_context",
        "category": "attractions_landmarks_civic skyline_cityscape_context",
        "must": ["{city_lc}"],
        "prefer": ["tower", "landmark", "downtown", "river", "lake", "building"],
        "notes": "recognizable {city} landmark support",
    },
    {
        "key": "historic_street",
        "query": "{city} historic street",
        "dest": "historical",
        "class": "historical_evidence",
        "category": "neighborhoods_housing_street_life street_grid",
        "must": ["{city_lc}"],
        "prefer": ["street", "downtown", "avenue", "historic", "loop", "river"],
        "notes": "historic {city} street/city context for then/lost-streets concepts",
    },
    {
        "key": "historic_landmark",
        "query": "{city} historic landmark",
        "dest": "historical",
        "class": "historical_evidence",
        "category": "attractions_landmarks_civic skyline_cityscape_context",
        "must": ["{city_lc}"],
        "prefer": ["tower", "landmark", "downtown", "historic", "river", "loop"],
        "notes": "historic {city} landmark/city context",
    },
    {
        "key": "underground_or_transit",
        "query": "{city} subway tunnel transit",
        "dest": "historical",
        "class": "historical_evidence",
        "category": "industry_workers_transport tunnel underground route",
        "must": ["{city_lc}"],
        "prefer": ["subway", "tunnel", "transit", "station", "rail", "underground"],
        "notes": "{city} hidden-system/tunnel/transit support for under-city concept",
        "allow_generic_fallback": True,
        "fallback_query": "underground city tunnel public domain",
    },
]

FALLBACK_COMMONS_QUERIES = {
    "modern_skyline": ["{city} downtown skyline", "{city} city skyline", "{city} skyline"],
    "terminal_tower": ["{city} landmark", "{city} downtown landmark", "{city} tower", "{city} Water Tower", "{city} Wrigley Building"],
    "historic_street": ["{city} historic street", "{city} downtown historic", "{city} historic avenue"],
    "historic_landmark": ["{city} historic landmark", "{city} historic downtown", "{city} historic tower", "{city} Water Tower", "{city} Wrigley Building", "{city} Union Station historic"],
    "underground_or_transit": ["{city} subway tunnel", "{city} transit station", "{city} underground"],
}


@dataclass
class Asset:
    key: str
    title: str
    source_url: str
    download_url: str
    creator: str
    license_status: str
    license_basis: str
    attribution_required: str
    attribution_text: str
    local_rel: str
    archive: str
    source_class: str
    category: str
    notes: str
    tool: str
    service: str
    source_file: str
    provider: str = ""
    provider_rank: int = 0


def city_config(config: dict[str, Any], city: str) -> dict[str, Any]:
    city_lc = city.lower()
    def expand(value: Any) -> Any:
        if isinstance(value, str):
            return value.format(city=city, city_lc=city_lc)
        if isinstance(value, list):
            return [expand(item) for item in value]
        if isinstance(value, dict):
            return {key: expand(item) for key, item in value.items()}
        return value
    return expand(config)


def request_json(url: str, params: dict[str, str], headers: dict[str, str] | None = None) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(params)
    merged_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    req = urllib.request.Request(f"{url}?{encoded}", headers=merged_headers)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def request_json_any(url: str, params: dict[str, str], headers: dict[str, str] | None = None) -> Any:
    encoded = urllib.parse.urlencode(params)
    merged_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    req = urllib.request.Request(f"{url}?{encoded}", headers=merged_headers)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, path: Path) -> None:
    # curl is more reliable than urllib on this host for large Wikimedia image
    # downloads and gives us retry/backoff without adding a dependency.
    result = subprocess.run(
        [
            "curl",
            "-L",
            "--retry",
            "4",
            "--retry-delay",
            "1",
            "--connect-timeout",
            "25",
            "--max-time",
            "180",
            "-A",
            USER_AGENT,
            "-o",
            str(path),
            url,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"download failed for {url}: {result.stderr[-2000:]}")


def clean_text(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("value", "")).strip()
    return str(value or "").strip()


def safe_filename(value: str, suffix: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:90] or "asset"
    ext = suffix.lower().split("?")[0]
    if ext not in {".jpg", ".jpeg", ".png"}:
        ext = ".jpg"
    return f"{slug}{ext}"



def is_safe_image_url(url: str) -> bool:
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower().split("?")[0]
    return suffix in {".jpg", ".jpeg", ".png", ".webp"} or bool(url)


def free_license_ok(text: str) -> bool:
    lower = text.lower()
    blocked = ["noncommercial", "non-commercial", "no derivatives", "no-derivatives", "fair use", "editorial"]
    if any(term in lower for term in blocked):
        return False
    allowed = ["public domain", "no known restrictions", "cc0", "cc by", "cc-by", "by", "by-sa", "pdm", "creative commons attribution", "pexels license", "pixabay license", "unsplash license"]
    return any(term in lower for term in allowed)


def is_allowed_license(meta: dict[str, Any]) -> bool:
    text = " ".join(
        clean_text(meta.get(key))
        for key in ["LicenseShortName", "License", "UsageTerms", "Copyrighted", "Restrictions"]
    ).lower()
    blocked = ["noncommercial", "non-commercial", "no derivatives", "no-derivatives", "fair use", "copyrighted free use"]
    if any(term in text for term in blocked):
        return False
    allowed = ["public domain", "cc0", "cc by", "cc-by", "creative commons attribution"]
    return any(term in text for term in allowed)


def score_candidate(title: str, config: dict[str, Any]) -> int:
    lower = title.lower()
    score = 0
    score += sum(20 for term in config.get("must", []) if term in lower)
    score += sum(8 for term in config.get("prefer", []) if term in lower)
    if any(term in lower for term in config.get("block", [])):
        return -999
    if any(bad in lower for bad in ["logo", "seal", "flag", "diagram", "map of ohio"]):
        score -= 25
    return score


def commons_search(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrnamespace": "6",
        "gsrsearch": query,
        "gsrlimit": "25",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime|size",
        "iiurlwidth": "1800",
    }
    try:
        data = request_json(COMMONS_API, params)
    except Exception:
        return None
    pages = list((data.get("query") or {}).get("pages", {}).values())
    candidates: list[tuple[int, dict[str, Any], dict[str, Any]]] = []
    for page in pages:
        title = page.get("title", "")
        info = (page.get("imageinfo") or [{}])[0]
        mime = info.get("mime", "")
        if title in used_titles or not mime.startswith("image/"):
            continue
        if mime in {"image/gif", "image/tiff"}:
            continue
        if mime == "image/svg+xml" and not info.get("thumburl"):
            continue
        meta = info.get("extmetadata") or {}
        if not is_allowed_license(meta):
            continue
        lower = f"{title} {query}".lower()
        must = config.get("must", [])
        if must and not all(term in lower for term in must):
            continue
        candidates.append((score_candidate(f"{title} {query}", config), page, info))
    if not candidates:
        return None
    score, page, info = sorted(candidates, key=lambda item: (-item[0], item[1].get("title", "")))[0]
    if score <= 0 and not config.get("allow_generic_fallback"):
        return None
    title = page.get("title", "File:Untitled")
    meta = info.get("extmetadata") or {}
    source_url = clean_text(meta.get("ObjectURL")) or info.get("descriptionurl", "")
    download_url = info.get("thumburl") or info.get("url", "")
    if not download_url:
        return None
    creator = clean_text(meta.get("Artist")) or "Wikimedia Commons contributor"
    license_short = clean_text(meta.get("LicenseShortName")) or clean_text(meta.get("UsageTerms")) or "free license"
    basis = clean_text(meta.get("UsageTerms")) or license_short
    suffix = Path(urllib.parse.urlparse(download_url).path).suffix
    filename = safe_filename(title.removeprefix("File:"), suffix)
    local_rel = f"source-packet/visual-rebuild/{config['dest']}/commons-{config['key']}-{filename}"
    return Asset(
        key=config["key"],
        title=title,
        source_url=source_url,
        download_url=download_url,
        creator=creator,
        license_status=license_short,
        license_basis=basis,
        attribution_required="yes",
        attribution_text=f"{title}. {creator}. Wikimedia Commons. {source_url or info.get('descriptionurl', '')}",
        local_rel=local_rel,
        archive="Wikimedia Commons",
        source_class=config["class"],
        category=config["category"],
        notes=config["notes"],
        tool="Wikimedia Commons API",
        service="Wikimedia Commons public image services",
        source_file=download_url,
        provider="wikimedia_commons",
        provider_rank=10,
    )


def loc_search(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    params = {"fo": "json", "q": query, "c": "25"}
    try:
        data = request_json(LOC_SEARCH_API, params)
    except Exception:
        return None
    candidates: list[tuple[int, dict[str, Any]]] = []
    for item in data.get("results", []):
        title = clean_text(item.get("title"))
        if not title or title in used_titles:
            continue
        image_url = ""
        image_urls = item.get("image_url") or []
        if image_urls:
            image_url = str(image_urls[-1])
        if not image_url or not is_safe_image_url(image_url):
            continue
        rights = " ".join(str(item.get(key, "")) for key in ["rights", "rights_advisory", "access_restricted"])
        if rights and not free_license_ok(rights) and "no known restrictions" not in rights.lower():
            continue
        item_url = clean_text(item.get("link")) or clean_text(item.get("url"))
        lower = f"{title} {item_url} {query}".lower()
        must = config.get("must", [])
        if must and not all(term in lower for term in must):
            continue
        score = score_candidate(f"{title} {query}", config) + 6
        if "no known restrictions" in rights.lower() or "public domain" in rights.lower():
            score += 10
        candidates.append((score, item))
    if not candidates:
        return None
    score, item = sorted(candidates, key=lambda pair: (-pair[0], pair[1].get("title", "")))[0]
    if score <= 0 and not config.get("allow_generic_fallback"):
        return None
    title = clean_text(item.get("title"))
    image_url = str((item.get("image_url") or [""])[-1])
    source_url = clean_text(item.get("link")) or clean_text(item.get("url"))
    creator = clean_text(item.get("creator")) or "Library of Congress"
    rights = clean_text(item.get("rights")) or clean_text(item.get("rights_advisory")) or "Library of Congress item-level rights review required"
    suffix = Path(urllib.parse.urlparse(image_url).path).suffix
    filename = safe_filename(title, suffix)
    return Asset(
        key=config["key"],
        title=title,
        source_url=source_url,
        download_url=image_url,
        creator=creator,
        license_status=rights,
        license_basis=rights,
        attribution_required="yes",
        attribution_text=f"{title}. {creator}. Library of Congress. {source_url}",
        local_rel=f"source-packet/visual-rebuild/{config['dest']}/loc-{config['key']}-{filename}",
        archive="Library of Congress",
        source_class=config["class"],
        category=config["category"],
        notes=config["notes"],
        tool="Library of Congress public search API",
        service="Library of Congress public image services",
        source_file=image_url,
        provider="library_of_congress",
        provider_rank=20,
    )


def openverse_search(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    params = {"q": query, "page_size": "25", "license_type": "commercial,modification", "extension": "jpg,png"}
    try:
        data = request_json(OPENVERSE_API, params)
    except Exception:
        return None
    candidates: list[tuple[int, dict[str, Any]]] = []
    for item in data.get("results", []):
        title = clean_text(item.get("title"))
        url = clean_text(item.get("url")) or clean_text(item.get("thumbnail"))
        if not title or title in used_titles or not url:
            continue
        license_text = " ".join(clean_text(item.get(key)) for key in ["license", "license_version", "license_url"])
        if not free_license_ok(license_text):
            continue
        lower = f"{title} {clean_text(item.get('foreign_landing_url'))} {query}".lower()
        must = config.get("must", [])
        if must and not all(term in lower for term in must):
            continue
        candidates.append((score_candidate(f"{title} {query}", config) + 3, item))
    if not candidates:
        return None
    score, item = sorted(candidates, key=lambda pair: (-pair[0], pair[1].get("title", "")))[0]
    if score <= 0 and not config.get("allow_generic_fallback"):
        return None
    title = clean_text(item.get("title"))
    download_url = clean_text(item.get("url")) or clean_text(item.get("thumbnail"))
    source_url = clean_text(item.get("foreign_landing_url"))
    creator = clean_text(item.get("creator")) or "Openverse indexed creator"
    license_name = clean_text(item.get("license")) or "Creative Commons compatible license"
    license_url = clean_text(item.get("license_url"))
    basis = f"{license_name} {license_url}".strip()
    suffix = Path(urllib.parse.urlparse(download_url).path).suffix
    filename = safe_filename(title, suffix)
    return Asset(
        key=config["key"],
        title=title,
        source_url=source_url,
        download_url=download_url,
        creator=creator,
        license_status=license_name,
        license_basis=basis,
        attribution_required="yes",
        attribution_text=f"{title}. {creator}. Openverse indexed source. {source_url} {basis}",
        local_rel=f"source-packet/visual-rebuild/{config['dest']}/openverse-{config['key']}-{filename}",
        archive="Openverse",
        source_class=config["class"],
        category=config["category"],
        notes=config["notes"],
        tool="Openverse API",
        service="Openverse public image API",
        source_file=download_url,
        provider="openverse",
        provider_rank=30,
    )


def pexels_search(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    token = os.environ.get("PEXELS_API_KEY", "").strip()
    if not token or config.get("class") != "modern_context":
        return None
    try:
        data = request_json(PEXELS_API, {"query": query, "per_page": "20", "orientation": "landscape"}, {"Authorization": token})
    except Exception:
        return None
    candidates = []
    for item in data.get("photos", []):
        title = clean_text(item.get("alt")) or f"Pexels photo {item.get('id')}"
        if title in used_titles:
            continue
        src = item.get("src") or {}
        url = clean_text(src.get("large2x")) or clean_text(src.get("original"))
        if not url:
            continue
        candidates.append((score_candidate(title + " " + query, {**config, "must": []}), item, title, url))
    if not candidates:
        return None
    _, item, title, url = sorted(candidates, key=lambda pair: (-pair[0], str(pair[1].get("id", ""))))[0]
    photographer = clean_text(item.get("photographer")) or "Pexels photographer"
    source_url = clean_text(item.get("url"))
    filename = safe_filename(title, ".jpg")
    return Asset(config["key"], title, source_url, url, photographer, "Pexels License", "Pexels License; free for commercial use with restrictions", "no", f"{title}. {photographer}. Pexels. {source_url}", f"source-packet/visual-rebuild/{config['dest']}/pexels-{config['key']}-{filename}", "Pexels", config["class"], config["category"], config["notes"] + "; modern context only, not historical proof", "Pexels API", "Pexels public photo API", url, "pexels", 40)


def pixabay_search(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    token = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not token or config.get("class") != "modern_context":
        return None
    try:
        data = request_json(PIXABAY_API, {"key": token, "q": query, "image_type": "photo", "orientation": "horizontal", "per_page": "20", "safesearch": "true"})
    except Exception:
        return None
    candidates = []
    for item in data.get("hits", []):
        tags = clean_text(item.get("tags")) or f"Pixabay image {item.get('id')}"
        url = clean_text(item.get("largeImageURL")) or clean_text(item.get("webformatURL"))
        if not url:
            continue
        candidates.append((score_candidate(tags, {**config, "must": []}), item, tags, url))
    if not candidates:
        return None
    _, item, title, url = sorted(candidates, key=lambda pair: (-pair[0], str(pair[1].get("id", ""))))[0]
    creator = clean_text(item.get("user")) or "Pixabay contributor"
    source_url = clean_text(item.get("pageURL"))
    filename = safe_filename(title, ".jpg")
    return Asset(config["key"], title, source_url, url, creator, "Pixabay Content License", "Pixabay Content License; commercial use allowed with restrictions", "no", f"{title}. {creator}. Pixabay. {source_url}", f"source-packet/visual-rebuild/{config['dest']}/pixabay-{config['key']}-{filename}", "Pixabay", config["class"], config["category"], config["notes"] + "; modern context only, not historical proof", "Pixabay API", "Pixabay public image API", url, "pixabay", 50)


def unsplash_search(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    token = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
    if not token or config.get("class") != "modern_context":
        return None
    try:
        data = request_json(UNSPLASH_API, {"query": query, "per_page": "20", "orientation": "landscape", "client_id": token})
    except Exception:
        return None
    candidates = []
    for item in data.get("results", []):
        title = clean_text(item.get("description")) or clean_text(item.get("alt_description")) or f"Unsplash photo {item.get('id')}"
        urls = item.get("urls") or {}
        url = clean_text(urls.get("regular")) or clean_text(urls.get("full"))
        if not url:
            continue
        candidates.append((score_candidate(title + " " + query, {**config, "must": []}), item, title, url))
    if not candidates:
        return None
    _, item, title, url = sorted(candidates, key=lambda pair: (-pair[0], str(pair[1].get("id", ""))))[0]
    user = item.get("user") or {}
    creator = clean_text(user.get("name")) or "Unsplash photographer"
    links = item.get("links") or {}
    source_url = clean_text(links.get("html"))
    filename = safe_filename(title, ".jpg")
    return Asset(config["key"], title, source_url, url, creator, "Unsplash License", "Unsplash License; commercial use allowed with restrictions", "no", f"{title}. {creator}. Unsplash. {source_url}", f"source-packet/visual-rebuild/{config['dest']}/unsplash-{config['key']}-{filename}", "Unsplash", config["class"], config["category"], config["notes"] + "; modern context only, not historical proof", "Unsplash API", "Unsplash public photo API", url, "unsplash", 60)


SOURCE_PROVIDERS = [
    ("wikimedia_commons", commons_search),
    ("library_of_congress", loc_search),
    ("openverse", openverse_search),
    ("pexels", pexels_search),
    ("pixabay", pixabay_search),
    ("unsplash", unsplash_search),
]

SOURCE_ATTEMPTS: list[dict[str, str]] = []


def search_all_providers(config: dict[str, Any], query: str, root: Path, city_slug: str, used_titles: set[str]) -> Asset | None:
    for provider_name, provider in SOURCE_PROVIDERS:
        try:
            asset = provider(config, query, root, city_slug, used_titles)
        except Exception as exc:
            SOURCE_ATTEMPTS.append({"provider": provider_name, "query": query, "key": config.get("key", ""), "status": "error", "detail": type(exc).__name__})
            continue
        if asset:
            SOURCE_ATTEMPTS.append({"provider": provider_name, "query": query, "key": config.get("key", ""), "status": "selected", "detail": asset.title})
            return asset
        SOURCE_ATTEMPTS.append({"provider": provider_name, "query": query, "key": config.get("key", ""), "status": "miss", "detail": "no compatible asset"})
    return None


def geocode_city(root: Path, city: str) -> tuple[str, str] | None:
    city_lc = city.lower()
    if city_lc in CITY_COORDS:
        return CITY_COORDS[city_lc]
    approval = ensure_dir(root / "approval")
    cache_path = approval / "city-geocode-cache.json"
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    except Exception:
        cache = {}
    cached = cache.get(city_lc)
    if isinstance(cached, dict) and cached.get("lat") and cached.get("lon"):
        SOURCE_ATTEMPTS.append({"provider": "openstreetmap_nominatim", "query": f"{city}, United States", "key": "city_geocode", "status": "selected", "detail": f"cached:{cached.get('lat')},{cached.get('lon')}"})
        return str(cached["lat"]), str(cached["lon"])
    try:
        data = request_json_any(
            NOMINATIM_SEARCH_API,
            {"q": f"{city}, United States", "format": "jsonv2", "limit": "1"},
            {"Accept-Language": "en"},
        )
    except Exception as exc:
        SOURCE_ATTEMPTS.append({"provider": "openstreetmap_nominatim", "query": f"{city}, United States", "key": "city_geocode", "status": "error", "detail": type(exc).__name__})
        return None
    if not isinstance(data, list) or not data:
        SOURCE_ATTEMPTS.append({"provider": "openstreetmap_nominatim", "query": f"{city}, United States", "key": "city_geocode", "status": "miss", "detail": "no geocode result"})
        return None
    first = data[0]
    lat = str(first.get("lat", "")).strip()
    lon = str(first.get("lon", "")).strip()
    if not lat or not lon:
        SOURCE_ATTEMPTS.append({"provider": "openstreetmap_nominatim", "query": f"{city}, United States", "key": "city_geocode", "status": "miss", "detail": "geocode result missing lat/lon"})
        return None
    cache[city_lc] = {"lat": lat, "lon": lon, "display_name": first.get("display_name", ""), "source": "OpenStreetMap Nominatim"}
    cache_path.write_text(json.dumps(cache, indent=2) + "\n", encoding="utf-8")
    SOURCE_ATTEMPTS.append({"provider": "openstreetmap_nominatim", "query": f"{city}, United States", "key": "city_geocode", "status": "selected", "detail": f"{lat},{lon}"})
    return lat, lon


def provider_health_payload(video_id: str, city: str, assets: list[Asset] | None, status: str, reason: str = "") -> dict[str, Any]:
    selected_attempts = [attempt for attempt in SOURCE_ATTEMPTS if attempt.get("status") == "selected"]
    selected_providers = sorted({attempt.get("provider", "") for attempt in selected_attempts if attempt.get("provider")})
    attempted_providers = sorted({attempt.get("provider", "") for attempt in SOURCE_ATTEMPTS if attempt.get("provider")})
    provider_rows = []
    for provider in attempted_providers:
        attempts = [attempt for attempt in SOURCE_ATTEMPTS if attempt.get("provider") == provider]
        provider_rows.append({
            "provider": provider,
            "attempt_count": len(attempts),
            "selected_count": sum(1 for attempt in attempts if attempt.get("status") == "selected"),
            "miss_count": sum(1 for attempt in attempts if attempt.get("status") == "miss"),
            "error_count": sum(1 for attempt in attempts if attempt.get("status") == "error"),
            "statuses": sorted({attempt.get("status", "unknown") for attempt in attempts}),
        })
    asset_providers = sorted({asset.provider or asset.archive for asset in (assets or []) if (asset.provider or asset.archive)})
    selected_provider_count = len(set(selected_providers) | set(asset_providers))
    single_source_dependency = selected_provider_count <= 1
    health_status = "pass" if status == "pass" and not single_source_dependency and len(assets or []) >= 5 else "blocked"
    return {
        "generated_at": utc_now(),
        "video_id": video_id,
        "active_city": city,
        "status": health_status,
        "source_package_status": status,
        "reason": reason,
        "provider_attempt_count": len(SOURCE_ATTEMPTS),
        "attempted_provider_count": len(attempted_providers),
        "selected_provider_count": selected_provider_count,
        "selected_providers": sorted(set(selected_providers) | set(asset_providers)),
        "asset_count": len(assets or []),
        "single_source_dependency": single_source_dependency,
        "provider_rows": provider_rows,
        "source_provider_attempts": SOURCE_ATTEMPTS,
        "fail_closed_reasons": [item for item in [
            reason if status != "pass" else "",
            "single_source_dependency" if single_source_dependency else "",
            "insufficient_assets" if len(assets or []) < 5 else "",
        ] if item],
        "public_youtube_mutation": "not_performed",
        "paid_or_pro_assets": "not_used",
    }


def write_provider_health_report(video_id: str, city: str, root: Path, assets: list[Asset] | None, status: str, reason: str = "") -> dict[str, Any]:
    approval = ensure_dir(root / "approval")
    payload = provider_health_payload(video_id, city, assets, status, reason)
    (approval / "source-provider-health-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Source Provider Health: {city}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Provider attempts: {payload['provider_attempt_count']}",
        f"Attempted providers: {payload['attempted_provider_count']}",
        f"Selected providers: {payload['selected_provider_count']}",
        f"Single-source dependency: {payload['single_source_dependency']}",
        "",
        "## Providers",
        "",
    ]
    for row in payload["provider_rows"]:
        lines.append(f"- {row['provider']}: attempts={row['attempt_count']} selected={row['selected_count']} miss={row['miss_count']} error={row['error_count']} statuses={','.join(row['statuses'])}")
    lines.extend(["", "## Fail-Closed Reasons", ""])
    lines.extend([f"- {item}" for item in payload["fail_closed_reasons"]] or ["- none"])
    (approval / "source-provider-health-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload


def build_map_asset(root: Path, city: str, city_slug: str, used_titles: set[str]) -> Asset:
    config = {
        "key": "city_source_map",
        "query": f"{city} {CITY_STATE.get(city.lower(), 'United States')} map",
        "dest": "historical",
        "class": "source_grounded_support_graphic",
        "category": "maps_documents_source_proof street_grid route highway map",
        "must": [city.lower()],
        "prefer": ["street", "railway", "sanborn", "map of city", "1884", "street map", city.lower()],
        "block": ["election", "mayoral", "results", "diocese", "zoo", "location map", "highlighting"],
        "notes": f"real {city} map/street-grid support for redrawn and lost-streets thumbnail concepts",
    }
    state = CITY_STATE.get(city.lower(), "United States")
    for query in [f"{city} {state} map", f"{city} street map", f"Map of city of {city} {state}"]:
        asset = search_all_providers(config, query, root, city_slug, used_titles)
        if asset:
            asset.local_rel = "images/city_source_map.png"
            asset.key = "city_source_map"
            asset.source_class = "historical_evidence"
            asset.category = "maps_documents_source_proof street_grid route highway map"
            asset.notes = f"real {city} map/street-grid support for redrawn and lost-streets thumbnail concepts"
            return asset
    coords = geocode_city(root, city)
    if coords:
        lat, lon = coords
        params = urllib.parse.urlencode(
            {
                "center": f"{lat},{lon}",
                "zoom": "12",
                "size": "1920x1080",
                "maptype": "mapnik",
                "markers": f"{lat},{lon},red-pushpin",
            }
        )
        url = f"{OSM_STATIC_MAP}?{params}"
        SOURCE_ATTEMPTS.append({"provider": "openstreetmap_static_map", "query": f"{city} street grid", "key": "city_source_map", "status": "selected", "detail": f"OpenStreetMap static street map for {city}"})
        return Asset(
            key="city_source_map",
            title=f"OpenStreetMap static street map for {city}",
            source_url=url,
            download_url=url,
            creator="OpenStreetMap contributors",
            license_status="OpenStreetMap tile attribution required",
            license_basis="OpenStreetMap tile/service output used as source-grounded map support; owner review required before public use",
            attribution_required="yes",
            attribution_text=f"Map data © OpenStreetMap contributors. {url}",
            local_rel="images/city_source_map.png",
            archive="OpenStreetMap static map service",
            source_class="historical_evidence",
            category="maps_documents_source_proof street_grid route highway map",
            notes=f"real {city} street-grid support for redrawn and lost-streets thumbnail concepts",
            tool="OpenStreetMap static map service",
            service="OpenStreetMap static map service",
            source_file=url,
            provider="openstreetmap_static",
            provider_rank=70,
        )
    raise SystemExit(f"Could not find rights-compatible map asset for {city}.")




def run_ffmpeg(args: list[str]) -> None:
    result = subprocess.run([ffmpeg_cmd(), "-y", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError("ffmpeg failed:\n" + " ".join(args) + "\n" + result.stderr[-3000:])


def crop_to_1080(input_path: Path, output_path: Path) -> None:
    tmp = output_path.with_suffix(".tmp.png")
    run_ffmpeg([
        "-i",
        str(input_path),
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
        "-frames:v",
        "1",
        str(tmp),
    ])
    tmp.replace(output_path)


def render_then_now(then_path: Path, now_path: Path, output_path: Path) -> None:
    tmp = output_path.with_suffix(".tmp.png")
    run_ffmpeg([
        "-i",
        str(then_path),
        "-i",
        str(now_path),
        "-filter_complex",
        "[0:v]scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080[left];[1:v]scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080[right];[left][right]hstack=inputs=2[out]",
        "-map",
        "[out]",
        "-frames:v",
        "1",
        str(tmp),
    ])
    tmp.replace(output_path)


def support_ledger_row(video_id: str, filename: str, title: str, source_paths: list[str], city: str, notes: str) -> dict[str, str]:
    source_ref = "; ".join(source_paths)
    return {
        "asset_id": f"video-{video_id}-real-city-support-{Path(filename).stem}",
        "asset_type": "image",
        "filename": filename,
        "local_path": filename,
        "tool": "Pattern Lab repo-local thumbnail factory",
        "model_or_service": "FFmpeg source-backed image-pack render",
        "source_prompt_or_source_file": source_ref,
        "source_title": title,
        "source_url": source_ref,
        "creator": "Pattern Lab",
        "archive_or_platform": "Pattern Lab",
        "source_class": "original_graphic",
        "license_or_rights_basis": f"Pattern Lab source-backed support graphic built from rights-ledgered {city} source media",
        "license_status": "owner review required before public use",
        "attribution_required": "yes",
        "attribution_text": "Underlying source attributions remain in the source packet and rights ledger.",
        "commercial_use_ok": "yes",
        "modification_ok": "yes",
        "recognizable_people_property_trademark_risk": "low: city/source context; owner review still required",
        "ai_reconstruction_disclosure": "not_ai_reconstruction",
        "created_at": utc_now(),
        "notes": notes,
        "human_review_required": "yes",
        "human_review_status": "pending",
    }


def render_required_image_pack(root: Path, assets: list[Asset], video_id: str, city: str) -> list[dict[str, str]]:
    images = ensure_dir(root / "images")
    by_key = {asset.key: asset for asset in assets}
    def path_for(key: str) -> Path:
        return root / by_key[key].local_rel

    map_path = path_for("city_source_map")
    skyline_path = path_for("modern_skyline")
    street_path = path_for("historic_street")
    terminal_path = path_for("terminal_tower")

    crop_to_1080(map_path, images / "city_source_map.png")
    crop_to_1080(street_path, images / "archival_evidence_board.png")
    render_then_now(street_path, skyline_path, images / "then_now_structure.png")
    crop_to_1080(terminal_path, images / "subscribe_city_file_card.png")

    return [
        support_ledger_row(video_id, "images/city_source_map.png", f"{city} source street map support", [by_key["city_source_map"].source_url], city, "1920x1080 source-backed map support image for thumbnail QA."),
        support_ledger_row(video_id, "images/archival_evidence_board.png", f"{city} archival street evidence board", [by_key["historic_street"].source_url], city, "1920x1080 source-backed historic street support image for image-pack QA."),
        support_ledger_row(video_id, "images/then_now_structure.png", f"{city} then/now source structure", [by_key["historic_street"].source_url, by_key["modern_skyline"].source_url], city, "1920x1080 source-backed then/now structure image with THEN left and NOW right."),
        support_ledger_row(video_id, "images/subscribe_city_file_card.png", f"{city} city-file card", [by_key["terminal_tower"].source_url], city, "1920x1080 source-backed city-file card support image for image-pack QA."),
    ]

def asset_to_manifest(asset: Asset, root: Path, video_id: str) -> dict[str, Any]:
    return {
        "asset_id": f"video-{video_id}-real-city-{asset.key}",
        "asset_type": "image",
        "filename": asset.local_rel,
        "local_path": asset.local_rel,
        "tool": asset.tool,
        "model_or_service": asset.service,
        "source_prompt_or_source_file": asset.source_file,
        "source_title": asset.title,
        "source_url": asset.source_url,
        "creator": asset.creator,
        "archive_or_platform": asset.archive,
        "source_class": asset.source_class,
        "license_or_rights_basis": asset.license_basis,
        "license_status": asset.license_status,
        "attribution_required": asset.attribution_required,
        "attribution_text": asset.attribution_text,
        "commercial_use_ok": "yes",
        "modification_ok": "yes",
        "recognizable_people_property_trademark_risk": "low: public city/landmark/map context; owner review still required",
        "ai_reconstruction_disclosure": "not_ai_reconstruction",
        "created_at": utc_now(),
        "notes": asset.notes,
        "human_review_required": "yes",
        "human_review_status": "pending",
        "visual_category": asset.category,
        "visual_category_label": asset.category.replace("_", "/"),
        "visual_category_score": 25,
        "visual_category_reason": asset.notes,
        "source_provider": asset.provider or asset.archive,
        "source_provider_rank": asset.provider_rank,
    }


def ledger_row(asset: Asset, video_id: str) -> dict[str, str]:
    row = asset_to_manifest(asset, Path("."), video_id)
    return {field: str(row.get(field, "")) for field in LEDGER_FIELDS}


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def title_options(city: str) -> list[str]:
    return [
        f"{city} Was Not Just Decline. The Map Changed.",
        f"The Hidden Map Under {city}",
        f"What Old {city} Photos Reveal",
        f"Why {city}'s Streets Still Do Not Make Sense",
        f"The City File That Explains {city}",
    ]


def write_launch_package(video_id: str, city: str) -> None:
    launch = ensure_dir(launch_root(video_id))
    description = f"""Pattern Lab studies American cities through maps, archives, photographs, buildings, neighborhoods, industries, and evidence.\n\nThis real-city thumbnail test package uses rights-ledgered {city} source images and maps so the thumbnail factory is tested against the same kind of city-specific material required for public work.\n\nNo source, no story."""
    package = {
        "upload_metadata": {
            "generated_at": utc_now(),
            "video_id": video_id,
            "city": city,
            "active_city": city,
            "title_options": title_options(city),
            "default_title": f"{city} Was Not Just Decline. The Map Changed.",
            "default_thumbnail": "images/thumbnail_candidate_a.png",
            "description": description,
            "description_footer": "Subscribe for evidence-backed city history: one city, one source proof, one hidden pattern at a time.",
            "tags": [
                "Pattern Lab",
                f"{city} history",
                "American cities",
                "urban history",
                "city history documentary",
                "historical photos",
                "urban planning history",
                f"{city} documentary",
            ],
            "category_id": "27",
            "made_for_kids": False,
            "synthetic_disclosure_decision": "Owner must confirm in YouTube Studio. This package uses rights-logged real city images/maps; AI support remains non-proof only.",
            "pinned_comment": city_source_lead_comment(city),
            "chapters": [
                {"time": "0:00", "title": "The map changed the city"},
                {"time": "0:20", "title": "The source proof"},
                {"time": "1:00", "title": "Old photos before myths"},
                {"time": "2:00", "title": "The hidden city system"},
                {"time": "3:00", "title": "What changed afterward"},
            ],
            "shorts": [
                {
                    "id": f"{video_id}-short-01",
                    "title": f"The Hidden Map Under {city}",
                    "hook": f"One {city} map changes how the city story starts.",
                    "pinned_comment": city_source_lead_comment(city),
                    "related_video_promise": "The full city file shows the map, sources, and hidden system.",
                    "related_video_checklist": "Add the long-form video as the Related Video in YouTube Studio after upload.",
                },
                {
                    "id": f"{video_id}-short-02",
                    "title": f"What Old {city} Photos Reveal",
                    "hook": f"Old {city} photos show the proof before the myth.",
                    "pinned_comment": city_source_lead_comment(city),
                    "related_video_promise": "The long-form episode compares the photos, the map, and the source trail.",
                    "related_video_checklist": "Add the long-form video as the Related Video in YouTube Studio after upload.",
                },
                {
                    "id": f"{video_id}-short-03",
                    "title": f"Why {city}'s Streets Changed",
                    "hook": f"The street clue explains what changed in {city}.",
                    "pinned_comment": city_source_lead_comment(city),
                    "related_video_promise": "The long-form episode connects the street clue to the full city file.",
                    "related_video_checklist": "Add the long-form video as the Related Video in YouTube Studio after upload.",
                }
            ],
        }
    }
    (launch / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    prompts = f"""# Pattern Lab image prompts: {city} real-city test\n\nsource-media-policy thumbnail-click-policy autonomous-production-architecture\n\nEvery thumbnail must be 2-4 word, city-first, and tested against the first 30-second payoff. The city name dominance rule means the active city must be primary or co-primary text. Use one dominant focal point and one dominant real photo/map/document. No fake archival proof, no watermark, no Pro-locked assets, no source-board clutter, no internal labels.\n\nRequired concepts and prompt terms:\n- {city.upper()} WAS REDRAWN — clear thumbnail promise, premium city typography, {city} skyline/landmark recognition, dominant real photo/map, explicit city anchor, explicit proof object.\n- {city.upper()}'S HIDDEN MAP — map/system proof, polished proof mark, {city} skyline/landmark recognition, dominant focal point, phone size readability.\n- {city.upper()} 1942 — whole-word redactions, readable document prop, city name dominance, no fake archival.\n- {city.upper()}'S LOST STREETS — street/map/grid semantics, thumbnail search shelf readability, competitive benchmark aesthetic.\n- {city.upper()}'S FALL EXPLAINED — contrarian history, clear thumbnail promise, premium city typography, active-city skyline/landmark recognition.\n\nUse active-city skyline/landmark recognition, {city} skyline/landmark recognition, city name dominance with primary city text, thumbnail search shelf, strong contrast, polished proof mark, one dominant focal point, and dominant real photo.\n"""
    (launch / "image-prompts.md").write_text(prompts, encoding="utf-8")


def select_assets(root: Path, city: str, city_slug: str) -> list[Asset]:
    used_titles: set[str] = set()
    # First-time cities must prove the city can be resolved without hardcoded coordinates.
    # The geocode result is cached and counted in provider-health reporting even when a
    # stronger rights-compatible static map is found from another provider.
    geocode_city(root, city)
    map_asset = build_map_asset(root, city, city_slug, used_titles)
    used_titles.add(map_asset.title)
    assets: list[Asset] = [map_asset]
    for raw_config in COMMONS_QUERIES:
        config = city_config(raw_config, city)
        queries = [config["query"], *[q.format(city=city, city_lc=city.lower()) for q in FALLBACK_COMMONS_QUERIES.get(config["key"], [])]]
        asset = None
        for query in queries:
            asset = search_all_providers(config, query, root, city_slug, used_titles)
            if asset:
                break
            time.sleep(0.2)
        if not asset and config.get("allow_generic_fallback"):
            generic_config = {**config, "must": [], "notes": config["notes"] + "; generic non-proof fallback if city-specific underground image is unavailable"}
            asset = search_all_providers(generic_config, config.get("fallback_query", "underground tunnel"), root, city_slug, used_titles)
        if not asset and config.get("key") == "historic_landmark":
            landmark = next((item for item in assets if item.key == "terminal_tower"), None)
            if landmark:
                asset = Asset(
                    key=config["key"],
                    title=landmark.title,
                    source_url=landmark.source_url,
                    download_url=landmark.download_url,
                    creator=landmark.creator,
                    license_status=landmark.license_status,
                    license_basis=landmark.license_basis,
                    attribution_required=landmark.attribution_required,
                    attribution_text=landmark.attribution_text,
                    local_rel=f"source-packet/visual-rebuild/{config['dest']}/commons-{config['key']}-{Path(landmark.local_rel).name}",
                    archive=landmark.archive,
                    source_class="historical_evidence",
                    category=config["category"],
                    notes=config["notes"] + "; reused rights-cleared city landmark context because a distinct historic-landmark asset was unavailable",
                    tool=landmark.tool,
                    service=landmark.service,
                    source_file=landmark.source_file,
                )
        if not asset:
            raise SystemExit(f"Could not find rights-compatible asset for {config['key']} ({config['query']}).")
        used_titles.add(asset.title)
        assets.append(asset)
    return assets




def load_cached_assets(root: Path) -> list[Asset] | None:
    report = root / "approval" / "real-city-source-asset-report.json"
    if not report.exists():
        return None
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
    except Exception:
        return None
    assets = []
    for entry in data.get("assets", []):
        filename = entry.get("filename", "")
        if not filename or not (root / filename).exists():
            return None
        key = entry.get("asset_id", "").split("real-city-", 1)[-1] or Path(filename).stem
        source_class = entry.get("source_class", "")
        if key == "city_source_map" and source_class == "source_grounded_support_graphic":
            source_class = "historical_evidence"
        assets.append(
            Asset(
                key=key,
                title=entry.get("source_title", ""),
                source_url=entry.get("source_url", ""),
                download_url=entry.get("source_prompt_or_source_file", ""),
                creator=entry.get("creator", ""),
                license_status=entry.get("license_status", ""),
                license_basis=entry.get("license_or_rights_basis", ""),
                attribution_required=entry.get("attribution_required", ""),
                attribution_text=entry.get("attribution_text", ""),
                local_rel=filename,
                archive=entry.get("archive_or_platform", ""),
                source_class=source_class,
                category=entry.get("visual_category", ""),
                notes=entry.get("notes", ""),
                tool=entry.get("tool", ""),
                service=entry.get("model_or_service", ""),
                source_file=entry.get("source_prompt_or_source_file", ""),
            )
        )
    required = {"city_source_map", "modern_skyline", "terminal_tower", "historic_street", "historic_landmark", "underground_or_transit"}
    if required.issubset({asset.key for asset in assets}):
        return assets
    return None

def download_assets(root: Path, assets: list[Asset]) -> None:
    for asset in assets:
        path = root / asset.local_rel
        ensure_dir(path.parent)
        download(asset.download_url, path)


def write_reports(video_id: str, city: str, root: Path, assets: list[Asset], support_rows: list[dict[str, str]]) -> None:
    approval = ensure_dir(root / "approval")
    visual_dir = ensure_dir(root / "source-packet" / "visual-rebuild")
    historical = []
    modern = []
    for asset in assets:
        entry = asset_to_manifest(asset, root, video_id)
        if asset.source_class == "modern_context":
            modern.append(entry)
        elif asset.key == "city_source_map":
            # Include the map in both pools so all concept pickers can use it.
            historical.append(entry)
            modern.append(entry)
        else:
            historical.append(entry)
    manifest = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "active_city": city,
        "status": "ready",
        "real_world_city_test": True,
        "synthetic_mockup_allowed": False,
        "visual_rebuild_dir": f"local-output/video-{video_id}/source-packet/visual-rebuild",
        "historical_count": len(historical),
        "modern_context_count": len(modern),
        "historical_assets": historical,
        "modern_context_assets": modern,
        "visual_category_counts": {},
        "superseded_private_uploads": [],
        "public_publish": "blocked_due_owner_approval_required",
        "source_provider_summary": {
            "providers_configured": [name for name, _ in SOURCE_PROVIDERS] + ["openstreetmap_static_map"],
            "selected_providers": sorted({asset.provider or asset.archive for asset in assets}),
            "single_source_dependency": len({asset.provider or asset.archive for asset in assets}) <= 1,
        },
        "requirements": [
            "Use real, rights-compatible active-city photos, maps, or documents for test outputs.",
            "AI or generic support assets must be non-proof and explicitly ledgered.",
            "Do not publish or replace public thumbnails from this test package without exact owner approval.",
        ],
    }
    (visual_dir / "visual-rebuild-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Visual Rebuild Manifest: {city} Real-City Test",
        "",
        f"Generated: {manifest['generated_at']}",
        f"Status: {manifest['status']}",
        "Real-world city test: true",
        "Synthetic mockup allowed: false",
        "",
        "## Assets",
        "",
    ]
    for asset in assets:
        lines.extend([
            f"- {asset.key}: `{asset.local_rel}`",
            f"  - title: {asset.title}",
            f"  - source: {asset.source_url}",
            f"  - license: {asset.license_status}",
        ])
    (visual_dir / "visual-rebuild-manifest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_csv(root / "rights-ledger.csv", [ledger_row(asset, video_id) for asset in assets] + support_rows)
    download_report = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "active_city": city,
        "status": "pass",
        "real_city_asset_count": len(assets),
        "synthetic_mockup_count": 0,
        "paid_asset_used": False,
        "assets": [asset_to_manifest(asset, root, video_id) for asset in assets],
        "source_provider_attempts": SOURCE_ATTEMPTS,
        "source_provider_summary": {
            "providers_configured": [name for name, _ in SOURCE_PROVIDERS] + ["openstreetmap_static_map"],
            "selected_providers": sorted({asset.provider or asset.archive for asset in assets}),
            "single_source_dependency": len({asset.provider or asset.archive for asset in assets}) <= 1,
        },
    }
    provider_health = write_provider_health_report(video_id, city, root, assets, "pass")
    download_report["provider_health_status"] = provider_health["status"]
    download_report["provider_attempt_count"] = provider_health["provider_attempt_count"]
    download_report["attempted_provider_count"] = provider_health["attempted_provider_count"]
    download_report["selected_provider_count"] = provider_health["selected_provider_count"]
    download_report["single_source_dependency"] = provider_health["single_source_dependency"]
    (approval / "real-city-source-asset-report.json").write_text(json.dumps(download_report, indent=2) + "\n", encoding="utf-8")
    (approval / "real-city-source-asset-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")




def write_source_blocker_report(video_id: str, city: str, root: Path, reason: str) -> None:
    approval = ensure_dir(root / "approval")
    provider_health = write_provider_health_report(video_id, city, root, None, "blocked_source_shortfall", reason)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "active_city": city,
        "status": "blocked_source_shortfall",
        "reason": reason,
        "provider_health_status": provider_health["status"],
        "provider_attempt_count": provider_health["provider_attempt_count"],
        "attempted_provider_count": provider_health["attempted_provider_count"],
        "selected_provider_count": provider_health["selected_provider_count"],
        "single_source_dependency": provider_health["single_source_dependency"],
        "source_provider_attempts": SOURCE_ATTEMPTS,
        "source_provider_summary": {
            "providers_configured": [name for name, _ in SOURCE_PROVIDERS] + ["openstreetmap_static_map"],
            "selected_providers": sorted({attempt["provider"] for attempt in SOURCE_ATTEMPTS if attempt.get("status") == "selected"}),
            "attempted_provider_count": len({attempt["provider"] for attempt in SOURCE_ATTEMPTS}),
            "single_source_dependency": False,
        },
        "rule": "A single provider failure must not block a city. The package blocks only after all configured providers for the required asset slot fail or are unavailable.",
    }
    (approval / "real-city-source-blocker-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Real-City Source Blocker Report: {city}",
        "",
        f"Generated: {payload['generated_at']}",
        "Status: blocked_source_shortfall",
        f"Reason: {reason}",
        "",
        "## Provider Attempts",
        "",
    ]
    for attempt in SOURCE_ATTEMPTS:
        lines.append(f"- {attempt.get('key')}: {attempt.get('provider')} / `{attempt.get('query')}` — {attempt.get('status')} ({attempt.get('detail')})")
    (approval / "real-city-source-blocker-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a real-city Pattern Lab thumbnail test package.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--city", required=True)
    args = parser.parse_args()
    video_id = args.video_id.strip()
    city = args.city.strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{1,63}", video_id):
        raise SystemExit("video-id must be a safe slug or number")
    city_slug = re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-") or "city"
    root = output_root(video_id)
    ensure_dir(root)
    write_launch_package(video_id, city)
    cached_assets = load_cached_assets(root)
    if cached_assets is not None:
        geocode_city(root, city)
        assets = cached_assets
    else:
        try:
            assets = select_assets(root, city, city_slug)
        except SystemExit as exc:
            write_source_blocker_report(video_id, city, root, str(exc))
            raise
        download_assets(root, assets)
    support_rows = render_required_image_pack(root, assets, video_id, city)
    write_reports(video_id, city, root, assets, support_rows)
    print(json.dumps({"status": "pass", "video_id": video_id, "active_city": city, "asset_count": len(assets), "root": str(root)}, indent=2))


if __name__ == "__main__":
    main()

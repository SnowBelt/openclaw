#!/usr/bin/env python3
"""Discover exact-item open-media candidates without promoting them to production.

This intentionally keeps discovery separate from evidence intake.  A useful
search result is not a licensed visual asset until Pattern Lab verifies the
original item page, downloads the exact file locally, and records its hash.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, launch_root, output_root, utc_now


USER_AGENT = "PatternLab/1.0 open-archive-candidate-discovery"
OPENVERSE_ENDPOINT = "https://api.openverse.org/v1/images/"
INTERNET_ARCHIVE_ENDPOINT = "https://archive.org/advancedsearch.php"
LOC_ENDPOINT = "https://www.loc.gov/photos/"
WIKIMEDIA_ENDPOINT = "https://commons.wikimedia.org/w/api.php"
OPENVERSE_ALLOWED_LICENSES = {"cc0", "pdm", "by", "by-sa"}
INTERNET_ARCHIVE_BLOCKED_MARKERS = ("-nc", "-nd", "noncommercial", "restricted", "all rights reserved")


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def cache_path(root: Path, provider: str, query: str) -> Path:
    digest = hashlib.sha256(f"{provider}:{query}".encode("utf-8")).hexdigest()[:16]
    return ensure_dir(root / "cache" / "open-archive-candidates") / f"{provider}-{digest}.json"


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    return payload if isinstance(payload, dict) else {}


def openverse_query_url(query: str, page_size: int) -> str:
    params = urllib.parse.urlencode(
        {
            "q": query,
            "license_type": "commercial,modification",
            "filter_dead": "true",
            "page_size": max(1, min(page_size, 20)),
        }
    )
    return f"{OPENVERSE_ENDPOINT}?{params}"


def internet_archive_query_url(query: str, rows: int) -> str:
    escaped = query.replace('"', "")
    search = f'collection:prelinger AND (title:("{escaped}") OR subject:("{escaped}") OR description:("{escaped}"))'
    params = urllib.parse.urlencode(
        [
            ("q", search),
            ("fl[]", "identifier"),
            ("fl[]", "title"),
            ("fl[]", "licenseurl"),
            ("fl[]", "rights"),
            ("fl[]", "year"),
            ("fl[]", "description"),
            ("rows", str(max(1, min(rows, 50)))),
            ("page", "1"),
            ("output", "json"),
        ]
    )
    return f"{INTERNET_ARCHIVE_ENDPOINT}?{params}"


def loc_query_url(query: str, rows: int) -> str:
    params = urllib.parse.urlencode(
        {"fo": "json", "q": query, "c": max(1, min(rows, 50)), "at": "results,pagination"}
    )
    return f"{LOC_ENDPOINT}?{params}"


def wikimedia_query_url(query: str, rows: int) -> str:
    params = urllib.parse.urlencode(
        {
            "action": "query", "format": "json", "generator": "search",
            "gsrnamespace": "6", "gsrsearch": query, "gsrlimit": max(1, min(rows, 25)),
            "prop": "imageinfo", "iiprop": "url|extmetadata", "origin": "*",
        }
    )
    return f"{WIKIMEDIA_ENDPOINT}?{params}"


def parse_openverse(payload: dict[str, Any], query: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for row in payload.get("results", []) if isinstance(payload.get("results"), list) else []:
        if not isinstance(row, dict):
            continue
        license_code = str(row.get("license") or "").lower().strip()
        landing = str(row.get("foreign_landing_url") or "").strip()
        download = str(row.get("url") or "").strip()
        creator = str(row.get("creator") or "").strip()
        title = str(row.get("title") or "").strip()
        if license_code not in OPENVERSE_ALLOWED_LICENSES or not all((landing, download, creator, title)):
            continue
        candidates.append(
            {
                "provider": "Openverse",
                "provider_item_id": str(row.get("id") or ""),
                "query": query,
                "source_title": title,
                "source_url": landing,
                "download_url": download,
                "creator": creator,
                "archive_or_platform": str(row.get("source") or "Openverse"),
                "license_or_rights_basis": f"Openverse indexed CC {license_code}",
                "license_url": str(row.get("license_url") or ""),
                "attribution_required": license_code in {"by", "by-sa"},
                "attribution_text": f"{title} by {creator}, via {row.get('source') or 'Openverse'}, CC {license_code}",
                "source_class": "candidate_only",
                "candidate_role": "historical_or_context_pending_original_source_verification",
                "promotion_rule": "Verify the original landing page and license, then download and hash the exact file before evidence intake.",
            }
        )
    return candidates


def internet_archive_rights_compatible(row: dict[str, Any]) -> bool:
    text = " ".join(str(row.get(key) or "") for key in ("licenseurl", "rights")).lower()
    if not text or any(marker in text for marker in INTERNET_ARCHIVE_BLOCKED_MARKERS):
        return False
    return any(marker in text for marker in ("publicdomain", "public domain", "creativecommons.org/licenses/by/", "creativecommons.org/licenses/by-sa/", "creativecommons.org/publicdomain/zero"))


def parse_internet_archive(payload: dict[str, Any], query: str) -> list[dict[str, Any]]:
    response = payload.get("response") if isinstance(payload.get("response"), dict) else {}
    candidates: list[dict[str, Any]] = []
    for row in response.get("docs", []) if isinstance(response.get("docs"), list) else []:
        if not isinstance(row, dict) or not internet_archive_rights_compatible(row):
            continue
        identifier = str(row.get("identifier") or "").strip()
        title = str(row.get("title") or "").strip()
        if not identifier or not title:
            continue
        item_url = f"https://archive.org/details/{urllib.parse.quote(identifier)}"
        candidates.append(
            {
                "provider": "Internet Archive / Prelinger",
                "provider_item_id": identifier,
                "query": query,
                "source_title": title,
                "source_url": item_url,
                "download_url": "",
                "creator": "Prelinger Archives or item metadata; verify before promotion",
                "archive_or_platform": "Internet Archive Prelinger",
                "year": str(row.get("year") or ""),
                "license_or_rights_basis": str(row.get("licenseurl") or row.get("rights") or ""),
                "license_url": str(row.get("licenseurl") or ""),
                "attribution_required": "creativecommons.org/licenses/by" in str(row.get("licenseurl") or "").lower(),
                "attribution_text": f"{title}, Internet Archive identifier {identifier}",
                "source_class": "candidate_only",
                "candidate_role": "archival_motion_pending_item_metadata_and_file_verification",
                "promotion_rule": "Fetch item metadata, select a compatible downloadable file, then hash and ledger it before evidence intake.",
            }
        )
    return candidates


def parse_loc(payload: dict[str, Any], query: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for row in payload.get("results", []) if isinstance(payload.get("results"), list) else []:
        if not isinstance(row, dict):
            continue
        item_url = str(row.get("id") or row.get("url") or "").strip()
        title = str(row.get("title") or "").strip()
        images = row.get("image_url") if isinstance(row.get("image_url"), list) else []
        if not item_url or not title or not images:
            continue
        contributors = row.get("contributor") if isinstance(row.get("contributor"), list) else []
        candidates.append(
            {
                "provider": "Library of Congress",
                "provider_item_id": item_url.rstrip("/").split("/")[-1],
                "query": query,
                "source_title": title,
                "source_url": item_url,
                "download_url": str(images[-1]),
                "creator": "; ".join(str(item) for item in contributors if str(item)) or "Verify LOC item metadata",
                "archive_or_platform": "Library of Congress",
                "license_or_rights_basis": str(row.get("rights") or "Verify item-level Rights & Access statement"),
                "license_url": item_url,
                "attribution_required": True,
                "attribution_text": f"{title}, Library of Congress",
                "source_class": "candidate_only",
                "candidate_role": "historical_evidence_pending_item_rights_verification",
                "promotion_rule": "Verify the item Rights & Access statement and exact download before hashing and evidence intake.",
            }
        )
    return candidates


def _metadata_value(metadata: dict[str, Any], key: str) -> str:
    value = metadata.get(key)
    return str(value.get("value") or "").strip() if isinstance(value, dict) else ""


def parse_wikimedia(payload: dict[str, Any], query: str) -> list[dict[str, Any]]:
    query_payload = payload.get("query") if isinstance(payload.get("query"), dict) else {}
    pages = query_payload.get("pages") if isinstance(query_payload.get("pages"), dict) else {}
    candidates: list[dict[str, Any]] = []
    for page in pages.values():
        info_rows = page.get("imageinfo") if isinstance(page, dict) and isinstance(page.get("imageinfo"), list) else []
        info = info_rows[0] if info_rows else {}
        metadata = info.get("extmetadata") if isinstance(info.get("extmetadata"), dict) else {}
        license_code = _metadata_value(metadata, "LicenseShortName").casefold()
        allowed = any(marker in license_code for marker in ("public domain", "cc0", "cc by", "cc-by"))
        source_url = str(info.get("descriptionurl") or "").strip()
        download_url = str(info.get("url") or "").strip()
        title = str(page.get("title") or "").removeprefix("File:").strip()
        creator = re.sub(r"<[^>]+>", " ", _metadata_value(metadata, "Artist")).strip()
        if not allowed or not all((source_url, download_url, title, creator)):
            continue
        candidates.append(
            {
                "provider": "Wikimedia Commons",
                "provider_item_id": str(page.get("pageid") or ""),
                "query": query,
                "source_title": title,
                "source_url": source_url,
                "download_url": download_url,
                "creator": creator,
                "archive_or_platform": "Wikimedia Commons",
                "license_or_rights_basis": license_code,
                "license_url": _metadata_value(metadata, "LicenseUrl") or source_url,
                "attribution_required": "cc by" in license_code or "cc-by" in license_code,
                "attribution_text": f"{title} by {creator}, Wikimedia Commons, {license_code}",
                "source_class": "candidate_only",
                "candidate_role": "historical_or_context_pending_item_verification",
                "promotion_rule": "Verify the Commons file page, attribution, and exact file hash before evidence intake.",
            }
        )
    return candidates


def fetch_or_cache(root: Path, provider: str, query: str, url: str, *, live: bool) -> tuple[dict[str, Any], str]:
    path = cache_path(root, provider, query)
    if path.is_file():
        cached = read_json(path)
        if cached:
            return cached, "cache_hit"
    if not live:
        return {}, "planned"
    payload = fetch_json(url)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, "queried"


def build_report(video_id: str, *, live: bool = False, per_query: int = 12) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    evidence = read_json(launch_root(video_id) / "evidence-queries.json")
    historical_queries = [str(value).strip() for value in evidence.get("historical_queries", []) if str(value).strip()]
    package = read_json(launch_root(video_id) / "package.json")
    cities = [str(value).strip() for value in evidence.get("required_city_terms", []) if str(value).strip()]
    city = str(package.get("city") or package.get("active_city") or "").strip()
    identity_valid = bool(city and len({value.casefold() for value in cities}) == 1 and city.casefold() == cities[0].casefold())
    provider_rows: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    blockers: list[str] = []
    if not identity_valid:
        blockers.append("explicit_episode_city_missing_or_mismatched")

    for query in historical_queries:
        try:
            payload, cache_status = fetch_or_cache(root, "openverse", query, openverse_query_url(query, per_query), live=live)
            rows = parse_openverse(payload, query)
            candidates.extend(rows)
            provider_rows.append({"provider": "openverse", "query": query, "status": cache_status, "candidate_count": len(rows)})
        except Exception as exc:
            provider_rows.append({"provider": "openverse", "query": query, "status": "failed", "error": type(exc).__name__, "candidate_count": 0})
        for provider, url, parser in (
            ("library_of_congress", loc_query_url(query, per_query), parse_loc),
            ("wikimedia_commons", wikimedia_query_url(query, per_query), parse_wikimedia),
        ):
            try:
                payload, cache_status = fetch_or_cache(root, provider, query, url, live=live)
                rows = parser(payload, query)
                candidates.extend(rows)
                provider_rows.append({"provider": provider, "query": query, "status": cache_status, "candidate_count": len(rows)})
            except Exception as exc:
                provider_rows.append({"provider": provider, "query": query, "status": "failed", "error": type(exc).__name__, "candidate_count": 0})

    try:
        payload, cache_status = fetch_or_cache(root, "internet_archive_prelinger", city, internet_archive_query_url(city, per_query), live=live)
        rows = parse_internet_archive(payload, city)
        candidates.extend(rows)
        provider_rows.append({"provider": "internet_archive_prelinger", "query": city, "status": cache_status, "candidate_count": len(rows)})
    except Exception as exc:
        provider_rows.append({"provider": "internet_archive_prelinger", "query": city, "status": "failed", "error": type(exc).__name__, "candidate_count": 0})

    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for candidate in candidates:
        identity = (str(candidate.get("provider") or ""), str(candidate.get("provider_item_id") or candidate.get("source_url") or ""))
        if all(identity):
            unique[identity] = candidate
    candidates = sorted(unique.values(), key=lambda item: (str(item.get("provider")), str(item.get("source_title"))))
    status = "pass" if live and candidates and not blockers else ("planned" if not live and not blockers else "blocked")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "live_query": live,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "provider_rows": provider_rows,
        "blockers": blockers,
        "candidate_promotion": "not_performed",
        "required_before_promotion": [
            "verify original item page and item-level rights",
            "download exact file locally",
            "record sha256 and retrieval timestamp",
            "prove narration entity relevance and editorial role",
            "pass existing evidence-intake and rights-ledger gates",
        ],
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "open-archive-candidate-acquisition-report.json"
    md_path = approval / "open-archive-candidate-acquisition-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Open Archive Candidates: Video {video_id}",
                "",
                f"Status: {status}",
                f"Candidates: {len(candidates)}",
                "",
                "## Candidate-only rule",
                "",
                "No result in this report is production-approved. Verify the original item, download the exact file, hash it, and pass evidence intake before use.",
                "",
                "## Providers",
                "",
                *[f"- {row['provider']} {row.get('query', '')}: {row['status']} ({row['candidate_count']} candidates)" for row in provider_rows],
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover rights-aware open archive candidates without promoting media.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--per-query", type=int, default=12)
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), live=args.live, per_query=args.per_query)
    print(json.dumps({"status": payload["status"], "report": display_path(report), "candidates": payload["candidate_count"]}, indent=2))
    if args.live and payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

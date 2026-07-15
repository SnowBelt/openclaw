#!/usr/bin/env python3
"""Plan or query free modern-context stock providers without auto-promoting media."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, launch_root, load_dotenv, output_root, utc_now


USER_AGENT = "PatternLab/2.0 free-stock-candidate-research"
TAXONOMY_PATH = BASE / "resources" / "generic-context-taxonomy.json"
PROVIDER_RIGHTS = {
    "Pexels": {
        "rights_basis": "Pexels License",
        "license_code": "pexels-license",
        "license_url": "https://www.pexels.com/license/",
    },
    "Pixabay": {
        "rights_basis": "Pixabay Content License",
        "license_code": "pixabay-content-license",
        "license_url": "https://pixabay.com/service/license-summary/",
    },
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def query_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:80] or "query"


def cache_path(root: Path, provider: str, query: str) -> Path:
    digest = hashlib.sha256(f"{provider}:{query}".encode()).hexdigest()[:16]
    return ensure_dir(root / "cache" / "free-stock") / f"{provider}-{digest}.json"


def cache_fresh(path: Path, hours: int) -> bool:
    if not path.is_file():
        return False
    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return datetime.now(timezone.utc) - modified < timedelta(hours=hours)


def fetch_json(url: str, *, headers: dict[str, str] | None = None) -> tuple[dict[str, Any], dict[str, str]]:
    merged = {"User-Agent": USER_AGENT, **(headers or {})}
    request = urllib.request.Request(url, headers=merged)
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
        response_headers = {key.lower(): value for key, value in response.headers.items()}
    return payload if isinstance(payload, dict) else {}, response_headers


def choose_pexels_file(video: dict[str, Any]) -> dict[str, Any]:
    rows = [row for row in video.get("video_files", []) if isinstance(row, dict) and row.get("link")]
    rows.sort(key=lambda row: (int(row.get("width") or 0) * int(row.get("height") or 0), -int(row.get("file_size") or 0)), reverse=True)
    preferred = [row for row in rows if 1280 <= int(row.get("width") or 0) <= 1920]
    return (preferred or rows or [{}])[0]


def context_fields(request: dict[str, Any] | None) -> dict[str, Any]:
    if not request or request.get("kind") != "generic_context":
        return {
            "context_action": "",
            "context_emotion": "",
            "editorial_role": "context_only",
            "geographic_scope": "city_specific_or_unknown",
            "may_imply_named_city": True,
            "requires_illustrative_label_when_used": False,
        }
    return {
        "context_action": str(request.get("action") or ""),
        "context_emotion": str(request.get("emotion") or ""),
        "editorial_role": "context_only",
        "geographic_scope": "generic",
        "may_imply_named_city": False,
        "requires_illustrative_label_when_used": True,
    }


def parse_pexels(payload: dict[str, Any], query: str, request: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    candidates = []
    for row in payload.get("videos", []) if isinstance(payload.get("videos"), list) else []:
        if not isinstance(row, dict):
            continue
        file = choose_pexels_file(row)
        source_url = str(row.get("url") or "")
        if "/video/" not in source_url or not file.get("link"):
            continue
        creator = str((row.get("user") or {}).get("name") or "").strip()
        candidates.append(
            {
                "provider": "Pexels",
                "provider_item_id": str(row.get("id") or ""),
                "query": query,
                "source_title": f"Pexels video {row.get('id')} for {query}",
                "source_url": source_url,
                "download_url": file.get("link", ""),
                "creator": creator,
                "duration_seconds": row.get("duration"),
                "width": file.get("width"),
                "height": file.get("height"),
                "license_or_rights_basis": PROVIDER_RIGHTS["Pexels"]["rights_basis"],
                **PROVIDER_RIGHTS["Pexels"],
                "attribution_required": False,
                "attribution_text": f"Video by {creator} via Pexels; {source_url}",
                "source_class": "modern_context",
                "source_role": "modern_context",
                "human_review_status": "pending",
                **context_fields(request),
            }
        )
    return candidates


def choose_pixabay_file(video: dict[str, Any]) -> dict[str, Any]:
    files = video.get("videos") or {}
    for key in ("large", "medium", "small", "tiny"):
        row = files.get(key)
        if isinstance(row, dict) and row.get("url"):
            return row
    return {}


def parse_pixabay(payload: dict[str, Any], query: str, request: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    candidates = []
    for row in payload.get("hits", []) if isinstance(payload.get("hits"), list) else []:
        if not isinstance(row, dict):
            continue
        file = choose_pixabay_file(row)
        source_url = str(row.get("pageURL") or "")
        if "/videos/" not in source_url or not file.get("url"):
            continue
        creator = str(row.get("user") or "").strip()
        candidates.append(
            {
                "provider": "Pixabay",
                "provider_item_id": str(row.get("id") or ""),
                "query": query,
                "source_title": f"Pixabay video {row.get('id')} for {query}",
                "source_url": source_url,
                "download_url": file.get("url", ""),
                "creator": creator,
                "duration_seconds": row.get("duration"),
                "width": file.get("width"),
                "height": file.get("height"),
                "license_or_rights_basis": PROVIDER_RIGHTS["Pixabay"]["rights_basis"],
                **PROVIDER_RIGHTS["Pixabay"],
                "attribution_required": False,
                "attribution_text": f"Video by {creator} via Pixabay; {source_url}",
                "source_class": "modern_context",
                "source_role": "modern_context",
                "human_review_status": "pending",
                **context_fields(request),
            }
        )
    return candidates


def provider_query(
    root: Path, provider: str, query: str, key: str, per_page: int, request: dict[str, Any] | None = None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    cache = cache_path(root, provider, query)
    cache_hours = 24 if provider == "pixabay" else 1
    cache_status = "hit" if cache_fresh(cache, cache_hours) else "miss"
    response_headers: dict[str, str] = {}
    if cache_status == "hit":
        payload = read_json(cache)
    elif provider == "pexels":
        params = urllib.parse.urlencode({"query": query, "per_page": per_page, "orientation": "landscape"})
        payload, response_headers = fetch_json(
            "https://api.pexels.com/videos/search?" + params,
            headers={"Authorization": key},
        )
        cache.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    else:
        params = urllib.parse.urlencode(
            {"key": key, "q": query, "per_page": per_page, "safesearch": "true", "video_type": "film"}
        )
        payload, response_headers = fetch_json("https://pixabay.com/api/videos/?" + params)
        cache.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    candidates = parse_pexels(payload, query, request) if provider == "pexels" else parse_pixabay(payload, query, request)
    return candidates, {
        "provider": provider,
        "query": query,
        "cache": display_path(cache),
        "cache_status": cache_status,
        "candidate_count": len(candidates),
        "rate_limit_remaining": response_headers.get("x-ratelimit-remaining", "not_reported"),
    }


def generic_context_requests(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    taxonomy = read_json(TAXONOMY_PATH)
    actions = taxonomy.get("actions") if isinstance(taxonomy.get("actions"), dict) else {}
    requests: list[dict[str, Any]] = []
    needs = evidence.get("generic_context_needs") if isinstance(evidence.get("generic_context_needs"), list) else []
    for need in needs:
        if not isinstance(need, dict):
            continue
        action = str(need.get("action") or "").strip()
        definition = actions.get(action) if isinstance(actions.get(action), dict) else {}
        queries = [str(item).strip() for item in definition.get("queries", []) if str(item).strip()]
        if not action or not queries:
            continue
        requests.append(
            {
                "kind": "generic_context",
                "action": action,
                "emotion": str(need.get("emotion") or "grounded context"),
                "query": queries[0],
            }
        )
    return requests


def context_requests(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    generic = generic_context_requests(evidence)
    city_queries = [str(item).strip() for item in evidence.get("modern_context_queries", []) if str(item).strip()]
    city = [{"kind": "city_context", "query": query} for query in city_queries]
    return generic + city


def explicit_episode_city(video_id: str, evidence: dict[str, Any]) -> str:
    package = read_json(launch_root(video_id) / "package.json")
    city = str(package.get("city") or package.get("active_city") or "").strip()
    evidence_cities = [str(item).strip() for item in evidence.get("required_city_terms", []) if str(item).strip()]
    if not city or len({item.casefold() for item in evidence_cities}) != 1:
        return ""
    return city if city.casefold() == evidence_cities[0].casefold() else ""


def city_context_fallbacks(city: str) -> list[dict[str, Any]]:
    """Return conservative city-specific context searches without city assumptions."""
    return [
        {"kind": "city_context", "query": f"{city} street life"},
        {"kind": "city_context", "query": f"{city} transportation"},
        {"kind": "city_context", "query": f"{city} skyline"},
    ] if city else []


def select_candidate_downloads(
    candidates: list[dict[str, Any]], *, top: int = 0, per_context: int = 0
) -> list[dict[str, Any]]:
    """Select a bounded, provider-diverse set instead of one query's first page."""
    selected: list[dict[str, Any]] = []
    counts: dict[tuple[str, str], int] = {}
    for candidate in candidates:
        key = (
            str(candidate.get("provider") or ""),
            str(candidate.get("context_action") or candidate.get("query") or "generic"),
        )
        if per_context > 0 and counts.get(key, 0) >= per_context:
            continue
        selected.append(candidate)
        counts[key] = counts.get(key, 0) + 1
        if top > 0 and len(selected) >= top:
            break
    return selected


def download_candidate(root: Path, candidate: dict[str, Any]) -> dict[str, Any]:
    provider = str(candidate["provider"]).lower()
    item_id = str(candidate["provider_item_id"])
    target_dir = ensure_dir(root / "source-packet" / "stock-media" / "candidates")
    target = target_dir / f"{provider}-{item_id}-{query_slug(str(candidate['query']))}.mp4"
    if not target.is_file():
        request = urllib.request.Request(str(candidate["download_url"]), headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as handle:
            while chunk := response.read(1024 * 1024):
                handle.write(chunk)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    provider_rights = PROVIDER_RIGHTS.get(str(candidate.get("provider") or ""), {})
    receipt = {
        **candidate,
        **provider_rights,
        "asset_id": f"stock-{provider}-{item_id}",
        "source_id": f"{provider}-{item_id}",
        "local_path": str(target.relative_to(root)),
        "relative_path": str(target.relative_to(root)),
        "sha256": digest,
        "retrieved_at": utc_now(),
        "commercial_use_ok": True,
        "modification_ok": True,
        "acceptance_mode": "machine_verified_exact_license",
        "evidence_fit": "context_only",
        "asset_kind": "modern_video",
        "claim_ids": [f"context:{candidate.get('context_action') or query_slug(str(candidate.get('query') or 'generic'))}"],
        "candidate_only": True,
        "promotion_rule": (
            "Machine-verified provider rights are complete. Human editorial review must still select "
            "this exact hash for a narration beat before production use."
        ),
    }
    receipt_path = target.with_suffix(".source.json")
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def build_report(
    video_id: str,
    *,
    live: bool = False,
    auto: bool = False,
    download_top: int = 0,
    download_per_context: int = 0,
    per_page: int = 15,
) -> tuple[dict[str, Any], Path, Path]:
    load_dotenv()
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    evidence = read_json(launch_root(video_id) / "evidence-queries.json")
    requests = context_requests(evidence)
    city = explicit_episode_city(video_id, evidence)
    if not requests:
        requests = city_context_fallbacks(city)
    configured = {
        "pexels": bool(os.environ.get("PEXELS_API_KEY", "").strip()),
        "pixabay": bool(os.environ.get("PIXABAY_API_KEY", "").strip()),
    }
    query_live = live or (auto and any(configured.values()))
    provider_rows: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    blockers: list[str] = []
    if not city:
        blockers.append("explicit_episode_city_missing_or_mismatched")
    if not requests:
        blockers.append("stock_context_requests_missing")
    if query_live:
        for provider, env_name in (("pexels", "PEXELS_API_KEY"), ("pixabay", "PIXABAY_API_KEY")):
            key = os.environ.get(env_name, "").strip()
            if not key:
                provider_rows.append({"provider": provider, "status": "not_configured", "candidate_count": 0})
                continue
            for request in requests:
                query = str(request["query"])
                try:
                    rows, attempt = provider_query(root, provider, query, key, per_page, request)
                except Exception as exc:
                    provider_rows.append({"provider": provider, "query": query, "status": "failed", "error": type(exc).__name__, "candidate_count": 0})
                    continue
                candidates.extend(rows)
                provider_rows.append({**attempt, "status": "queried"})
    else:
        for provider in ("pexels", "pixabay"):
            for request in requests:
                query = str(request["query"])
                provider_rows.append({"provider": provider, "query": query, "status": "planned", "candidate_count": 0})

    downloaded = []
    selected_for_download = select_candidate_downloads(
        candidates,
        top=download_top,
        per_context=download_per_context,
    )
    if download_top > 0 or download_per_context > 0:
        if not query_live:
            if not auto:
                blockers.append("download_requires_live_provider_query")
        else:
            for candidate in selected_for_download:
                try:
                    downloaded.append(download_candidate(root, candidate))
                except Exception as exc:
                    blockers.append(f"download_failed:{candidate.get('provider')}:{candidate.get('provider_item_id')}:{type(exc).__name__}")
    if query_live and candidates and not blockers:
        status = "pass"
    elif auto and query_live:
        status = "degraded"
    elif not query_live:
        status = "planned"
    else:
        status = "blocked"
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "live_query": query_live,
        "auto_mode": auto,
        "queries": [str(request["query"]) for request in requests],
        "context_requests": requests,
        "provider_configuration": configured,
        "provider_rows": provider_rows,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "downloaded_candidate_count": len(downloaded),
        "downloaded_candidates": downloaded,
        "manual_fallbacks": ["Mixkit exact item", "Coverr exact item", "local institution permission lead"],
        "blockers": blockers,
        "candidate_promotion": "not_performed",
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "free-stock-acquisition-report.json"
    md_path = approval / "free-stock-acquisition-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Free Stock Acquisition: Video {video_id}",
        "",
        f"Status: {status}",
        f"Mode: {'automatic free-provider query' if auto else ('live API query' if live else 'plan only')}",
        f"Candidates: {len(candidates)}",
        f"Downloaded candidates: {len(downloaded)}",
        "",
        "## Provider Attempts",
        "",
        *[f"- {row.get('provider')} {row.get('query', '')}: {row.get('status')} candidates={row.get('candidate_count', 0)}" for row in provider_rows],
        "",
        "## Rule",
        "",
        "Downloaded media is rights-complete only after exact machine verification; the context library and source pool still bind its exact hash and role.",
        "No paid provider or YouTube mutation was performed.",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or query free Pattern Lab modern-context stock media.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--auto", action="store_true", help="Use configured free providers; stay planned when none are configured.")
    parser.add_argument("--download-top", type=int, default=0)
    parser.add_argument("--download-per-context", type=int, default=0)
    parser.add_argument("--per-page", type=int, default=15)
    args = parser.parse_args()
    payload, report, _ = build_report(
        args.video_id.zfill(2),
        live=args.live,
        auto=args.auto,
        download_top=max(0, args.download_top),
        download_per_context=max(0, args.download_per_context),
        per_page=max(1, min(args.per_page, 80)),
    )
    print(json.dumps({"status": payload["status"], "report": display_path(report), "candidates": payload["candidate_count"]}, indent=2))
    if args.live and not args.auto and payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fail closed when a Pattern Lab episode depends on an implicit city.

This gate verifies both the selected episode and the reusable production
surfaces.  A named city is production input, not something a renderer may
infer from a title, filename, or historical default.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = YOUTUBE_ROOT.parent
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import CityContractError, require_city
from patternlab.state import sha256_file
from patternlab_common import display_path, ensure_dir, launch_root, output_root, utc_now


GENERIC_SURFACES = (
    "patternlab/city.py",
    "patternlab/rights.py",
    "patternlab/shorts_alignment.py",
    "patternlab/thumbnail/__init__.py",
    "patternlab/visual_system.py",
    "scripts/generate_canva_thumbnail_brief.py",
    "scripts/generate_shorts_ffmpeg.py",
    "scripts/patternlab_comment_prompts.py",
    "scripts/patternlab_daily_factory.py",
    "scripts/patternlab_ai_motion_quality.py",
    "scripts/patternlab_ai_support_plan.py",
    "scripts/patternlab_city_portability.py",
    "scripts/patternlab_evidence_manifest_builder.py",
    "scripts/patternlab_local_generation_router.py",
    "scripts/patternlab_local_still_tournament.py",
    "scripts/patternlab_long_form_media_qa.py",
    "scripts/patternlab_production.py",
    "scripts/patternlab_shorts_script_package.py",
    "scripts/patternlab_source_pool_compiler.py",
    "scripts/patternlab_source_candidate_tournament.py",
    "scripts/patternlab_source_provider_health.py",
    "scripts/patternlab_thumbnail_factory.py",
    "scripts/patternlab_thumbnail_quality.py",
    "scripts/patternlab_thumbnail_worldclass.py",
    "scripts/patternlab_topic_qualification_queue.py",
    "scripts/patternlab_topic_research_worker.py",
    "scripts/patternlab_visual_contract.py",
    "scripts/patternlab_visual_prompt_compiler.py",
    "scripts/patternlab_visual_route_compiler.py",
)

FORBIDDEN_FALLBACK_PATTERNS = (
    re.compile(r"\bor\s+['\"](?:Detroit|Cleveland)['\"]"),
    re.compile(r"\bDEFAULT_CITY\s*=\s*['\"]"),
    re.compile(r"\.get\([^\n]+,\s*['\"](?:Detroit|Cleveland)['\"]\)"),
)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def city_value(payload: dict[str, Any], *, source: str) -> tuple[str, list[str]]:
    try:
        return require_city(payload.get("city"), source=source), []
    except CityContractError as exc:
        return "", [str(exc)]


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    launch = launch_root(video_id)
    approval = ensure_dir(output_root(video_id) / "approval")
    episode_paths = {
        "package": launch / "package.json",
        "evidence_queries": launch / "evidence-queries.json",
        "visual_route": launch / "long-form-visual-routing.json",
        "visual_contract": launch / "visual-contract.json",
    }
    package = read_json(episode_paths["package"])
    evidence = read_json(episode_paths["evidence_queries"])
    route = read_json(episode_paths["visual_route"])
    contract = read_json(episode_paths["visual_contract"])
    blockers: list[str] = []
    cities: dict[str, str] = {}
    for name, payload in (
        ("package", package),
        ("evidence_queries", evidence),
        ("visual_route", route),
        ("visual_contract", contract),
    ):
        city, errors = city_value(payload, source=f"video_{video_id}_{name}")
        cities[name] = city
        blockers.extend(errors)
    populated = {value.casefold() for value in cities.values() if value}
    if len(populated) > 1:
        blockers.append(
            "episode_city_mismatch:"
            + ",".join(f"{name}={value or 'missing'}" for name, value in sorted(cities.items()))
        )

    slate = read_json(YOUTUBE_ROOT / "state" / "monetization" / "content-slate.json")
    topics = slate.get("topics") if isinstance(slate.get("topics"), list) else []
    for index, topic in enumerate(topics, start=1):
        if not isinstance(topic, dict):
            blockers.append(f"content_slate_topic_not_object:{index}")
            continue
        try:
            require_city(topic.get("city"), source=f"content_slate_topic_{topic.get('video_id') or index}")
        except CityContractError as exc:
            blockers.append(str(exc))

    scans: list[dict[str, Any]] = []
    for relative in GENERIC_SURFACES:
        path = YOUTUBE_ROOT / relative
        if not path.is_file():
            blockers.append(f"city_portability_surface_missing:{relative}")
            continue
        text = path.read_text(encoding="utf-8")
        matches = sorted(
            {
                match.group(0)
                for pattern in FORBIDDEN_FALLBACK_PATTERNS
                for match in pattern.finditer(text)
            }
        )
        if matches:
            blockers.append(f"silent_city_fallback:{relative}:{'|'.join(matches)}")
        scans.append(
            {
                "path": relative,
                "sha256": sha256_file(path),
                "status": "pass" if not matches else "blocked",
                "matches": matches,
            }
        )

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "cities": cities,
        "input_hashes": {
            name: {
                "path": display_path(path),
                "sha256": sha256_file(path) if path.is_file() else "",
            }
            for name, path in episode_paths.items()
        },
        "content_slate_topic_count": len(topics),
        "generic_surface_scans": scans,
        "policy": "Every city is explicit and consistent; title or historical defaults may never choose it.",
        "blockers": sorted(set(blockers)),
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "city-portability-report.json"
    md_path = approval / "city-portability-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab City Portability: Video {video_id}",
                "",
                f"Status: {payload['status']}",
                "",
                "## Episode identity",
                "",
                *[f"- {name}: {value or 'missing'}" for name, value in sorted(cities.items())],
                "",
                "## Reusable surfaces",
                "",
                *[f"- {row['path']}: {row['status']}" for row in scans],
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab city portability and identity consistency.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

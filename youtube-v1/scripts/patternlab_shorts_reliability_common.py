#!/usr/bin/env python3
"""Shared helpers for Pattern Lab Shorts reliability reports."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_shorts_script_package import CONTEXT_DEPENDENT_STARTS, MIN_SCORE, build_shorts_script_package

SOURCE_LEAD_TERMS = (
    "street",
    "business",
    "church",
    "club",
    "building",
    "school",
    "theater",
    "factory",
    "map",
    "photo",
    "neighborhood",
    "family story",
)
LOCAL_TERMS = (
    "detroit",
    "black bottom",
    "paradise valley",
    "hastings",
    "st. antoine",
    "i-375",
    "lafayette park",
)
PROOF_TERMS = (
    "map",
    "source",
    "proof",
    "ledger",
    "evidence",
    "archive",
    "photo",
    "document",
    "street",
    "business",
    "route",
    "footprint",
)
GENERIC_COMMENT_PROMPTS = (
    "what do you think",
    "thoughts?",
    "comment below",
    "let us know",
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def script_package(video_id: str) -> dict[str, Any]:
    payload, _json_path, _md_path = build_shorts_script_package(video_id)
    return payload


def approval_dir(video_id: str) -> Path:
    return ensure_dir(output_root(video_id) / "approval")


def report_paths(video_id: str, stem: str) -> tuple[Path, Path]:
    approval = approval_dir(video_id)
    return approval / f"{stem}.json", approval / f"{stem}.md"


def write_report(video_id: str, stem: str, title: str, payload: dict[str, Any], sections: list[tuple[str, list[str]]] | None = None) -> tuple[dict[str, Any], Path, Path]:
    json_path, md_path = report_paths(video_id, stem)
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# {title}: Video {video_id}",
        "",
        f"Generated: {payload.get('generated_at', utc_now())}",
        f"Status: {payload.get('status', 'missing')}",
        "Public YouTube mutation: not_performed",
        "External paid service calls: not_performed",
        "",
    ]
    for heading, items in sections or []:
        lines.extend([f"## {heading}", ""])
        lines.extend(items or ["- none"])
        lines.append("")
    lines.extend(["## Blockers", ""])
    lines.extend([f"- {item}" for item in payload.get("blockers", [])] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {item}" for item in payload.get("warnings", [])] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def complete_sentence(text: str) -> bool:
    return bool(str(text or "").strip()) and str(text or "").strip()[-1] in ".!?"


def starts_context_dependent(text: str) -> bool:
    return str(text or "").strip().lower().startswith(CONTEXT_DEPENDENT_STARTS)


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", str(text or "")))


def contains_any(text: str, terms: tuple[str, ...]) -> bool:
    lower = str(text or "").lower()
    return any(term in lower for term in terms)


def short_ref(item: dict[str, Any]) -> str:
    return f"Short {item.get('index', '?')} ({item.get('title', 'untitled')})"


def script_items(package: dict[str, Any]) -> list[dict[str, Any]]:
    return list(package.get("shorts") or [])


def overlay_exists(root: Path, video_id: str, index: int, kind: str = "first") -> Path:
    return root / "shorts" / "overlays" / f"pattern-lab-video-{video_id}-short-{index:02d}-{kind}.png"


def status_pass(blockers: list[str]) -> str:
    return "pass" if not blockers else "blocked"


def displayed(path: Path) -> str:
    return display_path(path)


def minimum_script_package_ok(package: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    if not package:
        blockers.append("Shorts script package is missing.")
        return blockers
    if package.get("status") != "pass":
        blockers.append("Shorts script package is not passing.")
    if len(script_items(package)) < 3:
        blockers.append(f"Shorts script package must include at least 3 Shorts; found {len(script_items(package))}.")
    for item in script_items(package):
        if int(item.get("score") or 0) < MIN_SCORE:
            blockers.append(f"{short_ref(item)} score is below {MIN_SCORE}.")
    return blockers

#!/usr/bin/env python3
"""Shared fail-closed helpers for Pattern Lab final-media QA."""
from __future__ import annotations

import json
import hashlib
import re
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, display_path, ensure_dir, utc_now


POLICY_PATH = BASE / "resources" / "media-qa-policy.json"
QA_CONTRACT_PATHS = (
    BASE / "resources" / "media-qa-policy.json",
    BASE / "resources" / "visual-quality-rubric.json",
    BASE / "resources" / "local-visual-model-benchmark-policy.json",
    BASE / "resources" / "visual-judge-benchmark-suite.json",
    BASE / "scripts" / "patternlab_media_qa_common.py",
    BASE / "scripts" / "patternlab_thumbnail_pixel_quality.py",
    BASE / "scripts" / "patternlab_thumbnail_scorecard.py",
    BASE / "scripts" / "patternlab_audio_quality.py",
    BASE / "scripts" / "patternlab_rendered_media_quality.py",
    BASE / "scripts" / "patternlab_historical_motion_quality.py",
    BASE / "scripts" / "patternlab_historical_parallax.py",
    BASE / "scripts" / "patternlab_ai_motion_quality.py",
    BASE / "scripts" / "patternlab_visual_retention_quality.py",
    BASE / "scripts" / "patternlab_local_still_tournament.py",
    BASE / "scripts" / "patternlab_visual_judge.py",
    BASE / "scripts" / "patternlab_local_visual_model_benchmark.py",
    BASE / "scripts" / "patternlab_local_visual_judge_runner.py",
    BASE / "scripts" / "patternlab_long_form_sequence_quality.py",
    BASE / "scripts" / "patternlab_local_sequence_judge.py",
    BASE / "scripts" / "patternlab_long_form_media_qa.py",
    BASE / "scripts" / "patternlab_closed_captions.py",
    BASE / "scripts" / "patternlab_shorts_first_frame_quality.py",
    BASE / "scripts" / "patternlab_shorts_pacing_quality.py",
    BASE / "scripts" / "patternlab_shorts_quality.py",
    BASE / "scripts" / "patternlab_media_qa.py",
    BASE / "scripts" / "patternlab_media_qa_e2e.py",
)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def load_policy() -> dict[str, Any]:
    return read_json(POLICY_PATH)


def qa_contract_hash() -> str:
    digest = hashlib.sha256()
    for path in QA_CONTRACT_PATHS:
        digest.update(str(path.relative_to(BASE)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes() if path.exists() else b"MISSING")
        digest.update(b"\0")
    return digest.hexdigest()


def normalize_tokens(value: str | list[Any]) -> list[str]:
    text = " ".join(str(item) for item in value) if isinstance(value, list) else str(value or "")
    return re.findall(r"[a-z0-9]+", text.lower())


def resolve_youtube_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BASE / path


def strict_score(blockers: list[str], warnings: list[str] | None = None) -> int:
    warnings = warnings or []
    score = max(0, 100 - 8 * len(set(blockers)) - 2 * len(set(warnings)))
    return min(score, 92) if blockers else score


def write_report(
    approval: Path,
    stem: str,
    title: str,
    payload: dict[str, Any],
    *,
    extra_lines: list[str] | None = None,
) -> tuple[Path, Path]:
    ensure_dir(approval)
    json_path = approval / f"{stem}.json"
    md_path = approval / f"{stem}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# {title}",
        "",
        f"Generated: {payload.get('generated_at', utc_now())}",
        f"Status: {payload.get('status', 'blocked')}",
        f"Minimum score: {payload.get('minimum_score', 93)}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in payload.get("blockers", [])] or ["- none"]),
        "",
        "## Warnings",
        "",
        *([f"- {item}" for item in payload.get("warnings", [])] or ["- none"]),
    ]
    if extra_lines:
        lines.extend(["", *extra_lines])
    lines.extend(["", "YouTube mutation: not performed", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def report_reference(path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    from patternlab.state import sha256_file

    return {
        "path": display_path(path),
        "exists": path.exists(),
        "sha256": sha256_file(path) if path.exists() else "",
        "status": payload.get("status", "missing"),
        "minimum_asset_score": payload.get("minimum_asset_score", payload.get("minimum_score")),
    }

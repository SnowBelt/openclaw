"""Repository adapter for the canonical thumbnail review manifest.

The JSON file remains the backwards-compatible interchange contract used by
existing Pattern Lab scripts.  Centralizing its lookup and parsing prevents
pixel, semantic, typography, and aggregate QA from silently using different
candidate sets when a malformed manifest is encountered.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


THUMBNAIL_REVIEW_MANIFEST_FILENAME = "thumbnail-codex-primary-review.json"


@dataclass(frozen=True)
class ThumbnailCandidateManifest:
    """Validated read model for one release candidate's thumbnail package."""

    path: Path
    candidates: tuple[dict[str, Any], ...]

    @property
    def exists(self) -> bool:
        return self.path.is_file()


def read_json_mapping(path: Path) -> dict[str, Any]:
    """Read a JSON object without letting an invalid optional report crash QA."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def thumbnail_review_manifest_path(root: Path) -> Path:
    return Path(root) / "approval" / THUMBNAIL_REVIEW_MANIFEST_FILENAME


def load_thumbnail_candidate_manifest(root: Path) -> ThumbnailCandidateManifest:
    """Load only object candidates from the canonical review manifest.

    Invalid list members remain invalid at the producer boundary, but they
    cannot crash unrelated QA gates.  The empty result is intentionally
    fail-closed: callers must add their own explicit missing-manifest blocker.
    """
    path = thumbnail_review_manifest_path(root)
    payload = read_json_mapping(path)
    raw_candidates = payload.get("candidates", [])
    if not isinstance(raw_candidates, list):
        raw_candidates = []
    candidates = tuple(candidate for candidate in raw_candidates if isinstance(candidate, dict))
    return ThumbnailCandidateManifest(path=path, candidates=candidates)

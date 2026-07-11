"""Fail-closed owner-review release gates."""
from __future__ import annotations


REQUIRED_OWNER_REVIEW_GATES = (
    "package_hash",
    "canonical_preflight",
    "canonical_release",
    "canonical_render",
    "render_quality",
    "long_form_quality",
    "shorts_quality",
    "thumbnail_quality",
    "episode_standard",
    "voice_visual_match",
    "finished_watchdown",
)


def owner_review_gate_statuses(*, package_hash: str, canonical_preflight: str,
                               canonical_release: str, long_form_quality: str,
                               shorts_quality: str, thumbnail_quality: str,
                               episode_standard: str, voice_visual_match: str,
                               finished_watchdown: str, canonical_render: str = "missing",
                               render_quality: str = "missing") -> dict[str, str]:
    """Return the complete, explicit gate set required before owner review."""
    return {
        "package_hash": package_hash or "missing",
        "canonical_preflight": canonical_preflight or "missing",
        "canonical_release": canonical_release or "missing",
        "canonical_render": canonical_render or "missing",
        "render_quality": render_quality or "missing",
        "long_form_quality": long_form_quality or "missing",
        "shorts_quality": shorts_quality or "missing",
        "thumbnail_quality": thumbnail_quality or "missing",
        "episode_standard": episode_standard or "missing",
        "voice_visual_match": voice_visual_match or "missing",
        "finished_watchdown": finished_watchdown or "missing",
    }


def owner_review_status(gates: dict[str, str]) -> str:
    """A package is reviewable only when every canonical gate is passing."""
    return "ready-for-owner-review" if all(gates.get(name) == "pass" for name in REQUIRED_OWNER_REVIEW_GATES) else "blocked-before-owner-review"


def owner_review_blockers(gates: dict[str, str]) -> list[str]:
    return [f"{name}:{gates.get(name, 'missing')}" for name in REQUIRED_OWNER_REVIEW_GATES if gates.get(name) != "pass"]

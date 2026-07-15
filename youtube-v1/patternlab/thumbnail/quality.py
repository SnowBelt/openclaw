"""Pure aggregate helpers for thumbnail quality adapters."""
from __future__ import annotations

from typing import Any, Iterable


def candidate_issues(
    rows: Iterable[dict[str, Any]],
    key: str,
    *,
    deduplicate: bool = False,
) -> list[str]:
    """Return candidate-qualified issue codes without changing legacy ordering.

    Some existing reports intentionally preserve repeated warnings.  Callers
    opt into deduplication only where the legacy adapter already did so.
    """
    issues: list[str] = []
    for row in rows:
        candidate_id = str(row.get("id") or row.get("file") or "unknown")
        values = row.get(key, [])
        if not isinstance(values, list):
            continue
        issues.extend(f"{candidate_id}:{value}" for value in values if str(value))
    return sorted(set(issues)) if deduplicate else issues


def quality_status(*, has_candidates: bool, blockers: Iterable[str]) -> str:
    """Preserve Pattern Lab's fail-closed final-asset rule."""
    return "pass" if has_candidates and not list(blockers) else "blocked"

"""Deterministic production acceptance for Pattern Lab source assets.

Owner review happens at the package boundary.  Individual source assets may be
promoted without an extra owner click only when their exact item, download,
license, retrieval time, local bytes, and commercial/modification permissions
are all recorded.  Ambiguous or restrictive rights always fail closed.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from patternlab.state import sha256_file


MACHINE_ACCEPTED_LICENSE_CODES = frozenset(
    {
        "public-domain",
        "no-known-copyright-restrictions",
        "cc0-1.0",
        "cc-by-2.0",
        "cc-by-3.0",
        "cc-by-4.0",
        "cc-by-sa-2.0",
        "cc-by-sa-3.0",
        "cc-by-sa-4.0",
        "pexels-license",
        "pixabay-content-license",
        "mixkit-free-license",
        "coverr-license",
    }
)

AMBIGUOUS_RIGHTS_TERMS = (
    "unknown rights",
    "rights unknown",
    "pending",
    "editorial only",
    "noncommercial",
    "non-commercial",
    "no derivatives",
    "no-derivatives",
    "cc by-nc",
    "cc by-nd",
)

SEARCH_PATH_MARKERS = ("/search/", "/search?", "/results/", "/discover/")


def truthy(value: object) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().casefold() in {"1", "true", "yes", "approved", "accept"}


def exact_http_url(value: object) -> bool:
    rendered = str(value or "").strip()
    parsed = urlparse(rendered)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    lowered = rendered.casefold()
    return not any(marker in lowered for marker in SEARCH_PATH_MARKERS)


def valid_retrieved_at(value: object) -> bool:
    rendered = str(value or "").strip()
    if not rendered:
        return False
    try:
        parsed = datetime.fromisoformat(rendered.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def resolve_recorded_path(raw: object, *, episode_root: Path, youtube_root: Path) -> Path | None:
    rendered = str(raw or "").strip()
    if not rendered:
        return None
    path = Path(rendered).expanduser()
    if path.is_absolute():
        return path
    for candidate in (episode_root / path, youtube_root / path):
        if candidate.exists():
            return candidate
    return episode_root / path


def acceptance_blockers(item: dict[str, Any], *, episode_root: Path, youtube_root: Path) -> list[str]:
    """Return exact reasons an asset cannot enter the production source pool."""
    asset_id = str(item.get("asset_id") or "missing")
    blockers: list[str] = []
    if not truthy(item.get("commercial_use_ok")) or not truthy(item.get("modification_ok")):
        blockers.append(f"source_pool_rights_not_commercial_modifiable:{asset_id}")
    rights = str(item.get("rights_basis") or "").strip().casefold()
    if not rights or any(term in rights for term in AMBIGUOUS_RIGHTS_TERMS):
        blockers.append(f"source_pool_rights_ambiguous:{asset_id}")

    if truthy(item.get("human_accepted")):
        return sorted(set(blockers))

    mode = str(item.get("acceptance_mode") or "").strip()
    if mode == "machine_verified_exact_license":
        for field in ("source_url", "download_url", "license_url"):
            if not exact_http_url(item.get(field)):
                blockers.append(f"source_pool_machine_acceptance_exact_{field}_missing:{asset_id}")
        if not valid_retrieved_at(item.get("retrieved_at")):
            blockers.append(f"source_pool_machine_acceptance_retrieved_at_missing:{asset_id}")
        license_code = str(item.get("license_code") or "").strip().casefold()
        if license_code not in MACHINE_ACCEPTED_LICENSE_CODES:
            blockers.append(f"source_pool_machine_acceptance_license_not_allowlisted:{asset_id}:{license_code or 'missing'}")
        local_path = resolve_recorded_path(
            item.get("relative_path") or item.get("local_path"),
            episode_root=episode_root,
            youtube_root=youtube_root,
        )
        if local_path is None or not local_path.is_file() or local_path.stat().st_size == 0:
            blockers.append(f"source_pool_machine_acceptance_local_file_missing:{asset_id}")
        else:
            expected_hash = str(item.get("sha256") or "").strip().casefold()
            if len(expected_hash) != 64 or sha256_file(local_path) != expected_hash:
                blockers.append(f"source_pool_machine_acceptance_hash_mismatch:{asset_id}")
        return sorted(set(blockers))

    if mode == "patternlab_original_generated":
        if item.get("source_class") != "ai_reconstruction":
            blockers.append(f"source_pool_generated_acceptance_source_class_invalid:{asset_id}")
        if item.get("editorial_role") != "reconstruction":
            blockers.append(f"source_pool_generated_acceptance_editorial_role_invalid:{asset_id}")
        if item.get("geographic_scope") != "generic" or item.get("may_imply_named_city") is not False:
            blockers.append(f"source_pool_generated_acceptance_geographic_scope_invalid:{asset_id}")
        if item.get("on_screen_disclosure") != "Dramatic reconstruction — not archival footage":
            blockers.append(f"source_pool_generated_acceptance_disclosure_missing:{asset_id}")
        receipt_path = resolve_recorded_path(
            item.get("selection_receipt"), episode_root=episode_root, youtube_root=youtube_root
        )
        receipt: dict[str, Any] = {}
        if receipt_path is None or not receipt_path.is_file():
            blockers.append(f"source_pool_generated_selection_receipt_missing:{asset_id}")
        else:
            try:
                import json

                value = json.loads(receipt_path.read_text(encoding="utf-8"))
                receipt = value if isinstance(value, dict) else {}
            except (OSError, ValueError):
                receipt = {}
            expected_receipt_hash = str(item.get("selection_receipt_sha256") or "")
            if not expected_receipt_hash or sha256_file(receipt_path) != expected_receipt_hash:
                blockers.append(f"source_pool_generated_selection_receipt_hash_mismatch:{asset_id}")
            if receipt.get("status") != "pass" or receipt.get("blockers"):
                blockers.append(f"source_pool_generated_selection_receipt_not_pass:{asset_id}")
        local_path = episode_root / str(item.get("relative_path") or "")
        if local_path.is_file() and receipt:
            if receipt.get("output_sha256") != sha256_file(local_path):
                blockers.append(f"source_pool_generated_output_hash_mismatch:{asset_id}")
        return sorted(set(blockers))

    blockers.append(f"source_pool_production_acceptance_missing:{asset_id}")
    return sorted(set(blockers))


def acceptance_mode(item: dict[str, Any]) -> str:
    if truthy(item.get("human_accepted")):
        return "explicit_human_acceptance"
    return str(item.get("acceptance_mode") or "missing")

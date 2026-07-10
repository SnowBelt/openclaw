"""Fail-closed evidence-manifest loading and artifact verification."""
from __future__ import annotations

import json
from pathlib import Path

from .schemas import EpisodeManifest
from .state import sha256_file


class EvidenceError(RuntimeError):
    """Raised when an episode cannot prove its evidence package is current."""


def load_manifest(path: Path) -> EpisodeManifest:
    """Load only an explicit, schema-valid manifest; never infer claims or assets."""
    path = Path(path)
    if not path.exists():
        raise EvidenceError(f"evidence_manifest_missing:{path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"evidence_manifest_invalid_json:{path}") from exc
    try:
        return EpisodeManifest.model_validate(payload)
    except ValueError as exc:
        raise EvidenceError(f"evidence_manifest_schema_invalid:{exc}") from exc


def verify_manifest_assets(manifest: EpisodeManifest, artifact_root: Path) -> None:
    """Require every declared evidence asset to exist and match its declared hash."""
    artifact_root = Path(artifact_root)
    for asset in manifest.assets:
        path = artifact_root / asset.relative_path
        if not path.is_file():
            raise EvidenceError(f"evidence_asset_missing:{asset.asset_id}:{asset.relative_path}")
        actual = sha256_file(path)
        if actual != asset.sha256:
            raise EvidenceError(f"evidence_asset_hash_mismatch:{asset.asset_id}")

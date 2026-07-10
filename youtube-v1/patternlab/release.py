"""Deterministic immutable release candidates."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .models import Artifact, ReleaseCandidate
from .state import sha256_bytes, sha256_file, utc_now


def artifact_from_path(base: Path, path: Path, artifact_id: str, artifact_type: str, *, role: str = "", claim_ids: Iterable[str] = (), source_ids: Iterable[str] = ()) -> Artifact:
    path = Path(path)
    return Artifact(artifact_id, artifact_type, str(path.relative_to(base)), sha256_file(path), role, tuple(sorted(set(claim_ids))), tuple(sorted(set(source_ids))))


def create_release_candidate(episode_id: str, artifacts: Iterable[Artifact], *, tool_versions: dict[str, str] | None = None, model_versions: dict[str, str] | None = None) -> ReleaseCandidate:
    ordered = tuple(sorted(artifacts, key=lambda artifact: (artifact.artifact_type, artifact.artifact_id, artifact.relative_path)))
    payload = {
        "episode_id": episode_id,
        "artifacts": [artifact.as_dict() for artifact in ordered],
        "tool_versions": dict(sorted((tool_versions or {}).items())),
        "model_versions": dict(sorted((model_versions or {}).items())),
    }
    package_sha256 = sha256_bytes(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return ReleaseCandidate(f"rc-{episode_id}-{package_sha256[:12]}", episode_id, package_sha256, ordered, utc_now(), payload["tool_versions"], payload["model_versions"])

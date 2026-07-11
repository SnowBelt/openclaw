"""Hash-bound approval helpers shared by Discord and local review surfaces."""
from __future__ import annotations

from uuid import uuid4

from .models import Approval, ApprovalScope
from .state import PatternLabState, StateError, utc_now


def current_release(store: PatternLabState, episode_id: str) -> dict:
    snapshot = store.snapshot(episode_id)
    release = snapshot.get("release")
    if not release:
        raise StateError("current_release_missing")
    if release.get("superseded_at"):
        raise StateError("current_release_superseded")
    return release


def resolve_artifact(release: dict, *, artifact_id: str = "", filename: str = "") -> dict:
    artifacts = release.get("artifacts") or []
    for artifact in artifacts:
        if artifact_id and artifact.get("artifact_id") == artifact_id:
            return artifact
    # Discord controls use stable, human-readable asset IDs while the immutable
    # release manifest uses role-derived IDs.  Resolve an exact manifest ID
    # first, then fall back to the immutable relative filename.  Never return a
    # loosely matching artifact.
    for artifact in artifacts:
        if filename and str(artifact.get("relative_path") or "").endswith(filename):
            return artifact
    raise StateError("approved_asset_not_in_current_release")


def approval_binding(store: PatternLabState, *, episode_id: str, artifact_id: str = "", filename: str = "") -> dict:
    """Preview the exact release/asset that an approval would bind to."""
    release = current_release(store, episode_id)
    artifact = resolve_artifact(release, artifact_id=artifact_id, filename=filename) if artifact_id or filename else None
    return {
        "release_candidate_id": release["release_candidate_id"],
        "release_candidate_sha256": release["package_sha256"],
        "artifact_id": artifact.get("artifact_id") if artifact else "",
        "artifact_sha256": artifact.get("sha256") if artifact else "",
    }


def record_approval(
    store: PatternLabState,
    *,
    episode_id: str,
    scope: ApprovalScope,
    action: str,
    source: str,
    reason: str = "",
    artifact_id: str = "",
    filename: str = "",
) -> dict:
    """Record a review decision only against the active immutable release."""
    binding = approval_binding(store, episode_id=episode_id, artifact_id=artifact_id, filename=filename)
    approval = Approval(
        approval_id=uuid4().hex,
        episode_id=episode_id,
        release_candidate_id=binding["release_candidate_id"],
        artifact_id=binding["artifact_id"] or None,
        artifact_sha256=binding["artifact_sha256"] or None,
        scope=scope,
        action=action,
        created_at=utc_now(),
        source=source,
        reason=reason,
    )
    store.add_approval(approval)
    return {
        "approval_id": approval.approval_id,
        **binding,
    }

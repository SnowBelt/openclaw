"""Strict dependency-free production models."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class EpisodeState(str, Enum):
    TOPIC_QUALIFIED = "topic_qualified"
    EVIDENCE_LOCKED = "evidence_locked"
    SCRIPT_LOCKED = "script_locked"
    TIMELINE_LOCKED = "timeline_locked"
    RENDER_VERIFIED = "render_verified"
    AWAITING_OWNER_REVIEW = "awaiting_owner_review"
    OWNER_APPROVED = "owner_approved"
    PRIVATE_UPLOADED = "private_uploaded"
    PUBLIC_APPROVED = "public_approved"
    PUBLISHED = "published"
    LEARNING_ACTIVE = "learning_active"
    BLOCKED = "blocked"
    SUPERSEDED = "superseded"


ACTIVE_STATES = frozenset({state for state in EpisodeState if state != EpisodeState.SUPERSEDED})

ALLOWED_TRANSITIONS: dict[EpisodeState, frozenset[EpisodeState]] = {
    EpisodeState.TOPIC_QUALIFIED: frozenset({EpisodeState.EVIDENCE_LOCKED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.EVIDENCE_LOCKED: frozenset({EpisodeState.SCRIPT_LOCKED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.SCRIPT_LOCKED: frozenset({EpisodeState.TIMELINE_LOCKED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.TIMELINE_LOCKED: frozenset({EpisodeState.RENDER_VERIFIED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.RENDER_VERIFIED: frozenset({EpisodeState.AWAITING_OWNER_REVIEW, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.AWAITING_OWNER_REVIEW: frozenset({EpisodeState.OWNER_APPROVED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.OWNER_APPROVED: frozenset({EpisodeState.PRIVATE_UPLOADED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.PRIVATE_UPLOADED: frozenset({EpisodeState.PUBLIC_APPROVED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.PUBLIC_APPROVED: frozenset({EpisodeState.PUBLISHED, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.PUBLISHED: frozenset({EpisodeState.LEARNING_ACTIVE, EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.LEARNING_ACTIVE: frozenset({EpisodeState.BLOCKED, EpisodeState.SUPERSEDED}),
    EpisodeState.BLOCKED: frozenset(ACTIVE_STATES | {EpisodeState.SUPERSEDED}),
    EpisodeState.SUPERSEDED: frozenset(),
}


class ApprovalScope(str, Enum):
    ASSET = "asset"
    OWNER_REVIEW = "owner_review"
    PRIVATE_UPLOAD = "private_upload"
    PUBLIC_PUBLISH = "public_publish"


@dataclass(frozen=True)
class Artifact:
    artifact_id: str
    artifact_type: str
    relative_path: str
    sha256: str
    role: str = ""
    claim_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ReleaseCandidate:
    release_candidate_id: str
    episode_id: str
    package_sha256: str
    artifacts: tuple[Artifact, ...]
    created_at: str
    tool_versions: dict[str, str] = field(default_factory=dict)
    model_versions: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["artifacts"] = [artifact.as_dict() for artifact in self.artifacts]
        return payload


@dataclass(frozen=True)
class Approval:
    approval_id: str
    episode_id: str
    release_candidate_id: str
    artifact_id: str | None
    artifact_sha256: str | None
    scope: ApprovalScope
    action: str
    created_at: str
    source: str
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["scope"] = self.scope.value
        return payload


def transition_allowed(current: EpisodeState, target: EpisodeState) -> bool:
    return target in ALLOWED_TRANSITIONS[current]

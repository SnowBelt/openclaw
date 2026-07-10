"""Canonical SQLite state, immutable events, releases, and approvals."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from .models import Approval, ApprovalScope, EpisodeState, ReleaseCandidate, transition_allowed


SCHEMA_VERSION = 1


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class StateError(RuntimeError):
    pass


class PatternLabState:
    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def migrate(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS episodes (
                  episode_id TEXT PRIMARY KEY, state TEXT NOT NULL,
                  release_candidate_id TEXT, updated_at TEXT NOT NULL, blocker TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS release_candidates (
                  release_candidate_id TEXT PRIMARY KEY,
                  episode_id TEXT NOT NULL REFERENCES episodes(episode_id),
                  package_sha256 TEXT NOT NULL UNIQUE, manifest_json TEXT NOT NULL,
                  created_at TEXT NOT NULL, superseded_at TEXT
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                  release_candidate_id TEXT NOT NULL REFERENCES release_candidates(release_candidate_id),
                  artifact_id TEXT NOT NULL, artifact_type TEXT NOT NULL, relative_path TEXT NOT NULL,
                  sha256 TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', claim_ids_json TEXT NOT NULL DEFAULT '[]',
                  source_ids_json TEXT NOT NULL DEFAULT '[]',
                  PRIMARY KEY(release_candidate_id, artifact_id), UNIQUE(release_candidate_id, relative_path)
                );
                CREATE TABLE IF NOT EXISTS approvals (
                  approval_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(episode_id),
                  release_candidate_id TEXT NOT NULL REFERENCES release_candidates(release_candidate_id),
                  artifact_id TEXT, artifact_sha256 TEXT, scope TEXT NOT NULL, action TEXT NOT NULL,
                  created_at TEXT NOT NULL, source TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', superseded_at TEXT
                );
                CREATE TABLE IF NOT EXISTS events (
                  event_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(episode_id),
                  event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_episode ON events(episode_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_approvals_episode ON approvals(episode_id, release_candidate_id, scope, superseded_at);
                """
            )
            connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)", (SCHEMA_VERSION, utc_now()))

    def ensure_episode(self, episode_id: str, state: EpisodeState = EpisodeState.TOPIC_QUALIFIED) -> None:
        with self.connect() as connection:
            connection.execute("INSERT OR IGNORE INTO episodes(episode_id, state, updated_at) VALUES (?, ?, ?)", (episode_id, state.value, utc_now()))

    def episode(self, episode_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM episodes WHERE episode_id=?", (episode_id,)).fetchone()
        return dict(row) if row else None

    def event(self, episode_id: str, event_type: str, payload: dict[str, Any]) -> str:
        self.ensure_episode(episode_id)
        event_id = str(uuid4())
        with self.connect() as connection:
            connection.execute("INSERT INTO events(event_id, episode_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)", (event_id, episode_id, event_type, json.dumps(payload, sort_keys=True), utc_now()))
        return event_id

    def transition(self, episode_id: str, target: EpisodeState, blocker: str = "") -> None:
        self.ensure_episode(episode_id)
        with self.connect() as connection:
            row = connection.execute("SELECT state FROM episodes WHERE episode_id=?", (episode_id,)).fetchone()
            current = EpisodeState(row["state"])
            if current != target and not transition_allowed(current, target):
                raise StateError(f"illegal_transition:{current.value}->{target.value}")
            connection.execute("UPDATE episodes SET state=?, blocker=?, updated_at=? WHERE episode_id=?", (target.value, blocker, utc_now(), episode_id))
        self.event(episode_id, "state_transition", {"target": target.value, "blocker": blocker})

    def register_release(self, candidate: ReleaseCandidate) -> None:
        self.ensure_episode(candidate.episode_id)
        now = utc_now()
        with self.connect() as connection:
            active = connection.execute("SELECT release_candidate_id FROM release_candidates WHERE episode_id=? AND superseded_at IS NULL", (candidate.episode_id,)).fetchall()
            for row in active:
                if row["release_candidate_id"] != candidate.release_candidate_id:
                    connection.execute("UPDATE release_candidates SET superseded_at=? WHERE release_candidate_id=?", (now, row["release_candidate_id"]))
                    connection.execute("UPDATE approvals SET superseded_at=? WHERE release_candidate_id=? AND superseded_at IS NULL", (now, row["release_candidate_id"]))
            connection.execute("INSERT OR REPLACE INTO release_candidates(release_candidate_id, episode_id, package_sha256, manifest_json, created_at, superseded_at) VALUES (?, ?, ?, ?, ?, NULL)", (candidate.release_candidate_id, candidate.episode_id, candidate.package_sha256, json.dumps(candidate.as_dict(), sort_keys=True), candidate.created_at))
            connection.execute("DELETE FROM artifacts WHERE release_candidate_id=?", (candidate.release_candidate_id,))
            for artifact in candidate.artifacts:
                connection.execute("INSERT INTO artifacts(release_candidate_id, artifact_id, artifact_type, relative_path, sha256, role, claim_ids_json, source_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (candidate.release_candidate_id, artifact.artifact_id, artifact.artifact_type, artifact.relative_path, artifact.sha256, artifact.role, json.dumps(artifact.claim_ids), json.dumps(artifact.source_ids)))
            connection.execute("UPDATE episodes SET release_candidate_id=?, updated_at=? WHERE episode_id=?", (candidate.release_candidate_id, now, candidate.episode_id))
        self.event(candidate.episode_id, "release_registered", {"release_candidate_id": candidate.release_candidate_id, "package_sha256": candidate.package_sha256})

    def add_approval(self, approval: Approval) -> None:
        with self.connect() as connection:
            candidate = connection.execute("SELECT episode_id, superseded_at FROM release_candidates WHERE release_candidate_id=?", (approval.release_candidate_id,)).fetchone()
            if not candidate:
                raise StateError("unknown_release_candidate")
            if candidate["episode_id"] != approval.episode_id:
                raise StateError("approval_episode_mismatch")
            if candidate["superseded_at"]:
                raise StateError("approval_for_superseded_release")
            if approval.artifact_id:
                artifact = connection.execute("SELECT sha256 FROM artifacts WHERE release_candidate_id=? AND artifact_id=?", (approval.release_candidate_id, approval.artifact_id)).fetchone()
                if not artifact or artifact["sha256"] != approval.artifact_sha256:
                    raise StateError("approval_artifact_hash_mismatch")
            connection.execute("INSERT INTO approvals(approval_id, episode_id, release_candidate_id, artifact_id, artifact_sha256, scope, action, created_at, source, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (approval.approval_id, approval.episode_id, approval.release_candidate_id, approval.artifact_id, approval.artifact_sha256, approval.scope.value, approval.action, approval.created_at, approval.source, approval.reason))
        self.event(approval.episode_id, "approval_recorded", approval.as_dict())

    def active_approvals(self, episode_id: str, scope: ApprovalScope) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM approvals WHERE episode_id=? AND scope=? AND superseded_at IS NULL ORDER BY created_at", (episode_id, scope.value)).fetchall()
        return [dict(row) for row in rows]

    def snapshot(self, episode_id: str) -> dict[str, Any]:
        episode = self.episode(episode_id)
        if not episode:
            raise StateError("unknown_episode")
        with self.connect() as connection:
            release = None
            if episode["release_candidate_id"]:
                row = connection.execute("SELECT manifest_json, superseded_at FROM release_candidates WHERE release_candidate_id=?", (episode["release_candidate_id"],)).fetchone()
                if row:
                    release = json.loads(row["manifest_json"])
                    release["superseded_at"] = row["superseded_at"]
            rows = connection.execute("SELECT event_type, payload_json, created_at FROM events WHERE episode_id=? ORDER BY created_at", (episode_id,)).fetchall()
        return {"episode": episode, "release": release, "events": [{"event_type": row["event_type"], "payload": json.loads(row["payload_json"]), "created_at": row["created_at"]} for row in rows]}

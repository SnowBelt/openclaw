from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_governor():
    path = ROOT / "scripts" / "patternlab_system_storage_governor.py"
    spec = importlib.util.spec_from_file_location("patternlab_system_storage_governor", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_codex_retention_keeps_newest_two(tmp_path: Path) -> None:
    governor = load_governor()
    root = tmp_path / "backups"
    root.mkdir()
    for index in range(4):
        directory = root / f"project-chat-{index}"
        directory.mkdir()
        (directory / "state.json").write_text(str(index), encoding="utf-8")
        timestamp = 1_700_000_000 + index
        directory.touch()
        import os

        os.utime(directory, (timestamp, timestamp))
    plan = governor.codex_plan([root], 2)
    decisions = {row["name"]: row["decision"] for row in plan["roots"][0]["entries"]}
    assert decisions == {
        "project-chat-3": "retain",
        "project-chat-2": "retain",
        "project-chat-1": "delete",
        "project-chat-0": "delete",
    }


def test_episode_capsule_hashes_exact_bytes(tmp_path: Path) -> None:
    episode = tmp_path / "video-99"
    fixtures = {
        "video/final-master.mp4": b"master",
        "shorts/short-01.mp4": b"short",
        "thumbnail/final-thumbnail.png": b"thumb",
        "final-script.md": b"script",
        "audio/narration.wav": b"voice",
        "source-packet/source-media/photo.jpg": b"source",
        "source-packet/rights-ledger.json": b"{}",
        "approval/owner-review.json": b"{}",
        "upload/upload-receipt.json": b"{}",
        "release/release-manifest.json": b"{}",
    }
    for relative, content in fixtures.items():
        path = episode / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    output = tmp_path / "capsule.json"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "patternlab_episode_archive_capsule.py"), str(episode), "--output", str(output), "--require-complete"],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["status"] == "pass"
    assert payload["exact_bytes_preserved"] is True
    assert payload["missing_required_classes"] == []
    assert len(payload["capsule_sha256"]) == 64
    first_hash = payload["capsule_sha256"]
    second = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "patternlab_episode_archive_capsule.py"), str(episode), "--output", str(output), "--require-complete"],
        text=True,
        capture_output=True,
        check=False,
    )
    assert second.returncode == 0
    assert json.loads(output.read_text(encoding="utf-8"))["capsule_sha256"] == first_hash


def test_operations_retention_uses_stable_name_not_mutable_mtime(tmp_path: Path) -> None:
    governor = load_governor()
    root = tmp_path / "operations"
    root.mkdir()
    names = [
        "operations-memory-20260701000000",
        "operations-memory-20260702000000",
        "operations-memory-20260703000000",
        "operations-memory-20260704000000",
    ]
    for index, name in enumerate(names):
        directory = root / name
        directory.mkdir()
        (directory / "operations_memory.db").write_bytes(b"db")
        # Deliberately make the oldest backup have the newest mtime.
        import os

        timestamp = 1_900_000_000 if index == 0 else 1_700_000_000 + index
        os.utime(directory, (timestamp, timestamp))
    plan = governor.operations_plan(root, 3)
    decisions = {Path(row["path"]).name: row["decision"] for row in plan["entries"]}
    assert decisions["operations-memory-20260704000000"] == "retain_raw"
    assert decisions["operations-memory-20260703000000"] == "retain_raw"
    assert decisions["operations-memory-20260702000000"] == "retain_raw"
    assert decisions["operations-memory-20260701000000"] == "archive_database"


def test_runtime_plan_preserves_active_and_previous(tmp_path: Path) -> None:
    governor = load_governor()
    dashboard_parent = tmp_path / "dashboard"
    dashboard_parent.mkdir()
    for name in ("previous.1", "previous.2", "previous.3"):
        (dashboard_parent / name).mkdir()
    custom = tmp_path / "custom"
    custom.mkdir()
    for name in ("release-a", "release-b", "release-c"):
        (custom / name).mkdir()
    pointer = tmp_path / "active.json"
    pointer.write_text(json.dumps({"releaseId": "release-c", "previousRelease": "release-b"}), encoding="utf-8")
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    for name in ("20260101", "20260102"):
        (legacy / name).mkdir()
    plan = governor.runtime_plan(
        {
            "dashboard_previous_glob": str(dashboard_parent / "previous.*"),
            "keep_dashboard_previous": 2,
            "custom_release_root": str(custom),
            "custom_active_pointer": str(pointer),
            "keep_custom_active_and_previous": True,
            "legacy_service_release_root": str(legacy),
            "keep_legacy_service_releases": 1,
        }
    )
    custom_rows = next(group for group in plan["groups"] if group["name"] == "custom_releases")["entries"]
    decisions = {Path(row["path"]).name: row["decision"] for row in custom_rows}
    assert decisions == {"release-c": "retain", "release-b": "retain", "release-a": "delete"}


def test_operations_archive_and_restore_roundtrip(tmp_path: Path) -> None:
    governor = load_governor()
    backup = tmp_path / "operations-memory-20260101000000"
    backup.mkdir()
    original = (b"sqlite-fixture-" * 100_000) + b"end"
    (backup / "operations_memory.db").write_bytes(original)
    result = governor.archive_operations_database(backup, level=1)
    assert result["status"] == "archived"
    assert result["roundtrip_verified"] is True
    assert not (backup / "operations_memory.db").exists()
    restore = tmp_path / "restored"
    command = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "patternlab_operations_backup_restore.py"), str(backup), str(restore)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert command.returncode == 0, command.stderr + command.stdout
    assert (restore / "operations_memory.db").read_bytes() == original

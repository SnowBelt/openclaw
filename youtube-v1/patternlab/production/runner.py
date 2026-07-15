"""Resumable, content-addressed execution for Pattern Lab production stages."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from patternlab.state import sha256_file

from .contract import ContractError, OutputSpec, ProductionContract, StageSpec


def _sha256_json(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ProductionRunner:
    def __init__(
        self,
        *,
        repo_root: Path,
        youtube_root: Path,
        output_root: Path,
        contract: ProductionContract,
        video_id: str,
        production_lock: dict[str, Any] | None,
        render: bool,
        send_review: bool,
        dry_run: bool,
        live_voice: str = "never",
        shorts_target: int = 5,
    ) -> None:
        self.repo_root = repo_root
        self.youtube_root = youtube_root
        self.output_root = output_root
        self.contract = contract
        self.video_id = video_id
        self.production_lock = production_lock or {}
        self.render = render
        self.send_review = send_review
        self.dry_run = dry_run
        self.live_voice = live_voice
        self.shorts_target = shorts_target
        self.approval = output_root / "approval"
        self.receipt_path = self.approval / (
            "canonical-production-dry-run.json" if dry_run else "canonical-production-run.json"
        )
        self.log_root = self.approval / "canonical-production-logs"

    def context(self) -> dict[str, str]:
        values = {
            "python": sys.executable,
            "video_id": self.video_id,
            "repo_root": str(self.repo_root),
            "youtube_root": str(self.youtube_root),
            "output_root": str(self.output_root),
            "approved_script_sha256": str(self.production_lock.get("approved_script_sha256") or ""),
            "route_compiler": str(self.production_lock.get("route_compiler") or ""),
            "source_pool_compiler": str(self.production_lock.get("source_pool_compiler") or ""),
            "live_voice": self.live_voice,
            "shorts_target": str(self.shorts_target),
        }
        if self.contract.requires_production_lock and any(
            not values[key] for key in ("approved_script_sha256", "route_compiler", "source_pool_compiler")
        ):
            raise ContractError("production_lock_missing_required_values")
        return values

    def command(self, stage: StageSpec) -> list[str]:
        context = self.context()
        try:
            command = [token.format(**context) for token in stage.command]
        except KeyError as exc:
            raise ContractError(f"unknown_stage_placeholder:{stage.stage_id}:{exc.args[0]}") from exc
        if not command or command[0] != sys.executable:
            raise ContractError(f"stage_must_use_current_python:{stage.stage_id}")
        return command

    def resolve_output(self, spec: OutputSpec) -> Path:
        rendered = spec.path.format(video_id=self.video_id)
        if rendered.startswith("output:"):
            return self.output_root / rendered.removeprefix("output:")
        if rendered.startswith("repo:"):
            return self.repo_root / rendered.removeprefix("repo:")
        raise ContractError(f"output_path_scope_missing:{rendered}")

    def output_rows(self, stage: StageSpec) -> tuple[list[dict[str, Any]], list[str]]:
        rows: list[dict[str, Any]] = []
        blockers: list[str] = []
        for spec in stage.outputs:
            path = self.resolve_output(spec)
            exists = path.is_file() and path.stat().st_size > 0
            row: dict[str, Any] = {
                "path": str(path),
                "exists": exists,
                "sha256": sha256_file(path) if exists else "",
            }
            if not exists:
                blockers.append(f"required_output_missing:{stage.stage_id}:{path.name}")
            if spec.json_status and exists:
                payload = _read_json(path)
                status = str(payload.get("status") or payload.get("overall_status") or "missing")
                row["json_status"] = status
                if status not in spec.json_status:
                    blockers.append(f"required_output_status_not_pass:{stage.stage_id}:{path.name}:{status}")
                if payload.get("blockers"):
                    blockers.append(f"required_output_contains_blockers:{stage.stage_id}:{path.name}")
            rows.append(row)
        return rows, blockers

    def validate_lock(self) -> list[str]:
        if not self.contract.requires_production_lock:
            return []
        blockers: list[str] = []
        lock = self.production_lock
        if str(lock.get("video_id") or "").zfill(2) != self.video_id:
            blockers.append("production_lock_video_mismatch")
        if lock.get("profile") != self.contract.profile:
            blockers.append("production_lock_profile_mismatch")
        if lock.get("youtube_mutations_allowed") is not False:
            blockers.append("production_lock_youtube_boundary_missing")
        if lock.get("paid_provider_calls_allowed") is not False:
            blockers.append("production_lock_paid_provider_boundary_missing")
        expected_compilers = {
            "route_compiler": "youtube-v1/scripts/patternlab_visual_route_compiler.py",
            "source_pool_compiler": "youtube-v1/scripts/patternlab_source_pool_compiler.py",
        }
        for field, expected in expected_compilers.items():
            if str(lock.get(field) or "") != expected:
                blockers.append(f"production_lock_noncanonical_compiler:{field}")
        locked_paths = {
            "approved_script_sha256": self.youtube_root / "launch" / f"video-{self.video_id}" / "final-script.md",
            "retained_audio_sha256": self.output_root / "audio" / "voiceover_full_normalized.mp3",
            "retained_transcript_sha256": self.output_root / "audio" / "voiceover_full.txt",
        }
        for field, path in locked_paths.items():
            if not path.is_file() or str(lock.get(field) or "") != sha256_file(path):
                blockers.append(f"production_lock_hash_mismatch:{field}")
        return blockers

    def implementation_hashes(self) -> dict[str, str]:
        hashes = self.shared_implementation_hashes()
        for stage in self.contract.stages:
            for token in stage.command:
                if not token.endswith(".py"):
                    continue
                try:
                    rendered = token.format(**self.context())
                except KeyError:
                    continue
                path = self.repo_root / rendered
                if path.is_file():
                    hashes[rendered] = sha256_file(path)
        hashes[str(self.contract.source_path.relative_to(self.repo_root))] = sha256_file(self.contract.source_path)
        return dict(sorted(hashes.items()))

    def shared_implementation_hashes(self) -> dict[str, str]:
        """Hash shared code that can change any stage without changing its CLI.

        Pattern Lab stages import the typed package and a small set of script
        helpers. Omitting those dependencies would allow a stale successful
        render to be reused after shared production logic changed.
        """
        paths = list((self.youtube_root / "patternlab").rglob("*.py"))
        paths.extend(
            path
            for path in (self.youtube_root / "scripts").glob("patternlab_*.py")
            if path.name.endswith("_common.py")
            or path.name in {"patternlab_script_bootstrap.py", "patternlab_local_media_runtime.py"}
        )
        return {
            str(path.relative_to(self.repo_root)): sha256_file(path)
            for path in sorted(set(paths))
            if path.is_file()
        }

    def stage_implementation_hashes(self, stage: StageSpec) -> dict[str, str]:
        hashes = self.shared_implementation_hashes()
        for token in stage.command:
            if not token.endswith(".py"):
                continue
            try:
                rendered = token.format(**self.context())
            except KeyError:
                continue
            path = self.repo_root / rendered
            if path.is_file():
                hashes[rendered] = sha256_file(path)
        return dict(sorted(hashes.items()))

    def base_input_hashes(self) -> dict[str, str]:
        inputs: dict[str, str] = {}
        for path in (
            self.youtube_root / "launch" / f"video-{self.video_id}" / "production-lock.json",
            self.youtube_root / "launch" / f"video-{self.video_id}" / "package.json",
            self.youtube_root / "launch" / f"video-{self.video_id}" / "evidence-queries.json",
            self.youtube_root / "launch" / f"video-{self.video_id}" / "final-script.md",
            self.youtube_root / "launch" / f"video-{self.video_id}" / "long-form-visual-routing.json",
            self.youtube_root / "launch" / f"video-{self.video_id}" / "long-form-source-additions.json",
            self.youtube_root / "launch" / f"video-{self.video_id}" / "visual-contract.json",
            self.output_root / "audio" / "voiceover_full_normalized.mp3",
        ):
            if path.is_file():
                inputs[str(path)] = sha256_file(path)
        for path in sorted((self.youtube_root / "resources").glob("*.json")):
            if path.is_file():
                inputs[str(path)] = sha256_file(path)
        return dict(sorted(inputs.items()))

    def stage_fingerprint(
        self,
        stage: StageSpec,
        upstream_outputs: dict[str, list[dict[str, Any]]],
    ) -> str:
        """Bind reuse to this stage, its inputs, and every upstream artifact.

        A downstream QA edit must not force an expensive media rerender, while
        any changed source, implementation, or upstream output must invalidate
        the first affected stage and every dependent stage after it.
        """
        return _sha256_json(
            {
                "contract_id": self.contract.contract_id,
                "profile": self.contract.profile,
                "video_id": self.video_id,
                "stage": asdict(stage),
                "implementation": self.stage_implementation_hashes(stage),
                "base_inputs": self.base_input_hashes(),
                "upstream_outputs": upstream_outputs,
            }
        )

    def legacy_stage_unchanged(
        self,
        stage: StageSpec,
        previous_inputs: dict[str, str],
    ) -> bool:
        """Safely migrate v1 global receipts into per-stage reuse once."""
        required = dict(self.base_input_hashes())
        required.update(self.stage_implementation_hashes(stage))
        return bool(required) and all(previous_inputs.get(path) == digest for path, digest in required.items())

    def fingerprint(self) -> tuple[str, dict[str, str]]:
        implementation = self.implementation_hashes()
        inputs: dict[str, str] = dict(implementation)
        inputs.update(self.base_input_hashes())
        value = {
            "contract_id": self.contract.contract_id,
            "profile": self.contract.profile,
            "video_id": self.video_id,
            "render": self.render,
            "send_review": self.send_review,
            "inputs": inputs,
        }
        return _sha256_json(value), inputs

    def selected_stages(self) -> tuple[StageSpec, ...]:
        rows: list[StageSpec] = []
        for stage in self.contract.stages:
            if stage.phase == "render" and not self.render:
                continue
            if stage.phase in {"verify", "release", "review"} and not self.render:
                continue
            if stage.phase == "review" and not self.send_review:
                continue
            rows.append(stage)
        return tuple(rows)

    def execute(self) -> dict[str, Any]:
        run_started = time.monotonic()
        started_at = _utc_now()
        self.approval.mkdir(parents=True, exist_ok=True)
        fingerprint, input_hashes = self.fingerprint()
        lock_blockers = self.validate_lock()
        previous = _read_json(self.receipt_path) if not self.dry_run else {}
        run_attempt_number = int(previous.get("run_attempt_number", 0)) + 1 if previous else 1
        payload: dict[str, Any] = {
            "schema_version": 1,
            "contract_id": self.contract.contract_id,
            "contract_sha256": sha256_file(self.contract.source_path),
            "profile": self.contract.profile,
            "video_id": self.video_id,
            "run_fingerprint": fingerprint,
            "minimum_automated_score": self.contract.minimum_automated_score,
            "render_requested": self.render,
            "discord_review_requested": self.send_review,
            "dry_run": self.dry_run,
            "started_at": started_at,
            "run_attempt_number": run_attempt_number,
            "input_hashes": input_hashes,
            "stages": [],
            "status": "blocked" if lock_blockers else ("dry_run" if self.dry_run else "running"),
            "blockers": list(lock_blockers),
            "paid_provider_calls": "not_performed",
            "youtube_mutation": "not_performed",
        }
        previous_by_id = {
            str(row.get("id")): row for row in previous.get("stages", []) if isinstance(row, dict)
        }
        previous_inputs = previous.get("input_hashes", {}) if isinstance(previous.get("input_hashes"), dict) else {}
        if lock_blockers:
            _atomic_json(self.receipt_path, payload)
            return payload
        blocked_by = ""
        upstream_outputs: dict[str, list[dict[str, Any]]] = {}
        for stage in self.selected_stages():
            command = self.command(stage)
            stage_fingerprint = self.stage_fingerprint(stage, upstream_outputs)
            if blocked_by:
                payload["stages"].append(
                    {
                        "id": stage.stage_id,
                        "phase": stage.phase,
                        "status": "skipped",
                        "blocked_by": blocked_by,
                        "stage_fingerprint": stage_fingerprint,
                        "command": command,
                    }
                )
                continue
            if self.dry_run:
                payload["stages"].append(
                    {
                        "id": stage.stage_id,
                        "phase": stage.phase,
                        "side_effect": stage.side_effect,
                        "status": "planned",
                        "stage_fingerprint": stage_fingerprint,
                        "command": command,
                        "outputs": [str(self.resolve_output(spec)) for spec in stage.outputs],
                    }
                )
                continue
            current_outputs, current_blockers = self.output_rows(stage)
            previous_stage = previous_by_id.get(stage.stage_id, {})
            fingerprint_matches = previous_stage.get("stage_fingerprint") == stage_fingerprint
            if not previous_stage.get("stage_fingerprint"):
                fingerprint_matches = self.legacy_stage_unchanged(stage, previous_inputs)
            reusable = bool(
                fingerprint_matches
                and previous_stage.get("status") in {"pass", "reused"}
                and not current_blockers
                and previous_stage.get("outputs") == current_outputs
                and stage.phase != "review"
            )
            if reusable:
                attempt_number = max(1, int(previous_stage.get("attempt_number", 1)))
                row = {
                    "id": stage.stage_id,
                    "phase": stage.phase,
                    "side_effect": stage.side_effect,
                    "status": "reused",
                    "exit_code": 0,
                    "attempt_number": attempt_number,
                    "duration_seconds": 0.0,
                    "stage_fingerprint": stage_fingerprint,
                    "command": command,
                    "outputs": current_outputs,
                    "blockers": [],
                }
            else:
                self.log_root.mkdir(parents=True, exist_ok=True)
                stdout_path = self.log_root / f"{stage.stage_id}.stdout.log"
                stderr_path = self.log_root / f"{stage.stage_id}.stderr.log"
                env = os.environ.copy()
                env["PATTERNLAB_CANONICAL_RUN"] = "1"
                env["PATTERNLAB_OUTPUT_ROOT"] = str(self.output_root.parent / f"video-{self.video_id}")
                stage_started_at = _utc_now()
                stage_started = time.monotonic()
                with stdout_path.open("w", encoding="utf-8") as stdout, stderr_path.open("w", encoding="utf-8") as stderr:
                    result = subprocess.run(
                        command,
                        cwd=self.repo_root,
                        env=env,
                        stdout=stdout,
                        stderr=stderr,
                        check=False,
                    )
                output_rows, output_blockers = self.output_rows(stage)
                stage_blockers = list(output_blockers)
                if result.returncode != 0:
                    stage_blockers.append(f"stage_exit_nonzero:{stage.stage_id}:{result.returncode}")
                row = {
                    "id": stage.stage_id,
                    "phase": stage.phase,
                    "side_effect": stage.side_effect,
                    "status": "pass" if not stage_blockers else "blocked",
                    "exit_code": result.returncode,
                    "attempt_number": int(previous_stage.get("attempt_number", 0)) + 1,
                    "started_at": stage_started_at,
                    "completed_at": _utc_now(),
                    "duration_seconds": round(time.monotonic() - stage_started, 3),
                    "stage_fingerprint": stage_fingerprint,
                    "command": command,
                    "stdout": str(stdout_path),
                    "stderr": str(stderr_path),
                    "outputs": output_rows,
                    "blockers": sorted(set(stage_blockers)),
                }
            payload["stages"].append(row)
            upstream_outputs[stage.stage_id] = row.get("outputs", [])
            if stage.required and row["status"] == "blocked":
                blocked_by = stage.stage_id
                payload["blockers"].extend(row.get("blockers", []))
            _atomic_json(self.receipt_path, payload)
        if self.dry_run:
            payload["status"] = "dry_run"
        else:
            payload["status"] = "pass" if not payload["blockers"] and not blocked_by else "blocked"
        payload["completed_stage_count"] = sum(
            row.get("status") in {"pass", "reused"} for row in payload["stages"]
        )
        payload["selected_stage_count"] = len(payload["stages"])
        completed_rows = [row for row in payload["stages"] if row.get("status") in {"pass", "reused"}]
        payload["first_pass_stage_success_rate"] = round(
            sum(int(row.get("attempt_number", 0)) == 1 for row in completed_rows)
            / max(1, len(payload["stages"])),
            4,
        )
        payload["executed_stage_count"] = sum(row.get("status") == "pass" for row in payload["stages"])
        payload["reused_stage_count"] = sum(row.get("status") == "reused" for row in payload["stages"])
        payload["completed_at"] = _utc_now()
        payload["elapsed_seconds"] = round(time.monotonic() - run_started, 3)
        payload["blockers"] = sorted(set(payload["blockers"]))
        _atomic_json(self.receipt_path, payload)
        if not self.dry_run:
            history = self.approval / "canonical-production-history.jsonl"
            with history.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "started_at": payload["started_at"],
                            "completed_at": payload["completed_at"],
                            "run_attempt_number": payload["run_attempt_number"],
                            "run_fingerprint": payload["run_fingerprint"],
                            "profile": payload["profile"],
                            "status": payload["status"],
                            "elapsed_seconds": payload["elapsed_seconds"],
                            "first_pass_stage_success_rate": payload["first_pass_stage_success_rate"],
                            "executed_stage_count": payload["executed_stage_count"],
                            "reused_stage_count": payload["reused_stage_count"],
                            "blockers": payload["blockers"],
                            "youtube_mutation": "not_performed",
                        },
                        sort_keys=True,
                    )
                    + "\n"
                )
        return payload

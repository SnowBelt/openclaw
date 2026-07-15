#!/usr/bin/env python3
"""Benchmark the approved local Draw Things thumbnail support model."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, patternlab_model_root, utc_now
from patternlab_local_media_runtime import (
    atomic_write_json,
    atomic_write_text,
    binary_identity,
    execution_context,
    exclusive_process_lock,
    immutable_receipts,
    sha256_file,
    timestamp_slug,
)
from patternlab_thumbnail_worldclass import read_json, sha256
from patternlab_storage_lifecycle import disk_snapshot, operation_budget, read_policy as read_storage_policy

MODEL_ID = "flux_2_klein_4b_q6p.ckpt"


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    models = patternlab_model_root()
    fixture_dir = ensure_dir(root / "source-packet" / "thumbnail-worldclass")
    fixture = fixture_dir / "flux-support-benchmark.png"
    temporary_fixture = fixture_dir / f".flux-support-benchmark.{os.getpid()}.png"
    canary_dir = ensure_dir(approval / "local-generation-canaries")
    registry = read_json(BASE / "resources" / "thumbnail-local-model-registry.json")
    expected = next((item.get("sha256") for item in registry.get("models", []) if item.get("id") == MODEL_ID), "")
    model_path = models / MODEL_ID
    model_hash_ok = bool(model_path.exists() and expected and sha256(model_path) == expected)
    cli = shutil.which("draw-things-cli") or "draw-things-cli"
    cli_identity = binary_identity(cli) if shutil.which("draw-things-cli") else {"path": "missing", "version": "missing", "sha256": ""}
    context = execution_context()
    storage_gate = operation_budget(read_storage_policy(), "routine_still_generation", disk_snapshot(BASE))
    blockers: list[str] = list(storage_gate["blockers"])
    if not model_hash_ok:
        blockers.append("local_model_hash_mismatch_or_missing")
    if not shutil.which("draw-things-cli"):
        blockers.append("draw_things_cli_missing")
    command = [
        cli, "generate", "--models-dir", str(models),
        "--model", MODEL_ID,
        "--prompt", "vivid editorial abstract city grid, electric blue, warm yellow, signal red, no words, no people",
        "--negative-prompt", "text, logo, watermark, fake archival photograph",
        "--steps", "4", "--width", "512", "--height", "320", "--seed", "404",
        "--offline", "--disable-preview", "--output", str(temporary_fixture),
    ]
    started = time.monotonic()
    attempts: list[dict] = []
    returncode = 127
    stderr = ""
    lock_path = BASE / "local-output" / "locks" / "draw-things-generation.lock"
    try:
        with exclusive_process_lock(lock_path, timeout_seconds=30):
            for attempt in range(1, 3 if context["metal_generation_trusted"] else 2) if not blockers else []:
                temporary_fixture.unlink(missing_ok=True)
                attempt_started = time.monotonic()
                try:
                    proc = subprocess.run(command, text=True, capture_output=True, timeout=180, check=False)
                    returncode = proc.returncode
                    stderr = proc.stderr[-2000:]
                except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
                    returncode = 127 if isinstance(exc, FileNotFoundError) else 124
                    stderr = f"{type(exc).__name__}: {exc}"
                attempts.append({
                    "attempt": attempt,
                    "returncode": returncode,
                    "elapsed_seconds": round(time.monotonic() - attempt_started, 2),
                    "metal_error": "mpobjmalloc" in stderr or "mps" in stderr.lower(),
                })
                if returncode == 0 and temporary_fixture.is_file() and temporary_fixture.stat().st_size > 0:
                    temporary_fixture.replace(fixture)
                    break
                if attempt == 1 and context["metal_generation_trusted"]:
                    time.sleep(1.0)
    except TimeoutError as exc:
        returncode = 75
        stderr = str(exc)
    finally:
        temporary_fixture.unlink(missing_ok=True)
    elapsed = round(time.monotonic() - started, 2)
    output_hash = sha256_file(fixture) if returncode == 0 and fixture.is_file() else ""
    if not blockers and (returncode != 0 or not output_hash):
        blockers.append("draw_things_local_generation_failed")
    metal_error = "mpobjmalloc" in stderr or "mps" in stderr.lower()
    if metal_error:
        blockers.append(
            "draw_things_metal_unavailable_in_codex_sandbox"
            if not context["metal_generation_trusted"]
            else "draw_things_metal_generation_failed_in_trusted_runtime"
        )
    status = "pass" if not blockers and context["metal_generation_trusted"] else (
        "environment_blocked" if metal_error and not context["metal_generation_trusted"] else "blocked"
    )
    registry_hash = sha256_file(BASE / "resources" / "thumbnail-local-model-registry.json")
    payload = {
        "generated_at": utc_now(), "video_id": video_id,
        "status": status,
        "model_id": MODEL_ID, "model_role": "non_proof_support_generation",
        "model_sha256_verified": model_hash_ok,
        "model_sha256": sha256_file(model_path) if model_path.is_file() else "",
        "registry_sha256": registry_hash,
        "draw_things_cli": cli_identity,
        "execution_context": context,
        "trusted_for_production": status == "pass" and context["metal_generation_trusted"],
        "local_only": True, "seed": 404, "elapsed_seconds": elapsed,
        "output": display_path(fixture) if output_hash else "missing",
        "output_sha256": output_hash,
        "returncode": returncode, "blockers": blockers,
        "attempts": attempts,
        "storage_gate": storage_gate,
        "failure_excerpt": stderr.replace(str(Path.home()), "<HOME>"),
        "no_silent_fallback": True,
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    receipt_path = canary_dir / f"{timestamp_slug()}-{os.getpid()}.json"
    atomic_write_json(receipt_path, payload)
    trusted = [row for row in immutable_receipts(canary_dir) if row.get("trusted_for_production") is True and row.get("status") == "pass"]
    payload["last_trusted_pass"] = {
        "generated_at": trusted[-1].get("generated_at"),
        "receipt": display_path(Path(trusted[-1]["_receipt_path"])),
        "output_sha256": trusted[-1].get("output_sha256", ""),
    } if trusted else None
    json_path = approval / "thumbnail-local-model-benchmark.json"
    md_path = approval / "thumbnail-local-model-benchmark.md"
    atomic_write_json(json_path, payload)
    lines = [f"# Thumbnail Local Model Benchmark: {video_id}", "", f"Status: {payload['status']}", f"Model: {MODEL_ID}", f"Elapsed: {elapsed}s", "", "## Blockers", ""]
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    lines.extend(["", "Paid provider calls: not performed", "YouTube mutation: not performed"])
    lines.extend(["", f"Execution context: {context['name']}", f"Trusted for production: {str(payload['trusted_for_production']).lower()}", f"Output SHA-256: {output_hash or 'missing'}"])
    atomic_write_text(md_path, "\n".join(lines) + "\n")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))


if __name__ == "__main__":
    main()

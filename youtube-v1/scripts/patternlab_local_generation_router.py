#!/usr/bin/env python3
"""Report the actual, non-paid Pattern Lab still and motion generation routes."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, output_root, patternlab_model_root, utc_now
from patternlab_local_media_runtime import CANARY_TTL_SECONDS, immutable_receipts, receipt_is_fresh


POLICY_PATH = BASE / "resources" / "local-visual-generation-routing-policy.json"
REGISTRY_PATH = BASE / "resources" / "thumbnail-local-model-registry.json"


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def comfy_health() -> tuple[bool, str]:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2) as response:
            return response.status == 200, f"http_{response.status}"
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        return False, type(exc).__name__


def ffmpeg_filter_health() -> tuple[bool, list[str], str]:
    required = ["overlay", "drawtext", "subtitles"]
    try:
        result = subprocess.run(
            [ffmpeg_cmd(), "-hide_banner", "-filters"], capture_output=True, text=True, timeout=10, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, required, type(exc).__name__
    output = result.stdout + result.stderr
    missing = [name for name in required if name not in output]
    return result.returncode == 0 and not missing, missing, f"returncode_{result.returncode}"


def local_video_route_ready(
    benchmark: dict[str, Any], *, draw_cli_present: bool, comfy_ready: bool
) -> tuple[bool, str]:
    if benchmark.get("status") != "pass" or benchmark.get("local_only") is not True:
        return False, "benchmark_not_pass"
    engine = str(benchmark.get("engine") or "")
    if engine == "draw_things_ltx_2_3":
        required = bool(
            draw_cli_present
            and benchmark.get("model_hash_verified") is True
            and str(benchmark.get("source_image_sha256") or "")
            and str(benchmark.get("output_sha256") or "")
        )
        return required, "draw_things_ltx_2_3" if required else "draw_things_receipt_incomplete"
    if engine == "comfyui":
        required = bool(
            comfy_ready
            and benchmark.get("model_hash_verified") is True
            and str(benchmark.get("workflow_sha256") or "")
            and str(benchmark.get("output_sha256") or "")
        )
        return required, "comfyui" if required else "comfyui_receipt_incomplete"
    return False, "unsupported_benchmark_engine"


def model_rows() -> list[dict[str, Any]]:
    registry = read_json(REGISTRY_PATH)
    root = patternlab_model_root()
    rows: list[dict[str, Any]] = []
    for item in registry.get("models", []) if isinstance(registry.get("models"), list) else []:
        if not isinstance(item, dict):
            continue
        path = root / str(item.get("id") or "")
        expected = str(item.get("sha256") or "")
        actual = sha256_file(path) if path.is_file() else ""
        companion_rows: list[dict[str, Any]] = []
        for companion in item.get("companion_files", []) if isinstance(item.get("companion_files"), list) else []:
            if not isinstance(companion, dict):
                continue
            companion_path = Path(str(path) + str(companion.get("suffix") or ""))
            companion_expected = str(companion.get("sha256") or "")
            companion_actual = sha256_file(companion_path) if companion_path.is_file() else ""
            companion_rows.append(
                {
                    "path": display_path(companion_path),
                    "present": companion_path.is_file(),
                    "sha256_verified": bool(
                        companion_actual and companion_expected and companion_actual == companion_expected
                    ),
                }
            )
        primary_verified = bool(actual and expected and actual == expected)
        rows.append(
            {
                "id": item.get("id", ""),
                "role": item.get("role", ""),
                "path": display_path(path),
                "present": path.is_file(),
                "sha256_verified": primary_verified
                and all(row["present"] and row["sha256_verified"] for row in companion_rows),
                "companion_files": companion_rows,
            }
        )
    return rows


def valid_still_canary(
    approval: Path,
    *,
    cli_identity: dict[str, str],
    registry_sha256: str,
    models: list[dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    """Select the newest valid trusted canary; untrusted sandbox failures never poison it."""
    canaries = immutable_receipts(approval / "local-generation-canaries")
    trusted = [row for row in canaries if row.get("execution_context", {}).get("metal_generation_trusted") is True]
    if not trusted:
        legacy = read_json(approval / "thumbnail-local-model-benchmark.json")
        trusted = [legacy] if legacy.get("trusted_for_production") is True else []
    if not trusted:
        return {}, "trusted_canary_missing"
    latest_trusted = trusted[-1]
    if latest_trusted.get("status") != "pass":
        return latest_trusted, "latest_trusted_canary_failed"
    if not receipt_is_fresh(latest_trusted, CANARY_TTL_SECONDS):
        return latest_trusted, "trusted_canary_stale"
    receipt_cli = latest_trusted.get("draw_things_cli", {})
    if receipt_cli.get("sha256") != cli_identity.get("sha256"):
        return latest_trusted, "draw_things_cli_changed_since_canary"
    if latest_trusted.get("registry_sha256") != registry_sha256:
        return latest_trusted, "model_registry_changed_since_canary"
    if not models or not all(row.get("sha256_verified") for row in models):
        return latest_trusted, "model_hashes_not_verified"
    output = BASE / str(latest_trusted.get("output") or "")
    if not output.is_file() or sha256_file(output) != latest_trusted.get("output_sha256"):
        return latest_trusted, "canary_output_missing_or_hash_mismatch"
    return latest_trusted, "trusted_canary_pass"


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH)
    draw_cli = shutil.which("draw-things-cli")
    ffmpeg = ffmpeg_cmd()
    ffmpeg_filters_ready, missing_ffmpeg_filters, ffmpeg_filter_reason = ffmpeg_filter_health()
    models = model_rows()
    model_hashes_pass = bool(models) and all(row["present"] and row["sha256_verified"] for row in models)
    cli_identity = {"path": "missing", "version": "missing", "sha256": ""}
    if draw_cli and Path(draw_cli).resolve().is_file():
        resolved_cli = Path(draw_cli).resolve()
        version = "unknown"
        try:
            version_result = subprocess.run([str(resolved_cli), "--version"], capture_output=True, text=True, timeout=10, check=False)
            version = (version_result.stdout or version_result.stderr).strip().splitlines()[0] or "unknown"
        except (OSError, subprocess.TimeoutExpired):
            pass
        cli_identity = {"path": str(resolved_cli), "version": version, "sha256": sha256_file(resolved_cli)}
    registry_sha256 = sha256_file(REGISTRY_PATH) if REGISTRY_PATH.is_file() else ""
    benchmark, still_reason = valid_still_canary(
        approval,
        cli_identity=cli_identity,
        registry_sha256=registry_sha256,
        models=models,
    )
    draw_ready = bool(
        draw_cli
        and model_hashes_pass
        and benchmark.get("status") == "pass"
        and benchmark.get("trusted_for_production") is True
        and still_reason == "trusted_canary_pass"
    )
    comfy_ready, comfy_reason = comfy_health()
    deterministic_ready = bool(ffmpeg and Path(ffmpeg).is_file() and ffmpeg_filters_ready)
    video_benchmark = read_json(approval / "local-image-to-video-benchmark.json")
    local_video_ready, local_video_reason = local_video_route_ready(
        video_benchmark, draw_cli_present=bool(draw_cli), comfy_ready=comfy_ready
    )
    blockers: list[str] = []
    capability_gaps: list[str] = []
    if not deterministic_ready:
        blockers.append(f"ffmpeg_full_media_filters_missing:{','.join(missing_ffmpeg_filters) or ffmpeg_filter_reason}")
    if not draw_ready:
        capability_gaps.append(f"draw_things_local_generation_not_verified:{still_reason}")
    if not local_video_ready:
        capability_gaps.append(f"local_image_to_video_not_ready:{local_video_reason}")
    if not policy:
        blockers.append("local_visual_generation_routing_policy_missing")
    status = "pass" if deterministic_ready and draw_ready and local_video_ready else (
        "degraded" if deterministic_ready and not blockers else "blocked"
    )
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "policy": display_path(POLICY_PATH),
        "routes": {
            "deterministic_motion": "ready" if deterministic_ready else "blocked",
            "local_routine_stills": "ready" if draw_ready else "blocked",
            "local_ai_image_to_video": "ready" if local_video_ready else "blocked",
            "codex_thumbnail_support": "owner_approval_required",
        },
        "draw_things": {
            "cli": draw_cli or "missing",
            "model_hashes_pass": model_hashes_pass,
            "benchmark_status": benchmark.get("status", "missing"),
            "benchmark_reason": still_reason,
            "benchmark_generated_at": benchmark.get("generated_at", "missing"),
            "benchmark_blockers": benchmark.get("blockers", []),
            "cli_identity": cli_identity,
            "models": models,
        },
        "comfyui": {"endpoint": "http://127.0.0.1:8188", "ready": comfy_ready, "reason": comfy_reason},
        "local_image_to_video_benchmark": {
            "status": video_benchmark.get("status", "missing"),
            "engine": video_benchmark.get("engine", "missing"),
            "route_reason": local_video_reason,
        },
        "ffmpeg": {
            "path": ffmpeg,
            "required_filters_pass": ffmpeg_filters_ready,
            "missing_filters": missing_ffmpeg_filters,
        },
        "recommended_local_still_candidate": "Z-Image-Turbo after a separate commercial-license and quality/runtime benchmark",
        "recommended_local_motion_order": [
            "FFmpeg deterministic motion",
            "Draw Things LTX-2.3 distilled image-to-video after local benchmark",
            "Wan2.2-TI2V-5B after Apple Silicon benchmark",
        ],
        "blockers": blockers,
        "capability_gaps": capability_gaps,
        "status_semantics": "degraded means optional local AI routes are unavailable; the consuming stage must fail closed only when that route is actually required",
        "no_silent_paid_fallback": True,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-generation-router-report.json"
    md_path = approval / "local-generation-router-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Local Generation Router: Video {video_id}",
        "",
        f"Status: {status}",
        f"Deterministic motion: {payload['routes']['deterministic_motion']}",
        f"Local routine stills: {payload['routes']['local_routine_stills']}",
        f"Local AI image-to-video: {payload['routes']['local_ai_image_to_video']}",
        f"Codex thumbnail support: {payload['routes']['codex_thumbnail_support']}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in blockers] or ["- none"]),
        "",
        "## Optional capability gaps",
        "",
        *([f"- {item}" for item in capability_gaps] or ["- none"]),
        "",
        "No silent paid fallback: yes",
        "Paid provider calls: not performed",
        "YouTube mutation: not performed",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Report Pattern Lab local still and image-to-video routing health.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--require-all-local-ai", action="store_true")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2))
    print(json.dumps({"status": payload["status"], "report": display_path(report), "routes": payload["routes"]}, indent=2))
    if payload["status"] == "blocked" or (args.require_all_local_ai and payload["status"] != "pass"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()

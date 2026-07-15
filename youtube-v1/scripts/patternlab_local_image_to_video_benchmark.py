#!/usr/bin/env python3
"""Benchmark the hash-locked local Draw Things LTX-2.3 support-motion route."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from patternlab_common import BASE, display_path, ensure_dir, ffprobe_cmd, output_root, patternlab_model_root, utc_now
from patternlab_storage_lifecycle import disk_snapshot, operation_budget, read_policy as read_storage_policy
from patternlab_local_media_runtime import execution_context


REGISTRY_PATH = BASE / "resources" / "local-motion-model-registry.json"


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


def build_fixture(path: Path) -> None:
    image = Image.new("RGB", (768, 512), "#102848")
    draw = ImageDraw.Draw(image)
    for index, left in enumerate(range(40, 740, 70)):
        height = 150 + (index % 4) * 45
        draw.rectangle((left, 465 - height, left + 48, 465), fill="#235984", outline="#F2C14E", width=3)
        for y in range(465 - height + 18, 450, 28):
            draw.rectangle((left + 10, y, left + 18, y + 9), fill="#FFE26F")
            draw.rectangle((left + 29, y, left + 37, y + 9), fill="#FFE26F")
    draw.rectangle((0, 465, 768, 512), fill="#0A1728")
    image.save(path)


def probe_video(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    result = subprocess.run(
        [
            ffprobe_cmd(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,avg_frame_rate:format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def companion_receipts(model_path: Path, companions: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    rows: list[dict[str, Any]] = []
    all_verified = True
    for item in companions:
        if not isinstance(item, dict):
            continue
        companion_id = str(item.get("id") or "")
        path = model_path.parent / companion_id if companion_id else Path(str(model_path) + str(item.get("suffix") or ""))
        expected = str(item.get("sha256") or "")
        actual = sha256_file(path) if path.is_file() else ""
        verified = bool(actual and expected and actual == expected)
        rows.append(
            {
                "id": companion_id or path.name,
                "path": display_path(path),
                "present": path.is_file(),
                "sha256": actual,
                "sha256_verified": verified,
            }
        )
        all_verified = all_verified and verified
    return rows, all_verified


def build_report(video_id: str, *, live: bool = False) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    work = ensure_dir(root / "source-packet" / "local-motion-benchmark")
    fixture = work / "source-fixture.png"
    output = work / "ltx-2.3-benchmark.mp4"
    build_fixture(fixture)

    registry = read_json(REGISTRY_PATH)
    model = registry.get("preferred_model") if isinstance(registry.get("preferred_model"), dict) else {}
    model_root = patternlab_model_root()
    model_path = model_root / str(model.get("id") or "")
    expected = str(model.get("sha256") or "")
    actual = sha256_file(model_path) if model_path.is_file() else ""
    companion_rows, companions_verified = companion_receipts(
        model_path,
        model.get("companion_files", []) if isinstance(model.get("companion_files"), list) else [],
    )
    model_hash_verified = bool(actual and expected and actual == expected and companions_verified)
    draw_cli = shutil.which("draw-things-cli")

    blockers: list[str] = []
    context = execution_context()
    storage_gate = operation_budget(read_storage_policy(), "local_image_to_video", disk_snapshot(BASE))
    blockers.extend(storage_gate["blockers"])
    if live and not context["metal_generation_trusted"]:
        blockers.append("local_motion_generation_requires_native_user_runtime_not_codex_seatbelt")
    if not draw_cli:
        blockers.append("draw_things_cli_missing")
    if not model_path.is_file():
        blockers.append("ltx_2_3_model_not_installed")
    if not expected:
        blockers.append("ltx_2_3_model_hash_not_locked")
    elif not model_hash_verified:
        blockers.append("ltx_2_3_model_or_companion_hash_mismatch")
    if not live:
        blockers.append("live_local_benchmark_not_run")

    command: list[str] = []
    returncode: int | None = None
    stderr = ""
    elapsed: float | None = None
    if live and not blockers:
        command = [
            str(draw_cli),
            "generate",
            "--models-dir",
            str(model_root),
            "--model",
            str(model.get("id") or ""),
            "--prompt",
            "subtle slow camera push through a vivid stylized city, stable architecture, no people, no words",
            "--negative-prompt",
            "text, logo, watermark, faces, bending buildings, fake archival footage, fast motion",
            "--image",
            str(fixture),
            "--strength",
            "0.25",
            "--frames",
            "49",
            "--width",
            "768",
            "--height",
            "512",
            "--seed",
            "404",
            "--offline",
            "--disable-preview",
            "--video-format",
            "h264",
            "--output",
            str(output),
        ]
        started = time.monotonic()
        try:
            proc = subprocess.run(command, capture_output=True, text=True, timeout=1800, check=False)
            returncode = proc.returncode
            stderr = proc.stderr[-3000:]
        except (OSError, subprocess.TimeoutExpired) as exc:
            returncode = 127 if isinstance(exc, OSError) else 124
            stderr = f"{type(exc).__name__}: {exc}"
        elapsed = round(time.monotonic() - started, 2)
        if returncode != 0 or not output.is_file():
            blockers.append("ltx_2_3_local_generation_failed")

    probe = probe_video(output)
    duration = float((probe.get("format") or {}).get("duration") or 0) if probe else 0.0
    streams = probe.get("streams") if isinstance(probe.get("streams"), list) else []
    stream = streams[0] if streams else {}
    if live and output.is_file() and (duration <= 0 or int(stream.get("width") or 0) < 640):
        blockers.append("ltx_2_3_output_probe_failed")

    status = "pass" if not blockers else ("planned" if not live else "blocked")
    payload: dict[str, Any] = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "engine": "draw_things_ltx_2_3",
        "model_id": model.get("id", ""),
        "model_path": display_path(model_path),
        "model_present": model_path.is_file(),
        "model_sha256": actual,
        "model_hash_verified": model_hash_verified,
        "companion_files": companion_rows,
        "license": model.get("license", ""),
        "license_url": model.get("license_url", ""),
        "commercial_boundary": model.get("commercial_boundary", ""),
        "local_only": True,
        "source_image": display_path(fixture),
        "source_image_sha256": sha256_file(fixture),
        "output": display_path(output) if output.is_file() else "missing",
        "output_sha256": sha256_file(output) if output.is_file() else "",
        "duration_seconds": round(duration, 3),
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "elapsed_seconds": elapsed,
        "returncode": returncode,
        "failure_excerpt": stderr.replace(str(Path.home()), "<HOME>"),
        "blockers": blockers,
        "storage_gate": storage_gate,
        "execution_context": context,
        "no_automatic_download": True,
        "no_silent_paid_fallback": True,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "local-image-to-video-benchmark.json"
    md_path = approval / "local-image-to-video-benchmark.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Local Image-To-Video Benchmark: {video_id}",
        "",
        f"Status: {status}",
        f"Engine: {payload['engine']}",
        f"Model: {payload['model_id'] or 'missing'}",
        f"Output: {payload['output']}",
        f"Duration: {payload['duration_seconds']}",
        "",
        "## Blockers",
        "",
        *([f"- {item}" for item in blockers] or ["- none"]),
        "",
        "Paid provider calls: not performed",
        "YouTube mutation: not performed",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark the local Draw Things LTX-2.3 motion route.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id.zfill(2), live=args.live)
    print(
        json.dumps(
            {"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]},
            indent=2,
        )
    )
    if args.live and payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

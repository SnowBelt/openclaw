#!/usr/bin/env python3
"""Fail-closed local capability receipt for Pattern Lab production tooling."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, ffprobe_cmd, output_root, utc_now
from patternlab_local_model_health import inspect_models, model_root, read_manifest


PYTHON_MODULES = {
    "pydantic": "pydantic",
    "opentimelineio": "opentimelineio",
    "whisperx": "whisperx",
    "scenedetect": "scenedetect",
    "transformers": "transformers",
    "torch": "torch",
    "opencv": "cv2",
    "pillow": "PIL",
    "imagehash": "imagehash",
    "numpy": "numpy",
    "pytesseract": "pytesseract",
}
BINARY_NAMES = ("tesseract", "llama-mtmd-cli")
NODE_MANIFEST = BASE / "render" / "package.json"
QWEN3_VL_CACHE = Path.home() / ".cache" / "huggingface" / "hub" / "models--Qwen--Qwen3-VL-8B-Instruct-GGUF"


def module_status() -> dict[str, dict[str, str | bool]]:
    result: dict[str, dict[str, str | bool]] = {}
    for capability, module_name in PYTHON_MODULES.items():
        # PyAV and OpenCV ship distinct FFmpeg dylibs on macOS. Probe each in a
        # child process so a health check never co-loads incompatible dylibs.
        probe = subprocess.run(
            [sys.executable, "-c", f"import {module_name} as module; print(getattr(module, '__version__', 'unknown'))"],
            capture_output=True,
            text=True,
            check=False,
        )
        if probe.returncode == 0:
            result[capability] = {"available": True, "version": probe.stdout.strip() or "unknown"}
        else:
            result[capability] = {"available": False, "reason": probe.stderr.strip()[-500:] or "import_failed"}
    return result


def binary_status() -> dict[str, dict[str, str | bool]]:
    result: dict[str, dict[str, str | bool]] = {}
    for name in BINARY_NAMES:
        path = shutil.which(name)
        result[name] = {"available": bool(path), "path": path or ""}
    for name, path in (("ffmpeg", ffmpeg_cmd()), ("ffprobe", ffprobe_cmd())):
        result[name] = {"available": bool(path and Path(path).is_file()), "path": path or ""}
    return result


def ffmpeg_filter_status(path: str) -> dict[str, object]:
    required = ["drawtext", "overlay", "subtitles", "blackdetect", "freezedetect", "loudnorm", "silencedetect", "fps", "scale"]
    try:
        result = subprocess.run([path, "-hide_banner", "-filters"], capture_output=True, text=True, check=False, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "blocked", "required": required, "missing": required, "reason": type(exc).__name__}
    output = result.stdout + result.stderr
    missing = [name for name in required if name not in output]
    return {"status": "pass" if result.returncode == 0 and not missing else "blocked", "required": required, "missing": missing, "reason": f"returncode_{result.returncode}"}


def node_status() -> dict[str, str | bool]:
    if not NODE_MANIFEST.exists():
        return {"available": False, "reason": "renderer_package_manifest_missing"}
    result = subprocess.run(["node", "--version"], capture_output=True, text=True, check=False)
    return {
        "available": result.returncode == 0,
        "version": result.stdout.strip(),
        "renderer_manifest": display_path(NODE_MANIFEST),
    }


def visual_judge_model_status() -> dict[str, object]:
    files = [path for path in QWEN3_VL_CACHE.glob("snapshots/*/*.gguf") if path.is_file()]
    projectors = [path for path in files if "mmproj" in path.name.lower()]
    models = [path for path in files if path not in projectors]
    return {
        "available": bool(models and projectors),
        "model_paths": [str(path) for path in sorted(models)],
        "mmproj_paths": [str(path) for path in sorted(projectors)],
        "minimum_model_bytes": min((path.stat().st_size for path in models), default=0),
        "minimum_mmproj_bytes": min((path.stat().st_size for path in projectors), default=0),
    }


def build_report(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    modules = module_status()
    binaries = binary_status()
    ffmpeg_filters = ffmpeg_filter_status(str(binaries.get("ffmpeg", {}).get("path") or "ffmpeg"))
    node = node_status()
    manifest = read_manifest()
    local_models = inspect_models(manifest, model_root(manifest))
    visual_judge_model = visual_judge_model_status()
    blockers = [f"python_module_missing:{name}" for name, status in modules.items() if not status["available"]]
    blockers.extend(f"binary_missing:{name}" for name, status in binaries.items() if not status["available"])
    if ffmpeg_filters.get("status") != "pass":
        blockers.append(f"ffmpeg_required_filters_missing:{','.join(ffmpeg_filters.get('missing', []))}")
    if not node.get("available"):
        blockers.append("node_renderer_missing")
    blockers.extend(f"local_model_missing:{name}" for name, status in local_models.items() if not status["available"])
    if not visual_judge_model.get("available"):
        blockers.append("local_visual_judge_qwen3_vl_model_or_mmproj_missing")
    free_bytes = shutil.disk_usage(root if root.exists() else BASE).free
    if free_bytes < 20 * 1024**3:
        blockers.append("insufficient_free_disk_under_20_gib")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "python_executable": sys.executable,
        "python_modules": modules,
        "binaries": binaries,
        "ffmpeg_filters": ffmpeg_filters,
        "node": node,
        "local_models": local_models,
        "local_visual_judge_model": visual_judge_model,
        "free_disk_bytes": free_bytes,
        "blockers": blockers,
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "environment-health-report.json"
    md_path = approval / "environment-health-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Environment Health: Video {video_id}", "", f"Status: {payload['status']}",
        f"Python: `{payload['python_executable']}`", f"Free disk: `{free_bytes / 1024**3:.1f} GiB`", "", "## Blockers", "",
        *([f"- {item}" for item in blockers] or ["- none"]), "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify exact Pattern Lab local production capabilities.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

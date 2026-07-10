#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil

from patternlab_common import output_root, utc_now, display_path
from patternlab_shorts_reliability_common import minimum_script_package_ok, script_package, write_report


def tool_status(binary: str) -> str:
    return "available" if shutil.which(binary) else "optional-not-detected"


def build_toolchain_handoff(video_id: str):
    root = output_root(video_id)
    package = script_package(video_id)
    blockers = minimum_script_package_ok(package)
    warnings: list[str] = []
    tools = [
        {
            "tool": "FFmpeg",
            "cost": "free/open-source",
            "required": True,
            "purpose": "repeatable local Shorts rendering",
            "status": tool_status("ffmpeg"),
            "command": f"python3 youtube-v1/scripts/generate_shorts_ffmpeg.py --video-id {video_id}",
        },
        {
            "tool": "Whisper or whisper.cpp",
            "cost": "free/open-source",
            "required": False,
            "purpose": "word timestamps for sentence-boundary proof",
            "status": "optional-free-tool",
            "command": "create local word timestamp JSON under local-output/video-XX/audio/ before rendered-cut validation",
        },
        {
            "tool": "DaVinci Resolve Free",
            "cost": "free tier",
            "required": False,
            "purpose": "manual polish, caption review, motion timing",
            "status": "optional-manual-polish",
            "command": "import rendered MP4 Shorts only after local gates pass",
        },
        {
            "tool": "CapCut",
            "cost": "freemium/optional",
            "required": False,
            "purpose": "optional caption style experiment only; not source-of-truth",
            "status": "optional-freemium",
            "command": "do not use paid features without owner approval",
        },
        {
            "tool": "Subtitle Edit",
            "cost": "free/open-source",
            "required": False,
            "purpose": "caption cleanup when SRT/VTT artifacts exist",
            "status": "optional-free-tool",
            "command": "use only for local caption cleanup; no upload mutation",
        },
        {
            "tool": "PySceneDetect",
            "cost": "free/open-source",
            "required": False,
            "purpose": "optional scene-change helper to avoid repeated visuals",
            "status": "optional-free-tool",
            "command": "use on local footage only if scene-change proof is needed",
        },
    ]
    if any(tool["required"] and tool["status"] != "available" for tool in tools):
        blockers.append("Required free local renderer FFmpeg is not available on PATH.")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "free_first_toolchain_status": "pass" if not blockers else "blocked",
        "paid_tool_usage_status": "blocked_until_exact_owner_approval",
        "external_service_call_performed": False,
        "tools": tools,
    }
    sections = [
        (
            "Free-First Toolchain",
            [
                f"- {tool['tool']}: {tool['status']} — {tool['purpose']} — {tool['command']}"
                for tool in tools
            ],
        ),
        ("Paid Tool Boundary", ["- Paid/freemium features are optional and blocked unless the owner approves the exact tool and scope."]),
    ]
    return write_report(video_id, "shorts-toolchain-handoff", "Pattern Lab Shorts Free-First Toolchain Handoff", payload, sections)


def main():
    parser = argparse.ArgumentParser(description="Generate Pattern Lab Shorts free-first toolchain handoff.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_toolchain_handoff(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Toolchain handoff: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()

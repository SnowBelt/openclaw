#!/usr/bin/env python3
import argparse
import csv
import json
import subprocess
import re
from pathlib import Path

from patternlab_common import display_path, ensure_dir, ffprobe_cmd, media_duration_seconds, output_root, utc_now
from patternlab_shorts_audio_economy import build_audio_economy_report
from patternlab_shorts_boundary_quality import build_boundary_quality_report
from patternlab_shorts_engagement_loop import build_engagement_loop_report
from patternlab_shorts_first_frame_quality import build_first_frame_quality_report
from patternlab_shorts_pacing_quality import build_pacing_quality_report
from patternlab_shorts_script_package import CONTEXT_DEPENDENT_STARTS, MIN_SCORE
from patternlab_shorts_toolchain_handoff import build_toolchain_handoff


SHORT_MIN_SECONDS = 25
SHORT_MAX_SECONDS = 45
SHORT_WIDTH = 1080
SHORT_HEIGHT = 1920
REQUIRED_PSYCHOLOGIES = {"curiosity", "utility", "identity"}
MIN_SHORTS_COUNT = 3
MAX_SHORTS_COUNT = 5



def read_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def context_dependent_text(text):
    return str(text or "").strip().lower().startswith(CONTEXT_DEPENDENT_STARTS)

def read_ledger(root):
    ledger = Path(root) / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def latest_row(rows, filename):
    matches = [row for row in rows if Path(row.get("filename", "")).name == filename]
    return matches[-1] if matches else {}


def video_dimensions(path):
    result = subprocess.run(
        [
            ffprobe_cmd(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    width, height = result.stdout.strip().split("x", 1)
    return int(width), int(height)


def plan_text(root):
    path = Path(root) / "approval" / "shorts-upload-plan.md"
    return path, path.read_text(encoding="utf-8") if path.exists() else ""


def overlay_paths(root, video_id, index):
    return [
        Path(root) / "shorts" / "overlays" / f"pattern-lab-video-{video_id}-short-{index:02d}-{kind}.png"
        for kind in ["first", "hook", "proof", "payoff", "bridge"]
    ]


def build_shorts_quality_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    shorts_dir = root / "shorts"
    shorts = sorted(shorts_dir.glob(f"pattern-lab-video-{video_id}-short-*.mp4")) if shorts_dir.exists() else []
    plan_path, plan = plan_text(root)
    script_package_path = approval / "shorts-script-package.json"
    script_package = read_json(script_package_path)
    audio_economy, _audio_json, audio_md = build_audio_economy_report(video_id)
    boundary_quality, _boundary_json, boundary_md = build_boundary_quality_report(video_id)
    first_frame_quality, _first_json, first_md = build_first_frame_quality_report(video_id)
    pacing_quality, _pacing_json, pacing_md = build_pacing_quality_report(video_id)
    engagement_loop, _engagement_json, engagement_md = build_engagement_loop_report(video_id)
    toolchain_handoff, _toolchain_json, toolchain_md = build_toolchain_handoff(video_id)
    reliability_reports = [
        ("audio economy", audio_economy, audio_md),
        ("boundary quality", boundary_quality, boundary_md),
        ("first-frame quality", first_frame_quality, first_md),
        ("pacing quality", pacing_quality, pacing_md),
        ("engagement loop", engagement_loop, engagement_md),
        ("toolchain handoff", toolchain_handoff, toolchain_md),
    ]
    ledger_rows = read_ledger(root)
    blockers = []
    warnings = []
    candidate_reports = []
    for label, payload, report in reliability_reports:
        if payload.get("status") != "pass":
            blockers.append(f"Shorts {label} report is blocked: {display_path(report)}.")

    if not script_package:
        blockers.append(f"Shorts script package is missing: {display_path(script_package_path)}.")
    elif script_package.get("status") != "pass":
        blockers.append(f"Shorts script package is blocked: {display_path(script_package_path)}.")
    else:
        for item in script_package.get("shorts", []):
            if item.get("score", 0) < MIN_SCORE:
                blockers.append(f"{item.get('id')}: standalone score below {MIN_SCORE}.")
            if context_dependent_text(item.get("hook", "")):
                blockers.append(f"{item.get('id')}: hook starts with context-dependent phrasing.")
            if context_dependent_text(item.get("script", "")):
                blockers.append(f"{item.get('id')}: script starts with context-dependent phrasing.")
            if not item.get("payoff"):
                blockers.append(f"{item.get('id')}: payoff is missing.")

    if not plan:
        blockers.append(f"Shorts upload plan is missing: {display_path(plan_path)}.")
    else:
        if "Timestamp source: scripted-short-package" not in plan:
            blockers.append("Shorts must be selected by scripted-short-package, not raw fixed timestamps.")
        if plan.count("Start boundary: scripted_short_no_long_form_cut") < MIN_SHORTS_COUNT:
            blockers.append("Shorts upload plan must use scripted boundary-safe starts for every Short draft.")
        if plan.count("Standalone score:") < MIN_SHORTS_COUNT:
            blockers.append("Shorts upload plan must include standalone score for every Short.")
        for phrase in [
            "Render format: vertical 1080x1920 with Shorts-native overlay captions",
            "Retention arc: first-frame promise, hook, proof/payoff, related-video bridge",
        ]:
            if plan.count(phrase) < MIN_SHORTS_COUNT:
                blockers.append(f"Shorts upload plan missing required quality marker: {phrase}.")
        if plan.count("Generic standalone-tip risk: pass") < MIN_SHORTS_COUNT:
            blockers.append("Shorts upload plan must mark all Shorts as passing generic standalone-tip risk.")
        if plan.count("Related-video checklist:") < MIN_SHORTS_COUNT:
            blockers.append("Shorts upload plan must include a related-video checklist for every Short.")
        found_psychologies = set()
        for line in plan.splitlines():
            if line.lower().startswith("- viewer psychology:"):
                found_psychologies.add(line.split(":", 1)[1].strip().lower())
        if not REQUIRED_PSYCHOLOGIES.issubset(found_psychologies):
            blockers.append(f"Shorts psychology set must include curiosity, utility, and identity; found {sorted(found_psychologies)}.")

    if len(shorts) < MIN_SHORTS_COUNT:
        blockers.append(f"Shorts count must be at least {MIN_SHORTS_COUNT}; found {len(shorts)}.")
    if len(shorts) > MAX_SHORTS_COUNT:
        blockers.append(f"Shorts count must be at most {MAX_SHORTS_COUNT}; found {len(shorts)}.")

    for index, short in enumerate(shorts, 1):
        overlays = overlay_paths(root, video_id, index)
        row = latest_row(ledger_rows, short.name)
        report = {
            "index": index,
            "file": display_path(short),
            "exists": short.exists(),
            "duration_seconds": None,
            "dimensions": "",
            "overlay_files": [display_path(path) for path in overlays],
            "overlay_count": sum(1 for path in overlays if path.exists() and path.stat().st_size > 0),
            "overlay_set_complete": all(path.exists() and path.stat().st_size > 0 for path in overlays),
            "ledger_asset_type": row.get("asset_type", ""),
            "ledger_review_status": row.get("human_review_status", ""),
        }
        candidate_reports.append(report)
        if not short.exists():
            blockers.append(f"Short {index} video file is missing.")
            continue
        try:
            duration = media_duration_seconds(short)
            report["duration_seconds"] = round(duration, 2)
            if duration < SHORT_MIN_SECONDS or duration > SHORT_MAX_SECONDS:
                blockers.append(f"Short {index} duration must be 25-45 seconds; got {duration:.1f}s.")
        except Exception as exc:
            blockers.append(f"Could not verify Short {index} duration: {exc}.")
        try:
            width, height = video_dimensions(short)
            report["dimensions"] = f"{width}x{height}"
            if width != SHORT_WIDTH or height != SHORT_HEIGHT:
                blockers.append(f"Short {index} must be {SHORT_WIDTH}x{SHORT_HEIGHT}; got {width}x{height}.")
        except Exception as exc:
            blockers.append(f"Could not verify Short {index} dimensions: {exc}.")
        if not report["overlay_set_complete"]:
            blockers.append(f"Short {index} overlay PNG set is incomplete.")
        if row.get("asset_type") != "short":
            blockers.append(f"Short {index} is missing a rights-ledger row.")
        if "overlay=shorts/overlays/" not in row.get("notes", ""):
            blockers.append(f"Short {index} ledger row must reference the overlay PNG set.")

    status = "pass" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "blockers": blockers,
        "warnings": warnings,
        "required_dimensions": f"{SHORT_WIDTH}x{SHORT_HEIGHT}",
        "required_duration_seconds": f"{SHORT_MIN_SECONDS}-{SHORT_MAX_SECONDS}",
        "shorts_script_package": {
            "path": display_path(script_package_path),
            "status": script_package.get("status", "missing"),
            "shorts_count": script_package.get("shorts_count", 0),
            "minimum_score": script_package.get("minimum_score", MIN_SCORE),
        },
        "reliability_reports": {
            "audio_economy": {"status": audio_economy.get("status", "missing"), "path": display_path(audio_md)},
            "boundary_quality": {"status": boundary_quality.get("status", "missing"), "path": display_path(boundary_md)},
            "first_frame_quality": {"status": first_frame_quality.get("status", "missing"), "path": display_path(first_md)},
            "pacing_quality": {"status": pacing_quality.get("status", "missing"), "path": display_path(pacing_md)},
            "engagement_loop": {"status": engagement_loop.get("status", "missing"), "path": display_path(engagement_md)},
            "toolchain_handoff": {"status": toolchain_handoff.get("status", "missing"), "path": display_path(toolchain_md)},
        },
        "shorts": candidate_reports,
        "shorts_count": len(candidate_reports),
        "minimum_shorts_count": MIN_SHORTS_COUNT,
        "maximum_shorts_count": MAX_SHORTS_COUNT,
    }
    json_path = approval / "shorts-quality-report.json"
    md_path = approval / "shorts-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Shorts Quality Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {status}",
        "",
        "## Script Package",
        "",
        f"- Path: {display_path(script_package_path)}",
        f"- Status: {script_package.get('status', 'missing')}",
        f"- Shorts count: {script_package.get('shorts_count', 0)}",
        "",
        "## Reliability Reports",
        "",
        f"- Audio economy: {audio_economy.get('status', 'missing')} ({display_path(audio_md)})",
        f"- Boundary quality: {boundary_quality.get('status', 'missing')} ({display_path(boundary_md)})",
        f"- First-frame quality: {first_frame_quality.get('status', 'missing')} ({display_path(first_md)})",
        f"- Pacing quality: {pacing_quality.get('status', 'missing')} ({display_path(pacing_md)})",
        f"- Engagement loop: {engagement_loop.get('status', 'missing')} ({display_path(engagement_md)})",
        f"- Toolchain handoff: {toolchain_handoff.get('status', 'missing')} ({display_path(toolchain_md)})",
        "",
        "## Strategy",
        "",
        "- Short 1: curiosity hook.",
        "- Short 2: utility hook.",
        "- Short 3: identity/payoff hook.",
        "- Shorts 4-5 when available: system/emotion hooks selected by score.",
        "- Required structure: first-frame promise, hook, proof/payoff, related-video bridge.",
        "- Required render: 1080x1920 vertical with overlay captions.",
        "",
        "## Shorts",
        "",
    ]
    for item in candidate_reports:
        lines.append(
            f"- Short {item['index']}: {item['file']} | exists={item['exists']} | "
            f"duration={item['duration_seconds'] or 'missing'}s | {item['dimensions'] or 'missing'} | "
            f"overlays={item['overlay_count']}/5 | ledger={item['ledger_asset_type'] or 'missing'}"
        )
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab Shorts quality.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, report = build_shorts_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Shorts quality report: {display_path(report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")


if __name__ == "__main__":
    main()

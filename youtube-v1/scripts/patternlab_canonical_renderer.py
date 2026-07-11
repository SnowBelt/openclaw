#!/usr/bin/env python3
"""Deterministically render only a hash-verified Pattern Lab evidence timeline."""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.evidence import EvidenceError, load_manifest, verify_manifest_assets
from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, media_duration_seconds, output_root, utc_now
from patternlab.state import sha256_file


PROOF_ROLES = {"source_proof", "map_system", "archive_evidence", "document_detail"}
MAX_EVENT_SECONDS = 40.0
MIN_EVENT_SECONDS = 1.0
FPS = 30


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except json.JSONDecodeError:
        return {}


def ledger_labels(root: Path) -> dict[str, str]:
    ledger = root / "rights-ledger.csv"
    if not ledger.exists():
        return {}
    with ledger.open(encoding="utf-8", newline="") as handle:
        rows = csv.DictReader(handle)
        return {
            row.get("asset_id", ""): (row.get("source_title") or row.get("source_url") or row.get("asset_id", ""))
            for row in rows
            if row.get("asset_id")
        }


def escape_drawtext(value: str) -> str:
    return str(value).replace("\\", r"\\").replace("'", r"\'").replace(":", r"\:").replace("%", r"\%")


def render_plan(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest_path = approval / "evidence-manifest.json"
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    alignment = read_json(approval / "word-alignment-report.json")
    srt = root / "captions" / "word-aligned.srt"
    blockers: list[str] = []
    manifest = None
    try:
        manifest = load_manifest(manifest_path)
        if manifest.episode_id != video_id:
            raise EvidenceError(f"evidence_manifest_video_mismatch:{manifest.episode_id}")
        verify_manifest_assets(manifest, root)
    except EvidenceError as exc:
        blockers.append(str(exc))
    if not audio.exists():
        blockers.append("voiceover_audio_missing")
    if alignment.get("status") != "pass" or not srt.exists():
        blockers.append("word_aligned_captions_missing_or_blocked")
    beats: list[dict] = []
    if manifest is not None:
        assets = {asset.asset_id: asset for asset in manifest.assets}
        labels = ledger_labels(root)
        for beat in manifest.visual_beats:
            duration = round(beat.end_seconds - beat.start_seconds, 3)
            if duration < MIN_EVENT_SECONDS or duration > MAX_EVENT_SECONDS:
                blockers.append(f"visual_event_duration_out_of_bounds:{beat.beat_id}:{duration}")
                continue
            asset = assets[beat.asset_ids[0]]
            source_label = labels.get(asset.asset_id, asset.source_id)
            beats.append({
                "beat_id": beat.beat_id,
                "start_seconds": beat.start_seconds,
                "end_seconds": beat.end_seconds,
                "duration_seconds": duration,
                "role": beat.role,
                "claim_ids": list(beat.claim_ids),
                "asset_id": asset.asset_id,
                "asset_sha256": asset.sha256,
                "asset_path": asset.relative_path,
                "source_id": asset.source_id,
                "source_label": source_label[:150],
                "source_class": asset.source_class,
                "evidence_fit": asset.evidence_fit,
                "ai_disclosure": "Supporting reconstruction — not archival evidence" if asset.source_class == "ai_reconstruction" else "",
            })
        if beats and beats[0]["role"] not in PROOF_ROLES:
            blockers.append("first_visual_event_is_not_source_proof")
        first_30 = [beat for beat in beats if beat["start_seconds"] < 30]
        if not any(beat["role"] in PROOF_ROLES for beat in first_30):
            blockers.append("first_30_seconds_missing_source_proof")
        if any(beat["role"] in PROOF_ROLES and beat["evidence_fit"] != "direct" for beat in beats):
            blockers.append("proof_role_not_backed_by_direct_evidence")
        if audio.exists() and beats:
            audio_duration = media_duration_seconds(audio)
            timeline_duration = max(beat["end_seconds"] for beat in beats)
            if abs(audio_duration - timeline_duration) > 2.0:
                blockers.append(f"timeline_audio_duration_mismatch:{timeline_duration:.2f}:{audio_duration:.2f}")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "manifest": display_path(manifest_path),
        "audio": display_path(audio),
        "captions_srt": display_path(srt),
        "beats": beats,
        "render_contract": "canonical evidence manifest plus local word-aligned captions only",
        "generic_media_fallback": "forbidden",
        "youtube_mutation": "not_performed",
        "blockers": sorted(set(blockers)),
    }
    json_path = approval / "canonical-render-plan.json"
    md_path = approval / "canonical-render-plan.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Canonical Render Plan: Video {video_id}", "", f"Status: {payload['status']}",
        f"Visual events: {len(beats)}", "", "## Blockers", "",
        *([f"- {item}" for item in payload["blockers"]] or ["- none"]), "", "## Beats", "",
        *[f"- {beat['start_seconds']:.1f}-{beat['end_seconds']:.1f}s | {beat['role']} | {beat['asset_path']} | {beat['source_label']}" for beat in beats],
        "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def motion_filter(frame_count: int, index: int) -> str:
    direction = "(iw-iw/zoom)*on/%d" % frame_count if index % 2 else "(iw-iw/zoom)*(1-on/%d)" % frame_count
    return (
        "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,"
        f"zoompan=z='1.01+0.05*on/{frame_count}':x='{direction}':y='ih/2-(ih/zoom/2)':d={frame_count}:s=1920x1080:fps={FPS},format=yuv420p"
    )


def render(video_id: str, plan: dict) -> Path:
    root = output_root(video_id)
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    captions = root / "captions" / "word-aligned.srt"
    output = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    clips_dir = ensure_dir(root / "video" / "canonical-clips")
    clip_paths: list[Path] = []
    for index, beat in enumerate(plan["beats"], start=1):
        source = root / beat["asset_path"]
        clip = clips_dir / f"{index:03d}-{beat['beat_id']}.mp4"
        frame_count = max(1, round(float(beat["duration_seconds"]) * FPS))
        source_label = escape_drawtext("Source: " + beat["source_label"])
        disclosure = escape_drawtext(beat["ai_disclosure"])
        text = source_label if not disclosure else source_label + "\\n" + disclosure
        vf = motion_filter(frame_count, index) + f",drawtext=text='{text}':x=48:y=h-th-48:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14"
        subprocess.run([
            ffmpeg_cmd(), "-y", "-loop", "1", "-i", str(source), "-vf", vf, "-an", "-c:v", "libx264",
            "-preset", "veryfast", "-r", str(FPS), "-frames:v", str(frame_count), str(clip),
        ], check=True)
        clip_paths.append(clip)
    concat = clips_dir / "concat.txt"
    concat.write_text("".join(f"file '{path}'\n" for path in clip_paths), encoding="utf-8")
    silent = clips_dir / "silent.mp4"
    subprocess.run([ffmpeg_cmd(), "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(silent)], check=True)
    subtitles = str(captions).replace("\\", r"\\").replace(":", r"\:")
    subprocess.run([
        ffmpeg_cmd(), "-y", "-i", str(silent), "-i", str(audio), "-vf", f"subtitles='{subtitles}'", "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", str(output),
    ], check=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or render a Pattern Lab evidence-only long-form video.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    payload, _, md_path = render_plan(args.video_id.zfill(2))
    print(f"Status: {payload['status']}")
    print(f"Plan: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)
    if args.render:
        output = render(args.video_id.zfill(2), payload)
        print(f"Rendered: {display_path(output)}")
        print(f"SHA-256: {sha256_file(output)}")


if __name__ == "__main__":
    main()

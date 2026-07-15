#!/usr/bin/env python3
"""Deterministically render only a hash-verified Pattern Lab evidence timeline."""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import shutil
import tempfile
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.evidence import EvidenceError, load_manifest, verify_manifest_assets
from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, media_duration_seconds, output_root, utc_now
from patternlab.state import sha256_file
from patternlab_long_form_sequence_quality import contact_sheet_asset_repeats
from patternlab_media_qa_common import load_policy as load_media_qa_policy
from patternlab_storage_lifecycle import disk_snapshot, operation_budget, read_policy as read_storage_policy


PROOF_ROLES = {"source_proof", "map_system", "archive_evidence", "document_detail"}
MAX_EVENT_SECONDS = 40.0
MIN_EVENT_SECONDS = 1.0
MAX_CALLOUT_SHARE_AFTER_FIRST_30_SECONDS = 0.25
FPS = 30


def render_environment(root: Path) -> dict[str, str]:
    env = os.environ.copy()
    cache = ensure_dir(root / "cache" / "fontconfig")
    env["XDG_CACHE_HOME"] = str(cache.parent)
    return env


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except json.JSONDecodeError:
        return {}


def episode_render_metadata(video_id: str) -> tuple[str, dict[str, list[str]], list[str]]:
    launch = BASE / "launch" / f"video-{video_id}"
    package = read_json(launch / "package.json")
    route = read_json(launch / "long-form-visual-routing.json")
    city = str(package.get("city") or "").strip()
    blockers: list[str] = []
    if not city:
        blockers.append("renderer_episode_city_missing")
    if str(route.get("city") or "").strip().casefold() != city.casefold():
        blockers.append("renderer_route_city_mismatch")
    raw_labels = route.get("chapter_labels") if isinstance(route.get("chapter_labels"), dict) else {}
    chapter_labels: dict[str, list[str]] = {}
    for claim_id, value in raw_labels.items():
        if isinstance(value, list) and len(value) == 2 and all(str(item).strip() for item in value):
            chapter_labels[str(claim_id)] = [str(item).strip() for item in value]
    if not chapter_labels:
        blockers.append("renderer_episode_chapter_labels_missing")
    return city, chapter_labels, blockers


def ledger_labels(root: Path) -> dict[str, str]:
    ledger = root / "rights-ledger.csv"
    labels: dict[str, str] = {}
    intake_ledger = read_json(root / "approval" / "evidence-asset-ledger.json")
    for row in intake_ledger.get("assets", []) if isinstance(intake_ledger.get("assets"), list) else []:
        asset_id = str(row.get("asset_id") or "")
        url = str(row.get("source_url") or "").lower()
        if not asset_id:
            continue
        if "loc.gov" in url:
            labels[asset_id] = "Library of Congress"
        elif "archive.org" in url:
            labels[asset_id] = "Internet Archive"
        elif "fhwa.dot.gov" in url:
            labels[asset_id] = "U.S. FHWA"
        elif "nps.gov" in url:
            labels[asset_id] = "National Park Service"
        elif "neh.gov" in url:
            labels[asset_id] = "National Endowment for the Humanities"
        elif "pexels.com" in url:
            labels[asset_id] = "Pexels"
        else:
            labels[asset_id] = str(row.get("creator") or row.get("source_title") or row.get("source_id") or asset_id)[:80]
    if not ledger.exists():
        return labels
    with ledger.open(encoding="utf-8", newline="") as handle:
        rows = csv.DictReader(handle)
        labels.update({
            row.get("asset_id", ""): (row.get("source_title") or row.get("source_url") or row.get("asset_id", ""))
            for row in rows
            if row.get("asset_id")
        })
    return labels


def escape_drawtext(value: str) -> str:
    # FFmpeg's nested filter parser can consume a backslash before an ASCII
    # apostrophe and terminate the quoted drawtext expression.  A typographic
    # apostrophe is visually preferable and is not a filter delimiter.
    return str(value).replace("'", "’").replace("\\", r"\\").replace(":", r"\:").replace("%", r"\%")


def provenance_drawtext_filters(source_label: str, disclosure: str) -> str:
    """Build deterministic one-line provenance filters without newline escapes.

    FFmpeg's nested drawtext parser can consume a newline escape as a literal
    ``n``. Separate filters prevent labels such as ``nDetroit context`` and
    keep a disclosure-only label anchored to the first line.
    """
    lines = [escape_drawtext(value) for value in (source_label, disclosure) if str(value).strip()]
    return "".join(
        (
            f",drawtext=text='{line}':x=108:y={64 + index * 34}:fontsize=26:fontcolor=white@0.96:"
            "borderw=2:bordercolor=black@0.95:shadowx=2:shadowy=2:"
            "shadowcolor=black@0.75:enable='lt(t,1.8)'"
        )
        for index, line in enumerate(lines)
    )


def sequence_window_reuse_blockers(beats: list[dict]) -> tuple[list[dict], list[str]]:
    policy = load_media_qa_policy().get("long_form_sequence", {})
    beats_per_sheet = int(policy.get("contact_sheet_columns", 4)) * int(
        policy.get("contact_sheet_rows", 4)
    )
    repeats = contact_sheet_asset_repeats(
        beats,
        beats_per_sheet=beats_per_sheet,
        maximum_uses=int(policy.get("maximum_asset_uses_per_contact_sheet", 1)),
    )
    blockers = [
        "pre_render_asset_repeated_within_contact_sheet:"
        f"{row['sheet_index']}:{row['asset_id']}:{row['uses']}"
        for row in repeats
    ]
    return repeats, blockers


def render_plan(video_id: str) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    manifest_path = approval / "evidence-manifest.json"
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    alignment = read_json(approval / "word-alignment-report.json")
    srt = root / "captions" / "closed-captions-final.srt"
    blockers: list[str] = []
    city, chapter_labels, metadata_blockers = episode_render_metadata(video_id)
    blockers.extend(metadata_blockers)
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
    closed_caption_report = read_json(approval / "closed-captions-report.json")
    if alignment.get("status") != "pass":
        blockers.append("word_alignment_missing_or_blocked")
    if closed_caption_report.get("status") != "pass" or not srt.exists():
        blockers.append("closed_captions_missing_or_blocked")
    beats: list[dict] = []
    if manifest is not None:
        assets = {asset.asset_id: asset for asset in manifest.assets}
        labels = ledger_labels(root)
        seen_claim_ids: set[str] = set()
        seen_context_assets: set[str] = set()
        for beat in manifest.visual_beats:
            duration = round(beat.end_seconds - beat.start_seconds, 3)
            if duration < MIN_EVENT_SECONDS or duration > MAX_EVENT_SECONDS:
                blockers.append(f"visual_event_duration_out_of_bounds:{beat.beat_id}:{duration}")
                continue
            asset = assets[beat.asset_ids[0]]
            source_label = labels.get(asset.asset_id, asset.source_id)
            claim_id = str(beat.claim_ids[0]) if beat.claim_ids else ""
            chapter_label = []
            if beat.start_seconds >= 30.0 and claim_id and claim_id not in seen_claim_ids:
                chapter_label = list(chapter_labels.get(claim_id, ()))
            keep_callout = bool(
                beat.editorial_callout
                and not chapter_label
                and (beat.start_seconds < 30.0 or beat.role in PROOF_ROLES or beat.role == "then_now")
            )
            context_disclosure = ""
            if asset.editorial_role == "context_only":
                candidate_disclosure = str(asset.on_screen_disclosure or "").strip()
                must_repeat_disclosure = asset.geographic_scope == "generic" or "not " in candidate_disclosure.lower()
                if candidate_disclosure and (must_repeat_disclosure or asset.asset_id not in seen_context_assets):
                    context_disclosure = candidate_disclosure
                elif asset.geographic_scope == "generic":
                    context_disclosure = f"Illustrative footage — not the named {city} location"
            show_source_label = beat.role in PROOF_ROLES
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
                "source_label": source_label[:150] if show_source_label else "",
                "source_class": asset.source_class,
                "asset_kind": asset.asset_kind,
                "evidence_fit": asset.evidence_fit,
                "editorial_role": asset.editorial_role,
                "geographic_scope": asset.geographic_scope,
                "may_imply_named_city": asset.may_imply_named_city,
                "context_action": asset.context_action,
                "context_emotion": asset.context_emotion,
                "reuse_reason": beat.reuse_reason,
                "presentation_variant": beat.presentation_variant,
                "focus_x": beat.focus_x,
                "focus_y": beat.focus_y,
                "zoom_start": beat.zoom_start,
                "zoom_end": beat.zoom_end,
                "clip_start_seconds": beat.clip_start_seconds,
                "clip_end_seconds": beat.clip_end_seconds,
                "editorial_callout": beat.editorial_callout if keep_callout else "",
                "ai_disclosure": asset.on_screen_disclosure if asset.source_class == "ai_reconstruction" else "",
                "context_disclosure": context_disclosure,
                "chapter_label": chapter_label,
            })
            seen_claim_ids.update(str(item) for item in beat.claim_ids)
            seen_context_assets.add(asset.asset_id)
            if asset.asset_kind in {"film", "modern_video", "source_motion"}:
                if beat.clip_start_seconds is None or beat.clip_end_seconds is None:
                    blockers.append(f"moving_source_requires_explicit_clip_window:{beat.beat_id}")
                else:
                    source_duration = media_duration_seconds(root / asset.relative_path)
                    if beat.clip_end_seconds > source_duration + 0.05:
                        blockers.append(
                            f"moving_source_clip_exceeds_duration:{beat.beat_id}:{beat.clip_end_seconds:.3f}:{source_duration:.3f}"
                        )
        if beats and beats[0]["role"] not in PROOF_ROLES:
            blockers.append("first_visual_event_is_not_source_proof")
        first_30 = [beat for beat in beats if beat["start_seconds"] < 30]
        if not any(beat["role"] in PROOF_ROLES for beat in first_30):
            blockers.append("first_30_seconds_missing_source_proof")
        if any(beat["role"] in PROOF_ROLES and beat["evidence_fit"] != "direct" for beat in beats):
            blockers.append("proof_role_not_backed_by_direct_evidence")
        after_first_30 = [beat for beat in beats if beat["start_seconds"] >= 30.0]
        callout_share = (
            sum(bool(beat["editorial_callout"]) for beat in after_first_30) / len(after_first_30)
            if after_first_30
            else 0.0
        )
        if callout_share > MAX_CALLOUT_SHARE_AFTER_FIRST_30_SECONDS + 1e-6:
            blockers.append(f"editorial_callout_share_above_ceiling:{callout_share:.4f}")
        if audio.exists() and beats:
            audio_duration = media_duration_seconds(audio)
            timeline_duration = max(beat["end_seconds"] for beat in beats)
            if abs(audio_duration - timeline_duration) > 2.0:
                blockers.append(f"timeline_audio_duration_mismatch:{timeline_duration:.2f}:{audio_duration:.2f}")
    pre_render_repeats, reuse_blockers = sequence_window_reuse_blockers(beats)
    blockers.extend(reuse_blockers)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "pass" if not blockers else "blocked",
        "manifest": display_path(manifest_path),
        "audio": display_path(audio),
        "captions_srt": display_path(srt),
        "beats": beats,
        "render_contract": "canonical evidence manifest, one source at a time, external closed captions, and selective editorial text",
        "caption_mode": "closed_captions_plus_selective_editorial_text",
        "split_screen_compositing": "forbidden",
        "generic_media_fallback": "forbidden",
        "editorial_text_policy": {
            "full_narration_burned_in": False,
            "callout_beat_count": sum(bool(beat["editorial_callout"]) for beat in beats),
            "chapter_card_beat_count": sum(bool(beat["chapter_label"]) for beat in beats),
            "source_or_disclosure_label_beat_count": sum(
                bool(beat["source_label"] or beat["context_disclosure"] or beat["ai_disclosure"])
                for beat in beats
            ),
            "maximum_callout_share_after_first_30_seconds": MAX_CALLOUT_SHARE_AFTER_FIRST_30_SECONDS,
        },
        "pre_render_contact_sheet_asset_repeats": pre_render_repeats,
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


def motion_filter(frame_count: int, beat: dict, style: str = "ken_burns_push") -> str:
    progress = f"on/{max(1, frame_count - 1)}"
    focus_x = float(beat.get("focus_x", 0.5))
    focus_y = float(beat.get("focus_y", 0.5))
    zoom_start = float(beat.get("zoom_start", 1.02))
    zoom_end = float(beat.get("zoom_end", 1.10))
    if style == "document_closeup":
        zoom_end = max(zoom_end, min(1.24, zoom_start + 0.12))
    elif style == "map_zoom_trace":
        zoom_end = max(zoom_end, min(1.22, zoom_start + 0.14))
    elif style == "slow_context_pan":
        zoom_end = max(zoom_end, min(1.12, zoom_start + 0.07))
    elif style not in {
        "ken_burns_push",
        "source_highlight",
        "then_now_single_source",
        "cta_push",
        "reconstruction_slow_push",
    }:
        raise ValueError(f"unsupported_still_motion_style:{style}")
    zoom = f"{zoom_start:.4f}+({zoom_end:.4f}-{zoom_start:.4f})*{progress}"
    x = f"iw*{focus_x:.4f}-iw/zoom/2"
    y = f"ih*{focus_y:.4f}-ih/zoom/2"
    return (
        "scale=2400:1350:force_original_aspect_ratio=increase,crop=2400:1350,"
        "eq=contrast=1.08:brightness=0.025:saturation=1.08,unsharp=5:5:0.45,"
        f"zoompan=z='{zoom}':x='max(0,min(iw-iw/zoom,{x}))':y='max(0,min(ih-ih/zoom,{y}))':"
        f"d={frame_count}:s=1920x1080:fps={FPS},format=yuv420p"
    )


def video_filter(style: str) -> str:
    if style not in {"native_video_source", "native_video_context", "slow_context_pan"}:
        raise ValueError(f"unsupported_video_motion_style:{style}")
    return "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.08:brightness=0.02:saturation=1.05,unsharp=5:5:0.35,fps=30,format=yuv420p"


def render(video_id: str, plan: dict) -> Path:
    root = output_root(video_id)
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    captions = root / "captions" / "closed-captions-final.srt"
    output = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    ensure_dir(output.parent)
    storage_gate = operation_budget(read_storage_policy(), "long_form_render", disk_snapshot(BASE))
    if storage_gate["status"] != "pass":
        raise SystemExit("canonical_render_storage_gate_blocked:" + ",".join(storage_gate["blockers"]))
    env = render_environment(root)
    motion_plan = read_json(root / "approval" / "canonical-motion-plan.json")
    if motion_plan.get("status") != "pass":
        raise SystemExit("canonical_motion_plan_not_pass")
    motion_by_beat = {item.get("beat_id"): item.get("motion_style") for item in motion_plan.get("beats", [])}
    with tempfile.TemporaryDirectory(prefix="patternlab-render-", dir=str(output.parent)) as temporary_dir:
        clips_dir = Path(temporary_dir)
        clip_paths: list[Path] = []
        for index, beat in enumerate(plan["beats"], start=1):
            source = root / beat["asset_path"]
            clip = clips_dir / f"{index:03d}-{beat['beat_id']}.mp4"
            frame_count = max(1, round(float(beat["duration_seconds"]) * FPS))
            source_label = beat["source_label"]
            disclosure = beat["ai_disclosure"] or beat.get("context_disclosure", "")
            style = motion_by_beat.get(beat["beat_id"])
            if not style:
                raise SystemExit(f"canonical_motion_style_missing:{beat['beat_id']}")
            video_asset = beat.get("asset_kind") in {"film", "modern_video", "source_motion"}
            base_filter = video_filter(style) if video_asset else motion_filter(frame_count, beat, style)
            # Source labels must remain readable without creating the floating
            # opaque rectangles the owner rejected in earlier drafts.
            vf = base_filter
            vf += provenance_drawtext_filters(source_label, disclosure)
            chapter = beat.get("chapter_label") or []
            if len(chapter) == 2 and chapter[0] and chapter[1]:
                eyebrow = escape_drawtext(chapter[0])
                title = escape_drawtext(chapter[1])
                vf += (
                    f",drawtext=text='{eyebrow}':x=96:y=148:fontsize=40:fontcolor=0xFFD319:"
                    f"borderw=3:bordercolor=black@0.95:shadowx=3:shadowy=3:shadowcolor=black@0.8:enable='lt(t,2.0)'"
                    f",drawtext=text='{title}':x=96:y=210:fontsize=70:fontcolor=white:"
                    f"borderw=5:bordercolor=black@0.98:shadowx=4:shadowy=4:shadowcolor=black@0.85:enable='lt(t,2.0)'"
                )
            callout = escape_drawtext(beat.get("editorial_callout", ""))
            if callout and not chapter:
                vf += (
                    f",drawtext=fontfile='{BASE / 'resources/fonts/external/anton-google-regular.ttf'}':"
                    f"text='{callout}':x=(w-text_w)/2:y=h*0.77:fontsize=58:fontcolor=white:"
                    "borderw=5:bordercolor=black@0.98:shadowx=4:shadowy=4:shadowcolor=black@0.85:"
                    "enable='between(t,0.15,1.75)'"
                )
            command = [ffmpeg_cmd(), "-y"]
            if video_asset:
                clip_start = beat.get("clip_start_seconds")
                if clip_start is None:
                    raise SystemExit(f"explicit_video_clip_start_missing:{beat['beat_id']}")
                command.extend(["-ss", f"{float(clip_start):.3f}", "-i", str(source), "-t", f"{float(beat['duration_seconds']):.3f}"])
            else:
                command.extend(["-loop", "1", "-i", str(source)])
            command.extend([
                "-vf", vf, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16",
                "-pix_fmt", "yuv420p", "-r", str(FPS), "-frames:v", str(frame_count), str(clip),
            ])
            subprocess.run(command, check=True, env=env)
            clip_paths.append(clip)
        concat = clips_dir / "concat.txt"
        concat.write_text("".join(f"file '{path}'\n" for path in clip_paths), encoding="utf-8")
        silent = clips_dir / "silent.mp4"
        subprocess.run([ffmpeg_cmd(), "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent)], check=True, env=env)
        temporary_output = clips_dir / "final.mp4"
        subprocess.run([
            ffmpeg_cmd(), "-y", "-i", str(silent), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-af", "loudnorm=I=-15.5:TP=-2.2:LRA=11",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(temporary_output),
        ], check=True, env=env)
        rejected_dir = ensure_dir(output.parent / "rejected")
        if output.is_file():
            superseded = rejected_dir / f"pattern-lab-video-{video_id}-superseded-render-{sha256_file(output)[:12]}.mp4"
            if not superseded.exists():
                shutil.copy2(output, superseded)
        temporary_output.replace(output)
        companion = output.with_suffix(".en.srt")
        shutil.copy2(captions, companion)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or render a Pattern Lab evidence-only long-form video.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    if args.render and os.environ.get("PATTERNLAB_CANONICAL_RUN") != "1":
        raise SystemExit(
            "Direct production rendering is unsupported. Run patternlab_production.py so all current QA stages execute."
        )
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

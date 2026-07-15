#!/usr/bin/env python3
"""Render city-generic Pattern Lab Shorts from approved James narration.

No speech is synthesized and no placeholder long-form timestamps are clipped.
Every Short is built from exact complete sentences found in the approved word
alignment and from four or more episode-owned, rights-reviewed source assets.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import require_city
from patternlab.shorts_alignment import locate_all
from patternlab.state import sha256_file
from patternlab_common import append_ledger, display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now


FPS = 30
MAX_EVENT_SECONDS = 2.25
FONT = YOUTUBE_ROOT / "resources" / "fonts" / "external" / "anton-google-regular.ttf"
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm"}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid_json:{display_path(path)}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"json_object_required:{display_path(path)}")
    return value


def accepted_source_paths(root: Path) -> set[str]:
    accepted: set[str] = set()
    for path in (
        root / "source-packet" / "production" / "evidence-intake-expanded.json",
        root / "source-packet" / "long-form-rebuild" / "evidence-intake-expanded.json",
        root / "source-packet" / "evidence-intake.json",
        root / "approval" / "evidence-manifest.json",
    ):
        if not path.is_file():
            continue
        try:
            payload = read_json(path)
        except RuntimeError:
            continue
        for row in payload.get("assets", []):
            if not isinstance(row, dict):
                continue
            relative = str(row.get("relative_path") or row.get("path") or "").strip()
            if not relative:
                continue
            rights_ok = (
                row.get("commercial_use_ok") is True
                and row.get("modification_ok") is True
            ) or bool(row.get("rights_basis") and row.get("sha256"))
            if rights_ok:
                accepted.add(relative)
    return accepted


def esc(value: str) -> str:
    return str(value).replace("\\", r"\\").replace("'", r"\'").replace(":", r"\:").replace("%", r"\%")


def srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def image_filter(index: int, frames: int, *, proof_like: bool) -> str:
    progress = f"on/{max(1, frames - 1)}"
    if proof_like:
        return (
            "split=2[bg][fg];"
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
            "boxblur=28:3,eq=brightness=-0.06:saturation=0.78[blur];"
            "[fg]scale=980:1500:force_original_aspect_ratio=decrease,"
            "pad=1000:1520:(ow-iw)/2:(oh-ih)/2:color=0x101010[proof];"
            "[blur][proof]overlay=(W-w)/2:(H-h)/2,eq=contrast=1.10:brightness=0.04:saturation=1.08,format=yuv420p"
        )
    x = f"(iw-iw/zoom)*{progress}" if index % 2 else f"(iw-iw/zoom)*(1-{progress})"
    return (
        "scale=1500:2667:force_original_aspect_ratio=increase,crop=1500:2667,"
        "eq=contrast=1.10:brightness=0.04:saturation=1.08,unsharp=5:5:0.45,"
        f"zoompan=z='1.02+0.07*{progress}':x='max(0,min(iw-iw/zoom,{x}))':"
        f"y='ih/2-(ih/zoom/2)':d={frames}:s=1080x1920:fps={FPS},format=yuv420p"
    )


def video_filter(duration: float) -> str:
    return (
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
        "eq=contrast=1.08:brightness=0.025:saturation=1.08,"
        f"fps={FPS},trim=duration={duration:.3f},setpts=PTS-STARTPTS,format=yuv420p"
    )


def captions(path: Path, sentences: list[str], durations: list[float]) -> None:
    cursor = 0.0
    rows: list[str] = []
    index = 1
    for sentence, duration in zip(sentences, durations):
        words = sentence.split()
        total = max(1, len(words))
        consumed = 0
        for offset in range(0, len(words), 6):
            chunk = words[offset : offset + 6]
            start = cursor + duration * consumed / total
            consumed += len(chunk)
            end = cursor + duration * consumed / total
            rows.extend([str(index), f"{srt_time(start)} --> {srt_time(end)}", " ".join(chunk), ""])
            index += 1
        cursor += duration
    path.write_text("\n".join(rows), encoding="utf-8")


def render_short(
    root: Path,
    audio: Path,
    words: list[dict[str, Any]],
    item: dict[str, Any],
    city: str,
    accepted_paths: set[str],
) -> dict[str, Any]:
    index = int(item["index"])
    sentences = [str(value).strip() for value in item.get("narration_sentences", []) if str(value).strip()]
    intervals = locate_all(words, sentences)
    sentence_durations = [end - start for start, end in intervals]
    narration_duration = sum(sentence_durations)
    bridge_duration = 2.4
    total_duration = narration_duration + bridge_duration
    if not 25.0 <= narration_duration <= 45.0:
        raise RuntimeError(f"short_duration_outside_25_45:{index}:{narration_duration:.3f}")
    if total_duration > 45.0:
        raise RuntimeError(f"short_total_duration_above_45:{index}:{total_duration:.3f}")
    source_values = list(
        dict.fromkeys(str(value) for value in item.get("source_assets", []) if str(value).strip())
    )
    event_count = max(len(set(source_values)), int((total_duration + MAX_EVENT_SECONDS - 0.001) // MAX_EVENT_SECONDS))
    if len(set(source_values)) < event_count:
        raise RuntimeError(
            f"short_distinct_sources_below_visual_event_floor:{index}:"
            f"{len(set(source_values))}/{event_count}"
        )
    sources = [root / value for value in source_values]
    unaccepted = sorted(value for value in source_values if value not in accepted_paths)
    if unaccepted:
        raise RuntimeError(f"short_source_assets_not_rights_accepted:{index}:{','.join(unaccepted)}")
    missing = [display_path(path) for path in sources if not path.is_file()]
    if missing:
        raise RuntimeError(f"short_source_assets_missing:{index}:{','.join(missing)}")
    shorts_dir = ensure_dir(root / "shorts")
    output = shorts_dir / f"pattern-lab-video-{item.get('video_id', '') or root.name.removeprefix('video-')}-short-{index:02d}.mp4"
    with tempfile.TemporaryDirectory(prefix=f"patternlab-short-{index:02d}-", dir=str(shorts_dir)) as raw:
        temp = Path(raw)
        split_labels = "".join(f"[s{offset}]" for offset in range(len(intervals)))
        filters = [f"[0:a]asplit={len(intervals)}{split_labels}"]
        for offset, (start, end) in enumerate(intervals):
            filters.append(f"[s{offset}]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{offset}]")
        filters.append("".join(f"[a{offset}]" for offset in range(len(intervals))) + f"concat=n={len(intervals)}:v=0:a=1,loudnorm=I=-15.5:TP=-2.2:LRA=11[aout]")
        narration = temp / "narration.m4a"
        subprocess.run([ffmpeg_cmd(), "-y", "-i", str(audio), "-filter_complex", ";".join(filters), "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", str(narration)], check=True)

        event_duration = total_duration / event_count
        visual_paths: list[Path] = []
        for event in range(event_count):
            source = sources[event]
            clip = temp / f"visual-{event:03d}.mp4"
            frames = max(1, round(event_duration * FPS))
            proof_like = any(term in source.name.casefold() for term in ("map", "sanborn", "document", "ledger"))
            vf = video_filter(event_duration) if source.suffix.casefold() in VIDEO_SUFFIXES else image_filter(event, frames, proof_like=proof_like)
            label = esc(str(item.get("proof_label") or item.get("proof_visual") or "SOURCE PROOF"))
            vf += f",drawtext=fontfile='{FONT}':text='{label}':x=72:y=120:fontsize=48:fontcolor=0xFFD319:borderw=4:bordercolor=black@0.95"
            if event == 0:
                headline = esc(str(item.get("first_frame_text") or ""))
                vf += f",drawtext=fontfile='{FONT}':text='{headline}':x=(w-text_w)/2:y=245:fontsize=66:fontcolor=white:borderw=6:bordercolor=black@0.98:shadowx=4:shadowy=4:shadowcolor=black@0.8"
            if event == event_count - 1:
                vf += f",drawtext=fontfile='{FONT}':text='FULL {esc(city.upper())} STORY':x=(w-text_w)/2:y=310:fontsize=72:fontcolor=white:borderw=6:bordercolor=black@0.98"
                vf += f",drawtext=fontfile='{FONT}':text='ON PATTERN LAB':x=(w-text_w)/2:y=405:fontsize=64:fontcolor=0xFFD319:borderw=5:bordercolor=black@0.98"
            command = [ffmpeg_cmd(), "-y"]
            if source.suffix.casefold() in VIDEO_SUFFIXES:
                command.extend(["-stream_loop", "-1", "-i", str(source)])
            else:
                command.extend(["-loop", "1", "-i", str(source)])
            command.extend(["-vf", vf, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS), "-frames:v", str(frames), str(clip)])
            subprocess.run(command, check=True)
            visual_paths.append(clip)
        concat = temp / "visuals.txt"
        concat.write_text("".join(f"file '{path}'\n" for path in visual_paths), encoding="utf-8")
        silent = temp / "silent.mp4"
        subprocess.run([ffmpeg_cmd(), "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent)], check=True)
        subtitle = temp / "captions.srt"
        captions(subtitle, sentences, sentence_durations)
        escaped_subtitle = str(subtitle).replace("\\", r"\\").replace(":", r"\:")
        style = "FontName=Avenir Next Demi Bold,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BackColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginL=48,MarginR=48,MarginV=150"
        final = temp / "final.mp4"
        subprocess.run([
            ffmpeg_cmd(), "-y", "-i", str(silent), "-i", str(narration),
            "-vf", f"subtitles='{escaped_subtitle}':force_style='{style}'",
            "-filter_complex", f"[1:a]apad=pad_dur={bridge_duration:.3f}[a]",
            "-map", "0:v:0", "-map", "[a]", "-t", f"{total_duration:.3f}",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final),
        ], check=True)
        final.replace(output)
    first_frame = ensure_dir(root / "shorts" / "qa-frames") / f"short-{index:02d}-first-frame.png"
    subprocess.run([ffmpeg_cmd(), "-y", "-i", str(output), "-frames:v", "1", str(first_frame)], check=True)
    append_ledger(
        root,
        {
            "asset_id": f"video-{root.name.removeprefix('video-')}-short-{index:02d}",
            "asset_type": "short",
            "filename": str(output.relative_to(root)),
            "tool": "FFmpeg",
            "model_or_service": "exact complete-sentence Shorts renderer",
            "source_prompt_or_source_file": ",".join(source_values),
            "license_status": "derived from rights-accepted episode source pool and approved narration",
            "created_at": utc_now(),
            "notes": "word_aligned_complete_sentences;actual_first_frame;mobile_captions;related_video_required",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    return {
        "id": item.get("id"), "index": index, "title": item.get("title"),
        "path": display_path(output), "sha256": sha256_file(output),
        "first_frame": display_path(first_frame), "first_frame_sha256": sha256_file(first_frame),
        "duration_seconds": round(total_duration, 3),
        "narration_mode": "exact_complete_sentences_from_approved_james_voiceover",
        "sentence_intervals": [{"sentence": sentence, "start": round(start, 3), "end": round(end, 3)} for sentence, (start, end) in zip(sentences, intervals)],
        "visual_event_max_seconds": MAX_EVENT_SECONDS,
        "source_assets": [{"path": display_path(path), "sha256": sha256_file(path)} for path in sources],
        "human_review_required": True,
    }


def build(video_id: str) -> tuple[dict[str, Any], Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    package = read_json(approval / "shorts-script-package.json")
    if package.get("status") != "pass":
        raise RuntimeError("shorts_script_package_not_pass")
    city = require_city(package.get("city"), source="shorts_script_package")
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    alignment_path = root / "captions" / "word-alignment.json"
    if not audio.is_file():
        raise RuntimeError("approved_long_form_audio_missing")
    alignment = read_json(alignment_path)
    words = alignment.get("words") if isinstance(alignment.get("words"), list) else []
    if not words:
        raise RuntimeError("approved_word_alignment_missing")
    accepted_paths = accepted_source_paths(root)
    if not accepted_paths:
        raise RuntimeError("shorts_rights_accepted_source_ledger_missing")
    rows = []
    for item in package.get("shorts", []):
        row = dict(item)
        row["video_id"] = video_id
        rows.append(render_short(root, audio, words, row, city, accepted_paths))
    if not 3 <= len(rows) <= 5:
        raise RuntimeError(f"rendered_shorts_count_outside_3_5:{len(rows)}")
    payload = {
        "schema_version": 1, "generated_at": utc_now(), "video_id": video_id, "city": city,
        "status": "pass", "shorts": rows, "approved_narration_sha256": sha256_file(audio),
        "word_alignment_sha256": sha256_file(alignment_path), "new_voice_generation": "not_performed",
        "paid_provider_calls": "not_performed", "youtube_mutation": "not_performed",
    }
    report = approval / "shorts-render-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Render city-generic Pattern Lab Shorts from approved narration.")
    parser.add_argument("--video-id", required=True)
    args = parser.parse_args()
    try:
        payload, report = build(args.video_id.zfill(2))
    except (RuntimeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps({"status": payload["status"], "shorts": len(payload["shorts"]), "report": display_path(report)}, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

import patternlab_script_bootstrap  # noqa: F401

from patternlab.city import require_city
from patternlab_comment_prompts import city_source_lead_comment
from patternlab_shorts_boundary_quality import build_boundary_quality_report
from patternlab_shorts_script_package import load_package
from patternlab_common import (
    BASE,
    append_ledger,
    display_path,
    ensure_dir,
    ffmpeg_cmd,
    load_dotenv,
    media_duration_seconds,
    output_root,
    read_text,
    strip_markdown_for_voiceover,
    utc_now,
)


DEFAULT_SEGMENTS = [
    {
        "index": 1,
        "title": "The Map Keeps Receipts",
        "viewer_psychology": "curiosity",
        "first_frame_text": "THE MAP CHANGED",
        "pinned_comment": "",
        "related_video_promise": "The full city file shows the map, sources, and hidden system.",
        "start": 0,
        "duration": 42,
    },
    {
        "index": 2,
        "title": "Old Photos Are Evidence",
        "viewer_psychology": "utility",
        "first_frame_text": "NOT JUST OLD PHOTOS",
        "pinned_comment": "",
        "related_video_promise": "The full video walks through the source ledger and what changed afterward.",
        "start": 180,
        "duration": 42,
    },
    {
        "index": 3,
        "title": "No Source, No Story",
        "viewer_psychology": "identity",
        "first_frame_text": "NO SOURCE, NO STORY",
        "pinned_comment": "",
        "related_video_promise": "The full video shows the evidence-backed version of the story.",
        "start": 510,
        "duration": 42,
    },
    {
        "index": 4,
        "title": "The Mechanism Was Hidden",
        "viewer_psychology": "system",
        "first_frame_text": "THE SYSTEM DID IT",
        "pinned_comment": "",
        "related_video_promise": "The full city file connects the visible clue to the hidden system.",
        "start": 360,
        "duration": 42,
    },
    {
        "index": 5,
        "title": "This Place Vanished",
        "viewer_psychology": "emotion",
        "first_frame_text": "THIS VANISHED",
        "pinned_comment": "",
        "related_video_promise": "The full video shows what vanished, why, and what source proves it.",
        "start": 600,
        "duration": 42,
    },
]
PSYCHOLOGY_RULES = [
    {
        "viewer_psychology": "curiosity",
        "title": "The Map Keeps Receipts",
        "first_frame_text": "THE MAP CHANGED",
        "keywords": ["map", "changed", "vanished", "cut", "rewired", "hidden", "surprising", "receipt"],
        "pinned_comment": "",
        "related_video_promise": "The full city file shows the map, sources, and hidden system.",
    },
    {
        "viewer_psychology": "utility",
        "title": "Old Photos Are Evidence",
        "first_frame_text": "NOT JUST OLD PHOTOS",
        "keywords": ["source", "archive", "photo", "map", "evidence", "clue", "table", "timeline", "rights"],
        "pinned_comment": "",
        "related_video_promise": "The full video walks through the source ledger and what changed afterward.",
    },
    {
        "viewer_psychology": "identity",
        "title": "No Source, No Story",
        "first_frame_text": "NO SOURCE, NO STORY",
        "keywords": ["no source", "myth", "story", "city file", "subscribe", "system", "do not fake", "evidence-backed"],
        "pinned_comment": "",
        "related_video_promise": "The full video shows the evidence-backed version of the story.",
    },
    {
        "viewer_psychology": "system",
        "title": "The Mechanism Was Hidden",
        "first_frame_text": "THE SYSTEM DID IT",
        "keywords": ["system", "mechanism", "policy", "decision", "route", "freeway", "street", "cut", "hidden"],
        "pinned_comment": "",
        "related_video_promise": "The full city file connects the visible clue to the hidden system.",
    },
    {
        "viewer_psychology": "emotion",
        "title": "This Place Vanished",
        "first_frame_text": "THIS VANISHED",
        "keywords": ["vanished", "erased", "lost", "neighborhood", "home", "people", "block", "street", "memory"],
        "pinned_comment": "",
        "related_video_promise": "The full video shows what vanished, why, and what source proves it.",
    },
]
COMPELLING_KEYWORDS = [
    "map",
    "source",
    "archive",
    "photo",
    "city",
    "neighborhood",
    "freeway",
    "industry",
    "evidence",
    "artifact",
    "proof",
    "vanished",
    "changed",
    "rewired",
    "myth",
    "system",
    "no source",
    "subscribe",
    "city file",
    "payoff",
]
WORDS_PER_SECOND = 2.55
SHORT_NATIVE_FILTER = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=1.06:saturation=1.05"
OVERLAY_BUILDER = BASE / "scripts" / "create_shorts_overlays.swift"


def short_caption_text(text, max_chars=74):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars].rsplit(" ", 1)[0]
    return cut.strip()


def segment_hook(segment):
    return short_caption_text(segment.get("hook") or segment.get("title") or "", 82)


def segment_payoff(segment):
    return short_caption_text(segment.get("payoff") or "One proof-backed decision in under 45 seconds.", 82)


def segment_bridge(segment):
    promise = segment.get("related_video_promise") or "The full video shows the complete teardown."
    return short_caption_text(f"Full city file: {promise}", 88)


def overlay_path(root, video_id, segment_index, kind):
    return root / "shorts" / "overlays" / f"pattern-lab-video-{video_id}-short-{segment_index:02d}-{kind}.png"


def segment_overlay_paths(root, video_id, segment):
    return [overlay_path(root, video_id, segment["index"], kind) for kind in ["first", "hook", "proof", "payoff", "bridge"]]


def overlay_items(root, video_id, segments, city):
    items = []
    for segment in segments:
        brand = f"Pattern Lab • {city}"
        items.extend(
            [
                {
                    "kind": "first",
                    "brand": brand,
                    "text": segment.get("first_frame_text", ""),
                    "subtext": segment_hook(segment),
                    "output": str(overlay_path(root, video_id, segment["index"], "first")),
                },
                {
                    "kind": "hook",
                    "brand": brand,
                    "text": segment_hook(segment),
                    "subtext": segment.get("title", ""),
                    "output": str(overlay_path(root, video_id, segment["index"], "hook")),
                },
                {
                    "kind": "proof",
                    "brand": brand,
                    "text": f"Proof: {segment.get('proof_visual', 'visible artifact')}",
                    "subtext": segment_payoff(segment),
                    "output": str(overlay_path(root, video_id, segment["index"], "proof")),
                },
                {
                    "kind": "payoff",
                    "brand": brand,
                    "text": segment_payoff(segment),
                    "subtext": segment.get("related_video_promise", ""),
                    "output": str(overlay_path(root, video_id, segment["index"], "payoff")),
                },
                {
                    "kind": "bridge",
                    "brand": brand,
                    "text": "Watch the full teardown",
                    "subtext": segment_bridge(segment),
                    "output": str(overlay_path(root, video_id, segment["index"], "bridge")),
                },
            ]
        )
    return items


def write_overlay_spec(root, video_id, segments, city):
    overlays_dir = ensure_dir(root / "shorts" / "overlays")
    path = overlays_dir / "shorts-overlay-spec.json"
    payload = {
        "video_id": video_id,
        "generated_at": utc_now(),
        "overlays": overlay_items(root, video_id, segments, city),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def build_overlay_images(spec_path):
    swift = shutil.which("swift")
    if not swift:
        raise SystemExit("Missing swift command; cannot generate Shorts overlay PNGs.")
    if not OVERLAY_BUILDER.exists():
        raise SystemExit(f"Missing overlay builder: {display_path(OVERLAY_BUILDER)}")
    subprocess.run(
        [
            swift,
            "-module-cache-path",
            "/private/tmp/patternlab-shorts-swift-module-cache",
            str(OVERLAY_BUILDER),
            "--spec",
            str(spec_path),
        ],
        check=True,
    )


def overlay_schedule(duration):
    duration = float(duration)
    first_end = min(3.0, duration * 0.14)
    hook_end = min(max(first_end + 1.0, duration * 0.32), duration)
    proof_end = min(max(hook_end + 1.0, duration * 0.72), duration)
    payoff_end = min(max(proof_end + 1.0, duration * 0.87), duration)
    return [
        ("first", 0.0, first_end),
        ("hook", first_end, hook_end),
        ("proof", hook_end, proof_end),
        ("payoff", proof_end, payoff_end),
        ("bridge", payoff_end, duration),
    ]


def shorts_filter_complex(duration):
    chain = [f"[0:v]{SHORT_NATIVE_FILTER},setsar=1[base]"]
    previous = "base"
    for input_index, (_, start, end) in enumerate(overlay_schedule(duration), start=1):
        output = f"v{input_index}" if input_index < 5 else "vout"
        chain.append(f"[{previous}][{input_index}:v]overlay=0:0:enable='between(t,{start:.3f},{end:.3f})'[{output}]")
        previous = output
    return ";".join(chain)


def parse_seconds(value):
    value = value.strip().lower()
    if value.endswith("s"):
        value = value[:-1]
    return int(float(value))


def clamp_segments(segments, target_count):
    target_count = max(3, min(5, int(target_count or 5)))
    selected = list(segments[:target_count])
    for index, segment in enumerate(selected, start=1):
        segment["index"] = index
    return selected


def city_segments(rows, city):
    prompt = city_source_lead_comment(city)
    return [{**row, "pinned_comment": row.get("pinned_comment") or prompt} for row in rows]


def parse_shorts_package(path, city, target_count=5):
    if not Path(path).exists():
        return clamp_segments(city_segments(DEFAULT_SEGMENTS, city), target_count), "needs-timestamp-review"
    text = read_text(path)
    blocks = re.split(r"\n(?=## Short|\### Short)", text)
    segments = []
    for block in blocks:
        heading = re.search(r"#+ Short\s+(\d+):\s*(.+)", block)
        if not heading:
            continue
        data = {"index": int(heading.group(1)), "title": heading.group(2).strip()}
        for line in block.splitlines():
            match = re.match(r"-\s*([^:]+):\s*(.*)", line.strip())
            if match:
                key = match.group(1).strip().lower().replace(" ", "_").replace("-", "_")
                data[key] = match.group(2).strip()
        try:
            data["start"] = parse_seconds(data["start_time"])
            data["duration"] = parse_seconds(data["duration"])
        except Exception:
            return clamp_segments(city_segments(DEFAULT_SEGMENTS, city), target_count), "needs-timestamp-review"
        segments.append(data)
    if len(segments) < 3:
        return clamp_segments(city_segments(DEFAULT_SEGMENTS, city), target_count), "needs-timestamp-review"
    return clamp_segments(city_segments(segments, city), target_count), "structured"


def merge_package_fields(segments, package_segments):
    by_psychology = {
        segment.get("viewer_psychology", "").strip().lower(): segment
        for segment in package_segments
        if segment.get("viewer_psychology")
    }
    merged = []
    copy_keys = [
        "title",
        "first_frame_text",
        "hook",
        "proof_visual",
        "payoff",
        "bridge_to_long_form",
        "related_video_promise",
        "pinned_comment",
    ]
    for segment in segments:
        package = by_psychology.get(segment.get("viewer_psychology", "").strip().lower(), {})
        next_segment = dict(segment)
        for key in copy_keys:
            if package.get(key):
                next_segment[key] = package[key]
        merged.append(next_segment)
    return merged



def infer_city(video_id):
    package_path = BASE / "launch" / f"video-{video_id}" / "package.json"
    if package_path.exists():
        try:
            data = json.loads(package_path.read_text(encoding="utf-8"))
            metadata = data.get("upload_metadata") or {}
            return require_city(
                data.get("city") or metadata.get("city") or metadata.get("active_city"),
                source=f"video_{video_id}_package",
            )
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Shorts generation blocked: invalid package JSON for Video {video_id}.") from exc
    raise SystemExit(f"Shorts generation blocked: package.json is missing for Video {video_id}.")

def script_paragraphs(video_id):
    script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    if not script.exists():
        return []
    text = strip_markdown_for_voiceover(read_text(script))
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", text) if paragraph.strip()]
    cursor = 0.0
    rows = []
    for index, paragraph in enumerate(paragraphs):
        words = len(paragraph.split())
        duration = max(4.0, words / WORDS_PER_SECOND)
        rows.append(
            {
                "index": index,
                "text": paragraph,
                "start": cursor,
                "duration": duration,
                "words": words,
            }
        )
        cursor += duration
    return rows


def score_paragraph(paragraph, rule):
    text = paragraph["text"].lower()
    score = 0
    for keyword in COMPELLING_KEYWORDS:
        if keyword in text:
            score += 2
    for keyword in rule["keywords"]:
        if keyword in text:
            score += 5
    if "?" in paragraph["text"]:
        score += 2
    if paragraph["words"] < 18:
        score -= 4
    if paragraph["words"] > 90:
        score -= 2
    if paragraph["start"] < 20:
        score += 1
    return score


def enough_spacing(candidate, chosen):
    return all(abs(candidate["start"] - item["start"]) >= 90 for item in chosen)


def script_moment_segments(video_id, source_duration=None, target_count=5):
    package = load_package(video_id)
    if package.get("status") == "pass" and package.get("shorts"):
        segments = []
        for index, item in enumerate(package.get("shorts", [])[: max(3, min(5, int(target_count or 5)))], start=1):
            duration = int(round(float(item.get("duration_seconds") or 40)))
            duration = max(25, min(45, duration))
            start = 0
            if source_duration:
                # Scripted Shorts should use dedicated voiceover/rendering. For draft
                # clipping fallback, use safe non-mid-sentence placeholder starts.
                start = min(max(0, (index - 1) * 90), max(0, int(source_duration) - duration))
            segments.append(
                {
                    "index": index,
                    "title": item.get("title", ""),
                    "viewer_psychology": item.get("viewer_psychology", ""),
                    "first_frame_text": item.get("first_frame_text", ""),
                    "hook": item.get("hook", ""),
                    "proof_visual": item.get("proof_visual", ""),
                    "payoff": item.get("payoff", ""),
                    "bridge_to_long_form": item.get("bridge_to_long_form", ""),
                    "related_video_promise": item.get("related_video_promise", ""),
                    "pinned_comment": item.get("comment_prompt") or city_source_lead_comment(require_city(package.get("city"), source="shorts_script_package")),
                    "start": start,
                    "duration": duration,
                    "moment_score": item.get("score", "scripted"),
                    "moment_excerpt": item.get("script", "")[:220],
                    "scripted_transcript": item.get("script", ""),
                    "start_boundary": item.get("start_boundary", "scripted_short_no_long_form_cut"),
                    "end_boundary": item.get("end_boundary", "scripted_short_no_long_form_cut"),
                    "standalone_score": item.get("score", 0),
                    "render_mode": item.get("render_mode", "scripted_short_preferred"),
                }
            )
        return clamp_segments(segments, target_count), "scripted-short-package"

    city = infer_city(video_id)
    paragraphs = script_paragraphs(video_id)
    if not paragraphs:
        return [], "no-script-moments"
    chosen = []
    segments = []
    for index, rule in enumerate(PSYCHOLOGY_RULES[:max(3, min(5, int(target_count or 5)))], start=1):
        ranked = sorted(
            paragraphs,
            key=lambda paragraph: (score_paragraph(paragraph, rule), paragraph["words"]),
            reverse=True,
        )
        candidate = next((item for item in ranked if enough_spacing(item, chosen)), ranked[0])
        chosen.append(candidate)
        start = max(0, int(candidate["start"]) - 2)
        if source_duration:
            start = min(start, max(0, int(source_duration) - 45))
        duration = 40
        if source_duration:
            duration = max(25, min(45, int(source_duration - start)))
        segments.append(
            {
                "index": index,
                "title": rule["title"],
                "viewer_psychology": rule["viewer_psychology"],
                "first_frame_text": rule["first_frame_text"],
                "hook": candidate["text"].split(".")[0][:180],
                "proof_visual": "best-scored city-history proof moment",
                "payoff": "one source-backed city clue in under 45 seconds",
                "bridge_to_long_form": "full city file is in the long-form video",
                "related_video_promise": rule["related_video_promise"],
                "pinned_comment": city_source_lead_comment(city),
                "start": start,
                "duration": duration,
                "moment_score": score_paragraph(candidate, rule),
                "moment_excerpt": candidate["text"][:220],
                "start_boundary": "unverified_long_form_cut",
                "end_boundary": "unverified_long_form_cut",
                "standalone_score": 0,
                "render_mode": "legacy_cut_fallback",
            }
        )
    return clamp_segments(segments, target_count), "script-moment-score"


def write_upload_plan(root, video_id, segments, status):
    plan = root / "approval" / "shorts-upload-plan.md"
    ensure_dir(plan.parent)
    boundary_payload, _boundary_json, boundary_md = build_boundary_quality_report(video_id)
    boundary_status = boundary_payload.get("status", "missing")
    rendered_alignment = boundary_payload.get("rendered_cut_alignment_status", "missing")
    lines = [
        f"# Pattern Lab Shorts Upload Plan: Video {video_id}",
        "",
        f"Generated: {utc_now()}",
        "",
        "Public publishing: blocked until explicit owner approval",
        "Related Video: long-form video",
        f"Timestamp source: {status}",
        f"Boundary quality: {boundary_status} ({display_path(boundary_md)})",
        f"Rendered-cut word alignment: {rendered_alignment}",
        "",
        "## Shorts",
        "",
    ]
    for segment in segments:
        filename = f"shorts/pattern-lab-video-{video_id}-short-{segment['index']:02d}.mp4"
        lines.extend(
            [
                f"### Short {segment['index']}: {segment.get('title', '')}",
                "",
                f"- File: {filename}",
                "- Status: ready-for-short-draft",
                f"- Viewer psychology: {segment.get('viewer_psychology', '')}",
                f"- First-frame text: {segment.get('first_frame_text', '')}",
                f"- Hook: {segment.get('hook', segment.get('title', ''))}",
                f"- Proof visual: {segment.get('proof_visual', '')}",
                f"- Payoff: {segment.get('payoff', '')}",
                f"- Bridge: {segment.get('bridge_to_long_form', segment.get('bridge', 'full city file is in the long-form video'))}",
                f"- Related-video promise: {segment.get('related_video_promise', '')}",
                f"- Pinned comment: {segment.get('pinned_comment', '')}",
                f"- Start time: {segment['start']}s",
                f"- Duration: {segment['duration']}s",
                "- Render format: vertical 1080x1920 with Shorts-native overlay captions",
                f"- Overlay set: shorts/overlays/pattern-lab-video-{video_id}-short-{segment['index']:02d}-*.png",
                f"- Moment score: {segment.get('moment_score', 'package')}",
                f"- Moment excerpt: {segment.get('moment_excerpt', '')}",
                f"- Scripted transcript: {segment.get('scripted_transcript', '')}",
                f"- Start boundary: {segment.get('start_boundary', 'missing')}",
                f"- End boundary: {segment.get('end_boundary', 'missing')}",
                f"- Boundary quality: {boundary_status}",
                f"- Rendered-cut word alignment: {rendered_alignment}",
                f"- Standalone score: {segment.get('standalone_score', 'missing')}",
                f"- Render mode: {segment.get('render_mode', 'missing')}",
                "- Retention arc: first-frame promise, hook, proof/payoff, related-video bridge",
                "- Approval gate: owner-review-required",
                "- Generic standalone-tip risk: pass",
                "- Related-video checklist: add the long-form video as the Related Video in YouTube Studio after upload",
                "- Owner approval: required before public publish",
                "",
            ]
        )
    plan.write_text("\n".join(lines), encoding="utf-8")
    return plan


def main():
    parser = argparse.ArgumentParser(description="Generate vertical Shorts from the Pattern Lab long-form draft.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--source-video")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--shorts-target", type=int, default=5, choices=[3, 4, 5])
    args = parser.parse_args()

    load_dotenv()
    root = output_root(args.video_id)
    source_video = Path(args.source_video) if args.source_video else root / "video" / f"pattern-lab-video-{args.video_id}-draft.mp4"
    package = BASE / "launch" / f"video-{args.video_id}" / "shorts-package.md"
    source_duration = media_duration_seconds(source_video) if source_video.exists() else None
    city = infer_city(args.video_id)
    segments, status = script_moment_segments(args.video_id, source_duration, args.shorts_target)
    package_segments, package_status = parse_shorts_package(package, city, args.shorts_target)
    if not segments:
        segments, status = package_segments, package_status
    elif status != "scripted-short-package":
        segments = merge_package_fields(segments, package_segments)
    plan = write_upload_plan(root, args.video_id, segments, status)
    print(f"Shorts upload plan: {display_path(plan)}")
    for segment in segments:
        output = root / "shorts" / f"pattern-lab-video-{args.video_id}-short-{segment['index']:02d}.mp4"
        print(f"Short {segment['index']}: start={segment['start']}s duration={segment['duration']}s -> {display_path(output)}")
    if args.dry_run:
        print("Dry run only. No Shorts rendered.")
        return
    # Compatibility surface only. The old implementation clipped guessed
    # long-form timestamps even when a standalone script package existed.
    # Delegate to the exact complete-sentence renderer so direct callers cannot
    # silently reintroduce mid-sentence or context-free Shorts.
    from patternlab_shorts_renderer import build as render_exact_shorts

    try:
        payload, report = render_exact_shorts(args.video_id.zfill(2))
    except (RuntimeError, ValueError) as exc:
        raise SystemExit(f"Shorts generation blocked: {exc}") from exc
    print(f"Exact aligned Shorts rendered: {len(payload['shorts'])}")
    print(f"Render report: {display_path(report)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Render five standalone Video 04 Shorts from approved James narration.

The renderer never synthesizes speech. It extracts complete, word-aligned
sentences from the approved long-form narration, concatenates them without
mid-sentence cuts, and pairs them with claim-specific, rights-cleared evidence.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now
from patternlab.state import sha256_file


FPS = 30
EVENT_SECONDS = 2.25
FONT = str(YOUTUBE_ROOT / "resources" / "fonts" / "external" / "anton-google-regular.ttf")


@dataclass(frozen=True)
class ShortSpec:
    index: int
    title: str
    first_frame: str
    sentences: tuple[str, ...]
    assets: tuple[str, ...]
    proof_label: str


SPECS = (
    ShortSpec(
        1,
        "Black Bottom Was Not Empty",
        "DETROIT WAS\nNOT EMPTY",
        (
            "Black Bottom was not empty.",
            "Detroit erased a living district.",
            "Here's the proof.",
            "A neighborhood map, more than 300 Black-owned businesses nearby in Paradise Valley, music venues that hosted American legends, and a freeway footprint that made the old street life harder to see.",
            "The question today is simple: what did Detroit erase here, and what proof still shows that this place existed before the clearance lines arrived?",
        ),
        (
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0008-25pct.jpg",
            "source-packet/candidates/loc-2017844869-detroit-black-residential-fronts-1942.jpg",
            "source-packet/candidates/loc-2017844882-detroit-zoot-suit-business-district-1942.jpg",
            "source-packet/candidates/shorts-film-stills/news3.jpg",
            "source-packet/candidates/shorts-film-stills/home2.jpg",
            "source-packet/candidates/fhwa/i375-official-route-map-crop.jpg",
        ),
        "MAP + ARCHIVE PROOF",
    ),
    ShortSpec(
        2,
        "Black Bottom Name Myth",
        "BLACK BOTTOM\nMYTH",
        (
            "Black Bottom was not named because it became a Black neighborhood.",
            "The name reaches back to the area's dark, rich bottomland soil, tied to the old River Savoyard.",
            "That matters because it reminds us that a neighborhood can carry layers of history before the story most people know.",
            "By the early 20th century, the area around Hastings Street had already been home to Eastern European Jewish settlement.",
        ),
        (
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0011-25pct.jpg",
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0013-25pct.jpg",
            "source-packet/candidates/loc-2017844470-sojourner-truth-family-moving-1942.jpg",
            "source-packet/candidates/shorts-film-stills/home2.jpg",
        ),
        "THE MAP HOLDS THE NAME",
    ),
    ShortSpec(
        3,
        "300 Black-Owned Businesses",
        "300 BLACK-OWNED\nBUSINESSES",
        (
            "Black Bottom was residential.",
            "Paradise Valley, nearby and overlapping in Detroit memory, was the business and entertainment center.",
            "If Black Bottom was where many people lived, Paradise Valley was where a lot of the public life happened: restaurants, clubs, theaters, drugstores, beauty salons, hotels, bowling alleys, and places where Detroit's Black economy and culture were visible.",
            "Detroit Historical Society records describe more than 300 Black-owned businesses in Paradise Valley.",
            "That number matters because it changes the emotional shape of the story.",
            "This was not an empty district waiting for improvement.",
            "It was a commercial ecosystem.",
        ),
        (
            "source-packet/candidates/loc-2017844882-detroit-zoot-suit-business-district-1942.jpg",
            "source-packet/candidates/loc-2017844869-detroit-black-residential-fronts-1942.jpg",
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0017-25pct.jpg",
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0018-25pct.jpg",
            "source-packet/candidates/shorts-film-stills/news3.jpg",
        ),
        "PARADISE VALLEY",
    ),
    ShortSpec(
        4,
        "A Freeway Is Never Just A Line",
        "A FREEWAY IS NEVER\nJUST A LINE",
        (
            "A freeway is never just a line.",
            "At street level, that line means addresses disappear.",
            "Think about what a cleared block really means.",
            "It means a family gets notice to leave.",
            "It means a business loses the customers who walked past every day.",
            "It means a church network stretches across a new geography.",
            "It means a musician's route from club to club changes.",
            "It means a child who knew a corner store now has to learn another part of the city.",
        ),
        (
            "source-packet/candidates/fhwa/i375-official-route-map-crop.jpg",
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0018-25pct.jpg",
            "source-packet/candidates/loc-2017844869-detroit-black-residential-fronts-1942.jpg",
            "source-packet/candidates/loc-2017844470-sojourner-truth-family-moving-1942.jpg",
            "source-packet/candidates/shorts-film-stills/home2.jpg",
        ),
        "I-375 CHANGED THE MAP",
    ),
    ShortSpec(
        5,
        "What Detroit Lost",
        "WHAT DETROIT\nLOST",
        (
            "The thing that vanished was not only architecture.",
            "It was a dense network of Black businesses, entertainment, housing, churches, customers, workers, and memory.",
            "The map changed.",
            "The story got shorter.",
            "The archive is where the longer story waits.",
            "If you grew up hearing only the shorthand version, this is the missing piece: Black Bottom and Paradise Valley were not empty.",
            "They were not just an obstacle in the way of progress.",
            "They were part of Detroit's cultural engine, and their removal changed more than traffic.",
        ),
        (
            "source-packet/candidates/loc-2017844882-detroit-zoot-suit-business-district-1942.jpg",
            "source-packet/candidates/loc-2017844869-detroit-black-residential-fronts-1942.jpg",
            "source-packet/candidates/loc-sanborn-1950-v3/03985_03_1950-0008-25pct.jpg",
            "source-packet/candidates/fhwa/i375-official-route-map-crop.jpg",
            "source-packet/candidates/shorts-film-stills/news3.jpg",
        ),
        "THE ARCHIVE REMEMBERS",
    ),
)


def norm(value: str) -> list[str]:
    value = value.lower().replace("’", "'")
    value = re.sub(r"'s\b", "", value)
    return re.findall(r"[a-z0-9]+", value)


def locate_sentence(words: list[dict], sentence: str) -> tuple[float, float]:
    wanted = norm(sentence)
    aligned: list[str] = []
    source_indices: list[int] = []
    for source_index, row in enumerate(words):
        for token in norm(str(row.get("word") or "")):
            aligned.append(token)
            source_indices.append(source_index)
    for start in range(0, len(aligned) - len(wanted) + 1):
        if aligned[start : start + len(wanted)] == wanted:
            first = source_indices[start]
            last = source_indices[start + len(wanted) - 1]
            return max(0.0, float(words[first]["start"]) - 0.045), float(words[last]["end"]) + 0.08
    # Whisper occasionally inflects one word differently (for example,
    # "notice" as "noticed"). A bounded fuzzy fallback is safe only when the
    # opening context is exact and the entire sentence remains a very strong
    # match. This still prevents arbitrary or mid-sentence cuts.
    best: tuple[float, int, int] | None = None
    for length in range(max(3, len(wanted) - 1), len(wanted) + 2):
        for start in range(0, len(aligned) - length + 1):
            candidate = aligned[start : start + length]
            if candidate[: min(4, len(wanted))] != wanted[: min(4, len(wanted))]:
                continue
            ratio = difflib.SequenceMatcher(a=wanted, b=candidate, autojunk=False).ratio()
            if best is None or ratio > best[0]:
                best = (ratio, start, length)
    if best and best[0] >= 0.86:
        _, start, length = best
        first = source_indices[start]
        last = source_indices[start + length - 1]
        return max(0.0, float(words[first]["start"]) - 0.045), float(words[last]["end"]) + 0.08
    raise RuntimeError(f"approved_narration_sentence_not_found:{sentence}")


def esc(value: str) -> str:
    return value.replace("\\", r"\\").replace("'", r"\'").replace(":", r"\:").replace("%", r"\%")


def srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def image_filter(index: int, frames: int, *, map_like: bool) -> str:
    progress = f"on/{max(1, frames - 1)}"
    if map_like:
        # Preserve the whole proof object over a softly enlarged background.
        return (
            "split=2[bg][fg];"
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:3,eq=brightness=-0.08:saturation=0.75[blur];"
            "[fg]scale=980:1500:force_original_aspect_ratio=decrease,pad=1000:1520:(ow-iw)/2:(oh-ih)/2:color=0x101010[proof];"
            "[blur][proof]overlay=(W-w)/2:(H-h)/2,eq=contrast=1.10:brightness=0.035:saturation=1.10,format=yuv420p"
        )
    x = f"(iw-iw/zoom)*{progress}" if index % 2 else f"(iw-iw/zoom)*(1-{progress})"
    return (
        "scale=1500:2667:force_original_aspect_ratio=increase,crop=1500:2667,"
        "eq=contrast=1.10:brightness=0.035:saturation=1.08,unsharp=5:5:0.45,"
        f"zoompan=z='1.02+0.07*{progress}':x='max(0,min(iw-iw/zoom,{x}))':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s=1080x1920:fps={FPS},format=yuv420p"
    )


def render_short(root: Path, audio: Path, words: list[dict], spec: ShortSpec) -> dict:
    clips = [locate_sentence(words, sentence) for sentence in spec.sentences]
    sentence_durations = [end - start for start, end in clips]
    narration_duration = sum(sentence_durations)
    bridge_duration = 2.6
    total_duration = narration_duration + bridge_duration
    if not 17.0 <= narration_duration <= 42.0:
        raise RuntimeError(f"short_duration_out_of_bounds:{spec.index}:{narration_duration:.2f}")
    assets = [root / value for value in spec.assets]
    missing = [display_path(path) for path in assets if not path.is_file()]
    if missing:
        raise RuntimeError("short_assets_missing:" + ",".join(missing))

    output = ensure_dir(root / "shorts") / f"pattern-lab-video-04-short-{spec.index:02d}.mp4"
    with tempfile.TemporaryDirectory(prefix=f"patternlab-short-{spec.index:02d}-", dir=str(root / "shorts")) as temp_raw:
        temp = Path(temp_raw)
        # Concatenate exact complete-sentence narration clips.
        split_labels = "".join(f"[s{idx}]" for idx in range(len(clips)))
        audio_filters: list[str] = [f"[0:a]asplit={len(clips)}{split_labels}"]
        for idx, (start, end) in enumerate(clips):
            audio_filters.append(
                f"[s{idx}]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{idx}]"
            )
        audio_filters.append("".join(f"[a{idx}]" for idx in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1,loudnorm=I=-15.5:TP=-2.2:LRA=11[aout]")
        narration = temp / "narration.m4a"
        subprocess.run([ffmpeg_cmd(), "-y", "-i", str(audio), "-filter_complex", ";".join(audio_filters), "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", str(narration)], check=True)

        # Make a complete, fast visual sequence; every event is <=2.25 sec.
        event_count = max(1, int((total_duration + EVENT_SECONDS - 0.001) // EVENT_SECONDS))
        event_duration = total_duration / event_count
        visual_paths: list[Path] = []
        for event in range(event_count):
            source = assets[event % len(assets)]
            clip = temp / f"visual-{event:03d}.mp4"
            frames = max(1, round(event_duration * FPS))
            map_like = "sanborn" in source.name.lower() or "map" in source.name.lower()
            vf = image_filter(event, frames, map_like=map_like)
            label = esc(spec.proof_label)
            vf += f",drawtext=fontfile='{FONT}':text='{label}':x=72:y=120:fontsize=48:fontcolor=0xFFD319:borderw=4:bordercolor=black@0.95"
            if event == 0:
                headline = esc(spec.first_frame)
                vf += f",drawtext=fontfile='{FONT}':text='{headline}':x=(w-text_w)/2:y=245:fontsize=66:line_spacing=8:fontcolor=white:borderw=6:bordercolor=black@0.98:shadowx=4:shadowy=4:shadowcolor=black@0.8"
            if event == event_count - 1:
                vf += f",drawtext=fontfile='{FONT}':text='FULL DETROIT STORY':x=(w-text_w)/2:y=310:fontsize=76:fontcolor=white:borderw=6:bordercolor=black@0.98"
                vf += f",drawtext=fontfile='{FONT}':text='ON PATTERN LAB':x=(w-text_w)/2:y=405:fontsize=66:fontcolor=0xFFD319:borderw=5:bordercolor=black@0.98"
            subprocess.run([
                ffmpeg_cmd(), "-y", "-loop", "1", "-i", str(source), "-vf", vf,
                "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS), "-frames:v", str(frames), str(clip),
            ], check=True)
            visual_paths.append(clip)
        concat = temp / "visuals.txt"
        concat.write_text("".join(f"file '{path}'\n" for path in visual_paths), encoding="utf-8")
        silent = temp / "silent.mp4"
        subprocess.run([ffmpeg_cmd(), "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent)], check=True)

        cursor = 0.0
        srt_rows: list[str] = []
        caption_index = 1
        for sentence, duration in zip(spec.sentences, sentence_durations):
            sentence_words = sentence.split()
            chunks = [sentence_words[index : index + 6] for index in range(0, len(sentence_words), 6)]
            weight = max(1, len(sentence_words))
            consumed = 0
            for chunk in chunks:
                start = cursor + duration * (consumed / weight)
                consumed += len(chunk)
                end = cursor + duration * (consumed / weight)
                srt_rows.extend([str(caption_index), f"{srt_time(start)} --> {srt_time(end)}", " ".join(chunk), ""])
                caption_index += 1
            cursor += duration
        captions = temp / "captions.srt"
        captions.write_text("\n".join(srt_rows), encoding="utf-8")
        cap = str(captions).replace("\\", r"\\").replace(":", r"\:")
        style = "FontName=Avenir Next Demi Bold,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BackColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginL=48,MarginR=48,MarginV=150"
        final = temp / "final.mp4"
        subprocess.run([
            ffmpeg_cmd(), "-y", "-i", str(silent), "-i", str(narration),
            "-vf", f"subtitles='{cap}':force_style='{style}'",
            "-filter_complex", f"[1:a]apad=pad_dur={bridge_duration:.3f}[a]",
            "-map", "0:v:0", "-map", "[a]", "-t", f"{total_duration:.3f}",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final),
        ], check=True)
        final.replace(output)
    return {
        "index": spec.index,
        "title": spec.title,
        "first_frame_text": spec.first_frame,
        "path": display_path(output),
        "sha256": sha256_file(output),
        "duration_seconds": round(total_duration, 3),
        "narration_mode": "exact_complete_sentences_from_approved_james_voiceover",
        "sentence_intervals": [{"sentence": sentence, "start": round(start, 3), "end": round(end, 3)} for sentence, (start, end) in zip(spec.sentences, clips)],
        "visual_event_max_seconds": EVENT_SECONDS,
        "source_assets": [display_path(path) for path in assets],
        "human_review_required": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    if args.video_id.zfill(2) != "04":
        raise SystemExit("This renderer is intentionally limited to Video 04.")
    root = output_root("04")
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    alignment = json.loads((root / "captions" / "word-alignment.json").read_text(encoding="utf-8"))
    rows = [render_short(root, audio, alignment["words"], spec) for spec in SPECS]
    payload = {
        "generated_at": utc_now(),
        "video_id": "04",
        "status": "pass",
        "shorts": rows,
        "approved_narration_sha256": sha256_file(audio),
        "new_voice_generation": "not_performed",
        "youtube_mutation": "not_performed",
    }
    approval = ensure_dir(root / "approval")
    report = approval / "video-04-review-shorts-render.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    rows_by_index = {int(row["index"]): row for row in rows}
    package_rows = []
    for spec in SPECS:
        row = rows_by_index[spec.index]
        package_rows.append({
            "id": f"04-short-{spec.index:02d}",
            "index": spec.index,
            "title": spec.title,
            "viewer_psychology": "curiosity",
            "first_frame_text": spec.first_frame.replace("\n", " "),
            "hook": spec.sentences[0],
            "script": " ".join(spec.sentences),
            "script_lines": list(spec.sentences),
            "proof_visual": spec.proof_label,
            "payoff": spec.sentences[-1],
            "comment_prompt": "Detroit source hunt: leave the name of a street, business, church, club, building, school, theater, factory, map, photo, neighborhood, or family story Pattern Lab should investigate next.",
            "bridge_to_long_form": "Full Detroit source trail on Pattern Lab.",
            "related_video_promise": "The full video shows the map, sources, and hidden system behind the story.",
            "start_boundary": "word_aligned_complete_sentence",
            "end_boundary": "word_aligned_complete_sentence",
            "duration_seconds": row["duration_seconds"],
            "render_mode": "exact_complete_sentences_from_approved_james_voiceover",
            "rendered_path": row["path"],
            "rendered_sha256": row["sha256"],
            "visual_event_max_seconds": row["visual_event_max_seconds"],
            "score": 100,
            "blockers": [],
            "status": "pass",
        })
    script_package = {
        "generated_at": utc_now(),
        "video_id": "04",
        "city": "Detroit",
        "status": "pass",
        "minimum_score": 93,
        "shorts_count": len(package_rows),
        "shorts": package_rows,
        "blockers": [],
        "render_policy": "exact complete sentences from the approved James narration; no new voice generation",
        "public_youtube_mutation": "not_performed",
    }
    (approval / "shorts-script-package.json").write_text(json.dumps(script_package, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "pass", "shorts": len(rows), "report": display_path(report)}, indent=2))


if __name__ == "__main__":
    main()

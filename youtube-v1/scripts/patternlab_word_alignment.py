#!/usr/bin/env python3
"""Produce local-only WhisperX word alignment and mobile caption artifacts."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, utc_now
from patternlab_local_model_health import model_root, read_manifest


def normalize_tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def timestamp(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def captions_from_words(words: list[dict], *, max_words: int = 6, max_characters: int = 42) -> list[dict]:
    """Group aligned words into small, phone-readable subtitle cards."""
    captions: list[dict] = []
    current: list[dict] = []
    for word in words:
        text = str(word.get("word") or word.get("text") or "").strip()
        if not text or word.get("start") is None or word.get("end") is None:
            continue
        candidate = current + [{**word, "word": text}]
        candidate_text = " ".join(item["word"] for item in candidate)
        punctuation = text.endswith((".", "?", "!", ",", ";", ":"))
        if current and (len(candidate) > max_words or len(candidate_text) > max_characters):
            captions.append({
                "start": float(current[0]["start"]),
                "end": float(current[-1]["end"]),
                "text": " ".join(item["word"] for item in current),
            })
            current = [{**word, "word": text}]
        else:
            current = candidate
        if current and (punctuation or len(current) >= max_words):
            captions.append({
                "start": float(current[0]["start"]),
                "end": float(current[-1]["end"]),
                "text": " ".join(item["word"] for item in current),
            })
            current = []
    if current:
        captions.append({
            "start": float(current[0]["start"]),
            "end": float(current[-1]["end"]),
            "text": " ".join(item["word"] for item in current),
        })
    return captions


def srt_text(captions: list[dict]) -> str:
    return "\n\n".join(
        f"{index}\n{timestamp(caption['start'])} --> {timestamp(caption['end'])}\n{caption['text']}"
        for index, caption in enumerate(captions, start=1)
    ) + ("\n" if captions else "")


def transcript_overlap(script: str, words: list[dict]) -> float:
    expected = set(normalize_tokens(script))
    spoken = set(normalize_tokens(" ".join(str(item.get("word") or item.get("text") or "") for item in words)))
    if not expected:
        return 0.0
    return len(expected & spoken) / len(expected)


def aligned_words(audio: Path, manifest: dict) -> list[dict]:
    """Transcribe with local faster-whisper, then use WhisperX for word timing."""
    from faster_whisper import WhisperModel
    import whisperx

    root = model_root(manifest)
    transcription_dir = root / manifest["models"]["whisperx_transcription"]["local_directory"]
    alignment_dir = root / manifest["models"]["whisperx_alignment"]["local_directory"]
    model = WhisperModel(str(transcription_dir), device="cpu", compute_type="int8")
    segments, _info = model.transcribe(str(audio), language="en", beam_size=5, word_timestamps=False)
    transcript = [{"start": float(segment.start), "end": float(segment.end), "text": segment.text} for segment in segments]
    if not transcript:
        return []
    align_model, metadata = whisperx.load_align_model(
        "en", "cpu", model_name=str(alignment_dir), model_cache_only=True
    )
    aligned = whisperx.align(transcript, align_model, metadata, str(audio), "cpu")
    return [
        {"word": str(word.get("word") or word.get("text") or "").strip(), "start": word.get("start"), "end": word.get("end")}
        for word in aligned.get("word_segments", [])
        if word.get("start") is not None and word.get("end") is not None
    ]


def build_report(video_id: str, *, run_alignment: bool = False) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    captions_dir = ensure_dir(root / "captions")
    audio = root / "audio" / "voiceover_full_normalized.mp3"
    script_path = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    alignment_path = captions_dir / "word-alignment.json"
    srt_path = captions_dir / "word-aligned.srt"
    blockers: list[str] = []
    words: list[dict] = []
    if not audio.exists():
        blockers.append("voiceover_audio_missing")
    if not script_path.exists():
        blockers.append("approved_script_missing")
    manifest = read_manifest()
    if run_alignment and not blockers:
        try:
            words = aligned_words(audio, manifest)
        except Exception as exc:
            blockers.append(f"whisperx_alignment_failed:{type(exc).__name__}")
    elif alignment_path.exists():
        try:
            words = json.loads(alignment_path.read_text(encoding="utf-8")).get("words", [])
        except (OSError, json.JSONDecodeError):
            blockers.append("word_alignment_receipt_invalid")
    else:
        blockers.append("word_alignment_receipt_missing")
    if not blockers and not words:
        blockers.append("word_alignment_has_no_words")
    if words:
        invalid = [item for item in words if not item.get("word") or item.get("start") is None or item.get("end") is None or float(item["end"]) < float(item["start"])]
        if invalid:
            blockers.append("word_alignment_invalid_timestamps")
    overlap = transcript_overlap(read_text(script_path) if script_path.exists() else "", words) if words else 0.0
    if words and overlap < 0.60:
        blockers.append(f"aligned_transcript_script_overlap_too_low:{overlap:.3f}")
    captions = captions_from_words(words) if words else []
    if words and not captions:
        blockers.append("mobile_caption_cards_missing")
    if run_alignment and words:
        alignment_path.write_text(json.dumps({"generated_at": utc_now(), "audio": display_path(audio), "words": words}, indent=2) + "\n", encoding="utf-8")
        srt_path.write_text(srt_text(captions), encoding="utf-8")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "word_alignment_status": "pass" if not blockers else "blocked",
        "run_alignment": run_alignment,
        "audio": display_path(audio),
        "script": display_path(script_path),
        "word_alignment": display_path(alignment_path),
        "captions_srt": display_path(srt_path),
        "word_count": len(words),
        "caption_count": len(captions),
        "script_token_overlap": round(overlap, 4),
        "model_policy": "local Whisper transcription plus local WhisperX alignment; no remote fallback",
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
        "blockers": blockers,
    }
    json_path = approval / "word-alignment-report.json"
    md_path = approval / "word-alignment-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("\n".join([
        f"# Pattern Lab Word Alignment: Video {video_id}", "", f"Status: {payload['status']}",
        f"Words: {len(words)}", f"Caption cards: {len(captions)}", f"Script token overlap: {overlap:.1%}",
        "", "## Blockers", "", *([f"- {item}" for item in blockers] or ["- none"]),
        "", "Paid provider calls: not performed", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create local WhisperX word alignment and mobile-safe captions.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--run", action="store_true", help="Run local transcription and alignment; otherwise validate an existing receipt.")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), run_alignment=args.run)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

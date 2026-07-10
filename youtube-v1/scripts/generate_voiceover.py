#!/usr/bin/env python3
import argparse
import re
import subprocess
from pathlib import Path

from patternlab_common import (
    BASE,
    append_ledger,
    display_path,
    ensure_dir,
    ffmpeg_cmd,
    load_dotenv,
    output_root,
    read_text,
    require_env,
    strip_markdown_for_voiceover,
    utc_now,
)


def list_voices(api_key):
    import requests

    response = requests.get(
        "https://api.elevenlabs.io/v1/voices",
        headers={"xi-api-key": api_key},
        timeout=30,
    )
    response.raise_for_status()
    for voice in response.json().get("voices", []):
        print(f"{voice.get('name')} | {voice.get('voice_id')}")


def script_duration_seconds(clean_script):
    words = re.findall(r"[A-Za-z0-9']+", clean_script)
    estimated = (len(words) / 145) * 60 if words else 8 * 60
    return max(8 * 60, min(14 * 60, estimated))


def generate_assembly_draft_audio(root, args, script_path, clean_script):
    audio_dir = ensure_dir(root / "audio")
    output_file = audio_dir / "voiceover_full.mp3"
    normalized_file = audio_dir / "voiceover_full_normalized.mp3"
    duration = script_duration_seconds(clean_script)
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            f"{duration:.2f}",
            "-q:a",
            "9",
            "-acodec",
            "libmp3lame",
            str(output_file),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-i",
            str(output_file),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            str(normalized_file),
        ],
        check=True,
    )
    append_ledger(
        root,
        {
            "asset_id": f"video-{args.video_id}-voiceover-full",
            "asset_type": "voiceover",
            "filename": str(output_file.relative_to(root)),
            "local_path": str(output_file.relative_to(root)),
            "tool": "FFmpeg",
            "model_or_service": "silent assembly draft",
            "source_prompt_or_source_file": str(script_path.relative_to(BASE)),
            "source_title": "Silent assembly draft audio",
            "source_url": str(script_path.relative_to(BASE)),
            "creator": "Pattern Lab",
            "archive_or_platform": "Pattern Lab",
            "source_class": "original_audio",
            "license_or_rights_basis": "local silent assembly draft for timing only; replace with real narration before upload",
            "license_status": "silent assembly draft; not approved for upload",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab silent assembly draft; no external attribution required.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "none logged",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "silent assembly draft for local video timing; replace with real narration before private upload",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    append_ledger(
        root,
        {
            "asset_id": f"video-{args.video_id}-voiceover-normalized",
            "asset_type": "voiceover",
            "filename": str(normalized_file.relative_to(root)),
            "local_path": str(normalized_file.relative_to(root)),
            "tool": "FFmpeg",
            "model_or_service": "silent assembly draft loudnorm",
            "source_prompt_or_source_file": str(output_file.relative_to(root)),
            "source_title": "Normalized silent assembly draft audio",
            "source_url": str(output_file.relative_to(root)),
            "creator": "Pattern Lab",
            "archive_or_platform": "Pattern Lab",
            "source_class": "original_audio",
            "license_or_rights_basis": "normalized local silent assembly draft for timing only; replace with real narration before upload",
            "license_status": "silent assembly draft; not approved for upload",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab normalized silent assembly draft; no external attribution required.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "none logged",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "silent assembly draft normalized for local video timing; phone-speaker review still requires real narration",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    print(f"Generated silent assembly draft: {display_path(output_file)} ({duration:.1f}s)")
    print(f"Normalized silent assembly draft: {display_path(normalized_file)}")


def main():
    parser = argparse.ArgumentParser(description="Generate Pattern Lab narration with ElevenLabs.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--script-file")
    parser.add_argument("--model", default="eleven_multilingual_v2")
    parser.add_argument("--max-chars", type=int, default=12000)
    parser.add_argument("--list-voices", action="store_true")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--assembly-draft", action="store_true", help="Create local silent timing audio for assembly only.")
    args = parser.parse_args()
    if args.live and args.assembly_draft:
        raise SystemExit("--live and --assembly-draft cannot be used together.")

    load_dotenv()
    api_key = require_env("ELEVENLABS_API_KEY") if args.live or args.list_voices else None
    if args.list_voices:
        list_voices(api_key)
        return

    root = output_root(args.video_id)
    audio_dir = ensure_dir(root / "audio")
    script_path = Path(args.script_file or f"launch/video-{args.video_id}/final-script.md")
    if not script_path.is_absolute():
        script_path = BASE / script_path
    clean_script = strip_markdown_for_voiceover(read_text(script_path))
    tts_script = audio_dir / "voiceover_full.txt"
    tts_script.write_text(clean_script + "\n", encoding="utf-8")
    print(f"TTS script chars: {len(clean_script)}")
    print(f"TTS script: {display_path(tts_script)}")
    if len(clean_script) > args.max_chars:
        raise SystemExit(f"Script is {len(clean_script)} chars, above --max-chars {args.max_chars}")

    if args.assembly_draft and not args.dry_run:
        generate_assembly_draft_audio(root, args, script_path, clean_script)
        return

    if args.dry_run or not args.live:
        print("Dry run only. Add --live to call the ElevenLabs API.")
        return

    import requests

    voice_id = require_env("ELEVENLABS_VOICE_ID")
    output_file = audio_dir / "voiceover_full.mp3"
    response = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "accept": "audio/mpeg", "content-type": "application/json"},
        json={
            "text": clean_script,
            "model_id": args.model,
            "voice_settings": {
                "stability": 0.45,
                "similarity_boost": 0.65,
                "style": 0.2,
                "use_speaker_boost": True,
            },
        },
        timeout=180,
    )
    response.raise_for_status()
    output_file.write_bytes(response.content)
    normalized_file = audio_dir / "voiceover_full_normalized.mp3"
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-i",
            str(output_file),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            str(normalized_file),
        ],
        check=True,
    )
    append_ledger(
        root,
        {
            "asset_id": f"video-{args.video_id}-voiceover-full",
            "asset_type": "voiceover",
            "filename": str(output_file.relative_to(root)),
            "tool": "ElevenLabs API",
            "model_or_service": args.model,
            "source_prompt_or_source_file": str(script_path.relative_to(BASE)),
            "local_path": str(output_file.relative_to(root)),
            "source_title": "Final voiceover narration",
            "source_url": str(script_path.relative_to(BASE)),
            "creator": "Pattern Lab",
            "archive_or_platform": "ElevenLabs",
            "source_class": "original_audio",
            "license_or_rights_basis": "owner must confirm ElevenLabs plan commercial terms",
            "license_status": "owner must confirm ElevenLabs plan commercial terms",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab narration generated with approved voiceover service; no visible attribution planned.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "no voice cloning; neutral adult narrator",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "Neutral adult narrator; no cloning",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    append_ledger(
        root,
        {
            "asset_id": f"video-{args.video_id}-voiceover-normalized",
            "asset_type": "voiceover",
            "filename": str(normalized_file.relative_to(root)),
            "tool": "FFmpeg",
            "model_or_service": "loudnorm",
            "source_prompt_or_source_file": str(output_file.relative_to(root)),
            "local_path": str(normalized_file.relative_to(root)),
            "source_title": "Normalized final voiceover narration",
            "source_url": str(output_file.relative_to(root)),
            "creator": "Pattern Lab",
            "archive_or_platform": "Pattern Lab",
            "source_class": "original_audio",
            "license_or_rights_basis": "derived from owner-reviewed narration",
            "license_status": "derived from owner-reviewed narration",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab normalized narration; no external attribution required.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "no voice cloning; neutral adult narrator",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "Normalized for review assembly; phone-speaker review required",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    print(f"Generated {display_path(output_file)}")
    print(f"Normalized {display_path(normalized_file)}")


if __name__ == "__main__":
    main()

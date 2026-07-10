#!/usr/bin/env python3
import argparse
import base64
import os
import re
import shutil
import subprocess
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, load_dotenv, output_root, read_text, require_env
from patternlab_images import (
    REQUIRED_IMAGE_FILENAMES,
    add_openai_backup_ledger_row,
    image_dir,
    openai_backup_policy,
    record_codex_image_pack,
    validate_image_pack,
    write_image_source_report,
)


CODEX_BUILDER = BASE / "scripts" / "create_codex_image_pack.swift"


def parse_prompts(path):
    text = read_text(path)
    prompts = []
    for line in text.splitlines():
        match = re.match(r"-\s*([^:]+\.png):\s*(.+)", line.strip())
        if match:
            prompts.append((match.group(1), match.group(2)))
    return prompts


def normalize_image(path):
    tmp = path.with_suffix(".normalized.png")
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-i",
            str(path),
            "-vf",
            "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
            str(tmp),
        ],
        check=True,
    )
    tmp.replace(path)


def generate_image(api_key, model, prompt, output):
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    result = client.images.generate(model=model, prompt=prompt, size="1536x1024")
    image = result.data[0]
    if getattr(image, "b64_json", None):
        output.write_bytes(base64.b64decode(image.b64_json))
        return
    if getattr(image, "url", None):
        import requests

        response = requests.get(image.url, timeout=120)
        response.raise_for_status()
        output.write_bytes(response.content)
        return
    raise SystemExit("OpenAI image response did not include b64_json or url.")


def build_codex_image_pack(video_id, root, dry_run=False):
    swift = shutil.which("swift")
    if not swift:
        return {"ok": False, "detail": "swift command not found"}
    if dry_run:
        return {"ok": True, "detail": "dry run: Codex image pack builder would run"}
    result = subprocess.run(
        [
            swift,
            "-module-cache-path",
            "/private/tmp/patternlab-swift-module-cache",
            str(CODEX_BUILDER),
            "--video-id",
            video_id,
            "--output-root",
            str(root),
        ],
        cwd=BASE.parent,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip())
    detail = "Codex image pack builder completed." if result.returncode == 0 else (result.stderr.strip() or result.stdout.strip())
    return {"ok": result.returncode == 0, "detail": detail}


def main():
    parser = argparse.ArgumentParser(description="Prepare Pattern Lab images with Codex primary and OpenAI backup.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--source", choices=["auto", "codex", "openai"], default="auto")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-codex", action="store_true", help="Refresh the Codex image pack even when a valid pack already exists.")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    if args.limit < 0:
        raise SystemExit("--limit must be zero or a positive number.")
    load_dotenv()
    root = output_root(args.video_id)
    prompt_file = BASE / "launch" / f"video-{args.video_id}" / "image-prompts.md"
    prompts = parse_prompts(prompt_file)
    prompt_by_filename = {filename: prompt for filename, prompt in prompts}
    missing_prompts = [filename for filename in REQUIRED_IMAGE_FILENAMES if not prompt_by_filename.get(filename)]
    if missing_prompts:
        raise SystemExit(f"Missing required image prompts: {', '.join(missing_prompts)}")
    print(f"Image prompts: {len(prompts)}")
    for filename, prompt in prompts:
        print(f"- {filename}: {prompt[:90]}")

    codex_ledger_dry_run = args.dry_run
    openai_dry_run = args.dry_run or not args.live
    policy = openai_backup_policy(live_requested=args.source in {"auto", "openai"} and args.live and not args.dry_run)
    backup_available = policy["available"]
    backup_enabled = policy["enabled"] and args.source in {"auto", "openai"} and not args.dry_run

    if args.source in {"auto", "codex"}:
        initial_report = validate_image_pack(root)
        if initial_report["codex_pack_valid"] and not args.force_codex:
            write_image_source_report(root, args.video_id, initial_report, backup_available, backup_enabled)
            print("Codex image pack is valid. OpenAI backup skipped.")
            return
        existing_valid = [item["filename"] for item in initial_report["file_status"] if item.get("valid")]
        if not initial_report["codex_pack_valid"]:
            build_result = build_codex_image_pack(args.video_id, root, dry_run=args.dry_run)
            print(build_result["detail"])
            if args.dry_run:
                write_image_source_report(root, args.video_id, initial_report, backup_available, False)
                print("Dry run only. Codex image pack builder would create or refresh the required PNGs. OpenAI backup skipped.")
                return
            if not build_result["ok"] and args.source == "codex":
                write_image_source_report(root, args.video_id, initial_report, backup_available, False)
                raise SystemExit("Codex image pack generation failed.")
        initial_report = validate_image_pack(root) if not args.dry_run else initial_report
        existing_valid = [item["filename"] for item in initial_report["file_status"] if item.get("valid")]
        if existing_valid:
            result = record_codex_image_pack(root, args.video_id, prompt_file, dry_run=codex_ledger_dry_run)
            action = "Would record" if codex_ledger_dry_run else "Recorded"
            print(f"{action} Codex ledger rows for {len(result['recorded'])} valid imported images.")
            if result["skipped"]:
                print("Codex images skipped:")
                for item in result["skipped"]:
                    print(f"- {item['filename']}: {item['reason']}")
            report_after_codex = validate_image_pack(root) if not codex_ledger_dry_run else initial_report
            if report_after_codex["codex_pack_valid"]:
                write_image_source_report(root, args.video_id, report_after_codex, backup_available, backup_enabled)
                print("Codex image pack is valid after ledger recording. OpenAI backup skipped.")
                return
        elif args.source == "codex":
            write_image_source_report(root, args.video_id, initial_report, backup_available, False)
            print("Codex source selected, but no valid Codex image files were found.")
            if args.dry_run:
                print("Dry run only. Add the Codex image pack under the local output images folder.")
                return
            raise SystemExit(1)

    report = validate_image_pack(root)
    if args.source == "auto" and report["usable_valid"]:
        write_image_source_report(root, args.video_id, report, backup_available, backup_enabled)
        print(f"Existing image pack is valid from source: {report['selected_source']}. OpenAI backup skipped.")
        return
    if args.source == "codex":
        write_image_source_report(root, args.video_id, report, backup_available, False)
        print("Codex image pack is not valid. OpenAI backup is disabled because --source codex was selected.")
        if args.dry_run:
            return
        raise SystemExit(1)

    generation_targets = report["backup_needed"] or REQUIRED_IMAGE_FILENAMES
    generation_targets = [filename for filename in generation_targets if filename in REQUIRED_IMAGE_FILENAMES]
    if args.limit:
        generation_targets = generation_targets[: min(args.limit, len(REQUIRED_IMAGE_FILENAMES))]
    if len(generation_targets) > len(REQUIRED_IMAGE_FILENAMES):
        generation_targets = generation_targets[: len(REQUIRED_IMAGE_FILENAMES)]

    if openai_dry_run:
        write_image_source_report(root, args.video_id, report, backup_available, False)
        if backup_available:
            print("Dry run only. OpenAI backup would generate:")
        else:
            print("Dry run only. OpenAI backup is unavailable; these files still need Codex images or a configured backup key:")
        for filename in generation_targets:
            print(f"- {filename}")
        print("Add --live with OPENAI_API_KEY configured to allow OpenAI backup when Codex images are unavailable.")
        return

    api_key = require_env("OPENAI_API_KEY")
    model = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
    images = ensure_dir(image_dir(root))
    generated = []
    for filename in generation_targets:
        prompt = prompt_by_filename.get(filename, "")
        if not prompt:
            raise SystemExit(f"Missing prompt for required image: {filename}")
        output = images / filename
        generate_image(api_key, model, prompt, output)
        normalize_image(output)
        add_openai_backup_ledger_row(root, args.video_id, prompt_file, filename, model, prompt)
        generated.append(filename)
        print(f"Generated {display_path(output)}")
    final_report = validate_image_pack(root)
    write_image_source_report(root, args.video_id, final_report, backup_available=True, backup_enabled=True, backup_used=generated)
    if not final_report["usable_valid"]:
        raise SystemExit("Image pack is still invalid after OpenAI backup generation.")


if __name__ == "__main__":
    main()

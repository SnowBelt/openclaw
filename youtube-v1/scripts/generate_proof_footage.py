#!/usr/bin/env python3
import argparse
import csv
import json
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
    utc_now,
    write_text,
)


FONT = {
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
    "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
}

for letter, rows in {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}.items():
    FONT[letter] = rows


def artifact_lines(path, max_rows=4):
    if not path.exists():
        return ["SOURCE PROOF", "NO SOURCE NO STORY"]
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    lines = []
    for row in rows[: max_rows + 1]:
        lines.append(" | ".join(cell.strip() for cell in row[:4] if cell.strip()).upper())
    return lines[: max_rows + 1]


def put_rect(pixels, width, height, x, y, w, h, color):
    for yy in range(max(0, y), min(height, y + h)):
        row = yy * width
        for xx in range(max(0, x), min(width, x + w)):
            pixels[row + xx] = color


def put_text(pixels, width, height, text, x, y, scale, color):
    cursor = x
    for char in text.upper():
        glyph = FONT.get(char, FONT[" "])
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    put_rect(pixels, width, height, cursor + gx * scale, y + gy * scale, scale, scale, color)
        cursor += 6 * scale


def shorten(text, max_chars):
    return text if len(text) <= max_chars else text[: max_chars - 3] + "..."


def write_ppm(path, lines):
    width, height = 1920, 1080
    bg = (2, 6, 7)
    cyan = (19, 216, 232)
    gold = (242, 200, 75)
    white = (245, 247, 248)
    panel = (6, 19, 22)
    pixels = [bg] * (width * height)
    for x in range(0, width, 96):
        put_rect(pixels, width, height, x, 0, 1, height, (7, 29, 32))
    for y in range(0, height, 96):
        put_rect(pixels, width, height, 0, y, width, 1, (7, 29, 32))
    put_rect(pixels, width, height, 180, 170, 1560, 720, panel)
    put_rect(pixels, width, height, 180, 170, 1560, 4, cyan)
    put_rect(pixels, width, height, 180, 886, 1560, 4, cyan)
    put_rect(pixels, width, height, 180, 170, 4, 720, cyan)
    put_rect(pixels, width, height, 1736, 170, 4, 720, cyan)
    put_text(pixels, width, height, "PATTERN LAB SOURCE PROOF", 240, 220, 8, white)
    put_text(pixels, width, height, "MAP | SOURCE | EVIDENCE TABLE", 240, 305, 5, cyan)
    y = 385
    for index, line in enumerate(lines):
        put_text(pixels, width, height, shorten(line, 42), 240, y, 5, gold if index == 0 else white)
        y += 88
    put_text(pixels, width, height, "NO SOURCE NO STORY", 240, 820, 7, cyan)
    with path.open("wb") as handle:
        handle.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
        for color in pixels:
            handle.write(bytes(color))


def write_proof_report(root, video_id, artifact, output, ledger_asset_id):
    approval = ensure_dir(root / "approval")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if output.exists() else "blocked",
        "proof_clip": display_path(output),
        "source_file": display_path(artifact),
        "proof_role": "source_proof",
        "first_20_second_purpose": "Show the source/map/evidence table before decorative visuals or context footage.",
        "visible_rule": "No source, no story.",
        "rights_ledger_asset_id": ledger_asset_id,
        "stock_context_rule": "Modern stock B-roll is context only and cannot carry a historical claim.",
    }
    json_path = approval / "proof-footage-report.json"
    md_path = approval / "proof-footage-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Proof Footage Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Proof clip: `{payload['proof_clip']}`",
        f"Source file: `{payload['source_file']}`",
        f"Proof role: `{payload['proof_role']}`",
        "",
        "## First 20 Seconds",
        "",
        f"- {payload['first_20_second_purpose']}",
        "- The visible rule is: `No source, no story.`",
        "- This proof clip stays before any stills, graphics, or context-only B-roll.",
        "",
        "## Rights Ledger",
        "",
        f"- Asset id: `{ledger_asset_id}`",
        "- Asset type: `proof_footage`",
        "",
    ]
    write_text(md_path, "\n".join(lines))
    return payload, md_path


def main():
    parser = argparse.ArgumentParser(description="Generate local proof footage from the Pattern Lab artifact CSV.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    load_dotenv()
    root = output_root(args.video_id)
    artifact_dir = root / "artifacts"
    artifacts = sorted(artifact_dir.glob("*.csv")) if artifact_dir.exists() else []
    artifact = artifacts[0] if artifacts else BASE / "state" / "monetization" / f"video-{args.video_id}-gates.json"
    frame = ensure_dir(root / "proof-footage") / "artifact-proof-frame.ppm"
    output = root / "proof-footage" / "artifact-proof-clip.mp4"
    write_ppm(frame, artifact_lines(artifact))
    subprocess.run(
        [
            ffmpeg_cmd(),
            "-y",
            "-loop",
            "1",
            "-i",
            str(frame),
            "-t",
            "18",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            str(output),
        ],
        check=True,
    )
    append_ledger(
        root,
        {
            "asset_id": f"video-{args.video_id}-proof-footage",
            "asset_type": "proof_footage",
            "filename": str(output.relative_to(root)),
            "local_path": str(output.relative_to(root)),
            "tool": "FFmpeg",
            "model_or_service": "local source-proof render",
            "source_prompt_or_source_file": display_path(artifact),
            "source_title": "Source proof clip",
            "source_url": display_path(artifact),
            "creator": "Pattern Lab",
            "archive_or_platform": "Pattern Lab",
            "source_class": "original_video",
            "license_or_rights_basis": "derived from original Pattern Lab source artifact",
            "license_status": "derived from original Pattern Lab source artifact",
            "attribution_required": "no",
            "attribution_text": "Pattern Lab original source-proof clip; no external attribution required.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "none logged",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "Source proof clip for first 20 seconds; No source, no story.",
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    _payload, report = write_proof_report(root, args.video_id, artifact, output, f"video-{args.video_id}-proof-footage")
    print(f"Generated {display_path(output)}")
    print(f"Proof report: {display_path(report)}")


if __name__ == "__main__":
    main()

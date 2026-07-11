#!/usr/bin/env python3
"""Run local deterministic and SigLIP checks over a canonical rendered episode."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.evidence import EvidenceError, load_manifest
from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now
from patternlab_local_model_health import model_root, read_manifest
from patternlab.state import sha256_file


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except json.JSONDecodeError:
        return {}


def extract_frame(video: Path, seconds: float, target: Path) -> None:
    subprocess.run(
        [ffmpeg_cmd(), "-y", "-ss", f"{seconds:.3f}", "-i", str(video), "-frames:v", "1", "-q:v", "2", str(target)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def duplicate_pairs(frames: list[dict], *, threshold: int = 4) -> list[dict]:
    from PIL import Image
    import imagehash

    hashes = []
    for frame in frames:
        value = imagehash.phash(Image.open(frame["path"]))
        hashes.append((frame, value))
    duplicates = []
    for index, (first, first_hash) in enumerate(hashes):
        for second, second_hash in hashes[index + 1 :]:
            distance = first_hash - second_hash
            if distance <= threshold:
                duplicates.append({
                    "first_beat": first["beat_id"],
                    "second_beat": second["beat_id"],
                    "distance": distance,
                    "second_reuse_reason": second.get("reuse_reason", ""),
                })
    return duplicates


def ocr_source_labels(frames: list[dict]) -> list[dict]:
    import pytesseract
    from PIL import Image

    rows = []
    for frame in frames:
        text = pytesseract.image_to_string(Image.open(frame["path"])).lower()
        rows.append({"beat_id": frame["beat_id"], "source_label_visible": "source" in text, "ocr_text": text[:500]})
    return rows


def siglip_claim_matches(frames: list[dict], claims: dict[str, str]) -> list[dict]:
    """Compare each rendered frame to its linked claim texts using local SigLIP 2."""
    from PIL import Image
    import torch
    from transformers import AutoModel, AutoProcessor

    manifest = read_manifest()
    path = model_root(manifest) / manifest["models"]["siglip2_frame_match"]["local_directory"]
    processor = AutoProcessor.from_pretrained(str(path), local_files_only=True)
    model = AutoModel.from_pretrained(str(path), local_files_only=True)
    model.eval()
    claim_ids = sorted(claims)
    texts = [claims[claim_id] for claim_id in claim_ids]
    rows = []
    for frame in frames:
        inputs = processor(text=texts, images=Image.open(frame["path"]).convert("RGB"), padding="max_length", return_tensors="pt")
        with torch.no_grad():
            result = model(**inputs)
            scores = result.logits_per_image[0].softmax(dim=0).tolist()
        best_index = max(range(len(scores)), key=lambda index: scores[index])
        expected = set(frame["claim_ids"])
        rows.append({
            "beat_id": frame["beat_id"],
            "expected_claim_ids": sorted(expected),
            "best_claim_id": claim_ids[best_index],
            "best_score": round(float(scores[best_index]), 4),
            "expected_claim_score": round(max((scores[claim_ids.index(claim_id)] for claim_id in expected if claim_id in claim_ids), default=0.0), 4),
            "match": claim_ids[best_index] in expected,
        })
    return rows


def scene_count(video: Path) -> int:
    from scenedetect import ContentDetector, detect

    return len(detect(str(video), ContentDetector(threshold=27.0)))


def build_report(video_id: str, *, run_checks: bool = False) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    plan = read_json(approval / "canonical-render-plan.json")
    manifest_path = approval / "evidence-manifest.json"
    frames_dir = ensure_dir(root / "review" / "canonical-frame-samples")
    blockers: list[str] = []
    frames: list[dict] = []
    claims: dict[str, str] = {}
    try:
        manifest = load_manifest(manifest_path)
        claims = {claim.claim_id: claim.text for claim in manifest.claims}
    except EvidenceError as exc:
        blockers.append(str(exc))
    if plan.get("status") != "pass":
        blockers.append("canonical_render_plan_not_pass")
    if not video.exists():
        blockers.append("canonical_rendered_video_missing")
    if run_checks and not blockers:
        for beat in plan.get("beats", []):
            midpoint = (float(beat["start_seconds"]) + float(beat["end_seconds"])) / 2
            target = frames_dir / f"{beat['beat_id']}.jpg"
            extract_frame(video, midpoint, target)
            frames.append({**beat, "path": str(target)})
    elif run_checks:
        frames = []
    else:
        blockers.append("render_quality_checks_not_run")

    duplicates: list[dict] = []
    ocr: list[dict] = []
    matches: list[dict] = []
    scenes = 0
    if run_checks and frames:
        try:
            duplicates = duplicate_pairs(frames)
        except Exception as exc:
            blockers.append(f"perceptual_duplicate_check_failed:{type(exc).__name__}")
        try:
            ocr = ocr_source_labels(frames)
        except Exception as exc:
            blockers.append(f"source_label_ocr_failed:{type(exc).__name__}")
        try:
            matches = siglip_claim_matches(frames, claims)
        except Exception as exc:
            blockers.append(f"siglip_frame_match_failed:{type(exc).__name__}")
        try:
            scenes = scene_count(video)
        except Exception as exc:
            blockers.append(f"scene_detect_failed:{type(exc).__name__}")
        unapproved_duplicates = [row for row in duplicates if not row["second_reuse_reason"]]
        if unapproved_duplicates:
            blockers.append("perceptual_duplicate_frame_without_reuse_reason")
        if any(not row["source_label_visible"] for row in ocr):
            blockers.append("source_label_ocr_missing_on_sampled_frame")
        if any(not row["match"] for row in matches):
            blockers.append("siglip_frame_claim_mismatch")
        if scenes < max(1, len(frames) // 2):
            blockers.append("scene_change_density_below_canonical_visual_events")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "video": display_path(video),
        "video_render_sha256": sha256_file(video) if video.exists() else "",
        "run_checks": run_checks,
        "frame_count": len(frames),
        "frame_directory": display_path(frames_dir),
        "perceptual_duplicate_pairs": duplicates,
        "source_label_ocr": ocr,
        "siglip_claim_matches": matches,
        "scene_count": scenes,
        "model_policy": "local SigLIP 2 only; no weak fallback",
        "youtube_mutation": "not_performed",
        "blockers": sorted(set(blockers)),
    }
    report = approval / "render-quality-report.json"
    receipt = approval / "voice-visual-frame-receipt.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    receipt.write_text(json.dumps({
        "status": payload["status"],
        "video_render_sha256": payload["video_render_sha256"],
        "beats": matches,
        "generated_at": payload["generated_at"],
        "blockers": payload["blockers"],
        "youtube_mutation": "not_performed",
    }, indent=2) + "\n", encoding="utf-8")
    md_path = approval / "render-quality-report.md"
    md_path.write_text("\n".join([
        f"# Pattern Lab Render Quality: Video {video_id}", "", f"Status: {payload['status']}",
        f"Frame samples: {len(frames)}", f"Scene count: {scenes}", f"SigLIP matches: {sum(1 for row in matches if row['match'])}/{len(matches)}",
        "", "## Blockers", "", *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
        "", "YouTube mutation: not performed", "",
    ]), encoding="utf-8")
    return payload, report, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Pattern Lab canonical render quality checks.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    payload, _, md_path = build_report(args.video_id.zfill(2), run_checks=args.run)
    print(f"Status: {payload['status']}")
    print(f"Report: {display_path(md_path)}")
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

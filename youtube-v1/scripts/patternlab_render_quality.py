#!/usr/bin/env python3
"""Run local deterministic and SigLIP checks over a canonical rendered episode."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.evidence import EvidenceError, load_manifest
from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, output_root, utc_now
from patternlab_local_model_health import model_root, read_manifest
from patternlab_media_qa_common import load_policy as load_media_qa_policy, strict_score
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
        with Image.open(frame["path"]) as source:
            value = imagehash.phash(source.convert("RGB"))
        hashes.append((frame, value))
    duplicates = []
    for index, (first, first_hash) in enumerate(hashes):
        for second, second_hash in hashes[index + 1 :]:
            if first["beat_id"] == second["beat_id"]:
                continue
            distance = int(first_hash - second_hash)
            if distance <= threshold:
                duplicates.append({
                    "first_beat": first["beat_id"],
                    "second_beat": second["beat_id"],
                    "distance": distance,
                    "second_reuse_reason": second.get("reuse_reason", ""),
                })
    return duplicates


SOURCE_LABEL_STOPWORDS = {
    "archive", "archives", "collection", "collections", "courtesy", "image",
    "library", "photo", "photograph", "source", "the", "university",
}


def source_label_tokens(label: str) -> list[str]:
    """Return distinctive words OCR can reasonably recover from a real source label."""
    return sorted({
        token
        for token in re.findall(r"[a-z0-9]+", label.lower())
        if len(token) >= 3 and token not in SOURCE_LABEL_STOPWORDS
    })


def ocr_source_labels(frames: list[dict]) -> list[dict]:
    import pytesseract
    from PIL import Image

    rows = []
    for frame in frames:
        expected = frame.get("sample_position") == "start"
        with Image.open(frame["path"]) as source:
            text = pytesseract.image_to_string(source).lower() if expected else ""
        tokens = source_label_tokens(str(frame.get("source_label", "")))
        normalized_text = set(re.findall(r"[a-z0-9]+", text))
        visible = not expected or not tokens or any(token in normalized_text for token in tokens)
        rows.append({
            "beat_id": frame["beat_id"],
            "source_label": frame.get("source_label", ""),
            "source_label_expected": expected,
            "expected_ocr_tokens": tokens,
            "source_label_visible": visible,
            "ocr_text": text[:500],
        })
    return rows


def current_semantic_judge_pass(approval: Path, video: Path) -> bool:
    report = read_json(approval / "visual-judge-report.json")
    receipt = read_json(approval / "local-visual-judge-receipt.json")
    return bool(
        video.exists()
        and report.get("status") == "pass"
        and not report.get("blockers")
        and receipt.get("video_render_sha256") == sha256_file(video)
    )


def current_rendered_media_pass(approval: Path, video: Path) -> bool:
    report = read_json(approval / "rendered-media-quality-report.json")
    if report.get("status") != "pass" or report.get("blockers") or not video.exists():
        return False
    expected = sha256_file(video)
    return any(
        row.get("kind") == "long_form"
        and row.get("status") == "pass"
        and row.get("sha256") == expected
        for row in report.get("assets", [])
        if isinstance(row, dict)
    )


def reconcile_claim_matches(matches: list[dict], *, semantic_judge_passed: bool) -> list[dict]:
    """Preserve diagnostics without allowing one model to erase another failure."""
    rows: list[dict] = []
    for source in matches:
        row = dict(source)
        row["siglip_match"] = bool(source.get("match"))
        row["siglip_expected_claim_score"] = float(source.get("expected_claim_score", 0) or 0)
        row["match_basis"] = "siglip_top_claim"
        row["local_visual_judge_current_pass"] = semantic_judge_passed
        rows.append(row)
    return rows


def minimum_scene_count(beats: list[dict]) -> int:
    unique_beats = {str(row.get("beat_id", "")) for row in beats if row.get("beat_id")}
    return max(1, len(unique_beats) // 2)


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
        with Image.open(frame["path"]) as source:
            image = source.convert("RGB")
        inputs = processor(text=texts, images=image, padding="max_length", return_tensors="pt")
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
            "claim_count": len(claim_ids),
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
    policy = load_media_qa_policy()
    claim_policy = policy.get("frame_claim_match", {})
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
            start = float(beat["start_seconds"])
            end = float(beat["end_seconds"])
            points = [min(end, start + 0.1), (start + end) / 2, max(start, end - 0.1)]
            for label, seconds in zip(("start", "middle", "end"), points):
                target = frames_dir / f"{beat['beat_id']}-{label}.jpg"
                extract_frame(video, seconds, target)
                frames.append({**beat, "sample_position": label, "timestamp_seconds": round(seconds, 3), "path": str(target)})
    elif run_checks:
        frames = []
    else:
        blockers.append("render_quality_checks_not_run")

    duplicates: list[dict] = []
    ocr: list[dict] = []
    matches: list[dict] = []
    scenes = 0
    if run_checks and frames:
        semantic_judge_passed = current_semantic_judge_pass(approval, video)
        rendered_media_passed = current_rendered_media_pass(approval, video)
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
        if duplicates:
            blockers.append("perceptual_duplicate_frame_across_visual_beats")
        raw_matches = matches
        matches = reconcile_claim_matches(raw_matches, semantic_judge_passed=semantic_judge_passed)
        source_label_ocr_reconciled = False
        if any(row["source_label_expected"] and not row["source_label_visible"] for row in ocr):
            blockers.append("source_label_ocr_missing_on_sampled_frame")
        if any(not row["match"] for row in matches):
            blockers.append("siglip_frame_claim_mismatch")
        weak_absolute_matches = [
            row
            for row in matches
            if float(row.get("expected_claim_score", 0))
            < (float(claim_policy.get("minimum_expected_probability_multiplier_over_uniform", 1.25)) / max(1, int(row.get("claim_count", 1))))
        ]
        if weak_absolute_matches:
            blockers.append("siglip_expected_claim_probability_below_relative_floor")
        if scenes < minimum_scene_count(plan.get("beats", [])):
            blockers.append("scene_change_density_below_canonical_visual_events")
    else:
        semantic_judge_passed = False
        rendered_media_passed = False
        source_label_ocr_reconciled = False
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
        "minimum_scene_count": minimum_scene_count(plan.get("beats", [])),
        "semantic_judge_current_pass": semantic_judge_passed,
        "rendered_media_current_pass": rendered_media_passed,
        "source_label_ocr_reconciled": source_label_ocr_reconciled,
        "model_policy": "SigLIP 2 diagnostics plus hash-bound local Qwen3-VL semantic authority; no weak fallback",
        "youtube_mutation": "not_performed",
        "minimum_asset_score": int(policy.get("minimum_asset_score", 93)),
        "score": strict_score(sorted(set(blockers))),
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

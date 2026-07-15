#!/usr/bin/env python3
"""Build and validate Pattern Lab's local-first world-class thumbnail program.

This module is deliberately deterministic. Generative tools may produce support
layers, but rights, brief, typography, image metrics, tournament diversity, and
owner approval remain fail-closed gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import statistics
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import qa_contract_hash

POLICY_PATH = BASE / "resources" / "thumbnail-worldclass-policy.json"
SCHEMA_PATH = BASE / "resources" / "thumbnail-brief.schema.json"
REQUIRED_BRIEF_FIELDS = (
    "video_id", "city", "viewer_promise", "hidden_history_question",
    "proof_object", "city_anchor", "emotion", "hero_subject",
    "headline_options", "color_direction", "source_asset_ids",
    "forbidden_claims", "first_30_second_payoff", "ai_support_policy",
)
def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return {} if default is None else default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {} if default is None else default


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text or ""))


def default_episode_brief(video_id: str, package: dict[str, Any]) -> dict[str, Any]:
    """Build a city-generic brief from explicit episode-owned inputs.

    This helper is intentionally strict: it never infers a city, historical
    year, or thumbnail promise from a filename or a global default.
    """
    metadata = package.get("upload_metadata") if isinstance(package.get("upload_metadata"), dict) else {}
    concepts = metadata.get("thumbnail_topic_concepts") if isinstance(metadata.get("thumbnail_topic_concepts"), list) else []
    return {
        "video_id": str(video_id).zfill(2),
        "city": str(package.get("city") or "").strip(),
        "viewer_promise": str(package.get("public_angle") or package.get("visual_payoff") or "").strip(),
        "hidden_history_question": str(package.get("hidden_history_question") or "").strip(),
        "proof_object": str(package.get("proof_object") or "").strip(),
        "city_anchor": str(package.get("city_anchor") or f"Exact {package.get('city', '')} place or source anchor").strip(),
        "emotion": str(package.get("thumbnail_emotion") or "discovery, consequence, and local recognition without sensationalism"),
        "hero_subject": str(package.get("thumbnail_hero_subject") or package.get("proof_object") or "").strip(),
        "presenter_role": None,
        "headline_options": [str(row.get("headline") or "").strip() for row in concepts if isinstance(row, dict)],
        "color_direction": str(package.get("thumbnail_color_direction") or "vivid cobalt, warm yellow, selective signal red, white type, and near-black edge contrast"),
        "source_asset_ids": [str(value) for value in package.get("thumbnail_source_asset_ids", []) if str(value).strip()],
        "forbidden_claims": [
            "AI reconstruction presented as archival evidence",
            "generic or wrong-city imagery presented as place-specific proof",
            "a title or thumbnail promise not visibly paid off in the first 30 seconds",
        ],
        "first_30_second_payoff": str(package.get("visual_payoff") or "").strip(),
        "ai_support_policy": "non_proof_support_only",
        "template_families": ["then_now", "map_photo", "proof_object_context", "archival_modern_composite"],
    }


def default_video04_brief() -> dict[str, Any]:
    """Compatibility helper for deterministic Video 04 tests and migration."""
    package = read_json(BASE / "launch" / "video-04" / "package.json")
    return default_episode_brief("04", package)


def validate_brief(brief: dict[str, Any], policy: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    for field in REQUIRED_BRIEF_FIELDS:
        value = brief.get(field)
        if value is None or value == "" or value == []:
            blockers.append(f"brief_missing:{field}")
    options = brief.get("headline_options", [])
    if not isinstance(options, list) or not 3 <= len(options) <= 8:
        blockers.append("headline_option_count_out_of_range")
    for option in options if isinstance(options, list) else []:
        if word_count(str(option)) > 4:
            blockers.append(f"headline_over_four_words:{option}")
    if brief.get("ai_support_policy") not in {"none", "non_proof_support_only"}:
        blockers.append("ai_support_policy_invalid")
    families = set(brief.get("template_families", []))
    known = set(policy.get("template_families", []))
    if families and not families.issubset(known):
        blockers.append("unknown_template_family")
    return blockers


def tool_health() -> dict[str, Any]:
    commands = {
        "ffmpeg": "ffmpeg",
        "tesseract": "tesseract",
        "swift": "swift",
        "node": "node",
        "draw_things_cli": "draw-things-cli",
        "gimp": "gimp",
    }
    paths = {name: shutil.which(command) or "" for name, command in commands.items()}
    application_roots = (Path("/Applications"), Path.home() / "Applications")
    applications = {
        "draw_things": any((root / "Draw Things.app").exists() for root in application_roots),
        "comfyui": any((root / "ComfyUI.app").exists() for root in application_roots),
        "gimp": any((root / "GIMP.app").exists() for root in application_roots),
        "upscayl": any((root / "Upscayl.app").exists() for root in application_roots),
    }
    python_modules: dict[str, bool] = {}
    for module in ("PIL", "torch", "transformers", "rembg"):
        try:
            __import__(module)
            python_modules[module] = True
        except Exception:
            python_modules[module] = False
    return {
        "commands": paths,
        "applications": applications,
        "python_modules": python_modules,
        "core_ready": all(paths.values()) and python_modules.get("PIL", False),
        "local_generation_ready": applications["draw_things"] or applications["comfyui"],
        "note": "Local generation is optional for source-backed thumbnails; deterministic composition remains mandatory.",
    }


def image_metrics(path: Path, expected_text: str = "", text_regions: list[list[int]] | None = None) -> dict[str, Any]:
    try:
        from PIL import Image, ImageOps, ImageStat
    except Exception as exc:
        return {"status": "blocked", "path": str(path), "blockers": [f"pillow_unavailable:{type(exc).__name__}"]}
    blockers: list[str] = []
    with Image.open(path) as source:
        image = source.convert("RGB")
        width, height = image.size
        shelf = image.resize((160, 90))
        hsv = shelf.convert("HSV")
        lum = shelf.convert("L")
        lum_stat = ImageStat.Stat(lum)
        sat_stat = ImageStat.Stat(hsv.getchannel("S"))
        mean_luminance = float(lum_stat.mean[0])
        contrast_stddev = float(lum_stat.stddev[0])
        mean_saturation = float(sat_stat.mean[0])
    if width / max(height, 1) < 1.7 or width / max(height, 1) > 1.85:
        blockers.append("aspect_ratio_not_16_9")
    if width < 1280 or height < 720:
        blockers.append("delivery_dimensions_below_1280x720")
    if contrast_stddev < 35:
        blockers.append("contrast_below_worldclass_floor")
    if mean_saturation < 45:
        blockers.append("saturation_below_worldclass_floor")
    ocr = ""
    if shutil.which("tesseract"):
        # Judge the actual shelf reduction, then upscale only for OCR sampling.
        # This preserves information loss caused by the mobile reduction.
        with tempfile.NamedTemporaryFile(suffix=".png") as shelf_file, tempfile.NamedTemporaryFile(suffix=".png") as threshold_file:
            if text_regions:
                crops = []
                for region in text_regions:
                    if len(region) != 4:
                        continue
                    crop = image.crop(tuple(region)).convert("RGB")
                    crops.append(crop)
                if crops:
                    width_max = max(crop.width for crop in crops)
                    height_sum = sum(crop.height for crop in crops)
                    ocr_image = Image.new("RGB", (width_max, height_sum), "white")
                    offset = 0
                    for crop in crops:
                        ocr_image.paste(crop, (0, offset)); offset += crop.height
                    ocr_image.thumbnail((1280, 720), Image.Resampling.LANCZOS)
                else:
                    ocr_image = shelf.resize((640, 360), Image.Resampling.NEAREST)
            else:
                ocr_image = shelf.resize((640, 360), Image.Resampling.NEAREST)
            ocr_image.save(shelf_file.name)
            threshold = ImageOps.autocontrast(ocr_image.convert("L")).point(lambda value: 255 if value > 135 else 0)
            threshold.save(threshold_file.name)
            proc = subprocess.run(
                ["tesseract", shelf_file.name, "stdout", "--psm", "6"],
                text=True, capture_output=True, timeout=30, check=False,
            )
            proc_threshold = subprocess.run(
                ["tesseract", threshold_file.name, "stdout", "--psm", "6"],
                text=True, capture_output=True, timeout=30, check=False,
            )
            proc_sparse = subprocess.run(
                ["tesseract", shelf_file.name, "stdout", "--psm", "11"],
                text=True, capture_output=True, timeout=30, check=False,
            )
        ocr = " ".join((proc.stdout + " " + proc_threshold.stdout + " " + proc_sparse.stdout).upper().split())
        expected_words = [word for word in re.findall(r"[A-Z0-9]+", expected_text.upper()) if len(word) > 1]
        missing = [word for word in expected_words if word not in ocr]
        recall = (len(expected_words) - len(missing)) / len(expected_words) if expected_words else 1.0
        if expected_words and recall < 0.75:
            blockers.append("mobile_ocr_or_text_match_failure:" + ",".join(missing))
    return {
        "status": "pass" if not blockers else "blocked",
        "path": str(path),
        "sha256": sha256(path),
        "width": width,
        "height": height,
        "mean_luminance": round(mean_luminance, 2),
        "contrast_stddev": round(contrast_stddev, 2),
        "mean_saturation": round(mean_saturation, 2),
        "ocr": ocr,
        "ocr_expected_word_recall": round(recall if shutil.which("tesseract") else 0.0, 3),
        "blockers": blockers,
    }


def validate_tournament(manifest: dict[str, Any], policy: dict[str, Any]) -> list[str]:
    expected = policy.get("tournament", {})
    blockers: list[str] = []
    for key, field in (("rough_count", "roughs"), ("shortlist_count", "shortlist"), ("production_count", "production"), ("owner_finalist_count", "finalists")):
        items = manifest.get(field, [])
        if len(items) != int(expected.get(key, 0)):
            blockers.append(f"tournament_count:{field}:{len(items)}")
    finalists = manifest.get("finalists", [])
    families = {item.get("template_family") for item in finalists if isinstance(item, dict)}
    if len(families) < int(expected.get("minimum_distinct_template_families", 3)):
        blockers.append("finalists_not_structurally_diverse")
    hashes = [item.get("sha256") for item in finalists if isinstance(item, dict) and item.get("sha256")]
    if len(hashes) != len(set(hashes)):
        blockers.append("duplicate_finalist_hash")
    return blockers


def score_receipt(receipt: dict[str, Any], policy: dict[str, Any]) -> tuple[int, list[str]]:
    rubric = policy.get("rubric", {})
    blockers = list(receipt.get("hard_blocks", []))
    scores = receipt.get("scores", {})
    total = 0
    for key, maximum in rubric.items():
        value = scores.get(key)
        if not isinstance(value, (int, float)) or value < 0 or value > maximum:
            blockers.append(f"rubric_score_invalid:{key}")
        else:
            total += int(value)
    if total < int(policy.get("score_threshold", 90)):
        blockers.append(f"score_below_threshold:{total}")
    if not receipt.get("candidate_sha256"):
        blockers.append("score_receipt_candidate_hash_missing")
    return total, blockers


def owner_approval_status(root: Path, finalists: list[dict[str, Any]], policy: dict[str, Any]) -> tuple[str, list[str]]:
    approval = read_json(root / "approval" / "thumbnail-owner-approval.json")
    blockers: list[str] = []
    if not approval:
        return "pending_owner_approval", ["exact_hash_owner_approval_missing"]
    approved_hash = approval.get("sha256", "")
    finalist_hashes = {item.get("sha256") for item in finalists}
    if approved_hash not in finalist_hashes:
        blockers.append("owner_approval_hash_not_current_finalist")
    if float(approval.get("rating", 0)) < float(policy.get("owner_threshold", 9)):
        blockers.append("owner_rating_below_threshold")
    if approval.get("release_candidate_hash") != read_json(root / "approval" / "release-candidate.json").get("release_candidate_hash"):
        blockers.append("owner_approval_release_hash_mismatch")
    return ("pass" if not blockers else "blocked"), blockers


def milestone_rows(
    *, references_ready: bool, policy_ready: bool, tool_state: dict[str, Any], local_model_ready: bool, brief_ready: bool,
    tournament_ready: bool, visual_qa_ready: bool, finalists_ready: bool, owner_ready: bool, video04_ready: bool,
    reliability_ready: bool, empirical_ready: bool,
) -> list[dict[str, Any]]:
    mapping = {
        "T1": ("Gold-standard benchmark corpus", references_ready),
        "T2": ("Objective 100-point rubric", policy_ready),
        "T3": ("Free local thumbnail environment", tool_state.get("core_ready", False)),
        "T4": ("Local model bake-off and role assignment", local_model_ready),
        "T5": ("Story-first thumbnail brief schema", brief_ready),
        "T6": ("Premium template-family system", policy_ready),
        "T7": ("Typography and text-effects engine", policy_ready),
        "T8": ("Hero asset and subject-separation pipeline", policy_ready),
        "T9": ("Controlled vivid-color pipeline", policy_ready),
        "T10": ("Local AI supporting-visual workflow", local_model_ready),
        "T11": ("Honest presenter/face system", policy_ready),
        "T12": ("20 to 8 to 5 to 3 tournament", tournament_ready),
        "T13": ("Automated shelf and visual QA", visual_qa_ready),
        "T14": ("GPT-5.6 Terra adversarial review contract", policy_ready),
        "T15": ("Conditional Sol Ultra creative reset", policy_ready),
        "T16": ("Hash-bound owner review and learning", owner_ready),
        "T17": ("Current episode thumbnail rebuild", video04_ready),
        "T18": ("Reliability, recovery, and clean-install proof", reliability_ready),
        "T19": ("Post-publication thumbnail learning loop", empirical_ready),
    }
    return [
        {"id": key, "name": name, "status": "complete" if done else "incomplete", "completion_percent": 100 if done else 0}
        for key, (name, done) in mapping.items()
    ]


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    policy = read_json(POLICY_PATH)
    schema = read_json(SCHEMA_PATH)
    root = output_root(video_id)
    approval_dir = ensure_dir(root / "approval")
    brief_path = approval_dir / "thumbnail-worldclass-brief.json"
    brief = read_json(brief_path)
    brief_blockers = validate_brief(brief, policy)
    tool_state = tool_health()

    refs = read_json(approval_dir / "thumbnail-reference-library-report.json")
    references_ready = int(refs.get("existing_reference_image_count", refs.get("reference_count", 0))) >= 6 and refs.get("status") == "pass"

    tournament_path = approval_dir / "thumbnail-worldclass-tournament.json"
    tournament = read_json(tournament_path)
    tournament_blockers = validate_tournament(tournament, policy) if tournament else ["tournament_manifest_missing"]
    finalists = tournament.get("finalists", []) if isinstance(tournament, dict) else []
    metric_rows: list[dict[str, Any]] = []
    score_rows: list[dict[str, Any]] = []
    for item in finalists:
        path = Path(item.get("path", ""))
        if not path.is_absolute():
            path = BASE / path
        metric_rows.append(image_metrics(path, item.get("headline", ""), item.get("text_regions")) if path.exists() else {"status": "blocked", "path": str(path), "blockers": ["candidate_missing"]})
        score_path = approval_dir / f"thumbnail-score-{item.get('id', 'unknown')}.json"
        receipt = read_json(score_path)
        total, score_blockers = score_receipt(receipt, policy) if receipt else (0, ["score_receipt_missing"])
        if receipt and receipt.get("candidate_sha256") != item.get("sha256"):
            score_blockers.append("score_receipt_candidate_hash_mismatch")
        if receipt and receipt.get("qa_contract_sha256") != qa_contract_hash():
            score_blockers.append("score_receipt_qa_contract_stale")
        expected_report_hashes = {
            "pixel": approval_dir / "thumbnail-pixel-quality-report.json",
            "semantic": approval_dir / "thumbnail-semantic-quality-report.json",
            "font": approval_dir / "thumbnail-font-quality-report.json",
        }
        recorded_report_hashes = receipt.get("deterministic_qa_report_sha256", {}) if receipt else {}
        for name, report_path in expected_report_hashes.items():
            if receipt and (not report_path.exists() or recorded_report_hashes.get(name) != sha256(report_path)):
                score_blockers.append(f"score_receipt_{name}_qa_report_stale")
        score_rows.append({"id": item.get("id"), "score": total, "status": "pass" if not score_blockers else "blocked", "blockers": score_blockers})
    visual_qa_ready = bool(finalists) and all(row.get("status") == "pass" for row in metric_rows)
    finalists_ready = visual_qa_ready and all(row.get("status") == "pass" for row in score_rows)
    source_adequacy = read_json(approval_dir / "thumbnail-source-adequacy.json")
    source_adequacy_ready = source_adequacy.get("status") == "pass"
    font_quality = read_json(approval_dir / "thumbnail-font-quality-report.json")
    font_quality_ready = font_quality.get("status") == "pass" and font_quality.get("shelf_readability_status") == "pass"
    pixel_quality = read_json(approval_dir / "thumbnail-pixel-quality-report.json")
    semantic_quality = read_json(approval_dir / "thumbnail-semantic-quality-report.json")
    pixel_quality_ready = pixel_quality.get("status") == "pass" and int(pixel_quality.get("minimum_score_observed", 0) or 0) >= 93
    semantic_quality_ready = semantic_quality.get("status") == "pass"
    finalists_ready = finalists_ready and source_adequacy_ready and font_quality_ready and pixel_quality_ready and semantic_quality_ready
    codex_primary = read_json(approval_dir / "thumbnail-codex-primary-review.json")
    codex_candidates = codex_primary.get("candidates", []) if isinstance(codex_primary.get("candidates"), list) else []
    tournament_hashes = {str(item.get("sha256") or "") for item in finalists}
    codex_hashes = {str(item.get("sha256") or "") for item in codex_candidates}
    current_workflow_ready = bool(
        codex_primary.get("status") == "ready_for_hash_bound_owner_review"
        and len(codex_candidates) == int(policy.get("tournament", {}).get("owner_finalist_count", 3))
        and codex_hashes == tournament_hashes
        and source_adequacy_ready
        and font_quality_ready
        and pixel_quality_ready
        and semantic_quality_ready
    )
    owner_status, owner_blockers = owner_approval_status(root, finalists, policy)

    reliability = read_json(approval_dir / "thumbnail-reliability-proof.json")
    reliability_ready = reliability.get("status") == "pass"
    empirical = read_json(root / "metrics" / "thumbnail-ab-learning-report.json")
    empirical_ready = empirical.get("status") == "pass" and bool(empirical.get("watch_time_share_winner"))
    policy_ready = bool(policy.get("rubric")) and sum(policy.get("rubric", {}).values()) == 100 and bool(schema.get("required"))
    local_model_ready = read_json(approval_dir / "thumbnail-local-model-benchmark.json").get("status") == "pass"
    brief_ready = not brief_blockers
    tournament_ready = not tournament_blockers
    owner_ready = owner_status == "pass"
    video04_ready = video_id != "04" or ((finalists_ready or current_workflow_ready) and owner_ready)
    prepublication_ready = bool((finalists_ready or current_workflow_ready) and reliability_ready)

    milestones = milestone_rows(
        references_ready=references_ready, policy_ready=policy_ready, tool_state=tool_state, local_model_ready=local_model_ready,
        brief_ready=brief_ready, tournament_ready=tournament_ready, visual_qa_ready=visual_qa_ready, finalists_ready=finalists_ready,
        owner_ready=owner_ready, video04_ready=video04_ready, reliability_ready=reliability_ready,
        empirical_ready=empirical_ready,
    )
    blockers = []
    blockers.extend([] if references_ready else ["reference_corpus_not_pass"])
    blockers.extend(brief_blockers)
    blockers.extend(tournament_blockers)
    blockers.extend([blocker for row in metric_rows + score_rows for blocker in row.get("blockers", [])])
    if not source_adequacy_ready:
        blockers.extend(source_adequacy.get("blockers", []) or ["thumbnail_source_adequacy_not_pass"])
    if not font_quality_ready:
        blockers.append("thumbnail_font_quality_not_pass")
    if not pixel_quality_ready:
        blockers.append("thumbnail_final_pixel_quality_not_pass")
    if not semantic_quality_ready:
        blockers.append("thumbnail_semantic_quality_not_pass")
    if not reliability_ready:
        blockers.append("thumbnail_reliability_proof_not_pass")
    blockers = list(dict.fromkeys(blockers))
    pending_gates = list(owner_blockers)
    if not empirical_ready:
        pending_gates.append("post_publication_learning_pending")
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        # Engineering prepublication truth is intentionally separate from
        # owner approval and future public-performance learning.  The
        # canonical production contract may advance to owner review only when
        # this status passes; it never treats pending human/public gates as an
        # automated technical failure or silently claims those gates complete.
        "status": "pass" if prepublication_ready and not blockers else "blocked",
        "prepublication_status": "pass" if prepublication_ready else "blocked",
        "empirical_status": "pass" if empirical_ready else "pending_public_data",
        "policy": display_path(POLICY_PATH),
        "schema": display_path(SCHEMA_PATH),
        "brief": display_path(brief_path),
        "tool_health": tool_state,
        "reference_corpus_ready": references_ready,
        "brief_blockers": brief_blockers,
        "tournament_blockers": tournament_blockers,
        "candidate_metrics": metric_rows,
        "candidate_scores": score_rows,
        "font_quality": {
            "status": font_quality.get("status", "missing"),
            "shelf_readability_status": font_quality.get("shelf_readability_status", "missing"),
        },
        "pixel_quality": {
            "status": pixel_quality.get("status", "missing"),
            "minimum_score_observed": pixel_quality.get("minimum_score_observed", 0),
        },
        "semantic_quality": {"status": semantic_quality.get("status", "missing")},
        "owner_approval_status": owner_status,
        "current_codex_primary_workflow_ready": current_workflow_ready,
        "milestones": milestones,
        "engineering_completion_percent": round(sum(row["completion_percent"] for row in milestones[:15] + milestones[17:18]) / 16, 2),
        "overall_completion_percent": round(sum(row["completion_percent"] for row in milestones) / len(milestones), 2),
        "blockers": blockers,
        "pending_gates": pending_gates,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval_dir / "thumbnail-worldclass-report.json"
    md_path = approval_dir / "thumbnail-worldclass-report.md"
    write_json(json_path, payload)
    lines = [
        f"# Pattern Lab World-Class Thumbnail Report: {video_id}", "",
        f"Generated: {payload['generated_at']}", f"Status: {payload['status']}",
        f"Prepublication: {payload['prepublication_status']}",
        f"Empirical: {payload['empirical_status']}",
        f"Engineering completion: {payload['engineering_completion_percent']}%", "",
        "## Milestones", "",
    ]
    lines.extend(f"- {row['id']} {row['name']}: {row['completion_percent']}% ({row['status']})" for row in milestones)
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {item}" for item in blockers] or ["- none"])
    lines.extend(["", "## Pending human or public-data gates", ""])
    lines.extend([f"- {item}" for item in pending_gates] or ["- none"])
    lines.extend(["", "Paid provider calls: not performed", "YouTube mutation: not performed"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Pattern Lab world-class thumbnail readiness.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "prepublication_status": payload["prepublication_status"], "completion_percent": payload["overall_completion_percent"], "report": display_path(report)}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

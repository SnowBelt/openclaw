#!/usr/bin/env python3
"""Generate, resume, prefilter, and locally judge non-proof Pattern Lab stills."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from patternlab_common import BASE, append_ledger, display_path, ensure_dir, output_root, patternlab_model_root, utc_now
from patternlab_local_media_runtime import (
    atomic_write_json,
    atomic_write_text,
    binary_identity,
    execution_context,
    exclusive_process_lock,
    read_json,
    sha256_file,
)
from patternlab_local_visual_judge_runner import run_model
from patternlab_storage_lifecycle import disk_snapshot, operation_budget, read_policy as read_storage_policy


MODEL_ID = "flux_2_klein_4b_q6p.ckpt"
JUDGE_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "narration_match": {"type": "integer", "minimum": 0, "maximum": 100},
            "visual_quality": {"type": "integer", "minimum": 0, "maximum": 100},
            "historical_integrity": {"type": "integer", "minimum": 0, "maximum": 100},
            "hard_failures": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
        "required": [
            "score",
            "narration_match",
            "visual_quality",
            "historical_integrity",
            "hard_failures",
            "reason",
        ],
        "additionalProperties": False,
    },
    separators=(",", ":"),
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def image_metrics(path: Path) -> dict[str, float]:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return {}
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return {
        "mean_luma": round(float(np.mean(gray) / 255.0), 5),
        "luma_standard_deviation": round(float(np.std(gray) / 255.0), 5),
        "mean_saturation": round(float(np.mean(hsv[:, :, 1]) / 255.0), 5),
        "sharpness_variance": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 3),
    }


def deterministic_blockers(metrics: dict[str, float], policy: dict[str, Any]) -> list[str]:
    if not metrics:
        return ["candidate_image_decode_failed"]
    blockers: list[str] = []
    if not policy["minimum_mean_luma"] <= metrics["mean_luma"] <= policy["maximum_mean_luma"]:
        blockers.append("candidate_luma_out_of_range")
    if metrics["luma_standard_deviation"] < policy["minimum_luma_standard_deviation"]:
        blockers.append("candidate_contrast_below_floor")
    if metrics["mean_saturation"] < policy["minimum_mean_saturation"]:
        blockers.append("candidate_saturation_below_floor")
    if metrics["sharpness_variance"] < policy["minimum_sharpness_variance"]:
        blockers.append("candidate_sharpness_below_floor")
    return blockers


def judge_prompt(beat: dict[str, Any]) -> str:
    fields = beat.get("prompt_fields", {})
    return (
        "You are the strict independent visual judge for Pattern Lab. This is a non-proof support image. "
        "Reject if it fails the exact narration, looks dull or generic, contains malformed people, hands, faces, or architecture, "
        "contains text, logo, or watermark, implies it is actual archival evidence, depicts a named city or event as fact, "
        "or contains any period anachronism. Do not reward attractiveness when historical constraints are wrong. "
        f"Narration: {fields.get('narration', '')}. Story function: {fields.get('story_function', '')}. "
        f"Visible action: {fields.get('visible_action', '')}. Historical constraints: {fields.get('historical_constraints', '')}. "
        "Every numeric field is a 0-100 quality score, not a boolean. Score every dimension and the overall score 93 or higher "
        "only when it is genuinely owner-review quality and has no hard failure. Return JSON only."
    )


def judgment_passes(judgment: dict[str, Any], quality: dict[str, Any]) -> bool:
    floor = int(quality.get("minimum_local_visual_judge_score", 93))
    dimension_floor = int(quality.get("minimum_local_visual_judge_dimension_score", floor))
    return bool(
        int(judgment.get("score", 0) or 0) >= floor
        and all(
            int(judgment.get(name, 0) or 0) >= dimension_floor
            for name in ["narration_match", "visual_quality", "historical_integrity"]
        )
        and not judgment.get("hard_failures")
    )


def repaired_prompt(beat: dict[str, Any], round_index: int) -> tuple[str, str]:
    prompt = str(beat["prompt"])
    negative = str(beat["negative_prompt"])
    if round_index == 0:
        return prompt, negative
    fields = beat.get("prompt_fields", {})
    correction = (
        "\nREPAIR PRIORITY: Museum-grade period authenticity is mandatory. Use only plainly visible period-correct clothing, "
        "vehicles, storefront materials, furniture, tools, packaging, and lighting. Prefer fewer people and one unmistakable "
        "human action over a crowded scene. Do not use modern casual clothing, modern cars or trucks, modern cardboard printing, "
        "contemporary fixtures, synthetic neon color, blue-orange blockbuster grading, or staged stock-photo posing. "
        f"Recheck every visible object against: {fields.get('historical_constraints', '')}."
    )
    if round_index >= 2:
        correction += (
            " Use a restrained documentary color palette, natural skin tones, bright readable faces, realistic film response, "
            "one or two adults maximum, clean hand visibility, and an uncluttered composition."
        )
    return prompt + correction, (
        negative
        + ", modern vehicle, modern truck, modern clothing, t-shirt, shorts, sneakers, contemporary packaging, crowded scene, "
        "neon blue cast, orange teal grade, staged stock photo"
    )


def generation_signature(
    *,
    prompt: str,
    negative_prompt: str,
    seed: int,
    width: int,
    height: int,
    model_sha256: str,
    cli_sha256: str,
) -> str:
    payload = {
        "engine": "Draw Things CLI",
        "model_id": MODEL_ID,
        "model_sha256": model_sha256,
        "cli_sha256": cli_sha256,
        "prompt_sha256": sha256_text(prompt),
        "negative_prompt_sha256": sha256_text(negative_prompt),
        "seed": seed,
        "width": width,
        "height": height,
        "steps": 4,
    }
    return sha256_text(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def reusable_candidate(target: Path, receipt_path: Path, signature: str) -> dict[str, Any] | None:
    receipt = read_json(receipt_path)
    if (
        receipt.get("status") == "generated"
        and receipt.get("generation_signature") == signature
        and target.is_file()
        and receipt.get("output_sha256") == sha256_file(target)
    ):
        return receipt
    return None


def write_progress(
    path: Path,
    *,
    video_id: str,
    model_id: str,
    rows: list[dict[str, Any]],
    blockers: list[str],
) -> None:
    atomic_write_json(
        path,
        {
            "generated_at": utc_now(),
            "video_id": video_id,
            "status": "running",
            "model_id": model_id,
            "beats": rows,
            "blockers": sorted(set(blockers)),
            "youtube_mutation": "not_performed",
        },
    )


def generate_candidate(
    *,
    cli: str,
    model_root: Path,
    model_path: Path,
    cli_identity: dict[str, str],
    target: Path,
    receipt_path: Path,
    prompt: str,
    negative_prompt: str,
    seed: int,
    width: int,
    height: int,
    force: bool,
) -> tuple[dict[str, Any], bool]:
    model_sha256 = sha256_file(model_path)
    signature = generation_signature(
        prompt=prompt,
        negative_prompt=negative_prompt,
        seed=seed,
        width=width,
        height=height,
        model_sha256=model_sha256,
        cli_sha256=cli_identity["sha256"],
    )
    reused = None if force else reusable_candidate(target, receipt_path, signature)
    if reused:
        return reused, True
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp.png")
    command = [
        cli,
        "generate",
        "--models-dir",
        str(model_root),
        "--model",
        MODEL_ID,
        "--prompt",
        prompt,
        "--negative-prompt",
        negative_prompt,
        "--steps",
        "4",
        "--width",
        str(width),
        "--height",
        str(height),
        "--seed",
        str(seed),
        "--offline",
        "--disable-preview",
        "--output",
        str(temporary),
    ]
    attempts: list[dict[str, Any]] = []
    try:
        for attempt in range(1, 3):
            temporary.unlink(missing_ok=True)
            with exclusive_process_lock(BASE / "local-output" / "locks" / "draw-things-generation.lock", timeout_seconds=90):
                result = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
            attempts.append(
                {
                    "attempt": attempt,
                    "returncode": result.returncode,
                    "failure_excerpt": result.stderr[-500:].replace(str(Path.home()), "<HOME>"),
                }
            )
            if result.returncode == 0 and temporary.is_file() and temporary.stat().st_size > 0:
                temporary.replace(target)
                break
    finally:
        temporary.unlink(missing_ok=True)
    generated = target.is_file()
    receipt = {
        "generated_at": utc_now(),
        "status": "generated" if generated else "blocked",
        "engine": "Draw Things CLI",
        "model_id": MODEL_ID,
        "model_sha256": model_sha256,
        "draw_things_cli": cli_identity,
        "generation_signature": signature,
        "prompt_sha256": sha256_text(prompt),
        "negative_prompt_sha256": sha256_text(negative_prompt),
        "seed": seed,
        "width": width,
        "height": height,
        "steps": 4,
        "output": display_path(target),
        "output_sha256": sha256_file(target) if generated else "",
        "attempts": attempts,
        "local_only": True,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    atomic_write_json(receipt_path, receipt)
    return receipt, False


def promote_winner(
    *,
    beat: dict[str, Any],
    winner: dict[str, Any],
    cli: str,
    cli_identity: dict[str, str],
    model_root: Path,
    model_path: Path,
    selected: Path,
    receipt_path: Path,
    force: bool,
    quality: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[str]]:
    """Use low-strength local img2img once, then rejudge final selected pixels."""
    source = BASE / str(winner["path"])
    final_width, final_height = (int(value) for value in beat.get("winner_size", [1536, 1024]))
    policy = read_json(BASE / "resources" / "local-visual-prompt-policy.json").get("candidate_tournament", {})
    width = int(policy.get("refine_width", 768))
    height = int(policy.get("refine_height", 512))
    prompt, negative = repaired_prompt(beat, int(winner.get("round", 0)))
    signature = sha256_text(
        json.dumps(
            {
                "source_sha256": sha256_file(source),
                "prompt_sha256": sha256_text(prompt),
                "negative_prompt_sha256": sha256_text(negative),
                "refine_width": width,
                "refine_height": height,
                "final_width": final_width,
                "final_height": final_height,
                "strength": 0.1,
                "model_sha256": sha256_file(model_path),
                "cli_sha256": cli_identity["sha256"],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    existing = read_json(receipt_path)
    reused = bool(
        not force
        and existing.get("promotion_signature") == signature
        and existing.get("status") == "pass"
        and selected.is_file()
        and existing.get("output_sha256") == sha256_file(selected)
    )
    blockers: list[str] = []
    attempts: list[dict[str, Any]] = []
    promotion_method = "hash_verified_reuse" if reused else "local_img2img_then_lanczos"
    if not reused:
        selected.unlink(missing_ok=True)
        temporary = selected.with_name(f".{selected.name}.{os.getpid()}.tmp.png")
        command = [
            cli,
            "generate",
            "--models-dir",
            str(model_root),
            "--model",
            MODEL_ID,
            "--prompt",
            prompt,
            "--negative-prompt",
            negative,
            "--image",
            str(source),
            "--strength",
            "0.1",
            "--steps",
            "4",
            "--width",
            str(width),
            "--height",
            str(height),
            "--seed",
            str(winner["seed"]),
            "--offline",
            "--disable-preview",
            "--output",
            str(temporary),
        ]
        try:
            for attempt in range(1, 3):
                temporary.unlink(missing_ok=True)
                with exclusive_process_lock(BASE / "local-output" / "locks" / "draw-things-generation.lock", timeout_seconds=90):
                    result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
                attempts.append({"attempt": attempt, "returncode": result.returncode, "failure_excerpt": result.stderr[-500:].replace(str(Path.home()), "<HOME>")})
                if result.returncode == 0 and temporary.is_file() and temporary.stat().st_size > 0:
                    refined = cv2.imread(str(temporary), cv2.IMREAD_COLOR)
                    if refined is not None:
                        final_pixels = cv2.resize(refined, (final_width, final_height), interpolation=cv2.INTER_LANCZOS4)
                        encoded, buffer = cv2.imencode(".png", final_pixels, [cv2.IMWRITE_PNG_COMPRESSION, 6])
                        if encoded:
                            final_temporary = selected.with_name(f".{selected.name}.{os.getpid()}.final.tmp")
                            final_temporary.write_bytes(buffer.tobytes())
                            final_temporary.replace(selected)
                    break
        finally:
            temporary.unlink(missing_ok=True)
        if not selected.is_file():
            source_pixels = cv2.imread(str(source), cv2.IMREAD_COLOR)
            if source_pixels is not None:
                final_pixels = cv2.resize(source_pixels, (final_width, final_height), interpolation=cv2.INTER_LANCZOS4)
                encoded, buffer = cv2.imencode(".png", final_pixels, [cv2.IMWRITE_PNG_COMPRESSION, 6])
                if encoded:
                    final_temporary = selected.with_name(f".{selected.name}.{os.getpid()}.fallback.tmp")
                    final_temporary.write_bytes(buffer.tobytes())
                    final_temporary.replace(selected)
                    promotion_method = "deterministic_lanczos_after_logged_img2img_unavailable"
    if not selected.is_file():
        blockers.append("winner_promotion_generation_failed")
        judgment: dict[str, Any] = {}
        metrics: dict[str, Any] = {}
    else:
        metrics = image_metrics(selected)
        blockers.extend(deterministic_blockers(metrics, quality))
        try:
            judged, elapsed, output_hash, cache_status = run_model(
                selected,
                judge_prompt(beat),
                JUDGE_SCHEMA,
                timeout=900,
                maximum_output_tokens=1024,
            )
            judgment = {**judged, "elapsed_seconds": round(elapsed, 3), "output_sha256": output_hash, "cache_status": cache_status}
            if not judgment_passes(judged, quality):
                blockers.append("promoted_winner_local_visual_judge_rejected")
        except RuntimeError as exc:
            judgment = {"error": str(exc)}
            blockers.append("promoted_winner_local_visual_judge_failed")
    if blockers and selected.is_file():
        episode_root = selected.parents[2]
        failed_root = ensure_dir(episode_root / "intermediates" / "failed-candidates" / "local-still-promotions")
        failed_path = failed_root / f"{beat['beat_id']}-{sha256_file(selected)[:12]}.png"
        selected.replace(failed_path)
        selected = failed_path
        promotion_method += "+quarantined_after_final_qa_failure"
    receipt = {
        "generated_at": utc_now(),
        "status": "pass" if not blockers else "blocked",
        "beat_id": beat["beat_id"],
        "source_candidate": display_path(source),
        "source_candidate_sha256": sha256_file(source),
        "promotion_signature": signature,
        "output": display_path(selected),
        "output_sha256": sha256_file(selected) if selected.is_file() else "",
        "refine_dimensions": [width, height],
        "dimensions": [final_width, final_height],
        "img2img_strength": 0.1,
        "promotion_method": promotion_method,
        "generation_reused": reused,
        "attempts": attempts,
        "metrics": metrics,
        "local_visual_judgment": judgment,
        "blockers": sorted(set(blockers)),
        "local_only": True,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    atomic_write_json(receipt_path, receipt)
    if blockers:
        return None, blockers
    return {
        **winner,
        "selected_path": display_path(selected),
        "selected_sha256": sha256_file(selected),
        "selection_receipt": display_path(receipt_path),
        "selection_receipt_sha256": sha256_file(receipt_path),
        "promoted_dimensions": [final_width, final_height],
        "promoted_local_visual_judgment": judgment,
    }, []


def build_report(
    video_id: str,
    *,
    live: bool,
    beat_ids: set[str] | None = None,
    force: bool = False,
) -> tuple[dict[str, Any], Path, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    plan_path = approval / "local-visual-prompt-plan.json"
    plan = read_json(plan_path)
    prompt_policy = read_json(BASE / "resources" / "local-visual-prompt-policy.json")
    router = read_json(approval / "local-generation-router-report.json")
    model_root = patternlab_model_root()
    model_path = model_root / MODEL_ID
    work_root = ensure_dir(root / "intermediates" / "generation-candidates" / "local-stills")
    selected_root = ensure_dir(root / "source-packet" / "selected-local-ai")
    quality = prompt_policy.get("quality_rules", {})
    tournament = prompt_policy.get("candidate_tournament", {})
    storage_gate = operation_budget(read_storage_policy(), "routine_still_generation", disk_snapshot(BASE))
    beats = [
        row
        for row in plan.get("beats", [])
        if row.get("generation_allowed") and (not beat_ids or row.get("beat_id") in beat_ids)
    ]
    generation_required = bool(beats)
    blockers: list[str] = []
    context = execution_context()
    if plan.get("status") != "pass":
        blockers.append("local_visual_prompt_plan_not_pass")
    if live and generation_required and router.get("routes", {}).get("local_routine_stills") != "ready":
        blockers.append("local_routine_still_route_not_ready")
    if live and generation_required and not context["metal_generation_trusted"]:
        blockers.append("local_generation_requires_native_user_runtime_not_codex_seatbelt")
    if live and generation_required:
        blockers.extend(storage_gate["blockers"])
    cli = shutil.which("draw-things-cli")
    if live and generation_required and not cli:
        blockers.append("draw_things_cli_missing")
    if live and generation_required and not model_path.is_file():
        blockers.append("draw_things_model_missing")
    cli_identity = binary_identity(cli) if cli else {"path": "missing", "version": "missing", "sha256": ""}
    rows: list[dict[str, Any]] = []
    progress_path = approval / "local-still-tournament-progress.json"
    maximum_rounds = 1 + int(tournament.get("maximum_repair_rounds", 2))
    for beat in beats:
        beat_id = str(beat["beat_id"])
        beat_dir = ensure_dir(work_root / beat_id)
        receipt_dir = ensure_dir(beat_dir / "receipts")
        candidates: list[dict[str, Any]] = []
        winner: dict[str, Any] | None = None
        for round_index in range(maximum_rounds):
            if winner or not live:
                break
            prompt, negative = repaired_prompt(beat, round_index)
            for base_seed in beat.get("candidate_seeds", []):
                seed = int(base_seed) + round_index * 1000
                target = beat_dir / f"round-{round_index}-seed-{seed}.png"
                receipt_path = receipt_dir / f"round-{round_index}-seed-{seed}.json"
                row: dict[str, Any] = {
                    "round": round_index,
                    "seed": seed,
                    "path": display_path(target),
                    "status": "planned" if not live else "blocked",
                    "blockers": [],
                }
                if live and not blockers and cli:
                    width, height = (int(value) for value in beat.get("draft_size", [768, 512]))
                    generation, reused = generate_candidate(
                        cli=cli,
                        model_root=model_root,
                        model_path=model_path,
                        cli_identity=cli_identity,
                        target=target,
                        receipt_path=receipt_path,
                        prompt=prompt,
                        negative_prompt=negative,
                        seed=seed,
                        width=width,
                        height=height,
                        force=force,
                    )
                    row["generation_receipt"] = display_path(receipt_path)
                    row["generation_receipt_sha256"] = sha256_file(receipt_path)
                    row["generation_reused"] = reused
                    if generation.get("status") != "generated":
                        row["blockers"].append("local_candidate_generation_failed")
                    row["metrics"] = image_metrics(target)
                    row["blockers"].extend(deterministic_blockers(row["metrics"], quality))
                    if not row["blockers"]:
                        try:
                            judgment, elapsed, output_hash, cache_status = run_model(
                                target,
                                judge_prompt(beat),
                                JUDGE_SCHEMA,
                                timeout=900,
                                maximum_output_tokens=1024,
                            )
                            row["local_visual_judgment"] = {
                                **judgment,
                                "elapsed_seconds": round(elapsed, 3),
                                "output_sha256": output_hash,
                                "cache_status": cache_status,
                            }
                            if not judgment_passes(judgment, quality):
                                row["blockers"].append("local_visual_judge_rejected_candidate")
                        except RuntimeError as exc:
                            row["blockers"].append(f"local_visual_judge_failed:{str(exc)[:240]}")
                    row["sha256"] = sha256_file(target) if target.is_file() else ""
                    row["status"] = "pass" if not row["blockers"] else "blocked"
                candidates.append(row)
                if row["status"] == "pass":
                    winner = row
                    break
                write_progress(
                    progress_path,
                    video_id=video_id,
                    model_id=MODEL_ID,
                    rows=[*rows, {"beat_id": beat_id, "candidates": candidates, "winner": winner}],
                    blockers=blockers,
                )
        if winner and cli:
            selected = selected_root / f"{beat_id}.png"
            selection_receipt = ensure_dir(approval / "local-still-selection-receipts") / f"{beat_id}.json"
            winner, promotion_blockers = promote_winner(
                beat=beat,
                winner=winner,
                cli=cli,
                cli_identity=cli_identity,
                model_root=model_root,
                model_path=model_path,
                selected=selected,
                receipt_path=selection_receipt,
                force=force,
                quality=quality,
            )
            if promotion_blockers:
                blockers.extend(f"{beat_id}:{item}" for item in promotion_blockers)
            elif winner:
                planned_asset_id = str(beat.get("planned_ai_asset_id") or "").strip()
                asset_id = planned_asset_id or f"video-{video_id}-local-ai-{beat_id}"
                append_ledger(
                    root,
                    {
                        "asset_id": asset_id,
                        "asset_type": "image",
                        "filename": Path(winner["selected_path"]).name,
                        "local_path": winner["selected_path"],
                        "tool": "Draw Things CLI",
                        "model_or_service": MODEL_ID,
                        "source_prompt_or_source_file": display_path(plan_path),
                        "source_title": f"Pattern Lab {beat_id} dramatic reconstruction",
                        "source_url": "Pattern Lab local generation receipt",
                        "creator": "Pattern Lab",
                        "archive_or_platform": "Local Draw Things",
                        "source_class": "ai_reconstruction",
                        "license_or_rights_basis": "Pattern Lab original locally generated support; model Apache-2.0; non-proof use only",
                        "license_status": "approved for owner-review candidate; public use pending owner approval",
                        "attribution_required": "no",
                        "attribution_text": "Pattern Lab original reconstruction",
                        "commercial_use_ok": "yes",
                        "modification_ok": "yes",
                        "recognizable_people_property_trademark_risk": "fictional generic people; owner review required",
                        "ai_reconstruction_disclosure": "Dramatic reconstruction — not archival footage",
                        "created_at": utc_now(),
                        "notes": f"Selected by local tournament; selection receipt {winner['selection_receipt']}",
                        "human_review_required": "yes",
                        "human_review_status": "pending",
                    },
                )
        row_status = "pass" if winner else ("planned" if not live else "blocked")
        rows.append({"beat_id": beat_id, "candidates": candidates, "winner": winner, "status": row_status})
        write_progress(progress_path, video_id=video_id, model_id=MODEL_ID, rows=rows, blockers=blockers)
    if live and any(row["status"] != "pass" for row in rows):
        blockers.append("one_or_more_local_still_tournaments_have_no_93_plus_winner")
    if not generation_required and not blockers:
        status = "pass"
        applicability = "not_applicable"
    elif live and rows and not blockers:
        status = "pass"
        applicability = "required_and_complete"
    elif not live and not blockers:
        status = "planned"
        applicability = "required_pending_render"
    else:
        status = "blocked"
        applicability = "required_blocked" if generation_required else "not_applicable_blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "applicability": applicability,
        "live": live,
        "prompt_plan": display_path(plan_path),
        "prompt_plan_sha256": sha256_file(plan_path) if plan_path.is_file() else "",
        "model_id": MODEL_ID,
        "model_root": display_path(model_root),
        "storage_gate": storage_gate,
        "execution_context": context,
        "candidate_work_root": display_path(work_root),
        "selected_asset_root": display_path(selected_root),
        "beats": rows,
        "generation_beat_count": len(beats),
        "blockers": sorted(set(blockers)),
        "rule": "Only a local Qwen3-VL score of at least 93 with no hard failure may win; no average pass.",
        "resumable": True,
        "atomic_progress_receipt": display_path(progress_path),
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    stem = "local-still-tournament-report" if live else "local-still-tournament-plan-report"
    json_path = approval / f"{stem}.json"
    md_path = approval / f"{stem}.md"
    atomic_write_json(json_path, payload)
    progress_path.unlink(missing_ok=True)
    lines = [
        f"# Local Still Tournament: Video {video_id}",
        "",
        f"Status: {status}",
        f"Live: {str(live).lower()}",
        "",
        "## Beats",
        "",
    ]
    lines.extend(
        f"- {row['beat_id']}: {row['status']} | winner={row['winner'].get('selected_path') if row['winner'] else 'none'}"
        for row in rows
    )
    lines.extend(
        [
            "",
            "## Blockers",
            "",
            *([f"- {item}" for item in payload["blockers"]] or ["- none"]),
            "",
            "Paid provider calls: not performed",
            "YouTube mutation: not performed",
            "",
        ]
    )
    atomic_write_text(md_path, "\n".join(lines))
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the resumable Pattern Lab local still candidate tournament.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--beat-id", action="append")
    parser.add_argument("--force", action="store_true", help="Ignore valid per-candidate generation receipts.")
    args = parser.parse_args()
    payload, report, _ = build_report(
        args.video_id.zfill(2),
        live=args.live,
        beat_ids=set(args.beat_id or []),
        force=args.force,
    )
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if args.live and payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

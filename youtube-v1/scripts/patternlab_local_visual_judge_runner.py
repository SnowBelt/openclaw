#!/usr/bin/env python3
"""Run the approved local Qwen3-VL judge for benchmark fixtures or final video frames.

This is the only production writer for local visual-judge receipts. It is
deliberately offline, deterministic, hash-bound, and fail-closed. SigLIP and
other retrieval models may shortlist assets, but cannot write these receipts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageStat

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import BASE, display_path, ensure_dir, ffmpeg_cmd, media_duration_seconds, output_root, utc_now
from patternlab_media_qa_common import load_policy as load_media_policy, qa_contract_hash
from patternlab.state import sha256_file
from patternlab_thumbnail_pixel_quality import ocr_measurement


MODEL_ID = "qwen3-vl-8b-instruct"
HF_REPO_CACHE = Path.home() / ".cache" / "huggingface" / "hub" / "models--Qwen--Qwen3-VL-8B-Instruct-GGUF"
FIXTURE_SIZE = (1280, 720)
VERDICT_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["accept", "reject"]},
            "reason": {"type": "string"},
        },
        "required": ["verdict", "reason"],
        "additionalProperties": False,
    },
    separators=(",", ":"),
)
FRAME_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "narration_match": {"type": "integer", "minimum": 0, "maximum": 100},
            "evidence_visibility": {"type": "integer", "minimum": 0, "maximum": 100},
            "visual_variety": {"type": "integer", "minimum": 0, "maximum": 100},
            "motion_and_composition": {"type": "integer", "minimum": 0, "maximum": 100},
            "typography_and_caption_safety": {"type": "integer", "minimum": 0, "maximum": 100},
            "hard_failures": {"type": "array", "items": {"type": "string"}},
            "reason": {"type": "string"},
        },
        "required": [
            "score",
            "narration_match",
            "evidence_visibility",
            "visual_variety",
            "motion_and_composition",
            "typography_and_caption_safety",
            "hard_failures",
            "reason",
        ],
        "additionalProperties": False,
    },
    separators=(",", ":"),
)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        BASE / "resources" / "fonts" / "external" / "anton-google-regular.ttf",
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def text_center(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, *, size: int, fill: str, stroke: int = 0) -> None:
    draw.text(xy, value, font=font(size), fill=fill, anchor="mm", align="center", stroke_width=stroke, stroke_fill="#050505")


def city_scene(title: str, subtitle: str, *, bright: bool = True) -> Image.Image:
    top = (28, 132, 214) if bright else (12, 18, 26)
    bottom = (246, 178, 70) if bright else (25, 23, 26)
    image = Image.new("RGB", FIXTURE_SIZE)
    pixels = image.load()
    for y in range(FIXTURE_SIZE[1]):
        mix = y / max(1, FIXTURE_SIZE[1] - 1)
        color = tuple(round(top[i] * (1 - mix) + bottom[i] * mix) for i in range(3))
        for x in range(FIXTURE_SIZE[0]):
            pixels[x, y] = color
    draw = ImageDraw.Draw(image)
    for index, x in enumerate(range(70, 1210, 115)):
        height = 150 + (index % 5) * 55
        draw.rectangle((x, 560 - height, x + 78, 620), fill=(35 + index * 4, 45, 58), outline=(240, 197, 83), width=4)
        for wy in range(580 - height, 590, 32):
            draw.rectangle((x + 15, wy, x + 30, wy + 12), fill="#ffd85e")
            draw.rectangle((x + 48, wy, x + 63, wy + 12), fill="#ffd85e")
    draw.rectangle((0, 0, 1280, 132), fill=(0, 0, 0))
    text_center(draw, (640, 62), title, size=72, fill="white", stroke=3)
    text_center(draw, (640, 655), subtitle, size=42, fill="#ffe04a", stroke=3)
    return image


def document_scene(title: str, rows: list[str], source: str) -> Image.Image:
    image = Image.new("RGB", FIXTURE_SIZE, "#ead7ae")
    draw = ImageDraw.Draw(image)
    draw.rectangle((90, 55, 1190, 665), fill="#f8edcf", outline="#3b2b1f", width=7)
    text_center(draw, (640, 125), title, size=58, fill="#2c2119")
    draw.line((150, 175, 1130, 175), fill="#6a513d", width=5)
    for index, row in enumerate(rows):
        draw.text((175, 225 + index * 78), row, font=font(42), fill="#30231b")
    draw.rectangle((130, 585, 1150, 640), fill="#1a2028")
    text_center(draw, (640, 612), source, size=28, fill="white")
    return image


def render_fixture(spec: dict[str, Any], target: Path) -> None:
    kind = str(spec.get("fixture") or "")
    if kind == "cleveland_label":
        image = city_scene("CLEVELAND, OHIO", "TERMINAL TOWER DISTRICT")
    elif kind == "chicago_label":
        image = city_scene("CHICAGO 1955", "LAKE SHORE CORRIDOR")
    elif kind == "general_motors_label":
        image = city_scene("GENERAL MOTORS HQ", "RENAISSANCE CENTER")
    elif kind == "woodward_label":
        image = city_scene("WOODWARD AVENUE", "MIDTOWN DETROIT")
    elif kind in {"dim_street", "dim_skyline"}:
        image = city_scene("DETROIT", "HASTINGS STREET" if kind == "dim_street" else "MODERN SKYLINE", bright=False)
        image = ImageEnhance.Brightness(image).enhance(0.38)
        image = ImageEnhance.Contrast(image).enhance(0.55)
    elif kind == "tiny_source_label":
        image = document_scene("DETROIT PLANNING MAP", ["BLACK BOTTOM", "HASTINGS STREET", "1951"], "SOURCE LABEL SHOULD BE READABLE")
        draw = ImageDraw.Draw(image)
        draw.rectangle((125, 580, 1155, 645), fill="#f8edcf")
        draw.text((500, 615), "source: city plan 1951", font=font(8), fill="#82745f")
    elif kind == "low_contrast_caption":
        image = city_scene("DETROIT", "")
        draw = ImageDraw.Draw(image)
        draw.text((410, 620), "HASTINGS STREET", font=font(46), fill="#d1aa67")
    elif kind.startswith("random_box"):
        image = city_scene("DETROIT", "BLACK BOTTOM")
        draw = ImageDraw.Draw(image)
        color = "#ff214f" if kind.endswith("red") else "#145eff"
        draw.rectangle((790, 235, 1195, 405), fill=color, outline="white", width=8)
        text_center(draw, (992, 320), "X9Q7 TEMP", size=50, fill="white", stroke=2)
    elif kind in {"ai_reconstruction_photo", "ai_reconstruction_map"}:
        image = document_scene(
            "HISTORICAL DETROIT" if kind.endswith("photo") else "BLACK BOTTOM MAP",
            ["HASTINGS STREET", "PARADISE VALLEY", "DETROIT 1945"],
            "AI RECONSTRUCTION — NOT ARCHIVAL EVIDENCE",
        )
    elif kind == "auto_factory":
        image = document_scene("AUTO FACTORY FLOOR", ["ASSEMBLY LINE", "ENGINE BLOCKS", "SHIFT 2"], "FACTORY CONTEXT")
    elif kind == "jazz_club":
        image = city_scene("PARADISE JAZZ CLUB", "LIVE MUSIC TONIGHT")
    elif kind == "unrelated_factory_with_matching_caption":
        image = document_scene("AUTO FACTORY FLOOR", ["ASSEMBLY LINE", "ENGINE BLOCKS", "SHIFT 2"], "FACTORY CONTEXT")
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 615, 1180, 705), fill="#101010")
        text_center(draw, (640, 658), "HASTINGS STREET BUSINESSES", size=46, fill="white", stroke=3)
    elif kind == "caption_clipped_bottom":
        image = city_scene("DETROIT", "")
        draw = ImageDraw.Draw(image)
        draw.text((365, 688), "BLACK BOTTOM", font=font(70), fill="white", stroke_width=4, stroke_fill="black")
    elif kind == "caption_clipped_left":
        image = city_scene("", "")
        draw = ImageDraw.Draw(image)
        draw.text((-110, 70), "DETROIT 1951", font=font(84), fill="white", stroke_width=4, stroke_fill="black")
    elif kind == "good_planning_map":
        image = document_scene("DETROIT PLANNING MAP — 1951", ["BLACK BOTTOM", "HASTINGS STREET", "I-375 CORRIDOR"], "SOURCE: DETROIT CITY PLAN COMMISSION, 1951")
    elif kind == "good_directory":
        image = document_scene("DETROIT CITY DIRECTORY — 1948", ["HASTINGS ST. 1421 — BAKERY", "HASTINGS ST. 1435 — DRUG STORE", "HASTINGS ST. 1450 — THEATER"], "SOURCE: DETROIT CITY DIRECTORY, 1948")
    elif kind == "good_modern_detroit":
        image = city_scene("MODERN DETROIT", "I-375 CORRIDOR — CONTEXT ONLY")
    elif kind == "good_then_now":
        image = Image.new("RGB", FIXTURE_SIZE, "#ead7ae")
        draw = ImageDraw.Draw(image)
        draw.rectangle((640, 0, 1280, 720), fill="#2b80c5")
        draw.rectangle((0, 0, 640, 120), fill="#111")
        draw.rectangle((640, 0, 1280, 120), fill="#111")
        text_center(draw, (320, 58), "DETROIT — THEN", size=52, fill="white", stroke=2)
        text_center(draw, (960, 58), "DETROIT — NOW", size=52, fill="white", stroke=2)
        for index, x in enumerate(range(55, 600, 90)):
            height = 140 + (index % 3) * 55
            draw.rectangle((x, 570 - height, x + 62, 610), fill="#604f43", outline="#29201a", width=3)
        for index, x in enumerate(range(695, 1240, 90)):
            height = 140 + ((index + 1) % 3) * 55
            draw.rectangle((x, 570 - height, x + 62, 610), fill="#263746", outline="#ffe075", width=3)
        draw.rectangle((40, 625, 600, 685), fill="#1a2028")
        draw.rectangle((680, 625, 1240, 685), fill="#1a2028")
        text_center(draw, (320, 654), "SOURCE: DETROIT CITY ARCHIVE — 1948", size=24, fill="white")
        text_center(draw, (960, 654), "SAME HASTINGS STREET CORRIDOR", size=24, fill="white")
        draw.line((640, 0, 640, 720), fill="white", width=8)
    else:
        raise ValueError(f"unknown_visual_judge_fixture:{kind}")
    ensure_dir(target.parent)
    image.save(target, format="PNG", optimize=True)


def build_fixtures(suite: dict[str, Any], directory: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in suite.get("fixtures", []):
        if not isinstance(spec, dict):
            continue
        target = directory / f"{spec['id']}.png"
        render_fixture(spec, target)
        rows.append({**spec, "path": target, "sha256": sha256_file(target)})
    return rows


def cached_model_files() -> tuple[Path, Path]:
    candidates = [path for path in HF_REPO_CACHE.glob("snapshots/*/*.gguf") if path.is_file()]
    if not candidates:
        raise RuntimeError("qwen3_vl_gguf_cache_missing")
    projectors = [path for path in candidates if "mmproj" in path.name.lower()]
    models = [path for path in candidates if path not in projectors]
    if not models or not projectors:
        raise RuntimeError("qwen3_vl_model_or_mmproj_missing")
    return max(models, key=lambda path: path.stat().st_size), max(projectors, key=lambda path: path.stat().st_size)


def content_address(path: Path) -> str:
    resolved = path.resolve()
    if re.fullmatch(r"[0-9a-f]{64}", resolved.name):
        return resolved.name
    return sha256_file(resolved)


def parse_json_object(output: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for match in reversed(list(re.finditer(r"\{", output))):
        try:
            value, _end = decoder.raw_decode(output[match.start() :])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise RuntimeError("local_visual_judge_json_missing")


def normalize_hard_failures(value: Any) -> list[str]:
    """Normalize only explicit no-failure sentinels emitted by local VLMs.

    JSON schemas reliably constrain the field to an array, but local models
    sometimes return ``["none"]`` instead of ``[]``. Treat those exact benign
    sentinels as empty while preserving every substantive failure verbatim.
    """
    values = value if isinstance(value, list) else ([value] if isinstance(value, str) else [])
    benign = {"none", "no hard failure", "no hard failures", "n/a", "na", "not applicable", "[]"}
    result: list[str] = []
    for item in values:
        text = str(item).strip()
        normalized = re.sub(r"[.!]+$", "", text.lower()).strip()
        if not text or normalized in benign:
            continue
        result.append(text)
    return sorted(set(result))


def normalize_judgment(parsed: dict[str, Any]) -> dict[str, Any]:
    if "hard_failures" not in parsed:
        return parsed
    return {**parsed, "hard_failures": normalize_hard_failures(parsed.get("hard_failures"))}


def run_model(
    image: Path,
    prompt: str,
    schema: str,
    *,
    timeout: int,
    use_cache: bool = True,
    maximum_output_tokens: int = 1024,
) -> tuple[dict[str, Any], float, str, str]:
    executable = shutil.which("llama-mtmd-cli") or "/opt/homebrew/bin/llama-mtmd-cli"
    if not Path(executable).is_file():
        raise RuntimeError("llama_mtmd_cli_missing")
    model, mmproj = cached_model_files()
    cache_key = hashlib.sha256(
        "\0".join(
            [
                MODEL_ID,
                content_address(model),
                content_address(mmproj),
                sha256_file(image),
                hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                hashlib.sha256(schema.encode("utf-8")).hexdigest(),
                qa_contract_hash(),
            ]
        ).encode("utf-8")
    ).hexdigest()
    cache_path = ensure_dir(BASE / "local-output" / "qa" / "qwen3-vl-cache") / f"{cache_key}.json"
    if use_cache:
        cached = read_json(cache_path)
        if cached.get("cache_key") == cache_key and isinstance(cached.get("parsed"), dict):
            return (
                normalize_judgment(cached["parsed"]),
                float(cached.get("model_elapsed_seconds", 0)),
                str(cached.get("output_sha256") or ""),
                "hash_verified_local_cache_hit",
            )
    command = [
        executable,
        "--offline",
        "-m",
        str(model),
        "--mmproj",
        str(mmproj),
        "--image",
        str(image),
        "--image-min-tokens",
        "1024",
        "-c",
        "4096",
        "--fit",
        "off",
        "-p",
        prompt,
        "-n",
        str(maximum_output_tokens),
        "--temp",
        "0",
        "--seed",
        "17",
        "--jinja",
        "--no-warmup",
        "-j",
        schema,
    ]
    started = time.monotonic()
    result = subprocess.run(command, cwd=BASE.parent, capture_output=True, text=True, timeout=timeout, check=False)
    backend = "default_local_backend"
    failure_text = f"{result.stderr}\n{result.stdout}".lower()
    metal_init_failed = any(
        marker in failure_text
        for marker in (
            "failed to create command queue",
            "ggml_backend_metal_device_init_backend",
            "failed to initialize  backend",
        )
    )
    if result.returncode != 0 and metal_init_failed:
        # Metal can temporarily refuse command-queue creation after long media
        # renders.  The quality judge must fail over explicitly to CPU rather
        # than skip QA or silently substitute a weaker model.
        command = [
            executable,
            "--device",
            "none",
            "--gpu-layers",
            "0",
            "--no-op-offload",
            *command[1:],
        ]
        backend = "explicit_cpu_fallback_after_metal_init_failure"
        result = subprocess.run(command, cwd=BASE.parent, capture_output=True, text=True, timeout=timeout, check=False)
    elapsed = time.monotonic() - started
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-1200:].replace("\n", " ")
        raise RuntimeError(f"local_visual_judge_failed:{result.returncode}:{detail}")
    try:
        parsed = normalize_judgment(parse_json_object(result.stdout))
    except RuntimeError as exc:
        finish_reason = "token_budget_exhausted" if len(result.stdout) > 200 else "empty_or_invalid_model_output"
        raise RuntimeError(
            f"{exc}:{finish_reason}:output_bytes={len(result.stdout)}:maximum_output_tokens={maximum_output_tokens}"
        ) from exc
    output_hash = hashlib.sha256(result.stdout.encode("utf-8")).hexdigest()
    cache_path.write_text(
        json.dumps(
            {
                "cache_key": cache_key,
                "created_at": utc_now(),
                "model_id": MODEL_ID,
                "model_sha256": content_address(model),
                "mmproj_sha256": content_address(mmproj),
                "image_sha256": sha256_file(image),
                "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "schema_sha256": hashlib.sha256(schema.encode("utf-8")).hexdigest(),
                "qa_contract_sha256": qa_contract_hash(),
                "parsed": parsed,
                "model_elapsed_seconds": round(elapsed, 3),
                "output_sha256": output_hash,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return parsed, elapsed, output_hash, f"backend={backend} " + " ".join(command[:9] + ["<model-and-prompt-redacted>"])


def benchmark_prompt(spec: dict[str, Any]) -> str:
    return (
        "You are the strict final visual QA judge for Pattern Lab, a source-backed city-history channel. "
        "Judge the supplied image against the narration and intended visual role. "
        "Mentally remove subtitles, captions, labels, and editorial callouts before judging narration match. "
        "Overlay text may never rescue an unrelated underlying image. "
        "Reject wrong city or entity, dim or flat imagery, unreadable or clipped text, random text boxes, "
        "AI reconstruction presented as archival proof, or a visual that does not match the narration. "
        "Accept only a clear, role-appropriate, mobile-readable frame with no hard defect. "
        f"Narration: {spec.get('narration', '')} Intended role: {spec.get('role', '')}. "
        "Return only the requested JSON object."
    )


def deterministic_fixture_checks(spec: dict[str, Any], image_path: Path) -> tuple[list[str], dict[str, Any]]:
    """Measure defects a VLM should not be trusted to estimate from prose alone."""
    policy = load_media_policy()
    rendered_policy = policy.get("rendered_media", {})
    thumbnail_policy = policy.get("thumbnail", {})
    blockers: list[str] = []
    measurements: dict[str, Any] = {}
    with Image.open(image_path) as source:
        rgb = source.convert("RGB")
        gray = rgb.convert("L")
        stat = ImageStat.Stat(gray)
        mean_luma = float(stat.mean[0]) / 255.0
        luma_std = float(stat.stddev[0]) / 255.0
        measurements.update({"mean_luma": round(mean_luma, 4), "luma_standard_deviation": round(luma_std, 4)})
        if mean_luma < float(rendered_policy.get("minimum_frame_mean_luma", 0.2)):
            blockers.append("dim_or_flat_image:mean_luma")
        if luma_std < float(rendered_policy.get("minimum_frame_luma_standard_deviation", 0.1)):
            blockers.append("dim_or_flat_image:contrast")
        required_text = [str(item) for item in spec.get("required_visible_text", [])]
        if required_text:
            shelf = rgb.resize((320, 180), Image.Resampling.LANCZOS)
            ocr = ocr_measurement(shelf, required_text, thumbnail_policy)
            measurements["mobile_ocr_320x180"] = ocr
            if float(ocr.get("word_recall", 0)) < 1.0:
                blockers.append("unreadable_or_clipped_text:mobile_ocr")
            if ocr.get("unsafe_large_text_boxes"):
                blockers.append("unreadable_or_clipped_text:safe_margin")
    return sorted(set(blockers)), measurements


def reusable_benchmark(video_id: str, suite_path: Path, approval: Path) -> tuple[dict[str, Any], Path] | None:
    global_path = BASE / "local-output" / "qa" / "local-visual-model-benchmark-receipt.json"
    receipt = read_json(global_path)
    if (
        not receipt
        or receipt.get("benchmark_suite_sha256") != sha256_file(suite_path)
        or receipt.get("qa_contract_sha256") != qa_contract_hash()
    ):
        return None
    try:
        model, mmproj = cached_model_files()
    except RuntimeError:
        return None
    if receipt.get("model_sha256") != content_address(model) or receipt.get("mmproj_sha256") != content_address(mmproj):
        return None
    expected_ids = {str(row.get("id")) for row in read_json(suite_path).get("fixtures", []) if isinstance(row, dict)}
    result_rows = [row for row in receipt.get("fixture_results", []) if isinstance(row, dict)]
    if {str(row.get("fixture_id")) for row in result_rows} != expected_ids:
        return None
    for row in result_rows:
        path = Path(str(row.get("fixture_path") or ""))
        path = path if path.is_absolute() else BASE / path
        if not path.is_file() or row.get("fixture_sha256") != sha256_file(path):
            return None
    cloned = {**receipt, "video_id": video_id, "reused_hash_verified_global_benchmark": True}
    receipt_path = approval / "local-visual-model-benchmark-receipt.json"
    receipt_path.write_text(json.dumps(cloned, indent=2) + "\n", encoding="utf-8")
    return cloned, receipt_path


def run_benchmark(video_id: str, *, timeout: int, force: bool = False) -> tuple[dict[str, Any], Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    suite_path = BASE / "resources" / "visual-judge-benchmark-suite.json"
    if not force:
        reused = reusable_benchmark(video_id, suite_path, approval)
        if reused is not None:
            return reused
    suite = read_json(suite_path)
    fixture_dir = ensure_dir(BASE / "local-output" / "qa" / "visual-judge-fixtures")
    fixtures = build_fixtures(suite, fixture_dir)
    results: list[dict[str, Any]] = []
    elapsed_values: list[float] = []
    for spec in fixtures:
        parsed, elapsed, output_hash, command_summary = run_model(
            spec["path"], benchmark_prompt(spec), VERDICT_SCHEMA, timeout=timeout, use_cache=not force
        )
        vlm_verdict = str(parsed.get("verdict") or "").strip().lower()
        deterministic_blockers, measurements = deterministic_fixture_checks(spec, spec["path"])
        verdict = "reject" if deterministic_blockers else vlm_verdict
        elapsed_values.append(elapsed)
        results.append(
            {
                "fixture_id": spec["id"],
                "category": spec["category"],
                "expected": spec["expected"],
                "verdict": verdict,
                "vlm_verdict": vlm_verdict,
                "correct": verdict == spec["expected"],
                "reason": str(parsed.get("reason") or "")[:500],
                "deterministic_blockers": deterministic_blockers,
                "deterministic_measurements": measurements,
                "fixture_path": display_path(spec["path"]),
                "fixture_sha256": spec["sha256"],
                "output_sha256": output_hash,
                "elapsed_seconds": round(elapsed, 3),
                "command_summary": command_summary,
            }
        )
    model, mmproj = cached_model_files()
    correct = sum(1 for row in results if row["correct"])
    deterministic_categories = set(read_json(BASE / "resources" / "local-visual-model-benchmark-policy.json").get("acceptance", {}).get("deterministic_measurement_categories", []))
    semantic_rows = [row for row in results if row.get("category") not in deterministic_categories]
    semantic_correct = sum(1 for row in semantic_rows if row.get("vlm_verdict") == row.get("expected"))
    receipt = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "model_id": MODEL_ID,
        "model_role": "final_local_judge",
        "local_only": True,
        "fallback_model_used": False,
        "model_path": display_path(model),
        "model_sha256": content_address(model),
        "model_size_bytes": model.stat().st_size,
        "mmproj_path": display_path(mmproj),
        "mmproj_sha256": content_address(mmproj),
        "benchmark_suite_sha256": sha256_file(suite_path),
        "qa_contract_sha256": qa_contract_hash(),
        "fixture_accuracy": round(correct / len(results), 4) if results else 0.0,
        "semantic_vlm_fixture_accuracy": round(semantic_correct / len(semantic_rows), 4) if semantic_rows else 0.0,
        "semantic_vlm_fixture_count": len(semantic_rows),
        "median_seconds_per_frame": round(statistics.median(elapsed_values), 3) if elapsed_values else None,
        "fixture_results": results,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    receipt_path = approval / "local-visual-model-benchmark-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    global_path = ensure_dir(BASE / "local-output" / "qa") / "local-visual-model-benchmark-receipt.json"
    global_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt, receipt_path


def parse_srt_timestamp(value: str) -> float:
    hours, minutes, tail = value.split(":")
    seconds, millis = tail.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_srt(path: Path) -> list[dict[str, Any]]:
    blocks = re.split(r"\n\s*\n", path.read_text(encoding="utf-8", errors="replace").strip())
    rows: list[dict[str, Any]] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        timing_index = next((index for index, line in enumerate(lines) if " --> " in line), None)
        if timing_index is None:
            continue
        start, end = lines[timing_index].split(" --> ", 1)
        rows.append({"start": parse_srt_timestamp(start), "end": parse_srt_timestamp(end), "text": " ".join(lines[timing_index + 1 :])})
    return rows


def narration_at(captions: list[dict[str, Any]], timestamp: float) -> str:
    nearby = [row["text"] for row in captions if row["start"] <= timestamp + 2.0 and row["end"] >= timestamp - 2.0]
    return " ".join(nearby)[:900]


def beat_at(beats: list[dict[str, Any]], timestamp: float) -> dict[str, Any]:
    for beat in beats:
        if float(beat.get("start_seconds", -1)) <= timestamp < float(beat.get("end_seconds", -1)):
            return beat
    return {}


def sample_timestamps(duration: float, first_interval: float, remainder_interval: float) -> list[float]:
    values: set[float] = {0.0, max(0.0, duration - 0.1)}
    current = 0.0
    while current <= min(duration, 30.0):
        values.add(round(current, 3))
        current += first_interval
    current = 30.0
    while current <= duration:
        values.add(round(current, 3))
        current += remainder_interval
    return sorted(value for value in values if 0 <= value < duration)


def final_prompt(narration: str, beat: dict[str, Any]) -> str:
    role = str(beat.get("role") or "[missing]")
    return (
        "You are the strict final frame QA judge for Pattern Lab. A score of 93 means release quality; "
        "92 or lower means repair. Score every dimension independently. Reject or score below 93 for any "
        "wrong/misleading visual, weak narration match, dim/flat/blurred image, unreadable/clipped caption, "
        "random text box, unsupported AI reconstruction, role-required missing proof visibility, or weak mobile composition. "
        "Do not reward a frame merely because it is the best available. Mentally ignore subtitles, captions, "
        "source labels, and editorial callouts when judging narration match; overlay text can never rescue an "
        "unrelated underlying image. Reject source title cards, horizontal split/wrap artifacts, duplicated strips, "
        "or a frame whose image would be wrong if every text overlay disappeared. "
        "Apply the planned role exactly: source_proof, map_system, document_detail, and then_now require visible "
        "claim evidence. A context_only frame does not need to prove a named place or statistic; it passes when the "
        "underlying image honestly and strongly depicts the narrated action, human consequence, object class, era, "
        "or city context without pretending to be direct proof. For context_only, evidence_visibility measures "
        "role honesty and visible relevance, not exact-location proof. Do not penalize an honest context_only frame "
        "solely because it is not location proof. "
        "When the narration explicitly asks for names, labels, or a list to appear on screen, the planned editorial "
        "callout may satisfy that textual request only when the underlying image remains strongly relevant; it still "
        "cannot rescue an unrelated image. "
        f"Narration near this frame: {narration or '[missing]'}. "
        f"Planned role: {role}. Planned source label: {beat.get('source_label', '[missing]')}. "
        f"Planned editorial callout: {beat.get('editorial_callout', '[none]') or '[none]'}. "
        f"Claim ids: {', '.join(str(item) for item in beat.get('claim_ids', [])) or '[missing]'}. "
        "Allowed hard failures are wrong_or_unmatched_visual, dim_or_flat_image, blurred_or_corrupt_image, "
        "unreadable_or_clipped_text, unexpected_large_text_or_box, unknown_rights, and ai_support_presented_as_evidence. "
        "Keep the reason under 30 words. Return only the requested JSON object."
    )


def run_final_judge(video_id: str, *, timeout: int) -> tuple[dict[str, Any], Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    video = root / "video" / f"pattern-lab-video-{video_id}-draft.mp4"
    captions_path = root / "captions" / "word-aligned.srt"
    render_plan = read_json(approval / "canonical-render-plan.json")
    benchmark = read_json(approval / "local-visual-model-benchmark-report.json")
    if benchmark.get("status") != "pass":
        raise RuntimeError("local_visual_model_benchmark_not_pass")
    if not video.is_file():
        raise RuntimeError("canonical_rendered_video_missing")
    if not captions_path.is_file():
        raise RuntimeError("word_aligned_captions_missing")
    if render_plan.get("status") != "pass" or not render_plan.get("beats"):
        raise RuntimeError("canonical_render_plan_not_pass")
    policy = load_media_policy().get("visual_judge", {})
    timestamps = sample_timestamps(
        media_duration_seconds(video),
        float(policy.get("maximum_first_30_seconds_gap", 2.0)),
        float(policy.get("maximum_remainder_gap", 5.0)),
    )
    captions = parse_srt(captions_path)
    frames_dir = ensure_dir(root / "approval" / "local-visual-judge-frames")
    progress_path = approval / "local-visual-judge-progress.json"
    frames: list[dict[str, Any]] = []
    model, mmproj = cached_model_files()
    video_sha = sha256_file(video)
    plan_sha = sha256_file(approval / "canonical-render-plan.json")
    captions_sha = sha256_file(captions_path)
    contract_sha = qa_contract_hash()
    previous_progress = read_json(progress_path)
    reusable_rows: dict[str, dict[str, Any]] = {}
    if (
        previous_progress.get("video_render_sha256") == video_sha
        and previous_progress.get("canonical_render_plan_sha256") == plan_sha
        and previous_progress.get("captions_sha256") == captions_sha
        and previous_progress.get("qa_contract_sha256") == contract_sha
    ):
        for row in previous_progress.get("frames", []):
            if not isinstance(row, dict):
                continue
            path = Path(str(row.get("path") or ""))
            path = path if path.is_absolute() else BASE / path
            key = f"{float(row.get('timestamp_seconds', -1)):.3f}"
            if path.is_file() and row.get("sha256") == sha256_file(path):
                reusable_rows[key] = row
    for index, timestamp in enumerate(timestamps, start=1):
        timestamp_key = f"{timestamp:.3f}"
        if timestamp_key in reusable_rows:
            frames.append(reusable_rows[timestamp_key])
            continue
        frame_path = frames_dir / f"frame-{index:04d}-{timestamp:09.3f}.jpg"
        subprocess.run(
            [ffmpeg_cmd(), "-y", "-ss", f"{timestamp:.3f}", "-i", str(video), "-frames:v", "1", "-q:v", "2", str(frame_path)],
            capture_output=True,
            check=True,
        )
        beat = beat_at(render_plan.get("beats", []), timestamp)
        parsed, elapsed, output_hash, _command = run_model(
            frame_path,
            final_prompt(narration_at(captions, timestamp), beat),
            FRAME_SCHEMA,
            timeout=timeout,
            maximum_output_tokens=2048,
        )
        dimensions = {
            name: int(parsed.get(name, 0))
            for name in [
                "narration_match",
                "evidence_visibility",
                "visual_variety",
                "motion_and_composition",
                "typography_and_caption_safety",
            ]
        }
        frames.append(
            {
                "beat_id": str(beat.get("beat_id") or f"sample-{index:04d}"),
                "timestamp_seconds": round(timestamp, 3),
                "path": display_path(frame_path),
                "sha256": sha256_file(frame_path),
                "score": int(parsed.get("score", 0)),
                "dimension_scores": dimensions,
                "hard_failures": normalize_hard_failures(parsed.get("hard_failures")),
                "reason": str(parsed.get("reason") or "")[:800],
                "output_sha256": output_hash,
                "elapsed_seconds": round(elapsed, 3),
            }
        )
        progress_path.write_text(
            json.dumps(
                {
                    "generated_at": utc_now(),
                    "status": "running",
                    "video_id": video_id,
                    "judge_model": MODEL_ID,
                    "video_render_sha256": video_sha,
                    "canonical_render_plan_sha256": plan_sha,
                    "captions_sha256": captions_sha,
                    "qa_contract_sha256": contract_sha,
                    "completed_frame_count": len(frames),
                    "required_frame_count": len(timestamps),
                    "frames": frames,
                    "paid_provider_calls": "not_performed",
                    "youtube_mutation": "not_performed",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    receipt = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "judge_model": MODEL_ID,
        "judge_mode": "local",
        "judge_model_sha256": content_address(model),
        "judge_mmproj_sha256": content_address(mmproj),
        "video_render_sha256": video_sha,
        "canonical_render_plan_sha256": plan_sha,
        "captions_sha256": captions_sha,
        "qa_contract_sha256": contract_sha,
        "frames": frames,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    receipt_path = approval / "local-visual-judge-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    progress_path.write_text(
        json.dumps({**receipt, "status": "complete", "completed_frame_count": len(frames)}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return receipt, receipt_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline Pattern Lab local visual judge.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--benchmark", action="store_true")
    parser.add_argument("--judge-final", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--force-benchmark", action="store_true")
    args = parser.parse_args()
    video_id = args.video_id.zfill(2)
    if not args.benchmark and not args.judge_final:
        raise SystemExit("Choose --benchmark and/or --judge-final.")
    if args.benchmark:
        receipt, path = run_benchmark(video_id, timeout=args.timeout_seconds, force=args.force_benchmark)
        print(f"Benchmark accuracy: {receipt['fixture_accuracy']:.4f}")
        print(f"Benchmark receipt: {display_path(path)}")
    if args.judge_final:
        receipt, path = run_final_judge(video_id, timeout=args.timeout_seconds)
        print(f"Frames judged: {len(receipt['frames'])}")
        print(f"Visual judge receipt: {display_path(path)}")
    print("Paid provider calls: not_performed")
    print("YouTube mutation: not_performed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import csv
import json
import os
import subprocess
from pathlib import Path

from patternlab_common import append_ledger, display_path, ensure_dir, ffprobe_cmd, output_root, utc_now, BASE


IMAGE_WIDTH = 1920
IMAGE_HEIGHT = 1080
ALLOWED_IMAGE_DIMENSIONS = {(1920, 1080), (1280, 720)}
CODEX_IMAGE_TOOL = "Codex image generation"
# OpenAI Images API is retained only as the backup image source; Codex remains primary.
OPENAI_IMAGE_TOOL = "OpenAI Images API"
LOCAL_THUMBNAIL_FACTORY_TOOL = "Pattern Lab repo-local thumbnail factory"
ALLOWED_IMAGE_TOOLS = {CODEX_IMAGE_TOOL, OPENAI_IMAGE_TOOL, LOCAL_THUMBNAIL_FACTORY_TOOL}
ALLOWED_REVIEW_STATUSES = {"pending", "approved"}
REQUIRED_IMAGE_SPECS = [
    ("thumbnail_candidate_a.png", "thumbnail"),
    ("thumbnail_candidate_b.png", "thumbnail"),
    ("thumbnail_candidate_c.png", "thumbnail"),
    ("city_source_map.png", "image"),
    ("archival_evidence_board.png", "image"),
    ("then_now_structure.png", "image"),
    ("subscribe_city_file_card.png", "image"),
]
REQUIRED_IMAGE_FILENAMES = [filename for filename, _asset_type in REQUIRED_IMAGE_SPECS]
TRUE_VALUES = {"1", "true", "yes", "on"}


def required_asset_type(filename):
    for required_filename, asset_type in REQUIRED_IMAGE_SPECS:
        if filename == required_filename:
            return asset_type
    return "thumbnail" if filename.startswith("thumbnail") else "image"


def env_configured(name):
    value = os.environ.get(name, "").strip()
    return bool(value) and value != "replace_me"


def env_flag(name):
    return os.environ.get(name, "").strip().lower() in TRUE_VALUES


def openai_backup_policy(live_requested=False):
    available = env_configured("OPENAI_API_KEY")
    enabled = live_requested or env_flag("PATTERNLAB_OPENAI_BACKUP") or env_flag("PATTERNLAB_LIVE_IMAGES")
    return {
        "available": available,
        "enabled": enabled,
        "can_run": available and enabled,
    }


def image_dir(root):
    return Path(root) / "images"


def approval_dir(root):
    return ensure_dir(Path(root) / "approval")


def ledger_path(root):
    return Path(root) / "rights-ledger.csv"


def load_ledger_rows(root):
    path = ledger_path(root)
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def matching_ledger_row(rows, filename):
    matches = [row for row in rows if Path(row.get("filename", "")).name == filename]
    return matches[-1] if matches else None


def generated_asset_rights_fields(root, filename, prompt_file, service_label, prompt_excerpt=""):
    source_file = str(Path(prompt_file).relative_to(BASE))
    local_path = str((image_dir(root) / filename).relative_to(root))
    attribution = "Pattern Lab original generated graphic; no external attribution required."
    notes = "Original Pattern Lab city-history graphic; not archival evidence."
    if prompt_excerpt:
        notes = f"{notes} Prompt excerpt: {prompt_excerpt[:140]}"
    return {
        "local_path": local_path,
        "source_title": Path(filename).stem.replace("_", " "),
        "source_url": source_file,
        "creator": "Pattern Lab",
        "archive_or_platform": "Pattern Lab",
        "source_class": "original_graphic",
        "license_or_rights_basis": "original Pattern Lab generated asset; owner review required before public use",
        "license_status": "owner-reviewed original Pattern Lab generated asset",
        "attribution_required": "no",
        "attribution_text": attribution,
        "commercial_use_ok": "yes",
        "modification_ok": "yes",
        "recognizable_people_property_trademark_risk": "none logged; owner review still required",
        "ai_reconstruction_disclosure": f"{service_label} original graphic; not archival evidence",
        "notes": notes,
    }


def image_dimensions(path):
    result = subprocess.run(
        [
            ffprobe_cmd(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    width_text, height_text = result.stdout.strip().split("x", 1)
    return int(width_text), int(height_text)


def file_status(root, filename):
    path = image_dir(root) / filename
    status = {
        "filename": filename,
        "path": display_path(path),
        "exists": path.exists(),
        "non_empty": False,
        "is_png": path.suffix.lower() == ".png",
        "dimensions": "",
        "valid": False,
        "reason": "",
    }
    if not path.exists():
        status["reason"] = "missing"
        return status
    try:
        status["non_empty"] = path.stat().st_size > 0
    except OSError as exc:
        status["reason"] = f"stat failed: {exc}"
        return status
    if not status["non_empty"]:
        status["reason"] = "empty file"
        return status
    if not status["is_png"]:
        status["reason"] = "not a PNG file"
        return status
    try:
        width, height = image_dimensions(path)
    except Exception as exc:
        status["reason"] = f"dimension probe failed: {exc}"
        return status
    status["dimensions"] = f"{width}x{height}"
    if (width, height) not in ALLOWED_IMAGE_DIMENSIONS:
        allowed = " or ".join(f"{item_width}x{item_height}" for item_width, item_height in sorted(ALLOWED_IMAGE_DIMENSIONS))
        status["reason"] = f"expected {allowed}, got {width}x{height}"
        return status
    status["valid"] = True
    status["reason"] = "ok"
    return status


def validate_image_pack(root):
    root = Path(root)
    rows = load_ledger_rows(root)
    files = [file_status(root, filename) for filename in REQUIRED_IMAGE_FILENAMES]
    missing_images = [item["filename"] for item in files if item["reason"] == "missing"]
    invalid_images = [
        {"filename": item["filename"], "reason": item["reason"]}
        for item in files
        if item["exists"] and not item["valid"]
    ]
    ledger_missing = []
    ledger_invalid = []
    tools = {}
    for filename, asset_type in REQUIRED_IMAGE_SPECS:
        row = matching_ledger_row(rows, filename)
        if not row:
            ledger_missing.append(filename)
            continue
        tools[filename] = row.get("tool", "")
        if row.get("asset_type") != asset_type:
            ledger_invalid.append(
                {
                    "filename": filename,
                    "reason": f"asset_type expected {asset_type}, got {row.get('asset_type', '')}",
                }
            )
        if row.get("tool") not in ALLOWED_IMAGE_TOOLS:
            ledger_invalid.append(
                {
                    "filename": filename,
                    "reason": f"tool must be {CODEX_IMAGE_TOOL} or {OPENAI_IMAGE_TOOL}",
                }
            )
        if row.get("tool") == CODEX_IMAGE_TOOL and row.get("human_review_status", "").lower() not in ALLOWED_REVIEW_STATUSES:
            ledger_invalid.append(
                {
                    "filename": filename,
                    "reason": "Codex image human_review_status must be pending or approved",
                }
            )
    valid_files = not missing_images and not invalid_images
    valid_ledger = not ledger_missing and not ledger_invalid
    usable_valid = valid_files and valid_ledger
    required_tools = [tools.get(filename, "") for filename in REQUIRED_IMAGE_FILENAMES]
    tool_set = {tool for tool in required_tools if tool}
    if not usable_valid:
        selected_source = "none"
    elif tool_set == {CODEX_IMAGE_TOOL}:
        selected_source = "codex"
    elif tool_set == {OPENAI_IMAGE_TOOL}:
        selected_source = "openai"
    elif tool_set.issubset(ALLOWED_IMAGE_TOOLS):
        selected_source = "mixed"
    else:
        selected_source = "unknown"
    return {
        "generated_at": utc_now(),
        "required_dimensions": " or ".join(f"{width}x{height}" for width, height in sorted(ALLOWED_IMAGE_DIMENSIONS)),
        "required_images": REQUIRED_IMAGE_FILENAMES,
        "file_status": files,
        "missing_images": missing_images,
        "invalid_images": invalid_images,
        "ledger_missing": ledger_missing,
        "ledger_invalid": ledger_invalid,
        "valid_files": valid_files,
        "valid_ledger": valid_ledger,
        "usable_valid": usable_valid,
        "codex_pack_valid": usable_valid and selected_source == "codex",
        "openai_pack_valid": usable_valid and selected_source == "openai",
        "selected_source": selected_source,
        "backup_needed": sorted(set(missing_images + [item["filename"] for item in invalid_images])),
    }


def record_codex_image_pack(root, video_id, prompt_file, dry_run=False):
    root = Path(root)
    recorded = []
    skipped = []
    for filename, asset_type in REQUIRED_IMAGE_SPECS:
        status = file_status(root, filename)
        if not status["valid"]:
            skipped.append({"filename": filename, "reason": status["reason"]})
            continue
        recorded.append(filename)
        if dry_run:
            continue
        append_ledger(
            root,
            {
                "asset_id": f"video-{video_id}-codex-image-{Path(filename).stem}",
                "asset_type": asset_type,
                "filename": str((image_dir(root) / filename).relative_to(root)),
                "tool": CODEX_IMAGE_TOOL,
                "model_or_service": "Codex image generation",
                "source_prompt_or_source_file": str(Path(prompt_file).relative_to(BASE)),
                **generated_asset_rights_fields(root, filename, prompt_file, "Codex image generation"),
                "created_at": utc_now(),
                "human_review_required": "yes",
                "human_review_status": "pending",
            },
        )
    return {"recorded": recorded, "skipped": skipped}


def add_openai_backup_ledger_row(root, video_id, prompt_file, filename, model, prompt):
    append_ledger(
        root,
        {
            "asset_id": f"video-{video_id}-openai-backup-image-{Path(filename).stem}",
            "asset_type": required_asset_type(filename),
            "filename": str((image_dir(root) / filename).relative_to(root)),
            "tool": OPENAI_IMAGE_TOOL,
            "model_or_service": model,
            "source_prompt_or_source_file": str(Path(prompt_file).relative_to(BASE)),
            **generated_asset_rights_fields(root, filename, prompt_file, "OpenAI Images API", prompt),
            "created_at": utc_now(),
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )


def write_image_source_report(root, video_id, report, backup_available=False, backup_enabled=False, backup_used=None):
    root = Path(root)
    backup_used = backup_used or []
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "selected_source": report.get("selected_source", "none"),
        "usable_valid": report.get("usable_valid", False),
        "codex_pack_valid": report.get("codex_pack_valid", False),
        "openai_pack_valid": report.get("openai_pack_valid", False),
        "missing_images": report.get("missing_images", []),
        "invalid_images": report.get("invalid_images", []),
        "ledger_missing": report.get("ledger_missing", []),
        "ledger_invalid": report.get("ledger_invalid", []),
        "backup_available": backup_available,
        "backup_enabled": backup_enabled,
        "backup_used": backup_used,
        "backup_needed": report.get("backup_needed", []),
    }
    if payload["usable_valid"]:
        next_action = "Image pack is valid; build can use these images."
    elif backup_available and backup_enabled:
        next_action = "Run OpenAI backup generation for the missing or invalid images."
    elif backup_available:
        next_action = "OpenAI backup key is configured; enable live image backup if Codex images are unavailable."
    else:
        next_action = "Generate or import the Codex image pack, or configure OpenAI backup before building video media."
    payload["next_action"] = next_action
    out = approval_dir(root)
    (out / "image-source-report.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Image Source Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Selected source: {payload['selected_source']}",
        f"Usable image pack: {'yes' if payload['usable_valid'] else 'no'}",
        f"Codex pack valid: {'yes' if payload['codex_pack_valid'] else 'no'}",
        f"OpenAI backup available: {'yes' if payload['backup_available'] else 'no'}",
        f"OpenAI backup enabled this run: {'yes' if payload['backup_enabled'] else 'no'}",
        "",
        "## Required Contract",
        "",
        f"- Required files: {', '.join(REQUIRED_IMAGE_FILENAMES)}",
        f"- Dimensions: {IMAGE_WIDTH}x{IMAGE_HEIGHT}",
        f"- Codex tool row: {CODEX_IMAGE_TOOL}",
        f"- OpenAI backup tool row: {OPENAI_IMAGE_TOOL}",
        "- Thumbnail asset_type: thumbnail",
        "- Non-thumbnail asset_type: image",
        "",
        "## Problems",
        "",
        *([f"- Missing image: {name}" for name in payload["missing_images"]] or ["- Missing images: none"]),
        *([f"- Invalid image: {item['filename']} ({item['reason']})" for item in payload["invalid_images"]] or ["- Invalid images: none"]),
        *([f"- Missing ledger row: {name}" for name in payload["ledger_missing"]] or ["- Missing ledger rows: none"]),
        *(
            [f"- Invalid ledger row: {item['filename']} ({item['reason']})" for item in payload["ledger_invalid"]]
            or ["- Invalid ledger rows: none"]
        ),
        "",
        "## Backup Use",
        "",
        *([f"- Generated with OpenAI backup: {name}" for name in payload["backup_used"]] or ["- OpenAI backup generated: none"]),
        "",
        "## Next Action",
        "",
        f"- {next_action}",
        "",
    ]
    (out / "image-source-report.md").write_text("\n".join(lines), encoding="utf-8")
    return payload


def validate_output_root(video_id):
    return validate_image_pack(output_root(video_id))

#!/usr/bin/env python3
import csv
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]


LEDGER_FIELDS = [
    "asset_id",
    "asset_type",
    "filename",
    "local_path",
    "tool",
    "model_or_service",
    "source_prompt_or_source_file",
    "source_title",
    "source_url",
    "creator",
    "archive_or_platform",
    "source_class",
    "license_or_rights_basis",
    "license_status",
    "attribution_required",
    "attribution_text",
    "commercial_use_ok",
    "modification_ok",
    "recognizable_people_property_trademark_risk",
    "ai_reconstruction_disclosure",
    "created_at",
    "notes",
    "human_review_required",
    "human_review_status",
]


LOCAL_ORIGINAL_TOOLS = {
    "Codex image generation",
    "OpenAI Images API",
    "Local AppKit vector render",
    "Pattern Lab daily factory",
    "FFmpeg",
}


def _truthy_text(value):
    return str(value or "").strip()


def _ledger_source_title(row):
    for key in ("source_title", "notes", "filename", "asset_id"):
        value = _truthy_text(row.get(key))
        if value:
            return value
    return "Pattern Lab asset"


def _ledger_source_url(row):
    for key in ("source_url", "source_prompt_or_source_file", "filename"):
        value = _truthy_text(row.get(key))
        if value:
            return value
    return "Pattern Lab local source"


def _infer_source_class(row):
    existing = _truthy_text(row.get("source_class"))
    if existing:
        return existing
    asset_type = _truthy_text(row.get("asset_type")).lower()
    notes = " ".join(
        _truthy_text(row.get(key)).lower()
        for key in ("notes", "license_status", "license_or_rights_basis", "source_title")
    )
    if "reconstruction" in notes:
        return "ai_reconstruction" if "ai" in notes else "original_graphic"
    if asset_type in {"voiceover", "music", "sound_effect", "sound_effects"}:
        return "original_audio"
    if asset_type in {"video", "short", "proof_footage"}:
        return "original_video"
    return "original_graphic"


def _infer_ai_disclosure(row, source_class):
    existing = _truthy_text(row.get("ai_reconstruction_disclosure"))
    if existing:
        return existing
    tool = _truthy_text(row.get("tool")).lower()
    notes = _truthy_text(row.get("notes")).lower()
    if source_class == "ai_reconstruction":
        return "labeled AI reconstruction; not archival evidence"
    if "codex" in tool or "openai" in tool or "ai" in notes:
        return "AI-assisted original graphic; not archival evidence"
    return "not_ai_reconstruction"


def normalize_ledger_row(row):
    normalized = {field: row.get(field, "") for field in LEDGER_FIELDS}
    filename = _truthy_text(normalized.get("filename"))
    tool = _truthy_text(normalized.get("tool"))
    source_class = _infer_source_class(normalized)
    license_basis = _truthy_text(normalized.get("license_or_rights_basis")) or _truthy_text(
        normalized.get("license_status")
    )
    if not license_basis:
        license_basis = "original Pattern Lab asset; rights review required before public use"

    normalized["local_path"] = _truthy_text(normalized.get("local_path")) or filename
    normalized["source_title"] = _ledger_source_title(normalized)
    normalized["source_url"] = _ledger_source_url(normalized)
    normalized["creator"] = _truthy_text(normalized.get("creator")) or "Pattern Lab"
    normalized["archive_or_platform"] = _truthy_text(normalized.get("archive_or_platform")) or (
        "Pattern Lab" if tool in LOCAL_ORIGINAL_TOOLS else tool or "Pattern Lab"
    )
    normalized["source_class"] = source_class
    normalized["license_or_rights_basis"] = license_basis
    normalized["license_status"] = _truthy_text(normalized.get("license_status")) or license_basis
    normalized["attribution_required"] = _truthy_text(normalized.get("attribution_required")) or "no"
    normalized["attribution_text"] = _truthy_text(normalized.get("attribution_text")) or (
        "Pattern Lab original asset; no external attribution required."
    )
    normalized["commercial_use_ok"] = _truthy_text(normalized.get("commercial_use_ok")) or "yes"
    normalized["modification_ok"] = _truthy_text(normalized.get("modification_ok")) or "yes"
    normalized["recognizable_people_property_trademark_risk"] = _truthy_text(
        normalized.get("recognizable_people_property_trademark_risk")
    ) or "none logged"
    normalized["ai_reconstruction_disclosure"] = _infer_ai_disclosure(normalized, source_class)
    normalized["human_review_required"] = _truthy_text(normalized.get("human_review_required")) or "yes"
    normalized["human_review_status"] = _truthy_text(normalized.get("human_review_status")) or "pending"
    return normalized


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_text(path):
    return Path(path).read_text(encoding="utf-8")


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def ensure_dir(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_dotenv(path=None):
    env_path = Path(path) if path else BASE / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name):
    value = os.environ.get(name, "").strip()
    if not value or value == "replace_me":
        raise SystemExit(f"Missing required env var: {name}")
    return value


def video_folder_name(video_id):
    return str(video_id) if str(video_id).startswith("video-") else f"video-{video_id}"


def output_root(video_id):
    output_name = video_folder_name(video_id)
    configured = os.environ.get("PATTERNLAB_OUTPUT_ROOT", "").strip()
    if configured and configured != "replace_me":
        configured = configured.format(video_id=video_id)
        root = Path(configured)
        if root.name == output_name or "{video_id}" in os.environ.get("PATTERNLAB_OUTPUT_ROOT", ""):
            if not root.is_absolute():
                root = BASE / root
            return root
    return BASE / "local-output" / output_name


def launch_root(video_id):
    return BASE / "launch" / video_folder_name(video_id)


def display_path(path):
    path = Path(path)
    try:
        return str(path.relative_to(BASE))
    except ValueError:
        return str(path)


def strip_markdown_for_voiceover(markdown):
    lines = []
    for raw in markdown.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue
        if line.startswith("- "):
            line = line[2:].strip()
        line = re.sub(r"`([^`]+)`", r"\1", line)
        line = re.sub(r"\*\*([^*]+)\*\*", r"\1", line)
        line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)
        lines.append(line)
    return "\n\n".join(lines).strip()


def ffmpeg_cmd():
    return shutil.which("ffmpeg") or "ffmpeg"


def ffprobe_cmd():
    return shutil.which("ffprobe") or "ffprobe"


def media_duration_seconds(path):
    result = subprocess.run(
        [
            ffprobe_cmd(),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def append_ledger(root, row):
    root = Path(root)
    ledger = root / "rights-ledger.csv"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    normalized = normalize_ledger_row(row)
    existing_rows = []
    if ledger.exists():
        with ledger.open(encoding="utf-8", newline="") as handle:
            existing_rows = list(csv.DictReader(handle))
    existing_rows = [
        existing
        for existing in existing_rows
        if not (
            existing.get("asset_id") == normalized.get("asset_id")
            and existing.get("asset_type") == normalized.get("asset_type")
            and existing.get("filename") == normalized.get("filename")
        )
    ]
    with ledger.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_FIELDS)
        writer.writeheader()
        for existing in existing_rows:
            writer.writerow(normalize_ledger_row(existing))
        writer.writerow(normalized)

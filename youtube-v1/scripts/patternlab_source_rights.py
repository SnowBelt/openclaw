#!/usr/bin/env python3
import argparse
import csv
import json
from collections import Counter
from pathlib import Path

from patternlab_common import BASE, LEDGER_FIELDS, display_path, ensure_dir, output_root, utc_now


POLICY_PATH = BASE / "resources" / "source-media-policy.json"
LOCAL_PLATFORM_MARKERS = {
    "pattern lab",
    "codex image generation",
    "openai images api",
    "local appkit vector render",
    "ffmpeg",
    "elevenlabs api",
}
REVIEW_STATUSES = {"pending", "approved", "rejected", "reference"}
YES_VALUES = {"yes", "true", "1", "y"}
NO_VALUES = {"no", "false", "0", "n"}
LOCAL_SOURCE_CLASSES = {"original_graphic", "ai_reconstruction", "original_audio", "original_video", "original_asset"}
PROOF_BEARING_ASSET_TYPES = {"artifact", "image", "proof_footage", "video"}
DISALLOWED_PATTERNS = [
    ("random image search", "random image search results are not rights-safe source records"),
    ("google image", "random image search results are not rights-safe source records"),
    ("bing image", "random image search results are not rights-safe source records"),
    ("watermarked", "watermarked stock previews are blocked"),
    ("watermark preview", "watermarked stock previews are blocked"),
    ("unlicensed youtube", "unlicensed YouTube clips are blocked"),
    ("youtube repost", "unlicensed YouTube clips are blocked"),
    ("tiktok", "TikTok reposts without explicit rights are blocked"),
    ("instagram", "Instagram reposts without explicit rights are blocked"),
    ("facebook repost", "Facebook reposts without explicit rights are blocked"),
    ("x repost", "X reposts without explicit rights are blocked"),
    ("twitter repost", "X/Twitter reposts without explicit rights are blocked"),
    ("editorial-only", "editorial-only stock assets are blocked for monetized public uploads"),
    ("editorial only", "editorial-only stock assets are blocked for monetized public uploads"),
    ("unclear rights", "assets with unclear rights basis are blocked"),
    ("rights unclear", "assets with unclear rights basis are blocked"),
]


def read_policy():
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def preferred_source_names(policy):
    names = set()
    for sources in policy.get("preferred_sources", {}).values():
        for source in sources:
            name = str(source.get("name", "")).strip().lower()
            if name:
                names.add(name)
    return names


def read_ledger(path):
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return reader.fieldnames or [], list(reader)


def compact_row_id(index, row):
    asset_id = str(row.get("asset_id", "")).strip()
    filename = str(row.get("filename", "")).strip()
    if asset_id and filename:
        return f"row {index}: {asset_id} ({filename})"
    if asset_id:
        return f"row {index}: {asset_id}"
    if filename:
        return f"row {index}: {filename}"
    return f"row {index}"


def value(row, field):
    return str(row.get(field, "") or "").strip()


def normalized_bool(text):
    lowered = str(text or "").strip().lower()
    if lowered in YES_VALUES:
        return "yes"
    if lowered in NO_VALUES:
        return "no"
    return lowered


def row_text(row):
    fields = [
        "source_title",
        "source_url",
        "creator",
        "archive_or_platform",
        "source_class",
        "license_or_rights_basis",
        "license_status",
        "attribution_text",
        "notes",
    ]
    return " ".join(value(row, field).lower() for field in fields)


def has_known_source(row, policy, preferred_names):
    source_class = value(row, "source_class").lower()
    text = row_text(row)
    if source_class in LOCAL_SOURCE_CLASSES:
        return any(marker in text for marker in LOCAL_PLATFORM_MARKERS)
    return any(name in text for name in preferred_names)


def validate_row(index, row, policy, required_fields, preferred_names, allowed_source_classes):
    blockers = []
    warnings = []
    row_id = compact_row_id(index, row)
    for field in required_fields:
        if not value(row, field):
            blockers.append(f"{row_id} missing required field `{field}`.")
    source_class = value(row, "source_class").lower()
    if source_class and source_class not in allowed_source_classes:
        blockers.append(f"{row_id} uses unsupported source_class `{source_class}`.")
    if not has_known_source(row, policy, preferred_names):
        blockers.append(f"{row_id} is not tied to Pattern Lab or an approved preferred source.")
    asset_type = value(row, "asset_type").lower()
    notes = value(row, "notes").lower()
    license_basis = value(row, "license_or_rights_basis").lower()
    if source_class == "modern_context":
        if "proof" in notes or "evidence" in notes or "historical claim" in notes:
            blockers.append(f"{row_id} modern_context stock media cannot be logged as source proof or historical evidence.")
    if source_class == "historical_evidence" and asset_type not in PROOF_BEARING_ASSET_TYPES:
        warnings.append(f"{row_id} historical_evidence is logged on a non-proof-bearing asset type.")

    text = row_text(row)
    for pattern, reason in DISALLOWED_PATTERNS:
        if pattern in text:
            blockers.append(f"{row_id} uses blocked source language: {reason}.")

    attribution_required = normalized_bool(value(row, "attribution_required"))
    if attribution_required not in {"yes", "no"}:
        blockers.append(f"{row_id} attribution_required must be yes or no.")
    if attribution_required == "yes" and not value(row, "attribution_text"):
        blockers.append(f"{row_id} requires attribution but attribution_text is missing.")
    if not value(row, "attribution_text"):
        blockers.append(f"{row_id} attribution_text must be preserved even when attribution is not required.")

    commercial_use = normalized_bool(value(row, "commercial_use_ok"))
    if commercial_use != "yes":
        blockers.append(f"{row_id} commercial_use_ok must be yes for a Pattern Lab upload asset.")
    modification_ok = normalized_bool(value(row, "modification_ok"))
    if modification_ok != "yes":
        blockers.append(f"{row_id} modification_ok must be yes for edited Pattern Lab video assets.")

    review_status = value(row, "human_review_status").lower()
    if review_status not in REVIEW_STATUSES:
        blockers.append(
            f"{row_id} human_review_status must be one of: {', '.join(sorted(REVIEW_STATUSES))}."
        )
    disclosure = value(row, "ai_reconstruction_disclosure").lower()
    if source_class == "ai_reconstruction":
        if not disclosure or "not archival" not in disclosure:
            blockers.append(f"{row_id} AI reconstruction disclosure must state it is not archival evidence.")
    elif not disclosure:
        blockers.append(f"{row_id} ai_reconstruction_disclosure must explicitly say not applicable or not archival.")
    elif "ai-generated historical photo" in disclosure:
        blockers.append(f"{row_id} cannot present AI output as a historical photo.")

    risk = value(row, "recognizable_people_property_trademark_risk").lower()
    if not risk:
        blockers.append(f"{row_id} recognizable people/property/trademark risk field is missing.")
    elif "unknown" in risk or "unclear" in risk or "not logged" in risk:
        blockers.append(f"{row_id} has unresolved recognizable people/property/trademark risk language.")
    if source_class in {"modern_context", "historical_evidence"} and (
        "editorial" in license_basis or "noncommercial" in license_basis or "no derivatives" in license_basis
    ):
        blockers.append(f"{row_id} uses a rights basis incompatible with monetized edited uploads.")

    return blockers, warnings


def report_lines(payload):
    lines = [
        f"# Pattern Lab Source Rights Report: Video {payload['video_id']}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Ledger: `{payload['ledger']}`",
        f"Policy: `{payload['policy']}`",
        "",
        "## Coverage",
        "",
        f"- Rows checked: {payload['rows_checked']}",
        f"- Required fields present in header: {'yes' if not payload['header_missing'] else 'no'}",
        f"- Header missing fields: {', '.join(payload['header_missing']) if payload['header_missing'] else 'none'}",
        "",
        "## Asset Types",
        "",
    ]
    lines.extend([f"- {key}: {count}" for key, count in payload["asset_types"].items()] or ["- none"])
    lines.extend(["", "## Source Classes", ""])
    lines.extend([f"- {key}: {count}" for key, count in payload["source_classes"].items()] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in payload["blockers"]] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in payload["warnings"]] or ["- none"])
    lines.extend(
        [
            "",
            "## Rule",
            "",
            "- No source, no story.",
            "- Stock or archival media is usable only when source, rights basis, commercial use, modification status, attribution, and risk fields are logged.",
            "- AI or generated visuals must be disclosed as graphics/reconstructions, never historical photos.",
            "",
        ]
    )
    return "\n".join(lines)


def build_source_rights_report(video_id):
    policy = read_policy()
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    ledger = root / "rights-ledger.csv"
    header, rows = read_ledger(ledger)
    required_fields = list(dict.fromkeys(policy.get("required_rights_ledger_fields", []) + ["local_path"]))
    header_missing = [field for field in required_fields if field not in header]
    allowed_source_classes = set(policy.get("source_roles", {}).keys())
    preferred_names = preferred_source_names(policy)
    blockers = []
    warnings = []
    if not ledger.exists():
        blockers.append(f"Rights ledger is missing: {display_path(ledger)}.")
    if header_missing:
        blockers.append(f"Rights ledger header is missing required fields: {', '.join(header_missing)}.")
    if not rows:
        blockers.append("Rights ledger has no rows.")
    for index, row in enumerate(rows, start=1):
        row_blockers, row_warnings = validate_row(
            index,
            row,
            policy,
            required_fields,
            preferred_names,
            allowed_source_classes,
        )
        blockers.extend(row_blockers)
        warnings.extend(row_warnings)

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "policy": display_path(POLICY_PATH),
        "ledger": display_path(ledger),
        "required_fields": required_fields,
        "header_missing": header_missing,
        "rows_checked": len(rows),
        "asset_types": dict(sorted(Counter(value(row, "asset_type") or "unknown" for row in rows).items())),
        "source_classes": dict(sorted(Counter(value(row, "source_class") or "missing" for row in rows).items())),
        "blockers": blockers,
        "warnings": warnings,
    }
    json_report = approval / "source-rights-report.json"
    md_report = approval / "source-rights-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_report.write_text(report_lines(payload), encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab source and rights ledger readiness.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_report, md_report = build_source_rights_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Source rights report: {display_path(md_report)}")
    if payload["blockers"]:
        print("Blockers:")
        for blocker in payload["blockers"]:
            print(f"- {blocker}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()

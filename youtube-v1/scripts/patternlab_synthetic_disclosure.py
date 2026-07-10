#!/usr/bin/env python3
import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, utc_now


POLICY_PATH = BASE / "resources" / "source-media-policy.json"
MOTION_AI_POLICY_PATH = BASE / "workflows" / "motion-ai-visual-policy.md"
RECONSTRUCTION_LABEL = "Dramatic reconstruction — not archival footage"
AI_SOURCE_CLASSES = {"ai_reconstruction"}
AI_TEXT_MARKERS = (
    "ai-assisted",
    "ai reconstruction",
    "labeled ai reconstruction",
    "synthetic",
    "openai",
    "codex image generation",
    "comfyui",
    "stable diffusion",
    "wan2",
    "ltx",
)
PROOF_ASSET_TYPES = {"artifact", "proof_footage"}
BLOCKED_PATTERNS = {
    "fake_lip_sync": [
        r"\bfake\s+lip[- ]?sync\b",
        r"\bai\s+lip[- ]?sync\b",
        r"\blip[- ]?sync(ed|ing)?\s+(henry ford|real person|historical figure)\b",
    ],
    "fake_quotes": [
        r"\bfake\s+quote(s)?\b",
        r"\binvented\s+quote(s)?\b",
        r"\bmade[- ]?up\s+quote(s)?\b",
    ],
    "unlabeled_fake_archival": [
        r"\bunlabeled\s+fake\s+archival\b",
        r"\bfake\s+archival\s+(photo|footage|film|clip)\b",
        r"\bai[- ]generated\s+historical\s+(photo|footage|film|clip)\b",
    ],
    "synthetic_proof_claim": [
        r"\bai\s+(source\s+proof|historical\s+proof|proves)\b",
        r"\bsynthetic\s+(source\s+proof|historical\s+proof|proves)\b",
        r"\breconstruction\s+(proves|is\s+proof)\b",
    ],
}
ALLOWED_NEGATING_PREFIXES = (
    "no ",
    "not ",
    "never ",
    "block ",
    "blocks ",
    "blocked ",
    "without ",
    "must not ",
    "do not ",
)


def read_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def load_ledger(root):
    ledger = root / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def row_text(row):
    fields = [
        "asset_id",
        "asset_type",
        "filename",
        "tool",
        "model_or_service",
        "source_prompt_or_source_file",
        "source_title",
        "archive_or_platform",
        "source_class",
        "license_or_rights_basis",
        "license_status",
        "ai_reconstruction_disclosure",
        "notes",
    ]
    return " ".join(str(row.get(field, "") or "") for field in fields)


def is_ai_related_row(row):
    source_class = str(row.get("source_class", "")).strip().lower()
    if source_class in AI_SOURCE_CLASSES:
        return True
    disclosure = str(row.get("ai_reconstruction_disclosure", "") or "").lower()
    text = " ".join(str(row.get(field, "") or "").lower() for field in ("tool", "model_or_service", "notes"))
    if "not_ai_reconstruction" in disclosure and not any(marker in text for marker in AI_TEXT_MARKERS):
        return False
    text = f"{text} {disclosure}"
    return any(marker in text for marker in AI_TEXT_MARKERS)


def is_reconstruction_row(row):
    source_class = str(row.get("source_class", "")).strip().lower()
    disclosure = str(row.get("ai_reconstruction_disclosure", "") or "").lower()
    notes = str(row.get("notes", "") or "").lower()
    if source_class == "ai_reconstruction":
        return True
    text = f"{disclosure} {notes}"
    if "not_ai_reconstruction" in text:
        return False
    return "labeled reconstruction" in text or "ai reconstruction" in text or "dramatic reconstruction" in text


def has_not_archival_disclosure(row):
    disclosure = str(row.get("ai_reconstruction_disclosure", "") or "").lower()
    notes = str(row.get("notes", "") or "").lower()
    text = f"{disclosure} {notes}"
    return "not archival" in text or "not_ai_reconstruction" in text


def normalized_context(text, start, width=18):
    prefix = text[max(0, start - width) : start].lower()
    return " ".join(prefix.split())


def is_negated_policy_phrase(text, start):
    prefix = normalized_context(text, start)
    return any(prefix.endswith(item.strip()) for item in ALLOWED_NEGATING_PREFIXES)


def find_blocked_hits(named_texts):
    hits = []
    for source, text in named_texts:
        lower = text.lower()
        for category, patterns in BLOCKED_PATTERNS.items():
            for pattern in patterns:
                for match in re.finditer(pattern, lower):
                    if is_negated_policy_phrase(lower, match.start()):
                        continue
                    hits.append(
                        {
                            "category": category,
                            "source": source,
                            "match": match.group(0),
                        }
                    )
    return hits


def read_optional_text(path):
    path = Path(path)
    if not path.exists():
        return ""
    try:
        return read_text(path)
    except UnicodeDecodeError:
        return ""


def build_synthetic_disclosure_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    metadata_path = approval / "upload-metadata.json"
    metadata = read_json(metadata_path)
    policy = read_json(POLICY_PATH)
    motion_policy = read_optional_text(MOTION_AI_POLICY_PATH)
    ledger_rows = load_ledger(root)
    visual_plan = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    final_script = BASE / "launch" / f"video-{video_id}" / "final-script.md"
    image_prompts = BASE / "launch" / f"video-{video_id}" / "image-prompts.md"

    blockers = []
    warnings = []
    synthetic_decision = str(metadata.get("synthetic_disclosure_decision", "") or "").strip()
    if not synthetic_decision:
        blockers.append("Upload metadata is missing synthetic_disclosure_decision.")

    source_roles = policy.get("source_roles", {})
    ai_role_text = str(source_roles.get("ai_reconstruction", "") or "").lower()
    ai_can_illustrate_not_prove = (
        "illustrate" in ai_role_text
        and ("never archival proof" in ai_role_text or "never" in ai_role_text and "proof" in ai_role_text)
        and "do not use ai output to carry a historical claim" in motion_policy.lower()
    )
    if not ai_can_illustrate_not_prove:
        blockers.append("Synthetic policy must state that AI can illustrate but cannot prove historical claims.")

    required_label_present = RECONSTRUCTION_LABEL in motion_policy
    if not required_label_present:
        blockers.append(f"Motion/AI policy is missing required reconstruction label: {RECONSTRUCTION_LABEL}.")

    ai_rows = [row for row in ledger_rows if is_ai_related_row(row)]
    reconstruction_rows = [row for row in ledger_rows if is_reconstruction_row(row)]
    source_class_counts = Counter(str(row.get("source_class", "") or "missing") for row in ledger_rows)
    ai_rows_missing_disclosure = [
        row
        for row in ai_rows
        if not str(row.get("ai_reconstruction_disclosure", "") or "").strip()
    ]
    reconstruction_rows_missing_not_archival = [
        row for row in reconstruction_rows if not has_not_archival_disclosure(row)
    ]
    synthetic_proof_rows = [
        row
        for row in ai_rows
        if str(row.get("asset_type", "")).strip().lower() in PROOF_ASSET_TYPES
        or "source proof" in row_text(row).lower()
        or "historical proof" in row_text(row).lower()
    ]
    synthetic_rows_without_owner_review = [
        row
        for row in ai_rows
        if str(row.get("human_review_required", "") or "").strip().lower() != "yes"
    ]

    for row in ai_rows_missing_disclosure:
        blockers.append(
            f"AI/synthetic ledger row is missing ai_reconstruction_disclosure: {row.get('asset_id') or row.get('filename')}."
        )
    for row in reconstruction_rows_missing_not_archival:
        blockers.append(
            f"Reconstruction row must disclose not archival: {row.get('asset_id') or row.get('filename')}."
        )
    for row in synthetic_proof_rows:
        blockers.append(
            f"Synthetic/AI row cannot be logged as proof: {row.get('asset_id') or row.get('filename')}."
        )
    for row in synthetic_rows_without_owner_review:
        blockers.append(
            f"Synthetic/AI row must require owner review: {row.get('asset_id') or row.get('filename')}."
        )

    named_texts = [
        ("upload_metadata", json.dumps(metadata, ensure_ascii=False)),
        ("visual_beat_plan", read_optional_text(visual_plan)),
        ("final_script", read_optional_text(final_script)),
        ("image_prompts", read_optional_text(image_prompts)),
    ]
    named_texts.extend(
        (
            f"ledger:{row.get('asset_id') or row.get('filename') or index}",
            row_text(row),
        )
        for index, row in enumerate(ledger_rows, start=1)
    )
    blocked_hits = find_blocked_hits(named_texts)
    if blocked_hits:
        for hit in blocked_hits:
            blockers.append(f"Blocked synthetic/deception phrase in {hit['source']}: {hit['match']}.")

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "blockers": blockers,
        "warnings": warnings,
        "policy": display_path(POLICY_PATH),
        "motion_ai_policy": display_path(MOTION_AI_POLICY_PATH),
        "metadata": display_path(metadata_path),
        "visual_beat_plan": display_path(visual_plan),
        "required_reconstruction_label": RECONSTRUCTION_LABEL,
        "synthetic_disclosure_decision_present": bool(synthetic_decision),
        "synthetic_disclosure_decision": synthetic_decision,
        "ai_can_illustrate_not_prove": ai_can_illustrate_not_prove,
        "fake_lip_sync_blocked": True,
        "fake_lip_sync_violation_count": sum(1 for hit in blocked_hits if hit["category"] == "fake_lip_sync"),
        "fake_quotes_blocked": True,
        "fake_quotes_violation_count": sum(1 for hit in blocked_hits if hit["category"] == "fake_quotes"),
        "unlabeled_fake_archival_blocked": True,
        "unlabeled_fake_archival_violation_count": sum(
            1 for hit in blocked_hits if hit["category"] == "unlabeled_fake_archival"
        ),
        "synthetic_proof_claim_violation_count": sum(
            1 for hit in blocked_hits if hit["category"] == "synthetic_proof_claim"
        ),
        "blocked_phrase_hits": blocked_hits,
        "source_class_counts": dict(sorted(source_class_counts.items())),
        "ai_related_row_count": len(ai_rows),
        "reconstruction_row_count": len(reconstruction_rows),
        "ai_rows_missing_disclosure_count": len(ai_rows_missing_disclosure),
        "reconstruction_rows_missing_not_archival_count": len(reconstruction_rows_missing_not_archival),
        "synthetic_proof_row_count": len(synthetic_proof_rows),
        "synthetic_rows_without_owner_review_count": len(synthetic_rows_without_owner_review),
        "owner_review_required_for_synthetic": not synthetic_rows_without_owner_review,
        "no_youtube_mutation": True,
        "no_canva_action": True,
        "no_model_install_or_download": True,
    }

    json_report = approval / "synthetic-disclosure-report.json"
    md_report = approval / "synthetic-disclosure-report.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Synthetic Disclosure Report: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Decision",
        "",
        f"- Synthetic disclosure decision present: {payload['synthetic_disclosure_decision_present']}",
        f"- Decision: {synthetic_decision or 'missing'}",
        f"- Required reconstruction label: `{RECONSTRUCTION_LABEL}`",
        "- Rule: AI can illustrate. It cannot prove.",
        "- Real photos, maps, documents, and source footage remain the evidence layer.",
        "",
        "## Guardrails",
        "",
        f"- Fake lip-sync blocked: {payload['fake_lip_sync_blocked']} ({payload['fake_lip_sync_violation_count']} violations)",
        f"- Fake quotes blocked: {payload['fake_quotes_blocked']} ({payload['fake_quotes_violation_count']} violations)",
        f"- Unlabeled fake archival blocked: {payload['unlabeled_fake_archival_blocked']} ({payload['unlabeled_fake_archival_violation_count']} violations)",
        f"- Synthetic proof claims: {payload['synthetic_proof_claim_violation_count']} violations",
        f"- AI/reconstruction ledger rows: {payload['ai_related_row_count']} AI-related / {payload['reconstruction_row_count']} reconstruction",
        f"- Synthetic rows requiring owner review: {payload['owner_review_required_for_synthetic']}",
        "",
        "## Source Classes",
        "",
    ]
    lines.extend([f"- {key}: {value}" for key, value in payload["source_class_counts"].items()] or ["- none"])
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab synthetic disclosure and reconstruction gates.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_report, md_report = build_synthetic_disclosure_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Synthetic disclosure report: {display_path(md_report)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    if payload["blockers"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

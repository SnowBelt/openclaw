#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import struct
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


AVATAR_DIR = BASE / "resources" / "channel-branding" / "final" / "presenter-avatar"
CANONICAL_AVATAR = AVATAR_DIR / "james-canonical-avatar.png"
MANIFEST = AVATAR_DIR / "james-avatar-manifest.json"
README = AVATAR_DIR / "README.md"
VIDEO_AVATAR = Path("visual-upgrade/james_avatar_concept_a.png")
APPROVAL_FILE = Path("approval/james-avatar-approval.json")
VISUAL_PLAN = Path("approval/visual-upgrade-plan.json")
REFERENCE_RULE = (
    "Break the symmetry intentionally: uneven brows, eyes, smile, nose alignment, "
    "and natural face proportions while keeping him friendly and usable."
)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(path):
    with Path(path).open("rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or not header.startswith(b"\x89PNG\r\n\x1a\n") or header[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", header[16:24])
    return width, height


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_ledger_rows(root):
    ledger = root / "rights-ledger.csv"
    if not ledger.exists():
        return []
    with ledger.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def validate_avatar_contract(video_id=None):
    failures = []
    warnings = []
    details = {
        "canonical_avatar": display_path(CANONICAL_AVATAR),
        "manifest": display_path(MANIFEST),
        "video_id": video_id or "",
    }

    manifest = read_json(MANIFEST)
    if not manifest:
        failures.append("James avatar manifest is missing or invalid JSON.")
        manifest = {}
    elif manifest.get("status") != "owner-approved":
        failures.append("James avatar manifest must be owner-approved.")
    if manifest.get("presenter_name") != "James":
        failures.append("James avatar manifest must identify the presenter as James.")
    if manifest.get("reference_rule") != REFERENCE_RULE:
        failures.append("James avatar manifest reference rule has drifted from the owner-approved asymmetry rule.")

    if not CANONICAL_AVATAR.exists():
        failures.append("Canonical James avatar PNG is missing.")
        return failures, warnings, details

    dimensions = png_dimensions(CANONICAL_AVATAR)
    if not dimensions:
        failures.append("Canonical James avatar must be a valid PNG.")
        return failures, warnings, details

    width, height = dimensions
    digest = sha256_file(CANONICAL_AVATAR)
    details.update({"width": width, "height": height, "sha256": digest})
    if width != height:
        failures.append(f"Canonical James avatar must be square; got {width}x{height}.")
    if width < 1024 or height < 1024:
        failures.append(f"Canonical James avatar must be at least 1024x1024; got {width}x{height}.")
    if manifest.get("sha256") and manifest.get("sha256") != digest:
        failures.append("Canonical James avatar hash does not match the approved manifest.")
    if manifest.get("width") and int(manifest.get("width")) != width:
        failures.append("Canonical James avatar width does not match the approved manifest.")
    if manifest.get("height") and int(manifest.get("height")) != height:
        failures.append("Canonical James avatar height does not match the approved manifest.")

    if not README.exists():
        failures.append("James avatar README is missing.")
    else:
        readme_text = README.read_text(encoding="utf-8")
        for required in ["Name: James.", "Do not replace without a new explicit owner approval.", REFERENCE_RULE]:
            if required not in readme_text:
                failures.append(f"James avatar README is missing required rule: {required}")

    if not video_id:
        return failures, warnings, details

    root = output_root(video_id)
    local_avatar = root / VIDEO_AVATAR
    approval = read_json(root / APPROVAL_FILE)
    visual_plan = read_json(root / VISUAL_PLAN)
    details["video_avatar"] = display_path(local_avatar)
    if not local_avatar.exists():
        failures.append(f"Video {video_id} is missing the selected James avatar asset.")
    elif sha256_file(local_avatar) != digest:
        failures.append(f"Video {video_id} selected James avatar does not match the canonical avatar.")

    if not approval:
        warnings.append(f"Video {video_id} does not have a local James avatar approval file; global canonical approval applies.")
    else:
        if approval.get("status") != "approved":
            failures.append(f"Video {video_id} James avatar approval must be approved.")
        if approval.get("selected_avatar") != VIDEO_AVATAR.name:
            failures.append(f"Video {video_id} James avatar approval must select {VIDEO_AVATAR.name}.")
        if approval.get("talking_avatar") != "not approved; use stylized static/motion identity only":
            failures.append(f"Video {video_id} James avatar approval must block talking-avatar use by default.")

    if not visual_plan:
        failures.append(f"Video {video_id} visual-upgrade plan is missing or invalid JSON.")
    else:
        if visual_plan.get("status") != "avatar-approved":
            failures.append(f"Video {video_id} visual-upgrade plan must be avatar-approved.")
        selected = visual_plan.get("avatar_approval", {}).get("selected_avatar", "")
        if selected != VIDEO_AVATAR.name:
            failures.append(f"Video {video_id} visual-upgrade plan must select {VIDEO_AVATAR.name}.")

    matching_rows = [
        row
        for row in read_ledger_rows(root)
        if row.get("asset_type") == "avatar" and row.get("filename") == str(VIDEO_AVATAR)
    ]
    if not matching_rows:
        failures.append(f"Video {video_id} rights ledger is missing the approved James avatar row.")
    else:
        row = matching_rows[-1]
        if row.get("human_review_status") != "approved":
            failures.append(f"Video {video_id} rights ledger must mark the James avatar approved.")
        if row.get("tool") != "Codex image generation":
            failures.append(f"Video {video_id} rights ledger must record Codex image generation for the canonical James avatar.")
        if "canonical" not in row.get("notes", "").lower():
            failures.append(f"Video {video_id} rights ledger must note the canonical James avatar reference.")

    return failures, warnings, details


def write_report(video_id, payload):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    json_report = approval / "james-avatar-validation.json"
    md_report = approval / "james-avatar-validation.md"
    json_report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# James Avatar Validation: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Details",
        "",
        f"- Canonical avatar: `{payload['details'].get('canonical_avatar', '')}`",
        f"- Video avatar: `{payload['details'].get('video_avatar', '')}`",
        f"- Dimensions: {payload['details'].get('width', '')}x{payload['details'].get('height', '')}",
        f"- SHA-256: `{payload['details'].get('sha256', '')}`",
        "",
        "## Failures",
        "",
        *([f"- {failure}" for failure in payload["failures"]] or ["- none"]),
        "",
        "## Warnings",
        "",
        *([f"- {warning}" for warning in payload["warnings"]] or ["- none"]),
        "",
    ]
    md_report.write_text("\n".join(lines), encoding="utf-8")
    return json_report, md_report


def main():
    parser = argparse.ArgumentParser(description="Validate the approved Pattern Lab James avatar contract.")
    parser.add_argument("--video-id", default="")
    args = parser.parse_args()
    failures, warnings, details = validate_avatar_contract(args.video_id or None)
    payload = {
        "generated_at": utc_now(),
        "status": "pass" if not failures else "blocked",
        "video_id": args.video_id,
        "details": details,
        "failures": failures,
        "warnings": warnings,
    }
    if args.video_id:
        _, md_report = write_report(args.video_id, payload)
        print(f"James avatar validation: {display_path(md_report)}")
    print(f"Status: {payload['status']}")
    for failure in failures:
        print(f"- {failure}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

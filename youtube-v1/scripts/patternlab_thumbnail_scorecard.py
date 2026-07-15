#!/usr/bin/env python3
"""Create deterministic, hash-bound thumbnail rubric receipts.

This adapter never invents a creative score.  A rubric category earns its
full weight only when the objective producer and QA reports responsible for
that category are current, clean, and candidate-specific.  Any missing or
failed prerequisite becomes a hard block and prevents owner-review release.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.city import CityContractError, city_from_sources
from patternlab.state import sha256_file
from patternlab.thumbnail import load_thumbnail_candidate_manifest
from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import qa_contract_hash


POLICY_PATH = BASE / "resources" / "thumbnail-worldclass-policy.json"
REPORT_FILES = {
    "pixel": "thumbnail-pixel-quality-report.json",
    "semantic": "thumbnail-semantic-quality-report.json",
    "font": "thumbnail-font-quality-report.json",
    "source": "thumbnail-source-adequacy.json",
    "package": "thumbnail-package-report.json",
    "factory": "thumbnail-factory-report.json",
    "quality": "thumbnail-quality-report.json",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def clean_pass(payload: dict[str, Any]) -> bool:
    return bool(
        payload.get("status") == "pass"
        and not payload.get("blockers")
        and not payload.get("warnings")
    )


def by_id(rows: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(rows, list):
        return {}
    return {
        str(row.get("id") or "").casefold(): row
        for row in rows
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }


def by_filename(rows: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(rows, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = str(row.get("file") or row.get("path") or "")
        if raw:
            result[Path(raw).name] = row
    return result


def category(
    scores: dict[str, int],
    blockers: list[str],
    rubric: dict[str, Any],
    name: str,
    passed: bool,
    blocker: str,
) -> None:
    maximum = int(rubric.get(name, 0) or 0)
    scores[name] = maximum if passed else 0
    if not passed:
        blockers.append(blocker)


def build_report(video_id: str) -> tuple[dict[str, Any], Path, Path]:
    video_id = video_id.zfill(2)
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    policy = read_json(POLICY_PATH)
    rubric = policy.get("rubric") if isinstance(policy.get("rubric"), dict) else {}
    threshold = int(policy.get("score_threshold", 94) or 94)
    manifest = load_thumbnail_candidate_manifest(root)
    manifest_payload = read_json(manifest.path)
    brief = read_json(approval / "thumbnail-worldclass-brief.json")
    reports = {name: read_json(approval / filename) for name, filename in REPORT_FILES.items()}
    report_hashes = {
        name: sha256_file(approval / filename) if (approval / filename).is_file() else ""
        for name, filename in REPORT_FILES.items()
    }
    pixel_rows = by_id(reports["pixel"].get("candidates"))
    semantic_rows = by_id(reports["semantic"].get("rows"))
    font_rows = by_filename(reports["font"].get("entries"))
    accepted_sources = {
        str(value)
        for value in reports["source"].get("accepted_source_asset_ids", [])
        if str(value).strip()
    }
    global_blockers: list[str] = []
    if manifest_payload.get("status") != "ready_for_hash_bound_owner_review":
        global_blockers.append("thumbnail_candidate_manifest_not_review_ready")
    if len(manifest.candidates) != 3:
        global_blockers.append(f"thumbnail_finalist_count_invalid:{len(manifest.candidates)}/3")
    for name, payload in reports.items():
        if not clean_pass(payload):
            global_blockers.append(f"thumbnail_prerequisite_report_not_clean_pass:{name}")
    try:
        city = city_from_sources(
            (
                ("candidate_manifest", manifest_payload.get("city")),
                ("thumbnail_brief", brief.get("city")),
                ("factory", reports["factory"].get("active_city")),
            )
        )
    except CityContractError as exc:
        city = ""
        global_blockers.append(str(exc))

    score_rows: list[dict[str, Any]] = []
    for candidate in manifest.candidates:
        candidate_id = str(candidate.get("id") or "").casefold()
        filename = Path(str(candidate.get("path") or candidate.get("filename") or "")).name
        candidate_path = Path(str(candidate.get("path") or ""))
        if not candidate_path.is_absolute():
            candidate_path = BASE / candidate_path
        pixel = pixel_rows.get(candidate_id, {})
        semantic = semantic_rows.get(candidate_id, {})
        font = font_rows.get(filename, {})
        candidate_blockers = list(global_blockers)
        digest = sha256_file(candidate_path) if candidate_path.is_file() else ""
        if not digest:
            candidate_blockers.append("candidate_file_missing")
        if digest != str(candidate.get("sha256") or ""):
            candidate_blockers.append("candidate_manifest_hash_mismatch")
        if str(pixel.get("sha256") or "") != digest:
            candidate_blockers.append("candidate_pixel_report_hash_mismatch")

        source_ids = {
            str(value)
            for value in candidate.get("source_asset_ids", [])
            if str(value).strip()
        }
        source_pass = bool(source_ids) and source_ids.issubset(accepted_sources) and clean_pass(reports["source"])
        city_words = city.casefold().split()
        public_text = " ".join(str(value) for value in candidate.get("public_text", [])).casefold()
        city_pass = bool(city_words) and all(word in public_text for word in city_words)
        pixel_pass = bool(pixel.get("status") == "pass" and int(pixel.get("score", 0) or 0) >= 93)
        semantic_pass = semantic.get("status") == "pass" and not semantic.get("blockers")
        font_pass = bool(font.get("status") == "pass" and not font.get("blockers") and not font.get("warnings"))
        package_pass = clean_pass(reports["package"]) and clean_pass(reports["factory"])
        promise_pass = bool(
            package_pass
            and clean_pass(reports["quality"])
            and str(brief.get("viewer_promise") or "").strip()
            and str(brief.get("first_30_second_payoff") or "").strip()
        )
        scores: dict[str, int] = {}
        category(scores, candidate_blockers, rubric, "hero_image_and_emotion", pixel_pass and semantic_pass, "hero_image_or_emotion_gate_failed")
        category(scores, candidate_blockers, rubric, "curiosity_and_promise", promise_pass, "curiosity_or_promise_gate_failed")
        category(scores, candidate_blockers, rubric, "promise_truth_and_first_30_seconds", promise_pass, "first_30_second_promise_gate_failed")
        category(scores, candidate_blockers, rubric, "typography_and_shelf_readability", font_pass and pixel_pass, "typography_or_shelf_gate_failed")
        category(scores, candidate_blockers, rubric, "composition_and_hierarchy", semantic_pass and package_pass, "composition_or_hierarchy_gate_failed")
        category(scores, candidate_blockers, rubric, "city_recognition", city_pass, "city_recognition_gate_failed")
        category(scores, candidate_blockers, rubric, "color_and_focal_luminance", pixel_pass, "color_or_focal_luminance_gate_failed")
        category(scores, candidate_blockers, rubric, "rights_and_historical_trust", source_pass, "rights_or_historical_trust_gate_failed")
        candidate_blockers = sorted(set(candidate_blockers))
        total = sum(scores.values())
        if total < threshold:
            candidate_blockers.append(f"score_below_threshold:{total}/{threshold}")
        candidate_blockers = sorted(set(candidate_blockers))
        receipt = {
            "schema_version": 1,
            "generated_at": utc_now(),
            "video_id": video_id,
            "city": city,
            "id": candidate_id,
            "filename": filename,
            "status": "pass" if not candidate_blockers else "blocked",
            "candidate_sha256": digest,
            "qa_contract_sha256": qa_contract_hash(),
            "deterministic_qa_report_sha256": {
                "pixel": report_hashes["pixel"],
                "semantic": report_hashes["semantic"],
                "font": report_hashes["font"],
            },
            "all_prerequisite_report_sha256": report_hashes,
            "scores": scores,
            "total_score": total,
            "score_threshold": threshold,
            "hard_blocks": candidate_blockers,
            "evidence": {
                "source_asset_ids": sorted(source_ids),
                "accepted_source_asset_ids": sorted(source_ids & accepted_sources),
                "pixel_score": int(pixel.get("score", 0) or 0),
                "semantic_status": semantic.get("status", "missing"),
                "font_status": font.get("status", "missing"),
                "city_visible": city_pass,
            },
            "scoring_rule": "A category earns its full weight only from current objective gate proof; no subjective score is fabricated.",
            "youtube_mutation": "not_performed",
        }
        (approval / f"thumbnail-score-{candidate_id}.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )
        score_rows.append(receipt)

    blockers = list(global_blockers)
    for row in score_rows:
        blockers.extend(f"{row['id']}:{item}" for item in row["hard_blocks"])
    blockers = sorted(set(blockers))
    payload = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "video_id": video_id,
        "city": city,
        "status": "pass" if len(score_rows) == 3 and not blockers else "blocked",
        "score_threshold": threshold,
        "candidate_count": len(score_rows),
        "minimum_score_observed": min((row["total_score"] for row in score_rows), default=0),
        "scores": [
            {
                "id": row["id"],
                "filename": row["filename"],
                "status": row["status"],
                "total_score": row["total_score"],
                "candidate_sha256": row["candidate_sha256"],
            }
            for row in score_rows
        ],
        "blockers": blockers,
        "warnings": [],
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    json_path = approval / "thumbnail-scorecard-report.json"
    md_path = approval / "thumbnail-scorecard-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(
        "\n".join(
            [
                f"# Pattern Lab Thumbnail Scorecard: Video {video_id}",
                "",
                f"City: {city or 'missing'}",
                f"Status: {payload['status']}",
                f"Required score: {threshold}/100 per candidate",
                "",
                "## Candidates",
                "",
                *[
                    f"- {row['id']}: {row['total_score']}/100 — {row['status']} — `{row['candidate_sha256']}`"
                    for row in score_rows
                ],
                "",
                "## Blockers",
                "",
                *([f"- {item}" for item in blockers] or ["- none"]),
                "",
                "YouTube mutation: not performed",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Create deterministic Pattern Lab thumbnail score receipts.")
    parser.add_argument("--video-id", default="04")
    args = parser.parse_args()
    payload, report, _ = build_report(args.video_id)
    print(json.dumps({"status": payload["status"], "report": display_path(report), "blockers": payload["blockers"]}, indent=2))
    if payload["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

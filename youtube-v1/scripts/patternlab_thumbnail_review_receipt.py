#!/usr/bin/env python3
"""Write hash-bound adversarial thumbnail score receipts.

The command never invents scores. A reviewer supplies every rubric value and
the command binds that judgment to the current finalist bytes. This keeps the
creative judgment auditable while deterministic gates validate the contract.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_media_qa_common import qa_contract_hash
from patternlab_thumbnail_worldclass import POLICY_PATH, read_json, score_receipt, sha256, write_json


def parse_scores(raw: str) -> dict[str, int]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("scores must be a JSON object")
    return {str(key): int(score) for key, score in value.items()}


def build_receipt(
    video_id: str,
    candidate_id: str,
    scores: dict[str, int],
    *,
    reviewer: str,
    rationale: str,
    hard_blocks: list[str] | None = None,
    write: bool = True,
) -> tuple[dict, Path]:
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    tournament = read_json(approval / "thumbnail-worldclass-tournament.json")
    finalist = next((item for item in tournament.get("finalists", []) if item.get("id") == candidate_id), None)
    if not finalist:
        raise ValueError(f"candidate is not a current finalist: {candidate_id}")
    path = Path(str(finalist.get("path", "")))
    if not path.is_absolute():
        from patternlab_common import BASE
        path = BASE / path
    if not path.exists():
        raise ValueError(f"candidate file is missing: {candidate_id}")
    current_hash = sha256(path)
    if current_hash != finalist.get("sha256"):
        raise ValueError(f"candidate hash differs from tournament manifest: {candidate_id}")
    policy = read_json(POLICY_PATH)
    required_qa_reports = {
        "pixel": approval / "thumbnail-pixel-quality-report.json",
        "semantic": approval / "thumbnail-semantic-quality-report.json",
        "font": approval / "thumbnail-font-quality-report.json",
    }
    qa_report_hashes = {}
    for name, report_path in required_qa_reports.items():
        report_payload = read_json(report_path)
        if report_payload.get("status") != "pass":
            raise ValueError(f"deterministic thumbnail QA is not passing: {name}")
        qa_report_hashes[name] = sha256(report_path)
    receipt = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "candidate_id": candidate_id,
        "candidate_path": display_path(path),
        "candidate_sha256": current_hash,
        "reviewer": reviewer,
        "review_kind": "adversarial_thumbnail_rubric",
        "scores": scores,
        "hard_blocks": list(hard_blocks or []),
        "rationale": rationale.strip(),
        "qa_contract_sha256": qa_contract_hash(),
        "deterministic_qa_report_sha256": qa_report_hashes,
        "paid_provider_calls": "not_performed",
        "youtube_mutation": "not_performed",
    }
    total, blockers = score_receipt(receipt, policy)
    if not receipt["rationale"]:
        blockers.append("review_rationale_missing")
    if reviewer not in {"gpt-5.6-terra", "gpt-5.6-sol-ultra", "human-expert"}:
        blockers.append("reviewer_not_approved")
    receipt.update({
        "score": total,
        "status": "pass" if not blockers else "blocked",
        "blockers": list(dict.fromkeys(blockers)),
    })
    output = approval / f"thumbnail-score-{candidate_id}.json"
    if write:
        write_json(output, receipt)
    return receipt, output


def main() -> None:
    parser = argparse.ArgumentParser(description="Write one exact-hash thumbnail score receipt.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--reviewer", required=True, choices=["gpt-5.6-terra", "gpt-5.6-sol-ultra", "human-expert"])
    parser.add_argument("--scores-json", required=True)
    parser.add_argument("--rationale", required=True)
    parser.add_argument("--hard-block", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    receipt, output = build_receipt(
        args.video_id,
        args.candidate_id,
        parse_scores(args.scores_json),
        reviewer=args.reviewer,
        rationale=args.rationale,
        hard_blocks=args.hard_block,
        write=not args.dry_run,
    )
    print(json.dumps({"status": receipt["status"], "score": receipt["score"], "blockers": receipt["blockers"], "report": display_path(output)}, indent=2))


if __name__ == "__main__":
    main()

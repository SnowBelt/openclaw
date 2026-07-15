#!/usr/bin/env python3
"""The only supported public entrypoint for Pattern Lab production work."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import sys
from pathlib import Path

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = YOUTUBE_ROOT.parent
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))
if str(YOUTUBE_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))

from patternlab.production import ContractError, ProductionRunner, load_contract
from patternlab_common import output_root


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def write_idle_receipt(*, profile: str, candidates: list[dict[str, str]]) -> dict:
    operations = YOUTUBE_ROOT / "local-output" / "operations"
    operations.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "status": "idle_waiting_for_profile_compatible_approval",
        "profile": profile,
        "reason": "no_profile_compatible_production_candidate",
        "candidate_diagnostics": candidates,
        "paid_provider_call": "not_performed",
        "media_generation": "not_performed",
        "discord_review": "not_performed",
        "youtube_mutation": "not_performed",
    }
    path = operations / "canonical-production-idle.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    payload["receipt"] = str(path)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Pattern Lab through its canonical fail-closed production contract.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--video-id")
    target.add_argument("--next-scheduled", action="store_true")
    parser.add_argument("--profile", choices=["long_form_rebuild", "full_package"], default="full_package")
    parser.add_argument("--render", action="store_true", help="Run local rendering and all post-render QA gates.")
    parser.add_argument("--send-review", action="store_true", help="Send a passing hash-bound owner-review packet to Discord.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--live-voice", choices=["never", "when-approved"], default="never")
    parser.add_argument("--shorts-target", type=int, choices=[3, 4, 5], default=5)
    parser.add_argument("--contract", default=str(YOUTUBE_ROOT / "resources" / "patternlab-production-contract.json"))
    args = parser.parse_args()
    if args.next_scheduled:
        from patternlab_full_auto_production import NoProductionCandidate, next_incomplete_video

        try:
            video_id = next_incomplete_video(profile=args.profile)
        except NoProductionCandidate as exc:
            print(json.dumps(write_idle_receipt(profile=exc.profile, candidates=exc.candidates), indent=2))
            return
    else:
        video_id = str(args.video_id).removeprefix("video-").zfill(2)
    if args.send_review and not args.render:
        raise SystemExit("--send-review requires --render so review can bind to current final pixels.")
    contract_path = Path(args.contract).resolve()
    production_lock_path = YOUTUBE_ROOT / "launch" / f"video-{video_id}" / "production-lock.json"
    try:
        contract = load_contract(contract_path, args.profile)
        runner = ProductionRunner(
            repo_root=REPO_ROOT,
            youtube_root=YOUTUBE_ROOT,
            output_root=output_root(video_id),
            contract=contract,
            video_id=video_id,
            production_lock=read_json(production_lock_path),
            render=args.render,
            send_review=args.send_review,
            dry_run=args.dry_run,
            live_voice=args.live_voice,
            shorts_target=args.shorts_target,
        )
        payload = runner.execute()
    except ContractError as exc:
        raise SystemExit(f"Pattern Lab production contract blocked: {exc}") from exc
    print(json.dumps({
        "status": payload["status"],
        "profile": payload["profile"],
        "video_id": payload["video_id"],
        "completed_stages": payload.get("completed_stage_count", 0),
        "selected_stages": payload.get("selected_stage_count", len(payload.get("stages", []))),
        "blockers": payload.get("blockers", []),
        "youtube_mutation": payload["youtube_mutation"],
    }, indent=2))
    if payload["status"] == "blocked":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

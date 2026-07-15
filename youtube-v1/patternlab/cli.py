"""Stable canonical CLI for Pattern Lab's new state surfaces."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .models import EpisodeState
from .state import PatternLabState


def state_db() -> Path:
    default = Path(__file__).resolve().parents[1] / "local-output" / "patternlab.sqlite3"
    return Path(os.environ.get("PATTERNLAB_STATE_DB", default))


def main() -> int:
    parser = argparse.ArgumentParser(prog="patternlab")
    top = parser.add_subparsers(dest="domain", required=True)
    state = top.add_parser("state")
    state.add_argument("action", choices=["migrate", "ensure", "transition", "snapshot"])
    state.add_argument("--video-id", default="04")
    state.add_argument("--target", choices=[value.value for value in EpisodeState])
    state.add_argument("--blocker", default="")
    args = parser.parse_args()
    if args.domain == "state":
        store = PatternLabState(state_db())
        store.migrate()
        if args.action == "migrate":
            print(json.dumps({"status": "pass", "state_db": str(state_db())}, indent=2))
        elif args.action == "ensure":
            store.ensure_episode(args.video_id)
            print(json.dumps(store.snapshot(args.video_id), indent=2))
        elif args.action == "transition":
            if not args.target:
                parser.error("--target is required for state transition")
            store.transition(args.video_id, EpisodeState(args.target), args.blocker)
            print(json.dumps(store.snapshot(args.video_id), indent=2))
        else:
            print(json.dumps(store.snapshot(args.video_id), indent=2))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

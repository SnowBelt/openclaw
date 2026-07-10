#!/usr/bin/env python3
"""Inventory legacy vs active Pattern Lab packages without deleting anything."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now
from patternlab_topic_qualification_queue import build_topic_qualification_queue


OPERATIONS_ROOT = BASE / "local-output" / "operations"


def main() -> None:
    queue, _, _ = build_topic_qualification_queue()
    rows: list[dict[str, Any]] = []
    for topic in queue["rows"]:
        video_id = topic["video_id"]
        approval = output_root(video_id) / "approval"
        receipts = [name for name in ("youtube-upload-report.json", "approved-package-upload-report.json") if (approval / name).exists()]
        state = "active_rebuild" if topic["topic_status"] == "active_rebuild" else ("legacy_uploaded" if receipts else "not_uploaded")
        rows.append({"video_id": video_id, "state": state, "upload_receipts": receipts, "recommended_action": "retain; no deletion performed"})
    payload: dict[str, Any] = {"generated_at": utc_now(), "status": "pass", "packages": rows, "deletion_performed": False, "youtube_mutation": "not_performed"}
    ensure_dir(OPERATIONS_ROOT)
    json_path = OPERATIONS_ROOT / "legacy-package-registry.json"
    md_path = OPERATIONS_ROOT / "legacy-package-registry.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md_path.write_text("# Pattern Lab Legacy Package Registry\n\n" + "\n".join(f"- {row['video_id']}: {row['state']} ({', '.join(row['upload_receipts']) or 'no receipt'})" for row in rows) + "\n\nNo deletion or YouTube mutation was performed.\n", encoding="utf-8")
    print(f"Legacy package registry: {display_path(md_path)}")


if __name__ == "__main__":
    main()

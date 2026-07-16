"""Shared support helpers for local Kalshi paper/read tooling."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

KALSHI_ROOT = Path(__file__).resolve().parents[1]
LOGS_DIR = KALSHI_ROOT / "logs"
DASHBOARD_DIR = KALSHI_ROOT / "dashboard"
PAPER_DECISIONS_PATH = LOGS_DIR / "paper_decisions.jsonl"
PAPER_OUTCOMES_PATH = LOGS_DIR / "paper_outcomes.jsonl"
SHADOW_OUTCOMES_PATH = LOGS_DIR / "shadow_outcomes.jsonl"
PAPER_EPOCH_STATE_PATH = LOGS_DIR / "paper_epoch_state.json"
SCHEDULED_LEARNING_RUNS_PATH = LOGS_DIR / "scheduled_learning_runs.jsonl"
WEATHER_LEARNING_RUNS_PATH = LOGS_DIR / "weather_learning_runs.jsonl"
DASHBOARD_OUTPUT_PATH = LOGS_DIR / "dashboard_output.json"
DASHBOARD_DATA_PATH = DASHBOARD_DIR / "kalshi_dashboard_data.json"
DASHBOARD_HTML_PATH = DASHBOARD_DIR / "kalshi_dashboard.html"
READ_ONLY_MODE = "READ_ONLY"
RECOMMEND_ONLY_MODE = "RECOMMEND_ONLY"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_jsonl(path: str | os.PathLike[str]) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    p = Path(path)
    if not p.exists():
        return records, [f"{p} does not exist"]
    with p.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                warnings.append(f"{p}:{line_number}: invalid JSON: {exc}")
                continue
            if isinstance(record, dict):
                records.append(record)
            else:
                warnings.append(f"{p}:{line_number}: JSONL record is not an object")
    return records, warnings


def append_jsonl(path: str | os.PathLike[str], record: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def atomic_write_json(path: str | os.PathLike[str], payload: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(p)


def success_envelope(
    *,
    script: str,
    path: str,
    data: dict[str, Any],
    status_code: int | None = None,
    url: str | None = None,
    params: dict[str, Any] | None = None,
    mode: str = READ_ONLY_MODE,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "ok": True,
        "status_code": status_code,
        "url": url,
        "request": {"method": "GET", "path": path, "params": params or {}},
        "data": data,
        "error": None,
        "meta": {
            "script": script,
            "mode": mode,
            "timestamp_utc": utc_now(),
            "warnings": warnings or [],
        },
    }


def failure_envelope(
    *,
    script: str,
    path: str,
    exc: BaseException,
    params: dict[str, Any] | None = None,
    mode: str = READ_ONLY_MODE,
) -> dict[str, Any]:
    return {
        "ok": False,
        "status_code": None,
        "url": None,
        "request": {"method": "GET", "path": path, "params": params or {}},
        "data": None,
        "error": {
            "type": type(exc).__name__,
            "message": str(exc),
            "retryable": False,
        },
        "meta": {
            "script": script,
            "mode": mode,
            "timestamp_utc": utc_now(),
            "warnings": [],
        },
    }

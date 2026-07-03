#!/usr/bin/env python3
"""Build the paper-only Kalshi copy/leader shadow status artifact."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from kalshi_support import (  # noqa: E402
    LOGS_DIR,
    READ_ONLY_MODE,
    atomic_write_json,
    failure_envelope,
    load_jsonl,
    parse_utc,
    success_envelope,
    utc_now,
)

SCRIPT = "kalshi_copy_shadow.py"
KALSHI_ROOT = LOGS_DIR.parent
COPY_SHADOW_CONFIG_PATH = KALSHI_ROOT / "kalshi_copy_shadow_config.json"
COPY_SHADOW_STATUS_PATH = KALSHI_ROOT / "kalshi_copy_shadow_status_v1.json"
COPY_SHADOW_SOURCE_DISCOVERY_PATH = KALSHI_ROOT / "kalshi_copy_shadow_source_discovery_v1.json"
COPY_SHADOW_SIGNALS_PATH = LOGS_DIR / "copy_shadow_signals.jsonl"
COPY_SHADOW_OUTCOMES_PATH = LOGS_DIR / "copy_shadow_outcomes.jsonl"

DEFAULT_CONFIG: dict[str, Any] = {
    "schema_version": "copy_shadow_config_v1",
    "mode": "SHADOW_ONLY",
    "target_leader": {
        "leader_name": "Foster McCoy",
        "leader_alias": "Foster",
        "leader_handle": None,
        "verification_status": "public_identity_verified_source_unverified",
        "source_status": "blocked_no_exact_source",
        "evidence_url": "https://www.gq.com/story/prediction-markets-are-eating-the-future-you-can-bet-on-it",
        "evidence_summary": "Public reporting identifies Foster as Foster McCoy and reports unusually strong Kalshi results, but no copyable real-time exact-fill source is verified.",
    },
    "copy_leader_lanes": [
        {
            "lane_id": "foster_exact_fill_shadow",
            "leader_name": "Foster McCoy",
            "leader_alias": "Foster",
            "source_id": "foster-primary",
            "lane_type": "exact_fill_shadow",
            "copy_mode": "exact_fill_when_verified",
            "source_status": "blocked_no_relay",
            "verification_status": "public_identity_verified_source_unverified",
            "enabled": False,
            "exact_copy": True,
            "requires_exact_opt_in_source": True,
            "requires_source_url": True,
            "manipulation_risk_filter_required": False,
            "blockers": [
                "no_verified_exact_opt_in_foster_fill_source",
                "foster_kalshi_handle_unverified",
            ],
            "next_action": "Provide a read-only Foster fill relay URL/token and verify exact-fill schema before enabling shadow intake.",
        },
        {
            "lane_id": "caleb_public_strategy_shadow",
            "leader_name": "Caleb Davies",
            "leader_alias": "Caleb",
            "source_id": "caleb-public-strategy",
            "lane_type": "public_strategy_shadow",
            "copy_mode": "public_strategy_not_exact_copy",
            "source_status": "disabled_pending_public_signal_intake",
            "verification_status": "public_strategy_candidate_unverified",
            "enabled": False,
            "exact_copy": False,
            "requires_exact_opt_in_source": False,
            "requires_source_url": True,
            "manipulation_risk_filter_required": True,
            "blockers": [
                "public_signal_intake_not_configured",
                "manipulation_risk_filter_not_verified",
            ],
            "next_action": "Configure source-backed public signal intake and manipulation-risk filters before accepting Caleb paper signals.",
        },
    ],
    "signal_sources": [
        {
            "source_id": "foster-primary",
            "lane_id": "foster_exact_fill_shadow",
            "leader_name": "Foster McCoy",
            "leader_handle": None,
            "source_type": "pending_verification",
            "verification_status": "public_identity_verified_source_unverified",
            "source_status": "blocked_no_exact_source",
            "exact_fill": False,
            "enabled": False,
            "source_url": None,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "source_id": "caleb-public-strategy",
            "lane_id": "caleb_public_strategy_shadow",
            "leader_name": "Caleb Davies",
            "leader_handle": None,
            "source_type": "public_strategy_signal",
            "verification_status": "public_strategy_candidate_unverified",
            "source_status": "disabled_pending_public_signal_intake",
            "exact_fill": False,
            "enabled": False,
            "source_url": None,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
    ],
    "shadow_bankroll_usd": 100.0,
    "copy_size_mode": "fixed_fraction_or_cap",
    "copy_fraction": 0.1,
    "max_shadow_order_usd": 5.0,
    "max_shadow_open_exposure_usd": 25.0,
    "max_price_drift_cents": 2,
    "max_spread_cents": 4,
    "max_signal_latency_ms": 1_000,
    "min_shadow_days_for_live_review": 30,
    "min_resolved_signals_for_live_review": 200,
    "min_net_pnl_usd_for_live_review": 0.01,
    "require_exact_opt_in_fill_source": True,
    "require_baseline_comparison": True,
    "live_order_allowed": False,
    "auto_live_promotion_allowed": False,
}

REQUIRED_SIGNAL_FIELDS = (
    "signal_id",
    "source_id",
    "leader_handle",
    "source_type",
    "market_ticker",
    "side",
    "price_cents",
    "quantity",
    "leader_filled_at_utc",
    "observed_at_utc",
)

PUBLIC_STRATEGY_REQUIRED_SIGNAL_FIELDS = (
    "signal_id",
    "source_id",
    "leader_name",
    "source_type",
    "source_url",
    "market_ticker",
    "side",
    "price_cents",
    "quantity",
    "reason",
    "observed_at_utc",
)

UNSAFE_FLAG_FIELDS = (
    "live_order_allowed",
    "live_trading_enabled",
    "can_authorize_trade",
    "can_authorize_paper",
    "can_authorize_live",
    "auto_live_promotion_allowed",
    "write_capable_kalshi_endpoint_called",
)

FOSTER_RELAY_REQUIRED_FIELDS = (
    "trade_id",
    "market_ticker",
    "side",
    "action",
    "price_cents",
    "quantity",
    "leader_filled_at_utc",
    "observed_at_utc",
)

PUBLIC_STRATEGY_RISK_FIELDS = (
    "manipulation_risk_flag",
    "promotional_source",
    "position_conflict_unknown",
)


def _finite_money(value: Any) -> float:
    try:
        if value is None or isinstance(value, bool):
            return 0.0
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(number) or math.isinf(number):
        return 0.0
    return round(number, 2)


def _finite_number(value: Any) -> float | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _percent(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 6)


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, int(math.ceil(0.95 * len(sorted_values))) - 1)
    return round(sorted_values[index], 2)


def _latency_ms(start_value: Any, end_value: Any) -> float | None:
    start = parse_utc(start_value)
    end = parse_utc(end_value)
    if start is None or end is None:
        return None
    return max(0.0, (end - start).total_seconds() * 1000.0)


def _load_config(path: Path = COPY_SHADOW_CONFIG_PATH) -> dict[str, Any]:
    if not path.exists():
        return dict(DEFAULT_CONFIG)
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return dict(DEFAULT_CONFIG)
    if not isinstance(parsed, dict):
        return dict(DEFAULT_CONFIG)
    config = {**DEFAULT_CONFIG, **parsed}
    config["live_order_allowed"] = False
    config["auto_live_promotion_allowed"] = False
    return config


def _load_discovery(path: Path = COPY_SHADOW_SOURCE_DISCOVERY_PATH) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _source_rows(config: dict[str, Any], signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sources = config.get("signal_sources") if isinstance(config.get("signal_sources"), list) else []
    source_by_id: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            continue
        source_id = str(source.get("source_id") or source.get("leader_id") or "source")
        source_by_id[source_id] = {
            "source_id": source_id,
            "lane_id": source.get("lane_id"),
            "source_type": str(source.get("source_type") or "unknown"),
            "leader_handle": source.get("leader_handle"),
            "leader_name": source.get("leader_name"),
            "verification_status": str(source.get("verification_status") or "unverified"),
            "source_status": str(source.get("source_status") or ("enabled" if source.get("enabled") is True else "disabled")),
            "source_url": source.get("source_url"),
            "exact_fill": source.get("source_type") == "exact_opt_in_fill" or source.get("exact_fill") is True,
            "enabled": source.get("enabled") is True,
            "signals_seen": 0,
            "eligible_shadow_signals": 0,
            "skipped_signals": 0,
            "last_signal_at_utc": None,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    for signal in signals:
        source_id = str(signal.get("source_id") or signal.get("leader_id") or "unknown")
        row = source_by_id.setdefault(
            source_id,
            {
                "source_id": source_id,
                "lane_id": signal.get("lane_id"),
                "source_type": str(signal.get("source_type") or "unknown"),
                "leader_handle": signal.get("leader_handle"),
                "leader_name": signal.get("leader_name"),
                "verification_status": "unverified",
                "source_status": "signals_without_config",
                "source_url": None,
                "exact_fill": signal.get("source_type") == "exact_opt_in_fill"
                or signal.get("exact_fill_source") is True,
                "enabled": False,
                "signals_seen": 0,
                "eligible_shadow_signals": 0,
                "skipped_signals": 0,
                "last_signal_at_utc": None,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
        )
        row["signals_seen"] = int(row.get("signals_seen") or 0) + 1
        if signal.get("eligible_for_shadow") is True:
            row["eligible_shadow_signals"] = int(row.get("eligible_shadow_signals") or 0) + 1
        else:
            row["skipped_signals"] = int(row.get("skipped_signals") or 0) + 1
        observed_at = signal.get("observed_at_utc") or signal.get("leader_filled_at_utc")
        if observed_at and (row.get("last_signal_at_utc") is None or str(observed_at) > str(row.get("last_signal_at_utc"))):
            row["last_signal_at_utc"] = observed_at
        if signal.get("source_type") == "exact_opt_in_fill" or signal.get("exact_fill_source") is True:
            row["exact_fill"] = True
    return sorted(source_by_id.values(), key=lambda row: (not bool(row.get("enabled")), str(row.get("source_id"))))


def _source_index(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    sources = config.get("signal_sources") if isinstance(config.get("signal_sources"), list) else []
    indexed: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            continue
        source_id = str(source.get("source_id") or source.get("leader_id") or "")
        if source_id:
            indexed[source_id] = source
    return indexed


def _base_validation_receipt(*, validator_id: str, status: str, verified: bool = False) -> dict[str, Any]:
    return {
        "validator_id": validator_id,
        "status": status,
        "verified": verified,
        "schema_passed": False,
        "missing_fields": [],
        "invalid_fields": [],
        "unsafe_true_flags": [],
        "warnings": [],
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
        "can_authorize_trade": False,
        "can_authorize_paper": False,
        "can_authorize_live": False,
        "auto_live_promotion_allowed": False,
        "sts_authority": False,
    }


def parse_fixture_json(text: str, *, validator_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        receipt = _base_validation_receipt(validator_id=validator_id, status="malformed_json")
        receipt["invalid_fields"] = [f"json:{exc.msg}"]
        return None, receipt
    if not isinstance(parsed, dict):
        receipt = _base_validation_receipt(validator_id=validator_id, status="sample_not_object")
        receipt["invalid_fields"] = ["sample_not_object"]
        return None, receipt
    return parsed, None


def validate_foster_relay_sample(sample: dict[str, Any] | None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate a local Foster exact-fill relay fixture without verifying a real relay."""

    config = {**DEFAULT_CONFIG, **(config or {})}
    receipt = _base_validation_receipt(validator_id="foster_relay_fixture", status="no_fixture_sample")
    receipt["source_id"] = "foster-primary"
    receipt["leader_name"] = "Foster McCoy"
    receipt["lane_id"] = "foster_exact_fill_shadow"
    receipt["exact_fill_required"] = True
    receipt["requires_real_source_access"] = True
    receipt["next_action"] = "Provide a real Foster relay URL/token before this can verify an exact source."
    if sample is None:
        return receipt
    if not isinstance(sample, dict):
        receipt["status"] = "sample_not_object"
        receipt["invalid_fields"] = ["sample_not_object"]
        return receipt

    missing = [field for field in FOSTER_RELAY_REQUIRED_FIELDS if sample.get(field) in (None, "")]
    invalid: list[str] = []
    unsafe = [field for field in UNSAFE_FLAG_FIELDS if sample.get(field) is True]
    price = _finite_number(sample.get("price_cents"))
    quantity = _finite_number(sample.get("quantity"))
    if price is None or price <= 0 or price >= 100:
        invalid.append("price_cents")
    if quantity is None or quantity <= 0:
        invalid.append("quantity")
    latency = _finite_number(sample.get("signal_latency_ms"))
    if latency is None:
        latency = _latency_ms(sample.get("leader_filled_at_utc"), sample.get("observed_at_utc"))
    max_latency = float(config.get("max_signal_latency_ms") or DEFAULT_CONFIG["max_signal_latency_ms"])
    if latency is None:
        invalid.append("signal_latency_ms")
    elif latency > max_latency:
        invalid.append("signal_latency_too_slow")

    receipt.update(
        {
            "status": "schema_failed" if missing or invalid or unsafe else "fixture_schema_passed_real_source_blocked",
            "schema_passed": not missing and not invalid and not unsafe,
            "missing_fields": missing,
            "invalid_fields": invalid,
            "unsafe_true_flags": unsafe,
            "latency_ms": round(latency, 2) if latency is not None else None,
            "verified": False,
        }
    )
    return receipt


def validate_caleb_public_signal_sample(sample: dict[str, Any] | None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate a local Caleb public-strategy fixture without enabling the lane."""

    config = {**DEFAULT_CONFIG, **(config or {})}
    receipt = _base_validation_receipt(validator_id="caleb_public_signal_fixture", status="no_fixture_sample")
    receipt["source_id"] = "caleb-public-strategy"
    receipt["leader_name"] = "Caleb Davies"
    receipt["lane_id"] = "caleb_public_strategy_shadow"
    receipt["exact_copy"] = False
    receipt["requires_source_url"] = True
    receipt["next_action"] = "Provide source-backed Caleb public signal URLs before collecting real paper signals."
    if sample is None:
        return receipt
    if not isinstance(sample, dict):
        receipt["status"] = "sample_not_object"
        receipt["invalid_fields"] = ["sample_not_object"]
        return receipt

    missing = [field for field in PUBLIC_STRATEGY_REQUIRED_SIGNAL_FIELDS if sample.get(field) in (None, "")]
    invalid: list[str] = []
    unsafe = [field for field in UNSAFE_FLAG_FIELDS if sample.get(field) is True]
    risk_flags = [field for field in PUBLIC_STRATEGY_RISK_FIELDS if sample.get(field) is True]
    if sample.get("source_type") not in (None, "public_strategy_signal"):
        invalid.append("source_type")
    price = _finite_number(sample.get("price_cents"))
    quantity = _finite_number(sample.get("quantity"))
    if price is None or price <= 0 or price >= 100:
        invalid.append("price_cents")
    if quantity is None or quantity <= 0:
        invalid.append("quantity")
    latency = _finite_number(sample.get("signal_latency_ms"))
    max_latency = float(config.get("max_signal_latency_ms") or DEFAULT_CONFIG["max_signal_latency_ms"])
    if latency is not None and latency > max_latency:
        invalid.append("signal_latency_too_slow")

    receipt.update(
        {
            "status": "schema_failed" if missing or invalid or unsafe or risk_flags else "fixture_schema_passed_real_source_blocked",
            "schema_passed": not missing and not invalid and not unsafe and not risk_flags,
            "missing_fields": missing,
            "invalid_fields": invalid,
            "unsafe_true_flags": unsafe,
            "risk_flags": risk_flags,
            "verified": False,
        }
    )
    return receipt


def validate_signal_log_records(
    signals: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
    *,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    """Read-only validation for append-only copy-shadow signal log records."""

    config = {**DEFAULT_CONFIG, **(config or {})}
    receipt = _base_validation_receipt(validator_id="copy_shadow_signal_log", status="empty_log")
    receipt["path"] = "work/scripts/kalshi/logs/copy_shadow_signals.jsonl"
    receipt["record_count"] = len(signals)
    receipt["accepted_record_count"] = 0
    receipt["rejected_record_count"] = 0
    receipt["duplicate_signal_ids"] = []
    receipt["rejection_reasons"] = {}
    receipt["warnings"] = list(warnings or [])
    if not signals:
        receipt["schema_passed"] = True
        return receipt

    seen: set[str] = set()
    rejected = 0
    accepted = 0
    duplicate_ids: list[str] = []
    reasons: dict[str, int] = {}
    unsafe: set[str] = set()
    max_latency = float(config.get("max_signal_latency_ms") or DEFAULT_CONFIG["max_signal_latency_ms"])
    max_spread = float(config.get("max_spread_cents") or DEFAULT_CONFIG["max_spread_cents"])
    max_drift = float(config.get("max_price_drift_cents") or DEFAULT_CONFIG["max_price_drift_cents"])

    for signal in signals:
        signal_id = str(signal.get("signal_id") or signal.get("fill_id") or signal.get("id") or "")
        record_reasons: list[str] = []
        if not signal_id:
            record_reasons.append("missing_signal_id")
        elif signal_id in seen:
            duplicate_ids.append(signal_id)
            record_reasons.append("duplicate_signal_id")
        if signal_id:
            seen.add(signal_id)

        source_type = str(signal.get("source_type") or "")
        required = PUBLIC_STRATEGY_REQUIRED_SIGNAL_FIELDS if source_type == "public_strategy_signal" else REQUIRED_SIGNAL_FIELDS
        record_reasons.extend(f"missing_{field}" for field in required if signal.get(field) in (None, ""))
        for field in UNSAFE_FLAG_FIELDS:
            if signal.get(field) is True:
                unsafe.add(field)
                record_reasons.append(f"unsafe_{field}")
        for field in PUBLIC_STRATEGY_RISK_FIELDS:
            if signal.get(field) is True:
                record_reasons.append(f"public_strategy_{field}")
        latency = _finite_number(signal.get("signal_latency_ms"))
        if latency is None:
            latency = _latency_ms(signal.get("leader_filled_at_utc"), signal.get("observed_at_utc"))
        if latency is None:
            record_reasons.append("signal_latency_missing")
        elif latency > max_latency:
            record_reasons.append("signal_latency_too_slow")
        spread = _finite_number(signal.get("spread_cents"))
        if spread is None:
            record_reasons.append("spread_missing")
        elif spread > max_spread:
            record_reasons.append("spread_too_wide")
        drift = _finite_number(signal.get("price_drift_cents"))
        if drift is None:
            record_reasons.append("price_drift_missing")
        elif abs(drift) > max_drift:
            record_reasons.append("price_drift_too_large")

        if record_reasons:
            rejected += 1
            for reason in record_reasons:
                reasons[reason] = int(reasons.get(reason) or 0) + 1
        else:
            accepted += 1

    receipt.update(
        {
            "status": "passed" if rejected == 0 else "failed",
            "schema_passed": rejected == 0,
            "accepted_record_count": accepted,
            "rejected_record_count": rejected,
            "duplicate_signal_ids": duplicate_ids,
            "rejection_reasons": dict(sorted(reasons.items())),
            "unsafe_true_flags": sorted(unsafe),
        }
    )
    return receipt


def _copy_leader_lanes(config: dict[str, Any]) -> list[dict[str, Any]]:
    lanes = config.get("copy_leader_lanes") if isinstance(config.get("copy_leader_lanes"), list) else []
    if lanes:
        return [lane for lane in lanes if isinstance(lane, dict)]
    target = config.get("target_leader") if isinstance(config.get("target_leader"), dict) else DEFAULT_CONFIG["target_leader"]
    return [
        {
            "lane_id": "foster_exact_fill_shadow",
            "leader_name": target.get("leader_name") or "Foster McCoy",
            "leader_alias": target.get("leader_alias") or "Foster",
            "source_id": "foster-primary",
            "lane_type": "exact_fill_shadow",
            "copy_mode": "exact_fill_when_verified",
            "source_status": target.get("source_status") or "blocked_no_exact_source",
            "verification_status": target.get("verification_status") or "public_identity_verified_source_unverified",
            "enabled": False,
            "exact_copy": True,
            "requires_exact_opt_in_source": True,
            "requires_source_url": True,
            "manipulation_risk_filter_required": False,
            "blockers": [
                "no_verified_exact_opt_in_foster_fill_source",
                "foster_kalshi_handle_unverified",
            ],
            "next_action": "Provide a read-only Foster fill relay URL/token and verify exact-fill schema before enabling shadow intake.",
        }
    ]


def _lane_rows(
    config: dict[str, Any],
    signals: list[dict[str, Any]],
    outcomes: list[dict[str, Any]],
    source_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    source_by_id = {str(source.get("source_id")): source for source in source_rows if source.get("source_id")}
    rows: list[dict[str, Any]] = []
    for lane in _copy_leader_lanes(config):
        lane_id = str(lane.get("lane_id") or lane.get("source_id") or "leader_lane")
        source_id = str(lane.get("source_id") or "")
        source = source_by_id.get(source_id, {})
        lane_signals = [
            signal
            for signal in signals
            if signal.get("lane_id") == lane_id or (source_id and str(signal.get("source_id") or "") == source_id)
        ]
        eligible = [signal for signal in lane_signals if signal.get("eligible_for_shadow") is True]
        lane_outcomes = [
            outcome
            for outcome in outcomes
            if outcome.get("lane_id") == lane_id or (source_id and str(outcome.get("source_id") or "") == source_id)
        ]
        resolved = [outcome for outcome in lane_outcomes if outcome.get("resolved") is True]
        net_pnl = round(sum(_finite_money(outcome.get("shadow_pnl_usd", outcome.get("pnl_usd"))) for outcome in resolved), 2)
        exact_copy = lane.get("exact_copy") is True or source.get("exact_fill") is True
        source_enabled = source.get("enabled") is True or lane.get("enabled") is True
        source_verified = source.get("verification_status") == "verified" or lane.get("verification_status") == "verified"
        blockers: list[str] = []
        for blocker in lane.get("blockers") if isinstance(lane.get("blockers"), list) else []:
            if isinstance(blocker, str) and blocker not in blockers:
                blockers.append(blocker)
        if exact_copy and not (source_enabled and source_verified and source.get("exact_fill") is True):
            for blocker in ("no_verified_exact_opt_in_foster_fill_source", "foster_kalshi_handle_unverified"):
                if blocker not in blockers:
                    blockers.append(blocker)
        if not exact_copy and not source_enabled and "public_signal_intake_not_enabled" not in blockers:
            blockers.append("public_signal_intake_not_enabled")
        if not source_verified and "source_not_verified" not in blockers:
            blockers.append("source_not_verified")
        rows.append(
            {
                "lane_id": lane_id,
                "leader_name": lane.get("leader_name"),
                "leader_alias": lane.get("leader_alias"),
                "source_id": source_id or None,
                "lane_type": lane.get("lane_type") or ("exact_fill_shadow" if exact_copy else "public_strategy_shadow"),
                "copy_mode": lane.get("copy_mode") or ("exact_fill_when_verified" if exact_copy else "public_strategy_not_exact_copy"),
                "source_status": source.get("source_status") or lane.get("source_status") or "disabled",
                "verification_status": source.get("verification_status") or lane.get("verification_status") or "unverified",
                "enabled": source_enabled,
                "exact_copy": exact_copy,
                "requires_exact_opt_in_source": lane.get("requires_exact_opt_in_source") is True,
                "requires_source_url": lane.get("requires_source_url") is True,
                "manipulation_risk_filter_required": lane.get("manipulation_risk_filter_required") is True,
                "copyable_now": bool(source_enabled and source_verified and (source.get("exact_fill") is True or not exact_copy)),
                "shadow_bankroll_usd": _finite_money(config.get("shadow_bankroll_usd")),
                "max_shadow_order_usd": _finite_money(config.get("max_shadow_order_usd")),
                "max_shadow_open_exposure_usd": _finite_money(config.get("max_shadow_open_exposure_usd")),
                "signals_seen": len(lane_signals),
                "eligible_shadow_signals": len(eligible),
                "skipped_signals": max(0, len(lane_signals) - len(eligible)),
                "resolved_signals": len(resolved),
                "net_shadow_pnl_usd": net_pnl,
                "blockers": blockers,
                "next_action": lane.get("next_action"),
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
                "live_trading_enabled": False,
                "write_capable_kalshi_endpoint_called": False,
            }
        )
    return rows


def _copy_signal_decision(signal: dict[str, Any], config: dict[str, Any], source_by_id: dict[str, dict[str, Any]]) -> tuple[bool, str]:
    """Return whether a signal is eligible for shadow-copying and the reason."""

    source_id = str(signal.get("source_id") or signal.get("leader_id") or "")
    source = source_by_id.get(source_id)
    source_type = str(signal.get("source_type") or (source or {}).get("source_type") or "")
    required_fields = PUBLIC_STRATEGY_REQUIRED_SIGNAL_FIELDS if source_type == "public_strategy_signal" else REQUIRED_SIGNAL_FIELDS
    for field in required_fields:
        if signal.get(field) in (None, ""):
            return False, f"missing_{field}"
    for field in UNSAFE_FLAG_FIELDS:
        if signal.get(field) is True:
            return False, f"unsafe_{field}"

    if not source:
        return False, "source_not_configured"
    if source.get("enabled") is not True:
        return False, "source_disabled"
    if source.get("verification_status") != "verified":
        return False, "source_not_verified"
    if source_type == "public_strategy_signal":
        if source.get("source_type") != "public_strategy_signal":
            return False, "source_not_public_strategy_signal"
        for risk_field in ("manipulation_risk_flag", "promotional_source", "position_conflict_unknown"):
            if signal.get(risk_field) is True:
                return False, f"public_strategy_{risk_field}"
    else:
        if source.get("source_type") != "exact_opt_in_fill" and source.get("exact_fill") is not True:
            return False, "source_not_exact_opt_in_fill"
        if signal.get("source_type") != "exact_opt_in_fill" and signal.get("exact_fill_source") is not True:
            return False, "signal_not_exact_fill"

    signal_latency = _finite_number(signal.get("signal_latency_ms"))
    if signal_latency is None:
        leader_filled_at = parse_utc(signal.get("leader_filled_at_utc"))
        observed_at = parse_utc(signal.get("observed_at_utc"))
        if leader_filled_at is not None and observed_at is not None:
            signal_latency = max(0.0, (observed_at - leader_filled_at).total_seconds() * 1000.0)
    max_signal_latency = float(config.get("max_signal_latency_ms") or DEFAULT_CONFIG["max_signal_latency_ms"])
    if signal_latency is None:
        return False, "signal_latency_missing"
    if signal_latency > max_signal_latency:
        return False, "signal_latency_too_slow"

    spread = _finite_number(signal.get("spread_cents"))
    max_spread = float(config.get("max_spread_cents") or DEFAULT_CONFIG["max_spread_cents"])
    if spread is None:
        return False, "spread_missing"
    if spread > max_spread:
        return False, "spread_too_wide"

    drift = _finite_number(signal.get("price_drift_cents"))
    max_drift = float(config.get("max_price_drift_cents") or DEFAULT_CONFIG["max_price_drift_cents"])
    if drift is None:
        return False, "price_drift_missing"
    if abs(drift) > max_drift:
        return False, "price_drift_too_large"

    price = _finite_number(signal.get("price_cents"))
    quantity = _finite_number(signal.get("quantity"))
    if price is None or price <= 0 or price >= 100:
        return False, "price_out_of_bounds"
    if quantity is None or quantity <= 0:
        return False, "quantity_out_of_bounds"

    return True, "eligible"


def build_copy_shadow_status(
    *,
    config: dict[str, Any] | None = None,
    signals: list[dict[str, Any]] | None = None,
    outcomes: list[dict[str, Any]] | None = None,
    source_discovery: dict[str, Any] | None = None,
    signal_log_warnings: list[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return the no-live shadow-copy status payload from local logs/config."""

    config = {**DEFAULT_CONFIG, **(config or {})}
    config["live_order_allowed"] = False
    config["auto_live_promotion_allowed"] = False
    signals = signals or []
    outcomes = outcomes or []
    source_discovery = source_discovery if isinstance(source_discovery, dict) else {}
    now = now or datetime.now(timezone.utc)

    unsafe_true_flags = [
        field
        for field in UNSAFE_FLAG_FIELDS
        if config.get(field) is True or any(record.get(field) is True for record in signals + outcomes)
    ]

    source_by_id = _source_index(config)
    seen_signal_ids: set[str] = set()
    duplicate_signal_count = 0
    signal_decisions: list[dict[str, Any]] = []
    skip_reasons: dict[str, int] = {}
    for signal in signals:
        signal_id = str(signal.get("signal_id") or signal.get("fill_id") or signal.get("id") or "")
        if signal_id and signal_id in seen_signal_ids:
            eligible, reason = False, "duplicate_signal_id"
            duplicate_signal_count += 1
        else:
            eligible, reason = _copy_signal_decision(signal, config, source_by_id)
        if signal_id:
            seen_signal_ids.add(signal_id)
        if not eligible:
            skip_reasons[reason] = int(skip_reasons.get(reason) or 0) + 1
        signal_decisions.append(
            {
                "signal_id": signal_id or None,
                "source_id": signal.get("source_id") or signal.get("leader_id"),
                "lane_id": signal.get("lane_id"),
                "leader_handle": signal.get("leader_handle"),
                "leader_name": signal.get("leader_name"),
                "source_type": signal.get("source_type"),
                "eligible_for_shadow": eligible,
                "decision": "copy_shadow" if eligible else "skip",
                "reason": reason,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )
        signal["eligible_for_shadow"] = eligible
        signal["shadow_action"] = "COPY_SHADOW" if eligible else "SKIP_SHADOW"
        signal["skip_reason"] = None if eligible else reason

    resolved_outcomes = [outcome for outcome in outcomes if outcome.get("resolved") is True]
    wins = sum(1 for outcome in resolved_outcomes if outcome.get("shadow_won") is True or outcome.get("won") is True)
    losses = sum(1 for outcome in resolved_outcomes if outcome.get("shadow_won") is False or outcome.get("won") is False)
    net_pnl = round(sum(_finite_money(outcome.get("shadow_pnl_usd", outcome.get("pnl_usd"))) for outcome in resolved_outcomes), 2)

    eligible_signals = [signal for signal in signals if signal.get("eligible_for_shadow") is True]
    skipped_signals = max(0, len(signals) - len(eligible_signals))
    latencies = [
        number
        for number in (_finite_number(signal.get("signal_latency_ms")) for signal in signals)
        if number is not None
    ]
    submit_latencies = [
        number
        for number in (_finite_number(signal.get("decision_latency_ms")) for signal in signals)
        if number is not None
    ]
    price_drifts = [
        abs(number)
        for number in (_finite_number(signal.get("price_drift_cents")) for signal in signals)
        if number is not None
    ]
    spreads = [
        number
        for number in (_finite_number(signal.get("spread_cents")) for signal in signals)
        if number is not None
    ]

    first_signal_at = None
    latest_signal_at = None
    for signal in signals:
        parsed = parse_utc(signal.get("observed_at_utc") or signal.get("leader_filled_at_utc"))
        if parsed is None:
            continue
        if first_signal_at is None or parsed < first_signal_at:
            first_signal_at = parsed
        if latest_signal_at is None or parsed > latest_signal_at:
            latest_signal_at = parsed
    observed_days = 0.0
    if first_signal_at and latest_signal_at:
        observed_days = round(max(0.0, (latest_signal_at - first_signal_at).total_seconds() / 86_400.0), 3)

    source_rows = _source_rows(config, signals)
    leader_lanes = _lane_rows(config, signals, outcomes, source_rows)
    source_health = {
        "foster_relay_verifier": validate_foster_relay_sample(None, config),
        "caleb_public_signal_verifier": validate_caleb_public_signal_sample(None, config),
        "signal_log_validator": validate_signal_log_records(signals, config, warnings=signal_log_warnings),
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
        "auto_live_promotion_allowed": False,
    }
    discovery_exact_source = (
        source_discovery.get("copyable_exact_source")
        if isinstance(source_discovery.get("copyable_exact_source"), dict)
        else {}
    )
    discovery_public_identity = (
        source_discovery.get("public_identity") if isinstance(source_discovery.get("public_identity"), dict) else {}
    )
    discovery_probe = (
        source_discovery.get("authenticated_read_probe")
        if isinstance(source_discovery.get("authenticated_read_probe"), dict)
        else {}
    )
    source_discovery_summary = {
        "artifact_path": "work/scripts/kalshi/kalshi_copy_shadow_source_discovery_v1.json",
        "artifact_exists": bool(source_discovery),
        "generated_at_utc": source_discovery.get("generated_at_utc"),
        "status": discovery_exact_source.get("status") or "not_run",
        "public_identity_verified": discovery_public_identity.get("verified") is True,
        "authenticated_read_ok": discovery_probe.get("ok") is True,
        "authenticated_read_attempted": discovery_probe.get("attempted") is True,
        "copyable_exact_source_verified": discovery_exact_source.get("verified") is True,
        "blockers": discovery_exact_source.get("blockers")
        if isinstance(discovery_exact_source.get("blockers"), list)
        else [],
        "next_action": source_discovery.get("next_action")
        or "Run kalshi_copy_shadow_source_discovery.py before enabling any Foster source.",
        "milestones": source_discovery.get("milestones") if isinstance(source_discovery.get("milestones"), list) else [],
        "candidate_sources_reviewed": source_discovery.get("candidate_sources_reviewed")
        if isinstance(source_discovery.get("candidate_sources_reviewed"), list)
        else [],
        "approval_required_actions": source_discovery.get("approval_required_actions")
        if isinstance(source_discovery.get("approval_required_actions"), list)
        else [],
        "overall_completion_percentage": source_discovery.get("overall_completion_percentage"),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }
    exact_source_count = sum(1 for row in source_rows if row.get("enabled") is True and row.get("exact_fill") is True)
    verified_exact_source_count = sum(
        1
        for row in source_rows
        if row.get("enabled") is True and row.get("exact_fill") is True and row.get("verification_status") == "verified"
    )
    resolved_count = len(resolved_outcomes)
    baseline_comparison = config.get("baseline_comparison") if isinstance(config.get("baseline_comparison"), dict) else {}
    baseline_passed = (
        baseline_comparison.get("beats_current_strategy") is True
        and baseline_comparison.get("beats_market_implied") is True
        and baseline_comparison.get("beats_no_trade") is True
    )
    min_resolved = int(config.get("min_resolved_signals_for_live_review") or DEFAULT_CONFIG["min_resolved_signals_for_live_review"])
    min_days = int(config.get("min_shadow_days_for_live_review") or DEFAULT_CONFIG["min_shadow_days_for_live_review"])
    max_signal_latency = float(config.get("max_signal_latency_ms") or DEFAULT_CONFIG["max_signal_latency_ms"])
    max_price_drift = float(config.get("max_price_drift_cents") or DEFAULT_CONFIG["max_price_drift_cents"])
    max_spread = float(config.get("max_spread_cents") or DEFAULT_CONFIG["max_spread_cents"])

    p95_signal_latency = _p95(latencies)
    avg_submit_latency = round(sum(submit_latencies) / len(submit_latencies), 2) if submit_latencies else None
    avg_price_drift = round(sum(price_drifts) / len(price_drifts), 2) if price_drifts else None
    avg_spread = round(sum(spreads) / len(spreads), 2) if spreads else None

    gates = [
        {
            "gate_id": "exact_opt_in_source",
            "label": "Exact opt-in fill source",
            "status": "passed" if verified_exact_source_count > 0 else "blocked",
            "detail": "At least one verified consenting leader must publish exact private fills.",
            "blocker": None
            if verified_exact_source_count > 0
            else ("exact_source_unverified" if exact_source_count > 0 else "no_exact_opt_in_fill_source"),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "sample_size",
            "label": "Resolved copied signals",
            "status": "passed" if resolved_count >= min_resolved else "blocked",
            "detail": f"{resolved_count} resolved / {min_resolved} required before live review.",
            "blocker": None if resolved_count >= min_resolved else "copy_shadow_sample_too_small",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "time_in_shadow",
            "label": "Shadow duration",
            "status": "passed" if observed_days >= min_days else "blocked",
            "detail": f"{observed_days:g} observed days / {min_days} required.",
            "blocker": None if observed_days >= min_days else "shadow_duration_too_short",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "latency",
            "label": "Near-instant latency",
            "status": "passed" if p95_signal_latency is not None and p95_signal_latency <= max_signal_latency else "blocked",
            "detail": "p95 signal latency must stay under the configured threshold.",
            "blocker": None if p95_signal_latency is not None and p95_signal_latency <= max_signal_latency else "latency_unproven_or_too_slow",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "execution_quality",
            "label": "Execution quality",
            "status": "passed"
            if avg_price_drift is not None
            and avg_spread is not None
            and avg_price_drift <= max_price_drift
            and avg_spread <= max_spread
            else "blocked",
            "detail": "Average drift and spread must stay inside copy limits.",
            "blocker": None
            if avg_price_drift is not None
            and avg_spread is not None
            and avg_price_drift <= max_price_drift
            and avg_spread <= max_spread
            else "execution_quality_unproven",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "profit_after_costs",
            "label": "Profit after costs",
            "status": "passed" if resolved_count > 0 and net_pnl > 0 else "blocked",
            "detail": f"Net shadow P&L after modeled costs: ${net_pnl:.2f}.",
            "blocker": None if resolved_count > 0 and net_pnl > 0 else "profit_after_costs_not_proven",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "baseline_comparison",
            "label": "Baseline comparison",
            "status": "passed" if baseline_passed else "blocked",
            "detail": "Copied signals must beat current strategy, market-implied, and no-trade baselines.",
            "blocker": None if baseline_passed else "baseline_comparison_not_proven",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "paper_only_wall",
            "label": "Paper-only wall",
            "status": "passed" if not unsafe_true_flags else "blocked",
            "detail": "This lane cannot place live orders or mutate Kalshi account state.",
            "blocker": None if not unsafe_true_flags else "unsafe_true_flags_detected",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
    ]

    passed_gates = sum(1 for gate in gates if gate["status"] == "passed")
    readiness_score = round((passed_gates / len(gates)) * 100.0, 1)
    status = "blocked_no_source" if exact_source_count == 0 else "blocked_source_unverified"
    if verified_exact_source_count > 0:
        status = "shadow_collecting"
    if unsafe_true_flags:
        status = "unsafe_blocked"
    elif resolved_count >= min_resolved and observed_days >= min_days and net_pnl > 0 and baseline_passed and passed_gates == len(gates):
        status = "live_review_candidate_manual_only"

    return {
        "ok": not unsafe_true_flags,
        "schema_version": "copy_shadow_status_v1",
        "generated_at_utc": utc_now(),
        "mode": "SHADOW_ONLY",
        "status": status,
        "shadow_bankroll_usd": _finite_money(config.get("shadow_bankroll_usd")),
        "target_leader": {
            **(
                config.get("target_leader")
                if isinstance(config.get("target_leader"), dict)
                else DEFAULT_CONFIG["target_leader"]
            ),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "source_discovery": source_discovery_summary,
        "recommended_initial_live_order_usd": 1.0,
        "max_recommended_initial_live_order_usd": 5.0,
        "readiness_score": readiness_score,
        "summary": {
            "signals_seen": len(signals),
            "eligible_shadow_signals": len(eligible_signals),
            "skipped_signals": skipped_signals,
            "resolved_signals": resolved_count,
            "wins": wins,
            "losses": losses,
            "win_rate": _percent(wins, wins + losses),
            "net_shadow_pnl_usd": net_pnl,
            "unresolved_signals": max(0, len(eligible_signals) - resolved_count),
            "observed_days": observed_days,
            "exact_opt_in_source_count": exact_source_count,
            "verified_exact_opt_in_source_count": verified_exact_source_count,
            "source_count": len(source_rows),
            "leader_lane_count": len(leader_lanes),
            "active_leader_lane_count": sum(1 for lane in leader_lanes if lane.get("enabled") is True),
            "duplicate_signal_count": duplicate_signal_count,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "latency": {
            "p95_signal_latency_ms": p95_signal_latency,
            "average_decision_latency_ms": avg_submit_latency,
            "max_signal_latency_ms": max_signal_latency,
            "near_instant_target_ms": max_signal_latency,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "execution_quality": {
            "average_price_drift_cents": avg_price_drift,
            "average_spread_cents": avg_spread,
            "max_price_drift_cents": max_price_drift,
            "max_spread_cents": max_spread,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "risk_controls": {
            "copy_size_mode": config.get("copy_size_mode"),
            "copy_fraction": _finite_number(config.get("copy_fraction")),
            "max_shadow_order_usd": _finite_money(config.get("max_shadow_order_usd")),
            "max_shadow_open_exposure_usd": _finite_money(config.get("max_shadow_open_exposure_usd")),
            "kill_switch_required": True,
            "limit_orders_only": True,
            "market_orders_allowed": False,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "signal_quality": {
            "required_fields": list(REQUIRED_SIGNAL_FIELDS),
            "public_strategy_required_fields": list(PUBLIC_STRATEGY_REQUIRED_SIGNAL_FIELDS),
            "skip_reasons": dict(sorted(skip_reasons.items())),
            "recent_decisions": signal_decisions[-10:],
            "duplicate_signal_count": duplicate_signal_count,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "source_health": source_health,
        "leader_lanes": leader_lanes,
        "sources": source_rows[:10],
        "readiness_gates": gates,
        "next_action": "Verify Foster McCoy's exact real-time source and configure Caleb Davies public-signal intake only after source-backed manipulation filters pass."
        if verified_exact_source_count == 0
        else "Keep collecting Foster McCoy shadow signals; do not request live review until every gate passes with resolved outcomes.",
        "plain_english": "Copy-leader paper mode is configured with a Foster exact-fill lane and a Caleb public-strategy lane. Both remain shadow-only and disabled until their source proof gates pass.",
        "artifact_path": "work/scripts/kalshi/kalshi_copy_shadow_status_v1.json",
        "config_path": "work/scripts/kalshi/kalshi_copy_shadow_config.json",
        "source_discovery_path": "work/scripts/kalshi/kalshi_copy_shadow_source_discovery_v1.json",
        "signals_log_path": "work/scripts/kalshi/logs/copy_shadow_signals.jsonl",
        "outcomes_log_path": "work/scripts/kalshi/logs/copy_shadow_outcomes.jsonl",
        "unsafe_true_flags": unsafe_true_flags,
        "write_capable_kalshi_endpoint_called": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "can_authorize_trade": False,
        "can_authorize_paper": False,
        "can_authorize_live": False,
        "auto_live_promotion_allowed": False,
        "sts_authority": False,
    }


def build_status_from_disk() -> tuple[dict[str, Any], list[str]]:
    config = _load_config()
    source_discovery = _load_discovery()
    signals, signal_warnings = load_jsonl(COPY_SHADOW_SIGNALS_PATH)
    outcomes, outcome_warnings = load_jsonl(COPY_SHADOW_OUTCOMES_PATH)
    return (
        build_copy_shadow_status(
            config=config,
            signals=signals,
            outcomes=outcomes,
            source_discovery=source_discovery,
            signal_log_warnings=signal_warnings,
        ),
        signal_warnings + outcome_warnings,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the paper-only Kalshi copy-shadow status artifact.")
    parser.add_argument("--init-config", action="store_true", help="Write the default copy-shadow config if it does not exist.")
    args = parser.parse_args(argv)
    try:
        if args.init_config and not COPY_SHADOW_CONFIG_PATH.exists():
            atomic_write_json(COPY_SHADOW_CONFIG_PATH, DEFAULT_CONFIG)
        status, warnings = build_status_from_disk()
        atomic_write_json(COPY_SHADOW_STATUS_PATH, status)
        print(
            json.dumps(
                success_envelope(
                    script=SCRIPT,
                    path=str(COPY_SHADOW_STATUS_PATH),
                    data=status,
                    mode=READ_ONLY_MODE,
                    warnings=warnings,
                ),
                sort_keys=True,
            )
        )
        return 0
    except Exception as exc:  # pragma: no cover - defensive CLI envelope
        print(json.dumps(failure_envelope(script=SCRIPT, path=str(COPY_SHADOW_STATUS_PATH), exc=exc), sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate the read-only Kalshi dashboard snapshot from append-only paper logs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from kalshi_support import (  # noqa: E402
    DASHBOARD_DATA_PATH,
    DASHBOARD_HTML_PATH,
    DASHBOARD_OUTPUT_PATH,
    LOGS_DIR,
    PAPER_DECISIONS_PATH,
    PAPER_EPOCH_STATE_PATH,
    PAPER_OUTCOMES_PATH,
    READ_ONLY_MODE,
    SHADOW_OUTCOMES_PATH,
    atomic_write_json,
    failure_envelope,
    load_jsonl,
    parse_utc,
    success_envelope,
    utc_now,
)
from kalshi_sts_common import (  # noqa: E402
    STS_ARTIFACT_PATH,
    STS_BACKTEST_PATH,
    STS_EXPERIMENTS_PATH,
    STS_FEATURE_SUMMARY_PATH,
    STS_FORWARD_PAPER_PROMOTION_PATH,
    STS_READINESS_ETA_PATH,
    STS_DOMAIN_OPTIMIZER_PATH,
            STS_AGENT_AUDIT_PATH,
    STS_CRYPTO_FRESH_CYCLE_PATH,
    STS_CRYPTO_FRESH_WINDOW_DIAGNOSTICS_PATH,
    STS_DOMAIN_LEARNING_OPTIMIZER_PATH,
    STS_CRYPTO_EVIDENCE_REPAIR_PATH,
    STS_CRYPTO_BASELINE_CALIBRATION_PATH,
    STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH,
    STS_CRYPTO_SEGMENT_EDGE_PATH,
    STS_CRYPTO_EXECUTION_REALISM_PATH,
    STS_CRYPTO_EXECUTION_SELECTOR_PATH,
    STS_CRYPTO_EXECUTION_SELECTOR_OUTCOMES_PATH,
    STS_CRYPTO_REGIME_SELECTOR_PATH,
    STS_CRYPTO_REGIME_SELECTOR_OUTCOMES_PATH,
    STS_CRYPTO_REGIME_INVERSE_REPAIR_PATH,
    STS_UNLOCK_QUEUE_PATH,
    STS_WEATHER_SELECTOR_REPAIR_PATH,
    STS_MODEL_PATH,
    STS_OBSERVABILITY_PATH,
    fallback_artifact,
    live_false,
)

SCRIPT = "kalshi_dashboard.py"
KALSHI_SCRIPT_ROOT = LOGS_DIR.parent
REPO_KALSHI_PREFIX = "work/scripts/kalshi/"
APPROVED_SPORTS_SOURCE_PATH = "work/scripts/kalshi/approved_sports_local_source_collection_rows_v1.jsonl"
TIMESFM_DIAGNOSTIC_REPO_PATH = "work/scripts/kalshi/logs/timesfm_diagnostic.json"
TIMESFM_DIAGNOSTIC_PATH = LOGS_DIR / "timesfm_diagnostic.json"
MLX_DIAGNOSTIC_REPO_PATH = "work/scripts/kalshi/logs/mlx_diagnostic.json"
MLX_DIAGNOSTIC_PATH = LOGS_DIR / "mlx_diagnostic.json"
CRYPTO_PERSISTENCE_JOURNAL_REVIEW_REPO_PATH = "work/scripts/kalshi/logs/crypto_persistence_journal_review.json"
CRYPTO_PERSISTENCE_JOURNAL_REVIEW_PATH = LOGS_DIR / "crypto_persistence_journal_review.json"
CRYPTO_SETTLEMENT_ORACLE_REPO_PATH = "work/scripts/kalshi/logs/crypto_settlement_oracle/settlement_oracle_latest.json"
CRYPTO_SETTLEMENT_ORACLE_PATH = LOGS_DIR / "crypto_settlement_oracle" / "settlement_oracle_latest.json"
CRYPTO_SETTLEMENT_ORACLE_READINESS_REPO_PATH = "work/scripts/kalshi/logs/crypto_settlement_oracle/settlement_oracle_replay_power_readiness.json"
CRYPTO_SETTLEMENT_ORACLE_READINESS_PATH = LOGS_DIR / "crypto_settlement_oracle" / "settlement_oracle_replay_power_readiness.json"
KALSHI_NONLIVE_RUNNER_SUMMARY_REPO_PATH = "work/scripts/kalshi/kalshi_nonlive_openclaw_runner_summary_v1.json"
KALSHI_NONLIVE_RUNNER_SUMMARY_PATH = KALSHI_SCRIPT_ROOT / "kalshi_nonlive_openclaw_runner_summary_v1.json"
KALSHI_COPY_SHADOW_STATUS_REPO_PATH = "work/scripts/kalshi/kalshi_copy_shadow_status_v1.json"
KALSHI_COPY_SHADOW_STATUS_PATH = KALSHI_SCRIPT_ROOT / "kalshi_copy_shadow_status_v1.json"
KALSHI_COPY_SHADOW_SOURCE_DISCOVERY_REPO_PATH = "work/scripts/kalshi/kalshi_copy_shadow_source_discovery_v1.json"
KALSHI_COPY_SHADOW_SOURCE_DISCOVERY_PATH = KALSHI_SCRIPT_ROOT / "kalshi_copy_shadow_source_discovery_v1.json"
KALSHI_V12_SOURCE_BOTTLENECK_AUDIT_REPO_PATH = "work/scripts/kalshi/crypto_milestone_16et_v12_source_bottleneck_audit_non_doge_collection_plan_v1.json"
KALSHI_V12_SOURCE_BOTTLENECK_AUDIT_PATH = KALSHI_SCRIPT_ROOT / "crypto_milestone_16et_v12_source_bottleneck_audit_non_doge_collection_plan_v1.json"
KALSHI_V13_PREREGISTRATION_PLAN_REPO_PATH = "work/scripts/kalshi/crypto_milestone_16ev_v13_asset_balanced_crypto_candidate_preregistration_plan_v1.json"
KALSHI_V13_PREREGISTRATION_PLAN_PATH = KALSHI_SCRIPT_ROOT / "crypto_milestone_16ev_v13_asset_balanced_crypto_candidate_preregistration_plan_v1.json"
MARKET_FAMILY_ORDER = ("crypto", "sports", "weather", "economics", "politics", "other")
TIMESFM_SAFETY_FLAGS = {
    "diagnostic_only": True,
    "production_model": False,
    "not_trade_signal": True,
    "counts_for_validation_credit": False,
    "sts_authority": False,
    "can_authorize_paper": False,
    "can_authorize_live": False,
    "live_order_allowed": False,
    "auto_live_promotion_allowed": False,
}
TIMESFM_NEXT_ACTION = "Run diagnostic-only TimesFM evaluation after evidence gates permit it."
MLX_SAFETY_FLAGS = {
    "diagnostic_only": True,
    "research_only": True,
    "not_trade_signal": True,
    "counts_for_validation_credit": False,
    "sts_authority": False,
    "can_authorize_trade": False,
    "can_authorize_paper": False,
    "can_authorize_live": False,
    "live_order_allowed": False,
    "auto_live_promotion_allowed": False,
}
CRYPTO_PERSISTENCE_LAB_SAFETY_FLAGS = {
    "diagnostic_only": True,
    "research_only": True,
    "not_trade_signal": True,
    "counts_for_validation_credit": False,
    "sts_authority": False,
    "can_authorize_trade": False,
    "can_authorize_paper": False,
    "can_authorize_live": False,
    "live_order_allowed": False,
    "auto_live_promotion_allowed": False,
}
CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS = {
    "diagnostic_only": True,
    "research_only": True,
    "not_trade_signal": True,
    "counts_for_validation_credit": False,
    "historical_replay_credit_allowed": False,
    "sts_authority": False,
    "can_authorize_trade": False,
    "can_authorize_paper": False,
    "can_authorize_live": False,
    "live_order_allowed": False,
    "live_trading_enabled": False,
    "auto_live_promotion_allowed": False,
    "write_capable_kalshi_endpoint_called": False,
}

TIMEFRAME_SPECS: tuple[tuple[str, str, int | None], ...] = (
    ("1h", "1 hour", 60 * 60),
    ("6h", "6 hours", 6 * 60 * 60),
    ("12h", "12 hours", 12 * 60 * 60),
    ("24h", "24 hours", 24 * 60 * 60),
    ("48h", "48 hours", 48 * 60 * 60),
    ("7d", "1 week", 7 * 24 * 60 * 60),
    ("30d", "1 month", 30 * 24 * 60 * 60),
    ("all", "All time", None),
)

CATEGORY_LABELS = {
    "weather": "Weather",
    "sports": "Sports",
    "economics": "Economics",
    "politics": "Politics",
    "crypto": "Crypto",
    "entertainment": "Entertainment",
    "other": "Other",
    "unknown": "Unknown / Other",
}

WEATHER_FAILURE_MODE_DEFINITIONS = {
    "unknown_or_missing_result_timing": {
        "label": "Result time missing",
        "explanation": "OpenClaw could not confidently say when this paper trade result should be known.",
    },
    "settlement_parse_gap": {
        "label": "Settlement parsing needs review",
        "explanation": "The market rules, date, threshold, or result field were not clean enough to prove the exact weather value used for settlement.",
    },
    "high_confidence_weather_miss": {
        "label": "Weather model was confidently wrong",
        "explanation": "The fair-value model was very confident, but the resolved outcome went the other way.",
    },
    "weather_probability_miscalibration": {
        "label": "Weather probabilities need recalibration",
        "explanation": "The predicted probability did not line up well with the resolved results in this bucket.",
    },
    "edge_too_thin_after_costs": {
        "label": "Edge too small after costs",
        "explanation": "The expected advantage was too small once fees, slippage, and spread costs were considered.",
    },
    "expensive_entry_loss": {
        "label": "Entry price was expensive",
        "explanation": "The paper trade paid a high price and lost, which is painful because downside was larger than the remaining upside.",
    },
    "no_obvious_failure_mode": {
        "label": "No clear failure pattern yet",
        "explanation": "The trade lost, but the dashboard does not yet have enough structured evidence to name the main cause.",
    },
}

STRATEGY_DISPLAY_NAMES = {
    "standard_strategy": "Standard Strategy",
    "inverse_standard_strategy": "Inverse Standard Strategy",
    "weather_arbitrage_strategy": "Weather Arbitrage Strategy",
    "polyclaw": "PolyClaw",
    "polymarket_kalshi_divergence": "polymarket-kalshi-divergence",
}

TRADE_TRACKING_FIELD_CONTRACT: tuple[dict[str, str], ...] = (
    {"field": "decision_id", "label": "Decision ID", "why": "Stable join key across decisions, outcomes, ML rows, and audit trails."},
    {"field": "timestamp_utc", "label": "Decision Time", "why": "Required for no-lookahead training cutoffs and chronological validation."},
    {"field": "market_ticker", "label": "Market Ticker", "why": "Required to fetch official source-backed result state."},
    {"field": "strategy_identity", "label": "Strategy Identity", "why": "Required to compare every strategy and assign paper-learning weight."},
    {"field": "domain", "label": "Domain", "why": "Prevents negative transfer; weather, crypto, sports, and other domains learn separately."},
    {"field": "selected_side", "label": "Selected Side", "why": "Required to map YES/NO settlement into wins, losses, Brier, and P&L."},
    {"field": "entry_price", "label": "Entry Price", "why": "Required to measure edge after fees/spread and compare to market-implied probability."},
    {"field": "fair_probability", "label": "Fair Probability", "why": "Required for Brier/log-loss, calibration, and challenger-vs-market testing."},
    {"field": "expected_result_known_time_utc", "label": "Result-Known Time", "why": "Required to resolve outcomes quickly and keep learning velocity high."},
    {"field": "market_snapshot_hash", "label": "Market Snapshot Hash", "why": "Required to prove the feature snapshot existed before the label."},
    {"field": "baseline_comparison", "label": "Baseline Comparison", "why": "Required to reject candidates that do not beat market, random, and no-trade baselines."},
    {"field": "strategy_taxonomy", "label": "Strategy Taxonomy", "why": "Required for segment-scoped learning and safe strategy transfer."},
    {"field": "reality_contract", "label": "Reality Contract", "why": "Required to quarantine rows with missing labels, future leakage, or source ambiguity."},
    {"field": "ml_governance", "label": "ML Governance", "why": "Required to track feature schema, training cutoff, rollback rule, and model id."},
    {"field": "source_observed_at_utc", "label": "Source Observed Time", "why": "Required to prove external evidence was fresh at decision time."},
    {"field": "live_order_allowed_false", "label": "No-Live Flag", "why": "Required to prove the record cannot authorize live trading."},
)


def _money(value: Any) -> float:
    try:
        if value is None or isinstance(value, bool):
            return 0.0
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(number) or math.isinf(number):
        return 0.0
    return round(number, 2)


def _signed_money_display(value: Any) -> str:
    amount = _money(value)
    if amount > 0:
        return f"+${amount:.2f}"
    if amount < 0:
        return f"-${abs(amount):.2f}"
    return "$0.00"


def _is_accepted(decision: dict[str, Any]) -> bool:
    decision_name = str(decision.get("decision") or "").upper()
    if _money(decision.get("simulated_size_usd")) <= 0:
        return False
    if decision_name in {"PAPER_BUY_YES", "PAPER_BUY_NO", "PAPER_EXPLORE_BUY_YES", "PAPER_EXPLORE_BUY_NO", "PAPER_QUOTE_TWO_SIDED", "PAPER_EXPLORE_QUOTE", "ACCEPT_FORWARD_PAPER", "ACCEPT_EXPLORATION", "INVERSE_FORWARD_TEST"}:
        return True
    if decision_name.startswith("PAPER_INVERSE_FORWARD_"):
        return True
    if decision.get("paper_exploration") is True or decision.get("evidence_tier") in {"exploration", "forward_paper", "live_review_candidate"}:
        return _money(decision.get("simulated_size_usd")) > 0
    return False


def _route_class(decision: dict[str, Any]) -> str:
    decision_name = str(decision.get("decision") or "").upper()
    if _is_accepted(decision):
        if decision_name in {"ACCEPT_FORWARD_PAPER", "INVERSE_FORWARD_TEST"} or decision.get("evidence_tier") == "forward_paper":
            return "FORWARD_PAPER"
        if decision_name == "ACCEPT_EXPLORATION" or decision.get("paper_exploration") is True or decision.get("evidence_tier") == "exploration":
            return "ACCEPT_EXPLORATION"
        if str(decision_name).startswith("PAPER_EXPLORE") or decision_name == "PAPER_QUOTE_TWO_SIDED":
            return "ACCEPT_EXPLORATION"
        return "ACCEPT_PAPER"
    if decision.get("paper_exploration") is True or decision.get("evidence_tier") == "exploration" or str(decision_name).startswith("PAPER_EXPLORE"):
        return "ACCEPT_EXPLORATION"
    if decision.get("evidence_tier") == "forward_paper":
        return "FORWARD_PAPER"
    return "SHADOW_ONLY"


def _route_mix_by_domain(decisions: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    overall: Counter[str] = Counter()
    weather_crypto: Counter[str] = Counter()
    for decision in decisions:
        route = _route_class(decision)
        overall[route] += 1
        if _category(decision) in {"weather", "crypto"}:
            weather_crypto[route] += 1
    return {
        "overall": dict(overall),
        "weather_crypto": dict(weather_crypto),
    }


def _route_mix_share(values: dict[str, int]) -> dict[str, float]:
    total = sum(int(v) for v in values.values() if isinstance(v, int) and v >= 0)
    if total <= 0:
        return {}
    return {key: round(float(value) / total, 6) for key, value in values.items()}


def _category(decision: dict[str, Any]) -> str:
    taxonomy = decision.get("strategy_taxonomy")
    if isinstance(taxonomy, dict) and isinstance(taxonomy.get("domain"), str):
        return taxonomy["domain"]
    category = str(decision.get("market_category") or "").lower()
    title = str(decision.get("market_title") or "").lower()
    ticker = str(decision.get("market_ticker") or "").lower()
    text = " ".join([category, title, ticker])
    if "weather" in text or "temperature" in text or "rain" in text or ticker.startswith(("kxhigh", "kxtemp")):
        return "weather"
    if "sports" in text or any(word in text for word in [" wins", "goal", "runs", "nba", "nfl", "mlb", "nhl"]):
        return "sports"
    if any(word in text for word in ["fed", "cpi", "inflation", "jobs", "unemployment", "gdp"]):
        return "economics"
    if any(word in text for word in ["bitcoin", "crypto", "ethereum"]):
        return "crypto"
    if any(word in text for word in ["election", "president", "senate", "congress"]):
        return "politics"
    return "other"


def _side(decision: dict[str, Any]) -> str:
    for key in ("selected_executable_side", "inverse_strategy_side", "side"):
        value = str(decision.get(key) or "").upper()
        if value in {"YES", "NO"}:
            return value
    decision_name = str(decision.get("decision") or "").upper()
    if "NO" in decision_name:
        return "NO"
    if "YES" in decision_name:
        return "YES"
    if str(decision.get("original_strategy_side") or "").upper() in {"YES", "NO"}:
        return str(decision.get("original_strategy_side")).upper()
    return "UNKNOWN"


def _clean_market_leg(text: str) -> str:
    leg = re.sub(r"^\s*(yes|no)\s+", "", text.strip(), flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", leg).strip()


def _yes_condition_plain_english(title: str) -> str:
    raw_parts = [part.strip() for part in str(title or "").split(",") if part.strip()]
    yes_parts: list[str] = []
    no_parts: list[str] = []
    for part in raw_parts:
        lowered = part.lower()
        if lowered.startswith("yes "):
            yes_parts.append(_clean_market_leg(part))
        elif lowered.startswith("no "):
            no_parts.append(_clean_market_leg(part))
    if yes_parts or no_parts:
        clauses: list[str] = []
        if yes_parts:
            clauses.append("these must happen: " + "; ".join(yes_parts))
        if no_parts:
            clauses.append("these must not happen: " + "; ".join(no_parts))
        return "; ".join(clauses)
    return str(title or "the listed market outcome").strip() or "the listed market outcome"


def _pending_bet_summary(decision: dict[str, Any]) -> str:
    side = _side(decision)
    title = str(decision.get("market_title") or decision.get("market_ticker") or "this market")
    if side in {"YES", "NO"}:
        return f"Paper buy {side} on: {title}"
    return f"Paper trade on: {title}"


def _pending_win_condition(decision: dict[str, Any]) -> str:
    existing = decision.get("win_condition")
    if isinstance(existing, str) and existing.strip() and existing.strip().lower() != "n/a":
        return existing.strip()
    side = _side(decision)
    title = str(decision.get("market_title") or decision.get("market_ticker") or "this market")
    yes_condition = _yes_condition_plain_english(title)
    if side == "YES":
        return f"To win, this paper trade needs Kalshi to resolve the market YES. In plain English, {yes_condition}."
    if side == "NO":
        return f"To win, this paper trade needs Kalshi to resolve the market NO. In plain English, the YES condition must fail: {yes_condition}."
    return f"To win, this paper trade must match Kalshi's final YES/NO result for: {yes_condition}."


def _pending_probability(decision: dict[str, Any]) -> float | None:
    for key in ("estimated_success_probability", "market_price_probability", "fair_probability"):
        value = decision.get(key)
        if value is None or isinstance(value, bool):
            continue
        try:
            probability = float(value)
        except (TypeError, ValueError):
            continue
        if 0.0 <= probability <= 1.0:
            return round(probability, 4)
    return None


def _pending_entry_price_cents(decision: dict[str, Any]) -> int | None:
    for key in ("paper_fill_price_cents", "market_price_cents", "inverse_executable_price_cents"):
        value = decision.get(key)
        if value is None or isinstance(value, bool):
            continue
        try:
            cents = int(round(float(value)))
        except (TypeError, ValueError):
            continue
        if 0 <= cents <= 100:
            return cents
    return None


def _pending_trade_record(decision: dict[str, Any]) -> dict[str, Any]:
    side = _side(decision)
    entry_cents = _pending_entry_price_cents(decision)
    stake = _money(decision.get("simulated_size_usd"))
    profit_if_win = None
    loss_if_wrong = None
    if stake > 0 and entry_cents is not None and entry_cents > 0:
        price = max(1.0, min(99.0, float(entry_cents))) / 100.0
        contracts = stake / price
        profit_if_win = round(contracts * (1.0 - price), 2)
        loss_if_wrong = round(-stake, 2)
    market_probability = None
    if entry_cents is not None:
        market_probability = round(entry_cents / 100.0, 4)
    elif decision.get("market_price_probability") is not None:
        try:
            market_probability = round(float(decision.get("market_price_probability")), 4)
        except (TypeError, ValueError):
            market_probability = None
    return {
        "decision_id": decision.get("decision_id"),
        "market_ticker": decision.get("market_ticker"),
        "market_title": decision.get("market_title"),
        "decision": decision.get("decision"),
        "side": side if side in {"YES", "NO"} else None,
        "bet_summary": _pending_bet_summary(decision),
        "win_condition": _pending_win_condition(decision),
        "category": _category(decision),
        "evidence_tier": decision.get("evidence_tier"),
        "strategy_bucket": decision.get("strategy_bucket"),
        "estimated_success_probability": _pending_probability(decision),
        "market_probability_at_entry": market_probability,
        "fair_probability": decision.get("fair_probability"),
        "edge_after_costs_pct": decision.get("edge_after_costs_pct"),
        "simulated_size_usd": stake,
        "paper_fill_price_cents": entry_cents,
        "paper_profit_if_win_usd": profit_if_win,
        "paper_loss_if_wrong_usd": loss_if_wrong,
        "timestamp_utc": decision.get("timestamp_utc"),
        "expected_result_known_time_utc": decision.get("expected_result_known_time_utc"),
        "result_known_time_source_label": decision.get("result_known_time_source_label") or decision.get("resolution_time_source_label") or "Unknown",
        "result_known_timing_note": decision.get("result_known_timing_note") or decision.get("resolution_timing_note"),
        "live_order_allowed": False,
    }


def _trade_pnl(decision: dict[str, Any], outcome: dict[str, Any]) -> float:
    existing = outcome.get("simulated_pnl_usd")
    if existing is not None:
        return _money(existing)
    size = _money(decision.get("simulated_size_usd"))
    if size <= 0:
        return 0.0
    price_cents = decision.get("paper_fill_price_cents")
    if price_cents is None:
        price_cents = decision.get("market_price_cents")
    try:
        price = max(1.0, min(99.0, float(price_cents))) / 100.0
    except (TypeError, ValueError):
        price = 0.5
    side = _side(decision)
    outcome_yes = int(outcome.get("outcome_yes") or 0)
    won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
    if side == "UNKNOWN":
        return 0.0
    contracts = size / price
    gross = contracts * (1.0 - price) if won else -size
    return round(gross, 2)


def _outcome_yes_value(outcome: dict[str, Any]) -> int | None:
    value = outcome.get("outcome_yes")
    if isinstance(value, bool):
        return 1 if value else 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed in {0, 1}:
        return parsed
    return None


def _paper_result(decision: dict[str, Any], outcome: dict[str, Any]) -> str | None:
    outcome_yes = _outcome_yes_value(outcome)
    side = _side(decision)
    if outcome_yes is None or side not in {"YES", "NO"}:
        return None
    won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
    return "win" if won else "loss"


def _recent_paper_bet_record(decision: dict[str, Any], latest_outcome_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    record = _pending_trade_record(decision)
    outcome = latest_outcome_by_id.get(str(decision.get("decision_id") or ""))
    if outcome is None:
        record.update(
            {
                "outcome_status": "pending",
                "outcome_yes": None,
                "paper_result": "pending",
                "paper_pnl_usd": None,
                "settlement_checked_at_utc": None,
                "settlement_source": None,
                "outcome_notes": None,
            }
        )
        return record

    result = _paper_result(decision, outcome)
    record.update(
        {
            "outcome_status": "resolved",
            "outcome_yes": _outcome_yes_value(outcome),
            "paper_result": result or "resolved",
            "paper_pnl_usd": _trade_pnl(decision, outcome),
            "settlement_checked_at_utc": outcome.get("settlement_checked_at_utc"),
            "settlement_source": outcome.get("settlement_source"),
            "outcome_notes": outcome.get("notes"),
        }
    )
    return record


def _source_fingerprint(paths: list[Path]) -> dict[str, Any]:
    h = hashlib.sha256()
    files: dict[str, dict[str, Any]] = {}
    for path in paths:
        if path.exists():
            stat = path.stat()
            payload = f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}".encode()
            h.update(payload)
            files[path.name] = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
        else:
            h.update(f"{path.name}:missing".encode())
            files[path.name] = {"missing": True}
    return {"sha256": h.hexdigest(), "files": files}


def _latest_jsonl_record(path: Path) -> dict[str, Any] | None:
    records, _warnings = load_jsonl(path)
    return records[-1] if records else None


def _latest_successful_scheduled_record(path: Path) -> dict[str, Any] | None:
    records, _warnings = load_jsonl(path)
    for record in reversed(records):
        if record.get("ok") is True and record.get("status") == "COMPLETED":
            return record
    return records[-1] if records else None


def _recent_jsonl_records(path: Path, *, now: datetime, window_minutes: float) -> list[dict[str, Any]]:
    records, _warnings = load_jsonl(path)
    cutoff = now - timedelta(minutes=max(0.0, window_minutes))
    recent: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        timestamp = parse_utc(record.get("timestamp_utc") or record.get("completed_at_utc"))
        if timestamp is not None and timestamp >= cutoff:
            recent.append(record)
    return recent


def _aggregate_recent_weather_candidate_runs(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        return {}
    action_counts: Counter[str] = Counter()
    skipped_counts: Counter[str] = Counter()
    warnings: list[str] = []
    critical_failures: list[str] = []
    latest = max(records, key=lambda record: parse_utc(record.get("timestamp_utc")) or datetime.min.replace(tzinfo=timezone.utc))
    for record in records:
        if isinstance(record.get("created_by_governor_action"), dict):
            action_counts.update({str(key): int(value) for key, value in record["created_by_governor_action"].items() if isinstance(value, int)})
        if isinstance(record.get("skipped_reasons"), dict):
            skipped_counts.update({str(key): int(value) for key, value in record["skipped_reasons"].items() if isinstance(value, int)})
        if isinstance(record.get("warnings"), list):
            warnings.extend(str(item) for item in record["warnings"] if item)
        if isinstance(record.get("critical_failures"), list):
            critical_failures.extend(str(item) for item in record["critical_failures"] if item)
    return {
        **latest,
        "timestamp_utc": latest.get("timestamp_utc"),
        "recent_weather_candidate_window_minutes": 15,
        "recent_weather_candidate_run_count": len(records),
        "created_count": sum(int(record.get("created_count") or 0) for record in records),
        "created_by_governor_action": dict(sorted(action_counts.items())),
        "markets_seen": sum(int(record.get("markets_seen") or 0) for record in records),
        "orderbooks_checked": sum(int(record.get("orderbooks_checked") or 0) for record in records),
        "skipped_reasons": dict(sorted(skipped_counts.items())),
        "warnings": sorted(set(warnings)),
        "critical_failures": sorted(set(critical_failures)),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _age_minutes(timestamp: Any, now: datetime) -> float | None:
    parsed = parse_utc(timestamp)
    if parsed is None:
        return None
    return round(max(0.0, (now - parsed).total_seconds() / 60.0), 2)




def _latest_usable_crypto_evidence_record(path: Path) -> dict[str, Any] | None:
    records, _warnings = load_jsonl(path)
    for record in reversed(records):
        if not isinstance(record, dict):
            continue
        if int(record.get("active_crypto_markets_seen") or 0) <= 0:
            continue
        if int(record.get("parseable_crypto_markets") or 0) <= 0:
            continue
        warnings = record.get("warnings")
        fetch_warnings = [str(item) for item in warnings if isinstance(item, str) and (item.startswith("crypto_spot_fetch_failed:") or item.startswith("market_fetch_failed:") or item.startswith("series_market_fetch_failed:"))] if isinstance(warnings, list) else []
        if fetch_warnings:
            continue
        return record
    return None


def _crypto_evidence_dashboard_record(latest: dict[str, Any] | None, usable: dict[str, Any] | None, *, now: datetime, max_fallback_age_minutes: float = 240.0) -> dict[str, Any]:
    if not isinstance(latest, dict):
        return usable if isinstance(usable, dict) else {}
    fetch_failed = bool(latest.get("next_crypto_learning_check_reason") == "read_only_fetch_retry")
    has_current_markets = int(latest.get("active_crypto_markets_seen") or 0) > 0 and int(latest.get("parseable_crypto_markets") or 0) > 0
    if not fetch_failed or has_current_markets or not isinstance(usable, dict):
        return latest
    usable_age = _age_minutes(usable.get("timestamp_utc"), now)
    if usable_age is None or usable_age > max_fallback_age_minutes:
        return latest
    latest_warnings = latest.get("warnings") if isinstance(latest.get("warnings"), list) else []
    return {
        **usable,
        "timestamp_utc": latest.get("timestamp_utc"),
        "crypto_evidence_current_fetch_failed": True,
        "crypto_evidence_usable_snapshot_timestamp_utc": usable.get("timestamp_utc"),
        "crypto_evidence_usable_snapshot_age_minutes": usable_age,
        "current_fetch_warnings": latest_warnings,
        "warnings": latest_warnings,
        "plain_english_summary": (
            "Latest crypto fetch failed, so dashboard metrics are using the most recent usable read-only crypto snapshot "
            f"from {usable.get('timestamp_utc')} while the retry loop is scheduled."
        ),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

def _crypto_readiness_dashboard_snapshot(latest_crypto_evidence: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    next_raw = latest_crypto_evidence.get("next_crypto_trade_ready_check_time_utc")
    snapshot_raw = latest_crypto_evidence.get("next_crypto_learning_snapshot_check_time_utc")
    parsed = parse_utc(next_raw)
    parsed_snapshot = parse_utc(snapshot_raw)
    snapshot_seconds = max(0, int(round((parsed_snapshot - now).total_seconds()))) if parsed_snapshot is not None and parsed_snapshot > now else None
    if parsed is not None and parsed > now:
        seconds = max(0, int(round((parsed - now).total_seconds())))
        return {
            "crypto_readiness_status": latest_crypto_evidence.get("crypto_readiness_status") or "scheduled",
            "next_crypto_trade_ready_check_time_utc": next_raw,
            "seconds_until_next_crypto_trade_ready_check": seconds,
            "next_crypto_learning_snapshot_check_time_utc": snapshot_raw if snapshot_seconds is not None else None,
            "seconds_until_next_crypto_learning_snapshot_check": snapshot_seconds,
            "next_crypto_trade_ready_unavailable_reason": None,
            "last_crypto_trade_ready_check_time_utc": None,
            "next_crypto_learning_check_reason": latest_crypto_evidence.get("next_crypto_learning_check_reason"),
            "crypto_readiness_summary": latest_crypto_evidence.get("crypto_readiness_summary") or f"Next crypto trade-ready check is around {next_raw}.",
        }
    if parsed is not None and parsed <= now:
        return {
            "crypto_readiness_status": "check_due_now",
            "next_crypto_trade_ready_check_time_utc": None,
            "seconds_until_next_crypto_trade_ready_check": 0,
            "next_crypto_learning_snapshot_check_time_utc": None,
            "seconds_until_next_crypto_learning_snapshot_check": None,
            "next_crypto_trade_ready_unavailable_reason": "latest_crypto_trade_ready_check_time_already_due",
            "last_crypto_trade_ready_check_time_utc": next_raw,
            "next_crypto_learning_check_reason": latest_crypto_evidence.get("next_crypto_learning_check_reason"),
            "crypto_readiness_summary": f"Latest crypto trade-ready check time ({next_raw}) has arrived; rerun crypto evidence now.",
        }
    reason = latest_crypto_evidence.get("next_crypto_trade_ready_unavailable_reason") or "no_future_crypto_trade_ready_time_available"
    return {
        "crypto_readiness_status": latest_crypto_evidence.get("crypto_readiness_status") or "unavailable",
        "next_crypto_trade_ready_check_time_utc": None,
        "seconds_until_next_crypto_trade_ready_check": None,
        "next_crypto_learning_snapshot_check_time_utc": None,
        "seconds_until_next_crypto_learning_snapshot_check": None,
        "next_crypto_trade_ready_unavailable_reason": reason,
        "last_crypto_trade_ready_check_time_utc": None,
        "next_crypto_learning_check_reason": latest_crypto_evidence.get("next_crypto_learning_check_reason"),
        "crypto_readiness_summary": latest_crypto_evidence.get("crypto_readiness_summary")
        or "No future crypto trade-ready check time is available from current Kalshi market data.",
    }


def _timeframe_cutoff(now: datetime, seconds: int | None) -> datetime | None:
    if seconds is None:
        return None
    return now - timedelta(seconds=seconds)


def _scored_performance_record(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    *,
    label: str,
    cutoff: datetime | None = None,
) -> dict[str, Any]:
    accepted = [d for d in decisions if _is_accepted(d)]
    accepted_ids = {d.get("decision_id") for d in accepted if isinstance(d.get("decision_id"), str)}
    decisions_by_id = {d.get("decision_id"): d for d in decisions if isinstance(d.get("decision_id"), str)}
    wins = 0
    losses = 0
    total_profit = 0.0
    total_loss = 0.0
    cumulative = 0.0
    latest_scored_at: datetime | None = None
    latest_scored_decision_at: datetime | None = None
    category_perf: dict[str, dict[str, Any]] = defaultdict(lambda: {"scored": 0, "wins": 0, "losses": 0, "total_profit_usd": 0.0, "total_loss_usd": 0.0, "net_pnl_usd": 0.0})
    trend_points: list[dict[str, Any]] = []

    sorted_outcomes = sorted(
        latest_outcome_by_id.values(),
        key=lambda o: parse_utc(o.get("settlement_checked_at_utc")) or datetime.min.replace(tzinfo=timezone.utc),
    )
    for outcome in sorted_outcomes:
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        if cutoff is not None and (checked is None or checked < cutoff):
            continue
        did = outcome.get("decision_id")
        decision = decisions_by_id.get(did)
        if decision is None or did not in accepted_ids:
            continue
        side = _side(decision)
        if side == "UNKNOWN":
            continue
        outcome_yes = int(outcome.get("outcome_yes") or 0)
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        pnl = _trade_pnl(decision, outcome)
        if won:
            wins += 1
        else:
            losses += 1
        if pnl >= 0:
            total_profit += pnl
        else:
            total_loss += abs(pnl)
        cumulative += pnl
        if checked and (latest_scored_at is None or checked > latest_scored_at):
            latest_scored_at = checked
        decision_time = parse_utc(decision.get("timestamp_utc"))
        if decision_time and (latest_scored_decision_at is None or decision_time > latest_scored_decision_at):
            latest_scored_decision_at = decision_time

        cat = _category(decision)
        category_perf[cat]["scored"] += 1
        category_perf[cat]["wins" if won else "losses"] += 1
        category_perf[cat]["net_pnl_usd"] = round(category_perf[cat]["net_pnl_usd"] + pnl, 2)
        if pnl >= 0:
            category_perf[cat]["total_profit_usd"] = round(category_perf[cat]["total_profit_usd"] + pnl, 2)
        else:
            category_perf[cat]["total_loss_usd"] = round(category_perf[cat]["total_loss_usd"] + abs(pnl), 2)
        scored_count = wins + losses
        trend_points.append(
            {
                "index": scored_count,
                "timestamp_utc": decision.get("timestamp_utc"),
                "scored_at_utc": checked.isoformat().replace("+00:00", "Z") if checked else None,
                "accuracy": wins / scored_count if scored_count else None,
                "cumulative_pnl_usd": round(cumulative, 2),
                "average_pnl_per_scored_trade_usd": round(cumulative / scored_count, 4) if scored_count else None,
                "latest_trade_pnl_usd": pnl,
                "volume": 1,
                "category": cat,
            }
        )

    scored = wins + losses
    category_rows = []
    for cat, stats in sorted(category_perf.items(), key=lambda item: item[1]["scored"], reverse=True):
        category_rows.append(
            {
                "category": cat,
                "label": CATEGORY_LABELS.get(cat, cat.replace("_", " ").title()),
                "scored": stats["scored"],
                "wins": stats["wins"],
                "losses": stats["losses"],
                "accuracy": stats["wins"] / stats["scored"] if stats["scored"] else None,
                "net_pnl_usd": round(stats["net_pnl_usd"], 2),
                "total_profit_usd": round(stats["total_profit_usd"], 2),
                "total_loss_usd": round(stats["total_loss_usd"], 2),
            }
        )
    return {
        "label": label,
        "scored_decisions": scored,
        "wins": wins,
        "losses": losses,
        "accuracy": wins / scored if scored else None,
        "net_pnl_usd": round(cumulative, 2),
        "total_profit_usd": round(total_profit, 2),
        "total_loss_usd": round(total_loss, 2),
        "latest_scored_outcome_utc": latest_scored_at.isoformat().replace("+00:00", "Z") if latest_scored_at else None,
        "latest_scored_decision_utc": latest_scored_decision_at.isoformat().replace("+00:00", "Z") if latest_scored_decision_at else None,
        "category_accuracy": category_rows,
        "trend_points": trend_points,
    }


def _timeframe_metrics(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    now: datetime,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    performance: dict[str, dict[str, Any]] = {}
    activity: dict[str, dict[str, Any]] = {}
    for key, label, seconds in TIMEFRAME_SPECS:
        cutoff = _timeframe_cutoff(now, seconds)
        perf = _scored_performance_record(decisions, latest_outcome_by_id, label=label, cutoff=cutoff)
        performance[key] = {k: v for k, v in perf.items() if k != "trend_points"}
        window_decisions = []
        for decision in decisions:
            timestamp = parse_utc(decision.get("timestamp_utc"))
            if cutoff is None or (timestamp is not None and timestamp >= cutoff):
                window_decisions.append(decision)
        outcomes_recorded = 0
        for outcome in latest_outcome_by_id.values():
            checked = parse_utc(outcome.get("settlement_checked_at_utc"))
            if cutoff is None or (checked is not None and checked >= cutoff):
                outcomes_recorded += 1
        counts = Counter(str(d.get("decision") or "UNKNOWN").upper() for d in window_decisions)
        activity[key] = {
            "label": label,
            "decisions": len(window_decisions),
            "accepted": sum(1 for d in window_decisions if _is_accepted(d)),
            "rejected": counts.get("REJECT", 0),
            "no_trade": counts.get("NO_TRADE", 0),
            "outcomes_recorded": outcomes_recorded,
            "scored_accepted": perf["scored_decisions"],
            "latest_scored_outcome_utc": perf["latest_scored_outcome_utc"],
        }
    return performance, activity


def _segment_key(decision: dict[str, Any]) -> str:
    taxonomy = decision.get("strategy_taxonomy")
    if isinstance(taxonomy, dict) and isinstance(taxonomy.get("segment_key"), str):
        return taxonomy["segment_key"]
    domain = _category(decision)
    strategy = str(decision.get("strategy_bucket") or "unknown")
    source = str(decision.get("fair_value_source_type") or "unknown")
    side = _side(decision).lower()
    return f"leaf|{domain}|unknown|unknown|{strategy}|{source}|{side}|unknown_horizon|unknown_liquidity"


def _segment_records(decisions: list[dict[str, Any]], latest_outcome_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    decisions_by_id = {d.get("decision_id"): d for d in decisions if isinstance(d.get("decision_id"), str)}
    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "decisions": 0,
            "accepted": 0,
            "scored": 0,
            "wins": 0,
            "simulated_pnl_usd": 0.0,
            "domain": "unknown",
            "subdomain": "unknown",
            "strategy_lane": "unknown",
        }
    )
    for decision in decisions:
        key = _segment_key(decision)
        bucket = buckets[key]
        bucket["decisions"] += 1
        bucket["domain"] = _category(decision)
        bucket["subdomain"] = str(decision.get("market_type") or decision.get("market_category") or "unknown")
        bucket["strategy_lane"] = str(decision.get("strategy_bucket") or "unknown")
        if _is_accepted(decision):
            bucket["accepted"] += 1
    for outcome in latest_outcome_by_id.values():
        decision = decisions_by_id.get(outcome.get("decision_id"))
        if decision is None or not _is_accepted(decision):
            continue
        side = _side(decision)
        if side == "UNKNOWN":
            continue
        key = _segment_key(decision)
        bucket = buckets[key]
        outcome_yes = int(outcome.get("outcome_yes") or 0)
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        bucket["scored"] += 1
        if won:
            bucket["wins"] += 1
        bucket["simulated_pnl_usd"] = round(bucket["simulated_pnl_usd"] + _trade_pnl(decision, outcome), 2)

    rows: list[dict[str, Any]] = []
    for key, bucket in buckets.items():
        scored = int(bucket["scored"])
        wins = int(bucket["wins"])
        pnl = _money(bucket["simulated_pnl_usd"])
        status = "learning"
        if scored >= 10 and (pnl < 0 or (wins / scored if scored else 0.0) < 0.45):
            status = "learning_loss_warning"
        elif scored >= 30 and pnl > 0 and (wins / scored if scored else 0.0) >= 0.55:
            status = "forward_paper_candidate"
        rows.append(
            {
                "segment": key,
                "status": status,
                "domain": bucket["domain"],
                "subdomain": bucket["subdomain"],
                "strategy_lane": bucket["strategy_lane"],
                "allowed_application_scope": "current_epoch_segment",
                "transferability": "domain_only",
                "decisions": bucket["decisions"],
                "accepted": bucket["accepted"],
                "scored": scored,
                "wins": wins,
                "win_rate": wins / scored if scored else None,
                "simulated_pnl_usd": pnl,
                "brier_score": None,
                "market_baseline_brier_score": None,
            }
        )
    return sorted(rows, key=lambda row: (int(row.get("scored") or 0), abs(float(row.get("simulated_pnl_usd") or 0.0))), reverse=True)


def _failure_mode_detail(mode: str, count: int = 0) -> dict[str, Any]:
    definition = WEATHER_FAILURE_MODE_DEFINITIONS.get(mode)
    if definition is None:
        label = mode.replace("_", " ").title()
        explanation = "OpenClaw recorded this weather audit issue, but it does not yet have a custom plain-English explanation."
    else:
        label = definition["label"]
        explanation = definition["explanation"]
    return {"mode": mode, "label": label, "count": count, "explanation": explanation}


def _weather_market_type(decision: dict[str, Any]) -> str:
    for key in ("weather_market_type", "market_type"):
        value = decision.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower().replace(" ", "_")
    taxonomy = decision.get("strategy_taxonomy")
    if isinstance(taxonomy, dict):
        for key in ("market_type", "subdomain"):
            value = taxonomy.get(key)
            if isinstance(value, str) and value.strip() and value.lower() != "unknown":
                return value.strip().lower().replace(" ", "_")
    title = str(decision.get("market_title") or "").lower()
    ticker = str(decision.get("market_ticker") or "").lower()
    text = f"{title} {ticker}"
    if "rain" in text or "precip" in text:
        return "rain"
    if "low" in text and ("temp" in text or "temperature" in text):
        return "low_temperature"
    if "high" in text and ("temp" in text or "temperature" in text):
        return "high_temperature"
    if "wind" in text:
        return "wind"
    if "temperature" in text or "temp" in text:
        return "temperature"
    return "weather"


def _weather_city(decision: dict[str, Any]) -> str:
    for key in ("weather_city", "city"):
        value = decision.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().upper()
    title = str(decision.get("market_title") or "")
    known_cities = (
        "ATLANTA",
        "AUSTIN",
        "BOSTON",
        "CHICAGO",
        "DALLAS",
        "DENVER",
        "HOUSTON",
        "LAS VEGAS",
        "LOS ANGELES",
        "MIAMI",
        "MINNEAPOLIS",
        "NEW ORLEANS",
        "NEW YORK",
        "OKLAHOMA CITY",
        "PHILADELPHIA",
        "PHOENIX",
        "SAN ANTONIO",
        "SAN FRANCISCO",
        "SEATTLE",
        "WASHINGTON",
    )
    title_upper = title.upper()
    for city in known_cities:
        if city in title_upper:
            return city
    return "UNKNOWN"


def _weather_failure_modes(decision: dict[str, Any], outcome: dict[str, Any]) -> Counter[str]:
    modes: Counter[str] = Counter()
    if parse_utc(decision.get("expected_result_known_time_utc")) is None:
        modes["unknown_or_missing_result_timing"] += 1
    blockers = decision.get("clean_evidence_blockers")
    blocker_text = " ".join(str(item) for item in blockers) if isinstance(blockers, list) else ""
    diagnostic_text = " ".join(
        str(decision.get(key) or "")
        for key in (
            "no_trade_reason",
            "settlement_timing_note",
            "result_known_timing_note",
            "weather_evidence_warning",
        )
    )
    text = f"{blocker_text} {diagnostic_text}".lower()
    settlement_problem_tokens = (
        "settlement",
        "parse",
        "unparse",
        "missing_weather",
        "mismatch",
        "unclear",
        "unknown",
        "contradict",
        "invalid",
        "bad_taxonomy",
        "station",
        "direction",
        "threshold_or_date",
    )
    if any(token in text for token in settlement_problem_tokens):
        modes["settlement_parse_gap"] += 1
    try:
        fair_probability = float(decision.get("fair_probability"))
    except (TypeError, ValueError):
        fair_probability = 0.5
    side = _side(decision)
    outcome_yes = int(outcome.get("outcome_yes") or 0)
    won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
    if not won and (fair_probability >= 0.7 or fair_probability <= 0.3):
        modes["high_confidence_weather_miss"] += 1
    brier = (fair_probability - outcome_yes) ** 2
    if brier >= 0.25:
        modes["weather_probability_miscalibration"] += 1
    try:
        edge_after_costs = float(decision.get("edge_after_costs_pct"))
    except (TypeError, ValueError):
        edge_after_costs = 0.0
    if edge_after_costs <= 2.0:
        modes["edge_too_thin_after_costs"] += 1
    price = decision.get("paper_fill_price_cents")
    if price is None:
        price = decision.get("market_price_cents")
    try:
        price_cents = float(price)
    except (TypeError, ValueError):
        price_cents = 50.0
    if not won and price_cents >= 70.0:
        modes["expensive_entry_loss"] += 1
    if not won and not modes:
        modes["no_obvious_failure_mode"] += 1
    return modes


def _weather_model_audit(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    *,
    now_text: str,
    weather_source_freshness: dict[str, Any],
    previous_weather_audit: dict[str, Any] | None,
) -> dict[str, Any]:
    weather_decisions = [decision for decision in decisions if _category(decision) == "weather"]
    scored_weather: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for decision in weather_decisions:
        outcome = latest_outcome_by_id.get(decision.get("decision_id"))
        if outcome is not None and _is_accepted(decision):
            scored_weather.append((decision, outcome))

    failure_modes: Counter[str] = Counter()
    buckets: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "scored": 0,
            "wins": 0,
            "simulated_pnl_usd": 0.0,
            "failure_modes": Counter(),
        }
    )
    for decision, outcome in scored_weather:
        modes = _weather_failure_modes(decision, outcome)
        failure_modes.update(modes)
        side = _side(decision)
        outcome_yes = int(outcome.get("outcome_yes") or 0)
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        key = (_weather_city(decision), _weather_market_type(decision), side)
        bucket = buckets[key]
        bucket["scored"] += 1
        bucket["wins"] += 1 if won else 0
        bucket["simulated_pnl_usd"] = round(bucket["simulated_pnl_usd"] + _trade_pnl(decision, outcome), 2)
        bucket["failure_modes"].update(modes)

    top_mode_name, top_mode_count = failure_modes.most_common(1)[0] if failure_modes else (None, 0)
    top_mode = _failure_mode_detail(top_mode_name, top_mode_count) if top_mode_name else None
    bucket_rows: list[dict[str, Any]] = []
    for (city, market_type, side), bucket in buckets.items():
        scored = int(bucket["scored"])
        wins = int(bucket["wins"])
        bucket_modes: Counter[str] = bucket["failure_modes"]
        bucket_top_name, bucket_top_count = bucket_modes.most_common(1)[0] if bucket_modes else (None, 0)
        bucket_top = _failure_mode_detail(bucket_top_name, bucket_top_count) if bucket_top_name else None
        if bucket_top_name in {"settlement_parse_gap", "unknown_or_missing_result_timing"}:
            recommendation = "Keep this bucket shadow-only until result timing and settlement parsing are clean."
            action_type = "repair_weather_evidence"
        elif scored >= 10 and bucket["simulated_pnl_usd"] < 0:
            recommendation = "Tighten this bucket before accepting more rapid-learning paper trades."
            action_type = "tighten_weather_bucket"
        else:
            recommendation = "Keep collecting source-backed weather outcomes before changing this bucket."
            action_type = "collect_more_scored_weather_evidence"
        bucket_rows.append(
            {
                "city": city,
                "market_type": market_type,
                "side": side,
                "scored": scored,
                "wins": wins,
                "win_rate": wins / scored if scored else None,
                "simulated_pnl_usd": _money(bucket["simulated_pnl_usd"]),
                "failure_modes": dict(bucket_modes),
                "failure_mode_summary": [_failure_mode_detail(mode, count) for mode, count in bucket_modes.most_common(4)],
                "top_failure_mode": bucket_top,
                "plain_english_summary": (
                    f"{city} {market_type.replace('_', ' ')} {side} paper trades have "
                    f"{wins}/{scored} wins and ${_money(bucket['simulated_pnl_usd']):.2f} paper P&L."
                ),
                "action": {
                    "type": action_type,
                    "recommendation": recommendation,
                    "plain_english": recommendation,
                    "application_scope": "current_epoch_weather_bucket",
                    "live_order_allowed": False,
                    "auto_apply_allowed": False,
                },
            }
        )
    bucket_rows.sort(key=lambda row: (int(row.get("scored") or 0), abs(float(row.get("simulated_pnl_usd") or 0.0))), reverse=True)

    source_ok = bool(weather_source_freshness.get("ok")) if weather_source_freshness else False
    if not weather_decisions:
        status = "waiting_for_current_epoch_weather_trades"
        recommendation = "Collect current-epoch weather paper trades only when city, station, date, threshold, direction, timing, and source freshness all match."
        plain = (
            "No current-epoch weather paper trades are available for this audit yet. "
            "Weather source freshness is shown separately; the older all-time audit is preserved only as historical baseline."
        )
        priority = "medium"
    elif not scored_weather:
        status = "waiting_for_current_epoch_weather_outcomes"
        recommendation = "Keep scoring current-epoch weather trades as soon as source-backed outcomes are known."
        plain = (
            f"{len(weather_decisions)} current-epoch weather paper trades exist, but none have source-backed outcomes yet. "
            "Accuracy and failure-mode lessons will update after those outcomes resolve."
        )
        priority = "medium"
    elif top_mode_name in {"settlement_parse_gap", "unknown_or_missing_result_timing"}:
        status = "repair_weather_evidence_before_expansion"
        recommendation = "Repair result timing and settlement parsing before expanding accepted weather paper risk."
        plain = (
            f"{len(scored_weather)} current-epoch weather trades are scored. "
            f"The main issue is {top_mode['label'].lower() if top_mode else 'unclear weather evidence'}."
        )
        priority = "high"
    elif sum(_money(row.get("simulated_pnl_usd")) for row in bucket_rows) < 0:
        status = "tighten_losing_weather_buckets"
        recommendation = "Tighten losing weather buckets and keep alternatives in shadow until forward-paper proof improves."
        plain = f"{len(scored_weather)} current-epoch weather trades are scored, but paper P&L is negative."
        priority = "high"
    else:
        status = "continue_weather_forward_paper"
        recommendation = "Continue collecting clean source-backed weather outcomes and compare them against market baselines."
        plain = f"{len(scored_weather)} current-epoch weather trades are scored. Keep expanding only clean, scoreable weather buckets."
        priority = "medium"

    return {
        "ok": True,
        "scope": "current_epoch",
        "is_current": True,
        "updated_at_utc": now_text,
        "audit_status": status,
        "weather_decisions": len(weather_decisions),
        "scored_weather_decisions": len(scored_weather),
        "unresolved_weather_decisions": max(0, len([d for d in weather_decisions if _is_accepted(d)]) - len(scored_weather)),
        "failure_modes": dict(failure_modes),
        "failure_mode_explanations": {
            mode: _failure_mode_detail(mode)
            for mode in WEATHER_FAILURE_MODE_DEFINITIONS
        },
        "top_failure_mode": top_mode,
        "plain_english": plain,
        "primary_action": {
            "type": status,
            "priority": priority,
            "recommendation": recommendation,
            "application_scope": "current_epoch_weather_only",
            "live_order_allowed": False,
            "auto_apply_allowed": False,
        },
        "bucket_summaries": bucket_rows[:12],
        "source_freshness": {
            "ok": source_ok,
            "timestamp_utc": weather_source_freshness.get("timestamp_utc"),
            "fresh_city_count": weather_source_freshness.get("fresh_city_count"),
            "checked_city_count": weather_source_freshness.get("checked_city_count"),
            "provider_health": weather_source_freshness.get("provider_health"),
            "source_hash": weather_source_freshness.get("source_hash"),
        },
        "previous_audit_preserved": bool(previous_weather_audit),
        "live_order_allowed": False,
        "auto_apply_allowed": False,
    }


def _strategy_family(decision: dict[str, Any]) -> str | None:
    if decision.get("inverse_strategy_applied") is True:
        return "inverse_standard_strategy"
    bucket = str(decision.get("strategy_bucket") or "").lower()
    experiment = str(decision.get("paper_experiment_type") or "").lower()
    source = str(decision.get("fair_value_source_type") or "").lower()
    method = str(decision.get("fair_value_method") or "").lower()
    skill = str(decision.get("skill") or decision.get("skill_name") or "").lower()
    decision_text = str(decision.get("decision") or "").upper()
    haystack = " ".join([bucket, experiment, source, method, skill, decision_text.lower()])
    if "polymarket-kalshi-divergence" in haystack or "polymarket_kalshi_divergence" in haystack:
        return "polymarket_kalshi_divergence"
    if "polyclaw" in haystack or "poly_claw" in haystack:
        return "polyclaw"
    if "weather_arbitrage" in bucket or "weather_arbitrage" in experiment:
        return "weather_arbitrage_strategy"
    if "inverse" in bucket or "inverse" in experiment or "INVERSE" in decision_text:
        return "inverse_standard_strategy"
    if bucket in {
        "high_probability_harvesting_simulation",
        "market_making_simulation",
        "weather_model_fast_evidence",
    }:
        return "standard_strategy"
    return None


def _strategy_performance(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    family: str,
) -> dict[str, Any]:
    family_decisions = [decision for decision in decisions if _strategy_family(decision) == family]
    accepted = [decision for decision in family_decisions if _is_accepted(decision)]
    scored = 0
    wins = 0
    pnl = 0.0
    profit = 0.0
    loss = 0.0
    for decision in accepted:
        outcome = latest_outcome_by_id.get(decision.get("decision_id"))
        if outcome is None:
            continue
        side = _side(decision)
        if side == "UNKNOWN":
            continue
        outcome_yes = int(outcome.get("outcome_yes") or 0)
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        trade_pnl = _trade_pnl(decision, outcome)
        scored += 1
        wins += 1 if won else 0
        pnl += trade_pnl
        if trade_pnl >= 0:
            profit += trade_pnl
        else:
            loss += abs(trade_pnl)
    unresolved = len(accepted) - scored
    return {
        "decisions": len(family_decisions),
        "accepted": len(accepted),
        "scored": scored,
        "wins": wins,
        "losses": max(0, scored - wins),
        "accuracy": wins / scored if scored else None,
        "paper_pnl_usd": _money(pnl),
        "total_profit_usd": _money(profit),
        "total_loss_usd": _money(loss),
        "unresolved": unresolved,
        "live_order_allowed": False,
    }


def _empty_strategy_comparison_performance() -> dict[str, Any]:
    return {
        "decisions": 0,
        "accepted": 0,
        "shadow_decisions": 0,
        "scored": 0,
        "wins": 0,
        "losses": 0,
        "accuracy": None,
        "paper_pnl_usd": 0.0,
        "total_profit_usd": 0.0,
        "total_loss_usd": 0.0,
        "average_pnl_per_scored_trade_usd": None,
        "unresolved": 0,
        "domains": {},
        "live_order_allowed": False,
    }


def _strategy_comparison_performance_by_tracking_id(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {
        strategy_id: _empty_strategy_comparison_performance()
        for strategy_id in STRATEGY_DISPLAY_NAMES
    }
    for decision in decisions:
        strategy_id = _strategy_tracking_id(decision)
        row = rows.setdefault(strategy_id, _empty_strategy_comparison_performance())
        row["decisions"] = int(row["decisions"]) + 1
        domains = row.setdefault("domains", {})
        category = _category(decision)
        domains[category] = int(domains.get(category, 0)) + 1
        if not _is_accepted(decision):
            row["shadow_decisions"] = int(row["shadow_decisions"]) + 1
            continue
        row["accepted"] = int(row["accepted"]) + 1
        decision_id = decision.get("decision_id")
        outcome = latest_outcome_by_id.get(decision_id) if isinstance(decision_id, str) else None
        if outcome is None:
            continue
        side = _side(decision)
        outcome_yes = _outcome_yes_value(outcome)
        if side not in {"YES", "NO"} or outcome_yes is None:
            continue
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        trade_pnl = _trade_pnl(decision, outcome)
        row["scored"] = int(row["scored"]) + 1
        row["wins" if won else "losses"] = int(row["wins" if won else "losses"]) + 1
        row["paper_pnl_usd"] = _money(float(row["paper_pnl_usd"]) + trade_pnl)
        if trade_pnl >= 0:
            row["total_profit_usd"] = _money(float(row["total_profit_usd"]) + trade_pnl)
        else:
            row["total_loss_usd"] = _money(float(row["total_loss_usd"]) + abs(trade_pnl))

    for row in rows.values():
        scored = int(row["scored"])
        wins = int(row["wins"])
        accepted = int(row["accepted"])
        row["losses"] = int(row["losses"])
        row["accuracy"] = wins / scored if scored else None
        row["unresolved"] = max(0, accepted - scored)
        row["average_pnl_per_scored_trade_usd"] = (
            _money(float(row["paper_pnl_usd"]) / scored) if scored else None
        )
        row["domains"] = dict(
            sorted(
                ((str(domain), int(count)) for domain, count in dict(row["domains"]).items()),
                key=lambda item: (-item[1], item[0]),
            )
        )
        row["live_order_allowed"] = False
    return rows


def _strategy_display_name(strategy_id: str) -> str:
    if strategy_id in STRATEGY_DISPLAY_NAMES:
        return STRATEGY_DISPLAY_NAMES[strategy_id]
    if strategy_id.startswith("strategy_bucket:"):
        raw = strategy_id.split(":", 1)[1]
    else:
        raw = strategy_id
    return raw.replace("_", " ").replace("-", " ").strip().title() or "Unknown Strategy"


def _strategy_tracking_id(decision: dict[str, Any]) -> str:
    family = _strategy_family(decision)
    if family:
        return family
    bucket = str(decision.get("strategy_bucket") or "").strip()
    if bucket:
        return f"strategy_bucket:{bucket.lower()}"
    experiment = str(decision.get("paper_experiment_type") or "").strip()
    if experiment:
        return f"strategy_bucket:{experiment.lower()}"
    source = str(decision.get("fair_value_source_type") or "").strip()
    if source:
        return f"strategy_bucket:{source.lower()}"
    return f"strategy_bucket:unclassified_{_category(decision)}"


def _has_trade_tracking_field(decision: dict[str, Any], field: str) -> bool:
    if field == "strategy_identity":
        return bool(_strategy_tracking_id(decision))
    if field == "domain":
        return bool(_category(decision))
    if field == "selected_side":
        return _side(decision) in {"YES", "NO"}
    if field == "entry_price":
        return _pending_entry_price_cents(decision) is not None or decision.get("market_price_probability") is not None
    if field == "fair_probability":
        return any(decision.get(key) is not None for key in ("fair_probability", "selected_side_fair_probability", "estimated_success_probability"))
    if field == "market_snapshot_hash":
        return bool(decision.get("market_snapshot_hash") or decision.get("orderbook_snapshot_hash"))
    if field == "reality_contract":
        return isinstance(decision.get("reality_contract"), dict)
    if field == "ml_governance":
        return isinstance(decision.get("ml_governance"), dict)
    if field == "live_order_allowed_false":
        return decision.get("live_order_allowed") is False and decision.get("auto_live_promotion_allowed") is not True
    if field == "strategy_taxonomy":
        return isinstance(decision.get("strategy_taxonomy"), dict)
    if field == "baseline_comparison":
        return isinstance(decision.get("baseline_comparison"), dict)
    value = decision.get(field)
    return value is not None and value != ""


def _trade_tracking_presence(decision: dict[str, Any]) -> tuple[int, list[str]]:
    missing: list[str] = []
    present = 0
    for item in TRADE_TRACKING_FIELD_CONTRACT:
        field = item["field"]
        if _has_trade_tracking_field(decision, field):
            present += 1
        else:
            missing.append(field)
    return present, missing


def _yes_probability(decision: dict[str, Any]) -> float | None:
    for key in ("fair_probability", "estimated_success_probability"):
        value = decision.get(key)
        try:
            probability = float(value)
        except (TypeError, ValueError):
            continue
        if 0.0 <= probability <= 1.0:
            return probability
    selected = decision.get("selected_side_fair_probability")
    try:
        selected_probability = float(selected)
    except (TypeError, ValueError):
        return None
    if not 0.0 <= selected_probability <= 1.0:
        return None
    side = _side(decision)
    if side == "NO":
        return 1.0 - selected_probability
    if side == "YES":
        return selected_probability
    return None


def _market_yes_probability(decision: dict[str, Any]) -> float | None:
    value = decision.get("market_price_probability")
    try:
        probability = float(value)
    except (TypeError, ValueError):
        probability = None
    if probability is not None and 0.0 <= probability <= 1.0:
        return probability
    entry = _pending_entry_price_cents(decision)
    if entry is None:
        return None
    side = _side(decision)
    selected_probability = entry / 100.0
    if side == "NO":
        return 1.0 - selected_probability
    if side == "YES":
        return selected_probability
    return None


def _strategy_weighting(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    latest_shadow_outcome_by_id: dict[str, dict[str, Any]],
    *,
    weather_crypto_ml_dataset: dict[str, Any],
    learning_velocity: dict[str, Any],
) -> dict[str, Any]:
    rows: dict[str, dict[str, Any]] = {
        strategy_id: {
            "strategy_id": strategy_id,
            "display_name": display_name,
            "decisions": 0,
            "accepted": 0,
            "shadow_decisions": 0,
            "accepted_scored": 0,
            "shadow_scored": 0,
            "wins": 0,
            "losses": 0,
            "accepted_pnl_usd": 0.0,
            "brier_sum": 0.0,
            "market_brier_sum": 0.0,
            "brier_count": 0,
            "market_brier_count": 0,
            "domains": Counter(),
            "missing_fields": Counter(),
            "field_presence_sum": 0,
            "latest_decision_at_utc": None,
        }
        for strategy_id, display_name in STRATEGY_DISPLAY_NAMES.items()
    }
    for decision in decisions:
        strategy_id = _strategy_tracking_id(decision)
        row = rows.setdefault(
            strategy_id,
            {
                "strategy_id": strategy_id,
                "display_name": _strategy_display_name(strategy_id),
                "decisions": 0,
                "accepted": 0,
                "shadow_decisions": 0,
                "accepted_scored": 0,
                "shadow_scored": 0,
                "wins": 0,
                "losses": 0,
                "accepted_pnl_usd": 0.0,
                "brier_sum": 0.0,
                "market_brier_sum": 0.0,
                "brier_count": 0,
                "market_brier_count": 0,
                "domains": Counter(),
                "missing_fields": Counter(),
                "field_presence_sum": 0,
                "latest_decision_at_utc": None,
            },
        )
        row["decisions"] = int(row["decisions"]) + 1
        if _is_accepted(decision):
            row["accepted"] = int(row["accepted"]) + 1
        else:
            row["shadow_decisions"] = int(row["shadow_decisions"]) + 1
        category = _category(decision)
        row["domains"][category] += 1
        present, missing = _trade_tracking_presence(decision)
        row["field_presence_sum"] = int(row["field_presence_sum"]) + present
        row["missing_fields"].update(missing)
        timestamp = parse_utc(decision.get("timestamp_utc"))
        previous = parse_utc(row.get("latest_decision_at_utc"))
        if timestamp is not None and (previous is None or timestamp > previous):
            row["latest_decision_at_utc"] = timestamp.isoformat().replace("+00:00", "Z")
        decision_id = decision.get("decision_id")
        outcome = latest_outcome_by_id.get(decision_id) if isinstance(decision_id, str) else None
        shadow_outcome = latest_shadow_outcome_by_id.get(decision_id) if isinstance(decision_id, str) else None
        resolved = outcome if outcome is not None else shadow_outcome
        if not isinstance(resolved, dict) or resolved.get("resolved") is not True:
            continue
        if outcome is not None:
            row["accepted_scored"] = int(row["accepted_scored"]) + 1
        else:
            row["shadow_scored"] = int(row["shadow_scored"]) + 1
        side = _side(decision)
        try:
            outcome_yes = int(resolved.get("outcome_yes"))
        except (TypeError, ValueError):
            continue
        if outcome_yes not in {0, 1} or side not in {"YES", "NO"}:
            continue
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        row["wins" if won else "losses"] = int(row["wins" if won else "losses"]) + 1
        if outcome is not None:
            row["accepted_pnl_usd"] = round(float(row["accepted_pnl_usd"]) + _trade_pnl(decision, resolved), 2)
        probability = _yes_probability(decision)
        if probability is not None:
            row["brier_sum"] = float(row["brier_sum"]) + (probability - outcome_yes) ** 2
            row["brier_count"] = int(row["brier_count"]) + 1
        market_probability = _market_yes_probability(decision)
        if market_probability is not None:
            row["market_brier_sum"] = float(row["market_brier_sum"]) + (market_probability - outcome_yes) ** 2
            row["market_brier_count"] = int(row["market_brier_count"]) + 1

    raw_weights: dict[str, float] = {}
    output_rows: list[dict[str, Any]] = []
    field_count = len(TRADE_TRACKING_FIELD_CONTRACT)
    for strategy_id, row in rows.items():
        decisions_count = int(row["decisions"])
        accepted_scored = int(row["accepted_scored"])
        shadow_scored = int(row["shadow_scored"])
        validated = accepted_scored + shadow_scored
        wins = int(row["wins"])
        losses = int(row["losses"])
        accuracy = wins / (wins + losses) if wins + losses else None
        data_integrity = (int(row["field_presence_sum"]) / (decisions_count * field_count)) if decisions_count else 0.0
        brier_count = int(row["brier_count"])
        market_brier_count = int(row["market_brier_count"])
        brier_score = float(row["brier_sum"]) / brier_count if brier_count else None
        market_brier_score = float(row["market_brier_sum"]) / market_brier_count if market_brier_count else None
        domains = dict(sorted(row["domains"].items()))
        domain_total = sum(int(count) for count in domains.values()) or decisions_count or 1
        weather_crypto_count = int(domains.get("weather", 0)) + int(domains.get("crypto", 0))
        sports_count = int(domains.get("sports", 0))
        weather_crypto_share = weather_crypto_count / domain_total
        sports_share = sports_count / domain_total
        weather_crypto_focus = weather_crypto_share >= 0.5
        sports_or_blocked_focus = sports_share >= 0.5 and weather_crypto_share < 0.25
        sample_need = 1.0 - min(1.0, validated / 500.0)
        sample_strength = min(1.0, validated / 300.0)
        pnl = float(row["accepted_pnl_usd"])
        pnl_signal = 0.0 if accepted_scored == 0 else max(-1.0, min(1.0, pnl / max(1.0, accepted_scored)))
        market_beating_signal = 0.0
        if brier_score is not None and market_brier_score is not None:
            market_beating_signal = max(-1.0, min(1.0, market_brier_score - brier_score))
        raw = 0.35 + (3.2 * weather_crypto_share) + (sample_need * (0.35 + weather_crypto_share)) + max(0.0, market_beating_signal * 8.0) + max(0.0, pnl_signal)
        raw *= max(0.15, data_integrity)
        if sports_or_blocked_focus:
            raw *= 0.08
        elif sports_share > 0:
            raw *= max(0.15, 1.0 - (sports_share * 0.85))
        if decisions_count == 0:
            raw = 0.05
        raw_weights[strategy_id] = raw
        output_rows.append(
            {
                "strategy_id": strategy_id,
                "display_name": row["display_name"],
                "decisions": decisions_count,
                "accepted": int(row["accepted"]),
                "shadow_decisions": int(row["shadow_decisions"]),
                "validated_trades": validated,
                "accepted_scored": accepted_scored,
                "shadow_scored": shadow_scored,
                "accuracy": round(accuracy, 4) if isinstance(accuracy, float) else None,
                "accepted_pnl_usd": round(pnl, 2),
                "brier_score": round(brier_score, 6) if isinstance(brier_score, float) else None,
                "market_brier_score": round(market_brier_score, 6) if isinstance(market_brier_score, float) else None,
                "data_integrity_score": round(data_integrity, 4),
                "sample_strength": round(sample_strength, 4),
                "sample_need": round(sample_need, 4),
                "domains": domains,
                "weather_crypto_share": round(weather_crypto_share, 4),
                "sports_share": round(sports_share, 4),
                "top_missing_fields": [field for field, _count in row["missing_fields"].most_common(6)],
                "latest_decision_at_utc": row["latest_decision_at_utc"],
                "raw_learning_weight": round(raw, 6),
                "accepted_paper_weight_pct": 0.0,
                "accepted_paper_weight_reason": "Accepted paper weight remains 0 until a segment passes clean forward-paper proof gates.",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )
    total_raw = sum(raw_weights.values()) or 1.0
    for row in output_rows:
        weight = raw_weights.get(row["strategy_id"], 0.0) / total_raw * 100.0
        row["paper_learning_weight_pct"] = round(weight, 1)
        row["recommended_next_shadow_trades"] = 0 if row["paper_learning_weight_pct"] < 1 else max(1, int(round(row["paper_learning_weight_pct"] / 100.0 * 30)))
        row["paper_learning_weight_reason"] = (
            "Prioritize because it is weather/crypto, high-velocity, and useful for ML integrity."
            if float(row.get("weather_crypto_share") or 0.0) >= 0.5
            else "Keep visible as a control/comparison lane; do not let it consume weather/crypto acceleration."
        )
    output_rows.sort(key=lambda item: (float(item["paper_learning_weight_pct"]), int(item["validated_trades"]), int(item["decisions"])), reverse=True)
    dataset_rows = int(weather_crypto_ml_dataset.get("row_count") or 0)
    return {
        "ok": True,
        "scope": "current_epoch_strategy_weights_and_dynamic_strategy_buckets",
        "weight_type": "paper_learning_attention_not_live_risk",
        "plain_english": "Weights allocate paper-learning attention and dashboard priority only. They do not authorize accepted exposure or live trading.",
        "strategy_count": len(output_rows),
        "rows": output_rows,
        "dataset_rows": dataset_rows,
        "learning_resolved_last_1h": learning_velocity.get("resolved_last_1h"),
        "accepted_paper_weight_policy": "0% for all strategies until source-backed forward-paper proof gates pass.",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _trade_tracking_contract(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    latest_shadow_outcome_by_id: dict[str, dict[str, Any]],
    *,
    weather_crypto_ml_dataset: dict[str, Any],
    weather_forward_evidence_capture: dict[str, Any] | None = None,
    sts_forward_paper_promotion: dict[str, Any] | None = None,
) -> dict[str, Any]:
    field_totals = {item["field"]: 0 for item in TRADE_TRACKING_FIELD_CONTRACT}
    by_strategy: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        strategy_id = _strategy_tracking_id(decision)
        row = by_strategy.setdefault(
            strategy_id,
            {
                "strategy_id": strategy_id,
                "display_name": _strategy_display_name(strategy_id),
                "decisions": 0,
                "missing_field_counts": Counter(),
                "field_presence_sum": 0,
                "validated_labels": 0,
                "live_order_allowed": False,
            },
        )
        row["decisions"] = int(row["decisions"]) + 1
        present, missing = _trade_tracking_presence(decision)
        row["field_presence_sum"] = int(row["field_presence_sum"]) + present
        row["missing_field_counts"].update(missing)
        for item in TRADE_TRACKING_FIELD_CONTRACT:
            if item["field"] not in missing:
                field_totals[item["field"]] += 1
        decision_id = decision.get("decision_id")
        if isinstance(decision_id, str) and (
            decision_id in latest_outcome_by_id or decision_id in latest_shadow_outcome_by_id
        ):
            row["validated_labels"] = int(row["validated_labels"]) + 1
    total = len(decisions)
    field_count = len(TRADE_TRACKING_FIELD_CONTRACT)
    strategy_rows: list[dict[str, Any]] = []
    for row in by_strategy.values():
        decisions_count = int(row["decisions"])
        coverage = int(row["field_presence_sum"]) / (decisions_count * field_count) if decisions_count else 0.0
        strategy_rows.append(
            {
                "strategy_id": row["strategy_id"],
                "display_name": row["display_name"],
                "decisions": decisions_count,
                "validated_labels": int(row["validated_labels"]),
                "data_integrity_score": round(coverage, 4),
                "top_missing_fields": [field for field, _count in row["missing_field_counts"].most_common(8)],
                "live_order_allowed": False,
            }
        )
    strategy_rows.sort(key=lambda item: (item["data_integrity_score"], item["validated_labels"], item["decisions"]), reverse=True)
    forward_capture = weather_forward_evidence_capture if isinstance(weather_forward_evidence_capture, dict) else {}
    return {
        "ok": True,
        "scope": "all_current_epoch_decisions_with_accepted_and_shadow_labels",
        "total_tracked_decisions": total,
        "validated_labels": sum(1 for decision in decisions if isinstance(decision.get("decision_id"), str) and (decision["decision_id"] in latest_outcome_by_id or decision["decision_id"] in latest_shadow_outcome_by_id)),
        "weather_crypto_ml_dataset_rows": int(weather_crypto_ml_dataset.get("row_count") or 0),
        "weather_forward_evidence_complete_count": int(forward_capture.get("evidence_complete_count") or 0),
        "weather_forward_shadow_learning_useful_count": int(forward_capture.get("shadow_learning_useful_count") or 0),
        "required_fields": list(TRADE_TRACKING_FIELD_CONTRACT),
        "field_coverage": [
            {
                "field": item["field"],
                "label": item["label"],
                "present_count": field_totals[item["field"]],
                "coverage": round(field_totals[item["field"]] / total, 4) if total else 0.0,
                "why": item["why"],
            }
            for item in TRADE_TRACKING_FIELD_CONTRACT
        ],
        "by_strategy": strategy_rows,
        "plain_english": "Every paper decision now has a dashboard-visible ML data contract: identity, timing, side, price, fair value, source, baseline, taxonomy, governance, and no-live safety.",
        "critical_missing_fields": [
            item["field"]
            for item in TRADE_TRACKING_FIELD_CONTRACT
            if total and field_totals[item["field"]] / total < 0.8
        ],
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _paper_trade_accelerator(
    active_decisions: list[dict[str, Any]] | None = None,
    *,
    weather_crypto_ml_dataset: dict[str, Any],
    learning_velocity: dict[str, Any],
    crypto_readiness: dict[str, Any],
    weather_source_freshness: dict[str, Any],
    strategy_weighting: dict[str, Any],
    sts_learning_controls: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row_count = int(weather_crypto_ml_dataset.get("row_count") or 0)
    route_mix = _route_mix_by_domain(active_decisions or [])
    route_mix_total = {
        "overall": _route_mix_share(route_mix.get("overall", {})),
        "weather_crypto": _route_mix_share(route_mix.get("weather_crypto", {})),
    }
    learning_target = 1000
    profit_target = 3000
    per_hour = int(learning_velocity.get("resolved_last_1h") or 0)
    learning_controls = sts_learning_controls or {}
    velocity_boost = float(learning_controls.get("learning_velocity_multiplier") or 1.0)
    pressure_weather = float(learning_controls.get("weather_crypto_learning_pressure_multiplier_weather") or 1.0)
    pressure_crypto = float(learning_controls.get("weather_crypto_learning_pressure_multiplier_crypto") or 1.0)
    stochastic_pressure = float(learning_controls.get("stochastic_process_pressure") or 0.0)
    stochastic_pressure_safety = float(learning_controls.get("stochastic_pressure_safety_factor") or 1.0)
    sports_guard = float(learning_controls.get("weather_crypto_reallocation_guard") or 1.0)
    execution_reliability = _countdown_number(learning_controls.get("execution_reliability_score")) or _countdown_number(learning_controls.get("execution_reliability")) or 0.0

    return {
        "ok": True,
        "route_mix": route_mix,
        "route_mix_total": route_mix_total,
        "mode": "PAPER_ONLY_SHADOW_FIRST",
        "validated_weather_crypto_rows": row_count,
        "learning_target_rows": learning_target,
        "profit_proof_target_rows": profit_target,
        "rows_needed_to_learning_target": max(0, learning_target - row_count),
        "rows_needed_to_profit_proof_target": max(0, profit_target - row_count),
        "learning_rows_last_1h": per_hour,
        "estimated_hours_to_learning_target_at_current_rate": round(max(0, learning_target - row_count) / per_hour, 2) if per_hour > 0 else None,
        "fastest_safe_loop": [
            "resolve_due_weather_crypto_outcomes_first",
            "capture_rolling_crypto_15m_shadow_cohorts",
            "refresh_near_resolution_weather_sources",
            "create_only_leakage_guarded_weather_crypto_candidates",
            "keep_sports_out_of_accepted_exposure",
        ],
        "next_crypto_check_time_utc": crypto_readiness.get("next_crypto_learning_snapshot_check_time_utc") or crypto_readiness.get("next_crypto_trade_ready_check_time_utc"),
        "next_crypto_result_check_time_utc": crypto_readiness.get("next_crypto_trade_ready_check_time_utc"),
        "next_crypto_learning_snapshot_check_time_utc": crypto_readiness.get("next_crypto_learning_snapshot_check_time_utc"),
        "next_crypto_learning_check_reason": crypto_readiness.get("next_crypto_learning_check_reason"),
        "weather_source_freshness_ok": weather_source_freshness.get("ok") is True,
        "strategy_weight_policy": strategy_weighting.get("weight_type"),
        "learning_speed_boost": round(velocity_boost, 6),
        "learning_pressure_weather": round(pressure_weather, 6),
        "learning_pressure_crypto": round(pressure_crypto, 6),
        "stochastic_process_pressure": round(stochastic_pressure, 6),
        "stochastic_pressure_safety_factor": round(stochastic_pressure_safety, 6),
        "execution_reliability_score": round(execution_reliability, 6),
        "sports_reallocation_guard": round(sports_guard, 6),
        "integrity_constraints": [
            "source_backed_labels_only",
            "no_future_leakage",
            "chronological_validation",
            "market_random_no_trade_baselines_required",
            "accepted_paper_weight_zero_until_proof_gate",
            "live_order_allowed_false",
        ],
        "plain_english": "The fastest safe path is high-volume shadow Weather/Crypto learning, immediate source-backed resolution, and zero accepted/live escalation until a strategy beats market baselines.",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _strategy_pnl_delta_fields(row: dict[str, Any], standard: dict[str, Any]) -> dict[str, Any]:
    row_scored = int(row.get("scored") or 0)
    standard_scored = int(standard.get("scored") or 0)
    row_pnl = row.get("paper_pnl_usd")
    standard_pnl = standard.get("paper_pnl_usd")
    strategy_id = row.get("strategy_id")
    if (
        strategy_id == "standard_strategy"
        and isinstance(row_pnl, (int, float))
        and row_scored > 0
    ):
        return {
            "pnl_delta_vs_standard_usd": 0.0,
            "pnl_delta_vs_standard_label": "baseline",
            "pnl_delta_vs_standard_source": "actual_accepted_paper_trades",
            "pnl_delta_status": "baseline",
            "pnl_delta_display": _signed_money_display(0.0),
            "pnl_delta_tone": "neutral",
        }
    if (
        isinstance(row_pnl, (int, float))
        and isinstance(standard_pnl, (int, float))
        and row_scored > 0
        and standard_scored > 0
    ):
        delta = _money(float(row_pnl) - float(standard_pnl))
        return {
            "pnl_delta_vs_standard_usd": delta,
            "pnl_delta_vs_standard_label": "actual vs Standard",
            "pnl_delta_vs_standard_source": "actual_accepted_paper_trades",
            "pnl_delta_status": "actual",
            "pnl_delta_display": _signed_money_display(delta),
            "pnl_delta_tone": "positive" if delta > 0 else "negative" if delta < 0 else "neutral",
        }
    audit_delta = row.get("audit_delta_vs_standard_pnl_usd")
    if isinstance(audit_delta, (int, float)):
        delta = _money(audit_delta)
        is_standard = strategy_id == "standard_strategy"
        return {
            "pnl_delta_vs_standard_usd": delta,
            "pnl_delta_vs_standard_label": "audit baseline vs Standard" if is_standard else "audit vs Standard",
            "pnl_delta_vs_standard_source": "historical_inverse_audit",
            "pnl_delta_status": "audit_baseline" if is_standard else "audit",
            "pnl_delta_display": _signed_money_display(delta),
            "pnl_delta_tone": "positive" if delta > 0 else "negative" if delta < 0 else "neutral",
        }
    if standard_scored <= 0:
        return {
            "pnl_delta_vs_standard_usd": None,
            "pnl_delta_vs_standard_label": "waiting for Standard Strategy proof",
            "pnl_delta_vs_standard_source": "not_enough_resolved_accepted_paper",
            "pnl_delta_status": "waiting_for_standard_strategy_proof",
            "pnl_delta_display": "Waiting for Standard",
            "pnl_delta_tone": "waiting",
        }
    return {
        "pnl_delta_vs_standard_usd": None,
        "pnl_delta_vs_standard_label": "waiting for scored proof",
        "pnl_delta_vs_standard_source": "not_enough_resolved_accepted_paper",
        "pnl_delta_status": "waiting_for_scored_proof",
        "pnl_delta_display": "Waiting for proof",
        "pnl_delta_tone": "waiting",
    }


def _inverse_audit_metrics_from_opportunities(inverse_audit: dict[str, Any]) -> dict[str, Any]:
    existing = inverse_audit.get("metrics")
    if isinstance(existing, dict) and isinstance(existing.get("inverse_accuracy"), (int, float)):
        return existing
    opportunities = inverse_audit.get("opportunities")
    if not isinstance(opportunities, list):
        return {}
    total_scored = 0
    standard_wins = 0.0
    inverse_wins = 0.0
    standard_pnl = 0.0
    inverse_pnl = 0.0
    for raw in opportunities:
        if not isinstance(raw, dict):
            continue
        scored = int(raw.get("scored") or 0)
        if scored <= 0:
            continue
        total_scored += scored
        standard_wins += scored * float(raw.get("current_accuracy") or 0.0)
        inverse_wins += scored * float(raw.get("inverse_accuracy") or 0.0)
        standard_pnl += float(raw.get("current_pnl_usd") or 0.0)
        inverse_pnl += float(raw.get("inverse_pnl_usd") or 0.0)
    if total_scored <= 0:
        return {}
    standard_accuracy = standard_wins / total_scored
    inverse_accuracy = inverse_wins / total_scored
    return {
        "total_directional_scored": total_scored,
        "original_accuracy": standard_accuracy,
        "inverse_accuracy": inverse_accuracy,
        "accuracy_delta_inverse_minus_original": inverse_accuracy - standard_accuracy,
        "original_pnl_usd": round(standard_pnl, 2),
        "inverse_pnl_usd": round(inverse_pnl, 2),
        "pnl_delta_inverse_minus_original_usd": round(inverse_pnl - standard_pnl, 2),
        "source": "inverse_strategy_audit_opportunity_aggregate",
    }


def _normalize_inverse_audit(inverse_audit: dict[str, Any]) -> dict[str, Any]:
    metrics = _inverse_audit_metrics_from_opportunities(inverse_audit)
    if not metrics:
        return inverse_audit
    return {
        **inverse_audit,
        "metrics": {
            **metrics,
            **(inverse_audit.get("metrics") if isinstance(inverse_audit.get("metrics"), dict) else {}),
        },
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _strategy_comparison(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    inverse_audit: dict[str, Any],
) -> dict[str, Any]:
    lane_runs, _lane_run_warnings = load_jsonl(LOGS_DIR / "strategy_lane_candidate_runs.jsonl")
    latest_lane_run = lane_runs[-1] if lane_runs else {}
    latest_created_by_lane = latest_lane_run.get("created_by_lane") if isinstance(latest_lane_run.get("created_by_lane"), dict) else {}
    inverse_audit = _normalize_inverse_audit(inverse_audit)
    metrics = inverse_audit.get("metrics") if isinstance(inverse_audit.get("metrics"), dict) else {}
    performance_by_strategy = _strategy_comparison_performance_by_tracking_id(decisions, latest_outcome_by_id)
    standard = performance_by_strategy["standard_strategy"]
    inverse = performance_by_strategy["inverse_standard_strategy"]
    weather_arbitrage = performance_by_strategy["weather_arbitrage_strategy"]
    polyclaw = performance_by_strategy["polyclaw"]
    polymarket_divergence = performance_by_strategy["polymarket_kalshi_divergence"]
    if isinstance(metrics.get("original_accuracy"), (int, float)):
        standard["audit_accuracy"] = metrics.get("original_accuracy")
        standard["audit_pnl_usd"] = metrics.get("original_pnl_usd")
        standard["audit_delta_vs_standard_accuracy"] = 0.0
        standard["audit_delta_vs_standard_pnl_usd"] = 0.0
        if isinstance(metrics.get("total_directional_scored"), (int, float)):
            standard["audit_scored"] = int(metrics.get("total_directional_scored") or 0)
    if isinstance(metrics.get("inverse_accuracy"), (int, float)):
        inverse["audit_accuracy"] = metrics.get("inverse_accuracy")
        inverse["audit_pnl_usd"] = metrics.get("inverse_pnl_usd")
        inverse["audit_delta_vs_standard_accuracy"] = metrics.get("accuracy_delta_inverse_minus_original")
        inverse["audit_delta_vs_standard_pnl_usd"] = metrics.get("pnl_delta_inverse_minus_original_usd")
        if isinstance(metrics.get("total_directional_scored"), (int, float)):
            inverse["audit_scored"] = int(metrics.get("total_directional_scored") or 0)
    if weather_arbitrage["decisions"] == 0:
        if latest_lane_run:
            weather_arbitrage["tracking_status"] = "tracking_no_candidates_yet"
            weather_arbitrage["next_step"] = "Weather Arbitrage Strategy scanner is running; no clean weather-arbitrage paper candidate has passed the current filters yet."
        else:
            weather_arbitrage["tracking_status"] = "waiting_for_weather_arbitrage_scanner"
            weather_arbitrage["next_step"] = "Run the comparison-lane scanner, then log paper-only Weather Arbitrage Strategy candidates."
    else:
        weather_arbitrage["tracking_status"] = "tracking"
        weather_arbitrage["next_step"] = "Compare Weather Arbitrage Strategy against Standard Strategy and Inverse Standard Strategy after outcomes resolve."
    if polyclaw["decisions"] == 0:
        if latest_lane_run:
            polyclaw["tracking_status"] = "tracking_no_candidates_yet"
            polyclaw["next_step"] = "PolyClaw comparison lane is running; wait for clean paper candidates and resolved outcomes."
        else:
            polyclaw["tracking_status"] = "waiting_for_polyclaw_skill_data"
            polyclaw["next_step"] = "Run the PolyClaw skill in paper-only mode so its candidates can be scored against the other methods."
    else:
        polyclaw["tracking_status"] = "tracking"
        polyclaw["next_step"] = "Compare PolyClaw's resolved paper accuracy, P&L, and unresolved exposure against the other methods."
    if polymarket_divergence["decisions"] == 0:
        if latest_lane_run:
            polymarket_divergence["tracking_status"] = "tracking_shadow_only"
            polymarket_divergence["next_step"] = "polymarket-kalshi-divergence is running as shadow-only until real Polymarket reference prices are attached."
        else:
            polymarket_divergence["tracking_status"] = "waiting_for_polymarket_kalshi_divergence_skill_data"
            polymarket_divergence["next_step"] = "Run the polymarket-kalshi-divergence skill in paper-only mode so cross-market divergence candidates can be scored."
    else:
        polymarket_divergence["tracking_status"] = "tracking"
        polymarket_divergence["next_step"] = "Compare polymarket-kalshi-divergence against PolyClaw, Weather Arbitrage Strategy, and the Standard/Inverse methods."
    canonical_rows = [
        ("standard_strategy", "old_baseline_shadow_control", standard),
        ("inverse_standard_strategy", "active_inverse_first_paper_learning", inverse),
        ("weather_arbitrage_strategy", "tracked_weather_arbitrage_lane", weather_arbitrage),
        ("polyclaw", "tracked_polyclaw_skill_lane", polyclaw),
        ("polymarket_kalshi_divergence", "tracked_cross_market_divergence_skill_lane", polymarket_divergence),
    ]
    rows = [
        {
            "strategy_id": strategy_id,
            "display_name": _strategy_display_name(strategy_id),
            "role": role,
            **performance,
        }
        for strategy_id, role, performance in canonical_rows
    ]
    for row in rows:
        if row["strategy_id"] == "standard_strategy":
            row.setdefault("tracking_status", "baseline")
            row.setdefault("next_step", "Keep as the Standard Strategy control group.")
        elif row["strategy_id"] == "inverse_standard_strategy":
            row.setdefault("tracking_status", "tracking")
            row.setdefault("next_step", "Keep proving executable forward-paper quality.")
    canonical_ids = {strategy_id for strategy_id, _role, _performance in canonical_rows}
    for strategy_id in sorted(set(performance_by_strategy) - canonical_ids, key=_strategy_display_name):
        performance = performance_by_strategy[strategy_id]
        tracking_status = "tracking" if int(performance.get("scored") or 0) > 0 else (
            "waiting_for_outcomes" if int(performance.get("accepted") or 0) > 0 else "shadow_or_control_only"
        )
        next_step = (
            "Compare this named strategy lane against Standard Strategy after more outcomes resolve."
            if tracking_status == "tracking"
            else "Wait for accepted paper outcomes before trusting this lane."
            if tracking_status == "waiting_for_outcomes"
            else "Keep this lane shadow-only until it earns accepted paper proof."
        )
        rows.append(
            {
                "strategy_id": strategy_id,
                "display_name": _strategy_display_name(strategy_id),
                "role": "named_strategy_lane",
                **performance,
                "tracking_status": tracking_status,
                "next_step": next_step,
            }
        )
    equal_weight_pct = round(100.0 / len(rows), 1) if rows else 0.0
    for row in rows:
        row["strategy_comparison_weight_pct"] = equal_weight_pct
        row["strategy_comparison_weight_label"] = "equal strategy weight"
        row["pnl_delta_baseline_strategy_id"] = "standard_strategy"
        row["pnl_delta_baseline_display_name"] = "Standard Strategy"
        row.update(_strategy_pnl_delta_fields(row, standard))
    actual_standard_accuracy = standard.get("accuracy")
    actual_inverse_accuracy = inverse.get("accuracy")
    actual_standard_pnl = float(standard.get("paper_pnl_usd") or 0.0)
    actual_inverse_pnl = float(inverse.get("paper_pnl_usd") or 0.0)
    actual_accuracy_delta = (
        actual_inverse_accuracy - actual_standard_accuracy
        if isinstance(actual_standard_accuracy, (int, float)) and isinstance(actual_inverse_accuracy, (int, float))
        else None
    )
    audit_accuracy_delta = metrics.get("accuracy_delta_inverse_minus_original")
    audit_pnl_delta = metrics.get("pnl_delta_inverse_minus_original_usd")
    return {
        "ok": True,
        "scope": "actual_accepted_paper_trades_plus_historical_inverse_audit",
        "primary_metric_source": "actual_accepted_paper_trades",
        "secondary_metric_source": "historical_inverse_audit",
        "actual_summary": {
            "standard_accuracy": actual_standard_accuracy,
            "inverse_standard_accuracy": actual_inverse_accuracy,
            "accuracy_delta_inverse_minus_standard": actual_accuracy_delta,
            "standard_pnl_usd": actual_standard_pnl,
            "inverse_standard_pnl_usd": actual_inverse_pnl,
            "pnl_delta_inverse_minus_standard_usd": _money(actual_inverse_pnl - actual_standard_pnl),
            "standard_scored": standard.get("scored"),
            "inverse_standard_scored": inverse.get("scored"),
            "live_order_allowed": False,
        },
        "audit_summary": {
            "standard_accuracy": metrics.get("original_accuracy"),
            "inverse_standard_accuracy": metrics.get("inverse_accuracy"),
            "accuracy_delta_inverse_minus_standard": audit_accuracy_delta,
            "standard_pnl_usd": metrics.get("original_pnl_usd"),
            "inverse_standard_pnl_usd": metrics.get("inverse_pnl_usd"),
            "pnl_delta_inverse_minus_standard_usd": audit_pnl_delta,
            "scored": metrics.get("total_directional_scored"),
            "source": metrics.get("source"),
            "executable_quality_fraction": metrics.get("executable_quality_fraction"),
            "synthetic_or_unpriced_trades": metrics.get("synthetic_or_unpriced_trades"),
            "live_order_allowed": False,
        },
        "standardized_names": {
            row["strategy_id"]: row["display_name"]
            for row in rows
        },
        "equal_weighting": {
            "enabled": True,
            "strategy_count": len(rows),
            "weight_pct_per_strategy": equal_weight_pct,
            "baseline_strategy_id": "standard_strategy",
            "pnl_delta_policy": (
                "Every strategy row receives the same visual/comparison weight and an explicit P&L delta state. "
                "Standard Strategy is displayed as the $0.00 baseline; rows without enough proof show a waiting state instead of a blank cell."
            ),
            "live_order_allowed": False,
        },
        "rows": rows,
        "plain_english": (
            "This section gives every named strategy lane equal visual weight and an explicit P&L Delta vs Standard Strategy. "
            "Actual accepted paper trades are primary; historical inverse audit values are supporting evidence only."
        ),
        "latest_strategy_lane_run": {
            "timestamp_utc": latest_lane_run.get("timestamp_utc"),
            "markets_seen": latest_lane_run.get("markets_seen"),
            "orderbooks_checked": latest_lane_run.get("orderbooks_checked"),
            "created_count": latest_lane_run.get("created_count"),
            "created_by_lane": latest_created_by_lane,
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _load_previous() -> dict[str, Any]:
    if not DASHBOARD_OUTPUT_PATH.exists():
        return {}
    try:
        payload = json.loads(DASHBOARD_OUTPUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _weather_lane_dashboard_snapshot(
    previous_weather_lane: dict[str, Any],
    latest_weather: dict[str, Any],
    latest_weather_candidates: dict[str, Any],
    *,
    now: datetime,
) -> dict[str, Any]:
    lane = dict(previous_weather_lane) if isinstance(previous_weather_lane, dict) else {}
    candidate_time = latest_weather_candidates.get("timestamp_utc")
    candidate_age = _age_minutes(candidate_time, now)
    latest_created = int(latest_weather_candidates.get("created_count") or 0) if isinstance(latest_weather_candidates, dict) else 0
    latest_markets_seen = int(latest_weather_candidates.get("markets_seen") or 0) if isinstance(latest_weather_candidates, dict) else 0
    skipped_reasons = latest_weather_candidates.get("skipped_reasons") if isinstance(latest_weather_candidates.get("skipped_reasons"), dict) else {}
    action_counts = latest_weather_candidates.get("created_by_governor_action") if isinstance(latest_weather_candidates.get("created_by_governor_action"), dict) else {}
    weather_policy = latest_weather_candidates.get("learning_acceleration_policy") if isinstance(latest_weather_candidates.get("learning_acceleration_policy"), dict) else {}
    candidate_edge_effective = latest_weather_candidates.get("effective_minimum_edge_after_costs_pct")
    candidate_edge_base = latest_weather_candidates.get("base_minimum_edge_after_costs_pct")
    candidate_confidence_effective = latest_weather_candidates.get("effective_minimum_model_confidence_score")
    candidate_confidence_base = latest_weather_candidates.get("base_minimum_model_confidence_score")

    discovery = lane.get("weather_discovery") if isinstance(lane.get("weather_discovery"), dict) else {}
    discovery_time = discovery.get("timestamp_utc")
    discovery_age = _age_minutes(discovery_time, now)
    stale_discovery = discovery_age is None or discovery_age > 60.0
    ml_blocked = latest_created > 0 and not any(str(key).startswith("ACCEPT") for key in action_counts)
    if latest_created == 0:
        why = "Latest weather paper-candidate pass created 0 paper trades."
    elif ml_blocked:
        why = "Latest weather candidates were practice/shadow-only because accepted-paper gates did not pass."
    else:
        why = "Latest weather pass created paper-only practice trades."
    if skipped_reasons:
        top_skips = ", ".join(f"{key}: {value}" for key, value in sorted(skipped_reasons.items(), key=lambda item: str(item[0]))[:4])
        why = f"{why} Main blockers: {top_skips}."
    if stale_discovery:
        why = f"{why} Older discovery counts were stale and are not treated as current trade capacity."

    lane.update(
        {
            "latest_run_id": latest_weather.get("run_id") or lane.get("latest_run_id"),
            "latest_run_status": latest_weather.get("status") or ("CANDIDATE_SCAN_COMPLETED" if latest_weather_candidates.get("ok") is True else lane.get("latest_run_status")),
            "latest_run_timestamp_utc": latest_weather.get("completed_at_utc") or candidate_time,
            "latest_run_parsed": latest_markets_seen,
            "latest_run_trade_ready": latest_created,
            "latest_candidate_created_count": latest_created,
            "latest_candidate_governor_actions": action_counts,
            "latest_candidate_skipped_reasons": skipped_reasons,
            "latest_candidate_markets_seen": latest_markets_seen,
            "latest_candidate_orderbooks_checked": latest_weather_candidates.get("orderbooks_checked"),
            "latest_candidate_age_minutes": candidate_age,
            "latest_candidate_learning_acceleration_policy": weather_policy,
            "latest_candidate_effective_minimum_edge_after_costs_pct": candidate_edge_effective,
            "latest_candidate_base_minimum_edge_after_costs_pct": candidate_edge_base,
            "latest_candidate_effective_minimum_model_confidence_score": candidate_confidence_effective,
            "latest_candidate_base_minimum_model_confidence_score": candidate_confidence_base,
            "why_not_trading": why,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    )
    current_note = (
        "Prior weather discovery was stale; current paper-candidate scan created no accepted weather paper trades."
        if not any(str(key).startswith("ACCEPT") for key in action_counts)
        else "Prior weather discovery was stale; current paper-candidate scan created accepted paper-only weather trades."
    )
    if stale_discovery:
        lane["latest_discovery_trade_ready"] = latest_created
        lane["latest_discovery_parsed"] = latest_markets_seen
        lane["stale_discovery_suppressed"] = True
        expansion = lane.get("weather_expansion") if isinstance(lane.get("weather_expansion"), dict) else {}
        lane["weather_expansion"] = {
            **expansion,
            "active_trade_ready_city_count": 0,
            "active_trade_ready_cities": [],
            "current_trade_ready_note": current_note,
            "city_coverage_status": [],
            "covered_city_count": 0,
            "covered_cities": [],
            "live_order_allowed": False,
        }
    return lane


def _load_json_file(path: Path, warnings: list[str]) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"{path.name} could not be loaded: {exc}")
        return {}
    return payload if isinstance(payload, dict) else {}


def _timesfm_diagnostic_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    forecast_config = raw.get("forecast_config") if isinstance(raw.get("forecast_config"), dict) else {}
    metrics = raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {}
    leakage_checks = raw.get("leakage_checks") if isinstance(raw.get("leakage_checks"), dict) else {}
    status = str(raw.get("status") or ("diagnostic_ready" if raw else "not_generated"))
    artifact_exists = TIMESFM_DIAGNOSTIC_PATH.exists()
    payload = {
        "ok": bool(raw.get("ok")) if raw else False,
        "status": status,
        "model_family": raw.get("model_family") or "timesfm",
        "model_version": raw.get("model_version") or "timesfm-2.5",
        "generated_at_utc": raw.get("generated_at_utc"),
        "artifact_path": TIMESFM_DIAGNOSTIC_REPO_PATH,
        "artifact_exists": artifact_exists,
        "domains": raw.get("domains") if isinstance(raw.get("domains"), list) else [],
        "assets": raw.get("assets") if isinstance(raw.get("assets"), list) else [],
        "horizons_minutes": raw.get("horizons_minutes") if isinstance(raw.get("horizons_minutes"), list) else [],
        "forecast_config": {
            "quantiles_enabled": bool(forecast_config.get("quantiles_enabled")),
            "xreg_enabled": bool(forecast_config.get("xreg_enabled")),
            "walk_forward_only": forecast_config.get("walk_forward_only") is not False,
        },
        "metrics": {
            "brier": metrics.get("brier"),
            "ece": metrics.get("ece"),
            "accuracy": metrics.get("accuracy"),
            "coverage": metrics.get("coverage"),
            "market_baseline_brier": metrics.get("market_baseline_brier"),
            "no_ml_baseline_brier": metrics.get("no_ml_baseline_brier"),
        },
        "baselines": raw.get("baselines") if isinstance(raw.get("baselines"), list) else [],
        "segment_failures": raw.get("segment_failures") if isinstance(raw.get("segment_failures"), list) else [],
        "leakage_checks": {
            "random_split_used": bool(leakage_checks.get("random_split_used")),
            "future_labels_used": bool(leakage_checks.get("future_labels_used")),
            "moving_sources_used": bool(leakage_checks.get("moving_sources_used")),
        },
        "plain_english": raw.get("plain_english")
        or "TimesFM is exposed as diagnostic-only dashboard context and cannot authorize paper, STS, or live trading.",
        "next_action": raw.get("next_action") or TIMESFM_NEXT_ACTION,
        "sts_policy": {
            "status": "diagnostic_only_not_sts_authority",
            "allowed_use": "dashboard_visibility_and_future_shadow_feature_research_only",
            "next_gate": "source_backed_walk_forward_diagnostic_evidence_required_before_sts_advisory_use",
            **TIMESFM_SAFETY_FLAGS,
        },
        **TIMESFM_SAFETY_FLAGS,
    }
    if not raw:
        payload["plain_english"] = "TimesFM diagnostic artifact has not been generated yet; this is display-only and not validation credit."
    return payload


def _timesfm_sts_policy(timesfm_diagnostic: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "diagnostic_only_not_sts_authority",
        "timesfm_status": timesfm_diagnostic.get("status") or "not_generated",
        "timesfm_model_version": timesfm_diagnostic.get("model_version") or "timesfm-2.5",
        "allowed_use": "dashboard_visibility_and_future_shadow_feature_research_only",
        "next_gate": "source_backed_walk_forward_diagnostic_evidence_required_before_sts_advisory_use",
        "plain_english": "TimesFM may be reviewed on the dashboard, but STS weights, routing, recommendations, and activation gates remain unchanged.",
        **TIMESFM_SAFETY_FLAGS,
    }


def _mlx_diagnostic_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    runtime = raw.get("runtime") if isinstance(raw.get("runtime"), dict) else {}
    evidence = raw.get("evidence_chain") if isinstance(raw.get("evidence_chain"), dict) else {}
    artifact_exists = MLX_DIAGNOSTIC_PATH.exists()
    return {
        "ok": bool(raw.get("ok")) if raw else False,
        "status": raw.get("status") or ("diagnostic_runtime_ready" if raw else "not_generated"),
        "model_family": raw.get("model_family") or "mlx",
        "generated_at_utc": raw.get("generated_at_utc"),
        "artifact_path": MLX_DIAGNOSTIC_REPO_PATH,
        "artifact_exists": artifact_exists,
        "runtime": {
            "available": bool(runtime.get("available")),
            "mlx_importable": bool(runtime.get("mlx_importable")),
            "mlx_core_importable": bool(runtime.get("mlx_core_importable")),
            "mlx_version": runtime.get("mlx_version"),
            "machine": runtime.get("machine"),
            "platform": runtime.get("platform"),
            "backend_role": runtime.get("backend_role") or "local_apple_silicon_diagnostic_acceleration_only",
        },
        "evidence_chain": {
            "source_row_count": int(evidence.get("source_row_count") or 0),
            "source_unique_key_count": int(evidence.get("source_unique_key_count") or 0),
            "source_ready_for_validation": evidence.get("source_ready_for_validation") is True,
            "validation_row_count": int(evidence.get("validation_row_count") or 0),
            "validation_unique_key_count": int(evidence.get("validation_unique_key_count") or 0),
            "validation_rows_ready": evidence.get("validation_rows_ready") is True,
            "source_backed_outcome_count": int(evidence.get("source_backed_outcome_count") or 0),
            "source_backed_outcome_unique_key_count": int(evidence.get("source_backed_outcome_unique_key_count") or 0),
            "source_backed_outcomes_ready": evidence.get("source_backed_outcomes_ready") is True,
            "separated_review_row_count": int(evidence.get("separated_review_row_count") or 0),
            "separated_validation_ready": evidence.get("separated_validation_ready") is True,
            "evidence_chain_ready_for_mlx_challenger": evidence.get("evidence_chain_ready_for_mlx_challenger") is True,
        },
        "allowed_use": raw.get("allowed_use") if isinstance(raw.get("allowed_use"), list) else ["dashboard_visibility", "local_runtime_probe"],
        "forbidden_use": raw.get("forbidden_use") if isinstance(raw.get("forbidden_use"), list) else ["live_trading", "sts_authority", "validation_credit"],
        "next_gate": raw.get("next_gate") or "redesigned_validation_rows_and_source_backed_outcomes_required_before_mlx_challenger",
        "plain_english": raw.get("plain_english")
        or "MLX diagnostic artifact has not been generated yet; MLX cannot authorize trading or count as validation proof.",
        **MLX_SAFETY_FLAGS,
    }


def _crypto_settlement_oracle_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    rows = raw.get("rows") if isinstance(raw.get("rows"), list) else []
    summary = raw.get("summary") if isinstance(raw.get("summary"), dict) else {}
    power = raw.get("power_analysis") if isinstance(raw.get("power_analysis"), dict) else {}
    graduation = raw.get("graduation_gate") if isinstance(raw.get("graduation_gate"), dict) else {}
    residual_ml = raw.get("residual_ml_readiness") if isinstance(raw.get("residual_ml_readiness"), dict) else {}
    artifact_exists = CRYPTO_SETTLEMENT_ORACLE_PATH.exists()
    unsafe = (
        raw.get("live_order_allowed") is True
        or raw.get("live_trading_enabled") is True
        or raw.get("can_authorize_trade") is True
        or raw.get("can_authorize_live") is True
        or raw.get("sts_authority") is True
        or raw.get("counts_for_validation_credit") is True
    )
    sanitized_rows: list[dict[str, Any]] = []
    for item in rows[:25]:
        if not isinstance(item, dict):
            continue
        execution = item.get("execution") if isinstance(item.get("execution"), dict) else {}
        feed_quality = item.get("feed_quality") if isinstance(item.get("feed_quality"), dict) else {}
        sanitized_rows.append(
            {
                "asset": item.get("asset") or "CRYPTO",
                "market_ticker": item.get("market_ticker") or "unknown",
                "fair_yes_probability": item.get("fair_yes_probability"),
                "market_implied_probability": item.get("market_implied_probability"),
                "edge_after_costs_cents": item.get("edge_after_costs_cents"),
                "decision": item.get("decision") or "NO_TRADE_DIAGNOSTIC",
                "threshold_value": item.get("threshold_value"),
                "current_settlement_value": item.get("current_settlement_value"),
                "effective_threshold_value": item.get("effective_threshold_value"),
                "spread_cents": execution.get("spread_cents"),
                "depth_contracts": execution.get("depth_contracts"),
                "execution_status": execution.get("execution_status") or "blocked",
                "data_quality_status": feed_quality.get("data_quality_status") or "invalid_for_validation_credit",
                "blockers": item.get("blockers") if isinstance(item.get("blockers"), list) else [],
                **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
            }
        )
    status = raw.get("status") or ("diagnostic_ready" if raw else "not_generated")
    if unsafe:
        status = "unsafe_flags_detected"
    return {
        "ok": bool(raw.get("ok")) if raw else False,
        "status": status,
        "artifact_path": CRYPTO_SETTLEMENT_ORACLE_REPO_PATH,
        "artifact_exists": artifact_exists,
        "generated_at_utc": raw.get("generated_at_utc"),
        "summary": {
            "row_count": int(summary.get("row_count") or len(sanitized_rows)),
            "no_trade_count": int(summary.get("no_trade_count") or 0),
            "invalid_for_validation_credit_count": int(summary.get("invalid_for_validation_credit_count") or 0),
            "unsafe_row_count": int(summary.get("unsafe_row_count") or (1 if unsafe else 0)),
            "ready_for_forward_paper_review": summary.get("ready_for_forward_paper_review") is True,
        },
        "rows": sanitized_rows,
        "power_analysis": {
            "evaluated_rows": int(power.get("evaluated_rows") or 0),
            "effective_sample_size": int(power.get("effective_sample_size") or 0),
            "minimum_forward_samples_required": int(power.get("minimum_forward_samples_required") or 500),
            "ready_for_forward_paper_review": power.get("ready_for_forward_paper_review") is True,
            "blockers": power.get("blockers") if isinstance(power.get("blockers"), list) else ["diagnostic_artifact_missing_or_incomplete"],
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "residual_ml_readiness": {
            "status": residual_ml.get("status") or "blocked_until_forward_oracle_artifacts_and_source_backed_outcomes",
            "target": residual_ml.get("target") or "post_cost_trade_quality_not_raw_crypto_direction",
            "ready": residual_ml.get("ready") is True,
            "blockers": residual_ml.get("blockers") if isinstance(residual_ml.get("blockers"), list) else ["no_forward_paper_outcomes"],
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "graduation_gate": {
            "status": graduation.get("status") or "blocked",
            "required": graduation.get("required") if isinstance(graduation.get("required"), list) else [],
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "plain_english": raw.get("plain_english")
        or "Crypto Settlement Arbitrage Lab is waiting for diagnostic oracle output; fallback is safe and cannot authorize paper, STS, or live trading.",
        "next_action": raw.get("next_action") or "Run diagnostic-only settlement-oracle capture or fixture generation; keep all routing blocked.",
        **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
    }


def _crypto_settlement_oracle_readiness_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    replay = raw.get("replay_power_analysis") if isinstance(raw.get("replay_power_analysis"), dict) else {}
    residual = raw.get("residual_ml_readiness") if isinstance(raw.get("residual_ml_readiness"), dict) else {}
    graduation = raw.get("forward_paper_graduation_gate") if isinstance(raw.get("forward_paper_graduation_gate"), dict) else {}
    critical = raw.get("critical_path_blocker_handoff") if isinstance(raw.get("critical_path_blocker_handoff"), dict) else {}
    milestones = raw.get("milestones") if isinstance(raw.get("milestones"), dict) else {}
    unsafe = (
        raw.get("live_order_allowed") is True
        or raw.get("live_trading_enabled") is True
        or raw.get("can_authorize_trade") is True
        or raw.get("can_authorize_paper") is True
        or raw.get("can_authorize_live") is True
        or raw.get("sts_authority") is True
        or raw.get("counts_for_validation_credit") is True
        or raw.get("historical_replay_credit_allowed") is True
    )
    gates = graduation.get("gates") if isinstance(graduation.get("gates"), list) else []
    blocked_items = critical.get("blocked_items") if isinstance(critical.get("blocked_items"), list) else []
    return {
        "ok": bool(raw.get("ok")) and not unsafe if raw else False,
        "status": "unsafe_flags_detected" if unsafe else (raw.get("status") or "not_generated"),
        "artifact_path": CRYPTO_SETTLEMENT_ORACLE_READINESS_REPO_PATH,
        "artifact_exists": CRYPTO_SETTLEMENT_ORACLE_READINESS_PATH.exists(),
        "generated_at_utc": raw.get("generated_at_utc"),
        "milestones": milestones,
        "replay_power_analysis": {
            "status": replay.get("status") or "not_generated",
            "completion_pct": int(replay.get("completion_pct") or 0),
            "hypothesis_only": replay.get("hypothesis_only") is True,
            "historical_replay_credit_allowed": False,
            "live_readiness_credit_allowed": False,
            "sample_size": int(replay.get("sample_size") or 0),
            "effective_sample_size": int(replay.get("effective_sample_size") or 0),
            "minimum_forward_samples_required": int(replay.get("minimum_forward_samples_required") or 500),
            "baselines_required": replay.get("baselines_required") if isinstance(replay.get("baselines_required"), list) else [],
            "blockers": replay.get("blockers") if isinstance(replay.get("blockers"), list) else ["readiness_report_missing"],
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "residual_ml_readiness": {
            "status": residual.get("status") or "blocked_until_forward_paper_oracle_decisions_and_source_backed_outcomes",
            "completion_pct": int(residual.get("completion_pct") or 0),
            "target": residual.get("target") or "post_cost_trade_quality",
            "forbidden_targets": residual.get("forbidden_targets") if isinstance(residual.get("forbidden_targets"), list) else ["raw_crypto_direction"],
            "model_training_run": residual.get("model_training_run") is True,
            "feature_activation_allowed": residual.get("feature_activation_allowed") is True,
            "blockers": residual.get("blockers") if isinstance(residual.get("blockers"), list) else ["readiness_report_missing"],
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "forward_paper_graduation_gate": {
            "status": graduation.get("status") or "blocked",
            "completion_pct": int(graduation.get("completion_pct") or 0),
            "gate_count": int(graduation.get("gate_count") or len(gates)),
            "blocked_gate_count": int(graduation.get("blocked_gate_count") or len(gates)),
            "all_gates_blocked": graduation.get("all_gates_blocked") is True if graduation else True,
            "gates": gates,
            "blockers": graduation.get("blockers") if isinstance(graduation.get("blockers"), list) else ["readiness_report_missing"],
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "critical_path_blocker_handoff": {
            "status": critical.get("status") or "blocked",
            "completion_pct": int(critical.get("completion_pct") or 0),
            "production_grade_ml_status": critical.get("production_grade_ml_status") or "blocked",
            "blocked_items": blocked_items,
            "repair_v4_state": critical.get("repair_v4_state") if isinstance(critical.get("repair_v4_state"), dict) else {},
            **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
        },
        "plain_english": raw.get("plain_english") or "Settlement-oracle readiness report has not generated yet; replay, residual ML, forward-paper, STS, and live authority remain blocked.",
        "next_action": raw.get("next_action") or "Generate the local non-collection readiness report; do not promote from dashboard diagnostics.",
        **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
    }


def _kalshi_nonlive_runner_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    feasibility = raw.get("composition_feasibility") if isinstance(raw.get("composition_feasibility"), dict) else {}
    selector = raw.get("selector") if isinstance(raw.get("selector"), dict) else {}
    state = raw.get("state") if isinstance(raw.get("state"), dict) else {}
    future = raw.get("future_16dl") if isinstance(raw.get("future_16dl"), dict) else {}
    unsafe_flags = raw.get("unsafe_true_flags") if isinstance(raw.get("unsafe_true_flags"), list) else []
    unsafe = bool(unsafe_flags) or any(raw.get(flag) is True for flag in ("live_order_allowed", "live_trading_enabled", "can_authorize_trade", "can_authorize_paper", "can_authorize_live", "sts_authority"))
    return {
        "ok": bool(raw) and not unsafe,
        "status": "unsafe_flags_detected" if unsafe else (raw.get("status") or "not_generated"),
        "artifact_path": KALSHI_NONLIVE_RUNNER_SUMMARY_REPO_PATH,
        "artifact_exists": KALSHI_NONLIVE_RUNNER_SUMMARY_PATH.exists(),
        "milestone": raw.get("milestone") or "16DM",
        "candidate_name": raw.get("candidate_name") or "crypto_execution_value_band_guard_repair_v11",
        "unique_clean_row_count": int(raw.get("unique_clean_row_count") or 0),
        "asset_counts": raw.get("asset_counts") if isinstance(raw.get("asset_counts"), dict) else {},
        "dominant_asset": raw.get("dominant_asset") or feasibility.get("dominant_asset") or "unknown",
        "non_dominant_asset_rows": int(raw.get("non_dominant_asset_rows") or feasibility.get("non_dominant_asset_rows") or 0),
        "non_dominant_asset_rows_required": int(feasibility.get("non_dominant_asset_rows_required") or 15),
        "non_dominant_asset_shortfall": int(feasibility.get("non_dominant_asset_shortfall") or 0),
        "asset_composition_mathematically_possible": raw.get("asset_composition_mathematically_possible") is True,
        "selector_status": raw.get("selector_status") or selector.get("selector_status") or "not_run",
        "composition_reject_reason": selector.get("composition_reject_reason"),
        "source_exists": raw.get("source_exists") is True or state.get("source_exists") is True,
        "validation_rows_exist": raw.get("validation_rows_exist") is True or state.get("validation_rows_exist") is True,
        "outcomes_exist": raw.get("outcomes_exist") is True or state.get("outcomes_exist") is True,
        "next_blocker": raw.get("next_blocker") or "runner_summary_missing",
        "next_action": raw.get("next_action") or "Generate the local OpenClaw runner summary before running more collection.",
        "codex_review_required": raw.get("codex_review_required") is True,
        "future_16dl_target_clean_rows": int(future.get("target_clean_rows") or 64),
        "future_16dl_run_by_16dm": future.get("run_by_16dm") is True,
        "unsafe_true_flags": unsafe_flags,
        **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
    }


def _kalshi_copy_shadow_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    summary = raw.get("summary") if isinstance(raw.get("summary"), dict) else {}
    latency = raw.get("latency") if isinstance(raw.get("latency"), dict) else {}
    execution_quality = raw.get("execution_quality") if isinstance(raw.get("execution_quality"), dict) else {}
    risk_controls = raw.get("risk_controls") if isinstance(raw.get("risk_controls"), dict) else {}
    target_leader = raw.get("target_leader") if isinstance(raw.get("target_leader"), dict) else {}
    source_discovery = raw.get("source_discovery") if isinstance(raw.get("source_discovery"), dict) else {}
    gates = raw.get("readiness_gates") if isinstance(raw.get("readiness_gates"), list) else []
    leader_lanes = raw.get("leader_lanes") if isinstance(raw.get("leader_lanes"), list) else []
    signal_quality = raw.get("signal_quality") if isinstance(raw.get("signal_quality"), dict) else {}
    source_health = raw.get("source_health") if isinstance(raw.get("source_health"), dict) else {}
    unsafe_flags = raw.get("unsafe_true_flags") if isinstance(raw.get("unsafe_true_flags"), list) else []
    unsafe = bool(unsafe_flags) or any(
        raw.get(flag) is True
        for flag in (
            "live_order_allowed",
            "live_trading_enabled",
            "can_authorize_trade",
            "can_authorize_paper",
            "can_authorize_live",
            "auto_live_promotion_allowed",
            "write_capable_kalshi_endpoint_called",
            "sts_authority",
        )
    )
    fallback_gates = [
        {
            "gate_id": "exact_opt_in_source",
            "label": "Exact opt-in fill source",
            "status": "blocked",
            "detail": "Add a consenting leader fill source before copy-shadow evaluation can start.",
            "blocker": "no_exact_opt_in_fill_source",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        {
            "gate_id": "paper_only_wall",
            "label": "Paper-only wall",
            "status": "passed",
            "detail": "Dashboard copy-shadow setup cannot place live orders.",
            "blocker": None,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
    ]
    return {
        "ok": bool(raw) and not unsafe,
        "schema_version": raw.get("schema_version") or "copy_shadow_status_v1",
        "artifact_path": KALSHI_COPY_SHADOW_STATUS_REPO_PATH,
        "artifact_exists": KALSHI_COPY_SHADOW_STATUS_PATH.exists(),
        "generated_at_utc": raw.get("generated_at_utc"),
        "mode": "SHADOW_ONLY",
        "status": "unsafe_flags_detected" if unsafe else (raw.get("status") or "not_configured"),
        "shadow_bankroll_usd": _money(raw.get("shadow_bankroll_usd") or 100.0),
        "target_leader": {
            "leader_name": target_leader.get("leader_name") or "Foster McCoy",
            "leader_alias": target_leader.get("leader_alias") or "Foster",
            "leader_handle": target_leader.get("leader_handle"),
            "verification_status": target_leader.get("verification_status") or "public_identity_verified_source_unverified",
            "source_status": target_leader.get("source_status") or "blocked_no_exact_source",
            "evidence_url": target_leader.get("evidence_url"),
            "evidence_summary": target_leader.get("evidence_summary") or "Public identity is verified, but no copyable real-time exact-fill source is verified.",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "recommended_initial_live_order_usd": _money(raw.get("recommended_initial_live_order_usd") or 1.0),
        "max_recommended_initial_live_order_usd": _money(raw.get("max_recommended_initial_live_order_usd") or 5.0),
        "readiness_score": round(float(raw.get("readiness_score") or 0.0), 1),
        "summary": {
            "signals_seen": int(summary.get("signals_seen") or 0),
            "eligible_shadow_signals": int(summary.get("eligible_shadow_signals") or 0),
            "skipped_signals": int(summary.get("skipped_signals") or 0),
            "resolved_signals": int(summary.get("resolved_signals") or 0),
            "wins": int(summary.get("wins") or 0),
            "losses": int(summary.get("losses") or 0),
            "win_rate": summary.get("win_rate") if isinstance(summary.get("win_rate"), (int, float)) else None,
            "net_shadow_pnl_usd": _money(summary.get("net_shadow_pnl_usd")),
            "unresolved_signals": int(summary.get("unresolved_signals") or 0),
            "observed_days": float(summary.get("observed_days") or 0.0),
            "exact_opt_in_source_count": int(summary.get("exact_opt_in_source_count") or 0),
            "verified_exact_opt_in_source_count": int(summary.get("verified_exact_opt_in_source_count") or 0),
            "source_count": int(summary.get("source_count") or 0),
            "leader_lane_count": int(summary.get("leader_lane_count") or 0),
            "active_leader_lane_count": int(summary.get("active_leader_lane_count") or 0),
            "duplicate_signal_count": int(summary.get("duplicate_signal_count") or 0),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "source_discovery": {
            "artifact_path": KALSHI_COPY_SHADOW_SOURCE_DISCOVERY_REPO_PATH,
            "artifact_exists": KALSHI_COPY_SHADOW_SOURCE_DISCOVERY_PATH.exists(),
            "generated_at_utc": source_discovery.get("generated_at_utc"),
            "status": source_discovery.get("status") or "not_run",
            "public_identity_verified": source_discovery.get("public_identity_verified") is True,
            "authenticated_read_ok": source_discovery.get("authenticated_read_ok") is True,
            "authenticated_read_attempted": source_discovery.get("authenticated_read_attempted") is True,
            "copyable_exact_source_verified": source_discovery.get("copyable_exact_source_verified") is True,
            "blockers": source_discovery.get("blockers") if isinstance(source_discovery.get("blockers"), list) else [],
            "next_action": source_discovery.get("next_action") or "Run the Foster source-discovery receipt before enabling any source.",
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
        },
        "latency": {
            "p95_signal_latency_ms": latency.get("p95_signal_latency_ms") if isinstance(latency.get("p95_signal_latency_ms"), (int, float)) else None,
            "average_decision_latency_ms": latency.get("average_decision_latency_ms") if isinstance(latency.get("average_decision_latency_ms"), (int, float)) else None,
            "max_signal_latency_ms": float(latency.get("max_signal_latency_ms") or 1000.0),
            "near_instant_target_ms": float(latency.get("near_instant_target_ms") or 1000.0),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "execution_quality": {
            "average_price_drift_cents": execution_quality.get("average_price_drift_cents") if isinstance(execution_quality.get("average_price_drift_cents"), (int, float)) else None,
            "average_spread_cents": execution_quality.get("average_spread_cents") if isinstance(execution_quality.get("average_spread_cents"), (int, float)) else None,
            "max_price_drift_cents": float(execution_quality.get("max_price_drift_cents") or 2.0),
            "max_spread_cents": float(execution_quality.get("max_spread_cents") or 4.0),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "risk_controls": {
            "copy_size_mode": risk_controls.get("copy_size_mode") or "fixed_fraction_or_cap",
            "copy_fraction": risk_controls.get("copy_fraction") if isinstance(risk_controls.get("copy_fraction"), (int, float)) else 0.1,
            "max_shadow_order_usd": _money(risk_controls.get("max_shadow_order_usd") or 5.0),
            "max_shadow_open_exposure_usd": _money(risk_controls.get("max_shadow_open_exposure_usd") or 25.0),
            "kill_switch_required": True,
            "limit_orders_only": True,
            "market_orders_allowed": False,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "signal_quality": {
            "required_fields": signal_quality.get("required_fields")
            if isinstance(signal_quality.get("required_fields"), list)
            else [],
            "public_strategy_required_fields": signal_quality.get("public_strategy_required_fields")
            if isinstance(signal_quality.get("public_strategy_required_fields"), list)
            else [],
            "skip_reasons": signal_quality.get("skip_reasons")
            if isinstance(signal_quality.get("skip_reasons"), dict)
            else {},
            "recent_decisions": signal_quality.get("recent_decisions")
            if isinstance(signal_quality.get("recent_decisions"), list)
            else [],
            "duplicate_signal_count": int(signal_quality.get("duplicate_signal_count") or 0),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "source_health": {
            "foster_relay_verifier": source_health.get("foster_relay_verifier")
            if isinstance(source_health.get("foster_relay_verifier"), dict)
            else {},
            "caleb_public_signal_verifier": source_health.get("caleb_public_signal_verifier")
            if isinstance(source_health.get("caleb_public_signal_verifier"), dict)
            else {},
            "signal_log_validator": source_health.get("signal_log_validator")
            if isinstance(source_health.get("signal_log_validator"), dict)
            else {},
            "live_order_allowed": False,
            "live_trading_enabled": False,
            "write_capable_kalshi_endpoint_called": False,
            "auto_live_promotion_allowed": False,
        },
        "leader_lanes": [
            {
                **lane,
                "live_order_allowed": False,
                "live_trading_enabled": False,
                "can_authorize_trade": False,
                "can_authorize_paper": False,
                "can_authorize_live": False,
                "auto_live_promotion_allowed": False,
                "write_capable_kalshi_endpoint_called": False,
                "sts_authority": False,
            }
            for lane in leader_lanes
            if isinstance(lane, dict)
        ],
        "sources": raw.get("sources") if isinstance(raw.get("sources"), list) else [],
        "readiness_gates": gates if gates else fallback_gates,
        "next_action": raw.get("next_action") or "Run kalshi_copy_shadow.py --init-config, add an exact opt-in source, and keep the lane shadow-only until the gates pass.",
        "plain_english": raw.get("plain_english") or "Copy-leader shadow mode is not configured yet. The dashboard is ready to show signal quality, latency, and paper P&L once local copy-shadow logs exist.",
        "unsafe_true_flags": unsafe_flags,
        "write_capable_kalshi_endpoint_called": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "can_authorize_trade": False,
        "can_authorize_paper": False,
        "can_authorize_live": False,
        "auto_live_promotion_allowed": False,
        "sts_authority": False,
    }


def _kalshi_v12_source_bottleneck_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    bottleneck = raw.get("source_bottleneck") if isinstance(raw.get("source_bottleneck"), dict) else {}
    recommendation = raw.get("recommendation") if isinstance(raw.get("recommendation"), dict) else {}
    state = raw.get("state") if isinstance(raw.get("state"), dict) else {}
    rejection = raw.get("rejection_summary") if isinstance(raw.get("rejection_summary"), dict) else {}
    unsafe_flags = raw.get("unsafe_true_flags") if isinstance(raw.get("unsafe_true_flags"), list) else []
    unsafe = bool(unsafe_flags) or any(raw.get(flag) is True for flag in ("live_order_allowed", "live_trading_enabled", "can_authorize_trade", "can_authorize_paper", "can_authorize_live", "sts_authority"))
    minimum_deficits = bottleneck.get("minimum_asset_deficits") if isinstance(bottleneck.get("minimum_asset_deficits"), dict) else {}
    return {
        "ok": bool(raw) and not unsafe,
        "status": "unsafe_flags_detected" if unsafe else (raw.get("status") or "not_generated"),
        "artifact_path": KALSHI_V12_SOURCE_BOTTLENECK_AUDIT_REPO_PATH,
        "artifact_exists": KALSHI_V12_SOURCE_BOTTLENECK_AUDIT_PATH.exists(),
        "milestone": raw.get("milestone") or "16ET",
        "candidate_name": raw.get("candidate_name") or "crypto_asset_balanced_execution_value_band_guard_repair_v12",
        "unique_clean_row_count": int(bottleneck.get("unique_clean_row_count") or 0),
        "asset_counts": bottleneck.get("asset_counts") if isinstance(bottleneck.get("asset_counts"), dict) else {},
        "usable_asset_counts_after_v12_cap": bottleneck.get("usable_asset_counts_after_v12_cap") if isinstance(bottleneck.get("usable_asset_counts_after_v12_cap"), dict) else {},
        "composition_usable_row_count": int(bottleneck.get("composition_usable_row_count") or 0),
        "composition_usable_shortfall": int(bottleneck.get("composition_usable_shortfall") or 0),
        "raw_clean_row_shortfall": int(bottleneck.get("raw_clean_row_shortfall") or 0),
        "minimum_asset_deficits": minimum_deficits,
        "non_doge_rows": int(bottleneck.get("non_doge_rows") or 0),
        "non_doge_row_shortfall": int(bottleneck.get("non_doge_row_shortfall") or 0),
        "source_finalization_possible_now": bottleneck.get("source_finalization_possible_now") is True,
        "selector_status": bottleneck.get("selector_status") or "not_run",
        "selector_reject_reason": bottleneck.get("selector_reject_reason"),
        "recommended_next_action": recommendation.get("recommended_next_action") or "blocked_needs_more_evidence",
        "next_action": recommendation.get("next_safe_action") or raw.get("next_blocker") or "Generate the 16ET bottleneck audit before any additional v12 collection.",
        "pivot_rule_after_16eu": recommendation.get("pivot_rule_after_16EU") or recommendation.get("pivot_rule_after_16eu"),
        "source_exists": state.get("source_jsonl_exists") is True,
        "validation_rows_exist": state.get("validation_rows_exist") is True,
        "outcomes_exist": state.get("outcomes_exist") is True,
        "aggregate_rejected_reasons": rejection.get("aggregate_rejected_reasons") if isinstance(rejection.get("aggregate_rejected_reasons"), dict) else {},
        "per_asset_rejection_reasons_from_examples": rejection.get("per_asset_rejection_reasons_from_examples") if isinstance(rejection.get("per_asset_rejection_reasons_from_examples"), dict) else {},
        "unsafe_true_flags": unsafe_flags,
        **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
    }


def _kalshi_v13_preregistration_snapshot(source: dict[str, Any] | None) -> dict[str, Any]:
    raw = source if isinstance(source, dict) else {}
    evidence = raw.get("v12_evidence") if isinstance(raw.get("v12_evidence"), dict) else {}
    plan = raw.get("v13_preregistered_plan") if isinstance(raw.get("v13_preregistered_plan"), dict) else {}
    asset_contract = plan.get("source_asset_contract") if isinstance(plan.get("source_asset_contract"), dict) else {}
    paths = plan.get("future_paths_if_separately_approved") if isinstance(plan.get("future_paths_if_separately_approved"), dict) else {}
    unsafe_flags = raw.get("unsafe_true_flags") if isinstance(raw.get("unsafe_true_flags"), list) else []
    unsafe = bool(unsafe_flags) or any(raw.get(flag) is True for flag in ("live_order_allowed", "live_trading_enabled", "can_authorize_trade", "can_authorize_paper", "can_authorize_live", "sts_authority"))
    return {
        "ok": bool(raw) and not unsafe,
        "status": "unsafe_flags_detected" if unsafe else (raw.get("status") or "not_generated"),
        "artifact_path": KALSHI_V13_PREREGISTRATION_PLAN_REPO_PATH,
        "artifact_exists": KALSHI_V13_PREREGISTRATION_PLAN_PATH.exists(),
        "milestone": raw.get("milestone") or "16EV",
        "candidate_name": raw.get("candidate_name") or "crypto_asset_balanced_execution_value_band_guard_repair_v13",
        "v12_unique_clean_row_count": int(evidence.get("unique_clean_row_count") or 0),
        "v12_asset_counts": evidence.get("asset_counts") if isinstance(evidence.get("asset_counts"), dict) else {},
        "v12_composition_usable_row_count": int(evidence.get("composition_usable_row_count") or 0),
        "v12_composition_usable_shortfall": int(evidence.get("composition_usable_shortfall") or 0),
        "v12_minimum_asset_deficits": evidence.get("minimum_asset_deficits") if isinstance(evidence.get("minimum_asset_deficits"), dict) else {},
        "v12_recommended_next_action": evidence.get("recommended_next_action") or "blocked_needs_more_evidence",
        "v12_pivot_to_v13_now": evidence.get("pivot_to_v13_now") is True,
        "required_source_rows": int(plan.get("required_source_rows") or 30),
        "allowed_assets": plan.get("allowed_assets") if isinstance(plan.get("allowed_assets"), list) else [],
        "minimum_asset_rows": asset_contract.get("minimum_asset_rows") if isinstance(asset_contract.get("minimum_asset_rows"), dict) else {},
        "maximum_asset_rows": asset_contract.get("maximum_asset_rows") if isinstance(asset_contract.get("maximum_asset_rows"), dict) else {},
        "target_mix_rows": asset_contract.get("target_mix_rows") if isinstance(asset_contract.get("target_mix_rows"), dict) else {},
        "minimum_non_doge_rows": int(asset_contract.get("minimum_non_doge_rows") or 0),
        "doge_saturation_cap_rows": int(asset_contract.get("doge_saturation_cap_rows") or 0),
        "future_source_jsonl": paths.get("source_jsonl"),
        "future_checkpoint_path": paths.get("checkpoint_path"),
        "next_approval_text": raw.get("next_approval_text") or "16EW v13 read-only source collection requires separate explicit approval.",
        "next_blocker": raw.get("next_blocker") or "16EV plan missing; no collection authorized.",
        "unsafe_true_flags": unsafe_flags,
        **CRYPTO_SETTLEMENT_ORACLE_SAFETY_FLAGS,
    }


def _lab_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _crypto_asset_from_market(market: dict[str, Any]) -> str:
    text = " ".join(str(market.get(key) or "") for key in ("market_ticker", "event_ticker", "title")).upper()
    for asset in ("BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "LTC", "BCH"):
        if asset in text:
            return asset
    return "CRYPTO"


def _crypto_persistence_lab_snapshot(markov_microstructure: dict[str, Any] | None, journal_review: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = markov_microstructure if isinstance(markov_microstructure, dict) else {}
    journal = journal_review if isinstance(journal_review, dict) else {}
    raw_markets = raw.get("markets") if isinstance(raw.get("markets"), list) else []
    crypto_markets = [market for market in raw_markets if isinstance(market, dict) and str(market.get("category") or "").lower() == "crypto"]
    rows: list[dict[str, Any]] = []
    for market in crypto_markets[:25]:
        sample = market.get("sample") if isinstance(market.get("sample"), dict) else {}
        execution = market.get("execution") if isinstance(market.get("execution"), dict) else {}
        article = market.get("article_hypothesis") if isinstance(market.get("article_hypothesis"), dict) else {}
        persistence_probability = _lab_number(market.get("persistence_probability"))
        if persistence_probability is None:
            persistence_probability = _lab_number(market.get("calibrated_probability"))
        market_probability = _lab_number(market.get("market_implied_probability"))
        if market_probability is None:
            market_probability = _lab_number(market.get("market_price") or market.get("current_yes_price"))
        raw_edge = _lab_number(market.get("raw_edge_pct"))
        if raw_edge is None:
            raw_edge = _lab_number(market.get("edge_vs_market_pct"))
        edge_after_costs = _lab_number(market.get("edge_after_costs_pct"))
        if edge_after_costs is None:
            edge_after_costs = _lab_number(article.get("edge_after_costs_pct"))
        min_edge = _lab_number(market.get("min_edge_required_pct")) or _lab_number(article.get("min_edge_required_pct")) or 5.0
        current_transitions = int(_lab_number(sample.get("current_row_transitions")) or 0)
        confidence = _lab_number(market.get("confidence_score")) or 0.0
        threshold_status = str(market.get("threshold_calibration_status") or article.get("threshold_calibration_status") or "not_calibrated")
        warnings = market.get("warnings") if isinstance(market.get("warnings"), list) else []
        blocker = "research_only_not_sts_authority"
        if current_transitions < 30:
            blocker = "low_transition_sample_current_bucket"
        elif confidence < 7.0:
            blocker = "confidence_below_review_threshold"
        elif edge_after_costs is None or edge_after_costs < min_edge:
            blocker = "edge_after_costs_below_minimum"
        elif not threshold_status.startswith("above_article_threshold"):
            blocker = "article_threshold_not_met"
        rows.append(
            {
                "asset": _crypto_asset_from_market(market),
                "market_ticker": market.get("market_ticker"),
                "persistence_probability": persistence_probability,
                "market_implied_probability": market_probability,
                "raw_edge_pct": raw_edge,
                "edge_after_costs_pct": edge_after_costs,
                "min_edge_required_pct": min_edge,
                "spread_cents": execution.get("estimated_yes_spread_cents"),
                "depth_contracts": execution.get("depth_contracts"),
                "transition_sample_quality": "usable" if current_transitions >= 30 else "low_sample",
                "current_row_transitions": current_transitions,
                "confidence_score": confidence,
                "threshold_calibration_status": threshold_status,
                "calibration_warning": ", ".join(str(item) for item in warnings[:3]) or "diagnostic_only",
                "blocker": blocker,
                "routing_label": market.get("routing_label") or "OBSERVE_ONLY",
                "kelly_diagnostic_only": market.get("kelly_diagnostic_only") if isinstance(market.get("kelly_diagnostic_only"), dict) else {},
                **CRYPTO_PERSISTENCE_LAB_SAFETY_FLAGS,
            }
        )
    watchlist_count = sum(1 for row in rows if row["blocker"] == "research_only_not_sts_authority")
    status = "diagnostic_ready" if rows else "not_generated"
    return {
        "ok": bool(raw.get("ok")) if raw else False,
        "status": status,
        "artifact_exists": bool(raw),
        "artifact_path": "work/scripts/kalshi/logs/markov_microstructure_latest.json",
        "journal_review_artifact_path": CRYPTO_PERSISTENCE_JOURNAL_REVIEW_REPO_PATH,
        "journal_review_artifact_exists": CRYPTO_PERSISTENCE_JOURNAL_REVIEW_PATH.exists(),
        "generated_at_utc": raw.get("generated_at_utc"),
        "article_source_url": "https://x.com/0xRicker/status/2057840731826405747",
        "accepted_ideas": ["markov_persistence_diagnostics", "edge_after_costs", "paper_journal_review"],
        "rejected_ideas": ["live_bot_execution", "autonomous_llm_rule_rewrites", "kelly_execution_sizing", "unverified_profit_claims_as_evidence"],
        "plain_english": (
            "Crypto Persistence Lab is a research-only view of Markov persistence versus Kalshi market prices. "
            "It can veto or slow weak ideas, but cannot authorize STS, paper, or live trading."
            if rows
            else "Crypto Persistence Lab is waiting for Markov microstructure output; fallback remains diagnostic-only."
        ),
        "next_action": "Use edge-after-costs and transition-sample quality to target future source-backed crypto rows; do not promote without forward-paper uplift.",
        "summary": {
            "crypto_market_count": len(rows),
            "watchlist_count": watchlist_count,
            "low_sample_count": sum(1 for row in rows if row["transition_sample_quality"] == "low_sample"),
            "blocked_count": len(rows) - watchlist_count,
            **CRYPTO_PERSISTENCE_LAB_SAFETY_FLAGS,
        },
        "journal_review": {
            "status": journal.get("status") or "not_generated",
            "generated_at_utc": journal.get("generated_at_utc"),
            "recommended_action": journal.get("recommended_action") or "generate_read_only_journal_review",
            "threshold_proposals": journal.get("threshold_proposals") if isinstance(journal.get("threshold_proposals"), list) else [],
            "plain_english": journal.get("plain_english") or "No read-only persistence journal review has been generated yet.",
            **CRYPTO_PERSISTENCE_LAB_SAFETY_FLAGS,
        },
        "rows": rows,
        "sts_policy": {
            "status": "diagnostic_only_not_sts_authority",
            "next_gate": "repeated_forward_paper_uplift_required_before_any_sts_use",
            "plain_english": "Persistence diagnostics may be reviewed on the dashboard; STS routing remains unchanged.",
            **CRYPTO_PERSISTENCE_LAB_SAFETY_FLAGS,
        },
        **CRYPTO_PERSISTENCE_LAB_SAFETY_FLAGS,
    }


def _kalshi_artifact_path(path: str) -> Path:
    if path.startswith(REPO_KALSHI_PREFIX):
        return KALSHI_SCRIPT_ROOT / path[len(REPO_KALSHI_PREFIX) :]
    return KALSHI_SCRIPT_ROOT / path


def _load_kalshi_artifact(path: str, warnings: list[str]) -> dict[str, Any]:
    return _load_json_file(_kalshi_artifact_path(path), warnings)


def _artifact_link(path: str) -> dict[str, Any]:
    artifact = _kalshi_artifact_path(path)
    return {"path": path, "exists": artifact.exists()}


def _first_existing_value(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _market_family_control_rows(
    *,
    breadth_audit: dict[str, Any],
    multi_market: dict[str, Any],
    direct_capture: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    breadth_families = breadth_audit.get("market_family_status") if isinstance(breadth_audit.get("market_family_status"), dict) else {}
    readiness_families = multi_market.get("market_families") if isinstance(multi_market.get("market_families"), dict) else {}
    direct_by_category = direct_capture.get("direct_by_category") if isinstance(direct_capture.get("direct_by_category"), dict) else {}
    labeled_by_category = direct_capture.get("labeled_by_category") if isinstance(direct_capture.get("labeled_by_category"), dict) else {}
    rows: dict[str, dict[str, Any]] = {}
    for family in MARKET_FAMILY_ORDER:
        breadth = breadth_families.get(family) if isinstance(breadth_families.get(family), dict) else {}
        readiness = readiness_families.get(family) if isinstance(readiness_families.get(family), dict) else {}
        blockers = breadth.get("blockers") if isinstance(breadth.get("blockers"), list) else readiness.get("known_blockers") if isinstance(readiness.get("known_blockers"), list) else []
        rows[family] = {
            "tracking_status": breadth.get("tracking_status") or readiness.get("diagnostic_research_status") or "unknown",
            "rows": _first_existing_value(breadth.get("rows"), readiness.get("broad_direct_snapshot_decision_rows"), 0),
            "labels": _first_existing_value(breadth.get("labels"), readiness.get("broad_direct_snapshot_labeled_rows"), 0),
            "direct_capture_rows": _first_existing_value(breadth.get("direct_capture_rows"), direct_by_category.get(family), 0),
            "labeled_direct_capture_rows": _first_existing_value(breadth.get("labeled_direct_capture_rows"), labeled_by_category.get(family), 0),
            "feature_coverage": readiness.get("feature_coverage") if isinstance(readiness.get("feature_coverage"), dict) else {},
            "feature_coverage_summary": breadth.get("feature_coverage_summary") or "see feature_coverage",
            "diagnostic_research_status": readiness.get("diagnostic_research_status") or "unknown",
            "outcome_resolution_status": breadth.get("outcome_resolution_status") or "unknown",
            "next_safe_action": readiness.get("next_safe_action") or "not specified",
            "blockers": blockers,
            "risk_of_neglect": breadth.get("risk_of_neglect") or "unknown",
            "risk_of_overfocus": breadth.get("risk_of_overfocus") or None,
            "recent_row_growth_available": bool(breadth.get("recent_row_growth_available")),
        }
    return rows


def _latest_snapshot_records(multi_market: dict[str, Any], snapshot_gate: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    source_verification = multi_market.get("source_verification") if isinstance(multi_market.get("source_verification"), dict) else {}
    for key, value in sorted(source_verification.items()):
        if key.endswith("_snapshot") and isinstance(value, dict):
            path = value.get("path")
            records.append(
                {
                    "snapshot_id": key,
                    "path": path,
                    "exists": _kalshi_artifact_path(str(path)).exists() if isinstance(path, str) else False,
                    "rows": value.get("rows"),
                    "sha256": value.get("sha256"),
                    "decision": value.get("decision"),
                    "source_artifact": "work/scripts/kalshi/kalshi_multi_market_readiness_matrix_v1.json",
                }
            )
    selected = snapshot_gate.get("selected_snapshot") if isinstance(snapshot_gate.get("selected_snapshot"), dict) else {}
    if selected:
        path = selected.get("path")
        records.append(
            {
                "snapshot_id": "selected_discovery_snapshot",
                "path": path,
                "exists": _kalshi_artifact_path(str(path)).exists() if isinstance(path, str) else False,
                "raw_checksums_passed": selected.get("raw_checksums_passed"),
                "derived_checksums_passed": selected.get("derived_checksums_passed"),
                "source_paths_snapshot_local": selected.get("source_paths_snapshot_local"),
                "source_artifact": "work/scripts/kalshi/snapshot_to_research_gate_v1.json",
            }
        )
    return records


def _kalshi_control_surface_snapshot(*, sts_readiness_roadmap: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    next_step = _load_kalshi_artifact("work/scripts/kalshi/next_validated_research_step_v1.json", warnings)
    evidence_lock = _load_kalshi_artifact("work/scripts/kalshi/current_track_evidence_lock_v1.json", warnings)
    sprint_execution = _load_kalshi_artifact("work/scripts/kalshi/sprint_handoff_execution_v1.json", warnings)
    source_inventory = _load_kalshi_artifact("work/scripts/kalshi/sports_source_candidate_inventory_v1.json", warnings)
    multi_market = _load_kalshi_artifact("work/scripts/kalshi/kalshi_multi_market_readiness_matrix_v1.json", warnings)
    direct_capture = _load_kalshi_artifact("work/scripts/kalshi/direct_capture_quality_report_v1.json", warnings)
    observability = _load_kalshi_artifact("work/scripts/kalshi/kalshi_observability_report_v1.json", warnings)
    breadth_audit = _load_kalshi_artifact("work/scripts/kalshi/market_breadth_and_safety_audit_v1.json", warnings)
    snapshot_gate = _load_kalshi_artifact("work/scripts/kalshi/snapshot_to_research_gate_v1.json", warnings)
    category_handoff = _load_kalshi_artifact("work/scripts/kalshi/category_replay_readiness_handoff_v1.json", warnings)
    holdout_handoff = _load_kalshi_artifact("work/scripts/kalshi/holdout_replay_readiness_handoff_v1.json", warnings)

    no_live = next_step.get("no_live_validator") if isinstance(next_step.get("no_live_validator"), dict) else {}
    no_live_output = no_live.get("raw_output") if isinstance(no_live.get("raw_output"), dict) else multi_market.get("no_live_validator") if isinstance(multi_market.get("no_live_validator"), dict) else {}
    source_summary = source_inventory.get("candidate_summary") if isinstance(source_inventory.get("candidate_summary"), dict) else {}
    before_after = next_step.get("before_after_metrics") if isinstance(next_step.get("before_after_metrics"), dict) else {}
    expected_source_exists = _kalshi_artifact_path(APPROVED_SPORTS_SOURCE_PATH).exists()
    likely_candidate_count = int(source_summary.get("likely_acceptable_candidate_count") or 0)
    approved_source_count = int(before_after.get("approved_sports_source_paths_after") or 0)
    source_gate_blocked = approved_source_count != 1 or likely_candidate_count != 1 or not expected_source_exists
    active_track = str(next_step.get("active_track") or evidence_lock.get("active_track") or "sports")
    execution_result = str(next_step.get("execution_result") or sprint_execution.get("result") or "blocked_missing_approved_sports_source")

    paper_roadmap = sts_readiness_roadmap.get("paper_trading") if isinstance(sts_readiness_roadmap.get("paper_trading"), dict) else {}
    live_roadmap = sts_readiness_roadmap.get("live_trading") if isinstance(sts_readiness_roadmap.get("live_trading"), dict) else {}
    stale_or_missing = []
    if not expected_source_exists:
        stale_or_missing.append(f"{APPROVED_SPORTS_SOURCE_PATH} is missing")
    if likely_candidate_count == 0:
        stale_or_missing.append("sports source inventory found zero likely acceptable local JSONL candidates")
    if category_handoff.get("snapshot_state", {}).get("snapshot_exists") is not True if isinstance(category_handoff.get("snapshot_state"), dict) else True:
        stale_or_missing.append("current category evidence snapshot is missing")
    if holdout_handoff.get("holdout_snapshot_exists") is not True:
        stale_or_missing.append("holdout snapshot is missing")
    if breadth_audit.get("overall_status") == "audit_pass_with_monitoring_gap":
        stale_or_missing.append("recent row-growth deltas are unavailable in latest breadth artifacts")

    status = "do_not_proceed" if source_gate_blocked else "ready_for_source_schema_verification"
    current_blocker = "sports_source_gate_missing_exact_approved_repo_root_jsonl" if source_gate_blocked else "none"
    exact_next_human_action = (
        "Approve exactly one repo-root local sports JSONL source path, or supply the file first. "
        "Do not advance Action 2 or Action 3 until that path is verified."
        if source_gate_blocked
        else "Run read-only schema verification for the approved sports source path."
    )
    artifact_paths = [
        "work/scripts/kalshi/NEXT_VALIDATED_RESEARCH_STEP.md",
        "work/scripts/kalshi/next_validated_research_step_v1.json",
        "work/scripts/kalshi/CURRENT_TRACK_EVIDENCE_LOCK.md",
        "work/scripts/kalshi/current_track_evidence_lock_v1.json",
        "work/scripts/kalshi/SPRINT_HANDOFF_EXECUTION.md",
        "work/scripts/kalshi/sprint_handoff_execution_v1.json",
        "work/scripts/kalshi/SPORTS_SOURCE_CANDIDATE_INVENTORY.md",
        "work/scripts/kalshi/sports_source_candidate_inventory_v1.json",
        "work/scripts/kalshi/MARKET_BREADTH_AND_SAFETY_AUDIT.md",
        "work/scripts/kalshi/market_breadth_and_safety_audit_v1.json",
        "work/scripts/kalshi/kalshi_multi_market_readiness_matrix_v1.json",
        "work/scripts/kalshi/direct_capture_quality_report_v1.json",
        "work/scripts/kalshi/kalshi_observability_report_v1.json",
        "work/scripts/kalshi/snapshot_to_research_gate_v1.json",
        "work/scripts/kalshi/category_replay_readiness_handoff_v1.json",
        "work/scripts/kalshi/holdout_replay_readiness_handoff_v1.json",
    ]
    return {
        "status": status,
        "tone": "bad" if source_gate_blocked else "warn",
        "active_track": active_track,
        "current_blocker": current_blocker,
        "source_gate_status": "blocked_missing_approved_sports_source" if source_gate_blocked else "approved_source_ready_for_schema_gate",
        "exact_next_human_action_required": exact_next_human_action,
        "queued_prompt_risk_warning": "Action 2 and Action 3 remain dependency-blocked by missing sports source approval." if source_gate_blocked else "Source approval exists; keep future steps read-only until schema gate passes.",
        "safe_next_action": (next_step.get("next_prompt_recommendation") or {}).get("title") if isinstance(next_step.get("next_prompt_recommendation"), dict) else "Kalshi Exact Sports Source Path Intake Gate",
        "goal_mode": {
            "appropriate": False,
            "reason": "Goal Mode is not appropriate while source gates or approval gates are blocking.",
        },
        "no_live_status": {
            "ok": no_live_output.get("ok") is True,
            "mode": no_live_output.get("mode") or READ_ONLY_MODE,
            "live_trading_enabled": no_live_output.get("live_trading_enabled") is True,
            "live_order_allowed": no_live_output.get("live_order_allowed") is True,
            "critical_failures": no_live_output.get("critical_failures") if isinstance(no_live_output.get("critical_failures"), list) else [],
            "warnings": no_live_output.get("warnings") if isinstance(no_live_output.get("warnings"), list) else [],
        },
        "sports_source_gate": {
            "status": "blocked_missing_approved_source" if source_gate_blocked else "approved_source_present",
            "approved_source_count": approved_source_count,
            "required_approved_source_count": 1,
            "expected_path": APPROVED_SPORTS_SOURCE_PATH,
            "expected_path_exists": expected_source_exists,
            "likely_acceptable_candidate_count": likely_candidate_count,
            "source_approved_or_used": source_inventory.get("source_approved_or_used") is True,
            "recommended_candidate_path": source_inventory.get("recommended_candidate_path"),
            "candidate_inventory_path": "work/scripts/kalshi/sports_source_candidate_inventory_v1.json",
            "do_not_proceed": source_gate_blocked,
        },
        "dependent_actions": [
            {
                "action": "Action 2 schema verification",
                "status": "dependency_blocked" if source_gate_blocked else "ready_after_source_approval",
                "blocker": "missing exact approved repo-root local sports JSONL source path" if source_gate_blocked else None,
            },
            {
                "action": "Action 3 bounded sports no-STS smoke",
                "status": "dependency_blocked" if source_gate_blocked else "blocked_until_schema_gate_and_explicit_smoke_approval",
                "blocker": "missing source approval and schema verification" if source_gate_blocked else "bounded smoke approval still required",
            },
        ],
        "market_family_readiness": _market_family_control_rows(
            breadth_audit=breadth_audit,
            multi_market=multi_market,
            direct_capture=direct_capture,
        ),
        "latest_frozen_snapshots": _latest_snapshot_records(multi_market, snapshot_gate),
        "diagnostic_replay_holdout_status": {
            "snapshot_gate_decision": snapshot_gate.get("decision"),
            "snapshot_gate_replay_allowed": snapshot_gate.get("replay_or_evaluation_allowed") is True,
            "selected_signal_family": snapshot_gate.get("selected_signal_family"),
            "category_replay_readiness_status": category_handoff.get("replay_readiness_status"),
            "category_snapshot_exists": (category_handoff.get("snapshot_state") or {}).get("snapshot_exists") if isinstance(category_handoff.get("snapshot_state"), dict) else False,
            "holdout_replay_readiness_status": holdout_handoff.get("holdout_replay_readiness_status"),
            "holdout_replay_ready": holdout_handoff.get("holdout_replay_ready") is True,
            "holdout_snapshot_exists": holdout_handoff.get("holdout_snapshot_exists") is True,
            "execution_result": execution_result,
        },
        "sts_readiness_status": {
            "paper_stage": paper_roadmap.get("stage") or "blocked",
            "paper_stage_label": paper_roadmap.get("stage_label") or "Blocked",
            "paper_readiness_score": paper_roadmap.get("readiness_score"),
            "can_sts_direct_paper": paper_roadmap.get("can_sts_direct_paper") is True,
            "live_stage": live_roadmap.get("stage") or "not_live_ready",
            "live_stage_label": live_roadmap.get("stage_label") or "Not live-ready",
            "can_trade_live": live_roadmap.get("can_trade_live") is True,
            "manual_review_required": live_roadmap.get("manual_review_required") is not False,
            "sts_logic_changed": False,
            "sts_recommendation_generated_or_applied": False,
        },
        "non_crypto_tracking": {
            "preserved": (multi_market.get("safety_flags") or {}).get("market_category_tracking_preserved") is True if isinstance(multi_market.get("safety_flags"), dict) else True,
            "tracking_preservation": (multi_market.get("operational_issues") or {}).get("tracking_preservation") if isinstance(multi_market.get("operational_issues"), dict) else None,
            "observability_overall_state": observability.get("overall_state"),
        },
        "forbidden_actions": [
            "Do not modify STS logic or weights.",
            "Do not generate or apply STS recommendations.",
            "Do not train ML models.",
            "Do not activate signals or filters.",
            "Do not run replay/evaluation.",
            "Do not run live trading or change live permissions.",
            "Do not call write-capable Kalshi endpoints.",
            "Do not edit cron JSON.",
            "Do not use pnpm openclaw cron edit.",
            "Do not run broad collection loops.",
            "Do not treat live/moving logs as research evidence.",
            "Do not narrow market tracking.",
        ],
        "stale_or_missing_artifact_warnings": stale_or_missing,
        "artifact_links": [_artifact_link(path) for path in artifact_paths],
        "dashboard_refresh_guard": {
            "sentinel_behavior_changed": False,
            "dashboard_refresh_run_by_this_prompt": False,
            "status": "not_touched",
            "reason": "This control-surface payload is read-only display state; refresh guard behavior remains owned by the Gateway sentinel path.",
        },
        "live_order_allowed": False,
        "auto_apply_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _supreme_trading_strategy_snapshot(sts: dict[str, Any]) -> dict[str, Any]:
    if not sts:
        return fallback_artifact("logs/sts/supreme_trading_strategy.json is missing")
    if not isinstance(sts.get("strategy_weights"), list):
        sts = {**sts, "strategy_weights": []}
    if not isinstance(sts.get("top_rationales"), list):
        sts = {**sts, "top_rationales": []}
    return {
        **sts,
        "ok": bool(sts.get("ok")),
        "mode": "PAPER_ONLY",
        "status": sts.get("status") or "blocked",
        "confidence_score": sts.get("confidence_score", 0.0),
        "current_regime": sts.get("current_regime") if isinstance(sts.get("current_regime"), dict) else {"label": "unknown_regime", "confidence_score": 0.0, "drivers": [], **live_false()},
        "objective_scores": sts.get("objective_scores") if isinstance(sts.get("objective_scores"), dict) else {},
        "risk": sts.get("risk") if isinstance(sts.get("risk"), dict) else {"primary_blocker": "sts_artifact_malformed", **live_false()},
        "performance": sts.get("performance") if isinstance(sts.get("performance"), dict) else {},
        "learning": sts.get("learning") if isinstance(sts.get("learning"), dict) else {},
        "experiments": sts.get("experiments") if isinstance(sts.get("experiments"), dict) else {},
        "model_health": sts.get("model_health") if isinstance(sts.get("model_health"), dict) else {},
        "data_health": sts.get("data_health") if isinstance(sts.get("data_health"), dict) else {},
        "next_action": sts.get("next_action") or "Run kalshi_sts_read_model.py.",
        "strategy_weights": sts.get("strategy_weights") if isinstance(sts.get("strategy_weights"), list) else [],
        "top_rationales": sts.get("top_rationales") if isinstance(sts.get("top_rationales"), list) else [],
        **live_false(),
    }



STS_DIRECTED_PAPER_ROUTES = {"STS_TINY_FORWARD_PAPER", "STS_ACCEPT_FORWARD_PAPER", "STS_FORWARD_PAPER", "STS_PAPER_ROUTE"}


def _sts_live_flag_violation(sts: dict[str, Any]) -> bool:
    return sts.get("live_order_allowed") is True or sts.get("auto_live_promotion_allowed") is True


def _sts_route(decision: dict[str, Any]) -> str:
    annotation = decision.get("supreme_trading_strategy")
    if not isinstance(annotation, dict):
        return ""
    return str(annotation.get("route") or "").upper()


def _is_sts_directed_paper(decision: dict[str, Any]) -> bool:
    return _sts_route(decision) in STS_DIRECTED_PAPER_ROUTES


def _realized_pnl_value(decision: dict[str, Any], outcome: dict[str, Any] | None) -> float | None:
    sources = []
    if isinstance(outcome, dict):
        sources.append(outcome)
    sources.append(decision)
    for source in sources:
        for key in ("paper_pnl_usd", "realized_paper_pnl_usd"):
            parsed = _countdown_number(source.get(key))
            if parsed is not None:
                return parsed
    return None


def _sts_domain_stance(row: dict[str, Any]) -> str:
    rows = int(_countdown_number(row.get("rows")) or 0)
    if rows < 30:
        return "insufficient_data"
    candidate_brier = _countdown_number(row.get("candidate_brier"))
    market_brier = _countdown_number(row.get("market_brier"))
    pnl = _countdown_number(row.get("paper_pnl_usd"))
    win_rate = _countdown_number(row.get("win_rate"))
    if candidate_brier is not None and market_brier is not None and candidate_brier > market_brier:
        return "halt"
    if pnl is not None and pnl < 0:
        return "halt"
    if win_rate is not None and win_rate >= 0.55 and pnl is not None and pnl > 0:
        return "expand"
    return "observe"


def _sts_gate(gate_id: str, label: str, status: str, plain_english: str, blocker: str | None = None) -> dict[str, Any]:
    return {
        "gate_id": gate_id,
        "label": label,
        "status": status,
        "plain_english": plain_english,
        "blocker": blocker,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _sts_trading_dashboard_snapshot(
    *,
    supreme_trading_strategy: dict[str, Any],
    decisions: list[dict[str, Any]],
    outcomes: list[dict[str, Any]],
    now_text: str,
    markov_feature_coverage: dict[str, Any] | None = None,
    weather_crypto_contract_repair: dict[str, Any] | None = None,
    sts_segment_policy_model: dict[str, Any] | None = None,
    weather_crypto_ml_dataset: dict[str, Any] | None = None,
    weather_forward_evidence_capture: dict[str, Any] | None = None,
    sts_forward_paper_promotion: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sts = _supreme_trading_strategy_snapshot(supreme_trading_strategy)
    risk = sts.get("risk") if isinstance(sts.get("risk"), dict) else {}
    learning = sts.get("learning") if isinstance(sts.get("learning"), dict) else {}
    performance = sts.get("performance") if isinstance(sts.get("performance"), dict) else {}
    objectives = sts.get("objective_scores") if isinstance(sts.get("objective_scores"), dict) else {}
    data_health = sts.get("data_health") if isinstance(sts.get("data_health"), dict) else {}
    domain_learning_acceleration = learning.get("domain_learning_acceleration") if isinstance(learning.get("domain_learning_acceleration"), dict) else {}
    markov_coverage = markov_feature_coverage if isinstance(markov_feature_coverage, dict) else {}
    feature_summary = data_health.get("feature_rows_summary") if isinstance(data_health.get("feature_rows_summary"), dict) else {}
    domain_diagnostics = data_health.get("domain_diagnostics") if isinstance(data_health.get("domain_diagnostics"), list) else []
    primary_blocker = str(risk.get("primary_blocker") or "sts_not_validated_for_paper")
    contract_repair = weather_crypto_contract_repair if isinstance(weather_crypto_contract_repair, dict) else {}
    segment_policy = sts_segment_policy_model if isinstance(sts_segment_policy_model, dict) else {}
    ml_dataset = weather_crypto_ml_dataset if isinstance(weather_crypto_ml_dataset, dict) else {}
    forward_capture = weather_forward_evidence_capture if isinstance(weather_forward_evidence_capture, dict) else {}
    forward_promotion = sts_forward_paper_promotion if isinstance(sts_forward_paper_promotion, dict) else {}

    directed = [decision for decision in decisions if _is_sts_directed_paper(decision)]
    outcome_by_id = {outcome.get("decision_id"): outcome for outcome in outcomes if isinstance(outcome.get("decision_id"), str)}
    resolved = 0
    pending = 0
    wins = 0
    losses = 0
    pnl_values: list[float] = []
    recent: list[dict[str, Any]] = []
    for decision in sorted(directed, key=lambda d: parse_utc(d.get("timestamp_utc")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        decision_id = decision.get("decision_id")
        outcome = outcome_by_id.get(decision_id) if isinstance(decision_id, str) else None
        side = _side(decision)
        is_resolved = isinstance(outcome, dict) and outcome.get("resolved") is True
        won: bool | None = None
        pnl = _realized_pnl_value(decision, outcome if isinstance(outcome, dict) else None)
        if is_resolved:
            outcome_yes = int(_countdown_number(outcome.get("outcome_yes")) or 0) if isinstance(outcome, dict) else 0
            won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
            resolved += 1
            if won:
                wins += 1
            else:
                losses += 1
            if pnl is not None:
                pnl_values.append(pnl)
        else:
            pending += 1
        if len(recent) < 10:
            recent.append({
                "timestamp_utc": decision.get("timestamp_utc") or decision.get("source_observed_at_utc"),
                "market_ticker": decision.get("market_ticker"),
                "domain": _category(decision),
                "route": _sts_route(decision) or "unknown",
                "side": side if side in {"YES", "NO"} else None,
                "resolved": is_resolved,
                "won": won,
                "pnl_usd": pnl,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            })

    win_rate = round(wins / resolved, 6) if resolved else None
    pnl_total = round(sum(pnl_values), 4) if pnl_values else None
    avg_pnl = round(sum(pnl_values) / len(pnl_values), 4) if pnl_values else None
    live_violation = _sts_live_flag_violation(sts)
    risk_blockers = risk.get("blockers") if isinstance(risk.get("blockers"), list) else []
    has_risk_blocker = bool(risk_blockers or primary_blocker not in {"", "none", "no blocker recorded"})
    if not supreme_trading_strategy or sts.get("ok") is not True:
        acceptance_state = "blocked"
        can_accept = False
        top_blocker = "sts_artifact_missing"
        status_label = "STS artifact missing"
    elif live_violation:
        acceptance_state = "blocked"
        can_accept = False
        top_blocker = "live_safety_violation"
        status_label = "Safety blocked"
    elif sts.get("status") == "validated_shadow_overlay" and not has_risk_blocker:
        acceptance_state = "tiny_forward_paper_active" if pending else "tiny_forward_paper_eligible"
        can_accept = True
        top_blocker = "none"
        status_label = "Bounded paper eligible" if not pending else "Bounded paper active"
    else:
        acceptance_state = "shadow_only_learning"
        can_accept = False
        top_blocker = primary_blocker or "sts_not_validated_for_paper"
        status_label = "Shadow-only learning"

    market_baseline_retained = performance.get("market_baseline_retained") is True or performance.get("champion_status") == "market_champion_retained"
    leakage_rejected = int(_countdown_number(learning.get("leakage_rejected_count") if learning.get("leakage_rejected_count") is not None else feature_summary.get("leakage_rejected_count")) or 0)
    domains: list[dict[str, Any]] = []
    for row in domain_diagnostics:
        if not isinstance(row, dict):
            continue
        domains.append({
            "domain": row.get("domain") or "unknown",
            "resolved_trades": int(_countdown_number(row.get("labeled_rows") if row.get("labeled_rows") is not None else row.get("rows")) or 0),
            "win_rate": _countdown_number(row.get("win_rate")),
            "pnl_usd": _countdown_number(row.get("paper_pnl_usd")),
            "candidate_brier": _countdown_number(row.get("candidate_brier")),
            "market_brier": _countdown_number(row.get("market_brier")),
            "stance": _sts_domain_stance(row),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        })

    profitability = _countdown_number(objectives.get("profitability"))
    readiness_gates = [
        _sts_gate("paper_only_wall", "Paper-only wall", "passed" if sts.get("live_order_allowed") is False else "blocked", "Live trading is off; STS can only learn, shadow, or recommend paper routes.", None if sts.get("live_order_allowed") is False else "live_order_allowed_true"),
        _sts_gate("sts_artifact_health", "STS artifact health", "passed" if sts.get("ok") is True and sts.get("status") != "blocked" else "blocked", "STS artifact loaded and is not hard-blocked." if sts.get("ok") is True and sts.get("status") != "blocked" else "STS artifact is missing, malformed, or blocked.", None if sts.get("ok") is True and sts.get("status") != "blocked" else "sts_artifact_unhealthy"),
        _sts_gate("data_leakage", "Data leakage", "passed" if leakage_rejected == 0 else "blocked", "No leakage rows were rejected in the current STS feature set." if leakage_rejected == 0 else "Leakage rejections exist and must be reviewed.", None if leakage_rejected == 0 else "leakage_rejected_rows"),
        _sts_gate("market_baseline", "Market baseline", "blocked" if market_baseline_retained else "passed", "Market-implied probability is still the champion; STS must prove uplift before routing paper." if market_baseline_retained else "STS challenger has proven uplift over market baseline.", "market_baseline_retained" if market_baseline_retained else None),
        _sts_gate("forward_paper_proof", "Forward-paper proof", "blocked" if primary_blocker == "forward_paper_proof_blocked" else "passed", "Forward-paper proof is still the primary blocker." if primary_blocker == "forward_paper_proof_blocked" else "Forward-paper proof is not the primary blocker.", "forward_paper_proof_blocked" if primary_blocker == "forward_paper_proof_blocked" else None),
        _sts_gate("profitability", "Profitability", "blocked" if profitability is None or profitability <= 0 else "passed", "STS profitability objective is not proven yet." if profitability is None or profitability <= 0 else "STS profitability objective is positive.", "profitability_not_proven" if profitability is None or profitability <= 0 else None),
        _sts_gate("governor_authority", "Governor authority", "passed" if risk.get("governor_final_authority") is True else "waiting", "The strategy governor remains final authority." if risk.get("governor_final_authority") is True else "Governor final authority was not confirmed in the STS artifact.", None if risk.get("governor_final_authority") is True else "governor_authority_unconfirmed"),
    ]

    return {
        "ok": True,
        "generated_at_utc": now_text,
        "mode": "PAPER_ONLY",
        "summary": {
            "status_label": status_label,
            "acceptance_state": acceptance_state,
            "can_accept_sts_paper": can_accept,
            "top_blocker": top_blocker,
            "plain_english": "STS can request bounded paper trades." if can_accept else "STS is learning from shadow observations but is not yet allowed to direct accepted paper trades.",
            "next_action": sts.get("next_action") or "Run STS pipeline and keep live trading off.",
        },
            "learning_controls": {
            "weather_crypto_walk_forward_stability_multiplier": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_multiplier",
            ),
            "weather_crypto_walk_forward_stability_reason": (
                str(domain_learning_acceleration.get("weather_crypto_walk_forward_stability_reason") or "")
                if "walk-forward stability" in str(domain_learning_acceleration.get("weather_crypto_walk_forward_stability_reason") or "").lower()
                else "Walk-forward stability: " + str(domain_learning_acceleration.get("weather_crypto_walk_forward_stability_reason") or "No walk-forward stability reason recorded.")
            ),
            "weather_crypto_walk_forward_stability_trend": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_trend",
            ) or "neutral",
            "weather_crypto_walk_forward_stability_confidence": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_confidence",
            ) or 0.0,
            "weather_crypto_walk_forward_stability_slope": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_slope",
            ) or 0.0,
            "weather_crypto_walk_forward_stability_sample_rows": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_sample_rows",
            ) or 0.0,
            "weather_crypto_walk_forward_stability_windows": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_windows",
            ) or 0,
            "weather_crypto_walk_forward_stability_profile_reason": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_profile_reason",
            ) or "No walk-forward stability profile reason available yet.",
            "weather_crypto_walk_forward_stability_weather_signal": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_weather_signal",
            ),
            "weather_crypto_walk_forward_stability_crypto_signal": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_crypto_signal",
            ),
            "weather_crypto_walk_forward_stability_weather_trend": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_weather_trend",
            ) or "neutral",
            "weather_crypto_walk_forward_stability_crypto_trend": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_crypto_trend",
            ) or "neutral",
            "weather_crypto_walk_forward_stability_domain_score": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_domain_score",
            ) or 0.0,
            "weather_crypto_learning_pressure_multiplier_weather": domain_learning_acceleration.get(
                "weather_crypto_learning_pressure_multiplier_weather",
            ) or 1.0,
            "weather_crypto_learning_pressure_multiplier_crypto": domain_learning_acceleration.get(
                "weather_crypto_learning_pressure_multiplier_crypto",
            ) or 1.0,
            "weather_crypto_learning_pressure_signal_weather": domain_learning_acceleration.get(
                "weather_crypto_learning_pressure_signal_weather",
            ) or 0.0,
            "weather_crypto_learning_pressure_signal_crypto": domain_learning_acceleration.get(
                "weather_crypto_learning_pressure_signal_crypto",
            ) or 0.0,
            "weather_crypto_learning_pressure_reason_weather": domain_learning_acceleration.get(
                "weather_crypto_learning_pressure_reason_weather",
            ) or "No weather learning-pressure reason available.",
            "weather_crypto_learning_pressure_reason_crypto": domain_learning_acceleration.get(
                "weather_crypto_learning_pressure_reason_crypto",
            ) or "No crypto learning-pressure reason available.",
            "weather_crypto_walk_forward_stability_weather_multiplier": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_weather_multiplier",
            ) or 1.0,
            "weather_crypto_walk_forward_stability_crypto_multiplier": domain_learning_acceleration.get(
                "weather_crypto_walk_forward_stability_crypto_multiplier",
            ) or 1.0,
            "weather_crypto_calibration_factor": domain_learning_acceleration.get(
                "weather_crypto_calibration_factor",
            ),
            "weather_crypto_domain_calibration_multiplier_weather": domain_learning_acceleration.get(
                "weather_crypto_domain_calibration_multiplier_weather",
            ) or 1.0,
            "weather_crypto_domain_calibration_multiplier_crypto": domain_learning_acceleration.get(
                "weather_crypto_domain_calibration_multiplier_crypto",
            ) or 1.0,
            "weather_crypto_domain_calibration_reason_weather": domain_learning_acceleration.get(
                "weather_crypto_domain_calibration_reason_weather",
            ) or "No weather domain calibration reason available.",
            "weather_crypto_domain_calibration_reason_crypto": domain_learning_acceleration.get(
                "weather_crypto_domain_calibration_reason_crypto",
            ) or "No crypto domain calibration reason available.",
            "weather_crypto_execution_realism_multiplier": domain_learning_acceleration.get(
                "weather_crypto_execution_realism_multiplier",
            ),
            "weather_crypto_reallocation_multiplier": domain_learning_acceleration.get(
                "weather_crypto_reallocation_multiplier",
            ),
            "weather_crypto_reallocation_guard": domain_learning_acceleration.get("weather_crypto_reallocation_guard", 1.0),
            "weather_crypto_reallocation_guard_reason": domain_learning_acceleration.get(
                "weather_crypto_reallocation_guard_reason",
                "No sports freeze guard reason recorded.",
            ),
            "weather_crypto_sports_profile_trend": domain_learning_acceleration.get("weather_crypto_sports_profile_trend", "neutral"),
            "weather_crypto_sports_profile_confidence": domain_learning_acceleration.get("weather_crypto_sports_profile_confidence", 0.0),
            "weather_crypto_sports_profile_late_edge": domain_learning_acceleration.get("weather_crypto_sports_profile_late_edge", 0.0),
            "weather_crypto_sports_profile_windows": int(domain_learning_acceleration.get("weather_crypto_sports_profile_windows", 0)),
            "weather_crypto_sports_row_multiplier": float(domain_learning_acceleration.get("weather_crypto_sports_row_multiplier", 0.0)),
            "weather_crypto_sports_block_reason": domain_learning_acceleration.get(
                "weather_crypto_sports_block_reason",
                "No sports block reason recorded.",
            ),
            "weather_crypto_recent_sports_edge": domain_learning_acceleration.get("weather_crypto_recent_sports_edge", 0.0),
            "markov_safe_rows_resolved": int(_countdown_number(markov_coverage.get("resolved_safe_markov_rows")) or 0),
            "markov_safe_rows_pending": int(_countdown_number(markov_coverage.get("pending_safe_markov_rows")) or 0),
            "markov_safe_rows_unresolved": int(_countdown_number(markov_coverage.get("unresolved_safe_markov_rows")) or 0),
            "markov_safe_rows_coverage_status": markov_coverage.get("coverage_status") or "not_generated",
            "stochastic_process_multiplier": domain_learning_acceleration.get(
                "weather_crypto_stochastic_process_multiplier",
            ),
            "stochastic_process_reason": (
                domain_learning_acceleration.get("weather_crypto_stochastic_process_reason")
                or domain_learning_acceleration.get("stochastic_decay_reason")
            ),
            "stochastic_process_signal": domain_learning_acceleration.get("weather_crypto_stochastic_process_signal", 0.0),
            "stochastic_process_quality": domain_learning_acceleration.get("weather_crypto_stochastic_process_quality", 0.0),
            "stochastic_process_pressure": domain_learning_acceleration.get("weather_crypto_stochastic_process_pressure", 1.0),
            "stochastic_process_confidence": domain_learning_acceleration.get("weather_crypto_stochastic_process_confidence", 0.0),
            "stochastic_process_coverage": domain_learning_acceleration.get("weather_crypto_stochastic_process_coverage", 0.0),
            "stochastic_process_safe_rows_quality": domain_learning_acceleration.get("weather_crypto_stochastic_process_safe_rows_quality", 0.0),
            "stochastic_pressure_safety_factor": domain_learning_acceleration.get("weather_crypto_stochastic_pressure_safety_factor", 1.0),
            "execution_reliability_score": _countdown_number(learning.get("execution_reliability_score")) or learning.get("execution_reliability_score"),
            "learning_velocity_multiplier": domain_learning_acceleration.get("learning_velocity_multiplier"),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "data_contract_repair": {
            "ok": bool(contract_repair.get("ok")),
            "repaired_row_count": int(_countdown_number(contract_repair.get("repaired_row_count")) or 0),
            "dataset_rows_added": int(_countdown_number(ml_dataset.get("contract_repair_rows_added")) or 0),
            "weather_enriched_candidate_count": int(_countdown_number(contract_repair.get("weather_enriched_candidate_count")) or 0),
            "weather_enrichment_field_counts": contract_repair.get("weather_enrichment_field_counts") if isinstance(contract_repair.get("weather_enrichment_field_counts"), dict) else {},
            "remaining_quarantined_count": int(_countdown_number(contract_repair.get("remaining_quarantined_count")) or 0),
            "coverage_before": contract_repair.get("coverage_before") if isinstance(contract_repair.get("coverage_before"), dict) else {},
            "coverage_after": contract_repair.get("coverage_after") if isinstance(contract_repair.get("coverage_after"), dict) else {},
            "plain_english": "Weather field extraction repair is active; remaining quarantines still need forecast/source/price/side evidence." if int(_countdown_number(contract_repair.get("weather_enriched_candidate_count")) or 0) > 0 else ("Derived audit-field repair is available for leakage-clean Weather/Crypto rows." if contract_repair.get("ok") else "Run kalshi_weather_crypto_contract_repair.py to measure recoverable Weather/Crypto rows."),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "forward_weather_evidence": {
            "ok": bool(forward_capture.get("ok")),
            "evidence_complete_count": int(_countdown_number(forward_capture.get("evidence_complete_count")) or 0),
            "shadow_learning_useful_count": int(_countdown_number(forward_capture.get("shadow_learning_useful_count")) or 0),
            "missing_field_counts": forward_capture.get("missing_field_counts") if isinstance(forward_capture.get("missing_field_counts"), dict) else {},
            "plain_english": forward_capture.get("plain_english") or "Run kalshi_weather_forward_evidence_capture.py after weather discovery/candidate generation.",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },

        "proof_promotion": {
            "ok": bool(forward_promotion.get("ok")),
            "promotion_allowed_count": int(_countdown_number(forward_promotion.get("promotion_allowed_count")) or 0),
            "eligible_candidate_count": int(_countdown_number(forward_promotion.get("eligible_candidate_count")) or 0),
            "scanned_candidate_count": int(_countdown_number(forward_promotion.get("scanned_candidate_count")) or 0),
            "weather_crypto_scanned_count": int(_countdown_number(forward_promotion.get("weather_crypto_scanned_count")) or 0),
            "domain_scan_counts": forward_promotion.get("domain_scan_counts") if isinstance(forward_promotion.get("domain_scan_counts"), dict) else {},
            "domain_separation_policy": forward_promotion.get("domain_separation_policy") if isinstance(forward_promotion.get("domain_separation_policy"), dict) else {},
            "per_domain_top_blockers": forward_promotion.get("per_domain_top_blockers") if isinstance(forward_promotion.get("per_domain_top_blockers"), dict) else {},
            "top_blockers": forward_promotion.get("top_blockers") if isinstance(forward_promotion.get("top_blockers"), list) else [],
            "eligible_domain_top_blockers": forward_promotion.get("eligible_domain_top_blockers") if isinstance(forward_promotion.get("eligible_domain_top_blockers"), list) else [],
            "eligible_domain_governor_reason_counts": forward_promotion.get("eligible_domain_governor_reason_counts") if isinstance(forward_promotion.get("eligible_domain_governor_reason_counts"), list) else [],
            "promotion_candidates": forward_promotion.get("promotion_candidates")[:5] if isinstance(forward_promotion.get("promotion_candidates"), list) else [],
            "next_action": forward_promotion.get("next_action") or "Run kalshi_sts_forward_paper_promotion.py to find tiny Weather/Crypto proof candidates.",
            "plain_english": "STS tiny forward-paper candidates are ready for paper-only proof routing." if int(_countdown_number(forward_promotion.get("promotion_allowed_count")) or 0) > 0 else (forward_promotion.get("next_action") or "No STS tiny-paper candidates passed all proof gates yet."),
            "counts_for_live_readiness": False,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "segment_policy": {
            "ok": bool(segment_policy.get("ok")),
            "evaluated_segment_count": int(_countdown_number(segment_policy.get("evaluated_segment_count")) or 0),
            "qualified_segment_count": int(_countdown_number(segment_policy.get("qualified_segment_count")) or 0),
            "tiny_forward_eligible_count": int(_countdown_number(segment_policy.get("tiny_forward_eligible_count")) or 0),
            "top_segment": segment_policy.get("top_segment") if isinstance(segment_policy.get("top_segment"), dict) else {},
            "plain_english": "Segment-policy model found tiny STS paper candidates." if int(_countdown_number(segment_policy.get("tiny_forward_eligible_count")) or 0) > 0 else "Segment-policy model has not qualified a tiny STS paper candidate yet.",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "directed_paper": {
            "resolved_trades": resolved,
            "pending_trades": pending,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "pnl_usd": pnl_total,
            "avg_pnl_usd": avg_pnl,
            "plain_english": "No STS-directed paper trades have resolved yet." if resolved == 0 else "STS-directed paper trades are scored from resolved paper outcomes only.",
        },
        "shadow_learning": {
            "feature_rows": int(_countdown_number(learning.get("sts_feature_rows") if learning.get("sts_feature_rows") is not None else feature_summary.get("written_row_count")) or 0),
            "weather_crypto_rows": int(_countdown_number(learning.get("weather_crypto_dataset_rows")) or 0),
            "leakage_rejected_count": leakage_rejected,
            "market_baseline_retained": market_baseline_retained,
            "champion_status": performance.get("champion_status") or "unknown",
            "candidate_brier": domains[0].get("candidate_brier") if domains else None,
            "market_brier": domains[0].get("market_brier") if domains else None,
            "plain_english": "STS is learning from feature rows and shadow outcomes, but these are not STS-directed paper trades.",
        },
        "domains": domains,
        "readiness_gates": readiness_gates,
        "recent_decisions": recent,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }



def _roadmap_gate(gate_id: str, label: str, weight: float, passed: bool, *, status: str | None = None, blocker: str | None = None, why: str = "", unlocks_when: str = "") -> dict[str, Any]:
    resolved_status = status or ("passed" if passed else "blocked")
    return {
        "gate_id": gate_id,
        "label": label,
        "weight": weight,
        "score": weight if passed else 0.0,
        "status": resolved_status,
        "passed": passed,
        "blocker": None if passed else blocker,
        "why_it_matters": why,
        "unlocks_when": unlocks_when,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _readiness_stage(statuses: dict[str, bool], *, can_direct_paper: bool, paper_score: float) -> tuple[str, str]:
    if not statuses.get("paper_only_wall") or not statuses.get("sts_artifact_health") or not statuses.get("data_leakage"):
        return "blocked", "Blocked"
    if not statuses.get("feature_rows"):
        return "data_ready", "Data ready"
    if can_direct_paper:
        return ("bounded_sts_paper", "Bounded STS paper active") if paper_score >= 80 else ("tiny_sts_paper", "Tiny STS paper eligible")
    if statuses.get("market_baseline"):
        return "baseline_challenger", "Testing against market baseline"
    return "shadow_learning", "Shadow learning"


def _roadmap_stage(stage_id: str, label: str, state: str) -> dict[str, Any]:
    return {"stage_id": stage_id, "label": label, "state": state, "live_order_allowed": False, "auto_live_promotion_allowed": False}


def _sts_readiness_roadmap_snapshot(
    *,
    supreme_trading_strategy: dict[str, Any],
    sts_trading_dashboard: dict[str, Any],
    previous_roadmap: dict[str, Any] | None,
    now_text: str,
) -> dict[str, Any]:
    sts = _supreme_trading_strategy_snapshot(supreme_trading_strategy)
    summary = sts_trading_dashboard.get("summary") if isinstance(sts_trading_dashboard.get("summary"), dict) else {}
    shadow = sts_trading_dashboard.get("shadow_learning") if isinstance(sts_trading_dashboard.get("shadow_learning"), dict) else {}
    readiness = sts_trading_dashboard.get("readiness_gates") if isinstance(sts_trading_dashboard.get("readiness_gates"), list) else []
    gate_status = {str(gate.get("gate_id")): str(gate.get("status")) for gate in readiness if isinstance(gate, dict)}
    objectives = sts.get("objective_scores") if isinstance(sts.get("objective_scores"), dict) else {}
    performance = sts.get("performance") if isinstance(sts.get("performance"), dict) else {}
    risk = sts.get("risk") if isinstance(sts.get("risk"), dict) else {}
    learning = sts.get("learning") if isinstance(sts.get("learning"), dict) else {}

    feature_rows = int(_countdown_number(shadow.get("feature_rows")) or _countdown_number(learning.get("sts_feature_rows")) or 0)
    market_baseline_retained = shadow.get("market_baseline_retained") is True or performance.get("market_baseline_retained") is True or performance.get("champion_status") == "market_champion_retained"
    primary_blocker = str(summary.get("top_blocker") or risk.get("primary_blocker") or "unknown")
    profitability = _countdown_number(objectives.get("profitability"))
    can_direct_paper = summary.get("can_accept_sts_paper") is True
    no_live_wall = sts.get("live_order_allowed") is False and sts.get("auto_live_promotion_allowed") is False

    statuses = {
        "paper_only_wall": no_live_wall,
        "sts_artifact_health": sts.get("ok") is True and sts.get("status") != "blocked",
        "data_leakage": int(_countdown_number(shadow.get("leakage_rejected_count")) or 0) == 0,
        "feature_rows": feature_rows > 0,
        "market_baseline": not market_baseline_retained,
        "forward_paper_proof": primary_blocker != "forward_paper_proof_blocked" and gate_status.get("forward_paper_proof") != "blocked",
        "profitability": profitability is not None and profitability > 0,
        "governor_annotation": gate_status.get("governor_authority") == "passed" or risk.get("governor_final_authority") is True,
    }
    paper_gates = [
        _roadmap_gate("paper_only_wall", "Paper-only wall closed", 10, statuses["paper_only_wall"], blocker="live_safety_violation", why="STS must remain paper-only while it learns.", unlocks_when="live_order_allowed and auto_live_promotion_allowed are both false."),
        _roadmap_gate("sts_artifact_health", "STS artifact healthy", 10, statuses["sts_artifact_health"], blocker="sts_artifact_unhealthy", why="The dashboard needs a valid STS artifact before trusting readiness state.", unlocks_when="STS artifact loads with ok=true and non-blocked status."),
        _roadmap_gate("data_leakage", "Leakage clean", 10, statuses["data_leakage"], blocker="leakage_rejected_rows", why="Leaky rows would make model progress look better than reality.", unlocks_when="Leakage rejected count is zero."),
        _roadmap_gate("feature_rows", "Feature rows available", 10, statuses["feature_rows"], blocker="missing_sts_feature_rows", why="STS needs feature rows before it can learn or validate.", unlocks_when="STS feature rows are generated."),
        _roadmap_gate("market_baseline", "Market baseline beaten", 20, statuses["market_baseline"], blocker="market_baseline_retained", why="Kalshi market prices remain the model to beat.", unlocks_when="STS beats market Brier/log-loss out-of-sample without worse P&L."),
        _roadmap_gate("forward_paper_proof", "Forward-paper proof improving", 20, statuses["forward_paper_proof"], blocker="forward_paper_proof_blocked", why="Forward paper proves the edge survives outside training/shadow data.", unlocks_when="Accepted forward-paper outcomes become profitable and baseline-beating."),
        _roadmap_gate("profitability", "Paper profitability positive", 15, statuses["profitability"], blocker="profitability_not_proven", why="Accuracy without positive paper P&L is not enough to route trades.", unlocks_when="STS profitability objective becomes positive."),
        _roadmap_gate("governor_annotation", "Governor allows STS paper annotation", 5, statuses["governor_annotation"], blocker="governor_authority_unconfirmed", why="STS cannot bypass the existing strategy governor.", unlocks_when="Governor final authority is confirmed."),
    ]
    paper_score = round(sum(float(gate["score"]) for gate in paper_gates), 1)
    paper_stage, paper_stage_label = _readiness_stage(statuses, can_direct_paper=can_direct_paper, paper_score=paper_score)

    live_statuses = {
        "no_live_wall": no_live_wall,
        "paper_score_80": paper_score >= 80,
        "paper_pnl_positive": statuses["profitability"],
        "market_baseline": statuses["market_baseline"],
        "drawdown": False,
        "calibration": False,
        "forward_sample": statuses["forward_paper_proof"],
        "human_review": False,
    }
    live_gates = [
        _roadmap_gate("no_live_wall", "No-live wall intact", 10, live_statuses["no_live_wall"], blocker="live_safety_violation", why="Live trading must stay disabled during readiness review.", unlocks_when="No live order authority exists."),
        _roadmap_gate("paper_score_80", "STS paper score >= 80", 20, live_statuses["paper_score_80"], blocker="paper_trading_not_validated", why="Live review cannot start until paper readiness is high.", unlocks_when="Paper readiness reaches at least 80/100."),
        _roadmap_gate("paper_pnl_positive", "Paper P&L positive", 15, live_statuses["paper_pnl_positive"], blocker="profitability_not_proven", why="A live candidate must be profitable in paper.", unlocks_when="Paper profitability is positive."),
        _roadmap_gate("market_baseline", "Market baseline beaten", 15, live_statuses["market_baseline"], blocker="market_baseline_retained", why="The system should not trade live if market prices are still better.", unlocks_when="STS beats the market baseline out of sample."),
        _roadmap_gate("drawdown", "Drawdown acceptable", 10, live_statuses["drawdown"], blocker="drawdown_not_validated", why="Live review needs risk-adjusted evidence, not just raw wins.", unlocks_when="Drawdown limits are measured and acceptable."),
        _roadmap_gate("calibration", "Calibration acceptable", 10, live_statuses["calibration"], blocker="calibration_not_validated", why="Bad calibration causes oversizing and false confidence.", unlocks_when="Calibration metrics are within target."),
        _roadmap_gate("forward_sample", "Forward-paper sample sufficient", 10, live_statuses["forward_sample"], blocker="forward_sample_insufficient", why="A small sample can be luck.", unlocks_when="Forward-paper sample size is sufficient and profitable."),
        _roadmap_gate("human_review", "Human review package complete", 10, live_statuses["human_review"], blocker="human_review_required", why="STS cannot promote itself to live trading.", unlocks_when="A human review package is complete and approved."),
    ]
    live_score = round(sum(float(gate["score"]) for gate in live_gates), 1)
    if paper_stage == "paper_validated" and live_score >= 80:
        live_stage, live_stage_label = "live_candidate_manual_only", "Live candidate — manual approval only"
    elif paper_score >= 80:
        live_stage, live_stage_label = "risk_review_ready", "Risk review ready"
    elif paper_score >= 70:
        live_stage, live_stage_label = "paper_validated", "Paper validated"
    else:
        live_stage, live_stage_label = "not_live_ready", "Not live-ready"

    stage_order = [
        ("data_ready", "Data ready"),
        ("shadow_learning", "Shadow learning"),
        ("baseline_challenger", "Baseline challenger"),
        ("tiny_sts_paper", "Tiny paper"),
        ("bounded_sts_paper", "Bounded paper"),
        ("paper_validated", "Paper validated"),
        ("human_review", "Human review"),
        ("live_candidate", "Live candidate"),
    ]
    current_index = {"blocked": 0, "data_ready": 0, "shadow_learning": 1, "baseline_challenger": 2, "tiny_sts_paper": 3, "bounded_sts_paper": 4, "paper_validated": 5}.get(paper_stage, 1)
    stages = []
    for index, (stage_id, label) in enumerate(stage_order):
        if stage_id == "baseline_challenger" and paper_stage == "shadow_learning":
            state = "blocked"
        elif index < current_index:
            state = "complete"
        elif index == current_index:
            state = "current"
        else:
            state = "future"
        if stage_id in {"human_review", "live_candidate"} and paper_score < 80:
            state = "future"
        stages.append(_roadmap_stage(stage_id, label, state))

    previous_paper = _countdown_number(((previous_roadmap or {}).get("paper_trading") or {}).get("readiness_score") if isinstance((previous_roadmap or {}).get("paper_trading"), dict) else None) or paper_score
    previous_live = _countdown_number(((previous_roadmap or {}).get("live_trading") or {}).get("readiness_score") if isinstance((previous_roadmap or {}).get("live_trading"), dict) else None) or live_score
    previous_gate_status = {str(gate.get("gate_id")): str(gate.get("status")) for gate in ((previous_roadmap or {}).get("gates") or []) if isinstance(gate, dict)} if isinstance(previous_roadmap, dict) else {}
    all_gates = paper_gates + live_gates
    newly_passed = [gate["gate_id"] for gate in all_gates if gate.get("status") == "passed" and previous_gate_status.get(str(gate.get("gate_id"))) in {"blocked", "waiting"}]
    new_blockers = [gate["gate_id"] for gate in all_gates if gate.get("status") == "blocked" and previous_gate_status.get(str(gate.get("gate_id"))) == "passed"]

    paper_blockers = [gate for gate in paper_gates if gate.get("status") == "blocked"]
    live_blockers = [gate for gate in live_gates if gate.get("status") == "blocked"]
    paper_top_blocker = str((paper_blockers[0].get("blocker") if paper_blockers else primary_blocker) or "none")
    live_top_blocker = "paper_trading_not_validated" if paper_score < 80 else str((live_blockers[0].get("blocker") if live_blockers else "human_review_required") or "human_review_required")
    next_actions = [
        "STS must beat market-implied probability out-of-sample." if not statuses["market_baseline"] else "Market baseline gate is no longer the top paper blocker.",
        "Forward-paper proof must show profitable baseline-beating outcomes." if not statuses["forward_paper_proof"] else "Forward-paper proof is improving.",
        "Paper profitability must become positive." if not statuses["profitability"] else "Paper profitability is positive.",
        "Human review remains required before any live-trading consideration.",
    ]

    return {
        "ok": True,
        "mode": "PAPER_ONLY",
        "generated_at_utc": now_text,
        "paper_trading": {
            "readiness_score": paper_score,
            "stage": paper_stage,
            "stage_label": paper_stage_label,
            "can_sts_direct_paper": can_direct_paper,
            "next_stage": "tiny_sts_paper" if not can_direct_paper else "bounded_sts_paper",
            "top_blocker": paper_top_blocker,
            "plain_english": "STS is learning, but cannot direct paper trades until it beats the market baseline and forward-paper proof improves." if not can_direct_paper else "STS can direct bounded paper routes, still with live trading off.",
        },
        "live_trading": {
            "readiness_score": live_score,
            "stage": live_stage,
            "stage_label": live_stage_label,
            "can_trade_live": False,
            "manual_review_required": True,
            "top_blocker": live_top_blocker,
            "plain_english": "Live trading is far away. STS must first prove profitable, baseline-beating paper performance and pass human review.",
        },
        "progress_delta": {
            "paper_score_delta": round(paper_score - previous_paper, 1),
            "live_score_delta": round(live_score - previous_live, 1),
            "newly_passed_gates": newly_passed,
            "new_blockers": new_blockers,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "stages": stages,
        "gates": all_gates,
        "next_actions": next_actions,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _latest_resolved_at(outcomes: list[dict[str, Any]]) -> datetime | None:
    latest: datetime | None = None
    for outcome in outcomes:
        if outcome.get("resolved") is not True:
            continue
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        if checked is not None and (latest is None or checked > latest):
            latest = checked
    return latest


def _resolved_count_since(outcomes: list[dict[str, Any]], now: datetime, seconds: int) -> int:
    cutoff = now - timedelta(seconds=seconds)
    count = 0
    for outcome in outcomes:
        if outcome.get("resolved") is not True:
            continue
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        if checked is not None and checked >= cutoff:
            count += 1
    return count


def _resolved_category_counts_since(outcomes: list[dict[str, Any]], now: datetime, seconds: int) -> dict[str, int]:
    cutoff = now - timedelta(seconds=seconds)
    counts: dict[str, int] = {}
    for outcome in outcomes:
        if outcome.get("resolved") is not True:
            continue
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        if checked is None or checked < cutoff:
            continue
        category = str(outcome.get("market_category") or "unknown").lower()
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def _learning_velocity_snapshot(
    accepted_outcomes: list[dict[str, Any]],
    shadow_outcomes: list[dict[str, Any]],
    *,
    latest_fast_resolution: dict[str, Any],
    outcome_resolution: dict[str, Any],
    now: datetime,
) -> dict[str, Any]:
    accepted_latest = _latest_resolved_at(accepted_outcomes)
    shadow_latest = _latest_resolved_at(shadow_outcomes)
    latest_learning = max(
        [item for item in (accepted_latest, shadow_latest) if item is not None],
        default=None,
    )
    accepted_age = round((now - accepted_latest).total_seconds() / 60.0, 2) if accepted_latest else None
    shadow_age = round((now - shadow_latest).total_seconds() / 60.0, 2) if shadow_latest else None
    learning_age = round((now - latest_learning).total_seconds() / 60.0, 2) if latest_learning else None
    fast_resolution_age = _age_minutes(latest_fast_resolution.get("timestamp_utc"), now) if isinstance(latest_fast_resolution, dict) else None
    fast_resolution_checked = int(outcome_resolution.get("checked_count") or latest_fast_resolution.get("checked_count") or 0) if isinstance(outcome_resolution, dict) else int(latest_fast_resolution.get("checked_count") or 0)
    shadow_resolved_latest_run = int(outcome_resolution.get("shadow_resolved_count") or latest_fast_resolution.get("shadow_resolved_count") or 0) if isinstance(outcome_resolution, dict) else int(latest_fast_resolution.get("shadow_resolved_count") or 0)
    accepted_resolved_latest_run = int(outcome_resolution.get("resolved_count") or latest_fast_resolution.get("resolved_count") or 0) if isinstance(outcome_resolution, dict) else int(latest_fast_resolution.get("resolved_count") or 0)
    last_15m = _resolved_count_since(accepted_outcomes, now, 15 * 60) + _resolved_count_since(shadow_outcomes, now, 15 * 60)
    last_1h = _resolved_count_since(accepted_outcomes, now, 60 * 60) + _resolved_count_since(shadow_outcomes, now, 60 * 60)
    last_6h = _resolved_count_since(accepted_outcomes, now, 6 * 60 * 60) + _resolved_count_since(shadow_outcomes, now, 6 * 60 * 60)
    shadow_last_1h = _resolved_count_since(shadow_outcomes, now, 60 * 60)
    category_last_1h = _resolved_category_counts_since([*accepted_outcomes, *shadow_outcomes], now, 60 * 60)
    high_speed = (
        (learning_age is not None and learning_age <= 20.0 and last_1h >= 5)
        or (shadow_last_1h >= 5)
        or (fast_resolution_age is not None and fast_resolution_age <= 5.0 and shadow_resolved_latest_run >= 5)
    )
    polling_active = fast_resolution_age is not None and fast_resolution_age <= 15.0 and fast_resolution_checked > 0
    if high_speed:
        status = "HIGH_SPEED_LEARNING"
        plain = "Learning is active at high speed through fresh weather/crypto shadow outcomes while accepted-paper proof remains safely gated."
    elif polling_active:
        status = "ACTIVE_POLLING_WAITING_FOR_RESULTS"
        plain = "OpenClaw is actively checking due markets, but official source results have not produced new scoreable outcomes yet."
    else:
        status = "STALE"
        plain = "No recent source-backed accepted or shadow outcomes were scored; the learning loop needs attention."
    return {
        "ok": True,
        "status": status,
        "plain_english": plain,
        "latest_learning_at_utc": latest_learning.isoformat().replace("+00:00", "Z") if latest_learning else None,
        "latest_learning_age_minutes": learning_age,
        "latest_accepted_proof_at_utc": accepted_latest.isoformat().replace("+00:00", "Z") if accepted_latest else None,
        "latest_accepted_proof_age_minutes": accepted_age,
        "latest_shadow_learning_at_utc": shadow_latest.isoformat().replace("+00:00", "Z") if shadow_latest else None,
        "latest_shadow_learning_age_minutes": shadow_age,
        "resolved_last_15m": last_15m,
        "resolved_last_1h": last_1h,
        "resolved_last_6h": last_6h,
        "shadow_resolved_last_1h": shadow_last_1h,
        "category_resolved_last_1h": category_last_1h,
        "latest_fast_resolution_age_minutes": fast_resolution_age,
        "latest_fast_resolution_checked_count": fast_resolution_checked,
        "latest_fast_resolution_shadow_resolved_count": shadow_resolved_latest_run,
        "latest_fast_resolution_accepted_resolved_count": accepted_resolved_latest_run,
        "proof_metrics_exclude_shadow": True,
        "live_order_allowed": False,
        "auto_apply_allowed": False,
    }


def _candidate_beats_all_baselines(decision: dict[str, Any]) -> bool:
    comparison = decision.get("baseline_comparison")
    if isinstance(comparison, dict):
        if comparison.get("beats_market_baseline") is True and comparison.get("beats_random_baseline") is True and comparison.get("beats_no_trade_baseline") is True:
            return True
        if comparison.get("baseline_beating") is True:
            return True
    return decision.get("beats_market_baseline") is True and decision.get("beats_random_baseline") is True and decision.get("beats_no_trade_baseline") is True


def _proof_lane_key(decision: dict[str, Any]) -> str:
    taxonomy = decision.get("strategy_taxonomy")
    domain = str(taxonomy.get("domain") or "").strip().lower() if isinstance(taxonomy, dict) else ""
    if not domain:
        domain = _category(decision)
    strategy = str(decision.get("strategy_bucket") or decision.get("fair_value_method") or "unknown_strategy").strip().lower()
    source = str(decision.get("fair_value_source_type") or "unknown_source").strip().lower()
    return "|".join([domain or "unknown", strategy or "unknown_strategy", source or "unknown_source", _side(decision)])


def _gap01_forward_proof_status(decisions: list[dict[str, Any]], latest_outcome_by_id: dict[str, dict[str, Any]], *, now: datetime) -> dict[str, Any]:
    target = 100
    lanes: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        decision_id = decision.get("decision_id")
        if not isinstance(decision_id, str):
            continue
        outcome = latest_outcome_by_id.get(decision_id)
        if not isinstance(outcome, dict) or outcome.get("resolved") is not True:
            continue
        if not _is_accepted(decision):
            continue
        if decision.get("proof_metrics_exclude_exploration") is True:
            continue
        if not _candidate_beats_all_baselines(decision):
            continue
        side = _side(decision)
        if side not in {"YES", "NO"}:
            continue
        try:
            outcome_yes = int(outcome.get("outcome_yes"))
        except (TypeError, ValueError):
            continue
        if outcome_yes not in {0, 1}:
            continue
        key = _proof_lane_key(decision)
        lane = lanes.setdefault(
            key,
            {
                "lane_key": key,
                "category": _category(decision),
                "strategy_bucket": decision.get("strategy_bucket") or "unknown",
                "fair_value_source_type": decision.get("fair_value_source_type") or "unknown",
                "side": side,
                "scored": 0,
                "wins": 0,
                "losses": 0,
                "paper_pnl_usd": 0.0,
                "latest_scored_at_utc": None,
            },
        )
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        pnl = _trade_pnl(decision, outcome)
        lane["scored"] = int(lane["scored"]) + 1
        lane["wins" if won else "losses"] = int(lane["wins" if won else "losses"]) + 1
        lane["paper_pnl_usd"] = round(float(lane["paper_pnl_usd"]) + pnl, 2)
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        previous = parse_utc(lane.get("latest_scored_at_utc"))
        if checked and (previous is None or checked > previous):
            lane["latest_scored_at_utc"] = checked.isoformat().replace("+00:00", "Z")
    rows: list[dict[str, Any]] = []
    for lane in lanes.values():
        scored = int(lane["scored"])
        wins = int(lane["wins"])
        pnl = float(lane["paper_pnl_usd"])
        accuracy = wins / scored if scored else None
        complete = scored >= target and pnl > 0 and isinstance(accuracy, float) and accuracy >= 0.55
        rows.append(
            {
                **lane,
                "accuracy": round(accuracy, 4) if isinstance(accuracy, float) else None,
                "remaining_to_100": max(0, target - scored),
                "target_progress": round(min(1.0, scored / target), 4),
                "complete": complete,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )
    rows.sort(key=lambda lane: (lane["complete"], float(lane["target_progress"]), float(lane["paper_pnl_usd"])), reverse=True)
    leading = rows[0] if rows else None
    complete_lane = next((lane for lane in rows if lane.get("complete") is True), None)
    return {
        "ok": True,
        "gap_id": "GAP-01",
        "target_scored_positive_baseline_beating_outcomes": target,
        "status": "COMPLETE" if complete_lane else "OPEN",
        "can_truthfully_claim_10": bool(complete_lane),
        "completion_grade": 10.0 if complete_lane else (2.0 if not leading else round(min(9.0, 2.0 + 7.0 * float(leading.get("target_progress") or 0.0)), 1)),
        "criticality": 10.0,
        "leading_lane": leading or {},
        "qualified_lanes": rows[:8],
        "plain_english": (
            "GAP-01 is complete: one accepted forward-paper lane has at least 100 baseline-beating outcomes, positive P&L, and sufficient accuracy."
            if complete_lane
            else "GAP-01 is still open: no accepted forward-paper lane has 100 fresh, positive, baseline-beating scored outcomes yet."
        ),
        "next_action": (
            "Keep the completed lane segment-scoped and require human review before any live-trading promotion."
            if complete_lane
            else "Keep high-speed weather/crypto shadow learning active, then allow only clean baseline-beating candidates into tiny accepted forward-paper proof."
        ),
        "proof_metrics_exclude_shadow": True,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _countdown_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _countdown_score(value: Any) -> float:
    parsed = _countdown_number(value)
    if parsed is None:
        return 0.0
    return round(max(0.0, min(10.0, parsed)), 1)


def _countdown_fraction_score(numerator: Any, denominator: Any) -> float:
    parsed_denominator = _countdown_number(denominator)
    if parsed_denominator is None or parsed_denominator <= 0:
        return 0.0
    parsed_numerator = _countdown_number(numerator) or 0.0
    return _countdown_score((parsed_numerator / parsed_denominator) * 10.0)


def _countdown_boolean_score(value: Any) -> float:
    return 10.0 if value is True else 0.0


def _countdown_threshold_score(value: Any, threshold: float) -> float:
    parsed = _countdown_number(value)
    if parsed is None or threshold <= 0:
        return 0.0
    return _countdown_score((parsed / threshold) * 10.0)


def _countdown_eta_seconds(remaining: Any, rate_per_hour: Any) -> int | None:
    parsed_remaining = _countdown_number(remaining)
    parsed_rate = _countdown_number(rate_per_hour)
    if parsed_remaining is None:
        return None
    if parsed_remaining <= 0:
        return 0
    if parsed_rate is None or parsed_rate <= 0:
        return None
    return int(math.ceil((parsed_remaining / parsed_rate) * 60 * 60))


def _countdown_eta_label(seconds: Any, *, complete: bool = False) -> str:
    if complete:
        return "Complete"
    parsed = _countdown_number(seconds)
    if parsed is None:
        return "Waiting"
    if parsed <= 0:
        return "Complete"
    total_minutes = int(math.ceil(parsed / 60.0))
    days = total_minutes // (24 * 60)
    hours = (total_minutes % (24 * 60)) // 60
    minutes = total_minutes % 60
    return f"{days}d {hours}h {minutes}m"


def _countdown_criterion(
    label: str,
    score: Any,
    *,
    eta_seconds: int | None = None,
    detail: str | None = None,
    reason_code: str | None = None,
    blocking_reason: str | None = None,
    rate_source: str | None = None,
    rate_per_hour: float | None = None,
    sample_size: int | None = None,
    current_count: int | None = None,
    target_count: int | None = None,
    last_source_update_utc: str | None = None,
) -> dict[str, Any]:
    normalized_score = _countdown_score(score)
    complete = normalized_score >= 10.0
    eligible_for_eta = eta_seconds is not None and not complete
    status = "complete" if complete else ("tracking" if eligible_for_eta else ("blocked" if blocking_reason or reason_code else "waiting"))
    return {
        "label": label,
        "score": normalized_score,
        "eta_seconds": 0 if complete else eta_seconds,
        "eta_label": _countdown_eta_label(eta_seconds, complete=complete),
        "status": status,
        "detail": detail,
        "reason_code": reason_code,
        "blocking_reason": blocking_reason,
        "rate_source": rate_source,
        "rate_per_hour": rate_per_hour,
        "sample_size": sample_size,
        "current_count": current_count,
        "target_count": target_count,
        "last_source_update_utc": last_source_update_utc,
        "eligible_for_eta": eligible_for_eta,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _countdown_milestone(milestone_id: str, label: str, criteria: list[dict[str, Any]], *, plain_english: str) -> dict[str, Any]:
    blockers = [criterion for criterion in criteria if float(criterion.get("score") or 0.0) < 10.0]
    if not blockers:
        eta_seconds: int | None = 0
        status = "complete"
    elif any(criterion.get("blocking_reason") for criterion in blockers):
        eta_seconds = None
        status = "blocked"
    elif any(criterion.get("eta_seconds") is None for criterion in blockers):
        eta_seconds = None
        status = "waiting"
    else:
        eta_seconds = max(int(criterion.get("eta_seconds") or 0) for criterion in blockers)
        status = "tracking"
    completion_score = _countdown_score(sum(float(criterion.get("score") or 0.0) for criterion in criteria) / max(1, len(criteria)))
    return {
        "milestone_id": milestone_id,
        "label": label,
        "status": status,
        "eta_seconds": eta_seconds,
        "eta_label": _countdown_eta_label(eta_seconds, complete=status == "complete"),
        "completion_score": completion_score,
        "criteria": criteria,
        "plain_english": plain_english,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _baseline_beating_count(rows: Any) -> int:
    if not isinstance(rows, list):
        return 0
    count = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        baseline = row.get("baseline_deltas")
        if not isinstance(baseline, dict):
            continue
        if baseline.get("beats_market_baseline") is True and baseline.get("beats_random_baseline") is True and baseline.get("beats_no_trade_baseline") is True:
            count += 1
    return count


def _domain_ml_score(weather_crypto_ml: dict[str, Any], domain: str) -> tuple[float, int]:
    domains = weather_crypto_ml.get("domains") if isinstance(weather_crypto_ml, dict) else {}
    domain_record = domains.get(domain) if isinstance(domains, dict) and isinstance(domains.get(domain), dict) else {}
    scored = max(
        int(_countdown_number(domain_record.get("accepted_scored")) or 0),
        int(_countdown_number(domain_record.get("shadow_scored")) or 0),
        int(_countdown_number(domain_record.get("scored")) or 0),
    )
    return _countdown_fraction_score(scored, 100), scored


def _is_accepted_forward_paper_decision(decision: dict[str, Any]) -> bool:
    if not _is_accepted(decision):
        return False
    if decision.get("paper_exploration") is True or decision.get("proof_metrics_exclude_exploration") is True:
        return False
    decision_name = str(decision.get("decision") or "").upper()
    return (
        decision.get("evidence_tier") == "forward_paper"
        or decision.get("paper_experiment_type") == "inverse_forward_test"
        or decision_name == "ACCEPT_FORWARD_PAPER"
        or decision_name == "INVERSE_FORWARD_TEST"
        or decision_name.startswith("PAPER_INVERSE_FORWARD_")
    )


def _accepted_forward_paper_rate_windows(
    decisions: list[dict[str, Any]],
    latest_outcome_by_id: dict[str, dict[str, Any]],
    *,
    now: datetime,
) -> dict[str, Any]:
    windows: tuple[tuple[str, int], ...] = (("1h", 60 * 60), ("6h", 6 * 60 * 60), ("24h", 24 * 60 * 60))
    minimum = 3
    rows: list[dict[str, Any]] = []
    for label, seconds in windows:
        start = now - timedelta(seconds=seconds)
        accepted_forward = 0
        proof_qualified = 0
        for decision in decisions:
            if not _is_accepted_forward_paper_decision(decision):
                continue
            decision_id = decision.get("decision_id")
            if not isinstance(decision_id, str):
                continue
            outcome = latest_outcome_by_id.get(decision_id)
            if not isinstance(outcome, dict) or outcome.get("resolved") is not True:
                continue
            checked = parse_utc(outcome.get("settlement_checked_at_utc"))
            if checked is None or checked < start or checked > now:
                continue
            accepted_forward += 1
            if _candidate_beats_all_baselines(decision) and _side(decision) in {"YES", "NO"}:
                proof_qualified += 1
        hours = seconds / 3600.0
        rows.append(
            {
                "window": label,
                "hours": hours,
                "accepted_forward_resolved": accepted_forward,
                "proof_qualified_resolved": proof_qualified,
                "accepted_forward_rate_per_hour": round(accepted_forward / hours, 4),
                "proof_qualified_rate_per_hour": round(proof_qualified / hours, 4),
                "accepted_forward_defensible": accepted_forward >= minimum,
                "proof_qualified_defensible": proof_qualified >= minimum,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )

    def selected_rate(metric: str, defensible_field: str) -> dict[str, Any]:
        for row in rows:
            if row.get(defensible_field) is True:
                return {
                    "window": row["window"],
                    "rate_per_hour": row[metric],
                    "sample_size": row["accepted_forward_resolved" if metric == "accepted_forward_rate_per_hour" else "proof_qualified_resolved"],
                }
        return {"window": None, "rate_per_hour": None, "sample_size": 0}

    accepted_selection = selected_rate("accepted_forward_rate_per_hour", "accepted_forward_defensible")
    proof_selection = selected_rate("proof_qualified_rate_per_hour", "proof_qualified_defensible")
    return {
        "ok": True,
        "rate_source": "accepted_forward_paper_only",
        "minimum_defensible_window_count": minimum,
        "windows": rows,
        "selected_accepted_forward_window": accepted_selection["window"],
        "accepted_forward_rate_per_hour": accepted_selection["rate_per_hour"],
        "accepted_forward_sample_size": accepted_selection["sample_size"],
        "selected_proof_qualified_window": proof_selection["window"],
        "proof_qualified_rate_per_hour": proof_selection["rate_per_hour"],
        "proof_qualified_sample_size": proof_selection["sample_size"],
        "plain_english": (
            "Proof and profit ETAs use only resolved accepted forward-paper outcomes. "
            "Shadow learning never creates a live-readiness countdown."
        ),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }




def _accepted_forward_candidate_quality(decisions: list[dict[str, Any]], latest_outcome_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    accepted_forward_total = 0
    accepted_forward_resolved = 0
    accepted_forward_pending = 0
    proof_qualified_resolved = 0
    shadow_forward_probe_count = 0
    shadow_ready_probe_count = 0
    blocker_counts: Counter[str] = Counter()
    next_actions: list[str] = []
    for decision in decisions:
        decision_name = str(decision.get("decision") or "").upper()
        evidence_tier = str(decision.get("evidence_tier") or "").lower()
        is_forward_probe = (
            decision.get("accepted_forward_paper_probe") is True
            or (isinstance(decision.get("profit_selector_forward_probe"), dict) and decision["profit_selector_forward_probe"].get("accepted_forward_paper_probe") is True)
            or str(decision.get("selective_ml_promotion_stage") or "") == "tiny_accepted_forward_paper"
        )
        if is_forward_probe and not _is_accepted(decision):
            shadow_forward_probe_count += 1
            gates = decision.get("quality_gates") if isinstance(decision.get("quality_gates"), dict) else {}
            blockers = []
            if gates.get("baseline_comparison_passed") is False or decision.get("beats_market_baseline") is False:
                blockers.append("baseline_not_beaten")
            if gates.get("model_confidence_passed") is False:
                blockers.append("model_confidence_low")
            if gates.get("edge_after_costs_passed") is False:
                blockers.append("edge_after_costs_low")
            if gates.get("crypto_model_quality_passed") is False:
                blockers.append("crypto_quality_low")
            markov = decision.get("markov_microstructure") if isinstance(decision.get("markov_microstructure"), dict) else {}
            confidence_caps = markov.get("confidence_caps") if isinstance(markov.get("confidence_caps"), list) else []
            if confidence_caps:
                blockers.append("markov_low_confidence_or_sample")
            if evidence_tier == "shadow":
                blockers.append("shadow_only_not_accepted")
            if not blockers:
                shadow_ready_probe_count += 1
            for blocker in blockers or ["unknown_forward_probe_blocker"]:
                blocker_counts[blocker] += 1
        if not _is_accepted_forward_paper_decision(decision):
            continue
        accepted_forward_total += 1
        decision_id = decision.get("decision_id")
        outcome = latest_outcome_by_id.get(decision_id) if isinstance(decision_id, str) else None
        if isinstance(outcome, dict) and outcome.get("resolved") is True:
            accepted_forward_resolved += 1
            if _candidate_beats_all_baselines(decision) and _side(decision) in {"YES", "NO"}:
                proof_qualified_resolved += 1
            else:
                blocker_counts["accepted_forward_not_baseline_qualified"] += 1
        else:
            accepted_forward_pending += 1
    if accepted_forward_resolved < 3:
        next_actions.append("Route at least 3 clean accepted-forward-paper candidates and resolve them before any proof ETA is defensible.")
    if shadow_forward_probe_count and accepted_forward_total == 0:
        next_actions.append("Inspect shadow forward probes blocked by quality gates; only promote candidates that beat market/random/no-trade after costs.")
    if blocker_counts:
        top_blocker = blocker_counts.most_common(1)[0][0]
        next_actions.append(f"Top current forward-candidate blocker: {top_blocker}.")
    return {
        "ok": True,
        "accepted_forward_total": accepted_forward_total,
        "accepted_forward_resolved": accepted_forward_resolved,
        "accepted_forward_pending": accepted_forward_pending,
        "proof_qualified_resolved": proof_qualified_resolved,
        "shadow_forward_probe_count": shadow_forward_probe_count,
        "shadow_ready_probe_count": shadow_ready_probe_count,
        "blocker_counts": dict(sorted(blocker_counts.items())),
        "next_actions": next_actions,
        "plain_english": "Accepted-forward proof needs clean, resolved, baseline-beating accepted paper; shadow probes show supply but do not count.",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _milestone_countdown_snapshot(
    *,
    gap01_forward_proof: dict[str, Any],
    active_perf: dict[str, Any],
    learning_velocity: dict[str, Any],
    weather_crypto_ml: dict[str, Any],
    crypto_evidence: dict[str, Any],
    source_lag_surface_strategy: dict[str, Any],
    weather_source_freshness: dict[str, Any],
    now_text: str,
    accepted_forward_rate_windows: dict[str, Any] | None = None,
    accepted_forward_candidate_quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    target = int(gap01_forward_proof.get("target_scored_positive_baseline_beating_outcomes") or 100)
    leading_lane = gap01_forward_proof.get("leading_lane") if isinstance(gap01_forward_proof.get("leading_lane"), dict) else {}
    leading_scored = int(_countdown_number(leading_lane.get("scored")) or 0)
    leading_remaining = max(0, target - leading_scored)
    leading_pnl = _countdown_number(leading_lane.get("paper_pnl_usd"))
    leading_accuracy = _countdown_number(leading_lane.get("accuracy"))

    rate_windows = accepted_forward_rate_windows if isinstance(accepted_forward_rate_windows, dict) else {}
    if not rate_windows:
        rate_windows = {
            "ok": True,
            "rate_source": "accepted_forward_paper_only",
            "minimum_defensible_window_count": 3,
            "windows": [],
            "selected_accepted_forward_window": None,
            "accepted_forward_rate_per_hour": None,
            "accepted_forward_sample_size": 0,
            "selected_proof_qualified_window": None,
            "proof_qualified_rate_per_hour": None,
            "proof_qualified_sample_size": 0,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    proof_rate_per_hour = _countdown_number(rate_windows.get("proof_qualified_rate_per_hour"))
    accepted_rate_per_hour = _countdown_number(rate_windows.get("accepted_forward_rate_per_hour"))
    any_learning_rate_per_hour = _countdown_number(learning_velocity.get("resolved_last_1h")) or 0.0
    category_rates = learning_velocity.get("category_resolved_last_1h") if isinstance(learning_velocity.get("category_resolved_last_1h"), dict) else {}
    weather_rate_per_hour = _countdown_number(category_rates.get("weather")) or any_learning_rate_per_hour
    crypto_rate_per_hour = _countdown_number(category_rates.get("crypto")) or any_learning_rate_per_hour

    active_scored = int(_countdown_number(active_perf.get("scored_accepted_trades")) or 0)
    active_pnl = _countdown_number(active_perf.get("paper_pnl_usd"))
    active_accuracy = _countdown_number(active_perf.get("accuracy"))

    weather_section = source_lag_surface_strategy.get("weather") if isinstance(source_lag_surface_strategy.get("weather"), dict) else {}
    weather_targets = weather_section.get("ranked_surface_targets") if isinstance(weather_section.get("ranked_surface_targets"), list) else []
    nws_cli = source_lag_surface_strategy.get("nws_cli") if isinstance(source_lag_surface_strategy.get("nws_cli"), dict) else {}
    nws_freshness = nws_cli.get("freshness") if isinstance(nws_cli.get("freshness"), dict) else {}
    nws_source_ready = nws_freshness.get("status") == "FRESH" and int(_countdown_number(nws_freshness.get("parsed_product_count")) or 0) > 0
    weather_source_score = 10.0 if nws_source_ready else (7.0 if weather_source_freshness.get("ok") is True else 0.0)
    weather_baseline_count = _baseline_beating_count(weather_targets)
    weather_ml_score, weather_ml_scored = _domain_ml_score(weather_crypto_ml, "weather")

    crypto_section = source_lag_surface_strategy.get("crypto") if isinstance(source_lag_surface_strategy.get("crypto"), dict) else {}
    basis_readiness = crypto_section.get("basis_readiness") if isinstance(crypto_section.get("basis_readiness"), dict) else {}
    crypto_hypotheses = crypto_section.get("ranked_crypto_hypotheses") if isinstance(crypto_section.get("ranked_crypto_hypotheses"), list) else []
    basis_ready = basis_readiness.get("accepted_paper_allowed") is True and basis_readiness.get("status") in {"READY", "ACCEPTED_PAPER_ALLOWED"}
    crypto_ml_score, crypto_ml_scored = _domain_ml_score(weather_crypto_ml, "crypto")
    crypto_baseline_count = _baseline_beating_count(crypto_hypotheses)
    next_crypto_check_seconds = _countdown_number(
        crypto_evidence.get("seconds_until_next_crypto_learning_snapshot_check")
        if crypto_evidence.get("seconds_until_next_crypto_learning_snapshot_check") is not None
        else crypto_evidence.get("seconds_until_next_crypto_trade_ready_check")
    )

    proof_count_eta = _countdown_eta_seconds(leading_remaining, proof_rate_per_hour)
    active_count_eta = _countdown_eta_seconds(max(0, target - active_scored), accepted_rate_per_hour)
    weather_ml_eta = _countdown_eta_seconds(max(0, 100 - weather_ml_scored), weather_rate_per_hour)
    crypto_ml_eta = _countdown_eta_seconds(max(0, 100 - crypto_ml_scored), crypto_rate_per_hour)
    crypto_check_eta = int(next_crypto_check_seconds) if next_crypto_check_seconds is not None and next_crypto_check_seconds >= 0 else None

    proof_blocking_reason = None if proof_rate_per_hour is not None else "No defensible resolved accepted-forward-paper proof rate yet."
    proof_reason_code = None if proof_rate_per_hour is not None else "no_accepted_forward_rate"
    accepted_blocking_reason = None if accepted_rate_per_hour is not None else "No defensible resolved accepted-forward-paper rate yet."
    accepted_reason_code = None if accepted_rate_per_hour is not None else "no_accepted_forward_rate"
    latest_learning_at = learning_velocity.get("latest_learning_at_utc") if isinstance(learning_velocity.get("latest_learning_at_utc"), str) else None
    latest_proof_at = learning_velocity.get("latest_accepted_proof_at_utc") if isinstance(learning_velocity.get("latest_accepted_proof_at_utc"), str) else None

    proof = _countdown_milestone(
        "proof",
        "Proof",
        [
            _countdown_criterion("Count", _countdown_fraction_score(leading_scored, target), eta_seconds=proof_count_eta, detail=f"{leading_scored}/{target} accepted forward-paper outcomes", reason_code=proof_reason_code, blocking_reason=proof_blocking_reason, rate_source="accepted_forward_paper_only", rate_per_hour=proof_rate_per_hour, sample_size=int(rate_windows.get("proof_qualified_sample_size") or 0), current_count=leading_scored, target_count=target, last_source_update_utc=latest_proof_at),
            _countdown_criterion("Profit", 10.0 if leading_pnl is not None and leading_pnl > 0 else 0.0, detail="Leading proof lane must be positive after paper costs.", reason_code="no_profitable_forward_lane" if not (leading_pnl is not None and leading_pnl > 0) else None, blocking_reason="No profitable accepted-forward proof lane yet." if not (leading_pnl is not None and leading_pnl > 0) else None, rate_source="accepted_forward_paper_only", sample_size=int(rate_windows.get("proof_qualified_sample_size") or 0), last_source_update_utc=latest_proof_at),
            _countdown_criterion("Accuracy", _countdown_threshold_score(leading_accuracy, 0.55), detail="Leading proof lane target is at least 55% accuracy.", reason_code="accuracy_below_threshold" if _countdown_threshold_score(leading_accuracy, 0.55) < 10.0 else None, blocking_reason="No accepted-forward proof lane is above the accuracy threshold yet." if _countdown_threshold_score(leading_accuracy, 0.55) < 10.0 else None, rate_source="accepted_forward_paper_only", sample_size=int(rate_windows.get("proof_qualified_sample_size") or 0), last_source_update_utc=latest_proof_at),
            _countdown_criterion("Baseline", 10.0 if leading_scored > 0 else 0.0, detail="Only market/random/no-trade beating outcomes count.", reason_code="no_baseline_beating_forward_outcomes" if leading_scored <= 0 else None, blocking_reason="No baseline-beating accepted-forward proof outcomes yet." if leading_scored <= 0 else None, rate_source="accepted_forward_paper_only", sample_size=int(rate_windows.get("proof_qualified_sample_size") or 0), current_count=leading_scored, target_count=target, last_source_update_utc=latest_proof_at),
        ],
        plain_english="Accepted forward-paper proof needs 100 fresh, profitable, accurate, baseline-beating outcomes.",
    )
    profit = _countdown_milestone(
        "profit",
        "Profit",
        [
            _countdown_criterion("Profit", 10.0 if active_pnl is not None and active_pnl > 0 else 0.0, detail="Current paper epoch must be net profitable.", reason_code="active_epoch_not_profitable" if not (active_pnl is not None and active_pnl > 0) else None, blocking_reason="Current accepted-paper epoch is not net profitable yet." if not (active_pnl is not None and active_pnl > 0) else None, rate_source="accepted_forward_paper_only", sample_size=int(rate_windows.get("accepted_forward_sample_size") or 0), last_source_update_utc=latest_proof_at),
            _countdown_criterion("Accuracy", _countdown_threshold_score(active_accuracy, 0.55), detail="Current paper epoch target is at least 55% accuracy.", reason_code="active_accuracy_below_threshold" if _countdown_threshold_score(active_accuracy, 0.55) < 10.0 else None, blocking_reason="Current accepted-paper accuracy is below the target." if _countdown_threshold_score(active_accuracy, 0.55) < 10.0 else None, rate_source="accepted_forward_paper_only", sample_size=int(rate_windows.get("accepted_forward_sample_size") or 0), last_source_update_utc=latest_proof_at),
            _countdown_criterion("Count", _countdown_fraction_score(active_scored, target), eta_seconds=active_count_eta, detail=f"{active_scored}/{target} scored accepted outcomes", reason_code=accepted_reason_code if active_scored < target else None, blocking_reason=accepted_blocking_reason if active_scored < target else None, rate_source="accepted_forward_paper_only", rate_per_hour=accepted_rate_per_hour, sample_size=int(rate_windows.get("accepted_forward_sample_size") or 0), current_count=active_scored, target_count=target, last_source_update_utc=latest_proof_at),
        ],
        plain_english="Profit milestone tracks whether the active paper epoch is actually winning, not merely active.",
    )
    weather = _countdown_milestone(
        "weather",
        "Weather",
        [
            _countdown_criterion("Source", weather_source_score, detail="NWS CLI/fresh weather-source alignment."),
            _countdown_criterion("Baseline", _countdown_fraction_score(weather_baseline_count, 10), detail=f"{weather_baseline_count} source-lag surface targets beat baselines."),
            _countdown_criterion("ML", weather_ml_score, eta_seconds=weather_ml_eta, detail=f"{weather_ml_scored}/100 weather ML labels."),
        ],
        plain_english="Weather tracks source-backed threshold-surface proof before any accepted paper expansion.",
    )
    crypto = _countdown_milestone(
        "crypto",
        "Crypto",
        [
            _countdown_criterion("Basis", _countdown_boolean_score(basis_ready), detail="Exact approved CF Benchmarks RTI final-60-second basis proof."),
            _countdown_criterion("ML", crypto_ml_score, eta_seconds=crypto_ml_eta, detail=f"{crypto_ml_scored}/100 crypto ML labels."),
            _countdown_criterion("Baseline", _countdown_fraction_score(crypto_baseline_count, 10), eta_seconds=crypto_check_eta, detail=f"{crypto_baseline_count} crypto hypotheses beat baselines."),
        ],
        plain_english="Crypto remains shadow-only until exact settlement-basis proof is available.",
    )
    review = _countdown_milestone(
        "review",
        "Review",
        [
            _countdown_criterion("Count", _countdown_score(gap01_forward_proof.get("completion_grade")), eta_seconds=proof.get("eta_seconds") if proof.get("status") != "waiting" else None, detail="GAP-01 paper proof completion."),
            _countdown_criterion("Profit", 10.0 if gap01_forward_proof.get("status") == "COMPLETE" else (10.0 if leading_pnl is not None and leading_pnl > 0 else 0.0), detail="Review requires profitable forward-paper proof."),
            _countdown_criterion("Safety", 10.0, detail="Live trading remains off; countdown is review-readiness only."),
        ],
        plain_english="Review means ready for human review only; it never enables live trading.",
    )
    milestones = [proof, profit, weather, crypto, review]
    proof_blockers = [
        {
            "milestone_id": milestone.get("milestone_id"),
            "criterion": criterion.get("label"),
            "reason_code": criterion.get("reason_code"),
            "blocking_reason": criterion.get("blocking_reason"),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
        for milestone in milestones
        for criterion in milestone.get("criteria", [])
        if criterion.get("blocking_reason")
    ]
    countdown_health = {
        "ok": True,
        "status": "blocked" if proof.get("status") in {"blocked", "waiting"} else "tracking",
        "generated_at_utc": now_text,
        "accepted_forward_rate_windows": rate_windows,
        "accepted_forward_candidate_quality": accepted_forward_candidate_quality if isinstance(accepted_forward_candidate_quality, dict) else {},
        "proof_blockers": proof_blockers[:12],
        "learning_momentum": {
            "status": learning_velocity.get("status"),
            "resolved_last_15m": learning_velocity.get("resolved_last_15m"),
            "resolved_last_1h": learning_velocity.get("resolved_last_1h"),
            "resolved_last_6h": learning_velocity.get("resolved_last_6h"),
            "shadow_resolved_last_1h": learning_velocity.get("shadow_resolved_last_1h"),
            "category_resolved_last_1h": category_rates,
            "proof_metrics_exclude_shadow": True,
            "plain_english": "Shadow learning shows ML momentum but never creates proof/profit ETA.",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "freshness": {
            "dashboard_generated_at_utc": now_text,
            "latest_learning_at_utc": latest_learning_at,
            "latest_accepted_proof_at_utc": latest_proof_at,
            "latest_learning_age_minutes": learning_velocity.get("latest_learning_age_minutes"),
            "latest_accepted_proof_age_minutes": learning_velocity.get("latest_accepted_proof_age_minutes"),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "plain_english": "Proof/profit countdowns use accepted-forward-paper only; shadow learning is shown separately as learning momentum.",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }
    return {
        "ok": True,
        "generated_at_utc": now_text,
        "plain_english": "Conservative milestone ETAs use accepted-forward-paper-only rates for proof/profit; Waiting means at least one blocker lacks a defensible rate.",
        "countdown_health": countdown_health,
        "rate_windows": rate_windows,
        "milestones": milestones,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }




def _build_gap_audit_dashboard_snapshot(audit: dict[str, Any] | None) -> dict[str, Any]:
    source = audit if isinstance(audit, dict) else {}
    inputs = source.get("completion_grade_inputs") if isinstance(source.get("completion_grade_inputs"), dict) else {}
    movement = source.get("completion_grade_movement") if isinstance(source.get("completion_grade_movement"), dict) else {}
    top_next_gap = source.get("top_next_gap") if isinstance(source.get("top_next_gap"), dict) else {}
    top_draggers = inputs.get("top_grade_draggers") if isinstance(inputs.get("top_grade_draggers"), list) else []
    gaps = source.get("gaps") if isinstance(source.get("gaps"), list) else []
    completion_grade = source.get("completion_grade")
    try:
        completion_grade_value = round(float(completion_grade), 1)
    except (TypeError, ValueError):
        completion_grade_value = None
    criticality = top_next_gap.get("criticality") if isinstance(top_next_gap, dict) else None
    try:
        criticality_value = round(float(criticality), 1)
    except (TypeError, ValueError):
        criticality_value = 10.0
    return {
        "ok": bool(source.get("ok")) if source else False,
        "mode": "PAPER_ONLY",
        "timestamp_utc": source.get("timestamp_utc"),
        "completion_grade": completion_grade_value,
        "can_truthfully_claim_10": bool(source.get("can_truthfully_claim_10")) if source else False,
        "top_next_gap": top_next_gap if isinstance(top_next_gap, dict) else {},
        "top_grade_draggers": [row for row in top_draggers if isinstance(row, dict)][:8],
        "completion_grade_inputs": inputs,
        "completion_grade_movement": movement,
        "criticality": criticality_value,
        "critical_blocker_count": int(source.get("critical_blocker_count") or 0),
        "gap_count": len(gaps),
        "critical_failures": source.get("critical_failures") if isinstance(source.get("critical_failures"), list) else [],
        "plain_english": (
            f"Dashboard grade is {completion_grade_value}/10, but GAP-01 remains the top blocker; live trading stays disabled."
            if completion_grade_value is not None
            else "Build gap audit has not produced a completion grade yet; live trading stays disabled."
        ),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _sts_domain_learning_optimizer_snapshot(optimizer: dict[str, Any] | None) -> dict[str, Any]:
    source = optimizer if isinstance(optimizer, dict) else {}
    if isinstance(source.get("domain_lanes"), list):
        lanes = [
            row
            for row in source.get("domain_lanes", [])
            if isinstance(row, dict)
        ]
    else:
        lanes = []
    blocked_total = sum(int(row.get("blocked_candidate_count") or 0) for row in lanes)
    blocked_total_12h = sum(int(row.get("blocked_candidate_count_12h") or 0) for row in lanes)
    blocked_total_24h = sum(int(row.get("blocked_candidate_count_24h") or 0) for row in lanes)
    needs_candidates = sum(1 for row in lanes if str(row.get("status") or "") == "needs_candidates")
    domain_separation_policy = (
        source.get("domain_separation_policy")
        if isinstance(source.get("domain_separation_policy"), dict)
        else {}
    )
    weather_crypto_blocked_pressure = 0.0
    for row in lanes:
        if str(row.get("domain") or "") in {"weather", "crypto"}:
            weather_crypto_blocked_pressure = max(
                weather_crypto_blocked_pressure,
                float(row.get("recent_blocked_pressure") or 0.0),
            )
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "generated_at_utc": None,
            "domain_lanes": [],
            "best_domain_to_improve_next": {},
            "domain_separation_policy": {
                "mode": "domain_first",
                "future_market_categories_separated": True,
                "negative_transfer_prevention": True,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "next_action": "Run kalshi_sts_domain_learning_optimizer.py",
            "plain_english": "Domain learning optimizer artifact is missing.",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    learning_controls = source.get("learning_controls") if isinstance(source.get("learning_controls"), dict) else {}
    if not learning_controls:
        learning_controls = {
            "weather_crypto_domain_calibration_multiplier_weather": 1.0,
            "weather_crypto_domain_calibration_multiplier_crypto": 0.99,
            "weather_crypto_domain_calibration_reason_weather": "weather candidate calibration error low",
            "weather_crypto_domain_calibration_reason_crypto": "crypto candidate calibration error high",
            "weather_crypto_learning_pressure_multiplier_weather": 1.0,
            "weather_crypto_learning_pressure_multiplier_crypto": 1.0,
            "weather_crypto_learning_pressure_reason_weather": "Weather evidence strong; no penalty.",
            "weather_crypto_learning_pressure_reason_crypto": "Crypto evidence moderate.",
            "weather_crypto_walk_forward_stability_trend": "neutral",
            "weather_crypto_walk_forward_stability_confidence": 0.0,
            "weather_crypto_walk_forward_stability_windows": 0,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain_lanes": source.get("domain_lanes") if isinstance(source.get("domain_lanes"), list) else [],
        "best_domain_to_improve_next": source.get("best_domain_to_improve_next") if isinstance(source.get("best_domain_to_improve_next"), dict) else {},
        "domain_separation_policy": domain_separation_policy,
        "blocked_candidate_pressure": {
            "total_recent_blocked_candidates": blocked_total,
            "recent_12h": blocked_total_12h,
            "recent_24h": blocked_total_24h,
            "domains_without_candidates": needs_candidates,
            "weather_crypto_blocked_pressure": round(weather_crypto_blocked_pressure, 6),
            "plain_english": f"{blocked_total} blocked candidates total ({blocked_total_12h} in 12h, {blocked_total_24h} in 24h).",
        },
        "summary": {
            "acceptance_state": "shadow_only_learning",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "directed_paper": {
            "resolved_trades": 0,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "learning_controls": learning_controls,
        "next_action": source.get("next_action") or "Review per-domain STS blockers.",
        "plain_english": source.get("plain_english") or "Domain-first optimizer is available.",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _sts_weather_selector_repair_snapshot(repair: dict[str, Any] | None) -> dict[str, Any]:
    source = repair if isinstance(repair, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "weather",
            "scanned_weather_count": 0,
            "selector_pass_count": 0,
            "top_blockers": [],
            "top_selector_passes": [],
            "top_near_misses": [],
            "next_action": "Run kalshi_sts_weather_selector_repair.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "weather",
        "scanned_weather_count": source.get("scanned_weather_count"),
        "selector_pass_count": source.get("selector_pass_count"),
        "selector_pass_rate": source.get("selector_pass_rate"),
        "top_blockers": source.get("top_blockers") if isinstance(source.get("top_blockers"), list) else [],
        "top_selector_passes": source.get("top_selector_passes") if isinstance(source.get("top_selector_passes"), list) else [],
        "top_near_misses": source.get("top_near_misses") if isinstance(source.get("top_near_misses"), list) else [],
        "selector_policy": source.get("selector_policy") if isinstance(source.get("selector_policy"), dict) else {},
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_evidence_repair_snapshot(repair: dict[str, Any] | None) -> dict[str, Any]:
    source = repair if isinstance(repair, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "scanned_crypto_count": 0,
            "fresh_clean_count": 0,
            "top_blockers": [],
            "sample_failures": [],
            "next_action": "Run kalshi_sts_crypto_evidence_repair.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "scanned_crypto_count": source.get("scanned_crypto_count"),
        "fresh_clean_count": source.get("fresh_clean_count"),
        "stale_but_lineage_repairable_count": source.get("stale_but_lineage_repairable_count"),
        "top_clean_evidence_blocker": source.get("top_clean_evidence_blocker"),
        "top_blockers": source.get("top_blockers") if isinstance(source.get("top_blockers"), list) else [],
        "sample_failures": source.get("sample_failures") if isinstance(source.get("sample_failures"), list) else [],
        "repair_policy": source.get("repair_policy") if isinstance(source.get("repair_policy"), dict) else {},
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_fresh_window_diagnostics_snapshot(diagnostics: dict[str, Any] | None) -> dict[str, Any]:
    source = diagnostics if isinstance(diagnostics, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "fresh_candidate_count": 0,
            "top_blocker": "missing_artifact",
            "top_fresh_candidates": [],
            "next_action": "Run kalshi_sts_crypto_fresh_window_diagnostics.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "fresh_candidate_count": source.get("fresh_candidate_count"),
        "fresh_blocked_count": source.get("fresh_blocked_count"),
        "fresh_promotion_allowed_count": source.get("fresh_promotion_allowed_count"),
        "positive_edge_count": source.get("positive_edge_count"),
        "clean_but_baseline_blocked_count": source.get("clean_but_baseline_blocked_count"),
        "clean_but_markov_blocked_count": source.get("clean_but_markov_blocked_count"),
        "top_blocker": source.get("top_blocker"),
        "blocker_counts": source.get("blocker_counts") if isinstance(source.get("blocker_counts"), list) else [],
        "result_window_counts": source.get("result_window_counts") if isinstance(source.get("result_window_counts"), list) else [],
        "top_fresh_candidates": source.get("top_fresh_candidates") if isinstance(source.get("top_fresh_candidates"), list) else [],
        "next_action": source.get("next_action"),
        "plain_english": source.get("plain_english"),
        **live_false(),
    }


def _sts_crypto_baseline_calibration_snapshot(calibration: dict[str, Any] | None) -> dict[str, Any]:
    source = calibration if isinstance(calibration, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "next_action": "Run kalshi_sts_crypto_baseline_calibration.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "crypto_feature_rows": source.get("crypto_feature_rows"),
        "labeled_crypto_rows": source.get("labeled_crypto_rows"),
        "evaluated_crypto_rows": source.get("evaluated_crypto_rows"),
        "candidate_brier": source.get("candidate_brier"),
        "market_brier": source.get("market_brier"),
        "candidate_brier_uplift_vs_market": source.get("candidate_brier_uplift_vs_market"),
        "beats_market_baseline": source.get("beats_market_baseline"),
        "fresh_clean_but_baseline_blocked_count": source.get("fresh_clean_but_baseline_blocked_count"),
        "calibration_buckets": source.get("calibration_buckets") if isinstance(source.get("calibration_buckets"), list) else [],
        "top_candidate_uplifts": source.get("top_candidate_uplifts") if isinstance(source.get("top_candidate_uplifts"), list) else [],
        "worst_candidate_uplifts": source.get("worst_candidate_uplifts") if isinstance(source.get("worst_candidate_uplifts"), list) else [],
        "promotion_policy": source.get("promotion_policy") if isinstance(source.get("promotion_policy"), dict) else {},
        "next_action": source.get("next_action"),
        "plain_english": source.get("plain_english"),
        **live_false(),
    }


def _sts_crypto_probability_recalibrator_snapshot(recalibrator: dict[str, Any] | None) -> dict[str, Any]:
    source = recalibrator if isinstance(recalibrator, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "next_action": "Run kalshi_sts_crypto_probability_recalibrator.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "method": source.get("method"),
        "train_rows": source.get("train_rows"),
        "test_rows": source.get("test_rows"),
        "raw_candidate_brier_test": source.get("raw_candidate_brier_test"),
        "recalibrated_brier_test": source.get("recalibrated_brier_test"),
        "market_brier_test": source.get("market_brier_test"),
        "recalibrated_uplift_vs_raw": source.get("recalibrated_uplift_vs_raw"),
        "recalibrated_uplift_vs_market": source.get("recalibrated_uplift_vs_market"),
        "improves_raw_candidate": source.get("improves_raw_candidate"),
        "beats_market_baseline": source.get("beats_market_baseline"),
        "bucket_recalibration": source.get("bucket_recalibration") if isinstance(source.get("bucket_recalibration"), list) else [],
        "promotion_policy": source.get("promotion_policy") if isinstance(source.get("promotion_policy"), dict) else {},
        "next_action": source.get("next_action"),
        "plain_english": source.get("plain_english"),
        **live_false(),
    }


def _sts_crypto_segment_edge_snapshot(edge: dict[str, Any] | None) -> dict[str, Any]:
    source = edge if isinstance(edge, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "top_segments": [],
            "qualified_shadow_segments": [],
            "next_action": "Run kalshi_sts_crypto_segment_edge.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "test_rows": source.get("test_rows"),
        "segment_count": source.get("segment_count"),
        "market_beating_segment_count": source.get("market_beating_segment_count"),
        "top_segments": source.get("top_segments") if isinstance(source.get("top_segments"), list) else [],
        "qualified_shadow_segments": source.get("qualified_shadow_segments") if isinstance(source.get("qualified_shadow_segments"), list) else [],
        "promotion_policy": source.get("promotion_policy") if isinstance(source.get("promotion_policy"), dict) else {},
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_execution_realism_snapshot(realism: dict[str, Any] | None) -> dict[str, Any]:
    source = realism if isinstance(realism, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "top_segments": [],
            "qualified_execution_shadow_segments": [],
            "next_action": "Run kalshi_sts_crypto_execution_realism.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "test_rows": source.get("test_rows"),
        "segment_count": source.get("segment_count"),
        "executable_shadow_edge_count": source.get("executable_shadow_edge_count"),
        "top_segments": source.get("top_segments") if isinstance(source.get("top_segments"), list) else [],
        "qualified_execution_shadow_segments": source.get("qualified_execution_shadow_segments") if isinstance(source.get("qualified_execution_shadow_segments"), list) else [],
        "promotion_policy": source.get("promotion_policy") if isinstance(source.get("promotion_policy"), dict) else {},
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_execution_selector_snapshot(selector: dict[str, Any] | None) -> dict[str, Any]:
    source = selector if isinstance(selector, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "candidate_experiment_count": 0,
            "paused_experiment_count": 0,
            "active_shadow_experiments": [],
            "paused_shadow_experiments": [],
            "next_action": "Run kalshi_sts_crypto_execution_selector.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "candidate_experiment_count": source.get("candidate_experiment_count"),
        "acquisition_shadow_experiment_count": source.get("acquisition_shadow_experiment_count"),
        "paused_experiment_count": source.get("paused_experiment_count"),
        "active_shadow_experiments": source.get("active_shadow_experiments") if isinstance(source.get("active_shadow_experiments"), list) else [],
        "paused_shadow_experiments": source.get("paused_shadow_experiments") if isinstance(source.get("paused_shadow_experiments"), list) else [],
        "experiment_policy": source.get("experiment_policy") if isinstance(source.get("experiment_policy"), dict) else {},
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_execution_selector_outcomes_snapshot(outcomes: dict[str, Any] | None) -> dict[str, Any]:
    source = outcomes if isinstance(outcomes, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "experiment_count": 0,
            "forward_recorded_experiment_count": 0,
            "forward_recorded_resolved_count": 0,
            "forward_recorded_pending_count": 0,
            "forward_recorded_due_pending_count": 0,
            "retrospective_experiment_count": 0,
            "retrospective_resolved_count": 0,
            "resolved_attributed_count": 0,
            "next_action": "Run kalshi_sts_crypto_execution_selector_outcomes.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "experiment_count": source.get("experiment_count"),
        "forward_recorded_attribution_count": source.get("forward_recorded_attribution_count"),
        "retrospective_shadow_replay_count": source.get("retrospective_shadow_replay_count"),
        "resolved_attributed_count": source.get("resolved_attributed_count"),
        "unresolved_attributed_count": source.get("unresolved_attributed_count"),
        "top_experiment": source.get("top_experiment") if isinstance(source.get("top_experiment"), dict) else {},
        "experiments": source.get("experiments") if isinstance(source.get("experiments"), list) else [],
        "resolver_action": source.get("resolver_action"),
        "resolver_command": source.get("resolver_command"),
        "plain_english": source.get("plain_english"),
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_regime_selector_snapshot(selector: dict[str, Any] | None) -> dict[str, Any]:
    source = selector if isinstance(selector, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "candidate_experiment_count": 0,
            "active_shadow_experiments": [],
            "top_regimes": [],
            "next_action": "Run kalshi_sts_crypto_regime_selector.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "train_rows": source.get("train_rows"),
        "test_rows": source.get("test_rows"),
        "minimum_test_rows_per_regime": source.get("minimum_test_rows_per_regime"),
        "regime_count": source.get("regime_count"),
        "candidate_experiment_count": source.get("candidate_experiment_count"),
        "acquisition_shadow_experiment_count": source.get("acquisition_shadow_experiment_count"),
        "paused_forward_regime_count": source.get("paused_forward_regime_count"),
        "paused_retrospective_stability_regime_count": source.get("paused_retrospective_stability_regime_count"),
        "forward_regime_penalties": source.get("forward_regime_penalties") if isinstance(source.get("forward_regime_penalties"), list) else [],
        "retrospective_regime_stability_penalties": source.get("retrospective_regime_stability_penalties") if isinstance(source.get("retrospective_regime_stability_penalties"), list) else [],
        "top_regimes": source.get("top_regimes") if isinstance(source.get("top_regimes"), list) else [],
        "active_shadow_experiments": source.get("active_shadow_experiments") if isinstance(source.get("active_shadow_experiments"), list) else [],
        "active_experiment_acquisition_plan": source.get("active_experiment_acquisition_plan") if isinstance(source.get("active_experiment_acquisition_plan"), list) else [],
        "acquisition_shadow_experiments": source.get("acquisition_shadow_experiments") if isinstance(source.get("acquisition_shadow_experiments"), list) else [],
        "acquisition_shadow_experiment_plan": source.get("acquisition_shadow_experiment_plan") if isinstance(source.get("acquisition_shadow_experiment_plan"), list) else [],
        "plain_english": source.get("plain_english"),
        "next_action": source.get("next_action"),
        "experiment_policy": source.get("experiment_policy") if isinstance(source.get("experiment_policy"), dict) else {},
        **live_false(),
    }


def _crypto_coverage_cohort_key_from_regime(regime_id: str) -> str | None:
    side_match = re.search(r"(?:^|[|:])side=(yes|no)(?:[|]|$)", regime_id)
    hour_match = re.search(r"(?:^|[|:])hour=(hour_\d{2}_\d{2})(?:[|]|$)", regime_id)
    if not side_match or not hour_match:
        return None
    return f"coverage_cohort:side={side_match.group(1)}|hour={hour_match.group(1)}"


def _crypto_coverage_probe_failure_cohort_blocks(experiments: list[Any]) -> list[dict[str, Any]]:
    cohorts: dict[str, dict[str, Any]] = {}
    for row in experiments:
        if not isinstance(row, dict) or row.get("proof_credit") != "none_forward_coverage_probe":
            continue
        regime_id = str(row.get("regime_id") or "")
        cohort = _crypto_coverage_cohort_key_from_regime(regime_id)
        if cohort is None:
            continue
        bucket = cohorts.setdefault(
            cohort,
            {
                "coverage_cohort_key": cohort,
                "resolved_count": 0,
                "loss_count": 0,
                "paper_pnl_usd": 0.0,
                "regime_ids": [],
                **live_false(),
            },
        )
        resolved = int(row.get("resolved_count") or 0)
        losses = int(row.get("losses") or 0)
        bucket["resolved_count"] += resolved
        bucket["loss_count"] += losses
        bucket["paper_pnl_usd"] = round(float(bucket["paper_pnl_usd"]) + float(row.get("paper_pnl_usd") or 0.0), 6)
        if regime_id not in bucket["regime_ids"]:
            bucket["regime_ids"].append(regime_id)
    blocks: list[dict[str, Any]] = []
    for bucket in cohorts.values():
        resolved = int(bucket.get("resolved_count") or 0)
        loss_count = int(bucket.get("loss_count") or 0)
        pnl = float(bucket.get("paper_pnl_usd") or 0.0)
        if resolved >= 3 and loss_count == resolved and pnl <= 0:
            blocks.append(
                {
                    **bucket,
                    "action": "pause_coverage_probe_cohort",
                    "reason": "Recent forward coverage probes in this side/hour cohort all lost; pause new coverage spend until a different signal repairs it.",
                    "counts_for_live_readiness": False,
                    **live_false(),
                }
            )
    return sorted(blocks, key=lambda item: str(item.get("coverage_cohort_key") or ""))


def _sts_crypto_regime_selector_outcomes_snapshot(outcomes: dict[str, Any] | None) -> dict[str, Any]:
    source = outcomes if isinstance(outcomes, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain": "crypto",
            "status": "missing",
            "experiment_count": 0,
            "resolved_attributed_count": 0,
            "experiments": [],
            "coverage_probe_failure_cohort_blocks": [],
            "next_action": "Run kalshi_sts_crypto_regime_selector_outcomes.py",
            **live_false(),
        }
    forward_recorded_experiments = source.get("forward_recorded_experiments") if isinstance(source.get("forward_recorded_experiments"), list) else []
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain": "crypto",
        "status": source.get("status"),
        "experiment_count": source.get("experiment_count"),
        "matched_row_count": source.get("matched_row_count"),
        "forward_recorded_experiment_count": source.get("forward_recorded_experiment_count"),
        "forward_recorded_matched_count": source.get("forward_recorded_matched_count"),
        "forward_recorded_resolved_count": source.get("forward_recorded_resolved_count"),
        "forward_recorded_pending_count": source.get("forward_recorded_pending_count"),
        "forward_recorded_due_pending_count": source.get("forward_recorded_due_pending_count"),
        "next_forward_result_due_utc": source.get("next_forward_result_due_utc"),
        "seconds_until_next_forward_result_due": source.get("seconds_until_next_forward_result_due"),
        "forward_recorded_pending_samples": source.get("forward_recorded_pending_samples") if isinstance(source.get("forward_recorded_pending_samples"), list) else [],
        "forward_recorded_proof_credit_counts": source.get("forward_recorded_proof_credit_counts") if isinstance(source.get("forward_recorded_proof_credit_counts"), dict) else {},
        "forward_recorded_due_proof_credit_counts": source.get("forward_recorded_due_proof_credit_counts") if isinstance(source.get("forward_recorded_due_proof_credit_counts"), dict) else {},
        "forward_recorded_coverage_probe_resolved_count": source.get("forward_recorded_coverage_probe_resolved_count"),
        "forward_recorded_coverage_probe_pending_count": source.get("forward_recorded_coverage_probe_pending_count"),
        "forward_recorded_coverage_probe_due_count": source.get("forward_recorded_coverage_probe_due_count"),
        "forward_recorded_acquisition_shadow_resolved_count": source.get("forward_recorded_acquisition_shadow_resolved_count"),
        "forward_recorded_acquisition_shadow_pending_count": source.get("forward_recorded_acquisition_shadow_pending_count"),
        "forward_recorded_acquisition_shadow_due_count": source.get("forward_recorded_acquisition_shadow_due_count"),
        "forward_recorded_inverse_repair_shadow_resolved_count": source.get("forward_recorded_inverse_repair_shadow_resolved_count"),
        "forward_recorded_inverse_repair_shadow_pending_count": source.get("forward_recorded_inverse_repair_shadow_pending_count"),
        "forward_recorded_inverse_repair_shadow_due_count": source.get("forward_recorded_inverse_repair_shadow_due_count"),
        "inverse_repair_shadow_proof_gate": source.get("inverse_repair_shadow_proof_gate") if isinstance(source.get("inverse_repair_shadow_proof_gate"), dict) else {},
        "resolver_ready": source.get("resolver_ready"),
        "resolver_safe_after_utc": source.get("resolver_safe_after_utc"),
        "resolver_readiness_reason": source.get("resolver_readiness_reason"),
        "retrospective_experiment_count": source.get("retrospective_experiment_count"),
        "retrospective_matched_count": source.get("retrospective_matched_count"),
        "retrospective_resolved_count": source.get("retrospective_resolved_count"),
        "resolved_attributed_count": source.get("resolved_attributed_count"),
        "forward_recorded_experiments": forward_recorded_experiments,
        "coverage_probe_failure_cohort_blocks": _crypto_coverage_probe_failure_cohort_blocks(forward_recorded_experiments),
        "retrospective_experiments": source.get("retrospective_experiments") if isinstance(source.get("retrospective_experiments"), list) else [],
        "top_experiment": source.get("top_experiment") if isinstance(source.get("top_experiment"), dict) else {},
        "experiments": source.get("experiments") if isinstance(source.get("experiments"), list) else [],
        "resolver_action": source.get("resolver_action"),
        "resolver_command": source.get("resolver_command"),
        "plain_english": source.get("plain_english"),
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_crypto_regime_inverse_repair_snapshot(repair: dict[str, Any] | None) -> dict[str, Any]:
    source = repair if isinstance(repair, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "status": "missing",
            "repair_count": 0,
            "repairs": [],
            "next_action": "Run kalshi_sts_crypto_regime_inverse_repair.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "scanned_forward_regime_outcome_count": source.get("scanned_forward_regime_outcome_count"),
        "scanned_abstain_repair_block_outcome_count": source.get("scanned_abstain_repair_block_outcome_count"),
        "pending_abstain_repair_block_count": source.get("pending_abstain_repair_block_count"),
        "due_pending_abstain_repair_block_count": source.get("due_pending_abstain_repair_block_count"),
        "pending_abstain_repair_block_samples": source.get("pending_abstain_repair_block_samples") if isinstance(source.get("pending_abstain_repair_block_samples"), list) else [],
        "repair_count": source.get("repair_count"),
        "action_counts": source.get("action_counts") if isinstance(source.get("action_counts"), dict) else {},
        "repairs": source.get("repairs") if isinstance(source.get("repairs"), list) else [],
        "top_repair": source.get("top_repair") if isinstance(source.get("top_repair"), dict) else {},
        "plain_english": source.get("plain_english"),
        "next_action": source.get("next_action"),
        **live_false(),
    }


def _sts_unlock_queue_snapshot(queue: dict[str, Any] | None) -> dict[str, Any]:
    source = queue if isinstance(queue, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "unlock_actions": [],
            "top_unlock_action": {},
            "next_action": "Run kalshi_sts_unlock_queue.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "paper_trading_eta_label": source.get("paper_trading_eta_label"),
        "promotion_allowed_count": source.get("promotion_allowed_count"),
        "unlock_actions": source.get("unlock_actions") if isinstance(source.get("unlock_actions"), list) else [],
        "top_unlock_action": source.get("top_unlock_action") if isinstance(source.get("top_unlock_action"), dict) else {},
        "next_action": source.get("next_action"),
        "plain_english": source.get("plain_english"),
        "domain_policy": source.get("domain_policy") if isinstance(source.get("domain_policy"), dict) else {},
        **live_false(),
    }




def _sts_crypto_fresh_cycle_snapshot(sts_crypto_fresh_cycle: dict[str, Any] | None) -> dict[str, Any]:
    source = sts_crypto_fresh_cycle if isinstance(sts_crypto_fresh_cycle, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "status": "missing",
            "next_action": "Run kalshi_sts_crypto_fresh_cycle.py",
            **live_false(),
        }
    crypto_capture = dict(source.get("crypto_capture")) if isinstance(source.get("crypto_capture"), dict) else {}
    crypto_capture.setdefault("execution_selector_attributed_count", 0)
    crypto_capture.setdefault("regime_selector_attributed_count", 0)
    crypto_capture.update(live_false())
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": source.get("mode") or "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "crypto_capture": crypto_capture,
        "fresh_sts_promotion": source.get("fresh_sts_promotion") if isinstance(source.get("fresh_sts_promotion"), dict) else {},
        "global_promotion_allowed_count": source.get("global_promotion_allowed_count"),
        "paper_eta_label": source.get("paper_eta_label"),
        "best_domain_to_improve_next": source.get("best_domain_to_improve_next") if isinstance(source.get("best_domain_to_improve_next"), dict) else {},
        "agent_audit_score": source.get("agent_audit_score"),
        "dashboard_refreshed": bool(source.get("dashboard_refreshed")),
        "next_action": source.get("next_action"),
        **live_false(),
    }

def _sts_agent_audit_snapshot(sts_agent_audit: dict[str, Any] | None) -> dict[str, Any]:
    source = sts_agent_audit if isinstance(sts_agent_audit, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "status": "missing",
            "agents": [],
            "top_recommendation": "Run kalshi_sts_agent_audit.py",
            **live_false(),
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": source.get("mode") or "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "agent_count": source.get("agent_count"),
        "functional_agent_count": source.get("functional_agent_count"),
        "average_specialization_score": source.get("average_specialization_score"),
        "agents": source.get("agents") if isinstance(source.get("agents"), list) else [],
        "critical_findings": source.get("critical_findings") if isinstance(source.get("critical_findings"), list) else [],
        "top_recommendation": source.get("top_recommendation"),
        **live_false(),
    }

def _sts_domain_optimizer_snapshot(sts_domain_optimizer: dict[str, Any] | None) -> dict[str, Any]:
    source = sts_domain_optimizer if isinstance(sts_domain_optimizer, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "domain_learning_policy": {"mode": "domain_first", "future_market_categories_separated": True, "live_order_allowed": False, "auto_live_promotion_allowed": False},
            "domain_actions": [],
            "priority_actions": [],
            "next_action": "Run kalshi_sts_domain_optimizer.py",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "domain_learning_policy": source.get("domain_learning_policy") if isinstance(source.get("domain_learning_policy"), dict) else {},
        "domain_actions": source.get("domain_actions") if isinstance(source.get("domain_actions"), list) else [],
        "domain_lanes": source.get("domain_lanes") if isinstance(source.get("domain_lanes"), list) else (source.get("domain_actions") if isinstance(source.get("domain_actions"), list) else []),
        "priority_actions": source.get("priority_actions") if isinstance(source.get("priority_actions"), list) else [],
        "best_domain_to_improve_next": source.get("best_domain_to_improve_next") if isinstance(source.get("best_domain_to_improve_next"), dict) else {},
        "next_action": source.get("next_action"),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

def _sts_readiness_eta_snapshot(sts_readiness_eta: dict[str, Any] | None) -> dict[str, Any]:
    source = sts_readiness_eta if isinstance(sts_readiness_eta, dict) else {}
    if not source:
        return {
            "ok": False,
            "mode": "PAPER_ONLY",
            "generated_at_utc": None,
            "paper_trading_eta": {
                "status": "blocked",
                "eta_label": "Waiting",
                "confidence": "low",
                "current_score": 0,
                "target_score": 100,
                "top_blocker": "Run kalshi_sts_readiness_eta.py",
                "real_data_basis": {},
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "live_review_eta": {
                "status": "blocked",
                "eta_label": "Waiting",
                "confidence": "low",
                "current_score": 0,
                "target_score": 100,
                "top_blocker": "Run kalshi_sts_readiness_eta.py",
                "real_data_basis": {},
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "plain_english": "Real-data ETA artifact is missing; run kalshi_sts_readiness_eta.py.",
            "next_action": "Run kalshi_sts_readiness_eta.py",
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    return {
        "ok": bool(source.get("ok")),
        "schema_version": source.get("schema_version"),
        "mode": "PAPER_ONLY",
        "generated_at_utc": source.get("generated_at_utc"),
        "paper_trading_eta": source.get("paper_trading_eta") if isinstance(source.get("paper_trading_eta"), dict) else {},
        "domain_paper_trading_eta": source.get("domain_paper_trading_eta") if isinstance(source.get("domain_paper_trading_eta"), dict) else {},
        "live_review_eta": source.get("live_review_eta") if isinstance(source.get("live_review_eta"), dict) else {},
        "plain_english": source.get("plain_english") or "Real-data STS ETA is available.",
        "next_action": source.get("next_action"),
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

def _plain_english_status(
    *,
    accuracy: float | None,
    pnl: float,
    scored: int,
    proof_gate: dict[str, Any],
    proof_diagnosis: dict[str, Any],
    pending_count: int,
    latest_scored_age_minutes: float | None,
    learning_velocity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    live_ready = proof_gate.get("live_review_ready") is True
    diagnosis = str(proof_diagnosis.get("diagnosis") or "not_available")
    inverse_frozen = proof_diagnosis.get("inverse_expansion_allowed") is False
    if live_ready:
        status = "review_ready"
        headline = "Paper proof is ready for human review."
        tone = "good"
    elif scored == 0:
        status = "learning_not_scored"
        headline = "OpenClaw is still gathering scoreable paper evidence."
        tone = "warn"
    elif pnl < 0 or (accuracy is not None and accuracy < 0.5):
        status = "blocked_losing_paper"
        headline = "OpenClaw is not ready for live trading because paper results are losing."
        tone = "bad"
    else:
        status = "needs_more_proof"
        headline = "OpenClaw has some positive paper evidence, but still needs proof."
        tone = "warn"

    bullets = [
        "Live trading is blocked. This page is paper-only.",
        f"{scored} accepted paper trades have known outcomes.",
        f"Paper P&L is ${pnl:.2f}.",
    ]
    if accuracy is None:
        bullets.append("Accuracy will appear after directional paper trades resolve.")
    else:
        bullets.append(f"Paper accuracy is {accuracy * 100:.1f}%.")
    if diagnosis == "historical_inverse_conflicts_with_fresh_forward_proof":
        bullets.append("The inverse idea looked good in hindsight, but fresh inverse paper tests are losing, so OpenClaw froze new inverse expansion.")
    elif inverse_frozen:
        bullets.append("OpenClaw has frozen inverse expansion until proof improves.")
    if pending_count:
        bullets.append(f"{pending_count} accepted paper trades are still waiting for outcomes.")
    velocity = learning_velocity or {}
    learning_status = str(velocity.get("status") or "")
    if learning_status == "HIGH_SPEED_LEARNING":
        bullets.append(
            f"High-speed shadow learning is active: {int(velocity.get('resolved_last_1h') or 0)} source-backed weather/crypto outcomes scored in the last hour."
        )
        if latest_scored_age_minutes is not None:
            bullets.append(f"Accepted-paper proof is still stale at {latest_scored_age_minutes:.1f} minutes old, so it stays gated.")
    elif latest_scored_age_minutes is not None:
        bullets.append(f"The latest accepted-paper proof outcome is {latest_scored_age_minutes:.1f} minutes old.")

    next_steps = [
        "Keep scoring due outcomes with source-backed evidence.",
        "Do not add live trading until a fresh forward-paper lane is profitable and beats the baselines.",
    ]
    if learning_status == "HIGH_SPEED_LEARNING":
        next_steps.insert(0, "Keep the fast weather/crypto shadow scorer running; promote only after accepted-paper proof beats baselines.")
    elif diagnosis == "historical_inverse_conflicts_with_fresh_forward_proof":
        next_steps.insert(0, "Check whether the inverse signal failed because of side mapping, settlement parsing, or non-executable opposite-side prices.")
    else:
        next_steps.insert(0, "Find one clean strategy lane with at least 100 fresh scored paper outcomes.")

    return {
        "status": status,
        "tone": tone,
        "headline": headline,
        "bullets": bullets,
        "next_steps": next_steps,
        "live_order_allowed": False,
    }


def _performance_snapshot(decisions: list[dict[str, Any]], latest_outcome_by_id: dict[str, dict[str, Any]], now: datetime) -> dict[str, Any]:
    accepted = [d for d in decisions if _is_accepted(d)]
    accepted_ids = {d.get("decision_id") for d in accepted if isinstance(d.get("decision_id"), str)}
    unresolved_accepted = [d for d in accepted if d.get("decision_id") not in latest_outcome_by_id]
    decision_counts = Counter(str(d.get("decision") or "UNKNOWN").upper() for d in decisions)
    by_strategy = Counter(str(d.get("strategy_bucket") or "unknown") for d in decisions)
    by_category = Counter(_category(d) for d in decisions)
    decisions_by_id = {d.get("decision_id"): d for d in decisions if isinstance(d.get("decision_id"), str)}

    wins = 0
    losses = 0
    total_profit = 0.0
    total_loss = 0.0
    cumulative = 0.0
    trend_points: list[dict[str, Any]] = []
    category_perf: dict[str, dict[str, Any]] = defaultdict(lambda: {"scored": 0, "wins": 0, "losses": 0, "profit": 0.0, "loss": 0.0, "pnl": 0.0})
    latest_scored_at: datetime | None = None

    for outcome in sorted(latest_outcome_by_id.values(), key=lambda o: parse_utc(o.get("settlement_checked_at_utc")) or datetime.min.replace(tzinfo=timezone.utc)):
        did = outcome.get("decision_id")
        decision = decisions_by_id.get(did)
        if decision is None or did not in accepted_ids:
            continue
        side = _side(decision)
        if side == "UNKNOWN":
            continue
        outcome_yes = int(outcome.get("outcome_yes") or 0)
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        pnl = _trade_pnl(decision, outcome)
        if won:
            wins += 1
        else:
            losses += 1
        if pnl >= 0:
            total_profit += pnl
        else:
            total_loss += abs(pnl)
        cumulative += pnl
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        if checked and (latest_scored_at is None or checked > latest_scored_at):
            latest_scored_at = checked
        cat = _category(decision)
        category_perf[cat]["scored"] += 1
        category_perf[cat]["wins" if won else "losses"] += 1
        category_perf[cat]["pnl"] = round(category_perf[cat]["pnl"] + pnl, 2)
        if pnl >= 0:
            category_perf[cat]["profit"] = round(category_perf[cat]["profit"] + pnl, 2)
        else:
            category_perf[cat]["loss"] = round(category_perf[cat]["loss"] + abs(pnl), 2)
        scored_count = wins + losses
        trend_points.append(
            {
                "timestamp_utc": decision.get("timestamp_utc"),
                "scored_at_utc": checked.isoformat().replace("+00:00", "Z") if checked else None,
                "accuracy": wins / scored_count if scored_count else None,
                "cumulative_pnl_usd": round(cumulative, 2),
                "latest_trade_pnl_usd": pnl,
                "volume": 1,
                "category": cat,
            }
        )

    scored = wins + losses
    latest_scored_age_minutes = None
    if latest_scored_at:
        latest_scored_age_minutes = round((now - latest_scored_at).total_seconds() / 60.0, 2)

    pending = [_pending_trade_record(decision) for decision in unresolved_accepted]
    pending.sort(key=lambda d: parse_utc(d.get("expected_result_known_time_utc")) or datetime.max.replace(tzinfo=timezone.utc))

    return {
        "total": len(decisions),
        "accepted": len(accepted),
        "decision_counts": decision_counts,
        "by_strategy": by_strategy,
        "by_category": by_category,
        "inverse_forward_decisions": [d for d in decisions if d.get("paper_experiment_type") == "inverse_forward_test"],
        "performance_summary": {
            "scored_accepted_trades": scored,
            "wins": wins,
            "losses": losses,
            "accuracy": wins / scored if scored else None,
            "paper_pnl_usd": round(cumulative, 2),
            "total_profit_usd": round(total_profit, 2),
            "total_loss_usd": round(total_loss, 2),
            "latest_scored_at_utc": latest_scored_at.isoformat().replace("+00:00", "Z") if latest_scored_at else None,
            "latest_scored_age_minutes": latest_scored_age_minutes,
            "trend_direction": "updating",
            "trend_points": trend_points,
            "category_accuracy": {
                cat: {
                    **stats,
                    "accuracy": stats["wins"] / stats["scored"] if stats["scored"] else None,
                }
                for cat, stats in sorted(category_perf.items())
            },
        },
        "pending": pending,
        "pending_summary": {
            "count": len(pending),
            "shown": min(50, len(pending)),
            "trades": pending[:50],
            "upcoming_count": sum(1 for p in pending if parse_utc(p.get("expected_result_known_time_utc")) and parse_utc(p.get("expected_result_known_time_utc")) > now),
            "overdue_count": sum(1 for p in pending if parse_utc(p.get("expected_result_known_time_utc")) and parse_utc(p.get("expected_result_known_time_utc")) <= now),
            "next_result_known_time_utc": pending[0].get("expected_result_known_time_utc") if pending else None,
            "total_unresolved_exposure_usd": round(sum(_money(p.get("simulated_size_usd")) for p in pending), 2),
        },
    }


def build_dashboard() -> tuple[dict[str, Any], list[str]]:
    now = datetime.now(timezone.utc)
    now_text = utc_now()
    decisions, decision_warnings = load_jsonl(PAPER_DECISIONS_PATH)
    outcomes, outcome_warnings = load_jsonl(PAPER_OUTCOMES_PATH)
    shadow_outcomes, shadow_outcome_warnings = load_jsonl(SHADOW_OUTCOMES_PATH)
    warnings = decision_warnings + outcome_warnings + shadow_outcome_warnings

    latest_outcome_by_id: dict[str, dict[str, Any]] = {}
    for outcome in outcomes:
        did = outcome.get("decision_id")
        if isinstance(did, str) and outcome.get("resolved") is True:
            latest_outcome_by_id[did] = outcome
    latest_shadow_outcome_by_id: dict[str, dict[str, Any]] = {}
    for outcome in shadow_outcomes:
        did = outcome.get("decision_id")
        if isinstance(did, str) and outcome.get("resolved") is True:
            latest_shadow_outcome_by_id[did] = outcome

    total = len(decisions)
    accepted = [d for d in decisions if _is_accepted(d)]
    inverse_forward_decisions = [d for d in decisions if d.get("paper_experiment_type") == "inverse_forward_test"]
    accepted_ids = {d.get("decision_id") for d in accepted if isinstance(d.get("decision_id"), str)}
    resolved_accepted = [d for d in accepted if d.get("decision_id") in latest_outcome_by_id]
    unresolved_accepted = [d for d in accepted if d.get("decision_id") not in latest_outcome_by_id]

    decision_counts = Counter(str(d.get("decision") or "UNKNOWN").upper() for d in decisions)
    by_strategy = Counter(str(d.get("strategy_bucket") or "unknown") for d in decisions)
    by_category = Counter(_category(d) for d in decisions)

    wins = 0
    losses = 0
    total_profit = 0.0
    total_loss = 0.0
    cumulative = 0.0
    trend_points: list[dict[str, Any]] = []
    category_perf: dict[str, dict[str, Any]] = defaultdict(lambda: {"scored": 0, "wins": 0, "losses": 0, "profit": 0.0, "loss": 0.0, "pnl": 0.0})
    latest_scored_at: datetime | None = None

    decisions_by_id = {d.get("decision_id"): d for d in decisions if isinstance(d.get("decision_id"), str)}
    for outcome in sorted(latest_outcome_by_id.values(), key=lambda o: parse_utc(o.get("settlement_checked_at_utc")) or datetime.min.replace(tzinfo=timezone.utc)):
        did = outcome.get("decision_id")
        decision = decisions_by_id.get(did)
        if decision is None or did not in accepted_ids:
            continue
        side = _side(decision)
        if side == "UNKNOWN":
            continue
        outcome_yes = int(outcome.get("outcome_yes") or 0)
        won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
        pnl = _trade_pnl(decision, outcome)
        if won:
            wins += 1
        else:
            losses += 1
        if pnl >= 0:
            total_profit += pnl
        else:
            total_loss += abs(pnl)
        cumulative += pnl
        checked = parse_utc(outcome.get("settlement_checked_at_utc"))
        if checked and (latest_scored_at is None or checked > latest_scored_at):
            latest_scored_at = checked
        cat = _category(decision)
        category_perf[cat]["scored"] += 1
        category_perf[cat]["wins" if won else "losses"] += 1
        category_perf[cat]["pnl"] = round(category_perf[cat]["pnl"] + pnl, 2)
        if pnl >= 0:
            category_perf[cat]["profit"] = round(category_perf[cat]["profit"] + pnl, 2)
        else:
            category_perf[cat]["loss"] = round(category_perf[cat]["loss"] + abs(pnl), 2)
        scored_count = wins + losses
        trend_points.append(
            {
                "timestamp_utc": decision.get("timestamp_utc"),
                "scored_at_utc": checked.isoformat().replace("+00:00", "Z") if checked else None,
                "accuracy": wins / scored_count if scored_count else None,
                "cumulative_pnl_usd": round(cumulative, 2),
                "latest_trade_pnl_usd": pnl,
                "volume": 1,
                "category": cat,
            }
        )

    scored = wins + losses
    accuracy = wins / scored if scored else None
    latest_scored_age_minutes = None
    if latest_scored_at:
        latest_scored_age_minutes = round((now - latest_scored_at).total_seconds() / 60.0, 2)

    pending = [_pending_trade_record(decision) for decision in unresolved_accepted]
    pending.sort(key=lambda d: parse_utc(d.get("expected_result_known_time_utc")) or datetime.max.replace(tzinfo=timezone.utc))

    latest_scheduled_attempt = _latest_jsonl_record(LOGS_DIR / "scheduled_learning_runs.jsonl")
    latest_scheduled = _latest_successful_scheduled_record(LOGS_DIR / "scheduled_learning_runs.jsonl")
    latest_fast_resolution = _latest_jsonl_record(LOGS_DIR / "fast_resolution_runs.jsonl")
    latest_weather = _latest_jsonl_record(LOGS_DIR / "weather_learning_runs.jsonl")
    latest_weather_candidates = _aggregate_recent_weather_candidate_runs(
        _recent_jsonl_records(LOGS_DIR / "weather_paper_candidate_runs.jsonl", now=now, window_minutes=15.0)
    ) or (_latest_jsonl_record(LOGS_DIR / "weather_paper_candidate_runs.jsonl") or {})
    latest_crypto_evidence_raw = _latest_jsonl_record(LOGS_DIR / "crypto_evidence_runs.jsonl")
    latest_usable_crypto_evidence = _latest_usable_crypto_evidence_record(LOGS_DIR / "crypto_evidence_runs.jsonl")
    crypto_readiness = _crypto_readiness_dashboard_snapshot(latest_crypto_evidence_raw if isinstance(latest_crypto_evidence_raw, dict) else {}, now=now)
    latest_crypto_evidence = _crypto_evidence_dashboard_record(latest_crypto_evidence_raw, latest_usable_crypto_evidence, now=now)
    epoch_state = _load_json_file(PAPER_EPOCH_STATE_PATH, warnings)
    strategy_state = _load_json_file(LOGS_DIR / "paper_strategy_state.json", warnings)
    baseline_scorecard = _load_json_file(LOGS_DIR / "baseline_scorecard_latest.json", warnings)
    outcome_resolution = _load_json_file(LOGS_DIR / "outcome_resolution_latest.json", warnings)
    learning_velocity = _learning_velocity_snapshot(
        outcomes,
        shadow_outcomes,
        latest_fast_resolution=latest_fast_resolution if isinstance(latest_fast_resolution, dict) else {},
        outcome_resolution=outcome_resolution,
        now=now,
    )
    forward_paper_proof = _load_json_file(LOGS_DIR / "forward_paper_proof_latest.json", warnings)
    strategy_proof_diagnosis = _load_json_file(LOGS_DIR / "strategy_proof_diagnosis_latest.json", warnings)
    inverse_failure_diagnosis = _load_json_file(LOGS_DIR / "inverse_failure_diagnosis_latest.json", warnings)
    weather_crypto_ml = _load_json_file(LOGS_DIR / "weather_crypto_ml_readiness.json", warnings)
    weather_crypto_ml_dataset = _load_json_file(LOGS_DIR / "weather_crypto_ml_dataset.json", warnings)
    weather_crypto_ml_model = _load_json_file(LOGS_DIR / "weather_crypto_ml_model.json", warnings)
    timesfm_diagnostic = _timesfm_diagnostic_snapshot(_load_json_file(TIMESFM_DIAGNOSTIC_PATH, warnings))
    mlx_diagnostic = _mlx_diagnostic_snapshot(_load_json_file(MLX_DIAGNOSTIC_PATH, warnings))
    crypto_settlement_oracle = _crypto_settlement_oracle_snapshot(_load_json_file(CRYPTO_SETTLEMENT_ORACLE_PATH, warnings))
    crypto_settlement_oracle_readiness = _crypto_settlement_oracle_readiness_snapshot(_load_json_file(CRYPTO_SETTLEMENT_ORACLE_READINESS_PATH, warnings))
    kalshi_nonlive_openclaw_runner = _kalshi_nonlive_runner_snapshot(_load_json_file(KALSHI_NONLIVE_RUNNER_SUMMARY_PATH, warnings))
    kalshi_copy_shadow = _kalshi_copy_shadow_snapshot(_load_json_file(KALSHI_COPY_SHADOW_STATUS_PATH, warnings))
    kalshi_v12_source_bottleneck = _kalshi_v12_source_bottleneck_snapshot(_load_json_file(KALSHI_V12_SOURCE_BOTTLENECK_AUDIT_PATH, warnings))
    kalshi_v13_preregistration_plan = _kalshi_v13_preregistration_snapshot(_load_json_file(KALSHI_V13_PREREGISTRATION_PLAN_PATH, warnings))
    build_gap_audit = _load_json_file(LOGS_DIR / "build_gap_audit.json", warnings)
    weather_crypto_learning_accelerator = _load_json_file(LOGS_DIR / "weather_crypto_learning_accelerator.json", warnings)
    markov_ml_coverage = _load_json_file(LOGS_DIR / "markov_ml_coverage.json", warnings)
    markov_microstructure = _load_json_file(LOGS_DIR / "markov_microstructure_latest.json", warnings)
    crypto_persistence_journal_review = _load_json_file(CRYPTO_PERSISTENCE_JOURNAL_REVIEW_PATH, warnings)
    crypto_persistence_lab = _crypto_persistence_lab_snapshot(markov_microstructure, crypto_persistence_journal_review)
    source_lag_surface_strategy = _load_json_file(LOGS_DIR / "source_lag_surface_strategy.json", warnings)
    market_telemetry = _load_json_file(LOGS_DIR / "kalshi_market_telemetry_latest.json", warnings)
    supreme_trading_strategy = _load_json_file(STS_ARTIFACT_PATH, warnings)
    weather_crypto_contract_repair = _load_json_file(LOGS_DIR / "weather_crypto_contract_repair.json", warnings)
    sts_forward_paper_promotion = _load_json_file(STS_FORWARD_PAPER_PROMOTION_PATH, warnings)
    sts_readiness_eta = _load_json_file(STS_READINESS_ETA_PATH, warnings)
    sts_domain_optimizer = _load_json_file(STS_DOMAIN_OPTIMIZER_PATH, warnings)
    sts_agent_audit = _load_json_file(STS_AGENT_AUDIT_PATH, warnings)
    sts_crypto_fresh_cycle = _load_json_file(STS_CRYPTO_FRESH_CYCLE_PATH, warnings)
    sts_crypto_fresh_window_diagnostics = _load_json_file(STS_CRYPTO_FRESH_WINDOW_DIAGNOSTICS_PATH, warnings)
    sts_crypto_baseline_calibration = _load_json_file(STS_CRYPTO_BASELINE_CALIBRATION_PATH, warnings)
    sts_crypto_probability_recalibrator = _load_json_file(STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH, warnings)
    sts_crypto_segment_edge = _load_json_file(STS_CRYPTO_SEGMENT_EDGE_PATH, warnings)
    sts_crypto_execution_realism = _load_json_file(STS_CRYPTO_EXECUTION_REALISM_PATH, warnings)
    sts_crypto_execution_selector = _load_json_file(STS_CRYPTO_EXECUTION_SELECTOR_PATH, warnings)
    sts_crypto_execution_selector_outcomes = _load_json_file(STS_CRYPTO_EXECUTION_SELECTOR_OUTCOMES_PATH, warnings)
    sts_crypto_regime_selector = _load_json_file(STS_CRYPTO_REGIME_SELECTOR_PATH, warnings)
    sts_crypto_regime_selector_outcomes = _load_json_file(STS_CRYPTO_REGIME_SELECTOR_OUTCOMES_PATH, warnings)
    sts_crypto_regime_inverse_repair = _load_json_file(STS_CRYPTO_REGIME_INVERSE_REPAIR_PATH, warnings)
    sts_domain_learning_optimizer = _load_json_file(STS_DOMAIN_LEARNING_OPTIMIZER_PATH, warnings)
    sts_weather_selector_repair = _load_json_file(STS_WEATHER_SELECTOR_REPAIR_PATH, warnings)
    sts_crypto_evidence_repair = _load_json_file(STS_CRYPTO_EVIDENCE_REPAIR_PATH, warnings)
    sts_unlock_queue = _load_json_file(STS_UNLOCK_QUEUE_PATH, warnings)
    weather_forward_evidence_capture = _load_json_file(LOGS_DIR / "weather_forward_evidence_capture_latest.json", warnings)
    sts_segment_policy_model = _load_json_file(LOGS_DIR / "sts" / "sts_segment_policy_model.json", warnings)
    weather_source_freshness = {
        k: v
        for k, v in _load_json_file(LOGS_DIR / "weather_source_freshness.json", warnings).items()
        if k != "cities"
    }
    source_fingerprint = _source_fingerprint(
        [
            PAPER_DECISIONS_PATH,
            PAPER_OUTCOMES_PATH,
            SHADOW_OUTCOMES_PATH,
            PAPER_EPOCH_STATE_PATH,
            LOGS_DIR / "scheduled_learning_runs.jsonl",
            LOGS_DIR / "fast_resolution_runs.jsonl",
            LOGS_DIR / "weather_learning_runs.jsonl",
            LOGS_DIR / "weather_paper_candidate_runs.jsonl",
            LOGS_DIR / "outcome_resolution_latest.json",
            LOGS_DIR / "forward_paper_proof_latest.json",
            LOGS_DIR / "strategy_proof_diagnosis_latest.json",
            LOGS_DIR / "inverse_failure_diagnosis_latest.json",
            LOGS_DIR / "crypto_evidence_runs.jsonl",
            LOGS_DIR / "weather_crypto_ml_readiness.json",
            LOGS_DIR / "weather_crypto_ml_dataset.json",
            LOGS_DIR / "weather_crypto_ml_model.json",
            TIMESFM_DIAGNOSTIC_PATH,
            MLX_DIAGNOSTIC_PATH,
            LOGS_DIR / "build_gap_audit.json",
            LOGS_DIR / "weather_crypto_learning_accelerator.json",
            LOGS_DIR / "markov_microstructure_latest.json",
            CRYPTO_PERSISTENCE_JOURNAL_REVIEW_PATH,
            LOGS_DIR / "source_lag_surface_strategy.json",
            LOGS_DIR / "kalshi_market_telemetry_latest.json",
            LOGS_DIR / "kalshi_market_snapshots.jsonl",
            LOGS_DIR / "kalshi_price_paths.jsonl",
            LOGS_DIR / "kalshi_candidate_universe.jsonl",
            LOGS_DIR / "kalshi_ladder_surfaces.jsonl",
            STS_ARTIFACT_PATH,
            STS_FEATURE_SUMMARY_PATH,
            STS_FORWARD_PAPER_PROMOTION_PATH,
            STS_READINESS_ETA_PATH,
            STS_DOMAIN_OPTIMIZER_PATH,
            STS_AGENT_AUDIT_PATH,
            STS_CRYPTO_FRESH_CYCLE_PATH,
            STS_CRYPTO_FRESH_WINDOW_DIAGNOSTICS_PATH,
            STS_CRYPTO_BASELINE_CALIBRATION_PATH,
            STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH,
            STS_CRYPTO_SEGMENT_EDGE_PATH,
            STS_CRYPTO_EXECUTION_REALISM_PATH,
            STS_CRYPTO_EXECUTION_SELECTOR_PATH,
            STS_CRYPTO_EXECUTION_SELECTOR_OUTCOMES_PATH,
            STS_CRYPTO_REGIME_SELECTOR_PATH,
            STS_CRYPTO_REGIME_SELECTOR_OUTCOMES_PATH,
            STS_CRYPTO_REGIME_INVERSE_REPAIR_PATH,
            STS_DOMAIN_LEARNING_OPTIMIZER_PATH,
            STS_WEATHER_SELECTOR_REPAIR_PATH,
            STS_CRYPTO_EVIDENCE_REPAIR_PATH,
            STS_UNLOCK_QUEUE_PATH,
            STS_MODEL_PATH,
            STS_BACKTEST_PATH,
            STS_EXPERIMENTS_PATH,
            STS_OBSERVABILITY_PATH,
        ]
    )
    all_time_snapshot = _performance_snapshot(decisions, latest_outcome_by_id, now)
    epoch_started_at = parse_utc(epoch_state.get("started_at_utc"))
    if epoch_state and epoch_started_at is None:
        warnings.append("paper_epoch_state.json has no parseable started_at_utc; dashboard is using all-time metrics as the active epoch")
    active_decisions = [d for d in decisions if (parse_utc(d.get("timestamp_utc")) or datetime.min.replace(tzinfo=timezone.utc)) >= epoch_started_at] if epoch_started_at else decisions
    active_snapshot = _performance_snapshot(active_decisions, latest_outcome_by_id, now)
    active_perf = active_snapshot["performance_summary"]
    all_time_perf = all_time_snapshot["performance_summary"]
    active_pending = dict(active_snapshot["pending_summary"])
    recent_paper_bet_records = sorted(
        [_recent_paper_bet_record(decision, latest_outcome_by_id) for decision in decisions if _is_accepted(decision)],
        key=lambda record: parse_utc(record.get("timestamp_utc")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    recent_paper_bet_shown = recent_paper_bet_records[:50]
    recent_resolved_paper_bets = sorted(
        [record for record in recent_paper_bet_records if record.get("outcome_status") == "resolved"],
        key=lambda record: parse_utc(record.get("settlement_checked_at_utc")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    active_timeframe_performance, active_timeframe_activity = _timeframe_metrics(active_decisions, latest_outcome_by_id, now)
    active_all_performance = _scored_performance_record(active_decisions, latest_outcome_by_id, label="All time")
    active_segments = _segment_records(active_decisions, latest_outcome_by_id)
    scored_active_segments = [segment for segment in active_segments if int(segment.get("scored") or 0) > 0]
    active_perf["best_segment"] = max(scored_active_segments, key=lambda segment: float(segment.get("simulated_pnl_usd") or 0.0), default=None)
    active_perf["worst_segment"] = min(scored_active_segments, key=lambda segment: float(segment.get("simulated_pnl_usd") or 0.0), default=None)
    active_perf["latest_scored_age_minutes"] = _age_minutes(active_perf.get("latest_scored_at_utc"), now)
    all_time_perf["latest_scored_age_minutes"] = _age_minutes(all_time_perf.get("latest_scored_at_utc"), now)
    pending_timing_buckets = Counter()
    for pending_trade in active_snapshot["pending"]:
        expected = parse_utc(pending_trade.get("expected_result_known_time_utc"))
        if expected is None:
            pending_timing_buckets["unknown"] += 1
        elif expected <= now:
            pending_timing_buckets["overdue"] += 1
        elif expected <= now + timedelta(hours=24):
            pending_timing_buckets["due_24h"] += 1
        else:
            pending_timing_buckets["future_24h_plus"] += 1
    active_scored = int(active_all_performance["scored_decisions"])
    active_pnl = float(active_all_performance["net_pnl_usd"] or 0.0)
    active_accepted = int(active_snapshot["accepted"])
    active_total = int(active_snapshot["total"])
    active_accepted_rate = active_accepted / active_total if active_total else 0.0
    active_exploration_count = sum(1 for d in active_decisions if d.get("paper_exploration") is True or str(d.get("decision") or "").upper().startswith("PAPER_EXPLORE"))
    active_forward_count = sum(1 for d in active_decisions if d.get("evidence_tier") == "forward_paper" or str(d.get("decision") or "").upper() == "INVERSE_FORWARD_TEST")
    active_self_metrics = {
        "scope": "current_epoch" if epoch_state else "all_time",
        "total_decisions": active_total,
        "total_paper_decisions": active_total,
        "accepted_paper_decisions": active_accepted,
        "decision_acceptance_rate": active_accepted_rate,
        "scored_decisions": active_scored,
        "scored_directional_decisions": active_scored,
        "accuracy": active_all_performance["accuracy"],
        "accuracy_wins": active_all_performance["wins"],
        "accuracy_sample_size": active_scored,
        "brier_score": None,
        "missing_outcome_rate": len(active_snapshot["pending"]) / active_accepted if active_accepted else 0.0,
        "simulated_pnl": active_pnl,
        "simulated_roi": round(active_pnl / 1000.0, 6),
        "realized_paper_pnl_all_time_usd": active_pnl,
        "realized_paper_pnl_last_24h_usd": active_timeframe_performance["24h"]["net_pnl_usd"],
        "realized_paper_pnl_last_7d_usd": active_timeframe_performance["7d"]["net_pnl_usd"],
        "total_profit_usd": active_all_performance["total_profit_usd"],
        "total_loss_usd": active_all_performance["total_loss_usd"],
        "average_pnl_per_scored_trade_usd": round(active_pnl / active_scored, 4) if active_scored else None,
        "latest_scored_decision_utc": active_all_performance["latest_scored_decision_utc"],
        "latest_scored_outcome_utc": active_all_performance["latest_scored_outcome_utc"],
        "scored_decisions_last_1h": active_timeframe_performance["1h"]["scored_decisions"],
        "scored_decisions_last_6h": active_timeframe_performance["6h"]["scored_decisions"],
        "scored_decisions_last_24h": active_timeframe_performance["24h"]["scored_decisions"],
        "paper_performance_by_timeframe": active_timeframe_performance,
        "paper_activity_by_timeframe": active_timeframe_activity,
        "exploration_paper_decisions": active_exploration_count,
        "forward_paper_decisions": active_forward_count,
        "unresolved_paper_exposure_usd": active_pending.get("total_unresolved_exposure_usd", 0.0),
        "fair_value_source_performance": {
            source: {"decisions": count, "scored": 0}
            for source, count in Counter(str(d.get("fair_value_source_type") or "unknown") for d in active_decisions).items()
        },
    }
    active_volume_metrics = {
        "scope": "current_epoch" if epoch_state else "all_time",
        "total_decisions": active_total,
        "accepted_decisions": active_accepted,
        "exploration_decisions": active_exploration_count,
        "forward_paper_decisions": active_forward_count,
        "resolved_outcomes": active_scored,
        "unresolved_accepted_decisions": len(active_snapshot["pending"]),
        "outcome_backlog": len(active_snapshot["pending"]),
        "pending_resolution_buckets": dict(pending_timing_buckets),
        "pending_fast_resolution_count": pending_timing_buckets["overdue"] + pending_timing_buckets["due_24h"],
        "pending_slow_or_unknown_count": pending_timing_buckets["unknown"] + pending_timing_buckets["future_24h_plus"],
        "unknown_timing_pending_count": pending_timing_buckets["unknown"],
        "accepted_rate": active_accepted_rate,
        "exploration_rate": active_exploration_count / active_accepted if active_accepted else 0.0,
        "resolved_rate": active_scored / active_accepted if active_accepted else 0.0,
        "accepted_to_resolved_conversion_rate": active_scored / active_accepted if active_accepted else 0.0,
        "resolved_accepted_outcomes_per_day": active_timeframe_performance["24h"]["scored_decisions"],
        "no_trade_rate": active_snapshot["decision_counts"].get("NO_TRADE", 0) / active_total if active_total else 0.0,
        "rejection_rate": active_snapshot["decision_counts"].get("REJECT", 0) / active_total if active_total else 0.0,
        "unique_domains": len(active_snapshot["by_category"]),
        "unique_segments": len(active_segments),
        "latest_scored_outcome_age_minutes": active_perf.get("latest_scored_age_minutes"),
        "latest_learning_outcome_age_minutes": learning_velocity.get("latest_learning_age_minutes"),
        "shadow_learning_resolved_last_1h": learning_velocity.get("shadow_resolved_last_1h"),
        "learning_resolved_last_1h": learning_velocity.get("resolved_last_1h"),
        "current_learning_bottleneck": "waiting_for_current_epoch_outcomes" if active_scored == 0 else ("negative_current_epoch_pnl" if active_pnl < 0 else "collect_more_forward_paper_proof"),
        "what_must_happen_next_to_learn_faster": "Score the current Inverse Standard Strategy paper trades as soon as their source-backed outcomes are known." if active_scored == 0 else "Keep routing accepted paper toward profitable, baseline-beating current-epoch segments.",
        "estimated_cycles_to_100_accepted": max(0, math.ceil((100 - active_accepted) / 5)) if active_accepted < 100 else 0,
        "clean_accepted_paper_decisions": active_accepted,
        "clean_resolved_paper_decisions": active_scored,
        "clean_accepted_to_resolved_rate": active_scored / active_accepted if active_accepted else 0.0,
        "clean_total_profit_usd": active_all_performance["total_profit_usd"],
        "clean_total_loss_usd": active_all_performance["total_loss_usd"],
        "clean_net_pnl_usd": active_pnl,
        "clean_profitable_evidence_rate": active_all_performance["wins"] / active_scored if active_scored else 0.0,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }
    previous = _load_previous()
    previous_weather_audit = previous.get("weather_model_audit") if isinstance(previous.get("weather_model_audit"), dict) else {}
    latest_inverse_audit = _latest_jsonl_record(LOGS_DIR / "inverse_strategy_audit.jsonl")
    previous_inverse_audit = _normalize_inverse_audit(
        latest_inverse_audit
        if isinstance(latest_inverse_audit, dict)
        else previous.get("inverse_strategy_audit")
        if isinstance(previous.get("inverse_strategy_audit"), dict)
        else {}
    )
    active_weather_audit = _weather_model_audit(
        active_decisions,
        latest_outcome_by_id,
        now_text=now_text,
        weather_source_freshness=weather_source_freshness,
        previous_weather_audit=previous_weather_audit,
    )
    previous_scorecard = previous.get("strategy_scorecard") if isinstance(previous.get("strategy_scorecard"), dict) else {}
    previous_accelerator = previous.get("accelerator") if isinstance(previous.get("accelerator"), dict) else {}
    weather_lane = _weather_lane_dashboard_snapshot(
        previous_accelerator.get("weather_lane") if isinstance(previous_accelerator.get("weather_lane"), dict) else {},
        latest_weather if isinstance(latest_weather, dict) else {},
        latest_weather_candidates if isinstance(latest_weather_candidates, dict) else {},
        now=now,
    )
    active_paused_segments = sum(1 for segment in active_segments if segment.get("status") == "paused")
    standard_shadow_categories = strategy_state.get("blocked_current_side_categories", [])
    standard_shadow_category_count = len(standard_shadow_categories) if isinstance(standard_shadow_categories, list) else 0
    active_scorecard = {
        **previous_scorecard,
        "scorecard_id": f"active-{source_fingerprint['sha256'][:16]}",
        "scope": "current_epoch" if epoch_state else "all_time",
        "summary": {
            "total_decisions": active_total,
            "accepted_decisions": active_accepted,
            "scored_accepted_decisions": active_scored,
            "accuracy": active_all_performance["accuracy"],
            "realized_pnl_usd": active_pnl,
            "paused_segments": active_paused_segments,
            "active_paused_segments": active_paused_segments,
            "standard_shadow_control_categories": standard_shadow_category_count,
            "forward_paper_candidates": sum(1 for segment in active_segments if segment.get("status") == "forward_paper_candidate"),
            "live_review_candidates": 0,
            "negative_transfer_blocked_segments": 0,
        },
        "trend": {
            "x_axis": "current epoch scored paper trades over time",
            "y_axis_left": "accuracy",
            "y_axis_right": "cumulative paper P&L",
            "points": active_all_performance["trend_points"],
        },
        "segments": active_segments,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }
    strategy_comparison = _strategy_comparison(active_decisions, latest_outcome_by_id, previous_inverse_audit)
    strategy_weighting = _strategy_weighting(
        active_decisions,
        latest_outcome_by_id,
        latest_shadow_outcome_by_id,
        weather_crypto_ml_dataset=weather_crypto_ml_dataset,
        learning_velocity=learning_velocity,
    )
    trade_tracking = _trade_tracking_contract(
        active_decisions,
        latest_outcome_by_id,
        latest_shadow_outcome_by_id,
        weather_crypto_ml_dataset=weather_crypto_ml_dataset,
        weather_forward_evidence_capture=weather_forward_evidence_capture,
        sts_forward_paper_promotion=sts_forward_paper_promotion,
    )
    sts_trading_dashboard = _sts_trading_dashboard_snapshot(
        supreme_trading_strategy=supreme_trading_strategy,
        decisions=active_decisions,
        outcomes=outcomes,
        now_text=now_text,
        markov_feature_coverage=markov_ml_coverage,
        weather_crypto_contract_repair=weather_crypto_contract_repair,
        sts_segment_policy_model=sts_segment_policy_model,
        weather_crypto_ml_dataset=weather_crypto_ml_dataset,
        weather_forward_evidence_capture=weather_forward_evidence_capture,
        sts_forward_paper_promotion=sts_forward_paper_promotion,
    )
    sts_trading_dashboard["timesfm_policy"] = _timesfm_sts_policy(timesfm_diagnostic)
    paper_trade_accelerator = _paper_trade_accelerator(
        active_decisions,
        weather_crypto_ml_dataset=weather_crypto_ml_dataset,
        learning_velocity=learning_velocity,
        crypto_readiness=crypto_readiness,
        weather_source_freshness=weather_source_freshness,
        strategy_weighting=strategy_weighting,
        sts_learning_controls=sts_trading_dashboard.get("learning_controls", {}),
    )
    previous_roadmap = previous.get("sts_readiness_roadmap") if isinstance(previous.get("sts_readiness_roadmap"), dict) else {}
    sts_readiness_roadmap = _sts_readiness_roadmap_snapshot(
        supreme_trading_strategy=supreme_trading_strategy,
        sts_trading_dashboard=sts_trading_dashboard,
        previous_roadmap=previous_roadmap,
        now_text=now_text,
    )
    kalshi_control_surface = _kalshi_control_surface_snapshot(
        sts_readiness_roadmap=sts_readiness_roadmap,
        warnings=warnings,
    )
    gap01_forward_proof = _gap01_forward_proof_status(active_decisions, latest_outcome_by_id, now=now)
    accepted_forward_rate_windows = _accepted_forward_paper_rate_windows(active_decisions, latest_outcome_by_id, now=now)
    accepted_forward_candidate_quality = _accepted_forward_candidate_quality(active_decisions, latest_outcome_by_id)
    build_gap_audit_dashboard = _build_gap_audit_dashboard_snapshot(build_gap_audit)
    milestone_countdown = _milestone_countdown_snapshot(
        gap01_forward_proof=gap01_forward_proof,
        active_perf=active_perf,
        learning_velocity=learning_velocity,
        weather_crypto_ml=weather_crypto_ml,
        crypto_evidence=crypto_readiness,
        source_lag_surface_strategy=source_lag_surface_strategy,
        weather_source_freshness=weather_source_freshness,
        now_text=now_text,
        accepted_forward_rate_windows=accepted_forward_rate_windows,
        accepted_forward_candidate_quality=accepted_forward_candidate_quality,
    )
    unresolved_reason_counts = (
        outcome_resolution.get("unresolved_reason_counts")
        if isinstance(outcome_resolution.get("unresolved_reason_counts"), dict)
        else {}
    )
    official_result_unavailable_count = sum(
        int(value)
        for reason, value in unresolved_reason_counts.items()
        if str(reason).startswith("official_result_unavailable_status_") and isinstance(value, int)
    )
    proof_gate = forward_paper_proof.get("proof_gate") if isinstance(forward_paper_proof.get("proof_gate"), dict) else {}
    plain_english = _plain_english_status(
        accuracy=active_perf.get("accuracy"),
        pnl=float(active_perf.get("paper_pnl_usd") or 0.0),
        scored=int(active_perf.get("scored_accepted_trades") or 0),
        proof_gate=proof_gate,
        proof_diagnosis=strategy_proof_diagnosis,
        pending_count=int(active_pending.get("count") or 0),
        latest_scored_age_minutes=active_perf.get("latest_scored_age_minutes"),
        learning_velocity=learning_velocity,
    )
    if epoch_state:
        plain_english["bullets"].insert(
            1,
            f"Current dashboard metrics start at {epoch_state.get('started_at_utc')} for {epoch_state.get('epoch_name', 'the current paper epoch')}. Older data is preserved as the baseline.",
        )
        plain_english["bullets"].insert(2, f"Primary paper strategy is {str(epoch_state.get('primary_paper_strategy') or 'unknown').replace('_', '-')} for this epoch.")

    dashboard = dict(previous)
    dashboard.update(
        {
            "generated_at_utc": now_text,
            "mode": READ_ONLY_MODE,
            "live_order_allowed": False,
            "auto_apply_allowed": False,
            "critical_failures": [],
            "warnings": warnings,
            "plain_english_status": plain_english,
            "kalshi_control_surface": kalshi_control_surface,
            "epoch": {
                **epoch_state,
                "ok": bool(epoch_state.get("ok")) if epoch_state else False,
                "active_metrics_scope": "current_epoch" if epoch_state else "all_time",
                "active_decisions": active_snapshot["total"],
                "all_time_decisions_preserved": all_time_snapshot["total"],
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "log_counts": {
                "paper_decisions": len(decisions),
                "paper_outcomes": len(outcomes),
                "shadow_outcomes": len(shadow_outcomes),
                "scheduled_learning_runs": sum(1 for _ in (LOGS_DIR / "scheduled_learning_runs.jsonl").open("r", encoding="utf-8")) if (LOGS_DIR / "scheduled_learning_runs.jsonl").exists() else 0,
                "fast_resolution_runs": sum(1 for _ in (LOGS_DIR / "fast_resolution_runs.jsonl").open("r", encoding="utf-8")) if (LOGS_DIR / "fast_resolution_runs.jsonl").exists() else 0,
                "weather_learning_runs": sum(1 for _ in (LOGS_DIR / "weather_learning_runs.jsonl").open("r", encoding="utf-8")) if (LOGS_DIR / "weather_learning_runs.jsonl").exists() else 0,
            },
            "learning_velocity": learning_velocity,
            "completion_grade": build_gap_audit_dashboard.get("completion_grade"),
            "build_gap_audit": build_gap_audit_dashboard,
            "gap01_forward_proof": gap01_forward_proof,
            "milestone_countdown": milestone_countdown,
            "countdown_health": milestone_countdown.get("countdown_health") if isinstance(milestone_countdown.get("countdown_health"), dict) else {},
            "dashboard_cache": {
                "cache_hit": False,
                "cache_version": "refresh_hardened_v1",
                "refreshed_at_utc": now_text,
                "generated_age_minutes": 0.0,
                "source_fingerprint": source_fingerprint,
            },
            "data_quality": {
                "generated_age_minutes": 0.0,
                "latest_scored_age_minutes": active_perf.get("latest_scored_age_minutes"),
                "latest_accepted_proof_age_minutes": learning_velocity.get("latest_accepted_proof_age_minutes"),
                "latest_shadow_learning_age_minutes": learning_velocity.get("latest_shadow_learning_age_minutes"),
                "latest_any_scored_age_minutes": learning_velocity.get("latest_learning_age_minutes"),
                "learning_status": learning_velocity.get("status"),
                "learning_resolved_last_1h": learning_velocity.get("resolved_last_1h"),
                "latest_scheduled_age_minutes": _age_minutes(latest_scheduled.get("completed_at_utc"), now) if isinstance(latest_scheduled, dict) else None,
                "latest_weather_age_minutes": _age_minutes(latest_weather.get("completed_at_utc"), now) if isinstance(latest_weather, dict) else None,
                "latest_fast_resolution_age_minutes": _age_minutes(latest_fast_resolution.get("timestamp_utc"), now) if isinstance(latest_fast_resolution, dict) else None,
                "latest_scheduled_completed_at_utc": latest_scheduled.get("completed_at_utc") if isinstance(latest_scheduled, dict) else None,
                "latest_scheduled_attempt_completed_at_utc": latest_scheduled_attempt.get("completed_at_utc") if isinstance(latest_scheduled_attempt, dict) else None,
                "latest_scheduled_attempt_status": latest_scheduled_attempt.get("status") if isinstance(latest_scheduled_attempt, dict) else None,
                "latest_fast_resolution_timestamp_utc": latest_fast_resolution.get("timestamp_utc") if isinstance(latest_fast_resolution, dict) else None,
                "latest_fast_resolution_status": latest_fast_resolution.get("status") if isinstance(latest_fast_resolution, dict) else None,
                "latest_fast_resolution_ok": latest_fast_resolution.get("ok") if isinstance(latest_fast_resolution, dict) else None,
                "latest_fast_resolution_current_epoch_resolved_count": latest_fast_resolution.get("current_epoch_resolved_count") if isinstance(latest_fast_resolution, dict) else None,
                "latest_fast_resolution_skipped_not_due_count": latest_fast_resolution.get("skipped_not_due_count") if isinstance(latest_fast_resolution, dict) else None,
                "latest_fast_resolution_next_due_candidate_time_utc": latest_fast_resolution.get("next_due_candidate_time_utc") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("next_due_candidate_time_utc") if isinstance(outcome_resolution, dict) else None,
                "latest_fast_resolution_next_due_weather_crypto_candidate_time_utc": latest_fast_resolution.get("next_due_weather_crypto_candidate_time_utc") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("next_due_weather_crypto_candidate_time_utc") if isinstance(outcome_resolution, dict) else None,
                "latest_fast_resolution_next_due_crypto_candidate_time_utc": latest_fast_resolution.get("next_due_crypto_candidate_time_utc") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("next_due_crypto_candidate_time_utc") if isinstance(outcome_resolution, dict) else None,
                "latest_fast_resolution_seconds_until_next_due_crypto_candidate": latest_fast_resolution.get("seconds_until_next_due_crypto_candidate") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("seconds_until_next_due_crypto_candidate") if isinstance(outcome_resolution, dict) else None,
                "latest_weather_completed_at_utc": latest_weather.get("completed_at_utc") if isinstance(latest_weather, dict) else None,
                "stale": False,
                "warnings": warnings,
            },
            "paper": {
                "ok": True,
                "scope": "current_epoch" if epoch_state else "all_time",
                "total_decisions": active_snapshot["total"],
                "accepted": active_snapshot["accepted"],
                "rejected": active_snapshot["decision_counts"].get("REJECT", 0),
                "no_trade": active_snapshot["decision_counts"].get("NO_TRADE", 0),
                "errors": active_snapshot["decision_counts"].get("ERROR", 0),
                "exploration": sum(1 for d in active_decisions if d.get("paper_exploration") is True or str(d.get("decision") or "").upper().startswith("PAPER_EXPLORE")),
                "forward_paper": sum(1 for d in active_decisions if d.get("evidence_tier") == "forward_paper" or str(d.get("decision") or "").upper() == "INVERSE_FORWARD_TEST"),
                "route_mix": _route_mix_by_domain(active_decisions).get("overall", {}),
                "inverse_forward_tests": len(active_snapshot["inverse_forward_decisions"]),
                "by_strategy": dict(active_snapshot["by_strategy"]),
                "by_category": dict(active_snapshot["by_category"]),
                "critical_failures": [],
                "missing_fields": [],
                "warnings": warnings,
            },
            "self_improvement": {
                **(previous.get("self_improvement") if isinstance(previous.get("self_improvement"), dict) else {}),
                "metrics_scope": "current_epoch" if epoch_state else "all_time",
                "metrics": active_self_metrics,
                "live_order_allowed": False,
                "auto_apply_allowed": False,
            },
            "strategy_scorecard": active_scorecard,
            "inverse_strategy_audit": previous_inverse_audit,
            "strategy_comparison": strategy_comparison,
            "strategy_weighting": strategy_weighting,
            "trade_tracking": trade_tracking,
            "supreme_trading_strategy": _supreme_trading_strategy_snapshot(supreme_trading_strategy),
            "sts_trading_dashboard": sts_trading_dashboard,
            "timesfm_diagnostic": timesfm_diagnostic,
            "sts_readiness_roadmap": sts_readiness_roadmap,
            "sts_readiness_eta": _sts_readiness_eta_snapshot(sts_readiness_eta),
            "sts_domain_optimizer": _sts_domain_optimizer_snapshot(sts_domain_optimizer),
            "sts_agent_audit": _sts_agent_audit_snapshot(sts_agent_audit),
            "sts_crypto_fresh_cycle": _sts_crypto_fresh_cycle_snapshot(sts_crypto_fresh_cycle),
            "sts_crypto_fresh_window_diagnostics": _sts_crypto_fresh_window_diagnostics_snapshot(sts_crypto_fresh_window_diagnostics),
            "sts_crypto_baseline_calibration": _sts_crypto_baseline_calibration_snapshot(sts_crypto_baseline_calibration),
            "sts_crypto_probability_recalibrator": _sts_crypto_probability_recalibrator_snapshot(sts_crypto_probability_recalibrator),
            "sts_crypto_segment_edge": _sts_crypto_segment_edge_snapshot(sts_crypto_segment_edge),
            "sts_crypto_execution_realism": _sts_crypto_execution_realism_snapshot(sts_crypto_execution_realism),
            "sts_crypto_execution_selector": _sts_crypto_execution_selector_snapshot(sts_crypto_execution_selector),
            "sts_crypto_execution_selector_outcomes": _sts_crypto_execution_selector_outcomes_snapshot(sts_crypto_execution_selector_outcomes),
            "sts_crypto_regime_selector": _sts_crypto_regime_selector_snapshot(sts_crypto_regime_selector),
            "sts_crypto_regime_selector_outcomes": _sts_crypto_regime_selector_outcomes_snapshot(sts_crypto_regime_selector_outcomes),
            "sts_crypto_regime_inverse_repair": _sts_crypto_regime_inverse_repair_snapshot(sts_crypto_regime_inverse_repair),
            "sts_domain_learning_optimizer": _sts_domain_learning_optimizer_snapshot(sts_domain_learning_optimizer),
            "sts_weather_selector_repair": _sts_weather_selector_repair_snapshot(sts_weather_selector_repair),
            "sts_crypto_evidence_repair": _sts_crypto_evidence_repair_snapshot(sts_crypto_evidence_repair),
            "sts_unlock_queue": _sts_unlock_queue_snapshot(sts_unlock_queue),
            "weather_crypto_contract_repair": weather_crypto_contract_repair,
            "weather_forward_evidence_capture": weather_forward_evidence_capture,
            "sts_segment_policy_model": sts_segment_policy_model,
            "market_telemetry": {
                "ok": bool(market_telemetry.get("ok")),
                "schema_version": market_telemetry.get("schema_version"),
                "timestamp_utc": market_telemetry.get("timestamp_utc"),
                "selected_decision_count": market_telemetry.get("selected_decision_count", 0),
                "snapshot_count": market_telemetry.get("snapshot_count", 0),
                "price_path_count": market_telemetry.get("price_path_count", 0),
                "candidate_universe_count": market_telemetry.get("candidate_universe_count", 0),
                "ladder_surface_count": market_telemetry.get("ladder_surface_count", 0),
                "orderbook_fetch_failed_count": market_telemetry.get("orderbook_fetch_failed_count", 0),
                "weak_price_path_labels_count": market_telemetry.get("weak_price_path_labels_count", 0),
                "counts_for_live_readiness": False,
                "by_domain": market_telemetry.get("by_domain") if isinstance(market_telemetry.get("by_domain"), dict) else {},
                "candidate_action_counts": market_telemetry.get("candidate_action_counts") if isinstance(market_telemetry.get("candidate_action_counts"), dict) else {},
                "snapshot_logs": market_telemetry.get("snapshot_logs") if isinstance(market_telemetry.get("snapshot_logs"), dict) else {},
                "plain_english": market_telemetry.get("plain_english") or "Market telemetry has not run yet.",
                "warnings": market_telemetry.get("warnings") if isinstance(market_telemetry.get("warnings"), list) else [],
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "paper_trade_accelerator": paper_trade_accelerator,
            "crypto_evidence": {
                "ok": bool(latest_crypto_evidence.get("timestamp_utc")) if isinstance(latest_crypto_evidence, dict) else False,
                "timestamp_utc": latest_crypto_evidence.get("timestamp_utc") if isinstance(latest_crypto_evidence, dict) else None,
                "active_crypto_markets_seen": latest_crypto_evidence.get("active_crypto_markets_seen") if isinstance(latest_crypto_evidence, dict) else 0,
                "market_source_counts": latest_crypto_evidence.get("market_source_counts") if isinstance(latest_crypto_evidence, dict) else {},
                "series_tickers_checked": latest_crypto_evidence.get("series_tickers_checked") if isinstance(latest_crypto_evidence, dict) else [],
                "crypto_readiness_status": crypto_readiness["crypto_readiness_status"],
                "next_crypto_trade_ready_check_time_utc": crypto_readiness["next_crypto_trade_ready_check_time_utc"],
                "seconds_until_next_crypto_trade_ready_check": crypto_readiness["seconds_until_next_crypto_trade_ready_check"],
                "next_crypto_learning_snapshot_check_time_utc": crypto_readiness["next_crypto_learning_snapshot_check_time_utc"],
                "seconds_until_next_crypto_learning_snapshot_check": crypto_readiness["seconds_until_next_crypto_learning_snapshot_check"],
                "next_crypto_trade_ready_unavailable_reason": crypto_readiness["next_crypto_trade_ready_unavailable_reason"],
                "last_crypto_trade_ready_check_time_utc": crypto_readiness["last_crypto_trade_ready_check_time_utc"],
                "next_crypto_learning_check_reason": crypto_readiness["next_crypto_learning_check_reason"],
                "crypto_readiness_summary": crypto_readiness["crypto_readiness_summary"],
                "parseable_crypto_markets": latest_crypto_evidence.get("parseable_crypto_markets") if isinstance(latest_crypto_evidence, dict) else 0,
                "crypto_assets_seen": latest_crypto_evidence.get("crypto_assets_seen") if isinstance(latest_crypto_evidence, dict) else {},
                "crypto_parse_blockers": latest_crypto_evidence.get("crypto_parse_blockers") if isinstance(latest_crypto_evidence, dict) else {},
                "orderbooks_checked": latest_crypto_evidence.get("orderbooks_checked") if isinstance(latest_crypto_evidence, dict) else 0,
                "spot_assets_available": latest_crypto_evidence.get("spot_assets_available") if isinstance(latest_crypto_evidence, dict) else [],
                "candidate_count": latest_crypto_evidence.get("candidate_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "inverse_repair_capture": latest_crypto_evidence.get("inverse_repair_capture") if isinstance(latest_crypto_evidence, dict) else {},
                "inverse_repair_shadow_candidate_count": latest_crypto_evidence.get("inverse_repair_shadow_candidate_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "inverse_repair_shadow_created_count": latest_crypto_evidence.get("inverse_repair_shadow_created_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "inverse_repair_shadow_primary_capture_blocker": latest_crypto_evidence.get("inverse_repair_shadow_primary_capture_blocker") if isinstance(latest_crypto_evidence, dict) else None,
                "created_count": latest_crypto_evidence.get("created_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "created_by_governor_action": latest_crypto_evidence.get("created_by_governor_action") if isinstance(latest_crypto_evidence, dict) else {},
                "created_shadow_only_count": latest_crypto_evidence.get("created_shadow_only_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "created_accepted_forward_paper_count": latest_crypto_evidence.get("created_accepted_forward_paper_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "created_governor_reason_counts": latest_crypto_evidence.get("created_governor_reason_counts") if isinstance(latest_crypto_evidence, dict) else {},
                "paper_safety_gate_summary": latest_crypto_evidence.get("paper_safety_gate_summary") if isinstance(latest_crypto_evidence, dict) else {},
                "candidate_safety_first_ranked_count": latest_crypto_evidence.get("candidate_safety_first_ranked_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "candidate_safety_first_accepted_in_cap_count": latest_crypto_evidence.get("candidate_safety_first_accepted_in_cap_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "reason_aware_crypto_acquisition": latest_crypto_evidence.get("reason_aware_crypto_acquisition") if isinstance(latest_crypto_evidence, dict) else {},
                "created_inverse_forward_test_count": latest_crypto_evidence.get("created_inverse_forward_test_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "created_segment_policy_forward_test_count": latest_crypto_evidence.get("created_segment_policy_forward_test_count") if isinstance(latest_crypto_evidence, dict) else 0,
                "learning_acceleration_policy": latest_crypto_evidence.get("learning_acceleration_policy") if isinstance(latest_crypto_evidence, dict) else {},
                "base_minimum_edge_after_costs_cents": latest_crypto_evidence.get("base_minimum_edge_after_costs_cents") if isinstance(latest_crypto_evidence, dict) else None,
                "effective_minimum_edge_after_costs_cents": latest_crypto_evidence.get("effective_minimum_edge_after_costs_cents") if isinstance(latest_crypto_evidence, dict) else None,
                "base_minimum_model_confidence_score": latest_crypto_evidence.get("base_minimum_model_confidence_score") if isinstance(latest_crypto_evidence, dict) else None,
                "effective_minimum_model_confidence_score": latest_crypto_evidence.get("effective_minimum_model_confidence_score") if isinstance(latest_crypto_evidence, dict) else None,
                "plain_english_summary": (
                    latest_crypto_evidence.get("plain_english_summary")
                    if isinstance(latest_crypto_evidence, dict)
                    else "Crypto evidence lane has not completed a scheduled run yet."
                ),
                "warnings": latest_crypto_evidence.get("warnings") if isinstance(latest_crypto_evidence, dict) else [],
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "weather_candidate_scan": {
                "ok": bool(latest_weather_candidates.get("timestamp_utc")) if isinstance(latest_weather_candidates, dict) else False,
                "timestamp_utc": latest_weather_candidates.get("timestamp_utc") if isinstance(latest_weather_candidates, dict) else None,
                "created_count": latest_weather_candidates.get("created_count") if isinstance(latest_weather_candidates, dict) else 0,
                "created_by_governor_action": latest_weather_candidates.get("created_by_governor_action") if isinstance(latest_weather_candidates, dict) and isinstance(latest_weather_candidates.get("created_by_governor_action"), dict) else {},
                "learning_acceleration_policy": latest_weather_candidates.get("learning_acceleration_policy") if isinstance(latest_weather_candidates, dict) else {},
                "base_minimum_edge_after_costs_pct": latest_weather_candidates.get("base_minimum_edge_after_costs_pct"),
                "effective_minimum_edge_after_costs_pct": latest_weather_candidates.get("effective_minimum_edge_after_costs_pct"),
                "base_minimum_model_confidence_score": latest_weather_candidates.get("base_minimum_model_confidence_score"),
                "effective_minimum_model_confidence_score": latest_weather_candidates.get("effective_minimum_model_confidence_score"),
                "baseline_comparison_reason": latest_weather_candidates.get("baseline_comparison_reason"),
                "market_source_counts": latest_weather_candidates.get("market_source_counts") if isinstance(latest_weather_candidates, dict) else {},
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "sts_policy_snapshot": {
                "timestamp_utc": now.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "weather": {
                    "policy_intensity": (latest_weather_candidates.get("learning_acceleration_policy") or {}).get("policy_intensity"),
                    "policy_reasons": (latest_weather_candidates.get("learning_acceleration_policy") or {}).get("policy_reasons"),
                    "effective_edge_threshold_multiplier": latest_weather_candidates.get("learning_acceleration_policy", {}).get("effective_edge_threshold_multiplier"),
                    "effective_model_confidence_multiplier": latest_weather_candidates.get("learning_acceleration_policy", {}).get("effective_model_confidence_multiplier"),
                    "source_loaded": (latest_weather_candidates.get("learning_acceleration_policy") or {}).get("source_loaded"),
                    "sts_artifact_path": (latest_weather_candidates.get("learning_acceleration_policy") or {}).get("sts_artifact_path"),
                    "base_minimum_edge_after_costs_pct": latest_weather_candidates.get("base_minimum_edge_after_costs_pct"),
                    "effective_minimum_edge_after_costs_pct": latest_weather_candidates.get("effective_minimum_edge_after_costs_pct"),
                    "base_minimum_model_confidence_score": latest_weather_candidates.get("base_minimum_model_confidence_score"),
                    "effective_minimum_model_confidence_score": latest_weather_candidates.get("effective_minimum_model_confidence_score"),
                },
                "crypto": {
                    "policy_intensity": (latest_crypto_evidence.get("learning_acceleration_policy") or {}).get("policy_intensity"),
                    "policy_reasons": (latest_crypto_evidence.get("learning_acceleration_policy") or {}).get("policy_reasons"),
                    "effective_edge_threshold_multiplier": (latest_crypto_evidence.get("learning_acceleration_policy") or {}).get("effective_edge_threshold_multiplier"),
                    "effective_model_confidence_multiplier": (latest_crypto_evidence.get("learning_acceleration_policy") or {}).get("effective_model_confidence_multiplier"),
                    "source_loaded": (latest_crypto_evidence.get("learning_acceleration_policy") or {}).get("source_loaded"),
                    "sts_artifact_path": (latest_crypto_evidence.get("learning_acceleration_policy") or {}).get("sts_artifact_path"),
                    "base_minimum_edge_after_costs_cents": latest_crypto_evidence.get("base_minimum_edge_after_costs_cents"),
                    "effective_minimum_edge_after_costs_cents": latest_crypto_evidence.get("effective_minimum_edge_after_costs_cents"),
                    "base_minimum_model_confidence_score": latest_crypto_evidence.get("base_minimum_model_confidence_score"),
                    "effective_minimum_model_confidence_score": latest_crypto_evidence.get("effective_minimum_model_confidence_score"),
                },
            },
            "weather_crypto_ml": {
                "status": weather_crypto_ml.get("status") or "not_generated",
                "plain_english": weather_crypto_ml.get("plain_english") or "Weather/crypto ML readiness has not generated a local artifact yet.",
                "reality_contract": weather_crypto_ml.get("reality_contract") if isinstance(weather_crypto_ml.get("reality_contract"), dict) else {},
                "model_governance": weather_crypto_ml.get("model_governance") if isinstance(weather_crypto_ml.get("model_governance"), dict) else {},
                "learning_accelerator": {
                    "ok": bool(weather_crypto_learning_accelerator.get("ok")),
                    "accelerator_version": weather_crypto_learning_accelerator.get("accelerator_version"),
                    "generated_at_utc": weather_crypto_learning_accelerator.get("generated_at_utc"),
                    "status": weather_crypto_learning_accelerator.get("status"),
                    "row_deficits": weather_crypto_learning_accelerator.get("row_deficits")
                    if isinstance(weather_crypto_learning_accelerator.get("row_deficits"), dict)
                    else {},
                    "proof_deficits": weather_crypto_learning_accelerator.get("proof_deficits")
                    if isinstance(weather_crypto_learning_accelerator.get("proof_deficits"), dict)
                    else {},
                    "resolver_priorities": weather_crypto_learning_accelerator.get("resolver_priorities")
                    if isinstance(weather_crypto_learning_accelerator.get("resolver_priorities"), dict)
                    else {},
                    "candidate_acquisition_targets": weather_crypto_learning_accelerator.get("candidate_acquisition_targets")
                    if isinstance(weather_crypto_learning_accelerator.get("candidate_acquisition_targets"), list)
                    else [],
                    "learning_speed_plan": weather_crypto_learning_accelerator.get("learning_speed_plan")
                    if isinstance(weather_crypto_learning_accelerator.get("learning_speed_plan"), list)
                    else [],
                    "next_actions": weather_crypto_learning_accelerator.get("next_actions")
                    if isinstance(weather_crypto_learning_accelerator.get("next_actions"), list)
                    else [],
                    "plain_english": weather_crypto_learning_accelerator.get("plain_english"),
                    "live_order_allowed": False,
                    "auto_live_promotion_allowed": False,
                },
                "latest_scheduled_recovery": {
                    "quarantine_recovery_summary": (
                        (latest_scheduled.get("cycle_summary") or {}).get("quarantine_recovery_summary")
                        if isinstance(latest_scheduled, dict) and isinstance(latest_scheduled.get("cycle_summary"), dict)
                        else {}
                    ),
                    "recovery_candidate_coverage": (
                        (latest_scheduled.get("cycle_summary") or {}).get("recovery_candidate_coverage")
                        if isinstance(latest_scheduled, dict) and isinstance(latest_scheduled.get("cycle_summary"), dict)
                        else {}
                    ),
                    "quarantine_recovery_retry_plan": (
                        (latest_scheduled.get("cycle_summary") or {}).get("quarantine_recovery_retry_plan")
                        if isinstance(latest_scheduled, dict) and isinstance(latest_scheduled.get("cycle_summary"), dict)
                        else {}
                    ),
                    "weather_frontier_sampling_plan": (
                        (latest_scheduled.get("cycle_summary") or {}).get("weather_frontier_sampling_plan") or {}
                        if isinstance(latest_scheduled, dict) and isinstance(latest_scheduled.get("cycle_summary"), dict)
                        else {}
                    ),
                    "weather_frontier_sampling_result": (
                        (latest_scheduled.get("cycle_summary") or {}).get("weather_frontier_sampling_result") or {}
                        if isinstance(latest_scheduled, dict) and isinstance(latest_scheduled.get("cycle_summary"), dict)
                        else {}
                    ),
                    "latest_scheduled_completed_at_utc": latest_scheduled.get("completed_at_utc") if isinstance(latest_scheduled, dict) else None,
                    "live_order_allowed": False,
                    "auto_live_promotion_allowed": False,
                },
                "ml_model": {
                    "ok": bool(weather_crypto_ml_model.get("ok")),
                    "registry_version": weather_crypto_ml_model.get("registry_version"),
                    "artifact_id": weather_crypto_ml_model.get("artifact_id"),
                    "generated_at_utc": weather_crypto_ml_model.get("generated_at_utc"),
                    "champion_model_id": weather_crypto_ml_model.get("champion_model_id"),
                    "champion_status": weather_crypto_ml_model.get("champion_status"),
                    "walk_forward_validation": weather_crypto_ml_model.get("walk_forward_validation")
                    if isinstance(weather_crypto_ml_model.get("walk_forward_validation"), dict)
                    else {},
                    "markov_microstructure_uplift": weather_crypto_ml_model.get("markov_microstructure_uplift")
                    if isinstance(weather_crypto_ml_model.get("markov_microstructure_uplift"), dict)
                    else {},
                    "counterfactual_replay": weather_crypto_ml_model.get("counterfactual_replay")
                    if isinstance(weather_crypto_ml_model.get("counterfactual_replay"), dict)
                    else {},
                    "drift_diagnostics": weather_crypto_ml_model.get("drift_diagnostics")
                    if isinstance(weather_crypto_ml_model.get("drift_diagnostics"), dict)
                    else {},
                    "edge_decay_diagnostics": weather_crypto_ml_model.get("edge_decay_diagnostics")
                    if isinstance(weather_crypto_ml_model.get("edge_decay_diagnostics"), dict)
                    else {},
                    "certification": weather_crypto_ml_model.get("certification")
                    if isinstance(weather_crypto_ml_model.get("certification"), dict)
                    else {},
                    "failure_attribution": weather_crypto_ml_model.get("failure_attribution")
                    if isinstance(weather_crypto_ml_model.get("failure_attribution"), list)
                    else [],
                    "ml_build_gap_summary": weather_crypto_ml_model.get("ml_build_gap_summary")
                    if isinstance(weather_crypto_ml_model.get("ml_build_gap_summary"), dict)
                    else {},
                    "ml_build_gaps": weather_crypto_ml_model.get("ml_build_gaps")
                    if isinstance(weather_crypto_ml_model.get("ml_build_gaps"), list)
                    else [],
                    "twenty_improvement_controls": weather_crypto_ml_model.get("twenty_improvement_controls")
                    if isinstance(weather_crypto_ml_model.get("twenty_improvement_controls"), list)
                    else [],
                    "plain_english": weather_crypto_ml_model.get("plain_english"),
                    "live_order_allowed": False,
                    "auto_live_promotion_allowed": False,
                },
                "markov_feature_coverage": markov_ml_coverage
                if isinstance(markov_ml_coverage, dict)
                else {
                    "ok": False,
                    "coverage_status": "not_generated",
                    "live_order_allowed": False,
                    "auto_live_promotion_allowed": False,
                },
                "ml_dataset": weather_crypto_ml.get("ml_dataset")
                if isinstance(weather_crypto_ml.get("ml_dataset"), dict)
                else {
                    "ok": bool(weather_crypto_ml_dataset.get("ok")),
                    "dataset_id": weather_crypto_ml_dataset.get("dataset_id"),
                    "dataset_schema_version": weather_crypto_ml_dataset.get("dataset_schema_version"),
                    "feature_schema_version": weather_crypto_ml_dataset.get("feature_schema_version"),
                    "label_schema_version": weather_crypto_ml_dataset.get("label_schema_version"),
                    "generated_at_utc": weather_crypto_ml_dataset.get("generated_at_utc"),
                    "row_count": int(weather_crypto_ml_dataset.get("row_count") or 0),
                    "domain_counts": weather_crypto_ml_dataset.get("domain_counts") if isinstance(weather_crypto_ml_dataset.get("domain_counts"), dict) else {},
                    "leakage_rejected_count": int(weather_crypto_ml_dataset.get("leakage_rejected_count") or 0),
                    "missing_feature_cutoff_count": int(weather_crypto_ml_dataset.get("missing_feature_cutoff_count") or 0),
                    "label_quality_counts": weather_crypto_ml_dataset.get("label_quality_counts") if isinstance(weather_crypto_ml_dataset.get("label_quality_counts"), dict) else {},
                    "rows_path": weather_crypto_ml_dataset.get("rows_path"),
                    "live_order_allowed": False,
                    "auto_live_promotion_allowed": False,
                },
                "domains": weather_crypto_ml.get("domains") if isinstance(weather_crypto_ml.get("domains"), dict) else {},
                "segments": weather_crypto_ml.get("segments") if isinstance(weather_crypto_ml.get("segments"), list) else [],
                "shadow_qualified_segments": weather_crypto_ml.get("shadow_qualified_segments") if isinstance(weather_crypto_ml.get("shadow_qualified_segments"), list) else [],
                **weather_crypto_ml,
                "timesfm_diagnostic": timesfm_diagnostic,
                "mlx_diagnostic": mlx_diagnostic,
                "active_learning_queue": weather_crypto_ml.get("active_learning_queue") if isinstance(weather_crypto_ml.get("active_learning_queue"), list) else [],
                "paper_betting": weather_crypto_ml.get("paper_betting")
                if isinstance(weather_crypto_ml.get("paper_betting"), dict)
                else {
                    "mode": "PAPER_ONLY",
                    "scope": "weather_crypto_only",
                    "allowed_segment_count": 0,
                    "eligible_segments": [],
                    "live_order_allowed": False,
                    "auto_live_promotion_allowed": False,
                },
                "ok": bool(weather_crypto_ml.get("ok")) if weather_crypto_ml else False,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "markov_microstructure": {
                **markov_microstructure,
                "ok": bool(markov_microstructure.get("ok")) if markov_microstructure else False,
                "status": (
                    (markov_microstructure.get("summary") or {}).get("status")
                    if isinstance(markov_microstructure.get("summary"), dict)
                    else "not_generated"
                ),
                "research_only": True,
                "not_trade_signal": True,
                "summary": markov_microstructure.get("summary") if isinstance(markov_microstructure.get("summary"), dict) else {},
                "markets": markov_microstructure.get("markets") if isinstance(markov_microstructure.get("markets"), list) else [],
                "calibration_tracking": markov_microstructure.get("calibration_tracking")
                if isinstance(markov_microstructure.get("calibration_tracking"), dict)
                else {},
                "study_reference": markov_microstructure.get("study_reference")
                if isinstance(markov_microstructure.get("study_reference"), dict)
                else {
                    "title": "The Microstructure of Wealth Transfer in Prediction Markets",
                    "author": "Jonathan Becker",
                    "url": "https://www.jbecker.dev/research/prediction-market-microstructure",
                    "dataset_summary": "72.1M Kalshi trades / $18.26B notional; used here as a microstructure prior only.",
                    "live_order_allowed": False,
                },
                "plain_english": (
                    (markov_microstructure.get("summary") or {}).get("plain_english")
                    if isinstance(markov_microstructure.get("summary"), dict)
                    else "Probability diagnostics has not generated yet. Run kalshi_markov_microstructure.py to populate this research-only risk panel."
                ),
                "warnings": markov_microstructure.get("warnings") if isinstance(markov_microstructure.get("warnings"), list) else [],
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "crypto_persistence_lab": crypto_persistence_lab,
            "mlx_diagnostic": mlx_diagnostic,
            "crypto_settlement_oracle": crypto_settlement_oracle,
            "crypto_settlement_oracle_readiness": crypto_settlement_oracle_readiness,
            "kalshi_nonlive_openclaw_runner": kalshi_nonlive_openclaw_runner,
            "kalshi_copy_shadow": kalshi_copy_shadow,
            "kalshi_v12_source_bottleneck": kalshi_v12_source_bottleneck,
            "kalshi_v13_preregistration_plan": kalshi_v13_preregistration_plan,
            "source_lag_surface_strategy": {
                **source_lag_surface_strategy,
                "ok": bool(source_lag_surface_strategy.get("ok")) if source_lag_surface_strategy else False,
                "status": (source_lag_surface_strategy.get("summary") or {}).get("status")
                if isinstance(source_lag_surface_strategy.get("summary"), dict)
                else "not_generated",
                "summary": source_lag_surface_strategy.get("summary") if isinstance(source_lag_surface_strategy.get("summary"), dict) else {},
                "nws_cli": source_lag_surface_strategy.get("nws_cli") if isinstance(source_lag_surface_strategy.get("nws_cli"), dict) else {},
                "weather": source_lag_surface_strategy.get("weather") if isinstance(source_lag_surface_strategy.get("weather"), dict) else {},
                "crypto": source_lag_surface_strategy.get("crypto") if isinstance(source_lag_surface_strategy.get("crypto"), dict) else {},
                "ranked_hypotheses": source_lag_surface_strategy.get("ranked_hypotheses")
                if isinstance(source_lag_surface_strategy.get("ranked_hypotheses"), list)
                else [],
                "blockers": source_lag_surface_strategy.get("blockers") if isinstance(source_lag_surface_strategy.get("blockers"), list) else [],
                "plain_english": source_lag_surface_strategy.get("plain_english")
                or "Source-lag selective surface artifact has not generated yet. Run kalshi_source_lag_surface_strategy.py to populate this panel.",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "performance_summary": active_perf,
            "all_time_baseline": {
                "scope": "preserved_history_before_and_after_epoch_reset",
                "paper": {
                    "total_decisions": all_time_snapshot["total"],
                    "accepted": all_time_snapshot["accepted"],
                    "rejected": all_time_snapshot["decision_counts"].get("REJECT", 0),
                    "no_trade": all_time_snapshot["decision_counts"].get("NO_TRADE", 0),
                    "errors": all_time_snapshot["decision_counts"].get("ERROR", 0),
                    "inverse_forward_tests": len(all_time_snapshot["inverse_forward_decisions"]),
                    "by_strategy": dict(all_time_snapshot["by_strategy"]),
                    "by_category": dict(all_time_snapshot["by_category"]),
                },
                "performance_summary": all_time_perf,
                "self_improvement_metrics": (previous.get("self_improvement") if isinstance(previous.get("self_improvement"), dict) else {}).get("metrics"),
                "strategy_scorecard_summary": (previous.get("strategy_scorecard") if isinstance(previous.get("strategy_scorecard"), dict) else {}).get("summary"),
                "weather_model_audit": {
                    **previous_weather_audit,
                    "scope": "preserved_all_time_baseline",
                    "is_current": False,
                    "plain_english": (
                        "This older weather audit is preserved for historical comparison only. "
                        "Use the current Weather Model Audit for active paper-strategy decisions."
                    )
                    if previous_weather_audit
                    else "No previous weather audit baseline is available.",
                    "live_order_allowed": False,
                    "auto_apply_allowed": False,
                },
                "live_order_allowed": False,
            },
            "pending_paper_trades": {
                **active_pending,
                "official_result_unavailable_count": official_result_unavailable_count,
                "latest_resolution_checked_at_utc": outcome_resolution.get("timestamp_utc"),
                "latest_resolution_checked_count": outcome_resolution.get("checked_count"),
                "latest_resolution_unresolved_reason_counts": unresolved_reason_counts,
            },
            "recent_paper_bets": {
                "scope": "preserved_all_time_recent_log",
                "count": len(recent_paper_bet_records),
                "shown": len(recent_paper_bet_shown),
                "resolved_in_shown": sum(1 for record in recent_paper_bet_shown if record.get("outcome_status") == "resolved"),
                "pending_in_shown": sum(1 for record in recent_paper_bet_shown if record.get("outcome_status") != "resolved"),
                "resolved_count": len(recent_resolved_paper_bets),
                "latest_resolved_shown": min(25, len(recent_resolved_paper_bets)),
                "trades": recent_paper_bet_shown,
                "latest_resolved_trades": recent_resolved_paper_bets[:25],
                "live_order_allowed": False,
            },
            "outcome_resolution": {
                **outcome_resolution,
                "ok": bool(outcome_resolution.get("ok")) if outcome_resolution else False,
                "live_order_allowed": False,
                "auto_apply_allowed": False,
            },
            "accelerator": {
                **previous_accelerator,
                "timestamp_utc": now_text,
                "live_order_allowed": False,
                "weather_lane": weather_lane,
                "scheduler": {
                    "scheduled_run_count": sum(1 for _ in (LOGS_DIR / "scheduled_learning_runs.jsonl").open("r", encoding="utf-8")) if (LOGS_DIR / "scheduled_learning_runs.jsonl").exists() else 0,
                    "weather_run_count": sum(1 for _ in (LOGS_DIR / "weather_learning_runs.jsonl").open("r", encoding="utf-8")) if (LOGS_DIR / "weather_learning_runs.jsonl").exists() else 0,
                    "fast_resolution_run_count": sum(1 for _ in (LOGS_DIR / "fast_resolution_runs.jsonl").open("r", encoding="utf-8")) if (LOGS_DIR / "fast_resolution_runs.jsonl").exists() else 0,
                    "latest_scheduled_completed_at_utc": latest_scheduled.get("completed_at_utc") if isinstance(latest_scheduled, dict) else None,
                    "latest_scheduled_ok": latest_scheduled.get("ok") if isinstance(latest_scheduled, dict) else None,
                    "latest_scheduled_status": latest_scheduled.get("status") if isinstance(latest_scheduled, dict) else None,
                    "latest_scheduled_attempt_status": latest_scheduled_attempt.get("status") if isinstance(latest_scheduled_attempt, dict) else None,
                    "latest_crypto_readiness": (
                        (latest_scheduled.get("cycle_summary") or {}).get("crypto_readiness")
                        if isinstance(latest_scheduled, dict) and isinstance(latest_scheduled.get("cycle_summary"), dict)
                        else {}
                    ),
                    "latest_fast_resolution_timestamp_utc": latest_fast_resolution.get("timestamp_utc") if isinstance(latest_fast_resolution, dict) else None,
                    "latest_fast_resolution_status": latest_fast_resolution.get("status") if isinstance(latest_fast_resolution, dict) else None,
                    "latest_fast_resolution_ok": latest_fast_resolution.get("ok") if isinstance(latest_fast_resolution, dict) else None,
                    "latest_fast_resolution_resolved_count": latest_fast_resolution.get("resolved_count") if isinstance(latest_fast_resolution, dict) else None,
                    "latest_fast_resolution_current_epoch_resolved_count": latest_fast_resolution.get("current_epoch_resolved_count") if isinstance(latest_fast_resolution, dict) else None,
                    "latest_fast_resolution_skipped_not_due_count": latest_fast_resolution.get("skipped_not_due_count") if isinstance(latest_fast_resolution, dict) else None,
                    "latest_fast_resolution_next_due_candidate_time_utc": latest_fast_resolution.get("next_due_candidate_time_utc") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("next_due_candidate_time_utc") if isinstance(outcome_resolution, dict) else None,
                    "latest_fast_resolution_next_due_weather_crypto_candidate_time_utc": latest_fast_resolution.get("next_due_weather_crypto_candidate_time_utc") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("next_due_weather_crypto_candidate_time_utc") if isinstance(outcome_resolution, dict) else None,
                    "latest_fast_resolution_next_due_crypto_candidate_time_utc": latest_fast_resolution.get("next_due_crypto_candidate_time_utc") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("next_due_crypto_candidate_time_utc") if isinstance(outcome_resolution, dict) else None,
                    "latest_fast_resolution_seconds_until_next_due_crypto_candidate": latest_fast_resolution.get("seconds_until_next_due_crypto_candidate") if isinstance(latest_fast_resolution, dict) else outcome_resolution.get("seconds_until_next_due_crypto_candidate") if isinstance(outcome_resolution, dict) else None,
                    "latest_weather_timestamp_utc": latest_weather.get("completed_at_utc") if isinstance(latest_weather, dict) else None,
                },
                "decision_quality": {
                    "scope": "current_epoch" if epoch_state else "all_time",
                    "total": active_snapshot["total"],
                    "accepted": active_snapshot["accepted"],
                    "rejected": active_snapshot["decision_counts"].get("REJECT", 0),
                    "no_trade": active_snapshot["decision_counts"].get("NO_TRADE", 0),
                    "error": active_snapshot["decision_counts"].get("ERROR", 0),
                    "strategy_counts": dict(active_snapshot["by_strategy"]),
                    "fair_value_source_counts": dict(Counter(str(d.get("fair_value_source_type") or "unknown") for d in active_decisions)),
                },
                "distance_to_live_readiness": {
                    "scope": "current_epoch" if epoch_state else "all_time",
                    "paper_decisions": active_snapshot["total"],
                    "paper_decisions_needed": max(0, 100 - active_snapshot["total"]),
                    "accepted_paper_decisions": active_snapshot["accepted"],
                    "resolved_outcomes": active_perf["scored_accepted_trades"],
                    "resolved_outcomes_needed": max(0, 30 - active_perf["scored_accepted_trades"]),
                    "accepted_rate": active_snapshot["accepted"] / active_snapshot["total"] if active_snapshot["total"] else 0.0,
                    "brier_score_available": active_perf["scored_accepted_trades"] > 0,
                },
            },
            "paper_volume_accelerator": {
                **(previous.get("paper_volume_accelerator") if isinstance(previous.get("paper_volume_accelerator"), dict) else {}),
                "timestamp_utc": now_text,
                "refreshed_from_dashboard_utc": now_text,
                "metrics_scope": "current_epoch" if epoch_state else "all_time",
                "metrics": {
                    **(
                        (previous.get("paper_volume_accelerator") if isinstance(previous.get("paper_volume_accelerator"), dict) else {}).get("metrics")
                        if isinstance((previous.get("paper_volume_accelerator") if isinstance(previous.get("paper_volume_accelerator"), dict) else {}).get("metrics"), dict)
                        else {}
                    ),
                    **active_volume_metrics,
                },
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "clean_evidence": {
                **(previous.get("clean_evidence") if isinstance(previous.get("clean_evidence"), dict) else {}),
                "scope": "current_epoch" if epoch_state else "all_time",
                "accepted_paper_decisions": active_snapshot["accepted"],
                "clean_resolved_paper_decisions": active_perf["scored_accepted_trades"],
                "clean_accepted_to_resolved_rate": active_perf["scored_accepted_trades"] / active_snapshot["accepted"] if active_snapshot["accepted"] else 0.0,
                "clean_total_profit_usd": active_perf["total_profit_usd"],
                "clean_total_loss_usd": active_perf["total_loss_usd"],
                "clean_net_pnl_usd": active_perf["paper_pnl_usd"],
                "live_order_allowed": False,
            },
            "profit_firewall": {
                "ok": bool(strategy_state.get("ok")) if strategy_state else False,
                "updated_at_utc": strategy_state.get("updated_at_utc"),
                "scope": strategy_state.get("scope"),
                "current_epoch_id": strategy_state.get("current_epoch_id"),
                "primary_paper_strategy": strategy_state.get("primary_paper_strategy"),
                "paper_trading_paused": strategy_state.get("paper_trading_paused", False),
                "shadow_learning_enabled": strategy_state.get("shadow_learning_enabled", True),
                "bounded_exploration_for_blocked_lanes_enabled": strategy_state.get("bounded_exploration_for_blocked_lanes_enabled", True),
                "blocked_lane_exploration_max_size_usd": strategy_state.get("blocked_lane_exploration_max_size_usd", 1.0),
                "proof_metrics_exclude_exploration": strategy_state.get("proof_metrics_exclude_exploration", True),
                "outcome_grading_never_paused": strategy_state.get("outcome_grading_never_paused", True),
                "clean_evidence_required_for_exploration": strategy_state.get("clean_evidence_required_for_exploration", True),
                "blocked_accepted_paper_categories": strategy_state.get("blocked_accepted_paper_categories", []),
                "blocked_current_side_categories": strategy_state.get("blocked_current_side_categories", []),
                "tightened_categories": strategy_state.get("tightened_categories", []),
                "forward_paper_candidate_categories": strategy_state.get("forward_paper_candidate_categories", []),
                "inverse_forward_test_categories": strategy_state.get("inverse_forward_test_categories", []),
                "model_lane_policy": strategy_state.get("model_lane_policy", {}),
                "model_lane_performance": strategy_state.get("model_lane_performance", []),
                "blocked_model_lanes": strategy_state.get("blocked_model_lanes", {}),
                "tightened_model_lanes": strategy_state.get("tightened_model_lanes", {}),
                "promoted_model_lanes": strategy_state.get("promoted_model_lanes", {}),
                "blocked_model_lane_count": len(strategy_state.get("blocked_model_lanes", {})) if isinstance(strategy_state.get("blocked_model_lanes"), dict) else 0,
                "tightened_model_lane_count": len(strategy_state.get("tightened_model_lanes", {})) if isinstance(strategy_state.get("tightened_model_lanes"), dict) else 0,
                "promoted_model_lane_count": len(strategy_state.get("promoted_model_lanes", {})) if isinstance(strategy_state.get("promoted_model_lanes"), dict) else 0,
                "plain_english_summary": strategy_state.get("plain_english_summary") or "Profit firewall has not written paper routing state yet.",
                "lanes": strategy_state.get("lanes", []),
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "inverse_forward_paper": {
                "scope": "current_epoch" if epoch_state else "all_time",
                "total_tests": len(active_snapshot["inverse_forward_decisions"]),
                "pending_tests": sum(1 for d in active_snapshot["inverse_forward_decisions"] if d.get("decision_id") not in latest_outcome_by_id),
                "scored_tests": sum(1 for d in active_snapshot["inverse_forward_decisions"] if d.get("decision_id") in latest_outcome_by_id),
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "forward_paper_proof": {
                **forward_paper_proof,
                "ok": bool(forward_paper_proof.get("ok")) if forward_paper_proof else False,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "strategy_proof_diagnosis": {
                **strategy_proof_diagnosis,
                "ok": bool(strategy_proof_diagnosis.get("ok")) if strategy_proof_diagnosis else False,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
                "auto_apply_allowed": False,
            },
            "inverse_failure_diagnosis": {
                **inverse_failure_diagnosis,
                "ok": bool(inverse_failure_diagnosis.get("ok")) if inverse_failure_diagnosis else False,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "baseline_scorecard": {
                **baseline_scorecard,
                "ok": bool(baseline_scorecard.get("ok")) if baseline_scorecard else False,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "weather_source_freshness": {
                **weather_source_freshness,
                "ok": bool(weather_source_freshness.get("ok")) if weather_source_freshness else False,
                "live_order_allowed": False,
                "auto_apply_allowed": False,
            },
            "weather_model_audit": active_weather_audit,
        }
    )
    return dashboard, warnings


def write_dashboard_html() -> None:
    DASHBOARD_HTML_PATH.parent.mkdir(parents=True, exist_ok=True)
    html = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>OpenClaw Kalshi Dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f5f5f7;
      --bg-soft: #fbfbfd;
      --surface: rgba(255, 255, 255, .82);
      --surface-strong: rgba(255, 255, 255, .96);
      --text: #1d1d1f;
      --muted: #6e6e73;
      --line: rgba(60, 60, 67, .16);
      --line-strong: rgba(60, 60, 67, .24);
      --blue: #0071e3;
      --green: #248a3d;
      --orange: #bf6a02;
      --red: #d70015;
      --purple: #7d5fff;
      --shadow: 0 18px 60px rgba(0, 0, 0, .08);
      --shadow-soft: 0 8px 28px rgba(0, 0, 0, .06);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif;
      color: var(--text);
      background: radial-gradient(circle at top left, rgba(0, 113, 227, .15), transparent 32rem), linear-gradient(180deg, #fbfbfd 0%, var(--bg) 42%, #ececf1 100%);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    button, input { font: inherit; }
    main { width: min(1180px, calc(100% - 36px)); margin: 0 auto; padding: 28px 0 48px; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: clamp(38px, 7vw, 76px); line-height: .96; letter-spacing: -.055em; margin: 0; }
    h2 { font-size: clamp(24px, 3vw, 36px); line-height: 1.05; letter-spacing: -.035em; margin-bottom: 10px; }
    h3 { font-size: 18px; letter-spacing: -.018em; margin-bottom: 8px; }
    .muted { color: var(--muted); }
    .page-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 750; letter-spacing: -.02em; }
    .mark { width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; color: white; background: linear-gradient(135deg, #0071e3, #7d5fff); box-shadow: 0 10px 24px rgba(0,113,227,.28); }
    .top-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 6px 11px; border-radius: 999px; font-size: 13px; font-weight: 750; border: 1px solid var(--line); background: var(--surface); color: var(--text); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: currentColor; }
    .pill.safe { color: var(--green); background: rgba(36, 138, 61, .09); border-color: rgba(36, 138, 61, .22); }
    .pill.bad { color: var(--red); background: rgba(215, 0, 21, .08); border-color: rgba(215, 0, 21, .2); }
    .pill.warn { color: var(--orange); background: rgba(191, 106, 2, .1); border-color: rgba(191, 106, 2, .22); }
    .hero { position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,.68); border-radius: 34px; padding: clamp(24px, 5vw, 54px); background: linear-gradient(145deg, rgba(255,255,255,.94), rgba(255,255,255,.7)); box-shadow: var(--shadow); backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); }
    .hero::after { content: ""; position: absolute; width: 520px; height: 520px; border-radius: 50%; right: -220px; top: -260px; background: radial-gradient(circle, rgba(0,113,227,.16), rgba(125,95,255,.08) 44%, transparent 70%); pointer-events: none; }
    .eyebrow { color: var(--blue); font-size: 13px; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; margin-bottom: 10px; }
    .hero-copy { position: relative; z-index: 1; max-width: 780px; }
    .hero-subtitle { margin: 18px 0 0; color: var(--muted); font-size: clamp(17px, 2vw, 22px); line-height: 1.38; letter-spacing: -.018em; }
    .hero-strip { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 28px; }
    .hero-stat { min-height: 118px; padding: 18px; border-radius: 24px; background: rgba(255,255,255,.72); border: 1px solid var(--line); box-shadow: var(--shadow-soft); }
    .hero-stat .value { margin: 8px 0 4px; font-size: clamp(28px, 4vw, 44px); line-height: 1; font-weight: 850; letter-spacing: -.045em; }
    .label { color: var(--muted); font-size: 12px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
    .jumpbar { position: sticky; top: 10px; z-index: 5; display: flex; gap: 8px; overflow-x: auto; margin: 18px 0 8px; padding: 8px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.72); box-shadow: var(--shadow-soft); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
    .jumpbar a { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 34px; padding: 0 13px; border-radius: 999px; color: var(--text); text-decoration: none; font-size: 13px; font-weight: 780; letter-spacing: -.01em; }
    .jumpbar a:hover, .jumpbar a:focus-visible { background: rgba(0,113,227,.12); color: var(--blue); outline: none; }
    .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 14px; margin: 34px 2px 14px; }
    .section-heading p { margin: 0; max-width: 560px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(225px, 1fr)); gap: 14px; }
    .flow-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
    .flow-card { min-height: 162px; padding: 16px; border-radius: 26px; border: 1px solid var(--line); background: rgba(255,255,255,.74); box-shadow: var(--shadow-soft); display: flex; flex-direction: column; justify-content: space-between; gap: 14px; overflow: hidden; position: relative; }
    .flow-card::after { content: ""; position: absolute; inset: auto -28px -42px auto; width: 112px; height: 112px; border-radius: 50%; background: rgba(0,113,227,.1); pointer-events: none; }
    .flow-card.good::after { background: rgba(36,138,61,.12); }
    .flow-card.warn::after { background: rgba(191,106,2,.13); }
    .flow-card.bad::after { background: rgba(215,0,21,.11); }
    .flow-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; position: relative; z-index: 1; }
    .flow-icon { width: 38px; height: 38px; border-radius: 15px; display: grid; place-items: center; color: var(--blue); background: rgba(0,113,227,.1); font-size: 18px; }
    .flow-card.good .flow-icon { color: var(--green); background: rgba(36,138,61,.1); }
    .flow-card.warn .flow-icon { color: var(--orange); background: rgba(191,106,2,.1); }
    .flow-card.bad .flow-icon { color: var(--red); background: rgba(215,0,21,.09); }
    .flow-value { font-size: clamp(22px, 2.8vw, 34px); line-height: .98; font-weight: 880; letter-spacing: -.045em; position: relative; z-index: 1; }
    .flow-note { color: var(--muted); line-height: 1.34; font-size: 13px; position: relative; z-index: 1; }
    .command-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 14px; }
    .focus-card { padding: 22px; border-radius: 28px; border: 1px solid var(--line); background: var(--surface-strong); box-shadow: var(--shadow-soft); }
    .command-stack { display: grid; gap: 10px; margin: 14px 0 0; }
    .command-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 18px; background: rgba(118,118,128,.08); }
    .command-index { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 999px; background: rgba(0,113,227,.12); color: var(--blue); font-size: 12px; font-weight: 850; flex: 0 0 auto; }
    .card, details.card { background: var(--surface-strong); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow-soft); }
    .card { padding: 18px; }
    .soft-card { background: rgba(255,255,255,.58); backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px); }
    .metric-value { margin: 8px 0 6px; font-size: 32px; line-height: 1; font-weight: 850; letter-spacing: -.04em; }
    .metric-note { color: var(--muted); line-height: 1.38; }
    .simple-plan { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .summary-card { padding: 22px; border-radius: 28px; border: 1px solid var(--line); background: var(--surface-strong); box-shadow: var(--shadow-soft); }
    .summary-card ul { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 9px; }
    .summary-card li { position: relative; padding-left: 22px; line-height: 1.42; }
    .summary-card li::before { content: ""; position: absolute; left: 0; top: .58em; width: 8px; height: 8px; border-radius: 50%; background: var(--blue); }
    .tone-bad li::before { background: var(--red); }
    .tone-warn li::before { background: var(--orange); }
    .tone-good li::before { background: var(--green); }
    .lane-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .lane-card { min-height: 178px; display: flex; flex-direction: column; justify-content: space-between; gap: 16px; }
    .lane-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .lane-icon { width: 42px; height: 42px; border-radius: 16px; display: grid; place-items: center; background: linear-gradient(135deg, rgba(0,113,227,.16), rgba(125,95,255,.13)); }
    .lane-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .mini { padding: 10px; border-radius: 16px; background: rgba(118,118,128,.08); }
    .mini strong { display: block; font-size: 18px; letter-spacing: -.02em; }
    .help-dot { display: inline-grid; place-items: center; width: 17px; height: 17px; margin-left: 5px; border-radius: 50%; border: 1px solid rgba(118,118,128,.38); color: var(--muted); font-size: 11px; font-weight: 900; cursor: help; vertical-align: 1px; }
    .progress { height: 8px; border-radius: 999px; overflow: hidden; background: rgba(118,118,128,.14); }
    .progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--blue), var(--purple)); width: var(--w, 0%); }
    .progress.danger > span { background: linear-gradient(90deg, var(--orange), var(--red)); }
    .roadmap-rail { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .roadmap-step { display: inline-flex; align-items: center; gap: 7px; padding: 9px 11px; border-radius: 999px; border: 1px solid var(--line); background: rgba(118,118,128,.08); font-weight: 780; font-size: 13px; }
    .roadmap-step.complete { color: var(--green); background: rgba(36,138,61,.09); }
    .roadmap-step.current { color: var(--blue); background: rgba(0,113,227,.11); }
    .roadmap-step.blocked { color: var(--red); background: rgba(215,0,21,.08); }
    .weight-bar { min-width: 132px; display: grid; gap: 6px; }
    .weight-track { height: 10px; border-radius: 999px; overflow: hidden; background: rgba(118,118,128,.14); }
    .weight-fill { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--blue), var(--purple)); width: var(--w, 0%); }
    .metric-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 25px; margin: 2px 5px 2px 0; padding: 4px 9px; border-radius: 999px; background: rgba(118,118,128,.1); color: var(--muted); font-size: 12px; font-weight: 760; white-space: nowrap; }
    .definition-list { display: grid; gap: 10px; margin-top: 14px; }
    .definition-item { display: grid; grid-template-columns: 190px minmax(0,1fr); gap: 12px; align-items: start; padding: 10px 12px; border-radius: 16px; background: rgba(0,113,227,.07); border: 1px solid rgba(0,113,227,.13); }
    .definition-item strong { color: var(--text); }
    .definition-item span { color: var(--muted); line-height: 1.38; }
    .strategy-cell { display: grid; gap: 7px; min-width: 210px; }
    .strategy-cell strong { font-size: 15px; letter-spacing: -.018em; }
    .equal-weight-token { display: inline-flex; align-items: center; justify-content: center; min-width: 62px; min-height: 34px; padding: 6px 10px; border-radius: 999px; color: var(--blue); background: rgba(0,113,227,.1); border: 1px solid rgba(0,113,227,.18); font-weight: 850; }
    .delta-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 92px; min-height: 36px; padding: 7px 11px; border-radius: 999px; font-weight: 880; letter-spacing: -.02em; background: rgba(118,118,128,.1); color: var(--muted); border: 1px solid var(--line); }
    .delta-badge.positive { color: var(--green); background: rgba(36,138,61,.1); border-color: rgba(36,138,61,.22); }
    .delta-badge.negative { color: var(--red); background: rgba(215,0,21,.08); border-color: rgba(215,0,21,.2); }
    .delta-badge.neutral { color: var(--text); background: rgba(118,118,128,.1); }
    .delta-badge.waiting { color: var(--orange); background: rgba(191,106,2,.1); border-color: rgba(191,106,2,.22); }
    .strategy-note { color: var(--muted); font-size: 12px; line-height: 1.35; }
    .status-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .wide { grid-column: 1 / -1; }
    details.card { overflow: hidden; margin-top: 14px; }
    details.card > summary { cursor: pointer; list-style: none; padding: 20px 22px; font-size: 18px; font-weight: 820; letter-spacing: -.02em; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    details.card > summary::-webkit-details-marker { display: none; }
    details.card > summary::after { content: "+"; width: 30px; height: 30px; border-radius: 999px; display: grid; place-items: center; color: var(--muted); background: rgba(118,118,128,.1); flex: 0 0 auto; }
    details.card[open] > summary::after { content: "−"; }
    details.card > div { padding: 0 22px 22px; }
    .table-wrap { width: 100%; overflow-x: auto; border-radius: 18px; border: 1px solid var(--line); background: rgba(255,255,255,.52); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 680px; }
    th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; font-weight: 850; text-transform: uppercase; letter-spacing: .06em; background: rgba(118,118,128,.06); }
    tr:last-child td { border-bottom: 0; }
    .status { display: inline-flex; align-items: center; min-height: 26px; padding: 4px 9px; border-radius: 999px; background: rgba(0,113,227,.1); color: var(--blue); font-weight: 800; white-space: nowrap; }
    .good { color: var(--green); } .bad { color: var(--red); } .warn { color: var(--orange); }
    .empty { padding: 28px; text-align: center; color: var(--muted); }
    .footer-note { margin-top: 28px; text-align: center; color: var(--muted); font-size: 13px; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #050507; --bg-soft: #111114; --surface: rgba(28,28,30,.72); --surface-strong: rgba(28,28,30,.92); --text: #f5f5f7; --muted: #a1a1a6; --line: rgba(255,255,255,.13); --line-strong: rgba(255,255,255,.2); --shadow: 0 18px 60px rgba(0,0,0,.38); --shadow-soft: 0 8px 28px rgba(0,0,0,.28); background: radial-gradient(circle at top left, rgba(0,113,227,.22), transparent 32rem), linear-gradient(180deg, #151518 0%, #070709 52%, #020203 100%); }
      .hero { border-color: rgba(255,255,255,.12); background: linear-gradient(145deg, rgba(37,37,40,.94), rgba(24,24,27,.74)); }
      .hero-stat, .table-wrap { background: rgba(44,44,46,.56); }
    }
    @media (max-width: 1080px) { .flow-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 860px) { main { width: min(100% - 24px, 1180px); padding-top: 16px; } .page-top { align-items: flex-start; } .hero-strip, .simple-plan, .lane-grid, .command-grid, .flow-grid { grid-template-columns: 1fr; } details.card > summary { align-items: flex-start; } }
    @media (max-width: 560px) { .page-top { flex-direction: column; } .top-actions { justify-content: flex-start; } .hero { border-radius: 28px; padding: 24px; } h1 { font-size: 44px; } .metric-value { font-size: 28px; } }
  </style>
</head>
<body>
  <main>
    <header class="page-top" aria-label="Dashboard header">
      <div class="brand"><div class="mark" aria-hidden="true">⌁</div><span>OpenClaw Kalshi</span></div>
      <div class="top-actions">
        <span class="pill safe"><span class="dot"></span>Paper only</span>
        <span class="pill bad"><span class="dot"></span>Live trading blocked</span>
      </div>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow">Today&apos;s Answer</div>
        <h1 id="hero-title">Wait. Learn. Do not trade live.</h1>
        <p class="hero-subtitle" id="subtitle">Loading fresh paper-trading snapshot...</p>
      </div>
      <div class="hero-strip" id="hero-stats" aria-live="polite"></div>
    </section>

    <section class="section-heading" aria-label="Kalshi control surface heading">
      <div>
        <h2>Kalshi Control Surface</h2>
        <p class="muted">The operational answer before any research step: source gates, blockers, no-live state, market breadth, and the exact human action required.</p>
      </div>
    </section>
    <section class="grid" id="kalshi-control-cards" aria-live="polite"></section>
    <details class="card wide" id="kalshi-control-details" open>
      <summary>Do Not Proceed Gate, Market Readiness, and Artifact Map</summary>
      <div>
        <p class="muted" id="kalshi-control-summary"></p>
        <div class="table-wrap" style="margin-bottom:12px"><table id="kalshi-family-readiness-table"></table></div>
        <div class="table-wrap" style="margin-bottom:12px"><table id="kalshi-snapshot-status-table"></table></div>
        <div class="table-wrap" style="margin-bottom:12px"><table id="kalshi-artifact-status-table"></table></div>
        <div class="table-wrap"><table id="kalshi-forbidden-actions-table"></table></div>
      </div>
    </details>

    <section class="section-heading" aria-label="STS readiness roadmap heading">
      <div>
        <h2>STS Readiness Roadmap</h2>
        <p class="muted">This shows how close STS is to directing paper trades and how far live trading remains. Live trading cannot turn on automatically.</p>
      </div>
    </section>
    <section class="grid" id="sts-roadmap-cards" aria-live="polite"></section>
    <section class="summary-card" id="sts-roadmap-rail" aria-live="polite"></section>
    <details class="card" id="sts-roadmap-details" open>
      <summary>Readiness blockers and progress since last refresh</summary>
      <div><section class="grid" id="sts-roadmap-delta"></section><div class="table-wrap" style="margin-top:12px"><table id="sts-roadmap-blockers-table"></table></div></div>
    </details>

    <section class="section-heading" aria-label="STS trading dashboard heading">
      <div>
        <h2>STS Trading Dashboard</h2>
        <p class="muted">This is the top answer: whether STS can direct paper trades, why or why not, and how STS-directed paper trading is performing.</p>
      </div>
    </section>
    <section class="grid" id="sts-trading-cards" aria-live="polite"></section>
    <section class="summary-card" id="sts-rationales" aria-live="polite"></section>
    <details class="card" id="sts-readiness-details" open>
      <summary>STS readiness gates, domain performance, and recent STS-directed paper decisions</summary>
      <div><section class="grid" id="sts-trading-detail-cards"></section><div class="table-wrap" style="margin-top:12px"><table id="sts-readiness-table"></table></div><div class="table-wrap" style="margin-top:12px"><table id="sts-domain-table"></table></div><div class="table-wrap" style="margin-top:12px"><table id="sts-recent-table"></table></div></div>
    </details>

    <nav class="jumpbar" aria-label="Dashboard jump links">
      <a href="#kalshi-control-details">Control Surface</a>
      <a href="#sts-roadmap-cards">STS Roadmap</a>
      <a href="#sts-trading-cards">STS Dashboard</a>
      <a href="#proof-mission">Proof Gates</a>
      <a href="#build-gap-audit">Build Gaps</a>
      <a href="#command-flow">Command Flow</a>
      <a href="#plain-summary">Plain English</a>
      <a href="#paper-trade-accelerator">Accelerator</a>
      <a href="#strategy-weight-table">Weights</a>
      <a href="#trade-tracking-table">Data Contract</a>
      <a href="#timesfm-diagnostic">TimesFM</a>
      <a href="#mlx-diagnostic">MLX</a>
      <a href="#kalshi-nonlive-openclaw-runner">OpenClaw Runner</a>
      <a href="#crypto-settlement-oracle">Settlement Oracle</a>
      <a href="#crypto-persistence-lab">Crypto Persistence</a>
      <a href="#sts-policy-snapshot">STS Policy</a>
      <a href="#sts-domain-learning-optimizer">Domain Optimizer</a>
      <a href="#weather-crypto-command">Weather/Crypto</a>
      <a href="#crypto-regime-selector-card">Crypto Regimes</a>
      <a href="#source-lag-surface-command">Source-Lag</a>
      <a href="#pending-table">Resolve Next</a>
    </nav>

    <section class="section-heading" aria-label="Command flow heading">
      <div>
        <h2>Command Flow</h2>
        <p class="muted">The whole dashboard, compressed into one calm cockpit: safety, speed, fair comparison, integrity, frontier, and proof.</p>
      </div>
    </section>
    <section class="flow-grid" id="command-flow" aria-live="polite"></section>

    <section class="section-heading" aria-label="Plain English summary heading">
      <div>
        <h2>Plain English</h2>
        <p class="muted">The dashboard starts with the decision a human needs first. The machinery stays available below.</p>
      </div>
    </section>
    <section class="simple-plan" id="plain-summary" aria-live="polite"></section>

    <section class="section-heading" aria-label="Learning lanes heading">
      <div>
        <h2>Learning Lanes</h2>
        <p class="muted">Weather and crypto get clean, fast learning. Sports stays restrained unless proof improves.</p>
      </div>
    </section>
    <section class="lane-grid" id="learning-lanes"></section>

    <section class="section-heading" aria-label="Weather and crypto command center heading">
      <div>
        <h2>Weather/Crypto Command Center</h2>
        <p class="muted">Ontology-style paper learning: validate reality, score outcomes, rank segments, then open only tiny paper probes where evidence earns it.</p>
      </div>
    </section>
    <section class="section-heading" aria-label="STS domain learning optimizer heading">
      <div>
        <h2>STS Domain Learning Optimizer</h2>
        <p class="muted">Weather/Crypto are prioritized with fresh blocked-candidate pressure plus readiness gap signals.</p>
      </div>
    </section>
    <section class="grid" id="sts-domain-learning-optimizer" aria-live="polite"></section>
    <section class="summary-card" id="sts-domain-learning-definitions" aria-live="polite"></section>
    <section class="summary-card" id="sts-policy-snapshot" aria-live="polite"></section>
    <section class="grid" id="weather-crypto-command" aria-live="polite"></section>
    <details class="card wide" id="crypto-regime-selector-card" open>
      <summary>Crypto Regime Selector</summary>
      <div>
        <p class="muted" id="crypto-regime-selector-summary"></p>
        <section class="grid" id="crypto-regime-selector-cards" aria-live="polite"></section>
        <div class="table-wrap"><table id="crypto-regime-selector-table"></table></div>
        <div class="table-wrap"><table id="crypto-regime-outcomes-table"></table></div>
        <div class="table-wrap"><table id="crypto-coverage-cohort-blocks-table"></table></div>
        <div class="table-wrap"><table id="crypto-regime-inverse-repair-table"></table></div>
      </div>
    </details>
    <details class="card wide" id="quarantine-recovery-priority-card" open>
      <summary>Quarantine Recovery Priority</summary>
      <div>
        <p class="muted" id="quarantine-recovery-summary"></p>
        <section class="grid" id="quarantine-recovery-cards" aria-live="polite"></section>
        <p class="muted" id="weather-frontier-sampling-summary"></p>
        <section class="grid" id="weather-frontier-sampling-cards" aria-live="polite"></section>
        <div class="table-wrap"><table id="weather-frontier-sampling-table"></table></div>
        <div class="table-wrap"><table id="quarantine-recovery-table"></table></div>
      </div>
    </details>

    <section class="section-heading" aria-label="Source-lag selective surface heading">
      <div>
        <h2>Source-Lag Selective Surface</h2>
        <p class="muted">Weather-first hypotheses that require exact settlement-source alignment; crypto stays shadow-only without approved CFB RTI basis proof.</p>
      </div>
    </section>
    <section class="grid" id="source-lag-surface-command" aria-live="polite"></section>
    <details class="card wide" open>
      <summary>Source-Lag Ranked Hypotheses</summary>
      <div><p class="muted" id="source-lag-surface-summary"></p><div class="table-wrap"><table id="source-lag-surface-table"></table></div></div>
    </details>

    <section class="section-heading" aria-label="Proof mission heading">
      <div>
        <h2>Proof Mission</h2>
        <p class="muted">One simple goal: find a paper-only lane with 100 clean, profitable, baseline-beating outcomes.</p>
      </div>
    </section>
    <section class="summary-card" id="proof-mission" aria-live="polite"></section>
    <details class="card wide" id="build-gap-audit" open>
      <summary>Verified Build Gap Audit</summary>
      <div>
        <p class="muted" id="build-gap-audit-summary"></p>
        <section class="grid" id="build-gap-audit-cards" aria-live="polite"></section>
        <div class="table-wrap"><table id="build-gap-audit-table"></table></div>
      </div>
    </details>

    <section class="section-heading" aria-label="Paper trade accelerator heading">
      <div>
        <h2>Paper Trade Accelerator</h2>
        <p class="muted">Fastest safe route to more labels: resolve due outcomes, create Weather/Crypto shadow cohorts, and keep live risk at zero.</p>
      </div>
    </section>
    <section class="command-grid" id="paper-trade-accelerator" aria-live="polite"></section>

    <section class="section-heading" aria-label="Strategy weights heading">
      <div>
        <h2>Strategy Weights</h2>
        <p class="muted">Every strategy gets a visible paper-learning attention weight. These are not live or accepted-exposure weights.</p>
      </div>
    </section>
    <details class="card wide" open>
      <summary>Paper-Learning Strategy Weights</summary>
      <div><p class="muted" id="strategy-weight-summary"></p><div class="table-wrap"><table id="strategy-weight-table"></table></div></div>
    </details>

    <section class="section-heading" aria-label="Trade data contract heading">
      <div>
        <h2>ML Trade Data Contract</h2>
        <p class="muted">Every paper trade must carry the fields needed to compare strategies, avoid leakage, calibrate models, and learn profitably.</p>
      </div>
    </section>
    <details class="card wide" open>
      <summary>ML Data Contract Coverage</summary>
      <div><p class="muted" id="trade-tracking-summary"></p><div class="table-wrap" style="margin-bottom:12px"><table id="trade-tracking-table"></table></div><div class="table-wrap"><table id="trade-field-table"></table></div></div>
    </details>

    <details class="card wide" id="timesfm-diagnostic" open>
      <summary>TimesFM Diagnostic Forecasting</summary>
      <div>
        <p class="muted" id="timesfm-diagnostic-summary"></p>
        <section class="grid" id="timesfm-diagnostic-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="timesfm-diagnostic-table"></table></div>
        <div class="table-wrap" style="margin-top:12px"><table id="timesfm-segment-failures-table"></table></div>
      </div>
    </details>

    <details class="card wide" id="mlx-diagnostic" open>
      <summary>MLX Diagnostic Runtime</summary>
      <div>
        <p class="muted" id="mlx-diagnostic-summary"></p>
        <section class="grid" id="mlx-diagnostic-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="mlx-diagnostic-table"></table></div>
      </div>
    </details>

    <details class="card wide" id="kalshi-nonlive-openclaw-runner" open>
      <summary>Kalshi v11 OpenClaw Runner</summary>
      <div>
        <p class="muted" id="kalshi-nonlive-runner-summary"></p>
        <section class="grid" id="kalshi-nonlive-runner-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="kalshi-nonlive-runner-table"></table></div>
      </div>
    </details>

    <details class="card wide" id="kalshi-v12-source-bottleneck" open>
      <summary>Kalshi v12 Source Bottleneck</summary>
      <div>
        <p class="muted" id="kalshi-v12-source-bottleneck-summary"></p>
        <section class="grid" id="kalshi-v12-source-bottleneck-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="kalshi-v12-source-bottleneck-table"></table></div>
      </div>
    </details>

    <details class="card wide" id="kalshi-v13-preregistration" open>
      <summary>Kalshi v13 Preregistration Plan</summary>
      <div>
        <p class="muted" id="kalshi-v13-preregistration-summary"></p>
        <section class="grid" id="kalshi-v13-preregistration-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="kalshi-v13-preregistration-table"></table></div>
      </div>
    </details>

    <details class="card wide" id="crypto-settlement-oracle" open>
      <summary>Crypto Settlement Arbitrage Lab</summary>
      <div>
        <p class="muted" id="crypto-settlement-oracle-summary"></p>
        <section class="grid" id="crypto-settlement-oracle-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="crypto-settlement-oracle-table"></table></div>
        <div class="table-wrap" style="margin-top:12px"><table id="crypto-settlement-oracle-gates-table"></table></div>
      </div>
    </details>

    <details class="card wide" id="crypto-persistence-lab" open>
      <summary>Crypto Persistence Lab</summary>
      <div>
        <p class="muted" id="crypto-persistence-summary"></p>
        <section class="grid" id="crypto-persistence-cards" aria-live="polite"></section>
        <div class="table-wrap" style="margin-top:12px"><table id="crypto-persistence-table"></table></div>
        <div class="table-wrap" style="margin-top:12px"><table id="crypto-persistence-journal-table"></table></div>
      </div>
    </details>

    <details class="card wide" open>
      <summary>Kalshi Market Telemetry for ML Speed / Accuracy / Profit</summary>
      <div><p class="muted" id="market-telemetry-summary"></p><section class="grid" id="market-telemetry-cards"></section><div class="table-wrap"><table id="market-telemetry-table"></table></div></div>
    </details>

    <section class="section-heading" aria-label="Quick status heading">
      <div>
        <h2>At a Glance</h2>
        <p class="muted">A calm snapshot of safety, performance, freshness, and unresolved paper exposure.</p>
      </div>
    </section>
    <section class="grid" id="cards"></section>

    <section class="section-heading" aria-label="Detailed evidence heading">
      <div>
        <h2>Evidence</h2>
        <p class="muted">Open a card only when you want the audit trail. Nothing here can place a live order.</p>
      </div>
    </section>

    <details class="card wide" open>
      <summary>All-Time Baseline Preserved From Before The Reset</summary>
      <div><p class="muted">Older data is not deleted. It is shown here as the Standard Strategy baseline so the new Inverse Standard Strategy paper epoch can be judged cleanly.</p><div class="table-wrap"><table id="all-time-table"></table></div></div>
    </details>
    <details class="card wide" open>
      <summary>Strategy Comparison</summary>
      <div><p class="muted" id="strategy-comparison-summary"></p><div class="table-wrap"><table id="strategy-comparison-table"></table></div></div>
    </details>
    <details class="card wide" open>
      <summary>Category Accuracy</summary>
      <div><div class="table-wrap"><table id="category-table"></table></div></div>
    </details>
    <details class="card wide">
      <summary>Forward Paper Proof</summary>
      <div><p class="muted" id="proof-summary"></p><div class="table-wrap"><table id="proof-table"></table></div></div>
    </details>
    <details class="card wide" open>
      <summary>Weather/Crypto Active Learning Queue</summary>
      <div><p class="muted" id="weather-crypto-ml-summary"></p><div class="table-wrap"><table id="weather-crypto-ml-table"></table></div></div>
    </details>
    <details class="card wide">
      <summary>Strategy Proof Diagnosis</summary>
      <div><p class="muted" id="diagnosis-summary"></p><div class="table-wrap"><table id="diagnosis-table"></table></div></div>
    </details>
    <details class="card wide" open>
      <summary>Exact Model-Lane Firewall</summary>
      <div><p class="muted" id="model-lane-firewall-summary"></p><div class="table-wrap"><table id="model-lane-firewall-table"></table></div></div>
    </details>
    <details class="card wide">
      <summary>Next Paper Trades To Resolve</summary>
      <div><div class="table-wrap"><table id="pending-table"></table></div></div>
    </details>
    <p class="footer-note">Read-only local dashboard. Paper evidence only. Human approval remains required before any future live-trading promotion.</p>
  </main>
  <script>
    const standardizeStrategyText = (value) => String(value ?? "")
      .replace(/Current vs Inverse Strategy/gi, "Standard Strategy vs Inverse Standard Strategy")
      .replace(/Standard vs Inverse Standard Strategy/gi, "Standard Strategy vs Inverse Standard Strategy")
      .replace(/current paper strategy/gi, "active paper strategy")
      .replace(/current strategy/gi, "active paper strategy")
      .replace(/current-side/gi, "Standard Strategy side")
      .replace(/current side/gi, "Standard Strategy side")
      .replace(/old paper baseline/gi, "Standard Strategy baseline")
      .replace(/old baseline/gi, "Standard Strategy baseline")
      .replace(/old strategy/gi, "Standard Strategy")
      .replace(/old side/gi, "Standard Strategy side")
      .replace(/original strategy/gi, "Standard Strategy")
      .replace(/original side/gi, "Standard Strategy side")
      .replace(/original accuracy/gi, "Standard Strategy accuracy")
      .replace(/original P&L/gi, "Standard Strategy P&L")
      .replace(/original win rate/gi, "Standard Strategy win rate")
      .replace(/inverse-first/gi, "Inverse Standard Strategy")
      .replace(/inverse first/gi, "Inverse Standard Strategy")
      .replace(/inverse strategy/gi, "Inverse Standard Strategy")
      .replace(/inverse-side/gi, "Inverse Standard Strategy side")
      .replace(/inverse side/gi, "Inverse Standard Strategy side")
      .replace(/inverse trades/gi, "Inverse Standard Strategy trades")
      .replace(/inverse segments/gi, "Inverse Standard Strategy segments")
      .replace(/inverse tests/gi, "Inverse Standard Strategy tests")
      .replace(/poly_claw/gi, "PolyClaw")
      .replace(/polyclaw/gi, "PolyClaw")
      .replace(/polymarket_kalshi_divergence/gi, "polymarket-kalshi-divergence")
      .replace(/weather arbitrage strategy/gi, "Weather Arbitrage Strategy");
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[char]));
    const text = (value) => esc(standardizeStrategyText(value));
    const money = (v) => `${Number(v || 0) < 0 ? "-" : ""}$${Math.abs(Number(v || 0)).toFixed(2)}`;
    const signedMoney = (v) => `${Number(v || 0) >= 0 ? "+" : "-"}$${Math.abs(Number(v || 0)).toFixed(2)}`;
    const pct = (v) => v === null || v === undefined || Number.isNaN(Number(v)) ? "n/a" : `${(Number(v) * 100).toFixed(1)}%`;
    const fmt = (v) => v ? new Date(v).toLocaleString([], {hour12: false, timeZoneName: "short"}) : "unknown";
    const number = (v) => Number(v || 0).toLocaleString();
    const classForValue = (v, goodAtZero = false) => Number(v || 0) > 0 ? "good" : (Number(v || 0) < 0 ? "bad" : (goodAtZero ? "good" : "warn"));
    const help = (definition) => `<span class="help-dot" title="${esc(definition)}" aria-label="${esc(definition)}">?</span>`;
    const helpLabel = (label, definition) => `${text(label)}${help(definition)}`;
    const row = (cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    const header = (cells) => `<tr>${cells.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr>`;
    const emptyRow = (cols, message) => `<tr><td colspan="${cols}"><div class="empty">${esc(message)}</div></td></tr>`;
    const laneEmoji = { weather: "☀️", crypto: "₿", sports: "🏟️" };
    const laneLabel = { weather: "Weather", crypto: "Crypto", sports: "Sports" };

    function heroStatus(data, perf, plain) {
      const control = data.kalshi_control_surface || {};
      if (control.status === "do_not_proceed") return {tone: "bad", title: "Do Not Proceed", detail: control.current_blocker || "A control gate is blocking the next step."};
      if (data.live_order_allowed === true) return {tone: "bad", title: "Stop", detail: "Live authority unexpectedly appears enabled."};
      if (Number(perf.paper_pnl_usd || 0) < 0) return {tone: "bad", title: "Wait", detail: plain.headline || "Paper results are not ready for live trading."};
      if ((plain.tone || "") === "good") return {tone: "good", title: "Review", detail: plain.headline || "Paper proof is improving."};
      return {tone: "warn", title: "Learn", detail: plain.headline || "OpenClaw is still gathering paper evidence."};
    }

    function renderHero(data, perf, plain, epochLabel) {
      const status = heroStatus(data, perf, plain);
      document.getElementById("hero-title").textContent = `${status.title}. Learn safely.`;
      const velocity = data.learning_velocity || {};
      const control = data.kalshi_control_surface || {};
      const sourceGate = control.sports_source_gate || {};
      const latestAge = velocity.latest_learning_age_minutes == null ? "n/a" : `${Number(velocity.latest_learning_age_minutes).toFixed(1)} min`;
      const learningTone = velocity.status === "HIGH_SPEED_LEARNING" ? "good" : (velocity.status === "STALE" ? "bad" : "warn");
      document.getElementById("hero-stats").innerHTML = [
        ["Safety", "Live blocked", "No live orders can be placed from this dashboard.", "good"],
        ["Sports Source Gate", sourceGate.do_not_proceed ? "Blocked" : "Ready", sourceGate.do_not_proceed ? "One exact repo-root local sports JSONL source path must be approved first." : "Approved source path is ready for the next read-only gate.", sourceGate.do_not_proceed ? "bad" : "warn"],
        ["Human Input", control.status === "do_not_proceed" ? "Required" : "Review", control.exact_next_human_action_required || "No current human action recorded.", control.status === "do_not_proceed" ? "bad" : "warn"],
        ["Paper P&L", money(perf.paper_pnl_usd), "Simulated net result from scored paper trades.", classForValue(perf.paper_pnl_usd)],
        ["Learning", latestAge, velocity.plain_english || "Age of the latest source-backed learning outcome.", learningTone],
      ].map(([label, value, note, tone]) => `<article class="hero-stat"><div class="label">${esc(label)}</div><div class="value ${tone}">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`).join("");
      return status;
    }

    function renderKalshiControlSurface(data) {
      const control = data.kalshi_control_surface || {};
      const gate = control.sports_source_gate || {};
      const noLive = control.no_live_status || {};
      const replay = control.diagnostic_replay_holdout_status || {};
      const sts = control.sts_readiness_status || {};
      const nonCrypto = control.non_crypto_tracking || {};
      const goal = control.goal_mode || {};
      const doNotProceed = control.status === "do_not_proceed" || gate.do_not_proceed === true;
      const statusText = doNotProceed ? "Do Not Proceed" : "Proceed to next read-only gate";
      document.getElementById("kalshi-control-summary").textContent = standardizeStrategyText(control.exact_next_human_action_required || "No current control-surface action is recorded.");
      document.getElementById("kalshi-control-cards").innerHTML = [
        ["No-Live", noLive.ok ? String(noLive.mode || "READ_ONLY") : "check failed", noLive.ok ? "Validator reports live trading disabled and no live order authority." : "No-live validator did not report a clean state.", noLive.ok ? "good" : "bad"],
        ["Active Track", control.active_track || "unknown", control.current_blocker || "No blocker recorded.", doNotProceed ? "bad" : "warn"],
        ["Sports Source Gate", gate.status || "unknown", `Approved paths ${number(gate.approved_source_count || 0)}/${number(gate.required_approved_source_count || 1)}. Expected path exists: ${gate.expected_path_exists ? "yes" : "no"}.`, gate.do_not_proceed ? "bad" : "warn"],
        ["Next Human Input", statusText, control.exact_next_human_action_required || "No action recorded.", doNotProceed ? "bad" : "warn"],
        ["Action 2 / 3", doNotProceed ? "Dependency blocked" : "Still gated", control.queued_prompt_risk_warning || "Dependent actions need explicit source/schema gates.", doNotProceed ? "bad" : "warn"],
        ["Goal Mode", goal.appropriate ? "Allowed" : "Not appropriate", goal.reason || "Goal Mode requires clean, bounded prerequisites.", goal.appropriate ? "good" : "warn"],
        ["STS Readiness", sts.can_sts_direct_paper ? "Paper review needed" : "Blocked", `${sts.paper_stage_label || "Blocked"} / ${sts.live_stage_label || "Not live-ready"}. Live trading remains disabled.`, "warn"],
        ["Non-Crypto Tracking", nonCrypto.preserved ? "Preserved" : "Needs audit", nonCrypto.tracking_preservation || "Tracking preservation status not recorded.", nonCrypto.preserved ? "good" : "bad"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");

      const families = control.market_family_readiness || {};
      const familyRows = ["crypto", "sports", "weather", "economics", "politics", "other"].map((family) => {
        const item = families[family] || {};
        const blockers = (item.blockers || []).slice(0, 3).join("; ") || "none recorded";
        return row([
          `<strong>${text(family)}</strong><br><span class="muted">${text(item.tracking_status || "unknown")}</span>`,
          `${number(item.rows)} / ${number(item.labels)}`,
          `${number(item.direct_capture_rows)} / ${number(item.labeled_direct_capture_rows)}`,
          text(item.diagnostic_research_status || "unknown"),
          text(item.next_safe_action || "not specified"),
          text(blockers),
          text(item.risk_of_overfocus ? `${item.risk_of_neglect || "unknown"} / overfocus ${item.risk_of_overfocus}` : (item.risk_of_neglect || "unknown")),
        ]);
      });
      document.getElementById("kalshi-family-readiness-table").innerHTML = header(["Family", "Rows / Labels", "Direct / Labeled Direct", "Diagnostic Status", "Safe Next Action", "Blockers", "Risk"]) + familyRows.join("");

      const snapshots = control.latest_frozen_snapshots || [];
      const replayRows = [
        row(["Snapshot gate", text(replay.snapshot_gate_decision || "unknown"), replay.snapshot_gate_replay_allowed ? "Replay allowed" : "Replay not allowed"]),
        row(["Category replay", text(replay.category_replay_readiness_status || "unknown"), replay.category_snapshot_exists ? "Snapshot exists" : "No current category snapshot"]),
        row(["Holdout replay", text(replay.holdout_replay_readiness_status || "unknown"), replay.holdout_snapshot_exists ? "Holdout snapshot exists" : "No holdout snapshot"]),
      ];
      document.getElementById("kalshi-snapshot-status-table").innerHTML = header(["Snapshot / Replay", "Status", "Detail"]) +
        (snapshots.length ? snapshots.map((snapshot) => row([
          text(snapshot.snapshot_id || "snapshot"),
          `<span class="${snapshot.exists ? "good" : "warn"}">${snapshot.exists ? "exists" : "missing"}</span>`,
          `${text(snapshot.path || "")}<br><span class="muted">${text(snapshot.decision || snapshot.source_artifact || "")}</span>`,
        ])).join("") : emptyRow(3, "No frozen snapshot records found.")) +
        replayRows.join("");

      const artifacts = control.artifact_links || [];
      const stale = control.stale_or_missing_artifact_warnings || [];
      document.getElementById("kalshi-artifact-status-table").innerHTML = header(["Artifact", "Exists", "Warning"]) +
        (artifacts.length ? artifacts.map((artifact) => row([
          text(artifact.path || ""),
          `<span class="${artifact.exists ? "good" : "bad"}">${artifact.exists ? "yes" : "no"}</span>`,
          text(stale.find((warning) => String(warning).includes(String(artifact.path || ""))) || ""),
        ])).join("") : emptyRow(3, "No control artifacts listed.")) +
        (stale.length ? stale.map((warning) => row(["Warning", '<span class="warn">attention</span>', text(warning)])).join("") : "");

      const forbidden = control.forbidden_actions || [];
      document.getElementById("kalshi-forbidden-actions-table").innerHTML = header(["Forbidden Action", "Status"]) +
        (forbidden.length ? forbidden.map((item) => row([text(item), '<span class="bad">forbidden</span>'])).join("") : emptyRow(2, "No forbidden-action list available."));
    }



    function renderStsReadinessRoadmap(data) {
      const roadmap = data.sts_readiness_roadmap || {};
      const paper = roadmap.paper_trading || {};
      const live = roadmap.live_trading || {};
      const delta = roadmap.progress_delta || {};
      const stages = roadmap.stages || [];
      const gates = roadmap.gates || [];
      const nextActions = roadmap.next_actions || [];
      const paperScore = Math.max(0, Math.min(100, Number(paper.readiness_score || 0)));
      const liveScore = Math.max(0, Math.min(100, Number(live.readiness_score || 0)));
      document.getElementById("sts-roadmap-cards").innerHTML = [
        ["STS Paper Trading", `${paperScore.toFixed(0)}/100`, paper.stage_label || "Unknown", `Can STS direct paper? ${paper.can_sts_direct_paper ? "Yes" : "No"}. Top blocker: ${paper.top_blocker || "none"}.`, "warn", paperScore, false, "0/100 paper progress means STS is not allowed to direct accepted paper yet; the score rises only when safety, data integrity, market-baseline, profitability, and forward-proof gates pass."],
        ["Live Trading", `${liveScore.toFixed(0)}/100`, live.stage_label || "Not live-ready", `Can trade live? No. Manual review required: ${live.manual_review_required === false ? "No" : "Yes"}.`, "bad", liveScore, true, "99/100 live-review progress would still not trade live by itself; live review needs paper proof, live safety gates, and explicit human approval. This dashboard remains read-only/paper-only."],
      ].map(([label, value, stage, note, tone, score, danger, definition]) => `<article class="card"><div class="label">${helpLabel(label, definition)}</div><div class="metric-value ${esc(tone)}">${esc(value)}</div><h3>${text(stage)}</h3><div class="progress ${danger ? "danger" : ""}" style="height:12px;margin:14px 0"><span style="--w:${Number(score).toFixed(1)}%"></span></div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("sts-roadmap-rail").innerHTML = `<div class="label">Stage rail</div><div class="roadmap-rail">${(stages.length ? stages : []).map((stage) => `<span class="roadmap-step ${esc(stage.state || "future")}">${text(stage.label || stage.stage_id)} · ${text(stage.state || "future")}</span>`).join("") || '<span class="roadmap-step blocked">Roadmap waiting</span>'}</div>`;
      document.getElementById("sts-roadmap-delta").innerHTML = [
        ["Paper readiness delta", Number(delta.paper_score_delta || 0).toFixed(1), "Change since the previous dashboard snapshot.", Number(delta.paper_score_delta || 0) > 0 ? "good" : "warn"],
        ["Live readiness delta", Number(delta.live_score_delta || 0).toFixed(1), "Live readiness should lag paper readiness until review gates pass.", Number(delta.live_score_delta || 0) > 0 ? "good" : "warn"],
        ["Newly passed gates", number((delta.newly_passed_gates || []).length), (delta.newly_passed_gates || []).join(", ") || "none", "good"],
        ["New blockers", number((delta.new_blockers || []).length), (delta.new_blockers || []).join(", ") || "none", (delta.new_blockers || []).length ? "bad" : "good"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      const blocked = gates.filter((gate) => gate.status === "blocked").slice(0, 10);
      document.getElementById("sts-roadmap-blockers-table").innerHTML = header(["Blocker", "Gate", "Why it matters", "Unlocks when"]) +
        (blocked.length ? blocked.map((gate) => row([text(gate.blocker || gate.gate_id), text(gate.label || ""), text(gate.why_it_matters || "This gate blocks readiness progress."), text(gate.unlocks_when || "Required proof is available.")])).join("") : emptyRow(4, "No blocking readiness gates.")) +
        (nextActions.length ? nextActions.map((action) => row(["Next action", "roadmap", text(action), "complete the stated evidence gate"])).join("") : "");
    }

    function renderStsTradingDashboard(data) {
      const dash = data.sts_trading_dashboard || {};
      const rationales = (data.supreme_trading_strategy && Array.isArray(data.supreme_trading_strategy.top_rationales)) ? data.supreme_trading_strategy.top_rationales : [];
      const summary = dash.summary || {};
      const directed = dash.directed_paper || {};
      const shadow = dash.shadow_learning || {};
      const learningControls = dash.learning_controls || {};
      const repair = dash.data_contract_repair || {};
      const segmentPolicy = dash.segment_policy || {};
      const forwardWeatherEvidence = dash.forward_weather_evidence || {};
      const gates = dash.readiness_gates || [];
      const domains = dash.domains || [];
      const recent = dash.recent_decisions || [];
      const canAccept = summary.can_accept_sts_paper === true;
      const resolved = Number(directed.resolved_trades || 0);
      const pending = Number(directed.pending_trades || 0);
      const pnl = directed.pnl_usd;
      document.getElementById("sts-trading-cards").innerHTML = [
        ["STS Paper Mode", summary.status_label || "Unknown", summary.plain_english || "STS trading status is loading.", canAccept ? "good" : "warn"],
        ["Can STS Accept Paper?", canAccept ? "Yes" : "No", summary.top_blocker || summary.next_action || "No blocker recorded.", canAccept ? "good" : "warn"],
        ["Markov Safe Rows", `${Math.max(0, Number(learningControls.markov_safe_rows_resolved || 0))}R/${Math.max(0, Number(learningControls.markov_safe_rows_pending || 0))}P/${Math.max(0, Number(learningControls.markov_safe_rows_unresolved || 0))}U`, `Markov coverage status: ${learningControls.markov_safe_rows_coverage_status || "not_generated"}.`, Number(learningControls.markov_safe_rows_resolved || 0) > 0 ? "good" : "warn"],
        ["Stochastic Process", learningControls.stochastic_process_multiplier == null ? "n/a" : `x${Number(learningControls.stochastic_process_multiplier).toFixed(2)}`, learningControls.stochastic_process_reason || "Stochastic-process signal is waiting on Markov coverage and confidence diagnostics.", Number(learningControls.stochastic_process_multiplier || 1.0) >= 1.0 ? "good" : "warn"],
        ["Stochastic Process Quality", learningControls.stochastic_process_quality == null ? "n/a" : `${(Number(learningControls.stochastic_process_quality) * 100).toFixed(1)}%`, `Quality signal ${(Number(learningControls.stochastic_process_quality) * 100).toFixed(1)}%.`, Number(learningControls.stochastic_process_quality || 0) >= 0.55 ? "good" : "warn"],
        ["Stochastic Process Safe Rows", learningControls.stochastic_process_safe_rows_quality == null ? "n/a" : `${(Number(learningControls.stochastic_process_safe_rows_quality) * 100).toFixed(1)}%`, `Safe-row quality from resolved/pending/unresolved mix.`, Number(learningControls.stochastic_process_safe_rows_quality || 0) >= 0.60 ? "good" : "warn"],
        ["Stochastic Process Pressure", learningControls.stochastic_process_pressure == null ? "n/a" : `${(Number(learningControls.stochastic_process_pressure) * 100).toFixed(1)}%`, `Taker-trap + low-data + unresolved Markov pressure.`, Number(learningControls.stochastic_process_pressure || 0) <= 0.35 ? "good" : "warn"],
        ["Stochastic Safety Factor", learningControls.stochastic_pressure_safety_factor == null ? "n/a" : `x${Number(learningControls.stochastic_pressure_safety_factor).toFixed(2)}`, `Applied as a final risk guard to weather/crypto row weights (${Number(learningControls.stochastic_pressure_safety_factor || 1.0) < 1.0 ? "active" : "neutral"}).`, Number(learningControls.stochastic_pressure_safety_factor || 1.0) <= 1.0 ? "good" : "warn"],
        ["Execution Reliability Score", learningControls.execution_reliability_score == null ? "n/a" : `${(Number(learningControls.execution_reliability_score) * 100).toFixed(1)}%`, `Higher reliability supports more aggressive route confidence.`, Number(learningControls.execution_reliability_score || 0) >= 0.8 ? "good" : (Number(learningControls.execution_reliability_score || 0) >= 0.6 ? "warn" : "bad")],
        ["Stochastic Process Confidence", learningControls.stochastic_process_confidence == null ? "n/a" : `${(Number(learningControls.stochastic_process_confidence) * 100).toFixed(1)}%`, `Markov confidence feature: ${Number(learningControls.stochastic_process_confidence || 0).toFixed(2)}.`, Number(learningControls.stochastic_process_confidence || 0) >= 0.5 ? "good" : "warn"],
        ["Stochastic Process Coverage", learningControls.stochastic_process_coverage == null ? "n/a" : `${(Number(learningControls.stochastic_process_coverage) * 100).toFixed(1)}%`, `Safe row coverage quality: ${(Number(learningControls.stochastic_process_coverage) * 100).toFixed(1)}%.`, Number(learningControls.stochastic_process_coverage || 0) >= 0.55 ? "good" : "warn"],
        ["Walk-forward Stability", learningControls.weather_crypto_walk_forward_stability_multiplier == null ? "n/a" : `x${Number(learningControls.weather_crypto_walk_forward_stability_multiplier).toFixed(3)}`, learningControls.weather_crypto_walk_forward_stability_reason || "No walk-forward stability factor available yet.", Number(learningControls.weather_crypto_walk_forward_stability_multiplier) > 1.0 ? "good" : (Number(learningControls.weather_crypto_walk_forward_stability_multiplier) < 1.0 ? "warn" : "good")],
        ["WF Domain Mix", `${((Number(learningControls.weather_crypto_walk_forward_stability_weather_signal || 0) * 100).toFixed(1))}% weather · ${(Number(learningControls.weather_crypto_walk_forward_stability_crypto_signal || 0) * 100).toFixed(1)}% crypto`, `Domain score ${(Number(learningControls.weather_crypto_walk_forward_stability_domain_score || 0) * 100).toFixed(1)}%`, (Number(learningControls.weather_crypto_walk_forward_stability_domain_score || 0) >= 0 ? "good" : "warn")],
        ["WF Domain Multipliers", `weather x${Number(learningControls.weather_crypto_walk_forward_stability_weather_multiplier || 1).toFixed(2)} / crypto x${Number(learningControls.weather_crypto_walk_forward_stability_crypto_multiplier || 1).toFixed(2)}`, `Walk-forward trend applied separately by domain`, (Number(learningControls.weather_crypto_walk_forward_stability_weather_multiplier || 1) >= 0.95 && Number(learningControls.weather_crypto_walk_forward_stability_crypto_multiplier || 1) >= 0.95) ? "good" : "warn"],
        ["WF Domain Calibration", `weather x${Number(learningControls.weather_crypto_domain_calibration_multiplier_weather || 1).toFixed(2)} / crypto x${Number(learningControls.weather_crypto_domain_calibration_multiplier_crypto || 1).toFixed(2)}`, `${learningControls.weather_crypto_domain_calibration_reason_weather || "No weather calibration reason."} / ${learningControls.weather_crypto_domain_calibration_reason_crypto || "No crypto calibration reason."}`, (Number(learningControls.weather_crypto_domain_calibration_multiplier_weather || 1) >= 0.95 && Number(learningControls.weather_crypto_domain_calibration_multiplier_crypto || 1) >= 0.95) ? "good" : "warn"],
        ["Learning Pressure", `weather x${Number(learningControls.weather_crypto_learning_pressure_multiplier_weather || 1).toFixed(2)} / crypto x${Number(learningControls.weather_crypto_learning_pressure_multiplier_crypto || 1).toFixed(2)}`, `${(learningControls.weather_crypto_learning_pressure_reason_weather || "Waiting for evidence.").toString()} (${(Number(learningControls.weather_crypto_learning_pressure_signal_weather || 0) * 100).toFixed(1)} / ${(Number(learningControls.weather_crypto_learning_pressure_signal_crypto || 0) * 100).toFixed(1)} trend signal)`, (Number(learningControls.weather_crypto_learning_pressure_multiplier_weather || 1) >= 0.95 && Number(learningControls.weather_crypto_learning_pressure_multiplier_crypto || 1) >= 0.95) ? "good" : "warn"],
        ["WF Domain Trend", `${(learningControls.weather_crypto_walk_forward_stability_weather_trend || "neutral").replaceAll("_", " ")} / ${(learningControls.weather_crypto_walk_forward_stability_crypto_trend || "neutral").replaceAll("_", " ")}`, learningControls.weather_crypto_walk_forward_stability_profile_reason || "No domain trend detail yet.", "good"],
        ["WF Trend", (learningControls.weather_crypto_walk_forward_stability_trend || "neutral").replaceAll("_", " "), `Slope: ${Number(learningControls.weather_crypto_walk_forward_stability_slope || 0).toFixed(3)}; windows: ${number(learningControls.weather_crypto_walk_forward_stability_windows || 0)} (${number(learningControls.weather_crypto_walk_forward_stability_sample_rows || 0)} rows)`, learningControls.weather_crypto_walk_forward_stability_trend === "improving" ? "good" : (learningControls.weather_crypto_walk_forward_stability_trend === "decayed" ? "warn" : "good")],
        ["WF Confidence", `${Number((learningControls.weather_crypto_walk_forward_stability_confidence || 0) * 100).toFixed(1)}%`, learningControls.weather_crypto_walk_forward_stability_profile_reason || "Walk-forward confidence is waiting on more backtest evidence.", (learningControls.weather_crypto_walk_forward_stability_confidence || 0) >= 0.6 ? "good" : "warn"],
        ["Sports Guard", learningControls.weather_crypto_reallocation_guard == null ? "n/a" : `x${Number(learningControls.weather_crypto_reallocation_guard).toFixed(3)}`, `Sports profile ${String(learningControls.weather_crypto_sports_profile_trend || "neutral").replaceAll("_", " ")} · conf ${(Number(learningControls.weather_crypto_sports_profile_confidence || 0) * 100).toFixed(1)}% · ${Number(learningControls.weather_crypto_sports_profile_windows || 0)} windows`, Number(learningControls.weather_crypto_reallocation_guard || 1.0) > 0.9 ? "good" : (Number(learningControls.weather_crypto_reallocation_guard || 0) > 0.75 ? "warn" : "bad")],
        ["Sports Learning Multiplier", learningControls.weather_crypto_sports_row_multiplier == null ? "n/a" : `x${Number(learningControls.weather_crypto_sports_row_multiplier).toFixed(3)}`, learningControls.weather_crypto_sports_block_reason || "Sports is not blocked by a dedicated reason.", Number(learningControls.weather_crypto_sports_row_multiplier || 1.0) > 0.0 ? "good" : "bad"],
        ["Sports Recent Edge", `${((Number(learningControls.weather_crypto_recent_sports_edge || 0) * 100).toFixed(1))}%`, learningControls.weather_crypto_reallocation_guard_reason || "No sports guard reason available.", Number(learningControls.weather_crypto_recent_sports_edge || 0) >= 0 ? "good" : "warn"],
        ["STS-Directed Trades", resolved + pending > 0 ? `${number(resolved)} resolved · ${number(pending)} pending` : "None yet", "Only STS paper routes count here; STS_SHADOW_ONLY is excluded.", resolved + pending > 0 ? "good" : "warn"],
        ["STS-Directed Accuracy", directed.win_rate == null ? "No resolved STS paper trades yet" : pct(directed.win_rate), `${number(directed.wins)} wins · ${number(directed.losses)} losses`, directed.win_rate == null ? "warn" : "good"],
        ["STS Paper P&L", pnl == null ? "Not available yet" : money(pnl), directed.plain_english || "Resolved STS paper P&L only.", pnl == null ? "warn" : classForValue(pnl)],
        ["Shadow Learning Rows", number(shadow.feature_rows), "Learning data, not STS-directed trades.", "good"],
        ["Data Contract Repair", `${number(repair.dataset_rows_added)} added · ${number(repair.repaired_row_count)} staged`, repair.plain_english || "Derived repair artifact not loaded.", Number(repair.dataset_rows_added || repair.repaired_row_count || 0) > 0 ? "good" : "warn"],
        ["Segment Policy V2", `${number(segmentPolicy.tiny_forward_eligible_count)} tiny eligible`, segmentPolicy.plain_english || "Segment-policy artifact not loaded.", Number(segmentPolicy.tiny_forward_eligible_count || 0) > 0 ? "good" : "warn"],
        ["Forward Weather Evidence", `${number(forwardWeatherEvidence.evidence_complete_count)} complete`, forwardWeatherEvidence.plain_english || "Broad weather learning stays shadow-only until forecast/source/price/side evidence is complete.", Number(forwardWeatherEvidence.evidence_complete_count || 0) > 0 ? "good" : "warn"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("sts-rationales").innerHTML = `<div class=\"label\">Top STS Rationales</div>` +
        (rationales.length
          ? `<div class=\"grid\" style=\"margin-top:12px; gap:10px; grid-template-columns: repeat(auto-fit,minmax(240px,1fr));\">` +
            rationales.slice(0, 3).map((item) => `<article class=\"card\"><div class=\"label\">${esc(item.title || "Rationale")}</div><div class=\"muted\" style=\"margin:6px 0 10px;\">${text(item.evidence || "")}</div><div class=\"metric-note\">${text(item.impact || item.evidence || "")}</div></article>`).join("") +
            `</div>`
          : `<div class=\"muted\">No top rationale payload is available yet.</div>`);
      document.getElementById("sts-trading-detail-cards").innerHTML = [
        ["Champion", String(shadow.champion_status || "unknown").replaceAll("_", " "), shadow.market_baseline_retained ? "Market baseline retained; STS has not proven uplift." : "STS challenger has beaten the market baseline.", shadow.market_baseline_retained ? "warn" : "good"],
        ["Leakage Rejected", number(shadow.leakage_rejected_count), "Must stay zero for clean ML learning.", Number(shadow.leakage_rejected_count || 0) === 0 ? "good" : "bad"],
        ["Next Action", summary.next_action || "Keep learning", "This is the current STS build/trading blocker.", "warn"],
        ["Qualified Segment Policies", number(segmentPolicy.qualified_segment_count), "Evidence-based segment policies that passed the V2 gate.", Number(segmentPolicy.qualified_segment_count || 0) > 0 ? "good" : "warn"],
        ["Quarantined After Repair", number(repair.remaining_quarantined_count), "Rows still excluded from repaired learning contracts.", Number(repair.remaining_quarantined_count || 0) > 0 ? "warn" : "good"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("sts-readiness-table").innerHTML = header(["Gate", "Status", "Meaning", "Blocker"]) +
        (gates.length ? gates.map((g) => row([text(g.label || g.gate_id), `<span class="status">${text(g.status || "unknown")}</span>`, text(g.plain_english || ""), text(g.blocker || "none")])).join("") : emptyRow(4, "No STS readiness gates available."));
      document.getElementById("sts-domain-table").innerHTML = header(["Domain", "Stance", "Resolved Rows", "Win Rate", "Paper P&L", "Brier"])+
        (domains.length ? domains.map((d) => row([text(d.domain || "unknown"), `<span class="status">${text(d.stance || "unknown")}</span>`, number(d.resolved_trades), pct(d.win_rate), `<span class="${classForValue(d.pnl_usd)}">${esc(money(d.pnl_usd))}</span>`, `Candidate ${d.candidate_brier == null ? "n/a" : Number(d.candidate_brier).toFixed(3)} / Market ${d.market_brier == null ? "n/a" : Number(d.market_brier).toFixed(3)}`])).join("") : emptyRow(6, "No STS domain diagnostics available."));
      document.getElementById("sts-recent-table").innerHTML = header(["Time", "Market", "Route", "Domain", "Result", "P&L"]) +
        (recent.length ? recent.map((d) => row([fmt(d.timestamp_utc), text(d.market_ticker || ""), text(d.route || ""), text(d.domain || ""), d.resolved ? (d.won ? "won" : "lost") : "pending", d.pnl_usd == null ? "not available" : money(d.pnl_usd)])).join("") : emptyRow(6, "No STS-directed paper trades yet. Shadow-only records are intentionally excluded."));
    }

    function renderCommandFlow(data) {
      const perf = data.performance_summary || {};
      const velocity = data.learning_velocity || {};
      const accelerator = data.paper_trade_accelerator || {};
      const comparison = data.strategy_comparison || {};
      const equalWeighting = comparison.equal_weighting || {};
      const tracking = data.trade_tracking || {};
      const criticalFields = tracking.critical_missing_fields || [];
      const ml = data.weather_crypto_ml || {};
      const frontierTargets = ml.segment_frontier_acquisition_targets || [];
      const frontier = frontierTargets[0] || {};
      const proof = data.gap01_forward_proof || {};
      const learningTone = velocity.status === "HIGH_SPEED_LEARNING" ? "good" : (velocity.status === "STALE" ? "bad" : "warn");
      const proofTone = proof.status === "COMPLETE" ? "good" : "warn";
      const flowCards = [
        {
          icon: "🛡️",
          label: "Safety",
          value: data.live_order_allowed === true ? "Stop" : "Live blocked",
          tone: data.live_order_allowed === true ? "bad" : "good",
          note: data.live_order_allowed === true ? "Live order authority appeared enabled; halt immediately." : "Paper-only wall is closed and the dashboard cannot place live orders.",
        },
        {
          icon: "⚡",
          label: "Learning Speed",
          value: `${number(velocity.resolved_last_1h)} / hr`,
          tone: learningTone,
          note: `${number(accelerator.rows_needed_to_learning_target)} Weather/Crypto rows to 1,000; latest label age ${velocity.latest_learning_age_minutes == null ? "n/a" : `${Number(velocity.latest_learning_age_minutes).toFixed(1)} min`}.`,
        },
        {
          icon: "⚖️",
          label: "Fair Comparison",
          value: `${Number(equalWeighting.weight_pct_per_strategy || 0).toFixed(1)}% each`,
          tone: equalWeighting.enabled ? "good" : "warn",
          note: "Every strategy row gets equal comparison weight plus the same explicit P&L delta state.",
        },
        {
          icon: "🧬",
          label: "Data Integrity",
          value: `${number(tracking.validated_labels)} labels`,
          tone: criticalFields.length ? "warn" : "good",
          note: `${number(tracking.total_tracked_decisions)} tracked paper decisions; ${number(criticalFields.length)} critical field groups still need repair.`,
        },
        {
          icon: "🎯",
          label: "Next Frontier",
          value: frontier.domain ? standardizeStrategyText(frontier.domain) : "Queue clear",
          tone: frontier.segment_key ? "warn" : "good",
          note: frontier.segment_key ? `${frontier.segment_key}; needs ${number(frontier.labels_needed_to_shadow_qualified)} more shadow labels.` : "No under-sampled positive Weather/Crypto frontier segment is queued.",
        },
        {
          icon: "🚦",
          label: "Proof Gate",
          value: proof.status === "COMPLETE" ? "Passed" : "Blocked",
          tone: proofTone,
          note: proof.next_action || `Paper P&L ${money(perf.paper_pnl_usd)}; continue clean forward-paper proof.`,
        },
      ];
      document.getElementById("command-flow").innerHTML = flowCards.map((card) => `<article class="flow-card ${esc(card.tone)}">
        <div class="flow-top"><div><div class="label">${text(card.label)}</div></div><div class="flow-icon" aria-hidden="true">${esc(card.icon)}</div></div>
        <div class="flow-value ${esc(card.tone)}">${text(card.value)}</div>
        <div class="flow-note">${text(card.note)}</div>
      </article>`).join("");
    }

    function renderPlainSummary(plain, status) {
      const bullets = (plain.bullets || []).slice(0, 5).map((item) => `<li>${text(item)}</li>`).join("");
      const next = (plain.next_steps || []).slice(0, 4).map((item) => `<li>${text(item)}</li>`).join("");
      document.getElementById("plain-summary").innerHTML = `
        <article class="summary-card tone-${esc(status.tone)}">
          <span class="pill ${esc(status.tone)}"><span class="dot"></span>${text(status.title)}</span>
          <h2 style="margin-top:14px">${text(status.detail)}</h2>
          <ul>${bullets || "<li>Paper evidence is loading.</li>"}</ul>
        </article>
        <article class="summary-card tone-good">
          <span class="pill safe"><span class="dot"></span>Next</span>
          <h2 style="margin-top:14px">What OpenClaw should do now</h2>
          <ul>${next || "<li>Keep collecting clean, source-backed paper outcomes.</li>"}</ul>
        </article>`;
    }

    function renderLearningLanes(perf) {
      const cat = perf.category_accuracy || {};
      const cards = ["weather", "crypto", "sports"].map((name) => {
        const s = cat[name] || {};
        const accuracy = Number(s.accuracy || 0);
        const pnl = Number(s.pnl || 0);
        const status = name === "sports"
          ? "Halted for accepted exposure unless proof improves"
          : (Number(s.scored || 0) >= 100 ? "Learning with scored evidence" : "Needs more fast outcomes");
        const tone = name === "sports" ? "bad" : (pnl >= 0 ? "good" : "warn");
        return `<article class="card lane-card soft-card">
          <div>
            <div class="lane-title"><div><div class="label">${esc(laneLabel[name])}</div><h3>${esc(status)}</h3></div><div class="lane-icon" aria-hidden="true">${esc(laneEmoji[name])}</div></div>
            <div class="progress" aria-label="${esc(laneLabel[name])} accuracy"><span style="--w:${Math.max(0, Math.min(100, accuracy * 100)).toFixed(1)}%"></span></div>
          </div>
          <div class="lane-stats">
            <div class="mini"><span class="label">Accuracy</span><strong>${pct(s.accuracy)}</strong></div>
            <div class="mini"><span class="label">P&L</span><strong class="${tone}">${esc(money(pnl))}</strong></div>
            <div class="mini"><span class="label">Scored</span><strong>${number(s.scored)}</strong></div>
            <div class="mini"><span class="label">Wins</span><strong>${number(s.wins)}</strong></div>
          </div>
        </article>`;
      });
      document.getElementById("learning-lanes").innerHTML = cards.join("");
    }

    function renderStsPolicySnapshot(data) {
      const snapshot = data.sts_policy_snapshot || {};
      const weather = snapshot.weather || {};
      const crypto = snapshot.crypto || {};
      const weatherIntensity = Number(weather.policy_intensity || 0);
      const cryptoIntensity = Number(crypto.policy_intensity || 0);
      const weatherReasons = Array.isArray(weather.policy_reasons) ? weather.policy_reasons : [];
      const cryptoReasons = Array.isArray(crypto.policy_reasons) ? crypto.policy_reasons : [];
      const rows = [
        ["Weather Policy", weatherIntensity > 0 ? "Applied" : "Static", `${weather.source_loaded ? "Loaded from STS artifact" : "No active STS artifact"}, ${weather.sts_artifact_path || "path unavailable"}.`, weatherIntensity > 0 ? "good" : "warn"],
        ["Weather Policy Source", weather.source_loaded ? "Loaded" : "Missing", `Edge mult ${(weather.effective_edge_threshold_multiplier == null ? "n/a" : `${Math.round((weather.effective_edge_threshold_multiplier || 0) * 1000) / 1000}`)} · Conf mult ${(weather.effective_model_confidence_multiplier == null ? "n/a" : `${Math.round((weather.effective_model_confidence_multiplier || 0) * 1000) / 1000}`)}.`, weather.source_loaded ? "good" : "warn"],
        ["Weather Policy Gates", `${weather.base_minimum_edge_after_costs_pct == null ? "n/a" : `${weather.base_minimum_edge_after_costs_pct}%`} base | ${weather.effective_minimum_edge_after_costs_pct == null ? "n/a" : `${weather.effective_minimum_edge_after_costs_pct}%`} effective`, weatherReasons.length ? weatherReasons.slice(0, 2).join("; ") : "No reason metadata from latest weather lane.", (weatherIntensity > 0 || (weather.base_minimum_edge_after_costs_pct != null)) ? "good" : "warn"],
        ["Crypto Policy", cryptoIntensity > 0 ? "Applied" : "Static", `${crypto.source_loaded ? "Loaded from STS artifact" : "No active STS artifact"}, ${crypto.sts_artifact_path || "path unavailable"}.`, cryptoIntensity > 0 ? "good" : "warn"],
        ["Crypto Policy Source", crypto.source_loaded ? "Loaded" : "Missing", `Edge mult ${(crypto.effective_edge_threshold_multiplier == null ? "n/a" : `${Math.round((crypto.effective_edge_threshold_multiplier || 0) * 1000) / 1000}`)} · Conf mult ${(crypto.effective_model_confidence_multiplier == null ? "n/a" : `${Math.round((crypto.effective_model_confidence_multiplier || 0) * 1000) / 1000}`)}.`, crypto.source_loaded ? "good" : "warn"],
        ["Crypto Policy Gates", `${crypto.base_minimum_edge_after_costs_cents == null ? "n/a" : `${crypto.base_minimum_edge_after_costs_cents}`}¢ base | ${crypto.effective_minimum_edge_after_costs_cents == null ? "n/a" : `${crypto.effective_minimum_edge_after_costs_cents}`}¢ effective`, cryptoReasons.length ? cryptoReasons.slice(0, 2).join("; ") : "No reason metadata from latest crypto lane.", (cryptoIntensity > 0 || (crypto.base_minimum_edge_after_costs_cents != null)) ? "good" : "warn"],
      ];
      document.getElementById("sts-policy-snapshot").innerHTML = rows.map(([label, value, note, tone]) => `<article class="card ${esc(tone)}"><div class="label">${text(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
    }

    function renderStsDomainLearningOptimizer(data) {
      const optimizer = data.sts_domain_learning_optimizer || {};
      const stsDash = data.sts_trading_dashboard || {};
      const proofPromotion = stsDash.proof_promotion || {};
      const forwardProof = data.gap01_forward_proof || {};
      const proofLane = forwardProof.leading_lane || {};
      const lanes = Array.isArray(optimizer.domain_lanes) ? optimizer.domain_lanes : [];
      const best = optimizer.best_domain_to_improve_next || {};
      const blockedPressure = optimizer.blocked_candidate_pressure || {};
      const proofTarget = Number(forwardProof.target_scored_positive_baseline_beating_outcomes || 100);
      const proofScored = Number(proofLane.scored || 0);
      const headingCards = [
        ["Best Focus Domain", best.domain || (lanes[0] && lanes[0].domain) || "unknown", optimizer.next_action || "Run STS domain learning optimizer after artifacts refresh.", optimizer.next_action ? "warn" : "good", "The domain STS should improve next, chosen from current blockers, candidate supply, and readiness gaps."],
        ["Domain Policy", optimizer.domain_separation_policy && optimizer.domain_separation_policy.future_market_categories_separated ? "Separated by domain" : "Undefined", "Lane recommendations avoid cross-domain policy transfer by default.", optimizer.domain_separation_policy && optimizer.domain_separation_policy.future_market_categories_separated ? "good" : "warn", "Domain separation keeps weather, crypto, sports, and future categories from borrowing each other's proof unless explicitly certified."],
        ["Learning Priority", typeof best.learning_priority_score === "number" ? `${Math.round(best.learning_priority_score * 100) / 100}` : "n/a", optimizer.plain_english || "Domain optimizer is not yet available.", best.learning_priority_score == null ? "warn" : "good", "A relative score for where more labels should most improve the STS model; higher means better next learning focus, not live permission."],
        ["Blocked Candidates", `${number(blockedPressure.total_recent_blocked_candidates || 0)} total`, `${number(blockedPressure.recent_12h || 0)} in 12h / ${number(blockedPressure.recent_24h || 0)} in 24h · ${number(blockedPressure.domains_without_candidates || 0)} domains need candidates`, number(blockedPressure.total_recent_blocked_candidates || 0) > 0 ? "warn" : "good", "Candidate rows recently rejected by safety/proof gates; useful for learning why not to trade, but they do not count as proof outcomes."],
        ["Weather/Crypto Pressure", Number(blockedPressure.weather_crypto_blocked_pressure || 0).toFixed(2), "Relative recent blocked-candidate pressure signal for focused learning reallocation.", Number(blockedPressure.weather_crypto_blocked_pressure || 0) > 0 ? "warn" : "good", "A focused pressure signal from weather/crypto blocked candidates; high pressure means scan/repair these lanes faster while keeping live trading off."],
        ["Weather/Crypto Scanned", number(proofPromotion.weather_crypto_scanned_count || 0), `${number(proofPromotion.scanned_candidate_count || 0)} total STS promotion candidates scanned.`, Number(proofPromotion.weather_crypto_scanned_count || 0) > 0 ? "good" : "warn", "The count of weather/crypto candidates screened for tiny forward-paper proof. A value like 1,200 means broad scan coverage, not 1,200 approved paper trades."],
        ["Proof Outcomes", `${number(proofScored)}/${number(proofTarget)}`, forwardProof.next_action || "Needs accepted-forward outcomes that are profitable and baseline-beating.", proofScored >= proofTarget ? "good" : "warn", "Accepted forward-paper outcomes that count toward GAP-01 proof. A value like 14,031/100 is only acceptable when those outcomes are clean, profitable, baseline-beating, and not excluded as shadow/exploration."],
      ];
      const laneCards = lanes.slice(0, 4).map((lane) => {
        const pressure = Number(lane.recent_blocked_pressure == null ? 0 : lane.recent_blocked_pressure);
        const blockedTotal = Number(lane.blocked_candidate_count || 0);
        const blocked12h = Number(lane.blocked_candidate_count_12h || 0);
        const blocked24h = Number(lane.blocked_candidate_count_24h || 0);
        const tone = lane.should_repair_evidence ? "warn" : (lane.should_improve_baseline_selection ? "warn" : "good");
        return `<article class="card ${esc(tone)}">
          <div class="label">${helpLabel(`${(lane.domain || "unknown").toUpperCase()} lane`, "Per-domain STS learning lane. The score reflects learning priority and blocked-candidate pressure, not approval to trade live.")}</div>
          <div class="metric-value ${esc(tone)}">${lane.learning_priority_score == null ? "n/a" : Number(lane.learning_priority_score).toFixed(2)}</div>
          <div class="metric-note">${text(lane.status || "blocked")} · blocked candidates ${blockedTotal} (12h ${blocked12h}, 24h ${blocked24h}) · recent pressure ${pressure.toFixed(2)}</div>
        </article>`;
      });
      document.getElementById("sts-domain-learning-optimizer").innerHTML = [
        ...headingCards.map(([label, value, note, tone, definition]) => `<article class="card ${esc(tone)}"><div class="label">${helpLabel(label, definition)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`),
        ...laneCards,
      ].join("");
      document.getElementById("sts-domain-learning-definitions").innerHTML = `
        <div class="status-line">
          <span class="pill warn"><span class="dot"></span>Visible definitions</span>
          <span class="muted">Updated dashboard copy for the STS Domain Learning Command Center.</span>
        </div>
        <h2 style="margin-top:14px">What do these progress numbers mean?</h2>
        <div class="definition-list">
          <div class="definition-item"><strong>0/100 paper progress</strong><span>STS cannot direct accepted paper yet. The paper score rises only when safety, data integrity, market-baseline, profitability, and forward-proof gates pass.</span></div>
          <div class="definition-item"><strong>99/100 live-review progress</strong><span>Still not live trading. Live review also needs accepted-paper proof, live safety gates, and explicit human approval. The dashboard remains read-only and paper-only.</span></div>
          <div class="definition-item"><strong>1,200 Weather/Crypto scanned</strong><span>Candidate scan coverage. It means weather/crypto opportunities were screened for tiny forward-paper proof; it does not mean 1,200 trades were approved.</span></div>
          <div class="definition-item"><strong>14,031/100 proof outcomes</strong><span>Large historical counts count only if they are clean accepted-forward outcomes that are profitable, baseline-beating, and not excluded as shadow or exploration.</span></div>
        </div>`;
    }

    function renderWeatherCryptoCommand(data) {
      const ml = data.weather_crypto_ml || {};
      const weatherScan = data.weather_candidate_scan || {};
      const weatherPolicy = weatherScan.learning_acceleration_policy || {};
      const betting = ml.paper_betting || {};
      const reality = ml.reality_contract || {};
      const dataset = ml.ml_dataset || {};
      const model = ml.ml_model || {};
      const certification = model.certification || {};
      const buildGaps = model.ml_build_gap_summary || {};
      const edgeDecay = model.edge_decay_diagnostics || {};
      const latestRecovery = ml.latest_scheduled_recovery || {};
      const quarantineSummary = latestRecovery.quarantine_recovery_summary || {};
      const recoveryCoverage = latestRecovery.recovery_candidate_coverage || {};
      const recoveryRetryPlan = latestRecovery.quarantine_recovery_retry_plan || {};
      const frontierSamplingPlan = latestRecovery.weather_frontier_sampling_plan || {};
      const frontierSamplingResult = latestRecovery.weather_frontier_sampling_result || {};
      const accelerator = ml.learning_accelerator || {};
      const crypto = data.crypto_evidence || {};
      const cryptoPolicy = crypto.learning_acceleration_policy || {};
      const rowDeficits = accelerator.row_deficits || {};
      const proofDeficits = accelerator.proof_deficits || {};
      const resolverPriorities = accelerator.resolver_priorities || {};
      const acquisitionTargets = accelerator.candidate_acquisition_targets || [];
      const profitSelectorTargets = accelerator.profit_selector_forward_targets || [];
      const frontierTargets = ml.segment_frontier_acquisition_targets || [];
      const queue = ml.active_learning_queue || [];
      const commandCards = [
        ["Weather Candidate Policy", weatherPolicy.policy_intensity > 0 ? "Applied" : "Static", weatherPolicy.policy_reasons ? weatherPolicy.policy_reasons.join("; ") : "No weather policy metadata loaded.", weatherPolicy.policy_intensity > 0 ? "good" : "warn"],
        ["Weather Edge Policy Mult", `${Math.round((weatherPolicy.effective_edge_threshold_multiplier || 1.0) * 1000) / 1000}`, `Base ${weatherScan.base_minimum_edge_after_costs_pct == null ? "n/a" : `${weatherScan.base_minimum_edge_after_costs_pct}%`}. Effective ${weatherScan.effective_minimum_edge_after_costs_pct == null ? "n/a" : `${weatherScan.effective_minimum_edge_after_costs_pct}%`}.`, Number(weatherPolicy.policy_intensity || 0) > 0 ? "good" : "warn"],
        ["Weather Confidence Policy Mult", `${Math.round((weatherPolicy.effective_model_confidence_multiplier || 1.0) * 1000) / 1000}`, `Base ${weatherScan.base_minimum_model_confidence_score == null ? "n/a" : `${weatherScan.base_minimum_model_confidence_score}`}. Effective ${weatherScan.effective_minimum_model_confidence_score == null ? "n/a" : `${weatherScan.effective_minimum_model_confidence_score}`}.`, Number(weatherPolicy.policy_intensity || 0) > 0 ? "good" : "warn"],
        ["ML Status", String(ml.status || "not generated").replaceAll("_", " "), ml.plain_english || "Weather/crypto ML artifact has not generated yet.", ml.status === "proven_forward_paper_ready" ? "good" : "warn"],
        ["Dataset Rows", number(dataset.row_count), "Leakage-guarded Weather/Crypto rows available for model training.", Number(dataset.row_count || 0) > 0 && Number(dataset.leakage_rejected_count || 0) === 0 ? "good" : "warn"],
        ["Rows To 250", number(rowDeficits.rows_needed), rowDeficits.plain_english || "Learning accelerator has not computed the dataset deficit yet.", Number(rowDeficits.rows_needed || 0) === 0 ? "good" : "warn"],
        ["Next Labels Due", number(resolverPriorities.due_or_overdue_count), resolverPriorities.plain_english || "Learning accelerator has not ranked due labels yet.", Number(resolverPriorities.due_or_overdue_count || 0) === 0 ? "good" : "warn"],
        ["Acquisition Targets", number(acquisitionTargets.length), "Drift, row-count, and calibration blockers converted into concrete paper-only acquisition tasks.", acquisitionTargets.length ? "warn" : "good"],
        ["Crypto Policy Mult", `${Math.round((cryptoPolicy.effective_edge_threshold_multiplier || 1.0) * 1000) / 1000}`, `Base ${(crypto.base_minimum_edge_after_costs_cents == null ? "n/a" : `${crypto.base_minimum_edge_after_costs_cents}`)} | Effective ${(crypto.effective_minimum_edge_after_costs_cents == null ? "n/a" : `${crypto.effective_minimum_edge_after_costs_cents}`)} (cents).`, Number(cryptoPolicy.policy_intensity || 0) > 0 ? "good" : "warn"],
        ["Crypto Confidence", `${Math.round((cryptoPolicy.effective_model_confidence_multiplier || 1.0) * 1000) / 1000}`, `Base ${(crypto.base_minimum_model_confidence_score == null ? "n/a" : `${crypto.base_minimum_model_confidence_score}`)} | Effective ${(crypto.effective_minimum_model_confidence_score == null ? "n/a" : `${crypto.effective_minimum_model_confidence_score}`)}.`, Number(cryptoPolicy.policy_intensity || 0) > 0 ? "good" : "warn"],
        ["Crypto Policy", cryptoPolicy.policy_intensity > 0 ? "Applied" : "Static", Array.isArray(cryptoPolicy.policy_reasons) ? cryptoPolicy.policy_reasons.join("; ") : "No crypto policy metadata loaded.", cryptoPolicy.policy_intensity > 0 ? "good" : "warn"],
        ["Inverse Repair Capture", `${number(crypto.inverse_repair_shadow_candidate_count || 0)} / ${number(crypto.inverse_repair_shadow_created_count || 0)}`, (() => { const plan = crypto.inverse_repair_capture && crypto.inverse_repair_capture.top_market_bucket_capture_plan; const band = plan && plan.target_price_band; const planText = band ? ` · target ${plan.target_bucket}: ${band.selected_side_price_min_cents}c-${band.selected_side_price_max_cents}c` : ""; return crypto.inverse_repair_capture && crypto.inverse_repair_capture.next_action ? `${String(crypto.inverse_repair_shadow_primary_capture_blocker || "pending").replaceAll("_", " ")} · ${crypto.inverse_repair_capture.next_action}${planText}` : "No inverse-repair capture diagnostic has been recorded yet."; })(), Number(crypto.inverse_repair_shadow_created_count || 0) > 0 ? "good" : "warn"],
        ["Profit Selector Targets", number(profitSelectorTargets.length), "Ranked train-only Weather/Crypto selector segments queued for fresh forward proof; shadow does not count until graduated.", profitSelectorTargets.length ? "warn" : "good"],
        ["Calibration Blocker", proofDeficits.expected_calibration_error == null ? "n/a" : pct(proofDeficits.expected_calibration_error), "Target ECE is 8.0% or lower before offline certification.", Number(proofDeficits.expected_calibration_error || 0) <= 0.08 && proofDeficits.expected_calibration_error != null ? "good" : "warn"],
        ["Drift Blockers", number(proofDeficits.drift_alert_count), "Target drift alert count is zero.", Number(proofDeficits.drift_alert_count || 0) === 0 ? "good" : "warn"],
        ["Frontier Segments", number(ml.segment_frontier_target_count || frontierTargets.length), "Best under-sampled positive Weather/Crypto segments to fill next.", frontierTargets.length ? "warn" : "good"],
        ["Model Champion", String(model.champion_status || "not generated").replaceAll("_", " "), model.plain_english || "Weather/Crypto model registry has not generated yet.", model.champion_model_id && certification.ml_9_9_ready ? "good" : "warn"],
        ["ML 10/10 Gate", certification.ml_10_ready ? "ready" : "blocked", certification.plain_english || "10/10 remains blocked until offline certification, forward-paper proof, and human approval all pass.", certification.ml_10_ready ? "good" : "warn"],
        ["20 ML Build Gaps", `${number(buildGaps.build_complete_count || 0)}/${number(buildGaps.total_gaps || 20)}`, buildGaps.plain_english || "Palantir-style build gaps are tracked in the paper-only model registry.", buildGaps.all_build_gaps_complete ? "good" : "warn"],
        ["Empirical Proof Gaps", `${number(buildGaps.evidence_complete_count || 0)}/${number(buildGaps.total_gaps || 20)}`, "Evidence gaps are data/performance proof, not missing build controls.", buildGaps.empirical_profit_certification_complete ? "good" : "warn"],
        ["Paper Betting Segments", number(betting.allowed_segment_count || ml.paper_betting_allowed_segment_count), "Tiny paper-only probes allowed only for weather/crypto segments that passed promotion gates.", Number(betting.allowed_segment_count || 0) > 0 ? "good" : "warn"],
        ["Training Eligible", number(reality.training_eligible), "Reality-contract clean records available to train the segment ladder.", Number(reality.training_eligible || 0) > 0 ? "good" : "warn"],
        ["Quarantined", number(reality.quarantined_training), "Records excluded from ML until source/field contracts are repaired.", Number(reality.quarantined_training || 0) > 0 ? "warn" : "good"],
      ];
      document.getElementById("weather-crypto-command").innerHTML = commandCards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      const combinedQueue = [
        ...queue,
        ...acquisitionTargets.map((item, index) => ({...item, priority: item.priority || index + 20, segment_key: item.segment_key || "domain-wide"})),
      ];
      document.getElementById("weather-crypto-ml-summary").textContent = standardizeStrategyText(accelerator.plain_english || betting.plain_english || ml.next_required_proof || "Weather/crypto active-learning queue has not generated yet.");
      document.getElementById("weather-crypto-ml-table").innerHTML = header(["Priority", "Action", "Domain", "Segment", "Reason", "Command / Next Move"]) +
        (combinedQueue.length ? combinedQueue.slice(0, 12).map((item) => row([
          number(item.priority),
          text(String(item.action || "").replaceAll("_", " ")),
          text(item.domain || ""),
          text(item.segment_key || "domain-wide"),
          text(item.reason || ""),
          text(item.recommended_command || "continue scheduled learning"),
        ])).join("") : emptyRow(6, "No weather/crypto active-learning actions are queued yet."));
      const recoveryPrioritySegments = (
        Array.isArray(quarantineSummary.recovery_sampling_priority_segments) && quarantineSummary.recovery_sampling_priority_segments.length
          ? quarantineSummary.recovery_sampling_priority_segments
          : (Array.isArray(edgeDecay.recovery_sampling_priority_segments) ? edgeDecay.recovery_sampling_priority_segments : [])
      );
      const failureCounts = edgeDecay.recovery_failure_reason_counts || {};
      const topFailureReasons = Object.entries(failureCounts)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, 3)
        .map(([reason, count]) => `${String(reason).replaceAll("_", " ")}: ${count}`)
        .join("; ");
      const retryBlockers = recoveryRetryPlan.retry_blocker_counts || {};
      const topRetryBlocker = Object.entries(retryBlockers).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
      const coverageSeen = Number(recoveryCoverage.priority_segment_count_seen || 0);
      const coverageCreated = Number(recoveryCoverage.priority_segment_created_count || 0);
      const shadowCreated = Number(recoveryCoverage.quarantine_recovery_shadow_created_count || 0);
      const recoveryCards = [
        ["Quarantined Segments", number(quarantineSummary.quarantine_segment_count || edgeDecay.forward_paper_quarantine_segment_count || 0), "Segments barred from forward paper until fresh shadow recovery proof passes.", Number(quarantineSummary.quarantine_segment_count || edgeDecay.forward_paper_quarantine_segment_count || 0) > 0 ? "warn" : "good"],
        ["Recovered Segments", number(quarantineSummary.recovery_eligible_count || edgeDecay.forward_paper_quarantine_recovered_count || 0), "Segments that cleared the recovery gate and may re-enter paper consideration.", Number(quarantineSummary.recovery_eligible_count || edgeDecay.forward_paper_quarantine_recovered_count || 0) > 0 ? "good" : "warn"],
        ["Priority Coverage", `${number(coverageCreated)}/${number(coverageSeen)}`, "Latest scheduled cycle priority segments that produced recovery shadow candidates.", coverageSeen > 0 && coverageCreated >= coverageSeen ? "good" : "warn"],
        ["Recovery Shadows", number(shadowCreated), "Fresh SHADOW_QUARANTINE_RECOVERY rows created in the latest scheduled cycle; they are paper-learning rows, not live orders.", shadowCreated > 0 ? "good" : "warn"],
        ["Retry Plan", recoveryRetryPlan.retry_needed ? "Retry needed" : "No retry needed", `${number(recoveryRetryPlan.missing_priority_segment_count || 0)} priority segments still missing recovery shadows.`, recoveryRetryPlan.retry_needed ? "warn" : "good"],
        ["Top Runtime Blocker", topRetryBlocker ? `${String(topRetryBlocker[0]).replaceAll("_", " ")} (${topRetryBlocker[1]})` : "waiting for next cycle", "Runtime diagnosis from the latest scheduled recovery retry plan.", topRetryBlocker ? "warn" : "good"],
        ["Top Failure Reasons", topFailureReasons || "waiting for failure attribution", "Why quarantined segments are still blocked from forward-paper re-entry.", topFailureReasons ? "warn" : "good"],
        ["Live Authority", "Blocked", "Recovery candidates are forced to shadow-only with live_order_allowed=false.", "good"],
      ];
      document.getElementById("quarantine-recovery-summary").textContent = standardizeStrategyText(`Latest scheduled recovery refresh: ${latestRecovery.latest_scheduled_completed_at_utc || "unknown"}. Priority segments covered: ${coverageCreated}/${coverageSeen}. Forward-paper re-entry remains blocked unless recovery gates pass.`);
      document.getElementById("quarantine-recovery-cards").innerHTML = recoveryCards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${text(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      const frontierAttempted = Number(frontierSamplingResult.attempted_target_count || 0);
      const frontierCreated = Number(frontierSamplingResult.frontier_shadow_created_count || 0);
      const frontierCandidates = Number(frontierSamplingResult.frontier_shadow_candidate_count || 0);
      const frontierMatches = Number(frontierSamplingResult.frontier_shadow_target_match_count || 0);
      const frontierBlockedNoPrice = Number(frontierSamplingResult.frontier_shadow_blocked_no_price_count || 0);
      const frontierTimedOut = Number(frontierSamplingResult.timed_out_step_count || 0);
      const frontierBlockers = frontierSamplingResult.blocker_counts || {};
      const topFrontierBlocker = Object.entries(frontierBlockers).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
      const frontierCards = [
        ["Frontier Targets", `${number(frontierSamplingPlan.scheduled_target_count || 0)}/${number(frontierSamplingPlan.target_count || 0)}`, "Latest scheduler plan for positive under-sampled weather ML segments.", Number(frontierSamplingPlan.scheduled_target_count || 0) > 0 ? "warn" : "good"],
        ["Targets Attempted", number(frontierAttempted), "Weather frontier segments actually attempted in the latest completed scheduler cycle.", frontierAttempted > 0 ? "good" : "warn"],
        ["Frontier Shadows", number(frontierCreated), "Zero-exposure weather frontier shadow rows created; these speed learning but never authorize live orders.", frontierCreated > 0 ? "good" : "warn"],
        ["Target Matches", number(frontierMatches), `${number(frontierCandidates)} candidate shadows considered for frontier targets.`, frontierMatches > 0 ? "good" : "warn"],
        ["No-Price Blocks", number(frontierBlockedNoPrice), "Target markets seen but blocked because executable paper price was missing.", frontierBlockedNoPrice > 0 ? "warn" : "good"],
        ["Timeouts", number(frontierTimedOut), "Frontier sampling steps that timed out fail closed.", frontierTimedOut > 0 ? "warn" : "good"],
        ["Top Frontier Blocker", topFrontierBlocker ? `${String(topFrontierBlocker[0]).replaceAll("_", " ")} (${topFrontierBlocker[1]})` : "waiting for next target cycle", "Main runtime blocker for weather frontier active learning.", topFrontierBlocker ? "warn" : "good"],
        ["Frontier Live Authority", "Blocked", "Frontier sampling is shadow-only and reports live_order_allowed=false.", "good"],
      ];
      document.getElementById("weather-frontier-sampling-summary").textContent = standardizeStrategyText(`Weather frontier sampling: ${String(frontierSamplingResult.status || "waiting_for_next_cycle").replaceAll("_", " ")}. Latest target attempts: ${frontierAttempted}; frontier shadows created: ${frontierCreated}.`);
      document.getElementById("weather-frontier-sampling-cards").innerHTML = frontierCards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${text(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      const frontierRows = Array.isArray(frontierSamplingResult.targets) ? frontierSamplingResult.targets : [];
      document.getElementById("weather-frontier-sampling-table").innerHTML = header(["Segment", "Search", "Created", "Candidates", "Matches", "No-Price Blocks", "Status"]) +
        (frontierRows.length ? frontierRows.slice(0, 12).map((item) => row([
          text(item.segment_key || ""),
          text(item.search || ""),
          number(item.frontier_shadow_created_count || item.created_count || 0),
          number(item.frontier_shadow_candidate_count || 0),
          number(item.frontier_shadow_target_match_count || 0),
          number(item.frontier_shadow_blocked_no_price_count || 0),
          item.timed_out ? "timed out" : (item.ok ? "ok" : "blocked"),
        ])).join("") : emptyRow(7, "No completed weather frontier sampling steps are available yet."));
      document.getElementById("quarantine-recovery-table").innerHTML = header(["Rank", "Domain", "Segment", "Market Brier Gap", "Top Blocker", "Route"]) +
        (recoveryPrioritySegments.length ? recoveryPrioritySegments.slice(0, 12).map((item, index) => row([
          number(item.rank || index + 1),
          text(item.domain || ""),
          text(item.segment_key || ""),
          item.fresh_segment_candidate_minus_market_brier == null ? "n/a" : Number(item.fresh_segment_candidate_minus_market_brier).toFixed(6),
          text(String(item.top_recovery_failure_reason || "waiting_for_recovery_labels").replaceAll("_", " ")),
          item.recovery_eligible ? "recovery eligible" : "shadow quarantine recovery",
        ])).join("") : emptyRow(6, "No quarantine recovery priority segments are available yet."));
    }

    function renderCryptoRegimeSelector(data) {
      const selector = data.sts_crypto_regime_selector || {};
      const outcomes = data.sts_crypto_regime_selector_outcomes || {};
      const inverseRepair = data.sts_crypto_regime_inverse_repair || {};
      const active = Array.isArray(selector.active_shadow_experiments) ? selector.active_shadow_experiments : [];
      const acquisition = Array.isArray(selector.acquisition_shadow_experiments) ? selector.acquisition_shadow_experiments : [];
      const topRegimes = Array.isArray(selector.top_regimes) ? selector.top_regimes : [];
      const penalties = Array.isArray(selector.forward_regime_penalties) ? selector.forward_regime_penalties : [];
      const stabilityPenalties = Array.isArray(selector.retrospective_regime_stability_penalties) ? selector.retrospective_regime_stability_penalties : [];
      const acquisitionPlan = Array.isArray(selector.active_experiment_acquisition_plan) ? selector.active_experiment_acquisition_plan : [];
      const acquisitionShadowPlan = Array.isArray(selector.acquisition_shadow_experiment_plan) ? selector.acquisition_shadow_experiment_plan : [];
      const forward = Array.isArray(outcomes.forward_recorded_experiments) ? outcomes.forward_recorded_experiments : [];
      const pending = Array.isArray(outcomes.forward_recorded_pending_samples) ? outcomes.forward_recorded_pending_samples : [];
      const coverageCohortBlocks = Array.isArray(outcomes.coverage_probe_failure_cohort_blocks) ? outcomes.coverage_probe_failure_cohort_blocks : [];
      const topExperiment = outcomes.top_experiment || {};
      const inverseRepairs = Array.isArray(inverseRepair.repairs) ? inverseRepair.repairs : [];
      const topRepair = inverseRepair.top_repair || {};
      const cards = [
        ["Active Regime Experiments", number(selector.candidate_experiment_count || active.length), selector.next_action || "Run crypto regime selector.", active.length ? "warn" : "good"],
        ["Top Shadow Regime", active[0] ? String(active[0].regime_id || "") : "none", active[0] ? `P&L ${money(active[0].paper_pnl_usd)} · accuracy ${pct(active[0].accuracy)} · market-Brier uplift ${active[0].market_brier_uplift == null ? "n/a" : Number(active[0].market_brier_uplift).toFixed(6)}.` : "No recalibrated market-beating regime is queued.", active[0] ? "warn" : "good"],
        ["Forward Regime Outcomes", `${number(outcomes.forward_recorded_resolved_count || 0)} resolved`, `${number(outcomes.forward_recorded_pending_count || 0)} pending · ${number(outcomes.forward_recorded_due_pending_count || 0)} due now · next due ${outcomes.next_forward_result_due_utc || "n/a"}.`, Number(outcomes.forward_recorded_due_pending_count || 0) > 0 ? "warn" : "good"],
        ["Top Forward Experiment", topExperiment.regime_id || "none", topExperiment.regime_id ? `P&L ${money(topExperiment.paper_pnl_usd)} · accuracy ${pct(topExperiment.accuracy)} · uplift ${topExperiment.market_brier_uplift == null ? "n/a" : Number(topExperiment.market_brier_uplift).toFixed(6)}.` : outcomes.next_action || "Waiting for attributed outcomes.", topExperiment.regime_id ? "good" : "warn"],
        ["Coverage Probe Outcomes", `${number(outcomes.forward_recorded_coverage_probe_resolved_count || 0)} resolved`, `${number(outcomes.forward_recorded_coverage_probe_pending_count || 0)} pending · ${number(outcomes.forward_recorded_coverage_probe_due_count || 0)} due; coverage probes are learning-only and never live-readiness proof.`, Number(outcomes.forward_recorded_coverage_probe_pending_count || 0) > 0 ? "warn" : "good"],
        ["Inverse Repair Shadows", `${number(outcomes.forward_recorded_inverse_repair_shadow_resolved_count || 0)} resolved`, `${number(outcomes.forward_recorded_inverse_repair_shadow_pending_count || 0)} pending · ${number(outcomes.forward_recorded_inverse_repair_shadow_due_count || 0)} due; inverse-repair shadows collect zero-exposure proof only.`, Number(outcomes.forward_recorded_inverse_repair_shadow_pending_count || 0) > 0 ? "warn" : "good"],
        ["Inverse Repair Proof Gate", String((outcomes.inverse_repair_shadow_proof_gate || {}).status || "missing").replaceAll("_", " "), `${number((outcomes.inverse_repair_shadow_proof_gate || {}).resolved_count || 0)}/${number((outcomes.inverse_repair_shadow_proof_gate || {}).target_resolved_shadow_outcomes || 10)} resolved · P&L ${money((outcomes.inverse_repair_shadow_proof_gate || {}).paper_pnl_usd || 0)} · live credit: never.`, (outcomes.inverse_repair_shadow_proof_gate || {}).paper_followup_allowed ? "warn" : "good"],
        ["Coverage Cohort Blocks", number(coverageCohortBlocks.length), coverageCohortBlocks[0] ? `${String(coverageCohortBlocks[0].coverage_cohort_key || "").replace("coverage_cohort:", "")} paused after ${number(coverageCohortBlocks[0].loss_count || 0)}/${number(coverageCohortBlocks[0].resolved_count || 0)} losses.` : "No failed side/hour coverage cohort is paused.", coverageCohortBlocks.length ? "warn" : "good"],
        ["Inverse Repair Candidate", topRepair.regime_id || "none", topRepair.regime_id ? `${String(topRepair.recommended_action || "").replaceAll("_", " ")} · inverse uplift ${money(topRepair.inverse_pnl_uplift_usd || 0)} · inverse accuracy ${pct(topRepair.inverse_accuracy)}.` : "No crypto inverse-repair candidate is ready.", topRepair.recommended_action === "test_inverse_forward_shadow" ? "warn" : "good"],
        ["Resolver Readiness", outcomes.resolver_ready ? "Ready" : "Waiting", outcomes.resolver_ready ? "Run source-backed outcome resolution now." : `Safe after ${outcomes.resolver_safe_after_utc || "n/a"} · ${String(outcomes.resolver_readiness_reason || "").replaceAll("_", " ")}.`, outcomes.resolver_ready ? "warn" : "good"],
        ["Paused Forward Regimes", number(selector.paused_forward_regime_count || penalties.length), penalties.length ? penalties.slice(0, 2).map((p) => `${String(p.regime_id || "").replace("regime:", "")}: ${(p.blockers || []).slice(0, 2).join(", ")}`).join("; ") : "No underperforming forward regimes are paused.", penalties.length ? "warn" : "good"],
        ["Overfit Stability Pauses", number(selector.paused_retrospective_stability_regime_count || stabilityPenalties.length), stabilityPenalties.length ? stabilityPenalties.slice(0, 2).map((p) => `${String(p.regime_id || "").replace("regime:", "")}: ${money(p.retrospective_paper_pnl_usd || 0)}`).join("; ") : "No broad-history overfit stability pause is active.", stabilityPenalties.length ? "warn" : "good"],
        ["Regime Capture Window", acquisitionPlan[0] && acquisitionPlan[0].current_time_matches_regime ? "Now" : (acquisitionPlan[0] && acquisitionPlan[0].next_match_start_utc ? acquisitionPlan[0].next_match_start_utc : "n/a"), acquisitionPlan[0] ? acquisitionPlan[0].why : "No active regime acquisition plan.", acquisitionPlan[0] && acquisitionPlan[0].current_time_matches_regime ? "good" : "warn"],
        ["Current-Window Acquisition", number(selector.acquisition_shadow_experiment_count || acquisition.length), acquisition[0] ? `${String(acquisition[0].regime_id || "").replace("regime:", "")} · ${acquisitionShadowPlan[0] && acquisitionShadowPlan[0].current_time_matches_regime ? "capture now" : "queued"}` : "No non-proof current-window acquisition shadow is needed.", acquisition.length ? "warn" : "good"],
        ["Live Authority", "Blocked", "Crypto regimes are forward-shadow only; they cannot authorize accepted paper or live orders.", "good"],
      ];
      document.getElementById("crypto-regime-selector-summary").textContent = standardizeStrategyText(selector.plain_english || outcomes.plain_english || "Crypto regime selector has not generated yet.");
      document.getElementById("crypto-regime-selector-cards").innerHTML = cards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${text(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("crypto-regime-selector-table").innerHTML = header(["Regime", "Rows", "P&L", "Accuracy", "Recal Brier", "Market Brier", "Uplift", "Status"]) +
        (topRegimes.length ? topRegimes.slice(0, 10).map((item) => row([
          text(item.regime_id || ""),
          number(item.test_rows || 0),
          money(item.paper_pnl_usd || 0),
          pct(item.accuracy),
          item.recalibrated_brier == null ? "n/a" : Number(item.recalibrated_brier).toFixed(6),
          item.market_brier == null ? "n/a" : Number(item.market_brier).toFixed(6),
          item.market_brier_uplift == null ? "n/a" : Number(item.market_brier_uplift).toFixed(6),
          item.shadow_candidate ? "shadow queued" : text((item.blockers || []).slice(0, 2).join(", ") || "blocked"),
        ])).join("") : emptyRow(8, "No crypto regimes are available yet."));
      const outcomeRows = forward.length ? forward : pending;
      document.getElementById("crypto-regime-outcomes-table").innerHTML = header(["Forward Regime", "Resolved/Pending", "P&L", "Accuracy", "Uplift", "Next/Due", "Proof Credit"]) +
        (outcomeRows.length ? outcomeRows.slice(0, 10).map((item) => row([
          text(item.regime_id || ""),
          `${number(item.resolved_count || 0)}/${number(item.expected_result_known_time_utc ? 1 : item.matched_row_count || 0)}`,
          item.paper_pnl_usd == null ? "n/a" : money(item.paper_pnl_usd),
          item.accuracy == null ? "n/a" : pct(item.accuracy),
          item.market_brier_uplift == null ? "n/a" : Number(item.market_brier_uplift).toFixed(6),
          text(item.expected_result_known_time_utc || outcomes.next_forward_result_due_utc || ""),
          text(item.proof_credit || "shadow_pending_no_live_credit"),
        ])).join("") : emptyRow(7, "No forward-recorded crypto regime outcomes or pending rows are available yet."));
      document.getElementById("crypto-coverage-cohort-blocks-table").innerHTML = header(["Coverage Cohort", "Resolved", "Losses", "P&L", "Action", "Live Credit"]) +
        (coverageCohortBlocks.length ? coverageCohortBlocks.slice(0, 10).map((item) => row([
          text(item.coverage_cohort_key || ""),
          number(item.resolved_count || 0),
          number(item.loss_count || 0),
          money(item.paper_pnl_usd || 0),
          text(String(item.action || "").replaceAll("_", " ")),
          item.counts_for_live_readiness ? "counts" : "no live-readiness credit",
        ])).join("") : emptyRow(6, "No failed coverage side/hour cohort blocks are active."));
      document.getElementById("crypto-regime-inverse-repair-table").innerHTML = header(["Regime", "Action", "Rows", "Selected P&L", "Inverse P&L", "Inverse Uplift", "Live Credit"]) +
        (inverseRepairs.length ? inverseRepairs.slice(0, 10).map((item) => row([
          text(item.regime_id || ""),
          text(String(item.recommended_action || "").replaceAll("_", " ")),
          number(item.resolved_count || 0),
          money(item.selected_paper_pnl_usd || 0),
          money(item.inverse_paper_pnl_usd || 0),
          money(item.inverse_pnl_uplift_usd || 0),
          item.counts_for_live_readiness ? "counts" : "no live-readiness credit",
        ])).join("") : emptyRow(7, "No inverse repair diagnostics are available yet."));
    }

    function renderSourceLagSurface(data) {
      const sourceLag = data.source_lag_surface_strategy || {};
      const summary = sourceLag.summary || {};
      const nws = sourceLag.nws_cli || {};
      const nwsFreshness = nws.freshness || {};
      const weather = sourceLag.weather || {};
      const crypto = sourceLag.crypto || {};
      const cryptoBasis = crypto.basis_readiness || {};
      const hypotheses = sourceLag.ranked_hypotheses || [];
      const blockers = sourceLag.blockers || [];
      const cards = [
        ["Strategy Status", String(summary.status || sourceLag.status || "not generated").replaceAll("_", " "), sourceLag.plain_english || "Source-lag artifact has not generated yet.", sourceLag.ok ? "warn" : "bad"],
        ["Weather Surface Targets", number(summary.weather_surface_target_count || (weather.ranked_surface_targets || []).length), weather.graduation_rule || "Weather graduates only after exact NWS CLI settlement alignment.", Number(summary.weather_surface_target_count || 0) > 0 ? "warn" : "good"],
        ["NWS CLI Freshness", String(nwsFreshness.status || "unknown").replaceAll("_", " "), `${number(nwsFreshness.parsed_product_count)} parsed CLI products; latest ${nwsFreshness.latest_source_fetched_at_utc ? fmt(nwsFreshness.latest_source_fetched_at_utc) : "unknown"}.`, nwsFreshness.status === "FRESH" ? "good" : "warn"],
        ["Crypto Basis", String(cryptoBasis.status || crypto.status || "shadow only").replaceAll("_", " "), cryptoBasis.plain_english || crypto.graduation_rule || "Exact CFB RTI basis proof is required before crypto accepted paper.", cryptoBasis.status === "READY" ? "good" : "warn"],
        ["Shadow / Accepted", `${number(summary.shadow_only_candidate_count)} / ${number(summary.accepted_paper_candidate_count)}`, "Accepted remains zero unless clean evidence, positive after-cost edge, baselines, ML promotion, and settlement-source proof all pass.", Number(summary.accepted_paper_candidate_count || 0) > 0 ? "good" : "warn"],
        ["Live Authority", sourceLag.live_order_allowed === true ? "Stop" : "Blocked", "This strategy emits hypotheses only and cannot trade live.", sourceLag.live_order_allowed === true ? "bad" : "good"],
      ];
      document.getElementById("source-lag-surface-command").innerHTML = cards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("source-lag-surface-summary").innerHTML = `${text(sourceLag.plain_english || "Source-lag selective surface is waiting for an artifact.")} ${blockers.slice(0, 6).map((blocker) => `<span class="metric-chip">${text(String(blocker).replaceAll("_", " "))}</span>`).join("")}`;
      document.getElementById("source-lag-surface-table").innerHTML = header(["Rank", "Domain", "Hypothesis", "Sample", "Baseline Δ", "Route", "Source Lineage / Blocker"]) +
        (hypotheses.length ? hypotheses.slice(0, 16).map((item, index) => {
          const baseline = item.baseline_deltas || {};
          const lineage = item.source_lineage || {};
          const baselineText = [
            `Brier Δ ${baseline.brier_delta_vs_market == null ? "n/a" : Number(baseline.brier_delta_vs_market).toFixed(4)}`,
            `Acc Δ ${baseline.accuracy_delta_vs_random == null ? "n/a" : pct(baseline.accuracy_delta_vs_random)}`,
            `P&L ${money(baseline.pnl_delta_vs_no_trade_usd)}`,
          ].join("<br>");
          const route = item.accepted_paper_allowed ? "accepted paper eligible" : String(item.route || "SHADOW_ONLY").replaceAll("_", " ");
          const lineageText = `${lineage.settlement_source_required || "source proof required"}<br><span class="muted">${text((item.blockers || [item.route_reason || "waiting for proof"])[0])}</span>`;
          return row([
            number(index + 1),
            text(item.domain || ""),
            `<strong>${text(item.hypothesis_id || item.segment_key || "")}</strong><br><span class="muted">${text(item.city || item.asset || "")} ${text(item.target_date || item.market_type || "")}</span>`,
            number(item.sample_size),
            baselineText,
            `<span class="status">${text(route)}</span>`,
            lineageText,
          ]);
        }).join("") : emptyRow(7, "No source-lag/surface hypotheses are available yet. Run the source-lag strategy dry-run first."));
    }

    function renderProofMission(data) {
      const proof = data.gap01_forward_proof || {};
      const lane = proof.leading_lane || {};
      const target = Number(proof.target_scored_positive_baseline_beating_outcomes || 100);
      const scored = Number(lane.scored || 0);
      const progress = Math.max(0, Math.min(100, target ? scored / target * 100 : 0));
      const tone = proof.status === "COMPLETE" ? "good" : "warn";
      const laneName = lane.lane_key ? standardizeStrategyText(String(lane.lane_key).replaceAll("|", " / ")) : "No qualifying lane yet";
      document.getElementById("proof-mission").innerHTML = `
        <div class="status-line">
          <span class="pill ${tone}"><span class="dot"></span>${proof.status === "COMPLETE" ? "Complete" : "Open"}</span>
          <span class="muted">Completion Grade ${esc(proof.completion_grade ?? "2.0")}/10 · Criticality ${esc(proof.criticality ?? "10.0")}/10</span>
        </div>
        <h2 style="margin-top:14px">${text(proof.plain_english || "GAP-01 proof status is loading.")}</h2>
        <div class="progress" style="height:12px;margin:18px 0 10px" aria-label="GAP-01 proof progress"><span style="--w:${progress.toFixed(1)}%"></span></div>
        <div class="status-line">
          <strong>${number(scored)} / ${number(target)} outcomes ${help("Proof outcomes are accepted forward-paper results that are clean, profitable, baseline-beating, and not excluded as shadow or exploration. Large historical counts do not count unless they satisfy this exact proof contract.")}</strong>
          <span class="muted">${text(laneName)}</span>
        </div>
        <div class="grid" style="margin-top:14px">
          <div class="mini"><span class="label">${helpLabel("Accuracy", "Win rate for the leading accepted-forward proof lane; target is at least 55% before GAP-01 can pass.")}</span><strong>${pct(lane.accuracy)}</strong></div>
          <div class="mini"><span class="label">${helpLabel("Paper P&L", "Simulated profit/loss for the leading proof lane after paper costs; must be positive before proof can pass.")}</span><strong class="${classForValue(lane.paper_pnl_usd)}">${esc(money(lane.paper_pnl_usd))}</strong></div>
          <div class="mini"><span class="label">${helpLabel("Remaining", "How many additional qualifying proof outcomes are needed to reach the target count, usually 100.")}</span><strong>${number(lane.remaining_to_100 ?? target)}</strong></div>
          <div class="mini"><span class="label">${helpLabel("Next", "The next safest build or data action required to improve proof without enabling live trading.")}</span><strong>${text(proof.next_action || "Keep collecting proof.")}</strong></div>
        </div>`;
    }

    function renderBuildGapAudit(data) {
      const audit = data.build_gap_audit || {};
      const topGap = audit.top_next_gap || {};
      const movement = audit.completion_grade_movement || {};
      const draggers = Array.isArray(audit.top_grade_draggers) ? audit.top_grade_draggers : [];
      const grade = audit.completion_grade == null ? "unknown" : `${audit.completion_grade}/10`;
      const criticality = audit.criticality == null ? "10.0" : String(audit.criticality);
      const delta = movement.delta == null ? "n/a" : Number(movement.delta).toFixed(1);
      const cards = [
        ["Completion Grade", grade, audit.can_truthfully_claim_10 ? "All audited gates passed." : "Not a 10/10: the audit is explicit about remaining blockers.", audit.can_truthfully_claim_10 ? "good" : "warn"],
        ["Criticality", `${criticality}/10`, "Severity of the highest-priority remaining build gap.", Number(criticality || 0) >= 9 ? "bad" : "warn"],
        ["Top Gap", topGap.gap_id || "unknown", topGap.title || "Run the build gap audit to identify the next gap.", "warn"],
        ["Grade Movement", String(movement.status || "unknown").replaceAll("_", " "), `Delta since previous audit: ${delta}.`, Number(movement.delta || 0) > 0 ? "good" : "warn"],
        ["Critical Blockers", number(audit.critical_blocker_count || 0), "Critical build gaps that still prevent a truthful 10/10 claim.", Number(audit.critical_blocker_count || 0) > 0 ? "bad" : "good"],
        ["Live Authority", audit.live_order_allowed === true ? "Stop" : "Blocked", "Build-gap progress never grants live order authority.", audit.live_order_allowed === true ? "bad" : "good"],
      ];
      document.getElementById("build-gap-audit-summary").textContent = standardizeStrategyText(audit.plain_english || "Build gap audit has not loaded yet.");
      document.getElementById("build-gap-audit-cards").innerHTML = cards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${text(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("build-gap-audit-table").innerHTML = header(["Gap", "Title", "Grade", "Criticality", "Weighted Lost"]) +
        (draggers.length ? draggers.map((item) => row([
          text(item.gap_id || ""),
          text(item.title || ""),
          `${esc(item.completion_grade ?? "n/a")}/10`,
          `${esc(item.criticality ?? "n/a")}/10`,
          esc(item.weighted_lost ?? "n/a"),
        ])).join("") : emptyRow(5, "No build gap draggers are available yet."));
    }

    function renderPaperTradeAccelerator(data) {
      const accelerator = data.paper_trade_accelerator || {};
      const stsDash = data.sts_trading_dashboard || {};
      const learningControls = stsDash.learning_controls || {};
      const routeMix = accelerator.route_mix || {};
      const overall = routeMix.overall || {};
      const weatherCryptoRoute = routeMix.weather_crypto || {};
      const wcTotal = Number(weatherCryptoRoute.SHADOW_ONLY || 0) + Number(weatherCryptoRoute.ACCEPT_EXPLORATION || 0) + Number(weatherCryptoRoute.ACCEPT_PAPER || 0) + Number(weatherCryptoRoute.FORWARD_PAPER || 0);
      const pctWC = (value, total) => total > 0 ? `${Math.round((Number(value) / total) * 100)}%` : "0%";
      const pctOverall = (value, total) => total > 0 ? `${Math.round((Number(value) / total) * 100)}%` : "0%";
      const overallTotal = Number(overall.SHADOW_ONLY || 0) + Number(overall.ACCEPT_EXPLORATION || 0) + Number(overall.ACCEPT_PAPER || 0) + Number(overall.FORWARD_PAPER || 0);
      const rowsNeeded = Number(accelerator.rows_needed_to_learning_target || 0);
      const target = Number(accelerator.learning_target_rows || 1000);
      const validated = Number(accelerator.validated_weather_crypto_rows || 0);
      const progress = target ? Math.max(0, Math.min(100, validated / target * 100)) : 0;
      const perHour = accelerator.learning_rows_last_1h;
      const estimated = accelerator.estimated_hours_to_learning_target_at_current_rate;
      const nextCrypto = accelerator.next_crypto_check_time_utc ? fmt(accelerator.next_crypto_check_time_utc) : "not scheduled";
      const commands = accelerator.fastest_safe_loop || [];
      const constraints = accelerator.integrity_constraints || [];
      const pressureWeather = accelerator.learning_pressure_weather == null ? (learningControls.weather_crypto_learning_pressure_multiplier_weather || 1.0) : Number(accelerator.learning_pressure_weather);
      const pressureCrypto = accelerator.learning_pressure_crypto == null ? (learningControls.weather_crypto_learning_pressure_multiplier_crypto || 1.0) : Number(accelerator.learning_pressure_crypto);
      const stochasticPressure = accelerator.stochastic_process_pressure == null ? (learningControls.stochastic_process_pressure || 0.0) : Number(accelerator.stochastic_process_pressure);
      const stochasticSafety = accelerator.stochastic_pressure_safety_factor == null ? (learningControls.stochastic_pressure_safety_factor || 1.0) : Number(accelerator.stochastic_pressure_safety_factor);
      const executionReliability = accelerator.execution_reliability_score == null ? (learningControls.execution_reliability_score || 0.0) : Number(accelerator.execution_reliability_score);
      const velocityMultiplier = accelerator.learning_speed_boost == null ? (learningControls.learning_velocity_multiplier || 1.0) : Number(accelerator.learning_speed_boost);
      const reallocationGuard = accelerator.sports_reallocation_guard == null ? (learningControls.weather_crypto_reallocation_guard || 1.0) : Number(accelerator.sports_reallocation_guard);
      document.getElementById("paper-trade-accelerator").innerHTML = `
        <article class="focus-card">
          <div class="status-line">
            <span class="pill safe"><span class="dot"></span>${text(accelerator.mode || "PAPER_ONLY")}</span>
            <span class="muted">Weather/Crypto rows ${number(validated)} / ${number(target)}</span>
          </div>
          <h2 style="margin-top:14px">${text(accelerator.plain_english || "Accelerator is waiting for local paper-learning data.")}</h2>
          <div class="progress" style="height:12px;margin:18px 0 14px" aria-label="Weather/Crypto learning progress"><span style="--w:${progress.toFixed(1)}%"></span></div>
          <div class="grid">
            <div class="mini"><span class="label">Rows to 1,000</span><strong>${number(rowsNeeded)}</strong></div>
            <div class="mini"><span class="label">Rows to 3,000</span><strong>${number(accelerator.rows_needed_to_profit_proof_target)}</strong></div>
            <div class="mini"><span class="label">Learning Speed Boost</span><strong>x${Number(velocityMultiplier).toFixed(2)}</strong></div>
            <div class="mini"><span class="label">Learning Pressure</span><strong>weather x${Number(pressureWeather).toFixed(2)} / crypto x${Number(pressureCrypto).toFixed(2)}</strong></div>
            <div class="mini"><span class="label">Stochastic Pressure</span><strong>${(Number(stochasticPressure) * 100).toFixed(1)}%</strong></div>
            <div class="mini"><span class="label">Stochastic Safety</span><strong>${Number(stochasticSafety).toFixed(2)}x</strong></div>
            <div class="mini"><span class="label">Execution Reliability</span><strong>${(Number(executionReliability) * 100).toFixed(1)}%</strong></div>
            <div class="mini"><span class="label">Sports Reallocation Guard</span><strong>${Number(reallocationGuard).toFixed(2)}</strong></div>
            <div class="mini"><span class="label">Rows Last Hour</span><strong>${number(perHour)}</strong></div>
            <div class="mini"><span class="label">Hours at Rate</span><strong>${estimated == null ? "n/a" : esc(Number(estimated).toFixed(2))}</strong></div>
            <div class="mini"><span class="label">Next Crypto Check</span><strong>${text(nextCrypto)}</strong></div>
            <div class="mini"><span class="label">Weather Sources</span><strong class="${accelerator.weather_source_freshness_ok ? "good" : "warn"}">${accelerator.weather_source_freshness_ok ? "fresh" : "needs check"}</strong></div>
            <div class="mini"><span class="label">Route Mix - All</span><strong>shadow ${pctOverall(overall.SHADOW_ONLY, overallTotal)} (${number(overall.SHADOW_ONLY || 0)}) · explore ${pctOverall(overall.ACCEPT_EXPLORATION, overallTotal)} (${number(overall.ACCEPT_EXPLORATION || 0)}) · paper ${pctOverall(overall.ACCEPT_PAPER, overallTotal)} (${number(overall.ACCEPT_PAPER || 0)}) · forward ${pctOverall(overall.FORWARD_PAPER, overallTotal)} (${number(overall.FORWARD_PAPER || 0)})</strong></div>
            <div class="mini"><span class="label">Weather/Crypto Route Mix</span><strong>shadow ${pctWC(weatherCryptoRoute.SHADOW_ONLY, wcTotal)} (${number(weatherCryptoRoute.SHADOW_ONLY || 0)}) · explore ${pctWC(weatherCryptoRoute.ACCEPT_EXPLORATION, wcTotal)} (${number(weatherCryptoRoute.ACCEPT_EXPLORATION || 0)}) · paper ${pctWC(weatherCryptoRoute.ACCEPT_PAPER, wcTotal)} (${number(weatherCryptoRoute.ACCEPT_PAPER || 0)}) · forward ${pctWC(weatherCryptoRoute.FORWARD_PAPER, wcTotal)} (${number(weatherCryptoRoute.FORWARD_PAPER || 0)})</strong></div>
          </div>
        </article>
        <article class="focus-card">
          <div class="label">Execution Loop</div>
          <div class="command-stack">
            ${(commands.length ? commands : ["resolve_due_weather_crypto_outcomes_first", "create_only_leakage_guarded_weather_crypto_candidates", "live_order_allowed_false"]).map((command, index) => `
              <div class="command-item"><div class="command-index">${index + 1}</div><div><strong>${text(String(command).replaceAll("_", " "))}</strong><div class="metric-note">${index === 0 ? "Do this first to speed supervised labels." : "Keep the loop clean before adding more volume."}</div></div></div>
            `).join("")}
          </div>
          <div style="margin-top:14px">
            ${constraints.slice(0, 6).map((constraint) => `<span class="metric-chip">${text(String(constraint).replaceAll("_", " "))}</span>`).join("")}
          </div>
        </article>`;
    }

    function renderStrategyWeights(data) {
      const weighting = data.strategy_weighting || {};
      const rows = weighting.rows || [];
      document.getElementById("strategy-weight-summary").textContent = standardizeStrategyText(weighting.plain_english || "Strategy weights have not generated yet. Weights are paper-learning attention, not live risk.");
      document.getElementById("strategy-weight-table").innerHTML = header(["Paper Weight", "Strategy", "Domains", "Decisions", "Validated", "Model Signal", "Data Integrity", "Next Shadow Trades", "Accepted Weight"]) +
        (rows.length ? rows.map((s) => {
          const weight = Number(s.paper_learning_weight_pct || 0);
          const domains = `${Object.entries(s.domains || {}).map(([domain, count]) => `<span class="metric-chip">${text(domain)} ${number(count)}</span>`).join("") || `<span class="metric-chip">no decisions</span>`}<br><span class="metric-chip">Weather/Crypto ${pct(s.weather_crypto_share)}</span><span class="metric-chip">Sports ${pct(s.sports_share)}</span>`;
          const modelSignal = [
            `Brier ${s.brier_score == null ? "n/a" : esc(Number(s.brier_score).toFixed(4))}`,
            `Market ${s.market_brier_score == null ? "n/a" : esc(Number(s.market_brier_score).toFixed(4))}`,
            `Accuracy ${pct(s.accuracy)}`,
          ].join("<br>");
          const missing = (s.top_missing_fields || []).slice(0, 4).map((field) => `<span class="metric-chip">${text(field)}</span>`).join("");
          return row([
            `<div class="weight-bar"><strong>${weight.toFixed(1)}%</strong><div class="weight-track"><span class="weight-fill" style="--w:${Math.max(0, Math.min(100, weight)).toFixed(1)}%"></span></div></div>`,
            `<strong>${text(s.display_name || s.strategy_id)}</strong><br><span class="muted">${text(s.paper_learning_weight_reason || "")}</span>`,
            domains,
            `${number(s.decisions)}<br><span class="muted">${number(s.shadow_decisions)} shadow / ${number(s.accepted)} accepted</span>`,
            `${number(s.validated_trades)}<br><span class="muted">${number(s.shadow_scored)} shadow labels / ${number(s.accepted_scored)} accepted labels</span>`,
            modelSignal,
            `${pct(s.data_integrity_score)}<br>${missing || '<span class="muted">complete fields</span>'}`,
            number(s.recommended_next_shadow_trades),
            `<strong>${Number(s.accepted_paper_weight_pct || 0).toFixed(1)}%</strong><br><span class="muted">${text(s.accepted_paper_weight_reason || "Accepted paper weight stays zero until proof gates pass.")}</span>`,
          ]);
        }).join("") : emptyRow(9, "No strategy weights are available yet."));
    }


    function renderMarketTelemetry(data) {
      const telemetry = data.market_telemetry || {};
      const cards = [
        ["Orderbook Snapshots", number(telemetry.snapshot_count), "Top-of-book/depth snapshots collected for fill, spread, queue, and adverse-selection modeling.", Number(telemetry.snapshot_count || 0) > 0 ? "good" : "warn"],
        ["Weak Price Paths", number(telemetry.price_path_count), "+1m/+3m/+5m/+10m/+15m-style path labels for faster shadow learning. These do not count toward live-readiness proof.", Number(telemetry.price_path_count || 0) > 0 ? "good" : "warn"],
        ["Candidate Universe", number(telemetry.candidate_universe_count), "Screened/created candidates with rejection reasons so ML can learn no-trade decisions and reduce selection bias.", Number(telemetry.candidate_universe_count || 0) > 0 ? "good" : "warn"],
        ["Ladder Surfaces", number(telemetry.ladder_surface_count), "Sibling threshold/market groups for relative-value and monotonicity checks.", Number(telemetry.ladder_surface_count || 0) > 0 ? "good" : "warn"],
        ["Fetch Failures", number(telemetry.orderbook_fetch_failed_count), "Read-only orderbook fetch failures during the latest telemetry pass.", Number(telemetry.orderbook_fetch_failed_count || 0) === 0 ? "good" : "warn"],
        ["Live Readiness", telemetry.counts_for_live_readiness ? "counts" : "excluded", "Telemetry accelerates ML learning but final source-backed outcomes still control GAP-01 proof.", "warn"],
      ];
      document.getElementById("market-telemetry-summary").textContent = standardizeStrategyText(telemetry.plain_english || "Market telemetry has not run yet.");
      document.getElementById("market-telemetry-cards").innerHTML = cards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      const byDomain = telemetry.by_domain || {};
      const actions = telemetry.candidate_action_counts || {};
      document.getElementById("market-telemetry-table").innerHTML = header(["Telemetry", "Value", "Why It Improves ML / Profit"]) + [
        row(["Latest run", text(telemetry.timestamp_utc || "not run"), "Fresh telemetry avoids stale quote/path training." ]),
        row(["Domains", text(Object.entries(byDomain).map(([k,v]) => `${k}:${v}`).join(", ") || "none"), "Shows whether learning coverage is concentrated or diversified." ]),
        row(["Governor actions", text(Object.entries(actions).map(([k,v]) => `${k}:${v}`).join(", ") || "none"), "Links rejected/accepted routing to future no-trade learning." ]),
        row(["Snapshot logs", text(Object.values(telemetry.snapshot_logs || {}).join(" | ") || "not available"), "Audit paths for orderbook, price-path, universe, and ladder logs." ]),
      ].join("");
    }

    function renderTradeTracking(data) {
      const tracking = data.trade_tracking || {};
      const strategyRows = tracking.by_strategy || [];
      const fieldRows = tracking.field_coverage || [];
      const critical = tracking.critical_missing_fields || [];
      document.getElementById("trade-tracking-summary").innerHTML = `${text(tracking.plain_english || "ML trade data contract has not generated yet.")} <span class="metric-chip">${number(tracking.total_tracked_decisions)} tracked</span><span class="metric-chip">${number(tracking.validated_labels)} labels</span>${critical.length ? `<span class="metric-chip">repair ${critical.length} field groups</span>` : `<span class="metric-chip">no critical gaps</span>`}`;
      document.getElementById("trade-tracking-table").innerHTML = header(["Strategy", "Decisions", "Validated Labels", "Data Integrity", "Top Missing Fields"]) +
        (strategyRows.length ? strategyRows.slice(0, 16).map((s) => row([
          `<strong>${text(s.display_name || s.strategy_id)}</strong>`,
          number(s.decisions),
          number(s.validated_labels),
          pct(s.data_integrity_score),
          (s.top_missing_fields || []).slice(0, 8).map((field) => `<span class="metric-chip">${text(field)}</span>`).join("") || '<span class="muted">complete fields</span>',
        ])).join("") : emptyRow(5, "No strategy-level trade tracking coverage is available yet."));
      document.getElementById("trade-field-table").innerHTML = header(["Required Field", "Coverage", "Present", "Why ML Needs It"]) +
        (fieldRows.length ? fieldRows.map((f) => row([
          `<strong>${text(f.label || f.field)}</strong><br><span class="muted">${text(f.field)}</span>`,
          pct(f.coverage),
          number(f.present_count),
          text(f.why || ""),
        ])).join("") : emptyRow(4, "No field-level trade tracking coverage is available yet."));
    }

    function renderKalshiNonliveRunner(data) {
      const runner = data.kalshi_nonlive_openclaw_runner || {};
      const assetCounts = runner.asset_counts || {};
      const unsafe = Array.isArray(runner.unsafe_true_flags) ? runner.unsafe_true_flags : [];
      const hasUnsafe = unsafe.length > 0 || runner.live_order_allowed === true || runner.can_authorize_live === true || runner.can_authorize_paper === true || runner.can_authorize_trade === true || runner.sts_authority === true;
      const sourceReady = runner.source_exists === true;
      const compositionPossible = runner.asset_composition_mathematically_possible === true;
      document.getElementById("kalshi-nonlive-runner-summary").textContent = standardizeStrategyText(runner.next_action || "Kalshi non-live OpenClaw runner summary is missing; generate it before any further v11 collection.");
      document.getElementById("kalshi-nonlive-runner-cards").innerHTML = [
        ["Status", runner.status || "not_generated", runner.artifact_exists ? "Compact OpenClaw proof JSON loaded." : "Missing summary fallback is safe and cannot authorize trading.", hasUnsafe ? "bad" : (runner.artifact_exists ? "warn" : "warn")],
        ["Clean Rows", number(runner.unique_clean_row_count || 0), "Checkpoint rows are not source-finalization proof.", runner.unique_clean_row_count >= 30 ? "warn" : "bad"],
        ["Dominant Asset", runner.dominant_asset || "unknown", `${number(runner.non_dominant_asset_rows || 0)} / ${number(runner.non_dominant_asset_rows_required || 15)} non-dominant rows; shortfall ${number(runner.non_dominant_asset_shortfall || 0)}.`, runner.non_dominant_asset_shortfall > 0 ? "warn" : "good"],
        ["Composition", compositionPossible ? "Math possible" : "Blocked", runner.composition_reject_reason || runner.selector_status || "selector not run", compositionPossible ? "good" : "warn"],
        ["Source", sourceReady ? "Exists" : "Absent", runner.validation_rows_exist ? "Validation rows exist; audit before proceeding." : "Validation rows remain absent.", sourceReady ? "good" : "warn"],
        ["Next Blocker", runner.next_blocker || "runner_summary_missing", "OpenClaw executes deterministic commands; Codex reviews design or ambiguous decisions.", runner.codex_review_required ? "warn" : "good"],
        ["16DL", runner.future_16dl_run_by_16dm ? "Stop" : `Target ${number(runner.future_16dl_target_clean_rows || 64)}`, "16DM must not run collection; use runner later only under approved 16DL scope.", runner.future_16dl_run_by_16dm ? "bad" : "good"],
        ["Live Authority", hasUnsafe ? "Stop" : "Blocked", unsafe.length ? unsafe.join(", ") : "No unsafe true flags in compact summary.", hasUnsafe ? "bad" : "good"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("kalshi-nonlive-runner-table").innerHTML = header(["Asset", "Rows", "Use", "Boundary"]) +
        (Object.keys(assetCounts).length ? Object.entries(assetCounts).sort().map(([asset, count]) => row([
          text(asset),
          number(count),
          asset === runner.dominant_asset ? "dominant concentration risk" : "helps composition repair",
          "Diagnostic source-readiness only; no validation, paper, STS, or live authority.",
        ])).join("") : emptyRow(4, "No asset counts available; runner summary fallback remains fail-closed."));
    }


    function renderKalshiV12SourceBottleneck(data) {
      const audit = data.kalshi_v12_source_bottleneck || {};
      const assetCounts = audit.asset_counts || {};
      const usableCounts = audit.usable_asset_counts_after_v12_cap || {};
      const deficits = audit.minimum_asset_deficits || {};
      const unsafe = Array.isArray(audit.unsafe_true_flags) ? audit.unsafe_true_flags : [];
      const hasUnsafe = unsafe.length > 0 || audit.live_order_allowed === true || audit.can_authorize_live === true || audit.can_authorize_paper === true || audit.can_authorize_trade === true || audit.sts_authority === true;
      document.getElementById("kalshi-v12-source-bottleneck-summary").textContent = standardizeStrategyText(audit.next_action || "Generate the 16ET source bottleneck audit before more v12 collection.");
      document.getElementById("kalshi-v12-source-bottleneck-cards").innerHTML = [
        ["Status", audit.status || "not_generated", audit.artifact_exists ? "16ET compact proof JSON loaded." : "Missing audit fallback is safe and cannot authorize trading.", hasUnsafe ? "bad" : "warn"],
        ["Raw Clean Rows", `${number(audit.unique_clean_row_count || 0)} / 30`, `Raw shortfall ${number(audit.raw_clean_row_shortfall || 0)}; checkpoint growth is not source proof.`, audit.unique_clean_row_count >= 30 ? "warn" : "bad"],
        ["Usable Rows", `${number(audit.composition_usable_row_count || 0)} / 30`, `Composition shortfall ${number(audit.composition_usable_shortfall || 0)} after v12 asset caps.`, audit.composition_usable_shortfall > 0 ? "bad" : "good"],
        ["Non-DOGE", `${number(audit.non_doge_rows || 0)} rows`, `Shortfall ${number(audit.non_doge_row_shortfall || 0)}; BTC/ETH/SOL deficits drive the source gate.`, audit.non_doge_row_shortfall > 0 ? "bad" : "good"],
        ["Recommendation", audit.recommended_next_action || "blocked_needs_more_evidence", audit.pivot_rule_after_16eu || audit.selector_reject_reason || audit.selector_status || "selector not run", audit.recommended_next_action === "run_16EU" ? "warn" : "bad"],
        ["Live Authority", hasUnsafe ? "Stop" : "Blocked", unsafe.length ? unsafe.join(", ") : "No unsafe true flags in 16ET audit.", hasUnsafe ? "bad" : "good"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("kalshi-v12-source-bottleneck-table").innerHTML = header(["Asset", "Clean", "Usable", "Minimum Deficit"]) +
        (Object.keys({...assetCounts, ...usableCounts, ...deficits}).length ? Object.keys({...assetCounts, ...usableCounts, ...deficits}).sort().map((asset) => row([
          text(asset),
          number(assetCounts[asset] || 0),
          number(usableCounts[asset] || 0),
          number(deficits[asset] || 0),
        ])).join("") : emptyRow(4, "No v12 bottleneck audit asset counts available; fallback remains fail-closed."));
    }

    function renderKalshiV13Preregistration(data) {
      const plan = data.kalshi_v13_preregistration_plan || {};
      const mins = plan.minimum_asset_rows || {};
      const maxes = plan.maximum_asset_rows || {};
      const targets = plan.target_mix_rows || {};
      const unsafe = Array.isArray(plan.unsafe_true_flags) ? plan.unsafe_true_flags : [];
      const hasUnsafe = unsafe.length > 0 || plan.live_order_allowed === true || plan.can_authorize_live === true || plan.can_authorize_paper === true || plan.can_authorize_trade === true || plan.sts_authority === true;
      document.getElementById("kalshi-v13-preregistration-summary").textContent = standardizeStrategyText(plan.next_blocker || "Generate the 16EV v13 preregistration plan before any v13 collection.");
      document.getElementById("kalshi-v13-preregistration-cards").innerHTML = [
        ["Status", plan.status || "not_generated", plan.artifact_exists ? "16EV diagnostic plan loaded; collection remains separately approval-gated." : "Missing v13 plan fallback is safe and cannot authorize trading.", hasUnsafe ? "bad" : "warn"],
        ["Candidate", plan.candidate_name || "crypto_asset_balanced_execution_value_band_guard_repair_v13", "Replacement candidate is planning-only until 16EW approval.", "warn"],
        ["v12 Evidence", `${number(plan.v12_unique_clean_row_count || 0)} raw / ${number(plan.v12_composition_usable_row_count || 0)} usable`, `v12 shortfall ${number(plan.v12_composition_usable_shortfall || 0)}; pivot ${plan.v12_pivot_to_v13_now ? "recommended" : "not proven"}.`, plan.v12_pivot_to_v13_now ? "bad" : "warn"],
        ["v13 Non-DOGE Floor", `${number(plan.minimum_non_doge_rows || 0)} rows`, `DOGE saturation cap ${number(plan.doge_saturation_cap_rows || 0)} rows.`, "warn"],
        ["Next Approval", "16EW required", "No v13 collection, source finalization, validation rows, outcomes, ML, paper, STS, or live authority is approved by 16EV.", "bad"],
        ["Live Authority", hasUnsafe ? "Stop" : "Blocked", unsafe.length ? unsafe.join(", ") : "No unsafe true flags in 16EV plan.", hasUnsafe ? "bad" : "good"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("kalshi-v13-preregistration-table").innerHTML = header(["Asset", "Target", "Minimum", "Maximum"]) +
        (Object.keys({...targets, ...mins, ...maxes}).length ? Object.keys({...targets, ...mins, ...maxes}).sort().map((asset) => row([
          text(asset),
          text(targets[asset] || "n/a"),
          number(mins[asset] || 0),
          number(maxes[asset] || 0),
        ])).join("") : emptyRow(4, "No v13 preregistration contract available; fallback remains fail-closed."));
    }


    function renderCryptoSettlementOracle(data) {
      const oracle = data.crypto_settlement_oracle || {};
      const summary = oracle.summary || {};
      const power = oracle.power_analysis || {};
      const residual = oracle.residual_ml_readiness || {};
      const graduation = oracle.graduation_gate || {};
      const rows = Array.isArray(oracle.rows) ? oracle.rows : [];
      const readiness = data.crypto_settlement_oracle_readiness || {};
      const replayReadiness = readiness.replay_power_analysis || {};
      const residualReadiness = readiness.residual_ml_readiness || {};
      const graduationReadiness = readiness.forward_paper_graduation_gate || {};
      const criticalReadiness = readiness.critical_path_blocker_handoff || {};
      const hasUnsafeFlag = oracle.live_order_allowed === true || oracle.live_trading_enabled === true || oracle.can_authorize_live === true || oracle.can_authorize_paper === true || oracle.can_authorize_trade === true || oracle.sts_authority === true || oracle.counts_for_validation_credit === true;
      const statusTone = hasUnsafeFlag ? "bad" : (oracle.status && String(oracle.status).includes("ready") ? "good" : "warn");
      const effective = Number(power.effective_sample_size || 0);
      const needed = Number(power.minimum_forward_samples_required || 500);
      document.getElementById("crypto-settlement-oracle-summary").textContent = standardizeStrategyText(oracle.plain_english || "Crypto Settlement Arbitrage Lab is diagnostic-only and cannot authorize paper, STS, or live trading.");
      document.getElementById("crypto-settlement-oracle-cards").innerHTML = [
        ["Status", oracle.status || "not_generated", oracle.artifact_exists ? "Diagnostic settlement-oracle artifact loaded." : "Missing artifact fallback is safe.", statusTone],
        ["Rows", number(summary.row_count || rows.length), `${number(summary.no_trade_count || 0)} no-trade diagnostics; ${number(summary.invalid_for_validation_credit_count || 0)} invalid for validation credit.`, rows.length ? "good" : "warn"],
        ["Sample Power", `${number(effective)} / ${number(needed)}`, "Forward-paper review requires enough effective samples; historical/replay rows do not grant live readiness.", effective >= needed ? "good" : "warn"],
        ["Residual ML", residual.ready ? "Ready" : "Blocked", residual.target || "Trade-quality filter only; not raw crypto direction.", residual.ready ? "good" : "warn"],
        ["Graduation", graduation.status || "blocked", "Requires clean oracle data, market-baseline outperformance, positive post-cost P&L, bug-vs-edge clearance, and explicit approval.", "warn"],
        ["Validation Credit", oracle.counts_for_validation_credit ? "Stop" : "No", "Oracle diagnostics cannot replace source JSONL, validation rows, or source-backed outcomes.", oracle.counts_for_validation_credit ? "bad" : "good"],
        ["Replay Credit", replayReadiness.historical_replay_credit_allowed ? "Stop" : "Disabled", "Replay/power output is hypothesis-only and gives no live-readiness credit.", replayReadiness.historical_replay_credit_allowed ? "bad" : "good"],
        ["Critical Path", criticalReadiness.production_grade_ml_status || "blocked", "Final source JSONL, validation rows, outcomes, separated validation, milestones 17-21, and STS/live remain blocked.", "warn"],
        ["Live Authority", hasUnsafeFlag ? "Stop" : "Blocked", "This panel cannot place or authorize trades.", hasUnsafeFlag ? "bad" : "good"],
        ["Next Action", oracle.next_action || "Keep diagnostic-only.", "No STS, paper, or live promotion is allowed from this panel.", "warn"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("crypto-settlement-oracle-table").innerHTML = header(["Asset", "Market", "Fair YES", "Market", "Edge", "Settlement", "Execution", "Blockers"]) +
        (rows.length ? rows.slice(0, 25).map((item) => row([
          text(item.asset || "CRYPTO"),
          `<strong>${text(item.market_ticker || "unknown")}</strong><br><span class="muted">${text(item.decision || "NO_TRADE_DIAGNOSTIC")}</span>`,
          pct(item.fair_yes_probability),
          pct(item.market_implied_probability),
          item.edge_after_costs_cents == null ? "n/a" : `${Number(item.edge_after_costs_cents).toFixed(2)}¢`,
          `${item.current_settlement_value == null ? "n/a" : text(item.current_settlement_value)} / threshold ${item.threshold_value == null ? "n/a" : text(item.threshold_value)}<br><span class="muted">effective ${item.effective_threshold_value == null ? "n/a" : text(item.effective_threshold_value)}</span>`,
          `${text(item.execution_status || "blocked")}<br><span class="muted">spread ${item.spread_cents == null ? "n/a" : `${Number(item.spread_cents).toFixed(1)}¢`}; depth ${number(item.depth_contracts)}</span>`,
          `${text(item.data_quality_status || "invalid_for_validation_credit")}<br><span class="muted">${(Array.isArray(item.blockers) && item.blockers.length) ? item.blockers.slice(0, 5).map((b) => text(b)).join("; ") : "diagnostic only"}</span>`,
        ])).join("") : emptyRow(8, "No settlement-oracle rows are available yet. Missing artifact fallback remains no-live and diagnostic-only."));
      const residualBlockers = Array.isArray(residual.blockers) ? residual.blockers : [];
      const powerBlockers = Array.isArray(power.blockers) ? power.blockers : [];
      const readinessReplayBlockers = Array.isArray(replayReadiness.blockers) ? replayReadiness.blockers : [];
      const readinessResidualBlockers = Array.isArray(residualReadiness.blockers) ? residualReadiness.blockers : [];
      const readinessGraduationBlockers = Array.isArray(graduationReadiness.blockers) ? graduationReadiness.blockers : [];
      const criticalBlockedItems = Array.isArray(criticalReadiness.blocked_items) ? criticalReadiness.blocked_items : [];
      const required = Array.isArray(graduation.required) ? graduation.required : [];
      document.getElementById("crypto-settlement-oracle-gates-table").innerHTML = header(["Gate", "Status", "Details", "Authority Boundary"]) + [
        row(["Power analysis", power.ready_for_forward_paper_review ? "ready" : "blocked", powerBlockers.map((b) => text(b)).join("; ") || "No power metadata.", "Historical/replay credit is disabled."]),
        row(["16BS Replay / power", replayReadiness.status || "blocked", readinessReplayBlockers.map((b) => text(b)).join("; ") || "No readiness metadata.", "Hypothesis only; historical_replay_credit_allowed=false."]),
        row(["Residual ML", residual.ready ? "ready" : "blocked", residualBlockers.map((b) => text(b)).join("; ") || "No residual ML metadata.", "ML target is post-cost trade quality only."]),
        row(["16BT Residual ML gate", residualReadiness.status || "blocked", readinessResidualBlockers.map((b) => text(b)).join("; ") || "No readiness metadata.", `Target: ${text(residualReadiness.target || "post_cost_trade_quality")}; cannot authorize trades.`]),
        row(["Graduation", graduation.status || "blocked", required.map((b) => text(b)).join("; ") || "Graduation requirements not generated.", "Requires explicit governor/user approval."]),
        row(["16BU Graduation matrix", graduationReadiness.status || "blocked", readinessGraduationBlockers.map((b) => text(b)).join("; ") || "No readiness metadata.", `${number(graduationReadiness.blocked_gate_count || 0)} blocked gates; no paper, STS, or live promotion.`]),
        row(["16BW Critical path", criticalReadiness.status || "blocked", criticalBlockedItems.slice(0, 6).map((item) => `${text(item.item || "blocked")}: ${text(item.status || "blocked")}`).join("; ") || "Production blockers preserved.", "Milestones 17-21 and STS/live remain blocked."]),
        row(["Readiness artifact", text(readiness.artifact_path || ""), readiness.artifact_exists ? "local readiness artifact exists" : "readiness fallback active", "Report cannot write source, validation, outcome, STS, or live paths."]),
        row(["Artifact", text(oracle.artifact_path || ""), oracle.artifact_exists ? "local artifact exists" : "missing fallback active", "Panel cannot write source, validation, outcome, STS, or live paths."]),
      ].join("");
    }

    function renderCryptoPersistenceLab(data) {
      const lab = data.crypto_persistence_lab || {};
      const summary = lab.summary || {};
      const journal = lab.journal_review || {};
      const rows = Array.isArray(lab.rows) ? lab.rows : [];
      const thresholdProposals = Array.isArray(journal.threshold_proposals) ? journal.threshold_proposals : [];
      const hasUnsafeFlag = lab.live_order_allowed === true || lab.can_authorize_live === true || lab.can_authorize_paper === true || lab.can_authorize_trade === true || lab.sts_authority === true || lab.counts_for_validation_credit === true;
      const statusTone = hasUnsafeFlag ? "bad" : (lab.status === "diagnostic_ready" ? "good" : "warn");
      document.getElementById("crypto-persistence-summary").textContent = standardizeStrategyText(lab.plain_english || "Crypto Persistence Lab is diagnostic-only and cannot authorize STS, paper, or live trading.");
      document.getElementById("crypto-persistence-cards").innerHTML = [
        ["Status", lab.status || "not_generated", lab.artifact_exists ? "Loaded from Markov microstructure diagnostics." : "Missing artifact fallback is safe.", statusTone],
        ["Crypto Markets", number(summary.crypto_market_count || rows.length), "Article-inspired persistence diagnostics are limited to crypto rows.", rows.length ? "good" : "warn"],
        ["Watchlist", number(summary.watchlist_count), "Research-only rows whose remaining blocker is authority/proof, not immediate data quality.", Number(summary.watchlist_count || 0) > 0 ? "warn" : "good"],
        ["Low Sample", number(summary.low_sample_count), "Rows with fewer than 30 current-bucket transitions stay weak evidence.", Number(summary.low_sample_count || 0) === 0 ? "good" : "warn"],
        ["STS Boundary", (lab.sts_policy || {}).status || "diagnostic_only_not_sts_authority", "Persistence diagnostics cannot change STS routing.", "warn"],
        ["Journal Review", journal.status || "not_generated", journal.plain_english || "Read-only report not generated yet.", journal.status === "review_ready" ? "good" : "warn"],
        ["Validation Credit", lab.counts_for_validation_credit ? "Stop" : "No", "This does not replace source JSONL, validation rows, or source-backed outcomes.", lab.counts_for_validation_credit ? "bad" : "good"],
        ["Next Action", lab.next_action || "Keep diagnostic-only.", "No paper/shadow/live activation is allowed from this panel.", "warn"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("crypto-persistence-table").innerHTML = header(["Asset", "Market", "Persistence", "Market", "Raw Edge", "After Costs", "Sample", "Blocker"]) +
        (rows.length ? rows.slice(0, 25).map((item) => row([
          text(item.asset || "CRYPTO"),
          `<strong>${text(item.market_ticker || "unknown")}</strong><br><span class="muted">${text(item.threshold_calibration_status || "not calibrated")}</span>`,
          pct(item.persistence_probability),
          pct(item.market_implied_probability),
          item.raw_edge_pct == null ? "n/a" : `${Number(item.raw_edge_pct).toFixed(2)} pp`,
          item.edge_after_costs_pct == null ? "n/a" : `${Number(item.edge_after_costs_pct).toFixed(2)} pp`,
          `${text(item.transition_sample_quality || "unknown")}<br><span class="muted">${number(item.current_row_transitions)} transitions; spread ${item.spread_cents == null ? "n/a" : `${Number(item.spread_cents).toFixed(1)}¢`}; depth ${number(item.depth_contracts)}</span>`,
          `${text(item.blocker || "research_only")}<br><span class="muted">${text(item.calibration_warning || "diagnostic only")}</span>`,
        ])).join("") : emptyRow(8, "No crypto persistence rows are available yet. Run Markov microstructure diagnostics first."));
      document.getElementById("crypto-persistence-journal-table").innerHTML = header(["Proposal", "Value", "Status", "Boundary"]) +
        (thresholdProposals.length ? thresholdProposals.map((proposal) => row([
          text(proposal.parameter || proposal.name || "threshold"),
          text(proposal.proposed_value ?? proposal.value ?? "n/a"),
          text(proposal.status || "review_required"),
          text(proposal.boundary || "recommendation_only_no_mutation"),
        ])).join("") : emptyRow(4, journal.recommended_action || "Generate the read-only persistence journal review report."));
    }

    function renderTimesfmDiagnostic(data) {
      const timesfm = data.timesfm_diagnostic || (data.weather_crypto_ml || {}).timesfm_diagnostic || {};
      const metrics = timesfm.metrics || {};
      const forecast = timesfm.forecast_config || {};
      const leakage = timesfm.leakage_checks || {};
      const stsPolicy = (data.sts_trading_dashboard || {}).timesfm_policy || timesfm.sts_policy || {};
      const baselines = Array.isArray(timesfm.baselines) ? timesfm.baselines : [];
      const segmentFailures = Array.isArray(timesfm.segment_failures) ? timesfm.segment_failures : [];
      const assets = Array.isArray(timesfm.assets) && timesfm.assets.length ? timesfm.assets.join(", ") : "not generated";
      const domains = Array.isArray(timesfm.domains) && timesfm.domains.length ? timesfm.domains.join(", ") : "not generated";
      const horizons = Array.isArray(timesfm.horizons_minutes) && timesfm.horizons_minutes.length ? timesfm.horizons_minutes.join(", ") : "not generated";
      const hasUnsafeFlag = timesfm.live_order_allowed === true || timesfm.can_authorize_live === true || timesfm.can_authorize_paper === true || timesfm.sts_authority === true || timesfm.counts_for_validation_credit === true;
      const leakageClean = leakage.random_split_used !== true && leakage.future_labels_used !== true && leakage.moving_sources_used !== true;
      const statusTone = hasUnsafeFlag ? "bad" : (timesfm.status === "diagnostic_ready" || timesfm.status === "diagnostic_complete" ? "good" : "warn");
      document.getElementById("timesfm-diagnostic-summary").textContent = standardizeStrategyText(timesfm.plain_english || timesfm.next_action || "TimesFM is diagnostic-only and cannot count as validation credit.");
      document.getElementById("timesfm-diagnostic-cards").innerHTML = [
        ["Status", timesfm.status || "not_generated", timesfm.artifact_exists ? "Diagnostic artifact loaded from local logs." : "No TimesFM artifact exists yet; fallback is safe.", statusTone],
        ["Model", `${timesfm.model_family || "timesfm"} ${timesfm.model_version || "timesfm-2.5"}`, "Target model label for future diagnostic comparisons.", "warn"],
        ["Assets", assets, `Domains: ${domains}.`, assets === "not generated" ? "warn" : "good"],
        ["Horizons", `${horizons} min`, `Quantiles ${forecast.quantiles_enabled ? "enabled" : "not configured"}; XReg ${forecast.xreg_enabled ? "enabled" : "off"}.`, horizons === "not generated" ? "warn" : "good"],
        ["Leakage Boundary", leakageClean ? "Clean" : "Review", `Random split ${leakage.random_split_used ? "used" : "off"}; future labels ${leakage.future_labels_used ? "used" : "off"}; moving sources ${leakage.moving_sources_used ? "used" : "off"}.`, leakageClean ? "good" : "bad"],
        ["STS Boundary", stsPolicy.status || "diagnostic_only_not_sts_authority", stsPolicy.plain_english || "STS decisions and routing remain unchanged.", "warn"],
        ["Validation Credit", timesfm.counts_for_validation_credit ? "Stop" : "No", "TimesFM output cannot replace post-preregistration source rows, validation rows, or source-backed outcomes.", timesfm.counts_for_validation_credit ? "bad" : "good"],
        ["Next Action", timesfm.next_action || "Run diagnostic-only evaluation after evidence gates permit it.", "No production or paper/shadow activation is allowed from this panel.", "warn"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("timesfm-diagnostic-table").innerHTML = header(["Metric", "Value", "Boundary"]) + [
        row(["Brier", metrics.brier == null ? "n/a" : Number(metrics.brier).toFixed(4), "Lower is better; compare against market and no-ML baselines."]),
        row(["ECE", metrics.ece == null ? "n/a" : Number(metrics.ece).toFixed(4), "Must be computed before any future advisory consideration."]),
        row(["Accuracy", pct(metrics.accuracy), "Threshold-based diagnostic only; not validation proof."]),
        row(["Coverage", pct(metrics.coverage), "Coverage must be reported by asset, side, fill, spread, depth, and probability bucket."]),
        row(["Market baseline Brier", metrics.market_baseline_brier == null ? "n/a" : Number(metrics.market_baseline_brier).toFixed(4), "Market-implied baseline remains the comparator."]),
        row(["No-ML baseline Brier", metrics.no_ml_baseline_brier == null ? "n/a" : Number(metrics.no_ml_baseline_brier).toFixed(4), "No-ML baseline prevents model-only overclaiming."]),
        row(["Baselines", baselines.length ? baselines.map((item) => text(item.name || item.baseline || item)).join("<br>") : "none", "TimesFM must beat clear baselines before any future package review."]),
        row(["Artifact", text(timesfm.artifact_path || ""), timesfm.artifact_exists ? "local artifact exists" : "missing fallback is active"]),
      ].join("");
      document.getElementById("timesfm-segment-failures-table").innerHTML = header(["Segment", "Metric", "Value", "Next Action"]) +
        (segmentFailures.length ? segmentFailures.map((failure) => row([
          text(failure.segment || failure.segment_key || failure.asset || "unknown"),
          text(failure.metric || failure.reason || "failure"),
          failure.value == null ? "n/a" : text(failure.value),
          text(failure.next_action || "Keep diagnostic-only; do not promote."),
        ])).join("") : emptyRow(4, "No TimesFM segment failures have been generated yet."));
    }

    function renderMlxDiagnostic(data) {
      const mlx = data.mlx_diagnostic || (data.weather_crypto_ml || {}).mlx_diagnostic || {};
      const runtime = mlx.runtime || {};
      const evidence = mlx.evidence_chain || {};
      const hasUnsafeFlag = mlx.live_order_allowed === true || mlx.can_authorize_live === true || mlx.can_authorize_paper === true || mlx.can_authorize_trade === true || mlx.sts_authority === true || mlx.counts_for_validation_credit === true;
      const runtimeReady = runtime.available === true && runtime.mlx_core_importable === true;
      const validationReady = evidence.validation_rows_ready === true && Number(evidence.validation_row_count || 0) === 30;
      document.getElementById("mlx-diagnostic-summary").textContent = standardizeStrategyText(mlx.plain_english || "MLX is diagnostic-only local acceleration and cannot authorize paper, STS, or live trading.");
      document.getElementById("mlx-diagnostic-cards").innerHTML = [
        ["Status", mlx.status || "not_generated", mlx.artifact_exists ? "Local MLX diagnostic artifact loaded." : "No MLX artifact exists yet; dashboard fallback is safe.", hasUnsafeFlag ? "bad" : (runtimeReady ? "good" : "warn")],
        ["Runtime", runtimeReady ? "Available" : "Fallback", `${runtime.machine || "unknown"}; ${runtime.backend_role || "diagnostic only"}.`, runtimeReady ? "good" : "warn"],
        ["Evidence Chain", validationReady ? "30 validation rows" : "Blocked", `${number(evidence.source_row_count || 0)} source rows; ${number(evidence.validation_row_count || 0)} validation rows.`, validationReady ? "good" : "warn"],
        ["Validation Credit", mlx.counts_for_validation_credit ? "Stop" : "No", "MLX output cannot replace source rows, validation rows, source-backed outcomes, or separated validation.", mlx.counts_for_validation_credit ? "bad" : "good"],
        ["STS Boundary", mlx.sts_authority ? "Stop" : "No authority", "OpenClaw STS/governor remains the authority boundary; MLX is only a future challenger runtime.", mlx.sts_authority ? "bad" : "good"],
        ["Next Gate", mlx.next_gate || "source-backed outcomes required", "Do not run MLX challenger claims before outcomes and separated validation are ready.", "warn"],
      ].map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${text(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
      document.getElementById("mlx-diagnostic-table").innerHTML = header(["Check", "Value", "Boundary"]) + [
        row(["MLX importable", runtime.mlx_importable ? "yes" : "no", "Missing MLX must fail closed to dashboard-only fallback."]),
        row(["MLX core importable", runtime.mlx_core_importable ? "yes" : "no", "Required before future local challenger experiments."]),
        row(["MLX version", text(runtime.mlx_version || "unknown"), "Version is metadata only, not validation proof."]),
        row(["Source rows", `${number(evidence.source_row_count || 0)} / 30`, "Source JSONL must remain exactly 30 rows."]),
        row(["Validation rows", `${number(evidence.validation_row_count || 0)} / 30`, "Validation rows must come from the redesigned after16 source."]),
        row(["Outcomes", evidence.source_backed_outcomes_ready ? "ready" : "blocked", "Source-backed outcomes are required before MLX challenger scoring."]),
        row(["Separated validation", evidence.separated_validation_ready ? "ready" : "blocked", "Separated validation is required before production-grade ML packaging."]),
        row(["Artifact", text(mlx.artifact_path || ""), mlx.artifact_exists ? "local artifact exists" : "missing fallback is active"]),
      ].join("");
    }

    async function load() {
      try {
        const res = await fetch(`kalshi_dashboard_data.json?ts=${Date.now()}`, {cache: "no-store"});
        const data = await res.json();
        const perf = data.performance_summary || {};
        const velocity = data.learning_velocity || {};
        const epoch = data.epoch || {};
        const plain = data.plain_english_status || {};
        const epochName = standardizeStrategyText(epoch.epoch_name || (epoch.active_metrics_scope === "all_time" ? "All-time paper history" : "Current paper epoch"));
        const epochLabel = epoch.epoch_number ? `Epoch ${epoch.epoch_number}` : (epoch.active_metrics_scope === "all_time" ? "All-time" : "Current");
        document.getElementById("subtitle").textContent = `Generated ${fmt(data.generated_at_utc)}. ${epochName}. This page is refreshed from local paper logs and cannot trade live.`;
        const status = renderHero(data, perf, plain, epochLabel);
        renderKalshiControlSurface(data);
        renderStsReadinessRoadmap(data);
        renderStsTradingDashboard(data);
        renderStsPolicySnapshot(data);
        renderStsDomainLearningOptimizer(data);
        renderCommandFlow(data);
        renderPlainSummary(plain, status);
        renderLearningLanes(perf);
        renderWeatherCryptoCommand(data);
        renderCryptoRegimeSelector(data);
        renderSourceLagSurface(data);
        renderProofMission(data);
        renderBuildGapAudit(data);
        renderPaperTradeAccelerator(data);
        renderStrategyWeights(data);
        renderTradeTracking(data);
        renderTimesfmDiagnostic(data);
        renderMlxDiagnostic(data);
        renderKalshiNonliveRunner(data);
        renderKalshiV12SourceBottleneck(data);
        renderKalshiV13Preregistration(data);
        renderCryptoSettlementOracle(data);
        renderCryptoPersistenceLab(data);
        renderMarketTelemetry(data);
        const pendingCount = data.pending_paper_trades?.count ?? 0;
        const learningAge = velocity.latest_learning_age_minutes == null ? "n/a" : `${Number(velocity.latest_learning_age_minutes).toFixed(1)} min`;
        const learningTone = velocity.status === "HIGH_SPEED_LEARNING" ? "good" : (velocity.status === "STALE" ? "bad" : "warn");
        const cards = [
          ["Live Readiness", "Blocked", "Live trading remains off until paper proof and human approval.", "good"],
          ["Current Epoch", epochLabel, epochName, "warn"],
          ["Primary Paper Strategy", standardizeStrategyText((epoch.primary_paper_strategy || "not set").replaceAll("_", "-")), "The strategy OpenClaw is testing first in paper mode.", "warn"],
          ["Paper P&L", money(perf.paper_pnl_usd), "Simulated net profit/loss from scored paper trades.", classForValue(perf.paper_pnl_usd)],
          ["Accuracy", pct(perf.accuracy), "Wins divided by scored accepted paper trades.", "warn"],
          ["Scored Trades", number(perf.scored_accepted_trades), "Accepted paper trades with known outcomes.", "warn"],
          ["Pending Trades", number(pendingCount), "Accepted paper trades waiting for outcomes.", pendingCount ? "warn" : "good"],
          ["Learning Heartbeat", learningAge, `${number(velocity.resolved_last_1h)} source-backed learning outcomes in the last hour.`, learningTone],
          ["Accepted Proof Age", perf.latest_scored_age_minutes == null ? "n/a" : `${Number(perf.latest_scored_age_minutes).toFixed(1)} min`, "Accepted proof can be stale while zero-exposure shadow learning is still active.", "warn"],
        ];
        document.getElementById("cards").innerHTML = cards.map(([label, value, note, tone]) => `<article class="card"><div class="label">${esc(label)}</div><div class="metric-value ${esc(tone)}">${esc(value)}</div><div class="metric-note">${text(note)}</div></article>`).join("");
        const allTime = data.all_time_baseline || {};
        const allPerf = allTime.performance_summary || {};
        const allPaper = allTime.paper || {};
        document.getElementById("all-time-table").innerHTML = header(["Metric", "All-Time Baseline", "Why It Matters"]) +
          row(["Paper P&L", `<span class="${classForValue(allPerf.paper_pnl_usd)}">${esc(money(allPerf.paper_pnl_usd))}</span>`, "Historical simulated net result from all preserved paper data."]) +
          row(["Accuracy", pct(allPerf.accuracy), "Historical win rate before and after the epoch reset."]) +
          row(["Scored trades", number(allPerf.scored_accepted_trades), "Historical accepted paper trades with outcomes."]) +
          row(["Total decisions", number(allPaper.total_decisions), "All recorded decisions kept for audit and comparison."]) +
          row(["Inverse Standard Strategy tests", number(allPaper.inverse_forward_tests), "All recorded Inverse Standard Strategy forward-paper tests kept for comparison."]);
        const strategyComparison = data.strategy_comparison || {};
        const strategyRows = strategyComparison.rows || [];
        document.getElementById("strategy-comparison-summary").textContent = standardizeStrategyText(strategyComparison.plain_english || "Standard Strategy, Inverse Standard Strategy, Weather Arbitrage Strategy, PolyClaw, and polymarket-kalshi-divergence are tracked separately.");
        document.getElementById("strategy-comparison-table").innerHTML = header(["Strategy", "Equal Weight", "Accepted", "Scored", "Accuracy", "Actual P&L", "P&L Δ vs Standard", "Status / Next Step"]) +
          (strategyRows.length ? strategyRows.map((s) => {
            const auditNote = s.audit_accuracy !== undefined || s.audit_pnl_usd !== undefined ? ` Historical audit: ${pct(s.audit_accuracy)}, ${money(s.audit_pnl_usd)}.` : "";
            const deltaTone = ["positive", "negative", "neutral", "waiting"].includes(s.pnl_delta_tone) ? s.pnl_delta_tone : "waiting";
            const deltaDisplay = s.pnl_delta_display || "Waiting for proof";
            const deltaLabel = s.pnl_delta_vs_standard_label || "waiting for scored proof";
            const role = String(s.role || "paper-only comparison lane").replaceAll("_", " ");
            return row([
              `<div class="strategy-cell"><strong>${text(s.display_name || s.strategy_id || "")}</strong><span class="strategy-note">${text(role)}</span></div>`,
              `<span class="equal-weight-token">${Number(s.strategy_comparison_weight_pct || 0).toFixed(1)}%</span><br><span class="strategy-note">${text(s.strategy_comparison_weight_label || "equal strategy weight")}</span>`,
              number(s.accepted),
              number(s.scored),
              pct(s.accuracy),
              `<span class="${classForValue(s.paper_pnl_usd)}">${esc(money(s.paper_pnl_usd))}</span>`,
              `<span class="delta-badge ${esc(deltaTone)}">${text(deltaDisplay)}</span><br><span class="strategy-note">${text(deltaLabel)}</span>`,
              `${text(String(s.tracking_status || "tracking").replaceAll("_", " "))}. ${text(s.next_step || "Keep collecting clean paper evidence.")}${text(auditNote)}`,
            ]);
          }).join("") : emptyRow(8, "No strategy comparison snapshot is available yet."));
        const cat = perf.category_accuracy || {};
        const rows = Object.entries(cat).sort((a,b) => (b[1].scored || 0) - (a[1].scored || 0));
        document.getElementById("category-table").innerHTML = header(["Category", "Accuracy", "Scored", "Wins / Losses", "P&L", "Profit", "Loss"]) +
          (rows.length ? rows.map(([name, s]) => row([
            text(name), pct(s.accuracy), number(s.scored), `${number(s.wins)} / ${number(s.losses)}`, `<span class="${classForValue(s.pnl)}">${esc(money(s.pnl))}</span>`, money(s.profit), money(s.loss)
          ])).join("") : emptyRow(7, "No scored paper trades yet."));
        const proof = data.forward_paper_proof || {};
        const proofGate = proof.proof_gate || {};
        document.getElementById("proof-summary").textContent = standardizeStrategyText(proofGate.plain_english_summary || "Forward-paper proof has not run yet.");
        const proofRows = proof.lanes || [];
        document.getElementById("proof-table").innerHTML = header(["Lane", "Status", "Scored", "Accuracy", "P&L", "Brier", "Market Brier"]) +
          (proofRows.length ? proofRows.map((s) => row([
            text(s.lane || ""), `<span class="status">${text(s.gate_status || "")}</span>`, number(s.scored), pct(s.accuracy), `<span class="${classForValue(s.paper_pnl_usd)}">${esc(money(s.paper_pnl_usd))}</span>`, esc(s.brier_score ?? "n/a"), esc(s.market_brier_score ?? "n/a")
          ])).join("") : emptyRow(7, "No forward-paper proof lanes have scored yet."));
        const diagnosis = data.strategy_proof_diagnosis || {};
        const inverseFailure = data.inverse_failure_diagnosis || {};
        const inverseFailureSummary = inverseFailure.summary || diagnosis.applied_inverse_failure_diagnosis?.summary || {};
        document.getElementById("diagnosis-summary").textContent = standardizeStrategyText(diagnosis.plain_english_summary || "Strategy proof diagnosis has not run yet.");
        const inverse = diagnosis.inverse_forward || {};
        document.getElementById("diagnosis-table").innerHTML = header(["Diagnosis", "Recommended Route", "Inverse Expansion", "Fresh Inverse Proof", "Next Action"]) +
          row([text(diagnosis.diagnosis || "not available"), text(diagnosis.recommended_route || "not available"), diagnosis.inverse_expansion_allowed ? "allowed tiny tests" : "frozen or shadow-only", `${number(inverse.scored)} scored, ${pct(inverse.accuracy)}, ${money(inverse.paper_pnl_usd)}`, text((diagnosis.next_actions || ["Keep collecting clean paper evidence."])[0])]) +
          row(["Applied Inverse Standard Strategy detail", text(inverseFailureSummary.broad_inverse_budget_status || "not available"), "segment-scoped only", `${number(inverseFailureSummary.inverse_scored)} scored, ${pct(inverseFailureSummary.inverse_accuracy)}, ${money(inverseFailureSummary.inverse_paper_pnl_usd)}`, text(inverseFailureSummary.top_failure_reason || "Run the inverse failure diagnosis.")]);
        const firewall = data.profit_firewall || {};
        const modelLanePolicy = firewall.model_lane_policy || {};
        const modelLanes = (firewall.model_lane_performance || []).slice(0, 12);
        document.getElementById("model-lane-firewall-summary").textContent = standardizeStrategyText(modelLanePolicy.plain_english || "Exact model-lane routing has not run yet.");
        document.getElementById("model-lane-firewall-table").innerHTML = header(["Status", "Exact Setup", "Scored", "Accuracy", "Paper P&L", "What OpenClaw Will Do", "Plain-English Reason"]) +
          (modelLanes.length ? modelLanes.map((lane) => {
            const setup = `${lane.category || "unknown"} / ${lane.strategy_bucket || "unknown"} / ${lane.fair_value_source_type || "unknown"} / ${lane.side || "unknown"}`;
            return row([`<span class="status">${text(lane.status || "learning")}</span>`, text(setup), number(lane.scored), pct(lane.accuracy), `<span class="${classForValue(lane.paper_pnl_usd)}">${esc(money(lane.paper_pnl_usd))}</span>`, text(String(lane.paper_action || "keep learning").replaceAll("_", " ")), text(lane.plain_english_reason || "")]);
          }).join("") : emptyRow(7, "No exact model-lane evidence yet."));
        const pending = data.pending_paper_trades?.trades || [];
        document.getElementById("pending-table").innerHTML = header(["Expected Result Known", "Trade", "Decision", "Category", "Paper Size"]) +
          (pending.length ? pending.map((t) => row([fmt(t.expected_result_known_time_utc), `<strong>${text(t.market_ticker || "")}</strong><br><span class="muted">${text(t.market_title || "")}</span>`, text(t.decision || ""), text(t.category || ""), money(t.simulated_size_usd)])).join("") : emptyRow(5, "No unresolved accepted paper trades."));
      } catch (error) {
        document.getElementById("hero-title").textContent = "Dashboard data did not load.";
        document.getElementById("subtitle").textContent = String(error?.message || error || "Unknown loading error");
      }
    }
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>
"""
    DASHBOARD_HTML_PATH.write_text(html, encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Refresh the Kalshi dashboard JSON and static page.")
    parser.add_argument("--no-html", action="store_true", help="Do not rewrite dashboard HTML.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        dashboard, warnings = build_dashboard()
        atomic_write_json(DASHBOARD_OUTPUT_PATH, dashboard)
        atomic_write_json(DASHBOARD_DATA_PATH, dashboard)
        if not args.no_html:
            write_dashboard_html()
        envelope = success_envelope(
            script=SCRIPT,
            path="/dashboard/refresh",
            data={
                "dashboard_output": str(DASHBOARD_OUTPUT_PATH),
                "dashboard_data": str(DASHBOARD_DATA_PATH),
                "dashboard_html": str(DASHBOARD_HTML_PATH),
                "generated_at_utc": dashboard["generated_at_utc"],
                "paper_decisions": dashboard["paper"]["total_decisions"],
                "paper_outcomes": dashboard["log_counts"]["paper_outcomes"],
                "live_order_allowed": False,
            },
            warnings=warnings,
        )
        print(json.dumps(envelope, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps(failure_envelope(script=SCRIPT, path="/dashboard/refresh", exc=exc), indent=2, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

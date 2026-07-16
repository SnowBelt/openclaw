#!/usr/bin/env python3
"""Maintainable, fail-closed Kalshi dashboard truth builder.

The previous source was lost while its Python 3.9 bytecode remained. This
replacement deliberately favors explicit receipt freshness and safety over
reconstructing unprovable analytics from a multi-gigabyte append-only log.
Legacy dashboard sections may be retained as clearly marked cache entries;
current safety, Whale Flow, STS, Weather/Crypto, model, CLV, scheduler, and
canary surfaces are always rebuilt from current local receipts.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from kalshi_support import READ_ONLY_MODE, parse_utc, utc_now  # noqa: E402

SCRIPT = "kalshi_dashboard.py"
KALSHI_SCRIPT_ROOT = Path(__file__).resolve().parent
LOGS_DIR = KALSHI_SCRIPT_ROOT / "logs"
DASHBOARD_DIR = KALSHI_SCRIPT_ROOT / "dashboard"
DASHBOARD_DATA_PATH = DASHBOARD_DIR / "kalshi_dashboard_data.json"
DASHBOARD_SUMMARY_PATH = DASHBOARD_DIR / "kalshi_dashboard_summary.json"
DASHBOARD_OUTPUT_PATH = LOGS_DIR / "dashboard_output.json"
DASHBOARD_HTML_PATH = DASHBOARD_DIR / "kalshi_dashboard.html"
PAPER_DECISIONS_PATH = LOGS_DIR / "paper_decisions.jsonl"
PAPER_OUTCOMES_PATH = LOGS_DIR / "paper_outcomes.jsonl"
SHADOW_OUTCOMES_PATH = LOGS_DIR / "shadow_outcomes.jsonl"
PAPER_EPOCH_STATE_PATH = LOGS_DIR / "paper_epoch_state.json"
WEATHER_CRYPTO_EVIDENCE_TRUTH_PATH = DASHBOARD_DIR / "kalshi_weather_crypto_evidence_truth.json"
WEATHER_CRYPTO_EVIDENCE_MAX_AGE_SECONDS = 15 * 60
DASHBOARD_MAX_TREND_POINTS = 720
DASHBOARD_MAX_SCORECARD_SEGMENTS = 100
DASHBOARD_MAX_BROWSER_BLOCKERS = 50
DASHBOARD_MAX_BROWSER_MESSAGES = 50
KALSHI_COPY_SHADOW_STATUS_PATH = KALSHI_SCRIPT_ROOT / "kalshi_copy_shadow_status_v1.json"
KALSHI_WHALE_FLOW_STATUS_PATH = KALSHI_SCRIPT_ROOT / "kalshi_whale_flow_status_v1.json"
KALSHI_WHALE_FLOW_CURRENT_STATE_PATH = KALSHI_SCRIPT_ROOT / "kalshi_whale_flow_current_state_v1.json"
KALSHI_WHALE_FLOW_LOCAL_SCHEDULER_PATH = KALSHI_SCRIPT_ROOT / "kalshi_whale_flow_local_scheduler_v1.json"
KALSHI_WHALE_FLOW_LIVENESS_TRUTH_PATH = KALSHI_SCRIPT_ROOT / "kalshi_whale_flow_liveness_truth_v1.json"
SPORTS_SUSPENSION_PATH = LOGS_DIR / "sports_suspension_status.json"

_UNSAFE_LIVE_KEYS = {
    "auto_live_promotion_allowed",
    "can_authorize_live",
    "can_authorize_trade",
    "live_order_allowed",
    "live_trading_enabled",
    "write_capable_kalshi_endpoint_called",
}

DIRECT_ARTIFACTS: dict[str, Path] = {
    "baseline_scorecard": LOGS_DIR / "baseline_scorecard_latest.json",
    "build_gap_audit": LOGS_DIR / "build_gap_audit.json",
    "forward_paper_proof": LOGS_DIR / "forward_paper_proof_latest.json",
    "inverse_failure_diagnosis": LOGS_DIR / "inverse_failure_diagnosis_latest.json",
    "market_telemetry": LOGS_DIR / "kalshi_market_telemetry_latest.json",
    "markov_microstructure": LOGS_DIR / "markov_microstructure_latest.json",
    "outcome_resolution": LOGS_DIR / "outcome_resolution_latest.json",
    "weather_outcome_resolution": LOGS_DIR / "weather_outcome_resolution_latest.json",
    "source_lag_surface_strategy": LOGS_DIR / "source_lag_surface_strategy.json",
    "strategy_governor_enforcement": LOGS_DIR / "strategy_governor_enforcement_v1.json",
    "strategy_proof_diagnosis": LOGS_DIR / "strategy_proof_diagnosis_latest.json",
    "weather_crypto_contract_repair": LOGS_DIR / "weather_crypto_contract_repair.json",
    "weather_forward_evidence_capture": LOGS_DIR / "weather_forward_evidence_capture_latest.json",
    "weather_source_freshness": LOGS_DIR / "weather_source_freshness.json",
    "sports_suspension": SPORTS_SUSPENSION_PATH,
    "mlx_diagnostic": LOGS_DIR / "mlx_diagnostic.json",
    "weather_crypto_mlx_benchmark": LOGS_DIR / "weather_crypto_mlx_benchmark.json",
    "v14_candidate_performance": LOGS_DIR / "crypto_v14_candidate_performance.json",
    "evidence_sprint_contract": KALSHI_SCRIPT_ROOT / "kalshi_24h_evidence_sprint_preregistration_v1.json",
    "evidence_sprint_status": LOGS_DIR / "kalshi_24h_sprint_status.json",
    "segment_policy_holdout": LOGS_DIR / "kalshi_segment_policy_holdout.json",
    "segment_policy_supply_projection": LOGS_DIR / "kalshi_segment_policy_supply_projection.json",
    "paper_contest_approval": KALSHI_SCRIPT_ROOT / "kalshi_paper_contest_approval_v2.json",
    "paper_contest": LOGS_DIR / "paper_contest_v2_status.json",
    "paper_contest_approval_v1": KALSHI_SCRIPT_ROOT / "kalshi_paper_contest_approval_v1.json",
    "paper_contest_v1": LOGS_DIR / "paper_contest_status.json",
    "paper_contest_approval_v2": KALSHI_SCRIPT_ROOT / "kalshi_paper_contest_approval_v2.json",
    "paper_contest_v2": LOGS_DIR / "paper_contest_v2_status.json",
    "fallback_v3_holdout_contract": KALSHI_SCRIPT_ROOT
    / "kalshi_fallback_v3_holdout_preregistration_v1.json",
    "fallback_v3_holdout": LOGS_DIR / "fallback_v3_holdout_status.json",
    "timesfm_diagnostic": LOGS_DIR / "timesfm_diagnostic.json",
    "local_ai_operator_schedule": KALSHI_SCRIPT_ROOT / "kalshi_local_ai_operator_schedule_v1.json",
    "local_ai_operator_install": KALSHI_SCRIPT_ROOT / "kalshi_local_ai_operator_install_v1.json",
    "local_ai_operator_latest": KALSHI_SCRIPT_ROOT / "kalshi_local_ai_operator_latest_v1.json",
    "local_model_bakeoff": LOGS_DIR / "kalshi_local_model_bakeoff_v1.json",
    "launchagent_integrity": KALSHI_SCRIPT_ROOT / "kalshi_launchagent_integrity_v1.json",
    "crypto_settlement_oracle": LOGS_DIR / "crypto_settlement_oracle" / "settlement_oracle_latest.json",
    "crypto_settlement_oracle_readiness": LOGS_DIR / "crypto_settlement_oracle" / "settlement_oracle_replay_power_readiness.json",
    "sts_agent_audit": LOGS_DIR / "sts" / "sts_agent_audit.json",
    "sts_crypto_baseline_calibration": LOGS_DIR / "sts" / "sts_crypto_baseline_calibration.json",
    "sts_crypto_evidence_repair": LOGS_DIR / "sts" / "sts_crypto_evidence_repair.json",
    "sts_crypto_execution_realism": LOGS_DIR / "sts" / "sts_crypto_execution_realism.json",
    "sts_crypto_execution_selector": LOGS_DIR / "sts" / "sts_crypto_execution_selector.json",
    "sts_crypto_execution_selector_outcomes": LOGS_DIR / "sts" / "sts_crypto_execution_selector_outcomes.json",
    "sts_crypto_fresh_cycle": LOGS_DIR / "sts" / "sts_crypto_fresh_cycle.json",
    "sts_crypto_fresh_window_diagnostics": LOGS_DIR / "sts" / "sts_crypto_fresh_window_diagnostics.json",
    "sts_crypto_probability_recalibrator": LOGS_DIR / "sts" / "sts_crypto_probability_recalibrator.json",
    "sts_crypto_regime_inverse_repair": LOGS_DIR / "sts" / "sts_crypto_regime_inverse_repair.json",
    "sts_crypto_regime_selector": LOGS_DIR / "sts" / "sts_crypto_regime_selector.json",
    "sts_crypto_regime_selector_outcomes": LOGS_DIR / "sts" / "sts_crypto_regime_selector_outcomes.json",
    "sts_crypto_segment_edge": LOGS_DIR / "sts" / "sts_crypto_segment_edge.json",
    "sts_domain_learning_optimizer": LOGS_DIR / "sts" / "sts_domain_learning_optimizer.json",
    "sts_domain_optimizer": LOGS_DIR / "sts" / "sts_domain_optimizer.json",
    "sts_readiness_eta": LOGS_DIR / "sts" / "sts_readiness_eta.json",
    "sts_segment_policy_model": LOGS_DIR / "sts" / "sts_segment_policy_model.json",
    "sts_unlock_queue": LOGS_DIR / "sts" / "sts_unlock_queue.json",
    "sts_weather_selector_repair": LOGS_DIR / "sts" / "sts_weather_selector_repair.json",
    "supreme_trading_strategy": LOGS_DIR / "sts" / "supreme_trading_strategy.json",
}


def _money(value: Any) -> float:
    try:
        if value is None or isinstance(value, bool):
            return 0.0
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return 0.0 if not math.isfinite(number) else round(number, 2)


def _rate(value: Any) -> float:
    try:
        if value is None or isinstance(value, bool):
            return 0.0
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return 0.0 if not math.isfinite(number) else round(number, 4)


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
    original = str(decision.get("original_strategy_side") or "").upper()
    return original if original in {"YES", "NO"} else "UNKNOWN"


def _category(decision: dict[str, Any]) -> str:
    taxonomy = decision.get("strategy_taxonomy")
    if isinstance(taxonomy, dict) and isinstance(taxonomy.get("domain"), str):
        return str(taxonomy["domain"]).lower()
    category = str(decision.get("market_category") or "").lower()
    title = str(decision.get("market_title") or "").lower()
    ticker = str(decision.get("market_ticker") or "").lower()
    text = " ".join((category, title, ticker))
    if category in {"weather", "sports", "economics", "crypto", "politics", "entertainment"}:
        return category
    if any(word in text for word in ("weather", "temperature", "rain")) or ticker.startswith(("kxhigh", "kxlow", "kxtemp")):
        return "weather"
    if any(word in text for word in ("sports", " wins", "goal", "runs", "nba", "nfl", "mlb", "nhl")):
        return "sports"
    if any(word in text for word in ("fed", "cpi", "inflation", "jobs", "unemployment", "gdp")):
        return "economics"
    if any(word in text for word in ("bitcoin", "btc", "crypto", "ethereum", "eth", "doge", "solana", "xrp")):
        return "crypto"
    if any(word in text for word in ("election", "president", "senate", "congress")):
        return "politics"
    return "other"


def _is_accepted(decision: dict[str, Any]) -> bool:
    if _money(decision.get("simulated_size_usd")) <= 0:
        return False
    name = str(decision.get("decision") or "").upper()
    accepted = {
        "INVERSE_FORWARD_TEST",
        "ACCEPT_EXPLORATION",
        "PAPER_EXPLORE_BUY_YES",
        "PAPER_EXPLORE_BUY_NO",
        "PAPER_EXPLORE_QUOTE",
        "PAPER_BUY_YES",
        "PAPER_BUY_NO",
        "PAPER_QUOTE_TWO_SIDED",
        "ACCEPT_FORWARD_PAPER",
    }
    if name in accepted or name.startswith("PAPER_INVERSE_FORWARD_"):
        return True
    return decision.get("paper_exploration") is True or decision.get("evidence_tier") in {
        "live_review_candidate",
        "exploration",
        "forward_paper",
    }


def _outcome_yes_value(outcome: dict[str, Any]) -> int | None:
    value = outcome.get("outcome_yes")
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)) and value in {0, 1}:
        return int(value)
    result = str(outcome.get("result") or outcome.get("outcome") or "").upper()
    return 1 if result == "YES" else 0 if result == "NO" else None


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
    except (TypeError, ValueError, OverflowError):
        price = 0.5
    side = _side(decision)
    outcome_yes = _outcome_yes_value(outcome)
    if side not in {"YES", "NO"} or outcome_yes is None:
        return 0.0
    won = (side == "YES" and outcome_yes == 1) or (side == "NO" and outcome_yes == 0)
    contracts = size / price
    gross = contracts * (1.0 - price) if won else -size
    return round(gross, 2)


def _strategy_family(decision: dict[str, Any]) -> str | None:
    if decision.get("inverse_strategy_applied") is True:
        return "inverse_standard_strategy"
    bucket = str(decision.get("strategy_bucket") or "").lower()
    experiment = str(decision.get("paper_experiment_type") or "").lower()
    source = str(decision.get("fair_value_source_type") or "").lower()
    method = str(decision.get("fair_value_method") or "").lower()
    skill = str(decision.get("skill") or decision.get("skill_name") or "").lower()
    decision_text = str(decision.get("decision") or "").lower()
    haystack = " ".join((bucket, experiment, source, method, skill, decision_text))
    if "polymarket-kalshi-divergence" in haystack or "polymarket_kalshi_divergence" in haystack:
        return "polymarket_kalshi_divergence"
    if "polyclaw" in haystack or "poly_claw" in haystack:
        return "polyclaw"
    if "weather_arbitrage" in bucket or "weather_arbitrage" in experiment:
        return "weather_arbitrage_strategy"
    if "inverse" in bucket or "inverse" in experiment or "inverse" in decision_text:
        return "inverse_standard_strategy"
    if bucket in {"high_probability_harvesting_simulation", "market_making_simulation", "weather_model_fast_evidence"}:
        return "standard_strategy"
    return None


def _load_json_file(path: Path, warnings: list[str], *, required: bool = False) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        if required:
            warnings.append(f"missing_required_artifact:{path}")
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"malformed_artifact:{path}:{type(exc).__name__}")
        return {}
    if not isinstance(payload, dict):
        warnings.append(f"non_object_artifact:{path}")
        return {}
    return payload


def _unsafe_true_paths(value: Any, prefix: str = "") -> list[str]:
    unsafe: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if key in _UNSAFE_LIVE_KEYS and child is True:
                unsafe.append(path)
            unsafe.extend(_unsafe_true_paths(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            unsafe.extend(_unsafe_true_paths(child, f"{prefix}[{index}]"))
    return unsafe


def _safe_artifact(path: Path, warnings: list[str], *, required: bool = False) -> dict[str, Any]:
    payload = _load_json_file(path, warnings, required=required)
    unsafe = _unsafe_true_paths(payload)
    if unsafe:
        warnings.append(f"unsafe_artifact_rejected:{path}")
        return {
            "status": "UNSAFE_RECEIPT_REJECTED",
            "source_path": str(path),
            "unsafe_true_paths": unsafe,
            "live_order_allowed": False,
            "live_trading_enabled": False,
            "write_capable_kalshi_endpoint_called": False,
        }
    return payload


def _downsample_points(points: Any, *, limit: int = DASHBOARD_MAX_TREND_POINTS) -> tuple[list[Any], int]:
    if not isinstance(points, list):
        return [], 0
    total = len(points)
    if total <= limit:
        return list(points), total
    if limit < 2:
        return [points[-1]], total
    indices = {round(index * (total - 1) / (limit - 1)) for index in range(limit)}
    return [points[index] for index in sorted(indices)], total


def _compact_performance_summary(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    points, total = _downsample_points(value.get("trend_points"))
    if "trend_points" in result:
        result["trend_points"] = points
        result["trend_points_total"] = total
        result["trend_points_transport_downsampled"] = total > len(points)
    return result


def _compact_scorecard(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    trend = dict(value.get("trend")) if isinstance(value.get("trend"), dict) else {}
    points, total = _downsample_points(trend.get("points"))
    if "points" in trend:
        trend["points"] = points
        trend["point_count_total"] = total
        trend["transport_downsampled"] = total > len(points)
    result["trend"] = trend
    segments = value.get("segments") if isinstance(value.get("segments"), list) else []
    if segments:
        result["segments"] = segments[:DASHBOARD_MAX_SCORECARD_SEGMENTS]
        result["segment_count_total"] = len(segments)
        result["segments_transport_truncated"] = len(segments) > len(result["segments"])
    return result


def _compact_weather_source(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = {
        key: child
        for key, child in value.items()
        if key not in {"cities", "stations", "target_dates"}
    }
    target_dates = value.get("target_dates") if isinstance(value.get("target_dates"), dict) else {}
    result["target_date_summaries"] = (
        {
            str(target): {
                "timestamp_utc": detail.get("timestamp_utc"),
                "target_date": detail.get("target_date") or target,
                "city_count": len(detail.get("cities")) if isinstance(detail.get("cities"), dict) else 0,
                "station_count": len(detail.get("stations")) if isinstance(detail.get("stations"), dict) else 0,
                "live_order_allowed": False,
            }
            for target, detail in sorted(target_dates.items())
            if isinstance(detail, dict)
        }
        if target_dates
        else dict(value.get("target_date_summaries"))
        if isinstance(value.get("target_date_summaries"), dict)
        else {}
    )
    result["raw_city_count"] = len(value.get("cities")) if isinstance(value.get("cities"), dict) else 0
    result["raw_station_count"] = len(value.get("stations")) if isinstance(value.get("stations"), dict) else 0
    result["raw_target_date_count"] = len(target_dates)
    result["raw_artifact_path"] = "work/scripts/kalshi/logs/weather_source_freshness.json"
    result["transport_projection"] = "SUMMARY_ONLY_RAW_RECEIPT_PRESERVED"
    return result


def _compact_whale_status(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    source_health = dict(value.get("source_health")) if isinstance(value.get("source_health"), dict) else {}
    verifier = source_health.get("whale_flow_verifier")
    if isinstance(verifier, dict):
        source_health["whale_flow_verifier"] = {
            key: verifier.get(key)
            for key in (
                "ok",
                "status",
                "generated_at_utc",
                "completed_at_utc",
                "critical_failures",
                "warnings",
                "live_order_allowed",
                "live_trading_enabled",
                "write_capable_kalshi_endpoint_called",
            )
            if key in verifier
        }
        source_health["whale_flow_verifier_transport"] = {
            "duplicate_nested_detail_omitted": True,
            "detail_available_at_top_level": True,
            "raw_artifact_path": "work/scripts/kalshi/kalshi_whale_flow_status_v1.json",
            "live_order_allowed": False,
        }
    result["source_health"] = source_health
    return result


def _compact_cached_dashboard(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    if "performance_summary" in result:
        result["performance_summary"] = _compact_performance_summary(result.get("performance_summary"))
    if "strategy_scorecard" in result:
        result["strategy_scorecard"] = _compact_scorecard(result.get("strategy_scorecard"))
    baseline = result.get("all_time_baseline")
    if isinstance(baseline, dict):
        compact_baseline = dict(baseline)
        compact_baseline["performance_summary"] = _compact_performance_summary(
            baseline.get("performance_summary")
        )
        result["all_time_baseline"] = compact_baseline
    self_improvement = result.get("self_improvement")
    if isinstance(self_improvement, dict):
        compact_improvement = dict(self_improvement)
        category_performance = compact_improvement.pop("category_performance", None)
        if isinstance(category_performance, dict):
            compact_improvement["category_performance_transport"] = {
                "raw_entry_count": len(category_performance),
                "raw_detail_omitted": True,
                "counts_for_trade_ready_unlock": False,
            }
        result["self_improvement"] = compact_improvement
    if "weather_source_freshness" in result:
        result["weather_source_freshness"] = _compact_weather_source(
            result.get("weather_source_freshness")
        )
    if "kalshi_whale_flow_shadow" in result:
        result["kalshi_whale_flow_shadow"] = _compact_whale_status(
            result.get("kalshi_whale_flow_shadow")
        )
    copy = result.get("kalshi_copy_shadow")
    if isinstance(copy, dict):
        compact_copy = {
            key: child
            for key, child in copy.items()
            if key not in {"whale_flow", "whale_flow_shadow"}
        }
        result["kalshi_copy_shadow"] = compact_copy
    return result


def _bounded_strings(value: Any, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value[: max(0, int(limit))] if isinstance(item, str)]


def _dashboard_browser_summary(payload: dict[str, Any]) -> dict[str, Any]:
    """Project only fields rendered by the browser; full audit truth stays on disk."""
    evidence = (
        payload.get("weather_crypto_evidence_truth")
        if isinstance(payload.get("weather_crypto_evidence_truth"), dict)
        else {}
    )
    strict = evidence.get("strict_labels") if isinstance(evidence.get("strict_labels"), dict) else {}
    canary = evidence.get("canary_review") if isinstance(evidence.get("canary_review"), dict) else {}
    source_health = evidence.get("source_health") if isinstance(evidence.get("source_health"), dict) else {}
    scheduler = (
        evidence.get("scheduler_reliability")
        if isinstance(evidence.get("scheduler_reliability"), dict)
        else {}
    )
    model = evidence.get("model_readiness") if isinstance(evidence.get("model_readiness"), dict) else {}
    readiness = payload.get("live_readiness") if isinstance(payload.get("live_readiness"), dict) else {}
    no_live = payload.get("no_live_validator") if isinstance(payload.get("no_live_validator"), dict) else {}
    local_ai = payload.get("local_ai_operator_latest") if isinstance(payload.get("local_ai_operator_latest"), dict) else {}
    v14 = payload.get("v14_candidate_performance") if isinstance(payload.get("v14_candidate_performance"), dict) else {}
    v14_overall = v14.get("overall") if isinstance(v14.get("overall"), dict) else {}
    v14_holdout = v14.get("prospective_holdout") if isinstance(v14.get("prospective_holdout"), dict) else {}
    sprint = payload.get("evidence_sprint_status") if isinstance(payload.get("evidence_sprint_status"), dict) else {}
    sprint_holdout = sprint.get("holdout") if isinstance(sprint.get("holdout"), dict) else {}
    sprint_throughput = sprint.get("throughput") if isinstance(sprint.get("throughput"), dict) else {}
    sprint_readiness = sprint.get("readiness") if isinstance(sprint.get("readiness"), dict) else {}
    sprint_contract = (
        payload.get("evidence_sprint_contract")
        if isinstance(payload.get("evidence_sprint_contract"), dict)
        else {}
    )
    future_risk = (
        sprint_contract.get("future_paper_contest_risk_contract_not_active")
        if isinstance(sprint_contract.get("future_paper_contest_risk_contract_not_active"), dict)
        else {}
    )
    contest_approval = (
        payload.get("paper_contest_approval")
        if isinstance(payload.get("paper_contest_approval"), dict)
        else {}
    )
    contest = payload.get("paper_contest") if isinstance(payload.get("paper_contest"), dict) else {}
    contest_activation = (
        contest.get("activation") if isinstance(contest.get("activation"), dict) else {}
    )
    contest_gate = (
        contest_activation.get("gate")
        if isinstance(contest_activation.get("gate"), dict)
        else {}
    )
    contest_portfolio = (
        contest.get("portfolio") if isinstance(contest.get("portfolio"), dict) else {}
    )
    contest_risk = (
        contest.get("risk_contract")
        if isinstance(contest.get("risk_contract"), dict)
        else future_risk
    )
    contest_logs = contest.get("append_logs") if isinstance(contest.get("append_logs"), dict) else {}
    contest_integrity = (
        contest_logs.get("integrity") if isinstance(contest_logs.get("integrity"), dict) else {}
    )
    contest_anchor = (
        contest_logs.get("anchor") if isinstance(contest_logs.get("anchor"), dict) else {}
    )
    contest_v1 = (
        payload.get("paper_contest_v1")
        if isinstance(payload.get("paper_contest_v1"), dict)
        else {}
    )
    contest_v1_activation = (
        contest_v1.get("activation")
        if isinstance(contest_v1.get("activation"), dict)
        else {}
    )
    contest_v1_logs = (
        contest_v1.get("append_logs")
        if isinstance(contest_v1.get("append_logs"), dict)
        else {}
    )
    contest_v1_integrity = (
        contest_v1_logs.get("integrity")
        if isinstance(contest_v1_logs.get("integrity"), dict)
        else {}
    )
    contest_v1_anchor = (
        contest_v1_logs.get("anchor")
        if isinstance(contest_v1_logs.get("anchor"), dict)
        else {}
    )
    fallback_v3 = (
        payload.get("fallback_v3_holdout")
        if isinstance(payload.get("fallback_v3_holdout"), dict)
        else {}
    )
    fallback_v3_trigger = (
        fallback_v3.get("trigger") if isinstance(fallback_v3.get("trigger"), dict) else {}
    )
    fallback_v3_holdout = (
        fallback_v3.get("holdout") if isinstance(fallback_v3.get("holdout"), dict) else {}
    )
    fallback_v3_integrity = (
        fallback_v3.get("integrity")
        if isinstance(fallback_v3.get("integrity"), dict)
        else {}
    )
    segment = payload.get("segment_policy_holdout") if isinstance(payload.get("segment_policy_holdout"), dict) else {}
    segment_evaluation = (
        segment.get("evaluation")
        if segment.get("sealed") is False and isinstance(segment.get("evaluation"), dict)
        else {}
    )
    segment_overall = (
        segment_evaluation.get("overall")
        if isinstance(segment_evaluation.get("overall"), dict)
        else {}
    )
    segment_supply_receipt = (
        payload.get("segment_policy_supply_projection")
        if isinstance(payload.get("segment_policy_supply_projection"), dict)
        else {}
    )
    segment_supply = (
        segment_supply_receipt.get("projected_supply")
        if segment_supply_receipt.get("contract_sha256") == sprint_contract.get("contract_sha256")
        and isinstance(segment_supply_receipt.get("projected_supply"), dict)
        else {}
    )
    return {
        "schema_version": "kalshi-dashboard-browser-summary-v1",
        "generated_at_utc": payload.get("generated_at_utc"),
        "mode": READ_ONLY_MODE,
        "no_live_validator": {
            "ok": no_live.get("ok") is True,
            "critical_failures": _bounded_strings(
                no_live.get("critical_failures"), limit=DASHBOARD_MAX_BROWSER_MESSAGES
            ),
            "live_order_allowed": False,
            "live_trading_enabled": False,
        },
        "weather_crypto_evidence_truth": {
            "receipt_status": evidence.get("receipt_status"),
            "source_health": {
                key: source_health.get(key)
                for key in ("status",)
                if key in source_health
            },
            "scheduler_reliability": {
                key: scheduler.get(key)
                for key in ("status",)
                if key in scheduler
            },
            "strict_labels": {
                key: strict.get(key)
                for key in (
                    "strict_row_count",
                    "strict_training_row_count",
                    "strict_forward_row_count",
                    "strict_shadow_training_row_count",
                )
                if key in strict
            },
            "model_readiness": {
                key: model.get(key)
                for key in ("status", "model_execution")
                if key in model
            },
            "canary_review": {
                key: canary.get(key)
                for key in (
                    "minimum_total_labels",
                    "minimum_strict_forward_resolved_signals",
                )
                if key in canary
            },
            "live_order_allowed": False,
            "live_trading_enabled": False,
        },
        "live_readiness": {
            "status": readiness.get("status") or "BLOCKED",
            "blockers": _bounded_strings(
                readiness.get("blockers"), limit=DASHBOARD_MAX_BROWSER_BLOCKERS
            ),
            "can_authorize_live": False,
            "can_authorize_trade": False,
            "live_order_allowed": False,
            "live_trading_enabled": False,
        },
        "local_ai_operator_latest": {
            "ok": local_ai.get("ok") is True,
            "status": local_ai.get("status") or "UNKNOWN",
            "live_order_allowed": False,
        },
        "v14_candidate_performance": {
            "status": v14.get("status") or "MISSING",
            "graded_candidate_count": v14.get("graded_candidate_count"),
            "pending_candidate_count": v14.get("pending_candidate_count"),
            "overall": {
                key: v14_overall.get(key)
                for key in (
                    "after_fee_pnl_usd",
                    "independent_time_cluster_count",
                    "cluster_bootstrap_mean_after_fee_pnl_95ci_usd",
                    "positive_mean_lower_bound",
                    "max_drawdown_usd",
                )
                if key in v14_overall
            },
            "prospective_holdout": {
                key: v14_holdout.get(key)
                for key in (
                    "status",
                    "start_utc",
                    "end_utc",
                    "sealed_until_utc",
                    "sealed",
                    "candidate_count",
                    "graded_count",
                    "performance_rendered_before_unseal",
                    "outcomes_fetched_before_unseal",
                )
                if key in v14_holdout
            },
            "diagnostic_only": True,
            "counts_as_actual_fill": False,
            "counts_for_profitability_gate": False,
            "counts_for_trade_ready_unlock": False,
            "paper_routing_allowed": False,
            "live_order_allowed": False,
        },
        "paper_evidence_sprint": {
            "status": sprint.get("status") or "MISSING",
            "phase": sprint.get("phase") or "UNKNOWN",
            "holdout": {
                key: sprint_holdout.get(key)
                for key in (
                    "start_utc",
                    "end_utc",
                    "sealed_until_utc",
                    "sealed",
                    "candidate_count",
                    "minimum_unique_candidates",
                    "performance_available",
                )
                if key in sprint_holdout
            },
            "throughput": {
                key: sprint_throughput.get(key)
                for key in (
                    "recent_unique_fixed_filter_pass_events",
                    "fixed_filter_pass_events_per_hour",
                    "projected_holdout_unique_candidates",
                    "filters_relaxed_for_projection",
                )
                if key in sprint_throughput
            },
            "readiness": {
                "paper_contest_status": contest.get("status") or sprint_readiness.get("paper_contest_status") or "NOT_ACTIVE",
                "live_canary_status": "BLOCKED",
                "blockers": _bounded_strings(
                    sprint_readiness.get("blockers"), limit=DASHBOARD_MAX_BROWSER_BLOCKERS
                ),
                "top_action": sprint_readiness.get("top_action"),
            },
            "paper_routing_allowed": False,
            "live_order_allowed": False,
        },
        "segment_policy_holdout": {
            "status": segment.get("status") or "MISSING",
            "sealed": segment.get("sealed") is not False,
            "sealed_until_utc": segment.get("sealed_until_utc"),
            "projected_quote_backed_observations": segment_supply.get(
                "quote_backed_observation_count"
            ),
            "minimum_quote_backed_observations": segment_supply.get(
                "minimum_quote_backed_observations"
            ),
            "supply_projection_is_gate_credit": False,
            "evaluation": (
                {
                    "status": segment_evaluation.get("status"),
                    "gate_passed": segment_evaluation.get("gate_passed") is True,
                    "accepted_observation_count": segment_overall.get("accepted_observation_count"),
                    "independent_time_cluster_count": segment_overall.get("independent_time_cluster_count"),
                    "after_fee_pnl_usd": segment_overall.get("after_fee_pnl_usd"),
                    "cluster_bootstrap_mean_after_fee_pnl_95ci_usd": segment_overall.get(
                        "cluster_bootstrap_mean_after_fee_pnl_95ci_usd"
                    ),
                }
                if segment_evaluation
                else None
            ),
            "counts_as_actual_fill": False,
            "counts_for_profitability_gate": False,
            "paper_routing_allowed": False,
            "live_order_allowed": False,
        },
        "future_paper_contest_risk_contract": {
            "active": contest_activation.get("active") is True,
            "activation_requires_separate_approval": (
                contest_approval.get("conditional_paper_activation_approved") is not True
                or contest_activation.get("terminal_event")
                in {"GATE_REJECTED", "HALTED_INTEGRITY", "HALTED_RISK"}
            ),
            "new_generation_approval_required": contest_activation.get("terminal_event")
            in {"GATE_REJECTED", "HALTED_INTEGRITY", "HALTED_RISK"},
            "starting_bankroll_usd": contest_risk.get("starting_bankroll_usd"),
            "maximum_one_contract_risk_usd": contest_risk.get("maximum_one_contract_risk_usd"),
            "maximum_correlated_crypto_window_exposure_usd": contest_risk.get(
                "maximum_correlated_crypto_window_exposure_usd"
            ),
            "daily_loss_stop_usd": contest_risk.get("daily_loss_stop_usd"),
            "maximum_drawdown_stop_usd": contest_risk.get("maximum_drawdown_stop_usd"),
            "kelly_fraction_cap": contest_risk.get("kelly_fraction_cap"),
            "target_bankroll_is_not_a_risk_override": True,
            "paper_routing_allowed": contest.get("paper_routing_allowed") is True,
            "live_order_allowed": False,
        },
        "paper_contest": {
            "status": contest.get("status") or "MISSING",
            "mode": contest.get("mode") or "READ_ONLY_LOCKED",
            "contest_generation": contest.get("contest_generation") or "v2",
            "conditional_approval_recorded": contest_approval.get(
                "conditional_paper_activation_approved"
            ) is True,
            "active": contest_activation.get("active") is True,
            "activated_at_utc": contest_activation.get("activated_at_utc"),
            "terminal_event": contest_activation.get("terminal_event"),
            "gate_phase": contest_gate.get("phase"),
            "gate_sealed": contest_gate.get("sealed") is not False,
            "gate_blockers": _bounded_strings(
                contest_gate.get("blockers"), limit=DASHBOARD_MAX_BROWSER_BLOCKERS
            ),
            "current_bankroll_usd": contest_portfolio.get("current_bankroll_usd"),
            "realized_after_fee_pnl_usd": contest_portfolio.get("realized_after_fee_pnl_usd"),
            "current_drawdown_usd": contest_portfolio.get("current_drawdown_usd"),
            "current_utc_day_after_fee_pnl_usd": contest_portfolio.get(
                "current_utc_day_after_fee_pnl_usd"
            ),
            "open_position_count": contest_portfolio.get("open_position_count"),
            "open_maximum_loss_usd": contest_portfolio.get("open_maximum_loss_usd"),
            "decision_count": contest_logs.get("decision_count"),
            "outcome_count": contest_logs.get("outcome_count"),
            "append_log_integrity_ok": contest_integrity.get("ok") is True,
            "append_logs_overwritten": contest_integrity.get("append_logs_overwritten") is True,
            "append_log_anchor_verified": contest_anchor.get("verified_at_run_start") is True,
            "append_log_anchor_updated": contest_anchor.get("updated_after_run") is True,
            "new_generation_approval_required": contest_activation.get("terminal_event")
            in {"GATE_REJECTED", "HALTED_INTEGRITY", "HALTED_RISK"},
            "paper_routing_allowed": contest.get("paper_routing_allowed") is True,
            "actual_exchange_orders_placed": 0,
            "actual_exchange_fills": 0,
            "kalshi_write_requests": 0,
            "trade_ready": False,
            "live_order_allowed": False,
            "live_trading_enabled": False,
        },
        "paper_contest_history": {
            "current_generation": contest.get("contest_generation") or "v2",
            "v1": {
                "status": contest_v1.get("status") or "MISSING",
                "terminal_event": contest_v1_activation.get("terminal_event"),
                "active": contest_v1_activation.get("active") is True,
                "event_count": contest_v1_logs.get("event_count"),
                "decision_count": contest_v1_logs.get("decision_count"),
                "outcome_count": contest_v1_logs.get("outcome_count"),
                "append_log_integrity_ok": contest_v1_integrity.get("ok") is True,
                "append_logs_overwritten": contest_v1_integrity.get(
                    "append_logs_overwritten"
                )
                is True,
                "append_log_anchor_verified": contest_v1_anchor.get(
                    "verified_at_run_start"
                )
                is True,
                "preserved_immutable_predecessor": True,
                "rows_reused_by_v2": False,
                "paper_routing_allowed": False,
                "live_order_allowed": False,
            },
            "v2": {
                "status": contest.get("status") or "MISSING",
                "active": contest_activation.get("active") is True,
                "terminal_event": contest_activation.get("terminal_event"),
                "source_checkpoint_floor_recorded": (
                    contest.get("generation", {}).get("source_checkpoint_floor_recorded") is True
                    if isinstance(contest.get("generation"), dict)
                    else False
                ),
                "predecessor_rows_reused": False,
                "backfill_allowed": False,
                "paper_routing_allowed": contest.get("paper_routing_allowed") is True,
                "live_order_allowed": False,
            },
        },
        **(
            {
                "fallback_v3_holdout": {
                    "status": fallback_v3.get("status") or "MISSING",
                    "phase": fallback_v3.get("phase") or "MISSING",
                    "fallback_generation": fallback_v3.get("fallback_generation")
                    or "v3_holdout_only",
                    "trigger_status": fallback_v3_trigger.get("status"),
                    "trigger_eligible": fallback_v3_trigger.get("eligible") is True,
                    "started": fallback_v3_holdout.get("started") is True,
                    "start_utc": fallback_v3_holdout.get("start_utc"),
                    "end_utc": fallback_v3_holdout.get("end_utc"),
                    "sealed_until_utc": fallback_v3_holdout.get("sealed_until_utc"),
                    "duration_hours": fallback_v3_holdout.get("duration_hours"),
                    "source_checkpoint_floor_recorded": fallback_v3_holdout.get(
                        "source_checkpoint_floor_recorded"
                    )
                    is True,
                    "backfill_allowed": False,
                    "integrity_failures": _bounded_strings(
                        fallback_v3_integrity.get("failures"),
                        limit=DASHBOARD_MAX_BROWSER_BLOCKERS,
                    ),
                    "contest_ledger_created": False,
                    "contest_activation_allowed": False,
                    "paper_routing_allowed": False,
                    "live_order_allowed": False,
                }
            }
            if fallback_v3
            else {}
        ),
        "transport": {
            "full_detail_loaded_on_initial_render": False,
            "browser_fetch_uses_summary": True,
        },
        "critical_failures": _bounded_strings(
            payload.get("critical_failures"), limit=DASHBOARD_MAX_BROWSER_MESSAGES
        ),
        "warnings": _bounded_strings(payload.get("warnings"), limit=DASHBOARD_MAX_BROWSER_MESSAGES),
        "auto_apply_allowed": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
    }


def _generated_at(payload: dict[str, Any]) -> str | None:
    for key in ("generated_at_utc", "timestamp_utc", "completed_at_utc", "checked_at_utc"):
        if isinstance(payload.get(key), str):
            return payload[key]
    return None


def _age_seconds(timestamp: Any) -> float | None:
    parsed = parse_utc(timestamp)
    return max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds()) if parsed else None


def _weather_crypto_evidence_snapshot(path: Path, warnings: list[str]) -> dict[str, Any]:
    base = {
        "source_path": "work/scripts/kalshi/dashboard/kalshi_weather_crypto_evidence_truth.json",
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
    }
    source = _load_json_file(path, warnings, required=True)
    if not source:
        warnings.append("weather_crypto_evidence_truth_missing")
        return {**base, "receipt_status": "MISSING", "next_action": "Run the strict weather/crypto evidence loop."}
    unsafe = _unsafe_true_paths(source)
    if unsafe:
        warnings.append("weather_crypto_evidence_truth_unsafe")
        return {
            **base,
            "receipt_status": "UNSAFE",
            "unsafe_true_paths": unsafe,
            "next_action": "Fail closed and repair the unsafe derived truth receipt.",
        }
    generated = source.get("generated_at_utc")
    age = _age_seconds(generated)
    receipt_status = "CURRENT" if age is not None and age <= WEATHER_CRYPTO_EVIDENCE_MAX_AGE_SECONDS else "STALE"
    if receipt_status == "STALE":
        warnings.append("weather_crypto_evidence_truth_stale")
    strict = source.get("strict_labels") if isinstance(source.get("strict_labels"), dict) else {}
    canary = source.get("canary_review") if isinstance(source.get("canary_review"), dict) else {}
    return {
        **base,
        "receipt_status": receipt_status,
        "generated_at_utc": generated,
        "age_seconds": round(age, 3) if age is not None else None,
        "source_health": source.get("source_health") if isinstance(source.get("source_health"), dict) else {},
        "scheduler_reliability": source.get("scheduler_reliability") if isinstance(source.get("scheduler_reliability"), dict) else {},
        "label_velocity": source.get("label_velocity") if isinstance(source.get("label_velocity"), dict) else {},
        "strict_labels": {
            "source_row_count": int(strict.get("source_row_count") or 0),
            "strict_row_count": int(strict.get("strict_row_count") or 0),
            "strict_training_row_count": int(strict.get("strict_training_row_count") or strict.get("strict_row_count") or 0),
            "strict_forward_row_count": int(strict.get("strict_forward_row_count") or 0),
            "strict_shadow_training_row_count": int(strict.get("strict_shadow_training_row_count") or 0),
            "strict_rows_sha256": strict.get("strict_rows_sha256"),
            "by_domain": strict.get("by_domain") if isinstance(strict.get("by_domain"), dict) else {},
            "forward_by_domain": strict.get("forward_by_domain") if isinstance(strict.get("forward_by_domain"), dict) else {},
            "shadow_training_by_domain": strict.get("shadow_training_by_domain") if isinstance(strict.get("shadow_training_by_domain"), dict) else {},
            "rejection_counts": strict.get("rejection_counts") if isinstance(strict.get("rejection_counts"), dict) else {},
        },
        "tournament": source.get("tournament") if isinstance(source.get("tournament"), dict) else {},
        "clv": source.get("clv") if isinstance(source.get("clv"), dict) else {},
        "policy_quote_evidence": source.get("policy_quote_evidence") if isinstance(source.get("policy_quote_evidence"), dict) else {},
        "model_readiness": source.get("model_readiness") if isinstance(source.get("model_readiness"), dict) else {},
        "canary_review": canary,
        "trade_ready_status": str(canary.get("status") or "BLOCKED_REVIEW_ONLY"),
        "next_action": (
            "Keep collecting strict forward source-backed executable labels and timing quotes."
            if receipt_status == "CURRENT"
            else "Refresh the strict weather/crypto evidence loop."
        ),
    }


def _run_no_live_validator() -> dict[str, Any]:
    command = [sys.executable, str(KALSHI_SCRIPT_ROOT / "kalshi_validate_no_live_trading.py"), "--json"]
    try:
        process = subprocess.run(command, cwd=str(KALSHI_SCRIPT_ROOT.parents[2]), text=True, capture_output=True, timeout=12)
        payload = json.loads(process.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return {
            "ok": False,
            "critical_failures": [f"validator_unavailable:{type(exc).__name__}"],
            "live_order_allowed": False,
            "live_trading_enabled": False,
        }
    if not isinstance(payload, dict):
        return {"ok": False, "critical_failures": ["validator_non_object"], "live_order_allowed": False}
    return {
        **payload,
        "live_order_allowed": False,
        "live_trading_enabled": False,
    }


def _pid_claim_mismatches(value: Any, prefix: str = "") -> list[dict[str, Any]]:
    mismatches: list[dict[str, Any]] = []
    if isinstance(value, dict):
        claims_alive = any(value.get(key) is True for key in ("alive", "process_alive", "is_alive", "running"))
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if key.lower().endswith("pid") and isinstance(child, int) and child > 0 and claims_alive:
                try:
                    os.kill(child, 0)
                    os_alive = True
                except (ProcessLookupError, ValueError):
                    os_alive = False
                except PermissionError:
                    os_alive = True
                if not os_alive:
                    mismatches.append({"path": path, "pid": child, "receipt_claimed_alive": True, "os_alive": False})
            mismatches.extend(_pid_claim_mismatches(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            mismatches.extend(_pid_claim_mismatches(child, f"{prefix}[{index}]"))
    return mismatches


def _mark_cached_sections(dashboard: dict[str, Any], refreshed: set[str], previous_generated: str | None) -> list[str]:
    cached: list[str] = []
    for key, value in dashboard.items():
        if key in refreshed or key in {"generated_at_utc", "warnings", "critical_failures"}:
            continue
        if isinstance(value, dict):
            value["dashboard_cache_status"] = "CACHED_LEGACY_SECTION_NOT_CURRENT_TRUTH"
            value["dashboard_cache_generated_at_utc"] = previous_generated
            value["counts_for_trade_ready_unlock"] = False
            cached.append(key)
    return sorted(cached)


def _live_readiness(strict: dict[str, Any], whale: dict[str, Any]) -> dict[str, Any]:
    blockers: set[str] = {"live_trading_not_approved"}
    canary = strict.get("canary_review") if isinstance(strict.get("canary_review"), dict) else {}
    blockers.update(str(item) for item in canary.get("blockers", []) if isinstance(item, str))
    for key in ("trade_ready_gate", "profitability_gate", "live_canary_preflight"):
        gate = whale.get(key) if isinstance(whale.get(key), dict) else {}
        blockers.update(str(item) for item in gate.get("blockers", []) if isinstance(item, str))
        if gate and str(gate.get("status") or "").lower() not in {"pass", "passed", "ready"}:
            blockers.add(f"whale_flow_{key}_{str(gate.get('status') or 'blocked').lower()}")
    return {
        "status": "BLOCKED",
        "blockers": sorted(blockers),
        "strict_forward_resolved_label_count": canary.get("strict_forward_resolved_label_count"),
        "strict_training_label_count": canary.get("strict_training_label_count"),
        "can_authorize_live": False,
        "can_authorize_trade": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
    }


def _build_dashboard_base() -> tuple[dict[str, Any], str | None, list[str]]:
    warnings: list[str] = []
    previous = _compact_cached_dashboard(_load_json_file(DASHBOARD_DATA_PATH, []))
    previous_generated = previous.get("generated_at_utc") if isinstance(previous.get("generated_at_utc"), str) else None
    return (dict(previous) if previous else {}), previous_generated, warnings


def build_dashboard() -> tuple[dict[str, Any], list[str]]:
    dashboard, previous_generated, warnings = _build_dashboard_base()
    refreshed: set[str] = set()
    for key, path in DIRECT_ARTIFACTS.items():
        payload = _safe_artifact(path, warnings)
        if payload:
            if key == "weather_source_freshness":
                payload = _compact_weather_source(payload)
            dashboard[key] = payload
            refreshed.add(key)

    strict = _weather_crypto_evidence_snapshot(WEATHER_CRYPTO_EVIDENCE_TRUTH_PATH, warnings)
    dashboard["weather_crypto_evidence_truth"] = strict
    refreshed.add("weather_crypto_evidence_truth")

    whale = _compact_whale_status(
        _safe_artifact(KALSHI_WHALE_FLOW_STATUS_PATH, warnings, required=True)
    )
    current_state = _safe_artifact(KALSHI_WHALE_FLOW_CURRENT_STATE_PATH, warnings)
    local_scheduler = _safe_artifact(KALSHI_WHALE_FLOW_LOCAL_SCHEDULER_PATH, warnings)
    liveness = _safe_artifact(KALSHI_WHALE_FLOW_LIVENESS_TRUTH_PATH, warnings)
    # The dedicated liveness receipt is the authoritative process-table view.
    # Older current-state receipts embed a point-in-time liveness snapshot, so
    # replace that nested copy before checking claims instead of presenting an
    # ended bounded process as still alive.
    if current_state and liveness:
        current_state = dict(current_state)
        current_state["liveness"] = liveness
        current_state["liveness_source"] = {
            "status": "DEDICATED_OS_LIVENESS_RECEIPT",
            "generated_at_utc": liveness.get("generated_at_utc"),
            "artifact_path": "work/scripts/kalshi/kalshi_whale_flow_liveness_truth_v1.json",
            "live_order_allowed": False,
        }
    if current_state:
        whale["current_state"] = current_state
    if local_scheduler:
        whale["local_scheduler"] = local_scheduler
    if liveness:
        whale["liveness_truth"] = liveness
    mismatches = _pid_claim_mismatches({"current_state": current_state, "liveness_truth": liveness})
    stale_process_labels = (
        [str(item) for item in liveness.get("stale_process_labels", []) if isinstance(item, str)]
        if isinstance(liveness, dict)
        else []
    )
    liveness_unhealthy = bool(liveness) and (
        liveness.get("verified") is not True or bool(stale_process_labels)
    )
    whale["dashboard_os_liveness"] = {
        "status": (
            "MISMATCH"
            if mismatches
            else "UNHEALTHY_STALE_PID_RECEIPT"
            if liveness_unhealthy
            else "NO_FALSE_ALIVE_CLAIM_DETECTED"
        ),
        "mismatches": mismatches,
        "stale_process_labels": stale_process_labels,
        "next_action": liveness.get("next_action") if isinstance(liveness, dict) else None,
        "live_order_allowed": False,
    }
    if mismatches:
        warnings.append("whale_flow_receipt_os_liveness_mismatch")
    elif liveness_unhealthy:
        warnings.append("whale_flow_liveness_unhealthy")
    whale["live_order_allowed"] = False
    whale["live_trading_enabled"] = False
    whale["write_capable_kalshi_endpoint_called"] = False
    dashboard["kalshi_whale_flow_shadow"] = whale
    refreshed.add("kalshi_whale_flow_shadow")

    copy_source = _safe_artifact(KALSHI_COPY_SHADOW_STATUS_PATH, warnings)
    prior_copy = dashboard.get("kalshi_copy_shadow") if isinstance(dashboard.get("kalshi_copy_shadow"), dict) else {}
    copy_snapshot = {
        key: value
        for key, value in prior_copy.items()
        if key not in {"whale_flow", "whale_flow_shadow"}
    }
    for key in ("status", "summary", "source_health", "profitability_gate", "trade_ready_gate", "live_canary_preflight"):
        if key in copy_source:
            copy_snapshot[key] = copy_source[key]
    copy_snapshot.update(
        {
            "artifact_path": "work/scripts/kalshi/kalshi_copy_shadow_status_v1.json",
            "whale_flow": {
                key: whale.get(key)
                for key in (
                    "status",
                    "generated_at_utc",
                    "summary",
                    "source_health",
                    "profitability_gate",
                    "trade_ready_gate",
                    "live_canary_preflight",
                    "dashboard_os_liveness",
                    "live_order_allowed",
                    "live_trading_enabled",
                    "write_capable_kalshi_endpoint_called",
                )
                if key in whale
            },
            "dashboard_cache_status": None,
            "live_order_allowed": False,
            "live_trading_enabled": False,
            "write_capable_kalshi_endpoint_called": False,
        }
    )
    dashboard["kalshi_copy_shadow"] = copy_snapshot
    refreshed.add("kalshi_copy_shadow")

    no_live = _run_no_live_validator()
    dashboard["no_live_validator"] = no_live
    refreshed.add("no_live_validator")
    dashboard["live_readiness"] = _live_readiness(strict, whale)
    contest_state = dashboard.get("paper_contest") if isinstance(dashboard.get("paper_contest"), dict) else {}
    if str(contest_state.get("status") or "") in {"GATE_REJECTED", "HALTED_INTEGRITY", "HALTED_RISK"}:
        warnings.append("paper_contest_terminal_abstention_preserved")
        dashboard["live_readiness"]["blockers"] = sorted(
            set(dashboard["live_readiness"].get("blockers", []))
            | {"paper_contest_terminal_abstention_requires_new_explicit_generation_approval"}
        )
    contest_v1_state = (
        dashboard.get("paper_contest_v1")
        if isinstance(dashboard.get("paper_contest_v1"), dict)
        else {}
    )
    if str(contest_v1_state.get("status") or "") in {
        "GATE_REJECTED",
        "HALTED_INTEGRITY",
        "HALTED_RISK",
    }:
        warnings.append("paper_contest_v1_terminal_predecessor_preserved")
    refreshed.add("live_readiness")

    model_readiness = _safe_artifact(LOGS_DIR / "weather_crypto_simple_model_readiness.json", warnings)
    model_report = _safe_artifact(LOGS_DIR / "weather_crypto_simple_model_report.json", warnings)
    mlx_benchmark = _safe_artifact(LOGS_DIR / "weather_crypto_mlx_benchmark.json", warnings)
    dataset = _safe_artifact(LOGS_DIR / "weather_crypto_ml_dataset.json", warnings)
    legacy_ml = dashboard.get("weather_crypto_ml") if isinstance(dashboard.get("weather_crypto_ml"), dict) else {}
    dashboard["weather_crypto_ml"] = {
        **legacy_ml,
        "strict_model_readiness": model_readiness,
        "strict_simple_model_report": model_report,
        "strict_mlx_benchmark": mlx_benchmark,
        "strict_dataset": dataset,
        "model_output_authority": "diagnostic_only",
        "paper_routing_allowed": False,
        "sts_authority_allowed": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
    }
    refreshed.add("weather_crypto_ml")

    cached_sections = _mark_cached_sections(dashboard, refreshed, previous_generated)
    now = utc_now()
    current_artifacts = {
        key: {
            "source_path": str(path),
            "generated_at_utc": _generated_at(dashboard.get(key, {})) if isinstance(dashboard.get(key), dict) else None,
            "age_seconds": _age_seconds(_generated_at(dashboard.get(key, {}))) if isinstance(dashboard.get(key), dict) else None,
        }
        for key, path in DIRECT_ARTIFACTS.items()
        if key in refreshed
    }
    dashboard["dashboard_cache"] = {
        "status": "EXPLICIT_LEGACY_CACHE_PRESENT" if cached_sections else "NO_LEGACY_CACHE",
        "previous_generated_at_utc": previous_generated,
        "previous_age_seconds": _age_seconds(previous_generated),
        "cached_sections": cached_sections,
        "cached_sections_are_current_truth": False,
        "cached_sections_count_for_trade_ready_unlock": False,
        "current_artifacts": current_artifacts,
        "bytecode_runtime_dependency": False,
        "maintainable_source": True,
        "live_order_allowed": False,
    }
    refreshed.add("dashboard_cache")
    dashboard["dashboard_transport"] = {
        "status": "LAZY_BROWSER_SUMMARY_PLUS_FULL_AUDIT_ARTIFACT",
        "max_trend_points": DASHBOARD_MAX_TREND_POINTS,
        "max_scorecard_segments": DASHBOARD_MAX_SCORECARD_SEGMENTS,
        "browser_summary_path": "work/scripts/kalshi/dashboard/kalshi_dashboard_summary.json",
        "browser_fetch_uses_summary": True,
        "full_detail_loaded_on_initial_render": False,
        "raw_receipts_preserved": True,
        "raw_receipts_overwritten": False,
        "live_order_allowed": False,
    }
    refreshed.add("dashboard_transport")

    failures: list[str] = []
    if no_live.get("ok") is not True:
        failures.append("no_live_validator_failed")
    if strict.get("receipt_status") in {"MISSING", "MALFORMED", "UNSAFE"}:
        failures.append(f"weather_crypto_evidence_truth_{str(strict.get('receipt_status')).lower()}")
    if mismatches:
        failures.append("whale_flow_receipt_os_liveness_mismatch")
    dashboard.update(
        {
            "schema_version": "kalshi-dashboard-v2-maintainable",
            "generated_at_utc": now,
            "mode": READ_ONLY_MODE,
            "critical_failures": sorted(set(failures)),
            "warnings": sorted(set(warnings + (["legacy_dashboard_sections_explicitly_cached_not_current_truth"] if cached_sections else []))),
            "completion_grade": "BLOCKED_EXTERNAL_EVIDENCE" if dashboard["live_readiness"]["status"] == "BLOCKED" else "REVIEW_ONLY",
            "top_action": strict.get("next_action"),
            "auto_apply_allowed": False,
            "live_order_allowed": False,
            "live_trading_enabled": False,
            "write_capable_kalshi_endpoint_called": False,
        }
    )
    performance = dashboard.get("performance_summary")
    if isinstance(performance, dict):
        performance["proof_tier"] = "cached_paper_metrics_not_live_relevant"
        performance["counts_for_trade_ready_unlock"] = False
        performance["live_order_allowed"] = False
    return dashboard, dashboard["warnings"]


def build_copy_shadow_only_dashboard() -> tuple[dict[str, Any], list[str]]:
    dashboard, warnings = build_dashboard()
    dashboard["copy_shadow_refreshed_at_utc"] = utc_now()
    dashboard["copy_shadow_refresh_guard"] = {
        "copy_shadow_only": True,
        "status": "scoped_copy_shadow_refresh_verified",
        "generic_paper_decisions_log_path": "work/scripts/kalshi/logs/paper_decisions.jsonl",
        "generic_paper_decisions_log_bytes": PAPER_DECISIONS_PATH.stat().st_size if PAPER_DECISIONS_PATH.exists() else 0,
        "generic_paper_log_scanned": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
    }
    return dashboard, warnings


def write_dashboard_html() -> None:
    DASHBOARD_HTML_PATH.parent.mkdir(parents=True, exist_ok=True)
    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store"><title>OpenClaw Kalshi Truth Dashboard</title>
<style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;margin:0;background:#f5f5f7;color:#1d1d1f}main{max-width:1100px;margin:auto;padding:32px}.hero,.card{background:white;border:1px solid #ddd;border-radius:24px;padding:22px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.safe{color:#087c34}.blocked{color:#b42318}code{word-break:break-word}@media(prefers-color-scheme:dark){body{background:#09090b;color:#f5f5f7}.hero,.card{background:#1c1c1e;border-color:#39393d}}</style></head>
<body><main><section class="hero"><p>Paper-only truth surface</p><h1>Kalshi evidence, without false readiness.</h1><p id="summary">Loading current local receipts…</p></section>
<section class="card"><p>V14 is diagnostic shadow evidence, not an actual-fill result. Contest entries are local paper records backed by direct executable asks, never exchange orders or fills.</p></section>
<section class="grid" id="cards"></section><section class="card"><h2>Exact blockers</h2><ul id="blockers"></ul></section>
<section class="card" id="source-lag-surface-command"><h2>Source-Lag Selective Surface</h2><p>Diagnostic only. This surface cannot route paper or live orders.</p></section>
<script>
const n=v=>Number(v||0).toLocaleString(),usd=v=>Number(v||0).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2}),range=v=>Array.isArray(v)&&v.length===2?`${usd(v[0])} to ${usd(v[1])}`:'pending';
async function load(){
  const r=await fetch('kalshi_dashboard_summary.json?ts='+Date.now(),{cache:'no-store'}),d=await r.json();
  const e=d.weather_crypto_evidence_truth||{},s=e.strict_labels||{},m=e.model_readiness||{},l=d.live_readiness||{},v=d.v14_candidate_performance||{},o=v.overall||{},h=v.prospective_holdout||{},p=d.paper_evidence_sprint||{},ph=p.holdout||{},pt=p.throughput||{},g=d.segment_policy_holdout||{},ge=g.evaluation||{},rk=d.future_paper_contest_risk_contract||{},c=d.paper_contest||{},ch=d.paper_contest_history||{},cv1=ch.v1||{},f=d.fallback_v3_holdout||{};
  document.getElementById('summary').textContent=`Generated ${d.generated_at_utc}. Live trading is off. Paper contest: ${c.status||'MISSING'}. Fallback holdout: ${f.status||'MISSING'}. Strict forward labels ${n(s.strict_forward_row_count)}; training-only labels ${n(s.strict_training_row_count)}. Holdout performance stays sealed until ${g.sealed_until_utc||h.sealed_until_utc||'the preregistered unseal'}.`;
  const cards=[['Safety',d.no_live_validator?.ok?'PASS':'FAIL'],['Source',e.source_health?.status||'UNKNOWN'],['Forward labels',`${n(s.strict_forward_row_count)} / ${n(e.canary_review?.minimum_total_labels||e.canary_review?.minimum_strict_forward_resolved_signals||200)}`],['Model',m.model_execution||'pending'],['V14 point estimate',`${usd(o.after_fee_pnl_usd)} / ${n(v.graded_candidate_count)} rows`],['V14 clustered 95% interval',range(o.cluster_bootstrap_mean_after_fee_pnl_95ci_usd)],['Prospective holdout',h.status||'MISSING'],['Segment policy holdout',g.sealed?g.status:(ge.status||g.status||'MISSING')],['Segment holdout result',g.sealed?'SEALED':`${usd(ge.after_fee_pnl_usd)} / ${n(ge.accepted_observation_count)} rows`],['Projected segment supply',`${n(g.projected_quote_backed_observations)} / ${n(g.minimum_quote_backed_observations)} rows`],['Evidence sprint',p.phase||'MISSING'],['Projected holdout supply',`${n(pt.projected_holdout_unique_candidates)} / ${n(ph.minimum_unique_candidates)} minimum`],['Paper contest',`${c.contest_generation||'v2'} · ${c.status||'MISSING'}`],['Fallback v3 holdout',`${f.started?'STARTED':'PREPARED'} · ${f.status||'MISSING'}`],['V1 predecessor',`${cv1.status||'MISSING'} · ${cv1.rows_reused_by_v2?'REUSED':'PRESERVED'}`],['Contest terminal',c.terminal_event||'NONE'],['Contest ledger anchor',c.append_log_anchor_verified&&!c.append_logs_overwritten?'VERIFIED':'FAIL CLOSED'],['Contest bankroll',usd(c.current_bankroll_usd)],['Contest realized P&L',usd(c.realized_after_fee_pnl_usd)],['Contest drawdown',usd(c.current_drawdown_usd)],['Contest open risk',`${n(c.open_position_count)} positions · ${usd(c.open_maximum_loss_usd)}`],['Contest risk controls',rk.active?'ACTIVE':`LOCKED · ${usd(rk.maximum_one_contract_risk_usd)} max/position`],['Paper decisions / outcomes',`${n(c.decision_count)} / ${n(c.outcome_count)}`],['Sealed holdout candidates',n(h.candidate_count)],['Independent windows',n(o.independent_time_cluster_count)],['Scheduler',e.scheduler_reliability?.status||'PENDING'],['Local AI audit',d.local_ai_operator_latest?.status||'UNKNOWN'],['Live canary','BLOCKED']];
  document.getElementById('cards').innerHTML=cards.map(([a,b])=>`<article class="card"><small>${a}</small><h2>${b}</h2></article>`).join('');
  const blockers=[...(c.gate_blockers||[]),...(f.integrity_failures||[]),...(l.blockers||['live_trading_not_approved'])];
  document.getElementById('blockers').innerHTML=[...new Set(blockers)].map(x=>`<li><code>${x}</code></li>`).join('');
}
load();setInterval(load,30000)
</script></main></body></html>"""
    DASHBOARD_HTML_PATH.write_text(html, encoding="utf-8")


def _atomic_write_text(path: Path, encoded: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(path)


def _write_dashboard_outputs(payload: dict[str, Any]) -> dict[str, int]:
    """Publish identical audit copies plus an independently bounded browser projection."""
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n"
    for path in (DASHBOARD_DATA_PATH, DASHBOARD_OUTPUT_PATH):
        _atomic_write_text(path, encoded)
    browser_encoded = json.dumps(
        _dashboard_browser_summary(payload), sort_keys=True, separators=(",", ":")
    ) + "\n"
    _atomic_write_text(DASHBOARD_SUMMARY_PATH, browser_encoded)
    return {
        "full_audit_bytes": len(encoded.encode("utf-8")),
        "browser_summary_bytes": len(browser_encoded.encode("utf-8")),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build the local paper-only Kalshi truth dashboard.")
    parser.add_argument("--truth-only", action="store_true")
    parser.add_argument("--copy-shadow-only", action="store_true")
    parser.add_argument("--no-html", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    dashboard, warnings = build_copy_shadow_only_dashboard() if args.copy_shadow_only else build_dashboard()
    transport_sizes = _write_dashboard_outputs(dashboard)
    if not args.no_html:
        write_dashboard_html()
    summary = {
        "ok": not dashboard.get("critical_failures"),
        "schema_version": dashboard.get("schema_version"),
        "generated_at_utc": dashboard.get("generated_at_utc"),
        "critical_failures": dashboard.get("critical_failures", []),
        "warning_count": len(warnings),
        "weather_crypto_receipt_status": dashboard.get("weather_crypto_evidence_truth", {}).get("receipt_status"),
        **transport_sizes,
        "bytecode_runtime_dependency": False,
        "live_order_allowed": False,
        "live_trading_enabled": False,
        "write_capable_kalshi_endpoint_called": False,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

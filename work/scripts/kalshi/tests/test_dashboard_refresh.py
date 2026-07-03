from __future__ import annotations

import importlib.util
import json
import time
from argparse import Namespace
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _weather_crypto_model_rows(count: int, *, candidate_good: bool, positive_pnl: bool = True) -> list[dict]:
    rows = []
    start = datetime(2026, 5, 1, 12, tzinfo=timezone.utc)
    for index in range(count):
        outcome = 1 if index % 2 == 0 else 0
        domain = "weather" if index % 4 in {0, 1} else "crypto"
        decision_time = start + timedelta(minutes=index)
        cutoff_time = decision_time - timedelta(minutes=1)
        good_probability = 0.96 if outcome else 0.04
        bad_probability = 1.0 - good_probability
        market_probability = bad_probability if candidate_good else good_probability
        candidate_probability = good_probability if candidate_good else bad_probability
        row_id = f"ml-row-{index}"
        rows.append(
            {
                "dataset_id": "fixture-dataset",
                "dataset_schema_version": "weather-crypto-ml-dataset-v1",
                "feature_schema_version": "weather-crypto-selective-v1",
                "label_schema_version": "weather-crypto-label-v1",
                "row_id": row_id,
                "decision_id": f"decision-{index}",
                "domain": domain,
                "segment_key": f"{domain}|fixture|yes",
                "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                "decision_timestamp_utc": decision_time.isoformat().replace("+00:00", "Z"),
                "market_ticker": f"FIXTURE-{index}",
                "selected_side": "YES",
                "market_probability": market_probability,
                "model_candidate_probability": candidate_probability,
                "paper_fill_price_cents": round(market_probability * 100),
                "outcome_label": outcome,
                "paper_pnl_usd": 0.1 if positive_pnl else -0.1,
                "features": {
                    "domain": domain,
                    "market_probability": market_probability,
                    "model_candidate_probability": candidate_probability,
                    "paper_fill_price_cents": round(market_probability * 100),
                    "horizon_minutes": 20,
                    "liquidity_score": 0.5,
                    "depth_contracts": 100,
                    "spread_cents": 2,
                    "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                },
                "label": {
                    "selected_side_won": outcome,
                    "paper_pnl_usd": 0.1 if positive_pnl else -0.1,
                    "settlement_source": "fixture",
                    "label_quality": "official_or_source_backed",
                },
                "feature_hash": f"feature-{index}",
                "label_hash": f"label-{index}",
                "source_hash": f"source-{index}",
                "row_hash": f"row-hash-{index}",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )
    return rows


def _weather_crypto_model_dataset(rows: list[dict], *, leakage_rejected_count: int = 0) -> dict:
    counts = {}
    for row in rows:
        domain = row["domain"]
        counts.setdefault(domain, {"rows": 0, "resolved": 0, "decisions": 0, "rejected": 0})
        counts[domain]["rows"] += 1
        counts[domain]["resolved"] += 1
        counts[domain]["decisions"] += 1
    return {
        "ok": True,
        "dataset_id": "fixture-dataset",
        "dataset_schema_version": "weather-crypto-ml-dataset-v1",
        "feature_schema_version": "weather-crypto-selective-v1",
        "label_schema_version": "weather-crypto-label-v1",
        "row_count": len(rows),
        "domain_counts": counts,
        "leakage_rejected_count": leakage_rejected_count,
        "missing_feature_cutoff_count": 0,
        "label_quality_counts": {"official_or_source_backed": len(rows)},
        "row_hash": "fixture-row-hash",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }


def _assert_no_live_true(value):
    if isinstance(value, dict):
        assert value.get("live_order_allowed") is not True
        assert value.get("auto_live_promotion_allowed") is not True
        assert value.get("accepted_for_live") is not True
        for nested in value.values():
            _assert_no_live_true(nested)
    elif isinstance(value, list):
        for nested in value:
            _assert_no_live_true(nested)


def test_dashboard_builds_from_logs_without_live_authority():
    dashboard = load_module("kalshi_dashboard", ROOT / "kalshi_dashboard.py")
    payload, warnings = dashboard.build_dashboard()
    sts_snapshot = payload.get("sts_policy_snapshot") or {}
    weather_policy = sts_snapshot.get("weather") or {}
    crypto_policy = sts_snapshot.get("crypto") or {}
    assert payload["live_order_allowed"] is False
    assert payload["auto_apply_allowed"] is False
    assert payload["all_time_baseline"]["paper"]["total_decisions"] >= 1
    assert payload["log_counts"]["paper_decisions"] >= payload["all_time_baseline"]["paper"]["total_decisions"]
    assert payload["paper"]["scope"] in {"current_epoch", "all_time"}
    assert payload["performance_summary"]["scored_accepted_trades"] >= 0
    assert payload["strategy_proof_diagnosis"]["live_order_allowed"] is False
    assert payload["plain_english_status"]["live_order_allowed"] is False
    assert "sts_policy_snapshot" in payload
    assert isinstance(weather_policy, dict)
    assert isinstance(crypto_policy, dict)
    assert "policy_intensity" in weather_policy
    assert "policy_intensity" in crypto_policy
    assert "policy_reasons" in weather_policy
    assert "policy_reasons" in crypto_policy
    assert weather_policy["policy_reasons"] is not None
    assert crypto_policy["policy_reasons"] is not None
    assert weather_policy.get("source_loaded") in {True, False}
    assert crypto_policy.get("source_loaded") in {True, False}
    assert payload["markov_microstructure"]["research_only"] is True
    assert payload["markov_microstructure"]["not_trade_signal"] is True
    assert payload["markov_microstructure"]["live_order_allowed"] is False
    assert "latest_fast_resolution_status" in payload["data_quality"]
    assert "latest_fast_resolution_status" in payload["accelerator"]["scheduler"]
    assert payload["plain_english_status"]["headline"]
    assert payload["plain_english_status"]["bullets"]
    assert payload["supreme_trading_strategy"]["live_order_allowed"] is False
    assert payload["supreme_trading_strategy"]["auto_live_promotion_allowed"] is False
    assert payload["supreme_trading_strategy"]["status"] in {"read_model_only", "learning", "validated_shadow_overlay", "degraded", "blocked"}
    assert "strategy_weights" in payload["supreme_trading_strategy"]
    assert "sts_trading_dashboard" in payload
    sts_trading = payload["sts_trading_dashboard"]
    assert sts_trading["live_order_allowed"] is False
    assert sts_trading["auto_live_promotion_allowed"] is False
    assert sts_trading["summary"]["acceptance_state"] in {"shadow_only_learning", "tiny_forward_paper_eligible", "tiny_forward_paper_active", "paper_review_ready", "blocked"}
    assert isinstance(sts_trading["summary"]["can_accept_sts_paper"], bool)
    assert sts_trading["directed_paper"]["resolved_trades"] >= 0
    if sts_trading["directed_paper"]["resolved_trades"] == 0:
        assert sts_trading["directed_paper"]["win_rate"] is None
        assert sts_trading["directed_paper"]["pnl_usd"] is None
        assert "No STS-directed paper trades" in sts_trading["directed_paper"]["plain_english"]
    assert "milestone_countdown" in payload
    assert "proof_promotion" in sts_trading
    assert sts_trading["proof_promotion"]["live_order_allowed"] is False
    assert sts_trading["proof_promotion"]["auto_live_promotion_allowed"] is False
    assert payload["sts_domain_learning_optimizer"]["ok"] in {True, False}
    assert "blocked_candidate_pressure" in payload["sts_domain_learning_optimizer"]
    assert "total_recent_blocked_candidates" in payload["sts_domain_learning_optimizer"]["blocked_candidate_pressure"]
    assert "sts_readiness_eta" in payload
    eta_payload = payload["sts_readiness_eta"]
    assert eta_payload["live_order_allowed"] is False
    assert eta_payload["auto_live_promotion_allowed"] is False
    assert "paper_trading_eta" in eta_payload
    assert "live_review_eta" in eta_payload
    assert "sts_readiness_roadmap" in payload
    roadmap = payload["sts_readiness_roadmap"]
    assert roadmap["live_order_allowed"] is False
    assert roadmap["auto_live_promotion_allowed"] is False
    paper_readiness = roadmap["paper_trading"]
    live_readiness = roadmap["live_trading"]
    assert 0 <= paper_readiness["readiness_score"] <= 100
    assert 0 <= live_readiness["readiness_score"] <= 100
    if paper_readiness["stage"] != "paper_validated":
        assert live_readiness["readiness_score"] <= paper_readiness["readiness_score"]
    assert live_readiness["can_trade_live"] is False
    assert live_readiness["manual_review_required"] is True
    assert paper_readiness["can_sts_direct_paper"] is False
    assert paper_readiness["stage"] in {"blocked", "data_ready", "shadow_learning", "baseline_challenger", "tiny_sts_paper", "bounded_sts_paper", "paper_validated"}
    assert live_readiness["stage"] in {"not_live_ready", "paper_validated", "risk_review_ready", "human_review_ready", "live_candidate_manual_only"}
    roadmap_gate_by_id = {gate["gate_id"]: gate for gate in roadmap["gates"]}
    assert roadmap_gate_by_id["market_baseline"]["status"] in {"passed", "blocked"}
    assert roadmap_gate_by_id["forward_paper_proof"]["status"] in {"passed", "blocked"}
    gate_by_id = {gate["gate_id"]: gate for gate in sts_trading["readiness_gates"]}
    assert gate_by_id["data_leakage"]["status"] in {"passed", "blocked"}
    assert gate_by_id["market_baseline"]["status"] in {"passed", "blocked"}
    scorecard = payload["strategy_scorecard"]
    active_paused_segments = sum(1 for segment in scorecard.get("segments", []) if segment.get("status") == "paused")
    assert scorecard["summary"]["paused_segments"] == active_paused_segments
    assert scorecard["summary"]["active_paused_segments"] == active_paused_segments
    assert scorecard["summary"]["standard_shadow_control_categories"] >= 0
    assert isinstance(warnings, list)


def test_dashboard_exposes_current_control_surface_source_gate():
    dashboard = load_module("kalshi_dashboard_control_surface", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    control = payload["kalshi_control_surface"]
    source_gate = control["sports_source_gate"]
    families = control["market_family_readiness"]

    assert control["status"] == "do_not_proceed"
    assert control["active_track"] == "sports"
    assert control["current_blocker"] == "sports_source_gate_missing_exact_approved_repo_root_jsonl"
    assert control["source_gate_status"] == "blocked_missing_approved_sports_source"
    assert "Approve exactly one repo-root local sports JSONL source path" in control["exact_next_human_action_required"]
    assert control["goal_mode"]["appropriate"] is False
    assert source_gate["status"] == "blocked_missing_approved_source"
    assert source_gate["required_approved_source_count"] == 1
    assert source_gate["approved_source_count"] == 0
    assert source_gate["expected_path"] == "work/scripts/kalshi/approved_sports_local_source_collection_rows_v1.jsonl"
    assert source_gate["do_not_proceed"] is True
    assert control["dependent_actions"][0]["status"] == "dependency_blocked"
    assert set(families) == {"crypto", "sports", "weather", "economics", "politics", "other"}
    assert families["sports"]["rows"] >= 0
    assert control["sts_readiness_status"]["sts_logic_changed"] is False
    assert control["dashboard_refresh_guard"]["sentinel_behavior_changed"] is False
    assert control["dashboard_refresh_guard"]["dashboard_refresh_run_by_this_prompt"] is False
    _assert_no_live_true(control)


def test_dashboard_html_exposes_control_surface_section(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_control_surface_html", ROOT / "kalshi_dashboard.py")
    html_path = tmp_path / "kalshi_dashboard.html"
    monkeypatch.setattr(dashboard, "DASHBOARD_HTML_PATH", html_path)
    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    html = html_path.read_text(encoding="utf-8")

    assert "Kalshi Control Surface" in html
    assert "Do Not Proceed Gate" in html
    assert 'id="kalshi-control-cards"' in html
    assert 'id="kalshi-family-readiness-table"' in html
    assert "Sports Source Gate" in html
    assert "One exact repo-root local sports JSONL source path must be approved first." in html
    assert payload["kalshi_control_surface"]["sports_source_gate"]["do_not_proceed"] is True
    _assert_no_live_true(payload["kalshi_control_surface"])


def test_dashboard_timesfm_fallback_is_diagnostic_only(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_timesfm_fallback", ROOT / "kalshi_dashboard.py")
    monkeypatch.setattr(dashboard, "TIMESFM_DIAGNOSTIC_PATH", tmp_path / "missing_timesfm_diagnostic.json")

    payload, _warnings = dashboard.build_dashboard()
    timesfm = payload["timesfm_diagnostic"]
    weather_crypto = payload["weather_crypto_ml"]
    sts_policy = payload["sts_trading_dashboard"]["timesfm_policy"]

    assert timesfm["status"] == "not_generated"
    assert timesfm["artifact_exists"] is False
    assert timesfm["model_family"] == "timesfm"
    assert timesfm["model_version"] == "timesfm-2.5"
    assert weather_crypto["timesfm_diagnostic"] == timesfm
    assert sts_policy["status"] == "diagnostic_only_not_sts_authority"
    assert sts_policy["timesfm_status"] == "not_generated"
    assert timesfm["diagnostic_only"] is True
    assert timesfm["production_model"] is False
    assert timesfm["not_trade_signal"] is True
    assert timesfm["counts_for_validation_credit"] is False
    assert timesfm["sts_authority"] is False
    assert timesfm["can_authorize_paper"] is False
    assert timesfm["can_authorize_live"] is False
    assert timesfm["live_order_allowed"] is False
    assert timesfm["auto_live_promotion_allowed"] is False
    assert sts_policy["live_order_allowed"] is False
    assert sts_policy["auto_live_promotion_allowed"] is False
    _assert_no_live_true(timesfm)
    _assert_no_live_true(sts_policy)


def test_dashboard_timesfm_artifact_renders_without_sts_authority(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_timesfm_artifact", ROOT / "kalshi_dashboard.py")
    diagnostic_path = tmp_path / "timesfm_diagnostic.json"
    html_path = tmp_path / "kalshi_dashboard.html"
    diagnostic_path.write_text(
        json.dumps(
            {
                "ok": True,
                "status": "diagnostic_ready",
                "model_family": "timesfm",
                "model_version": "timesfm-2.5",
                "generated_at_utc": "2026-06-17T12:00:00Z",
                "domains": ["crypto"],
                "assets": ["BTC", "ETH", "DOGE", "SOL"],
                "horizons_minutes": [15, 60],
                "forecast_config": {
                    "quantiles_enabled": True,
                    "xreg_enabled": False,
                    "walk_forward_only": True,
                },
                "metrics": {
                    "brier": 0.18,
                    "ece": 0.04,
                    "accuracy": 0.62,
                    "coverage": 0.71,
                    "market_baseline_brier": 0.2,
                    "no_ml_baseline_brier": 0.25,
                },
                "baselines": [{"name": "market_implied_baseline"}, {"name": "no_ml_baseline"}],
                "segment_failures": [
                    {
                        "segment": "crypto|DOGE|thin_depth",
                        "metric": "brier",
                        "value": 0.31,
                        "next_action": "Keep diagnostic-only.",
                    }
                ],
                "leakage_checks": {
                    "random_split_used": False,
                    "future_labels_used": False,
                    "moving_sources_used": False,
                },
                "next_action": "Compare against market-implied baseline only after source-backed gates.",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(dashboard, "TIMESFM_DIAGNOSTIC_PATH", diagnostic_path)
    monkeypatch.setattr(dashboard, "DASHBOARD_HTML_PATH", html_path)

    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    html = html_path.read_text(encoding="utf-8")
    timesfm = payload["timesfm_diagnostic"]
    sts_policy = payload["sts_trading_dashboard"]["timesfm_policy"]

    assert timesfm["status"] == "diagnostic_ready"
    assert timesfm["artifact_exists"] is True
    assert timesfm["metrics"]["brier"] == 0.18
    assert timesfm["metrics"]["market_baseline_brier"] == 0.2
    assert timesfm["forecast_config"]["quantiles_enabled"] is True
    assert timesfm["assets"] == ["BTC", "ETH", "DOGE", "SOL"]
    assert timesfm["segment_failures"][0]["segment"] == "crypto|DOGE|thin_depth"
    assert timesfm["counts_for_validation_credit"] is False
    assert timesfm["sts_authority"] is False
    assert timesfm["can_authorize_paper"] is False
    assert timesfm["can_authorize_live"] is False
    assert timesfm["live_order_allowed"] is False
    assert timesfm["auto_live_promotion_allowed"] is False
    assert sts_policy["status"] == "diagnostic_only_not_sts_authority"
    assert sts_policy["timesfm_status"] == "diagnostic_ready"
    assert sts_policy["live_order_allowed"] is False
    assert sts_policy["auto_live_promotion_allowed"] is False
    assert "TimesFM Diagnostic Forecasting" in html
    assert 'id="timesfm-diagnostic"' in html
    assert "renderTimesfmDiagnostic" in html
    assert "diagnostic_only_not_sts_authority" in html
    _assert_no_live_true(timesfm)
    _assert_no_live_true(sts_policy)


def test_dashboard_crypto_persistence_lab_fallback_is_diagnostic_only(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_crypto_persistence_fallback", ROOT / "kalshi_dashboard.py")
    monkeypatch.setattr(dashboard, "CRYPTO_PERSISTENCE_JOURNAL_REVIEW_PATH", tmp_path / "missing_crypto_persistence_journal_review.json")

    lab = dashboard._crypto_persistence_lab_snapshot({}, {})

    assert lab["status"] == "not_generated"
    assert lab["artifact_exists"] is False
    assert lab["rows"] == []
    assert lab["journal_review"]["status"] == "not_generated"
    assert lab["diagnostic_only"] is True
    assert lab["research_only"] is True
    assert lab["not_trade_signal"] is True
    assert lab["counts_for_validation_credit"] is False
    assert lab["sts_authority"] is False
    assert lab["can_authorize_trade"] is False
    assert lab["can_authorize_paper"] is False
    assert lab["can_authorize_live"] is False
    assert lab["live_order_allowed"] is False
    assert lab["auto_live_promotion_allowed"] is False
    _assert_no_live_true(lab)


def test_dashboard_crypto_persistence_lab_renders_article_fields_without_authority(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_crypto_persistence_artifact", ROOT / "kalshi_dashboard.py")
    html_path = tmp_path / "kalshi_dashboard.html"
    journal_path = tmp_path / "crypto_persistence_journal_review.json"
    journal = {
        "status": "review_ready",
        "generated_at_utc": "2026-06-22T18:00:00Z",
        "recommended_action": "keep_review_only",
        "plain_english": "Review-only fixture.",
        "threshold_proposals": [
            {
                "parameter": "article_persistence_threshold_candidate",
                "proposed_value": 0.87,
                "status": "hold_constant_for_diagnostic_comparison_only",
                "boundary": "recommendation_only_no_mutation",
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }
    journal_path.write_text(json.dumps(journal), encoding="utf-8")
    monkeypatch.setattr(dashboard, "DASHBOARD_HTML_PATH", html_path)
    monkeypatch.setattr(dashboard, "CRYPTO_PERSISTENCE_JOURNAL_REVIEW_PATH", journal_path)

    lab = dashboard._crypto_persistence_lab_snapshot(
        {
            "ok": True,
            "generated_at_utc": "2026-06-22T17:00:00Z",
            "markets": [
                {
                    "market_ticker": "KXBTC15M-FIXTURE",
                    "event_ticker": "KXBTC15M",
                    "title": "Bitcoin up fixture",
                    "category": "crypto",
                    "persistence_probability": 0.91,
                    "market_implied_probability": 0.82,
                    "raw_edge_pct": 9.0,
                    "edge_after_costs_pct": 5.2,
                    "min_edge_required_pct": 5.0,
                    "threshold_calibration_status": "above_article_threshold_diagnostic_only",
                    "confidence_score": 8.0,
                    "sample": {"current_row_transitions": 40},
                    "execution": {"estimated_yes_spread_cents": 2, "depth_contracts": 500},
                    "kelly_diagnostic_only": {
                        "position_sizing_authority": False,
                        "live_order_allowed": False,
                    },
                    "warnings": [],
                    "routing_label": "TINY_PAPER_REVIEW_ONLY",
                    "live_order_allowed": False,
                }
            ],
            "live_order_allowed": False,
        },
        journal,
    )
    dashboard.write_dashboard_html()
    html = html_path.read_text(encoding="utf-8")

    assert lab["status"] == "diagnostic_ready"
    assert lab["summary"]["crypto_market_count"] == 1
    assert lab["summary"]["watchlist_count"] == 1
    assert lab["rows"][0]["asset"] == "BTC"
    assert lab["rows"][0]["persistence_probability"] == 0.91
    assert lab["rows"][0]["market_implied_probability"] == 0.82
    assert lab["rows"][0]["edge_after_costs_pct"] == 5.2
    assert lab["rows"][0]["blocker"] == "research_only_not_sts_authority"
    assert lab["journal_review"]["status"] == "review_ready"
    assert lab["sts_policy"]["status"] == "diagnostic_only_not_sts_authority"
    assert lab["can_authorize_trade"] is False
    assert lab["live_order_allowed"] is False
    assert "Crypto Persistence Lab" in html
    assert 'id="crypto-persistence-lab"' in html
    assert "renderCryptoPersistenceLab" in html
    _assert_no_live_true(lab)


def test_sts_trading_dashboard_exposes_walk_forward_stability_controls():
    dashboard = load_module("kalshi_dashboard_walk_forward_controls", ROOT / "kalshi_dashboard.py")
    snapshot = dashboard._sts_trading_dashboard_snapshot(
        supreme_trading_strategy={
            "ok": True,
            "status": "learning",
            "risk": {
                "primary_blocker": "forward_paper_proof_blocked",
                "blockers": ["forward_paper_proof_blocked"],
            },
            "learning": {
                "domain_learning_acceleration": {
                    "weather_crypto_walk_forward_stability_multiplier": 0.77,
                    "weather_crypto_walk_forward_stability_reason": "Recent out-of-sample stability improved on weather/crypto.",
                    "weather_crypto_reallocation_guard": 0.87,
                    "weather_crypto_sports_profile_trend": "decayed",
                    "weather_crypto_sports_profile_confidence": 0.42,
                    "weather_crypto_sports_profile_late_edge": 0.12,
                    "weather_crypto_sports_profile_windows": 5,
                    "weather_crypto_sports_row_multiplier": 0.0,
                    "weather_crypto_sports_block_reason": "Sports blocked by STS acceleration gate for testing.",
                    "weather_crypto_recent_sports_edge": 0.12,
                    "weather_crypto_walk_forward_stability_weather_signal": 0.12,
                    "weather_crypto_walk_forward_stability_crypto_signal": -0.06,
                    "weather_crypto_walk_forward_stability_weather_trend": "improving",
                    "weather_crypto_walk_forward_stability_crypto_trend": "decayed",
                    "weather_crypto_walk_forward_stability_weather_multiplier": 1.06,
                    "weather_crypto_walk_forward_stability_crypto_multiplier": 0.96,
                    "weather_crypto_walk_forward_stability_domain_score": 0.036,
                    "weather_crypto_domain_calibration_multiplier_weather": 1.03,
                    "weather_crypto_domain_calibration_multiplier_crypto": 0.99,
                    "weather_crypto_learning_pressure_multiplier_weather": 1.03,
                    "weather_crypto_learning_pressure_multiplier_crypto": 0.95,
                    "weather_crypto_learning_pressure_signal_weather": 0.12,
                    "weather_crypto_learning_pressure_signal_crypto": 0.08,
                    "weather_crypto_learning_pressure_reason_weather": "Weather evidence strong; no penalty.",
                    "weather_crypto_learning_pressure_reason_crypto": "Crypto evidence moderate.",
                    "weather_crypto_domain_calibration_reason_weather": "weather candidate calibration error low",
                    "weather_crypto_domain_calibration_reason_crypto": "crypto candidate calibration error high",
                }
            },
            "performance": {"market_baseline_retained": True, "champion_status": "market_champion_retained"},
            "objective_scores": {"profitability": 0.0},
            "strategy_weights": [],
            "data_health": {
                "feature_rows_summary": {"written_row_count": 512},
                "domain_diagnostics": [
                    {
                        "domain": "weather",
                        "labeled_rows": 260,
                        "win_rate": 0.52,
                        "paper_pnl_usd": -1.2,
                        "candidate_brier": 0.38,
                        "market_brier": 0.35,
                    }
                ],
            },
        },
        decisions=[],
        outcomes=[],
        now_text="2026-05-29T00:00:00Z",
    )
    assert snapshot["learning_controls"]["weather_crypto_walk_forward_stability_multiplier"] == 0.77
    assert (
        "walk-forward stability"
        in str(snapshot["learning_controls"]["weather_crypto_walk_forward_stability_reason"]).lower()
    )
    assert snapshot["learning_controls"]["weather_crypto_walk_forward_stability_weather_multiplier"] == 1.06
    assert snapshot["learning_controls"]["weather_crypto_walk_forward_stability_crypto_multiplier"] == 0.96
    assert snapshot["learning_controls"]["weather_crypto_domain_calibration_multiplier_weather"] == 1.03
    assert snapshot["learning_controls"]["weather_crypto_learning_pressure_multiplier_weather"] == 1.03
    assert snapshot["learning_controls"]["weather_crypto_learning_pressure_multiplier_crypto"] == 0.95
    assert snapshot["learning_controls"]["weather_crypto_learning_pressure_signal_weather"] == 0.12
    assert snapshot["learning_controls"]["weather_crypto_learning_pressure_signal_crypto"] == 0.08
    assert snapshot["learning_controls"]["weather_crypto_learning_pressure_reason_weather"] == "Weather evidence strong; no penalty."
    assert snapshot["learning_controls"]["weather_crypto_reallocation_guard"] == 0.87
    assert snapshot["learning_controls"]["weather_crypto_sports_row_multiplier"] == 0.0
    assert snapshot["learning_controls"]["weather_crypto_sports_block_reason"] == "Sports blocked by STS acceleration gate for testing."
    assert snapshot["learning_controls"]["weather_crypto_sports_profile_trend"] == "decayed"
    assert snapshot["learning_controls"]["weather_crypto_sports_profile_confidence"] == 0.42


def test_sts_trading_dashboard_exposes_stochastic_process_overlay():
    dashboard = load_module(
        "kalshi_dashboard_stochastic_process",
        ROOT / "kalshi_dashboard.py",
    )
    snapshot = dashboard._sts_trading_dashboard_snapshot(
        supreme_trading_strategy={
            "ok": True,
            "status": "learning",
            "risk": {
                "primary_blocker": "forward_paper_proof_blocked",
                "blockers": ["forward_paper_proof_blocked"],
                "governor_final_authority": True,
            },
            "learning": {
                "domain_learning_acceleration": {
                    "weather_crypto_stochastic_process_multiplier": 1.06,
                    "weather_crypto_stochastic_process_reason": "Markov coverage and confidence are improving.",
                    "weather_crypto_stochastic_process_signal": 0.67,
                    "weather_crypto_stochastic_process_quality": 0.83,
                    "weather_crypto_stochastic_process_pressure": 0.11,
                    "weather_crypto_stochastic_process_confidence": 0.74,
                    "weather_crypto_stochastic_process_coverage": 0.88,
                    "weather_crypto_walk_forward_stability_multiplier": 1.01,
                    "weather_crypto_walk_forward_stability_reason": "Stable across latest windows.",
                }
            },
            "performance": {"market_baseline_retained": True, "champion_status": "market_champion_retained"},
            "objective_scores": {"profitability": 0.0},
            "strategy_weights": [],
            "data_health": {
                "feature_rows_summary": {"written_row_count": 512},
                "domain_diagnostics": [],
            },
        },
        decisions=[],
        outcomes=[],
        markov_feature_coverage={
            "resolved_safe_markov_rows": 12,
            "pending_safe_markov_rows": 3,
            "unresolved_safe_markov_rows": 1,
            "coverage_status": "ready_for_uplift_validation",
        },
        now_text="2026-05-29T00:00:00Z",
    )

    controls = snapshot["learning_controls"]
    assert controls["markov_safe_rows_resolved"] == 12
    assert controls["markov_safe_rows_pending"] == 3
    assert controls["markov_safe_rows_unresolved"] == 1
    assert controls["markov_safe_rows_coverage_status"] == "ready_for_uplift_validation"
    assert controls["stochastic_process_multiplier"] == 1.06
    assert controls["stochastic_process_reason"] == "Markov coverage and confidence are improving."
    assert controls["stochastic_process_signal"] == 0.67
    assert controls["stochastic_process_quality"] == 0.83
    assert controls["stochastic_process_pressure"] == 0.11
    assert controls["stochastic_process_confidence"] == 0.74
    assert controls["stochastic_process_coverage"] == 0.88
    assert controls["stochastic_pressure_safety_factor"] == 1.0


def test_sts_domain_learning_optimizer_snapshot_includes_blocked_pressure_totals():
    dashboard = load_module("kalshi_dashboard_blocked_pressure_summary", ROOT / "kalshi_dashboard.py")
    source = {
        "ok": True,
        "domain_lanes": [
            {
                "domain": "weather",
                "blocked_candidate_count": 4,
                "blocked_candidate_count_12h": 3,
                "blocked_candidate_count_24h": 4,
                "recent_blocked_pressure": 4.25,
                "status": "blocked",
                "learning_priority_score": 410.0,
                "next_action": "weather repair",
                "domain_score": "high",
            },
            {
                "domain": "sports",
                "blocked_candidate_count": 1,
                "blocked_candidate_count_12h": 0,
                "blocked_candidate_count_24h": 1,
                "recent_blocked_pressure": 0.75,
                "status": "blocked",
                "learning_priority_score": 150.0,
                "next_action": "sports blocked",
                "domain_score": "low",
            },
            {
                "domain": "crypto",
                "blocked_candidate_count": 2,
                "blocked_candidate_count_12h": 2,
                "blocked_candidate_count_24h": 2,
                "recent_blocked_pressure": 2.6,
                "status": "needs_candidates",
                "learning_priority_score": 390.0,
            },
        ],
        "best_domain_to_improve_next": {"domain": "weather", "learning_priority_score": 410.0},
        "domain_separation_policy": {
            "future_market_categories_separated": True,
        },
        "plain_english": "Domain-first optimizer is available.",
        "next_action": "Prioritize weather evidence repair.",
    }

    snapshot = dashboard._sts_domain_learning_optimizer_snapshot(source)
    blocked_pressure = snapshot["blocked_candidate_pressure"]

    assert blocked_pressure["total_recent_blocked_candidates"] == 7
    assert blocked_pressure["recent_12h"] == 5
    assert blocked_pressure["recent_24h"] == 7
    assert blocked_pressure["domains_without_candidates"] == 1
    assert blocked_pressure["weather_crypto_blocked_pressure"] == 4.25
    assert snapshot["learning_controls"]["weather_crypto_domain_calibration_multiplier_crypto"] == 0.99
    assert snapshot["learning_controls"]["weather_crypto_domain_calibration_reason_weather"] == "weather candidate calibration error low"
    assert snapshot["learning_controls"]["weather_crypto_domain_calibration_reason_crypto"] == "crypto candidate calibration error high"
    assert snapshot["learning_controls"]["weather_crypto_walk_forward_stability_trend"] in {"improving", "stable", "decayed", "neutral"}
    assert snapshot["learning_controls"]["weather_crypto_walk_forward_stability_confidence"] >= 0.0
    assert "weather_crypto_walk_forward_stability_windows" in snapshot["learning_controls"]
    assert snapshot["summary"]["acceptance_state"] == "shadow_only_learning"
    assert snapshot["learning_controls"]["live_order_allowed"] is False
    assert snapshot["learning_controls"]["auto_live_promotion_allowed"] is False
    assert snapshot["directed_paper"]["resolved_trades"] == 0
    _assert_no_live_true(snapshot)


def test_paper_trade_accelerator_exposes_learning_control_multipliers():
    dashboard = load_module("kalshi_dashboard_paper_trade_accelerator", ROOT / "kalshi_dashboard.py")
    payload = dashboard._paper_trade_accelerator(
        [
            {"strategy_taxonomy": {"domain": "weather"}, "market_ticker": "T1", "decision_id": "d1", "simulated_size_usd": 1.0},
            {"strategy_taxonomy": {"domain": "crypto"}, "market_ticker": "T2", "decision_id": "d2", "simulated_size_usd": 1.0},
        ],
        weather_crypto_ml_dataset={"row_count": 1200},
        learning_velocity={"resolved_last_1h": 30},
        crypto_readiness={},
        weather_source_freshness={"ok": False},
        strategy_weighting={"weight_type": "paper_learning_attention_not_live_risk"},
        sts_learning_controls={
            "learning_velocity_multiplier": 1.25,
            "weather_crypto_learning_pressure_multiplier_weather": 1.11,
            "weather_crypto_learning_pressure_multiplier_crypto": 0.96,
            "stochastic_process_pressure": 0.18,
            "execution_reliability_score": 0.81,
            "weather_crypto_reallocation_guard": 0.73,
            "stochastic_pressure_safety_factor": 0.92,
        },
    )
    assert payload["learning_speed_boost"] == 1.25
    assert payload["learning_pressure_weather"] == 1.11
    assert payload["learning_pressure_crypto"] == 0.96
    assert payload["execution_reliability_score"] == 0.81
    assert payload["stochastic_process_pressure"] == 0.18
    assert payload["sports_reallocation_guard"] == 0.73
    assert payload["stochastic_pressure_safety_factor"] == 0.92
    _assert_no_live_true(payload)

def test_sts_trading_dashboard_write_html_contains_walk_forward_stability_card():
    dashboard = load_module("kalshi_dashboard_walk_forward_html", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    assert payload["sts_trading_dashboard"]["learning_controls"]["weather_crypto_walk_forward_stability_multiplier"] is not None
    html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    assert "Walk-forward Stability" in html
    assert "WF Trend" in html
    assert "WF Domain Multipliers" in html
    assert "WF Domain Calibration" in html
    assert "Learning Pressure" in html
    assert "Stochastic Safety Factor" in html
    assert "Learning Speed Boost" in html
    assert "Stochastic Process Pressure" in html
    assert "Sports Reallocation Guard" in html
    assert "WF Confidence" in html
    assert "Sports Learning Multiplier" in html
    assert "Markov Safe Rows" in html
    assert "Stochastic Process Safe Rows" in html
    assert "Stochastic Process Quality" in html
    assert "Stochastic Process Pressure" in html
    assert "Execution Reliability" in html
    assert "Sports Guard" in html
    assert "Sports Recent Edge" in html
    assert "sts-trading-cards" in html
    assert "sts-rationales" in html
    _assert_no_live_true(payload["sts_trading_dashboard"])


def test_dashboard_html_contains_sts_policy_snapshot_cards():
    dashboard = load_module("kalshi_dashboard_sts_policy_html", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    assert "STS Policy" in html
    assert 'id="sts-policy-snapshot"' in html
    assert "Weather Candidate Policy" in html
    assert "Crypto Policy" in html
    assert "Weather Policy Gates" in html
    assert "sts-domain-learning-optimizer" in html
    assert "Domain Learning Optimizer" in html
    assert "Best Focus Domain" in html
    assert payload["sts_policy_snapshot"]["weather"]["source_loaded"] in {True, False}
    assert payload["sts_policy_snapshot"]["crypto"]["source_loaded"] in {True, False}
    assert isinstance(payload["sts_policy_snapshot"]["weather"].get("policy_reasons"), list)
    assert isinstance(payload["sts_policy_snapshot"]["crypto"].get("policy_reasons"), list)
    _assert_no_live_true(payload)


def test_dashboard_primary_metrics_use_active_scope():
    dashboard = load_module("kalshi_dashboard_active_metrics", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    paper = payload["paper"]
    metrics = payload["self_improvement"]["metrics"]
    volume = payload["paper_volume_accelerator"]["metrics"]
    scorecard = payload["strategy_scorecard"]
    assert payload["self_improvement"]["metrics_scope"] == paper["scope"]
    assert payload["paper_volume_accelerator"]["metrics_scope"] == paper["scope"]
    assert payload["paper_volume_accelerator"]["timestamp_utc"] == payload["generated_at_utc"]
    assert payload["paper_volume_accelerator"]["refreshed_from_dashboard_utc"] == payload["generated_at_utc"]
    assert metrics["total_decisions"] == paper["total_decisions"]
    assert metrics["accepted_paper_decisions"] == paper["accepted"]
    assert metrics["scored_decisions"] == payload["performance_summary"]["scored_accepted_trades"]
    assert metrics["paper_performance_by_timeframe"]["all"]["scored_decisions"] == payload["performance_summary"]["scored_accepted_trades"]
    assert volume["total_decisions"] == paper["total_decisions"]
    assert volume["accepted_decisions"] == paper["accepted"]
    assert volume["resolved_outcomes"] == payload["performance_summary"]["scored_accepted_trades"]
    assert scorecard["summary"]["total_decisions"] == paper["total_decisions"]
    assert len(scorecard["trend"]["points"]) == len(payload["performance_summary"]["trend_points"])
    assert payload["data_quality"]["latest_scored_age_minutes"] == payload["performance_summary"]["latest_scored_age_minutes"]


def test_dashboard_learning_velocity_uses_shadow_outcomes_without_promoting_proof():
    dashboard = load_module("kalshi_dashboard_learning_velocity", ROOT / "kalshi_dashboard.py")
    now = datetime(2026, 5, 21, 21, 30, tzinfo=timezone.utc)
    payload = dashboard._learning_velocity_snapshot(
        [
            {
                "decision_id": "accepted-old",
                "resolved": True,
                "settlement_checked_at_utc": "2026-05-19T19:00:00Z",
                "market_category": "weather",
            }
        ],
        [
            {
                "decision_id": f"shadow-{index}",
                "resolved": True,
                "settlement_checked_at_utc": "2026-05-21T21:20:00Z",
                "market_category": "crypto",
                "proof_metrics_exclude_shadow": True,
            }
            for index in range(5)
        ],
        latest_fast_resolution={
            "timestamp_utc": "2026-05-21T21:21:00Z",
            "checked_count": 5,
            "shadow_resolved_count": 5,
            "resolved_count": 0,
        },
        outcome_resolution={},
        now=now,
    )
    assert payload["status"] == "HIGH_SPEED_LEARNING"
    assert payload["resolved_last_1h"] == 5
    assert payload["shadow_resolved_last_1h"] == 5
    assert payload["latest_learning_age_minutes"] == 10.0
    assert payload["latest_accepted_proof_age_minutes"] > 60
    assert payload["proof_metrics_exclude_shadow"] is True
    assert payload["live_order_allowed"] is False


def test_milestone_countdown_waits_when_accepted_rate_is_unknown():
    dashboard = load_module("kalshi_dashboard_milestone_countdown", ROOT / "kalshi_dashboard.py")

    payload = dashboard._milestone_countdown_snapshot(
        gap01_forward_proof={
            "target_scored_positive_baseline_beating_outcomes": 100,
            "status": "OPEN",
            "completion_grade": 3.4,
            "leading_lane": {
                "scored": 34,
                "paper_pnl_usd": 1.25,
                "accuracy": 0.62,
            },
        },
        active_perf={"scored_accepted_trades": 34, "paper_pnl_usd": 1.25, "accuracy": 0.62},
        learning_velocity={
            "resolved_last_1h": 12,
            "shadow_resolved_last_1h": 12,
            "latest_fast_resolution_age_minutes": 2,
            "latest_fast_resolution_accepted_resolved_count": 0,
            "category_resolved_last_1h": {"weather": 8, "crypto": 4},
        },
        weather_crypto_ml={
            "domains": {
                "weather": {"shadow_scored": 44, "accepted_scored": 0},
                "crypto": {"shadow_scored": 112, "accepted_scored": 0},
            }
        },
        crypto_evidence={"seconds_until_next_crypto_trade_ready_check": 900},
        source_lag_surface_strategy={
            "nws_cli": {"freshness": {"status": "FRESH", "parsed_product_count": 3}},
            "weather": {
                "ranked_surface_targets": [
                    {
                        "baseline_deltas": {
                            "beats_market_baseline": True,
                            "beats_random_baseline": True,
                            "beats_no_trade_baseline": True,
                        }
                    }
                    for _ in range(3)
                ]
            },
            "crypto": {
                "basis_readiness": {"status": "SHADOW_ONLY", "accepted_paper_allowed": False},
                "ranked_crypto_hypotheses": [],
            },
        },
        weather_source_freshness={"ok": True},
        now_text="2026-05-25T23:55:00Z",
    )

    assert payload["live_order_allowed"] is False
    assert payload["auto_live_promotion_allowed"] is False
    assert payload["plain_english"].startswith("Conservative milestone ETAs")
    assert payload["countdown_health"]["status"] == "blocked"
    assert payload["countdown_health"]["learning_momentum"]["shadow_resolved_last_1h"] == 12
    assert payload["countdown_health"]["learning_momentum"]["proof_metrics_exclude_shadow"] is True
    assert payload["countdown_health"]["accepted_forward_rate_windows"]["accepted_forward_sample_size"] == 0
    proof = next(row for row in payload["milestones"] if row["milestone_id"] == "proof")
    crypto = next(row for row in payload["milestones"] if row["milestone_id"] == "crypto")
    assert proof["eta_label"] == "Waiting"
    assert proof["status"] == "blocked"
    proof_count = next(row for row in proof["criteria"] if row["label"] == "Count")
    assert proof_count["reason_code"] == "no_accepted_forward_rate"
    assert proof_count["eligible_for_eta"] is False
    assert crypto["eta_label"] == "Waiting"
    assert crypto["criteria"][0]["label"] == "Basis"
    assert crypto["criteria"][0]["score"] == 0.0
    assert dashboard._countdown_eta_label(90060) == "1d 1h 1m"
    for milestone in payload["milestones"]:
        assert 0 <= milestone["completion_score"] <= 10
        for criterion in milestone["criteria"]:
            assert len(criterion["label"].split()) <= 2
            assert 0 <= criterion["score"] <= 10
    _assert_no_live_true(payload)


def test_milestone_countdown_uses_accepted_forward_paper_rate_windows():
    dashboard = load_module("kalshi_dashboard_milestone_countdown_rates", ROOT / "kalshi_dashboard.py")
    now = datetime(2026, 5, 25, 23, 55, tzinfo=timezone.utc)
    decisions = []
    outcomes = {}
    for index in range(3):
        decision_id = f"forward-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "decision": "PAPER_BUY_YES",
                "evidence_tier": "forward_paper",
                "simulated_size_usd": 1.0,
                "selected_executable_side": "YES",
                "paper_fill_price_cents": 50,
                "baseline_comparison": {
                    "beats_market_baseline": True,
                    "beats_random_baseline": True,
                    "beats_no_trade_baseline": True,
                },
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )
        outcomes[decision_id] = {
            "decision_id": decision_id,
            "resolved": True,
            "outcome_yes": 1,
            "settlement_checked_at_utc": (now - timedelta(hours=2 + index)).isoformat().replace("+00:00", "Z"),
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }

    rate_windows = dashboard._accepted_forward_paper_rate_windows(decisions, outcomes, now=now)
    assert rate_windows["rate_source"] == "accepted_forward_paper_only"
    assert rate_windows["selected_accepted_forward_window"] == "6h"
    assert rate_windows["selected_proof_qualified_window"] == "6h"
    assert rate_windows["accepted_forward_rate_per_hour"] == 0.5
    assert rate_windows["proof_qualified_rate_per_hour"] == 0.5

    payload = dashboard._milestone_countdown_snapshot(
        gap01_forward_proof={
            "target_scored_positive_baseline_beating_outcomes": 100,
            "status": "OPEN",
            "completion_grade": 4.8,
            "leading_lane": {
                "scored": 40,
                "paper_pnl_usd": 2.25,
                "accuracy": 0.7,
            },
        },
        active_perf={"scored_accepted_trades": 40, "paper_pnl_usd": 2.25, "accuracy": 0.7},
        learning_velocity={
            "resolved_last_1h": 99,
            "shadow_resolved_last_1h": 99,
            "category_resolved_last_1h": {"weather": 8, "crypto": 4},
        },
        weather_crypto_ml={"domains": {"weather": {"shadow_scored": 100}, "crypto": {"shadow_scored": 100}}},
        crypto_evidence={},
        source_lag_surface_strategy={
            "nws_cli": {"freshness": {"status": "FRESH", "parsed_product_count": 3}},
            "weather": {"ranked_surface_targets": []},
            "crypto": {"basis_readiness": {"status": "SHADOW_ONLY", "accepted_paper_allowed": False}, "ranked_crypto_hypotheses": []},
        },
        weather_source_freshness={"ok": True},
        now_text="2026-05-25T23:55:00Z",
        accepted_forward_rate_windows=rate_windows,
    )

    proof = next(row for row in payload["milestones"] if row["milestone_id"] == "proof")
    proof_count = next(row for row in proof["criteria"] if row["label"] == "Count")
    assert proof["eta_label"] == "5d 0h 0m"
    assert proof["status"] == "tracking"
    assert proof_count["eta_label"] == "5d 0h 0m"
    assert proof_count["eligible_for_eta"] is True
    assert proof_count["rate_source"] == "accepted_forward_paper_only"
    assert payload["countdown_health"]["accepted_forward_rate_windows"]["selected_proof_qualified_window"] == "6h"
    assert payload["rate_windows"]["selected_proof_qualified_window"] == "6h"
    assert payload["rate_windows"]["proof_qualified_rate_per_hour"] == 0.5
    _assert_no_live_true(payload)


def test_gap01_forward_proof_requires_100_profitable_baseline_beating_outcomes():
    dashboard = load_module("kalshi_dashboard_gap01_proof", ROOT / "kalshi_dashboard.py")
    now = datetime(2026, 5, 21, 21, 30, tzinfo=timezone.utc)
    decisions = []
    outcomes = {}
    for index in range(99):
        decision_id = f"proof-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "decision": "PAPER_WEATHER_MODEL_BUY_YES",
                "simulated_size_usd": 1.0,
                "selected_executable_side": "YES",
                "paper_fill_price_cents": 40,
                "strategy_bucket": "weather_model_fast_evidence",
                "fair_value_source_type": "weather_model",
                "market_category": "weather",
                "evidence_tier": "forward_paper",
                "proof_metrics_exclude_exploration": False,
                "beats_market_baseline": True,
                "beats_random_baseline": True,
                "beats_no_trade_baseline": True,
            }
        )
        outcomes[decision_id] = {
            "decision_id": decision_id,
            "resolved": True,
            "outcome_yes": 1,
            "settlement_checked_at_utc": "2026-05-21T21:00:00Z",
        }
    payload = dashboard._gap01_forward_proof_status(decisions, outcomes, now=now)
    assert payload["status"] == "OPEN"
    assert payload["can_truthfully_claim_10"] is False
    assert payload["leading_lane"]["remaining_to_100"] == 1

    final_id = "proof-99"
    decisions.append({**decisions[-1], "decision_id": final_id})
    outcomes[final_id] = {
        "decision_id": final_id,
        "resolved": True,
        "outcome_yes": 1,
        "settlement_checked_at_utc": "2026-05-21T21:00:00Z",
    }
    payload = dashboard._gap01_forward_proof_status(decisions, outcomes, now=now)
    assert payload["status"] == "COMPLETE"
    assert payload["can_truthfully_claim_10"] is True
    assert payload["leading_lane"]["scored"] == 100
    assert payload["live_order_allowed"] is False


def test_dashboard_includes_crypto_evidence_section():
    dashboard = load_module("kalshi_dashboard_crypto_evidence", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    assert "crypto_evidence" in payload
    assert payload["crypto_evidence"]["live_order_allowed"] is False
    assert payload["crypto_evidence"]["auto_live_promotion_allowed"] is False
    assert "crypto_assets_seen" in payload["crypto_evidence"]
    assert "crypto_parse_blockers" in payload["crypto_evidence"]
    assert "market_source_counts" in payload["crypto_evidence"]
    assert "series_tickers_checked" in payload["crypto_evidence"]
    assert "crypto_readiness_status" in payload["crypto_evidence"]
    assert "next_crypto_trade_ready_check_time_utc" in payload["crypto_evidence"]
    assert "next_crypto_trade_ready_unavailable_reason" in payload["crypto_evidence"]
    assert "last_crypto_trade_ready_check_time_utc" in payload["crypto_evidence"]
    assert "next_crypto_learning_check_reason" in payload["crypto_evidence"]
    assert "crypto_readiness_summary" in payload["crypto_evidence"]


def test_dashboard_includes_weather_crypto_ml_section():
    dashboard = load_module("kalshi_dashboard_weather_crypto_ml", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    assert "weather_crypto_ml" in payload
    assert payload["weather_crypto_ml"]["live_order_allowed"] is False
    assert payload["weather_crypto_ml"]["auto_live_promotion_allowed"] is False
    assert "status" in payload["weather_crypto_ml"]
    assert "reality_contract" in payload["weather_crypto_ml"]
    assert "model_governance" in payload["weather_crypto_ml"]
    assert "active_learning_queue" in payload["weather_crypto_ml"]
    assert "paper_betting" in payload["weather_crypto_ml"]
    assert "promotion_gap" in payload["weather_crypto_ml"]
    assert "ml_dataset" in payload["weather_crypto_ml"]
    assert "ml_model" in payload["weather_crypto_ml"]
    assert "learning_accelerator" in payload["weather_crypto_ml"]
    assert payload["weather_crypto_ml"]["paper_betting"].get("live_order_allowed") is False
    assert payload["weather_crypto_ml"]["promotion_gap"].get("live_order_allowed") is False
    assert payload["weather_crypto_ml"]["ml_dataset"].get("live_order_allowed") is False
    assert payload["weather_crypto_ml"]["ml_model"].get("live_order_allowed") is False
    assert payload["weather_crypto_ml"]["learning_accelerator"].get("live_order_allowed") is False
    assert "latest_scheduled_recovery" in payload["weather_crypto_ml"]
    assert payload["weather_crypto_ml"]["latest_scheduled_recovery"].get("live_order_allowed") is False
    assert payload["weather_crypto_ml"]["latest_scheduled_recovery"].get("auto_live_promotion_allowed") is False
    assert "quarantine_recovery_summary" in payload["weather_crypto_ml"]["latest_scheduled_recovery"]
    assert "recovery_candidate_coverage" in payload["weather_crypto_ml"]["latest_scheduled_recovery"]
    assert "quarantine_recovery_retry_plan" in payload["weather_crypto_ml"]["latest_scheduled_recovery"]
    assert "weather_frontier_sampling_plan" in payload["weather_crypto_ml"]["latest_scheduled_recovery"]
    assert "weather_frontier_sampling_result" in payload["weather_crypto_ml"]["latest_scheduled_recovery"]
    assert isinstance(payload["weather_crypto_ml"]["latest_scheduled_recovery"]["weather_frontier_sampling_plan"], dict)
    assert isinstance(payload["weather_crypto_ml"]["latest_scheduled_recovery"]["weather_frontier_sampling_result"], dict)
    assert "ml_build_gap_summary" in payload["weather_crypto_ml"]["ml_model"]
    assert "ml_build_gaps" in payload["weather_crypto_ml"]["ml_model"]
    assert "edge_decay_diagnostics" in payload["weather_crypto_ml"]["ml_model"]


def test_dashboard_html_exposes_quarantine_recovery_priority_panel():
    dashboard = load_module("kalshi_dashboard_quarantine_recovery_html", ROOT / "kalshi_dashboard.py")
    dashboard.write_dashboard_html()
    html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    assert "Quarantine Recovery Priority" in html
    assert "quarantine-recovery-table" in html
    assert "weather-frontier-sampling-table" in html
    assert "Weather frontier sampling" in html
    assert "SHADOW_QUARANTINE_RECOVERY" in html or "shadow quarantine recovery" in html


def test_dashboard_includes_build_gap_audit_completion_grade():
    dashboard = load_module("kalshi_dashboard_build_gap_audit", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()

    assert "build_gap_audit" in payload
    assert payload["build_gap_audit"]["live_order_allowed"] is False
    assert payload["build_gap_audit"]["auto_live_promotion_allowed"] is False
    assert payload["completion_grade"] == payload["build_gap_audit"]["completion_grade"]
    assert isinstance(payload["build_gap_audit"].get("can_truthfully_claim_10"), bool)
    assert payload["build_gap_audit"]["top_next_gap"].get("gap_id")
    assert payload["build_gap_audit"]["top_grade_draggers"]
    assert payload["build_gap_audit"]["top_grade_draggers"][0].get("gap_id")
    assert "completion_grade_movement" in payload["build_gap_audit"]


def test_dashboard_html_exposes_build_gap_audit_panel():
    dashboard = load_module("kalshi_dashboard_build_gap_audit_html", ROOT / "kalshi_dashboard.py")
    dashboard.write_dashboard_html()
    html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    assert "Verified Build Gap Audit" in html
    assert "build-gap-audit-table" in html
    assert "Completion Grade" in html
    assert "renderBuildGapAudit" in html


def test_dashboard_html_exposes_crypto_regime_selector_panel():
    dashboard = load_module("kalshi_dashboard_crypto_regime_selector_html", ROOT / "kalshi_dashboard.py")
    dashboard.write_dashboard_html()
    html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    assert "Crypto Regime Selector" in html
    assert "crypto-regime-selector-table" in html
    assert "crypto-regime-outcomes-table" in html
    assert "crypto-coverage-cohort-blocks-table" in html
    assert "crypto-regime-inverse-repair-table" in html
    assert "Coverage Cohort Blocks" in html
    assert "Inverse Repair Candidate" in html
    assert "Inverse Repair Shadows" in html
    assert "Inverse Repair Proof Gate" in html
    assert "inverse_repair_shadow_proof_gate" in html
    assert "Inverse Repair Capture" in html
    assert "inverse_repair_shadow_primary_capture_blocker" in html
    assert "top_market_bucket_capture_plan" in html
    assert "target_price_band" in html
    assert "renderCryptoRegimeSelector" in html


def test_dashboard_crypto_regime_snapshot_surfaces_failed_coverage_cohort_block():
    dashboard = load_module("kalshi_dashboard_crypto_regime_coverage_blocks", ROOT / "kalshi_dashboard.py")
    payload = dashboard._sts_crypto_regime_selector_outcomes_snapshot(
        {
            "ok": True,
            "forward_recorded_experiments": [
                {
                    "regime_id": "regime:asset=XRP|side=no|hour=hour_18_23|edge=edge_mid",
                    "proof_credit": "none_forward_coverage_probe",
                    "resolved_count": 1,
                    "losses": 1,
                    "paper_pnl_usd": -1.0,
                },
                {
                    "regime_id": "regime:asset=BTC|side=no|hour=hour_18_23|edge=edge_small",
                    "proof_credit": "none_forward_coverage_probe",
                    "resolved_count": 2,
                    "losses": 2,
                    "paper_pnl_usd": -2.0,
                },
            ],
        }
    )

    blocks = payload["coverage_probe_failure_cohort_blocks"]
    assert len(blocks) == 1
    assert blocks[0]["coverage_cohort_key"] == "coverage_cohort:side=no|hour=hour_18_23"
    assert blocks[0]["action"] == "pause_coverage_probe_cohort"
    assert blocks[0]["counts_for_live_readiness"] is False
    assert blocks[0]["live_order_allowed"] is False


def test_dashboard_includes_strategy_weighting_trade_tracking_and_accelerator():
    dashboard = load_module("kalshi_dashboard_learning_control_plane", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()

    assert "strategy_weighting" in payload
    assert "trade_tracking" in payload
    assert "paper_trade_accelerator" in payload
    assert payload["strategy_weighting"]["live_order_allowed"] is False
    assert payload["trade_tracking"]["live_order_allowed"] is False
    assert payload["paper_trade_accelerator"]["live_order_allowed"] is False
    assert payload["strategy_weighting"]["weight_type"] == "paper_learning_attention_not_live_risk"
    assert payload["strategy_weighting"]["rows"]
    assert payload["trade_tracking"]["required_fields"]
    assert payload["paper_trade_accelerator"]["mode"] == "PAPER_ONLY_SHADOW_FIRST"


def test_strategy_weighting_tracks_dynamic_buckets_and_keeps_accepted_weight_zero():
    dashboard = load_module("kalshi_dashboard_strategy_weighting", ROOT / "kalshi_dashboard.py")
    decision = {
        "decision_id": "crypto-shadow-1",
        "decision": "SHADOW_CRYPTO_MODEL_BUY_YES",
        "timestamp_utc": "2026-05-22T12:00:00Z",
        "market_ticker": "KXBTC15M-26MAY221200",
        "market_title": "Bitcoin price up in next 15 minutes?",
        "strategy_bucket": "crypto_spot_model",
        "strategy_taxonomy": {"domain": "crypto", "strategy": "crypto_spot_model"},
        "selected_executable_side": "YES",
        "paper_fill_price_cents": 44,
        "market_price_probability": 0.44,
        "fair_probability": 0.71,
        "expected_result_known_time_utc": "2026-05-22T12:20:00Z",
        "market_snapshot_hash": "snapshot-1",
        "baseline_comparison": {"beats_market_baseline": True, "beats_random_baseline": True},
        "reality_contract": {"label_quality": "source_backed"},
        "ml_governance": {"feature_cutoff_utc": "2026-05-22T12:00:00Z"},
        "source_observed_at_utc": "2026-05-22T12:00:00Z",
        "simulated_size_usd": 0.0,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    payload = dashboard._strategy_weighting(
        [decision],
        {},
        {
            "crypto-shadow-1": {
                "decision_id": "crypto-shadow-1",
                "resolved": True,
                "outcome_yes": 1,
                "settlement_checked_at_utc": "2026-05-22T12:21:00Z",
            }
        },
        weather_crypto_ml_dataset={"row_count": 294},
        learning_velocity={"resolved_last_1h": 15},
    )

    dynamic = next(row for row in payload["rows"] if row["strategy_id"] == "strategy_bucket:crypto_spot_model")
    assert dynamic["paper_learning_weight_pct"] > 50
    assert dynamic["accepted_paper_weight_pct"] == 0.0
    assert dynamic["recommended_next_shadow_trades"] >= 1
    assert dynamic["validated_trades"] == 1
    assert dynamic["shadow_scored"] == 1
    assert dynamic["domains"] == {"crypto": 1}
    assert dynamic["data_integrity_score"] == 1.0
    assert payload["accepted_paper_weight_policy"].startswith("0%")
    assert payload["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_trade_tracking_contract_reports_required_fields_and_gaps():
    dashboard = load_module("kalshi_dashboard_trade_tracking_contract", ROOT / "kalshi_dashboard.py")
    complete = {
        "decision_id": "complete-weather-1",
        "decision": "SHADOW_WEATHER_MODEL_BUY_YES",
        "timestamp_utc": "2026-05-22T13:00:00Z",
        "market_ticker": "KXHIGHTEMP-26MAY22CHI-T75",
        "market_title": "Will Chicago high temperature be above 75?",
        "strategy_bucket": "weather_model_source_backed",
        "strategy_taxonomy": {"domain": "weather", "strategy": "weather_model"},
        "selected_executable_side": "YES",
        "paper_fill_price_cents": 55,
        "fair_probability": 0.64,
        "expected_result_known_time_utc": "2026-05-23T03:00:00Z",
        "market_snapshot_hash": "snapshot-weather",
        "baseline_comparison": {"beats_market_baseline": True},
        "reality_contract": {"station": "KMDW"},
        "ml_governance": {"feature_cutoff_utc": "2026-05-22T13:00:00Z"},
        "source_observed_at_utc": "2026-05-22T13:00:00Z",
        "simulated_size_usd": 0.0,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }
    sparse = {
        "decision_id": "sparse-crypto-1",
        "decision": "SHADOW_CRYPTO_MODEL_BUY_NO",
        "strategy_bucket": "crypto_spot_model",
        "market_category": "crypto",
        "simulated_size_usd": 0.0,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    payload = dashboard._trade_tracking_contract(
        [complete, sparse],
        {},
        {
            "complete-weather-1": {"decision_id": "complete-weather-1", "resolved": True},
            "sparse-crypto-1": {"decision_id": "sparse-crypto-1", "resolved": True},
        },
        weather_crypto_ml_dataset={"row_count": 294},
    )

    fields = {item["field"] for item in payload["required_fields"]}
    assert {"decision_id", "market_snapshot_hash", "baseline_comparison", "ml_governance", "live_order_allowed_false"} <= fields
    assert payload["total_tracked_decisions"] == 2
    assert payload["validated_labels"] == 2
    assert "market_snapshot_hash" in payload["critical_missing_fields"]
    assert any(row["strategy_id"] == "strategy_bucket:crypto_spot_model" for row in payload["by_strategy"])
    assert payload["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_paper_trade_accelerator_uses_weather_crypto_targets_and_no_live():
    dashboard = load_module("kalshi_dashboard_paper_trade_accelerator", ROOT / "kalshi_dashboard.py")

    payload = dashboard._paper_trade_accelerator(
        weather_crypto_ml_dataset={"row_count": 294},
        learning_velocity={"resolved_last_1h": 15},
        crypto_readiness={
            "next_crypto_trade_ready_check_time_utc": "2026-05-23T02:05:00Z",
            "next_crypto_learning_snapshot_check_time_utc": "2026-05-23T01:53:00Z",
            "next_crypto_learning_check_reason": "rolling_parseable_learning",
        },
        weather_source_freshness={"ok": True},
        strategy_weighting={"weight_type": "paper_learning_attention_not_live_risk"},
    )

    assert payload["validated_weather_crypto_rows"] == 294
    assert payload["rows_needed_to_learning_target"] == 706
    assert payload["rows_needed_to_profit_proof_target"] == 2706
    assert payload["estimated_hours_to_learning_target_at_current_rate"] == 47.07
    assert payload["next_crypto_check_time_utc"] == "2026-05-23T01:53:00Z"
    assert payload["next_crypto_result_check_time_utc"] == "2026-05-23T02:05:00Z"
    assert payload["learning_speed_boost"] == 1.0
    assert payload["learning_pressure_weather"] == 1.0
    assert payload["learning_pressure_crypto"] == 1.0
    assert payload["stochastic_process_pressure"] == 0.0
    assert payload["sports_reallocation_guard"] == 1.0
    assert "live_order_allowed_false" in payload["integrity_constraints"]
    assert payload["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_dashboard_uses_recent_usable_crypto_snapshot_during_fetch_retry():
    dashboard = load_module("kalshi_dashboard_crypto_fallback", ROOT / "kalshi_dashboard.py")
    now = datetime(2026, 5, 30, 17, 30, tzinfo=timezone.utc)
    latest = {
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "active_crypto_markets_seen": 0,
        "parseable_crypto_markets": 0,
        "created_count": 0,
        "next_crypto_learning_check_reason": "read_only_fetch_retry",
        "warnings": ["crypto_spot_fetch_failed:BTC:URLError"],
        "live_order_allowed": False,
    }
    usable = {
        "timestamp_utc": (now - timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
        "active_crypto_markets_seen": 6,
        "parseable_crypto_markets": 5,
        "created_count": 5,
        "warnings": [],
        "live_order_allowed": False,
    }

    payload = dashboard._crypto_evidence_dashboard_record(latest, usable, now=now)

    assert payload["active_crypto_markets_seen"] == 6
    assert payload["parseable_crypto_markets"] == 5
    assert payload["created_count"] == 5
    assert payload["crypto_evidence_current_fetch_failed"] is True
    assert payload["crypto_evidence_usable_snapshot_age_minutes"] == 30.0
    assert payload["current_fetch_warnings"] == ["crypto_spot_fetch_failed:BTC:URLError"]
    assert payload["live_order_allowed"] is False


def test_crypto_evidence_reports_explicit_unavailable_readiness_reason():
    crypto = load_module("kalshi_crypto_evidence_readiness", ROOT / "kalshi_crypto_evidence.py")
    payload = crypto._crypto_readiness_payload(
        next_trade_ready_check=None,
        seconds_until_trade_ready_check=None,
        active_markets_seen=5,
        parseable_markets=0,
        parse_blockers={"crypto_market_not_trade_ready_target_tbd": 5},
    )

    assert payload["crypto_readiness_status"] == "unavailable"
    assert payload["next_crypto_trade_ready_check_time_utc"] is None
    assert payload["seconds_until_next_crypto_trade_ready_check"] is None
    assert payload["next_crypto_trade_ready_unavailable_reason"] == "no_future_trade_ready_time_in_market_metadata"
    assert payload["last_crypto_trade_ready_check_time_utc"] is None
    assert "current Kalshi market metadata" in payload["crypto_readiness_summary"]


def test_build_gap_audit_counts_crypto_inverse_forward_tests(tmp_path):
    auditor = load_module("kalshi_build_gap_crypto_inverse", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(json.dumps({
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "performance_summary": {},
        "paper": {},
        "crypto_evidence": {
            "timestamp_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "active_crypto_markets_seen": 5,
            "parseable_crypto_markets": 5,
            "created_count": 2,
            "created_by_governor_action": {"ACCEPT_FORWARD_PAPER": 1},
            "created_inverse_forward_test_count": 1,
            "created_segment_policy_forward_test_count": 1,
            "warnings": [],
            "crypto_readiness_status": "scheduled",
            "next_crypto_trade_ready_check_time_utc": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
        },
        "strategy_governor": {"routed_count": 100, "action_counts": {"SHADOW_ONLY": 100}, "inverse_forward_tests": 0},
        "strategy_comparison": {"rows": []},
        "paper_volume_accelerator": {"timestamp_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
    }))
    state_path.write_text(json.dumps({}))

    result = auditor.audit(type("Args", (), {"dashboard_data": dashboard_path, "state_path": state_path, "output": tmp_path / "audit.json"})())
    gap18 = next(gap for gap in result["gaps"] if gap["gap_id"] == "GAP-18")

    assert gap18["completion_grade"] == 9.7
    assert "crypto_inverse_forward_tests=1" in gap18["why_it_matters"]
    assert result["live_order_allowed"] is False


def test_crypto_evidence_schedules_fetch_retry_when_market_fetch_fails():
    crypto = load_module("kalshi_crypto_evidence_fetch_retry", ROOT / "kalshi_crypto_evidence.py")
    now = datetime(2026, 5, 30, 17, 23, tzinfo=timezone.utc)
    retry_at = (now + timedelta(seconds=60)).isoformat().replace("+00:00", "Z")

    payload = crypto._crypto_readiness_payload(
        next_trade_ready_check=None,
        seconds_until_trade_ready_check=None,
        active_markets_seen=0,
        parseable_markets=0,
        parse_blockers={},
        fetch_retry_check=retry_at,
        seconds_until_fetch_retry_check=60,
        fetch_retry_reason="read_only_fetch_retry",
    )

    assert payload["crypto_readiness_status"] == "scheduled"
    assert payload["next_crypto_trade_ready_check_time_utc"] == retry_at
    assert payload["next_crypto_learning_snapshot_check_time_utc"] == retry_at
    assert payload["next_crypto_learning_check_reason"] == "read_only_fetch_retry"
    assert payload["next_crypto_trade_ready_unavailable_reason"] is None
    assert "fetch failed" in payload["crypto_readiness_summary"]
    assert payload["live_order_allowed"] is not True if "live_order_allowed" in payload else True


def test_crypto_evidence_schedules_next_rolling_parseable_learning_check():
    crypto = load_module("kalshi_crypto_evidence_rolling_readiness", ROOT / "kalshi_crypto_evidence.py")
    now = datetime(2026, 5, 18, 15, 50, tzinfo=timezone.utc)
    market = {
        "ticker": "KXBTC15M-26MAY181200-00",
        "event_ticker": "KXBTC15M-26MAY181200",
        "series_ticker": "KXBTC15M",
        "title": "BTC price up in next 15 mins?",
        "yes_sub_title": "Target Price: $76,284.64",
        "status": "active",
        "open_time": "2026-05-18T15:45:00Z",
        "close_time": "2026-05-18T16:00:00Z",
        "expected_expiration_time": "2026-05-18T16:05:00Z",
    }

    next_check = crypto._next_parseable_crypto_learning_check_time([market], now)
    snapshot_check = crypto._next_parseable_crypto_snapshot_check_time([market], now)
    payload = crypto._crypto_readiness_payload(
        next_trade_ready_check=next_check,
        seconds_until_trade_ready_check=crypto._seconds_until(next_check, now),
        active_markets_seen=1,
        parseable_markets=1,
        parse_blockers={},
        next_check_reason="rolling_parseable_learning",
        next_learning_snapshot_check=snapshot_check,
        seconds_until_learning_snapshot_check=crypto._seconds_until(snapshot_check, now),
    )

    assert payload["crypto_readiness_status"] == "scheduled"
    assert payload["next_crypto_trade_ready_check_time_utc"] == "2026-05-18T16:05:00Z"
    assert payload["next_crypto_learning_snapshot_check_time_utc"] == "2026-05-18T15:53:00Z"
    assert payload["seconds_until_next_crypto_learning_snapshot_check"] == 180
    assert payload["next_crypto_learning_check_reason"] == "rolling_parseable_learning"
    assert payload["next_crypto_trade_ready_unavailable_reason"] is None
    assert "intra-window snapshot" in payload["crypto_readiness_summary"]
    assert "capture the next 15-minute cohort" in payload["crypto_readiness_summary"]
    assert payload["seconds_until_next_crypto_trade_ready_check"] == 900


def test_dashboard_marks_past_crypto_readiness_check_due_now():
    dashboard = load_module("kalshi_dashboard_crypto_readiness_due", ROOT / "kalshi_dashboard.py")
    payload = dashboard._crypto_readiness_dashboard_snapshot(
        {
            "crypto_readiness_status": "scheduled",
            "next_crypto_trade_ready_check_time_utc": "2026-05-17T21:00:00Z",
            "crypto_readiness_summary": "Next crypto trade-ready check is around 2026-05-17T21:00:00Z.",
        },
        now=datetime(2026, 5, 17, 21, 1, tzinfo=timezone.utc),
    )

    assert payload["crypto_readiness_status"] == "check_due_now"
    assert payload["next_crypto_trade_ready_check_time_utc"] is None
    assert payload["seconds_until_next_crypto_trade_ready_check"] == 0
    assert payload["next_crypto_trade_ready_unavailable_reason"] == "latest_crypto_trade_ready_check_time_already_due"
    assert payload["last_crypto_trade_ready_check_time_utc"] == "2026-05-17T21:00:00Z"
    assert "rerun crypto evidence now" in payload["crypto_readiness_summary"]


def test_strategy_comparison_uses_standardized_strategy_names():
    dashboard = load_module("kalshi_dashboard_strategy_comparison", ROOT / "kalshi_dashboard.py")
    decisions = [
        {
            "decision_id": "standard-1",
            "decision": "PAPER_BUY_YES",
            "strategy_bucket": "high_probability_harvesting_simulation",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 60,
            "live_order_allowed": False,
        },
        {
            "decision_id": "inverse-1",
            "decision": "INVERSE_FORWARD_TEST",
            "strategy_bucket": "inverse_first_paper",
            "selected_executable_side": "NO",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 40,
            "live_order_allowed": False,
        },
        {
            "decision_id": "weather-arb-1",
            "decision": "PAPER_BUY_YES",
            "strategy_bucket": "weather_arbitrage_strategy",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 50,
            "live_order_allowed": False,
        },
        {
            "decision_id": "polyclaw-1",
            "decision": "PAPER_EXPLORE_BUY_NO",
            "strategy_bucket": "polyclaw",
            "selected_executable_side": "NO",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 45,
            "live_order_allowed": False,
        },
        {
            "decision_id": "divergence-1",
            "decision": "SHADOW_POLYMARKET_KALSHI_DIVERGENCE_YES",
            "strategy_bucket": "polymarket_kalshi_divergence",
            "selected_executable_side": "YES",
            "simulated_size_usd": 0,
            "paper_fill_price_cents": 45,
            "live_order_allowed": False,
        },
    ]
    outcomes = {
        "standard-1": {"outcome_yes": 0, "resolved": True},
        "inverse-1": {"outcome_yes": 0, "resolved": True},
        "weather-arb-1": {"outcome_yes": 1, "resolved": True},
        "polyclaw-1": {"outcome_yes": 0, "resolved": True},
    }
    comparison = dashboard._strategy_comparison(
        decisions,
        outcomes,
        {
            "metrics": {
                "original_accuracy": 0.25,
                "inverse_accuracy": 0.75,
                "original_pnl_usd": -10.0,
                "inverse_pnl_usd": 6.0,
                "accuracy_delta_inverse_minus_original": 0.5,
                "pnl_delta_inverse_minus_original_usd": 16.0,
            }
        },
    )
    names = [row["display_name"] for row in comparison["rows"]]
    assert names == [
        "Standard Strategy",
        "Inverse Standard Strategy",
        "Weather Arbitrage Strategy",
        "PolyClaw",
        "polymarket-kalshi-divergence",
    ]
    assert comparison["equal_weighting"]["enabled"] is True
    assert comparison["equal_weighting"]["weight_pct_per_strategy"] == 20.0
    assert all(row["strategy_comparison_weight_pct"] == 20.0 for row in comparison["rows"])
    assert all(row["strategy_comparison_weight_label"] == "equal strategy weight" for row in comparison["rows"])
    assert all("pnl_delta_display" in row for row in comparison["rows"])
    weather_arbitrage = next(row for row in comparison["rows"] if row["strategy_id"] == "weather_arbitrage_strategy")
    polyclaw = next(row for row in comparison["rows"] if row["strategy_id"] == "polyclaw")
    divergence = next(row for row in comparison["rows"] if row["strategy_id"] == "polymarket_kalshi_divergence")
    assert weather_arbitrage["tracking_status"] == "tracking"
    assert weather_arbitrage["accuracy"] == 1.0
    assert weather_arbitrage["pnl_delta_vs_standard_usd"] == 2.0
    assert weather_arbitrage["pnl_delta_vs_standard_label"] == "actual vs Standard"
    assert polyclaw["tracking_status"] == "tracking"
    assert polyclaw["accuracy"] == 1.0
    assert polyclaw["pnl_delta_vs_standard_usd"] == 2.22
    assert polyclaw["pnl_delta_vs_standard_label"] == "actual vs Standard"
    assert divergence["tracking_status"] == "tracking"
    assert divergence["accepted"] == 0
    assert divergence["pnl_delta_vs_standard_usd"] is None
    assert divergence["pnl_delta_vs_standard_label"] == "waiting for scored proof"
    assert divergence["pnl_delta_display"] == "Waiting for proof"
    standard = next(row for row in comparison["rows"] if row["strategy_id"] == "standard_strategy")
    inverse = next(row for row in comparison["rows"] if row["strategy_id"] == "inverse_standard_strategy")
    assert standard["pnl_delta_vs_standard_usd"] == 0.0
    assert standard["pnl_delta_vs_standard_label"] == "baseline"
    assert standard["pnl_delta_display"] == "$0.00"
    assert inverse["pnl_delta_vs_standard_usd"] == 2.5
    assert inverse["pnl_delta_vs_standard_label"] == "actual vs Standard"
    assert inverse["pnl_delta_display"] == "+$2.50"
    assert comparison["primary_metric_source"] == "actual_accepted_paper_trades"
    assert comparison["secondary_metric_source"] == "historical_inverse_audit"
    assert comparison["actual_summary"]["standard_accuracy"] == 0.0
    assert comparison["actual_summary"]["inverse_standard_accuracy"] == 1.0
    assert comparison["actual_summary"]["accuracy_delta_inverse_minus_standard"] == 1.0
    assert comparison["actual_summary"]["standard_pnl_usd"] == -1.0
    assert comparison["actual_summary"]["inverse_standard_pnl_usd"] == 1.5
    assert comparison["actual_summary"]["pnl_delta_inverse_minus_standard_usd"] == 2.5
    assert comparison["audit_summary"]["standard_accuracy"] == 0.25
    assert comparison["audit_summary"]["inverse_standard_accuracy"] == 0.75
    assert all(row["live_order_allowed"] is False for row in comparison["rows"])
    assert comparison["live_order_allowed"] is False
    assert comparison["auto_live_promotion_allowed"] is False


def test_strategy_comparison_includes_every_named_strategy_lane():
    dashboard = load_module("kalshi_dashboard_strategy_comparison_dynamic", ROOT / "kalshi_dashboard.py")
    decisions = [
        {
            "decision_id": "standard-1",
            "decision": "PAPER_BUY_YES",
            "strategy_bucket": "high_probability_harvesting_simulation",
            "market_title": "Will the high temperature in Chicago be above 75?",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 50,
            "live_order_allowed": False,
        },
        {
            "decision_id": "source-lag-1",
            "decision": "PAPER_BUY_YES",
            "strategy_bucket": "source_lag_surface",
            "market_title": "Will the high temperature in New York be above 80?",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 50,
            "live_order_allowed": False,
        },
        {
            "decision_id": "source-lag-shadow-1",
            "decision": "SHADOW_BUY_NO",
            "strategy_bucket": "source_lag_surface",
            "market_title": "Will Bitcoin be above 120000?",
            "selected_executable_side": "NO",
            "simulated_size_usd": 0,
            "paper_fill_price_cents": 50,
            "live_order_allowed": False,
        },
    ]
    outcomes = {
        "standard-1": {"outcome_yes": 0, "resolved": True},
        "source-lag-1": {"outcome_yes": 1, "resolved": True},
    }

    comparison = dashboard._strategy_comparison(decisions, outcomes, {"metrics": {}})
    source_lag = next(
        row for row in comparison["rows"] if row["strategy_id"] == "strategy_bucket:source_lag_surface"
    )

    assert len(comparison["rows"]) == 6
    assert source_lag["display_name"] == "Source Lag Surface"
    assert source_lag["role"] == "named_strategy_lane"
    assert source_lag["decisions"] == 2
    assert source_lag["accepted"] == 1
    assert source_lag["shadow_decisions"] == 1
    assert source_lag["scored"] == 1
    assert source_lag["accuracy"] == 1.0
    assert source_lag["paper_pnl_usd"] == 1.0
    assert source_lag["average_pnl_per_scored_trade_usd"] == 1.0
    assert source_lag["domains"] == {"weather": 1, "crypto": 1}
    assert source_lag["pnl_delta_vs_standard_usd"] == 2.0
    assert source_lag["pnl_delta_vs_standard_label"] == "actual vs Standard"
    assert source_lag["tracking_status"] == "tracking"
    assert comparison["standardized_names"]["strategy_bucket:source_lag_surface"] == "Source Lag Surface"
    assert comparison["equal_weighting"]["weight_pct_per_strategy"] == 16.7
    assert all(row["live_order_allowed"] is False for row in comparison["rows"])
    assert comparison["live_order_allowed"] is False


def test_strategy_comparison_counts_applied_inverse_as_real_inverse_paper():
    dashboard = load_module("kalshi_dashboard_applied_inverse_actual", ROOT / "kalshi_dashboard.py")
    decisions = [
        {
            "decision_id": "standard-looking-inverse-1",
            "decision": "PAPER_EXPLORE_BUY_NO",
            "strategy_bucket": "high_probability_harvesting_simulation",
            "inverse_strategy_applied": True,
            "original_strategy_side": "YES",
            "selected_executable_side": "NO",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 35,
            "live_order_allowed": False,
        },
        {
            "decision_id": "standard-1",
            "decision": "PAPER_BUY_YES",
            "strategy_bucket": "high_probability_harvesting_simulation",
            "simulated_size_usd": 1,
            "paper_fill_price_cents": 60,
            "live_order_allowed": False,
        },
    ]
    outcomes = {
        "standard-looking-inverse-1": {"outcome_yes": 0, "resolved": True},
        "standard-1": {"outcome_yes": 1, "resolved": True},
    }

    comparison = dashboard._strategy_comparison(decisions, outcomes, {"metrics": {}})
    standard = next(row for row in comparison["rows"] if row["strategy_id"] == "standard_strategy")
    inverse = next(
        row for row in comparison["rows"] if row["strategy_id"] == "inverse_standard_strategy"
    )

    assert comparison["primary_metric_source"] == "actual_accepted_paper_trades"
    assert standard["accepted"] == 1
    assert standard["scored"] == 1
    assert standard["accuracy"] == 1.0
    assert inverse["accepted"] == 1
    assert inverse["scored"] == 1
    assert inverse["accuracy"] == 1.0
    assert inverse["paper_pnl_usd"] == 1.86
    assert comparison["actual_summary"]["inverse_standard_scored"] == 1
    assert comparison["actual_summary"]["inverse_standard_accuracy"] == 1.0
    assert comparison["audit_summary"]["inverse_standard_accuracy"] is None
    assert all(row["live_order_allowed"] is False for row in comparison["rows"])
    assert comparison["live_order_allowed"] is False


def test_strategy_comparison_aggregates_inverse_audit_opportunities():
    dashboard = load_module("kalshi_dashboard_inverse_opportunity_aggregate", ROOT / "kalshi_dashboard.py")
    comparison = dashboard._strategy_comparison(
        [],
        {},
        {
            "ok": True,
            "inverse_beats_current": True,
            "opportunities": [
                {
                    "category": "weather",
                    "scored": 40,
                    "current_accuracy": 0.25,
                    "inverse_accuracy": 0.75,
                    "current_pnl_usd": -10.0,
                    "inverse_pnl_usd": 6.0,
                    "live_order_allowed": False,
                },
                {
                    "category": "sports",
                    "scored": 60,
                    "current_accuracy": 0.5,
                    "inverse_accuracy": 0.65,
                    "current_pnl_usd": -5.0,
                    "inverse_pnl_usd": 4.0,
                    "live_order_allowed": False,
                },
            ],
            "live_order_allowed": False,
        },
    )
    standard = next(row for row in comparison["rows"] if row["strategy_id"] == "standard_strategy")
    inverse = next(row for row in comparison["rows"] if row["strategy_id"] == "inverse_standard_strategy")
    assert standard["audit_scored"] == 100
    assert inverse["audit_scored"] == 100
    assert round(standard["audit_accuracy"], 4) == 0.4
    assert round(inverse["audit_accuracy"], 4) == 0.69
    assert standard["audit_pnl_usd"] == -15.0
    assert inverse["audit_pnl_usd"] == 10.0
    assert inverse["audit_delta_vs_standard_pnl_usd"] == 25.0
    assert standard["pnl_delta_vs_standard_usd"] == 0.0
    assert standard["pnl_delta_vs_standard_label"] == "audit baseline vs Standard"
    assert inverse["pnl_delta_vs_standard_usd"] == 25.0
    assert inverse["pnl_delta_vs_standard_label"] == "audit vs Standard"
    assert all(row["strategy_comparison_weight_pct"] == 20.0 for row in comparison["rows"])
    assert all("pnl_delta_display" in row for row in comparison["rows"])
    assert comparison["actual_summary"]["standard_accuracy"] is None
    assert comparison["actual_summary"]["inverse_standard_accuracy"] is None
    assert comparison["audit_summary"]["standard_accuracy"] == standard["audit_accuracy"]
    assert comparison["audit_summary"]["inverse_standard_accuracy"] == inverse["audit_accuracy"]


def test_dashboard_exposes_latest_inverse_audit_metrics():
    dashboard = load_module("kalshi_dashboard_inverse_metrics", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    inverse_audit = payload["inverse_strategy_audit"]
    metrics = inverse_audit.get("metrics", {})
    comparison = payload["strategy_comparison"]
    standard = next(row for row in comparison["rows"] if row["strategy_id"] == "standard_strategy")
    inverse = next(row for row in comparison["rows"] if row["strategy_id"] == "inverse_standard_strategy")
    assert inverse_audit["live_order_allowed"] is False
    assert metrics["total_directional_scored"] > 0
    assert isinstance(metrics["original_accuracy"], float)
    assert isinstance(metrics["inverse_accuracy"], float)
    assert standard["audit_accuracy"] == metrics["original_accuracy"]
    assert inverse["audit_accuracy"] == metrics["inverse_accuracy"]
    assert comparison["primary_metric_source"] == "actual_accepted_paper_trades"
    assert comparison["actual_summary"]["inverse_standard_scored"] == inverse["scored"]
    assert comparison["audit_summary"]["inverse_standard_accuracy"] == metrics["inverse_accuracy"]


def test_strategy_lane_candidate_builder_creates_paper_only_lanes():
    lanes = load_module("kalshi_strategy_lane_candidates", ROOT / "kalshi_strategy_lane_candidates.py")
    market = {
        "ticker": "KXHIGHTEMP-26MAY13CHI-T75",
        "title": "Will the high temperature in Chicago be above 75 on May 13?",
        "category": "weather",
        "close_time": "2026-05-13T23:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 42,
        "best_yes_ask_size_contracts": 20,
        "best_no_ask_cents": 58,
        "best_no_ask_size_contracts": 15,
        "yes_spread_cents": 4,
        "no_spread_cents": 5,
        "is_crossed": False,
    }
    candidates = lanes.build_candidates(
        [market],
        {market["ticker"]: normalized},
        now=datetime(2026, 5, 13, 12, tzinfo=timezone.utc),
        max_hours=24,
        size_usd=1.0,
    )
    by_lane = {candidate["strategy_bucket"]: candidate for candidate in candidates}
    assert {"weather_arbitrage_strategy", "polyclaw", "polymarket_kalshi_divergence"} <= set(by_lane)
    assert by_lane["weather_arbitrage_strategy"]["simulated_size_usd"] == 1.0
    assert by_lane["polyclaw"]["simulated_size_usd"] == 0.0
    assert by_lane["polyclaw"]["evidence_tier"] == "shadow"
    assert by_lane["polymarket_kalshi_divergence"]["simulated_size_usd"] == 0.0
    assert by_lane["polymarket_kalshi_divergence"]["evidence_tier"] == "shadow"
    assert all(candidate["live_order_allowed"] is False for candidate in candidates)


def test_strategy_lane_candidates_require_explicit_external_reference_for_polyclaw():
    lanes = load_module("kalshi_strategy_lane_candidates_reference", ROOT / "kalshi_strategy_lane_candidates.py")
    market = {
        "ticker": "KXSPORT-REFERENCE",
        "title": "Will Team A win the soccer match?",
        "category": "sports",
        "close_time": "2026-05-13T23:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 42,
        "best_yes_ask_size_contracts": 20,
        "best_no_ask_cents": 58,
        "best_no_ask_size_contracts": 15,
        "yes_spread_cents": 4,
        "no_spread_cents": 5,
        "is_crossed": False,
    }
    reference = {
        "kalshi_ticker": market["ticker"],
        "provider": "polymarket",
        "source_type": "polymarket_reference_price",
        "probability_yes": 0.62,
        "observed_at_utc": "2026-05-13T12:00:00Z",
        "source_url": "https://polymarket.com/event/team-a-reference",
        "polymarket_slug": "team-a-reference",
        "match_confidence": 0.99,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }
    candidates = lanes.build_candidates(
        [market],
        {market["ticker"]: normalized},
        now=datetime(2026, 5, 13, 12, 5, tzinfo=timezone.utc),
        max_hours=24,
        size_usd=1.0,
        polymarket_references={market["ticker"]: reference},
    )
    by_lane = {candidate["strategy_bucket"]: candidate for candidate in candidates}
    assert by_lane["polyclaw"]["simulated_size_usd"] == 1.0
    assert by_lane["polyclaw"]["fair_value_source_type"] == "polymarket_reference_price"
    assert by_lane["polyclaw"]["external_reference"]["polymarket_slug"] == "team-a-reference"
    assert by_lane["polyclaw"]["edge_after_costs_pct"] > 0
    assert by_lane["polymarket_kalshi_divergence"]["simulated_size_usd"] == 1.0
    assert by_lane["polymarket_kalshi_divergence"]["evidence_tier"] == "exploration"
    assert all(candidate["live_order_allowed"] is False for candidate in candidates)


def test_crypto_probability_model_and_candidate_builder_create_paper_only_candidate():
    crypto = load_module("kalshi_crypto_evidence_builder", ROOT / "kalshi_crypto_evidence.py")
    now = datetime(2026, 6, 13, 12, tzinfo=timezone.utc)
    market = {
        "ticker": "KXBTC-26JUN13-T100000",
        "title": "Will Bitcoin be above $100,000 on June 13, 2026?",
        "category": "crypto",
        "close_time": "2026-06-13T20:00:00Z",
    }
    parsed = crypto.parse_crypto_market(market, now=now, max_hours=24)
    assert parsed["asset"] == "BTC"
    assert parsed["threshold_usd"] == 100000.0
    assert parsed["yes_direction"] == "above"
    fair_yes = crypto.fair_yes_probability(
        parsed,
        {
            "asset": "BTC",
            "spot_usd": 120000.0,
            "annualized_volatility": 0.55,
            "provider": "fixture",
            "observed_at_utc": "2026-06-13T12:00:00Z",
            "source_url": "fixture://btc",
        },
    )
    assert fair_yes > 0.9
    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 70,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 30,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "BTC": {
                "asset": "BTC",
                "spot_usd": 120000.0,
                "annualized_volatility": 0.55,
                "provider": "fixture",
                "observed_at_utc": "2026-06-13T12:00:00Z",
                "source_url": "fixture://btc",
            }
        },
        now=now,
        max_hours=24,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["strategy_bucket"] == "crypto_spot_model"
    assert candidate["fair_value_source_type"] == "crypto_spot_volatility_model"
    assert candidate["decision"] == "PAPER_EXPLORE_BUY_YES"
    assert candidate["baseline_beating_signal"] is True
    assert candidate["baseline_comparison"]["beats_market_baseline"] is True
    assert candidate["baseline_comparison"]["beats_random_baseline"] is True
    assert candidate["baseline_comparison"]["beats_no_trade_baseline"] is True
    assert candidate["quality_gates"]["baseline_comparison_passed"] is True
    assert candidate["crypto_model_confidence_score"] > 0.30
    assert candidate["quality_gates"]["model_confidence_passed"] is True
    assert candidate["quality_gates"]["crypto_model_quality_passed"] is True
    assert candidate["crypto_evidence"]["crypto_model_diagnostics"]["model_quality_passed"] is True
    assert candidate["series_ticker"] == "KXBTC"
    assert candidate["crypto_evidence"]["series_ticker"] == "KXBTC"
    assert candidate["source_fetched_at_utc"] == "2026-06-13T12:00:00Z"
    assert candidate["source_hashes"]
    assert candidate["source_hash"] == candidate["source_hashes"][0]
    assert candidate["simulated_size_usd"] == 1.0
    assert candidate["live_order_allowed"] is False


def test_crypto_candidate_shrinks_brier_bad_segment_toward_market(tmp_path):
    crypto = load_module("kalshi_crypto_evidence_calibration_repair", ROOT / "kalshi_crypto_evidence.py")
    readiness_path = tmp_path / "weather_crypto_ml_readiness.json"
    readiness_path.write_text(
        json.dumps(
            {
                "promotion_gap": {
                    "calibration_repair": {
                        "status": "repair_required",
                        "segments": [
                            {
                                "segment_key": "crypto|BTC|crypto_price_threshold|yes",
                                "action": "shrink_to_market",
                                "candidate_weight_cap": 0.1,
                                "reason": "Model Brier is worse than market.",
                                "accepted_paper_allowed": False,
                                "live_order_allowed": False,
                            }
                        ],
                        "live_order_allowed": False,
                    }
                },
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    old_path = crypto.kalshi_weather_crypto_ml.ML_READINESS_PATH
    crypto.kalshi_weather_crypto_ml.ML_READINESS_PATH = readiness_path
    try:
        now = datetime(2026, 6, 13, 12, tzinfo=timezone.utc)
        market = {
            "ticker": "KXBTC-26JUN13-T100000",
            "title": "Will Bitcoin be above $100,000 on June 13, 2026?",
            "category": "crypto",
            "close_time": "2026-06-13T20:00:00Z",
        }
        candidates = crypto.build_candidates(
            [market],
            {
                market["ticker"]: {
                    "best_yes_ask_cents": 70,
                    "best_yes_ask_size_contracts": 25,
                    "best_no_ask_cents": 30,
                    "best_no_ask_size_contracts": 25,
                    "yes_spread_cents": 3,
                    "no_spread_cents": 4,
                    "is_crossed": False,
                }
            },
            {
                "BTC": {
                    "asset": "BTC",
                    "spot_usd": 120000.0,
                    "annualized_volatility": 0.55,
                    "provider": "fixture",
                    "observed_at_utc": "2026-06-13T12:00:00Z",
                    "source_url": "fixture://btc",
                }
            },
            now=now,
            max_hours=24,
            size_usd=1.0,
            min_edge_after_costs_cents=2.0,
            estimated_cost_cents=1.7,
        )
    finally:
        crypto.kalshi_weather_crypto_ml.ML_READINESS_PATH = old_path

    assert len(candidates) == 1
    candidate = candidates[0]
    repair = candidate["calibration_repair_adjustment"]
    assert repair["status"] == "applied"
    assert repair["candidate_weight_cap"] == 0.1
    assert repair["market_probability"] == 0.7
    assert repair["adjusted_candidate_probability"] < repair["original_candidate_probability"]
    assert candidate["selected_side_fair_probability"] == repair["adjusted_candidate_probability"]
    assert candidate["uncalibrated_selected_side_fair_probability"] > candidate["selected_side_fair_probability"]
    assert candidate["decision"] == "SHADOW_CRYPTO_SPOT_MODEL_YES"
    assert candidate["baseline_beating_signal"] is False
    assert candidate["quality_gates"]["calibration_repair_applied"] is True
    assert candidate["simulated_size_usd"] == 0.0
    _assert_no_live_true(candidate)


def test_crypto_profit_selector_shadow_candidate_inverts_ranked_target_side():
    crypto = load_module("kalshi_crypto_profit_selector_shadow", ROOT / "kalshi_crypto_evidence.py")
    router = load_module("kalshi_crypto_profit_selector_shadow_router", ROOT / "kalshi_auto_paper_candidates.py")
    now = datetime(2026, 5, 13, 12, tzinfo=timezone.utc)
    market = {
        "ticker": "KXBTC-26MAY13-T100000",
        "title": "Will Bitcoin be above $100,000 on May 13, 2026?",
        "category": "crypto",
        "close_time": "2026-05-13T20:00:00Z",
    }
    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 70,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 30,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "BTC": {
                "asset": "BTC",
                "spot_usd": 120000.0,
                "annualized_volatility": 0.55,
                "provider": "fixture",
                "observed_at_utc": "2026-05-13T12:00:00Z",
                "source_url": "fixture://btc",
            }
        },
        now=now,
        max_hours=24,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )
    candidate = candidates[0]
    target = {
        "selector_key": "crypto|BTC|crypto_price_threshold|yes",
        "selector_rule_id": "segment:crypto|BTC|crypto_price_threshold|yes:inverse_selected_side",
        "selector_rank": 1,
        "selected_policy": "inverse_selected_side",
        "candidate_side_transform": "invert_current_candidate_side",
        "test_accuracy": 0.86,
        "test_pnl_usd": 3.83,
        "test_trade_count": 36,
        "target_forward_outcomes": 100,
        "fresh_forward_outcomes_collected": 4,
        "fresh_forward_outcomes_needed": 100,
        "fresh_forward_accuracy": 0.75,
        "fresh_forward_pnl_usd": 1.4,
        "forward_proof_epoch_start_utc": "2026-05-22T05:00:00Z",
        "forward_proof_epoch_source": "walk_forward_test_window_end",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    shadow = crypto._profit_selector_shadow_candidate(candidate, target)
    assert shadow is not None
    assert shadow["strategy_bucket"] == "weather_crypto_profit_selector_forward_shadow"
    assert shadow["selected_executable_side"] == "NO"
    assert shadow["paper_fill_price_cents"] == 30
    assert shadow["simulated_size_usd"] == 0.0
    assert shadow["shadow_learning_outcome"] is True
    assert shadow["profit_selector_forward_shadow"]["source_selector_key"] == "crypto|BTC|crypto_price_threshold|yes"
    assert shadow["profit_selector_forward_shadow"]["selector_shadow_side"] == "NO"
    assert shadow["profit_selector_forward_shadow"]["fresh_forward_outcomes_collected"] == 4
    assert shadow["profit_selector_forward_shadow"]["forward_proof_epoch_start_utc"] == "2026-05-22T05:00:00Z"
    assert shadow["selective_ml_segment_key"] == "crypto|BTC|crypto_price_threshold|no"
    routed = crypto._force_profit_selector_shadow_route(router.apply_governor_route(shadow, {}))
    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["evidence_tier"] == "shadow"
    assert routed["proof_metrics_exclude_shadow"] is True
    _assert_no_live_true(routed)


def test_crypto_profit_selector_fresh_proof_opens_tiny_forward_paper_probe():
    crypto = load_module("kalshi_crypto_profit_selector_forward_probe", ROOT / "kalshi_crypto_evidence.py")
    router = load_module("kalshi_crypto_profit_selector_forward_probe_router", ROOT / "kalshi_auto_paper_candidates.py")
    now = datetime(2026, 5, 13, 12, tzinfo=timezone.utc)
    market = {
        "ticker": "KXBTC-26JUN13-T100000",
        "title": "Will Bitcoin be above $100,000 on June 13, 2026?",
        "category": "crypto",
        "close_time": "2026-06-13T20:00:00Z",
    }
    candidate = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 70,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 30,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "BTC": {
                "asset": "BTC",
                "spot_usd": 120000.0,
                "annualized_volatility": 0.55,
                "provider": "fixture",
                "observed_at_utc": "2026-05-13T12:00:00Z",
                "source_url": "fixture://btc",
            }
        },
        now=now,
        max_hours=1000,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )[0]
    target = {
        "selector_key": "crypto|BTC|crypto_price_threshold|yes",
        "selector_rule_id": "segment:crypto|BTC|crypto_price_threshold|yes:inverse_selected_side",
        "selector_rank": 1,
        "selected_policy": "inverse_selected_side",
        "candidate_side_transform": "invert_current_candidate_side",
        "test_accuracy": 0.86,
        "test_pnl_usd": 3.83,
        "test_trade_count": 36,
        "target_forward_outcomes": 100,
        "fresh_forward_outcomes_collected": 100,
        "fresh_forward_outcomes_needed": 0,
        "fresh_forward_accuracy": 0.73,
        "fresh_forward_pnl_usd": 4.2,
        "fresh_forward_proof_passed": True,
        "forward_proof_epoch_start_utc": "2026-05-22T05:00:00Z",
        "forward_proof_epoch_source": "walk_forward_test_window_end",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    probe = crypto._profit_selector_shadow_candidate(candidate, target)
    assert probe is not None
    assert probe["strategy_bucket"] == "weather_crypto_profit_selector_forward_probe"
    assert probe["fair_value_source_type"] == "train_only_profit_selector"
    assert probe["selective_ml_promotion_stage"] == "tiny_accepted_forward_paper"
    probe["rapid_learning_max_hours"] = 100000.0
    probe["clean_evidence"] = {"max_hours": 100000.0}
    routed = crypto._force_profit_selector_shadow_route(router.apply_governor_route(probe, {}))
    assert routed["strategy_governor_action"] == "ACCEPT_FORWARD_PAPER"
    assert not routed["decision"].startswith("SHADOW_")
    assert routed["evidence_tier"] == "forward_paper"
    assert routed["simulated_size_usd"] == 1.0
    assert routed["proof_metrics_exclude_exploration"] is False
    _assert_no_live_true(routed)


def test_weather_profit_selector_shadow_candidate_inverts_ranked_target_side():
    generator = load_module("kalshi_weather_profit_selector_shadow", ROOT / "kalshi_weather_paper_candidates.py")
    router = load_module("kalshi_weather_profit_selector_shadow_router", ROOT / "kalshi_auto_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26JUN10-B76",
        "title": "Will the high temperature in Chicago be above 76 on June 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-06-11T04:00:00Z",
        "updated_time": "2026-06-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 54,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-06-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-06-10T00:00:00Z",
                        "source_run_key": "2026-06-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-06-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 6, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=-2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["selective_ml_segment_key"] == "weather|CHICAGO|high_temperature|above|yes"
    target = {
        "target_type": "profit_selector_forward_target",
        "selector_key": "weather|CHICAGO|high_temperature|above|yes",
        "segment_key": "weather|CHICAGO|high_temperature|above|yes",
        "selector_rule_id": "segment:weather|CHICAGO|high_temperature|above|yes:inverse_selected_side",
        "selector_rank": 1,
        "selected_policy": "inverse_selected_side",
        "candidate_side_transform": "invert_current_candidate_side",
        "test_accuracy": 0.72,
        "test_pnl_usd": 1.23,
        "test_trade_count": 9,
        "target_forward_outcomes": 100,
        "fresh_forward_outcomes_collected": 3,
        "fresh_forward_outcomes_needed": 100,
        "fresh_forward_accuracy": 0.67,
        "fresh_forward_pnl_usd": 0.9,
        "forward_proof_epoch_start_utc": "2026-05-22T05:00:00Z",
        "forward_proof_epoch_source": "walk_forward_test_window_end",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    shadow = generator._profit_selector_shadow_candidate(candidate, target)
    assert shadow is not None
    assert shadow["strategy_bucket"] == "weather_crypto_profit_selector_forward_shadow"
    assert shadow["selected_executable_side"] == "NO"
    assert shadow["paper_fill_price_cents"] == 48
    assert shadow["simulated_size_usd"] == 0.0
    assert shadow["shadow_learning_outcome"] is True
    assert shadow["profit_selector_forward_shadow"]["source_selector_key"] == "weather|CHICAGO|high_temperature|above|yes"
    assert shadow["profit_selector_forward_shadow"]["selector_shadow_side"] == "NO"
    assert shadow["profit_selector_forward_shadow"]["fresh_forward_outcomes_collected"] == 3
    assert shadow["profit_selector_forward_shadow"]["forward_proof_epoch_start_utc"] == "2026-05-22T05:00:00Z"
    assert shadow["selective_ml_segment_key"] == "weather|CHICAGO|high_temperature|above|no"
    routed = generator._force_profit_selector_shadow_route(router.apply_governor_route(shadow, {}))
    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["evidence_tier"] == "shadow"
    assert routed["proof_metrics_exclude_shadow"] is True
    _assert_no_live_true(routed)


def test_weather_profit_selector_fresh_proof_opens_tiny_forward_paper_probe():
    generator = load_module("kalshi_weather_profit_selector_forward_probe", ROOT / "kalshi_weather_paper_candidates.py")
    router = load_module("kalshi_weather_profit_selector_forward_probe_router", ROOT / "kalshi_auto_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26JUN10-B76",
        "title": "Will the high temperature in Chicago be above 76 on June 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-06-11T04:00:00Z",
        "updated_time": "2026-06-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 54,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-06-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-06-10T00:00:00Z",
                        "source_run_key": "2026-06-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-06-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 6, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=-2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    target = {
        "target_type": "profit_selector_forward_target",
        "selector_key": "weather|CHICAGO|high_temperature|above|yes",
        "segment_key": "weather|CHICAGO|high_temperature|above|yes",
        "selector_rule_id": "segment:weather|CHICAGO|high_temperature|above|yes:inverse_selected_side",
        "selector_rank": 1,
        "selected_policy": "inverse_selected_side",
        "candidate_side_transform": "invert_current_candidate_side",
        "test_accuracy": 0.72,
        "test_pnl_usd": 1.23,
        "test_trade_count": 9,
        "target_forward_outcomes": 100,
        "fresh_forward_outcomes_collected": 100,
        "fresh_forward_outcomes_needed": 0,
        "fresh_forward_accuracy": 0.68,
        "fresh_forward_pnl_usd": 3.7,
        "fresh_forward_proof_passed": True,
        "forward_proof_epoch_start_utc": "2026-05-22T05:00:00Z",
        "forward_proof_epoch_source": "walk_forward_test_window_end",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    probe = generator._profit_selector_shadow_candidate(candidate, target)
    assert probe is not None
    assert probe["strategy_bucket"] == "weather_crypto_profit_selector_forward_probe"
    assert probe["fair_value_source_type"] == "train_only_profit_selector"
    assert probe["selective_ml_promotion_stage"] == "tiny_accepted_forward_paper"
    probe["rapid_learning_max_hours"] = 100000.0
    probe["clean_evidence"] = {"max_hours": 100000.0}
    routed = generator._force_profit_selector_shadow_route(router.apply_governor_route(probe, {}))
    assert routed["strategy_governor_action"] == "ACCEPT_FORWARD_PAPER"
    assert routed["evidence_tier"] == "forward_paper"
    assert routed["simulated_size_usd"] == 1.0
    assert routed["proof_metrics_exclude_exploration"] is False
    _assert_no_live_true(routed)


def test_weather_live_search_accepts_high_low_titles_without_temperature_word():
    generator = load_module("kalshi_weather_live_search_temperature_titles", ROOT / "kalshi_weather_paper_candidates.py")
    high_market = {
        "ticker": "KXHIGHCHI-26MAY10-B76",
        "title": "Will Chicago's high be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
    }
    low_market = {
        "ticker": "KXLOWTHOU-26MAY10-B74",
        "title": "Will the low in Houston be below 74 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T05:00:00Z",
    }

    high_spec = generator.parse_weather_market(high_market)
    low_spec = generator.parse_weather_market(low_market)

    assert high_spec is not None
    assert high_spec.market_type == "high_temperature"
    assert low_spec is not None
    assert low_spec.market_type == "low_temperature"
    assert generator._matches_search(high_market, "temperature") is True
    assert generator._matches_search(low_market, "temperature") is True
    assert generator._matches_search(high_market, "weather") is True
    assert generator._matches_search(low_market, "weather") is True


def test_weather_target_shadow_refresh_uses_time_bucketed_dedupe_key():
    generator = load_module("kalshi_weather_target_shadow_bucket", ROOT / "kalshi_weather_paper_candidates.py")
    record = {
        "strategy_bucket": "weather_model_fast_evidence",
        "current_epoch_id": "epoch-test",
        "market_ticker": "KXLOWTHOU-26MAY25-B76",
        "expected_result_known_time_utc": "2026-05-26T05:00:00Z",
        "selected_executable_side": "YES",
        "evidence_tier": "shadow",
        "simulated_size_usd": 0.0,
        "live_order_allowed": False,
    }
    target = {
        "target_type": "ml_frontier_active_learning_target",
        "segment_key": "weather|HOUSTON|low_temperature|below|yes",
        "priority": 2,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    bucketed = generator._apply_target_shadow_refresh_bucket(
        record,
        target,
        now=generator.datetime(2026, 5, 25, 3, 37, tzinfo=generator.timezone.utc),
        bucket_minutes=60,
    )

    assert bucketed["paper_candidate_dedupe_variant"] == "weather_target_shadow_refresh_bucket"
    assert bucketed["paper_observation_bucket_utc"] == "2026-05-25T03:00:00Z"
    assert bucketed["simulated_size_usd"] == 0.0
    assert bucketed["proof_metrics_exclude_shadow"] is True
    assert bucketed["shadow_learning_outcome"] is True
    assert generator._dedupe_key(record) == (
        "epoch-test",
        "KXLOWTHOU-26MAY25-B76",
        "2026-05-26T05:00:00Z",
        "YES",
    )
    assert generator._dedupe_key(bucketed) == (
        "epoch-test",
        "KXLOWTHOU-26MAY25-B76",
        "2026-05-26T05:00:00Z",
        "YES",
        "2026-05-25T03:00:00Z",
    )
    assert generator._dedupe_key(bucketed) not in generator._existing_keys([record], include_shadow=True)
    assert generator._dedupe_key(bucketed) in generator._existing_keys([bucketed], include_shadow=True)
    _assert_no_live_true(bucketed)


def test_weather_target_shadow_refresh_defaults_to_quarter_hour_buckets():
    generator = load_module("kalshi_weather_target_shadow_default_bucket", ROOT / "kalshi_weather_paper_candidates.py")

    assert generator.TARGET_SHADOW_REFRESH_BUCKET_MINUTES == 15
    assert generator.build_parser().parse_args([]).target_shadow_refresh_minutes == 15
    assert generator._target_shadow_refresh_bucket(
        generator.datetime(2026, 5, 25, 3, 37, tzinfo=generator.timezone.utc)
    ) == "2026-05-25T03:30:00Z"


def test_weather_frontier_shadow_candidate_uses_requested_segment_side():
    generator = load_module("kalshi_weather_frontier_shadow_side", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY10-B76",
        "title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 54,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-05-10T00:00:00Z",
                        "source_run_key": "2026-05-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-05-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=-2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["selected_executable_side"] == "YES"
    target = {
        "target_type": "ml_frontier_active_learning_target",
        "segment_key": "weather|CHICAGO|high_temperature|above|no",
        "action": "collect_segment_specific_shadow_labels",
        "labels_needed_to_shadow_qualified": 3,
        "unique_markets_needed_to_shadow_qualified": 2,
        "target_shadow_scored": 25,
        "target_shadow_unique_markets": 5,
        "shadow_accuracy": 0.8,
        "shadow_pnl_usd": 1.2,
        "shadow_brier_score": 0.1,
        "shadow_market_brier_score": 0.2,
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    shadow = generator._weather_frontier_shadow_candidate(candidate, target)

    assert shadow is not None
    assert shadow["strategy_bucket"] == "weather_ml_frontier_target_shadow"
    assert shadow["selected_executable_side"] == "NO"
    assert shadow["paper_fill_price_cents"] == 48
    assert shadow["simulated_size_usd"] == 0.0
    assert shadow["shadow_learning_outcome"] is True
    assert shadow["weather_ml_frontier_shadow"]["target_segment_key"] == "weather|CHICAGO|high_temperature|above|no"
    assert shadow["weather_ml_frontier_shadow"]["frontier_shadow_side"] == "NO"
    assert shadow["selective_ml_segment_key"] == "weather|CHICAGO|high_temperature|above|no"
    _assert_no_live_true(shadow)


def test_weather_target_shadow_extended_horizon_only_creates_zero_exposure_shadow(tmp_path):
    generator = load_module("kalshi_weather_target_shadow_extended_horizon", ROOT / "kalshi_weather_paper_candidates.py")
    args = generator.build_parser().parse_args(
        [
            "--max-hours",
            "24",
            "--target-shadow-max-hours",
            "168",
            "--max-new",
            "3",
            "--max-orderbooks",
            "3",
            "--decisions-log",
            str(tmp_path / "paper_decisions.jsonl"),
            "--runs-log",
            str(tmp_path / "weather_runs.jsonl"),
            "--state-path",
            str(tmp_path / "paper_strategy_state.json"),
            "--freshness-path",
            str(tmp_path / "weather_source_freshness.json"),
            "--readiness-path",
            str(tmp_path / "weather_crypto_ml_readiness.json"),
            "--accelerator-path",
            str(tmp_path / "weather_crypto_learning_accelerator.json"),
            "--weather-markets-log",
            str(tmp_path / "weather_markets.jsonl"),
        ]
    )
    now = datetime.now(timezone.utc)
    target_day = (now + timedelta(days=3)).date()
    target_date = target_day.isoformat()
    title_date = f"{target_day:%B} {target_day.day}, {target_day.year}"
    market = {
        "ticker": "KXLOWTHOU-EXTENDED-T76",
        "title": f"Will the low temperature in Houston be below 76 on {title_date}?",
        "city": "HOUSTON",
        "station": "KIAH",
        "target_date": target_date,
        "market_type": "low_temperature",
        "direction": "below",
        "strike_f": 76.0,
        "status": "active",
        "expected_expiration_time": (now + timedelta(hours=72)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "updated_time": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "raw_market": {"series_ticker": "KXLOWTHOU"},
    }
    (tmp_path / "weather_source_freshness.json").write_text(
        json.dumps(
            {
                "ok": True,
                "cities": {
                    "HOUSTON": {
                        "target_date": target_date,
                        "station": "KIAH",
                        "sources": {
                            "open_meteo_forecast": {
                                "fetched_at_utc": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                                "source_run_key": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                                "source_hash": "source-hash",
                                "summary": {
                                    "date": target_date,
                                    "temperature_2m_max_f": 90.0,
                                    "temperature_2m_min_f": 70.0,
                                    "precipitation_sum_in": 0.0,
                                },
                            }
                        },
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "weather_crypto_ml_readiness.json").write_text(
        json.dumps(
            {
                "ok": True,
                "data": {
                    "active_learning_queue": [
                        {
                            "action": "collect_segment_specific_shadow_labels",
                            "domain": "weather",
                            "segment_key": "weather|HOUSTON|low_temperature|below|yes",
                            "priority": 2,
                            "labels_needed_to_shadow_qualified": 24,
                            "shadow_scored": 1,
                            "shadow_unique_market_count": 1,
                            "target_shadow_scored": 25,
                            "target_shadow_unique_markets": 5,
                            "live_order_allowed": False,
                            "auto_live_promotion_allowed": False,
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "weather_crypto_learning_accelerator.json").write_text(json.dumps({"ok": True, "data": {}}), encoding="utf-8")
    (tmp_path / "paper_strategy_state.json").write_text(json.dumps({"ok": True}), encoding="utf-8")
    (tmp_path / "weather_markets.jsonl").write_text(json.dumps({"timestamp_utc": now.isoformat().replace("+00:00", "Z"), "markets": []}) + "\n", encoding="utf-8")
    generator.LOCK_PATH = tmp_path / "weather.lock"
    generator._fetch_current_weather_series_markets = lambda _args, _targets=None: ([market], [], {"market_source": "fixture", "available": True})
    generator._live_search_required_by_series_quality = lambda *_args, **_kwargs: (False, "fixture_not_needed", {"checked_market_count": 1})
    generator.kalshi_orderbook.normalize_orderbook = lambda _raw: {
        "best_yes_ask_cents": 40,
        "best_yes_ask_size_contracts": 25,
        "best_no_ask_cents": 62,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    generator.kalshi_get = lambda _path, _params=None: {"ok": True, "data": {}}

    result = generator.generate(args)

    assert result["created_count"] == 1
    assert result["target_shadow_extended_window_market_count"] == 1
    assert result["target_shadow_extended_window_candidate_count"] == 1
    assert result["target_shadow_extended_window_created_count"] == 1
    created = result["created"][0]
    assert created["strategy_bucket"] == "weather_ml_frontier_target_shadow"
    assert created["paper_target_shadow_extended_horizon"] is True
    assert created["paper_target_shadow_base_max_hours"] == 24.0
    assert created["paper_target_shadow_max_hours"] == 168.0
    assert created["strategy_governor_action"] == "SHADOW_ONLY"
    assert created["simulated_size_usd"] == 0.0
    assert created["proof_metrics_exclude_shadow"] is True
    assert created["shadow_learning_outcome"] is True
    assert created["weather_ml_frontier_shadow"]["target_segment_key"] == "weather|HOUSTON|low_temperature|below|yes"
    assert all(record["simulated_size_usd"] == 0.0 for record in result["created"])
    _assert_no_live_true(result)


def test_crypto_candidates_derive_series_ticker_for_reality_contract():
    crypto = load_module("kalshi_crypto_series_contract", ROOT / "kalshi_crypto_evidence.py")
    ml = load_module("kalshi_crypto_series_contract_ml", ROOT / "kalshi_weather_crypto_ml.py")
    now = datetime(2026, 5, 13, 12, tzinfo=timezone.utc)
    market = {
        "ticker": "KXBTC15M-26MAY131215-00",
        "title": "BTC price up in next 15 mins?",
        "yes_sub_title": "Target Price: $100,000.00",
        "no_sub_title": "Target price: TBD",
        "category": "crypto",
        "status": "active",
        "open_time": "2026-05-13T12:00:00Z",
        "close_time": "2026-05-13T12:15:00Z",
        "expected_expiration_time": "2026-05-13T12:20:00Z",
        "rules_primary": "If the crypto reference price is at least the target price, then the market resolves to Yes.",
    }

    assert crypto._series_ticker_from_market(market) == "KXBTC15M"

    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 70,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 30,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "BTC": {
                "asset": "BTC",
                "spot_usd": 120000.0,
                "annualized_volatility": 0.55,
                "provider": "fixture",
                "observed_at_utc": "2026-05-13T12:00:00Z",
                "source_url": "fixture://btc",
            }
        },
        now=now,
        max_hours=24,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["series_ticker"] == "KXBTC15M"
    assert candidate["crypto_evidence"]["series_ticker"] == "KXBTC15M"
    contract = ml.build_reality_contract(candidate)
    assert "missing_series_ticker" not in contract["blockers"]
    assert contract["pre_trade_passed"] is True
    assert candidate["live_order_allowed"] is False


def test_crypto_model_quality_gate_keeps_noisy_threshold_signal_shadow_only():
    crypto = load_module("kalshi_crypto_quality_gate", ROOT / "kalshi_crypto_evidence.py")
    router = load_module("kalshi_auto_crypto_quality_gate", ROOT / "kalshi_auto_paper_candidates.py")
    now = datetime(2026, 5, 13, 12, tzinfo=timezone.utc)
    market = {
        "ticker": "KXBTC15M-26MAY131215-00",
        "title": "BTC price up in next 15 mins?",
        "yes_sub_title": "Target Price: $100,000.00",
        "no_sub_title": "Target price: TBD",
        "category": "crypto",
        "status": "active",
        "open_time": "2026-05-13T12:00:00Z",
        "close_time": "2026-05-13T12:15:00Z",
        "expected_expiration_time": "2026-05-13T12:20:00Z",
        "rules_primary": "If the crypto reference price is at least the target price, then the market resolves to Yes.",
    }
    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 40,
                "best_yes_ask_size_contracts": 100,
                "best_no_ask_cents": 60,
                "best_no_ask_size_contracts": 100,
                "yes_spread_cents": 1,
                "no_spread_cents": 1,
                "is_crossed": False,
            }
        },
        {
            "BTC": {
                "asset": "BTC",
                "spot_usd": 100001.0,
                "annualized_volatility": 0.55,
                "provider": "fixture",
                "observed_at_utc": "2026-05-13T12:00:00Z",
                "source_url": "fixture://btc",
            }
        },
        now=now,
        max_hours=24,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["quality_gates"]["crypto_model_quality_passed"] is False
    assert "crypto_source_basis_risk_too_close_to_threshold" in candidate["quality_gates"]["crypto_model_quality_blockers"]
    routed = router.apply_governor_route(candidate, {})
    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["evidence_tier"] == "shadow"
    assert routed["simulated_size_usd"] == 0.0
    assert routed["live_order_allowed"] is False


def test_crypto_parser_detects_and_prices_multileg_crypto_bundle():
    crypto = load_module("kalshi_crypto_multileg_model", ROOT / "kalshi_crypto_evidence.py")
    now = datetime(2026, 5, 17, 18, tzinfo=timezone.utc)
    market = {
        "ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S20268B3085ECF13-38DADC8356C",
        "title": "no Target Price: $100,000.00,yes Target Price: $0.1000,yes Target Price: $2,000.00",
        "category": "Multi-Variate Events",
        "expected_expiration_time": "2026-05-17T18:35:00Z",
        "custom_strike": {
            "Associated Events": "KXBTC15M-26MAY171430,KXDOGE15M-26MAY171430,KXETH15M-26MAY171430",
            "Associated Market Sides": "no,yes,yes",
            "Associated Markets": "KXBTC15M-26MAY171430-30,KXDOGE15M-26MAY171430-30,KXETH15M-26MAY171430-30",
        },
    }

    assert crypto.detect_assets(market) == ["BTC", "ETH", "DOGE"]
    assert crypto.is_multileg_crypto_market(market) is True
    assert crypto.crypto_parse_blocker(market, now=now, max_hours=24) is None
    parsed = crypto.parse_crypto_market(market, now=now, max_hours=24)
    assert parsed["market_type"] == "crypto_multileg_target"
    assert parsed["assets"] == ["BTC", "DOGE", "ETH"]
    model = crypto.fair_multileg_probability(
        parsed,
        {
            "BTC": {"asset": "BTC", "spot_usd": 90000.0, "annualized_volatility": 0.55},
            "DOGE": {"asset": "DOGE", "spot_usd": 0.15, "annualized_volatility": 1.2},
            "ETH": {"asset": "ETH", "spot_usd": 2500.0, "annualized_volatility": 0.75},
        },
    )
    assert model["fair_yes_probability"] > 0.65
    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 55,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 45,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "BTC": {
                "asset": "BTC",
                "spot_usd": 90000.0,
                "annualized_volatility": 0.55,
                "provider": "fixture",
                "observed_at_utc": "2026-05-17T18:00:00Z",
                "source_url": "fixture://btc",
            },
            "DOGE": {
                "asset": "DOGE",
                "spot_usd": 0.15,
                "annualized_volatility": 1.2,
                "provider": "fixture",
                "observed_at_utc": "2026-05-17T18:00:00Z",
                "source_url": "fixture://doge",
            },
            "ETH": {
                "asset": "ETH",
                "spot_usd": 2500.0,
                "annualized_volatility": 0.75,
                "provider": "fixture",
                "observed_at_utc": "2026-05-17T18:00:00Z",
                "source_url": "fixture://eth",
            },
        },
        now=now,
        max_hours=24,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )
    assert len(candidates) == 1
    assert candidates[0]["strategy_bucket"] == "crypto_multileg_spot_model"
    assert candidates[0]["decision"] == "PAPER_EXPLORE_BUY_YES"
    assert candidates[0]["crypto_evidence"]["multileg_model"]["leg_probabilities"]
    assert candidates[0]["crypto_model_confidence_score"] >= 0.30
    assert candidates[0]["quality_gates"]["crypto_model_quality_passed"] is True
    assert candidates[0]["live_order_allowed"] is False


def test_crypto_parser_blocks_malformed_multileg_bundle():
    crypto = load_module("kalshi_crypto_multileg_malformed", ROOT / "kalshi_crypto_evidence.py")
    market = {
        "ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S20268B3085ECF13-BAD",
        "title": "no Target Price: $100,000.00,yes Target Price: $0.1000,yes Target Price: $2,000.00",
        "expected_expiration_time": "2026-05-17T18:35:00Z",
        "custom_strike": {
            "Associated Events": "KXBTC15M-26MAY171430,KXDOGE15M-26MAY171430",
            "Associated Market Sides": "no,yes",
            "Associated Markets": "KXBTC15M-26MAY171430-30,KXDOGE15M-26MAY171430-30",
        },
    }

    assert (
        crypto.crypto_parse_blocker(
            market,
            now=datetime(2026, 5, 17, 18, tzinfo=timezone.utc),
            max_hours=24,
        )
        == "crypto_multileg_leg_count_mismatch"
    )


def test_crypto_parser_labels_target_tbd_as_not_trade_ready():
    crypto = load_module("kalshi_crypto_target_tbd", ROOT / "kalshi_crypto_evidence.py")
    market = {
        "ticker": "KXBTC15M-26MAY180000-00",
        "event_ticker": "KXBTC15M-26MAY180000",
        "series_ticker": "KXBTC15M",
        "title": "BTC price up in next 15 mins?",
        "yes_sub_title": "Target price: TBD",
        "no_sub_title": "Target price: TBD",
        "status": "initialized",
        "open_time": "2026-05-18T03:45:00Z",
        "close_time": "2026-05-18T04:00:00Z",
        "expected_expiration_time": "2026-05-18T04:05:00Z",
    }

    assert (
        crypto.crypto_parse_blocker(
            market,
            now=datetime(2026, 5, 17, 19, 45, tzinfo=timezone.utc),
            max_hours=24,
        )
        == "crypto_market_not_trade_ready_target_tbd"
    )
    assert (
        crypto._next_trade_ready_check_time(
            [market],
            datetime(2026, 5, 17, 19, 45, tzinfo=timezone.utc),
        )
        == "2026-05-18T03:45:00Z"
    )


def test_crypto_parser_accepts_active_market_when_numeric_target_overrides_tbd_subtitle():
    crypto = load_module("kalshi_crypto_active_numeric_target", ROOT / "kalshi_crypto_evidence.py")
    market = {
        "ticker": "KXBTC15M-26MAY181200-00",
        "event_ticker": "KXBTC15M-26MAY181200",
        "series_ticker": "KXBTC15M",
        "title": "BTC price up in next 15 mins?",
        "yes_sub_title": "Target Price: $76,284.64",
        "no_sub_title": "Target price: TBD",
        "rules_primary": (
            "If the simple average of the sixty seconds of CF Benchmarks' BRTI before "
            "12:00 PM EDT on May 18, 2026 is at least the simple average of the sixty "
            "seconds of CF Benchmarks' BRTI before 11:45 AM EDT on May 18, 2026, then "
            "the market resolves to Yes."
        ),
        "status": "active",
        "open_time": "2026-05-18T15:45:00Z",
        "close_time": "2026-05-18T16:00:00Z",
        "expected_expiration_time": "2026-05-18T16:05:00Z",
    }

    now = datetime(2026, 5, 18, 15, 50, tzinfo=timezone.utc)
    assert crypto.crypto_parse_blocker(market, now=now, max_hours=24) is None
    parsed = crypto.parse_crypto_market(market, now=now, max_hours=24)
    assert parsed["asset"] == "BTC"
    assert parsed["threshold_usd"] == 76284.64
    assert parsed["yes_direction"] == "above"
    assert parsed["expected_result_known_time_utc"] == "2026-05-18T16:05:00Z"


def test_crypto_parser_rejects_markets_after_trade_close_even_before_result_known():
    crypto = load_module("kalshi_crypto_closed_before_result", ROOT / "kalshi_crypto_evidence.py")
    market = {
        "ticker": "KXBTC15M-26MAY181200-00",
        "event_ticker": "KXBTC15M-26MAY181200",
        "series_ticker": "KXBTC15M",
        "title": "BTC price up in next 15 mins?",
        "yes_sub_title": "Target Price: $76,284.64",
        "no_sub_title": "Target price: TBD",
        "rules_primary": "If BTC is at least the prior 15-minute value, then the market resolves to Yes.",
        "status": "active",
        "open_time": "2026-05-18T15:45:00Z",
        "close_time": "2026-05-18T16:00:00Z",
        "expected_expiration_time": "2026-05-18T16:05:00Z",
    }

    assert (
        crypto.crypto_parse_blocker(
            market,
            now=datetime(2026, 5, 18, 16, 0, 1, tzinfo=timezone.utc),
            max_hours=24,
        )
        == "crypto_trade_close_already_passed"
    )


def test_crypto_asset_detection_uses_token_boundaries():
    crypto = load_module("kalshi_crypto_asset_boundaries", ROOT / "kalshi_crypto_evidence.py")
    market = {
        "ticker": "KXWEATHER-TEST",
        "title": "Will the weather resolution be settled today?",
        "category": "weather",
        "rules_primary": "The result is based on settlement data.",
    }

    assert crypto.detect_assets(market) == []


def test_weather_crypto_reality_contract_quarantines_incomplete_weather_record():
    ml = load_module("kalshi_weather_crypto_ml_contract", ROOT / "kalshi_weather_crypto_ml.py")
    contract = ml.build_reality_contract(
        {
            "decision_id": "weather-bad-1",
            "timestamp_utc": "2026-05-21T12:00:00Z",
            "market_ticker": "KXHIGHTEMP-26MAY21SEA-T75",
            "market_category": "weather",
            "fair_value_source_type": "weather_model",
            "selected_executable_side": "YES",
            "paper_fill_price_cents": 40,
            "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
            "weather_city": "SEATTLE",
            "weather_market_type": "high_temperature",
            "weather_threshold": 75,
            "weather_direction": "above",
            "forecast_value": 78,
            "live_order_allowed": False,
        },
        {
            "decision_id": "weather-bad-1",
            "resolved": True,
            "outcome_yes": 1,
            "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
            "settlement_source": "fixture",
        },
    )

    assert contract["pre_trade_passed"] is False
    assert contract["training_eligible"] is False
    assert "missing_weather_target_date" in contract["blockers"]
    assert "missing_source_fetched_at_utc" in contract["blockers"]
    assert contract["live_order_allowed"] is False


def test_weather_crypto_ml_excludes_no_fill_rejects_from_repair_quarantine():
    ml = load_module("kalshi_weather_crypto_ml_no_fill_observation", ROOT / "kalshi_weather_crypto_ml.py")
    record = {
        "decision_id": "weather-no-fill-1",
        "timestamp_utc": "2026-05-04T02:01:49Z",
        "decision": "REJECT",
        "market_ticker": "KXTEMPNYCH-26MAY0400-T46.99",
        "market_title": "Will the temp in New York City be above 46.99° on May 4, 2026 at 12am EDT?",
        "market_category": "weather:NEW YORK:temperature",
        "fair_value_source_type": "weather_model",
        "paper_fill_price_cents": None,
        "market_price_cents": None,
        "simulated_size_usd": 0.0,
        "live_order_allowed": False,
    }
    contract = ml.build_reality_contract(
        record,
        {
            "decision_id": "weather-no-fill-1",
            "resolved": True,
            "outcome_yes": 1,
            "settlement_checked_at_utc": "2026-05-04T04:05:00Z",
            "settlement_source": "fixture",
        },
    )

    assert contract["training_eligible"] is False
    assert ml._is_no_fill_observation_only(record, contract) is True


def test_weather_crypto_ml_repair_queue_ignores_excluded_no_fill_observations():
    ml = load_module("kalshi_weather_crypto_ml_no_fill_queue", ROOT / "kalshi_weather_crypto_ml.py")

    queue = ml._active_learning_queue(
        [],
        {
            "weather": {
                "decisions": 100,
                "scored": 10,
                "shadow_scored": 10,
                "accepted_scored": 0,
                "quarantined": 20,
                "excluded_no_fill_observations": 80,
            }
        },
        {
            "passed_pre_trade": 0,
            "failed_pre_trade": 100,
            "training_eligible": 10,
            "quarantined_training": 20,
            "excluded_no_fill_observations": 80,
        },
    )

    assert not any(item.get("action") == "repair_reality_contract_fields" for item in queue)


def test_weather_crypto_ml_dataset_builds_canonical_leakage_free_rows():
    dataset = load_module("kalshi_weather_crypto_ml_dataset_builder", ROOT / "kalshi_weather_crypto_ml_dataset.py")
    weather_decision = {
        "decision_id": "weather-row-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXHIGHTEMP-26MAY21SEA-T70",
        "market_category": "weather",
        "strategy_bucket": "weather_model_fast_evidence",
        "fair_value_source_type": "weather_model",
        "selected_executable_side": "NO",
        "side": "NO",
        "paper_fill_price_cents": 5,
        "market_price_cents": 5,
        "selected_side_fair_probability": 0.99,
        "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
        "weather_city": "SEATTLE",
        "weather_station": "KSEA",
        "weather_target_date": "2026-05-21",
        "weather_market_type": "temperature",
        "weather_threshold": 70,
        "weather_direction": "above",
        "forecast_value": 60,
        "source_fetched_at_utc": "2026-05-21T11:58:00Z",
        "source_hash": "weather-source-1",
        "live_order_allowed": False,
    }
    crypto_decision = {
        "decision_id": "crypto-row-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "market_category": "crypto",
        "series_ticker": "KXBTC15M",
        "strategy_bucket": "crypto_spot_model",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "selected_executable_side": "YES",
        "side": "YES",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "selected_side_fair_probability": 0.75,
        "expected_result_known_time_utc": "2026-05-21T12:20:00Z",
        "source_observed_at_utc": "2026-05-21T11:59:30Z",
        "crypto_evidence": {
            "asset": "BTC",
            "series_ticker": "KXBTC15M",
            "market_type": "crypto_price_threshold",
            "threshold_usd": 100000,
            "spot_usd": 101000,
            "spot_provider": "fixture",
            "spot_observed_at_utc": "2026-05-21T11:59:30Z",
            "annualized_volatility": 0.55,
            "crypto_model_diagnostics": {
                "spot_threshold_distance_bps": 100.0,
                "signal_to_noise_ratio": 0.8,
            },
        },
        "external_reference": {
            "provider": "fixture",
            "source_url": "fixture://btc",
            "observed_at_utc": "2026-05-21T11:59:30Z",
        },
        "markov_microstructure": {
            "generated_at_utc": "2026-05-21T11:59:40Z",
            "feature_cutoff_utc": "2026-05-21T11:59:40Z",
            "research_only": True,
            "not_trade_signal": True,
            "market_price": 0.4,
            "current_yes_price": 0.4,
            "raw_markov_yes_proxy": 0.56,
            "calibrated_probability": 0.54,
            "edge_vs_market_pct": 14.0,
            "confidence_score": 6.0,
            "current_bucket": 4,
            "routing_label": "TINY_PAPER_REVIEW_ONLY",
            "sample": {
                "data_source": "kalshi_candlesticks",
                "history_points": 40,
                "total_transitions": 39,
                "current_row_transitions": 22,
            },
            "execution": {
                "estimated_yes_spread_cents": 2,
                "depth_contracts": 45,
                "yes_maker_edge_pct": 3.0,
                "yes_taker_edge_pct": -1.0,
                "no_maker_edge_pct": -2.0,
                "no_taker_edge_pct": -5.0,
            },
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        },
        "live_order_allowed": False,
    }

    payload, rows = dataset.build_dataset(
        [weather_decision, crypto_decision],
        [
            {
                "decision_id": "weather-row-1",
                "resolved": True,
                "outcome_yes": 0,
                "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
                "settlement_source": "fixture",
            }
        ],
        [
            {
                "decision_id": "crypto-row-1",
                "resolved": True,
                "outcome_yes": 1,
                "settlement_checked_at_utc": "2026-05-21T12:25:00Z",
                "settlement_source": "fixture",
                "shadow_learning_outcome": True,
            }
        ],
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert payload["ok"] is True
    assert payload["row_count"] == 2
    assert payload["leakage_rejected_count"] == 0
    assert payload["dataset_id"]
    assert payload["live_order_allowed"] is False
    assert {row["domain"] for row in rows} == {"weather", "crypto"}
    assert all(row["dataset_id"] == payload["dataset_id"] for row in rows)
    assert all(row["feature_hash"] and row["label_hash"] and row["row_hash"] for row in rows)
    assert all(row["live_order_allowed"] is False for row in rows)
    by_domain = {row["domain"]: row for row in rows}
    assert by_domain["weather"]["features"]["forecast_threshold_delta"] == -10
    assert by_domain["crypto"]["features"]["series_ticker"] == "KXBTC15M"
    assert by_domain["crypto"]["features"]["markov_feature_present"] == 1
    assert by_domain["crypto"]["features"]["markov_calibrated_probability"] == 0.54
    assert by_domain["crypto"]["features"]["markov_selected_side_maker_edge_pct"] == 3.0
    assert by_domain["crypto"]["features"]["markov_taker_trap_flag"] == 1
    assert by_domain["crypto"]["features"]["markov_official_history_flag"] == 1
    assert by_domain["crypto"]["features"]["markov_live_order_allowed"] is False
    assert by_domain["crypto"]["label"]["label_quality"] == "shadow_source_backed"


def test_weather_crypto_ml_dataset_infers_legacy_crypto_series_ticker():
    dataset = load_module("kalshi_weather_crypto_ml_dataset_legacy_crypto_series", ROOT / "kalshi_weather_crypto_ml_dataset.py")
    decision = {
        "decision_id": "crypto-legacy-row-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXXRP15M-26MAY211200-00",
        "market_category": "crypto",
        "strategy_bucket": "crypto_spot_model",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "selected_executable_side": "YES",
        "side": "YES",
        "paper_fill_price_cents": 42,
        "market_price_cents": 42,
        "selected_side_fair_probability": 0.74,
        "expected_result_known_time_utc": "2026-05-21T12:20:00Z",
        "crypto_evidence": {
            "asset": "XRP",
            "market_type": "crypto_price_threshold",
            "threshold_usd": 2.25,
            "spot_usd": 2.31,
            "spot_provider": "fixture",
            "spot_observed_at_utc": "2026-05-21T11:59:30Z",
            "annualized_volatility": 1.05,
            "crypto_model_diagnostics": {
                "spot_threshold_distance_bps": 266.6667,
                "signal_to_noise_ratio": 1.1,
            },
        },
        "live_order_allowed": False,
    }

    contract = dataset.ml.build_reality_contract(
        decision,
        {
            "decision_id": "crypto-legacy-row-1",
            "resolved": True,
            "outcome_yes": 1,
            "settlement_checked_at_utc": "2026-05-21T12:25:00Z",
            "settlement_source": "fixture",
        },
    )
    payload, rows = dataset.build_dataset(
        [decision],
        [
            {
                "decision_id": "crypto-legacy-row-1",
                "resolved": True,
                "outcome_yes": 1,
                "settlement_checked_at_utc": "2026-05-21T12:25:00Z",
                "settlement_source": "fixture",
            }
        ],
        [],
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert "missing_series_ticker" not in contract["blockers"]
    assert contract["training_eligible"] is True
    assert contract["fields"]["series_ticker"] == "KXXRP15M"
    assert payload["row_count"] == 1
    assert rows[0]["features"]["series_ticker"] == "KXXRP15M"
    assert payload["rejection_counts"] == {}
    _assert_no_live_true({"payload": payload, "rows": rows, "contract": contract})


def test_weather_crypto_ml_dataset_rejects_future_feature_leakage():
    dataset = load_module("kalshi_weather_crypto_ml_dataset_leakage", ROOT / "kalshi_weather_crypto_ml_dataset.py")
    decision = {
        "decision_id": "weather-leak-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXHIGHTEMP-26MAY21SEA-T70",
        "market_category": "weather",
        "fair_value_source_type": "weather_model",
        "selected_executable_side": "NO",
        "paper_fill_price_cents": 5,
        "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
        "weather_city": "SEATTLE",
        "weather_target_date": "2026-05-21",
        "weather_market_type": "temperature",
        "weather_threshold": 70,
        "weather_direction": "above",
        "forecast_value": 60,
        "source_fetched_at_utc": "2026-05-21T12:01:00Z",
        "live_order_allowed": False,
    }
    payload, rows = dataset.build_dataset(
        [decision],
        [
            {
                "decision_id": "weather-leak-1",
                "resolved": True,
                "outcome_yes": 0,
                "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
                "settlement_source": "fixture",
            }
        ],
        [],
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert rows == []
    assert payload["row_count"] == 0
    assert payload["leakage_rejected_count"] == 1
    assert payload["rejection_counts"]["weather:feature_timestamp_after_decision:source_fetched_at_utc"] == 1
    assert payload["live_order_allowed"] is False


def test_weather_crypto_ml_dataset_rejects_future_markov_feature_timestamp():
    dataset = load_module("kalshi_weather_crypto_ml_dataset_markov_leakage", ROOT / "kalshi_weather_crypto_ml_dataset.py")
    decision = {
        "decision_id": "crypto-markov-leak-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "market_category": "crypto",
        "series_ticker": "KXBTC15M",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "selected_executable_side": "YES",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "selected_side_fair_probability": 0.75,
        "expected_result_known_time_utc": "2026-05-21T12:20:00Z",
        "source_observed_at_utc": "2026-05-21T11:59:30Z",
        "crypto_evidence": {
            "asset": "BTC",
            "series_ticker": "KXBTC15M",
            "market_type": "crypto_price_threshold",
            "threshold_usd": 100000,
            "spot_usd": 101000,
            "spot_observed_at_utc": "2026-05-21T11:59:30Z",
        },
        "markov_microstructure": {
            "feature_cutoff_utc": "2026-05-21T12:00:01Z",
            "calibrated_probability": 0.54,
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }
    payload, rows = dataset.build_dataset(
        [decision],
        [
            {
                "decision_id": "crypto-markov-leak-1",
                "resolved": True,
                "outcome_yes": 1,
                "settlement_checked_at_utc": "2026-05-21T12:25:00Z",
                "settlement_source": "fixture",
            }
        ],
        [],
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert rows == []
    assert payload["row_count"] == 0
    assert payload["leakage_rejected_count"] == 1
    assert payload["rejection_counts"]["crypto:feature_timestamp_after_decision:markov_microstructure.feature_cutoff_utc"] == 1
    assert payload["live_order_allowed"] is False


def test_markov_feature_join_attaches_only_past_decision_time_diagnostics():
    joiner = load_module("kalshi_markov_feature_join_test", ROOT / "kalshi_markov_feature_join.py")
    latest = {
        "generated_at_utc": "2026-05-21T11:59:40Z",
        "markets": [
            {
                "market_ticker": "KXBTC15M-26MAY211200-00",
                "category": "crypto",
                "market_price": 0.4,
                "raw_markov_yes_proxy": 0.56,
                "calibrated_probability": 0.54,
                "confidence_score": 6,
                "routing_label": "TINY_PAPER_REVIEW_ONLY",
                "sample": {"data_source": "kalshi_candlesticks", "current_row_transitions": 22},
                "execution": {"yes_maker_edge_pct": 3.0, "yes_taker_edge_pct": -1.0},
                "live_order_allowed": False,
            }
        ],
    }

    enriched = joiner.attach_markov_microstructure(
        {
            "market_ticker": "KXBTC15M-26MAY211200-00",
            "timestamp_utc": "2026-05-21T12:00:00Z",
            "live_order_allowed": False,
        },
        latest=latest,
    )
    assert enriched["markov_microstructure"]["feature_cutoff_utc"] == "2026-05-21T11:59:40Z"
    assert enriched["markov_microstructure"]["calibrated_probability"] == 0.54
    assert enriched["markov_microstructure"]["not_trade_signal"] is True
    assert enriched["markov_microstructure"]["live_order_allowed"] is False

    future_blocked = joiner.attach_markov_microstructure(
        {
            "market_ticker": "KXBTC15M-26MAY211200-00",
            "timestamp_utc": "2026-05-21T11:59:00Z",
            "live_order_allowed": False,
        },
        latest=latest,
    )
    assert "markov_microstructure" not in future_blocked


def test_markov_feature_join_exposes_category_priority_for_candidate_selection():
    joiner = load_module("kalshi_markov_feature_join_priority_test", ROOT / "kalshi_markov_feature_join.py")
    latest = {
        "markets": [
            {"market_ticker": "KXHIGHTEMP-26MAY21SEA-T70", "category": "weather"},
            {"market_ticker": "KXBTC15M-26MAY211200-00", "category": "crypto"},
        ]
    }

    assert joiner.markov_market_tickers(latest, category="weather") == {"KXHIGHTEMP-26MAY21SEA-T70"}
    assert joiner.markov_market_priority({"ticker": "KXHIGHTEMP-26MAY21SEA-T70"}, latest, category="weather") == 0
    assert joiner.markov_market_priority({"ticker": "KXBTC15M-26MAY211200-00"}, latest, category="weather") == 1


def test_markov_ml_coverage_counts_safe_pending_and_resolved_rows():
    coverage = load_module("kalshi_markov_ml_coverage_test", ROOT / "kalshi_markov_ml_coverage.py")
    decisions = [
        {
            "decision_id": "markov-resolved-1",
            "timestamp_utc": "2026-05-21T12:00:00Z",
            "market_ticker": "KXBTC15M-26MAY211200-00",
            "market_category": "crypto",
            "markov_microstructure": {
                "feature_cutoff_utc": "2026-05-21T11:59:40Z",
                "routing_label": "OBSERVE_ONLY",
                "not_trade_signal": True,
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
        {
            "decision_id": "markov-pending-1",
            "timestamp_utc": "2026-05-21T12:01:00Z",
            "market_ticker": "KXHIGHTEMP-26MAY21SEA-T70",
            "market_category": "weather",
            "expected_result_known_time_utc": "2026-05-22T06:00:00Z",
            "markov_microstructure": {
                "feature_cutoff_utc": "2026-05-21T12:00:30Z",
                "routing_label": "TINY_PAPER_REVIEW_ONLY",
                "not_trade_signal": True,
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
        {
            "decision_id": "markov-due-1",
            "timestamp_utc": "2026-05-21T12:02:00Z",
            "market_ticker": "KXETH15M-26MAY211200-00",
            "market_category": "crypto",
            "expected_result_known_time_utc": "2026-05-22T04:59:00Z",
            "markov_microstructure": {
                "feature_cutoff_utc": "2026-05-21T12:01:30Z",
                "routing_label": "OBSERVE_ONLY",
                "not_trade_signal": True,
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
        {
            "decision_id": "markov-unsafe-1",
            "timestamp_utc": "2026-05-21T12:01:00Z",
            "market_ticker": "KXETH15M-26MAY211200-00",
            "market_category": "crypto",
            "markov_microstructure": {
                "feature_cutoff_utc": "2026-05-21T12:01:01Z",
                "routing_label": "OBSERVE_ONLY",
                "not_trade_signal": True,
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
    ]

    payload = coverage.build_coverage(
        decisions,
        [{"decision_id": "markov-resolved-1", "resolved": True}],
        [],
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert payload["resolved_safe_markov_rows"] == 1
    assert payload["pending_safe_markov_rows"] == 2
    assert payload["due_safe_markov_rows"] == 1
    assert payload["next_safe_markov_result_known_time_utc"] == "2026-05-22T06:00:00Z"
    assert payload["due_examples"][0]["decision_id"] == "markov-due-1"
    assert payload["resolved_safe_markov_rows_needed"] == 74
    assert payload["domains"]["crypto"]["unsafe_or_future_markov_features"] == 1
    assert payload["routing_label_counts"]["OBSERVE_ONLY"] == 3
    assert payload["live_order_allowed"] is False


def test_weather_crypto_ml_readiness_includes_dataset_health():
    ml = load_module("kalshi_weather_crypto_ml_dataset_health", ROOT / "kalshi_weather_crypto_ml.py")
    payload = ml.build_readiness(
        [],
        [],
        [],
        generated_at_utc="2026-05-22T05:00:00Z",
        ml_dataset={
            "ok": True,
            "dataset_id": "dataset-1",
            "dataset_schema_version": "weather-crypto-ml-dataset-v1",
            "feature_schema_version": "weather-crypto-selective-v1",
            "label_schema_version": "weather-crypto-label-v1",
            "row_count": 2,
            "leakage_rejected_count": 0,
            "live_order_allowed": False,
        },
    )

    assert payload["ml_dataset"]["ok"] is True
    assert payload["ml_dataset"]["dataset_id"] == "dataset-1"
    assert payload["ml_dataset"]["row_count"] == 2
    assert payload["model_governance"]["dataset_id"] == "dataset-1"
    assert payload["live_order_allowed"] is False


def test_weather_crypto_ml_model_keeps_market_champion_when_challenger_underperforms():
    model = load_module("kalshi_weather_crypto_ml_model_underperform", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(160, candidate_good=False, positive_pnl=False)
    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert payload["champion_model_id"] == "market-implied-probability-champion-v1"
    assert payload["walk_forward_validation"]["challenger_beats_market"] is False
    challenger_card = next(card for card in payload["model_registry"] if card["model_id"] == "weather-crypto-current-candidate-probability-v1")
    assert challenger_card["state"] == "rejected_or_shadow_only"
    assert "model_underperforms_market_baseline" in {item["reason"] for item in payload["failure_attribution"]}


def test_weather_crypto_ml_model_reports_recent_edge_decay_without_trade_authority():
    model = load_module("kalshi_weather_crypto_ml_model_edge_decay", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(140, candidate_good=True, positive_pnl=True)
    for row in rows[-50:]:
        outcome = int(row["outcome_label"])
        good_probability = 0.96 if outcome else 0.04
        bad_probability = 1.0 - good_probability
        row["market_probability"] = good_probability
        row["model_candidate_probability"] = bad_probability
        row["paper_pnl_usd"] = -0.4
        row["features"]["market_probability"] = good_probability
        row["features"]["model_candidate_probability"] = bad_probability
        row["label"]["paper_pnl_usd"] = -0.4

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    decay = payload["edge_decay_diagnostics"]
    assert decay["status"] == "decay_alert"
    assert decay["recent_window"]["paper_pnl_usd"] < 0
    assert decay["candidate_brier_delta_vs_prior"] > 0
    assert decay["alert_count"] >= 2
    assert "recent_edge_decay" in {item["reason"] for item in payload["failure_attribution"]}
    assert decay["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_weather_crypto_ml_model_reports_segment_edge_decay():
    model = load_module("kalshi_weather_crypto_ml_model_segment_edge_decay", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(220, candidate_good=True, positive_pnl=True)
    crypto_rows = [row for row in rows if row["domain"] == "crypto"]
    for row in crypto_rows[-25:]:
        outcome = int(row["outcome_label"])
        good_probability = 0.96 if outcome else 0.04
        bad_probability = 1.0 - good_probability
        row["market_probability"] = good_probability
        row["model_candidate_probability"] = bad_probability
        row["paper_pnl_usd"] = -0.6
        row["features"]["market_probability"] = good_probability
        row["features"]["model_candidate_probability"] = bad_probability
        row["label"]["paper_pnl_usd"] = -0.6

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    decay = payload["edge_decay_diagnostics"]
    assert decay["segment_decay_alert_count"] >= 1
    assert "crypto" in decay["decayed_domains"]
    assert decay["forward_paper_quarantine_segment_count"] >= 1
    quarantine_entry = next(item for item in decay["forward_paper_quarantine_segments"] if item["domain"] == "crypto")
    assert quarantine_entry["recovery_eligible"] is False
    assert "fresh_segment_window_paper_pnl_usd_above_0" in quarantine_entry["recovery_requirements"]
    assert "fresh_shadow_recovery_labels_available" in quarantine_entry["recovery_requirements"]
    assert quarantine_entry["recovery_failure_reasons"]
    assert isinstance(quarantine_entry["recovery_sampling_priority_rank"], int)
    assert quarantine_entry["recovery_sampling_priority_reason"] == "closest_to_market_brier_recovery_gate"
    assert decay["recovery_failure_reason_counts"]
    assert decay["recovery_sampling_priority_segments"]
    assert decay["forward_paper_quarantine_recovery_policy"]["forward_paper_reentry_allowed_without_recovery"] is False
    crypto_alert = next(item for item in decay["segment_decay_alerts"] if item["domain"] == "crypto")
    assert crypto_alert["recent_paper_pnl_usd"] < 0
    assert crypto_alert["recommended_action"] == "throttle_decayed_segment_family_keep_other_segments_learning"
    assert crypto_alert["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_weather_crypto_ml_model_marks_previous_quarantine_recovered_after_shadow_gates():
    model = load_module("kalshi_weather_crypto_ml_model_quarantine_recovery", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(120, candidate_good=True, positive_pnl=True)
    for row in rows:
        row["domain"] = "crypto"
        row["segment_key"] = "crypto|BTC|crypto_price_threshold|YES"
        row["features"]["domain"] = "crypto"
    for row in rows[-50:-25]:
        outcome = int(row["outcome_label"])
        bad_probability = 0.04 if outcome else 0.96
        row["model_candidate_probability"] = bad_probability
        row["features"]["model_candidate_probability"] = bad_probability
        row["paper_pnl_usd"] = -0.4
        row["label"]["paper_pnl_usd"] = -0.4
    for row in rows[-25:]:
        outcome = int(row["outcome_label"])
        good_probability = 0.96 if outcome else 0.04
        row["model_candidate_probability"] = good_probability
        row["market_probability"] = good_probability
        row["features"]["model_candidate_probability"] = good_probability
        row["features"]["market_probability"] = good_probability
        row["paper_pnl_usd"] = 0.5
        row["label"]["paper_pnl_usd"] = 0.5
        row["label"]["label_source"] = "shadow"
        row["label"]["label_quality"] = "shadow_source_backed"

    decay = model._edge_decay_diagnostics(
        rows,
        previous_quarantine_segments=[{"segment_key": "crypto|BTC|crypto_price_threshold|YES", "domain": "crypto", "recovery_eligible": False}],
    )

    recovered = next(item for item in decay["forward_paper_quarantine_segments"] if item["segment_key"] == "crypto|BTC|crypto_price_threshold|YES")
    assert recovered["reason"] == "fresh_shadow_recovery_gate_passed"
    assert recovered["recovery_eligible"] is True
    assert recovered["requirements_passed"]["fresh_segment_window_paper_pnl_usd_above_0"] is True
    assert recovered["requirements_passed"]["fresh_segment_candidate_brier_improves_vs_prior"] is True
    assert recovered["requirements_passed"]["fresh_segment_candidate_brier_no_worse_than_market"] is True
    assert recovered["requirements_passed"]["fresh_shadow_recovery_labels_available"] is True
    assert recovered["fresh_shadow_recovery_label_count"] == 25
    assert recovered["fresh_segment_candidate_minus_market_brier"] <= 0
    assert recovered["recovery_failure_reasons"] == []
    assert recovered["top_recovery_failure_reason"] is None
    assert recovered["live_order_allowed"] is False


def test_weather_crypto_candidate_loaders_read_forward_paper_quarantine_segments(tmp_path):
    crypto = load_module("kalshi_crypto_evidence_quarantine_loader", ROOT / "kalshi_crypto_evidence.py")
    weather = load_module("kalshi_weather_paper_candidates_quarantine_loader", ROOT / "kalshi_weather_paper_candidates.py")
    path = tmp_path / "weather_crypto_ml_model.json"
    path.write_text(
        json.dumps(
            {
                "edge_decay_diagnostics": {
                    "forward_paper_quarantine_segments": [
                        {"segment_key": "crypto|BTC|crypto_price_threshold|YES", "domain": "crypto"},
                        {"segment_key": "crypto|ETH|crypto_price_threshold|YES", "domain": "crypto", "recovery_eligible": True},
                        {"segment_key": "weather|NYC|rainfall|above|YES", "domain": "weather"},
                        {"segment_key": "weather|BOSTON|rainfall|above|YES", "domain": "weather", "recovery_eligible": True},
                    ],
                    "live_order_allowed": False,
                },
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )

    assert crypto._load_forward_paper_quarantine_segments(path, domain="crypto") == {"crypto|BTC|crypto_price_threshold|YES"}
    assert weather._load_forward_paper_quarantine_segments(path, domain="weather") == {"weather|NYC|rainfall|above|YES"}


def test_quarantine_recovery_shadow_routes_are_shadow_only():
    crypto = load_module("kalshi_crypto_evidence_quarantine_shadow", ROOT / "kalshi_crypto_evidence.py")
    weather = load_module("kalshi_weather_paper_candidates_quarantine_shadow", ROOT / "kalshi_weather_paper_candidates.py")
    record = {
        "decision": "BUY_YES",
        "selected_executable_side": "YES",
        "simulated_size_usd": 1.0,
        "selective_ml_segment_key": "crypto|BTC|crypto_price_threshold|YES",
        "live_order_allowed": False,
    }

    crypto_shadow = crypto._force_quarantine_recovery_shadow(record, "crypto|BTC|crypto_price_threshold|YES")
    weather_shadow = weather._force_quarantine_recovery_shadow({**record, "selective_ml_segment_key": "weather|NYC|rainfall|above|YES"}, "weather|NYC|rainfall|above|YES")

    for shadow in (crypto_shadow, weather_shadow):
        assert shadow["strategy_governor_action"] == "SHADOW_ONLY"
        assert shadow["decision"] == "SHADOW_QUARANTINE_RECOVERY"
        assert shadow["paper_experiment_type"] == "QUARANTINE_RECOVERY_SHADOW"
        assert shadow["simulated_size_usd"] == 0.0
        assert shadow["shadow_learning_outcome"] is True
        assert shadow["quarantine_recovery_shadow"]["recovery_eligible"] is False
        assert shadow["live_order_allowed"] is False
        assert shadow["auto_live_promotion_allowed"] is False


def test_quarantine_recovery_prioritizer_balances_segments_first():
    crypto = load_module("kalshi_crypto_evidence_quarantine_prioritizer", ROOT / "kalshi_crypto_evidence.py")
    weather = load_module("kalshi_weather_paper_candidates_quarantine_prioritizer", ROOT / "kalshi_weather_paper_candidates.py")
    records = [
        {"id": "a1", "forward_paper_quarantined_segment_key": "segment-a", "quarantine_recovery_shadow": {}},
        {"id": "a2", "forward_paper_quarantined_segment_key": "segment-a", "quarantine_recovery_shadow": {}},
        {"id": "b1", "forward_paper_quarantined_segment_key": "segment-b", "quarantine_recovery_shadow": {}},
        {"id": "regular"},
    ]

    for module in (crypto, weather):
        prioritized = module._prioritize_quarantine_recovery_records(records, max_per_segment=1, priority_ranks={"segment-b": 1, "segment-a": 2})
        assert [item["id"] for item in prioritized[:2]] == ["b1", "a1"]
        assert prioritized[2]["id"] == "regular"
        assert prioritized[-1]["id"] == "a2"


def test_quarantine_recovery_priority_loader_reads_market_brier_ranks(tmp_path):
    crypto = load_module("kalshi_crypto_evidence_quarantine_priority_loader", ROOT / "kalshi_crypto_evidence.py")
    weather = load_module("kalshi_weather_paper_candidates_quarantine_priority_loader", ROOT / "kalshi_weather_paper_candidates.py")
    path = tmp_path / "weather_crypto_ml_model.json"
    path.write_text(
        json.dumps(
            {
                "edge_decay_diagnostics": {
                    "recovery_sampling_priority_segments": [
                        {"segment_key": "crypto|BTC|crypto_price_threshold|yes", "domain": "crypto", "rank": 1},
                        {"segment_key": "weather|NYC|rainfall|above|yes", "domain": "weather", "rank": 2},
                    ],
                    "live_order_allowed": False,
                },
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )

    assert crypto._load_quarantine_recovery_priority(path, domain="crypto") == {"crypto|BTC|crypto_price_threshold|yes": 1}
    assert weather._load_quarantine_recovery_priority(path, domain="weather") == {"weather|NYC|rainfall|above|yes": 2}


def test_scheduled_learning_recovery_candidate_coverage_counts_priority_segments():
    scheduled = load_module("kalshi_scheduled_learning_recovery_coverage", ROOT / "kalshi_scheduled_learning.py")
    coverage = scheduled._recovery_candidate_coverage(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 2,
                    "quarantine_recovery_shadow_created_count": 1,
                    "quarantine_recovery_priority_covered_segments": ["crypto|BTC|yes"],
                },
            },
            {
                "script": "kalshi_weather_paper_candidates.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 1,
                    "quarantine_recovery_shadow_created_count": 1,
                    "quarantine_recovery_priority_covered_segments": ["weather|AUSTIN|low|yes"],
                },
            },
        ]
    )

    assert coverage["priority_segment_count_seen"] == 3
    assert coverage["priority_segment_count_seen_raw_step_sum"] == 3
    assert coverage["priority_segment_created_count"] == 2
    assert coverage["priority_segment_missing_count"] == 1
    assert coverage["quarantine_recovery_shadow_created_count"] == 2
    assert coverage["live_order_allowed"] is False


def test_scheduled_learning_recovery_candidate_coverage_uses_unique_model_priorities():
    scheduled = load_module("kalshi_scheduled_learning_recovery_unique_coverage", ROOT / "kalshi_scheduled_learning.py")

    coverage = scheduled._recovery_candidate_coverage(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 2,
                    "quarantine_recovery_shadow_created_count": 1,
                    "quarantine_recovery_priority_covered_segments": ["crypto|BTC|yes"],
                },
            },
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 2,
                    "quarantine_recovery_shadow_created_count": 0,
                    "quarantine_recovery_priority_covered_segments": ["crypto|BTC|yes"],
                },
            },
        ],
        edge_decay={
            "recovery_sampling_priority_segments": [
                {"segment_key": "crypto|BTC|yes", "domain": "crypto"},
                {"segment_key": "crypto|ETH|yes", "domain": "crypto"},
            ],
        },
    )

    assert coverage["priority_segment_count_seen_raw_step_sum"] == 4
    assert coverage["priority_segment_count_seen"] == 2
    assert coverage["priority_segment_created_count"] == 1
    assert coverage["priority_segment_missing_count"] == 1
    assert coverage["priority_segments_missing"] == ["crypto|ETH|yes"]
    assert coverage["live_order_allowed"] is False


def test_scheduled_learning_quarantine_recovery_retry_plan_targets_missing_domains():
    scheduled = load_module("kalshi_scheduled_learning_recovery_retry_plan", ROOT / "kalshi_scheduled_learning.py")

    plan = scheduled._quarantine_recovery_retry_plan(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 2,
                    "quarantine_recovery_shadow_created_count": 1,
                    "quarantine_recovery_priority_covered_segments": ["crypto|BTC|crypto_price_threshold|yes"],
                },
            }
        ],
        edge_decay={
            "forward_paper_quarantine_segments": [
                {"segment_key": "crypto|BTC|crypto_price_threshold|yes", "domain": "crypto", "recovery_eligible": False},
                {"segment_key": "weather|AUSTIN|low_temperature|below|yes", "domain": "weather", "recovery_eligible": False},
            ],
            "recovery_sampling_priority_segments": [
                {"rank": 1, "segment_key": "crypto|BTC|crypto_price_threshold|yes", "domain": "crypto"},
                {"rank": 2, "segment_key": "weather|AUSTIN|low_temperature|below|yes", "domain": "weather"},
            ],
        },
    )

    assert plan["retry_needed"] is True
    assert plan["priority_segment_count"] == 2
    assert plan["priority_created_count"] == 1
    assert plan["missing_priority_segment_count"] == 1
    assert plan["retry_domains"] == ["weather"]
    assert plan["weather_recovery_searches"] == ["temperature"]
    assert plan["priority_segment_diagnostic_count"] == 2
    missing_diag = [item for item in plan["priority_segment_diagnostics"] if item["segment_key"] == "weather|AUSTIN|low_temperature|below|yes"][0]
    assert missing_diag["failure_reason"] == "domain_not_attempted"
    assert plan["retry_blocker_counts"] == {"domain_not_attempted": 1}
    assert plan["live_order_allowed"] is False


def test_scheduled_learning_crypto_args_focus_recovery_priority_assets():
    scheduled = load_module("kalshi_scheduled_learning_crypto_recovery_assets", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "25", "--max-orderbooks", "10", "--max-auto-candidates", "20"])

    step_args = scheduled._crypto_evidence_step_args(
        args,
        acquisition_summary={},
        adaptive_caps={"crypto_max_auto_candidates": 30, "crypto_orderbook_multiplier": 3},
        recovery_priority_assets=["BTC", "ETH"],
    )

    assert step_args[step_args.index("--searches") + 1].startswith("bitcoin,btc,ethereum,eth")
    assert step_args[step_args.index("--series-tickers") + 1] == "KXBTC15M,KXETH15M"
    assert step_args[step_args.index("--max-new") + 1] == "30"
    assert step_args[step_args.index("--size-usd") + 1] == "1.0"


def test_scheduled_learning_weather_recovery_retry_args_are_narrow():
    scheduled = load_module("kalshi_scheduled_learning_weather_recovery_narrow_args", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(
        [
            "--observe-limit",
            "150",
            "--max-orderbooks",
            "60",
            "--max-auto-candidates",
            "40",
            "--candidate-max-hours",
            "48",
            "--candidate-max-pages",
            "3",
        ]
    )

    step_args = scheduled._weather_candidate_step_args(
        args,
        remaining=20,
        search="temperature",
        sample_deficit=10.0,
        recovery_retry=True,
    )

    assert step_args[step_args.index("--limit") + 1] == "40"
    assert step_args[step_args.index("--max-orderbooks") + 1] == "16"
    assert step_args[step_args.index("--max-new") + 1] == "3"
    assert step_args[step_args.index("--max-hours") + 1] == "36.0"
    assert step_args[step_args.index("--max-pages") + 1] == "1"
    assert step_args[step_args.index("--live-city-search-limit") + 1] == "12"
    assert step_args[step_args.index("--live-search-max-terms") + 1] == "32"
    assert step_args[step_args.index("--size-usd") + 1] == "1.0"


def test_scheduled_learning_weather_recovery_retry_step_marks_scope():
    scheduled = load_module("kalshi_scheduled_learning_weather_recovery_scope", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "150", "--max-orderbooks", "60", "--max-auto-candidates", "40"])
    calls: list[list[str]] = []

    def fake_run_script(script, step_args):
        calls.append(step_args)
        return {
            "script": script,
            "ok": True,
            "json_summary": {"created_count": 0, "live_order_allowed": False},
            "stdout_tail": "",
            "stderr_tail": "",
        }

    step = scheduled._run_weather_candidate_step_with_retry(
        args,
        search="temperature",
        remaining=20,
        sample_deficit=10.0,
        recovery_retry=True,
        run_script=fake_run_script,
    )

    assert step["quarantine_recovery_retry"] is True
    assert step["quarantine_recovery_retry_scope"] == "narrow_weather_recovery"
    assert calls[0][calls[0].index("--max-orderbooks") + 1] == "16"
    assert calls[0][calls[0].index("--max-pages") + 1] == "1"


def test_scheduled_learning_loads_weather_frontier_active_learning_targets(tmp_path):
    scheduled = load_module("kalshi_scheduled_learning_weather_frontier_targets", ROOT / "kalshi_scheduled_learning.py")
    readiness = tmp_path / "readiness.json"
    readiness.write_text(
        json.dumps(
            {
                "active_learning_queue": [
                    {
                        "action": "collect_segment_specific_shadow_labels",
                        "domain": "weather",
                        "segment_key": "weather|BOSTON|low_temperature|above|yes",
                        "priority": 2,
                        "frontier_score": 0.573,
                        "labels_needed_to_shadow_qualified": 14,
                        "unique_markets_needed_to_shadow_qualified": 0,
                        "shadow_scored": 11,
                        "shadow_unique_market_count": 11,
                        "live_order_allowed": False,
                    },
                    {
                        "action": "collect_segment_specific_shadow_labels",
                        "domain": "crypto",
                        "segment_key": "crypto|BTC|crypto_price_threshold|yes",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    targets = scheduled._weather_frontier_active_learning_targets(readiness)
    plan = scheduled._weather_frontier_sampling_plan(targets)

    assert targets == [
        {
            "segment_key": "weather|BOSTON|low_temperature|above|yes",
            "search": "temperature",
            "priority": 2,
            "frontier_score": 0.573,
            "labels_needed_to_shadow_qualified": 14,
            "unique_markets_needed_to_shadow_qualified": 0,
            "shadow_scored": 11,
            "shadow_unique_market_count": 11,
            "max_simulated_size_usd": 0.0,
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }
    ]
    assert plan["enabled"] is True
    assert plan["scheduled_target_count"] == 1
    assert plan["live_order_allowed"] is False


def test_scheduled_learning_weather_frontier_target_step_is_bounded():
    scheduled = load_module("kalshi_scheduled_learning_weather_frontier_step", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "150", "--max-orderbooks", "60", "--max-auto-candidates", "40"])
    calls: list[list[str]] = []

    def fake_run_script(script, step_args):
        calls.append(step_args)
        return {
            "script": script,
            "ok": True,
            "json_summary": {"created_count": 1, "live_order_allowed": False},
            "stdout_tail": "",
            "stderr_tail": "",
        }

    step = scheduled._run_weather_candidate_step_with_retry(
        args,
        search="temperature",
        remaining=6,
        sample_deficit=14.0,
        max_orderbooks_override=60,
        run_script=fake_run_script,
    )
    step["weather_frontier_active_learning"] = True
    step["weather_frontier_target_segment_key"] = "weather|BOSTON|low_temperature|above|yes"

    assert calls[0][calls[0].index("--search") + 1] == "temperature"
    assert calls[0][calls[0].index("--max-new") + 1] == "6"
    assert calls[0][calls[0].index("--live-search-max-terms") + 1] == "96"
    assert step["weather_frontier_active_learning"] is True
    assert step["json_summary"]["live_order_allowed"] is False


def test_scheduled_learning_weather_frontier_sampling_result_counts_targets():
    scheduled = load_module("kalshi_scheduled_learning_weather_frontier_result", ROOT / "kalshi_scheduled_learning.py")

    result = scheduled._weather_frontier_sampling_result(
        [
            {
                "script": "kalshi_weather_paper_candidates.py",
                "ok": True,
                "weather_frontier_active_learning": True,
                "weather_frontier_target_segment_key": "weather|BOSTON|low_temperature|above|yes",
                "weather_frontier_target": {
                    "segment_key": "weather|BOSTON|low_temperature|above|yes",
                    "search": "temperature",
                    "live_order_allowed": False,
                },
                "json_summary": {
                    "created_count": 2,
                    "weather_frontier_shadow_created_count": 2,
                    "weather_frontier_shadow_candidate_count": 3,
                    "weather_frontier_shadow_target_match_count": 4,
                    "weather_frontier_shadow_blocked_no_price_count": 1,
                    "skipped_reasons": {"missing_weather_executable_price": 1},
                    "live_order_allowed": False,
                },
            }
        ]
    )

    assert result["attempted_target_count"] == 1
    assert result["frontier_step_count"] == 1
    assert result["frontier_shadow_created_count"] == 2
    assert result["frontier_shadow_candidate_count"] == 3
    assert result["frontier_shadow_target_match_count"] == 4
    assert result["frontier_shadow_blocked_no_price_count"] == 1
    assert result["blocker_counts"] == {"missing_weather_executable_price": 1}
    assert result["status"] == "created_frontier_shadow"
    assert result["targets"][0]["segment_key"] == "weather|BOSTON|low_temperature|above|yes"
    assert result["live_order_allowed"] is False


def test_scheduled_learning_recovery_retry_diagnostics_explain_runtime_blockers():
    scheduled = load_module("kalshi_scheduled_learning_recovery_runtime_diagnostics", ROOT / "kalshi_scheduled_learning.py")

    plan = scheduled._quarantine_recovery_retry_plan(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 1,
                    "quarantine_recovery_shadow_candidate_count": 0,
                    "quarantine_recovery_shadow_created_count": 0,
                    "candidate_count": 3,
                    "created_count": 3,
                    "active_crypto_markets_seen": 3,
                    "orderbooks_checked": 3,
                    "paper_safety_gate_summary": {"current_safety_blocked_count": 4},
                    "quarantine_recovery_priority_covered_segments": [],
                },
            },
            {
                "script": "kalshi_weather_paper_candidates.py",
                "json_summary": {
                    "quarantine_recovery_priority_segment_count": 1,
                    "quarantine_recovery_shadow_candidate_count": 0,
                    "quarantine_recovery_shadow_created_count": 0,
                    "candidate_count": 0,
                    "created_count": 0,
                    "markets_seen": 12,
                    "skipped_reasons": {"missing_weather_executable_price": 5},
                    "quarantine_recovery_priority_covered_segments": [],
                },
            },
        ],
        edge_decay={
            "forward_paper_quarantine_segments": [
                {"segment_key": "crypto|BTC|crypto_price_threshold|yes", "domain": "crypto", "recovery_eligible": False},
                {"segment_key": "weather|AUSTIN|low_temperature|below|yes", "domain": "weather", "recovery_eligible": False},
            ],
            "recovery_sampling_priority_segments": [
                {"rank": 1, "segment_key": "crypto|BTC|crypto_price_threshold|yes", "domain": "crypto"},
                {"rank": 2, "segment_key": "weather|AUSTIN|low_temperature|below|yes", "domain": "weather"},
            ],
        },
    )

    diagnostics = {item["segment_key"]: item for item in plan["priority_segment_diagnostics"]}
    assert diagnostics["crypto|BTC|crypto_price_threshold|yes"]["failure_reason"] == "safety_gate_blocked_recovery_shadow"
    assert diagnostics["weather|AUSTIN|low_temperature|below|yes"]["failure_reason"] == "skipped:missing_weather_executable_price"
    assert plan["retry_blocker_counts"] == {
        "safety_gate_blocked_recovery_shadow": 1,
        "skipped:missing_weather_executable_price": 1,
    }
    assert plan["live_order_allowed"] is False


def test_scheduled_learning_run_script_timeout_fails_closed(monkeypatch):
    scheduled = load_module("kalshi_scheduled_learning_timeout_closed", ROOT / "kalshi_scheduled_learning.py")

    def fake_run(*_args, **_kwargs):
        raise scheduled.subprocess.TimeoutExpired(cmd=["python", "slow.py"], timeout=120, output="partial out", stderr="partial err")

    monkeypatch.setattr(scheduled.subprocess, "run", fake_run)
    step = scheduled._run_script("slow.py", ["--arg"])

    assert step["ok"] is False
    assert step["returncode"] == 124
    assert step["json_summary"]["timed_out"] is True
    assert step["json_summary"]["timeout_seconds"] == 120
    assert step["json_summary"]["live_order_allowed"] is False
    assert "script timed out" in step["stderr_tail"]


def test_scheduled_learning_script_timeout_is_short_for_weather_recovery_retry():
    scheduled = load_module("kalshi_scheduled_learning_timeout_budget", ROOT / "kalshi_scheduled_learning.py")

    recovery_args = [
        "--limit",
        "40",
        "--max-orderbooks",
        "16",
        "--max-new",
        "3",
        "--max-pages",
        "1",
        "--live-city-search-limit",
        "12",
    ]
    broad_args = [
        "--limit",
        "150",
        "--max-orderbooks",
        "100",
        "--live-city-search-limit",
        "32",
    ]

    assert scheduled._script_timeout_seconds("kalshi_weather_paper_candidates.py", recovery_args) == 45
    assert scheduled._script_timeout_seconds("kalshi_weather_paper_candidates.py", broad_args) == 90
    assert scheduled._script_timeout_seconds("kalshi_crypto_evidence.py", []) == 120


def test_scheduled_learning_run_script_uses_script_timeout(monkeypatch):
    scheduled = load_module("kalshi_scheduled_learning_timeout_budget_used", ROOT / "kalshi_scheduled_learning.py")
    observed = {}

    def fake_run(*_args, **kwargs):
        observed["timeout"] = kwargs.get("timeout")
        raise scheduled.subprocess.TimeoutExpired(cmd=["python", "weather.py"], timeout=kwargs.get("timeout"))

    monkeypatch.setattr(scheduled.subprocess, "run", fake_run)
    step = scheduled._run_script(
        "kalshi_weather_paper_candidates.py",
        ["--live-city-search-limit", "12", "--max-pages", "1"],
    )

    assert observed["timeout"] == 45
    assert step["json_summary"]["timeout_seconds"] == 45
    assert step["json_summary"]["live_order_allowed"] is False


def test_scheduled_learning_recovery_retry_diagnostics_mark_timeout():
    scheduled = load_module("kalshi_scheduled_learning_timeout_diagnostics", ROOT / "kalshi_scheduled_learning.py")

    plan = scheduled._quarantine_recovery_retry_plan(
        [
            {
                "script": "kalshi_weather_paper_candidates.py",
                "json_summary": {
                    "timed_out": True,
                    "timeout_seconds": 120,
                    "quarantine_recovery_priority_segment_count": 1,
                    "quarantine_recovery_shadow_created_count": 0,
                },
            }
        ],
        edge_decay={
            "forward_paper_quarantine_segments": [
                {"segment_key": "weather|AUSTIN|low_temperature|below|yes", "domain": "weather", "recovery_eligible": False},
            ],
            "recovery_sampling_priority_segments": [
                {"rank": 1, "segment_key": "weather|AUSTIN|low_temperature|below|yes", "domain": "weather"},
            ],
        },
    )

    diagnostic = plan["priority_segment_diagnostics"][0]
    assert diagnostic["failure_reason"] == "domain_step_timeout"
    assert diagnostic["domain_step_timed_out"] is True
    assert plan["retry_blocker_counts"] == {"domain_step_timeout": 1}
    assert plan["live_order_allowed"] is False


def test_weather_crypto_ml_model_reports_markov_feature_uplift_without_trade_authority():
    model = load_module("kalshi_weather_crypto_ml_model_markov_uplift", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(160, candidate_good=False, positive_pnl=True)
    for row in rows:
        outcome = row["outcome_label"]
        markov_yes_probability = 0.96 if outcome else 0.04
        row["features"].update(
            {
                "markov_feature_present": 1,
                "markov_calibrated_probability": markov_yes_probability,
                "markov_confidence_score": 7.0,
                "markov_selected_side_maker_edge_pct": 2.0,
                "markov_selected_side_taker_edge_pct": -1.0,
                "markov_low_sample_flag": 0,
                "markov_taker_trap_flag": 1,
                "markov_longshot_yes_bias_flag": 0,
                "markov_official_history_flag": 1,
            }
        )

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    uplift = payload["markov_microstructure_uplift"]
    assert uplift["status"] == "validated_useful"
    assert uplift["can_influence_ml_training"] is True
    assert uplift["can_authorize_trade"] is False
    assert uplift["live_order_allowed"] is False
    assert uplift["brier_uplift_vs_candidate"] > 0
    card = next(card for card in payload["model_registry"] if card["model_id"] == "weather-crypto-markov-microstructure-uplift-v1")
    assert card["role"] == "research_risk_feature"
    assert card["live_order_allowed"] is False
    assert payload["certification"]["ml_10_ready"] is False
    assert payload["ml_build_gap_summary"]["total_gaps"] == 20
    assert payload["ml_build_gap_summary"]["all_build_gaps_complete"] is True
    assert payload["ml_build_gap_summary"]["build_complete_count"] == 20
    assert payload["ml_build_gap_summary"]["evidence_complete_count"] < 20
    assert len(payload["ml_build_gaps"]) == 20
    assert all(gap["build_complete"] is True and gap["completion_grade"] == 10.0 for gap in payload["ml_build_gaps"])
    assert payload["live_order_allowed"] is False



def test_weather_crypto_ml_model_uses_markov_chronological_holdout_when_primary_split_has_recent_markov_only():
    model = load_module("kalshi_weather_crypto_ml_model_markov_recent_holdout", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(260, candidate_good=False, positive_pnl=True)
    for row in rows[-100:]:
        outcome = row["outcome_label"]
        row["features"].update(
            {
                "markov_feature_present": 1,
                "markov_calibrated_probability": 0.96 if outcome else 0.04,
                "markov_confidence_score": 8.0,
                "markov_selected_side_maker_edge_pct": 3.0,
                "markov_selected_side_taker_edge_pct": -1.0,
                "markov_low_sample_flag": 0,
                "markov_taker_trap_flag": 0,
                "markov_longshot_yes_bias_flag": 0,
                "markov_official_history_flag": 1,
            }
        )

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    uplift = payload["markov_microstructure_uplift"]
    assert uplift["validation_method"] == "markov_chronological_holdout"
    assert uplift["primary_split"]["enough_rows"] is False
    assert uplift["chronological_holdout"]["enough_rows"] is True
    assert uplift["chronological_holdout"]["validation"]["uses_test_labels_for_fit"] is False
    assert uplift["train_markov_rows"] == 70
    assert uplift["test_markov_rows"] == 30
    assert uplift["can_influence_ml_training"] is True
    assert uplift["can_authorize_trade"] is False
    assert uplift["live_order_allowed"] is False
    overlay = payload["markov_ml_risk_overlay"]
    assert overlay["enabled"] is True
    assert overlay["state"] == "validated_shadow_ml_overlay"
    assert overlay["validation_method"] == "markov_chronological_holdout"
    assert overlay["feature_contract"]["fit_uses_test_labels"] is False
    assert overlay["can_authorize_trade"] is False
    assert overlay["live_order_allowed"] is False

def test_weather_crypto_model_stratified_split_preserves_domain_order():
    model = load_module("kalshi_weather_crypto_ml_model_stratified", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(240, candidate_good=True, positive_pnl=True)
    train_rows, test_rows, split = model._stratified_split_rows(rows)

    assert split["method"] == "domain_stratified_chronological"
    assert train_rows
    assert test_rows
    for domain in ("weather", "crypto"):
        domain_train = [row for row in train_rows if row["domain"] == domain]
        domain_test = [row for row in test_rows if row["domain"] == domain]
        assert domain_train
        assert domain_test
        assert max(row["decision_timestamp_utc"] for row in domain_train) <= min(row["decision_timestamp_utc"] for row in domain_test)
        assert split["domains"][domain]["train_rows"] == len(domain_train)
        assert split["domains"][domain]["test_rows"] == len(domain_test)


def test_weather_crypto_domain_rejects_stale_taxonomy_false_positive():
    readiness = load_module("kalshi_weather_crypto_ml_strict_domain", ROOT / "kalshi_weather_crypto_ml.py")

    stale_crypto_taxonomy_sports_record = {
        "market_ticker": "KXMVECROSSCATEGORY-S2026F13AD4E1755-54021F5BECF",
        "market_title": "yes Matteo Arnaldi,yes Solana Sierra,yes Lilli Tagger",
        "market_category": "KXMVECROSSCATEGORY-S2026F13AD4E1755",
        "fair_value_source_type": "market_implied_baseline",
        "strategy_bucket": "market_making_simulation",
        "strategy_taxonomy": {"domain": "crypto", "taxonomy_version": "2026-05-04"},
    }
    stale_weather_taxonomy_sports_record = {
        "market_ticker": "KXMVECROSSCATEGORY-S2026BD42C69F4BC-23937A858DF",
        "market_title": "yes Tyler Glasnow: 6+,no Over 10.5 runs scored",
        "market_category": "KXMVECROSSCATEGORY-S2026BD42C69F4BC",
        "fair_value_source_type": "market_implied_baseline",
        "strategy_bucket": "market_making_simulation",
        "strategy_taxonomy": {"domain": "weather", "taxonomy_version": "2026-05-04"},
    }
    player_named_weathers_record = {
        "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S20264A4D5E78299-0414CB56D9D",
        "market_title": "yes Chicago C,yes Ryan Weathers: 3+",
        "market_category": "KXMVESPORTSMULTIGAMEEXTENDED-S20264A4D5E78299",
        "strategy_taxonomy": {"domain": "weather", "taxonomy_version": "2026-05-04"},
    }

    assert readiness._domain(stale_crypto_taxonomy_sports_record) is None
    assert readiness._domain(stale_weather_taxonomy_sports_record) is None
    assert readiness._domain(player_named_weathers_record) is None
    assert readiness._domain({"market_ticker": "KXSOL15M-26MAY221715-15", "crypto_evidence": {"asset": "SOL"}}) == "crypto"
    assert readiness._domain({"market_ticker": "KXHIGHAUS-26MAY23-T86", "weather_city": "AUSTIN", "weather_market_type": "high_temperature"}) == "weather"


def test_weather_crypto_domain_ignores_weather_strategy_name_without_weather_evidence():
    readiness = load_module("kalshi_weather_crypto_ml_strategy_name_domain", ROOT / "kalshi_weather_crypto_ml.py")

    sports_record_from_weather_lane = {
        "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S202611C5E8CB4A8-7EC2BEBE0C6",
        "market_title": "yes Team A wins, no Over 10.5 runs scored",
        "market_category": "weather",
        "fair_value_source_type": "kalshi_weather_relative_value",
        "strategy_bucket": "weather_arbitrage_strategy",
        "strategy_taxonomy": {"domain": "weather", "market_type": "comparison_lane"},
        "expected_result_known_time_utc": "2026-05-23T20:35:00Z",
    }
    true_weather_record_from_weather_lane = {
        "market_ticker": "KXHIGHTDAL-26MAY22-T89",
        "market_title": "Will Dallas have a high temperature above 89°?",
        "market_category": "weather",
        "strategy_bucket": "weather_arbitrage_strategy",
        "weather_city": "DALLAS",
        "weather_market_type": "high_temperature",
    }

    assert readiness._domain(sports_record_from_weather_lane) is None
    assert readiness._domain(true_weather_record_from_weather_lane) == "weather"


def test_weather_crypto_dataset_excludes_strategy_name_only_weather_false_positive():
    dataset = load_module("kalshi_weather_crypto_ml_strategy_name_dataset", ROOT / "kalshi_weather_crypto_ml_dataset.py")
    false_weather_decision = {
        "decision_id": "weather-lane-sports-1",
        "timestamp_utc": "2026-05-23T20:00:00Z",
        "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S202611C5E8CB4A8-7EC2BEBE0C6",
        "market_title": "yes Team A wins, no Over 10.5 runs scored",
        "market_category": "weather",
        "strategy_bucket": "weather_arbitrage_strategy",
        "fair_value_source_type": "kalshi_weather_relative_value",
        "strategy_taxonomy": {"domain": "weather", "market_type": "comparison_lane"},
        "selected_executable_side": "YES",
        "paper_fill_price_cents": 40,
        "expected_result_known_time_utc": "2026-05-23T20:35:00Z",
        "live_order_allowed": False,
    }

    payload, rows = dataset.build_dataset(
        [false_weather_decision],
        [
            {
                "decision_id": "weather-lane-sports-1",
                "resolved": True,
                "outcome_yes": 1,
                "settlement_checked_at_utc": "2026-05-23T20:40:00Z",
                "settlement_source": "fixture",
            }
        ],
        [],
        generated_at_utc="2026-05-24T00:00:00Z",
    )

    assert rows == []
    assert payload["row_count"] == 0
    assert "weather" not in payload["domain_counts"]
    assert payload["rejection_counts"] == {}
    assert payload["live_order_allowed"] is False


def test_weather_crypto_model_calibrated_challengers_are_train_only():
    model = load_module("kalshi_weather_crypto_ml_model_calibrated_train_only", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(300, candidate_good=True, positive_pnl=True)
    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    calibrated = payload["walk_forward_validation"]["calibrated_challengers"]
    assert set(calibrated) == {
        "weather-crypto-global-market-model-blend-v1",
        "weather-crypto-domain-market-model-blend-v1",
        "weather-crypto-segment-fallback-blend-v1",
    }
    assert all(metrics["calibration"]["uses_test_labels"] is False for metrics in calibrated.values())
    assert payload["walk_forward_validation"]["stratified_split"]["method"] == "domain_stratified_chronological"
    _assert_no_live_true(payload)


def test_weather_crypto_model_profit_selector_uses_train_only_rules_for_positive_test_pnl():
    model = load_module("kalshi_weather_crypto_ml_profit_selector", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = []
    start = datetime(2026, 5, 1, 12, tzinfo=timezone.utc)
    for index in range(260):
        domain = "weather" if index % 2 == 0 else "crypto"
        decision_time = start + timedelta(minutes=index)
        cutoff_time = decision_time - timedelta(minutes=1)
        rows.append(
            {
                "dataset_id": "fixture-dataset",
                "dataset_schema_version": "weather-crypto-ml-dataset-v1",
                "feature_schema_version": "weather-crypto-selective-v1",
                "label_schema_version": "weather-crypto-label-v1",
                "row_id": f"profit-row-{index}",
                "decision_id": f"profit-decision-{index}",
                "domain": domain,
                "segment_key": f"{domain}|profit-selector|yes",
                "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                "decision_timestamp_utc": decision_time.isoformat().replace("+00:00", "Z"),
                "market_ticker": f"PROFIT-{index}",
                "selected_side": "YES",
                "market_probability": 0.2,
                "model_candidate_probability": 0.8,
                "paper_fill_price_cents": 80,
                "outcome_label": 0,
                "paper_pnl_usd": -0.8,
                "features": {
                    "domain": domain,
                    "market_probability": 0.2,
                    "model_candidate_probability": 0.8,
                    "paper_fill_price_cents": 80,
                    "horizon_minutes": 20,
                    "liquidity_score": 0.5,
                    "depth_contracts": 100,
                    "spread_cents": 2,
                    "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                },
                "label": {
                    "selected_side_won": 0,
                    "paper_pnl_usd": -0.8,
                    "settlement_source": "fixture",
                    "label_quality": "official_or_source_backed",
                },
                "feature_hash": f"profit-feature-{index}",
                "label_hash": f"profit-label-{index}",
                "source_hash": f"profit-source-{index}",
                "row_hash": f"profit-row-hash-{index}",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    selector = payload["walk_forward_validation"]["train_only_profit_selector"]
    assert selector["selector"]["uses_test_labels"] is False
    assert selector["uses_test_labels_for_selection"] is False
    assert selector["paper_pnl_usd"] > 0
    assert selector["directional_accuracy"] > 0.6
    assert selector["beats_no_trade"] is True
    assert selector["beats_observed_current_model"] is True
    assert selector["consistency_scorecard"]["overall"]["trade_count"] == selector["trade_count"]
    assert selector["consistency_scorecard"]["plain_english"]
    assert selector["by_rule"]
    selector_rule = next(iter(selector["by_rule"].values()))
    assert selector_rule["selector_scope"] == "segment"
    assert selector_rule["forward_shadow_candidate"] is True
    assert selector["hypothesis_only"] is True
    assert selector["forward_paper_required"] is True
    selector_card = next(card for card in payload["model_registry"] if card["model_id"] == "weather-crypto-train-only-profit-selector-v1")
    assert selector_card["state"] == "paper_hypothesis_positive"
    _assert_no_live_true(payload)


def test_weather_crypto_model_profit_selector_reports_consistent_profitable_category():
    model = load_module("kalshi_weather_crypto_ml_profit_consistency", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = []
    start = datetime(2026, 5, 1, 12, tzinfo=timezone.utc)
    for index in range(420):
        decision_time = start + timedelta(minutes=index)
        cutoff_time = decision_time - timedelta(minutes=1)
        rows.append(
            {
                "dataset_id": "fixture-dataset",
                "dataset_schema_version": "weather-crypto-ml-dataset-v1",
                "feature_schema_version": "weather-crypto-selective-v1",
                "label_schema_version": "weather-crypto-label-v1",
                "row_id": f"consistent-row-{index}",
                "decision_id": f"consistent-decision-{index}",
                "domain": "crypto",
                "segment_key": "crypto|XRP|crypto_price_threshold|yes",
                "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                "decision_timestamp_utc": decision_time.isoformat().replace("+00:00", "Z"),
                "market_ticker": f"CONSISTENT-{index}",
                "selected_side": "YES",
                "market_probability": 0.2,
                "model_candidate_probability": 0.8,
                "paper_fill_price_cents": 80,
                "outcome_label": 0,
                "paper_pnl_usd": -0.8,
                "features": {
                    "domain": "crypto",
                    "market_probability": 0.2,
                    "model_candidate_probability": 0.8,
                    "paper_fill_price_cents": 80,
                    "horizon_minutes": 20,
                    "liquidity_score": 0.5,
                    "depth_contracts": 100,
                    "spread_cents": 2,
                    "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                },
                "label": {
                    "selected_side_won": 0,
                    "paper_pnl_usd": -0.8,
                    "settlement_source": "fixture",
                    "label_quality": "official_or_source_backed",
                },
                "feature_hash": f"consistent-feature-{index}",
                "label_hash": f"consistent-label-{index}",
                "source_hash": f"consistent-source-{index}",
                "row_hash": f"consistent-row-hash-{index}",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    scorecard = payload["walk_forward_validation"]["train_only_profit_selector"]["consistency_scorecard"]
    assert scorecard["consistent_profitable_category_count"] == 1
    candidate = scorecard["live_prep_category_candidates"][0]
    assert candidate["domain"] == "crypto"
    assert candidate["meets_live_prep_accuracy_profit_consistency"] is True
    assert candidate["directional_accuracy"] == 1.0
    assert candidate["paper_pnl_usd"] > 0
    assert candidate["best_passing_window_size"] in {25, 50, 100}
    assert candidate["recent_consistency_passed"] is True
    assert candidate["recent_windows_profitable"] is True
    assert candidate["recent_windows_accuracy_over_60"] is True
    assert scorecard["by_domain"]["crypto"]["consistent_profitable"] is True
    assert scorecard["by_domain"]["crypto"]["recent_consistency_passed"] is True
    _assert_no_live_true(payload)


def test_weather_crypto_model_profit_selector_blocks_live_prep_when_recent_windows_lose():
    model = load_module("kalshi_weather_crypto_ml_recent_drawdown", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = []
    start = datetime(2026, 5, 1, 12, tzinfo=timezone.utc)
    for index in range(500):
        decision_time = start + timedelta(minutes=index)
        cutoff_time = decision_time - timedelta(minutes=1)
        in_recent_drawdown = index >= 470
        selected_side_won = 1 if in_recent_drawdown else 0
        paper_pnl = 0.8 if in_recent_drawdown else -0.8
        fill_price = 20 if in_recent_drawdown else 80
        rows.append(
            {
                "dataset_id": "fixture-dataset",
                "dataset_schema_version": "weather-crypto-ml-dataset-v1",
                "feature_schema_version": "weather-crypto-selective-v1",
                "label_schema_version": "weather-crypto-label-v1",
                "row_id": f"recent-drawdown-row-{index}",
                "decision_id": f"recent-drawdown-decision-{index}",
                "domain": "crypto",
                "segment_key": "crypto|XRP|crypto_price_threshold|yes",
                "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                "decision_timestamp_utc": decision_time.isoformat().replace("+00:00", "Z"),
                "market_ticker": f"RECENT-DRAWDOWN-{index}",
                "selected_side": "YES",
                "market_probability": 0.2,
                "model_candidate_probability": 0.8,
                "paper_fill_price_cents": fill_price,
                "outcome_label": selected_side_won,
                "paper_pnl_usd": paper_pnl,
                "features": {
                    "domain": "crypto",
                    "market_probability": 0.2,
                    "model_candidate_probability": 0.8,
                    "paper_fill_price_cents": fill_price,
                    "horizon_minutes": 20,
                    "liquidity_score": 0.5,
                    "depth_contracts": 100,
                    "spread_cents": 2,
                    "feature_cutoff_utc": cutoff_time.isoformat().replace("+00:00", "Z"),
                },
                "label": {
                    "selected_side_won": selected_side_won,
                    "paper_pnl_usd": paper_pnl,
                    "settlement_source": "fixture",
                    "label_quality": "official_or_source_backed",
                },
                "feature_hash": f"recent-drawdown-feature-{index}",
                "label_hash": f"recent-drawdown-label-{index}",
                "source_hash": f"recent-drawdown-source-{index}",
                "row_hash": f"recent-drawdown-row-hash-{index}",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        )

    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    scorecard = payload["walk_forward_validation"]["train_only_profit_selector"]["consistency_scorecard"]
    candidate = scorecard["live_prep_category_candidates"][0]
    assert scorecard["consistent_profitable_category_count"] == 0
    assert candidate["domain"] == "crypto"
    assert candidate["consistent_profitable"] is True
    assert candidate["directional_accuracy"] >= 0.6
    assert candidate["paper_pnl_usd"] > 0
    assert candidate["recent_consistency_passed"] is False
    assert candidate["recent_windows_profitable"] is False
    assert candidate["recent_unprofitable_window_sizes"] == [25, 50]
    assert candidate["meets_live_prep_accuracy_profit_consistency"] is False
    assert scorecard["by_domain"]["crypto"]["recent_consistency_passed"] is False
    _assert_no_live_true(payload)


def test_weather_crypto_ml_model_promotes_challenger_only_to_shadow_certification_not_live():
    model = load_module("kalshi_weather_crypto_ml_model_promote_shadow", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(300, candidate_good=True, positive_pnl=True)
    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    assert payload["champion_model_id"] == "weather-crypto-current-candidate-probability-v1"
    assert payload["walk_forward_validation"]["challenger_beats_market"] is True
    assert payload["certification"]["ml_9_9_ready"] is True
    assert payload["certification"]["ml_10_ready"] is False
    assert "human_live_trading_approval" in payload["certification"]["missing_requirements_for_10"]
    assert len(payload["twenty_improvement_controls"]) == 20
    assert all(control["status"] == "implemented" for control in payload["twenty_improvement_controls"])
    assert payload["ml_build_gap_summary"]["all_build_gaps_complete"] is True
    assert payload["ml_build_gap_summary"]["build_completion_grade"] == 10.0
    assert payload["ml_build_gap_summary"]["empirical_profit_certification_complete"] is True
    assert payload["promotion_decision"]["accepted_for_live"] is False
    assert payload["live_order_allowed"] is False


def test_weather_crypto_learning_accelerator_calculates_row_deficit_and_no_live():
    accelerator = load_module("kalshi_weather_crypto_learning_accelerator_deficit", ROOT / "kalshi_weather_crypto_learning_accelerator.py")
    dataset = {
        "ok": True,
        "row_count": 215,
        "domain_counts": {
            "weather": {"rows": 158},
            "crypto": {"rows": 57},
        },
        "live_order_allowed": False,
    }
    model = {
        "ok": True,
        "dataset": {"row_count": 215, "domain_counts": {"weather": 158, "crypto": 57}},
        "certification": {
            "ml_9_9_ready": False,
            "ml_10_ready": False,
            "missing_requirements_for_9_9": ["at_least_250_leakage_guarded_rows"],
            "missing_requirements_for_10": ["human_live_trading_approval"],
        },
        "walk_forward_validation": {
            "challenger_beats_market": False,
            "champion_model_id": "market-implied-probability-champion-v1",
            "current_challenger": {"expected_calibration_error": 0.12},
            "train_only_profit_selector": {
                "model_id": "weather-crypto-train-only-profit-selector-v1",
                "trade_count": 78,
                "directional_accuracy": 0.704,
                "paper_pnl_usd": 14.39,
                "beats_no_trade": True,
                "beats_observed_current_model": True,
                "hypothesis_only": True,
                "forward_paper_required": True,
                "by_rule": {
                    "segment:crypto|XRP|crypto_price_threshold|no:inverse_selected_side": {
                        "rule_key": "segment:crypto|XRP|crypto_price_threshold|no:inverse_selected_side",
                        "selector_scope": "segment",
                        "selector_key": "crypto|XRP|crypto_price_threshold|no",
                        "selected_policy": "inverse_selected_side",
                        "domain": "crypto",
                        "test_rows": 42,
                        "trade_count": 42,
                        "wins": 31,
                        "directional_accuracy": 0.738095,
                        "paper_pnl_usd": 8.12,
                        "forward_shadow_candidate": True,
                        "live_order_allowed": False,
                        "auto_live_promotion_allowed": False,
                    }
                },
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
        },
        "drift_diagnostics": {"alert_count": 1, "alerts": ["feature_mean_shift:horizon_minutes"]},
        "live_order_allowed": False,
    }
    payload = accelerator.build_accelerator(
        dataset,
        model,
        {"status": "shadow_learning_only", "live_order_allowed": False},
        [],
        [],
        [],
        generated_at_utc="2026-05-22T05:00:00Z",
        now=datetime(2026, 5, 22, 5, tzinfo=timezone.utc),
    )

    assert payload["row_deficits"]["rows_needed"] == 35
    assert payload["row_deficits"]["domain_deficits"] == {"weather": 0, "crypto": 0}
    assert payload["candidate_acquisition_targets"][0]["target_count"] == 35
    assert "collect_near_resolution_weather_crypto_rows" in payload["next_actions"]
    assert payload["proof_deficits"]["profit_selector_pnl_usd"] == 14.39
    assert payload["proof_deficits"]["profit_selector_accuracy"] == 0.704
    assert payload["proof_deficits"]["profit_selector_forward_paper_required"] is True
    assert "collect_forward_shadow_for_profit_selector_segments" in payload["next_actions"]
    assert "run_ranked_profit_selector_forward_targets" in payload["next_actions"]
    assert payload["profit_selector_forward_plan"]["status"] == "ranked_targets_ready"
    assert payload["profit_selector_forward_targets"][0]["selector_key"] == "crypto|XRP|crypto_price_threshold|no"
    assert payload["profit_selector_forward_targets"][0]["candidate_side_transform"] == "invert_current_candidate_side"
    assert payload["profit_selector_forward_targets"][0]["target_forward_outcomes"] == 100
    assert len(payload["learning_speed_plan"]) == 10
    _assert_no_live_true(payload)


def test_weather_crypto_learning_accelerator_counts_fresh_profit_selector_forward_progress():
    accelerator = load_module("kalshi_weather_crypto_learning_accelerator_forward_progress", ROOT / "kalshi_weather_crypto_learning_accelerator.py")
    selector_key = "crypto|XRP|crypto_price_threshold|no"
    model = {
        "ok": True,
        "dataset": {"row_count": 300, "domain_counts": {"weather": 100, "crypto": 200}},
        "generated_at_utc": "2026-05-22T06:00:00Z",
        "certification": {"ml_9_9_ready": False, "ml_10_ready": False},
        "walk_forward_validation": {
            "challenger_beats_market": True,
            "test_window": {"end_utc": "2026-05-22T05:10:00Z"},
            "current_challenger": {"expected_calibration_error": 0.03},
            "train_only_profit_selector": {
                "model_id": "weather-crypto-train-only-profit-selector-v1",
                "trade_count": 120,
                "directional_accuracy": 0.7,
                "paper_pnl_usd": 12.0,
                "beats_no_trade": True,
                "beats_observed_current_model": True,
                "hypothesis_only": True,
                "forward_paper_required": True,
                "by_rule": {
                    f"segment:{selector_key}:inverse_selected_side": {
                        "rule_key": f"segment:{selector_key}:inverse_selected_side",
                        "selector_scope": "segment",
                        "selector_key": selector_key,
                        "selected_policy": "inverse_selected_side",
                        "domain": "crypto",
                        "test_rows": 42,
                        "trade_count": 42,
                        "wins": 31,
                        "directional_accuracy": 0.738095,
                        "paper_pnl_usd": 8.12,
                        "forward_shadow_candidate": True,
                        "live_order_allowed": False,
                        "auto_live_promotion_allowed": False,
                    }
                },
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
        },
        "drift_diagnostics": {"alert_count": 0, "alerts": []},
        "live_order_allowed": False,
    }

    def decision(decision_id: str, timestamp_utc: str, *, key: str = selector_key, expected_result_known_time_utc: str = "2026-05-22T05:30:00Z") -> dict:
        return {
            "decision_id": decision_id,
            "timestamp_utc": timestamp_utc,
            "expected_result_known_time_utc": expected_result_known_time_utc,
            "market_ticker": f"XRP-{decision_id}",
            "market_category": "crypto",
            "selected_executable_side": "NO",
            "side": "NO",
            "paper_fill_price_cents": 30,
            "profit_selector_forward_shadow": {
                "source_selector_key": key,
                "selected_policy": "inverse_selected_side",
                "candidate_side_transform": "invert_current_candidate_side",
                "forward_proof_epoch_start_utc": "2026-05-22T05:00:00Z",
                "forward_proof_epoch_source": "walk_forward_test_window_end",
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
            "live_order_allowed": False,
            "auto_live_promotion_allowed": False,
        }

    decisions = [
        decision("fresh-win-1", "2026-05-22T05:05:00Z"),
        decision("fresh-win-2", "2026-05-22T05:06:00Z"),
        decision("fresh-loss-1", "2026-05-22T05:07:00Z"),
        decision("stale-win", "2026-05-22T04:59:00Z"),
        decision("wrong-segment", "2026-05-22T05:08:00Z", key="crypto|ETH|crypto_price_threshold|yes"),
        decision("pending-due", "2026-05-22T05:09:00Z"),
        decision("pending-future", "2026-05-22T06:00:00Z", expected_result_known_time_utc="2026-05-22T06:45:00Z"),
    ]
    shadow_outcomes = [
        {"decision_id": "fresh-win-1", "resolved": True, "outcome_yes": 0, "settlement_checked_at_utc": "2026-05-22T05:20:00Z"},
        {"decision_id": "fresh-win-2", "resolved": True, "outcome_yes": 0, "settlement_checked_at_utc": "2026-05-22T05:21:00Z"},
        {"decision_id": "fresh-loss-1", "resolved": True, "outcome_yes": 1, "settlement_checked_at_utc": "2026-05-22T05:22:00Z"},
        {"decision_id": "stale-win", "resolved": True, "outcome_yes": 0, "settlement_checked_at_utc": "2026-05-22T05:23:00Z"},
        {"decision_id": "wrong-segment", "resolved": True, "outcome_yes": 0, "settlement_checked_at_utc": "2026-05-22T05:24:00Z"},
    ]

    payload = accelerator.build_accelerator(
        {"ok": True, "row_count": 300, "domain_counts": {"weather": {"rows": 100}, "crypto": {"rows": 200}}},
        model,
        {"status": "shadow_learning_only", "live_order_allowed": False},
        decisions,
        [],
        shadow_outcomes,
        generated_at_utc="2026-05-22T06:30:00Z",
        now=datetime(2026, 5, 22, 6, 30, tzinfo=timezone.utc),
    )

    target = payload["profit_selector_forward_targets"][0]
    progress = payload["profit_selector_forward_progress"]["target_progress"][f"{selector_key}::inverse_selected_side::invert_current_candidate_side"]
    assert target["fresh_forward_outcomes_collected"] == 3
    assert target["fresh_forward_outcomes_needed"] == 97
    assert target["fresh_forward_accuracy"] == 0.666667
    assert target["fresh_forward_pnl_usd"] == 1.1
    assert target["fresh_forward_proof_passed"] is False
    assert target["pending_forward_shadow_count"] == 2
    assert target["due_forward_shadow_count"] == 1
    assert target["next_expected_result_known_time_utc"] == "2026-05-22T06:45:00Z"
    assert target["forward_proof_epoch_start_utc"] == "2026-05-22T05:00:00Z"
    assert target["current_model_forward_proof_epoch_start_utc"] == "2026-05-22T05:10:00Z"
    assert progress["fresh_forward_outcomes_collected"] == 3
    assert progress["counted_forward_proof_epoch_start_utc"] == "2026-05-22T05:00:00Z"
    assert progress["current_model_forward_proof_epoch_start_utc"] == "2026-05-22T05:10:00Z"
    assert progress["unique_market_count"] == 3
    assert payload["profit_selector_forward_plan"]["top_target_fresh_forward_outcomes_collected"] == 3
    assert payload["profit_selector_forward_plan"]["top_target_fresh_forward_outcomes_needed"] == 97
    assert payload["profit_selector_forward_plan"]["top_target_pending_forward_shadow_count"] == 2
    assert payload["profit_selector_forward_plan"]["top_target_due_forward_shadow_count"] == 1
    assert payload["profit_selector_forward_plan"]["due_forward_shadow_count"] == 1
    assert payload["profit_selector_forward_plan"]["next_recommended_resolution_utc"] == "2026-05-22T06:32:00Z"
    assert payload["profit_selector_forward_plan"]["resolution_recommended_action"] == "retry_due_profit_selector_forward_shadow_resolution"
    assert "resolve_due_profit_selector_forward_shadows" in payload["next_actions"]
    _assert_no_live_true(payload)


def test_weather_crypto_learning_accelerator_prioritizes_profitable_forward_targets():
    accelerator = load_module("kalshi_weather_crypto_learning_accelerator_profit_ranking", ROOT / "kalshi_weather_crypto_learning_accelerator.py")
    xrp_key = "crypto|XRP|crypto_price_threshold|no"
    sol_key = "crypto|SOL|crypto_price_threshold|yes"
    ada_key = "crypto|ADA|crypto_price_threshold|no"
    model = {
        "generated_at_utc": "2026-05-22T06:00:00Z",
        "walk_forward_validation": {
            "test_window": {"end_utc": "2026-05-22T05:10:00Z"},
            "train_only_profit_selector": {
                "by_rule": {
                    f"segment:{xrp_key}:inverse_selected_side": {
                        "selector_scope": "segment",
                        "selector_key": xrp_key,
                        "selected_policy": "inverse_selected_side",
                        "domain": "crypto",
                        "trade_count": 140,
                        "directional_accuracy": 0.74,
                        "paper_pnl_usd": 12.0,
                    },
                    f"segment:{sol_key}:inverse_selected_side": {
                        "selector_scope": "segment",
                        "selector_key": sol_key,
                        "selected_policy": "inverse_selected_side",
                        "domain": "crypto",
                        "trade_count": 100,
                        "directional_accuracy": 0.82,
                        "paper_pnl_usd": 8.0,
                    },
                    f"segment:{ada_key}:inverse_selected_side": {
                        "selector_scope": "segment",
                        "selector_key": ada_key,
                        "selected_policy": "inverse_selected_side",
                        "domain": "crypto",
                        "trade_count": 100,
                        "directional_accuracy": 0.72,
                        "paper_pnl_usd": 6.0,
                    },
                },
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            },
        },
    }
    progress = {
        "target_progress": {
            f"{xrp_key}::inverse_selected_side::invert_current_candidate_side": {
                "fresh_forward_outcomes_collected": 21,
                "fresh_forward_accuracy": 0.714286,
                "fresh_forward_pnl_usd": -0.8,
                "fresh_forward_proof_passed": False,
                "live_order_allowed": False,
            },
            f"{sol_key}::inverse_selected_side::invert_current_candidate_side": {
                "fresh_forward_outcomes_collected": 6,
                "fresh_forward_accuracy": 0.833333,
                "fresh_forward_pnl_usd": 0.52,
                "fresh_forward_proof_passed": False,
                "live_order_allowed": False,
            },
            f"{ada_key}::inverse_selected_side::invert_current_candidate_side": {
                "fresh_forward_outcomes_collected": 38,
                "fresh_forward_accuracy": 0.710526,
                "fresh_forward_pnl_usd": -0.03,
                "fresh_forward_proof_passed": False,
                "live_order_allowed": False,
            },
        },
        "live_order_allowed": False,
    }

    targets = accelerator._profit_selector_forward_targets(model, forward_progress=progress, pending_forward={})

    assert [target["selector_key"] for target in targets[:3]] == [sol_key, ada_key, xrp_key]
    assert targets[0]["fresh_forward_profit_status"] == "fresh_forward_profitable"
    assert targets[0]["forward_sampling_allowed"] is True
    assert targets[1]["fresh_forward_profit_status"] == "fresh_forward_near_breakeven_high_accuracy"
    assert targets[1]["fresh_forward_profit_sort_bucket"] == 1
    assert targets[1]["forward_sampling_allowed"] is True
    assert targets[1]["forward_sampling_pause_reason"] is None
    assert targets[1]["minimum_fresh_forward_material_loss_pause_usd"] == -0.5
    assert targets[2]["fresh_forward_profit_status"] == "fresh_forward_unprofitable"
    assert targets[2]["forward_sampling_allowed"] is False
    assert targets[2]["forward_sampling_pause_reason"] == "fresh_forward_unprofitable_after_minimum_sample"
    _assert_no_live_true({"targets": targets})


def test_crypto_profit_selector_target_loader_skips_paused_losing_fresh_targets(tmp_path):
    crypto = load_module("kalshi_crypto_profit_selector_target_filter", ROOT / "kalshi_crypto_evidence.py")
    path = tmp_path / "accelerator.json"
    path.write_text(
        json.dumps(
            {
                "profit_selector_forward_targets": [
                    {
                        "domain": "crypto",
                        "selector_key": "crypto|BTC|crypto_price_threshold|no",
                        "candidate_side_transform": "invert_current_candidate_side",
                        "forward_sampling_allowed": True,
                        "live_order_allowed": False,
                    },
                    {
                        "domain": "crypto",
                        "selector_key": "crypto|XRP|crypto_price_threshold|no",
                        "candidate_side_transform": "invert_current_candidate_side",
                        "forward_sampling_allowed": False,
                        "fresh_forward_pnl_usd": -0.08,
                        "fresh_forward_outcomes_collected": 28,
                        "live_order_allowed": False,
                    },
                ],
                "live_order_allowed": False,
            }
        )
    )

    targets = crypto._load_profit_selector_targets(path)

    assert list(targets) == ["crypto|BTC|crypto_price_threshold|no"]
    _assert_no_live_true({"targets": targets})


def test_weather_crypto_learning_accelerator_turns_drift_alerts_into_acquisition_tasks():
    accelerator = load_module("kalshi_weather_crypto_learning_accelerator_drift", ROOT / "kalshi_weather_crypto_learning_accelerator.py")
    targets = accelerator._candidate_acquisition_targets(
        {
            "current_rows": 250,
            "rows_needed": 0,
            "domain_deficits": {"weather": 0, "crypto": 0},
        },
        {
            "drift_diagnostics": {
                "alert_count": 2,
                "alerts": ["domain_share_shift:crypto", "feature_mean_shift:horizon_minutes"],
            },
            "calibration_feedback": {
                "calibration_error_attribution": [
                    {
                        "reason": "domain_candidate_calibration_error",
                        "domain": "crypto",
                        "severity": "high",
                    }
                ]
            },
        },
    )

    actions = {target["action"] for target in targets}
    assert "collect_same_window_domain_rows" in actions
    assert "collect_near_resolution_rows" in actions
    assert "collect_calibration_repair_rows" in actions
    _assert_no_live_true(targets)


def test_weather_crypto_ml_model_certification_fails_closed_on_leakage_or_small_sample():
    model = load_module("kalshi_weather_crypto_ml_model_certification", ROOT / "kalshi_weather_crypto_ml_model.py")
    rows = _weather_crypto_model_rows(40, candidate_good=True, positive_pnl=True)
    payload = model.build_model_report(
        _weather_crypto_model_dataset(rows, leakage_rejected_count=1),
        rows,
        generated_at_utc="2026-05-22T05:00:00Z",
    )

    missing = set(payload["certification"]["missing_requirements_for_9_9"])
    assert "at_least_250_leakage_guarded_rows" in missing
    assert "zero_dataset_leakage_rejections" in missing
    assert payload["certification"]["ml_9_9_ready"] is False
    assert payload["certification"]["ml_10_ready"] is False
    assert payload["leakage_audit"]["passed"] is True
    assert payload["ml_build_gap_summary"]["all_build_gaps_complete"] is True
    assert payload["ml_build_gap_summary"]["build_open_count"] == 0
    assert payload["live_order_allowed"] is False


def test_weather_crypto_ml_promotes_only_shadow_qualified_segments():
    ml = load_module("kalshi_weather_crypto_ml_readiness", ROOT / "kalshi_weather_crypto_ml.py")
    decisions = []
    shadow_outcomes = []
    for index in range(25):
        decision_id = f"weather-shadow-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "timestamp_utc": "2026-05-21T12:00:00Z",
                "market_ticker": f"KXHIGHTEMP-26MAY21SEA-T{70 + index}",
                "market_category": "weather",
                "strategy_bucket": "weather_model_fast_evidence",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "NO",
                "side": "NO",
                "paper_fill_price_cents": 5,
                "market_price_cents": 5,
                "selected_side_fair_probability": 0.99,
                "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
                "weather_city": "SEATTLE",
                "weather_target_date": "2026-05-21",
                "weather_market_type": "temperature",
                "weather_threshold": 70 + index,
                "weather_direction": "above",
                "forecast_value": 60,
                "source_fetched_at_utc": "2026-05-21T11:58:00Z",
                "evidence_tier": "shadow",
                "simulated_size_usd": 0,
                "live_order_allowed": False,
            }
        )
        shadow_outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0,
                "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
                "settlement_source": "fixture",
                "shadow_learning_outcome": True,
            }
        )

    payload = ml.build_readiness(decisions, [], shadow_outcomes, generated_at_utc="2026-05-22T05:00:00Z")
    assert payload["status"] == "shadow_qualified_review"
    assert payload["accepted_paper_allowed_segment_count"] == 0
    assert payload["paper_betting_allowed_segment_count"] == 1
    assert payload["paper_betting"]["allowed_segment_count"] == 1
    assert payload["promotion_gap"]["status"] == "tiny_paper_available"
    assert payload["promotion_gap"]["allowed_segment_count"] == 1
    assert payload["promotion_gap"]["allowed_segments"][0]["segment_key"] == "weather|SEATTLE|temperature|above|no"
    assert payload["promotion_gap"]["allowed_segments"][0]["criteria"][0]["label"] == "Count"
    assert payload["active_learning_queue"][0]["action"] == "open_tiny_paper_probe"
    assert payload["active_learning_queue"][0]["live_order_allowed"] is False
    assert payload["shadow_qualified_segments"][0]["promotion_stage"] == "shadow_qualified"
    assert payload["shadow_qualified_segments"][0]["next_candidate_stage"] == "tiny_accepted_forward_paper"
    assert payload["shadow_qualified_segments"][0]["paper_betting_allowed"] is True
    assert payload["shadow_qualified_segments"][0]["shadow_accuracy"] == 1.0
    assert payload["shadow_qualified_segments"][0]["shadow_pnl_usd"] > 0
    assert payload["live_order_allowed"] is False


def test_weather_crypto_ml_does_not_shadow_qualify_repeated_single_market():
    ml = load_module("kalshi_weather_crypto_ml_unique_market_guard", ROOT / "kalshi_weather_crypto_ml.py")
    decisions = []
    shadow_outcomes = []
    for index in range(25):
        decision_id = f"weather-shadow-repeat-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "timestamp_utc": f"2026-05-21T12:{index:02d}:00Z",
                "market_ticker": "KXHIGHTEMP-26MAY21SEA-T70",
                "market_category": "weather",
                "strategy_bucket": "weather_model_fast_evidence",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "NO",
                "side": "NO",
                "paper_fill_price_cents": 5,
                "market_price_cents": 5,
                "selected_side_fair_probability": 0.99,
                "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
                "weather_city": "SEATTLE",
                "weather_target_date": "2026-05-21",
                "weather_market_type": "temperature",
                "weather_threshold": 70,
                "weather_direction": "above",
                "forecast_value": 60,
                "source_fetched_at_utc": "2026-05-21T11:58:00Z",
                "evidence_tier": "shadow",
                "simulated_size_usd": 0,
                "paper_candidate_dedupe_variant": "weather_target_shadow_refresh_bucket",
                "paper_observation_bucket_utc": f"2026-05-21T{12 + (index // 2):02d}:00:00Z",
                "live_order_allowed": False,
            }
        )
        shadow_outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0,
                "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
                "settlement_source": "fixture",
                "shadow_learning_outcome": True,
            }
        )

    payload = ml.build_readiness(decisions, [], shadow_outcomes, generated_at_utc="2026-05-22T05:00:00Z")
    segment = payload["segments"][0]

    assert payload["status"] == "shadow_learning_only"
    assert payload["paper_betting_allowed_segment_count"] == 0
    assert segment["shadow_scored"] == 25
    assert segment["shadow_unique_market_count"] == 1
    assert segment["shadow_qualified_min_unique_markets"] == 5
    assert segment["promotion_stage"] == "shadow_learn"
    assert segment["paper_betting_allowed"] is False
    assert payload["promotion_gap"]["status"] == "blocked"
    assert payload["promotion_gap"]["top_blocker"] == "markets"
    assert payload["promotion_gap"]["blocker_counts"]["markets"] == 1
    _assert_no_live_true(payload)


def test_weather_crypto_ml_frontier_targets_focus_under_sampled_positive_segments():
    ml = load_module("kalshi_weather_crypto_ml_frontier_targets", ROOT / "kalshi_weather_crypto_ml.py")
    decisions = []
    shadow_outcomes = []
    for index in range(10):
        decision_id = f"weather-frontier-{index}"
        won = index < 8
        decisions.append(
            {
                "decision_id": decision_id,
                "timestamp_utc": "2026-05-21T12:00:00Z",
                "market_ticker": f"KXHIGHTEMP-26MAY21DEN-T{70 + index}",
                "market_category": "weather",
                "strategy_bucket": "weather_model_fast_evidence",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "NO",
                "side": "NO",
                "paper_fill_price_cents": 55,
                "market_price_cents": 55,
                "selected_side_fair_probability": 0.80,
                "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
                "weather_city": "DENVER",
                "weather_target_date": "2026-05-21",
                "weather_market_type": "high_temperature",
                "weather_threshold": 70 + index,
                "weather_direction": "above",
                "forecast_value": 60,
                "source_fetched_at_utc": "2026-05-21T11:58:00Z",
                "evidence_tier": "shadow",
                "simulated_size_usd": 0,
                "live_order_allowed": False,
            }
        )
        shadow_outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0 if won else 1,
                "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
                "settlement_source": "fixture",
                "shadow_learning_outcome": True,
            }
        )

    payload = ml.build_readiness(decisions, [], shadow_outcomes, generated_at_utc="2026-05-22T05:00:00Z")

    assert payload["status"] == "shadow_learning_only"
    assert payload["paper_betting_allowed_segment_count"] == 0
    assert payload["segment_frontier_target_count"] == 1
    target = payload["segment_frontier_acquisition_targets"][0]
    assert target["action"] == "collect_segment_specific_shadow_labels"
    assert target["segment_key"] == "weather|DENVER|high_temperature|above|no"
    assert target["labels_needed_to_shadow_qualified"] == 15
    assert target["shadow_accuracy"] == 0.8
    assert target["shadow_pnl_usd"] > 0
    assert "kalshi_weather_paper_candidates.py" in target["recommended_command"]
    assert payload["promotion_gap"]["near_miss_segment_count"] == 1
    assert payload["promotion_gap"]["near_miss_segments"][0]["segment_key"] == "weather|DENVER|high_temperature|above|no"
    assert payload["promotion_gap"]["near_miss_segments"][0]["primary_blocker"] == "count"
    assert payload["active_learning_queue"][0]["action"] == "collect_segment_specific_shadow_labels"
    assert payload["active_learning_queue"][0]["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_weather_crypto_ml_calibration_repair_blocks_brier_underperformance():
    ml = load_module("kalshi_weather_crypto_ml_calibration_repair", ROOT / "kalshi_weather_crypto_ml.py")
    decisions = []
    shadow_outcomes = []
    for index in range(25):
        decision_id = f"weather-brier-repair-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "timestamp_utc": "2026-05-21T12:00:00Z",
                "market_ticker": f"KXHIGHTEMP-26MAY21SEA-BRIER{index}",
                "market_category": "weather",
                "strategy_bucket": "weather_model_fast_evidence",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "NO",
                "side": "NO",
                "paper_fill_price_cents": 95,
                "market_price_cents": 95,
                "selected_side_fair_probability": 0.55,
                "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
                "weather_city": "SEATTLE",
                "weather_target_date": "2026-05-21",
                "weather_market_type": "temperature",
                "weather_threshold": 70 + index,
                "weather_direction": "above",
                "forecast_value": 60,
                "source_fetched_at_utc": "2026-05-21T11:58:00Z",
                "evidence_tier": "shadow",
                "simulated_size_usd": 0,
                "live_order_allowed": False,
            }
        )
        shadow_outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0,
                "settlement_checked_at_utc": "2026-05-22T04:05:00Z",
                "settlement_source": "fixture",
                "shadow_learning_outcome": True,
            }
        )

    payload = ml.build_readiness(decisions, [], shadow_outcomes, generated_at_utc="2026-05-22T05:00:00Z")
    repair = payload["promotion_gap"]["calibration_repair"]

    assert payload["status"] == "shadow_learning_only"
    assert payload["promotion_gap"]["top_blocker"] == "brier"
    assert payload["promotion_gap"]["next_action"].startswith("Repair Brier")
    assert repair["status"] == "repair_required"
    assert repair["top_blocker"] == "brier"
    assert repair["segments"][0]["action"] == "shrink_to_market"
    assert repair["segments"][0]["candidate_weight_cap"] < 0.95
    assert repair["segments"][0]["accepted_paper_allowed"] is False
    _assert_no_live_true(payload)


def test_weather_crypto_ml_uses_shadow_qualified_readiness_for_tiny_paper_probe(tmp_path, monkeypatch):
    ml = load_module("kalshi_weather_crypto_ml_probe_stage", ROOT / "kalshi_weather_crypto_ml.py")
    readiness_path = tmp_path / "weather_crypto_ml_readiness.json"
    readiness_path.write_text(
        json.dumps(
            {
                "segments": [
                    {
                        "segment_key": "weather|SEATTLE|temperature|above|no",
                        "domain": "weather",
                        "promotion_stage": "shadow_qualified",
                        "shadow_scored": 25,
                        "shadow_accuracy": 1.0,
                        "shadow_pnl_usd": 23.75,
                        "quarantined_contracts": 0,
                        "live_order_allowed": False,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ml, "ML_READINESS_PATH", readiness_path)
    record = {
        "decision_id": "weather-probe-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXHIGHTEMP-26MAY21SEA-T70",
        "market_category": "weather",
        "strategy_bucket": "weather_model_fast_evidence",
        "fair_value_source_type": "weather_model",
        "selected_executable_side": "NO",
        "side": "NO",
        "paper_fill_price_cents": 5,
        "market_price_cents": 5,
        "selected_side_fair_probability": 0.99,
        "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
        "weather_city": "SEATTLE",
        "weather_target_date": "2026-05-21",
        "weather_market_type": "temperature",
        "weather_threshold": 70,
        "weather_direction": "above",
        "forecast_value": 60,
        "source_fetched_at_utc": "2026-05-21T11:58:00Z",
        "evidence_tier": "exploration",
        "simulated_size_usd": 1,
        "selective_ml_promotion_stage": "shadow_learn",
        "selective_ml": {"promotion_stage": "shadow_learn"},
        "live_order_allowed": False,
    }

    annotated = ml.annotate_candidate(record)
    gate = ml.pretrade_ml_gate(record)

    assert annotated["selective_ml_promotion_stage"] == "tiny_accepted_forward_paper"
    assert annotated["selective_ml"]["accepted_paper_allowed"] is True
    assert annotated["selective_ml"]["paper_betting_allowed"] is True
    assert annotated["selective_ml"]["max_simulated_size_usd"] == 1.0
    assert gate["accepted_paper_allowed"] is True
    assert gate["live_order_allowed"] is False


def test_weather_crypto_ml_markov_overlay_risks_down_tiny_paper_probe(tmp_path, monkeypatch):
    ml = load_module("kalshi_weather_crypto_ml_markov_overlay_gate", ROOT / "kalshi_weather_crypto_ml.py")
    readiness_path = tmp_path / "weather_crypto_ml_readiness.json"
    model_path = tmp_path / "weather_crypto_ml_model.json"
    readiness_path.write_text(
        json.dumps(
            {
                "segments": [
                    {
                        "segment_key": "weather|SEATTLE|temperature|above|no",
                        "domain": "weather",
                        "promotion_stage": "shadow_qualified",
                        "shadow_scored": 25,
                        "shadow_accuracy": 1.0,
                        "shadow_pnl_usd": 23.75,
                        "quarantined_contracts": 0,
                        "live_order_allowed": False,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    model_path.write_text(
        json.dumps(
            {
                "markov_ml_risk_overlay": {
                    "enabled": True,
                    "state": "validated_shadow_ml_overlay",
                    "validation_method": "markov_chronological_holdout",
                    "markov_weight": 0.35,
                    "can_authorize_trade": False,
                    "live_order_allowed": False,
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ml, "ML_READINESS_PATH", readiness_path)
    monkeypatch.setattr(ml, "ML_MODEL_ARTIFACT_PATH", model_path)
    record = {
        "decision_id": "weather-probe-markov-risk-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXHIGHTEMP-26MAY21SEA-T70",
        "market_category": "weather",
        "strategy_bucket": "weather_model_fast_evidence",
        "fair_value_source_type": "weather_model",
        "selected_executable_side": "NO",
        "side": "NO",
        "paper_fill_price_cents": 5,
        "market_price_cents": 5,
        "selected_side_fair_probability": 0.99,
        "expected_result_known_time_utc": "2026-05-22T04:00:00Z",
        "weather_city": "SEATTLE",
        "weather_target_date": "2026-05-21",
        "weather_market_type": "temperature",
        "weather_threshold": 70,
        "weather_direction": "above",
        "forecast_value": 60,
        "source_fetched_at_utc": "2026-05-21T11:58:00Z",
        "evidence_tier": "exploration",
        "simulated_size_usd": 1,
        "selective_ml_promotion_stage": "tiny_accepted_forward_paper",
        "markov_feature_present": 1,
        "markov_confidence_score": 7.0,
        "markov_taker_trap_flag": 1,
        "markov_selected_side_taker_edge_pct": -0.8,
        "live_order_allowed": False,
    }

    gate = ml.pretrade_ml_gate(record)

    assert gate["accepted_paper_allowed"] is False
    overlay_gate = gate["markov_ml_risk_overlay_gate"]
    assert overlay_gate["applies"] is True
    assert overlay_gate["risk_down_applied"] is True
    assert "markov_taker_trap_negative_taker_edge" in overlay_gate["blockers"]
    assert overlay_gate["can_authorize_trade"] is False
    assert overlay_gate["live_order_allowed"] is False


def test_weather_crypto_ml_markov_overlay_reads_nested_microstructure(tmp_path, monkeypatch):
    ml = load_module("kalshi_weather_crypto_ml_markov_nested_overlay_gate", ROOT / "kalshi_weather_crypto_ml.py")
    readiness_path = tmp_path / "weather_crypto_ml_readiness.json"
    model_path = tmp_path / "weather_crypto_ml_model.json"
    readiness_path.write_text(
        json.dumps(
            {
                "segments": [
                    {
                        "segment_key": "crypto|BTC|crypto_price_threshold|yes",
                        "domain": "crypto",
                        "promotion_stage": "shadow_qualified",
                        "shadow_scored": 25,
                        "shadow_accuracy": 1.0,
                        "shadow_pnl_usd": 10.0,
                        "quarantined_contracts": 0,
                        "live_order_allowed": False,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    model_path.write_text(
        json.dumps(
            {
                "markov_ml_risk_overlay": {
                    "enabled": True,
                    "state": "validated_shadow_ml_overlay",
                    "validation_method": "markov_chronological_holdout",
                    "markov_weight": 0.4,
                    "can_authorize_trade": False,
                    "live_order_allowed": False,
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ml, "ML_READINESS_PATH", readiness_path)
    monkeypatch.setattr(ml, "ML_MODEL_ARTIFACT_PATH", model_path)
    record = {
        "decision_id": "crypto-nested-markov-risk-1",
        "timestamp_utc": "2026-05-21T12:00:00Z",
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "market_title": "BTC price up in next 15 mins?",
        "market_category": "crypto",
        "series_ticker": "KXBTC15M",
        "strategy_bucket": "crypto_spot_model",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "selected_executable_side": "YES",
        "side": "YES",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "selected_side_fair_probability": 0.65,
        "expected_result_known_time_utc": "2026-05-21T12:15:00Z",
        "crypto_evidence": {
            "asset": "BTC",
            "market_type": "crypto_price_threshold",
            "threshold_usd": 100000,
            "spot_observed_at_utc": "2026-05-21T11:59:00Z",
            "spot_provider": "fixture",
        },
        "selective_ml_promotion_stage": "tiny_accepted_forward_paper",
        "markov_microstructure": {
            "confidence_score": 3.3,
            "confidence_caps": ["current_bucket_has_fewer_than_30_transitions"],
            "execution": {
                "yes_maker_edge_pct": -24.6,
                "yes_taker_edge_pct": -30.56,
            },
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }

    gate = ml.pretrade_ml_gate(record)

    assert gate["accepted_paper_allowed"] is False
    overlay_gate = gate["markov_ml_risk_overlay_gate"]
    assert overlay_gate["applies"] is True
    assert overlay_gate["risk_down_applied"] is True
    assert "markov_low_sample" in overlay_gate["warnings"]
    assert "markov_low_confidence" in overlay_gate["blockers"]
    assert overlay_gate["markov_confidence_score"] == 3.3
    assert overlay_gate["live_order_allowed"] is False


def test_weather_crypto_ml_markov_low_sample_warns_without_blocking_clean_probe(tmp_path, monkeypatch):
    ml = load_module("kalshi_weather_crypto_ml_markov_low_sample_warning", ROOT / "kalshi_weather_crypto_ml.py")
    model_path = tmp_path / "weather_crypto_ml_model.json"
    model_path.write_text(
        json.dumps(
            {
                "markov_ml_risk_overlay": {
                    "enabled": True,
                    "state": "validated_shadow_ml_overlay",
                    "validation_method": "markov_chronological_holdout",
                    "markov_weight": 0.4,
                    "can_authorize_trade": False,
                    "live_order_allowed": False,
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ml, "ML_MODEL_ARTIFACT_PATH", model_path)
    record = {
        "decision_id": "crypto-low-sample-clean-1",
        "market_category": "crypto",
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "selected_executable_side": "YES",
        "side": "YES",
        "markov_microstructure": {
            "confidence_score": 7.0,
            "confidence_caps": ["current_bucket_has_fewer_than_30_transitions"],
            "execution": {
                "yes_maker_edge_pct": 12.0,
                "yes_taker_edge_pct": 5.0,
            },
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }

    overlay_gate = ml._markov_ml_overlay_gate(record)

    assert overlay_gate["accepted_paper_allowed"] is True
    assert overlay_gate["risk_down_applied"] is False
    assert "markov_low_sample" in overlay_gate["warnings"]
    assert overlay_gate["blockers"] == []
    assert overlay_gate["can_authorize_trade"] is False
    assert overlay_gate["live_order_allowed"] is False


def test_crypto_evidence_reroutes_after_markov_microstructure_join(monkeypatch, tmp_path):
    crypto = load_module("kalshi_crypto_markov_reroute", ROOT / "kalshi_crypto_evidence.py")
    calls = []
    candidate = {
        "decision_id": "crypto-reroute-1",
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "selected_executable_side": "YES",
        "strategy_governor_action": "ACCEPT_EXPLORATION",
        "live_order_allowed": False,
    }

    monkeypatch.setattr(crypto, "load_jsonl", lambda _path: ([], []))
    monkeypatch.setattr(crypto, "_load_profit_selector_targets", lambda _path: {})
    monkeypatch.setattr(crypto, "_fetch_markets", lambda *args, **kwargs: ([{"ticker": "KXBTC15M-26MAY211200-00"}], [], {"series_ticker": 1, "search": 0}))
    monkeypatch.setattr(crypto, "fetch_spot_prices", lambda *args, **kwargs: ({"BTC": {"spot_usd": 1, "provider": "fixture"}}, []))
    monkeypatch.setattr(crypto, "_fetch_orderbooks", lambda *args, **kwargs: ({}, []))
    monkeypatch.setattr(crypto, "_current_crypto_markov_payload", lambda *args, **kwargs: {"markets": [{}], "warnings": [], "live_order_allowed": False})
    monkeypatch.setattr(crypto, "build_candidates", lambda *args, **kwargs: [dict(candidate)])
    monkeypatch.setattr(crypto.kalshi_auto_paper_candidates, "_load_state", lambda _path: {})

    def fake_route(record, _state):
        calls.append("with_markov" if "markov_microstructure" in record else "without_markov")
        routed = dict(record)
        routed["strategy_governor_action"] = "SHADOW_ONLY" if "markov_microstructure" in record else "ACCEPT_EXPLORATION"
        routed["strategy_governor_route"] = {
            "weather_crypto_ml_gate": {
                "markov_ml_risk_overlay_gate": {
                    "applies": "markov_microstructure" in record,
                    "risk_down_applied": "markov_microstructure" in record,
                    "live_order_allowed": False,
                }
            },
            "live_order_allowed": False,
        }
        routed["live_order_allowed"] = False
        return routed

    monkeypatch.setattr(crypto.kalshi_auto_paper_candidates, "apply_governor_route", fake_route)
    monkeypatch.setattr(
        crypto.kalshi_markov_feature_join,
        "attach_markov_microstructure_many",
        lambda records, latest=None: [{**record, "markov_microstructure": {"confidence_score": 3.0, "live_order_allowed": False}} for record in records],
    )
    written = []
    monkeypatch.setattr(crypto, "append_jsonl", lambda _path, record: written.append(record))

    args = Namespace(
        limit=10,
        max_pages=1,
        max_orderbooks=1,
        max_new=1,
        max_hours=1.0,
        size_usd=1.0,
        searches="crypto",
        series_tickers="KXBTC15M",
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
        spot_timeout_seconds=1.0,
        fixture_price=[],
        decisions_log=str(tmp_path / "decisions.jsonl"),
        state_path=str(tmp_path / "state.json"),
        accelerator_path=str(tmp_path / "accelerator.json"),
        dry_run=False,
    )

    result = crypto.run(args)

    data = result["data"]
    assert data["created_count"] == 1
    assert calls == ["without_markov", "with_markov"]
    assert data["created_by_governor_action"] == {"SHADOW_ONLY": 1}
    assert data["created_shadow_only_count"] == 1
    assert data["created_accepted_forward_paper_count"] == 0
    assert data["created_governor_reason_counts"]["unknown"] == 1
    assert data["paper_safety_gate_summary"]["accepted_forward_paper_created"] == 0
    assert data["paper_safety_gate_summary"]["zero_unsafe_promotions"] is False
    assert written[0]["strategy_governor_action"] == "SHADOW_ONLY"
    assert written[0]["strategy_governor_route"]["weather_crypto_ml_gate"]["markov_ml_risk_overlay_gate"]["risk_down_applied"] is True
    assert written[0]["live_order_allowed"] is False


def test_crypto_evidence_ranks_current_safe_forward_paper_before_shadow(monkeypatch, tmp_path):
    crypto = load_module("kalshi_crypto_safety_rank", ROOT / "kalshi_crypto_evidence.py")
    shadow = {
        "decision_id": "crypto-rank-shadow",
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "selected_executable_side": "YES",
        "edge_after_costs_pct": 20,
        "model_confidence_score": 0.95,
        "live_order_allowed": False,
    }
    accepted = {
        "decision_id": "crypto-rank-accepted",
        "market_ticker": "KXETH15M-26MAY211200-00",
        "selected_executable_side": "YES",
        "edge_after_costs_pct": 4,
        "model_confidence_score": 0.4,
        "live_order_allowed": False,
    }

    monkeypatch.setattr(crypto, "load_jsonl", lambda _path: ([], []))
    monkeypatch.setattr(crypto, "_load_profit_selector_targets", lambda _path: {})
    monkeypatch.setattr(crypto, "_fetch_markets", lambda *args, **kwargs: ([{"ticker": shadow["market_ticker"]}, {"ticker": accepted["market_ticker"]}], [], {"series_ticker": 2, "search": 0}))
    monkeypatch.setattr(crypto, "fetch_spot_prices", lambda *args, **kwargs: ({"BTC": {"spot_usd": 1, "provider": "fixture"}}, []))
    monkeypatch.setattr(crypto, "_fetch_orderbooks", lambda *args, **kwargs: ({}, []))
    monkeypatch.setattr(crypto, "_current_crypto_markov_payload", lambda *args, **kwargs: {"markets": [{}], "warnings": [], "live_order_allowed": False})
    monkeypatch.setattr(crypto, "build_candidates", lambda *args, **kwargs: [dict(shadow), dict(accepted)])
    monkeypatch.setattr(crypto.kalshi_auto_paper_candidates, "_load_state", lambda _path: {})

    def fake_route(record, _state):
        routed = dict(record)
        is_accepted = routed["decision_id"] == "crypto-rank-accepted" and "markov_microstructure" in routed
        routed["strategy_governor_action"] = "ACCEPT_FORWARD_PAPER" if is_accepted else "SHADOW_ONLY"
        routed["baseline_comparison"] = {
            "beats_market_baseline": is_accepted,
            "beats_random_baseline": is_accepted,
            "beats_no_trade_baseline": is_accepted,
        }
        routed["strategy_governor_route"] = {
            "weather_crypto_ml_gate": {
                "model_quality_passed": is_accepted,
                "markov_ml_risk_overlay_gate": {"blocks_trade": not is_accepted, "risk_down_applied": not is_accepted},
            },
            "live_order_allowed": False,
        }
        routed["live_order_allowed"] = False
        return routed

    monkeypatch.setattr(crypto.kalshi_auto_paper_candidates, "apply_governor_route", fake_route)
    monkeypatch.setattr(
        crypto.kalshi_markov_feature_join,
        "attach_markov_microstructure_many",
        lambda records, latest=None: [{**record, "markov_microstructure": {"confidence_score": 0.8, "live_order_allowed": False}} for record in records],
    )
    written = []
    monkeypatch.setattr(crypto, "append_jsonl", lambda _path, record: written.append(record))

    args = Namespace(
        limit=10,
        max_pages=1,
        max_orderbooks=2,
        max_new=1,
        max_hours=1.0,
        size_usd=1.0,
        searches="crypto",
        series_tickers="KXBTC15M,KXETH15M",
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
        spot_timeout_seconds=1.0,
        fixture_price=[],
        decisions_log=str(tmp_path / "decisions.jsonl"),
        state_path=str(tmp_path / "state.json"),
        accelerator_path=str(tmp_path / "accelerator.json"),
        dry_run=False,
    )

    data = crypto.run(args)["data"]

    assert data["created_count"] == 1
    assert data["candidate_safety_first_ranked_count"] == 2
    assert data["candidate_safety_first_accepted_in_cap_count"] == 1
    assert data["created_by_governor_action"] == {"ACCEPT_FORWARD_PAPER": 1}
    assert data["reason_aware_crypto_acquisition"]["accepted_forward_paper_available_count"] == 1
    assert data["reason_aware_crypto_acquisition"]["recommended_policy"] == "prioritize_current_safe_forward_paper"
    assert written[0]["decision_id"] == "crypto-rank-accepted"
    assert written[0]["live_order_allowed"] is False


def test_crypto_evidence_penalizes_repeated_markov_blocker_when_all_shadow(monkeypatch, tmp_path):
    crypto = load_module("kalshi_crypto_reason_backoff", ROOT / "kalshi_crypto_evidence.py")
    candidates = [
        {"decision_id": "crypto-repeat-a", "market_ticker": "KXBTC15M-26MAY211200-00", "selected_executable_side": "YES", "edge_after_costs_pct": 40, "model_confidence_score": 0.9, "blocker": "markov_low_confidence", "crypto_evidence": {"asset": "BTC"}, "selective_ml_segment_key": "crypto|BTC|crypto_price_threshold|yes", "live_order_allowed": False},
        {"decision_id": "crypto-repeat-b", "market_ticker": "KXETH15M-26MAY211200-00", "selected_executable_side": "YES", "edge_after_costs_pct": 30, "model_confidence_score": 0.8, "blocker": "markov_low_confidence", "crypto_evidence": {"asset": "ETH"}, "selective_ml_segment_key": "crypto|ETH|crypto_price_threshold|yes", "live_order_allowed": False},
        {"decision_id": "crypto-diverse-c", "market_ticker": "KXSOL15M-26MAY211200-00", "selected_executable_side": "YES", "edge_after_costs_pct": 1, "model_confidence_score": 0.3, "blocker": "crypto_model_confidence_too_low", "crypto_evidence": {"asset": "SOL"}, "selective_ml_segment_key": "crypto|SOL|crypto_price_threshold|yes", "live_order_allowed": False},
    ]

    monkeypatch.setattr(crypto, "load_jsonl", lambda _path: ([], []))
    monkeypatch.setattr(crypto, "_load_profit_selector_targets", lambda _path: {})
    monkeypatch.setattr(crypto, "_fetch_markets", lambda *args, **kwargs: ([{"ticker": item["market_ticker"]} for item in candidates], [], {"series_ticker": 3, "search": 0}))
    monkeypatch.setattr(crypto, "fetch_spot_prices", lambda *args, **kwargs: ({"BTC": {"spot_usd": 1, "provider": "fixture"}}, []))
    monkeypatch.setattr(crypto, "_fetch_orderbooks", lambda *args, **kwargs: ({}, []))
    monkeypatch.setattr(crypto, "_current_crypto_markov_payload", lambda *args, **kwargs: {"markets": [{}], "warnings": [], "live_order_allowed": False})
    monkeypatch.setattr(crypto, "build_candidates", lambda *args, **kwargs: [dict(item) for item in candidates])
    monkeypatch.setattr(crypto.kalshi_auto_paper_candidates, "_load_state", lambda _path: {})

    def fake_route(record, _state):
        routed = dict(record)
        blocker = str(routed.get("blocker") or "unknown")
        routed["strategy_governor_action"] = "SHADOW_ONLY"
        routed["strategy_governor_reason"] = f"blocked: {blocker}"
        routed["baseline_comparison"] = {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        }
        routed["strategy_governor_route"] = {
            "weather_crypto_ml_gate": {
                "model_quality_passed": False,
                "blockers": [blocker],
                "markov_ml_risk_overlay_gate": {"blocks_trade": True, "risk_down_applied": True, "blockers": [blocker] if blocker.startswith("markov") else []},
            },
            "plain_english_reason": f"blocked: {blocker}",
            "live_order_allowed": False,
        }
        routed["live_order_allowed"] = False
        return routed

    monkeypatch.setattr(crypto.kalshi_auto_paper_candidates, "apply_governor_route", fake_route)
    monkeypatch.setattr(
        crypto.kalshi_markov_feature_join,
        "attach_markov_microstructure_many",
        lambda records, latest=None: [{**record, "markov_microstructure": {"confidence_score": 0.1, "live_order_allowed": False}} for record in records],
    )
    written = []
    monkeypatch.setattr(crypto, "append_jsonl", lambda _path, record: written.append(record))

    args = Namespace(
        limit=10, max_pages=1, max_orderbooks=3, max_new=1, max_hours=1.0, size_usd=1.0, searches="crypto", series_tickers="KXBTC15M,KXETH15M,KXSOL15M", min_edge_after_costs_cents=2.0, estimated_cost_cents=1.7, spot_timeout_seconds=1.0, fixture_price=[], decisions_log=str(tmp_path / "decisions.jsonl"), state_path=str(tmp_path / "state.json"), accelerator_path=str(tmp_path / "accelerator.json"), dry_run=False,
    )

    data = crypto.run(args)["data"]

    assert data["created_count"] == 1
    assert written[0]["decision_id"] == "crypto-diverse-c"
    acquisition = data["reason_aware_crypto_acquisition"]
    assert acquisition["blocker_counts"]["markov_low_confidence"] == 2
    assert acquisition["asset_blocker_heatmap"]["BTC"]["markov_low_confidence"] == 1
    assert acquisition["asset_blocker_heatmap"]["SOL"]["crypto_model_confidence_too_low"] == 1
    assert acquisition["segment_blocker_heatmap"]["crypto|ETH|crypto_price_threshold|yes"]["markov_low_confidence"] == 1
    assert acquisition["recommended_policy"] == "diversify_away_from_repeated_markov_blockers_until_next_cohort"
    assert written[0]["live_order_allowed"] is False


def test_governor_keeps_weather_crypto_shadow_until_ml_promotion_stage_passes():
    router = load_module("kalshi_auto_ml_gate", ROOT / "kalshi_auto_paper_candidates.py")
    now = datetime.now(timezone.utc).replace(microsecond=0)
    now_text = now.isoformat().replace("+00:00", "Z")
    expected_result_text = (now + timedelta(minutes=20)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "crypto-ml-gate-1",
        "timestamp_utc": now_text,
        "market_ticker": "KXBTC15M-26MAY211200-00",
        "market_title": "BTC price up in next 15 mins?",
        "market_category": "crypto",
        "series_ticker": "KXBTC15M",
        "strategy_bucket": "crypto_spot_model",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "selected_executable_side": "YES",
        "side": "YES",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "edge_after_costs_pct": 10,
        "model_confidence_score": 0.9,
        "expected_result_known_time_utc": expected_result_text,
        "depth_contracts": 50,
        "simulated_size_usd": 1,
        "evidence_tier": "exploration",
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "quality_gates": {"crypto_model_quality_passed": True},
        "crypto_evidence": {
            "asset": "FIXTURE",
            "market_type": "crypto_price_threshold",
            "threshold_usd": 100000,
            "spot_observed_at_utc": now_text,
            "spot_provider": "fixture",
        },
        "live_order_allowed": False,
    }

    routed = router.apply_governor_route(record, {})
    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["evidence_tier"] == "shadow"
    assert routed["simulated_size_usd"] == 0.0
    assert routed["strategy_governor_route"]["weather_crypto_ml_gate"]["accepted_paper_allowed"] is False

    promoted = router.apply_governor_route(
        {**record, "selective_ml_promotion_stage": "tiny_accepted_forward_paper"},
        {},
    )
    assert promoted["strategy_governor_action"] == "ACCEPT_EXPLORATION"
    assert promoted["evidence_tier"] == "exploration"
    assert promoted["live_order_allowed"] is False


def test_crypto_market_fetch_uses_direct_series_tickers(monkeypatch):
    crypto = load_module("kalshi_crypto_series_fetch", ROOT / "kalshi_crypto_evidence.py")
    calls = []

    def fake_kalshi_get(path, params):
        calls.append(dict(params))
        if "series_ticker" in params:
            return {
                "ok": True,
                "data": {
                    "markets": [
                        {
                            "ticker": f"{params['series_ticker']}-26MAY171430-30",
                            "event_ticker": f"{params['series_ticker']}-26MAY171430",
                            "series_ticker": params["series_ticker"],
                            "title": "Will BTC be above $100,000?",
                            "close_time": "2026-05-17T18:30:00Z",
                        }
                    ],
                    "cursor": "",
                },
            }
        return {"ok": True, "data": {"markets": [], "cursor": ""}}

    monkeypatch.setattr(crypto, "kalshi_get", fake_kalshi_get)

    markets, warnings, counts = crypto._fetch_markets(
        ["bitcoin"],
        series_tickers=["KXBTC15M"],
        limit=5,
        max_pages=1,
    )

    assert warnings == []
    assert [call.get("series_ticker") for call in calls if "series_ticker" in call] == ["KXBTC15M"]
    assert len(markets) == 1
    assert counts["series_ticker"] == 1
    assert counts["search"] == 0


def test_clean_evidence_accepts_crypto_spot_source():
    clean = load_module("kalshi_clean_evidence_crypto_source", ROOT / "kalshi_clean_evidence.py")
    result = clean.validate_record(
        {
            "decision_id": "crypto-clean-1",
            "market_ticker": "KXBTC-26MAY13-T100000",
            "market_title": "Will Bitcoin be above $100,000 on May 13, 2026?",
            "market_category": "crypto",
            "strategy_taxonomy": {"domain": "crypto"},
            "side": "YES",
            "market_price_cents": 70,
            "paper_fill_price_cents": 70,
            "depth_contracts": 20,
            "fair_value_source_type": "crypto_spot_volatility_model",
            "expected_result_known_time_utc": "2026-05-13T20:00:00Z",
            "live_order_allowed": False,
        },
        now=datetime(2026, 5, 13, 12, tzinfo=timezone.utc),
        max_hours=24,
    )
    assert result["clean_evidence_passed"] is True
    assert result["recommended_route"] == "ACCEPT_EXPLORATION"


def test_polymarket_reference_validation_rejects_stale_or_ambiguous_records(tmp_path):
    reference = load_module("kalshi_polymarket_reference_test", ROOT / "kalshi_polymarket_reference.py")
    path = tmp_path / "refs.jsonl"
    path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "kalshi_ticker": "KXVALID",
                        "provider": "polymarket",
                        "source_type": "polymarket_reference_price",
                        "probability_yes": 0.61,
                        "observed_at_utc": "2026-05-13T12:00:00Z",
                        "source_url": "https://polymarket.com/event/valid",
                        "match_confidence": 0.99,
                        "live_order_allowed": False,
                    }
                ),
                json.dumps(
                    {
                        "kalshi_ticker": "KXSTALE",
                        "provider": "polymarket",
                        "source_type": "polymarket_reference_price",
                        "probability_yes": 0.61,
                        "observed_at_utc": "2026-05-13T10:00:00Z",
                        "source_url": "https://polymarket.com/event/stale",
                        "match_confidence": 0.99,
                        "live_order_allowed": False,
                    }
                ),
                json.dumps(
                    {
                        "kalshi_ticker": "KXLOWCONF",
                        "provider": "polymarket",
                        "source_type": "polymarket_reference_price",
                        "probability_yes": 0.61,
                        "observed_at_utc": "2026-05-13T12:00:00Z",
                        "source_url": "https://polymarket.com/event/lowconf",
                        "match_confidence": 0.7,
                        "live_order_allowed": False,
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    latest, warnings, summary = reference.load_latest_references(
        path,
        now=datetime(2026, 5, 13, 12, 5, tzinfo=timezone.utc),
        max_age_minutes=60,
    )
    assert warnings == []
    assert sorted(latest) == ["KXVALID"]
    assert summary["valid_references"] == 1
    assert summary["invalid_references"] == 2
    assert summary["blocker_counts"]["stale_reference_price"] == 1
    assert summary["blocker_counts"]["low_match_confidence"] == 1
    assert summary["live_order_allowed"] is False


def test_polymarket_reference_producer_builds_high_confidence_reference():
    producer = load_module("kalshi_polymarket_reference_producer_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXSPORT-ARSENAL",
        "market_title": "Will Arsenal win the match?",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        return [
            {
                "id": "123",
                "question": "Will Arsenal win the match?",
                "slug": "will-arsenal-win-the-match",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.62", "0.38"]),
            }
        ]

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert summary["polymarket_markets_checked"] == 1
    assert references[0]["kalshi_ticker"] == "KXSPORT-ARSENAL"
    assert references[0]["provider"] == "polymarket"
    assert references[0]["source_type"] == "polymarket_reference_price"
    assert references[0]["probability_yes"] == 0.62
    assert references[0]["match_confidence"] >= 0.95
    assert references[0]["live_order_allowed"] is False


def test_polymarket_reference_producer_rejects_weak_match():
    producer = load_module("kalshi_polymarket_reference_producer_weak_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXSPORT-ARSENAL",
        "market_title": "Will Arsenal win the match?",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        return [
            {
                "id": "456",
                "question": "Will Bitcoin hit a new high?",
                "slug": "will-bitcoin-hit-a-new-high",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.62", "0.38"]),
            }
        ]

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert references == []
    assert summary["rejected_reasons"]["low_match_confidence"] == 1


def test_polymarket_reference_producer_rejects_partial_parlay_match():
    producer = load_module("kalshi_polymarket_reference_producer_parlay_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXPARLAY-LEEDS-NAPOLI",
        "market_title": "yes Leeds United,yes Napoli,yes Over 1.5 goals scored",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        raise AssertionError("ambiguous multi-leg candidates should not trigger Polymarket search")

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert references == []
    assert summary["rejected_reasons"]["ambiguous_multi_leg_candidate"] == 1
    assert summary["polymarket_search_calls"] == 0


def test_polymarket_reference_producer_skips_crosscategory_before_search():
    producer = load_module("kalshi_polymarket_reference_producer_crosscategory_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXMVECROSSCATEGORY-S202647846D427CE",
        "market_title": "yes Tobias Harris: 2+,yes Ausar Thompson: 4+,yes Chet Holmgren: 2+",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        raise AssertionError("cross-category candidates should not trigger Polymarket search")

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert references == []
    assert summary["rejected_reasons"]["ambiguous_cross_category_candidate"] == 1
    assert summary["polymarket_search_calls"] == 0


def test_polymarket_reference_producer_accepts_matching_total_threshold():
    producer = load_module("kalshi_polymarket_reference_producer_total_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXTOTAL-GOALS",
        "market_title": "Will Arsenal vs Chelsea have Over 2.5 goals scored?",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        return [
            {
                "id": "999",
                "question": "Will Arsenal vs Chelsea have over 2.5 goals scored?",
                "slug": "arsenal-chelsea-over-25-goals",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.57", "0.43"]),
            }
        ]

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert summary["polymarket_markets_checked"] == 1
    assert references[0]["kalshi_ticker"] == "KXTOTAL-GOALS"
    assert references[0]["probability_yes"] == 0.57
    assert references[0]["match_confidence"] >= 0.95


def test_polymarket_reference_producer_accepts_exact_sports_parlay():
    producer = load_module("kalshi_polymarket_reference_producer_parlay_exact_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXSPORT-PARLAY-EXACT",
        "market_title": "yes Baltimore wins by over 3.5 runs,yes Over 10.5 runs scored",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        return [
            {
                "id": "parlay-exact",
                "question": "yes Over 10.5 runs scored, yes Baltimore wins by over 3.5 runs",
                "slug": "baltimore-over-35-and-over-105-runs",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.34", "0.66"]),
            }
        ]

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert references[0]["match_confidence"] == 1.0
    assert references[0]["match_method"] == "sports_parlay_exact_fingerprint_v1"
    assert references[0]["probability_yes"] == 0.34
    assert summary["match_method_counts"]["sports_parlay_exact_fingerprint_v1"] == 1


def test_polymarket_reference_producer_uses_discovery_search_terms_first():
    producer = load_module("kalshi_polymarket_reference_producer_discovery_terms_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXSPORT-DERIVED-TERMS",
        "market_title": "yes New York Y,yes Over 7.5 runs scored",
        "market_category": "sports",
        "discovery_search_terms": ["new york yankees", "mlb total runs"],
        "live_order_allowed": False,
    }
    calls = []

    def fetcher(search: str):
        calls.append(search)
        if search == "new york yankees":
            return [
                {
                    "id": "derived-yankees",
                    "question": "yes New York Yankees, yes Over 7.5 runs scored",
                    "slug": "yankees-over-75-runs",
                    "outcomes": json.dumps(["Yes", "No"]),
                    "outcomePrices": json.dumps(["0.58", "0.42"]),
                }
            ]
        return []

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert calls[0] == "new york yankees"
    assert references[0]["kalshi_ticker"] == "KXSPORT-DERIVED-TERMS"
    assert references[0]["probability_yes"] == 0.58
    assert references[0]["match_confidence"] >= 0.95
    assert summary["polymarket_markets_checked"] == 1


def test_polymarket_reference_producer_uses_universe_before_search():
    producer = load_module("kalshi_polymarket_reference_producer_universe_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXSPORT-UNIVERSE-YANKEES",
        "market_title": "yes New York Y,yes Over 7.5 runs scored",
        "market_category": "sports",
        "discovery_search_terms": ["new york yankees", "mlb total runs"],
        "live_order_allowed": False,
    }
    universe = [
        {
            "id": "universe-yankees",
            "question": "yes New York Yankees, yes Over 7.5 runs scored",
            "slug": "yankees-over-75-runs",
            "outcomes": json.dumps(["Yes", "No"]),
            "outcomePrices": json.dumps(["0.58", "0.42"]),
        }
    ]
    calls = []

    def fetcher(search: str):
        calls.append(search)
        return []

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
        polymarket_universe=universe,
    )
    assert calls == []
    assert references[0]["kalshi_ticker"] == "KXSPORT-UNIVERSE-YANKEES"
    assert references[0]["probability_yes"] == 0.58
    assert summary["polymarket_universe_candidate_hits"] == 1
    assert summary["polymarket_universe_candidates_checked"] == 1
    assert summary["polymarket_search_calls"] == 0
    assert references[0]["live_order_allowed"] is False


def test_polymarket_reference_producer_loads_universe_cache(tmp_path):
    producer = load_module("kalshi_polymarket_reference_producer_universe_cache_test", ROOT / "kalshi_polymarket_reference_producer.py")
    cache_path = tmp_path / "universe.json"
    cache_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-13T12:00:00Z",
                "markets": [{"id": "market-1", "question": "Will Team A win?", "slug": "team-a"}],
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    markets, warnings, summary = producer._load_universe_cache(cache_path)
    assert warnings == []
    assert markets[0]["id"] == "market-1"
    assert summary["loaded"] is True
    assert summary["market_count"] == 1
    assert summary["live_order_allowed"] is False


def test_polymarket_reference_producer_refresh_universe_failure_falls_back(tmp_path, monkeypatch):
    producer = load_module("kalshi_polymarket_reference_producer_universe_failure_test", ROOT / "kalshi_polymarket_reference_producer.py")
    queue_path = tmp_path / "queue.json"
    queue_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-13T12:00:00Z",
                "candidates": [
                    {
                        "market_ticker": "KXSPORT-FALLBACK",
                        "market_title": "Will Arsenal vs Chelsea have Over 2.5 goals scored?",
                        "market_category": "sports",
                        "matchability_score": 0.9,
                        "live_order_allowed": False,
                    }
                ],
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    decisions_path = tmp_path / "decisions.jsonl"
    decisions_path.write_text("", encoding="utf-8")
    refs_path = tmp_path / "refs.jsonl"
    runs_path = tmp_path / "runs.jsonl"

    def failing_universe(**_kwargs):
        raise TimeoutError("fixture timeout")

    def fake_gamma(_search: str, *, limit: int, timeout: float):
        return [
            {
                "id": "fallback-match",
                "question": "Will Arsenal vs Chelsea have over 2.5 goals scored?",
                "slug": "arsenal-chelsea-over-25-goals",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.57", "0.43"]),
            }
        ]

    monkeypatch.setattr(producer, "_fetch_gamma_universe", failing_universe)
    monkeypatch.setattr(producer, "_fetch_gamma_markets", fake_gamma)
    args = producer.build_parser().parse_args(
        [
            "--decisions-log",
            str(decisions_path),
            "--discovery-queue",
            str(queue_path),
            "--reference-log",
            str(refs_path),
            "--runs-log",
            str(runs_path),
            "--universe-cache",
            str(tmp_path / "universe.json"),
            "--refresh-universe",
            "--dry-run",
            "--limit-candidates",
            "1",
        ]
    )
    result = producer.run(args)
    data = result["data"]
    assert result["ok"] is True
    assert data["polymarket_universe"]["fallback"] == "per_candidate_search"
    assert data["references_built"] == 1
    assert data["polymarket_search_calls"] >= 1
    assert data["live_order_allowed"] is False
    assert any("universe refresh failed" in warning.lower() for warning in data["warnings"])


def test_polymarket_reference_producer_rejects_wrong_sports_threshold():
    producer = load_module("kalshi_polymarket_reference_producer_wrong_threshold_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXSPORT-TOTAL-EXACT",
        "market_title": "Will Arsenal vs Chelsea have Over 2.5 goals scored?",
        "market_category": "sports",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        return [
            {
                "id": "wrong-threshold",
                "question": "Will Arsenal vs Chelsea have over 3.5 goals scored?",
                "slug": "arsenal-chelsea-over-35-goals",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.25", "0.75"]),
            }
        ]

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert references == []
    assert summary["rejected_reasons"]["low_match_confidence"] == 1


def test_polymarket_reference_producer_accepts_exact_weather_market():
    producer = load_module("kalshi_polymarket_reference_producer_weather_exact_test", ROOT / "kalshi_polymarket_reference_producer.py")
    kalshi_candidate = {
        "market_ticker": "KXWEATHER-CHI-HIGH-76",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "live_order_allowed": False,
    }

    def fetcher(_search: str):
        return [
            {
                "id": "weather-exact",
                "question": "Will Chicago high temperature exceed 76 degrees on May 10, 2026?",
                "slug": "chicago-high-temperature-over-76-may-10-2026",
                "outcomes": json.dumps(["Yes", "No"]),
                "outcomePrices": json.dumps(["0.72", "0.28"]),
            }
        ]

    references, summary = producer.build_reference_records(
        [kalshi_candidate],
        fetch_markets=fetcher,
        min_match_confidence=0.95,
        now_text="2026-05-13T12:00:00Z",
    )
    assert references[0]["match_confidence"] == 1.0
    assert references[0]["match_method"] == "weather_exact_fingerprint_v1"
    assert references[0]["probability_yes"] == 0.72
    assert summary["match_method_counts"]["weather_exact_fingerprint_v1"] == 1


def test_polymarket_reference_producer_prioritizes_matchable_candidates(tmp_path):
    producer = load_module("kalshi_polymarket_reference_producer_queue_test", ROOT / "kalshi_polymarket_reference_producer.py")
    path = tmp_path / "decisions.jsonl"
    records = [
        {
            "decision_id": "old-matchable",
            "market_ticker": "KXTOTAL-GOALS",
            "market_title": "Will Arsenal vs Chelsea have Over 2.5 goals scored?",
            "market_category": "sports",
            "live_order_allowed": False,
        },
        {
            "decision_id": "recent-parlay",
            "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED",
            "market_title": "yes Leeds United,yes Napoli,yes Over 1.5 goals scored",
            "market_category": "sports",
            "live_order_allowed": False,
        },
    ]
    path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
    candidates, warnings, summary = producer._load_kalshi_candidates(
        path,
        limit=1,
        pool_multiplier=10,
        min_matchability=0.55,
    )
    assert warnings == []
    assert candidates[0]["market_ticker"] == "KXTOTAL-GOALS"
    assert summary["matchable_candidates_in_pool"] == 1
    assert summary["selected_matchability_scores"][0] >= 0.55


def test_polymarket_reference_producer_scores_crosscategory_as_unmatchable():
    producer = load_module("kalshi_polymarket_reference_producer_matchability_blocker_test", ROOT / "kalshi_polymarket_reference_producer.py")
    candidate = {
        "market_ticker": "KXMVECROSSCATEGORY-S20260C67D01E25E",
        "market_title": "yes Both Teams To Score,no Over 1.5 goals scored",
        "market_category": "sports",
        "live_order_allowed": False,
    }
    assert producer._matchability_score(candidate) < 0.55
    assert producer._candidate_match_blocker(candidate) == "ambiguous_cross_category_candidate"


def test_polymarket_reference_producer_does_not_select_low_matchability_fallback(tmp_path):
    producer = load_module("kalshi_polymarket_reference_producer_no_fallback_test", ROOT / "kalshi_polymarket_reference_producer.py")
    path = tmp_path / "decisions.jsonl"
    record = {
        "decision_id": "bad-crosscategory",
        "market_ticker": "KXMVECROSSCATEGORY-S20260C67D01E25E",
        "market_title": "yes Both Teams To Score,no Over 1.5 goals scored",
        "market_category": "sports",
        "live_order_allowed": False,
    }
    path.write_text(json.dumps(record) + "\n", encoding="utf-8")
    candidates, warnings, summary = producer._load_kalshi_candidates(
        path,
        limit=5,
        pool_multiplier=10,
        min_matchability=0.55,
    )
    assert candidates == []
    assert warnings == []
    assert summary["matchable_candidates_in_pool"] == 0
    assert summary["below_matchability_candidates_in_pool"] == 1


def test_polymarket_discovery_queue_selects_matchable_markets():
    queue = load_module("kalshi_polymarket_discovery_queue_test", ROOT / "kalshi_polymarket_discovery_queue.py")
    markets = [
        {
            "ticker": "KXPARLAY-LOW",
            "title": "yes Leeds United,yes Napoli,yes Over 1.5 goals scored",
            "category": "sports",
            "status": "open",
        },
        {
            "ticker": "KXTOTAL-GOALS",
            "title": "Will Arsenal vs Chelsea have Over 2.5 goals scored?",
            "category": "sports",
            "status": "open",
        },
    ]
    candidates, summary = queue.build_queue(markets, limit=5, min_matchability=0.55)
    assert [candidate["market_ticker"] for candidate in candidates] == ["KXTOTAL-GOALS"]
    assert candidates[0]["live_order_allowed"] is False
    assert summary["markets_seen"] == 2
    assert summary["matchable_markets"] == 1
    assert summary["rejected_reasons"]["ambiguous_multi_leg_candidate"] == 1


def test_polymarket_discovery_queue_rejects_crosscategory_markets():
    queue = load_module("kalshi_polymarket_discovery_queue_crosscategory_test", ROOT / "kalshi_polymarket_discovery_queue.py")
    markets = [
        {
            "ticker": "KXMVECROSSCATEGORY-S20260C67D01E25E",
            "title": "yes Both Teams To Score,no Over 1.5 goals scored",
            "category": "sports",
            "status": "open",
        }
    ]
    candidates, summary = queue.build_queue(markets, limit=5, min_matchability=0.55)
    assert candidates == []
    assert summary["matchable_markets"] == 0
    assert summary["rejected_reasons"]["ambiguous_cross_category_candidate"] == 1


def test_polymarket_discovery_queue_derives_team_and_market_type_searches():
    queue = load_module("kalshi_polymarket_discovery_queue_derived_terms_test", ROOT / "kalshi_polymarket_discovery_queue.py")
    markets = [
        {
            "ticker": "KXSPORT-YANKEES-RUNS",
            "title": "yes New York Y,yes Over 7.5 runs scored",
            "category": "sports",
            "status": "open",
        },
        {
            "ticker": "KXSPORT-SABRES-GOALS",
            "title": "yes BUF Sabres,no Over 5.5 goals scored",
            "category": "sports",
            "status": "open",
        },
        {
            "ticker": "KXWEATHER-CHI-HIGH",
            "title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
            "category": "weather",
            "status": "open",
        },
    ]
    terms = queue.derive_searches_from_markets(markets, max_terms=20)
    assert "new york yankees" in terms
    assert "mlb total runs" in terms
    assert "buffalo sabres" in terms
    assert "nhl total goals" in terms
    assert "chicago temperature" in terms


def test_polymarket_discovery_queue_fetches_derived_searches(tmp_path, monkeypatch):
    queue = load_module("kalshi_polymarket_discovery_queue_derived_fetch_test", ROOT / "kalshi_polymarket_discovery_queue.py")
    output = tmp_path / "queue_latest.json"
    runs_log = tmp_path / "runs.jsonl"
    calls = []

    def fake_fetch(**kwargs):
        calls.append(kwargs["searches"])
        if len(calls) == 1:
            return [
                {
                    "ticker": "KXSPORT-YANKEES-RUNS",
                    "title": "Will the Yankees and Mets have Over 7.5 runs scored?",
                    "category": "sports",
                    "status": "open",
                }
            ], [], {"searches_completed": 1, "pages_requested": 1, "markets_returned": 1, "live_order_allowed": False}
        return [
            {
                "ticker": "KXTOTAL-RUNS-DERIVED",
                "title": "Will the Yankees and Mets have Over 7.5 runs scored?",
                "category": "sports",
                "status": "open",
            }
        ], [], {"searches_completed": len(kwargs["searches"]), "pages_requested": len(kwargs["searches"]), "markets_returned": 1, "live_order_allowed": False}

    monkeypatch.setattr(queue, "_fetch_markets", fake_fetch)
    args = queue.build_parser().parse_args(
        [
            "--output",
            str(output),
            "--runs-log",
            str(runs_log),
            "--searches",
            "sports",
            "--limit",
            "5",
            "--max-derived-searches",
            "5",
            "--dry-run",
        ]
    )
    result = queue.run(args)
    data = result["data"]
    assert result["ok"] is True
    assert len(calls) == 2
    assert "new york yankees" in data["fetch_summary"]["derived_searches_requested"]
    assert data["fetch_summary"]["derived_searches_completed"] >= 1
    assert data["fetch_summary"]["derived_markets_returned"] == 1
    assert data["fetch_summary"]["discovery_adapter_version"] == "sport_weather_derived_associated_leg_v2"
    assert all(candidate["live_order_allowed"] is False for candidate in data["candidates"])


def test_polymarket_discovery_queue_preserves_nonempty_queue_on_empty_run(tmp_path, monkeypatch):
    queue = load_module("kalshi_polymarket_discovery_queue_preserve_test", ROOT / "kalshi_polymarket_discovery_queue.py")
    output = tmp_path / "queue_latest.json"
    runs_log = tmp_path / "runs.jsonl"
    output.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-13T12:00:00Z",
                "candidate_count": 1,
                "candidates": [{"market_ticker": "KXKEEP", "market_title": "Keep this", "live_order_allowed": False}],
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )

    def empty_fetch(**_kwargs):
        return [], [], {"markets_returned": 0, "live_order_allowed": False}

    monkeypatch.setattr(queue, "_fetch_markets", empty_fetch)
    args = queue.build_parser().parse_args(
        [
            "--output",
            str(output),
            "--runs-log",
            str(runs_log),
            "--searches",
            "sports",
            "--limit",
            "5",
        ]
    )
    result = queue.run(args)
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert result["ok"] is True
    assert result["data"]["candidate_count"] == 0
    assert result["data"]["preserved_existing_queue"] is True
    assert saved["candidate_count"] == 1
    assert saved["candidates"][0]["market_ticker"] == "KXKEEP"


def test_polymarket_discovery_queue_expands_associated_leg_markets(tmp_path, monkeypatch):
    queue = load_module("kalshi_polymarket_discovery_queue_associated_leg_test", ROOT / "kalshi_polymarket_discovery_queue.py")
    output = tmp_path / "queue_latest.json"
    runs_log = tmp_path / "runs.jsonl"
    parent_market = {
        "ticker": "KXMVECROSSCATEGORY-S2026BUNDLE",
        "title": "yes Austin Reaves 20 or more points,yes Lakers win",
        "category": "sports",
        "status": "open",
        "custom_strike": {
            "Associated Markets": "KXNBA-REAVES-20PTS",
            "Associated Market Sides": "YES",
        },
    }
    leg_market = {
        "ticker": "KXNBA-REAVES-20PTS",
        "title": "Will Austin Reaves score 20 or more points on May 18, 2026?",
        "category": "sports",
        "status": "open",
        "expected_expiration_time": "2026-05-18T03:00:00Z",
    }

    def fake_fetch(**_kwargs):
        return [parent_market], [], {"searches_completed": 1, "pages_requested": 1, "markets_returned": 1, "live_order_allowed": False}

    def fake_kalshi_get(path, *args, **kwargs):
        assert kwargs.get("timeout") is not None
        if path == "/markets/KXNBA-REAVES-20PTS":
            return {"ok": True, "data": {"market": leg_market}}
        return {"ok": False, "error": {"type": "UnexpectedPath", "message": path}}

    monkeypatch.setattr(queue, "_fetch_markets", fake_fetch)
    monkeypatch.setattr(queue, "kalshi_get", fake_kalshi_get)
    args = queue.build_parser().parse_args(
        [
            "--output",
            str(output),
            "--runs-log",
            str(runs_log),
            "--searches",
            "sports",
            "--limit",
            "5",
            "--disable-derived-searches",
            "--max-associated-leg-fetches",
            "5",
            "--dry-run",
        ]
    )
    result = queue.run(args)
    data = result["data"]
    tickers = [candidate["market_ticker"] for candidate in data["candidates"]]
    assert result["ok"] is True
    assert tickers == ["KXNBA-REAVES-20PTS"]
    assert data["candidate_count"] == 1
    assert data["queue_summary"]["rejected_reasons"]["ambiguous_cross_category_candidate"] == 1
    assert data["fetch_summary"]["associated_leg_expansion"]["candidate_leg_tickers_seen"] == 1
    assert data["fetch_summary"]["associated_leg_expansion"]["requested"] == 1
    assert data["fetch_summary"]["associated_leg_expansion"]["returned"] == 1
    assert data["candidates"][0]["live_order_allowed"] is False
    assert data["candidates"][0]["auto_live_promotion_allowed"] is False


def test_polymarket_reference_producer_prefers_discovery_queue(tmp_path):
    producer = load_module("kalshi_polymarket_reference_producer_discovery_test", ROOT / "kalshi_polymarket_reference_producer.py")
    queue_path = tmp_path / "queue.json"
    queue_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-13T12:00:00Z",
                "candidates": [
                    {
                        "market_ticker": "KXDISCOVERY-GOALS",
                        "market_title": "Will Arsenal vs Chelsea have Over 2.5 goals scored?",
                        "market_category": "sports",
                        "matchability_score": 0.9,
                        "live_order_allowed": False,
                    }
                ],
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    decisions_path = tmp_path / "decisions.jsonl"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "recent-parlay",
                "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED",
                "market_title": "yes Leeds United,yes Napoli,yes Over 1.5 goals scored",
                "market_category": "sports",
                "live_order_allowed": False,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    discovery, discovery_warnings, discovery_summary = producer._load_discovery_candidates(queue_path, limit=1, min_matchability=0.55)
    paper, paper_warnings, _paper_summary = producer._load_kalshi_candidates(decisions_path, limit=1, pool_multiplier=10, min_matchability=0.55)
    combined = producer._combine_candidates(discovery, paper, limit=1)
    assert discovery_warnings == []
    assert paper_warnings == []
    assert discovery_summary["selected_candidates"] == 1
    assert combined[0]["market_ticker"] == "KXDISCOVERY-GOALS"
    assert combined[0]["candidate_source"] == "polymarket_discovery_queue"
    assert combined[0]["live_order_allowed"] is False


def test_scheduled_learning_parser_defines_strategy_lane_candidate_limit():
    scheduled = load_module("kalshi_scheduled_learning_parser_test", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args([])
    assert args.max_strategy_lane_candidates == 25
    assert "bitcoin" in args.polymarket_discovery_searches
    assert "sports" not in args.candidate_searches
    assert "weather" in args.candidate_searches
    assert "crypto" in args.candidate_searches
    assert "goals" not in args.polymarket_discovery_searches
    assert args.polymarket_universe_page_limit == 100
    assert args.polymarket_universe_max_pages == 3
    assert args.crypto_readiness_recheck_lead_seconds == 0
    assert args.max_adaptive_runs == 2
    assert scheduled.WEATHER_CRYPTO_STRATEGY_LANE_SEARCHES == "weather,temperature,rain,crypto,bitcoin,ethereum"
    assert "economics" not in scheduled.WEATHER_CRYPTO_STRATEGY_LANE_SEARCHES
    assert "politics" not in scheduled.WEATHER_CRYPTO_STRATEGY_LANE_SEARCHES


def test_scheduled_learning_summarizes_crypto_candidate_density(monkeypatch):
    scheduled = load_module("kalshi_scheduled_learning_crypto_density_summary", ROOT / "kalshi_scheduled_learning.py")

    class FakeProcess:
        returncode = 0
        stderr = ""
        stdout = json.dumps(
            {
                "ok": True,
                "data": {
                    "created_count": 5,
                    "created_shadow_only_count": 5,
                    "created_accepted_forward_paper_count": 0,
                    "created_inverse_forward_test_count": 0,
                    "created_segment_policy_forward_test_count": 0,
                    "created_by_governor_action": {"SHADOW_ONLY": 5},
                    "created_governor_reason_counts": {"Validated Markov risk overlay blocked accepted paper exposure": 5},
                    "paper_safety_gate_summary": {
                        "accepted_forward_paper_created": 0,
                        "shadow_only_created": 5,
                        "current_safety_blocked_count": 5,
                        "zero_unsafe_promotions": True,
                        "live_order_allowed": False,
                    },
                    "candidate_safety_first_ranked_count": 5,
                    "candidate_safety_first_accepted_in_cap_count": 0,
                    "reason_aware_crypto_acquisition": {
                        "dominant_blocker": "markov_low_confidence",
                        "recommended_policy": "diversify_away_from_repeated_markov_blockers_until_next_cohort",
                        "blocker_counts": {"markov_low_confidence": 5},
                        "asset_blocker_heatmap": {"BTC": {"markov_low_confidence": 3}, "ETH": {"markov_low_confidence": 2}},
                        "segment_blocker_heatmap": {"crypto|BTC|crypto_price_threshold|yes": {"markov_low_confidence": 3}},
                        "live_order_allowed": False,
                    },
                    "skipped_not_due_by_category": {"crypto": 5},
                    "next_due_crypto_candidate_time_utc": "2026-05-30T18:05:00Z",
                    "seconds_until_next_due_crypto_candidate": 300,
                    "live_order_allowed": False,
                },
            }
        )

    monkeypatch.setattr(scheduled.subprocess, "run", lambda *args, **kwargs: FakeProcess())
    step = scheduled._run_script("kalshi_crypto_evidence.py")

    assert step["json_summary"]["created_shadow_only_count"] == 5
    assert step["json_summary"]["created_accepted_forward_paper_count"] == 0
    assert step["json_summary"]["created_by_governor_action"] == {"SHADOW_ONLY": 5}
    assert step["json_summary"]["created_governor_reason_counts"]["Validated Markov risk overlay blocked accepted paper exposure"] == 5
    assert step["json_summary"]["paper_safety_gate_summary"]["zero_unsafe_promotions"] is True
    assert step["json_summary"]["candidate_safety_first_ranked_count"] == 5
    assert step["json_summary"]["candidate_safety_first_accepted_in_cap_count"] == 0
    assert step["json_summary"]["reason_aware_crypto_acquisition"]["dominant_blocker"] == "markov_low_confidence"
    assert step["json_summary"]["reason_aware_crypto_acquisition"]["asset_blocker_heatmap"]["BTC"]["markov_low_confidence"] == 3
    assert step["json_summary"]["skipped_not_due_by_category"] == {"crypto": 5}
    assert step["json_summary"]["next_due_crypto_candidate_time_utc"] == "2026-05-30T18:05:00Z"
    assert step["json_summary"]["seconds_until_next_due_crypto_candidate"] == 300


def test_scheduled_learning_crypto_evidence_args_diversify_after_markov_blockers():
    scheduled = load_module("kalshi_scheduled_learning_crypto_args_diversify", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "40", "--max-orderbooks", "20", "--max-auto-candidates", "12", "--candidate-max-pages", "2"])

    step_args = scheduled._crypto_evidence_step_args(
        args,
        acquisition_summary={
            "recommended_policy": "diversify_away_from_repeated_markov_blockers_until_next_cohort",
            "dominant_blocker": "markov_low_confidence",
            "asset_blocker_heatmap": {
                "BTC": {"markov_low_confidence": 5, "markov_taker_trap_negative_taker_edge": 4},
                "ETH": {"markov_low_confidence": 3},
                "SOL": {"market_baseline_not_beaten": 1},
            },
            "live_order_allowed": False,
        },
        outcome_scores={},
    )

    assert step_args[step_args.index("--max-orderbooks") + 1] == "60"
    assert step_args[step_args.index("--max-pages") + 1] == "4"
    assert step_args[step_args.index("--max-new") + 1] == "12"
    assert "--searches" in step_args
    searches = step_args[step_args.index("--searches") + 1]
    assert searches.split(",")[:4] == ["dogecoin", "doge", "xrp", "solana"]
    assert "--series-tickers" in step_args
    series = step_args[step_args.index("--series-tickers") + 1]
    assert series.split(",")[:3] == ["KXDOGE15M", "KXXRP15M", "KXSOL15M"]


def test_scheduled_learning_weather_scores_use_deep_decision_history(tmp_path):
    scheduled = load_module("kalshi_scheduled_learning_weather_deep_history", ROOT / "kalshi_scheduled_learning.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    old_weather_decision = {
        "decision_id": "weather-old-1",
        "market_category": "weather",
        "market_ticker": "KXHIGHTBOS-26MAY18-T73",
        "selected_executable_side": "YES",
        "paper_fill_price_cents": 50,
        "simulated_size_usd": 1.0,
        "live_order_allowed": False,
    }
    filler = {"decision_id": "filler", "market_category": "crypto", "live_order_allowed": False}
    decisions_path.write_text("\n".join(json.dumps({**filler, "decision_id": f"filler-{index}"}) for index in range(6000)) + "\n" + json.dumps(old_weather_decision) + "\n", encoding="utf-8")
    outcomes_path.write_text(json.dumps({"decision_id": "weather-old-1", "market_category": "weather", "outcome_yes": 1, "resolved": True, "live_order_allowed": False}) + "\n", encoding="utf-8")

    scores = scheduled._recent_weather_outcome_scores(decisions_path=decisions_path, outcomes_path=outcomes_path, limit=10)

    assert scores["temperature"]["weighted_scored"] == 1.0
    assert scores["temperature"]["weighted_accuracy"] == 1.0



def test_scheduled_learning_orders_weather_searches_by_recent_outcomes():
    scheduled = load_module("kalshi_scheduled_learning_weather_outcome_order", ROOT / "kalshi_scheduled_learning.py")

    ordered = scheduled._ordered_weather_searches(
        outcome_scores={
            "temperature": {"weighted_accuracy": 0.25, "weighted_pnl_usd": -3.0, "weighted_scored": 10.0},
            "rain": {"weighted_accuracy": 0.75, "weighted_pnl_usd": 2.0, "weighted_scored": 10.0},
        }
    )

    assert ordered == ["rain", "temperature"]


def test_scheduled_learning_weather_acquisition_scoreboard_reports_order_and_scores():
    scheduled = load_module("kalshi_scheduled_learning_weather_scoreboard", ROOT / "kalshi_scheduled_learning.py")

    scoreboard = scheduled._weather_acquisition_scoreboard(
        outcome_scores={
            "temperature": {"weighted_accuracy": 0.25, "weighted_pnl_usd": -3.0, "weighted_scored": 10.0},
            "rain": {"weighted_accuracy": 0.75, "weighted_pnl_usd": 2.0, "weighted_scored": 10.0},
        }
    )

    assert scoreboard["ordered_searches"] == ["rain", "temperature"]
    assert scoreboard["outcome_scores"]["rain"]["weighted_accuracy"] == 0.75
    assert scoreboard["term_sample_deficits"] == {"temperature": 10.0, "rain": 10.0}
    assert scoreboard["rain_sample_deficit"] == 10.0
    assert scoreboard["recommended_focus"][0] == "rain"
    assert scoreboard["score_window"] == "recent_decayed_paper_outcomes"
    assert scoreboard["live_order_allowed"] is False



def test_scheduled_learning_weather_candidate_args_preserve_paper_only_limits():
    scheduled = load_module("kalshi_scheduled_learning_weather_args", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "40", "--max-orderbooks", "20", "--max-auto-candidates", "12", "--candidate-max-pages", "2"])

    step_args = scheduled._weather_candidate_step_args(args, remaining=12, search="rain")

    assert step_args[step_args.index("--max-orderbooks") + 1] == "40"
    assert step_args[step_args.index("--max-new") + 1] == "10"
    assert step_args[step_args.index("--search") + 1] == "rain"
    assert "--size-usd" in step_args
    assert step_args[step_args.index("--size-usd") + 1] == "1.0"


def test_scheduled_learning_weather_candidate_args_use_adaptive_orderbook_cap():
    scheduled = load_module("kalshi_scheduled_learning_weather_args_adaptive_orderbooks", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "40", "--max-orderbooks", "60", "--max-auto-candidates", "12", "--candidate-max-pages", "2"])

    step_args = scheduled._weather_candidate_step_args(args, remaining=12, search="temperature", max_orderbooks_override=20)

    assert step_args[step_args.index("--max-orderbooks") + 1] == "40"
    assert step_args[step_args.index("--max-new") + 1] == "10"
    assert step_args[step_args.index("--size-usd") + 1] == "1.0"


def test_scheduled_learning_learning_throughput_scorecard_combines_weather_crypto_resolution():
    scheduled = load_module("kalshi_scheduled_learning_throughput_scorecard", ROOT / "kalshi_scheduled_learning.py")
    steps = [
        {"script": "kalshi_weather_paper_candidates.py", "json_summary": {"created_count": 3, "candidate_ranked_count": 7, "rain_ranked_candidate_count": 4, "skipped_reasons": {"duplicate": 2}}, "ok": True},
        {"script": "kalshi_crypto_evidence.py", "json_summary": {"created_count": 5, "candidate_safety_first_ranked_count": 8, "candidate_safety_first_accepted_in_cap_count": 1, "paper_safety_gate_summary": {"current_safety_blocked_count": 4}}, "ok": True},
        {"script": "kalshi_fast_resolution.py", "json_summary": {"fast_crypto_resolved_count": 6}, "ok": True},
    ]

    scorecard = scheduled._learning_throughput_scorecard(steps, weather_lock_metrics={"created_after_retry_count": 2})

    assert scorecard["weather_created_count"] == 3
    assert scorecard["weather_ranked_count"] == 7
    assert scorecard["weather_rain_ranked_count"] == 4
    assert scorecard["crypto_created_count"] == 5
    assert scorecard["crypto_ranked_count"] == 8
    assert scorecard["crypto_accepted_in_cap_count"] == 1
    assert scorecard["resolved_count"] == 6
    assert scorecard["blocked_count"] == 6
    assert scorecard["total_created_count"] == 8
    assert scorecard["lock_recovered_created_count"] == 2
    assert scorecard["timed_out_step_count"] == 0
    assert scorecard["weather_candidate_timeout_count"] == 0
    assert scorecard["learning_throughput_score"] == 15.4
    assert scorecard["live_order_allowed"] is False


def test_scheduled_learning_learning_throughput_scorecard_counts_timeouts():
    scheduled = load_module("kalshi_scheduled_learning_throughput_timeouts", ROOT / "kalshi_scheduled_learning.py")
    steps = [
        {"script": "kalshi_weather_paper_candidates.py", "json_summary": {"timed_out": True}, "ok": False},
        {"script": "kalshi_crypto_evidence.py", "json_summary": {"timed_out": True}, "ok": False},
    ]

    scorecard = scheduled._learning_throughput_scorecard(steps)

    assert scorecard["timed_out_step_count"] == 2
    assert scorecard["weather_candidate_timeout_count"] == 1
    assert scorecard["crypto_evidence_timeout_count"] == 1
    assert scorecard["live_order_allowed"] is False


def test_scheduled_learning_adaptive_learning_caps_boost_low_safe_throughput():
    scheduled = load_module("kalshi_scheduled_learning_adaptive_caps", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "20", "--max-orderbooks", "10"])

    caps = scheduled._adaptive_learning_caps(
        args,
        prior_scorecard={"total_created_count": 1, "resolved_count": 0, "total_ranked_count": 30, "blocked_count": 3},
        edge_decay={},
    )

    assert caps["weather_max_auto_candidates"] == 30
    assert caps["weather_max_orderbooks"] == 10
    assert caps["crypto_max_auto_candidates"] == 30
    assert caps["crypto_orderbook_multiplier"] == 3
    assert "prior_cycle_low_created_and_resolved_throughput" in caps["reasons"]
    assert caps["live_order_allowed"] is False
    assert caps["auto_live_promotion_allowed"] is False


def test_scheduled_learning_adaptive_caps_throttle_weather_after_timeout():
    scheduled = load_module("kalshi_scheduled_learning_adaptive_caps_weather_timeout", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "40", "--max-orderbooks", "60"])

    caps = scheduled._adaptive_learning_caps(
        args,
        prior_scorecard={"total_created_count": 30, "resolved_count": 15, "blocked_count": 2, "weather_candidate_timeout_count": 1},
        edge_decay={},
    )

    assert caps["weather_max_auto_candidates"] == 20
    assert caps["weather_max_orderbooks"] == 30
    assert "prior_cycle_weather_candidate_timeout_throttles_weather_scan" in caps["reasons"]
    assert caps["live_order_allowed"] is False


def test_scheduled_learning_adaptive_learning_caps_constrain_high_blocked_crypto():
    scheduled = load_module("kalshi_scheduled_learning_adaptive_caps_blocked", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "40"])

    caps = scheduled._adaptive_learning_caps(
        args,
        prior_scorecard={"total_created_count": 2, "resolved_count": 1, "blocked_count": 99},
        edge_decay={},
    )

    assert caps["weather_max_auto_candidates"] == 60
    assert caps["crypto_max_auto_candidates"] == 30
    assert "prior_cycle_high_blocked_count_keeps_crypto_cap_conservative" in caps["reasons"]
    assert caps["live_order_allowed"] is False


def test_scheduled_learning_adaptive_learning_caps_use_edge_decay_to_throttle_crypto():
    scheduled = load_module("kalshi_scheduled_learning_adaptive_caps_edge_decay", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "40"])

    caps = scheduled._adaptive_learning_caps(
        args,
        prior_scorecard={"total_created_count": 30, "resolved_count": 15, "blocked_count": 2},
        edge_decay={"status": "decay_alert", "alert_count": 2, "recommended_action": "freeze_promotion_and_collect_fresh_weather_crypto_forward_paper"},
    )

    assert caps["weather_max_auto_candidates"] == 50
    assert caps["crypto_max_auto_candidates"] == 20
    assert caps["crypto_orderbook_multiplier"] == 2
    assert caps["edge_decay_status"] == "decay_alert"
    assert caps["edge_decay_alert_count"] == 2
    assert "recent_edge_decay_throttles_crypto_and_prioritizes_fresh_weather_sampling" in caps["reasons"]
    assert caps["live_order_allowed"] is False
    assert caps["auto_live_promotion_allowed"] is False


def test_scheduled_learning_adaptive_learning_caps_use_segment_decay_domains():
    scheduled = load_module("kalshi_scheduled_learning_adaptive_caps_segment_decay", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "40"])

    caps = scheduled._adaptive_learning_caps(
        args,
        prior_scorecard={"total_created_count": 30, "resolved_count": 15, "blocked_count": 2},
        edge_decay={"status": "stable", "alert_count": 0, "decayed_domains": ["weather"], "segment_decay_alert_count": 1},
    )

    assert caps["weather_max_auto_candidates"] == 20
    assert caps["crypto_max_auto_candidates"] == 50
    assert caps["decayed_domains"] == ["weather"]
    assert "segment_edge_decay_throttles_weather_and_prioritizes_crypto_sampling" in caps["reasons"]
    assert caps["live_order_allowed"] is False


def test_scheduled_learning_quarantine_recovery_summary_counts_domains():
    scheduled = load_module("kalshi_scheduled_learning_quarantine_summary", ROOT / "kalshi_scheduled_learning.py")

    summary = scheduled._quarantine_recovery_summary(
        {
            "forward_paper_quarantine_segments": [
                {"segment_key": "weather|A", "domain": "weather", "recovery_eligible": False},
                {"segment_key": "crypto|B", "domain": "crypto", "recovery_eligible": True},
            ],
            "recovery_sampling_priority_segments": [
                {"rank": 1, "segment_key": "weather|A", "domain": "weather", "live_order_allowed": False},
                {"rank": 2, "segment_key": "crypto|B", "domain": "crypto", "live_order_allowed": False},
            ],
            "forward_paper_quarantine_recovery_policy": {
                "status": "active",
                "forward_paper_reentry_allowed_without_recovery": False,
            },
        }
    )

    assert summary["status"] == "active"
    assert summary["quarantine_segment_count"] == 2
    assert summary["recovery_eligible_count"] == 1
    assert summary["blocked_quarantine_segment_count"] == 1
    assert summary["by_domain"]["weather"]["blocked"] == 1
    assert summary["by_domain"]["crypto"]["recovered"] == 1
    assert summary["recovery_sampling_priority_domains"][0]["domain"] == "weather"
    assert summary["recovery_sampling_priority_segment_count"] == 2
    assert summary["covered_recovery_priority_segment_count"] == 2
    assert summary["uncovered_recovery_priority_segment_count"] == 0
    assert summary["recovery_sampling_priority_segments"][0]["segment_key"] == "weather|A"
    assert summary["top_recovery_sampling_domain"] == "weather"
    assert summary["forward_paper_reentry_allowed_without_recovery"] is False
    assert summary["live_order_allowed"] is False


def test_scheduled_learning_adaptive_caps_prioritize_crypto_quarantine_recovery():
    scheduled = load_module("kalshi_scheduled_learning_quarantine_caps", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "40"])

    caps = scheduled._adaptive_learning_caps(
        args,
        prior_scorecard={"total_created_count": 30, "resolved_count": 15, "blocked_count": 2},
        edge_decay={
            "status": "decay_alert",
            "alert_count": 2,
            "decayed_domains": ["crypto", "weather"],
            "forward_paper_quarantine_segments": [
                *({"segment_key": f"crypto|{index}", "domain": "crypto", "recovery_eligible": False} for index in range(10)),
                *({"segment_key": f"weather|{index}", "domain": "weather", "recovery_eligible": False} for index in range(7)),
            ],
            "forward_paper_quarantine_recovery_policy": {"status": "active", "forward_paper_reentry_allowed_without_recovery": False},
        },
    )

    assert caps["crypto_max_auto_candidates"] == 50
    assert "quarantine_recovery_prioritizes_crypto_shadow_sampling" in caps["reasons"]
    assert caps["live_order_allowed"] is False


def test_scheduled_learning_crypto_args_use_adaptive_caps():
    scheduled = load_module("kalshi_scheduled_learning_crypto_adaptive_args", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "25", "--max-orderbooks", "10", "--max-auto-candidates", "20"])

    step_args = scheduled._crypto_evidence_step_args(
        args,
        acquisition_summary={},
        outcome_scores={},
        adaptive_caps={"crypto_max_auto_candidates": 30, "crypto_orderbook_multiplier": 4},
    )

    assert step_args[step_args.index("--max-orderbooks") + 1] == "40"
    assert step_args[step_args.index("--max-new") + 1] == "30"
    assert "--size-usd" in step_args
    assert step_args[step_args.index("--size-usd") + 1] == "1.0"


def test_scheduled_learning_weather_lock_retry_metrics_count_recovery():
    scheduled = load_module("kalshi_scheduled_learning_weather_lock_metrics", ROOT / "kalshi_scheduled_learning.py")
    steps = [
        {"script": "kalshi_weather_paper_candidates.py", "json_summary": {"created_count": 0}, "stdout_tail": "", "ok": True},
        {
            "script": "kalshi_weather_paper_candidates.py",
            "json_summary": {"created_count": 3, "live_order_allowed": False},
            "stdout_tail": "",
            "ok": True,
            "retried_after_lock_active": True,
            "previous_lock_active_step": {"json_summary": {"skipped_reasons": {"lock_active": 1}}},
        },
    ]

    metrics = scheduled._weather_lock_retry_metrics(steps)

    assert metrics["weather_candidate_step_count"] == 2
    assert metrics["lock_active_count"] == 1
    assert metrics["retry_count"] == 1
    assert metrics["recovered_after_retry_count"] == 1
    assert metrics["created_after_retry_count"] == 3
    assert metrics["live_order_allowed"] is False



def test_scheduled_learning_retries_weather_candidate_lock_once():
    scheduled = load_module("kalshi_scheduled_learning_weather_lock_retry", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-adaptive-wait-seconds", "0", "--max-auto-candidates", "10"])
    calls = []

    def fake_run_script(script, step_args):
        calls.append((script, step_args))
        if len(calls) == 1:
            return {
                "script": script,
                "returncode": 0,
                "stdout_tail": "weather paper candidate lock is active (1.0s old)",
                "stderr_tail": "",
                "json_summary": {"created_count": 0, "skipped_reasons": {"lock_active": 1}},
                "ok": True,
            }
        return {
            "script": script,
            "returncode": 0,
            "stdout_tail": "",
            "stderr_tail": "",
            "json_summary": {"created_count": 2, "live_order_allowed": False},
            "ok": True,
        }

    step = scheduled._run_weather_candidate_step_with_retry(args, search="rain", remaining=10, sample_deficit=20.0, run_script=fake_run_script)

    assert len(calls) == 2
    assert step["json_summary"]["created_count"] == 2
    assert step["retried_after_lock_active"] is True
    assert step["previous_lock_active_step"]["json_summary"]["skipped_reasons"] == {"lock_active": 1}


def test_scheduled_learning_does_not_retry_weather_candidate_without_lock():
    scheduled = load_module("kalshi_scheduled_learning_weather_no_lock_retry", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-auto-candidates", "10"])
    calls = []

    def fake_run_script(script, step_args):
        calls.append((script, step_args))
        return {"script": script, "returncode": 0, "stdout_tail": "", "stderr_tail": "", "json_summary": {"created_count": 1}, "ok": True}

    step = scheduled._run_weather_candidate_step_with_retry(args, search="temperature", remaining=10, sample_deficit=0.0, run_script=fake_run_script)

    assert len(calls) == 1
    assert step["json_summary"]["created_count"] == 1
    assert "retried_after_lock_active" not in step



def test_scheduled_learning_rain_sample_deficit_boosts_weather_args():
    scheduled = load_module("kalshi_scheduled_learning_weather_rain_boost", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "40", "--max-orderbooks", "20", "--max-auto-candidates", "20", "--candidate-max-pages", "2", "--candidate-max-hours", "96"])

    step_args = scheduled._weather_candidate_step_args(args, remaining=20, search="rain", sample_deficit=20.0)

    assert step_args[step_args.index("--max-orderbooks") + 1] == "60"
    assert step_args[step_args.index("--max-new") + 1] == "15"
    assert step_args[step_args.index("--max-hours") + 1] == "72.0"
    assert step_args[step_args.index("--max-pages") + 1] == "3"
    assert step_args[step_args.index("--live-city-search-limit") + 1] == "48"
    assert step_args[step_args.index("--live-search-max-terms") + 1] == "144"
    assert step_args[step_args.index("--size-usd") + 1] == "1.0"



def test_scheduled_learning_crypto_asset_order_uses_recent_outcome_scores():
    scheduled = load_module("kalshi_scheduled_learning_crypto_outcome_decay", ROOT / "kalshi_scheduled_learning.py")
    summary = {
        "asset_blocker_heatmap": {
            "DOGE": {"markov_low_confidence": 2},
            "SOL": {"markov_low_confidence": 2},
        },
        "live_order_allowed": False,
    }

    ordered = scheduled._ordered_crypto_assets_from_heatmap(
        summary,
        outcome_scores={
            "DOGE": {"weighted_accuracy": 0.2, "weighted_pnl_usd": -2.0, "weighted_scored": 5.0},
            "SOL": {"weighted_accuracy": 0.8, "weighted_pnl_usd": 2.0, "weighted_scored": 5.0},
        },
    )

    assert ordered.index("SOL") < ordered.index("DOGE")



def test_scheduled_learning_crypto_evidence_args_keep_default_without_diversification():
    scheduled = load_module("kalshi_scheduled_learning_crypto_args_default", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--observe-limit", "40", "--max-orderbooks", "20", "--max-auto-candidates", "12", "--candidate-max-pages", "2"])

    step_args = scheduled._crypto_evidence_step_args(args, acquisition_summary={})

    assert step_args[step_args.index("--max-orderbooks") + 1] == "40"
    assert step_args[step_args.index("--max-pages") + 1] == "2"
    assert "--searches" not in step_args
    assert "--series-tickers" not in step_args


def test_scheduled_learning_runs_bounded_adaptive_fast_resolution():
    scheduled = load_module("kalshi_scheduled_learning_adaptive_fast_resolution", ROOT / "kalshi_scheduled_learning.py")
    args = scheduled.build_parser().parse_args(["--max-decisions", "125", "--max-adaptive-runs", "2"])
    calls = []
    sleeps = []

    def fake_run_script(script, step_args):
        calls.append((script, step_args))
        return {
            "script": script,
            "returncode": 0,
            "json_summary": {"shadow_resolved_count": 3},
            "ok": True,
        }

    steps = scheduled._run_adaptive_fast_resolution(args, run_script=fake_run_script, sleep_fn=sleeps.append)
    assert len(steps) == 2
    assert sleeps == []
    assert calls == [
        ("kalshi_fast_resolution.py", ["--max-decisions", "125", "--skip-dashboard", "--skip-self-improvement"]),
        ("kalshi_fast_resolution.py", ["--max-decisions", "125", "--skip-dashboard", "--skip-self-improvement"]),
    ]
    assert steps[0]["adaptive_fast_resolution_index"] == 1
    assert steps[1]["adaptive_fast_resolution_total"] == 2
    assert steps[0]["json_summary"]["shadow_resolved_count"] == 3


def test_outcome_resolver_prioritizes_strict_weather_crypto_observations(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_strict_weather_crypto_observations", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "status.json"
    due = "2026-05-01T12:00:00Z"
    decisions = [
        {
            "decision_id": "weather-observation",
            "decision": "NO_TRADE",
            "market_ticker": "KXHIGHAUS-26MAY23-T86",
            "market_title": "Will the high temp in Austin be above 86°?",
            "market_category": "weather",
            "weather_city": "AUSTIN",
            "weather_market_type": "high_temperature",
            "expected_result_known_time_utc": due,
            "simulated_size_usd": 0.0,
        },
        {
            "decision_id": "false-crypto-sports",
            "decision": "NO_TRADE",
            "market_ticker": "KXMVECROSSCATEGORY-S2026F13AD4E1755-54021F5BECF",
            "market_title": "yes Matteo Arnaldi,yes Solana Sierra,yes Lilli Tagger",
            "market_category": "KXMVECROSSCATEGORY-S2026F13AD4E1755",
            "strategy_taxonomy": {"domain": "crypto", "taxonomy_version": "2026-05-04"},
            "expected_result_known_time_utc": due,
            "simulated_size_usd": 0.0,
        },
        {
            "decision_id": "false-weather-sports",
            "decision": "SHADOW_PAPER_EXPLORE_BUY_YES",
            "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S202611C5E8CB4A8-7EC2BEBE0C6",
            "market_title": "yes St. Louis,yes Ryan Weathers: 5+,no Over 9.5 runs scored",
            "market_category": "weather",
            "strategy_bucket": "weather_arbitrage_strategy",
            "fair_value_source_type": "kalshi_weather_relative_value",
            "strategy_taxonomy": {"domain": "weather", "taxonomy_version": "2026-05-04"},
            "expected_result_known_time_utc": due,
            "simulated_size_usd": 0.0,
        },
    ]
    decisions_path.write_text("\n".join(json.dumps(record) for record in decisions) + "\n", encoding="utf-8")
    outcomes_path.write_text("", encoding="utf-8")
    shadow_path.write_text("", encoding="utf-8")

    def fake_kalshi_get(path):
        assert path == "/markets/KXHIGHAUS-26MAY23-T86"
        return {
            "ok": True,
            "data": {"market": {"ticker": "KXHIGHAUS-26MAY23-T86", "status": "settled", "result": "yes"}},
        }

    monkeypatch.setattr(resolver, "kalshi_get", fake_kalshi_get)
    args = Namespace(
        decisions_log=str(decisions_path),
        outcomes_log=str(outcomes_path),
        shadow_outcomes_log=str(shadow_path),
        max_decisions=50,
        include_not_due=False,
        include_weather_crypto_shadow=True,
        include_weather_crypto_observations=True,
        prioritize_current_epoch=True,
        prioritize_weather_crypto=True,
        resolve_cached_ticker_fanout=True,
        max_cache_fanout_decisions=50,
        resolution_status_path=str(status_path),
    )

    result = resolver.resolve(args)

    assert result["weather_crypto_observation_candidate_count"] == 1
    assert result["selected_candidate_count"] == 1
    assert result["checked_by_category"] == {"weather": 1}
    assert result["shadow_resolved_count"] == 1
    assert result["resolved_count"] == 0
    shadow_records = [json.loads(line) for line in shadow_path.read_text(encoding="utf-8").splitlines()]
    assert shadow_records[0]["decision_id"] == "weather-observation"
    assert shadow_records[0]["observation_only_resolution"] is True
    assert shadow_records[0]["live_order_allowed"] is False


def test_scheduled_learning_summarizes_weather_crypto_accelerator(monkeypatch):
    scheduled = load_module("kalshi_scheduled_learning_accelerator_summary", ROOT / "kalshi_scheduled_learning.py")

    class FakeProcess:
        returncode = 0
        stderr = ""
        stdout = json.dumps(
            {
                "ok": True,
                "data": {
                    "ok": True,
                    "row_deficits": {"rows_needed": 35, "live_order_allowed": False},
                    "proof_deficits": {"challenger_beats_market": False, "live_order_allowed": False},
                    "resolver_priorities": {"due_or_overdue_count": 4, "live_order_allowed": False},
                    "candidate_acquisition_targets": [{"action": "collect_near_resolution_rows", "live_order_allowed": False}],
                    "learning_speed_plan": [{"step": 1, "status": "implemented", "live_order_allowed": False}],
                    "next_actions": ["resolve_due_weather_crypto_outcomes"],
                    "live_order_allowed": False,
                },
            }
        )

    monkeypatch.setattr(scheduled.subprocess, "run", lambda *args, **kwargs: FakeProcess())

    step = scheduled._run_script("kalshi_weather_crypto_learning_accelerator.py")

    assert step["ok"] is True
    assert step["json_summary"]["row_deficits"]["rows_needed"] == 35
    assert step["json_summary"]["proof_deficits"]["challenger_beats_market"] is False
    assert step["json_summary"]["resolver_priorities"]["due_or_overdue_count"] == 4
    assert step["json_summary"]["candidate_acquisition_targets"][0]["live_order_allowed"] is False
    assert step["json_summary"]["learning_speed_plan"][0]["status"] == "implemented"
    assert step["json_summary"]["next_actions"] == ["resolve_due_weather_crypto_outcomes"]


def test_scheduled_learning_extracts_crypto_readiness_recheck_time():
    scheduled = load_module("kalshi_scheduled_learning_crypto_readiness", ROOT / "kalshi_scheduled_learning.py")
    result = scheduled._crypto_readiness_from_steps(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "active_crypto_markets_seen": 5,
                    "parseable_crypto_markets": 0,
                    "crypto_readiness_status": "scheduled",
                    "next_crypto_trade_ready_check_time_utc": "2026-05-17T21:00:00Z",
                    "seconds_until_next_crypto_trade_ready_check": 600,
                    "next_crypto_trade_ready_unavailable_reason": None,
                    "last_crypto_trade_ready_check_time_utc": None,
                    "crypto_parse_blockers": {"crypto_market_not_trade_ready_target_tbd": 5},
                    "market_source_counts": {"series_ticker": 5},
                    "crypto_readiness_summary": "Next crypto trade-ready check is around 2026-05-17T21:00:00Z.",
                },
            }
        ],
        now=datetime(2026, 5, 17, 20, 50, tzinfo=timezone.utc),
        lead_seconds=60,
    )

    assert result["enabled"] is True
    assert result["crypto_readiness_status"] == "scheduled"
    assert result["next_recommended_cycle_at_utc"] == "2026-05-17T20:59:00Z"
    assert result["next_crypto_trade_ready_unavailable_reason"] is None
    assert result["last_crypto_trade_ready_check_time_utc"] is None
    assert result["recommended_action"] == "run_kalshi_scheduled_learning_at_recommended_time"
    assert result["live_order_allowed"] is False
    assert result["auto_live_promotion_allowed"] is False


def test_scheduled_learning_uses_reason_aware_crypto_recheck_policy():
    scheduled = load_module("kalshi_scheduled_learning_reason_aware_crypto", ROOT / "kalshi_scheduled_learning.py")
    result = scheduled._crypto_readiness_from_steps(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "active_crypto_markets_seen": 5,
                    "parseable_crypto_markets": 5,
                    "crypto_readiness_status": "scheduled",
                    "next_crypto_trade_ready_check_time_utc": "2026-05-18T16:05:00Z",
                    "seconds_until_next_crypto_trade_ready_check": 900,
                    "next_crypto_learning_snapshot_check_time_utc": "2026-05-18T15:53:00Z",
                    "seconds_until_next_crypto_learning_snapshot_check": 180,
                    "next_crypto_learning_check_reason": "rolling_parseable_learning",
                    "crypto_readiness_summary": "Current crypto markets are parseable.",
                    "reason_aware_crypto_acquisition": {
                        "dominant_blocker": "markov_low_confidence",
                        "recommended_policy": "diversify_away_from_repeated_markov_blockers_until_next_cohort",
                        "blocker_counts": {"markov_low_confidence": 5},
                        "live_order_allowed": False,
                    },
                },
            }
        ],
        now=datetime(2026, 5, 18, 15, 50, tzinfo=timezone.utc),
        lead_seconds=60,
    )

    assert result["recommended_action"] == "run_kalshi_scheduled_learning_at_recommended_time_with_diversified_crypto_search"
    assert result["next_recommended_cycle_at_utc"] == "2026-05-18T15:52:00Z"
    assert result["dominant_crypto_acquisition_blocker"] == "markov_low_confidence"
    assert result["crypto_acquisition_recommended_policy"] == "diversify_away_from_repeated_markov_blockers_until_next_cohort"
    assert result["live_order_allowed"] is False



def test_scheduled_learning_schedules_rolling_parseable_crypto_recheck():
    scheduled = load_module("kalshi_scheduled_learning_crypto_rolling", ROOT / "kalshi_scheduled_learning.py")
    result = scheduled._crypto_readiness_from_steps(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "active_crypto_markets_seen": 5,
                    "parseable_crypto_markets": 5,
                    "crypto_readiness_status": "scheduled",
                    "next_crypto_trade_ready_check_time_utc": "2026-05-18T16:05:00Z",
                    "seconds_until_next_crypto_trade_ready_check": 900,
                    "next_crypto_learning_snapshot_check_time_utc": "2026-05-18T15:53:00Z",
                    "seconds_until_next_crypto_learning_snapshot_check": 180,
                    "next_crypto_trade_ready_unavailable_reason": None,
                    "last_crypto_trade_ready_check_time_utc": None,
                    "next_crypto_learning_check_reason": "rolling_parseable_learning",
                    "crypto_parse_blockers": {},
                    "crypto_readiness_summary": "Current crypto markets are parseable; next intra-window snapshot check is around 2026-05-18T15:53:00Z; result/cohort check is around 2026-05-18T16:05:00Z.",
                },
            }
        ],
        now=datetime(2026, 5, 18, 15, 50, tzinfo=timezone.utc),
        lead_seconds=60,
    )

    assert result["crypto_readiness_status"] == "scheduled"
    assert result["next_recommended_cycle_at_utc"] == "2026-05-18T15:52:00Z"
    assert result["next_crypto_learning_snapshot_check_time_utc"] == "2026-05-18T15:53:00Z"
    assert result["next_crypto_learning_check_reason"] == "rolling_parseable_learning"
    assert result["recommended_action"] == "run_kalshi_scheduled_learning_at_recommended_time"
    assert "intra-window snapshot" in result["plain_english"]
    assert result["live_order_allowed"] is False
    assert result["auto_live_promotion_allowed"] is False


def test_scheduled_learning_extracts_crypto_readiness_due_now():
    scheduled = load_module("kalshi_scheduled_learning_crypto_due_now", ROOT / "kalshi_scheduled_learning.py")
    result = scheduled._crypto_readiness_from_steps(
        [
            {
                "script": "kalshi_crypto_evidence.py",
                "json_summary": {
                    "active_crypto_markets_seen": 5,
                    "parseable_crypto_markets": 0,
                    "crypto_readiness_status": "check_due_now",
                    "next_crypto_trade_ready_check_time_utc": None,
                    "seconds_until_next_crypto_trade_ready_check": 0,
                    "next_crypto_trade_ready_unavailable_reason": "latest_crypto_trade_ready_check_time_already_due",
                    "last_crypto_trade_ready_check_time_utc": "2026-05-17T21:00:00Z",
                    "crypto_parse_blockers": {"crypto_market_not_trade_ready_target_tbd": 5},
                    "crypto_readiness_summary": "Latest crypto trade-ready check time has arrived; rerun crypto evidence now.",
                },
            }
        ],
        now=datetime(2026, 5, 17, 21, 1, tzinfo=timezone.utc),
    )

    assert result["crypto_readiness_status"] == "check_due_now"
    assert result["next_recommended_cycle_at_utc"] is None
    assert result["next_crypto_trade_ready_unavailable_reason"] == "latest_crypto_trade_ready_check_time_already_due"
    assert result["last_crypto_trade_ready_check_time_utc"] == "2026-05-17T21:00:00Z"
    assert result["recommended_action"] == "run_kalshi_crypto_evidence_now"
    assert "run crypto evidence now" in result["plain_english"]
    assert result["live_order_allowed"] is False
    assert result["auto_live_promotion_allowed"] is False


def test_weather_model_audit_is_current_epoch_and_preserves_old_baseline():
    dashboard = load_module("kalshi_dashboard_weather_audit", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    audit = payload["weather_model_audit"]
    assert audit["ok"] is True
    assert audit["scope"] == "current_epoch"
    assert audit["is_current"] is True
    assert audit["live_order_allowed"] is False
    assert audit["auto_apply_allowed"] is False
    assert "updated_at_utc" in audit
    assert "plain_english" in audit and audit["plain_english"]
    assert "failure_mode_explanations" in audit
    assert "settlement_parse_gap" in audit["failure_mode_explanations"]
    assert audit["failure_mode_explanations"]["settlement_parse_gap"]["label"] == "Settlement parsing needs review"
    assert audit["weather_decisions"] == payload["paper"]["by_category"].get("weather", 0)
    assert audit["scored_weather_decisions"] <= payload["performance_summary"]["scored_accepted_trades"]
    assert payload["all_time_baseline"]["weather_model_audit"]["scope"] == "preserved_all_time_baseline"
    assert payload["all_time_baseline"]["weather_model_audit"]["is_current"] is False


def test_weather_model_audit_groups_duplicate_city_buckets():
    dashboard = load_module("kalshi_dashboard_weather_grouping", ROOT / "kalshi_dashboard.py")
    decision_1 = {
        "decision_id": "weather-1",
        "timestamp_utc": "2026-05-11T10:00:00Z",
        "decision": "PAPER_BUY_YES",
        "market_title": "Will the high temp in Houston be above 80 on May 11, 2026?",
        "market_ticker": "KXHOUSTONHIGH-26MAY11-B80",
        "market_category": "weather",
        "simulated_size_usd": 2,
        "paper_fill_price_cents": 72,
        "fair_probability": 0.8,
        "edge_after_costs_pct": 1.5,
        "expected_result_known_time_utc": None,
    }
    decision_2 = {
        **decision_1,
        "decision_id": "weather-2",
        "paper_fill_price_cents": 60,
    }
    outcomes = {
        "weather-1": {
            "decision_id": "weather-1",
            "resolved": True,
            "outcome_yes": 0,
            "settlement_checked_at_utc": "2026-05-12T10:00:00Z",
        },
        "weather-2": {
            "decision_id": "weather-2",
            "resolved": True,
            "outcome_yes": 1,
            "settlement_checked_at_utc": "2026-05-12T10:01:00Z",
        },
    }
    audit = dashboard._weather_model_audit(
        [decision_1, decision_2],
        outcomes,
        now_text="2026-05-12T10:02:00Z",
        weather_source_freshness={"ok": True, "fresh_city_count": 32, "checked_city_count": 32},
        previous_weather_audit={},
    )
    assert audit["weather_decisions"] == 2
    assert audit["scored_weather_decisions"] == 2
    houston_rows = [row for row in audit["bucket_summaries"] if row["city"] == "HOUSTON"]
    assert len(houston_rows) == 1
    assert houston_rows[0]["scored"] == 2
    assert houston_rows[0]["top_failure_mode"]["label"] == "Result time missing"


def test_weather_failure_modes_do_not_treat_normal_threshold_reason_as_parse_gap():
    dashboard = load_module("kalshi_dashboard_weather_failure_modes", ROOT / "kalshi_dashboard.py")
    decision = {
        "decision_id": "weather-threshold-ok",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "market_title": "Will the high temp in Houston be above 80 on May 11, 2026?",
        "market_category": "weather",
        "simulated_size_usd": 1.0,
        "paper_fill_price_cents": 55,
        "fair_probability": 0.62,
        "edge_after_costs_pct": 5.0,
        "expected_result_known_time_utc": "2026-05-12T05:00:00Z",
        "reason": "Weather model paper candidate: HOUSTON high temperature forecast 83.1 vs threshold above 80.0.",
    }
    modes = dashboard._weather_failure_modes(decision, {"resolved": True, "outcome_yes": 0})
    assert "settlement_parse_gap" not in modes


def test_zero_dollar_quotes_are_not_scoreable_accepted_trades():
    dashboard = load_module("kalshi_dashboard_zero_quote", ROOT / "kalshi_dashboard.py")
    assert dashboard._is_accepted({"decision": "PAPER_EXPLORE_QUOTE", "simulated_size_usd": 0.0}) is False
    assert dashboard._is_accepted({"decision": "PAPER_EXPLORE_BUY_YES", "simulated_size_usd": 1.0}) is True


def test_pending_trade_record_explains_multileg_win_condition():
    dashboard = load_module("kalshi_dashboard_pending_condition", ROOT / "kalshi_dashboard.py")
    record = dashboard._pending_trade_record(
        {
            "decision_id": "pending-1",
            "market_ticker": "KXMVESPORTS-TEST",
            "market_title": "yes Leeds United,yes Napoli,no Over 4.5 goals scored",
            "decision": "PAPER_INVERSE_FORWARD_BUY_YES",
            "selected_executable_side": "YES",
            "simulated_size_usd": 1.0,
            "paper_fill_price_cents": 20,
            "fair_probability": 0.2,
            "expected_result_known_time_utc": "2026-05-11T22:45:00Z",
            "evidence_tier": "forward_paper",
            "live_order_allowed": False,
        }
    )
    assert record["bet_summary"] == "Paper buy YES on: yes Leeds United,yes Napoli,no Over 4.5 goals scored"
    assert record["win_condition"] == (
        "To win, this paper trade needs Kalshi to resolve the market YES. In plain English, "
        "these must happen: Leeds United; Napoli; these must not happen: Over 4.5 goals scored."
    )
    assert record["estimated_success_probability"] == 0.2
    assert record["market_probability_at_entry"] == 0.2
    assert record["paper_profit_if_win_usd"] == 4.0
    assert record["paper_loss_if_wrong_usd"] == -1.0
    assert record["live_order_allowed"] is False


def test_recent_paper_bet_record_joins_resolved_outcome():
    dashboard = load_module("kalshi_dashboard_recent_bet", ROOT / "kalshi_dashboard.py")
    decision = {
        "decision_id": "recent-1",
        "market_ticker": "KXTEST",
        "market_title": "yes Test outcome",
        "decision": "PAPER_INVERSE_FORWARD_BUY_NO",
        "selected_executable_side": "NO",
        "simulated_size_usd": 1.0,
        "paper_fill_price_cents": 80,
        "timestamp_utc": "2026-05-11T12:00:00Z",
        "evidence_tier": "exploration",
        "live_order_allowed": False,
    }
    outcome = {
        "decision_id": "recent-1",
        "resolved": True,
        "outcome_yes": 0,
        "settlement_checked_at_utc": "2026-05-11T13:00:00Z",
        "settlement_source": "kalshi_market_result_read",
        "live_order_allowed": False,
    }
    record = dashboard._recent_paper_bet_record(decision, {"recent-1": outcome})
    assert record["outcome_status"] == "resolved"
    assert record["outcome_yes"] == 0
    assert record["paper_result"] == "win"
    assert record["paper_pnl_usd"] == 0.25
    assert record["settlement_checked_at_utc"] == "2026-05-11T13:00:00Z"
    assert record["settlement_source"] == "kalshi_market_result_read"
    assert record["live_order_allowed"] is False


def test_dashboard_write_outputs_refreshable_files():
    dashboard = load_module("kalshi_dashboard", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    dashboard.atomic_write_json(ROOT / "logs" / "dashboard_output.json", payload)
    dashboard.atomic_write_json(ROOT / "dashboard" / "kalshi_dashboard_data.json", payload)
    dashboard.write_dashboard_html()
    data_path = ROOT / "dashboard" / "kalshi_dashboard_data.json"
    html_path = ROOT / "dashboard" / "kalshi_dashboard.html"
    assert data_path.exists()
    assert html_path.exists()
    payload = json.loads(data_path.read_text())
    assert payload["dashboard_cache"]["cache_hit"] is False
    assert payload["dashboard_cache"]["generated_age_minutes"] == 0.0
    assert payload["live_order_allowed"] is False
    assert payload["learning_velocity"]["live_order_allowed"] is False
    assert "latest_learning_age_minutes" in payload["learning_velocity"]
    assert payload["gap01_forward_proof"]["live_order_allowed"] is False
    assert "target_scored_positive_baseline_beating_outcomes" in payload["gap01_forward_proof"]
    html = html_path.read_text(encoding="utf-8")
    assert "Today&apos;s Answer" in html
    assert "Command Flow" in html
    assert "command-flow" in html
    assert "renderCommandFlow" in html
    assert "Plain English" in html
    assert "Learning Lanes" in html
    assert "Fair Comparison" in html
    assert "Data Integrity" in html
    assert "At a Glance" in html
    assert "Learning Heartbeat" in html
    assert "Proof Mission" in html
    assert "Frontier Segments" in html
    assert "Live trading blocked" in html
    assert "All-Time Baseline Preserved From Before The Reset" in html
    assert "Strategy Comparison" in html
    assert "Equal Weight" in html
    assert "P&L Δ vs Standard" in html
    assert "pnl_delta_display" in html
    assert "Weather Arbitrage Strategy" in html
    assert "PolyClaw" in html
    assert "polymarket-kalshi-divergence" in html


def test_epoch_reset_preserves_history_and_makes_inverse_primary(tmp_path):
    epoch = load_module("kalshi_epoch", ROOT / "kalshi_epoch.py")
    epoch_path = tmp_path / "epoch.json"
    state_path = tmp_path / "strategy.json"
    diagnosis_path = tmp_path / "diagnosis.json"
    events_path = tmp_path / "events.jsonl"
    state_path.write_text(
        json.dumps(
            {
                "blocked_accepted_paper_categories": ["weather"],
                "inverse_forward_test_categories": [],
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    result = epoch.create_epoch(
        Namespace(
            start_new=True,
            epoch_id="test-epoch-2",
            epoch_name="Epoch 2 - Inverse Standard Strategy Paper Strategy",
            started_at_utc="2026-05-11T00:00:00Z",
            reason="fixture reset",
            categories="weather,sports,other",
            state_path=str(epoch_path),
            events_log=str(events_path),
            strategy_state_path=str(state_path),
            proof_diagnosis_path=str(diagnosis_path),
            shadow_only=False,
        )
    )
    written_epoch = json.loads(epoch_path.read_text(encoding="utf-8"))
    written_state = json.loads(state_path.read_text(encoding="utf-8"))
    written_diagnosis = json.loads(diagnosis_path.read_text(encoding="utf-8"))
    assert result["epoch"]["primary_paper_strategy"] == "inverse_first"
    assert written_epoch["history_policy"] == "preserve_all_prior_logs_as_baseline"
    assert written_state["primary_paper_strategy"] == "inverse_first"
    assert written_state["paper_trading_paused"] is False
    assert written_state["blocked_accepted_paper_categories"] == []
    assert written_state["blocked_current_side_categories"] == ["weather", "sports", "other"]
    assert written_state["inverse_forward_test_categories"] == ["weather", "sports", "other"]
    assert written_diagnosis["inverse_expansion_allowed"] is True
    assert written_diagnosis["live_order_allowed"] is False
    assert json.loads(events_path.read_text(encoding="utf-8").splitlines()[0])["live_order_allowed"] is False


def test_dashboard_server_status_is_read_only():
    server = load_module("kalshi_dashboard_server", ROOT / "kalshi_dashboard_server.py")
    payload = server._status_payload({"ok": True, "refreshed": False})
    assert payload["ok"] is True
    assert payload["mode"] == "READ_ONLY"
    assert payload["live_order_allowed"] is False
    assert payload["auto_apply_allowed"] is False


def test_kalshi_common_fails_closed_with_missing_secrets(monkeypatch):
    common = load_module("kalshi_common", ROOT / "lib" / "kalshi_common.py")
    monkeypatch.setenv("KALSHI_SECRETS_PATH", "/private/tmp/openclaw-missing-kalshi-secrets.json")
    result = common.kalshi_get("/trade-api/v2/markets/TEST")
    assert result["ok"] is False
    assert result["data"] is None
    assert result["error"]["type"] == "KalshiReadError"
    assert "not found" in result["error"]["message"]
    assert result["request"]["method"] == "GET"


def test_scheduled_learning_accepts_installed_launchd_arguments():
    scheduled = load_module("kalshi_scheduled_learning", ROOT / "kalshi_scheduled_learning.py")
    default_args = scheduled.build_parser().parse_args([])
    assert default_args.candidate_max_hours == 48.0
    assert "weather" in default_args.candidate_searches
    assert "crypto" in default_args.candidate_searches
    assert "sports" not in default_args.candidate_searches
    assert "game" not in default_args.candidate_searches
    args = scheduled.build_parser().parse_args(
        [
            "--observe-limit",
            "50",
            "--max-orderbooks",
            "20",
            "--max-watchlist-markets",
            "20",
            "--max-auto-candidates",
            "10",
            "--candidate-searches",
            "sports,weather",
            "--candidate-max-hours",
            "12",
            "--candidate-max-pages",
            "4",
            "--max-adaptive-wait-seconds",
            "240",
            "--max-adaptive-runs",
            "2",
            "--focused-watchlist",
        ]
    )
    assert args.observe_limit == 50
    assert args.max_decisions == 300
    assert args.max_orderbooks == 20
    assert args.max_watchlist_markets == 20
    assert args.max_auto_candidates == 10
    assert args.candidate_searches == "sports,weather"
    assert args.candidate_max_hours == 12
    assert args.candidate_max_pages == 4
    assert args.max_adaptive_wait_seconds == 240
    assert args.max_adaptive_runs == 2
    assert args.focused_watchlist is True


def test_weather_learning_cycle_accepts_installed_launchd_arguments():
    weather_cycle = load_module("kalshi_weather_learning_cycle", ROOT / "kalshi_weather_learning_cycle.py")
    args = weather_cycle.build_parser().parse_args(
        [
            "--limit",
            "100",
            "--max-source-markets",
            "25",
            "--max-paper-candidates",
            "25",
        ]
    )
    assert args.limit == 100
    assert args.max_source_markets == 25
    assert args.max_paper_candidates == 25


def test_weather_learning_cycle_reports_scheduled_timeout_without_traceback(tmp_path, monkeypatch):
    weather_cycle = load_module("kalshi_weather_learning_cycle_timeout", ROOT / "kalshi_weather_learning_cycle.py")

    def raise_timeout(*_args, **_kwargs):
        raise weather_cycle.subprocess.TimeoutExpired(
            cmd=["kalshi_scheduled_learning.py"],
            timeout=180,
            output="partial scheduled stdout",
            stderr="partial scheduled stderr",
        )

    monkeypatch.setattr(weather_cycle.subprocess, "run", raise_timeout)

    result = weather_cycle.run_cycle(
        Namespace(
            limit=40,
            max_series=None,
            max_source_markets=20,
            max_paper_candidates=8,
            skip_cache_warmup=False,
            stale_lock_seconds=30,
            skip_sources=True,
            runs_log=str(tmp_path / "weather_runs.jsonl"),
        )
    )

    assert result["ok"] is False
    assert result["data"] is None
    assert result["error"]["type"] == "WeatherLearningCycleError"
    assert "scheduled maintenance cycle timed out" in result["meta"]["warnings"]
    written = (tmp_path / "weather_runs.jsonl").read_text(encoding="utf-8")
    assert "scheduled maintenance cycle timed out" in written


def test_weather_outcome_resolver_deduplicates_scored_decisions(tmp_path, monkeypatch):
    resolver = load_module("kalshi_weather_outcome_resolver", ROOT / "kalshi_weather_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    decision = {
        "decision_id": "decision-1",
        "fair_value_source_type": "weather_model",
        "market_ticker": "KXTEST-26MAY09-B70",
    }
    decisions_path.write_text(json.dumps(decision) + "\n", encoding="utf-8")

    def fake_get(_path):
        return {
            "ok": True,
            "data": {"market": {"result": "yes"}},
            "status_code": 200,
        }

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    args = Namespace(decisions_log=str(decisions_path), outcomes_log=str(outcomes_path), max_decisions=10)
    first = resolver.resolve(args)
    second = resolver.resolve(args)
    lines = [line for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert first["resolved_count"] == 1
    assert second["resolved_count"] == 0
    assert second["skipped_existing_count"] == 1
    assert len(lines) == 1
    assert json.loads(lines[0])["live_order_allowed"] is False


def test_general_outcome_resolver_prioritizes_due_and_deduplicates(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "already",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXALREADY",
                        "simulated_size_usd": 1,
                        "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "due",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXDUE",
                        "simulated_size_usd": 1,
                        "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text(json.dumps({"decision_id": "already", "resolved": True, "outcome_yes": 1}) + "\n", encoding="utf-8")

    def fake_get(path):
        assert path == "/markets/KXDUE"
        return {"ok": True, "data": {"market": {"result": "no", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    status_path = tmp_path / "outcome_resolution_latest.json"
    result = resolver.resolve(Namespace(decisions_log=str(decisions_path), outcomes_log=str(outcomes_path), max_decisions=10, include_not_due=False, resolution_status_path=str(status_path)))
    lines = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert result["resolved_count"] == 1
    assert result["skipped_existing_count"] == 1
    assert lines[-1]["decision_id"] == "due"
    assert lines[-1]["outcome_yes"] == 0
    assert lines[-1]["live_order_allowed"] is False
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["resolved_count"] == 1
    assert status["live_order_allowed"] is False


def test_general_outcome_resolver_records_official_active_unresolved_status(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_status", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "due-active",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": "KXACTIVE",
                "simulated_size_usd": 1,
                "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        assert path == "/markets/KXACTIVE"
        return {"ok": True, "data": {"market": {"status": "active"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            max_decisions=10,
            include_not_due=False,
            resolution_status_path=str(status_path),
        )
    )
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert result["resolved_count"] == 0
    assert result["unresolved_count"] == 1
    assert result["official_result_unavailable_count"] == 1
    assert result["accepted_unresolved_count"] == 1
    assert result["accepted_unresolved_classified_count"] == 1
    assert result["accepted_unresolved_unclassified_count"] == 0
    assert result["accepted_unresolved_retryable_count"] == 1
    assert status["unresolved_reason_counts"]["official_result_unavailable_status_active"] == 1
    assert status["unresolved_reasons"][0]["classification"] == "official_result_not_published"
    assert status["unresolved_reasons"][0]["source_backed_classification"] is True
    assert status["live_order_allowed"] is False


def test_general_outcome_resolver_classifies_404_market_fetch_failures(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_404_classification", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "due-missing-market",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": "KXMISSING",
                "simulated_size_usd": 1,
                "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        assert path == "/markets/KXMISSING"
        return {
            "ok": False,
            "status_code": 404,
            "request": {"path": "/trade-api/v2/markets/KXMISSING"},
            "error": {"type": "KalshiReadError", "message": "not found", "retryable": False},
        }

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            max_decisions=10,
            include_not_due=False,
            resolution_status_path=str(status_path),
        )
    )
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert result["resolved_count"] == 0
    assert result["accepted_unresolved_count"] == 1
    assert result["accepted_unresolved_classified_count"] == 1
    assert result["accepted_unresolved_unclassified_count"] == 0
    assert result["accepted_unresolved_retryable_count"] == 0
    assert status["market_fetch_failed_count"] == 0
    assert status["market_not_found_count"] == 1
    assert status["unresolved_reason_counts"]["market_not_found"] == 1
    unresolved = status["unresolved_reasons"][0]
    assert unresolved["classification"] == "source_market_not_found"
    assert unresolved["source_backed_classification"] is True
    assert unresolved["source_status_code"] == 404
    assert unresolved["live_order_allowed"] is False


def test_general_outcome_resolver_backs_off_recent_dead_accepted_markets(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_dead_market_backoff", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "dead-market",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXDEAD",
                        "simulated_size_usd": 1,
                        "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "fresh-market",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXFRESH",
                        "simulated_size_usd": 1,
                        "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")
    status_path.write_text(
        json.dumps(
            {
                "unresolved_reasons": [
                    {
                        "decision_id": "dead-market",
                        "market_ticker": "KXDEAD",
                        "reason": "market_not_found",
                        "accepted_paper_outcome": True,
                        "source_backed_classification": True,
                        "retryable": False,
                        "settlement_checked_at_utc": "2026-05-30T17:00:00Z",
                        "live_order_allowed": False,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    calls = []

    def fake_get(path):
        calls.append(path)
        assert path == "/markets/KXFRESH"
        return {"ok": True, "data": {"market": {"result": "yes", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            max_decisions=10,
            include_not_due=False,
            resolution_status_path=str(status_path),
        )
    )
    assert calls == ["/markets/KXFRESH"]
    assert result["resolved_count"] == 1
    assert result["skipped_retry_backoff_count"] == 1
    assert result["accepted_unresolved_count"] == 1
    assert result["accepted_unresolved_classified_count"] == 1
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["unresolved_reasons"][0]["decision_id"] == "dead-market"
    assert status["unresolved_reasons"][0]["checked_in_this_run"] is False
    assert status["live_order_allowed"] is False


def test_general_outcome_resolver_reports_next_due_weather_crypto_time(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_next_due_weather_crypto", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "future-crypto",
                        "decision": "SHADOW_CRYPTO_SPOT_MODEL_YES",
                        "market_ticker": "KXBTC15M-99JAN011200-00",
                        "market_category": "crypto",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "expected_result_known_time_utc": "2099-01-01T12:05:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "future-weather",
                        "decision": "SHADOW_WEATHER_MODEL_YES",
                        "market_ticker": "KXHIGHTEMP-99JAN01CHI-T40",
                        "market_category": "weather",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "expected_result_known_time_utc": "2099-01-01T12:10:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(resolver, "kalshi_get", lambda path: (_ for _ in ()).throw(AssertionError(path)))

    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(tmp_path / "shadow_outcomes.jsonl"),
            max_decisions=10,
            include_not_due=False,
            include_weather_crypto_observations=True,
            include_weather_crypto_shadow=True,
            prioritize_current_epoch=True,
            prioritize_weather_crypto=True,
            resolve_cached_ticker_fanout=True,
            max_cache_fanout_decisions=10,
            resolution_status_path=str(status_path),
        )
    )

    assert result["selected_candidate_count"] == 0
    assert result["skipped_shadow_not_due_count"] == 2
    assert result["skipped_not_due_by_category"] == {"crypto": 1, "weather": 1}
    assert result["next_due_candidate_time_utc"] == "2099-01-01T12:05:00Z"
    assert result["next_due_weather_crypto_candidate_time_utc"] == "2099-01-01T12:05:00Z"
    assert result["next_due_crypto_candidate_time_utc"] == "2099-01-01T12:05:00Z"
    assert isinstance(result["seconds_until_next_due_crypto_candidate"], int)
    assert result["seconds_until_next_due_crypto_candidate"] > 0
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["next_due_weather_crypto_candidate_time_utc"] == "2099-01-01T12:05:00Z"
    assert status["seconds_until_next_due_weather_crypto_candidate"] > 0
    assert status["live_order_allowed"] is False


def test_general_outcome_resolver_prioritizes_current_epoch_due_trades(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_current_epoch", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    epoch_path = tmp_path / "epoch.json"
    epoch_path.write_text(json.dumps({"ok": True, "epoch_id": "epoch-current"}), encoding="utf-8")
    monkeypatch.setattr(resolver, "PAPER_EPOCH_STATE_PATH", epoch_path)
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "old-due",
                        "current_epoch_id": "old",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_YES",
                        "market_ticker": "KXOLD",
                        "simulated_size_usd": 1,
                        "expected_result_known_time_utc": "2026-05-01T00:00:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "current-due",
                        "current_epoch_id": "epoch-current",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_YES",
                        "market_ticker": "KXCURRENT",
                        "simulated_size_usd": 1,
                        "expected_result_known_time_utc": "2026-05-02T00:00:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        assert path == "/markets/KXCURRENT"
        return {"ok": True, "data": {"market": {"result": "yes", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            max_decisions=1,
            include_not_due=False,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    outcomes = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert result["current_epoch_id"] == "epoch-current"
    assert result["candidate_count"] == 2
    assert result["current_epoch_candidate_count"] == 1
    assert result["current_epoch_checked_count"] == 1
    assert result["current_epoch_resolved_count"] == 1
    assert outcomes[0]["decision_id"] == "current-due"
    assert outcomes[0]["live_order_allowed"] is False


def test_general_outcome_resolver_prioritizes_fast_crypto_within_epoch(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_fast_crypto", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    epoch_path = tmp_path / "epoch.json"
    epoch_path.write_text(json.dumps({"ok": True, "epoch_id": "epoch-current"}), encoding="utf-8")
    monkeypatch.setattr(resolver, "PAPER_EPOCH_STATE_PATH", epoch_path)
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "sports-due-earlier",
                        "current_epoch_id": "epoch-current",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXSPORT",
                        "market_category": "sports",
                        "simulated_size_usd": 1,
                        "timestamp_utc": "2026-05-18T15:00:00Z",
                        "expected_result_known_time_utc": "2026-05-18T15:30:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "crypto-due-fast",
                        "current_epoch_id": "epoch-current",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXBTC15M-26MAY181215-15",
                        "market_category": "crypto",
                        "strategy_bucket": "crypto_spot_model",
                        "fair_value_source_type": "crypto_spot_volatility_model",
                        "simulated_size_usd": 1,
                        "timestamp_utc": "2026-05-18T16:00:00Z",
                        "expected_result_known_time_utc": "2026-05-18T16:20:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        assert path == "/markets/KXBTC15M-26MAY181215-15"
        return {"ok": True, "data": {"market": {"result": "yes", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            max_decisions=1,
            include_not_due=False,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    outcomes = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert result["fast_crypto_candidate_count"] == 1
    assert result["fast_crypto_checked_count"] == 1
    assert result["fast_crypto_resolved_count"] == 1
    assert result["resolved_by_category"]["crypto"] == 1
    assert outcomes[0]["decision_id"] == "crypto-due-fast"
    assert outcomes[0]["market_category"] == "crypto"
    assert outcomes[0]["fast_crypto_lane"] is True
    assert outcomes[0]["live_order_allowed"] is False


def test_general_outcome_resolver_scores_crypto_numeric_settlement_before_result_field(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_crypto_numeric_settlement", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "crypto-numeric-settlement",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": "KXSOL15M-26MAY260745-45",
                "market_category": "crypto",
                "strategy_bucket": "crypto_spot_model",
                "fair_value_source_type": "crypto_spot_volatility_model",
                "crypto_evidence": {"asset": "SOL", "threshold_usd": 85.3068, "yes_direction": "above"},
                "simulated_size_usd": 1,
                "timestamp_utc": "2026-05-26T11:35:00Z",
                "expected_result_known_time_utc": "2026-05-26T11:50:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        assert path == "/markets/KXSOL15M-26MAY260745-45"
        return {
            "ok": True,
            "data": {
                "market": {
                    "status": "closed",
                    "result": "",
                    "expiration_value": "85.2620",
                    "yes_sub_title": "Target Price: $85.3068",
                    "rules_primary": "If the simple average is at least the target price, then the market resolves to Yes.",
                }
            },
        }

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            max_decisions=10,
            include_not_due=False,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    outcomes = [json.loads(line) for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert result["resolved_count"] == 1
    assert result["official_result_unavailable_count"] == 0
    assert outcomes[0]["decision_id"] == "crypto-numeric-settlement"
    assert outcomes[0]["outcome_yes"] == 0
    assert outcomes[0]["settlement_source"] == "kalshi_market_numeric_crypto_settlement"
    assert outcomes[0]["numeric_crypto_resolution"]["settlement_value"] == 85.262
    assert outcomes[0]["numeric_crypto_resolution"]["target_price"] == 85.3068
    assert outcomes[0]["live_order_allowed"] is False


def test_general_outcome_resolver_scores_weather_crypto_shadow_to_separate_log(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_shadow_learning", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "crypto-shadow-due",
                        "decision": "SHADOW_CRYPTO_SPOT_MODEL_YES",
                        "market_ticker": "KXBTC15M-26MAY181215-15",
                        "market_category": "crypto",
                        "strategy_bucket": "crypto_spot_model",
                        "fair_value_source_type": "crypto_spot_volatility_model",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "timestamp_utc": "2026-05-18T16:00:00Z",
                        "expected_result_known_time_utc": "2026-05-18T16:20:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "weather-shadow-due",
                        "decision": "SHADOW_PAPER_WEATHER_MODEL_BUY_NO",
                        "market_ticker": "KXLOWTDEN-26MAY18-T37",
                        "market_category": "weather",
                        "strategy_bucket": "weather_model_fast_evidence",
                        "fair_value_source_type": "weather_model",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "sports-shadow-ignored",
                        "decision": "SHADOW_PAPER_EXPLORE_BUY_YES",
                        "market_ticker": "KXSPORT",
                        "market_category": "sports",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        assert path in {"/markets/KXBTC15M-26MAY181215-15", "/markets/KXLOWTDEN-26MAY18-T37"}
        return {"ok": True, "data": {"market": {"result": "yes", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(shadow_outcomes_path),
            max_decisions=10,
            include_not_due=False,
            include_weather_crypto_shadow=True,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    paper_outcomes = [line for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    shadow_outcomes = [json.loads(line) for line in shadow_outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert result["resolved_count"] == 0
    assert result["shadow_candidate_count"] == 2
    assert result["shadow_checked_count"] == 2
    assert result["shadow_resolved_count"] == 2
    assert paper_outcomes == []
    assert {row["decision_id"] for row in shadow_outcomes} == {"crypto-shadow-due", "weather-shadow-due"}
    assert all(row["shadow_learning_outcome"] is True for row in shadow_outcomes)
    assert all(row["simulated_size_usd"] == 0.0 for row in shadow_outcomes)
    assert all(row["live_order_allowed"] is False for row in shadow_outcomes)
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["shadow_resolved_count"] == 2


def test_general_outcome_resolver_scores_direct_captured_sports_shadow_to_separate_log(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_direct_captured_sports_shadow", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "sports-direct-shadow-due",
                        "decision": "SHADOW_POLYCLAW_AWAITING_EXTERNAL_REFERENCE_YES",
                        "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S2026TEST-YES",
                        "market_category": "sports",
                        "strategy_bucket": "polyclaw",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "timestamp_utc": "2026-05-18T16:00:00Z",
                        "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
                        "direct_market_price_capture": {
                            "capture_status": "captured_direct",
                            "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S2026TEST-YES",
                        },
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "sports-shadow-no-direct-capture",
                        "decision": "SHADOW_POLYCLAW_AWAITING_EXTERNAL_REFERENCE_YES",
                        "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S2026TEST-NOCAPTURE",
                        "market_category": "sports",
                        "strategy_bucket": "polyclaw",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "timestamp_utc": "2026-05-18T16:00:00Z",
                        "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")
    shadow_outcomes_path.write_text("", encoding="utf-8")
    calls = []

    def fake_get(path):
        calls.append(path)
        assert path == "/markets/KXMVESPORTSMULTIGAMEEXTENDED-S2026TEST-YES"
        return {"ok": True, "data": {"market": {"result": "yes", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(shadow_outcomes_path),
            max_decisions=10,
            include_not_due=False,
            include_weather_crypto_shadow=True,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    paper_outcomes = [line for line in outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    shadow_outcomes = [json.loads(line) for line in shadow_outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert calls == ["/markets/KXMVESPORTSMULTIGAMEEXTENDED-S2026TEST-YES"]
    assert result["resolved_count"] == 0
    assert result["shadow_candidate_count"] == 1
    assert result["shadow_checked_count"] == 1
    assert result["shadow_resolved_count"] == 1
    assert result["resolved_by_category"] == {"sports": 1}
    assert paper_outcomes == []
    assert len(shadow_outcomes) == 1
    assert shadow_outcomes[0]["decision_id"] == "sports-direct-shadow-due"
    assert shadow_outcomes[0]["market_category"] == "sports"
    assert shadow_outcomes[0]["strategy_bucket"] == "polyclaw"
    assert shadow_outcomes[0]["shadow_learning_outcome"] is True
    assert shadow_outcomes[0]["simulated_size_usd"] == 0.0
    assert shadow_outcomes[0]["live_order_allowed"] is False


def test_general_outcome_resolver_backs_off_recent_retryable_shadow_unresolved(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_shadow_retry_backoff", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "crypto-shadow-recently-unavailable",
                        "decision": "SHADOW_CRYPTO_SPOT_MODEL_YES",
                        "market_ticker": "KXXRP15M-26MAY260515-15",
                        "market_category": "crypto",
                        "strategy_bucket": "crypto_spot_model",
                        "fair_value_source_type": "crypto_spot_volatility_model",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "timestamp_utc": "2026-05-26T09:00:00Z",
                        "expected_result_known_time_utc": "2026-05-26T09:20:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "crypto-shadow-due-now",
                        "decision": "SHADOW_CRYPTO_SPOT_MODEL_NO",
                        "market_ticker": "KXSOL15M-26MAY260800-00",
                        "market_category": "crypto",
                        "strategy_bucket": "crypto_spot_model",
                        "fair_value_source_type": "crypto_spot_volatility_model",
                        "evidence_tier": "shadow",
                        "simulated_size_usd": 0,
                        "timestamp_utc": "2026-05-26T12:00:00Z",
                        "expected_result_known_time_utc": "2026-05-26T12:05:00Z",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")
    shadow_outcomes_path.write_text("", encoding="utf-8")
    status_path.write_text(
        json.dumps(
            {
                "unresolved_reasons": [
                    {
                        "decision_id": "crypto-shadow-recently-unavailable",
                        "reason": "official_result_unavailable_status_closed",
                        "shadow_learning_outcome": True,
                        "retryable": True,
                        "next_retry_after_utc": "2099-01-01T00:00:00Z",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    calls: list[str] = []

    def fake_get(path):
        calls.append(path)
        assert path == "/markets/KXSOL15M-26MAY260800-00"
        return {"ok": True, "data": {"market": {"result": "no", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(shadow_outcomes_path),
            max_decisions=10,
            include_not_due=False,
            include_weather_crypto_shadow=True,
            include_weather_crypto_observations=True,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    shadow_outcomes = [json.loads(line) for line in shadow_outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert calls == ["/markets/KXSOL15M-26MAY260800-00"]
    assert result["skipped_shadow_retry_backoff_count"] == 1
    assert result["shadow_retry_backoff_unresolved_count"] == 1
    assert result["unresolved_reason_counts"]["official_result_unavailable_status_closed"] == 1
    assert result["shadow_resolved_count"] == 1
    assert shadow_outcomes[0]["decision_id"] == "crypto-shadow-due-now"
    assert shadow_outcomes[0]["live_order_allowed"] is False
    status = json.loads(status_path.read_text(encoding="utf-8"))
    backoff_rows = [row for row in status["unresolved_reasons"] if row.get("decision_id") == "crypto-shadow-recently-unavailable"]
    assert backoff_rows[0]["retry_backoff_active"] is True
    assert backoff_rows[0]["next_retry_after_utc"] == "2099-01-01T00:00:00Z"


def test_general_outcome_resolver_uses_short_retry_backoff_for_closed_fast_crypto():
    resolver = load_module("kalshi_outcome_resolver_fast_crypto_backoff", ROOT / "kalshi_outcome_resolver.py")
    retry_after = resolver._next_retry_after_utc(
        "official_result_unavailable_status_closed",
        checked_at="2026-05-26T13:05:00Z",
        classification={"retryable": True},
        market={"status": "closed"},
        fast_crypto=True,
    )
    assert retry_after == "2026-05-26T13:07:00Z"

    non_crypto_retry_after = resolver._next_retry_after_utc(
        "official_result_unavailable_status_closed",
        checked_at="2026-05-26T13:05:00Z",
        classification={"retryable": True},
        market={"status": "closed"},
        fast_crypto=False,
    )
    assert non_crypto_retry_after == "2026-05-26T13:20:00Z"


def test_general_outcome_resolver_separates_nonretryable_market_not_found(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_market_not_found", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "accepted-invalid-market",
                "decision": "PAPER_BUY_YES",
                "market_ticker": "KXNOTREAL-S2026-TEST",
                "market_category": "other",
                "strategy_bucket": "test",
                "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
                "simulated_size_usd": 1,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text("", encoding="utf-8")
    shadow_outcomes_path.write_text("", encoding="utf-8")

    def fake_get(path):
        return {
            "ok": False,
            "status_code": 404,
            "request": {"path": f"/trade-api/v2{path}"},
            "error": {"type": "KalshiReadError", "retryable": False},
        }

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(shadow_outcomes_path),
            max_decisions=10,
            include_not_due=False,
            include_weather_crypto_shadow=True,
            include_weather_crypto_observations=True,
            prioritize_current_epoch=True,
            prioritize_weather_crypto=True,
            resolve_cached_ticker_fanout=True,
            max_cache_fanout_decisions=10,
            resolution_status_path=str(status_path),
        )
    )
    assert result["market_fetch_failed_count"] == 0
    assert result["market_not_found_count"] == 1
    assert result["unresolved_reason_counts"] == {"market_not_found": 1}
    row = result["unresolved_reasons"][0]
    assert row["classification"] == "source_market_not_found"
    assert row["source_backed_classification"] is True
    assert row["retryable"] is False
    assert row["live_order_allowed"] is False


def test_general_outcome_resolver_reuses_market_fetch_for_duplicate_shadow_tickers(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_shadow_fetch_cache", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    duplicate_records = [
        {
            "decision_id": f"weather-shadow-duplicate-{index}",
            "decision": "SHADOW_PAPER_WEATHER_MODEL_BUY_YES",
            "market_ticker": "KXLOWTDEN-26MAY18-T37",
            "market_category": "weather",
            "strategy_bucket": "weather_model_fast_evidence",
            "fair_value_source_type": "weather_model",
            "evidence_tier": "shadow",
            "simulated_size_usd": 0,
            "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
        }
        for index in range(3)
    ]
    decisions_path.write_text("\n".join(json.dumps(record) for record in duplicate_records) + "\n", encoding="utf-8")
    outcomes_path.write_text("", encoding="utf-8")
    shadow_outcomes_path.write_text("", encoding="utf-8")
    calls: list[str] = []

    def fake_get(path):
        calls.append(path)
        return {"ok": True, "data": {"market": {"result": "no", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(shadow_outcomes_path),
            max_decisions=10,
            include_not_due=False,
            include_weather_crypto_shadow=True,
            prioritize_current_epoch=True,
            resolution_status_path=str(status_path),
        )
    )
    shadow_outcomes = [json.loads(line) for line in shadow_outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert calls == ["/markets/KXLOWTDEN-26MAY18-T37"]
    assert result["checked_count"] == 3
    assert result["unique_market_fetch_count"] == 1
    assert result["market_fetch_cache_hits"] == 2
    assert result["market_fetch_failed_count"] == 0
    assert result["shadow_resolved_count"] == 3
    assert len(shadow_outcomes) == 3
    assert all(outcome["outcome_yes"] == 0 for outcome in shadow_outcomes)
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["unique_market_fetch_count"] == 1
    assert status["market_fetch_cache_hits"] == 2
    assert status["live_order_allowed"] is False


def test_general_outcome_resolver_fans_out_same_ticker_beyond_base_limit(tmp_path, monkeypatch):
    resolver = load_module("kalshi_outcome_resolver_cache_fanout", ROOT / "kalshi_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    status_path = tmp_path / "outcome_resolution_latest.json"
    records = [
        {
            "decision_id": f"weather-shadow-fanout-{index}",
            "decision": "SHADOW_PAPER_WEATHER_MODEL_BUY_YES",
            "market_ticker": "KXLOWTDEN-26MAY18-T37",
            "market_category": "weather",
            "strategy_bucket": "weather_model_fast_evidence",
            "fair_value_source_type": "weather_model",
            "evidence_tier": "shadow",
            "simulated_size_usd": 0,
            "expected_result_known_time_utc": "2026-05-18T19:00:00Z",
        }
        for index in range(4)
    ]
    decisions_path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
    outcomes_path.write_text("", encoding="utf-8")
    shadow_outcomes_path.write_text("", encoding="utf-8")
    calls: list[str] = []

    def fake_get(path):
        calls.append(path)
        return {"ok": True, "data": {"market": {"result": "yes", "status": "settled"}}}

    monkeypatch.setattr(resolver, "kalshi_get", fake_get)
    result = resolver.resolve(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            shadow_outcomes_log=str(shadow_outcomes_path),
            max_decisions=1,
            include_not_due=False,
            include_weather_crypto_shadow=True,
            prioritize_current_epoch=True,
            resolve_cached_ticker_fanout=True,
            max_cache_fanout_decisions=10,
            resolution_status_path=str(status_path),
        )
    )
    shadow_outcomes = [json.loads(line) for line in shadow_outcomes_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert calls == ["/markets/KXLOWTDEN-26MAY18-T37"]
    assert result["base_max_decisions"] == 1
    assert result["selected_candidate_count"] == 4
    assert result["cache_fanout_candidate_count"] == 3
    assert result["unique_market_fetch_count"] == 1
    assert result["market_fetch_cache_hits"] == 3
    assert result["shadow_resolved_count"] == 4
    assert len(shadow_outcomes) == 4
    status = json.loads(status_path.read_text(encoding="utf-8"))
    assert status["cache_fanout_candidate_count"] == 3
    assert status["live_order_allowed"] is False


def test_fast_resolution_summarizes_current_epoch_counts(monkeypatch, tmp_path):
    fast = load_module("kalshi_fast_resolution", ROOT / "kalshi_fast_resolution.py")
    runs_path = tmp_path / "fast_runs.jsonl"
    lock_path = tmp_path / "fast.lock"
    monkeypatch.setattr(fast, "RUNS_LOG", runs_path)
    monkeypatch.setattr(fast, "LOCK_PATH", lock_path)

    def fake_run_script(script, args=None, timeout_seconds=120):
        if script == "kalshi_outcome_resolver.py":
            assert args == ["--max-decisions", "300"]
            return {
                "script": script,
                "returncode": 0,
                "ok": True,
                "json_summary": {
                    "resolved_count": 2,
                    "checked_count": 3,
                    "selected_candidate_count": 5,
                    "base_max_decisions": 300,
                    "resolve_cached_ticker_fanout": True,
                    "cache_fanout_candidate_count": 2,
                    "max_cache_fanout_decisions": 5000,
                    "unique_market_fetch_count": 2,
                    "market_fetch_cache_hits": 1,
                    "market_fetch_failed_count": 0,
                    "candidate_count": 4,
                    "accepted_candidate_count": 3,
                    "accepted_checked_count": 2,
                    "shadow_candidate_count": 1,
                    "shadow_checked_count": 1,
                    "shadow_resolved_count": 1,
                    "shadow_unresolved_count": 0,
                    "current_epoch_candidate_count": 2,
                    "current_epoch_checked_count": 2,
                    "current_epoch_resolved_count": 1,
                    "current_epoch_unresolved_count": 1,
                    "fast_crypto_candidate_count": 1,
                    "fast_crypto_checked_count": 1,
                    "fast_crypto_resolved_count": 1,
                    "fast_crypto_unresolved_count": 0,
                    "resolved_by_category": {"crypto": 1},
                    "unresolved_by_category": {"sports": 1},
                    "unresolved_reason_counts": {"market_not_found": 1},
                    "unresolved_count": 1,
                    "source_backed_unresolved_classified_count": 1,
                    "retryable_unresolved_count": 0,
                    "human_review_unresolved_count": 0,
                    "accepted_unresolved_count": 1,
                    "accepted_unresolved_classified_count": 1,
                    "accepted_unresolved_retryable_count": 0,
                    "accepted_unresolved_unclassified_count": 0,
                    "official_result_unavailable_count": 0,
                    "skipped_not_due_count": 5,
                    "skipped_not_due_by_category": {"crypto": 5},
                    "next_due_candidate_time_utc": "2026-05-30T18:05:00Z",
                    "next_due_weather_crypto_candidate_time_utc": "2026-05-30T18:05:00Z",
                    "next_due_crypto_candidate_time_utc": "2026-05-30T18:05:00Z",
                    "next_due_accepted_candidate_time_utc": None,
                    "seconds_until_next_due_crypto_candidate": 300,
                    "skipped_retry_backoff_count": 1,
                },
                "stdout_tail": "",
                "stderr_tail": "",
            }
        return {"script": script, "returncode": 0, "ok": True, "json_summary": {}, "stdout_tail": "", "stderr_tail": ""}

    monkeypatch.setattr(fast, "_run_script", fake_run_script)
    result = fast.run(Namespace(max_decisions=300, skip_dashboard=False, skip_self_improvement=False))
    assert result["ok"] is True
    assert result["resolved_count"] == 2
    assert result["selected_candidate_count"] == 5
    assert result["base_max_decisions"] == 300
    assert result["resolve_cached_ticker_fanout"] is True
    assert result["cache_fanout_candidate_count"] == 2
    assert result["max_cache_fanout_decisions"] == 5000
    assert result["unique_market_fetch_count"] == 2
    assert result["market_fetch_cache_hits"] == 1
    assert result["market_fetch_failed_count"] == 0
    assert result["current_epoch_resolved_count"] == 1
    assert result["current_epoch_unresolved_count"] == 1
    assert result["fast_crypto_resolved_count"] == 1
    assert result["shadow_resolved_count"] == 1
    assert result["shadow_checked_count"] == 1
    assert result["resolved_by_category"]["crypto"] == 1
    assert result["unresolved_reason_counts"]["market_not_found"] == 1
    assert result["accepted_unresolved_count"] == 1
    assert result["accepted_unresolved_classified_count"] == 1
    assert result["accepted_unresolved_unclassified_count"] == 0
    assert result["accepted_unresolved_retryable_count"] == 0
    assert result["skipped_retry_backoff_count"] == 1
    assert result["skipped_not_due_by_category"] == {"crypto": 5}
    assert result["next_due_crypto_candidate_time_utc"] == "2026-05-30T18:05:00Z"
    assert result["seconds_until_next_due_crypto_candidate"] == 300
    assert result["live_order_allowed"] is False
    assert json.loads(runs_path.read_text(encoding="utf-8").splitlines()[0])["auto_apply_allowed"] is False


def test_profit_firewall_keeps_weather_focus_learning_open_for_losing_category(tmp_path):
    firewall = load_module("kalshi_profit_firewall", ROOT / "kalshi_profit_firewall.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    dashboard_path.write_text(
        json.dumps(
            {
                "performance_summary": {
                    "category_accuracy": {
                        "weather": {
                            "scored": 100,
                            "wins": 10,
                            "losses": 90,
                            "accuracy": 0.1,
                            "pnl": -500.0,
                        }
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps({"by_category": []}), encoding="utf-8")
    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            minimum_scored=30,
            accuracy_floor=0.45,
            shadow_only=False,
        )
    )
    assert result["blocked_accepted_paper_categories"] == []
    assert result["rapid_learning_focus_categories"] == ["crypto", "weather"]
    assert result["weather_accepted_paper_repair_required"] is False
    assert result["lanes"][0]["paper_action"] == "block_proof_notional_allow_shadow_and_tiny_exploration"
    assert result["lanes"][0]["accepted_proof_allowed"] is False
    assert result["lanes"][0]["bounded_exploration_allowed"] is True
    assert result["lanes"][0]["shadow_learning_allowed"] is True
    assert result["lanes"][0]["live_order_allowed"] is False
    assert json.loads(state_path.read_text(encoding="utf-8"))["live_order_allowed"] is False


def test_profit_firewall_marks_weather_repair_required_from_audit(tmp_path):
    firewall = load_module("kalshi_profit_firewall_weather_repair", ROOT / "kalshi_profit_firewall.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    baseline_path = tmp_path / "baseline.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "performance_summary": {
                    "category_accuracy": {
                        "weather": {
                            "scored": 51,
                            "wins": 22,
                            "losses": 29,
                            "accuracy": 0.43,
                            "pnl": -26.07,
                        }
                    }
                },
                "weather_model_audit": {
                    "ok": True,
                    "top_failure_mode": {"mode": "settlement_parse_gap"},
                    "primary_action": {"type": "repair_weather_evidence_before_expansion"},
                    "live_order_allowed": False,
                },
            }
        ),
        encoding="utf-8",
    )
    baseline_path.write_text(json.dumps({"by_category": []}), encoding="utf-8")
    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            minimum_scored=30,
            accuracy_floor=0.45,
            shadow_only=False,
        )
    )
    assert result["weather_accepted_paper_repair_required"] is True
    assert result["weather_accepted_paper_blockers"] == ["settlement_parse_gap"]
    assert "settlement parsing" in result["weather_accepted_paper_repair_reason"]
    assert result["live_order_allowed"] is False
    written = json.loads(state_path.read_text(encoding="utf-8"))
    assert written["weather_accepted_paper_repair_required"] is True


def test_profit_firewall_allows_tiny_inverse_forward_test(tmp_path):
    firewall = load_module("kalshi_profit_firewall", ROOT / "kalshi_profit_firewall.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    baseline_path = tmp_path / "baseline.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "performance_summary": {
                    "category_accuracy": {
                        "weather": {
                            "scored": 100,
                            "wins": 10,
                            "losses": 90,
                            "accuracy": 0.1,
                            "pnl": -500.0,
                        }
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    baseline_path.write_text(
        json.dumps({"by_category": [{"category": "weather", "recommendation": "test_inverse_forward_paper"}]}),
        encoding="utf-8",
    )
    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            minimum_scored=30,
            accuracy_floor=0.45,
            shadow_only=False,
        )
    )
    assert result["blocked_accepted_paper_categories"] == []
    assert result["blocked_current_side_categories"] == ["weather"]
    assert result["inverse_forward_test_categories"] == ["weather"]
    assert result["lanes"][0]["paper_action"] == "block_current_side_and_allow_tiny_inverse_forward_paper"


def test_profit_firewall_freezes_inverse_first_when_fresh_inverse_is_losing(tmp_path):
    firewall = load_module("kalshi_profit_firewall_inverse_freeze", ROOT / "kalshi_profit_firewall.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    baseline_path = tmp_path / "baseline.json"
    proof_path = tmp_path / "proof.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "epoch": {
                    "ok": True,
                    "primary_paper_strategy": "inverse_first",
                    "allowed_inverse_categories": ["weather", "sports"],
                },
                "performance_summary": {
                    "category_accuracy": {
                        "weather": {
                            "scored": 100,
                            "wins": 10,
                            "losses": 90,
                            "accuracy": 0.1,
                            "pnl": -500.0,
                        }
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    baseline_path.write_text(
        json.dumps({"by_category": [{"category": "weather", "recommendation": "test_inverse_forward_paper"}]}),
        encoding="utf-8",
    )
    proof_path.write_text(
        json.dumps(
            {
                "diagnosis": "historical_inverse_conflicts_with_actual_applied_inverse",
                "recommended_route": "FREEZE_BROAD_INVERSE_FIRST_AND_RUN_BUG_VS_EDGE_REVIEW",
                "paper_budget_action": "freeze_new_broad_inverse_first_notional",
                "fresh_inverse_failing": True,
                "inverse_expansion_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            strategy_proof_diagnosis=str(proof_path),
            minimum_scored=30,
            accuracy_floor=0.45,
            shadow_only=False,
        )
    )
    assert result["inverse_expansion_allowed"] is False
    assert result["inverse_side_role"] == "frozen_shadow_hypothesis"
    assert result["frozen_inverse_categories"] == ["weather", "sports"]
    assert result["inverse_forward_test_categories"] == []
    assert result["blocked_accepted_paper_categories"] == ["sports"]
    assert result["rapid_learning_focus_categories"] == ["crypto", "weather"]
    assert "Weather and crypto are the fastest learning lanes" in result["rapid_learning_focus_policy"]["plain_english"]
    assert result["recovery_probe_enabled"] is True
    assert result["recovery_probe_requires_baseline_beating"] is True
    assert result["recovery_probe_max_size_usd"] == 1.0
    assert "baseline-beating proof" in result["recovery_probe_policy"]["plain_english"]
    assert result["paper_trading_paused"] is False
    assert result["shadow_learning_enabled"] is True
    assert "accepted inverse exposure is frozen" in result["plain_english_summary"]
    assert result["live_order_allowed"] is False
    written = json.loads(state_path.read_text(encoding="utf-8"))
    assert written["strategy_proof_diagnosis"]["fresh_inverse_failing"] is True
    assert written["blocked_accepted_paper_categories"] == ["sports"]


def test_profit_firewall_halts_losing_sports_accepted_paper(tmp_path):
    firewall = load_module("kalshi_profit_firewall_sports_halt", ROOT / "kalshi_profit_firewall.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    baseline_path = tmp_path / "baseline.json"
    proof_path = tmp_path / "proof.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "performance_summary": {
                    "category_accuracy": {
                        "sports": {
                            "scored": 100,
                            "wins": 20,
                            "losses": 80,
                            "accuracy": 0.2,
                            "pnl": -150.0,
                        },
                        "weather": {
                            "scored": 100,
                            "wins": 60,
                            "losses": 40,
                            "accuracy": 0.6,
                            "pnl": 25.0,
                        },
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    baseline_path.write_text(json.dumps({"by_category": []}), encoding="utf-8")
    proof_path.write_text(json.dumps({}), encoding="utf-8")
    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            strategy_proof_diagnosis=str(proof_path),
            minimum_scored=30,
            accuracy_floor=0.45,
            shadow_only=False,
        )
    )
    assert result["halted_accepted_paper_categories"] == ["sports"]
    assert result["halted_accepted_paper_policy"]["live_order_allowed"] is False
    assert result["blocked_accepted_paper_categories"] == ["sports"]
    assert result["forward_paper_candidate_categories"] == ["weather"]
    assert result["live_order_allowed"] is False
    written = json.loads(state_path.read_text(encoding="utf-8"))
    assert written["halted_accepted_paper_categories"] == ["sports"]


def test_build_gap_audit_refuses_false_10_when_strategy_loses(tmp_path):
    auditor = load_module("kalshi_build_gap_audit", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-10T00:00:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 10},
                "performance_summary": {
                    "accuracy": 0.1,
                    "paper_pnl_usd": -100.0,
                    "scored_accepted_trades": 10,
                    "latest_scored_age_minutes": 200,
                },
                "clean_evidence": {"clean_accepted_to_resolved_rate": 0.5},
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"blocked_accepted_paper_categories": ["weather"]}), encoding="utf-8")
    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    assert result["completion_grade"] < 10
    assert result["can_truthfully_claim_10"] is False
    assert result["top_next_gap"]["gap_id"] == "GAP-01"
    assert len(result["gaps"]) >= 20
    assert all(gap.get("status") for gap in result["gaps"])
    assert all(gap.get("criticality_label") for gap in result["gaps"])
    assert all(gap.get("acceptance_criteria") for gap in result["gaps"])
    assert all(gap.get("test_plan") for gap in result["gaps"])
    assert all(gap.get("verification_method") for gap in result["gaps"])
    assert result["completion_grade_inputs"]["weighted_lost"] > 0
    assert result["completion_grade_inputs"]["top_grade_draggers"][0]["gap_id"] == "GAP-01"
    assert result["completion_grade_inputs"]["top_grade_draggers"][0]["live_order_allowed"] is False


def test_build_gap_audit_persists_json_artifact(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_artifact", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    output_path = tmp_path / "build_gap_audit.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-10T00:00:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 1},
                "performance_summary": {"accuracy": 0.0, "paper_pnl_usd": -1.0, "scored_accepted_trades": 1},
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({}), encoding="utf-8")

    result = auditor.run(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path), output=str(output_path)))
    written = json.loads(output_path.read_text(encoding="utf-8"))

    assert written["completion_grade"] == result["completion_grade"]
    assert written["live_order_allowed"] is False
    assert written["auto_live_promotion_allowed"] is False
    assert len(written["gaps"]) >= 20
    assert written["completion_grade_inputs"]["weighted_possible"] > 0
    assert written["completion_grade_movement"]["status"] == "no_previous_audit"
    assert written["completion_grade_movement"]["live_order_allowed"] is False


def test_build_gap_audit_reports_completion_grade_regressions(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_regression", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    output_path = tmp_path / "build_gap_audit.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-10T00:00:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 1},
                "performance_summary": {"accuracy": 0.0, "paper_pnl_usd": -1.0, "scored_accepted_trades": 1},
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({}), encoding="utf-8")
    output_path.write_text(
        json.dumps(
            {
                "completion_grade": 9.9,
                "gaps": [
                    {
                        "gap_id": "GAP-01",
                        "title": "Strategy is not profitable or accurate yet",
                        "completion_grade": 9.9,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = auditor.run(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path), output=str(output_path)))

    assert result["completion_grade_movement"]["status"] == "regressed"
    assert result["completion_grade_movement"]["delta"] < 0
    assert result["completion_grade_movement"]["regressions"][0]["gap_id"] == "GAP-01"
    assert result["completion_grade_movement"]["regressions"][0]["live_order_allowed"] is False


def test_build_gap_audit_uses_learning_velocity_for_shadow_learning(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_shadow_velocity", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-10T00:00:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 1},
                "performance_summary": {"accuracy": 0.0, "paper_pnl_usd": -1.0, "scored_accepted_trades": 1},
                "outcome_resolution": {
                    "shadow_candidate_count": 0,
                    "shadow_checked_count": 0,
                    "shadow_resolved_count": 0,
                },
                "learning_velocity": {
                    "shadow_resolved_last_1h": 15,
                    "latest_shadow_learning_age_minutes": 3.0,
                    "proof_metrics_exclude_shadow": True,
                },
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({}), encoding="utf-8")

    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    by_id = {gap["gap_id"]: gap for gap in result["gaps"]}

    assert by_id["GAP-15"]["completion_grade"] == 9.5
    assert "shadow_resolved_last_1h=15" in by_id["GAP-15"]["why_it_matters"]


def test_build_gap_audit_recognizes_checked_official_active_outcomes(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_checked_status", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-10T00:00:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 100},
                "performance_summary": {
                    "accuracy": 0.55,
                    "paper_pnl_usd": 10.0,
                    "scored_accepted_trades": 96,
                    "latest_scored_age_minutes": 200,
                },
                "clean_evidence": {"clean_accepted_to_resolved_rate": 0.96},
                "pending_paper_trades": {"count": 4, "overdue_count": 4},
                "outcome_resolution": {
                    "ok": True,
                    "checked_count": 4,
                    "official_result_unavailable_count": 4,
                    "unresolved_reason_counts": {"official_result_unavailable_status_active": 4},
                },
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"blocked_current_side_categories": ["weather"], "inverse_forward_test_categories": ["weather"]}), encoding="utf-8")
    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    by_id = {gap["gap_id"]: gap for gap in result["gaps"]}
    assert by_id["GAP-02"]["completion_grade"] == 9.4
    assert by_id["GAP-03"]["completion_grade"] == 9.4


def test_build_gap_audit_recognizes_fast_resolution_no_due_outcomes(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_fast_resolution", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-11T00:00:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 100},
                "performance_summary": {
                    "accuracy": None,
                    "paper_pnl_usd": 0.0,
                    "scored_accepted_trades": 0,
                    "latest_scored_age_minutes": None,
                },
                "pending_paper_trades": {"count": 100, "overdue_count": 0},
                "clean_evidence": {"clean_accepted_to_resolved_rate": 0.0},
                "outcome_resolution": {"ok": True, "checked_count": 1, "official_result_unavailable_count": 0},
                "accelerator": {
                    "scheduler": {
                        "latest_scheduled_ok": True,
                        "latest_scheduled_status": "COMPLETED",
                        "latest_fast_resolution_ok": True,
                        "latest_fast_resolution_status": "COMPLETED",
                        "latest_fast_resolution_timestamp_utc": "2026-05-11T00:01:00Z",
                    }
                },
                "weather_source_freshness": {"ok": True, "fresh_city_count": 32, "checked_city_count": 32},
                "baseline_scorecard": {"ok": True, "inverse_beats_current": True},
                "forward_paper_proof": {"ok": True, "proof_gate": {"live_review_ready": False}},
                "strategy_proof_diagnosis": {"ok": True, "inverse_expansion_allowed": False, "diagnosis": "collecting"},
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"blocked_current_side_categories": ["sports"], "inverse_forward_test_categories": ["sports"]}), encoding="utf-8")
    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    by_id = {gap["gap_id"]: gap for gap in result["gaps"]}
    assert by_id["GAP-02"]["completion_grade"] == 9.9
    assert by_id["GAP-03"]["completion_grade"] == 9.9
    assert by_id["GAP-06"]["completion_grade"] == 9.9
    assert by_id["GAP-08"]["completion_grade"] == 9.9


def test_build_gap_audit_surfaces_crypto_fetch_failures(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_crypto_fetch", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-18T17:50:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 100},
                "performance_summary": {
                    "accuracy": 0.55,
                    "paper_pnl_usd": 10.0,
                    "scored_accepted_trades": 100,
                    "latest_scored_age_minutes": 5,
                },
                "clean_evidence": {"clean_accepted_to_resolved_rate": 1.0},
                "crypto_evidence": {
                    "timestamp_utc": "2026-05-18T17:49:00Z",
                    "active_crypto_markets_seen": 0,
                    "parseable_crypto_markets": 0,
                    "created_count": 0,
                    "created_by_governor_action": {},
                    "warnings": ["crypto_spot_fetch_failed:BTC:URLError"],
                },
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"blocked_current_side_categories": ["sports"]}), encoding="utf-8")
    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    by_id = {gap["gap_id"]: gap for gap in result["gaps"]}
    assert by_id["GAP-11"]["completion_grade"] == 6.0
    assert by_id["GAP-11"]["criticality"] == 8.5
    assert "crypto_spot_fetch_failed:BTC:URLError" in by_id["GAP-11"]["why_it_matters"]


def test_build_gap_audit_accepts_explicit_crypto_readiness_reason(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_crypto_readiness", ROOT / "kalshi_build_gap_audit.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-18T17:50:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 100},
                "performance_summary": {
                    "accuracy": 0.55,
                    "paper_pnl_usd": 10.0,
                    "scored_accepted_trades": 100,
                    "latest_scored_age_minutes": 5,
                },
                "clean_evidence": {"clean_accepted_to_resolved_rate": 1.0},
                "crypto_evidence": {
                    "timestamp_utc": "2026-05-18T17:49:00Z",
                    "active_crypto_markets_seen": 5,
                    "parseable_crypto_markets": 0,
                    "created_count": 0,
                    "created_by_governor_action": {"SHADOW_ONLY": 3},
                    "crypto_readiness_status": "unavailable",
                    "next_crypto_trade_ready_check_time_utc": None,
                    "next_crypto_trade_ready_unavailable_reason": "no_future_trade_ready_time_in_market_metadata",
                    "last_crypto_trade_ready_check_time_utc": None,
                    "crypto_readiness_summary": "No future crypto trade-ready check time is available from current Kalshi market metadata.",
                    "warnings": [],
                },
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"blocked_current_side_categories": ["sports"]}), encoding="utf-8")
    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    by_id = {gap["gap_id"]: gap for gap in result["gaps"]}
    assert by_id["GAP-17"]["completion_grade"] == 10.0
    assert by_id["GAP-17"]["status"] == "Verified"
    assert "no_future_trade_ready_time_in_market_metadata" in by_id["GAP-17"]["why_it_matters"]


def test_build_gap_audit_recognizes_weather_recalibration_policy(tmp_path):
    auditor = load_module("kalshi_build_gap_audit_weather_recalibration", ROOT / "kalshi_build_gap_audit.py")
    auditor.LOGS_DIR = tmp_path
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    (tmp_path / "weather_probability_calibration.json").write_text(
        json.dumps(
            {
                "ok": True,
                "scored_weather_decisions": 4804,
                "bucket_count": 2,
                "buckets": {
                    "AUSTIN|high_temperature|below": {
                        "status": "model_underperforms_market_baseline",
                        "accepted_paper_abstention_required": True,
                    },
                    "ALL|ALL|ALL": {
                        "status": "model_underperforms_market_baseline",
                        "accepted_paper_abstention_required": True,
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    dashboard_path.write_text(
        json.dumps(
            {
                "generated_at_utc": "2026-05-18T17:50:00Z",
                "live_order_allowed": False,
                "paper": {"accepted": 100},
                "performance_summary": {
                    "accuracy": 0.55,
                    "paper_pnl_usd": 10.0,
                    "scored_accepted_trades": 100,
                    "latest_scored_age_minutes": 5,
                },
                "clean_evidence": {"clean_accepted_to_resolved_rate": 1.0},
                "weather_model_audit": {
                    "scored_weather_decisions": 53,
                    "plain_english": "53 current-epoch weather trades are scored, but paper P&L is negative.",
                    "top_failure_mode": {"mode": "weather_probability_miscalibration"},
                },
            }
        ),
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"blocked_current_side_categories": ["sports"]}), encoding="utf-8")
    result = auditor.audit(Namespace(dashboard_data=str(dashboard_path), state_path=str(state_path)))
    by_id = {gap["gap_id"]: gap for gap in result["gaps"]}

    assert by_id["GAP-14"]["completion_grade"] == 9.0
    assert by_id["GAP-14"]["status"] == "In Progress"
    assert "abstention_buckets=2" in by_id["GAP-14"]["why_it_matters"]
    assert "unknown_bucket_present=False" in by_id["GAP-14"]["why_it_matters"]


def test_baseline_scorecard_detects_inverse_better_than_current(tmp_path):
    baseline = load_module("kalshi_baseline_scorecard", ROOT / "kalshi_baseline_scorecard.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    output_path = tmp_path / "baseline.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "d1",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_price_cents": 50,
                        "simulated_size_usd": 2.0,
                        "market_category": "weather",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "d2",
                        "decision": "PAPER_EXPLORE_BUY_YES",
                        "market_price_cents": 50,
                        "simulated_size_usd": 2.0,
                        "market_category": "weather",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text(
        "\n".join(
            [
                json.dumps({"decision_id": "d1", "resolved": True, "outcome_yes": 0}),
                json.dumps({"decision_id": "d2", "resolved": True, "outcome_yes": 0}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    result = baseline.compute(Namespace(decisions_log=str(decisions_path), outcomes_log=str(outcomes_path), output=str(output_path)))
    assert result["current_strategy"]["accuracy"] == 0
    assert result["inverse_side"]["accuracy"] == 1
    assert result["inverse_beats_current"] is True
    assert result["inverse_side"]["price_model"] == "synthetic_opposite_side_binary_payoff"
    assert json.loads(output_path.read_text(encoding="utf-8"))["live_order_allowed"] is False


def test_baseline_scorecard_inverse_uses_binary_payoff_not_negative_current_pnl(tmp_path):
    baseline = load_module("kalshi_baseline_scorecard_binary_inverse", ROOT / "kalshi_baseline_scorecard.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    output_path = tmp_path / "baseline.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "cheap-yes-loss",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_price_cents": 10,
                "paper_fill_price_cents": 10,
                "simulated_size_usd": 2.0,
                "market_category": "weather",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text(json.dumps({"decision_id": "cheap-yes-loss", "resolved": True, "outcome_yes": 0}) + "\n", encoding="utf-8")
    result = baseline.compute(Namespace(decisions_log=str(decisions_path), outcomes_log=str(outcomes_path), output=str(output_path)))
    assert result["current_strategy"]["paper_pnl_usd"] == -2.0
    assert result["inverse_side"]["paper_pnl_usd"] == 0.22
    assert result["inverse_side"]["average_synthetic_inverse_entry_cents"] == 90.0
    assert result["inverse_side"]["diagnostic_note"]
    assert result["live_order_allowed"] is False


def test_inverse_audit_does_not_promote_synthetic_inverse_as_likely_edge(tmp_path):
    audit = load_module("kalshi_inverse_strategy_audit_synthetic_guard", ROOT / "kalshi_inverse_strategy_audit.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    output_path = tmp_path / "baseline.json"
    audit_log = tmp_path / "audit.jsonl"
    records = []
    outcomes = []
    for index in range(30):
        decision_id = f"synthetic-inverse-{index}"
        records.append(
            {
                "decision_id": decision_id,
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_price_cents": 10,
                "paper_fill_price_cents": 10,
                "simulated_size_usd": 1.0,
                "market_category": "weather",
                "live_order_allowed": False,
            }
        )
        outcomes.append({"decision_id": decision_id, "resolved": True, "outcome_yes": 0})
    decisions_path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")
    outcomes_path.write_text("\n".join(json.dumps(outcome) for outcome in outcomes) + "\n", encoding="utf-8")
    result = audit.audit(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            output=str(output_path),
            audit_log=str(audit_log),
            minimum_scored=30,
        )
    )
    assert result["synthetic_inverse_only"] is True
    assert result["opportunities"][0]["diagnosis"] == "needs_executable_forward_proof"
    assert result["opportunities"][0]["recommended_action"] == "shadow_until_current_executable_inverse_candidates_exist"
    assert result["opportunities"][0]["live_order_allowed"] is False


def test_forward_paper_proof_scores_inverse_gate(tmp_path):
    proof = load_module("kalshi_forward_paper_proof", ROOT / "kalshi_forward_paper_proof.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    output_path = tmp_path / "proof.json"
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "inv-1",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_NO",
                        "paper_experiment_type": "inverse_forward_test",
                        "market_price_probability": 0.6,
                        "market_price_cents": 60,
                        "paper_fill_price_cents": 60,
                        "fair_probability": 0.7,
                        "simulated_size_usd": 1.0,
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "inv-2",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_NO",
                        "paper_experiment_type": "inverse_forward_test",
                        "market_price_probability": 0.6,
                        "market_price_cents": 60,
                        "paper_fill_price_cents": 60,
                        "fair_probability": 0.7,
                        "simulated_size_usd": 1.0,
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text(
        "\n".join(
            [
                json.dumps({"decision_id": "inv-1", "resolved": True, "outcome_yes": 0, "settlement_checked_at_utc": "2026-05-10T00:00:00Z"}),
                json.dumps({"decision_id": "inv-2", "resolved": True, "outcome_yes": 0, "settlement_checked_at_utc": "2026-05-10T01:00:00Z"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    result = proof.compute(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            output=str(output_path),
            minimum_scored=2,
            accuracy_floor=0.55,
            minimum_pnl_usd=0.0,
        )
    )
    inverse = result["inverse_forward_test"]
    assert inverse["scored"] == 2
    assert inverse["accuracy"] == 1.0
    assert inverse["paper_pnl_usd"] > 0
    assert inverse["gate_status"] == "live_review_candidate_paper_only"
    assert result["proof_gate"]["live_review_ready"] is True
    assert json.loads(output_path.read_text(encoding="utf-8"))["live_order_allowed"] is False


def test_forward_paper_proof_separates_current_epoch_by_side(tmp_path, monkeypatch):
    proof = load_module("kalshi_forward_paper_proof_epoch", ROOT / "kalshi_forward_paper_proof.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    output_path = tmp_path / "proof.json"
    epoch_path = tmp_path / "epoch.json"
    epoch_path.write_text(json.dumps({"ok": True, "epoch_id": "epoch-test"}), encoding="utf-8")
    monkeypatch.setattr(proof, "PAPER_EPOCH_STATE_PATH", epoch_path)
    decisions_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "decision_id": "yes-win",
                        "current_epoch_id": "epoch-test",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_YES",
                        "paper_experiment_type": "inverse_forward_test",
                        "market_ticker": "KXTESTYES",
                        "market_category": "sports",
                        "market_price_probability": 0.4,
                        "market_price_cents": 40,
                        "paper_fill_price_cents": 40,
                        "fair_probability": 0.4,
                        "simulated_size_usd": 1.0,
                        "expected_result_known_time_utc": "2026-05-12T00:00:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "no-pending",
                        "current_epoch_id": "epoch-test",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_NO",
                        "paper_experiment_type": "inverse_forward_test",
                        "market_ticker": "KXTESTNO",
                        "market_category": "sports",
                        "market_price_probability": 0.6,
                        "market_price_cents": 60,
                        "paper_fill_price_cents": 60,
                        "fair_probability": 0.6,
                        "simulated_size_usd": 1.0,
                        "expected_result_known_time_utc": "2099-01-01T00:00:00Z",
                    }
                ),
                json.dumps(
                    {
                        "decision_id": "old-epoch",
                        "current_epoch_id": "older",
                        "decision": "PAPER_INVERSE_FORWARD_BUY_YES",
                        "paper_experiment_type": "inverse_forward_test",
                        "market_price_probability": 0.4,
                        "market_price_cents": 40,
                        "paper_fill_price_cents": 40,
                        "fair_probability": 0.4,
                        "simulated_size_usd": 1.0,
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    outcomes_path.write_text(
        "\n".join(
            [
                json.dumps({"decision_id": "yes-win", "resolved": True, "outcome_yes": 1, "settlement_checked_at_utc": "2026-05-12T01:00:00Z"}),
                json.dumps({"decision_id": "old-epoch", "resolved": True, "outcome_yes": 1, "settlement_checked_at_utc": "2026-05-12T01:00:00Z"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    result = proof.compute(
        Namespace(
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            output=str(output_path),
            minimum_scored=1,
            accuracy_floor=0.55,
            minimum_pnl_usd=0.0,
        )
    )
    current = result["current_epoch"]
    assert current["epoch_id"] == "epoch-test"
    assert current["accepted"] == 2
    assert current["pending"] == 1
    assert current["scored"] == 1
    assert current["next_expected_result_known_time_utc"] == "2099-01-01T00:00:00Z"
    by_side = {item["lane"]: item for item in current["by_side"]}
    assert by_side["YES"]["scored"] == 1
    assert by_side["YES"]["accuracy"] == 1.0
    pending_by_side = {item["name"]: item for item in current["pending_by_side"]}
    assert pending_by_side["NO"]["pending"] == 1
    assert result["live_order_allowed"] is False


def test_strategy_proof_diagnosis_freezes_failing_inverse(tmp_path):
    diagnosis = load_module("kalshi_strategy_proof_diagnosis", ROOT / "kalshi_strategy_proof_diagnosis.py")
    dashboard_path = tmp_path / "dashboard.json"
    output_path = tmp_path / "diagnosis.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "baseline_scorecard": {"inverse_beats_current": True},
                "forward_paper_proof": {
                    "proof_gate": {"live_review_ready": False},
                    "inverse_forward_test": {
                        "scored": 80,
                        "accuracy": 0.125,
                        "paper_pnl_usd": -25.7,
                        "brier_score": 0.29,
                        "market_brier_score": 0.08,
                        "gate_status": "needs_more_forward_paper_outcomes",
                    },
                    "governed_forward_paper": {
                        "scored": 200,
                        "accuracy": 0.1,
                        "paper_pnl_usd": -100.0,
                        "gate_status": "failed_forward_paper_gate",
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    result = diagnosis.diagnose(Namespace(dashboard_data=str(dashboard_path), output=str(output_path), minimum_forward_scored=100))
    assert result["diagnosis"] == "historical_inverse_conflicts_with_fresh_forward_proof"
    assert result["inverse_expansion_allowed"] is False
    assert result["live_order_allowed"] is False
    assert json.loads(output_path.read_text(encoding="utf-8"))["auto_live_promotion_allowed"] is False


def test_strategy_proof_diagnosis_freezes_applied_inverse_when_audit_conflicts(tmp_path):
    diagnosis = load_module("kalshi_strategy_proof_diagnosis_applied_inverse", ROOT / "kalshi_strategy_proof_diagnosis.py")
    dashboard_path = tmp_path / "dashboard.json"
    output_path = tmp_path / "diagnosis.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "epoch": {
                    "ok": True,
                    "primary_paper_strategy": "inverse_first",
                    "epoch_id": "epoch-2",
                    "started_at_utc": "2026-05-11T00:00:00Z",
                },
                "strategy_comparison": {
                    "actual_summary": {
                        "standard_accuracy": 0.4,
                        "inverse_standard_accuracy": 0.27,
                        "standard_pnl_usd": -21.86,
                        "inverse_standard_pnl_usd": -3885.88,
                        "inverse_standard_scored": 13545,
                    },
                    "audit_summary": {
                        "standard_accuracy": 0.2366,
                        "inverse_standard_accuracy": 0.7634,
                        "standard_pnl_usd": -22071.31,
                        "inverse_standard_pnl_usd": 22071.31,
                        "scored": 21616,
                    },
                },
                "performance_summary": {
                    "scored_accepted_trades": 13545,
                    "accuracy": 0.27,
                    "paper_pnl_usd": -3885.88,
                },
            }
        ),
        encoding="utf-8",
    )
    result = diagnosis.diagnose(Namespace(dashboard_data=str(dashboard_path), output=str(output_path), minimum_forward_scored=100))
    assert result["diagnosis"] == "historical_inverse_conflicts_with_actual_applied_inverse"
    assert result["audit_applied_conflict"] is True
    assert result["fresh_inverse_failing"] is True
    assert result["inverse_expansion_allowed"] is False
    assert result["paper_budget_action"] == "freeze_new_broad_inverse_first_notional"
    assert "same candidate population" in result["bug_vs_edge_checks_required"][0]
    assert json.loads(output_path.read_text(encoding="utf-8"))["live_order_allowed"] is False


def test_inverse_failure_diagnosis_explains_actual_inverse_losses():
    failure = load_module("kalshi_inverse_failure_diagnosis", ROOT / "kalshi_inverse_failure_diagnosis.py")
    decisions = [
        {
            "decision_id": "loss-yes-1",
            "decision": "PAPER_EXPLORE_BUY_YES",
            "inverse_strategy_applied": True,
            "market_ticker": "KXMVESPORTSMULTIGAMEEXTENDED-TEST",
            "market_title": "yes Team A,yes Team B,yes Over 2.5 goals scored",
            "market_category": "sports",
            "fair_value_source_type": "market_implied_baseline",
            "fair_value_method": "inverse_standard_strategy",
            "paper_fill_price_cents": 70,
            "market_price_probability": 0.7,
            "fair_probability": 0.7,
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
        },
        {
            "decision_id": "loss-yes-2",
            "decision": "PAPER_EXPLORE_BUY_YES",
            "inverse_strategy_applied": True,
            "market_ticker": "KXMVECROSSCATEGORY-TEST",
            "market_title": "yes Player prop,yes Game prop",
            "market_category": "sports",
            "fair_value_source_type": "market_implied_baseline",
            "fair_value_method": "inverse_standard_strategy",
            "paper_fill_price_cents": 80,
            "market_price_probability": 0.8,
            "fair_probability": 0.8,
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
        },
    ]
    outcomes = [
        {"decision_id": "loss-yes-1", "resolved": True, "outcome_yes": 0},
        {"decision_id": "loss-yes-2", "resolved": True, "outcome_yes": 0},
    ]

    result = failure.diagnose_records(decisions, outcomes, minimum_scored=2, max_segments=5)
    summary = result["summary"]
    worst = result["worst_segments"][0]

    assert summary["inverse_scored"] == 2
    assert summary["inverse_accuracy"] == 0.0
    assert summary["inverse_paper_pnl_usd"] == -2.0
    assert summary["broad_inverse_budget_status"] == "freeze_broad_inverse_and_shadow_only"
    assert worst["recommended_paper_action"] == "SHADOW_ONLY"
    assert "sports_parlay_population_mismatch" in worst["diagnosis_reasons"]
    assert "market_implied_baseline_is_not_edge" in worst["diagnosis_reasons"]
    assert "inverse_buy_yes_lane_failing" in worst["diagnosis_reasons"]
    assert result["live_order_allowed"] is False
    assert result["auto_live_promotion_allowed"] is False


def test_inverse_failure_diagnosis_allows_only_tiny_profitable_segment_probe():
    failure = load_module("kalshi_inverse_failure_diagnosis_profitable", ROOT / "kalshi_inverse_failure_diagnosis.py")
    decisions = [
        {
            "decision_id": "win-no-1",
            "decision": "PAPER_EXPLORE_BUY_NO",
            "inverse_strategy_applied": True,
            "market_ticker": "KXWEATHER-1",
            "market_title": "Will the temp be above 80?",
            "market_category": "weather:CHICAGO:temperature",
            "strategy_taxonomy": {"domain": "weather", "market_type": "temperature"},
            "fair_value_source_type": "weather_model",
            "fair_value_method": "empirical_inverse_audit_flipped_weather_model",
            "paper_fill_price_cents": 25,
            "market_price_probability": 0.25,
            "fair_probability": 0.9,
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
        },
        {
            "decision_id": "win-no-2",
            "decision": "PAPER_EXPLORE_BUY_NO",
            "inverse_strategy_applied": True,
            "market_ticker": "KXWEATHER-2",
            "market_title": "Will the temp be above 82?",
            "market_category": "weather:CHICAGO:temperature",
            "strategy_taxonomy": {"domain": "weather", "market_type": "temperature"},
            "fair_value_source_type": "weather_model",
            "fair_value_method": "empirical_inverse_audit_flipped_weather_model",
            "paper_fill_price_cents": 25,
            "market_price_probability": 0.25,
            "fair_probability": 0.9,
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
        },
    ]
    outcomes = [
        {"decision_id": "win-no-1", "resolved": True, "outcome_yes": 0},
        {"decision_id": "win-no-2", "resolved": True, "outcome_yes": 0},
    ]

    result = failure.diagnose_records(decisions, outcomes, minimum_scored=2, max_segments=5)
    candidate = result["tiny_probe_candidates"][0]

    assert result["summary"]["inverse_accuracy"] == 1.0
    assert result["summary"]["inverse_paper_pnl_usd"] == 6.0
    assert candidate["recommended_paper_action"] == "ALLOW_TINY_SEGMENT_SCOPED_PROBE"
    assert candidate["dimensions"]["category"] == "weather"
    assert candidate["live_order_allowed"] is False


def test_inverse_forward_paper_creates_bounded_inverse_test(tmp_path):
    inverse = load_module("kalshi_inverse_forward_paper", ROOT / "kalshi_inverse_forward_paper.py")
    decisions_path = tmp_path / "decisions.jsonl"
    state_path = tmp_path / "state.json"
    experiments_path = tmp_path / "experiments.jsonl"
    diagnosis_path = tmp_path / "missing_diagnosis.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "parent-1",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": "KXTEST",
                "market_title": "Test market",
                "market_category": "weather",
                "paper_fill_price_cents": 60,
                "inverse_executable_price_cents": 40,
                "inverse_executable_price_source": "fixture_visible_orderbook",
                "fair_probability": 0.6,
                "uncertainty_low": 0.55,
                "uncertainty_high": 0.65,
                "simulated_size_usd": 2.0,
                "expected_result_known_time_utc": "2099-01-01T00:00:00Z",
                "timestamp_utc": "2026-05-10T00:00:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"inverse_forward_test_categories": ["weather"]}), encoding="utf-8")
    result = inverse.create(
        Namespace(
            decisions_log=str(decisions_path),
            state_path=str(state_path),
            experiments_log=str(experiments_path),
            proof_diagnosis_path=str(diagnosis_path),
            max_new=10,
            max_size_usd=1.0,
            min_inverse_price_cents=5,
            max_inverse_price_cents=95,
            dry_run=False,
        )
    )
    assert result["created_count"] == 1
    created = result["created"][0]
    assert created["decision"] == "PAPER_INVERSE_FORWARD_BUY_NO"
    assert created["market_price_cents"] == 40
    assert created["synthetic_inverse_price_allowed"] is False
    assert created["inverse_executable_price_source"] == "fixture_visible_orderbook"
    assert created["simulated_size_usd"] == 1.0
    assert created["live_order_allowed"] is False
    assert created["inverse_of_decision_id"] == "parent-1"
    assert len([line for line in decisions_path.read_text(encoding="utf-8").splitlines() if line.strip()]) == 2


def test_inverse_forward_paper_obeys_proof_diagnosis_freeze(tmp_path):
    inverse = load_module("kalshi_inverse_forward_paper_freeze", ROOT / "kalshi_inverse_forward_paper.py")
    decisions_path = tmp_path / "decisions.jsonl"
    state_path = tmp_path / "state.json"
    experiments_path = tmp_path / "experiments.jsonl"
    diagnosis_path = tmp_path / "diagnosis.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "parent-1",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": "KXTEST",
                "market_title": "Test market",
                "market_category": "weather",
                "paper_fill_price_cents": 60,
                "fair_probability": 0.6,
                "simulated_size_usd": 2.0,
                "expected_result_known_time_utc": "2099-01-01T00:00:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"inverse_forward_test_categories": ["weather"]}), encoding="utf-8")
    diagnosis_path.write_text(json.dumps({"inverse_expansion_allowed": False, "diagnosis": "fresh_inverse_failing"}), encoding="utf-8")
    result = inverse.create(
        Namespace(
            decisions_log=str(decisions_path),
            state_path=str(state_path),
            experiments_log=str(experiments_path),
            proof_diagnosis_path=str(diagnosis_path),
            max_new=10,
            max_size_usd=1.0,
            min_inverse_price_cents=5,
            max_inverse_price_cents=95,
            dry_run=False,
        )
    )
    assert result["created_count"] == 0
    assert result["skipped_reasons"]["proof_diagnosis_freeze"] == 1
    assert len([line for line in decisions_path.read_text(encoding="utf-8").splitlines() if line.strip()]) == 1


def test_inverse_forward_paper_skips_out_of_bounds_inverse_price(tmp_path):
    inverse = load_module("kalshi_inverse_forward_paper_price_bounds", ROOT / "kalshi_inverse_forward_paper.py")
    decisions_path = tmp_path / "decisions.jsonl"
    state_path = tmp_path / "state.json"
    experiments_path = tmp_path / "experiments.jsonl"
    diagnosis_path = tmp_path / "missing_diagnosis.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "parent-1",
                "decision": "PAPER_EXPLORE_BUY_NO",
                "market_ticker": "KXTEST",
                "market_title": "Test market",
                "market_category": "weather",
                "paper_fill_price_cents": 99,
                "inverse_executable_price_cents": 99,
                "inverse_executable_price_source": "fixture_visible_orderbook",
                "fair_probability": 0.99,
                "simulated_size_usd": 2.0,
                "expected_result_known_time_utc": "2099-01-01T00:00:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"inverse_forward_test_categories": ["weather"]}), encoding="utf-8")
    result = inverse.create(
        Namespace(
            decisions_log=str(decisions_path),
            state_path=str(state_path),
            experiments_log=str(experiments_path),
            proof_diagnosis_path=str(diagnosis_path),
            max_new=10,
            max_size_usd=1.0,
            min_inverse_price_cents=5,
            max_inverse_price_cents=95,
            dry_run=False,
        )
    )
    assert result["created_count"] == 0
    assert result["skipped_reasons"]["inverse_price_out_of_bounds"] == 1


def test_inverse_forward_paper_rejects_synthetic_inverse_price(tmp_path):
    inverse = load_module("kalshi_inverse_forward_paper_synthetic", ROOT / "kalshi_inverse_forward_paper.py")
    decisions_path = tmp_path / "decisions.jsonl"
    state_path = tmp_path / "state.json"
    experiments_path = tmp_path / "experiments.jsonl"
    diagnosis_path = tmp_path / "missing_diagnosis.json"
    decisions_path.write_text(
        json.dumps(
            {
                "decision_id": "parent-1",
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": "KXTEST",
                "market_title": "Test market",
                "market_category": "weather",
                "paper_fill_price_cents": 60,
                "fair_probability": 0.6,
                "simulated_size_usd": 2.0,
                "expected_result_known_time_utc": "2099-01-01T00:00:00Z",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    state_path.write_text(json.dumps({"inverse_forward_test_categories": ["weather"]}), encoding="utf-8")
    result = inverse.create(
        Namespace(
            decisions_log=str(decisions_path),
            state_path=str(state_path),
            experiments_log=str(experiments_path),
            proof_diagnosis_path=str(diagnosis_path),
            max_new=10,
            max_size_usd=1.0,
            min_inverse_price_cents=5,
            max_inverse_price_cents=95,
            dry_run=False,
        )
    )
    assert result["created_count"] == 0
    assert result["skipped_reasons"]["missing_inverse_executable_price"] == 1
    assert len([line for line in decisions_path.read_text(encoding="utf-8").splitlines() if line.strip()]) == 1


def test_taxonomy_and_clean_evidence_route_valid_weather_candidate():
    taxonomy = load_module("kalshi_strategy_taxonomy", ROOT / "kalshi_strategy_taxonomy.py")
    clean = load_module("kalshi_clean_evidence", ROOT / "kalshi_clean_evidence.py")
    record = {
        "decision": "PAPER_EXPLORE_BUY_YES",
        "market_ticker": "KXHIGHCHI-26MAY10-B76",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "strategy_bucket": "high_probability_harvesting_simulation",
        "fair_value_source_type": "weather_model",
        "market_price_cents": 45,
        "depth_contracts": 50,
        "expected_result_known_time_utc": "2099-01-01T00:00:00Z",
        "live_order_allowed": False,
    }
    classified = taxonomy.classify_record(record)
    assert classified["domain"] == "weather"
    assert classified["subdomain"] == "temperature"
    result = clean.validate_record(record, max_hours=700000)
    assert result["clean_evidence_passed"] is True
    assert result["recommended_route"] == "ACCEPT_EXPLORATION"
    assert result["live_order_allowed"] is False


def test_clean_evidence_blocks_weather_source_station_mismatch():
    clean = load_module("kalshi_clean_evidence_station_mismatch", ROOT / "kalshi_clean_evidence.py")
    record = {
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "market_ticker": "KXHIGHDAL-26MAY19-T76",
        "market_title": "Will the high temperature in Dallas be above 76 on May 19, 2026?",
        "market_category": "weather",
        "fair_value_source_type": "weather_model",
        "market_price_cents": 50,
        "paper_fill_price_cents": 50,
        "depth_contracts": 10,
        "expected_result_known_time_utc": "2026-05-20T05:00:00Z",
        "weather_station": "KDAL",
        "weather_source_station": "KDFW",
        "live_order_allowed": False,
    }
    result = clean.validate_record(record, now=datetime(2026, 5, 19, tzinfo=timezone.utc), max_hours=48)
    assert result["clean_evidence_passed"] is False
    assert "weather_source_station_mismatch" in result["blockers"]


def test_inverse_first_candidate_requires_real_implied_no_ask_depth():
    generator = load_module("kalshi_inverse_first_candidates", ROOT / "kalshi_inverse_first_candidates.py")
    market = {
        "ticker": "KXNBAGAME-26MAY11DETCLE-DET",
        "title": "Will Detroit win?",
        "status": "active",
        "expected_expiration_time": "2099-01-01T03:00:00Z",
        "updated_time": "2026-05-11T00:00:00Z",
    }
    normalized = {
        "best_no_ask_cents": 42,
        "best_no_ask_size_contracts": 30,
        "best_yes_bid_cents": 58,
        "no_spread_cents": 4,
        "is_crossed": False,
        "warnings": [],
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        now=generator.datetime(2026, 5, 11, tzinfo=generator.timezone.utc),
        max_hours=700000,
        size_usd=1.0,
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["decision"] == "PAPER_INVERSE_FORWARD_BUY_NO"
    assert candidate["inverse_executable_price_cents"] == 42
    assert candidate["inverse_executable_price_source"] == "current_orderbook_implied_no_ask"
    assert candidate["depth_contracts"] == 30
    assert candidate["time_to_result_hours"] > 0
    assert candidate["clean_evidence"]["clean_evidence_passed"] is True
    assert candidate["live_order_allowed"] is False


def test_inverse_first_candidate_converts_halted_sports_to_shadow():
    generator = load_module("kalshi_inverse_first_candidates_sports_halt", ROOT / "kalshi_inverse_first_candidates.py")
    assert generator._halted_accepted_paper_categories({"halted_accepted_paper_categories": ["sports"]}) == {"sports"}
    shadow = generator._shadow_record_for_halted_category(
        {
            "decision": "PAPER_INVERSE_FORWARD_BUY_NO",
            "market_category": "sports",
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
        },
        "sports",
    )
    assert shadow["decision"] == "SHADOW_PAPER_INVERSE_FORWARD_BUY_NO"
    assert shadow["evidence_tier"] == "shadow"
    assert shadow["simulated_size_usd"] == 0.0
    assert shadow["strategy_governor_action"] == "SHADOW_ONLY"
    assert shadow["halted_accepted_paper_category"] == "sports"
    assert shadow["live_order_allowed"] is False


def test_inverse_first_generator_shadows_market_implied_probes_without_edge(monkeypatch, tmp_path):
    generator = load_module("kalshi_inverse_first_candidates_governor_shadow", ROOT / "kalshi_inverse_first_candidates.py")
    proof_path = tmp_path / "diagnosis.json"
    runs_path = tmp_path / "runs.jsonl"
    decisions_path = tmp_path / "decisions.jsonl"
    state_path = tmp_path / "state.json"
    decisions_path.write_text("", encoding="utf-8")
    state_path.write_text("{}", encoding="utf-8")
    proof_path.write_text(
        json.dumps(
            {
                "ok": True,
                "timestamp_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "inverse_expansion_allowed": True,
                "diagnosis": "inverse_first_epoch_collecting_fresh_proof",
                "recommended_route": "INVERSE_FIRST_PAPER_WITH_EXECUTABLE_PRICE_GATES",
                "paper_budget_action": "allow_inverse_first_paper_learning",
                "plain_english_summary": "Allow tiny paper learning only after governor gates.",
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )

    market = {
        "ticker": "KXNBAGAME-26MAY11DETCLE-DET",
        "title": "Will Detroit win?",
        "category": "sports",
        "status": "active",
        "expected_expiration_time": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
        "updated_time": "2026-05-11T00:00:00Z",
    }

    def fake_get(path, params=None):
        if path == "/markets":
            return {"ok": True, "data": {"markets": [market], "cursor": ""}}
        if path == "/markets/KXNBAGAME-26MAY11DETCLE-DET/orderbook":
            return {
                "ok": True,
                "data": {
                    "orderbook": {
                        "yes": [[58, 30]],
                        "no": [[40, 20]],
                    }
                },
            }
        raise AssertionError(path)

    monkeypatch.setattr(generator, "kalshi_get", fake_get)
    result = generator.generate(
        Namespace(
            limit=5,
            status="open",
            search="sports",
            max_orderbooks=5,
            max_new=2,
            max_hours=24.0,
            max_pages=1,
            size_usd=1.0,
            preserve_api_order=False,
            decisions_log=str(decisions_path),
            runs_log=str(runs_path),
            proof_diagnosis_path=str(proof_path),
            state_path=str(state_path),
            dry_run=True,
        )
    )

    assert result["created_count"] == 1
    assert result["accepted_created_count"] == 0
    assert result["shadow_created_count"] == 1
    created = result["created"][0]
    assert created["decision"] == "SHADOW_PAPER_INVERSE_FORWARD_BUY_NO"
    assert created["simulated_size_usd"] == 0.0
    assert created["strategy_governor_action"] == "SHADOW_ONLY"
    assert created["inverse_first_governor_checked"] is True
    assert "market-only or placeholder pricing" in created["strategy_governor_reason"]
    assert created["live_order_allowed"] is False


def test_inverse_first_candidate_respects_strategy_proof_freeze(tmp_path):
    generator = load_module("kalshi_inverse_first_candidates_freeze", ROOT / "kalshi_inverse_first_candidates.py")
    proof_path = tmp_path / "diagnosis.json"
    runs_path = tmp_path / "runs.jsonl"
    decisions_path = tmp_path / "decisions.jsonl"
    decisions_path.write_text("", encoding="utf-8")
    proof_path.write_text(
        json.dumps(
            {
                "ok": True,
                "inverse_expansion_allowed": False,
                "diagnosis": "historical_inverse_conflicts_with_actual_applied_inverse",
                "recommended_route": "FREEZE_BROAD_INVERSE_FIRST_AND_RUN_BUG_VS_EDGE_REVIEW",
                "paper_budget_action": "freeze_new_broad_inverse_first_notional",
                "plain_english_summary": "Actual applied inverse is losing.",
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )
    result = generator.generate(
        Namespace(
            limit=5,
            status="open",
            search="sports",
            max_orderbooks=5,
            max_new=2,
            max_hours=24.0,
            max_pages=1,
            size_usd=1.0,
            preserve_api_order=False,
            decisions_log=str(decisions_path),
            runs_log=str(runs_path),
            proof_diagnosis_path=str(proof_path),
            dry_run=True,
        )
    )
    assert result["created_count"] == 0
    assert result["skipped_reasons"] == {"proof_diagnosis_freeze": 1}
    assert result["proof_diagnosis"]["diagnosis"] == "historical_inverse_conflicts_with_actual_applied_inverse"
    assert result["live_order_allowed"] is False
    assert "frozen" in result["warnings"][0]
    assert runs_path.exists()


def test_inverse_first_candidate_requires_strategy_proof_file(tmp_path):
    generator = load_module("kalshi_inverse_first_candidates_missing_proof", ROOT / "kalshi_inverse_first_candidates.py")
    runs_path = tmp_path / "runs.jsonl"
    decisions_path = tmp_path / "decisions.jsonl"
    decisions_path.write_text("", encoding="utf-8")

    result = generator.generate(
        Namespace(
            limit=5,
            status="open",
            search="sports",
            max_orderbooks=5,
            max_new=2,
            max_hours=24.0,
            max_pages=1,
            size_usd=1.0,
            preserve_api_order=False,
            decisions_log=str(decisions_path),
            runs_log=str(runs_path),
            proof_diagnosis_path=str(tmp_path / "missing-proof.json"),
            dry_run=True,
        )
    )

    assert result["created_count"] == 0
    assert result["skipped_reasons"] == {"proof_diagnosis_missing": 1}
    assert "fresh strategy proof diagnosis" in result["warnings"][0]
    assert result["live_order_allowed"] is False
    assert runs_path.exists()


def test_inverse_first_candidate_rejects_stale_allowing_proof(tmp_path):
    generator = load_module("kalshi_inverse_first_candidates_stale_proof", ROOT / "kalshi_inverse_first_candidates.py")
    proof_path = tmp_path / "diagnosis.json"
    runs_path = tmp_path / "runs.jsonl"
    decisions_path = tmp_path / "decisions.jsonl"
    decisions_path.write_text("", encoding="utf-8")
    proof_path.write_text(
        json.dumps(
            {
                "ok": True,
                "timestamp_utc": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
                "inverse_expansion_allowed": True,
                "diagnosis": "inverse_first_epoch_collecting_fresh_proof",
                "recommended_route": "INVERSE_FIRST_PAPER_WITH_EXECUTABLE_PRICE_GATES",
                "paper_budget_action": "allow_inverse_first_paper_learning",
                "plain_english_summary": "Fresh proof was available earlier.",
                "live_order_allowed": False,
            }
        ),
        encoding="utf-8",
    )

    result = generator.generate(
        Namespace(
            limit=5,
            status="open",
            search="sports",
            max_orderbooks=5,
            max_new=2,
            max_hours=24.0,
            max_pages=1,
            size_usd=1.0,
            preserve_api_order=False,
            decisions_log=str(decisions_path),
            runs_log=str(runs_path),
            proof_diagnosis_path=str(proof_path),
            dry_run=True,
        )
    )

    assert result["created_count"] == 0
    assert result["skipped_reasons"] == {"proof_diagnosis_stale": 1}
    assert "stale" in result["warnings"][0]
    assert result["proof_diagnosis"]["inverse_expansion_allowed"] is True
    assert result["live_order_allowed"] is False


def test_weather_candidate_rank_prioritizes_high_quality_rain_signal():
    generator = load_module("kalshi_weather_candidate_rain_rank", ROOT / "kalshi_weather_paper_candidates.py")
    records = [
        {"market_ticker": "KXRAINLOW", "rain_signal_rank_score": 0.5, "edge_after_costs_pct": 50, "model_confidence_score": 0.9, "rain_feature_diagnostics": {"rank_score": 0.5}, "live_order_allowed": False},
        {"market_ticker": "KXRAINHIGH", "rain_signal_rank_score": 4.0, "edge_after_costs_pct": 1, "model_confidence_score": 0.2, "rain_feature_diagnostics": {"rank_score": 4.0}, "live_order_allowed": False},
        {"market_ticker": "KXTEMP", "edge_after_costs_pct": 100, "model_confidence_score": 1.0, "live_order_allowed": False},
    ]

    ranked = sorted(records, key=generator._weather_candidate_rank)

    assert [record["market_ticker"] for record in ranked] == ["KXRAINHIGH", "KXRAINLOW", "KXTEMP"]
    assert all(record.get("live_order_allowed") is False for record in ranked)



def test_weather_paper_candidate_adds_rain_feature_diagnostics():
    generator = load_module("kalshi_weather_paper_candidates_rain_features", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXRAINCHI-26MAY10-R1",
        "title": "Will it rain in Chicago above 0.1 inches on May 10, 2026?",
        "city": "CHICAGO",
        "station": "KORD",
        "target_date": "2026-05-10",
        "market_type": "rain",
        "direction": "above",
        "strike_f": 0.1,
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 40,
        "best_yes_ask_size_contracts": 50,
        "best_no_ask_cents": 65,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 3,
        "no_spread_cents": 3,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "target_dates": {
            "2026-05-10": {
                "stations": {
                    "KORD": {
                        "target_date": "2026-05-10",
                        "sources": {
                            "open_meteo_forecast": {
                                "source_name": "open_meteo_forecast",
                                "fetched_at_utc": "2026-05-10T00:00:00Z",
                                "source_run_key": "2026-05-10T00:00:00Z",
                                "source_hash": "rain-source-hash",
                                "summary": {"date": "2026-05-10", "precipitation_sum_in": 0.35},
                            }
                        },
                    }
                }
            }
        },
    }

    candidate, reason = generator._candidate_from_market(
        market, normalized, freshness, now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc), max_hours=48, min_edge_after_costs_pct=-5.0, size_usd=1.0
    )

    assert reason == "created"
    assert candidate is not None
    diagnostics = candidate["rain_feature_diagnostics"]
    assert diagnostics["forecast_precipitation_inches"] == 0.35
    assert diagnostics["threshold_precipitation_inches"] == 0.1
    assert diagnostics["forecast_margin_inches"] == 0.25
    assert diagnostics["source_scope"] == "station"
    assert diagnostics["source_hash_present"] is True
    assert diagnostics["quality_score"] == 1.0
    assert diagnostics["blockers"] == []
    assert candidate["quality_gates"]["rain_feature_quality_passed"] is True
    assert candidate["live_order_allowed"] is False



def test_weather_paper_candidate_requires_clean_source_and_depth():
    generator = load_module("kalshi_weather_paper_candidates", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY10-B76",
        "title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 54,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-05-10T00:00:00Z",
                        "source_run_key": "2026-05-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-05-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=-2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["decision"] == "PAPER_WEATHER_MODEL_BUY_YES"
    assert candidate["fair_value_source_type"] == "weather_model"
    assert candidate["weather_city"] == "CHICAGO"
    assert candidate["weather_station"] == "KORD"
    assert candidate["weather_target_date"] == "2026-05-10"
    assert candidate["weather_threshold"] == 76.0
    assert candidate["weather_direction"] == "above"
    assert candidate["forecast_value"] == 82.0
    assert candidate["raw_weather_model_fair_probability"] == 0.95
    assert candidate["weather_forecast_margin"] == 6.0
    assert candidate["weather_absolute_forecast_margin"] == 6.0
    assert candidate["weather_model_confidence_score"] == 0.9
    assert candidate["model_confidence_score"] == 0.9
    assert candidate["fair_probability"] == 0.68
    assert candidate["selected_side_fair_probability"] == 0.68
    assert candidate["baseline_beating_signal"] is True
    assert candidate["baseline_comparison"]["beats_market_baseline"] is True
    assert candidate["baseline_comparison"]["beats_random_baseline"] is True
    assert candidate["baseline_comparison"]["beats_no_trade_baseline"] is True
    assert candidate["quality_gates"]["baseline_comparison_passed"] is True
    assert candidate["weather_probability_calibration"]["live_order_allowed"] is False
    assert candidate["weather_probability_calibration"]["method"] == "shrink_raw_forecast_margin_probability_toward_50_percent"
    assert candidate["quality_gates"]["model_confidence_passed"] is True
    assert candidate["expected_result_known_time_utc"] == "2026-05-11T05:00:00Z"
    assert candidate["clean_evidence"]["clean_evidence_passed"] is True
    assert candidate["live_order_allowed"] is False


def test_weather_paper_candidate_uses_market_snapshot_ask_when_orderbook_ask_missing():
    generator = load_module("kalshi_weather_paper_candidates_snapshot_ask", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY10-B76",
        "title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
        "raw_market": {
            "yes_ask_dollars": "0.5400",
            "yes_ask_size_fp": "40.00",
        },
    }
    normalized = {
        "best_yes_ask_cents": None,
        "best_yes_ask_size_contracts": 0,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": None,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-05-10T00:00:00Z",
                        "source_run_key": "2026-05-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-05-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=-2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["market_price_cents"] == 54
    assert candidate["depth_contracts"] == 40
    assert candidate["paper_fill_price_source"] == "market_snapshot_yes_ask_dollars"
    assert candidate["live_order_allowed"] is False


def test_weather_calibration_builds_verified_bucket_from_scored_outcomes():
    calibration = load_module("kalshi_weather_calibration_verified_bucket", ROOT / "kalshi_weather_calibration.py")
    decisions = []
    outcomes = []
    for index in range(30):
        decision_id = f"weather-win-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "market_category": "weather",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "YES",
                "weather_city": "CHICAGO",
                "weather_market_type": "high_temperature",
                "weather_direction": "above",
                "fair_probability": 0.72,
                "market_price_cents": 40,
                "paper_fill_price_cents": 40,
                "simulated_size_usd": 1.0,
                "live_order_allowed": False,
            }
        )
        outcomes.append({"decision_id": decision_id, "resolved": True, "outcome_yes": 1})
    payload = calibration.build_calibration(decisions, outcomes)
    bucket = payload["buckets"]["CHICAGO|high_temperature|above"]
    assert payload["live_order_allowed"] is False
    assert payload["verified_bucket_count"] == 3
    assert bucket["calibration_verified"] is True
    assert bucket["accuracy"] == 1.0
    assert bucket["brier_score"] < bucket["market_brier_score"]
    assert bucket["recommended_shrinkage"] == 0.5


def test_weather_calibration_learns_from_shadow_without_promoting_paper():
    calibration = load_module("kalshi_weather_calibration_shadow_learning", ROOT / "kalshi_weather_calibration.py")
    decisions = []
    outcomes = []
    for index in range(30):
        decision_id = f"weather-shadow-win-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "market_category": "weather",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "YES",
                "weather_city": "DENVER",
                "weather_market_type": "high_temperature",
                "weather_direction": "above",
                "fair_probability": 0.72,
                "market_price_cents": 40,
                "paper_fill_price_cents": 40,
                "simulated_size_usd": 0.0,
                "live_order_allowed": False,
            }
        )
        outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 1,
                "shadow_learning_outcome": True,
                "proof_metrics_exclude_shadow": True,
                "live_order_allowed": False,
            }
        )
    payload = calibration.build_calibration(decisions, outcomes)
    bucket = payload["buckets"]["DENVER|high_temperature|above"]
    assert payload["scored_weather_decisions"] == 30
    assert payload["accepted_training_scored_weather_decisions"] == 0
    assert payload["shadow_training_scored_weather_decisions"] == 30
    assert payload["verified_bucket_count"] == 0
    assert payload["probability_calibration_learned_bucket_count"] == 3
    assert payload["shadow_probability_calibration_learned_bucket_count"] == 3
    assert bucket["calibration_verified"] is False
    assert bucket["shadow_probability_calibration_learned"] is True
    assert bucket["status"] == "shadow_probability_calibration_learned"
    assert bucket["recommended_shrinkage"] == 0.45
    assert bucket["live_order_allowed"] is False


def test_weather_calibration_uses_original_strategy_side_for_rejected_shadow_training():
    calibration = load_module("kalshi_weather_calibration_original_side", ROOT / "kalshi_weather_calibration.py")
    decisions = []
    outcomes = []
    for index in range(30):
        decision_id = f"weather-rejected-shadow-win-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "decision": "REJECT",
                "market_category": "weather:DENVER:low_temperature",
                "fair_value_source_type": "weather_model",
                "original_strategy_side": "NO",
                "weather_city": "DENVER",
                "weather_market_type": "low_temperature",
                "weather_direction": "below",
                "fair_probability": 0.20,
                "market_price_cents": 80,
                "simulated_size_usd": 0.0,
                "live_order_allowed": False,
            }
        )
        outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0,
                "shadow_learning_outcome": True,
                "proof_metrics_exclude_shadow": True,
                "live_order_allowed": False,
            }
        )
    payload = calibration.build_calibration(decisions, outcomes)
    bucket = payload["buckets"]["DENVER|low_temperature|below"]
    assert payload["scored_weather_decisions"] == 30
    assert payload["shadow_training_scored_weather_decisions"] == 30
    assert payload["skipped_reasons"] == {}
    assert bucket["accuracy"] == 1.0
    assert bucket["shadow_probability_calibration_learned"] is True
    assert bucket["calibration_verified"] is False
    assert bucket["live_order_allowed"] is False


def test_weather_calibration_parses_legacy_weather_bucket_from_title_and_category():
    calibration = load_module("kalshi_weather_calibration_legacy_bucket_parse", ROOT / "kalshi_weather_calibration.py")
    decisions = []
    outcomes = []
    for index in range(30):
        decision_id = f"weather-legacy-title-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "decision": "PAPER_BUY_YES",
                "market_category": "weather:NEW YORK:temperature",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "YES",
                "market_title": "Will the temp in New York City be above 55.99° on May 4, 2026 at 12am EDT?",
                "market_ticker": "KXTEMPNYCH-26MAY0400-T55.99",
                "fair_probability": 0.72,
                "market_price_cents": 40,
                "paper_fill_price_cents": 40,
                "simulated_size_usd": 1.0,
                "live_order_allowed": False,
            }
        )
        outcomes.append({"decision_id": decision_id, "resolved": True, "outcome_yes": 1})
    payload = calibration.build_calibration(decisions, outcomes)

    assert "UNKNOWN|unknown|unknown" not in payload["buckets"]
    assert payload["scored_weather_decisions"] == 30
    assert payload["skipped_reasons"] == {}
    assert payload["buckets"]["NEW YORK|temperature|above"]["calibration_verified"] is True


def test_weather_calibration_skips_non_predictive_weather_records():
    calibration = load_module("kalshi_weather_calibration_skips_non_predictive", ROOT / "kalshi_weather_calibration.py")
    decisions = [
        {
            "decision_id": "weather-reject-no-shadow",
            "decision": "REJECT",
            "market_category": "weather:DENVER:low_temperature",
            "fair_value_source_type": "weather_model",
            "original_strategy_side": "NO",
            "market_title": "Will the minimum temperature be <24° on May 6, 2026?",
            "fair_probability": 0.20,
            "market_price_cents": 80,
            "live_order_allowed": False,
        }
    ]
    outcomes = [{"decision_id": "weather-reject-no-shadow", "resolved": True, "outcome_yes": 0}]
    payload = calibration.build_calibration(decisions, outcomes)

    assert payload["scored_weather_decisions"] == 0
    assert payload["bucket_count"] == 0
    assert payload["skipped_reasons"] == {"non_predictive_weather_record": 1}
    assert payload["live_order_allowed"] is False


def test_weather_calibration_marks_underperforming_bucket_for_shadow_abstention():
    calibration = load_module("kalshi_weather_calibration_abstention_profile", ROOT / "kalshi_weather_calibration.py")
    decisions = []
    outcomes = []
    for index in range(30):
        decision_id = f"weather-underperform-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "market_category": "weather",
                "fair_value_source_type": "weather_model",
                "selected_executable_side": "YES",
                "weather_city": "AUSTIN",
                "weather_market_type": "high_temperature",
                "weather_direction": "above",
                "fair_probability": 0.72,
                "market_price_cents": 40,
                "paper_fill_price_cents": 40,
                "simulated_size_usd": 0.0,
                "live_order_allowed": False,
            }
        )
        outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0,
                "shadow_learning_outcome": True,
                "proof_metrics_exclude_shadow": True,
                "live_order_allowed": False,
            }
        )
    payload = calibration.build_calibration(decisions, outcomes)
    bucket = payload["buckets"]["AUSTIN|high_temperature|above"]
    assert bucket["status"] == "model_underperforms_market_baseline"
    assert bucket["recommended_candidate_route"] == "SHADOW_ONLY_ABSTAIN"
    assert bucket["accepted_paper_abstention_required"] is True
    assert bucket["extra_edge_after_costs_required_pct"] == 5.0
    assert bucket["recommended_shrinkage"] == 0.2
    assert bucket["live_order_allowed"] is False


def test_weather_probability_calibration_record_changes_only_when_bucket_verified():
    generator = load_module("kalshi_weather_paper_candidates_calibration_record", ROOT / "kalshi_weather_paper_candidates.py")
    spec = generator.WeatherSpec(
        city="CHICAGO",
        station="KORD",
        target_date="2026-05-10",
        market_type="high_temperature",
        threshold=76.0,
        direction="above",
    )
    default_record = generator._calibrated_weather_probability(0.70, spec, None)
    calibrated_record = generator._calibrated_weather_probability(
        0.70,
        spec,
        {
            "ok": True,
            "buckets": {
                "CHICAGO|high_temperature|above": {
                    "scope": "leaf",
                    "status": "calibration_verified",
                    "scored": 30,
                    "accuracy": 0.7,
                    "paper_pnl_usd": 12.0,
                    "brier_score": 0.18,
                    "market_brier_score": 0.22,
                    "recommended_shrinkage": 0.6,
                    "calibration_verified": True,
                }
            },
        },
    )
    shadow_learned_record = generator._calibrated_weather_probability(
        0.70,
        spec,
        {
            "ok": True,
            "buckets": {
                "CHICAGO|high_temperature|above": {
                    "scope": "leaf",
                    "status": "shadow_probability_calibration_learned",
                    "scored": 30,
                    "accepted_scored": 0,
                    "shadow_scored": 30,
                    "accuracy": 0.7,
                    "paper_pnl_usd": 0.0,
                    "brier_score": 0.18,
                    "market_brier_score": 0.22,
                    "recommended_shrinkage": 0.45,
                    "probability_calibration_learned": True,
                    "shadow_probability_calibration_learned": True,
                    "calibration_verified": False,
                }
            },
        },
    )
    assert default_record["calibrated_fair_probability"] == 0.58
    assert calibrated_record["calibrated_fair_probability"] == 0.62
    assert calibrated_record["bucket_key"] == "CHICAGO|high_temperature|above"
    assert calibrated_record["weather_probability_calibration_verified"] is True
    assert shadow_learned_record["calibrated_fair_probability"] == 0.59
    assert shadow_learned_record["bucket_status"] == "shadow_probability_calibration_learned"
    assert shadow_learned_record["weather_probability_calibration_verified"] is False
    assert calibrated_record["live_order_allowed"] is False


def test_weather_candidate_keeps_under_edge_observation_as_shadow_learning():
    generator = load_module("kalshi_weather_paper_candidates_shadow_under_edge", ROOT / "kalshi_weather_paper_candidates.py")
    router = load_module("kalshi_auto_paper_candidates_shadow_under_edge", ROOT / "kalshi_auto_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY10-B76",
        "title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 80,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 25,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-05-10T00:00:00Z",
                        "source_run_key": "2026-05-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-05-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["evidence_tier"] == "shadow"
    assert candidate["simulated_size_usd"] == 0.0
    assert candidate["baseline_beating_signal"] is False
    assert candidate["quality_gates"]["edge_after_costs_passed"] is False
    candidate["expected_result_known_time_utc"] = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    governed = router.apply_governor_route(candidate, {"minimum_edge_after_costs_pct": 2.0})
    assert governed["strategy_governor_action"] == "SHADOW_ONLY"
    assert governed["simulated_size_usd"] == 0.0
    assert governed["live_order_allowed"] is False


def test_weather_candidate_applies_calibration_abstention_floor():
    generator = load_module("kalshi_weather_paper_candidates_abstention_floor", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHAUS-26MAY10-B76",
        "title": "Will the high temperature in Austin be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 54,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "AUSTIN": {
                "target_date": "2026-05-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-05-10T00:00:00Z",
                        "source_run_key": "2026-05-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-05-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    calibration = {
        "ok": True,
        "buckets": {
            "AUSTIN|high_temperature|above": {
                "scope": "leaf",
                "status": "model_underperforms_market_baseline",
                "scored": 30,
                "accuracy": 0.0,
                "paper_pnl_usd": 0.0,
                "brier_score": 0.52,
                "market_brier_score": 0.16,
                "recommended_shrinkage": 0.2,
                "calibration_verified": False,
                "recommended_candidate_route": "SHADOW_ONLY_ABSTAIN",
                "accepted_paper_abstention_required": True,
                "extra_edge_after_costs_required_pct": 5.0,
                "abstention_reason": "weather model underperforms the market Brier baseline in this bucket",
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=2.0,
        size_usd=1.0,
        epoch_id="epoch-test",
        calibration=calibration,
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["minimum_edge_after_costs_pct"] == 7.0
    assert candidate["weather_calibration_abstention_required"] is True
    assert candidate["weather_calibration_recommended_candidate_route"] == "SHADOW_ONLY_ABSTAIN"
    assert candidate["beats_market_baseline"] is False
    assert candidate["baseline_beating_signal"] is False
    assert candidate["evidence_tier"] == "shadow"
    assert candidate["live_order_allowed"] is False


def test_weather_paper_candidate_uses_target_date_specific_source_cache():
    generator = load_module("kalshi_weather_paper_candidates_multiday_source", ROOT / "kalshi_weather_paper_candidates.py")
    spec = generator.WeatherSpec(
        city="CHICAGO",
        station="KORD",
        target_date="2026-05-19",
        market_type="high_temperature",
        threshold=76.0,
        direction="above",
    )
    source, error = generator._source_record_for_spec(
        spec,
        {
            "ok": True,
            "cities": {
                "CHICAGO": {
                    "target_date": "2026-05-18",
                    "sources": {
                        "open_meteo_forecast": {
                            "summary": {
                                "date": "2026-05-18",
                                "temperature_2m_max_f": 70.0,
                            }
                        }
                    },
                }
            },
            "target_dates": {
                "2026-05-19": {
                    "cities": {
                        "CHICAGO": {
                            "target_date": "2026-05-19",
                            "sources": {
                                "open_meteo_forecast": {
                                    "summary": {
                                        "date": "2026-05-19",
                                        "temperature_2m_max_f": 83.0,
                                        "temperature_2m_min_f": 62.0,
                                        "precipitation_sum_in": 0.0,
                                    }
                                }
                            },
                        }
                    }
                }
            },
        },
    )
    assert error is None
    assert source is not None
    assert source["summary"]["date"] == "2026-05-19"
    assert source["summary"]["temperature_2m_max_f"] == 83.0


def test_weather_paper_candidate_uses_station_specific_source_cache_before_city_source():
    generator = load_module("kalshi_weather_paper_candidates_station_source", ROOT / "kalshi_weather_paper_candidates.py")
    spec = generator.WeatherSpec(
        city="CHICAGO",
        station="KMDW",
        target_date="2026-05-19",
        market_type="high_temperature",
        threshold=76.0,
        direction="above",
    )
    source, error = generator._source_record_for_spec(
        spec,
        {
            "ok": True,
            "target_dates": {
                "2026-05-19": {
                    "cities": {
                        "CHICAGO": {
                            "station": "KORD",
                            "target_date": "2026-05-19",
                            "sources": {
                                "open_meteo_forecast": {
                                    "summary": {
                                        "date": "2026-05-19",
                                        "temperature_2m_max_f": 83.0,
                                    }
                                }
                            },
                        }
                    },
                    "stations": {
                        "KMDW": {
                            "station": "KMDW",
                            "target_date": "2026-05-19",
                            "sources": {
                                "open_meteo_forecast": {
                                    "summary": {
                                        "date": "2026-05-19",
                                        "temperature_2m_max_f": 77.0,
                                        "temperature_2m_min_f": 62.0,
                                        "precipitation_sum_in": 0.0,
                                    }
                                }
                            },
                        }
                    },
                }
            },
        },
    )
    assert error is None
    assert source is not None
    assert source["summary"]["temperature_2m_max_f"] == 77.0
    assert source["weather_source_station"] == "KMDW"
    assert source["weather_source_scope"] == "station"


def test_weather_paper_candidate_blocks_city_source_station_mismatch():
    generator = load_module("kalshi_weather_paper_candidates_station_mismatch", ROOT / "kalshi_weather_paper_candidates.py")
    spec = generator.WeatherSpec(
        city="DALLAS",
        station="KDAL",
        target_date="2026-05-19",
        market_type="high_temperature",
        threshold=76.0,
        direction="above",
    )
    source, error = generator._source_record_for_spec(
        spec,
        {
            "ok": True,
            "target_dates": {
                "2026-05-19": {
                    "cities": {
                        "DALLAS": {
                            "station": "KDFW",
                            "target_date": "2026-05-19",
                            "sources": {
                                "open_meteo_forecast": {
                                    "summary": {
                                        "date": "2026-05-19",
                                        "temperature_2m_max_f": 83.0,
                                        "temperature_2m_min_f": 62.0,
                                        "precipitation_sum_in": 0.0,
                                    }
                                }
                            },
                        }
                    }
                }
            },
        },
    )
    assert source is None
    assert error == "missing_weather_station_source"


def test_weather_paper_candidate_identifies_missing_source_dates():
    generator = load_module("kalshi_weather_paper_candidates_missing_source_dates", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY20-T76",
        "title": "Will the high temp in Chicago be >76° on May 20, 2026?",
        "city": "CHICAGO",
        "station": "KORD",
        "target_date": "2026-05-20",
        "market_type": "high_temperature",
        "direction": "above",
        "strike_f": 76,
        "status": "active",
        "expected_expiration_time": "2026-05-21T05:00:00Z",
    }
    freshness = {
        "ok": True,
        "target_dates": {
            "2026-05-19": {
                "cities": {
                    "CHICAGO": {
                        "target_date": "2026-05-19",
                        "sources": {
                            "open_meteo_forecast": {
                                "summary": {
                                    "date": "2026-05-19",
                                    "temperature_2m_max_f": 83.0,
                                }
                            }
                        },
                    }
                }
            }
        },
    }
    dates = generator._market_source_dates_needed(
        [market],
        freshness,
        now=datetime(2026, 5, 19, 12, tzinfo=timezone.utc),
        max_hours=48,
    )
    assert dates == ["2026-05-20"]


def test_weather_paper_candidate_shadow_keys_do_not_block_future_accepted_learning():
    generator = load_module("kalshi_weather_paper_candidates_shadow_dedupe", ROOT / "kalshi_weather_paper_candidates.py")
    records = [
        {
            "strategy_bucket": "weather_model_fast_evidence",
            "current_epoch_id": "epoch-test",
            "market_ticker": "KXLOWTDAL-26MAY18-T77",
            "expected_result_known_time_utc": "2026-05-19T19:00:00Z",
            "selected_executable_side": "YES",
            "strategy_governor_action": "SHADOW_ONLY",
            "evidence_tier": "shadow",
            "simulated_size_usd": 0.0,
        }
    ]
    key = ("epoch-test", "KXLOWTDAL-26MAY18-T77", "2026-05-19T19:00:00Z", "YES")
    assert key in generator._existing_keys(records, include_shadow=True)
    assert key not in generator._existing_keys(records, include_shadow=False)


def test_scheduled_learning_lock_skips_alive_owner_before_stale_threshold(monkeypatch, tmp_path):
    scheduled = load_module("kalshi_scheduled_learning_lock_alive_fresh", ROOT / "kalshi_scheduled_learning.py")
    lock_path = tmp_path / "scheduled.lock"
    lock_path.write_text("12345", encoding="utf-8")
    scheduled.os.utime(lock_path, (950.0, 950.0))
    monkeypatch.setattr(scheduled, "LOCK_PATH", lock_path)
    monkeypatch.setattr(scheduled.time, "time", lambda: 1_000.0)
    monkeypatch.setattr(scheduled.os, "kill", lambda pid, sig: None)

    locked, reason = scheduled._acquire_lock(stale_lock_seconds=100)

    assert locked is False
    assert reason == "scheduled learning lock is active (50.0s old)"
    assert lock_path.read_text(encoding="utf-8").strip() == "12345"


def test_scheduled_learning_lock_does_not_steal_alive_owner_after_stale_threshold(monkeypatch, tmp_path):
    scheduled = load_module("kalshi_scheduled_learning_lock_alive_stale", ROOT / "kalshi_scheduled_learning.py")
    lock_path = tmp_path / "scheduled.lock"
    lock_path.write_text("12345", encoding="utf-8")
    scheduled.os.utime(lock_path, (700.0, 700.0))
    monkeypatch.setattr(scheduled, "LOCK_PATH", lock_path)
    monkeypatch.setattr(scheduled.time, "time", lambda: 1_000.0)
    monkeypatch.setattr(scheduled.os, "kill", lambda pid, sig: None)

    locked, reason = scheduled._acquire_lock(stale_lock_seconds=100)

    assert locked is False
    assert reason == (
        "scheduled learning lock owner 12345 is still alive beyond stale threshold "
        "(300.0s old >= 100s); not starting duplicate cycle"
    )
    assert lock_path.read_text(encoding="utf-8").strip() == "12345"


def test_scheduled_learning_lock_reclaims_dead_owner(monkeypatch, tmp_path):
    scheduled = load_module("kalshi_scheduled_learning_lock_dead_owner", ROOT / "kalshi_scheduled_learning.py")
    lock_path = tmp_path / "scheduled.lock"
    lock_path.write_text("12345", encoding="utf-8")
    scheduled.os.utime(lock_path, (700.0, 700.0))
    monkeypatch.setattr(scheduled, "LOCK_PATH", lock_path)
    monkeypatch.setattr(scheduled.time, "time", lambda: 1_000.0)

    def dead_owner(pid, sig):
        raise ProcessLookupError

    monkeypatch.setattr(scheduled.os, "kill", dead_owner)

    locked, reason = scheduled._acquire_lock(stale_lock_seconds=100)

    assert locked is True
    assert reason is None
    assert lock_path.read_text(encoding="utf-8").strip() == str(scheduled.os.getpid())
    scheduled._release_lock()
    assert not lock_path.exists()


def test_weather_paper_candidate_reclaims_dead_pid_lock(monkeypatch, tmp_path):
    generator = load_module("kalshi_weather_paper_candidates_dead_lock", ROOT / "kalshi_weather_paper_candidates.py")
    lock_path = tmp_path / "weather.lock"
    lock_path.write_text("99999999", encoding="utf-8")
    monkeypatch.setattr(generator, "LOCK_PATH", lock_path)
    locked, reason = generator._acquire_lock()
    assert locked is True
    assert reason is None
    assert lock_path.read_text(encoding="utf-8").strip() == str(generator.os.getpid())
    generator._release_lock()
    assert not lock_path.exists()


def test_weather_recovery_probe_candidate_can_restart_tiny_paper_after_baseline_proof():
    generator = load_module("kalshi_weather_recovery_probe_candidate", ROOT / "kalshi_weather_paper_candidates.py")
    router = load_module("kalshi_weather_recovery_probe_router", ROOT / "kalshi_auto_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY10-B76",
        "title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-11T04:00:00Z",
        "updated_time": "2026-05-10T00:00:00Z",
    }
    normalized = {
        "best_yes_ask_cents": 54,
        "best_yes_ask_size_contracts": 40,
        "best_no_ask_cents": 48,
        "best_no_ask_size_contracts": 25,
        "yes_spread_cents": 2,
        "no_spread_cents": 2,
        "is_crossed": False,
        "warnings": [],
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-10",
                "sources": {
                    "open_meteo_forecast": {
                        "fetched_at_utc": "2026-05-10T00:00:00Z",
                        "source_run_key": "2026-05-10T00:00:00Z",
                        "source_hash": "source-hash",
                        "summary": {
                            "date": "2026-05-10",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                            "precipitation_sum_in": 0.0,
                        },
                    }
                },
            }
        },
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        freshness,
        now=generator.datetime(2026, 5, 10, tzinfo=generator.timezone.utc),
        max_hours=48,
        min_edge_after_costs_pct=2.0,
        size_usd=5.0,
        epoch_id="epoch-test",
    )
    assert reason == "created"
    assert candidate is not None
    candidate["expected_result_known_time_utc"] = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    candidate["selective_ml_promotion_stage"] = "tiny_accepted_forward_paper"
    state = {
        "blocked_accepted_paper_categories": ["weather"],
        "blocked_current_side_categories": ["weather"],
        "recovery_probe_enabled": True,
        "recovery_probe_requires_baseline_beating": True,
        "recovery_probe_max_size_usd": 1.0,
        "minimum_edge_after_costs_pct": 2.0,
    }
    governed = router.apply_governor_route(candidate, state)
    assert governed["strategy_governor_action"] == "ACCEPT_EXPLORATION"
    assert governed["paper_recovery_probe"] is True
    assert governed["simulated_size_usd"] == 1.0
    assert governed["live_order_allowed"] is False


def test_weather_paper_candidate_default_edge_gate_is_positive_after_costs():
    generator = load_module("kalshi_weather_paper_candidates_edge_default", ROOT / "kalshi_weather_paper_candidates.py")
    args = generator.build_parser().parse_args([])
    assert args.min_edge_after_costs_pct == 2.0


def test_weather_paper_candidate_loads_parsed_weather_discovery_log(tmp_path):
    generator = load_module("kalshi_weather_paper_candidates_discovery", ROOT / "kalshi_weather_paper_candidates.py")
    log_path = tmp_path / "weather_markets.jsonl"
    log_path.write_text(
        json.dumps(
            {
                "timestamp_utc": "2026-05-11T10:00:00Z",
                "parsed_market_count": 2,
                "trade_parse_ready_count": 1,
                "markets": [
                    {
                        "ticker": "KXHIGHCHI-26MAY11-B76",
                        "title": "Will the **high temp in Chicago** be >76° on May 11, 2026?",
                        "city": "CHICAGO",
                        "station": "KORD",
                        "target_date": "2026-05-11",
                        "market_type": "high_temperature",
                        "direction": "above",
                        "strike_f": 76.0,
                        "is_weather_candidate": True,
                        "is_trade_parse_ready": True,
                        "is_active_market": True,
                    },
                    {
                        "ticker": "KXNBA-GAME",
                        "title": "Unrelated sports market",
                        "is_weather_candidate": False,
                        "is_trade_parse_ready": False,
                        "is_active_market": True,
                    },
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    markets, warnings, metadata = generator._load_latest_weather_discovery(log_path, "temperature")
    assert warnings == []
    assert metadata["market_source"] == "weather_discovery_log"
    assert metadata["matched_market_count"] == 1
    assert markets[0]["ticker"] == "KXHIGHCHI-26MAY11-B76"
    spec = generator.parse_weather_market(markets[0])
    assert spec.city == "CHICAGO"
    assert spec.station == "KORD"
    assert spec.target_date == "2026-05-11"
    assert spec.market_type == "high_temperature"
    assert spec.threshold == 76.0
    assert spec.direction == "above"


def test_weather_series_templates_prioritize_active_learning_targets(tmp_path):
    generator = load_module("kalshi_weather_paper_candidates_target_series", ROOT / "kalshi_weather_paper_candidates.py")
    log_path = tmp_path / "weather_markets.jsonl"
    log_path.write_text(
        json.dumps(
            {
                "timestamp_utc": "2026-05-11T10:00:00Z",
                "markets": [
                    {
                        "ticker": "KXLOWTATL-26MAY11-T68",
                        "title": "Will the low temperature in Atlanta be above 68 on May 11, 2026?",
                        "city": "ATLANTA",
                        "station": "KATL",
                        "market_type": "low_temperature",
                        "raw_market": {"series_ticker": "KXLOWTATL"},
                    },
                    {
                        "ticker": "KXLOWTHOU-26MAY11-T74",
                        "title": "Will the low temperature in Houston be below 74 on May 11, 2026?",
                        "city": "HOUSTON",
                        "station": "KIAH",
                        "market_type": "low_temperature",
                        "raw_market": {"series_ticker": "KXLOWTHOU"},
                    },
                    {
                        "ticker": "KXHIGHTBOS-26MAY11-T80",
                        "title": "Will the high temperature in Boston be above 80 on May 11, 2026?",
                        "city": "BOSTON",
                        "station": "KBOS",
                        "market_type": "high_temperature",
                        "raw_market": {"series_ticker": "KXHIGHTBOS"},
                    },
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    templates, warnings, metadata = generator._series_templates_from_discovery(
        log_path,
        "temperature",
        {
            "weather|HOUSTON|low_temperature|below|yes": {
                "target_type": "ml_frontier_active_learning_target",
                "segment_key": "weather|HOUSTON|low_temperature|below|yes",
                "priority": 2,
                "labels_needed_to_shadow_qualified": 24,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        },
    )
    assert warnings == []
    assert metadata["target_prioritized_series_count"] == 1
    assert templates[0]["series_ticker"] == "KXLOWTHOU"
    assert templates[0]["weather_acceleration_target_segment_key"] == "weather|HOUSTON|low_temperature|below|yes"
    _assert_no_live_true({"templates": templates})


def test_weather_series_templates_include_target_and_rain_when_search_is_narrow(tmp_path):
    generator = load_module("kalshi_weather_paper_candidates_target_rain_series", ROOT / "kalshi_weather_paper_candidates.py")
    log_path = tmp_path / "weather_markets.jsonl"
    log_path.write_text(
        json.dumps(
            {
                "timestamp_utc": "2026-05-11T10:00:00Z",
                "markets": [
                    {
                        "ticker": "KXLOWTHOU-26MAY11-T74",
                        "title": "Will the low temperature in Houston be below 74 on May 11, 2026?",
                        "city": "HOUSTON",
                        "station": "KIAH",
                        "market_type": "low_temperature",
                        "raw_market": {"series_ticker": "KXLOWTHOU"},
                    },
                    {
                        "ticker": "KXRAINCHIM-26MAY-1",
                        "title": "Rain in Chicago in May 2026?",
                        "city": "CHICAGO",
                        "station": "KORD",
                        "target_date": "2026-05-31",
                        "market_type": "precipitation",
                        "direction": "above",
                        "strike_f": 1.0,
                        "raw_market": {"series_ticker": "KXRAINCHIM"},
                    },
                    {
                        "ticker": "KXHIGHTHOU-26MAY11-T88",
                        "title": "Will the maximum temperature be above 88 on May 11, 2026?",
                        "city": "HOUSTON",
                        "station": "KIAH",
                        "market_type": "low_temperature",
                        "raw_market": {"series_ticker": "KXHIGHTHOU"},
                    },
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    templates, warnings, metadata = generator._series_templates_from_discovery(
        log_path,
        "rain",
        {
            "weather|HOUSTON|low_temperature|below|yes": {
                "target_type": "ml_frontier_active_learning_target",
                "segment_key": "weather|HOUSTON|low_temperature|below|yes",
                "priority": 1,
                "labels_needed_to_shadow_qualified": 24,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        },
    )

    by_series = {template["series_ticker"]: template for template in templates}
    assert warnings == []
    assert metadata["target_prioritized_series_count"] == 1
    assert by_series["KXLOWTHOU"]["weather_acceleration_target_segment_key"] == "weather|HOUSTON|low_temperature|below|yes"
    assert by_series["KXRAINCHIM"]["market_type"] == "rain"
    assert "KXHIGHTHOU" not in by_series
    _assert_no_live_true({"templates": templates})


def test_weather_paper_candidate_ignores_stale_direct_discovery_log(tmp_path):
    generator = load_module("kalshi_weather_paper_candidates_stale_discovery", ROOT / "kalshi_weather_paper_candidates.py")
    log_path = tmp_path / "weather_markets.jsonl"
    log_path.write_text(
        json.dumps(
            {
                "timestamp_utc": "2026-05-09T10:00:00Z",
                "markets": [
                    {
                        "ticker": "KXRAINCHI-26MAY09-R1",
                        "title": "Will it rain in Chicago above 0.1 inches on May 9, 2026?",
                        "city": "CHICAGO",
                        "station": "KORD",
                        "target_date": "2026-05-09",
                        "market_type": "rain",
                        "direction": "above",
                        "strike_f": 0.1,
                        "is_weather_candidate": True,
                        "is_trade_parse_ready": True,
                        "is_active_market": True,
                    }
                ],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    markets, warnings, metadata = generator._load_latest_weather_discovery(log_path, "rain", max_age_hours=0)
    assert markets == []
    assert warnings == []
    assert metadata["available"] is False
    assert metadata["stale"] is True
    assert metadata["stale_reason"] == "discovery_log_too_old_for_direct_candidates"


def test_weather_paper_candidate_wraps_current_series_market():
    generator = load_module("kalshi_weather_paper_candidates_series", ROOT / "kalshi_weather_paper_candidates.py")
    raw_market = {
        "ticker": "KXHIGHNY-26MAY12-T73",
        "series_ticker": "KXHIGHNY",
        "event_ticker": "KXHIGHNY-26MAY12",
        "title": "Will the **high temp in NYC** be >73° on May 12, 2026?",
        "status": "active",
        "strike_type": "greater",
        "floor_strike": 73,
        "expected_expiration_time": "2026-05-13T14:00:00Z",
        "close_time": "2026-05-13T04:59:00Z",
    }
    wrapped = generator._wrap_current_series_market(
        raw_market,
        {
            "series_ticker": "KXHIGHNY",
            "city": "NEW YORK",
            "station": "KNYC",
            "market_type": "high_temperature",
        },
    )
    assert wrapped["ticker"] == "KXHIGHNY-26MAY12-T73"
    assert wrapped["city"] == "NEW YORK"
    assert wrapped["target_date"] == "2026-05-12"
    assert wrapped["direction"] == "above"
    assert wrapped["strike_f"] == 73.0
    assert wrapped["is_active_market"] is True
    assert generator.parse_weather_market(wrapped).city == "NEW YORK"


def test_weather_paper_candidate_maximum_title_overrides_bad_template_type():
    generator = load_module("kalshi_weather_paper_candidates_series_maximum", ROOT / "kalshi_weather_paper_candidates.py")
    raw_market = {
        "ticker": "KXHIGHTATL-26MAY13-T78",
        "series_ticker": "KXHIGHTATL",
        "event_ticker": "KXHIGHTATL-26MAY13",
        "title": "Will the maximum temperature be  <78\u00b0 on May 13, 2026?",
        "status": "active",
        "strike_type": "less",
        "cap_strike": 78,
        "expected_expiration_time": "2026-05-14T19:00:00Z",
    }
    wrapped = generator._wrap_current_series_market(
        raw_market,
        {
            "series_ticker": "KXHIGHTATL",
            "city": "ATLANTA",
            "station": "KATL",
            "market_type": "low_temperature",
        },
    )
    assert wrapped["market_type"] == "high_temperature"
    assert generator.parse_weather_market(wrapped).market_type == "high_temperature"


def test_weather_paper_candidate_parses_minimum_and_maximum_titles():
    generator = load_module("kalshi_weather_paper_candidates_title_extremes", ROOT / "kalshi_weather_paper_candidates.py")
    high = generator.parse_weather_market(
        {
            "ticker": "KXHIGHATL-26MAY13-T78",
            "title": "Will the maximum temperature in Atlanta be below 78° on May 13, 2026?",
        }
    )
    low = generator.parse_weather_market(
        {
            "ticker": "KXLOWBOS-26MAY13-T54",
            "title": "Will the minimum temperature in Boston be above 54° on May 13, 2026?",
        }
    )
    assert high is not None
    assert high.city == "ATLANTA"
    assert high.market_type == "high_temperature"
    assert high.direction == "below"
    assert low is not None
    assert low.city == "BOSTON"
    assert low.market_type == "low_temperature"
    assert low.direction == "above"


def test_weather_paper_candidate_live_search_filters_non_weather(monkeypatch):
    generator = load_module("kalshi_weather_paper_candidates_live_search", ROOT / "kalshi_weather_paper_candidates.py")
    calls = []

    def fake_get(_path, params):
        calls.append(dict(params))
        return {
            "ok": True,
            "data": {
                "markets": [
                    {
                        "ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S2026",
                        "title": "yes Over 2.5 goals scored",
                        "status": "active",
                    },
                    {
                        "ticker": "KXRAINCHI-26MAY13-R1",
                        "title": "Will it rain in Chicago above 0.1 inches on May 13, 2026?",
                        "status": "active",
                        "expected_expiration_time": "2026-05-14T05:00:00Z",
                    },
                ],
                "cursor": "",
            },
        }

    monkeypatch.setattr(generator, "kalshi_get", fake_get)
    markets, cursor, warnings, metadata = generator._fetch_live_weather_search_markets(
        Namespace(limit=10, status="open", search="rain", max_pages=1, live_city_search_limit=0, live_search_max_terms=3)
    )
    assert [market["ticker"] for market in markets] == ["KXRAINCHI-26MAY13-R1"]
    assert cursor == ""
    assert warnings == []
    assert metadata["raw_market_count"] == 6
    assert metadata["matched_market_count"] == 1
    assert all(call["search"] in {"rain", "precipitation", "weather"} for call in calls)


def test_weather_paper_candidate_live_search_uses_target_term_filter(monkeypatch):
    generator = load_module("kalshi_weather_paper_candidates_live_search_target_term", ROOT / "kalshi_weather_paper_candidates.py")
    calls = []
    temperature_market = {
        "ticker": "KXHIGHCHI-26MAY13-B76",
        "title": "Will Chicago's high be above 76 on May 13, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-14T05:00:00Z",
    }

    def fake_get(_path, params):
        calls.append(dict(params))
        return {
            "ok": True,
            "data": {
                "markets": [temperature_market] if params.get("search") == "chicago high temperature" else [],
                "cursor": "",
            },
        }

    monkeypatch.setattr(generator, "kalshi_get", fake_get)
    markets, cursor, warnings, metadata = generator._fetch_live_weather_search_markets(
        Namespace(limit=10, status="open", search="rain", max_pages=1, live_city_search_limit=0, live_search_max_terms=4),
        acceleration_targets={
            "weather|CHICAGO|high_temperature|above|yes": {
                "target_type": "ml_frontier_active_learning_target",
                "segment_key": "weather|CHICAGO|high_temperature|above|yes",
                "priority": 1,
                "live_order_allowed": False,
            }
        },
    )

    assert [market["ticker"] for market in markets] == ["KXHIGHCHI-26MAY13-B76"]
    assert cursor == ""
    assert warnings == []
    assert [call["search"] for call in calls] == ["rain", "precipitation", "weather", "chicago high temperature"]
    assert metadata["raw_market_count"] == 1
    assert metadata["matched_market_count"] == 1


def test_weather_paper_candidate_live_search_includes_bounded_city_terms():
    generator = load_module("kalshi_weather_paper_candidates_city_terms", ROOT / "kalshi_weather_paper_candidates.py")
    terms = generator._live_weather_search_terms("rain", city_limit=2, max_terms=8)
    assert terms == [
        "rain",
        "precipitation",
        "weather",
        "atlanta rain",
        "atlanta precipitation",
        "austin rain",
        "austin precipitation",
    ]


def test_weather_paper_candidate_live_search_prioritizes_ml_frontier_targets():
    generator = load_module("kalshi_weather_paper_candidates_target_terms", ROOT / "kalshi_weather_paper_candidates.py")
    terms = generator._live_weather_search_terms(
        "temperature",
        city_limit=1,
        max_terms=10,
        acceleration_targets={
            "weather|HOUSTON|low_temperature|below|yes": {
                "target_type": "ml_frontier_active_learning_target",
                "segment_key": "weather|HOUSTON|low_temperature|below|yes",
                "priority": 2,
                "labels_needed_to_shadow_qualified": 24,
                "live_order_allowed": False,
            }
        },
    )
    assert "houston low temperature" in terms
    assert terms.index("houston low temperature") < terms.index("atlanta temperature")
    _assert_no_live_true({"targets": terms})


def test_weather_paper_candidate_live_search_triggers_when_series_is_due_heavy():
    generator = load_module("kalshi_weather_paper_candidates_due_heavy_search", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY15-T76",
        "title": "Will the high temperature in Chicago be above 76° on May 15, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-16T05:00:00Z",
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-15",
                "sources": {
                    "open_meteo_forecast": {
                        "summary": {
                            "date": "2026-05-15",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                        }
                    }
                },
            }
        },
    }
    required, reason, summary = generator._live_search_required_by_series_quality(
        [market],
        freshness,
        "temperature",
        now=generator.datetime(2026, 5, 17, tzinfo=generator.timezone.utc),
        max_hours=24.0,
    )
    assert required is True
    assert reason == "series_refresh_has_no_upcoming_clean_candidates"
    assert summary["checked_market_count"] == 1
    assert summary["clean_upcoming_market_count"] == 0
    assert summary["precheck_reasons"] == {"result_time_already_due": 1}


def test_weather_paper_candidate_live_search_skips_when_series_has_clean_upcoming_market():
    generator = load_module("kalshi_weather_paper_candidates_clean_series_search", ROOT / "kalshi_weather_paper_candidates.py")
    market = {
        "ticker": "KXHIGHCHI-26MAY17-T76",
        "title": "Will the high temperature in Chicago be above 76° on May 17, 2026?",
        "status": "active",
        "expected_expiration_time": "2026-05-18T05:00:00Z",
    }
    freshness = {
        "ok": True,
        "cities": {
            "CHICAGO": {
                "target_date": "2026-05-17",
                "sources": {
                    "open_meteo_forecast": {
                        "summary": {
                            "date": "2026-05-17",
                            "temperature_2m_max_f": 82.0,
                            "temperature_2m_min_f": 61.0,
                        }
                    }
                },
            }
        },
    }
    required, reason, summary = generator._live_search_required_by_series_quality(
        [market],
        freshness,
        "temperature",
        now=generator.datetime(2026, 5, 17, 12, tzinfo=generator.timezone.utc),
        max_hours=24.0,
    )
    assert required is False
    assert reason == "series_refresh_sufficient"
    assert summary["checked_market_count"] == 1
    assert summary["clean_upcoming_market_count"] == 1
    assert summary["precheck_reasons"] == {}


def test_weather_paper_candidate_generic_fallback_filters_non_weather():
    generator = load_module("kalshi_weather_paper_candidates_fallback_filter", ROOT / "kalshi_weather_paper_candidates.py")
    markets = generator._filter_parseable_weather_markets(
        [
            {
                "ticker": "KXMVESPORTSMULTIGAMEEXTENDED-S2026",
                "title": "yes Over 2.5 goals scored",
                "status": "active",
            },
            {
                "ticker": "KXHIGHCHI-26MAY13-T76",
                "title": "Will the high temperature in Chicago be above 76° on May 13, 2026?",
                "status": "active",
            },
        ],
        "temperature",
    )
    assert [market["ticker"] for market in markets] == ["KXHIGHCHI-26MAY13-T76"]


def test_inverse_first_candidate_uses_yes_ask_when_no_ask_not_executable():
    generator = load_module("kalshi_inverse_first_candidates_yes_fallback", ROOT / "kalshi_inverse_first_candidates.py")
    market = {
        "ticker": "KXNBAGAME-26MAY11DETCLE-DET",
        "title": "Will Detroit win?",
        "status": "active",
        "expected_expiration_time": "2099-01-01T03:00:00Z",
        "updated_time": "2026-05-11T00:00:00Z",
    }
    normalized = {
        "best_no_ask_cents": None,
        "best_no_ask_size_contracts": 0,
        "best_yes_ask_cents": 46,
        "best_yes_ask_size_contracts": 22,
        "best_no_bid_cents": 54,
        "yes_spread_cents": 3,
        "is_crossed": False,
        "warnings": [],
    }
    candidate, reason = generator._candidate_from_market(
        market,
        normalized,
        now=generator.datetime(2026, 5, 11, tzinfo=generator.timezone.utc),
        max_hours=700000,
        size_usd=1.0,
    )
    assert reason == "created"
    assert candidate is not None
    assert candidate["decision"] == "PAPER_INVERSE_FORWARD_BUY_YES"
    assert candidate["selected_executable_side"] == "YES"
    assert candidate["original_strategy_side"] == "NO"
    assert candidate["inverse_executable_price_cents"] == 46
    assert candidate["inverse_executable_price_source"] == "current_orderbook_implied_yes_ask"
    assert candidate["depth_contracts"] == 22
    assert candidate["side_flexible_forward_paper"] is True
    assert candidate["clean_evidence"]["clean_evidence_passed"] is True
    assert candidate["live_order_allowed"] is False


def test_inverse_first_candidate_sorts_soonest_result_first():
    generator = load_module("kalshi_inverse_first_candidates_sort", ROOT / "kalshi_inverse_first_candidates.py")
    now = generator.datetime(2026, 5, 11, tzinfo=generator.timezone.utc)
    markets = [
        {"ticker": "SLOW", "expected_expiration_time": "2026-05-12T00:00:00Z"},
        {"ticker": "MISSING"},
        {"ticker": "FAST", "expected_expiration_time": "2026-05-11T02:00:00Z"},
    ]
    ordered = sorted(markets, key=lambda market: generator._market_sort_key(market, now))
    assert [market["ticker"] for market in ordered] == ["FAST", "SLOW", "MISSING"]


def test_inverse_first_candidate_fetches_multiple_market_pages(monkeypatch):
    generator = load_module("kalshi_inverse_first_candidates_pages", ROOT / "kalshi_inverse_first_candidates.py")
    calls = []

    def fake_get(_path, params):
        calls.append(dict(params))
        if "cursor" not in params:
            return {"ok": True, "data": {"markets": [{"ticker": "ONE"}], "cursor": "next"}}
        return {"ok": True, "data": {"markets": [{"ticker": "TWO"}], "cursor": ""}}

    monkeypatch.setattr(generator, "kalshi_get", fake_get)
    markets, cursor, warnings, response = generator._fetch_market_pages(
        Namespace(limit=1, status="open", search="sports", max_pages=3)
    )
    assert [market["ticker"] for market in markets] == ["ONE", "TWO"]
    assert calls == [{"limit": 1, "status": "open", "search": "sports"}, {"limit": 1, "status": "open", "search": "sports", "cursor": "next"}]
    assert cursor == ""
    assert warnings == []
    assert response["ok"] is True


def test_inverse_first_candidate_rejects_snapshot_price_without_depth():
    generator = load_module("kalshi_inverse_first_candidates_no_depth", ROOT / "kalshi_inverse_first_candidates.py")
    market = {
        "ticker": "KXNBAGAME-26MAY11DETCLE-DET",
        "title": "Will Detroit win?",
        "status": "active",
        "expected_expiration_time": "2099-01-01T03:00:00Z",
        "no_ask_dollars": "0.4200",
    }
    candidate, reason = generator._candidate_from_market(
        market,
        {"best_no_ask_cents": None, "best_no_ask_size_contracts": 0, "is_crossed": False},
        now=generator.datetime(2026, 5, 11, tzinfo=generator.timezone.utc),
        max_hours=700000,
        size_usd=1.0,
    )
    assert candidate is None
    assert reason == "missing_inverse_executable_depth"


def test_orderbook_normalization_derives_implied_asks():
    orderbook = load_module("kalshi_orderbook", ROOT / "kalshi_orderbook.py")
    result = orderbook.normalize_orderbook(
        {
            "orderbook": {
                "yes": [[40, 10], [45, 5], [45, 2]],
                "no": [[50, 3], [52, 4]],
            }
        }
    )
    assert result["best_yes_bid_cents"] == 45
    assert result["best_no_bid_cents"] == 52
    assert result["best_yes_ask_cents"] == 48
    assert result["best_no_ask_cents"] == 55
    assert result["best_no_ask_size_contracts"] == 7
    assert result["best_yes_ask_size_contracts"] == 4
    assert result["yes_depth_contracts"] == 17
    assert result["no_depth_contracts"] == 7
    assert "yes:duplicate_price_merged" in result["warnings"]


def test_orderbook_normalization_supports_fractional_dollar_book():
    orderbook = load_module("kalshi_orderbook_fp", ROOT / "kalshi_orderbook.py")
    result = orderbook.normalize_orderbook(
        {
            "orderbook_fp": {
                "yes_dollars": [],
                "no_dollars": [["0.4980", "19.00"], ["0.6740", "53.00"], ["0.6750", "19.00"]],
            }
        }
    )
    assert result["best_no_bid_cents"] == 68
    assert result["best_yes_ask_cents"] == 32
    assert result["no_depth_contracts"] == 91
    assert result["is_two_sided"] is False


def test_strategy_governor_routes_without_live_authority():
    governor = load_module("kalshi_strategy_governor", ROOT / "kalshi_strategy_governor.py")
    result = governor.run(
        Namespace(
            decisions_log=str(ROOT / "logs" / "paper_decisions.jsonl"),
            state_path=str(ROOT / "logs" / "paper_strategy_state.json"),
            events_log=str(ROOT / "logs" / "strategy_governor_events.jsonl"),
            limit=5,
            skip_log=True,
        )
    )
    assert result["live_order_allowed"] is False
    assert isinstance(result["action_counts"], dict)


def test_profit_firewall_keeps_learning_active_for_losing_lanes(tmp_path):
    firewall = load_module("kalshi_profit_firewall_learning_policy", ROOT / "kalshi_profit_firewall.py")
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    baseline_path = tmp_path / "baseline.json"
    dashboard_path.write_text(
        json.dumps(
            {
                "performance_summary": {
                    "category_accuracy": {
                        "sports": {
                            "scored": 40,
                            "wins": 8,
                            "losses": 32,
                            "accuracy": 0.2,
                            "pnl": -12.5,
                        }
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    baseline_path.write_text(json.dumps({"by_category": []}), encoding="utf-8")
    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            minimum_scored=30,
            accuracy_floor=0.45,
            shadow_only=True,
        )
    )
    lane = result["lanes"][0]
    assert result["paper_trading_paused"] is False
    assert result["shadow_learning_enabled"] is True
    assert result["bounded_exploration_for_blocked_lanes_enabled"] is True
    assert result["proof_metrics_exclude_exploration"] is True
    assert lane["status"] == "shadow_only"
    assert lane["accepted_proof_allowed"] is False
    assert lane["bounded_exploration_allowed"] is True
    assert lane["shadow_learning_allowed"] is True
    assert lane["live_order_allowed"] is False


def test_auto_candidate_shadows_market_implied_exploration_for_blocked_lane():
    router = load_module("kalshi_auto_paper_candidates_blocked_market_implied", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-1",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXNBA-TEST",
        "market_title": "NBA test market winner",
        "market_category": "sports",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "market_implied_baseline",
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 48,
        "paper_fill_price_cents": 48,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["sports"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["proof_metrics_exclude_exploration"] is True
    assert result["supreme_trading_strategy"]["route"].startswith("STS_")
    assert result["supreme_trading_strategy"]["live_order_allowed"] is False
    assert result["live_order_allowed"] is False


def test_auto_candidate_allows_external_edge_exploration_for_blocked_lane():
    router = load_module("kalshi_auto_paper_candidates_blocked_external_edge", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-external-1",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-TEST",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.6,
        "edge_after_costs_pct": 3.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 48,
        "paper_fill_price_cents": 48,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["weather"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "ACCEPT_EXPLORATION"
    assert result["source_type"] == "weather_model"
    assert result["edge_after_costs"] == 3.0
    assert result["model_confidence_score"] == 0.6
    assert result["baseline_beating_passed"] is True
    assert result["live_order_allowed"] is False


def test_auto_candidate_shadows_external_edge_without_baseline_beating_proof():
    router = load_module("kalshi_auto_paper_candidates_external_edge_requires_baseline", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-external-no-baseline",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-NOBASE",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.8,
        "edge_after_costs_pct": 7.0,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 42,
        "paper_fill_price_cents": 42,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["baseline_beating_passed"] is False
    assert "baseline-beating proof" in result["plain_english_reason"]
    governed = router.apply_governor_route(record, state)
    assert governed["decision"].startswith("SHADOW_")
    assert governed["simulated_size_usd"] == 0.0
    assert governed["supreme_trading_strategy"]["can_override_governor"] is False
    assert governed["supreme_trading_strategy"]["auto_live_promotion_allowed"] is False
    assert governed["live_order_allowed"] is False


def test_auto_candidate_rejects_legacy_baseline_shortcut_without_full_baselines():
    router = load_module("kalshi_auto_paper_candidates_legacy_baseline_shortcut", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-legacy-baseline-only",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-LEGACY",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.8,
        "edge_after_costs_pct": 7.0,
        "baseline_beating_signal": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 42,
        "paper_fill_price_cents": 42,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    result = router.route_candidate(record, {"minimum_edge_after_costs_pct": 2.0})
    assert result["action"] == "SHADOW_ONLY"
    assert result["baseline_beating_passed"] is False
    assert "market, random-side, and no-trade baselines" in result["plain_english_reason"]
    assert result["live_order_allowed"] is False


def test_auto_candidate_shadows_low_model_confidence_candidate():
    router = load_module("kalshi_auto_paper_candidates_low_model_confidence", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-low-confidence",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-LOWCONF",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.12,
        "edge_after_costs_pct": 6.0,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 43,
        "paper_fill_price_cents": 43,
        "depth_contracts": 80,
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
        "bounded_exploration_for_blocked_lanes_enabled": True,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["minimum_model_confidence_score"] == 0.30
    assert result["model_confidence_passed"] is False
    assert "Model confidence score is 0.12" in result["plain_english_reason"]
    governed = router.apply_governor_route(record, state)
    assert governed["simulated_size_usd"] == 0.0
    assert governed["live_order_allowed"] is False


def test_auto_candidate_shadows_weather_when_settlement_repair_required():
    router = load_module("kalshi_auto_paper_candidates_weather_repair_gate", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-weather-repair",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-REPAIR",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.9,
        "edge_after_costs_pct": 12.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "weather_accepted_paper_repair_required": True,
        "weather_accepted_paper_blockers": ["settlement_parse_gap"],
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["weather_repair_passed"] is False
    assert "settlement_parse_gap" in result["plain_english_reason"]
    governed = router.apply_governor_route(record, state)
    assert governed["decision"].startswith("SHADOW_")
    assert governed["simulated_size_usd"] == 0.0
    assert governed["live_order_allowed"] is False


def test_auto_candidate_allows_weather_with_explicit_settlement_verification():
    router = load_module("kalshi_auto_paper_candidates_weather_repair_verified", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-weather-repair-verified",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-VERIFIED",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "weather_settlement_parse_verified": True,
        "model_confidence_score": 0.9,
        "edge_after_costs_pct": 12.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "weather_accepted_paper_repair_required": True,
        "weather_accepted_paper_blockers": ["settlement_parse_gap"],
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "ACCEPT_EXPLORATION"
    assert result["weather_repair_passed"] is True
    assert result["live_order_allowed"] is False


def test_auto_candidate_shadows_weather_when_calibration_repair_required():
    router = load_module("kalshi_auto_paper_candidates_weather_calibration_gate", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-weather-calibration",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-CALIBRATION",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "weather_settlement_parse_verified": True,
        "model_confidence_score": 0.9,
        "edge_after_costs_pct": 12.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "weather_accepted_paper_repair_required": True,
        "weather_accepted_paper_blockers": ["weather_probability_miscalibration"],
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["weather_repair_passed"] is False
    assert "weather_probability_miscalibration" in result["plain_english_reason"]
    assert "calibration verification" in result["plain_english_reason"]


def test_auto_candidate_allows_weather_when_required_repairs_are_verified():
    router = load_module("kalshi_auto_paper_candidates_weather_all_repairs_verified", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-weather-all-verified",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-ALL-VERIFIED",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "weather_settlement_parse_verified": True,
        "weather_probability_calibration_verified": True,
        "model_confidence_score": 0.9,
        "edge_after_costs_pct": 12.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "weather_accepted_paper_repair_required": True,
        "weather_accepted_paper_blockers": ["settlement_parse_gap", "weather_probability_miscalibration"],
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "ACCEPT_EXPLORATION"
    assert result["weather_repair_passed"] is True
    assert result["live_order_allowed"] is False


def test_auto_candidate_rejects_before_cost_edge_without_after_cost_edge():
    router = load_module("kalshi_auto_paper_candidates_after_cost_required", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-before-cost-only",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXNBA-TEST-EDGE",
        "market_title": "NBA test market winner",
        "market_category": "sports",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "polymarket_reference_price",
        "external_reference_edge_cents": 5.0,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 48,
        "paper_fill_price_cents": 48,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["sports"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["edge_after_costs"] is None
    assert "requires a measured edge after costs" in result["plain_english_reason"]
    assert result["live_order_allowed"] is False


def test_auto_candidate_blocks_forward_proof_for_blocked_lane():
    router = load_module("kalshi_auto_paper_candidates_blocked_forward", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-2",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXNBA-TEST2",
        "market_title": "NBA test market winner",
        "market_category": "sports",
        "decision": "PAPER_BUY_YES",
        "evidence_tier": "forward_paper",
        "fair_value_source_type": "market_implied_baseline",
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 48,
        "paper_fill_price_cents": 48,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["sports"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["live_order_allowed"] is False


def test_auto_candidate_shadows_non_inverse_when_inverse_lane_enabled():
    router = load_module("kalshi_auto_paper_candidates_inverse_guard", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-3",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXNBA-TEST3",
        "market_title": "NBA test market winner",
        "market_category": "sports",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "market_implied_baseline",
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 48,
        "paper_fill_price_cents": 48,
        "depth_contracts": 50,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["sports"],
        "inverse_forward_test_categories": ["sports"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    governed = router.apply_governor_route(record, state)
    assert governed["decision"].startswith("SHADOW_")
    assert governed["simulated_size_usd"] == 0.0
    assert governed["strategy_governor_action"] == "SHADOW_ONLY"
    assert governed["live_order_allowed"] is False


def test_auto_candidate_uses_segment_policy_for_crypto_inverse_forward(tmp_path, monkeypatch):
    router = load_module("kalshi_auto_segment_policy_inverse", ROOT / "kalshi_auto_paper_candidates.py")
    policy_path = tmp_path / "sts_segment_policy_model.json"
    policy_path.write_text(json.dumps({
        "profit_selector_tiny_forward_segments": [
            {
                "segment_key": "crypto|SOL|crypto_price_threshold|yes",
                "domain": "crypto",
                "selected_policy": "inverse_selected_side",
                "qualified_for_tiny_forward_paper": True,
                "fresh_forward_outcomes_collected": 141,
                "fresh_forward_pnl_usd": 10.85,
                "test_accuracy": 0.847561,
                "test_pnl_units": 14.09,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(router, "STS_SEGMENT_POLICY_MODEL_PATH", policy_path)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    record = {
        "decision_id": "candidate-sol-segment-policy",
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "source_observed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_fetched_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_hashes": ["spot", "market", "book"],
        "mode": "PAPER_ONLY",
        "market_ticker": "KXSOL15M-TEST",
        "market_title": "SOL price up in next 15 mins?",
        "market_category": "crypto",
        "decision": "PAPER_BUY_YES",
        "selected_executable_side": "YES",
        "side": "YES",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "expected_result_known_time_utc": (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
        "crypto_evidence": {"asset": "SOL", "market_type": "crypto_price_threshold", "spot_observed_at_utc": now.isoformat().replace("+00:00", "Z")},
        "market_price_cents": 35,
        "paper_fill_price_cents": 35,
        "paper_side_options": [
            {"side": "YES", "price_cents": 35, "depth_contracts": 50, "spread_cents": 3},
            {"side": "NO", "price_cents": 67, "depth_contracts": 80, "spread_cents": 3},
        ],
        "depth_contracts": 50,
        "spread_cents": 3,
        "edge_after_costs_pct": 4.0,
        "model_confidence_score": 0.8,
        "quality_gates": {"crypto_model_quality_passed": True, "live_order_allowed": False},
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "live_order_allowed": False,
    }

    routed = router.apply_governor_route(record, {"minimum_edge_after_costs_pct": 2.0})

    assert routed["strategy_governor_action"] == "INVERSE_FORWARD_TEST"
    assert routed["side"] == "NO"
    assert routed["decision"] == "INVERSE_FORWARD_TEST_BUY_NO"
    assert routed["paper_fill_price_cents"] == 67
    assert routed["evidence_tier"] == "forward_paper"
    assert routed["proof_metrics_exclude_exploration"] is False
    assert routed["sts_segment_policy_proof"]["selected_policy"] == "inverse_selected_side"
    assert routed["live_order_allowed"] is False


def test_auto_candidate_applies_segment_policy_abstention(tmp_path, monkeypatch):
    router = load_module("kalshi_auto_segment_policy_abstention", ROOT / "kalshi_auto_paper_candidates.py")
    policy_path = tmp_path / "sts_segment_policy_model.json"
    policy_path.write_text(json.dumps({
        "abstention_segments": [
            {
                "segment_key": "crypto|SOL|crypto_price_threshold|yes",
                "domain": "crypto",
                "abstention_required": True,
                "abstention_reasons": ["active_policy_underperforms_no_trade_pnl"],
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(router, "STS_SEGMENT_POLICY_MODEL_PATH", policy_path)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    record = {
        "decision_id": "candidate-sol-segment-policy-abstain",
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "source_observed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_fetched_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_hashes": ["spot", "market", "book"],
        "market_ticker": "KXSOL15M-TEST",
        "market_title": "SOL price up in next 15 mins?",
        "market_category": "crypto",
        "selected_executable_side": "YES",
        "side": "YES",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "expected_result_known_time_utc": (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
        "crypto_evidence": {"asset": "SOL", "market_type": "crypto_price_threshold", "spot_observed_at_utc": now.isoformat().replace("+00:00", "Z")},
        "market_price_cents": 35,
        "paper_fill_price_cents": 35,
        "paper_side_options": [
            {"side": "YES", "price_cents": 35, "depth_contracts": 50, "spread_cents": 3},
            {"side": "NO", "price_cents": 67, "depth_contracts": 80, "spread_cents": 3},
        ],
        "depth_contracts": 50,
        "spread_cents": 3,
        "edge_after_costs_pct": 4.0,
        "model_confidence_score": 0.8,
        "quality_gates": {"crypto_model_quality_passed": True, "live_order_allowed": False},
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "live_order_allowed": False,
    }

    routed = router.apply_governor_route(record, {"minimum_edge_after_costs_pct": 2.0})

    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["simulated_size_usd"] == 0.0
    assert routed["strategy_governor_route"]["segment_policy_abstention"]["abstention_required"] is True
    assert "STS segment policy requires abstention" in routed["strategy_governor_reason"]
    assert routed["live_order_allowed"] is False


def test_auto_candidate_blocks_segment_policy_without_current_baselines(tmp_path, monkeypatch):
    router = load_module("kalshi_auto_segment_policy_requires_baselines", ROOT / "kalshi_auto_paper_candidates.py")
    policy_path = tmp_path / "sts_segment_policy_model.json"
    policy_path.write_text(json.dumps({
        "profit_selector_tiny_forward_segments": [
            {
                "segment_key": "crypto|SOL|crypto_price_threshold|yes",
                "domain": "crypto",
                "selected_policy": "inverse_selected_side",
                "qualified_for_tiny_forward_paper": True,
                "fresh_forward_outcomes_collected": 141,
                "fresh_forward_pnl_usd": 10.85,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(router, "STS_SEGMENT_POLICY_MODEL_PATH", policy_path)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    record = {
        "decision_id": "candidate-sol-segment-policy-no-baseline",
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "source_observed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_fetched_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_hashes": ["spot", "market", "book"],
        "market_ticker": "KXSOL15M-TEST",
        "market_title": "SOL price up in next 15 mins?",
        "market_category": "crypto",
        "selected_executable_side": "YES",
        "side": "YES",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "expected_result_known_time_utc": (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
        "crypto_evidence": {"asset": "SOL", "market_type": "crypto_price_threshold", "spot_observed_at_utc": now.isoformat().replace("+00:00", "Z")},
        "paper_side_options": [
            {"side": "YES", "price_cents": 35, "depth_contracts": 50, "spread_cents": 3},
            {"side": "NO", "price_cents": 67, "depth_contracts": 80, "spread_cents": 3},
        ],
        "edge_after_costs_pct": 4.0,
        "model_confidence_score": 0.8,
        "quality_gates": {"crypto_model_quality_passed": True, "live_order_allowed": False},
        "beats_market_baseline": False,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "live_order_allowed": False,
    }

    routed = router.apply_governor_route(record, {"minimum_edge_after_costs_pct": 2.0})

    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["strategy_governor_route"]["segment_policy_forward_allowed"] is False
    assert routed["live_order_allowed"] is False


def test_auto_candidate_shadows_inverse_when_fresh_inverse_is_frozen():
    router = load_module("kalshi_auto_paper_candidates_frozen_inverse", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-frozen-inverse",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXNBA-FROZEN-INVERSE",
        "market_title": "NBA test market winner",
        "market_category": "sports",
        "decision": "INVERSE_FORWARD_TEST",
        "evidence_tier": "forward_paper",
        "paper_experiment_type": "inverse_forward_test",
        "inverse_strategy_applied": True,
        "fair_value_source_type": "polymarket_reference_price",
        "edge_after_costs_pct": 8.0,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 42,
        "paper_fill_price_cents": 42,
        "depth_contracts": 80,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["sports"],
        "inverse_forward_test_categories": ["sports"],
        "frozen_inverse_categories": ["sports"],
        "inverse_expansion_allowed": False,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert "failing the proof gate" in result["plain_english_reason"]
    assert result["proof_metrics_exclude_exploration"] is True
    governed = router.apply_governor_route(record, state)
    assert governed["decision"].startswith("SHADOW_")
    assert governed["simulated_size_usd"] == 0.0
    assert governed["live_order_allowed"] is False


def test_auto_candidate_blocks_all_accepted_notional_for_blocked_accepted_category():
    router = load_module("kalshi_auto_paper_candidates_blocked_accepted", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-blocked-accepted",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-BLOCKED",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "edge_after_costs_pct": 12.0,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "live_order_allowed": False,
    }
    state = {
        "blocked_accepted_paper_categories": ["weather"],
        "blocked_current_side_categories": ["weather"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert "accepted paper exposure is frozen" in result["plain_english_reason"]
    assert result["proof_metrics_exclude_exploration"] is True
    assert result["live_order_allowed"] is False


def test_auto_candidate_allows_weather_focus_exploration_when_inverse_is_frozen():
    router = load_module("kalshi_auto_paper_candidates_focus_exploration", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-weather-focus",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-FOCUS",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.6,
        "edge_after_costs_pct": 4.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 43,
        "paper_fill_price_cents": 43,
        "depth_contracts": 80,
        "live_order_allowed": False,
    }
    state = {
        "blocked_current_side_categories": ["weather"],
        "frozen_inverse_categories": ["weather"],
        "inverse_expansion_allowed": False,
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "ACCEPT_EXPLORATION"
    assert result["proof_metrics_exclude_exploration"] is True
    assert result["live_order_allowed"] is False


def test_auto_candidate_allows_clean_baseline_beating_recovery_probe_for_blocked_category():
    router = load_module("kalshi_auto_paper_candidates_recovery_probe", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-recovery-probe",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-RECOVERY",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.8,
        "edge_after_costs_pct": 12.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "simulated_size_usd": 5.0,
        "live_order_allowed": False,
    }
    state = {
        "blocked_accepted_paper_categories": ["weather"],
        "blocked_current_side_categories": ["weather"],
        "bounded_exploration_for_blocked_lanes_enabled": True,
        "recovery_probe_enabled": True,
        "recovery_probe_requires_baseline_beating": True,
        "recovery_probe_max_size_usd": 1.0,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "ACCEPT_EXPLORATION"
    assert result["is_recovery_probe"] is True
    assert "recovery probe accepted" in result["plain_english_reason"]
    assert result["proof_metrics_exclude_exploration"] is True
    assert result["live_order_allowed"] is False
    governed = router.apply_governor_route(record, state)
    assert governed["paper_recovery_probe"] is True
    assert governed["simulated_size_usd"] == 1.0
    assert governed["proof_metrics_exclude_exploration"] is True
    assert governed["live_order_allowed"] is False


def test_auto_candidate_respects_candidate_clean_evidence_window_for_weather_recovery_probe():
    router = load_module("kalshi_auto_paper_candidates_recovery_probe_window", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=30)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-recovery-probe-48h",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXLOWTDAL-RECOVERY",
        "market_title": "Will the minimum temperature in Dallas be above 77 on May 18, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.7,
        "edge_after_costs_pct": 3.0,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "baseline_comparison": {
            "minimum_edge_after_costs_pct": -5.0,
            "beats_market_baseline": True,
        },
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 47,
        "paper_fill_price_cents": 47,
        "depth_contracts": 1,
        "simulated_size_usd": 5.0,
        "clean_evidence": {
            "clean_evidence_passed": True,
            "max_hours": 48.0,
            "blockers": [],
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }
    state = {
        "blocked_accepted_paper_categories": ["weather"],
        "blocked_current_side_categories": ["weather"],
        "recovery_probe_enabled": True,
        "recovery_probe_requires_baseline_beating": True,
        "recovery_probe_max_size_usd": 1.0,
        "minimum_edge_after_costs_pct": 2.0,
    }
    governed = router.apply_governor_route(record, state)
    assert governed["strategy_governor_action"] == "ACCEPT_EXPLORATION"
    assert governed["paper_recovery_probe"] is True
    assert governed["simulated_size_usd"] == 1.0
    assert governed["live_order_allowed"] is False


def test_auto_candidate_candidate_threshold_cannot_weaken_profit_floor():
    router = load_module("kalshi_auto_paper_candidates_profit_floor", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-weak-edge-floor",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-FLOOR",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_WEATHER_MODEL_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "edge_after_costs_pct": 0.5,
        "baseline_beating_signal": True,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "baseline_comparison": {
            "minimum_edge_after_costs_pct": -5.0,
            "beats_market_baseline": True,
        },
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 47,
        "paper_fill_price_cents": 47,
        "depth_contracts": 50,
        "simulated_size_usd": 1.0,
        "clean_evidence": {
            "clean_evidence_passed": True,
            "max_hours": 24.0,
            "blockers": [],
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }
    state = {
        "minimum_edge_after_costs_pct": 2.0,
        "bounded_exploration_for_blocked_lanes_enabled": True,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["minimum_edge_after_costs"] == 2.0
    assert "below the required 2.00" in result["plain_english_reason"]
    governed = router.apply_governor_route(record, state)
    assert governed["simulated_size_usd"] == 0.0
    assert governed["live_order_allowed"] is False


def test_auto_candidate_rejects_recovery_probe_without_baseline_beating_signal():
    router = load_module("kalshi_auto_paper_candidates_recovery_probe_requires_baseline", ROOT / "kalshi_auto_paper_candidates.py")
    expected_result = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    record = {
        "decision_id": "candidate-recovery-no-baseline",
        "timestamp_utc": "2026-05-15T12:00:00Z",
        "mode": "PAPER_ONLY",
        "market_ticker": "KXHIGHCHI-RECOVERY-NOBASE",
        "market_title": "Will the high temperature in Chicago be above 76 on May 10, 2026?",
        "market_category": "weather",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "evidence_tier": "exploration",
        "paper_exploration": True,
        "fair_value_source_type": "weather_model",
        "model_confidence_score": 0.8,
        "edge_after_costs_pct": 12.0,
        "expected_result_known_time_utc": expected_result,
        "market_price_cents": 40,
        "paper_fill_price_cents": 40,
        "depth_contracts": 100,
        "simulated_size_usd": 5.0,
        "live_order_allowed": False,
    }
    state = {
        "blocked_accepted_paper_categories": ["weather"],
        "recovery_probe_enabled": True,
        "recovery_probe_requires_baseline_beating": True,
        "minimum_edge_after_costs_pct": 2.0,
    }
    result = router.route_candidate(record, state)
    assert result["action"] == "SHADOW_ONLY"
    assert result["is_recovery_probe"] is False
    assert "baseline-beating proof" in result["plain_english_reason"]
    governed = router.apply_governor_route(record, state)
    assert governed["decision"].startswith("SHADOW_")
    assert governed["simulated_size_usd"] == 0.0
    assert governed["live_order_allowed"] is False


def test_paper_log_and_self_improvement_are_read_only():
    paper_log = load_module("kalshi_paper_log", ROOT / "kalshi_paper_log.py")
    self_improvement = load_module("kalshi_self_improvement", ROOT / "kalshi_self_improvement.py")
    log_result = paper_log.validate(Namespace(decisions_log=str(ROOT / "logs" / "paper_decisions.jsonl")))
    improve_result = self_improvement.analyze(Namespace(dashboard_data=str(ROOT / "dashboard" / "kalshi_dashboard_data.json"), events_log=str(ROOT / "logs" / "self_improvement_events.jsonl")))
    assert log_result["live_order_allowed"] is False
    assert improve_result["live_order_allowed"] is False
    assert all(item["auto_apply_allowed"] is False for item in improve_result["recommendations"])


def test_self_improvement_pauses_failing_fresh_inverse(tmp_path):
    self_improvement = load_module("kalshi_self_improvement_fresh_inverse", ROOT / "kalshi_self_improvement.py")
    dashboard_path = tmp_path / "dashboard.json"
    events_path = tmp_path / "events.jsonl"
    dashboard_path.write_text(
        json.dumps(
            {
                "performance_summary": {"scored_accepted_trades": 43, "accuracy": 0.14, "paper_pnl_usd": -10.0},
                "baseline_scorecard": {"inverse_beats_current": True},
                "profit_firewall": {"blocked_current_side_categories": ["weather"]},
                "forward_paper_proof": {
                    "inverse_forward_test": {
                        "scored": 43,
                        "accuracy": 0.14,
                        "paper_pnl_usd": -1.33,
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    result = self_improvement.analyze(Namespace(dashboard_data=str(dashboard_path), events_log=str(events_path)))
    assert result["recommendations"][0]["type"] == "pause_strategy_bucket"
    assert result["recommendations"][0]["auto_apply_allowed"] is False
    assert result["live_order_allowed"] is False


def test_weather_sources_url_and_payload_hash_are_stable():
    weather_sources = load_module("kalshi_weather_sources", ROOT / "kalshi_weather_sources.py")
    city = weather_sources.CITY_WATCHLIST["CHICAGO"]
    url = weather_sources._forecast_url(city, "2026-05-10")
    assert "api.open-meteo.com" in url
    assert "temperature_2m_max" in url
    assert weather_sources._sha({"b": 2, "a": 1}) == weather_sources._sha({"a": 1, "b": 2})


def test_weather_sources_open_meteo_batch_url_and_payloads_are_stable():
    weather_sources = load_module("kalshi_weather_sources_batch", ROOT / "kalshi_weather_sources.py")
    selected = [
        ("CHICAGO", weather_sources.CITY_WATCHLIST["CHICAGO"]),
        ("DALLAS", weather_sources.CITY_WATCHLIST["DALLAS"]),
    ]
    url = weather_sources._forecast_batch_url(selected, "2026-05-10")
    assert "api.open-meteo.com" in url
    assert "latitude=41.8781,32.7767" in url
    assert "longitude=-87.6298,-96.797" in url
    payloads = weather_sources._forecast_batch_payloads(
        [
            {"daily": {"time": ["2026-05-10"]}},
            {"daily": {"time": ["2026-05-10"]}},
        ],
        2,
    )
    assert len(payloads) == 2


def test_weather_sources_station_url_and_coordinates_are_stable():
    weather_sources = load_module("kalshi_weather_sources_station_helpers", ROOT / "kalshi_weather_sources.py")
    assert weather_sources._nws_station_url("kdal").endswith("/stations/KDAL")
    assert weather_sources._station_coordinates({"geometry": {"coordinates": [-96.8518, 32.8471]}}) == (32.8471, -96.8518)
    assert weather_sources._station_coordinates({"geometry": {"coordinates": []}}) is None


def test_weather_sources_nws_hourly_fallback_can_make_city_fresh():
    weather_sources = load_module("kalshi_weather_sources_nws_hourly", ROOT / "kalshi_weather_sources.py")
    summary = weather_sources._summarize_nws_hourly(
        {
            "properties": {
                "periods": [
                    {
                        "startTime": "2026-05-10T01:00:00-05:00",
                        "temperature": 71,
                        "temperatureUnit": "F",
                        "probabilityOfPrecipitation": {"value": 20},
                    },
                    {
                        "startTime": "2026-05-10T15:00:00-05:00",
                        "temperature": 84,
                        "temperatureUnit": "F",
                        "probabilityOfPrecipitation": {"value": 50},
                    },
                    {
                        "startTime": "2026-05-11T01:00:00-05:00",
                        "temperature": 65,
                        "temperatureUnit": "F",
                        "probabilityOfPrecipitation": {"value": 10},
                    },
                ]
            }
        },
        "2026-05-10",
    )
    assert summary["temperature_2m_max_f"] == 84
    assert summary["temperature_2m_min_f"] == 71
    assert summary["precipitation_probability_max_pct"] == 50
    fresh_source = {"fetched_at_epoch": time.time(), "ttl_seconds": 300}
    assert weather_sources._city_sources_are_fresh({"sources": {"nws_points": fresh_source, "nws_hourly_forecast": fresh_source}})


def test_weather_sources_city_refresh_preserves_station_cache(monkeypatch, tmp_path):
    weather_sources = load_module("kalshi_weather_sources_preserve_station_cache", ROOT / "kalshi_weather_sources.py")
    freshness_path = tmp_path / "weather_source_freshness.json"
    warmups_path = tmp_path / "weather_source_warmups.jsonl"
    freshness_path.write_text(
        json.dumps(
            {
                "stations": {
                    "KDAL": {
                        "station": "KDAL",
                        "target_date": "2026-05-10",
                        "sources": {"open_meteo_forecast": {"summary": {"date": "2026-05-10"}}},
                    }
                },
                "target_dates": {
                    "2026-05-10": {
                        "stations": {
                            "KDAL": {
                                "station": "KDAL",
                                "target_date": "2026-05-10",
                                "sources": {"open_meteo_forecast": {"summary": {"date": "2026-05-10"}}},
                            }
                        }
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(weather_sources, "FRESHNESS_PATH", freshness_path)
    monkeypatch.setattr(weather_sources, "WARMUPS_PATH", warmups_path)
    monkeypatch.setattr(weather_sources, "_fetch_json", lambda url: {"daily": {"time": ["2026-05-10"], "temperature_2m_max": [82.0], "temperature_2m_min": [61.0], "precipitation_sum": [0.0]}} if "open-meteo" in url else {"properties": {"gridId": "LOT"}})
    result = weather_sources.refresh_sources(
        Namespace(
            limit=1,
            target_date="2026-05-10",
            near_resolution=True,
            force=True,
        )
    )
    assert "KDAL" in result["stations"]
    assert "KDAL" in result["target_dates"]["2026-05-10"]["stations"]


def test_weather_candidates_use_nws_hourly_forecast_fallback():
    candidates = load_module("kalshi_weather_candidates_nws_fallback", ROOT / "kalshi_weather_paper_candidates.py")
    spec = candidates.WeatherSpec(
        city="CHICAGO",
        station="KORD",
        target_date="2026-05-10",
        market_type="high_temperature",
        threshold=80.0,
        direction="above",
    )
    source, error = candidates._source_record_for_spec(
        spec,
        {
            "cities": {
                "CHICAGO": {
                    "city": "CHICAGO",
                    "station": "KORD",
                    "target_date": "2026-05-10",
                    "sources": {
                        "nws_hourly_forecast": {
                            "source_name": "nws_hourly_forecast",
                            "summary": {"date": "2026-05-10", "temperature_2m_max_f": 83.0},
                        }
                    },
                }
            }
        },
    )
    assert error is None
    assert source["source_name"] == "nws_hourly_forecast"


def test_opportunity_engine_logs_inverse_opportunity(tmp_path):
    engine = load_module("kalshi_opportunity_engine", ROOT / "kalshi_opportunity_engine.py")
    events_path = tmp_path / "events.jsonl"
    result = engine.run(Namespace(events_log=str(events_path), minimum_scored=1))
    assert result["live_order_allowed"] is False
    assert events_path.exists()


def test_profit_firewall_blocks_losing_exact_model_lane(tmp_path):
    firewall = load_module("kalshi_profit_firewall_model_lane", ROOT / "kalshi_profit_firewall.py")
    decisions_path = tmp_path / "decisions.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    dashboard_path = tmp_path / "dashboard.json"
    state_path = tmp_path / "state.json"
    events_path = tmp_path / "events.jsonl"
    baseline_path = tmp_path / "baseline.json"
    proof_path = tmp_path / "proof.json"
    epoch_path = tmp_path / "epoch.json"

    started_at = datetime(2026, 5, 18, 12, tzinfo=timezone.utc)
    epoch_path.write_text(json.dumps({"started_at_utc": started_at.isoformat().replace("+00:00", "Z")}), encoding="utf-8")
    dashboard_path.write_text(json.dumps({"performance_summary": {"category_accuracy": {}}, "epoch": {}}), encoding="utf-8")
    baseline_path.write_text(json.dumps({"by_category": []}), encoding="utf-8")
    proof_path.write_text(json.dumps({}), encoding="utf-8")
    decisions = []
    outcomes = []
    for index in range(5):
        decision_id = f"crypto-lane-loss-{index}"
        decisions.append(
            {
                "decision_id": decision_id,
                "timestamp_utc": (started_at + timedelta(minutes=index)).isoformat().replace("+00:00", "Z"),
                "decision": "PAPER_EXPLORE_BUY_YES",
                "market_ticker": f"KXBTC-LOSS-{index}",
                "market_title": "Will Bitcoin be above $100,000 today?",
                "market_category": "crypto",
                "strategy_bucket": "crypto_spot_model",
                "fair_value_source_type": "crypto_spot_volatility_model",
                "selected_executable_side": "YES",
                "simulated_size_usd": 1.0,
                "paper_fill_price_cents": 60,
                "live_order_allowed": False,
            }
        )
        outcomes.append(
            {
                "decision_id": decision_id,
                "resolved": True,
                "outcome_yes": 0,
                "live_order_allowed": False,
            }
        )
    decisions_path.write_text("\n".join(json.dumps(item) for item in decisions) + "\n", encoding="utf-8")
    outcomes_path.write_text("\n".join(json.dumps(item) for item in outcomes) + "\n", encoding="utf-8")

    result = firewall.evaluate(
        Namespace(
            dashboard_data=str(dashboard_path),
            state_path=str(state_path),
            events_log=str(events_path),
            baseline_scorecard=str(baseline_path),
            strategy_proof_diagnosis=str(proof_path),
            decisions_log=str(decisions_path),
            outcomes_log=str(outcomes_path),
            epoch_state=str(epoch_path),
            minimum_scored=30,
            minimum_model_lane_scored=5,
            accuracy_floor=0.45,
            shadow_only=True,
        )
    )

    key = "crypto|crypto_spot_model|crypto_spot_volatility_model|YES"
    assert key in result["blocked_model_lanes"]
    assert result["blocked_model_lanes"][key]["scored"] == 5
    assert result["blocked_model_lanes"][key]["paper_pnl_usd"] == -5.0
    assert result["blocked_model_lanes"][key]["live_order_allowed"] is False
    assert result["model_lane_policy"]["live_order_allowed"] is False


def test_auto_router_shadows_blocked_exact_model_lane():
    router = load_module("kalshi_auto_router_model_lane", ROOT / "kalshi_auto_paper_candidates.py")
    expected = datetime.now(timezone.utc) + timedelta(hours=1)
    candidate = {
        "decision_id": "crypto-blocked-lane-candidate",
        "decision": "PAPER_EXPLORE_BUY_YES",
        "market_ticker": "KXBTC-BLOCKED-LANE",
        "market_title": "Will Bitcoin be above $100,000 today?",
        "market_category": "crypto",
        "strategy_bucket": "crypto_spot_model",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "selected_executable_side": "YES",
        "side": "YES",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "depth_contracts": 100,
        "edge_after_costs_pct": 9.0,
        "expected_result_known_time_utc": expected.isoformat().replace("+00:00", "Z"),
        "simulated_size_usd": 1.0,
        "crypto_model_confidence_score": 0.8,
        "quality_gates": {
            "crypto_model_quality_passed": True,
            "baseline_comparison_passed": True,
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "baseline_comparison": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "live_order_allowed": False,
    }
    state = {
        "blocked_model_lanes": {
            "crypto|crypto_spot_model|crypto_spot_volatility_model|YES": {
                "plain_english_reason": "This exact model, source, and side is losing.",
                "live_order_allowed": False,
            }
        },
        "accepted_paper_required_source_types": ["crypto_spot_volatility_model"],
        "minimum_edge_after_costs_pct": 2.0,
    }

    routed = router.apply_governor_route(candidate, state)
    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["strategy_governor_route"]["model_lane_key"] == "crypto|crypto_spot_model|crypto_spot_volatility_model|YES"
    assert routed["strategy_governor_route"]["model_lane_passed"] is False
    assert routed["simulated_size_usd"] == 0.0
    assert routed["evidence_tier"] == "shadow"
    assert routed["live_order_allowed"] is False


def test_auto_router_allows_small_exploration_for_weather_focus_blocked_lane():
    router = load_module("kalshi_auto_router_model_lane", ROOT / "kalshi_auto_paper_candidates.py")
    expected = datetime.now(timezone.utc) + timedelta(hours=1)
    candidate = {
        "decision_id": "weather-focus-exploration",
        "decision": "PAPER_EXPLORE_BUY_NO",
        "market_ticker": "KXWEATHER-FOCUS",
        "market_title": "Austin tomorrow low temp below 75?",
        "market_category": "weather",
        "strategy_bucket": "weather_model_fast_evidence",
        "fair_value_source_type": "weather_model",
        "selected_executable_side": "NO",
        "side": "NO",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "depth_contracts": 120,
        "edge_after_costs_pct": 3.0,
        "expected_result_known_time_utc": expected.isoformat().replace("+00:00", "Z"),
        "simulated_size_usd": 1.0,
        "weather_model_calibration_verified": True,
        "weather_settlement_verification_passed": True,
        "quality_gates": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "baseline_comparison": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "live_order_allowed": False,
    }
    state = {
        "blocked_model_lanes": {
            "weather|weather_model_fast_evidence|weather_model|NO": {
                "plain_english_reason": "Weather lane is currently negative with weak margins.",
                "average_pnl_usd": -0.5,
                "accuracy": 0.69,
                "scored": 26,
                "live_order_allowed": False,
            }
        },
        "accepted_paper_required_source_types": ["weather_model"],
        "minimum_edge_after_costs_pct": 2.0,
        "minimum_model_lane_scored": 5,
        "rapid_learning_focus_categories": ["weather", "crypto"],
        "rapid_learning_focus_policy": {
            "plain_english": "Focus-lane exploration is explicitly enabled for learning speed.",
        },
    }

    routed = router.apply_governor_route(candidate, state)
    assert routed["strategy_governor_action"] == "ACCEPT_EXPLORATION"
    assert routed["strategy_governor_route"]["action"] == "ACCEPT_EXPLORATION"
    assert routed["strategy_governor_route"]["model_lane_key"] == "weather|weather_model_fast_evidence|weather_model|NO"
    assert routed["strategy_governor_route"]["model_lane_passed"] is False
    assert routed["paper_exploration"] is True
    assert routed["evidence_tier"] == "exploration"
    assert routed["simulated_size_usd"] == 1.0


def test_dashboard_accelerator_reports_route_mix_for_weather_crypto_learning():
    dashboard = load_module("kalshi_dashboard_route_mix", ROOT / "kalshi_dashboard.py")

    active_decisions = [
        {
            "decision_id": "acc-weather-1",
            "decision": "PAPER_EXPLORE_BUY_YES",
            "market_category": "weather",
            "market_ticker": "KXWEATHER-1",
            "paper_exploration": True,
            "simulated_size_usd": 1.0,
            "evidence_tier": "exploration",
            "live_order_allowed": False,
        },
        {
            "decision_id": "acc-weather-2",
            "decision": "PAPER_BUY_YES",
            "market_category": "weather",
            "market_ticker": "KXWEATHER-2",
            "simulated_size_usd": 2.0,
            "live_order_allowed": False,
            "evidence_tier": "forward_paper",
        },
        {
            "decision_id": "acc-crypto-1",
            "decision": "PAPER_BUY_NO",
            "market_category": "crypto",
            "market_ticker": "KXBTC-1",
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
            "evidence_tier": "forward_paper",
        },
        {
            "decision_id": "acc-sports-1",
            "decision": "PAPER_EXPLORE_BUY_NO",
            "market_category": "sports",
            "market_ticker": "KXSOCCER-1",
            "paper_exploration": True,
            "simulated_size_usd": 1.0,
            "live_order_allowed": False,
        },
    ]
    result = dashboard._paper_trade_accelerator(
        active_decisions,
        weather_crypto_ml_dataset={"row_count": 7},
        learning_velocity={"resolved_last_1h": 4},
        crypto_readiness={"next_crypto_learning_snapshot_check_time_utc": "2026-05-28T23:00:00Z", "next_crypto_trade_ready_check_time_utc": "2026-05-28T23:00:00Z", "next_crypto_learning_check_reason": "fixture"},
        weather_source_freshness={"ok": True},
        strategy_weighting={"weight_type": "paper_learning_attention_not_live_risk"},
    )
    route_mix = result["route_mix"]
    assert route_mix["overall"]["ACCEPT_EXPLORATION"] == 2
    assert route_mix["overall"]["FORWARD_PAPER"] == 2
    assert route_mix["weather_crypto"]["ACCEPT_EXPLORATION"] == 1
    assert route_mix["weather_crypto"]["FORWARD_PAPER"] == 2
    route_mix_total = result["route_mix_total"]
    assert route_mix_total["overall"]["ACCEPT_EXPLORATION"] == 0.5
    assert route_mix_total["overall"]["FORWARD_PAPER"] == 0.5
    assert route_mix_total["weather_crypto"]["ACCEPT_EXPLORATION"] == round(1 / 3, 6)
    assert route_mix_total["weather_crypto"]["FORWARD_PAPER"] == round(2 / 3, 6)


def test_clean_evidence_accepts_polyclaw_skill_scan_source():
    clean = load_module("kalshi_clean_evidence_polyclaw_source", ROOT / "kalshi_clean_evidence.py")
    expected = datetime.now(timezone.utc) + timedelta(hours=3)
    result = clean.validate_record(
        {
            "decision_id": "polyclaw-clean-source",
            "decision": "PAPER_EXPLORE_BUY_NO",
            "market_ticker": "KXSOCCER-POLYCLAW",
            "market_title": "Will Team A win the soccer match?",
            "market_category": "sports",
            "strategy_bucket": "polyclaw",
            "fair_value_source_type": "polyclaw_skill_market_scan",
            "selected_executable_side": "NO",
            "side": "NO",
            "paper_fill_price_cents": 30,
            "depth_contracts": 100,
            "expected_result_known_time_utc": expected.isoformat().replace("+00:00", "Z"),
            "live_order_allowed": False,
        },
        max_hours=24,
    )

    assert result["clean_evidence_passed"] is True
    assert result["recommended_route"] == "ACCEPT_EXPLORATION"
    assert result["live_order_allowed"] is False


def test_promoted_exact_model_lane_can_enter_forward_paper():
    router = load_module("kalshi_auto_router_promoted_lane", ROOT / "kalshi_auto_paper_candidates.py")
    expected = datetime.now(timezone.utc) + timedelta(hours=3)
    candidate = {
        "decision_id": "polyclaw-promoted-lane-candidate",
        "decision": "PAPER_EXPLORE_BUY_NO",
        "market_ticker": "KXSOCCER-PROMOTED",
        "market_title": "Will Team A win the soccer match?",
        "market_category": "sports",
        "strategy_bucket": "polyclaw",
        "fair_value_source_type": "polyclaw_skill_market_scan",
        "selected_executable_side": "NO",
        "side": "NO",
        "paper_fill_price_cents": 30,
        "market_price_cents": 30,
        "depth_contracts": 100,
        "edge_after_costs_pct": 8.0,
        "expected_result_known_time_utc": expected.isoformat().replace("+00:00", "Z"),
        "simulated_size_usd": 5.0,
        "quality_gates": {
            "baseline_comparison_passed": True,
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "baseline_comparison": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "live_order_allowed": False,
    }
    state = {
        "blocked_accepted_paper_categories": ["sports"],
        "blocked_model_lanes": {},
        "promoted_model_lanes": {
            "sports|polyclaw|polyclaw_skill_market_scan|NO": {
                "plain_english_reason": "This exact PolyClaw NO lane is profitable enough for tiny forward-paper proof.",
                "live_order_allowed": False,
            }
        },
        "minimum_edge_after_costs_pct": 2.0,
        "recovery_probe_enabled": True,
        "recovery_probe_requires_baseline_beating": True,
        "blocked_lane_exploration_max_size_usd": 1.0,
    }

    routed = router.apply_governor_route(candidate, state)
    assert routed["strategy_governor_action"] == "ACCEPT_FORWARD_PAPER"
    assert routed["strategy_governor_route"]["model_lane_promoted"] is True
    assert routed["strategy_governor_route"]["model_lane_key"] == "sports|polyclaw|polyclaw_skill_market_scan|NO"
    assert routed["evidence_tier"] == "forward_paper"
    assert routed["paper_exploration"] is False
    assert routed["simulated_size_usd"] == 1.0
    assert routed["live_order_allowed"] is False


def test_unpromoted_polyclaw_skill_scan_stays_shadow_only():
    router = load_module("kalshi_auto_router_unpromoted_polyclaw", ROOT / "kalshi_auto_paper_candidates.py")
    expected = datetime.now(timezone.utc) + timedelta(hours=3)
    candidate = {
        "decision_id": "polyclaw-unpromoted-lane-candidate",
        "decision": "PAPER_EXPLORE_BUY_NO",
        "market_ticker": "KXSOCCER-UNPROMOTED",
        "market_title": "Will Team A win the soccer match?",
        "market_category": "sports",
        "strategy_bucket": "polyclaw",
        "fair_value_source_type": "polyclaw_skill_market_scan",
        "selected_executable_side": "NO",
        "side": "NO",
        "paper_fill_price_cents": 30,
        "market_price_cents": 30,
        "depth_contracts": 100,
        "edge_after_costs_pct": 8.0,
        "expected_result_known_time_utc": expected.isoformat().replace("+00:00", "Z"),
        "simulated_size_usd": 1.0,
        "quality_gates": {
            "baseline_comparison_passed": True,
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "baseline_comparison": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "live_order_allowed": False,
    }
    state = {
        "blocked_accepted_paper_categories": ["sports"],
        "blocked_model_lanes": {},
        "promoted_model_lanes": {},
        "minimum_edge_after_costs_pct": 2.0,
        "recovery_probe_enabled": True,
        "recovery_probe_requires_baseline_beating": True,
    }

    routed = router.apply_governor_route(candidate, state)
    assert routed["strategy_governor_action"] == "SHADOW_ONLY"
    assert routed["strategy_governor_route"]["model_lane_promoted"] is False
    assert routed["simulated_size_usd"] == 0.0
    assert routed["live_order_allowed"] is False

def test_dashboard_aggregates_recent_weather_candidate_runs():
    dashboard = load_module("kalshi_dashboard_weather_candidate_aggregate", ROOT / "kalshi_dashboard.py")
    records = [
        {
            "timestamp_utc": "2026-05-26T20:00:00Z",
            "created_count": 2,
            "created_by_governor_action": {"SHADOW_ONLY": 2},
            "markets_seen": 10,
            "orderbooks_checked": 4,
            "skipped_reasons": {"missing_weather_executable_price": 3},
            "warnings": ["a"],
            "critical_failures": [],
        },
        {
            "timestamp_utc": "2026-05-26T20:05:00Z",
            "created_count": 1,
            "created_by_governor_action": {"ACCEPT_EXPLORATION": 1},
            "markets_seen": 20,
            "orderbooks_checked": 5,
            "skipped_reasons": {"result_time_already_due": 7},
            "warnings": ["a", "b"],
            "critical_failures": [],
        },
    ]

    aggregate = dashboard._aggregate_recent_weather_candidate_runs(records)

    assert aggregate["created_count"] == 3
    assert aggregate["created_by_governor_action"] == {"ACCEPT_EXPLORATION": 1, "SHADOW_ONLY": 2}
    assert aggregate["markets_seen"] == 30
    assert aggregate["orderbooks_checked"] == 9
    assert aggregate["skipped_reasons"] == {"missing_weather_executable_price": 3, "result_time_already_due": 7}
    assert aggregate["recent_weather_candidate_run_count"] == 2
    assert aggregate["live_order_allowed"] is False


def test_weather_candidate_default_window_is_48_hours():
    generator = load_module("kalshi_weather_paper_candidates_default_window", ROOT / "kalshi_weather_paper_candidates.py")
    args = generator.build_parser().parse_args([])
    assert args.max_hours == 48.0


def test_market_telemetry_collects_orderbook_price_path_and_universe(tmp_path, monkeypatch):
    telemetry = load_module("kalshi_market_telemetry_test", ROOT / "kalshi_market_telemetry.py")
    decisions_log = tmp_path / "decisions.jsonl"
    decisions_log.write_text(
        json.dumps(
            {
                "decision_id": "telemetry-1",
                "timestamp_utc": "2026-05-27T12:00:00Z",
                "market_ticker": "KXBTC15M-TEST",
                "market_category": "crypto",
                "strategy_bucket": "crypto_spot_model",
                "fair_value_source_type": "crypto_spot_volatility_model",
                "selected_executable_side": "YES",
                "side": "YES",
                "paper_fill_price_cents": 40,
                "market_price_cents": 40,
                "crypto_evidence": {"asset": "BTC", "threshold_usd": 100000, "spot_observed_at_utc": "2026-05-27T11:59:00Z", "spot_provider": "fixture"},
                "strategy_governor_action": "SHADOW_ONLY",
                "strategy_governor_reason": "fixture shadow",
                "strategy_governor_route": {"baseline_beating_passed": False, "model_confidence_passed": True, "crypto_model_quality_passed": True},
                "live_order_allowed": False,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    def fake_get(path, params=None):
        assert path == "/markets/KXBTC15M-TEST/orderbook"
        return {
            "ok": True,
            "request": {"path": path},
            "data": {"orderbook": {"yes": [[39, 100], [38, 50]], "no": [[59, 80], [58, 30]]}},
            "meta": {"warnings": []},
        }

    monkeypatch.setattr(telemetry, "kalshi_get", fake_get)
    args = Namespace(
        decisions_log=str(decisions_log),
        snapshots_log=str(tmp_path / "snapshots.jsonl"),
        price_paths_log=str(tmp_path / "paths.jsonl"),
        candidate_universe_log=str(tmp_path / "universe.jsonl"),
        ladder_surfaces_log=str(tmp_path / "ladders.jsonl"),
        output=str(tmp_path / "latest.json"),
        limit=10,
        top_levels=2,
        dry_run=False,
    )

    result = telemetry.run(args)

    assert result["snapshot_count"] == 1
    assert result["price_path_count"] == 1
    assert result["candidate_universe_count"] == 1
    assert result["live_order_allowed"] is False
    snapshot = json.loads((tmp_path / "snapshots.jsonl").read_text().splitlines()[0])
    assert isinstance(snapshot["normalized_orderbook"], dict)
    assert snapshot["yes_top_levels"][0] == {"price_cents": 39, "contracts": 100}
    path = json.loads((tmp_path / "paths.jsonl").read_text().splitlines()[0])
    assert path["weak_label_only"] is True
    assert path["counts_for_live_readiness"] is False
    universe = json.loads((tmp_path / "universe.jsonl").read_text().splitlines()[0])
    assert universe["governor_action"] == "SHADOW_ONLY"


def test_weather_crypto_dataset_includes_market_telemetry_features(tmp_path, monkeypatch):
    dataset = load_module("kalshi_ml_dataset_telemetry_test", ROOT / "kalshi_weather_crypto_ml_dataset.py")
    decision = {
        "decision_id": "telemetry-dataset-1",
        "timestamp_utc": "2026-05-27T12:00:00Z",
        "market_ticker": "KXBTC15M-TEST",
        "market_category": "crypto",
        "strategy_bucket": "crypto_spot_model",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "selected_executable_side": "YES",
        "side": "YES",
        "paper_fill_price_cents": 40,
        "market_price_cents": 40,
        "expected_result_known_time_utc": "2026-05-27T12:15:00Z",
        "source_observed_at_utc": "2026-05-27T11:59:00Z",
        "crypto_evidence": {"asset": "BTC", "threshold_usd": 100000, "spot_observed_at_utc": "2026-05-27T11:59:00Z", "spot_provider": "fixture"},
        "series_ticker": "KXBTC15M",
        "live_order_allowed": False,
    }
    outcome = {"decision_id": "telemetry-dataset-1", "resolved": True, "outcome_yes": 1, "settlement_checked_at_utc": "2026-05-27T12:16:00Z", "settlement_source": "fixture"}
    snapshot_path = tmp_path / "snapshots.jsonl"
    path_path = tmp_path / "paths.jsonl"
    universe_path = tmp_path / "universe.jsonl"
    snapshot_path.write_text(json.dumps({"decision_id": "telemetry-dataset-1", "observed_at_utc": "2026-05-27T12:01:00Z", "selected_side_market_price_cents": 44, "orderbook_imbalance": 0.25, "normalized_orderbook": {"yes_depth_contracts": 100, "no_depth_contracts": 80, "best_yes_bid_cents": 43, "best_yes_ask_cents": 44, "is_two_sided": True, "is_crossed": False}}) + "\n", encoding="utf-8")
    path_path.write_text(json.dumps({"decision_id": "telemetry-dataset-1", "elapsed_minutes": 1, "price_delta_cents": 4, "early_direction_correct": True}) + "\n", encoding="utf-8")
    universe_path.write_text(json.dumps({"decision_id": "telemetry-dataset-1", "accepted_paper": False, "rejection_reasons": ["shadow"]}) + "\n", encoding="utf-8")
    monkeypatch.setattr(dataset, "MARKET_SNAPSHOTS_PATH", snapshot_path)
    monkeypatch.setattr(dataset, "PRICE_PATHS_PATH", path_path)
    monkeypatch.setattr(dataset, "CANDIDATE_UNIVERSE_PATH", universe_path)

    payload, rows = dataset.build_dataset([decision], [outcome], [], generated_at_utc="2026-05-27T12:17:00Z")

    assert payload["telemetry_feature_rows"] == 1
    assert payload["weak_price_path_label_rows"] == 1
    features = rows[0]["features"]
    assert features["telemetry_snapshot_present"] == 1
    assert features["telemetry_selected_side_market_price_cents"] == 44
    assert features["price_path_delta_cents"] == 4
    assert features["candidate_universe_rejection_reason_count"] == 1


def test_sts_trading_dashboard_excludes_shadow_only_routes():
    dashboard = load_module("kalshi_dashboard_sts_trading", ROOT / "kalshi_dashboard.py")
    sts = {
        "ok": True,
        "status": "learning",
        "mode": "PAPER_ONLY",
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
        "risk": {"primary_blocker": "forward_paper_proof_blocked", "governor_final_authority": True, "blockers": ["forward_paper_proof_blocked"]},
        "performance": {"market_baseline_retained": True, "champion_status": "market_champion_retained"},
        "learning": {"leakage_rejected_count": 0, "sts_feature_rows": 10, "weather_crypto_dataset_rows": 10},
        "objective_scores": {"profitability": 0},
        "data_health": {"domain_diagnostics": [], "feature_rows_summary": {"leakage_rejected_count": 0}},
        "next_action": "keep learning",
    }
    result = dashboard._sts_trading_dashboard_snapshot(
        supreme_trading_strategy=sts,
        decisions=[
            {
                "decision_id": "shadow-1",
                "timestamp_utc": "2026-05-27T00:00:00Z",
                "supreme_trading_strategy": {"route": "STS_SHADOW_ONLY"},
                "side": "YES",
            }
        ],
        outcomes=[{"decision_id": "shadow-1", "resolved": True, "outcome_yes": 1, "paper_pnl_usd": 1.0}],
        now_text="2026-05-27T00:01:00Z",
    )
    assert result["summary"]["acceptance_state"] == "shadow_only_learning"
    assert result["summary"]["can_accept_sts_paper"] is False
    assert result["summary"]["top_blocker"] == "forward_paper_proof_blocked"
    assert result["directed_paper"]["resolved_trades"] == 0
    assert result["directed_paper"]["win_rate"] is None
    assert result["directed_paper"]["pnl_usd"] is None
    assert result["readiness_gates"][2]["gate_id"] == "data_leakage"
    assert result["readiness_gates"][2]["status"] == "passed"
    assert result["readiness_gates"][3]["gate_id"] == "market_baseline"
    assert result["readiness_gates"][3]["status"] == "blocked"
    _assert_no_live_true(result)


def _sts_positive_weather_candidate(index: int = 0) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "decision_id": f"sts-positive-weather-{index}",
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "source_observed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "expected_result_known_time_utc": (now + timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
        "market_category": "weather",
        "market_ticker": f"KXHIGHNY-{index}",
        "market_title": "Will the high temperature be above 70?",
        "side": "YES",
        "fair_value_source_type": "weather_model",
        "strategy_bucket": "weather_model",
        "simulated_size_usd": 5,
        "paper_fill_price_cents": 40,
        "edge_after_costs_pct": 8.0 + index,
        "model_confidence_score": 0.75,
        "depth_contracts": 100,
        "spread_cents": 2,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "baseline_comparison": {
            "selected_side_fair_probability": 0.64,
            "market_implied_probability": 0.40,
            "weather_calibration_abstention_required": False,
            "weather_calibration_acceptance_passed": True,
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
            "live_order_allowed": False,
        },
        "quality_gates": {
            "weather_probability_calibration_verified": True,
            "weather_model_calibration_verified": True,
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
            "live_order_allowed": False,
        },
        "weather_settlement_parse_verified": True,
        "weather_probability_calibration_verified": True,
        "strategy_taxonomy": {"domain": "weather"},
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }




def test_crypto_clean_evidence_accepts_repaired_lineage_fields():
    clean = load_module("kalshi_clean_evidence_crypto_lineage", ROOT / "kalshi_clean_evidence.py")
    record = {
        "decision_id": "crypto-spot-test",
        "market_ticker": "KXSOL15M-26MAY272000-30",
        "market_title": "SOL price up in next 15 mins?",
        "market_category": "crypto",
        "side": "NO",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "expected_result_known_time_utc": (datetime.now(timezone.utc) + timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "paper_fill_price_cents": 25,
        "depth_contracts": 100,
        "source_fetched_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_observed_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_hashes": ["abc123"],
        "live_order_allowed": False,
    }

    result = clean.validate_record(record)

    assert result["taxonomy"]["domain"] == "crypto"
    assert result["taxonomy"]["side"] == "NO"
    assert "unknown_taxonomy_domain" not in result["blockers"]
    assert "missing_crypto_source_hash" not in result["blockers"]
    assert "missing_crypto_source_timestamp" not in result["blockers"]
    assert result["clean_evidence_passed"] is True


def test_weather_promotion_exposes_baseline_tightening_blockers():
    promotion = load_module("kalshi_sts_forward_paper_promotion_weather_tight", ROOT / "kalshi_sts_forward_paper_promotion.py")
    record = _sts_positive_weather_candidate(77)
    record["beats_market_baseline"] = False
    record["baseline_comparison"] = {
        "selected_side_fair_probability": 0.506,
        "market_implied_probability": 0.52,
        "weather_calibration_abstention_required": True,
        "weather_calibration_acceptance_passed": False,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "live_order_allowed": False,
    }
    record["quality_gates"] = {
        "weather_probability_calibration_verified": False,
        "weather_model_calibration_verified": False,
        "beats_market_baseline": False,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "live_order_allowed": False,
    }

    payload = promotion.build_promotion([record], {"weather_accepted_paper_repair_required": False}, now_text=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), limit=10)

    assert payload["promotion_allowed_count"] == 0
    blockers = set(payload["blocked_candidates"][0]["blockers"])
    assert "weather_selected_side_not_above_market" in blockers
    assert "weather_calibration_abstention_required" in blockers
    assert "weather_calibration_not_verified" in blockers
    assert "market_random_no_trade_baselines_not_beaten" in blockers
    assert payload["live_order_allowed"] is False


def test_sts_forward_paper_promotion_rules():
    promotion = load_module("kalshi_sts_forward_paper_promotion_test", ROOT / "kalshi_sts_forward_paper_promotion.py")
    state = {"weather_accepted_paper_repair_required": False, "minimum_edge_after_costs_pct": 2.0}
    records = [_sts_positive_weather_candidate(i) for i in range(5)]
    result = promotion.build_promotion(records, state, now_text=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), limit=20)
    assert result["promotion_allowed_count"] == 3
    for candidate in result["promotion_candidates"]:
        promoted = candidate["promoted_candidate"]
        assert promoted["decision"] == "ACCEPT_FORWARD_PAPER"
        assert promoted["evidence_tier"] == "forward_paper"
        assert promoted["accepted_forward_paper_probe"] is True
        assert promoted["simulated_size_usd"] <= 1.0
        assert promoted["supreme_trading_strategy"]["route"] == "STS_TINY_FORWARD_PAPER"
        assert promoted["live_order_allowed"] is False
    _assert_no_live_true(result)


def test_sts_forward_paper_promotion_blocks_inverse_repair_shadow_until_resolved_baselines():
    promotion = load_module("kalshi_sts_forward_paper_promotion_inverse_shadow_block", ROOT / "kalshi_sts_forward_paper_promotion.py")
    now = datetime.now(timezone.utc)
    record = {
        "decision_id": "crypto-inverse-shadow-pending",
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "source_observed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_fetched_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_hashes": ["spot", "market", "book"],
        "expected_result_known_time_utc": (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
        "market_category": "crypto",
        "market_ticker": "KXSOL15M-26MAY302000-00",
        "market_title": "SOL price up in next 15 mins?",
        "side": "NO",
        "selected_executable_side": "NO",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "strategy_bucket": "crypto_spot_model",
        "crypto_evidence": {"asset": "SOL", "market_type": "crypto_price_threshold", "threshold_usd": 150, "spot_observed_at_utc": now.isoformat().replace("+00:00", "Z")},
        "paper_fill_price_cents": 50,
        "market_price_cents": 50,
        "paper_side_options": [
            {"side": "YES", "price_cents": 52, "depth_contracts": 50, "spread_cents": 3, "live_order_allowed": False},
            {"side": "NO", "price_cents": 50, "depth_contracts": 80, "spread_cents": 3, "live_order_allowed": False},
        ],
        "depth_contracts": 80,
        "spread_cents": 3,
        "edge_after_costs_pct": 6.0,
        "model_confidence_score": 0.8,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "baseline_comparison": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
            "inverse_repair_shadow_forces_shadow_only": True,
            "live_order_allowed": False,
        },
        "quality_gates": {"crypto_model_quality_passed": True, "live_order_allowed": False},
        "sts_crypto_regime_inverse_repair_shadowed": True,
        "sts_crypto_regime_selector_experiment": {
            "proof_credit": "none_forward_inverse_repair_shadow",
            "regime_id": "regime:asset=SOL|side=no|prob=mid_prob|market=balanced",
            "counts_for_live_readiness": False,
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    payload = promotion.build_promotion([record], {}, now_text=now.isoformat().replace("+00:00", "Z"), limit=10)

    assert payload["promotion_allowed_count"] == 0
    blocked = payload["blocked_candidates"][0]
    assert blocked["inverse_repair_shadowed"] is True
    assert blocked["inverse_repair_proof_credit"] == "none_forward_inverse_repair_shadow"
    assert "inverse_repair_shadow_no_promotion_until_resolved" in blocked["blockers"]
    assert "inverse_repair_shadow_requires_segment_baseline_proof" in blocked["blockers"]
    assert "inverse_repair_shadow_has_no_live_readiness_credit" in blocked["blockers"]
    assert payload["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_sts_forward_paper_promotion_uses_qualified_segment_policy_side(tmp_path, monkeypatch):
    promotion = load_module("kalshi_sts_forward_paper_promotion_segment_policy", ROOT / "kalshi_sts_forward_paper_promotion.py")
    policy_path = tmp_path / "sts_segment_policy_model.json"
    policy_path.write_text(json.dumps({
        "ok": True,
        "profit_selector_tiny_forward_segments": [
            {
                "segment_key": "crypto|SOL|crypto_price_threshold|yes",
                "domain": "crypto",
                "selected_policy": "inverse_selected_side",
                "qualified_for_tiny_forward_paper": True,
                "fresh_forward_outcomes_collected": 141,
                "fresh_forward_pnl_usd": 10.85,
                "test_accuracy": 0.847561,
                "test_pnl_units": 14.09,
                "live_order_allowed": False,
                "auto_live_promotion_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(promotion, "STS_SEGMENT_POLICY_MODEL_PATH", policy_path)
    now = datetime.now(timezone.utc)
    record = {
        "decision_id": "crypto-sol-policy-1",
        "timestamp_utc": now.isoformat().replace("+00:00", "Z"),
        "source_observed_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_fetched_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_hashes": ["spot", "market", "book"],
        "expected_result_known_time_utc": (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
        "market_category": "crypto",
        "market_ticker": "KXSOL15M-26MAY301715-15",
        "market_title": "SOL price up in next 15 mins?",
        "side": "YES",
        "selected_executable_side": "YES",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "strategy_bucket": "crypto_spot_model",
        "crypto_evidence": {"asset": "SOL", "market_type": "crypto_price_threshold", "threshold_usd": 150, "spot_observed_at_utc": now.isoformat().replace("+00:00", "Z")},
        "paper_fill_price_cents": 35,
        "market_price_cents": 35,
        "paper_side_options": [
            {"side": "YES", "price_cents": 35, "depth_contracts": 50, "spread_cents": 3, "live_order_allowed": False},
            {"side": "NO", "price_cents": 67, "depth_contracts": 80, "spread_cents": 3, "live_order_allowed": False},
        ],
        "depth_contracts": 50,
        "spread_cents": 3,
        "edge_after_costs_pct": 4.0,
        "model_confidence_score": 0.8,
        "beats_market_baseline": True,
        "beats_random_baseline": True,
        "beats_no_trade_baseline": True,
        "quality_gates": {"crypto_model_quality_passed": True, "live_order_allowed": False},
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }

    payload = promotion.build_promotion([record], {}, now_text=now.isoformat().replace("+00:00", "Z"), limit=10)

    assert payload["promotion_allowed_count"] == 1
    promoted = payload["promotion_candidates"][0]["promoted_candidate"]
    assert promoted["side"] == "NO"
    assert promoted["decision"] == "ACCEPT_FORWARD_PAPER_BUY_NO"
    assert promoted["paper_fill_price_cents"] == 67
    assert promoted["sts_segment_policy_proof"]["selected_policy"] == "inverse_selected_side"
    assert promoted["live_order_allowed"] is False
    _assert_no_live_true(payload)


def test_sts_forward_paper_promotion_blocks_sports_and_missing_fields():
    promotion = load_module("kalshi_sts_forward_paper_promotion_blocks", ROOT / "kalshi_sts_forward_paper_promotion.py")
    state = {"weather_accepted_paper_repair_required": False, "minimum_edge_after_costs_pct": 2.0}
    sports = _sts_positive_weather_candidate(1)
    sports["market_category"] = "sports"
    sports["strategy_taxonomy"] = {"domain": "sports"}
    sports["market_title"] = "Will the team win?"
    missing_source = _sts_positive_weather_candidate(2)
    missing_source.pop("source_observed_at_utc", None)
    missing_source.pop("timestamp_utc", None)
    missing_result = _sts_positive_weather_candidate(3)
    missing_result.pop("expected_result_known_time_utc", None)
    result = promotion.build_promotion([sports, missing_source, missing_result], state, now_text=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), limit=20)
    assert result["promotion_allowed_count"] == 0
    blockers = {blocker["blocker"] for blocker in result["top_blockers"]}
    assert "sports_halted_for_sts_promotion" in blockers
    assert "missing_source_timestamp" in blockers
    assert "missing_result_known_time" in blockers
    _assert_no_live_true(result)


def test_sts_readiness_eta_missing_inputs_waits(tmp_path, monkeypatch):
    eta = load_module("kalshi_sts_readiness_eta_missing", ROOT / "kalshi_sts_readiness_eta.py")
    monkeypatch.setattr(eta, "STS_FORWARD_PAPER_PROMOTION_PATH", tmp_path / "missing_promotion.json")
    monkeypatch.setattr(eta, "STS_ARTIFACT_PATH", tmp_path / "missing_sts.json")
    monkeypatch.setattr(eta, "STS_FEATURE_ROWS_PATH", tmp_path / "missing_rows.jsonl")
    monkeypatch.setattr(eta, "LOGS_DIR", tmp_path)

    payload = eta.build_eta()

    assert payload["paper_trading_eta"]["eta_label"] == "Blocked — no defensible ETA"
    assert payload["paper_trading_eta"]["status"] == "blocked"
    assert payload["live_review_eta"]["eta_label"] == "Waiting"
    assert payload["live_review_eta"]["status"] == "blocked"
    assert payload["live_order_allowed"] is False
    assert payload["auto_live_promotion_allowed"] is False


def test_sts_readiness_eta_paper_ready_and_live_estimated(tmp_path, monkeypatch):
    eta = load_module("kalshi_sts_readiness_eta_ready", ROOT / "kalshi_sts_readiness_eta.py")
    promotion_path = tmp_path / "promotion.json"
    proof_path = tmp_path / "forward_paper_proof_latest.json"
    rows_path = tmp_path / "rows.jsonl"
    promotion_path.write_text(json.dumps({
        "ok": True,
        "scanned_candidate_count": 50,
        "eligible_candidate_count": 4,
        "promotion_allowed_count": 2,
        "top_blockers": [],
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }))
    proof_path.write_text(json.dumps({
        "accepted_forward_rate_windows": {
            "proof_qualified_rate_per_hour": 2.0,
            "proof_qualified_sample_size": 40,
        },
        "best_lane": {
            "lane": "weather",
            "scored": 60,
            "paper_pnl_usd": 12.5,
            "accuracy": 0.61,
            "brier_score": 0.12,
            "market_brier_score": 0.18,
            "quality_gates": {
                "beats_market_brier_when_available": True,
                "positive_pnl_after_paper_fill": True,
            },
        },
    }))
    rows_path.write_text('{"row_id":"1"}\n')
    monkeypatch.setattr(eta, "STS_FORWARD_PAPER_PROMOTION_PATH", promotion_path)
    monkeypatch.setattr(eta, "STS_ARTIFACT_PATH", tmp_path / "sts.json")
    monkeypatch.setattr(eta, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(eta, "LOGS_DIR", tmp_path)

    payload = eta.build_eta()

    assert payload["paper_trading_eta"]["status"] == "ready"
    assert payload["paper_trading_eta"]["eta_label"] == "Ready"
    assert payload["live_review_eta"]["status"] == "estimating"
    assert payload["live_review_eta"]["eta_label"].startswith("~")
    assert payload["live_review_eta"]["top_blocker"] == "needs_more_accepted_forward_outcomes"
    assert payload["live_review_eta"]["real_data_basis"]["remaining_scored"] == 40
    assert payload["live_order_allowed"] is False


def test_sts_readiness_eta_negative_pnl_and_market_baseline_block_live_review(tmp_path, monkeypatch):
    eta = load_module("kalshi_sts_readiness_eta_blocked", ROOT / "kalshi_sts_readiness_eta.py")
    promotion_path = tmp_path / "promotion.json"
    proof_path = tmp_path / "forward_paper_proof_latest.json"
    promotion_path.write_text(json.dumps({
        "ok": True,
        "scanned_candidate_count": 100,
        "eligible_candidate_count": 0,
        "promotion_allowed_count": 0,
        "top_blockers": [{"blocker": "market_random_no_trade_baselines_not_beaten", "count": 90}],
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }))
    proof_path.write_text(json.dumps({
        "accepted_forward_rate_windows": {
            "proof_qualified_rate_per_hour": 3.0,
            "proof_qualified_sample_size": 60,
        },
        "best_lane": {
            "lane": "crypto",
            "scored": 120,
            "paper_pnl_usd": -5.0,
            "accuracy": 0.40,
            "brier_score": 0.30,
            "market_brier_score": 0.20,
            "quality_gates": {"beats_market_brier_when_available": False},
        },
    }))
    monkeypatch.setattr(eta, "STS_FORWARD_PAPER_PROMOTION_PATH", promotion_path)
    monkeypatch.setattr(eta, "STS_ARTIFACT_PATH", tmp_path / "sts.json")
    monkeypatch.setattr(eta, "STS_FEATURE_ROWS_PATH", tmp_path / "rows.jsonl")
    monkeypatch.setattr(eta, "LOGS_DIR", tmp_path)

    payload = eta.build_eta()

    assert payload["paper_trading_eta"]["eta_label"] == "Blocked — no defensible ETA"
    assert payload["live_review_eta"]["eta_label"] == "Waiting"
    assert "profitability_not_proven" in payload["live_review_eta"]["blockers"]
    assert "market_baseline_not_beaten" in payload["live_review_eta"]["blockers"]
    assert payload["live_review_eta"]["real_data_basis"]["beats_market_baseline"] is False


def test_sts_forward_paper_promotion_domain_balanced_scan_includes_weather_crypto():
    promotion = load_module("kalshi_sts_forward_paper_promotion_balanced", ROOT / "kalshi_sts_forward_paper_promotion.py")
    records = []
    for index in range(20):
        row = _sts_positive_weather_candidate(index)
        row["market_category"] = "weather"
        row["decision_id"] = f"weather-old-{index}"
        records.append(row)
    for index in range(300):
        row = _sts_positive_weather_candidate(index + 1000)
        row["market_category"] = "sports"
        row["market_title"] = "MLB runs scored"
        row["market_ticker"] = f"KXMLB-{index}"
        row["strategy_taxonomy"] = {"domain": "sports"}
        row["decision_id"] = f"sports-new-{index}"
        records.append(row)

    payload = promotion.build_promotion(records, {}, now_text=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), limit=50, domain_limit=20)

    assert payload["weather_crypto_scanned_count"] == 20
    assert payload["domain_scan_counts"]["weather"] == 20
    assert payload["promotion_allowed_count"] == 3
    assert payload["live_order_allowed"] is False


def test_sts_readiness_eta_keeps_future_domains_separated(tmp_path, monkeypatch):
    eta = load_module("kalshi_sts_readiness_eta_future_domain", ROOT / "kalshi_sts_readiness_eta.py")
    promotion_path = tmp_path / "promotion.json"
    proof_path = tmp_path / "forward_paper_proof_latest.json"
    promotion_path.write_text(json.dumps({
        "ok": True,
        "scanned_candidate_count": 12,
        "eligible_candidate_count": 0,
        "promotion_allowed_count": 0,
        "weather_crypto_scanned_count": 8,
        "domain_scan_counts": {"weather": 3, "crypto": 5, "inflation": 4},
        "per_domain_top_blockers": {
            "weather": [{"blocker": "weather_blocker", "count": 3}],
            "crypto": [{"blocker": "crypto_blocker", "count": 5}],
            "inflation": [{"blocker": "inflation_blocker", "count": 4}],
        },
        "domain_separation_policy": {"mode": "domain_first", "future_market_categories_separated": True, "live_order_allowed": False},
        "live_order_allowed": False,
        "auto_live_promotion_allowed": False,
    }))
    proof_path.write_text(json.dumps({}))
    monkeypatch.setattr(eta, "STS_FORWARD_PAPER_PROMOTION_PATH", promotion_path)
    monkeypatch.setattr(eta, "STS_ARTIFACT_PATH", tmp_path / "sts.json")
    monkeypatch.setattr(eta, "STS_FEATURE_ROWS_PATH", tmp_path / "rows.jsonl")
    monkeypatch.setattr(eta, "LOGS_DIR", tmp_path)

    payload = eta.build_eta()

    assert payload["domain_paper_trading_eta"]["weather"]["top_blocker"] == "weather_blocker"
    assert payload["domain_paper_trading_eta"]["crypto"]["top_blocker"] == "crypto_blocker"
    assert payload["domain_paper_trading_eta"]["inflation"]["top_blocker"] == "inflation_blocker"
    assert payload["paper_trading_eta"]["real_data_basis"]["domain_separation_policy"]["future_market_categories_separated"] is True


def test_sts_domain_learning_optimizer_maps_domain_blockers(tmp_path, monkeypatch):
    optimizer = load_module("kalshi_sts_domain_learning_optimizer_test", ROOT / "kalshi_sts_domain_learning_optimizer.py")
    eta_path = tmp_path / "sts_readiness_eta.json"
    promo_path = tmp_path / "sts_forward_paper_promotion.json"
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    eta_path.write_text(json.dumps({
        "ok": True,
        "domain_paper_trading_eta": {
            "weather": {"domain": "weather", "top_blocker": "market_random_no_trade_baselines_not_beaten", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 3}},
            "crypto": {"domain": "crypto", "top_blocker": "clean_evidence_failed", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 5}},
            "inflation": {"domain": "inflation", "top_blocker": "edge_after_costs_not_positive", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 2}},
        },
        "live_order_allowed": False,
    }))
    promo_path.write_text(json.dumps({"domain_scan_counts": {"weather": 3, "crypto": 5, "inflation": 2}, "live_order_allowed": False}))
    rows_path.write_text('{"domain":"weather"}\n{"domain":"crypto"}\n{"domain":"inflation"}\n')
    monkeypatch.setattr(optimizer, "STS_READINESS_ETA_PATH", eta_path)
    monkeypatch.setattr(optimizer, "STS_FORWARD_PAPER_PROMOTION_PATH", promo_path)
    monkeypatch.setattr(optimizer, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(optimizer, "STS_MODEL_PATH", tmp_path / "sts_model.json")

    payload = optimizer.build_optimizer()

    lanes = {lane["domain"]: lane for lane in payload["domain_lanes"]}
    assert lanes["weather"]["should_improve_baseline_selection"] is True
    assert lanes["crypto"]["should_repair_evidence"] is True
    assert lanes["inflation"]["top_blocker"] == "edge_after_costs_not_positive"
    assert payload["domain_separation_policy"]["future_market_categories_separated"] is True
    assert payload["live_order_allowed"] is False


def test_sts_weather_selector_repair_reports_weather_only_baseline_gap():
    repair = load_module("kalshi_sts_weather_selector_repair_test", ROOT / "kalshi_sts_weather_selector_repair.py")
    weather = _sts_positive_weather_candidate(1)
    weather["baseline_comparison"] = {
        "selected_side_fair_probability": 0.49,
        "market_implied_probability": 0.53,
        "weather_calibration_abstention_required": True,
        "weather_calibration_acceptance_passed": False,
        "live_order_allowed": False,
    }
    crypto = {
        "decision_id": "crypto-selector-test",
        "market_ticker": "KXBTC15M-26MAY272000-00",
        "market_title": "BTC price up in next 15 mins?",
        "market_category": "crypto",
        "strategy_taxonomy": {"domain": "crypto"},
        "side": "YES",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "paper_fill_price_cents": 40,
        "source_fetched_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_hashes": ["abc"],
        "expected_result_known_time_utc": (datetime.now(timezone.utc) + timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "live_order_allowed": False,
    }

    payload = repair.build_repair([weather, crypto], limit=10)

    assert payload["domain"] == "weather"
    assert payload["scanned_weather_count"] == 1
    assert payload["selector_pass_count"] == 0
    blockers = {row["blocker"] for row in payload["top_blockers"]}
    assert "weather_selected_side_not_above_random" in blockers
    assert "weather_selected_side_not_above_market" in blockers
    assert payload["selector_policy"]["negative_transfer_prevention"] == "weather_only"
    assert payload["live_order_allowed"] is False


def test_sts_crypto_evidence_repair_reports_freshness_and_hash_gap():
    repair = load_module("kalshi_sts_crypto_evidence_repair_test", ROOT / "kalshi_sts_crypto_evidence_repair.py")
    crypto = {
        "decision_id": "crypto-repair-test",
        "market_ticker": "KXBTC15M-26MAY272000-00",
        "market_title": "BTC price up in next 15 mins?",
        "market_category": "crypto",
        "strategy_taxonomy": {"domain": "crypto"},
        "side": "YES",
        "fair_value_source_type": "crypto_spot_volatility_model",
        "paper_fill_price_cents": 40,
        "source_fetched_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "live_order_allowed": False,
    }
    crypto.pop("source_hash", None)
    crypto.pop("source_hashes", None)
    crypto["expected_result_known_time_utc"] = "2026-01-01T00:00:00Z"
    weather = _sts_positive_weather_candidate(2)

    payload = repair.build_repair([crypto, weather], limit=10)

    assert payload["domain"] == "crypto"
    assert payload["scanned_crypto_count"] == 1
    blockers = {row["blocker"] for row in payload["top_blockers"]}
    assert "missing_crypto_source_hash" in blockers
    assert "result_time_already_due" in blockers
    assert payload["repair_policy"]["negative_transfer_prevention"] == "crypto_only"
    assert payload["live_order_allowed"] is False


def test_sts_unlock_queue_ranks_real_domain_unlocks(tmp_path, monkeypatch):
    queue = load_module("kalshi_sts_unlock_queue_test", ROOT / "kalshi_sts_unlock_queue.py")
    weather_path = tmp_path / "weather.json"
    crypto_path = tmp_path / "crypto.json"
    promotion_path = tmp_path / "promotion.json"
    eta_path = tmp_path / "eta.json"
    weather_path.write_text(json.dumps({
        "scanned_weather_count": 100,
        "selector_pass_count": 0,
        "top_blockers": [
            {"blocker": "weather_calibration_abstention_required", "count": 100},
            {"blocker": "weather_selected_side_not_above_market", "count": 50},
        ],
        "live_order_allowed": False,
    }))
    crypto_path.write_text(json.dumps({
        "scanned_crypto_count": 100,
        "fresh_clean_count": 2,
        "stale_but_lineage_repairable_count": 5,
        "top_clean_evidence_blocker": "result_time_already_due",
        "top_blockers": [{"blocker": "result_time_already_due", "count": 80}],
        "live_order_allowed": False,
    }))
    promotion_path.write_text(json.dumps({"promotion_allowed_count": 0, "live_order_allowed": False}))
    eta_path.write_text(json.dumps({"paper_trading_eta": {"eta_label": "Blocked"}, "live_order_allowed": False}))
    monkeypatch.setattr(queue, "STS_WEATHER_SELECTOR_REPAIR_PATH", weather_path)
    monkeypatch.setattr(queue, "STS_CRYPTO_EVIDENCE_REPAIR_PATH", crypto_path)
    monkeypatch.setattr(queue, "STS_FORWARD_PAPER_PROMOTION_PATH", promotion_path)
    monkeypatch.setattr(queue, "STS_READINESS_ETA_PATH", eta_path)

    payload = queue.build_unlock_queue()

    assert payload["top_unlock_action"]["domain"] == "weather"
    assert payload["domain_policy"]["future_market_categories_separated"] is True
    assert len(payload["unlock_actions"]) == 2
    assert payload["live_order_allowed"] is False


def test_sts_crypto_fresh_window_diagnostics_separates_fresh_blockers(tmp_path, monkeypatch):
    diagnostics = load_module("kalshi_sts_crypto_fresh_window_diagnostics_test", ROOT / "kalshi_sts_crypto_fresh_window_diagnostics.py")
    cycle_path = tmp_path / "fresh_cycle.json"
    now = datetime.now(timezone.utc)
    cycle_path.write_text(json.dumps({
        "generated_at_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fresh_sts_promotion": {
            "promotion_candidates": [],
            "blocked_candidates": [
                {
                    "decision_id": "crypto-fresh-1",
                    "market_ticker": "KXBTC15M-TEST",
                    "side": "YES",
                    "edge_after_costs_pct": 3.5,
                    "expected_result_known_time_utc": (now + timedelta(minutes=6)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "blockers": ["market_random_no_trade_baselines_not_beaten", "markov_risk_overlay_blocked"],
                    "clean_evidence_blockers": [],
                    "live_order_allowed": False,
                }
            ],
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(diagnostics, "STS_CRYPTO_FRESH_CYCLE_PATH", cycle_path)

    payload = diagnostics.build_diagnostics()

    assert payload["fresh_candidate_count"] == 1
    assert payload["clean_but_baseline_blocked_count"] == 1
    assert payload["clean_but_markov_blocked_count"] == 1
    assert payload["top_fresh_candidates"][0]["window_bucket"] == "3_to_8m"
    assert payload["live_order_allowed"] is False


def test_sts_crypto_baseline_calibration_keeps_market_until_uplift(tmp_path, monkeypatch):
    calibration = load_module("kalshi_sts_crypto_baseline_calibration_test", ROOT / "kalshi_sts_crypto_baseline_calibration.py")
    rows_path = tmp_path / "rows.jsonl"
    rows_path.write_text(
        "\n".join(
            json.dumps({
                "row_id": f"crypto-{index}",
                "domain": "crypto",
                "label_available": True,
                "outcome_yes": 1 if index % 2 else 0,
                "market_probability": 0.52,
                "candidate_probability": 0.48,
                "live_order_allowed": False,
            })
            for index in range(10)
        )
        + "\n"
    )
    fresh_path = tmp_path / "fresh.json"
    fresh_path.write_text(json.dumps({
        "fresh_candidate_count": 3,
        "clean_but_baseline_blocked_count": 3,
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(calibration, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(calibration, "STS_CRYPTO_FRESH_WINDOW_DIAGNOSTICS_PATH", fresh_path)

    payload = calibration.build_calibration()

    assert payload["status"] == "needs_more_labeled_crypto_rows"
    assert payload["beats_market_baseline"] is False
    assert payload["evaluated_crypto_rows"] == 10
    assert payload["promotion_policy"]["requires_out_of_sample_market_brier_uplift"] is True
    assert payload["live_order_allowed"] is False


def test_sts_segment_policy_marks_losing_segment_for_abstention(tmp_path, monkeypatch):
    policy = load_module("kalshi_sts_segment_policy_abstention", ROOT / "kalshi_sts_segment_policy_model.py")
    rows_path = tmp_path / "rows.jsonl"
    rows = []
    for index in range(120):
        rows.append({
            "row_id": f"loss-{index}",
            "domain": "crypto",
            "segment_key": "crypto|SOL|crypto_price_threshold|yes",
            "decision_timestamp_utc": f"2026-05-01T00:{index % 60:02d}:00Z",
            "label_available": True,
            "outcome_yes": 1,
            "candidate_probability": 0.9,
            "market_probability": 0.95,
            "paper_pnl_usd": -0.05,
            "live_order_allowed": False,
        })
    rows_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    monkeypatch.setattr(policy, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(policy, "WEATHER_CRYPTO_ACCELERATOR_PATH", tmp_path / "missing.json")

    payload = policy.build_model()

    assert payload["abstention_segment_count"] == 1
    segment = payload["abstention_segments"][0]
    assert segment["segment_key"] == "crypto|SOL|crypto_price_threshold|yes"
    assert segment["qualified"] is False
    assert segment["blocker"] == "segment_policy_abstention_required"
    assert "active_policy_worse_than_market_brier" in segment["abstention_reasons"]
    assert payload["live_order_allowed"] is False


def test_sts_crypto_probability_recalibrator_improves_overconfident_raw(tmp_path, monkeypatch):
    recalibrator = load_module("kalshi_sts_crypto_probability_recalibrator_test", ROOT / "kalshi_sts_crypto_probability_recalibrator.py")
    rows_path = tmp_path / "rows.jsonl"
    rows = []
    for index in range(100):
        rows.append({
            "row_id": f"train-{index}",
            "domain": "crypto",
            "label_available": True,
            "outcome_yes": 1 if index % 2 == 0 else 0,
            "candidate_probability": 0.95,
            "market_probability": 0.5,
            "live_order_allowed": False,
        })
    for index in range(40):
        rows.append({
            "row_id": f"test-{index}",
            "domain": "crypto",
            "label_available": True,
            "outcome_yes": 1 if index % 2 == 0 else 0,
            "candidate_probability": 0.95,
            "market_probability": 0.5,
            "live_order_allowed": False,
        })
    rows_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps({"status": "market_baseline_retained", "live_order_allowed": False}))
    monkeypatch.setattr(recalibrator, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(recalibrator, "STS_CRYPTO_BASELINE_CALIBRATION_PATH", baseline_path)

    payload = recalibrator.build_recalibrator()

    assert payload["status"] in {"validated_shadow_recalibrator", "validated_context_shadow_recalibrator"}
    assert payload["improves_raw_candidate"] is True
    assert payload["beats_market_baseline"] is False
    high_bucket = [row for row in payload["bucket_recalibration"] if row["bucket"] == "90_100"][0]
    assert high_bucket["recalibrated_probability"] < high_bucket["avg_prediction"]
    assert payload["promotion_policy"]["can_authorize_trade"] is False
    assert payload["live_order_allowed"] is False


def test_sts_crypto_probability_recalibrator_uses_asset_side_context(tmp_path, monkeypatch):
    recalibrator = load_module("kalshi_sts_crypto_probability_recalibrator_context", ROOT / "kalshi_sts_crypto_probability_recalibrator.py")
    rows_path = tmp_path / "rows.jsonl"
    rows = []
    for index in range(100):
        rows.append({
            "row_id": f"btc-train-{index}",
            "domain": "crypto",
            "market_ticker": "KXBTC15M-TEST",
            "selected_side": "YES",
            "label_available": True,
            "outcome_yes": 1,
            "candidate_probability": 0.9,
            "market_probability": 0.5,
            "live_order_allowed": False,
        })
    for index in range(160):
        rows.append({
            "row_id": f"doge-{index}",
            "domain": "crypto",
            "market_ticker": "KXDOGE15M-TEST",
            "selected_side": "YES",
            "label_available": True,
            "outcome_yes": 0,
            "candidate_probability": 0.9,
            "market_probability": 0.5,
            "live_order_allowed": False,
        })
    rows_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(json.dumps({"status": "market_baseline_retained", "live_order_allowed": False}))
    monkeypatch.setattr(recalibrator, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(recalibrator, "STS_CRYPTO_BASELINE_CALIBRATION_PATH", baseline_path)

    payload = recalibrator.build_recalibrator()

    assert payload["status"] == "validated_context_shadow_recalibrator"
    assert payload["context_improves_raw_candidate"] is True
    doge_context = [row for row in payload["context_recalibration"] if row["context_key"] == "asset_side:DOGE|yes"][0]
    doge_bucket = [row for row in doge_context["buckets"] if row["bucket"] == "90_100"][0]
    global_bucket = [row for row in payload["bucket_recalibration"] if row["bucket"] == "90_100"][0]
    assert doge_context["test_apply_count"] > 0
    assert doge_bucket["recalibrated_probability"] < global_bucket["recalibrated_probability"]
    assert payload["live_order_allowed"] is False


def test_sts_crypto_segment_edge_prefers_context_recalibration(tmp_path, monkeypatch):
    edge = load_module("kalshi_sts_crypto_segment_edge_context", ROOT / "kalshi_sts_crypto_segment_edge.py")
    rows_path = tmp_path / "rows.jsonl"
    rows = []
    for index in range(200):
        rows.append({
            "row_id": f"doge-edge-{index}",
            "domain": "crypto",
            "market_ticker": "KXDOGE15M-TEST",
            "selected_side": "YES",
            "segment_key": "crypto|DOGE|crypto_price_threshold|yes",
            "label_available": True,
            "outcome_yes": 0,
            "candidate_probability": 0.9,
            "market_probability": 0.5,
            "paper_pnl_usd": 0.01,
            "live_order_allowed": False,
        })
    rows_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    recal_path = tmp_path / "recal.json"
    recal_path.write_text(json.dumps({
        "bucket_recalibration": [
            {"bucket": "90_100", "recalibrated_probability": 0.9, "enough_rows": True}
        ],
        "context_recalibration": [
            {
                "context_key": "asset_side:DOGE|yes",
                "buckets": [
                    {"bucket": "90_100", "recalibrated_probability": 0.1, "enough_rows": True}
                ],
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(edge, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(edge, "STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH", recal_path)

    payload = edge.build_segment_edge()

    assert payload["market_beating_segment_count"] > 0
    top = payload["top_segments"][0]
    assert top["recalibrated_brier"] < top["market_brier"]
    assert top["recalibration_source_counts"].get("asset_side:DOGE|yes", 0) > 0
    assert payload["live_order_allowed"] is False


def test_sts_crypto_segment_edge_keeps_segments_shadow_only(tmp_path, monkeypatch):
    edge = load_module("kalshi_sts_crypto_segment_edge_test", ROOT / "kalshi_sts_crypto_segment_edge.py")
    rows_path = tmp_path / "rows.jsonl"
    rows = []
    for index in range(200):
        rows.append({
            "row_id": f"crypto-seg-{index}",
            "domain": "crypto",
            "label_available": True,
            "outcome_yes": 1 if index % 2 == 0 else 0,
            "candidate_probability": 0.95,
            "market_probability": 0.9,
            "market_ticker": "KXBTC15M-TEST",
            "selected_side": "YES",
            "segment_key": "crypto|BTC|crypto_price_threshold|yes",
            "paper_pnl_usd": 0.01,
            "live_order_allowed": False,
        })
    rows_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    recal_path = tmp_path / "recal.json"
    recal_path.write_text(json.dumps({
        "bucket_recalibration": [
            {"bucket": "90_100", "recalibrated_probability": 0.5, "enough_rows": True}
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(edge, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(edge, "STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH", recal_path)

    payload = edge.build_segment_edge()

    assert payload["market_beating_segment_count"] > 0
    assert payload["promotion_policy"]["shadow_only"] is True
    assert payload["promotion_policy"]["can_authorize_trade"] is False
    assert payload["live_order_allowed"] is False


def test_sts_crypto_execution_realism_blocks_negative_pnl_segment(tmp_path, monkeypatch):
    realism = load_module("kalshi_sts_crypto_execution_realism_test", ROOT / "kalshi_sts_crypto_execution_realism.py")
    rows_path = tmp_path / "rows.jsonl"
    rows = []
    for index in range(200):
        rows.append({
            "row_id": f"crypto-exec-{index}",
            "domain": "crypto",
            "label_available": True,
            "candidate_probability": 0.95,
            "market_ticker": "KXSOL15M-TEST",
            "selected_side": "YES",
            "segment_key": "crypto|SOL|crypto_price_threshold|yes",
            "paper_pnl_usd": -0.05,
            "spread_cents": 2,
            "depth_contracts": 100,
            "live_order_allowed": False,
        })
    rows_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    edge_path = tmp_path / "edge.json"
    edge_path.write_text(json.dumps({
        "top_segments": [
            {"segment_id": "segment:crypto|SOL|crypto_price_threshold|yes", "market_beaten": True, "recalibrated_uplift_vs_market": 0.01}
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(realism, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(realism, "STS_CRYPTO_SEGMENT_EDGE_PATH", edge_path)

    payload = realism.build_execution_realism()

    assert payload["executable_shadow_edge_count"] == 0
    top = payload["top_segments"][0]
    assert "paper_pnl_not_positive_after_costs" in top["blockers"]
    assert payload["promotion_policy"]["can_authorize_trade"] is False
    assert payload["live_order_allowed"] is False


def test_sts_crypto_execution_selector_queues_shadow_only_profitable_liquid_segments(tmp_path, monkeypatch):
    selector = load_module("kalshi_sts_crypto_execution_selector_test", ROOT / "kalshi_sts_crypto_execution_selector.py")
    realism_path = tmp_path / "realism.json"
    realism_path.write_text(json.dumps({
        "top_segments": [
            {
                "segment_id": "segment:crypto|DOGE|crypto_price_threshold|yes",
                "profit_ok": True,
                "liquidity_ok": True,
                "paper_pnl_usd": 8.0,
                "positive_pnl_rate": 0.55,
                "median_spread_cents": 5,
                "median_depth_contracts": 50,
                "recalibrated_uplift_vs_market": -0.04,
                "test_rows": 100,
                "live_order_allowed": False,
            },
            {
                "segment_id": "segment:crypto|SOL|crypto_price_threshold|yes",
                "profit_ok": False,
                "liquidity_ok": True,
                "paper_pnl_usd": -2.0,
                "live_order_allowed": False,
            },
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(selector, "STS_CRYPTO_EXECUTION_REALISM_PATH", realism_path)
    outcomes_path = tmp_path / "selector_outcomes.json"
    outcomes_path.write_text(json.dumps({"ok": True, "experiments": [], "live_order_allowed": False}))
    monkeypatch.setattr(selector, "STS_CRYPTO_EXECUTION_SELECTOR_OUTCOMES_PATH", outcomes_path)

    payload = selector.build_selector()

    assert payload["candidate_experiment_count"] == 1
    experiment = payload["active_shadow_experiments"][0]
    assert experiment["status"] == "shadow_only"
    assert payload["experiment_policy"]["can_authorize_trade"] is False
    assert payload["experiment_policy"]["counts_for_live_readiness"] is False
    assert payload["live_order_allowed"] is False


def test_sts_crypto_execution_selector_pauses_shadow_decay(tmp_path, monkeypatch):
    selector = load_module("kalshi_sts_crypto_execution_selector_decay_test", ROOT / "kalshi_sts_crypto_execution_selector.py")
    realism_path = tmp_path / "realism.json"
    outcomes_path = tmp_path / "selector_outcomes.json"
    realism_path.write_text(json.dumps({
        "ok": True,
        "top_segments": [
            {
                "segment_id": "segment:crypto|SOL|crypto_price_threshold|no",
                "profit_ok": True,
                "liquidity_ok": True,
                "paper_pnl_usd": 4.0,
                "positive_pnl_rate": 0.7,
                "median_spread_cents": 2,
                "recalibrated_uplift_vs_market": 0.01,
                "live_order_allowed": False,
            },
        ],
        "live_order_allowed": False,
    }))
    outcomes_path.write_text(json.dumps({
        "ok": True,
        "experiments": [
            {
                "experiment_id": "crypto-exec-selector::segment:crypto|SOL|crypto_price_threshold|no",
                "resolved_count": 20,
                "accuracy": 0.2,
                "paper_pnl_usd": -1.0,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(selector, "STS_CRYPTO_EXECUTION_REALISM_PATH", realism_path)
    monkeypatch.setattr(selector, "STS_CRYPTO_EXECUTION_SELECTOR_OUTCOMES_PATH", outcomes_path)

    payload = selector.build_selector()

    assert payload["candidate_experiment_count"] == 0
    assert payload["paused_experiment_count"] == 1
    assert payload["status"] == "all_candidates_paused_shadow_decay"
    paused = payload["paused_shadow_experiments"][0]
    assert paused["status"] == "paused_shadow_decay"
    assert paused["experiment_health"]["decay_blockers"] == ["shadow_accuracy_decay", "shadow_pnl_decay"]
    assert paused["live_order_allowed"] is False


def test_crypto_candidate_execution_selector_attribution_is_shadow_only():
    crypto = load_module("kalshi_crypto_evidence_selector_attr_test", ROOT / "kalshi_crypto_evidence.py")
    attribution = crypto._execution_selector_attribution(
        parsed={"asset": "DOGE", "market_type": "crypto_price_threshold"},
        side="YES",
        segment_key="crypto|DOGE|crypto_price_threshold|yes",
        selected_side_fair_probability=0.82,
        experiments=[
            {
                "experiment_id": "crypto-exec-selector::prob_bucket:high_prob",
                "segment_id": "prob_bucket:high_prob",
                "selector_score": 8.9,
                "hypothesis": "test hypothesis",
                "success_metric": "test metric",
                "live_order_allowed": False,
            }
        ],
    )

    assert attribution is not None
    assert attribution["experiment_id"] == experiment["experiment_id"]
    assert attribution["raw_selected_side_fair_probability"] == 0.82
    assert attribution["recalibrated_selected_side_fair_probability"] == 0.55
    assert attribution["recalibration_source"] == "asset_side:DOGE|yes"
    assert "regime:asset=DOGE|side=yes|prob=mid_prob|market=balanced" in attribution["matched_regime_ids"]
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["live_order_allowed"] is False
    assert attribution["experiment_id"] == "crypto-exec-selector::prob_bucket:high_prob"
    assert attribution["route"] == "SHADOW_ONLY"
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["can_authorize_trade"] is False
    assert attribution["live_order_allowed"] is False


def test_crypto_execution_selector_outcomes_replay_is_no_proof_credit(tmp_path, monkeypatch):
    outcomes = load_module("kalshi_sts_crypto_execution_selector_outcomes_test", ROOT / "kalshi_sts_crypto_execution_selector_outcomes.py")
    selector_path = tmp_path / "selector.json"
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    selector_path.write_text(json.dumps({
        "ok": True,
        "active_shadow_experiments": [
            {
                "experiment_id": "crypto-exec-selector::prob_bucket:high_prob",
                "segment_id": "prob_bucket:high_prob",
                "selector_score": 9.0,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    decisions_path.write_text(json.dumps({
        "decision_id": "crypto-spot-test",
        "market_category": "crypto",
        "market_ticker": "KXBTC15M-TEST",
        "side": "YES",
        "selected_side_fair_probability": 0.82,
        "paper_fill_price_cents": 60,
        "simulated_size_usd": 1.0,
        "live_order_allowed": False,
    }) + "\n")
    outcomes_path.write_text(json.dumps({
        "decision_id": "crypto-spot-test",
        "outcome_yes": 1,
        "resolved": True,
        "live_order_allowed": False,
    }) + "\n")
    monkeypatch.setattr(outcomes, "STS_CRYPTO_EXECUTION_SELECTOR_PATH", selector_path)
    monkeypatch.setattr(outcomes, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(outcomes, "PAPER_OUTCOMES_PATH", outcomes_path)

    payload = outcomes.build_outcomes()

    assert payload["experiment_count"] == 1
    assert payload["resolved_attributed_count"] == 1
    experiment = payload["experiments"][0]
    assert experiment["proof_credit"] == "none_retrospective_or_unresolved_shadow"
    assert experiment["counts_for_live_readiness"] is False
    assert experiment["live_order_allowed"] is False


def test_crypto_regime_selector_finds_shadow_only_regime(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_test", ROOT / "kalshi_sts_crypto_regime_selector.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    rows = []
    for idx in range(100):
        rows.append({
            "row_id": f"crypto-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXETH15M-TEST",
            "segment_key": "crypto|ETH|crypto_price_threshold|no",
            "selected_side": "NO",
            "candidate_probability": 0.8,
            "market_probability": 0.55,
            "outcome_yes": 1,
            "selected_side_won": 1,
            "paper_pnl_usd": 0.2,
            "spread_cents": 1,
            "depth_contracts": 20,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T12:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T12:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)

    payload = regime.build_regime_selector()

    assert payload["candidate_experiment_count"] >= 1
    experiment = payload["active_shadow_experiments"][0]
    assert experiment["status"] == "shadow_only"
    assert experiment["counts_for_live_readiness"] is False
    assert experiment["can_authorize_trade"] is False
    assert experiment["live_order_allowed"] is False


def test_crypto_regime_selector_uses_context_recalibration_for_market_gate(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_recal_test", ROOT / "kalshi_sts_crypto_regime_selector.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    recal_path = tmp_path / "recal.json"
    rows = []
    for idx in range(100):
        rows.append({
            "row_id": f"crypto-recal-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXETH15M-TEST",
            "segment_key": "crypto|ETH|crypto_price_threshold|yes",
            "selected_side": "YES",
            "candidate_probability": 0.9,
            "market_probability": 0.5,
            "outcome_yes": 0,
            "selected_side_won": 1,
            "paper_pnl_usd": 0.2,
            "spread_cents": 1,
            "depth_contracts": 20,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T13:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T13:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    recal_path.write_text(json.dumps({
        "context_recalibration": [
            {
                "context_key": "asset_side:ETH|yes",
                "buckets": [
                    {"bucket": "90_100", "recalibrated_probability": 0.1, "enough_rows": True}
                ],
                "live_order_allowed": False,
            }
        ],
        "bucket_recalibration": [
            {"bucket": "90_100", "recalibrated_probability": 0.9, "enough_rows": True}
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH", recal_path)

    payload = regime.build_regime_selector()

    assert payload["candidate_experiment_count"] >= 1
    top = payload["top_regimes"][0]
    assert top["recalibrated_brier"] < top["market_brier"]
    assert top["raw_candidate_brier"] > top["market_brier"]
    assert top["recalibration_source_counts"].get("asset_side:ETH|yes", 0) > 0
    assert payload["experiment_policy"]["requires_recalibrated_market_brier_uplift"] is True
    assert payload["live_order_allowed"] is False


def test_crypto_regime_selector_finds_hour_edge_regime(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_hour_edge_test", ROOT / "kalshi_sts_crypto_regime_selector.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    recal_path = tmp_path / "recal.json"
    rows = []
    for idx in range(100):
        good = idx >= 70
        rows.append({
            "row_id": f"crypto-hour-edge-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXDOGE15M-TEST",
            "selected_side": "YES",
            "candidate_probability": 0.6 if good else 0.9,
            "market_probability": 0.5,
            "outcome_yes": 1 if good else 0,
            "selected_side_won": 1 if good else 0,
            "paper_pnl_usd": 0.2 if good else -1.0,
            "spread_cents": 4,
            "depth_contracts": 100,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T08:{idx % 60:02d}:20Z" if good else f"2026-05-18T02:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T08:{idx % 60:02d}:10Z" if good else f"2026-05-18T02:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    recal_path.write_text(json.dumps({"bucket_recalibration": [], "context_recalibration": [], "live_order_allowed": False}))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH", recal_path)

    payload = regime.build_regime_selector()

    assert any(
        exp["regime_id"] == "regime:asset=DOGE|side=yes|hour=hour_06_11|edge=edge_small"
        for exp in payload["active_shadow_experiments"]
    )
    hour_regime = [
        row
        for row in payload["top_regimes"]
        if row["regime_id"] == "regime:asset=DOGE|side=yes|hour=hour_06_11|edge=edge_small"
    ][0]
    assert hour_regime["shadow_candidate"] is True
    assert hour_regime["market_brier_uplift"] > 0
    assert hour_regime["live_order_allowed"] is False
    plan = [
        row
        for row in payload["active_experiment_acquisition_plan"]
        if row["regime_id"] == "regime:asset=DOGE|side=yes|hour=hour_06_11|edge=edge_small"
    ][0]
    assert plan["regime_id"] == "regime:asset=DOGE|side=yes|hour=hour_06_11|edge=edge_small"
    assert plan["next_match_start_utc"]
    assert plan["recommended_action"] in {
        "run_crypto_fresh_capture_now",
        "schedule_crypto_fresh_capture_for_regime_window",
    }
    assert plan["live_order_allowed"] is False


def test_crypto_regime_selector_adds_current_window_acquisition_shadow(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_current_window_test", ROOT / "kalshi_sts_crypto_regime_selector.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    rows = []
    for idx in range(100):
        current_window = idx >= 70
        rows.append({
            "row_id": f"crypto-acquire-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXDOGE15M-TEST",
            "selected_side": "YES",
            "candidate_probability": 0.55 if current_window else 0.9,
            "market_probability": 0.9 if current_window else 0.5,
            "outcome_yes": 1 if current_window else 0,
            "selected_side_won": 1 if current_window else 0,
            "paper_pnl_usd": 0.15 if current_window else -1.0,
            "spread_cents": 4,
            "depth_contracts": 100,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T20:{idx % 60:02d}:20Z" if current_window else f"2026-05-18T08:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T20:{idx % 60:02d}:10Z" if current_window else f"2026-05-18T08:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "utc_now", lambda: "2026-05-18T20:30:00Z")

    payload = regime.build_regime_selector()

    assert payload["candidate_experiment_count"] == 0
    assert payload["acquisition_shadow_experiment_count"] >= 1
    acquisition = payload["acquisition_shadow_experiments"][0]
    assert acquisition["status"] == "acquisition_shadow_only"
    assert acquisition["counts_for_live_readiness"] is False
    assert acquisition["can_authorize_trade"] is False
    assert acquisition["live_order_allowed"] is False
    assert payload["acquisition_shadow_experiment_plan"][0]["current_time_matches_regime"] is True
    assert "current-window crypto acquisition shadow" in payload["next_action"]


def test_crypto_regime_selector_pauses_forward_loss_regime(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_penalty_test", ROOT / "kalshi_sts_crypto_regime_selector.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    outcomes_path = tmp_path / "regime_outcomes.json"
    rows = []
    for idx in range(100):
        outcome = 0 if idx % 2 == 0 else 1
        rows.append({
            "row_id": f"crypto-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXETH15M-TEST",
            "segment_key": "crypto|ETH|crypto_price_threshold|no",
            "selected_side": "NO",
            "candidate_probability": 0.1 if outcome == 0 else 0.9,
            "market_probability": 0.9 if outcome == 0 else 0.1,
            "outcome_yes": outcome,
            "selected_side_won": 1,
            "paper_pnl_usd": 0.2,
            "spread_cents": 1,
            "depth_contracts": 20,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T12:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T12:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    outcomes_path.write_text(json.dumps({
        "forward_recorded_experiments": [
            {
                "experiment_id": "crypto-regime-selector::regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin",
                "regime_id": "regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin",
                "resolved_count": 3,
                "paper_pnl_usd": -1.2,
                "accuracy": 0.333,
                "market_brier_uplift": 0.01,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_REGIME_SELECTOR_OUTCOMES_PATH", outcomes_path)

    payload = regime.build_regime_selector()

    assert payload["paused_forward_regime_count"] >= 1
    assert payload["forward_regime_penalties"][0]["action"] == "pause_forward_shadow_regime"
    paused = [
        row
        for row in payload["top_regimes"]
        if row["regime_id"] == "regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin"
    ][0]
    assert paused["shadow_candidate"] is False
    assert "fresh_forward_regime_penalty_active" in paused["blockers"]
    assert all(exp["regime_id"] != paused["regime_id"] for exp in payload["active_shadow_experiments"])
    assert payload["live_order_allowed"] is False


def test_crypto_regime_selector_pauses_retrospective_overfit_regime(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_retrospective_penalty_test", ROOT / "kalshi_sts_crypto_regime_selector.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    outcomes_path = tmp_path / "regime_outcomes.json"
    regime_id = "regime:asset=DOGE|side=yes|prob=mid_prob|market=balanced"
    rows = []
    for idx in range(100):
        rows.append({
            "row_id": f"crypto-overfit-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXDOGE15M-TEST",
            "selected_side": "YES",
            "candidate_probability": 0.55,
            "market_probability": 0.52,
            "outcome_yes": 1,
            "selected_side_won": 1,
            "paper_pnl_usd": 0.2,
            "spread_cents": 1,
            "depth_contracts": 20,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T12:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T12:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    outcomes_path.write_text(json.dumps({
        "retrospective_experiments": [
            {
                "experiment_id": f"crypto-regime-selector::{regime_id}",
                "regime_id": regime_id,
                "resolved_count": 205,
                "paper_pnl_usd": -9.38,
                "market_brier_uplift": 0.001697,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_REGIME_SELECTOR_OUTCOMES_PATH", outcomes_path)

    payload = regime.build_regime_selector()

    paused = [row for row in payload["top_regimes"] if row["regime_id"] == regime_id][0]
    assert paused["shadow_candidate"] is False
    assert "retrospective_regime_stability_pnl_not_positive" in paused["blockers"]
    assert payload["paused_retrospective_stability_regime_count"] >= 1
    assert payload["retrospective_regime_stability_penalties"][0]["action"] == "pause_overfit_shadow_regime"
    assert all(exp["regime_id"] != regime_id for exp in payload["active_shadow_experiments"])
    assert payload["live_order_allowed"] is False


def test_crypto_evidence_uses_recalibrated_probability_for_regime_attribution():
    crypto = load_module("kalshi_crypto_evidence_regime_recal_test", ROOT / "kalshi_crypto_evidence.py")
    experiment = {
        "experiment_id": "crypto-regime-selector::regime:asset=DOGE|side=yes|prob=mid_prob|market=balanced",
        "regime_id": "regime:asset=DOGE|side=yes|prob=mid_prob|market=balanced",
        "selector_score": 1.2,
        "live_order_allowed": False,
    }

    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "DOGE"},
        side="YES",
        selected_side_fair_probability=0.82,
        market_implied_probability=0.51,
        spread_cents=1,
        depth_contracts=10,
        decision_timestamp_utc="2026-05-30T22:00:10Z",
        feature_cutoff_utc="2026-05-30T22:00:01Z",
        experiments=[experiment],
        probability_recalibration=(
            {},
            {
                "asset_side:DOGE|yes": {
                    "80_90": 0.55,
                }
            },
        ),
    )

    assert attribution is not None


def test_crypto_evidence_loads_acquisition_shadow_experiments(tmp_path, monkeypatch):
    crypto = load_module("kalshi_crypto_evidence_acquisition_regime_test", ROOT / "kalshi_crypto_evidence.py")
    selector_path = tmp_path / "selector.json"
    selector_path.write_text(json.dumps({
        "active_shadow_experiments": [],
        "acquisition_shadow_experiments": [
            {
                "experiment_id": "crypto-regime-acquisition::regime:asset=DOGE|side=yes|hour=hour_18_23|edge=edge_tiny",
                "regime_id": "regime:asset=DOGE|side=yes|hour=hour_18_23|edge=edge_tiny",
                "status": "acquisition_shadow_only",
                "selector_score": 2.5,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(crypto, "STS_CRYPTO_REGIME_SELECTOR_PATH", selector_path)

    experiments = crypto._load_regime_selector_experiments()
    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "DOGE"},
        side="YES",
        selected_side_fair_probability=0.55,
        market_implied_probability=0.51,
        spread_cents=4,
        depth_contracts=100,
        decision_timestamp_utc="2026-05-18T20:30:00Z",
        feature_cutoff_utc="2026-05-18T20:29:50Z",
        experiments=experiments,
        probability_recalibration=({}, {}),
    )

    assert attribution is not None
    assert attribution["experiment_status"] == "acquisition_shadow_only"
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["live_order_allowed"] is False
    assert attribution["experiment_id"].startswith("crypto-regime-acquisition::")


def test_crypto_evidence_creates_coverage_probe_when_no_regime_matches():
    crypto = load_module("kalshi_crypto_evidence_regime_coverage_probe_test", ROOT / "kalshi_crypto_evidence.py")

    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "XRP"},
        side="NO",
        selected_side_fair_probability=0.68,
        market_implied_probability=0.51,
        spread_cents=4,
        depth_contracts=100,
        decision_timestamp_utc="2026-05-18T20:30:00Z",
        feature_cutoff_utc="2026-05-18T20:29:50Z",
        experiments=[],
        probability_recalibration=({}, {}),
        coverage_probe_budget=(True, {"pending_coverage_probe_count": 0, "live_order_allowed": False}),
        coverage_cohort_blocks={},
    )

    assert attribution is not None
    assert attribution["experiment_status"] == "coverage_shadow_only"
    assert attribution["experiment_id"].startswith("crypto-regime-coverage::")
    assert attribution["proof_credit"] == "none_forward_coverage_probe"
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["can_authorize_trade"] is False
    assert attribution["live_order_allowed"] is False


def test_crypto_evidence_blocks_coverage_probe_when_backlog_full():
    crypto = load_module("kalshi_crypto_evidence_coverage_backlog_test", ROOT / "kalshi_crypto_evidence.py")

    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "XRP"},
        side="NO",
        selected_side_fair_probability=0.68,
        market_implied_probability=0.51,
        spread_cents=4,
        depth_contracts=100,
        decision_timestamp_utc="2026-05-18T20:30:00Z",
        feature_cutoff_utc="2026-05-18T20:29:50Z",
        experiments=[],
        probability_recalibration=({}, {}),
        coverage_probe_budget=(
            False,
            {
                "pending_coverage_probe_count": 8,
                "due_coverage_probe_count": 0,
                "pending_cap": 8,
                "open_for_new_coverage_probe": False,
                "live_order_allowed": False,
            },
        ),
        coverage_cohort_blocks={},
    )

    assert attribution is not None
    assert attribution["blocked_from_attribution"] is True
    assert attribution["route"] == "STS_COVERAGE_PROBE_BACKLOG_BLOCK"
    assert attribution["coverage_probe_budget"]["pending_coverage_probe_count"] == 8
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["live_order_allowed"] is False


def test_crypto_evidence_blocks_coverage_probe_when_due_backlog_waits_for_resolution(monkeypatch):
    crypto = load_module("kalshi_crypto_evidence_coverage_due_backlog_test", ROOT / "kalshi_crypto_evidence.py")
    monkeypatch.setattr(
        crypto,
        "read_json",
        lambda _path: {
            "forward_recorded_coverage_probe_pending_count": 11,
            "forward_recorded_coverage_probe_due_count": 4,
        },
    )

    open_for_new, context = crypto._coverage_probe_backlog_open()

    assert open_for_new is False
    assert context["open_for_new_coverage_probe"] is False
    assert context["reason"] == "coverage_probe_due_wait_for_resolution"
    assert context["live_order_allowed"] is False


def test_crypto_evidence_consumes_in_run_coverage_probe_budget_until_cap():
    crypto = load_module("kalshi_crypto_evidence_consume_coverage_budget_test", ROOT / "kalshi_crypto_evidence.py")

    budget = (
        True,
        {
            "pending_coverage_probe_count": 7,
            "due_coverage_probe_count": 0,
            "pending_cap": 8,
            "open_for_new_coverage_probe": True,
            "live_order_allowed": False,
        },
    )

    open_for_new, context = crypto._consume_coverage_probe_budget(budget)

    assert open_for_new is False
    assert context["pending_coverage_probe_count"] == 8
    assert context["open_for_new_coverage_probe"] is False
    assert context["reason"] == "coverage_probe_pending_cap_reached_wait_for_resolution"
    assert context["live_order_allowed"] is False


def test_crypto_evidence_blocks_failed_coverage_probe_cohort():
    crypto = load_module("kalshi_crypto_evidence_coverage_cohort_block_test", ROOT / "kalshi_crypto_evidence.py")
    cohort_block = {
        "coverage_cohort:side=no|hour=hour_18_23": {
            "coverage_cohort_key": "coverage_cohort:side=no|hour=hour_18_23",
            "resolved_count": 4,
            "loss_count": 4,
            "paper_pnl_usd": -4.0,
            "action": "pause_coverage_probe_cohort",
            "live_order_allowed": False,
        }
    }

    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "BTC"},
        side="NO",
        selected_side_fair_probability=0.68,
        market_implied_probability=0.51,
        spread_cents=4,
        depth_contracts=100,
        decision_timestamp_utc="2026-05-18T20:30:00Z",
        feature_cutoff_utc="2026-05-18T20:29:50Z",
        experiments=[],
        probability_recalibration=({}, {}),
        coverage_probe_budget=(True, {"pending_coverage_probe_count": 4, "live_order_allowed": False}),
        coverage_cohort_blocks=cohort_block,
    )

    assert attribution is not None
    assert attribution["blocked_from_attribution"] is True
    assert attribution["route"] == "STS_COVERAGE_PROBE_COHORT_BLOCK"
    assert attribution["coverage_probe_cohort_block"]["resolved_count"] == 4
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["live_order_allowed"] is False


def test_crypto_evidence_routes_inverse_repair_shadow_attribution():
    crypto = load_module("kalshi_crypto_evidence_inverse_repair_attribution_test", ROOT / "kalshi_crypto_evidence.py")
    regime_id = "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_mid"

    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "SOL"},
        side="NO",
        selected_side_fair_probability=0.55,
        market_implied_probability=0.4,
        spread_cents=4,
        depth_contracts=100,
        decision_timestamp_utc="2026-05-18T20:30:00Z",
        feature_cutoff_utc="2026-05-18T20:29:50Z",
        experiments=[],
        repair_policy={
            regime_id: {
                "regime_id": regime_id,
                "recommended_action": "test_inverse_forward_shadow",
                "inverse_pnl_uplift_usd": 4.2,
                "live_order_allowed": False,
            }
        },
        probability_recalibration=({}, {}),
        coverage_probe_budget=(True, {"pending_coverage_probe_count": 0, "live_order_allowed": False}),
        coverage_cohort_blocks={},
    )

    assert attribution is not None
    assert attribution["route"] == "STS_INVERSE_FORWARD_SHADOW_TEST"
    assert attribution["experiment_status"] == "inverse_forward_shadow_only"
    assert attribution["proof_credit"] == "none_forward_inverse_repair_shadow"
    assert attribution["inverse_side"] == "YES"
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["live_order_allowed"] is False


def test_crypto_evidence_prioritizes_inverse_repair_shadows_before_generic_shadow():
    crypto = load_module("kalshi_crypto_evidence_inverse_repair_rank_test", ROOT / "kalshi_crypto_evidence.py")

    inverse_shadow = {
        "market_ticker": "KXSOL-REPAIR",
        "strategy_governor_action": "SHADOW_ONLY",
        "sts_crypto_regime_inverse_repair_shadowed": True,
        "baseline_comparison": {
            "beats_market_baseline": False,
            "beats_random_baseline": False,
            "beats_no_trade_baseline": False,
        },
        "edge_after_costs_pct": -3,
        "model_confidence_score": 0.1,
        "live_order_allowed": False,
    }
    generic_shadow = {
        "market_ticker": "KXBTC-GENERIC",
        "strategy_governor_action": "SHADOW_ONLY",
        "baseline_comparison": {
            "beats_market_baseline": True,
            "beats_random_baseline": True,
            "beats_no_trade_baseline": True,
        },
        "edge_after_costs_pct": 50,
        "model_confidence_score": 0.95,
        "live_order_allowed": False,
    }

    ranked = sorted([generic_shadow, inverse_shadow], key=crypto._rank_safety_first_record)

    assert ranked[0]["market_ticker"] == "KXSOL-REPAIR"
    assert ranked[0]["live_order_allowed"] is False


def test_crypto_evidence_reports_inverse_repair_capture_blocker():
    crypto = load_module("kalshi_crypto_evidence_inverse_capture_diag_test", ROOT / "kalshi_crypto_evidence.py")
    repair_policy = {
        "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_mid": {
            "regime_id": "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_mid",
            "recommended_action": "test_inverse_forward_shadow",
            "inverse_pnl_uplift_usd": 7.5,
            "live_order_allowed": False,
        }
    }

    diagnostics = crypto._inverse_repair_capture_diagnostics(
        candidates=[
            {
                "market_ticker": "KXBTC-GENERIC",
                "sts_crypto_regime_selector_experiment": {
                    "matched_regime_ids": ["regime:asset=BTC|side=yes|hour=hour_18_23|edge=edge_mid"],
                    "live_order_allowed": False,
                },
                "live_order_allowed": False,
            }
        ],
        created=[],
        repair_policy=repair_policy,
    )

    assert diagnostics["inverse_repair_policy_count"] == 1
    assert diagnostics["matched_repair_policy_candidate_count"] == 0
    assert diagnostics["primary_capture_blocker"] == "no_current_candidate_matches_inverse_repair_regime"
    assert diagnostics["near_match_candidate_count"] == 0
    assert diagnostics["top_unmatched_inverse_repair_regimes"] == [
        "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_mid"
    ]
    assert diagnostics["counts_for_live_readiness"] is False
    assert diagnostics["live_order_allowed"] is False


def test_crypto_evidence_reports_inverse_repair_near_match_buckets():
    crypto = load_module("kalshi_crypto_evidence_inverse_capture_near_match_test", ROOT / "kalshi_crypto_evidence.py")
    target = "regime:asset=SOL|side=no|prob=mid_prob|market=balanced"

    diagnostics = crypto._inverse_repair_capture_diagnostics(
        candidates=[
            {
                "market_ticker": "KXSOL-NEAR",
                "side": "NO",
                "sts_crypto_regime_selector_experiment": {
                    "matched_regime_ids": [
                        "regime:asset=SOL|side=no|prob=mid_prob|market=rich",
                        "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_small",
                    ],
                    "live_order_allowed": False,
                },
                "live_order_allowed": False,
            }
        ],
        created=[],
        repair_policy={
            target: {
                "regime_id": target,
                "recommended_action": "test_inverse_forward_shadow",
                "inverse_pnl_uplift_usd": 7.5,
                "live_order_allowed": False,
            }
        },
    )

    assert diagnostics["matched_repair_policy_candidate_count"] == 0
    assert diagnostics["near_match_candidate_count"] == 1
    assert diagnostics["primary_capture_blocker"] == "current_candidates_miss_exact_inverse_repair_buckets"
    near = diagnostics["top_near_matches"][0]
    assert near["target_regime_id"] == target
    assert near["candidate_regime_id"] == "regime:asset=SOL|side=no|prob=mid_prob|market=rich"
    assert near["matched_dimensions"] == ["asset", "prob", "side"]
    assert near["missing_or_different_dimensions"] == ["market"]
    assert near["market_bucket_capture_plan"]["current_bucket"] == "rich"
    assert near["market_bucket_capture_plan"]["target_bucket"] == "balanced"
    assert near["market_bucket_capture_plan"]["target_price_band"]["selected_side_price_min_cents"] == 40
    assert near["market_bucket_capture_plan"]["target_price_band"]["selected_side_price_max_cents"] == 60
    assert diagnostics["top_market_bucket_capture_plan"]["target_bucket"] == "balanced"
    assert "40c-60c" in diagnostics["next_action"]
    assert near["live_order_allowed"] is False


def test_crypto_evidence_reports_inverse_repair_creation_cap_blocker():
    crypto = load_module("kalshi_crypto_evidence_inverse_capture_cap_test", ROOT / "kalshi_crypto_evidence.py")
    regime_id = "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_mid"
    diagnostics = crypto._inverse_repair_capture_diagnostics(
        candidates=[
            {
                "market_ticker": "KXSOL-REPAIR",
                "side": "YES",
                "sts_crypto_regime_inverse_repair_shadowed": True,
                "sts_crypto_regime_selector_experiment": {
                    "regime_id": regime_id,
                    "matched_regime_ids": [regime_id],
                    "route": "STS_INVERSE_FORWARD_SHADOW_TEST",
                    "live_order_allowed": False,
                },
                "live_order_allowed": False,
            }
        ],
        created=[],
        repair_policy={
            regime_id: {
                "regime_id": regime_id,
                "recommended_action": "test_inverse_forward_shadow",
                "inverse_pnl_uplift_usd": 7.5,
                "live_order_allowed": False,
            }
        },
    )

    assert diagnostics["matched_repair_policy_candidate_count"] == 1
    assert diagnostics["inverse_repair_shadow_candidate_count"] == 1
    assert diagnostics["inverse_repair_shadow_created_count"] == 0
    assert diagnostics["primary_capture_blocker"] == "inverse_repair_shadow_not_selected_in_creation_cap"
    assert diagnostics["sample_matches"][0]["shadowed"] is True
    assert diagnostics["can_authorize_trade"] is False
    assert diagnostics["live_order_allowed"] is False


def test_crypto_evidence_targeted_inverse_repair_acquires_when_primary_side_differs(monkeypatch):
    crypto = load_module("kalshi_crypto_evidence_targeted_inverse_repair_build_test", ROOT / "kalshi_crypto_evidence.py")
    regime_id = "regime:asset=SOL|side=no|prob=mid_prob|market=balanced"
    monkeypatch.setattr(crypto, "utc_now", lambda: "2026-05-30T23:45:00Z")
    monkeypatch.setattr(crypto, "fair_yes_probability", lambda _parsed, _spot: 0.55)
    monkeypatch.setattr(crypto, "_load_probability_recalibration_maps", lambda: ({}, {}))
    monkeypatch.setattr(
        crypto.kalshi_weather_crypto_ml,
        "calibration_repair_adjustment_for_segment",
        lambda **_kwargs: {"status": "not_needed", "live_order_allowed": False},
    )
    monkeypatch.setattr(
        crypto,
        "_load_regime_inverse_repair_policy",
        lambda: {
            regime_id: {
                "regime_id": regime_id,
                "recommended_action": "test_inverse_forward_shadow",
                "inverse_pnl_uplift_usd": 10.2,
                "selected_paper_pnl_usd": -5.0,
                "inverse_paper_pnl_usd": 5.2,
                "resolved_count": 31,
                "blockers": [],
                "route": "STS_INVERSE_SHADOW_REPAIR_CANDIDATE",
                "live_order_allowed": False,
            }
        },
    )
    market = {
        "ticker": "KXSOL-26JUN13-T100",
        "title": "Will Solana be above $100 on June 13, 2026?",
        "category": "crypto",
        "close_time": "2026-06-13T20:00:00Z",
    }

    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 45,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 55,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "SOL": {
                "asset": "SOL",
                "spot_usd": 101.0,
                "annualized_volatility": 0.8,
                "provider": "fixture",
                "observed_at_utc": "2026-05-30T23:44:50Z",
                "source_url": "fixture://sol",
            }
        },
        now=datetime(2026, 5, 30, 23, 45, tzinfo=timezone.utc),
        max_hours=900,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["side"] == "YES"
    assert candidate["selected_executable_side"] == "YES"
    assert candidate["simulated_size_usd"] == 0.0
    assert candidate["sts_crypto_regime_inverse_repair_shadowed"] is True
    attribution = candidate["sts_crypto_regime_selector_experiment"]
    assert attribution["targeted_inverse_repair_acquisition"] is True
    assert attribution["original_selected_side"] == "NO"
    assert attribution["executed_shadow_side"] == "YES"
    assert attribution["regime_id"] == regime_id
    assert attribution["proof_credit"] == "none_forward_inverse_repair_shadow"
    assert candidate["baseline_comparison"]["targeted_inverse_repair_acquisition"] is True
    assert candidate["baseline_comparison"]["inverse_repair_shadow_forces_shadow_only"] is True
    assert candidate["live_order_allowed"] is False


def test_crypto_evidence_executes_inverse_repair_shadow_side(monkeypatch):
    crypto = load_module("kalshi_crypto_evidence_inverse_repair_build_test", ROOT / "kalshi_crypto_evidence.py")
    regime_id = "regime:asset=SOL|side=no|hour=hour_18_23|edge=edge_mid"
    monkeypatch.setattr(crypto, "utc_now", lambda: "2026-05-18T20:30:00Z")
    monkeypatch.setattr(crypto, "fair_yes_probability", lambda _parsed, _spot: 0.45)
    monkeypatch.setattr(crypto, "_load_probability_recalibration_maps", lambda: ({}, {}))
    monkeypatch.setattr(
        crypto.kalshi_weather_crypto_ml,
        "calibration_repair_adjustment_for_segment",
        lambda **_kwargs: {"status": "not_needed", "live_order_allowed": False},
    )
    monkeypatch.setattr(
        crypto,
        "_load_regime_inverse_repair_policy",
        lambda: {
            regime_id: {
                "regime_id": regime_id,
                "recommended_action": "test_inverse_forward_shadow",
                "inverse_pnl_uplift_usd": 4.2,
                "selected_paper_pnl_usd": -2.0,
                "inverse_paper_pnl_usd": 2.2,
                "resolved_count": 8,
                "blockers": [],
                "route": "STS_INVERSE_SHADOW_REPAIR_CANDIDATE",
                "live_order_allowed": False,
            }
        },
    )
    market = {
        "ticker": "KXSOL-26JUN13-T100",
        "title": "Will Solana be above $100 on June 13, 2026?",
        "category": "crypto",
        "close_time": "2026-06-13T20:00:00Z",
    }

    candidates = crypto.build_candidates(
        [market],
        {
            market["ticker"]: {
                "best_yes_ask_cents": 60,
                "best_yes_ask_size_contracts": 25,
                "best_no_ask_cents": 40,
                "best_no_ask_size_contracts": 25,
                "yes_spread_cents": 3,
                "no_spread_cents": 4,
                "is_crossed": False,
            }
        },
        {
            "SOL": {
                "asset": "SOL",
                "spot_usd": 99.0,
                "annualized_volatility": 0.8,
                "provider": "fixture",
                "observed_at_utc": "2026-05-18T20:29:50Z",
                "source_url": "fixture://sol",
            }
        },
        now=datetime(2026, 5, 18, 20, 30, tzinfo=timezone.utc),
        max_hours=900,
        size_usd=1.0,
        min_edge_after_costs_cents=2.0,
        estimated_cost_cents=1.7,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["side"] == "YES"
    assert candidate["selected_executable_side"] == "YES"
    assert candidate["simulated_size_usd"] == 0.0
    assert candidate["quality_gates"]["sts_crypto_regime_inverse_repair_shadowed"] is True
    assert candidate["sts_crypto_regime_inverse_repair_shadowed"] is True
    assert candidate["sts_crypto_regime_selector_experiment"]["original_selected_side"] == "NO"
    assert candidate["sts_crypto_regime_selector_experiment"]["executed_shadow_side"] == "YES"
    assert candidate["sts_crypto_regime_selector_experiment"]["proof_credit"] == "none_forward_inverse_repair_shadow"
    assert candidate["baseline_comparison"]["inverse_repair_shadow_forces_shadow_only"] is True
    assert candidate["live_order_allowed"] is False


def test_crypto_evidence_matches_hour_edge_regime_attribution():
    crypto = load_module("kalshi_crypto_evidence_hour_edge_regime_test", ROOT / "kalshi_crypto_evidence.py")
    regime_id = "regime:asset=DOGE|side=yes|hour=hour_06_11|edge=edge_small"
    experiment = {
        "experiment_id": f"crypto-regime-selector::{regime_id}",
        "regime_id": regime_id,
        "selector_score": 1.2,
        "live_order_allowed": False,
    }

    attribution = crypto._regime_selector_attribution(
        parsed={"asset": "DOGE"},
        side="YES",
        selected_side_fair_probability=0.6,
        market_implied_probability=0.5,
        spread_cents=4,
        depth_contracts=100,
        decision_timestamp_utc="2026-05-30T08:00:10Z",
        feature_cutoff_utc="2026-05-30T08:00:01Z",
        experiments=[experiment],
        probability_recalibration=({}, {}),
    )

    assert attribution is not None
    assert attribution["regime_id"] == regime_id
    assert regime_id in attribution["matched_regime_ids"]
    assert attribution["counts_for_live_readiness"] is False
    assert attribution["live_order_allowed"] is False


def test_crypto_regime_selector_outcomes_are_shadow_only(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_outcomes_test", ROOT / "kalshi_sts_crypto_regime_selector_outcomes.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    selector_path = tmp_path / "selector.json"
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    rows = []
    for idx in range(40):
        won = 1 if idx % 2 == 0 else 0
        rows.append({
            "row_id": f"crypto-{idx}",
            "domain": "crypto",
            "label_available": True,
            "market_ticker": "KXETH15M-TEST",
            "segment_key": "crypto|ETH|crypto_price_threshold|no",
            "selected_side": "NO",
            "candidate_probability": 0.55,
            "market_probability": 0.52,
            "outcome_yes": 0 if won else 1,
            "selected_side_won": won,
            "paper_pnl_usd": 0.2 if won else -0.1,
            "spread_cents": 1,
            "depth_contracts": 20,
            "markov_feature_present": 0,
            "decision_timestamp_utc": f"2026-05-18T12:{idx % 60:02d}:20Z",
            "feature_cutoff_utc": f"2026-05-18T12:{idx % 60:02d}:10Z",
            "live_order_allowed": False,
        })
    rows_path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    selector_path.write_text(json.dumps({
        "ok": True,
        "active_shadow_experiments": [
            {
                "experiment_id": "crypto-regime-selector::regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin",
                "regime_id": "regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin",
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_REGIME_SELECTOR_PATH", selector_path)
    decisions_path.write_text(json.dumps({
        "decision_id": "crypto-forward-regime-test",
        "market_category": "crypto",
        "market_ticker": "KXETH15M-TEST",
        "side": "NO",
        "selected_side_fair_probability": 0.55,
        "market_price_probability": 0.52,
        "paper_fill_price_cents": 52,
        "simulated_size_usd": 1.0,
        "sts_crypto_regime_selector_experiment": {
            "experiment_id": "crypto-regime-selector::regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin",
            "regime_id": "regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin",
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }) + "\n")
    outcomes_path.write_text(json.dumps({
        "decision_id": "crypto-forward-regime-test",
        "outcome_yes": 0,
        "resolved": True,
        "live_order_allowed": False,
    }) + "\n")
    monkeypatch.setattr(regime, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(regime, "PAPER_OUTCOMES_PATH", outcomes_path)

    payload = regime.build_outcomes()

    assert payload["experiment_count"] == 2
    assert payload["forward_recorded_resolved_count"] == 1
    assert payload["forward_recorded_pending_count"] == 0
    assert payload["forward_recorded_due_pending_count"] == 0
    assert payload["retrospective_resolved_count"] == 40
    assert payload["resolved_attributed_count"] == 41
    experiment = payload["retrospective_experiments"][0]
    assert experiment["proof_credit"] == "none_retrospective_regime_shadow"
    assert experiment["counts_for_live_readiness"] is False
    assert experiment["live_order_allowed"] is False
    forward = payload["forward_recorded_experiments"][0]
    assert forward["proof_credit"] == "none_forward_recorded_shadow_unreviewed"
    assert forward["counts_for_live_readiness"] is False
    assert forward["live_order_allowed"] is False



def test_crypto_regime_selector_outcomes_use_recalibrated_regime_keys(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_outcomes_recal_test", ROOT / "kalshi_sts_crypto_regime_selector_outcomes.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    selector_path = tmp_path / "selector.json"
    recalibrator_path = tmp_path / "recalibrator.json"
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    regime_id = "regime:asset=DOGE|side=yes|prob=mid_prob|market=balanced"
    rows_path.write_text(json.dumps({
        "row_id": "crypto-recal-match",
        "domain": "crypto",
        "label_available": True,
        "market_ticker": "KXDOGE15M-TEST",
        "selected_side": "YES",
        "candidate_probability": 0.82,
        "market_probability": 0.51,
        "outcome_yes": 1,
        "selected_side_won": 1,
        "paper_pnl_usd": 0.4,
        "spread_cents": 1,
        "depth_contracts": 20,
        "markov_feature_present": 0,
        "decision_timestamp_utc": "2026-05-30T22:00:10Z",
        "feature_cutoff_utc": "2026-05-30T22:00:01Z",
        "live_order_allowed": False,
    }) + "\n")
    selector_path.write_text(json.dumps({
        "ok": True,
        "active_shadow_experiments": [
            {
                "experiment_id": f"crypto-regime-selector::{regime_id}",
                "regime_id": regime_id,
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    recalibrator_path.write_text(json.dumps({
        "ok": True,
        "bucket_recalibration": [],
        "context_recalibration": [
            {
                "context_key": "asset_side:DOGE|yes",
                "buckets": [
                    {
                        "bucket": "80_90",
                        "recalibrated_probability": 0.55,
                        "enough_rows": True,
                        "live_order_allowed": False,
                    }
                ],
                "live_order_allowed": False,
            }
        ],
        "live_order_allowed": False,
    }))
    decisions_path.write_text("")
    outcomes_path.write_text("")
    shadow_outcomes_path.write_text("")
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_REGIME_SELECTOR_PATH", selector_path)
    monkeypatch.setattr(regime, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(regime, "PAPER_OUTCOMES_PATH", outcomes_path)
    monkeypatch.setattr(regime, "SHADOW_OUTCOMES_PATH", shadow_outcomes_path)
    monkeypatch.setattr(regime.regime_selector, "STS_CRYPTO_PROBABILITY_RECALIBRATOR_PATH", recalibrator_path)

    payload = regime.build_outcomes()

    assert payload["retrospective_resolved_count"] == 1
    experiment = payload["retrospective_experiments"][0]
    assert experiment["regime_id"] == regime_id
    assert experiment["candidate_brier"] == 0.2025
    assert experiment["market_brier"] == 0.2401
    assert experiment["market_brier_uplift"] == 0.0376
    assert experiment["recalibration_source_counts"] == {"asset_side:DOGE|yes": 1}
    assert experiment["counts_for_live_readiness"] is False
    assert experiment["live_order_allowed"] is False


def test_crypto_regime_selector_outcomes_preserve_coverage_probe_credit(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_outcomes_coverage_test", ROOT / "kalshi_sts_crypto_regime_selector_outcomes.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    selector_path = tmp_path / "selector.json"
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    regime_id = "regime:asset=XRP|side=no|hour=hour_18_23|edge=edge_mid"
    rows_path.write_text("")
    selector_path.write_text(json.dumps({"active_shadow_experiments": [], "live_order_allowed": False}))
    decisions = [
        {
            "decision_id": "coverage-resolved",
            "market_ticker": "KXXRP15M-TEST",
            "side": "NO",
            "selected_side_fair_probability": 0.33,
            "market_price_probability": 0.45,
            "paper_fill_price_cents": 45,
            "simulated_size_usd": 1.0,
            "sts_crypto_regime_selector_experiment": {
                "experiment_id": f"crypto-regime-coverage::{regime_id}",
                "regime_id": regime_id,
                "experiment_status": "coverage_shadow_only",
                "proof_credit": "none_forward_coverage_probe",
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
        {
            "decision_id": "coverage-pending",
            "market_ticker": "KXXRP15M-TEST2",
            "side": "NO",
            "expected_result_known_time_utc": "2026-05-30T23:05:00Z",
            "sts_crypto_regime_selector_experiment": {
                "experiment_id": f"crypto-regime-coverage::{regime_id}",
                "regime_id": regime_id,
                "experiment_status": "coverage_shadow_only",
                "proof_credit": "none_forward_coverage_probe",
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
    ]
    decisions_path.write_text("".join(json.dumps(row) + "\n" for row in decisions))
    outcomes_path.write_text("")
    shadow_outcomes_path.write_text(json.dumps({
        "decision_id": "coverage-resolved",
        "resolved": True,
        "outcome_yes": 1,
        "live_order_allowed": False,
    }) + "\n")
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_REGIME_SELECTOR_PATH", selector_path)
    monkeypatch.setattr(regime, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(regime, "PAPER_OUTCOMES_PATH", outcomes_path)
    monkeypatch.setattr(regime, "SHADOW_OUTCOMES_PATH", shadow_outcomes_path)

    payload = regime.build_outcomes()

    assert payload["forward_recorded_coverage_probe_resolved_count"] == 1
    assert payload["forward_recorded_coverage_probe_pending_count"] == 1
    assert payload["forward_recorded_proof_credit_counts"]["resolved:none_forward_coverage_probe"] == 1
    assert payload["forward_recorded_proof_credit_counts"]["pending:none_forward_coverage_probe"] == 1
    assert payload["forward_recorded_coverage_probe_due_count"] in {0, 1}
    assert payload["resolver_ready"] is bool(payload["forward_recorded_due_pending_count"] > 0)
    assert payload["resolver_readiness_reason"] in {
        "due_forward_regime_rows_ready_for_source_backed_resolution",
        "waiting_for_expected_result_known_time_to_avoid_lookahead",
        "no_forward_recorded_pending_regime_rows",
    }
    forward = payload["forward_recorded_experiments"][0]
    assert forward["proof_credit"] == "none_forward_coverage_probe"
    assert forward["experiment_status"] == "coverage_shadow_only"
    assert payload["forward_recorded_pending_samples"][0]["proof_credit"] == "none_forward_coverage_probe"
    assert forward["counts_for_live_readiness"] is False
    assert forward["live_order_allowed"] is False


def test_crypto_regime_selector_outcomes_counts_inverse_repair_shadow_credit(tmp_path, monkeypatch):
    regime = load_module("kalshi_sts_crypto_regime_selector_outcomes_inverse_credit_test", ROOT / "kalshi_sts_crypto_regime_selector_outcomes.py")
    rows_path = tmp_path / "sts_feature_rows.jsonl"
    selector_path = tmp_path / "selector.json"
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    regime_id = "regime:asset=SOL|side=no|prob=mid_prob|market=balanced"
    rows_path.write_text("")
    selector_path.write_text(json.dumps({"active_shadow_experiments": [], "live_order_allowed": False}))
    decisions = [
        {
            "decision_id": "inverse-repair-resolved",
            "market_ticker": "KXSOL15M-TEST",
            "side": "YES",
            "selected_side_fair_probability": 0.57,
            "market_price_probability": 0.48,
            "paper_fill_price_cents": 48,
            "simulated_size_usd": 0.0,
            "sts_crypto_regime_inverse_repair_shadowed": True,
            "sts_crypto_regime_selector_experiment": {
                "experiment_id": f"crypto-regime-inverse-repair::{regime_id}",
                "regime_id": regime_id,
                "experiment_status": "inverse_forward_shadow_only",
                "proof_credit": "none_forward_inverse_repair_shadow",
                "original_selected_side": "NO",
                "executed_shadow_side": "YES",
                "selected_side_override_executed": True,
                "recalibrated_selected_side_fair_probability": 0.2,
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
        {
            "decision_id": "inverse-repair-pending",
            "market_ticker": "KXSOL15M-TEST2",
            "side": "YES",
            "expected_result_known_time_utc": "2026-05-30T23:05:00Z",
            "sts_crypto_regime_inverse_repair_shadowed": True,
            "sts_crypto_regime_selector_experiment": {
                "experiment_id": f"crypto-regime-inverse-repair::{regime_id}",
                "regime_id": regime_id,
                "experiment_status": "inverse_forward_shadow_only",
                "proof_credit": "none_forward_inverse_repair_shadow",
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        },
    ]
    decisions_path.write_text("".join(json.dumps(row) + "\n" for row in decisions))
    outcomes_path.write_text("")
    shadow_outcomes_path.write_text(json.dumps({
        "decision_id": "inverse-repair-resolved",
        "resolved": True,
        "outcome_yes": 1,
        "live_order_allowed": False,
    }) + "\n")
    monkeypatch.setattr(regime, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(regime, "STS_CRYPTO_REGIME_SELECTOR_PATH", selector_path)
    monkeypatch.setattr(regime, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(regime, "PAPER_OUTCOMES_PATH", outcomes_path)
    monkeypatch.setattr(regime, "SHADOW_OUTCOMES_PATH", shadow_outcomes_path)

    payload = regime.build_outcomes()

    assert payload["forward_recorded_inverse_repair_shadow_resolved_count"] == 1
    assert payload["forward_recorded_inverse_repair_shadow_pending_count"] == 1
    assert payload["forward_recorded_proof_credit_counts"]["resolved:none_forward_inverse_repair_shadow"] == 1
    assert payload["forward_recorded_proof_credit_counts"]["pending:none_forward_inverse_repair_shadow"] == 1
    assert payload["forward_recorded_inverse_repair_shadow_due_count"] in {0, 1}
    proof_gate = payload["inverse_repair_shadow_proof_gate"]
    assert proof_gate["status"] in {
        "resolve_due_inverse_repair_shadows",
        "waiting_for_inverse_repair_shadow_outcomes",
        "inverse_repair_shadow_proof_blocked",
    }
    assert proof_gate["resolved_count"] == 1
    assert proof_gate["pending_count"] == 1
    assert proof_gate["target_resolved_shadow_outcomes"] == 10
    assert proof_gate["counts_for_live_readiness"] is False
    assert proof_gate["can_authorize_trade"] is False
    assert proof_gate["live_order_allowed"] is False
    assert "inverse_repair_shadow_sample_too_small" in proof_gate["blockers"]
    forward = payload["forward_recorded_experiments"][0]
    assert forward["proof_credit"] == "none_forward_inverse_repair_shadow"
    assert forward["experiment_status"] == "inverse_forward_shadow_only"
    assert abs(forward["candidate_brier"] - 0.04) < 0.000001
    assert forward["market_brier_uplift"] > 0
    assert forward["counts_for_live_readiness"] is False
    assert forward["live_order_allowed"] is False


def test_crypto_regime_outcome_resolver_preserves_coverage_probe_credit(tmp_path, monkeypatch):
    resolver = load_module("kalshi_sts_crypto_regime_outcome_resolver_coverage_test", ROOT / "kalshi_sts_crypto_regime_outcome_resolver.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    paper_outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    output_path = tmp_path / "resolution.json"
    regime_id = "regime:asset=XRP|side=no|hour=hour_18_23|edge=edge_mid"
    decisions_path.write_text(json.dumps({
        "decision_id": "coverage-due",
        "market_ticker": "KXXRP15M-TEST",
        "side": "NO",
        "selected_side": "NO",
        "expected_result_known_time_utc": "2026-05-30T22:00:00Z",
        "sts_crypto_regime_selector_experiment": {
            "experiment_id": f"crypto-regime-coverage::{regime_id}",
            "regime_id": regime_id,
            "experiment_status": "coverage_shadow_only",
            "proof_credit": "none_forward_coverage_probe",
            "live_order_allowed": False,
        },
        "live_order_allowed": False,
    }) + "\n")
    paper_outcomes_path.write_text("")
    shadow_outcomes_path.write_text("")
    monkeypatch.setattr(resolver, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(resolver, "PAPER_OUTCOMES_PATH", paper_outcomes_path)
    monkeypatch.setattr(resolver, "SHADOW_OUTCOMES_PATH", shadow_outcomes_path)
    monkeypatch.setattr(resolver, "STS_CRYPTO_REGIME_OUTCOME_RESOLUTION_PATH", output_path)
    monkeypatch.setattr(resolver, "utc_now", lambda: "2026-05-30T23:10:00Z")
    monkeypatch.setattr(
        resolver,
        "kalshi_get",
        lambda path: {"ok": True, "data": {"market": {"ticker": "KXXRP15M-TEST", "result": "yes", "status": "settled"}}},
    )

    payload = resolver.resolve_due_regime_rows()
    written = [json.loads(line) for line in shadow_outcomes_path.read_text().splitlines() if line.strip()]

    assert payload["resolved_count"] == 1
    outcome = written[0]
    assert outcome["decision_id"] == "coverage-due"
    assert outcome["selected_side"] == "NO"
    assert outcome["proof_credit"] == "none_forward_coverage_probe"
    assert outcome["experiment_status"] == "coverage_shadow_only"
    assert outcome["counts_for_live_readiness"] is False
    assert outcome["live_order_allowed"] is False
    assert payload["live_order_allowed"] is False


def test_sts_orchestrator_refreshes_regime_outcomes_before_selector(tmp_path, monkeypatch):
    orchestrator = load_module("kalshi_sts_orchestrator_regime_refresh_test", ROOT / "kalshi_sts_orchestrator.py")
    order = []
    written = []

    class Outcomes:
        STS_CRYPTO_REGIME_SELECTOR_OUTCOMES_PATH = tmp_path / "outcomes.json"

        @staticmethod
        def build_outcomes():
            order.append("outcomes")
            return {"resolved_attributed_count": len([item for item in order if item == "outcomes"]), "live_order_allowed": False}

        @staticmethod
        def atomic_write_json(path, payload):
            written.append((path, payload))

    class Selector:
        STS_CRYPTO_REGIME_SELECTOR_PATH = tmp_path / "selector.json"

        @staticmethod
        def build_regime_selector():
            order.append("selector")
            return {"candidate_experiment_count": 0, "live_order_allowed": False}

        @staticmethod
        def atomic_write_json(path, payload):
            written.append((path, payload))

    class Repair:
        STS_CRYPTO_REGIME_INVERSE_REPAIR_PATH = tmp_path / "repair.json"

        @staticmethod
        def build_inverse_repair():
            order.append("repair")
            return {"repair_count": 0, "live_order_allowed": False}

        @staticmethod
        def atomic_write_json(path, payload):
            written.append((path, payload))

    monkeypatch.setattr(orchestrator, "kalshi_sts_crypto_regime_selector_outcomes", Outcomes)
    monkeypatch.setattr(orchestrator, "kalshi_sts_crypto_regime_selector", Selector)
    monkeypatch.setattr(orchestrator, "kalshi_sts_crypto_regime_inverse_repair", Repair)

    payload = orchestrator._refresh_crypto_regime_selector_stack(dry_run=False)

    assert order == ["outcomes", "selector", "outcomes", "repair"]
    assert payload["outcomes_after"]["resolved_attributed_count"] == 2
    assert payload["selector"]["live_order_allowed"] is False
    assert payload["inverse_repair"]["live_order_allowed"] is False
    assert len(written) == 4




def test_crypto_regime_inverse_repair_tests_inverse_for_losing_forward_rows(tmp_path, monkeypatch):
    repair = load_module("kalshi_sts_crypto_regime_inverse_repair_test", ROOT / "kalshi_sts_crypto_regime_inverse_repair.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    regime_id = "regime:asset=SOL|side=no|prob=mid_prob|market=balanced"
    decisions = []
    outcomes = []
    for idx in range(3):
        decision_id = f"crypto-regime-loss-{idx}"
        decisions.append({
            "decision_id": decision_id,
            "market_ticker": "KXSOL15M-TEST",
            "side": "NO",
            "paper_fill_price_cents": 45,
            "simulated_size_usd": 1.0,
            "sts_crypto_regime_selector_experiment": {
                "regime_id": regime_id,
                "experiment_id": f"crypto-regime-selector::{regime_id}",
                "live_order_allowed": False,
            },
            "live_order_allowed": False,
        })
        outcomes.append({
            "decision_id": decision_id,
            "resolved": True,
            "outcome_yes": 1,
            "live_order_allowed": False,
        })
    decisions_path.write_text("".join(json.dumps(row) + "\n" for row in decisions))
    outcomes_path.write_text("")
    shadow_outcomes_path.write_text("".join(json.dumps(row) + "\n" for row in outcomes))
    monkeypatch.setattr(repair, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(repair, "PAPER_OUTCOMES_PATH", outcomes_path)
    monkeypatch.setattr(repair, "SHADOW_OUTCOMES_PATH", shadow_outcomes_path)

    payload = repair.build_inverse_repair()

    assert payload["repair_count"] == 1
    row = payload["repairs"][0]
    assert row["recommended_action"] == "test_inverse_forward_shadow"
    assert row["selected_paper_pnl_usd"] < 0
    assert row["inverse_paper_pnl_usd"] > 0
    assert row["counts_for_live_readiness"] is False
    assert row["live_order_allowed"] is False


def test_crypto_regime_inverse_repair_tracks_abstain_blocked_rows(tmp_path, monkeypatch):
    repair = load_module("kalshi_sts_crypto_regime_inverse_repair_abstain_test", ROOT / "kalshi_sts_crypto_regime_inverse_repair.py")
    decisions_path = tmp_path / "paper_decisions.jsonl"
    outcomes_path = tmp_path / "paper_outcomes.jsonl"
    shadow_outcomes_path = tmp_path / "shadow_outcomes.jsonl"
    regime_id = "regime:asset=ETH|side=no|spread=spread_tight|depth=depth_thin"
    decisions = [
        {
            "decision_id": "abstain-block-resolved",
            "market_ticker": "KXETH15M-TEST",
            "side": "NO",
            "paper_fill_price_cents": 40,
            "simulated_size_usd": 1.0,
            "sts_crypto_regime_selector_experiment": None,
            "sts_crypto_regime_repair_policy": {
                "regime_id": regime_id,
                "recommended_action": "prefer_abstain_until_repaired",
                "live_order_allowed": False,
            },
            "expected_result_known_time_utc": "2026-05-30T23:05:00Z",
            "live_order_allowed": False,
        },
        {
            "decision_id": "abstain-block-pending",
            "market_ticker": "KXETH15M-TEST2",
            "side": "NO",
            "paper_fill_price_cents": 40,
            "simulated_size_usd": 1.0,
            "sts_crypto_regime_selector_experiment": None,
            "sts_crypto_regime_repair_policy": {
                "regime_id": regime_id,
                "recommended_action": "prefer_abstain_until_repaired",
                "live_order_allowed": False,
            },
            "expected_result_known_time_utc": "2026-05-30T23:05:00Z",
            "live_order_allowed": False,
        },
    ]
    outcomes = [{"decision_id": "abstain-block-resolved", "resolved": True, "outcome_yes": 1, "live_order_allowed": False}]
    decisions_path.write_text("".join(json.dumps(row) + "\n" for row in decisions))
    outcomes_path.write_text("")
    shadow_outcomes_path.write_text("".join(json.dumps(row) + "\n" for row in outcomes))
    monkeypatch.setattr(repair, "PAPER_DECISIONS_PATH", decisions_path)
    monkeypatch.setattr(repair, "PAPER_OUTCOMES_PATH", outcomes_path)
    monkeypatch.setattr(repair, "SHADOW_OUTCOMES_PATH", shadow_outcomes_path)
    monkeypatch.setattr(repair, "utc_now", lambda: "2026-05-30T23:10:00Z")

    payload = repair.build_inverse_repair()

    assert payload["scanned_abstain_repair_block_outcome_count"] == 1
    assert payload["pending_abstain_repair_block_count"] == 1
    assert payload["due_pending_abstain_repair_block_count"] == 1
    assert payload["pending_abstain_repair_block_samples"][0]["regime_id"] == regime_id
    assert payload["repair_count"] == 1
    row = payload["repairs"][0]
    assert row["regime_id"] == regime_id
    assert row["selected_paper_pnl_usd"] < 0
    assert row["recommended_action"] == "prefer_abstain_until_repaired"
    assert row["live_order_allowed"] is False
    assert payload["live_order_allowed"] is False


def test_sts_domain_optimizer_prioritizes_fresh_crypto_windows(tmp_path, monkeypatch):
    optimizer = load_module("kalshi_sts_domain_optimizer_fresh_crypto", ROOT / "kalshi_sts_domain_optimizer.py")
    eta_path = tmp_path / "eta.json"
    promotion_path = tmp_path / "promotion.json"
    eta_path.write_text(json.dumps({
        "domain_paper_trading_eta": {
            "crypto": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "clean_evidence_failed", "real_data_basis": {"scanned_candidate_count": 30}},
        }
    }))
    promotion_path.write_text(json.dumps({
        "per_domain_clean_evidence_blockers": {
            "crypto": [{"blocker": "result_time_already_due", "count": 29, "live_order_allowed": False}],
        },
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(optimizer, "STS_READINESS_ETA_PATH", eta_path)
    monkeypatch.setattr(optimizer, "STS_FORWARD_PAPER_PROMOTION_PATH", promotion_path)

    payload = optimizer.build_optimizer()

    crypto = payload["domain_actions"][0]
    assert crypto["optimizer_action"] == "crypto_fresh_non_expired_window_capture"
    assert crypto["top_clean_evidence_blocker"] == "result_time_already_due"
    assert payload["live_order_allowed"] is False


def test_sts_domain_optimizer_preserves_domain_first_actions(tmp_path, monkeypatch):
    optimizer = load_module("kalshi_sts_domain_optimizer_test", ROOT / "kalshi_sts_domain_optimizer.py")
    eta_path = tmp_path / "eta.json"
    eta_path.write_text(json.dumps({
        "domain_paper_trading_eta": {
            "weather": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "market_random_no_trade_baselines_not_beaten", "real_data_basis": {"scanned_candidate_count": 10}},
            "crypto": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "clean_evidence_failed", "real_data_basis": {"scanned_candidate_count": 20}},
            "economics": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "edge_after_costs_not_positive", "real_data_basis": {"scanned_candidate_count": 5}},
        }
    }))
    monkeypatch.setattr(optimizer, "STS_READINESS_ETA_PATH", eta_path)

    payload = optimizer.build_optimizer()

    by_domain = {row["domain"]: row for row in payload["domain_actions"]}
    assert by_domain["weather"]["optimizer_action"] == "weather_baseline_filter_tightening"
    assert by_domain["crypto"]["optimizer_action"] == "crypto_clean_evidence_lineage_repair"
    assert by_domain["economics"]["optimizer_action"] == "edge_after_costs_filter"
    assert payload["domain_learning_policy"]["future_market_categories_separated"] is True
    assert payload["live_order_allowed"] is False


def test_sts_domain_optimizer_prioritizes_weather_and_crypto_over_sports(tmp_path, monkeypatch):
    optimizer = load_module("kalshi_sts_domain_optimizer_weather_crypto_priority", ROOT / "kalshi_sts_domain_optimizer.py")
    eta_path = tmp_path / "eta.json"
    promotion_path = tmp_path / "promotion.json"
    eta_path.write_text(json.dumps({
        "domain_paper_trading_eta": {
            "sports": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "markov_risk_overlay_blocked", "real_data_basis": {"scanned_candidate_count": 120}},
            "weather": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "market_random_no_trade_baselines_not_beaten", "real_data_basis": {"scanned_candidate_count": 20}},
            "crypto": {"status": "blocked", "eta_label": "Blocked", "top_blocker": "clean_evidence_failed", "real_data_basis": {"scanned_candidate_count": 5}},
        }
    }))
    promotion_path.write_text(json.dumps({
        "domain_feature_rows": {"weather": 18, "crypto": 4, "sports": 300},
        "live_order_allowed": False,
    }))
    monkeypatch.setattr(optimizer, "STS_READINESS_ETA_PATH", eta_path)
    monkeypatch.setattr(optimizer, "STS_FORWARD_PAPER_PROMOTION_PATH", promotion_path)

    payload = optimizer.build_optimizer()
    priority = payload["priority_actions"]
    assert [row["domain"] for row in priority[:2]] == ["crypto", "weather"]
    assert priority[0]["learning_priority_score"] >= priority[1]["learning_priority_score"]


def test_sts_domain_learning_optimizer_prefers_weather_crypto_lane_scores(tmp_path, monkeypatch):
    optimizer = load_module("kalshi_sts_domain_learning_optimizer_weather_crypto_priority", ROOT / "kalshi_sts_domain_learning_optimizer.py")
    eta_path = tmp_path / "eta.json"
    promo_path = tmp_path / "promotion.json"
    rows_path = tmp_path / "rows.jsonl"
    model_path = tmp_path / "model.json"
    eta_path.write_text(json.dumps({
        "domain_paper_trading_eta": {
            "sports": {"domain": "sports", "top_blocker": "edge_after_costs_not_positive", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 30}},
            "weather": {"domain": "weather", "top_blocker": "market_random_no_trade_baselines_not_beaten", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 1}},
            "crypto": {"domain": "crypto", "top_blocker": "clean_evidence_failed", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 1}},
        }
    }))
    promo_path.write_text(json.dumps({"domain_scan_counts": {"sports": 200, "weather": 2, "crypto": 2}, "live_order_allowed": False}))
    rows_path.write_text("\n".join([json.dumps({"domain": "crypto"}), json.dumps({"domain": "weather"})]) + "\n")
    model_path.write_text(json.dumps({"status": "ok", "champion_status": "paper"}))
    monkeypatch.setattr(optimizer, "STS_READINESS_ETA_PATH", eta_path)
    monkeypatch.setattr(optimizer, "STS_FORWARD_PAPER_PROMOTION_PATH", promo_path)
    monkeypatch.setattr(optimizer, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(optimizer, "STS_MODEL_PATH", model_path)

    payload = optimizer.build_optimizer()
    lanes = payload["domain_lanes"]
    assert lanes[0]["domain"] in {"weather", "crypto"}
    assert lanes[0]["learning_priority_score"] >= lanes[2]["learning_priority_score"]
    assert payload["best_domain_to_improve_next"]["domain"] in {"weather", "crypto"}


def test_sts_domain_learning_optimizer_scores_recent_blocked_candidates(tmp_path, monkeypatch):
    optimizer = load_module("kalshi_sts_domain_learning_optimizer_blocked_pressure", ROOT / "kalshi_sts_domain_learning_optimizer.py")
    now = datetime(2026, 5, 29, 12, 0, 0, tzinfo=timezone.utc)
    eta_path = tmp_path / "eta.json"
    promo_path = tmp_path / "promotion.json"
    rows_path = tmp_path / "rows.jsonl"
    model_path = tmp_path / "model.json"
    eta_path.write_text(json.dumps({
        "domain_paper_trading_eta": {
            "sports": {"domain": "sports", "top_blocker": "edge_after_costs_not_positive", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 5}},
            "weather": {"domain": "weather", "top_blocker": "market_random_no_trade_baselines_not_beaten", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 8}},
            "crypto": {"domain": "crypto", "top_blocker": "clean_evidence_failed", "eta_label": "Blocked", "real_data_basis": {"scanned_candidate_count": 4}},
        }
    }))
    promo_path.write_text(json.dumps({
        "domain_scan_counts": {"sports": 30, "weather": 2, "crypto": 1},
        "blocked_candidates": [
            {"domain": "weather", "source_timestamp_utc": (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision_id": "w1"},
            {"domain": "weather", "source_timestamp_utc": (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision_id": "w2"},
            {"domain": "weather", "source_timestamp_utc": (now - timedelta(hours=18)).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision_id": "w3"},
            {"domain": "crypto", "source_timestamp_utc": (now - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision_id": "c1"},
            {"domain": "crypto", "source_timestamp_utc": (now - timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision_id": "c2"},
            {"domain": "crypto", "source_timestamp_utc": (now - timedelta(hours=25)).strftime("%Y-%m-%dT%H:%M:%SZ"), "decision_id": "c3"},
        ],
        "live_order_allowed": False,
    }))
    rows_path.write_text("\n".join([json.dumps({"domain": "crypto"}), json.dumps({"domain": "weather"}), json.dumps({"domain": "weather"})]) + "\n")
    model_path.write_text(json.dumps({"status": "ok", "champion_status": "paper"}))
    monkeypatch.setattr(optimizer, "STS_READINESS_ETA_PATH", eta_path)
    monkeypatch.setattr(optimizer, "STS_FORWARD_PAPER_PROMOTION_PATH", promo_path)
    monkeypatch.setattr(optimizer, "STS_FEATURE_ROWS_PATH", rows_path)
    monkeypatch.setattr(optimizer, "STS_MODEL_PATH", model_path)
    monkeypatch.setattr(optimizer, "utc_now", lambda: now.strftime("%Y-%m-%dT%H:%M:%SZ"))

    payload = optimizer.build_optimizer()
    by_domain = {row["domain"]: row for row in payload["domain_lanes"]}

    assert by_domain["weather"]["blocked_candidate_count"] == 3
    assert by_domain["weather"]["blocked_candidate_count_12h"] == 2
    assert by_domain["weather"]["blocked_candidate_count_24h"] == 3
    assert by_domain["crypto"]["blocked_candidate_count"] == 3
    assert by_domain["crypto"]["blocked_candidate_count_12h"] == 2
    assert by_domain["crypto"]["blocked_candidate_count_24h"] == 2
    assert by_domain["weather"]["recent_blocked_pressure"] > by_domain["sports"]["recent_blocked_pressure"]
    assert by_domain["crypto"]["recent_blocked_pressure"] > by_domain["sports"]["recent_blocked_pressure"]
    assert payload["best_domain_to_improve_next"]["domain"] in {"weather", "crypto", "sports"}


def test_mlx_diagnostic_probe_is_read_only_and_validation_aware(tmp_path):
    mlx_diag = load_module("kalshi_mlx_diagnostic_unit", ROOT / "kalshi_mlx_diagnostic.py")
    source_path = tmp_path / "source.jsonl"
    validation_path = tmp_path / "validation.jsonl"
    source_path.write_text("".join(json.dumps({"decision_id": f"source-{index}"}) + "\n" for index in range(30)))
    validation_path.write_text("".join(json.dumps({"decision_id": f"validation-{index}"}) + "\n" for index in range(30)))

    payload = mlx_diag.build_diagnostic(source_jsonl=source_path, validation_rows=validation_path)

    assert payload["ok"] is True
    assert payload["diagnostic_only"] is True
    assert payload["not_trade_signal"] is True
    assert payload["live_order_allowed"] is False
    assert payload["can_authorize_trade"] is False
    assert payload["counts_for_validation_credit"] is False
    assert payload["sts_authority"] is False
    assert payload["ml_trained"] is False
    assert payload["production_model"] is False
    assert payload["evidence_chain"]["source_row_count"] == 30
    assert payload["evidence_chain"]["validation_row_count"] == 30
    assert payload["evidence_chain"]["validation_rows_ready"] is True
    assert payload["evidence_chain"]["source_backed_outcomes_ready"] is False
    assert payload["next_gate"] == "source_backed_outcomes_required_before_mlx_challenger"
    _assert_no_live_true(payload)


def test_mlx_diagnostic_tracks_outcomes_and_separated_review(tmp_path):
    mlx_diag = load_module("kalshi_mlx_diagnostic_ready_unit", ROOT / "kalshi_mlx_diagnostic.py")
    source_path = tmp_path / "source.jsonl"
    validation_path = tmp_path / "validation.jsonl"
    outcomes_path = tmp_path / "outcomes.jsonl"
    review_path = tmp_path / "review.json"
    source_path.write_text("".join(json.dumps({"decision_id": f"source-{index}"}) + "\n" for index in range(30)))
    validation_path.write_text("".join(json.dumps({"decision_id": f"validation-{index}"}) + "\n" for index in range(30)))
    outcomes_path.write_text("".join(json.dumps({"decision_id": f"outcome-{index}"}) + "\n" for index in range(30)))
    review_path.write_text(
        json.dumps(
            {
                "separated_validation_review_complete": True,
                "review_row_count": 30,
                "source_backed_validation_review_count": 30,
                "live_order_allowed": False,
                "write_capable_kalshi_endpoint_called": False,
            }
        )
    )

    payload = mlx_diag.build_diagnostic(
        source_jsonl=source_path,
        validation_rows=validation_path,
        outcomes_jsonl=outcomes_path,
        separated_review_json=review_path,
    )

    evidence = payload["evidence_chain"]
    assert evidence["source_ready_for_validation"] is True
    assert evidence["validation_rows_ready"] is True
    assert evidence["source_backed_outcome_count"] == 30
    assert evidence["source_backed_outcomes_ready"] is True
    assert evidence["separated_review_row_count"] == 30
    assert evidence["separated_validation_ready"] is True
    assert evidence["evidence_chain_ready_for_mlx_challenger"] is True
    assert payload["next_gate"] in {
        "mlx_runtime_connection_required_before_mlx_challenger",
        "snapshot_only_challenger_requires_separate_explicit_approval",
    }
    assert payload["ml_trained"] is False
    assert payload["production_model"] is False
    _assert_no_live_true(payload)


def test_dashboard_mlx_diagnostic_fallback_and_loaded_state_are_safe(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_mlx_diagnostic", ROOT / "kalshi_dashboard.py")
    missing_path = tmp_path / "missing_mlx_diagnostic.json"
    monkeypatch.setattr(dashboard, "MLX_DIAGNOSTIC_PATH", missing_path)

    fallback = dashboard._mlx_diagnostic_snapshot({})
    assert fallback["status"] == "not_generated"
    assert fallback["artifact_exists"] is False
    assert fallback["live_order_allowed"] is False
    assert fallback["counts_for_validation_credit"] is False
    assert fallback["can_authorize_trade"] is False

    missing_path.write_text(json.dumps({"ok": True, "status": "diagnostic_runtime_ready", "runtime": {"available": True, "mlx_importable": True, "mlx_core_importable": True}, "evidence_chain": {"source_row_count": 30, "source_unique_key_count": 30, "source_ready_for_validation": True, "validation_row_count": 30, "validation_unique_key_count": 30, "validation_rows_ready": True}, "live_order_allowed": True}))
    loaded = dashboard._mlx_diagnostic_snapshot(json.loads(missing_path.read_text()))
    assert loaded["status"] == "diagnostic_runtime_ready"
    assert loaded["artifact_exists"] is True
    assert loaded["runtime"]["available"] is True
    assert loaded["evidence_chain"]["validation_rows_ready"] is True
    assert loaded["live_order_allowed"] is False
    assert loaded["can_authorize_live"] is False
    assert loaded["counts_for_validation_credit"] is False
    _assert_no_live_true(loaded)


def test_dashboard_html_contains_mlx_diagnostic_surface():
    dashboard = load_module("kalshi_dashboard_mlx_html", ROOT / "kalshi_dashboard.py")
    html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8") if dashboard.DASHBOARD_HTML_PATH.exists() else ""
    if "MLX Diagnostic Runtime" not in html:
        dashboard.write_dashboard_html()
        html = dashboard.DASHBOARD_HTML_PATH.read_text(encoding="utf-8")
    assert "MLX Diagnostic Runtime" in html
    assert "renderMlxDiagnostic" in html
    assert "mlx-diagnostic-table" in html


def test_dashboard_exposes_crypto_settlement_oracle_panel_and_fallback():
    dashboard = load_module("kalshi_dashboard_settlement_oracle", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    oracle = payload["crypto_settlement_oracle"]
    assert oracle["live_order_allowed"] is False
    assert oracle["live_trading_enabled"] is False
    assert oracle["can_authorize_trade"] is False
    assert oracle["counts_for_validation_credit"] is False
    assert oracle["power_analysis"]["historical_replay_credit_allowed"] is False
    source = (ROOT / "kalshi_dashboard.py").read_text(encoding="utf-8")
    assert "Crypto Settlement Arbitrage Lab" in source
    assert "crypto-settlement-oracle" in source
    assert "renderCryptoSettlementOracle" in source



def test_dashboard_exposes_crypto_settlement_oracle_readiness_report():
    dashboard = load_module("kalshi_dashboard_settlement_oracle_readiness", ROOT / "kalshi_dashboard.py")
    payload, _warnings = dashboard.build_dashboard()
    readiness = payload["crypto_settlement_oracle_readiness"]
    replay = readiness["replay_power_analysis"]
    residual = readiness["residual_ml_readiness"]
    graduation = readiness["forward_paper_graduation_gate"]
    critical = readiness["critical_path_blocker_handoff"]

    assert readiness["live_order_allowed"] is False
    assert readiness["live_trading_enabled"] is False
    assert readiness["can_authorize_trade"] is False
    assert readiness["can_authorize_paper"] is False
    assert readiness["can_authorize_live"] is False
    assert readiness["counts_for_validation_credit"] is False
    assert replay["historical_replay_credit_allowed"] is False
    assert replay["live_readiness_credit_allowed"] is False
    assert residual["target"] == "post_cost_trade_quality"
    assert "raw_crypto_direction" in residual["forbidden_targets"]
    assert graduation["status"] == "blocked"
    assert graduation["all_gates_blocked"] is True
    assert critical["production_grade_ml_status"] == "blocked"

    source = (ROOT / "kalshi_dashboard.py").read_text(encoding="utf-8")
    assert "crypto_settlement_oracle_readiness" in source
    assert "16BS Replay / power" in source
    assert "16BT Residual ML gate" in source
    assert "16BU Graduation matrix" in source
    assert "16BW Critical path" in source


def test_dashboard_exposes_kalshi_nonlive_openclaw_runner_summary(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_nonlive_runner", ROOT / "kalshi_dashboard.py")
    summary_path = tmp_path / "kalshi_nonlive_openclaw_runner_summary_v1.json"
    summary_path.write_text(
        json.dumps(
            {
                "ok": True,
                "milestone": "16DM",
                "candidate_name": "crypto_execution_value_band_guard_repair_v11",
                "status": "complete_composition_blocked_more_collection_needed",
                "unique_clean_row_count": 38,
                "asset_counts": {"BTC": 4, "DOGE": 25, "ETH": 7, "SOL": 2},
                "dominant_asset": "DOGE",
                "non_dominant_asset_rows": 13,
                "asset_composition_mathematically_possible": False,
                "composition_feasibility": {
                    "non_dominant_asset_rows_required": 15,
                    "non_dominant_asset_shortfall": 2,
                },
                "selector": {"selector_status": "no_composition_valid_subset", "composition_reject_reason": "asset_concentration_gt_0_5"},
                "source_exists": False,
                "validation_rows_exist": False,
                "outcomes_exist": False,
                "next_blocker": "run_approved_16dl_target_64_collection_after_16dm",
                "next_action": "Need 2 more non-DOGE clean rows before a 30-row composition-valid source can exist.",
                "future_16dl": {"target_clean_rows": 64, "run_by_16dm": False},
                "unsafe_true_flags": [],
                "live_order_allowed": False,
                "live_trading_enabled": False,
                "can_authorize_trade": False,
                "can_authorize_paper": False,
                "can_authorize_live": False,
                "sts_authority": False,
            }
        ),
        encoding="utf-8",
    )
    html_path = tmp_path / "kalshi_dashboard.html"
    monkeypatch.setattr(dashboard, "KALSHI_NONLIVE_RUNNER_SUMMARY_PATH", summary_path)
    monkeypatch.setattr(dashboard, "DASHBOARD_HTML_PATH", html_path)

    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    html = html_path.read_text(encoding="utf-8")
    runner = payload["kalshi_nonlive_openclaw_runner"]

    assert runner["status"] == "complete_composition_blocked_more_collection_needed"
    assert runner["artifact_exists"] is True
    assert runner["unique_clean_row_count"] == 38
    assert runner["asset_counts"]["DOGE"] == 25
    assert runner["dominant_asset"] == "DOGE"
    assert runner["non_dominant_asset_rows"] == 13
    assert runner["non_dominant_asset_shortfall"] == 2
    assert runner["asset_composition_mathematically_possible"] is False
    assert runner["source_exists"] is False
    assert runner["validation_rows_exist"] is False
    assert runner["outcomes_exist"] is False
    assert runner["live_order_allowed"] is False
    assert runner["live_trading_enabled"] is False
    assert runner["can_authorize_trade"] is False
    assert runner["can_authorize_paper"] is False
    assert runner["can_authorize_live"] is False
    assert runner["sts_authority"] is False
    assert "Kalshi v11 OpenClaw Runner" in html
    assert "renderKalshiNonliveRunner" in html
    assert "kalshi-nonlive-runner-table" in html
    _assert_no_live_true(runner)


def test_dashboard_exposes_kalshi_v12_source_bottleneck_audit(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_v12_source_bottleneck", ROOT / "kalshi_dashboard.py")
    audit_path = tmp_path / "crypto_milestone_16et_v12_source_bottleneck_audit_non_doge_collection_plan_v1.json"
    audit_path.write_text(
        json.dumps(
            {
                "ok": True,
                "milestone": "16ET",
                "candidate_name": "crypto_asset_balanced_execution_value_band_guard_repair_v12",
                "status": "complete_bottleneck_audit_continue_v12_with_non_doge_timed_collection",
                "source_bottleneck": {
                    "unique_clean_row_count": 19,
                    "asset_counts": {"BTC": 2, "DOGE": 15, "SOL": 2},
                    "usable_asset_counts_after_v12_cap": {"BTC": 2, "DOGE": 12, "ETH": 0, "SOL": 2},
                    "composition_usable_row_count": 16,
                    "composition_usable_shortfall": 14,
                    "raw_clean_row_shortfall": 11,
                    "minimum_asset_deficits": {"BTC": 3, "ETH": 5, "SOL": 3},
                    "non_doge_rows": 4,
                    "non_doge_row_shortfall": 14,
                    "source_finalization_possible_now": False,
                    "selector_status": "insufficient_rows",
                    "selector_reject_reason": None,
                },
                "state": {
                    "source_jsonl_exists": False,
                    "validation_rows_exist": False,
                    "outcomes_exist": False,
                },
                "recommendation": {
                    "recommended_next_action": "run_16EU",
                    "next_safe_action": "run one approved non-DOGE timed read-only collection attempt",
                    "pivot_rule_after_16EU": "If ETH remains 0 after 16EU, request v13 preregistration approval.",
                },
                "rejection_summary": {
                    "aggregate_rejected_reasons": {"candidate_side_not_executable": 131},
                    "per_asset_rejection_reasons_from_examples": {"ETH": {"candidate_side_not_executable": 1}},
                },
                "unsafe_true_flags": [],
                "live_order_allowed": False,
                "live_trading_enabled": False,
                "can_authorize_trade": False,
                "can_authorize_paper": False,
                "can_authorize_live": False,
                "sts_authority": False,
            }
        ),
        encoding="utf-8",
    )
    html_path = tmp_path / "kalshi_dashboard.html"
    monkeypatch.setattr(dashboard, "KALSHI_V12_SOURCE_BOTTLENECK_AUDIT_PATH", audit_path)
    monkeypatch.setattr(dashboard, "DASHBOARD_HTML_PATH", html_path)

    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    html = html_path.read_text(encoding="utf-8")
    audit = payload["kalshi_v12_source_bottleneck"]

    assert audit["status"] == "complete_bottleneck_audit_continue_v12_with_non_doge_timed_collection"
    assert audit["artifact_exists"] is True
    assert audit["unique_clean_row_count"] == 19
    assert audit["composition_usable_row_count"] == 16
    assert audit["composition_usable_shortfall"] == 14
    assert audit["minimum_asset_deficits"] == {"BTC": 3, "ETH": 5, "SOL": 3}
    assert audit["recommended_next_action"] == "run_16EU"
    assert audit["live_order_allowed"] is False
    assert audit["live_trading_enabled"] is False
    assert audit["can_authorize_trade"] is False
    assert audit["can_authorize_paper"] is False
    assert audit["can_authorize_live"] is False
    assert audit["sts_authority"] is False
    assert "Kalshi v12 Source Bottleneck" in html
    assert "renderKalshiV12SourceBottleneck" in html
    assert "kalshi-v12-source-bottleneck-table" in html
    _assert_no_live_true(audit)


def test_dashboard_exposes_kalshi_v13_preregistration_plan(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_v13_preregistration", ROOT / "kalshi_dashboard.py")
    plan_path = tmp_path / "crypto_milestone_16ev_v13_asset_balanced_crypto_candidate_preregistration_plan_v1.json"
    plan_path.write_text(
        json.dumps(
            {
                "milestone": "16EV",
                "candidate_name": "crypto_asset_balanced_execution_value_band_guard_repair_v13",
                "status": "complete_v13_diagnostic_preregistration_plan_collection_blocked_pending_16EW_approval",
                "v12_evidence": {
                    "unique_clean_row_count": 21,
                    "asset_counts": {"DOGE": 17, "BTC": 2, "SOL": 2},
                    "composition_usable_row_count": 16,
                    "composition_usable_shortfall": 14,
                    "minimum_asset_deficits": {"BTC": 3, "ETH": 5, "SOL": 3},
                    "recommended_next_action": "stop_v12_preregister_v13",
                    "pivot_to_v13_now": True,
                },
                "v13_preregistered_plan": {
                    "required_source_rows": 30,
                    "allowed_assets": ["BTC", "ETH", "SOL", "DOGE"],
                    "source_asset_contract": {
                        "minimum_asset_rows": {"BTC": 6, "ETH": 6, "SOL": 6, "DOGE": 6},
                        "maximum_asset_rows": {"BTC": 9, "ETH": 9, "SOL": 9, "DOGE": 9},
                        "target_mix_rows": {"BTC": "7_to_8", "ETH": "7_to_8", "SOL": "7_to_8", "DOGE": "6_to_9"},
                        "minimum_non_doge_rows": 21,
                        "doge_saturation_cap_rows": 9,
                    },
                    "future_paths_if_separately_approved": {
                        "source_jsonl": "work/scripts/kalshi/preservation_snapshots/post_prereg_candidate_sources/crypto_asset_balanced_execution_value_band_guard_repair_v13_source_after16.jsonl",
                    },
                },
                "next_blocker": "16EW_v13_asset_balanced_read_only_source_collection_target72_requires_separate_explicit_approval",
                "next_approval_text": "I explicitly approve milestone_16EW_v13_asset_balanced_read_only_source_collection_target72.",
                "unsafe_true_flags": [],
                "live_order_allowed": False,
                "live_trading_enabled": False,
                "can_authorize_trade": False,
                "can_authorize_paper": False,
                "can_authorize_live": False,
                "sts_authority": False,
            }
        ),
        encoding="utf-8",
    )
    html_path = tmp_path / "kalshi_dashboard.html"
    monkeypatch.setattr(dashboard, "KALSHI_V13_PREREGISTRATION_PLAN_PATH", plan_path)
    monkeypatch.setattr(dashboard, "DASHBOARD_HTML_PATH", html_path)

    payload, _warnings = dashboard.build_dashboard()
    dashboard.write_dashboard_html()
    html = html_path.read_text(encoding="utf-8")
    snapshot = payload["kalshi_v13_preregistration_plan"]

    assert snapshot["status"] == "complete_v13_diagnostic_preregistration_plan_collection_blocked_pending_16EW_approval"
    assert snapshot["artifact_exists"] is True
    assert snapshot["candidate_name"] == "crypto_asset_balanced_execution_value_band_guard_repair_v13"
    assert snapshot["v12_unique_clean_row_count"] == 21
    assert snapshot["v12_composition_usable_row_count"] == 16
    assert snapshot["v12_pivot_to_v13_now"] is True
    assert snapshot["minimum_asset_rows"] == {"BTC": 6, "ETH": 6, "SOL": 6, "DOGE": 6}
    assert snapshot["maximum_asset_rows"]["DOGE"] == 9
    assert snapshot["can_authorize_trade"] is False
    assert snapshot["can_authorize_paper"] is False
    assert snapshot["can_authorize_live"] is False
    assert snapshot["sts_authority"] is False
    assert "Kalshi v13 Preregistration Plan" in html
    assert "renderKalshiV13Preregistration" in html
    assert "kalshi-v13-preregistration-table" in html
    _assert_no_live_true(snapshot)


def test_copy_shadow_status_starts_shadow_only_and_blocked_without_source():
    copy_shadow = load_module("kalshi_copy_shadow_unit", ROOT / "kalshi_copy_shadow.py")

    status = copy_shadow.build_copy_shadow_status()

    assert status["mode"] == "SHADOW_ONLY"
    assert status["status"] == "blocked_no_source"
    assert status["target_leader"]["leader_name"] == "Foster McCoy"
    assert status["target_leader"]["verification_status"] == "public_identity_verified_source_unverified"
    assert status["source_discovery"]["artifact_exists"] is False
    assert status["source_discovery"]["copyable_exact_source_verified"] is False
    assert status["summary"]["signals_seen"] == 0
    assert status["summary"]["exact_opt_in_source_count"] == 0
    assert status["summary"]["verified_exact_opt_in_source_count"] == 0
    assert status["summary"]["leader_lane_count"] == 2
    lanes = {lane["lane_id"]: lane for lane in status["leader_lanes"]}
    assert lanes["foster_exact_fill_shadow"]["leader_name"] == "Foster McCoy"
    assert lanes["foster_exact_fill_shadow"]["exact_copy"] is True
    assert lanes["foster_exact_fill_shadow"]["enabled"] is False
    assert "no_verified_exact_opt_in_foster_fill_source" in lanes["foster_exact_fill_shadow"]["blockers"]
    assert lanes["caleb_public_strategy_shadow"]["leader_name"] == "Caleb Davies"
    assert lanes["caleb_public_strategy_shadow"]["exact_copy"] is False
    assert lanes["caleb_public_strategy_shadow"]["manipulation_risk_filter_required"] is True
    assert lanes["caleb_public_strategy_shadow"]["enabled"] is False
    assert "public_signal_intake_not_enabled" in lanes["caleb_public_strategy_shadow"]["blockers"]
    assert status["readiness_score"] > 0
    assert any(gate["gate_id"] == "exact_opt_in_source" and gate["status"] == "blocked" for gate in status["readiness_gates"])
    assert status["live_order_allowed"] is False
    assert status["live_trading_enabled"] is False
    assert status["can_authorize_trade"] is False
    assert status["can_authorize_live"] is False
    _assert_no_live_true(status)


def test_copy_shadow_source_discovery_receipt_blocks_without_exact_source():
    discovery = load_module("kalshi_copy_shadow_source_discovery_unit", ROOT / "kalshi_copy_shadow_source_discovery.py")

    receipt = discovery.build_discovery_receipt(
        config={
            "target_leader": {"leader_name": "Foster McCoy", "leader_handle": None},
            "signal_sources": [
                {
                    "source_id": "foster-primary",
                    "leader_name": "Foster McCoy",
                    "leader_handle": None,
                    "source_type": "pending_verification",
                    "verification_status": "public_identity_verified_source_unverified",
                    "source_status": "blocked_no_exact_source",
                    "exact_fill": False,
                    "enabled": False,
                    "live_order_allowed": False,
                }
            ],
        }
    )

    assert receipt["mode"] == "READ_ONLY_SOURCE_DISCOVERY"
    assert receipt["target_leader"]["leader_name"] == "Foster McCoy"
    assert receipt["public_identity"]["verified"] is True
    assert receipt["authenticated_read_probe"]["attempted"] is False
    assert receipt["copyable_exact_source"]["verified"] is False
    assert "no_verified_exact_opt_in_foster_fill_source" in receipt["copyable_exact_source"]["blockers"]
    assert receipt["overall_completion_percentage"] == 32
    source_candidates = {item["source_id"]: item for item in receipt["candidate_sources_reviewed"]}
    assert source_candidates["kalshi_wss_public_trades"]["copyable_now"] is False
    assert source_candidates["kalshi_wss_public_trades"]["leader_identity_available"] is False
    assert source_candidates["kalshi_wss_user_fills_opt_in"]["requires_external_approval"] is True
    assert source_candidates["kalshi_wss_user_fills_opt_in"]["exact_fill"] is True
    assert any(item["name"] == "Copyable Source Verification" and item["status"] == "blocked" for item in receipt["milestones"])
    _assert_no_live_true(receipt)


def test_copy_shadow_status_exposes_source_discovery_receipt():
    copy_shadow = load_module("kalshi_copy_shadow_with_discovery", ROOT / "kalshi_copy_shadow.py")

    status = copy_shadow.build_copy_shadow_status(
        source_discovery={
            "generated_at_utc": "2026-07-01T12:00:00Z",
            "public_identity": {"verified": True},
            "authenticated_read_probe": {"attempted": True, "ok": True},
            "copyable_exact_source": {
                "verified": False,
                "status": "blocked",
                "blockers": ["no_verified_exact_opt_in_foster_fill_source"],
            },
            "milestones": [
                {
                    "milestone_id": "FCS-02",
                    "name": "Source Receipt Artifact",
                    "completion_percentage": 100,
                    "status": "complete",
                }
            ],
            "candidate_sources_reviewed": [
                {
                    "source_id": "kalshi_wss_public_trades",
                    "candidate": "Kalshi WebSocket Public Trades",
                    "copyable_now": False,
                    "live_order_allowed": False,
                }
            ],
            "overall_completion_percentage": 32,
            "next_action": "Get a consented exact-fill Foster McCoy source.",
            "live_order_allowed": False,
        }
    )

    assert status["source_discovery"]["artifact_exists"] is True
    assert status["source_discovery"]["public_identity_verified"] is True
    assert status["source_discovery"]["authenticated_read_ok"] is True
    assert status["source_discovery"]["copyable_exact_source_verified"] is False
    assert status["source_discovery"]["blockers"] == ["no_verified_exact_opt_in_foster_fill_source"]
    assert status["source_discovery"]["candidate_sources_reviewed"][0]["source_id"] == "kalshi_wss_public_trades"
    assert status["source_discovery"]["overall_completion_percentage"] == 32
    _assert_no_live_true(status)


def test_copy_shadow_blocks_unverified_foster_source():
    copy_shadow = load_module("kalshi_copy_shadow_unverified", ROOT / "kalshi_copy_shadow.py")

    status = copy_shadow.build_copy_shadow_status(
        config={
            "target_leader": {
                "leader_name": "Foster",
                "leader_handle": None,
                "verification_status": "unverified",
                "source_status": "missing",
            },
            "signal_sources": [
                {
                    "source_id": "foster-primary",
                    "leader_name": "Foster",
                    "leader_handle": None,
                    "source_type": "pending_verification",
                    "verification_status": "unverified",
                    "source_status": "missing",
                    "exact_fill": False,
                    "enabled": False,
                    "live_order_allowed": False,
                }
            ],
        }
    )

    assert status["status"] == "blocked_no_source"
    assert status["summary"]["source_count"] == 1
    assert status["summary"]["verified_exact_opt_in_source_count"] == 0
    assert status["sources"][0]["leader_name"] == "Foster"
    assert status["sources"][0]["verification_status"] == "unverified"
    assert status["readiness_gates"][0]["blocker"] == "no_exact_opt_in_fill_source"
    _assert_no_live_true(status)


def test_copy_shadow_accepts_verified_exact_source_and_skips_duplicates():
    copy_shadow = load_module("kalshi_copy_shadow_verified", ROOT / "kalshi_copy_shadow.py")
    config = {
        "signal_sources": [
            {
                "source_id": "foster-primary",
                "leader_name": "Foster",
                "leader_handle": "foster_verified",
                "source_type": "exact_opt_in_fill",
                "verification_status": "verified",
                "source_status": "enabled",
                "exact_fill": True,
                "enabled": True,
                "live_order_allowed": False,
            }
        ],
    }
    signal = {
        "signal_id": "foster-fill-1",
        "source_id": "foster-primary",
        "leader_handle": "foster_verified",
        "source_type": "exact_opt_in_fill",
        "exact_fill_source": True,
        "market_ticker": "KXTEST-26",
        "side": "yes",
        "price_cents": 52,
        "quantity": 1,
        "leader_filled_at_utc": "2026-07-01T12:00:00Z",
        "observed_at_utc": "2026-07-01T12:00:00.500Z",
        "signal_latency_ms": 500,
        "decision_latency_ms": 50,
        "spread_cents": 2,
        "price_drift_cents": 1,
        "live_order_allowed": False,
    }

    status = copy_shadow.build_copy_shadow_status(config=config, signals=[dict(signal), dict(signal)])

    assert status["status"] == "shadow_collecting"
    assert status["summary"]["signals_seen"] == 2
    assert status["summary"]["eligible_shadow_signals"] == 1
    assert status["summary"]["skipped_signals"] == 1
    assert status["summary"]["duplicate_signal_count"] == 1
    assert status["signal_quality"]["skip_reasons"] == {"duplicate_signal_id": 1}
    assert status["signal_quality"]["recent_decisions"][0]["decision"] == "copy_shadow"
    assert status["signal_quality"]["recent_decisions"][1]["reason"] == "duplicate_signal_id"
    assert status["readiness_gates"][0]["status"] == "passed"
    _assert_no_live_true(status)


def test_copy_shadow_foster_relay_fixture_verifier_stays_blocked_without_real_source():
    copy_shadow = load_module("kalshi_copy_shadow_foster_relay_verifier", ROOT / "kalshi_copy_shadow.py")
    sample = {
        "trade_id": "trade-1",
        "market_ticker": "KXTEST-26",
        "side": "yes",
        "action": "buy",
        "price_cents": 52,
        "quantity": 2,
        "leader_filled_at_utc": "2026-07-01T12:00:00Z",
        "observed_at_utc": "2026-07-01T12:00:00.400Z",
        "live_order_allowed": False,
    }

    receipt = copy_shadow.validate_foster_relay_sample(sample)

    assert receipt["status"] == "fixture_schema_passed_real_source_blocked"
    assert receipt["schema_passed"] is True
    assert receipt["verified"] is False
    assert receipt["missing_fields"] == []
    assert receipt["invalid_fields"] == []
    assert receipt["latency_ms"] == 400
    _assert_no_live_true(receipt)


def test_copy_shadow_foster_relay_fixture_rejects_missing_unsafe_and_malformed():
    copy_shadow = load_module("kalshi_copy_shadow_foster_relay_bad", ROOT / "kalshi_copy_shadow.py")

    missing = copy_shadow.validate_foster_relay_sample(
        {
            "trade_id": "trade-1",
            "market_ticker": "KXTEST-26",
            "side": "yes",
            "action": "buy",
            "price_cents": 52,
            "quantity": 1,
            "leader_filled_at_utc": "2026-07-01T12:00:00Z",
        }
    )
    unsafe = copy_shadow.validate_foster_relay_sample(
        {
            "trade_id": "trade-2",
            "market_ticker": "KXTEST-26",
            "side": "yes",
            "action": "buy",
            "price_cents": 52,
            "quantity": 1,
            "leader_filled_at_utc": "2026-07-01T12:00:00Z",
            "observed_at_utc": "2026-07-01T12:00:00.200Z",
            "live_order_allowed": True,
        }
    )
    parsed, malformed = copy_shadow.parse_fixture_json("{bad json", validator_id="foster_relay_fixture")

    assert missing["schema_passed"] is False
    assert "observed_at_utc" in missing["missing_fields"]
    assert unsafe["schema_passed"] is False
    assert unsafe["unsafe_true_flags"] == ["live_order_allowed"]
    assert parsed is None
    assert malformed["status"] == "malformed_json"
    _assert_no_live_true(missing)
    _assert_no_live_true(unsafe)
    _assert_no_live_true(malformed)


def test_copy_shadow_public_strategy_lane_requires_verified_source_and_rejects_risk():
    copy_shadow = load_module("kalshi_copy_shadow_public_strategy", ROOT / "kalshi_copy_shadow.py")
    config = {
        "copy_leader_lanes": [
            {
                "lane_id": "caleb_public_strategy_shadow",
                "leader_name": "Caleb Davies",
                "leader_alias": "Caleb",
                "source_id": "caleb-public-strategy",
                "lane_type": "public_strategy_shadow",
                "copy_mode": "public_strategy_not_exact_copy",
                "source_status": "enabled_shadow_only",
                "verification_status": "verified",
                "enabled": True,
                "exact_copy": False,
                "requires_exact_opt_in_source": False,
                "requires_source_url": True,
                "manipulation_risk_filter_required": True,
                "blockers": [],
                "next_action": "Collect paper outcomes only.",
            }
        ],
        "signal_sources": [
            {
                "source_id": "caleb-public-strategy",
                "lane_id": "caleb_public_strategy_shadow",
                "leader_name": "Caleb Davies",
                "source_type": "public_strategy_signal",
                "verification_status": "verified",
                "source_status": "enabled_shadow_only",
                "exact_fill": False,
                "enabled": True,
                "source_url": "https://example.test/caleb-public-signal",
                "live_order_allowed": False,
            }
        ],
    }
    signal = {
        "signal_id": "caleb-public-1",
        "source_id": "caleb-public-strategy",
        "lane_id": "caleb_public_strategy_shadow",
        "leader_name": "Caleb Davies",
        "source_type": "public_strategy_signal",
        "source_url": "https://example.test/caleb-public-signal",
        "market_ticker": "KXTEST-26",
        "side": "yes",
        "price_cents": 49,
        "quantity": 1,
        "reason": "Source-backed public thesis signal for paper-only validation.",
        "observed_at_utc": "2026-07-01T12:00:00Z",
        "signal_latency_ms": 300,
        "decision_latency_ms": 40,
        "spread_cents": 2,
        "price_drift_cents": 1,
        "live_order_allowed": False,
    }
    risky_signal = {
        **signal,
        "signal_id": "caleb-public-risk-1",
        "manipulation_risk_flag": True,
    }

    status = copy_shadow.build_copy_shadow_status(config=config, signals=[dict(signal), risky_signal])

    assert status["summary"]["signals_seen"] == 2
    assert status["summary"]["eligible_shadow_signals"] == 1
    assert status["summary"]["skipped_signals"] == 1
    assert status["signal_quality"]["skip_reasons"] == {"public_strategy_manipulation_risk_flag": 1}
    assert status["signal_quality"]["recent_decisions"][0]["decision"] == "copy_shadow"
    assert status["signal_quality"]["recent_decisions"][1]["reason"] == "public_strategy_manipulation_risk_flag"
    lanes = {lane["lane_id"]: lane for lane in status["leader_lanes"]}
    assert lanes["caleb_public_strategy_shadow"]["copyable_now"] is True
    assert lanes["caleb_public_strategy_shadow"]["signals_seen"] == 2
    assert lanes["caleb_public_strategy_shadow"]["eligible_shadow_signals"] == 1
    assert lanes["caleb_public_strategy_shadow"]["exact_copy"] is False
    _assert_no_live_true(status)


def test_copy_shadow_caleb_public_fixture_verifier_rejects_risk_flags():
    copy_shadow = load_module("kalshi_copy_shadow_caleb_verifier", ROOT / "kalshi_copy_shadow.py")
    signal = {
        "signal_id": "caleb-public-1",
        "source_id": "caleb-public-strategy",
        "leader_name": "Caleb Davies",
        "source_type": "public_strategy_signal",
        "source_url": "https://example.test/caleb-public-signal",
        "market_ticker": "KXTEST-26",
        "side": "yes",
        "price_cents": 49,
        "quantity": 1,
        "reason": "Source-backed public thesis signal for paper-only validation.",
        "observed_at_utc": "2026-07-01T12:00:00Z",
        "signal_latency_ms": 300,
        "live_order_allowed": False,
    }

    clean = copy_shadow.validate_caleb_public_signal_sample(signal)
    risky = copy_shadow.validate_caleb_public_signal_sample({**signal, "signal_id": "risk-1", "promotional_source": True})

    assert clean["status"] == "fixture_schema_passed_real_source_blocked"
    assert clean["schema_passed"] is True
    assert clean["verified"] is False
    assert clean["exact_copy"] is False
    assert risky["schema_passed"] is False
    assert risky["risk_flags"] == ["promotional_source"]
    _assert_no_live_true(clean)
    _assert_no_live_true(risky)


def test_copy_shadow_signal_log_validator_rejects_duplicates_and_execution_quality():
    copy_shadow = load_module("kalshi_copy_shadow_log_validator", ROOT / "kalshi_copy_shadow.py")
    good = {
        "signal_id": "caleb-public-1",
        "source_id": "caleb-public-strategy",
        "leader_name": "Caleb Davies",
        "source_type": "public_strategy_signal",
        "source_url": "https://example.test/caleb-public-signal",
        "market_ticker": "KXTEST-26",
        "side": "yes",
        "price_cents": 49,
        "quantity": 1,
        "reason": "Source-backed public thesis signal for paper-only validation.",
        "observed_at_utc": "2026-07-01T12:00:00Z",
        "signal_latency_ms": 300,
        "spread_cents": 2,
        "price_drift_cents": 1,
        "live_order_allowed": False,
    }
    duplicate = {**good}
    bad_quality = {
        **good,
        "signal_id": "caleb-public-2",
        "signal_latency_ms": 1500,
        "spread_cents": 7,
        "price_drift_cents": 3,
    }

    receipt = copy_shadow.validate_signal_log_records([good, duplicate, bad_quality])

    assert receipt["status"] == "failed"
    assert receipt["accepted_record_count"] == 1
    assert receipt["rejected_record_count"] == 2
    assert receipt["duplicate_signal_ids"] == ["caleb-public-1"]
    assert receipt["rejection_reasons"]["duplicate_signal_id"] == 1
    assert receipt["rejection_reasons"]["signal_latency_too_slow"] == 1
    assert receipt["rejection_reasons"]["spread_too_wide"] == 1
    assert receipt["rejection_reasons"]["price_drift_too_large"] == 1
    _assert_no_live_true(receipt)


def test_dashboard_exposes_copy_shadow_status(tmp_path, monkeypatch):
    dashboard = load_module("kalshi_dashboard_copy_shadow", ROOT / "kalshi_dashboard.py")
    status_path = tmp_path / "kalshi_copy_shadow_status_v1.json"
    status_path.write_text(
        json.dumps(
            {
                "schema_version": "copy_shadow_status_v1",
                "mode": "SHADOW_ONLY",
                "status": "shadow_collecting",
                "shadow_bankroll_usd": 100,
                "readiness_score": 42.9,
                "summary": {
                    "signals_seen": 12,
                    "eligible_shadow_signals": 9,
                    "skipped_signals": 3,
                    "resolved_signals": 4,
                    "wins": 3,
                    "losses": 1,
                    "win_rate": 0.75,
                    "net_shadow_pnl_usd": 2.35,
                    "unresolved_signals": 5,
                    "observed_days": 2.5,
                    "exact_opt_in_source_count": 1,
                    "verified_exact_opt_in_source_count": 1,
                    "source_count": 1,
                    "leader_lane_count": 2,
                    "active_leader_lane_count": 1,
                    "duplicate_signal_count": 1,
                    "live_order_allowed": False,
                },
                "source_discovery": {
                    "generated_at_utc": "2026-07-01T12:00:00Z",
                    "status": "blocked",
                    "public_identity_verified": True,
                    "authenticated_read_ok": True,
                    "authenticated_read_attempted": True,
                    "copyable_exact_source_verified": False,
                    "blockers": ["no_verified_exact_opt_in_foster_fill_source"],
                    "next_action": "Get a consented exact-fill Foster McCoy source.",
                    "overall_completion_percentage": 32,
                    "milestones": [
                        {
                            "milestone_id": "FCS-02",
                            "name": "Source Receipt Artifact",
                            "completion_percentage": 100,
                            "status": "complete",
                        }
                    ],
                    "live_order_allowed": False,
                },
                "latency": {
                    "p95_signal_latency_ms": 720,
                    "average_decision_latency_ms": 80,
                    "near_instant_target_ms": 1000,
                    "live_order_allowed": False,
                },
                "execution_quality": {
                    "average_price_drift_cents": 1.2,
                    "average_spread_cents": 2.1,
                    "max_price_drift_cents": 2,
                    "max_spread_cents": 4,
                    "live_order_allowed": False,
                },
                "risk_controls": {
                    "max_shadow_order_usd": 5,
                    "max_shadow_open_exposure_usd": 25,
                    "market_orders_allowed": False,
                    "live_order_allowed": False,
                },
                "source_health": {
                    "foster_relay_verifier": {
                        "validator_id": "foster_relay_fixture",
                        "status": "fixture_schema_passed_real_source_blocked",
                        "schema_passed": True,
                        "verified": False,
                        "missing_fields": [],
                        "invalid_fields": [],
                        "unsafe_true_flags": [],
                        "latency_ms": 400,
                        "live_order_allowed": False,
                    },
                    "caleb_public_signal_verifier": {
                        "validator_id": "caleb_public_signal_fixture",
                        "status": "no_fixture_sample",
                        "schema_passed": False,
                        "verified": False,
                        "missing_fields": [],
                        "invalid_fields": [],
                        "unsafe_true_flags": [],
                        "risk_flags": [],
                        "live_order_allowed": False,
                    },
                    "signal_log_validator": {
                        "validator_id": "copy_shadow_signal_log",
                        "status": "passed",
                        "schema_passed": True,
                        "path": "work/scripts/kalshi/logs/copy_shadow_signals.jsonl",
                        "record_count": 12,
                        "accepted_record_count": 9,
                        "rejected_record_count": 0,
                        "duplicate_signal_ids": [],
                        "rejection_reasons": {},
                        "unsafe_true_flags": [],
                        "live_order_allowed": False,
                    },
                    "live_order_allowed": False,
                },
                "leader_lanes": [
                    {
                        "lane_id": "foster_exact_fill_shadow",
                        "leader_name": "Foster McCoy",
                        "lane_type": "exact_fill_shadow",
                        "copy_mode": "exact_fill_when_verified",
                        "source_status": "enabled",
                        "verification_status": "verified",
                        "enabled": True,
                        "exact_copy": True,
                        "signals_seen": 12,
                        "eligible_shadow_signals": 9,
                        "resolved_signals": 4,
                        "net_shadow_pnl_usd": 2.35,
                        "live_order_allowed": False,
                    },
                    {
                        "lane_id": "caleb_public_strategy_shadow",
                        "leader_name": "Caleb Davies",
                        "lane_type": "public_strategy_shadow",
                        "copy_mode": "public_strategy_not_exact_copy",
                        "source_status": "disabled_pending_public_signal_intake",
                        "verification_status": "public_strategy_candidate_unverified",
                        "enabled": False,
                        "exact_copy": False,
                        "manipulation_risk_filter_required": True,
                        "signals_seen": 0,
                        "eligible_shadow_signals": 0,
                        "resolved_signals": 0,
                        "net_shadow_pnl_usd": 0,
                        "blockers": ["manipulation_risk_filter_not_verified"],
                        "live_order_allowed": False,
                    },
                ],
                "sources": [
                    {
                        "source_id": "leader-alpha",
                        "leader_handle": "leader_alpha",
                        "source_type": "exact_opt_in_fill",
                        "exact_fill": True,
                        "enabled": True,
                        "signals_seen": 12,
                        "live_order_allowed": False,
                    }
                ],
                "readiness_gates": [
                    {
                        "gate_id": "exact_opt_in_source",
                        "label": "Exact opt-in fill source",
                        "status": "passed",
                        "detail": "Configured.",
                        "live_order_allowed": False,
                    }
                ],
                "unsafe_true_flags": [],
                "live_order_allowed": False,
                "live_trading_enabled": False,
                "can_authorize_trade": False,
                "can_authorize_paper": False,
                "can_authorize_live": False,
                "sts_authority": False,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(dashboard, "KALSHI_COPY_SHADOW_STATUS_PATH", status_path)

    payload, _warnings = dashboard.build_dashboard()
    copy_status = payload["kalshi_copy_shadow"]

    assert copy_status["status"] == "shadow_collecting"
    assert copy_status["artifact_exists"] is True
    assert copy_status["summary"]["signals_seen"] == 12
    assert copy_status["summary"]["resolved_signals"] == 4
    assert copy_status["summary"]["net_shadow_pnl_usd"] == 2.35
    assert copy_status["summary"]["verified_exact_opt_in_source_count"] == 1
    assert copy_status["summary"]["leader_lane_count"] == 2
    assert copy_status["summary"]["active_leader_lane_count"] == 1
    assert copy_status["leader_lanes"][0]["lane_id"] == "foster_exact_fill_shadow"
    assert copy_status["leader_lanes"][1]["leader_name"] == "Caleb Davies"
    assert copy_status["leader_lanes"][1]["exact_copy"] is False
    assert copy_status["leader_lanes"][1]["live_order_allowed"] is False
    assert copy_status["source_health"]["foster_relay_verifier"]["status"] == "fixture_schema_passed_real_source_blocked"
    assert copy_status["source_health"]["foster_relay_verifier"]["verified"] is False
    assert copy_status["source_health"]["caleb_public_signal_verifier"]["status"] == "no_fixture_sample"
    assert copy_status["source_health"]["signal_log_validator"]["record_count"] == 12
    assert copy_status["source_health"]["signal_log_validator"]["live_order_allowed"] is False
    assert copy_status["source_discovery"]["public_identity_verified"] is True
    assert copy_status["source_discovery"]["authenticated_read_ok"] is True
    assert copy_status["source_discovery"]["copyable_exact_source_verified"] is False
    assert copy_status["source_discovery"]["blockers"] == ["no_verified_exact_opt_in_foster_fill_source"]
    assert copy_status["latency"]["p95_signal_latency_ms"] == 720
    assert copy_status["execution_quality"]["average_price_drift_cents"] == 1.2
    assert copy_status["sources"][0]["leader_handle"] == "leader_alpha"
    assert copy_status["live_order_allowed"] is False
    assert copy_status["can_authorize_trade"] is False
    assert copy_status["can_authorize_live"] is False
    _assert_no_live_true(copy_status)

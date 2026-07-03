#!/usr/bin/env python3
"""Build the read-only Foster copy-shadow source-discovery receipt."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from kalshi_common import kalshi_get  # noqa: E402
from kalshi_support import READ_ONLY_MODE, atomic_write_json, failure_envelope, success_envelope, utc_now  # noqa: E402

SCRIPT = "kalshi_copy_shadow_source_discovery.py"
KALSHI_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = KALSHI_ROOT / "kalshi_copy_shadow_config.json"
RECEIPT_PATH = KALSHI_ROOT / "kalshi_copy_shadow_source_discovery_v1.json"

PUBLIC_EVIDENCE = [
    {
        "source_id": "gq-2026-06-09",
        "source_name": "GQ",
        "source_url": "https://www.gq.com/story/prediction-markets-are-eating-the-future-you-can-bet-on-it",
        "claim": "Foster was publicly profiled as a highly profitable Kalshi trader, including leaderboard placement, recent profit, and full-time trading details.",
        "verifies_public_identity": True,
        "verifies_copyable_exact_fill_source": False,
    },
    {
        "source_id": "wsj-ai-markets-2025",
        "source_name": "Wall Street Journal",
        "source_url": "https://www.wsj.com/tech/ai/top-ai-model-betting-markets-kalshi-b2964992",
        "claim": "Public reporting attributed large 2025 Kalshi AI-market volume and profit to Foster McCoy.",
        "verifies_public_identity": True,
        "verifies_copyable_exact_fill_source": False,
    },
    {
        "source_id": "kalshi-social-leaderboard",
        "source_name": "Kalshi social leaderboard",
        "source_url": "https://kalshi.com/social/leaderboard",
        "claim": "The public leaderboard is the expected first-party social surface, but the fetched page returned a browser-security checkpoint instead of inspectable trader data.",
        "verifies_public_identity": False,
        "verifies_copyable_exact_fill_source": False,
    },
    {
        "source_id": "caleb-public-strategy-research",
        "source_name": "Public strategy research",
        "source_url": None,
        "claim": "Caleb Davies is tracked locally as a public-strategy paper candidate, but no source-backed real-time signal feed has been configured or verified.",
        "verifies_public_identity": True,
        "verifies_copyable_exact_fill_source": False,
    },
]

EXTERNAL_SOURCE_APPROVAL_TEXT = (
    "I approve shadow-only Foster McCoy exact-fill source verification using [SOURCE NAME]. "
    "Do not place live orders, cancel orders, create/modify API keys, move funds, accept quotes/RFQs, "
    "enable live trading, or call write-capable Kalshi endpoints."
)

SOURCE_CANDIDATES = [
    {
        "source_id": "kalshi_rest_public_trades",
        "candidate": "Kalshi REST Get Trades",
        "source_url": "https://docs.kalshi.com/api-reference/market/get-trades",
        "status": "not_copyable_market_level_public_feed",
        "latency_fit": "polling_near_real_time",
        "exact_fill": True,
        "leader_identity_available": False,
        "copyable_now": False,
        "requires_external_approval": False,
        "why_not_copyable": "The public REST trade feed has market ticker, price, quantity, and timestamp, but not the trader identity or Foster handle.",
    },
    {
        "source_id": "kalshi_wss_public_trades",
        "candidate": "Kalshi WebSocket Public Trades",
        "source_url": "https://docs.kalshi.com/websockets/public-trades",
        "status": "not_copyable_market_level_public_feed",
        "latency_fit": "immediate_after_trade_execution",
        "exact_fill": True,
        "leader_identity_available": False,
        "copyable_now": False,
        "requires_external_approval": False,
        "why_not_copyable": "The public WebSocket trade channel is fast enough for market-flow monitoring but omits user identity, so Foster fills cannot be isolated.",
    },
    {
        "source_id": "kalshi_wss_user_fills_opt_in",
        "candidate": "Foster opt-in Kalshi WebSocket User Fills",
        "source_url": "https://docs.kalshi.com/websockets/user-fills",
        "status": "blocked_requires_foster_opt_in_source",
        "latency_fit": "immediate_when_the_source_account_fills",
        "exact_fill": True,
        "leader_identity_available": True,
        "copyable_now": False,
        "requires_external_approval": True,
        "approval_text": EXTERNAL_SOURCE_APPROVAL_TEXT,
        "why_not_copyable": "This is the correct exact-fill shape, but it requires Foster or a consented source operator to provide his private fill stream or signed export.",
    },
    {
        "source_id": "kalshi_social_leaderboard",
        "candidate": "Kalshi social leaderboard",
        "source_url": "https://kalshi.com/social/leaderboard",
        "status": "identity_or_profit_surface_only",
        "latency_fit": "not_exact_fill",
        "exact_fill": False,
        "leader_identity_available": False,
        "copyable_now": False,
        "requires_external_approval": False,
        "why_not_copyable": "The leaderboard can support candidate discovery, but it does not provide a stable verified Foster handle plus real-time exact fills.",
    },
    {
        "source_id": "stand_or_paid_whale_alerts",
        "candidate": "Third-party whale alert/copy-trading tools",
        "source_url": "https://www.gq.com/story/prediction-markets-are-eating-the-future-you-can-bet-on-it",
        "status": "possible_paid_tool_requires_separate_approval",
        "latency_fit": "reported_real_time_alerting",
        "exact_fill": False,
        "leader_identity_available": "unknown",
        "copyable_now": False,
        "requires_external_approval": True,
        "approval_text": EXTERNAL_SOURCE_APPROVAL_TEXT,
        "why_not_copyable": "Public reporting says these tools can alert on whales, but no verified Foster exact-fill source or permissioned connector is configured locally.",
    },
    {
        "source_id": "foster_private_discord_or_group",
        "candidate": "Foster private Discord/group/API",
        "source_url": None,
        "status": "blocked_requires_private_source_approval",
        "latency_fit": "potentially_real_time",
        "exact_fill": "unknown_until_verified",
        "leader_identity_available": "potentially",
        "copyable_now": False,
        "requires_external_approval": True,
        "approval_text": EXTERNAL_SOURCE_APPROVAL_TEXT,
        "why_not_copyable": "A private group may contain positions or alerts, but it is not connected, consented, or verified as exact-fill data.",
    },
    {
        "source_id": "public_articles_and_x_posts",
        "candidate": "Public articles and social posts",
        "source_url": "https://www.gq.com/story/prediction-markets-are-eating-the-future-you-can-bet-on-it",
        "status": "identity_only",
        "latency_fit": "not_real_time",
        "exact_fill": False,
        "leader_identity_available": True,
        "copyable_now": False,
        "requires_external_approval": False,
        "why_not_copyable": "Public reporting supports identity and profitability research, not autonomous exact-fill copying.",
    },
    {
        "source_id": "caleb_public_strategy_signal_intake",
        "candidate": "Caleb Davies public strategy signal intake",
        "source_url": None,
        "status": "blocked_requires_source_backed_signal_intake",
        "latency_fit": "near_real_time_if_public_signal_source_is_configured",
        "exact_fill": False,
        "leader_identity_available": True,
        "copyable_now": False,
        "requires_external_approval": False,
        "why_not_copyable": "This can only be paper-shadowed from source-backed public signals with source URLs and manipulation-risk filters; it is not exact trade copying.",
    },
]

DISCOVERY_MILESTONES = [
    {
        "milestone_id": "FCS-01A",
        "name": "Public Identity Discovery",
        "completion_percentage": 100,
        "status": "complete",
        "evidence": "Public reporting links Foster to Foster McCoy and unusually strong Kalshi results.",
    },
    {
        "milestone_id": "FCS-01B",
        "name": "Copyable Source Verification",
        "completion_percentage": 25,
        "status": "blocked",
        "evidence": "No verified handle or exact opt-in real-time fill stream has been found.",
    },
    {
        "milestone_id": "FCS-02",
        "name": "Source Receipt Artifact",
        "completion_percentage": 100,
        "status": "complete",
        "evidence": "This receipt records source checks, blockers, and safety flags.",
    },
    {
        "milestone_id": "FCS-03",
        "name": "Verified Source Config Update",
        "completion_percentage": 40,
        "status": "blocked",
        "evidence": "The config has a disabled Foster source slot but no verified exact source to enable.",
    },
    {
        "milestone_id": "FCS-04",
        "name": "Real Signal Intake",
        "completion_percentage": 60,
        "status": "scaffold_complete_data_blocked",
        "evidence": "Signal validation exists, but real Foster exact-fill signals are still unavailable.",
    },
    {
        "milestone_id": "FCS-05",
        "name": "Shadow Outcome Resolution",
        "completion_percentage": 0,
        "status": "blocked",
        "evidence": "No real eligible Foster shadow signals exist to resolve.",
    },
    {
        "milestone_id": "FCS-06",
        "name": "Baseline and Promotion Gates",
        "completion_percentage": 0,
        "status": "blocked",
        "evidence": "Requires resolved copy-shadow outcomes and baseline comparison.",
    },
    {
        "milestone_id": "FCS-07",
        "name": "Dashboard Proof",
        "completion_percentage": 100,
        "status": "complete",
        "evidence": "Dashboard exposes Foster McCoy copy-shadow state, source blockers, milestone percentages, read-only auth status, and no-live safety flags.",
    },
    {
        "milestone_id": "FCS-08",
        "name": "Manual Live Review Packet",
        "completion_percentage": 0,
        "status": "blocked",
        "evidence": "Manual live review is not allowed until all prior gates pass and the user gives separate explicit approval.",
    },
    {
        "milestone_id": "FCS-09",
        "name": "Dual-Leader Paper Lane Scaffold",
        "completion_percentage": 100,
        "status": "complete",
        "evidence": "Local config and dashboard can carry Foster exact-fill and Caleb public-strategy paper lanes while keeping live/write authority disabled.",
    },
    {
        "milestone_id": "FCS-10",
        "name": "Public Strategy Source Intake",
        "completion_percentage": 0,
        "status": "blocked",
        "evidence": "Caleb public-strategy paper intake still needs source-backed public signal collection and manipulation-risk filtering before any paper signals are accepted.",
    },
    {
        "milestone_id": "FCS-12",
        "name": "Foster Relay Verifier Scaffold",
        "completion_percentage": 100,
        "status": "local_scaffold_complete_real_source_blocked",
        "evidence": "Local fixture validation can validate exact-fill relay sample shape, but no real Foster relay URL/token exists.",
    },
    {
        "milestone_id": "FCS-13",
        "name": "Caleb Public Signal Intake Scaffold",
        "completion_percentage": 100,
        "status": "local_scaffold_complete_real_source_blocked",
        "evidence": "Local fixture validation can reject unsafe public strategy signals, but no concrete Caleb source URLs exist.",
    },
    {
        "milestone_id": "FCS-14",
        "name": "Append-Only Signal Log Validator",
        "completion_percentage": 100,
        "status": "local_scaffold_complete",
        "evidence": "Local read-only signal log validation rejects duplicates, missing fields, stale latency, wide spread, high drift, and unsafe flags.",
    },
    {
        "milestone_id": "FCS-15",
        "name": "Dashboard Source Health Proof",
        "completion_percentage": 100,
        "status": "local_scaffold_complete",
        "evidence": "Dashboard can expose Foster relay, Caleb public signal, and signal-log verifier status while both source lanes stay disabled.",
    },
]

SAFETY_FLAGS = {
    "write_capable_kalshi_endpoint_called": False,
    "live_order_allowed": False,
    "live_trading_enabled": False,
    "can_authorize_trade": False,
    "can_authorize_paper": False,
    "can_authorize_live": False,
    "auto_live_promotion_allowed": False,
    "sts_authority": False,
}


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _configured_sources(config: dict[str, Any]) -> list[dict[str, Any]]:
    sources = config.get("signal_sources") if isinstance(config.get("signal_sources"), list) else []
    rows: list[dict[str, Any]] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        exact = source.get("source_type") == "exact_opt_in_fill" or source.get("exact_fill") is True
        verified = source.get("verification_status") == "verified"
        enabled = source.get("enabled") is True
        rows.append(
            {
                "source_id": source.get("source_id"),
                "lane_id": source.get("lane_id"),
                "leader_name": source.get("leader_name"),
                "leader_handle": source.get("leader_handle"),
                "source_type": source.get("source_type"),
                "verification_status": source.get("verification_status") or "unverified",
                "source_status": source.get("source_status") or ("enabled" if enabled else "disabled"),
                "source_url": source.get("source_url"),
                "exact_fill": exact,
                "enabled": enabled,
                "copyable_now": bool(exact and verified and enabled),
                **SAFETY_FLAGS,
            }
        )
    return rows


def _configured_lanes(config: dict[str, Any]) -> list[dict[str, Any]]:
    lanes = config.get("copy_leader_lanes") if isinstance(config.get("copy_leader_lanes"), list) else []
    rows: list[dict[str, Any]] = []
    for lane in lanes:
        if not isinstance(lane, dict):
            continue
        rows.append(
            {
                "lane_id": lane.get("lane_id"),
                "leader_name": lane.get("leader_name"),
                "leader_alias": lane.get("leader_alias"),
                "source_id": lane.get("source_id"),
                "lane_type": lane.get("lane_type"),
                "copy_mode": lane.get("copy_mode"),
                "source_status": lane.get("source_status"),
                "verification_status": lane.get("verification_status"),
                "enabled": lane.get("enabled") is True,
                "exact_copy": lane.get("exact_copy") is True,
                "requires_exact_opt_in_source": lane.get("requires_exact_opt_in_source") is True,
                "requires_source_url": lane.get("requires_source_url") is True,
                "manipulation_risk_filter_required": lane.get("manipulation_risk_filter_required") is True,
                "blockers": lane.get("blockers") if isinstance(lane.get("blockers"), list) else [],
                "next_action": lane.get("next_action"),
                **SAFETY_FLAGS,
            }
        )
    return rows


def _authenticated_read_probe(enabled: bool) -> dict[str, Any]:
    if not enabled:
        return {
            "attempted": False,
            "ok": None,
            "status_code": None,
            "path": "/markets",
            "detail": "Skipped by command flag.",
            **SAFETY_FLAGS,
        }
    result = kalshi_get("/markets", {"limit": 1, "status": "open"}, timeout=10.0)
    return {
        "attempted": True,
        "ok": result.get("ok") is True,
        "status_code": result.get("status_code"),
        "path": "/markets",
        "detail": "Signed read-only Kalshi market read succeeded."
        if result.get("ok") is True
        else str((result.get("error") or {}).get("message") or "signed read failed"),
        **SAFETY_FLAGS,
    }


def build_discovery_receipt(*, probe_authenticated_read: bool = False, config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config if isinstance(config, dict) else _read_json(CONFIG_PATH)
    target = config.get("target_leader") if isinstance(config.get("target_leader"), dict) else {}
    configured_sources = _configured_sources(config)
    configured_lanes = _configured_lanes(config)
    exact_copyable_sources = [source for source in configured_sources if source.get("copyable_now") is True]
    public_identity_sources = [source for source in PUBLIC_EVIDENCE if source["verifies_public_identity"]]
    blockers = []
    if not exact_copyable_sources:
        blockers.append("no_verified_exact_opt_in_foster_fill_source")
    if not any(source.get("leader_handle") for source in configured_sources):
        blockers.append("foster_kalshi_handle_unverified")
    if any(lane.get("lane_id") == "caleb_public_strategy_shadow" and lane.get("enabled") is not True for lane in configured_lanes):
        blockers.append("caleb_public_signal_intake_not_verified")

    receipt = {
        "ok": True,
        "schema_version": "copy_shadow_source_discovery_v1",
        "generated_at_utc": utc_now(),
        "mode": "READ_ONLY_SOURCE_DISCOVERY",
        "target_leader": {
            "leader_name": "Foster McCoy",
            "leader_alias": target.get("leader_name") or "Foster",
            "leader_handle": target.get("leader_handle"),
            "verification_status": "public_identity_verified_source_unverified",
            "source_status": "blocked_no_exact_source",
            **SAFETY_FLAGS,
        },
        "public_identity": {
            "status": "verified_public_reporting",
            "verified": True,
            "evidence_count": len(public_identity_sources),
            "evidence": PUBLIC_EVIDENCE,
            **SAFETY_FLAGS,
        },
        "authenticated_read_probe": _authenticated_read_probe(probe_authenticated_read),
        "configured_sources": configured_sources,
        "copy_leader_lanes": configured_lanes,
        "copyable_exact_source": {
            "verified": bool(exact_copyable_sources),
            "source_count": len(exact_copyable_sources),
            "status": "verified" if exact_copyable_sources else "blocked",
            "blockers": blockers,
            "next_action": "Obtain Foster McCoy's verified Kalshi handle and exact opt-in real-time fill stream; configure Caleb public-strategy intake only after source-backed manipulation filters pass.",
            **SAFETY_FLAGS,
        },
        "candidate_sources_reviewed": [{**source, **SAFETY_FLAGS} for source in SOURCE_CANDIDATES],
        "approval_required_actions": [
            {
                "action": "verify_external_exact_fill_source",
                "required_before": "using any paid/private/third-party Foster source or enabling any source",
                "approval_text": EXTERNAL_SOURCE_APPROVAL_TEXT,
                **SAFETY_FLAGS,
            }
        ],
        "milestones": DISCOVERY_MILESTONES,
        "overall_completion_percentage": 32,
        "next_blocker": blockers[0] if blockers else None,
        "next_action": "Get a consented exact-fill Foster McCoy source and keep Caleb public-strategy intake disabled until source-backed signal validation exists.",
        "artifact_path": "work/scripts/kalshi/kalshi_copy_shadow_source_discovery_v1.json",
        "config_path": "work/scripts/kalshi/kalshi_copy_shadow_config.json",
        "unsafe_true_flags": [],
        **SAFETY_FLAGS,
    }
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a read-only Foster copy-shadow source-discovery receipt.")
    parser.add_argument(
        "--probe-authenticated-read",
        action="store_true",
        help="Run one signed read-only Kalshi market read to prove credentials without account mutation.",
    )
    args = parser.parse_args(argv)
    try:
        receipt = build_discovery_receipt(probe_authenticated_read=args.probe_authenticated_read)
        atomic_write_json(RECEIPT_PATH, receipt)
        print(
            json.dumps(
                success_envelope(
                    script=SCRIPT,
                    path=str(RECEIPT_PATH),
                    data=receipt,
                    mode=READ_ONLY_MODE,
                ),
                sort_keys=True,
            )
        )
        return 0
    except Exception as exc:  # pragma: no cover - defensive CLI envelope
        print(json.dumps(failure_envelope(script=SCRIPT, path=str(RECEIPT_PATH), exc=exc), sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

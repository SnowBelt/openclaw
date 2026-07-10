/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderKalshiDashboard, type KalshiDashboardProps } from "./kalshi-dashboard.ts";

function createProps(overrides: Partial<KalshiDashboardProps> = {}): KalshiDashboardProps {
  return {
    loading: false,
    error: null,
    lastFetchAt: 0,
    timezone: "America/New_York",
    timeframe: "24h",
    pnlTimeframe: "all",
    strategySort: "problem_first",
    showDeepAudit: true,
    auditTablePages: {},
    auditTableQueries: {},
    onTimezoneChange: () => undefined,
    onTimeframeChange: () => undefined,
    onPnlTimeframeChange: () => undefined,
    onStrategySortChange: () => undefined,
    onToggleDeepAudit: () => undefined,
    onAuditTablePageChange: () => undefined,
    onAuditTableQueryChange: () => undefined,
    onRefresh: () => undefined,
    snapshot: {
      generated_at_utc: "2026-05-03T00:08:00Z",
      live_order_allowed: false,
      auto_apply_allowed: false,
      dashboard_refresh: {
        in_progress: false,
        stale: false,
        age_ms: 12_000,
        last_error: null,
      },
      paper: {
        total_decisions: 120,
        accepted: 6,
        exploration: 4,
        forward_paper: 2,
        rejected: 2,
        no_trade: 118,
      },
      paper_trade_accelerator: {
        route_mix: {
          overall: {
            SHADOW_ONLY: 14,
            ACCEPT_EXPLORATION: 2,
            ACCEPT_PAPER: 3,
            FORWARD_PAPER: 1,
          },
          weather_crypto: {
            ACCEPT_EXPLORATION: 2,
            FORWARD_PAPER: 1,
            ACCEPT_PAPER: 3,
            SHADOW_ONLY: 14,
          },
        },
        route_mix_total: {
          overall: {
            SHADOW_ONLY: 0.7,
            ACCEPT_EXPLORATION: 0.1,
            ACCEPT_PAPER: 0.15,
            FORWARD_PAPER: 0.05,
          },
          weather_crypto: {
            SHADOW_ONLY: 0.72,
            ACCEPT_EXPLORATION: 0.11,
            ACCEPT_PAPER: 0.13,
            FORWARD_PAPER: 0.04,
          },
        },
      },
      supreme_trading_strategy: {
        ok: true,
        schema_version: "sts-v1",
        generated_at_utc: "2026-05-03T00:08:00Z",
        mode: "PAPER_ONLY",
        status: "degraded",
        confidence_score: 0.62,
        current_regime: {
          label: "stale_source",
          confidence_score: 0.65,
          drivers: ["Outcome resolver is hitting market fetch failures."],
          live_order_allowed: false,
        },
        objective_scores: {
          accuracy: 0.85,
          calibration: 0.72,
          profitability: 0,
          learning_speed: 0.66,
          robustness: 1,
          statistical_validity: 1,
        },
        strategy_weights: [
          {
            strategy_id: "market_implied_baseline",
            domain: "all",
            regime_label: "stale_source",
            weight: 0.78,
            train_rows: 4480,
            test_rows: 1921,
            reason: "Market baseline retained.",
            live_order_allowed: false,
          },
          {
            strategy_id: "no_trade_baseline",
            domain: "all",
            regime_label: "stale_source",
            weight: 0.16,
            reason: "No-trade weight stays elevated.",
            live_order_allowed: false,
          },
        ],
        top_rationales: [
          {
            title: "Market baseline remains the champion",
            evidence: "Weather/Crypto rows: 6401.",
            impact: "STS weights market-implied probability highest.",
            live_order_allowed: false,
          },
        ],
        risk: {
          primary_blocker: "outcome_fetch_gap",
          live_order_allowed: false,
        },
        performance: { champion_status: "market_champion_retained" },
        learning: {
          weather_crypto_dataset_rows: 6401,
          sts_feature_rows: 6401,
          telemetry_snapshot_count: 80,
          markov_coverage_status: "ready_for_uplift_validation",
          domain_learning_acceleration: {
            enabled: true,
            weather_crypto_boost: 1.14,
            weather_crypto_raw_boost: 1.22,
            learning_velocity_multiplier: 1.09,
            weather_boost: 1.12,
            crypto_boost: 1.11,
            weather_crypto_decay_factor_weather: 0.91,
            weather_crypto_decay_factor_crypto: 0.83,
            weather_crypto_recent_edge_weather: 0.31,
            weather_crypto_recent_edge_crypto: 0.19,
            weather_crypto_decay_factor: 0.88,
            weather_crypto_recent_edge: 0.26,
            weather_crypto_stochastic_process_multiplier: 1.03,
            weather_crypto_stochastic_process_reason:
              "Stochastic diagnostics are currently improving route confidence.",
            weather_crypto_walk_forward_stability_multiplier: 0.97,
            weather_crypto_walk_forward_stability_reason:
              "Walk-forward stability is currently neutral-to-positive and keeps routing pressure largely intact.",
            stochastic_decay_reason: "Recent edge decayed from 0.35 to 0.26; applying decay guard.",
            weather_crypto_regime_decay_weather: {
              dry_front: {
                decay_factor: 0.81,
                late_edge: 0.17,
                reason: "Dry front backtest edge rolled over.",
              },
            },
            weather_crypto_regime_decay_crypto: {
              spike_reversal: {
                decay_factor: 0.73,
                late_edge: 0.12,
                reason: "Crypto regime edge decayed over latest buckets.",
              },
            },
            weather_crypto_reason:
              "Weather strength 26.0% · Crypto strength 24.0%; route weight is boosted when recent backtest rows remain clearly predictive.",
            sports_blocked: true,
            weather_crypto_sports_row_multiplier: 0,
            sports_reason: "Sports stays blocked until dedicated out-of-sample evidence exists.",
          },
          stochastic_process_policy: {
            coverage_status: "collecting",
            status: "neutral_collecting",
          },
        },
        model_health: { observability_status: "degraded" },
        data_health: { market_telemetry_ok: true },
        next_action:
          "Repair outcome fetch coverage so STS can learn faster from resolved paper labels.",
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
      self_improvement: {
        metrics: {
          brier_score: null,
          missing_outcome_rate: 1,
          scored_decisions: 3,
          exploration_paper_decisions: 4,
          forward_paper_decisions: 2,
          realized_paper_pnl_all_time_usd: 1.25,
          realized_paper_pnl_last_24h_usd: 0.75,
          realized_paper_pnl_last_7d_usd: 1.25,
          paper_performance_by_timeframe: {
            all: {
              label: "All time",
              scored_decisions: 3,
              wins: 2,
              losses: 1,
              accuracy: 0.667,
              net_pnl_usd: 1.25,
              total_profit_usd: 2,
              total_loss_usd: 0.75,
              category_accuracy: [
                {
                  category: "weather",
                  label: "Weather",
                  scored: 2,
                  wins: 2,
                  losses: 0,
                  accuracy: 1,
                  net_pnl_usd: 2,
                  total_profit_usd: 2,
                  total_loss_usd: 0,
                },
                {
                  category: "sports",
                  label: "Sports",
                  scored: 1,
                  wins: 0,
                  losses: 1,
                  accuracy: 0,
                  net_pnl_usd: -0.75,
                  total_profit_usd: 0,
                  total_loss_usd: 0.75,
                },
              ],
            },
            "6h": {
              label: "6 hours",
              scored_decisions: 1,
              wins: 1,
              losses: 0,
              accuracy: 1,
              net_pnl_usd: 1.25,
              total_profit_usd: 1.25,
              total_loss_usd: 0,
              category_accuracy: [
                {
                  category: "weather",
                  label: "Weather",
                  scored: 1,
                  wins: 1,
                  losses: 0,
                  accuracy: 1,
                  net_pnl_usd: 1.25,
                  total_profit_usd: 1.25,
                  total_loss_usd: 0,
                },
              ],
            },
            "1h": {
              label: "1 hour",
              scored_decisions: 0,
              wins: 0,
              losses: 0,
              accuracy: null,
              net_pnl_usd: 0,
              total_profit_usd: 0,
              total_loss_usd: 0,
              category_accuracy: [],
            },
          },
          paper_activity_by_timeframe: {
            "1h": {
              label: "1 hour",
              decisions: 12,
              accepted: 2,
              rejected: 4,
              no_trade: 6,
              outcomes_recorded: 0,
              scored_accepted: 0,
              latest_scored_outcome_utc: null,
            },
          },
          average_pnl_per_scored_trade_usd: 0.42,
          accuracy: 0.667,
          accuracy_last_24h: 1,
          accuracy_last_7d: 0.667,
          accuracy_wins: 2,
          accuracy_sample_size: 3,
          scored_directional_decisions: 3,
          scored_decisions_last_1h: 0,
          scored_decisions_last_6h: 1,
          scored_decisions_last_24h: 3,
          latest_scored_outcome_utc: "2026-05-03T20:00:00Z",
          unresolved_paper_exposure_usd: 8,
          fair_value_source_performance: {
            manual_input: { decisions: 6, scored: 3 },
          },
        },
      },
      learning_velocity: {
        status: "HIGH_SPEED_LEARNING",
        resolved_last_1h: 12,
        shadow_resolved_last_1h: 6,
        live_order_allowed: false,
      },
      strategy_scorecard: {
        scorecard_id: "fixture-scorecard",
        summary: {
          scored_accepted_decisions: 3,
          accuracy: 0.667,
          realized_pnl_usd: 1.25,
          paused_segments: 1,
          forward_paper_candidates: 0,
          live_review_candidates: 0,
        },
        trend: {
          x_axis: "Scored accepted paper trades over time",
          y_axis_left: "Accuracy",
          y_axis_right: "Cumulative paper P&L USD",
          points: [
            {
              index: 1,
              timestamp_utc: "2026-05-03T00:01:00Z",
              accuracy: 1,
              cumulative_pnl_usd: 1.25,
              latest_trade_pnl_usd: 1.25,
            },
            {
              index: 2,
              timestamp_utc: "2026-05-03T00:02:00Z",
              accuracy: 0.75,
              cumulative_pnl_usd: 0.5,
              latest_trade_pnl_usd: -0.75,
            },
            {
              index: 3,
              timestamp_utc: "2026-05-03T00:03:00Z",
              accuracy: 0.667,
              cumulative_pnl_usd: 0.1,
              latest_trade_pnl_usd: -0.4,
            },
            {
              index: 4,
              timestamp_utc: "2026-05-03T00:04:00Z",
              accuracy: 0.5,
              cumulative_pnl_usd: -0.25,
              latest_trade_pnl_usd: -0.35,
            },
            {
              index: 5,
              timestamp_utc: "2026-05-03T00:05:00Z",
              accuracy: 0.6,
              cumulative_pnl_usd: 0.75,
              latest_trade_pnl_usd: 1,
            },
            {
              index: 6,
              timestamp_utc: "2026-05-03T00:06:00Z",
              accuracy: 0.667,
              cumulative_pnl_usd: 1.25,
              latest_trade_pnl_usd: 0.5,
            },
            {
              index: 7,
              timestamp_utc: "2026-05-03T00:07:00Z",
              accuracy: 0.714,
              cumulative_pnl_usd: 1.7,
              latest_trade_pnl_usd: 0.45,
            },
            {
              index: 8,
              timestamp_utc: "2026-05-03T00:08:00Z",
              accuracy: 0.75,
              cumulative_pnl_usd: 2.25,
              latest_trade_pnl_usd: 0.55,
            },
          ],
        },
        segments: [
          {
            segment: "weather|NEW YORK|temperature|weather_model",
            status: "paused",
            domain: "weather",
            allowed_application_scope: "same_domain",
            transferability: "domain_specific",
            scored: 30,
            wins: 3,
            win_rate: 0.1,
            simulated_pnl_usd: -12,
            brier_score: 0.5,
            market_baseline_brier_score: 0.25,
          },
        ],
        learning_map: {
          taxonomy_version: "2026-05-04",
          domain_performance: [
            {
              domain: "weather",
              decisions: 80,
              accepted: 6,
              scored: 3,
              wins: 2,
              win_rate: 0.667,
              simulated_pnl_usd: 1.25,
              brier_score: 0.21,
              transfer_blocked: 0,
            },
            {
              domain: "sports",
              decisions: 10,
              accepted: 1,
              scored: 0,
              wins: 0,
              win_rate: null,
              simulated_pnl_usd: 0,
              brier_score: null,
              transfer_blocked: 0,
            },
          ],
          transfer_safe_lessons: ["liquidity", "spread", "depth"],
          domain_only_lessons: ["weather_model_edge", "sports_market_edge"],
          exploration_allocation: {
            proven_same_domain_forward_paper: 0.7,
            promising_same_domain_exploration: 0.2,
            new_hypotheses: 0.1,
          },
          negative_transfer_warnings: ["weather-to-sports transfer is forbidden"],
        },
        lessons_learned: [
          {
            lesson_id: "lesson-1",
            type: "pause_or_tighten_lane",
            status: "paused",
            segment: "weather|NEW YORK|temperature|weather_model",
            segment_label: "Weather temperature using weather model",
            title: "Stop adding paper risk here until evidence improves",
            evidence: "30 resolved paper trades, 3 wins, win rate 10.0%, paper P&L $-12.00.",
            change:
              "Pause this paper lane or require stricter edge, better depth, and clearer timing before another accepted paper trade.",
            expected_effect:
              "Reduces repeated simulated losses and pushes learning budget toward lanes with better evidence.",
            metric_to_watch: "paper P&L, accuracy, Brier score, and resolved sample size",
            confidence: "medium",
            auto_apply_allowed: false,
            live_order_allowed: false,
          },
        ],
        improvement_summary: {
          plain_english:
            "OpenClaw learns from resolved paper trades only. Losing or poorly calibrated lanes are paused or tightened.",
          what_needs_to_happen_next: [
            "Resolve pending accepted paper trades so accuracy and P&L can update.",
            "Shift new paper budget away from paused losing lanes.",
          ],
          auto_apply_allowed: false,
          live_order_allowed: false,
        },
      },
      performance_summary: {
        trend_direction: "mixed",
        best_segment: {
          segment: "weather|BOSTON|temperature|weather_model",
          status: "learning",
          scored: 12,
          win_rate: 0.58,
          simulated_pnl_usd: 4,
        },
        worst_segment: {
          segment: "weather|NEW YORK|temperature|weather_model",
          status: "paused",
          scored: 30,
          win_rate: 0.1,
          simulated_pnl_usd: -12,
        },
      },
      data_quality: {
        generated_age_minutes: 0,
        latest_scheduled_age_minutes: 4,
        latest_weather_age_minutes: 5,
        stale: false,
        warnings: [],
      },
      milestone_countdown: {
        ok: true,
        generated_at_utc: "2026-05-03T00:08:00Z",
        plain_english: "Conservative paper milestones only; Waiting means no defensible ETA.",
        milestones: [
          {
            milestone_id: "proof",
            label: "Proof",
            status: "tracking",
            eta_seconds: 183_840,
            eta_label: "2d 3h 4m",
            completion_score: 4.6,
            criteria: [
              { label: "Count", score: 3, eta_label: "2d 3h 4m", live_order_allowed: false },
              { label: "Profit", score: 0, eta_label: "Waiting", live_order_allowed: false },
              { label: "Accuracy", score: 8, eta_label: "Waiting", live_order_allowed: false },
              { label: "Baseline", score: 10, eta_label: "0d 0h 0m", live_order_allowed: false },
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
          {
            milestone_id: "profit",
            label: "Profit",
            status: "waiting",
            eta_seconds: null,
            eta_label: "Waiting",
            completion_score: 5,
            criteria: [
              { label: "Profit", score: 0, eta_label: "Waiting", live_order_allowed: false },
              { label: "Accuracy", score: 10, eta_label: "0d 0h 0m", live_order_allowed: false },
              { label: "Count", score: 5, eta_label: "3d 0h 0m", live_order_allowed: false },
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
          {
            milestone_id: "weather",
            label: "Weather",
            status: "tracking",
            eta_seconds: 10_800,
            eta_label: "0d 3h 0m",
            completion_score: 7,
            criteria: [
              { label: "Source", score: 10, eta_label: "0d 0h 0m", live_order_allowed: false },
              { label: "Baseline", score: 7, eta_label: "Waiting", live_order_allowed: false },
              { label: "ML", score: 4, eta_label: "0d 3h 0m", live_order_allowed: false },
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
          {
            milestone_id: "crypto",
            label: "Crypto",
            status: "waiting",
            eta_seconds: null,
            eta_label: "Waiting",
            completion_score: 3.3,
            criteria: [
              { label: "Basis", score: 0, eta_label: "Waiting", live_order_allowed: false },
              { label: "ML", score: 10, eta_label: "0d 0h 0m", live_order_allowed: false },
              { label: "Baseline", score: 0, eta_label: "Waiting", live_order_allowed: false },
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
          {
            milestone_id: "review",
            label: "Review",
            status: "waiting",
            eta_seconds: null,
            eta_label: "Waiting",
            completion_score: 4,
            criteria: [
              { label: "Count", score: 2, eta_label: "2d 3h 4m", live_order_allowed: false },
              { label: "Profit", score: 0, eta_label: "Waiting", live_order_allowed: false },
              { label: "Safety", score: 10, eta_label: "0d 0h 0m", live_order_allowed: false },
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
        ],
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
      accelerator: {
        decision_quality: {
          total: 120,
          accepted: 6,
          exploration: 4,
          forward_paper: 2,
          no_trade: 118,
          rejected: 2,
          top_no_trade_or_rejection_reasons: { "not two-sided": 118 },
        },
        distance_to_live_readiness: {
          accepted_rate: 0,
          resolved_outcomes: 0,
          resolved_outcomes_needed: 30,
        },
        ranked_actions: [
          {
            rank: 1,
            priority: "critical",
            type: "increase_scoreable_paper_candidates",
            evidence: "0 accepted paper decisions out of 120 total.",
            implementation_hint: "Add independent fair-value lanes.",
          },
        ],
        scheduler: {
          scheduled_run_count: 12,
          weather_run_count: 4,
          latest_scheduled_ok: true,
          latest_weather_ok: true,
        },
        weather_lane: {
          latest_discovery_parsed: 14,
          latest_discovery_trade_ready: 8,
          latest_run_parsed: 0,
          latest_run_trade_ready: 0,
          weather_expansion: {
            registered_city_count: 31,
            covered_city_count: 3,
            covered_cities: ["NEW YORK", "BOSTON", "PHOENIX"],
            watchlist_cities_without_trade_ready_markets: ["SAN FRANCISCO", "DENVER"],
            unsupported_weather_series_cities: ["DETROIT"],
            market_type_coverage: { high_temperature: 8 },
            discovery_approach: ["Kalshi Climate and Weather series-first discovery"],
            recommended_cities: [
              {
                city: "SAN FRANCISCO",
                station: "KSFO",
                weather_regime: "pacific_marine",
                score: 75,
                existing_trade_ready_markets: 0,
              },
            ],
          },
        },
      },
      paper_volume_accelerator: {
        metrics: {
          total_decisions: 120,
          accepted_decisions: 6,
          exploration_decisions: 4,
          resolved_outcomes: 3,
          outcome_backlog: 3,
          pending_resolution_buckets: { due_6h: 2, long_dated: 1 },
          pending_fast_resolution_count: 2,
          pending_slow_or_unknown_count: 1,
          unknown_timing_pending_count: 0,
          accepted_rate: 0.05,
          resolved_rate: 0.5,
          accepted_to_resolved_conversion_rate: 0.5,
          resolved_accepted_outcomes_per_day: 3,
          latest_scored_outcome_age_minutes: 42,
          current_learning_bottleneck: "low_resolution_rate",
          what_must_happen_next_to_learn_faster:
            "Run outcome scoring before expanding long-horizon paper exposure.",
          estimated_cycles_to_100_accepted: 19,
        },
        recommended_cycle_settings: {
          focused_watchlist: true,
          observe_limit: 30,
          max_orderbooks: 15,
          max_watchlist_markets: 35,
          max_auto_candidates: 18,
          resolution_priority: "high",
        },
        recommended_allocation: {
          weather_and_objective_fast_resolution: 0.5,
          high_liquidity_market_making_simulation: 0.2,
          historical_replay_research: 0.2,
          new_hypotheses: 0.1,
        },
        rapid_learning_plan: {
          mode: "PAPER_ONLY",
          objective: "maximize_scoreable_paper_evidence_per_cycle_without_live_trading",
          speed_mode_enabled: true,
          primary_bottleneck: "low_resolution_rate",
          bottlenecks: [
            {
              type: "low_resolution_rate",
              severity: "high",
              evidence: "Only 50.0% of accepted paper trades have resolved.",
              fix: "Run outcome scoring before expanding long-horizon paper exposure.",
            },
          ],
          next_cycle_profile: {
            observe_limit: 30,
            max_orderbooks: 15,
            max_watchlist_markets: 35,
            max_auto_candidates: 18,
            require_fast_resolution: true,
            max_hours_to_resolution: 24,
            allow_unknown_resolution: false,
            paper_exploration_enabled: true,
            max_exploration_size_usd: 2,
            resolution_priority: "high",
          },
          evidence_targets: {
            accepted_paper_trades_per_cycle: 5,
            minimum_resolved_outcomes: 30,
            minimum_domains_with_scoreable_candidates: 2,
            prefer_resolution_within_hours: 24,
            historical_replay_required: true,
          },
          read_efficiency: {
            use_batch_orderbooks: true,
            batch_orderbook_limit_tickers: 100,
            use_batch_candlesticks_for_historical_replay: true,
            avoid_blind_polling: true,
          },
          domain_targets: [
            {
              domain: "weather",
              current_decision_count: 80,
              target: "maintain_or_score",
              rule: "Use only independent non-LLM fair values and keep lessons domain-scoped.",
            },
            {
              domain: "sports",
              current_decision_count: 0,
              target: "expand_scoreable_lane",
              rule: "Use only independent non-LLM fair values and keep lessons domain-scoped.",
            },
          ],
          proof_rules: {
            exploration_counts_as_learning_not_live_proof: true,
            forward_paper_required_for_live_review: true,
            category_lessons_transfer_across_domains: false,
            live_order_allowed: false,
            auto_apply_to_live_allowed: false,
          },
        },
        ranked_actions: [
          {
            rank: 1,
            priority: "high",
            type: "convert_pending_paper_trades_to_scored_evidence",
            evidence: "3 accepted paper trades are unresolved.",
            implementation_hint:
              "Schedule outcome checks before expanding long-horizon candidate volume.",
            live_order_allowed: false,
            auto_apply_allowed: false,
          },
        ],
      },
      weather_model_audit: {
        weather_decisions: 12,
        scored_weather_decisions: 6,
        unresolved_weather_decisions: 6,
        failure_modes: { high_confidence_weather_miss: 4, edge_too_thin_after_costs: 2 },
        primary_action: {
          type: "tighten_or_pause_weather_bucket",
          priority: "high",
          recommendation:
            "Tighten this weather bucket before accepting more rapid-learning paper trades.",
          live_order_allowed: false,
          auto_apply_allowed: false,
        },
        bucket_summaries: [
          {
            city: "CHICAGO",
            market_type: "high_temperature",
            scored: 6,
            win_rate: 0.333333,
            simulated_pnl_usd: -5.25,
            failure_modes: { high_confidence_weather_miss: 4 },
            action: {
              recommendation:
                "Tighten this weather bucket before accepting more rapid-learning paper trades.",
            },
          },
        ],
        plain_english:
          "Tighten this weather bucket before accepting more rapid-learning paper trades.",
      },
      shadow_discovery: {
        metrics: {
          shadow_trades: 9,
          scored_shadow_trades: 6,
          newly_scored_shadow_trades: 2,
          unresolved_shadow_trades: 3,
          directional_scored_shadow_trades: 4,
          shadow_wins: 3,
          shadow_win_rate: 0.75,
          shadow_hypothetical_pnl_usd: 1.25,
          no_trade_baselines: 3,
        },
        by_action: [
          {
            action: "SHADOW_BUY_YES",
            scored: 3,
            directional_scored: 3,
            wins: 2,
            win_rate: 0.6667,
            hypothetical_pnl_usd: 0.75,
          },
          {
            action: "SHADOW_BUY_NO",
            scored: 1,
            directional_scored: 1,
            wins: 1,
            win_rate: 1,
            hypothetical_pnl_usd: 0.5,
          },
        ],
        best_segments: [
          {
            domain: "weather",
            market_category: "weather",
            shadow_action: "SHADOW_BUY_YES",
            directional_scored: 3,
            win_rate: 0.6667,
            hypothetical_pnl_usd: 0.75,
            eligible_for_exploration_review: true,
          },
        ],
        exploration_review_candidates: [
          {
            domain: "weather",
            shadow_action: "SHADOW_BUY_YES",
            directional_scored: 3,
            win_rate: 0.6667,
            hypothetical_pnl_usd: 0.75,
            eligible_for_exploration_review: true,
          },
        ],
        plain_english: "Shadow discovery scores hypothetical trades OpenClaw did not accept.",
        live_order_allowed: false,
        auto_apply_allowed: false,
      },
      inverse_strategy_audit: {
        metrics: {
          total_directional_scored: 126,
          original_accuracy: 0.0952,
          inverse_accuracy: 0.9048,
          accuracy_delta_inverse_minus_original: 0.8095,
          original_pnl_usd: -201.8,
          inverse_pnl_usd: 133.1,
          pnl_delta_inverse_minus_original_usd: 334.9,
          executable_quality_trades: 24,
          executable_quality_fraction: 0.1905,
          synthetic_or_unpriced_trades: 102,
          contrarian_forward_paper_candidates: [],
          best_segments: [
            {
              domain: "weather",
              scored: 61,
              original_win_rate: 0.0492,
              inverse_win_rate: 0.9508,
              original_pnl_usd: -42.1,
              inverse_pnl_usd: 34.6,
              inverse_minus_original_pnl_usd: 76.7,
              executable_quality_fraction: 0.1311,
              contrarian_forward_paper_candidate: false,
              live_order_allowed: false,
              auto_apply_allowed: false,
            },
          ],
        },
        recommendations: [
          {
            type: "test_inverse_strategy_forward_paper",
            status: "REVIEW_REQUIRED",
            evidence:
              "Inverse Standard Strategy audit accuracy 90.5% vs Standard Strategy 9.5%; P&L delta +334.90 USD.",
            proposed_change:
              "Create bounded forward-paper candidates for qualifying Inverse Standard Strategy segments only.",
            auto_apply_allowed: false,
            live_order_allowed: false,
          },
        ],
        plain_english:
          "This audit tests the exact question: would the opposite side of resolved directional paper trades have performed better?",
        live_order_allowed: false,
        auto_apply_allowed: false,
      },
      strategy_comparison: {
        ok: true,
        scope: "paper_only_current_epoch",
        primary_metric_source: "actual_accepted_paper_trades",
        secondary_metric_source: "historical_inverse_audit",
        actual_summary: {
          standard_accuracy: 0.4,
          inverse_standard_accuracy: 0.7,
          accuracy_delta_inverse_minus_standard: 0.3,
          standard_pnl_usd: -10,
          inverse_standard_pnl_usd: 12.5,
          pnl_delta_inverse_minus_standard_usd: 22.5,
          standard_scored: 10,
          inverse_standard_scored: 10,
          live_order_allowed: false,
        },
        audit_summary: {
          standard_accuracy: 0.0952,
          inverse_standard_accuracy: 0.9048,
          accuracy_delta_inverse_minus_standard: 0.8095,
          standard_pnl_usd: -201.8,
          inverse_standard_pnl_usd: 133.1,
          pnl_delta_inverse_minus_standard_usd: 334.9,
          scored: 126,
          executable_quality_fraction: 0.1905,
          synthetic_or_unpriced_trades: 102,
          live_order_allowed: false,
        },
        plain_english:
          "This section now uses actual accepted paper trades as the primary numbers. The historical inverse audit remains visible as supporting evidence, but it is not counted as actual Inverse Standard Strategy performance.",
        rows: [
          {
            strategy_id: "standard_strategy",
            display_name: "Standard Strategy",
            role: "Standard Strategy baseline kept for comparison.",
            decisions: 24,
            accepted: 20,
            shadow_decisions: 4,
            scored: 10,
            accuracy: 0.4,
            paper_pnl_usd: -10,
            average_pnl_per_scored_trade_usd: -1,
            unresolved: 10,
            domains: { weather: 12, sports: 8, crypto: 4 },
            audit_accuracy: 0.0952,
            audit_pnl_usd: -201.8,
            tracking_status: "baseline",
            next_step: "Use as the control group.",
            live_order_allowed: false,
          },
          {
            strategy_id: "inverse_standard_strategy",
            display_name: "Inverse Standard Strategy",
            role: "Active Inverse Standard Strategy paper strategy.",
            decisions: 18,
            accepted: 12,
            shadow_decisions: 6,
            scored: 10,
            accuracy: 0.7,
            paper_pnl_usd: 12.5,
            average_pnl_per_scored_trade_usd: 1.25,
            unresolved: 2,
            domains: { weather: 18 },
            audit_accuracy: 0.9048,
            audit_pnl_usd: 133.1,
            tracking_status: "tracking",
            next_step: "Keep proving executable forward-paper quality.",
            live_order_allowed: false,
          },
          {
            strategy_id: "weather_arbitrage_strategy",
            display_name: "Weather Arbitrage Strategy",
            role: "Paper-only weather arbitrage lane.",
            decisions: 0,
            accepted: 0,
            shadow_decisions: 0,
            scored: 0,
            accuracy: null,
            paper_pnl_usd: 0,
            average_pnl_per_scored_trade_usd: null,
            unresolved: 0,
            domains: {},
            tracking_status: "waiting_for_weather_arbitrage_scanner",
            next_step: "Build bucket-level weather arbitrage scanner.",
            live_order_allowed: false,
          },
          {
            strategy_id: "polyclaw",
            display_name: "PolyClaw",
            role: "PolyClaw skill lane.",
            decisions: 0,
            accepted: 0,
            shadow_decisions: 0,
            scored: 0,
            accuracy: null,
            paper_pnl_usd: 0,
            average_pnl_per_scored_trade_usd: null,
            unresolved: 0,
            domains: {},
            tracking_status: "waiting_for_polyclaw_skill_data",
            next_step: "Run PolyClaw in paper-only mode.",
            live_order_allowed: false,
          },
          {
            strategy_id: "polymarket_kalshi_divergence",
            display_name: "polymarket-kalshi-divergence",
            role: "Polymarket/Kalshi divergence skill lane.",
            decisions: 0,
            accepted: 0,
            shadow_decisions: 0,
            scored: 0,
            accuracy: null,
            paper_pnl_usd: 0,
            average_pnl_per_scored_trade_usd: null,
            unresolved: 0,
            domains: {},
            tracking_status: "waiting_for_polymarket_kalshi_divergence_skill_data",
            next_step: "Run the polymarket-kalshi-divergence skill in paper-only mode.",
            live_order_allowed: false,
          },
          {
            strategy_id: "strategy_bucket:source_lag_surface",
            display_name: "Source Lag Surface",
            role: "Named weather/crypto source-lag strategy lane.",
            decisions: 9,
            accepted: 3,
            shadow_decisions: 6,
            scored: 2,
            accuracy: 0.5,
            paper_pnl_usd: -4.5,
            average_pnl_per_scored_trade_usd: -2.25,
            unresolved: 1,
            domains: { weather: 6, crypto: 3 },
            tracking_status: "tracking",
            next_step: "Keep source-backed weather/crypto hypotheses paper-only.",
            live_order_allowed: false,
          },
        ],
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
      opportunity_engine: {
        metrics: {
          opportunities_detected: 2,
          experiments_created: 1,
          possible_bug: 1,
          low_quality_data: 0,
          live_order_allowed: false,
          auto_live_promotion_allowed: false,
        },
        opportunities: [
          {
            opportunity_id: "opp-1",
            detector: "inverse_detector",
            diagnosis: "likely_edge",
            status: "in_forward_paper",
            domain: "weather",
            evidence: "Inverse Standard Strategy side beat Standard Strategy weather segment.",
            next_paper_action: "Create a segment-scoped inverse forward-paper experiment.",
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
          {
            opportunity_id: "opp-2",
            detector: "data_quality_detector",
            diagnosis: "possible_bug",
            status: "bug_review_required",
            domain: "weather",
            evidence: "Weather parser direction needs review.",
            next_paper_action: "Review parser before creating new paper risk.",
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
        ],
        experiments: [
          {
            experiment_id: "opp-exp-1",
            opportunity_id: "opp-1",
            detector: "inverse_detector",
            domain: "weather",
            experiment_type: "bounded_forward_paper",
            paper_notional_usd: 1,
            status: "active",
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
        ],
        diagnostics: {
          plain_english: "The opportunity engine searches for hidden paper-strategy improvements.",
        },
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
        paper_auto_apply_allowed: true,
      },
      strategy_governor: {
        routed_count: 42,
        action_counts: {
          INVERSE_FORWARD_TEST: 3,
          PAUSE_SEGMENT: 2,
          REJECT_DATA_QUALITY: 7,
          SHADOW_ONLY: 30,
        },
        accepted_or_tested_count: 3,
        shadow_or_blocked_count: 39,
        inverse_forward_tests: 3,
        plain_english:
          "The strategy governor routes each paper candidate through clean-evidence, inverse-signal, segment-health, and firewall checks.",
        latest_change: {
          governor_action: "INVERSE_FORWARD_TEST",
          plain_language_reason:
            "Inverse signal passed clean evidence checks for weather temperature only.",
          segment_scope: "leaf|weather|temperature|high_temperature|inverse_probe",
          rollback_rule:
            "Stop inverse paper tests for this segment if forward-paper evidence worsens.",
          live_order_allowed: false,
          auto_live_promotion_allowed: false,
        },
        top_active_hypothesis: {
          governor_action: "INVERSE_FORWARD_TEST",
          domain: "weather",
          segment_scope: "weather temperature inverse probe",
          plain_language_reason:
            "Weather inverse buy-NO probe is being tested with tiny paper notional.",
        },
        top_blocked_losing_lane: {
          governor_action: "PAUSE_SEGMENT",
          domain: "weather",
          segment_scope: "weather buy-YES high temperature",
          plain_language_reason:
            "This lane is blocked from accepted paper risk because resolved evidence is losing.",
        },
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
      live_readiness: {
        readiness: "BLOCKED",
        live_trading_enabled: false,
        live_order_allowed: false,
        blockers: ["not enough resolved paper outcomes"],
      },
      no_live_validator: { critical_failures: [] },
      top_action: {
        priority: "critical",
        type: "increase_scoreable_paper_candidates",
        evidence: "0 accepted paper decisions out of 120 total.",
        implementation_hint: "Add independent fair-value lanes.",
      },
      pending_paper_trades: {
        count: 2,
        shown: 2,
        total_unresolved_exposure_usd: 4,
        average_estimated_success_probability: 0.61,
        newest_timestamp_utc: "2026-05-03T00:10:00Z",
        trades: [
          {
            decision_id: "paper-1",
            timestamp_utc: "2026-05-03T20:10:00Z",
            market_ticker: "KXTEST-YES",
            market_title: "Will the test market resolve yes?",
            decision: "PAPER_EXPLORE_BUY_YES",
            side: "YES",
            bet_summary: "Paper buy YES on: Will the test market resolve yes?",
            win_condition:
              "To win, this market must resolve YES: Will the test market resolve yes?",
            evidence_tier: "exploration",
            strategy_bucket: "market_making_simulation",
            estimated_success_probability: 0.62,
            market_probability_at_entry: 0.54,
            fair_probability: 0.62,
            edge_after_costs_pct: 6.3,
            simulated_size_usd: 2,
            paper_fill_price_cents: 54,
            paper_profit_if_win_usd: 1.7,
            paper_loss_if_wrong_usd: -2,
            reason: "bounded paper exploration trade",
            expected_resolution_time_utc: "2026-05-04T21:30:00Z",
            resolution_time_source: "expected_expiration_time",
            resolution_time_source_label: "Kalshi expected expiration",
            resolution_timing_note:
              "Based on Kalshi expected expiration; actual settlement can post after Kalshi resolves the market.",
            settlement_timer_seconds: 300,
            expected_result_known_time_utc: "2026-05-04T21:35:00Z",
            result_known_time_source: "expected_resolution_plus_settlement_timer",
            result_known_time_source_label: "Kalshi timing plus settlement timer",
            result_known_timing_note:
              "Estimated from the best logged Kalshi timing field plus settlement_timer_seconds; actual posting can still be delayed by Kalshi settlement processing.",
          },
        ],
      },
      recent_paper_bets: {
        count: 2,
        shown: 2,
        resolved_in_shown: 1,
        pending_in_shown: 1,
        resolved_count: 1,
        latest_resolved_shown: 1,
        trades: [
          {
            decision_id: "paper-1",
            timestamp_utc: "2026-05-03T20:10:00Z",
            market_ticker: "KXTEST-YES",
            market_title: "Will the test market resolve yes?",
            decision: "PAPER_EXPLORE_BUY_YES",
            side: "YES",
            bet_summary: "Paper buy YES on: Will the test market resolve yes?",
            evidence_tier: "exploration",
            estimated_success_probability: 0.62,
            simulated_size_usd: 2,
            outcome_status: "resolved",
            outcome_yes: 1,
            paper_result: "win",
            paper_pnl_usd: 1.7,
            settlement_checked_at_utc: "2026-05-04T21:40:00Z",
            settlement_source: "kalshi_market_result_read",
            expected_resolution_time_utc: "2026-05-04T21:30:00Z",
            resolution_time_source: "expected_expiration_time",
            resolution_time_source_label: "Kalshi expected expiration",
            resolution_timing_note:
              "Based on Kalshi expected expiration; actual settlement can post after Kalshi resolves the market.",
            settlement_timer_seconds: 300,
            expected_result_known_time_utc: "2026-05-04T21:35:00Z",
            result_known_time_source: "expected_resolution_plus_settlement_timer",
            result_known_time_source_label: "Kalshi timing plus settlement timer",
            result_known_timing_note:
              "Estimated from the best logged Kalshi timing field plus settlement_timer_seconds; actual posting can still be delayed by Kalshi settlement processing.",
          },
        ],
        latest_resolved_trades: [
          {
            decision_id: "paper-1",
            timestamp_utc: "2026-05-03T20:10:00Z",
            market_ticker: "KXTEST-YES",
            market_title: "Will the test market resolve yes?",
            side: "YES",
            bet_summary: "Paper buy YES on: Will the test market resolve yes?",
            win_condition: "To win, this paper trade needs Kalshi to resolve the market YES.",
            outcome_status: "resolved",
            outcome_yes: 1,
            paper_result: "win",
            paper_pnl_usd: 1.7,
            settlement_checked_at_utc: "2026-05-04T21:40:00Z",
            settlement_source: "kalshi_market_result_read",
          },
        ],
      },
      crypto_evidence: {
        ok: true,
        timestamp_utc: "2026-05-03T00:07:00Z",
        active_crypto_markets_seen: 5,
        parseable_crypto_markets: 0,
        crypto_readiness_status: "check_due_now",
        next_crypto_trade_ready_check_time_utc: null,
        seconds_until_next_crypto_trade_ready_check: 0,
        next_crypto_trade_ready_unavailable_reason:
          "latest_crypto_trade_ready_check_time_already_due",
        last_crypto_trade_ready_check_time_utc: "2026-05-03T00:06:00Z",
        crypto_readiness_summary:
          "Latest crypto trade-ready check time (2026-05-03T00:06:00Z) has arrived; rerun crypto evidence now.",
        orderbooks_checked: 0,
        spot_assets_available: ["BTC", "ETH"],
        candidate_count: 0,
        created_count: 0,
        created_by_governor_action: { SHADOW_ONLY: 3 },
        plain_english_summary: "Crypto evidence lane ran without accepted live-trading authority.",
        warnings: [],
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
      markov_microstructure: {
        ok: true,
        status: "research_active",
        generated_at_utc: "2026-05-03T00:07:30Z",
        diagnostic_version: "markov-microstructure-research-v1",
        research_only: true,
        not_trade_signal: true,
        summary: {
          status: "research_active",
          analyzed_market_count: 2,
          universe_count: 2,
          low_data_market_count: 1,
          taker_trap_count: 1,
          tiny_paper_review_only_count: 0,
          observe_only_count: 1,
          pass_count: 1,
          best_confidence_score: 6,
          plain_english:
            "Probability diagnostics is live as a research/risk panel for weather and crypto.",
          next_action:
            "Use this panel to veto weak paper ideas; do not promote it into an execution signal.",
          live_order_allowed: false,
          auto_live_promotion_allowed: false,
        },
        study_reference: {
          title: "The Microstructure of Wealth Transfer in Prediction Markets",
          author: "Jonathan Becker",
          dataset_summary: "72.1M Kalshi trades / $18.26B notional.",
          live_order_allowed: false,
        },
        markets: [
          {
            market_ticker: "KXWEATHER-MARKOV",
            title: "Will the high temperature in Boston be above 70?",
            category: "weather",
            current_yes_price: 0.42,
            current_bucket: 4,
            raw_markov_yes_proxy: 0.55,
            becker_longshot_prior: 0.53,
            calibrated_probability: 0.542,
            market_price: 0.42,
            edge_vs_market_pct: 12.2,
            confidence_score: 6,
            confidence_caps: ["current_bucket_has_fewer_than_30_transitions"],
            routing_label: "OBSERVE_ONLY",
            sample: {
              history_points: 64,
              total_transitions: 63,
              current_row_transitions: 29,
              data_source: "kalshi_candlesticks",
            },
            transition_heatmap: {
              bucket_count: 10,
              current_bucket: 4,
              row_counts: [0, 0, 0, 5, 29, 12, 0, 0, 0, 0],
              matrix: Array.from({ length: 10 }, (_rowValue, row) =>
                Array.from({ length: 10 }, (_columnValue, column) =>
                  row === column ? 0.7 : column === row + 1 ? 0.3 : 0,
                ),
              ),
            },
            terminal_distribution: [0, 0, 0.05, 0.1, 0.3, 0.25, 0.2, 0.1, 0, 0],
            execution: {
              yes_maker_edge_pct: 8.2,
              yes_taker_edge_pct: -1.4,
              no_maker_edge_pct: -4.2,
              no_taker_edge_pct: -9.1,
              best_yes_ask_probability: 0.43,
              best_no_ask_probability: 0.59,
              estimated_yes_spread_cents: 2,
              depth_contracts: 240,
              fill_quality: "high",
              maker_taker_category_gap_pct: 2.57,
              maker_taker_warning:
                "Maker-first only; taker edge is penalized for Kalshi microstructure and spread/fee drag.",
            },
            warnings: ["low_transition_sample_current_bucket", "maker_preferred_over_taker"],
            research_only: true,
            not_trade_signal: true,
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
        ],
        calibration_tracking: {
          bucket_count: 1,
          plain_english:
            "Calibration tracking uses resolved paper outcomes by price bucket; low samples are warnings, not proof.",
          rows: [
            {
              category: "weather",
              bucket_label: "40-50¢",
              count: 8,
              wins: 4,
              actual_win_rate: 0.5,
              average_implied_probability: 0.45,
              actual_minus_implied_pct: 5,
              sample_quality: "low_sample",
              live_order_allowed: false,
            },
          ],
          live_order_allowed: false,
          auto_live_promotion_allowed: false,
        },
        warnings: [],
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
      log_counts: { market_observations: 25 },
    },
    ...overrides,
  };
}

describe("Kalshi dashboard view", () => {
  it("renders the STS command center above legacy strategy details", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("Supreme Trading Strategy");
    expect(text).toContain("STS is learning, but a data or proof gap is holding it back.");
    expect(text).toContain("Repair outcome fetch coverage so STS can learn faster");
    expect(text).toContain("Live trading is off");
    expect(text).toContain("market baseline");
    expect(text).toContain("W/C ML Weight");
    expect(text).toContain(
      "Weather/Crypto challenger is currently blocked by proof/quality checks.",
    );
    expect(text).toContain("Overall route mix");
    expect(text).toContain("Weather / Crypto route mix");
    expect(text).toContain("accept exploration");
    expect(text).toContain("Sports Routing");
    expect(text).toContain("Calibration");
    expect(text).toContain("Sports routing is intentionally held at zero in paper mode.");
    expect(text).toContain("ML Route Boost");
    expect(text).toContain("Route Multiplier (x)");
    expect(text).toContain("Learning Reallocation");
    expect(text).toContain("Stochastic Process Lift");
    expect(text).toContain("Sports Execution Reliability");
    expect(text).toContain("Sports Row Multiplier");
    expect(text).toContain("Walk-Forward Stability Lift");
    expect(text).toContain("Learning Velocity Boost");
    expect(text).toContain("Weather Decay");
    expect(text).toContain("Crypto Decay");
    expect(text).toContain("Stochastic Decay Guard");
    expect(text).toContain("Recent W/C Edge");
    expect(text).toContain("Weather Recent W/C Edge");
    expect(text).toContain("Crypto Recent W/C Edge");
    expect(text).toContain("Regime Decay Coverage");
    expect(text).toContain("Regime Lift Check");
    expect(text.indexOf("Supreme Trading Strategy")).toBeLessThan(text.indexOf("Strategy Cockpit"));
  });

  it("renders Today-first dashboard metrics with Advanced Audit available", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("Kalshi Paper Trading");
    expect(text).toContain("Live trading is off");
    expect(text).toContain("Here’s what matters.");
    expect(text).toContain("Safety");
    expect(text).toContain("Learning");
    expect(text).toContain("Profit proof");
    expect(text).toContain("Next");
    expect(text).toContain("What changed?");
    expect(text).toContain("Snapshot current");
    expect(text).toContain("12s old");
    expect(text).toContain("Learning lanes");
    expect(text).toContain("Routing gate you can test now");
    expect(text).toContain("Weather/Crypto ML Boost");
    expect(text).toContain("Calibration Gate");
    expect(text).toContain("Learning Reallocation");
    expect(text).toContain("Stochastic Process Lift");
    expect(text).toContain("Stochastic Guard");
    expect(text).toContain("Domain Route Boost");
    expect(text).toContain("Route Multiplier (x)");
    expect(text).toContain("Learning Velocity Boost");
    expect(text).toContain("Weather/Crypto is accelerator-guided.");
    expect(text).toContain("Weather Decay");
    expect(text).toContain("Crypto Decay");
    expect(text).toContain("Stochastic Decay Guard");
    expect(text).toContain("Weather");
    expect(text).toContain("Crypto");
    expect(text).toContain("Sports");
    expect(text).toContain("Sports remains practice-only until fresh proof beats the baselines.");
    expect(text).toContain("Sports Safety Hold");
    expect(text).toContain("Halted");
    expect(text).toContain("Weather/Crypto Boost");
    expect(text).toContain("Probability Diagnostics");
    expect(text).toContain("Markov and microstructure risk, not a trade signal.");
    expect(text).toContain("This module can veto weak ideas or mark them observe-only.");
    expect(text).toContain("KXWEATHER-MARKOV");
    expect(text).toContain("State-transition heatmap");
    expect(text).toContain("Research only");
    expect(text).toContain("Advanced Audit");
    expect(text).toContain("Hide Advanced Audit");
    expect(container.querySelector(".kalshi-hero--blocked")).not.toBeNull();
    expect(container.querySelector(".kalshi-live-pill--safe")).not.toBeNull();
    expect(container.querySelector(".kalshi-markov-heatmap__cell--current")).not.toBeNull();
    expect(container.querySelector('button[aria-label="Refresh Kalshi dashboard"]')).not.toBeNull();

    expect(text).toContain("Strategy Cockpit");
    expect(text).toContain("Every named strategy lane, one comparable table.");
    expect(text).toContain("Sort strategies");
    expect(text).toContain("6 named strategy lanes");
    expect(text).toContain("accepted paper");
    expect(text).toContain("shadow/control");
    expect(text).toContain("Accepted / Shadow");
    expect(text).toContain("Avg/trade");
    expect(text).toContain("Source Lag Surface");
    expect(text).toContain("Named weather/crypto source-lag strategy lane.");
    expect(text).toContain("Strategy Comparison Details");
    expect(text).toContain("Paper Learning Snapshot");
    expect(text).toContain("Paper profit/loss");
    expect(text).toContain("Category Accuracy");
    expect(text).toContain("Accuracy and paper profit/loss trend");
    expect(text).toContain("Paper Volume Accelerator");
    expect(text).toContain("Weather Model Audit");
    expect(text).toContain("Strategy Discovery");
    expect(text).toContain("Inverse Standard Strategy Audit");
    expect(text).toContain("Hidden Opportunities");
    expect(text).toContain("Strategy Governor");
    expect(text).toContain("Strategy Health");
    expect(text).toContain("Decision Quality");
    expect(text).toContain("Live-Readiness Funnel");
    expect(text).toContain("Crypto Readiness");
    expect(text).toContain("Check due now");
    expect(text).toContain("rerun crypto evidence now");
    expect(text).toContain("Weather Expansion");
    expect(text).toContain("Next 50 Upcoming Paper Trades To Resolve");
    expect(text).toContain("Recent Paper Bets");
    expect(text).toContain("Latest Resolved Paper Results");
    expect(text).toContain("KXTEST-YES");
    expect(text).toContain("kalshi_market_result_read");

    expect(text).toContain("Δ vs Standard");
    expect(text).toContain("+$22.50");
    expect(text).toContain("actual vs Standard");
    expect(text).toContain("baseline");
    expect(text).toContain("waiting for scored proof");
    expect(text).toContain("Weather Arbitrage Strategy");
    expect(text).toContain("PolyClaw");
    expect(text).toContain("polymarket-kalshi-divergence");
    expect(text).toContain("Build bucket-level weather arbitrage scanner");
    expect(text).toContain("The Strategy Cockpit above is now the primary comparison surface.");
    expect(text).toContain("No live orders can be enabled");
    expect(text).toContain("Weather temperature using weather model");
    expect(text).toContain("weather-to-sports transfer is forbidden");
    expect(text).toContain("SAN FRANCISCO");
    expect(text).toContain("Kalshi Climate and Weather series-first discovery");
    expect(text).toContain(
      "Expected Result Known uses logged Kalshi timing plus settlement timer data",
    );
    expect(text).toContain("Trade 8");
    expect(text).toContain("Paper profit/loss +$2.25");
    expect(text).toContain("Timeframe: 24 hours");

    expect(container.querySelector(".kalshi-trend-chart svg")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-now")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-projection-zone")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-line--projection")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-volume-bar")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-hover-column")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-tooltip")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-tooltip-text")).not.toBeNull();
    expect(container.querySelector(".kalshi-chart-hover-dot--accuracy")).toBeNull();
    expect(container.querySelector(".kalshi-chart-hover-zone")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(container.querySelectorAll(".kalshi-table-scroll").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[title*="Paper trade decisions"]')).not.toBeNull();
    expect(container.querySelector('[title*="markets have settled"]')).not.toBeNull();
    expect(container.querySelector('[title*="calibration score"]')).not.toBeNull();
    expect(
      container.querySelector('.kalshi-card__title[title*="Realized simulated profit"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.kalshi-card__title[title*="percentage of resolved"]'),
    ).not.toBeNull();
    expect(text).not.toMatch(/\bcurrent strategy\b/i);
    expect(text).not.toMatch(/\bcurrent-strategy\b/i);
    expect(text).not.toMatch(/\binverse strategy\b/i);
    expect(text).not.toMatch(/\binverse-first\b/i);
    expect(text).not.toMatch(/\bold strategy\b/i);
    expect(text).not.toMatch(/\bold baseline\b/i);
  });

  it("renders the live-readiness gate with blocker evidence and approval scope", () => {
    const container = document.createElement("div");
    const base = createProps();
    if (!base.snapshot) {
      throw new Error("fixture snapshot is required");
    }

    render(
      renderKalshiDashboard({
        ...base,
        snapshot: {
          ...base.snapshot,
          live_readiness_gate: {
            overall_state: "LIVE_BLOCKED",
            state_tokens: [
              "LIVE_BLOCKED",
              "SNAPSHOT_BLOCKED_NEEDS_APPROVAL",
              "SOURCE_GATE_BLOCKED",
              "RESEARCH_ONLY",
              "READY_FOR_NEXT_APPROVAL",
            ],
            active_branch: "operations/safety",
            current_operational_gate_decision: "snapshot_blocked_needs_approval",
            live_trading_state: "LIVE_BLOCKED",
            snapshot_state: "SNAPSHOT_BLOCKED_NEEDS_APPROVAL",
            source_gate_state: "SOURCE_GATE_BLOCKED",
            research_state: "RESEARCH_ONLY",
            next_approval_state: "READY_FOR_NEXT_APPROVAL",
            safety: {
              no_live_validator_ok: true,
              mode: "READ_ONLY",
              live_order_allowed: false,
              live_trading_enabled: false,
              sts_logic_changed: false,
              sts_weights_changed: false,
              sts_recommendation_made_generated_or_applied: false,
            },
            fresh_snapshot_readiness: {
              decision: "snapshot_blocked_needs_approval",
              state: "SNAPSHOT_BLOCKED_NEEDS_APPROVAL",
              recommended_by_freshness_audit: true,
              snapshot_created: false,
              evidence_artifact_path: "work/scripts/kalshi/dataset_freshness_drift_audit_v1.json",
            },
            blockers: [
              {
                blocker: "Gateway cron control",
                state: "SNAPSHOT_BLOCKED_NEEDS_APPROVAL",
                artifact_path: "work/scripts/kalshi/gateway_cron_control_failure_audit_v1.json",
                last_known_raw_output: "gateway_cron_control_not_proven",
                pass_requirement: "Prove helper-based Gateway cron status/control.",
                human_approval_required: true,
              },
              {
                blocker: "sports source gate",
                state: "SOURCE_GATE_BLOCKED",
                artifact_path: "work/scripts/kalshi/state_handoff_after_167_v1.json",
                last_known_raw_output: "exact sports JSONL source path missing",
                pass_requirement:
                  "Approve exactly one local sports source JSONL path before sports advancement.",
                human_approval_required: true,
              },
            ],
            market_family_readiness: [
              {
                family: "sports",
                state: "SOURCE_GATE_BLOCKED",
                blocker:
                  "Exact approved repo-root sports JSONL source path is still required before source-backed sports advancement.",
                artifact_path: "work/scripts/kalshi/state_handoff_after_167_v1.json",
                frozen_direct_rows: 5642,
                post_boundary_rows: 4278,
              },
              {
                family: "crypto",
                state: "RESEARCH_ONLY",
                blocker:
                  "Strict V2 label source and diagnostic replay remain approval-gated; no STS or replay work is active.",
                artifact_path: "work/scripts/kalshi/state_handoff_after_167_v1.json",
                frozen_direct_rows: 2432,
                post_boundary_rows: 1721,
              },
              {
                family: "weather",
                state: "RESEARCH_ONLY",
                blocker:
                  "Weather branch is preserved with a design-only repair plan; operations/safety gates supersede immediate collection.",
                artifact_path: "work/scripts/kalshi/state_handoff_after_167_v1.json",
                frozen_direct_rows: 10,
                post_boundary_rows: 60,
              },
            ],
            exact_next_human_approval_needed: {
              summary: "One bounded Kalshi operational reliability probe.",
              max_scope: "One bounded operational reliability probe using helper scripts.",
              what_is_approved: ["Read-only status checks"],
              what_is_not_approved: ["Live trading", "Snapshot creation"],
              allowed_command_classes: ["no-live validator"],
              stop_conditions: ["no-live validator fails"],
              recovery_proof_required: ["Re-run no-live validator"],
              human_approval_required: true,
              artifact_path: "work/scripts/kalshi/NEXT_APPROVAL_SCOPE_RECOMMENDATION.md",
            },
            forbidden_actions: [
              "live trading",
              "write-capable Kalshi endpoints",
              "STS logic or weight changes",
            ],
            artifact_paths: [
              "work/scripts/kalshi/OPERATIONAL_GATE_TRUTH_TABLE.md",
              "work/scripts/kalshi/STATE_HANDOFF_AFTER_167.md",
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
        },
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Live-Readiness Gate");
    expect(text).toContain("operations/safety");
    expect(text).toContain("snapshot blocked needs approval");
    expect(text).toContain("LIVE BLOCKED");
    expect(text).toContain("SNAPSHOT BLOCKED NEEDS APPROVAL");
    expect(text).toContain("SOURCE GATE BLOCKED");
    expect(text).toContain("RESEARCH ONLY");
    expect(text).toContain("READY FOR NEXT APPROVAL");
    expect(text).toContain("Gateway cron control");
    expect(text).toContain("work/scripts/kalshi/gateway_cron_control_failure_audit_v1.json");
    expect(text).toContain("sports source gate");
    expect(text).toContain("crypto");
    expect(text).toContain("weather");
    expect(text).toContain("One bounded Kalshi operational reliability probe.");
    expect(text).toContain("work/scripts/kalshi/NEXT_APPROVAL_SCOPE_RECOMMENDATION.md");
    expect(text).toContain("write-capable Kalshi endpoints");
    expect(container.querySelector(".kalshi-panel--live-gate")).not.toBeNull();
  });

  it("renders crypto regime coverage and inverse repair shadow diagnostics", () => {
    const base = createProps();
    const container = document.createElement("div");

    render(
      renderKalshiDashboard({
        ...base,
        snapshot: {
          ...base.snapshot,
          sts_crypto_regime_selector: {
            candidate_experiment_count: 2,
            paused_forward_regime_count: 1,
            regime_count: 8,
            live_order_allowed: false,
          },
          sts_crypto_regime_selector_outcomes: {
            forward_recorded_resolved_count: 23,
            forward_recorded_pending_count: 8,
            forward_recorded_due_pending_count: 1,
            forward_recorded_coverage_probe_resolved_count: 15,
            forward_recorded_coverage_probe_pending_count: 8,
            forward_recorded_coverage_probe_due_count: 1,
            forward_recorded_inverse_repair_shadow_resolved_count: 3,
            forward_recorded_inverse_repair_shadow_pending_count: 2,
            forward_recorded_inverse_repair_shadow_due_count: 1,
            inverse_repair_shadow_proof_gate: {
              status: "waiting_for_inverse_repair_shadow_outcomes",
              resolved_count: 3,
              pending_count: 2,
              target_resolved_shadow_outcomes: 10,
              paper_pnl_usd: -1.25,
              accuracy: 0.667,
              blockers: ["inverse_repair_shadow_sample_too_small"],
              next_action:
                "Wait for inverse-repair shadow outcomes until at least 10 source-backed rows are resolved.",
              counts_for_live_readiness: false,
              can_authorize_trade: false,
              live_order_allowed: false,
            },
            coverage_probe_failure_cohort_blocks: [
              {
                coverage_cohort_key: "coverage_cohort:side=no|hour=18",
                resolved_count: 5,
                loss_count: 4,
                paper_pnl_usd: -2.5,
                action: "STS_COVERAGE_PROBE_COHORT_BLOCK",
                counts_for_live_readiness: false,
              },
            ],
            live_order_allowed: false,
          },
          sts_crypto_regime_inverse_repair: {
            repair_count: 1,
            scanned_forward_regime_outcome_count: 31,
            repairs: [
              {
                regime_id: "regime:asset=SOL|side=no|prob=mid_prob|market=balanced",
                recommended_action: "test_inverse_forward_shadow",
                selected_paper_pnl_usd: -5.19,
                inverse_paper_pnl_usd: 4.99,
                abstain_pnl_uplift_usd: 5.19,
                blockers: ["shadow_only_until_forward_inverse_repair_resolves"],
              },
            ],
            live_order_allowed: false,
          },
        },
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Coverage probe cohort blocks");
    expect(text).toMatch(/15\s+resolved ·\s+8\s+pending ·\s+1\s+due · 1 blocked cohorts/);
    expect(text).toContain("coverage cohort:side=no|hour=18");
    expect(text).toContain("STS COVERAGE PROBE COHORT BLOCK");
    expect(text).toContain("Inverse repair shadow proof");
    expect(text).toMatch(/3\s+resolved ·\s+2\s+pending ·\s+1\s+due · zero-exposure/);
    expect(text).toContain("waiting for inverse repair shadow outcomes");
    expect(text).toMatch(/3\/10\s+resolved/);
    expect(text).toContain("inverse repair shadow sample too small");
    expect(text).toContain("regime:asset=SOL|side=no|prob=mid prob|market=balanced");
    expect(text).toContain("test inverse forward shadow");
    expect(text).toContain("no live-readiness credit");
  });

  it("shows a delta cell for every Strategy Cockpit row", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps()), container);

    const strategyTable = container.querySelector(
      'table[aria-label="Strategy comparison cockpit"]',
    );
    const rows = [...(strategyTable?.querySelectorAll("tbody tr") ?? [])];
    const rowText = rows.map((row) => row.textContent ?? "");

    expect(rows).toHaveLength(6);
    expect(rowText.find((text) => text.includes("Standard Strategy"))).toContain("+$0.00");
    expect(rowText.find((text) => text.includes("Standard Strategy"))).toContain("baseline");
    expect(rowText.find((text) => text.includes("Inverse Standard Strategy"))).toContain("+$22.50");
    expect(rowText.find((text) => text.includes("Inverse Standard Strategy"))).toContain(
      "actual vs Standard",
    );
    expect(rowText.find((text) => text.includes("Source Lag Surface"))).toContain("+$5.50");
    expect(rowText.find((text) => text.includes("Weather Arbitrage Strategy"))).toContain("n/a");
    expect(rowText.find((text) => text.includes("Weather Arbitrage Strategy"))).toContain(
      "waiting for scored proof",
    );
  });

  it("sorts Strategy Cockpit rows and reports strategy-specific metrics", () => {
    const container = document.createElement("div");
    const props = createProps();
    const snapshot = structuredClone(props.snapshot);
    const rows = snapshot?.strategy_comparison?.rows ?? [];
    const polyClawRow = rows[3] ?? {};
    rows[3] = {
      ...polyClawRow,
      accepted: 4,
      shadow_decisions: 2,
      scored: 3,
      accuracy: 0.3333,
      paper_pnl_usd: -14,
      average_pnl_per_scored_trade_usd: -4.6667,
      unresolved: 1,
      domains: { weather: 4, crypto: 2 },
      tracking_status: "tracking",
      next_step: "Compare PolyClaw after more outcomes resolve.",
    };
    props.snapshot = snapshot;
    props.strategySort = "pnl";

    render(renderKalshiDashboard(props), container);

    const text = container.textContent ?? "";
    const strategyRows = [
      ...container.querySelectorAll('table[aria-label="Strategy comparison cockpit"] tbody tr'),
    ];
    expect(strategyRows[0]?.textContent).toContain("PolyClaw");
    expect(strategyRows[0]?.textContent).toContain("-$14.00");
    expect(strategyRows[0]?.textContent).toContain("-$4.00");
    expect(strategyRows[0]?.textContent).toContain("-$4.67");
    expect(strategyRows[0]?.textContent).toContain("weather 4, crypto 2");
    expect(strategyRows[0]?.textContent).toContain("4");
    expect(strategyRows[0]?.textContent).toContain("2 shadow");
    expect(text).not.toContain("PolyClaw P&L Delta");
  });

  it("notifies when the Strategy Cockpit sort changes", () => {
    const container = document.createElement("div");
    const onStrategySortChange = vi.fn();

    render(renderKalshiDashboard(createProps({ onStrategySortChange })), container);

    const select = [...container.querySelectorAll("select")].find(
      (candidate) => candidate.closest(".kalshi-strategy-cockpit") != null,
    );
    expect(select).not.toBeUndefined();
    if (!select) {
      return;
    }
    select.value = "accuracy";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onStrategySortChange).toHaveBeenCalledWith("accuracy");
  });

  it("renders the top milestone countdown with concise scored criteria", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps({ showDeepAudit: false })), container);

    const ticker = container.querySelector(".kalshi-countdown-ticker");
    expect(ticker).not.toBeNull();
    const text = ticker?.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("Proof Milestones");
    expect(text).toContain("Proof");
    expect(text).toContain("2d 3h 4m");
    expect(text).toContain("Count 3/10");
    expect(text).toContain("Crypto");
    expect(text).toContain("Waiting");

    const pageText = container.textContent ?? "";
    expect(pageText.indexOf("Proof Milestones")).toBeGreaterThan(
      pageText.indexOf("STS Domain Learning Command Center"),
    );

    const chips = [...container.querySelectorAll(".kalshi-countdown-chip")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      const chipText = (chip.textContent ?? "").replace(/\s+/g, " ").trim();
      const match = chipText.match(/^(.+?) ([0-9]+(?:\.[0-9])?)\/10$/);
      expect(match, chipText).not.toBeNull();
      if (!match) {
        continue;
      }
      expect(match[1].split(/\s+/).length).toBeLessThanOrEqual(2);
      const score = Number(match[2]);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
    }
  });

  it("renders Weather/Crypto promotion-gap diagnostics without enabling live trading", () => {
    const container = document.createElement("div");
    const props = createProps({ showDeepAudit: false });
    const baseSnapshot = props.snapshot ?? {};
    props.snapshot = {
      ...baseSnapshot,
      weather_crypto_ml: {
        ok: true,
        status: "shadow_learning_only",
        plain_english: "Weather/crypto ML is enforcing shadow-first learning.",
        accepted_paper_allowed_segment_count: 0,
        domains: {
          weather: { shadow_scored: 12, accepted_scored: 0 },
          crypto: { shadow_scored: 80, accepted_scored: 0 },
        },
        reality_contract: {
          training_eligible: 92,
          quarantined_training: 7,
        },
        promotion_gap: {
          status: "blocked",
          next_action: "Collect targeted shadow labels for the listed near-miss segments.",
          top_blocker: "count",
          allowed_segment_count: 0,
          near_miss_segment_count: 1,
          trainable_rows: 92,
          quarantined_rows: 7,
          blocker_counts: { count: 1, brier: 1 },
          calibration_repair: {
            status: "repair_required",
            top_blocker: "brier",
            next_action: "Repair Brier/calibration first.",
            repair_segment_count: 1,
            candidate_behavior: {
              status: "active",
              crypto_reprice_active: true,
              active_shrink_segment_count: 1,
              probability_rule: "market + (raw - market) * cap",
              weather_label_rule: "Brier wins only",
              accepted_paper_allowed: false,
              live_order_allowed: false,
            },
            segments: [
              {
                segment_key: "crypto|ETH|crypto_price_threshold|no",
                action: "shrink_to_market",
                reason: "Model Brier is worse than the market baseline.",
                shadow_brier_score: 0.2,
                shadow_market_brier_score: 0.15,
                candidate_weight_cap: 0.64,
                accepted_paper_allowed: false,
                live_order_allowed: false,
              },
            ],
            live_order_allowed: false,
            auto_live_promotion_allowed: false,
          },
          segments: [
            {
              segment_key: "weather|HOUSTON|low_temperature|below|yes",
              domain: "weather",
              completion_score: 7.1,
              primary_blocker: "count",
              next_action:
                "Collect segment-specific shadow labels before opening tiny accepted paper.",
              criteria: [
                { label: "Count", score: 0.4, detail: "1/25 shadow labels." },
                { label: "Markets", score: 2, detail: "1/5 unique markets." },
                { label: "Accuracy", score: 10, detail: "1.0 vs 0.8 required." },
              ],
              live_order_allowed: false,
            },
          ],
          live_order_allowed: false,
          auto_live_promotion_allowed: false,
        },
        live_order_allowed: false,
        auto_live_promotion_allowed: false,
      },
    };

    render(renderKalshiDashboard(props), container);

    const text = container.textContent ?? "";
    expect(text).toContain("Weather/Crypto ML");
    expect(text).toContain("0 allowed");
    expect(text).toContain("1 near");
    expect(text).toContain("Collect targeted shadow labels");
    expect(text).toContain("Calibration Repair");
    expect(text).toContain("Repair Brier/calibration first.");
    expect(text).toContain("crypto|ETH|crypto_price_threshold|no");
    expect(text).toContain("shrink to market");
    expect(text).toContain("repriced");
    expect(text).toContain("Brier wins only");
    expect(text).toContain("weather|HOUSTON|low_temperature|below|yes");
    expect(text).toMatch(/Count\s+0\.4\/10/);
    expect(text).not.toContain("Live trading enabled");
  });

  it("keeps Advanced Audit hidden until the user asks for it", () => {
    const container = document.createElement("div");
    const onToggleDeepAudit = vi.fn();

    render(
      renderKalshiDashboard(createProps({ showDeepAudit: false, onToggleDeepAudit })),
      container,
    );

    const text = container.textContent ?? "";
    const topText = text.slice(0, text.indexOf("Advanced Audit"));
    expect(text).toContain("Kalshi Paper Trading");
    expect(text).toContain("Live trading is off");
    expect(text).toContain("What changed?");
    expect(text).toContain("Strategy Cockpit");
    expect(text).toContain("Source Lag Surface");
    expect(text).toContain("Learning lanes");
    expect(text).toContain("Advanced Audit hidden");
    expect(text).toContain("Show Advanced Audit");
    expect(topText).toContain("Overall Route Mix");
    expect(topText).toContain("Weather / Crypto Route Mix");
    expect(topText).toContain("shadow only: 70.0%");
    expect(text).not.toContain("Strategy Comparison Details");
    expect(text).not.toContain("Accuracy and paper profit/loss trend");
    expect(text).not.toContain("Paper Volume Accelerator");
    expect(text).not.toContain("Recent Paper Bets");
    expect(topText).not.toContain("SHADOW_ONLY");
    expect(topText).not.toContain("GAP-01");
    expect(topText).not.toContain("Accepted Proof Age");
    expect(topText).not.toContain("HIGH SPEED");
    expect(topText).not.toContain("Live readiness: BLOCKED");

    const toggle = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Show Advanced Audit"),
    );
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onToggleDeepAudit).toHaveBeenCalledTimes(1);
  });

  it("shows high-speed practice learning in Today", () => {
    const container = document.createElement("div");
    const baseProps = createProps();
    const snapshot = baseProps.snapshot!;

    render(
      renderKalshiDashboard(
        createProps({
          showDeepAudit: false,
          snapshot: {
            ...snapshot,
            self_improvement: {
              ...snapshot.self_improvement,
              metrics: {
                ...snapshot.self_improvement?.metrics,
                scored_decisions_last_1h: 0,
                scored_decisions_last_6h: 0,
                scored_decisions_last_24h: 0,
              },
            },
            learning_velocity: {
              status: "HIGH_SPEED_LEARNING",
              plain_english:
                "Learning is active at high speed through fresh weather/crypto shadow outcomes while accepted-paper proof remains safely gated.",
              latest_learning_age_minutes: 2.25,
              latest_accepted_proof_age_minutes: 3187.3,
              resolved_last_1h: 34,
              shadow_resolved_last_1h: 34,
              proof_metrics_exclude_shadow: true,
              live_order_allowed: false,
            },
          },
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Learning fast");
    expect(text).toContain("34 practice-only results landed in the last hour.");
    expect(text).toContain("34 new learning results");
    expect(text).toContain("Profit proof is stale");
    expect(text).toContain("No new profit proof yet");
    expect(text).toContain("Learning Velocity");
    expect(text).toContain("x1.09");
    expect(text).toContain("accepted +incl. 34 shadow outcomes");
    expect(text).toContain("What changed?");
    expect(text).not.toContain("HIGH SPEED");
    expect(text).not.toContain("Accepted Proof Age");
    expect(text).not.toContain("SHADOW_ONLY");
    expect(text).not.toContain("GAP-01");
  });

  it("translates internal bottleneck terms into plain language with definitions", () => {
    const container = document.createElement("div");
    const baseProps = createProps();
    const snapshot = baseProps.snapshot!;
    const paperVolume = snapshot.paper_volume_accelerator!;
    const rapidLearning = paperVolume.rapid_learning_plan!;
    const losingEvidence =
      "Clean resolved paper trades are profitable only 14.4% of the time with clean net P&L $-562.53.";

    render(
      renderKalshiDashboard(
        createProps({
          snapshot: {
            ...snapshot,
            paper_volume_accelerator: {
              ...paperVolume,
              metrics: {
                ...paperVolume.metrics,
                current_learning_bottleneck: "negative_current_epoch_pnl",
                what_must_happen_next_to_learn_faster: losingEvidence,
              },
              rapid_learning_plan: {
                ...rapidLearning,
                primary_bottleneck: "negative_current_epoch_pnl",
                bottlenecks: [
                  {
                    type: "negative_current_epoch_pnl",
                    severity: "critical",
                    evidence: losingEvidence,
                    fix: "Route accepted paper toward baseline-beating current-epoch segments.",
                  },
                ],
              },
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Paper trades are losing money in this test period");
    expect(container.textContent).toContain(
      "paper trades with reliable final results are profitable only 14.4% of the time with simulated net profit/loss $-562.53.",
    );
    expect(container.textContent).toContain(
      "Route accepted paper toward segments that beat the comparison baselines in this test period.",
    );
    expect(container.textContent).not.toContain("negative current epoch pnl");
    expect(container.textContent).not.toContain("negative_current_epoch_pnl");
    expect(container.textContent).not.toContain("current epoch");
    expect(container.textContent).not.toContain("clean net P&L");
  });

  it("keeps heavy audit log tables bounded when snapshots contain many rows", () => {
    const container = document.createElement("div");
    const baseProps = createProps();
    const snapshot = baseProps.snapshot!;
    const pendingTrade = snapshot.pending_paper_trades!.trades![0];
    const recentTrade = snapshot.recent_paper_bets!.trades![0];
    const resolvedTrade = snapshot.recent_paper_bets!.latest_resolved_trades![0];

    render(
      renderKalshiDashboard(
        createProps({
          snapshot: {
            ...snapshot,
            pending_paper_trades: {
              ...snapshot.pending_paper_trades,
              count: 65,
              shown: 65,
              trades: Array.from({ length: 65 }, (_, index) => ({
                ...pendingTrade,
                decision_id: `pending-${index}`,
                market_ticker: `KXPENDING-${index}`,
              })),
            },
            recent_paper_bets: {
              ...snapshot.recent_paper_bets,
              count: 65,
              shown: 65,
              trades: Array.from({ length: 65 }, (_, index) => ({
                ...recentTrade,
                decision_id: `recent-${index}`,
                market_ticker: `KXRECENT-${index}`,
              })),
              latest_resolved_trades: Array.from({ length: 65 }, (_, index) => ({
                ...resolvedTrade,
                decision_id: `resolved-${index}`,
                market_ticker: `KXRESOLVED-${index}`,
              })),
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(
      "15 additional upcoming rows are held out of the DOM for dashboard speed.",
    );
    expect(container.textContent).toContain(
      "15 additional recent rows are held out of the DOM for dashboard speed.",
    );
    expect(container.textContent).toContain(
      "15 additional resolved rows are held out of the DOM for dashboard speed.",
    );
    expect(container.textContent).toContain("KXPENDING-49");
    expect(container.textContent).not.toContain("KXPENDING-50");
    expect(container.textContent).toContain("KXRECENT-49");
    expect(container.textContent).not.toContain("KXRECENT-50");
  });

  it("supports audit table paging, search callbacks, and visible CSV export", () => {
    const container = document.createElement("div");
    const onAuditTablePageChange = vi.fn();
    const onAuditTableQueryChange = vi.fn();
    const baseProps = createProps();
    const snapshot = baseProps.snapshot!;
    const pendingTrade = snapshot.pending_paper_trades!.trades![0];

    render(
      renderKalshiDashboard(
        createProps({
          auditTablePages: { pending: 2 },
          auditTableQueries: { pending: "KXPENDING" },
          onAuditTablePageChange,
          onAuditTableQueryChange,
          snapshot: {
            ...snapshot,
            pending_paper_trades: {
              ...snapshot.pending_paper_trades,
              count: 65,
              shown: 65,
              trades: Array.from({ length: 65 }, (_, index) => ({
                ...pendingTrade,
                decision_id: `pending-${index}`,
                market_ticker: `KXPENDING-${index}`,
              })),
            },
          },
        }),
      ),
      container,
    );

    const pendingControls = container.querySelector(".kalshi-audit-controls");
    const pendingSearch = pendingControls?.querySelector("input");
    const previousButton = [...(pendingControls?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Previous"),
    );
    const csvLink = pendingControls?.querySelector('a[download="kalshi-pending-visible-rows.csv"]');

    expect(container.textContent).toContain("Page 2 / 2");
    expect(container.textContent).toContain("KXPENDING-50");
    expect(container.textContent).not.toContain("KXPENDING-49");
    expect(csvLink?.getAttribute("href")).toContain("data:text/csv");

    pendingSearch!.value = "KXPENDING-64";
    pendingSearch?.dispatchEvent(new Event("input", { bubbles: true }));
    previousButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onAuditTableQueryChange).toHaveBeenCalledWith("pending", "KXPENDING-64");
    expect(onAuditTablePageChange).toHaveBeenCalledWith("pending", 1);
  });

  it("uses server-side audit table page metadata when present", () => {
    const container = document.createElement("div");
    const baseProps = createProps();
    const snapshot = baseProps.snapshot!;
    const pendingTrade = snapshot.pending_paper_trades!.trades![0];

    render(
      renderKalshiDashboard(
        createProps({
          auditTablePages: { pending: 2 },
          auditTableQueries: { pending: "KXPENDING" },
          snapshot: {
            ...snapshot,
            audit_pages: {
              pending: {
                filtered_rows: 65,
                page: 2,
                page_count: 2,
                page_size: 50,
                query: "KXPENDING",
                server_sliced: true,
                shown_rows: 15,
                total_rows: 65,
              },
            },
            pending_paper_trades: {
              ...snapshot.pending_paper_trades,
              count: 65,
              shown: 15,
              trades: Array.from({ length: 15 }, (_, index) => ({
                ...pendingTrade,
                decision_id: `pending-${index + 50}`,
                market_ticker: `KXPENDING-${index + 50}`,
              })),
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Showing 51-65 of 65 matching rows");
    expect(container.textContent).toContain("Server-paged for speed.");
    expect(container.textContent).toContain("Page 2 / 2");
    expect(container.textContent).toContain("KXPENDING-50");
    expect(container.textContent).toContain("KXPENDING-64");
  });

  it("opens metric definitions when question marks are clicked", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps()), container);

    const accuracyTitle = container.querySelector(
      '.kalshi-card__title[title*="percentage of resolved"]',
    );
    const accuracyHelp = accuracyTitle?.querySelector("details");
    const accuracyToggle = accuracyHelp?.querySelector("summary");

    expect(accuracyHelp?.hasAttribute("open")).toBe(false);

    accuracyToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(accuracyHelp?.hasAttribute("open")).toBe(true);
    expect(accuracyHelp?.textContent).toContain("percentage of resolved directional paper trades");
  });

  it("keeps selected timeframe paper profit/loss consistent with selected timeframe scored trades", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps({ pnlTimeframe: "1h" })), container);

    const pnlCards = [...container.querySelectorAll(".kalshi-card")].filter((card) =>
      card.textContent?.includes("Paper profit/loss"),
    );
    const selectedPnlCard = pnlCards.find((card) =>
      card.textContent?.includes("Open or unresolved paper trades are not counted"),
    );

    const selectedPnlText = selectedPnlCard?.textContent?.replace(/\s+/g, " ");
    expect(selectedPnlText).toContain("$0.00");
    expect(selectedPnlText).toContain("1 hour. 0 scored trades in selected window");
    expect(selectedPnlText).not.toContain("-$");
    expect(container.textContent).toContain("No resolved paper trades in this timeframe yet.");
  });

  it("filters the accuracy trend graph when the timeframe changes", () => {
    const container = document.createElement("div");
    const base = createProps();
    const snapshot = {
      ...base.snapshot!,
      generated_at_utc: "2026-05-03T02:08:00Z",
    };

    render(renderKalshiDashboard(createProps({ snapshot, timeframe: "24h" })), container);

    expect(container.textContent).toContain("Timeframe: 24 hours");
    expect(container.textContent).toContain("Learning volume: 8 scored trades");
    expect(container.textContent).toContain("Trade 8");

    render(renderKalshiDashboard(createProps({ snapshot, timeframe: "1h" })), container);

    expect(container.textContent).toContain("Timeframe: 1 hour");
    expect(container.textContent).toContain("Paper decisions: 12");
    expect(container.textContent).toContain("Accepted paper trades: 2");
    expect(container.textContent).toContain("Scored accepted trades: 0");
    expect(container.textContent).toContain("learning-speed bottleneck");
    expect(container.textContent).not.toContain("Trade 8");
  });

  it("filters the accuracy trend graph for every timeframe option", () => {
    const container = document.createElement("div");
    const base = createProps();
    const anchor = "2026-05-03T12:00:00Z";
    const makePoint = (index: number, hoursAgo: number) => {
      const timestamp = new Date(Date.parse(anchor) - hoursAgo * 60 * 60 * 1000)
        .toISOString()
        .replace(".000Z", "Z");
      return {
        index,
        timestamp_utc: timestamp,
        scored_at_utc: timestamp,
        accuracy: index / 10,
        cumulative_pnl_usd: index,
        latest_trade_pnl_usd: 1,
      };
    };
    const snapshot = {
      ...base.snapshot!,
      generated_at_utc: anchor,
      strategy_scorecard: {
        ...base.snapshot!.strategy_scorecard!,
        trend: {
          ...base.snapshot!.strategy_scorecard!.trend!,
          points: [
            makePoint(1, 0.5),
            makePoint(2, 5),
            makePoint(3, 10),
            makePoint(4, 20),
            makePoint(5, 36),
            makePoint(6, 120),
            makePoint(7, 480),
            makePoint(8, 2000),
          ],
        },
      },
    };
    const expected = [
      ["1h", "1 hour", 1, "Trade 1", "Trade 2"],
      ["6h", "6 hours", 2, "Trade 2", "Trade 3"],
      ["12h", "12 hours", 3, "Trade 3", "Trade 4"],
      ["24h", "24 hours", 4, "Trade 4", "Trade 5"],
      ["48h", "48 hours", 5, "Trade 5", "Trade 6"],
      ["7d", "1 week", 6, "Trade 6", "Trade 7"],
      ["30d", "1 month", 7, "Trade 7", "Trade 8"],
      ["1y", "1 year", 8, "Trade 8", null],
      ["all", "All", 8, "Trade 8", null],
    ] as const;

    for (const [timeframe, label, count, includedTrade, excludedTrade] of expected) {
      render(renderKalshiDashboard(createProps({ snapshot, timeframe })), container);

      expect(container.textContent).toContain(`Timeframe: ${label}`);
      expect(container.textContent).toContain(`Learning volume: ${count} scored trade`);
      expect(container.textContent).toContain(includedTrade);
      if (excludedTrade) {
        expect(container.textContent).not.toContain(excludedTrade);
      }
    }
  });

  it("uses scored-at time for recent learning trend windows", () => {
    const container = document.createElement("div");
    const base = createProps();
    const snapshot = {
      ...base.snapshot!,
      generated_at_utc: "2026-05-05T12:30:00Z",
      strategy_scorecard: {
        ...base.snapshot!.strategy_scorecard!,
        trend: {
          ...base.snapshot!.strategy_scorecard!.trend!,
          points: [
            {
              index: 1,
              timestamp_utc: "2026-05-03T00:00:00Z",
              scored_at_utc: "2026-05-05T12:00:00Z",
              accuracy: 1,
              cumulative_pnl_usd: 1.25,
              latest_trade_pnl_usd: 1.25,
            },
          ],
        },
      },
    };

    render(renderKalshiDashboard(createProps({ snapshot, timeframe: "1h" })), container);

    expect(container.textContent).toContain("Timeframe: 1 hour");
    expect(container.textContent).toContain("Learning volume: 1 scored trade");
    expect(container.textContent).toContain("Trade 1");
    expect(container.textContent).not.toContain("No scored paper trades fall inside");
  });

  it("opens decision quality and live-readiness funnel term definitions", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps()), container);

    const noTradeLabel = container.querySelector(
      '.kalshi-bar-label[title*="intentionally skipped"]',
    );
    const observedLabel = container.querySelector(
      '.kalshi-bar-label[title*="market and orderbook snapshots"]',
    );
    const noTradeHelp = noTradeLabel?.querySelector("details");
    const observedHelp = observedLabel?.querySelector("details");

    noTradeHelp
      ?.querySelector("summary")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    observedHelp
      ?.querySelector("summary")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(noTradeHelp?.hasAttribute("open")).toBe(true);
    expect(noTradeHelp?.textContent).toContain("skipped a paper trade");
    expect(observedHelp?.hasAttribute("open")).toBe(true);
    expect(observedHelp?.textContent).toContain("snapshots collected for analysis");
    expect(noTradeHelp?.querySelector(".kalshi-help__popover")).not.toBeNull();
  });

  it("renders copy-shadow status and promotion gates", () => {
    const container = document.createElement("div");
    const base = createProps();
    const snapshot = {
      ...base.snapshot!,
      kalshi_copy_shadow: {
        ok: true,
        mode: "SHADOW_ONLY",
        status: "shadow_collecting",
        shadow_bankroll_usd: 100,
        target_leader: {
          leader_name: "Foster McCoy",
          leader_handle: "foster_verified",
          verification_status: "verified",
          source_status: "enabled",
          evidence_summary: "Verified exact-fill source is available for Foster.",
          live_order_allowed: false,
        },
        recommended_initial_live_order_usd: 1,
        max_recommended_initial_live_order_usd: 5,
        readiness_score: 42.9,
        summary: {
          signals_seen: 12,
          eligible_shadow_signals: 9,
          skipped_signals: 3,
          resolved_signals: 4,
          wins: 3,
          losses: 1,
          win_rate: 0.75,
          net_shadow_pnl_usd: 2.35,
          unresolved_signals: 5,
          observed_days: 2.5,
          exact_opt_in_source_count: 1,
          verified_exact_opt_in_source_count: 1,
          source_count: 3,
          leader_lane_count: 3,
          active_leader_lane_count: 1,
          duplicate_signal_count: 1,
          whale_flow_raw_trades_seen: 108,
          whale_flow_raw_trades_usable: 106,
          whale_flow_raw_trades_rejected: 2,
          whale_flow_raw_trades_quarantined: 2,
          whale_flow_signals_seen: 106,
          whale_flow_derived_signal_count: 106,
          whale_flow_persisted_signal_count: 106,
          whale_flow_signal_ledger_exists: true,
          whale_flow_signal_ledger_missing: false,
          whale_flow_eligible_shadow_signals: 3,
          whale_flow_skipped_signals: 103,
          whale_flow_p95_signal_latency_ms: 14000,
          whale_flow_average_spread_cents: 6.7,
          whale_flow_average_price_drift_cents: 0,
          whale_flow_generated_at_utc: "2026-07-01T12:05:00Z",
          whale_flow_materialized_paper_decisions: 3,
          whale_flow_materialized_shadow_copies: 3,
          whale_flow_unresolved_paper_decisions: 3,
          whale_flow_paper_decision_candidate_signal_count: 106,
          whale_flow_paper_decision_non_existing_candidate_signal_count: 103,
          whale_flow_paper_decision_appendable_signal_count: 0,
          whale_flow_paper_decision_skip_reason_counts: {
            already_materialized: 3,
            max_open_exposure_reached: 103,
          },
          whale_flow_paper_decision_capacity_blocked_signal_count: 103,
          whale_flow_paper_decision_capacity_blocked_forward_signal_count: 103,
          whale_flow_paper_decision_capacity_blocked_forward_signal_sample: [
            {
              signal_id: "whale-flow:cap-new",
              market_ticker: "KXTEST-26",
              side: "yes",
              price_cents: 50,
              quantity: 260,
              whale_score: 80,
              trade_id: "trade-new",
              observed_at_utc: "2026-07-01T12:00:00Z",
              materialized_at_utc: "2026-07-01T12:00:01Z",
              materialization_lag_seconds: 1,
              signal_latency_ms: 300,
              spread_cents: 2,
              price_drift_cents: 1,
              skip_reason: "max_open_exposure_reached",
              counts_for_trade_ready_unlock: false,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
              auto_live_promotion_allowed: false,
            },
          ],
          whale_flow_paper_decision_capacity_blocked_forward_signals_count_for_trade_ready_unlock: false,
          whale_flow_paper_decision_segment_firewall_applied: true,
          whale_flow_paper_decision_segment_firewall_status: "blocked_segment_firewall",
          whale_flow_paper_decision_segment_firewall_blocked_signal_count: 4,
          whale_flow_paper_decision_segment_firewall_blocked_signal_ids: [
            "whale-flow:firewall-blocked",
          ],
          whale_flow_paper_decision_segment_firewall_blocked_signal_sample: [
            {
              signal_id: "whale-flow:firewall-blocked",
              market_ticker: "KXTEST-26",
              side: "yes",
              price_cents: 50,
              quantity: 260,
              whale_score: 80,
              trade_id: "firewall-blocked",
              observed_at_utc: "2026-07-01T12:00:00Z",
              materialized_at_utc: "2026-07-01T12:00:01Z",
              materialization_lag_seconds: 1,
              skip_reason: "segment_firewall_shadow_only",
              segment_id:
                "KXTEST|price:40-59|spread:0-2|liquidity:unknown|size:small|time_to_close:unknown",
              segment_firewall_action: "SHADOW_ONLY",
              segment_firewall_match_type: "prefix",
              matched_segment_id:
                "KXTEST|price:40-59|spread:0-2|liquidity:deep|size:small|time_to_close:unknown",
              counts_for_trade_ready_unlock: false,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
              auto_live_promotion_allowed: false,
            },
          ],
          whale_flow_paper_decision_segment_firewall_blocks_count_for_trade_ready_unlock: false,
          whale_flow_paper_decision_skipped_stale_materialization_count: 7,
          whale_flow_paper_decision_current_open_exposure_usd: 25,
          whale_flow_paper_decision_open_exposure_after_planned_appends_usd: 25,
          whale_flow_paper_decision_remaining_open_exposure_usd: 0,
          whale_flow_paper_decision_max_open_exposure_usd: 25,
          whale_flow_paper_decision_open_exposure_pending_decision_count: 3,
          whale_flow_paper_decision_open_exposure_pending_decision_sample: [
            {
              decision_id: "paper:whale-flow:pending-old",
              signal_id: "whale-flow:pending-old",
              market_ticker: "KXPENDING-26",
              side: "no",
              price_cents: 47,
              paper_contracts: 10,
              paper_notional_usd: 4.7,
              observed_at_utc: "2026-07-01T11:00:00Z",
              decision_recorded_at_utc: "2026-07-01T11:00:01Z",
              pending_age_seconds: 3899,
              resolution_status: "pending_source_backed_outcome",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
              auto_live_promotion_allowed: false,
            },
          ],
          whale_flow_paper_decision_open_exposure_largest_pending_decision_usd: 4.7,
          whale_flow_paper_decision_open_exposure_oldest_pending_decision_age_seconds: 3899,
          whale_flow_paper_decision_open_exposure_resolution_blocker:
            "pending_source_backed_outcomes_consuming_paper_capacity",
          whale_flow_paper_decision_max_materialization_lag_seconds: 300,
          whale_flow_paper_decision_blocked_by_open_exposure: true,
          whale_flow_paper_decision_next_action:
            "Resolve pending paper outcomes or explicitly adjust paper-only exposure caps; keep Whale Flow blocked from live trading.",
          whale_flow_capacity_blocked_observation_status: "capacity_blocked_observations_ready",
          whale_flow_capacity_blocked_observation_count: 7,
          whale_flow_capacity_blocked_observation_accepted_count: 7,
          whale_flow_capacity_blocked_observation_rejected_count: 0,
          whale_flow_capacity_blocked_observation_appended_count: 2,
          whale_flow_capacity_blocked_observations_count_for_trade_ready_unlock: false,
          whale_flow_capacity_blocked_observations_count_for_profitability_gate: false,
          whale_flow_capacity_blocked_observations_count_as_paper_decisions: false,
          whale_flow_capacity_blocked_observation_outcome_status:
            "capacity_blocked_observation_outcomes_ready",
          whale_flow_capacity_blocked_observation_outcome_count: 2,
          whale_flow_capacity_blocked_observation_outcome_resolved_count: 2,
          whale_flow_capacity_blocked_observation_outcome_pending_count: 5,
          whale_flow_capacity_blocked_observation_outcome_appended_count: 1,
          whale_flow_capacity_blocked_observation_hypothesis_only_win_count: 1,
          whale_flow_capacity_blocked_observation_hypothesis_only_loss_count: 1,
          whale_flow_capacity_blocked_observation_hypothesis_only_pnl_usd: -0.5,
          whale_flow_capacity_abstention_value_status: "capacity_abstention_value_ready",
          whale_flow_capacity_abstention_value_governor_action: "SHADOW_ONLY",
          whale_flow_capacity_abstention_value_action_reason:
            "Capacity blocking avoided negative hypothesis-only Whale Flow exposure; keep forward-tail expansion paused until live-relevant evidence improves.",
          whale_flow_capacity_abstention_value_evidence_tier:
            "underpowered_source_backed_capacity_abstention",
          whale_flow_capacity_abstention_value_interpretation:
            "abstention_avoided_hypothetical_loss",
          whale_flow_capacity_abstention_value_resolved_count: 2,
          whale_flow_capacity_abstention_value_pending_count: 5,
          whale_flow_capacity_abstention_value_hypothesis_only_pnl_if_traded_usd: -0.5,
          whale_flow_capacity_abstention_value_avoided_loss_usd: 0.5,
          whale_flow_capacity_abstention_value_missed_gain_usd: 0,
          whale_flow_capacity_abstention_value_hypothesis_only_loss_rate: 0.5,
          whale_flow_capacity_abstention_value_sample_powered: false,
          whale_flow_capacity_abstention_value_counts_for_trade_ready_unlock: false,
          whale_flow_capacity_abstention_value_counts_for_profitability_gate: false,
          whale_flow_capacity_abstention_value_affects_live_routing: false,
          whale_flow_capacity_abstention_value_blockers: [
            "capacity_observation_outcomes_pending",
            "capacity_abstention_value_underpowered",
          ],
          whale_flow_capacity_abstention_value_next_action:
            "Treat avoided loss as abstention evidence only; keep collecting resolved capacity observations without counting them as executed paper.",
          whale_flow_capacity_sizing_hypothesis_status: "blocked_capacity_sizing_hypothesis",
          whale_flow_capacity_sizing_hypothesis_governor_action: "SHADOW_ONLY",
          whale_flow_capacity_sizing_hypothesis_action_reason:
            "Capacity sizing remains shadow-only until source-backed capacity-abstention evidence is positive and sample-powered.",
          whale_flow_capacity_sizing_hypothesis_evidence_tier:
            "underpowered_or_negative_capacity_sizing_hypothesis",
          whale_flow_capacity_sizing_hypothesis_resolved_count: 2,
          whale_flow_capacity_sizing_hypothesis_pending_count: 5,
          whale_flow_capacity_sizing_hypothesis_missed_gain_usd: 0,
          whale_flow_capacity_sizing_hypothesis_sample_powered: false,
          whale_flow_capacity_sizing_hypothesis_recommended_experiment: null,
          whale_flow_capacity_sizing_hypothesis_recommended_experiment_lane: null,
          whale_flow_capacity_sizing_hypothesis_recommended_cap_multipliers: [],
          whale_flow_capacity_sizing_hypothesis_paper_cap_change_allowed: false,
          whale_flow_capacity_sizing_hypothesis_live_cap_change_allowed: false,
          whale_flow_capacity_sizing_hypothesis_counts_for_trade_ready_unlock: false,
          whale_flow_capacity_sizing_hypothesis_affects_live_routing: false,
          whale_flow_capacity_sizing_hypothesis_blockers: [
            "capacity_sizing_hypothesis_underpowered",
            "no_positive_capacity_sizing_hypothesis_pnl",
          ],
          whale_flow_capacity_sizing_hypothesis_cautions: ["capacity_observation_outcomes_pending"],
          whale_flow_capacity_sizing_hypothesis_next_action:
            "Keep resolving capacity-blocked observations and rerun this receipt; do not change paper or live caps.",
          whale_flow_capacity_blocked_observation_outcomes_count_for_trade_ready_unlock: false,
          whale_flow_capacity_blocked_observation_outcomes_count_for_profitability_gate: false,
          whale_flow_capacity_blocked_observation_outcomes_count_for_training_label: false,
          whale_flow_capacity_blocked_observation_outcomes_count_as_paper_decisions: false,
          whale_flow_resolved_signals: 0,
          whale_flow_net_shadow_pnl_usd: 0,
          whale_flow_collector_status: "blocked_placeholder_collector_bounds",
          whale_flow_collector_health_status: "stale_collector_source",
          whale_flow_evidence_refresh_status: "completed_bounded_evidence_refresh",
          whale_flow_evidence_refresh_run_count: 2,
          whale_flow_evidence_refresh_failed_run_count: 0,
          whale_flow_evidence_refresh_signal_appended_count: 12,
          whale_flow_evidence_refresh_paper_decision_appended_count: 2,
          whale_flow_evidence_refresh_feature_store_appended_count: 2,
          whale_flow_evidence_refresh_outcome_appended_count: 0,
          whale_flow_evidence_refresh_max_runtime_seconds: 300,
          whale_flow_evidence_refresh_max_runtime_exceeded_count: 0,
          whale_flow_evidence_refresh_raw_trade_to_signal_backlog_estimate: 42,
          whale_flow_evidence_refresh_signal_to_paper_decision_backlog_estimate: 10,
          whale_flow_evidence_refresh_paper_decision_to_outcome_backlog_estimate: 2,
          whale_flow_evidence_refresh_raw_trade_to_source_depth_backlog_estimate: 4,
          whale_flow_evidence_refresh_post_outcome_materialization_run_count: 1,
          whale_flow_evidence_refresh_probe_outcomes: false,
          whale_flow_evidence_refresh_diagnostic_status: "refreshed_current_evidence",
          whale_flow_evidence_refresh_next_action:
            "Continue bounded foreground evidence refresh while the collector is active.",
          whale_flow_evidence_refresh_active_status: "running_bounded_evidence_refresh",
          whale_flow_evidence_refresh_active_verified: true,
          whale_flow_evidence_refresh_process_alive: true,
          whale_flow_evidence_refresh_pid: 79034,
          whale_flow_evidence_refresh_latest_run_index: 3,
          whale_flow_evidence_refresh_latest_run_age_seconds: 41,
          whale_flow_evidence_refresh_latest_elapsed_seconds: 17.5,
          whale_flow_evidence_refresh_latest_max_runtime_exceeded: false,
          whale_flow_evidence_refresh_latest_signal_appended_count: 7,
          whale_flow_evidence_refresh_latest_paper_decision_appended_count: 1,
          whale_flow_evidence_refresh_latest_capacity_blocked_observation_appended_count: 1,
          whale_flow_evidence_refresh_latest_outcome_appended_count: 0,
          whale_flow_backlog_reducer_status: "bounded_backlog_reducer_completed",
          whale_flow_backlog_reducer_append_limit: 500,
          whale_flow_backlog_reducer_signal_appended_count: 7,
          whale_flow_backlog_reducer_paper_decision_appended_count: 1,
          whale_flow_backlog_reducer_capacity_blocked_observation_appended_count: 1,
          whale_flow_backlog_reducer_inverse_decision_appended_count: 1,
          whale_flow_backlog_reducer_feature_store_appended_count: 1,
          whale_flow_source_depth_priority_status:
            "read_only_priority_source_depth_repair_completed",
          whale_flow_source_depth_priority_trade_id_count: 6,
          whale_flow_source_depth_priority_appended_count: 2,
          whale_flow_source_depth_priority_skipped_existing_count: 4,
          whale_flow_source_depth_priority_skipped_fetch_failed_count: 0,
          whale_flow_outcome_cadence_status: "read_only_outcome_cadence_completed",
          whale_flow_outcome_cadence_outcome_appended_count: 1,
          whale_flow_outcome_cadence_capacity_blocked_observation_outcome_appended_count: 0,
          whale_flow_trade_ready_packet_status: "blocked_trade_ready_packet",
          whale_flow_trade_ready_packet_verified: false,
          whale_flow_trade_ready_packet_blockers: ["profitability_gate_not_passed"],
          whale_flow_autopilot_status: "bounded_autopilot_once_completed",
          whale_flow_autopilot_verified: true,
          whale_flow_autopilot_run_count: 1,
          whale_flow_autopilot_signal_appended_count: 7,
          whale_flow_autopilot_paper_decision_appended_count: 1,
          whale_flow_autopilot_source_depth_appended_count: 2,
          whale_flow_autopilot_outcome_appended_count: 1,
          whale_flow_autopilot_capacity_blocked_observation_outcome_appended_count: 0,
          whale_flow_autopilot_elapsed_seconds: 18.25,
          whale_flow_autopilot_active_evidence_refresh_status: "running_bounded_evidence_refresh",
          whale_flow_autopilot_trade_ready_packet_status: "blocked_trade_ready_packet",
          whale_flow_autopilot_failed_steps: [],
          whale_flow_autopilot_next_action:
            "Refresh the Kalshi dashboard and run the no-live validator after every autopilot pass.",
          whale_flow_autopilot_active_status: "running_bounded_autopilot",
          whale_flow_autopilot_active_verified: true,
          whale_flow_autopilot_active_pid: 63627,
          whale_flow_autopilot_active_process_alive: true,
          whale_flow_autopilot_active_latest_run_index: 4,
          whale_flow_autopilot_active_latest_run_age_seconds: 42,
          whale_flow_autopilot_active_latest_elapsed_seconds: 18.5,
          whale_flow_autopilot_active_latest_max_runtime_exceeded: false,
          whale_flow_autopilot_active_latest_signal_appended_count: 7,
          whale_flow_autopilot_active_latest_paper_decision_appended_count: 1,
          whale_flow_autopilot_active_latest_source_depth_appended_count: 2,
          whale_flow_autopilot_active_latest_outcome_appended_count: 1,
          whale_flow_autopilot_active_backlog_counts: {
            raw_trade_to_signal_backlog_estimate: 12,
          },
          whale_flow_autopilot_active_failed_steps: [],
          whale_flow_autopilot_active_next_expected_run_at_utc: "2026-07-01T12:10:00Z",
          whale_flow_collector_source_proof_age_seconds: 901,
          whale_flow_collector_last_raw_trade_age_seconds: 1200,
          whale_flow_collector_run_count: 754,
          whale_flow_collector_completed_run_count: 747,
          whale_flow_collector_failed_run_count: 7,
          whale_flow_collector_expected_approved_run_count: 10080,
          whale_flow_collector_remaining_approved_run_count: 9333,
          whale_flow_collector_completion_ratio: 0.0741,
          whale_flow_collector_coverage_status: "stopped_before_approved_duration",
          whale_flow_collector_counts_for_trade_ready_unlock: false,
          whale_flow_fill_realism_status: "blocked_fill_realism_unverified",
          whale_flow_fill_realism_version: "v5",
          whale_flow_fill_realism_source_depth_join_strategy:
            "trade_id_with_near_signal_orderbook_timing",
          whale_flow_fill_realism_decision_count: 3,
          whale_flow_fill_realism_forward_paper_decision_count: 1,
          whale_flow_fill_realism_forward_missed_or_unverified_count: 1,
          whale_flow_fill_realism_late_backfill_realistic_fill_count: 0,
          whale_flow_fill_realism_max_source_depth_signal_lag_seconds: 5,
          whale_flow_fill_realism_live_relevant_realistic_fill_rate: 0,
          whale_flow_fill_realism_source_depth_coverage_rate: 0.667,
          whale_flow_fill_realism_source_depth_timing_verified_rate: 0.333,
          whale_flow_fill_realism_source_depth_joined_decision_count: 2,
          whale_flow_fill_realism_source_depth_missing_decision_count: 1,
          whale_flow_fill_realism_source_depth_timing_verified_count: 1,
          whale_flow_fill_realism_source_depth_timing_unverified_count: 1,
          whale_flow_fill_realism_p95_source_depth_signal_lag_seconds: 60,
          whale_flow_fill_realism_aggressive_limit_executable_count: 1,
          whale_flow_fill_realism_passive_queue_verified_count: 0,
          whale_flow_fill_realism_missed_fill_reasons: {
            orderbook_depth_unverified: 2,
            best_ask_above_limit_price: 1,
          },
          whale_flow_fill_realism_forward_missed_fill_reasons: {
            orderbook_depth_unverified: 1,
          },
          whale_flow_fill_realism_forward_verified_missed_fill_count: 0,
          whale_flow_fill_realism_forward_unverified_gap_count: 1,
          whale_flow_fill_realism_late_backfill_missed_fill_reasons: {
            orderbook_depth_unverified: 1,
            best_ask_above_limit_price: 1,
          },
          whale_flow_fill_evidence_gap_status: "blocked_forward_fill_evidence_gaps",
          whale_flow_fill_evidence_gap_forward_decision_count: 1,
          whale_flow_fill_evidence_gap_forward_realistic_fill_count: 0,
          whale_flow_fill_evidence_gap_forward_gap_count: 1,
          whale_flow_fill_evidence_gap_forward_unverified_gap_count: 1,
          whale_flow_fill_evidence_gap_forward_verified_missed_fill_count: 0,
          whale_flow_fill_evidence_gap_missing_source_depth_count: 1,
          whale_flow_fill_evidence_gap_best_ask_above_limit_count: 0,
          whale_flow_fill_evidence_gap_market_impact_risk_count: 0,
          whale_flow_fill_evidence_gap_pending_realistic_outcome_count: 0,
          whale_flow_fill_evidence_gap_resolved_realistic_count: 0,
          whale_flow_fill_evidence_gap_reason_counts: {
            orderbook_depth_unverified: 1,
          },
          whale_flow_fill_evidence_gap_verified_missed_fill_reason_counts: {},
          whale_flow_fill_evidence_gap_top_gap_decisions: [
            {
              market_ticker: "KXDEPTH-26",
              side: "yes",
              missed_fill_reason: "orderbook_depth_unverified",
            },
          ],
          whale_flow_fill_evidence_gap_next_action:
            "Prioritize source-backed near-signal depth capture for forward decisions missing executable-depth proof.",
          whale_flow_fill_gap_governor_status: "fill_gap_governor_quarantined_unverified_depth",
          whale_flow_fill_gap_governor_action: "REJECT_DATA_QUALITY",
          whale_flow_fill_gap_governor_action_reason:
            "Some forward paper decisions lack source-backed signal-time depth, so they are quarantined as evidence gaps.",
          whale_flow_fill_gap_governor_evidence_tier: "source_depth_gap_quarantine",
          whale_flow_fill_gap_governor_segment_scope: "forward_fill_evidence",
          whale_flow_fill_gap_governor_forward_decision_count: 1,
          whale_flow_fill_gap_governor_realistic_fill_count: 0,
          whale_flow_fill_gap_governor_verified_missed_fill_count: 0,
          whale_flow_fill_gap_governor_unverified_gap_count: 1,
          whale_flow_fill_gap_governor_quarantined_unverified_gap_count: 1,
          whale_flow_fill_gap_governor_quarantined_decision_count: 1,
          whale_flow_fill_gap_governor_live_relevant_fill_evidence_verified: false,
          whale_flow_fill_gap_governor_counts_for_trade_ready_unlock: false,
          whale_flow_fill_gap_governor_counts_for_profitability_gate: false,
          whale_flow_fill_gap_governor_counts_for_training_label: false,
          whale_flow_fill_gap_governor_affects_live_routing: false,
          whale_flow_fill_gap_governor_gap_reason_counts: {
            orderbook_depth_unverified: 1,
          },
          whale_flow_fill_gap_governor_verified_missed_fill_reason_counts: {},
          whale_flow_fill_gap_governor_next_action:
            "Continue source-depth collection and require future paper decisions to have signal-time depth proof before they count live-relevant.",
          whale_flow_realistic_fill_count: 0,
          whale_flow_live_relevant_realistic_fill_count: 0,
          whale_flow_late_backfill_decision_count: 2,
          whale_flow_max_decision_materialization_lag_seconds: 300,
          whale_flow_missed_fill_count: 3,
          whale_flow_realistic_after_cost_pnl_usd: 0,
          whale_flow_unverified_or_missed_after_cost_pnl_usd: -0.13,
          whale_flow_live_relevant_after_cost_pnl_usd: 0,
          whale_flow_orderbook_stream_status: "blocked_orderbook_stream_not_collected",
          whale_flow_orderbook_stream_record_count: 0,
          whale_flow_orderbook_stream_market_count: 0,
          whale_flow_orderbook_stream_source_backed_count: 0,
          whale_flow_source_depth_status: "source_depth_available",
          whale_flow_source_depth_record_count: 3,
          whale_flow_source_backed_depth_count: 3,
          whale_flow_source_depth_queue_verified_count: 0,
          whale_flow_source_depth_aggressive_limit_candidate_count: 1,
          whale_flow_source_depth_usable_for_realistic_fill_count: 1,
          whale_flow_market_metadata_status: "market_metadata_source_backed_timing_available",
          whale_flow_market_metadata_record_count: 2,
          whale_flow_market_metadata_ticker_count: 2,
          whale_flow_market_metadata_source_backed_count: 2,
          whale_flow_market_metadata_source_backed_timing_count: 1,
          whale_flow_market_metadata_missing_timing_count: 1,
          whale_flow_quick_settling_status: "blocked_quick_settling_source_timing",
          whale_flow_quick_settling_pending_candidate_count: 2,
          whale_flow_quick_settling_candidate_count: 0,
          whale_flow_quick_settling_source_backed_timing_count: 0,
          whale_flow_quick_settling_unknown_timing_count: 2,
          whale_flow_pnl_truth_ladder_status: "pnl_truth_ladder_ready",
          whale_flow_pnl_truth_primary_live_readiness_metric: "live_relevant_after_cost",
          whale_flow_pnl_truth_headline_shadow_pnl_live_tradable: false,
          whale_flow_pnl_truth_live_relevant_pnl_positive: false,
          whale_flow_pnl_truth_profitability_gate_forward_pnl_positive: false,
          whale_flow_pnl_truth_all_shadow_pnl_usd: 2.35,
          whale_flow_pnl_truth_realistic_after_cost_pnl_usd: -0.13,
          whale_flow_pnl_truth_live_relevant_after_cost_pnl_usd: 0,
          whale_flow_pnl_truth_profitability_gate_forward_pnl_usd: 0,
          whale_flow_pnl_truth_inverse_fade_diagnostic_pnl_usd: 0.25,
          whale_flow_outcome_fetch_repair_status: "retryable_read_only_outcome_fetch_failures",
          whale_flow_outcome_fetch_repair_pending_realistic_outcome_count: 1,
          whale_flow_outcome_fetch_repair_retryable_fetch_failed_count: 1,
          whale_flow_outcome_fetch_repair_classification_counts: {
            market_unsettled: 0,
            market_fetch_failed: 1,
            missing_result_field: 0,
            malformed_market_response: 0,
            already_resolved: 0,
          },
          whale_flow_quick_settling_queue_status: "blocked_quick_settling_source_timing",
          whale_flow_quick_settling_queue_count: 0,
          whale_flow_backlog_accelerator_status: "backlog_accelerator_ready",
          whale_flow_backlog_accelerator_open_gap_count: 4,
          whale_flow_backlog_accelerator_counts: {
            raw_trade_to_signal_backlog_estimate: 12,
            signal_to_paper_decision_backlog_estimate: 10,
            raw_trade_to_source_depth_backlog_estimate: 4,
            paper_decision_to_outcome_backlog_estimate: 2,
          },
          whale_flow_segment_tail_fade_firewall_status: "segment_tail_fade_firewall_ready",
          whale_flow_segment_tail_fade_firewall_action_counts: {
            SHADOW_ONLY: 1,
          },
          whale_flow_segment_tail_fade_firewall_global_flip_allowed: false,
          whale_flow_delayed_entry_forward_test_status: "delayed_entry_forward_test_watch",
          whale_flow_delayed_entry_forward_test_powered_candidate_count: 0,
          whale_flow_delayed_entry_forward_test_underpowered_candidate_count: 1,
          whale_flow_delayed_entry_forward_test_counts_for_trade_ready_unlock: false,
          whale_flow_time_to_close_evidence_status: "blocked_time_to_close_source_timing",
          whale_flow_time_to_close_evidence_decision_count: 2,
          whale_flow_time_to_close_evidence_source_backed_count: 0,
          whale_flow_time_to_close_evidence_unknown_count: 2,
          whale_flow_time_to_close_evidence_reason_counts: {
            missing_resolution_target_time: 2,
            missing_source_backed_market_timing: 2,
          },
          whale_flow_market_context_status: "blocked_market_context_taxonomy",
          whale_flow_market_context_unknown_ticker_count: 2,
          whale_flow_segment_diagnostics_status: "insufficient_sample",
          whale_flow_segment_count: 2,
          whale_flow_segment_live_relevant_resolved_count: 0,
          whale_flow_segment_late_backfill_decision_count: 2,
          whale_flow_segment_action_counts: { SHADOW_ONLY: 2 },
          whale_flow_segment_confidence_status_counts: { underpowered: 2 },
          whale_flow_segment_abstention_reason_counts: {
            insufficient_fill_realistic_segment_sample: 2,
          },
          whale_flow_segment_market_family_counts: { sports_or_live_game: 2 },
          whale_flow_segment_ticker_prefix_counts: { KXMLBGAME: 2 },
          whale_flow_segment_side_counts: { "side:yes": 2 },
          whale_flow_segment_price_band_counts: { "00-19": 1, "20-39": 1 },
          whale_flow_segment_spread_band_counts: { "0-2": 2 },
          whale_flow_segment_size_band_counts: { "size:small": 2 },
          whale_flow_segment_liquidity_band_counts: { "liquidity:unknown": 1, "liquidity:deep": 1 },
          whale_flow_segment_time_to_close_band_counts: { "time_to_close:unknown": 2 },
          whale_flow_segment_blocked_count: 2,
          whale_flow_segment_promotion_candidate_count: 0,
          whale_flow_segment_top_blocked_segments: [
            {
              segment_id:
                "KXMLBGAME|price:00-19|spread:0-2|liquidity:unknown|size:small|time_to_close:unknown",
              action_recommendation: "SHADOW_ONLY",
              confidence_status: "underpowered",
              abstention_reason: "insufficient_fill_realistic_segment_sample",
              market_family: "sports_or_live_game",
              ticker_prefix: "KXMLBGAME",
              side: "side:yes",
              price_band: "00-19",
              spread_band: "0-2",
              size_band: "size:small",
              liquidity_band: "liquidity:unknown",
              time_to_close_band: "time_to_close:unknown",
              decision_count: 2,
              forward_paper_decision_count: 1,
              live_relevant_resolved_count: 0,
              realistic_after_cost_pnl_usd: 0,
              beats_no_trade_baseline: false,
              beats_inverse_baseline: false,
              beats_random_baseline: false,
              beats_market_implied_baseline: false,
              live_order_allowed: false,
            },
          ],
          whale_flow_segment_no_trade_pnl_usd: 0,
          whale_flow_segment_abstention_required_count: 2,
          whale_flow_segment_beats_no_trade_count: 0,
          whale_flow_segment_random_baseline_expected_pnl_usd: 0,
          whale_flow_segment_random_baseline_sample_count: 0,
          whale_flow_segment_beats_random_count: 0,
          whale_flow_segment_market_implied_baseline_pnl_usd: 0,
          whale_flow_segment_market_implied_baseline_sample_count: 0,
          whale_flow_segment_beats_market_implied_count: 0,
          whale_flow_segment_market_implied_baseline_proxy_only: true,
          whale_flow_segment_firewall_status: "blocked_segment_firewall",
          whale_flow_segment_firewall_action_counts: {
            SHADOW_ONLY: 1,
            INVERSE_FORWARD_TEST: 1,
            REJECT_DATA_QUALITY: 1,
          },
          whale_flow_segment_firewall_inverse_forward_test_count: 1,
          whale_flow_segment_firewall_adverse_watchlist_segment_count: 2,
          whale_flow_segment_firewall_uncovered_adverse_watchlist_segment_count: 1,
          whale_flow_adverse_abstention_status: "adverse_abstention_actions_ready",
          whale_flow_adverse_abstention_action_count: 2,
          whale_flow_adverse_abstention_powered_pause_segment_count: 1,
          whale_flow_adverse_abstention_shadow_only_watch_segment_count: 1,
          whale_flow_adverse_abstention_inverse_forward_test_segment_count: 1,
          whale_flow_adverse_abstention_no_trade_baseline_pnl_usd: 0,
          whale_flow_adverse_abstention_counts_for_trade_ready_unlock: false,
          whale_flow_adverse_abstention_counts_for_profitability_gate: false,
          whale_flow_adverse_abstention_affects_live_routing: false,
          whale_flow_tail_fade_tournament_status: "blocked_tail_fade_tournament",
          whale_flow_tail_fade_global_flip_allowed: false,
          whale_flow_tail_fade_live_relevant_after_cost_pnl_usd: 0,
          whale_flow_tail_fade_pnl_source: "live_relevant_forward_paper",
          whale_flow_tail_fade_late_backfill_decision_count: 2,
          whale_flow_tail_fade_random_baseline_expected_pnl_usd: 0,
          whale_flow_tail_fade_random_baseline_sample_count: 0,
          whale_flow_tail_fade_tail_beats_random_baseline: false,
          whale_flow_tail_fade_market_implied_baseline_pnl_usd: 0,
          whale_flow_tail_fade_market_implied_baseline_sample_count: 0,
          whale_flow_tail_fade_market_implied_baseline_proxy_only: true,
          whale_flow_tail_fade_tail_beats_market_implied_baseline: false,
          whale_flow_inverse_exploration_governor_status: "inverse_exploration_underpowered_watch",
          whale_flow_inverse_exploration_governor_action: "SHADOW_ONLY",
          whale_flow_inverse_exploration_governor_action_reason:
            "Forward tailing is failing baselines or inverse candidates exist, but evidence is underpowered.",
          whale_flow_inverse_exploration_governor_evidence_tier:
            "source_backed_underpowered_inverse_hypothesis",
          whale_flow_inverse_exploration_governor_segment_scope: "segment_scoped_only",
          whale_flow_inverse_exploration_candidate_segment_count: 1,
          whale_flow_inverse_exploration_powered_candidate_segment_count: 0,
          whale_flow_inverse_exploration_underpowered_candidate_segment_count: 1,
          whale_flow_inverse_exploration_tail_loses_baselines: true,
          whale_flow_inverse_exploration_global_flip_allowed: false,
          whale_flow_inverse_exploration_inverse_forward_testing_allowed: true,
          whale_flow_inverse_exploration_counts_for_trade_ready_unlock: false,
          whale_flow_inverse_exploration_counts_for_profitability_gate: false,
          whale_flow_inverse_exploration_counts_for_training_label: false,
          whale_flow_inverse_exploration_affects_live_routing: false,
          whale_flow_inverse_exploration_top_candidate_segments: [
            {
              segment_id:
                "KXWCTEAMTOTAL|price:60-79|spread:0-2|liquidity:deep|size:small|time_to_close:<1h",
              governor_action: "INVERSE_FORWARD_TEST",
              live_order_allowed: false,
            },
          ],
          whale_flow_inverse_exploration_next_action:
            "Forward-test only powered segment-scoped inverse hypotheses in paper; otherwise keep abstaining and collecting evidence.",
          whale_flow_inverse_decision_count: 3,
          whale_flow_inverse_resolved_count: 0,
          whale_flow_inverse_net_pnl_usd: 0,
          whale_flow_outcome_velocity_status: "pending_realistic_fill_outcomes",
          whale_flow_outcome_velocity_pending_count: 3,
          whale_flow_outcome_velocity_realistic_pending_count: 1,
          whale_flow_outcome_velocity_unfillable_pending_count: 1,
          whale_flow_outcome_velocity_unknown_fill_pending_count: 1,
          whale_flow_outcome_velocity_resolved_realistic_count: 0,
          whale_flow_outcome_velocity_resolved_unfillable_count: 1,
          whale_flow_outcome_velocity_label_unlock_pending_count: 1,
          whale_flow_outcome_probe_status: "read_only_outcome_probe_completed",
          whale_flow_outcome_probe_checked_count: 3,
          whale_flow_outcome_probe_market_fetch_failed_count: 2,
          whale_flow_outcome_probe_source_error_type_counts: {
            KalshiReadError: 2,
          },
          whale_flow_outcome_probe_realistic_label_unlock_checked_count: 1,
          whale_flow_outcome_probe_realistic_label_unlock_fetch_failed_count: 1,
          whale_flow_outcome_probe_realistic_label_unlock_unresolved_count: 1,
          whale_flow_outcome_probe_realistic_label_unlock_resolved_appended_count: 0,
          whale_flow_outcome_probe_realistic_label_unlock_blocker_counts: {
            market_fetch_failed: 1,
          },
          whale_flow_outcome_probe_next_action:
            "Fix read-only Kalshi market fetch/auth/network before waiting on settlement.",
          whale_flow_realistic_outcome_unlock_status: "blocked_read_only_outcome_fetch",
          whale_flow_realistic_outcome_unlock_pending_count: 1,
          whale_flow_realistic_outcome_unlock_resolved_count: 0,
          whale_flow_realistic_outcome_unlock_fetch_failed_count: 1,
          whale_flow_realistic_outcome_unlock_retryable_fetch_failed_count: 1,
          whale_flow_realistic_outcome_unlock_source_error_type_counts: {
            KalshiReadError: 1,
          },
          whale_flow_realistic_outcome_unlock_blocker_counts: {
            market_fetch_failed: 1,
          },
          whale_flow_realistic_outcome_unlock_top_pending_decisions: [
            {
              decision_id: "paper:whale-flow:pending-realistic-1",
              market_ticker: "KXGAME-26",
              expected_resolution_priority: "high_quick_resolution_candidate",
              realistic_fill: true,
              source_depth_available: true,
              live_order_allowed: false,
            },
          ],
          whale_flow_realistic_outcome_unlock_top_failed_fetches: [
            {
              decision_id: "paper:whale-flow:pending-realistic-1",
              market_ticker: "KXGAME-26",
              status: "market_fetch_failed",
              source_error_type: "KalshiReadError",
              source_error_summary: "dns_resolution_failed:api.elections.kalshi.com",
              source_error_retryable: true,
              live_order_allowed: false,
            },
          ],
          whale_flow_realistic_outcome_unlock_next_action:
            "Restore read-only Kalshi market fetch/auth/network and rerun outcome probe for realistic-fill markets.",
          whale_flow_trade_ready_status: "blocked_trade_ready_gate",
          whale_flow_live_canary_preflight_status: "blocked_exact_canary_eligibility",
          whale_flow_live_canary_approval_recorded: true,
          whale_flow_live_canary_max_order_usd: 1,
          whale_flow_live_canary_daily_loss_cap_usd: 5,
          whale_flow_live_canary_blockers: [
            "trade_ready_gate_not_passed",
            "exact_order_parameters_missing",
          ],
          whale_flow_live_canary_dry_run_only: true,
          whale_flow_live_canary_order_intent_available: false,
          whale_flow_evidence_dataset_status: "blocked_insufficient_training_rows",
          whale_flow_evidence_dataset_total_rows: 3,
          whale_flow_evidence_dataset_labeled_rows: 0,
          whale_flow_evidence_dataset_training_label_rows: 0,
          whale_flow_evidence_dataset_forward_paper_label_rows: 0,
          whale_flow_evidence_dataset_late_backfill_label_rows: 2,
          whale_flow_evidence_dataset_source_backed_unusable_label_rows: 1,
          whale_flow_evidence_dataset_pending_realistic_label_rows: 1,
          whale_flow_evidence_dataset_resolved_unfillable_label_rows: 1,
          whale_flow_evidence_dataset_label_blocker_counts: {
            pending_realistic_fill_outcome: 1,
            source_backed_but_unrealistic_fill: 1,
          },
          whale_flow_evidence_dataset_rejected_rows: 1,
          whale_flow_feature_store_status: "blocked_feature_store_underpowered",
          whale_flow_feature_store_record_count: 3,
          whale_flow_feature_store_source_backed_label_count: 0,
          whale_flow_feature_store_usable_training_label_count: 0,
          whale_flow_feature_store_source_backed_unrealistic_label_count: 1,
          whale_flow_feature_store_pending_realistic_label_count: 1,
          whale_flow_sts_adapter_status: "paper_only_sts_adapter_ready",
          whale_flow_sts_adapter_accepted_record_count: 3,
          whale_flow_sts_adapter_rejected_record_count: 0,
          whale_flow_sts_adapter_feature_log_record_count: 3,
          whale_flow_sts_adapter_segment_count: 2,
          whale_flow_sts_adapter_action_counts: {
            SHADOW_ONLY: 2,
            ACCEPT_EXPLORATION: 1,
          },
          whale_flow_sts_adapter_live_routing_allowed: false,
          whale_flow_sts_adapter_weight_change_allowed: false,
          whale_flow_ml_governor_status: "blocked_insufficient_training_rows",
          whale_flow_ml_governor_training_label_rows: 0,
          whale_flow_ml_governor_paper_routing_allowed: false,
          whale_flow_mlx_diagnostic_status: "blocked_mlx_runtime_not_enabled",
          whale_flow_profitability_firewall_status: "blocked_profitability_firewall",
          whale_flow_profitability_firewall_tail_live_relevant_after_cost_pnl_usd: 0,
          whale_flow_profitability_firewall_tail_beats_random_baseline: false,
          whale_flow_profitability_firewall_tail_beats_market_implied_baseline: false,
          whale_flow_profitability_firewall_market_implied_baseline_proxy_only: true,
          whale_flow_paper_decision_paper_governor_applied: true,
          whale_flow_paper_decision_paper_governor_status: "paper_governor_forward_tail_paused",
          whale_flow_paper_decision_paper_governor_action: "SHADOW_ONLY",
          whale_flow_paper_decision_paper_governor_forward_tail_materialization_allowed: false,
          whale_flow_paper_decision_paper_governor_blocked_signal_count: 1,
          whale_flow_paper_decision_paper_governor_blocked_signal_ids: [
            "whale-flow:governor-blocked",
          ],
          whale_flow_paper_decision_paper_governor_blocked_signal_sample: [
            {
              signal_id: "whale-flow:governor-blocked",
              market_ticker: "KXTEST-26",
              side: "yes",
              price_cents: 50,
              quantity: 250,
              whale_score: 82,
              trade_id: "trade-governor-blocked",
              observed_at_utc: "2026-07-01T12:05:00Z",
              materialized_at_utc: "2026-07-01T12:05:01Z",
              materialization_lag_seconds: 1,
              skip_reason: "paper_governor_forward_tail_paused",
              segment_id: "test_segment",
              paper_governor_action: "SHADOW_ONLY",
              paper_governor_status: "paper_governor_forward_tail_paused",
              counts_for_trade_ready_unlock: false,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
              auto_live_promotion_allowed: false,
            },
          ],
          whale_flow_paper_decision_paper_governor_blocks_count_for_trade_ready_unlock: false,
          whale_flow_paper_governor_status: "paper_governor_forward_tail_paused",
          whale_flow_paper_governor_action: "SHADOW_ONLY",
          whale_flow_paper_governor_action_reason:
            "forward_tail_paused_until_tail_beats_no_trade_inverse_random_and_market_baselines_after_costs",
          whale_flow_paper_governor_evidence_tier:
            "source_backed_negative_after_cost_or_baseline_failure",
          whale_flow_paper_governor_forward_tail_materialization_allowed: false,
          whale_flow_paper_governor_shadow_logging_allowed: true,
          whale_flow_paper_governor_inverse_forward_testing_allowed: true,
          whale_flow_paper_governor_outcome_grading_allowed: true,
          whale_flow_paper_governor_reason_codes: [
            "negative_or_zero_live_relevant_after_cost_pnl",
            "tail_does_not_beat_no_trade_baseline",
          ],
          whale_flow_paper_governor_counts_for_trade_ready_unlock: false,
          whale_flow_paper_governor_counts_for_profitability_gate: false,
          whale_flow_paper_governor_affects_live_routing: false,
          whale_flow_paper_governor_next_action:
            "Keep collecting public flow and outcomes, but do not add new forward-tail paper decisions until the paper governor clears.",
          whale_flow_tail_loss_diagnosis_status: "tail_loss_diagnosis_ready",
          whale_flow_tail_loss_diagnosis_governor_action: "SHADOW_ONLY",
          whale_flow_tail_loss_diagnosis_action_reason:
            "forward_tail_loss_or_baseline_failure_requires_segment_scoped_abstention",
          whale_flow_tail_loss_diagnosis_evidence_tier:
            "source_backed_underpowered_tail_loss_diagnosis",
          whale_flow_tail_loss_diagnosis_live_relevant_sample_count: 2,
          whale_flow_tail_loss_diagnosis_tail_after_cost_pnl_usd: -0.75,
          whale_flow_tail_loss_diagnosis_inverse_after_cost_pnl_usd: 0.25,
          whale_flow_tail_loss_diagnosis_tail_beats_no_trade: false,
          whale_flow_tail_loss_diagnosis_tail_beats_inverse: false,
          whale_flow_tail_loss_diagnosis_cohort_count: 1,
          whale_flow_tail_loss_diagnosis_underpowered_loss_cohort_count: 1,
          whale_flow_tail_loss_diagnosis_underpowered_inverse_candidate_count: 1,
          whale_flow_tail_loss_diagnosis_powered_pause_segment_count: 0,
          whale_flow_tail_loss_diagnosis_action_counts: { SHADOW_ONLY: 1 },
          whale_flow_tail_loss_diagnosis_root_cause_counts: {
            tail_after_cost_pnl_negative: 1,
            inverse_baseline_beats_tail: 1,
          },
          whale_flow_tail_loss_diagnosis_top_loss_cohorts: [
            {
              segment_id: "test_segment",
              sample_count: 2,
              tail_after_cost_pnl_usd: -0.75,
              inverse_after_cost_pnl_usd: 0.25,
              governor_action: "SHADOW_ONLY",
            },
          ],
          whale_flow_tail_loss_diagnosis_counts_for_trade_ready_unlock: false,
          whale_flow_tail_loss_diagnosis_counts_for_profitability_gate: false,
          whale_flow_tail_loss_diagnosis_affects_live_routing: false,
          whale_flow_tail_loss_diagnosis_next_action:
            "Keep Whale Flow shadow-only and investigate losing cohorts before allowing forward-tail paper expansion.",
          whale_flow_adverse_selection_status: "blocked_adverse_selection_underpowered",
          whale_flow_adverse_selection_decision_count: 3,
          whale_flow_adverse_selection_raw_trade_count: 106,
          whale_flow_adverse_selection_segment_summary_count: 2,
          whale_flow_adverse_selection_powered_adverse_segment_count: 0,
          whale_flow_adverse_selection_underpowered_adverse_segment_count: 2,
          whale_flow_adverse_selection_horizons_seconds: [60, 300, 900, 3600],
          whale_flow_adverse_selection_source_backed_horizons_seconds: [60, 300, 900, 3600],
          whale_flow_adverse_selection_missing_horizons_seconds: [],
          whale_flow_adverse_selection_underpowered_horizons_seconds: [60, 300, 900, 3600],
          whale_flow_adverse_selection_source_backed_horizon_count: 4,
          whale_flow_adverse_selection_missing_horizon_count: 0,
          whale_flow_adverse_selection_underpowered_horizon_count: 4,
          whale_flow_adverse_selection_adverse_horizons_seconds: [60],
          whale_flow_entry_timing_status: "entry_timing_delay_hypothesis_available",
          whale_flow_entry_timing_instant_entry_status: "instant_entry_adverse_selection_risk",
          whale_flow_entry_timing_instant_entry_risk: true,
          whale_flow_entry_timing_source_backed_horizon_count: 4,
          whale_flow_entry_timing_powered_horizon_count: 4,
          whale_flow_entry_timing_immediate_horizon_seconds: 60,
          whale_flow_entry_timing_immediate_adverse_rate: 0.5094,
          whale_flow_entry_timing_best_delay_horizon_seconds: 300,
          whale_flow_entry_timing_best_delay_favorable_rate: 0.5224,
          whale_flow_entry_timing_best_delay_adverse_rate: 0.3134,
          whale_flow_entry_timing_best_delay_average_selected_side_delta_cents: 4.58,
          whale_flow_entry_timing_best_delay_favorable_edge_count: 14,
          whale_flow_entry_timing_delayed_entry_hypothesis_available: true,
          whale_flow_entry_timing_paper_only_forward_test_recommended: true,
          whale_flow_entry_timing_counts_for_trade_ready_unlock: false,
          whale_flow_entry_timing_counts_for_profitability_gate: false,
          whale_flow_entry_timing_affects_live_routing: false,
          whale_flow_entry_timing_observation_status: "entry_timing_observations_ready",
          whale_flow_entry_timing_observation_count: 4,
          whale_flow_entry_timing_observation_accepted_count: 4,
          whale_flow_entry_timing_observation_rejected_count: 0,
          whale_flow_entry_timing_observation_source_backed_count: 4,
          whale_flow_entry_timing_observation_improved_entry_count: 3,
          whale_flow_entry_timing_observation_worse_entry_count: 1,
          whale_flow_entry_timing_observation_flat_entry_count: 0,
          whale_flow_entry_timing_observation_average_entry_price_improvement_cents: 2.25,
          whale_flow_entry_timing_observation_average_selected_side_delta_cents: -2.25,
          whale_flow_entry_timing_observation_best_delay_horizon_seconds: 300,
          whale_flow_entry_timing_observations_count_for_trade_ready_unlock: false,
          whale_flow_entry_timing_observations_count_for_profitability_gate: false,
          whale_flow_entry_timing_observations_count_for_training_label: false,
          whale_flow_entry_timing_observations_count_as_paper_decision: false,
          whale_flow_entry_timing_observations_affect_live_routing: false,
          whale_flow_entry_timing_segment_status: "entry_timing_segments_ready",
          whale_flow_entry_timing_segment_count: 2,
          whale_flow_entry_timing_segment_powered_count: 1,
          whale_flow_entry_timing_segment_underpowered_count: 1,
          whale_flow_entry_timing_segment_delay_improved_count: 1,
          whale_flow_entry_timing_segment_delay_worse_count: 1,
          whale_flow_entry_timing_segment_average_entry_price_improvement_cents: -0.5,
          whale_flow_entry_timing_segment_global_action: "no_global_delay_rule",
          whale_flow_entry_timing_segment_global_delay_rule_allowed: false,
          whale_flow_entry_timing_segments_count_for_trade_ready_unlock: false,
          whale_flow_entry_timing_segments_count_for_profitability_gate: false,
          whale_flow_entry_timing_segments_count_as_paper_decision: false,
          whale_flow_entry_timing_segments_affect_live_routing: false,
          whale_flow_entry_timing_governor_status:
            "entry_timing_governor_underpowered_hypothesis_watch",
          whale_flow_entry_timing_governor_action: "SHADOW_ONLY",
          whale_flow_entry_timing_governor_action_reason:
            "Delayed entry improved some segments, but only with underpowered evidence; no paper routing change is allowed yet.",
          whale_flow_entry_timing_governor_evidence_tier:
            "source_backed_underpowered_timing_hypothesis",
          whale_flow_entry_timing_governor_segment_scope: "segment_scoped_only",
          whale_flow_entry_timing_governor_powered_delayed_entry_candidate_count: 0,
          whale_flow_entry_timing_governor_underpowered_delayed_entry_candidate_count: 1,
          whale_flow_entry_timing_governor_rejected_delay_segment_count: 1,
          whale_flow_entry_timing_governor_global_delay_rule_allowed: false,
          whale_flow_entry_timing_governor_source_global_delay_rule_allowed: false,
          whale_flow_entry_timing_governor_delayed_entry_forward_test_allowed: false,
          whale_flow_entry_timing_governor_instant_entry_policy: "PAUSE_FORWARD_TAIL_PAPER",
          whale_flow_entry_timing_governor_counts_for_trade_ready_unlock: false,
          whale_flow_entry_timing_governor_counts_for_profitability_gate: false,
          whale_flow_entry_timing_governor_counts_as_paper_decision: false,
          whale_flow_entry_timing_governor_affects_live_routing: false,
          whale_flow_entry_timing_governor_next_action:
            "Keep collecting source-backed timing observations until a segment has enough powered delayed-entry evidence.",
          whale_flow_profit_review_status: "blocked_insufficient_resolved_history",
          whale_flow_outcome_record_count: 0,
          live_order_allowed: false,
        },
        source_discovery: {
          artifact_path: "work/scripts/kalshi/kalshi_copy_shadow_source_discovery_v1.json",
          artifact_exists: true,
          generated_at_utc: "2026-07-01T12:00:00Z",
          status: "blocked",
          public_identity_verified: true,
          authenticated_read_ok: true,
          authenticated_read_attempted: true,
          copyable_exact_source_verified: false,
          blockers: ["no_verified_exact_opt_in_foster_fill_source"],
          next_action: "Get a consented exact-fill Foster McCoy source.",
          overall_completion_percentage: 32,
          milestones: [
            {
              milestone_id: "FCS-02",
              name: "Source Receipt Artifact",
              completion_percentage: 100,
              status: "complete",
              evidence: "Receipt exists.",
            },
          ],
          candidate_sources_reviewed: [
            {
              source_id: "kalshi_wss_public_trades",
              candidate: "Kalshi WebSocket Public Trades",
              status: "not_copyable_market_level_public_feed",
              latency_fit: "immediate_after_trade_execution",
              exact_fill: true,
              leader_identity_available: false,
              copyable_now: false,
              requires_external_approval: false,
              why_not_copyable: "Public trades omit trader identity.",
              live_order_allowed: false,
            },
            {
              source_id: "kalshi_wss_user_fills_opt_in",
              candidate: "Foster opt-in Kalshi WebSocket User Fills",
              status: "blocked_requires_foster_opt_in_source",
              latency_fit: "immediate_when_the_source_account_fills",
              exact_fill: true,
              leader_identity_available: true,
              copyable_now: false,
              requires_external_approval: true,
              why_not_copyable: "Requires Foster consent.",
              live_order_allowed: false,
            },
          ],
          live_order_allowed: false,
        },
        latency: {
          p95_signal_latency_ms: 720,
          average_decision_latency_ms: 80,
          near_instant_target_ms: 1000,
          live_order_allowed: false,
        },
        execution_quality: {
          average_price_drift_cents: 1.2,
          average_spread_cents: 2.1,
          max_price_drift_cents: 2,
          max_spread_cents: 4,
          live_order_allowed: false,
        },
        risk_controls: {
          max_shadow_order_usd: 5,
          max_shadow_open_exposure_usd: 25,
          market_orders_allowed: false,
          live_order_allowed: false,
        },
        signal_quality: {
          skip_reasons: {
            duplicate_signal_id: 1,
          },
          duplicate_signal_count: 1,
          live_order_allowed: false,
        },
        source_health: {
          foster_relay_verifier: {
            validator_id: "foster_relay_fixture",
            status: "fixture_schema_passed_real_source_blocked",
            verified: false,
            schema_passed: true,
            missing_fields: [],
            invalid_fields: [],
            unsafe_true_flags: [],
            latency_ms: 400,
            next_action:
              "Provide a real Foster relay URL/token before this can verify an exact source.",
            live_order_allowed: false,
          },
          caleb_public_signal_verifier: {
            validator_id: "caleb_public_signal_fixture",
            status: "no_fixture_sample",
            verified: false,
            schema_passed: false,
            missing_fields: [],
            invalid_fields: [],
            risk_flags: [],
            unsafe_true_flags: [],
            next_action:
              "Provide source-backed Caleb public signal URLs before collecting real paper signals.",
            live_order_allowed: false,
          },
          signal_log_validator: {
            validator_id: "copy_shadow_signal_log",
            status: "passed",
            verified: false,
            schema_passed: true,
            path: "work/scripts/kalshi/logs/copy_shadow_signals.jsonl",
            record_count: 12,
            accepted_record_count: 9,
            rejected_record_count: 0,
            duplicate_signal_ids: [],
            rejection_reasons: {},
            unsafe_true_flags: [],
            live_order_allowed: false,
          },
          whale_flow_verifier: {
            validator_id: "whale_flow_public_trade_verifier",
            status: "shadow_scaffold_ready",
            verified: false,
            collection_seen: true,
            schema_passed: true,
            execution_quality_verified: true,
            signal_ledger_exists: true,
            signal_ledger_missing: false,
            derived_signal_count: 106,
            persisted_signal_count: 106,
            record_count: 106,
            accepted_record_count: 3,
            rejected_record_count: 103,
            materialized_paper_decision_count: 3,
            materialized_shadow_copy_count: 3,
            unresolved_paper_decision_count: 3,
            raw_trade_quarantine_count: 2,
            artifact_hygiene: {
              work_scripts_kalshi_ignored_by_local_git_exclude: true,
            },
            collector_control_validator: {
              status: "blocked_placeholder_collector_bounds",
              approved_for_real_collection_run: false,
              blockers: ["placeholder_collector_bounds_rejected"],
              next_action:
                "Provide concrete duration, frequency, and max-trade bounds before starting a foreground-only recurring public-trades collector.",
              live_order_allowed: false,
            },
            collector_health: {
              status: "stale_collector_source",
              verified: false,
              source_proof_age_seconds: 901,
              last_raw_trade_age_seconds: 1200,
              collector_run_count: 754,
              collector_completed_run_count: 747,
              collector_failed_run_count: 7,
              collector_expected_approved_run_count: 10080,
              collector_remaining_approved_run_count: 9333,
              collector_completion_ratio: 0.0741,
              collector_coverage_status: "stopped_before_approved_duration",
              counts_for_trade_ready_unlock: false,
              reconnect_failure_count: 1,
              next_action:
                "Run the approved bounded foreground collector; do not emit trade-ready signals from stale public flow.",
              live_order_allowed: false,
            },
            evidence_refresh: {
              status: "completed_bounded_evidence_refresh",
              verified: true,
              run_count: 2,
              failed_run_count: 0,
              signal_appended_count: 12,
              paper_decision_appended_count: 2,
              feature_store_appended_count: 2,
              outcome_appended_count: 0,
              max_runtime_seconds: 300,
              max_refresh_runtime_exceeded_count: 0,
              backlog_counts: {
                raw_trade_to_signal_backlog_estimate: 42,
                signal_to_paper_decision_backlog_estimate: 10,
                paper_decision_to_outcome_backlog_estimate: 2,
                raw_trade_to_source_depth_backlog_estimate: 4,
              },
              post_outcome_materialization_run_count: 1,
              diagnostic_status: "refreshed_current_evidence",
              next_action:
                "Continue bounded foreground evidence refresh while the collector is active.",
              live_order_allowed: false,
            },
            outcome_resolution_validator: {
              status: "blocked_unresolved_markets",
              resolved_count: 0,
              pending_resolution_count: 3,
              next_action:
                "Wait for the materialized Whale Flow markets to settle before appending source-backed outcomes.",
              live_order_allowed: false,
            },
            profitability_gate_validator: {
              status: "blocked_insufficient_resolved_history",
              baseline_review_allowed: false,
              resolved_count: 0,
              pending_resolution_count: 3,
              observed_days: 0,
              required_resolved_signals: 200,
              required_observed_days: 30,
              blockers: ["needs_200_resolved_real_whale_flow_signals", "needs_30_observed_days"],
              next_action:
                "Collect and resolve more source-backed Whale Flow paper decisions before profitability review.",
              live_order_allowed: false,
            },
            fill_realism: {
              status: "blocked_fill_realism_unverified",
              verified: false,
              fill_realism_version: "v5",
              source_depth_join_strategy: "trade_id_with_near_signal_orderbook_timing",
              decision_count: 3,
              forward_paper_decision_count: 1,
              forward_missed_or_unverified_count: 1,
              late_backfill_realistic_fill_count: 0,
              max_source_depth_signal_lag_seconds: 5,
              live_relevant_realistic_fill_rate: 0,
              source_depth_coverage_rate: 0.667,
              source_depth_timing_verified_rate: 0.333,
              source_depth_joined_decision_count: 2,
              source_depth_missing_decision_count: 1,
              source_depth_timing_verified_count: 1,
              source_depth_timing_unverified_count: 1,
              p95_source_depth_signal_lag_seconds: 60,
              aggressive_limit_executable_count: 1,
              passive_queue_verified_count: 0,
              missed_fill_reasons: {
                orderbook_depth_unverified: 2,
                best_ask_above_limit_price: 1,
              },
              forward_missed_fill_reasons: {
                orderbook_depth_unverified: 1,
              },
              forward_verified_missed_fill_count: 0,
              forward_unverified_gap_count: 1,
              late_backfill_missed_fill_reasons: {
                orderbook_depth_unverified: 1,
                best_ask_above_limit_price: 1,
              },
              realistic_fill_count: 0,
              missed_fill_count: 3,
              realistic_after_cost_pnl_usd: -0.13,
              live_relevant_after_cost_pnl_usd: 0,
              next_action:
                "Collect queue/depth evidence at signal time before treating paper P&L as live-executable.",
              live_order_allowed: false,
            },
            fill_evidence_gap: {
              status: "blocked_forward_fill_evidence_gaps",
              verified: false,
              forward_decision_count: 1,
              forward_realistic_fill_count: 0,
              forward_gap_count: 1,
              forward_unverified_gap_count: 1,
              forward_verified_missed_fill_count: 0,
              missing_source_depth_count: 1,
              best_ask_above_limit_count: 0,
              market_impact_risk_count: 0,
              pending_realistic_outcome_count: 0,
              resolved_realistic_count: 0,
              gap_reason_counts: {
                orderbook_depth_unverified: 1,
              },
              verified_missed_fill_reason_counts: {},
              top_gap_decisions: [
                {
                  market_ticker: "KXDEPTH-26",
                  side: "yes",
                  missed_fill_reason: "orderbook_depth_unverified",
                },
              ],
              next_action:
                "Prioritize source-backed near-signal depth capture for forward decisions missing executable-depth proof.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
              auto_live_promotion_allowed: false,
            },
            fill_gap_governor: {
              status: "fill_gap_governor_quarantined_unverified_depth",
              verified: false,
              schema_passed: true,
              governor_action: "REJECT_DATA_QUALITY",
              action_reason:
                "Some forward paper decisions lack source-backed signal-time depth, so they are quarantined as evidence gaps.",
              evidence_tier: "source_depth_gap_quarantine",
              segment_scope: "forward_fill_evidence",
              forward_decision_count: 1,
              realistic_fill_count: 0,
              verified_missed_fill_count: 0,
              unverified_gap_count: 1,
              quarantined_unverified_gap_count: 1,
              quarantined_decision_count: 1,
              gap_reason_counts: {
                orderbook_depth_unverified: 1,
              },
              verified_missed_fill_reason_counts: {},
              live_relevant_fill_evidence_verified: false,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_for_training_label: false,
              counts_as_paper_decision: false,
              affects_live_routing: false,
              paper_only: true,
              next_action:
                "Continue source-depth collection and require future paper decisions to have signal-time depth proof before they count live-relevant.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
              auto_live_promotion_allowed: false,
            },
            orderbook_stream: {
              status: "blocked_orderbook_stream_not_collected",
              verified: false,
              record_count: 0,
              market_count: 0,
              source_backed_record_count: 0,
              next_action:
                "Collect bounded read-only orderbook stream records for markets seen in public Whale Flow before fill realism can be live-relevant.",
              live_order_allowed: false,
            },
            source_depth: {
              status: "source_depth_available",
              verified: true,
              record_count: 3,
              source_backed_depth_count: 3,
              queue_verified_count: 0,
              aggressive_limit_candidate_count: 1,
              usable_for_realistic_fill_count: 1,
              next_action:
                "Source-backed depth is available; queue position remains conservative unless separately verified.",
              live_order_allowed: false,
            },
            market_metadata: {
              status: "market_metadata_source_backed_timing_available",
              verified: true,
              record_count: 2,
              ticker_count: 2,
              source_backed_count: 2,
              source_backed_timing_count: 1,
              missing_timing_count: 1,
              next_action:
                "Use source-backed market timing for quick-settling, time-to-close, and segment diagnostics.",
              live_order_allowed: false,
            },
            quick_settling: {
              status: "blocked_quick_settling_source_timing",
              verified: false,
              candidate_count: 2,
              quick_settling_candidate_count: 0,
              source_backed_timing_count: 0,
              unknown_timing_count: 2,
              next_action:
                "Add source-backed market timing and prioritize markets expected to settle in 24-72 hours to speed forward evidence.",
              live_order_allowed: false,
            },
            time_to_close_evidence: {
              status: "blocked_time_to_close_source_timing",
              verified: false,
              decision_count: 2,
              source_backed_timing_count: 0,
              unknown_timing_count: 2,
              gap_reason_counts: {
                missing_resolution_target_time: 2,
                missing_source_backed_market_timing: 2,
              },
              counts_for_trade_ready_unlock: false,
              affects_live_routing: false,
              live_order_allowed: false,
            },
            market_context: {
              status: "blocked_market_context_taxonomy",
              verified: false,
              unknown_ticker_count: 2,
              family_counts: { unknown_taxonomy: 2 },
              next_action:
                "Map unknown market tickers into a source-backed taxonomy before using their segment results for promotion.",
              live_order_allowed: false,
            },
            segment_diagnostics: {
              status: "insufficient_sample",
              verified: false,
              segment_count: 2,
              resolved_count: 0,
              live_relevant_resolved_count: 0,
              late_backfill_decision_count: 2,
              segment_action_counts: { SHADOW_ONLY: 2 },
              segment_confidence_status_counts: { underpowered: 2 },
              segment_abstention_reason_counts: {
                insufficient_fill_realistic_segment_sample: 2,
              },
              segment_market_family_counts: { sports_or_live_game: 2 },
              segment_ticker_prefix_counts: { KXMLBGAME: 2 },
              segment_side_counts: { "side:yes": 2 },
              segment_price_band_counts: { "00-19": 1, "20-39": 1 },
              segment_spread_band_counts: { "0-2": 2 },
              segment_size_band_counts: { "size:small": 2 },
              segment_liquidity_band_counts: { "liquidity:unknown": 1, "liquidity:deep": 1 },
              segment_time_to_close_band_counts: { "time_to_close:unknown": 2 },
              blocked_segment_count: 2,
              promotion_candidate_segment_count: 0,
              top_blocked_segments: [
                {
                  segment_id:
                    "KXMLBGAME|price:00-19|spread:0-2|liquidity:unknown|size:small|time_to_close:unknown",
                  action_recommendation: "SHADOW_ONLY",
                  confidence_status: "underpowered",
                  abstention_reason: "insufficient_fill_realistic_segment_sample",
                  market_family: "sports_or_live_game",
                  ticker_prefix: "KXMLBGAME",
                  side: "side:yes",
                  price_band: "00-19",
                  spread_band: "0-2",
                  size_band: "size:small",
                  liquidity_band: "liquidity:unknown",
                  time_to_close_band: "time_to_close:unknown",
                  decision_count: 2,
                  forward_paper_decision_count: 1,
                  live_relevant_resolved_count: 0,
                  realistic_after_cost_pnl_usd: 0,
                  beats_no_trade_baseline: false,
                  beats_inverse_baseline: false,
                  beats_random_baseline: false,
                  beats_market_implied_baseline: false,
                  live_order_allowed: false,
                },
              ],
              no_trade_baseline: {
                pnl_usd: 0,
                abstention_required_segment_count: 2,
                beats_no_trade_segment_count: 0,
              },
              random_baseline: {
                sample_count: 0,
                expected_pnl_usd: 0,
                beats_random_segment_count: 0,
              },
              market_implied_baseline: {
                sample_count: 0,
                pnl_usd: 0,
                beats_market_implied_segment_count: 0,
                source: "entry_price_proxy",
                proxy_only: true,
                counts_for_trade_ready_unlock: false,
              },
              next_action:
                "Collect more resolved, source-backed outcomes before trusting best/worst Whale Flow segments.",
              live_order_allowed: false,
            },
            segment_firewall: {
              status: "blocked_segment_firewall",
              verified: false,
              action_counts: { SHADOW_ONLY: 1, INVERSE_FORWARD_TEST: 1, REJECT_DATA_QUALITY: 1 },
              adverse_watchlist_segment_count: 2,
              uncovered_adverse_watchlist_segment_count: 1,
              next_action:
                "Keep all Whale Flow segments shadow-only until the firewall has powered, fill-realistic, taxonomy-clean evidence.",
              live_order_allowed: false,
            },
            adverse_abstention: {
              status: "adverse_abstention_actions_ready",
              verified: false,
              schema_passed: true,
              abstention_action_count: 2,
              inverse_forward_test_segment_count: 1,
              powered_pause_segment_count: 1,
              shadow_only_watch_segment_count: 1,
              no_trade_baseline_pnl_usd: 0,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_as_paper_decision: false,
              affects_live_routing: false,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            tail_fade_tournament: {
              status: "blocked_tail_fade_tournament",
              verified: false,
              global_flip_allowed: false,
              segment_competition_count: 2,
              tail_live_relevant_after_cost_pnl_usd: 0,
              tail_pnl_source: "live_relevant_forward_paper",
              late_backfill_decision_count: 2,
              random_baseline_expected_pnl_usd: 0,
              random_baseline_sample_count: 0,
              tail_beats_random_baseline: false,
              market_implied_baseline_pnl_usd: 0,
              market_implied_baseline_sample_count: 0,
              market_implied_baseline_source: "entry_price_proxy",
              market_implied_baseline_proxy_only: true,
              tail_beats_market_implied_baseline: false,
              baseline_checks: {
                tail_live_relevant_after_cost_pnl_usd: 0,
                tail_beats_random_baseline: false,
                tail_beats_market_implied_baseline: false,
                market_implied_baseline_proxy_only: true,
              },
              next_action:
                "Run only segment-scoped forward paper tail-vs-fade tests; never apply a global flip.",
              live_order_allowed: false,
            },
            inverse_exploration_governor: {
              status: "inverse_exploration_underpowered_watch",
              verified: false,
              schema_passed: true,
              governor_action: "SHADOW_ONLY",
              action_reason:
                "Forward tailing is failing baselines or inverse candidates exist, but evidence is underpowered.",
              evidence_tier: "source_backed_underpowered_inverse_hypothesis",
              segment_scope: "segment_scoped_only",
              candidate_segment_count: 1,
              powered_candidate_segment_count: 0,
              underpowered_candidate_segment_count: 1,
              tail_loses_baselines: true,
              global_flip_allowed: false,
              inverse_forward_testing_allowed: true,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_for_training_label: false,
              affects_live_routing: false,
              candidate_segments: [
                {
                  segment_id:
                    "KXWCTEAMTOTAL|price:60-79|spread:0-2|liquidity:deep|size:small|time_to_close:<1h",
                  governor_action: "INVERSE_FORWARD_TEST",
                  live_order_allowed: false,
                },
              ],
              next_action:
                "Forward-test only powered segment-scoped inverse hypotheses in paper; otherwise keep abstaining and collecting evidence.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            inverse_diagnostics: {
              status: "insufficient_sample",
              verified: false,
              inverse_decision_count: 3,
              resolved_count: 0,
              inverse_net_pnl_usd: 0,
              next_action:
                "Use inverse/fade only as a paper baseline until enough source-backed outcomes resolve.",
              live_order_allowed: false,
            },
            outcome_velocity: {
              status: "pending_realistic_fill_outcomes",
              verified: false,
              pending_count: 3,
              resolved_count: 1,
              realistic_pending_count: 1,
              unfillable_pending_count: 1,
              unknown_fill_pending_count: 1,
              resolved_realistic_count: 0,
              resolved_unfillable_count: 1,
              label_unlock_pending_count: 1,
              next_action:
                "Prioritize read-only outcome probes for realistic-fill pending decisions.",
              live_order_allowed: false,
            },
            realistic_outcome_unlock: {
              status: "blocked_read_only_outcome_fetch",
              verified: false,
              pending_realistic_label_count: 1,
              resolved_realistic_count: 0,
              checked_count: 1,
              fetch_failed_count: 1,
              retryable_fetch_failed_count: 1,
              source_error_type_counts: {
                KalshiReadError: 1,
              },
              blocker_counts: {
                market_fetch_failed: 1,
              },
              top_pending_realistic_decisions: [
                {
                  decision_id: "paper:whale-flow:pending-realistic-1",
                  market_ticker: "KXGAME-26",
                  expected_resolution_priority: "high_quick_resolution_candidate",
                  realistic_fill: true,
                  source_depth_available: true,
                  live_order_allowed: false,
                },
              ],
              top_failed_realistic_fetches: [
                {
                  decision_id: "paper:whale-flow:pending-realistic-1",
                  market_ticker: "KXGAME-26",
                  status: "market_fetch_failed",
                  source_error_type: "KalshiReadError",
                  source_error_retryable: true,
                  live_order_allowed: false,
                },
              ],
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              affects_live_routing: false,
              next_action:
                "Restore read-only Kalshi market fetch/auth/network and rerun outcome probe for realistic-fill markets.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            trade_ready_gate: {
              status: "blocked_trade_ready_gate",
              verified: false,
              blockers: ["profitability_gate_not_passed", "fill_realism_not_verified"],
              next_action:
                "Keep Whale Flow shadow-only until every blocker clears and a separate explicit live-order approval is given.",
              live_order_allowed: false,
            },
            live_canary_preflight: {
              status: "blocked_exact_canary_eligibility",
              verified: false,
              dry_run_only: true,
              conditional_live_canary_approval_recorded: true,
              approval_terms: {
                max_order_usd: 1,
                daily_loss_cap_usd: 5,
                limit_orders_only: true,
                market_orders_allowed: false,
                rfq_allowed: false,
                funds_movement_allowed: false,
                api_key_mutation_allowed: false,
                scaling_allowed: false,
              },
              dry_run_order_intent: {
                intent_available: false,
                order_type: "limit",
                max_order_usd: 1,
                daily_loss_cap_usd: 5,
                submit_allowed: false,
                submit_blocker: "dry_run_only_no_order_endpoint_called",
              },
              blockers: ["trade_ready_gate_not_passed", "exact_order_parameters_missing"],
              next_action:
                "Do not place live orders. Resolve exact canary blockers; current state is review-only and dry-run-only.",
              live_order_allowed: false,
            },
            evidence_dataset: {
              status: "blocked_insufficient_training_rows",
              verified: true,
              total_rows: 3,
              labeled_rows: 0,
              training_label_rows: 0,
              source_backed_unusable_label_rows: 1,
              pending_realistic_label_rows: 1,
              resolved_unfillable_label_rows: 1,
              label_blocker_counts: {
                pending_realistic_fill_outcome: 1,
                source_backed_but_unrealistic_fill: 1,
              },
              rejected_rows: 1,
              live_order_allowed: false,
            },
            feature_store: {
              status: "blocked_feature_store_underpowered",
              verified: false,
              record_count: 3,
              source_backed_label_count: 0,
              usable_training_label_count: 0,
              source_backed_unrealistic_label_count: 1,
              pending_realistic_label_count: 1,
              minimum_training_rows: 50,
              live_order_allowed: false,
            },
            sts_adapter: {
              status: "paper_only_sts_adapter_ready",
              verified: true,
              accepted_record_count: 3,
              rejected_record_count: 0,
              feature_log_record_count: 3,
              segment_count: 2,
              action_counts: {
                SHADOW_ONLY: 2,
                ACCEPT_EXPLORATION: 1,
              },
              live_routing_allowed: false,
              sts_weight_change_allowed: false,
              next_action:
                "Expose Whale Flow as an STS paper-only input lane; do not change STS weights or live authority.",
              live_order_allowed: false,
              auto_live_promotion_allowed: false,
            },
            capacity_abstention_value: {
              status: "capacity_abstention_value_ready",
              governor_action: "SHADOW_ONLY",
              interpretation: "abstention_avoided_hypothetical_loss",
              resolved_count: 2,
              pending_count: 5,
              hypothesis_only_pnl_if_traded_usd: -0.5,
              avoided_loss_usd: 0.5,
              missed_gain_usd: 0,
              hypothesis_only_loss_rate: 0.5,
              sample_powered: false,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              affects_live_routing: false,
              blockers: [
                "capacity_observation_outcomes_pending",
                "capacity_abstention_value_underpowered",
              ],
              next_action:
                "Treat avoided loss as abstention evidence only; keep collecting resolved capacity observations without counting them as executed paper.",
            },
            capacity_sizing_hypothesis: {
              status: "blocked_capacity_sizing_hypothesis",
              governor_action: "SHADOW_ONLY",
              action_reason:
                "Capacity sizing remains shadow-only until source-backed capacity-abstention evidence is positive and sample-powered.",
              evidence_tier: "underpowered_or_negative_capacity_sizing_hypothesis",
              resolved_count: 2,
              pending_count: 5,
              missed_gain_usd: 0,
              sample_powered: false,
              recommended_experiment: null,
              recommended_experiment_lane: null,
              recommended_cap_multipliers: [],
              paper_cap_change_allowed: false,
              live_cap_change_allowed: false,
              counts_for_trade_ready_unlock: false,
              affects_live_routing: false,
              blockers: [
                "capacity_sizing_hypothesis_underpowered",
                "no_positive_capacity_sizing_hypothesis_pnl",
              ],
              cautions: ["capacity_observation_outcomes_pending"],
              next_action:
                "Keep resolving capacity-blocked observations and rerun this receipt; do not change paper or live caps.",
            },
            ml_governor: {
              status: "blocked_insufficient_training_rows",
              verified: false,
              training_label_rows: 0,
              paper_routing_allowed: false,
              live_order_allowed: false,
            },
            mlx_diagnostic: {
              status: "blocked_mlx_runtime_not_enabled",
              verified: false,
              research_only: true,
              next_action: "Research-only; not allowed to route paper or live trades.",
              live_order_allowed: false,
            },
            profitability_firewall: {
              status: "blocked_profitability_firewall",
              verified: false,
              blockers: ["profitability_gate_not_passed"],
              baseline_checks: {
                tail_live_relevant_after_cost_pnl_usd: 0,
                tail_pnl_source: "live_relevant_forward_paper",
                live_relevant_realistic_fill_count: 0,
                late_backfill_decision_count: 2,
                tail_beats_random_baseline: false,
                tail_beats_market_implied_baseline: false,
                market_implied_baseline_proxy_only: true,
              },
              next_action:
                "Requires realistic fills, after-cost edge, baseline wins, and model proof.",
              live_order_allowed: false,
            },
            paper_governor: {
              schema_version: "whale_flow_paper_governor_v1",
              validator_id: "whale_flow_paper_governor",
              status: "paper_governor_forward_tail_paused",
              schema_passed: true,
              verified: false,
              governor_action: "SHADOW_ONLY",
              action_reason:
                "forward_tail_paused_until_tail_beats_no_trade_inverse_random_and_market_baselines_after_costs",
              evidence_tier: "source_backed_negative_after_cost_or_baseline_failure",
              forward_tail_materialization_allowed: false,
              shadow_logging_allowed: true,
              inverse_forward_testing_allowed: true,
              outcome_grading_allowed: true,
              reason_codes: [
                "negative_or_zero_live_relevant_after_cost_pnl",
                "tail_does_not_beat_no_trade_baseline",
              ],
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              affects_live_routing: false,
              next_action:
                "Keep collecting public flow and outcomes, but do not add new forward-tail paper decisions until the paper governor clears.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            tail_loss_diagnosis: {
              schema_version: "whale_flow_tail_loss_diagnosis_v1",
              validator_id: "whale_flow_tail_loss_diagnosis",
              status: "tail_loss_diagnosis_ready",
              schema_passed: true,
              verified: true,
              governor_action: "SHADOW_ONLY",
              action_reason:
                "forward_tail_loss_or_baseline_failure_requires_segment_scoped_abstention",
              evidence_tier: "source_backed_underpowered_tail_loss_diagnosis",
              baseline_checks: {
                sample_count: 2,
                tail_after_cost_pnl_usd: -0.75,
                inverse_after_cost_pnl_usd: 0.25,
                no_trade_pnl_usd: 0,
                tail_beats_no_trade_baseline: false,
                tail_beats_inverse_baseline: false,
                tail_beats_random_baseline: false,
                tail_beats_market_implied_baseline: false,
                market_implied_baseline_proxy_only: true,
              },
              cohort_count: 1,
              underpowered_loss_cohort_count: 1,
              underpowered_inverse_candidate_count: 1,
              powered_pause_segment_count: 0,
              action_counts: { SHADOW_ONLY: 1 },
              root_cause_counts: {
                tail_after_cost_pnl_negative: 1,
                inverse_baseline_beats_tail: 1,
              },
              top_loss_cohorts: [
                {
                  segment_id: "test_segment",
                  sample_count: 2,
                  tail_after_cost_pnl_usd: -0.75,
                  inverse_after_cost_pnl_usd: 0.25,
                  governor_action: "SHADOW_ONLY",
                },
              ],
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_for_training_label: false,
              affects_live_routing: false,
              paper_only: true,
              next_action:
                "Keep Whale Flow shadow-only and investigate losing cohorts before allowing forward-tail paper expansion.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            adverse_selection: {
              status: "blocked_adverse_selection_underpowered",
              verified: false,
              decision_count: 3,
              raw_trade_count: 106,
              segment_summary_count: 2,
              powered_adverse_segment_count: 0,
              underpowered_adverse_segment_count: 2,
              horizons_seconds: [60, 300, 900, 3600],
              source_backed_horizons_seconds: [60, 300, 900, 3600],
              missing_horizons_seconds: [],
              underpowered_horizons_seconds: [60, 300, 900, 3600],
              source_backed_horizon_count: 4,
              missing_horizon_count: 0,
              underpowered_horizon_count: 4,
              adverse_horizons_seconds: [60],
              horizon_summaries: [
                {
                  horizon_seconds: 60,
                  sample_count: 2,
                  adverse_count: 1,
                  favorable_count: 1,
                  average_selected_side_delta_cents: -0.5,
                  adverse_rate: 0.5,
                },
              ],
              live_order_allowed: false,
            },
            entry_timing: {
              status: "entry_timing_delay_hypothesis_available",
              verified: true,
              schema_passed: true,
              source_adverse_selection_status: "blocked_adverse_selection_underpowered",
              source_backed_horizon_count: 4,
              powered_horizon_count: 4,
              immediate_horizon_seconds: 60,
              immediate_adverse_rate: 0.5094,
              instant_entry_status: "instant_entry_adverse_selection_risk",
              instant_entry_risk: true,
              best_delay_horizon_seconds: 300,
              best_delay_favorable_rate: 0.5224,
              best_delay_adverse_rate: 0.3134,
              best_delay_average_selected_side_delta_cents: 4.58,
              best_delay_favorable_edge_count: 14,
              delayed_entry_hypothesis_available: true,
              paper_only_forward_test_recommended: true,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              affects_live_routing: false,
              paper_only: true,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            entry_timing_observations: {
              status: "entry_timing_observations_ready",
              verified: true,
              schema_passed: true,
              record_count: 4,
              accepted_record_count: 4,
              rejected_record_count: 0,
              source_backed_observation_count: 4,
              improved_entry_count: 3,
              worse_entry_count: 1,
              flat_entry_count: 0,
              average_delayed_entry_price_improvement_cents: 2.25,
              average_delayed_selected_side_delta_cents: -2.25,
              best_delay_horizon_seconds: 300,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_for_training_label: false,
              counts_as_paper_decision: false,
              affects_live_routing: false,
              paper_only: true,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            entry_timing_segments: {
              status: "entry_timing_segments_ready",
              verified: true,
              schema_passed: true,
              segment_count: 2,
              powered_segment_count: 1,
              underpowered_segment_count: 1,
              delay_improved_segment_count: 1,
              delay_worse_segment_count: 1,
              average_delayed_entry_price_improvement_cents: -0.5,
              global_action: "no_global_delay_rule",
              global_delay_rule_allowed: false,
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_as_paper_decision: false,
              affects_live_routing: false,
              paper_only: true,
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            entry_timing_governor: {
              status: "entry_timing_governor_underpowered_hypothesis_watch",
              verified: true,
              schema_passed: true,
              governor_action: "SHADOW_ONLY",
              action_reason:
                "Delayed entry improved some segments, but only with underpowered evidence; no paper routing change is allowed yet.",
              evidence_tier: "source_backed_underpowered_timing_hypothesis",
              segment_scope: "segment_scoped_only",
              powered_delayed_entry_candidate_count: 0,
              underpowered_delayed_entry_candidate_count: 1,
              rejected_delay_segment_count: 1,
              global_delay_rule_allowed: false,
              source_global_delay_rule_allowed: false,
              delayed_entry_forward_test_allowed: false,
              instant_entry_policy: "PAUSE_FORWARD_TAIL_PAPER",
              counts_for_trade_ready_unlock: false,
              counts_for_profitability_gate: false,
              counts_for_training_label: false,
              counts_as_paper_decision: false,
              affects_live_routing: false,
              paper_only: true,
              next_action:
                "Keep collecting source-backed timing observations until a segment has enough powered delayed-entry evidence.",
              live_order_allowed: false,
              live_trading_enabled: false,
              write_capable_kalshi_endpoint_called: false,
            },
            rejection_reasons: {},
            unsafe_true_flags: [],
            next_action:
              "Run an approved public-trades WebSocket/REST canary, enrich with orderbook spread/drift, and keep all output paper-only.",
            live_order_allowed: false,
          },
          live_order_allowed: false,
        },
        leader_lanes: [
          {
            lane_id: "foster_exact_fill_shadow",
            leader_name: "Foster McCoy",
            leader_alias: "Foster",
            source_id: "leader-alpha",
            lane_type: "exact_fill_shadow",
            copy_mode: "exact_fill_when_verified",
            source_status: "enabled",
            verification_status: "verified",
            enabled: true,
            exact_copy: true,
            requires_exact_opt_in_source: true,
            copyable_now: true,
            signals_seen: 12,
            eligible_shadow_signals: 9,
            resolved_signals: 4,
            net_shadow_pnl_usd: 2.35,
            blockers: [],
            live_order_allowed: false,
          },
          {
            lane_id: "caleb_public_strategy_shadow",
            leader_name: "Caleb Davies",
            leader_alias: "Caleb",
            source_id: "caleb-public-strategy",
            lane_type: "public_strategy_shadow",
            copy_mode: "public_strategy_not_exact_copy",
            source_status: "disabled_pending_public_signal_intake",
            verification_status: "public_strategy_candidate_unverified",
            enabled: false,
            exact_copy: false,
            requires_exact_opt_in_source: false,
            requires_source_url: true,
            manipulation_risk_filter_required: true,
            copyable_now: false,
            signals_seen: 0,
            eligible_shadow_signals: 0,
            resolved_signals: 0,
            net_shadow_pnl_usd: 0,
            blockers: [
              "public_signal_intake_not_configured",
              "manipulation_risk_filter_not_verified",
            ],
            live_order_allowed: false,
          },
          {
            lane_id: "whale_flow_shadow",
            leader_name: "Public Kalshi Whale Flow",
            leader_alias: "Whale Flow",
            source_id: "kalshi_public_trades",
            lane_type: "public_market_flow_shadow",
            copy_mode: "public_market_flow_not_named_trader",
            source_status: "shadow_scaffold_ready",
            verification_status: "public_market_flow_not_named_trader",
            enabled: false,
            exact_copy: false,
            requires_exact_opt_in_source: false,
            requires_source_url: false,
            manipulation_risk_filter_required: true,
            copyable_now: false,
            signals_seen: 0,
            eligible_shadow_signals: 0,
            resolved_signals: 0,
            net_shadow_pnl_usd: 0,
            blockers: ["real_public_trade_collection_not_started"],
            live_order_allowed: false,
          },
        ],
        sources: [
          {
            source_id: "leader-alpha",
            lane_id: "foster_exact_fill_shadow",
            leader_name: "Foster McCoy",
            leader_handle: "leader_alpha",
            source_type: "exact_opt_in_fill",
            verification_status: "verified",
            source_status: "enabled",
            exact_fill: true,
            enabled: true,
            signals_seen: 12,
            live_order_allowed: false,
          },
          {
            source_id: "caleb-public-strategy",
            lane_id: "caleb_public_strategy_shadow",
            leader_name: "Caleb Davies",
            source_type: "public_strategy_signal",
            verification_status: "public_strategy_candidate_unverified",
            source_status: "disabled_pending_public_signal_intake",
            exact_fill: false,
            enabled: false,
            signals_seen: 0,
            live_order_allowed: false,
          },
        ],
        readiness_gates: [
          {
            gate_id: "exact_opt_in_source",
            label: "Exact opt-in fill source",
            status: "passed",
            detail: "Configured.",
            live_order_allowed: false,
          },
        ],
        next_action: "Keep collecting shadow signals.",
        plain_english: "Copy-leader shadow mode is active.",
        live_order_allowed: false,
      },
    };

    render(renderKalshiDashboard(createProps({ snapshot })), container);

    expect(container.textContent).toContain("Copy Shadow");
    expect(container.textContent).toContain("Copy-Leader Paper Lanes");
    expect(container.textContent).toContain("Source Health");
    expect(container.textContent).toContain("Foster Relay");
    expect(container.textContent).toContain("Caleb Public Signal");
    expect(container.textContent).toContain("Signal Log");
    expect(container.textContent).toContain("Whale Flow");
    expect(container.textContent).toContain("Whale Signals");
    expect(container.textContent).toContain("106");
    expect(container.textContent).toContain("3 eligible · 103 skipped");
    expect(container.textContent).toContain("Whale Signal Ledger");
    expect(container.textContent).toContain("present");
    expect(container.textContent).toContain("106 persisted · 106 derived");
    expect(container.textContent).toContain("14000 ms");
    expect(container.textContent).toContain("Spread 6.700¢");
    expect(container.textContent).toContain("Whale Collector");
    expect(container.textContent).toContain("blocked_placeholder_collector_bounds");
    expect(container.textContent).toContain("Collector Freshness");
    expect(container.textContent).toContain("stale_collector_source");
    expect(container.textContent).toContain("Source age 901s");
    expect(container.textContent).toContain("Collector Coverage");
    expect(container.textContent).toContain("stopped_before_approved_duration");
    expect(container.textContent).toContain("747 / 10080 approved runs");
    expect(container.textContent).toContain("7.4% complete");
    expect(container.textContent).toContain("9333 remaining");
    expect(container.textContent).toContain("trade-ready proof no");
    expect(container.textContent).toContain("Evidence Refresh");
    expect(container.textContent).toContain("completed_bounded_evidence_refresh");
    expect(container.textContent).toContain("Runtime cap 300s");
    expect(container.textContent).toContain("raw-signal backlog 42");
    expect(container.textContent).toContain("signal-paper backlog 10");
    expect(container.textContent).toContain("paper-outcome backlog 2");
    expect(container.textContent).toContain(
      "2 runs · 12 signals · 2 paper · 2 features · 1 post-outcome runs",
    );
    expect(container.textContent).toContain("Active running_bounded_evidence_refresh");
    expect(container.textContent).toContain("process alive yes");
    expect(container.textContent).toContain("PID 79034");
    expect(container.textContent).toContain("latest run 3 age 41s");
    expect(container.textContent).toContain("Backlog reducer bounded_backlog_reducer_completed");
    expect(container.textContent).toContain(
      "Priority depth read_only_priority_source_depth_repair_completed",
    );
    expect(container.textContent).toContain("2 appended / 6 priority");
    expect(container.textContent).toContain("Outcome cadence read_only_outcome_cadence_completed");
    expect(container.textContent).toContain("Trade packet blocked_trade_ready_packet");
    expect(container.textContent).toContain("Continue bounded foreground evidence refresh");
    expect(container.textContent).toContain("Whale Autopilot");
    expect(container.textContent).toContain("bounded_autopilot_once_completed");
    expect(container.textContent).toContain("1 run(s) · 7 signals · 1 paper · 2 depth");
    expect(container.textContent).toContain("Active refresh running_bounded_evidence_refresh");
    expect(container.textContent).toContain("Active running_bounded_autopilot");
    expect(container.textContent).toContain("PID 63627");
    expect(container.textContent).toContain("alive yes");
    expect(container.textContent).toContain("run 4 age 42s");
    expect(container.textContent).toContain("elapsed 18.50s");
    expect(container.textContent).toContain("next 2026-07-01T12:10:00Z");
    expect(container.textContent).toContain("active failed 0");
    expect(container.textContent).toContain("failed 0");
    expect(container.textContent).toContain("Whale Outcomes");
    expect(container.textContent).toContain("0 resolved");
    expect(container.textContent).toContain("3 pending");
    expect(container.textContent).toContain("Paper Capacity");
    expect(container.textContent).toContain("$25.00 / $25.00");
    expect(container.textContent).toContain(
      "103 fresh forward-eligible signals blocked by paper exposure",
    );
    expect(container.textContent).toContain("trade-ready proof no");
    expect(container.textContent).toContain("Sample KXTEST-26 yes @ 50¢");
    expect(container.textContent).toContain("4 blocked by segment firewall");
    expect(container.textContent).toContain("status blocked segment firewall");
    expect(container.textContent).toContain("Sample KXTEST-26 SHADOW ONLY prefix");
    expect(container.textContent).toContain("3 unresolved paper decisions consume capacity");
    expect(container.textContent).toContain("largest $4.70");
    expect(container.textContent).toContain("oldest 3899s");
    expect(container.textContent).toContain(
      "pending_source_backed_outcomes_consuming_paper_capacity",
    );
    expect(container.textContent).toContain("Pending sample KXPENDING-26 no $4.70");
    expect(container.textContent).toContain("7 zero-notional capacity observations");
    expect(container.textContent).toContain("appended 2");
    expect(container.textContent).toContain("trade-ready no");
    expect(container.textContent).toContain("profitability no");
    expect(container.textContent).toContain("2 settled capacity observations");
    expect(container.textContent).toContain("5 pending");
    expect(container.textContent).toContain("hypothesis P&L -$0.50");
    expect(container.textContent).toContain("Capacity abstention capacity_abstention_value_ready");
    expect(container.textContent).toContain("avoided loss $0.50");
    expect(container.textContent).toContain("if-traded hypothesis -$0.50");
    expect(container.textContent).toContain("2 resolved");
    expect(container.textContent).toContain("powered no");
    expect(container.textContent).toContain("live routing no");
    expect(container.textContent).toContain("Capacity sizing blocked_capacity_sizing_hypothesis");
    expect(container.textContent).toContain("experiment none");
    expect(container.textContent).toContain("paper cap change no");
    expect(container.textContent).toContain("live cap change no");
    expect(container.textContent).toContain("training no");
    expect(container.textContent).toContain("paper decisions no");
    expect(container.textContent).toContain("7 stale skipped by 300s forward gate");
    expect(container.textContent).toContain("max_open_exposure_reached 103");
    expect(container.textContent).toContain("Whale Profit Review");
    expect(container.textContent).toContain("blocked_insufficient_resolved_history");
    expect(container.textContent).toContain("Fill Realism");
    expect(container.textContent).toContain("blocked_fill_realism_unverified");
    expect(container.textContent).toContain(
      "v5 · 0 realistic · 0 forward-realistic · 2 late-backfill · 3 missed · 1 aggressive-limit · 2 depth-matched",
    );
    expect(container.textContent).toContain("Fill Quality");
    expect(container.textContent).toContain("0.0% forward fill rate");
    expect(container.textContent).toContain(
      "1 forward of 3 decisions · 1 forward missed/unverified · 0 late-backfill realistic excluded · depth coverage 66.7% · near-signal depth 33.3% (1 verified / 1 stale or missing timing, p95 lag 60s, max allowed 5s)",
    );
    expect(container.textContent).toContain("forward reasons orderbook_depth_unverified 1");
    expect(container.textContent).toContain(
      "all reasons orderbook_depth_unverified 2, best_ask_above_limit_price 1",
    );
    expect(container.textContent).toContain("Fill Evidence Gaps");
    expect(container.textContent).toContain("blocked_forward_fill_evidence_gaps");
    expect(container.textContent).toContain(
      "1 forward gap(s), 0 source-backed missed fill(s), of 1",
    );
    expect(container.textContent).toContain("1 need source-backed depth");
    expect(container.textContent).toContain("reasons orderbook_depth_unverified 1");
    expect(container.textContent).toContain("sample KXDEPTH-26 yes orderbook_depth_unverified");
    expect(container.textContent).toContain(
      "Prioritize source-backed near-signal depth capture for forward decisions missing executable-depth proof.",
    );
    expect(container.textContent).toContain("Fill Gap Governor");
    expect(container.textContent).toContain("REJECT_DATA_QUALITY");
    expect(container.textContent).toContain("fill_gap_governor_quarantined_unverified_depth");
    expect(container.textContent).toContain("evidence source_depth_gap_quarantine");
    expect(container.textContent).toContain("scope forward_fill_evidence");
    expect(container.textContent).toContain("unverified gaps 1");
    expect(container.textContent).toContain("quarantined 1");
    expect(container.textContent).toContain("live-relevant evidence no");
    expect(container.textContent).toContain("training no");
    expect(container.textContent).toContain("live routing no");
    expect(container.textContent).toContain(
      "Some forward paper decisions lack source-backed signal-time depth, so they are quarantined as evidence gaps.",
    );
    expect(container.textContent).toContain(
      "Continue source-depth collection and require future paper decisions to have signal-time depth proof before they count live-relevant.",
    );
    expect(container.textContent).toContain("Live-Relevant P&L");
    expect(container.textContent).toContain("Only forward, near-signal realistic fills count here");
    expect(container.textContent).toContain("Quarantined after-cost P&L -$0.13");
    expect(container.textContent).toContain("Orderbook Stream");
    expect(container.textContent).toContain("blocked_orderbook_stream_not_collected");
    expect(container.textContent).toContain("0 records · 0 markets · 0 source-backed");
    expect(container.textContent).toContain("Source Depth");
    expect(container.textContent).toContain("source_depth_available");
    expect(container.textContent).toContain(
      "3 records · 3 source-backed · 1 aggressive-limit · 1 usable · 0 queue-verified",
    );
    expect(container.textContent).toContain("Market Metadata");
    expect(container.textContent).toContain("market_metadata_source_backed_timing_available");
    expect(container.textContent).toContain(
      "2 records · 2 tickers · 2 source-backed · 1 source-backed timings · 1 missing timing",
    );
    expect(container.textContent).toContain("Quick Settling");
    expect(container.textContent).toContain("blocked_quick_settling_source_timing");
    expect(container.textContent).toContain(
      "2 pending candidates · 0 quick candidates · 0 source-backed timings · 2 unknown timing",
    );
    expect(container.textContent).toContain("Time-To-Close Evidence");
    expect(container.textContent).toContain("blocked_time_to_close_source_timing");
    expect(container.textContent).toContain("0 source-backed · 2 unknown");
    expect(container.textContent).toContain("missing_resolution_target_time 2");
    expect(container.textContent).toContain("Market Context");
    expect(container.textContent).toContain("blocked_market_context_taxonomy");
    expect(container.textContent).toContain("2 unknown taxonomy ticker(s)");
    expect(container.textContent).toContain("Segment / Fade");
    expect(container.textContent).toContain(
      "2 segments · 0 forward resolved · 2 late-backfill · fade cohort $0.00 (0) · global inverse $0.00",
    );
    expect(container.textContent).toContain("No-Trade Baseline");
    expect(container.textContent).toContain(
      "2 abstain segment(s) · 0 beat no-trade · 0 beat random · 0 beat market-proxy",
    );
    expect(container.textContent).toContain("Segment Actions");
    expect(container.textContent).toContain("2 blocked");
    expect(container.textContent).toContain("0 promotion candidates");
    expect(container.textContent).toContain("actions SHADOW_ONLY 2");
    expect(container.textContent).toContain("confidence underpowered 2");
    expect(container.textContent).toContain(
      "abstention insufficient_fill_realistic_segment_sample 2",
    );
    expect(container.textContent).toContain("family sports_or_live_game 2");
    expect(container.textContent).toContain("side side:yes 2");
    expect(container.textContent).toContain("price 00-19 1");
    expect(container.textContent).toContain("spread 0-2 2");
    expect(container.textContent).toContain("size size:small 2");
    expect(container.textContent).toContain("liquidity:unknown 1");
    expect(container.textContent).toContain("time time_to_close:unknown 2");
    expect(container.textContent).toContain("prefix KXMLBGAME 2");
    expect(container.textContent).toContain("top KXMLBGAME|price:00-19");
    expect(container.textContent).toContain("Segment Firewall");
    expect(container.textContent).toContain("blocked_segment_firewall");
    expect(container.textContent).toContain(
      "2 adverse watch segment(s) · 1 not yet in resolved segment P&L",
    );
    expect(container.textContent).toContain(
      "abstention 2 (1 pause, 1 shadow-only, 1 inverse adverse, 1 inverse tests, 1 quality rejects, adverse_abstention_actions_ready)",
    );
    expect(container.textContent).toContain("no-trade baseline $0.00");
    expect(container.textContent).toContain("abstention trade-ready no");
    expect(container.textContent).toContain("abstention profitability no");
    expect(container.textContent).toContain("abstention live routing no");
    expect(container.textContent).toContain("Tail vs Fade");
    expect(container.textContent).toContain("blocked_tail_fade_tournament");
    expect(container.textContent).toContain(
      "No global flip · 2 segment competitions · $0.00 forward P&L · 2 late-backfill excluded · random blocked · market-proxy blocked",
    );
    expect(container.textContent).toContain("Inverse Exploration");
    expect(container.textContent).toContain("inverse_exploration_underpowered_watch");
    expect(container.textContent).toContain(
      "1 candidate segment(s) · 0 powered · 1 underpowered · tail loses baselines yes · global flip no · inverse tests on · trade-ready no · profitability no · training no · live routing no",
    );
    expect(container.textContent).toContain(
      "KXWCTEAMTOTAL|price:60-79|spread:0-2|liquidity:deep|size:small|time_to_close:<1h INVERSE FORWARD TEST",
    );
    expect(container.textContent).toContain(
      "Forward-test only powered segment-scoped inverse hypotheses in paper; otherwise keep abstaining and collecting evidence.",
    );
    expect(container.textContent).toContain("Adverse Selection");
    expect(container.textContent).toContain("blocked_adverse_selection_underpowered");
    expect(container.textContent).toContain(
      "3 decisions · 106 raw trades · checked windows 4 · source-backed 4 · underpowered 4 · missing 0 · adverse windows 1 · 2 segments · 0 powered adverse · 2 underpowered watch",
    );
    expect(container.textContent).toContain("Entry Timing");
    expect(container.textContent).toContain("entry_timing_delay_hypothesis_available");
    expect(container.textContent).toContain("instant instant_entry_adverse_selection_risk");
    expect(container.textContent).toContain("immediate 60s adverse 50.9%");
    expect(container.textContent).toContain("best delay 300s");
    expect(container.textContent).toContain("paper-only forward test yes");
    expect(container.textContent).toContain(
      "observations 4 (4 source-backed, entry_timing_observations_ready)",
    );
    expect(container.textContent).toContain("observed delay 300s");
    expect(container.textContent).toContain("entry improvement 2.250c");
    expect(container.textContent).toContain("improved 3 / worse 1");
    expect(container.textContent).toContain("observation trade-ready no");
    expect(container.textContent).toContain("observation profitability no");
    expect(container.textContent).toContain("observation live routing no");
    expect(container.textContent).toContain(
      "segment timing 2 (1 powered, 1 underpowered, entry_timing_segments_ready)",
    );
    expect(container.textContent).toContain("segment improvement -0.5000c");
    expect(container.textContent).toContain("segment improved 1 / worse 1");
    expect(container.textContent).toContain("global action no_global_delay_rule");
    expect(container.textContent).toContain("global delay rule no");
    expect(container.textContent).toContain("segment trade-ready no");
    expect(container.textContent).toContain("segment profitability no");
    expect(container.textContent).toContain("segment live routing no");
    expect(container.textContent).toContain("trade-ready no");
    expect(container.textContent).toContain("profitability no");
    expect(container.textContent).toContain("live routing no");
    expect(container.textContent).toContain("Entry Timing Governor");
    expect(container.textContent).toContain("SHADOW_ONLY");
    expect(container.textContent).toContain("entry_timing_governor_underpowered_hypothesis_watch");
    expect(container.textContent).toContain("policy PAUSE_FORWARD_TAIL_PAPER");
    expect(container.textContent).toContain("powered delayed candidates 0");
    expect(container.textContent).toContain("underpowered watch 1");
    expect(container.textContent).toContain("rejected delay segments 1");
    expect(container.textContent).toContain("global delay no");
    expect(container.textContent).toContain("source global delay no");
    expect(container.textContent).toContain("delayed forward test no");
    expect(container.textContent).toContain("live routing no");
    expect(container.textContent).toContain("Evidence Dataset");
    expect(container.textContent).toContain(
      "3 rows · 0 training labels · 0 forward labels · 2 backfill labels · 1 pending realistic · 1 resolved unfillable",
    );
    expect(container.textContent).toContain("Outcome Label Queue");
    expect(container.textContent).toContain("pending_realistic_fill_outcomes");
    expect(container.textContent).toContain(
      "1 realistic-fill pending · 1 resolved unfillable quarantined · 1 pending without fill proof",
    );
    expect(container.textContent).toContain("Outcome Probe");
    expect(container.textContent).toContain("read_only_outcome_probe_completed");
    expect(container.textContent).toContain(
      "3 checked · 2 fetch failed · 1 realistic-label fetch failed",
    );
    expect(container.textContent).toContain("market_fetch_failed 1");
    expect(container.textContent).toContain("Realistic Outcome Unlock");
    expect(container.textContent).toContain("blocked_read_only_outcome_fetch");
    expect(container.textContent).toContain(
      "1 pending labels · 0 resolved realistic · 1 fetch failed",
    );
    expect(container.textContent).toContain("KXGAME-26 high_quick_resolution_candidate");
    expect(container.textContent).toContain(
      "KXGAME-26 KalshiReadError dns_resolution_failed:api.elections.kalshi.com retryable",
    );
    expect(container.textContent).toContain(
      "Restore read-only Kalshi market fetch/auth/network and rerun outcome probe for realistic-fill markets.",
    );
    expect(container.textContent).toContain("Feature Store");
    expect(container.textContent).toContain("blocked_feature_store_underpowered");
    expect(container.textContent).toContain("3 rows · 0 source-backed · 0 usable training labels");
    expect(container.textContent).toContain("STS Input Lane");
    expect(container.textContent).toContain("paper_only_sts_adapter_ready");
    expect(container.textContent).toContain("3 accepted · 0 rejected · 2 segments");
    expect(container.textContent).toContain("ACCEPT_EXPLORATION 1");
    expect(container.textContent).toContain("SHADOW_ONLY 2");
    expect(container.textContent).toContain("Live routing blocked; STS weight changes blocked");
    expect(container.textContent).toContain("ML Governor");
    expect(container.textContent).toContain("shadow-only");
    expect(container.textContent).toContain("MLX Diagnostic");
    expect(container.textContent).toContain("blocked_mlx_runtime_not_enabled");
    expect(container.textContent).toContain("Profit Firewall");
    expect(container.textContent).toContain("blocked_profitability_firewall");
    expect(container.textContent).toContain(
      "$0.00 forward P&L · 2 late-backfill excluded · random blocked · market proxy-only",
    );
    expect(container.textContent).toContain("P&L Truth Ladder");
    expect(container.textContent).toContain("pnl_truth_ladder_ready");
    expect(container.textContent).toContain(
      "all-shadow $2.35 · realistic -$0.13 · live-relevant $0.00 · forward gate $0.00 · inverse/fade $0.25 · headline live-tradable no",
    );
    expect(container.textContent).toContain("Evidence Acceleration");
    expect(container.textContent).toContain("retryable_read_only_outcome_fetch_failures");
    expect(container.textContent).toContain("repair retryable 1 (market_fetch_failed 1)");
    expect(container.textContent).toContain("quick queue 0");
    expect(container.textContent).toContain(
      "backlog gaps 4 (raw_trade_to_signal_backlog_estimate 12, signal_to_paper_decision_backlog_estimate 10, raw_trade_to_source_depth_backlog_estimate 4)",
    );
    expect(container.textContent).toContain("segment actions SHADOW_ONLY 1");
    expect(container.textContent).toContain("global flip no");
    expect(container.textContent).toContain("delayed entry delayed_entry_forward_test_watch");
    expect(container.textContent).toContain("powered 0 underpowered 1");
    expect(container.textContent).toContain("trade-ready credit no");
    expect(container.textContent).toContain("Paper Governor");
    expect(container.textContent).toContain("SHADOW_ONLY");
    expect(container.textContent).toContain("paper_governor_forward_tail_paused");
    expect(container.textContent).toContain("forward-tail materialization paused");
    expect(container.textContent).toContain("shadow logging on");
    expect(container.textContent).toContain("inverse tests on");
    expect(container.textContent).toContain("live routing no");
    expect(container.textContent).toContain(
      "1 fresh forward-tail signal(s) paused by paper governor",
    );
    expect(container.textContent).toContain("Sample KXTEST-26 SHADOW ONLY");
    expect(container.textContent).toContain(
      "Keep collecting public flow and outcomes, but do not add new forward-tail paper decisions until the paper governor clears.",
    );
    expect(container.textContent).toContain("Tail Loss Diagnosis");
    expect(container.textContent).toContain("tail_loss_diagnosis_ready");
    expect(container.textContent).toContain("2 live-relevant sample(s)");
    expect(container.textContent).toContain("tail -$0.75");
    expect(container.textContent).toContain("inverse $0.25");
    expect(container.textContent).toContain("actions SHADOW_ONLY 1");
    expect(container.textContent).toContain("causes inverse_baseline_beats_tail 1");
    expect(container.textContent).toContain(
      "Top loss cohort test segment tail -$0.75 vs inverse $0.25",
    );
    expect(container.textContent).toContain(
      "Keep Whale Flow shadow-only and investigate losing cohorts before allowing forward-tail paper expansion.",
    );
    expect(container.textContent).toContain("Trade Ready Gate");
    expect(container.textContent).toContain("blocked_trade_ready_gate");
    expect(container.textContent).toContain(
      "Blocked by profitability gate not passed, fill realism not verified.",
    );
    expect(container.textContent).toContain("Live Canary Preflight");
    expect(container.textContent).toContain("blocked_exact_canary_eligibility");
    expect(container.textContent).toContain("Approval recorded");
    expect(container.textContent).toContain("max order $1.00");
    expect(container.textContent).toContain("daily cap $5.00");
    expect(container.textContent).toContain("dry-run only");
    expect(container.textContent).toContain("intent blocked");
    expect(container.textContent).toContain(
      "Blocked by trade ready gate not passed, exact order parameters missing.",
    );
    expect(container.textContent).toContain("fixture_schema_passed_real_source_blocked");
    expect(container.textContent).toContain("9 accepted / 12 read");
    expect(container.textContent).toContain("3 accepted / 106 read · 3 paper · 2 quarantined");
    expect(container.textContent).toContain("Foster McCoy");
    expect(container.textContent).toContain("Caleb Davies");
    expect(container.textContent).toContain("Public Kalshi Whale Flow");
    expect(container.textContent).toContain("not exact-copy");
    expect(container.textContent).toContain("public_strategy_not_exact_copy");
    expect(container.textContent).toContain("public_market_flow_not_named_trader");
    expect(container.textContent).toContain("real_public_trade_collection_not_started");
    expect(container.textContent).toContain("manipulation_risk_filter_not_verified");
    expect(container.textContent).toContain("disabled_pending_public_signal_intake");
    expect(container.textContent).toContain("Source Verification");
    expect(container.textContent).toContain("Discovery Receipt");
    expect(container.textContent).toContain("Read-Only Auth");
    expect(container.textContent).toContain("no_verified_exact_opt_in_foster_fill_source");
    expect(container.textContent).toContain("Source Candidate");
    expect(container.textContent).toContain("Kalshi WebSocket Public Trades");
    expect(container.textContent).toContain("Public trades omit trader identity.");
    expect(container.textContent).toContain("Foster opt-in Kalshi WebSocket User Fills");
    expect(container.textContent).toContain("required");
    expect(container.textContent).toContain("Source Receipt Artifact");
    expect(container.textContent).toContain("verified");
    expect(container.textContent).toContain("leader_alpha");
    expect(container.textContent).toContain("exact_opt_in_fill");
    expect(container.textContent).toContain("Resolved Copy Signals");
    expect(container.textContent).toContain("$2.35");
    expect(container.textContent).toContain("14000 ms");
    expect(container.textContent).toContain("Exact opt-in fill source");
    expect(container.textContent).toContain("duplicate_signal_id");
  });

  it("calls refresh when requested", () => {
    const onRefresh = vi.fn();
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps({ onRefresh })), container);
    container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the refresh button available and disabled while loading", () => {
    const container = document.createElement("div");

    render(renderKalshiDashboard(createProps({ loading: true })), container);

    const refresh = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh Kalshi dashboard"]',
    );
    expect(refresh).not.toBeNull();
    expect(refresh?.disabled).toBe(true);
    expect(refresh?.textContent).toContain("Refreshing...");
  });

  it("changes timezone, trend timeframe, and P&L timeframe from dashboard controls", () => {
    const onTimezoneChange = vi.fn();
    const onTimeframeChange = vi.fn();
    const onPnlTimeframeChange = vi.fn();
    const container = document.createElement("div");

    render(
      renderKalshiDashboard(
        createProps({ onTimezoneChange, onTimeframeChange, onPnlTimeframeChange }),
      ),
      container,
    );

    const selects = [...container.querySelectorAll("select")];
    const timezone = selects.find((select) =>
      [...select.options].some((option) => option.value === "America/Chicago"),
    );
    const timeframe = selects.find((select) =>
      [...select.options].some((option) => option.value === "7d"),
    );

    expect(timezone).not.toBeUndefined();
    expect(timeframe).not.toBeUndefined();
    if (!timezone || !timeframe) {
      throw new Error("Expected timezone and timeframe controls to render");
    }

    timezone.value = "America/Chicago";
    timezone.dispatchEvent(new Event("change", { bubbles: true }));
    timeframe.value = "7d";
    timeframe.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onTimezoneChange).toHaveBeenCalledWith("America/Chicago");
    expect(onTimeframeChange).toHaveBeenCalledWith("7d");

    const sixHourPnl = [...container.querySelectorAll(".kalshi-chip")].find(
      (button) => button.textContent?.trim() === "6 hours",
    );
    sixHourPnl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onPnlTimeframeChange).toHaveBeenCalledWith("6h");
  });
});

import { sanitizeTaskStatusText } from "../tasks/task-status.js";
import type { OperationsShadowMonitorState } from "./monitor-state.js";
import { OPERATIONS_SNAPSHOT_STALE_AFTER_MS } from "./status.js";
import type { OperationsFinding, OperationsSourceObservation } from "./types.js";

export type OperationsMonitorHealth = {
  source: OperationsSourceObservation;
  finding?: OperationsFinding;
};

function sourceObservation(
  status: OperationsSourceObservation["status"],
  observedAt: number | null,
): OperationsSourceObservation {
  return observedAt == null ? { status } : { status, observedAt };
}

function monitorFinding(params: {
  now: number;
  state: OperationsShadowMonitorState;
  title: string;
  detail: string;
  disposition: OperationsFinding["disposition"];
  responseState: OperationsFinding["responseState"];
  impact: string;
  ownerId: string;
  nextAction: string;
}): OperationsFinding {
  return {
    id: "process:operations-monitor:health",
    severity: "warning",
    category: "monitor",
    title: params.title,
    detail: params.detail,
    firstObservedAt: params.now,
    lastObservedAt: params.now,
    disposition: params.disposition,
    responseState: params.responseState,
    impact: params.impact,
    ownerId: params.ownerId,
    recommendedAction: params.nextAction,
    nextAction: params.nextAction,
    ...(params.disposition === "watching"
      ? { nextCheckAt: params.now + Math.max(5_000, params.state.intervalMs) }
      : {}),
  };
}

export function deriveOperationsMonitorHealth(
  state: OperationsShadowMonitorState,
  now: number,
): OperationsMonitorHealth {
  const observedAt = state.lastSweepAt ?? state.lastAttemptAt ?? state.startedAt;
  const safeError = sanitizeTaskStatusText(state.lastError, {
    errorContext: true,
    maxChars: 240,
  });

  if (!state.running) {
    return {
      source: sourceObservation("unavailable", observedAt),
      finding: monitorFinding({
        now,
        state,
        title: "Operations monitor is not running",
        detail: "The background Operations monitor is stopped.",
        disposition: "needs_user",
        responseState: "waiting_for_user",
        impact: "New incidents may not be recorded until someone opens the Operations Room.",
        ownerId: "operator",
        nextAction: "Restore the Gateway maintenance loop, then verify a successful monitor sweep.",
      }),
    };
  }

  if (state.lastSweepAt == null) {
    const failed = Boolean(safeError);
    return {
      source: sourceObservation("unavailable", observedAt),
      finding: monitorFinding({
        now,
        state,
        title: failed
          ? "Operations monitor has not completed a sweep"
          : "Operations monitor is starting",
        detail: failed
          ? `No successful sweep is recorded. Last attempt: ${safeError}.`
          : "The monitor is running, but its first successful sweep is not recorded yet.",
        disposition: failed ? "needs_user" : "watching",
        responseState: failed ? "waiting_for_user" : "monitoring",
        impact: "Current incident history cannot yet be confirmed as continuously observed.",
        ownerId: failed ? "operator" : "OpenClaw",
        nextAction: failed
          ? "Inspect the monitor error and restore a successful sweep."
          : "Wait for the next scheduled sweep and verify that it succeeds.",
      }),
    };
  }

  const staleAfterMs = Math.max(
    OPERATIONS_SNAPSHOT_STALE_AFTER_MS,
    Math.max(5_000, state.intervalMs) * 2,
  );
  if (now - state.lastSweepAt > staleAfterMs) {
    return {
      source: sourceObservation("stale", observedAt),
      finding: monitorFinding({
        now,
        state,
        title: "Operations monitor data is stale",
        detail: `The last successful sweep is older than ${Math.ceil(staleAfterMs / 1_000)} seconds.${safeError ? ` Last attempt: ${safeError}.` : ""}`,
        disposition: "watching",
        responseState: "monitoring",
        impact: "Recently changed incidents may be missing from the durable history.",
        ownerId: "OpenClaw",
        nextAction:
          "Verify the next sweep succeeds; inspect the Gateway if freshness does not recover.",
      }),
    };
  }

  if (safeError) {
    return {
      source: sourceObservation("fallback", observedAt),
      finding: monitorFinding({
        now,
        state,
        title: "Latest Operations monitor attempt failed",
        detail: `The most recent successful sweep is retained. Last attempt: ${safeError}.`,
        disposition: "watching",
        responseState: "monitoring",
        impact:
          "Incident history is available, but changes since the failed attempt may be missing.",
        ownerId: "OpenClaw",
        nextAction:
          "Watch the next scheduled attempt and inspect the Gateway if the failure repeats.",
      }),
    };
  }

  return {
    source: sourceObservation("available", observedAt),
  };
}

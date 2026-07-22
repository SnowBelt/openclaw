// Operations Room status and score derivation is pure and deterministic so UI,
// tests, and gateway handlers cannot disagree about operational truth.
import type {
  OperationsActivityState,
  OperationsAttentionState,
  OperationsBriefing,
  OperationsCollectionCount,
  OperationsDuty,
  OperationsFinding,
  OperationsHealthState,
  OperationsSeverity,
  OperationsStatus,
} from "./types.js";

const SEVERITY_DEDUCTION: Record<OperationsSeverity, number> = {
  info: 0,
  warning: 2,
  critical: 8,
};

export const OPERATIONS_RECENT_WORKFLOW_FAILURE_MS = 24 * 60 * 60 * 1_000;
export const OPERATIONS_WORKFLOW_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const OPERATIONS_STALE_QUEUED_WORKFLOW_MS = 24 * 60 * 60 * 1_000;
export const OPERATIONS_SNAPSHOT_STALE_AFTER_MS = 2 * 60 * 1_000;

const findingFirstObservedAt = new Map<string, number>();

export function operationsCollectionCount(total: number, shown: number): OperationsCollectionCount {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeShown = Math.min(safeTotal, Math.max(0, Math.floor(shown)));
  return {
    total: safeTotal,
    shown: safeShown,
    truncated: safeShown < safeTotal,
  };
}

export function deriveOperationsAgentStates(params: {
  duty: OperationsDuty;
  runningTaskCount: number;
  queuedTaskCount: number;
  blockedTaskCount: number;
  recentFailureCount: number;
  sourceAvailable?: boolean;
}): {
  activityState: OperationsActivityState;
  healthState: OperationsHealthState;
  attentionState: OperationsAttentionState;
} {
  const sourceAvailable = params.sourceAvailable !== false;
  let activityState: OperationsActivityState;
  if (!sourceAvailable) {
    activityState = "unknown";
  } else if (params.duty === "disabled") {
    activityState = "off";
  } else if (params.runningTaskCount > 0) {
    activityState = "working";
  } else if (params.queuedTaskCount > 0) {
    activityState = "waiting";
  } else if (params.duty === "scheduled") {
    activityState = "scheduled";
  } else {
    activityState = "ready";
  }

  let healthState: OperationsHealthState;
  let attentionState: OperationsAttentionState;
  if (!sourceAvailable) {
    healthState = "unknown";
    attentionState = "watching";
  } else if (params.blockedTaskCount > 0) {
    healthState = "degraded";
    attentionState = "needs_user";
  } else if (params.recentFailureCount > 0) {
    healthState = "degraded";
    attentionState = "watching";
  } else {
    healthState = "healthy";
    attentionState = "none";
  }

  return { activityState, healthState, attentionState };
}

export function buildDeterministicOperationsBriefing(params: {
  partial: boolean;
  criticalFindings: number;
  needsUserFindings: number;
  handlingFindings: number;
  watchingFindings: number;
  workingAgents: number;
  activeTasks: number;
  activeWorkflows: number;
}): OperationsBriefing {
  if (params.partial) {
    return {
      tone: "unknown",
      text: `Operations data is partial; ${params.workingAgents} agent${params.workingAgents === 1 ? " is" : "s are"} working, so verify incomplete sources before judging system health.`,
    };
  }
  if (params.criticalFindings > 0) {
    return {
      tone: "urgent",
      text: `${params.criticalFindings} critical issue${params.criticalFindings === 1 ? " needs" : "s need"} attention now; ${params.workingAgents} agent${params.workingAgents === 1 ? " is" : "s are"} working.`,
    };
  }
  if (params.needsUserFindings > 0) {
    return {
      tone: "attention",
      text: `${params.needsUserFindings} issue${params.needsUserFindings === 1 ? " needs" : "s need"} your decision; ${params.handlingFindings} ${params.handlingFindings === 1 ? "is" : "are"} being handled.`,
    };
  }
  if (params.handlingFindings > 0 || params.watchingFindings > 0) {
    return {
      tone: "attention",
      text: `${params.handlingFindings} issue${params.handlingFindings === 1 ? " is" : "s are"} being handled and ${params.watchingFindings} ${params.watchingFindings === 1 ? "is" : "are"} being watched; no decision is needed now.`,
    };
  }
  return {
    tone: "normal",
    text: `${params.workingAgents} agent${params.workingAgents === 1 ? " is" : "s are"} working on ${params.activeTasks} active task${params.activeTasks === 1 ? "" : "s"} across ${params.activeWorkflows} active workflow${params.activeWorkflows === 1 ? "" : "s"}; nothing needs your attention.`,
  };
}

export function operationsStatusForFindings(
  findings: readonly OperationsFinding[],
  options: { partial?: boolean } = {},
): OperationsStatus {
  if (options.partial) {
    return "unknown";
  }
  if (findings.some((finding) => finding.severity === "critical")) {
    return "blocked";
  }
  if (findings.some((finding) => finding.severity === "warning")) {
    return "degraded";
  }
  return "healthy";
}

export function operationsStatusForTask(
  status: string,
  terminalOutcome?: string,
): OperationsStatus {
  if (terminalOutcome === "blocked") {
    return "blocked";
  }
  switch (status) {
    case "queued":
      return "idle";
    case "running":
      return "working";
    case "succeeded":
      return "healthy";
    case "failed":
    case "timed_out":
    case "lost":
      return "failed";
    case "cancelled":
      return "disabled";
    default:
      return "unknown";
  }
}

export function operationsStatusForWorkflow(
  status: string,
  updatedAt: number,
  now: number,
): OperationsStatus {
  switch (status) {
    case "running":
      return "working";
    case "queued":
      return now - updatedAt >= OPERATIONS_STALE_QUEUED_WORKFLOW_MS ? "degraded" : "idle";
    case "waiting":
    case "paused":
      return "idle";
    case "blocked":
      return "blocked";
    case "failed":
    case "lost":
      return "failed";
    case "cancelled":
      return "disabled";
    case "succeeded":
      return "healthy";
    default:
      return "unknown";
  }
}

export function operationsFindingSeverityForWorkflow(
  status: string,
  updatedAt: number,
  now: number,
): OperationsSeverity | null {
  if (status === "blocked") {
    return "warning";
  }
  if (status === "queued" && now - updatedAt >= OPERATIONS_STALE_QUEUED_WORKFLOW_MS) {
    return "warning";
  }
  if (status === "failed" || status === "lost") {
    const age = now - updatedAt;
    if (age <= OPERATIONS_RECENT_WORKFLOW_FAILURE_MS) {
      return "critical";
    }
    return age <= OPERATIONS_WORKFLOW_HISTORY_RETENTION_MS ? "info" : null;
  }
  return null;
}

export function scoreOperationsFindings(findings: readonly OperationsFinding[]): number {
  const unique = new Map(findings.map((finding) => [finding.id, finding]));
  const deduction = [...unique.values()].reduce(
    (sum, finding) => sum + SEVERITY_DEDUCTION[finding.severity],
    0,
  );
  return Math.max(0, Math.min(100, 100 - deduction));
}

export function capOperationsRows<T>(rows: readonly T[], max = 200): T[] {
  return rows.slice(0, Math.max(0, max));
}

export function stampOperationsFindingHistory(
  findings: readonly OperationsFinding[],
  now: number,
): OperationsFinding[] {
  const activeIds = new Set(findings.map((finding) => finding.id));
  for (const id of findingFirstObservedAt.keys()) {
    if (!activeIds.has(id)) {
      findingFirstObservedAt.delete(id);
    }
  }
  return findings.map((finding) => {
    const firstObservedAt = findingFirstObservedAt.get(finding.id) ?? now;
    findingFirstObservedAt.set(finding.id, firstObservedAt);
    return { ...finding, firstObservedAt, lastObservedAt: now };
  });
}

export function resetOperationsFindingHistoryForTests(): void {
  findingFirstObservedAt.clear();
}

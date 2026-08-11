import type { ExecutionStateSnapshot } from "../../packages/gateway-protocol/src/schema/types.js";

export type PccExecutionRuntimeItem = {
  kind: "task" | "goal" | "turn";
  id: string;
  sessionKey: string;
  status: string;
  summary: string;
  updatedAt: number;
};

export type PccExecutionRuntimeProjection = {
  schemaVersion: 1;
  projectId: string;
  generatedAt: number;
  sourceRevisions: string[];
  sessionKeys: string[];
  activeCount: number;
  healthy: boolean;
  issues: {
    staleGoalCount: number;
    orphanedTurnCount: number;
    pendingDeliveryCount: number;
    lostWorkerCount: number;
  };
  items: PccExecutionRuntimeItem[];
};

function timestamp(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function taskSummary(task: ExecutionStateSnapshot["tasks"][number]): string {
  return (
    task.progressSummary ?? task.terminalSummary ?? task.error ?? task.title ?? task.kind ?? "Task"
  );
}

/**
 * Builds PCC's read-only runtime view exclusively from the typed execution
 * contract. It intentionally accepts no transcript text and cannot mutate the
 * PCC milestone ledger.
 */
export function buildPccExecutionRuntimeProjection(params: {
  projectId: string;
  snapshots: readonly ExecutionStateSnapshot[];
  now?: number;
}): PccExecutionRuntimeProjection {
  const snapshots = params.snapshots.toSorted((a, b) => a.sessionKey.localeCompare(b.sessionKey));
  const items: PccExecutionRuntimeItem[] = [];
  for (const snapshot of snapshots) {
    for (const task of snapshot.tasks) {
      items.push({
        kind: "task",
        id: task.id,
        sessionKey: snapshot.sessionKey,
        status: task.status,
        summary: taskSummary(task),
        updatedAt: timestamp(task.updatedAt ?? task.startedAt ?? task.createdAt),
      });
    }
    for (const flow of snapshot.flows) {
      items.push({
        kind: "goal",
        id: flow.flowId,
        sessionKey: snapshot.sessionKey,
        status: flow.status,
        summary: flow.currentStep ?? flow.blockedSummary ?? flow.lastResult ?? flow.goal,
        updatedAt: timestamp(flow.updatedAt),
      });
    }
    for (const turn of snapshot.turns) {
      items.push({
        kind: "turn",
        id: turn.id,
        sessionKey: snapshot.sessionKey,
        status: turn.phase,
        summary: turn.activitySummary ?? turn.lastError ?? "Chat turn",
        updatedAt: turn.lastActivityAt || turn.updatedAt,
      });
    }
  }

  const issues = snapshots.reduce(
    (total, snapshot) => ({
      staleGoalCount: total.staleGoalCount + snapshot.health.staleGoalCount,
      orphanedTurnCount: total.orphanedTurnCount + snapshot.health.orphanedTurnCount,
      pendingDeliveryCount: total.pendingDeliveryCount + snapshot.health.pendingDeliveryCount,
      lostWorkerCount: total.lostWorkerCount + snapshot.health.lostWorkerCount,
    }),
    {
      staleGoalCount: 0,
      orphanedTurnCount: 0,
      pendingDeliveryCount: 0,
      lostWorkerCount: 0,
    },
  );

  return {
    schemaVersion: 1,
    projectId: params.projectId,
    generatedAt: params.now ?? Date.now(),
    sourceRevisions: snapshots.map((snapshot) => snapshot.snapshotRevision),
    sessionKeys: snapshots.map((snapshot) => snapshot.sessionKey),
    activeCount: snapshots.reduce((total, snapshot) => total + snapshot.health.activeCount, 0),
    healthy: snapshots.every((snapshot) => snapshot.health.healthy),
    issues,
    items: items.toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
  };
}

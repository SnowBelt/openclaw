// Lightweight Operations Room shadow monitor. This loop observes local facts,
// persists bounded incident transitions, and never starts agents, invokes
// models, or mutates runtime configuration.
import { getTaskRegistryRestoreFailure, listTaskRecords } from "../tasks/runtime-internal.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import {
  getTaskFlowRegistryRestoreFailure,
  listTaskFlowRecords,
} from "../tasks/task-flow-runtime-internal.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import { buildOperationsFindings, buildOperationsWorkflowRows } from "./collector.js";
import { collectOperationsHostMemory } from "./host-memory-probe.js";
import {
  reconcileOperationsIncidentLedger,
  type OperationsIncidentLedgerOptions,
} from "./incident-ledger.js";
import {
  getOperationsShadowMonitorState,
  OPERATIONS_SHADOW_INTERVAL_MS,
  resetOperationsShadowMonitorStateForTest,
  setOperationsShadowMonitorState,
  updateOperationsShadowMonitorState,
} from "./monitor-state.js";
import type { OperationsFinding } from "./types.js";

export {
  getOperationsShadowMonitorState,
  OPERATIONS_SHADOW_INTERVAL_MS,
  resetOperationsShadowMonitorStateForTest,
};
export type { OperationsShadowMonitorState } from "./monitor-state.js";

export type OperationsShadowObservation = {
  findings: OperationsFinding[];
  authoritativeCategories: OperationsFinding["category"][];
};

export async function collectOperationsShadowObservation(
  now = Date.now(),
): Promise<OperationsShadowObservation> {
  const hostMemory = await collectOperationsHostMemory();
  let tasks: TaskRecord[];
  let taskSourceAvailable: boolean;
  try {
    tasks = listTaskRecords();
    taskSourceAvailable = getTaskRegistryRestoreFailure() == null;
  } catch {
    tasks = [];
    taskSourceAvailable = false;
  }
  let flows: TaskFlowRecord[];
  let flowSourceAvailable: boolean;
  try {
    flows = listTaskFlowRecords();
    flowSourceAvailable = getTaskFlowRegistryRestoreFailure() == null;
  } catch {
    flows = [];
    flowSourceAvailable = false;
  }
  const workflows = buildOperationsWorkflowRows(tasks, flows, now);
  const findings = buildOperationsFindings({
    now,
    hostMemoryUsedPercent: hostMemory.memoryUsedPercent,
    tasks,
    taskSourceAvailable,
    workflows,
    workflowSourceAvailable: flowSourceAvailable,
    cronJobs: [],
    scheduleSourceAvailable: false,
    catalogs: { skills: [], plugins: [] },
    skillSourceAvailable: false,
    pluginSourceAvailable: false,
  });
  return {
    findings,
    authoritativeCategories: [
      "resource",
      ...(taskSourceAvailable && flowSourceAvailable ? (["workflow"] as const) : []),
    ],
  };
}

export async function collectOperationsShadowFindingIds(now = Date.now()): Promise<string[]> {
  const observation = await collectOperationsShadowObservation(now);
  return observation.findings.map((finding) => finding.id).toSorted();
}

export function startOperationsShadowMonitor(params: {
  intervalMs?: number;
  log: { warn: (message: string) => void };
  now?: () => number;
  collect?: (now: number) => OperationsShadowObservation | Promise<OperationsShadowObservation>;
  incidentLedgerOptions?: OperationsIncidentLedgerOptions;
}): () => void {
  const intervalMs = Math.max(5_000, params.intervalMs ?? OPERATIONS_SHADOW_INTERVAL_MS);
  const now = params.now ?? Date.now;
  const collect = params.collect ?? collectOperationsShadowObservation;
  let stopped = false;
  let sweepInFlight = false;
  let knownFindings = new Set<string>();

  setOperationsShadowMonitorState({
    running: true,
    intervalMs,
    startedAt: now(),
    lastAttemptAt: null,
    lastSweepAt: null,
    nextSweepAt: null,
    lastDurationMs: null,
    attemptCount: 0,
    sweepCount: 0,
    lastError: null,
    findingIds: [],
  });

  const sweep = async () => {
    if (stopped || sweepInFlight) {
      return;
    }
    sweepInFlight = true;
    const startedAt = now();
    try {
      const observation = await collect(startedAt);
      if (stopped) {
        return;
      }
      const ledger = reconcileOperationsIncidentLedger({
        findings: observation.findings,
        now: startedAt,
        authoritativeCategories: observation.authoritativeCategories,
        ...(params.incidentLedgerOptions ? { options: params.incidentLedgerOptions } : {}),
      });
      const findingIds = ledger.findings.map((finding) => finding.id).toSorted();
      const nextFindings = new Set(findingIds);
      const recurrenceIds = new Set(
        ledger.recurrences
          .filter((recurrence) => recurrence.reopenedAt >= startedAt)
          .map((recurrence) => recurrence.incidentId),
      );
      const newFindings = ledger.findings.filter(
        (finding) =>
          recurrenceIds.has(finding.id) ||
          (!knownFindings.has(finding.id) && (finding.firstObservedAt ?? startedAt) >= startedAt),
      );
      if (newFindings.length > 0) {
        params.log.warn(
          `operations shadow monitor found: ${newFindings.map((finding) => finding.id).join(", ")}`,
        );
      }
      knownFindings = nextFindings;
      const finishedAt = now();
      const current = getOperationsShadowMonitorState();
      setOperationsShadowMonitorState({
        ...current,
        running: true,
        lastAttemptAt: finishedAt,
        lastSweepAt: finishedAt,
        nextSweepAt: finishedAt + intervalMs,
        lastDurationMs: Math.max(0, finishedAt - startedAt),
        attemptCount: current.attemptCount + 1,
        sweepCount: current.sweepCount + 1,
        lastError: null,
        findingIds,
      });
    } catch (err) {
      if (!stopped) {
        const message = err instanceof Error ? err.message : String(err);
        params.log.warn(`operations shadow monitor sweep failed: ${message}`);
        const finishedAt = now();
        const current = getOperationsShadowMonitorState();
        setOperationsShadowMonitorState({
          ...current,
          running: true,
          lastAttemptAt: finishedAt,
          nextSweepAt: finishedAt + intervalMs,
          lastDurationMs: Math.max(0, finishedAt - startedAt),
          attemptCount: current.attemptCount + 1,
          lastError: message,
        });
      }
    } finally {
      sweepInFlight = false;
    }
  };

  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  void sweep();

  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
    updateOperationsShadowMonitorState((current) => ({
      ...current,
      running: false,
      nextSweepAt: null,
    }));
  };
}

// Lightweight Operations Room shadow monitor. This loop observes only local
// runtime facts and never starts agents, invokes models, or mutates config.
import { listTaskRecords } from "../tasks/runtime-internal.js";
import { listTaskFlowRecords } from "../tasks/task-flow-runtime-internal.js";
import { collectOperationsHostMemory } from "./host-memory-probe.js";

export const OPERATIONS_SHADOW_INTERVAL_MS = 60_000;
const STALE_RUNNING_TASK_MS = 2 * 60 * 60_000;

export type OperationsShadowMonitorState = {
  running: boolean;
  intervalMs: number;
  startedAt: number | null;
  lastSweepAt: number | null;
  nextSweepAt: number | null;
  lastDurationMs: number | null;
  sweepCount: number;
  lastError: string | null;
  findingIds: string[];
};

let state: OperationsShadowMonitorState = {
  running: false,
  intervalMs: OPERATIONS_SHADOW_INTERVAL_MS,
  startedAt: null,
  lastSweepAt: null,
  nextSweepAt: null,
  lastDurationMs: null,
  sweepCount: 0,
  lastError: null,
  findingIds: [],
};

export function getOperationsShadowMonitorState(): OperationsShadowMonitorState {
  return { ...state, findingIds: [...state.findingIds] };
}

export async function collectOperationsShadowFindingIds(now = Date.now()): Promise<string[]> {
  const findings: string[] = [];
  const { memoryUsedPercent } = await collectOperationsHostMemory();
  if (memoryUsedPercent >= 90) {
    findings.push("resource:memory:critical");
  } else if (memoryUsedPercent >= 80) {
    findings.push("resource:memory:warning");
  }

  for (const task of listTaskRecords()) {
    const lastAt = task.lastEventAt ?? task.endedAt ?? task.startedAt ?? task.createdAt;
    if (task.status === "running" && now - lastAt >= STALE_RUNNING_TASK_MS) {
      findings.push(`task:${task.taskId}:stale`);
    }
  }
  for (const flow of listTaskFlowRecords()) {
    if (flow.status === "blocked" || flow.status === "failed" || flow.status === "lost") {
      findings.push(`workflow:${flow.flowId}:${flow.status}`);
    }
  }
  return findings.toSorted();
}

export function startOperationsShadowMonitor(params: {
  intervalMs?: number;
  log: { warn: (message: string) => void };
  now?: () => number;
  collect?: (now: number) => string[] | Promise<string[]>;
}): () => void {
  const intervalMs = Math.max(5_000, params.intervalMs ?? OPERATIONS_SHADOW_INTERVAL_MS);
  const now = params.now ?? Date.now;
  const collect = params.collect ?? collectOperationsShadowFindingIds;
  let stopped = false;
  let sweepInFlight = false;
  let knownFindings = new Set<string>();

  state = {
    running: true,
    intervalMs,
    startedAt: now(),
    lastSweepAt: null,
    nextSweepAt: null,
    lastDurationMs: null,
    sweepCount: 0,
    lastError: null,
    findingIds: [],
  };

  const sweep = async () => {
    if (stopped || sweepInFlight) {
      return;
    }
    sweepInFlight = true;
    const startedAt = now();
    try {
      const findingIds = await collect(startedAt);
      if (stopped) {
        return;
      }
      const nextFindings = new Set(findingIds);
      const newFindings = findingIds.filter((id) => !knownFindings.has(id));
      if (newFindings.length > 0) {
        params.log.warn(`operations shadow monitor found: ${newFindings.join(", ")}`);
      }
      knownFindings = nextFindings;
      const finishedAt = now();
      state = {
        ...state,
        running: true,
        lastSweepAt: finishedAt,
        nextSweepAt: finishedAt + intervalMs,
        lastDurationMs: Math.max(0, finishedAt - startedAt),
        sweepCount: state.sweepCount + 1,
        lastError: null,
        findingIds,
      };
    } catch (err) {
      if (!stopped) {
        const message = err instanceof Error ? err.message : String(err);
        params.log.warn(`operations shadow monitor sweep failed: ${message}`);
        const finishedAt = now();
        state = {
          ...state,
          running: true,
          lastSweepAt: finishedAt,
          nextSweepAt: finishedAt + intervalMs,
          lastDurationMs: Math.max(0, finishedAt - startedAt),
          sweepCount: state.sweepCount + 1,
          lastError: message,
        };
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
    state = { ...state, running: false, nextSweepAt: null };
  };
}

export function resetOperationsShadowMonitorStateForTest(): void {
  state = {
    running: false,
    intervalMs: OPERATIONS_SHADOW_INTERVAL_MS,
    startedAt: null,
    lastSweepAt: null,
    nextSweepAt: null,
    lastDurationMs: null,
    sweepCount: 0,
    lastError: null,
    findingIds: [],
  };
}

// Process-wide admission for local inference.  Judge and Pursue Goal worker
// turns share this lease so a foreground local task cannot be surprised by a
// second resident model request.
import { resolveSubagentMaxConcurrent } from "../config/agent-limits.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { collectPccExecutionCapacitySnapshot } from "../pcc/execution-capacity.js";
import { collectControlDirectorResidencyObservation } from "./control-director-resource-runtime.js";

export const JUDGE_LOCAL_QUEUE_CAPACITY = 32;
export const JUDGE_LOCAL_QUEUE_PER_OWNER = 2;
export const JUDGE_LOCAL_PRIMARY_WAIT_MS = 30_000;
export const JUDGE_LOCAL_BACKUP_WAIT_MS = 10_000;

export type JudgeLocalCapacityDecision =
  | { decision: "admit" }
  | { decision: "queue"; reason: string }
  | { decision: "hosted_fallback"; reason: string };

type QueueEntry = {
  ownerId: string;
  resolve: (value: JudgeLocalAdmissionResult) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export type JudgeLocalAdmissionLease = {
  admitted: true;
  release: () => void;
};

export type JudgeLocalAdmissionResult =
  | JudgeLocalAdmissionLease
  | { admitted: false; reason: "queue_full" | "owner_limit" | "timeout" | "cancelled" };

type JudgeAdmissionState = {
  active: boolean;
  queue: QueueEntry[];
  queuedByOwner: Map<string, number>;
};

const JUDGE_ADMISSION_STATE = Symbol.for("openclaw.local-inference-admission.v1");
const globalAdmission = globalThis as typeof globalThis & Record<symbol, unknown>;
const existingState = globalAdmission[JUDGE_ADMISSION_STATE] as JudgeAdmissionState | undefined;
const state: JudgeAdmissionState = existingState ?? {
  active: false,
  queue: [],
  queuedByOwner: new Map(),
};
globalAdmission[JUDGE_ADMISSION_STATE] = state;

function decrementOwner(ownerId: string): void {
  const next = (state.queuedByOwner.get(ownerId) ?? 1) - 1;
  if (next > 0) {
    state.queuedByOwner.set(ownerId, next);
  } else {
    state.queuedByOwner.delete(ownerId);
  }
}

function detach(entry: QueueEntry): void {
  clearTimeout(entry.timer);
  if (entry.signal && entry.onAbort) {
    entry.signal.removeEventListener("abort", entry.onAbort);
  }
  decrementOwner(entry.ownerId);
}

function grantNext(): void {
  if (state.active) {
    return;
  }
  const entry = state.queue.shift();
  if (!entry) {
    return;
  }
  detach(entry);
  state.active = true;
  let released = false;
  entry.resolve({
    admitted: true,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      state.active = false;
      grantNext();
    },
  });
}

/** One active local inference; bounded FIFO queue with per-owner fairness. */
export async function acquireLocalInferenceAdmission(params: {
  ownerId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<JudgeLocalAdmissionResult> {
  const ownerId = params.ownerId.trim() || "unknown";
  if (params.signal?.aborted) {
    return { admitted: false, reason: "cancelled" };
  }
  if (!state.active && state.queue.length === 0) {
    state.active = true;
    let released = false;
    return {
      admitted: true,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        state.active = false;
        grantNext();
      },
    };
  }
  if (state.queue.length >= JUDGE_LOCAL_QUEUE_CAPACITY) {
    return { admitted: false, reason: "queue_full" };
  }
  if ((state.queuedByOwner.get(ownerId) ?? 0) >= JUDGE_LOCAL_QUEUE_PER_OWNER) {
    return { admitted: false, reason: "owner_limit" };
  }
  return await new Promise<JudgeLocalAdmissionResult>((resolve) => {
    const timeoutMs = Math.max(0, Math.floor(params.timeoutMs));
    const entry: QueueEntry = {
      ownerId,
      resolve,
      timer: undefined as unknown as NodeJS.Timeout,
      signal: params.signal,
    };
    const settle = (reason: "timeout" | "cancelled") => {
      const index = state.queue.indexOf(entry);
      if (index < 0) {
        return;
      }
      state.queue.splice(index, 1);
      detach(entry);
      resolve({ admitted: false, reason });
    };
    entry.timer = setTimeout(() => settle("timeout"), timeoutMs);
    entry.timer.unref?.();
    entry.onAbort = () => settle("cancelled");
    params.signal?.addEventListener("abort", entry.onAbort, { once: true });
    state.queue.push(entry);
    state.queuedByOwner.set(ownerId, (state.queuedByOwner.get(ownerId) ?? 0) + 1);
  });
}

/** Backward-compatible name for Judge-specific callers. */
export const acquireJudgeLocalAdmission = acquireLocalInferenceAdmission;

/** Probe prepared provider residency plus host RAM/thermal headroom without mutating models. */
export async function assessJudgeLocalCapacity(params: {
  config: OpenClawConfig;
  selectedModel: string;
  /** The caller already owns the sole Judge lease, so it is not contention. */
  leaseHeld?: boolean;
  runtime?: {
    collectResidency?: typeof collectControlDirectorResidencyObservation;
    collectCapacity?: typeof collectPccExecutionCapacitySnapshot;
  };
}): Promise<JudgeLocalCapacityDecision> {
  const collectResidency =
    params.runtime?.collectResidency ?? collectControlDirectorResidencyObservation;
  const collectCapacity = params.runtime?.collectCapacity ?? collectPccExecutionCapacitySnapshot;
  const competingLocalWork = state.active && !params.leaseHeld;
  const residency = await collectResidency({
    config: params.config,
    selectedModel: params.selectedModel,
    activeLocalWork: competingLocalWork,
    timeoutMs: 1_000,
  });
  if (!residency.available) {
    return {
      decision: "hosted_fallback",
      reason: "provider residency could not be verified without mutation",
    };
  }
  const differentResident = residency.residentModels.find(
    (model) => model.ref !== params.selectedModel,
  );
  if (differentResident) {
    return {
      decision: "hosted_fallback",
      reason: `different local model ${differentResident.ref} is resident`,
    };
  }
  const capacity = collectCapacity({
    activeOpenClawTaskCount: competingLocalWork ? 1 : 0,
    configuredSubagentLimit: resolveSubagentMaxConcurrent(params.config),
    observedLocalModelProcessCount: residency.observedProcessCount,
    localModelObservationAvailable: true,
  });
  if (capacity.freeRamGb < 48) {
    return {
      decision: "hosted_fallback",
      reason: `available memory ${capacity.freeRamGb}GiB is below the 48GiB Judge reserve`,
    };
  }
  if (
    capacity.thermalPressure === "serious" ||
    capacity.thermalPressure === "critical" ||
    capacity.thermalPressure === "unknown"
  ) {
    return {
      decision: "hosted_fallback",
      reason: `thermal pressure is ${capacity.thermalPressure}`,
    };
  }
  if (capacity.memoryPressure === "high" || capacity.safeLocalAgentSlots < 1) {
    return {
      decision: "queue",
      reason: `host capacity is constrained (memory=${capacity.memoryPressure}, thermal=${capacity.thermalPressure}, slots=${capacity.safeLocalAgentSlots})`,
    };
  }
  return { decision: "admit" };
}

export function resetJudgeLocalAdmissionForTests(): void {
  for (const entry of state.queue.splice(0)) {
    detach(entry);
    entry.resolve({ admitted: false, reason: "cancelled" });
  }
  state.active = false;
  state.queuedByOwner.clear();
}

export function getJudgeLocalAdmissionSnapshotForTests(): {
  active: boolean;
  queued: number;
  owners: number;
} {
  return { active: state.active, queued: state.queue.length, owners: state.queuedByOwner.size };
}

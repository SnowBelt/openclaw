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
  priority: "judge" | "normal";
  sequence: number;
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
export const LOCAL_INFERENCE_ADMISSION_HOOKS = Symbol.for(
  "openclaw.local-inference-admission-hooks.v1",
);
const HELD_ADMISSION = Symbol.for("openclaw.local-inference-admission-held.v1");
const LOCAL_INFERENCE_OWNER = Symbol.for("openclaw.local-inference-owner.v1");
const globalAdmission = globalThis as typeof globalThis & Record<symbol, unknown>;
const existingState = globalAdmission[JUDGE_ADMISSION_STATE] as JudgeAdmissionState | undefined;
const state: JudgeAdmissionState = existingState ?? {
  active: false,
  queue: [],
  queuedByOwner: new Map(),
};
let nextSequence = 0;
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
  const nextIndex = state.queue.reduce((best, entry, index, queue) => {
    const current = queue[best];
    return entry.priority === "judge" && current.priority !== "judge"
      ? index
      : entry.priority === current.priority && entry.sequence < current.sequence
        ? index
        : best;
  }, 0);
  const entry = state.queue.splice(nextIndex, 1)[0];
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
  priority?: "judge" | "normal";
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
      priority: params.priority ?? "normal",
      sequence: nextSequence++,
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

/** Mark a model whose caller already owns the process-wide local lease. */
export function markLocalInferenceAdmissionHeld<TModel extends object>(model: TModel): TModel {
  return Object.assign({ ...model }, { [HELD_ADMISSION]: true }) as TModel;
}

export function hasLocalInferenceAdmissionHeld(model: object): boolean {
  return (model as Record<PropertyKey, unknown>)[HELD_ADMISSION] === true;
}

function localInferenceOwnerOf(model: object): string | undefined {
  const owner = (model as Record<PropertyKey, unknown>)[LOCAL_INFERENCE_OWNER];
  return typeof owner === "string" && owner.trim() ? owner.trim() : undefined;
}

// The Ollama extension is intentionally unable to import core admission code.
// Register a narrow structural bridge so every native provider stream can use
// the same process-wide lease without creating a core-to-extension dependency.
const admissionHooks = Object.freeze({
  acquire: acquireLocalInferenceAdmission,
  hasHeld: hasLocalInferenceAdmissionHeld,
  ownerOf: localInferenceOwnerOf,
});
const admissionHookDescriptor = Object.getOwnPropertyDescriptor(
  globalAdmission,
  LOCAL_INFERENCE_ADMISSION_HOOKS,
);
if (!admissionHookDescriptor || admissionHookDescriptor.configurable) {
  Object.defineProperty(globalAdmission, LOCAL_INFERENCE_ADMISSION_HOOKS, {
    value: admissionHooks,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

/** Probe prepared provider residency plus host RAM/thermal headroom without mutating models. */
export async function assessJudgeLocalCapacity(params: {
  config: OpenClawConfig;
  selectedModel: string;
  /** Require a configured and residency-confirmed immutable model digest. */
  requireImmutableIdentity?: boolean;
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
  if (params.requireImmutableIdentity) {
    const slash = params.selectedModel.indexOf("/");
    const provider = slash > 0 ? params.selectedModel.slice(0, slash) : "";
    const modelId = slash > 0 ? params.selectedModel.slice(slash + 1) : "";
    const providerConfig = provider
      ? (params.config.models?.providers?.[provider] ??
        Object.entries(params.config.models?.providers ?? {}).find(
          ([key]) => key.toLowerCase() === provider.toLowerCase(),
        )?.[1])
      : undefined;
    const modelConfig = providerConfig?.models?.find((model) => model.id === modelId);
    const expectedDigest =
      typeof modelConfig?.params?.digest === "string"
        ? modelConfig.params.digest.trim()
        : typeof modelConfig?.params?.modelDigest === "string"
          ? modelConfig.params.modelDigest.trim()
          : "";
    const selectedResident = residency.residentModels.find(
      (model) => model.ref === params.selectedModel,
    );
    if (!expectedDigest || !selectedResident?.modelDigest) {
      return {
        decision: "hosted_fallback",
        reason: "immutable local model identity is unavailable",
      };
    }
    if (selectedResident.modelDigest !== expectedDigest) {
      return {
        decision: "hosted_fallback",
        reason: "local model digest does not match the configured immutable identity",
      };
    }
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

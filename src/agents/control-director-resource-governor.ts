// Mac Studio-safe local-model residency and admission decisions for the Control Director.
import type { PccExecutionCapacitySnapshot } from "../pcc/execution-capacity.js";

export const CONTROL_DIRECTOR_RESOURCE_GOVERNOR_VERSION = 1 as const;
export const CONTROL_DIRECTOR_MODEL_MEMORY_RESERVE_GB = 8;
export const CONTROL_DIRECTOR_DEFAULT_MODEL_ESTIMATE_GB = 36;

export type ControlDirectorResidentModel = {
  ref: string;
  state: "active" | "idle";
  estimatedMemoryGb: number;
  modelDigest?: string;
};

export type ControlDirectorResourceDecision =
  | {
      decision: "admit";
      reason: string;
      selectedModel: string;
      residency: "already_resident" | "load";
    }
  | {
      decision: "unload_idle_then_admit";
      reason: string;
      selectedModel: string;
      unloadModels: string[];
    }
  | {
      decision: "queue";
      reason: string;
      selectedModel: string;
      retryWhen: "capacity" | "memory" | "thermal" | "active_model";
    };

/** Never unload an active model; reserve RAM and gateway capacity before a large local load. */
export function decideControlDirectorResourceAdmission(params: {
  selectedModel: string;
  capacity: PccExecutionCapacitySnapshot;
  residentModels?: readonly ControlDirectorResidentModel[];
  activeControlDirectorRuns?: number;
  estimatedSelectedModelMemoryGb?: number;
}): ControlDirectorResourceDecision {
  const selectedModel = params.selectedModel.trim();
  const residents = [...(params.residentModels ?? [])];
  const selectedResident = residents.find((model) => model.ref === selectedModel);
  const activeRuns = Math.max(0, Math.floor(params.activeControlDirectorRuns ?? 0));
  const estimatedMemory = Math.max(
    1,
    params.estimatedSelectedModelMemoryGb ?? CONTROL_DIRECTOR_DEFAULT_MODEL_ESTIMATE_GB,
  );
  if (
    params.capacity.thermalPressure === "critical" ||
    params.capacity.thermalPressure === "serious"
  ) {
    return {
      decision: "queue",
      reason: `Local model admission paused under ${params.capacity.thermalPressure} thermal pressure.`,
      selectedModel,
      retryWhen: "thermal",
    };
  }
  if (activeRuns > 0) {
    return {
      decision: "queue",
      reason:
        "One large Control Director local run is already active; preserve chat and Gateway responsiveness.",
      selectedModel,
      retryWhen: "capacity",
    };
  }
  if (params.capacity.safeLocalAgentSlots < 1) {
    return {
      decision: "queue",
      reason: "The host capacity snapshot has no safe local agent slot.",
      selectedModel,
      retryWhen: params.capacity.memoryPressure === "high" ? "memory" : "capacity",
    };
  }
  if (selectedResident) {
    return {
      decision: "admit",
      reason: "The selected evaluated local model is already resident and host capacity is safe.",
      selectedModel,
      residency: "already_resident",
    };
  }
  const activeOtherModel = residents.find((model) => model.state === "active");
  if (activeOtherModel) {
    return {
      decision: "queue",
      reason: `Active model ${activeOtherModel.ref} cannot be evicted for a Control Director load.`,
      selectedModel,
      retryWhen: "active_model",
    };
  }
  const requiredFreeMemory = estimatedMemory + CONTROL_DIRECTOR_MODEL_MEMORY_RESERVE_GB;
  if (params.capacity.freeRamGb >= requiredFreeMemory) {
    return {
      decision: "admit",
      reason: `Free RAM preserves the ${CONTROL_DIRECTOR_MODEL_MEMORY_RESERVE_GB}GB Gateway reserve after model load.`,
      selectedModel,
      residency: "load",
    };
  }
  const idle = residents.filter((model) => model.state === "idle");
  const reclaimed = idle.reduce((sum, model) => sum + Math.max(0, model.estimatedMemoryGb), 0);
  if (idle.length > 0 && params.capacity.freeRamGb + reclaimed >= requiredFreeMemory) {
    return {
      decision: "unload_idle_then_admit",
      reason:
        "Idle model eviction restores the required memory reserve without interrupting active work.",
      selectedModel,
      unloadModels: idle.map((model) => model.ref).toSorted(),
    };
  }
  return {
    decision: "queue",
    reason: `Model load needs ${requiredFreeMemory}GB free including reserve; only ${params.capacity.freeRamGb}GB is available.`,
    selectedModel,
    retryWhen: "memory",
  };
}

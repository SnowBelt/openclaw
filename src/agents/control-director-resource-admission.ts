// One resource-admission projection shared by PCC and startup model warmup.
import { resolveSubagentMaxConcurrent } from "../config/agent-limits.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  collectPccExecutionCapacitySnapshot,
  type PccExecutionCapacitySnapshot,
} from "../pcc/execution-capacity.js";
import { compileControlDirectorExecutionProfile } from "./control-director-execution-profile.js";
import {
  decideControlDirectorResourceAdmission,
  type ControlDirectorResourceDecision,
} from "./control-director-resource-governor.js";
import {
  collectControlDirectorResidencyObservation,
  type ControlDirectorResidencyObservation,
} from "./control-director-resource-runtime.js";

export type ControlDirectorAdmissionTask = {
  status: string;
  agentId?: string;
  requesterAgentId?: string;
  ownerKey?: string;
};

export type ControlDirectorResourceAssessment = {
  configured: boolean;
  agentId?: string;
  selectedModel?: string;
  activeOpenClawTaskCount: number;
  activeControlDirectorRuns: number;
  residency: ControlDirectorResidencyObservation;
  admission?: ControlDirectorResourceDecision;
  /** Generic host capacity before the single large-model Control Director admission is applied. */
  hostCapacity: PccExecutionCapacitySnapshot;
  /** Control Director-specific capacity projection used only for its model admission. */
  capacity: PccExecutionCapacitySnapshot;
};

type ResourceAdmissionRuntime = {
  collectResidency: typeof collectControlDirectorResidencyObservation;
  collectCapacity: typeof collectPccExecutionCapacitySnapshot;
};

const DEFAULT_RUNTIME: ResourceAdmissionRuntime = {
  collectResidency: collectControlDirectorResidencyObservation,
  collectCapacity: collectPccExecutionCapacitySnapshot,
};

function isActiveTask(task: ControlDirectorAdmissionTask): boolean {
  return task.status === "queued" || task.status === "running";
}

function unavailableResidency(reason: string): ControlDirectorResidencyObservation {
  return {
    available: false,
    observedProcessCount: 0,
    residentModels: [],
    warnings: [reason],
  };
}

function queueDecision(params: {
  selectedModel: string;
  reason: string;
}): ControlDirectorResourceDecision {
  return {
    decision: "queue",
    reason: params.reason,
    selectedModel: params.selectedModel,
    retryWhen: "capacity",
  };
}

/** Fail closed when model selection or provider-owned residency truth is unavailable. */
export async function assessControlDirectorResourceAdmission(params: {
  config: OpenClawConfig;
  tasks: readonly ControlDirectorAdmissionTask[];
  residencyTimeoutMs?: number;
  runtime?: Partial<ResourceAdmissionRuntime>;
}): Promise<ControlDirectorResourceAssessment> {
  const runtime = { ...DEFAULT_RUNTIME, ...params.runtime };
  const activeTasks = params.tasks.filter(isActiveTask);
  const activeOpenClawTaskCount = activeTasks.length;
  const director = params.config.agents?.list?.find((agent) => agent.role === "control_director");
  if (!director) {
    const residency = unavailableResidency("No Control Director role is configured.");
    const hostCapacity = runtime.collectCapacity({
      activeOpenClawTaskCount,
      configuredSubagentLimit: resolveSubagentMaxConcurrent(params.config),
      observedLocalModelProcessCount: 0,
      localModelObservationAvailable: false,
    });
    return {
      configured: false,
      activeOpenClawTaskCount,
      activeControlDirectorRuns: 0,
      residency,
      hostCapacity,
      capacity: hostCapacity,
    };
  }

  const profile = compileControlDirectorExecutionProfile({
    config: params.config,
    agentId: director.id,
  });
  const activeControlDirectorRuns = activeTasks.filter(
    (task) =>
      task.agentId === director.id ||
      task.requesterAgentId === director.id ||
      task.ownerKey?.startsWith(`agent:${director.id}:`),
  ).length;
  const residency = await runtime.collectResidency({
    config: params.config,
    selectedModel: profile.localModel,
    activeLocalWork: activeOpenClawTaskCount > activeControlDirectorRuns,
    ...(params.residencyTimeoutMs == null ? {} : { timeoutMs: params.residencyTimeoutMs }),
  });
  const baseCapacity = runtime.collectCapacity({
    activeOpenClawTaskCount,
    configuredSubagentLimit: resolveSubagentMaxConcurrent(params.config),
    observedLocalModelProcessCount: residency.observedProcessCount,
    localModelObservationAvailable: residency.available,
  });
  const governed = decideControlDirectorResourceAdmission({
    selectedModel: profile.localModel,
    capacity: baseCapacity,
    residentModels: residency.residentModels,
    activeControlDirectorRuns,
    estimatedSelectedModelMemoryGb: profile.resourcePolicy.modelMemoryEstimateGb,
  });
  const admission = !profile.localSelectionReady
    ? queueDecision({
        selectedModel: profile.localModel,
        reason: "The configured Control Director model is not admitted by the evaluated registry.",
      })
    : !residency.available
      ? queueDecision({
          selectedModel: profile.localModel,
          reason:
            "Provider-owned model residency is unavailable; local admission remains fail-safe.",
        })
      : governed;
  const capacity: PccExecutionCapacitySnapshot = {
    ...baseCapacity,
    safeLocalAgentSlots:
      admission.decision === "queue" ? 0 : Math.min(1, baseCapacity.safeLocalAgentSlots),
    warnings: [
      ...baseCapacity.warnings,
      ...residency.warnings,
      `Control Director resource governor: ${admission.reason}`,
    ],
    controlDirectorAdmission: admission,
  };
  return {
    configured: true,
    agentId: director.id,
    selectedModel: profile.localModel,
    activeOpenClawTaskCount,
    activeControlDirectorRuns,
    residency,
    admission,
    hostCapacity: baseCapacity,
    capacity,
  };
}

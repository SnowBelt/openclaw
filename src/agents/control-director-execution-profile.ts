// One versioned execution profile shared by Chat, PCC, goals, and agent routing.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { PccExecutionProfile } from "../pcc/execution-profile.js";
import { DEFAULT_PCC_EXECUTION_PROFILE } from "../pcc/execution-profile.js";
import { buildControlDirectorModelRegistry } from "./control-director-model-registry.js";
import {
  CONTROL_DIRECTOR_DEFAULT_MODEL_ESTIMATE_GB,
  CONTROL_DIRECTOR_MODEL_MEMORY_RESERVE_GB,
} from "./control-director-resource-governor.js";
import { CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM } from "./control-director-slos.js";

export const CONTROL_DIRECTOR_EXECUTION_PROFILE_VERSION = 1 as const;

export type ControlDirectorExecutionProfile = {
  schemaVersion: typeof CONTROL_DIRECTOR_EXECUTION_PROFILE_VERSION;
  agentId: string;
  localModel: string;
  localAlternatives: string[];
  localSelectionReady: boolean;
  codex: {
    role: PccExecutionProfile["codexRole"];
    modelId: string;
    effort: PccExecutionProfile["codexEffort"];
    approvalScope: PccExecutionProfile["approvalScope"];
  };
  qualityMinimum: number;
  capacityPolicy: PccExecutionProfile["capacityPolicy"];
  resourcePolicy: {
    maxConcurrentLocalRuns: 1;
    modelMemoryEstimateGb: number;
    gatewayMemoryReserveGb: number;
  };
};

export function compileControlDirectorExecutionProfile(params: {
  config: OpenClawConfig;
  agentId: string;
  pccProfile?: PccExecutionProfile;
}): ControlDirectorExecutionProfile {
  const registry = buildControlDirectorModelRegistry(params);
  const pcc = params.pccProfile ?? DEFAULT_PCC_EXECUTION_PROFILE;
  return {
    schemaVersion: CONTROL_DIRECTOR_EXECUTION_PROFILE_VERSION,
    agentId: params.agentId,
    localModel:
      registry.selected.status === "ready" ? registry.selected.effective : registry.defaultModel,
    localAlternatives: registry.entries.map((entry) => entry.ref),
    localSelectionReady: registry.selected.status === "ready",
    codex: {
      role: pcc.codexRole,
      modelId: pcc.codexModelId,
      effort: pcc.codexEffort,
      approvalScope: pcc.approvalScope,
    },
    qualityMinimum: CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM,
    capacityPolicy: pcc.capacityPolicy,
    resourcePolicy: {
      maxConcurrentLocalRuns: 1,
      modelMemoryEstimateGb: CONTROL_DIRECTOR_DEFAULT_MODEL_ESTIMATE_GB,
      gatewayMemoryReserveGb: CONTROL_DIRECTOR_MODEL_MEMORY_RESERVE_GB,
    },
  };
}

// Post-ready, resource-governed warmup for the configured Control Director model.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { listTaskRecords } from "../tasks/runtime-internal.js";
import {
  assessControlDirectorResourceAdmission,
  type ControlDirectorAdmissionTask,
  type ControlDirectorResourceAssessment,
} from "./control-director-resource-admission.js";
import {
  collectControlDirectorResidencyObservation,
  requestControlDirectorModelWarmup,
  type ControlDirectorModelWarmupResult,
  type ControlDirectorResidencyObservation,
} from "./control-director-resource-runtime.js";
import {
  acquireSharedLocalModelAdmission,
  type LocalModelAdmissionLease,
} from "./local-model-admission.js";

export const CONTROL_DIRECTOR_STARTUP_KEEP_ALIVE_MS = 15 * 60_000;
export const CONTROL_DIRECTOR_STARTUP_WARMUP_TIMEOUT_MS = 3 * 60_000;

export type ControlDirectorStartupWarmupOutcome = {
  status: "not_configured" | "already_resident" | "deferred" | "warmed" | "cancelled" | "failed";
  reason: string;
  selectedModel?: string;
  providerResult?: ControlDirectorModelWarmupResult;
  residency?: ControlDirectorResidencyObservation;
};

type WarmupRuntime = {
  assess: typeof assessControlDirectorResourceAdmission;
  requestWarmup: typeof requestControlDirectorModelWarmup;
  collectResidency: typeof collectControlDirectorResidencyObservation;
  acquireSharedAdmission: typeof acquireSharedLocalModelAdmission;
};

const DEFAULT_RUNTIME: WarmupRuntime = {
  assess: assessControlDirectorResourceAdmission,
  requestWarmup: requestControlDirectorModelWarmup,
  collectResidency: collectControlDirectorResidencyObservation,
  acquireSharedAdmission: acquireSharedLocalModelAdmission,
};

function selectedModelIsResident(assessment: ControlDirectorResourceAssessment): boolean {
  return Boolean(
    assessment.selectedModel &&
    assessment.residency.residentModels.some((model) => model.ref === assessment.selectedModel),
  );
}

/**
 * Warm exactly one configured local model after Gateway readiness.
 *
 * The function never evicts another model, never bypasses the evaluated model
 * registry, and verifies provider-owned residency after the warmup request.
 */
export async function warmConfiguredControlDirectorModel(params: {
  config: OpenClawConfig;
  signal: AbortSignal;
  tasks?: readonly ControlDirectorAdmissionTask[];
  keepAliveMs?: number;
  timeoutMs?: number;
  runtime?: Partial<WarmupRuntime>;
}): Promise<ControlDirectorStartupWarmupOutcome> {
  if (params.signal.aborted) {
    return { status: "cancelled", reason: "Gateway shutdown cancelled model warmup." };
  }
  const runtime = { ...DEFAULT_RUNTIME, ...params.runtime };
  const assessment = await runtime.assess({
    config: params.config,
    tasks: params.tasks ?? listTaskRecords(),
  });
  if (!assessment.configured) {
    return {
      status: "not_configured",
      reason: "No Control Director role is configured; startup model warmup is not needed.",
    };
  }
  const selectedModel = assessment.selectedModel;
  if (!selectedModel || !assessment.admission) {
    return {
      status: "failed",
      reason: "Control Director resource assessment omitted the selected model or admission.",
    };
  }
  if (selectedModelIsResident(assessment)) {
    return {
      status: "already_resident",
      reason: `${selectedModel} is already resident; no warmup request was sent.`,
      selectedModel,
      residency: assessment.residency,
    };
  }
  if (assessment.admission.decision !== "admit" || assessment.admission.residency !== "load") {
    return {
      status: "deferred",
      reason: assessment.admission.reason,
      selectedModel,
      residency: assessment.residency,
    };
  }
  if (params.signal.aborted) {
    return {
      status: "cancelled",
      reason: "Gateway shutdown cancelled model warmup after admission.",
      selectedModel,
    };
  }
  let admission: LocalModelAdmissionLease;
  try {
    admission = await runtime.acquireSharedAdmission({
      owner: `openclaw:control-director-warmup:${selectedModel}`,
    });
  } catch (error) {
    return {
      status: "deferred",
      reason: `Local-model resource admission was not available: ${error instanceof Error ? error.message : String(error)}`,
      selectedModel,
      residency: assessment.residency,
    };
  }
  let providerResult: ControlDirectorModelWarmupResult;
  try {
    providerResult = await runtime.requestWarmup({
      config: params.config,
      selectedModel,
      keepAliveMs: params.keepAliveMs ?? CONTROL_DIRECTOR_STARTUP_KEEP_ALIVE_MS,
      timeoutMs: params.timeoutMs ?? CONTROL_DIRECTOR_STARTUP_WARMUP_TIMEOUT_MS,
      signal: params.signal,
    });
  } catch (error) {
    try {
      await admission.release();
    } catch {
      // The provider failure remains the primary diagnostic.
    }
    return {
      status: params.signal.aborted ? "cancelled" : "failed",
      reason: `Control Director model warmup failed: ${error instanceof Error ? error.message : String(error)}`,
      selectedModel,
    };
  }
  try {
    await admission.release();
  } catch (error) {
    return {
      status: "failed",
      reason: `Local-model resource admission could not be released: ${error instanceof Error ? error.message : String(error)}`,
      selectedModel,
      providerResult,
    };
  }
  if (!providerResult.ready) {
    return {
      status: params.signal.aborted ? "cancelled" : "failed",
      reason: providerResult.reason,
      selectedModel,
      providerResult,
    };
  }
  if (params.signal.aborted) {
    return {
      status: "cancelled",
      reason: "Gateway shutdown cancelled post-warmup residency verification.",
      selectedModel,
      providerResult,
    };
  }
  const residency = await runtime.collectResidency({
    config: params.config,
    selectedModel,
    activeLocalWork: false,
    timeoutMs: 3_000,
  });
  if (
    !residency.available ||
    !residency.residentModels.some((model) => model.ref === selectedModel)
  ) {
    return {
      status: "failed",
      reason: `Provider warmup returned ready, but ${selectedModel} was not present in the follow-up residency probe.`,
      selectedModel,
      providerResult,
      residency,
    };
  }
  return {
    status: "warmed",
    reason: `${selectedModel} is resident for the next Control Director turn.`,
    selectedModel,
    providerResult,
    residency,
  };
}

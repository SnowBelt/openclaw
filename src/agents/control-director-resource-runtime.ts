// Runtime-only bridge from a prepared provider hook to the pure resource governor.
import { parseModelCatalogRef } from "@openclaw/model-catalog-core/model-catalog-refs";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveLoadedProviderRuntimePlugin } from "../plugins/provider-hook-runtime.js";
import type {
  ProviderModelResidencySnapshot,
  ProviderModelWarmupResult,
} from "../plugins/types.js";
import type { ControlDirectorResidentModel } from "./control-director-resource-governor.js";

const GIB = 1024 ** 3;
const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_RESIDENT_MODELS = 32;

export type ControlDirectorResidencyObservation = {
  available: boolean;
  observedProcessCount: number;
  residentModels: ControlDirectorResidentModel[];
  warnings: string[];
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeControlDirectorResidencyObservation(params: {
  provider: string;
  snapshot: ProviderModelResidencySnapshot;
  activeLocalWork: boolean;
}): ControlDirectorResidencyObservation {
  const seen = new Set<string>();
  const residentModels = (
    Array.isArray(params.snapshot.residentModels) ? params.snapshot.residentModels : []
  ).flatMap((entry) => {
    const modelId = nonEmptyString(entry?.modelId);
    if (!modelId) {
      return [];
    }
    const ref = `${params.provider}/${modelId}`;
    if (seen.has(ref) || seen.size >= MAX_RESIDENT_MODELS) {
      return [];
    }
    seen.add(ref);
    const bytes = finiteNonNegative(entry.estimatedMemoryBytes);
    return [
      {
        ref,
        state: params.activeLocalWork ? ("active" as const) : entry.state,
        estimatedMemoryGb: bytes == null ? 0 : Math.round((bytes / GIB) * 10) / 10,
      },
    ];
  });
  const observed = finiteNonNegative(params.snapshot.observedProcessCount);
  return {
    available: true,
    observedProcessCount: Math.min(
      MAX_RESIDENT_MODELS,
      Math.max(residentModels.length, Math.floor(observed ?? 0)),
    ),
    residentModels,
    warnings: Array.isArray(params.snapshot.warnings)
      ? params.snapshot.warnings.filter((value): value is string => nonEmptyString(value) != null)
      : [],
  };
}

function unavailable(reason: string): ControlDirectorResidencyObservation {
  return {
    available: false,
    observedProcessCount: 0,
    residentModels: [],
    warnings: [reason],
  };
}

async function withDeadline<T>(params: {
  promise: Promise<T>;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      params.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(params.timeoutMessage)), params.timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Query only the already-loaded provider handle; never trigger broad plugin discovery here. */
export async function collectControlDirectorResidencyObservation(params: {
  config: OpenClawConfig;
  selectedModel: string;
  activeLocalWork: boolean;
  timeoutMs?: number;
}): Promise<ControlDirectorResidencyObservation> {
  const parsed = parseModelCatalogRef(params.selectedModel);
  if (!parsed) {
    return unavailable(
      "The selected Control Director model reference is invalid; residency is unavailable.",
    );
  }
  const plugin = resolveLoadedProviderRuntimePlugin({
    provider: parsed.provider,
    modelId: parsed.modelId,
    config: params.config,
  });
  if (!plugin?.probeModelResidency) {
    return unavailable(
      `Provider ${parsed.provider} does not expose a loaded runtime residency probe; admission remains fail-safe.`,
    );
  }
  const timeoutMs = Math.max(100, Math.min(5_000, params.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  try {
    const snapshot = await withDeadline({
      promise: plugin.probeModelResidency({
        config: params.config,
        provider: parsed.provider,
        modelId: parsed.modelId,
        timeoutMs,
      }),
      timeoutMs: timeoutMs + 100,
      timeoutMessage: "provider residency probe timed out",
    });
    if (!snapshot) {
      return unavailable(`Provider ${parsed.provider} returned no residency snapshot.`);
    }
    return normalizeControlDirectorResidencyObservation({
      provider: parsed.provider,
      snapshot,
      activeLocalWork: params.activeLocalWork,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(`Provider ${parsed.provider} residency probe failed: ${message}`);
  }
}

export type ControlDirectorModelWarmupResult = {
  available: boolean;
  ready: boolean;
  provider: string;
  modelId: string;
  result?: ProviderModelWarmupResult;
  reason: string;
};

/** Invoke only an already-loaded provider warmup hook after resource admission. */
export async function requestControlDirectorModelWarmup(params: {
  config: OpenClawConfig;
  selectedModel: string;
  keepAliveMs: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ControlDirectorModelWarmupResult> {
  const parsed = parseModelCatalogRef(params.selectedModel);
  if (!parsed) {
    return {
      available: false,
      ready: false,
      provider: "unknown",
      modelId: params.selectedModel,
      reason: "The selected Control Director model reference is invalid; warmup is unavailable.",
    };
  }
  const plugin = resolveLoadedProviderRuntimePlugin({
    provider: parsed.provider,
    modelId: parsed.modelId,
    config: params.config,
  });
  if (!plugin?.warmModel) {
    return {
      available: false,
      ready: false,
      provider: parsed.provider,
      modelId: parsed.modelId,
      reason: `Provider ${parsed.provider} does not expose a loaded runtime warmup hook.`,
    };
  }
  const timeoutMs = Math.max(
    1_000,
    Math.min(5 * 60_000, Math.floor(Number.isFinite(params.timeoutMs) ? params.timeoutMs : 1_000)),
  );
  try {
    const result = await withDeadline({
      promise: plugin.warmModel({
        config: params.config,
        provider: parsed.provider,
        modelId: parsed.modelId,
        timeoutMs,
        keepAliveMs: params.keepAliveMs,
        signal: params.signal,
      }),
      timeoutMs: timeoutMs + 250,
      timeoutMessage: "provider model warmup timed out",
    });
    if (!result?.ready) {
      return {
        available: true,
        ready: false,
        provider: parsed.provider,
        modelId: parsed.modelId,
        ...(result ? { result } : {}),
        reason: `Provider ${parsed.provider} did not confirm that the selected model is ready.`,
      };
    }
    return {
      available: true,
      ready: true,
      provider: parsed.provider,
      modelId: parsed.modelId,
      result,
      reason: `Provider ${parsed.provider} confirmed that ${parsed.modelId} is ready.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: true,
      ready: false,
      provider: parsed.provider,
      modelId: parsed.modelId,
      reason: `Provider ${parsed.provider} model warmup failed: ${message}`,
    };
  }
}

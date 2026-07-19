// Ollama owns the state-changing /api/generate contract used for safe model warmup.
import type {
  ProviderModelWarmupContext,
  ProviderModelWarmupResult,
} from "openclaw/plugin-sdk/plugin-entry";
import { readProviderJsonResponse } from "openclaw/plugin-sdk/provider-http";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { OLLAMA_DEFAULT_BASE_URL } from "./defaults.js";
import { isLocalOllamaBaseUrl } from "./discovery-shared.js";
import { readProviderBaseUrl } from "./provider-base-url.js";
import { buildOllamaBaseUrlSsrFPolicy, resolveOllamaApiBase } from "./provider-models.js";
import { resolveConfiguredOllamaProviderConfig } from "./stream.js";

const MIN_WARMUP_TIMEOUT_MS = 1_000;
const MAX_WARMUP_TIMEOUT_MS = 5 * 60_000;
const MIN_KEEP_ALIVE_MS = 60_000;
const MAX_KEEP_ALIVE_MS = 24 * 60 * 60_000;

type OllamaGenerateWarmupResponse = {
  model?: unknown;
  done?: unknown;
  total_duration?: unknown;
  load_duration?: unknown;
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundedFinite(value: number, fallback: number, minimum: number, maximum: number): number {
  return Math.max(
    minimum,
    Math.min(maximum, Math.floor(Number.isFinite(value) ? value : fallback)),
  );
}

function durationNanosecondsToMilliseconds(value: unknown): number | undefined {
  const nanoseconds = finiteNonNegative(value);
  return nanoseconds == null ? undefined : Math.round(nanoseconds / 1_000_000);
}

export function buildOllamaModelWarmupPayload(params: { modelId: string; keepAliveMs: number }): {
  model: string;
  prompt: "";
  stream: false;
  keep_alive: string;
} {
  const model = params.modelId.trim();
  if (!model) {
    throw new Error("Ollama model warmup requires a non-empty model id.");
  }
  const keepAliveMs = boundedFinite(
    params.keepAliveMs,
    MIN_KEEP_ALIVE_MS,
    MIN_KEEP_ALIVE_MS,
    MAX_KEEP_ALIVE_MS,
  );
  return {
    model,
    prompt: "",
    stream: false,
    keep_alive: `${Math.ceil(keepAliveMs / 60_000)}m`,
  };
}

export function parseOllamaModelWarmupResponse(params: {
  requestedModelId: string;
  value: unknown;
}): ProviderModelWarmupResult {
  if (!params.value || typeof params.value !== "object" || Array.isArray(params.value)) {
    throw new Error("Ollama model warmup returned a malformed response.");
  }
  const response = params.value as OllamaGenerateWarmupResponse;
  if (response.done !== true) {
    throw new Error("Ollama model warmup did not reach a terminal ready state.");
  }
  const observedModel =
    typeof response.model === "string" && response.model.trim()
      ? response.model.trim()
      : params.requestedModelId;
  const totalDurationMs = durationNanosecondsToMilliseconds(response.total_duration);
  const loadDurationMs = durationNanosecondsToMilliseconds(response.load_duration);
  return {
    modelId: observedModel,
    ready: true,
    ...(totalDurationMs == null ? {} : { totalDurationMs }),
    ...(loadDurationMs == null ? {} : { loadDurationMs }),
    ...(observedModel === params.requestedModelId
      ? {}
      : {
          warnings: [
            `Ollama reported warmed model ${observedModel} for requested model ${params.requestedModelId}.`,
          ],
        }),
  };
}

/** Load one already-installed local model without generating user-visible tokens. */
export async function warmOllamaModel(
  ctx: ProviderModelWarmupContext,
): Promise<ProviderModelWarmupResult> {
  if (ctx.signal.aborted) {
    throw new Error("Ollama model warmup was cancelled before it started.");
  }
  const providerConfig = resolveConfiguredOllamaProviderConfig({
    config: ctx.config,
    providerId: ctx.provider,
  });
  const configuredBaseUrl = readProviderBaseUrl(providerConfig) ?? OLLAMA_DEFAULT_BASE_URL;
  if (!isLocalOllamaBaseUrl(configuredBaseUrl)) {
    throw new Error("Ollama model warmup is restricted to local or private-network runtimes.");
  }
  const apiBase = resolveOllamaApiBase(configuredBaseUrl);
  const timeoutMs = boundedFinite(
    ctx.timeoutMs,
    MIN_WARMUP_TIMEOUT_MS,
    MIN_WARMUP_TIMEOUT_MS,
    MAX_WARMUP_TIMEOUT_MS,
  );
  const payload = buildOllamaModelWarmupPayload({
    modelId: ctx.modelId,
    keepAliveMs: ctx.keepAliveMs,
  });
  const guarded = await fetchWithSsrFGuard({
    url: `${apiBase}/api/generate`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
    },
    policy: buildOllamaBaseUrlSsrFPolicy(apiBase),
    auditContext: "ollama-model-warmup/api/generate",
  });
  try {
    if (!guarded.response.ok) {
      throw new Error(`Ollama model warmup failed with HTTP ${guarded.response.status}`);
    }
    return parseOllamaModelWarmupResponse({
      requestedModelId: ctx.modelId,
      value: await readProviderJsonResponse<unknown>(
        guarded.response,
        "ollama-model-warmup/api/generate",
      ),
    });
  } finally {
    await guarded.release();
  }
}

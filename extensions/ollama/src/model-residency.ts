// Ollama owns the /api/ps contract used to report loaded local models.
import type {
  ProviderModelResidencyContext,
  ProviderModelResidencySnapshot,
} from "openclaw/plugin-sdk/plugin-entry";
import { readProviderJsonResponse } from "openclaw/plugin-sdk/provider-http";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { OLLAMA_DEFAULT_BASE_URL } from "./defaults.js";
import { readProviderBaseUrl } from "./provider-base-url.js";
import { buildOllamaBaseUrlSsrFPolicy, resolveOllamaApiBase } from "./provider-models.js";
import { resolveConfiguredOllamaProviderConfig } from "./stream.js";

type OllamaPsModel = {
  name?: unknown;
  model?: unknown;
  digest?: unknown;
  size?: unknown;
  size_vram?: unknown;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseOllamaModelResidencyPayload(value: unknown): ProviderModelResidencySnapshot {
  const models =
    value && typeof value === "object" && Array.isArray((value as { models?: unknown }).models)
      ? ((value as { models: OllamaPsModel[] }).models ?? [])
      : [];
  const residentModels = models.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const modelId = nonEmptyString(entry.name) ?? nonEmptyString(entry.model);
    if (!modelId) {
      return [];
    }
    const estimatedMemoryBytes =
      finiteNonNegative(entry.size_vram) ?? finiteNonNegative(entry.size);
    const modelDigest = nonEmptyString(entry.digest);
    return [
      {
        modelId,
        state: "idle" as const,
        ...(estimatedMemoryBytes == null ? {} : { estimatedMemoryBytes }),
        ...(modelDigest ? { modelDigest } : {}),
      },
    ];
  });
  return {
    residentModels,
    observedProcessCount: residentModels.length,
    warnings:
      residentModels.length > 0
        ? [
            "Ollama reports loaded models but not request activity; OpenClaw treats them as idle only when no local task is active.",
          ]
        : [],
  };
}

export async function probeOllamaModelResidency(
  ctx: ProviderModelResidencyContext,
): Promise<ProviderModelResidencySnapshot> {
  const providerConfig = resolveConfiguredOllamaProviderConfig({
    config: ctx.config,
    providerId: ctx.provider,
  });
  const apiBase = resolveOllamaApiBase(
    readProviderBaseUrl(providerConfig) ?? OLLAMA_DEFAULT_BASE_URL,
  );
  const guarded = await fetchWithSsrFGuard({
    url: `${apiBase}/api/ps`,
    init: { signal: AbortSignal.timeout(Math.max(100, Math.min(5_000, ctx.timeoutMs))) },
    policy: buildOllamaBaseUrlSsrFPolicy(apiBase),
    auditContext: "ollama-model-residency/api/ps",
  });
  try {
    if (!guarded.response.ok) {
      throw new Error(`Ollama /api/ps failed with HTTP ${guarded.response.status}`);
    }
    return parseOllamaModelResidencyPayload(
      await readProviderJsonResponse<unknown>(guarded.response, "ollama-model-residency/api/ps"),
    );
  } finally {
    await guarded.release();
  }
}

import type { JsonSchemaObject } from "openclaw/plugin-sdk/json-schema-runtime";
import {
  fetchWithSsrFGuard,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
} from "openclaw/plugin-sdk/ssrf-runtime";

export type OllamaModelInventoryEntry = {
  name: string;
  model: string;
  sizeBytes: number;
  sizeVramBytes?: number;
  contextLength?: number;
  processor?: string;
  expiresAt?: string;
  parameterSize?: string;
  quantization?: string;
  loaded: boolean;
};

export type OllamaInventory = {
  baseUrl: string;
  reachable: boolean;
  checkedAt: string;
  models: OllamaModelInventoryEntry[];
  totalLoadedBytes: number;
  error?: string;
};

export type OllamaStructuredJsonResult = {
  text: string;
  durationMs?: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  doneReason?: string;
};

type ProviderConfigRecord = {
  baseUrl?: unknown;
  baseURL?: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function resolveOllamaBaseUrl(config: unknown): string {
  const root = asRecord(config);
  const models = asRecord(root?.models);
  const providers = asRecord(models?.providers);
  const ollama = asRecord(providers?.ollama) as ProviderConfigRecord | undefined;
  const configured = readString(ollama?.baseUrl) ?? readString(ollama?.baseURL);
  return (configured ?? "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/\/v1$/i, "");
}

async function fetchJson(params: {
  baseUrl: string;
  pathname: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const guarded = await fetchWithSsrFGuard({
    url: `${params.baseUrl}${params.pathname}`,
    init: { method: "GET", headers: { accept: "application/json" } },
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    policy: ssrfPolicyFromHttpBaseUrlAllowedHostname(params.baseUrl),
    auditContext: "research-manager.ollama-inventory",
  });
  try {
    if (!guarded.response.ok) {
      throw new Error(`Ollama returned HTTP ${guarded.response.status} for ${params.pathname}`);
    }
    return (await guarded.response.json()) as unknown;
  } finally {
    await guarded.release();
  }
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const nanoseconds = readNonNegativeNumber(value);
  return nanoseconds === undefined ? undefined : Math.round(nanoseconds / 1_000_000);
}

function resolveOllamaThinkValue(
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined,
): boolean | "low" | "medium" | "high" | undefined {
  if (thinking === "off") {
    return false;
  }
  if (thinking === "minimal" || thinking === "low") {
    return "low";
  }
  if (thinking === "medium" || thinking === "high") {
    return thinking;
  }
  if (thinking === "xhigh" || thinking === "max") {
    return "high";
  }
  return undefined;
}

export async function runOllamaStructuredJson(params: {
  config?: unknown;
  baseUrl?: string;
  model: string;
  system: string;
  prompt: string;
  schema: JsonSchemaObject;
  contextTokens: number;
  maxTokens?: number;
  temperature?: number;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<OllamaStructuredJsonResult> {
  const baseUrl = params.baseUrl?.replace(/\/+$/, "") ?? resolveOllamaBaseUrl(params.config);
  const options: Record<string, unknown> = {
    num_ctx: Math.max(1_024, Math.floor(params.contextTokens)),
    ...(params.maxTokens !== undefined
      ? { num_predict: Math.max(1, Math.floor(params.maxTokens)) }
      : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
  };
  const think = resolveOllamaThinkValue(params.thinking);
  const guarded = await fetchWithSsrFGuard({
    url: `${baseUrl}/api/chat`,
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.prompt },
        ],
        stream: false,
        format: params.schema,
        ...(think !== undefined ? { think } : {}),
        keep_alive: "30m",
        options,
      }),
      signal: params.signal,
    },
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    policy: ssrfPolicyFromHttpBaseUrlAllowedHostname(baseUrl),
    auditContext: "research-manager.ollama-structured-json",
  });
  try {
    if (!guarded.response.ok) {
      throw new Error(`Ollama returned HTTP ${guarded.response.status} for /api/chat`);
    }
    const payload = asRecord((await guarded.response.json()) as unknown);
    const message = asRecord(payload?.message);
    const text = readString(message?.content);
    const doneReason = readString(payload?.done_reason);
    if (!text) {
      const thinkingLength = readString(message?.thinking)?.length ?? 0;
      throw new Error(
        thinkingLength > 0
          ? `Ollama returned thinking without final content (${thinkingLength} characters)`
          : "Ollama returned empty output",
      );
    }
    const input = readNonNegativeNumber(payload?.prompt_eval_count);
    const output = readNonNegativeNumber(payload?.eval_count);
    return {
      text,
      ...(nanosecondsToMilliseconds(payload?.total_duration) !== undefined
        ? { durationMs: nanosecondsToMilliseconds(payload?.total_duration) }
        : {}),
      ...(input !== undefined || output !== undefined
        ? {
            tokenUsage: {
              ...(input !== undefined ? { input } : {}),
              ...(output !== undefined ? { output } : {}),
              ...(input !== undefined && output !== undefined ? { total: input + output } : {}),
            },
          }
        : {}),
      ...(doneReason ? { doneReason } : {}),
    };
  } finally {
    await guarded.release();
  }
}

function parseModel(raw: unknown, loaded: boolean): OllamaModelInventoryEntry | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const name = readString(record.name) ?? readString(record.model);
  const model = readString(record.model) ?? name;
  if (!name || !model) {
    return undefined;
  }
  const details = asRecord(record.details);
  return {
    name,
    model,
    sizeBytes: Math.floor(readNonNegativeNumber(record.size) ?? 0),
    ...(readNonNegativeNumber(record.size_vram) !== undefined
      ? { sizeVramBytes: Math.floor(readNonNegativeNumber(record.size_vram) ?? 0) }
      : {}),
    ...(readNonNegativeNumber(record.context_length) !== undefined
      ? { contextLength: Math.floor(readNonNegativeNumber(record.context_length) ?? 0) }
      : {}),
    ...(readString(record.processor) ? { processor: readString(record.processor) } : {}),
    ...(readString(record.expires_at) ? { expiresAt: readString(record.expires_at) } : {}),
    ...(readString(details?.parameter_size)
      ? { parameterSize: readString(details?.parameter_size) }
      : {}),
    ...(readString(details?.quantization_level)
      ? { quantization: readString(details?.quantization_level) }
      : {}),
    loaded,
  };
}

function parseModels(payload: unknown, loaded: boolean): OllamaModelInventoryEntry[] {
  const models = asRecord(payload)?.models;
  if (!Array.isArray(models)) {
    return [];
  }
  return models.flatMap((entry) => {
    const parsed = parseModel(entry, loaded);
    return parsed ? [parsed] : [];
  });
}

export function normalizeOllamaModelName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/:latest$/, "");
}

export function ollamaModelMatches(candidate: string, requested: string): boolean {
  return normalizeOllamaModelName(candidate) === normalizeOllamaModelName(requested);
}

export function findOllamaModel(
  inventory: OllamaInventory,
  requested: string,
): OllamaModelInventoryEntry | undefined {
  return inventory.models.find(
    (entry) =>
      ollamaModelMatches(entry.name, requested) || ollamaModelMatches(entry.model, requested),
  );
}

export async function readOllamaInventory(params: {
  config?: unknown;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<OllamaInventory> {
  const baseUrl = params.baseUrl?.replace(/\/+$/, "") ?? resolveOllamaBaseUrl(params.config);
  const checkedAt = new Date().toISOString();
  try {
    const tags = await fetchJson({
      baseUrl,
      pathname: "/api/tags",
      timeoutMs: params.timeoutMs ?? 2_500,
      fetchImpl: params.fetchImpl,
    });
    const running = await fetchJson({
      baseUrl,
      pathname: "/api/ps",
      timeoutMs: params.timeoutMs ?? 2_500,
      fetchImpl: params.fetchImpl,
    }).catch(() => ({ models: [] }));
    const installed = parseModels(tags, false);
    const loaded = parseModels(running, true);
    const merged = new Map<string, OllamaModelInventoryEntry>();
    for (const entry of installed) {
      merged.set(normalizeOllamaModelName(entry.model), entry);
    }
    for (const entry of loaded) {
      const key = normalizeOllamaModelName(entry.model);
      merged.set(key, { ...(merged.get(key) ?? entry), ...entry, loaded: true });
    }
    return {
      baseUrl,
      reachable: true,
      checkedAt,
      models: [...merged.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
      totalLoadedBytes: loaded.reduce(
        (sum, entry) => sum + (entry.sizeVramBytes ?? entry.sizeBytes),
        0,
      ),
    };
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      checkedAt,
      models: [],
      totalLoadedBytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

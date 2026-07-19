// Canonical, config-derived model registry for the Control Director role.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveConfiguredControlDirectorAgent } from "./control-director-role.js";
import {
  CONTROL_DIRECTOR_DEFAULT_ALIAS,
  CONTROL_DIRECTOR_DEFAULT_DISPLAY_LABEL,
  CONTROL_DIRECTOR_DEFAULT_MODEL,
  CONTROL_DIRECTOR_DEFAULT_MODEL_ID,
  CONTROL_DIRECTOR_DEFAULT_PROVIDER,
} from "./control-director-role.js";

export const CONTROL_DIRECTOR_MODEL_REGISTRY_VERSION = 1 as const;

export type ControlDirectorModelRegistryEntry = {
  ref: string;
  provider: string;
  modelId: string;
  label: string;
  aliases: string[];
  source: "default" | "provider_catalog" | "agent_default" | "fallback";
};

export type ControlDirectorModelSelection =
  | {
      status: "ready";
      requested: string;
      effective: string;
      entry: ControlDirectorModelRegistryEntry;
    }
  | { status: "unavailable"; requested: string; reason: string };

export type ControlDirectorModelRegistry = {
  schemaVersion: typeof CONTROL_DIRECTOR_MODEL_REGISTRY_VERSION;
  defaultModel: string;
  entries: ControlDirectorModelRegistryEntry[];
  selected: ControlDirectorModelSelection;
  fallbacks: string[];
};

function splitModelRef(ref: string): { provider: string; modelId: string } | null {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    return null;
  }
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

function selectedModelRef(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const primary = (value as { primary?: unknown }).primary;
    return typeof primary === "string" && primary.trim() ? primary.trim() : undefined;
  }
  return undefined;
}

function selectedFallbacks(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const fallbacks = (value as { fallbacks?: unknown }).fallbacks;
  return Array.isArray(fallbacks)
    ? fallbacks.filter(
        (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
}

function addEntry(
  entries: Map<string, ControlDirectorModelRegistryEntry>,
  input: ControlDirectorModelRegistryEntry,
): void {
  const existing = entries.get(input.ref);
  entries.set(input.ref, {
    ...(existing ?? input),
    aliases: [...new Set([...(existing?.aliases ?? []), ...input.aliases])].toSorted(),
    label: existing?.label || input.label,
    source: existing?.source ?? input.source,
  });
}

function aliasMap(config: OpenClawConfig): Map<string, string> {
  const aliases = new Map<string, string>();
  const configured = config.agents?.defaults?.models ?? {};
  for (const [ref, settings] of Object.entries(configured)) {
    const alias = settings?.alias?.trim();
    if (alias) {
      aliases.set(alias.toLocaleLowerCase(), ref);
    }
  }
  aliases.set(CONTROL_DIRECTOR_DEFAULT_ALIAS.toLocaleLowerCase(), CONTROL_DIRECTOR_DEFAULT_MODEL);
  return aliases;
}

export function normalizeControlDirectorModelRef(config: OpenClawConfig, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return CONTROL_DIRECTOR_DEFAULT_MODEL;
  }
  return aliasMap(config).get(trimmed.toLocaleLowerCase()) ?? trimmed;
}

/** Build selectable alternatives from the active config, never from agent name or stale model identity. */
export function buildControlDirectorModelRegistry(params: {
  config: OpenClawConfig;
  agentId: string;
}): ControlDirectorModelRegistry {
  const entries = new Map<string, ControlDirectorModelRegistryEntry>();
  addEntry(entries, {
    ref: CONTROL_DIRECTOR_DEFAULT_MODEL,
    provider: CONTROL_DIRECTOR_DEFAULT_PROVIDER,
    modelId: CONTROL_DIRECTOR_DEFAULT_MODEL_ID,
    label: CONTROL_DIRECTOR_DEFAULT_DISPLAY_LABEL,
    aliases: [CONTROL_DIRECTOR_DEFAULT_ALIAS],
    source: "default",
  });

  for (const [provider, providerConfig] of Object.entries(params.config.models?.providers ?? {})) {
    const models = (providerConfig as { models?: unknown }).models;
    if (!Array.isArray(models)) {
      continue;
    }
    for (const model of models) {
      if (!model || typeof model !== "object" || Array.isArray(model)) {
        continue;
      }
      const id = (model as { id?: unknown }).id;
      if (typeof id !== "string" || !id.trim()) {
        continue;
      }
      const ref = `${provider}/${id.trim()}`;
      const name = (model as { name?: unknown }).name;
      addEntry(entries, {
        ref,
        provider,
        modelId: id.trim(),
        label: typeof name === "string" && name.trim() ? name.trim() : id.trim(),
        aliases: [],
        source: "provider_catalog",
      });
    }
  }

  for (const [rawRef, settings] of Object.entries(params.config.agents?.defaults?.models ?? {})) {
    const ref = normalizeControlDirectorModelRef(params.config, rawRef);
    const split = splitModelRef(ref);
    if (!split) {
      continue;
    }
    const alias = settings?.alias?.trim();
    addEntry(entries, {
      ref,
      ...split,
      label: alias || split.modelId,
      aliases: alias ? [alias] : [],
      source: "agent_default",
    });
  }

  const configuredAgent = resolveConfiguredControlDirectorAgent(params.config, params.agentId);
  const requestedRaw = selectedModelRef(configuredAgent?.model) ?? CONTROL_DIRECTOR_DEFAULT_MODEL;
  const requested = normalizeControlDirectorModelRef(params.config, requestedRaw);
  const fallbacks = selectedFallbacks(configuredAgent?.model).map((ref) =>
    normalizeControlDirectorModelRef(params.config, ref),
  );
  for (const ref of fallbacks) {
    const split = splitModelRef(ref);
    if (split) {
      addEntry(entries, {
        ref,
        ...split,
        label: split.modelId,
        aliases: [],
        source: "fallback",
      });
    }
  }
  const entry = entries.get(requested);
  return {
    schemaVersion: CONTROL_DIRECTOR_MODEL_REGISTRY_VERSION,
    defaultModel: CONTROL_DIRECTOR_DEFAULT_MODEL,
    entries: [...entries.values()].toSorted((left, right) =>
      left.ref === CONTROL_DIRECTOR_DEFAULT_MODEL
        ? -1
        : right.ref === CONTROL_DIRECTOR_DEFAULT_MODEL
          ? 1
          : left.label.localeCompare(right.label),
    ),
    selected: entry
      ? { status: "ready", requested: requestedRaw, effective: requested, entry }
      : {
          status: "unavailable",
          requested: requestedRaw,
          reason: `Selected Control Director model is not in the configured provider/default catalog: ${requested}`,
        },
    fallbacks: [...new Set(fallbacks)],
  };
}

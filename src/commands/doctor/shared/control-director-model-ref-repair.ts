/** Doctor repair for canonical Control Director Gemma/Ollama model references. */
import {
  canonicalizeControlDirectorModelRef,
  CONTROL_DIRECTOR_PRIMARY_MODEL,
  isControlDirectorAgentConfig,
} from "../../../agents/control-director-model-ref.js";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import type { DoctorConfigMutationResult } from "./config-mutation-state.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeModelMetadata(existing: unknown, replacement: unknown): unknown {
  if (isRecord(existing) && isRecord(replacement)) {
    return { ...replacement, ...existing };
  }
  return existing ?? replacement;
}

function rewriteModelValue(value: unknown): {
  value: unknown;
  changed: boolean;
  before?: string;
  after?: string;
} {
  if (typeof value === "string") {
    const canonical = canonicalizeControlDirectorModelRef(value);
    return canonical && canonical !== value
      ? { value: canonical, changed: true, before: value, after: canonical }
      : { value, changed: false };
  }
  if (!isRecord(value) || typeof value.primary !== "string") {
    return { value, changed: false };
  }
  const canonical = canonicalizeControlDirectorModelRef(value.primary);
  if (!canonical || canonical === value.primary) {
    return { value, changed: false };
  }
  return {
    value: { ...value, primary: canonical },
    changed: true,
    before: value.primary,
    after: canonical,
  };
}

export function maybeRepairControlDirectorGemmaModelRefs(
  cfg: OpenClawConfig,
): DoctorConfigMutationResult {
  const candidate = structuredClone(cfg);
  const changes: string[] = [];
  const agents = candidate.agents;
  if (!agents) {
    return { config: cfg, changes };
  }

  const defaults = agents.defaults;
  if (defaults?.model !== undefined) {
    const rewritten = rewriteModelValue(defaults.model);
    if (rewritten.changed) {
      defaults.model = rewritten.value as typeof defaults.model;
      changes.push(
        `Rewrote agents.defaults.model Control Director Gemma ref from "${rewritten.before}" to "${rewritten.after}".`,
      );
    }
  }

  const defaultModels = defaults?.models;
  if (defaultModels) {
    for (const key of Object.keys(defaultModels)) {
      const canonicalKey = canonicalizeControlDirectorModelRef(key);
      if (
        !canonicalKey ||
        canonicalKey === key ||
        canonicalKey !== CONTROL_DIRECTOR_PRIMARY_MODEL
      ) {
        continue;
      }
      defaultModels[canonicalKey] = mergeModelMetadata(
        defaultModels[canonicalKey],
        defaultModels[key],
      ) as NonNullable<(typeof defaultModels)[string]>;
      delete defaultModels[key];
      changes.push(
        `Rewrote agents.defaults.models key "${key}" to "${CONTROL_DIRECTOR_PRIMARY_MODEL}".`,
      );
    }
  }

  for (const agent of agents.list ?? []) {
    if (!isControlDirectorAgentConfig(agent)) {
      continue;
    }
    const rewritten = rewriteModelValue(agent.model);
    if (!rewritten.changed) {
      continue;
    }
    agent.model = rewritten.value as typeof agent.model;
    const agentLabel = agent.id?.trim() || agent.name?.trim() || "Control Director";
    changes.push(
      `Rewrote agents.list.${agentLabel}.model Control Director Gemma ref from "${rewritten.before}" to "${rewritten.after}".`,
    );
  }

  return changes.length > 0 ? { config: candidate, changes } : { config: cfg, changes };
}

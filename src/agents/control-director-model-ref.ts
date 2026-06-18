/** Control Director model reference constants and canonicalization helpers. */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { normalizeAgentId } from "../routing/session-key.js";

export const CONTROL_DIRECTOR_PRIMARY_PROVIDER = "ollama";
export const CONTROL_DIRECTOR_PRIMARY_ALIAS = "openclaw-control-gemma4-31b-q8";
export const CONTROL_DIRECTOR_PRIMARY_MODEL_ID = "openclaw-control-gemma4-31b-q8:latest";
export const CONTROL_DIRECTOR_PRIMARY_MODEL = `${CONTROL_DIRECTOR_PRIMARY_PROVIDER}/${CONTROL_DIRECTOR_PRIMARY_MODEL_ID}`;
export const CONTROL_DIRECTOR_FIRST_FALLBACK_MODEL = "ollama/openclaw-control-qwen25-32b:latest";

const CONTROL_DIRECTOR_AGENT_IDS = new Set(["main", "control-director"]);
const CONTROL_DIRECTOR_MODEL_ALIASES = new Map<string, string>([
  [CONTROL_DIRECTOR_PRIMARY_ALIAS, CONTROL_DIRECTOR_PRIMARY_MODEL],
  [CONTROL_DIRECTOR_PRIMARY_MODEL_ID, CONTROL_DIRECTOR_PRIMARY_MODEL],
  [CONTROL_DIRECTOR_PRIMARY_MODEL, CONTROL_DIRECTOR_PRIMARY_MODEL],
  [
    `${CONTROL_DIRECTOR_PRIMARY_PROVIDER}/${CONTROL_DIRECTOR_PRIMARY_ALIAS}`,
    CONTROL_DIRECTOR_PRIMARY_MODEL,
  ],
]);

export function isControlDirectorAgentId(agentId: string | undefined | null): boolean {
  const normalized = normalizeAgentId(agentId ?? "");
  return normalized ? CONTROL_DIRECTOR_AGENT_IDS.has(normalized) : false;
}

export function isControlDirectorAgentConfig(
  agent: { id?: unknown; name?: unknown } | undefined,
): boolean {
  if (!agent) {
    return false;
  }
  if (typeof agent.id === "string" && isControlDirectorAgentId(agent.id)) {
    return true;
  }
  return typeof agent.name === "string"
    ? normalizeLowercaseStringOrEmpty(agent.name) === "control director"
    : false;
}

export function canonicalizeControlDirectorModelRef(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return trimmed;
  }
  return CONTROL_DIRECTOR_MODEL_ALIASES.get(normalizeLowercaseStringOrEmpty(trimmed)) ?? trimmed;
}

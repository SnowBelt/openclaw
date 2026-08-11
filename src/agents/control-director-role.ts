/** Stable role and default-model helpers for the Control Director runtime. */
import type { AgentConfig } from "../config/types.agents.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

export const CONTROL_DIRECTOR_ROLE = "control_director" as const;

export const CONTROL_DIRECTOR_DEFAULT_PROVIDER = "ollama" as const;
export const CONTROL_DIRECTOR_DEFAULT_ALIAS = "openclaw-control-gemma4-31b-q8" as const;
export const CONTROL_DIRECTOR_DEFAULT_MODEL_ID = "openclaw-control-gemma4-31b-q8:latest" as const;
export const CONTROL_DIRECTOR_DEFAULT_MODEL =
  `${CONTROL_DIRECTOR_DEFAULT_PROVIDER}/${CONTROL_DIRECTOR_DEFAULT_MODEL_ID}` as const;
export const CONTROL_DIRECTOR_DEFAULT_DISPLAY_LABEL =
  "OpenClaw Control Gemma 4 31B IT Dense Q8" as const;
export const CONTROL_DIRECTOR_DEFAULT_UNDERLYING_OLLAMA_TAG =
  "hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0" as const;

export type ControlDirectorConfiguredAgent = Pick<
  AgentConfig,
  "id" | "name" | "role" | "model" | "utilityModel" | "skills"
>;

/**
 * Resolve Control Director scope only from the stable operational role.
 * No id, name, identity, or selected model is a runtime authorization bypass.
 */
export function resolveConfiguredControlDirectorAgent(
  config: OpenClawConfig | undefined,
  agentId: string | undefined | null,
): ControlDirectorConfiguredAgent | undefined {
  const normalizedAgentId = agentId?.trim().toLowerCase();
  if (!normalizedAgentId) {
    return undefined;
  }
  const configured = config?.agents?.list?.find(
    (entry) => entry.id.trim().toLowerCase() === normalizedAgentId,
  );
  if (configured?.role === CONTROL_DIRECTOR_ROLE) {
    return configured;
  }
  return undefined;
}

export function isConfiguredControlDirectorAgent(params: {
  config?: OpenClawConfig;
  agentId?: string | undefined | null;
}): boolean {
  return Boolean(resolveConfiguredControlDirectorAgent(params.config, params.agentId));
}

export function resolveConfiguredControlDirectorPrimaryModel(params: {
  config?: OpenClawConfig;
  agentId?: string | undefined | null;
}): string | undefined {
  const agent = resolveConfiguredControlDirectorAgent(params.config, params.agentId);
  if (!agent) {
    return undefined;
  }
  return typeof agent.model === "string" ? agent.model : agent.model?.primary;
}

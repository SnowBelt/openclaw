import { CURATOR_MAX_OUTPUT_TOKENS, CURATOR_PROMPT_BUDGET_CHARS } from "./contract.js";

export type CuratorModelCapabilityObservation = {
  modelRef: string;
  supportsTextCompletion: boolean;
  acceptsStructuredJson: boolean;
  contextTokens: number;
  maxOutputTokens: number;
  requiredContextTokens: number;
};

export type CuratorModelCapabilityResult = {
  ok: boolean;
  modelRef: string;
  issues: string[];
  requirements: {
    promptBudgetChars: number;
    maxOutputTokens: number;
  };
};

export function evaluateCuratorModelCapabilities(
  observation: CuratorModelCapabilityObservation,
): CuratorModelCapabilityResult {
  const issues: string[] = [];
  if (!observation.modelRef.trim()) {
    issues.push("model reference is required");
  }
  const requiredContextTokens = observation.requiredContextTokens;
  if (!Number.isFinite(requiredContextTokens) || requiredContextTokens < 0) {
    issues.push("required curator context budget must be a non-negative finite number");
  }
  if (!observation.supportsTextCompletion) {
    issues.push("model must support bounded text completion");
  }
  if (!observation.acceptsStructuredJson) {
    issues.push("model/provider must return a structured JSON recommendation");
  }
  if (
    !Number.isFinite(observation.contextTokens) ||
    observation.contextTokens < requiredContextTokens + CURATOR_MAX_OUTPUT_TOKENS
  ) {
    issues.push("model context is smaller than the bounded curator review packet");
  }
  if (
    !Number.isFinite(observation.maxOutputTokens) ||
    observation.maxOutputTokens < CURATOR_MAX_OUTPUT_TOKENS
  ) {
    issues.push(`model output budget must be at least ${CURATOR_MAX_OUTPUT_TOKENS} tokens`);
  }
  return {
    ok: issues.length === 0,
    modelRef: observation.modelRef,
    issues,
    requirements: {
      promptBudgetChars: CURATOR_PROMPT_BUDGET_CHARS,
      maxOutputTokens: CURATOR_MAX_OUTPUT_TOKENS,
    },
  };
}

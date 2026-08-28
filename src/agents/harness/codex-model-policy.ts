/**
 * OpenClaw's floor for every run that is dispatched to the Codex harness.
 *
 * Keep this policy in the harness seam rather than in a provider catalog. A
 * catalog controls discovery; this policy controls what may actually run.
 */

export const CODEX_DEFAULT_MODEL_ID = "gpt-5.6-luna";
export const CODEX_DEFAULT_THINKING_LEVEL = "max" as const;

// Keep this allowlist exact. A suffix such as `-mini`, `-lite`, or `-preview`
// can describe a materially different model and must not inherit Luna's floor
// or an upgrade approval accidentally.
const CODEX_UPGRADE_MODEL_IDS = new Set(["gpt-5.6-sol", "gpt-5.6-terra"]);
const CODEX_BASELINE_MODEL_IDS = new Set([CODEX_DEFAULT_MODEL_ID]);
const MIN_UPGRADE_REASON_LENGTH = 12;

export type CodexModelPolicyDecision =
  | {
      status: "baseline";
      modelId: string;
      requiredThinkingLevel: typeof CODEX_DEFAULT_THINKING_LEVEL;
    }
  | {
      status: "upgrade";
      modelId: string;
      requiredThinkingLevel: typeof CODEX_DEFAULT_THINKING_LEVEL;
      upgradeReason: string;
    }
  | {
      status: "blocked";
      modelId: string;
      reason: string;
    };

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function normalizeUpgradeReason(reason: unknown): string | undefined {
  if (typeof reason !== "string") {
    return undefined;
  }
  const normalized = reason.trim().replace(/\s+/gu, " ");
  return normalized.length >= MIN_UPGRADE_REASON_LENGTH ? normalized : undefined;
}

function isUpgradeModelId(modelId: string): boolean {
  return CODEX_UPGRADE_MODEL_IDS.has(normalizeModelId(modelId));
}

export function isCodexPolicyBaselineModel(modelId: string): boolean {
  return CODEX_BASELINE_MODEL_IDS.has(normalizeModelId(modelId));
}

export function isCodexPolicyUpgradeModel(modelId: string): boolean {
  return isUpgradeModelId(modelId);
}

export function isCodexPolicyManagedModel(modelId: string): boolean {
  return isCodexPolicyBaselineModel(modelId) || isUpgradeModelId(modelId);
}

/** Map OpenClaw's canonical `max` level to the exact Codex app-server enum. */
export function resolveCodexMaxReasoningEffort(modelId: string): "max" | "ultra" | undefined {
  if (isUpgradeModelId(modelId)) {
    return "ultra";
  }
  if (isCodexPolicyBaselineModel(modelId)) {
    return "max";
  }
  return undefined;
}

export function readCodexUpgradeReason(modelParams: unknown): string | undefined {
  if (!modelParams || typeof modelParams !== "object" || Array.isArray(modelParams)) {
    return undefined;
  }
  return normalizeUpgradeReason((modelParams as Record<string, unknown>).codexUpgradeReason);
}

export function readCodexUpgradeReasonFromConfig(
  config: unknown,
  modelId: string,
): string | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return undefined;
  }
  const agents = (config as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    return undefined;
  }
  const defaults = (agents as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    return undefined;
  }
  const models = (defaults as Record<string, unknown>).models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return undefined;
  }
  const modelRefs = new Set(
    [
      `codex-cli/${modelId}`,
      `openai/${modelId}`,
      `codex/${modelId}`,
      `openai-codex/${modelId}`,
    ].map((ref) => ref.trim().toLowerCase()),
  );
  for (const [modelRef, entry] of Object.entries(models)) {
    if (!modelRefs.has(modelRef.trim().toLowerCase())) {
      continue;
    }
    const params =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).params
        : undefined;
    const reason = readCodexUpgradeReason(params);
    if (reason) {
      return reason;
    }
  }
  return undefined;
}

export function resolveCodexModelPolicy(params: {
  modelId: string;
  upgradeReason?: unknown;
}): CodexModelPolicyDecision {
  const modelId = params.modelId.trim();
  const normalizedModelId = normalizeModelId(modelId);
  if (isCodexPolicyBaselineModel(normalizedModelId)) {
    return {
      status: "baseline",
      modelId,
      requiredThinkingLevel: CODEX_DEFAULT_THINKING_LEVEL,
    };
  }

  if (isUpgradeModelId(normalizedModelId)) {
    const upgradeReason = normalizeUpgradeReason(params.upgradeReason);
    if (!upgradeReason) {
      return {
        status: "blocked",
        modelId,
        reason:
          `Codex model ${modelId} is an approved upgrade candidate but has no concrete ` +
          'reason. Configure agents.defaults.models["provider/model"].params.codexUpgradeReason.',
      };
    }
    return {
      status: "upgrade",
      modelId,
      requiredThinkingLevel: CODEX_DEFAULT_THINKING_LEVEL,
      upgradeReason,
    };
  }

  return {
    status: "blocked",
    modelId,
    reason:
      `Codex model ${modelId || "(empty)"} is below the enforced floor ` +
      `${CODEX_DEFAULT_MODEL_ID} with ${CODEX_DEFAULT_THINKING_LEVEL} effort.`,
  };
}

export function assertCodexModelPolicy(params: {
  modelId: string;
  thinkLevel: string;
  upgradeReason?: unknown;
}): Exclude<CodexModelPolicyDecision, { status: "blocked" }> {
  const decision = resolveCodexModelPolicy({
    modelId: params.modelId,
    upgradeReason: params.upgradeReason,
  });
  if (decision.status === "blocked") {
    throw new Error(`[codex-model-policy] ${decision.reason}`);
  }
  if (params.thinkLevel !== CODEX_DEFAULT_THINKING_LEVEL) {
    throw new Error(
      `[codex-model-policy] ${decision.modelId} requires ${CODEX_DEFAULT_THINKING_LEVEL} ` +
        `effort; received ${params.thinkLevel || "unset"}.`,
    );
  }
  return decision;
}

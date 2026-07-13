import type { PccAiUsePolicy } from "./project-workflows.js";

export const PCC_EXECUTION_PROFILE_SCHEMA_VERSION = 1 as const;
export const PCC_BEST_AVAILABLE_MODEL_ID = "best_available" as const;

export type PccExecutionSpeed = "focused" | "parallel" | "ultra";
export type PccCodexRole = "off" | "checkpoints" | "hard_work" | "lead";
export type PccCapacityPolicy = "automatic" | "conservative" | "maximum_safe";
export type PccCodexEffort = "medium" | "high" | "xhigh" | "max";
export type PccApprovalScope = "plan" | "project" | "ask";
export type PccExecutionProfilePresetId =
  | "local_focused"
  | "local_parallel"
  | "ultra_local"
  | "balanced"
  | "ultra_hybrid";

export type PccExecutionProfile = {
  schemaVersion: typeof PCC_EXECUTION_PROFILE_SCHEMA_VERSION;
  presetId: PccExecutionProfilePresetId;
  speed: PccExecutionSpeed;
  codexRole: PccCodexRole;
  capacityPolicy: PccCapacityPolicy;
  localModelId: string;
  codexModelId: string;
  codexEffort: PccCodexEffort;
  approvalScope: PccApprovalScope;
};

export type PccModelSelectionValidation =
  | { status: "best_available"; modelId: typeof PCC_BEST_AVAILABLE_MODEL_ID }
  | { status: "valid"; modelId: string }
  | { status: "unavailable"; modelId: string };

export type PccEstimatedAgentCounts = {
  availableCapacity: number;
  localAgents: number;
  codexAgents: 0 | 1;
  totalAgents: number;
};

const SPEEDS = ["focused", "parallel", "ultra"] as const;
const CODEX_ROLES = ["off", "checkpoints", "hard_work", "lead"] as const;
const CAPACITY_POLICIES = ["automatic", "conservative", "maximum_safe"] as const;
const CODEX_EFFORTS = ["medium", "high", "xhigh", "max"] as const;
const APPROVAL_SCOPES = ["plan", "project", "ask"] as const;
const PRESET_IDS = [
  "local_focused",
  "local_parallel",
  "ultra_local",
  "balanced",
  "ultra_hybrid",
] as const;

export const PCC_EXECUTION_PROFILE_PRESET_IDS: readonly PccExecutionProfilePresetId[] = PRESET_IDS;

const PRESETS: Record<PccExecutionProfilePresetId, PccExecutionProfile> = {
  local_focused: {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: "local_focused",
    speed: "focused",
    codexRole: "off",
    capacityPolicy: "conservative",
    localModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexEffort: "medium",
    approvalScope: "plan",
  },
  local_parallel: {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: "local_parallel",
    speed: "parallel",
    codexRole: "off",
    capacityPolicy: "automatic",
    localModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexEffort: "medium",
    approvalScope: "plan",
  },
  ultra_local: {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: "ultra_local",
    speed: "ultra",
    codexRole: "off",
    capacityPolicy: "maximum_safe",
    localModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexEffort: "medium",
    approvalScope: "project",
  },
  balanced: {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: "balanced",
    speed: "parallel",
    codexRole: "checkpoints",
    capacityPolicy: "automatic",
    localModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexEffort: "high",
    approvalScope: "project",
  },
  ultra_hybrid: {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: "ultra_hybrid",
    speed: "ultra",
    codexRole: "lead",
    capacityPolicy: "maximum_safe",
    localModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexModelId: PCC_BEST_AVAILABLE_MODEL_ID,
    codexEffort: "max",
    approvalScope: "ask",
  },
};

export const DEFAULT_PCC_EXECUTION_PROFILE: PccExecutionProfile = PRESETS.local_focused;

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : "";
}

function modelId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function presetId(value: unknown): PccExecutionProfilePresetId | undefined {
  return isOneOf(value, PRESET_IDS) ? value : undefined;
}

function profileFromCanonical(value: unknown): PccExecutionProfile {
  const source = metadataObject(value);
  const base = resolvePccExecutionProfilePreset(presetId(source.presetId) ?? "local_focused");
  return {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: presetId(source.presetId) ?? base.presetId,
    speed: isOneOf(source.speed, SPEEDS) ? source.speed : base.speed,
    codexRole: isOneOf(source.codexRole, CODEX_ROLES) ? source.codexRole : base.codexRole,
    capacityPolicy: isOneOf(source.capacityPolicy, CAPACITY_POLICIES)
      ? source.capacityPolicy
      : base.capacityPolicy,
    localModelId: modelId(source.localModelId, base.localModelId),
    codexModelId: modelId(source.codexModelId, base.codexModelId),
    codexEffort:
      normalizedText(source.codexEffort) === "ultra"
        ? "max"
        : isOneOf(source.codexEffort, CODEX_EFFORTS)
          ? source.codexEffort
          : base.codexEffort,
    approvalScope: isOneOf(source.approvalScope, APPROVAL_SCOPES)
      ? source.approvalScope
      : base.approvalScope,
  };
}

function legacyPreset(metadata: Record<string, unknown>): PccExecutionProfilePresetId {
  const routingObject = metadataObject(metadata.pccAiRouting);
  const policy = normalizedText(metadata.pccAiUsePolicy ?? routingObject.policy);
  if (policy === "local_only") {
    return "local_focused";
  }
  if (policy === "codex_focused" || policy === "codex_expert") {
    return "balanced";
  }
  if (policy === "codex_everything") {
    return "ultra_hybrid";
  }

  const routing = normalizedText(
    routingObject.profile ?? routingObject.mode ?? routingObject.teamStyle ?? metadata.pccAiRouting,
  );
  if (routing.includes("local") && !routing.includes("codex")) {
    return routing.includes("ultra") ? "ultra_local" : "local_parallel";
  }
  if (routing.includes("codex") || routing.includes("hybrid")) {
    return routing.includes("ultra") || routing.includes("all") ? "ultra_hybrid" : "balanced";
  }

  const planner = normalizedText(
    metadata.pccPlannerMode ??
      routingObject.plannerMode ??
      metadata.pccPlanner ??
      metadata.pccPlannerStrategy,
  );
  if (planner === "codex_full_plan" || planner.includes("codex")) {
    return "balanced";
  }
  return "local_focused";
}

function profileFromLegacy(metadata: Record<string, unknown>): PccExecutionProfile {
  const base = resolvePccExecutionProfilePreset(legacyPreset(metadata));
  const routing = metadataObject(metadata.pccAiRouting);
  const plannerRole = normalizedText(metadata.pccPlannerCodexRole ?? routing.codexRole);
  const plannerModelId =
    metadata.pccPlannerCodexModelId ??
    routing.codexModelId ??
    metadata.pccPlannerModelId ??
    metadata.pccPlannerModel;
  const legacyEffort = normalizedText(metadata.pccPlannerCodexEffort ?? routing.codexEffort);
  const legacyReasoning = normalizedText(routing.codexReasoning);
  const legacyScope = normalizedText(routing.permissionScope);
  return {
    ...base,
    codexRole: isOneOf(plannerRole, CODEX_ROLES) ? plannerRole : base.codexRole,
    speed: isOneOf(metadata.pccPlannerSpeed, SPEEDS) ? metadata.pccPlannerSpeed : base.speed,
    capacityPolicy: isOneOf(metadata.pccPlannerCapacityPolicy, CAPACITY_POLICIES)
      ? metadata.pccPlannerCapacityPolicy
      : base.capacityPolicy,
    localModelId: modelId(
      metadata.pccLocalModelId ?? routing.localModelId ?? metadata.pccPlannerLocalModelId,
      base.localModelId,
    ),
    codexModelId: modelId(metadata.pccCodexModelId ?? plannerModelId, base.codexModelId),
    codexEffort:
      legacyEffort === "ultra"
        ? "max"
        : isOneOf(legacyEffort, CODEX_EFFORTS)
          ? legacyEffort
          : legacyReasoning === "high"
            ? "high"
            : base.codexEffort,
    approvalScope: isOneOf(metadata.pccPlannerApprovalScope, APPROVAL_SCOPES)
      ? metadata.pccPlannerApprovalScope
      : isOneOf(legacyScope, APPROVAL_SCOPES)
        ? legacyScope
        : base.approvalScope,
  };
}

/**
 * Normalizes persisted PCC metadata without invoking a model. A canonical profile is authoritative:
 * when present, legacy routing and planner fields are deliberately ignored rather than merged.
 */
export function normalizePccExecutionProfile(metadata: unknown): PccExecutionProfile {
  const source = metadataObject(metadata);
  if (Object.hasOwn(source, "pccExecutionProfile")) {
    return profileFromCanonical(source.pccExecutionProfile);
  }
  return profileFromLegacy(source);
}

export function resolvePccExecutionProfilePreset(
  id: PccExecutionProfilePresetId,
): PccExecutionProfile {
  return { ...PRESETS[id] };
}

export function summarizePccExecutionProfile(profile: PccExecutionProfile): string {
  const codex = profile.codexRole === "off" ? "Codex off" : `Codex ${profile.codexRole}`;
  return `${profile.speed} local execution; ${codex}; ${profile.capacityPolicy} capacity; approvals: ${profile.approvalScope}.`;
}

/** Maps the canonical role to the existing workflow-responsibility policy only. */
export function derivePccAiUsePolicy(profile: PccExecutionProfile): PccAiUsePolicy {
  switch (profile.codexRole) {
    case "off":
      return "local_only";
    case "checkpoints":
      return "codex_focused";
    case "hard_work":
      return "codex_expert";
    case "lead":
      return "codex_everything";
    default: {
      const unsupportedRole: never = profile.codexRole;
      throw new Error(`Unsupported PCC Codex role: ${String(unsupportedRole)}`);
    }
  }
}

export function validatePccModelSelection(
  selectedModelId: string,
  availableRefs: readonly string[],
): PccModelSelectionValidation {
  const normalizedModelId = selectedModelId.trim();
  if (normalizedModelId === PCC_BEST_AVAILABLE_MODEL_ID) {
    return { status: "best_available", modelId: PCC_BEST_AVAILABLE_MODEL_ID };
  }
  return availableRefs.includes(normalizedModelId)
    ? { status: "valid", modelId: normalizedModelId }
    : { status: "unavailable", modelId: normalizedModelId };
}

/** Maximum is a GPT-5.6-only Codex depth; other depths remain catalog/provider-owned. */
export function pccCodexEffortIsSupported(modelRef: string, effort: PccCodexEffort): boolean {
  if (effort !== "max") {
    return true;
  }
  return /(?:^|[/:])gpt-5\.6(?:-|$)/u.test(modelRef.trim().toLowerCase());
}

function safeCapacity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function localAgentLimit(profile: PccExecutionProfile): number {
  const speedLimit = profile.speed === "focused" ? 1 : profile.speed === "parallel" ? 4 : 12;
  return profile.capacityPolicy === "conservative" ? 1 : speedLimit;
}

/** Resolves an estimate only; it does not reserve capacity or invoke local/Codex models. */
export function resolvePccEstimatedAgentCounts(
  profile: PccExecutionProfile,
  availableCapacity: number,
): PccEstimatedAgentCounts {
  const capacity = safeCapacity(availableCapacity);
  // Host capacity constrains local workers only. A separately approved Codex role is remote and
  // must not silently consume or reduce a local worker slot.
  const codexAgents: 0 | 1 = profile.codexRole === "off" ? 0 : 1;
  const localAgents = Math.min(localAgentLimit(profile), capacity);
  return {
    availableCapacity: capacity,
    localAgents,
    codexAgents,
    totalAgents: localAgents + codexAgents,
  };
}

import type { PccAiUsePolicy } from "./project-workflows.js";

export const PCC_EXECUTION_PROFILE_SCHEMA_VERSION = 2 as const;
export const PCC_BEST_AVAILABLE_MODEL_ID = "best_available" as const;

export type PccExecutionSpeed = "focused" | "parallel" | "ultra";
export type PccCodexRole = "off" | "checkpoints" | "hard_work" | "lead";
export type PccCapacityPolicy = "automatic" | "conservative" | "maximum_safe";
export type PccCodexEffort = "medium" | "high" | "xhigh" | "max";
export type PccApprovalScope = "plan" | "project" | "ask";
export type PccCodexPolicyId = "local_only" | "recommended_minimum" | "more_oversight" | "custom";
export type PccCodexCheckpointId =
  | "material_replan"
  | "architecture_review"
  | "blocked_recovery"
  | "final_review";
export type PccCodexCheckpointMode = "local" | "codex" | "automatic";
export type PccCodexCheckpointPolicy = Record<PccCodexCheckpointId, PccCodexCheckpointMode>;
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
  codexMaxEffort: PccCodexEffort;
  codexPolicyId: PccCodexPolicyId;
  codexCheckpoints: PccCodexCheckpointPolicy;
  approvalScope: PccApprovalScope;
};

export type PccCodexCheckpointResolution = {
  checkpoint: PccCodexCheckpointId;
  policyId: PccCodexPolicyId;
  executor: "local_ai" | "codex";
  modelId: string | null;
  effort: PccCodexEffort | null;
  automatic: boolean;
  requiresApproval: boolean;
  trigger:
    | "explicit_local"
    | "automatic_local"
    | "explicit_codex"
    | "high_impact"
    | "repeated_local_failure";
  rationale: string;
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
const CODEX_POLICY_IDS = ["local_only", "recommended_minimum", "more_oversight", "custom"] as const;
const CHECKPOINT_MODES = ["local", "codex", "automatic"] as const;
const PRESET_IDS = [
  "local_focused",
  "local_parallel",
  "ultra_local",
  "balanced",
  "ultra_hybrid",
] as const;

export const PCC_EXECUTION_PROFILE_PRESET_IDS: readonly PccExecutionProfilePresetId[] = PRESET_IDS;

const LOCAL_ONLY_CHECKPOINTS: PccCodexCheckpointPolicy = {
  material_replan: "local",
  architecture_review: "local",
  blocked_recovery: "local",
  final_review: "local",
};

const RECOMMENDED_MINIMUM_CHECKPOINTS: PccCodexCheckpointPolicy = {
  material_replan: "codex",
  architecture_review: "automatic",
  blocked_recovery: "automatic",
  final_review: "codex",
};

const MORE_OVERSIGHT_CHECKPOINTS: PccCodexCheckpointPolicy = {
  material_replan: "codex",
  architecture_review: "codex",
  blocked_recovery: "codex",
  final_review: "codex",
};

function checkpointsForPolicy(id: PccCodexPolicyId): PccCodexCheckpointPolicy {
  switch (id) {
    case "local_only":
      return { ...LOCAL_ONLY_CHECKPOINTS };
    case "recommended_minimum":
      return { ...RECOMMENDED_MINIMUM_CHECKPOINTS };
    case "more_oversight":
      return { ...MORE_OVERSIGHT_CHECKPOINTS };
    case "custom":
      return { ...RECOMMENDED_MINIMUM_CHECKPOINTS };
    default:
      throw new Error(`Unsupported Codex policy: ${String(id)}`);
  }
}

function codexRoleForPolicy(id: PccCodexPolicyId): PccCodexRole {
  switch (id) {
    case "local_only":
      return "off";
    case "recommended_minimum":
      return "checkpoints";
    case "more_oversight":
      return "hard_work";
    case "custom":
      return "checkpoints";
    default:
      throw new Error(`Unsupported Codex policy: ${String(id)}`);
  }
}

function codexRoleForCheckpointPolicy(
  id: PccCodexPolicyId,
  checkpoints: PccCodexCheckpointPolicy,
): PccCodexRole {
  return Object.values(checkpoints).every((value) => value === "local")
    ? "off"
    : codexRoleForPolicy(id);
}

function policyForLegacyRole(role: PccCodexRole): PccCodexPolicyId {
  switch (role) {
    case "off":
      return "local_only";
    case "checkpoints":
      return "recommended_minimum";
    case "hard_work":
    case "lead":
      return "more_oversight";
    default:
      throw new Error(`Unsupported Codex role: ${String(role)}`);
  }
}

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
    codexMaxEffort: "high",
    codexPolicyId: "local_only",
    codexCheckpoints: checkpointsForPolicy("local_only"),
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
    codexMaxEffort: "high",
    codexPolicyId: "local_only",
    codexCheckpoints: checkpointsForPolicy("local_only"),
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
    codexMaxEffort: "high",
    codexPolicyId: "local_only",
    codexCheckpoints: checkpointsForPolicy("local_only"),
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
    codexEffort: "medium",
    codexMaxEffort: "high",
    codexPolicyId: "recommended_minimum",
    codexCheckpoints: checkpointsForPolicy("recommended_minimum"),
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
    codexMaxEffort: "max",
    codexPolicyId: "more_oversight",
    codexCheckpoints: checkpointsForPolicy("more_oversight"),
    approvalScope: "ask",
  },
};

export const DEFAULT_PCC_EXECUTION_PROFILE: PccExecutionProfile = {
  ...PRESETS.local_parallel,
  codexRole: "checkpoints",
  codexPolicyId: "recommended_minimum",
  codexCheckpoints: checkpointsForPolicy("recommended_minimum"),
  approvalScope: "project",
};

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
  const legacyRole = isOneOf(source.codexRole, CODEX_ROLES) ? source.codexRole : base.codexRole;
  const codexPolicyId = isOneOf(source.codexPolicyId, CODEX_POLICY_IDS)
    ? source.codexPolicyId
    : policyForLegacyRole(legacyRole);
  const rawCheckpoints = metadataObject(source.codexCheckpoints);
  const policyCheckpoints = checkpointsForPolicy(codexPolicyId);
  const codexCheckpoints = Object.fromEntries(
    Object.entries(policyCheckpoints).map(([checkpoint, fallback]) => [
      checkpoint,
      isOneOf(rawCheckpoints[checkpoint], CHECKPOINT_MODES) ? rawCheckpoints[checkpoint] : fallback,
    ]),
  ) as PccCodexCheckpointPolicy;
  return {
    schemaVersion: PCC_EXECUTION_PROFILE_SCHEMA_VERSION,
    presetId: presetId(source.presetId) ?? base.presetId,
    speed: isOneOf(source.speed, SPEEDS) ? source.speed : base.speed,
    codexRole: codexRoleForCheckpointPolicy(codexPolicyId, codexCheckpoints),
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
    codexMaxEffort:
      normalizedText(source.codexMaxEffort) === "ultra"
        ? "max"
        : isOneOf(source.codexMaxEffort, CODEX_EFFORTS)
          ? source.codexMaxEffort
          : base.codexMaxEffort,
    codexPolicyId,
    codexCheckpoints,
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
    codexMaxEffort: base.codexMaxEffort,
    codexPolicyId: policyForLegacyRole(
      isOneOf(plannerRole, CODEX_ROLES) ? plannerRole : base.codexRole,
    ),
    codexCheckpoints: checkpointsForPolicy(
      policyForLegacyRole(isOneOf(plannerRole, CODEX_ROLES) ? plannerRole : base.codexRole),
    ),
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
  return { ...PRESETS[id], codexCheckpoints: { ...PRESETS[id].codexCheckpoints } };
}

function compatiblePresetId(
  speed: PccExecutionSpeed,
  codexPolicyId: PccCodexPolicyId,
): PccExecutionProfilePresetId {
  if (codexPolicyId === "local_only") {
    return speed === "focused"
      ? "local_focused"
      : speed === "parallel"
        ? "local_parallel"
        : "ultra_local";
  }
  return speed === "ultra" ? "ultra_hybrid" : "balanced";
}

export function applyPccLocalExecutionPreset(
  profile: PccExecutionProfile,
  speed: PccExecutionSpeed,
): PccExecutionProfile {
  const localPreset =
    speed === "focused"
      ? PRESETS.local_focused
      : speed === "parallel"
        ? PRESETS.local_parallel
        : PRESETS.ultra_local;
  return {
    ...profile,
    presetId: compatiblePresetId(speed, profile.codexPolicyId),
    speed: localPreset.speed,
    capacityPolicy: localPreset.capacityPolicy,
  };
}

export function applyPccCodexPolicy(
  profile: PccExecutionProfile,
  codexPolicyId: PccCodexPolicyId,
): PccExecutionProfile {
  return {
    ...profile,
    presetId: compatiblePresetId(profile.speed, codexPolicyId),
    codexPolicyId,
    codexRole: codexRoleForPolicy(codexPolicyId),
    codexCheckpoints: checkpointsForPolicy(codexPolicyId),
    codexEffort: codexPolicyId === "more_oversight" ? "high" : "medium",
    codexMaxEffort: codexPolicyId === "more_oversight" ? "max" : "high",
  };
}

export function updatePccCodexCheckpoint(
  profile: PccExecutionProfile,
  checkpoint: PccCodexCheckpointId,
  mode: PccCodexCheckpointMode,
): PccExecutionProfile {
  const codexCheckpoints = { ...profile.codexCheckpoints, [checkpoint]: mode };
  return {
    ...profile,
    codexPolicyId: "custom",
    codexRole: Object.values(codexCheckpoints).every((value) => value === "local")
      ? "off"
      : "checkpoints",
    codexCheckpoints,
  };
}

export function summarizePccExecutionProfile(profile: PccExecutionProfile): string {
  const speed =
    profile.speed === "focused"
      ? "one local worker"
      : profile.speed === "parallel"
        ? "parallel local workers"
        : "maximum safe local workers";
  const codex =
    profile.codexPolicyId === "local_only"
      ? "Codex off after initial planning"
      : profile.codexPolicyId === "recommended_minimum"
        ? "Codex handles major replans, helps when needed, and reviews completion"
        : profile.codexPolicyId === "more_oversight"
          ? "Codex reviews every major checkpoint"
          : "custom Codex checkpoints";
  return `${speed}; ${codex}.`;
}

function effortRank(effort: PccCodexEffort): number {
  return CODEX_EFFORTS.indexOf(effort);
}

function clampEffort(requested: PccCodexEffort, maximum: PccCodexEffort): PccCodexEffort {
  return effortRank(requested) <= effortRank(maximum) ? requested : maximum;
}

export function resolvePccCodexCheckpoint(params: {
  profile: PccExecutionProfile;
  checkpoint: PccCodexCheckpointId;
  localAttemptCount?: number;
  highImpact?: boolean;
  codexApproved?: boolean;
  approvedMaxEffort?: PccCodexEffort;
}): PccCodexCheckpointResolution {
  const mode = params.profile.codexCheckpoints[params.checkpoint];
  const automatic = mode === "automatic";
  const automaticCodex =
    automatic &&
    (params.highImpact === true ||
      (params.checkpoint === "blocked_recovery" && (params.localAttemptCount ?? 0) >= 2));
  const useCodex = mode === "codex" || automaticCodex;
  if (!useCodex) {
    return {
      checkpoint: params.checkpoint,
      policyId: params.profile.codexPolicyId,
      executor: "local_ai",
      modelId: null,
      effort: null,
      automatic,
      requiresApproval: false,
      trigger: mode === "local" ? "explicit_local" : "automatic_local",
      rationale:
        mode === "local"
          ? "This checkpoint is explicitly assigned to local AI."
          : "Automatic kept this checkpoint local because no escalation trigger was met.",
    };
  }
  const requestedEffort: PccCodexEffort = params.highImpact ? "high" : params.profile.codexEffort;
  const effort = clampEffort(requestedEffort, params.profile.codexMaxEffort);
  const effortIsApproved =
    params.codexApproved === true &&
    params.approvedMaxEffort !== undefined &&
    effortRank(effort) <= effortRank(params.approvedMaxEffort);
  return {
    checkpoint: params.checkpoint,
    policyId: params.profile.codexPolicyId,
    executor: "codex",
    modelId: params.profile.codexModelId,
    effort,
    automatic,
    requiresApproval: !effortIsApproved,
    trigger: automaticCodex
      ? params.highImpact
        ? "high_impact"
        : "repeated_local_failure"
      : "explicit_codex",
    rationale: automatic
      ? params.highImpact
        ? "Automatic selected Codex because this is a high-impact checkpoint."
        : "Automatic selected Codex after two documented local attempts."
      : "The project policy assigns this checkpoint to Codex.",
  };
}

/** Maps the canonical role to the existing workflow-responsibility policy only. */
export function derivePccAiUsePolicy(profile: PccExecutionProfile): PccAiUsePolicy {
  if (profile.codexRole === "off") {
    return "local_only";
  }
  switch (profile.codexPolicyId) {
    case "local_only":
      return "local_only";
    case "recommended_minimum":
    case "custom":
      return "codex_focused";
    case "more_oversight":
      return "codex_expert";
    default: {
      const unsupportedPolicy: never = profile.codexPolicyId;
      throw new Error(`Unsupported PCC Codex policy: ${String(unsupportedPolicy)}`);
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
  if (profile.speed === "focused") {
    return 1;
  }
  if (profile.capacityPolicy === "conservative") {
    return 2;
  }
  return Number.POSITIVE_INFINITY;
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

// Project Command Center guided work-loop helpers keep project automation bounded and proof-gated.
import type {
  PccCompletionReceipt,
  PccMilestone,
  PccPermissionGrant,
  PccPermissionType,
  PccProject,
  PccStatus,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  PCC_CAPABILITY_CONTRACT_SCHEMA,
  type PccCapabilityInventoryEntry,
  type PccCapabilityResolution,
  resolvePccProjectCapabilities,
} from "./capability-contract.js";
import { evaluatePccProjectSetup } from "./intake-quality.js";
import { pccMetadataObject, pccResponsibilityForItem } from "./metadata.js";

export type PccWorkLoopState =
  | "idle"
  | "working"
  | "paused"
  | "blocked"
  | "waiting_for_permission"
  | "waiting_for_codex"
  | "waiting_for_remote_proof"
  | "proof_failed"
  | "complete";

export type PccParallelWorkMode = "off" | "plan_only" | "local_agents_only" | "supervised";

export type PccWorkLoopLaneSettings = {
  user: boolean;
  localOpenClawAgent: boolean;
  localModel: boolean;
  codex: boolean;
  highReasoningCodex: boolean;
  remoteProof: boolean;
};

export type PccWorkLoopSettings = {
  enabled: boolean;
  state: PccWorkLoopState;
  stopBeforeCodex: boolean;
  stopBeforeRemoteProof: boolean;
  stopBeforeDestructiveAction: boolean;
  stopAfterCurrentTask: boolean;
  stopAfterCurrentMilestone: boolean;
  continueAroundBlockers: boolean;
  parallelWorkMode: PccParallelWorkMode;
  lanes: PccWorkLoopLaneSettings;
  activeMilestoneId?: string;
  activeSubMilestoneId?: string;
  lastLoopMessage?: string;
  updatedAt?: string;
};

export type PccWorkLoopProject = {
  project: PccProject;
  milestones: readonly PccMilestone[];
  subMilestones?: readonly PccSubMilestone[];
  permissions?: readonly PccPermissionGrant[];
  receipts?: readonly PccCompletionReceipt[];
  capabilityInventory?: readonly PccCapabilityInventoryEntry[];
};

export type PccWorkLoopBlockerKind =
  | "paused"
  | "stop_after_current"
  | "project_complete"
  | "milestone_not_actionable"
  | "missing_permission"
  | "codex_required"
  | "remote_proof_required"
  | "destructive_action_required"
  | "lane_disabled"
  | "workspace_locked"
  | "setup_not_ready"
  | "missing_capability"
  | "missing_plan"
  | "missing_acceptance_criteria"
  | "proof_failed";

export type PccWorkLoopBlocker = {
  kind: PccWorkLoopBlockerKind;
  message: string;
  milestoneId?: string;
  subMilestoneId?: string;
  permissionIds?: string[];
};

export type PccWorkLoopNext = {
  milestone: PccMilestone | null;
  subMilestone: PccSubMilestone | null;
  blocker: PccWorkLoopBlocker | null;
  taskPrompt: string | null;
  state: PccWorkLoopState;
};

const DEFAULT_LANES: PccWorkLoopLaneSettings = {
  user: true,
  localOpenClawAgent: true,
  localModel: true,
  codex: false,
  highReasoningCodex: false,
  remoteProof: false,
};

const DEFAULT_SETTINGS: PccWorkLoopSettings = {
  enabled: false,
  state: "idle",
  stopBeforeCodex: true,
  stopBeforeRemoteProof: true,
  stopBeforeDestructiveAction: true,
  stopAfterCurrentTask: false,
  stopAfterCurrentMilestone: false,
  continueAroundBlockers: true,
  parallelWorkMode: "off",
  lanes: DEFAULT_LANES,
};

const TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);
const HELD_STATUSES = new Set<PccStatus>(["blocked", "deferred", "on_hold", "needs_approval"]);
const CODEX_PERMISSION_TYPES = new Set<PccPermissionType>(["codex_usage", "high_reasoning_model"]);
const REMOTE_PERMISSION_TYPES = new Set<PccPermissionType>(["remote_proof", "external_write"]);
const DESTRUCTIVE_PERMISSION_TYPES = new Set<PccPermissionType>(["external_write"]);
const CODEX_RESPONSIBILITIES = new Set(["codex", "high_reasoning_codex"]);
const REMOTE_RESPONSIBILITIES = new Set(["remote_proof"]);
const HARD_STOP_BLOCKERS = new Set<PccWorkLoopBlockerKind>([
  "paused",
  "stop_after_current",
  "project_complete",
  "missing_permission",
  "codex_required",
  "remote_proof_required",
  "destructive_action_required",
  "setup_not_ready",
  "missing_capability",
  "proof_failed",
]);
const WORK_LOOP_STATES: readonly PccWorkLoopState[] = [
  "idle",
  "working",
  "paused",
  "blocked",
  "waiting_for_permission",
  "waiting_for_codex",
  "waiting_for_remote_proof",
  "proof_failed",
  "complete",
];
const PARALLEL_WORK_MODES: readonly PccParallelWorkMode[] = [
  "off",
  "plan_only",
  "local_agents_only",
  "supervised",
];

type WorkItem = PccMilestone | PccSubMilestone;

function metadataObject(value: unknown): Record<string, unknown> {
  return pccMetadataObject(value);
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function laneSettings(value: unknown): PccWorkLoopLaneSettings {
  const raw = metadataObject(value);
  return {
    user: booleanSetting(raw.user, DEFAULT_LANES.user),
    localOpenClawAgent: booleanSetting(raw.localOpenClawAgent, DEFAULT_LANES.localOpenClawAgent),
    localModel: booleanSetting(raw.localModel, DEFAULT_LANES.localModel),
    codex: booleanSetting(raw.codex, DEFAULT_LANES.codex),
    highReasoningCodex: booleanSetting(raw.highReasoningCodex, DEFAULT_LANES.highReasoningCodex),
    remoteProof: booleanSetting(raw.remoteProof, DEFAULT_LANES.remoteProof),
  };
}

export function getPccWorkLoopSettings(project: PccProject): PccWorkLoopSettings {
  const raw = metadataObject(metadataObject(project.metadata).pccWorkLoop);
  const state = stringSetting(raw.state, WORK_LOOP_STATES, DEFAULT_SETTINGS.state);
  return {
    enabled: booleanSetting(raw.enabled, DEFAULT_SETTINGS.enabled),
    state,
    stopBeforeCodex: booleanSetting(raw.stopBeforeCodex, DEFAULT_SETTINGS.stopBeforeCodex),
    stopBeforeRemoteProof: booleanSetting(
      raw.stopBeforeRemoteProof,
      DEFAULT_SETTINGS.stopBeforeRemoteProof,
    ),
    stopBeforeDestructiveAction: booleanSetting(
      raw.stopBeforeDestructiveAction,
      DEFAULT_SETTINGS.stopBeforeDestructiveAction,
    ),
    stopAfterCurrentTask: booleanSetting(
      raw.stopAfterCurrentTask,
      DEFAULT_SETTINGS.stopAfterCurrentTask,
    ),
    stopAfterCurrentMilestone: booleanSetting(
      raw.stopAfterCurrentMilestone,
      DEFAULT_SETTINGS.stopAfterCurrentMilestone,
    ),
    continueAroundBlockers: booleanSetting(
      raw.continueAroundBlockers,
      DEFAULT_SETTINGS.continueAroundBlockers,
    ),
    parallelWorkMode: stringSetting(
      raw.parallelWorkMode,
      PARALLEL_WORK_MODES,
      DEFAULT_SETTINGS.parallelWorkMode,
    ),
    lanes: laneSettings(raw.lanes),
    ...(typeof raw.activeMilestoneId === "string"
      ? { activeMilestoneId: raw.activeMilestoneId }
      : {}),
    ...(typeof raw.activeSubMilestoneId === "string"
      ? { activeSubMilestoneId: raw.activeSubMilestoneId }
      : {}),
    ...(typeof raw.lastLoopMessage === "string" ? { lastLoopMessage: raw.lastLoopMessage } : {}),
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
  };
}

export function withPccWorkLoopSettings(
  project: PccProject,
  patch: Partial<PccWorkLoopSettings>,
  updatedAt: string,
): PccProject {
  const settings = { ...getPccWorkLoopSettings(project), ...patch, updatedAt };
  return {
    ...project,
    metadata: {
      ...metadataObject(project.metadata),
      pccWorkLoop: settings,
    },
  };
}

function orderedMilestones(input: PccWorkLoopProject): PccMilestone[] {
  return input.milestones
    .filter((milestone) => milestone.projectId === input.project.id)
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt.localeCompare(b.updatedAt));
}

export function milestoneStopsHere(milestone: PccMilestone): boolean {
  return metadataObject(milestone.metadata).pccStopHere === true;
}

function reachedStopHereMilestone(input: PccWorkLoopProject): PccMilestone | null {
  return (
    orderedMilestones(input).find(
      (milestone) => milestoneStopsHere(milestone) && TERMINAL_STATUSES.has(milestone.status),
    ) ?? null
  );
}

export function selectNextEligibleMilestone(input: PccWorkLoopProject): PccMilestone | null {
  return (
    orderedMilestones(input).find((milestone) => !TERMINAL_STATUSES.has(milestone.status)) ?? null
  );
}

function selectNextEligibleSubMilestone(
  input: PccWorkLoopProject,
  milestone: PccMilestone | null,
): PccSubMilestone | null {
  if (!milestone) {
    return null;
  }
  return (
    (input.subMilestones ?? [])
      .filter((subMilestone) => subMilestone.milestoneId === milestone.id)
      .filter((subMilestone) => !TERMINAL_STATUSES.has(subMilestone.status))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt.localeCompare(b.updatedAt))
      .at(0) ?? null
  );
}

function permissionsForItem(input: PccWorkLoopProject, item: WorkItem): PccPermissionGrant[] {
  return (input.permissions ?? []).filter(
    (permission) =>
      permission.milestoneId === item.id || item.permissionGrantIds?.includes(permission.id),
  );
}

function permissionIsGranted(permission: PccPermissionGrant): boolean {
  if (permission.status !== "granted") {
    return false;
  }
  if (permission.expiresAt && Date.parse(permission.expiresAt) <= Date.now()) {
    return false;
  }
  if (permission.maxUses !== undefined && permission.usedCount >= permission.maxUses) {
    return false;
  }
  return true;
}

function metadataFlag(item: WorkItem, key: string): boolean {
  return metadataObject(item.metadata)[key] === true;
}

function metadataString(item: WorkItem, key: string): string | null {
  const value = metadataObject(item.metadata)[key];
  return typeof value === "string" ? value : null;
}

function metadataStringArray(item: WorkItem, key: string): string[] {
  const value = metadataObject(item.metadata)[key];
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = typeof entry === "string" ? entry.trim() : "";
        return normalized ? [normalized] : [];
      })
    : [];
}

function projectUsesCapabilityContract(project: PccProject, item: WorkItem): boolean {
  const projectMetadata = metadataObject(project.metadata);
  const contract = metadataObject(projectMetadata.pccCapabilityContract);
  const itemSchema = metadataString(item, "pccCapabilityContractSchema");
  return (
    contract.schema === PCC_CAPABILITY_CONTRACT_SCHEMA ||
    itemSchema === PCC_CAPABILITY_CONTRACT_SCHEMA
  );
}

function capabilityInventoryFromProject(project: PccProject): PccCapabilityInventoryEntry[] {
  const preflight = metadataObject(metadataObject(project.metadata).pccCapabilityPreflight);
  const entries = Array.isArray(preflight.entries) ? preflight.entries : [];
  const allowedKinds = new Set(["process", "workflow", "skill", "tool", "agent", "model", "proof"]);
  const allowedStatuses = new Set(["ready", "blocked", "missing", "unknown"]);
  return entries.flatMap((entry): PccCapabilityInventoryEntry[] => {
    const value = metadataObject(entry);
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const kind = typeof value.kind === "string" ? value.kind : "";
    const status = typeof value.status === "string" ? value.status : "";
    if (!id || !allowedKinds.has(kind) || !allowedStatuses.has(status)) {
      return [];
    }
    return [
      {
        id,
        kind: kind as PccCapabilityInventoryEntry["kind"],
        status: status as PccCapabilityInventoryEntry["status"],
        ...(typeof value.reason === "string" && value.reason.trim()
          ? { reason: value.reason.trim() }
          : {}),
      },
    ];
  });
}

function capabilityResolutionForItem(
  input: PccWorkLoopProject,
  item: WorkItem,
): PccCapabilityResolution | null {
  if (!projectUsesCapabilityContract(input.project, item)) {
    return null;
  }
  const explicitInventory = input.capabilityInventory ?? [];
  const inventory =
    explicitInventory.length > 0
      ? explicitInventory
      : capabilityInventoryFromProject(input.project);
  const requirementIds = metadataStringArray(item, "pccCapabilityRequirementIds");
  return resolvePccProjectCapabilities({
    project: input.project,
    inventory,
    ...(requirementIds.length > 0 ? { requirementIds } : {}),
  });
}

function itemResponsibility(item: WorkItem): string {
  return pccResponsibilityForItem(item) || "local_openclaw_agent";
}

function itemCostRisk(item: WorkItem): string {
  return metadataString(item, "pccCostRisk") ?? "low";
}

function itemRequiresCodex(permissions: readonly PccPermissionGrant[], item: WorkItem): boolean {
  return (
    permissions.some((permission) => CODEX_PERMISSION_TYPES.has(permission.type)) ||
    CODEX_RESPONSIBILITIES.has(itemResponsibility(item)) ||
    metadataFlag(item, "requiresCodex")
  );
}

function itemRequiresRemoteProof(
  permissions: readonly PccPermissionGrant[],
  item: WorkItem,
): boolean {
  return (
    permissions.some((permission) => REMOTE_PERMISSION_TYPES.has(permission.type)) ||
    REMOTE_RESPONSIBILITIES.has(itemResponsibility(item)) ||
    metadataFlag(item, "requiresRemoteProof")
  );
}

function itemRequiresDestructiveAction(
  permissions: readonly PccPermissionGrant[],
  item: WorkItem,
): boolean {
  return (
    permissions.some((permission) => DESTRUCTIVE_PERMISSION_TYPES.has(permission.type)) ||
    metadataFlag(item, "requiresDestructiveAction") ||
    metadataFlag(item, "pccDestructiveAction")
  );
}

function laneEnabled(settings: PccWorkLoopSettings, responsibility: string): boolean {
  if (responsibility === "user") {
    return settings.lanes.user;
  }
  if (responsibility === "local_model") {
    return settings.lanes.localModel;
  }
  if (responsibility === "codex") {
    return settings.lanes.codex;
  }
  if (responsibility === "high_reasoning_codex") {
    return settings.lanes.highReasoningCodex;
  }
  if (responsibility === "remote_proof") {
    return settings.lanes.remoteProof;
  }
  return settings.lanes.localOpenClawAgent;
}

function itemBlockerIds(item: WorkItem): { milestoneId: string; subMilestoneId?: string } {
  if ("milestoneId" in item) {
    return { milestoneId: item.milestoneId, subMilestoneId: item.id };
  }
  return { milestoneId: item.id };
}

function projectHasSetupGateMetadata(project: PccProject): boolean {
  const metadata = metadataObject(project.metadata);
  return Boolean(
    metadata.pccQualityGate ||
    metadata.pccSetupScore ||
    metadata.pccIntake ||
    metadata.pccWorkflow ||
    metadata.pccWorkflowTemplateId,
  );
}

function firstSetupIssue(evaluation: ReturnType<typeof evaluatePccProjectSetup>): string {
  return (
    evaluation.missing[0] ??
    evaluation.violations[0] ??
    evaluation.needsReview[0] ??
    "project setup needs review"
  );
}

function projectSetupBlocker(input: PccWorkLoopProject): PccWorkLoopBlocker | null {
  if (projectHasSetupGateMetadata(input.project)) {
    const evaluation = evaluatePccProjectSetup({
      project: input.project,
      milestones: input.milestones,
      subMilestones: input.subMilestones ?? [],
    });
    if (evaluation.runnable) {
      return null;
    }
    return {
      kind: "setup_not_ready",
      message: `Project setup quality gate is ${evaluation.status.replace(/_/g, " ")} (${evaluation.score}/100): ${firstSetupIssue(evaluation)}`,
    };
  }

  const metadata = metadataObject(input.project.metadata);
  const qualityGate = metadataObject(metadata.pccQualityGate);
  const setupScore = metadataObject(metadata.pccSetupScore);
  if (!("status" in qualityGate) && !("runnable" in setupScore)) {
    return null;
  }
  const status = typeof qualityGate.status === "string" ? qualityGate.status : "needs_review";
  const runnable = setupScore.runnable === true;
  if (status === "passing" && runnable) {
    return null;
  }
  const score =
    typeof setupScore.score === "number" && Number.isFinite(setupScore.score)
      ? Math.round(setupScore.score)
      : 0;
  return {
    kind: "setup_not_ready",
    message: `Project setup quality gate is ${status.replace(/_/g, " ")} (${score}/100).`,
  };
}

export function classifyMilestoneBlocker(
  input: PccWorkLoopProject,
  milestone: PccMilestone | null,
  subMilestone = selectNextEligibleSubMilestone(input, milestone),
): PccWorkLoopBlocker | null {
  const settings = getPccWorkLoopSettings(input.project);
  if (settings.state === "paused") {
    return { kind: "paused", message: "Work loop is paused." };
  }
  if (settings.stopAfterCurrentMilestone && !settings.activeMilestoneId) {
    return { kind: "stop_after_current", message: "Stop after current milestone is enabled." };
  }
  if (
    settings.stopAfterCurrentTask &&
    !settings.activeSubMilestoneId &&
    !settings.activeMilestoneId
  ) {
    return { kind: "stop_after_current", message: "Stop after current task is enabled." };
  }
  if (!milestone) {
    return { kind: "project_complete", message: "No eligible milestones remain." };
  }
  if (milestone.status === "failed") {
    return {
      kind: "proof_failed",
      milestoneId: milestone.id,
      message: "Milestone is failed and needs review before automation continues.",
    };
  }
  if (HELD_STATUSES.has(milestone.status)) {
    const kind =
      milestone.status === "needs_approval" ? "missing_permission" : "milestone_not_actionable";
    return {
      kind,
      milestoneId: milestone.id,
      message: `${milestone.title} is ${milestone.status.replace(/_/g, " ")}.`,
    };
  }
  const item: WorkItem = subMilestone ?? milestone;
  if (item.status === "failed") {
    return {
      kind: "proof_failed",
      ...itemBlockerIds(item),
      message: `${item.title} is failed and needs review before automation continues.`,
    };
  }
  if (HELD_STATUSES.has(item.status)) {
    return {
      kind: item.status === "needs_approval" ? "missing_permission" : "milestone_not_actionable",
      ...itemBlockerIds(item),
      message: `${item.title} is ${item.status.replace(/_/g, " ")}.`,
    };
  }
  const permissions = permissionsForItem(input, item);
  const missingPermissions = permissions.filter((permission) => !permissionIsGranted(permission));
  if (missingPermissions.length > 0) {
    return {
      kind: "missing_permission",
      ...itemBlockerIds(item),
      permissionIds: missingPermissions.map((permission) => permission.id),
      message: `Missing granted permission for ${item.title}.`,
    };
  }
  const capabilityResolution = capabilityResolutionForItem(input, item);
  if (capabilityResolution && !capabilityResolution.ready) {
    return {
      kind: "missing_capability",
      ...itemBlockerIds(item),
      message: `Capability preflight is blocked: ${capabilityResolution.blockingRequirementIds.join(", ")}.`,
    };
  }
  if (settings.stopBeforeCodex && itemRequiresCodex(permissions, item)) {
    return {
      kind: "codex_required",
      ...itemBlockerIds(item),
      message: "This work item requires Codex/high-reasoning work and Stop before Codex is on.",
    };
  }
  if (settings.stopBeforeRemoteProof && itemRequiresRemoteProof(permissions, item)) {
    return {
      kind: "remote_proof_required",
      ...itemBlockerIds(item),
      message: "This work item requires remote proof and Stop before remote proof is on.",
    };
  }
  if (settings.stopBeforeDestructiveAction && itemRequiresDestructiveAction(permissions, item)) {
    return {
      kind: "destructive_action_required",
      ...itemBlockerIds(item),
      message:
        "This work item requires a destructive/write-capable action and Stop before destructive actions is on.",
    };
  }
  if (!laneEnabled(settings, itemResponsibility(item))) {
    return {
      kind: "lane_disabled",
      ...itemBlockerIds(item),
      message: `${itemResponsibility(item).replace(/_/g, " ")} lane is turned off.`,
    };
  }
  if (!item.implementationPlan?.trim()) {
    return {
      kind: "missing_plan",
      ...itemBlockerIds(item),
      message: "Implementation plan is missing.",
    };
  }
  if (!item.acceptanceCriteria?.some((entry) => entry.trim())) {
    return {
      kind: "missing_acceptance_criteria",
      ...itemBlockerIds(item),
      message: "Acceptance criteria are missing.",
    };
  }
  return null;
}

export function buildMilestoneTaskPrompt(
  input: PccWorkLoopProject,
  milestone: PccMilestone,
  subMilestone = selectNextEligibleSubMilestone(input, milestone),
): string {
  const item: WorkItem = subMilestone ?? milestone;
  const criteria = (item.acceptanceCriteria ?? []).map((entry) => `- ${entry}`).join("\n");
  const permissions = permissionsForItem(input, item);
  const permissionLines = permissions.length
    ? permissions
        .map(
          (permission) =>
            `- ${permission.type}: ${permission.status}; allowed=${permission.allowedActions.join(", ") || "none"}; forbidden=${permission.forbiddenActions?.join(", ") || "none"}`,
        )
        .join("\n")
    : "- No work-item-specific permissions recorded.";
  const capabilityResolution = capabilityResolutionForItem(input, item);
  const capabilityLines = capabilityResolution
    ? capabilityResolution.entries
        .map(
          (entry) =>
            `- ${entry.requirement.required ? "Required" : "Preferred"} ${entry.requirement.kind}: ${entry.requirement.id} — ${entry.status}; ${entry.reason}`,
        )
        .join("\n")
    : "- Legacy project: no versioned capability contract recorded. Repair setup before autonomous execution.";
  const qualityLines = capabilityResolution
    ? [
        `- Minimum score: ${capabilityResolution.qualityThreshold}/100 on every applicable dimension; no averaging away a critical regression.`,
        `- Dimensions: ${capabilityResolution.qualityDimensions.join(", ")}.`,
      ]
    : ["- Use the milestone acceptance criteria and attach exact proof without inferring success."];
  return [
    `Project: ${input.project.title}`,
    input.project.goal ? `Goal: ${input.project.goal}` : "Goal: Not recorded",
    `Milestone: ${milestone.title}`,
    subMilestone ? `Sub-milestone: ${subMilestone.title}` : "Sub-milestone: None recorded",
    `Status: ${item.status}`,
    `Responsible worker: ${itemResponsibility(item)}`,
    `Token/cost risk: ${itemCostRisk(item)}`,
    "",
    "Implementation plan:",
    item.implementationPlan?.trim() || "Missing implementation plan.",
    "",
    "Acceptance criteria:",
    criteria || "- Missing acceptance criteria.",
    "",
    "Permission scope:",
    permissionLines,
    "",
    "Capability preflight:",
    capabilityLines,
    "",
    "Quality gate:",
    ...qualityLines,
    "",
    ...(capabilityResolution
      ? [
          "Evidence metadata contract:",
          '- pccCapabilityUse: [{ id: "<required capability id>", status: "used" }] for every required capability. A fallback also needs note and approvedBy.',
          "- pccFirstPass: { attemptCount, defectCount, latencyMs, costClass, openAiApiUsed }. If OpenAI API use was required, also record paidUseAuthorization: { permissionId, budgetId, reason }; otherwise openAiApiUsed=false.",
          ...(milestone.phaseId === "production-proof"
            ? [
                `- pccQualityAssessment: an independent assessor, criticalRegression=false, and every quality dimension scored at least ${capabilityResolution.qualityThreshold}/100.`,
              ]
            : []),
          "",
        ]
      : []),
    "Completion rule: do not mark this work item complete until every acceptance criterion has proof and a completion receipt is recorded on the parent milestone.",
  ].join("\n");
}

function stateForBlocker(blocker: PccWorkLoopBlocker): PccWorkLoopState {
  return blocker.kind === "missing_permission" || blocker.kind === "destructive_action_required"
    ? "waiting_for_permission"
    : blocker.kind === "codex_required"
      ? "waiting_for_codex"
      : blocker.kind === "remote_proof_required"
        ? "waiting_for_remote_proof"
        : blocker.kind === "proof_failed"
          ? "proof_failed"
          : blocker.kind === "project_complete"
            ? "complete"
            : "blocked";
}

function blockedNext(
  milestone: PccMilestone | null,
  subMilestone: PccSubMilestone | null,
  blocker: PccWorkLoopBlocker,
): PccWorkLoopNext {
  return { milestone, subMilestone, blocker, taskPrompt: null, state: stateForBlocker(blocker) };
}

export function getPccWorkLoopNext(input: PccWorkLoopProject): PccWorkLoopNext {
  const setupBlocker = projectSetupBlocker(input);
  if (setupBlocker) {
    return blockedNext(null, null, setupBlocker);
  }

  const reachedStop = reachedStopHereMilestone(input);
  if (reachedStop) {
    return blockedNext(reachedStop, null, {
      kind: "stop_after_current",
      milestoneId: reachedStop.id,
      message: `Stop Here was reached after ${reachedStop.title}.`,
    });
  }

  const settings = getPccWorkLoopSettings(input.project);
  const candidates = orderedMilestones(input).filter(
    (milestone) => !TERMINAL_STATUSES.has(milestone.status),
  );
  if (!settings.continueAroundBlockers) {
    const milestone = candidates.at(0) ?? null;
    const subMilestone = selectNextEligibleSubMilestone(input, milestone);
    const blocker = classifyMilestoneBlocker(input, milestone, subMilestone);
    if (blocker) {
      return blockedNext(milestone, subMilestone, blocker);
    }
    return {
      milestone,
      subMilestone,
      blocker: null,
      taskPrompt: milestone ? buildMilestoneTaskPrompt(input, milestone, subMilestone) : null,
      state: milestone ? "working" : "complete",
    };
  }

  let firstSoftBlocker: PccWorkLoopNext | null = null;
  for (const milestone of candidates) {
    const subMilestone = selectNextEligibleSubMilestone(input, milestone);
    const blocker = classifyMilestoneBlocker(input, milestone, subMilestone);
    if (!blocker) {
      return {
        milestone,
        subMilestone,
        blocker: null,
        taskPrompt: buildMilestoneTaskPrompt(input, milestone, subMilestone),
        state: "working",
      };
    }
    const blocked = blockedNext(milestone, subMilestone, blocker);
    if (HARD_STOP_BLOCKERS.has(blocker.kind)) {
      return blocked;
    }
    firstSoftBlocker ??= blocked;
  }

  if (firstSoftBlocker) {
    return firstSoftBlocker;
  }
  return blockedNext(null, null, {
    kind: "project_complete",
    message: "No eligible milestones remain.",
  });
}

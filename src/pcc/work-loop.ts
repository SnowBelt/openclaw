// Project Command Center guided work-loop helpers keep project automation bounded and proof-gated.
import type {
  PccCompletionReceipt,
  PccMilestone,
  PccPermissionGrant,
  PccPermissionType,
  PccProject,
  PccStatus,
} from "../../packages/gateway-protocol/src/schema/types.js";

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

export type PccWorkLoopSettings = {
  enabled: boolean;
  state: PccWorkLoopState;
  stopBeforeCodex: boolean;
  stopBeforeRemoteProof: boolean;
  stopAfterCurrentMilestone: boolean;
  activeMilestoneId?: string;
  lastLoopMessage?: string;
  updatedAt?: string;
};

export type PccWorkLoopProject = {
  project: PccProject;
  milestones: readonly PccMilestone[];
  permissions?: readonly PccPermissionGrant[];
  receipts?: readonly PccCompletionReceipt[];
};

export type PccWorkLoopBlockerKind =
  | "paused"
  | "stop_after_current"
  | "project_complete"
  | "milestone_not_actionable"
  | "missing_permission"
  | "codex_required"
  | "remote_proof_required"
  | "missing_plan"
  | "missing_acceptance_criteria"
  | "proof_failed";

export type PccWorkLoopBlocker = {
  kind: PccWorkLoopBlockerKind;
  message: string;
  milestoneId?: string;
  permissionIds?: string[];
};

export type PccWorkLoopNext = {
  milestone: PccMilestone | null;
  blocker: PccWorkLoopBlocker | null;
  taskPrompt: string | null;
  state: PccWorkLoopState;
};

const DEFAULT_SETTINGS: PccWorkLoopSettings = {
  enabled: false,
  state: "idle",
  stopBeforeCodex: true,
  stopBeforeRemoteProof: true,
  stopAfterCurrentMilestone: false,
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

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
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
    stopAfterCurrentMilestone: booleanSetting(
      raw.stopAfterCurrentMilestone,
      DEFAULT_SETTINGS.stopAfterCurrentMilestone,
    ),
    ...(typeof raw.activeMilestoneId === "string"
      ? { activeMilestoneId: raw.activeMilestoneId }
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

export function selectNextEligibleMilestone(input: PccWorkLoopProject): PccMilestone | null {
  return (
    input.milestones
      .filter((milestone) => milestone.projectId === input.project.id)
      .filter((milestone) => !TERMINAL_STATUSES.has(milestone.status))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt.localeCompare(b.updatedAt))
      .at(0) ?? null
  );
}

function permissionsForMilestone(
  input: PccWorkLoopProject,
  milestone: PccMilestone,
): PccPermissionGrant[] {
  return (input.permissions ?? []).filter(
    (permission) =>
      permission.milestoneId === milestone.id ||
      milestone.permissionGrantIds?.includes(permission.id),
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

function metadataFlag(milestone: PccMilestone, key: string): boolean {
  return metadataObject(milestone.metadata)[key] === true;
}

function milestoneRequiresCodex(
  permissions: readonly PccPermissionGrant[],
  milestone: PccMilestone,
): boolean {
  return (
    permissions.some((permission) => CODEX_PERMISSION_TYPES.has(permission.type)) ||
    metadataFlag(milestone, "requiresCodex")
  );
}

function milestoneRequiresRemoteProof(
  permissions: readonly PccPermissionGrant[],
  milestone: PccMilestone,
): boolean {
  return (
    permissions.some((permission) => REMOTE_PERMISSION_TYPES.has(permission.type)) ||
    metadataFlag(milestone, "requiresRemoteProof")
  );
}

export function classifyMilestoneBlocker(
  input: PccWorkLoopProject,
  milestone: PccMilestone | null,
): PccWorkLoopBlocker | null {
  const settings = getPccWorkLoopSettings(input.project);
  if (settings.state === "paused") {
    return { kind: "paused", message: "Work loop is paused." };
  }
  if (settings.stopAfterCurrentMilestone && !settings.activeMilestoneId) {
    return { kind: "stop_after_current", message: "Stop after current milestone is enabled." };
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
  const permissions = permissionsForMilestone(input, milestone);
  const missingPermissions = permissions.filter((permission) => !permissionIsGranted(permission));
  if (missingPermissions.length > 0) {
    return {
      kind: "missing_permission",
      milestoneId: milestone.id,
      permissionIds: missingPermissions.map((permission) => permission.id),
      message: `Missing granted permission for ${milestone.title}.`,
    };
  }
  if (settings.stopBeforeCodex && milestoneRequiresCodex(permissions, milestone)) {
    return {
      kind: "codex_required",
      milestoneId: milestone.id,
      message: "This milestone requires Codex/high-reasoning work and Stop before Codex is on.",
    };
  }
  if (settings.stopBeforeRemoteProof && milestoneRequiresRemoteProof(permissions, milestone)) {
    return {
      kind: "remote_proof_required",
      milestoneId: milestone.id,
      message: "This milestone requires remote proof and Stop before remote proof is on.",
    };
  }
  if (!milestone.implementationPlan?.trim()) {
    return {
      kind: "missing_plan",
      milestoneId: milestone.id,
      message: "Implementation plan is missing.",
    };
  }
  if (!milestone.acceptanceCriteria?.some((entry) => entry.trim())) {
    return {
      kind: "missing_acceptance_criteria",
      milestoneId: milestone.id,
      message: "Acceptance criteria are missing.",
    };
  }
  return null;
}

export function buildMilestoneTaskPrompt(
  input: PccWorkLoopProject,
  milestone: PccMilestone,
): string {
  const criteria = (milestone.acceptanceCriteria ?? []).map((entry) => `- ${entry}`).join("\n");
  const permissions = permissionsForMilestone(input, milestone);
  const permissionLines = permissions.length
    ? permissions
        .map(
          (permission) =>
            `- ${permission.type}: ${permission.status}; allowed=${permission.allowedActions.join(", ") || "none"}; forbidden=${permission.forbiddenActions?.join(", ") || "none"}`,
        )
        .join("\n")
    : "- No milestone-specific permissions recorded.";
  return [
    `Project: ${input.project.title}`,
    input.project.goal ? `Goal: ${input.project.goal}` : "Goal: Not recorded",
    `Milestone: ${milestone.title}`,
    `Status: ${milestone.status}`,
    "",
    "Implementation plan:",
    milestone.implementationPlan?.trim() || "Missing implementation plan.",
    "",
    "Acceptance criteria:",
    criteria || "- Missing acceptance criteria.",
    "",
    "Permission scope:",
    permissionLines,
    "",
    "Completion rule: do not mark this milestone complete until every acceptance criterion has proof and a completion receipt is recorded.",
  ].join("\n");
}

export function getPccWorkLoopNext(input: PccWorkLoopProject): PccWorkLoopNext {
  const milestone = selectNextEligibleMilestone(input);
  const blocker = classifyMilestoneBlocker(input, milestone);
  if (blocker) {
    const state: PccWorkLoopState =
      blocker.kind === "missing_permission"
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
    return { milestone, blocker, taskPrompt: null, state };
  }
  return {
    milestone,
    blocker: null,
    taskPrompt: milestone ? buildMilestoneTaskPrompt(input, milestone) : null,
    state: milestone ? "working" : "complete",
  };
}

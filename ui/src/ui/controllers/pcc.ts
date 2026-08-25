import type { ExecutionStateSnapshot } from "../../../../packages/gateway-protocol/src/schema/types.js";
import { executionApprovalFromPccPermission } from "../../../../src/agents/execution-approval-envelope.js";
import {
  applyPccAutopilotPermissionAction,
  applyPccAutopilotPermissionRepair,
  configurePccAutopilotMode,
  expirePccAutopilotPermissionGrant,
  generatePccAutopilotPromptSlots,
  getPccAutopilotState,
  queuePccAutopilotPermissionRequest,
  revokePccAutopilotPermissionGrant,
  runPccAutopilotSafeStubSet,
  transitionPccAutopilotState,
  updatePccAutopilotPromptSlot,
  withPccAutopilotState,
  type PccAutopilotModeId,
  type PccAutopilotPromptSlot,
} from "../../../../src/pcc/autopilot.js";
import {
  pccCapabilityInventoryFromAgents,
  pccCapabilityInventoryFromModelCatalog,
  pccCapabilityInventoryFromSkillSoftware,
  pccCapabilityInventoryFromSkillStatus,
  pccCapabilityInventoryFromToolCatalog,
  resolvePccProjectCapabilities,
  withPccCapabilityPreflight,
  type PccCapabilityInventoryEntry,
} from "../../../../src/pcc/capability-contract.js";
import { evaluatePccCapabilityEvidence } from "../../../../src/pcc/capability-evidence.js";
import {
  isPccCompleteStatus,
  isPccSkippedStatus,
  isPccTerminalStatus,
} from "../../../../src/pcc/domain/completion-policy.js";
import type { PccExecutionCapacitySnapshot } from "../../../../src/pcc/execution-capacity.js";
import {
  createPccExecutionPlan,
  consumePccExecutionPlanCodexApproval,
  findDuplicateActivePccExecutionPlan,
  isPccExecutionPlanActive,
  partitionPccExecutionTasks,
  transitionPccExecutionPlan,
  type PccExecutionPlan,
  type PccExecutionTask,
  type PccExecutionTaskPartition,
} from "../../../../src/pcc/execution-plan.js";
import {
  derivePccAiUsePolicy,
  normalizePccExecutionProfile,
  PCC_BEST_AVAILABLE_MODEL_ID,
  pccCodexEffortIsSupported,
  resolvePccCodexCheckpoint,
  resolvePccExecutionProfilePreset,
  summarizePccExecutionProfile,
  validatePccModelSelection,
} from "../../../../src/pcc/execution-profile.js";
import {
  buildPccExecutionRuntimeProjection,
  type PccExecutionRuntimeProjection,
} from "../../../../src/pcc/execution-state-projection.js";
import {
  evaluatePccProjectSetup,
  PCC_REQUIRED_INTAKE_QUESTIONS,
  pccIntakeAnswersFromMetadata,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
  withPccPhase2Metadata,
} from "../../../../src/pcc/intake-quality.js";
import {
  normalizePccResponsibility,
  pccMetadataObject,
  pccProjectIsStale,
  pccWorkScopeForProject,
  pccResponsibilityForItem,
} from "../../../../src/pcc/metadata.js";
import { selectPccLocalModel } from "../../../../src/pcc/model-routing.js";
import {
  buildPccPlanRevisionPreview,
  pccProjectPlanFingerprint,
} from "../../../../src/pcc/plan-revision.js";
import {
  DEFAULT_PCC_PLANNING_POLICY,
  PCC_LOCAL_PLANNER_MODEL,
  PCC_CODEX_PLANNER_MODEL,
  type PccGeneratedMilestone,
  type PccPlanGenerationResult,
  type PccPlanningPolicy,
} from "../../../../src/pcc/planning.js";
import { resolvePccProjectAction } from "../../../../src/pcc/project-action.js";
import {
  buildPccWorkflowDraft,
  type PccAiUsePolicy,
  type PccPlanningMode,
} from "../../../../src/pcc/project-workflows.js";
import type { ReleaseGovernanceStatus } from "../../../../src/pcc/release-governance/contracts.js";
import type { PccRuntimeIdentity } from "../../../../src/pcc/runtime-identity.js";
import type { PccUpdateSafety } from "../../../../src/pcc/update-safety.js";
// Control UI controller loads and edits Project Command Center ledger entries.
import {
  getPccWorkLoopSettings,
  getPccWorkLoopNext,
  withPccWorkLoopSettings,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import { buildPccWorkStartBlockers } from "../../../../src/pcc/work-start.js";
import { buildQualifiedChatModelValue } from "../chat-model-ref.ts";
import { formatConnectError } from "../connect-error.ts";
import { buildPccChatSyncProposals, type PccChatSyncProposal } from "../pcc-chat-sync.ts";
import { rememberPccProjectDetailForState } from "../pcc/application/detail-cache.ts";
import {
  buildPccExecutionTeamReadiness,
  executionPlansFromProject,
  executionTasksForDetail,
  isPccLocalCatalogModel,
  pccCodexPermissionIsUsable,
  resolveConfiguredExecutionModel,
} from "../pcc/application/execution-readiness.ts";
import {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
  type PccAiRegenerateSection,
  type PccAutofillPreview,
  type PccAutopilotAction,
  type PccAttachmentDraft,
  type PccDashboardState,
  type PccDecisionFormState,
  type PccExecutionTeamAction,
  type PccMilestoneFormState,
  type PccPlannerMode,
  type PccProjectDetail,
  type PccProjectEditMode,
  type PccProjectFilter,
  type PccProjectFormState,
  type PccSurface,
  type PccViewMode,
} from "../pcc/application/state.ts";
import type {
  PccAttachment,
  PccCompletionReceipt,
  PccDecision,
  PccEvidence,
  PccLastKnownGood,
  PccMilestone,
  PccOverviewGetResult,
  PccSubMilestone,
  PccPermissionGrant,
  PccPermissionStatus,
  PccPlanningRun,
  PccPresenceEntry,
  PccPrivateTeamPolicy,
  PccPortfolioSummary,
  PccProject,
  PccProjectAiUsageSummary,
  PccProjectSummary,
  PccStatus,
  SessionsListResult,
  ModelCatalogEntry,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../types.ts";

export {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
} from "../pcc/application/state.ts";
export { buildPccExecutionTeamReadiness } from "../pcc/application/execution-readiness.ts";
export type {
  PccActionNotice,
  PccAiRegenerateSection,
  PccAutofillPreview,
  PccAutopilotAction,
  PccDashboardState,
  PccDecisionFormState,
  PccEditorMode,
  PccExecutionTeamAction,
  PccExecutionTeamReadiness,
  PccMilestoneFormState,
  PccPlannerMode,
  PccProjectDetail,
  PccProjectEditMode,
  PccProjectFilter,
  PccProjectFormState,
  PccUndoAction,
  PccViewMode,
} from "../pcc/application/state.ts";

type PccSummaryGetResult = {
  portfolio?: PccPortfolioSummary;
  planningPolicy?: PccPlanningPolicy;
  privateTeamPolicy?: PccPrivateTeamPolicy;
  executionCapacity?: PccExecutionCapacitySnapshot;
  runtimeIdentity?: PccRuntimeIdentity;
  updateSafety?: PccUpdateSafety;
  releaseGovernance?: ReleaseGovernanceStatus | null;
};

type PccPresenceListResult = { presence: PccPresenceEntry[] };

const PCC_FAVORITES_KEY = "openclaw.pcc.favorites.v1";
const PCC_RECENTS_KEY = "openclaw.pcc.recents.v1";
const PCC_PROJECT_FILTERS = new Set<PccProjectFilter>([
  "active",
  "needs_you",
  "on_hold",
  "completed",
  "archived",
  "all",
]);

function readProjectPreference(key: string): string[] {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function writeProjectPreference(key: string, value: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value.slice(0, 20)));
  } catch {
    // Preferences are a local convenience. Shared project state never depends on them.
  }
}

function syncPccUrl(surface: PccSurface, projectId?: string): void {
  if (globalThis.location === undefined || globalThis.history === undefined) {
    return;
  }
  const url = new URL(globalThis.location.href);
  url.searchParams.set("pcc", surface);
  if (surface === "project" && projectId) {
    url.searchParams.set("project", projectId);
  } else {
    url.searchParams.delete("project");
  }
  if (surface !== "projects") {
    url.searchParams.delete("pccFilter");
    url.searchParams.delete("pccQuery");
  }
  globalThis.history.pushState({}, "", url);
}

function syncPccDirectoryUrl(
  filter: PccProjectFilter | undefined,
  query: string | undefined,
  replace: boolean,
): void {
  if (globalThis.location === undefined || globalThis.history === undefined) {
    return;
  }
  const url = new URL(globalThis.location.href);
  url.searchParams.set("pcc", "projects");
  if (filter && filter !== "active") {
    url.searchParams.set("pccFilter", filter);
  } else {
    url.searchParams.delete("pccFilter");
  }
  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    url.searchParams.set("pccQuery", normalizedQuery);
  } else {
    url.searchParams.delete("pccQuery");
  }
  globalThis.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

export function restorePccLocation(state: PccDashboardState): void {
  if (globalThis.location === undefined) {
    return;
  }
  const url = new URL(globalThis.location.href);
  const requested = url.searchParams.get("pcc");
  const surface: PccSurface =
    requested === "projects" ||
    requested === "activity" ||
    requested === "system" ||
    requested === "project"
      ? requested
      : "overview";
  const projectId = url.searchParams.get("project")?.trim();
  const requestedFilter = url.searchParams.get("pccFilter");
  const directoryFilter = PCC_PROJECT_FILTERS.has(requestedFilter as PccProjectFilter)
    ? (requestedFilter as PccProjectFilter)
    : undefined;
  const directoryQuery = url.searchParams.get("pccQuery")?.trim() ?? "";
  if (surface === "project" && projectId) {
    state.pccSurface = "project";
    state.pccSelectedProjectId = projectId;
    state.pccProjectDetail = state.pccProjectDetails[projectId] ?? null;
  } else {
    state.pccSurface = surface === "project" ? "overview" : surface;
    state.pccSelectedProjectId = null;
    state.pccProjectDetail = null;
    state.pccExecutionProjection = null;
  }
  state.pccProjectFilter = surface === "projects" ? directoryFilter : undefined;
  state.pccProjectSearchQuery = surface === "projects" ? directoryQuery : "";
  state.requestUpdate?.();
}

function hydratePccPreferences(state: PccDashboardState): void {
  state.pccFavorites ??= readProjectPreference(PCC_FAVORITES_KEY);
  state.pccRecentProjectIds ??= readProjectPreference(PCC_RECENTS_KEY);
}

type PccProjectsGetResult = {
  project: PccProject;
  milestones: PccMilestone[];
  subMilestones?: PccSubMilestone[];
  permissions: PccPermissionGrant[];
  evidence: PccEvidence[];
  receipts: PccCompletionReceipt[];
  decisions?: PccDecision[];
  lastKnownGood?: PccLastKnownGood[];
  aiUsage?: PccProjectAiUsageSummary;
  summary: PccProjectSummary;
};

type PccAttachmentsListResult = {
  attachments: PccAttachment[];
};

type PccProjectsUpsertResult = {
  project: PccProject;
  summary: PccProjectSummary;
};

type PccProjectPlanCommitResult = PccProjectsUpsertResult & {
  milestones: PccMilestone[];
  subMilestones: PccSubMilestone[];
};

type PccPermissionsUpsertResult = {
  permission: PccPermissionGrant;
  summary: PccProjectSummary;
};

type PccDecisionsAddResult = {
  decision: PccDecision;
  summary: PccProjectSummary;
};

type PccReceiptsAddResult = {
  receipt: PccCompletionReceipt;
  milestone: PccMilestone;
  lastKnownGood?: PccLastKnownGood;
  summary: PccProjectSummary;
};

const DEFAULT_COUNTS = {
  total: 0,
  complete: 0,
  blocked: 0,
  needsApproval: 0,
  deferred: 0,
  skipped: 0,
};

const PCC_TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

function refreshPccChatSyncProposals(state: PccDashboardState): void {
  state.pccChatSyncProposals = buildPccChatSyncProposals(
    state.pccProjectDetail,
    state.pccChatSyncText,
  );
}

function safeProjectSummary(project: PccProjectSummary): PccProjectSummary {
  return {
    ...project,
    percentComplete: clampPercent(project.percentComplete),
    milestoneCounts: { ...DEFAULT_COUNTS, ...project.milestoneCounts },
    nextActions: Array.isArray(project.nextActions) ? project.nextActions : [],
    proofGaps: Array.isArray(project.proofGaps) ? project.proofGaps : [],
  };
}

function clampPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function parseOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalPercent(value: string): number | undefined {
  const parsed = parseOptionalInteger(value);
  return parsed === undefined ? undefined : Math.max(0, Math.min(100, parsed));
}

function projectUsesPccCapabilityContract(project: PccProject): boolean {
  return (
    pccMetadataObject(pccMetadataObject(project.metadata).pccCapabilityContract).schema ===
    "openclaw.pcc.capability-contract.v1"
  );
}

async function loadPccCapabilityInventory(
  state: PccDashboardState,
  project: PccProject,
): Promise<PccCapabilityInventoryEntry[]> {
  if (!projectUsesPccCapabilityContract(project)) {
    return [];
  }
  const inventory = [
    ...pccCapabilityInventoryFromAgents(state.agentsList?.agents ?? []),
    ...pccCapabilityInventoryFromModelCatalog(state.chatModelCatalog ?? []),
  ];
  if (!state.client) {
    return inventory;
  }
  try {
    const report = await state.client.request<SkillStatusReport | undefined>("skills.status", {});
    if (report && Array.isArray(report.skills)) {
      state.skillsReport = report;
      inventory.push(...pccCapabilityInventoryFromSkillStatus(report.skills));
      inventory.push(...pccCapabilityInventoryFromSkillSoftware(report.skills));
    }
  } catch {
    // Missing optional inventory stays unknown. Required skills and software
    // still fail closed later with precise blockers instead of a generic RPC error.
  }
  try {
    const catalog = await state.client.request<ToolsCatalogResult | undefined>("tools.catalog", {
      includePlugins: true,
    });
    if (catalog) {
      inventory.push(...pccCapabilityInventoryFromToolCatalog(catalog));
    }
  } catch {
    // Required tools and plugins stay unknown and fail closed in resolution.
  }
  return inventory;
}

function metadataWithoutLegacyExecutionRouting(value: unknown): Record<string, unknown> {
  const next = { ...pccMetadataObject(value) };
  for (const key of [
    "pccPlanningMode",
    "pccPlannerMode",
    "pccAiUsePolicy",
    "pccPlannerModelId",
    "pccPlannerPermission",
    "pccAiRouting",
    "pccCodexPlanningAllowed",
  ]) {
    delete next[key];
  }
  return next;
}

function configuredModelRefs(models: readonly ModelCatalogEntry[] | undefined): string[] {
  return (models ?? [])
    .filter((entry) => entry.available !== false)
    .map((entry) => buildQualifiedChatModelValue(entry.id, entry.provider));
}

function configuredLocalModelRefs(models: readonly ModelCatalogEntry[] | undefined): string[] {
  return (models ?? [])
    .filter((entry) => entry.available !== false && isPccLocalCatalogModel(entry))
    .map((entry) => buildQualifiedChatModelValue(entry.id, entry.provider));
}

function pccExecutionPlanId(projectId: string, nowMs: number): string {
  return `pcc-team-${projectId}-${nowMs}`.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

function pccExecutionTransitionAt(plan: PccExecutionPlan): string {
  return new Date(Math.max(Date.now(), Date.parse(plan.updatedAt))).toISOString();
}

function buildPccExecutionCoordinatorPrompt(
  detail: PccProjectDetail,
  plan: PccExecutionPlan,
  workerModelId: string,
  codexModelId: string | null,
): string {
  const taskById = new Map(executionTasksForDetail(detail).map((task) => [task.id, task]));
  const assignments = plan.partitions.map((partition) => {
    const task = taskById.get(partition.taskId);
    const lease = plan.leases.find((item) => item.partitionId === partition.id);
    return {
      partitionId: partition.id,
      workerId: partition.workerId,
      taskId: partition.taskId,
      title: task?.title ?? partition.taskId,
      milestoneId: partition.milestoneId,
      modelId: partition.modelId ?? workerModelId,
      modelRationale: partition.modelRationale,
      workspaceLease: lease ? { workspaceId: lease.workspaceId, expiresAt: lease.expiresAt } : null,
    };
  });
  const checkpointRules = Object.keys(plan.profile.codexCheckpoints).map((checkpoint) => {
    const resolved = resolvePccCodexCheckpoint({
      profile: plan.profile,
      checkpoint: checkpoint as keyof typeof plan.profile.codexCheckpoints,
      codexApproved: false,
    });
    return {
      checkpoint,
      executor: resolved.executor,
      automatic: resolved.automatic,
      modelId: resolved.modelId,
      effort: resolved.effort,
      approvalRequired: resolved.requiresApproval,
      rationale: resolved.rationale,
    };
  });
  const codexRule =
    plan.profile.codexPolicyId === "local_only"
      ? "Codex is OFF for every project checkpoint. Do not invoke Codex or any Codex model."
      : `Codex policy: ${summarizePccExecutionProfile(plan.profile)} Use ${codexModelId} only at an approved checkpoint. Never broaden checkpoint scope or infer approval. Checkpoint routing: ${JSON.stringify(checkpointRules)}`;
  return [
    "You are the PCC supervised execution coordinator.",
    `Project: ${detail.project.title} (${detail.project.id})`,
    `Project goal: ${detail.project.goal ?? "No goal recorded."}`,
    `PCC work scope: ${pccWorkScopeForProject(detail.project)}`,
    `Execution plan ID: ${plan.id}`,
    `OpenClaw worker model: ${workerModelId}`,
    `Maximum concurrent OpenClaw workers: ${plan.admittedWorkerCount}`,
    codexRule,
    "Use sessions_spawn with isolated context and pass each assignment's exact modelId. If that model cannot be used, stop and report the mismatch instead of silently substituting another model. A worker may process multiple assigned partitions serially, but never run two partitions that share a workspace lease concurrently.",
    "Execute only the listed assignments. Do not infer new parallel work. Stop and report a blocker if a workspace lease, dependency, requirement, or scope is ambiguous.",
    "Never perform an external write, deployment, credential or session change, destructive action, purchase, publication, reboot, or other high-risk action without a separate explicit permission grant.",
    "Do not mark PCC milestones or sub-milestones complete. Return proof candidates for user/judge review instead.",
    "At fan-in, return structured JSON with planId, child session/run IDs, partition statuses, changed files or artifacts, checks run, proof candidates, blockers, and remaining risks.",
    `Assignments: ${JSON.stringify(assignments)}`,
    `Required proof candidates: ${JSON.stringify(plan.proofRequirements)}`,
  ].join("\n\n");
}

function applyPccProjectUpsertResult(
  state: PccDashboardState,
  detail: PccProjectDetail,
  result: PccProjectsUpsertResult,
): PccProjectDetail {
  const normalizedSummary = safeProjectSummary(result.summary);
  const nextDetail: PccProjectDetail = {
    ...detail,
    project: result.project,
    summary: normalizedSummary,
  };
  state.pccProjectDetail = nextDetail;
  state.pccSelectedProjectId = result.project.id;
  rememberPccProjectDetailForState(state, nextDetail);
  state.pccProjects = state.pccProjects.some((item) => item.id === result.project.id)
    ? state.pccProjects.map((item) => (item.id === result.project.id ? normalizedSummary : item))
    : [...state.pccProjects, normalizedSummary];
  state.pccUpdatedAt = Date.now();
  state.requestUpdate?.();
  return nextDetail;
}

async function persistPccExecutionPlan(
  state: PccDashboardState,
  fallbackDetail: PccProjectDetail,
  plan: PccExecutionPlan,
): Promise<PccProjectDetail> {
  if (!state.client) {
    throw new Error("PCC is disconnected; the execution plan was not saved.");
  }
  const detail =
    state.pccProjectDetail?.project.id === fallbackDetail.project.id
      ? state.pccProjectDetail
      : fallbackDetail;
  const previousPlans = executionPlansFromProject(detail.project).filter(
    (item) => item.id !== plan.id,
  );
  const plans = [...previousPlans.slice(-19), plan];
  const now = new Date().toISOString();
  const result = await state.client.request<PccProjectsUpsertResult>("pcc.projects.upsert", {
    project: projectUpsertPayload({
      ...detail.project,
      metadata: {
        ...pccMetadataObject(detail.project.metadata),
        pccExecutionProfile: plan.profile,
        pccExecutionPlans: plans,
        pccActiveExecutionPlanId: isPccExecutionPlanActive(plan.status) ? plan.id : null,
        pccExecutionLastUpdatedAt: now,
      },
    }),
  });
  return applyPccProjectUpsertResult(state, detail, result);
}

function pccExecutionProofRequirements(
  planId: string,
  tasks: readonly PccExecutionTask[],
): Array<{ milestoneId: string; proofId: string; description: string }> {
  return tasks.flatMap((task) =>
    task.milestoneId
      ? [
          {
            milestoneId: task.milestoneId,
            proofId: `${planId}:proof:${task.id}`,
            description: `Review implementation output and applicable checks for ${task.title}.`,
          },
        ]
      : [],
  );
}

function pccExecutionWorkspaceLeases(
  planId: string,
  partitions: readonly PccExecutionTaskPartition[],
  acquiredAt: string,
): Array<{
  workspaceId: string;
  planId: string;
  partitionId: string;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
}> {
  const expiresAt = new Date(Date.parse(acquiredAt) + 2 * 60 * 60 * 1_000).toISOString();
  return partitions.flatMap((partition) =>
    partition.workspaceId
      ? [
          {
            workspaceId: partition.workspaceId,
            planId,
            partitionId: partition.id,
            holderId: partition.workerId,
            acquiredAt,
            expiresAt,
          },
        ]
      : [],
  );
}

function metadataString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function outcomeMetricsText(value: unknown): string {
  return metadataStringArray(value).join("\n");
}

function parseOutcomeMetrics(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function metadataBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function metadataDateInput(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeDateInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Date.parse(`${trimmed}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function plannerModeToPlanningMode(mode: PccPlannerMode): PccPlanningMode {
  if (mode === "best_available") {
    return "local_project_manager";
  }
  return mode === "codex" || mode === "high_reasoning_codex"
    ? "codex_full_plan"
    : mode === "local_project_manager"
      ? "local_project_manager"
      : "template_only";
}

function plannerModeFromPlanningMode(mode: PccPlanningMode | undefined): PccPlannerMode {
  return mode === "codex_full_plan"
    ? "codex"
    : mode === "template_only"
      ? "local_model"
      : "local_project_manager";
}

function plannerResponsibility(mode: PccPlannerMode): string {
  return mode === "local_model"
    ? "local model"
    : mode === "codex"
      ? "Codex"
      : mode === "high_reasoning_codex"
        ? "high-reasoning Codex"
        : "local Project Manager";
}

function aiUsePolicyFromPlannerMode(mode: PccPlannerMode): PccAiUsePolicy {
  return mode === "codex" || mode === "high_reasoning_codex" ? "codex_expert" : "local_only";
}

function normalizeAiUsePolicy(value: unknown, fallback: PccAiUsePolicy): PccAiUsePolicy {
  return value === "local_only" ||
    value === "codex_focused" ||
    value === "codex_expert" ||
    value === "codex_everything"
    ? value
    : fallback;
}

function aiUsePolicyNeedsCodex(policy: PccAiUsePolicy): boolean {
  return policy !== "local_only";
}

const PCC_CODEX_CHECKPOINT_LABELS = {
  material_replan: "Major project change",
  architecture_review: "Architecture decision",
  blocked_recovery: "Stuck or repeated failure",
  final_review: "Final completion review",
} as const;

function codexCheckpointPermissionActions(
  profile: PccProjectFormState["executionProfile"],
): string[] {
  return Object.entries(profile.codexCheckpoints)
    .filter(([, mode]) => mode !== "local")
    .map(
      ([checkpoint, mode]) =>
        `${PCC_CODEX_CHECKPOINT_LABELS[checkpoint as keyof typeof PCC_CODEX_CHECKPOINT_LABELS]}: ${mode === "codex" ? "Codex" : "Automatic (local first, then Codex only on its documented trigger)"}`,
    );
}

function codexPermissionType(
  profile: PccProjectFormState["executionProfile"],
): "codex_usage" | "high_reasoning_model" {
  return profile.codexEffort === "medium" && profile.codexMaxEffort === "medium"
    ? "codex_usage"
    : "high_reasoning_model";
}

function canonicalizeProjectAiRouting(form: PccProjectFormState): PccProjectFormState {
  const executionProfile = normalizePccExecutionProfile({
    pccExecutionProfile: form.executionProfile,
  });
  const aiUsePolicy = derivePccAiUsePolicy(executionProfile);
  const plannerMode = form.plannerMode ?? plannerModeFromPlanningMode(form.planningMode);
  const usesCodexForInitialPlan = plannerMode === "codex" || plannerMode === "high_reasoning_codex";
  return {
    ...form,
    executionProfile,
    aiUsePolicy,
    plannerMode,
    planningMode: plannerModeToPlanningMode(plannerMode),
    plannerModelId: usesCodexForInitialPlan ? PCC_CODEX_PLANNER_MODEL : PCC_LOCAL_PLANNER_MODEL,
    plannerPermissionScope: executionProfile.approvalScope,
    codexPlanningAllowed: executionProfile.codexRole === "off" ? false : form.codexPlanningAllowed,
    plannerPermissionBudget: "",
  };
}

function inferProjectTitle(text: string): string {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find(Boolean);
  const sentence = firstLine ?? text.trim();
  return sentence.replace(/[.!?]$/u, "").slice(0, 90) || "Untitled Project";
}

function inferIntakeAnswersFromDescription(
  description: string,
  plannerMode: PccPlannerMode,
): Record<string, string> {
  const trimmed = description.trim();
  if (!trimmed) {
    return {};
  }
  return {
    goal: trimmed,
    firstDeliverable:
      "A reviewed PCC plan with ordered milestones and sub-milestones generated from the project description.",
    doneProof:
      "Each milestone needs explicit acceptance criteria, proof requirements, and a completion receipt before it is marked complete.",
    constraints:
      plannerMode === "codex" || plannerMode === "high_reasoning_codex"
        ? "Codex or high-reasoning planning is permission-gated before token spend; destructive, remote, publish, runtime, and reboot actions need separate approval."
        : "Do not run destructive, remote, publish, runtime, reboot, or high-token actions without separate approval.",
    owner: plannerResponsibility(plannerMode),
    blockers:
      "Unknown blockers should be captured as PCC permission, tool, source, or proof gaps before work starts.",
  };
}

function inferOutcomeMetrics(title: string): string {
  const subject = title.trim() || "This project";
  return [
    `${subject} produces a first approved deliverable.`,
    "Every milestone has acceptance criteria and receipt-backed proof before completion.",
  ].join("\n");
}

function enrichProjectFormFromDescription(form: PccProjectFormState): PccProjectFormState {
  const routedForm = canonicalizeProjectAiRouting(form);
  const plannerMode =
    routedForm.plannerMode ?? plannerModeFromPlanningMode(routedForm.planningMode);
  const aiUsePolicy = routedForm.aiUsePolicy ?? aiUsePolicyFromPlannerMode(plannerMode);
  const description = (routedForm.projectDescription ?? "").trim();
  if (!description) {
    return {
      ...routedForm,
      plannerMode,
      aiUsePolicy,
      projectDescription: routedForm.projectDescription ?? "",
      plannerModelId: routedForm.plannerModelId ?? "",
      planPreviewAccepted: routedForm.planPreviewAccepted ?? false,
      planningMode: plannerModeToPlanningMode(plannerMode),
    };
  }
  const answers = inferIntakeAnswersFromDescription(description, plannerMode);
  const recommendation = recommendPccWorkflow({
    title: routedForm.title || inferProjectTitle(description),
    goal: routedForm.goal || description,
    intakeAnswers: { ...answers, ...routedForm.intakeAnswers },
  });
  return {
    ...routedForm,
    title: routedForm.title.trim() ? routedForm.title : inferProjectTitle(description),
    goal: routedForm.goal.trim() ? routedForm.goal : description,
    outcomeMetrics: (routedForm.outcomeMetrics ?? "").trim()
      ? routedForm.outcomeMetrics
      : inferOutcomeMetrics(routedForm.title || inferProjectTitle(description)),
    workflowTemplateId: routedForm.workflowTemplateId || recommendation.templateId,
    plannerMode,
    aiUsePolicy,
    projectDescription: routedForm.projectDescription ?? "",
    plannerModelId: routedForm.plannerModelId ?? "",
    planPreviewAccepted: routedForm.planPreviewAccepted ?? false,
    planningMode: plannerModeToPlanningMode(plannerMode),
    intakeAnswers: { ...answers, ...routedForm.intakeAnswers },
  };
}

function generatedPlanIntake(plan: PccPlanGenerationResult): Record<string, string> {
  return {
    goal: plan.goal,
    firstDeliverable: plan.milestones[0]
      ? `Complete the first verified milestone: ${plan.milestones[0].title}.`
      : "Review and approve the first verified deliverable.",
    doneProof: [
      ...plan.outcomeMetrics,
      "Every milestone must satisfy its acceptance criteria and record required proof.",
    ].join("\n"),
    constraints:
      plan.risks.length > 0
        ? plan.risks.join("\n")
        : "Stop before missing permissions, unavailable tools, destructive actions, deployment, credentials, purchases, publication, or unrelated external writes.",
    owner:
      plan.provenance.runtime === "codex"
        ? "Codex plans. OpenClaw local agents execute routine work. The user owns gated decisions."
        : "Local AI plans. OpenClaw local agents execute routine work. The user owns gated decisions.",
    blockers:
      plan.assumptions.length > 0
        ? `Validate these assumptions before dependent work:\n${plan.assumptions.join("\n")}`
        : "No known blocker. PCC must stop and record any blocker discovered during execution.",
  };
}

function generatedExecutionResponsibility(value: string): string {
  const responsibility = normalizePccResponsibility(value);
  return responsibility === "remote_proof" || responsibility === "user"
    ? responsibility
    : "local_openclaw_agent";
}

function generatedMilestoneDraft(
  milestone: PccGeneratedMilestone,
  order: number,
  generatedBy: PccPlanGenerationResult["provenance"]["source"],
): ReturnType<typeof buildPccWorkflowDraft>["milestones"][number] {
  return {
    title: milestone.title,
    status: "not_started",
    phaseId: milestone.phaseId,
    order,
    percentComplete: 0,
    implementationPlan: milestone.implementationPlan,
    acceptanceCriteria: milestone.acceptanceCriteria,
    metadata: {
      pccResponsibility: generatedExecutionResponsibility(milestone.responsibility),
      pccPlannerSuggestedResponsibility: normalizePccResponsibility(milestone.responsibility),
      pccProofLevel: milestone.proofLevel,
      pccGeneratedBy: generatedBy,
      parallelSafe: milestone.dependencies.length === 0,
    },
  };
}

function normalizedMilestoneTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function planRevisionHistoryMetadata(form: PccProjectFormState, now: string): unknown[] {
  if (!form.planRevision || !form.generatedPlan) {
    return [];
  }
  return [
    {
      schemaVersion: form.planRevision.schemaVersion,
      id: form.planRevision.id,
      request: form.planRevision.request,
      generatedAt: form.planRevision.generatedAt,
      appliedAt: now,
      sourceModel: form.planRevision.sourceModel,
      sourceEffort: form.planRevision.sourceEffort,
      beforeFingerprint: form.planRevision.beforeFingerprint,
      summary: form.planRevision.summary,
      changes: form.planRevision.changes,
      staleProofMilestoneIds: form.planRevision.staleProofMilestoneIds,
      rollbackAvailable: true,
    },
  ];
}

function reconcileExecutionPlansForRevision(
  project: PccProject | undefined,
  now: string,
): PccExecutionPlan[] | null {
  if (!project) {
    return null;
  }
  const plans = executionPlansFromProject(project);
  if (!plans.some((plan) => isPccExecutionPlanActive(plan.status))) {
    return null;
  }
  return plans.map((plan) => {
    if (!isPccExecutionPlanActive(plan.status)) {
      return plan;
    }
    if (plan.status === "prepared") {
      return transitionPccExecutionPlan(plan, "cancelled", {
        at: now,
        reason: "Cancelled before applying a material project plan revision.",
      });
    }
    if (plan.status === "dispatching" || plan.status === "running" || plan.status === "blocked") {
      return transitionPccExecutionPlan(plan, "paused", {
        at: now,
        reason: "Paused before applying a material project plan revision.",
      });
    }
    return plan;
  });
}

type PccRevisionWrite<T> = {
  after: T;
  before?: T;
  added: boolean;
};

function pccRecordRevision(record: { revision?: number }): number {
  return record.revision ?? 1;
}

async function applyGeneratedPlanRevision(params: {
  state: PccDashboardState;
  detail: PccProjectDetail;
  plan: PccPlanGenerationResult;
  now: string;
}): Promise<{
  added: PccMilestone[];
  updated: PccMilestone[];
  addedSubMilestones: PccSubMilestone[];
  milestoneWrites: PccRevisionWrite<PccMilestone>[];
  subMilestoneWrites: PccRevisionWrite<PccSubMilestone>[];
}> {
  const client = params.state.client;
  if (!client) {
    return {
      added: [],
      updated: [],
      addedSubMilestones: [],
      milestoneWrites: [],
      subMilestoneWrites: [],
    };
  }
  const existingByTitle = new Map(
    params.detail.milestones.map((milestone) => [
      normalizedMilestoneTitle(milestone.title),
      milestone,
    ]),
  );
  const maxOrder = params.detail.milestones.reduce(
    (maximum, milestone) => Math.max(maximum, milestone.order ?? -1),
    -1,
  );
  const added: PccMilestone[] = [];
  const updated: PccMilestone[] = [];
  const addedSubMilestones: PccSubMilestone[] = [];
  const resolvedByGeneratedIndex: PccMilestone[] = [];
  const originalMilestonesById = new Map(
    params.detail.milestones.map((milestone) => [milestone.id, milestone]),
  );
  const originalSubMilestonesById = new Map(
    (params.detail.subMilestones ?? []).map((subMilestone) => [subMilestone.id, subMilestone]),
  );
  const writtenMilestones = new Map<string, PccRevisionWrite<PccMilestone>>();
  const writtenSubMilestones = new Map<string, PccRevisionWrite<PccSubMilestone>>();
  const rememberMilestoneWrite = (after: PccMilestone, addedWrite: boolean): void => {
    const previous = writtenMilestones.get(after.id);
    const before = previous?.before ?? originalMilestonesById.get(after.id);
    writtenMilestones.set(after.id, {
      after,
      ...(before ? { before } : {}),
      added: previous?.added ?? addedWrite,
    });
  };
  const rememberSubMilestoneWrite = (after: PccSubMilestone, addedWrite: boolean): void => {
    const previous = writtenSubMilestones.get(after.id);
    const before = previous?.before ?? originalSubMilestonesById.get(after.id);
    writtenSubMilestones.set(after.id, {
      after,
      ...(before ? { before } : {}),
      added: previous?.added ?? addedWrite,
    });
  };

  try {
    for (const [index, generated] of params.plan.milestones.entries()) {
      const existing = existingByTitle.get(normalizedMilestoneTitle(generated.title));
      const completed =
        existing && (existing.status === "complete" || existing.status === "skipped");
      if (completed) {
        resolvedByGeneratedIndex.push(existing);
        continue;
      }
      const revisionChange = params.state.pccProjectForm.planRevision?.changes.find(
        (change) => change.generatedIndex === index,
      );
      if (existing && (!revisionChange || revisionChange.fields.length === 0)) {
        resolvedByGeneratedIndex.push(existing);
        continue;
      }
      const draft = generatedMilestoneDraft(
        generated,
        existing?.order ?? maxOrder + added.length + 1,
        params.plan.provenance.source,
      );
      const next = existing
        ? {
            ...existing,
            ...draft,
            id: existing.id,
            projectId: existing.projectId,
            order: existing.order,
            status: existing.status === "in_progress" ? ("on_hold" as const) : existing.status,
            percentComplete: existing.percentComplete,
            blocker: existing.blocker,
            metadata: {
              ...pccMetadataObject(existing.metadata),
              ...pccMetadataObject(draft.metadata),
              pccPlanRevisionId: params.state.pccProjectForm.planRevision?.id,
              ...(existing.status === "in_progress"
                ? {
                    pccRevisionPausedAt: params.now,
                    pccRevisionPauseReason:
                      "Active work paused before an approved material plan revision was applied.",
                  }
                : {}),
            },
          }
        : {
            ...draft,
            projectId: params.detail.project.id,
            metadata: {
              ...pccMetadataObject(draft.metadata),
              pccPlanRevisionId: params.state.pccProjectForm.planRevision?.id,
            },
          };
      const result = await client.request<{ milestone: PccMilestone }>("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload(next),
      });
      rememberMilestoneWrite(result.milestone, !existing);
      resolvedByGeneratedIndex.push(result.milestone);
      if (existing) {
        updated.push(result.milestone);
      } else {
        added.push(result.milestone);
      }
      const existingSubMilestones = existing
        ? (params.detail.subMilestones ?? []).filter(
            (subMilestone) => subMilestone.milestoneId === existing.id,
          )
        : [];
      const existingSubMilestonesByTitle = new Map(
        existingSubMilestones.map((subMilestone) => [
          normalizedMilestoneTitle(subMilestone.title),
          subMilestone,
        ]),
      );
      const maxSubMilestoneOrder = existingSubMilestones.reduce(
        (maximum, subMilestone) => Math.max(maximum, subMilestone.order ?? -1),
        -1,
      );
      for (const [subIndex, generatedSubMilestone] of generated.subMilestones.entries()) {
        const existingSubMilestone = existingSubMilestonesByTitle.get(
          normalizedMilestoneTitle(generatedSubMilestone.title),
        );
        if (
          existingSubMilestone?.status === "complete" ||
          existingSubMilestone?.status === "skipped"
        ) {
          continue;
        }
        const subMilestoneResult = await client.request<{ subMilestone: PccSubMilestone }>(
          "pcc.subMilestones.upsert",
          {
            subMilestone: subMilestoneUpsertPayload({
              ...(existingSubMilestone ? { ...existingSubMilestone } : {}),
              projectId: params.detail.project.id,
              milestoneId: result.milestone.id,
              title: generatedSubMilestone.title,
              status: existingSubMilestone?.status ?? "not_started",
              order: existingSubMilestone?.order ?? maxSubMilestoneOrder + subIndex + 1,
              percentComplete: existingSubMilestone?.percentComplete ?? 0,
              implementationPlan: generatedSubMilestone.implementationPlan,
              acceptanceCriteria: generatedSubMilestone.acceptanceCriteria,
              metadata: {
                ...pccMetadataObject(existingSubMilestone?.metadata),
                pccResponsibility: generatedExecutionResponsibility(
                  generatedSubMilestone.responsibility,
                ),
                pccPlannerSuggestedResponsibility: normalizePccResponsibility(
                  generatedSubMilestone.responsibility,
                ),
                pccProofLevel: generatedSubMilestone.proofLevel,
                pccPlanRevisionId: params.state.pccProjectForm.planRevision?.id,
              },
            }),
          },
        );
        rememberSubMilestoneWrite(subMilestoneResult.subMilestone, !existingSubMilestone);
        if (!existingSubMilestone) {
          addedSubMilestones.push(subMilestoneResult.subMilestone);
        }
      }
    }

    for (const [index, generated] of params.plan.milestones.entries()) {
      const milestone = resolvedByGeneratedIndex[index];
      const revisionChange = params.state.pccProjectForm.planRevision?.changes.find(
        (change) => change.generatedIndex === index,
      );
      if (revisionChange?.kind === "preserve_completed") {
        continue;
      }
      const dependsOn = generated.dependencies
        .map((dependency) => resolvedByGeneratedIndex[dependency]?.id)
        .filter((id): id is string => Boolean(id));
      if (milestone && JSON.stringify(milestone.dependsOn ?? []) !== JSON.stringify(dependsOn)) {
        const result = await client.request<{ milestone: PccMilestone }>("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload({ ...milestone, dependsOn }),
        });
        rememberMilestoneWrite(result.milestone, false);
        const updatedIndex = updated.findIndex((item) => item.id === milestone.id);
        if (updatedIndex >= 0) {
          updated[updatedIndex] = result.milestone;
        }
        const addedIndex = added.findIndex((item) => item.id === milestone.id);
        if (addedIndex >= 0) {
          added[addedIndex] = result.milestone;
        }
      }
    }
    return {
      added,
      updated,
      addedSubMilestones,
      milestoneWrites: [...writtenMilestones.values()],
      subMilestoneWrites: [...writtenSubMilestones.values()],
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    const rollback = async (label: string, action: () => Promise<unknown>): Promise<void> => {
      try {
        await action();
      } catch (rollbackError) {
        rollbackErrors.push(
          `${label}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    };
    let current: {
      milestones: PccMilestone[];
      subMilestones?: PccSubMilestone[];
    } | null = null;
    try {
      current = await client.request<{
        milestones: PccMilestone[];
        subMilestones?: PccSubMilestone[];
      }>("pcc.projects.get", {
        projectId: params.detail.project.id,
      });
    } catch (rollbackError) {
      rollbackErrors.push(
        `refresh current project revision state: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    if (current) {
      const currentMilestones = new Map(
        current.milestones.map((milestone) => [milestone.id, milestone]),
      );
      const currentSubMilestones = new Map(
        (current.subMilestones ?? []).map((subMilestone) => [subMilestone.id, subMilestone]),
      );
      for (const write of writtenMilestones.values()) {
        const latest = currentMilestones.get(write.after.id);
        if (!latest) {
          rollbackErrors.push(`restore milestone ${write.after.id}: current record unavailable`);
          continue;
        }
        if (latest.revision !== write.after.revision) {
          rollbackErrors.push(
            `restore milestone ${write.after.id}: current revision ${latest.revision ?? 1} no longer matches revision ${write.after.revision ?? 1} written by this plan revision`,
          );
          continue;
        }
        if (write.added) {
          await rollback(`roll back added milestone ${write.after.id}`, () =>
            client.request("pcc.milestones.upsert", {
              milestone: milestoneUpsertPayload({
                ...write.after,
                revision: latest.revision ?? 1,
                status: "skipped",
                blocker: "Rolled back after a project plan revision failed.",
              }),
            }),
          );
        } else if (write.before) {
          const before = write.before;
          if (typeof before.projectId !== "string" || typeof before.title !== "string") {
            rollbackErrors.push(
              `restore milestone ${write.after.id}: saved record is missing projectId or title`,
            );
            continue;
          }
          await rollback(`restore milestone ${write.after.id}`, () =>
            client.request("pcc.milestones.upsert", {
              milestone: milestoneUpsertPayload({
                ...before,
                projectId: before.projectId,
                title: before.title,
                replaceExisting: true,
                revision: latest.revision ?? 1,
              }),
            }),
          );
        }
      }
      for (const write of writtenSubMilestones.values()) {
        const latest = currentSubMilestones.get(write.after.id);
        if (!latest) {
          rollbackErrors.push(
            `restore sub-milestone ${write.after.id}: current record unavailable`,
          );
          continue;
        }
        if (latest.revision !== write.after.revision) {
          rollbackErrors.push(
            `restore sub-milestone ${write.after.id}: current revision ${latest.revision ?? 1} no longer matches revision ${write.after.revision ?? 1} written by this plan revision`,
          );
          continue;
        }
        if (write.added) {
          await rollback(`roll back added sub-milestone ${write.after.id}`, () =>
            client.request("pcc.subMilestones.upsert", {
              subMilestone: subMilestoneUpsertPayload({
                ...write.after,
                revision: latest.revision ?? 1,
                status: "skipped",
                blocker: "Rolled back after a project plan revision failed.",
              }),
            }),
          );
        } else if (write.before) {
          const before = write.before;
          if (
            typeof before.projectId !== "string" ||
            typeof before.milestoneId !== "string" ||
            typeof before.title !== "string"
          ) {
            rollbackErrors.push(
              `restore sub-milestone ${write.after.id}: saved record is missing projectId, milestoneId, or title`,
            );
            continue;
          }
          await rollback(`restore sub-milestone ${write.after.id}`, () =>
            client.request("pcc.subMilestones.upsert", {
              subMilestone: subMilestoneUpsertPayload({
                ...before,
                projectId: before.projectId,
                milestoneId: before.milestoneId,
                title: before.title,
                replaceExisting: true,
                revision: latest.revision ?? 1,
              }),
            }),
          );
        }
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Project plan revision partially applied; recovery is required for project ${params.detail.project.id}. ${rollbackErrors.join(" ")}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function workflowDraftFromGeneratedPlan(form: PccProjectFormState, priority: number | undefined) {
  const plan = form.generatedPlan;
  if (!plan) {
    return buildPccWorkflowDraft({
      title: form.title.trim(),
      goal: form.goal.trim(),
      templateId: form.workflowTemplateId,
      ...(priority !== undefined ? { priority } : {}),
      codexPlanningAllowed: form.codexPlanningAllowed,
      remoteProofAllowed: form.remoteProofAllowed,
      runtimeActionsAllowed: form.runtimeActionsAllowed,
      planningMode: form.planningMode,
      aiUsePolicy: "local_only",
    });
  }
  const base = buildPccWorkflowDraft({
    title: form.title.trim(),
    goal: form.goal.trim(),
    templateId: plan.workflowTemplateId,
    ...(priority !== undefined ? { priority } : {}),
    codexPlanningAllowed: false,
    remoteProofAllowed: form.remoteProofAllowed,
    runtimeActionsAllowed: form.runtimeActionsAllowed,
    planningMode: plan.provenance.runtime === "codex" ? "codex_full_plan" : "template_only",
    aiUsePolicy: "local_only",
  });
  const milestones = plan.milestones.map((milestone, order) =>
    generatedMilestoneDraft(milestone, order, plan.provenance.source),
  );
  return {
    ...base,
    project: {
      ...base.project,
      title: form.title.trim(),
      goal: form.goal.trim(),
      metadata: {
        ...pccMetadataObject(base.project.metadata),
        pccPlanningProvenance: plan.provenance,
      },
    },
    milestones,
    subMilestonesByMilestoneTitle: Object.fromEntries(
      plan.milestones.map((milestone) => [
        milestone.title,
        milestone.subMilestones.map((subMilestone, order) => ({
          title: subMilestone.title,
          status: "not_started" as PccStatus,
          order,
          percentComplete: 0,
          implementationPlan: subMilestone.implementationPlan,
          acceptanceCriteria: subMilestone.acceptanceCriteria,
          metadata: {
            pccResponsibility: generatedExecutionResponsibility(subMilestone.responsibility),
            pccPlannerSuggestedResponsibility: normalizePccResponsibility(
              subMilestone.responsibility,
            ),
            pccProofLevel: subMilestone.proofLevel,
            pccGeneratedBy: plan.provenance.source,
            parallelSafe:
              generatedExecutionResponsibility(subMilestone.responsibility) !== "user" &&
              generatedExecutionResponsibility(subMilestone.responsibility) !== "remote_proof",
          },
        })),
      ]),
    ),
  };
}

function firstSentence(value: string): string {
  return (
    value
      .split(/[.!?]\s+|\n+/u)
      .find((part) => part.trim())
      ?.trim() ?? value.trim()
  );
}

function detailText(detail: PccProjectDetail): string {
  return [
    detail.project.title,
    detail.project.goal ?? "",
    metadataString(pccMetadataObject(detail.project.metadata).pccProjectDescription, ""),
    ...detail.milestones.flatMap((milestone) => [
      milestone.title,
      milestone.implementationPlan ?? "",
      milestone.blocker ?? "",
    ]),
    ...(detail.subMilestones ?? []).flatMap((subMilestone) => [
      subMilestone.title,
      subMilestone.implementationPlan ?? "",
      subMilestone.blocker ?? "",
    ]),
  ]
    .join("\n")
    .trim();
}

function autofillGoal(detail: PccProjectDetail): string {
  if (detail.project.goal?.trim()) {
    return detail.project.goal.trim();
  }
  const text = detailText(detail);
  return (
    firstSentence(text) || `Complete ${detail.project.title} with clear PCC milestones and proof.`
  );
}

function responsibilityName(value: string): string {
  return value.replace(/_/g, " ");
}

function autofillAnswer(
  detail: PccProjectDetail,
  questionId: string,
  existing: Record<string, string>,
): string {
  if (existing[questionId]?.trim()) {
    return existing[questionId].trim();
  }
  const nextMilestone = detail.milestones.find(
    (milestone) =>
      !["complete", "complete_with_maintenance", "skipped", "archived"].includes(milestone.status),
  );
  const defaultOwner = nextMilestone
    ? pccResponsibilityForItem(nextMilestone) || "local_openclaw_agent"
    : "local_openclaw_agent";
  switch (questionId) {
    case "goal":
      return autofillGoal(detail);
    case "firstDeliverable":
      return nextMilestone
        ? `Complete the next PCC milestone: ${nextMilestone.title}.`
        : `Create the first useful verified result for ${detail.project.title}.`;
    case "doneProof":
      return "Each milestone needs passing acceptance criteria, attached proof, and a completion receipt before it is marked complete.";
    case "constraints":
      return "Stop before Codex, high-reasoning models, remote proof, destructive/runtime/reboot/publish actions, or external writes unless scoped permission is granted.";
    case "owner":
      return responsibilityName(defaultOwner);
    case "blockers":
      return (
        [
          detail.project.goal ? "" : "Project goal was missing.",
          ...detail.milestones.map((item) => item.blocker ?? ""),
        ]
          .map((item) => item.trim())
          .find(Boolean) ??
        "Unknown blockers should be recorded as PCC permission, tool, source, or proof gaps before work starts."
      );
    default:
      return `Autofilled from existing ${detail.project.title} project context.`;
  }
}

function defaultMilestonePlan(milestone: PccMilestone): string {
  return [
    `Complete ${milestone.title} by executing its sub-milestones in order.`,
    "Stop on missing permissions, unclear acceptance criteria, or missing proof.",
    "Record evidence and a completion receipt before marking the milestone complete.",
  ].join("\n");
}

function defaultSubMilestonePlan(subMilestone: PccSubMilestone): string {
  return [
    `Execute this sub-step: ${subMilestone.title}.`,
    "Use the parent milestone scope and stop if proof or permission is missing.",
  ].join("\n");
}

function defaultAcceptanceCriteria(title: string): string[] {
  return [
    `${title} has an observable result or exact blocker.`,
    "Required proof is recorded before completion.",
  ];
}

type MilestoneAutofillPatch = {
  milestone: PccMilestone;
  fields: string[];
};

type SubMilestoneAutofillPatch = {
  subMilestone: PccSubMilestone;
  fields: string[];
};

function buildMilestoneAutofillPatch(milestone: PccMilestone): MilestoneAutofillPatch {
  const fields: string[] = [];
  const metadata = pccMetadataObject(milestone.metadata);
  const nextMetadata = { ...metadata };
  let implementationPlan = milestone.implementationPlan ?? "";
  let acceptanceCriteria = milestone.acceptanceCriteria ?? [];
  if (!implementationPlan.trim()) {
    implementationPlan = defaultMilestonePlan(milestone);
    fields.push("implementation plan");
  }
  if (!acceptanceCriteria.some((entry) => entry.trim())) {
    acceptanceCriteria = defaultAcceptanceCriteria(milestone.title);
    fields.push("acceptance criteria");
  }
  const existingResponsibility =
    normalizePccResponsibility(nextMetadata.pccResponsibility) ||
    normalizePccResponsibility(nextMetadata.recommendedWorker) ||
    normalizePccResponsibility(nextMetadata.pccRecommendedWorker) ||
    normalizePccResponsibility(milestone.owner) ||
    "local_openclaw_agent";
  if (metadataString(nextMetadata.pccResponsibility, "") !== existingResponsibility) {
    nextMetadata.pccResponsibility = existingResponsibility;
    nextMetadata.recommendedWorker ??= existingResponsibility;
    fields.push("owner");
  }
  if (
    !metadataString(nextMetadata.pccProofLevel, "") &&
    !metadataString(nextMetadata.proofRequired, "")
  ) {
    nextMetadata.pccProofLevel = "local";
    fields.push("proof requirement");
  }
  return {
    milestone: {
      ...milestone,
      implementationPlan,
      acceptanceCriteria,
      metadata: nextMetadata,
    },
    fields,
  };
}

function buildSubMilestoneAutofillPatch(subMilestone: PccSubMilestone): SubMilestoneAutofillPatch {
  const fields: string[] = [];
  const metadata = pccMetadataObject(subMilestone.metadata);
  const nextMetadata = { ...metadata };
  let implementationPlan = subMilestone.implementationPlan ?? "";
  let acceptanceCriteria = subMilestone.acceptanceCriteria ?? [];
  if (!implementationPlan.trim()) {
    implementationPlan = defaultSubMilestonePlan(subMilestone);
    fields.push("implementation plan");
  }
  if (!acceptanceCriteria.some((entry) => entry.trim())) {
    acceptanceCriteria = defaultAcceptanceCriteria(subMilestone.title);
    fields.push("acceptance criteria");
  }
  const existingResponsibility =
    normalizePccResponsibility(nextMetadata.pccResponsibility) ||
    normalizePccResponsibility(nextMetadata.recommendedWorker) ||
    normalizePccResponsibility(nextMetadata.pccRecommendedWorker) ||
    normalizePccResponsibility(subMilestone.owner) ||
    "local_openclaw_agent";
  if (metadataString(nextMetadata.pccResponsibility, "") !== existingResponsibility) {
    nextMetadata.pccResponsibility = existingResponsibility;
    nextMetadata.recommendedWorker ??= existingResponsibility;
    fields.push("owner");
  }
  if (
    !metadataString(nextMetadata.pccProofLevel, "") &&
    !metadataString(nextMetadata.proofRequired, "")
  ) {
    nextMetadata.pccProofLevel = "local";
    fields.push("proof requirement");
  }
  return {
    subMilestone: {
      ...subMilestone,
      implementationPlan,
      acceptanceCriteria,
      metadata: nextMetadata,
    },
    fields,
  };
}

function activeMilestonesForSetup(detail: PccProjectDetail): PccMilestone[] {
  return detail.milestones.filter((milestone) => !PCC_TERMINAL_STATUSES.has(milestone.status));
}

function workflowDraftForSetup(
  detail: PccProjectDetail,
  previewGoal?: string,
  generatedPlan?: PccPlanGenerationResult,
) {
  const existingWorkflow = metadataString(
    pccMetadataObject(detail.project.metadata).pccWorkflowTemplateId,
    "",
  );
  const workflow = recommendPccWorkflow({
    title: detail.project.title,
    goal: previewGoal ?? autofillGoal(detail),
    intakeAnswers: pccIntakeAnswersFromMetadata(detail.project.metadata),
  });
  const base = buildPccWorkflowDraft({
    title: detail.project.title,
    goal: previewGoal ?? autofillGoal(detail),
    templateId: existingWorkflow || workflow.templateId,
    priority: detail.project.priority,
    planningMode: generatedPlan
      ? generatedPlan.provenance.runtime === "codex"
        ? "codex_full_plan"
        : "template_only"
      : "local_project_manager",
    codexPlanningAllowed: false,
    remoteProofAllowed: false,
    runtimeActionsAllowed: false,
  });
  if (!generatedPlan) {
    return base;
  }
  return {
    ...base,
    project: {
      ...base.project,
      metadata: {
        ...pccMetadataObject(base.project.metadata),
        pccPlanningProvenance: generatedPlan.provenance,
      },
    },
    milestones: generatedPlan.milestones.map((milestone, order) =>
      generatedMilestoneDraft(milestone, order, generatedPlan.provenance.source),
    ),
    subMilestonesByMilestoneTitle: Object.fromEntries(
      generatedPlan.milestones.map((milestone) => [
        milestone.title,
        milestone.subMilestones.map((subMilestone, order) => ({
          title: subMilestone.title,
          status: "not_started" as PccStatus,
          order,
          percentComplete: 0,
          implementationPlan: subMilestone.implementationPlan,
          acceptanceCriteria: subMilestone.acceptanceCriteria,
          metadata: {
            pccResponsibility: generatedExecutionResponsibility(subMilestone.responsibility),
            pccPlannerSuggestedResponsibility: normalizePccResponsibility(
              subMilestone.responsibility,
            ),
            pccProofLevel: subMilestone.proofLevel,
            pccGeneratedBy: generatedPlan.provenance.source,
            parallelSafe:
              generatedExecutionResponsibility(subMilestone.responsibility) !== "user" &&
              generatedExecutionResponsibility(subMilestone.responsibility) !== "remote_proof",
          },
        })),
      ]),
    ),
  };
}

function fallbackSubMilestonesFor(milestone: PccMilestone) {
  return [
    {
      title: `Clarify ${milestone.title} result`,
      status: "not_started" as PccStatus,
      order: 1,
      implementationPlan: `Write the exact expected result for ${milestone.title} and stop if the result is unclear.`,
      acceptanceCriteria: [`${milestone.title} has a clear expected result.`],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        parallelSafe: true,
      },
    },
    {
      title: `Execute ${milestone.title} safely`,
      status: "not_started" as PccStatus,
      order: 2,
      implementationPlan: `Execute ${milestone.title} using the parent milestone implementation plan. Stop on missing permission, proof, source, or tool access.`,
      acceptanceCriteria: [`${milestone.title} has an observable result or exact blocker.`],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        parallelSafe: true,
      },
    },
    {
      title: `Record ${milestone.title} proof`,
      status: "not_started" as PccStatus,
      order: 3,
      implementationPlan: `Record proof, remaining blockers, and a completion receipt candidate for ${milestone.title}.`,
      acceptanceCriteria: [`${milestone.title} proof or blocker is recorded in PCC.`],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        parallelSafe: true,
      },
    },
  ];
}

function generatedSubMilestoneDraftsFor(detail: PccProjectDetail, milestone: PccMilestone) {
  const draft = workflowDraftForSetup(detail);
  return (
    draft.subMilestonesByMilestoneTitle[milestone.title] ?? fallbackSubMilestonesFor(milestone)
  );
}

function generatedSubMilestonePreviews(detail: PccProjectDetail) {
  const subMilestones = detail.subMilestones ?? [];
  return activeMilestonesForSetup(detail)
    .filter(
      (milestone) =>
        !subMilestones.some(
          (subMilestone) =>
            subMilestone.milestoneId === milestone.id &&
            !PCC_TERMINAL_STATUSES.has(subMilestone.status),
        ),
    )
    .flatMap((milestone) =>
      generatedSubMilestoneDraftsFor(detail, milestone).map((subMilestone) => ({
        milestoneId: milestone.id,
        milestoneTitle: milestone.title,
        title: subMilestone.title,
        fields: [
          "sub-milestone",
          "implementation plan",
          "acceptance criteria",
          "owner",
          "proof requirement",
        ],
      })),
    );
}

function generatedMilestonePreviews(detail: PccProjectDetail, goal: string) {
  if (activeMilestonesForSetup(detail).length > 0) {
    return [];
  }
  const draft = workflowDraftForSetup(detail, goal);
  return draft.milestones.map((milestone) => ({
    title: milestone.title,
    fields: [
      "milestone",
      "implementation plan",
      "acceptance criteria",
      "owner",
      "proof requirement",
    ],
    subMilestoneTitles: (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []).map(
      (subMilestone) => subMilestone.title,
    ),
  }));
}

export function buildPccSetupAutofillPreview(
  detail: PccProjectDetail,
  intakeApproved = false,
): PccAutofillPreview {
  const existingAnswers = pccIntakeAnswersFromMetadata(detail.project.metadata);
  const intakeAnswers = Object.fromEntries(
    PCC_REQUIRED_INTAKE_QUESTIONS.map((question) => [
      question.id,
      autofillAnswer(detail, question.id, existingAnswers),
    ]),
  );
  const workflow = recommendPccWorkflow({
    title: detail.project.title,
    goal: autofillGoal(detail),
    intakeAnswers,
  });
  const milestoneUpdates = detail.milestones
    .map(buildMilestoneAutofillPatch)
    .filter((patch) => patch.fields.length > 0)
    .map((patch) => ({
      id: patch.milestone.id,
      title: patch.milestone.title,
      fields: patch.fields,
    }));
  const subMilestoneUpdates = (detail.subMilestones ?? [])
    .map(buildSubMilestoneAutofillPatch)
    .filter((patch) => patch.fields.length > 0)
    .map((patch) => ({
      id: patch.subMilestone.id,
      title: patch.subMilestone.title,
      fields: patch.fields,
    }));
  const goal = autofillGoal(detail);
  return {
    projectId: detail.project.id,
    goal,
    intakeAnswers,
    intakeApproved,
    workflowTemplateId: workflow.templateId,
    workflowTitle: workflow.title,
    summary: `PCC drafted missing setup for ${detail.project.title} from existing project context.`,
    milestoneUpdates,
    subMilestoneUpdates,
    generatedMilestones: generatedMilestonePreviews(detail, goal),
    generatedSubMilestones: generatedSubMilestonePreviews(detail),
  };
}

function pccAiRegenerateSectionTitle(section: PccAiRegenerateSection): string {
  return section
    .split("_")
    .join(" ")
    .replace(/(^|\s)\S/gu, (value) => value.toLocaleUpperCase());
}

export function buildPccSectionAutofillPreview(
  detail: PccProjectDetail,
  section: PccAiRegenerateSection,
  intakeApproved = false,
): PccAutofillPreview {
  const base = buildPccSetupAutofillPreview(detail, intakeApproved);
  const sectionTitle = pccAiRegenerateSectionTitle(section);
  const scoped = {
    ...base,
    section,
    sectionTitle,
    summary: `PCC drafted a scoped ${sectionTitle} update for ${detail.project.title}.`,
  };
  if (section === "goal" || section === "intake" || section === "workflow") {
    return {
      ...scoped,
      milestoneUpdates: [],
      subMilestoneUpdates: [],
      generatedMilestones: [],
      generatedSubMilestones: [],
    };
  }
  if (section === "milestones") {
    return { ...scoped, subMilestoneUpdates: [], generatedSubMilestones: [] };
  }
  if (section === "submilestones") {
    return { ...scoped, milestoneUpdates: [], generatedMilestones: [] };
  }
  if (["criteria", "proof", "permissions", "blockers", "handoff"].includes(section)) {
    return { ...scoped, generatedMilestones: [], generatedSubMilestones: [] };
  }
  return scoped;
}

function parseAcceptanceCriteria(value: string): string[] | undefined {
  const entries = value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function summarizePortfolio(projects: PccProjectSummary[]): PccPortfolioSummary {
  const total = projects.length;
  const complete = projects.filter((project) => project.status === "complete").length;
  const archived = projects.filter((project) => project.status === "archived").length;
  const blocked = projects.filter((project) => project.status === "blocked").length;
  const needsApproval = projects.filter((project) => project.status === "needs_approval").length;
  const now = Date.now();
  const terminalStatuses = new Set([
    "complete",
    "complete_with_maintenance",
    "skipped",
    "archived",
  ]);
  const overdue = projects.filter((project) => {
    if (terminalStatuses.has(project.status) || !project.dueDate) {
      return false;
    }
    const due = Date.parse(project.dueDate);
    return Number.isFinite(due) && due < now;
  }).length;
  const stale = projects.filter((project) =>
    pccProjectIsStale(project.status, project.updatedAt, now, 14),
  ).length;
  const proofGaps = projects.filter((project) => project.proofGaps.length > 0).length;
  const deferredOutOfUrgentStatuses = new Set(["archived", "skipped", "on_hold", "deferred"]);
  const needsAttention = projects.filter(
    (project) =>
      !deferredOutOfUrgentStatuses.has(project.status) &&
      (project.status === "needs_approval" ||
        project.status === "blocked" ||
        project.milestoneCounts.needsApproval > 0 ||
        project.milestoneCounts.blocked > 0 ||
        project.proofGaps.length > 0 ||
        project.health === "Overdue" ||
        project.health === "At risk" ||
        (!terminalStatuses.has(project.status) &&
          project.dueDate !== undefined &&
          Number.isFinite(Date.parse(project.dueDate)) &&
          Date.parse(project.dueDate) < now) ||
        pccProjectIsStale(project.status, project.updatedAt, now, 14)),
  ).length;
  const averagePercentComplete =
    total === 0
      ? 0
      : Math.round(
          projects.reduce((sum, project) => sum + clampPercent(project.percentComplete), 0) / total,
        );
  const active = projects.filter(
    (project) =>
      ![
        "archived",
        "complete",
        "complete_with_maintenance",
        "skipped",
        "on_hold",
        "deferred",
      ].includes(project.status),
  ).length;
  return {
    projectsTotal: total,
    active,
    blocked,
    needsApproval,
    needsAttention,
    proofGaps,
    overdue,
    stale,
    complete,
    archived,
    averagePercentComplete,
    nextActions: projects.flatMap((project) => project.nextActions).slice(0, 20),
  };
}

function projectFormFromProject(
  project: PccProject,
  permissions: readonly PccPermissionGrant[] = [],
): PccProjectFormState {
  const metadata = pccMetadataObject(project.metadata);
  const aiRouting = pccMetadataObject(metadata.pccAiRouting);
  const executionProfile = normalizePccExecutionProfile(metadata);
  const form: PccProjectFormState = {
    id: project.id,
    title: project.title,
    goal: project.goal ?? "",
    projectDescription: metadataString(metadata.pccProjectDescription, project.goal ?? ""),
    changeRequest: "",
    status: project.status,
    priority: String(project.priority ?? 3),
    dueDate: metadataDateInput(metadata.dueDate ?? metadata.pccDueDate),
    outcomeMetrics: outcomeMetricsText(metadata.pccOutcomeMetrics),
    workflowTemplateId: metadataString(metadata.pccWorkflowTemplateId, "software-product"),
    planningMode: metadataString(
      aiRouting.planningMode ?? metadata.pccPlanningMode,
      "template_only",
    ) as PccPlanningMode,
    plannerMode: metadataString(
      aiRouting.plannerMode ?? metadata.pccPlannerMode,
      "local_model",
    ) as PccPlannerMode,
    aiUsePolicy: normalizeAiUsePolicy(
      aiRouting.policy ?? metadata.pccAiUsePolicy,
      aiUsePolicyFromPlannerMode(
        metadataString(metadata.pccPlannerMode, "local_model") as PccPlannerMode,
      ),
    ),
    plannerModelId: executionProfile.localModelId,
    plannerPermissionScope: executionProfile.approvalScope,
    plannerPermissionBudget: "",
    planPreviewAccepted: true,
    planningDepth: "automatic",
    generatedPlan: null,
    planRevision: null,
    codexPlanningAllowed: permissions.some((permission) =>
      pccCodexPermissionIsUsable(permission, executionProfile),
    ),
    remoteProofAllowed: metadataBoolean(metadata.pccRemoteProofAllowed, false),
    runtimeActionsAllowed: metadataBoolean(metadata.pccRuntimeActionsAllowed, false),
    executionProfile,
    intakeAnswers: pccIntakeAnswersFromMetadata(metadata),
    intakeApproved: metadataBoolean(pccMetadataObject(metadata.pccIntake).approved, false),
  };
  return canonicalizeProjectAiRouting(form);
}

function normalizePccProjectDetail(detail: PccProjectsGetResult): PccProjectDetail {
  return {
    project: detail.project,
    milestones: detail.milestones.toSorted(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title),
    ),
    subMilestones: (detail.subMilestones ?? []).toSorted(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title),
    ),
    permissions: detail.permissions ?? [],
    evidence: detail.evidence ?? [],
    receipts: detail.receipts ?? [],
    decisions: (detail.decisions ?? []).toSorted((a, b) => b.decidedAt.localeCompare(a.decidedAt)),
    lastKnownGood: (detail.lastKnownGood ?? []).toSorted(
      (a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt),
    ),
    aiUsage: detail.aiUsage,
    summary: safeProjectSummary(detail.summary),
  };
}

function milestoneFormFromMilestone(milestone: PccMilestone): PccMilestoneFormState {
  return {
    id: milestone.id,
    projectId: milestone.projectId,
    title: milestone.title,
    status: milestone.status,
    phaseId: milestone.phaseId ?? "",
    order: milestone.order === undefined ? "" : String(milestone.order),
    percentComplete:
      milestone.percentComplete === undefined ? "" : String(milestone.percentComplete),
    blocker: milestone.blocker ?? "",
    implementationPlan: milestone.implementationPlan ?? "",
    acceptanceCriteria: (milestone.acceptanceCriteria ?? []).join("\n"),
    responsibility: pccResponsibilityForItem(milestone) || "local_openclaw_agent",
    costRisk: metadataString(pccMetadataObject(milestone.metadata).pccCostRisk, "low"),
    stopHere: metadataBoolean(pccMetadataObject(milestone.metadata).pccStopHere, false),
  };
}

function setActionError(state: PccDashboardState, err: unknown): void {
  state.pccActionError = formatConnectError(err) || "Project Command Center action failed";
  state.pccActionNotice = null;
}

function setActionNotice(state: PccDashboardState, text: string, undoLabel?: string): void {
  state.pccActionNotice = { kind: "success", text, ...(undoLabel ? { undoLabel } : {}) };
}

function clearPccUndo(state: PccDashboardState): void {
  state.pccLastUndoAction = null;
}

function setPccUndo(state: PccDashboardState, label: string, run: () => Promise<void>): void {
  state.pccLastUndoAction = { label, run };
}

export async function runPccUndoAction(state: PccDashboardState): Promise<void> {
  const action = state.pccLastUndoAction;
  if (!action) {
    state.pccActionError = "No Project Command Center action is available to undo.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    await action.run();
    clearPccUndo(state);
    setActionNotice(state, `${action.label} undone.`);
  });
}

function setupRepairMessage(
  evaluation: ReturnType<typeof evaluatePccProjectSetup>,
  detail?: PccProjectDetail,
): string {
  const blockers = detail
    ? buildPccWorkStartBlockers({
        project: detail.project,
        milestones: detail.milestones,
        subMilestones: detail.subMilestones ?? [],
        permissions: detail.permissions,
        receipts: detail.receipts,
      })
    : [];
  const firstIssue =
    blockers[0] ??
    evaluation.missing[0] ??
    evaluation.violations[0] ??
    evaluation.needsReview[0] ??
    "project setup needs review";
  return `PCC cannot start this project yet: ${firstIssue}. Review the blocker checklist, plan the setup repair with Codex, or resume the project if it is on hold.`;
}

async function withPccAction(
  state: PccDashboardState,
  action: () => Promise<void>,
  successMessage?: string,
): Promise<void> {
  if (state.pccActionBusy) {
    state.pccActionError =
      "Another Project Command Center action is already running. Wait for it to finish before starting another change.";
    state.requestUpdate?.();
    return;
  }
  if (!state.client || !state.connected) {
    state.pccActionError =
      "Project Command Center is offline or disconnected. Changes were not saved; reconnect and try again.";
    state.pccActionNotice = null;
    state.pccActionBusy = false;
    state.requestUpdate?.();
    return;
  }
  state.pccActionBusy = true;
  state.pccActionError = null;
  state.pccActionNotice = null;
  state.requestUpdate?.();
  try {
    await action();
    if (successMessage && !state.pccActionError) {
      setActionNotice(state, successMessage);
    }
  } catch (err) {
    setActionError(state, err);
  } finally {
    state.pccActionBusy = false;
    state.requestUpdate?.();
  }
}

export async function loadPccDashboard(state: PccDashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.pccLoading = true;
  state.pccError = null;
  state.requestUpdate?.();
  try {
    hydratePccPreferences(state);
    const firstLoad = state.pccUpdatedAt == null;
    if (firstLoad) {
      restorePccLocation(state);
    }
    const [overviewResult, summaryResult] = await Promise.all([
      state.client.request<PccOverviewGetResult | { projects?: PccProjectSummary[] }>(
        "pcc.overview.get",
        {},
      ),
      state.client.request<PccSummaryGetResult>("pcc.summary.get", {}),
    ]);
    const projects = Array.isArray(overviewResult.projects)
      ? overviewResult.projects.map(safeProjectSummary)
      : [];
    const overview =
      "generatedAt" in overviewResult && "system" in overviewResult
        ? (overviewResult as PccOverviewGetResult)
        : null;
    state.pccOverview = overview;
    state.pccProjects = projects;
    state.pccPortfolioSummary =
      overview?.portfolio ?? summaryResult.portfolio ?? summarizePortfolio(projects);
    state.pccExecutionCapacity = summaryResult.executionCapacity ?? null;
    state.pccPlanningPolicy = summaryResult.planningPolicy ?? DEFAULT_PCC_PLANNING_POLICY;
    state.pccPrivateTeamPolicy = summaryResult.privateTeamPolicy;
    state.pccRuntimeIdentity = summaryResult.runtimeIdentity ?? null;
    state.pccUpdateSafety = summaryResult.updateSafety ?? null;
    state.pccReleaseGovernance = summaryResult.releaseGovernance ?? null;
    const activeSurface =
      state.pccSurface ??
      (state.pccSelectedProjectId || state.pccProjectDetail ? "project" : "overview");
    state.pccSurface = activeSurface;
    if (state.pccProjectDetail && activeSurface === "project") {
      rememberPccProjectDetailForState(state, state.pccProjectDetail);
    }
    if (activeSurface !== "project") {
      state.pccSelectedProjectId = null;
      state.pccProjectDetail = null;
    } else if (state.pccSelectedProjectId) {
      const selectedProjectId = state.pccSelectedProjectId;
      const cached = state.pccProjectDetails[selectedProjectId];
      if (cached) {
        state.pccProjectDetail = cached;
      } else {
        try {
          const detail = await state.client.request<PccProjectsGetResult>("pcc.projects.get", {
            projectId: selectedProjectId,
          });
          const normalized = normalizePccProjectDetail(detail);
          state.pccProjectDetail = normalized;
          rememberPccProjectDetailForState(state, normalized);
        } catch {
          state.pccSurface = "overview";
          state.pccSelectedProjectId = null;
          state.pccProjectDetail = null;
        }
      }
    }
    state.pccUpdatedAt = Date.now();
    await updatePccPresence(state);
    if (activeSurface === "project" && state.pccSelectedProjectId) {
      void loadPccExecutionProjection(state, state.pccSelectedProjectId);
    }
  } catch (err) {
    state.pccError = formatConnectError(err) || "Project Command Center unavailable";
  } finally {
    state.pccLoading = false;
    state.requestUpdate?.();
  }
}

export async function updatePccPlanningPolicy(
  state: PccDashboardState,
  enabled: boolean,
): Promise<void> {
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const result = await state.client.request<{ policy: PccPlanningPolicy }>(
      "pcc.planningPolicy.upsert",
      {
        enabled,
        depth: state.pccPlanningPolicy?.depth ?? DEFAULT_PCC_PLANNING_POLICY.depth,
        model: state.pccPlanningPolicy?.model ?? DEFAULT_PCC_PLANNING_POLICY.model,
      },
    );
    state.pccPlanningPolicy = result.policy;
    setActionNotice(
      state,
      enabled
        ? "Planning grant enabled. Local AI remains the default; Codex is opt-in and planning-only."
        : "Planning grant disabled. Local project execution settings were not changed.",
    );
  });
}

export async function updatePccPresence(
  state: PccDashboardState,
  status: "online" | "away" = "online",
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const result = await state.client.request<PccPresenceListResult>("pcc.presence.update", {
      displayName: "Team member",
      status,
      surface: state.pccSurface ?? "overview",
      ...(state.pccSurface === "project" && state.pccSelectedProjectId
        ? { projectId: state.pccSelectedProjectId }
        : {}),
      editing: state.pccEditorMode != null,
    });
    state.pccPresence = result.presence;
    state.requestUpdate?.();
  } catch {
    // Presence is ephemeral and must never block durable project work.
  }
}

export function updatePccSurface(state: PccDashboardState, surface: PccSurface): void {
  state.pccSurface = surface;
  if (surface !== "project") {
    state.pccSelectedProjectId = null;
    state.pccProjectDetail = null;
    state.pccExecutionProjection = null;
  }
  if (surface === "projects") {
    syncPccDirectoryUrl(state.pccProjectFilter, state.pccProjectSearchQuery, false);
  } else {
    syncPccUrl(surface);
  }
  state.requestUpdate?.();
  void updatePccPresence(state);
}

export function togglePccFavorite(state: PccDashboardState, projectId: string): void {
  hydratePccPreferences(state);
  const favorites = new Set(state.pccFavorites ?? []);
  if (favorites.has(projectId)) {
    favorites.delete(projectId);
  } else {
    favorites.add(projectId);
  }
  state.pccFavorites = [...favorites];
  writeProjectPreference(PCC_FAVORITES_KEY, state.pccFavorites);
  state.requestUpdate?.();
}

export async function openPccAttention(
  state: PccDashboardState,
  projectId: string,
  recordId?: string,
): Promise<void> {
  state.pccAttentionRecordId = recordId ?? null;
  await selectPccProject(state, projectId);
  if (!recordId || globalThis.document === undefined) {
    return;
  }
  globalThis.setTimeout(() => {
    const dialog = [
      ...globalThis.document.querySelectorAll<HTMLDialogElement>(
        "[data-pcc-permission-review-dialog]",
      ),
    ].find((candidate) => candidate.dataset.pccPermissionReviewDialog === projectId);
    if (!dialog) {
      return;
    }
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    dialog.querySelector<HTMLButtonElement>("[data-pcc-permission-grant]")?.focus();
  }, 0);
}

export async function selectPccProject(state: PccDashboardState, projectId: string): Promise<void> {
  if (!state.client) {
    state.pccActionError =
      "Project Command Center is offline or disconnected. Project details could not be loaded.";
    state.requestUpdate?.();
    return;
  }
  state.pccActionError = null;
  state.pccSurface = "project";
  state.pccSelectedProjectId = projectId;
  hydratePccPreferences(state);
  state.pccRecentProjectIds = [
    projectId,
    ...(state.pccRecentProjectIds ?? []).filter((id) => id !== projectId),
  ].slice(0, 10);
  writeProjectPreference(PCC_RECENTS_KEY, state.pccRecentProjectIds);
  syncPccUrl("project", projectId);
  const cached = state.pccProjectDetails?.[projectId];
  if (cached) {
    state.pccProjectDetail = cached;
    state.pccProductFocusMode = pccWorkScopeForProject(cached.project);
  } else if (state.pccProjectDetail?.project.id !== projectId) {
    state.pccProjectDetail = null;
  }
  state.requestUpdate?.();
  try {
    const detail = await state.client.request<PccProjectsGetResult>("pcc.projects.get", {
      projectId,
    });
    state.pccSelectedProjectId = detail.project.id;
    state.pccProjectDetail = normalizePccProjectDetail(detail);
    state.pccProductFocusMode = pccWorkScopeForProject(state.pccProjectDetail.project);
    rememberPccProjectDetailForState(state, state.pccProjectDetail);
    refreshPccChatSyncProposals(state);
    void loadPccExecutionProjection(state, detail.project.id);
    void updatePccPresence(state);
  } catch (err) {
    setActionError(state, err);
  } finally {
    state.requestUpdate?.();
  }
}

export async function loadPccAttachments(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!state.client || !detail) {
    return;
  }
  try {
    const result = await state.client.request<PccAttachmentsListResult>("pcc.attachments.list", {
      projectId: detail.project.id,
    });
    if (state.pccProjectDetail?.project.id !== detail.project.id) {
      return;
    }
    state.pccProjectDetail = {
      ...state.pccProjectDetail,
      attachments: Array.isArray(result.attachments) ? result.attachments : [],
    };
    rememberPccProjectDetailForState(state, state.pccProjectDetail);
  } catch (error) {
    setActionError(state, error);
  } finally {
    state.requestUpdate?.();
  }
}

export async function clarifyPccAttachmentDraft(
  state: PccDashboardState,
  input: { originalName: string; role: PccAttachment["role"]; instructions: string },
): Promise<{
  clarifiedInstructions: string;
  provenance: { provider: string; model: string; generatedAt: string };
}> {
  if (!state.client) {
    throw new Error("PCC is disconnected; local AI cannot clarify the file instructions.");
  }
  const projectId = state.pccProjectDetail?.project.id;
  if (!projectId) {
    throw new Error("Choose a project before clarifying file instructions.");
  }
  const result = await state.client.request<{
    clarifiedInstructions: string;
    provenance: { provider: string; model: string; generatedAt: string };
  }>("pcc.attachments.clarify", { ...input, projectId });
  try {
    const refreshed = normalizePccProjectDetail(
      await state.client.request<PccProjectsGetResult>("pcc.projects.get", { projectId }),
    );
    if (state.pccProjectDetail?.project.id === projectId) {
      state.pccProjectDetail = {
        ...refreshed,
        attachments: state.pccProjectDetail.attachments,
      };
      rememberPccProjectDetailForState(state, state.pccProjectDetail);
      state.requestUpdate?.();
    }
  } catch {
    // Clarification and its receipt are already durable; the usage card refreshes on the next load.
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 32_768;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return globalThis.btoa(binary);
}

export async function uploadPccAttachment(
  state: PccDashboardState,
  file: File,
  draft: PccAttachmentDraft,
): Promise<void> {
  const projectId = state.pccProjectDetail?.project.id;
  if (!state.client || !projectId) {
    state.pccActionError = "Choose a project before adding a file.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    const begin = await state.client!.request<{
      uploadId: string;
      offset: number;
      expiresAt: string;
    }>("pcc.attachments.upload.begin", {
      projectId,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      role: draft.role,
      scope: draft.scope,
      ...(draft.milestoneId ? { milestoneId: draft.milestoneId } : {}),
      ...(draft.subMilestoneId ? { subMilestoneId: draft.subMilestoneId } : {}),
      instructions: draft.instructions,
      ...(draft.clarifiedInstructions
        ? { clarifiedInstructions: draft.clarifiedInstructions }
        : {}),
      ...(draft.instructionProvenance
        ? { instructionProvenance: draft.instructionProvenance }
        : {}),
      modelAccess: draft.modelAccess,
      sensitivity: draft.sensitivity,
      idempotencyKey: `${projectId}:${file.name}:${file.size}:${file.lastModified}`,
    });
    let offset = begin.offset;
    const chunkBytes = 1024 * 1024;
    while (offset < file.size) {
      const bytes = new Uint8Array(
        await file.slice(offset, Math.min(offset + chunkBytes, file.size)).arrayBuffer(),
      );
      const result = await state.client!.request<{ offset: number }>(
        "pcc.attachments.upload.chunk",
        {
          uploadId: begin.uploadId,
          offset,
          dataBase64: bytesToBase64(bytes),
        },
      );
      offset = result.offset;
    }
    const result = await state.client!.request<{ attachment: PccAttachment }>(
      "pcc.attachments.upload.commit",
      { uploadId: begin.uploadId },
    );
    const detail = state.pccProjectDetail;
    if (detail?.project.id === projectId) {
      detail.attachments = [
        result.attachment,
        ...(detail.attachments ?? []).filter((item) => item.id !== result.attachment.id),
      ];
      rememberPccProjectDetailForState(state, detail);
    }
    setActionNotice(
      state,
      `${file.name} is attached as ${draft.role}. Its instructions and model access are saved.`,
    );
  });
}

const PCC_EXECUTION_SESSION_LIMIT = 24;

export async function loadPccExecutionProjection(
  state: PccDashboardState,
  projectId: string,
): Promise<PccExecutionRuntimeProjection | null> {
  if (!state.client || !state.connected) {
    state.pccExecutionProjection = null;
    state.pccExecutionProjectionError = "Live execution state is unavailable while disconnected.";
    return null;
  }
  const selectedProjectId = projectId.trim();
  if (!selectedProjectId) {
    return null;
  }
  state.pccExecutionProjectionLoading = true;
  state.pccExecutionProjectionError = null;
  state.requestUpdate?.();
  try {
    const sessionResult = await state.client.request<SessionsListResult>("sessions.list", {
      limit: 200,
      includeGlobal: false,
      includeUnknown: false,
    });
    const sessions = sessionResult.sessions
      .filter((session) => session.projectId === selectedProjectId)
      .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, PCC_EXECUTION_SESSION_LIMIT);
    const settled = await Promise.allSettled(
      sessions.map((session) =>
        state.client!.request<ExecutionStateSnapshot>("executionState.get", {
          sessionKey: session.key,
          includeTerminal: false,
        }),
      ),
    );
    const snapshots = settled
      .filter(
        (entry): entry is PromiseFulfilledResult<ExecutionStateSnapshot> =>
          entry.status === "fulfilled",
      )
      .map((entry) => entry.value);
    if (sessions.length > 0 && snapshots.length === 0) {
      throw new Error("No linked chat returned typed execution state.");
    }
    const projection = buildPccExecutionRuntimeProjection({
      projectId: selectedProjectId,
      snapshots,
    });
    if (state.pccSelectedProjectId === selectedProjectId) {
      state.pccExecutionProjection = projection;
      const failedCount = settled.length - snapshots.length;
      state.pccExecutionProjectionError =
        failedCount > 0
          ? `${failedCount} linked chat${failedCount === 1 ? "" : "s"} could not be read.`
          : null;
    }
    return projection;
  } catch (err) {
    if (state.pccSelectedProjectId === selectedProjectId) {
      state.pccExecutionProjection = null;
      state.pccExecutionProjectionError = formatConnectError(err);
    }
    return null;
  } finally {
    if (state.pccSelectedProjectId === selectedProjectId) {
      state.pccExecutionProjectionLoading = false;
    }
    state.requestUpdate?.();
  }
}

export function openPccProjectEditor(state: PccDashboardState, project?: PccProject): void {
  state.pccEditorMode = project ? "edit-project" : "create-project";
  state.pccProjectEditMode = "simple";
  state.pccProjectForm = project
    ? projectFormFromProject(
        project,
        state.pccProjectDetail?.project.id === project.id ? state.pccProjectDetail.permissions : [],
      )
    : { ...EMPTY_PCC_PROJECT_FORM };
  state.pccActionError = null;
  state.requestUpdate?.();
}

export function openPccMilestoneEditor(state: PccDashboardState, milestone?: PccMilestone): void {
  const projectId = milestone?.projectId ?? state.pccSelectedProjectId;
  state.pccEditorMode = milestone ? "edit-milestone" : "create-milestone";
  state.pccMilestoneForm = milestone
    ? milestoneFormFromMilestone(milestone)
    : { ...EMPTY_PCC_MILESTONE_FORM, projectId };
  state.pccActionError = null;
  state.requestUpdate?.();
}

export function cancelPccEditor(state: PccDashboardState): void {
  state.pccEditorMode = null;
  state.pccActionError = null;
  state.requestUpdate?.();
}

export function updatePccViewMode(state: PccDashboardState, mode: PccViewMode): void {
  state.pccViewMode = mode;
  state.requestUpdate?.();
}

export function updatePccProductFocusMode(
  state: PccDashboardState,
  mode: "pcc_product" | "project_work",
): void {
  state.pccProductFocusMode = mode;
  state.pccProjectFilter = undefined;
  state.requestUpdate?.();
}

export function updatePccReorderMode(state: PccDashboardState, enabled: boolean): void {
  state.pccReorderMode = enabled;
  state.requestUpdate?.();
}

export function updatePccProjectEditMode(state: PccDashboardState, mode: PccProjectEditMode): void {
  state.pccProjectEditMode = mode;
  state.requestUpdate?.();
}

export function updatePccProjectFilter(state: PccDashboardState, filter: PccProjectFilter): void {
  state.pccProjectFilter = filter;
  if (state.pccSurface === "projects") {
    syncPccDirectoryUrl(filter, state.pccProjectSearchQuery, false);
  }
  state.requestUpdate?.();
}

export function updatePccProjectSearchQuery(state: PccDashboardState, query: string): void {
  state.pccProjectSearchQuery = query;
  if (state.pccSurface === "projects") {
    syncPccDirectoryUrl(state.pccProjectFilter, query, true);
  }
  state.requestUpdate?.();
}

export function dismissPccActionNotice(state: PccDashboardState): void {
  state.pccActionNotice = null;
  clearPccUndo(state);
  state.requestUpdate?.();
}

export function updatePccProjectForm(
  state: PccDashboardState,
  patch: Partial<PccProjectFormState>,
): void {
  let nextForm = { ...state.pccProjectForm, ...patch };
  if (patch.executionProfile) {
    nextForm = canonicalizeProjectAiRouting(nextForm);
  } else if (patch.aiUsePolicy) {
    const legacyPreset =
      patch.aiUsePolicy === "local_only"
        ? "local_focused"
        : patch.aiUsePolicy === "codex_everything"
          ? "ultra_hybrid"
          : "balanced";
    nextForm = canonicalizeProjectAiRouting({
      ...nextForm,
      executionProfile: resolvePccExecutionProfilePreset(legacyPreset),
    });
  }
  if (patch.plannerMode) {
    nextForm = canonicalizeProjectAiRouting({
      ...nextForm,
      plannerMode: patch.plannerMode,
    });
  }
  if (patch.projectDescription !== undefined) {
    nextForm = {
      ...nextForm,
      planPreviewAccepted: false,
      generatedPlan: null,
      planRevision: null,
    };
  }
  if (patch.changeRequest !== undefined) {
    nextForm = {
      ...nextForm,
      planPreviewAccepted: false,
      generatedPlan: null,
      planRevision: null,
    };
  }
  state.pccProjectForm = nextForm;
  state.requestUpdate?.();
}

export async function generatePccProjectPlan(state: PccDashboardState): Promise<void> {
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const form = state.pccProjectForm;
    const changeRequest = form.changeRequest.trim();
    const detail =
      form.id && state.pccProjectDetail?.project.id === form.id ? state.pccProjectDetail : null;
    const baseDescription = detail?.project.id
      ? detailText(detail)
      : form.projectDescription.trim() || form.goal.trim() || form.title.trim();
    const description =
      form.id && changeRequest
        ? `${baseDescription}\n\nRequested project change:\n${changeRequest}`
        : baseDescription;
    if (!description) {
      state.pccActionError = "Describe what you want this project to accomplish first.";
      return;
    }
    const planningRequest = {
      surface: form.id ? "project_replan" : "project_creation",
      plannerMode:
        form.plannerMode === "codex" || form.plannerMode === "high_reasoning_codex"
          ? ("codex" as const)
          : ("local" as const),
      description,
      ...(form.title.trim() ? { existingTitle: form.title.trim() } : {}),
      ...(form.goal.trim() ? { existingGoal: form.goal.trim() } : {}),
      ...(form.id && changeRequest
        ? {
            desiredOutcome:
              "Create a safe revised project plan that implements the requested change, preserves completed work, and identifies all affected milestones, dependencies, proof, and permissions.",
            constraints: [
              "Preserve completed milestones and their receipts.",
              "Do not delete project history.",
              "Do not start implementation.",
              "Do not perform external writes, deployment, credential changes, destructive actions, purchases, publication, or reboot.",
            ],
          }
        : {}),
      preferredTemplateId: form.workflowTemplateId,
      depth: form.planningDepth,
    };
    const started = await state.client.request<{ run: PccPlanningRun }>(
      "pcc.plans.start",
      planningRequest,
    );
    state.pccPlanningRun = started.run;
    state.requestUpdate?.();
    let run = started.run;
    const deadline = Date.now() + 4 * 60_000;
    while (run.status === "queued" || run.status === "running") {
      if (Date.now() >= deadline) {
        throw new Error(
          "Project planning is still running. Your description is safe; refresh PCC to reconnect to the planning run.",
        );
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 750);
      });
      const current = await state.client.request<{ run: PccPlanningRun }>("pcc.plans.get", {
        runId: run.id,
      });
      run = current.run;
      state.pccPlanningRun = run;
      state.requestUpdate?.();
    }
    if (run.status === "cancelled") {
      setActionNotice(state, "Plan generation cancelled. Your project description is still here.");
      return;
    }
    if (run.status !== "succeeded" || !run.plan) {
      throw new Error(run.error || `Project planning ${run.status}. Your description is safe.`);
    }
    const plan = run.plan as PccPlanGenerationResult;
    const planRevision =
      detail && changeRequest
        ? buildPccPlanRevisionPreview({
            project: detail.project,
            milestones: detail.milestones,
            subMilestones: detail.subMilestones ?? [],
            request: changeRequest,
            plan,
          })
        : null;
    state.pccProjectForm = {
      ...form,
      title: form.title.trim() || plan.title,
      goal: form.goal.trim() || plan.goal,
      outcomeMetrics: form.outcomeMetrics.trim()
        ? form.outcomeMetrics
        : plan.outcomeMetrics.join("\n"),
      workflowTemplateId: plan.workflowTemplateId,
      planningMode: plan.provenance.runtime === "codex" ? "codex_full_plan" : "template_only",
      plannerMode: plan.provenance.runtime === "codex" ? "codex" : "local_model",
      plannerModelId: plan.provenance.model,
      planPreviewAccepted: !form.id,
      generatedPlan: plan,
      planRevision,
      intakeAnswers: { ...generatedPlanIntake(plan), ...form.intakeAnswers },
      intakeApproved: true,
    };
    setActionNotice(
      state,
      planRevision
        ? `Change preview generated by ${plan.provenance.model} at ${plan.provenance.effort} effort. Review the impact before applying it.`
        : `Plan generated by ${plan.provenance.model} at ${plan.provenance.effort} effort. Review it before creating the project.`,
    );
  });
}

export async function cancelPccProjectPlan(state: PccDashboardState): Promise<void> {
  const run = state.pccPlanningRun;
  if (!run || !state.client || (run.status !== "queued" && run.status !== "running")) {
    return;
  }
  try {
    const result = await state.client.request<{ run: PccPlanningRun }>("pcc.plans.cancel", {
      runId: run.id,
    });
    state.pccPlanningRun = result.run;
    setActionNotice(state, "Plan generation cancelled. Your project description is still here.");
  } catch (error) {
    setActionError(state, error);
  } finally {
    state.requestUpdate?.();
  }
}

export function openPccDecisionForm(state: PccDashboardState): void {
  state.pccDecisionFormOpen = true;
  state.pccDecisionForm = {
    ...EMPTY_PCC_DECISION_FORM,
    decidedBy: "User",
  };
  state.pccActionError = null;
  state.requestUpdate?.();
}

export function cancelPccDecisionForm(state: PccDashboardState): void {
  state.pccDecisionFormOpen = false;
  state.pccDecisionForm = { ...EMPTY_PCC_DECISION_FORM };
  state.pccActionError = null;
  state.requestUpdate?.();
}

export function updatePccDecisionForm(
  state: PccDashboardState,
  patch: Partial<PccDecisionFormState>,
): void {
  state.pccDecisionForm = { ...state.pccDecisionForm, ...patch };
  state.requestUpdate?.();
}

function decisionEvidenceIds(value: string): string[] | undefined {
  const ids = value
    .split(/[\n,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export async function savePccDecision(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before recording a decision.";
    state.requestUpdate?.();
    return;
  }
  const form = state.pccDecisionForm;
  const title = form.title.trim();
  const summary = form.summary.trim();
  if (!title || !summary) {
    state.pccActionError = "Decision title and summary are required.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const evidenceIds = decisionEvidenceIds(form.evidenceIds);
    await state.client.request<PccDecisionsAddResult>("pcc.decisions.add", {
      decision: {
        projectId: detail.project.id,
        title,
        summary,
        ...(form.milestoneId ? { milestoneId: form.milestoneId } : {}),
        ...(form.subMilestoneId ? { subMilestoneId: form.subMilestoneId } : {}),
        ...(form.rationale.trim() ? { rationale: form.rationale.trim() } : {}),
        ...(form.impact.trim() ? { impact: form.impact.trim() } : {}),
        ...(form.decidedBy.trim() ? { decidedBy: form.decidedBy.trim() } : {}),
        ...(evidenceIds ? { evidenceIds } : {}),
      },
    });
    state.pccDecisionFormOpen = false;
    state.pccDecisionForm = { ...EMPTY_PCC_DECISION_FORM };
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    state.pccActionNotice = { kind: "success", text: "Decision recorded." };
  });
}

export function updatePccMilestoneForm(
  state: PccDashboardState,
  patch: Partial<PccMilestoneFormState>,
): void {
  state.pccMilestoneForm = { ...state.pccMilestoneForm, ...patch };
  state.requestUpdate?.();
}

export function updatePccChatSyncText(state: PccDashboardState, text: string): void {
  state.pccChatSyncText = text;
  state.pccChatSyncError = null;
  refreshPccChatSyncProposals(state);
  state.requestUpdate?.();
}

export function previewPccChatSync(state: PccDashboardState): void {
  refreshPccChatSyncProposals(state);
  state.pccChatSyncError = state.pccChatSyncProposals.length
    ? null
    : "No safe Project Command Center updates were found in this chat text.";
  state.requestUpdate?.();
}

export function dismissPccChatSync(state: PccDashboardState): void {
  state.pccChatSyncText = "";
  state.pccChatSyncProposals = [];
  state.pccChatSyncError = null;
  state.requestUpdate?.();
}

export async function previewPccSetupAutofill(state: PccDashboardState): Promise<void> {
  if (!state.pccProjectDetail) {
    state.pccActionError = "Select a project before using setup autofill.";
    state.requestUpdate?.();
    return;
  }
  const detail = state.pccProjectDetail;
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const result = await state.client.request<{ plan: PccPlanGenerationResult }>(
      "pcc.plans.generate",
      {
        surface: "setup_repair",
        description: detailText(detail),
        existingTitle: detail.project.title,
        ...(detail.project.goal?.trim() ? { existingGoal: detail.project.goal.trim() } : {}),
        desiredOutcome:
          "Repair only missing PCC setup fields and produce an execution-ready plan without starting work.",
        constraints: [
          "Preserve user-entered project data.",
          "Do not mark milestones complete or perform implementation.",
        ],
      },
    );
    const base = buildPccSetupAutofillPreview(detail, false);
    const plan = result.plan;
    state.pccAutofillPreview = {
      ...base,
      goal: detail.project.goal?.trim() || plan.goal,
      workflowTemplateId: plan.workflowTemplateId,
      summary: `Codex generated a planning-only setup repair with ${plan.provenance.model} at ${plan.provenance.effort} effort. Review it before applying.`,
      generatedPlan: plan,
      generatedMilestones:
        activeMilestonesForSetup(detail).length > 0
          ? []
          : plan.milestones.map((milestone) => ({
              title: milestone.title,
              fields: [
                "milestone",
                "implementation plan",
                "acceptance criteria",
                "owner",
                "proof requirement",
              ],
              subMilestoneTitles: milestone.subMilestones.map((item) => item.title),
            })),
      generatedSubMilestones: [],
    };
  });
  if (typeof document !== "undefined") {
    setTimeout(() => {
      const preview = document.querySelector<HTMLElement>("[data-pcc-autofill-preview]");
      preview?.scrollIntoView({ block: "center", behavior: "smooth" });
      preview?.focus({ preventScroll: true });
    }, 0);
  }
}

export async function previewPccSectionAutofill(
  state: PccDashboardState,
  section: PccAiRegenerateSection,
): Promise<void> {
  if (!state.pccProjectDetail) {
    state.pccActionError = "Select a project before using section AI regeneration.";
    state.requestUpdate?.();
    return;
  }
  await previewPccSetupAutofill(state);
  const preview = state.pccAutofillPreview;
  if (!preview) {
    return;
  }
  const sectionTitle = pccAiRegenerateSectionTitle(section);
  const scoped = {
    ...preview,
    section,
    sectionTitle,
    summary: `${preview.summary} Only ${sectionTitle} changes will be applied.`,
  };
  state.pccAutofillPreview =
    section === "goal" || section === "intake" || section === "workflow"
      ? {
          ...scoped,
          milestoneUpdates: [],
          subMilestoneUpdates: [],
          generatedMilestones: [],
          generatedSubMilestones: [],
        }
      : section === "milestones"
        ? { ...scoped, subMilestoneUpdates: [], generatedSubMilestones: [] }
        : section === "submilestones"
          ? { ...scoped, milestoneUpdates: [], generatedMilestones: [] }
          : { ...scoped, generatedMilestones: [], generatedSubMilestones: [] };
  state.requestUpdate?.();
}

export function updatePccAutofillApproval(state: PccDashboardState, approved: boolean): void {
  if (!state.pccProjectDetail || !state.pccAutofillPreview) {
    return;
  }
  state.pccAutofillPreview = { ...state.pccAutofillPreview, intakeApproved: approved };
  state.requestUpdate?.();
}

export function dismissPccSetupAutofill(state: PccDashboardState): void {
  state.pccAutofillPreview = null;
  state.pccActionError = null;
  state.requestUpdate?.();
}

function projectWithAutofill(
  detail: PccProjectDetail,
  preview: PccAutofillPreview,
  now: string,
): PccProject {
  const existingIntake = pccMetadataObject(pccMetadataObject(detail.project.metadata).pccIntake);
  const missingQuestionIds = pccMissingRequiredIntakeAnswers(preview.intakeAnswers);
  const fullRepair = !preview.section;
  const updateGoal = fullRepair || preview.section === "goal";
  const updateWorkflow = fullRepair || preview.section === "workflow";
  const updateIntake = fullRepair || preview.section === "intake";
  return {
    ...detail.project,
    goal: updateGoal ? preview.goal : detail.project.goal,
    metadata: {
      ...pccMetadataObject(detail.project.metadata),
      ...(preview.generatedPlan ? { pccPlanningProvenance: preview.generatedPlan.provenance } : {}),
      ...(updateWorkflow
        ? {
            pccWorkflowTemplateId: preview.workflowTemplateId,
            pccWorkflowTemplateTitle: preview.workflowTitle,
          }
        : {}),
      pccPlanPreviewAccepted: true,
      pccSetupAutofill: {
        summary: preview.summary,
        appliedAt: now,
        source: preview.generatedPlan ? "live_codex" : "deterministic_canonical_repair",
      },
      ...(updateIntake
        ? {
            pccIntake: {
              ...existingIntake,
              answers: preview.intakeAnswers,
              approved: preview.intakeApproved,
              ...(preview.intakeApproved ? { approvedAt: now } : {}),
              missingQuestionIds,
              status: preview.intakeApproved ? "approved" : "needs_review",
            },
          }
        : {}),
    },
  };
}

function applyMilestoneAutofill(
  milestones: readonly PccMilestone[],
  preview: PccAutofillPreview,
): PccMilestone[] {
  const changedIds = new Set(preview.milestoneUpdates.map((item) => item.id));
  return milestones.map((milestone) =>
    changedIds.has(milestone.id) ? buildMilestoneAutofillPatch(milestone).milestone : milestone,
  );
}

function applySubMilestoneAutofill(
  subMilestones: readonly PccSubMilestone[],
  preview: PccAutofillPreview,
): PccSubMilestone[] {
  const changedIds = new Set(preview.subMilestoneUpdates.map((item) => item.id));
  return subMilestones.map((subMilestone) =>
    changedIds.has(subMilestone.id)
      ? buildSubMilestoneAutofillPatch(subMilestone).subMilestone
      : subMilestone,
  );
}

function generatedExistingSubMilestonesForApply(
  detail: PccProjectDetail,
): Array<Omit<PccSubMilestone, "id" | "createdAt" | "updatedAt">> {
  const existingSubMilestones = detail.subMilestones ?? [];
  return activeMilestonesForSetup(detail)
    .filter(
      (milestone) =>
        !existingSubMilestones.some(
          (subMilestone) =>
            subMilestone.milestoneId === milestone.id &&
            !PCC_TERMINAL_STATUSES.has(subMilestone.status),
        ),
    )
    .flatMap((milestone) =>
      generatedSubMilestoneDraftsFor(detail, milestone).map((subMilestone) =>
        Object.assign({}, subMilestone, {
          projectId: detail.project.id,
          milestoneId: milestone.id,
        }),
      ),
    );
}

function evaluationMilestonesWithGenerated(
  detail: PccProjectDetail,
  patchedMilestones: PccMilestone[],
  preview: PccAutofillPreview,
  now: string,
): PccMilestone[] {
  if (activeMilestonesForSetup(detail).length > 0) {
    return patchedMilestones;
  }
  const draft = workflowDraftForSetup(detail, preview.goal, preview.generatedPlan);
  return draft.milestones.map((milestone, index) =>
    Object.assign({}, milestone, {
      id: `preview-generated-milestone-${index}`,
      projectId: detail.project.id,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

function evaluationSubMilestonesWithGenerated(
  detail: PccProjectDetail,
  patchedSubMilestones: PccSubMilestone[],
  preview: PccAutofillPreview,
  now: string,
): PccSubMilestone[] {
  const generatedExisting = generatedExistingSubMilestonesForApply(detail).map(
    (subMilestone, index) =>
      Object.assign({}, subMilestone, {
        id: `preview-generated-submilestone-${index}`,
        createdAt: now,
        updatedAt: now,
      }),
  );
  if (activeMilestonesForSetup(detail).length > 0) {
    return [...patchedSubMilestones, ...generatedExisting];
  }
  const draft = workflowDraftForSetup(detail, preview.goal, preview.generatedPlan);
  return [
    ...patchedSubMilestones,
    ...draft.milestones.flatMap((milestone, milestoneIndex) =>
      (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []).map((subMilestone, subIndex) =>
        Object.assign({}, subMilestone, {
          id: `preview-generated-submilestone-${milestoneIndex}-${subIndex}`,
          projectId: detail.project.id,
          milestoneId: `preview-generated-milestone-${milestoneIndex}`,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ),
  ];
}

export async function applyPccSetupAutofill(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  const preview = state.pccAutofillPreview ?? buildPccSetupAutofillPreview(detail, false);
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const now = new Date().toISOString();
    const patchedMilestones = applyMilestoneAutofill(detail.milestones, preview);
    const patchedSubMilestones = applySubMilestoneAutofill(detail.subMilestones ?? [], preview);
    const projectBase = projectWithAutofill(detail, preview, now);
    const evaluationMilestones = evaluationMilestonesWithGenerated(
      detail,
      patchedMilestones,
      preview,
      now,
    );
    const evaluationSubMilestones = evaluationSubMilestonesWithGenerated(
      detail,
      patchedSubMilestones,
      preview,
      now,
    );
    const evaluation = evaluatePccProjectSetup({
      project: projectBase,
      milestones: evaluationMilestones,
      subMilestones: evaluationSubMilestones,
    });
    const projectForUpsert = withPccPhase2Metadata(projectBase, evaluation, now);
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload(projectForUpsert),
    });
    for (const milestone of patchedMilestones.filter((item) =>
      preview.milestoneUpdates.some((update) => update.id === item.id),
    )) {
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload(milestone),
      });
    }
    for (const subMilestone of patchedSubMilestones.filter((item) =>
      preview.subMilestoneUpdates.some((update) => update.id === item.id),
    )) {
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload(subMilestone),
      });
    }
    if (
      activeMilestonesForSetup(detail).length === 0 &&
      (!preview.section || preview.section === "milestones")
    ) {
      const draft = workflowDraftForSetup(detail, preview.goal, preview.generatedPlan);
      for (const milestone of draft.milestones) {
        const created = await state.client.request<{ milestone: PccMilestone }>(
          "pcc.milestones.upsert",
          { milestone: milestoneUpsertPayload({ ...milestone, projectId: detail.project.id }) },
        );
        for (const subMilestone of draft.subMilestonesByMilestoneTitle[milestone.title] ?? []) {
          await state.client.request("pcc.subMilestones.upsert", {
            subMilestone: subMilestoneUpsertPayload({
              ...subMilestone,
              projectId: detail.project.id,
              milestoneId: created.milestone.id,
            }),
          });
        }
      }
    } else if (!preview.section || preview.section === "submilestones") {
      for (const subMilestone of generatedExistingSubMilestonesForApply(detail)) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload(subMilestone),
        });
      }
    }
    state.pccAutofillPreview = null;
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    const refreshed = state.pccProjectDetail;
    const refreshedEvaluation =
      refreshed && refreshed.project.id === detail.project.id
        ? evaluatePccProjectSetup({
            project: refreshed.project,
            milestones: refreshed.milestones,
            subMilestones: refreshed.subMilestones ?? [],
          })
        : evaluation;
    const remainingIssue =
      refreshedEvaluation.missing[0] ??
      refreshedEvaluation.violations[0] ??
      refreshedEvaluation.needsReview[0];
    setActionNotice(
      state,
      remainingIssue
        ? `Setup repair applied. Review and approve intake before work starts. Remaining blocker: ${remainingIssue}`
        : "Setup repair applied. Review and approve intake before work starts.",
    );
  });
}

export async function approvePccSetupAutofill(state: PccDashboardState): Promise<void> {
  if (!state.pccProjectDetail || !state.pccAutofillPreview) {
    return;
  }
  state.pccAutofillPreview = { ...state.pccAutofillPreview, intakeApproved: true };
  await applyPccSetupAutofill(state);
}

export async function savePccProject(state: PccDashboardState): Promise<void> {
  const form = canonicalizeProjectAiRouting(enrichProjectFormFromDescription(state.pccProjectForm));
  const creating = !form.id;
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const availableModelRefs = configuredModelRefs(state.chatModelCatalog);
    const selectedModels = [
      validatePccModelSelection(form.executionProfile.localModelId, availableModelRefs),
      ...(form.executionProfile.codexRole === "off"
        ? []
        : [validatePccModelSelection(form.executionProfile.codexModelId, availableModelRefs)]),
    ];
    const unavailableModel = selectedModels.find((selection) => selection.status === "unavailable");
    if (unavailableModel) {
      state.pccActionError = `The selected model “${unavailableModel.modelId}” is no longer configured. Refresh the model list, then choose an available model or Best available.`;
      return;
    }
    const intakeMissing = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
    if (
      !form.id &&
      (intakeMissing.length > 0 || !form.intakeApproved || !form.planPreviewAccepted)
    ) {
      state.pccActionError = intakeMissing.length
        ? "Required project intake answers are missing."
        : !form.intakeApproved
          ? "Project intake must be approved before setup can be saved."
          : "Review and approve the generated plan preview before creating the project.";
      return;
    }
    if (form.id && form.planRevision) {
      if (!form.planRevision.safeToApply) {
        state.pccActionError =
          form.planRevision.integrityErrors[0] ??
          "The proposed plan revision failed its integrity check.";
        return;
      }
      if (!form.planPreviewAccepted) {
        state.pccActionError = "Review and approve the project change preview before applying it.";
        return;
      }
      const currentDetail =
        state.pccProjectDetail?.project.id === form.id ? state.pccProjectDetail : null;
      if (
        !currentDetail ||
        pccProjectPlanFingerprint(
          currentDetail.project,
          currentDetail.milestones,
          currentDetail.subMilestones ?? [],
        ) !== form.planRevision.beforeFingerprint
      ) {
        state.pccActionError =
          "This project changed after the preview was generated. Generate a fresh change preview before applying it.";
        return;
      }
    }
    const resolvedCodexModel =
      form.executionProfile.codexRole === "off"
        ? null
        : resolveConfiguredExecutionModel(
            form.executionProfile.codexModelId,
            state.chatModelCatalog,
            "codex",
          );
    // "Best available" is intentionally a deferred route: project setup must remain durable even
    // when no Codex checkpoint is runnable yet. Execution readiness resolves it before dispatch.
    const codexModelResolvesAtCheckpoint =
      form.executionProfile.codexModelId === PCC_BEST_AVAILABLE_MODEL_ID;
    if (
      form.executionProfile.codexRole !== "off" &&
      !codexModelResolvesAtCheckpoint &&
      (!resolvedCodexModel ||
        !pccCodexEffortIsSupported(resolvedCodexModel, form.executionProfile.codexEffort))
    ) {
      state.pccActionError =
        form.executionProfile.codexEffort === "max"
          ? "Maximum Codex depth requires an available GPT-5.6 model. Refresh models or choose a lower depth."
          : "Refresh models and choose an available Codex model before creating this project.";
      return;
    }
    const priority = parseOptionalInteger(form.priority);
    const dueDate = normalizeDateInput(form.dueDate);
    const outcomeMetrics = parseOutcomeMetrics(form.outcomeMetrics);
    const now = new Date().toISOString();
    const recommendedWorkflow = recommendPccWorkflow({
      title: form.title,
      goal: form.goal,
      intakeAnswers: form.intakeAnswers,
    });
    const existingIntake = pccMetadataObject(
      pccMetadataObject(state.pccProjectDetail?.project.metadata).pccIntake,
    );
    const existingProjectMetadata = pccMetadataObject(state.pccProjectDetail?.project.metadata);
    const existingPlanRevisionHistory = Array.isArray(
      existingProjectMetadata.pccPlanRevisionHistory,
    )
      ? existingProjectMetadata.pccPlanRevisionHistory
      : [];
    const newPlanRevisionHistory = planRevisionHistoryMetadata(form, now);
    const reconciledExecutionPlans =
      form.planRevision && form.id
        ? reconcileExecutionPlansForRevision(state.pccProjectDetail?.project, now)
        : null;
    const intakeMetadata = {
      answers: form.intakeAnswers,
      approved: form.intakeApproved,
      ...(form.intakeApproved
        ? { approvedAt: form.id ? metadataString(existingIntake.approvedAt, now) : now }
        : {}),
      missingQuestionIds: intakeMissing,
      status: form.intakeApproved ? "approved" : "needs_review",
    };
    const draft = form.id ? null : workflowDraftFromGeneratedPlan(form, priority);
    const draftSubMilestones =
      draft?.milestones.flatMap((milestone) =>
        (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []).map((subMilestone) =>
          Object.assign({}, subMilestone, {
            id: `draft-${milestone.title}-${subMilestone.title}`,
            projectId: "draft-project",
            milestoneId: `draft-${milestone.title}`,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ) ?? [];
    const draftMilestones =
      draft?.milestones.map((milestone) => ({
        ...milestone,
        id: `draft-${milestone.title}`,
        projectId: "draft-project",
        createdAt: now,
        updatedAt: now,
      })) ?? [];
    const baseProject = form.id
      ? {
          ...state.pccProjectDetail?.project,
          id: form.id,
          title: form.title.trim(),
          ...(form.goal.trim() ? { goal: form.goal.trim() } : { goal: "" }),
          status: form.status,
          ...(priority !== undefined ? { priority } : {}),
          metadata: {
            ...metadataWithoutLegacyExecutionRouting(state.pccProjectDetail?.project.metadata),
            pccWorkflowTemplateId: form.workflowTemplateId,
            pccWorkflowTemplateTitle: recommendedWorkflow.title,
            pccExecutionProfile: form.executionProfile,
            pccProjectDescription: form.projectDescription,
            ...(form.generatedPlan ? { pccPlanningProvenance: form.generatedPlan.provenance } : {}),
            ...(newPlanRevisionHistory.length > 0
              ? {
                  pccPlanRevisionHistory: [
                    ...existingPlanRevisionHistory.slice(-9),
                    ...newPlanRevisionHistory,
                  ],
                  pccCurrentPlanRevisionId: form.planRevision?.id,
                  pccPlanRevisionProofStale: form.planRevision?.staleProofMilestoneIds ?? [],
                  pccPlanRevisionRollbackAvailable: true,
                  ...(reconciledExecutionPlans
                    ? {
                        pccExecutionPlans: reconciledExecutionPlans,
                        pccActiveExecutionPlanId: null,
                        pccExecutionLastUpdatedAt: now,
                      }
                    : {}),
                }
              : {}),
            pccOutcomeMetrics: outcomeMetrics,
            ...(dueDate
              ? { dueDate, pccDueDate: dueDate }
              : { dueDate: undefined, pccDueDate: undefined }),
            pccPlanPreviewAccepted: form.planPreviewAccepted,
            pccRemoteProofAllowed: form.remoteProofAllowed,
            pccRuntimeActionsAllowed: form.runtimeActionsAllowed,
            pccIntake: intakeMetadata,
          },
        }
      : {
          ...draft!.project,
          metadata: {
            ...metadataWithoutLegacyExecutionRouting(draft!.project.metadata),
            pccWorkflowTemplateId: form.workflowTemplateId,
            pccWorkflowTemplateTitle: recommendedWorkflow.title,
            pccExecutionProfile: form.executionProfile,
            pccProjectDescription: form.projectDescription,
            ...(form.generatedPlan ? { pccPlanningProvenance: form.generatedPlan.provenance } : {}),
            pccOutcomeMetrics: outcomeMetrics,
            ...(dueDate
              ? { dueDate, pccDueDate: dueDate }
              : { dueDate: undefined, pccDueDate: undefined }),
            pccPlanPreviewAccepted: form.planPreviewAccepted,
            pccIntake: intakeMetadata,
          },
        };
    const evaluation = evaluatePccProjectSetup({
      project: baseProject as PccProject,
      milestones: form.id ? (state.pccProjectDetail?.milestones ?? []) : draftMilestones,
      subMilestones: form.id ? (state.pccProjectDetail?.subMilestones ?? []) : draftSubMilestones,
    });
    const projectForUpsert = withPccPhase2Metadata(baseProject as PccProject, evaluation, now);
    const planningRunId =
      creating && state.pccPlanningRun?.status === "succeeded"
        ? state.pccPlanningRun.id
        : undefined;
    if (creating && !form.generatedPlan) {
      state.pccActionError = "Generate and review a complete project plan before creating it.";
      return;
    }
    const result = creating
      ? await state.client.request<PccProjectPlanCommitResult>("pcc.projects.commitPlan", {
          ...(planningRunId ? { planningRunId } : {}),
          project: projectUpsertPayload(projectForUpsert),
          plan: form.generatedPlan!,
        })
      : await state.client.request<PccProjectsUpsertResult>("pcc.projects.upsert", {
          ...(state.pccProjectDetail?.project.revision
            ? { expectedRevision: state.pccProjectDetail.project.revision }
            : {}),
          project: projectUpsertPayload(projectForUpsert),
        });
    const previousDetail = form.id ? state.pccProjectDetail : null;
    let revisionResult: Awaited<ReturnType<typeof applyGeneratedPlanRevision>> | null = null;
    if (form.id && form.generatedPlan && form.planRevision && previousDetail) {
      try {
        revisionResult = await applyGeneratedPlanRevision({
          state,
          detail: previousDetail,
          plan: form.generatedPlan,
          now,
        });
      } catch (error) {
        try {
          await state.client.request("pcc.projects.upsert", {
            project: projectUpsertPayload({
              ...previousDetail.project,
              revision: result.project.revision,
            }),
          });
        } catch (projectRestoreError) {
          const recoveryError = new AggregateError(
            [error, projectRestoreError],
            `Project plan revision partially applied; recovery is required for project ${previousDetail.project.id}. Project metadata restore failed: ${projectRestoreError instanceof Error ? projectRestoreError.message : String(projectRestoreError)}`,
          );
          recoveryError.cause = projectRestoreError;
          throw recoveryError;
        }
        throw error;
      }
    }
    const existingCodexPermissions = (state.pccProjectDetail?.permissions ?? []).filter(
      (permission) =>
        permission.type === "codex_usage" || permission.type === "high_reasoning_model",
    );
    if (aiUsePolicyNeedsCodex(form.aiUsePolicy)) {
      const permissionType = codexPermissionType(form.executionProfile);
      const existingPermission = existingCodexPermissions.find(
        (permission) => permission.type === permissionType,
      );
      const checkpointActions = codexCheckpointPermissionActions(form.executionProfile);
      await state.client.request("pcc.permissions.upsert", {
        permission: {
          ...(existingPermission ? { id: existingPermission.id } : {}),
          ...(existingPermission ? { revision: existingPermission.revision ?? 1 } : {}),
          projectId: result.project.id,
          type: permissionType,
          status: form.codexPlanningAllowed ? "granted" : "needed",
          riskLevel: permissionType === "high_reasoning_model" ? "high" : "medium",
          allowedActions: checkpointActions,
          forbiddenActions: [
            "Deployment, credential changes, destructive actions, reboot, purchases, publishing, and unrelated external writes",
          ],
          target: `Only these post-plan checkpoints: ${checkpointActions.join("; ")}`,
          ...(form.plannerPermissionScope === "plan" || form.plannerPermissionScope === "ask"
            ? { maxUses: 1 }
            : {}),
          ...(form.codexPlanningAllowed
            ? {
                grantedBy: creating ? "PCC New Project user approval" : "PCC project user approval",
              }
            : {}),
          note: form.codexPlanningAllowed
            ? `Codex use approved for ${form.plannerPermissionScope === "project" ? "this project" : form.plannerPermissionScope === "plan" ? "this plan" : "the next eligible action"}. No hard token cap is configured; PCC records actual runs when available.`
            : "Codex use is blocked until the user grants this single scoped permission. No token budget is requested or inferred.",
        },
      });
    } else {
      for (const permission of existingCodexPermissions.filter(
        (item) => item.status === "granted" || item.status === "needed",
      )) {
        await state.client.request("pcc.permissions.upsert", {
          permission: {
            id: permission.id,
            revision: permission.revision ?? 1,
            projectId: result.project.id,
            type: permission.type,
            status: "revoked",
            note: "Revoked because the canonical project execution profile has Codex turned off.",
          },
        });
      }
    }
    state.pccEditorMode = null;
    await loadPccDashboard(state);
    if (creating) {
      state.pccProjectFilter = "all";
    }
    await selectPccProject(state, result.project.id);
    if (revisionResult && previousDetail) {
      setPccUndo(state, `Undo project plan change`, async () => {
        const client = state.client;
        if (!client) {
          return;
        }
        await loadPccDashboard(state);
        await selectPccProject(state, previousDetail.project.id);
        const currentDetail = state.pccProjectDetail;
        if (!currentDetail) {
          throw new Error(`Project ${previousDetail.project.id} could not be reloaded for undo.`);
        }
        const currentMilestones = new Map(
          currentDetail.milestones.map((milestone) => [milestone.id, milestone]),
        );
        const currentSubMilestones = new Map(
          (currentDetail.subMilestones ?? []).map((subMilestone) => [
            subMilestone.id,
            subMilestone,
          ]),
        );
        const expectedProjectRevision = pccRecordRevision(result.project);
        if (pccRecordRevision(currentDetail.project) !== expectedProjectRevision) {
          throw new Error(
            `Project ${previousDetail.project.id} changed after the plan revision. Review the latest project before undoing it.`,
          );
        }
        for (const write of revisionResult.milestoneWrites) {
          const current = currentMilestones.get(write.after.id);
          if (!current) {
            throw new Error(`Milestone ${write.after.id} could not be reloaded for undo.`);
          }
          if (pccRecordRevision(current) !== pccRecordRevision(write.after)) {
            throw new Error(
              `Milestone ${write.after.id} changed after the plan revision. Review the latest milestone before undoing it.`,
            );
          }
        }
        for (const write of revisionResult.subMilestoneWrites) {
          const current = currentSubMilestones.get(write.after.id);
          if (!current) {
            throw new Error(`Sub-milestone ${write.after.id} could not be reloaded for undo.`);
          }
          if (pccRecordRevision(current) !== pccRecordRevision(write.after)) {
            throw new Error(
              `Sub-milestone ${write.after.id} changed after the plan revision. Review the latest sub-milestone before undoing it.`,
            );
          }
        }
        await client.request("pcc.projects.upsert", {
          project: projectUpsertPayload({
            ...previousDetail.project,
            revision: expectedProjectRevision,
          }),
        });
        for (const write of revisionResult.milestoneWrites) {
          const revision = pccRecordRevision(write.after);
          await client.request("pcc.milestones.upsert", {
            milestone: milestoneUpsertPayload(
              write.before
                ? { ...write.before, replaceExisting: true, revision }
                : {
                    ...write.after,
                    revision,
                    status: "skipped",
                    blocker: "Rolled back by the user after a project plan revision.",
                    metadata: {
                      ...pccMetadataObject(write.after.metadata),
                      pccPlanRevisionRolledBackAt: new Date().toISOString(),
                    },
                  },
            ),
          });
        }
        for (const write of revisionResult.subMilestoneWrites) {
          const revision = pccRecordRevision(write.after);
          await client.request("pcc.subMilestones.upsert", {
            subMilestone: subMilestoneUpsertPayload(
              write.before
                ? { ...write.before, replaceExisting: true, revision }
                : {
                    ...write.after,
                    revision,
                    status: "skipped",
                    blocker: "Rolled back by the user after a project plan revision.",
                    metadata: {
                      ...pccMetadataObject(write.after.metadata),
                      pccPlanRevisionRolledBackAt: new Date().toISOString(),
                    },
                  },
            ),
          });
        }
        await loadPccDashboard(state);
        await selectPccProject(state, previousDetail.project.id);
      });
      setActionNotice(
        state,
        `Project change applied. ${form.planRevision?.summary ?? "The revised plan is ready."}`,
        "Undo",
      );
    }
    if (creating) {
      const firstMilestone = draft?.milestones[0]?.title;
      setActionNotice(
        state,
        firstMilestone
          ? `Project created. Start with “${firstMilestone}”. Nothing runs until you choose Work This Project.`
          : "Project created. Review the project, then choose the next safe action when you are ready.",
      );
    }
  });
}

export async function setPccProjectStatus(
  state: PccDashboardState,
  project: PccProject,
  status: PccStatus,
): Promise<void> {
  state.pccProjectForm = {
    ...projectFormFromProject(
      project,
      state.pccProjectDetail?.project.id === project.id ? state.pccProjectDetail.permissions : [],
    ),
    status,
  };
  await savePccProject(state);
}

export async function savePccMilestone(state: PccDashboardState): Promise<void> {
  const form = state.pccMilestoneForm;
  await withPccAction(state, async () => {
    if (!state.client || !form.projectId) {
      return;
    }
    const order = parseOptionalInteger(form.order);
    const percentComplete = parseOptionalPercent(form.percentComplete);
    const existingMilestone = form.id
      ? state.pccProjectDetail?.milestones.find((milestone) => milestone.id === form.id)
      : undefined;
    await state.client.request("pcc.milestones.upsert", {
      ...(existingMilestone?.revision ? { expectedRevision: existingMilestone.revision } : {}),
      milestone: milestoneUpsertPayload({
        ...(form.id ? { id: form.id } : {}),
        projectId: form.projectId,
        title: form.title.trim(),
        status: form.status,
        ...(form.phaseId.trim() ? { phaseId: form.phaseId.trim() } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(percentComplete !== undefined ? { percentComplete } : {}),
        ...(form.blocker.trim() ? { blocker: form.blocker.trim() } : { blocker: "" }),
        ...(form.implementationPlan.trim()
          ? { implementationPlan: form.implementationPlan.trim() }
          : { implementationPlan: "" }),
        ...(parseAcceptanceCriteria(form.acceptanceCriteria)
          ? { acceptanceCriteria: parseAcceptanceCriteria(form.acceptanceCriteria) }
          : {}),
        metadata: {
          ...pccMetadataObject(
            form.id
              ? state.pccProjectDetail?.milestones.find((milestone) => milestone.id === form.id)
                  ?.metadata
              : undefined,
          ),
          pccResponsibility: form.responsibility,
          pccCostRisk: form.costRisk,
          pccStopHere: form.stopHere,
        },
      }),
    });
    state.pccEditorMode = null;
    await loadPccDashboard(state);
    await selectPccProject(state, form.projectId);
  });
}

export async function addPccCompletionReceipt(
  state: PccDashboardState,
  milestone: PccMilestone,
): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  const passedEvidence = detail.evidence.filter(
    (evidence) => evidence.milestoneId === milestone.id && evidence.status === "passed",
  );
  if (passedEvidence.length === 0) {
    state.pccActionError = "Passed evidence is required before adding a completion receipt.";
    state.requestUpdate?.();
    return;
  }
  const capabilityEvidence = evaluatePccCapabilityEvidence({
    project: detail.project,
    milestone,
    evidence: passedEvidence,
  });
  if (!capabilityEvidence.passing) {
    state.pccActionError = `Completion proof is incomplete: ${capabilityEvidence.gaps[0]}`;
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const summary = [
      `${milestone.title} completed with ${passedEvidence.length} passed proof item${passedEvidence.length === 1 ? "" : "s"}.`,
      milestone.acceptanceCriteria?.length
        ? `Acceptance criteria: ${milestone.acceptanceCriteria.join("; ")}`
        : "Acceptance criteria were not recorded.",
    ].join(" ");
    const result = await state.client.request<PccReceiptsAddResult>("pcc.receipts.add", {
      receipt: {
        projectId: milestone.projectId,
        milestoneId: milestone.id,
        summary,
        proofEvidenceIds: passedEvidence.map((evidence) => evidence.id),
        proofLevel: passedEvidence.some((evidence) => evidence.kind === "remote_ci")
          ? "remote"
          : "local",
        doNotRedo: [
          "Do not redo this milestone unless a new regression or scope change is recorded.",
        ],
        followUpGaps: detail.summary.proofGaps,
        completedBy: "Project Command Center",
      },
    });
    await loadPccDashboard(state);
    await selectPccProject(state, result.receipt.projectId);
  });
}

export async function setPccMilestoneStopHere(
  state: PccDashboardState,
  milestone: PccMilestone,
  stopHere: boolean,
): Promise<void> {
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    await state.client.request("pcc.milestones.upsert", {
      milestone: milestoneUpsertPayload({
        ...milestone,
        metadata: {
          ...pccMetadataObject(milestone.metadata),
          pccStopHere: stopHere,
        },
      }),
    });
    await loadPccDashboard(state);
    await selectPccProject(state, milestone.projectId);
  });
}

function itemWithStatusMetadata<T extends PccMilestone | PccSubMilestone>(
  item: T,
  status: PccStatus,
  note?: string,
): T {
  return {
    ...item,
    status,
    ...(status === "skipped" || status === "archived" ? { percentComplete: 0 } : {}),
    ...(status === "not_started" || status === "reopened" ? { percentComplete: 0 } : {}),
    metadata: {
      ...pccMetadataObject(item.metadata),
      ...(status === "skipped"
        ? {
            pccSkipNote: note?.trim() || "Skipped in Project Command Center.",
            pccSkippedAt: new Date().toISOString(),
          }
        : {}),
      ...(status === "archived"
        ? {
            pccRemoveNote: note?.trim() || "Removed from the active PCC plan.",
            pccRemovedAt: new Date().toISOString(),
          }
        : {}),
      ...(status === "not_started" || status === "reopened"
        ? {
            pccSkipNote: "",
            pccRemoveNote: "",
            pccReopenedAt: new Date().toISOString(),
          }
        : {}),
    },
  };
}

type PccStatusWrite<T> = {
  before: T;
  after: T;
};

type PccOrderRecord = (PccMilestone | PccSubMilestone) & { replaceExisting?: boolean };

type PccOrderWrite<T extends PccOrderRecord> = {
  before: T;
  after: T;
};

async function rollbackPccOrderWrites<T extends PccOrderRecord>(params: {
  writes: ReadonlyMap<string, PccOrderWrite<T>>;
  label: string;
  upsert: (record: T) => Promise<T>;
}): Promise<string[]> {
  const errors: string[] = [];
  const current = new Map(
    [...params.writes.entries()].map(([id, write]) => [id, write.after] as const),
  );
  const stageAll = async (): Promise<void> => {
    const staged = new Map<string, T>();
    for (const [index, [id, record]] of [...current.entries()].entries()) {
      const result = await params.upsert({
        ...record,
        replaceExisting: true,
        order: temporaryReorderOrder(index),
        revision: pccRecordRevision(record),
      });
      staged.set(id, result);
    }
    for (const [id, record] of staged) {
      current.set(id, record);
    }
  };

  try {
    await stageAll();
  } catch (error) {
    errors.push(
      `stage ${params.label} rollback: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errors;
  }

  for (const [id, write] of params.writes) {
    try {
      const result = await params.upsert({
        ...write.before,
        replaceExisting: true,
        revision: pccRecordRevision(current.get(id) ?? write.after),
      });
      current.set(id, result);
    } catch (error) {
      errors.push(
        `restore ${params.label} ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return errors;
}

async function rollbackPccStatusWrites(params: {
  client: NonNullable<PccDashboardState["client"]>;
  projectId: string;
  milestoneWrite: PccStatusWrite<PccMilestone> | null;
  subMilestoneWrites: ReadonlyMap<string, PccStatusWrite<PccSubMilestone>>;
}): Promise<string[]> {
  if (!params.milestoneWrite && params.subMilestoneWrites.size === 0) {
    return [];
  }
  const errors: string[] = [];
  let current: PccProjectsGetResult;
  try {
    current = await params.client.request<PccProjectsGetResult>("pcc.projects.get", {
      projectId: params.projectId,
    });
  } catch (error) {
    return [
      `refresh current PCC records for rollback: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const currentMilestones = new Map(
    current.milestones.map((milestone) => [milestone.id, milestone]),
  );
  const currentSubMilestones = new Map(
    (current.subMilestones ?? []).map((subMilestone) => [subMilestone.id, subMilestone]),
  );
  const restore = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (const write of params.subMilestoneWrites.values()) {
    const currentSubMilestone = currentSubMilestones.get(write.after.id);
    if (!currentSubMilestone) {
      errors.push(`restore sub-milestone ${write.after.id}: current record unavailable`);
      continue;
    }
    if (pccRecordRevision(currentSubMilestone) !== pccRecordRevision(write.after)) {
      errors.push(
        `restore sub-milestone ${write.after.id}: current revision ${pccRecordRevision(currentSubMilestone)} no longer matches revision ${pccRecordRevision(write.after)} written by this action`,
      );
      continue;
    }
    await restore(`restore sub-milestone ${write.after.id}`, async () => {
      let revision = pccRecordRevision(write.after);
      const reopenRequired =
        (isPccSkippedStatus(currentSubMilestone.status) &&
          !isPccSkippedStatus(write.before.status)) ||
        (isPccCompleteStatus(currentSubMilestone.status) &&
          !isPccTerminalStatus(write.before.status));
      if (reopenRequired) {
        const reopened = await params.client.request<{ subMilestone: PccSubMilestone }>(
          "pcc.subMilestones.upsert",
          {
            subMilestone: subMilestoneUpsertPayload({
              ...currentSubMilestone,
              status: "not_started",
              revision,
            }),
          },
        );
        revision = pccRecordRevision(reopened.subMilestone);
      }
      await params.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload({
          ...write.before,
          replaceExisting: true,
          revision,
        }),
      });
    });
  }

  if (params.milestoneWrite) {
    const write = params.milestoneWrite;
    const currentMilestone = currentMilestones.get(write.after.id);
    if (!currentMilestone) {
      errors.push(`restore milestone ${write.after.id}: current record unavailable`);
    } else if (pccRecordRevision(currentMilestone) !== pccRecordRevision(write.after)) {
      errors.push(
        `restore milestone ${write.after.id}: current revision ${pccRecordRevision(currentMilestone)} no longer matches revision ${pccRecordRevision(write.after)} written by this action`,
      );
    } else {
      await restore(`restore milestone ${write.after.id}`, async () => {
        let revision = pccRecordRevision(write.after);
        const reopenRequired =
          (isPccSkippedStatus(currentMilestone.status) &&
            !isPccSkippedStatus(write.before.status)) ||
          (isPccCompleteStatus(currentMilestone.status) &&
            !isPccTerminalStatus(write.before.status));
        if (reopenRequired) {
          const reopened = await params.client.request<{ milestone: PccMilestone }>(
            "pcc.milestones.upsert",
            {
              milestone: milestoneUpsertPayload({
                ...currentMilestone,
                status: "not_started",
                revision,
              }),
            },
          );
          revision = pccRecordRevision(reopened.milestone);
        }
        await params.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload({
            ...write.before,
            replaceExisting: true,
            revision,
          }),
        });
      });
    }
  }
  return errors;
}

async function rethrowAfterPccRollback(
  state: PccDashboardState,
  projectId: string,
  originalError: unknown,
  label: string,
): Promise<never> {
  try {
    await loadPccDashboard(state);
    await selectPccProject(state, projectId);
  } catch (refreshError) {
    const recoveryError = new AggregateError(
      [originalError, refreshError],
      `${label} rolled back, but the current project could not be refreshed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
    );
    recoveryError.cause = originalError;
    throw recoveryError;
  }
  throw originalError;
}

export async function setPccMilestoneStatus(
  state: PccDashboardState,
  milestone: PccMilestone,
  status: PccStatus,
  note?: string,
): Promise<void> {
  const previousMilestone = milestone;
  const previousChildren = (state.pccProjectDetail?.subMilestones ?? []).filter(
    (subMilestone) => subMilestone.milestoneId === milestone.id,
  );
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const normalizedStatus: PccStatus = status === "reopened" ? "not_started" : status;
    const milestoneUpdate = itemWithStatusMetadata(milestone, normalizedStatus, note);
    let updatedMilestone: PccMilestone | null = null;
    const updatedChildren = new Map<string, PccSubMilestone>();
    try {
      const updated = await state.client.request<{ milestone: PccMilestone }>(
        "pcc.milestones.upsert",
        {
          milestone: milestoneUpsertPayload(milestoneUpdate),
        },
      );
      updatedMilestone = updated.milestone;
      if (
        state.pccProjectDetail &&
        (normalizedStatus === "skipped" ||
          normalizedStatus === "archived" ||
          normalizedStatus === "not_started")
      ) {
        const childStatus: PccStatus =
          normalizedStatus === "not_started" ? "not_started" : normalizedStatus;
        const childUpdates = (state.pccProjectDetail.subMilestones ?? []).filter(
          (subMilestone) =>
            subMilestone.milestoneId === milestone.id &&
            !["complete", "complete_with_maintenance"].includes(subMilestone.status),
        );
        for (const subMilestone of childUpdates) {
          const childResult = await state.client.request<{ subMilestone: PccSubMilestone }>(
            "pcc.subMilestones.upsert",
            {
              subMilestone: subMilestoneUpsertPayload(
                itemWithStatusMetadata(subMilestone, childStatus, note),
              ),
            },
          );
          updatedChildren.set(subMilestone.id, childResult.subMilestone);
        }
      }
    } catch (error) {
      const rollbackErrors = await rollbackPccStatusWrites({
        client: state.client,
        projectId: milestone.projectId,
        milestoneWrite: updatedMilestone
          ? { before: previousMilestone, after: updatedMilestone }
          : null,
        subMilestoneWrites: new Map(
          [...updatedChildren.entries()]
            .map(([id, after]) => {
              const before = previousChildren.find((item) => item.id === id);
              return before
                ? [id, { before, after } satisfies PccStatusWrite<PccSubMilestone>]
                : null;
            })
            .filter((entry): entry is [string, PccStatusWrite<PccSubMilestone>] => entry !== null),
        ),
      });
      if (rollbackErrors.length > 0) {
        throw new Error(
          `PCC status update partially applied; recovery is required for milestone ${milestone.id}. ${rollbackErrors.join(" ")}`,
          { cause: error },
        );
      }
      await rethrowAfterPccRollback(state, milestone.projectId, error, "PCC status update");
    }
    if (!updatedMilestone) {
      throw new Error(`Milestone ${milestone.id} did not return after the status update.`);
    }
    await loadPccDashboard(state);
    await selectPccProject(state, milestone.projectId);
    setPccUndo(state, `Restore ${milestone.title}`, async () => {
      const client = state.client;
      if (!client) {
        return;
      }
      await loadPccDashboard(state);
      await selectPccProject(state, milestone.projectId);
      const currentDetail = state.pccProjectDetail;
      const currentMilestone = currentDetail?.milestones.find((item) => item.id === milestone.id);
      if (!currentMilestone) {
        throw new Error(`Milestone ${milestone.id} could not be reloaded for undo.`);
      }
      if (pccRecordRevision(currentMilestone) !== pccRecordRevision(updatedMilestone)) {
        throw new Error(
          `Milestone ${milestone.id} changed after this status update. Review the latest milestone before undoing it.`,
        );
      }
      const currentSubMilestones = new Map(
        (currentDetail?.subMilestones ?? []).map((item) => [item.id, item]),
      );
      for (const [id, updatedSubMilestone] of updatedChildren) {
        const currentSubMilestone = currentSubMilestones.get(id);
        if (!currentSubMilestone) {
          throw new Error(`Sub-milestone ${id} could not be reloaded for undo.`);
        }
        if (pccRecordRevision(currentSubMilestone) !== pccRecordRevision(updatedSubMilestone)) {
          throw new Error(
            `Sub-milestone ${id} changed after this status update. Review the latest sub-milestone before undoing it.`,
          );
        }
      }
      const rollbackErrors = await rollbackPccStatusWrites({
        client,
        projectId: milestone.projectId,
        milestoneWrite: {
          before: previousMilestone,
          after: updatedMilestone,
        },
        subMilestoneWrites: new Map(
          [...updatedChildren.entries()]
            .map(([id, after]) => {
              const before = previousChildren.find((item) => item.id === id);
              return before
                ? [id, { before, after } satisfies PccStatusWrite<PccSubMilestone>]
                : null;
            })
            .filter((entry): entry is [string, PccStatusWrite<PccSubMilestone>] => entry !== null),
        ),
      });
      if (rollbackErrors.length > 0) {
        throw new Error(
          `PCC status undo partially applied; recovery is required for milestone ${milestone.id}. ${rollbackErrors.join(" ")}`,
        );
      }
      await loadPccDashboard(state);
      await selectPccProject(state, milestone.projectId);
    });
    setActionNotice(
      state,
      `Saved: ${milestone.title} is now ${status.replace(/_/gu, " ")}.`,
      "Undo",
    );
  });
}

export async function setPccSubMilestoneStatus(
  state: PccDashboardState,
  subMilestone: PccSubMilestone,
  status: PccStatus,
  note?: string,
): Promise<void> {
  const previousSubMilestone = subMilestone;
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const normalizedStatus: PccStatus = status === "reopened" ? "not_started" : status;
    const updatedSubMilestone = await state.client.request<{
      subMilestone: PccSubMilestone;
    }>("pcc.subMilestones.upsert", {
      subMilestone: subMilestoneUpsertPayload(
        itemWithStatusMetadata(subMilestone, normalizedStatus, note),
      ),
    });
    await loadPccDashboard(state);
    await selectPccProject(state, subMilestone.projectId);
    setPccUndo(state, `Restore ${subMilestone.title}`, async () => {
      const client = state.client;
      if (!client) {
        return;
      }
      await loadPccDashboard(state);
      await selectPccProject(state, subMilestone.projectId);
      const currentDetail = state.pccProjectDetail;
      const currentSubMilestone = currentDetail?.subMilestones?.find(
        (item) => item.id === subMilestone.id,
      );
      if (!currentSubMilestone) {
        throw new Error(`Sub-milestone ${subMilestone.id} could not be reloaded for undo.`);
      }
      if (
        pccRecordRevision(currentSubMilestone) !==
        pccRecordRevision(updatedSubMilestone.subMilestone)
      ) {
        throw new Error(
          `Sub-milestone ${subMilestone.id} changed after this status update. Review the latest sub-milestone before undoing it.`,
        );
      }
      const rollbackErrors = await rollbackPccStatusWrites({
        client,
        projectId: subMilestone.projectId,
        milestoneWrite: null,
        subMilestoneWrites: new Map([
          [
            subMilestone.id,
            {
              before: previousSubMilestone,
              after: updatedSubMilestone.subMilestone,
            } satisfies PccStatusWrite<PccSubMilestone>,
          ],
        ]),
      });
      if (rollbackErrors.length > 0) {
        throw new Error(
          `PCC status undo partially applied; recovery is required for sub-milestone ${subMilestone.id}. ${rollbackErrors.join(" ")}`,
        );
      }
      await loadPccDashboard(state);
      await selectPccProject(state, subMilestone.projectId);
    });
    setActionNotice(
      state,
      `Saved: ${subMilestone.title} is now ${status.replace(/_/gu, " ")}.`,
      "Undo",
    );
  });
}

function orderedMilestoneSequenceItems(detail: PccProjectDetail): PccMilestone[] {
  return detail.milestones.toSorted(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

function orderedSubMilestoneSequenceItems(
  detail: PccProjectDetail,
  milestoneId: string,
): PccSubMilestone[] {
  return (detail.subMilestones ?? [])
    .filter((item) => item.milestoneId === milestoneId)
    .toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

function dependencyMoveBlocker(
  orderedItems: ReadonlyArray<{ id: string; title: string; dependsOn?: string[] }>,
  sourceId: string,
  targetId: string,
): string | null {
  const orderedIds = orderedItems.map((item) => item.id);
  const nextIds = orderedIds.filter((id) => id !== sourceId);
  const targetIndex = nextIds.indexOf(targetId);
  if (targetIndex < 0) {
    return "Target item was not found.";
  }
  nextIds.splice(targetIndex, 0, sourceId);
  const itemById = new Map(orderedItems.map((item) => [item.id, item]));
  for (const item of orderedItems) {
    const itemIndex = nextIds.indexOf(item.id);
    for (const dependencyId of item.dependsOn ?? []) {
      const dependencyIndex = nextIds.indexOf(dependencyId);
      if (dependencyIndex >= 0 && itemIndex >= 0 && dependencyIndex > itemIndex) {
        const dependency = itemById.get(dependencyId);
        return `Cannot move “${item.title}” before its dependency “${dependency?.title ?? dependencyId}”. Keep the dependency earlier in the project sequence.`;
      }
    }
  }
  return null;
}

export async function movePccMilestoneBefore(
  state: PccDashboardState,
  source: PccMilestone,
  target: PccMilestone,
): Promise<void> {
  if (source.id === target.id || source.projectId !== target.projectId) {
    return;
  }
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  const dependencyBlocker = dependencyMoveBlocker(
    orderedMilestoneSequenceItems(detail),
    source.id,
    target.id,
  );
  if (dependencyBlocker) {
    state.pccActionError = dependencyBlocker;
    state.requestUpdate?.();
    return;
  }
  const previousMilestones = detail.milestones;
  const previousMilestonesById = new Map(
    previousMilestones.map((milestone) => [milestone.id, milestone]),
  );
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const ordered = detail.milestones.filter((item) => item.id !== source.id);
    const targetIndex = ordered.findIndex((item) => item.id === target.id);
    if (targetIndex < 0) {
      throw new Error("Target milestone was not found.");
    }
    ordered.splice(targetIndex, 0, source);
    const changed = ordered
      .map((milestone, index) => ({ milestone, nextOrder: (index + 1) * 10 }))
      .filter(({ milestone, nextOrder }) => milestone.order !== nextOrder);
    const temporaryMilestones = new Map<string, PccMilestone>();
    const finalMilestones = new Map<string, PccMilestone>();
    const writtenMilestones = new Map<string, PccOrderWrite<PccMilestone>>();
    try {
      for (const [index, { milestone }] of changed.entries()) {
        const result = await state.client.request<{ milestone: PccMilestone }>(
          "pcc.milestones.upsert",
          {
            milestone: milestoneUpsertPayload({
              ...milestone,
              order: temporaryReorderOrder(index),
            }),
          },
        );
        temporaryMilestones.set(milestone.id, result.milestone);
        writtenMilestones.set(milestone.id, { before: milestone, after: result.milestone });
      }
      for (const { milestone, nextOrder } of changed) {
        const temporary = temporaryMilestones.get(milestone.id);
        if (!temporary) {
          throw new Error(`Milestone ${milestone.id} did not return after temporary reorder.`);
        }
        const result = await state.client.request<{ milestone: PccMilestone }>(
          "pcc.milestones.upsert",
          {
            milestone: milestoneUpsertPayload({ ...temporary, order: nextOrder }),
          },
        );
        finalMilestones.set(milestone.id, result.milestone);
        writtenMilestones.set(milestone.id, { before: milestone, after: result.milestone });
      }
    } catch (error) {
      const rollbackErrors = await rollbackPccOrderWrites({
        writes: writtenMilestones,
        label: "milestone order",
        upsert: async (record) => {
          const result = await state.client!.request<{ milestone: PccMilestone }>(
            "pcc.milestones.upsert",
            { milestone: milestoneUpsertPayload(record) },
          );
          return result.milestone;
        },
      });
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Milestone reorder partially applied; recovery is required for project ${source.projectId}. ${rollbackErrors.join(" ")}`,
          { cause: error },
        );
      }
      await rethrowAfterPccRollback(state, source.projectId, error, "Milestone reorder");
    }
    await loadPccDashboard(state);
    await selectPccProject(state, source.projectId);
    setPccUndo(state, `Restore milestone order`, async () => {
      if (!state.client) {
        return;
      }
      await loadPccDashboard(state);
      await selectPccProject(state, source.projectId);
      const currentDetail = state.pccProjectDetail;
      if (!currentDetail) {
        throw new Error(`Project ${source.projectId} could not be reloaded for undo.`);
      }
      const currentMilestones = new Map(
        currentDetail.milestones.map((milestone) => [milestone.id, milestone]),
      );
      for (const [id, after] of finalMilestones) {
        const current = currentMilestones.get(id);
        if (!current) {
          throw new Error(`Milestone ${id} could not be reloaded for undo.`);
        }
        if (pccRecordRevision(current) !== pccRecordRevision(after)) {
          throw new Error(
            `Milestone ${id} changed after the reorder. Review the latest milestone before undoing it.`,
          );
        }
      }
      const temporaryUndoMilestones = new Map<string, PccMilestone>();
      for (const [index, [id, after]] of [...finalMilestones.entries()].entries()) {
        const milestone = previousMilestonesById.get(id);
        if (!milestone) {
          throw new Error(`Milestone ${id} could not be restored for undo.`);
        }
        const result = await state.client.request<{ milestone: PccMilestone }>(
          "pcc.milestones.upsert",
          {
            milestone: milestoneUpsertPayload({
              ...milestone,
              revision: pccRecordRevision(after),
              order: temporaryReorderOrder(index),
            }),
          },
        );
        temporaryUndoMilestones.set(id, result.milestone);
      }
      for (const [id, temporary] of temporaryUndoMilestones) {
        const milestone = previousMilestonesById.get(id);
        if (!milestone) {
          throw new Error(`Milestone ${id} could not be restored for undo.`);
        }
        await state.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload({
            ...temporary,
            replaceExisting: true,
            order: milestone.order,
            revision: pccRecordRevision(temporary),
          }),
        });
      }
      await loadPccDashboard(state);
      await selectPccProject(state, source.projectId);
    });
    setActionNotice(state, `Saved new milestone order for ${source.title}.`, "Undo");
  });
}

export async function movePccSubMilestoneBefore(
  state: PccDashboardState,
  source: PccSubMilestone,
  target: PccSubMilestone,
): Promise<void> {
  if (
    source.id === target.id ||
    source.projectId !== target.projectId ||
    source.milestoneId !== target.milestoneId
  ) {
    return;
  }
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  const orderedSiblings = orderedSubMilestoneSequenceItems(detail, source.milestoneId);
  const dependencyBlocker = dependencyMoveBlocker(orderedSiblings, source.id, target.id);
  if (dependencyBlocker) {
    state.pccActionError = dependencyBlocker;
    state.requestUpdate?.();
    return;
  }
  const previousSubMilestones = (detail.subMilestones ?? []).filter(
    (item) => item.milestoneId === source.milestoneId,
  );
  const previousSubMilestonesById = new Map(
    previousSubMilestones.map((subMilestone) => [subMilestone.id, subMilestone]),
  );
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const nextSiblings = (detail.subMilestones ?? [])
      .filter((item) => item.milestoneId === source.milestoneId)
      .filter((item) => item.id !== source.id);
    const targetIndex = nextSiblings.findIndex((item) => item.id === target.id);
    if (targetIndex < 0) {
      throw new Error("Target sub-milestone was not found.");
    }
    nextSiblings.splice(targetIndex, 0, source);
    const changed = nextSiblings
      .map((subMilestone, index) => ({ subMilestone, nextOrder: (index + 1) * 10 }))
      .filter(({ subMilestone, nextOrder }) => subMilestone.order !== nextOrder);
    const temporarySubMilestones = new Map<string, PccSubMilestone>();
    const finalSubMilestones = new Map<string, PccSubMilestone>();
    const writtenSubMilestones = new Map<string, PccOrderWrite<PccSubMilestone>>();
    try {
      for (const [index, { subMilestone }] of changed.entries()) {
        const result = await state.client.request<{ subMilestone: PccSubMilestone }>(
          "pcc.subMilestones.upsert",
          {
            subMilestone: subMilestoneUpsertPayload({
              ...subMilestone,
              order: temporaryReorderOrder(index),
            }),
          },
        );
        temporarySubMilestones.set(subMilestone.id, result.subMilestone);
        writtenSubMilestones.set(subMilestone.id, {
          before: subMilestone,
          after: result.subMilestone,
        });
      }
      for (const { subMilestone, nextOrder } of changed) {
        const temporary = temporarySubMilestones.get(subMilestone.id);
        if (!temporary) {
          throw new Error(
            `Sub-milestone ${subMilestone.id} did not return after temporary reorder.`,
          );
        }
        const result = await state.client.request<{ subMilestone: PccSubMilestone }>(
          "pcc.subMilestones.upsert",
          {
            subMilestone: subMilestoneUpsertPayload({ ...temporary, order: nextOrder }),
          },
        );
        finalSubMilestones.set(subMilestone.id, result.subMilestone);
        writtenSubMilestones.set(subMilestone.id, {
          before: subMilestone,
          after: result.subMilestone,
        });
      }
    } catch (error) {
      const rollbackErrors = await rollbackPccOrderWrites({
        writes: writtenSubMilestones,
        label: "sub-milestone order",
        upsert: async (record) => {
          const result = await state.client!.request<{ subMilestone: PccSubMilestone }>(
            "pcc.subMilestones.upsert",
            { subMilestone: subMilestoneUpsertPayload(record) },
          );
          return result.subMilestone;
        },
      });
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Sub-milestone reorder partially applied; recovery is required for project ${source.projectId}. ${rollbackErrors.join(" ")}`,
          { cause: error },
        );
      }
      await rethrowAfterPccRollback(state, source.projectId, error, "Sub-milestone reorder");
    }
    await loadPccDashboard(state);
    await selectPccProject(state, source.projectId);
    setPccUndo(state, `Restore sub-step order`, async () => {
      if (!state.client) {
        return;
      }
      await loadPccDashboard(state);
      await selectPccProject(state, source.projectId);
      const currentDetail = state.pccProjectDetail;
      if (!currentDetail) {
        throw new Error(`Project ${source.projectId} could not be reloaded for undo.`);
      }
      const currentSubMilestones = new Map(
        (currentDetail.subMilestones ?? []).map((subMilestone) => [subMilestone.id, subMilestone]),
      );
      for (const [id, after] of finalSubMilestones) {
        const current = currentSubMilestones.get(id);
        if (!current) {
          throw new Error(`Sub-milestone ${id} could not be reloaded for undo.`);
        }
        if (pccRecordRevision(current) !== pccRecordRevision(after)) {
          throw new Error(
            `Sub-milestone ${id} changed after the reorder. Review the latest sub-milestone before undoing it.`,
          );
        }
      }
      const temporaryUndoSubMilestones = new Map<string, PccSubMilestone>();
      for (const [index, [id, after]] of [...finalSubMilestones.entries()].entries()) {
        const subMilestone = previousSubMilestonesById.get(id);
        if (!subMilestone) {
          throw new Error(`Sub-milestone ${id} could not be restored for undo.`);
        }
        const result = await state.client.request<{ subMilestone: PccSubMilestone }>(
          "pcc.subMilestones.upsert",
          {
            subMilestone: subMilestoneUpsertPayload({
              ...subMilestone,
              revision: pccRecordRevision(after),
              order: temporaryReorderOrder(index),
            }),
          },
        );
        temporaryUndoSubMilestones.set(id, result.subMilestone);
      }
      for (const [id, temporary] of temporaryUndoSubMilestones) {
        const subMilestone = previousSubMilestonesById.get(id);
        if (!subMilestone) {
          throw new Error(`Sub-milestone ${id} could not be restored for undo.`);
        }
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload({
            ...temporary,
            replaceExisting: true,
            order: subMilestone.order,
            revision: pccRecordRevision(temporary),
          }),
        });
      }
      await loadPccDashboard(state);
      await selectPccProject(state, source.projectId);
    });
    setActionNotice(state, `Saved new sub-step order for ${source.title}.`, "Undo");
  });
}

function validMilestoneDependencyIdsForDetail(detail: PccProjectDetail): Set<string> {
  return new Set(detail.milestones.map((milestone) => milestone.id));
}

function validSubMilestoneDependencyIdsForDetail(
  detail: PccProjectDetail,
  milestoneId: string,
): Set<string> {
  return new Set([
    ...detail.milestones.map((milestone) => milestone.id),
    ...(detail.subMilestones ?? [])
      .filter((subMilestone) => subMilestone.milestoneId === milestoneId)
      .map((subMilestone) => subMilestone.id),
  ]);
}

function staleDependencyFilteredItem<T extends { dependsOn?: string[] }>(
  item: T,
  validIds: ReadonlySet<string>,
  selfId: string,
): T | null {
  if (!item.dependsOn?.length) {
    return null;
  }
  const nextDependsOn = item.dependsOn.filter((id) => id !== selfId && validIds.has(id));
  return nextDependsOn.length === item.dependsOn.length
    ? null
    : { ...item, dependsOn: nextDependsOn };
}

function normalizedRepairTitle(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function uniqueRepairTitle(value: string, used: Set<string>): string {
  const base = value.trim().replace(/\s+/gu, " ") || "Untitled";
  let candidate = base;
  let suffix = 2;
  while (used.has(normalizedRepairTitle(candidate))) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(normalizedRepairTitle(candidate));
  return candidate;
}

function duplicateTitleRepairs<T extends { title: string }>(items: readonly T[]): T[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = normalizedRepairTitle(item.title);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const used = new Set(
    items
      .map((item) => normalizedRepairTitle(item.title))
      .filter((key) => key && counts.get(key) === 1),
  );
  const seenDuplicateTitles = new Set<string>();
  return items.flatMap((item) => {
    const key = normalizedRepairTitle(item.title);
    if ((counts.get(key) ?? 0) <= 1) {
      return [];
    }
    if (!seenDuplicateTitles.has(key)) {
      seenDuplicateTitles.add(key);
      used.add(key);
      return [];
    }
    const nextTitle = uniqueRepairTitle(item.title, used);
    return nextTitle === item.title ? [] : [{ ...item, title: nextTitle }];
  });
}

export async function normalizePccProjectSequence(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before repairing the milestone sequence.";
    return;
  }
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const milestones = orderedMilestoneSequenceItems(detail);
      const milestoneUpdates = milestones
        .map((milestone, index) => ({ milestone, nextOrder: (index + 1) * 10 }))
        .filter(({ milestone, nextOrder }) => milestone.order !== nextOrder);
      const temporaryMilestones = new Map<string, PccMilestone>();
      const writtenMilestones = new Map<string, PccOrderWrite<PccMilestone>>();
      try {
        for (const [index, { milestone }] of milestoneUpdates.entries()) {
          const result = await state.client.request<{ milestone: PccMilestone }>(
            "pcc.milestones.upsert",
            {
              milestone: milestoneUpsertPayload({
                ...milestone,
                order: temporaryReorderOrder(index),
              }),
            },
          );
          temporaryMilestones.set(milestone.id, result.milestone);
          writtenMilestones.set(milestone.id, { before: milestone, after: result.milestone });
        }
        for (const { milestone, nextOrder } of milestoneUpdates) {
          const temporary = temporaryMilestones.get(milestone.id);
          if (!temporary) {
            throw new Error(`Milestone ${milestone.id} did not return after temporary reorder.`);
          }
          const result = await state.client.request<{ milestone: PccMilestone }>(
            "pcc.milestones.upsert",
            {
              milestone: milestoneUpsertPayload({ ...temporary, order: nextOrder }),
            },
          );
          writtenMilestones.set(milestone.id, { before: milestone, after: result.milestone });
        }
      } catch (error) {
        const rollbackErrors = await rollbackPccOrderWrites({
          writes: writtenMilestones,
          label: "milestone order",
          upsert: async (record) => {
            const result = await state.client!.request<{ milestone: PccMilestone }>(
              "pcc.milestones.upsert",
              { milestone: milestoneUpsertPayload(record) },
            );
            return result.milestone;
          },
        });
        if (rollbackErrors.length > 0) {
          throw new Error(
            `Milestone sequence repair partially applied; recovery is required for project ${detail.project.id}. ${rollbackErrors.join(" ")}`,
            { cause: error },
          );
        }
        await rethrowAfterPccRollback(state, detail.project.id, error, "Milestone sequence repair");
      }

      const subMilestoneUpdates: Array<{ subMilestone: PccSubMilestone; nextOrder: number }> = [];
      for (const milestone of milestones) {
        const children = orderedSubMilestoneSequenceItems(detail, milestone.id);
        subMilestoneUpdates.push(
          ...children
            .map((subMilestone, index) => ({ subMilestone, nextOrder: (index + 1) * 10 }))
            .filter(({ subMilestone, nextOrder }) => subMilestone.order !== nextOrder),
        );
      }
      const temporarySubMilestones = new Map<string, PccSubMilestone>();
      const writtenSubMilestones = new Map<string, PccOrderWrite<PccSubMilestone>>();
      try {
        for (const [index, { subMilestone }] of subMilestoneUpdates.entries()) {
          const result = await state.client.request<{ subMilestone: PccSubMilestone }>(
            "pcc.subMilestones.upsert",
            {
              subMilestone: subMilestoneUpsertPayload({
                ...subMilestone,
                order: temporaryReorderOrder(index),
              }),
            },
          );
          temporarySubMilestones.set(subMilestone.id, result.subMilestone);
          writtenSubMilestones.set(subMilestone.id, {
            before: subMilestone,
            after: result.subMilestone,
          });
        }
        for (const { subMilestone, nextOrder } of subMilestoneUpdates) {
          const temporary = temporarySubMilestones.get(subMilestone.id);
          if (!temporary) {
            throw new Error(
              `Sub-milestone ${subMilestone.id} did not return after temporary reorder.`,
            );
          }
          const result = await state.client.request<{ subMilestone: PccSubMilestone }>(
            "pcc.subMilestones.upsert",
            {
              subMilestone: subMilestoneUpsertPayload({ ...temporary, order: nextOrder }),
            },
          );
          writtenSubMilestones.set(subMilestone.id, {
            before: subMilestone,
            after: result.subMilestone,
          });
        }
      } catch (error) {
        const milestoneRollbackErrors = await rollbackPccOrderWrites({
          writes: writtenMilestones,
          label: "milestone order",
          upsert: async (record) => {
            const result = await state.client!.request<{ milestone: PccMilestone }>(
              "pcc.milestones.upsert",
              { milestone: milestoneUpsertPayload(record) },
            );
            return result.milestone;
          },
        });
        const subMilestoneRollbackErrors = await rollbackPccOrderWrites({
          writes: writtenSubMilestones,
          label: "sub-milestone order",
          upsert: async (record) => {
            const result = await state.client!.request<{ subMilestone: PccSubMilestone }>(
              "pcc.subMilestones.upsert",
              { subMilestone: subMilestoneUpsertPayload(record) },
            );
            return result.subMilestone;
          },
        });
        const rollbackErrors = [...milestoneRollbackErrors, ...subMilestoneRollbackErrors];
        if (rollbackErrors.length > 0) {
          throw new Error(
            `PCC sequence repair partially applied; recovery is required for project ${detail.project.id}. ${rollbackErrors.join(" ")}`,
            { cause: error },
          );
        }
        await rethrowAfterPccRollback(state, detail.project.id, error, "PCC sequence repair");
      }

      await loadPccDashboard(state);
      await selectPccProject(state, detail.project.id);
    },
    "Saved a clean milestone and sub-step sequence.",
  );
}

export async function repairPccDuplicateTitles(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before repairing duplicate titles.";
    return;
  }
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const milestoneUpdates = duplicateTitleRepairs(orderedMilestoneSequenceItems(detail));

      const subMilestoneUpdates: PccSubMilestone[] = [];
      for (const milestone of orderedMilestoneSequenceItems(detail)) {
        subMilestoneUpdates.push(
          ...duplicateTitleRepairs(orderedSubMilestoneSequenceItems(detail, milestone.id)),
        );
      }

      for (const milestone of milestoneUpdates) {
        await state.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload(milestone),
        });
      }
      for (const subMilestone of subMilestoneUpdates) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload(subMilestone),
        });
      }
      await loadPccDashboard(state);
      await selectPccProject(state, detail.project.id);
    },
    "Made duplicate milestone and sub-step titles unique.",
  );
}

export async function removePccStaleDependencies(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before repairing stale dependencies.";
    return;
  }
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const milestoneDependencyIds = validMilestoneDependencyIdsForDetail(detail);
      const milestoneUpdates = detail.milestones
        .map((milestone) =>
          staleDependencyFilteredItem(milestone, milestoneDependencyIds, milestone.id),
        )
        .filter((milestone): milestone is PccMilestone => milestone !== null);
      const subMilestoneUpdates = (detail.subMilestones ?? [])
        .map((subMilestone) =>
          staleDependencyFilteredItem(
            subMilestone,
            validSubMilestoneDependencyIdsForDetail(detail, subMilestone.milestoneId),
            subMilestone.id,
          ),
        )
        .filter((subMilestone): subMilestone is PccSubMilestone => subMilestone !== null);

      for (const milestone of milestoneUpdates) {
        await state.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload(milestone),
        });
      }
      for (const subMilestone of subMilestoneUpdates) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload(subMilestone),
        });
      }

      await loadPccDashboard(state);
      await selectPccProject(state, detail.project.id);
    },
    "Removed stale dependency links from this project.",
  );
}

export async function setPccPermissionStatus(
  state: PccDashboardState,
  permission: PccPermissionGrant,
  status: PccPermissionStatus,
): Promise<void> {
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const result = await state.client.request<PccPermissionsUpsertResult>(
      "pcc.permissions.upsert",
      {
        ...(permission.revision ? { expectedRevision: permission.revision } : {}),
        permission: {
          id: permission.id,
          revision: permission.revision ?? 1,
          projectId: permission.projectId,
          ...(permission.milestoneId ? { milestoneId: permission.milestoneId } : {}),
          type: permission.type,
          status,
          ...(status === "granted" ? { grantedBy: "user" } : {}),
          note:
            status === "granted"
              ? "Granted in Project Command Center."
              : status === "denied"
                ? "Denied in Project Command Center."
                : "Deferred in Project Command Center.",
        },
      },
    );
    await loadPccDashboard(state);
    await selectPccProject(state, result.permission.projectId);
  });
}

export async function applyPccChatSyncProposal(
  state: PccDashboardState,
  proposal: PccChatSyncProposal,
): Promise<void> {
  if (proposal.kind === "add_receipt") {
    const milestone = state.pccProjectDetail?.milestones.find(
      (candidate) => candidate.id === proposal.milestoneId,
    );
    if (!milestone) {
      state.pccChatSyncError = "Milestone for receipt proposal was not found.";
      state.requestUpdate?.();
      return;
    }
    await addPccCompletionReceipt(state, milestone);
    refreshPccChatSyncProposals(state);
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client || !state.pccProjectDetail) {
      return;
    }
    if (proposal.kind === "add_milestone" || proposal.kind === "update_milestone") {
      if (!proposal.milestonePatch) {
        throw new Error("Missing milestone patch");
      }
      const existing = proposal.milestoneId
        ? state.pccProjectDetail.milestones.find(
            (milestone) => milestone.id === proposal.milestoneId,
          )
        : null;
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload({
          ...existing,
          ...proposal.milestonePatch,
          metadata: {
            ...pccMetadataObject(existing?.metadata),
            ...pccMetadataObject(proposal.milestonePatch.metadata),
          },
        }),
      });
    } else if (proposal.kind === "request_permission") {
      if (!proposal.permission) {
        throw new Error("Missing permission proposal");
      }
      await state.client.request("pcc.permissions.upsert", {
        permission: proposal.permission.id
          ? { ...proposal.permission, revision: proposal.permission.revision ?? 1 }
          : proposal.permission,
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, state.pccProjectDetail.project.id);
    state.pccChatSyncProposals = state.pccChatSyncProposals.filter(
      (candidate) => candidate.id !== proposal.id,
    );
  });
}

const PCC_TEMP_REORDER_ORDER_BASE = 1_000_000_000;
const PCC_LEGACY_ORDER_REPAIR_BASE = 2_000_000_000;

function autopilotInputForDetail(detail: PccProjectDetail) {
  return {
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    evidence: detail.evidence,
    decisions: detail.decisions ?? [],
  };
}

async function savePccAutopilotStateForDetail(
  state: PccDashboardState,
  detail: PccProjectDetail,
  autopilot: ReturnType<typeof getPccAutopilotState>,
): Promise<void> {
  if (!state.client) {
    return;
  }
  const project = withPccAutopilotState(
    { ...detail.project, updatedAt: new Date().toISOString() },
    autopilot,
  );
  await state.client.request("pcc.projects.upsert", {
    project: projectUpsertPayload(project),
  });
  await loadPccDashboard(state);
  await selectPccProject(state, detail.project.id);
}

export async function configurePccAutopilotLoopMode(
  state: PccDashboardState,
  mode: PccAutopilotModeId,
): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before configuring Autopilot.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    const now = new Date().toISOString();
    const input = autopilotInputForDetail(detail);
    const current = getPccAutopilotState(input, now);
    const next = queuePccAutopilotPermissionRequest(
      input,
      configurePccAutopilotMode(input, current, mode, now),
      now,
    );
    await savePccAutopilotStateForDetail(state, detail, next);
    setActionNotice(
      state,
      `Autopilot mode set to ${next.modeTitle}. Review prompts before starting.`,
    );
  });
}

export async function generatePccAutopilotLoopPrompts(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before generating Autopilot prompts.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const now = new Date().toISOString();
    const input = autopilotInputForDetail(detail);
    const current = getPccAutopilotState(input, now);
    const generated = await state.client.request<{ plan: PccPlanGenerationResult }>(
      "pcc.plans.generate",
      {
        surface: "autopilot_prompts",
        description: detailText(detail),
        existingTitle: detail.project.title,
        ...(detail.project.goal?.trim() ? { existingGoal: detail.project.goal.trim() } : {}),
        desiredOutcome: `Create a planning-only ${current.modeTitle} loop. Local OpenClaw agents should execute routine work; Codex must not execute implementation.`,
        constraints: [
          "Generate no more than five ordered prompts.",
          "Every prompt must have an observable acceptance check and stop before missing permissions.",
        ],
      },
    );
    const defaults = generatePccAutopilotPromptSlots(input, current.mode);
    const promptSlots = generated.plan.milestones.slice(0, 5).map((milestone, index) => ({
      id: `slot-${index + 1}-codex-plan`,
      enabled: index < 3,
      title: milestone.title,
      promptBody: [
        `Project: ${detail.project.title}`,
        `Goal: ${detail.project.goal || generated.plan.goal}`,
        `Mode: ${current.modeTitle}`,
        milestone.implementationPlan,
        `Acceptance criteria:\n- ${milestone.acceptanceCriteria.join("\n- ")}`,
        "Stop before missing permission, external write, deployment, credentials, destructive action, purchase, publication, reboot, or unapproved Codex execution.",
      ].join("\n"),
      purpose: `Execute the Codex-planned ${milestone.title} step with local OpenClaw agents.`,
      executor: "local_model" as const,
      reasoningLevel: defaults[index]?.reasoningLevel ?? ("standard" as const),
      approvalTier: defaults[index]?.approvalTier ?? ("medium" as const),
      judge: defaults[index]?.judge ?? ("mandatory" as const),
      version: 1,
    }));
    const next = queuePccAutopilotPermissionRequest(
      input,
      {
        ...current,
        status: "ready" as const,
        promptSlots,
        lastOutputSummary: `Planning provenance: ${generated.plan.provenance.model} · ${generated.plan.provenance.effort} · ${
          generated.plan.provenance.auth === "oauth" ? "OAuth" : "isolated proof"
        } · planning only.`,
        auditLog: [
          ...current.auditLog,
          {
            at: now,
            event: "prompts_generated",
            summary: `Generated editable planning-only Autopilot prompts with ${generated.plan.provenance.model} at ${generated.plan.provenance.effort} effort. Local OpenClaw agents remain the executors.`,
          },
        ].slice(-200),
        updatedAt: now,
      },
      now,
    );
    await savePccAutopilotStateForDetail(state, detail, next);
    setActionNotice(
      state,
      `Autopilot prompts planned by ${generated.plan.provenance.model}. Local OpenClaw agents execute them after approval.`,
    );
  });
}

export async function updatePccAutopilotLoopPrompt(
  state: PccDashboardState,
  slotId: string,
  patch: Partial<PccAutopilotPromptSlot>,
): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  await withPccAction(state, async () => {
    const now = new Date().toISOString();
    const input = autopilotInputForDetail(detail);
    const current = getPccAutopilotState(input, now);
    const next = updatePccAutopilotPromptSlot(current, slotId, patch, now);
    await savePccAutopilotStateForDetail(state, detail, next);
    setActionNotice(state, "Autopilot prompt saved.");
  });
}

export async function runPccAutopilotLoopAction(
  state: PccDashboardState,
  action: PccAutopilotAction,
): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Select a project before using Autopilot.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    const now = new Date().toISOString();
    const input = autopilotInputForDetail(detail);
    const current = getPccAutopilotState(input, now);
    const permissionActions = [
      "allow_low_risk",
      "allow_medium_risk",
      "allow_high_risk",
      "deny_permission",
    ] as const;
    const isPermissionAction = (
      candidate: PccAutopilotAction,
    ): candidate is
      | "allow_low_risk"
      | "allow_medium_risk"
      | "allow_high_risk"
      | "deny_permission" =>
      permissionActions.includes(candidate as (typeof permissionActions)[number]);
    const latestActiveGrant = current.permissionGrants
      .filter((grant) => grant.status === "active")
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const next =
      action === "start"
        ? runPccAutopilotSafeStubSet(input, { ...current, status: "running", updatedAt: now }, now)
        : action === "judge"
          ? { ...current, finalReport: current.finalReport, updatedAt: now }
          : action === "revoke_permission_grant" && latestActiveGrant
            ? queuePccAutopilotPermissionRequest(
                input,
                revokePccAutopilotPermissionGrant(current, latestActiveGrant.id, now),
                now,
              )
            : action === "revoke_permission_grant"
              ? { ...current, updatedAt: now }
              : action === "expire_permission_grant" && latestActiveGrant
                ? queuePccAutopilotPermissionRequest(
                    input,
                    expirePccAutopilotPermissionGrant(current, latestActiveGrant.id, now),
                    now,
                  )
                : action === "expire_permission_grant"
                  ? { ...current, updatedAt: now }
                  : action === "apply_permission_repair"
                    ? applyPccAutopilotPermissionRepair(current, now)
                    : isPermissionAction(action)
                      ? applyPccAutopilotPermissionAction(current, action, now, detail.project.id)
                      : transitionPccAutopilotState(current, action, now);
    await savePccAutopilotStateForDetail(state, detail, next);
    setActionNotice(
      state,
      action === "start"
        ? next.status === "needs_approval"
          ? "Autopilot is waiting for permission before it starts. Review the permission request."
          : "Autopilot safe loop ran and saved history. Live execution remains blocked until separately approved."
        : action.startsWith("allow_")
          ? "Autopilot permission saved. You can start the loop inside that scope."
          : action === "deny_permission"
            ? "Autopilot permission request denied. The loop is blocked until you edit prompts or approve later."
            : action === "revoke_permission_grant"
              ? latestActiveGrant
                ? "Autopilot permission grant revoked. Elevated loop work will request approval again."
                : "No active Autopilot permission grant to revoke."
              : action === "expire_permission_grant"
                ? latestActiveGrant
                  ? "Autopilot permission grant expired. Elevated loop work will request approval again."
                  : "No active Autopilot permission grant to expire."
                : action === "apply_permission_repair"
                  ? "Autopilot repair applied. Prompts were lowered to safe read-only review."
                  : `Autopilot ${action} saved.`,
    );
  });
}

export async function runPccExecutionTeamAction(
  state: PccDashboardState,
  action: PccExecutionTeamAction,
): Promise<void> {
  const initialDetail = state.pccProjectDetail;
  if (!initialDetail) {
    state.pccActionError = "Open a project before using an agent team.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const detail =
      state.pccProjectDetail?.project.id === initialDetail.project.id
        ? state.pccProjectDetail
        : initialDetail;
    const projectScope = pccWorkScopeForProject(detail.project);
    const focusScope = state.pccProductFocusMode ?? projectScope;
    if (focusScope !== projectScope) {
      state.pccActionError =
        projectScope === "pcc_product"
          ? "This is PCC Product work. Switch to PCC Product before running an agent team."
          : "This is Project Work. Switch to Project Work before running an agent team.";
      return;
    }
    const readiness = buildPccExecutionTeamReadiness(
      detail,
      state.pccExecutionCapacity,
      state.agentsList,
      state.chatModelCatalog,
      Object.values(state.pccProjectDetails),
    );

    if (action === "stop") {
      const activePlan = readiness.activePlan;
      if (!activePlan) {
        state.pccActionError = "No active PCC agent team exists for this project.";
        return;
      }
      try {
        await state.client.request("chat.abort", {
          sessionKey: activePlan.coordinator.sessionId,
          runId: activePlan.coordinator.runId,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const blocked = transitionPccExecutionPlan(activePlan, "blocked", {
          at: pccExecutionTransitionAt(activePlan),
          reason: `Stop could not be confirmed: ${reason}`,
        });
        await persistPccExecutionPlan(state, detail, blocked);
        throw new Error(
          `Agent team stop could not be confirmed. PCC marked the plan blocked for recovery: ${reason}`,
          { cause: error },
        );
      }
      const cancelled = transitionPccExecutionPlan(activePlan, "cancelled", {
        at: pccExecutionTransitionAt(activePlan),
        reason: "User stopped the supervised agent team.",
      });
      await persistPccExecutionPlan(state, detail, cancelled);
      setActionNotice(
        state,
        "Agent team stopped. Saved plan history remains available; no milestone was auto-completed.",
      );
      return;
    }

    if (
      readiness.status !== "ready" ||
      !readiness.workerModelId ||
      !readiness.coordinatorAgentId ||
      readiness.admittedLocalAgents < 1
    ) {
      state.pccActionError = `Agent team cannot start: ${readiness.reason}`;
      return;
    }
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const planId = pccExecutionPlanId(detail.project.id, nowMs);
    const workerIds = Array.from(
      { length: readiness.admittedLocalAgents },
      (_, index) => `openclaw-worker-${index + 1}`,
    );
    const partitioned = partitionPccExecutionTasks(readiness.tasks, workerIds);
    if (partitioned.partitions.length === 0) {
      state.pccActionError = "Agent team cannot start because no independent task was admitted.";
      return;
    }
    const taskById = new Map(readiness.tasks.map((task) => [task.id, task]));
    const localModels = configuredLocalModelRefs(state.chatModelCatalog);
    const preferredModel =
      readiness.profile.localModelId === "best_available" ? null : readiness.profile.localModelId;
    const routedPartitions = partitioned.partitions.map((partition) => {
      const task = taskById.get(partition.taskId);
      const route = selectPccLocalModel({
        taskTitle: task?.title ?? partition.taskId,
        availableModelRefs: localModels,
        preferredModelRef: preferredModel,
      });
      return Object.assign({}, partition, {
        modelId: route.modelRef ?? readiness.workerModelId!,
        modelRationale: route.rationale,
      });
    });
    const sessionKey = `agent:${readiness.coordinatorAgentId}:pcc-execution-${detail.project.id}`;
    let plan = createPccExecutionPlan({
      id: planId,
      projectId: detail.project.id,
      projectRevision: detail.project.updatedAt,
      profile: readiness.profile,
      coordinator: { sessionId: sessionKey, runId: planId },
      admittedWorkerCount: readiness.admittedLocalAgents,
      partitions: routedPartitions,
      leases: pccExecutionWorkspaceLeases(planId, routedPartitions, now),
      proofRequirements: pccExecutionProofRequirements(planId, readiness.tasks),
      approvals:
        readiness.profile.codexRole === "off"
          ? []
          : detail.permissions
              .filter((permission) => pccCodexPermissionIsUsable(permission, readiness.profile))
              .map((permission) =>
                executionApprovalFromPccPermission({
                  permission,
                  subjectActorId: readiness.coordinatorAgentId!,
                }),
              ),
      createdAt: now,
      statusReason: "Execution plan saved before dispatch.",
    });
    if (plan.mode === "hybrid") {
      const authorization = consumePccExecutionPlanCodexApproval({
        plan,
        actorId: readiness.coordinatorAgentId,
        now: nowMs,
      });
      if (!authorization.decision.allowed) {
        state.pccActionError = `Agent team cannot start: ${authorization.decision.reason}`;
        return;
      }
      plan = authorization.plan;
    }
    const duplicate = findDuplicateActivePccExecutionPlan(
      executionPlansFromProject(detail.project),
      plan,
    );
    if (duplicate) {
      state.pccActionError = `Agent team ${duplicate.id} is already active for this project.`;
      return;
    }
    await persistPccExecutionPlan(state, detail, plan);
    plan = transitionPccExecutionPlan(plan, "dispatching", {
      at: pccExecutionTransitionAt(plan),
      reason: "Coordinator dispatch is starting.",
    });
    await persistPccExecutionPlan(state, detail, plan);
    try {
      const acknowledgement = await state.client.request<{
        runId?: string;
        status?: string;
      }>("chat.send", {
        sessionKey,
        agentId: readiness.coordinatorAgentId,
        message: buildPccExecutionCoordinatorPrompt(
          detail,
          plan,
          readiness.workerModelId,
          readiness.codexModelId,
        ),
        deliver: false,
        suppressCommandInterpretation: true,
        idempotencyKey: planId,
      });
      if (acknowledgement.status === "error" || acknowledgement.status === "timeout") {
        throw new Error(`OpenClaw coordinator returned ${acknowledgement.status}.`);
      }
      plan = transitionPccExecutionPlan(plan, "running", {
        at: pccExecutionTransitionAt(plan),
        reason: "OpenClaw coordinator accepted the execution plan.",
      });
      if (typeof acknowledgement.runId === "string" && acknowledgement.runId.trim()) {
        plan = {
          ...plan,
          coordinator: { ...plan.coordinator, runId: acknowledgement.runId.trim() },
        };
      }
      await persistPccExecutionPlan(state, detail, plan);
      setActionNotice(
        state,
        `Agent team started with ${readiness.admittedLocalAgents} OpenClaw worker${readiness.admittedLocalAgents === 1 ? "" : "s"}. PCC will require reviewed proof before completion.`,
      );
    } catch (error) {
      const failed = transitionPccExecutionPlan(plan, "failed", {
        at: pccExecutionTransitionAt(plan),
        reason: error instanceof Error ? error.message : String(error),
      });
      await persistPccExecutionPlan(state, detail, failed);
      throw error;
    }
  });
}

type PccProjectUpsertInput = Partial<PccProject> & Pick<PccProject, "title">;

type PccMilestoneUpsertInput = Partial<PccMilestone> &
  Pick<PccMilestone, "projectId" | "title"> & { replaceExisting?: boolean };

type PccSubMilestoneUpsertInput = Partial<PccSubMilestone> &
  Pick<PccSubMilestone, "projectId" | "milestoneId" | "title"> & { replaceExisting?: boolean };

function projectUpsertPayload(project: PccProjectUpsertInput): {
  id?: string;
  revision?: number;
  title: string;
  goal?: string;
  status?: PccStatus;
  owner?: string;
  priority?: number;
  phases?: PccProject["phases"];
  metadata?: PccProject["metadata"];
} {
  return {
    ...(project.id !== undefined ? { id: project.id } : {}),
    ...(project.id !== undefined ? { revision: project.revision ?? 1 } : {}),
    title: project.title,
    ...(project.goal !== undefined ? { goal: project.goal } : {}),
    ...(project.status !== undefined ? { status: project.status } : {}),
    ...(project.owner !== undefined ? { owner: project.owner } : {}),
    ...(project.priority !== undefined ? { priority: project.priority } : {}),
    ...(project.phases !== undefined ? { phases: project.phases } : {}),
    ...(project.metadata !== undefined ? { metadata: project.metadata } : {}),
  };
}

function stablePositiveHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function repairedLegacyOrder(id: string | undefined): number {
  return PCC_LEGACY_ORDER_REPAIR_BASE + (id ? stablePositiveHash(id) : 0);
}

function pccOrderForUpsert(order: unknown, id: string | undefined): number | undefined {
  if (typeof order !== "number" || !Number.isFinite(order)) {
    return undefined;
  }
  const integerOrder = Math.trunc(order);
  return integerOrder >= 0 ? integerOrder : repairedLegacyOrder(id);
}

function temporaryReorderOrder(index: number): number {
  return PCC_TEMP_REORDER_ORDER_BASE + index;
}

function milestoneUpsertPayload(milestone: PccMilestoneUpsertInput): {
  id?: string;
  revision?: number;
  replaceExisting?: boolean;
  projectId: string;
  title: string;
  status?: PccStatus;
  phaseId?: string;
  owner?: string;
  order?: number;
  percentComplete?: number;
  dependsOn?: string[];
  requiredEvidenceIds?: string[];
  receiptIds?: string[];
  permissionGrantIds?: string[];
  blocker?: string;
  implementationPlan?: string;
  acceptanceCriteria?: string[];
  metadata?: PccMilestone["metadata"];
} {
  const order = pccOrderForUpsert(milestone.order, milestone.id);
  return {
    ...(milestone.id !== undefined ? { id: milestone.id } : {}),
    ...(milestone.id !== undefined ? { revision: milestone.revision ?? 1 } : {}),
    ...(milestone.replaceExisting === true ? { replaceExisting: true } : {}),
    projectId: milestone.projectId,
    title: milestone.title,
    ...(milestone.status !== undefined ? { status: milestone.status } : {}),
    ...(milestone.phaseId !== undefined ? { phaseId: milestone.phaseId } : {}),
    ...(milestone.owner !== undefined ? { owner: milestone.owner } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(milestone.percentComplete !== undefined
      ? { percentComplete: milestone.percentComplete }
      : {}),
    ...(milestone.dependsOn !== undefined ? { dependsOn: milestone.dependsOn } : {}),
    ...(milestone.requiredEvidenceIds !== undefined
      ? { requiredEvidenceIds: milestone.requiredEvidenceIds }
      : {}),
    ...(milestone.receiptIds !== undefined ? { receiptIds: milestone.receiptIds } : {}),
    ...(milestone.permissionGrantIds !== undefined
      ? { permissionGrantIds: milestone.permissionGrantIds }
      : {}),
    ...(milestone.blocker !== undefined ? { blocker: milestone.blocker } : {}),
    ...(milestone.implementationPlan !== undefined
      ? { implementationPlan: milestone.implementationPlan }
      : {}),
    ...(milestone.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: milestone.acceptanceCriteria }
      : {}),
    ...(milestone.metadata !== undefined ? { metadata: milestone.metadata } : {}),
  };
}

function subMilestoneUpsertPayload(subMilestone: PccSubMilestoneUpsertInput): {
  id?: string;
  revision?: number;
  replaceExisting?: boolean;
  projectId: string;
  milestoneId: string;
  title: string;
  status?: PccStatus;
  order?: number;
  owner?: string;
  percentComplete?: number;
  dependsOn?: string[];
  requiredEvidenceIds?: string[];
  receiptIds?: string[];
  permissionGrantIds?: string[];
  blocker?: string;
  implementationPlan?: string;
  acceptanceCriteria?: string[];
  metadata?: PccSubMilestone["metadata"];
} {
  const order = pccOrderForUpsert(subMilestone.order, subMilestone.id);
  return {
    ...(subMilestone.id !== undefined ? { id: subMilestone.id } : {}),
    ...(subMilestone.id !== undefined ? { revision: subMilestone.revision ?? 1 } : {}),
    ...(subMilestone.replaceExisting === true ? { replaceExisting: true } : {}),
    projectId: subMilestone.projectId,
    milestoneId: subMilestone.milestoneId,
    title: subMilestone.title,
    ...(subMilestone.status !== undefined ? { status: subMilestone.status } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(subMilestone.owner !== undefined ? { owner: subMilestone.owner } : {}),
    ...(subMilestone.percentComplete !== undefined
      ? { percentComplete: subMilestone.percentComplete }
      : {}),
    ...(subMilestone.dependsOn !== undefined ? { dependsOn: subMilestone.dependsOn } : {}),
    ...(subMilestone.requiredEvidenceIds !== undefined
      ? { requiredEvidenceIds: subMilestone.requiredEvidenceIds }
      : {}),
    ...(subMilestone.receiptIds !== undefined ? { receiptIds: subMilestone.receiptIds } : {}),
    ...(subMilestone.permissionGrantIds !== undefined
      ? { permissionGrantIds: subMilestone.permissionGrantIds }
      : {}),
    ...(subMilestone.blocker !== undefined ? { blocker: subMilestone.blocker } : {}),
    ...(subMilestone.implementationPlan !== undefined
      ? { implementationPlan: subMilestone.implementationPlan }
      : {}),
    ...(subMilestone.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: subMilestone.acceptanceCriteria }
      : {}),
    ...(subMilestone.metadata !== undefined ? { metadata: subMilestone.metadata } : {}),
  };
}

function stringListFromMetadata(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function scopeExcludedMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.excludedFromPccCurrentScope === true;
}

function scopeResumeBlocker(metadata: Record<string, unknown>): string | null {
  const blockers = [
    ...stringListFromMetadata(metadata.blockers),
    ...stringListFromMetadata(metadata.blockedByMissingTools),
  ];
  if (blockers.length > 0) {
    return `Blocked by ${blockers.join(", ")}.`;
  }
  const waitingOn = stringListFromMetadata(metadata.waitingOn);
  if (waitingOn.length > 0) {
    return `Waiting on ${waitingOn.join(", ")}.`;
  }
  return null;
}

function resumedScopeMetadata(
  metadata: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  return {
    ...metadata,
    excludedFromPccCurrentScope: false,
    pccScopeResumedAt: now,
  };
}

function resumeScopeHeldMilestone(milestone: PccMilestone, now: string): PccMilestone {
  const metadata = pccMetadataObject(milestone.metadata);
  if (milestone.status !== "on_hold" || !scopeExcludedMetadata(metadata)) {
    return milestone;
  }
  const blocker = scopeResumeBlocker(metadata);
  return {
    ...milestone,
    status: blocker ? "blocked" : "not_started",
    blocker: blocker ?? undefined,
    updatedAt: now,
    metadata: resumedScopeMetadata(metadata, now),
  };
}

function resumeScopeHeldSubMilestone(
  subMilestone: PccSubMilestone,
  parent: PccMilestone | undefined,
  now: string,
): PccSubMilestone {
  const metadata = pccMetadataObject(subMilestone.metadata);
  if (subMilestone.status !== "on_hold" || !scopeExcludedMetadata(metadata)) {
    return subMilestone;
  }
  const parentMetadata = pccMetadataObject(parent?.metadata);
  const blocker =
    scopeResumeBlocker(metadata) ??
    scopeResumeBlocker(parentMetadata) ??
    (parent?.status === "blocked" ? `Waiting on ${parent.title}.` : null);
  return {
    ...subMilestone,
    status: blocker ? "blocked" : "not_started",
    blocker: blocker ?? undefined,
    updatedAt: now,
    metadata: resumedScopeMetadata(metadata, now),
  };
}

export async function resumePccProjectForWork(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const now = new Date().toISOString();
    const resumedMilestones = detail.milestones.map((milestone) =>
      resumeScopeHeldMilestone(milestone, now),
    );
    const milestoneById = new Map(resumedMilestones.map((milestone) => [milestone.id, milestone]));
    const resumedSubMilestones = (detail.subMilestones ?? []).map((subMilestone) =>
      resumeScopeHeldSubMilestone(subMilestone, milestoneById.get(subMilestone.milestoneId), now),
    );
    const metadata = pccMetadataObject(detail.project.metadata);
    const projectBase: PccProject = {
      ...detail.project,
      status: "active",
      updatedAt: now,
      metadata: {
        ...metadata,
        pccWorkScope: "project_work",
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: metadata.excludedFromPccProductCompletion ?? true,
        pccResumedAt: now,
        pccWorkLoop: {
          ...getPccWorkLoopSettings(detail.project),
          enabled: false,
          state: "idle",
          continueAroundBlockers: true,
          updatedAt: now,
        },
      },
    };
    const evaluation = evaluatePccProjectSetup({
      project: projectBase,
      milestones: resumedMilestones,
      subMilestones: resumedSubMilestones,
    });
    const projectForUpsert = withPccPhase2Metadata(projectBase, evaluation, now);
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload(projectForUpsert),
    });
    for (const resumedMilestone of resumedMilestones.filter(
      (item) => item.updatedAt === now && item.status !== "on_hold",
    )) {
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload(resumedMilestone),
      });
    }
    for (const resumedSubMilestone of resumedSubMilestones.filter(
      (item) => item.updatedAt === now && item.status !== "on_hold",
    )) {
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload(resumedSubMilestone),
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    const blockers = buildPccWorkStartBlockers({
      project: projectForUpsert,
      milestones: resumedMilestones,
      subMilestones: resumedSubMilestones,
      permissions: detail.permissions,
      receipts: detail.receipts,
    });
    setActionNotice(
      state,
      blockers.length
        ? `Project resumed. Next blocker: ${blockers[0]}`
        : "Project resumed. PCC is ready to prepare the next safe task.",
    );
  });
}

export async function updatePccWorkLoopSettings(
  state: PccDashboardState,
  patch: Partial<PccWorkLoopSettings>,
): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const projectScope = pccWorkScopeForProject(detail.project);
    const focusScope = state.pccProductFocusMode ?? projectScope;
    if (focusScope !== projectScope) {
      state.pccActionError =
        projectScope === "pcc_product"
          ? "This is PCC Product work. Switch to PCC Product before preparing it."
          : "This is Project Work. Switch to Project Work before preparing it.";
      return;
    }
    const setupEvaluation = evaluatePccProjectSetup({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones ?? [],
    });
    if (patch.enabled === true && !setupEvaluation.runnable) {
      state.pccAutofillPreview = buildPccSetupAutofillPreview(detail, false);
      state.pccActionError = setupRepairMessage(setupEvaluation, detail);
      return;
    }
    if (patch.enabled === true && detail.project.status === "on_hold") {
      state.pccActionError =
        "Project is on hold. Use Resume Project before starting supervised work.";
      return;
    }
    const updatedProject = withPccWorkLoopSettings(detail.project, patch, new Date().toISOString());
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload(updatedProject),
    });
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    setActionNotice(
      state,
      patch.state === "paused"
        ? "Work paused. PCC saved the current project state."
        : patch.enabled === false
          ? "Work controls turned off. PCC saved the current project state."
          : patch.enabled === true
            ? "Work This Project is on. PCC will still stop before gated or unsafe work."
            : "Work controls saved.",
    );
  });
}

/** Starts durable Gateway-owned execution; the legacy work-loop toggle remains a settings control. */
export async function startPccProjectExecution(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Open a project before starting supervised work.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const expectedRevision = detail.project.revision ?? 1;
    const idempotencyKey = `ui:${detail.project.id}:revision:${expectedRevision}`;
    const result = await state.client.request<{ plan: unknown }>("pcc.execution.start", {
      projectId: detail.project.id,
      expectedRevision,
      idempotencyKey,
    });
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    const plan = result.plan && typeof result.plan === "object" ? result.plan : null;
    setActionNotice(
      state,
      plan
        ? "Work This Project started a durable supervised execution plan. PCC will stop before gated work and require reviewed proof before completion."
        : "PCC saved the execution request without starting a worker.",
    );
  });
}

async function controlPccProjectExecution(
  state: PccDashboardState,
  action: "pause" | "stop",
): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    state.pccActionError = "Open a project before controlling supervised work.";
    state.requestUpdate?.();
    return;
  }
  const activePlan = executionPlansFromProject(detail.project).findLast((plan) =>
    isPccExecutionPlanActive(plan.status),
  );
  if (!activePlan) {
    state.pccActionError = "No active supervised execution plan exists for this project.";
    state.requestUpdate?.();
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const method = action === "pause" ? "pcc.execution.pause" : "pcc.execution.stop";
    await state.client.request<{ plan: unknown }>(method, {
      projectId: detail.project.id,
      planId: activePlan.id,
      expectedRevision: detail.project.revision ?? 1,
    });
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    setActionNotice(
      state,
      action === "pause"
        ? "Work paused. The Gateway preserved the execution plan for safe resumption."
        : "Work stopped. The Gateway preserved the cancelled execution plan; no milestone was completed.",
    );
  });
}

export function pausePccProjectExecution(state: PccDashboardState): Promise<void> {
  return controlPccProjectExecution(state, "pause");
}

export function stopPccProjectExecution(state: PccDashboardState): Promise<void> {
  return controlPccProjectExecution(state, "stop");
}

export async function preparePccNextWorkItem(state: PccDashboardState): Promise<void> {
  const detail = state.pccProjectDetail;
  if (!detail) {
    return;
  }
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const projectScope = pccWorkScopeForProject(detail.project);
    const focusScope = state.pccProductFocusMode ?? projectScope;
    if (focusScope !== projectScope) {
      state.pccActionError =
        projectScope === "pcc_product"
          ? "This is PCC Product work. Switch to PCC Product before preparing it."
          : "This is Project Work. Switch to Project Work before preparing it.";
      return;
    }
    const setupEvaluation = evaluatePccProjectSetup({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones ?? [],
    });
    const capabilityInventory = await loadPccCapabilityInventory(state, detail.project);
    const projectForPreflight = projectUsesPccCapabilityContract(detail.project)
      ? withPccCapabilityPreflight(
          detail.project,
          resolvePccProjectCapabilities({
            project: detail.project,
            inventory: capabilityInventory,
          }),
          new Date().toISOString(),
        )
      : detail.project;
    const persistBlockedPreflight = async () => {
      if (projectForPreflight === detail.project) {
        return;
      }
      // Persist the truth surface even when preparation stops before work.
      await state.client?.request("pcc.projects.upsert", {
        project: projectUpsertPayload(projectForPreflight),
      });
    };
    const resolvedAction = resolvePccProjectAction({
      project: projectForPreflight,
      setupReady: setupEvaluation.runnable,
      blockerLines: buildPccWorkStartBlockers({
        project: projectForPreflight,
        milestones: detail.milestones,
        subMilestones: detail.subMilestones ?? [],
        permissions: detail.permissions,
        receipts: detail.receipts,
        capabilityInventory,
      }),
      permissions: detail.permissions,
      hasBlockedMilestone: detail.summary.milestoneCounts.blocked > 0,
      hasIncompleteMilestone: detail.milestones.some(
        (milestone) => !PCC_TERMINAL_STATUSES.has(milestone.status),
      ),
      workLoop: getPccWorkLoopSettings(detail.project),
    });
    if (resolvedAction.primaryActionId === "fix_setup") {
      await persistBlockedPreflight();
      state.pccAutofillPreview = buildPccSetupAutofillPreview(detail, false);
      state.pccActionError = setupRepairMessage(setupEvaluation, detail);
      return;
    }
    if (resolvedAction.primaryActionId === "resume") {
      await persistBlockedPreflight();
      state.pccActionError =
        "Project is on hold. Use Resume Project before preparing the next safe task.";
      return;
    }
    if (resolvedAction.primaryActionId !== "work") {
      await persistBlockedPreflight();
      state.pccActionError = `${resolvedAction.primaryLabel}: ${
        resolvedAction.topBlocker ?? resolvedAction.explanation
      }`;
      return;
    }
    const next = getPccWorkLoopNext({
      project: projectForPreflight,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones,
      permissions: detail.permissions,
      receipts: detail.receipts,
      capabilityInventory,
    });
    const updatedProject = withPccWorkLoopSettings(
      projectForPreflight,
      {
        enabled: true,
        state: next.state,
        activeMilestoneId: next.milestone?.id,
        activeSubMilestoneId: next.subMilestone?.id,
        lastLoopMessage:
          next.blocker?.message ?? next.taskPrompt ?? "Ready to work this milestone.",
      },
      new Date().toISOString(),
    );
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload(updatedProject),
    });
    if (next.subMilestone && !next.blocker && next.subMilestone.status !== "in_progress") {
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload({
          ...next.subMilestone,
          status: "in_progress",
        }),
      });
    } else if (next.milestone && !next.blocker && next.milestone.status !== "in_progress") {
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload({
          ...next.milestone,
          status: "in_progress",
        }),
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
    setActionNotice(
      state,
      `Next safe task prepared: ${next.subMilestone?.title ?? next.milestone?.title ?? "project work"}.`,
    );
  });
}

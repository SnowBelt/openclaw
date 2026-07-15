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
  pccCapabilityInventoryFromSkillStatus,
  pccCapabilityInventoryFromAgents,
  pccCapabilityInventoryFromModelCatalog,
  resolvePccProjectCapabilities,
  withPccCapabilityPreflight,
  type PccCapabilityInventoryEntry,
} from "../../../../src/pcc/capability-contract.js";
import { evaluatePccCapabilityEvidence } from "../../../../src/pcc/capability-evidence.js";
import type { PccExecutionCapacitySnapshot } from "../../../../src/pcc/execution-capacity.js";
import {
  createPccExecutionPlan,
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
  pccCodexEffortIsSupported,
  resolvePccExecutionProfilePreset,
  validatePccModelSelection,
} from "../../../../src/pcc/execution-profile.js";
import {
  PCC_EXECUTION_QUALITY_REQUIREMENTS,
  buildPccExecutionStandardPrompt,
} from "../../../../src/pcc/execution-standard.js";
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
  pccProjectIsStale,
  pccWorkScopeForProject,
  pccResponsibilityForItem,
} from "../../../../src/pcc/metadata.js";
import { resolvePccProjectAction } from "../../../../src/pcc/project-action.js";
import {
  buildPccWorkflowDraft,
  type PccAiUsePolicy,
  type PccPlanningMode,
} from "../../../../src/pcc/project-workflows.js";
import type { PccRuntimeIdentity } from "../../../../src/pcc/runtime-identity.js";
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
  pccCodexPermissionIsUsable,
  resolveConfiguredExecutionModel,
  resolvePccExecutionStandardForDetail,
} from "../pcc/application/execution-team.ts";
import type {
  PccAiRegenerateSection,
  PccAutofillPreview,
  PccAutopilotAction,
  PccDashboardState,
  PccExecutionTeamAction,
  PccMilestoneFormState,
  PccPlannerMode,
  PccProjectDetail,
  PccProjectFormState,
} from "../pcc/contracts.ts";
import {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
} from "../pcc/form-state.ts";
import {
  milestoneUpsertPayload,
  projectUpsertPayload,
  subMilestoneUpsertPayload,
  temporaryReorderOrder,
} from "../pcc/infrastructure/gateway-payloads.ts";
import { PCC_TERMINAL_STATUSES } from "../pcc/policies.ts";
import type {
  PccCompletionReceipt,
  PccDecision,
  PccEvidence,
  PccLastKnownGood,
  PccMilestone,
  PccSubMilestone,
  PccPermissionGrant,
  PccPermissionStatus,
  PccPortfolioSummary,
  PccProject,
  PccProjectSummary,
  PccStatus,
  ModelCatalogEntry,
  SkillStatusReport,
} from "../types.ts";

export {
  buildPccExecutionTeamReadiness,
  resolvePccExecutionStandardForDetail,
} from "../pcc/application/execution-team.ts";
export {
  cancelPccDecisionForm,
  cancelPccEditor,
  openPccDecisionForm,
  updatePccDecisionForm,
  updatePccMilestoneForm,
  updatePccProductFocusMode,
  updatePccProjectEditMode,
  updatePccProjectFilter,
  updatePccProjectSearchQuery,
  updatePccReorderMode,
  updatePccViewMode,
} from "../pcc/application/state-transitions.ts";
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
} from "../pcc/contracts.ts";
export {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
} from "../pcc/form-state.ts";

type PccProjectsListResult = {
  projects?: PccProjectSummary[];
};

type PccSummaryGetResult = {
  portfolio?: PccPortfolioSummary;
  executionCapacity?: PccExecutionCapacitySnapshot;
  runtimeIdentity?: PccRuntimeIdentity;
};

const dashboardLoadByState = new WeakMap<PccDashboardState, Promise<void>>();
const projectDetailRequestsByState = new WeakMap<
  PccDashboardState,
  Map<string, Promise<PccProjectsGetResult>>
>();
const projectSelectionVersionByState = new WeakMap<PccDashboardState, number>();

function requestPccProjectDetail(
  state: PccDashboardState,
  projectId: string,
): Promise<PccProjectsGetResult> {
  if (!state.client) {
    return Promise.reject(new Error("Project Command Center is disconnected."));
  }
  let requests = projectDetailRequestsByState.get(state);
  if (!requests) {
    requests = new Map();
    projectDetailRequestsByState.set(state, requests);
  }
  const existing = requests.get(projectId);
  if (existing) {
    return existing;
  }
  const request = state.client
    .request<PccProjectsGetResult>("pcc.projects.get", { projectId })
    .finally(() => {
      if (requests?.get(projectId) === request) {
        requests.delete(projectId);
      }
    });
  requests.set(projectId, request);
  return request;
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
  summary: PccProjectSummary;
};

type PccProjectsUpsertResult = {
  project: PccProject;
  summary: PccProjectSummary;
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

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function projectUsesPccCapabilityContract(project: PccProject): boolean {
  return (
    metadataObject(metadataObject(project.metadata).pccCapabilityContract).schema ===
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
    }
  } catch {
    // Missing optional inventory stays unknown. Required skills still fail
    // closed later with a precise capability blocker instead of a generic RPC error.
  }
  return inventory;
}

function metadataWithoutLegacyExecutionRouting(value: unknown): Record<string, unknown> {
  const next = { ...metadataObject(value) };
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
  const assignments = plan.partitions.map((partition) => {
    const task = executionTasksForDetail(detail).find((item) => item.id === partition.taskId);
    const lease = plan.leases.find((item) => item.partitionId === partition.id);
    return {
      partitionId: partition.id,
      workerId: partition.workerId,
      taskId: partition.taskId,
      title: task?.title ?? partition.taskId,
      milestoneId: partition.milestoneId,
      workspaceLease: lease ? { workspaceId: lease.workspaceId, expiresAt: lease.expiresAt } : null,
    };
  });
  const codexRule =
    plan.profile.codexRole === "off"
      ? "Codex is OFF. Do not invoke Codex or any Codex model for this plan."
      : `A scoped PCC grant exists for Codex role ${plan.profile.codexRole}. Use ${codexModelId} at ${plan.profile.codexEffort} effort only for that role; do not broaden it.`;
  return [
    "You are the PCC supervised execution coordinator.",
    `Project: ${detail.project.title} (${detail.project.id})`,
    `Project goal: ${detail.project.goal ?? "No goal recorded."}`,
    `PCC work scope: ${pccWorkScopeForProject(detail.project)}`,
    `Execution plan ID: ${plan.id}`,
    `OpenClaw worker model: ${workerModelId}`,
    `Maximum concurrent OpenClaw workers: ${plan.admittedWorkerCount}`,
    codexRule,
    plan.executionStandard
      ? buildPccExecutionStandardPrompt(plan.executionStandard)
      : "PCC execution standard is missing from this legacy plan. Stop and request a fresh plan before implementation.",
    `Use sessions_spawn with isolated context and pass model: ${workerModelId} for every assigned worker. If that exact model cannot be used, stop and report the mismatch instead of silently substituting another model. A worker may process multiple assigned partitions serially, but never run two partitions that share a workspace lease concurrently.`,
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
        ...metadataObject(detail.project.metadata),
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
  const taskProof = tasks.flatMap((task) =>
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
  const primaryMilestoneId = tasks.find((task) => task.milestoneId)?.milestoneId;
  const qualityProof = primaryMilestoneId
    ? PCC_EXECUTION_QUALITY_REQUIREMENTS.map((requirement) => ({
        milestoneId: primaryMilestoneId,
        proofId: `${planId}:quality:${requirement.id}`,
        description: requirement.label,
        qualityRequirementId: requirement.id,
      }))
    : [];
  return [...taskProof, ...qualityProof];
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

function aiUsePolicyAllowedAction(policy: PccAiUsePolicy): string {
  switch (policy) {
    case "codex_focused":
      return "Use Codex for initial planning, critical decisions, verification, and final review; Local AI handles routine work";
    case "codex_everything":
      return "Use Codex for all eligible project planning and milestone work";
    default:
      return "Use Codex for planning, architecture, difficult problem-solving, debugging, and final review; Local AI handles routine work";
  }
}

function canonicalizeProjectAiRouting(form: PccProjectFormState): PccProjectFormState {
  const executionProfile = normalizePccExecutionProfile({
    pccExecutionProfile: form.executionProfile,
  });
  const aiUsePolicy = derivePccAiUsePolicy(executionProfile);
  if (executionProfile.codexRole === "off") {
    return {
      ...form,
      executionProfile,
      aiUsePolicy,
      plannerMode:
        form.plannerMode === "local_model" || form.plannerMode === "local_project_manager"
          ? form.plannerMode
          : "best_available",
      planningMode: "local_project_manager",
      plannerModelId: executionProfile.localModelId,
      plannerPermissionScope: executionProfile.approvalScope,
      codexPlanningAllowed: false,
      plannerPermissionBudget: "",
    };
  }
  const plannerMode = executionProfile.codexEffort === "medium" ? "codex" : "high_reasoning_codex";
  return {
    ...form,
    executionProfile,
    aiUsePolicy,
    plannerMode,
    planningMode: "codex_full_plan",
    plannerModelId: executionProfile.localModelId,
    plannerPermissionScope: executionProfile.approvalScope,
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
    metadataString(metadataObject(detail.project.metadata).pccProjectDescription, ""),
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
  const metadata = metadataObject(milestone.metadata);
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
  const metadata = metadataObject(subMilestone.metadata);
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

function workflowDraftForSetup(detail: PccProjectDetail, previewGoal?: string) {
  const existingWorkflow = metadataString(
    metadataObject(detail.project.metadata).pccWorkflowTemplateId,
    "",
  );
  const workflow = recommendPccWorkflow({
    title: detail.project.title,
    goal: previewGoal ?? autofillGoal(detail),
    intakeAnswers: pccIntakeAnswersFromMetadata(detail.project.metadata),
  });
  return buildPccWorkflowDraft({
    title: detail.project.title,
    goal: previewGoal ?? autofillGoal(detail),
    templateId: existingWorkflow || workflow.templateId,
    priority: detail.project.priority,
    planningMode: "local_project_manager",
    codexPlanningAllowed: false,
    remoteProofAllowed: false,
    runtimeActionsAllowed: false,
  });
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
  const metadata = metadataObject(project.metadata);
  const aiRouting = metadataObject(metadata.pccAiRouting);
  const executionProfile = normalizePccExecutionProfile(metadata);
  const form: PccProjectFormState = {
    id: project.id,
    title: project.title,
    goal: project.goal ?? "",
    projectDescription: metadataString(metadata.pccProjectDescription, project.goal ?? ""),
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
      "local_project_manager",
    ) as PccPlannerMode,
    aiUsePolicy: normalizeAiUsePolicy(
      aiRouting.policy ?? metadata.pccAiUsePolicy,
      aiUsePolicyFromPlannerMode(
        metadataString(metadata.pccPlannerMode, "local_project_manager") as PccPlannerMode,
      ),
    ),
    plannerModelId: executionProfile.localModelId,
    plannerPermissionScope: executionProfile.approvalScope,
    plannerPermissionBudget: "",
    planPreviewAccepted: true,
    codexPlanningAllowed: permissions.some((permission) =>
      pccCodexPermissionIsUsable(permission, executionProfile),
    ),
    remoteProofAllowed: metadataBoolean(metadata.pccRemoteProofAllowed, false),
    runtimeActionsAllowed: metadataBoolean(metadata.pccRuntimeActionsAllowed, false),
    executionProfile,
    intakeAnswers: pccIntakeAnswersFromMetadata(metadata),
    intakeApproved: metadataBoolean(metadataObject(metadata.pccIntake).approved, false),
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
    costRisk: metadataString(metadataObject(milestone.metadata).pccCostRisk, "low"),
    stopHere: metadataBoolean(metadataObject(milestone.metadata).pccStopHere, false),
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
  return `PCC cannot start this project yet: ${firstIssue}. Review the blocker checklist, use AI setup repair, or resume the project if it is on hold.`;
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

async function loadPccDashboardOnce(state: PccDashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.pccLoading = true;
  state.pccError = null;
  state.requestUpdate?.();
  try {
    const [projectsResult, summaryResult] = await Promise.all([
      state.client.request<PccProjectsListResult>("pcc.projects.list", {}),
      state.client.request<PccSummaryGetResult>("pcc.summary.get", {}),
    ]);
    const projects = Array.isArray(projectsResult.projects)
      ? projectsResult.projects.map(safeProjectSummary)
      : [];
    state.pccProjects = projects;
    state.pccPortfolioSummary = summaryResult.portfolio ?? summarizePortfolio(projects);
    state.pccExecutionCapacity = summaryResult.executionCapacity ?? null;
    state.pccRuntimeIdentity = summaryResult.runtimeIdentity ?? null;
    if (state.pccProjectDetail) {
      rememberPccProjectDetailForState(state, state.pccProjectDetail);
    }
    const pccProjectSummary = projects.find((project) => project.id === "project-command-center");
    if (pccProjectSummary && !state.pccProjectDetails[pccProjectSummary.id]) {
      try {
        const detail = await requestPccProjectDetail(state, pccProjectSummary.id);
        const normalized = normalizePccProjectDetail(detail);
        rememberPccProjectDetailForState(state, normalized);
      } catch {
        // Keep the dashboard usable if the optional production-truth preload fails.
      }
    }
    const selectedProjectStillExists = Boolean(
      state.pccProjectDetail &&
      projects.some((project) => project.id === state.pccProjectDetail?.project.id),
    );
    if (!selectedProjectStillExists) {
      const preferredSummary =
        projects.find((project) => project.id === state.pccSelectedProjectId) ??
        pccProjectSummary ??
        projects.find((project) => project.status === "active") ??
        projects[0];
      if (preferredSummary) {
        const cachedDetail = state.pccProjectDetails[preferredSummary.id];
        if (cachedDetail) {
          state.pccSelectedProjectId = cachedDetail.project.id;
          state.pccProjectDetail = cachedDetail;
          rememberPccProjectDetailForState(state, cachedDetail);
        } else {
          try {
            const detail = await requestPccProjectDetail(state, preferredSummary.id);
            const normalized = normalizePccProjectDetail(detail);
            state.pccSelectedProjectId = normalized.project.id;
            state.pccProjectDetail = normalized;
            rememberPccProjectDetailForState(state, normalized);
          } catch {
            state.pccSelectedProjectId = null;
            state.pccProjectDetail = null;
          }
        }
      } else {
        state.pccSelectedProjectId = null;
        state.pccProjectDetail = null;
      }
    }
    state.pccUpdatedAt = Date.now();
  } catch (err) {
    state.pccError = formatConnectError(err) || "Project Command Center unavailable";
  } finally {
    state.pccLoading = false;
    state.requestUpdate?.();
  }
}

export function loadPccDashboard(state: PccDashboardState): Promise<void> {
  if (!state.client || !state.connected) {
    return Promise.resolve();
  }
  const existing = dashboardLoadByState.get(state);
  if (existing) {
    return existing;
  }
  const load = loadPccDashboardOnce(state).finally(() => {
    if (dashboardLoadByState.get(state) === load) {
      dashboardLoadByState.delete(state);
    }
  });
  dashboardLoadByState.set(state, load);
  return load;
}

export async function selectPccProject(state: PccDashboardState, projectId: string): Promise<void> {
  if (!state.client) {
    state.pccActionError =
      "Project Command Center is offline or disconnected. Project details could not be loaded.";
    state.requestUpdate?.();
    return;
  }
  const selectionVersion = (projectSelectionVersionByState.get(state) ?? 0) + 1;
  projectSelectionVersionByState.set(state, selectionVersion);
  state.pccActionError = null;
  state.pccSelectedProjectId = projectId;
  const cached = state.pccProjectDetails?.[projectId];
  if (cached) {
    state.pccProjectDetail = cached;
    state.pccProductFocusMode = pccWorkScopeForProject(cached.project);
    rememberPccProjectDetailForState(state, cached);
  } else if (state.pccProjectDetail?.project.id !== projectId) {
    state.pccProjectDetail = null;
  }
  state.requestUpdate?.();
  try {
    const detail = await requestPccProjectDetail(state, projectId);
    if (
      projectSelectionVersionByState.get(state) !== selectionVersion ||
      state.pccSelectedProjectId !== projectId
    ) {
      return;
    }
    state.pccSelectedProjectId = detail.project.id;
    state.pccProjectDetail = normalizePccProjectDetail(detail);
    state.pccProductFocusMode = pccWorkScopeForProject(state.pccProjectDetail.project);
    rememberPccProjectDetailForState(state, state.pccProjectDetail);
    refreshPccChatSyncProposals(state);
  } catch (err) {
    if (projectSelectionVersionByState.get(state) === selectionVersion) {
      setActionError(state, err);
    }
  } finally {
    if (projectSelectionVersionByState.get(state) === selectionVersion) {
      state.requestUpdate?.();
    }
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
    nextForm.planningMode = plannerModeToPlanningMode(patch.plannerMode);
  }
  if (patch.projectDescription !== undefined) {
    nextForm = { ...nextForm, planPreviewAccepted: false };
  }
  if (patch.projectDescription !== undefined || patch.plannerMode !== undefined) {
    nextForm = enrichProjectFormFromDescription(nextForm);
  }
  state.pccProjectForm = nextForm;
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

export function previewPccSetupAutofill(state: PccDashboardState): void {
  if (!state.pccProjectDetail) {
    state.pccActionError = "Select a project before using setup autofill.";
    state.requestUpdate?.();
    return;
  }
  state.pccAutofillPreview = buildPccSetupAutofillPreview(state.pccProjectDetail, false);
  state.pccActionError = null;
  state.requestUpdate?.();
  if (typeof document !== "undefined") {
    setTimeout(() => {
      const preview = document.querySelector<HTMLElement>("[data-pcc-autofill-preview]");
      preview?.scrollIntoView({ block: "center", behavior: "smooth" });
      preview?.focus({ preventScroll: true });
    }, 0);
  }
}

export function previewPccSectionAutofill(
  state: PccDashboardState,
  section: PccAiRegenerateSection,
): void {
  if (!state.pccProjectDetail) {
    state.pccActionError = "Select a project before using section AI regeneration.";
    state.requestUpdate?.();
    return;
  }
  state.pccAutofillPreview = buildPccSectionAutofillPreview(state.pccProjectDetail, section, false);
  state.pccActionError = null;
  state.requestUpdate?.();
}

export function updatePccAutofillApproval(state: PccDashboardState, approved: boolean): void {
  if (!state.pccProjectDetail) {
    return;
  }
  state.pccAutofillPreview = buildPccSetupAutofillPreview(state.pccProjectDetail, approved);
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
  const existingIntake = metadataObject(metadataObject(detail.project.metadata).pccIntake);
  const missingQuestionIds = pccMissingRequiredIntakeAnswers(preview.intakeAnswers);
  const fullRepair = !preview.section;
  const updateGoal = fullRepair || preview.section === "goal";
  const updateWorkflow = fullRepair || preview.section === "workflow";
  const updateIntake = fullRepair || preview.section === "intake";
  return {
    ...detail.project,
    goal: updateGoal ? preview.goal : detail.project.goal,
    metadata: {
      ...metadataObject(detail.project.metadata),
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
        source: "local_project_manager",
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
  const draft = workflowDraftForSetup(detail, preview.goal);
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
  const draft = workflowDraftForSetup(detail, preview.goal);
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
      const draft = workflowDraftForSetup(detail, preview.goal);
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
  if (!state.pccProjectDetail) {
    return;
  }
  state.pccAutofillPreview = buildPccSetupAutofillPreview(state.pccProjectDetail, true);
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
    if (!form.id && aiUsePolicyNeedsCodex(form.aiUsePolicy) && !form.codexPlanningAllowed) {
      state.pccActionError =
        "Approve the selected Codex role once, or choose Local first, before creating the project.";
      return;
    }
    const resolvedCodexModel =
      form.executionProfile.codexRole === "off"
        ? null
        : resolveConfiguredExecutionModel(
            form.executionProfile.codexModelId,
            state.chatModelCatalog,
            "codex",
          );
    if (
      form.executionProfile.codexRole !== "off" &&
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
    const existingIntake = metadataObject(
      metadataObject(state.pccProjectDetail?.project.metadata).pccIntake,
    );
    const intakeMetadata = {
      answers: form.intakeAnswers,
      approved: form.intakeApproved,
      ...(form.intakeApproved
        ? { approvedAt: form.id ? metadataString(existingIntake.approvedAt, now) : now }
        : {}),
      missingQuestionIds: intakeMissing,
      status: form.intakeApproved ? "approved" : "needs_review",
    };
    const draft = form.id
      ? null
      : buildPccWorkflowDraft({
          title: form.title.trim(),
          goal: form.goal.trim(),
          templateId: form.workflowTemplateId,
          ...(priority !== undefined ? { priority } : {}),
          codexPlanningAllowed: form.codexPlanningAllowed,
          remoteProofAllowed: form.remoteProofAllowed,
          runtimeActionsAllowed: form.runtimeActionsAllowed,
          planningMode: form.planningMode,
          aiUsePolicy: form.aiUsePolicy,
        });
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
    const result = await state.client.request<PccProjectsUpsertResult>("pcc.projects.upsert", {
      project: projectUpsertPayload(projectForUpsert),
    });
    if (draft && !form.id) {
      for (const milestone of draft.milestones) {
        const created = await state.client.request<{ milestone: PccMilestone }>(
          "pcc.milestones.upsert",
          { milestone: milestoneUpsertPayload({ ...milestone, projectId: result.project.id }) },
        );
        for (const subMilestone of draft.subMilestonesByMilestoneTitle[milestone.title] ?? []) {
          await state.client.request("pcc.subMilestones.upsert", {
            subMilestone: subMilestoneUpsertPayload({
              ...subMilestone,
              projectId: result.project.id,
              milestoneId: created.milestone.id,
            }),
          });
        }
      }
    }
    const existingCodexPermissions = (state.pccProjectDetail?.permissions ?? []).filter(
      (permission) =>
        permission.type === "codex_usage" || permission.type === "high_reasoning_model",
    );
    if (aiUsePolicyNeedsCodex(form.aiUsePolicy)) {
      const permissionType =
        form.plannerMode === "high_reasoning_codex" ? "high_reasoning_model" : "codex_usage";
      const existingPermission = existingCodexPermissions.find(
        (permission) => permission.type === permissionType,
      );
      await state.client.request("pcc.permissions.upsert", {
        permission: {
          ...(existingPermission ? { id: existingPermission.id } : {}),
          projectId: result.project.id,
          type: permissionType,
          status: form.codexPlanningAllowed ? "granted" : "needed",
          riskLevel: permissionType === "high_reasoning_model" ? "high" : "medium",
          allowedActions: [aiUsePolicyAllowedAction(form.aiUsePolicy)],
          forbiddenActions: [
            "Deployment, credential changes, destructive actions, reboot, purchases, publishing, and unrelated external writes",
          ],
          target:
            form.aiUsePolicy === "codex_everything"
              ? "All eligible project work"
              : "Expert project planning and review work",
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
    await state.client.request("pcc.milestones.upsert", {
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
          ...metadataObject(
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
          ...metadataObject(milestone.metadata),
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
      ...metadataObject(item.metadata),
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
    await state.client.request("pcc.milestones.upsert", {
      milestone: milestoneUpsertPayload(milestoneUpdate),
    });
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
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload(
            itemWithStatusMetadata(subMilestone, childStatus, note),
          ),
        });
      }
    }
    await loadPccDashboard(state);
    await selectPccProject(state, milestone.projectId);
    setPccUndo(state, `Restore ${milestone.title}`, async () => {
      if (!state.client) {
        return;
      }
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload(previousMilestone),
      });
      for (const subMilestone of previousChildren) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload(subMilestone),
        });
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
    await state.client.request("pcc.subMilestones.upsert", {
      subMilestone: subMilestoneUpsertPayload(
        itemWithStatusMetadata(subMilestone, normalizedStatus, note),
      ),
    });
    await loadPccDashboard(state);
    await selectPccProject(state, subMilestone.projectId);
    setPccUndo(state, `Restore ${subMilestone.title}`, async () => {
      if (!state.client) {
        return;
      }
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload(previousSubMilestone),
      });
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
    for (const [index, { milestone }] of changed.entries()) {
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload({ ...milestone, order: temporaryReorderOrder(index) }),
      });
    }
    for (const { milestone, nextOrder } of changed) {
      await state.client.request("pcc.milestones.upsert", {
        milestone: milestoneUpsertPayload({ ...milestone, order: nextOrder }),
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, source.projectId);
    setPccUndo(state, `Restore milestone order`, async () => {
      if (!state.client) {
        return;
      }
      for (const milestone of previousMilestones) {
        await state.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload(milestone),
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
    for (const [index, { subMilestone }] of changed.entries()) {
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload({
          ...subMilestone,
          order: temporaryReorderOrder(index),
        }),
      });
    }
    for (const { subMilestone, nextOrder } of changed) {
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: subMilestoneUpsertPayload({ ...subMilestone, order: nextOrder }),
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, source.projectId);
    setPccUndo(state, `Restore sub-step order`, async () => {
      if (!state.client) {
        return;
      }
      for (const subMilestone of previousSubMilestones) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload(subMilestone),
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
      for (const [index, { milestone }] of milestoneUpdates.entries()) {
        await state.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload({ ...milestone, order: temporaryReorderOrder(index) }),
        });
      }
      for (const { milestone, nextOrder } of milestoneUpdates) {
        await state.client.request("pcc.milestones.upsert", {
          milestone: milestoneUpsertPayload({ ...milestone, order: nextOrder }),
        });
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
      for (const [index, { subMilestone }] of subMilestoneUpdates.entries()) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload({
            ...subMilestone,
            order: temporaryReorderOrder(index),
          }),
        });
      }
      for (const { subMilestone, nextOrder } of subMilestoneUpdates) {
        await state.client.request("pcc.subMilestones.upsert", {
          subMilestone: subMilestoneUpsertPayload({ ...subMilestone, order: nextOrder }),
        });
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
        permission: {
          id: permission.id,
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
            ...metadataObject(existing?.metadata),
            ...metadataObject(proposal.milestonePatch.metadata),
          },
        }),
      });
    } else if (proposal.kind === "request_permission") {
      if (!proposal.permission) {
        throw new Error("Missing permission proposal");
      }
      await state.client.request("pcc.permissions.upsert", {
        permission: proposal.permission,
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, state.pccProjectDetail.project.id);
    state.pccChatSyncProposals = state.pccChatSyncProposals.filter(
      (candidate) => candidate.id !== proposal.id,
    );
  });
}

function autopilotInputForDetail(detail: PccProjectDetail, state?: PccDashboardState) {
  const executionStandard = resolvePccExecutionStandardForDetail(
    detail,
    state?.skillsReport,
    undefined,
    state?.skillsError,
  );
  return {
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    evidence: detail.evidence,
    decisions: detail.decisions ?? [],
    executionStandard,
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
  const now = new Date().toISOString();
  const executionStandard = resolvePccExecutionStandardForDetail(
    detail,
    state.skillsReport,
    undefined,
    state.skillsError,
  );
  const project = withPccAutopilotState(
    {
      ...detail.project,
      updatedAt: now,
      metadata: {
        ...metadataObject(detail.project.metadata),
        pccResolvedExecutionStandard: executionStandard,
        pccExecutionStandardResolvedAt: now,
      },
    },
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
    const input = autopilotInputForDetail(detail, state);
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
    const now = new Date().toISOString();
    const input = autopilotInputForDetail(detail, state);
    const current = getPccAutopilotState(input, now);
    const next = queuePccAutopilotPermissionRequest(
      input,
      {
        ...current,
        status: "ready" as const,
        promptSlots: generatePccAutopilotPromptSlots(input, current.mode),
        auditLog: [
          ...current.auditLog,
          {
            at: now,
            event: "prompts_generated",
            summary: "Generated editable Autopilot prompt slots from current PCC project state.",
          },
        ].slice(-200),
        updatedAt: now,
      },
      now,
    );
    await savePccAutopilotStateForDetail(state, detail, next);
    setActionNotice(state, "Autopilot prompts generated. Edit them, then start the safe loop.");
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
    const input = autopilotInputForDetail(detail, state);
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
    const input = autopilotInputForDetail(detail, state);
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
      state.skillsReport,
      state.skillsError,
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
    const sessionKey = `agent:${readiness.coordinatorAgentId}:pcc-execution-${detail.project.id}`;
    let plan = createPccExecutionPlan({
      id: planId,
      projectId: detail.project.id,
      projectRevision: detail.project.updatedAt,
      profile: readiness.profile,
      executionStandard: readiness.executionStandard,
      coordinator: { sessionId: sessionKey, runId: planId },
      admittedWorkerCount: readiness.admittedLocalAgents,
      partitions: partitioned.partitions,
      leases: pccExecutionWorkspaceLeases(planId, partitioned.partitions, now),
      proofRequirements: pccExecutionProofRequirements(planId, readiness.tasks),
      createdAt: now,
      statusReason: "Execution plan saved before dispatch.",
    });
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
  const metadata = metadataObject(milestone.metadata);
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
  const metadata = metadataObject(subMilestone.metadata);
  if (subMilestone.status !== "on_hold" || !scopeExcludedMetadata(metadata)) {
    return subMilestone;
  }
  const parentMetadata = metadataObject(parent?.metadata);
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
    const metadata = metadataObject(detail.project.metadata);
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
    const executionStandard =
      patch.enabled === true
        ? resolvePccExecutionStandardForDetail(
            detail,
            state.skillsReport,
            undefined,
            state.skillsError,
          )
        : null;
    if (executionStandard?.status === "blocked") {
      state.pccActionError = `Work cannot start: ${executionStandard.blockers[0] ?? "PCC could not resolve the required processes and skills."}`;
      return;
    }
    const now = new Date().toISOString();
    const withWorkLoop = withPccWorkLoopSettings(detail.project, patch, now);
    const updatedProject = executionStandard
      ? {
          ...withWorkLoop,
          metadata: {
            ...metadataObject(withWorkLoop.metadata),
            pccResolvedExecutionStandard: executionStandard,
            pccExecutionStandardResolvedAt: now,
          },
        }
      : withWorkLoop;
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
    const executionStandard = resolvePccExecutionStandardForDetail(
      detail,
      state.skillsReport,
      next.subMilestone?.title ?? next.milestone?.title,
      state.skillsError,
    );
    if (executionStandard.status === "blocked") {
      state.pccActionError = `Next task cannot be prepared: ${executionStandard.blockers[0] ?? "PCC could not resolve the required processes and skills."}`;
      return;
    }
    const now = new Date().toISOString();
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
      now,
    );
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload({
        ...updatedProject,
        metadata: {
          ...metadataObject(updatedProject.metadata),
          pccResolvedExecutionStandard: executionStandard,
          pccExecutionStandardResolvedAt: now,
        },
      }),
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

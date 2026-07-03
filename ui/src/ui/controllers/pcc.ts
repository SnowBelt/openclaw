import {
  evaluatePccProjectSetup,
  PCC_REQUIRED_INTAKE_QUESTIONS,
  pccIntakeAnswersFromMetadata,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
  withPccPhase2Metadata,
} from "../../../../src/pcc/intake-quality.js";
import {
  buildPccWorkflowDraft,
  type PccPlanningMode,
} from "../../../../src/pcc/project-workflows.js";
// Control UI controller loads and edits Project Command Center ledger entries.
import {
  getPccWorkLoopNext,
  withPccWorkLoopSettings,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { buildPccChatSyncProposals, type PccChatSyncProposal } from "../pcc-chat-sync.ts";
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccSubMilestone,
  PccPermissionGrant,
  PccPermissionStatus,
  PccPortfolioSummary,
  PccProject,
  PccProjectSummary,
  PccStatus,
} from "../types.ts";

export type PccProjectDetail = {
  project: PccProject;
  milestones: PccMilestone[];
  subMilestones?: PccSubMilestone[];
  permissions: PccPermissionGrant[];
  evidence: PccEvidence[];
  receipts: PccCompletionReceipt[];
  summary: PccProjectSummary;
};

export type PccEditorMode =
  | "create-project"
  | "edit-project"
  | "create-milestone"
  | "edit-milestone"
  | null;

export type PccViewMode = "simple" | "detailed" | "agent";

export type PccPlannerMode =
  | "best_available"
  | "local_project_manager"
  | "local_model"
  | "codex"
  | "high_reasoning_codex";

export type PccProjectFilter = "active" | "needs_you" | "on_hold" | "archived" | "all";

export type PccActionNotice = {
  kind: "success" | "info";
  text: string;
  undoLabel?: string;
};

export type PccAutofillPreview = {
  projectId: string;
  goal: string;
  intakeAnswers: Record<string, string>;
  intakeApproved: boolean;
  workflowTemplateId: string;
  workflowTitle: string;
  summary: string;
  milestoneUpdates: Array<{ id: string; title: string; fields: string[] }>;
  subMilestoneUpdates: Array<{ id: string; title: string; fields: string[] }>;
};

export type PccProjectFormState = {
  id: string | null;
  title: string;
  goal: string;
  projectDescription: string;
  status: PccStatus;
  priority: string;
  workflowTemplateId: string;
  planningMode: PccPlanningMode;
  plannerMode: PccPlannerMode;
  plannerModelId: string;
  planPreviewAccepted: boolean;
  codexPlanningAllowed: boolean;
  remoteProofAllowed: boolean;
  runtimeActionsAllowed: boolean;
  intakeAnswers: Record<string, string>;
  intakeApproved: boolean;
};

export type PccMilestoneFormState = {
  id: string | null;
  projectId: string | null;
  title: string;
  status: PccStatus;
  phaseId: string;
  order: string;
  percentComplete: string;
  blocker: string;
  implementationPlan: string;
  acceptanceCriteria: string;
  responsibility: string;
  costRisk: string;
  stopHere: boolean;
};

export type PccDashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  pccProjects: PccProjectSummary[];
  pccPortfolioSummary: PccPortfolioSummary | null;
  pccLoading: boolean;
  pccError: string | null;
  pccUpdatedAt: number | null;
  pccSelectedProjectId: string | null;
  pccProjectDetail: PccProjectDetail | null;
  pccProjectDetails: Record<string, PccProjectDetail>;
  pccActionBusy: boolean;
  pccActionError: string | null;
  pccActionNotice?: PccActionNotice | null;
  pccProjectFilter?: PccProjectFilter;
  pccProjectSearchQuery?: string;
  pccEditorMode: PccEditorMode;
  pccProjectForm: PccProjectFormState;
  pccMilestoneForm: PccMilestoneFormState;
  pccAutofillPreview?: PccAutofillPreview | null;
  pccChatSyncText: string;
  pccChatSyncProposals: PccChatSyncProposal[];
  pccChatSyncError: string | null;
  pccViewMode: PccViewMode;
  requestUpdate?: () => void;
};

type PccProjectsListResult = {
  projects?: PccProjectSummary[];
};

type PccSummaryGetResult = {
  portfolio?: PccPortfolioSummary;
};

type PccProjectsGetResult = {
  project: PccProject;
  milestones: PccMilestone[];
  subMilestones?: PccSubMilestone[];
  permissions: PccPermissionGrant[];
  evidence: PccEvidence[];
  receipts: PccCompletionReceipt[];
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

type PccReceiptsAddResult = {
  receipt: PccCompletionReceipt;
  milestone: PccMilestone;
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

export const EMPTY_PCC_PROJECT_FORM: PccProjectFormState = {
  id: null,
  title: "",
  goal: "",
  projectDescription: "",
  status: "active",
  priority: "3",
  workflowTemplateId: "software-product",
  planningMode: "local_project_manager",
  plannerMode: "best_available",
  plannerModelId: "",
  planPreviewAccepted: false,
  codexPlanningAllowed: false,
  remoteProofAllowed: false,
  runtimeActionsAllowed: false,
  intakeAnswers: {},
  intakeApproved: false,
};

export const EMPTY_PCC_MILESTONE_FORM: PccMilestoneFormState = {
  id: null,
  projectId: null,
  title: "",
  status: "not_started",
  phaseId: "",
  order: "",
  percentComplete: "",
  blocker: "",
  implementationPlan: "",
  acceptanceCriteria: "",
  responsibility: "local_openclaw_agent",
  costRisk: "low",
  stopHere: false,
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

function metadataString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function plannerModeToPlanningMode(mode: PccPlannerMode, codexAllowed = false): PccPlanningMode {
  if (mode === "best_available") {
    return codexAllowed ? "codex_full_plan" : "local_project_manager";
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

function enrichProjectFormFromDescription(form: PccProjectFormState): PccProjectFormState {
  const plannerMode = form.plannerMode ?? plannerModeFromPlanningMode(form.planningMode);
  const description = (form.projectDescription ?? "").trim();
  if (!description) {
    return {
      ...form,
      plannerMode,
      projectDescription: form.projectDescription ?? "",
      plannerModelId: form.plannerModelId ?? "",
      planPreviewAccepted: form.planPreviewAccepted ?? false,
      planningMode: plannerModeToPlanningMode(plannerMode),
    };
  }
  const answers = inferIntakeAnswersFromDescription(description, plannerMode);
  const recommendation = recommendPccWorkflow({
    title: form.title || inferProjectTitle(description),
    goal: form.goal || description,
    intakeAnswers: { ...answers, ...form.intakeAnswers },
  });
  return {
    ...form,
    title: form.title.trim() ? form.title : inferProjectTitle(description),
    goal: form.goal.trim() ? form.goal : description,
    workflowTemplateId: form.workflowTemplateId || recommendation.templateId,
    plannerMode,
    projectDescription: form.projectDescription ?? "",
    plannerModelId: form.plannerModelId ?? "",
    planPreviewAccepted: form.planPreviewAccepted ?? false,
    planningMode: plannerModeToPlanningMode(plannerMode),
    intakeAnswers: { ...answers, ...form.intakeAnswers },
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
  const defaultOwner = metadataString(
    metadataObject(nextMilestone?.metadata).pccResponsibility,
    "local_openclaw_agent",
  );
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
  if (!metadataString(nextMetadata.pccResponsibility, "")) {
    nextMetadata.pccResponsibility = "local_openclaw_agent";
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
  if (!metadataString(nextMetadata.pccResponsibility, "")) {
    nextMetadata.pccResponsibility = subMilestone.owner ?? "local_openclaw_agent";
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
  return {
    projectId: detail.project.id,
    goal: autofillGoal(detail),
    intakeAnswers,
    intakeApproved,
    workflowTemplateId: workflow.templateId,
    workflowTitle: workflow.title,
    summary: `PCC drafted missing setup for ${detail.project.title} from existing project context.`,
    milestoneUpdates,
    subMilestoneUpdates,
  };
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
  const averagePercentComplete =
    total === 0
      ? 0
      : Math.round(
          projects.reduce((sum, project) => sum + clampPercent(project.percentComplete), 0) / total,
        );
  const active = projects.filter(
    (project) => !["archived", "complete", "skipped"].includes(project.status),
  ).length;
  return {
    projectsTotal: total,
    active,
    blocked,
    needsApproval,
    complete,
    archived,
    averagePercentComplete,
    nextActions: projects.flatMap((project) => project.nextActions).slice(0, 20),
  };
}

function projectFormFromProject(project: PccProject): PccProjectFormState {
  const metadata = metadataObject(project.metadata);
  return {
    id: project.id,
    title: project.title,
    goal: project.goal ?? "",
    projectDescription: metadataString(metadata.pccProjectDescription, project.goal ?? ""),
    status: project.status,
    priority: String(project.priority ?? 3),
    workflowTemplateId: metadataString(metadata.pccWorkflowTemplateId, "software-product"),
    planningMode: metadataString(metadata.pccPlanningMode, "template_only") as PccPlanningMode,
    plannerMode: metadataString(metadata.pccPlannerMode, "local_project_manager") as PccPlannerMode,
    plannerModelId: metadataString(metadata.pccPlannerModelId, ""),
    planPreviewAccepted: true,
    codexPlanningAllowed: metadataBoolean(metadata.pccCodexPlanningAllowed, false),
    remoteProofAllowed: metadataBoolean(metadata.pccRemoteProofAllowed, false),
    runtimeActionsAllowed: metadataBoolean(metadata.pccRuntimeActionsAllowed, false),
    intakeAnswers: pccIntakeAnswersFromMetadata(metadata),
    intakeApproved: metadataBoolean(metadataObject(metadata.pccIntake).approved, false),
  };
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
    responsibility: metadataString(
      metadataObject(milestone.metadata).pccResponsibility,
      "local_openclaw_agent",
    ),
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

function setupRepairMessage(evaluation: ReturnType<typeof evaluatePccProjectSetup>): string {
  const firstIssue =
    evaluation.missing[0] ??
    evaluation.violations[0] ??
    evaluation.needsReview[0] ??
    "project setup needs review";
  return `Setup needs repair: ${firstIssue}. Review the AI autofill preview or edit manually before starting work.`;
}

async function withPccAction(
  state: PccDashboardState,
  action: () => Promise<void>,
  successMessage?: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    state.pccActionError = "Project Command Center unavailable";
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
      setActionNotice(state, successMessage, "Undo");
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
    const [projectsResult, summaryResult] = await Promise.all([
      state.client.request<PccProjectsListResult>("pcc.projects.list", {}),
      state.client.request<PccSummaryGetResult>("pcc.summary.get", {}),
    ]);
    const projects = Array.isArray(projectsResult.projects)
      ? projectsResult.projects.map(safeProjectSummary)
      : [];
    state.pccProjects = projects;
    state.pccPortfolioSummary = summaryResult.portfolio ?? summarizePortfolio(projects);
    state.pccProjectDetails = state.pccProjectDetail
      ? { ...state.pccProjectDetails, [state.pccProjectDetail.project.id]: state.pccProjectDetail }
      : state.pccProjectDetails;
    state.pccUpdatedAt = Date.now();
  } catch (err) {
    state.pccError = formatConnectError(err) || "Project Command Center unavailable";
  } finally {
    state.pccLoading = false;
    state.requestUpdate?.();
  }
}

export async function selectPccProject(state: PccDashboardState, projectId: string): Promise<void> {
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const detail = await state.client.request<PccProjectsGetResult>("pcc.projects.get", {
      projectId,
    });
    state.pccSelectedProjectId = detail.project.id;
    state.pccProjectDetail = normalizePccProjectDetail(detail);
    state.pccProjectDetails = {
      ...state.pccProjectDetails,
      [detail.project.id]: state.pccProjectDetail,
    };
    refreshPccChatSyncProposals(state);
  });
}

export function openPccProjectEditor(state: PccDashboardState, project?: PccProject): void {
  state.pccEditorMode = project ? "edit-project" : "create-project";
  state.pccProjectForm = project ? projectFormFromProject(project) : { ...EMPTY_PCC_PROJECT_FORM };
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

export function updatePccProjectFilter(state: PccDashboardState, filter: PccProjectFilter): void {
  state.pccProjectFilter = filter;
  state.requestUpdate?.();
}

export function updatePccProjectSearchQuery(state: PccDashboardState, query: string): void {
  state.pccProjectSearchQuery = query;
  state.requestUpdate?.();
}

export function dismissPccActionNotice(state: PccDashboardState): void {
  state.pccActionNotice = null;
  state.requestUpdate?.();
}

export function updatePccProjectForm(
  state: PccDashboardState,
  patch: Partial<PccProjectFormState>,
): void {
  let nextForm = { ...state.pccProjectForm, ...patch };
  if (patch.plannerMode) {
    nextForm.planningMode = plannerModeToPlanningMode(
      patch.plannerMode,
      nextForm.codexPlanningAllowed,
    );
  }
  if (
    patch.projectDescription !== undefined ||
    patch.plannerMode !== undefined ||
    patch.workflowTemplateId !== undefined ||
    patch.title !== undefined ||
    patch.goal !== undefined
  ) {
    nextForm = { ...nextForm, planPreviewAccepted: false };
  }
  if (patch.projectDescription !== undefined || patch.plannerMode !== undefined) {
    nextForm = enrichProjectFormFromDescription(nextForm);
  }
  state.pccProjectForm = nextForm;
  state.requestUpdate?.();
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

export function previewPccSetupAutofill(state: PccDashboardState): void {
  if (!state.pccProjectDetail) {
    state.pccActionError = "Select a project before using setup autofill.";
    state.requestUpdate?.();
    return;
  }
  state.pccAutofillPreview = buildPccSetupAutofillPreview(state.pccProjectDetail, false);
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
  return {
    ...detail.project,
    goal: preview.goal,
    metadata: {
      ...metadataObject(detail.project.metadata),
      pccWorkflowTemplateId: preview.workflowTemplateId,
      pccWorkflowTemplateTitle: preview.workflowTitle,
      pccPlanPreviewAccepted: true,
      pccSetupAutofill: {
        summary: preview.summary,
        appliedAt: now,
        source: "local_project_manager",
      },
      pccIntake: {
        ...existingIntake,
        answers: preview.intakeAnswers,
        approved: preview.intakeApproved,
        ...(preview.intakeApproved ? { approvedAt: now } : {}),
        missingQuestionIds,
        status: preview.intakeApproved ? "approved" : "needs_review",
      },
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
    const evaluation = evaluatePccProjectSetup({
      project: projectBase,
      milestones: patchedMilestones,
      subMilestones: patchedSubMilestones,
    });
    const projectForUpsert = withPccPhase2Metadata(projectBase, evaluation, now);
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload(projectForUpsert),
    });
    for (const milestone of patchedMilestones.filter((item) =>
      preview.milestoneUpdates.some((update) => update.id === item.id),
    )) {
      await state.client.request("pcc.milestones.upsert", { milestone });
    }
    for (const subMilestone of patchedSubMilestones.filter((item) =>
      preview.subMilestoneUpdates.some((update) => update.id === item.id),
    )) {
      await state.client.request("pcc.subMilestones.upsert", { subMilestone });
    }
    state.pccAutofillPreview = null;
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
  });
}

export async function savePccProject(state: PccDashboardState): Promise<void> {
  const form = enrichProjectFormFromDescription(state.pccProjectForm);
  await withPccAction(state, async () => {
    if (!state.client) {
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
    const priority = parseOptionalInteger(form.priority);
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
            ...metadataObject(state.pccProjectDetail?.project.metadata),
            pccWorkflowTemplateId: form.workflowTemplateId,
            pccWorkflowTemplateTitle: recommendedWorkflow.title,
            pccPlanningMode: form.planningMode,
            pccPlannerMode: form.plannerMode,
            pccPlannerModelId: form.plannerModelId,
            pccProjectDescription: form.projectDescription,
            pccPlanPreviewAccepted: form.planPreviewAccepted,
            pccCodexPlanningAllowed: form.codexPlanningAllowed,
            pccRemoteProofAllowed: form.remoteProofAllowed,
            pccRuntimeActionsAllowed: form.runtimeActionsAllowed,
            pccIntake: intakeMetadata,
          },
        }
      : {
          ...draft!.project,
          metadata: {
            ...metadataObject(draft!.project.metadata),
            pccWorkflowTemplateId: form.workflowTemplateId,
            pccWorkflowTemplateTitle: recommendedWorkflow.title,
            pccPlanningMode: form.planningMode,
            pccPlannerMode: form.plannerMode,
            pccPlannerModelId: form.plannerModelId,
            pccProjectDescription: form.projectDescription,
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
      project: projectForUpsert,
    });
    if (draft && !form.id) {
      for (const milestone of draft.milestones) {
        const created = await state.client.request<{ milestone: PccMilestone }>(
          "pcc.milestones.upsert",
          { milestone: { ...milestone, projectId: result.project.id } },
        );
        for (const subMilestone of draft.subMilestonesByMilestoneTitle[milestone.title] ?? []) {
          await state.client.request("pcc.subMilestones.upsert", {
            subMilestone: {
              ...subMilestone,
              projectId: result.project.id,
              milestoneId: created.milestone.id,
            },
          });
        }
      }
      if (
        (form.plannerMode === "codex" || form.plannerMode === "high_reasoning_codex") &&
        !form.codexPlanningAllowed
      ) {
        await state.client.request("pcc.permissions.upsert", {
          permission: {
            projectId: result.project.id,
            type:
              form.plannerMode === "high_reasoning_codex" ? "high_reasoning_model" : "codex_usage",
            status: "needed",
            riskLevel: form.plannerMode === "high_reasoning_codex" ? "high" : "medium",
            allowedActions: [
              `Use ${plannerResponsibility(form.plannerMode)} to refine generated milestones and sub-milestones`,
            ],
            forbiddenActions: ["Spend Codex or high-reasoning tokens without separate permission"],
            target: "Project intake milestone planning",
            maxUses: 1,
            note: "Codex planning is blocked until the user grants this scoped permission.",
          },
        });
      }
    }
    state.pccEditorMode = null;
    await loadPccDashboard(state);
    await selectPccProject(state, result.project.id);
  });
}

export async function setPccProjectStatus(
  state: PccDashboardState,
  project: PccProject,
  status: PccStatus,
): Promise<void> {
  state.pccProjectForm = { ...projectFormFromProject(project), status };
  await savePccProject(state);
}

export async function savePccMilestone(state: PccDashboardState): Promise<void> {
  const form = state.pccMilestoneForm;
  await withPccAction(state, async () => {
    if (!state.client || !form.projectId) {
      return;
    }
    await state.client.request("pcc.milestones.upsert", {
      milestone: {
        ...(form.id ? { id: form.id } : {}),
        projectId: form.projectId,
        title: form.title.trim(),
        status: form.status,
        ...(form.phaseId.trim() ? { phaseId: form.phaseId.trim() } : {}),
        ...(parseOptionalInteger(form.order) !== undefined
          ? { order: parseOptionalInteger(form.order) }
          : {}),
        ...(parseOptionalPercent(form.percentComplete) !== undefined
          ? { percentComplete: parseOptionalPercent(form.percentComplete) }
          : {}),
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
      },
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
      milestone: {
        ...milestone,
        metadata: {
          ...metadataObject(milestone.metadata),
          pccStopHere: stopHere,
        },
      },
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
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const normalizedStatus: PccStatus = status === "reopened" ? "not_started" : status;
      const milestoneUpdate = itemWithStatusMetadata(milestone, normalizedStatus, note);
      await state.client.request("pcc.milestones.upsert", { milestone: milestoneUpdate });
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
            subMilestone: itemWithStatusMetadata(subMilestone, childStatus, note),
          });
        }
      }
      await loadPccDashboard(state);
      await selectPccProject(state, milestone.projectId);
    },
    `Saved: ${milestone.title} is now ${status.replace(/_/gu, " ")}.`,
  );
}

export async function setPccSubMilestoneStatus(
  state: PccDashboardState,
  subMilestone: PccSubMilestone,
  status: PccStatus,
  note?: string,
): Promise<void> {
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const normalizedStatus: PccStatus = status === "reopened" ? "not_started" : status;
      await state.client.request("pcc.subMilestones.upsert", {
        subMilestone: itemWithStatusMetadata(subMilestone, normalizedStatus, note),
      });
      await loadPccDashboard(state);
      await selectPccProject(state, subMilestone.projectId);
    },
    `Saved: ${subMilestone.title} is now ${status.replace(/_/gu, " ")}.`,
  );
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
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const ordered = detail.milestones.filter((item) => item.id !== source.id);
      const targetIndex = ordered.findIndex((item) => item.id === target.id);
      if (targetIndex < 0) {
        throw new Error("Target milestone was not found.");
      }
      ordered.splice(targetIndex, 0, source);
      for (const [index, milestone] of ordered.entries()) {
        const nextOrder = (index + 1) * 10;
        if (milestone.order !== nextOrder) {
          await state.client.request("pcc.milestones.upsert", {
            milestone: { ...milestone, order: nextOrder },
          });
        }
      }
      await loadPccDashboard(state);
      await selectPccProject(state, source.projectId);
    },
    `Saved new milestone order for ${source.title}.`,
  );
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
  await withPccAction(
    state,
    async () => {
      if (!state.client) {
        return;
      }
      const siblings = (detail.subMilestones ?? [])
        .filter((item) => item.milestoneId === source.milestoneId)
        .filter((item) => item.id !== source.id);
      const targetIndex = siblings.findIndex((item) => item.id === target.id);
      if (targetIndex < 0) {
        throw new Error("Target sub-milestone was not found.");
      }
      siblings.splice(targetIndex, 0, source);
      for (const [index, subMilestone] of siblings.entries()) {
        const nextOrder = (index + 1) * 10;
        if (subMilestone.order !== nextOrder) {
          await state.client.request("pcc.subMilestones.upsert", {
            subMilestone: { ...subMilestone, order: nextOrder },
          });
        }
      }
      await loadPccDashboard(state);
      await selectPccProject(state, source.projectId);
    },
    `Saved new sub-step order for ${source.title}.`,
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
        milestone: {
          ...existing,
          ...proposal.milestonePatch,
          metadata: {
            ...metadataObject(existing?.metadata),
            ...metadataObject(proposal.milestonePatch.metadata),
          },
        },
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

function projectUpsertPayload(project: PccProject): {
  id: string;
  title: string;
  goal?: string;
  status: PccStatus;
  owner?: string;
  priority?: number;
  phases?: PccProject["phases"];
  metadata?: PccProject["metadata"];
} {
  return {
    id: project.id,
    title: project.title,
    ...(project.goal !== undefined ? { goal: project.goal } : {}),
    status: project.status,
    ...(project.owner !== undefined ? { owner: project.owner } : {}),
    ...(project.priority !== undefined ? { priority: project.priority } : {}),
    ...(project.phases !== undefined ? { phases: project.phases } : {}),
    ...(project.metadata !== undefined ? { metadata: project.metadata } : {}),
  };
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
    const setupEvaluation = evaluatePccProjectSetup({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones ?? [],
    });
    if (patch.enabled === true && !setupEvaluation.runnable) {
      state.pccAutofillPreview = buildPccSetupAutofillPreview(detail, false);
      state.pccActionError = setupRepairMessage(setupEvaluation);
      return;
    }
    const updatedProject = withPccWorkLoopSettings(detail.project, patch, new Date().toISOString());
    await state.client.request("pcc.projects.upsert", {
      project: projectUpsertPayload(updatedProject),
    });
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
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
    const setupEvaluation = evaluatePccProjectSetup({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones ?? [],
    });
    if (!setupEvaluation.runnable) {
      state.pccAutofillPreview = buildPccSetupAutofillPreview(detail, false);
      state.pccActionError = setupRepairMessage(setupEvaluation);
      return;
    }
    const next = getPccWorkLoopNext({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones,
      permissions: detail.permissions,
      receipts: detail.receipts,
    });
    const updatedProject = withPccWorkLoopSettings(
      detail.project,
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
        subMilestone: {
          ...next.subMilestone,
          status: "in_progress",
        },
      });
    } else if (next.milestone && !next.blocker && next.milestone.status !== "in_progress") {
      await state.client.request("pcc.milestones.upsert", {
        milestone: {
          ...next.milestone,
          status: "in_progress",
        },
      });
    }
    await loadPccDashboard(state);
    await selectPccProject(state, detail.project.id);
  });
}

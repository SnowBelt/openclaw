import {
  evaluatePccProjectSetup,
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

export type PccProjectFormState = {
  id: string | null;
  title: string;
  goal: string;
  status: PccStatus;
  priority: string;
  workflowTemplateId: string;
  planningMode: PccPlanningMode;
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
  pccEditorMode: PccEditorMode;
  pccProjectForm: PccProjectFormState;
  pccMilestoneForm: PccMilestoneFormState;
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
  status: "active",
  priority: "3",
  workflowTemplateId: "software-product",
  planningMode: "template_only",
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
    status: project.status,
    priority: String(project.priority ?? 3),
    workflowTemplateId: metadataString(metadata.pccWorkflowTemplateId, "software-product"),
    planningMode: metadataString(metadata.pccPlanningMode, "template_only") as PccPlanningMode,
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
}

async function withPccAction(state: PccDashboardState, action: () => Promise<void>): Promise<void> {
  if (!state.client || !state.connected) {
    state.pccActionError = "Project Command Center unavailable";
    state.requestUpdate?.();
    return;
  }
  state.pccActionBusy = true;
  state.pccActionError = null;
  state.requestUpdate?.();
  try {
    await action();
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

export function updatePccProjectForm(
  state: PccDashboardState,
  patch: Partial<PccProjectFormState>,
): void {
  state.pccProjectForm = { ...state.pccProjectForm, ...patch };
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

export async function savePccProject(state: PccDashboardState): Promise<void> {
  const form = state.pccProjectForm;
  await withPccAction(state, async () => {
    if (!state.client) {
      return;
    }
    const intakeMissing = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
    if (!form.id && (intakeMissing.length > 0 || !form.intakeApproved)) {
      state.pccActionError = intakeMissing.length
        ? "Required project intake answers are missing."
        : "Project intake must be approved before setup can be saved.";
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
      if (form.planningMode === "codex_full_plan" && !form.codexPlanningAllowed) {
        await state.client.request("pcc.permissions.upsert", {
          permission: {
            projectId: result.project.id,
            type: "codex_usage",
            status: "needed",
            riskLevel: "medium",
            allowedActions: ["Use Codex to refine generated milestones and sub-milestones"],
            forbiddenActions: ["Spend high-reasoning tokens without separate permission"],
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

export async function setPccMilestoneStatus(
  state: PccDashboardState,
  milestone: PccMilestone,
  status: PccStatus,
): Promise<void> {
  state.pccMilestoneForm = { ...milestoneFormFromMilestone(milestone), status };
  await savePccMilestone(state);
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
      state.pccActionError = `Project setup quality gate is ${setupEvaluation.badge.toLowerCase()}; complete intake and workflow requirements before starting work.`;
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
      state.pccActionError = `Project setup quality gate is ${setupEvaluation.badge.toLowerCase()}; complete intake and workflow requirements before preparing work.`;
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

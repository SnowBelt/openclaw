import {
  configurePccAutopilotMode,
  generatePccAutopilotPromptSlots,
  getPccAutopilotState,
  runPccAutopilotSafeStubSet,
  transitionPccAutopilotState,
  updatePccAutopilotPromptSlot,
  withPccAutopilotState,
  type PccAutopilotModeId,
  type PccAutopilotPromptSlot,
} from "../../../../src/pcc/autopilot.js";
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
  pccResponsibilityForItem,
} from "../../../../src/pcc/metadata.js";
import {
  buildPccWorkflowDraft,
  type PccPlanningMode,
} from "../../../../src/pcc/project-workflows.js";
// Control UI controller loads and edits Project Command Center ledger entries.
import {
  getPccWorkLoopSettings,
  getPccWorkLoopNext,
  withPccWorkLoopSettings,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import { buildPccWorkStartBlockers } from "../../../../src/pcc/work-start.js";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { buildPccChatSyncProposals, type PccChatSyncProposal } from "../pcc-chat-sync.ts";
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
} from "../types.ts";

export type PccProjectDetail = {
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

export type PccEditorMode =
  | "create-project"
  | "edit-project"
  | "create-milestone"
  | "edit-milestone"
  | null;

export type PccViewMode = "simple" | "detailed" | "agent";

export type PccProjectEditMode = "simple" | "advanced" | "ai";

export type PccAiRegenerateSection =
  | "goal"
  | "intake"
  | "workflow"
  | "milestones"
  | "submilestones"
  | "criteria"
  | "proof"
  | "permissions"
  | "blockers"
  | "handoff";

export type PccPlannerMode =
  | "best_available"
  | "local_project_manager"
  | "local_model"
  | "codex"
  | "high_reasoning_codex";

export type PccProjectFilter = "active" | "needs_you" | "on_hold" | "archived" | "all";
export type PccAutopilotAction = "start" | "pause" | "resume" | "stop" | "block" | "judge";

export type PccActionNotice = {
  kind: "success" | "info";
  text: string;
  undoLabel?: string;
};

export type PccUndoAction = {
  label: string;
  run: () => Promise<void>;
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
  generatedMilestones?: Array<{ title: string; fields: string[]; subMilestoneTitles: string[] }>;
  generatedSubMilestones?: Array<{
    milestoneId: string;
    milestoneTitle: string;
    title: string;
    fields: string[];
  }>;
  section?: PccAiRegenerateSection;
  sectionTitle?: string;
};

export type PccProjectFormState = {
  id: string | null;
  title: string;
  goal: string;
  projectDescription: string;
  status: PccStatus;
  priority: string;
  dueDate: string;
  outcomeMetrics: string;
  workflowTemplateId: string;
  planningMode: PccPlanningMode;
  plannerMode: PccPlannerMode;
  plannerModelId: string;
  plannerPermissionScope: "plan" | "project" | "ask";
  plannerPermissionBudget: string;
  planPreviewAccepted: boolean;
  codexPlanningAllowed: boolean;
  remoteProofAllowed: boolean;
  runtimeActionsAllowed: boolean;
  intakeAnswers: Record<string, string>;
  intakeApproved: boolean;
};

export type PccDecisionFormState = {
  title: string;
  summary: string;
  rationale: string;
  impact: string;
  milestoneId: string;
  subMilestoneId: string;
  evidenceIds: string;
  decidedBy: string;
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
  pccProjectEditMode?: PccProjectEditMode;
  pccLastUndoAction?: PccUndoAction | null;
  pccEditorMode: PccEditorMode;
  pccProjectForm: PccProjectFormState;
  pccMilestoneForm: PccMilestoneFormState;
  pccDecisionFormOpen?: boolean;
  pccDecisionForm: PccDecisionFormState;
  pccAutofillPreview?: PccAutofillPreview | null;
  pccChatSyncText: string;
  pccChatSyncProposals: PccChatSyncProposal[];
  pccChatSyncError: string | null;
  pccViewMode: PccViewMode;
  pccProductFocusMode?: "pcc_product" | "project_work";
  pccReorderMode?: boolean;
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

const PCC_TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

export const EMPTY_PCC_PROJECT_FORM: PccProjectFormState = {
  id: null,
  title: "",
  goal: "",
  projectDescription: "",
  status: "active",
  priority: "3",
  dueDate: "",
  outcomeMetrics: "",
  workflowTemplateId: "software-product",
  planningMode: "local_project_manager",
  plannerMode: "best_available",
  plannerModelId: "",
  plannerPermissionScope: "plan",
  plannerPermissionBudget: "",
  planPreviewAccepted: false,
  codexPlanningAllowed: false,
  remoteProofAllowed: false,
  runtimeActionsAllowed: false,
  intakeAnswers: {},
  intakeApproved: false,
};

export const EMPTY_PCC_DECISION_FORM: PccDecisionFormState = {
  title: "",
  summary: "",
  rationale: "",
  impact: "",
  milestoneId: "",
  subMilestoneId: "",
  evidenceIds: "",
  decidedBy: "",
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
  const stale = projects.filter((project) => {
    if (terminalStatuses.has(project.status)) {
      return false;
    }
    const updated = Date.parse(project.updatedAt);
    return Number.isFinite(updated) && now - updated > 14 * 24 * 60 * 60 * 1_000;
  }).length;
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
        (!terminalStatuses.has(project.status) &&
          Number.isFinite(Date.parse(project.updatedAt)) &&
          now - Date.parse(project.updatedAt) > 14 * 24 * 60 * 60 * 1_000)),
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

function projectFormFromProject(project: PccProject): PccProjectFormState {
  const metadata = metadataObject(project.metadata);
  return {
    id: project.id,
    title: project.title,
    goal: project.goal ?? "",
    projectDescription: metadataString(metadata.pccProjectDescription, project.goal ?? ""),
    status: project.status,
    priority: String(project.priority ?? 3),
    dueDate: metadataDateInput(metadata.dueDate ?? metadata.pccDueDate),
    outcomeMetrics: outcomeMetricsText(metadata.pccOutcomeMetrics),
    workflowTemplateId: metadataString(metadata.pccWorkflowTemplateId, "software-product"),
    planningMode: metadataString(metadata.pccPlanningMode, "template_only") as PccPlanningMode,
    plannerMode: metadataString(metadata.pccPlannerMode, "local_project_manager") as PccPlannerMode,
    plannerModelId: metadataString(metadata.pccPlannerModelId, ""),
    plannerPermissionScope: metadataString(
      metadataObject(metadata.pccPlannerPermission).scope,
      "plan",
    ) as "plan" | "project" | "ask",
    plannerPermissionBudget: metadataString(
      metadataObject(metadata.pccPlannerPermission).budget,
      "",
    ),
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
    const pccProjectSummary = projects.find((project) => project.id === "project-command-center");
    if (pccProjectSummary && !state.pccProjectDetails[pccProjectSummary.id]) {
      try {
        const detail = await state.client.request<PccProjectsGetResult>("pcc.projects.get", {
          projectId: pccProjectSummary.id,
        });
        const normalized = normalizePccProjectDetail(detail);
        state.pccProjectDetails = {
          ...state.pccProjectDetails,
          [normalized.project.id]: normalized,
        };
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
        } else {
          try {
            const detail = await state.client.request<PccProjectsGetResult>("pcc.projects.get", {
              projectId: preferredSummary.id,
            });
            const normalized = normalizePccProjectDetail(detail);
            state.pccSelectedProjectId = normalized.project.id;
            state.pccProjectDetail = normalized;
            state.pccProjectDetails = {
              ...state.pccProjectDetails,
              [normalized.project.id]: normalized,
            };
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

export async function selectPccProject(state: PccDashboardState, projectId: string): Promise<void> {
  if (!state.client) {
    state.pccActionError =
      "Project Command Center is offline or disconnected. Project details could not be loaded.";
    state.requestUpdate?.();
    return;
  }
  state.pccActionError = null;
  state.pccSelectedProjectId = projectId;
  const cached = state.pccProjectDetails?.[projectId];
  if (cached) {
    state.pccProjectDetail = cached;
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
    state.pccProjectDetails = {
      ...state.pccProjectDetails,
      [detail.project.id]: state.pccProjectDetail,
    };
    refreshPccChatSyncProposals(state);
  } catch (err) {
    setActionError(state, err);
  } finally {
    state.requestUpdate?.();
  }
}

export function openPccProjectEditor(state: PccDashboardState, project?: PccProject): void {
  state.pccEditorMode = project ? "edit-project" : "create-project";
  state.pccProjectEditMode = "simple";
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
  state.requestUpdate?.();
}

export function updatePccProjectSearchQuery(state: PccDashboardState, query: string): void {
  state.pccProjectSearchQuery = query;
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
            pccPlannerPermission: {
              allowed: form.codexPlanningAllowed,
              scope: form.plannerPermissionScope,
              budget: form.plannerPermissionBudget,
            },
            pccProjectDescription: form.projectDescription,
            pccOutcomeMetrics: outcomeMetrics,
            ...(dueDate
              ? { dueDate, pccDueDate: dueDate }
              : { dueDate: undefined, pccDueDate: undefined }),
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
            pccPlannerPermission: {
              allowed: form.codexPlanningAllowed,
              scope: form.plannerPermissionScope,
              budget: form.plannerPermissionBudget,
            },
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
  orderedIds: readonly string[],
  sourceId: string,
  targetId: string,
  dependsOn: readonly string[] | undefined,
): string | null {
  const nextIds = orderedIds.filter((id) => id !== sourceId);
  const targetIndex = nextIds.indexOf(targetId);
  if (targetIndex < 0) {
    return "Target item was not found.";
  }
  nextIds.splice(targetIndex, 0, sourceId);
  const sourceIndex = nextIds.indexOf(sourceId);
  const blockingDependency = (dependsOn ?? []).find((id) => {
    const dependencyIndex = nextIds.indexOf(id);
    return dependencyIndex >= 0 && dependencyIndex > sourceIndex;
  });
  return blockingDependency
    ? `Cannot move before dependency ${blockingDependency}. Reorder or remove the dependency first.`
    : null;
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
    orderedMilestoneSequenceItems(detail).map((item) => item.id),
    source.id,
    target.id,
    source.dependsOn,
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
  const siblingIds = orderedSubMilestoneSequenceItems(detail, source.milestoneId).map(
    (item) => item.id,
  );
  const dependencyBlocker = dependencyMoveBlocker(
    siblingIds,
    source.id,
    target.id,
    source.dependsOn,
  );
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
    const siblings = (detail.subMilestones ?? [])
      .filter((item) => item.milestoneId === source.milestoneId)
      .filter((item) => item.id !== source.id);
    const targetIndex = siblings.findIndex((item) => item.id === target.id);
    if (targetIndex < 0) {
      throw new Error("Target sub-milestone was not found.");
    }
    siblings.splice(targetIndex, 0, source);
    const changed = siblings
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
    const next = configurePccAutopilotMode(input, current, mode, now);
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
    const input = autopilotInputForDetail(detail);
    const current = getPccAutopilotState(input, now);
    const next = {
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
    };
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
    const next =
      action === "start"
        ? runPccAutopilotSafeStubSet(input, { ...current, status: "running", updatedAt: now }, now)
        : action === "judge"
          ? { ...current, finalReport: current.finalReport, updatedAt: now }
          : transitionPccAutopilotState(current, action, now);
    await savePccAutopilotStateForDetail(state, detail, next);
    setActionNotice(
      state,
      action === "start"
        ? "Autopilot safe loop ran and saved history. Live execution remains blocked until separately approved."
        : `Autopilot ${action} saved.`,
    );
  });
}

type PccProjectUpsertInput = Partial<PccProject> & Pick<PccProject, "title">;

type PccMilestoneUpsertInput = Partial<PccMilestone> & Pick<PccMilestone, "projectId" | "title">;

type PccSubMilestoneUpsertInput = Partial<PccSubMilestone> &
  Pick<PccSubMilestone, "projectId" | "milestoneId" | "title">;

function projectUpsertPayload(project: PccProjectUpsertInput): {
  id?: string;
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
      state.pccActionError = setupRepairMessage(setupEvaluation, detail);
      return;
    }
    if (detail.project.status === "on_hold") {
      state.pccActionError =
        "Project is on hold. Use Resume Project before preparing the next safe task.";
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
  });
}

import type { PccExecutionCapacitySnapshot } from "../../../../../src/pcc/execution-capacity.js";
import type { PccExecutionPlan, PccExecutionTask } from "../../../../../src/pcc/execution-plan.js";
import {
  DEFAULT_PCC_EXECUTION_PROFILE,
  type PccExecutionProfile,
} from "../../../../../src/pcc/execution-profile.js";
import type { PccAiUsePolicy, PccPlanningMode } from "../../../../../src/pcc/project-workflows.js";
import type { PccRuntimeIdentity } from "../../../../../src/pcc/runtime-identity.js";
import type { PccUpdateSafety } from "../../../../../src/pcc/update-safety.js";
import type {
  AgentsListResult,
  ModelCatalogEntry,
  PccCompletionReceipt,
  PccDecision,
  PccEvidence,
  PccLastKnownGood,
  PccMilestone,
  PccPermissionGrant,
  PccPortfolioSummary,
  PccProject,
  PccProjectSummary,
  PccStatus,
  PccSubMilestone,
  SkillStatusReport,
} from "../../types.ts";

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

export type PccRequestClient = {
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T>;
};

export type PccChatSyncProposalKind =
  | "add_milestone"
  | "update_milestone"
  | "request_permission"
  | "add_receipt";

export type PccChatSyncProposal = {
  id: string;
  kind: PccChatSyncProposalKind;
  title: string;
  summary: string;
  risky: boolean;
  milestoneId?: string;
  milestonePatch?: Partial<PccMilestone> & Pick<PccMilestone, "projectId" | "title">;
  permission?: Partial<PccPermissionGrant> &
    Pick<PccPermissionGrant, "projectId" | "type" | "status" | "riskLevel" | "allowedActions">;
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
export type PccAutopilotAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "block"
  | "judge"
  | "allow_low_risk"
  | "allow_medium_risk"
  | "allow_high_risk"
  | "deny_permission"
  | "revoke_permission_grant"
  | "expire_permission_grant"
  | "apply_permission_repair";

export type PccExecutionTeamAction = "start" | "stop";

export type PccExecutionTeamReadiness = {
  status: "focused" | "ready" | "running" | "blocked" | "needs_approval";
  reason: string;
  profile: PccExecutionProfile;
  activePlan: PccExecutionPlan | null;
  tasks: PccExecutionTask[];
  admittedLocalAgents: number;
  codexAgents: 0 | 1;
  coordinatorAgentId: string | null;
  workerModelId: string | null;
  codexModelId: string | null;
};

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
  aiUsePolicy: PccAiUsePolicy;
  plannerModelId: string;
  plannerPermissionScope: "plan" | "project" | "ask";
  /** Legacy read-only field. New PCC flows use qualitative usage guidance, never token caps. */
  plannerPermissionBudget: string;
  planPreviewAccepted: boolean;
  codexPlanningAllowed: boolean;
  remoteProofAllowed: boolean;
  runtimeActionsAllowed: boolean;
  executionProfile: PccExecutionProfile;
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
  client: PccRequestClient | null;
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
  pccRuntimeIdentity?: PccRuntimeIdentity | null;
  pccUpdateSafety?: PccUpdateSafety | null;
  pccExecutionCapacity?: PccExecutionCapacitySnapshot | null;
  agentsList?: AgentsListResult | null;
  chatModelCatalog?: ModelCatalogEntry[];
  skillsReport?: SkillStatusReport | null;
  requestUpdate?: () => void;
};

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
  aiUsePolicy: "local_only",
  plannerModelId: "",
  plannerPermissionScope: "project",
  plannerPermissionBudget: "",
  planPreviewAccepted: false,
  codexPlanningAllowed: false,
  remoteProofAllowed: false,
  runtimeActionsAllowed: false,
  executionProfile: { ...DEFAULT_PCC_EXECUTION_PROFILE },
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

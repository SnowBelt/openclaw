import type {
  PccAutopilotAction,
  PccAutopilotModeId,
  PccAutopilotPromptSlot,
} from "../../../../src/pcc/autopilot.js";
import type { PccExecutionCapacitySnapshot } from "../../../../src/pcc/execution-capacity.js";
import type { PccExecutionPlan, PccExecutionTask } from "../../../../src/pcc/execution-plan.js";
import type { PccExecutionProfile } from "../../../../src/pcc/execution-profile.js";
import type { PccExecutionStandard } from "../../../../src/pcc/execution-standard.js";
import type { PccAiUsePolicy, PccPlanningMode } from "../../../../src/pcc/project-workflows.js";
import type { PccRuntimeIdentity } from "../../../../src/pcc/runtime-identity.js";
import type { PccWorkLoopSettings } from "../../../../src/pcc/work-loop.js";
import type { PccChatSyncProposal } from "../pcc-chat-sync.ts";
import type {
  AgentsListResult,
  ModelCatalogEntry,
  PccCompletionReceipt,
  PccDecision,
  PccEvidence,
  PccLastKnownGood,
  PccMilestone,
  PccPermissionGrant,
  PccPermissionStatus,
  PccPortfolioSummary,
  PccProject,
  PccProjectSummary,
  PccStatus,
  PccSubMilestone,
  SkillStatusReport,
} from "../types.ts";

/** Stable data contract shared by PCC application services and presentation. */
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

/** Minimal Gateway port required by PCC application use cases. */
export type PccGatewayPort = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
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
  executionStandard: PccExecutionStandard;
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
  generatedMilestones?: Array<{
    title: string;
    fields: string[];
    subMilestoneTitles: string[];
  }>;
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

/** Mutable state port owned by the app shell and consumed by PCC use cases. */
export type PccDashboardState = {
  client: PccGatewayPort | null;
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
  pccExecutionCapacity?: PccExecutionCapacitySnapshot | null;
  agentsList?: AgentsListResult | null;
  chatModelCatalog?: ModelCatalogEntry[];
  skillsReport?: SkillStatusReport | null;
  skillsError?: string | null;
  requestUpdate?: () => void;
};

/** Presentation port. The Lit renderer depends on callbacks, never controller implementation. */
export type PccDashboardProps = {
  loading: boolean;
  error: string | null;
  connected?: boolean;
  projects: PccProjectSummary[];
  portfolio: PccPortfolioSummary | null;
  updatedAt: number | null;
  selectedProjectId: string | null;
  projectDetail: PccProjectDetail | null;
  projectDetails?: Record<string, PccProjectDetail>;
  actionBusy: boolean;
  actionError: string | null;
  actionNotice?: PccActionNotice | null;
  projectFilter?: PccProjectFilter;
  projectSearchQuery?: string;
  projectEditMode?: PccProjectEditMode;
  editorMode: PccEditorMode;
  projectForm: PccProjectFormState;
  milestoneForm: PccMilestoneFormState;
  decisionFormOpen?: boolean;
  decisionForm: PccDecisionFormState;
  autofillPreview?: PccAutofillPreview | null;
  chatSyncText: string;
  chatSyncProposals: PccChatSyncProposal[];
  chatSyncError: string | null;
  viewMode?: PccViewMode;
  productFocusMode?: "pcc_product" | "project_work";
  reorderMode?: boolean;
  agentsList?: AgentsListResult | null;
  modelCatalog?: ModelCatalogEntry[];
  modelsLoading?: boolean;
  modelsLastRefreshedAt?: number | null;
  modelsFallback?: boolean;
  runtimeIdentity?: PccRuntimeIdentity | null;
  executionCapacity?: PccExecutionCapacitySnapshot | null;
  skillsReport?: SkillStatusReport | null;
  skillsError?: string | null;
  onRefreshModelCatalog?: () => void;
  onSetViewMode?: (mode: PccViewMode) => void;
  onSetProductFocusMode?: (mode: "pcc_product" | "project_work") => void;
  onSetReorderMode?: (enabled: boolean) => void;
  onSetProjectEditMode?: (mode: PccProjectEditMode) => void;
  onSetProjectFilter?: (filter: PccProjectFilter) => void;
  onSetProjectSearchQuery?: (query: string) => void;
  onDismissActionNotice?: () => void;
  onUndoAction?: () => void;
  onRefresh: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectEditor: (project?: PccProject) => void;
  onOpenMilestoneEditor: (milestone?: PccMilestone) => void;
  onProjectFormChange: (patch: Partial<PccProjectFormState>) => void;
  onMilestoneFormChange: (patch: Partial<PccMilestoneFormState>) => void;
  onSaveProject: () => void;
  onSaveMilestone: () => void;
  onOpenDecisionForm?: () => void;
  onDecisionFormChange?: (patch: Partial<PccDecisionFormState>) => void;
  onSaveDecision?: () => void;
  onCancelDecisionForm?: () => void;
  onCancelEditor: () => void;
  onSetProjectStatus: (project: PccProject, status: PccStatus) => void;
  onSetMilestoneStatus: (milestone: PccMilestone, status: PccStatus, note?: string) => void;
  onSetMilestoneStopHere: (milestone: PccMilestone, stopHere: boolean) => void;
  onMoveMilestoneBefore?: (source: PccMilestone, target: PccMilestone) => void;
  onMoveSubMilestoneBefore?: (source: PccSubMilestone, target: PccSubMilestone) => void;
  onNormalizeProjectSequence?: () => void;
  onRemoveStaleDependencies?: () => void;
  onRepairDuplicateTitles?: () => void;
  onSetSubMilestoneStatus?: (
    subMilestone: PccSubMilestone,
    status: PccStatus,
    note?: string,
  ) => void;
  onAddCompletionReceipt: (milestone: PccMilestone) => void;
  onSetPermissionStatus: (permission: PccPermissionGrant, status: PccPermissionStatus) => void;
  onUpdateWorkLoop: (patch: Partial<PccWorkLoopSettings>) => void;
  onPrepareNextWorkItem: () => void;
  onResumeProject?: () => void;
  onPreviewSetupAutofill?: () => void;
  onPreviewSectionAutofill?: (section: PccAiRegenerateSection) => void;
  onApplySetupAutofill?: () => void;
  onApproveSetupAutofill?: () => void;
  onDismissSetupAutofill?: () => void;
  onSetAutofillApproval?: (approved: boolean) => void;
  onConfigureAutopilotMode?: (mode: PccAutopilotModeId) => void;
  onGenerateAutopilotPrompts?: () => void;
  onUpdateAutopilotPrompt?: (slotId: string, patch: Partial<PccAutopilotPromptSlot>) => void;
  onRunAutopilotAction?: (action: PccAutopilotAction) => void;
  onRunExecutionTeam?: (action: PccExecutionTeamAction) => void;
  onChatSyncTextChange: (text: string) => void;
  onPreviewChatSync: () => void;
  onApplyChatSyncProposal: (proposal: PccChatSyncProposal) => void;
  onDismissChatSync: () => void;
};

export type { PccAutopilotAction } from "../../../../src/pcc/autopilot.js";

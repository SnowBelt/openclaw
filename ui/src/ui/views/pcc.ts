// Control UI view renders the Project Command Center dashboard and CRUD shell.
import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import {
  autopilotStatusLabel,
  buildPccAutopilotPermissionForecast,
  getPccAutopilotState,
  PCC_AUTOPILOT_MODES,
  type PccAutopilotAction,
  type PccAutopilotModeId,
  type PccAutopilotPromptSlot,
} from "../../../../src/pcc/autopilot.js";
import { isPccCompleteStatus } from "../../../../src/pcc/domain/completion-policy.js";
import type { PccExecutionCapacitySnapshot } from "../../../../src/pcc/execution-capacity.js";
import { isPccExecutionPlanActive } from "../../../../src/pcc/execution-plan.js";
import {
  PCC_BEST_AVAILABLE_MODEL_ID,
  applyPccCodexPolicy,
  applyPccLocalExecutionPreset,
  normalizePccExecutionProfile,
  resolvePccEstimatedAgentCounts,
  summarizePccExecutionProfile,
  updatePccCodexCheckpoint,
  type PccCodexCheckpointId,
  type PccCodexCheckpointMode,
  type PccCodexPolicyId,
  type PccExecutionSpeed,
  type PccExecutionProfile,
} from "../../../../src/pcc/execution-profile.js";
import type { PccExecutionRuntimeProjection } from "../../../../src/pcc/execution-state-projection.js";
import {
  buildPccAttentionInbox,
  buildPccDependencyInsights,
  buildPccIntegrityFindings,
  buildPccMilestoneReadiness,
  buildPccProofFreshness,
  buildPccRecoveryPlaybooks,
  buildPccTimeline,
  previewPccProjectImport,
  type PccImpactDetailInput,
} from "../../../../src/pcc/impact-milestones.js";
import {
  evaluatePccProjectSetup,
  PCC_REQUIRED_INTAKE_QUESTIONS,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
} from "../../../../src/pcc/intake-quality.js";
import {
  pccResponsibilityForItem,
  pccWorkScopeForProject,
  pccWorkScopeLabel,
} from "../../../../src/pcc/metadata.js";
import {
  buildPccOperationalMetrics,
  type PccOperationalMetrics,
} from "../../../../src/pcc/operational-metrics.js";
import {
  PCC_CODEX_PLANNER_MODEL,
  PCC_LOCAL_PLANNER_MODEL,
  type PccPlanningPolicy,
} from "../../../../src/pcc/planning.js";
import { buildPccPortfolioSchedule } from "../../../../src/pcc/portfolio-scheduler.js";
import { buildPccProductionTruth } from "../../../../src/pcc/production-truth.js";
import {
  resolvePccProjectAction as resolveCanonicalPccProjectAction,
  type PccProjectActionResolution,
} from "../../../../src/pcc/project-action.js";
import {
  buildPccWorkflowDraft,
  PCC_WORKFLOW_TEMPLATES,
} from "../../../../src/pcc/project-workflows.js";
import { PCC_BROWSER_CONTRACT_VERSION } from "../../../../src/pcc/release-governance/browser-proof-contract.js";
import type { ReleaseGovernanceStatus } from "../../../../src/pcc/release-governance/contracts.js";
import type { PccRuntimeIdentity } from "../../../../src/pcc/runtime-identity.js";
import type { PccUpdateSafety } from "../../../../src/pcc/update-safety.js";
import {
  getPccWorkLoopNext,
  getPccWorkLoopSettings,
  type PccParallelWorkMode,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import { buildPccWorkStartBlockers } from "../../../../src/pcc/work-start.js";
import { t } from "../../i18n/index.ts";
import { buildQualifiedChatModelValue } from "../chat-model-ref.ts";
import type { IssueChatDescriptor } from "../issue-chat.ts";
import type { PccChatSyncProposal } from "../pcc-chat-sync.ts";
import { buildPccContextPackage, type PccContextPackageMode } from "../pcc-context-package.ts";
import {
  buildPccExecutionTeamReadiness,
  executionPlansFromProject,
  isPccLocalCatalogModel,
} from "../pcc/application/execution-readiness.ts";
import type {
  PccActionNotice,
  PccAttachmentDraft,
  PccAiRegenerateSection,
  PccAutofillPreview,
  PccDecisionFormState,
  PccEditorMode,
  PccExecutionTeamAction,
  PccMilestoneFormState,
  PccProjectDetail,
  PccProjectEditMode,
  PccPlannerMode,
  PccProjectFilter,
  PccProjectFormState,
  PccSurface,
  PccViewMode,
} from "../pcc/application/state.ts";
import {
  formatPccProjectDate as formatProjectDate,
  formatPccStatus as formatStatus,
  formatPccUpdatedAt as formatUpdatedAt,
} from "../pcc/presentation/formatters.ts";
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
  PccProjectSummary,
  PccStatus,
  ModelCatalogEntry,
  AgentsListResult,
} from "../types.ts";
import {
  PCC_INTERACTION_CONTRACTS,
  buildPccExecutionReadiness,
  buildPccUniversalPreflight,
  pccInteractionContractCoverage,
  permissionSummary,
} from "./pcc-operational-confidence.ts";

export type PccDashboardProps = {
  loading: boolean;
  error: string | null;
  connected?: boolean;
  projects: PccProjectSummary[];
  portfolio: PccPortfolioSummary | null;
  overview?: PccOverviewGetResult | null;
  presence?: PccPresenceEntry[];
  surface?: PccSurface;
  favorites?: string[];
  recentProjectIds?: string[];
  attentionRecordId?: string | null;
  updatedAt: number | null;
  selectedProjectId: string | null;
  projectDetail: PccProjectDetail | null;
  projectDetails?: Record<string, PccProjectDetail>;
  actionBusy: boolean;
  planningRun?: PccPlanningRun | null;
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
  updateSafety?: PccUpdateSafety | null;
  releaseGovernance?: ReleaseGovernanceStatus | null;
  executionCapacity?: PccExecutionCapacitySnapshot | null;
  planningPolicy?: PccPlanningPolicy;
  privateTeamPolicy?: PccPrivateTeamPolicy;
  executionProjection?: PccExecutionRuntimeProjection | null;
  executionProjectionLoading?: boolean;
  executionProjectionError?: string | null;
  onRefreshModelCatalog?: () => void;
  onSetCodexPlanningEnabled?: (enabled: boolean) => void;
  onSetViewMode?: (mode: PccViewMode) => void;
  onSetProductFocusMode?: (mode: "pcc_product" | "project_work") => void;
  onSetReorderMode?: (enabled: boolean) => void;
  onSetProjectEditMode?: (mode: PccProjectEditMode) => void;
  onSetProjectFilter?: (filter: PccProjectFilter) => void;
  onSetProjectSearchQuery?: (query: string) => void;
  onDismissActionNotice?: () => void;
  onUndoAction?: () => void;
  onRefresh: () => void;
  onSetSurface?: (surface: PccSurface) => void;
  onToggleFavorite?: (projectId: string) => void;
  onOpenAttention?: (projectId: string, recordId?: string) => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectEditor: (project?: PccProject) => void;
  onOpenMilestoneEditor: (milestone?: PccMilestone) => void;
  onProjectFormChange: (patch: Partial<PccProjectFormState>) => void;
  onGenerateProjectPlan?: () => void;
  onCancelProjectPlan?: () => void;
  onLoadAttachments?: () => void;
  onClarifyAttachmentInstructions?: (input: {
    originalName: string;
    role: PccAttachment["role"];
    instructions: string;
  }) => Promise<{
    clarifiedInstructions: string;
    provenance: { provider: string; model: string; generatedAt: string };
  }>;
  onUploadAttachment?: (file: File, draft: PccAttachmentDraft) => void;
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
  onStartExecution?: () => void;
  onPauseExecution?: () => void;
  onResumeExecution?: () => void;
  onStopExecution?: () => void;
  onReviewExecutionProofCandidate?: (candidateId: string, decision: "accept" | "reject") => void;
  onPrepareNextWorkItem: () => void;
  onResumeProject?: () => void;
  onStartIssueChat?: (descriptor: IssueChatDescriptor) => void;
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

function attachmentRoleLabel(role: PccAttachment["role"]): string {
  return {
    requirement: "Requirement",
    reference: "Reference",
    example: "Example",
    proof: "Proof",
    deliverable: "Deliverable",
  }[role];
}

function submitPccAttachment(event: Event, props: PccDashboardProps): void {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const fileInput = form.elements.namedItem("attachmentFile");
  const roleInput = form.elements.namedItem("attachmentRole");
  const targetInput = form.elements.namedItem("attachmentTarget");
  const instructionsInput = form.elements.namedItem("attachmentInstructions");
  const modelAccessInput = form.elements.namedItem("attachmentModelAccess");
  const sensitivityInput = form.elements.namedItem("attachmentSensitivity");
  const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : undefined;
  if (!file) {
    if (fileInput instanceof HTMLInputElement) {
      fileInput.setCustomValidity("Choose a file to attach.");
      fileInput.reportValidity();
      fileInput.addEventListener("change", () => fileInput.setCustomValidity(""), { once: true });
    }
    return;
  }
  const role =
    roleInput instanceof HTMLSelectElement
      ? (roleInput.value as PccAttachment["role"])
      : "reference";
  const target = targetInput instanceof HTMLSelectElement ? targetInput.value : "project";
  const milestoneId = target.startsWith("milestone:")
    ? target.slice("milestone:".length)
    : undefined;
  props.onUploadAttachment?.(file, {
    role,
    scope: milestoneId ? "milestone" : role === "proof" ? "proof_only" : "project",
    ...(milestoneId ? { milestoneId } : {}),
    instructions:
      form.dataset.pccOriginalInstructions ??
      (instructionsInput instanceof HTMLTextAreaElement ? instructionsInput.value.trim() : ""),
    ...(form.dataset.pccOriginalInstructions && instructionsInput instanceof HTMLTextAreaElement
      ? { clarifiedInstructions: instructionsInput.value.trim() }
      : {}),
    ...(form.dataset.pccClarifiedProvider &&
    form.dataset.pccClarifiedModel &&
    form.dataset.pccClarifiedAt
      ? {
          instructionProvenance: {
            provider: form.dataset.pccClarifiedProvider,
            model: form.dataset.pccClarifiedModel,
            generatedAt: form.dataset.pccClarifiedAt,
          },
        }
      : {}),
    modelAccess:
      modelAccessInput instanceof HTMLSelectElement
        ? (modelAccessInput.value as PccAttachment["modelAccess"])
        : "project_policy",
    sensitivity:
      sensitivityInput instanceof HTMLSelectElement
        ? (sensitivityInput.value as PccAttachment["sensitivity"])
        : "normal",
  });
}

async function clarifyAttachmentFromForm(event: Event, props: PccDashboardProps): Promise<void> {
  const button = event.currentTarget as HTMLButtonElement;
  const form = button.closest("form");
  if (!form) {
    return;
  }
  const textarea = form?.elements.namedItem("attachmentInstructions");
  const roleInput = form?.elements.namedItem("attachmentRole");
  const fileInput = form?.elements.namedItem("attachmentFile");
  const status = form?.querySelector<HTMLElement>("[data-pcc-attachment-clarifier-status]");
  if (!(textarea instanceof HTMLTextAreaElement) || !textarea.value.trim()) {
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
    }
    if (status) {
      status.textContent =
        "Write a rough note first. Local AI will make it clear without changing your intent.";
    }
    return;
  }
  if (!props.onClarifyAttachmentInstructions) {
    return;
  }
  button.disabled = true;
  if (status) {
    status.textContent = "Local AI is clarifying your instructions…";
  }
  try {
    const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0]?.name : undefined;
    const result = await props.onClarifyAttachmentInstructions({
      originalName: file || "project file",
      role:
        roleInput instanceof HTMLSelectElement
          ? (roleInput.value as PccAttachment["role"])
          : "reference",
      instructions: textarea.value,
    });
    form.dataset.pccOriginalInstructions = textarea.value.trim();
    form.dataset.pccClarifiedProvider = result.provenance.provider;
    form.dataset.pccClarifiedModel = result.provenance.model;
    form.dataset.pccClarifiedAt = result.provenance.generatedAt;
    textarea.value = result.clarifiedInstructions;
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    if (status) {
      status.textContent = `Improved locally by ${result.provenance.model}. Review before attaching.`;
    }
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  } finally {
    button.disabled = false;
  }
}

function renderPccProjectFiles(detail: PccProjectDetail, props: PccDashboardProps) {
  const attachments = detail.attachments ?? [];
  const fileInputId = `pcc-project-file-${detail.project.id}`;
  return html`<section class="pcc-project-files" data-pcc-project-files>
    <header>
      <div>
        <span>Project files</span>
        <strong
          >${attachments.length ? `${attachments.length} attached` : "Add context or proof"}</strong
        >
        <p>
          Tell PCC what the file is and where it belongs. Its purpose stays attached so every agent
          uses it correctly.
        </p>
      </div>
    </header>
    <details
      class="pcc-project-files__add"
      @toggle=${(event: Event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) {
          props.onLoadAttachments?.();
        }
      }}
    >
      <summary>Add a file</summary>
      <form
        class="pcc-project-files__form"
        data-pcc-attachment-form
        @submit=${(event: Event) => submitPccAttachment(event, props)}
      >
        <div class="pcc-project-files__file">
          <span>Choose a file</span>
          <div class="pcc-project-files__chooser">
            <button
              class="btn pcc-project-files__choose"
              type="button"
              ?disabled=${props.actionBusy}
              data-pcc-attachment-choose
              @click=${(event: Event) => {
                const form = (event.currentTarget as HTMLElement).closest("form");
                form?.querySelector<HTMLInputElement>("[data-pcc-attachment-file]")?.click();
              }}
            >
              Choose file
            </button>
            <span data-pcc-attachment-selection aria-live="polite">No file selected</span>
          </div>
          <input
            id=${fileInputId}
            class="pcc-sr-only"
            type="file"
            aria-label="Choose a project file"
            name="attachmentFile"
            ?disabled=${props.actionBusy}
            data-pcc-attachment-file
            @change=${(event: Event) => {
              const input = event.currentTarget as HTMLInputElement;
              const form = input.closest("form");
              const selected = input.files?.[0];
              const status = form?.querySelector<HTMLElement>("[data-pcc-attachment-selection]");
              const submit = form?.querySelector<HTMLButtonElement>("[data-pcc-attachment-submit]");
              if (status) {
                status.textContent = selected
                  ? `${selected.name} · ${formatAttachmentSize(selected.size)}`
                  : "No file selected";
              }
              if (submit) {
                submit.disabled = !selected || props.actionBusy;
              }
            }}
          />
        </div>
        <label>
          <span>Use it as</span>
          <select name="attachmentRole" ?disabled=${props.actionBusy}>
            <option value="requirement">A requirement PCC must follow</option>
            <option value="reference">A reference to consult</option>
            <option value="example">An example to learn from</option>
            <option value="proof">Proof that work is complete</option>
            <option value="deliverable">A project deliverable</option>
          </select>
        </label>
        <label>
          <span>Use it for</span>
          <select name="attachmentTarget" ?disabled=${props.actionBusy}>
            <option value="project">The whole project</option>
            ${sortedMilestones(detail).map(
              (milestone) =>
                html`<option value=${`milestone:${milestone.id}`}>
                  Step: ${milestone.title}
                </option>`,
            )}
          </select>
        </label>
        <label class="pcc-project-files__instructions">
          <span>What should PCC do with it?</span>
          <textarea
            name="attachmentInstructions"
            rows="2"
            placeholder="Optional. Example: Use this as the source of truth for colors and layout."
            ?disabled=${props.actionBusy}
          ></textarea>
        </label>
        <div class="pcc-project-files__clarifier">
          <button
            class="btn btn--subtle"
            type="button"
            ?disabled=${props.actionBusy}
            @click=${(event: Event) => void clarifyAttachmentFromForm(event, props)}
          >
            Make my instructions clearer with local AI
          </button>
          <small data-pcc-attachment-clarifier-status>
            Optional. Your original intent stays in place until you review the improved wording.
          </small>
        </div>
        <details class="pcc-project-files__options">
          <summary>Privacy and AI access</summary>
          <div>
            <label>
              <span>Who may read it?</span>
              <select name="attachmentModelAccess" ?disabled=${props.actionBusy}>
                <option value="project_policy">Agents allowed by this project</option>
                <option value="local_only">Local AI only</option>
                <option value="no_model">No AI — storage only</option>
              </select>
            </label>
            <label>
              <span>Sensitivity</span>
              <select name="attachmentSensitivity" ?disabled=${props.actionBusy}>
                <option value="normal">Normal</option>
                <option value="sensitive">Sensitive</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
          </div>
        </details>
        <button class="btn pcc-action-primary" type="submit" data-pcc-attachment-submit disabled>
          Attach to project
        </button>
      </form>
    </details>
    ${attachments.length
      ? html`<ul class="pcc-project-files__list">
          ${attachments.map(
            (attachment) => html`<li>
              <div>
                <strong>${attachment.title}</strong>
                <span>${attachmentRoleLabel(attachment.role)} · ${attachment.mimeType}</span>
                ${attachment.instructions
                  ? html`<p>${attachment.instructions}</p>`
                  : html`<p>No special instructions. PCC will use the selected role and scope.</p>`}
              </div>
              <span class="pcc-status">${attachment.modelAccess.replaceAll("_", " ")}</span>
            </li>`,
          )}
        </ul>`
      : html`<p class="pcc-project-files__empty">
          No files yet. Add only what the project needs; PCC keeps the file, purpose, and target
          together.
        </p>`}
  </section>`;
}

const PROJECT_STATUSES: PccStatus[] = [
  "active",
  "in_progress",
  "blocked",
  "needs_approval",
  "deferred",
  "on_hold",
  "complete",
  "complete_with_maintenance",
  "reopened",
  "archived",
];
const RESPONSIBILITY_OPTIONS = [
  ["user", "User"],
  ["local_openclaw_agent", "Local OpenClaw agent"],
  ["local_model", "Local model"],
  ["codex", "Codex"],
  ["high_reasoning_codex", "High-reasoning Codex"],
  ["remote_proof", "Remote proof"],
] as const;

const COST_RISK_OPTIONS = [
  ["free", "Free"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
] as const;

const PARALLEL_WORK_OPTIONS = [
  ["off", "Parallel Work: Off"],
  ["plan_only", "Plan Only"],
  ["local_agents_only", "Local Agents Only"],
  ["supervised", "Supervised"],
] as const;

const LOCAL_EXECUTION_OPTIONS = [
  {
    value: "focused",
    title: "Focused",
    detail: "One OpenClaw worker at a time. The calmest and most resource-efficient option.",
    usage: "One local task at a time",
  },
  {
    value: "parallel",
    title: "Parallel · Recommended",
    detail: "Independent OpenClaw tasks run together when the Mac has safe capacity.",
    usage: "Faster local work with automatic resource protection",
  },
  {
    value: "ultra",
    title: "Maximum Safe",
    detail: "Use the maximum safe OpenClaw team. PCC automatically backs off when the Mac is busy.",
    usage: "No PCC worker cap · governed by live host capacity",
  },
] as const satisfies ReadonlyArray<{
  value: PccExecutionSpeed;
  title: string;
  detail: string;
  usage: string;
}>;

const CODEX_POLICY_OPTIONS = [
  {
    value: "recommended_minimum",
    title: "Recommended minimum",
    detail:
      "After initial planning, Codex handles major replans, helps when local AI is stuck, and reviews completion.",
    usage: "2 planned post-plan checkpoints · extra help only when evidence shows it is needed",
  },
  {
    value: "local_only",
    title: "Local AI only",
    detail: "After initial planning, OpenClaw local models handle the work and review.",
    usage: "No Codex project checkpoints after planning",
  },
  {
    value: "more_oversight",
    title: "More Codex oversight",
    detail: "Codex reviews every major plan, architecture, recovery, and completion checkpoint.",
    usage: "Higher Codex use · routine implementation still stays local",
  },
  {
    value: "custom",
    title: "Custom",
    detail: "Choose Local AI, Codex, or Automatic for each major checkpoint.",
    usage: "Your visible checkpoint choices are the only policy",
  },
] as const satisfies ReadonlyArray<{
  value: PccCodexPolicyId;
  title: string;
  detail: string;
  usage: string;
}>;

const CODEX_CHECKPOINT_OPTIONS = [
  [
    "material_replan",
    "Major project change",
    "Replans when scope, dependencies, or done criteria change.",
  ],
  [
    "architecture_review",
    "Architecture decision",
    "Reviews high-impact technical choices before implementation.",
  ],
  [
    "blocked_recovery",
    "Stuck or repeated failure",
    "Helps after two documented local attempts or a high-impact blocker.",
  ],
  [
    "final_review",
    "Final completion review",
    "Checks current evidence before PCC claims completion.",
  ],
] as const satisfies ReadonlyArray<[PccCodexCheckpointId, string, string]>;

const PROJECT_FILTER_OPTIONS: Array<[PccProjectFilter, string]> = [
  ["active", "Active"],
  ["needs_you", "Needs You"],
  ["on_hold", "On Hold"],
  ["completed", "Completed"],
  ["archived", "Archived"],
  ["all", "All"],
];

function projectFilterLabel(filter: PccProjectFilter): string {
  return PROJECT_FILTER_OPTIONS.find(([value]) => value === filter)?.[1] ?? formatStatus(filter);
}

function formatPlannerModelLabel(entry: ModelCatalogEntry): string {
  const display = entry.name || entry.id;
  return entry.provider ? `${display} · ${entry.provider}` : display;
}

function isCodexCatalogEntry(entry: ModelCatalogEntry): boolean {
  return (
    entry.agentRuntime?.id === "codex" || (entry.provider?.toLowerCase().includes("codex") ?? false)
  );
}

function modelOptions(
  props: PccDashboardProps,
  selected: string,
  kind: "openclaw" | "codex",
): Array<[string, string, boolean]> {
  const catalogOptions = (props.modelCatalog ?? [])
    .filter(
      (entry) =>
        entry.available !== false &&
        (kind === "codex" ? isCodexCatalogEntry(entry) : isPccLocalCatalogModel(entry)),
    )
    .map(
      (entry) =>
        [
          buildQualifiedChatModelValue(entry.id, entry.provider),
          formatPlannerModelLabel(entry),
          false,
        ] satisfies [string, string, boolean],
    );
  const available =
    selected === PCC_BEST_AVAILABLE_MODEL_ID ||
    catalogOptions.some(([value]) => value === selected);
  return [
    [
      PCC_BEST_AVAILABLE_MODEL_ID,
      kind === "codex" ? "Best available from Codex" : "Best configured local model",
      false,
    ],
    ...(!available && selected
      ? ([[selected, `Unavailable · ${selected}`, true]] as Array<[string, string, boolean]>)
      : []),
    ...catalogOptions,
  ];
}

function plannerModelRefreshLabel(props: PccDashboardProps): string {
  if (props.modelsLoading) {
    return "Refreshing models…";
  }
  const count = props.modelCatalog?.length ?? 0;
  const freshness = props.modelsLastRefreshedAt
    ? new Date(props.modelsLastRefreshedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "not refreshed in this session";
  const fallback = props.modelsFallback ? " · using cached fallback" : "";
  return count > 0
    ? `Last refresh: ${freshness} · ${count} configured model${count === 1 ? "" : "s"}${fallback}`
    : `No configured models from last refresh (${freshness})`;
}

function executionModelLabel(
  props: PccDashboardProps,
  selected: string,
  kind: "openclaw" | "codex",
): string {
  return modelOptions(props, selected, kind).find(([value]) => value === selected)?.[1] ?? selected;
}

function projectPlannerSummary(props: PccDashboardProps): {
  title: string;
  detail: string;
  safety: string;
} {
  const form = props.projectForm;
  const execution = localExecutionOption(form.executionProfile.speed);
  const codex = codexPolicyOption(form.executionProfile.codexPolicyId);
  const capacity = props.executionCapacity?.safeLocalAgentSlots ?? 0;
  const counts = resolvePccEstimatedAgentCounts(form.executionProfile, capacity);
  return {
    title: `${execution.title.replace(" · Recommended", "")} · ${codex.title}`,
    detail: `${execution.detail} ${codex.detail} Current safe execution: ${counts.localAgents} OpenClaw worker${counts.localAgents === 1 ? "" : "s"}.`,
    safety:
      form.executionProfile.codexPolicyId === "local_only"
        ? "Codex off after initial planning"
        : "Codex is used only at visible checkpoints",
  };
}

let draggedPccMilestoneId: string | null = null;
let draggedPccSubMilestoneId: string | null = null;

function setPccDragData(event: DragEvent, kind: "milestone" | "submilestone", id: string): void {
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-openclaw-pcc-reorder", `${kind}:${id}`);
    event.dataTransfer.setData("text/plain", id);
  }
}

function getPccDraggedId(
  event: DragEvent,
  kind: "milestone" | "submilestone",
  fallback: string | null,
): string | null {
  const encoded = event.dataTransfer?.getData("application/x-openclaw-pcc-reorder") ?? "";
  const prefix = `${kind}:`;
  if (encoded.startsWith(prefix)) {
    return encoded.slice(prefix.length);
  }
  return event.dataTransfer?.getData("text/plain") || fallback;
}

function setPccDropTarget(event: DragEvent, active: boolean): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (!active) {
    const related = event.relatedTarget;
    if (related instanceof Node && target.contains(related)) {
      return;
    }
  }
  target.classList.toggle("is-drop-target", active);
}

const LANE_LABELS = [
  ["user", "User"],
  ["localOpenClawAgent", "Local OpenClaw Agent"],
  ["localModel", "Local Model"],
  ["codex", "Codex"],
  ["highReasoningCodex", "High-Reasoning Codex"],
  ["remoteProof", "Remote Proof"],
] as const;

const PROJECT_TERMINAL_STATUSES = new Set([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

function projectIsTerminal(project: Pick<PccProject, "status">): boolean {
  return PROJECT_TERMINAL_STATUSES.has(project.status);
}

const MILESTONE_STATUSES: PccStatus[] = [
  "not_started",
  "active",
  "in_progress",
  "blocked",
  "needs_approval",
  "deferred",
  "on_hold",
  "skipped",
  "proof_pending",
  "local_proof_complete",
  "remote_proof_complete",
  "runtime_proof_complete",
  "persistence_proof_complete",
  "complete",
  "reopened",
  "archived",
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confirmAction(message: string): boolean {
  return globalThis.confirm?.(message) ?? true;
}

function confirmedSkipNote(): string {
  return "Skipped from the PCC action menu.";
}

function confirmedRemoveNote(): string {
  return "Removed from the active PCC plan from the action menu.";
}

function armPccConfirmationButton(button: HTMLButtonElement, label: string): void {
  resetPccConfirmationButton(button);
  button.dataset.pccConfirmArmed = "true";
  button.dataset.pccConfirmOriginalLabel = button.textContent?.trim() ?? "";
  button.textContent = label;
  button.classList.add("is-confirming");
  const popover = document.createElement("span");
  popover.className = "pcc-confirm-popover";
  popover.dataset.pccConfirmPopover = "true";
  popover.textContent = `${label} to continue.`;
  button.insertAdjacentElement("afterend", popover);
}

function resetPccConfirmationButton(button: HTMLButtonElement): void {
  const popover = button.nextElementSibling;
  if (popover instanceof HTMLElement && popover.dataset.pccConfirmPopover === "true") {
    popover.remove();
  }
  const originalLabel = button.dataset.pccConfirmOriginalLabel;
  if (originalLabel) {
    button.textContent = originalLabel;
  }
  delete button.dataset.pccConfirmArmed;
  delete button.dataset.pccConfirmOriginalLabel;
  button.classList.remove("is-confirming");
}

function resetSiblingPccConfirmations(button: HTMLButtonElement): void {
  const root = button.closest(".pcc-shell") ?? button.getRootNode();
  if (!("querySelectorAll" in root)) {
    return;
  }
  const queryRoot = root as ParentNode;
  queryRoot
    .querySelectorAll<HTMLButtonElement>("[data-pcc-confirm-armed='true']")
    .forEach((armed: HTMLButtonElement) => {
      if (armed !== button) {
        resetPccConfirmationButton(armed);
      }
    });
}

function runPccConfirmedButtonAction(event: Event, confirmLabel: string, action: () => void): void {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget as HTMLButtonElement;
  if (button.dataset.pccConfirmArmed === "true") {
    resetPccConfirmationButton(button);
    action();
    return;
  }
  resetSiblingPccConfirmations(button);
  armPccConfirmationButton(button, confirmLabel);
}

function togglePccActionMenu(event: Event): void {
  event.stopPropagation();
  const trigger = event.currentTarget as HTMLButtonElement;
  const menu = trigger.closest<HTMLElement>(".pcc-action-menu");
  if (!menu) {
    return;
  }
  const root = menu.getRootNode() as ParentNode;
  const nextOpen = !menu.classList.contains("is-open");
  root.querySelectorAll<HTMLElement>(".pcc-action-menu.is-open").forEach((openMenu) => {
    if (openMenu !== menu) {
      openMenu.classList.remove("is-open");
      openMenu
        .querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")
        ?.setAttribute("aria-expanded", "false");
      const items = openMenu.querySelector<HTMLElement>(".pcc-action-menu__items");
      if (items) {
        items.hidden = true;
        items.setAttribute("aria-hidden", "true");
        items.setAttribute("inert", "");
      }
    }
  });
  menu.classList.toggle("is-open", nextOpen);
  trigger.setAttribute("aria-expanded", String(nextOpen));
  const items = menu.querySelector<HTMLElement>(".pcc-action-menu__items");
  if (items) {
    items.hidden = !nextOpen;
    items.setAttribute("aria-hidden", String(!nextOpen));
    if (nextOpen) {
      items.removeAttribute("inert");
    } else {
      items.setAttribute("inert", "");
    }
  }
  if (nextOpen) {
    menu
      .querySelector<HTMLButtonElement>("[role='menuitem'], [role='menuitemcheckbox'] input")
      ?.focus();
  }
}

function closePccActionMenu(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  const menu = target.closest<HTMLElement>(".pcc-action-menu");
  menu?.classList.remove("is-open");
  menu
    ?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")
    ?.setAttribute("aria-expanded", "false");
  const items = menu?.querySelector<HTMLElement>(".pcc-action-menu__items");
  if (items) {
    items.hidden = true;
    items.setAttribute("aria-hidden", "true");
    items.setAttribute("inert", "");
  }
}

function runPccMenuAction(event: Event, action: () => void): void {
  closePccActionMenu(event);
  action();
}

function handlePccActionMenuKeydown(event: KeyboardEvent): void {
  const menu = event.currentTarget as HTMLElement;
  const root = menu.closest<HTMLElement>(".pcc-action-menu");
  const focusable = [
    ...menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "button:not(:disabled), input:not(:disabled)",
    ),
  ];
  const currentIndex = focusable.findIndex((item) => item === document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    root?.classList.remove("is-open");
    root
      ?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")
      ?.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    menu.setAttribute("inert", "");
    root?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.focus();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  event.preventDefault();
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex =
    currentIndex < 0
      ? 0
      : (currentIndex + direction + focusable.length) % Math.max(focusable.length, 1);
  focusable[nextIndex]?.focus();
}

function runPccConfirmedMenuAction(event: Event, confirmLabel: string, action: () => void): void {
  const button = event.currentTarget as HTMLButtonElement;
  if (button.dataset.pccConfirmArmed === "true") {
    closePccActionMenu(event);
    resetPccConfirmationButton(button);
    action();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  resetSiblingPccConfirmations(button);
  armPccConfirmationButton(button, confirmLabel);
}

function projectIsOnHold(project: Pick<PccProject, "status"> | PccProjectSummary): boolean {
  return project.status === "on_hold" || project.status === "deferred";
}

function projectIsDeferredOutOfUrgent(
  project: Pick<PccProject, "status"> | PccProjectSummary,
): boolean {
  return ["archived", "skipped", "on_hold", "deferred"].includes(project.status);
}

function projectIsTerminalForWork(
  project: Pick<PccProject, "status"> | PccProjectSummary,
): boolean {
  return ["complete", "complete_with_maintenance", "archived", "skipped"].includes(project.status);
}

function projectCanBeNextBestAction(project: PccProjectSummary): boolean {
  return !projectIsDeferredOutOfUrgent(project) && !projectIsTerminalForWork(project);
}

function projectIsExcludedFromTodayFocus(
  project: PccProjectSummary,
  detail?: PccProjectDetail,
): boolean {
  return pccWorkScopeForProject(detail?.project ?? project) === "project_work";
}

function projectDetailForSummary(
  props: Pick<PccDashboardProps, "projectDetails" | "projectDetail">,
  project: PccProjectSummary,
): PccProjectDetail | undefined {
  return (
    props.projectDetails?.[project.id] ??
    (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined)
  );
}

function effectivePccFocusMode(
  props: Pick<PccDashboardProps, "productFocusMode" | "projectDetail">,
): "pcc_product" | "project_work" {
  return (
    props.productFocusMode ??
    (props.projectDetail ? pccWorkScopeForProject(props.projectDetail.project) : "project_work")
  );
}

function compactTodaySignal(value: string, max = 78): string {
  return compactSignalText(value, max);
}

function runningProjectsForToday(props: PccDashboardProps): PccProjectSummary[] {
  return focusScopedProjectsForToday(props, props.projects).filter(
    (project) => workStateForProject(project, props.projectDetails?.[project.id]) === "Working",
  );
}

function focusedAttentionProjects(
  projects: readonly PccProjectSummary[],
  _props?: Pick<PccDashboardProps, "projectDetails" | "projectDetail">,
): PccProjectSummary[] {
  return getAttentionProjects(projects);
}

function focusScopedProjectsForToday(
  props: Pick<PccDashboardProps, "projectDetails" | "projectDetail" | "productFocusMode">,
  projects: readonly PccProjectSummary[],
): PccProjectSummary[] {
  const productMode = effectivePccFocusMode(props) === "pcc_product";
  return projects.filter((project) => {
    const excluded = projectIsExcludedFromTodayFocus(
      project,
      projectDetailForSummary(props, project),
    );
    return productMode ? !excluded : excluded || project.id !== "project-command-center";
  });
}

function deferredAttentionProjects(
  projects: readonly PccProjectSummary[],
  props?: Pick<PccDashboardProps, "projectDetails" | "projectDetail">,
): PccProjectSummary[] {
  return getAttentionProjects(projects).filter((project) =>
    projectIsExcludedFromTodayFocus(
      project,
      props ? projectDetailForSummary(props, project) : undefined,
    ),
  );
}

function compactSignalText(value: string, max = 130): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function editorHasDraft(form: PccProjectFormState): boolean {
  return Boolean(
    form.projectDescription.trim() ||
    form.title.trim() ||
    form.goal.trim() ||
    form.dueDate.trim() ||
    Object.values(form.intakeAnswers ?? {}).some((value) => value.trim()),
  );
}

function confirmEditorClose(props: PccDashboardProps): void {
  if (props.editorMode === "create-project" && editorHasDraft(props.projectForm)) {
    if (!confirmAction("Discard this project draft?")) {
      return;
    }
  }
  props.onCancelEditor();
}

function runPccEditorCancelAction(event: Event, props: PccDashboardProps): void {
  if (props.editorMode === "create-project" && editorHasDraft(props.projectForm)) {
    runPccConfirmedButtonAction(event, "Discard draft", props.onCancelEditor);
    return;
  }
  event.preventDefault();
  props.onCancelEditor();
}

function phaseTitleForMilestone(detail: PccProjectDetail, milestone: PccMilestone): string {
  if (!milestone.phaseId) {
    return "Project sequence";
  }
  return (
    detail.project.phases?.find((phase) => phase.id === milestone.phaseId)?.title ??
    "Project sequence"
  );
}

function nextSubMilestoneForMilestone(
  detail: PccProjectDetail | null,
  milestone: PccMilestone,
): PccSubMilestone | undefined {
  return subMilestonesForMilestone(detail, milestone).find(
    (subMilestone) => !PROJECT_TERMINAL_STATUSES.has(subMilestone.status),
  );
}

function resolvePccProjectAction(detail: PccProjectDetail): PccProjectActionResolution {
  const setup = setupEvaluationForDetail(detail);
  const blockers = blockerLinesForDetail(detail);
  const latestExecutionPlan = executionPlansFromProject(detail.project).at(-1);
  return resolveCanonicalPccProjectAction({
    project: detail.project,
    setupReady: setup.runnable,
    blockerLines: blockers,
    permissions: detail.permissions,
    hasBlockedMilestone: detail.summary.milestoneCounts.blocked > 0,
    hasIncompleteMilestone: detail.milestones.some(
      (milestone) => !PROJECT_TERMINAL_STATUSES.has(milestone.status),
    ),
    // The legacy work-loop flag is a policy setting, not proof that an agent
    // is alive. Only a persisted Gateway plan may claim live work.
    executionPlanStatus: latestExecutionPlan?.status ?? null,
  });
}

function runResolvedProjectPrimaryAction(
  resolved: PccProjectActionResolution,
  detail: PccProjectDetail,
  props: PccDashboardProps,
  trigger?: HTMLElement,
): void {
  if (resolved.primaryActionId === "resume") {
    const latestPlan = executionPlansFromProject(detail.project).at(-1);
    if (latestPlan?.status === "paused" && props.onResumeExecution) {
      props.onResumeExecution();
      return;
    }
    if (props.onResumeProject) {
      props.onResumeProject();
      return;
    }
    props.onSetProjectStatus(detail.project, "active");
    return;
  }
  if (resolved.primaryActionId === "fix_setup") {
    props.onPreviewSetupAutofill?.();
    return;
  }
  if (resolved.primaryActionId === "pause") {
    if (props.onPauseExecution) {
      props.onPauseExecution();
    } else {
      props.onUpdateWorkLoop({ state: "paused", enabled: true });
    }
    return;
  }
  if (resolved.primaryActionId === "review_permission") {
    openPccPermissionReview(detail, trigger);
    return;
  }
  if (
    resolved.primaryActionId === "view_details" ||
    resolved.primaryActionId === "review_blocker"
  ) {
    props.onSetViewMode?.("detailed");
    return;
  }
  if (resolved.primaryActionId === "work") {
    // The prominent project action is the real supervised-work entrypoint.
    // Keep preparation available as the explicit secondary action below, but
    // never make the user infer that a legacy work-loop toggle started a run.
    if (props.onStartExecution) {
      props.onStartExecution();
    } else {
      props.onPrepareNextWorkItem();
    }
  }
}

const pccPermissionReviewTriggers = new WeakMap<HTMLDialogElement, HTMLElement>();

function pendingPermissionForDetail(
  detail: PccProjectDetail,
  preferredId?: string | null,
): PccPermissionGrant | undefined {
  const preferred = preferredId
    ? detail.permissions.find(
        (permission) => permission.id === preferredId && permission.status === "needed",
      )
    : undefined;
  if (preferred) {
    return preferred;
  }
  const currentMilestoneId = currentMilestoneForDetail(detail)?.id;
  return detail.permissions
    .filter((permission) => permission.status === "needed")
    .toSorted((left, right) => {
      const leftCurrent = left.milestoneId === currentMilestoneId ? 0 : 1;
      const rightCurrent = right.milestoneId === currentMilestoneId ? 0 : 1;
      return leftCurrent - rightCurrent || left.createdAt.localeCompare(right.createdAt);
    })[0];
}

function permissionReviewDialog(
  projectId: string,
  trigger?: HTMLElement,
): HTMLDialogElement | null {
  const root = trigger?.getRootNode() as ParentNode | undefined;
  const scopedDialog = root
    ? [...root.querySelectorAll<HTMLDialogElement>("[data-pcc-permission-review-dialog]")].find(
        (dialog) => dialog.dataset.pccPermissionReviewDialog === projectId,
      )
    : undefined;
  return (
    scopedDialog ??
    [...document.querySelectorAll<HTMLDialogElement>("[data-pcc-permission-review-dialog]")].find(
      (dialog) => dialog.dataset.pccPermissionReviewDialog === projectId,
    ) ??
    null
  );
}

function openPccPermissionReview(detail: PccProjectDetail, trigger?: HTMLElement): void {
  const dialog = permissionReviewDialog(detail.project.id, trigger);
  if (!dialog) {
    return;
  }
  if (trigger) {
    pccPermissionReviewTriggers.set(dialog, trigger);
  }
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) {
      dialog.showModal();
    }
  } else {
    dialog.setAttribute("open", "");
  }
  if (!dialog.open) {
    dialog.setAttribute("open", "");
  }
  queueMicrotask(() =>
    dialog.querySelector<HTMLButtonElement>("[data-pcc-permission-grant]")?.focus(),
  );
}

function closePccPermissionReview(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
  restorePccPermissionReviewFocus(dialog);
}

function restorePccPermissionReviewFocus(dialog: HTMLDialogElement): void {
  pccPermissionReviewTriggers.get(dialog)?.focus();
  pccPermissionReviewTriggers.delete(dialog);
}

function blockerKindForLine(line: string): string {
  if (/on hold|resume/iu.test(line)) {
    return "On hold";
  }
  if (/permission|approval|approve/iu.test(line)) {
    return "Needs permission";
  }
  if (/proof|receipt|evidence/iu.test(line)) {
    return "Waiting for proof";
  }
  if (/tool|install|flips|beat|emulator/iu.test(line)) {
    return "Missing tool";
  }
  if (/setup|intake|workflow|owner|responsibility|goal/iu.test(line)) {
    return "Needs setup";
  }
  return "Blocked";
}

function blockerFixLabelForLine(line: string, plannerLabel = "Local AI"): string {
  if (/on hold|resume/iu.test(line)) {
    return "Resume Project";
  }
  if (/setup|intake|workflow|owner|responsibility|goal/iu.test(line)) {
    return `Plan Setup with ${plannerLabel}`;
  }
  if (/permission|approval|approve/iu.test(line)) {
    return "Review Permission";
  }
  if (/proof|receipt|evidence/iu.test(line)) {
    return "Open Proof";
  }
  if (/tool|install|flips|beat|emulator/iu.test(line)) {
    return "View Tool Blocker";
  }
  return "Review Blocker";
}

function blockerOwnerForLine(line: string): string {
  if (/permission|approval|approve/iu.test(line)) {
    return "User";
  }
  if (/tool|install|flips|beat|emulator/iu.test(line)) {
    return "User + local machine";
  }
  if (/setup|intake|workflow|owner|responsibility|goal/iu.test(line)) {
    return "PCC can draft; user approves";
  }
  if (/proof|receipt|evidence/iu.test(line)) {
    return "Verifier";
  }
  return "PCC";
}

function blockerImpactForLine(line: string): string {
  if (/on hold|resume/iu.test(line)) {
    return "PCC will not start project work until you resume it.";
  }
  if (/setup|intake|workflow|owner|responsibility|goal/iu.test(line)) {
    return "PCC cannot choose safe work until setup is complete.";
  }
  if (/permission|approval|approve/iu.test(line)) {
    return "PCC stops before actions that need your approval.";
  }
  if (/tool|install|flips|beat|emulator/iu.test(line)) {
    return "The next step needs a tool or local capability that is not ready.";
  }
  if (/proof|receipt|evidence/iu.test(line)) {
    return "Completion cannot be trusted until proof is recorded.";
  }
  return "This must be reviewed before PCC proceeds.";
}

function blockerLinesForDetail(detail: PccProjectDetail): string[] {
  if (PROJECT_TERMINAL_STATUSES.has(detail.project.status)) {
    return [];
  }
  const setup = setupEvaluationForDetail(detail);
  const blockers = buildPccWorkStartBlockers({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  return [...blockers, ...setup.missing, ...setup.violations, ...setup.needsReview].filter(
    (line, index, lines): line is string => Boolean(line) && lines.indexOf(line) === index,
  );
}

function renderMetric(label: string, value: string | number) {
  return html`
    <article class="pcc-metric" aria-label=${label}>
      <span class="pcc-metric__value">${value}</span>
      <span class="pcc-metric__label">${label}</span>
    </article>
  `;
}

function pccViewMode(props: PccDashboardProps): PccViewMode {
  return props.viewMode ?? "simple";
}

function terminalStatus(status: PccStatus): boolean {
  return ["complete", "complete_with_maintenance", "skipped", "archived"].includes(status);
}

const PCC_STALE_PROJECT_DAYS = 14;

function projectIsOverdue(project: PccProjectSummary): boolean {
  if (PROJECT_TERMINAL_STATUSES.has(project.status) || !project.dueDate) {
    return false;
  }
  const parsed = Date.parse(project.dueDate);
  return Number.isFinite(parsed) && parsed < Date.now();
}

function projectIsStale(project: PccProjectSummary): boolean {
  if (PROJECT_TERMINAL_STATUSES.has(project.status)) {
    return false;
  }
  const updatedAt = Date.parse(project.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  return Date.now() - updatedAt > PCC_STALE_PROJECT_DAYS * 24 * 60 * 60 * 1_000;
}

function projectNeedsAttention(project: PccProjectSummary): boolean {
  if (projectIsTerminalForWork(project)) {
    return false;
  }
  if (projectIsDeferredOutOfUrgent(project)) {
    return false;
  }
  return (
    project.status === "needs_approval" ||
    project.status === "blocked" ||
    project.milestoneCounts.needsApproval > 0 ||
    project.milestoneCounts.blocked > 0 ||
    project.proofGaps.length > 0 ||
    projectIsOverdue(project) ||
    projectIsStale(project) ||
    project.health === "Overdue" ||
    project.health === "At risk"
  );
}

function projectAttentionLine(project: PccProjectSummary): string {
  if (project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0) {
    return project.nextActions[0] ?? "Approval needed";
  }
  if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
    return project.nextActions[0] ?? "Blocked work needs review";
  }
  if (projectIsOverdue(project) || project.health === "Overdue") {
    return `Overdue since ${formatProjectDate(project.dueDate)}`;
  }
  if (project.health === "At risk") {
    return "At risk; review blockers, proof, and next action";
  }
  if (projectIsStale(project)) {
    return `No recorded update since ${formatProjectDate(project.updatedAt)}`;
  }
  return project.nextActions[0] ?? "Needs review";
}

function workStateForProject(
  project: PccProjectSummary,
  detail?: PccProjectDetail,
): "Working" | "Paused" | "Blocked" | "Waiting for you" | "Off" {
  if (projectIsTerminalForWork(project)) {
    return "Off";
  }
  if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
    return "Blocked";
  }
  if (project.proofGaps.length > 0) {
    return "Blocked";
  }
  if (project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0) {
    return "Waiting for you";
  }
  const plans = detail ? executionPlansFromProject(detail.project) : [];
  const activePlan = plans.findLast((plan) => isPccExecutionPlanActive(plan.status));
  if (activePlan) {
    return activePlan.status === "paused"
      ? "Paused"
      : activePlan.status === "blocked"
        ? "Blocked"
        : "Working";
  }
  const latestPlan = plans.at(-1);
  if (latestPlan?.status === "failed" || latestPlan?.status === "lost") {
    return "Blocked";
  }
  return "Off";
}

function sortedMilestones(detail: PccProjectDetail): PccMilestone[] {
  return detail.milestones.toSorted(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
  );
}

function currentMilestoneForDetail(detail: PccProjectDetail): PccMilestone | undefined {
  return sortedMilestones(detail).find((milestone) => !terminalStatus(milestone.status));
}

function nextMilestoneForDetail(detail: PccProjectDetail): PccMilestone | undefined {
  const current = currentMilestoneForDetail(detail);
  return sortedMilestones(detail).find(
    (milestone) => milestone.id !== current?.id && !terminalStatus(milestone.status),
  );
}

function plannerModeToPlanningMode(mode: PccPlannerMode) {
  return mode === "codex" || mode === "high_reasoning_codex"
    ? "codex_full_plan"
    : mode === "local_project_manager" || mode === "best_available"
      ? "local_project_manager"
      : "template_only";
}

function renderViewModeSwitcher(props: PccDashboardProps) {
  const mode = pccViewMode(props);
  const options: Array<[PccViewMode, string, string]> = [
    ["simple", "Simple", "Skim what matters now."],
    ["detailed", "Detailed", "Show milestones, receipts, and proof."],
    ["agent", "Agent", "Show execution plans and handoff details."],
  ];
  return html`<div class="pcc-view-mode" data-pcc-view-mode=${mode} aria-label="PCC view mode">
    ${options.map(
      ([value, label, title]) => html`<button
        class="pcc-view-mode__option ${mode === value ? "is-active" : ""}"
        type="button"
        aria-label=${`${label}: ${title}`}
        aria-pressed=${mode === value}
        data-pcc-view-mode-option=${value}
        @click=${() => props.onSetViewMode?.(value)}
      >
        <strong>${label}</strong>
      </button>`,
    )}
  </div>`;
}

function scrollPccDetailIntoView(): void {
  globalThis.document
    ?.querySelector("[data-pcc-detail], [data-pcc-project-card]")
    ?.scrollIntoView?.({ block: "nearest" });
}

function scrollPccAutopilotIntoView(root?: ParentNode): void {
  (root ?? globalThis.document)
    ?.querySelector("[data-pcc-autopilot-project-loop]")
    ?.scrollIntoView?.({ block: "nearest" });
}

function activatePccDetailTab(tabId: string, root?: ParentNode): void {
  const target = root ?? globalThis.document;
  if (!target) {
    return;
  }
  for (const tab of target.querySelectorAll<HTMLButtonElement>("[data-pcc-detail-tab]")) {
    const active = tab.dataset.pccDetailTab === tabId;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of target.querySelectorAll<HTMLElement>("[data-pcc-detail-tab-panel]")) {
    panel.hidden = panel.dataset.pccDetailTabPanel !== tabId;
  }
}

function handlePccDetailTabKeydown(event: KeyboardEvent, tabId: string): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }
  const root = (event.currentTarget as HTMLElement).closest(".pcc-detail-drawer") ?? undefined;
  const tabs = [...(root?.querySelectorAll<HTMLButtonElement>("[data-pcc-detail-tab]") ?? [])];
  const currentIndex = tabs.findIndex((tab) => tab.dataset.pccDetailTab === tabId);
  if (currentIndex < 0 || tabs.length === 0) {
    return;
  }
  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  if (!next) {
    return;
  }
  activatePccDetailTab(next.dataset.pccDetailTab ?? "plan", root);
  next.focus();
}

function openPccDecisionCapture(event: Event, props: PccDashboardProps): void {
  const detail = (event.currentTarget as HTMLElement).closest("[data-pcc-detail]") ?? undefined;
  activatePccDetailTab("decisions", detail);
  props.onOpenDecisionForm?.();
}

function revealPccAutopilot(props: PccDashboardProps, source?: HTMLElement): void {
  const reveal = () => {
    const detail =
      source?.closest<HTMLElement>("[data-pcc-detail]") ??
      source?.querySelector<HTMLElement>("[data-pcc-detail]") ??
      globalThis.document?.querySelector<HTMLElement>("[data-pcc-detail]");
    const drawer = detail?.querySelector<HTMLDetailsElement>(
      'details[data-pcc-mobile-section="more"]',
    );
    if (drawer) {
      drawer.open = true;
    }
    const root = drawer ?? detail ?? undefined;
    activatePccDetailTab("automation", root);
    scrollPccAutopilotIntoView(root);
    root?.querySelector<HTMLButtonElement>('[data-pcc-detail-tab="automation"]')?.focus();
  };
  // Change the render mode first. The mode update can replace the detail drawer;
  // revealing the old DOM before that update made the tab appear not to open.
  props.onSetViewMode?.("detailed");
  reveal();
  const revealAfterRender = () => {
    reveal();
    // Lit may need a second frame when the view-mode change mounts the drawer.
    globalThis.requestAnimationFrame?.(reveal);
  };
  if (globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame(revealAfterRender);
  } else {
    revealAfterRender();
  }
}

function openPccAutopilot(event: Event, props: PccDashboardProps): void {
  revealPccAutopilot(props, (event.currentTarget as HTMLElement | null) ?? undefined);
}

function setPccMobileActiveSection(section: string): void {
  const document = globalThis.document;
  if (!document) {
    return;
  }
  for (const button of document.querySelectorAll<HTMLElement>("[data-pcc-mobile-section-tab]")) {
    const active = button.dataset.pccMobileSectionTab === section;
    button.classList.toggle("is-active", active);
    if (active) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

let pccMobileSectionObserver: IntersectionObserver | null = null;

function ensurePccMobileSectionObserver(): void {
  const document = globalThis.document;
  if (!document || typeof globalThis.IntersectionObserver !== "function") {
    return;
  }
  pccMobileSectionObserver?.disconnect();
  pccMobileSectionObserver = new globalThis.IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .toSorted((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const section = (visible?.target as HTMLElement | undefined)?.dataset.pccMobileSection;
      if (section) {
        setPccMobileActiveSection(section);
      }
    },
    { rootMargin: "-18% 0px -68% 0px", threshold: [0.05, 0.2, 0.5] },
  );
  for (const section of document.querySelectorAll<HTMLElement>("[data-pcc-mobile-section]")) {
    pccMobileSectionObserver.observe(section);
  }
}

function scrollPccMobileSectionIntoView(section: string): void {
  setPccMobileActiveSection(section);
  ensurePccMobileSectionObserver();
  globalThis.document
    ?.querySelector(`[data-pcc-mobile-section="${section}"]`)
    ?.scrollIntoView?.({ block: "start" });
}

function openPccMobileSection(
  section: string,
  props: PccDashboardProps,
  source?: HTMLElement,
): void {
  if (section === "autopilot") {
    revealPccAutopilot(props, source?.closest<HTMLElement>("[data-pcc-shell]") ?? undefined);
    return;
  }
  scrollPccMobileSectionIntoView(section);
}

function renderPccMobileCommandRail(props: PccDashboardProps) {
  const hasProject = Boolean(props.projectDetail);
  const detail = props.projectDetail;
  const resolver = detail ? resolvePccProjectAction(detail) : undefined;
  const focusProjects = focusScopedProjectsForToday(props, props.projects);
  const activeCount = focusProjects.filter((project) =>
    ["active", "in_progress", "reopened"].includes(project.status),
  ).length;
  const needsYouCount = focusedAttentionProjects(focusProjects, props).length;
  const runningCount = runningProjectsForToday(props).length;
  const terminalProject = resolver?.primaryActionId === "no_action_required";
  if (terminalProject && pccViewMode(props) === "simple") {
    return nothing;
  }
  const tabs = [
    { id: "projects", label: "Projects", disabled: false },
    { id: "current", label: "Status", disabled: !hasProject },
    { id: "milestones", label: "Steps", disabled: !hasProject },
    { id: "autopilot", label: "AI Loop", disabled: !hasProject },
    { id: "more", label: "Details", disabled: !hasProject },
  ];
  return html`<section
    class="pcc-mobile-command-rail"
    data-pcc-mobile-command-rail
    @pointerenter=${ensurePccMobileSectionObserver}
    @focusin=${ensurePccMobileSectionObserver}
  >
    <div class="pcc-mobile-command-rail__project">
      <button
        type="button"
        data-pcc-mobile-project-switcher
        @click=${() => scrollPccMobileSectionIntoView("projects")}
      >
        <span>Project</span>
        <strong>${detail?.project.title ?? "Choose a project"}</strong>
      </button>
      <span class="pcc-status pcc-status--${detail?.project.status ?? "active"}">
        ${resolver?.statusLabel ?? "Projects"}
      </span>
    </div>
    <div class="pcc-mobile-command-rail__actions">
      ${terminalProject
        ? html`<span class="pcc-mobile-command-rail__terminal" data-pcc-mobile-terminal-status
            >No action required</span
          >`
        : html`<button
            class="btn pcc-action-primary"
            type="button"
            data-pcc-mobile-primary-action
            ?disabled=${!detail || props.actionBusy}
            @click=${(event: Event) =>
              detail &&
              runResolvedProjectPrimaryAction(
                resolver!,
                detail,
                props,
                event.currentTarget as HTMLElement,
              )}
          >
            ${resolver?.primaryLabel ?? "Select Project"}
          </button>`}
      ${terminalProject
        ? nothing
        : html`<span>${activeCount} active</span>
            <span>${needsYouCount} needs you</span>
            <span>${runningCount} running</span>`}
    </div>
    <nav
      class="pcc-mobile-section-tabs"
      data-pcc-mobile-section-tabs
      aria-label="PCC mobile sections"
    >
      ${tabs.map(
        (tab) => html`<button
          class=${tab.id === "projects" && !hasProject ? "is-active" : ""}
          type="button"
          data-pcc-mobile-section-tab=${tab.id}
          ?disabled=${tab.disabled}
          aria-current=${tab.id === "projects" && !hasProject ? "true" : nothing}
          aria-label=${`Open PCC ${tab.label} section`}
          @click=${(event: Event) =>
            openPccMobileSection(tab.id, props, event.currentTarget as HTMLElement)}
        >
          ${tab.label}
        </button>`,
      )}
    </nav>
  </section>`;
}

function renderTruthFact(label: string, value: string) {
  return html`<div
    class="pcc-current-truth__button"
    role="button"
    tabindex="0"
    @click=${scrollPccDetailIntoView}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        scrollPccDetailIntoView();
      }
    }}
  >
    <dt>${label}</dt>
    <dd>${value || "None"}</dd>
  </div>`;
}

function productionTruthDetail(props: PccDashboardProps): PccProjectDetail | null {
  const details = Object.values(props.projectDetails ?? {});
  return (
    details.find(
      (detail) =>
        detail.project.id === "project-command-center" ||
        detail.project.title === "Project Command Center",
    ) ??
    (props.projectDetail?.project.id === "project-command-center" ||
    props.projectDetail?.project.title === "Project Command Center"
      ? props.projectDetail
      : null)
  );
}

function liveRuntimeTruthInput(props: PccDashboardProps) {
  return {
    ...(props.releaseGovernance?.proofProfile
      ? { proofProfile: props.releaseGovernance.proofProfile }
      : {}),
    ...(props.runtimeIdentity
      ? {
          runtimeSha: props.runtimeIdentity.runtimeSha,
          runtimeEntrypoint: props.runtimeIdentity.runtimeEntrypoint,
          expectedRuntimeRoot: props.runtimeIdentity.expectedRuntimeRoot,
          runtimeDriftReason:
            props.runtimeIdentity.driftReason ??
            (props.runtimeIdentity.verified
              ? undefined
              : "Active Gateway did not expose a verified runtime identity."),
        }
      : {}),
  };
}

function renderProductionTruthCard(props: PccDashboardProps) {
  const detail = productionTruthDetail(props);
  const truth = buildPccProductionTruth({
    project: detail?.project,
    milestones: detail?.milestones ?? [],
    evidence: detail?.evidence ?? [],
    receipts: detail?.receipts ?? [],
    ...liveRuntimeTruthInput(props),
  });
  return html`<section
    class="pcc-production-truth pcc-production-truth--${truth.status}"
    data-pcc-production-truth
    data-pcc-production-truth-profile=${truth.proofProfile}
    data-pcc-production-source-proof=${truth.sourceProofPassed ? "passed" : "missing"}
    data-pcc-production-proof-source=${truth.proofProfile === "mac_studio_control_director"
      ? "local"
      : "remote"}
    data-pcc-production-current=${truth.status === "current" ? "true" : "false"}
    data-pcc-runtime-proof=${truth.runtimeProofPassed ? "passed" : "missing"}
    data-pcc-proof-gaps=${truth.proofGaps.length}
    aria-label="Production truth"
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Production truth</p>
        <h4>Is this dashboard current?</h4>
        <p>
          ${truth.status === "current"
            ? "Current proof is recorded. Historical evidence cleanup is listed separately."
            : "Open current proof gaps before claiming production completion."}
        </p>
      </div>
      <span>${truth.label}</span>
    </div>
    <dl class="pcc-production-truth__facts">
      <div>
        <dt>Verified SHA</dt>
        <dd>${truth.latestVerifiedSha ? truth.latestVerifiedSha.slice(0, 12) : "Not recorded"}</dd>
      </div>
      <div>
        <dt>Runtime SHA</dt>
        <dd>${truth.runtimeSha ? truth.runtimeSha.slice(0, 12) : "Not recorded"}</dd>
      </div>
      <div>
        <dt>
          ${truth.proofProfile === "mac_studio_control_director"
            ? "Current local source proof"
            : "Current remote proof"}
        </dt>
        <dd>
          ${truth.proofProfile === "mac_studio_control_director"
            ? truth.sourceProofPassed
              ? "Passed"
              : "Missing"
            : truth.remoteProofPassed
              ? "Passed"
              : "Missing"}
        </dd>
      </div>
      <div>
        <dt>Current runtime proof</dt>
        <dd>${truth.runtimeProofPassed ? "Passed" : "Missing"}</dd>
      </div>
      <div>
        <dt>Current browser proof</dt>
        <dd>${truth.browserProofScreenshotPath ?? "No screenshot recorded"}</dd>
      </div>
      <div>
        <dt>Historical evidence</dt>
        <dd>${truth.historicalEvidenceGaps.length ? "Cleanup needed" : "OK"}</dd>
      </div>
    </dl>
    <details class="pcc-production-truth__ledger">
      <summary>Proof ledger and do-not-redo notes</summary>
      <div>
        <strong>Current proof gaps</strong>
        ${truth.proofGaps.length
          ? html`<ul>
              ${truth.proofGaps.slice(0, 8).map((gap) => html`<li>${gap}</li>`)}
            </ul>`
          : html`<p>No proof gaps recorded.</p>`}
      </div>
      <div>
        <strong>Historical evidence cleanup</strong>
        ${truth.historicalEvidenceGaps.length
          ? html`<ul>
              ${truth.historicalEvidenceGaps.slice(0, 8).map((gap) => html`<li>${gap}</li>`)}
            </ul>`
          : html`<p>No historical evidence cleanup recorded.</p>`}
      </div>
      <div>
        <strong>Completed milestones</strong>
        ${truth.completedMilestones.length
          ? html`<ul>
              ${truth.completedMilestones.slice(0, 8).map((title) => html`<li>${title}</li>`)}
            </ul>`
          : html`<p>No completed milestones recorded.</p>`}
      </div>
      <div>
        <strong>Do not redo</strong>
        ${truth.doNotRedoNotes.length
          ? html`<ul>
              ${truth.doNotRedoNotes.map((note) => html`<li>${note}</li>`)}
            </ul>`
          : html`<p>No do-not-redo notes recorded.</p>`}
      </div>
    </details>
  </section>`;
}

function renderReleaseGovernance(props: PccDashboardProps) {
  if ((props.productFocusMode ?? "project_work") !== "pcc_product") {
    return nothing;
  }
  const status = props.releaseGovernance;
  const blocked = status?.decision === "deny" || status?.decision === "escalate";
  const passedChecks = status?.checks.filter((check) => check.status === "passed").length ?? 0;
  const totalChecks = status?.checks.length ?? 0;
  const capabilityChanges =
    status?.capabilityDiff.filter((entry) => entry.change !== "unchanged") ?? [];
  return html`<details
    class="pcc-release-governance ${blocked ? "is-blocked" : ""}"
    data-pcc-release-governance
    ?open=${blocked}
  >
    <summary>
      <span>
        <span class="pcc-kicker">Deployment governance</span>
        <strong
          >${status?.candidateSha
            ? `Candidate ${status.candidateSha.slice(0, 12)}`
            : "No candidate waiting"}</strong
        >
      </span>
      <span class="pcc-release-governance__decision">
        ${status?.riskLevel ?? "No risk"} · ${status?.decision ?? "none"}
      </span>
    </summary>
    ${status
      ? html`<div class="pcc-release-governance__body">
          <dl class="pcc-release-governance__facts">
            <div>
              <dt>Active runtime</dt>
              <dd>${status.activeRuntimeSha?.slice(0, 12) ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd>${status.candidateSha?.slice(0, 12) ?? "None"}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>${status.riskLevel ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Checks</dt>
              <dd>${passedChecks}/${totalChecks} passed</dd>
            </div>
            <div>
              <dt>Proof profile</dt>
              <dd>
                ${status.proofProfile === "mac_studio_control_director"
                  ? "Mac Studio · Control Director v1"
                  : "Default"}
              </dd>
            </div>
            <div>
              <dt>Approval</dt>
              <dd>${status.approvalStatus.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Rollback target</dt>
              <dd>${status.rollbackTarget?.slice(0, 12) ?? "Not recorded"}</dd>
            </div>
          </dl>
          ${status.exactBlocker
            ? html`<div class="pcc-callout" role="alert">
                <strong>Blocked</strong><span>${status.exactBlocker}</span>
              </div>`
            : nothing}
          <div class="pcc-release-governance__columns">
            <section>
              <h4>Protected paths</h4>
              ${status.protectedPaths.length
                ? html`<ul>
                    ${status.protectedPaths.map(
                      (entry) => html`<li><code>${entry.path}</code> — ${entry.reason}</li>`,
                    )}
                  </ul>`
                : html`<p>None touched.</p>`}
            </section>
            <section>
              <h4>Capability changes</h4>
              ${capabilityChanges.length
                ? html`<ul>
                    ${capabilityChanges.map(
                      (entry) =>
                        html`<li>
                          <strong>${entry.id}</strong>: ${entry.change} — ${entry.reason}
                        </li>`,
                    )}
                  </ul>`
                : html`<p>Required capabilities are unchanged.</p>`}
            </section>
          </div>
          <section>
            <h4>Checks and reviewers</h4>
            <ul class="pcc-release-governance__checks">
              ${status.checks.map(
                (check) =>
                  html`<li>
                    <span>${check.status === "passed" ? "✓" : "!"}</span><strong>${check.id}</strong
                    ><small>${check.summary}</small>
                  </li>`,
              )}
              ${status.reviews.map(
                (review) =>
                  html`<li>
                    <span>${review.decision === "approve" ? "✓" : "!"}</span
                    ><strong>${review.role.replaceAll("_", " ")}</strong
                    ><small
                      >${review.decision} · ${Math.round(review.confidence * 100)}%
                      confidence</small
                    >
                  </li>`,
              )}
            </ul>
          </section>
          <p><strong>Evidence receipt:</strong> ${status.evidenceReceiptHash ?? "Not recorded"}</p>
          ${status.approvalWording
            ? html`<label class="pcc-release-governance__approval">
                <span>Exact approval required</span>
                <textarea readonly .value=${status.approvalWording}></textarea>
                <button
                  class="btn"
                  type="button"
                  @click=${() => void navigator.clipboard?.writeText(status.approvalWording ?? "")}
                >
                  Copy approval wording
                </button>
              </label>`
            : nothing}
        </div>`
      : html`<div class="pcc-release-governance__empty">
          <p>No release candidate has been evaluated. Deployment remains fail closed.</p>
        </div>`}
  </details>`;
}

function renderProductionTruthDrawer(props: PccDashboardProps) {
  const detail = productionTruthDetail(props);
  const truth = buildPccProductionTruth({
    project: detail?.project,
    milestones: detail?.milestones ?? [],
    evidence: detail?.evidence ?? [],
    receipts: detail?.receipts ?? [],
    ...liveRuntimeTruthInput(props),
  });
  const openByDefault = pccViewMode(props) !== "simple" && truth.status !== "current";
  const badgeLabel =
    truth.status === "current" ? "Current proof: OK" : `Current proof: ${truth.label}`;
  if (pccViewMode(props) === "simple" && truth.status === "current") {
    return nothing;
  }
  return html`<details class="pcc-detail-drawer pcc-top-proof-drawer" ?open=${openByDefault}>
    <summary><span class="pcc-proof-badge" data-pcc-proof-badge>${badgeLabel}</span></summary>
    ${renderProductionTruthCard(props)}
  </details>`;
}

function renderUpdateSafetyDrawer(props: PccDashboardProps) {
  const safety = props.updateSafety;
  if (!safety) {
    return nothing;
  }
  const protectedRuntime = safety.status === "protected";
  const label = protectedRuntime
    ? safety.approvalPending
      ? "Update ready for approval"
      : "Customizations protected"
    : safety.status === "attention"
      ? "Update protection needs attention"
      : "Standard OpenClaw runtime";
  return html`<details
    class="pcc-detail-drawer pcc-top-proof-drawer"
    data-pcc-update-safety
    ?open=${safety.status === "attention"}
  >
    <summary><span class="pcc-proof-badge">${label}</span></summary>
    <section
      class="pcc-production-truth pcc-production-truth--${protectedRuntime ? "current" : "blocked"}"
      aria-label="Update safety"
    >
      <div class="pcc-section-heading">
        <div>
          <p class="pcc-kicker">Update safety</p>
          <h4>Will an OpenClaw update keep custom features?</h4>
          <p>
            ${protectedRuntime
              ? "Yes. Standard updates are blocked and candidates must preserve every registered capability before approval."
              : "Do not update this runtime until every protection item below is resolved."}
          </p>
        </div>
        <span>${safety.status}</span>
      </div>
      <dl class="pcc-production-truth__facts">
        <div>
          <dt>Standard update</dt>
          <dd>${safety.standardUpdateBlocked ? "Blocked safely" : "Available"}</dd>
        </div>
        <div>
          <dt>Durable source</dt>
          <dd>${safety.sourceDurable ? "Verified" : "Missing"}</dd>
        </div>
        <div>
          <dt>Update broker</dt>
          <dd>${safety.brokerConfigured ? "Scheduled" : "Missing or inactive"}</dd>
        </div>
        <div>
          <dt>Runtime guard</dt>
          <dd>${safety.runtimeGuardConfigured ? "Scheduled" : "Missing or inactive"}</dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>${safety.approvalPending ? "Waiting for you" : "No candidate waiting"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>${safety.sourceSha ? safety.sourceSha.slice(0, 12) : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>${safety.sourceBranch ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Active release</dt>
          <dd>${safety.activeRelease ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Last update result</dt>
          <dd>${safety.lastReceipt?.result ?? "No receipt"}</dd>
        </div>
      </dl>
      ${safety.issues.length
        ? html`<ul>
            ${safety.issues.map((issue) => html`<li>${issue}</li>`)}
          </ul>`
        : html`<p>All update-preservation controls are healthy.</p>`}
    </section>
  </details>`;
}

function projectHeroProofBadge(detail: PccProjectDetail, props: PccDashboardProps) {
  if (
    detail.project.id === "project-command-center" ||
    detail.project.title === "Project Command Center"
  ) {
    const productionDetail = productionTruthDetail(props);
    const truth = buildPccProductionTruth({
      project: productionDetail?.project,
      milestones: productionDetail?.milestones ?? [],
      evidence: productionDetail?.evidence ?? [],
      receipts: productionDetail?.receipts ?? [],
      ...liveRuntimeTruthInput(props),
    });
    if (truth.status !== "current") {
      return `Current proof: ${truth.label}`;
    }
    return truth.historicalEvidenceGaps.length
      ? "Current proof: OK · History cleanup"
      : "Current proof: OK";
  }
  return detail.summary.proofGaps.length > 0
    ? `Current proof: ${detail.summary.proofGaps.length} gap${detail.summary.proofGaps.length === 1 ? "" : "s"}`
    : "Current proof: Ready";
}

function impactInputFromDetail(detail: PccProjectDetail): PccImpactDetailInput {
  return {
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions ?? [],
    evidence: detail.evidence ?? [],
    receipts: detail.receipts ?? [],
    summary: detail.summary,
  };
}

function availableImpactDetails(props: PccDashboardProps): PccImpactDetailInput[] {
  const details = Object.values(props.projectDetails ?? {});
  if (
    props.projectDetail &&
    !details.some((detail) => detail.project.id === props.projectDetail?.project.id)
  ) {
    details.push(props.projectDetail);
  }
  return details.map(impactInputFromDetail);
}

function renderImpactAttentionInbox(props: PccDashboardProps) {
  const inbox = buildPccAttentionInbox(availableImpactDetails(props));
  return html`<section
    class="pcc-impact pcc-impact--inbox"
    data-pcc-impact-inbox
    aria-label="Attention inbox"
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Attention inbox</p>
        <h4>What needs my attention?</h4>
        <p>
          Shows blockers, missing permissions, proof gaps, and setup quality issues across active
          projects.
        </p>
      </div>
      <span>${inbox.length} item${inbox.length === 1 ? "" : "s"}</span>
    </div>
    ${inbox.length
      ? html`<ol class="pcc-impact-list">
          ${inbox.map(
            (item) => html`<li class="pcc-impact-item pcc-impact-item--${item.severity}">
              <strong>${item.title}</strong>
              <span>${item.projectTitle}</span>
              <p>${item.reason}</p>
            </li>`,
          )}
        </ol>`
      : html`<p class="pcc-empty pcc-empty--small">No urgent PCC attention items.</p>`}
  </section>`;
}

function formatVerifiedAt(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : formatUpdatedAt(time);
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function renderLastKnownGoodList(entries: readonly PccLastKnownGood[] | undefined) {
  const sorted = (entries ?? []).toSorted(
    (a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt),
  );
  if (sorted.length === 0) {
    return nothing;
  }
  return html`<div class="pcc-last-known-good" data-pcc-last-known-good>
    <p class="pcc-kicker">Last verified</p>
    <ul>
      ${sorted.slice(0, 6).map(
        (entry) => html`<li>
          <strong>${entry.subsystem}</strong>
          <span>${entry.summary}</span>
          <small>
            Verified ${formatVerifiedAt(entry.verifiedAt)}
            ${entry.sha ? html` · SHA ${entry.sha.slice(0, 12)}` : nothing}
            ${stringArray(entry.evidenceIds).length
              ? html` · ${stringArray(entry.evidenceIds).length} evidence
                link${stringArray(entry.evidenceIds).length === 1 ? "" : "s"}`
              : nothing}
          </small>
        </li>`,
      )}
    </ul>
  </div>`;
}

function renderImpactDetailCards(detail: PccProjectDetail, props: PccDashboardProps) {
  const input = impactInputFromDetail(detail);
  const readiness = buildPccMilestoneReadiness(input).slice(0, 5);
  const freshness = buildPccProofFreshness(input).slice(0, 5);
  const recovery = buildPccRecoveryPlaybooks(input);
  const dependency = buildPccDependencyInsights(input);
  const allIntegrity = buildPccIntegrityFindings(input);
  const integrity = allIntegrity.slice(0, 5);
  const canNormalizeSequence = allIntegrity.some(
    (item) => item.id.startsWith("milestone-order:") || item.id.startsWith("sub-order:"),
  );
  const canRemoveStaleDependencies = allIntegrity.some(
    (item) => item.id.startsWith("milestone-dependency:") || item.id.startsWith("sub-dependency:"),
  );
  const canRepairDuplicateTitles = allIntegrity.some(
    (item) => item.id.startsWith("milestone-title:") || item.id.startsWith("sub-title:"),
  );
  const timeline = buildPccTimeline(input);
  const importText = props.chatSyncText.trim()
    ? props.chatSyncText
    : `# ${detail.project.title}\nGoal: ${detail.project.goal ?? "Project goal"}\n${detail.milestones
        .slice(0, 6)
        .map((milestone, index) => `${index + 1}. ${milestone.title}`)
        .join("\n")}\nProof: receipt-backed verification required.`;
  const preview = previewPccProjectImport(importText);
  return html`<details class="pcc-detail-drawer" data-pcc-impact-detail open>
    <summary>Impact controls</summary>
    <section class="pcc-impact-grid" aria-label="PCC impact controls">
      <article class="pcc-impact-card" data-pcc-low-reasoning-readiness>
        <p class="pcc-kicker">Low-reasoning readiness</p>
        <h4>Can a small model execute this?</h4>
        ${readiness.length
          ? html`<ul>
              ${readiness.map(
                (item) => html`<li>
                  <strong>${item.title}</strong>
                  <span>${item.score}/100 · ${item.badge}</span>
                  ${item.gaps.length ? html`<small>${item.gaps.join("; ")}</small>` : nothing}
                </li>`,
              )}
            </ul>`
          : html`<p>No milestones yet.</p>`}
      </article>
      <article class="pcc-impact-card" data-pcc-proof-freshness>
        <p class="pcc-kicker">Proof freshness</p>
        <h4>Are receipts current?</h4>
        <ul>
          ${freshness.map(
            (item) => html`<li>
              <strong>${item.title}</strong>
              <span>${formatStatus(item.status)} · ${item.reason}</span>
            </li>`,
          )}
        </ul>
      </article>
      <article class="pcc-impact-card" data-pcc-critical-path>
        <p class="pcc-kicker">Critical path</p>
        <h4>${dependency.criticalPathTitle}</h4>
        <p>${dependency.readyCount} ready · ${dependency.blockedCount} blocked by dependencies</p>
        ${dependency.notes.length
          ? html`<ul>
              ${dependency.notes.map((note) => html`<li>${note}</li>`)}
            </ul>`
          : nothing}
      </article>
      <article class="pcc-impact-card" data-pcc-recovery-playbooks>
        <p class="pcc-kicker">Recovery playbooks</p>
        <h4>How to recover if stuck</h4>
        <ul>
          ${recovery.map(
            (item) => html`<li>
              <strong>${item.title}</strong>
              <span>${item.nextAction}</span>
            </li>`,
          )}
        </ul>
      </article>
      <article class="pcc-impact-card" data-pcc-plan-integrity>
        <p class="pcc-kicker">Plan integrity</p>
        <h4>
          ${integrity.length
            ? `${integrity.length} issue${integrity.length === 1 ? "" : "s"}`
            : "No broken links"}
        </h4>
        ${integrity.length
          ? html`<ul>
              ${integrity.map(
                (item) => html`<li>
                  <strong>${item.title}</strong>
                  <span>${item.reason}</span>
                  <small>${item.repair}</small>
                </li>`,
              )}
            </ul>`
          : html`<p>
              Milestone links, sub-milestone parents, and sequence slots look consistent.
            </p>`}
        ${canNormalizeSequence || canRemoveStaleDependencies || canRepairDuplicateTitles
          ? html`<div class="pcc-inline-actions" data-pcc-integrity-actions>
              ${canRepairDuplicateTitles
                ? html`<button
                    type="button"
                    class="pcc-button pcc-button--secondary"
                    data-pcc-repair-duplicate-titles
                    ?disabled=${props.actionBusy}
                    @click=${() => props.onRepairDuplicateTitles?.()}
                  >
                    Make titles unique
                  </button>`
                : nothing}
              ${canNormalizeSequence
                ? html`<button
                    type="button"
                    class="pcc-button pcc-button--secondary"
                    data-pcc-normalize-sequence
                    ?disabled=${props.actionBusy}
                    @click=${() => props.onNormalizeProjectSequence?.()}
                  >
                    Normalize sequence
                  </button>`
                : nothing}
              ${canRemoveStaleDependencies
                ? html`<button
                    type="button"
                    class="pcc-button pcc-button--secondary"
                    data-pcc-remove-stale-dependencies
                    ?disabled=${props.actionBusy}
                    @click=${() => props.onRemoveStaleDependencies?.()}
                  >
                    Remove stale dependencies
                  </button>`
                : nothing}
            </div>`
          : nothing}
      </article>
      <article class="pcc-impact-card" data-pcc-project-history>
        <p class="pcc-kicker">Project history</p>
        <h4>Receipts and verified state</h4>
        ${renderLastKnownGoodList(detail.lastKnownGood)}
        ${timeline.length
          ? html`<ul>
              ${timeline.map(
                (item) => html`<li><strong>${item.title}</strong><span>${item.summary}</span></li>`,
              )}
            </ul>`
          : !detail.lastKnownGood?.length
            ? html`<p>No receipts, evidence, or verified state yet.</p>`
            : nothing}
      </article>
      <article class="pcc-impact-card" data-pcc-any-source-intake>
        <p class="pcc-kicker">Any-source intake</p>
        <h4>Import project plan preview</h4>
        <p>${preview.title}</p>
        <span
          >${preview.proposedMilestones.length}
          milestone${preview.proposedMilestones.length === 1 ? "" : "s"} found ·
          ${preview.missingFields.length} gap${preview.missingFields.length === 1 ? "" : "s"}</span
        >
        <small>Preview only. PCC never rewrites a project silently.</small>
      </article>
    </section>
  </details>`;
}

function renderStatusOptions(statuses: PccStatus[]) {
  return statuses.map((status) => html`<option value=${status}>${formatStatus(status)}</option>`);
}

function renderStringOptions(options: readonly (readonly [string, string])[], selected: string) {
  return options.map(
    ([value, label]) => html`<option value=${value} ?selected=${value === selected}>
      ${label}
    </option>`,
  );
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

function projectOutcomeMetrics(project: unknown): string[] {
  return metadataStringArray(metadataObject(metadataObject(project).metadata).pccOutcomeMetrics);
}

function formatProjectActivity(value: string | undefined): string {
  if (!value) {
    return "No recent activity";
  }
  const [label, at] = value.split(" · ");
  if (!at) {
    return value;
  }
  const time = Date.parse(at);
  if (Number.isNaN(time)) {
    return value;
  }
  return `${label} · ${formatUpdatedAt(time)}`;
}

function projectActivityParts(value: string | undefined): { label: string; time: number } | null {
  if (!value) {
    return null;
  }
  const [label, at] = value.split(" · ");
  const time = Date.parse(at ?? "");
  if (!label?.trim() || Number.isNaN(time)) {
    return null;
  }
  return { label: label.trim(), time };
}

function projectRecentActivityItems(projects: readonly PccProjectSummary[]) {
  return projects
    .map((project) => ({ project, activity: projectActivityParts(project.recentActivity) }))
    .filter(
      (item): item is { project: PccProjectSummary; activity: { label: string; time: number } } =>
        item.activity !== null,
    )
    .toSorted(
      (a, b) => b.activity.time - a.activity.time || a.project.title.localeCompare(b.project.title),
    );
}

function projectDetailIntakeSourceText(detail: PccProjectDetail | null | undefined): string {
  if (!detail) {
    return "";
  }
  const projectMetadata = metadataObject(detail.project.metadata);
  return [
    detail.project.title,
    detail.project.goal ?? "",
    metadataString(projectMetadata.pccProjectDescription, ""),
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
    .filter(Boolean)
    .join("\n")
    .trim();
}

function projectIntakeSourceText(
  form: PccProjectFormState,
  detail?: PccProjectDetail | null,
): string {
  return [form.projectDescription, form.goal, form.title, projectDetailIntakeSourceText(detail)]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function localExecutionFormPatch(
  form: PccProjectFormState,
  speed: PccExecutionSpeed,
): Partial<PccProjectFormState> {
  const executionProfile = applyPccLocalExecutionPreset(form.executionProfile, speed);
  return {
    executionProfile,
    plannerPermissionScope: executionProfile.approvalScope,
    plannerPermissionBudget: "",
    planPreviewAccepted: false,
  };
}

function codexPolicyFormPatch(
  form: PccProjectFormState,
  codexPolicyId: PccCodexPolicyId,
): Partial<PccProjectFormState> {
  const executionProfile = applyPccCodexPolicy(form.executionProfile, codexPolicyId);
  return {
    executionProfile,
    codexPlanningAllowed: codexPolicyId === "local_only" ? false : form.codexPlanningAllowed,
    plannerPermissionScope: executionProfile.approvalScope,
    plannerPermissionBudget: "",
    planPreviewAccepted: false,
  };
}

function executionProfileFieldPatch(
  form: PccProjectFormState,
  patch: Partial<PccExecutionProfile>,
): Partial<PccProjectFormState> {
  const executionProfile = { ...form.executionProfile, ...patch };
  return {
    executionProfile,
    plannerPermissionScope: executionProfile.approvalScope,
    codexPlanningAllowed: executionProfile.codexRole === "off" ? false : form.codexPlanningAllowed,
    planPreviewAccepted: false,
  };
}

function localExecutionOption(speed: PccExecutionSpeed) {
  return (
    LOCAL_EXECUTION_OPTIONS.find((option) => option.value === speed) ?? LOCAL_EXECUTION_OPTIONS[0]
  );
}

function codexPolicyOption(id: PccCodexPolicyId) {
  return CODEX_POLICY_OPTIONS.find((option) => option.value === id) ?? CODEX_POLICY_OPTIONS[0];
}

function initialPlannerUsesCodex(form: PccProjectFormState): boolean {
  return form.plannerMode === "codex" || form.plannerMode === "high_reasoning_codex";
}

function planningActionDisabled(
  props: Pick<PccDashboardProps, "actionBusy" | "planningPolicy" | "projectForm">,
): boolean {
  return (
    props.actionBusy ||
    (initialPlannerUsesCodex(props.projectForm) && props.planningPolicy?.grant.enabled === false)
  );
}

function initialPlannerPatch(mode: "local_model" | "codex"): Partial<PccProjectFormState> {
  return {
    plannerMode: mode,
    planningMode: mode === "codex" ? "codex_full_plan" : "template_only",
    plannerModelId: mode === "codex" ? PCC_CODEX_PLANNER_MODEL : PCC_LOCAL_PLANNER_MODEL,
  };
}

function initialPlannerLabel(form: PccProjectFormState): "Local AI" | "Codex" {
  return initialPlannerUsesCodex(form) ? "Codex" : "Local AI";
}

function projectActionLabel(action: PccProjectActionResolution, form: PccProjectFormState): string {
  return action.primaryActionId === "fix_setup"
    ? `Plan Setup with ${initialPlannerLabel(form)}`
    : action.primaryLabel;
}

function projectCreationAiTruth(form: PccProjectFormState): string {
  const planning = form.generatedPlan
    ? `${form.generatedPlan.provenance.model} generated this plan at ${form.generatedPlan.provenance.effort} effort.`
    : initialPlannerUsesCodex(form)
      ? "Codex GPT-5.6 Sol will generate the project plan after you explicitly choose Codex."
      : "Local AI will generate the project plan by default; Codex is available only when explicitly selected.";
  const execution =
    form.executionProfile.codexPolicyId === "local_only"
      ? "OpenClaw local agents execute and review the work."
      : `OpenClaw local agents execute routine work. Codex checkpoints remain visible and approval-gated after ${initialPlannerLabel(form)} planning.`;
  return `${planning} ${execution}`;
}

function projectCreationBlankCount(form: PccProjectFormState): number {
  return (
    Number(!form.title.trim()) +
    Number(!form.goal.trim()) +
    Number(!(form.outcomeMetrics ?? "").trim()) +
    pccMissingRequiredIntakeAnswers(form.intakeAnswers).length
  );
}

function projectCreationDraftStats(form: PccProjectFormState): {
  milestones: number;
  subMilestones: number;
} {
  if (form.generatedPlan) {
    return {
      milestones: form.generatedPlan.milestones.length,
      subMilestones: form.generatedPlan.milestones.reduce(
        (count, item) => count + item.subMilestones.length,
        0,
      ),
    };
  }
  const source = projectIntakeSourceText(form);
  const title = form.title.trim() || source.split(/\r?\n/u).find(Boolean)?.trim() || "New project";
  const goal = form.goal.trim() || source || `Complete ${title}.`;
  const draft = buildPccWorkflowDraft({
    title,
    goal,
    templateId: form.workflowTemplateId,
    planningMode: plannerModeToPlanningMode(form.plannerMode),
    codexPlanningAllowed: form.codexPlanningAllowed,
    remoteProofAllowed: form.remoteProofAllowed,
    runtimeActionsAllowed: form.runtimeActionsAllowed,
    aiUsePolicy: "local_only",
  });
  return {
    milestones: draft.milestones.length,
    subMilestones: Object.values(draft.subMilestonesByMilestoneTitle).reduce(
      (count, items) => count + items.length,
      0,
    ),
  };
}

function projectCreationRoutingStats(form: PccProjectFormState): {
  codex: number;
  local: number;
  gated: number;
} {
  if (form.generatedPlan) {
    const responsibilities = form.generatedPlan.milestones.flatMap((milestone) => [
      generatedPlanExecutionResponsibility(milestone.responsibility),
      ...milestone.subMilestones.map((item) =>
        generatedPlanExecutionResponsibility(item.responsibility),
      ),
    ]);
    return {
      codex: responsibilities.filter((value) => /codex/iu.test(value)).length,
      local: responsibilities.filter((value) => /local/iu.test(value)).length,
      gated: responsibilities.filter((value) => /user|remote/iu.test(value)).length,
    };
  }
  const source = projectIntakeSourceText(form);
  const draft = buildPccWorkflowDraft({
    title: form.title.trim() || source.split(/\r?\n/u).find(Boolean)?.trim() || "New project",
    goal: form.goal.trim() || source || "Complete the project.",
    templateId: form.workflowTemplateId,
    planningMode: plannerModeToPlanningMode(form.plannerMode),
    codexPlanningAllowed: form.codexPlanningAllowed,
    remoteProofAllowed: form.remoteProofAllowed,
    runtimeActionsAllowed: form.runtimeActionsAllowed,
    aiUsePolicy: "local_only",
  });
  return draft.milestones.reduce(
    (counts, milestone) => {
      const responsibility = metadataString(
        metadataObject(milestone.metadata).pccResponsibility,
        "",
      );
      if (responsibility.includes("codex")) {
        counts.codex += 1;
      } else if (responsibility === "user" || responsibility === "remote_proof") {
        counts.gated += 1;
      } else {
        counts.local += 1;
      }
      return counts;
    },
    { codex: 0, local: 0, gated: 0 },
  );
}

function generatedPlanExecutionResponsibility(value: string): string {
  return /^(?:remote_proof|user)$/u.test(value) ? value : "local_openclaw_agent";
}

function projectIntakeNeedsAiDraft(form: PccProjectFormState): boolean {
  return (
    !form.title.trim() ||
    !form.goal.trim() ||
    pccMissingRequiredIntakeAnswers(form.intakeAnswers).length > 0 ||
    !form.intakeApproved ||
    !form.planPreviewAccepted
  );
}

function projectFormContextDetail(props: PccDashboardProps): PccProjectDetail | null {
  return props.editorMode === "edit-project" &&
    props.projectForm.id &&
    props.projectDetail?.project.id === props.projectForm.id
    ? props.projectDetail
    : null;
}

function canPreviewProjectIntakeAutofill(props: PccDashboardProps): boolean {
  return Boolean(projectFormContextDetail(props) && props.onPreviewSetupAutofill);
}

function runProjectIntakeAutofill(props: PccDashboardProps): void {
  if (canPreviewProjectIntakeAutofill(props)) {
    props.onPreviewSetupAutofill?.();
    return;
  }
  runProjectIntakeFormAutofill(props);
}

function runProjectIntakeFormAutofill(props: PccDashboardProps): void {
  if (!props.projectForm.id && props.onGenerateProjectPlan) {
    props.onGenerateProjectPlan();
    return;
  }
  if (props.projectForm.id && props.onPreviewSetupAutofill) {
    props.onPreviewSetupAutofill();
  }
}

function projectIntakePrimaryAiLabel(props: PccDashboardProps): string {
  const planner = initialPlannerLabel(props.projectForm);
  return canPreviewProjectIntakeAutofill(props)
    ? `Plan setup repair with ${planner}`
    : `Generate plan with ${planner}`;
}

function renderProjectIntakeFormAutofillButton(
  props: PccDashboardProps,
  label = `Generate plan with ${initialPlannerLabel(props.projectForm)}`,
) {
  return html`<button
    class="btn pcc-intake-wizard__primary-ai"
    type="button"
    data-pcc-project-intake-page-autofill
    data-pcc-project-intake-autofill
    data-pcc-project-intake-ai-generate
    data-pcc-project-intake-form-only-autofill
    title=${`Use ${initialPlannerLabel(props.projectForm)} to plan from the current prompt while preserving everything you typed.`}
    ?disabled=${planningActionDisabled(props)}
    @click=${() => runProjectIntakeFormAutofill(props)}
  >
    ${label}
  </button>`;
}

function renderProjectIntakeAutofillButton(
  props: PccDashboardProps,
  label = projectIntakePrimaryAiLabel(props),
) {
  const previewsLedgerRepair = canPreviewProjectIntakeAutofill(props);
  const planner = initialPlannerLabel(props.projectForm);
  return html`<button
    class="btn pcc-intake-wizard__primary-ai"
    type="button"
    data-pcc-project-intake-page-autofill
    data-pcc-project-intake-autofill
    data-pcc-project-intake-ai-generate
    data-pcc-project-intake-primary-ai
    title=${previewsLedgerRepair
      ? `Preview a ${planner}-generated setup plan before applying it to this saved project.`
      : `Generate the missing project intake answers with ${planner} from the current context.`}
    ?disabled=${planningActionDisabled(props)}
    @click=${() => runProjectIntakeAutofill(props)}
  >
    ${label}
  </button>`;
}

const PCC_AI_REGENERATE_SECTIONS = [
  ["goal", "Goal"],
  ["intake", "Intake answers"],
  ["workflow", "Workflow"],
  ["milestones", "Milestones"],
  ["submilestones", "Sub-milestones"],
  ["criteria", "Acceptance criteria"],
  ["proof", "Proof requirements"],
  ["permissions", "Permissions"],
  ["blockers", "Blockers"],
  ["handoff", "Handoff packet"],
] as const;

function runSectionAiRegenerate(props: PccDashboardProps, section: PccAiRegenerateSection): void {
  if (projectFormContextDetail(props) && props.onPreviewSectionAutofill) {
    props.onPreviewSectionAutofill?.(section);
    return;
  }
  if (canPreviewProjectIntakeAutofill(props)) {
    props.onPreviewSetupAutofill?.();
    return;
  }
  runProjectIntakeFormAutofill(props);
}

function renderSectionAiRegeneratePanel(props: PccDashboardProps) {
  const planner = initialPlannerLabel(props.projectForm);
  return html`<section class="pcc-ai-regenerate" data-pcc-section-ai-regenerate>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Change this project with AI</p>
        <h4>Describe the change in your own words</h4>
        <p>
          ${planner} proposes a revised plan. PCC shows what will change, protects completed work,
          pauses affected active work, checks dependencies, and offers Undo after applying.
        </p>
      </div>
      <span>Planning only · nothing changes before review</span>
    </div>
    <label class="pcc-ai-regenerate__request">
      What should change?
      <textarea
        data-pcc-project-change-request
        rows="4"
        placeholder="Example: Add a mobile launch milestone, keep completed work unchanged, and make accessibility proof required."
        .value=${props.projectForm.changeRequest}
        @input=${(event: Event) =>
          props.onProjectFormChange({
            changeRequest: (event.target as HTMLTextAreaElement).value,
          })}
      ></textarea>
    </label>
    <button
      class="btn"
      type="button"
      data-pcc-preview-project-change
      ?disabled=${planningActionDisabled(props) || !props.projectForm.changeRequest.trim()}
      @click=${() => props.onGenerateProjectPlan?.()}
    >
      Preview project change with ${planner}
    </button>
    <details class="pcc-detail-drawer">
      <summary>Change only one section</summary>
      <p>Use these shortcuts when the rest of the project should remain exactly as it is.</p>
      <div class="pcc-ai-regenerate__grid">
        ${PCC_AI_REGENERATE_SECTIONS.map(
          ([id, label]) => html`<button
            class="btn btn--subtle"
            type="button"
            data-pcc-section-ai-regenerate=${id}
            ?disabled=${props.actionBusy}
            @click=${() => runSectionAiRegenerate(props, id)}
          >
            Regenerate ${label}
          </button>`,
        )}
      </div>
    </details>
  </section>`;
}

function renderProjectEditModeTabs(props: PccDashboardProps) {
  const mode = props.projectEditMode ?? "simple";
  return html`<nav
    class="pcc-edit-mode-tabs"
    data-pcc-project-edit-modes
    aria-label="Project edit modes"
  >
    <button
      class=${mode === "simple" ? "btn" : "btn btn--subtle"}
      type="button"
      data-pcc-edit-mode="simple"
      aria-pressed=${mode === "simple"}
      @click=${() => props.onSetProjectEditMode?.("simple")}
    >
      Basics
    </button>
    <button
      class=${mode === "advanced" ? "btn" : "btn btn--subtle"}
      type="button"
      data-pcc-edit-mode="advanced"
      aria-pressed=${mode === "advanced"}
      @click=${() => props.onSetProjectEditMode?.("advanced")}
    >
      Full plan
    </button>
    <button
      class=${mode === "ai" ? "btn" : "btn btn--subtle"}
      type="button"
      data-pcc-edit-mode="ai"
      aria-pressed=${mode === "ai"}
      @click=${() => props.onSetProjectEditMode?.("ai")}
    >
      AI help
    </button>
  </nav>`;
}

function renderPlannerPermissionCard(props: PccDashboardProps) {
  const form = props.projectForm;
  const needsPermission = form.executionProfile.codexPolicyId !== "local_only";
  if (!needsPermission) {
    return nothing;
  }
  const selected = codexPolicyOption(form.executionProfile.codexPolicyId);
  return html`<section class="pcc-planner-permission" data-pcc-planner-permission-card>
    <div>
      <p class="pcc-kicker">Codex checkpoint permission</p>
      <h4>
        ${form.codexPlanningAllowed
          ? "Recommended checkpoints approved"
          : "PCC will ask before the first Codex checkpoint"}
      </h4>
      <p>
        ${selected.title}: ${selected.detail} Initial planning uses the engine selected above. This
        optional approval covers only the visible post-plan project checkpoints below.
      </p>
      <p data-pcc-codex-usage-guidance>
        ${selected.usage}. Deployment, credentials, destructive actions, purchases, publishing,
        reboot, and unrelated external writes always remain separate approval gates. There is no
        hard token cap; PCC records the model, effort, reason, and completed Codex runs instead.
      </p>
    </div>
    <div class="pcc-planner-permission__fields">
      <label>
        Ask again
        <select
          data-pcc-planner-permission-scope
          .value=${form.plannerPermissionScope}
          @change=${(event: Event) =>
            props.onProjectFormChange({
              plannerPermissionScope: (event.target as HTMLSelectElement).value as
                | "plan"
                | "project"
                | "ask",
              executionProfile: {
                ...form.executionProfile,
                approvalScope: (event.target as HTMLSelectElement).value as
                  | "plan"
                  | "project"
                  | "ask",
              },
            })}
        >
          <option value="project">Only when this project exceeds the selected role</option>
          <option value="plan">After this plan</option>
          <option value="ask">Before every Codex action</option>
        </select>
      </label>
    </div>
    ${form.codexPlanningAllowed
      ? html`<p data-pcc-planner-permission-saved>
          Saved: ${selected.title} · ${formatStatus(form.plannerPermissionScope)} scope · no hard
          token cap
        </p>`
      : nothing}
    <div class="pcc-planner-permission__actions">
      <button
        class="btn"
        type="button"
        data-pcc-planner-permission-allow
        ?disabled=${props.actionBusy || form.codexPlanningAllowed}
        @click=${() => props.onProjectFormChange({ codexPlanningAllowed: true })}
      >
        ${form.codexPlanningAllowed ? "Approved" : "Approve recommended checkpoints"}
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-planner-permission-cancel
        ?disabled=${props.actionBusy}
        @click=${() => props.onProjectFormChange(codexPolicyFormPatch(form, "local_only"))}
      >
        Use local AI only
      </button>
    </div>
  </section>`;
}

function setupEvaluationForDetail(detail: PccProjectDetail) {
  return evaluatePccProjectSetup({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
  });
}

function workStartBlockersForDetail(detail: PccProjectDetail): string[] {
  return buildPccWorkStartBlockers({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
}

function renderAutofillPreview(props: PccDashboardProps) {
  const preview = props.autofillPreview;
  if (!preview) {
    return nothing;
  }
  const generatedMilestones = preview.generatedMilestones ?? [];
  const generatedSubMilestones = preview.generatedSubMilestones ?? [];
  const filledSetupCount =
    Number(Boolean(preview.goal?.trim())) +
    Object.values(preview.intakeAnswers).filter((value) => value.trim()).length +
    Number(Boolean(preview.workflowTitle?.trim()));
  return html`<section class="pcc-autofill-preview" data-pcc-autofill-preview tabindex="-1">
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">${initialPlannerLabel(props.projectForm)} Plan Preview</p>
        <h4>Review before applying</h4>
        <p>${preview.summary}</p>
        <p class="pcc-autofill-preview__summary" data-pcc-autofill-preview-summary>
          AI will fill ${filledSetupCount} setup field${filledSetupCount === 1 ? "" : "s"}, add
          ${generatedMilestones.length} milestone${generatedMilestones.length === 1 ? "" : "s"}, add
          ${generatedSubMilestones.length}
          sub-step${generatedSubMilestones.length === 1 ? "" : "s"}, and require approval before
          work starts.
        </p>
      </div>
      <span
        >${preview.sectionTitle ? `Scoped: ${preview.sectionTitle}` : preview.workflowTitle}</span
      >
    </div>
    <dl class="pcc-workflow-quality__facts">
      <div>
        <dt>Goal</dt>
        <dd>${preview.goal}</dd>
      </div>
      <div>
        <dt>Intake answers</dt>
        <dd>${Object.values(preview.intakeAnswers).filter((value) => value.trim()).length}</dd>
      </div>
      <div>
        <dt>Milestone fixes</dt>
        <dd>${preview.milestoneUpdates.length}</dd>
      </div>
      <div>
        <dt>Sub-step fixes</dt>
        <dd>${preview.subMilestoneUpdates.length}</dd>
      </div>
      <div>
        <dt>New milestones</dt>
        <dd>${generatedMilestones.length}</dd>
      </div>
      <div>
        <dt>New sub-steps</dt>
        <dd>${generatedSubMilestones.length}</dd>
      </div>
      <div>
        <dt>Scope</dt>
        <dd>${preview.sectionTitle ?? "Full setup repair"}</dd>
      </div>
    </dl>
    <ul class="pcc-autofill-preview__changes">
      ${generatedMilestones
        .slice(0, 4)
        .map(
          (item) =>
            html`<li>
              <strong>${item.title}</strong> · creates milestone with
              ${item.subMilestoneTitles.length} sub-steps
            </li>`,
        )}
      ${generatedSubMilestones
        .slice(0, 4)
        .map(
          (item) =>
            html`<li>
              <strong>${item.title}</strong> · creates sub-step under ${item.milestoneTitle}
            </li>`,
        )}
      ${preview.milestoneUpdates
        .slice(0, 4)
        .map((item) => html`<li><strong>${item.title}</strong> · ${item.fields.join(", ")}</li>`)}
      ${preview.subMilestoneUpdates
        .slice(0, 4)
        .map((item) => html`<li><strong>${item.title}</strong> · ${item.fields.join(", ")}</li>`)}
    </ul>
    <label class="pcc-autofill-preview__approval">
      <input
        type="checkbox"
        .checked=${preview.intakeApproved}
        ?disabled=${props.actionBusy}
        @change=${(event: Event) =>
          props.onSetAutofillApproval?.((event.target as HTMLInputElement).checked)}
      />
      Approve this setup after applying
    </label>
    <div class="pcc-autofill-preview__actions">
      <button
        class="btn"
        type="button"
        data-pcc-autofill-apply
        ?disabled=${props.actionBusy}
        @click=${() => props.onApplySetupAutofill?.()}
      >
        ${preview.intakeApproved ? "Apply + approve setup" : "Apply draft"}
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        ?disabled=${props.actionBusy}
        @click=${() => props.onPreviewSetupAutofill?.()}
      >
        Regenerate
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        ?disabled=${props.actionBusy}
        @click=${() => props.onDismissSetupAutofill?.()}
      >
        Cancel
      </button>
    </div>
  </section>`;
}

function renderSetupRepairCard(
  evaluation: ReturnType<typeof setupEvaluationForDetail>,
  props: PccDashboardProps,
) {
  const hasAutofillPreview = props.autofillPreview?.projectId === props.projectDetail?.project.id;
  if (
    (evaluation.runnable && !hasAutofillPreview) ||
    !props.projectDetail ||
    projectIsTerminal(props.projectDetail.project)
  ) {
    return nothing;
  }
  const issues = [
    ...evaluation.missing.map((issue) => ({ label: "Missing", issue })),
    ...evaluation.violations.map((issue) => ({ label: "Violated", issue })),
    ...evaluation.needsReview.map((issue) => ({ label: "Review", issue })),
  ].slice(0, 8);
  const blockers = workStartBlockersForDetail(props.projectDetail);
  return html`<section class="pcc-setup-repair" data-pcc-setup-repair>
    <div>
      <p class="pcc-kicker">Setup repair</p>
      <h4>Setup needs a few answers</h4>
      <p>
        PCC cannot start work until these setup gaps are fixed. Let AI draft the missing goal,
        intake answers, workflow, owners, proof requirements, and acceptance criteria from what is
        already here.
      </p>
    </div>
    <ul class="pcc-setup-repair__issues" data-pcc-setup-repair-issues>
      ${blockers.length
        ? blockers
            .slice(0, 8)
            .map(
              (issue, index) => html`<li><strong>${index + 1}</strong><span>${issue}</span></li>`,
            )
        : issues.length
          ? issues.map(
              ({ label, issue }) => html`<li><strong>${label}</strong><span>${issue}</span></li>`,
            )
          : html`<li>
              <strong>Review</strong><span>Setup needs review before work starts.</span>
            </li>`}
    </ul>
    <div class="pcc-setup-repair__actions">
      <button
        class="btn"
        type="button"
        data-pcc-setup-repair-ai-fill
        ?disabled=${planningActionDisabled(props)}
        @click=${() => props.onPreviewSetupAutofill?.()}
      >
        Plan missing setup with ${initialPlannerLabel(props.projectForm)}
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        ?disabled=${props.actionBusy}
        @click=${() =>
          props.projectDetail && props.onOpenProjectEditor(props.projectDetail.project)}
      >
        Edit manually
      </button>
      ${projectIsOnHold(props.projectDetail.project)
        ? html`<button
            class="btn btn--subtle"
            type="button"
            data-pcc-resume-project
            ?disabled=${props.actionBusy || !props.onResumeProject}
            @click=${() => props.onResumeProject?.()}
          >
            Resume Project
          </button>`
        : nothing}
      ${issues.length === 1 && /approval|review/iu.test(issues[0]?.issue ?? "")
        ? html`<button
            class="btn btn--subtle"
            type="button"
            data-pcc-setup-approve
            ?disabled=${props.actionBusy}
            @click=${() => props.onApproveSetupAutofill?.()}
          >
            Approve setup
          </button>`
        : nothing}
    </div>
    <p class="pcc-setup-repair__codex-note" data-pcc-setup-repair-codex-note>
      ${initialPlannerLabel(props.projectForm)} creates a planning-only draft. It cannot run tools
      or start implementation. Review the draft before PCC saves anything.
    </p>
    ${renderAutofillPreview(props)}
  </section>`;
}

function renderWorkflowQualityCard(detail: PccProjectDetail) {
  const evaluation = setupEvaluationForDetail(detail);
  const topGaps = [
    ...evaluation.missing,
    ...evaluation.violations,
    ...evaluation.needsReview,
  ].slice(0, 4);
  return html`<section
    class="pcc-workflow-quality pcc-workflow-quality--${evaluation.status}"
    data-pcc-workflow-contract
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Workflow contract</p>
        <h4>Setup quality</h4>
        <p>
          PCC checks intake, workflow, sub-milestones, acceptance criteria, owners, and proof before
          automation starts.
        </p>
      </div>
      <span class="pcc-status" data-pcc-compliance-badge>${evaluation.badge}</span>
    </div>
    <dl class="pcc-workflow-quality__facts">
      <div data-pcc-setup-score>
        <dt>Setup score</dt>
        <dd>${evaluation.score}/100</dd>
      </div>
      <div>
        <dt>Recommended workflow</dt>
        <dd>${evaluation.recommendedWorkflow.title}</dd>
      </div>
      <div>
        <dt>Selected workflow</dt>
        <dd>${evaluation.selectedWorkflowTemplateId}</dd>
      </div>
      <div>
        <dt>Runnable</dt>
        <dd>${evaluation.runnable ? "Yes" : "Not yet"}</dd>
      </div>
    </dl>
    <p>${evaluation.recommendedWorkflow.reason}</p>
    ${topGaps.length
      ? html`<ul class="pcc-workflow-quality__gaps">
          ${topGaps.map((gap) => html`<li>${gap}</li>`)}
        </ul>`
      : html`<p class="pcc-workflow-quality__ready">Ready to work through the plan.</p>`}
  </section>`;
}

function responsibilityLabel(value: string): string {
  return RESPONSIBILITY_OPTIONS.find(([option]) => option === value)?.[1] ?? formatStatus(value);
}

async function copyPccContextPackage(
  detail: PccProjectDetail,
  mode: PccContextPackageMode,
  button: HTMLButtonElement,
): Promise<void> {
  const originalLabel = button.textContent?.trim() || "Copy";
  try {
    if (!globalThis.navigator?.clipboard?.writeText) {
      throw new Error("Clipboard access is unavailable");
    }
    await globalThis.navigator.clipboard.writeText(buildPccContextPackage(detail, { mode }));
    button.dataset.pccCopyState = "copied";
    button.textContent = "Copied";
  } catch {
    button.dataset.pccCopyState = "failed";
    button.textContent = "Copy failed";
  }
  globalThis.setTimeout(() => {
    button.dataset.pccCopyState = "idle";
    button.textContent = originalLabel;
  }, 1_800);
}

function renderPermissionCard(permission: PccPermissionGrant, props: PccDashboardProps) {
  const actions = permission.allowedActions.length
    ? permission.allowedActions.join(", ")
    : "No allowed actions recorded";
  const forbidden = permission.forbiddenActions?.length
    ? permission.forbiddenActions.join(", ")
    : "No forbidden actions recorded";
  return html`
    <article class="pcc-permission" data-pcc-permission>
      <div class="pcc-permission__header">
        <div>
          <p class="pcc-kicker">Permission needed</p>
          <h5>${formatStatus(permission.type)}</h5>
        </div>
        <span class="pcc-status pcc-permission-status--${permission.status}">
          ${formatStatus(permission.status)}
        </span>
      </div>
      <dl class="pcc-permission__facts">
        <div>
          <dt>Risk</dt>
          <dd>${formatStatus(permission.riskLevel)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>${permission.target || "Not specified"}</dd>
        </div>
        <div>
          <dt>Allowed</dt>
          <dd>${actions}</dd>
        </div>
        <div>
          <dt>Forbidden</dt>
          <dd>${forbidden}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>${permission.expiresAt || "No expiration"}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>
            ${permission.tokenBudget
              ? `${permission.tokenBudget} tokens`
              : permission.costBudget !== undefined
                ? `$${permission.costBudget}`
                : "No budget"}
          </dd>
        </div>
      </dl>
      <div class="pcc-permission__actions">
        <button
          class="btn pcc-action-primary"
          type="button"
          ?disabled=${props.actionBusy}
          @click=${() => props.onSetPermissionStatus(permission, "granted")}
        >
          Grant
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy}
          @click=${() => props.onSetPermissionStatus(permission, "needed")}
        >
          Defer
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy}
          @click=${() => props.onSetPermissionStatus(permission, "denied")}
        >
          Deny
        </button>
      </div>
    </article>
  `;
}

function renderPccPermissionReviewDialog(detail: PccProjectDetail, props: PccDashboardProps) {
  const pending = detail.permissions.filter((permission) => permission.status === "needed");
  const permission = pendingPermissionForDetail(detail, props.attentionRecordId);
  if (!permission) {
    return nothing;
  }
  const milestone = permission.milestoneId
    ? detail.milestones.find((item) => item.id === permission.milestoneId)
    : undefined;
  const actions = permission.allowedActions.length
    ? permission.allowedActions.join(", ")
    : "No action is authorized until this permission is granted.";
  const forbidden = permission.forbiddenActions?.length
    ? permission.forbiddenActions.join(", ")
    : "All unrelated actions remain outside this permission.";
  return html`<dialog
    class="pcc-permission-review"
    data-pcc-permission-review-dialog=${detail.project.id}
    aria-labelledby="pcc-permission-review-title"
    @close=${(event: Event) =>
      restorePccPermissionReviewFocus(event.currentTarget as HTMLDialogElement)}
    @click=${(event: Event) => {
      if (event.target === event.currentTarget) {
        closePccPermissionReview(event.currentTarget as HTMLDialogElement);
      }
    }}
  >
    <section>
      <header>
        <div>
          <p class="pcc-kicker">
            Permission ${pending.indexOf(permission) + 1} of ${pending.length}
          </p>
          <h3 id="pcc-permission-review-title">${formatStatus(permission.type)}</h3>
          <p>Review exactly what PCC may do. Nothing outside this permission is approved.</p>
        </div>
        <button
          class="btn btn--icon"
          type="button"
          aria-label="Close permission review"
          @click=${(event: Event) =>
            closePccPermissionReview(
              (event.currentTarget as HTMLElement).closest("dialog") as HTMLDialogElement,
            )}
        >
          ×
        </button>
      </header>
      <dl>
        <div>
          <dt>Project</dt>
          <dd>${detail.project.title}</dd>
        </div>
        <div>
          <dt>Step</dt>
          <dd>${milestone?.title ?? "Whole project"}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>${formatStatus(permission.riskLevel)}</dd>
        </div>
        <div>
          <dt>May do</dt>
          <dd>${actions}</dd>
        </div>
        <div>
          <dt>Still forbidden</dt>
          <dd>${forbidden}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>${permission.expiresAt || "No expiration recorded"}</dd>
        </div>
      </dl>
      <p class="pcc-permission-review__note">
        ${permission.tokenBudget
          ? `Token allowance: ${permission.tokenBudget.toLocaleString()} tokens.`
          : "No hard token allowance is attached. PCC records actual model use instead."}
      </p>
      <footer>
        <button
          class="btn pcc-action-primary"
          type="button"
          data-pcc-permission-grant
          ?disabled=${props.actionBusy}
          @click=${(event: Event) => {
            props.onSetPermissionStatus(permission, "granted");
            closePccPermissionReview(
              (event.currentTarget as HTMLElement).closest("dialog") as HTMLDialogElement,
            );
          }}
        >
          Grant permission
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${(event: Event) =>
            closePccPermissionReview(
              (event.currentTarget as HTMLElement).closest("dialog") as HTMLDialogElement,
            )}
        >
          Not now
        </button>
        <button
          class="btn pcc-action-danger"
          type="button"
          ?disabled=${props.actionBusy}
          @click=${(event: Event) => {
            props.onSetPermissionStatus(permission, "denied");
            closePccPermissionReview(
              (event.currentTarget as HTMLElement).closest("dialog") as HTMLDialogElement,
            );
          }}
        >
          Deny
        </button>
      </footer>
    </section>
  </dialog>`;
}

function permissionsForMilestone(detail: PccProjectDetail | null, milestone: PccMilestone) {
  return (detail?.permissions ?? []).filter(
    (permission) =>
      permission.milestoneId === milestone.id ||
      milestone.permissionGrantIds?.includes(permission.id),
  );
}

function evidenceForMilestone(
  detail: PccProjectDetail | null,
  milestone: PccMilestone,
): PccEvidence[] {
  return (detail?.evidence ?? []).filter((evidence) => evidence.milestoneId === milestone.id);
}

function receiptsForMilestone(
  detail: PccProjectDetail | null,
  milestone: PccMilestone,
): PccCompletionReceipt[] {
  return (detail?.receipts ?? []).filter(
    (receipt) => receipt.milestoneId === milestone.id || milestone.receiptIds?.includes(receipt.id),
  );
}

function evidenceForSubMilestone(
  detail: PccProjectDetail | null,
  subMilestone: PccSubMilestone,
): PccEvidence[] {
  return (detail?.evidence ?? []).filter((evidence) =>
    subMilestone.requiredEvidenceIds?.includes(evidence.id),
  );
}

function receiptsForSubMilestone(
  detail: PccProjectDetail | null,
  subMilestone: PccSubMilestone,
): PccCompletionReceipt[] {
  return (detail?.receipts ?? []).filter((receipt) =>
    subMilestone.receiptIds?.includes(receipt.id),
  );
}

function decisionsForSubMilestone(
  detail: PccProjectDetail | null,
  subMilestone: PccSubMilestone,
): PccDecision[] {
  return (detail?.decisions ?? []).filter(
    (decision) => decision.subMilestoneId === subMilestone.id,
  );
}

function subMilestoneDependencyTitles(
  detail: PccProjectDetail | null,
  subMilestone: PccSubMilestone,
): string[] {
  const dependencies = new Set(stringArray(subMilestone.dependsOn));
  if (dependencies.size === 0) {
    return [];
  }
  const siblings = new Map((detail?.subMilestones ?? []).map((item) => [item.id, item.title]));
  return [...dependencies].map((id) => siblings.get(id) ?? `Missing dependency: ${id}`);
}

function renderSubMilestoneDrilldown(subMilestone: PccSubMilestone, props: PccDashboardProps) {
  const evidence = evidenceForSubMilestone(props.projectDetail, subMilestone);
  const receipts = receiptsForSubMilestone(props.projectDetail, subMilestone);
  const decisions = decisionsForSubMilestone(props.projectDetail, subMilestone);
  const dependencies = subMilestoneDependencyTitles(props.projectDetail, subMilestone);
  const criteria = subMilestone.acceptanceCriteria ?? [];
  return html`<details class="pcc-submilestone__drilldown" data-pcc-submilestone-drilldown>
    <summary>Details, proof, and dependencies</summary>
    <div class="pcc-submilestone__detail-grid">
      <section>
        <strong>Next step</strong>
        <p>
          ${subMilestone.blocker || subMilestone.implementationPlan || "No next step recorded."}
        </p>
      </section>
      <section>
        <strong>Acceptance criteria</strong>
        ${criteria.length
          ? html`<ul>
              ${criteria.map((item) => html`<li>${item}</li>`)}
            </ul>`
          : html`<p>No acceptance criteria recorded.</p>`}
      </section>
      <section>
        <strong>Dependencies</strong>
        ${dependencies.length
          ? html`<ul>
              ${dependencies.map((item) => html`<li>${item}</li>`)}
            </ul>`
          : html`<p>No dependencies recorded.</p>`}
      </section>
      <section>
        <strong>Evidence</strong>
        ${evidence.length
          ? html`<ul>
              ${evidence.map(
                (item) => html`<li>${formatStatus(item.status)} · ${item.summary}</li>`,
              )}
            </ul>`
          : html`<p>No evidence linked yet.</p>`}
      </section>
      <section>
        <strong>Receipts</strong>
        ${receipts.length
          ? html`<ul>
              ${receipts.map((item) => html`<li>${item.summary}</li>`)}
            </ul>`
          : html`<p>No completion receipt linked yet.</p>`}
      </section>
      <section>
        <strong>Decisions</strong>
        ${decisions.length
          ? html`<ul>
              ${decisions.map((item) => html`<li>${item.title}</li>`)}
            </ul>`
          : html`<p>No decisions linked yet.</p>`}
      </section>
    </div>
  </details>`;
}

function formatReceiptDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDecisionDate(value: string): string {
  return formatReceiptDate(value);
}

function renderDecisionCard(decision: PccDecision, evidence: PccEvidence[]) {
  const decisionEvidenceIds = stringArray(decision.evidenceIds);
  const linkedEvidence = evidence.filter((item) => decisionEvidenceIds.includes(item.id));
  return html`<article class="pcc-decision" data-pcc-decision>
    <div class="pcc-decision__header">
      <div>
        <strong>${decision.title}</strong>
        <span
          >${formatDecisionDate(decision.decidedAt)}${decision.decidedBy
            ? ` · ${decision.decidedBy}`
            : ""}</span
        >
      </div>
    </div>
    <p>${decision.summary}</p>
    ${decision.rationale ? html`<p><strong>Why:</strong> ${decision.rationale}</p>` : nothing}
    ${decision.impact ? html`<p><strong>Impact:</strong> ${decision.impact}</p>` : nothing}
    ${decision.alternatives?.length
      ? html`<details class="pcc-decision__details">
          <summary>Alternatives considered</summary>
          <ul>
            ${decision.alternatives.map((item) => html`<li>${item}</li>`)}
          </ul>
        </details>`
      : nothing}
    ${linkedEvidence.length
      ? html`<ul class="pcc-decision__evidence">
          ${linkedEvidence.map(
            (item) => html`<li>
              <strong>${formatStatus(item.kind)}</strong>
              <span>${item.summary || item.command || item.path || item.url || item.status}</span>
            </li>`,
          )}
        </ul>`
      : nothing}
  </article>`;
}

function parseDecisionEvidenceIds(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\n,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDecisionEvidenceIds(ids: readonly string[]): string {
  return [...new Set(ids)].join(", ");
}

function updateDecisionEvidenceSelection(
  props: PccDashboardProps,
  evidenceId: string,
  selected: boolean,
): void {
  const ids = new Set(parseDecisionEvidenceIds(props.decisionForm.evidenceIds));
  if (selected) {
    ids.add(evidenceId);
  } else {
    ids.delete(evidenceId);
  }
  props.onDecisionFormChange?.({ evidenceIds: formatDecisionEvidenceIds([...ids]) });
}

function renderDecisionForm(detail: PccProjectDetail, props: PccDashboardProps) {
  const form = props.decisionForm;
  const availableSubMilestones = (detail.subMilestones ?? []).filter(
    (item) => !form.milestoneId || item.milestoneId === form.milestoneId,
  );
  return html`<form
    class="pcc-decision-form"
    data-pcc-decision-form
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancelDecisionForm?.();
      }
    }}
    @submit=${(event: Event) => {
      event.preventDefault();
      props.onSaveDecision?.();
    }}
  >
    <div class="pcc-form-grid pcc-form-grid--two">
      <label>
        <span>Decision title</span>
        <input
          type="text"
          .value=${form.title}
          placeholder="Example: Use receipt-gated completion"
          @input=${(event: Event) =>
            props.onDecisionFormChange?.({ title: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label>
        <span>Decided by</span>
        <input
          type="text"
          .value=${form.decidedBy}
          placeholder="User, Codex, OpenClaw"
          @input=${(event: Event) =>
            props.onDecisionFormChange?.({ decidedBy: (event.target as HTMLInputElement).value })}
        />
      </label>
    </div>
    <label>
      <span>Summary</span>
      <textarea
        rows="2"
        .value=${form.summary}
        placeholder="State the choice in one or two sentences."
        @input=${(event: Event) =>
          props.onDecisionFormChange?.({ summary: (event.target as HTMLTextAreaElement).value })}
      ></textarea>
    </label>
    <div class="pcc-form-grid pcc-form-grid--two">
      <label>
        <span>Milestone</span>
        <select
          .value=${form.milestoneId}
          @change=${(event: Event) =>
            props.onDecisionFormChange?.({
              milestoneId: (event.target as HTMLSelectElement).value,
              subMilestoneId: "",
            })}
        >
          <option value="">Project-level decision</option>
          ${detail.milestones.map(
            (milestone) => html`<option value=${milestone.id}>${milestone.title}</option>`,
          )}
        </select>
      </label>
      <label>
        <span>Sub-milestone</span>
        <select
          .value=${form.subMilestoneId}
          ?disabled=${availableSubMilestones.length === 0}
          @change=${(event: Event) =>
            props.onDecisionFormChange?.({
              subMilestoneId: (event.target as HTMLSelectElement).value,
            })}
        >
          <option value="">None</option>
          ${availableSubMilestones.map(
            (subMilestone) => html`<option value=${subMilestone.id}>${subMilestone.title}</option>`,
          )}
        </select>
      </label>
    </div>
    <label>
      <span>Why</span>
      <textarea
        rows="2"
        .value=${form.rationale}
        placeholder="Why this is the right path."
        @input=${(event: Event) =>
          props.onDecisionFormChange?.({ rationale: (event.target as HTMLTextAreaElement).value })}
      ></textarea>
    </label>
    <label>
      <span>Impact</span>
      <textarea
        rows="2"
        .value=${form.impact}
        placeholder="What future workers should remember."
        @input=${(event: Event) =>
          props.onDecisionFormChange?.({ impact: (event.target as HTMLTextAreaElement).value })}
      ></textarea>
    </label>
    <section class="pcc-decision-form__evidence" data-pcc-decision-evidence-picker>
      <div>
        <span>Related proof</span>
        <p>Select proof instead of copying raw evidence IDs.</p>
      </div>
      ${detail.evidence.length
        ? html`<div class="pcc-decision-form__evidence-list">
            ${detail.evidence.map((item) => {
              const selected = parseDecisionEvidenceIds(form.evidenceIds).includes(item.id);
              return html`<label>
                <input
                  type="checkbox"
                  .checked=${selected}
                  @change=${(event: Event) =>
                    updateDecisionEvidenceSelection(
                      props,
                      item.id,
                      (event.target as HTMLInputElement).checked,
                    )}
                />
                <span>
                  <strong
                    >${item.summary || item.command || item.path || item.url || item.id}</strong
                  >
                  <small>${formatStatus(item.kind)} · ${formatStatus(item.status)}</small>
                </span>
              </label>`;
            })}
          </div>`
        : html`<p class="pcc-muted">No proof has been recorded for this project yet.</p>`}
      <label>
        <span>Evidence IDs</span>
        <input
          type="text"
          .value=${form.evidenceIds}
          placeholder="Optional: comma-separated evidence IDs"
          @input=${(event: Event) =>
            props.onDecisionFormChange?.({ evidenceIds: (event.target as HTMLInputElement).value })}
        />
      </label>
    </section>
    <div class="pcc-decision-form__actions">
      <button class="btn btn--primary" type="submit" ?disabled=${props.actionBusy}>
        Save decision
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        ?disabled=${props.actionBusy}
        @click=${() => props.onCancelDecisionForm?.()}
      >
        Cancel
      </button>
    </div>
  </form>`;
}

function renderDecisionCapturePanel(detail: PccProjectDetail, props: PccDashboardProps) {
  if (!props.decisionFormOpen) {
    return nothing;
  }
  return html`<section
    class="pcc-decision-capture"
    data-pcc-decision-capture
    role="dialog"
    aria-modal="true"
    aria-labelledby="pcc-decision-capture-title"
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Decision capture</p>
        <h4 id="pcc-decision-capture-title">Add a project decision</h4>
        <p>Record the choice once so future agents do not rediscover it.</p>
      </div>
    </div>
    ${renderDecisionForm(detail, props)}
  </section>`;
}

function renderDecisionList(detail: PccProjectDetail, props: PccDashboardProps) {
  const decisions = detail.decisions ?? [];
  return html`<section class="pcc-decisions" data-pcc-decisions>
    <div class="pcc-section-heading">
      <div>
        <h4>Decisions</h4>
        <p>Important choices that future agents should not rediscover.</p>
      </div>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-open-decision-form
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => openPccDecisionCapture(event, props)}
      >
        Add decision
      </button>
    </div>
    <span class="pcc-decisions__count">${decisions.length} recorded</span>
    ${decisions.length
      ? decisions.map((decision) => renderDecisionCard(decision, detail.evidence ?? []))
      : html`<div class="pcc-empty pcc-empty--small">No decisions recorded yet</div>`}
  </section>`;
}

function renderReceiptCard(receipt: PccCompletionReceipt, evidence: PccEvidence[]) {
  const proofEvidenceIds = stringArray(receipt.proofEvidenceIds);
  const artifactRefs = stringArray(receipt.artifactRefs);
  const doNotRedo = stringArray(receipt.doNotRedo);
  const followUpGaps = stringArray(receipt.followUpGaps);
  const proofItems = evidence.filter((item) => proofEvidenceIds.includes(item.id));
  return html`
    <details class="pcc-receipt" data-pcc-receipt>
      <summary>
        <span>Completion receipt</span>
        <strong>${formatStatus(receipt.proofLevel)} proof</strong>
      </summary>
      <p>${receipt.summary}</p>
      <dl class="pcc-receipt__facts">
        <div>
          <dt>Completed</dt>
          <dd>${formatReceiptDate(receipt.completedAt)}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>${proofEvidenceIds.length} item${proofEvidenceIds.length === 1 ? "" : "s"}</dd>
        </div>
        <div>
          <dt>Artifacts</dt>
          <dd>${artifactRefs.length} ref${artifactRefs.length === 1 ? "" : "s"}</dd>
        </div>
        <div>
          <dt>By</dt>
          <dd>${receipt.completedBy || "Not recorded"}</dd>
        </div>
      </dl>
      ${artifactRefs.length
        ? html`<div class="pcc-receipt__note" data-pcc-receipt-artifacts>
            <strong>Artifacts</strong>
            <ul>
              ${artifactRefs.map((artifact) => html`<li>${artifact}</li>`)}
            </ul>
          </div>`
        : nothing}
      ${proofItems.length
        ? html`<ul class="pcc-receipt__list">
            ${proofItems.map(
              (item) => html`<li>
                <strong>${formatStatus(item.kind)}</strong>
                <span>${item.summary || item.command || item.path || item.url || item.status}</span>
              </li>`,
            )}
          </ul>`
        : nothing}
      ${doNotRedo.length
        ? html`<div class="pcc-receipt__note">
            <strong>Do not redo</strong>
            <ul>
              ${doNotRedo.map((note) => html`<li>${note}</li>`)}
            </ul>
          </div>`
        : nothing}
      ${followUpGaps.length
        ? html`<div class="pcc-receipt__note">
            <strong>Follow-up gaps</strong>
            <ul>
              ${followUpGaps.map((gap) => html`<li>${gap}</li>`)}
            </ul>
          </div>`
        : nothing}
    </details>
  `;
}

function renderEvidenceSummary(evidence: PccEvidence[]) {
  if (evidence.length === 0) {
    return html`<div class="pcc-empty pcc-empty--small">No proof evidence recorded yet</div>`;
  }
  return html`<div class="pcc-evidence-list" data-pcc-evidence-list>
    ${evidence.slice(0, 6).map(
      (item) => html`<article class="pcc-evidence pcc-evidence--${item.status}">
        <span>${formatStatus(item.kind)}</span>
        <strong>${formatStatus(item.status)}</strong>
        <p>
          ${item.summary ||
          item.command ||
          item.path ||
          item.url ||
          "No evidence summary recorded."}
        </p>
      </article>`,
    )}
  </div>`;
}

function renderProjectReceiptsAndArtifacts(detail: PccProjectDetail, props: PccDashboardProps) {
  const receipts = detail.receipts ?? [];
  const evidence = detail.evidence ?? [];
  const artifactCount = receipts.reduce(
    (total, receipt) => total + stringArray(receipt.artifactRefs).length,
    0,
  );
  const firstReceiptMilestone = detail.milestones.find((milestone) => {
    const milestoneReceipts = receiptsForMilestone(detail, milestone);
    const passedEvidence = evidenceForMilestone(detail, milestone).filter(
      (item) => item.status === "passed",
    );
    return milestoneReceipts.length === 0 && passedEvidence.length > 0;
  });
  return html`<section class="pcc-project-receipts" data-pcc-project-receipts>
    <div class="pcc-section-heading">
      <div>
        <h4>Receipts & Artifacts</h4>
        <p>Proof receipts, saved artifacts, and do-not-redo notes for this project.</p>
      </div>
      <span
        >${receipts.length} receipt${receipts.length === 1 ? "" : "s"} · ${artifactCount}
        artifact${artifactCount === 1 ? "" : "s"}</span
      >
    </div>
    ${receipts.length
      ? html`<div class="pcc-project-receipts__list">
          ${receipts.map((receipt) => renderReceiptCard(receipt, evidence))}
        </div>`
      : html`<div class="pcc-empty pcc-empty--small">
          No project receipts or artifacts recorded yet
        </div>`}
    ${renderEvidenceSummary(evidence)}
    ${firstReceiptMilestone
      ? html`<button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy}
          @click=${() => props.onAddCompletionReceipt(firstReceiptMilestone)}
        >
          Add receipt
        </button>`
      : html`<button class="btn btn--subtle" type="button" disabled>Add receipt</button>`}
  </section>`;
}

function renderMilestoneReceipts(milestone: PccMilestone, props: PccDashboardProps) {
  const evidence = evidenceForMilestone(props.projectDetail, milestone);
  const receipts = receiptsForMilestone(props.projectDetail, milestone);
  const passedEvidence = evidence.filter((item) => item.status === "passed");
  const canAddReceipt = receipts.length === 0 && passedEvidence.length > 0;
  return html`
    <section class="pcc-receipts" aria-label="Completion receipts">
      <div class="pcc-section-heading">
        <h5>Receipts</h5>
        <span>${receipts.length} recorded</span>
      </div>
      ${receipts.length
        ? receipts.map((receipt) => renderReceiptCard(receipt, evidence))
        : html`<div class="pcc-empty pcc-empty--small">No completion receipt yet</div>`}
      ${renderEvidenceSummary(evidence)}
      <button
        class="btn btn--subtle"
        type="button"
        ?disabled=${!canAddReceipt || props.actionBusy}
        title=${canAddReceipt
          ? "Add a completion receipt from passed evidence"
          : "Passed evidence is required before adding a receipt"}
        @click=${() => props.onAddCompletionReceipt(milestone)}
      >
        Add receipt
      </button>
    </section>
  `;
}

function renderPermissionList(permissions: PccPermissionGrant[], props: PccDashboardProps) {
  if (permissions.length === 0) {
    return html`<div class="pcc-empty pcc-empty--small">No permissions requested</div>`;
  }
  return permissions.map((permission) => renderPermissionCard(permission, props));
}

function renderProjectCard(project: PccProjectSummary, props: PccDashboardProps) {
  const percent = clampPercent(project.percentComplete);
  const selected = project.id === props.selectedProjectId;
  const detail =
    props.projectDetails?.[project.id] ??
    (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined);
  const resolved = detail ? resolvePccProjectAction(detail) : undefined;
  const current = detail ? currentMilestoneForDetail(detail) : undefined;
  const next = detail ? nextMilestoneForDetail(detail) : undefined;
  const workState = projectIsTerminalForWork(project)
    ? project.status === "complete_with_maintenance"
      ? "Maintenance"
      : formatStatus(project.status)
    : workStateForProject(project, detail);
  const onHold = projectIsOnHold(project);
  const blocker = resolved?.topBlocker ?? projectBlockerLine(project);
  const cardStatus = resolved?.statusLabel ?? formatStatus(project.status);
  const scope = pccWorkScopeForProject(detail?.project ?? project);
  const scopeLabel = pccWorkScopeLabel(scope);
  return html`
    <article
      class="pcc-project-card ${selected ? "is-selected" : ""} ${onHold ? "is-on-hold" : ""}"
      data-pcc-project-card
      data-pcc-project-id=${project.id}
    >
      <div class="pcc-project-card__topline">
        <div>
          <h3>${project.title}</h3>
          <span class="pcc-chip" data-pcc-project-scope-badge>${scopeLabel}</span>
        </div>
        <span class="pcc-status pcc-status--${project.status}">${cardStatus}</span>
      </div>
      <div class="pcc-project-card__progress-row">
        <strong>${percent}%</strong>
        <div class="pcc-progress" aria-label=${`${project.title} ${percent}% complete`}>
          <span class="pcc-progress__bar" style=${`width:${percent}%`}></span>
        </div>
      </div>
      <div
        class="pcc-project-card__meta pcc-project-card__meta--skim"
        data-pcc-project-card-skim-facts
      >
        <span>${project.milestoneCounts.complete}/${project.milestoneCounts.total} milestones</span>
        <span>Work: ${workState}</span>
        ${projectNeedsAttention(project)
          ? html`<span>Needs You</span>`
          : html`<span>${project.health ?? "On track"}</span>`}
      </div>
      <div class="pcc-project-card__sequence" data-pcc-project-card-sequence>
        ${projectIsTerminalForWork(project)
          ? html`<span
              >${project.status === "complete_with_maintenance"
                ? "Maintenance only"
                : formatStatus(project.status)}</span
            >`
          : html`<span
                >${current
                  ? `Current: ${compactSignalText(current.title, 90)}`
                  : onHold
                    ? "On hold"
                    : `Ready to start: ${compactSignalText(next?.title ?? project.nextActions[0] ?? "No milestone", 90)}`}</span
              >
              <span
                >Next action:
                ${compactSignalText(next?.title ?? project.nextActions[0] ?? "None", 72)}</span
              >`}
      </div>
      ${blocker !== "None" && !/^No blocker recorded$/iu.test(blocker)
        ? html`<div class="pcc-project-card__signal" data-pcc-project-card-blocker>
            <span class="pcc-chip pcc-chip--attention">Blocked</span>
            <span class="pcc-chip">${blockerKindForLine(blocker)}</span>
            <span>${compactSignalText(blocker, 62)}</span>
          </div>`
        : nothing}
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-project-open
        data-pcc-project-open-surface="card"
        data-pcc-project-id=${project.id}
        aria-label=${`Open ${project.title}`}
        @click=${() => props.onSelectProject(project.id)}
      >
        ${selected ? "Selected" : "Open"}
      </button>
    </article>
  `;
}

function subMilestonesForMilestone(
  detail: PccProjectDetail | null,
  milestone: PccMilestone,
): PccSubMilestone[] {
  return (detail?.subMilestones ?? [])
    .filter((subMilestone) => subMilestone.milestoneId === milestone.id)
    .toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    );
}

function subMilestoneDisplayPercent(subMilestone: PccSubMilestone): number {
  if (subMilestone.status === "complete" || subMilestone.status === "complete_with_maintenance") {
    return 100;
  }
  if (subMilestone.status === "skipped" || subMilestone.status === "archived") {
    return 0;
  }
  return clampPercent(subMilestone.percentComplete ?? 0);
}

function renderMilestoneReorderControls(
  milestones: readonly PccMilestone[],
  milestone: PccMilestone,
  props: PccDashboardProps,
) {
  const index = milestones.findIndex((item) => item.id === milestone.id);
  const previous = index > 0 ? milestones[index - 1] : undefined;
  const next = index >= 0 && index < milestones.length - 1 ? milestones[index + 1] : undefined;
  return html`<span class="pcc-reorder-controls" data-pcc-milestone-reorder>
    <button
      type="button"
      data-pcc-reorder="milestone-up"
      aria-label=${`Move ${milestone.title} up`}
      ?disabled=${props.actionBusy || !previous || !props.onMoveMilestoneBefore}
      @click=${(event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (previous) {
          props.onMoveMilestoneBefore?.(milestone, previous);
        }
      }}
    >
      <span aria-hidden="true">↑</span><span>Up</span>
    </button>
    <button
      type="button"
      data-pcc-reorder="milestone-down"
      aria-label=${`Move ${milestone.title} down`}
      ?disabled=${props.actionBusy || !next || !props.onMoveMilestoneBefore}
      @click=${(event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (next) {
          props.onMoveMilestoneBefore?.(next, milestone);
        }
      }}
    >
      <span aria-hidden="true">↓</span><span>Down</span>
    </button>
  </span>`;
}

function renderSubMilestoneReorderControls(
  subMilestones: readonly PccSubMilestone[],
  subMilestone: PccSubMilestone,
  props: PccDashboardProps,
) {
  const index = subMilestones.findIndex((item) => item.id === subMilestone.id);
  const previous = index > 0 ? subMilestones[index - 1] : undefined;
  const next =
    index >= 0 && index < subMilestones.length - 1 ? subMilestones[index + 1] : undefined;
  return html`<span class="pcc-reorder-controls" data-pcc-submilestone-reorder>
    <button
      type="button"
      data-pcc-reorder="submilestone-up"
      aria-label=${`Move ${subMilestone.title} up`}
      ?disabled=${props.actionBusy || !previous || !props.onMoveSubMilestoneBefore}
      @click=${(event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (previous) {
          props.onMoveSubMilestoneBefore?.(subMilestone, previous);
        }
      }}
    >
      <span aria-hidden="true">↑</span><span>Up</span>
    </button>
    <button
      type="button"
      data-pcc-reorder="submilestone-down"
      aria-label=${`Move ${subMilestone.title} down`}
      ?disabled=${props.actionBusy || !next || !props.onMoveSubMilestoneBefore}
      @click=${(event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (next) {
          props.onMoveSubMilestoneBefore?.(next, subMilestone);
        }
      }}
    >
      <span aria-hidden="true">↓</span><span>Down</span>
    </button>
  </span>`;
}

function itemWorkerLabel(item: PccMilestone | PccSubMilestone): string {
  return responsibilityLabel(pccResponsibilityForItem(item) || "local_openclaw_agent");
}

function itemProofLabel(item: PccMilestone | PccSubMilestone): string {
  return metadataString(metadataObject(item.metadata).proofRequired, "Proof not recorded");
}

function milestoneStopsHere(milestone: PccMilestone): boolean {
  return metadataObject(milestone.metadata).pccStopHere === true;
}

function projectActionLine(project: PccProjectSummary, detail?: PccProjectDetail): string {
  const current = detail ? currentMilestoneForDetail(detail) : undefined;
  return current?.title ?? project.nextActions[0] ?? formatStatus(project.status);
}

function attentionRank(project: PccProjectSummary): number {
  if (project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0) {
    return 0;
  }
  if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
    return 1;
  }
  if (projectIsOverdue(project) || project.health === "Overdue") {
    return 2;
  }
  if (project.health === "At risk") {
    return 3;
  }
  if (projectIsStale(project)) {
    return 4;
  }
  return 5;
}

function attentionKind(project: PccProjectSummary): string {
  if (project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0) {
    return "Needs approval";
  }
  if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
    return "Blocked";
  }
  if (project.proofGaps.length > 0) {
    return "Integrity/proof gap";
  }
  if (projectIsOverdue(project) || project.health === "Overdue") {
    return "Overdue";
  }
  if (project.health === "At risk") {
    return "At risk";
  }
  if (projectIsStale(project)) {
    return "Stale";
  }
  return "Needs review";
}

function getAttentionProjects(projects: readonly PccProjectSummary[]): PccProjectSummary[] {
  return projects.filter(projectNeedsAttention).toSorted((a, b) => {
    const rank = attentionRank(a) - attentionRank(b);
    if (rank !== 0) {
      return rank;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function projectPriorityLabel(props: PccDashboardProps, project: PccProjectSummary): string {
  const detail =
    props.projectDetails?.[project.id] ??
    (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined);
  const priority = detail?.project.priority;
  return typeof priority === "number" ? String(priority) : "—";
}

function projectBlockerLine(project: PccProjectSummary): string {
  if (projectIsTerminalForWork(project)) {
    return "None";
  }
  if (projectIsOnHold(project)) {
    return "Project is on hold.";
  }
  const explicit = project.nextActions.find((action) =>
    /block|missing|approval|overdue|risk|failed|proof/iu.test(action),
  );
  if (explicit) {
    return compactSignalText(explicit);
  }
  if (project.proofGaps.length > 0) {
    return compactSignalText(project.proofGaps[0] ?? "Proof gap recorded");
  }
  if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
    return "Blocked milestone needs review.";
  }
  if (project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0) {
    return "Approval needed before work can continue.";
  }
  if (project.health === "Overdue") {
    return "Due date is past target.";
  }
  if (project.health === "At risk") {
    return "Project is marked at risk.";
  }
  return "No blocker recorded";
}

function renderNeedsAttentionNow(props: PccDashboardProps) {
  const attentionProjects = getAttentionProjects(props.projects);
  if (attentionProjects.length === 0) {
    return html`<section
      class="pcc-needs-attention pcc-needs-attention--empty"
      data-pcc-needs-attention-now
      aria-label="Needs You now"
    >
      <div>
        <p class="pcc-kicker">Needs You Now</p>
        <h3>Nothing needs you right now</h3>
        <p>No blocked, overdue, high-risk, or approval-needed projects are active.</p>
      </div>
    </section>`;
  }
  return html`<section
    class="pcc-needs-attention"
    data-pcc-needs-attention-now
    aria-label="Needs You now"
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Needs You Now</p>
        <h3>
          ${attentionProjects.length} project${attentionProjects.length === 1 ? "" : "s"} need
          attention
        </h3>
        <p>Resolve these first before starting more work.</p>
      </div>
      <span>${attentionProjects.length} item${attentionProjects.length === 1 ? "" : "s"}</span>
    </div>
    <div class="pcc-needs-attention__list">
      ${attentionProjects.slice(0, 5).map(
        (project) => html`<article
          class="pcc-needs-attention__item"
          data-pcc-attention-item
          data-pcc-project-id=${project.id}
        >
          <div>
            <span class="pcc-status">${attentionKind(project)}</span>
            <strong>${project.title}</strong>
            <p>${projectAttentionLine(project)}</p>
          </div>
          <dl>
            <div>
              <dt>Priority</dt>
              <dd>${projectPriorityLabel(props, project)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>${formatProjectDate(project.dueDate)}</dd>
            </div>
            <div>
              <dt>Progress</dt>
              <dd>${clampPercent(project.percentComplete)}%</dd>
            </div>
          </dl>
          <button
            class="btn btn--subtle"
            type="button"
            data-pcc-project-open
            data-pcc-project-open-surface="attention"
            data-pcc-project-id=${project.id}
            aria-label=${`Open ${project.title} from Needs You`}
            @click=${() => props.onSelectProject(project.id)}
          >
            Open
          </button>
          ${props.onStartIssueChat
            ? html`<button
                class="btn btn--subtle"
                type="button"
                data-pcc-issue-chat
                @click=${() =>
                  props.onStartIssueChat?.({
                    source: "pcc",
                    sourceId: project.id,
                    title: project.title,
                    detail: projectAttentionLine(project),
                    impact: projectBlockerLine(project),
                    owner: "Control Director",
                    recommendedAction: projectBlockerLine(project),
                    projectId: project.id,
                  })}
              >
                ${t("operationsRoom.resolution.fixThis")}
              </button>`
            : nothing}
        </article>`,
      )}
    </div>
  </section>`;
}

function projectMatchesFilter(project: PccProjectSummary, filter: PccProjectFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "archived") {
    return project.status === "archived";
  }
  if (filter === "on_hold") {
    return project.status === "on_hold" || project.status === "deferred";
  }
  if (filter === "completed") {
    return isPccCompleteStatus(project.status) || project.status === "skipped";
  }
  if (filter === "needs_you") {
    return projectNeedsAttention(project);
  }
  return ![
    "archived",
    "complete",
    "complete_with_maintenance",
    "skipped",
    "on_hold",
    "deferred",
  ].includes(project.status);
}

function effectiveProjectFilter(
  props: PccDashboardProps,
  projects: readonly PccProjectSummary[],
): PccProjectFilter {
  const selected = props.projectFilter ?? "active";
  if (props.projectFilter) {
    return selected;
  }
  const selectedProjectId = props.projectDetail?.project.id ?? props.selectedProjectId;
  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId)
    : undefined;
  if (selectedProject && !projectMatchesFilter(selectedProject, selected)) {
    return "all";
  }
  const activeCount = projects.filter((project) => projectMatchesFilter(project, "active")).length;
  const needsYouCount = projects.filter((project) =>
    projectMatchesFilter(project, "needs_you"),
  ).length;
  return activeCount === 0 && needsYouCount > 0 ? "needs_you" : selected;
}

function normalizeProjectSearchQuery(query: string | undefined): string[] {
  return (query ?? "")
    .toLocaleLowerCase()
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

const projectSearchTextCache = new WeakMap<
  PccProjectSummary,
  { detail?: PccProjectDetail; text: string }
>();

function projectSearchText(project: PccProjectSummary, detail?: PccProjectDetail): string {
  const cached = projectSearchTextCache.get(project);
  if (cached && cached.detail === detail) {
    return cached.text;
  }
  const parts = [
    project.title,
    ...projectOutcomeMetrics(project),
    project.status,
    project.health ?? "",
    project.recentActivity ?? "",
    ...(project.nextActions ?? []),
    ...(project.proofGaps ?? []),
  ];
  if (detail) {
    parts.push(detail.project.goal ?? "", detail.project.owner ?? "");
    parts.push(...projectOutcomeMetrics(detail.project));
    for (const milestone of detail.milestones) {
      parts.push(
        milestone.title,
        milestone.status,
        milestone.phaseId ?? "",
        milestone.blocker ?? "",
        milestone.implementationPlan ?? "",
      );
      parts.push(...(milestone.acceptanceCriteria ?? []));
    }
    for (const subMilestone of detail.subMilestones ?? []) {
      parts.push(
        subMilestone.title,
        subMilestone.status,
        subMilestone.owner ?? "",
        subMilestone.blocker ?? "",
        subMilestone.implementationPlan ?? "",
      );
      parts.push(...(subMilestone.acceptanceCriteria ?? []));
    }
    for (const permission of detail.permissions) {
      parts.push(permission.type, permission.status, permission.target ?? "");
      parts.push(...(permission.allowedActions ?? []), ...(permission.forbiddenActions ?? []));
    }
    for (const evidence of detail.evidence) {
      parts.push(evidence.summary ?? "");
    }
    for (const receipt of detail.receipts) {
      parts.push(receipt.summary ?? "");
    }
  }
  const text = parts.join("\n").toLocaleLowerCase();
  projectSearchTextCache.set(project, { detail, text });
  return text;
}

function projectMatchesSearch(
  project: PccProjectSummary,
  query: string | undefined,
  detail?: PccProjectDetail,
): boolean {
  const terms = normalizeProjectSearchQuery(query);
  if (terms.length === 0) {
    return true;
  }
  const text = projectSearchText(project, detail);
  return terms.every((term) => text.includes(term));
}

function renderProjectFilterTabs(props: PccDashboardProps, projects: readonly PccProjectSummary[]) {
  const selected = effectiveProjectFilter(props, projects);
  return html`<nav class="pcc-project-tabs" data-pcc-project-tabs aria-label="Project filters">
    ${PROJECT_FILTER_OPTIONS.map(([filter, label]) => {
      const count = projects.filter((project) => projectMatchesFilter(project, filter)).length;
      return html`<button
        type="button"
        data-pcc-project-filter=${filter}
        class=${filter === selected ? "is-selected" : ""}
        aria-pressed=${filter === selected}
        @click=${() => props.onSetProjectFilter?.(filter)}
      >
        ${label} <span>${count}</span>
      </button>`;
    })}
  </nav>`;
}

function renderPccLoadingState() {
  return html`<div
    class="pcc-loading-state"
    data-pcc-loading-state
    role="status"
    aria-live="polite"
  >
    <span class="pcc-loading-state__spinner" aria-hidden="true"></span>
    <div>
      <strong>Loading Project Command Center</strong>
      <p>Fetching projects, milestones, proof, and latest activity.</p>
    </div>
  </div>`;
}

function renderPccOfflineState(props: PccDashboardProps) {
  if (props.connected !== false) {
    return nothing;
  }
  return html`<section class="pcc-offline-state" data-pcc-offline-state role="status">
    <div>
      <p class="pcc-kicker">Offline</p>
      <h3>Project Command Center is disconnected</h3>
      <p>
        You can review the last loaded project data, but changes cannot be saved until the Gateway
        reconnects.
      </p>
    </div>
    <button class="btn btn--subtle" type="button" @click=${props.onRefresh}>Retry refresh</button>
  </section>`;
}

function renderProjectSearch(
  props: PccDashboardProps,
  visibleCount: number,
  filterCount: number,
  selectedFilter: PccProjectFilter,
) {
  const query = props.projectSearchQuery ?? "";
  const hasQuery = query.trim().length > 0;
  const label = projectFilterLabel(selectedFilter);
  return html`<section class="pcc-project-search" data-pcc-project-search>
    <div class="pcc-project-search__scope" data-pcc-project-search-scope>
      <span>Searching: ${label}</span>
      ${selectedFilter !== "all"
        ? html`<button
            class="btn btn--subtle"
            type="button"
            data-pcc-search-all
            @click=${() => props.onSetProjectFilter?.("all")}
          >
            Search all
          </button>`
        : nothing}
    </div>
    <label>
      <span>Search ${label} projects</span>
      <input
        type="search"
        aria-label=${`Search ${label} projects`}
        placeholder=${`Search ${label} projects by title, status, next action, blocker, proof, or owner`}
        .value=${query}
        @input=${(event: Event) =>
          props.onSetProjectSearchQuery?.((event.target as HTMLInputElement).value)}
      />
    </label>
    <span class="pcc-project-search__count">
      ${hasQuery ? `Showing ${visibleCount} of ${filterCount}` : `${filterCount} shown`}
    </span>
    ${hasQuery
      ? html`<button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetProjectSearchQuery?.("")}
        >
          Clear search
        </button>`
      : nothing}
  </section>`;
}

function renderProjectFocusBar(
  props: PccDashboardProps,
  allProjects: readonly PccProjectSummary[],
  visibleCount: number,
  filterCount: number,
  selectedFilter: PccProjectFilter,
) {
  return html`<section class="pcc-project-focus-bar" data-pcc-project-focus-bar>
    <div class="pcc-project-focus-bar__top">
      ${renderProjectFilterTabs(props, allProjects)}
      <span data-pcc-project-focus-count>${visibleCount} shown</span>
    </div>
    ${renderProjectSearch(props, visibleCount, filterCount, selectedFilter)}
  </section>`;
}

function renderRecentActivityFeed(props: PccDashboardProps) {
  const items = projectRecentActivityItems(props.projects).slice(0, 5);
  return html`<section
    class="pcc-recent-activity"
    data-pcc-recent-activity
    aria-label="Recent activity"
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Recent Activity</p>
        <h3>What changed recently</h3>
        <p>Latest project, milestone, proof, permission, receipt, and decision updates.</p>
      </div>
      <span>${items.length ? `${items.length} latest` : "No activity"}</span>
    </div>
    ${items.length
      ? html`<ol class="pcc-recent-activity__list">
          ${items.map(
            ({ project, activity }) => html`<li
              class="pcc-recent-activity__item"
              data-pcc-recent-activity-item
              data-pcc-project-id=${project.id}
            >
              <div>
                <strong>${project.title}</strong>
                <span>${activity.label}</span>
              </div>
              <dl>
                <div>
                  <dt>When</dt>
                  <dd>${formatUpdatedAt(activity.time)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>${formatStatus(project.status)}</dd>
                </div>
                <div>
                  <dt>Progress</dt>
                  <dd>${clampPercent(project.percentComplete)}%</dd>
                </div>
              </dl>
              <button
                class="btn btn--subtle"
                type="button"
                data-pcc-project-open
                data-pcc-project-open-surface="recent-activity"
                data-pcc-project-id=${project.id}
                aria-label=${`Open ${project.title} from Recent Activity`}
                @click=${() => props.onSelectProject(project.id)}
              >
                Open
              </button>
            </li>`,
          )}
        </ol>`
      : html`<p class="pcc-empty pcc-empty--small">No recent project activity yet.</p>`}
  </section>`;
}

function renderTopPortfolioMetrics(
  props: PccDashboardProps,
  projects: readonly PccProjectSummary[],
) {
  const portfolio = props.portfolio;
  const needsAttentionCount =
    portfolio?.needsAttention ?? focusedAttentionProjects(projects).length;
  const runningCount = runningProjectsForToday(props).length;
  return html`<section
    class="pcc-today__metrics"
    data-pcc-top-metrics
    aria-label="Portfolio metrics"
  >
    ${renderCompactMetric("Active", portfolio?.active ?? 0)}
    ${renderCompactMetric("Needs You", needsAttentionCount)}
    ${renderCompactMetric("Running", runningCount)}
    <details class="pcc-today__metrics-more" data-pcc-top-metrics-more>
      <summary>More</summary>
      <div>
        ${renderMetric("Total projects", portfolio?.projectsTotal ?? projects.length)}
        ${renderMetric("Blocked", portfolio?.blocked ?? 0)}
        ${renderMetric("Needs approval", portfolio?.needsApproval ?? 0)}
        ${renderMetric("Archived", portfolio?.archived ?? 0)}
        ${renderMetric(
          "Average completion",
          `${clampPercent(portfolio?.averagePercentComplete ?? 0)}%`,
        )}
      </div>
    </details>
  </section>`;
}

function portfolioPlainSummary(params: {
  focusMode: "pcc_product" | "project_work";
  activeCount: number;
  needsYouCount: number;
  runningCount: number;
  deferredCount: number;
  selectedTitle?: string;
}): string {
  if (params.focusMode === "pcc_product") {
    if (params.needsYouCount === 0 && params.deferredCount > 0) {
      return `PCC is current. ${params.deferredCount} project-specific item${
        params.deferredCount === 1 ? "" : "s"
      } ${params.deferredCount === 1 ? "is" : "are"} outside PCC Product.`;
    }
    if (params.needsYouCount > 0) {
      return `${params.needsYouCount} PCC item${
        params.needsYouCount === 1 ? "" : "s"
      } ${params.needsYouCount === 1 ? "needs" : "need"} you before PCC is quiet.`;
    }
    return "PCC is current. No PCC Product work needs you right now.";
  }
  if (params.needsYouCount > 0) {
    return `${params.needsYouCount} project item${
      params.needsYouCount === 1 ? "" : "s"
    } need you now.`;
  }
  if (params.runningCount > 0) {
    return `${params.runningCount} project${params.runningCount === 1 ? " is" : "s are"} running.`;
  }
  return params.activeCount > 0
    ? `${params.activeCount} active project${params.activeCount === 1 ? "" : "s"} ready to review.`
    : "No active project work needs you right now.";
}

function renderCompactMetric(label: string, value: string | number) {
  return html`<span class="pcc-today__compact-metric"><strong>${value}</strong>${label}</span>`;
}

function pccOperationalEvidence(props: PccDashboardProps): PccEvidence[] {
  const details = Object.values(props.projectDetails ?? {});
  if (
    props.projectDetail &&
    !details.some((detail) => detail.project.id === props.projectDetail?.project.id)
  ) {
    details.push(props.projectDetail);
  }
  const byId = new Map<string, PccEvidence>();
  for (const detail of details) {
    for (const evidence of detail.evidence) {
      byId.set(evidence.id, evidence);
    }
  }
  return [...byId.values()];
}

function operationalHealthLabel(metrics: PccOperationalMetrics): string {
  switch (metrics.health) {
    case "meeting":
      return "Meeting target";
    case "at_risk":
      return "At risk";
    case "breached":
      return "Gate breached";
    default:
      return "Proof pending";
  }
}

function metricValue(value: number | null, suffix = "%"): string {
  return value === null ? "No data" : `${value}${suffix}`;
}

function renderPccOperationalMetrics(metrics: PccOperationalMetrics) {
  return html`<section
    class=${`pcc-operational-metrics pcc-operational-metrics--${metrics.health}`}
    data-pcc-operational-metrics
    data-pcc-operational-health=${metrics.health}
    aria-label="Operational quality and efficiency"
  >
    <header>
      <div>
        <span>Operational quality</span>
        <strong>${operationalHealthLabel(metrics)}</strong>
      </div>
      <small>Target ${metrics.target}/100 · ${metrics.source}</small>
    </header>
    <div class="pcc-operational-metrics__grid">
      ${renderCompactMetric("First pass", metricValue(metrics.firstPassRate))}
      ${renderCompactMetric("Error budget left", metricValue(metrics.errorBudgetRemaining))}
      ${renderCompactMetric("Quality gate", metricValue(metrics.qualityPassRate))}
      ${renderCompactMetric("Local first", metricValue(metrics.localFirstRate))}
      ${renderCompactMetric(
        "Paid use authorized",
        metrics.paidUseCount > 0
          ? `${metrics.authorizedPaidUseCount}/${metrics.paidUseCount}`
          : "None",
      )}
      ${renderCompactMetric("Rework attempts", metrics.reworkAttempts)}
      ${renderCompactMetric("Defects", metrics.defectCount)}
    </div>
    <p>
      ${metrics.latestEvidenceAt
        ? `Latest source evidence: ${metrics.latestEvidenceAt}`
        : "No evidence metadata has been recorded yet; no success is inferred."}
    </p>
    ${metrics.gaps.length
      ? html`<details>
          <summary>${metrics.gaps.length} proof gap${metrics.gaps.length === 1 ? "" : "s"}</summary>
          <ul>
            ${metrics.gaps.map((gap) => html`<li>${gap}</li>`)}
          </ul>
        </details>`
      : html`<p class="pcc-operational-metrics__ok">All measured gates meet policy.</p>`}
  </section>`;
}

function renderTodayProjectSignal(
  props: PccDashboardProps,
  label: string,
  project: PccProjectSummary | undefined,
  empty: string,
  detail?: string,
) {
  return html`<article
    class="pcc-today__primary-card"
    data-pcc-today-card=${label}
    data-pcc-project-id=${project?.id ?? ""}
  >
    <span>${label}</span>
    ${project
      ? html`<button
          type="button"
          data-pcc-project-open
          data-pcc-project-open-surface="today"
          data-pcc-project-id=${project.id}
          aria-label=${`Open ${project.title} from ${label}`}
          @click=${() => props.onSelectProject(project.id)}
        >
          <strong>${project.title}</strong>
          <em
            >${compactTodaySignal(
              detail ?? projectActionLine(project, props.projectDetails?.[project.id]),
            )}</em
          >
        </button>`
      : html`<p>${empty}</p>`}
  </article>`;
}

function renderPccFocusModeSwitch(props: PccDashboardProps) {
  const mode = effectivePccFocusMode(props);
  return html`<div class="pcc-focus-mode-wrap">
    <div class="pcc-focus-mode" data-pcc-focus-mode aria-label="PCC work context">
      <button
        class=${`pcc-focus-mode__option ${mode === "pcc_product" ? "is-selected" : ""}`}
        type="button"
        data-pcc-focus-mode-option="pcc_product"
        title="Show only work that affects the PCC product itself"
        @click=${() => props.onSetProductFocusMode?.("pcc_product")}
      >
        PCC Product
      </button>
      <button
        class=${`pcc-focus-mode__option ${mode === "project_work" ? "is-selected" : ""}`}
        type="button"
        data-pcc-focus-mode-option="project_work"
        title="Show user projects managed by PCC"
        @click=${() => props.onSetProductFocusMode?.("project_work")}
      >
        Project Work
      </button>
    </div>
    <small>
      ${mode === "pcc_product"
        ? "This view is only for finishing PCC itself."
        : "This view shows projects PCC will manage."}
    </small>
  </div>`;
}

function renderTodayView(props: PccDashboardProps) {
  const portfolio = props.portfolio;
  const focusProjects = focusScopedProjectsForToday(props, props.projects);
  const runningProjects = runningProjectsForToday(props);
  const attentionProjects = focusedAttentionProjects(focusProjects, props);
  const deferredProjects =
    effectivePccFocusMode(props) === "pcc_product"
      ? deferredAttentionProjects(props.projects, props)
      : [];
  const blocked = focusProjects.find(
    (project) =>
      projectCanBeNextBestAction(project) &&
      (project.status === "blocked" || project.milestoneCounts.blocked > 0),
  );
  const ready = focusProjects.find(
    (project) =>
      projectCanBeNextBestAction(project) &&
      project.nextActions.length > 0 &&
      project.status !== "blocked",
  );
  const working = runningProjects[0];
  const needsYou = attentionProjects[0];
  const nextBest = needsYou ?? blocked ?? ready ?? working;
  const nextLabel = nextBest
    ? `${nextBest.title}: ${compactTodaySignal(projectActionLine(nextBest, props.projectDetails?.[nextBest.id]), 70)}`
    : "No ready action";
  const average = clampPercent(portfolio?.averagePercentComplete ?? 0);
  const activeCount = focusProjects.filter((project) =>
    ["active", "in_progress", "reopened"].includes(project.status),
  ).length;
  const blockedCount = focusProjects.filter(
    (project) => project.status === "blocked" || project.milestoneCounts.blocked > 0,
  ).length;
  const portfolioNeedsAttention = attentionProjects.length;
  const focusMode = effectivePccFocusMode(props);
  const operationalMetrics = buildPccOperationalMetrics(pccOperationalEvidence(props));
  const plainSummary = portfolioPlainSummary({
    focusMode,
    activeCount,
    needsYouCount: portfolioNeedsAttention,
    runningCount: runningProjects.length,
    deferredCount: deferredProjects.length,
    selectedTitle: props.projectDetail?.project.title,
  });

  return html`<section class="pcc-today" data-pcc-today aria-label="Today">
    <div class="pcc-today__bar" data-pcc-today-compact-bar>
      <div class="pcc-today__bar-title">
        <span>Today</span>
        ${renderPccFocusModeSwitch(props)}
        <strong>${runningProjects.length} running</strong>
        <strong>${attentionProjects.length} Needs You</strong>
        <strong data-pcc-operational-health-compact>
          Quality ${operationalHealthLabel(operationalMetrics)}
        </strong>
        ${deferredProjects.length
          ? html`<strong>${deferredProjects.length} deferred</strong>`
          : nothing}
      </div>
      <p class="pcc-today__plain-summary" data-pcc-today-summary>${plainSummary}</p>
      <button
        class="pcc-today__next"
        type="button"
        ?disabled=${!nextBest}
        data-pcc-today-next-action
        @click=${() => nextBest && props.onSelectProject(nextBest.id)}
      >
        <span>Next</span>
        <strong>${nextLabel}</strong>
      </button>
      <details class="pcc-today__metrics-more" data-pcc-top-metrics-more>
        <summary>More</summary>
        <div>
          ${renderCompactMetric("Active", activeCount)}
          ${renderCompactMetric("Needs You", portfolioNeedsAttention)}
          ${renderCompactMetric("Running", runningProjects.length)}
          ${renderCompactMetric("All projects average", `${average}%`)}
        </div>
      </details>
    </div>

    <details class="pcc-today__overview" data-pcc-today-overview>
      <summary>Show overview</summary>
      <div class="pcc-today__overview-body">
        <div class="pcc-section-heading pcc-today__overview-heading">
          <div>
            <p class="pcc-kicker">Today</p>
            <h3>Your projects at a glance</h3>
            <p>Open one project, see the milestone journey, then work the next safe step.</p>
          </div>
          <span>${formatUpdatedAt(props.updatedAt)}</span>
        </div>
        ${renderTopPortfolioMetrics(props, props.projects)}
        <div class="pcc-today__hero-grid">
          ${renderTodayProjectSignal(
            props,
            "Working Now",
            working,
            "No project is actively working.",
            working
              ? `${workStateForProject(working, props.projectDetails?.[working.id])} · ${projectActionLine(working, props.projectDetails?.[working.id])}`
              : undefined,
          )}
          ${renderTodayProjectSignal(
            props,
            "Needs You",
            needsYou ?? blocked,
            "No approvals, blockers, or overdue projects need you.",
            needsYou ? projectAttentionLine(needsYou) : undefined,
          )}
          ${renderTodayProjectSignal(
            props,
            "Next Best Action",
            nextBest,
            "No ready action recorded.",
          )}
          <article class="pcc-today__primary-card" data-pcc-portfolio-progress>
            <span>Portfolio Progress</span>
            <strong>${average}%</strong>
            <em>
              ${activeCount} active · ${blockedCount} blocked · ${portfolioNeedsAttention} Needs You
            </em>
          </article>
        </div>
        ${renderPccOperationalMetrics(operationalMetrics)}
        <details class="pcc-today__drawer">
          <summary>Show all project queues</summary>
          <div class="pcc-today__queues">
            <article>
              <strong>Working</strong>
              <ul>
                ${runningProjects.slice(0, 8).map((project) => html`<li>${project.title}</li>`)}
              </ul>
            </article>
            <article>
              <strong>Needs You</strong>
              <ul>
                ${attentionProjects
                  .slice(0, 8)
                  .map(
                    (project) => html`<li>${project.title} — ${projectAttentionLine(project)}</li>`,
                  )}
              </ul>
            </article>
            <article>
              <strong>Deferred / Needs review</strong>
              <ul>
                ${deferredProjects
                  .slice(0, 8)
                  .map(
                    (project) =>
                      html`<li>
                        ${project.title} — ${compactTodaySignal(projectAttentionLine(project))}
                      </li>`,
                  )}
              </ul>
            </article>
          </div>
        </details>
      </div>
    </details>
  </section>`;
}

function renderNextSafeActionCard(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return nothing;
  }
  const next = getPccWorkLoopNext({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const item = next.subMilestone ?? next.milestone;
  const title = item?.title ?? "No safe action ready";
  const reason = next.blocker
    ? next.blocker.message
    : next.subMilestone
      ? "This sub-milestone is ready, local-safe, and next in order."
      : next.milestone
        ? "This milestone is ready and next in order."
        : "No eligible work remains.";
  return html`<section
    class="pcc-next-action"
    data-pcc-next-safe-action
    aria-label="Next safe action"
  >
    <div>
      <p class="pcc-kicker">Next Safe Action</p>
      <h4>${title}</h4>
      <p>${reason}</p>
    </div>
    <dl>
      <div>
        <dt>Why this</dt>
        <dd>${next.blocker ? "Blocked before work can start" : "First safe unblocked item"}</dd>
      </div>
      <div>
        <dt>Owner</dt>
        <dd>${item ? itemWorkerLabel(item) : "None"}</dd>
      </div>
      <div>
        <dt>Proof required</dt>
        <dd>${item ? itemProofLabel(item) : "None"}</dd>
      </div>
    </dl>
    <button
      class="btn"
      type="button"
      ?disabled=${Boolean(next.blocker) || props.actionBusy}
      @click=${props.onPrepareNextWorkItem}
    >
      Start
    </button>
  </section>`;
}

function renderPortfolioWorkConsole(props: PccDashboardProps) {
  const details = Object.values(props.projectDetails ?? {});
  const schedule = buildPccPortfolioSchedule(
    details.map((detail) => ({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones ?? [],
      permissions: detail.permissions,
      receipts: detail.receipts,
    })),
    {
      maxParallelProjects: 4,
      availableLocalModelSlots: 4,
      availableCodexSlots: 0,
      availableRemoteProofSlots: 0,
      availableVramGb: 256,
      availableRamGb: 256,
      policyMode: "as_many_as_safe",
      memoryPressure: "low",
      thermalPressure: "nominal",
      activeLocalModelProcesses: 0,
      activeOpenClawTasks: 0,
      activeCodexNeededTasks: 0,
      blockedTasks: 0,
      activeWorkspaceLocks: [],
    },
  );
  const hasRunnableWork = schedule.ready.length > 0;
  const body = html`
    <div class="pcc-section-heading">
      <div>
        <h4>Multi-project work console</h4>
        <p>
          Shows what can run now across projects without Codex, remote proof, or resource conflicts.
        </p>
      </div>
      <span>${schedule.ready.length} ready</span>
    </div>
    <div class="pcc-portfolio-console__controls" data-pcc-portfolio-plan-controls>
      <div class="pcc-portfolio-console__mode" role="status" data-pcc-portfolio-plan-mode>
        <strong>Plan only</strong>
        <span>
          ${schedule.ready.length
            ? "Ready work exists. Open a project and use Work This Project to start supervised execution."
            : "No local-safe portfolio work is ready to start."}
        </span>
      </div>
      <label
        ><span>Max parallel projects</span><input type="number" min="1" max="16" value="4" readonly
      /></label>
      <span>Policy: as many as safe</span>
      <span>Memory pressure: low</span>
      <span>VRAM budget: 256 GB</span>
      <span>Local agents only</span>
      <span>Stop before Codex</span>
      <span>Stop before remote proof</span>
    </div>
    <div class="pcc-portfolio-console__queues">
      <article>
        <strong>Next runnable work</strong>
        ${schedule.ready.length
          ? html`<ul>
              ${schedule.ready.slice(0, 5).map(
                (item) =>
                  html`<li>
                    <b>${item.projectTitle}</b>: ${item.title}
                    <span>${item.lane.replace(/_/g, " ")}</span>
                  </li>`,
              )}
            </ul>`
          : html`<p>No portfolio work is ready.</p>`}
      </article>
      <article>
        <strong>Blocked</strong>
        ${schedule.blocked.length
          ? html`<ul>
              ${schedule.blocked
                .slice(0, 5)
                .map((item) => html`<li><b>${item.projectTitle}</b>: ${item.reason}</li>`)}
            </ul>`
          : html`<p>No blocked projects loaded.</p>`}
      </article>
      <article>
        <strong>Resource limited</strong>
        ${schedule.resourceLimited.length
          ? html`<ul>
              ${schedule.resourceLimited
                .slice(0, 5)
                .map((item) => html`<li><b>${item.projectTitle}</b>: ${item.reason}</li>`)}
            </ul>`
          : html`<p>No resource conflicts.</p>`}
      </article>
    </div>
  `;
  return html`<section
    class="pcc-portfolio-console"
    data-pcc-portfolio-console
    data-pcc-portfolio-console-ready=${hasRunnableWork ? "true" : "false"}
    aria-label="Multi-project work console"
  >
    ${hasRunnableWork
      ? body
      : html`<details>
          <summary>
            <span>Multi-project work console</span>
            <strong>No ready portfolio work</strong>
          </summary>
          ${body}
        </details>`}
  </section>`;
}

function renderCurrentTruthAndReadyQueue(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return nothing;
  }
  const setupEvaluation = setupEvaluationForDetail(detail);
  const settings = getPccWorkLoopSettings(detail.project);
  if (projectIsTerminal(detail.project)) {
    return html`<section
      class="pcc-work-loop pcc-work-loop--complete"
      data-pcc-work-loop
      data-pcc-work-loop-complete
      aria-label="Project maintenance"
    >
      <div class="pcc-work-loop__header">
        <div>
          <p class="pcc-kicker">Maintenance</p>
          <h4>Project is complete</h4>
          <p>Active work controls are hidden. Review proof or create a new improvement.</p>
        </div>
        <span class="pcc-status pcc-status--complete">Complete</span>
      </div>
      <div class="pcc-work-loop__controls">
        <button class="btn" type="button" @click=${() => props.onSetViewMode?.("detailed")}>
          View proof
        </button>
        <button class="btn btn--subtle" type="button" @click=${() => props.onOpenMilestoneEditor()}>
          Create improvement
        </button>
      </div>
    </section>`;
  }
  const next = getPccWorkLoopNext({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const nextTitle = next.subMilestone?.title ?? next.milestone?.title ?? "No eligible work";
  const blocked = next.blocker?.message ?? "None";
  const proofMissing =
    detail.summary.proofGaps[0] ??
    (next.subMilestone || next.milestone
      ? itemProofLabel(next.subMilestone ?? next.milestone!)
      : "None");
  const stopPoint =
    detail.milestones.find((milestone) => milestoneStopsHere(milestone))?.title ?? "None";
  const readyItems: Array<PccMilestone | PccSubMilestone> = detail.milestones
    .flatMap((milestone): Array<PccMilestone | PccSubMilestone> => {
      const subItems = subMilestonesForMilestone(detail, milestone).filter(
        (subMilestone) =>
          !["complete", "complete_with_maintenance", "skipped", "archived"].includes(
            subMilestone.status,
          ),
      );
      return subItems.length > 0 ? subItems : [milestone];
    })
    .filter(
      (item) =>
        !["blocked", "needs_approval", "deferred", "on_hold", "failed"].includes(item.status),
    )
    .slice(0, 5);
  const blockedItems: Array<PccMilestone | PccSubMilestone> = detail.milestones
    .flatMap(
      (milestone): Array<PccMilestone | PccSubMilestone> => [
        milestone,
        ...subMilestonesForMilestone(detail, milestone),
      ],
    )
    .filter((item) =>
      ["blocked", "needs_approval", "deferred", "on_hold", "failed"].includes(item.status),
    )
    .slice(0, 5);
  return html`<section class="pcc-current-truth" data-pcc-current-truth aria-label="Current truth">
    <div class="pcc-section-heading">
      <div>
        <h4>Current Truth</h4>
        <p>Fast status for what is happening now and what is safe to do next.</p>
      </div>
      <span>${formatUpdatedAt(props.updatedAt)}</span>
    </div>
    <dl class="pcc-current-truth__facts">
      ${renderTruthFact("Current state", formatStatus(detail.project.status))}
      ${renderTruthFact("Next action", nextTitle)} ${renderTruthFact("Blocked by", blocked)}
      ${renderTruthFact("Setup", `${setupEvaluation.badge} ${setupEvaluation.score}/100`)}
      ${renderTruthFact(
        "Needs you",
        detail.permissions.some((permission) => permission.status === "needed") ||
          detail.project.status === "needs_approval"
          ? "Yes"
          : "None",
      )}
      ${renderTruthFact("Working", settings.enabled ? formatStatus(next.state) : "Off")}
      ${renderTruthFact("Codex needed", next.state === "waiting_for_codex" ? "Yes" : "Not now")}
      ${renderTruthFact("Proof missing", proofMissing)} ${renderTruthFact("Stop point", stopPoint)}
    </dl>
    <div class="pcc-ready-queue" data-pcc-ready-queue>
      <article>
        <strong>Ready Now</strong>
        ${readyItems.length
          ? html`<ul>
              ${readyItems.map((item) => html`<li>${item.title}</li>`)}
            </ul>`
          : html`<p>No ready work items</p>`}
      </article>
      <article>
        <strong>Blocked</strong>
        ${blockedItems.length
          ? html`<ul>
              ${blockedItems.map(
                (item) => html`<li>${item.title}: ${formatStatus(item.status)}</li>`,
              )}
            </ul>`
          : html`<p>No blocked work items</p>`}
      </article>
    </div>
  </section>`;
}

function renderAutopilotPromptSlot(slot: PccAutopilotPromptSlot, props: PccDashboardProps) {
  return html`<article
    class="pcc-autopilot-prompt"
    data-pcc-autopilot-prompt
    data-pcc-autopilot-prompt-id=${slot.id}
  >
    <header>
      <label>
        <input
          type="checkbox"
          .checked=${slot.enabled}
          ?disabled=${props.actionBusy}
          @change=${(event: Event) =>
            props.onUpdateAutopilotPrompt?.(slot.id, {
              enabled: (event.target as HTMLInputElement).checked,
            })}
        />
        Enabled
      </label>
      <span>${slot.title} · v${slot.version}</span>
    </header>
    <label>
      <span>Prompt title</span>
      <input
        .value=${slot.title}
        ?disabled=${props.actionBusy}
        @change=${(event: Event) =>
          props.onUpdateAutopilotPrompt?.(slot.id, {
            title: (event.target as HTMLInputElement).value,
          })}
      />
    </label>
    <label>
      <span>Prompt body</span>
      <textarea
        rows="5"
        .value=${slot.promptBody}
        ?disabled=${props.actionBusy}
        @change=${(event: Event) =>
          props.onUpdateAutopilotPrompt?.(slot.id, {
            promptBody: (event.target as HTMLTextAreaElement).value,
          })}
      ></textarea>
    </label>
    <div class="pcc-autopilot-prompt__meta">
      <span
        >Executor:
        ${slot.executor === "safe_stub" ? "Safe stub" : formatStatus(slot.executor)}</span
      >
      <span>Reasoning: ${slot.reasoningLevel ?? "standard"}</span>
      <span>Approval: ${formatStatus(slot.approvalTier)}</span>
      <span>Judge: ${formatStatus(slot.judge)}</span>
    </div>
    ${slot.lastRunResult
      ? html`<p data-pcc-autopilot-last-run>${slot.lastRunResult}</p>`
      : html`<p data-pcc-autopilot-last-run>Not run yet.</p>`}
  </article>`;
}

function renderAutopilotProjectLoop(detail: PccProjectDetail, props: PccDashboardProps) {
  const autopilot = getPccAutopilotState({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    evidence: detail.evidence,
    decisions: detail.decisions ?? [],
  });
  const mode = pccViewMode(props);
  const enabledPrompts = autopilot.promptSlots.filter((slot) => slot.enabled);
  const permissionForecast = buildPccAutopilotPermissionForecast(autopilot);
  const latestRun = autopilot.runHistory.at(-1);
  const latestJudge = autopilot.latestJudgeResult;
  const blocker = autopilot.currentBlocker;
  const activeGrants = autopilot.permissionGrants.filter((grant) => grant.status === "active");
  const pendingQueue = autopilot.permissionQueue.filter((item) => item.status === "pending");
  const recentQueue = autopilot.permissionQueue.slice(-5).toReversed();
  const repairPreview =
    autopilot.permissionRepair?.status === "preview" ? autopilot.permissionRepair : undefined;
  const executionProfile = normalizePccExecutionProfile(detail.project.metadata);
  const executionOption = localExecutionOption(executionProfile.speed);
  return html`<section
    class="pcc-autopilot"
    data-pcc-autopilot-project-loop
    data-pcc-mobile-section="autopilot"
    data-pcc-autopilot-status=${autopilot.status}
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Autopilot Project Loop</p>
        <h4>Structured AI loop</h4>
        <p>
          Separate from milestones. Uses editable prompts, safe approvals, judge review, history,
          and final reports.
        </p>
      </div>
      <span class="pcc-status pcc-status--${autopilot.status}" data-pcc-autopilot-status-label>
        ${autopilot.executionMode === "simulation" && autopilot.status === "completed"
          ? "Simulation complete"
          : autopilotStatusLabel(autopilot.status)}
      </span>
    </div>
    <article class="pcc-autopilot__inherited-profile" data-pcc-autopilot-execution-profile>
      <div>
        <span>Project team</span>
        <strong>${executionOption.title.replace(" · Recommended", "")}</strong>
        <small>${summarizePccExecutionProfile(executionProfile)}</small>
      </div>
      <p>
        Autopilot inherits the local work speed and visible Codex checkpoint policy. Prompt slots
        may narrow either setting, but cannot silently enable Codex or exceed safe local capacity.
      </p>
    </article>
    <article class="pcc-autopilot__status-card" data-pcc-autopilot-status-card>
      <dl>
        ${renderTruthFact("Mode", autopilot.modeTitle)}
        ${renderTruthFact(
          "Active prompt",
          autopilot.promptSlots.find((slot) => slot.id === autopilot.activePromptSlotId)?.title ??
            enabledPrompts[0]?.title ??
            "None",
        )}
        ${renderTruthFact("Current set", String(autopilot.currentSet))}
        ${renderTruthFact("Completed sets", String(autopilot.completedSets))}
        ${renderTruthFact("Prompt iterations", String(autopilot.totalPromptIterations))}
        ${renderTruthFact(
          "Executor",
          autopilot.currentExecutor === "safe_stub"
            ? "Safe stub (simulation)"
            : formatStatus(autopilot.currentExecutor),
        )}
        ${renderTruthFact(
          "Last output",
          autopilot.lastOutputSummary ?? latestRun?.outputSummary ?? "No output yet",
        )}
        ${renderTruthFact("Blocker", blocker?.whyBlocked ?? "None")}
        ${renderTruthFact(
          "Next action",
          blocker?.recommendedNextAction ??
            (autopilot.status === "off"
              ? "Choose a mode and generate prompts"
              : "Review prompts or start safe loop"),
        )}
        ${renderTruthFact("Judge", latestJudge?.summary ?? "Judge not run")}
      </dl>
      <p class="pcc-autopilot__safety" data-pcc-autopilot-safe-stub>
        Simulation mode is active: PCC records prompts and review guidance only. It does not claim
        live implementation, spend Codex/high-reasoning tokens, deploy, delete files, change
        credentials, reboot, or perform external writes.
      </p>
    </article>
    ${permissionForecast.required
      ? html`<article class="pcc-autopilot__permission" data-pcc-autopilot-permission-request>
          <div>
            <p class="pcc-kicker">Permission needed before start</p>
            <h5>${permissionForecast.reason}</h5>
            <p>${permissionForecast.policySummary}</p>
            <p>${permissionForecast.recommendedNextAction}</p>
            <ul>
              ${permissionForecast.promptTitles.map((title) => html`<li>${title}</li>`)}
            </ul>
          </div>
          <div class="pcc-autopilot__permission-actions">
            ${permissionForecast.requiredTier === "low"
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-autopilot-allow-low
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onRunAutopilotAction?.("allow_low_risk")}
                >
                  Allow low-risk loop
                </button>`
              : nothing}
            ${permissionForecast.requiredTier === "medium"
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-autopilot-allow-medium
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onRunAutopilotAction?.("allow_medium_risk")}
                >
                  Allow medium-risk loop
                </button>`
              : nothing}
            ${permissionForecast.requiredTier === "high"
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-autopilot-allow-high
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onRunAutopilotAction?.("allow_high_risk")}
                >
                  Allow high-risk loop
                </button>`
              : nothing}
            <button
              class="btn btn--subtle"
              type="button"
              data-pcc-autopilot-deny-permission
              ?disabled=${props.actionBusy}
              @click=${() => props.onRunAutopilotAction?.("deny_permission")}
            >
              Not now
            </button>
          </div>
        </article>`
      : html`<p class="pcc-autopilot__permission-ready" data-pcc-autopilot-permission-ready>
          Permission preflight: ${permissionForecast.policySummary}.
        </p>`}
    <section class="pcc-autopilot__permission-ledger" data-pcc-autopilot-permission-ledger>
      <article data-pcc-autopilot-permission-queue>
        <p class="pcc-kicker">Permission queue</p>
        ${pendingQueue.length
          ? html`<ul>
              ${pendingQueue.map(
                (item) => html`<li>
                  <strong>${formatStatus(item.riskTier)} approval waiting</strong>
                  <p>${item.reason}</p>
                  <small>Approve: ${item.approvalConsequence}</small>
                  <small>Deny: ${item.denialConsequence}</small>
                </li>`,
              )}
            </ul>`
          : html`<p class="pcc-empty pcc-empty--small">No Autopilot permissions waiting.</p>`}
        ${mode === "simple" || recentQueue.length === 0
          ? nothing
          : html`<details>
              <summary>Recent queue history (${recentQueue.length})</summary>
              <ul>
                ${recentQueue.map(
                  (item) => html`<li>
                    ${formatStatus(item.riskTier)} · ${formatStatus(item.status)} · ${item.reason}
                  </li>`,
                )}
              </ul>
            </details>`}
      </article>
      <article data-pcc-autopilot-grant-history>
        <p class="pcc-kicker">Autopilot grants</p>
        ${activeGrants.length
          ? html`<ul>
                ${activeGrants.map(
                  (grant) => html`<li>
                    <strong>${formatStatus(grant.riskTier)} grant active</strong>
                    <p>${grant.reason}</p>
                    <small>${grant.allowedActions.join(", ")}</small>
                  </li>`,
                )}
              </ul>
              <button
                class="btn btn--subtle"
                type="button"
                data-pcc-autopilot-revoke-grant
                ?disabled=${props.actionBusy}
                @click=${() => props.onRunAutopilotAction?.("revoke_permission_grant")}
              >
                Revoke latest grant
              </button>`
          : html`<p class="pcc-empty pcc-empty--small">No active Autopilot grants.</p>`}
      </article>
    </section>
    ${repairPreview
      ? html`<article class="pcc-autopilot__repair" data-pcc-autopilot-repair-preview>
          <p class="pcc-kicker">Judge repair recommendation</p>
          <h5>${repairPreview.title}</h5>
          <p>${repairPreview.summary}</p>
          <ul>
            ${repairPreview.changes.map((change) => html`<li>${change}</li>`)}
          </ul>
          <button
            class="btn"
            type="button"
            data-pcc-autopilot-apply-repair
            ?disabled=${props.actionBusy}
            @click=${() => props.onRunAutopilotAction?.("apply_permission_repair")}
          >
            Apply repair recommendation
          </button>
        </article>`
      : nothing}
    <div class="pcc-autopilot__controls" data-pcc-autopilot-controls>
      <label>
        <span>Loop mode</span>
        <select
          .value=${autopilot.mode}
          ?disabled=${props.actionBusy}
          data-pcc-autopilot-mode-picker
          @change=${(event: Event) =>
            props.onConfigureAutopilotMode?.(
              (event.target as HTMLSelectElement).value as PccAutopilotModeId,
            )}
        >
          ${PCC_AUTOPILOT_MODES.map(
            (loopMode) => html`<option value=${loopMode.id}>${loopMode.title}</option>`,
          )}
        </select>
      </label>
      <button
        class="btn"
        type="button"
        data-pcc-autopilot-generate-prompts
        ?disabled=${props.actionBusy}
        @click=${() => props.onGenerateAutopilotPrompts?.()}
      >
        Generate Loop Prompts
      </button>
      <button
        class="btn"
        type="button"
        data-pcc-autopilot-start
        ?disabled=${props.actionBusy || enabledPrompts.length === 0 || permissionForecast.required}
        @click=${() => props.onRunAutopilotAction?.("start")}
      >
        Start Safe Loop
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-pause
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("pause")}
      >
        Pause
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-resume
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("resume")}
      >
        Resume
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-stop
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("stop")}
      >
        Stop now
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-block
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("block")}
      >
        Mark blocked
      </button>
    </div>
    <details class="pcc-autopilot__prompts" data-pcc-autopilot-prompts open>
      <summary>Prompt slots (${enabledPrompts.length}/5 enabled)</summary>
      ${mode === "simple"
        ? html`<p class="pcc-empty pcc-empty--small">
            Prompt editors are hidden in Simple view. Switch to Detailed to edit prompts.
          </p>`
        : html`<div class="pcc-autopilot__prompt-grid">
            ${autopilot.promptSlots.map((slot) => renderAutopilotPromptSlot(slot, props))}
          </div>`}
    </details>
    <details class="pcc-autopilot__history" data-pcc-autopilot-history>
      <summary>Run history and judge review (${autopilot.runHistory.length})</summary>
      ${mode === "simple"
        ? html`<p class="pcc-empty pcc-empty--small">
            Run history is lazy-loaded in Detailed view.
          </p>`
        : autopilot.runHistory.length
          ? html`<ol>
              ${autopilot.runHistory
                .slice(-10)
                .toReversed()
                .map(
                  (run) => html`<li data-pcc-autopilot-run>
                    <strong>${run.promptTitle}</strong>
                    <span>${run.executor} · ${formatUpdatedAt(Date.parse(run.timestamp))}</span>
                    <p>${run.outputSummary}</p>
                    <small data-pcc-autopilot-context-summary>
                      Context: ${run.inputContextSummary || "No context summary recorded."}
                    </small>
                    <small data-pcc-autopilot-change-summary>
                      Changes: ${run.changedFiles.length}
                      file${run.changedFiles.length === 1 ? "" : "s"} · ${run.artifacts.length}
                      artifact${run.artifacts.length === 1 ? "" : "s"} · ${run.checksRun.length}
                      check${run.checksRun.length === 1 ? "" : "s"}
                    </small>
                    ${run.approvals.length
                      ? html`<small data-pcc-autopilot-approval-summary
                          >Approvals: ${run.approvals.join(", ")}</small
                        >`
                      : html`<small data-pcc-autopilot-approval-summary
                          >Approvals: none used</small
                        >`}
                    ${run.judgeResult ? html`<em>Judge: ${run.judgeResult.summary}</em>` : nothing}
                  </li>`,
                )}
            </ol>`
          : html`<p class="pcc-empty pcc-empty--small">No Autopilot runs yet.</p>`}
    </details>
    <details
      class="pcc-autopilot__report"
      data-pcc-autopilot-final-report
      ?open=${Boolean(autopilot.finalReport)}
    >
      <summary>Final report</summary>
      ${mode === "simple"
        ? html`<p class="pcc-empty pcc-empty--small">
            Final report details are available in Detailed view.
          </p>`
        : autopilot.finalReport
          ? html`<dl>
                ${renderTruthFact("Project", autopilot.finalReport.projectName)}
                ${renderTruthFact("Sets", String(autopilot.finalReport.setsCompleted))}
                ${renderTruthFact("Prompt runs", String(autopilot.finalReport.totalPromptRuns))}
                ${renderTruthFact("Judge", autopilot.finalReport.judgeResult)}
                ${renderTruthFact(
                  "Next loop",
                  formatStatus(autopilot.finalReport.recommendedNextLoop),
                )}
              </dl>
              <strong>Remaining risks</strong>
              <ul>
                ${autopilot.finalReport.remainingRisks
                  .slice(0, 8)
                  .map((risk) => html`<li>${risk}</li>`)}
              </ul>`
          : html`<p class="pcc-empty pcc-empty--small">Run a loop to generate a final report.</p>`}
    </details>
  </section>`;
}

function renderPccExecutionTeamCard(props: PccDashboardProps, detail: PccProjectDetail) {
  const readiness = buildPccExecutionTeamReadiness(
    detail,
    props.executionCapacity,
    props.agentsList,
    props.modelCatalog,
    Object.values(props.projectDetails ?? {}),
  );
  const running = readiness.status === "running";
  const ready = readiness.status === "ready";
  const partitionByTaskId = new Map(
    (readiness.activePlan?.partitions ?? []).map((partition) => [partition.taskId, partition]),
  );
  const latestPlan = executionPlansFromProject(detail.project).at(-1);
  const pendingProofCandidates = (latestPlan?.proofCandidates ?? []).filter(
    (candidate) => candidate.status === "pending_review",
  );
  const buttonLabel = running
    ? "Stop agent team"
    : ready
      ? props.onStartExecution
        ? "Start supervised execution"
        : `Run with ${readiness.admittedLocalAgents} worker${readiness.admittedLocalAgents === 1 ? "" : "s"}`
      : readiness.status === "needs_approval"
        ? "Review Codex approval"
        : "Change team";
  return html`<section
    class="pcc-execution-team pcc-execution-team--${readiness.status}"
    data-pcc-execution-team
    data-pcc-execution-team-status=${readiness.status}
    aria-label="OpenClaw agent team"
  >
    <header>
      <div>
        <span>Agent team</span>
        <strong>
          ${readiness.profile.speed === "ultra"
            ? "Ultra"
            : readiness.profile.speed === "parallel"
              ? "Parallel"
              : "Focused"}
        </strong>
      </div>
      <em>${formatStatus(readiness.status)}</em>
    </header>
    <p>${readiness.reason}</p>
    <div class="pcc-execution-team__facts">
      <span
        ><b>${readiness.admittedLocalAgents}</b> OpenClaw
        worker${readiness.admittedLocalAgents === 1 ? "" : "s"}</span
      >
      <span
        ><b>${readiness.tasks.length}</b> safe task${readiness.tasks.length === 1 ? "" : "s"}</span
      >
      <span
        ><b
          >${readiness.profile.codexRole === "off"
            ? "Off"
            : formatStatus(readiness.profile.codexRole)}</b
        >
        Codex</span
      >
      <span><b>${readiness.coordinatorAgentId ?? "Not assigned"}</b> coordinator</span>
    </div>
    <div class="pcc-execution-team__actions">
      <button
        class="btn ${ready || running ? "" : "btn--subtle"}"
        type="button"
        data-pcc-execution-team-action=${running ? "stop" : ready ? "start" : "configure"}
        ?disabled=${props.actionBusy ||
        (running
          ? !props.onStopExecution && !props.onRunExecutionTeam
          : ready && !props.onStartExecution && !props.onRunExecutionTeam)}
        @click=${() =>
          running
            ? (props.onStopExecution?.() ?? props.onRunExecutionTeam?.("stop"))
            : ready
              ? (props.onStartExecution?.() ?? props.onRunExecutionTeam?.("start"))
              : props.onOpenProjectEditor(detail.project)}
      >
        ${buttonLabel}
      </button>
      ${readiness.tasks.length
        ? html`<details>
            <summary>See task assignments</summary>
            <ol>
              ${readiness.tasks.slice(0, 12).map((task) => {
                const partition = partitionByTaskId.get(task.id);
                return html`<li data-pcc-execution-assignment=${task.id}>
                  <strong>${task.title}</strong>
                  <span>${task.workspaceId}</span>
                  <small data-pcc-execution-model-provenance
                    >${partition?.modelId ??
                    readiness.workerModelId ??
                    "Model selected at start"}${partition?.modelRationale
                      ? ` · ${partition.modelRationale}`
                      : ""}</small
                  >
                </li>`;
              })}
            </ol>
          </details>`
        : nothing}
      ${pendingProofCandidates.length && props.onReviewExecutionProofCandidate
        ? html`<section
            class="pcc-execution-team__proof"
            data-pcc-execution-proof-review
            aria-label="Proof candidates awaiting review"
          >
            <strong>Review worker results</strong>
            <p>These are proof candidates only. Accepting one does not complete a milestone.</p>
            <ul>
              ${pendingProofCandidates.map(
                (candidate) => html`<li data-pcc-proof-candidate=${candidate.id}>
                  <div>
                    <strong>${candidate.summary}</strong>
                    <small>
                      ${candidate.checks.length} checks · ${candidate.changedFiles.length} changed
                      file${candidate.changedFiles.length === 1 ? "" : "s"}
                    </small>
                  </div>
                  <div class="pcc-execution-team__proof-actions">
                    <button
                      class="btn"
                      type="button"
                      data-pcc-proof-review="accept"
                      ?disabled=${props.actionBusy}
                      @click=${() =>
                        props.onReviewExecutionProofCandidate?.(candidate.id, "accept")}
                    >
                      Accept for milestone review
                    </button>
                    <button
                      class="btn btn--subtle"
                      type="button"
                      data-pcc-proof-review="reject"
                      ?disabled=${props.actionBusy}
                      @click=${() =>
                        props.onReviewExecutionProofCandidate?.(candidate.id, "reject")}
                    >
                      Reject result
                    </button>
                  </div>
                </li>`,
              )}
            </ul>
          </section>`
        : nothing}
    </div>
    <small>
      PCC only groups explicitly independent tasks with separate workspace locks. It stops before
      unapproved Codex, external writes, deployment, credentials, destructive actions, or reboot.
      Team output becomes reviewable proof; it never auto-completes a milestone.
    </small>
  </section>`;
}

function pccLearningCandidatesFromProject(project: PccProject): Array<Record<string, unknown>> {
  const candidates = metadataObject(project.metadata).pccLearningCandidates;
  return Array.isArray(candidates)
    ? candidates.filter(
        (candidate): candidate is Record<string, unknown> =>
          candidate !== null && typeof candidate === "object" && !Array.isArray(candidate),
      )
    : [];
}

function renderPccLearningLoopSummary(detail: PccProjectDetail) {
  const candidates = pccLearningCandidatesFromProject(detail.project);
  const proposed = candidates.filter((candidate) => candidate.status === "proposed").length;
  const trials = candidates.filter((candidate) => candidate.status === "trial").length;
  const promoted = candidates.filter((candidate) => candidate.status === "promoted").length;
  return html`<section class="pcc-learning-loop" data-pcc-learning-loop>
    <header>
      <div>
        <span>Learning loop</span>
        <strong>Recommendations only</strong>
      </div>
      <em>${candidates.length} saved</em>
    </header>
    <p>
      PCC can propose reusable improvements only from finalized, sanitized proof. It never edits
      prompts, skills, workflows, models, or runtime settings by itself.
    </p>
    <div class="pcc-learning-loop__facts">
      <span><b>${proposed}</b> proposed</span>
      <span><b>${trials}</b> in trial</span>
      <span><b>${promoted}</b> proven at 93+</span>
    </div>
    ${candidates.length
      ? html`<details>
          <summary>Review recommendations</summary>
          <ol>
            ${candidates.slice(0, 5).map(
              (candidate) => html`<li>
                <strong>${metadataString(candidate.status, "proposed")}</strong>
                <span>${metadataString(candidate.contentSummary, "No summary recorded.")}</span>
              </li>`,
            )}
          </ol>
        </details>`
      : html`<small>No evidence-backed learning recommendation has been saved yet.</small>`}
  </section>`;
}

function renderWorkLoopCard(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return nothing;
  }
  const setupEvaluation = setupEvaluationForDetail(detail);
  const settings = getPccWorkLoopSettings(detail.project);
  const activePlan = executionPlansFromProject(detail.project).findLast((plan) =>
    isPccExecutionPlanActive(plan.status),
  );
  const latestPlan = executionPlansFromProject(detail.project).at(-1);
  const next = getPccWorkLoopNext({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const workLabel = activePlan
    ? activePlan.status === "paused"
      ? "Paused"
      : activePlan.status === "blocked"
        ? "Blocked"
        : "Working"
    : latestPlan?.status === "failed" || latestPlan?.status === "lost"
      ? "Failed"
      : next.blocker
        ? formatStatus(next.state)
        : "Ready";
  const nextTitle = next.subMilestone
    ? `${next.milestone?.title ?? "Milestone"}: ${next.subMilestone.title}`
    : (next.milestone?.title ?? "No eligible milestone");
  const projectOnHold = projectIsOnHold(detail.project);
  const workStartBlockers = workStartBlockersForDetail(detail);
  const resolvedAction = resolvePccProjectAction(detail);
  const message = projectIsTerminal(detail.project)
    ? "Project is complete or archived; reopen it before starting new work."
    : workStartBlockers.length > 0
      ? (workStartBlockers[0] ?? "Review blockers before starting work.")
      : latestPlan?.status === "failed" || latestPlan?.status === "lost"
        ? (latestPlan.statusReason ??
          "The previous execution attempt failed; review it before retrying.")
        : !setupEvaluation.runnable
          ? `Setup quality gate is ${setupEvaluation.badge.toLowerCase()}; use Generate setup with AI or Edit manually before starting.`
          : (next.blocker?.message ??
            settings.lastLoopMessage ??
            "Ready for the next safe milestone.");
  const prepareNeedsSetupRepair = !setupEvaluation.runnable && !projectIsTerminal(detail.project);
  if (projectIsTerminal(detail.project)) {
    return nothing;
  }
  if (resolvedAction.hideWorkControls) {
    return html`<section
      class="pcc-work-loop pcc-work-loop--inactive"
      data-pcc-work-loop
      ?data-pcc-work-loop-complete=${projectIsTerminal(detail.project)}
      aria-label="Guided work loop"
    >
      <div class="pcc-work-loop__header">
        <div>
          <p class="pcc-kicker">Work controls</p>
          <h4>${projectActionLabel(resolvedAction, props.projectForm)}</h4>
          <p>${resolvedAction.explanation}</p>
        </div>
        <span class="pcc-status">${resolvedAction.statusLabel}</span>
      </div>
    </section>`;
  }
  const workStartDisabled =
    props.actionBusy ||
    projectIsTerminal(detail.project) ||
    projectOnHold ||
    !setupEvaluation.runnable ||
    (Boolean(activePlan) && !(activePlan?.status === "paused" && Boolean(props.onResumeExecution)));
  const resumeWithGateway = activePlan?.status === "paused" && Boolean(props.onResumeExecution);
  const startWithGateway = Boolean(props.onStartExecution) && !activePlan;
  return html`
    <section class="pcc-work-loop" data-pcc-work-loop aria-label="Guided work loop">
      <div class="pcc-work-loop__header">
        <div>
          <p class="pcc-kicker">Guided runner</p>
          <h4>Work This Project</h4>
          <p>
            Moves one safe milestone at a time and stops before Codex, remote proof, or missing
            permission.
          </p>
        </div>
        <span
          class="pcc-status pcc-work-loop-state--${activePlan?.status ??
          (next.blocker ? next.state : "idle")}"
        >
          ${workLabel}
        </span>
      </div>
      <div class="pcc-work-loop__controls">
        <button
          class="btn"
          type="button"
          ?disabled=${workStartDisabled}
          @click=${() =>
            resumeWithGateway
              ? props.onResumeExecution?.()
              : startWithGateway
                ? props.onStartExecution?.()
                : props.onUpdateWorkLoop({
                    enabled: !settings.enabled,
                    state: settings.enabled ? "idle" : "working",
                  })}
        >
          ${activePlan?.status === "paused"
            ? "Resume"
            : activePlan
              ? "Working"
              : startWithGateway
                ? "Work This Project"
                : settings.enabled
                  ? "Turn off"
                  : "Work This Project"}
        </button>
        ${projectOnHold
          ? html`<button
              class="btn"
              type="button"
              data-pcc-resume-project
              ?disabled=${props.actionBusy || !props.onResumeProject}
              @click=${() => props.onResumeProject?.()}
            >
              Resume Project
            </button>`
          : nothing}
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy ||
          activePlan?.status === "paused" ||
          (Boolean(activePlan) && !props.onPauseExecution)}
          @click=${() =>
            activePlan
              ? props.onPauseExecution?.()
              : props.onUpdateWorkLoop({ state: "paused", enabled: true })}
        >
          Pause
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy ||
          projectIsTerminal(detail.project) ||
          projectOnHold ||
          (prepareNeedsSetupRepair && !props.onPreviewSetupAutofill)}
          @click=${prepareNeedsSetupRepair
            ? props.onPreviewSetupAutofill
            : props.onPrepareNextWorkItem}
        >
          ${prepareNeedsSetupRepair ? "Generate setup with AI" : "Prepare next safe task"}
        </button>
      </div>
      ${renderPccExecutionTeamCard(props, detail)} ${renderPccLearningLoopSummary(detail)}
      <details class="pcc-safety-settings" data-pcc-safety-settings>
        <summary>Safety settings</summary>
        <div class="pcc-work-loop__toggles">
          <label>
            <input
              type="checkbox"
              .checked=${settings.stopAfterCurrentTask}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  stopAfterCurrentTask: (event.target as HTMLInputElement).checked,
                })}
            />
            Stop after current task
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${settings.stopAfterCurrentMilestone}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  stopAfterCurrentMilestone: (event.target as HTMLInputElement).checked,
                })}
            />
            Stop after current milestone
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${settings.continueAroundBlockers}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  continueAroundBlockers: (event.target as HTMLInputElement).checked,
                })}
            />
            Continue around blockers
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${settings.stopBeforeCodex}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  stopBeforeCodex: (event.target as HTMLInputElement).checked,
                })}
            />
            Stop before Codex
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${settings.stopBeforeDestructiveAction}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  stopBeforeDestructiveAction: (event.target as HTMLInputElement).checked,
                })}
            />
            Stop before destructive actions
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${settings.stopBeforeRemoteProof}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  stopBeforeRemoteProof: (event.target as HTMLInputElement).checked,
                })}
            />
            Stop before remote proof
          </label>
        </div>
        <div class="pcc-work-loop__parallel" data-pcc-work-lanes>
          <label>
            <span>Parallel Work</span>
            <select
              .value=${settings.parallelWorkMode}
              @change=${(event: Event) =>
                props.onUpdateWorkLoop({
                  parallelWorkMode: (event.target as HTMLSelectElement)
                    .value as PccParallelWorkMode,
                })}
            >
              ${renderStringOptions(PARALLEL_WORK_OPTIONS, settings.parallelWorkMode)}
            </select>
          </label>
          <div class="pcc-work-loop__lanes">
            ${LANE_LABELS.map(
              ([lane, label]) => html`<label>
                <input
                  type="checkbox"
                  .checked=${settings.lanes[lane]}
                  @change=${(event: Event) =>
                    props.onUpdateWorkLoop({
                      lanes: {
                        ...settings.lanes,
                        [lane]: (event.target as HTMLInputElement).checked,
                      },
                    })}
                />
                ${label}
              </label>`,
            )}
          </div>
        </div>
      </details>
      <div class="pcc-work-loop__next">
        <span>Next</span>
        <strong>${nextTitle}</strong>
        <p>${message}</p>
        ${workStartBlockers.length > 1
          ? html`<ol class="pcc-work-loop__blockers" data-pcc-work-start-blockers>
              ${workStartBlockers.slice(0, 6).map((blocker) => html`<li>${blocker}</li>`)}
            </ol>`
          : nothing}
      </div>
      ${next.taskPrompt
        ? html`<details class="pcc-work-loop__prompt" data-pcc-task-prompt>
            <summary>Task prompt preview</summary>
            <pre>${next.taskPrompt}</pre>
          </details>`
        : nothing}
    </section>
  `;
}

function milestoneDisplayPercent(milestone: PccMilestone): number {
  if (milestone.status === "complete" || milestone.status === "complete_with_maintenance") {
    return milestone.receiptIds?.length ? 100 : clampPercent(milestone.percentComplete ?? 99);
  }
  if (milestone.status === "skipped" || milestone.status === "archived") {
    return 0;
  }
  return clampPercent(milestone.percentComplete ?? 0);
}

function phasePercent(
  phase: NonNullable<PccProject["phases"]>[number],
  milestones: PccMilestone[],
): number {
  if (typeof phase.percentComplete === "number") {
    return clampPercent(phase.percentComplete);
  }
  const phaseMilestones = milestones.filter((milestone) => milestone.phaseId === phase.id);
  if (phaseMilestones.length === 0) {
    return phase.status === "complete" || phase.status === "complete_with_maintenance" ? 100 : 0;
  }
  return clampPercent(
    phaseMilestones.reduce((total, milestone) => total + milestoneDisplayPercent(milestone), 0) /
      phaseMilestones.length,
  );
}

function renderPhaseOverview(detail: PccProjectDetail) {
  const phases = detail.project.phases?.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)) ?? [];
  if (phases.length === 0) {
    return html`<section class="pcc-phases" aria-label="Project phases">
      <div class="pcc-section-heading">
        <h4>Phases</h4>
        <span>No template</span>
      </div>
      <div class="pcc-empty pcc-empty--small">No phase template recorded</div>
    </section>`;
  }
  return html`<section class="pcc-phases" aria-label="Project phases" data-pcc-phases>
    <div class="pcc-section-heading">
      <h4>Phases</h4>
      <span>${phases.length} steps</span>
    </div>
    <div class="pcc-phase-grid">
      ${phases.map((phase) => {
        const percent = phasePercent(phase, detail.milestones);
        const milestoneCount = detail.milestones.filter(
          (milestone) => milestone.phaseId === phase.id,
        ).length;
        return html`<article class="pcc-phase" data-pcc-phase>
          <div>
            <strong>${phase.title}</strong>
            <span
              >${phase.weight ?? 0}% weight · ${milestoneCount}
              milestone${milestoneCount === 1 ? "" : "s"}</span
            >
          </div>
          <div class="pcc-progress" aria-label=${`${phase.title} ${percent}% complete`}>
            <span class="pcc-progress__bar" style=${`width:${percent}%`}></span>
          </div>
          <span>${percent}%</span>
        </article>`;
      })}
    </div>
  </section>`;
}

function renderProjectOrientation(detail: PccProjectDetail) {
  const project = detail.project;
  const current = currentMilestoneForDetail(detail);
  const next = nextMilestoneForDetail(detail);
  return html`<nav
    class="pcc-project-orientation"
    data-pcc-project-orientation
    aria-label="Project orientation"
  >
    <div class="pcc-project-orientation__crumbs" data-pcc-breadcrumbs>
      <span>Project Command Center</span>
      <span aria-hidden="true">›</span>
      <strong>${project.title}</strong>
      ${current ? html`<span aria-hidden="true">›</span><span>${current.title}</span>` : nothing}
    </div>
    <dl class="pcc-project-orientation__facts">
      ${renderTruthFact("Health", detail.summary.health ?? formatStatus(project.status))}
      ${renderTruthFact(
        "Priority",
        typeof project.priority === "number" ? String(project.priority) : "—",
      )}
      ${renderTruthFact("Due", formatProjectDate(detail.summary.dueDate))}
      ${renderTruthFact("Recent", formatProjectActivity(detail.summary.recentActivity))}
      ${renderTruthFact("Current", current?.title ?? "Not started")}
      ${renderTruthFact("Next", next?.title ?? detail.summary.nextActions[0] ?? "None")}
    </dl>
  </nav>`;
}

type PccProjectActivityItem = {
  kind: string;
  title: string;
  summary: string;
  at: number;
};

function activityTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pushProjectActivity(
  items: PccProjectActivityItem[],
  kind: string,
  title: string,
  summary: string,
  value: string | undefined,
): void {
  const at = activityTime(value);
  if (at === null) {
    return;
  }
  items.push({ kind, title, summary, at });
}

function projectActivityTimeline(detail: PccProjectDetail): PccProjectActivityItem[] {
  const items: PccProjectActivityItem[] = [];
  pushProjectActivity(
    items,
    "Project",
    detail.project.title,
    `Project status is ${formatStatus(detail.project.status)}.`,
    detail.project.updatedAt,
  );
  for (const milestone of detail.milestones) {
    pushProjectActivity(
      items,
      "Milestone",
      milestone.title,
      `${formatStatus(milestone.status)} · ${clampPercent(milestone.percentComplete ?? 0)}% complete`,
      milestone.updatedAt,
    );
  }
  for (const subMilestone of detail.subMilestones ?? []) {
    pushProjectActivity(
      items,
      "Sub-step",
      subMilestone.title,
      `${formatStatus(subMilestone.status)} · ${clampPercent(subMilestone.percentComplete ?? 0)}% complete`,
      subMilestone.updatedAt,
    );
  }
  for (const evidence of detail.evidence ?? []) {
    pushProjectActivity(
      items,
      "Evidence",
      evidence.summary ?? evidence.kind,
      `${formatStatus(evidence.kind)} · ${formatStatus(evidence.status)}`,
      evidence.createdAt,
    );
  }
  for (const receipt of detail.receipts ?? []) {
    pushProjectActivity(
      items,
      "Receipt",
      receipt.summary,
      `${formatStatus(receipt.proofLevel)} proof by ${receipt.completedBy ?? "unknown"}`,
      receipt.completedAt,
    );
  }
  for (const decision of detail.decisions ?? []) {
    pushProjectActivity(items, "Decision", decision.title, decision.summary, decision.decidedAt);
  }
  return items.toSorted((a, b) => b.at - a.at || a.title.localeCompare(b.title)).slice(0, 6);
}

function renderProjectActivityTimeline(detail: PccProjectDetail) {
  const items = projectActivityTimeline(detail);
  return html`<details class="pcc-project-activity" data-pcc-project-activity>
    <summary>
      <div>
        <span>Project activity</span>
        <p>Recent changes, receipts, decisions, and proof.</p>
      </div>
      <strong>${items.length ? `${items.length} latest` : "No activity"}</strong>
    </summary>
    ${items.length
      ? html`<ol class="pcc-project-activity__list">
          ${items.map(
            (item) => html`<li>
              <span class="pcc-status">${item.kind}</span>
              <div>
                <strong>${item.title}</strong>
                <p>${item.summary}</p>
              </div>
              <time datetime=${new Date(item.at).toISOString()}>${formatUpdatedAt(item.at)}</time>
            </li>`,
          )}
        </ol>`
      : html`<p class="pcc-empty pcc-empty--small">No project activity recorded yet.</p>`}
  </details>`;
}

function renderBlockerClarityCenter(
  detail: PccProjectDetail,
  props: PccDashboardProps,
  setupEvaluation = setupEvaluationForDetail(detail),
) {
  const resolved = resolvePccProjectAction(detail);
  if (PROJECT_TERMINAL_STATUSES.has(detail.project.status)) {
    return html`<section
      class="pcc-blocker-center pcc-blocker-center--ready"
      data-pcc-blocker-center
      data-pcc-complete-state
    >
      <div>
        <p class="pcc-kicker">Project complete</p>
        <h4>
          ${detail.project.status === "complete_with_maintenance"
            ? "Complete with maintenance"
            : "Complete"}
        </h4>
        <p>${resolved.explanation}</p>
      </div>
      <span class="pcc-status pcc-status--complete">${resolved.statusLabel}</span>
    </section>`;
  }
  const blockers = resolved.blockerLines;
  if (blockers.length === 0 && setupEvaluation.runnable && !projectIsOnHold(detail.project)) {
    return html`<section
      class="pcc-blocker-center pcc-blocker-center--ready"
      data-pcc-blocker-center
    >
      <div>
        <p class="pcc-kicker">Next Step</p>
        <h4>Ready to work</h4>
        <p>${resolved.explanation}</p>
      </div>
      <span class="pcc-status pcc-status--active">${resolved.statusLabel}</span>
    </section>`;
  }
  const visible = blockers.slice(0, 3);
  return html`<section class="pcc-blocker-center" data-pcc-blocker-center>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">What Needs You</p>
        <h4>
          ${visible.length === 1 ? "1 thing blocks progress" : `${visible.length} things to check`}
        </h4>
        <p>Fix these in order. PCC will not start unsafe work automatically.</p>
      </div>
      <span class="pcc-status pcc-status--blocked">${resolved.statusLabel}</span>
    </div>
    <ol class="pcc-blocker-center__list" data-pcc-work-start-blockers>
      ${visible.map((line, index) => {
        const fixLabel = blockerFixLabelForLine(line, initialPlannerLabel(props.projectForm));
        const canResume = fixLabel === "Resume Project" && props.onResumeProject;
        const canFixSetup =
          fixLabel === `Plan Setup with ${initialPlannerLabel(props.projectForm)}` &&
          props.onPreviewSetupAutofill;
        const canReviewPermission =
          fixLabel === "Review Permission" && pendingPermissionForDetail(detail);
        const issueChatDescriptor: IssueChatDescriptor = {
          source: "pcc",
          sourceId: `${detail.project.id}:${index}`,
          title: `${blockerKindForLine(line)} · ${detail.project.title}`,
          detail: line,
          impact: blockerImpactForLine(line),
          owner: blockerOwnerForLine(line),
          recommendedAction: fixLabel,
          projectId: detail.project.id,
        };
        return html`<li>
          <span>${index + 1}</span>
          <div>
            <strong>${blockerKindForLine(line)}</strong>
            <p>${line}</p>
            <small>
              Why it matters: ${blockerImpactForLine(line)} · Owner: ${blockerOwnerForLine(line)}
            </small>
          </div>
          ${canResume
            ? html`<button
                class="btn"
                type="button"
                data-pcc-resume-project
                ?disabled=${props.actionBusy}
                @click=${() => props.onResumeProject?.()}
              >
                Resume Project
              </button>`
            : canFixSetup
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-blocker-fix-setup
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onPreviewSetupAutofill?.()}
                >
                  ${fixLabel}
                </button>`
              : canReviewPermission
                ? html`<button
                    class="btn pcc-action-primary"
                    type="button"
                    data-pcc-blocker-review-permission
                    ?disabled=${props.actionBusy}
                    @click=${(event: Event) =>
                      openPccPermissionReview(detail, event.currentTarget as HTMLElement)}
                  >
                    Review Permission
                  </button>`
                : html`<span class="pcc-blocker-center__fix">${fixLabel}</span>`}
          ${props.onStartIssueChat
            ? html`<button
                class="btn btn--subtle"
                type="button"
                data-pcc-blocker-issue-chat
                @click=${() => props.onStartIssueChat?.(issueChatDescriptor)}
              >
                ${t("operationsRoom.resolution.fixThis")}
              </button>`
            : nothing}
        </li>`;
      })}
    </ol>
    ${blockers.length > visible.length
      ? html`<details class="pcc-blocker-center__more">
          <summary>Show ${blockers.length - visible.length} more</summary>
          <ul>
            ${blockers.slice(visible.length).map((line) => html`<li>${line}</li>`)}
          </ul>
        </details>`
      : nothing}
  </section>`;
}

function renderExecutionReadinessCard(detail: PccProjectDetail) {
  const readiness = buildPccExecutionReadiness(detail);
  const visibleMissing = readiness.missing.slice(0, 3);
  return html`<section
    class="pcc-execution-readiness"
    data-pcc-execution-readiness
    data-pcc-readiness-score=${readiness.score}
  >
    <div>
      <p class="pcc-kicker">Readiness</p>
      <h4>${readiness.score}% · ${readiness.label}</h4>
      <p>
        PCC checks setup, blockers, permissions, milestone inputs, and proof before it starts work.
      </p>
    </div>
    <ul class="pcc-execution-readiness__checks">
      ${readiness.checks.map(
        (check) => html`<li class=${check.passed ? "is-pass" : "is-blocked"}>
          <span aria-hidden="true">${check.passed ? "✓" : "!"}</span>
          ${check.label}
        </li>`,
      )}
    </ul>
    ${visibleMissing.length
      ? html`<ol class="pcc-execution-readiness__missing">
          ${visibleMissing.map((item) => html`<li>${item}</li>`)}
        </ol>`
      : html`<p class="pcc-empty pcc-empty--small">No readiness gaps found.</p>`}
  </section>`;
}

function renderUniversalPreflightCard(detail: PccProjectDetail) {
  const preflight = buildPccUniversalPreflight(detail);
  return html`<section
    class="pcc-universal-preflight pcc-universal-preflight--${preflight.status}"
    data-pcc-universal-preflight
    data-pcc-preflight-status=${preflight.status}
  >
    <div>
      <p class="pcc-kicker">Preflight</p>
      <h4>${preflight.status === "pass" ? "Safe to prepare work" : "Blocked before work"}</h4>
      <p>${preflight.summary} ${permissionSummary(detail.permissions)}</p>
    </div>
    ${preflight.blockers.length
      ? html`<ul>
          ${preflight.blockers.slice(0, 4).map((blocker) => html`<li>${blocker}</li>`)}
        </ul>`
      : html`<span class="pcc-status pcc-status--complete">Passed</span>`}
  </section>`;
}

function renderProjectScopeLock(detail: PccProjectDetail, props: PccDashboardProps) {
  const productMode = effectivePccFocusMode(props) === "pcc_product";
  const scope = pccWorkScopeForProject(detail.project);
  return html`<section
    class="pcc-scope-lock"
    data-pcc-scope-lock
    data-pcc-scope-mode=${productMode ? "pcc_product" : "project_work"}
  >
    <div>
      <p class="pcc-kicker">Focus lock</p>
      <h4>${productMode ? "PCC Product" : "Project Work"}</h4>
      <p>
        ${productMode
          ? "Project-specific blockers stay out of PCC product focus unless you switch modes."
          : "Project-specific work is visible. PCC product completion stays separate."}
      </p>
    </div>
    <span class="pcc-status" data-pcc-scope-lock-project-scope>${pccWorkScopeLabel(scope)}</span>
  </section>`;
}

function renderInteractionContractMatrix() {
  const coverage = pccInteractionContractCoverage();
  return html`<section class="pcc-interaction-contracts" data-pcc-interaction-contract-matrix>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Interaction contract</p>
        <h4>Buttons and controls PCC must keep working</h4>
        <p>
          ${coverage.total} controls tracked · ${coverage.mutating} mutate state ·
          ${coverage.preflighted} require preflight · ${coverage.reversible} offer undo.
        </p>
      </div>
    </div>
    <div class="pcc-table-lite" role="table" aria-label="PCC interaction contract matrix">
      ${PCC_INTERACTION_CONTRACTS.map(
        (contract) => html`<div role="row" data-pcc-interaction-contract=${contract.id}>
          <span role="cell">${contract.label}</span>
          <code role="cell">${contract.selector}</code>
          <span role="cell">${formatStatus(contract.surface)}</span>
          <span role="cell">${contract.mutates ? "Saves state" : "Read only"}</span>
          <span role="cell">${contract.requiresPreflight ? "Preflight" : "No preflight"}</span>
        </div>`,
      )}
    </div>
  </section>`;
}

function renderPccRecoveryCenter(props: PccDashboardProps) {
  if (!props.actionError) {
    return nothing;
  }
  const likelyStale = /stale|refresh|latest|schema|invalid|unexpected|order/iu.test(
    props.actionError,
  );
  return html`<section class="pcc-recovery-center" data-pcc-recovery-center>
    <div>
      <p class="pcc-kicker">Recovery Center</p>
      <h4>${likelyStale ? "Reload clean state, then retry" : "Use the safest recovery path"}</h4>
      <p>
        PCC did not save the failed action. Refresh first, then retry from the visible primary
        action or Reorder mode.
      </p>
    </div>
    <ol>
      <li>Refresh PCC to load the latest ledger state.</li>
      <li>Use the visible primary action, not a hidden stale control.</li>
      <li>If the same error returns, keep the exact message and stop before retrying.</li>
    </ol>
    <button class="btn" type="button" ?disabled=${props.loading} @click=${props.onRefresh}>
      Refresh safely
    </button>
  </section>`;
}

function formatAttachmentSize(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function compactTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function renderProjectAiUsage(detail: PccProjectDetail) {
  const usage = detail.aiUsage;
  if (!usage || usage.attemptedRuns === 0) {
    return html`<section class="pcc-ai-usage" data-pcc-ai-usage>
      <div>
        <span>AI use</span>
        <strong>No recorded AI runs yet</strong>
      </div>
      <small>New model runs appear here without changing project completion.</small>
    </section>`;
  }
  const share = usage.codexSharePercent ?? 0;
  const coverageNote =
    usage.tokenCoverage === "complete"
      ? "Provider-reported tokens"
      : usage.tokenCoverage === "partial"
        ? `${usage.missingUsageRuns} run${usage.missingUsageRuns === 1 ? "" : "s"} did not report tokens`
        : "Token totals were not reported";
  return html`<section class="pcc-ai-usage" data-pcc-ai-usage>
    <div>
      <span>AI use</span>
      <strong
        >Codex: ${usage.codexRuns} of ${usage.attemptedRuns} recorded AI runs (${share}%)</strong
      >
    </div>
    <small>
      ${usage.succeededRuns} succeeded · ${usage.failedRuns} failed · ${usage.cancelledRuns}
      cancelled
    </small>
    <div class="pcc-ai-usage__tokens">
      <strong>${compactTokenCount(usage.reportedTokens.codex)}</strong>
      <span>reported Codex tokens</span>
    </div>
    <details>
      <summary>Usage details</summary>
      <p>
        ${usage.localRuns} local AI run${usage.localRuns === 1 ? "" : "s"} ·
        ${compactTokenCount(usage.reportedTokens.total)} total reported tokens ·
        ${coverageNote}${usage.recordingStartedAt
          ? ` · Recording started ${formatVerifiedAt(usage.recordingStartedAt)}`
          : ""}
      </p>
      ${usage.byPurpose.length
        ? html`<ul>
            ${usage.byPurpose.map(
              (item) => html`<li>
                <span>${formatStatus(item.purpose)}</span>
                <strong>${item.runs} run${item.runs === 1 ? "" : "s"}</strong>
              </li>`,
            )}
          </ul>`
        : nothing}
    </details>
  </section>`;
}

function renderPrivateTeamPolicy(props: PccDashboardProps) {
  const policy = props.privateTeamPolicy;
  if (!policy) {
    return nothing;
  }
  return html`<section class="pcc-private-team-policy" data-pcc-private-team-policy>
    <div>
      <span>Private team guardrails</span>
      <strong>Designed for up to ${policy.memberLimit} authenticated operators</strong>
      <p>
        Shared PCC access stays behind Gateway authentication. This MVP does not provide separate
        per-person project permissions.
      </p>
    </div>
    <dl>
      <div>
        <dt>Planning</dt>
        <dd>${policy.maxConcurrentPlanningRuns} planning runs at once</dd>
      </div>
      <div>
        <dt>Projects</dt>
        <dd>${policy.maxProjects} active projects</dd>
      </div>
      <div>
        <dt>Files</dt>
        <dd>${policy.maxAttachmentsPerProject} files or 1 GiB per project</dd>
      </div>
    </dl>
  </section>`;
}

function renderProjectSnapshot(detail: PccProjectDetail, props: PccDashboardProps) {
  const project = detail.project;
  const percent = clampPercent(detail.summary.percentComplete);
  const current = currentMilestoneForDetail(detail);
  const next = nextMilestoneForDetail(detail);
  const autopilot = getPccAutopilotState({
    project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    evidence: detail.evidence,
    decisions: detail.decisions ?? [],
  });
  const setupEvaluation = setupEvaluationForDetail(detail);
  const settings = getPccWorkLoopSettings(project);
  const activeExecutionPlan = executionPlansFromProject(project).findLast((plan) =>
    isPccExecutionPlanActive(plan.status),
  );
  const worker = current ? itemWorkerLabel(current) : "None";
  const resolvedAction = resolvePccProjectAction(detail);
  const primaryAction = projectActionLabel(resolvedAction, props.projectForm);
  const needsSetupRepair = !setupEvaluation.runnable;
  const terminal = PROJECT_TERMINAL_STATUSES.has(project.status);
  const hasIncompleteMilestones = detail.milestones.some(
    (milestone) => !PROJECT_TERMINAL_STATUSES.has(milestone.status),
  );
  const completionConflict =
    (project.status === "complete" || project.status === "complete_with_maintenance") &&
    hasIncompleteMilestones;
  const terminalWithoutConflict = terminal && !completionConflict;
  const proofBadge = projectHeroProofBadge(detail, props);
  const scope = pccWorkScopeForProject(project);
  const scopeLabel = pccWorkScopeLabel(scope);
  const scopeCopy =
    scope === "pcc_product"
      ? "This is PCC Product work. It affects PCC completion."
      : "This is Project Work. It does not block PCC product completion.";
  const primaryActionDisabled =
    props.actionBusy ||
    resolvedAction.primaryActionId === "no_action_required" ||
    (!terminal && !projectIsOnHold(project) && needsSetupRepair && !props.onPreviewSetupAutofill);
  const simple = pccViewMode(props) === "simple";
  const executionProfile = normalizePccExecutionProfile(project.metadata);
  const executionOption = localExecutionOption(executionProfile.speed);
  const codexOption = codexPolicyOption(executionProfile.codexPolicyId);
  const executionCounts = resolvePccEstimatedAgentCounts(
    executionProfile,
    props.executionCapacity?.safeLocalAgentSlots ?? 0,
  );
  return html`<section
    class="pcc-project-snapshot"
    data-pcc-project-snapshot
    data-pcc-project-hero
    data-pcc-mobile-section="current"
  >
    <div class="pcc-project-snapshot__header">
      <div>
        <p class="pcc-kicker">Project Snapshot</p>
        <h3>${project.title}</h3>
        <p data-pcc-selected-project-scope-copy>${scopeCopy}</p>
      </div>
      <div class="pcc-project-snapshot__badges">
        <span class="pcc-status" data-pcc-project-scope-badge>${scopeLabel}</span>
        <span class="pcc-proof-badge" data-pcc-proof-badge>${proofBadge}</span>
        <span class="pcc-status pcc-status--${project.status}"
          >${formatStatus(project.status)}</span
        >
      </div>
    </div>
    <section class="pcc-execution-profile-chip" data-pcc-project-execution-profile>
      <div>
        <span>How this project runs</span>
        <strong>${executionOption.title.replace(" · Recommended", "")}</strong>
        <small>
          ${executionCounts.localAgents} OpenClaw
          worker${executionCounts.localAgents === 1 ? "" : "s"} ·
          ${executionModelLabel(props, executionProfile.localModelId, "openclaw")} ·
          ${codexOption.title}${executionCounts.codexAgents ? " · approval-gated" : ""}
        </small>
        <small data-pcc-project-codex-provenance>
          ${executionProfile.codexPolicyId === "local_only"
            ? "Codex will not run for this project."
            : `Codex: ${executionModelLabel(props, executionProfile.codexModelId, "codex")} · ${formatStatus(executionProfile.codexEffort)} normally · ${formatStatus(executionProfile.codexMaxEffort)} automatic maximum`}
        </small>
      </div>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-change-execution-profile
        @click=${() => props.onOpenProjectEditor(project)}
      >
        Change
      </button>
    </section>
    ${terminalWithoutConflict
      ? html`<section class="pcc-maintenance-hero" data-pcc-maintenance-hero>
          <div>
            <span>Project complete</span>
            <strong>${formatStatus(project.status)}</strong>
            <p>
              <em class="pcc-maintenance-hero__status" data-pcc-terminal-primary-status
                >No action required</em
              >
              ·
              ${detail.summary.milestoneCounts.total === 0
                ? "No milestones"
                : `${detail.summary.milestoneCounts.complete}/${detail.summary.milestoneCounts.total} milestones complete`}
            </p>
          </div>
          <button
            class="btn btn--subtle"
            type="button"
            @click=${() => props.onSetViewMode?.("detailed")}
          >
            Review history
          </button>
        </section>`
      : nothing}
    ${projectIsOnHold(project)
      ? html`<div class="pcc-deferred-banner" data-pcc-deferred-project-banner>
          <strong>Project-specific work is on hold</strong>
          <span>This project is parked and is not counted as urgent PCC product work.</span>
        </div>`
      : nothing}
    ${simple && !terminalWithoutConflict
      ? html`<dl class="pcc-project-snapshot__simple-facts" data-pcc-simple-project-facts>
          <div>
            <dt>Status</dt>
            <dd>${resolvedAction.statusLabel}</dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>${percent}%</dd>
          </div>
          <div class="pcc-project-snapshot__simple-current">
            <dt>Current step</dt>
            <dd>${current?.title ?? "Not started"}</dd>
          </div>
        </dl>`
      : nothing}
    ${terminalWithoutConflict
      ? nothing
      : html`<div class="pcc-primary-action" data-pcc-primary-action>
          <span>Do this next</span>
          <button
            class="btn pcc-action-primary"
            type="button"
            data-pcc-primary-action-id=${resolvedAction.primaryActionId}
            ?disabled=${primaryActionDisabled}
            @click=${(event: Event) =>
              runResolvedProjectPrimaryAction(
                resolvedAction,
                detail,
                props,
                event.currentTarget as HTMLElement,
              )}
          >
            ${primaryAction}
          </button>
          <em>${resolvedAction.explanation}</em>
        </div>`}
    ${terminalWithoutConflict
      ? nothing
      : renderBlockerClarityCenter(detail, props, setupEvaluation)}
    ${terminalWithoutConflict || simple ? nothing : renderExecutionReadinessCard(detail)}
    ${terminalWithoutConflict || simple ? nothing : renderUniversalPreflightCard(detail)}
    ${terminalWithoutConflict || simple ? nothing : renderProjectScopeLock(detail, props)}
    ${terminalWithoutConflict && simple
      ? nothing
      : html`<div class="pcc-project-snapshot__progress">
          <strong>${percent}%</strong>
          <div class="pcc-progress" aria-label=${`${project.title} ${percent}% complete`}>
            <span class="pcc-progress__bar" style=${`width:${percent}%`}></span>
          </div>
          <span
            >${detail.summary.milestoneCounts.complete}/${detail.summary.milestoneCounts.total}
            milestones complete</span
          >
        </div>`}
    ${renderProjectAiUsage(detail)} ${renderPrivateTeamPolicy(props)}
    ${terminalWithoutConflict || simple
      ? nothing
      : html`
          <section class="pcc-autopilot-chip" data-pcc-autopilot-hero-chip>
            <div>
              <span>Autopilot</span>
              <strong>${autopilotStatusLabel(autopilot.status)}</strong>
              <em>${autopilot.modeTitle}</em>
            </div>
            <button
              class="btn btn--subtle"
              type="button"
              @click=${(event: Event) => openPccAutopilot(event, props)}
            >
              Open Autopilot
            </button>
          </section>
          <dl class="pcc-project-snapshot__facts">
            ${renderTruthFact("Status", formatStatus(project.status))}
            ${renderTruthFact("Health", detail.summary.health ?? formatStatus(project.status))}
            ${renderTruthFact(
              "Priority",
              typeof project.priority === "number" ? String(project.priority) : "—",
            )}
            ${renderTruthFact("Current milestone", current?.title ?? "Not started")}
            ${renderTruthFact("Next milestone", next?.title ?? "None")}
            ${renderTruthFact("Worker", worker)}
            ${renderTruthFact(
              "Work",
              activeExecutionPlan
                ? activeExecutionPlan.status === "paused"
                  ? "Paused"
                  : activeExecutionPlan.status === "blocked"
                    ? "Blocked"
                    : "Working"
                : settings.enabled
                  ? "Ready"
                  : "Off",
            )}
          </dl>
          <section class="pcc-project-brief" data-pcc-project-brief>
            <span>Project brief</span>
            <p>${project.goal || "No project goal recorded yet."}</p>
          </section>
          ${(() => {
            const metrics = projectOutcomeMetrics(project);
            return metrics.length
              ? html`<section class="pcc-outcome-metrics" data-pcc-outcome-metrics>
                  <span>Outcome metrics</span>
                  <ul>
                    ${metrics.map((metric) => html`<li>${metric}</li>`)}
                  </ul>
                </section>`
              : html`<section
                  class="pcc-outcome-metrics pcc-outcome-metrics--empty"
                  data-pcc-outcome-metrics
                >
                  <span>Outcome metrics</span>
                  <p>No outcome metrics recorded yet.</p>
                </section>`;
          })()}
        `}
    ${props.editorMode ? nothing : renderPccProjectFiles(detail, props)}
    ${terminal || simple ? nothing : renderSetupRepairCard(setupEvaluation, props)}
    ${terminal || simple
      ? nothing
      : html`<div class="pcc-detail__actions">
          <button
            class="btn btn--subtle"
            type="button"
            data-pcc-edit-project
            @click=${() => props.onOpenProjectEditor(project)}
          >
            Edit project
          </button>
          <button
            class="btn btn--subtle"
            type="button"
            @click=${() => props.onOpenMilestoneEditor()}
          >
            New milestone
          </button>
          <button
            class="btn btn--subtle"
            type="button"
            data-pcc-snapshot-add-decision
            ?disabled=${props.actionBusy}
            @click=${(event: Event) => openPccDecisionCapture(event, props)}
          >
            Add decision
          </button>
          ${project.status === "archived"
            ? html`<button
                class="btn btn--subtle"
                type="button"
                @click=${() => props.onSetProjectStatus(project, "reopened")}
              >
                Reopen
              </button>`
            : html`<button
                class="btn btn--subtle"
                type="button"
                @click=${(event: Event) =>
                  runPccConfirmedButtonAction(event, "Confirm archive", () =>
                    props.onSetProjectStatus(project, "archived"),
                  )}
              >
                Archive
              </button>`}
        </div>`}
  </section>`;
}

function milestoneJourneyClass(milestone: PccMilestone, currentId?: string): string {
  if (milestone.id === currentId) {
    return "current";
  }
  if (["complete", "complete_with_maintenance"].includes(milestone.status)) {
    return "complete";
  }
  if (["blocked", "failed", "needs_approval", "deferred", "on_hold"].includes(milestone.status)) {
    return "blocked";
  }
  if (["skipped", "archived"].includes(milestone.status)) {
    return "skipped";
  }
  return "future";
}

function renderMilestoneJourney(detail: PccProjectDetail, props: PccDashboardProps) {
  const current = currentMilestoneForDetail(detail);
  const milestones = sortedMilestones(detail);
  const mode = pccViewMode(props);
  const reorderMode = Boolean(props.reorderMode);
  const terminalProject = projectIsTerminalForWork(detail.project);
  const collapseCompletedHistory = mode === "simple" && milestones.length > 8;
  const canReorder = !terminalProject;
  const reorderDisabledReason = terminalProject
    ? "Completed projects are read-only. Create an improvement or reopen the project before reordering."
    : "";
  const phaseGroups: Array<{ title: string; milestones: PccMilestone[] }> = [];
  for (const milestone of milestones) {
    const title = phaseTitleForMilestone(detail, milestone);
    const existing = phaseGroups.find((group) => group.title === title);
    if (existing) {
      existing.milestones.push(milestone);
    } else {
      phaseGroups.push({ title, milestones: [milestone] });
    }
  }
  return html`<section
    class="pcc-milestone-journey"
    data-pcc-milestone-journey
    data-pcc-mobile-section="milestones"
    data-pcc-reorder-mode=${reorderMode ? "on" : "off"}
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Milestone Journey</p>
        <h4>Project sequence</h4>
        <p>Follow the steps in order. Open a step only when you need its details.</p>
      </div>
      <div class="pcc-section-heading__actions">
        <span
          >${detail.summary.milestoneCounts.complete}/${detail.summary.milestoneCounts.total}
          complete</span
        >
        <button
          class=${`btn btn--subtle ${reorderMode ? "is-active" : ""}`}
          type="button"
          data-pcc-reorder-mode-toggle
          ?disabled=${!canReorder}
          aria-label=${reorderDisabledReason ||
          (reorderMode ? "Done reordering milestones" : "Reorder milestones")}
          @click=${() => canReorder && props.onSetReorderMode?.(!reorderMode)}
        >
          ${reorderMode ? "Done reordering" : "Reorder milestones"}
        </button>
        ${reorderDisabledReason
          ? html`<span class="pcc-reorder-disabled-note" data-pcc-reorder-disabled-reason
              >${reorderDisabledReason}</span
            >`
          : nothing}
      </div>
    </div>
    ${reorderMode && canReorder
      ? html`<section class="pcc-reorder-instruction" data-pcc-reorder-instruction>
          <div>
            <strong>Reorder mode is on</strong>
            <span class="pcc-reorder-safety-badge">Dependency checks on</span>
          </div>
          <p>
            Drag the handle, or choose Up or Down. PCC blocks any move that would break a
            dependency, saves successful moves automatically, and always offers Undo.
          </p>
          <small
            >Action menus are paused while you reorder. Choose Done reordering when the sequence
            looks right.</small
          >
        </section>`
      : nothing}
    <div class="pcc-journey-phases" data-pcc-journey-phases>
      ${phaseGroups.map((group) => {
        const complete = group.milestones.filter((item) =>
          ["complete", "complete_with_maintenance"].includes(item.status),
        ).length;
        const visibleMilestones = collapseCompletedHistory
          ? group.milestones.slice(0, 3)
          : group.milestones;
        const hiddenCount = group.milestones.length - visibleMilestones.length;
        return html`<section class="pcc-journey-phase" data-pcc-journey-phase>
          <header>
            <strong>${group.title}</strong>
            <span>${complete}/${group.milestones.length} complete</span>
          </header>
          <ol>
            ${visibleMilestones.map((milestone) => {
              const globalIndex = milestones.findIndex((item) => item.id === milestone.id) + 1;
              const journeyClass = milestoneJourneyClass(milestone, current?.id);
              const subMilestones = subMilestonesForMilestone(detail, milestone);
              const nextSub = nextSubMilestoneForMilestone(detail, milestone);
              const blocker = milestone.blocker || nextSub?.blocker;
              const milestoneMetadata = metadataObject(milestone.metadata);
              const milestoneRisk = metadataString(milestoneMetadata.pccCostRisk, "low");
              const milestoneWorker = responsibilityLabel(
                pccResponsibilityForItem(milestone) || "local_openclaw_agent",
              );
              const showActionMenu =
                !reorderMode &&
                (!terminalProject ||
                  mode !== "simple" ||
                  !["complete", "complete_with_maintenance"].includes(milestone.status));
              return html`<li
                class="pcc-journey-step pcc-journey-step--${journeyClass}"
                data-pcc-journey-step
                data-pcc-milestone-id=${milestone.id}
                @dragenter=${(event: DragEvent) => {
                  event.preventDefault();
                  if (reorderMode && canReorder) {
                    setPccDropTarget(event, true);
                  }
                }}
                @dragover=${(event: DragEvent) => {
                  event.preventDefault();
                  if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                @dragleave=${(event: DragEvent) => setPccDropTarget(event, false)}
                @drop=${(event: DragEvent) => {
                  event.preventDefault();
                  setPccDropTarget(event, false);
                  if (!reorderMode || !canReorder) {
                    draggedPccMilestoneId = null;
                    return;
                  }
                  const sourceId = getPccDraggedId(event, "milestone", draggedPccMilestoneId);
                  const source = milestones.find((item) => item.id === sourceId);
                  draggedPccMilestoneId = null;
                  if (source && source.id !== milestone.id) {
                    props.onMoveMilestoneBefore?.(source, milestone);
                  }
                }}
                @dragend=${() => {
                  draggedPccMilestoneId = null;
                  document
                    .querySelectorAll(".pcc-journey-step.is-drop-target")
                    .forEach((item) => item.classList.remove("is-drop-target"));
                }}
              >
                <div
                  class="pcc-journey-step__marker"
                  aria-label=${`Step ${globalIndex} of ${milestones.length}`}
                >
                  ${globalIndex}
                </div>
                <div class="pcc-journey-step__content">
                  ${reorderMode && canReorder
                    ? html`<div class="pcc-journey-step__toolbar" data-pcc-reorder-toolbar>
                        <button
                          class="pcc-drag-handle"
                          type="button"
                          data-pcc-drag-handle="milestone"
                          draggable="true"
                          aria-label=${`Drag to reorder milestone ${milestone.title}`}
                          @dragstart=${(event: DragEvent) => {
                            setPccDragData(event, "milestone", milestone.id);
                            draggedPccMilestoneId = milestone.id;
                          }}
                          @dragend=${() => {
                            draggedPccMilestoneId = null;
                          }}
                        >
                          ☰
                        </button>
                        ${renderMilestoneReorderControls(milestones, milestone, props)}
                        <span>Step ${globalIndex} · safe move controls</span>
                      </div>`
                    : nothing}
                  <details ?open=${mode !== "simple" && journeyClass === "current"}>
                    <summary>
                      <span class="pcc-journey-step__summary-main">
                        <em>Step ${globalIndex} of ${milestones.length}</em>
                        <strong>${milestone.title}</strong>
                        <small
                          >${subMilestones.length} sub-step${subMilestones.length === 1 ? "" : "s"}
                          · ${milestoneDisplayPercent(milestone)}%</small
                        >
                      </span>
                      <span class="pcc-journey-step__summary-side">
                        <span class="pcc-status pcc-status--${milestone.status}"
                          >${formatStatus(milestone.status)}</span
                        >
                        ${blocker
                          ? html`<span class="pcc-journey-step__blocker">Blocked</span>`
                          : nothing}
                        <span
                          >${journeyClass === "current"
                            ? "Current"
                            : formatStatus(journeyClass)}</span
                        >
                      </span>
                    </summary>
                    <div class="pcc-journey-step__body">
                      <div class="pcc-journey-step__skim">
                        <span>Next: ${nextSub?.title ?? "No next sub-step"}</span>
                        <span class="pcc-route-chip" data-pcc-route-chip="worker"
                          ><b>Worker</b> ${milestoneWorker}</span
                        >
                        <span class="pcc-route-chip" data-pcc-route-chip="risk"
                          ><b>Risk</b> ${formatStatus(milestoneRisk)}</span
                        >
                        ${blocker ? html`<strong>Blocked: ${blocker}</strong>` : nothing}
                      </div>
                      ${mode === "simple"
                        ? renderSubMilestoneList(milestone, props, { compact: true })
                        : html`
                            <p>
                              ${milestone.blocker ||
                              milestone.implementationPlan ||
                              "No implementation plan recorded."}
                            </p>
                            ${renderSubMilestoneList(milestone, props, {
                              compact: mode !== "agent",
                              showDrilldown: true,
                            })}
                            <details class="pcc-detail-drawer" ?open=${mode === "agent"}>
                              <summary>Proof, receipts, permissions, and actions</summary>
                              ${mode === "agent"
                                ? renderMilestoneReceipts(milestone, props)
                                : nothing}
                              ${permissionsForMilestone(props.projectDetail, milestone).length > 0
                                ? renderPermissionList(
                                    permissionsForMilestone(props.projectDetail, milestone),
                                    props,
                                  )
                                : nothing}
                              <div class="pcc-milestone__actions">
                                <label class="pcc-stop-here" data-pcc-stop-here>
                                  <input
                                    type="checkbox"
                                    .checked=${milestoneStopsHere(milestone)}
                                    ?disabled=${props.actionBusy}
                                    @change=${(event: Event) =>
                                      props.onSetMilestoneStopHere(
                                        milestone,
                                        (event.target as HTMLInputElement).checked,
                                      )}
                                  />
                                  Stop here
                                </label>
                                <button
                                  class="btn btn--subtle"
                                  type="button"
                                  @click=${() => props.onOpenMilestoneEditor(milestone)}
                                >
                                  Edit
                                </button>
                              </div>
                            </details>
                          `}
                    </div>
                  </details>
                  ${showActionMenu ? renderMilestoneActionMenu(milestone, props) : nothing}
                </div>
              </li>`;
            })}
          </ol>
          ${hiddenCount > 0
            ? html`<p class="pcc-completed-history-note" data-pcc-completed-history-collapsed>
                ${hiddenCount} completed step${hiddenCount === 1 ? "" : "s"} hidden in Simple view.
                Switch to Detailed to review the full history.
              </p>`
            : nothing}
        </section>`;
      })}
    </div>
  </section>`;
}

function renderProjectDetail(props: PccDashboardProps) {
  const detail = props.projectDetail;
  const modernWorkspace = props.surface === "project";
  const mode = modernWorkspace ? "detailed" : pccViewMode(props);
  if (!detail) {
    return html`
      <aside class="pcc-detail" data-pcc-detail-empty>
        <h3>Select a project</h3>
        <p>Open a project to see its snapshot, milestone journey, and work controls.</p>
      </aside>
    `;
  }
  try {
    const permissions = detail.permissions ?? [];
    const activeDetailTab = props.decisionFormOpen ? "decisions" : "plan";
    return html`
      <aside
        class="pcc-detail pcc-detail--${mode}"
        data-pcc-detail
        data-pcc-detail-mode=${mode}
        data-pcc-detail-project-id=${detail.project.id}
        data-pcc-detail-project-title=${detail.project.title}
      >
        ${renderPccPermissionReviewDialog(detail, props)}
        ${mode === "simple" ? nothing : renderProjectOrientation(detail)}
        ${renderProjectSnapshot(detail, props)} ${renderMilestoneJourney(detail, props)}
        ${renderWorkLoopCard(props)}
        <details
          class="pcc-detail-drawer"
          data-pcc-mobile-section="more"
          ?open=${props.decisionFormOpen || (!modernWorkspace && mode !== "simple")}
        >
          <summary>Details</summary>
          ${mode === "simple"
            ? html`<p class="pcc-empty pcc-empty--small">
                Details, proof, decisions, automation, and diagnostics are loaded in Detailed view
                to keep PCC fast and easy to skim.
              </p>`
            : html`
                <div
                  class="pcc-detail-tabs"
                  data-pcc-detail-tabs
                  role="tablist"
                  aria-label="Project details"
                >
                  ${[
                    ["plan", "Plan"],
                    ["activity", "Activity"],
                    ["proof", "Proof"],
                    ["decisions", "Decisions"],
                    ["automation", "Automation"],
                    ["diagnostics", "Diagnostics"],
                  ].map(
                    ([id, label]) => html`<button
                      type="button"
                      role="tab"
                      data-pcc-detail-tab=${id}
                      aria-selected=${id === activeDetailTab ? "true" : "false"}
                      tabindex=${id === activeDetailTab ? "0" : "-1"}
                      @click=${(event: Event) =>
                        activatePccDetailTab(
                          id,
                          (event.currentTarget as HTMLElement).closest(".pcc-detail-drawer") ??
                            undefined,
                        )}
                      @keydown=${(event: KeyboardEvent) => handlePccDetailTabKeydown(event, id)}
                    >
                      ${label}
                    </button>`,
                  )}
                </div>
                <section
                  data-pcc-detail-tab-panel="plan"
                  role="tabpanel"
                  ?hidden=${activeDetailTab !== "plan"}
                >
                  ${renderNextSafeActionCard(props)} ${renderCurrentTruthAndReadyQueue(props)}
                  ${renderPhaseOverview(detail)} ${renderWorkflowQualityCard(detail)}
                </section>
                <section data-pcc-detail-tab-panel="activity" role="tabpanel" hidden>
                  ${renderProjectActivityTimeline(detail)}
                </section>
                <section data-pcc-detail-tab-panel="proof" role="tabpanel" hidden>
                  ${renderProjectReceiptsAndArtifacts(detail, props)}
                </section>
                <section
                  data-pcc-detail-tab-panel="decisions"
                  role="tabpanel"
                  ?hidden=${activeDetailTab !== "decisions"}
                >
                  ${renderDecisionCapturePanel(detail, props)} ${renderDecisionList(detail, props)}
                </section>
                <section data-pcc-detail-tab-panel="automation" role="tabpanel" hidden>
                  ${renderAutopilotProjectLoop(detail, props)} ${renderContextPackageCard(detail)}
                </section>
                <section data-pcc-detail-tab-panel="diagnostics" role="tabpanel" hidden>
                  ${renderInteractionContractMatrix()} ${renderImpactDetailCards(detail, props)}
                </section>
              `}
        </details>
        ${mode === "simple"
          ? html`<p class="pcc-simple-hint">
              Simple view shows the workflow. Switch to Detailed or Agent for receipts, proof,
              permissions, handoff packets, and diagnostics.
            </p>`
          : html`
              ${mode === "agent"
                ? html`<details class="pcc-detail-drawer" open>
                    <summary>Full milestone cards</summary>
                    <section class="pcc-milestones" aria-label="Project milestones">
                      ${detail.milestones.length === 0
                        ? html`<div class="pcc-empty pcc-empty--small">No milestones yet</div>`
                        : detail.milestones.map((milestone) =>
                            renderMilestoneCard(milestone, props),
                          )}
                    </section>
                  </details>`
                : nothing}
              <details class="pcc-detail-drawer" ?open=${mode === "agent"}>
                <summary>Permissions</summary>
                <section class="pcc-permissions" aria-label="Project permissions">
                  <div class="pcc-section-heading">
                    <h4>Permissions</h4>
                    <span>${permissions.length} requested</span>
                  </div>
                  ${renderPermissionList(
                    permissions.filter((permission) => !permission.milestoneId),
                    props,
                  )}
                </section>
              </details>
              <details class="pcc-detail-drawer" ?open=${mode === "agent"}>
                <summary>Live execution</summary>
                ${renderExecutionRuntimeProjection(props)}
              </details>
              <details class="pcc-detail-drawer" ?open=${mode === "agent"}>
                <summary>Chat sync</summary>
                ${renderChatSyncCard(props)}
              </details>
              ${mode === "agent"
                ? html`<section class="pcc-agent-panel" data-pcc-agent-mode>
                    <p class="pcc-kicker">Agent view</p>
                    <h4>Low-reasoning execution details</h4>
                    <p>
                      Implementation plans, acceptance criteria, blockers, permissions, receipts,
                      and context packets are expanded for handoff.
                    </p>
                  </section>`
                : nothing}
            `}
      </aside>
    `;
  } catch (error) {
    return html`<aside
      class="pcc-detail pcc-detail--error"
      data-pcc-detail
      data-pcc-detail-render-error
      data-pcc-detail-project-id=${detail.project.id}
      data-pcc-detail-project-title=${detail.project.title}
      role="alert"
    >
      <section class="pcc-complete-card pcc-complete-card--warning">
        <span>Project needs repair</span>
        <strong>${detail.project.title}</strong>
        <p>
          PCC could not render this project detail because legacy project data is missing a
          canonical field. Run PCC ledger repair, then refresh.
        </p>
        <small>${error instanceof Error ? error.message : String(error)}</small>
      </section>
    </aside>`;
  }
}

function renderContextPackageCard(detail: PccProjectDetail) {
  const preview = buildPccContextPackage(detail, { mode: "compact" });
  return html`<section
    class="pcc-context-package"
    data-pcc-context-package
    aria-label="Context package"
  >
    <div class="pcc-section-heading">
      <div>
        <h4>Context package</h4>
        <p>Copy a clean handoff for OpenClaw, Codex, or a low-reasoning worker.</p>
      </div>
      <span>Project only</span>
    </div>
    <div class="pcc-context-package__actions">
      <button
        class="btn"
        type="button"
        data-pcc-copy-context="compact"
        aria-live="polite"
        @click=${(event: Event) =>
          void copyPccContextPackage(detail, "compact", event.currentTarget as HTMLButtonElement)}
      >
        Copy next step
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-copy-context="full"
        aria-live="polite"
        @click=${(event: Event) =>
          void copyPccContextPackage(detail, "full", event.currentTarget as HTMLButtonElement)}
      >
        Copy full packet
      </button>
    </div>
    <details class="pcc-context-package__preview">
      <summary>Preview next-step packet</summary>
      <pre>${preview}</pre>
    </details>
  </section>`;
}

function renderChatSyncProposal(proposal: PccChatSyncProposal, props: PccDashboardProps) {
  return html`<article class="pcc-chat-sync__proposal" data-pcc-chat-sync-proposal>
    <div>
      <strong>${proposal.title}</strong>
      <p>${proposal.summary}</p>
      <span
        >${proposal.kind.replace(/_/gu, " ")}${proposal.risky ? " · needs confirmation" : ""}</span
      >
    </div>
    <button
      class="btn btn--subtle"
      type="button"
      ?disabled=${props.actionBusy}
      @click=${(event: Event) => {
        if (proposal.risky) {
          runPccConfirmedButtonAction(event, "Confirm apply", () =>
            props.onApplyChatSyncProposal(proposal),
          );
          return;
        }
        props.onApplyChatSyncProposal(proposal);
      }}
    >
      Apply
    </button>
  </article>`;
}

function renderChatSyncCard(props: PccDashboardProps) {
  return html`<section class="pcc-chat-sync" data-pcc-chat-sync aria-label="Chat sync">
    <div class="pcc-section-heading">
      <div>
        <h4>Import a proposed plan</h4>
        <p>
          Paste an OpenClaw or Codex plan. PCC can draft milestone text, but never infers status,
          proof, or permissions from a transcript.
        </p>
      </div>
      <span>${props.chatSyncProposals.length} suggested</span>
    </div>
    <textarea
      class="pcc-chat-sync__input"
      aria-label="Proposed OpenClaw or Codex plan"
      placeholder="Paste a proposed plan"
      .value=${props.chatSyncText}
      @input=${(event: Event) =>
        props.onChatSyncTextChange((event.target as HTMLTextAreaElement).value)}
    ></textarea>
    <div class="pcc-context-package__actions">
      <button class="btn" type="button" @click=${props.onPreviewChatSync}>Review plan draft</button>
      <button class="btn btn--subtle" type="button" @click=${props.onDismissChatSync}>Clear</button>
    </div>
    ${props.chatSyncError
      ? html`<div class="pcc-error" role="alert">${props.chatSyncError}</div>`
      : nothing}
    ${props.chatSyncProposals.length
      ? html`<div class="pcc-chat-sync__proposals">
          ${props.chatSyncProposals.map((proposal) => renderChatSyncProposal(proposal, props))}
        </div>`
      : html`<div class="pcc-empty pcc-empty--small">No chat updates ready to apply</div>`}
  </section>`;
}

function renderExecutionRuntimeProjection(props: PccDashboardProps) {
  const projection = props.executionProjection;
  return html`<section
    class="pcc-runtime-projection"
    data-pcc-runtime-projection
    aria-label="Read-only live execution"
  >
    <div class="pcc-section-heading">
      <div>
        <h4>Read-only live execution</h4>
        <p>
          Typed task, goal, and queued-turn state from project-linked chats. This view never edits
          PCC milestones, proof, or completion status.
        </p>
      </div>
      <span
        >${props.executionProjectionLoading
          ? "Loading"
          : projection
            ? `${projection.activeCount} active`
            : "Unavailable"}</span
      >
    </div>
    ${props.executionProjectionError
      ? html`<div class="pcc-error" role="status">${props.executionProjectionError}</div>`
      : nothing}
    ${projection
      ? html`
          <div class="pcc-runtime-projection__summary">
            <strong>${projection.healthy ? "Healthy" : "Needs attention"}</strong>
            <span
              >${projection.sessionKeys.length} linked
              chat${projection.sessionKeys.length === 1 ? "" : "s"}</span
            >
          </div>
          ${projection.items.length
            ? html`<div class="pcc-runtime-projection__items" role="list">
                ${projection.items.slice(0, 12).map(
                  (item) => html`<article role="listitem">
                    <span>${item.kind} · ${item.status}</span>
                    <strong>${item.summary}</strong>
                  </article>`,
                )}
              </div>`
            : html`<div class="pcc-empty pcc-empty--small">No active execution</div>`}
        `
      : props.executionProjectionLoading
        ? html`<div class="pcc-empty pcc-empty--small">Loading linked chat state…</div>`
        : html`<div class="pcc-empty pcc-empty--small">No linked execution state</div>`}
  </section>`;
}

function renderMilestoneActionMenu(milestone: PccMilestone, props: PccDashboardProps) {
  const skipNote = () => confirmedSkipNote();
  const removeNote = () => confirmedRemoveNote();
  const menuId = `pcc-action-menu-${milestone.id}`;
  return html`<div class="pcc-action-menu" data-pcc-action-menu>
    <button
      class="pcc-action-menu__trigger"
      data-pcc-action-menu-trigger
      data-pcc-milestone-actions
      title="Milestone actions"
      type="button"
      aria-expanded="false"
      aria-controls=${menuId}
      aria-label=${`Actions for ${milestone.title}`}
      @click=${togglePccActionMenu}
    >
      •••
    </button>
    <div
      class="pcc-action-menu__items"
      id=${menuId}
      role="menu"
      aria-hidden="true"
      inert
      hidden
      @keydown=${handlePccActionMenuKeydown}
    >
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => props.onOpenMilestoneEditor(milestone));
        }}
      >
        Edit
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccConfirmedMenuAction(event, "Confirm skip", () => {
            props.onSetMilestoneStatus(milestone, "skipped", skipNote());
          });
        }}
      >
        Skip
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => props.onSetMilestoneStatus(milestone, "deferred"));
        }}
      >
        Defer
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => props.onSetMilestoneStatus(milestone, "on_hold"));
        }}
      >
        Hold
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccConfirmedMenuAction(event, "Confirm remove", () => {
            props.onSetMilestoneStatus(milestone, "archived", removeNote());
          });
        }}
      >
        Remove from active plan
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => props.onSetMilestoneStatus(milestone, "not_started"));
        }}
      >
        Reopen
      </button>
      <label role="menuitemcheckbox">
        <input
          type="checkbox"
          .checked=${milestoneStopsHere(milestone)}
          ?disabled=${props.actionBusy}
          @change=${(event: Event) =>
            props.onSetMilestoneStopHere(milestone, (event.target as HTMLInputElement).checked)}
        />
        Stop here
      </label>
    </div>
  </div>`;
}

function renderSubMilestoneActionMenu(subMilestone: PccSubMilestone, props: PccDashboardProps) {
  const skipNote = () => confirmedSkipNote();
  const removeNote = () => confirmedRemoveNote();
  const menuId = `pcc-submilestone-action-menu-${subMilestone.id}`;
  return html`<div class="pcc-action-menu pcc-action-menu--sub" data-pcc-submilestone-action-menu>
    <button
      class="pcc-action-menu__trigger"
      data-pcc-action-menu-trigger
      data-pcc-submilestone-actions
      title="Sub-step actions"
      type="button"
      aria-expanded="false"
      aria-controls=${menuId}
      aria-label=${`Actions for ${subMilestone.title}`}
      @click=${togglePccActionMenu}
    >
      •••
    </button>
    <div
      class="pcc-action-menu__items"
      id=${menuId}
      role="menu"
      aria-hidden="true"
      inert
      hidden
      @keydown=${handlePccActionMenuKeydown}
    >
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccConfirmedMenuAction(event, "Confirm skip", () => {
            props.onSetSubMilestoneStatus?.(subMilestone, "skipped", skipNote());
          });
        }}
      >
        Skip
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => props.onSetSubMilestoneStatus?.(subMilestone, "deferred"));
        }}
      >
        Defer
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => props.onSetSubMilestoneStatus?.(subMilestone, "on_hold"));
        }}
      >
        Hold
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccConfirmedMenuAction(event, "Confirm remove", () => {
            props.onSetSubMilestoneStatus?.(subMilestone, "archived", removeNote());
          });
        }}
      >
        Remove from active plan
      </button>
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () =>
            props.onSetSubMilestoneStatus?.(subMilestone, "not_started"),
          );
        }}
      >
        Reopen
      </button>
    </div>
  </div>`;
}

function renderSubMilestoneList(
  milestone: PccMilestone,
  props: PccDashboardProps,
  options: { compact?: boolean; showDrilldown?: boolean } = {},
) {
  const subMilestones = subMilestonesForMilestone(props.projectDetail, milestone);
  const reorderMode = Boolean(props.reorderMode);
  if (subMilestones.length === 0) {
    return html`<div class="pcc-empty pcc-empty--small">No sub-milestones recorded</div>`;
  }
  return html`<ol
    class="pcc-submilestones ${options.compact ? "pcc-submilestones--compact" : ""}"
    data-pcc-submilestones
  >
    ${repeat(
      subMilestones,
      (subMilestone) => subMilestone.id,
      (subMilestone) => {
        const percent = subMilestoneDisplayPercent(subMilestone);
        const complete =
          subMilestone.status === "complete" || subMilestone.status === "complete_with_maintenance";
        return html`<li
          class="pcc-submilestone"
          data-pcc-submilestone
          data-pcc-submilestone-id=${subMilestone.id}
          @dragenter=${(event: DragEvent) => {
            event.preventDefault();
            if (reorderMode) {
              setPccDropTarget(event, true);
            }
          }}
          @dragover=${(event: DragEvent) => {
            event.preventDefault();
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = "move";
            }
          }}
          @dragleave=${(event: DragEvent) => setPccDropTarget(event, false)}
          @drop=${(event: DragEvent) => {
            event.preventDefault();
            setPccDropTarget(event, false);
            if (!reorderMode) {
              draggedPccSubMilestoneId = null;
              return;
            }
            const sourceId = getPccDraggedId(event, "submilestone", draggedPccSubMilestoneId);
            const source = subMilestones.find((item) => item.id === sourceId);
            draggedPccSubMilestoneId = null;
            if (source && source.id !== subMilestone.id) {
              props.onMoveSubMilestoneBefore?.(source, subMilestone);
            }
          }}
          @dragend=${() => {
            draggedPccSubMilestoneId = null;
            document
              .querySelectorAll(".pcc-submilestone.is-drop-target")
              .forEach((item) => item.classList.remove("is-drop-target"));
          }}
        >
          <div class="pcc-submilestone__main">
            ${reorderMode
              ? html`<button
                    class="pcc-drag-handle"
                    type="button"
                    data-pcc-drag-handle="submilestone"
                    draggable="true"
                    aria-label=${`Drag to reorder sub-milestone ${subMilestone.title}`}
                    @dragstart=${(event: DragEvent) => {
                      setPccDragData(event, "submilestone", subMilestone.id);
                      draggedPccSubMilestoneId = subMilestone.id;
                    }}
                    @dragend=${() => {
                      draggedPccSubMilestoneId = null;
                    }}
                  >
                    ☰
                  </button>
                  ${renderSubMilestoneReorderControls(subMilestones, subMilestone, props)}`
              : nothing}
            <span class="pcc-submilestone__check" aria-hidden="true">${complete ? "✓" : ""}</span>
            <div>
              <strong>${subMilestone.title}</strong>
              ${options.compact
                ? nothing
                : html`<p>
                    ${subMilestone.implementationPlan || "No implementation plan recorded."}
                  </p>`}
            </div>
            <span class="pcc-status pcc-status--${subMilestone.status}"
              >${formatStatus(subMilestone.status)}</span
            >
            ${reorderMode ? nothing : renderSubMilestoneActionMenu(subMilestone, props)}
          </div>
          <div class="pcc-project-card__meta">
            <span>${percent}%</span>
            ${options.compact
              ? nothing
              : html`
                  <span class="pcc-route-chip" data-pcc-route-chip="worker"
                    ><b>Worker</b> ${itemWorkerLabel(subMilestone)}</span
                  >
                  <span>${itemProofLabel(subMilestone)}</span>
                  <span>${subMilestone.acceptanceCriteria?.length ?? 0} criteria</span>
                `}
          </div>
          ${subMilestone.blocker
            ? html`<p class="pcc-submilestone__blocker">${subMilestone.blocker}</p>`
            : nothing}
          ${options.showDrilldown || !options.compact
            ? renderSubMilestoneDrilldown(subMilestone, props)
            : nothing}
        </li>`;
      },
    )}
  </ol>`;
}

function renderMilestoneCard(milestone: PccMilestone, props: PccDashboardProps) {
  const percent = clampPercent(milestone.percentComplete ?? 0);
  const metadata = metadataObject(milestone.metadata);
  const responsibility = pccResponsibilityForItem(milestone) || "local_openclaw_agent";
  const costRisk = metadataString(metadata.pccCostRisk, "low");
  const canComplete = receiptsForMilestone(props.projectDetail, milestone).length > 0;
  const stopHere = milestoneStopsHere(milestone);
  return html`
    <article class="pcc-milestone" data-pcc-milestone>
      <div class="pcc-milestone__main">
        <h4>${milestone.title}</h4>
        <span class="pcc-status pcc-status--${milestone.status}"
          >${formatStatus(milestone.status)}</span
        >
      </div>
      <p>
        ${milestone.blocker || milestone.implementationPlan || "No implementation plan recorded."}
      </p>
      <div class="pcc-project-card__meta">
        <span>${percent}% complete</span>
        <span>Order ${milestone.order ?? "not set"}</span>
        <span>${milestone.acceptanceCriteria?.length ?? 0} criteria</span>
        <span
          >${subMilestonesForMilestone(props.projectDetail, milestone).length} sub-milestones</span
        >
        <span class="pcc-route-chip" data-pcc-route-chip="worker"
          ><b>Worker</b> ${responsibilityLabel(responsibility)}</span
        >
        <span class="pcc-route-chip" data-pcc-route-chip="risk"
          ><b>Risk</b> ${formatStatus(costRisk)}</span
        >
        ${stopHere ? html`<span>Stop here</span>` : nothing}
      </div>
      <details class="pcc-submilestone-panel">
        <summary>Sub-milestones</summary>
        ${renderSubMilestoneList(milestone, props)}
      </details>
      ${renderMilestoneReceipts(milestone, props)}
      ${permissionsForMilestone(props.projectDetail, milestone).length > 0 ||
      milestone.status === "needs_approval"
        ? html`<section class="pcc-milestone__permissions" aria-label="Milestone permissions">
            ${permissionsForMilestone(props.projectDetail, milestone).length > 0
              ? renderPermissionList(permissionsForMilestone(props.projectDetail, milestone), props)
              : html`<div class="pcc-empty pcc-empty--small">Permission details not recorded</div>`}
          </section>`
        : nothing}
      <div class="pcc-milestone__actions">
        <label class="pcc-stop-here" data-pcc-stop-here>
          <input
            type="checkbox"
            .checked=${stopHere}
            ?disabled=${props.actionBusy}
            @change=${(event: Event) =>
              props.onSetMilestoneStopHere(milestone, (event.target as HTMLInputElement).checked)}
          />
          Stop here
        </label>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onOpenMilestoneEditor(milestone)}
        >
          Edit
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetMilestoneStatus(milestone, "deferred")}
        >
          Defer
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetMilestoneStatus(milestone, "on_hold")}
        >
          Hold
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${(event: Event) =>
            runPccConfirmedButtonAction(event, "Confirm skip", () =>
              props.onSetMilestoneStatus(milestone, "skipped", confirmedSkipNote()),
            )}
        >
          Skip
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetMilestoneStatus(milestone, "not_started")}
        >
          Reopen
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${!canComplete}
          title=${canComplete ? "Mark complete" : "Completion receipt required"}
          @click=${(event: Event) => {
            if (canComplete) {
              runPccConfirmedButtonAction(event, "Confirm complete", () =>
                props.onSetMilestoneStatus(milestone, "complete"),
              );
            }
          }}
        >
          Complete
        </button>
      </div>
    </article>
  `;
}

function renderProjectIntakeWizard(props: PccDashboardProps) {
  const form = props.projectForm;
  const missing = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
  const recommendation = recommendPccWorkflow({
    title: form.title,
    goal: form.goal,
    intakeAnswers: form.intakeAnswers,
  });
  const canPreviewFullSetupRepair = Boolean(props.projectDetail && props.onPreviewSetupAutofill);
  return html`<section
    class="pcc-intake-wizard"
    data-pcc-intake-wizard
    data-pcc-project-intake-answers-page
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Project intake</p>
        <h4>Project intake answers</h4>
        <p>Generate or edit the required answers before PCC creates or resumes work.</p>
      </div>
      <div class="pcc-intake-wizard__header-actions">
        <span class="pcc-status">${missing.length ? `${missing.length} missing` : "Answered"}</span>
        ${renderProjectIntakeFormAutofillButton(
          props,
          `Fill blanks with ${initialPlannerLabel(props.projectForm)}`,
        )}
      </div>
    </div>
    <p class="pcc-intake-wizard__hint">
      ${initialPlannerLabel(form)} fills blanks from the project prompt and current context.
      Everything you typed stays unchanged. Review the planning-only draft before saving.
    </p>
    <section class="pcc-intake-wizard__generate-card" data-pcc-intake-generate-card>
      <div>
        <strong>Generate missing answers with ${initialPlannerLabel(form)}.</strong>
        <span
          >Use this when blanks such as Goal block the setup quality gate. PCC generates a draft
          first; you stay in control before saving or applying.</span
        >
      </div>
      <div class="pcc-intake-wizard__ai-actions">
        ${renderProjectIntakeFormAutofillButton(
          props,
          `Fill blanks with ${initialPlannerLabel(props.projectForm)}`,
        )}
        ${canPreviewFullSetupRepair
          ? renderProjectIntakeAutofillButton(props, "Preview full setup repair")
          : nothing}
      </div>
    </section>
    <div class="pcc-intake-wizard__ai-tools" data-pcc-intake-answer-ai-tools>
      <div>
        <strong>${initialPlannerLabel(form)} can fill any blanks here.</strong>
        <span
          >Use the current project context to draft missing intake answers. Existing project setup
          opens a preview before PCC writes anything.</span
        >
      </div>
      <div class="pcc-intake-wizard__ai-actions">
        ${renderProjectIntakeFormAutofillButton(
          props,
          `Fill blanks with ${initialPlannerLabel(props.projectForm)}`,
        )}
        ${canPreviewFullSetupRepair
          ? renderProjectIntakeAutofillButton(props, "Preview full setup repair")
          : nothing}
      </div>
    </div>
    ${renderAutofillPreview(props)}
    <div class="pcc-intake-wizard__questions">
      ${PCC_REQUIRED_INTAKE_QUESTIONS.map((question) => {
        const value = form.intakeAnswers[question.id] ?? "";
        const hasValue = Boolean(value.trim());
        return html`<label class="pcc-intake-wizard__question">
          <span class="pcc-intake-wizard__question-header">
            <span>${question.label}</span>
            <button
              class="btn btn--subtle pcc-intake-wizard__question-ai"
              type="button"
              data-pcc-intake-question-ai-fill=${question.id}
              title=${hasValue
                ? `Regenerate ${question.label} from the current project context.`
                : `Fill ${question.label} from the current project context.`}
              ?disabled=${props.actionBusy}
              @click=${() => runProjectIntakeFormAutofill(props)}
            >
              ${hasValue
                ? "Regenerate plan"
                : `Fill with ${initialPlannerLabel(props.projectForm)}`}
            </button>
          </span>
          <textarea
            aria-label=${question.prompt}
            placeholder=${question.prompt}
            .value=${value}
            @input=${(event: Event) =>
              props.onProjectFormChange({
                intakeAnswers: {
                  ...form.intakeAnswers,
                  [question.id]: (event.target as HTMLTextAreaElement).value,
                },
              })}
          ></textarea>
        </label>`;
      })}
    </div>
    <div class="pcc-callout" data-pcc-workflow-recommendation>
      <strong>Recommended workflow: ${recommendation.title}</strong>
      <span>${recommendation.reason}</span>
      ${form.workflowTemplateId !== recommendation.templateId
        ? html`<button
            class="btn btn--subtle"
            type="button"
            @click=${() =>
              props.onProjectFormChange({ workflowTemplateId: recommendation.templateId })}
          >
            Use recommendation
          </button>`
        : nothing}
    </div>
    <label class="pcc-intake-wizard__approval">
      <input
        type="checkbox"
        .checked=${form.intakeApproved}
        @change=${(event: Event) =>
          props.onProjectFormChange({
            intakeApproved: (event.target as HTMLInputElement).checked,
          })}
      />
      I approve this intake brief and workflow setup.
    </label>
    ${missing.length || !form.intakeApproved
      ? html`<p class="pcc-intake-wizard__missing" data-pcc-intake-blocked>
          ${missing.length
            ? `Complete every intake answer before saving, or choose Fill blanks with ${initialPlannerLabel(props.projectForm)}.`
            : "Approve the intake brief before saving."}
        </p>`
      : nothing}
  </section>`;
}

function renderGeneratedPlanPreview(props: PccDashboardProps, showApproval = true) {
  const form = props.projectForm;
  const generatedPlan = form.generatedPlan;
  const description = (form.projectDescription ?? "").trim();
  if (!description && !form.title.trim() && !form.goal.trim()) {
    return html`<section class="pcc-plan-preview" data-pcc-plan-preview>
      <p class="pcc-kicker">Generated plan preview</p>
      <h4>Describe what you want to build</h4>
      <p>PCC will pre-fill the workflow, milestones, sub-milestones, owners, and proof gates.</p>
    </section>`;
  }
  const draft = buildPccWorkflowDraft({
    title: form.title || description || "Untitled Project",
    goal: form.goal || description,
    templateId: form.workflowTemplateId,
    planningMode: plannerModeToPlanningMode(form.plannerMode),
    codexPlanningAllowed: form.codexPlanningAllowed,
    remoteProofAllowed: form.remoteProofAllowed,
    runtimeActionsAllowed: form.runtimeActionsAllowed,
    aiUsePolicy: "local_only",
  });
  const previewMilestones = generatedPlan?.milestones ?? draft.milestones;
  const milestoneCount = previewMilestones.length;
  const subMilestoneCount = generatedPlan
    ? generatedPlan.milestones.reduce((count, item) => count + item.subMilestones.length, 0)
    : Object.values(draft.subMilestonesByMilestoneTitle).reduce(
        (count, items) => count + items.length,
        0,
      );
  const executionNeedsPermission =
    form.executionProfile.codexRole !== "off" && !form.codexPlanningAllowed;
  const routing = projectCreationRoutingStats(form);
  return html`<section class="pcc-plan-preview" data-pcc-plan-preview>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Generated plan preview</p>
        <h4>${generatedPlan?.title ?? draft.project.title}</h4>
        <p>${generatedPlan?.goal ?? draft.project.goal ?? "No goal recorded."}</p>
      </div>
      <span class="pcc-status">${milestoneCount} milestones</span>
    </div>
    <div class="pcc-plan-preview__meta">
      <span>${subMilestoneCount} sub-milestones</span>
      <span
        >${generatedPlan
          ? `${generatedPlan.provenance.model} · ${generatedPlan.provenance.effort} · ${
              generatedPlan.provenance.auth === "oauth" ? "OAuth" : "isolated proof"
            }`
          : "Estimate only · no AI plan generated"}</span
      >
      <span
        >${generatedPlan
          ? generatedPlan.provenance.source === "live_codex"
            ? "Live Codex planning"
            : generatedPlan.provenance.source === "live_local"
              ? "Live local AI planning"
              : "Deterministic isolated proof"
          : form.plannerMode.replace(/_/gu, " ")}</span
      >
      <span>${form.workflowTemplateId.replace(/-/gu, " ")}</span>
      <span data-pcc-ai-routing-summary
        >${routing.local} local · ${routing.codex} Codex · ${routing.gated} gated</span
      >
      <span
        >${executionNeedsPermission
          ? "Codex execution approval needed"
          : "Execution routing ready"}</span
      >
    </div>
    ${form.planRevision
      ? html`<section
          class="pcc-plan-revision ${form.planRevision.safeToApply ? "" : "is-blocked"}"
          data-pcc-plan-revision-preview
        >
          <div class="pcc-section-heading">
            <div>
              <p class="pcc-kicker">Impact preview</p>
              <h4>${form.planRevision.safeToApply ? "Safe to apply after review" : "Blocked"}</h4>
              <p>${form.planRevision.summary}</p>
            </div>
            <span>${form.planRevision.rollbackAvailable ? "Undo available" : "No rollback"}</span>
          </div>
          <dl class="pcc-workflow-quality__facts">
            <div>
              <dt>Add</dt>
              <dd>${form.planRevision.addedMilestones} milestones</dd>
            </div>
            <div>
              <dt>Update</dt>
              <dd>${form.planRevision.updatedMilestones} milestones</dd>
            </div>
            <div>
              <dt>Protected</dt>
              <dd>${form.planRevision.preservedCompletedMilestones} completed</dd>
            </div>
            <div>
              <dt>Active work</dt>
              <dd>
                ${form.planRevision.mustPauseActiveWork
                  ? `${form.planRevision.affectedActiveMilestoneIds.length} paused before apply`
                  : "No pause needed"}
              </dd>
            </div>
            <div>
              <dt>Proof</dt>
              <dd>
                ${form.planRevision.staleProofMilestoneIds.length
                  ? `${form.planRevision.staleProofMilestoneIds.length} items need fresh proof`
                  : "No proof invalidated"}
              </dd>
            </div>
            <div>
              <dt>Planner</dt>
              <dd>${form.planRevision.sourceModel} · ${form.planRevision.sourceEffort}</dd>
            </div>
          </dl>
          ${form.planRevision.integrityErrors.length
            ? html`<ul class="pcc-plan-revision__errors">
                ${form.planRevision.integrityErrors.map((error) => html`<li>${error}</li>`)}
              </ul>`
            : nothing}
          <p>
            PCC never overwrites completed milestones. New milestones are appended. Matching active
            milestones are updated, and any affected work is put on hold before the revision is
            applied.
          </p>
        </section>`
      : nothing}
    ${executionNeedsPermission
      ? html`<div class="pcc-callout" data-pcc-codex-planning-gate>
          <strong>Optional Codex execution selected · approval below</strong>
          <span
            >The plan was generated through the persistent planning-only grant. The separate
            approval card controls whether Codex may execute the selected checkpoints after the
            project is created.</span
          >
        </div>`
      : nothing}
    <ol class="pcc-plan-preview__milestones">
      ${previewMilestones.slice(0, 6).map((milestone) => {
        const subs =
          "subMilestones" in milestone
            ? milestone.subMilestones
            : (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []);
        const responsibility =
          "responsibility" in milestone
            ? generatedPlanExecutionResponsibility(milestone.responsibility)
            : metadataString(
                metadataObject(milestone.metadata).pccResponsibility,
                "local_openclaw_agent",
              );
        return html`<li>
          <strong>${milestone.title}</strong>
          <span
            >${subs.length} sub-milestone${subs.length === 1 ? "" : "s"} ·
            ${responsibilityLabel(responsibility)}</span
          >
          <ul>
            ${subs.slice(0, 3).map((sub) => html`<li>${sub.title}</li>`)}
          </ul>
        </li>`;
      })}
    </ol>
    ${showApproval
      ? html`<label class="pcc-intake-wizard__approval">
          <input
            type="checkbox"
            .checked=${form.planPreviewAccepted}
            @change=${(event: Event) =>
              props.onProjectFormChange({
                planPreviewAccepted: (event.target as HTMLInputElement).checked,
              })}
          />
          ${form.planRevision
            ? "I reviewed the impact and approve this project change."
            : "I reviewed this generated plan preview."}
        </label>`
      : nothing}
  </section>`;
}

function renderEditorActionError(props: PccDashboardProps) {
  return props.actionError
    ? html`<p class="pcc-editor__error" role="alert" data-pcc-editor-error>
        <strong>Could not save</strong><span>${props.actionError}</span>
      </p>`
    : nothing;
}

function renderProjectCoreFields(props: PccDashboardProps) {
  const form = props.projectForm;
  return html`<section class="pcc-create-core" data-pcc-create-core-fields>
    <label>
      Project name
      <input
        required
        data-pcc-project-title
        .value=${form.title}
        @input=${(event: Event) =>
          props.onProjectFormChange({ title: (event.target as HTMLInputElement).value })}
      />
    </label>
    <label>
      What should this project accomplish?
      <textarea
        data-pcc-project-goal
        .value=${form.goal}
        @input=${(event: Event) =>
          props.onProjectFormChange({ goal: (event.target as HTMLTextAreaElement).value })}
      ></textarea>
    </label>
    <label>
      How will you know it worked?
      <textarea
        data-pcc-project-outcome-metrics
        placeholder="One clear result per line."
        .value=${form.outcomeMetrics}
        @input=${(event: Event) =>
          props.onProjectFormChange({
            outcomeMetrics: (event.target as HTMLTextAreaElement).value,
          })}
      ></textarea>
    </label>
  </section>`;
}

function renderProjectScheduleAndWorkflow(props: PccDashboardProps) {
  const form = props.projectForm;
  return html`<section class="pcc-create-options__group">
    <div>
      <strong>Schedule and workflow</strong>
      <span>Optional. PCC already chose safe defaults.</span>
    </div>
    <div class="pcc-editor__grid">
      <label>
        Priority
        <select
          .value=${form.priority}
          @change=${(event: Event) =>
            props.onProjectFormChange({ priority: (event.target as HTMLSelectElement).value })}
        >
          <option value="0">Lowest</option>
          <option value="1">Low</option>
          <option value="2">Normal</option>
          <option value="3">Important</option>
          <option value="4">High</option>
          <option value="5">Urgent</option>
        </select>
      </label>
      <label>
        Due date
        <input
          type="date"
          data-pcc-project-due-date
          .value=${form.dueDate}
          @input=${(event: Event) =>
            props.onProjectFormChange({ dueDate: (event.target as HTMLInputElement).value })}
        />
      </label>
      <label>
        Workflow
        <select
          data-pcc-project-workflow
          .value=${form.workflowTemplateId}
          @change=${(event: Event) =>
            props.onProjectFormChange({
              workflowTemplateId: (event.target as HTMLSelectElement).value,
            })}
        >
          ${PCC_WORKFLOW_TEMPLATES.map(
            (template) => html`<option value=${template.id}>${template.title}</option>`,
          )}
        </select>
      </label>
    </div>
  </section>`;
}

function renderProjectPlannerSummary(props: PccDashboardProps) {
  const summary = projectPlannerSummary(props);
  const initialPlanner = initialPlannerUsesCodex(props.projectForm)
    ? "Codex initial planning · explicit opt-in"
    : "Local AI initial planning · recommended";
  return html`<section class="pcc-create-planner-summary" data-pcc-create-planner-summary>
    <div>
      <span>Initial plan and execution</span>
      <strong>${initialPlanner}</strong>
      <p>${summary.detail}</p>
    </div>
    <em>${summary.safety}</em>
  </section>`;
}

function renderProjectAiRolePicker(props: PccDashboardProps) {
  const form = props.projectForm;
  const execution = localExecutionOption(form.executionProfile.speed);
  const codex = codexPolicyOption(form.executionProfile.codexPolicyId);
  return html`<section class="pcc-ai-role-picker" data-pcc-ai-role-picker>
    <details data-pcc-initial-planner-picker>
      <summary>
        <span>
          <small>How should PCC create the initial plan?</small>
          <strong
            >${initialPlannerUsesCodex(form)
              ? "Codex · explicit opt-in"
              : "Local AI · Recommended"}</strong
          >
          <em
            >${initialPlannerUsesCodex(form)
              ? "Uses Codex only after you select it."
              : "Runs locally and preserves Codex compute."}</em
          >
        </span>
        <span class="pcc-ai-role-picker__change">Change</span>
      </summary>
      <fieldset>
        <legend>Choose the initial planning engine</legend>
        <label class="pcc-ai-role-option ${initialPlannerUsesCodex(form) ? "" : "is-selected"}">
          <input
            type="radio"
            name="pcc-initial-planner"
            value="local_model"
            data-pcc-initial-planner="local"
            .checked=${!initialPlannerUsesCodex(form)}
            @change=${() => props.onProjectFormChange(initialPlannerPatch("local_model"))}
          />
          <span>
            <strong>Local AI · Recommended</strong>
            <small>Generate the first plan on this Mac. No Codex usage.</small>
            <em>Planning remains tool-free, review-first, and local-only.</em>
          </span>
        </label>
        <label class="pcc-ai-role-option ${initialPlannerUsesCodex(form) ? "is-selected" : ""}">
          <input
            type="radio"
            name="pcc-initial-planner"
            value="codex"
            data-pcc-initial-planner="codex"
            .checked=${initialPlannerUsesCodex(form)}
            @change=${() => props.onProjectFormChange(initialPlannerPatch("codex"))}
          />
          <span>
            <strong>Codex · explicit opt-in</strong>
            <small>Use the planning-only Codex grant for this plan.</small>
            <em>It does not authorize implementation, deployment, or external writes.</em>
          </span>
        </label>
      </fieldset>
    </details>
    <details data-pcc-local-execution-picker>
      <summary>
        <span>
          <small>How fast should OpenClaw work?</small>
          <strong>${execution.title.replace(" · Recommended", "")}</strong>
          <em>${execution.detail}</em>
        </span>
        <span class="pcc-ai-role-picker__change">Change</span>
      </summary>
      <fieldset>
        <legend>Choose local work speed</legend>
        ${LOCAL_EXECUTION_OPTIONS.map(
          (option) => html`<label
            class="pcc-ai-role-option ${form.executionProfile.speed === option.value
              ? "is-selected"
              : ""}"
          >
            <input
              type="radio"
              name="pcc-local-execution"
              value=${option.value}
              data-pcc-local-execution=${option.value}
              .checked=${form.executionProfile.speed === option.value}
              @change=${() =>
                props.onProjectFormChange(localExecutionFormPatch(form, option.value))}
            />
            <span>
              <strong>${option.title}</strong>
              <small>${option.detail}</small>
              <em>${option.usage}</em>
            </span>
          </label>`,
        )}
      </fieldset>
    </details>
    <details data-pcc-codex-policy-picker>
      <summary>
        <span>
          <small>When should Codex help after planning?</small>
          <strong>${codex.title}</strong>
          <em>${codex.detail}</em>
        </span>
        <span class="pcc-ai-role-picker__change">Change</span>
      </summary>
      <fieldset>
        <legend>Choose Codex involvement</legend>
        ${CODEX_POLICY_OPTIONS.map(
          (option) => html`<label
            class="pcc-ai-role-option ${form.executionProfile.codexPolicyId === option.value
              ? "is-selected"
              : ""}"
          >
            <input
              type="radio"
              name="pcc-codex-policy"
              value=${option.value}
              data-pcc-codex-policy=${option.value}
              .checked=${form.executionProfile.codexPolicyId === option.value}
              @change=${() => props.onProjectFormChange(codexPolicyFormPatch(form, option.value))}
            />
            <span>
              <strong
                >${option.title}${option.value === "recommended_minimum"
                  ? " · Recommended"
                  : ""}</strong
              >
              <small>${option.detail}</small>
              <em>${option.usage}</em>
            </span>
          </label>`,
        )}
      </fieldset>
      ${form.executionProfile.codexPolicyId === "custom"
        ? html`<div class="pcc-codex-checkpoints" data-pcc-codex-checkpoints>
            ${CODEX_CHECKPOINT_OPTIONS.map(
              ([id, label, help]) => html`<label>
                <span><strong>${label}</strong><small>${help}</small></span>
                <select
                  data-pcc-codex-checkpoint=${id}
                  .value=${form.executionProfile.codexCheckpoints[id]}
                  @change=${(event: Event) => {
                    const executionProfile = updatePccCodexCheckpoint(
                      form.executionProfile,
                      id,
                      (event.target as HTMLSelectElement).value as PccCodexCheckpointMode,
                    );
                    props.onProjectFormChange({
                      executionProfile,
                      plannerPermissionScope: executionProfile.approvalScope,
                      codexPlanningAllowed:
                        executionProfile.codexRole === "off" ? false : form.codexPlanningAllowed,
                      planPreviewAccepted: false,
                    });
                  }}
                >
                  <option value="local">Local AI</option>
                  <option value="codex">Codex</option>
                  <option value="automatic">Automatic</option>
                </select>
              </label>`,
            )}
          </div>`
        : nothing}
      <details class="pcc-policy-terms" data-pcc-policy-terms>
        <summary>What do these terms mean?</summary>
        <dl>
          <div>
            <dt>Automatic</dt>
            <dd>
              Starts with local AI. Codex is selected only after two documented local attempts or
              for a high-impact checkpoint. It cannot bypass approval or safety gates.
            </dd>
          </div>
          <div>
            <dt>Checkpoint</dt>
            <dd>
              A planned review moment after the initial project plan. It is not routine
              implementation.
            </dd>
          </div>
          <div>
            <dt>Effort</dt>
            <dd>How deeply Codex reasons. Medium is the recommended default.</dd>
          </div>
        </dl>
      </details>
    </details>
    <p data-pcc-ai-role-routing>
      OpenClaw ${execution.title.toLowerCase().replace(" · recommended", "")}. ${codex.detail}
      ${projectCreationAiTruth(form)} These two settings are the single source of truth; neither
      silently overrides the other.
    </p>
  </section>`;
}

function renderProjectPlannerControls(props: PccDashboardProps) {
  const form = props.projectForm;
  const profile = form.executionProfile;
  const usesCodex = profile.codexPolicyId !== "local_only";
  const initialCodex = initialPlannerUsesCodex(form);
  const planningPolicy = props.planningPolicy;
  const planningModel = initialCodex
    ? PCC_CODEX_PLANNER_MODEL
    : planningPolicy?.provider === "ollama"
      ? planningPolicy.model
      : PCC_LOCAL_PLANNER_MODEL;
  const capacity = props.executionCapacity?.safeLocalAgentSlots ?? 0;
  const counts = resolvePccEstimatedAgentCounts(profile, capacity);
  return html`<section class="pcc-create-options__group" data-pcc-create-model-options>
    <div>
      <strong>Advanced model settings</strong>
      <span>Optional. These refine the two choices above; they cannot override them.</span>
    </div>
    <div class="pcc-callout" data-pcc-planning-policy>
      <div>
        <strong
          >Initial planning:
          ${initialCodex ? "Codex · explicit opt-in" : "Local AI · default"}</strong
        >
        <span
          >${planningModel} · ${planningPolicy?.depth ?? "automatic"} depth ·
          ${initialCodex ? "OAuth" : "local-only"} · planning only</span
        >
      </div>
      ${props.onSetCodexPlanningEnabled
        ? html`<button
            class="btn btn--subtle"
            type="button"
            data-pcc-planning-policy-toggle
            ?disabled=${props.actionBusy}
            @click=${() =>
              props.onSetCodexPlanningEnabled?.(planningPolicy?.grant.enabled === false)}
          >
            ${planningPolicy?.grant.enabled === false
              ? "Enable Codex planning"
              : "Disable Codex planning"}
          </button>`
        : nothing}
    </div>
    <div class="pcc-editor__grid pcc-editor__grid--two">
      <label>
        OpenClaw worker model
        <select
          data-pcc-planner-model
          .value=${profile.localModelId}
          @change=${(event: Event) =>
            props.onProjectFormChange(
              executionProfileFieldPatch(form, {
                localModelId: (event.target as HTMLSelectElement).value,
              }),
            )}
        >
          ${modelOptions(props, profile.localModelId, "openclaw").map(
            ([value, label, disabled]) =>
              html`<option value=${value} ?disabled=${disabled}>${label}</option>`,
          )}
        </select>
        <small data-pcc-model-refresh-status>${plannerModelRefreshLabel(props)}</small>
      </label>
      ${usesCodex
        ? html`
            <label>
              Codex model
              <select
                data-pcc-codex-model
                .value=${profile.codexModelId}
                @change=${(event: Event) =>
                  props.onProjectFormChange({
                    ...executionProfileFieldPatch(form, {
                      codexModelId: (event.target as HTMLSelectElement).value,
                    }),
                    codexPlanningAllowed: false,
                  })}
              >
                ${modelOptions(props, profile.codexModelId, "codex").map(
                  ([value, label, disabled]) =>
                    html`<option value=${value} ?disabled=${disabled}>${label}</option>`,
                )}
              </select>
              <small>Only configured Codex models appear. Removed models stay unavailable.</small>
            </label>
            <label>
              Normal Codex effort
              <select
                data-pcc-codex-reasoning
                .value=${profile.codexEffort}
                @change=${(event: Event) =>
                  props.onProjectFormChange({
                    ...executionProfileFieldPatch(form, {
                      codexEffort: (event.target as HTMLSelectElement)
                        .value as PccExecutionProfile["codexEffort"],
                    }),
                    codexPlanningAllowed: false,
                  })}
              >
                <option value="medium">Medium · balanced quality and speed</option>
                <option value="high">High · architecture and debugging</option>
                <option value="xhigh">Very high · difficult reviews</option>
                <option value="max">Maximum · hardest quality-first work</option>
              </select>
              <small>
                Medium is recommended. Effort controls reasoning depth, not a token allowance.
              </small>
            </label>
            <label>
              Maximum automatic effort
              <select
                data-pcc-codex-maximum-reasoning
                .value=${profile.codexMaxEffort}
                @change=${(event: Event) =>
                  props.onProjectFormChange({
                    ...executionProfileFieldPatch(form, {
                      codexMaxEffort: (event.target as HTMLSelectElement)
                        .value as PccExecutionProfile["codexMaxEffort"],
                    }),
                    codexPlanningAllowed: false,
                  })}
              >
                <option value="medium">Medium · routine checkpoint ceiling</option>
                <option value="high">High · recommended automatic ceiling</option>
                <option value="xhigh">Very high · difficult recovery ceiling</option>
                <option value="max">Maximum · hardest quality-first ceiling</option>
              </select>
              <small>
                Automatic never exceeds this effort and always records why it escalated.
              </small>
            </label>
          `
        : nothing}
      <label>
        OpenClaw team capacity
        <select
          data-pcc-capacity-policy
          .value=${profile.capacityPolicy}
          @change=${(event: Event) =>
            props.onProjectFormChange(
              executionProfileFieldPatch(form, {
                capacityPolicy: (event.target as HTMLSelectElement)
                  .value as PccExecutionProfile["capacityPolicy"],
              }),
            )}
        >
          <option value="conservative">Conservative · at most two workers</option>
          <option value="automatic">Automatic · use safe available capacity</option>
          <option value="maximum_safe">Maximum safe · fastest within host limits</option>
        </select>
        <small>
          Current estimate: ${counts.localAgents} OpenClaw
          worker${counts.localAgents === 1 ? "" : "s"}
          ${props.executionCapacity
            ? ` from ${props.executionCapacity.safeLocalAgentSlots} safe slot${props.executionCapacity.safeLocalAgentSlots === 1 ? "" : "s"}`
            : " until host capacity is measured"}.
        </small>
      </label>
    </div>
    <button
      class="btn btn--subtle"
      type="button"
      data-pcc-refresh-models
      ?disabled=${props.modelsLoading}
      @click=${() => props.onRefreshModelCatalog?.()}
    >
      Refresh model list
    </button>
    <p data-pcc-model-routing-contract>
      ${usesCodex
        ? "OpenClaw workers perform routine implementation. Codex is used only at the visible checkpoints above, records the selected model, effort, and reason, and remains blocked until approved."
        : "All planning checkpoints and execution stay local. Maximum Safe can use all measured safe capacity without invoking Codex."}
    </p>
  </section>`;
}

function renderProjectCreationCustomize(props: PccDashboardProps, includeCoreFields: boolean) {
  const form = props.projectForm;
  const missing = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
  return html`<details class="pcc-create-options" data-pcc-create-customize>
    <summary>
      <span>
        <strong>Customize plan</strong>
        <small>Optional · change details, model, workflow, or safety</small>
      </span>
    </summary>
    <div class="pcc-create-options__body">
      ${includeCoreFields ? renderProjectCoreFields(props) : nothing}
      ${renderProjectScheduleAndWorkflow(props)} ${renderProjectPlannerControls(props)}
      <details class="pcc-create-options__nested" data-pcc-advanced-intake>
        <summary>
          Review every setup answer · ${missing.length ? `${missing.length} missing` : "ready"}
        </summary>
        ${renderProjectIntakeWizard(props)}
      </details>
      <section class="pcc-create-options__group">
        <div>
          <strong>Safety</strong>
          <span>These permissions remain off unless you choose them.</span>
        </div>
        <div class="pcc-intake-options" data-pcc-workflow-intake>
          <label>
            <input
              type="checkbox"
              .checked=${form.remoteProofAllowed}
              @change=${(event: Event) =>
                props.onProjectFormChange({
                  remoteProofAllowed: (event.target as HTMLInputElement).checked,
                })}
            />
            Allow remote proof when required
          </label>
          <label>
            <input
              type="checkbox"
              .checked=${form.runtimeActionsAllowed}
              @change=${(event: Event) =>
                props.onProjectFormChange({
                  runtimeActionsAllowed: (event.target as HTMLInputElement).checked,
                })}
            />
            Allow local runtime actions
          </label>
        </div>
      </section>
    </div>
  </details>`;
}

function renderProjectCreationFlow(props: PccDashboardProps) {
  const form = props.projectForm;
  const reviewing = form.planPreviewAccepted;
  const blankCount = projectCreationBlankCount(form);
  const stats = projectCreationDraftStats(form);
  const routing = projectCreationRoutingStats(form);
  const canReview = Boolean(
    form.projectDescription.trim() || form.title.trim() || form.goal.trim(),
  );
  return html`<section
    class="pcc-create-flow"
    data-pcc-create-flow
    data-pcc-create-step=${reviewing ? "review" : "describe"}
  >
    <ol class="pcc-create-steps" aria-label="New project progress">
      <li class=${reviewing ? "is-complete" : "is-current"}><span>1</span>Goal</li>
      <li class="is-complete"><span>2</span>Work speed</li>
      <li class="is-complete"><span>3</span>AI plan</li>
      <li class=${reviewing ? "is-current" : ""}><span>4</span>Review & create</li>
    </ol>
    ${reviewing
      ? html`
          <section class="pcc-create-review-callout" data-pcc-create-review-ready>
            <div>
              <strong>Your plan is ready to review</strong>
              <span
                >PCC filled blank setup fields and kept everything you typed.
                ${projectCreationAiTruth(form)} Nothing has been created or started yet.</span
              >
            </div>
            <span>${stats.milestones} milestones · ${stats.subMilestones} sub-steps</span>
          </section>
          ${renderProjectCoreFields(props)} ${renderProjectAiRolePicker(props)}
          ${renderPlannerPermissionCard(props)} ${renderGeneratedPlanPreview(props, false)}
          <details class="pcc-create-request-edit">
            <summary>Edit original request</summary>
            <label class="pcc-editor__hero-field">
              What do you want to accomplish?
              <textarea
                data-pcc-project-description
                .value=${form.projectDescription}
                @input=${(event: Event) =>
                  props.onProjectFormChange({
                    projectDescription: (event.target as HTMLTextAreaElement).value,
                  })}
              ></textarea>
            </label>
          </details>
          ${renderProjectCreationCustomize(props, false)}
        `
      : html`
          <label class="pcc-editor__hero-field">
            What do you want to accomplish?
            <span>Use everyday language. One or two sentences is enough.</span>
            <textarea
              data-pcc-project-description
              autofocus
              placeholder="Example: Plan a kitchen remodel, keep it on budget, and make sure permits and inspections are not missed."
              .value=${form.projectDescription}
              @input=${(event: Event) =>
                props.onProjectFormChange({
                  projectDescription: (event.target as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          ${renderProjectAiRolePicker(props)}
          <label class="pcc-create-depth">
            Planning depth
            <select
              data-pcc-planning-depth
              .value=${form.planningDepth}
              @change=${(event: Event) =>
                props.onProjectFormChange({
                  planningDepth: (event.target as HTMLSelectElement)
                    .value as PccProjectFormState["planningDepth"],
                })}
            >
              <option value="automatic">Automatic (recommended)</option>
              <option value="medium">Medium · normal projects</option>
              <option value="high">High · complex architecture or migration</option>
            </select>
            <small
              >${initialPlannerUsesCodex(form) ? "Codex GPT-5.6 Sol" : "Local AI"} plans. PCC raises
              depth only when complexity requires it.</small
            >
          </label>
          <section class="pcc-create-ai-explainer" data-pcc-create-ai-explainer>
            <div>
              <span class="pcc-create-ai-explainer__icon" aria-hidden="true">✦</span>
              <div>
                <strong>Planner fills only the blanks</strong>
                <p>Anything you type stays unchanged. Before saving, you will review:</p>
              </div>
            </div>
            <ul>
              <li>Project name and goal</li>
              <li>Setup answers and workflow</li>
              <li>Milestones and sub-steps</li>
              <li>Owners, acceptance criteria, and proof</li>
            </ul>
            <p data-pcc-create-ai-summary>
              ${blankCount} blank setup item${blankCount === 1 ? "" : "s"} · draft will include
              ${stats.milestones} milestones and ${stats.subMilestones} sub-steps · ${routing.local}
              local / ${routing.codex} Codex · ${projectCreationAiTruth(form)}
            </p>
          </section>
          ${renderProjectCreationCustomize(props, true)}
          ${canReview
            ? nothing
            : html`<p
                class="pcc-create-start-hint"
                id="pcc-create-start-hint"
                data-pcc-create-start-hint
              >
                Start by describing the result you want above.
              </p>`}
        `}
  </section>`;
}

function renderProjectEditor(props: PccDashboardProps) {
  const form = props.projectForm;
  const missingIntake = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
  const creating = props.editorMode === "create-project";
  const editMode = props.projectEditMode ?? "simple";
  const hasProjectRequest = Boolean(
    form.projectDescription.trim() || form.title.trim() || form.goal.trim(),
  );
  const projectSaveBlocked = creating
    ? missingIntake.length > 0 || !form.intakeApproved || !form.planPreviewAccepted
    : false;
  const needsAiDraft = projectIntakeNeedsAiDraft(form);
  const intakeSummary = missingIntake.length
    ? `${missingIntake.length} missing`
    : form.intakeApproved
      ? "approved"
      : "needs approval";
  return html`
    <form
      class="pcc-editor pcc-editor--project"
      data-pcc-editor="project"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcc-project-editor-title"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          confirmEditorClose(props);
        }
      }}
      @submit=${(event: Event) => {
        event.preventDefault();
        props.onSaveProject();
      }}
    >
      <header class="pcc-editor__header">
        <div>
          <p class="pcc-kicker">Project</p>
          <h3 id="pcc-project-editor-title">
            ${props.editorMode === "edit-project" ? "Edit project" : "Create project"}
          </h3>
          ${creating
            ? html`<p>Tell PCC what you want. Review the plan. Then create it.</p>`
            : nothing}
        </div>
        ${creating
          ? nothing
          : needsAiDraft
            ? html`<div class="pcc-editor__header-actions">
                ${renderProjectIntakeAutofillButton(
                  props,
                  `Plan missing details with ${initialPlannerLabel(props.projectForm)}`,
                )}
                <span class="pcc-status">${intakeSummary}</span>
              </div>`
            : html`<span class="pcc-status">Setup ready</span>`}
        <button
          class="pcc-editor__close"
          type="button"
          aria-label="Close project editor"
          @click=${() => confirmEditorClose(props)}
        >
          ×
        </button>
      </header>
      ${props.actionNotice ? renderPccActionFeedback(props) : renderPccBusyFeedback(props)}
      ${renderEditorActionError(props)}
      ${creating
        ? renderProjectCreationFlow(props)
        : html`
            ${renderProjectEditModeTabs(props)}
            ${editMode === "ai" ? renderSectionAiRegeneratePanel(props) : nothing}
            ${needsAiDraft
              ? html`<section class="pcc-editor__ai-repair" data-pcc-project-intake-ai-repair>
                  <div>
                    <strong>Fill only the missing setup</strong>
                    <span
                      >PCC keeps your existing text and previews saved-project changes before it
                      writes anything.</span
                    >
                  </div>
                  ${renderProjectIntakeAutofillButton(
                    props,
                    `Plan missing details with ${initialPlannerLabel(props.projectForm)}`,
                  )}
                </section>`
              : nothing}
            ${renderProjectCoreFields(props)} ${renderProjectScheduleAndWorkflow(props)}
            ${renderProjectPlannerSummary(props)}
            ${editMode !== "simple"
              ? html`
                  ${renderProjectPlannerControls(props)} ${renderPlannerPermissionCard(props)}
                  <label>
                    Status
                    <select
                      data-pcc-project-status
                      .value=${form.status}
                      @change=${(event: Event) =>
                        props.onProjectFormChange({
                          status: (event.target as HTMLSelectElement).value as PccStatus,
                        })}
                    >
                      ${renderStatusOptions(PROJECT_STATUSES)}
                    </select>
                  </label>
                  <details
                    class="pcc-detail-drawer"
                    data-pcc-advanced-intake
                    ?open=${needsAiDraft || editMode === "ai"}
                  >
                    <summary>Setup answers · ${intakeSummary}</summary>
                    ${renderProjectIntakeWizard(props)}
                  </details>
                  ${editMode === "ai" ? renderGeneratedPlanPreview(props) : nothing}
                  <div class="pcc-intake-options" data-pcc-workflow-intake>
                    <label>
                      <input
                        type="checkbox"
                        .checked=${form.remoteProofAllowed}
                        @change=${(event: Event) =>
                          props.onProjectFormChange({
                            remoteProofAllowed: (event.target as HTMLInputElement).checked,
                          })}
                      />
                      Allow remote proof when required
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        .checked=${form.runtimeActionsAllowed}
                        @change=${(event: Event) =>
                          props.onProjectFormChange({
                            runtimeActionsAllowed: (event.target as HTMLInputElement).checked,
                          })}
                      />
                      Allow local runtime actions
                    </label>
                  </div>
                `
              : nothing}
          `}
      ${creating && form.planPreviewAccepted && projectSaveBlocked
        ? html`<p class="pcc-intake-wizard__missing" data-pcc-plan-preview-blocked>
            Review the missing setup details before creating the project.
          </p>`
        : nothing}
      <footer>
        ${creating
          ? form.planPreviewAccepted
            ? html`
                <button
                  class="btn pcc-action-primary pcc-editor-primary-action"
                  type="submit"
                  data-pcc-create-project-confirm
                  ?disabled=${props.actionBusy || !form.title.trim() || projectSaveBlocked}
                >
                  Create project
                </button>
                <button
                  class="btn btn--subtle"
                  type="button"
                  data-pcc-create-project-back
                  @click=${() => props.onProjectFormChange({ planPreviewAccepted: false })}
                >
                  Back
                </button>
                <button
                  class="btn btn--subtle"
                  type="button"
                  data-pcc-create-fill-remaining
                  ?disabled=${planningActionDisabled(props)}
                  @click=${() => props.onGenerateProjectPlan?.()}
                >
                  Regenerate missing details with ${initialPlannerLabel(form)}
                </button>
              `
            : html`<button
                class="btn pcc-action-primary pcc-editor-primary-action pcc-create-review-action"
                type="button"
                data-pcc-create-review-plan
                data-pcc-action-state=${props.actionBusy ? "working" : "ready"}
                aria-describedby=${hasProjectRequest ? nothing : "pcc-create-start-hint"}
                title=${hasProjectRequest
                  ? "Generate a project plan from the information above"
                  : "Describe the result you want above to enable planning"}
                ?disabled=${planningActionDisabled(props) ||
                !(form.projectDescription.trim() || form.title.trim() || form.goal.trim())}
                @click=${() => props.onGenerateProjectPlan?.()}
              >
                ${props.actionBusy
                  ? `Generating ${initialPlannerUsesCodex(form) ? "Codex" : "local AI"} project plan…`
                  : `Generate project plan with ${initialPlannerUsesCodex(form) ? "Codex" : "Local AI"}`}
              </button>`
          : html`<button
              class="btn pcc-action-primary pcc-editor-primary-action"
              type="submit"
              ?disabled=${props.actionBusy ||
              !form.title.trim() ||
              Boolean(
                form.planRevision && (!form.planRevision.safeToApply || !form.planPreviewAccepted),
              )}
            >
              ${form.planRevision ? "Apply approved change" : "Save project"}
            </button>`}
        ${creating
          ? nothing
          : html`<button
              class="btn btn--subtle"
              type="button"
              data-pcc-project-regenerate-ai
              ?disabled=${planningActionDisabled(props) || !props.onPreviewSetupAutofill}
              @click=${() => props.onPreviewSetupAutofill?.()}
            >
              Plan missing details with ${initialPlannerLabel(form)}
            </button>`}
        <button
          class="btn btn--subtle"
          type="button"
          data-pcc-project-cancel
          @click=${(event: Event) => runPccEditorCancelAction(event, props)}
        >
          Cancel
        </button>
      </footer>
    </form>
  `;
}

function renderMilestoneEditor(props: PccDashboardProps) {
  const form = props.milestoneForm;
  return html`
    <form
      class="pcc-editor"
      data-pcc-editor="milestone"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcc-milestone-editor-title"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onCancelEditor();
        }
      }}
      @submit=${(event: Event) => {
        event.preventDefault();
        props.onSaveMilestone();
      }}
    >
      <header>
        <p class="pcc-kicker">Milestone</p>
        <h3 id="pcc-milestone-editor-title">
          ${props.editorMode === "edit-milestone" ? "Edit milestone" : "Create milestone"}
        </h3>
      </header>
      ${renderEditorActionError(props)}
      <label
        >Title<input
          required
          .value=${form.title}
          @input=${(event: Event) =>
            props.onMilestoneFormChange({ title: (event.target as HTMLInputElement).value })}
      /></label>
      <label
        >Status<select
          .value=${form.status}
          @change=${(event: Event) =>
            props.onMilestoneFormChange({
              status: (event.target as HTMLSelectElement).value as PccStatus,
            })}
        >
          ${renderStatusOptions(MILESTONE_STATUSES)}
        </select></label
      >
      <div class="pcc-editor__grid">
        <label
          >Phase<input
            .value=${form.phaseId}
            @input=${(event: Event) =>
              props.onMilestoneFormChange({ phaseId: (event.target as HTMLInputElement).value })}
        /></label>
        <label
          >Order<input
            type="number"
            min="0"
            .value=${form.order}
            @input=${(event: Event) =>
              props.onMilestoneFormChange({ order: (event.target as HTMLInputElement).value })}
        /></label>
        <label
          >Worker<select
            .value=${form.responsibility}
            @change=${(event: Event) =>
              props.onMilestoneFormChange({
                responsibility: (event.target as HTMLSelectElement).value,
              })}
          >
            ${renderStringOptions(RESPONSIBILITY_OPTIONS, form.responsibility)}
          </select></label
        >
        <label
          >Token/cost risk<select
            .value=${form.costRisk}
            @change=${(event: Event) =>
              props.onMilestoneFormChange({ costRisk: (event.target as HTMLSelectElement).value })}
          >
            ${renderStringOptions(COST_RISK_OPTIONS, form.costRisk)}
          </select></label
        >
        <label class="pcc-editor__check">
          <input
            type="checkbox"
            .checked=${form.stopHere}
            @change=${(event: Event) =>
              props.onMilestoneFormChange({ stopHere: (event.target as HTMLInputElement).checked })}
          />
          Stop here after this milestone
        </label>
        <label
          >Percent<input
            type="number"
            min="0"
            max="100"
            .value=${form.percentComplete}
            @input=${(event: Event) =>
              props.onMilestoneFormChange({
                percentComplete: (event.target as HTMLInputElement).value,
              })}
        /></label>
      </div>
      <label
        >Blocker<textarea
          .value=${form.blocker}
          @input=${(event: Event) =>
            props.onMilestoneFormChange({ blocker: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <label
        >Implementation plan<textarea
          .value=${form.implementationPlan}
          @input=${(event: Event) =>
            props.onMilestoneFormChange({
              implementationPlan: (event.target as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
      <label
        >Acceptance criteria<textarea
          .value=${form.acceptanceCriteria}
          @input=${(event: Event) =>
            props.onMilestoneFormChange({
              acceptanceCriteria: (event.target as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
      <footer>
        <button
          class="btn pcc-action-primary pcc-editor-primary-action"
          type="submit"
          ?disabled=${props.actionBusy || !form.title.trim() || !form.projectId}
        >
          Save milestone
        </button>
        <button class="btn btn--subtle" type="button" @click=${props.onCancelEditor}>Cancel</button>
      </footer>
    </form>
  `;
}

function renderPccBusyFeedback(props: PccDashboardProps) {
  if (props.actionBusy) {
    const run = props.planningRun;
    if (run && (run.status === "queued" || run.status === "running")) {
      const stageText: Record<PccPlanningRun["stage"], string> = {
        preparing: "Preparing the planner",
        planner_running: `${run?.model.startsWith("ollama/") ? "Local AI" : "Codex"} is planning milestones and sub-steps`,
        validating: "Checking owners, proof, and dependencies",
        ready: "Preparing your review",
      };
      const modelLabel = run.model
        .replace(/^(?:openai|ollama)\//u, "")
        .replace(/^gpt-/u, "GPT-")
        .replace(/-sol$/u, " Sol");
      const effortLabel = `${run.effort.slice(0, 1).toUpperCase()}${run.effort.slice(1)} effort`;
      const started = Date.parse(run.startedAt ?? run.createdAt);
      const elapsedSeconds = Number.isFinite(started)
        ? Math.max(0, Math.round((Date.now() - started) / 1000))
        : 0;
      const activity =
        run.status === "queued"
          ? `Waiting for a planning slot${run.queuePosition ? ` · position ${run.queuePosition}` : ""}`
          : stageText[run.stage];
      return html`<div
        class="pcc-callout pcc-callout--busy pcc-planning-progress"
        data-pcc-planning-progress
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="pcc-planning-progress__indicator" aria-hidden="true"></div>
        <div>
          <strong
            >${run.status === "queued"
              ? "Your project plan is queued"
              : "Creating your project plan"}</strong
          >
          <span>${activity}</span>
          <small
            >${modelLabel} · ${effortLabel} · ${elapsedSeconds}s elapsed. You can leave this screen;
            PCC keeps the run record so you can reconnect.</small
          >
        </div>
        <button class="btn btn--subtle" type="button" @click=${() => props.onCancelProjectPlan?.()}>
          Cancel generation
        </button>
      </div>`;
    }
    return html`<div
      class="pcc-callout pcc-callout--busy"
      data-pcc-action-busy
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div>
        <strong>Saving PCC change</strong>
        <span>Writing the update and refreshing the project state.</span>
        <small
          >Controls are temporarily disabled so the ledger does not receive duplicate writes.</small
        >
      </div>
    </div>`;
  }
  return nothing;
}

function renderPccActionFeedback(props: PccDashboardProps) {
  if (props.actionError) {
    return html`${renderPccRecoveryCenter(props)}
      <div class="pcc-callout pcc-callout--danger" role="alert" data-pcc-action-error>
        <div>
          <strong>Action failed — nothing was saved</strong>
          <span>${props.actionError}</span>
          <small>Refresh to reload the latest PCC state, then retry the action.</small>
        </div>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.loading}
          @click=${props.onRefresh}
        >
          Retry refresh
        </button>
      </div>`;
  }
  if (props.actionNotice) {
    return html`<div class="pcc-callout pcc-callout--success" data-pcc-action-notice role="status">
      <div>
        <strong>Saved and refreshed</strong>
        <span>${props.actionNotice.text}</span>
        <small>PCC reloaded the project after this change.</small>
      </div>
      <div class="pcc-callout__actions">
        ${props.actionNotice.undoLabel && props.onUndoAction
          ? html`<button
              class="btn"
              type="button"
              data-pcc-action-undo
              ?disabled=${props.loading}
              @click=${() => props.onUndoAction?.()}
            >
              ${props.actionNotice.undoLabel}
            </button>`
          : nothing}
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.loading}
          @click=${props.onRefresh}
        >
          Refresh now
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onDismissActionNotice?.()}
        >
          Dismiss
        </button>
      </div>
    </div>`;
  }
  return renderPccBusyFeedback(props);
}

function renderProjectListEmptyState(
  props: PccDashboardProps,
  allProjects: readonly PccProjectSummary[],
  filteredByTabCount: number,
) {
  const selected = effectiveProjectFilter(props, allProjects);
  const searchActive = Boolean(props.projectSearchQuery?.trim());
  const needsYouCount = allProjects.filter((project) =>
    projectMatchesFilter(project, "needs_you"),
  ).length;
  const allCount = allProjects.length;
  const canShowNeedsYou = !searchActive && selected !== "needs_you" && needsYouCount > 0;
  const canShowAll = !searchActive && selected !== "all" && allCount > 0;
  return html`<div class="pcc-empty" data-pcc-empty data-pcc-project-empty-state=${selected}>
    <h3>
      ${searchActive
        ? "No matching projects"
        : allCount === 0
          ? "No projects yet"
          : "No projects in this view"}
    </h3>
    <p>
      ${searchActive
        ? "No projects match this search. Clear search or try another term."
        : allCount === 0
          ? "Create a new project to start building a plan."
          : canShowNeedsYou
            ? `${needsYouCount} project${needsYouCount === 1 ? "" : "s"} need your attention now. Switch to Needs You to see the most important work first.`
            : filteredByTabCount === 0
              ? "This tab is empty. Switch views to browse projects without changing their status."
              : "No projects match this filter. Use another tab or create a new project."}
    </p>
    ${canShowNeedsYou || canShowAll
      ? html`<div class="pcc-empty__actions" data-pcc-empty-actions>
          ${canShowNeedsYou
            ? html`<button
                class="btn"
                type="button"
                data-pcc-empty-show-needs-you
                @click=${() => props.onSetProjectFilter?.("needs_you")}
              >
                Show Needs You (${needsYouCount})
              </button>`
            : nothing}
          ${canShowAll
            ? html`<button
                class="btn btn--subtle"
                type="button"
                data-pcc-empty-show-all
                @click=${() => props.onSetProjectFilter?.("all")}
              >
                Show All (${allCount})
              </button>`
            : nothing}
        </div>`
      : nothing}
  </div>`;
}

type PccOverviewProject = PccOverviewGetResult["projects"][number];
type PccOverviewAttention = PccOverviewGetResult["attention"][number];

function pccSurface(props: PccDashboardProps): PccSurface {
  return props.surface ?? (props.projectDetail ? "project" : "overview");
}

function overviewProjects(props: PccDashboardProps): PccOverviewProject[] {
  if (props.overview?.projects) {
    return props.overview.projects;
  }
  return props.projects.map((project) => ({
    ...project,
    workState:
      isPccCompleteStatus(project.status) || project.status === "archived"
        ? "complete"
        : project.status === "blocked"
          ? "blocked"
          : project.status === "needs_approval"
            ? "needs_you"
            : "ready",
    activeAgentCount: 0,
  }));
}

function workStateLabel(state: PccOverviewProject["workState"]): string {
  return {
    needs_you: "Needs You",
    working: "Working",
    ready: "Ready",
    paused: "Paused",
    blocked: "Blocked",
    failed: "Failed",
    complete: "Complete",
  }[state];
}

function renderWorkOverviewNav(props: PccDashboardProps) {
  const surface = pccSurface(props);
  const items: Array<{ id: Exclude<PccSurface, "project">; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "projects", label: "Projects" },
    { id: "activity", label: "Activity" },
    { id: "system", label: "System" },
  ];
  return html`<nav class="pcc-work-nav" aria-label="Project Command Center">
    ${items.map(
      (item) => html`<button
        class=${surface === item.id ? "pcc-work-nav__item is-active" : "pcc-work-nav__item"}
        type="button"
        aria-current=${surface === item.id ? "page" : nothing}
        @click=${() => props.onSetSurface?.(item.id)}
      >
        ${item.label}
      </button>`,
    )}
  </nav>`;
}

function renderOverviewProjectCard(project: PccOverviewProject, props: PccDashboardProps) {
  const favorite = props.favorites?.includes(project.id) ?? false;
  const complete = project.milestoneCounts.complete;
  const total = project.milestoneCounts.total;
  return html`<article
    class="pcc-work-card pcc-work-card--project"
    data-pcc-overview-project=${project.id}
  >
    <header>
      <div>
        <span class="pcc-work-state pcc-work-state--${project.workState}">
          ${workStateLabel(project.workState)}
        </span>
        <h3>${project.title}</h3>
      </div>
      <button
        class=${favorite ? "pcc-favorite is-active" : "pcc-favorite"}
        type="button"
        aria-label=${favorite
          ? `Remove ${project.title} from favorites`
          : `Favorite ${project.title}`}
        aria-pressed=${favorite}
        @click=${() => props.onToggleFavorite?.(project.id)}
      >
        ${favorite ? "★" : "☆"}
      </button>
    </header>
    <div class="pcc-project-progress" aria-label=${`${project.percentComplete}% complete`}>
      <div>
        <strong>${Math.round(project.percentComplete)}%</strong>
        <span>${complete}/${total} milestones</span>
      </div>
      <progress max="100" value=${project.percentComplete}></progress>
    </div>
    <dl class="pcc-work-card__facts">
      <div>
        <dt>Now</dt>
        <dd>${project.currentMilestone ?? "Ready for the next step"}</dd>
      </div>
      <div>
        <dt>Next</dt>
        <dd>${project.nextAction ?? project.nextActions[0] ?? "Open project"}</dd>
      </div>
      ${project.activeAgentCount > 0
        ? html`<div>
            <dt>Agents</dt>
            <dd>${project.activeAgentCount} working now</dd>
          </div>`
        : nothing}
      ${project.blocker
        ? html`<div class="pcc-work-card__blocker">
            <dt>Blocked by</dt>
            <dd>${project.blocker}</dd>
          </div>`
        : nothing}
    </dl>
    <footer>
      <button
        class="btn pcc-action-primary"
        type="button"
        @click=${() => props.onSelectProject(project.id)}
      >
        Open project
      </button>
    </footer>
  </article>`;
}

function renderAttentionCard(item: PccOverviewAttention, props: PccDashboardProps) {
  return html`<article class="pcc-attention-row" data-pcc-attention=${item.id}>
    <div>
      <span>${item.kind === "permission" ? "Permission" : "Needs attention"}</span>
      <h3>${item.title}</h3>
      ${item.detail ? html`<p>${item.detail}</p>` : nothing}
    </div>
    <button
      class="btn pcc-action-primary"
      type="button"
      @click=${() => props.onOpenAttention?.(item.projectId, item.recordId)}
    >
      ${item.actionLabel}
    </button>
  </article>`;
}

function formatAgentElapsed(startedAt?: string): string {
  if (!startedAt) {
    return "Waiting";
  }
  const elapsed = Math.max(0, Date.now() - Date.parse(startedAt));
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 1 ? "Just started" : `${minutes}m elapsed`;
}

function renderWorkOverview(props: PccDashboardProps) {
  const overview = props.overview;
  const projects = overviewProjects(props);
  const activeProjects = projects.filter((project) => project.workState !== "complete");
  const attention = overview?.attention ?? [];
  const agents = overview?.activeAgents ?? [];
  const recent = props.recentProjectIds
    ?.map((id) => projects.find((project) => project.id === id))
    .filter((project): project is PccOverviewProject => Boolean(project));
  return html`<main class="pcc-work-overview" data-pcc-work-overview>
    ${attention.length
      ? html`<section
          class="pcc-work-section pcc-work-section--attention"
          aria-labelledby="pcc-needs-you-title"
        >
          <header>
            <div>
              <span>Needs You</span>
              <h2 id="pcc-needs-you-title">
                ${attention.length} item${attention.length === 1 ? "" : "s"} waiting
              </h2>
            </div>
          </header>
          <div class="pcc-attention-list">
            ${attention.map((item) => renderAttentionCard(item, props))}
          </div>
        </section>`
      : nothing}

    <section class="pcc-work-section" aria-labelledby="pcc-working-now-title">
      <header>
        <div>
          <span>Working Now</span>
          <h2 id="pcc-working-now-title">
            ${agents.length
              ? `${agents.length} active agent${agents.length === 1 ? "" : "s"}`
              : "No agents running"}
          </h2>
        </div>
        <span class="pcc-team-presence">${props.presence?.length ?? 0}/6 team members online</span>
      </header>
      ${agents.length
        ? html`<div class="pcc-agent-list">
            ${agents.map(
              (agent) => html`<button
                class="pcc-agent-row"
                type="button"
                @click=${() => props.onSelectProject(agent.projectId)}
              >
                <span class="pcc-agent-avatar" aria-hidden="true"
                  >${agent.agentName.slice(0, 1).toUpperCase()}</span
                >
                <span class="pcc-agent-row__body">
                  <strong>${agent.agentName}</strong>
                  <span>${agent.projectTitle} · ${agent.task}</span>
                </span>
                <span class="pcc-agent-row__status">
                  ${formatStatus(agent.status)} · ${formatAgentElapsed(agent.startedAt)}
                </span>
              </button>`,
            )}
          </div>`
        : html`<p class="pcc-work-empty">
            Start a ready project when you want agents to begin. PCC will show verified live work
            here.
          </p>`}
    </section>

    <section class="pcc-work-section" aria-labelledby="pcc-projects-title">
      <header>
        <div>
          <span>Active Projects</span>
          <h2 id="pcc-projects-title">
            ${activeProjects.length} project${activeProjects.length === 1 ? "" : "s"}
          </h2>
        </div>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetSurface?.("projects")}
        >
          View all
        </button>
      </header>
      ${activeProjects.length
        ? html`<div class="pcc-work-project-grid">
            ${activeProjects
              .slice(0, 8)
              .map((project) => renderOverviewProjectCard(project, props))}
          </div>`
        : html`<div class="pcc-work-empty pcc-work-empty--large">
            <h3>${projects.length ? "No active projects" : "No projects yet"}</h3>
            <p>
              ${projects.length
                ? "Open Projects to review completed work, or create something new."
                : "Create a project and PCC will keep its work, progress, agents, and next action together."}
            </p>
            <button
              class="btn pcc-action-primary"
              type="button"
              @click=${() => props.onOpenProjectEditor()}
            >
              New project
            </button>
          </div>`}
    </section>

    ${recent?.length
      ? html`<section class="pcc-recent-shortcuts" aria-label="Recently opened projects">
          <span>Recently opened</span>
          ${recent
            .slice(0, 4)
            .map(
              (project) => html`<button
                type="button"
                @click=${() => props.onSelectProject(project.id)}
              >
                ${project.title}
              </button>`,
            )}
        </section>`
      : nothing}

    <section
      class="pcc-work-section pcc-work-section--activity"
      aria-labelledby="pcc-recent-activity-title"
    >
      <header>
        <div>
          <span>Recent Activity</span>
          <h2 id="pcc-recent-activity-title">What changed</h2>
        </div>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetSurface?.("activity")}
        >
          See history
        </button>
      </header>
      <ol class="pcc-activity-list">
        ${(overview?.recentActivity ?? []).slice(0, 5).map(
          (activity) => html`<li>
            <button type="button" @click=${() => props.onSelectProject(activity.projectId)}>
              <strong>${activity.projectTitle}</strong>
              <span>${activity.actor} · ${activity.action}</span>
              <time>${formatUpdatedAt(Date.parse(activity.at))}</time>
            </button>
          </li>`,
        )}
      </ol>
    </section>

    <button class="pcc-system-pill" type="button" @click=${() => props.onSetSurface?.("system")}>
      <span
        class="pcc-system-pill__dot pcc-system-pill__dot--${overview?.system.status ??
        "unavailable"}"
      ></span>
      <strong>${overview?.system.label ?? "PCC status unavailable"}</strong>
      <span>System details</span>
    </button>
  </main>`;
}

function renderProjectsDirectory(props: PccDashboardProps) {
  const query = props.projectSearchQuery?.trim().toLowerCase() ?? "";
  const allProjects = overviewProjects(props);
  const selectedFilter = effectiveProjectFilter(props, allProjects);
  const filteredByStatus = allProjects.filter((project) =>
    projectMatchesFilter(project, selectedFilter),
  );
  const projects = filteredByStatus.filter((project) =>
    query
      ? projectMatchesSearch(
          project,
          query,
          props.projectDetails?.[project.id] ??
            (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined),
        )
      : true,
  );
  const favorites = new Set(props.favorites ?? []);
  projects.sort(
    (left, right) =>
      Number(favorites.has(right.id)) - Number(favorites.has(left.id)) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
  return html`<main class="pcc-work-overview" data-pcc-projects-directory>
    <section class="pcc-work-section">
      <header class="pcc-directory-header">
        <div>
          <span>Projects</span>
          <h2>Everything in one place</h2>
        </div>
        <label class="pcc-directory-search" data-pcc-project-search>
          <span class="pcc-sr-only">Search projects</span>
          <input
            type="search"
            placeholder="Search projects"
            .value=${props.projectSearchQuery ?? ""}
            @input=${(event: Event) =>
              props.onSetProjectSearchQuery?.((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </header>
      <div class="pcc-directory-controls">
        ${renderProjectFilterTabs(props, allProjects)}
        <div class="pcc-directory-result-count" role="status" aria-live="polite">
          <strong>${projects.length}</strong>
          <span>shown</span>
          ${query
            ? html`<button
                class="btn btn--subtle"
                type="button"
                aria-label="Clear search"
                @click=${() => props.onSetProjectSearchQuery?.("")}
              >
                Clear search
              </button>`
            : nothing}
        </div>
      </div>
      <div class="pcc-work-project-grid">
        ${projects.map((project) => renderOverviewProjectCard(project, props))}
      </div>
      ${projects.length === 0
        ? renderProjectListEmptyState(props, allProjects, filteredByStatus.length)
        : nothing}
    </section>
  </main>`;
}

function renderActivityDirectory(props: PccDashboardProps) {
  const activity = props.overview?.recentActivity ?? [];
  return html`<main class="pcc-work-overview" data-pcc-activity-directory>
    <section class="pcc-work-section">
      <header>
        <div>
          <span>Activity</span>
          <h2>Recent project changes</h2>
        </div>
      </header>
      <ol class="pcc-activity-list pcc-activity-list--full">
        ${activity.map(
          (item) => html`<li>
            <button type="button" @click=${() => props.onSelectProject(item.projectId)}>
              <strong>${item.projectTitle}</strong>
              <span
                >${item.actor} ·
                ${item.action}${item.progress == null
                  ? ""
                  : ` · ${Math.round(item.progress)}%`}</span
              >
              <time>${formatUpdatedAt(Date.parse(item.at))}</time>
            </button>
          </li>`,
        )}
      </ol>
    </section>
  </main>`;
}

function renderSystemOverview(props: PccDashboardProps) {
  const system = props.overview?.system;
  return html`<main class="pcc-work-overview" data-pcc-system-overview>
    <section class="pcc-work-section pcc-system-overview">
      <span
        class="pcc-system-pill__dot pcc-system-pill__dot--${system?.status ?? "unavailable"}"
      ></span>
      <div>
        <span>System</span>
        <h2>${system?.label ?? "PCC status unavailable"}</h2>
        <p>${system?.detail ?? "Project Command Center is serving the shared work ledger."}</p>
      </div>
      <button
        class="btn pcc-action-primary"
        type="button"
        @click=${() => props.onSelectProject("project-command-center")}
      >
        Open system record
      </button>
    </section>
    ${renderProductionTruthCard(props)}
  </main>`;
}

function renderProjectWorkspaceSurface(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return html`<main class="pcc-work-overview">
      <p class="pcc-work-empty">Loading project…</p>
    </main>`;
  }
  const activeAgents =
    props.overview?.activeAgents.filter((agent) => agent.projectId === detail.project.id).length ??
    0;
  const resolvedAction = resolvePccProjectAction(detail);
  const setupEvaluation = setupEvaluationForDetail(detail);
  const terminal = PROJECT_TERMINAL_STATUSES.has(detail.project.status);
  const primaryActionDisabled =
    props.actionBusy ||
    resolvedAction.primaryActionId === "no_action_required" ||
    (!terminal &&
      !projectIsOnHold(detail.project) &&
      !setupEvaluation.runnable &&
      !props.onPreviewSetupAutofill);
  return html`<main class="pcc-project-workspace" data-pcc-project-workspace>
    <header class="pcc-project-workspace__header">
      <button
        class="btn btn--subtle"
        type="button"
        @click=${() => props.onSetSurface?.("overview")}
      >
        ← Overview
      </button>
      <div>
        <h2>${detail.project.title}</h2>
        <span
          >${Math.round(detail.summary.percentComplete)}% complete ·
          ${formatStatus(detail.project.status)} · ${activeAgents}
          agent${activeAgents === 1 ? "" : "s"} working</span
        >
      </div>
      ${resolvedAction.primaryActionId !== "no_action_required"
        ? html`<div data-pcc-primary-action>
            <button
              class="btn pcc-action-primary"
              type="button"
              data-pcc-primary-action-id=${resolvedAction.primaryActionId}
              ?disabled=${primaryActionDisabled}
              @click=${(event: Event) =>
                runResolvedProjectPrimaryAction(
                  resolvedAction,
                  detail,
                  props,
                  event.currentTarget as HTMLElement,
                )}
            >
              ${projectActionLabel(resolvedAction, props.projectForm)}
            </button>
          </div>`
        : nothing}
    </header>
    <section class="pcc-project-workspace__body">
      ${renderProjectDetail({ ...props, viewMode: "detailed" })}
    </section>
  </main>`;
}

function renderLegacyPccDashboard(props: PccDashboardProps) {
  const scopedProjects = focusScopedProjectsForToday(props, props.projects);
  const selectedProjectSummary = props.projectDetail
    ? props.projects.find((project) => project.id === props.projectDetail?.project.id)
    : undefined;
  const selectedOutsideScope = Boolean(
    selectedProjectSummary &&
    props.projectDetail &&
    pccWorkScopeForProject(props.projectDetail.project) !== effectivePccFocusMode(props),
  );
  const allProjects =
    selectedOutsideScope &&
    selectedProjectSummary &&
    !scopedProjects.some((project) => project.id === selectedProjectSummary.id)
      ? [...scopedProjects, selectedProjectSummary]
      : scopedProjects;
  const selectedFilter = effectiveProjectFilter(props, allProjects);
  const filteredByTab = allProjects.filter((project) =>
    projectMatchesFilter(project, selectedFilter),
  );
  const filteredProjects = filteredByTab.filter((project) =>
    projectMatchesSearch(
      project,
      props.projectSearchQuery,
      props.projectDetails?.[project.id] ??
        (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined),
    ),
  );
  const projects =
    selectedOutsideScope &&
    selectedProjectSummary &&
    !filteredProjects.some((project) => project.id === selectedProjectSummary.id) &&
    projectMatchesSearch(
      selectedProjectSummary,
      props.projectSearchQuery,
      props.projectDetails?.[selectedProjectSummary.id] ?? props.projectDetail ?? undefined,
    )
      ? [...filteredProjects, selectedProjectSummary]
      : filteredProjects;
  const mode = pccViewMode(props);
  const deferTodayUntilAfterWorkspace = mode === "simple" && Boolean(props.projectDetail);
  const focusWorkspace = mode === "simple" && Boolean(props.projectDetail);
  return html`<section
    class="pcc-shell"
    data-pcc-shell
    data-pcc-product-focus=${effectivePccFocusMode(props)}
  >
    <header class="pcc-hero pcc-hero--compact">
      <div>
        <p class="pcc-kicker">Projects</p>
        <h2>Project Command Center</h2>
        <p class="pcc-hero__subtitle">PCC product status, project work, and safe next actions.</p>
      </div>
      <div class="pcc-hero__actions">
        <span class="pcc-updated">${formatUpdatedAt(props.updatedAt)}</span>
        ${renderViewModeSwitcher(props)}
        <button
          class="btn"
          type="button"
          data-pcc-new-project
          @click=${() => props.onOpenProjectEditor()}
        >
          New project
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.loading}
          @click=${props.onRefresh}
        >
          ${props.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
    ${props.error
      ? html`<div class="pcc-callout" role="alert">
          <strong>Project Command Center unavailable</strong><span>${props.error}</span>
        </div>`
      : nothing}
    ${props.editorMode === "create-project" || props.editorMode === "edit-project"
      ? nothing
      : renderPccActionFeedback(props)}
    ${props.loading && allProjects.length > 0 ? renderPccLoadingState() : nothing}
    ${renderPccOfflineState(props)}
    ${deferTodayUntilAfterWorkspace ? nothing : renderTodayView(props)}
    ${renderPccMobileCommandRail(props)} ${renderReleaseGovernance(props)}
    <div class=${focusWorkspace ? "pcc-layout pcc-layout--focus" : "pcc-layout"}>
      <section class="pcc-projects" data-pcc-mobile-section="projects" aria-label="Projects">
        ${renderProjectFocusBar(
          props,
          allProjects,
          projects.length,
          filteredByTab.length,
          selectedFilter,
        )}
        ${props.loading && projects.length === 0
          ? renderPccLoadingState()
          : !props.loading && projects.length === 0
            ? renderProjectListEmptyState(
                { ...props, projectFilter: selectedFilter },
                allProjects,
                filteredByTab.length,
              )
            : html`<section class="pcc-project-grid" aria-label="Project cards">
                ${repeat(
                  projects,
                  (project) => project.id,
                  (project) => renderProjectCard(project, props),
                )}
              </section>`}
      </section>
      <section class="pcc-workspace" data-pcc-selected-project-workspace>
        ${renderProjectDetail(props)}
        ${mode === "simple" ? nothing : renderPortfolioWorkConsole(props)}
      </section>
    </div>
    ${deferTodayUntilAfterWorkspace
      ? html`<div class="pcc-today-slot pcc-today-slot--after-workspace">
          ${renderTodayView(props)}
        </div>`
      : nothing}
    ${mode === "simple"
      ? nothing
      : html`<details class="pcc-detail-drawer pcc-needs-attention-drawer">
          <summary>Needs You list</summary>
          ${renderNeedsAttentionNow(props)}
        </details>`}
    ${mode === "simple"
      ? nothing
      : html`<details class="pcc-detail-drawer pcc-top-proof-drawer">
          <summary>Needs You details</summary>
          ${renderImpactAttentionInbox(props)}
        </details>`}
    ${mode === "simple"
      ? renderUpdateSafetyDrawer(props)
      : html`${renderProductionTruthDrawer(props)} ${renderUpdateSafetyDrawer(props)}
        ${renderRecentActivityFeed(props)}`}
    ${props.editorMode === "create-project" || props.editorMode === "edit-project"
      ? renderProjectEditor(props)
      : nothing}
    ${props.editorMode === "create-milestone" || props.editorMode === "edit-milestone"
      ? renderMilestoneEditor(props)
      : nothing}
  </section>`;
}

export function renderPccDashboard(props: PccDashboardProps) {
  if (props.surface === undefined) {
    return renderLegacyPccDashboard(props);
  }
  const surface = pccSurface(props);
  return html`
    <section
      class="pcc-shell pcc-shell--work-overview"
      data-pcc-shell
      data-pcc-surface=${surface}
      data-pcc-contract-version=${PCC_BROWSER_CONTRACT_VERSION}
      data-pcc-ready=${props.error
        ? "error"
        : props.loading
          ? "loading"
          : props.overview
            ? "ready"
            : "loading"}
      data-pcc-ledger-revision=${props.overview?.ledgerRevision ?? ""}
    >
      <header class="pcc-work-hero">
        <div>
          <p class="pcc-kicker">Project Command Center</p>
          <h1>
            ${surface === "overview"
              ? "Your work"
              : surface === "project"
                ? "Project"
                : surface[0]!.toUpperCase() + surface.slice(1)}
          </h1>
          <p>See what needs you, what agents are doing, and what happens next.</p>
        </div>
        <div class="pcc-work-hero__actions">
          <span class="pcc-updated">${formatUpdatedAt(props.updatedAt)}</span>
          <button
            class="btn pcc-action-primary"
            type="button"
            data-pcc-new-project
            @click=${() => props.onOpenProjectEditor()}
          >
            New project
          </button>
          <button
            class="btn btn--subtle"
            type="button"
            ?disabled=${props.loading}
            @click=${props.onRefresh}
          >
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      ${renderWorkOverviewNav(props)}
      ${props.error
        ? html`<div class="pcc-callout" role="alert">
            <strong>Project Command Center unavailable</strong><span>${props.error}</span>
          </div>`
        : nothing}
      ${props.editorMode === "create-project" || props.editorMode === "edit-project"
        ? nothing
        : renderPccActionFeedback(props)}
      ${renderPccOfflineState(props)}
      ${props.loading && !props.overview
        ? renderPccLoadingState()
        : surface === "overview"
          ? renderWorkOverview(props)
          : surface === "projects"
            ? renderProjectsDirectory(props)
            : surface === "activity"
              ? renderActivityDirectory(props)
              : surface === "system"
                ? renderSystemOverview(props)
                : renderProjectWorkspaceSurface(props)}
      ${props.editorMode === "create-project" || props.editorMode === "edit-project"
        ? renderProjectEditor(props)
        : nothing}
      ${props.editorMode === "create-milestone" || props.editorMode === "edit-milestone"
        ? renderMilestoneEditor(props)
        : nothing}
    </section>
  `;
}

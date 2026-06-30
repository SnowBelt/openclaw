// Control UI view renders the Project Command Center dashboard and CRUD shell.
import { html, nothing } from "lit";
import {
  evaluatePccProjectSetup,
  PCC_REQUIRED_INTAKE_QUESTIONS,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
} from "../../../../src/pcc/intake-quality.js";
import { buildPccPortfolioSchedule } from "../../../../src/pcc/portfolio-scheduler.js";
import { buildPccProductionTruth } from "../../../../src/pcc/production-truth.js";
import { PCC_WORKFLOW_TEMPLATES } from "../../../../src/pcc/project-workflows.js";
import {
  getPccWorkLoopNext,
  getPccWorkLoopSettings,
  type PccParallelWorkMode,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import type {
  PccEditorMode,
  PccMilestoneFormState,
  PccProjectDetail,
  PccProjectFormState,
  PccViewMode,
} from "../controllers/pcc.ts";
import type { PccChatSyncProposal } from "../pcc-chat-sync.ts";
import { buildPccContextPackage, type PccContextPackageMode } from "../pcc-context-package.ts";
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

export type PccDashboardProps = {
  loading: boolean;
  error: string | null;
  projects: PccProjectSummary[];
  portfolio: PccPortfolioSummary | null;
  updatedAt: number | null;
  selectedProjectId: string | null;
  projectDetail: PccProjectDetail | null;
  projectDetails?: Record<string, PccProjectDetail>;
  actionBusy: boolean;
  actionError: string | null;
  editorMode: PccEditorMode;
  projectForm: PccProjectFormState;
  milestoneForm: PccMilestoneFormState;
  chatSyncText: string;
  chatSyncProposals: PccChatSyncProposal[];
  chatSyncError: string | null;
  viewMode?: PccViewMode;
  onSetViewMode?: (mode: PccViewMode) => void;
  onRefresh: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectEditor: (project?: PccProject) => void;
  onOpenMilestoneEditor: (milestone?: PccMilestone) => void;
  onProjectFormChange: (patch: Partial<PccProjectFormState>) => void;
  onMilestoneFormChange: (patch: Partial<PccMilestoneFormState>) => void;
  onSaveProject: () => void;
  onSaveMilestone: () => void;
  onCancelEditor: () => void;
  onSetProjectStatus: (project: PccProject, status: PccStatus) => void;
  onSetMilestoneStatus: (milestone: PccMilestone, status: PccStatus) => void;
  onSetMilestoneStopHere: (milestone: PccMilestone, stopHere: boolean) => void;
  onAddCompletionReceipt: (milestone: PccMilestone) => void;
  onSetPermissionStatus: (permission: PccPermissionGrant, status: PccPermissionStatus) => void;
  onUpdateWorkLoop: (patch: Partial<PccWorkLoopSettings>) => void;
  onPrepareNextWorkItem: () => void;
  onChatSyncTextChange: (text: string) => void;
  onPreviewChatSync: () => void;
  onApplyChatSyncProposal: (proposal: PccChatSyncProposal) => void;
  onDismissChatSync: () => void;
};

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

const PLANNING_MODE_OPTIONS = [
  ["template_only", "Use template only"],
  ["local_project_manager", "Ask local Project Manager"],
  ["codex_full_plan", "Ask Codex for full plan"],
] as const;

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
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatUpdatedAt(value: number | null): string {
  if (!value) {
    return "Not loaded yet";
  }
  return `Updated ${new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function confirmAction(message: string): boolean {
  return globalThis.confirm?.(message) ?? true;
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
        title=${title}
        aria-pressed=${mode === value}
        data-pcc-view-mode-option=${value}
        @click=${() => props.onSetViewMode?.(value)}
      >
        <strong>${label}</strong>
        <span>${title}</span>
      </button>`,
    )}
  </div>`;
}

function scrollPccDetailIntoView(): void {
  globalThis.document
    ?.querySelector("[data-pcc-detail], [data-pcc-project-card]")
    ?.scrollIntoView?.({ block: "nearest" });
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

function renderProductionTruthCard(props: PccDashboardProps) {
  const detail = props.projectDetail;
  const truth = buildPccProductionTruth({
    project: detail?.project,
    milestones: detail?.milestones ?? [],
    evidence: detail?.evidence ?? [],
    receipts: detail?.receipts ?? [],
  });
  return html`<section
    class="pcc-production-truth pcc-production-truth--${truth.status}"
    data-pcc-production-truth
    aria-label="Production truth"
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Production truth</p>
        <h4>Is this dashboard current?</h4>
        <p>
          ${truth.status === "current"
            ? "Remote proof, runtime proof, and receipts are recorded."
            : "Open proof gaps before claiming production completion."}
        </p>
      </div>
      <span>${truth.label}</span>
    </div>
    <dl class="pcc-production-truth__facts">
      <div>
        <dt>Verified SHA</dt>
        <dd>${truth.latestVerifiedSha.slice(0, 12)}</dd>
      </div>
      <div>
        <dt>Runtime SHA</dt>
        <dd>${truth.runtimeSha ? truth.runtimeSha.slice(0, 12) : "Not recorded"}</dd>
      </div>
      <div>
        <dt>Remote proof</dt>
        <dd>${truth.remoteProofPassed ? "Passed" : "Missing"}</dd>
      </div>
      <div>
        <dt>Runtime proof</dt>
        <dd>${truth.runtimeProofPassed ? "Passed" : "Missing"}</dd>
      </div>
      <div>
        <dt>Browser proof</dt>
        <dd>${truth.browserProofScreenshotPath ?? "No screenshot recorded"}</dd>
      </div>
    </dl>
    <details class="pcc-production-truth__ledger">
      <summary>Proof ledger and do-not-redo notes</summary>
      <div>
        <strong>Proof gaps</strong>
        ${truth.proofGaps.length
          ? html`<ul>
              ${truth.proofGaps.slice(0, 8).map((gap) => html`<li>${gap}</li>`)}
            </ul>`
          : html`<p>No proof gaps recorded.</p>`}
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

function setupEvaluationForDetail(detail: PccProjectDetail) {
  return evaluatePccProjectSetup({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
  });
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
): Promise<void> {
  await globalThis.navigator?.clipboard?.writeText(buildPccContextPackage(detail, { mode }));
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
          class="btn"
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

function renderReceiptCard(receipt: PccCompletionReceipt, evidence: PccEvidence[]) {
  const proofItems = evidence.filter((item) => receipt.proofEvidenceIds.includes(item.id));
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
          <dd>
            ${receipt.proofEvidenceIds.length}
            item${receipt.proofEvidenceIds.length === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt>By</dt>
          <dd>${receipt.completedBy || "Not recorded"}</dd>
        </div>
      </dl>
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
      ${receipt.doNotRedo?.length
        ? html`<div class="pcc-receipt__note">
            <strong>Do not redo</strong>
            <ul>
              ${receipt.doNotRedo.map((note) => html`<li>${note}</li>`)}
            </ul>
          </div>`
        : nothing}
      ${receipt.followUpGaps?.length
        ? html`<div class="pcc-receipt__note">
            <strong>Follow-up gaps</strong>
            <ul>
              ${receipt.followUpGaps.map((gap) => html`<li>${gap}</li>`)}
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
  const nextAction = project.nextActions[0] ?? "No next action recorded";
  const proofGap = project.proofGaps[0] ?? "No proof gaps recorded";
  const selected = project.id === props.selectedProjectId;
  return html`
    <article class="pcc-project-card ${selected ? "is-selected" : ""}" data-pcc-project-card>
      <div class="pcc-project-card__topline">
        <div>
          <h3>${project.title}</h3>
          <p>${nextAction}</p>
        </div>
        <span class="pcc-status pcc-status--${project.status}"
          >${formatStatus(project.status)}</span
        >
      </div>
      <div class="pcc-progress" aria-label=${`${project.title} ${percent}% complete`}>
        <span class="pcc-progress__bar" style=${`width:${percent}%`}></span>
      </div>
      <div class="pcc-project-card__meta">
        <span>${percent}% complete</span>
        <span>${project.milestoneCounts.complete}/${project.milestoneCounts.total} milestones</span>
        <span>${project.milestoneCounts.blocked} blocked</span>
        <span>${project.milestoneCounts.needsApproval} needs approval</span>
      </div>
      <div class="pcc-project-card__proof">
        <span class="pcc-project-card__label">Proof gap</span>
        <span>${proofGap}</span>
      </div>
      <div class="pcc-project-card__proof">
        <span class="pcc-project-card__label">Work</span>
        <span
          >${getPccWorkLoopSettings(project as unknown as PccProject).enabled
            ? formatStatus(getPccWorkLoopSettings(project as unknown as PccProject).state)
            : "Off"}</span
        >
      </div>
      <button
        class="btn btn--subtle"
        type="button"
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

function itemWorkerLabel(item: PccMilestone | PccSubMilestone): string {
  const metadata = metadataObject(item.metadata);
  return responsibilityLabel(
    metadataString(metadata.pccResponsibility, item.owner || "local_openclaw_agent"),
  );
}

function itemProofLabel(item: PccMilestone | PccSubMilestone): string {
  return metadataString(metadataObject(item.metadata).proofRequired, "Proof not recorded");
}

function milestoneStopsHere(milestone: PccMilestone): boolean {
  return metadataObject(milestone.metadata).pccStopHere === true;
}

function renderTodayItem(label: string, title: string, detail: string, action?: () => void) {
  return html`<li class="pcc-today__item">
    <button class="pcc-today__button" type="button" ?disabled=${!action} @click=${() => action?.()}>
      <span>${label}</span>
      <strong>${title}</strong>
      <em>${detail}</em>
    </button>
  </li>`;
}

function renderTodayView(props: PccDashboardProps) {
  const working = props.projects
    .filter((project) => ["in_progress", "active"].includes(project.status))
    .slice(0, 5);
  const needsYou = props.projects
    .filter(
      (project) => project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0,
    )
    .slice(0, 5);
  const blocked = props.projects
    .filter((project) => project.status === "blocked" || project.milestoneCounts.blocked > 0)
    .slice(0, 5);
  const readyNext = props.projects
    .filter((project) => project.nextActions.length > 0 && project.status !== "blocked")
    .slice(0, 5);
  const completed = props.projects
    .filter((project) => ["complete", "complete_with_maintenance"].includes(project.status))
    .slice(0, 5);
  const renderProjectItems = (items: PccProjectSummary[], empty: string, label: string) =>
    items.length
      ? html`<ul>
          ${items.map((project) =>
            renderTodayItem(
              label,
              project.title,
              project.nextActions[0] ?? formatStatus(project.status),
              () => props.onSelectProject(project.id),
            ),
          )}
        </ul>`
      : html`<p>${empty}</p>`;
  return html`<section class="pcc-today" data-pcc-today aria-label="Today">
    <div class="pcc-section-heading">
      <div>
        <h3>Today</h3>
        <p>What is working, waiting, blocked, and ready next.</p>
      </div>
      <span>${formatUpdatedAt(props.updatedAt)}</span>
    </div>
    <div class="pcc-today__grid">
      <article>
        <strong>Working now</strong>
        ${renderProjectItems(working, "No active project work right now.", "Working")}
      </article>
      <article>
        <strong>Needs you</strong>
        ${renderProjectItems(needsYou, "No projects need you right now.", "Needs you")}
      </article>
      <article>
        <strong>Blocked</strong>
        ${renderProjectItems(blocked, "No blocked work.", "Blocked")}
      </article>
      <article>
        <strong>Ready next</strong>
        ${renderProjectItems(readyNext, "No ready local-safe work.", "Ready")}
      </article>
      <article>
        <strong>Recently completed</strong>
        ${renderProjectItems(completed, "No recently completed projects.", "Done")}
      </article>
    </div>
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
      activeLocalModelProcesses: 0,
      activeOpenClawTasks: 0,
      activeCodexNeededTasks: 0,
      blockedTasks: 0,
      activeWorkspaceLocks: [],
    },
  );
  return html`<section
    class="pcc-portfolio-console"
    data-pcc-portfolio-console
    aria-label="Multi-project work console"
  >
    <div class="pcc-section-heading">
      <div>
        <h4>Multi-project work console</h4>
        <p>
          Shows what can run now across projects without Codex, remote proof, or resource conflicts.
        </p>
      </div>
      <span>${schedule.ready.length} ready</span>
    </div>
    <div class="pcc-portfolio-console__controls">
      <button class="btn btn--subtle" type="button" disabled>Work Ready Projects</button>
      <button class="btn btn--subtle" type="button" disabled>Pause All</button>
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
  </section>`;
}

function renderCurrentTruthAndReadyQueue(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return nothing;
  }
  const setupEvaluation = setupEvaluationForDetail(detail);
  const settings = getPccWorkLoopSettings(detail.project);
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

function renderWorkLoopCard(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return nothing;
  }
  const setupEvaluation = setupEvaluationForDetail(detail);
  const settings = getPccWorkLoopSettings(detail.project);
  const next = getPccWorkLoopNext({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const workLabel = settings.enabled ? formatStatus(next.state) : "Off";
  const nextTitle = next.subMilestone
    ? `${next.milestone?.title ?? "Milestone"}: ${next.subMilestone.title}`
    : (next.milestone?.title ?? "No eligible milestone");
  const message = projectIsTerminal(detail.project)
    ? "Project is complete or archived; reopen it before starting new work."
    : !setupEvaluation.runnable
      ? `Setup quality gate is ${setupEvaluation.badge.toLowerCase()}; fix intake, workflow, sub-milestones, owners, and proof before starting.`
      : (next.blocker?.message ?? settings.lastLoopMessage ?? "Ready for the next safe milestone.");
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
        <span class="pcc-status pcc-work-loop-state--${settings.enabled ? next.state : "idle"}">
          ${workLabel}
        </span>
      </div>
      <div class="pcc-work-loop__controls">
        <button
          class="btn"
          type="button"
          ?disabled=${props.actionBusy ||
          projectIsTerminal(detail.project) ||
          (!settings.enabled && !setupEvaluation.runnable)}
          @click=${() =>
            props.onUpdateWorkLoop({
              enabled: !settings.enabled,
              state: settings.enabled ? "idle" : "working",
            })}
        >
          ${settings.enabled ? "Turn off" : "Work This Project"}
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy}
          @click=${() => props.onUpdateWorkLoop({ state: "paused", enabled: true })}
        >
          Pause
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${props.actionBusy || !setupEvaluation.runnable}
          @click=${props.onPrepareNextWorkItem}
        >
          Prepare next safe task
        </button>
      </div>
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
                parallelWorkMode: (event.target as HTMLSelectElement).value as PccParallelWorkMode,
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
      <div class="pcc-work-loop__next">
        <span>Next</span>
        <strong>${nextTitle}</strong>
        <p>${message}</p>
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

function renderProjectDetail(props: PccDashboardProps) {
  const detail = props.projectDetail;
  const mode = pccViewMode(props);
  if (!detail) {
    return html`
      <aside class="pcc-detail" data-pcc-detail-empty>
        <h3>Select a project</h3>
        <p>Open a project to manage its milestones, status, plan, and proof gaps.</p>
      </aside>
    `;
  }
  const project = detail.project;
  const permissions = detail.permissions ?? [];
  return html`
    <aside class="pcc-detail pcc-detail--${mode}" data-pcc-detail data-pcc-detail-mode=${mode}>
      <div class="pcc-detail__header">
        <div>
          <p class="pcc-kicker">Selected project</p>
          <h3>${project.title}</h3>
          <p>${project.goal || "No project goal recorded yet."}</p>
        </div>
        <span class="pcc-status pcc-status--${project.status}"
          >${formatStatus(project.status)}</span
        >
      </div>
      <div class="pcc-detail__actions">
        <button class="btn" type="button" @click=${() => props.onOpenProjectEditor(project)}>
          Edit project
        </button>
        <button class="btn btn--subtle" type="button" @click=${() => props.onOpenMilestoneEditor()}>
          New milestone
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
              @click=${() => {
                if (confirmAction("Archive this project?")) {
                  props.onSetProjectStatus(project, "archived");
                }
              }}
            >
              Archive
            </button>`}
      </div>
      ${renderWorkflowQualityCard(detail)} ${renderNextSafeActionCard(props)}
      ${renderCurrentTruthAndReadyQueue(props)}
      ${mode === "simple"
        ? html`<p class="pcc-simple-hint">
            Switch to Detailed or Agent when you need plans, receipts, permissions, or handoff
            packets.
          </p>`
        : html`
            ${renderWorkLoopCard(props)}
            <details class="pcc-detail-drawer" ?open=${mode === "agent" || mode === "detailed"}>
              <summary>Milestones</summary>
              ${renderPhaseOverview(detail)}
              <section class="pcc-milestones" aria-label="Project milestones">
                ${detail.milestones.length === 0
                  ? html`<div class="pcc-empty pcc-empty--small">No milestones yet</div>`
                  : detail.milestones.map((milestone) => renderMilestoneCard(milestone, props))}
              </section>
            </details>
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
              <summary>Handoff and chat sync</summary>
              ${renderContextPackageCard(detail)} ${renderChatSyncCard(props)}
            </details>
            ${mode === "agent"
              ? html`<section class="pcc-agent-panel" data-pcc-agent-mode>
                  <p class="pcc-kicker">Agent view</p>
                  <h4>Low-reasoning execution details</h4>
                  <p>
                    Implementation plans, acceptance criteria, blockers, permissions, receipts, and
                    context packets are expanded for handoff.
                  </p>
                </section>`
              : nothing}
          `}
    </aside>
  `;
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
        @click=${() => void copyPccContextPackage(detail, "compact")}
      >
        Copy next step
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-copy-context="full"
        @click=${() => void copyPccContextPackage(detail, "full")}
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
      @click=${() => {
        if (!proposal.risky || confirmAction("Apply this chat-suggested PCC update?")) {
          props.onApplyChatSyncProposal(proposal);
        }
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
        <h4>Suggested updates from chat</h4>
        <p>Paste an OpenClaw or Codex plan. PCC previews safe diffs before anything changes.</p>
      </div>
      <span>${props.chatSyncProposals.length} suggested</span>
    </div>
    <textarea
      class="pcc-chat-sync__input"
      placeholder="Paste a proposed plan, status summary, proof receipt, or permission request"
      .value=${props.chatSyncText}
      @input=${(event: Event) =>
        props.onChatSyncTextChange((event.target as HTMLTextAreaElement).value)}
    ></textarea>
    <div class="pcc-context-package__actions">
      <button class="btn" type="button" @click=${props.onPreviewChatSync}>
        Review chat updates
      </button>
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

function renderSubMilestoneList(milestone: PccMilestone, props: PccDashboardProps) {
  const subMilestones = subMilestonesForMilestone(props.projectDetail, milestone);
  if (subMilestones.length === 0) {
    return html`<div class="pcc-empty pcc-empty--small">No sub-milestones recorded</div>`;
  }
  return html`<ol class="pcc-submilestones" data-pcc-submilestones>
    ${subMilestones.map((subMilestone) => {
      const percent = subMilestoneDisplayPercent(subMilestone);
      return html`<li class="pcc-submilestone" data-pcc-submilestone>
        <div class="pcc-submilestone__main">
          <span class="pcc-submilestone__check" aria-hidden="true">
            ${subMilestone.status === "complete" ||
            subMilestone.status === "complete_with_maintenance"
              ? "✓"
              : ""}
          </span>
          <div>
            <strong>${subMilestone.title}</strong>
            <p>${subMilestone.implementationPlan || "No implementation plan recorded."}</p>
          </div>
          <span class="pcc-status pcc-status--${subMilestone.status}"
            >${formatStatus(subMilestone.status)}</span
          >
        </div>
        <div class="pcc-project-card__meta">
          <span>${percent}% complete</span>
          <span>Worker ${itemWorkerLabel(subMilestone)}</span>
          <span>${itemProofLabel(subMilestone)}</span>
          <span>${subMilestone.acceptanceCriteria?.length ?? 0} criteria</span>
        </div>
        ${subMilestone.blocker
          ? html`<p class="pcc-submilestone__blocker">${subMilestone.blocker}</p>`
          : nothing}
      </li>`;
    })}
  </ol>`;
}

function renderMilestoneCard(milestone: PccMilestone, props: PccDashboardProps) {
  const percent = clampPercent(milestone.percentComplete ?? 0);
  const metadata = metadataObject(milestone.metadata);
  const responsibility = metadataString(metadata.pccResponsibility, "local_openclaw_agent");
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
        <span>Worker ${responsibilityLabel(responsibility)}</span>
        <span>Risk ${formatStatus(costRisk)}</span>
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
          @click=${() => {
            if (confirmAction("Skip this milestone?")) {
              props.onSetMilestoneStatus(milestone, "skipped");
            }
          }}
        >
          Skip
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          @click=${() => props.onSetMilestoneStatus(milestone, "reopened")}
        >
          Reopen
        </button>
        <button
          class="btn btn--subtle"
          type="button"
          ?disabled=${!canComplete}
          title=${canComplete ? "Mark complete" : "Completion receipt required"}
          @click=${() => {
            if (canComplete && confirmAction("Mark this milestone complete?")) {
              props.onSetMilestoneStatus(milestone, "complete");
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
  return html`<section class="pcc-intake-wizard" data-pcc-intake-wizard>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Project intake</p>
        <h4>Make this project runnable</h4>
        <p>Required answers keep PCC from generating vague milestones.</p>
      </div>
      <span class="pcc-status">${missing.length ? `${missing.length} missing` : "Answered"}</span>
    </div>
    <div class="pcc-intake-wizard__questions">
      ${PCC_REQUIRED_INTAKE_QUESTIONS.map((question) => {
        const value = form.intakeAnswers[question.id] ?? "";
        return html`<label>
          ${question.label}
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
            ? "Complete every intake answer before saving."
            : "Approve the intake brief before saving."}
        </p>`
      : nothing}
  </section>`;
}

function renderProjectEditor(props: PccDashboardProps) {
  const form = props.projectForm;
  const missingIntake = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
  const projectSaveBlocked = missingIntake.length > 0 || !form.intakeApproved;
  return html`
    <form
      class="pcc-editor"
      data-pcc-editor="project"
      @submit=${(event: Event) => {
        event.preventDefault();
        props.onSaveProject();
      }}
    >
      <header>
        <p class="pcc-kicker">Project</p>
        <h3>${props.editorMode === "edit-project" ? "Edit project" : "Create project"}</h3>
      </header>
      <label
        >Title<input
          required
          .value=${form.title}
          @input=${(event: Event) =>
            props.onProjectFormChange({ title: (event.target as HTMLInputElement).value })}
      /></label>
      <label
        >Goal<textarea
          .value=${form.goal}
          @input=${(event: Event) =>
            props.onProjectFormChange({ goal: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <label
        >Status<select
          .value=${form.status}
          @change=${(event: Event) =>
            props.onProjectFormChange({
              status: (event.target as HTMLSelectElement).value as PccStatus,
            })}
        >
          ${renderStatusOptions(PROJECT_STATUSES)}
        </select></label
      >
      <label
        >Priority<input
          type="number"
          min="0"
          max="5"
          .value=${form.priority}
          @input=${(event: Event) =>
            props.onProjectFormChange({ priority: (event.target as HTMLInputElement).value })}
      /></label>
      <label
        >Workflow template<select
          .value=${form.workflowTemplateId}
          @change=${(event: Event) =>
            props.onProjectFormChange({
              workflowTemplateId: (event.target as HTMLSelectElement).value,
            })}
        >
          ${PCC_WORKFLOW_TEMPLATES.map(
            (template) => html`<option value=${template.id}>${template.title}</option>`,
          )}
        </select></label
      >
      ${renderProjectIntakeWizard(props)}
      <label
        >Planning mode<select
          .value=${form.planningMode}
          @change=${(event: Event) =>
            props.onProjectFormChange({
              planningMode: (event.target as HTMLSelectElement)
                .value as PccProjectFormState["planningMode"],
            })}
        >
          ${renderStringOptions(PLANNING_MODE_OPTIONS, form.planningMode)}
        </select></label
      >
      ${form.planningMode === "codex_full_plan" && !form.codexPlanningAllowed
        ? html`<div class="pcc-callout" data-pcc-codex-planning-gate>
            <strong>Codex planning is permission-gated</strong>
            <span
              >Save will create a scoped permission request instead of spending Codex tokens.</span
            >
          </div>`
        : form.planningMode === "local_project_manager"
          ? html`<div class="pcc-callout" data-pcc-project-manager-intake>
              <strong>Project Manager review</strong>
              <span
                >OpenClaw will use the template, then queue a local review before execution.</span
              >
            </div>`
          : nothing}
      <div class="pcc-intake-options" data-pcc-workflow-intake>
        <label>
          <input
            type="checkbox"
            .checked=${form.codexPlanningAllowed}
            @change=${(event: Event) =>
              props.onProjectFormChange({
                codexPlanningAllowed: (event.target as HTMLInputElement).checked,
              })}
          />
          Allow Codex to design/refine milestones
        </label>
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
      <footer>
        <button
          class="btn"
          type="submit"
          ?disabled=${props.actionBusy || !form.title.trim() || projectSaveBlocked}
        >
          Save project
        </button>
        <button class="btn btn--subtle" type="button" @click=${props.onCancelEditor}>Cancel</button>
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
      @submit=${(event: Event) => {
        event.preventDefault();
        props.onSaveMilestone();
      }}
    >
      <header>
        <p class="pcc-kicker">Milestone</p>
        <h3>${props.editorMode === "edit-milestone" ? "Edit milestone" : "Create milestone"}</h3>
      </header>
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
          class="btn"
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

export function renderPccDashboard(props: PccDashboardProps) {
  const portfolio = props.portfolio;
  const projects = props.projects;
  const mode = pccViewMode(props);
  return html`
    <section class="pcc-shell" data-pcc-shell>
      <header class="pcc-hero">
        <div>
          <p class="pcc-kicker">Projects</p>
          <h2>Project Command Center</h2>
          <p class="pcc-hero__subtitle">
            A calm source of truth for milestones, next actions, proof gaps, and completion status.
          </p>
        </div>
        <div class="pcc-hero__actions">
          <span class="pcc-updated">${formatUpdatedAt(props.updatedAt)}</span>
          ${renderViewModeSwitcher(props)}
          <button class="btn" type="button" @click=${() => props.onOpenProjectEditor()}>
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
      ${props.actionError
        ? html`<div class="pcc-callout" role="alert">
            <strong>Action failed</strong><span>${props.actionError}</span>
          </div>`
        : nothing}
      ${mode === "simple" ? nothing : renderProductionTruthCard(props)} ${renderTodayView(props)}
      ${mode === "simple" ? nothing : renderPortfolioWorkConsole(props)}

      <section class="pcc-metrics" aria-label="Project Command Center summary">
        ${renderMetric("Total projects", portfolio?.projectsTotal ?? projects.length)}
        ${renderMetric("Active", portfolio?.active ?? 0)}
        ${renderMetric("Blocked", portfolio?.blocked ?? 0)}
        ${renderMetric("Needs approval", portfolio?.needsApproval ?? 0)}
        ${renderMetric(
          "Average completion",
          `${clampPercent(portfolio?.averagePercentComplete ?? 0)}%`,
        )}
      </section>

      <div class="pcc-layout">
        <section class="pcc-projects" aria-label="Projects">
          ${!props.loading && projects.length === 0
            ? html`<div class="pcc-empty" data-pcc-empty>
                <h3>No projects yet</h3>
                <p>
                  Project plans will appear here when OpenClaw records them in the Project Command
                  Center.
                </p>
              </div>`
            : html`<section class="pcc-project-grid" aria-label="Project cards">
                ${projects.map((project) => renderProjectCard(project, props))}
              </section>`}
        </section>
        ${renderProjectDetail(props)}
      </div>

      ${props.editorMode === "create-project" || props.editorMode === "edit-project"
        ? renderProjectEditor(props)
        : nothing}
      ${props.editorMode === "create-milestone" || props.editorMode === "edit-milestone"
        ? renderMilestoneEditor(props)
        : nothing}
    </section>
  `;
}

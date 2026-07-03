// Control UI view renders the Project Command Center dashboard and CRUD shell.
import { html, nothing } from "lit";
import {
  buildPccAttentionInbox,
  buildPccDependencyInsights,
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
import { buildPccPortfolioSchedule } from "../../../../src/pcc/portfolio-scheduler.js";
import { buildPccProductionTruth } from "../../../../src/pcc/production-truth.js";
import {
  buildPccWorkflowDraft,
  PCC_WORKFLOW_TEMPLATES,
} from "../../../../src/pcc/project-workflows.js";
import {
  getPccWorkLoopNext,
  getPccWorkLoopSettings,
  type PccParallelWorkMode,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import type {
  PccActionNotice,
  PccAutofillPreview,
  PccEditorMode,
  PccMilestoneFormState,
  PccProjectDetail,
  PccPlannerMode,
  PccProjectFilter,
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
  actionNotice?: PccActionNotice | null;
  projectFilter?: PccProjectFilter;
  projectSearchQuery?: string;
  editorMode: PccEditorMode;
  projectForm: PccProjectFormState;
  milestoneForm: PccMilestoneFormState;
  autofillPreview?: PccAutofillPreview | null;
  chatSyncText: string;
  chatSyncProposals: PccChatSyncProposal[];
  chatSyncError: string | null;
  viewMode?: PccViewMode;
  onSetViewMode?: (mode: PccViewMode) => void;
  onSetProjectFilter?: (filter: PccProjectFilter) => void;
  onSetProjectSearchQuery?: (query: string) => void;
  onDismissActionNotice?: () => void;
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
  onSetMilestoneStatus: (milestone: PccMilestone, status: PccStatus, note?: string) => void;
  onSetMilestoneStopHere: (milestone: PccMilestone, stopHere: boolean) => void;
  onMoveMilestoneBefore?: (source: PccMilestone, target: PccMilestone) => void;
  onMoveSubMilestoneBefore?: (source: PccSubMilestone, target: PccSubMilestone) => void;
  onSetSubMilestoneStatus?: (
    subMilestone: PccSubMilestone,
    status: PccStatus,
    note?: string,
  ) => void;
  onAddCompletionReceipt: (milestone: PccMilestone) => void;
  onSetPermissionStatus: (permission: PccPermissionGrant, status: PccPermissionStatus) => void;
  onUpdateWorkLoop: (patch: Partial<PccWorkLoopSettings>) => void;
  onPrepareNextWorkItem: () => void;
  onPreviewSetupAutofill?: () => void;
  onApplySetupAutofill?: () => void;
  onDismissSetupAutofill?: () => void;
  onSetAutofillApproval?: (approved: boolean) => void;
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

const PLANNER_MODE_OPTIONS = [
  ["best_available", "Best available"],
  ["local_project_manager", "Local Project Manager"],
  ["local_model", "Local model"],
  ["codex", "Codex"],
  ["high_reasoning_codex", "High-reasoning Codex"],
] as const;

const PROJECT_FILTER_OPTIONS: Array<[PccProjectFilter, string]> = [
  ["active", "Active"],
  ["needs_you", "Needs You"],
  ["on_hold", "On Hold"],
  ["archived", "Archived"],
  ["all", "All"],
];

const PLANNER_MODEL_OPTIONS = [
  ["best-available", "Best available from last refresh"],
  ["gpt-5.5-high-reasoning", "GPT-5.5 High Reasoning"],
  ["gpt-5.5", "GPT-5.5 Standard"],
  ["local-project-manager", "Local Project Manager"],
  ["local-model", "Local model"],
] as const;

let draggedPccMilestoneId: string | null = null;
let draggedPccSubMilestoneId: string | null = null;

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

function promptSkipNote(message: string): string | null {
  if (!confirmAction(message)) {
    return null;
  }
  return globalThis.prompt?.("Why are we skipping this? Optional note:", "") ?? "";
}

function promptRemoveNote(message: string): string | null {
  if (!confirmAction(message)) {
    return null;
  }
  return (
    globalThis.prompt?.("Why are we removing this from the active plan? Optional note:", "") ?? ""
  );
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
    }
  });
  menu.classList.toggle("is-open", nextOpen);
  trigger.setAttribute("aria-expanded", String(nextOpen));
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
}

function runPccMenuAction(event: Event, action: () => void): void {
  closePccActionMenu(event);
  action();
}

function projectIsOnHold(project: Pick<PccProject, "status"> | PccProjectSummary): boolean {
  return project.status === "on_hold" || project.status === "deferred";
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

function primaryActionForDetail(detail: PccProjectDetail): string {
  if (!setupEvaluationForDetail(detail).runnable) {
    return "Fill missing setup with AI";
  }
  const permission = detail.permissions.find((item) => item.status === "needed");
  if (permission) {
    return "Review Permission";
  }
  if (projectIsOnHold(detail.project)) {
    return "Resume Project";
  }
  if (detail.project.status === "blocked" || detail.summary.milestoneCounts.blocked > 0) {
    return "Resolve Blocker";
  }
  if (PROJECT_TERMINAL_STATUSES.has(detail.project.status)) {
    return "View Receipt";
  }
  return "Continue Project";
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

function workStateForProject(
  project: PccProjectSummary,
  detail?: PccProjectDetail,
): "Working" | "Paused" | "Blocked" | "Waiting for you" | "Off" {
  if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
    return "Blocked";
  }
  if (project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0) {
    return "Waiting for you";
  }
  const settings = detail ? getPccWorkLoopSettings(detail.project) : undefined;
  if (settings?.enabled) {
    return settings.state === "paused" ? "Paused" : "Working";
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
    : mode === "local_project_manager"
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

function renderProductionTruthDrawer(props: PccDashboardProps) {
  const detail = props.projectDetail;
  const truth = buildPccProductionTruth({
    project: detail?.project,
    milestones: detail?.milestones ?? [],
    evidence: detail?.evidence ?? [],
    receipts: detail?.receipts ?? [],
  });
  const openByDefault = pccViewMode(props) !== "simple" && truth.status !== "current";
  const badgeLabel = truth.status === "current" ? "Proof: Current" : `Proof: ${truth.label}`;
  return html`<details class="pcc-detail-drawer pcc-top-proof-drawer" ?open=${openByDefault}>
    <summary><span class="pcc-proof-badge" data-pcc-proof-badge>${badgeLabel}</span></summary>
    ${renderProductionTruthCard(props)}
  </details>`;
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

function renderImpactDetailCards(detail: PccProjectDetail, props: PccDashboardProps) {
  const input = impactInputFromDetail(detail);
  const readiness = buildPccMilestoneReadiness(input).slice(0, 5);
  const freshness = buildPccProofFreshness(input).slice(0, 5);
  const recovery = buildPccRecoveryPlaybooks(input);
  const dependency = buildPccDependencyInsights(input);
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
      <article class="pcc-impact-card" data-pcc-project-history>
        <p class="pcc-kicker">Project history</p>
        <h4>Receipts drawer</h4>
        ${timeline.length
          ? html`<ul>
              ${timeline.map(
                (item) => html`<li><strong>${item.title}</strong><span>${item.summary}</span></li>`,
              )}
            </ul>`
          : html`<p>No receipts or evidence yet.</p>`}
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

function formatProjectDate(value: string | undefined): string {
  if (!value) {
    return "No due date";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
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

function projectIntakeSourceText(form: PccProjectFormState): string {
  return [form.projectDescription, form.goal, form.title].filter(Boolean).join("\n").trim();
}

function draftProjectIntakeAnswers(form: PccProjectFormState): Record<string, string> {
  const source = projectIntakeSourceText(form);
  const title = form.title.trim() || source.split(/\r?\n/u).find(Boolean)?.trim() || "this project";
  const goal = form.goal.trim() || source || `Complete ${title} with a verified PCC plan.`;
  const firstDeliverable = source
    ? `A reviewed PCC plan for ${title} with ordered milestones, sub-milestones, owners, and proof gates generated from the project prompt.`
    : `A reviewed PCC plan for ${title} with ordered milestones, sub-milestones, owners, and proof gates.`;
  const highReasoning =
    form.plannerMode === "codex" ||
    form.plannerMode === "high_reasoning_codex" ||
    form.planningMode === "codex_full_plan";
  const generated = {
    goal,
    firstDeliverable,
    doneProof:
      "Every milestone has acceptance criteria, proof requirements, and a completion receipt before PCC marks it complete.",
    constraints: highReasoning
      ? "Codex or high-reasoning planning requires explicit approval before token spend; destructive, remote, publish, runtime, and reboot actions need separate approval."
      : "Do not run destructive, remote, publish, runtime, reboot, or high-token actions without separate approval.",
    owner: highReasoning ? "Codex planning with user approval" : "Local Project Manager",
    blockers:
      "Unknown blockers must be converted into PCC permission, tool, source, or proof gaps before work starts.",
  };
  return Object.fromEntries(
    Object.entries(generated).map(([key, value]) => {
      const existing = form.intakeAnswers[key]?.trim();
      return [key, existing || value];
    }),
  );
}

function projectIntakeDraftPatch(form: PccProjectFormState): Partial<PccProjectFormState> {
  const intakeAnswers = draftProjectIntakeAnswers(form);
  const goal = form.goal.trim() || intakeAnswers.goal;
  const title = form.title.trim() || goal.replace(/[.!?]$/u, "").slice(0, 90) || "Untitled Project";
  const recommendation = recommendPccWorkflow({ title, goal, intakeAnswers });
  return {
    title,
    goal,
    intakeAnswers,
    workflowTemplateId: form.workflowTemplateId || recommendation.templateId,
    planPreviewAccepted: false,
  };
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

function renderProjectIntakeAutofillButton(
  props: PccDashboardProps,
  label = "Fill missing fields with AI",
) {
  return html`<button
    class="btn"
    type="button"
    data-pcc-project-intake-autofill
    ?disabled=${props.actionBusy}
    @click=${() => props.onProjectFormChange(projectIntakeDraftPatch(props.projectForm))}
  >
    ${label}
  </button>`;
}

function setupEvaluationForDetail(detail: PccProjectDetail) {
  return evaluatePccProjectSetup({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
  });
}

function renderAutofillPreview(props: PccDashboardProps) {
  const preview = props.autofillPreview;
  if (!preview) {
    return nothing;
  }
  return html`<section class="pcc-autofill-preview" data-pcc-autofill-preview>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">AI Autofill Preview</p>
        <h4>Review before applying</h4>
        <p>${preview.summary}</p>
      </div>
      <span>${preview.workflowTitle}</span>
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
    </dl>
    <ul class="pcc-autofill-preview__changes">
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
        ?disabled=${props.actionBusy}
        @click=${() => props.onApplySetupAutofill?.()}
      >
        Apply Autofill
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
  if (evaluation.runnable) {
    return nothing;
  }
  const issues = [
    ...evaluation.missing.map((issue) => ({ label: "Missing", issue })),
    ...evaluation.violations.map((issue) => ({ label: "Violated", issue })),
    ...evaluation.needsReview.map((issue) => ({ label: "Review", issue })),
  ].slice(0, 8);
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
      ${issues.length
        ? issues.map(
            ({ label, issue }) => html`<li><strong>${label}</strong><span>${issue}</span></li>`,
          )
        : html`<li><strong>Review</strong><span>Setup needs review before work starts.</span></li>`}
    </ul>
    <div class="pcc-setup-repair__actions">
      <button
        class="btn"
        type="button"
        ?disabled=${props.actionBusy}
        @click=${() => props.onPreviewSetupAutofill?.()}
      >
        Fill missing setup with AI
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
    </div>
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
  const selected = project.id === props.selectedProjectId;
  const detail = props.projectDetails?.[project.id];
  const current = detail ? currentMilestoneForDetail(detail) : undefined;
  const next = detail ? nextMilestoneForDetail(detail) : undefined;
  const workState = workStateForProject(project, detail);
  const onHold = projectIsOnHold(project);
  return html`
    <article
      class="pcc-project-card ${selected ? "is-selected" : ""} ${onHold ? "is-on-hold" : ""}"
      data-pcc-project-card
    >
      <div class="pcc-project-card__topline">
        <div>
          <h3>${project.title}</h3>
        </div>
        <span class="pcc-status pcc-status--${project.status}"
          >${formatStatus(project.status)}</span
        >
      </div>
      <div class="pcc-project-card__progress-row">
        <strong>${percent}%</strong>
        <div class="pcc-progress" aria-label=${`${project.title} ${percent}% complete`}>
          <span class="pcc-progress__bar" style=${`width:${percent}%`}></span>
        </div>
      </div>
      <div class="pcc-project-card__meta pcc-project-card__meta--skim">
        <span>${project.milestoneCounts.complete}/${project.milestoneCounts.total} milestones</span>
        <span>Health: ${project.health ?? formatStatus(project.status)}</span>
        <span>Due: ${formatProjectDate(project.dueDate)}</span>
        <span>${onHold ? "On hold" : `Current: ${current?.title ?? "Not started"}`}</span>
        <span>Next: ${next?.title ?? project.nextActions[0] ?? "None"}</span>
        <span>Activity: ${formatProjectActivity(project.recentActivity)}</span>
        <span>Work: ${workState}</span>
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

function topProject(
  props: PccDashboardProps,
  predicate: (project: PccProjectSummary) => boolean,
): PccProjectSummary | undefined {
  return props.projects.find(predicate);
}

function projectActionLine(project: PccProjectSummary, detail?: PccProjectDetail): string {
  const current = detail ? currentMilestoneForDetail(detail) : undefined;
  return current?.title ?? project.nextActions[0] ?? formatStatus(project.status);
}

function renderTodayPrimaryCard(
  props: PccDashboardProps,
  label: string,
  project: PccProjectSummary | undefined,
  empty: string,
  detail?: string,
) {
  return html`<article class="pcc-today__primary-card">
    <span>${label}</span>
    ${project
      ? html`<button type="button" @click=${() => props.onSelectProject(project.id)}>
          <strong>${project.title}</strong>
          <em>${detail ?? projectActionLine(project, props.projectDetails?.[project.id])}</em>
        </button>`
      : html`<p>${empty}</p>`}
  </article>`;
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
  if (filter === "needs_you") {
    return (
      project.status === "needs_approval" ||
      project.status === "blocked" ||
      project.milestoneCounts.needsApproval > 0 ||
      project.milestoneCounts.blocked > 0
    );
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

function normalizeProjectSearchQuery(query: string | undefined): string[] {
  return (query ?? "")
    .toLocaleLowerCase()
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function projectSearchText(project: PccProjectSummary, detail?: PccProjectDetail): string {
  const parts = [
    project.title,
    project.status,
    project.health ?? "",
    project.recentActivity ?? "",
    ...(project.nextActions ?? []),
    ...(project.proofGaps ?? []),
  ];
  if (detail) {
    parts.push(detail.project.goal ?? "", detail.project.owner ?? "");
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
  return parts.join("\n").toLocaleLowerCase();
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
  const selected = props.projectFilter ?? "active";
  return html`<nav class="pcc-project-tabs" data-pcc-project-tabs aria-label="Project filters">
    ${PROJECT_FILTER_OPTIONS.map(([filter, label]) => {
      const count = projects.filter((project) => projectMatchesFilter(project, filter)).length;
      return html`<button
        type="button"
        class=${filter === selected ? "is-selected" : ""}
        aria-pressed=${filter === selected}
        @click=${() => props.onSetProjectFilter?.(filter)}
      >
        ${label} <span>${count}</span>
      </button>`;
    })}
  </nav>`;
}

function renderProjectSearch(props: PccDashboardProps, visibleCount: number, filterCount: number) {
  const query = props.projectSearchQuery ?? "";
  const hasQuery = query.trim().length > 0;
  return html`<section class="pcc-project-search" data-pcc-project-search>
    <label>
      <span>Search projects</span>
      <input
        type="search"
        aria-label="Search projects"
        placeholder="Search title, status, next action, blocker, proof, or owner"
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

function renderTopPortfolioMetrics(
  props: PccDashboardProps,
  projects: readonly PccProjectSummary[],
) {
  const portfolio = props.portfolio;
  return html`<section
    class="pcc-today__metrics"
    data-pcc-top-metrics
    aria-label="Portfolio metrics"
  >
    ${renderMetric("Total projects", portfolio?.projectsTotal ?? projects.length)}
    ${renderMetric("Active", portfolio?.active ?? 0)}
    ${renderMetric("Blocked", portfolio?.blocked ?? 0)}
    ${renderMetric("Needs approval", portfolio?.needsApproval ?? 0)}
    ${renderMetric(
      "Average completion",
      `${clampPercent(portfolio?.averagePercentComplete ?? 0)}%`,
    )}
  </section>`;
}

function renderTodayView(props: PccDashboardProps) {
  const portfolio = props.portfolio;
  const working = topProject(
    props,
    (project) =>
      ["in_progress", "active"].includes(project.status) ||
      workStateForProject(project, props.projectDetails?.[project.id]) === "Working",
  );
  const needsYou = topProject(
    props,
    (project) => project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0,
  );
  const blocked = topProject(
    props,
    (project) => project.status === "blocked" || project.milestoneCounts.blocked > 0,
  );
  const ready = topProject(
    props,
    (project) => project.nextActions.length > 0 && project.status !== "blocked",
  );
  const nextBest = needsYou ?? blocked ?? ready ?? working;
  const average = clampPercent(portfolio?.averagePercentComplete ?? 0);
  return html`<section class="pcc-today" data-pcc-today aria-label="Today">
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Today</p>
        <h3>Your projects at a glance</h3>
        <p>Open one project, see the milestone journey, then work the next safe step.</p>
      </div>
      <span>${formatUpdatedAt(props.updatedAt)}</span>
    </div>
    ${renderTopPortfolioMetrics(props, props.projects)}
    <div class="pcc-today__hero-grid">
      ${renderTodayPrimaryCard(
        props,
        "Working Now",
        working,
        "No project is actively working.",
        working
          ? `${workStateForProject(working, props.projectDetails?.[working.id])} · ${projectActionLine(working, props.projectDetails?.[working.id])}`
          : undefined,
      )}
      ${renderTodayPrimaryCard(
        props,
        "Needs You",
        needsYou ?? blocked,
        "No approvals or blockers need you.",
      )}
      ${renderTodayPrimaryCard(props, "Next Best Action", nextBest, "No ready action recorded.")}
      <article class="pcc-today__primary-card" data-pcc-portfolio-progress>
        <span>Portfolio Progress</span>
        <strong>${average}%</strong>
        <em>
          ${portfolio?.active ?? 0} active · ${portfolio?.blocked ?? 0} blocked ·
          ${portfolio?.needsApproval ?? 0} need you
        </em>
      </article>
    </div>
    <details class="pcc-today__drawer">
      <summary>Show all project queues</summary>
      <div class="pcc-today__queues">
        <article>
          <strong>Working</strong>
          <ul>
            ${props.projects
              .filter((project) => ["in_progress", "active"].includes(project.status))
              .slice(0, 8)
              .map((project) => html`<li>${project.title}</li>`)}
          </ul>
        </article>
        <article>
          <strong>Needs You</strong>
          <ul>
            ${props.projects
              .filter(
                (project) =>
                  project.status === "needs_approval" || project.milestoneCounts.needsApproval > 0,
              )
              .slice(0, 8)
              .map((project) => html`<li>${project.title}</li>`)}
          </ul>
        </article>
        <article>
          <strong>Blocked</strong>
          <ul>
            ${props.projects
              .filter(
                (project) => project.status === "blocked" || project.milestoneCounts.blocked > 0,
              )
              .slice(0, 8)
              .map((project) => html`<li>${project.title}</li>`)}
          </ul>
        </article>
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
      ? `Setup quality gate is ${setupEvaluation.badge.toLowerCase()}; use Fill missing setup with AI or Edit manually before starting.`
      : (next.blocker?.message ?? settings.lastLoopMessage ?? "Ready for the next safe milestone.");
  const prepareNeedsSetupRepair = !setupEvaluation.runnable && !projectIsTerminal(detail.project);
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
          ?disabled=${props.actionBusy ||
          projectIsTerminal(detail.project) ||
          (prepareNeedsSetupRepair && !props.onPreviewSetupAutofill)}
          @click=${prepareNeedsSetupRepair
            ? props.onPreviewSetupAutofill
            : props.onPrepareNextWorkItem}
        >
          ${prepareNeedsSetupRepair ? "Fill missing setup with AI" : "Prepare next safe task"}
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

function renderProjectSnapshot(detail: PccProjectDetail, props: PccDashboardProps) {
  const project = detail.project;
  const percent = clampPercent(detail.summary.percentComplete);
  const current = currentMilestoneForDetail(detail);
  const next = nextMilestoneForDetail(detail);
  const permissionNeeded = detail.permissions.find((permission) => permission.status === "needed");
  const setupEvaluation = setupEvaluationForDetail(detail);
  const settings = getPccWorkLoopSettings(project);
  const worker = current ? itemWorkerLabel(current) : "None";
  const primaryAction = primaryActionForDetail(detail);
  const needsSetupRepair = !setupEvaluation.runnable;
  const handlePrimaryAction = () => {
    if (needsSetupRepair) {
      props.onPreviewSetupAutofill?.();
      return;
    }
    if (projectIsOnHold(project)) {
      props.onSetProjectStatus(project, "active");
      return;
    }
    props.onPrepareNextWorkItem();
  };
  const decision = permissionNeeded
    ? `Approval needed: ${formatStatus(permissionNeeded.type)}`
    : setupEvaluation.runnable
      ? "No user decision needed before the next safe step."
      : `Setup ${setupEvaluation.badge.toLowerCase()}: ${setupEvaluation.missing[0] ?? setupEvaluation.needsReview[0] ?? "review required"}`;
  return html`<section class="pcc-project-snapshot" data-pcc-project-snapshot>
    <div>
      <p class="pcc-kicker">Project Snapshot</p>
      <h3>${project.title}</h3>
    </div>
    <div class="pcc-project-snapshot__progress">
      <strong>${percent}%</strong>
      <div class="pcc-progress" aria-label=${`${project.title} ${percent}% complete`}>
        <span class="pcc-progress__bar" style=${`width:${percent}%`}></span>
      </div>
      <span
        >${detail.summary.milestoneCounts.complete}/${detail.summary.milestoneCounts.total}
        milestones complete</span
      >
    </div>
    <dl class="pcc-project-snapshot__facts">
      ${renderTruthFact("Status", formatStatus(project.status))}
      ${renderTruthFact("Current milestone", current?.title ?? "Not started")}
      ${renderTruthFact("Next milestone", next?.title ?? "None")}
      ${renderTruthFact("Worker", worker)}
      ${renderTruthFact("Work", settings.enabled ? formatStatus(settings.state) : "Off")}
      ${renderTruthFact("Needs you", decision)}
    </dl>
    <section class="pcc-project-brief" data-pcc-project-brief>
      <span>Project brief</span>
      <p>${project.goal || "No project goal recorded yet."}</p>
    </section>
    <div class="pcc-primary-action" data-pcc-primary-action>
      <span>Primary action</span>
      <button
        class="btn"
        type="button"
        ?disabled=${props.actionBusy || (needsSetupRepair && !props.onPreviewSetupAutofill)}
        @click=${handlePrimaryAction}
      >
        ${primaryAction}
      </button>
      <em>${decision}</em>
    </div>
    ${renderSetupRepairCard(setupEvaluation, props)}
    <div class="pcc-detail__actions">
      <button
        class="btn btn--subtle"
        type="button"
        @click=${() => props.onOpenProjectEditor(project)}
      >
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
  return html`<section class="pcc-milestone-journey" data-pcc-milestone-journey>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Milestone Journey</p>
        <h4>Project sequence</h4>
        <p>Follow the steps in order. Open a step only when you need its details.</p>
      </div>
      <span
        >${detail.summary.milestoneCounts.complete}/${detail.summary.milestoneCounts.total}
        complete</span
      >
    </div>
    <div class="pcc-journey-phases" data-pcc-journey-phases>
      ${phaseGroups.map((group) => {
        const complete = group.milestones.filter((item) =>
          ["complete", "complete_with_maintenance"].includes(item.status),
        ).length;
        return html`<section class="pcc-journey-phase" data-pcc-journey-phase>
          <header>
            <strong>${group.title}</strong>
            <span>${complete}/${group.milestones.length} complete</span>
          </header>
          <ol>
            ${group.milestones.map((milestone) => {
              const globalIndex = milestones.findIndex((item) => item.id === milestone.id) + 1;
              const journeyClass = milestoneJourneyClass(milestone, current?.id);
              const subMilestones = subMilestonesForMilestone(detail, milestone);
              const nextSub = nextSubMilestoneForMilestone(detail, milestone);
              const blocker = milestone.blocker || nextSub?.blocker;
              return html`<li
                class="pcc-journey-step pcc-journey-step--${journeyClass}"
                data-pcc-journey-step
                data-pcc-milestone-id=${milestone.id}
                draggable="true"
                @dragstart=${() => {
                  draggedPccMilestoneId = milestone.id;
                }}
                @dragover=${(event: DragEvent) => event.preventDefault()}
                @drop=${(event: DragEvent) => {
                  event.preventDefault();
                  const source = milestones.find((item) => item.id === draggedPccMilestoneId);
                  draggedPccMilestoneId = null;
                  if (source && source.id !== milestone.id) {
                    props.onMoveMilestoneBefore?.(source, milestone);
                  }
                }}
                @dragend=${() => {
                  draggedPccMilestoneId = null;
                }}
              >
                <div
                  class="pcc-journey-step__marker"
                  aria-label=${`Step ${globalIndex} of ${milestones.length}`}
                >
                  <span class="pcc-drag-handle" aria-label="Drag to reorder milestone">☰</span>
                  ${globalIndex}
                </div>
                <div class="pcc-journey-step__content">
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
                            })}
                            <details class="pcc-detail-drawer" ?open=${mode === "agent"}>
                              <summary>Proof, receipts, permissions, and actions</summary>
                              ${renderMilestoneReceipts(milestone, props)}
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
                  ${renderMilestoneActionMenu(milestone, props)}
                </div>
              </li>`;
            })}
          </ol>
        </section>`;
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
        <p>Open a project to see its snapshot, milestone journey, and work controls.</p>
      </aside>
    `;
  }
  const permissions = detail.permissions ?? [];
  return html`
    <aside class="pcc-detail pcc-detail--${mode}" data-pcc-detail data-pcc-detail-mode=${mode}>
      ${renderProjectSnapshot(detail, props)} ${renderMilestoneJourney(detail, props)}
      ${renderWorkLoopCard(props)}
      <details class="pcc-detail-drawer" ?open=${mode !== "simple"}>
        <summary>Details</summary>
        ${renderNextSafeActionCard(props)} ${renderCurrentTruthAndReadyQueue(props)}
        ${renderPhaseOverview(detail)} ${renderWorkflowQualityCard(detail)}
        ${renderImpactDetailCards(detail, props)}
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
                      : detail.milestones.map((milestone) => renderMilestoneCard(milestone, props))}
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

function renderMilestoneActionMenu(milestone: PccMilestone, props: PccDashboardProps) {
  const skipNote = () => promptSkipNote("Skip this milestone and its unfinished sub-steps?");
  const removeNote = () =>
    promptRemoveNote("Remove this milestone and its unfinished sub-steps from the active plan?");
  const menuId = `pcc-action-menu-${milestone.id}`;
  return html`<div class="pcc-action-menu" data-pcc-action-menu>
    <button
      class="pcc-action-menu__trigger"
      data-pcc-action-menu-trigger
      type="button"
      aria-expanded="false"
      aria-controls=${menuId}
      aria-label=${`Actions for ${milestone.title}`}
      @click=${togglePccActionMenu}
    >
      •••
    </button>
    <div class="pcc-action-menu__items" id=${menuId} role="menu">
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
          runPccMenuAction(event, () => {
            const note = skipNote();
            if (note !== null) {
              props.onSetMilestoneStatus(milestone, "skipped", note);
            }
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
          runPccMenuAction(event, () => {
            const note = removeNote();
            if (note !== null) {
              props.onSetMilestoneStatus(milestone, "archived", note);
            }
          });
        }}
      >
        Delete / Remove from plan
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
  const skipNote = () => promptSkipNote("Skip this sub-step?");
  const removeNote = () => promptRemoveNote("Remove this sub-step from the active plan?");
  const menuId = `pcc-submilestone-action-menu-${subMilestone.id}`;
  return html`<div class="pcc-action-menu pcc-action-menu--sub" data-pcc-submilestone-action-menu>
    <button
      class="pcc-action-menu__trigger"
      data-pcc-action-menu-trigger
      type="button"
      aria-expanded="false"
      aria-controls=${menuId}
      aria-label=${`Actions for ${subMilestone.title}`}
      @click=${togglePccActionMenu}
    >
      •••
    </button>
    <div class="pcc-action-menu__items" id=${menuId} role="menu">
      <button
        type="button"
        role="menuitem"
        ?disabled=${props.actionBusy}
        @click=${(event: Event) => {
          runPccMenuAction(event, () => {
            const note = skipNote();
            if (note !== null) {
              props.onSetSubMilestoneStatus?.(subMilestone, "skipped", note);
            }
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
          runPccMenuAction(event, () => {
            const note = removeNote();
            if (note !== null) {
              props.onSetSubMilestoneStatus?.(subMilestone, "archived", note);
            }
          });
        }}
      >
        Delete / Remove from plan
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
  options: { compact?: boolean } = {},
) {
  const subMilestones = subMilestonesForMilestone(props.projectDetail, milestone);
  if (subMilestones.length === 0) {
    return html`<div class="pcc-empty pcc-empty--small">No sub-milestones recorded</div>`;
  }
  return html`<ol
    class="pcc-submilestones ${options.compact ? "pcc-submilestones--compact" : ""}"
    data-pcc-submilestones
  >
    ${subMilestones.map((subMilestone) => {
      const percent = subMilestoneDisplayPercent(subMilestone);
      const complete =
        subMilestone.status === "complete" || subMilestone.status === "complete_with_maintenance";
      return html`<li
        class="pcc-submilestone"
        data-pcc-submilestone
        data-pcc-submilestone-id=${subMilestone.id}
        draggable="true"
        @dragstart=${() => {
          draggedPccSubMilestoneId = subMilestone.id;
        }}
        @dragover=${(event: DragEvent) => event.preventDefault()}
        @drop=${(event: DragEvent) => {
          event.preventDefault();
          const source = subMilestones.find((item) => item.id === draggedPccSubMilestoneId);
          draggedPccSubMilestoneId = null;
          if (source && source.id !== subMilestone.id) {
            props.onMoveSubMilestoneBefore?.(source, subMilestone);
          }
        }}
        @dragend=${() => {
          draggedPccSubMilestoneId = null;
        }}
      >
        <div class="pcc-submilestone__main">
          <span class="pcc-drag-handle" aria-label="Drag to reorder sub-milestone">☰</span>
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
          ${renderSubMilestoneActionMenu(subMilestone, props)}
        </div>
        <div class="pcc-project-card__meta">
          <span>${percent}%</span>
          ${options.compact
            ? nothing
            : html`
                <span>Worker ${itemWorkerLabel(subMilestone)}</span>
                <span>${itemProofLabel(subMilestone)}</span>
                <span>${subMilestone.acceptanceCriteria?.length ?? 0} criteria</span>
              `}
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
            const note = promptSkipNote("Skip this milestone and its unfinished sub-steps?");
            if (note !== null) {
              props.onSetMilestoneStatus(milestone, "skipped", note);
            }
          }}
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
      <div class="pcc-intake-wizard__header-actions">
        <span class="pcc-status">${missing.length ? `${missing.length} missing` : "Answered"}</span>
        ${renderProjectIntakeAutofillButton(props, "Autofill intake answers with AI")}
      </div>
    </div>
    <p class="pcc-intake-wizard__hint">
      AI fills these answers from the project prompt, title, and goal. Review the draft before
      saving.
    </p>
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

function renderGeneratedPlanPreview(props: PccDashboardProps) {
  const form = props.projectForm;
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
  });
  const milestoneCount = draft.milestones.length;
  const subMilestoneCount = Object.values(draft.subMilestonesByMilestoneTitle).reduce(
    (count, items) => count + items.length,
    0,
  );
  const plannerNeedsPermission =
    (form.plannerMode === "codex" || form.plannerMode === "high_reasoning_codex") &&
    !form.codexPlanningAllowed;
  return html`<section class="pcc-plan-preview" data-pcc-plan-preview>
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Generated plan preview</p>
        <h4>${draft.project.title}</h4>
        <p>${draft.project.goal ?? "No goal recorded."}</p>
      </div>
      <span class="pcc-status">${milestoneCount} milestones</span>
    </div>
    <div class="pcc-plan-preview__meta">
      <span>${subMilestoneCount} sub-milestones</span>
      <span>${form.plannerMode.replace(/_/gu, " ")}</span>
      <span>${form.workflowTemplateId.replace(/-/gu, " ")}</span>
      <span
        >${plannerNeedsPermission
          ? "Permission needed before Codex"
          : "No token spend on preview"}</span
      >
    </div>
    ${plannerNeedsPermission
      ? html`<div class="pcc-callout" data-pcc-codex-planning-gate>
          <strong>High-reasoning / Codex permission</strong>
          <span
            >This planner may spend tokens. Allow it for this plan only, or keep the generated local
            preview without Codex refinement.</span
          >
        </div>`
      : form.plannerMode === "local_project_manager"
        ? html`<div class="pcc-callout" data-pcc-project-manager-intake>
            <strong>Project Manager review</strong>
            <span
              >PCC will use the selected workflow template and queue local review before
              execution.</span
            >
          </div>`
        : nothing}
    <ol class="pcc-plan-preview__milestones">
      ${draft.milestones.slice(0, 6).map((milestone) => {
        const subs = draft.subMilestonesByMilestoneTitle[milestone.title] ?? [];
        return html`<li>
          <strong>${milestone.title}</strong>
          <span>${subs.length} sub-milestone${subs.length === 1 ? "" : "s"}</span>
          <ul>
            ${subs.slice(0, 3).map((sub) => html`<li>${sub.title}</li>`)}
          </ul>
        </li>`;
      })}
    </ol>
    <label class="pcc-intake-wizard__approval">
      <input
        type="checkbox"
        .checked=${form.planPreviewAccepted}
        @change=${(event: Event) =>
          props.onProjectFormChange({
            planPreviewAccepted: (event.target as HTMLInputElement).checked,
          })}
      />
      I reviewed this generated plan preview.
    </label>
  </section>`;
}

function renderProjectEditor(props: PccDashboardProps) {
  const form = props.projectForm;
  const missingIntake = pccMissingRequiredIntakeAnswers(form.intakeAnswers);
  const creating = props.editorMode === "create-project";
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
          <h3>${props.editorMode === "edit-project" ? "Edit project" : "Create project"}</h3>
          ${creating
            ? html`<p>
                Describe the project. PCC will draft the milestones before anything starts.
              </p>`
            : nothing}
        </div>
        ${needsAiDraft
          ? html`<div class="pcc-editor__header-actions">
              ${renderProjectIntakeAutofillButton(props, "Fill missing setup with AI")}
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
      ${creating
        ? html`<label class="pcc-editor__hero-field">
            Describe what you want to build
            <textarea
              data-pcc-project-description
              placeholder="Example: Build a dashboard that shows all projects, milestones, blockers, and proof receipts in one simple command center."
              .value=${form.projectDescription}
              @input=${(event: Event) =>
                props.onProjectFormChange({
                  projectDescription: (event.target as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>`
        : nothing}
      ${needsAiDraft
        ? html`<section class="pcc-editor__ai-repair" data-pcc-project-intake-ai-repair>
            <div>
              <strong>Let AI fill the setup fields</strong>
              <span
                >Drafts the title, goal, intake answers, workflow, owners, and proof rules from the
                prompt and existing project context. You can edit before saving.</span
              >
            </div>
            ${renderProjectIntakeAutofillButton(props)}
          </section>`
        : nothing}
      <div class="pcc-editor__grid">
        <label>
          Title
          <input
            required
            .value=${form.title}
            @input=${(event: Event) =>
              props.onProjectFormChange({ title: (event.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Priority
          <input
            type="number"
            min="0"
            max="5"
            .value=${form.priority}
            @input=${(event: Event) =>
              props.onProjectFormChange({ priority: (event.target as HTMLInputElement).value })}
          />
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
      </div>
      <label>
        Goal
        <textarea
          .value=${form.goal}
          @input=${(event: Event) =>
            props.onProjectFormChange({ goal: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
      <div class="pcc-editor__grid">
        <label>
          Planner
          <select
            data-pcc-planner-selector
            .value=${form.plannerMode}
            @change=${(event: Event) =>
              props.onProjectFormChange({
                plannerMode: (event.target as HTMLSelectElement).value as PccPlannerMode,
              })}
          >
            ${renderStringOptions(PLANNER_MODE_OPTIONS, form.plannerMode)}
          </select>
        </label>
        <label>
          Planner model
          <select
            data-pcc-planner-model
            .value=${form.plannerModelId || "best-available"}
            @change=${(event: Event) =>
              props.onProjectFormChange({
                plannerModelId: (event.target as HTMLSelectElement).value,
              })}
          >
            ${PLANNER_MODEL_OPTIONS.map(
              ([value, label]) => html`<option value=${value}>${label}</option>`,
            )}
          </select>
          <small
            >Last refreshed with dashboard data. Use Refresh to update model availability.</small
          >
        </label>
      </div>
      <div class="pcc-editor__grid">
        <label>
          Workflow template
          <select
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
        <label>
          Status
          <select
            .value=${form.status}
            @change=${(event: Event) =>
              props.onProjectFormChange({
                status: (event.target as HTMLSelectElement).value as PccStatus,
              })}
          >
            ${renderStatusOptions(PROJECT_STATUSES)}
          </select>
        </label>
      </div>
      <details class="pcc-detail-drawer" ?open=${creating || needsAiDraft}>
        <summary>Project intake answers · ${intakeSummary}</summary>
        ${renderProjectIntakeWizard(props)}
      </details>
      ${renderGeneratedPlanPreview(props)}
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
          Allow Codex/high-reasoning planning
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
      ${projectSaveBlocked
        ? html`<p class="pcc-intake-wizard__missing" data-pcc-plan-preview-blocked>
            Complete intake approval and review the generated plan preview before creating the
            project.
          </p>`
        : nothing}
      <footer>
        ${creating
          ? html`<button
              class="btn"
              type="submit"
              ?disabled=${props.actionBusy || !form.title.trim() || projectSaveBlocked}
            >
              Approve and create
            </button>`
          : html`<button
              class="btn"
              type="submit"
              ?disabled=${props.actionBusy || !form.title.trim()}
            >
              Save project
            </button>`}
        <button
          class="btn btn--subtle"
          type="button"
          data-pcc-project-regenerate-ai
          @click=${() => props.onProjectFormChange(projectIntakeDraftPatch(form))}
        >
          Regenerate with AI
        </button>
        <button class="btn btn--subtle" type="button" @click=${() => confirmEditorClose(props)}>
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
  const allProjects = props.projects;
  const filteredByTab = allProjects.filter((project) =>
    projectMatchesFilter(project, props.projectFilter ?? "active"),
  );
  const projects = filteredByTab.filter((project) =>
    projectMatchesSearch(
      project,
      props.projectSearchQuery,
      props.projectDetails?.[project.id] ??
        (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined),
    ),
  );
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
      ${props.actionNotice
        ? html`<div class="pcc-callout pcc-callout--success" data-pcc-action-notice role="status">
            <strong>Saved</strong><span>${props.actionNotice.text}</span>
            <button
              class="btn btn--subtle"
              type="button"
              @click=${() => props.onDismissActionNotice?.()}
            >
              Dismiss
            </button>
          </div>`
        : nothing}
      ${renderTodayView(props)} ${renderProjectFilterTabs(props, allProjects)}
      ${renderProjectSearch(props, projects.length, filteredByTab.length)}
      <details class="pcc-detail-drawer pcc-top-proof-drawer">
        <summary>Needs You details</summary>
        ${renderImpactAttentionInbox(props)}
      </details>
      ${renderProductionTruthDrawer(props)}
      ${mode === "simple" ? nothing : renderPortfolioWorkConsole(props)}

      <div class="pcc-layout">
        <section class="pcc-projects" aria-label="Projects">
          ${!props.loading && projects.length === 0
            ? html`<div class="pcc-empty" data-pcc-empty>
                <h3>No projects yet</h3>
                <p>
                  ${props.projectSearchQuery?.trim()
                    ? "No projects match this search. Clear search or try another term."
                    : "No projects match this filter. Use another tab or create a new project."}
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

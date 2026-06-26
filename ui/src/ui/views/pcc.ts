// Control UI view renders the Project Command Center dashboard and CRUD shell.
import { html, nothing } from "lit";
import {
  getPccWorkLoopNext,
  getPccWorkLoopSettings,
  type PccWorkLoopSettings,
} from "../../../../src/pcc/work-loop.js";
import type {
  PccEditorMode,
  PccMilestoneFormState,
  PccProjectDetail,
  PccProjectFormState,
} from "../controllers/pcc.ts";
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
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
  actionBusy: boolean;
  actionError: string | null;
  editorMode: PccEditorMode;
  projectForm: PccProjectFormState;
  milestoneForm: PccMilestoneFormState;
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
  onAddCompletionReceipt: (milestone: PccMilestone) => void;
  onSetPermissionStatus: (permission: PccPermissionGrant, status: PccPermissionStatus) => void;
  onUpdateWorkLoop: (patch: Partial<PccWorkLoopSettings>) => void;
  onPrepareNextWorkItem: () => void;
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

function renderStatusOptions(statuses: PccStatus[]) {
  return statuses.map((status) => html`<option value=${status}>${formatStatus(status)}</option>`);
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

function renderWorkLoopCard(props: PccDashboardProps) {
  const detail = props.projectDetail;
  if (!detail) {
    return nothing;
  }
  const settings = getPccWorkLoopSettings(detail.project);
  const next = getPccWorkLoopNext({
    project: detail.project,
    milestones: detail.milestones,
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const workLabel = settings.enabled ? formatStatus(next.state) : "Off";
  const nextTitle = next.milestone?.title ?? "No eligible milestone";
  const message =
    next.blocker?.message ?? settings.lastLoopMessage ?? "Ready for the next safe milestone.";
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
          ?disabled=${props.actionBusy}
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
          ?disabled=${props.actionBusy}
          @click=${props.onPrepareNextWorkItem}
        >
          Prepare next safe task
        </button>
      </div>
      <div class="pcc-work-loop__toggles">
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
            .checked=${settings.stopBeforeRemoteProof}
            @change=${(event: Event) =>
              props.onUpdateWorkLoop({
                stopBeforeRemoteProof: (event.target as HTMLInputElement).checked,
              })}
          />
          Stop before remote proof
        </label>
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
    <aside class="pcc-detail" data-pcc-detail>
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
      ${renderWorkLoopCard(props)} ${renderPhaseOverview(detail)}
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
      <section class="pcc-milestones" aria-label="Project milestones">
        ${detail.milestones.length === 0
          ? html`<div class="pcc-empty pcc-empty--small">No milestones yet</div>`
          : detail.milestones.map((milestone) => renderMilestoneCard(milestone, props))}
      </section>
    </aside>
  `;
}

function renderMilestoneCard(milestone: PccMilestone, props: PccDashboardProps) {
  const percent = clampPercent(milestone.percentComplete ?? 0);
  const canComplete = receiptsForMilestone(props.projectDetail, milestone).length > 0;
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
      </div>
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

function renderProjectEditor(props: PccDashboardProps) {
  const form = props.projectForm;
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
      <footer>
        <button class="btn" type="submit" ?disabled=${props.actionBusy || !form.title.trim()}>
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

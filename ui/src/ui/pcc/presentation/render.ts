import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import { formatDateMs } from "../../format.ts";
import { icons } from "../../icons.ts";
import {
  derivePccProgress,
  getPccWorkLoopState,
  pccGoalPrimaryAction,
  type PccGoalAction,
  type PccOwnerAcceptanceState,
  type PccUiState,
} from "../application/model.ts";

export type PccPresentationProps = {
  state: PccUiState;
  connected: boolean;
  canWrite: boolean;
  onRefresh: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (title: string, goal: string) => void;
  onStartPlan: (description: string) => void;
  onGoalAction: (action: PccGoalAction) => void;
  onStartOwnerAcceptance: () => void;
  onFinishOwnerAcceptance: () => void;
  onCancelOwnerAcceptance: () => void;
};

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return t("common.na");
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? formatDateMs(time, { dateStyle: "medium" }, "") : value;
}

function formStringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function renderProjectPicker(props: PccPresentationProps): TemplateResult {
  return html`
    <label class="pcc-field">
      <span>${t("pcc.projectLabel")}</span>
      <select
        aria-label=${t("pcc.projectLabel")}
        .value=${props.state.selectedProjectId ?? ""}
        ?disabled=${props.state.loading || props.state.projects.length === 0}
        @change=${(event: Event) =>
          props.onSelectProject((event.target as HTMLSelectElement).value)}
      >
        ${props.state.projects.length === 0
          ? html`<option value="">${t("pcc.noProjects")}</option>`
          : props.state.projects.map(
              (project) => html`<option value=${project.id}>${project.title}</option>`,
            )}
      </select>
    </label>
  `;
}

function renderProjectSummary(props: PccPresentationProps): TemplateResult {
  const project = props.state.project;
  const progress = derivePccProgress(props.state);
  if (!project) {
    return html`
      <div class="pcc-empty" role="status">
        <div class="pcc-empty__icon" aria-hidden="true">${icons.folder}</div>
        <h2>${t("pcc.emptyTitle")}</h2>
        <p>${t("pcc.emptyDescription")}</p>
      </div>
    `;
  }
  return html`
    <section class="pcc-project-card" aria-labelledby="pcc-project-title">
      <div class="pcc-project-card__header">
        <div>
          <p class="pcc-eyebrow">${t("pcc.projectEyebrow")}</p>
          <h2 id="pcc-project-title">${project.title}</h2>
          <p class="pcc-muted">${project.goal || t("pcc.noGoal")}</p>
        </div>
        <span class="pcc-status pcc-status--${project.status}">${statusLabel(project.status)}</span>
      </div>
      <div class="pcc-progress" aria-label=${t("pcc.progressLabel")}>
        <div class="pcc-progress__track"><span style=${`width: ${progress.percent}%`}></span></div>
        <strong>${Math.round(progress.percent)}%</strong>
      </div>
      <div class="pcc-facts">
        <span
          >${t("pcc.milestones", {
            complete: String(progress.complete),
            total: String(progress.total),
          })}</span
        >
        ${project.owner ? html`<span>${t("pcc.owner", { owner: project.owner })}</span>` : nothing}
        <span>${t("pcc.updated", { time: formatTime(project.updatedAt) })}</span>
      </div>
      ${progress.blocked > 0 || progress.needsApproval > 0
        ? html`<div class="callout warning" role="alert">
            ${progress.blocked > 0
              ? t("pcc.blocked", { count: String(progress.blocked) })
              : t("pcc.needsApproval", { count: String(progress.needsApproval) })}
          </div>`
        : nothing}
    </section>
  `;
}

function renderMilestones(props: PccPresentationProps): TemplateResult {
  if (props.state.milestones.length === 0) {
    return html`<div class="pcc-muted">${t("pcc.noMilestones")}</div>`;
  }
  return html`
    <div class="pcc-milestones" role="list" aria-label=${t("pcc.milestonesTitle")}>
      ${props.state.milestones.map(
        (milestone) => html`
          <article class="pcc-milestone" role="listitem">
            <div class="pcc-milestone__marker" aria-hidden="true">
              ${milestone.status === "complete" || milestone.status === "complete_with_maintenance"
                ? icons.check
                : icons.circle}
            </div>
            <div class="pcc-milestone__body">
              <div class="pcc-milestone__title">
                <strong>${milestone.title}</strong>
                <span class="pcc-status pcc-status--${milestone.status}"
                  >${statusLabel(milestone.status)}</span
                >
              </div>
              ${milestone.blocker
                ? html`<p class="pcc-milestone__blocker">${milestone.blocker}</p>`
                : nothing}
              ${milestone.owner
                ? html`<span class="pcc-muted">${t("pcc.owner", { owner: milestone.owner })}</span>`
                : nothing}
            </div>
          </article>
        `,
      )}
    </div>
  `;
}

function renderCreateForm(props: PccPresentationProps): TemplateResult {
  if (!props.canWrite) {
    return html``;
  }
  return html`
    <details class="pcc-details">
      <summary>${t("pcc.createProject")}</summary>
      <form
        class="pcc-form"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          const data = new FormData(form);
          props.onCreateProject(
            formStringValue(data.get("title")),
            formStringValue(data.get("goal")),
          );
          form.reset();
        }}
      >
        <label class="pcc-field"
          ><span>${t("pcc.titleLabel")}</span><input name="title" required maxlength="160"
        /></label>
        <label class="pcc-field"
          ><span>${t("pcc.goalLabel")}</span
          ><textarea name="goal" required maxlength="20000" rows="3"></textarea>
        </label>
        <button class="btn primary" ?disabled=${props.state.saving}>
          ${t("pcc.createAction")}
        </button>
      </form>
    </details>
  `;
}

function renderPlanForm(props: PccPresentationProps): TemplateResult {
  if (!props.canWrite || !props.state.project) {
    return html``;
  }
  return html`
    <form
      class="pcc-plan-form"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        props.onStartPlan(formStringValue(data.get("description")));
      }}
    >
      <label class="pcc-field pcc-field--grow"
        ><span>${t("pcc.planLabel")}</span
        ><input
          name="description"
          required
          maxlength="20000"
          placeholder=${t("pcc.planPlaceholder")}
      /></label>
      <button class="btn primary" ?disabled=${props.state.saving}>${t("pcc.startPlan")}</button>
    </form>
    ${props.state.planningRun
      ? html`<div class="pcc-run" role="status">
          <span class="pcc-run__dot pcc-run__dot--${props.state.planningRun.status}"></span>
          ${t("pcc.runStatus", {
            status: statusLabel(props.state.planningRun.status),
            id: props.state.planningRun.id,
          })}
        </div>`
      : nothing}
  `;
}

function renderGoalControls(props: PccPresentationProps): TemplateResult {
  const project = props.state.project;
  const workLoopState = getPccWorkLoopState(project);
  const action = pccGoalPrimaryAction(project, props.state.planningRun);
  if (!project || !action) {
    return html``;
  }
  const labels: Record<PccGoalAction, string> = {
    start: t("pcc.goalActions.start"),
    continue: t("pcc.goalActions.continue"),
    pause: t("pcc.goalActions.pause"),
    resume: t("pcc.goalActions.resume"),
    retry: t("pcc.goalActions.retry"),
    stop: t("pcc.goalActions.stop"),
  };
  const run = props.state.planningRun;
  return html`
    <section class="pcc-section pcc-goal-controls" aria-labelledby="pcc-goal-controls-title">
      <div class="pcc-section__heading">
        <div>
          <h2 id="pcc-goal-controls-title">${t("pcc.goalControlsTitle")}</h2>
          <p class="pcc-muted">${t("pcc.goalControlsHint")}</p>
        </div>
        <span class="pcc-status pcc-status--${workLoopState}">${statusLabel(workLoopState)}</span>
      </div>
      <div class="pcc-goal-controls__actions">
        <button
          class="btn primary"
          ?disabled=${props.state.saving}
          @click=${() => props.onGoalAction(action)}
        >
          ${labels[action]}
        </button>
        ${action === "pause" || action === "resume"
          ? html`<button
              class="btn"
              ?disabled=${props.state.saving}
              @click=${() => props.onGoalAction("stop")}
            >
              ${t("pcc.goalActions.stop")}
            </button>`
          : nothing}
      </div>
      ${run
        ? html`<div class="pcc-run" role="status" aria-live="polite">
            <span class="pcc-run__dot pcc-run__dot--${run.status}"></span>
            ${t("pcc.runStatus", { status: statusLabel(run.status), id: run.id })}
          </div>`
        : nothing}
    </section>
  `;
}

function renderProofAndContext(props: PccPresentationProps): TemplateResult {
  const state = props.state;
  const summary = state.summary;
  const nextActions = summary?.nextActions ?? [];
  const proofGaps = summary?.proofGaps ?? [];
  return html`
    <section class="pcc-section pcc-proof" aria-labelledby="pcc-proof-title">
      <div class="pcc-section__heading">
        <div>
          <h2 id="pcc-proof-title">${t("pcc.proofTitle")}</h2>
          <p class="pcc-muted">${t("pcc.proofHint")}</p>
        </div>
        <span class="pcc-muted"
          >${t("pcc.evidenceCount", { count: String(state.evidence.length) })}</span
        >
      </div>
      <div class="pcc-proof__grid">
        <div>
          <h3>${t("pcc.nextActionsTitle")}</h3>
          ${nextActions.length
            ? html`<ul>
                ${nextActions.map((item) => html`<li>${item}</li>`)}
              </ul>`
            : html`<p class="pcc-muted">${t("pcc.noneRecorded")}</p>`}
        </div>
        <div>
          <h3>${t("pcc.proofGapsTitle")}</h3>
          ${proofGaps.length
            ? html`<ul>
                ${proofGaps.map((item) => html`<li>${item}</li>`)}
              </ul>`
            : html`<p class="pcc-muted">${t("pcc.noProofGaps")}</p>`}
        </div>
        <div>
          <h3>${t("pcc.permissionsTitle")}</h3>
          ${state.permissions.length
            ? html`<ul>
                ${state.permissions.map((item) => html`<li>${item.type}: ${item.status}</li>`)}
              </ul>`
            : html`<p class="pcc-muted">${t("pcc.noPermissions")}</p>`}
        </div>
        <div>
          <h3>${t("pcc.evidenceTitle")}</h3>
          ${state.evidence.length
            ? html`<ul>
                ${state.evidence
                  .slice(0, 6)
                  .map((item) => html`<li>${item.kind}: ${item.status}</li>`)}
              </ul>`
            : html`<p class="pcc-muted">${t("pcc.noneRecorded")}</p>`}
        </div>
      </div>
      <details class="pcc-details">
        <summary>${t("pcc.receiptsAndAttachments")}</summary>
        <p>${t("pcc.receiptsAndAttachmentsCount", { count: String(state.receipts.length) })}</p>
        ${state.attachmentsError
          ? html`<p class="callout warning" role="alert">
              ${t("pcc.attachmentsUnavailable")}: ${state.attachmentsError}
            </p>`
          : state.attachments.length
            ? html`<ul>
                ${state.attachments.map((item) => html`<li>${item.title} · ${item.status}</li>`)}
              </ul>`
            : html`<p class="pcc-muted">${t("pcc.noAttachments")}</p>`}
      </details>
    </section>
  `;
}

function ownerAcceptanceStatusLabel(status: PccOwnerAcceptanceState): string {
  switch (status) {
    case "running":
      return t("pcc.ownerAcceptance.running");
    case "submitting":
      return t("pcc.ownerAcceptance.submitting");
    case "complete":
      return t("pcc.ownerAcceptance.complete");
    case "failed":
      return t("pcc.ownerAcceptance.failed");
    default:
      return t("pcc.ownerAcceptance.ready");
  }
}

function renderOwnerAcceptance(props: PccPresentationProps): TemplateResult {
  const acceptance = props.state.ownerAcceptance;
  const pendingMilestone = props.state.milestones.find(
    (milestone) =>
      milestone.status === "needs_approval" &&
      /owner|acceptance|human|usability/i.test(`${milestone.title} ${milestone.blocker ?? ""}`),
  );
  if (!pendingMilestone && acceptance.state === "idle") {
    return html``;
  }
  const durationMs = 60_000;
  const remainingMs = Math.max(0, durationMs - acceptance.elapsedMs);
  const readyToFinish = acceptance.elapsedMs >= durationMs;
  const elapsedSeconds = Math.min(60, Math.floor(acceptance.elapsedMs / 1000));
  return html`
    <section class="pcc-section pcc-owner-acceptance" aria-labelledby="pcc-owner-acceptance-title">
      <div class="pcc-section__heading">
        <div>
          <h2 id="pcc-owner-acceptance-title">${t("pcc.ownerAcceptance.title")}</h2>
          <p class="pcc-muted">${t("pcc.ownerAcceptance.hint")}</p>
        </div>
        <span class="pcc-status pcc-status--${acceptance.state}">
          ${ownerAcceptanceStatusLabel(acceptance.state)}
        </span>
      </div>
      ${acceptance.state === "idle"
        ? html`<p>${t("pcc.ownerAcceptance.readyDescription")}</p>
            <button
              class="btn primary"
              ?disabled=${props.state.saving || !props.canWrite}
              @click=${props.onStartOwnerAcceptance}
            >
              ${t("pcc.ownerAcceptance.begin")}
            </button>`
        : nothing}
      ${acceptance.state === "running"
        ? html`<div class="pcc-owner-acceptance__timer" role="timer" aria-live="polite">
              <strong
                >${t("pcc.ownerAcceptance.timer", { seconds: String(elapsedSeconds) })}</strong
              >
              <span class="pcc-muted"
                >${t("pcc.ownerAcceptance.remaining", {
                  seconds: String(Math.ceil(remainingMs / 1000)),
                })}</span
              >
            </div>
            <div class="pcc-owner-acceptance__actions">
              <button
                class="btn primary"
                ?disabled=${props.state.saving || !readyToFinish}
                @click=${props.onFinishOwnerAcceptance}
              >
                ${t("pcc.ownerAcceptance.finish")}
              </button>
              <button
                class="btn"
                ?disabled=${props.state.saving}
                @click=${props.onCancelOwnerAcceptance}
              >
                ${t("pcc.ownerAcceptance.cancel")}
              </button>
            </div>`
        : nothing}
      ${acceptance.state === "submitting"
        ? html`<p class="callout" role="status">
            ${t("pcc.ownerAcceptance.submittingDescription")}
          </p>`
        : nothing}
      ${acceptance.state === "complete"
        ? html`<p class="callout" role="status">
            ${t("pcc.ownerAcceptance.completeDescription")}
            ${acceptance.receiptId ? html`<br /><code>${acceptance.receiptId}</code>` : nothing}
          </p>`
        : nothing}
      ${acceptance.state === "failed"
        ? html`<div class="callout warning" role="alert">
            <p>${acceptance.error ?? t("pcc.ownerAcceptance.failedDescription")}</p>
            <button
              class="btn"
              ?disabled=${props.state.saving || !props.canWrite}
              @click=${props.onStartOwnerAcceptance}
            >
              ${t("pcc.ownerAcceptance.beginNew")}
            </button>
          </div>`
        : nothing}
      <p class="pcc-muted">${t("pcc.ownerAcceptance.privacy")}</p>
    </section>
  `;
}

export function renderPccDashboard(props: PccPresentationProps): TemplateResult {
  return html`
    <section class="pcc-page" aria-label=${t("pcc.title")}>
      <header class="pcc-header">
        <div>
          <p class="pcc-eyebrow">${t("pcc.eyebrow")}</p>
          <h1>${t("pcc.title")}</h1>
          <p class="pcc-muted">${t("pcc.subtitle")}</p>
        </div>
        <button
          class="btn"
          @click=${props.onRefresh}
          ?disabled=${props.state.loading}
          aria-label=${t("pcc.refresh")}
        >
          ${props.state.loading
            ? t("common.loading")
            : html`${icons.refresh} ${t("common.refresh")}`}
        </button>
      </header>
      ${!props.connected
        ? html`<div class="callout warning" role="alert">${t("pcc.disconnected")}</div>`
        : nothing}
      ${props.state.error
        ? html`<div class="callout danger" role="alert">${props.state.error}</div>`
        : nothing}
      ${props.state.message
        ? html`<div class="callout" role="status">${props.state.message}</div>`
        : nothing}
      <div class="pcc-toolbar">${renderProjectPicker(props)}${renderCreateForm(props)}</div>
      ${renderProjectSummary(props)}
      ${props.state.project
        ? html`<section class="pcc-section">
            <div class="pcc-section__heading">
              <h2>${t("pcc.milestonesTitle")}</h2>
              <span class="pcc-muted">${t("pcc.milestonesHint")}</span>
            </div>
            ${renderMilestones(props)}
          </section>`
        : nothing}
      ${props.state.project ? renderProofAndContext(props) : nothing}
      ${props.state.project ? renderOwnerAcceptance(props) : nothing}
      ${props.state.project ? renderGoalControls(props) : nothing}
      ${props.state.project
        ? html`<section class="pcc-section">
            <div class="pcc-section__heading">
              <h2>${t("pcc.planTitle")}</h2>
              <span class="pcc-muted">${t("pcc.planHint")}</span>
            </div>
            ${renderPlanForm(props)}
          </section>`
        : nothing}
    </section>
  `;
}

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import { formatDateMs } from "../../format.ts";
import { icons } from "../../icons.ts";
import { derivePccProgress, isPccRunActive, type PccUiState } from "../application/model.ts";

export type PccPresentationProps = {
  state: PccUiState;
  connected: boolean;
  canWrite: boolean;
  onRefresh: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (title: string, goal: string) => void;
  onStartPlan: (description: string) => void;
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
  const active = isPccRunActive(props.state.planningRun);
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
      <button class="btn primary" ?disabled=${props.state.saving || active}>
        ${active ? t("pcc.planning") : t("pcc.startPlan")}
      </button>
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

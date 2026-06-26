// Control UI view renders the Project Command Center dashboard shell.
import { html, nothing } from "lit";
import type { PccPortfolioSummary, PccProjectSummary } from "../types.ts";

export type PccDashboardProps = {
  loading: boolean;
  error: string | null;
  projects: PccProjectSummary[];
  portfolio: PccPortfolioSummary | null;
  updatedAt: number | null;
  onRefresh: () => void;
};

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

function renderMetric(label: string, value: string | number) {
  return html`
    <article class="pcc-metric" aria-label=${label}>
      <span class="pcc-metric__value">${value}</span>
      <span class="pcc-metric__label">${label}</span>
    </article>
  `;
}

function renderProjectCard(project: PccProjectSummary) {
  const percent = clampPercent(project.percentComplete);
  const nextAction = project.nextActions[0] ?? "No next action recorded";
  const proofGap = project.proofGaps[0] ?? "No proof gaps recorded";
  return html`
    <article class="pcc-project-card" data-pcc-project-card>
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
    </article>
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
            <strong>Project Command Center unavailable</strong>
            <span>${props.error}</span>
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

      ${!props.loading && projects.length === 0
        ? html`<div class="pcc-empty" data-pcc-empty>
            <h3>No projects yet</h3>
            <p>
              Project plans will appear here when OpenClaw records them in the Project Command
              Center.
            </p>
          </div>`
        : html`<section class="pcc-project-grid" aria-label="Projects">
            ${projects.map((project) => renderProjectCard(project))}
          </section>`}
    </section>
  `;
}

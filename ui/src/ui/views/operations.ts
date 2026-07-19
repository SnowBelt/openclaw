// Operations Room view presents agent, workflow, capability, resource, and
// reliability truth without implying that configured means currently active.
import { html, nothing } from "lit";
import type {
  OperationsActionKind,
  OperationsCatalogEntry,
  OperationsSnapshot,
  OperationsStatus,
} from "../types.ts";

export type OperationsProps = {
  loading: boolean;
  actionBusy: boolean;
  error: string | null;
  actionNotice: string | null;
  snapshot: OperationsSnapshot | null;
  updatedAt: number | null;
  onRefresh: () => void;
  onAction: (action: OperationsActionKind, targetId: string) => void;
};

const STATUS_LABELS: Record<OperationsStatus, string> = {
  healthy: "Healthy",
  working: "Working",
  idle: "Ready",
  degraded: "Needs attention",
  blocked: "Blocked",
  failed: "Failed",
  disabled: "Off",
  unknown: "Unknown",
};

function bytes(value: number | null): string {
  if (value == null) {
    return "Not attributable";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function relativeTime(value: number | null | undefined): string {
  if (!value) {
    return "No activity recorded";
  }
  const delta = Math.max(0, Date.now() - value);
  if (delta < 60_000) {
    return "just now";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m ago`;
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)}h ago`;
  }
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function relativeScheduleTime(value: number | null | undefined): string {
  if (!value) {
    return "No next run";
  }
  const delta = value - Date.now();
  if (delta <= 0) {
    return "due now";
  }
  if (delta < 60_000) {
    return "in under a minute";
  }
  if (delta < 3_600_000) {
    return `in ${Math.ceil(delta / 60_000)}m`;
  }
  if (delta < 86_400_000) {
    return `in ${Math.ceil(delta / 3_600_000)}h`;
  }
  return `in ${Math.ceil(delta / 86_400_000)}d`;
}

function statusPill(status: OperationsStatus) {
  return html`<span class=${`operations-status operations-status--${status}`}>
    <span class="operations-status__dot" aria-hidden="true"></span>${STATUS_LABELS[status]}
  </span>`;
}

function metric(label: string, value: string | number, detail?: string) {
  return html`<article class="operations-metric">
    <span class="operations-metric__label">${label}</span>
    <strong>${value}</strong>
    ${detail ? html`<span class="operations-metric__detail">${detail}</span>` : nothing}
  </article>`;
}

function catalogSection(title: string, rows: OperationsCatalogEntry[], empty: string) {
  const healthy = rows.filter((row) => row.status === "healthy").length;
  const attention = rows.filter(
    (row) => row.status === "blocked" || row.status === "failed",
  ).length;
  return html`<details class="operations-catalog">
    <summary>
      <span
        ><strong>${title}</strong
        ><small>${healthy} ready · ${attention} need attention</small></span
      >
      <span class="operations-count">${rows.length}</span>
    </summary>
    ${rows.length === 0
      ? html`<p class="muted">${empty}</p>`
      : html`<div class="operations-catalog__grid">
          ${rows.map(
            (row) => html`<article class="operations-catalog__item">
              <div>
                <strong>${row.name}</strong>
                <small>${row.source ?? row.owner ?? row.id}</small>
              </div>
              ${statusPill(row.status)}
              ${row.route
                ? html`<span class=${`operations-route operations-route--${row.route}`}
                    >${row.route}</span
                  >`
                : nothing}
              ${row.reason ? html`<p>${row.reason}</p>` : nothing}
            </article>`,
          )}
        </div>`}
  </details>`;
}

export function renderOperations(props: OperationsProps) {
  const snapshot = props.snapshot;
  return html`<section class="operations-room" aria-labelledby="operations-title">
    <header class="operations-hero">
      <div>
        <p class="operations-eyebrow">OpenClaw control plane</p>
        <h1 id="operations-title">Operations Room</h1>
        <p>One truthful view of agents, workflows, schedules, capabilities, models, and memory.</p>
      </div>
      <div class="operations-hero__actions">
        ${snapshot ? statusPill(snapshot.overallStatus) : nothing}
        <button
          class="btn"
          ?disabled=${props.loading}
          @click=${props.onRefresh}
          aria-label="Refresh Operations Room"
        >
          ${props.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>

    ${props.error
      ? html`<div class="callout danger" role="alert">
          <strong>Operations data unavailable</strong>
          <p>${props.error}</p>
        </div>`
      : nothing}
    ${props.actionNotice
      ? html`<div class="callout success" role="status">${props.actionNotice}</div>`
      : nothing}
    ${!snapshot && props.loading
      ? html`<div class="operations-empty" aria-live="polite">
          Building the current operations picture…
        </div>`
      : nothing}
    ${!snapshot && !props.loading
      ? html`<div class="operations-empty">No operations snapshot is available yet.</div>`
      : nothing}
    ${snapshot
      ? html`
          <div class="operations-scorecard">
            <div
              class="operations-score"
              aria-label=${`Reliability score ${snapshot.qualityScore} out of 100`}
            >
              <strong>${snapshot.qualityScore}</strong><span>/100</span>
              <small>Reliability score · target ${snapshot.qualityTarget}+</small>
            </div>
            <div class="operations-metrics">
              ${metric(
                "Agents",
                snapshot.summary.agents,
                `${snapshot.summary.workingAgents} working · ${snapshot.summary.attentionAgents} need attention`,
              )}
              ${metric(
                "Tasks",
                snapshot.summary.tasks,
                `${snapshot.summary.activeTasks} active · ${snapshot.summary.failedTasks} need attention`,
              )}
              ${metric(
                "Workflows",
                snapshot.summary.workflows,
                `${snapshot.summary.activeWorkflows} active`,
              )}
              ${metric(
                "Schedules",
                snapshot.summary.cronJobs,
                `${snapshot.summary.failingCronJobs} failing`,
              )}
              ${metric(
                "Attention",
                snapshot.summary.findings,
                `${snapshot.summary.criticalFindings} critical`,
              )}
            </div>
          </div>

          <section
            class="operations-panel operations-resources"
            aria-labelledby="operations-resources-title"
          >
            <div class="operations-panel__header">
              <div>
                <p class="operations-eyebrow">Capacity</p>
                <h2 id="operations-resources-title">Mac resources</h2>
              </div>
              ${statusPill(snapshot.host.status)}
            </div>
            <div class="operations-memory">
              <div class="operations-memory__header">
                <span>Memory in use</span><strong>${snapshot.host.memoryUsedPercent}%</strong>
              </div>
              <div
                class="operations-progress"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow=${snapshot.host.memoryUsedPercent}
              >
                <span style=${`width: ${Math.min(100, snapshot.host.memoryUsedPercent)}%`}></span>
              </div>
              <p>
                ${bytes(snapshot.host.usedMemoryBytes)} used ·
                ${bytes(snapshot.host.availableMemoryBytes)} available ·
                ${bytes(snapshot.host.freeMemoryBytes)} free ·
                ${bytes(snapshot.host.totalMemoryBytes)} total
              </p>
            </div>
            <div class="operations-resource-grid">
              ${metric("Gateway RAM", bytes(snapshot.host.processRssBytes))}
              ${metric(
                "CPU",
                `${snapshot.host.logicalCpuCount} logical cores`,
                `Load ${snapshot.host.loadAverage[0].toFixed(2)}`,
              )}
              ${metric(
                "Event loop",
                snapshot.host.eventLoopLagMs == null
                  ? "Unknown"
                  : `${snapshot.host.eventLoopLagMs} ms`,
                "P99 delay",
              )}
              ${metric(
                "Host",
                snapshot.host.hostname,
                `${snapshot.host.platform} · ${snapshot.host.arch}`,
              )}
            </div>
          </section>

          <section class="operations-panel" aria-labelledby="operations-agents-title">
            <div class="operations-panel__header">
              <div>
                <p class="operations-eyebrow">Live room</p>
                <h2 id="operations-agents-title">Agents</h2>
              </div>
              <p class="muted">
                Agent RAM is marked unavailable when agents share the Gateway process.
              </p>
            </div>
            <div class="operations-agent-grid">
              ${snapshot.agents.map(
                (agent) => html`<article
                  class=${`operations-agent operations-agent--${agent.status}`}
                >
                  <div class="operations-agent__top">
                    <span class="operations-agent__avatar" aria-hidden="true"
                      >${(agent.name ?? agent.id).slice(0, 1).toUpperCase()}</span
                    >
                    <div><strong>${agent.name ?? agent.id}</strong><small>${agent.id}</small></div>
                    ${statusPill(agent.status)}
                  </div>
                  <dl>
                    <div>
                      <dt>Duty</dt>
                      <dd>${agent.duty.replaceAll("_", " ")}</dd>
                    </div>
                    <div>
                      <dt>Current work</dt>
                      <dd>${agent.latestTask ?? "Ready for work"}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>${agent.model ?? "Inherited default"}</dd>
                    </div>
                    <div>
                      <dt>Fallback</dt>
                      <dd>${agent.fallbackModels.join(", ") || "No explicit fallback"}</dd>
                    </div>
                    <div>
                      <dt>Heartbeat</dt>
                      <dd>${agent.heartbeat.enabled ? agent.heartbeat.every : "Off"}</dd>
                    </div>
                    <div>
                      <dt>RAM</dt>
                      <dd>${bytes(agent.memoryBytes)}</dd>
                    </div>
                  </dl>
                  <footer>
                    ${agent.activeTaskCount} active · ${agent.blockedTaskCount} failures in 24h ·
                    ${relativeTime(agent.latestActivityAt)}
                  </footer>
                </article>`,
              )}
            </div>
          </section>

          <section class="operations-panel" aria-labelledby="operations-tasks-title">
            <div class="operations-panel__header">
              <div>
                <p class="operations-eyebrow">Runtime work</p>
                <h2 id="operations-tasks-title">Active & recent tasks</h2>
              </div>
              <p class="muted">Active work first, then the latest recorded outcomes.</p>
            </div>
            <div class="operations-list">
              ${snapshot.tasks.length === 0
                ? html`<p class="muted">No managed tasks recorded.</p>`
                : snapshot.tasks.slice(0, 20).map(
                    (task) => html`<article class="operations-list__row">
                      <div class="operations-list__main">
                        <strong>${task.title}</strong>
                        <small
                          >${task.agentId ?? "unassigned"} · ${task.runtime} ·
                          ${relativeTime(task.updatedAt)}</small
                        >
                        ${task.progress ? html`<p>${task.progress}</p>` : nothing}
                        ${task.error ? html`<p>${task.error}</p>` : nothing}
                      </div>
                      <div class="operations-list__aside">
                        ${statusPill(task.status)}
                        ${task.status === "working"
                          ? html`<button
                              class="btn btn--sm"
                              ?disabled=${props.actionBusy}
                              @click=${() => props.onAction("task.cancel", task.id)}
                            >
                              Cancel
                            </button>`
                          : nothing}
                      </div>
                    </article>`,
                  )}
            </div>
          </section>

          <div class="operations-two-column">
            <section class="operations-panel" aria-labelledby="operations-workflows-title">
              <div class="operations-panel__header">
                <div>
                  <p class="operations-eyebrow">Execution</p>
                  <h2 id="operations-workflows-title">Workflows</h2>
                </div>
              </div>
              <div class="operations-list">
                ${snapshot.workflows.length === 0
                  ? html`<p class="muted">No managed workflows recorded.</p>`
                  : snapshot.workflows.map(
                      (flow) => html`<article class="operations-list__row">
                        <div class="operations-list__main">
                          <strong>${flow.title}</strong
                          ><small
                            >${flow.currentStep ?? flow.ownerKey} ·
                            ${relativeTime(flow.updatedAt)}</small
                          >${flow.blocker ? html`<p>${flow.blocker}</p>` : nothing}
                        </div>
                        <div class="operations-list__aside">
                          ${statusPill(flow.status)}<small
                            >${flow.activeTaskCount} active · ${flow.failedTaskCount} failed</small
                          >
                          ${["working", "idle", "blocked"].includes(flow.status)
                            ? html`<button
                                class="btn btn--sm"
                                ?disabled=${props.actionBusy}
                                @click=${() => props.onAction("flow.cancel", flow.id)}
                              >
                                Cancel
                              </button>`
                            : nothing}
                        </div>
                      </article>`,
                    )}
              </div>
            </section>

            <section class="operations-panel" aria-labelledby="operations-cron-title">
              <div class="operations-panel__header">
                <div>
                  <p class="operations-eyebrow">Scheduler</p>
                  <h2 id="operations-cron-title">Scheduled work</h2>
                </div>
              </div>
              <div class="operations-list">
                ${snapshot.cronJobs.length === 0
                  ? html`<p class="muted">No scheduled workflows configured.</p>`
                  : snapshot.cronJobs.map(
                      (job) => html`<article class="operations-list__row">
                        <div class="operations-list__main">
                          <strong>${job.name}</strong
                          ><small
                            >${job.agentId ?? "default agent"} ·
                            ${relativeScheduleTime(job.nextRunAt)}</small
                          >${job.lastError ? html`<p>${job.lastError}</p>` : nothing}
                        </div>
                        <div class="operations-list__aside">
                          ${statusPill(job.status)}
                          <div class="operations-row-actions">
                            <button
                              class="btn btn--sm"
                              ?disabled=${props.actionBusy}
                              @click=${() => props.onAction("cron.run", job.id)}
                            >
                              Run now
                            </button>
                            <button
                              class="btn btn--sm"
                              ?disabled=${props.actionBusy}
                              @click=${() =>
                                props.onAction(
                                  job.enabled ? "cron.disable" : "cron.enable",
                                  job.id,
                                )}
                            >
                              ${job.enabled ? "Pause" : "Enable"}
                            </button>
                          </div>
                        </div>
                      </article>`,
                    )}
              </div>
            </section>
          </div>

          <section class="operations-panel" aria-labelledby="operations-findings-title">
            <div class="operations-panel__header">
              <div>
                <p class="operations-eyebrow">Reconciliation</p>
                <h2 id="operations-findings-title">Attention & recommendations</h2>
              </div>
              <span class="operations-mode">Shadow mode · no automatic changes</span>
            </div>
            ${snapshot.findings.length === 0
              ? html`<div class="operations-good">
                  <strong>No actionable drift found.</strong>
                  <p>The deterministic rules did not find a current blocker.</p>
                </div>`
              : html`<div class="operations-findings">
                  ${snapshot.findings.map(
                    (item) => html`<article
                      class=${`operations-finding operations-finding--${item.severity}`}
                    >
                      <span class="operations-finding__badge">${item.severity}</span>
                      <div>
                        <strong>${item.title}</strong>
                        <p>${item.detail}</p>
                        ${item.recommendedAction
                          ? html`<small>Recommended: ${item.recommendedAction}</small>`
                          : nothing}
                      </div>
                    </article>`,
                  )}
                </div>`}
          </section>

          <section class="operations-panel" aria-labelledby="operations-catalog-title">
            <div class="operations-panel__header">
              <div>
                <p class="operations-eyebrow">Capability map</p>
                <h2 id="operations-catalog-title">Skills, plugins, tools & models</h2>
              </div>
              <p class="muted">Configured and active are shown separately.</p>
            </div>
            <div class="operations-catalogs">
              ${catalogSection("Skills", snapshot.skills, "No skills discovered.")}
              ${catalogSection("Plugins", snapshot.plugins, "No plugins discovered.")}
              ${catalogSection("Tools", snapshot.tools, "No tools discovered.")}
              ${catalogSection("Models", snapshot.models, "No models discovered.")}
            </div>
          </section>

          <section class="operations-panel" aria-labelledby="operations-processes-title">
            <div class="operations-panel__header">
              <div>
                <p class="operations-eyebrow">Host processes</p>
                <h2 id="operations-processes-title">Largest RAM consumers</h2>
              </div>
              <p class="muted">Arguments are never collected.</p>
            </div>
            <div class="operations-processes">
              ${snapshot.processes.length === 0
                ? html`<p class="muted">Process resource details are unavailable.</p>`
                : snapshot.processes
                    .slice(0, 12)
                    .map(
                      (processRow) =>
                        html`<div class="operations-process">
                          <strong>${processRow.command}</strong
                          ><span>${processRow.kind.replaceAll("_", " ")}</span
                          ><span>${bytes(processRow.rssBytes)}</span
                          ><span>${processRow.cpuPercent.toFixed(1)}% CPU</span>
                        </div>`,
                    )}
            </div>
          </section>

          <footer class="operations-footer">
            Updated ${relativeTime(props.updatedAt ?? snapshot.generatedAt)} ·
            ${snapshot.reconciler.note}
          </footer>
        `
      : nothing}
  </section>`;
}

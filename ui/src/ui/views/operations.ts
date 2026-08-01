import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../../lib/format.ts";
import {
  operationsOwnerAcceptanceConfigFromUrl,
  type OperationsOwnerAcceptanceFacts,
} from "../components/operations-owner-acceptance.ts";
import {
  operationsSectionTargetId,
  updateOperationsSectionUrl,
  type OperationsSection,
} from "../controllers/operations-navigation.ts";
import type { OperationsAgentSort } from "../controllers/operations-preferences.ts";
import type {
  OperationsActionKind,
  OperationsActivityState,
  OperationsAgentSnapshot,
  OperationsCatalogEntry,
  OperationsFinding,
  OperationsHealthState,
  OperationsIncidentHistoryEntry,
  OperationsSnapshot,
  OperationsStatus,
} from "../types.ts";
import {
  currentOperationsFindings,
  groupOperationsAgents,
  isOperationsSnapshotStale,
  operationsChangesSince,
  operationsFindingRisk,
  operationsInvestigationDraft,
  operationsResolutionStage,
  operationsWorkingItems,
  type OperationsAgentGroup,
  type OperationsAgentGroupId,
  type OperationsChangeItem,
  type OperationsWorkingItem,
} from "./operations-model.ts";

export type OperationsNavigateTarget = "agents" | "workboard" | "cron" | "skills";

export type OperationsProps = {
  loading: boolean;
  actionBusy: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  error: string | null;
  actionNotice: string | null;
  actionNoticeTone?: "info" | "success" | null;
  snapshot: OperationsSnapshot | null;
  updatedAt: number | null;
  lastSuccessfulAt: number | null;
  refreshFailedAt: number | null;
  section: OperationsSection | null;
  agentQuery: string;
  agentSort: OperationsAgentSort;
  pinnedAgentIds: string[];
  lastVisitedAt: number | null;
  workboardEnabled: boolean;
  onRefresh: () => void;
  onAction: (action: OperationsActionKind, targetId: string) => void;
  onSectionChange: (section: OperationsSection) => void;
  onAgentQueryChange: (value: string) => void;
  onAgentSortChange: (value: OperationsAgentSort) => void;
  onToggleAgentPin: (agentId: string) => void;
  onOpenAgent: (agentId: string) => void;
  onNavigate: (target: OperationsNavigateTarget) => void;
};

const ATTENTION_LANE_PREVIEW_LIMIT = 4;
const WORKING_PREVIEW_LIMIT = 8;

const STATUS_SYMBOL: Record<OperationsStatus, string> = {
  healthy: "✓",
  working: "▶",
  idle: "○",
  degraded: "!",
  blocked: "!",
  failed: "×",
  disabled: "–",
  unknown: "?",
};

const STATUS_KEY: Record<OperationsStatus, string> = {
  healthy: "healthy",
  working: "working",
  idle: "ready",
  degraded: "needsAttention",
  blocked: "blocked",
  failed: "failed",
  disabled: "off",
  unknown: "unknown",
};

const ACTIVITY_STATUS: Record<OperationsActivityState, OperationsStatus> = {
  working: "working",
  waiting: "idle",
  scheduled: "idle",
  ready: "idle",
  off: "disabled",
  unknown: "unknown",
};

const HEALTH_STATUS: Record<OperationsHealthState, OperationsStatus> = {
  healthy: "healthy",
  degraded: "degraded",
  failed: "failed",
  unknown: "unknown",
};

const BRIEFING_STATUS: Record<OperationsSnapshot["briefing"]["tone"], OperationsStatus> = {
  normal: "healthy",
  attention: "degraded",
  urgent: "blocked",
  unknown: "unknown",
};

const SEVERITY_STATUS: Record<OperationsFinding["severity"], OperationsStatus> = {
  info: "idle",
  warning: "degraded",
  critical: "blocked",
};

const DUTY_KEY: Record<OperationsAgentSnapshot["duty"], string> = {
  always_on: "alwaysOn",
  scheduled: "scheduled",
  on_demand: "onDemand",
  disabled: "disabled",
};

const DUTY_SOURCE_KEY: Record<OperationsAgentSnapshot["dutySource"], string> = {
  heartbeat: "heartbeat",
  schedule: "schedule",
  configuration: "configuration",
};

const RUNTIME_KEY: Record<OperationsSnapshot["activityRollups"][number]["runtime"], string> = {
  subagent: "subagent",
  acp: "acp",
  cli: "cli",
  cron: "cron",
};

const SOURCE_KEY: Record<OperationsSnapshot["completeness"]["unavailableSources"][number], string> =
  {
    agents: "agents",
    tasks: "tasks",
    workflows: "workflows",
    schedules: "schedules",
    capabilities: "capabilities",
    models: "models",
    processes: "processes",
    event_loop: "eventLoop",
    monitor: "monitor",
    incident_ledger: "incidentLedger",
  };

const CATEGORY_KEY: Record<OperationsFinding["category"], string> = {
  agent: "agent",
  workflow: "workflow",
  cron: "cron",
  skill: "skill",
  plugin: "plugin",
  tool: "tool",
  model: "model",
  process: "process",
  monitor: "monitor",
  resource: "resource",
  update: "update",
};

function bytes(value: number | null): string {
  if (value == null) {
    return t("operationsRoom.agents.unavailableRam");
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
  return formatRelativeTimestamp(value, { fallback: t("common.never") });
}

function statusLabel(status: OperationsStatus): string {
  return t(`operationsRoom.status.${STATUS_KEY[status]}`);
}

function statusPill(status: OperationsStatus, label = statusLabel(status)) {
  return html`<span class=${`operations-status operations-status--${status}`}>
    <span class="operations-status__icon" aria-hidden="true">${STATUS_SYMBOL[status]}</span>
    ${label}
  </span>`;
}

function severityPill(severity: OperationsFinding["severity"]) {
  return statusPill(SEVERITY_STATUS[severity], t(`operationsRoom.enums.severity.${severity}`));
}

function sourceLabel(
  source: OperationsSnapshot["completeness"]["unavailableSources"][number],
): string {
  return t(`operationsRoom.enums.sources.${SOURCE_KEY[source]}`);
}

function sourceConfirmed(
  snapshot: OperationsSnapshot,
  source: keyof OperationsSnapshot["freshness"]["sources"],
): boolean {
  return snapshot.freshness.sources[source].status === "available";
}

function sectionSourcesConfirmed(
  snapshot: OperationsSnapshot,
  props: OperationsProps,
  ...sources: Array<keyof OperationsSnapshot["freshness"]["sources"]>
): boolean {
  return (
    !isOperationsSnapshotStale(snapshot, Date.now(), props.refreshFailedAt) &&
    sources.every((source) => sourceConfirmed(snapshot, source))
  );
}

function mutationSourceConfirmed(
  snapshot: OperationsSnapshot,
  props: OperationsProps,
  source: keyof OperationsSnapshot["freshness"]["sources"],
): boolean {
  return (
    snapshot.completeness.status === "complete" && sectionSourcesConfirmed(snapshot, props, source)
  );
}

function openOperationsMore(trigger: EventTarget | null, selector?: string) {
  const room = trigger instanceof HTMLElement ? trigger.closest(".operations-room") : null;
  const details =
    room?.querySelector<HTMLDetailsElement>("#operations-more") ??
    document.querySelector<HTMLDetailsElement>("#operations-more");
  if (!details) {
    return;
  }
  details.open = true;
  const target = selector ? details.querySelector<HTMLElement>(selector) : null;
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  }
  const focusTarget =
    target instanceof HTMLDetailsElement
      ? target.querySelector<HTMLElement>("summary")
      : (target ?? details.querySelector<HTMLElement>("summary"));
  const reduceMotion =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  (target ?? details).scrollIntoView?.({
    block: "start",
    behavior: reduceMotion ? "auto" : "smooth",
  });
  focusTarget?.focus({ preventScroll: true });
}

function openWorkDetail(
  props: OperationsProps,
  detail: "tasks" | "workflows",
  trigger: EventTarget | null,
) {
  if (props.workboardEnabled) {
    props.onNavigate("workboard");
    return;
  }
  openOperationsMore(
    trigger,
    detail === "tasks" ? ".operations-activity-history" : ".operations-more-workflows",
  );
}

function workDetailLabel(props: OperationsProps): string {
  return t(
    props.workboardEnabled ? "operationsRoom.working.openWorkboard" : "operationsRoom.more.title",
  );
}

function categoryLabel(category: OperationsFinding["category"]): string {
  return t(`operationsRoom.enums.categories.${CATEGORY_KEY[category]}`);
}

function runtimeLabel(runtime: OperationsSnapshot["activityRollups"][number]["runtime"]): string {
  return t(`operationsRoom.enums.runtimes.${RUNTIME_KEY[runtime]}`);
}

function routeLabel(route: NonNullable<OperationsCatalogEntry["route"]>): string {
  return t(`operationsRoom.enums.routes.${route}`);
}

function processKindLabel(kind: OperationsSnapshot["processes"][number]["kind"]): string {
  return t(`operationsRoom.enums.processKinds.${kind}`);
}

function sectionHref(section: OperationsSection): string {
  if (typeof window === "undefined") {
    return `/operations?section=${section}`;
  }
  const url = updateOperationsSectionUrl(new URL(window.location.href), section);
  return `${url.pathname}${url.search}${url.hash}`;
}

function handleSectionClick(
  event: MouseEvent,
  section: OperationsSection,
  callback: OperationsProps["onSectionChange"],
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  callback(section);
}

function quickLink(params: {
  section: OperationsSection;
  label: string;
  detail: string;
  active: boolean;
  onSectionChange: OperationsProps["onSectionChange"];
}) {
  return html`<a
    class="operations-quick-link"
    href=${sectionHref(params.section)}
    aria-current=${params.active ? "location" : nothing}
    @click=${(event: MouseEvent) =>
      handleSectionClick(event, params.section, params.onSectionChange)}
  >
    <strong>${params.label}</strong><small>${params.detail}</small>
  </a>`;
}

function findingOwnerLabel(finding: OperationsFinding): string {
  return finding.ownerId === "operator" || finding.ownerId === "You"
    ? t("operationsRoom.attention.you")
    : (finding.ownerId ?? t("operationsRoom.attention.unassignedOwner"));
}

function investigationHref(finding: OperationsFinding): string {
  const url = new URL(window.location.href);
  const gateway = url.searchParams.get("gateway");
  url.pathname = "/chat";
  url.search = "";
  if (gateway) {
    url.searchParams.set("gateway", gateway);
  }
  url.searchParams.set("draft", operationsInvestigationDraft(finding));
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

function resolutionStageLabel(finding: OperationsFinding): string {
  return t(`operationsRoom.resolution.stages.${operationsResolutionStage(finding)}`);
}

function dispatchResolutionEvent(name: string, findingId: string) {
  globalThis.dispatchEvent(new CustomEvent(name, { detail: { findingId } }));
}

function renderFindingResolution(
  finding: OperationsFinding,
  props: OperationsProps,
  isPrimary: boolean,
) {
  const risk = operationsFindingRisk(finding);
  const remediation = finding.remediation;
  const needsEscalation =
    remediation?.status === "failed" || remediation?.status === "approval_required";
  const canApplyRecommendedRepair =
    remediation?.status === "confirmation_required" &&
    remediation.risk === "medium" &&
    remediation.judge?.approved === true &&
    props.canAdmin &&
    Boolean(props.snapshot?.controls.supportedActions.includes("remediation.apply"));
  const recommendedFix =
    remediation?.recommendedFix ??
    remediation?.exactRepair ??
    finding.nextAction ??
    finding.recommendedAction ??
    t("operationsRoom.resolution.nextStepUnknown");
  const recommendationReason =
    remediation?.recommendationReason ?? t("operationsRoom.resolution.defaultReason");
  const recommendationConfidence =
    remediation?.confidence ?? remediation?.investigation?.confidence;
  const canUndo =
    remediation?.undoAvailable === true &&
    Boolean(remediation.undoAction) &&
    Boolean(remediation.undoTargetId) &&
    props.canAdmin &&
    Boolean(props.snapshot?.controls.supportedActions.includes(remediation.undoAction!));
  return html`<details
    class="operations-resolution"
    @toggle=${(event: Event) => {
      if (isPrimary && (event.currentTarget as HTMLDetailsElement).open) {
        dispatchResolutionEvent("openclaw-operations-resolution-opened", finding.id);
      }
    }}
  >
    <summary
      aria-label=${t("operationsRoom.resolution.resolveFor", {
        title: finding.title,
      })}
    >
      ${t("operationsRoom.resolution.recommendation")}
    </summary>
    <p class="operations-resolution__preview-note" role="note">
      <strong>${t("operationsRoom.resolution.previewOnly")}</strong>
      ${t("operationsRoom.resolution.previewOnlyDetail")}
    </p>
    <div class="operations-resolution__intro">
      <strong>${t("operationsRoom.resolution.whatHappened")}</strong>
      <p>${finding.title}. ${finding.impact}</p>
    </div>
    <dl>
      <div>
        <dt>${t("operationsRoom.attention.impact")}</dt>
        <dd>${finding.impact}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.progress")}</dt>
        <dd>${remediation?.progress ?? resolutionStageLabel(finding)}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.attention.owner")}</dt>
        <dd>${findingOwnerLabel(finding)}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.attention.response")}</dt>
        <dd>${t(`operationsRoom.attention.responseStates.${finding.responseState}`)}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.risk")}</dt>
        <dd>${t(`operationsRoom.resolution.risks.${remediation?.risk ?? risk}`)}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.recommendedFix")}</dt>
        <dd>${recommendedFix}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.whyRecommended")}</dt>
        <dd>${recommendationReason}</dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.confidence")}</dt>
        <dd>
          ${recommendationConfidence == null
            ? t("operationsRoom.resolution.confidencePending")
            : t("operationsRoom.resolution.confidenceValue", {
                confidence: String(Math.round(recommendationConfidence * 100)),
              })}
        </dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.changePreview")}</dt>
        <dd>
          ${remediation?.expectedChange ?? t("operationsRoom.resolution.investigationPreview")}
        </dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.verification")}</dt>
        <dd>
          ${remediation?.verificationPlan ?? t("operationsRoom.resolution.verificationPending")}
        </dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.approval")}</dt>
        <dd>
          ${remediation?.automatic
            ? t("operationsRoom.resolution.automaticPolicy")
            : canApplyRecommendedRepair
              ? t("operationsRoom.resolution.oneConfirmation")
              : t("operationsRoom.resolution.approvalRequired")}
        </dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.evidence")}</dt>
        <dd>
          ${remediation?.evidence.length || remediation?.investigation || remediation?.judge
            ? html`<ul class="operations-resolution__evidence">
                ${remediation.investigation
                  ? html`<li>
                      ${t("operationsRoom.resolution.localReview", {
                        confidence: String(Math.round(remediation.investigation.confidence * 100)),
                        recommendation: remediation.investigation.recommendation,
                      })}
                    </li>`
                  : nothing}
                ${remediation.judge
                  ? html`<li>
                      ${t("operationsRoom.resolution.judgeReview", {
                        decision: t(
                          remediation.judge.approved
                            ? "operationsRoom.resolution.approved"
                            : "operationsRoom.resolution.rejected",
                        ),
                        reason: remediation.judge.reason,
                      })}
                    </li>`
                  : nothing}
                ${remediation.evidence.map((entry) => html`<li>${entry}</li>`)}
              </ul>`
            : t("operationsRoom.resolution.evidenceLocation")}
        </dd>
      </div>
      <div>
        <dt>${t("operationsRoom.resolution.rollback")}</dt>
        <dd>${remediation?.rollback ?? t("operationsRoom.resolution.investigationRollback")}</dd>
      </div>
      ${remediation
        ? html`<div>
            <dt>${t("operationsRoom.resolution.undoAvailability")}</dt>
            <dd>
              ${t(
                remediation.undoAvailable
                  ? "operationsRoom.resolution.undoAvailable"
                  : "operationsRoom.resolution.undoUnavailable",
              )}
            </dd>
          </div>`
        : nothing}
      ${remediation?.result
        ? html`<div>
            <dt>${t("operationsRoom.resolution.result")}</dt>
            <dd>${remediation.result}</dd>
          </div>`
        : nothing}
      ${finding.lastProgressAt != null
        ? html`<div>
            <dt>${t("operationsRoom.attention.lastProgress")}</dt>
            <dd>${relativeTime(finding.lastProgressAt)}</dd>
          </div>`
        : nothing}
      ${finding.nextCheckAt != null
        ? html`<div>
            <dt>${t("operationsRoom.attention.nextCheck")}</dt>
            <dd>${formatRelativeTimestamp(finding.nextCheckAt)}</dd>
          </div>`
        : nothing}
      ${finding.remediationTaskId
        ? html`<div>
            <dt>${t("operationsRoom.attention.remediationTask")}</dt>
            <dd>${finding.remediationTaskId}</dd>
          </div>`
        : nothing}
      <div>
        <dt>${t("operationsRoom.resolution.progressLocationLabel")}</dt>
        <dd>${remediation?.progressLocation ?? t("operationsRoom.resolution.evidenceLocation")}</dd>
      </div>
    </dl>
    <p class="operations-resolution__safeguard" role="note">
      ${t("operationsRoom.resolution.safeguard")}
    </p>
    <div class="operations-resolution__actions">
      <button
        type="button"
        class="btn btn--sm operations-resolution__defer"
        @click=${(event: Event) => {
          const details = (event.currentTarget as HTMLElement).closest("details");
          if (details instanceof HTMLDetailsElement) {
            details.open = false;
            details.querySelector("summary")?.focus();
          }
          if (isPrimary) {
            dispatchResolutionEvent("openclaw-operations-resolution-deferred", finding.id);
          }
        }}
      >
        ${t("operationsRoom.resolution.notNow")}
      </button>
      ${finding.remediationTaskId
        ? html`<button
            class="btn btn--sm operations-remediation-link"
            @click=${(event: Event) => openWorkDetail(props, "tasks", event.currentTarget)}
          >
            ${props.workboardEnabled
              ? t("operationsRoom.attention.openRemediation")
              : t("operationsRoom.more.title")}
          </button>`
        : nothing}
      ${canUndo
        ? html`<button
            type="button"
            class="btn btn--sm btn--primary operations-remediation-undo"
            @click=${() => props.onAction(remediation!.undoAction!, remediation!.undoTargetId!)}
          >
            ${t("operationsRoom.resolution.undo")}
          </button>`
        : nothing}
      ${canApplyRecommendedRepair
        ? html`<button
            class="btn btn--sm btn--primary"
            ?disabled=${props.actionBusy}
            @click=${() => props.onAction("remediation.apply", remediation!.id)}
          >
            ${t("operationsRoom.resolution.fixThis")}
          </button>`
        : remediation && !needsEscalation
          ? nothing
          : html`<a class="btn btn--sm btn--primary" href=${investigationHref(finding)}>
              ${needsEscalation
                ? t("operationsRoom.resolution.reviewEscalation")
                : t("operationsRoom.resolution.fixThis")}
            </a>`}
    </div>
    ${canApplyRecommendedRepair || (remediation && !needsEscalation)
      ? nothing
      : html`<small class="operations-muted">${t("operationsRoom.resolution.draftNotice")}</small>`}
  </details>`;
}

function renderFinding(
  finding: OperationsFinding,
  props: OperationsProps,
  primaryFindingId: string | null,
) {
  const isPrimary = finding.id === primaryFindingId;
  const nextAction =
    finding.nextAction ??
    finding.recommendedAction ??
    t("operationsRoom.resolution.nextStepUnknown");
  return html`<article
    class=${`operations-issue operations-issue--${finding.severity}${isPrimary ? " operations-issue--primary" : ""}`}
  >
    ${isPrimary
      ? html`<p class="operations-issue__priority-label">
          ${t("operationsRoom.attention.highestPriority")}
        </p>`
      : nothing}
    <div class="operations-issue__heading">
      <strong>${finding.title}</strong>
      <span class="operations-issue__status">
        ${finding.evidenceState === "last_known"
          ? statusPill("unknown", t("operationsRoom.attention.lastKnown"))
          : nothing}
        ${severityPill(finding.severity)}
      </span>
    </div>
    <p class="operations-line-clamp">${finding.impact}</p>
    <div class="operations-issue__handoff">
      <div>
        <small>${t("operationsRoom.attention.whoOwnsThis")}</small>
        <strong>${findingOwnerLabel(finding)}</strong>
      </div>
      <div>
        <small>${t("operationsRoom.attention.whatHappensNext")}</small>
        <strong>${nextAction}</strong>
      </div>
    </div>
    <p class="operations-issue__assignment">
      ${t("operationsRoom.attention.response")}:
      <strong>${t(`operationsRoom.attention.responseStates.${finding.responseState}`)}</strong>
    </p>
    <small class="operations-muted">
      ${t("operationsRoom.attention.observed", {
        time: relativeTime(finding.firstObservedAt ?? finding.lastObservedAt),
      })}
    </small>
    ${renderFindingResolution(finding, props, isPrimary)}
  </article>`;
}

function renderAttentionLane(params: {
  title: string;
  findings: OperationsFinding[];
  total: number;
  empty: string;
  props: OperationsProps;
  primaryFindingId: string | null;
}) {
  return html`<section class="operations-attention-lane">
    <h3>
      <span>${params.title}</span
      ><span class="operations-count"
        >${params.findings.length === params.total
          ? String(params.total)
          : t("operationsRoom.counts.compactShown", {
              shown: String(params.findings.length),
              total: String(params.total),
            })}</span
      >
    </h3>
    ${params.findings.length === 0
      ? html`<p class="operations-muted">
          ${params.total === 0
            ? params.empty
            : t("operationsRoom.attention.outsidePreview", {
                count: String(params.total),
              })}
        </p>`
      : html`<div class="operations-attention-list">
          ${repeat(
            params.findings,
            (finding) => finding.id,
            (finding) => renderFinding(finding, params.props, params.primaryFindingId),
          )}
        </div>`}
  </section>`;
}

function renderAttentionUncertainty(params: {
  snapshot: OperationsSnapshot;
  stale: boolean;
  partial: boolean;
}) {
  if (!params.stale && !params.partial) {
    return nothing;
  }
  const unavailable = params.snapshot.completeness.unavailableSources.map(sourceLabel);
  const fallback = params.snapshot.completeness.fallbackSources.map(sourceLabel);
  return html`<div class="operations-attention-unknown" role="status">
    ${statusPill("unknown", t(params.stale ? "operationsRoom.stale" : "operationsRoom.partial"))}
    <div>
      <strong>${t("operationsRoom.attention.unconfirmedTitle")}</strong>
      <p>${t("operationsRoom.attention.unconfirmedDetail")}</p>
      ${unavailable.length > 0
        ? html`<small>
            ${t("operationsRoom.unavailableSources", { sources: unavailable.join(", ") })}
          </small>`
        : nothing}
      ${fallback.length > 0
        ? html`<small>
            ${t("operationsRoom.fallbackSources", { sources: fallback.join(", ") })}
          </small>`
        : nothing}
    </div>
  </div>`;
}

function renderAttention(
  snapshot: OperationsSnapshot,
  options: { stale: boolean; partial: boolean },
  props: OperationsProps,
) {
  const current = currentOperationsFindings(snapshot);
  const primaryFindingId = current[0]?.id ?? null;
  const uncertain = options.stale || options.partial;
  const needsUser = current
    .filter((finding) => finding.disposition === "needs_user")
    .slice(0, ATTENTION_LANE_PREVIEW_LIMIT);
  const handling = current
    .filter((finding) => finding.disposition === "handling")
    .slice(0, ATTENTION_LANE_PREVIEW_LIMIT);
  const watching = current
    .filter((finding) => finding.disposition === "watching")
    .slice(0, ATTENTION_LANE_PREVIEW_LIMIT);
  const previewCount = needsUser.length + handling.length + watching.length;
  const hasCurrent = snapshot.summary.actionableFindings > 0;
  return html`<section
    id=${operationsSectionTargetId("attention")}
    class="operations-panel"
    tabindex="-1"
    aria-labelledby="operations-attention-title"
  >
    <div class="operations-panel__header">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.attention.eyebrow")}</p>
        <h2 id="operations-attention-title">${t("operationsRoom.attention.title")}</h2>
        <p>${t("operationsRoom.attention.subtitle")}</p>
      </div>
      ${uncertain
        ? statusPill(
            "unknown",
            t(options.stale ? "operationsRoom.stale" : "operationsRoom.partial"),
          )
        : snapshot.summary.criticalFindings > 0
          ? statusPill("blocked", t("operationsRoom.status.urgent"))
          : hasCurrent
            ? statusPill(
                "degraded",
                t("operationsRoom.attention.currentCount", {
                  count: String(snapshot.summary.actionableFindings),
                }),
              )
            : statusPill("healthy", t("operationsRoom.attention.noCritical"))}
    </div>
    ${snapshot.reconciler.autoRemediationEnabled
      ? html`<p class="operations-auto-repair-note" role="status">
          <strong>${t("operationsRoom.resolution.automaticPolicy")}</strong>
        </p>`
      : nothing}
    ${renderAttentionUncertainty({ snapshot, ...options })}
    ${previewCount < snapshot.summary.actionableFindings
      ? html`<div class="operations-bounded-note" role="status">
          <p>
            ${t("operationsRoom.attention.showingCurrent", {
              shown: String(previewCount),
              total: String(snapshot.summary.actionableFindings),
            })}
          </p>
          <div class="operations-card-actions">
            <button
              class="btn btn--sm"
              @click=${(event: Event) => openWorkDetail(props, "workflows", event.currentTarget)}
            >
              ${workDetailLabel(props)}
            </button>
            <button class="btn btn--sm" @click=${() => props.onNavigate("cron")}>
              ${t("operationsRoom.automationsPanel.openCron")}
            </button>
            <button class="btn btn--sm" @click=${() => props.onNavigate("skills")}>
              ${t("tabs.skills")}
            </button>
            <button class="btn btn--sm" @click=${() => props.onNavigate("agents")}>
              ${t("tabs.agents")}
            </button>
            <button
              class="btn btn--sm"
              @click=${(event: Event) => openOperationsMore(event.currentTarget)}
            >
              ${t("operationsRoom.more.title")}
            </button>
          </div>
        </div>`
      : nothing}
    ${!hasCurrent && !uncertain
      ? html`<div class="operations-good">
          <strong>${t("operationsRoom.attention.none")}</strong>
        </div>`
      : hasCurrent
        ? html`<div class="operations-attention-lanes">
            ${renderAttentionLane({
              title: t("operationsRoom.attention.needsYou"),
              findings: needsUser,
              total: snapshot.summary.needsUserFindings,
              empty: t("operationsRoom.attention.noneNeedsYou"),
              props,
              primaryFindingId,
            })}
            ${renderAttentionLane({
              title: t("operationsRoom.attention.handling"),
              findings: handling,
              total: snapshot.summary.handlingFindings,
              empty: t("operationsRoom.attention.noneHandling"),
              props,
              primaryFindingId,
            })}
            ${renderAttentionLane({
              title: t("operationsRoom.attention.watching"),
              findings: watching,
              total: snapshot.summary.watchingFindings,
              empty: t("operationsRoom.attention.noneWatching"),
              props,
              primaryFindingId,
            })}
          </div>`
        : nothing}
  </section>`;
}

function renderWorkingItem(
  item: OperationsWorkingItem,
  props: OperationsProps,
  workConfirmed: boolean,
) {
  const taskMutationSafe = props.snapshot
    ? mutationSourceConfirmed(props.snapshot, props, "tasks")
    : false;
  const workflowMutationSafe = props.snapshot
    ? mutationSourceConfirmed(props.snapshot, props, "workflows")
    : false;
  return html`<details class="operations-work-row">
    <summary class="operations-work-row__summary">
      <div class="operations-work-row__main">
        <strong class="operations-line-clamp">${item.title}</strong>
        <small>
          ${item.agentId ?? t("operationsRoom.openClaw")} · ${relativeTime(item.updatedAt)}
          ${item.count > 1
            ? ` · ${t("operationsRoom.working.relatedRuns", { count: String(item.count) })}`
            : nothing}
        </small>
      </div>
      ${workConfirmed
        ? statusPill("working")
        : statusPill("unknown", t("operationsRoom.working.unverified"))}
    </summary>
    <div class="operations-work-row__details">
      ${item.summary ? html`<p>${item.summary}</p>` : nothing}
      <div class="operations-card-actions">
        <button
          class="btn btn--sm"
          @click=${(event: Event) =>
            openWorkDetail(
              props,
              item.workflowId && !item.taskId ? "workflows" : "tasks",
              event.currentTarget,
            )}
        >
          ${workDetailLabel(props)}
        </button>
        ${item.taskId &&
        props.canWrite &&
        props.snapshot?.controls.supportedActions.includes("task.cancel")
          ? html`<button
              class="btn btn--sm"
              aria-label=${t("operationsRoom.actions.cancelWork", { title: item.title })}
              title=${taskMutationSafe ? nothing : t("operationsRoom.actions.unavailable")}
              ?disabled=${props.actionBusy || !taskMutationSafe}
              @click=${() => props.onAction("task.cancel", item.taskId!)}
            >
              ${t("operationsRoom.actions.cancel")}
            </button>`
          : nothing}
        ${item.workflowId &&
        props.canWrite &&
        props.snapshot?.controls.supportedActions.includes("flow.cancel")
          ? html`<button
              class="btn btn--sm"
              aria-label=${t("operationsRoom.actions.cancelWork", { title: item.title })}
              title=${workflowMutationSafe ? nothing : t("operationsRoom.actions.unavailable")}
              ?disabled=${props.actionBusy || !workflowMutationSafe}
              @click=${() => props.onAction("flow.cancel", item.workflowId!)}
            >
              ${t("operationsRoom.actions.cancel")}
            </button>`
          : nothing}
      </div>
    </div>
  </details>`;
}

function renderWorking(
  snapshot: OperationsSnapshot,
  options: { stale: boolean; partial: boolean },
  props: OperationsProps,
) {
  const items = operationsWorkingItems(snapshot);
  const preview = items.slice(0, WORKING_PREVIEW_LIMIT);
  const workConfirmed =
    !options.stale &&
    !options.partial &&
    sourceConfirmed(snapshot, "tasks") &&
    sourceConfirmed(snapshot, "workflows") &&
    sourceConfirmed(snapshot, "agents");
  const sourceBounded =
    snapshot.collections.tasks.truncated ||
    snapshot.collections.workflows.truncated ||
    snapshot.collections.agents.truncated ||
    snapshot.collections.activityRollups.truncated;
  const previewBounded = items.length > preview.length || sourceBounded;
  const hasSupportedMutation =
    props.canWrite &&
    snapshot.controls.supportedActions.some(
      (action) => action === "task.cancel" || action === "flow.cancel",
    );
  return html`<section
    id=${operationsSectionTargetId("working")}
    class="operations-panel"
    tabindex="-1"
    aria-labelledby="operations-working-title"
  >
    <div class="operations-panel__header">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.working.eyebrow")}</p>
        <h2 id="operations-working-title">${t("operationsRoom.working.title")}</h2>
        <p>${t("operationsRoom.working.subtitle")}</p>
      </div>
      ${workConfirmed
        ? statusPill(items.length > 0 ? "working" : "idle", `${items.length}`)
        : statusPill("unknown", t("operationsRoom.working.unverified"))}
    </div>
    <div class="operations-work-facts" aria-label=${t("operationsRoom.working.workTotals")}>
      <button
        type="button"
        @click=${(event: Event) => openWorkDetail(props, "tasks", event.currentTarget)}
      >
        <strong>${t("operationsRoom.working.tasks")}</strong>
        <small>
          ${workConfirmed
            ? t("operationsRoom.working.taskTotals", {
                active: String(snapshot.summary.activeTasks),
                failed: String(snapshot.summary.failedTasks),
                total: String(snapshot.summary.tasks),
              })
            : t("operationsRoom.working.countsUnconfirmed")}
        </small>
      </button>
      <button
        type="button"
        @click=${(event: Event) => openWorkDetail(props, "workflows", event.currentTarget)}
      >
        <strong>${t("operationsRoom.working.workflows")}</strong>
        <small>
          ${workConfirmed
            ? t("operationsRoom.working.workflowTotals", {
                active: String(snapshot.summary.activeWorkflows),
                total: String(snapshot.summary.workflows),
              })
            : t("operationsRoom.working.countsUnconfirmed")}
        </small>
      </button>
    </div>
    ${hasSupportedMutation && !workConfirmed
      ? html`<p class="operations-muted operations-action-guard" role="status">
          ${t("operationsRoom.actions.unavailable")}
        </p>`
      : nothing}
    ${items.length === 0
      ? html`<p class="operations-muted">
          ${sourceConfirmed(snapshot, "tasks") &&
          sourceConfirmed(snapshot, "workflows") &&
          sourceConfirmed(snapshot, "agents")
            ? t("operationsRoom.working.none")
            : t("operationsRoom.working.unconfirmed")}
        </p>`
      : html`<div class="operations-work-list">
          ${repeat(
            preview,
            (item) => item.id,
            (item) => renderWorkingItem(item, props, workConfirmed),
          )}
        </div>`}
    ${previewBounded
      ? html`<div class="operations-bounded-note" role="status">
          <p>${t("operationsRoom.working.showingPreview", { shown: String(preview.length) })}</p>
          <button
            class="btn btn--sm"
            @click=${(event: Event) => openWorkDetail(props, "tasks", event.currentTarget)}
          >
            ${workDetailLabel(props)}
          </button>
        </div>`
      : nothing}
  </section>`;
}

function renderChange(change: OperationsChangeItem, props?: OperationsProps): TemplateResult {
  if (change.kind === "activity") {
    const result = t(`operationsRoom.changes.outcomes.${change.rollup.status}`);
    return html`<article class="operations-change">
      <strong>${change.rollup.title}</strong>
      <p>
        ${t(
          change.rollup.count === 1
            ? "operationsRoom.changes.activitySummaryOne"
            : "operationsRoom.changes.activitySummary",
          {
            count: String(change.rollup.count),
            runtime: runtimeLabel(change.rollup.runtime),
            result,
          },
        )}
      </p>
      <small>${relativeTime(change.at)}</small>
    </article>`;
  }
  if (change.kind === "remediation") {
    const remediation = change.remediation;
    const canUndo =
      remediation.undoAvailable &&
      Boolean(remediation.undoAction) &&
      Boolean(remediation.undoTargetId) &&
      props?.canAdmin === true &&
      Boolean(props.snapshot?.controls.supportedActions.includes(remediation.undoAction!));
    return html`<article class="operations-change operations-change--remediation">
      <strong>${remediation.findingTitle}</strong>
      <p>
        ${t(`operationsRoom.changes.remediationOutcomes.${remediation.status}`)} ·
        ${remediation.result ?? remediation.progress}
      </p>
      <small>${relativeTime(change.at)}</small>
      <details class="operations-change__details">
        <summary>${t("operationsRoom.resolution.viewRepairDetails")}</summary>
        <dl>
          <div>
            <dt>${t("operationsRoom.attention.owner")}</dt>
            <dd>${remediation.ownerId}</dd>
          </div>
          <div>
            <dt>${t("operationsRoom.resolution.risk")}</dt>
            <dd>${t(`operationsRoom.resolution.risks.${remediation.risk}`)}</dd>
          </div>
          <div>
            <dt>${t("operationsRoom.resolution.changePreview")}</dt>
            <dd>${remediation.exactRepair}</dd>
          </div>
          <div>
            <dt>${t("operationsRoom.resolution.evidence")}</dt>
            <dd>
              ${remediation.evidence.length
                ? html`<ul class="operations-resolution__evidence">
                    ${remediation.evidence.map((entry) => html`<li>${entry}</li>`)}
                  </ul>`
                : t("operationsRoom.resolution.evidenceLocation")}
            </dd>
          </div>
          <div>
            <dt>${t("operationsRoom.resolution.rollback")}</dt>
            <dd>${remediation.rollback}</dd>
          </div>
          <div>
            <dt>${t("operationsRoom.resolution.undoAvailability")}</dt>
            <dd>
              ${t(
                remediation.undoAvailable
                  ? "operationsRoom.resolution.undoAvailable"
                  : "operationsRoom.resolution.undoUnavailable",
              )}
            </dd>
          </div>
        </dl>
        ${canUndo
          ? html`<button
              type="button"
              class="btn btn--sm operations-remediation-undo"
              @click=${() => props!.onAction(remediation.undoAction!, remediation.undoTargetId!)}
            >
              ${t("operationsRoom.resolution.undo")}
            </button>`
          : nothing}
      </details>
    </article>`;
  }
  const resolved = change.incident.resolvedAt != null;
  return html`<article class="operations-change">
    <strong>${change.incident.title}</strong>
    <p>
      ${t(
        resolved
          ? "operationsRoom.changes.incidentResolved"
          : "operationsRoom.changes.incidentChanged",
      )}
      · ${categoryLabel(change.incident.category)}
    </p>
    <small>${relativeTime(change.at)}</small>
  </article>`;
}

function renderChanges(
  snapshot: OperationsSnapshot,
  lastVisitedAt: number | null,
  props: OperationsProps,
) {
  const allChanges = operationsChangesSince(snapshot, lastVisitedAt);
  const changes = allChanges.slice(0, 12);
  const bounded =
    allChanges.length > changes.length ||
    snapshot.collections.activityRollups.truncated ||
    snapshot.collections.incidentHistory.truncated;
  const changesConfirmed = sectionSourcesConfirmed(snapshot, props, "tasks", "incident_ledger");
  return html`<section
    id="operations-changes"
    class="operations-panel"
    aria-labelledby="operations-changes-title"
  >
    <div class="operations-panel__header">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.changes.eyebrow")}</p>
        <h2 id="operations-changes-title">
          ${lastVisitedAt
            ? t("operationsRoom.changes.title")
            : t("operationsRoom.changes.firstVisit")}
        </h2>
      </div>
    </div>
    ${!changesConfirmed
      ? html`<p class="operations-muted" role="status">
          ${t("operationsRoom.changes.unconfirmed")}
        </p>`
      : nothing}
    ${changes.length === 0
      ? changesConfirmed
        ? html`<p class="operations-muted">${t("operationsRoom.changes.none")}</p>`
        : nothing
      : html`<div class="operations-change-list">
          ${repeat(
            changes,
            (change) => change.id,
            (change) => renderChange(change, props),
          )}
        </div>`}
    ${bounded
      ? html`<div class="operations-bounded-note" role="status">
          <p>${t("operationsRoom.changes.showingNewest", { count: String(changes.length) })}</p>
          <button
            class="btn btn--sm"
            @click=${(event: Event) => openOperationsMore(event.currentTarget)}
          >
            ${t("operationsRoom.changes.openActivity")}
          </button>
        </div>`
      : nothing}
  </section>`;
}

function agentActivityPill(agent: OperationsAgentSnapshot) {
  const status = ACTIVITY_STATUS[agent.activityState];
  const label =
    agent.activityState === "waiting"
      ? t("operationsRoom.status.waiting")
      : agent.activityState === "scheduled"
        ? t("operationsRoom.status.scheduled")
        : statusLabel(status);
  return statusPill(status, label);
}

function agentHealthPill(agent: OperationsAgentSnapshot) {
  return statusPill(HEALTH_STATUS[agent.healthState]);
}

function agentAttentionPill(agent: OperationsAgentSnapshot) {
  if (agent.attentionState === "urgent") {
    return statusPill("blocked", t("operationsRoom.status.urgent"));
  }
  if (agent.attentionState === "needs_user") {
    return statusPill("degraded", t("operationsRoom.status.needsAttention"));
  }
  if (agent.attentionState === "handling") {
    return statusPill("degraded", t("operationsRoom.attention.handling"));
  }
  if (agent.attentionState === "watching") {
    return statusPill("degraded", t("operationsRoom.attention.watching"));
  }
  return nothing;
}

function activeAgentWork(agent: OperationsAgentSnapshot) {
  return agent.currentWork?.outcome === "active" ? agent.currentWork : null;
}

function agentActivityLabel(agent: OperationsAgentSnapshot): string {
  switch (agent.activityState) {
    case "working":
      return t("operationsRoom.status.working");
    case "waiting":
      return t("operationsRoom.status.waiting");
    case "scheduled":
      return t("operationsRoom.status.scheduled");
    case "ready":
      return t("operationsRoom.agents.readyForWork");
    case "off":
      return t("operationsRoom.status.off");
    default:
      return t("operationsRoom.status.unknown");
  }
}

function agentAttentionSummary(agent: OperationsAgentSnapshot): string | null {
  if (agent.attentionState === "urgent") {
    return t("operationsRoom.agents.urgentIssueNeedsDecision");
  }
  if (agent.attentionState === "needs_user") {
    return t(
      agent.blockedTaskCount === 1
        ? "operationsRoom.agents.blockedTaskNeedsDecision"
        : "operationsRoom.agents.blockedTasksNeedDecision",
      { count: String(agent.blockedTaskCount) },
    );
  }
  if (agent.attentionState === "handling") {
    return t("operationsRoom.agents.issueBeingHandled");
  }
  if (agent.attentionState === "watching") {
    return t("operationsRoom.agents.issueBeingWatched");
  }
  return null;
}

function renderAgentRow(
  agent: OperationsAgentSnapshot,
  props: OperationsProps,
  agentsConfirmed: boolean,
) {
  const name = agent.name ?? agent.id;
  const pinned = props.pinnedAgentIds.includes(agent.id);
  const current = activeAgentWork(agent);
  const last = agent.lastActivity;
  const attentionSummary = agentAttentionSummary(agent);
  return html`<details class="operations-agent-row">
    <summary class="operations-agent-row__summary">
      <span class="operations-agent-row__avatar" aria-hidden="true"
        >${name.slice(0, 1).toUpperCase()}</span
      >
      <div class="operations-agent-row__identity">
        <strong
          >${name}${pinned
            ? html` <span aria-label=${t("operationsRoom.agents.pinned")}>★</span>`
            : nothing}</strong
        >
        <small class="operations-line-clamp">
          ${attentionSummary ?? current?.title ?? agentActivityLabel(agent)} · ${agent.id}
        </small>
      </div>
      <div class="operations-agent-row__states">
        ${agentsConfirmed
          ? html`${agentActivityPill(agent)} ${agentHealthPill(agent)} ${agentAttentionPill(agent)}`
          : statusPill("unknown", t("operationsRoom.agents.unconfirmedShort"))}
      </div>
    </summary>
    <div class="operations-agent-row__details">
      ${attentionSummary
        ? html`<div class="operations-agent-guidance" role="status">
            <strong>${t("operationsRoom.agents.whatNeedsAttention")}</strong>
            <p>${attentionSummary}</p>
          </div>`
        : nothing}
      ${current?.summary ? html`<p>${current.summary}</p>` : nothing}
      <dl>
        <div>
          <dt>${t("operationsRoom.agents.duty")}</dt>
          <dd>
            ${t(`operationsRoom.enums.duties.${DUTY_KEY[agent.duty]}`)} ·
            ${t(`operationsRoom.enums.dutySources.${DUTY_SOURCE_KEY[agent.dutySource]}`)}
          </dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.currentWork")}</dt>
          <dd>${current?.title ?? t("operationsRoom.agents.noCurrentWork")}</dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.lastActivity")}</dt>
          <dd>
            ${last
              ? `${last.title} · ${relativeTime(last.updatedAt)}`
              : relativeTime(agent.latestActivityAt)}
          </dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.taskCounts")}</dt>
          <dd>
            ${t("operationsRoom.agents.taskCountSummary", {
              active: String(agent.activeTaskCount),
              blocked: String(agent.blockedTaskCount),
            })}
          </dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.model")}</dt>
          <dd>${agent.model ?? t("operationsRoom.agents.inheritedDefault")}</dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.fallback")}</dt>
          <dd>${agent.fallbackModels.join(", ") || t("operationsRoom.agents.noFallback")}</dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.heartbeat")}</dt>
          <dd>
            ${agent.heartbeat.enabled ? agent.heartbeat.every : t("operationsRoom.status.off")}
          </dd>
        </div>
        <div>
          <dt>${t("operationsRoom.agents.ram")}</dt>
          <dd>${bytes(agent.memoryBytes)}</dd>
        </div>
      </dl>
      <div class="operations-card-actions">
        ${agent.attentionState === "urgent" || agent.attentionState === "needs_user"
          ? html`<button class="btn btn--sm" @click=${() => props.onSectionChange("attention")}>
              ${t("operationsRoom.agents.reviewIssue")}
            </button>`
          : nothing}
        <button class="btn btn--sm" @click=${() => props.onOpenAgent(agent.id)}>
          ${t("operationsRoom.agents.openAgent")}
        </button>
        <button
          class="operations-pin"
          type="button"
          aria-pressed=${pinned ? "true" : "false"}
          aria-label=${t(pinned ? "operationsRoom.agents.unpin" : "operationsRoom.agents.pin", {
            name,
          })}
          @click=${() => props.onToggleAgentPin(agent.id)}
        >
          <span aria-hidden="true">${pinned ? "★" : "☆"}</span>
        </button>
      </div>
    </div>
  </details>`;
}

function agentGroupLabel(id: OperationsAgentGroupId): string {
  return t(`operationsRoom.agents.${id}`);
}

function renderAgentGroup(
  group: OperationsAgentGroup,
  props: OperationsProps,
  agentsConfirmed: boolean,
) {
  const content = html`
    <summary>
      <strong>${agentGroupLabel(group.id)}</strong>
      <span class="operations-count">${group.agents.length}</span>
    </summary>
    <div class="operations-agent-group__rows">
      ${repeat(
        group.agents,
        (agent) => agent.id,
        (agent) => renderAgentRow(agent, props, agentsConfirmed),
      )}
    </div>
  `;
  const openByDefault = group.id === "urgent" || group.id === "attention" || group.id === "working";
  return openByDefault
    ? html`<details class=${`operations-agent-group operations-agent-group--${group.id}`} open>
        ${content}
      </details>`
    : html`<details class=${`operations-agent-group operations-agent-group--${group.id}`}>
        ${content}
      </details>`;
}

function renderAgents(snapshot: OperationsSnapshot, props: OperationsProps) {
  const agentsConfirmed = sectionSourcesConfirmed(snapshot, props, "agents");
  const groups = groupOperationsAgents({
    agents: snapshot.agents,
    lastVisitedAt: props.lastVisitedAt,
    pinnedAgentIds: props.pinnedAgentIds,
    query: props.agentQuery,
    sort: props.agentSort,
  });
  return html`<section
    id=${operationsSectionTargetId("agents")}
    class="operations-panel"
    tabindex="-1"
    aria-labelledby="operations-agents-title"
  >
    <div class="operations-panel__header">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.agents.eyebrow")}</p>
        <h2 id="operations-agents-title">${t("operationsRoom.agents.title")}</h2>
        <p>${t("operationsRoom.agents.subtitle")}</p>
      </div>
      <div class="operations-toolbar">
        <input
          class="operations-search"
          type="search"
          .value=${props.agentQuery}
          aria-label=${t("operationsRoom.agents.searchLabel")}
          placeholder=${t("operationsRoom.agents.searchPlaceholder")}
          @input=${(event: Event) =>
            props.onAgentQueryChange((event.currentTarget as HTMLInputElement).value)}
        />
        <select
          class="operations-sort"
          .value=${props.agentSort}
          aria-label=${t("operationsRoom.agents.sortLabel")}
          @change=${(event: Event) =>
            props.onAgentSortChange(
              (event.currentTarget as HTMLSelectElement).value as OperationsAgentSort,
            )}
        >
          <option value="priority">${t("operationsRoom.agents.sortPriority")}</option>
          <option value="name">${t("operationsRoom.agents.sortName")}</option>
          <option value="recent">${t("operationsRoom.agents.sortRecent")}</option>
        </select>
      </div>
    </div>
    <p class="operations-muted">${t("operationsRoom.agents.browserLocalPins")}</p>
    ${!agentsConfirmed
      ? html`<p class="operations-muted" role="status">
          ${t("operationsRoom.agents.unconfirmed")}
        </p>`
      : nothing}
    ${snapshot.collections.agents.truncated
      ? html`<div class="operations-bounded-note" role="status">
          <p>
            ${t("operationsRoom.agents.showing", {
              shown: String(snapshot.collections.agents.shown),
              total: String(snapshot.collections.agents.total),
            })}
          </p>
          <button class="btn btn--sm" @click=${() => props.onNavigate("agents")}>
            ${t("operationsRoom.agents.openAll")}
          </button>
        </div>`
      : nothing}
    ${groups.length === 0
      ? html`<p class="operations-muted">
          ${!agentsConfirmed
            ? t("operationsRoom.agents.unconfirmed")
            : snapshot.collections.agents.truncated
              ? t("operationsRoom.agents.noShownMatches")
              : t("operationsRoom.agents.noMatches")}
        </p>`
      : html`<div class="operations-agent-groups">
          ${repeat(
            groups,
            (group) => group.id,
            (group) => renderAgentGroup(group, props, agentsConfirmed),
          )}
        </div>`}
  </section>`;
}

function renderAutomations(snapshot: OperationsSnapshot, props: OperationsProps) {
  const jobs = snapshot.cronJobs.toSorted(
    (left, right) =>
      Number(right.status === "failed" || right.status === "degraded") -
        Number(left.status === "failed" || left.status === "degraded") ||
      Number(right.running) - Number(left.running) ||
      (left.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (right.nextRunAt ?? Number.MAX_SAFE_INTEGER),
  );
  const scheduleMutationSafe = mutationSourceConfirmed(snapshot, props, "schedules");
  const schedulesConfirmed = sectionSourcesConfirmed(snapshot, props, "schedules");
  const supportsScheduleMutation =
    props.canAdmin &&
    snapshot.controls.supportedActions.some((action) => action.startsWith("cron."));
  return html`<section
    id=${operationsSectionTargetId("automations")}
    class="operations-panel"
    tabindex="-1"
    aria-labelledby="operations-automations-title"
  >
    <div class="operations-panel__header">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.automationsPanel.eyebrow")}</p>
        <h2 id="operations-automations-title">${t("operationsRoom.automationsPanel.title")}</h2>
      </div>
      <button class="btn btn--sm" @click=${() => props.onNavigate("cron")}>
        ${t("operationsRoom.automationsPanel.openCron")}
      </button>
    </div>
    ${!schedulesConfirmed
      ? html`<p class="operations-muted" role="status">
          ${t("operationsRoom.automationsPanel.unconfirmed")}
        </p>`
      : nothing}
    ${jobs.length === 0
      ? html`<p class="operations-muted">
          ${schedulesConfirmed
            ? t("operationsRoom.automationsPanel.none")
            : t("operationsRoom.automationsPanel.unconfirmed")}
        </p>`
      : html`<div class="operations-automation-list">
          ${repeat(
            jobs.slice(0, 8),
            (job) => job.id,
            (job) => {
              const toggleAction = job.enabled ? "cron.disable" : "cron.enable";
              const canRun =
                props.canAdmin && snapshot.controls.supportedActions.includes("cron.run");
              const canToggle =
                props.canAdmin && snapshot.controls.supportedActions.includes(toggleAction);
              return html`<article class="operations-automation-row">
                <div>
                  <strong class="operations-line-clamp">${job.name}</strong>
                  <small
                    >${job.agentId ?? t("operationsRoom.openClaw")} ·
                    ${formatRelativeTimestamp(job.nextRunAt, {
                      fallback: t("operationsRoom.automationsPanel.noNextRun"),
                    })}</small
                  >
                </div>
                ${schedulesConfirmed
                  ? statusPill(job.status)
                  : statusPill("unknown", t("operationsRoom.attention.unconfirmedShort"))}
                ${canRun || canToggle
                  ? html`<div class="operations-row-actions">
                      ${canRun
                        ? html`<button
                            class="btn btn--sm"
                            aria-label=${t("operationsRoom.actions.runSchedule", {
                              title: job.name,
                            })}
                            title=${scheduleMutationSafe
                              ? nothing
                              : t("operationsRoom.actions.unavailable")}
                            ?disabled=${props.actionBusy || !scheduleMutationSafe}
                            @click=${() => props.onAction("cron.run", job.id)}
                          >
                            ${t("operationsRoom.automationsPanel.runNow")}
                          </button>`
                        : nothing}
                      ${canToggle
                        ? html`<button
                            class="btn btn--sm"
                            aria-label=${t(
                              job.enabled
                                ? "operationsRoom.actions.pauseSchedule"
                                : "operationsRoom.actions.enableSchedule",
                              { title: job.name },
                            )}
                            title=${scheduleMutationSafe
                              ? nothing
                              : t("operationsRoom.actions.unavailable")}
                            ?disabled=${props.actionBusy || !scheduleMutationSafe}
                            @click=${() => props.onAction(toggleAction, job.id)}
                          >
                            ${t(
                              job.enabled
                                ? "operationsRoom.automationsPanel.pause"
                                : "operationsRoom.automationsPanel.enable",
                            )}
                          </button>`
                        : nothing}
                    </div>`
                  : nothing}
              </article>`;
            },
          )}
        </div>`}
    ${supportsScheduleMutation && !scheduleMutationSafe
      ? html`<p class="operations-muted operations-action-guard" role="status">
          ${t("operationsRoom.actions.unavailable")}
        </p>`
      : nothing}
    ${jobs.length > 8 || snapshot.collections.cronJobs.truncated
      ? html`<p class="operations-muted operations-bounded-status" role="status">
          ${t("operationsRoom.automationsPanel.showing", {
            shown: String(Math.min(8, jobs.length)),
            total: String(snapshot.collections.cronJobs.total),
          })}
        </p>`
      : nothing}
  </section>`;
}

function renderSystem(snapshot: OperationsSnapshot, stale: boolean) {
  const reliable = !stale;
  const availableMemoryPercent = Math.max(0, 100 - snapshot.host.memoryUsedPercent);
  const localModelProcessCount = snapshot.host.localModelProcessCount;
  const localModelRssBytes = snapshot.host.localModelRssBytes;
  const eventLoop =
    snapshot.host.eventLoopLagMs == null
      ? t("common.na")
      : t("operationsRoom.systemHealth.milliseconds", {
          count: String(snapshot.host.eventLoopLagMs),
        });
  return html`<section
    id=${operationsSectionTargetId("system")}
    class="operations-panel"
    tabindex="-1"
    aria-labelledby="operations-system-title"
  >
    <div class="operations-system__heading">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.systemHealth.eyebrow")}</p>
        <h2 id="operations-system-title">${t("operationsRoom.systemHealth.title")}</h2>
      </div>
      ${reliable
        ? statusPill(
            snapshot.host.status,
            snapshot.host.status === "healthy"
              ? t("operationsRoom.systemHealth.normal")
              : statusLabel(snapshot.host.status),
          )
        : statusPill("unknown", stale ? t("operationsRoom.stale") : t("operationsRoom.partial"))}
    </div>
    <div class="operations-system__summary">
      <article class="operations-system__item">
        <small>${t("operationsRoom.systemHealth.memory")}</small>
        <strong
          >${t("operationsRoom.systemHealth.memoryAvailable", {
            percent: String(availableMemoryPercent),
          })}</strong
        >
        <div
          class=${`operations-memory-progress operations-memory-progress--${snapshot.host.status}`}
          role="progressbar"
          aria-label=${t("operationsRoom.systemHealth.memory")}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${availableMemoryPercent}
        >
          <span style=${`width: ${Math.min(100, availableMemoryPercent)}%`}></span>
        </div>
      </article>
      ${localModelProcessCount != null && localModelRssBytes != null
        ? html`<article class="operations-system__item">
            <small>${t("operationsRoom.systemHealth.localModels")}</small>
            <strong>
              ${t(
                localModelProcessCount === 1
                  ? "operationsRoom.systemHealth.localModelProcessOne"
                  : "operationsRoom.systemHealth.localModelProcesses",
                {
                  count: String(localModelProcessCount),
                  rss: bytes(localModelRssBytes),
                },
              )}
            </strong>
          </article>`
        : nothing}
      <article class="operations-system__item">
        <small>${t("operationsRoom.systemHealth.gateway")}</small>
        <strong>${statusLabel(snapshot.host.status)}</strong>
      </article>
      <article class="operations-system__item">
        <small>${t("operationsRoom.systemHealth.cpu")}</small>
        <strong
          >${t("operationsRoom.systemHealth.load", {
            value: snapshot.host.loadAverage[0].toFixed(2),
          })}</strong
        >
      </article>
      <article class="operations-system__item">
        <small>${t("operationsRoom.systemHealth.responseDelay")}</small>
        <strong>${eventLoop}</strong>
      </article>
    </div>
    <details class="operations-system__details">
      <summary>${t("operationsRoom.systemHealth.technicalDetails")}</summary>
      <dl>
        <div>
          <dt>${t("operationsRoom.systemHealth.gatewayRam")}</dt>
          <dd>${bytes(snapshot.host.processRssBytes)}</dd>
        </div>
        <div>
          <dt>${t("operationsRoom.systemHealth.host")}</dt>
          <dd>${snapshot.host.hostname} · ${snapshot.host.platform} · ${snapshot.host.arch}</dd>
        </div>
        <div>
          <dt>${t("operationsRoom.systemHealth.logicalCores")}</dt>
          <dd>${snapshot.host.logicalCpuCount}</dd>
        </div>
        <div>
          <dt>${t("operationsRoom.systemHealth.memory")}</dt>
          <dd>
            ${t("operationsRoom.systemHealth.memoryBreakdown", {
              available: bytes(snapshot.host.availableMemoryBytes),
              free: bytes(snapshot.host.freeMemoryBytes),
              total: bytes(snapshot.host.totalMemoryBytes),
            })}
          </dd>
        </div>
      </dl>
      <p class="operations-muted">${t("operationsRoom.systemHealth.memoryPressureNote")}</p>
      <p class="operations-muted">${t("operationsRoom.systemHealth.agentRamNote")}</p>
    </details>
  </section>`;
}

function renderActivityComparison(
  snapshot: OperationsSnapshot,
  workingConfirmed: boolean,
  staleOrPartial: boolean,
) {
  const localAiCount = snapshot.host.localModelProcessCount;
  return html`<section
    class="operations-activity-comparison"
    aria-labelledby="operations-activity-comparison-title"
  >
    <div class="operations-activity-comparison__heading">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.activityComparison.eyebrow")}</p>
        <h2 id="operations-activity-comparison-title">
          ${t("operationsRoom.activityComparison.title")}
        </h2>
      </div>
      <span>${t("operationsRoom.activityComparison.subtitle")}</span>
    </div>
    <div class="operations-activity-comparison__grid">
      <article>
        <small>${t("operationsRoom.activityComparison.openClawLabel")}</small>
        <strong>
          ${workingConfirmed
            ? t(
                snapshot.summary.workingAgents === 1
                  ? "operationsRoom.activityComparison.openClawCountOne"
                  : "operationsRoom.activityComparison.openClawCount",
                { count: String(snapshot.summary.workingAgents) },
              )
            : t("operationsRoom.activityComparison.unconfirmed")}
        </strong>
        <p>${t("operationsRoom.activityComparison.openClawDetail")}</p>
      </article>
      <article>
        <small>${t("operationsRoom.activityComparison.localAiLabel")}</small>
        <strong>
          ${!staleOrPartial && localAiCount != null
            ? t(
                localAiCount === 1
                  ? "operationsRoom.activityComparison.localAiCountOne"
                  : "operationsRoom.activityComparison.localAiCount",
                { count: String(localAiCount) },
              )
            : t("operationsRoom.activityComparison.unconfirmed")}
        </strong>
        <p>${t("operationsRoom.activityComparison.localAiDetail")}</p>
      </article>
    </div>
  </section>`;
}

function catalogSection(
  title: string,
  rows: OperationsCatalogEntry[],
  collection: OperationsSnapshot["collections"]["skills"],
  empty: string,
  confirmed: boolean,
) {
  const available = rows.filter((row) => row.availability === "available").length;
  const setup = rows.filter((row) => row.availability === "unavailable").length;
  const unverified = rows.filter((row) => row.availability === "unverified").length;
  return html`<details class="operations-catalog">
    <summary>
      <span>
        <strong>${title}</strong>
        <small>
          ${!confirmed
            ? t("operationsRoom.more.availabilityUnverified")
            : collection.truncated
              ? `${t("operationsRoom.more.catalogShowing", {
                  shown: String(collection.shown),
                  total: String(collection.total),
                })} · `
              : nothing}
          ${t("operationsRoom.more.available", { count: String(available) })} ·
          ${t("operationsRoom.more.needsSetup", { count: String(setup) })}
          ${unverified > 0
            ? ` · ${unverified} ${t("operationsRoom.more.availabilityUnverified")}`
            : nothing}
        </small>
      </span>
      <span class="operations-count"
        >${!confirmed
          ? t("common.na")
          : collection.truncated
            ? t("operationsRoom.counts.compactShown", {
                shown: String(collection.shown),
                total: String(collection.total),
              })
            : String(collection.total)}</span
      >
    </summary>
    ${!confirmed
      ? html`<p class="operations-muted">${t("operationsRoom.more.catalogUnavailable")}</p>`
      : nothing}
    ${rows.length === 0
      ? confirmed
        ? html`<p class="operations-muted">${empty}</p>`
        : nothing
      : html`<div class="operations-catalog__grid">
          ${repeat(
            rows,
            (row) => row.id,
            (row) => html`<article class="operations-catalog__item">
              <div>
                <strong>${row.name}</strong><small>${row.source ?? row.owner ?? row.id}</small>
              </div>
              ${statusPill(row.status)}
              <div class="operations-catalog__truth">
                <span
                  >${t(
                    row.configured
                      ? "operationsRoom.more.configured"
                      : "operationsRoom.more.notConfigured",
                  )}</span
                >
                <span
                  >${t(
                    row.active === true
                      ? "operationsRoom.more.active"
                      : row.active === false
                        ? "operationsRoom.more.inactive"
                        : "operationsRoom.more.activityUnverified",
                  )}</span
                >
              </div>
              ${row.route
                ? html`<span class=${`operations-route operations-route--${row.route}`}
                    >${routeLabel(row.route)}</span
                  >`
                : nothing}
              ${row.reason ? html`<p>${row.reason}</p>` : nothing}
            </article>`,
          )}
        </div>`}
  </details>`;
}

function incidentChangedAt(incident: OperationsIncidentHistoryEntry): number {
  return Math.max(
    incident.resolvedAt ?? 0,
    incident.lastObservedAt,
    ...incident.transitions.map((transition) => transition.at),
  );
}

function renderActivityHistory(snapshot: OperationsSnapshot, props: OperationsProps) {
  const rollups = snapshot.activityRollups.toSorted(
    (left, right) => right.latestAt - left.latestAt || left.key.localeCompare(right.key),
  );
  const total = Math.max(snapshot.collections.activityRollups.total, rollups.length);
  const shown = rollups.length;
  const confirmed = sectionSourcesConfirmed(snapshot, props, "tasks");

  if (total === 0 && shown === 0) {
    return html`<p class="operations-muted">
      ${confirmed
        ? t("operationsRoom.more.noActivityHistory")
        : t("operationsRoom.more.activityHistoryUnavailable")}
    </p>`;
  }

  return html`<details class="operations-history operations-activity-history">
    <summary>
      <span>
        <strong>${t("operationsRoom.more.activityHistory")}</strong>
        <small>
          ${shown < total
            ? t("operationsRoom.counts.shown", { shown: String(shown), total: String(total) })
            : t("operationsRoom.more.activityCount", { count: String(total) })}
        </small>
      </span>
      <span class="operations-count">${shown}</span>
    </summary>
    ${!confirmed
      ? html`<p class="operations-muted">${t("operationsRoom.more.activityHistoryUnavailable")}</p>`
      : nothing}
    <div class="operations-change-list" role="list">
      ${repeat(
        rollups,
        (rollup) => rollup.key,
        (rollup) => html`<div role="listitem">
          ${renderChange({
            kind: "activity",
            id: `activity:${rollup.key}`,
            at: rollup.latestAt,
            rollup,
          })}
        </div>`,
      )}
    </div>
    ${shown < total
      ? html`<p class="operations-muted operations-bounded-status" role="status">
          ${t("operationsRoom.more.activitySnapshotBounded", {
            shown: String(shown),
            total: String(total),
          })}
        </p>`
      : nothing}
  </details>`;
}

function renderIncidentHistory(snapshot: OperationsSnapshot, props: OperationsProps) {
  const incidents = snapshot.incidentHistory.toSorted(
    (left, right) =>
      incidentChangedAt(right) - incidentChangedAt(left) || left.title.localeCompare(right.title),
  );
  const total = snapshot.collections.incidentHistory.total;
  const shown = Math.min(incidents.length, snapshot.collections.incidentHistory.shown);
  const overflow = snapshot.incidentLedger.overflowCount;
  const confirmed = sectionSourcesConfirmed(snapshot, props, "incident_ledger");

  if (total === 0 && overflow === 0) {
    return html`<p class="operations-muted">
      ${confirmed
        ? t("operationsRoom.more.noHistory")
        : t("operationsRoom.more.historyUnavailable")}
    </p>`;
  }

  return html`<details class="operations-history operations-incident-history">
    <summary>
      <span>
        <strong>${t("operationsRoom.more.incidentHistory")}</strong>
        <small>
          ${shown < total
            ? t("operationsRoom.counts.shown", { shown: String(shown), total: String(total) })
            : t("operationsRoom.more.incidentCount", { count: String(total) })}
        </small>
      </span>
      <span class="operations-count">${shown}</span>
    </summary>
    ${!confirmed
      ? html`<p class="operations-muted">${t("operationsRoom.more.historyUnavailable")}</p>`
      : nothing}
    ${incidents.length === 0
      ? confirmed
        ? html`<p class="operations-muted">${t("operationsRoom.more.historyUnavailable")}</p>`
        : nothing
      : html`<ol
          class="operations-incident-history__list"
          aria-label=${t("operationsRoom.more.incidentHistory")}
        >
          ${repeat(
            incidents,
            (incident) => incident.id,
            (incident) => html`<li class="operations-incident-history__item">
              <div class="operations-incident-history__heading">
                <strong>${incident.title}</strong>
                ${severityPill(incident.severity)}
              </div>
              <p>
                ${categoryLabel(incident.category)} ·
                ${t(`operationsRoom.attention.responseStates.${incident.responseState}`)} ·
                ${t(`operationsRoom.enums.dispositions.${incident.disposition}`)}
              </p>
              <small>
                ${t("operationsRoom.more.changed", {
                  time: relativeTime(incidentChangedAt(incident)),
                })}
                ·
                ${t("operationsRoom.more.transitionCount", {
                  count: String(incident.transitions.length),
                })}
              </small>
            </li>`,
          )}
        </ol>`}
    ${overflow > 0
      ? html`<p class="operations-muted">
          ${t("operationsRoom.more.historyOverflow", { count: String(overflow) })}
        </p>`
      : nothing}
    ${shown < total
      ? html`<div class="operations-bounded-note" role="status">
          <p>
            ${t("operationsRoom.more.historySnapshotBounded", {
              shown: String(shown),
              total: String(total),
            })}
          </p>
        </div>`
      : nothing}
  </details>`;
}

function renderMore(snapshot: OperationsSnapshot, props: OperationsProps) {
  const historicalCount = snapshot.summary.historicalFindings;
  const incidentCount = snapshot.collections.incidentHistory.total;
  const rejectedProcessRows = snapshot.collections.processes.rejected ?? 0;
  const incidentsConfirmed = sectionSourcesConfirmed(snapshot, props, "incident_ledger");
  const workflowsConfirmed = sectionSourcesConfirmed(snapshot, props, "workflows");
  const capabilitiesConfirmed = sectionSourcesConfirmed(snapshot, props, "capabilities");
  const modelsConfirmed = sectionSourcesConfirmed(snapshot, props, "models");
  const processSourceStatus = snapshot.freshness.sources.processes.status;
  const processesReadable =
    !isOperationsSnapshotStale(snapshot, Date.now(), props.refreshFailedAt) &&
    (processSourceStatus === "available" || processSourceStatus === "fallback");
  const processesOmitted = processSourceStatus === "omitted";
  return html`<details id="operations-more" class="operations-more">
    <summary>
      <span class="operations-more__summary-copy">
        <strong>${t("operationsRoom.more.title")}</strong>
        <small>${t("operationsRoom.more.subtitle")}</small>
      </span>
    </summary>
    <div class="operations-more__body">
      <section class="operations-more__section">
        <h2>${t("operationsRoom.more.recentHistory")}</h2>
        <p class="operations-muted">
          ${historicalCount > 0 || incidentCount > 0
            ? t("operationsRoom.more.historySummary", {
                findings: String(historicalCount),
                incidents: String(incidentCount),
              })
            : incidentsConfirmed
              ? t("operationsRoom.more.noHistory")
              : t("operationsRoom.more.historyUnavailable")}
        </p>
        ${renderActivityHistory(snapshot, props)} ${renderIncidentHistory(snapshot, props)}
        ${snapshot.collections.activityRollups.truncated
          ? html`<p class="operations-muted">
              ${t("operationsRoom.more.activitySnapshotBounded", {
                shown: String(snapshot.collections.activityRollups.shown),
                total: String(snapshot.collections.activityRollups.total),
              })}
            </p>`
          : nothing}
        ${snapshot.reconciler.lastError
          ? html`<div class="operations-monitor-warning">
              ${statusPill("unknown")}
              <div>
                <strong>${t("operationsRoom.more.monitorIssue")}</strong>
                <p>${snapshot.reconciler.lastError}</p>
              </div>
            </div>`
          : nothing}
        <p class="operations-muted">
          ${t("operationsRoom.more.monitorStatus", {
            attempt: relativeTime(snapshot.reconciler.lastAttemptAt),
            success: relativeTime(snapshot.reconciler.lastSweepAt),
          })}
        </p>
      </section>
      <section
        class="operations-more__section operations-more-workflows"
        tabindex=${props.workboardEnabled ? nothing : "-1"}
      >
        <div class="operations-panel__header">
          <div>
            <h2>${t("operationsRoom.more.workflows")}</h2>
            <p>
              ${workflowsConfirmed
                ? t("operationsRoom.more.workflowSummary", {
                    total: String(snapshot.collections.workflows.total),
                    active: String(snapshot.summary.activeWorkflows),
                  })
                : t("operationsRoom.working.countsUnconfirmed")}
            </p>
          </div>
          ${props.workboardEnabled
            ? html`<button class="btn btn--sm" @click=${() => props.onNavigate("workboard")}>
                ${t("operationsRoom.working.openWorkboard")}
              </button>`
            : nothing}
        </div>
      </section>
      <section class="operations-more__section">
        <div class="operations-panel__header">
          <div>
            <h2>${t("operationsRoom.more.capabilities")}</h2>
            <p>${t("operationsRoom.more.configuredActive")}</p>
          </div>
          <button class="btn btn--sm" @click=${() => props.onNavigate("skills")}>
            ${t("tabs.skills")}
          </button>
        </div>
        <div class="operations-catalogs">
          ${catalogSection(
            t("operationsRoom.more.skills"),
            snapshot.skills,
            snapshot.collections.skills,
            t("operationsRoom.more.noSkills"),
            capabilitiesConfirmed,
          )}
          ${catalogSection(
            t("operationsRoom.more.plugins"),
            snapshot.plugins,
            snapshot.collections.plugins,
            t("operationsRoom.more.noPlugins"),
            capabilitiesConfirmed,
          )}
          ${catalogSection(
            t("operationsRoom.more.tools"),
            snapshot.tools,
            snapshot.collections.tools,
            t("operationsRoom.more.noTools"),
            capabilitiesConfirmed,
          )}
          ${catalogSection(
            t("operationsRoom.more.models"),
            snapshot.models,
            snapshot.collections.models,
            t("operationsRoom.more.noModels"),
            modelsConfirmed,
          )}
        </div>
      </section>
      <section class="operations-more__section">
        <h2>${t("operationsRoom.more.processes")}</h2>
        <p class="operations-muted">${t("operationsRoom.more.argumentsPrivate")}</p>
        ${processesOmitted
          ? html`<p class="operations-muted" role="status">
              ${t("operationsRoom.more.processesOmitted")}
            </p>`
          : !processesReadable
            ? html`<p class="operations-muted" role="status">
                ${t("operationsRoom.more.processesUnavailable")}
              </p>`
            : nothing}
        ${rejectedProcessRows > 0
          ? html`<p class="operations-muted operations-process-rejection" role="status">
              ${t(
                rejectedProcessRows === 1
                  ? "operationsRoom.more.processRowsRejectedOne"
                  : "operationsRoom.more.processRowsRejected",
                { count: String(rejectedProcessRows) },
              )}
            </p>`
          : nothing}
        ${processesReadable && snapshot.collections.processes.truncated
          ? html`<p class="operations-muted operations-bounded-status" role="status">
              ${t("operationsRoom.more.processesShowing", {
                shown: String(snapshot.collections.processes.shown),
                total: String(snapshot.collections.processes.total),
              })}
            </p>`
          : nothing}
        <div class="operations-processes">
          ${snapshot.processes.length === 0
            ? processesReadable
              ? html`<p class="operations-muted">${t("operationsRoom.more.noProcesses")}</p>`
              : nothing
            : repeat(
                snapshot.processes,
                (process) => process.pid,
                (process) => html`<div class="operations-process">
                  <strong>${process.command}</strong>
                  <span>${processKindLabel(process.kind)}</span>
                  <span>${bytes(process.rssBytes)}</span>
                  <span
                    >${t("operationsRoom.more.cpuPercent", {
                      percent: process.cpuPercent.toFixed(1),
                    })}</span
                  >
                </div>`,
              )}
        </div>
      </section>
    </div>
  </details>`;
}

function renderSnapshot(snapshot: OperationsSnapshot, props: OperationsProps) {
  const now = Date.now();
  const stale = isOperationsSnapshotStale(snapshot, now, props.refreshFailedAt);
  const partial = snapshot.completeness.status === "partial";
  const briefingTone = stale || partial ? "unknown" : snapshot.briefing.tone;
  const unavailableSources = snapshot.completeness.unavailableSources.map(sourceLabel);
  const fallbackSources = snapshot.completeness.fallbackSources.map(sourceLabel);
  const working = operationsWorkingItems(snapshot);
  const attentionConfirmed = !stale && !partial;
  const workingConfirmed =
    attentionConfirmed &&
    sourceConfirmed(snapshot, "tasks") &&
    sourceConfirmed(snapshot, "workflows") &&
    sourceConfirmed(snapshot, "agents");
  const agentsConfirmed = attentionConfirmed && sourceConfirmed(snapshot, "agents");
  const schedulesConfirmed = attentionConfirmed && sourceConfirmed(snapshot, "schedules");
  const localModelCount = snapshot.host.localModelProcessCount;
  const systemDetail =
    localModelCount == null
      ? t("operationsRoom.systemHealth.memorySummary", {
          percent: String(snapshot.host.memoryUsedPercent),
        })
      : t("operationsRoom.systemHealth.memoryAndLocalAiSummary", {
          percent: String(snapshot.host.memoryUsedPercent),
          count: String(localModelCount),
        });
  const agentCount = snapshot.collections.agents.total;
  const cronCount = snapshot.collections.cronJobs.total;
  const currentFindings = currentOperationsFindings(snapshot);
  const primaryFinding = currentFindings[0] ?? null;
  const primaryStatus = stale || partial ? "unknown" : snapshot.briefing.tone;
  const acceptanceConfig =
    typeof window === "undefined"
      ? null
      : operationsOwnerAcceptanceConfigFromUrl(window.location.href);
  const acceptanceFacts: OperationsOwnerAcceptanceFacts = {
    localAiProcessCount: snapshot.host.localModelProcessCount ?? null,
    openClawWorkingCount: snapshot.summary.workingAgents,
    primaryIssueId: primaryFinding?.id ?? null,
    primaryIssueNextAction:
      primaryFinding?.nextAction ??
      primaryFinding?.recommendedAction ??
      t("operationsRoom.resolution.nextStepUnknown"),
    primaryIssueOwner: primaryFinding
      ? findingOwnerLabel(primaryFinding)
      : t("operationsRoom.attention.unassignedOwner"),
    primaryStatus,
    snapshotGeneratedAt: snapshot.generatedAt,
  };
  return html`
    ${props.error && props.refreshFailedAt != null
      ? html`<div class="callout warning" role="status">
          <strong>${t("operationsRoom.staleTitle")}</strong>
          <p>${t("operationsRoom.staleDetail", { time: relativeTime(props.updatedAt) })}</p>
        </div>`
      : nothing}
    ${props.error && props.refreshFailedAt == null
      ? html`<div class="callout danger" role="alert">
          <strong>${t("operationsRoom.actionFailedTitle")}</strong>
          <p>${props.error}</p>
        </div>`
      : nothing}
    ${partial
      ? html`<div class="callout warning" role="status">
          <strong>${t("operationsRoom.partial")}</strong>
          ${unavailableSources.length > 0
            ? html`<p>
                ${t("operationsRoom.unavailableSources", {
                  sources: unavailableSources.join(", "),
                })}
              </p>`
            : nothing}
          ${fallbackSources.length > 0
            ? html`<p>
                ${t("operationsRoom.fallbackSources", {
                  sources: fallbackSources.join(", "),
                })}
              </p>`
            : nothing}
        </div>`
      : nothing}
    ${props.actionNotice
      ? html`<div
          class=${`callout ${props.actionNoticeTone === "success" ? "success" : "info"}`}
          role="status"
          aria-live="polite"
        >
          ${props.actionNotice}
        </div>`
      : nothing}

    <section
      class=${`operations-briefing operations-briefing--${briefingTone}`}
      aria-labelledby="operations-now-title"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="operations-briefing__icon" aria-hidden="true">⌁</span>
      <div>
        <div class="operations-briefing__heading">
          <strong id="operations-now-title">${t("operationsRoom.now")}</strong>
          ${statusPill(
            BRIEFING_STATUS[briefingTone],
            t(`operationsRoom.overallBriefingTone.${briefingTone}`),
          )}
        </div>
        <p>
          ${stale || partial ? t("operationsRoom.briefingUnavailable") : snapshot.briefing.text}
        </p>
        ${stale || partial
          ? html`<details class="operations-last-known-briefing">
              <summary>${t("operationsRoom.lastKnownBriefing")}</summary>
              <p>${snapshot.briefing.text}</p>
            </details>`
          : nothing}
      </div>
    </section>

    ${renderActivityComparison(snapshot, workingConfirmed, stale || partial)}
    ${acceptanceConfig
      ? html`<operations-owner-acceptance
          .config=${acceptanceConfig}
          .facts=${acceptanceFacts}
        ></operations-owner-acceptance>`
      : nothing}

    <nav class="operations-quick-nav" aria-label=${t("operationsRoom.overviewNav")}>
      ${quickLink({
        section: "attention",
        label: attentionConfirmed
          ? t("operationsRoom.decisionCount", {
              count: String(snapshot.summary.actionableFindings),
            })
          : t("operationsRoom.decisionsUnconfirmed"),
        detail: !attentionConfirmed
          ? t("operationsRoom.attention.unconfirmedShort")
          : t("operationsRoom.urgentCount", {
              count: String(snapshot.summary.criticalFindings),
            }),
        active: props.section === "attention",
        onSectionChange: props.onSectionChange,
      })}
      ${quickLink({
        section: "working",
        label: workingConfirmed
          ? t("operationsRoom.openClawWorkCount", {
              count: String(snapshot.summary.workingAgents),
            })
          : t("operationsRoom.openClawWorkUnconfirmed"),
        detail: workingConfirmed
          ? t("operationsRoom.workingItemsCount", {
              count: String(working.length),
            })
          : t("operationsRoom.working.unverified"),
        active: props.section === "working",
        onSectionChange: props.onSectionChange,
      })}
      ${quickLink({
        section: "agents",
        label: agentsConfirmed
          ? t("operationsRoom.agentsCount", { count: String(agentCount) })
          : t("operationsRoom.agentsUnconfirmed"),
        detail: !agentsConfirmed
          ? t("operationsRoom.agents.unconfirmedShort")
          : snapshot.collections.agents.truncated
            ? t("operationsRoom.showingAgents", {
                count: String(snapshot.collections.agents.shown),
              })
            : t("operationsRoom.agentStatusSummary", {
                working: String(snapshot.summary.workingAgents),
                attention: String(snapshot.summary.attentionAgents),
              }),
        active: props.section === "agents",
        onSectionChange: props.onSectionChange,
      })}
      ${quickLink({
        section: "automations",
        label: t("operationsRoom.automations"),
        detail: schedulesConfirmed
          ? t("operationsRoom.automationCount", {
              total: String(cronCount),
              failing: String(snapshot.summary.failingCronJobs),
            })
          : t("operationsRoom.attention.unconfirmedShort"),
        active: props.section === "automations",
        onSectionChange: props.onSectionChange,
      })}
      ${quickLink({
        section: "system",
        label: t("operationsRoom.system"),
        detail:
          stale || partial
            ? t(stale ? "operationsRoom.stale" : "operationsRoom.partial")
            : systemDetail,
        active: props.section === "system",
        onSectionChange: props.onSectionChange,
      })}
    </nav>

    ${renderAttention(snapshot, { stale, partial }, props)}
    ${renderWorking(snapshot, { stale, partial }, props)}
    ${renderChanges(snapshot, props.lastVisitedAt, props)} ${renderAgents(snapshot, props)}
    ${renderAutomations(snapshot, props)} ${renderSystem(snapshot, stale)}
    ${renderMore(snapshot, props)}

    <footer class="operations-footer">
      ${t("operationsRoom.footer")} · ${snapshot.reconciler.note}
    </footer>
  `;
}

export function renderOperations(props: OperationsProps) {
  const snapshot = props.snapshot;
  const stale = snapshot
    ? isOperationsSnapshotStale(snapshot, Date.now(), props.refreshFailedAt)
    : false;
  const partial = snapshot?.completeness.status === "partial";
  return html`<section class="operations-room" aria-labelledby="operations-title">
    <header class="operations-hero">
      <div>
        <p class="operations-eyebrow">${t("operationsRoom.eyebrow")}</p>
        <h1 id="operations-title">${t("operationsRoom.title")}</h1>
        <p>${t("operationsRoom.subtitle")}</p>
      </div>
      <div class="operations-hero__actions">
        <div class="operations-freshness">
          <strong
            >${stale
              ? t("operationsRoom.stale")
              : partial
                ? t("operationsRoom.partial")
                : t("operationsRoom.live")}</strong
          >
          <span>${t("operationsRoom.updated", { time: relativeTime(props.updatedAt) })}</span>
        </div>
        <button
          class="btn"
          ?disabled=${props.loading}
          aria-label=${t("operationsRoom.refreshLabel")}
          @click=${props.onRefresh}
        >
          ${t(props.loading ? "operationsRoom.refreshing" : "operationsRoom.refresh")}
        </button>
      </div>
    </header>

    ${!snapshot && props.error
      ? html`<div class="callout danger" role="alert">
          <strong>${t("operationsRoom.unavailableTitle")}</strong>
          <p>${props.error}</p>
        </div>`
      : nothing}
    ${!snapshot && props.loading
      ? html`<div class="operations-empty" aria-live="polite">${t("operationsRoom.loading")}</div>`
      : nothing}
    ${!snapshot && !props.loading
      ? html`<div class="operations-empty">${t("operationsRoom.empty")}</div>`
      : nothing}
    ${snapshot ? renderSnapshot(snapshot, props) : nothing}
  </section>`;
}

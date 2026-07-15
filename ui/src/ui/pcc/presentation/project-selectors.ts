import { pccWorkScopeForProject } from "../../../../../src/pcc/metadata.js";
import { getPccWorkLoopSettings } from "../../../../../src/pcc/work-loop.js";
import type { PccMilestone, PccProject, PccProjectSummary, PccStatus } from "../../types.ts";
import type { PccDashboardProps, PccProjectDetail, PccProjectFilter } from "../contracts.ts";
import { PCC_TERMINAL_STATUSES } from "../policies.ts";

export const PROJECT_FILTER_OPTIONS: Array<[PccProjectFilter, string]> = [
  ["active", "Active"],
  ["needs_you", "Needs You"],
  ["on_hold", "On Hold"],
  ["archived", "Archived"],
  ["all", "All"],
];

const PCC_STALE_PROJECT_DAYS = 14;

function formatStatus(status: string | null | undefined): string {
  const value = typeof status === "string" ? status.trim() : "";
  if (!value) {
    return "Not recorded";
  }
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function compactSignalText(value: string, max = 130): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1).trimEnd()}…` : normalized;
}

function projectOutcomeMetrics(project: unknown): string[] {
  const projectRecord =
    project && typeof project === "object" && !Array.isArray(project)
      ? (project as Record<string, unknown>)
      : {};
  const metadata =
    projectRecord.metadata &&
    typeof projectRecord.metadata === "object" &&
    !Array.isArray(projectRecord.metadata)
      ? (projectRecord.metadata as Record<string, unknown>)
      : {};
  const value = metadata.pccOutcomeMetrics;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function projectFilterLabel(filter: PccProjectFilter): string {
  return PROJECT_FILTER_OPTIONS.find(([value]) => value === filter)?.[1] ?? formatStatus(filter);
}

export function projectIsOnHold(project: Pick<PccProject, "status"> | PccProjectSummary): boolean {
  return project.status === "on_hold" || project.status === "deferred";
}

export function projectIsDeferredOutOfUrgent(
  project: Pick<PccProject, "status"> | PccProjectSummary,
): boolean {
  return ["archived", "skipped", "on_hold", "deferred"].includes(project.status);
}

export function projectIsTerminalForWork(
  project: Pick<PccProject, "status"> | PccProjectSummary,
): boolean {
  return ["complete", "complete_with_maintenance", "archived", "skipped"].includes(project.status);
}

export function projectCanBeNextBestAction(project: PccProjectSummary): boolean {
  return !projectIsDeferredOutOfUrgent(project) && !projectIsTerminalForWork(project);
}

export function projectIsExcludedFromTodayFocus(
  project: PccProjectSummary,
  detail?: PccProjectDetail,
): boolean {
  return pccWorkScopeForProject(detail?.project ?? project) === "project_work";
}

export function projectDetailForSummary(
  props: Pick<PccDashboardProps, "projectDetails" | "projectDetail">,
  project: PccProjectSummary,
): PccProjectDetail | undefined {
  return (
    props.projectDetails?.[project.id] ??
    (props.projectDetail?.project.id === project.id ? props.projectDetail : undefined)
  );
}

export function effectivePccFocusMode(
  props: Pick<PccDashboardProps, "productFocusMode" | "projectDetail">,
): "pcc_product" | "project_work" {
  return (
    props.productFocusMode ??
    (props.projectDetail ? pccWorkScopeForProject(props.projectDetail.project) : "project_work")
  );
}

export function focusScopedProjectsForToday(
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

export function runningProjectsForToday(props: PccDashboardProps): PccProjectSummary[] {
  return focusScopedProjectsForToday(props, props.projects).filter(
    (project) => workStateForProject(project, props.projectDetails?.[project.id]) === "Working",
  );
}

export function focusedAttentionProjects(
  projects: readonly PccProjectSummary[],
  _props?: Pick<PccDashboardProps, "projectDetails" | "projectDetail">,
): PccProjectSummary[] {
  return getAttentionProjects(projects);
}

export function deferredAttentionProjects(
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

export function projectIsOverdue(project: PccProjectSummary): boolean {
  if (PCC_TERMINAL_STATUSES.has(project.status) || !project.dueDate) {
    return false;
  }
  const parsed = Date.parse(project.dueDate);
  return Number.isFinite(parsed) && parsed < Date.now();
}

export function projectIsStale(project: PccProjectSummary): boolean {
  if (PCC_TERMINAL_STATUSES.has(project.status)) {
    return false;
  }
  const updatedAt = Date.parse(project.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  return Date.now() - updatedAt > PCC_STALE_PROJECT_DAYS * 24 * 60 * 60 * 1_000;
}

export function projectNeedsAttention(project: PccProjectSummary): boolean {
  if (projectIsTerminalForWork(project) || projectIsDeferredOutOfUrgent(project)) {
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

export function projectAttentionLine(project: PccProjectSummary): string {
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

export function workStateForProject(
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
  const settings = detail ? getPccWorkLoopSettings(detail.project) : undefined;
  if (settings?.enabled) {
    return settings.state === "paused" ? "Paused" : "Working";
  }
  return "Off";
}

export function sortedMilestones(detail: PccProjectDetail): PccMilestone[] {
  return detail.milestones.toSorted(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
  );
}

export function currentMilestoneForDetail(detail: PccProjectDetail): PccMilestone | undefined {
  return sortedMilestones(detail).find((milestone) => !PCC_TERMINAL_STATUSES.has(milestone.status));
}

export function nextMilestoneForDetail(detail: PccProjectDetail): PccMilestone | undefined {
  const current = currentMilestoneForDetail(detail);
  return sortedMilestones(detail).find(
    (milestone) => milestone.id !== current?.id && !PCC_TERMINAL_STATUSES.has(milestone.status),
  );
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

export function attentionKind(project: PccProjectSummary): string {
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

export function getAttentionProjects(projects: readonly PccProjectSummary[]): PccProjectSummary[] {
  return projects.filter(projectNeedsAttention).toSorted((left, right) => {
    const rank = attentionRank(left) - attentionRank(right);
    return rank !== 0 ? rank : Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

export function projectActionLine(project: PccProjectSummary, detail?: PccProjectDetail): string {
  const current = detail ? currentMilestoneForDetail(detail) : undefined;
  return current?.title ?? project.nextActions[0] ?? formatStatus(project.status);
}

export function projectBlockerLine(project: PccProjectSummary): string {
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

export function projectMatchesFilter(
  project: PccProjectSummary,
  filter: PccProjectFilter,
): boolean {
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

export function effectiveProjectFilter(
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

export function projectMatchesSearch(
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

export function pccStatusIsTerminalForPresentation(status: PccStatus): boolean {
  return PCC_TERMINAL_STATUSES.has(status);
}

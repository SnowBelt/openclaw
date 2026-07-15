import {
  buildPccOperationalMetrics,
  type PccOperationalMetrics,
} from "../../../../../src/pcc/operational-metrics.js";
import type { PccEvidence, PccProjectSummary } from "../../types.ts";
import type { PccDashboardProps, PccProjectDetail, PccProjectFilter } from "../contracts.ts";
import {
  PROJECT_FILTER_OPTIONS,
  effectivePccFocusMode,
  effectiveProjectFilter,
  focusScopedProjectsForToday,
  getAttentionProjects,
  projectCanBeNextBestAction,
  projectDetailForSummary,
  projectIsExcludedFromTodayFocus,
  projectMatchesFilter,
  projectMatchesSearch,
  workStateForProject,
} from "./project-selectors.ts";

export type PccDashboardReadModel = {
  focusMode: "pcc_product" | "project_work";
  scopedProjects: PccProjectSummary[];
  allProjects: PccProjectSummary[];
  selectedProjectSummary?: PccProjectSummary;
  selectedOutsideScope: boolean;
  selectedFilter: PccProjectFilter;
  filteredByTab: PccProjectSummary[];
  visibleProjects: PccProjectSummary[];
  filterCounts: Readonly<Record<PccProjectFilter, number>>;
  runningProjects: PccProjectSummary[];
  attentionProjects: PccProjectSummary[];
  deferredProjects: PccProjectSummary[];
  globalAttentionProjects: PccProjectSummary[];
  activeCount: number;
  blockedCount: number;
  details: PccProjectDetail[];
  operationalMetrics: PccOperationalMetrics;
  blockedProject?: PccProjectSummary;
  nextBestProject?: PccProjectSummary;
};

type ReadModelCache = {
  projects: PccDashboardProps["projects"];
  details: PccDashboardProps["projectDetails"];
  detail: PccDashboardProps["projectDetail"];
  selectedProjectId: string | null;
  focusMode: PccDashboardProps["productFocusMode"];
  filter: PccDashboardProps["projectFilter"];
  searchQuery: string | undefined;
  updatedAt: number | null;
  minuteBucket: number;
  value: PccDashboardReadModel;
};

let lastReadModel: ReadModelCache | undefined;

function detailsForDashboard(props: PccDashboardProps): PccProjectDetail[] {
  const details = Object.values(props.projectDetails ?? {});
  const selected = props.projectDetail;
  if (selected && !details.some((detail) => detail.project.id === selected.project.id)) {
    details.push(selected);
  }
  return details;
}

function operationalEvidenceForDetails(details: readonly PccProjectDetail[]): PccEvidence[] {
  const evidenceById = new Map<string, PccEvidence>();
  for (const detail of details) {
    for (const evidence of detail.evidence) {
      evidenceById.set(evidence.id, evidence);
    }
  }
  return [...evidenceById.values()];
}

function filterCounts(projects: readonly PccProjectSummary[]): Record<PccProjectFilter, number> {
  const counts: Record<PccProjectFilter, number> = {
    active: 0,
    needs_you: 0,
    on_hold: 0,
    archived: 0,
    all: projects.length,
  };
  for (const project of projects) {
    for (const [filter] of PROJECT_FILTER_OPTIONS) {
      if (filter !== "all" && projectMatchesFilter(project, filter)) {
        counts[filter] += 1;
      }
    }
  }
  return counts;
}

export function buildPccDashboardReadModel(
  props: PccDashboardProps,
  nowMs = Date.now(),
): PccDashboardReadModel {
  const minuteBucket = Math.floor(nowMs / 60_000);
  if (
    lastReadModel?.projects === props.projects &&
    lastReadModel.details === props.projectDetails &&
    lastReadModel.detail === props.projectDetail &&
    lastReadModel.selectedProjectId === props.selectedProjectId &&
    lastReadModel.focusMode === props.productFocusMode &&
    lastReadModel.filter === props.projectFilter &&
    lastReadModel.searchQuery === props.projectSearchQuery &&
    lastReadModel.updatedAt === props.updatedAt &&
    lastReadModel.minuteBucket === minuteBucket
  ) {
    return lastReadModel.value;
  }

  const focusMode = effectivePccFocusMode(props);
  const scopedProjects = focusScopedProjectsForToday(props, props.projects);
  const selectedProjectSummary = props.projectDetail
    ? props.projects.find((project) => project.id === props.projectDetail?.project.id)
    : undefined;
  const selectedOutsideScope = Boolean(
    selectedProjectSummary &&
    props.projectDetail &&
    projectIsExcludedFromTodayFocus(selectedProjectSummary, props.projectDetail) ===
      (focusMode === "pcc_product"),
  );
  const allProjects =
    selectedOutsideScope &&
    selectedProjectSummary &&
    !scopedProjects.some((project) => project.id === selectedProjectSummary.id)
      ? [...scopedProjects, selectedProjectSummary]
      : scopedProjects;
  const selectedFilter = effectiveProjectFilter(props, allProjects);
  const counts = filterCounts(allProjects);
  const filteredByTab = allProjects.filter((project) =>
    projectMatchesFilter(project, selectedFilter),
  );
  const searchMatches = (project: PccProjectSummary) =>
    projectMatchesSearch(
      project,
      props.projectSearchQuery,
      projectDetailForSummary(props, project),
    );
  const filteredProjects = filteredByTab.filter(searchMatches);
  const visibleProjects =
    selectedOutsideScope &&
    selectedProjectSummary &&
    !filteredProjects.some((project) => project.id === selectedProjectSummary.id) &&
    searchMatches(selectedProjectSummary)
      ? [...filteredProjects, selectedProjectSummary]
      : filteredProjects;
  const attentionProjects = getAttentionProjects(scopedProjects);
  const globalAttentionProjects = getAttentionProjects(props.projects);
  const runningProjects = scopedProjects.filter(
    (project) => workStateForProject(project, props.projectDetails?.[project.id]) === "Working",
  );
  const deferredProjects =
    focusMode === "pcc_product"
      ? globalAttentionProjects.filter((project) =>
          projectIsExcludedFromTodayFocus(project, projectDetailForSummary(props, project)),
        )
      : [];
  let activeCount = 0;
  let blockedCount = 0;
  for (const project of scopedProjects) {
    if (["active", "in_progress", "reopened"].includes(project.status)) {
      activeCount += 1;
    }
    if (project.status === "blocked" || project.milestoneCounts.blocked > 0) {
      blockedCount += 1;
    }
  }
  const blocked = scopedProjects.find(
    (project) =>
      projectCanBeNextBestAction(project) &&
      (project.status === "blocked" || project.milestoneCounts.blocked > 0),
  );
  const ready = scopedProjects.find(
    (project) =>
      projectCanBeNextBestAction(project) &&
      project.nextActions.length > 0 &&
      project.status !== "blocked",
  );
  const details = detailsForDashboard(props);
  const operationalEvidence = operationalEvidenceForDetails(details);
  const value: PccDashboardReadModel = {
    focusMode,
    scopedProjects,
    allProjects,
    selectedProjectSummary,
    selectedOutsideScope,
    selectedFilter,
    filteredByTab,
    visibleProjects,
    filterCounts: counts,
    runningProjects,
    attentionProjects,
    deferredProjects,
    globalAttentionProjects,
    activeCount,
    blockedCount,
    details,
    operationalMetrics: buildPccOperationalMetrics(operationalEvidence),
    blockedProject: blocked,
    nextBestProject: attentionProjects[0] ?? blocked ?? ready ?? runningProjects[0],
  };
  lastReadModel = {
    projects: props.projects,
    details: props.projectDetails,
    detail: props.projectDetail,
    selectedProjectId: props.selectedProjectId,
    focusMode: props.productFocusMode,
    filter: props.projectFilter,
    searchQuery: props.projectSearchQuery,
    updatedAt: props.updatedAt,
    minuteBucket,
    value,
  };
  return value;
}

import type {
  PccMilestone,
  PccPlanningRun,
  PccProject,
  PccProjectSummary,
} from "../../../../../packages/gateway-protocol/src/index.js";

export type PccUiState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  projects: PccProjectSummary[];
  selectedProjectId: string | null;
  project: PccProject | null;
  milestones: PccMilestone[];
  summary: PccProjectSummary | null;
  planningRun: PccPlanningRun | null;
};

export const EMPTY_PCC_STATE: PccUiState = {
  loading: false,
  saving: false,
  error: null,
  message: null,
  projects: [],
  selectedProjectId: null,
  project: null,
  milestones: [],
  summary: null,
  planningRun: null,
};

export type PccProgress = {
  percent: number;
  complete: number;
  total: number;
  blocked: number;
  needsApproval: number;
};

export function derivePccProgress(state: Pick<PccUiState, "summary" | "milestones">): PccProgress {
  if (state.summary) {
    return {
      percent: state.summary.percentComplete,
      complete: state.summary.milestoneCounts.complete,
      total: state.summary.milestoneCounts.total,
      blocked: state.summary.milestoneCounts.blocked,
      needsApproval: state.summary.milestoneCounts.needsApproval,
    };
  }
  const total = state.milestones.length;
  const complete = state.milestones.filter((milestone) =>
    ["complete", "complete_with_maintenance", "skipped"].includes(milestone.status),
  ).length;
  const blocked = state.milestones.filter((milestone) => milestone.status === "blocked").length;
  const needsApproval = state.milestones.filter(
    (milestone) => milestone.status === "needs_approval",
  ).length;
  return {
    percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    complete,
    total,
    blocked,
    needsApproval,
  };
}

export function selectedProject(
  projects: PccProjectSummary[],
  selectedProjectId: string | null,
): PccProjectSummary | null {
  return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
}

export function isPccRunActive(run: PccPlanningRun | null): boolean {
  return run?.status === "queued" || run?.status === "running";
}

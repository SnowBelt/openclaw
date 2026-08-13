import type {
  PccAttachment,
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccPermissionGrant,
  PccPlanningRun,
  PccProject,
  PccProjectSummary,
  PccSubMilestone,
} from "../../../../../packages/gateway-protocol/src/index.js";

export type PccWorkLoopState =
  | "idle"
  | "working"
  | "paused"
  | "blocked"
  | "waiting_for_permission"
  | "waiting_for_codex"
  | "waiting_for_remote_proof"
  | "proof_failed"
  | "complete";

export type PccGoalAction = "start" | "continue" | "pause" | "resume" | "retry" | "stop";

export type PccOwnerAcceptanceState = "idle" | "running" | "submitting" | "complete" | "failed";

export type PccOwnerAcceptance = {
  state: PccOwnerAcceptanceState;
  startedAt: number | null;
  elapsedMs: number;
  participantHash: string | null;
  attempt: number;
  error: string | null;
  receiptId: string | null;
};

export type PccUiState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
  projects: PccProjectSummary[];
  selectedProjectId: string | null;
  project: PccProject | null;
  milestones: PccMilestone[];
  subMilestones: PccSubMilestone[];
  permissions: PccPermissionGrant[];
  evidence: PccEvidence[];
  receipts: PccCompletionReceipt[];
  attachments: PccAttachment[];
  attachmentsError: string | null;
  summary: PccProjectSummary | null;
  planningRun: PccPlanningRun | null;
  planDescription: string;
  ownerAcceptance: PccOwnerAcceptance;
};

export const EMPTY_PCC_OWNER_ACCEPTANCE: PccOwnerAcceptance = {
  state: "idle",
  startedAt: null,
  elapsedMs: 0,
  participantHash: null,
  attempt: 0,
  error: null,
  receiptId: null,
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
  subMilestones: [],
  permissions: [],
  evidence: [],
  receipts: [],
  attachments: [],
  attachmentsError: null,
  summary: null,
  planningRun: null,
  planDescription: "",
  ownerAcceptance: { ...EMPTY_PCC_OWNER_ACCEPTANCE },
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

export function getPccWorkLoopState(project: PccProject | null): PccWorkLoopState {
  const raw = project?.metadata?.pccWorkLoop;
  if (!raw || typeof raw !== "object") {
    return "idle";
  }
  const state = (raw as { state?: unknown }).state;
  return typeof state === "string" &&
    [
      "idle",
      "working",
      "paused",
      "blocked",
      "waiting_for_permission",
      "waiting_for_codex",
      "waiting_for_remote_proof",
      "proof_failed",
      "complete",
    ].includes(state)
    ? (state as PccWorkLoopState)
    : "idle";
}

export function getPccPlanDescription(project: PccProject | null): string {
  const raw = project?.metadata?.pccWorkLoop;
  if (!raw || typeof raw !== "object") {
    return "";
  }
  const value = (raw as { lastPlanDescription?: unknown }).lastPlanDescription;
  return typeof value === "string" ? value : "";
}

export function getPccPlanningRunId(project: PccProject | null): string | null {
  const raw = project?.metadata?.pccWorkLoop;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = (raw as { runId?: unknown }).runId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function pccGoalPrimaryAction(
  project: PccProject | null,
  run: PccPlanningRun | null,
): PccGoalAction | null {
  if (!project) {
    return "start";
  }
  const state = getPccWorkLoopState(project);
  if (state === "complete") {
    return null;
  }
  if (isPccRunActive(run)) {
    return "pause";
  }
  if (state === "paused") {
    return "resume";
  }
  if (state === "working") {
    return run?.status === "failed" || run?.status === "cancelled" || run?.status === "lost"
      ? "retry"
      : "continue";
  }
  if (
    state === "proof_failed" ||
    run?.status === "failed" ||
    run?.status === "cancelled" ||
    run?.status === "lost"
  ) {
    return "retry";
  }
  return state === "idle" ? "start" : "continue";
}

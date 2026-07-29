export type ChatGoalStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "lost";

export const CHAT_PURSUE_GOAL_CONTROLLER_ID = "openclaw/pursue-goal-v1";

export type ChatGoalControlAction = "pause" | "resume" | "retry" | "stop" | "edit";

export type ChatGoalActionState = {
  flowId: string;
  action: ChatGoalControlAction;
};

export type ChatGoalTaskSummary = {
  id?: string;
  taskId?: string;
  flowId?: string;
  title?: string;
  status?: string;
  runId?: string;
  progressSummary?: string;
  terminalSummary?: string;
  blockedReason?: string;
  judgeStatus?: string;
  judgeVerdict?: string;
};

export type ChatGoalExecutionEvent = {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  at: number;
  flowId: string;
  category: string;
  name: string;
  actorId: string;
  summary: string;
};

export type ChatGoalFlowSummary = {
  id: string;
  flowId?: string;
  ownerKey?: string;
  revision?: number;
  controllerId?: string;
  status: ChatGoalStatus;
  goal: string;
  currentStep?: string;
  blockedTaskId?: string;
  blockedSummary?: string;
  phase?: string;
  missionId?: string;
  goalVersion?: number;
  workerAgentId?: string;
  workerSessionKey?: string;
  turnCount?: number;
  activationCount?: number;
  consecutiveFailures?: number;
  nextAction?: string;
  lastResult?: string;
  lastError?: string;
  retryAt?: number | string;
  lease?: {
    ownerId: string;
    leaseId: string;
    acquiredAt: number;
    heartbeatAt: number;
    expiresAt: number;
  };
  judgeReceipt?: {
    verdict: string;
    conditions: string;
    evidenceSummary: string;
    issuedAt: number;
    signature?: string;
  };
  events?: ChatGoalExecutionEvent[];
  cancelRequestedAt?: number | string;
  createdAt?: number | string;
  updatedAt?: number | string;
  endedAt?: number | string;
  tasks?: ChatGoalTaskSummary[];
  taskSummary?: {
    total?: number;
    active?: number;
    terminal?: number;
    failures?: number;
  };
};

const ACTIVE_GOAL_STATUSES = new Set<ChatGoalStatus>([
  "queued",
  "running",
  "paused",
  "waiting",
  "blocked",
]);

export function isActiveChatGoal(status: string | undefined): boolean {
  return ACTIVE_GOAL_STATUSES.has(status as ChatGoalStatus);
}

export function isChatPursueGoalFlow(flow: ChatGoalFlowSummary): boolean {
  return flow.controllerId === CHAT_PURSUE_GOAL_CONTROLLER_ID;
}

export function resolveCurrentChatGoal(
  flows: readonly ChatGoalFlowSummary[] | undefined,
): ChatGoalFlowSummary | null {
  let firstGoal: ChatGoalFlowSummary | null = null;
  for (const flow of flows ?? []) {
    if (!isChatPursueGoalFlow(flow)) {
      continue;
    }
    firstGoal ??= flow;
    if (isActiveChatGoal(flow.status)) {
      return flow;
    }
  }
  return firstGoal;
}

export function chatGoalStatusLabel(flow: ChatGoalFlowSummary | null | undefined): string {
  if (!flow) {
    return "No goal";
  }
  if (flow.cancelRequestedAt && flow.status !== "cancelled") {
    return "Cancelling";
  }
  switch (flow.status) {
    case "queued":
      return "Queued";
    case "running":
      return "Pursuing";
    case "paused":
      return "Paused";
    case "waiting":
      return "Waiting";
    case "blocked":
      return "Blocked";
    case "succeeded":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelling":
      return "Cancelling";
    case "cancelled":
      return "Cancelled";
    case "lost":
      return "Lost";
  }
  return "Unknown";
}

export function buildChatGoalContinuationPrompt(flow: ChatGoalFlowSummary): string {
  return [
    "Continue pursuing this goal from the current verified state.",
    "",
    `Goal: ${flow.goal}`,
    "",
    "Do not repeat completed or mutating work.",
    "Verify concrete evidence before claiming completion.",
    "If the goal is not 100% complete, report the exact blocker and next build gap.",
  ].join("\n");
}

import { areUiSessionKeysEquivalent } from "../session-key.ts";
import { isSessionRunActive } from "../session-run-state.ts";
import type { SessionsListResult } from "../types.ts";
import type { ChatQueueItem } from "../ui-types.ts";
import {
  isActiveChatGoal,
  resolveCurrentChatGoal,
  type ChatGoalFlowSummary,
} from "./pursue-goal.ts";
import type { ChatRunUiStatus } from "./run-lifecycle.ts";

export type WorkSurfaceAction =
  | "cancel_task"
  | "open_goal"
  | "open_session"
  | "remove_queue"
  | "stop_run";

export type WorkSurfaceItemKind =
  | "active_session"
  | "chat_run"
  | "goal"
  | "queued_message"
  | "task";

export type WorkSurfaceItem = {
  id: string;
  kind: WorkSurfaceItemKind;
  title: string;
  status: string;
  detail?: string;
  updatedAt?: number;
  sessionKey?: string;
  projectId?: string;
  runId?: string;
  taskId?: string;
  attention?: {
    owner: string;
    nextAction: string;
  };
  actions: WorkSurfaceAction[];
};

export type WorkSurfaceTaskSummary = {
  id?: string;
  title?: string;
  status?: string;
  runtime?: string;
  kind?: string;
  sessionKey?: string;
  projectId?: string;
  runId?: string;
  taskId?: string;
  updatedAt?: number | string;
  createdAt?: number | string;
  progressSummary?: string;
  terminalSummary?: string;
  blockedReason?: string;
  error?: string;
};

export type BuildWorkSurfaceSnapshotInput = {
  assistantName?: string | null;
  chatRunId?: string | null;
  chatRunStatus?: ChatRunUiStatus | null;
  chatQueue?: ChatQueueItem[];
  currentSessionKey?: string | null;
  goals?: ChatGoalFlowSummary[] | null;
  sessionsResult?: SessionsListResult | null;
  tasks?: WorkSurfaceTaskSummary[] | null;
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function queueTitle(item: ChatQueueItem): string {
  const text = normalizeText(item.text);
  if (text) {
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }
  const count = item.attachments?.length ?? 0;
  if (count > 0) {
    return count === 1 ? "Attached message" : `${count} attachments`;
  }
  return "Queued message";
}

function queueStatusLabel(item: ChatQueueItem): string {
  switch (item.sendState) {
    case "waiting-model":
      return "Waiting for model";
    case "sending":
      return "Sending";
    case "waiting-reconnect":
      return "Waiting for reconnect";
    case "failed":
      return "Failed";
    default:
      if (item.sendError) {
        return "Failed";
      }
      return item.kind === "steered" ? "Steered" : "Queued";
  }
}

function sessionTitle(row: NonNullable<SessionsListResult["sessions"]>[number]): string {
  return (
    normalizeText(row.displayName) ??
    normalizeText(row.derivedTitle) ??
    normalizeText(row.label) ??
    normalizeText(row.subject) ??
    row.key
  );
}

function taskStatusLabel(status: string | undefined): string {
  switch (status) {
    case "active":
    case "working":
      return "Working";
    case "running":
      return "Running";
    case "queued":
      return "Queued";
    default:
      return status ? status : "Working";
  }
}

function taskTitle(task: WorkSurfaceTaskSummary): string {
  return (
    normalizeText(task.title) ?? normalizeText(task.kind) ?? normalizeText(task.runtime) ?? "Task"
  );
}

function taskDetail(task: WorkSurfaceTaskSummary): string | undefined {
  return (
    normalizeText(task.progressSummary) ??
    normalizeText(task.blockedReason) ??
    normalizeText(task.error) ??
    normalizeText(task.terminalSummary) ??
    normalizeText(task.runtime)
  );
}

function itemRank(item: WorkSurfaceItem): number {
  if (item.kind === "chat_run") {
    return 0;
  }
  if (item.kind === "queued_message") {
    return 1;
  }
  if (item.kind === "goal") {
    return 2;
  }
  if (item.kind === "task" && item.status.toLowerCase() === "running") {
    return 3;
  }
  if (item.kind === "task") {
    return 4;
  }
  return 5;
}

function goalHasRunningWorker(goal: ChatGoalFlowSummary): boolean {
  const activeTasks = goal.taskSummary?.active;
  const taskListHasRunningWorker =
    goal.tasks?.some((task) => {
      const status = normalizeText(task.status)?.toLowerCase();
      return status === "active" || status === "running" || status === "working";
    }) ?? false;
  return (typeof activeTasks === "number" && activeTasks > 0) || taskListHasRunningWorker;
}

function goalStatusLabel(goal: ChatGoalFlowSummary): string {
  if (goal.cancelRequestedAt) {
    return "Stopping";
  }
  switch (goal.status) {
    case "queued":
      return "Goal queued";
    case "running":
      return goalHasRunningWorker(goal) ? "Goal active · worker running" : "Goal active · waiting";
    case "paused":
      return "Goal paused";
    case "waiting":
      return "Goal waiting";
    case "blocked":
      return "Goal blocked";
    default:
      return "Goal active";
  }
}

export function buildWorkSurfaceSnapshot(input: BuildWorkSurfaceSnapshotInput): WorkSurfaceItem[] {
  const items: WorkSurfaceItem[] = [];
  const currentSessionKey = normalizeText(input.currentSessionKey);
  const chatRunId = normalizeText(input.chatRunId);

  if (chatRunId) {
    const assistantName = normalizeText(input.assistantName) ?? "OpenClaw";
    items.push({
      id: `chat-run:${chatRunId}`,
      kind: "chat_run",
      title: `${assistantName} is working…`,
      status: "Working",
      updatedAt: input.chatRunStatus?.occurredAt,
      sessionKey: currentSessionKey,
      runId: chatRunId,
      actions: ["stop_run"],
    });
  }

  for (const item of input.chatQueue ?? []) {
    const failed = item.sendState === "failed" || Boolean(item.sendError && !item.sendState);
    items.push({
      id: `queued:${item.id}`,
      kind: "queued_message",
      title: queueTitle(item),
      status: queueStatusLabel(item),
      detail: item.localCommandName ? `/${item.localCommandName}` : undefined,
      updatedAt: item.createdAt,
      runId: item.pendingRunId,
      ...(failed
        ? {
            attention: {
              owner: "Chat queue",
              nextAction: "Retry the message or remove it from the queue.",
            },
          }
        : {}),
      actions: ["remove_queue"],
    });
  }

  const goal = resolveCurrentChatGoal(input.goals ?? undefined);
  if (goal && isActiveChatGoal(goal.status)) {
    const flowId = normalizeText(goal.flowId) ?? normalizeText(goal.id);
    const blocked = goal.status === "blocked";
    items.push({
      id: `goal:${flowId ?? goal.goal}`,
      kind: "goal",
      title: goal.goal,
      status: goalStatusLabel(goal),
      detail: normalizeText(goal.blockedSummary) ?? normalizeText(goal.currentStep),
      updatedAt: normalizeTimestamp(goal.updatedAt) ?? normalizeTimestamp(goal.createdAt),
      sessionKey: currentSessionKey,
      ...(blocked
        ? {
            attention: {
              owner: "Pursue Goal",
              nextAction: "Open the goal, review the blocker, then retry or edit it.",
            },
          }
        : {}),
      actions: ["open_goal"],
    });
  }

  for (const task of input.tasks ?? []) {
    const taskId = normalizeText(task.taskId) ?? normalizeText(task.id);
    const status = taskStatusLabel(normalizeText(task.status));
    items.push({
      id: `task:${taskId ?? normalizeText(task.runId) ?? normalizeText(task.title) ?? items.length}`,
      kind: "task",
      title: taskTitle(task),
      status,
      detail: taskDetail(task),
      updatedAt: normalizeTimestamp(task.updatedAt) ?? normalizeTimestamp(task.createdAt),
      sessionKey: normalizeText(task.sessionKey),
      projectId: normalizeText(task.projectId),
      runId: normalizeText(task.runId),
      taskId,
      actions: taskId ? ["cancel_task"] : [],
    });
  }

  for (const row of input.sessionsResult?.sessions ?? []) {
    const hasExecutingRun =
      isSessionRunActive(row) ||
      row.hasActiveSubagentRun === true ||
      row.subagentRunState === "active";
    if (!hasExecutingRun) {
      continue;
    }
    if (chatRunId && currentSessionKey && areUiSessionKeysEquivalent(row.key, currentSessionKey)) {
      continue;
    }
    items.push({
      id: `session:${row.key}`,
      kind: "active_session",
      title: sessionTitle(row),
      status: "Active",
      detail: row.lastMessagePreview ?? row.status ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
      sessionKey: row.key,
      projectId: row.projectId,
      actions: ["open_session"],
    });
  }

  return items.toSorted((a, b) => {
    const rankDiff = itemRank(a) - itemRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

export function hasActiveWork(items: readonly WorkSurfaceItem[]): boolean {
  return items.length > 0;
}

function normalizedItemStatus(item: WorkSurfaceItem): string {
  return item.status.trim().toLowerCase();
}

/**
 * Keep the summary indicator tied to execution, not mere visibility. Queue entries and paused
 * goals remain useful in Working Now, but must not make an idle chat claim that work is running.
 */
export function isWorkSurfaceItemExecuting(item: WorkSurfaceItem): boolean {
  if (item.kind === "chat_run" || item.kind === "active_session") {
    return true;
  }
  if (item.kind === "task") {
    const status = normalizedItemStatus(item);
    return status === "active" || status === "running" || status === "working";
  }
  if (item.kind === "goal") {
    const status = normalizedItemStatus(item);
    return status === "goal active · worker running" || status === "stopping";
  }
  return false;
}

export function hasQueuedWork(items: readonly WorkSurfaceItem[]): boolean {
  return items.some((item) => {
    if (item.kind === "queued_message") {
      return true;
    }
    if (item.kind === "task") {
      return normalizedItemStatus(item) === "queued";
    }
    return item.kind === "goal" && normalizedItemStatus(item) === "goal queued";
  });
}

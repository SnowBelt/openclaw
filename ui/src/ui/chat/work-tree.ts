import { areUiSessionKeysEquivalent } from "../session-key.ts";
import { isSessionRunActive } from "../session-run-state.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";
import type { WorkSurfaceTaskSummary } from "./work-snapshot.ts";

export type AgentWorkTreeAction = "cancel_task" | "open_session";

export type AgentWorkTreeNode = {
  actions: AgentWorkTreeAction[];
  activeDescendants: number;
  children: AgentWorkTreeNode[];
  depth: number;
  detail?: string;
  id: string;
  isActive: boolean;
  parentSessionKey?: string;
  sessionKey: string;
  status: string;
  taskId?: string;
  title: string;
  updatedAt?: number;
};

export type AgentWorkTreeSnapshot = {
  activeChildCount: number;
  childCount: number;
  flat: AgentWorkTreeNode[];
  root: AgentWorkTreeNode | null;
};

export type BuildAgentWorkTreeSnapshotInput = {
  currentSessionKey?: string | null;
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

function sessionTitle(row: GatewaySessionRow | undefined, fallbackKey: string): string {
  return (
    normalizeText(row?.displayName) ??
    normalizeText(row?.derivedTitle) ??
    normalizeText(row?.label) ??
    normalizeText(row?.lastMessagePreview) ??
    fallbackKey
  );
}

function taskStatus(task: WorkSurfaceTaskSummary | undefined): string | undefined {
  return normalizeText(task?.status)?.toLowerCase();
}

function taskIsActive(task: WorkSurfaceTaskSummary | undefined): boolean {
  const status = taskStatus(task);
  return status === "active" || status === "queued" || status === "running" || status === "working";
}

function rowIsActive(
  row: GatewaySessionRow | undefined,
  task: WorkSurfaceTaskSummary | undefined,
): boolean {
  if (taskIsActive(task)) {
    return true;
  }
  if (isSessionRunActive(row ?? {}) || row?.hasActiveSubagentRun === true) {
    return true;
  }
  if (row?.subagentRunState === "active") {
    return true;
  }
  return false;
}

function statusLabel(
  row: GatewaySessionRow | undefined,
  task: WorkSurfaceTaskSummary | undefined,
  root: boolean,
): string {
  const taskStatusValue = taskStatus(task);
  if (taskStatusValue === "running") {
    return "Running";
  }
  if (taskStatusValue === "active" || taskStatusValue === "working") {
    return "Working";
  }
  if (taskStatusValue === "queued") {
    return "Queued";
  }
  if (rowIsActive(row, undefined)) {
    return row?.status === "running" ? "Running" : "Working";
  }
  return root ? "Current chat" : "Idle";
}

function taskDetail(task: WorkSurfaceTaskSummary | undefined): string | undefined {
  return (
    normalizeText(task?.progressSummary) ??
    normalizeText(task?.blockedReason) ??
    normalizeText(task?.error) ??
    normalizeText(task?.terminalSummary) ??
    normalizeText(task?.runtime)
  );
}

function rowDetail(
  row: GatewaySessionRow | undefined,
  task: WorkSurfaceTaskSummary | undefined,
): string | undefined {
  return taskDetail(task) ?? normalizeText(row?.lastMessagePreview) ?? normalizeText(row?.model);
}

function taskId(task: WorkSurfaceTaskSummary | undefined): string | undefined {
  return normalizeText(task?.taskId) ?? normalizeText(task?.id);
}

function taskForSession(
  tasks: readonly WorkSurfaceTaskSummary[],
  sessionKey: string,
): WorkSurfaceTaskSummary | undefined {
  return tasks
    .filter((task) => {
      const taskSessionKey = normalizeText(task.sessionKey);
      return taskSessionKey ? areUiSessionKeysEquivalent(taskSessionKey, sessionKey) : false;
    })
    .toSorted((a, b) => {
      const activeDiff = Number(taskIsActive(b)) - Number(taskIsActive(a));
      if (activeDiff !== 0) {
        return activeDiff;
      }
      return (
        (normalizeTimestamp(b.updatedAt) ?? normalizeTimestamp(b.createdAt) ?? 0) -
        (normalizeTimestamp(a.updatedAt) ?? normalizeTimestamp(a.createdAt) ?? 0)
      );
    })[0];
}

function updatedAt(
  row: GatewaySessionRow | undefined,
  task: WorkSurfaceTaskSummary | undefined,
): number | undefined {
  return (
    normalizeTimestamp(task?.updatedAt) ??
    normalizeTimestamp(task?.createdAt) ??
    row?.updatedAt ??
    undefined
  );
}

function compareRows(
  left: GatewaySessionRow,
  right: GatewaySessionRow,
  tasks: readonly WorkSurfaceTaskSummary[],
): number {
  const leftActive = rowIsActive(left, taskForSession(tasks, left.key));
  const rightActive = rowIsActive(right, taskForSession(tasks, right.key));
  const activeDiff = Number(rightActive) - Number(leftActive);
  if (activeDiff !== 0) {
    return activeDiff;
  }
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function collectParentLinks(row: GatewaySessionRow): string[] {
  const links = [normalizeText(row.spawnedBy), normalizeText(row.parentSessionKey)].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(links)];
}

function createNode(params: {
  depth: number;
  parentSessionKey?: string;
  row?: GatewaySessionRow;
  root: boolean;
  sessionKey: string;
  task?: WorkSurfaceTaskSummary;
}): AgentWorkTreeNode {
  const active = rowIsActive(params.row, params.task);
  const nextTaskId = taskId(params.task);
  return {
    actions: ["open_session", ...(nextTaskId ? (["cancel_task"] as const) : [])],
    activeDescendants: 0,
    children: [],
    depth: params.depth,
    detail: rowDetail(params.row, params.task),
    id: `agent-work:${params.sessionKey}`,
    isActive: active,
    parentSessionKey: params.parentSessionKey,
    sessionKey: params.sessionKey,
    status: statusLabel(params.row, params.task, params.root),
    taskId: nextTaskId,
    title: params.root ? "Current chat" : sessionTitle(params.row, params.sessionKey),
    updatedAt: updatedAt(params.row, params.task),
  };
}

function countActiveDescendants(node: AgentWorkTreeNode): number {
  const childActive = node.children.filter((child) => child.isActive).length;
  const descendantActive = node.children.reduce(
    (sum, child) => sum + countActiveDescendants(child),
    0,
  );
  node.activeDescendants = childActive + descendantActive;
  return node.activeDescendants;
}

function flatten(node: AgentWorkTreeNode, includeRoot: boolean): AgentWorkTreeNode[] {
  const own = includeRoot ? [node] : [];
  return [...own, ...node.children.flatMap((child) => flatten(child, true))];
}

export function buildAgentWorkTreeSnapshot(
  input: BuildAgentWorkTreeSnapshotInput,
): AgentWorkTreeSnapshot {
  const currentSessionKey = normalizeText(input.currentSessionKey);
  if (!currentSessionKey) {
    return { activeChildCount: 0, childCount: 0, flat: [], root: null };
  }

  const rows = input.sessionsResult?.sessions ?? [];
  const tasks = input.tasks ?? [];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const childKeysByParent = new Map<string, Set<string>>();

  for (const row of rows) {
    for (const parentKey of collectParentLinks(row)) {
      if (!childKeysByParent.has(parentKey)) {
        childKeysByParent.set(parentKey, new Set());
      }
      childKeysByParent.get(parentKey)!.add(row.key);
    }
    for (const childKey of row.childSessions ?? []) {
      const normalizedChildKey = normalizeText(childKey);
      if (!normalizedChildKey) {
        continue;
      }
      if (!childKeysByParent.has(row.key)) {
        childKeysByParent.set(row.key, new Set());
      }
      childKeysByParent.get(row.key)!.add(normalizedChildKey);
    }
  }

  const rootRow = rows.find((row) => areUiSessionKeysEquivalent(row.key, currentSessionKey));
  const root = createNode({
    depth: 0,
    row: rootRow,
    root: true,
    sessionKey: currentSessionKey,
    task: taskForSession(tasks, currentSessionKey),
  });

  const visited = new Set<string>([currentSessionKey]);
  const childKeysForParent = (parentSessionKey: string): string[] => {
    const childKeys = new Set<string>();
    for (const [parentKey, keys] of childKeysByParent) {
      if (areUiSessionKeysEquivalent(parentKey, parentSessionKey)) {
        for (const childKey of keys) {
          childKeys.add(childKey);
        }
      }
    }
    return [...childKeys];
  };
  const buildChildren = (parent: AgentWorkTreeNode) => {
    const childRows = childKeysForParent(parent.sessionKey)
      .filter((childKey) => !visited.has(childKey))
      .map((childKey) => byKey.get(childKey))
      .filter((row): row is GatewaySessionRow => Boolean(row))
      .toSorted((left, right) => compareRows(left, right, tasks));

    for (const row of childRows) {
      visited.add(row.key);
      const task = taskForSession(tasks, row.key);
      const child = createNode({
        depth: parent.depth + 1,
        parentSessionKey: parent.sessionKey,
        row,
        root: false,
        sessionKey: row.key,
        task,
      });
      buildChildren(child);
      if (child.isActive || child.children.length > 0) {
        parent.children.push(child);
      }
    }
  };

  buildChildren(root);
  countActiveDescendants(root);
  const flat = flatten(root, root.children.length > 0);
  return {
    activeChildCount: root.activeDescendants,
    childCount: flat.length > 0 ? flat.length - 1 : 0,
    flat,
    root: flat.length > 0 ? root : null,
  };
}

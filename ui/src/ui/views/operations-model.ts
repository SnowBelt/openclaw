import type { OperationsAgentSort } from "../controllers/operations-preferences.ts";
import type {
  OperationsActivityRollup,
  OperationsAgentSnapshot,
  OperationsFinding,
  OperationsIncidentHistoryEntry,
  OperationsSnapshot,
  OperationsWorkSummary,
} from "../types.ts";

export type OperationsAgentGroupId =
  | "urgent"
  | "attention"
  | "working"
  | "waiting"
  | "recent"
  | "ready"
  | "off";

export type OperationsAgentGroup = {
  id: OperationsAgentGroupId;
  agents: OperationsAgentSnapshot[];
};

export type OperationsWorkingItem = {
  id: string;
  agentId?: string;
  title: string;
  summary?: string;
  taskId?: string;
  workflowId?: string;
  updatedAt: number;
  count: number;
};

export type OperationsChangeItem =
  | {
      kind: "activity";
      id: string;
      at: number;
      rollup: OperationsActivityRollup;
    }
  | {
      kind: "incident";
      id: string;
      at: number;
      incident: OperationsIncidentHistoryEntry;
      finding?: OperationsFinding;
    };

export const OPERATIONS_AGENT_GROUP_ORDER: OperationsAgentGroupId[] = [
  "urgent",
  "attention",
  "working",
  "waiting",
  "recent",
  "ready",
  "off",
];

function meaningfulActivityAt(agent: OperationsAgentSnapshot): number {
  return (
    agent.currentWork?.updatedAt ?? agent.lastActivity?.updatedAt ?? agent.latestActivityAt ?? 0
  );
}

export function operationsAgentGroup(
  agent: OperationsAgentSnapshot,
  lastVisitedAt: number | null,
): OperationsAgentGroupId {
  if (agent.attentionState === "urgent") {
    return "urgent";
  }
  if (
    agent.attentionState === "needs_user" ||
    agent.attentionState === "handling" ||
    agent.attentionState === "watching" ||
    agent.healthState === "failed" ||
    agent.healthState === "degraded"
  ) {
    return "attention";
  }
  if (agent.activityState === "working") {
    return "working";
  }
  if (
    agent.activityState === "waiting" ||
    agent.activityState === "scheduled" ||
    agent.duty === "scheduled"
  ) {
    return "waiting";
  }
  if (lastVisitedAt != null && meaningfulActivityAt(agent) > lastVisitedAt) {
    return "recent";
  }
  if (agent.activityState === "ready") {
    return "ready";
  }
  return "off";
}

function compareNames(left: OperationsAgentSnapshot, right: OperationsAgentSnapshot): number {
  return (left.name ?? left.id).localeCompare(right.name ?? right.id, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareAgents(
  left: OperationsAgentSnapshot,
  right: OperationsAgentSnapshot,
  sort: OperationsAgentSort,
  pinned: ReadonlySet<string>,
): number {
  if (sort === "name") {
    return compareNames(left, right);
  }
  if (sort === "recent") {
    return meaningfulActivityAt(right) - meaningfulActivityAt(left) || compareNames(left, right);
  }
  const attentionRank = {
    urgent: 0,
    needs_user: 1,
    handling: 2,
    watching: 3,
    none: 4,
  } as const;
  const byAttention = attentionRank[left.attentionState] - attentionRank[right.attentionState];
  if (byAttention !== 0) {
    return byAttention;
  }
  const healthRank = { failed: 0, degraded: 1, unknown: 2, healthy: 3 } as const;
  const byHealth = healthRank[left.healthState] - healthRank[right.healthState];
  if (byHealth !== 0) {
    return byHealth;
  }
  const activityRank = {
    working: 0,
    waiting: 1,
    scheduled: 2,
    ready: 3,
    unknown: 4,
    off: 5,
  } as const;
  const byActivity = activityRank[left.activityState] - activityRank[right.activityState];
  if (byActivity !== 0) {
    return byActivity;
  }
  const pinRank = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
  if (pinRank !== 0) {
    return pinRank;
  }
  return meaningfulActivityAt(right) - meaningfulActivityAt(left) || compareNames(left, right);
}

export function groupOperationsAgents(params: {
  agents: readonly OperationsAgentSnapshot[];
  lastVisitedAt: number | null;
  pinnedAgentIds: readonly string[];
  query: string;
  sort: OperationsAgentSort;
}): OperationsAgentGroup[] {
  const query = params.query.trim().toLocaleLowerCase();
  const pinned = new Set(params.pinnedAgentIds);
  const filtered = query
    ? params.agents.filter((agent) =>
        [agent.name, agent.id, agent.currentWork?.title, agent.currentWork?.summary]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLocaleLowerCase().includes(query)),
      )
    : [...params.agents];
  return OPERATIONS_AGENT_GROUP_ORDER.map((id) => ({
    id,
    agents: filtered
      .filter((agent) => operationsAgentGroup(agent, params.lastVisitedAt) === id)
      .sort((left, right) => compareAgents(left, right, params.sort, pinned)),
  })).filter((group) => group.agents.length > 0);
}

function workingItemFromSummary(
  agentId: string,
  work: OperationsWorkSummary,
): OperationsWorkingItem | null {
  if (work.outcome !== "active") {
    return null;
  }
  return {
    id: `task:${work.taskId}`,
    taskId: work.taskId,
    agentId,
    title: work.title,
    summary: work.summary,
    updatedAt: work.updatedAt,
    count: 1,
  };
}

export function operationsWorkingItems(snapshot: OperationsSnapshot): OperationsWorkingItem[] {
  const items = new Map<string, OperationsWorkingItem>();
  for (const agent of snapshot.agents) {
    if (!agent.currentWork) {
      continue;
    }
    const item = workingItemFromSummary(agent.id, agent.currentWork);
    if (item) {
      items.set(item.id, item);
    }
  }
  for (const rollup of snapshot.activityRollups) {
    if (rollup.status !== "working") {
      continue;
    }
    if (rollup.taskId && items.has(`task:${rollup.taskId}`)) {
      continue;
    }
    items.set(`rollup:${rollup.key}`, {
      id: `rollup:${rollup.key}`,
      agentId: rollup.agentId,
      title: rollup.title,
      updatedAt: rollup.latestAt,
      count: rollup.count,
    });
  }
  for (const workflow of snapshot.workflows) {
    if (workflow.status !== "working") {
      continue;
    }
    const representedByTask = snapshot.tasks.some(
      (task) =>
        task.parentFlowId === workflow.id &&
        task.status === "working" &&
        items.has(`task:${task.id}`),
    );
    if (representedByTask) {
      continue;
    }
    items.set(`flow:${workflow.id}`, {
      id: `flow:${workflow.id}`,
      workflowId: workflow.id,
      agentId: workflow.controllerId ?? workflow.ownerKey,
      title: workflow.title,
      ...(workflow.currentStep || workflow.blocker
        ? { summary: workflow.currentStep ?? workflow.blocker }
        : {}),
      updatedAt: workflow.updatedAt,
      count: 1,
    });
  }
  return [...items.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
  );
}

export function operationsChangesSince(
  snapshot: OperationsSnapshot,
  lastVisitedAt: number | null,
): OperationsChangeItem[] {
  const boundary = lastVisitedAt ?? 0;
  const findingsById = new Map(snapshot.findings.map((finding) => [finding.id, finding]));
  const changes: OperationsChangeItem[] = [];
  for (const rollup of snapshot.activityRollups) {
    if (rollup.latestAt <= boundary || rollup.status === "working") {
      continue;
    }
    changes.push({ kind: "activity", id: `activity:${rollup.key}`, at: rollup.latestAt, rollup });
  }
  for (const incident of snapshot.incidentHistory) {
    const latestTransitionAt = incident.transitions.reduce(
      (latest, transition) => Math.max(latest, transition.at),
      0,
    );
    const changedAt = Math.max(
      incident.firstObservedAt,
      latestTransitionAt,
      incident.resolvedAt ?? 0,
    );
    if (changedAt <= boundary) {
      continue;
    }
    changes.push({
      kind: "incident",
      id: `incident:${incident.id}`,
      at: changedAt,
      incident,
      finding: findingsById.get(incident.id),
    });
  }
  return changes.sort((left, right) => right.at - left.at);
}

export function isOperationsSnapshotStale(
  snapshot: OperationsSnapshot,
  now: number,
  refreshFailedAt: number | null,
): boolean {
  return (
    refreshFailedAt != null ||
    snapshot.freshness.status !== "fresh" ||
    now > snapshot.freshness.observedAt + snapshot.freshness.staleAfterMs
  );
}

export function currentOperationsFindings(snapshot: OperationsSnapshot): OperationsFinding[] {
  return snapshot.findings.filter((finding) => finding.disposition !== "historical");
}

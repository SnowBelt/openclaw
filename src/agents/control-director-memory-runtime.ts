// Runtime projection from authoritative task, goal, and session stores into bounded memory records.
import { listSessionEntries } from "../config/sessions/session-accessor.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { listTaskRecords } from "../tasks/runtime-internal.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import { listTaskFlowRecords } from "../tasks/task-flow-runtime-internal.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import { truncateUtf16Safe } from "../utils.js";
import {
  assessControlDirectorMemoryHealth,
  rebuildControlDirectorMemoryIndex,
  type ControlDirectorMemoryHealth,
  type ControlDirectorMemoryRecord,
  type ControlDirectorMemorySource,
} from "./control-director-memory-index.js";

function taskUpdatedAt(task: TaskRecord): number {
  return task.endedAt ?? task.lastEventAt ?? task.startedAt ?? task.createdAt;
}

function flowUpdatedAt(flow: TaskFlowRecord): number {
  return flow.endedAt ?? flow.updatedAt ?? flow.createdAt;
}

function belongsToAgent(key: string | undefined, agentId: string): boolean {
  return Boolean(key && parseAgentSessionKey(key)?.agentId === agentId);
}

function taskMatches(params: { task: TaskRecord; sessionKey: string; agentId: string }): boolean {
  const task = params.task;
  return (
    task.ownerKey === params.sessionKey ||
    task.requesterSessionKey === params.sessionKey ||
    task.childSessionKey === params.sessionKey ||
    task.agentId === params.agentId ||
    belongsToAgent(task.ownerKey, params.agentId) ||
    belongsToAgent(task.requesterSessionKey, params.agentId) ||
    belongsToAgent(task.childSessionKey, params.agentId)
  );
}

function flowMatches(params: {
  flow: TaskFlowRecord;
  sessionKey: string;
  agentId: string;
}): boolean {
  return (
    params.flow.ownerKey === params.sessionKey ||
    belongsToAgent(params.flow.ownerKey, params.agentId)
  );
}

function oneLine(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? truncateUtf16Safe(normalized, maxChars) : undefined;
}

/** Collect source metadata only; transcripts remain canonical and are never copied into this projection. */
export function collectControlDirectorMemorySources(params: {
  sessionKey: string;
  agentId: string;
  storePath?: string;
}): ControlDirectorMemorySource[] {
  return [
    ...listTaskRecords()
      .filter((task) => taskMatches({ task, ...params }))
      .map((task) => ({
        sourceType: "task" as const,
        sourceId: task.taskId,
        agentId: params.agentId,
        sessionKey: task.ownerKey,
        title: `Task ${task.taskId} [${task.status}] - ${oneLine(task.label ?? task.task, 160) ?? "Untitled task"}`,
        summary: oneLine(task.terminalSummary ?? task.progressSummary ?? task.error, 240),
        updatedAt: taskUpdatedAt(task),
      })),
    ...listTaskFlowRecords()
      .filter((flow) => flowMatches({ flow, ...params }))
      .map((flow) => ({
        sourceType: "flow" as const,
        sourceId: flow.flowId,
        agentId: params.agentId,
        sessionKey: flow.ownerKey,
        title: `Flow ${flow.flowId} [${flow.status}] - ${oneLine(flow.goal, 160) ?? "Untitled flow"}`,
        summary: oneLine(flow.currentStep ?? flow.blockedSummary, 240),
        updatedAt: flowUpdatedAt(flow),
      })),
    ...(params.storePath
      ? listSessionEntries({ storePath: params.storePath })
          .filter(
            ({ sessionKey }) =>
              sessionKey !== params.sessionKey && belongsToAgent(sessionKey, params.agentId),
          )
          .map(({ sessionKey, entry }) => ({
            sourceType: "session" as const,
            sourceId: sessionKey,
            agentId: params.agentId,
            sessionKey,
            title:
              oneLine(entry.displayName ?? entry.label ?? entry.subject, 160) ??
              "Recent Control Director chat",
            summary: oneLine(entry.goal?.objective, 240),
            updatedAt: entry.updatedAt ?? 0,
          }))
      : []),
  ];
}

export function buildControlDirectorRuntimeMemoryState(params: {
  sessionKey: string;
  agentId: string;
  storePath?: string;
  now?: number;
}): {
  sources: ControlDirectorMemorySource[];
  records: ControlDirectorMemoryRecord[];
  health: ControlDirectorMemoryHealth;
} {
  const sources = collectControlDirectorMemorySources(params);
  const records = rebuildControlDirectorMemoryIndex({
    sources,
    agentId: params.agentId,
    now: params.now,
  });
  return {
    sources,
    records,
    health: assessControlDirectorMemoryHealth({
      sources,
      records,
      agentId: params.agentId,
      now: params.now,
    }),
  };
}

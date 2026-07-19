// Durable, idempotent assignment/result correlation for delegated Control Director work.
import crypto from "node:crypto";
import type { JsonValue } from "./task-flow-registry.types.js";

export const DURABLE_WORKER_MAILBOX_VERSION = 1 as const;
export const DURABLE_WORKER_MAILBOX_LIMIT = 128;

export type DurableWorkerMailboxMessage = {
  schemaVersion: typeof DURABLE_WORKER_MAILBOX_VERSION;
  messageId: string;
  idempotencyKey: string;
  flowId: string;
  missionId: string;
  direction: "assignment" | "result" | "control";
  kind: "work" | "progress" | "success" | "blocked" | "failure" | "cancel";
  actorId: string;
  recipientId: string;
  summary: string;
  createdAt: number;
  correlation: {
    runId?: string;
    taskId?: string;
    assignmentMessageId?: string;
  };
  evidenceRefs: string[];
  payload?: JsonValue;
};

export type DurableWorkerFanIn = {
  assignments: number;
  results: number;
  unresolvedAssignmentIds: string[];
  failedOrBlocked: number;
  ready: boolean;
};

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseMessage(value: unknown): DurableWorkerMailboxMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const correlation =
    record.correlation &&
    typeof record.correlation === "object" &&
    !Array.isArray(record.correlation)
      ? (record.correlation as Record<string, unknown>)
      : {};
  const evidenceRefs = Array.isArray(record.evidenceRefs)
    ? record.evidenceRefs.filter(
        (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
      )
    : null;
  const direction = record.direction;
  const kind = record.kind;
  const messageId = nonEmpty(record.messageId);
  const idempotencyKey = nonEmpty(record.idempotencyKey);
  const flowId = nonEmpty(record.flowId);
  const missionId = nonEmpty(record.missionId);
  const actorId = nonEmpty(record.actorId);
  const recipientId = nonEmpty(record.recipientId);
  const summary = nonEmpty(record.summary);
  if (
    record.schemaVersion !== DURABLE_WORKER_MAILBOX_VERSION ||
    !messageId ||
    !idempotencyKey ||
    !flowId ||
    !missionId ||
    (direction !== "assignment" && direction !== "result" && direction !== "control") ||
    (kind !== "work" &&
      kind !== "progress" &&
      kind !== "success" &&
      kind !== "blocked" &&
      kind !== "failure" &&
      kind !== "cancel") ||
    !actorId ||
    !recipientId ||
    !summary ||
    typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt) ||
    evidenceRefs === null
  ) {
    return null;
  }
  return {
    schemaVersion: DURABLE_WORKER_MAILBOX_VERSION,
    messageId,
    idempotencyKey,
    flowId,
    missionId,
    direction,
    kind,
    actorId,
    recipientId,
    summary,
    createdAt: record.createdAt,
    correlation: {
      ...(nonEmpty(correlation.runId) ? { runId: nonEmpty(correlation.runId)! } : {}),
      ...(nonEmpty(correlation.taskId) ? { taskId: nonEmpty(correlation.taskId)! } : {}),
      ...(nonEmpty(correlation.assignmentMessageId)
        ? { assignmentMessageId: nonEmpty(correlation.assignmentMessageId)! }
        : {}),
    },
    evidenceRefs: [...new Set(evidenceRefs.map((entry) => entry.trim()))].slice(0, 32),
    ...(record.payload !== undefined
      ? { payload: structuredClone(record.payload) as JsonValue }
      : {}),
  };
}

export function parseDurableWorkerMailbox(value: unknown): DurableWorkerMailboxMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = parseMessage(entry);
    return parsed ? [parsed] : [];
  });
}

export function createDurableWorkerMailboxMessage(
  params: Omit<
    DurableWorkerMailboxMessage,
    "schemaVersion" | "messageId" | "createdAt" | "evidenceRefs" | "correlation"
  > & {
    messageId?: string;
    createdAt?: number;
    evidenceRefs?: readonly string[];
    correlation?: DurableWorkerMailboxMessage["correlation"];
  },
): DurableWorkerMailboxMessage {
  return {
    schemaVersion: DURABLE_WORKER_MAILBOX_VERSION,
    messageId: params.messageId ?? crypto.randomUUID(),
    idempotencyKey: params.idempotencyKey.trim(),
    flowId: params.flowId.trim(),
    missionId: params.missionId.trim(),
    direction: params.direction,
    kind: params.kind,
    actorId: params.actorId.trim(),
    recipientId: params.recipientId.trim(),
    summary: params.summary.trim().slice(0, 8_000),
    createdAt: params.createdAt ?? Date.now(),
    correlation: { ...(params.correlation ?? {}) },
    evidenceRefs: [
      ...new Set((params.evidenceRefs ?? []).map((entry) => entry.trim()).filter(Boolean)),
    ].slice(0, 32),
    ...(params.payload !== undefined ? { payload: structuredClone(params.payload) } : {}),
  };
}

export function appendDurableWorkerMailboxMessage(
  mailbox: readonly DurableWorkerMailboxMessage[],
  message: DurableWorkerMailboxMessage,
  limit = DURABLE_WORKER_MAILBOX_LIMIT,
): DurableWorkerMailboxMessage[] {
  if (mailbox.some((entry) => entry.idempotencyKey === message.idempotencyKey)) {
    return [...mailbox];
  }
  return [...mailbox, message]
    .toSorted(
      (left, right) =>
        left.createdAt - right.createdAt || left.messageId.localeCompare(right.messageId),
    )
    .slice(-Math.max(1, Math.floor(limit)));
}

export function summarizeDurableWorkerFanIn(
  mailbox: readonly DurableWorkerMailboxMessage[],
): DurableWorkerFanIn {
  const assignments = mailbox.filter((message) => message.direction === "assignment");
  const results = mailbox.filter((message) => message.direction === "result");
  const resolved = new Set(
    results
      .map((message) => message.correlation.assignmentMessageId)
      .filter((value): value is string => Boolean(value)),
  );
  const unresolvedAssignmentIds = assignments
    .filter((assignment) => !resolved.has(assignment.messageId))
    .map((assignment) => assignment.messageId);
  return {
    assignments: assignments.length,
    results: results.length,
    unresolvedAssignmentIds,
    failedOrBlocked: results.filter(
      (message) => message.kind === "failure" || message.kind === "blocked",
    ).length,
    ready: assignments.length > 0 && unresolvedAssignmentIds.length === 0,
  };
}

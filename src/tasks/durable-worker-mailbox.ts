// Durable, idempotent assignment/result correlation for delegated Control Director work.
import crypto from "node:crypto";
import type { JsonValue } from "./task-flow-registry.types.js";

export const DURABLE_WORKER_MAILBOX_VERSION = 1 as const;
export const DURABLE_WORKER_MAILBOX_LIMIT = 128;
const MAILBOX_ID_MAX_CHARS = 512;
const MAILBOX_SUMMARY_MAX_CHARS = 8_000;
const MAILBOX_EVIDENCE_REF_MAX_CHARS = 2_048;
const MAILBOX_PAYLOAD_MAX_BYTES = 32 * 1_024;

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

function bounded(value: unknown, maxChars: number): string | undefined {
  const parsed = nonEmpty(value);
  return parsed && parsed.length <= maxChars ? parsed : undefined;
}

function jsonFits(value: unknown, maxBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
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
    ? record.evidenceRefs.every(
        (entry) =>
          typeof entry === "string" &&
          Boolean(entry.trim()) &&
          entry.length <= MAILBOX_EVIDENCE_REF_MAX_CHARS,
      )
      ? (record.evidenceRefs as string[])
      : null
    : null;
  const direction = record.direction;
  const kind = record.kind;
  const messageId = bounded(record.messageId, MAILBOX_ID_MAX_CHARS);
  const idempotencyKey = bounded(record.idempotencyKey, MAILBOX_ID_MAX_CHARS);
  const flowId = bounded(record.flowId, MAILBOX_ID_MAX_CHARS);
  const missionId = bounded(record.missionId, MAILBOX_ID_MAX_CHARS);
  const actorId = bounded(record.actorId, MAILBOX_ID_MAX_CHARS);
  const recipientId = bounded(record.recipientId, MAILBOX_ID_MAX_CHARS);
  const summary = bounded(record.summary, MAILBOX_SUMMARY_MAX_CHARS);
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
    evidenceRefs === null ||
    evidenceRefs.length > 32 ||
    (record.payload !== undefined && !jsonFits(record.payload, MAILBOX_PAYLOAD_MAX_BYTES))
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
      ...(bounded(correlation.runId, MAILBOX_ID_MAX_CHARS)
        ? { runId: bounded(correlation.runId, MAILBOX_ID_MAX_CHARS)! }
        : {}),
      ...(bounded(correlation.taskId, MAILBOX_ID_MAX_CHARS)
        ? { taskId: bounded(correlation.taskId, MAILBOX_ID_MAX_CHARS)! }
        : {}),
      ...(bounded(correlation.assignmentMessageId, MAILBOX_ID_MAX_CHARS)
        ? {
            assignmentMessageId: bounded(correlation.assignmentMessageId, MAILBOX_ID_MAX_CHARS)!,
          }
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
  return value.slice(-DURABLE_WORKER_MAILBOX_LIMIT).flatMap((entry) => {
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
    correlation: { ...params.correlation },
    evidenceRefs: [
      ...new Set((params.evidenceRefs ?? []).map((entry) => entry.trim()).filter(Boolean)),
    ],
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

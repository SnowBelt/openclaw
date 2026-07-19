// Versioned execution events shared by task, goal, activity, evidence, approval,
// Judge, and notification projections.
import crypto from "node:crypto";
import type { JsonValue } from "./task-flow-registry.types.js";

export const EXECUTION_EVENT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_EVENT_HISTORY_LIMIT = 200;

export type ExecutionEventCategory =
  | "run"
  | "task"
  | "goal"
  | "activity"
  | "evidence"
  | "approval"
  | "judge"
  | "notification";

export type ExecutionEventName =
  | "run.accepted"
  | "run.started"
  | "run.heartbeat"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "task.queued"
  | "task.delegated"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "goal.created"
  | "goal.edited"
  | "goal.paused"
  | "goal.resumed"
  | "goal.retrying"
  | "goal.completed"
  | "goal.blocked"
  | "goal.stopped"
  | "activity.working"
  | "activity.waiting"
  | "activity.verifying"
  | "evidence.recorded"
  | "evidence.rejected"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "approval.expired"
  | "judge.requested"
  | "judge.approved"
  | "judge.rejected"
  | "judge.invalid"
  | "notification.queued"
  | "notification.delivered"
  | "notification.failed";

const EVENT_NAMES_BY_CATEGORY: Record<ExecutionEventCategory, ReadonlySet<ExecutionEventName>> = {
  run: new Set([
    "run.accepted",
    "run.started",
    "run.heartbeat",
    "run.completed",
    "run.failed",
    "run.cancelled",
  ]),
  task: new Set([
    "task.queued",
    "task.delegated",
    "task.started",
    "task.progress",
    "task.completed",
    "task.failed",
    "task.cancelled",
  ]),
  goal: new Set([
    "goal.created",
    "goal.edited",
    "goal.paused",
    "goal.resumed",
    "goal.retrying",
    "goal.completed",
    "goal.blocked",
    "goal.stopped",
  ]),
  activity: new Set(["activity.working", "activity.waiting", "activity.verifying"]),
  evidence: new Set(["evidence.recorded", "evidence.rejected"]),
  approval: new Set([
    "approval.requested",
    "approval.granted",
    "approval.denied",
    "approval.expired",
  ]),
  judge: new Set(["judge.requested", "judge.approved", "judge.rejected", "judge.invalid"]),
  notification: new Set(["notification.queued", "notification.delivered", "notification.failed"]),
};

export type ExecutionEventCorrelation = {
  missionId?: string;
  runId?: string;
  taskId?: string;
  sessionKey?: string;
  idempotencyKey?: string;
};

export type ExecutionEventV1 = {
  schemaVersion: typeof EXECUTION_EVENT_SCHEMA_VERSION;
  eventId: string;
  sequence: number;
  at: number;
  flowId: string;
  category: ExecutionEventCategory;
  name: ExecutionEventName;
  actorId: string;
  summary: string;
  correlation?: ExecutionEventCorrelation;
  payload?: JsonValue;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function parseCorrelation(value: unknown): ExecutionEventCorrelation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const correlation = {
    missionId: nonEmptyString(record.missionId),
    runId: nonEmptyString(record.runId),
    taskId: nonEmptyString(record.taskId),
    sessionKey: nonEmptyString(record.sessionKey),
    idempotencyKey: nonEmptyString(record.idempotencyKey),
  };
  const compact = Object.fromEntries(
    Object.entries(correlation).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ) as ExecutionEventCorrelation;
  return Object.keys(compact).length > 0 ? compact : undefined;
}

/** Parse one persisted event, rejecting unknown names or category/name mismatches. */
export function parseExecutionEvent(value: unknown): ExecutionEventV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== EXECUTION_EVENT_SCHEMA_VERSION) {
    return undefined;
  }
  const eventId = nonEmptyString(record.eventId);
  const sequence = finiteNonNegativeInteger(record.sequence);
  const at = finiteNonNegativeInteger(record.at);
  const flowId = nonEmptyString(record.flowId);
  const actorId = nonEmptyString(record.actorId);
  const summary = nonEmptyString(record.summary);
  const category = nonEmptyString(record.category) as ExecutionEventCategory | undefined;
  const name = nonEmptyString(record.name) as ExecutionEventName | undefined;
  if (
    !eventId ||
    sequence === undefined ||
    at === undefined ||
    !flowId ||
    !actorId ||
    !summary ||
    !category ||
    !name ||
    !Object.hasOwn(EVENT_NAMES_BY_CATEGORY, category) ||
    !EVENT_NAMES_BY_CATEGORY[category].has(name)
  ) {
    return undefined;
  }
  const correlation = parseCorrelation(record.correlation);
  const payload = isJsonValue(record.payload) ? record.payload : undefined;
  return {
    schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
    eventId,
    sequence,
    at,
    flowId,
    category,
    name,
    actorId,
    summary,
    ...(correlation ? { correlation } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
}

export function parseExecutionEvents(value: unknown): ExecutionEventV1[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = parseExecutionEvent(entry);
    return parsed ? [parsed] : [];
  });
}

/** Create a monotonically sequenced event for one flow. */
export function createExecutionEvent(params: {
  flowId: string;
  category: ExecutionEventCategory;
  name: ExecutionEventName;
  actorId: string;
  summary: string;
  events?: readonly ExecutionEventV1[];
  correlation?: ExecutionEventCorrelation;
  payload?: JsonValue;
  at?: number;
  eventId?: string;
}): ExecutionEventV1 {
  if (!EVENT_NAMES_BY_CATEGORY[params.category].has(params.name)) {
    throw new Error(`Execution event ${params.name} does not belong to ${params.category}.`);
  }
  const previousSequence = Math.max(-1, ...(params.events ?? []).map((event) => event.sequence));
  return {
    schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
    eventId: params.eventId ?? crypto.randomUUID(),
    sequence: previousSequence + 1,
    at: params.at ?? Date.now(),
    flowId: params.flowId.trim(),
    category: params.category,
    name: params.name,
    actorId: params.actorId.trim(),
    summary: params.summary.trim(),
    ...(params.correlation ? { correlation: { ...params.correlation } } : {}),
    ...(params.payload !== undefined ? { payload: structuredClone(params.payload) } : {}),
  };
}

/** Append idempotently and retain a bounded recent event history. */
export function appendExecutionEvent(
  events: readonly ExecutionEventV1[],
  event: ExecutionEventV1,
  limit = EXECUTION_EVENT_HISTORY_LIMIT,
): ExecutionEventV1[] {
  const appended = events.some((candidate) => candidate.eventId === event.eventId)
    ? [...events]
    : [...events, event];
  return appended
    .toSorted((left, right) => left.sequence - right.sequence || left.at - right.at)
    .slice(-Math.max(1, Math.floor(limit)));
}

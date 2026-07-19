// Durable state contract for the lease-driven Pursue Goal controller.
import crypto from "node:crypto";
import {
  parseDurableWorkerMailbox,
  type DurableWorkerMailboxMessage,
} from "./durable-worker-mailbox.js";
import {
  appendExecutionEvent,
  createExecutionEvent,
  parseExecutionEvents,
  type ExecutionEventCategory,
  type ExecutionEventCorrelation,
  type ExecutionEventName,
  type ExecutionEventV1,
} from "./execution-event.js";
import type { JsonValue, TaskFlowRecord } from "./task-flow-registry.types.js";

export const PURSUE_GOAL_CONTROLLER_ID = "openclaw/pursue-goal-v1";
export const PURSUE_GOAL_STATE_SCHEMA_VERSION = 1 as const;

export type PursueGoalPhase =
  | "queued"
  | "running"
  | "paused"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PursueGoalLease = {
  ownerId: string;
  leaseId: string;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

export type PursueGoalJudgeReceipt = {
  schemaVersion: 1;
  receiptId: string;
  missionId: string;
  claimHash: string;
  verdict: "APPROVE" | "REJECT" | "REQUEST_MORE_EVIDENCE" | "ESCALATE_TO_HUMAN";
  scope: string;
  evidenceSummary: string;
  conditions: string;
  judgeRunId: string;
  judgeAgentId: string;
  model?: string;
  issuedAt: number;
  signature?: string;
  publicKeyId?: string;
};

export type PursueGoalControllerState = {
  schemaVersion: typeof PURSUE_GOAL_STATE_SCHEMA_VERSION;
  kind: "pursue_goal";
  missionId: string;
  idempotencyKey: string;
  goalVersion: number;
  goalHistory: Array<{ version: number; goal: string; editedAt: number }>;
  phase: PursueGoalPhase;
  controllerId: typeof PURSUE_GOAL_CONTROLLER_ID;
  workerAgentId: string;
  workerSessionKey: string;
  workerSessionId: string;
  lease?: PursueGoalLease;
  turnCount: number;
  activationCount: number;
  consecutiveFailures: number;
  consecutiveBlockers: number;
  nextAction?: string;
  lastResult?: string;
  lastError?: string;
  pauseRequestedAt?: number;
  stopRequestedAt?: number;
  retryAt?: number;
  terminalQueuedAt?: number;
  terminalConsumedAt?: number;
  terminalDeliveredAt?: number;
  terminalDeliveryState?: "pending" | "queued" | "consumed" | "failed";
  terminalDeliveryAttempts: number;
  terminalDeliveryLastError?: string;
  staleGoalRepairAttempts: number;
  staleGoalRepairLastAt?: number;
  judgeReceipt?: PursueGoalJudgeReceipt;
  mailbox: DurableWorkerMailboxMessage[];
  events: ExecutionEventV1[];
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parsePhase(value: unknown): PursueGoalPhase | undefined {
  return value === "queued" ||
    value === "running" ||
    value === "paused" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : undefined;
}

function parseLease(value: unknown): PursueGoalLease | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const ownerId = nonEmptyString(record.ownerId);
  const leaseId = nonEmptyString(record.leaseId);
  const acquiredAt = finiteTimestamp(record.acquiredAt);
  const heartbeatAt = finiteTimestamp(record.heartbeatAt);
  const expiresAt = finiteTimestamp(record.expiresAt);
  return ownerId && leaseId && acquiredAt !== undefined && heartbeatAt !== undefined && expiresAt
    ? { ownerId, leaseId, acquiredAt, heartbeatAt, expiresAt }
    : undefined;
}

function parseGoalHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const version = nonNegativeInteger(record.version, -1);
    const goal = nonEmptyString(record.goal);
    const editedAt = finiteTimestamp(record.editedAt);
    return version >= 0 && goal && editedAt !== undefined ? [{ version, goal, editedAt }] : [];
  });
}

function parseJudgeReceipt(value: unknown): PursueGoalJudgeReceipt | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const verdict = record.verdict;
  if (
    verdict !== "APPROVE" &&
    verdict !== "REJECT" &&
    verdict !== "REQUEST_MORE_EVIDENCE" &&
    verdict !== "ESCALATE_TO_HUMAN"
  ) {
    return undefined;
  }
  const receiptId = nonEmptyString(record.receiptId);
  const missionId = nonEmptyString(record.missionId);
  const claimHash = nonEmptyString(record.claimHash);
  const scope = nonEmptyString(record.scope);
  const evidenceSummary = nonEmptyString(record.evidenceSummary);
  const conditions = nonEmptyString(record.conditions);
  const judgeRunId = nonEmptyString(record.judgeRunId);
  const judgeAgentId = nonEmptyString(record.judgeAgentId);
  const issuedAt = finiteTimestamp(record.issuedAt);
  if (
    record.schemaVersion !== 1 ||
    !receiptId ||
    !missionId ||
    !claimHash ||
    !scope ||
    !evidenceSummary ||
    !conditions ||
    !judgeRunId ||
    !judgeAgentId ||
    issuedAt === undefined
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    receiptId,
    missionId,
    claimHash,
    verdict,
    scope,
    evidenceSummary,
    conditions,
    judgeRunId,
    judgeAgentId,
    issuedAt,
    ...(nonEmptyString(record.model) ? { model: nonEmptyString(record.model)! } : {}),
    ...(nonEmptyString(record.signature) ? { signature: nonEmptyString(record.signature)! } : {}),
    ...(nonEmptyString(record.publicKeyId)
      ? { publicKeyId: nonEmptyString(record.publicKeyId)! }
      : {}),
  };
}

/** Build the initial state before any flow is allowed to report `running`. */
export function createPursueGoalControllerState(params: {
  flowId: string;
  goal: string;
  workerAgentId: string;
  now?: number;
  missionId?: string;
  idempotencyKey?: string;
  workerSessionId?: string;
}): PursueGoalControllerState {
  const now = params.now ?? Date.now();
  const missionId = params.missionId ?? crypto.randomUUID();
  const workerSessionId = params.workerSessionId ?? crypto.randomUUID();
  const workerSessionKey = `agent:${params.workerAgentId}:goal:${params.flowId}`;
  const event = createExecutionEvent({
    flowId: params.flowId,
    category: "goal",
    name: "goal.created",
    actorId: "control-ui",
    summary: "Pursue Goal accepted and queued for a controller lease.",
    correlation: { missionId, sessionKey: workerSessionKey },
    at: now,
  });
  return {
    schemaVersion: PURSUE_GOAL_STATE_SCHEMA_VERSION,
    kind: "pursue_goal",
    missionId,
    idempotencyKey: params.idempotencyKey ?? `pursue-goal:${params.flowId}:${missionId}`,
    goalVersion: 1,
    goalHistory: [{ version: 1, goal: params.goal.trim(), editedAt: now }],
    phase: "queued",
    controllerId: PURSUE_GOAL_CONTROLLER_ID,
    workerAgentId: params.workerAgentId,
    workerSessionKey,
    workerSessionId,
    turnCount: 0,
    activationCount: 0,
    consecutiveFailures: 0,
    consecutiveBlockers: 0,
    terminalDeliveryAttempts: 0,
    staleGoalRepairAttempts: 0,
    mailbox: [],
    nextAction: "Acquire a controller lease and start the first worker turn.",
    events: [event],
  };
}

/** Parse persisted controller state; malformed or foreign state fails closed. */
export function parsePursueGoalControllerState(
  value: JsonValue | undefined,
): PursueGoalControllerState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const missionId = nonEmptyString(record.missionId);
  const idempotencyKey = nonEmptyString(record.idempotencyKey);
  const phase = parsePhase(record.phase);
  const workerAgentId = nonEmptyString(record.workerAgentId);
  const workerSessionKey = nonEmptyString(record.workerSessionKey);
  const workerSessionId = nonEmptyString(record.workerSessionId);
  if (
    record.schemaVersion !== PURSUE_GOAL_STATE_SCHEMA_VERSION ||
    record.kind !== "pursue_goal" ||
    record.controllerId !== PURSUE_GOAL_CONTROLLER_ID ||
    !missionId ||
    !idempotencyKey ||
    !phase ||
    !workerAgentId ||
    !workerSessionKey ||
    !workerSessionId
  ) {
    return undefined;
  }
  const lease = parseLease(record.lease);
  const judgeReceipt = parseJudgeReceipt(record.judgeReceipt);
  return {
    schemaVersion: PURSUE_GOAL_STATE_SCHEMA_VERSION,
    kind: "pursue_goal",
    missionId,
    idempotencyKey,
    goalVersion: Math.max(1, nonNegativeInteger(record.goalVersion, 1)),
    goalHistory: parseGoalHistory(record.goalHistory),
    phase,
    controllerId: PURSUE_GOAL_CONTROLLER_ID,
    workerAgentId,
    workerSessionKey,
    workerSessionId,
    ...(lease ? { lease } : {}),
    turnCount: nonNegativeInteger(record.turnCount),
    activationCount: nonNegativeInteger(record.activationCount),
    consecutiveFailures: nonNegativeInteger(record.consecutiveFailures),
    consecutiveBlockers: nonNegativeInteger(record.consecutiveBlockers),
    ...(nonEmptyString(record.nextAction)
      ? { nextAction: nonEmptyString(record.nextAction)! }
      : {}),
    ...(nonEmptyString(record.lastResult)
      ? { lastResult: nonEmptyString(record.lastResult)! }
      : {}),
    ...(nonEmptyString(record.lastError) ? { lastError: nonEmptyString(record.lastError)! } : {}),
    ...(finiteTimestamp(record.pauseRequestedAt) !== undefined
      ? { pauseRequestedAt: finiteTimestamp(record.pauseRequestedAt)! }
      : {}),
    ...(finiteTimestamp(record.stopRequestedAt) !== undefined
      ? { stopRequestedAt: finiteTimestamp(record.stopRequestedAt)! }
      : {}),
    ...(finiteTimestamp(record.retryAt) !== undefined
      ? { retryAt: finiteTimestamp(record.retryAt)! }
      : {}),
    ...(finiteTimestamp(record.terminalDeliveredAt) !== undefined
      ? { terminalDeliveredAt: finiteTimestamp(record.terminalDeliveredAt)! }
      : {}),
    ...(finiteTimestamp(record.terminalQueuedAt) !== undefined
      ? { terminalQueuedAt: finiteTimestamp(record.terminalQueuedAt)! }
      : {}),
    ...(finiteTimestamp(record.terminalConsumedAt) !== undefined
      ? { terminalConsumedAt: finiteTimestamp(record.terminalConsumedAt)! }
      : {}),
    ...(record.terminalDeliveryState === "pending" ||
    record.terminalDeliveryState === "queued" ||
    record.terminalDeliveryState === "consumed" ||
    record.terminalDeliveryState === "failed"
      ? { terminalDeliveryState: record.terminalDeliveryState }
      : {}),
    terminalDeliveryAttempts: nonNegativeInteger(record.terminalDeliveryAttempts),
    ...(nonEmptyString(record.terminalDeliveryLastError)
      ? { terminalDeliveryLastError: nonEmptyString(record.terminalDeliveryLastError)! }
      : {}),
    staleGoalRepairAttempts: nonNegativeInteger(record.staleGoalRepairAttempts),
    ...(finiteTimestamp(record.staleGoalRepairLastAt) !== undefined
      ? { staleGoalRepairLastAt: finiteTimestamp(record.staleGoalRepairLastAt)! }
      : {}),
    ...(judgeReceipt ? { judgeReceipt } : {}),
    mailbox: parseDurableWorkerMailbox(record.mailbox),
    events: parseExecutionEvents(record.events),
  };
}

export function stateForPursueGoalFlow(
  flow: TaskFlowRecord,
): PursueGoalControllerState | undefined {
  return flow.controllerId === PURSUE_GOAL_CONTROLLER_ID
    ? parsePursueGoalControllerState(flow.stateJson)
    : undefined;
}

export function withPursueGoalEvent(
  state: PursueGoalControllerState,
  params: {
    flowId: string;
    category: ExecutionEventCategory;
    name: ExecutionEventName;
    actorId: string;
    summary: string;
    correlation?: ExecutionEventCorrelation;
    payload?: JsonValue;
    at?: number;
    eventId?: string;
  },
): PursueGoalControllerState {
  const event = createExecutionEvent({
    ...params,
    events: state.events,
    correlation: { missionId: state.missionId, ...params.correlation },
  });
  return { ...state, events: appendExecutionEvent(state.events, event) };
}

export function isPursueGoalLeaseCurrent(
  state: PursueGoalControllerState,
  params: { ownerId: string; leaseId: string; now?: number },
): boolean {
  const now = params.now ?? Date.now();
  return Boolean(
    state.lease &&
    state.lease.ownerId === params.ownerId &&
    state.lease.leaseId === params.leaseId &&
    state.lease.expiresAt > now,
  );
}

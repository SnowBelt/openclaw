// Durable state contract for the lease-driven Pursue Goal controller.
import crypto from "node:crypto";
import {
  JUDGE_ARTIFACT_ID_MAX_CHARS,
  JUDGE_ARTIFACT_MAX_COUNT,
  JUDGE_EVIDENCE_MAX_CHARS,
  JUDGE_RESPONSE_FIELD_MAX_CHARS,
  JUDGE_TRUSTED_EVIDENCE_ID_MAX_CHARS,
  JUDGE_TRUSTED_EVIDENCE_MAX_COUNT,
  JUDGE_TRUSTED_EVIDENCE_SUMMARY_MAX_CHARS,
  JUDGE_TRUSTED_EVIDENCE_KINDS,
  type JudgeTrustedEvidence,
} from "../agents/judge-contract.js";
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
export const PURSUE_GOAL_MAX_CHARS = 16_000;
export const PURSUE_GOAL_HISTORY_LIMIT = 20;
const PURSUE_GOAL_SUMMARY_MAX_CHARS = 8_000;
const PURSUE_GOAL_MODEL_MAX_CHARS = 512;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;

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

export type PursueGoalJudgeReceiptV1 = {
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

export type PursueGoalJudgeReceiptV2 = {
  schemaVersion: 2;
  receiptId: string;
  missionId: string;
  claimHash: string;
  verdict:
    | "APPROVE"
    | "REJECT"
    | "REQUEST_MORE_EVIDENCE"
    | "ESCALATE_TO_HUMAN"
    | "NEEDS_EVIDENCE"
    | "OUT_OF_SCOPE"
    | "OWNER_APPROVAL_REQUIRED"
    | "SYSTEM_ERROR";
  scope: string;
  evidenceSummary: string;
  conditions: string;
  judgeRunId: string;
  judgeAgentId: string;
  model?: string;
  issuedAt: number;
  /** Hash of the exact technical-only prompt sent to the model. */
  promptHash: string;
  /** Hash of the model response used to issue this receipt. */
  responseHash: string;
  /** Provider/runtime route observed for this decision. */
  route: "local" | "hosted" | "unknown";
  /** V2 model-visible tool proof; this must be an empty list for Judge turns. */
  modelVisibleTools: string[];
  /** Physical provider request count; the V2 contract requires exactly one. */
  requestCount: number;
  /** Present on newly issued receipts; optional for historical V2 readability. */
  trustedEvidenceDigest?: string;
  trustedEvidenceIds?: string[];
  signature?: string;
  publicKeyId?: string;
};

/** V1 remains readable; newly issued controller receipts are V2. */
export type PursueGoalJudgeReceipt = PursueGoalJudgeReceiptV1 | PursueGoalJudgeReceiptV2;

/**
 * Durable handoff for a worker result between the provider call and task
 * registry finalization. Keeping this marker in the flow state closes the
 * crash window where a completed Judge result could otherwise be lost after
 * the task row was written but before the controller state was persisted.
 */
export type PursueGoalPendingTurnResult = {
  status: "active" | "complete" | "blocked" | "paused";
  text: string;
  blocker?: string;
  provisionalBlocker?: string;
  evidenceSummary?: string;
  artifactIds?: string[];
  judgeReceipt?: PursueGoalJudgeReceipt;
  model?: string;
  trustedEvidence?: JudgeTrustedEvidence[];
};

export type PursueGoalPendingTurn = {
  runId: string;
  taskId: string;
  phase: "staged" | "applied";
  result: PursueGoalPendingTurnResult;
};

/** Durable before-call fence. An abandoned fence is blocked, never replayed. */
export type PursueGoalJudgeExecution = {
  runId: string;
  taskId: string;
  claimHash: string;
  promptHash: string;
  reservedAt: number;
};

export type PursueGoalJudgeClaimRecord = {
  claimHash: string;
  promptHash: string;
  runId: string;
  taskId: string;
  status: "settled" | "indeterminate";
  receiptId?: string;
  recordedAt: number;
};

/**
 * Claims are append-only: evicting an old hash would permit a replay after a
 * goal edit or restart. Bound serialized state size rather than claim count so
 * a long-lived flow can continue making new, unique claims without silently
 * becoming permanently unusable after an arbitrary number of edits.
 */
export const PURSUE_GOAL_JUDGE_CLAIM_HISTORY_MAX_BYTES = 512 * 1024;

export const PURSUE_GOAL_PENDING_TURN_TEXT_MAX_CHARS = 64_000;

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
  /** Canonical controller evidence retained for post-restart receipt verification. */
  judgeTrustedEvidence?: JudgeTrustedEvidence[];
  judgeExecution?: PursueGoalJudgeExecution;
  judgeClaims: PursueGoalJudgeClaimRecord[];
  pendingTurn?: PursueGoalPendingTurn;
  mailbox: DurableWorkerMailboxMessage[];
  events: ExecutionEventV1[];
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedString(value: unknown, maxChars: number): string | undefined {
  const parsed = nonEmptyString(value);
  return parsed && parsed.length <= maxChars ? parsed : undefined;
}

/** Validate a persisted signed field without changing the signed bytes. */
function boundedRawString(value: unknown, maxChars: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= maxChars ? value : undefined;
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
  return value.slice(-PURSUE_GOAL_HISTORY_LIMIT).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const version = nonNegativeInteger(record.version, -1);
    const goal = boundedString(record.goal, PURSUE_GOAL_MAX_CHARS);
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
  const v1Verdicts = ["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE", "ESCALATE_TO_HUMAN"] as const;
  const v2Verdicts = [
    "APPROVE",
    "REJECT",
    "REQUEST_MORE_EVIDENCE",
    "ESCALATE_TO_HUMAN",
    "NEEDS_EVIDENCE",
    "OUT_OF_SCOPE",
    "OWNER_APPROVAL_REQUIRED",
    "SYSTEM_ERROR",
  ] as const;
  const schemaVersion = record.schemaVersion;
  if (
    (schemaVersion === 1 && !v1Verdicts.includes(verdict as (typeof v1Verdicts)[number])) ||
    (schemaVersion === 2 && !v2Verdicts.includes(verdict as (typeof v2Verdicts)[number])) ||
    (schemaVersion !== 1 && schemaVersion !== 2)
  ) {
    return undefined;
  }
  const receiptId = boundedRawString(record.receiptId, 512);
  const missionId = boundedRawString(record.missionId, 512);
  const claimHash = boundedRawString(record.claimHash, 64);
  const scope = boundedRawString(record.scope, JUDGE_RESPONSE_FIELD_MAX_CHARS);
  const evidenceSummary = boundedRawString(record.evidenceSummary, JUDGE_EVIDENCE_MAX_CHARS);
  const conditions = boundedRawString(record.conditions, JUDGE_RESPONSE_FIELD_MAX_CHARS);
  const judgeRunId = boundedRawString(record.judgeRunId, 512);
  const judgeAgentId = boundedRawString(record.judgeAgentId, 512);
  const issuedAt = finiteTimestamp(record.issuedAt);
  if (
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
  const common = {
    receiptId,
    missionId,
    claimHash,
    verdict: verdict as PursueGoalJudgeReceipt["verdict"],
    scope,
    evidenceSummary,
    conditions,
    judgeRunId,
    judgeAgentId,
    issuedAt,
    ...(boundedRawString(record.model, PURSUE_GOAL_MODEL_MAX_CHARS)
      ? { model: boundedRawString(record.model, PURSUE_GOAL_MODEL_MAX_CHARS)! }
      : {}),
    ...(boundedRawString(record.signature, 512)
      ? { signature: boundedRawString(record.signature, 512)! }
      : {}),
    ...(boundedRawString(record.publicKeyId, 64)
      ? { publicKeyId: boundedRawString(record.publicKeyId, 64)! }
      : {}),
  };
  if (schemaVersion === 1) {
    return { schemaVersion: 1, ...common } as PursueGoalJudgeReceiptV1;
  }
  if (!SHA256_HEX_RE.test(claimHash)) {
    return undefined;
  }
  const route = record.route;
  if (route !== undefined && route !== "local" && route !== "hosted" && route !== "unknown") {
    return undefined;
  }
  const requestCount = record.requestCount;
  if (
    requestCount !== undefined &&
    (typeof requestCount !== "number" || !Number.isSafeInteger(requestCount) || requestCount < 0)
  ) {
    return undefined;
  }
  const modelVisibleTools = record.modelVisibleTools;
  if (
    modelVisibleTools !== undefined &&
    (!Array.isArray(modelVisibleTools) ||
      modelVisibleTools.length > 32 ||
      modelVisibleTools.some(
        (tool) => typeof tool !== "string" || !tool.trim() || tool.length > 128,
      ))
  ) {
    return undefined;
  }
  const promptHash = boundedRawString(record.promptHash, 64);
  const responseHash = boundedRawString(record.responseHash, 64);
  const trustedEvidenceDigest = boundedRawString(record.trustedEvidenceDigest, 64);
  const trustedEvidenceIds = record.trustedEvidenceIds;
  if (
    !promptHash ||
    !responseHash ||
    !SHA256_HEX_RE.test(promptHash) ||
    !SHA256_HEX_RE.test(responseHash) ||
    !route ||
    requestCount === undefined ||
    !modelVisibleTools
  ) {
    return undefined;
  }
  if (
    (trustedEvidenceDigest !== undefined) !== (trustedEvidenceIds !== undefined) ||
    (trustedEvidenceDigest !== undefined &&
      (!SHA256_HEX_RE.test(trustedEvidenceDigest) ||
        !Array.isArray(trustedEvidenceIds) ||
        trustedEvidenceIds.length > 32 ||
        new Set(trustedEvidenceIds).size !== trustedEvidenceIds.length ||
        trustedEvidenceIds.some(
          (id) =>
            typeof id !== "string" || !id.trim() || id.length > JUDGE_TRUSTED_EVIDENCE_ID_MAX_CHARS,
        )))
  ) {
    return undefined;
  }
  return {
    schemaVersion: 2,
    ...common,
    promptHash,
    responseHash,
    route,
    requestCount,
    modelVisibleTools: [...modelVisibleTools],
    ...(trustedEvidenceDigest
      ? {
          trustedEvidenceDigest,
          trustedEvidenceIds: [...(trustedEvidenceIds as string[])],
        }
      : {}),
  } as PursueGoalJudgeReceiptV2;
}

function parsePendingTurn(value: unknown): PursueGoalPendingTurn | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const runId = nonEmptyString(record.runId);
  const taskId = nonEmptyString(record.taskId);
  const phase = record.phase === "staged" || record.phase === "applied" ? record.phase : undefined;
  if (!runId || !taskId || !phase || !record.result || typeof record.result !== "object") {
    return undefined;
  }
  const result = record.result as Record<string, unknown>;
  const status =
    result.status === "active" ||
    result.status === "complete" ||
    result.status === "blocked" ||
    result.status === "paused"
      ? result.status
      : undefined;
  if (status === undefined || typeof result.text !== "string") {
    return undefined;
  }
  if (result.text.length > PURSUE_GOAL_PENDING_TURN_TEXT_MAX_CHARS) {
    return undefined;
  }
  const blocker = boundedString(result.blocker, PURSUE_GOAL_SUMMARY_MAX_CHARS);
  const provisionalBlocker = boundedString(
    result.provisionalBlocker,
    PURSUE_GOAL_SUMMARY_MAX_CHARS,
  );
  const evidenceSummary = boundedString(result.evidenceSummary, JUDGE_EVIDENCE_MAX_CHARS);
  const model = boundedString(result.model, PURSUE_GOAL_MODEL_MAX_CHARS);
  if (
    (result.blocker !== undefined && !blocker) ||
    (result.provisionalBlocker !== undefined && !provisionalBlocker) ||
    (result.evidenceSummary !== undefined && !evidenceSummary) ||
    (result.model !== undefined && !model)
  ) {
    return undefined;
  }
  const artifactIds = result.artifactIds;
  if (
    artifactIds !== undefined &&
    (!Array.isArray(artifactIds) ||
      artifactIds.length > JUDGE_ARTIFACT_MAX_COUNT ||
      artifactIds.some(
        (artifactId) =>
          typeof artifactId !== "string" ||
          !artifactId.trim() ||
          artifactId.length > JUDGE_ARTIFACT_ID_MAX_CHARS,
      ))
  ) {
    return undefined;
  }
  const judgeReceipt = parseJudgeReceipt(result.judgeReceipt);
  if (result.judgeReceipt !== undefined && !judgeReceipt) {
    return undefined;
  }
  const trustedEvidence = parseJudgeTrustedEvidence(result.trustedEvidence);
  if (result.trustedEvidence !== undefined && !trustedEvidence) {
    return undefined;
  }
  return {
    runId,
    taskId,
    phase,
    result: {
      status,
      text: result.text,
      ...(blocker ? { blocker } : {}),
      ...(provisionalBlocker ? { provisionalBlocker } : {}),
      ...(evidenceSummary ? { evidenceSummary } : {}),
      ...(model ? { model } : {}),
      ...(artifactIds ? { artifactIds: [...artifactIds] as string[] } : {}),
      ...(judgeReceipt ? { judgeReceipt } : {}),
      ...(trustedEvidence ? { trustedEvidence } : {}),
    },
  };
}

function parseJudgeExecution(value: unknown): PursueGoalJudgeExecution | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const runId = boundedString(record.runId, 512);
  const taskId = boundedString(record.taskId, 512);
  const claimHash = boundedString(record.claimHash, 64);
  const promptHash = boundedString(record.promptHash, 64);
  const reservedAt = finiteTimestamp(record.reservedAt);
  return runId &&
    taskId &&
    claimHash &&
    promptHash &&
    SHA256_HEX_RE.test(claimHash) &&
    SHA256_HEX_RE.test(promptHash) &&
    reservedAt !== undefined
    ? { runId, taskId, claimHash, promptHash, reservedAt }
    : undefined;
}

function parseJudgeTrustedEvidence(value: unknown): JudgeTrustedEvidence[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > JUDGE_TRUSTED_EVIDENCE_MAX_COUNT) {
    return undefined;
  }
  const seen = new Set<string>();
  const parsed: JudgeTrustedEvidence[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    const id = boundedRawString(record.id, JUDGE_TRUSTED_EVIDENCE_ID_MAX_CHARS);
    const summary = boundedRawString(record.summary, JUDGE_TRUSTED_EVIDENCE_SUMMARY_MAX_CHARS);
    const kind = record.kind;
    if (
      !id ||
      !summary ||
      typeof kind !== "string" ||
      !(JUDGE_TRUSTED_EVIDENCE_KINDS as readonly string[]).includes(kind) ||
      seen.has(id)
    ) {
      return undefined;
    }
    seen.add(id);
    parsed.push({ id, kind: kind as JudgeTrustedEvidence["kind"], summary });
  }
  return parsed;
}

function parseJudgeClaimRecords(value: unknown): PursueGoalJudgeClaimRecord[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  let serializedBytes: number;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      return undefined;
    }
    serializedBytes = Buffer.byteLength(serialized, "utf8");
  } catch {
    return undefined;
  }
  if (serializedBytes > PURSUE_GOAL_JUDGE_CLAIM_HISTORY_MAX_BYTES) {
    return undefined;
  }
  const seen = new Set<string>();
  const parsed: PursueGoalJudgeClaimRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const record = entry as Record<string, unknown>;
    const claimHash = boundedString(record.claimHash, 64);
    const promptHash = boundedString(record.promptHash, 64);
    const runId = boundedString(record.runId, 512);
    const taskId = boundedString(record.taskId, 512);
    const recordedAt = finiteTimestamp(record.recordedAt);
    const status = record.status;
    if (
      !claimHash ||
      !promptHash ||
      !SHA256_HEX_RE.test(claimHash) ||
      !SHA256_HEX_RE.test(promptHash) ||
      !runId ||
      !taskId ||
      recordedAt === undefined ||
      (status !== "settled" && status !== "indeterminate")
    ) {
      return undefined;
    }
    if (seen.has(claimHash)) {
      return undefined;
    }
    seen.add(claimHash);
    const receiptId = boundedString(record.receiptId, 512);
    parsed.push({
      claimHash,
      promptHash,
      runId,
      taskId,
      status,
      ...(receiptId ? { receiptId } : {}),
      recordedAt,
    });
  }
  return parsed;
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
    judgeClaims: [],
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
  const judgeExecution = parseJudgeExecution(record.judgeExecution);
  const pendingTurn = parsePendingTurn(record.pendingTurn);
  const judgeClaims = parseJudgeClaimRecords(record.judgeClaims);
  const judgeTrustedEvidence = parseJudgeTrustedEvidence(record.judgeTrustedEvidence);
  if (record.judgeReceipt !== undefined && !judgeReceipt) {
    return undefined;
  }
  if (record.pendingTurn !== undefined && !pendingTurn) {
    return undefined;
  }
  if (record.judgeExecution !== undefined && !judgeExecution) {
    return undefined;
  }
  if (record.judgeClaims !== undefined && !judgeClaims) {
    return undefined;
  }
  if (record.judgeTrustedEvidence !== undefined && !judgeTrustedEvidence) {
    return undefined;
  }
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
    ...(boundedString(record.nextAction, PURSUE_GOAL_SUMMARY_MAX_CHARS)
      ? { nextAction: boundedString(record.nextAction, PURSUE_GOAL_SUMMARY_MAX_CHARS)! }
      : {}),
    ...(boundedString(record.lastResult, PURSUE_GOAL_SUMMARY_MAX_CHARS)
      ? { lastResult: boundedString(record.lastResult, PURSUE_GOAL_SUMMARY_MAX_CHARS)! }
      : {}),
    ...(boundedString(record.lastError, PURSUE_GOAL_SUMMARY_MAX_CHARS)
      ? { lastError: boundedString(record.lastError, PURSUE_GOAL_SUMMARY_MAX_CHARS)! }
      : {}),
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
    ...(boundedString(record.terminalDeliveryLastError, PURSUE_GOAL_SUMMARY_MAX_CHARS)
      ? {
          terminalDeliveryLastError: boundedString(
            record.terminalDeliveryLastError,
            PURSUE_GOAL_SUMMARY_MAX_CHARS,
          )!,
        }
      : {}),
    staleGoalRepairAttempts: nonNegativeInteger(record.staleGoalRepairAttempts),
    ...(finiteTimestamp(record.staleGoalRepairLastAt) !== undefined
      ? { staleGoalRepairLastAt: finiteTimestamp(record.staleGoalRepairLastAt)! }
      : {}),
    ...(judgeReceipt ? { judgeReceipt } : {}),
    ...(judgeTrustedEvidence ? { judgeTrustedEvidence } : {}),
    ...(judgeExecution ? { judgeExecution } : {}),
    judgeClaims: judgeClaims ?? [],
    ...(pendingTurn ? { pendingTurn } : {}),
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

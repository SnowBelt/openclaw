import { createHash } from "node:crypto";
import type { JsonValue, TaskFlowRecord } from "./task-flow-registry.types.js";
import {
  getTaskFlowById,
  updateFlowRecordByIdExpectedRevision,
} from "./task-flow-runtime-internal.js";

const RECOVERY_OBLIGATIONS_KEY = "openclaw.recoveryObligations.v1";
const MAX_RECOVERY_OBLIGATIONS = 100;
const MAX_RECOVERY_PROOF_REQUIREMENTS = 16;
const MAX_RECOVERY_STRING_LENGTH = 256;

export type RecoveryObligationStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "approval_required";

export type RecoveryObligationV1 = {
  version: 1;
  obligationId: string;
  programId: string;
  ownerAgentId: string;
  flowId: string;
  scheduledFor: number;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  catchUpPolicy: "skip" | "run_latest" | "replay" | "resume" | "manual";
  idempotencyKey: string;
  reason:
    | "resource_conflict"
    | "unknown_competing_work"
    | "remediation_preempted"
    | "gateway_restart"
    | "missed_schedule"
    | "preflight_failed";
  status: RecoveryObligationStatus;
  proofRequirements: string[];
  disposition?: string;
};

const CATCH_UP_POLICIES = new Set<RecoveryObligationV1["catchUpPolicy"]>([
  "skip",
  "run_latest",
  "replay",
  "resume",
  "manual",
]);
const RECOVERY_REASONS = new Set<RecoveryObligationV1["reason"]>([
  "resource_conflict",
  "unknown_competing_work",
  "remediation_preempted",
  "gateway_restart",
  "missed_schedule",
  "preflight_failed",
]);
const RECOVERY_STATUSES = new Set<RecoveryObligationStatus>([
  "pending",
  "running",
  "completed",
  "skipped",
  "approval_required",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_RECOVERY_STRING_LENGTH
  );
}

function obligationId(input: {
  programId: string;
  flowId: string;
  idempotencyKey: string;
}): string {
  return `recovery_${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 20)}`;
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTerminalStatus(status: RecoveryObligationStatus): boolean {
  return status === "completed" || status === "skipped";
}

function parseRecoveryObligation(value: unknown): RecoveryObligationV1 | undefined {
  if (!isRecord(value) || value.version !== 1) {
    return undefined;
  }
  const requiredStrings = [
    "obligationId",
    "programId",
    "ownerAgentId",
    "flowId",
    "idempotencyKey",
    "reason",
    "status",
    "catchUpPolicy",
  ] as const;
  if (requiredStrings.some((key) => !isBoundedString(value[key]))) {
    return undefined;
  }
  const requiredNumbers = ["scheduledFor", "dueAt", "createdAt", "updatedAt"] as const;
  if (requiredNumbers.some((key) => !isSafeTimestamp(value[key]))) {
    return undefined;
  }
  if (
    !CATCH_UP_POLICIES.has(value.catchUpPolicy as RecoveryObligationV1["catchUpPolicy"]) ||
    !RECOVERY_REASONS.has(value.reason as RecoveryObligationV1["reason"]) ||
    !RECOVERY_STATUSES.has(value.status as RecoveryObligationStatus) ||
    !Array.isArray(value.proofRequirements) ||
    value.proofRequirements.length > MAX_RECOVERY_PROOF_REQUIREMENTS
  ) {
    return undefined;
  }
  const proofRequirements = value.proofRequirements.filter((entry): entry is string =>
    isBoundedString(entry),
  );
  if (proofRequirements.length !== value.proofRequirements.length) {
    return undefined;
  }
  const parsed: RecoveryObligationV1 = {
    version: 1,
    obligationId: value.obligationId as string,
    programId: value.programId as string,
    ownerAgentId: value.ownerAgentId as string,
    flowId: value.flowId as string,
    scheduledFor: value.scheduledFor as number,
    dueAt: value.dueAt as number,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
    catchUpPolicy: value.catchUpPolicy as RecoveryObligationV1["catchUpPolicy"],
    idempotencyKey: value.idempotencyKey as string,
    reason: value.reason as RecoveryObligationV1["reason"],
    status: value.status as RecoveryObligationStatus,
    proofRequirements,
    ...(isBoundedString(value.disposition) ? { disposition: value.disposition } : {}),
  };
  if (
    parsed.dueAt < parsed.scheduledFor ||
    parsed.updatedAt < parsed.createdAt ||
    parsed.obligationId !==
      obligationId({
        programId: parsed.programId,
        flowId: parsed.flowId,
        idempotencyKey: parsed.idempotencyKey,
      })
  ) {
    return undefined;
  }
  return parsed;
}

export function isValidRecoveryObligation(value: unknown): value is RecoveryObligationV1 {
  return parseRecoveryObligation(value) !== undefined;
}

function stateRecord(
  flow: Pick<TaskFlowRecord, "stateJson">,
): Record<string, JsonValue> | undefined {
  if (flow.stateJson === undefined) {
    return {};
  }
  return isRecord(flow.stateJson)
    ? (structuredClone(flow.stateJson) as Record<string, JsonValue>)
    : undefined;
}

export function listRecoveryObligations(
  flow: Pick<TaskFlowRecord, "stateJson">,
): RecoveryObligationV1[] {
  const state = stateRecord(flow);
  const raw = state?.[RECOVERY_OBLIGATIONS_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(parseRecoveryObligation)
    .filter((entry): entry is RecoveryObligationV1 => Boolean(entry))
    .toSorted(
      (left, right) =>
        left.createdAt - right.createdAt || left.obligationId.localeCompare(right.obligationId),
    );
}

export function createRecoveryObligation(input: {
  programId: string;
  ownerAgentId: string;
  flowId: string;
  scheduledFor: number;
  dueAt: number;
  catchUpPolicy: RecoveryObligationV1["catchUpPolicy"];
  idempotencyKey: string;
  reason: RecoveryObligationV1["reason"];
  proofRequirements: string[];
  now?: number;
  status?: RecoveryObligationStatus;
}): RecoveryObligationV1 {
  const now = input.now ?? Date.now();
  if (
    !isSafeTimestamp(input.scheduledFor) ||
    !isSafeTimestamp(input.dueAt) ||
    !isSafeTimestamp(now) ||
    input.dueAt < input.scheduledFor ||
    !isBoundedString(input.programId) ||
    !isBoundedString(input.ownerAgentId) ||
    !isBoundedString(input.flowId) ||
    !isBoundedString(input.idempotencyKey) ||
    !CATCH_UP_POLICIES.has(input.catchUpPolicy) ||
    !RECOVERY_REASONS.has(input.reason) ||
    (input.status !== undefined && !RECOVERY_STATUSES.has(input.status)) ||
    !Array.isArray(input.proofRequirements) ||
    input.proofRequirements.length > MAX_RECOVERY_PROOF_REQUIREMENTS ||
    input.proofRequirements.some((entry) => !isBoundedString(entry))
  ) {
    throw new Error("invalid_recovery_obligation_timing_or_identity");
  }
  return {
    version: 1,
    obligationId: obligationId({
      programId: input.programId,
      flowId: input.flowId,
      idempotencyKey: input.idempotencyKey,
    }),
    programId: input.programId,
    ownerAgentId: input.ownerAgentId,
    flowId: input.flowId,
    scheduledFor: input.scheduledFor,
    dueAt: input.dueAt,
    createdAt: now,
    updatedAt: now,
    catchUpPolicy: input.catchUpPolicy,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    status:
      input.status ??
      (input.catchUpPolicy === "manual"
        ? "approval_required"
        : input.catchUpPolicy === "skip"
          ? "skipped"
          : "pending"),
    proofRequirements: [...new Set(input.proofRequirements)].slice(
      0,
      MAX_RECOVERY_PROOF_REQUIREMENTS,
    ),
  };
}

export function withRecoveryObligation(
  flow: Pick<TaskFlowRecord, "stateJson">,
  obligation: RecoveryObligationV1,
): JsonValue | undefined {
  const validated = parseRecoveryObligation(obligation);
  if (!validated) {
    return undefined;
  }
  const state = stateRecord(flow);
  if (!state) {
    return undefined;
  }
  const obligations = listRecoveryObligations(flow);
  if (!obligations.some((entry) => entry.obligationId === validated.obligationId)) {
    obligations.push(structuredClone(validated));
  }
  state[RECOVERY_OBLIGATIONS_KEY] = obligations
    .toSorted((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_RECOVERY_OBLIGATIONS) as unknown as JsonValue;
  return state;
}

export function updateRecoveryObligationState(params: {
  flow: Pick<TaskFlowRecord, "stateJson">;
  obligationId: string;
  status: RecoveryObligationStatus;
  disposition?: string;
  now?: number;
}): JsonValue | undefined {
  const updatedAt = params.now ?? Date.now();
  if (
    !isSafeTimestamp(updatedAt) ||
    !RECOVERY_STATUSES.has(params.status) ||
    (params.disposition !== undefined && !isBoundedString(params.disposition))
  ) {
    return undefined;
  }
  const state = stateRecord(params.flow);
  if (!state) {
    return undefined;
  }
  const obligations = listRecoveryObligations(params.flow);
  const index = obligations.findIndex((entry) => entry.obligationId === params.obligationId);
  if (index < 0) {
    return undefined;
  }
  const obligation = obligations[index];
  if (updatedAt < obligation.createdAt) {
    return undefined;
  }
  if (isTerminalStatus(obligation.status) && obligation.status !== params.status) {
    return undefined;
  }
  obligations[index] = {
    ...obligation,
    status: params.status,
    updatedAt,
    ...(params.disposition ? { disposition: params.disposition } : {}),
  };
  state[RECOVERY_OBLIGATIONS_KEY] = obligations as unknown as JsonValue;
  return state;
}

export function persistRecoveryObligationState(params: {
  flowId: string;
  obligationId: string;
  status: RecoveryObligationStatus;
  disposition?: string;
  now?: number;
  maxAttempts?: number;
}): { applied: true; flow: TaskFlowRecord } | { applied: false; reason: string } {
  const updatedAt = params.now ?? Date.now();
  if (!isSafeTimestamp(updatedAt)) {
    return { applied: false, reason: "invalid_updated_at" };
  }
  const attempts = Math.max(1, Math.min(params.maxAttempts ?? 3, 5));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const flow = getTaskFlowById(params.flowId);
    if (!flow) {
      return { applied: false, reason: "flow_not_found" };
    }
    const stateJson = updateRecoveryObligationState({
      flow,
      obligationId: params.obligationId,
      status: params.status,
      disposition: params.disposition,
      now: updatedAt,
    });
    if (stateJson === undefined) {
      return { applied: false, reason: "obligation_not_found_or_invalid_state" };
    }
    const result = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: { stateJson, updatedAt },
    });
    if (result.applied) {
      return result;
    }
    if (result.reason !== "revision_conflict") {
      return { applied: false, reason: result.reason };
    }
  }
  return { applied: false, reason: "revision_conflict" };
}

/** Persists an obligation with optimistic concurrency before scheduled work is deferred. */
export function persistRecoveryObligation(params: {
  flowId: string;
  obligation: RecoveryObligationV1;
  maxAttempts?: number;
}): { applied: true; flow: TaskFlowRecord } | { applied: false; reason: string } {
  const attempts = Math.max(1, Math.min(params.maxAttempts ?? 3, 5));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const flow = getTaskFlowById(params.flowId);
    if (!flow) {
      return { applied: false, reason: "flow_not_found" };
    }
    const stateJson = withRecoveryObligation(flow, params.obligation);
    if (stateJson === undefined) {
      return { applied: false, reason: "flow_state_not_object" };
    }
    const result = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: { stateJson, updatedAt: params.obligation.updatedAt },
    });
    if (result.applied) {
      return result;
    }
    if (result.reason !== "revision_conflict") {
      return { applied: false, reason: result.reason };
    }
  }
  return { applied: false, reason: "revision_conflict" };
}

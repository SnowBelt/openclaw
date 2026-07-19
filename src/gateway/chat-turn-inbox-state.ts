// Durable server-owned Control UI turn inbox state and revision-safe mutations.
import crypto from "node:crypto";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { ChatTurnSummary } from "../../packages/gateway-protocol/src/index.js";
import {
  buildControlDirectorMissionEnvelope,
  parseControlDirectorMissionEnvelope,
  type ControlDirectorMissionEnvelope,
} from "../agents/control-director-contract.js";
import { emitControlDirectorJourneySignal } from "../self-improvement/control-director-journeys.js";
import type { JsonValue, TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import {
  createManagedTaskFlow,
  deleteTaskFlowRecordById,
  getTaskFlowById,
  listTaskFlowRecords,
  updateFlowRecordByIdExpectedRevision,
} from "../tasks/task-flow-runtime-internal.js";

export const CHAT_TURN_INBOX_CONTROLLER_ID = "openclaw/chat-turn-inbox-v1";
export const CHAT_TURN_MUTATION_HISTORY_LIMIT = 32;
export const CHAT_TURN_MAX_MESSAGE_CHARS = 2_000_000;
export const CHAT_TURN_MAX_ATTACHMENTS_JSON_CHARS = 12_000_000;
export const CHAT_TURN_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const CHAT_TURN_MAX_TERMINAL_PER_SESSION = 200;

export type ChatTurnMode = "queue" | "steer";
export type ChatTurnPhase =
  | "pending"
  | "dispatching"
  | "admitted"
  | "delivered"
  | "failed"
  | "cancelled";

export type ChatTurnInboxState = {
  schemaVersion: 1;
  kind: "chat_turn";
  turnId: string;
  idempotencyKey: string;
  sessionKey: string;
  agentId?: string;
  message: string;
  attachments: JsonValue[];
  mode: ChatTurnMode;
  phase: ChatTurnPhase;
  dispatchRunId: string;
  dispatchAttempts: number;
  modeUpdatedAt: number;
  operatorScopes: string[];
  ownerConnId?: string;
  ownerDeviceId?: string;
  mutationKeys: string[];
  mission?: ControlDirectorMissionEnvelope;
  activitySummary?: string;
  lastActivityAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
};

export type ChatTurnMutationResult =
  | { applied: true; flow: TaskFlowRecord; state: ChatTurnInboxState; duplicate?: boolean }
  | {
      applied: false;
      reason:
        | "not_found"
        | "not_owned"
        | "revision_conflict"
        | "persist_failed"
        | "closed"
        | "admission_closed";
      flow?: TaskFlowRecord;
      state?: ChatTurnInboxState;
    };

type ChatTurnFlowPatch = {
  status?: TaskFlowRecord["status"];
  currentStep?: string | null;
  endedAt?: number | null;
};

const CHAT_TURN_MODES = new Set<ChatTurnMode>(["queue", "steer"]);
const CHAT_TURN_PHASES = new Set<ChatTurnPhase>([
  "pending",
  "dispatching",
  "admitted",
  "delivered",
  "failed",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return null;
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function jsonArray(value: unknown): JsonValue[] | null {
  return Array.isArray(value) ? (structuredClone(value) as JsonValue[]) : null;
}

export function stateForChatTurn(flow: TaskFlowRecord): ChatTurnInboxState | null {
  if (flow.controllerId !== CHAT_TURN_INBOX_CONTROLLER_ID || !isRecord(flow.stateJson)) {
    return null;
  }
  const value = flow.stateJson;
  const attachments = jsonArray(value.attachments);
  const operatorScopes = stringArray(value.operatorScopes);
  const mutationKeys = stringArray(value.mutationKeys);
  const mission =
    value.mission === undefined ? undefined : parseControlDirectorMissionEnvelope(value.mission);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "chat_turn" ||
    typeof value.turnId !== "string" ||
    value.turnId !== flow.flowId ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.sessionKey !== "string" ||
    value.sessionKey !== flow.ownerKey ||
    typeof value.message !== "string" ||
    attachments === null ||
    !CHAT_TURN_MODES.has(value.mode as ChatTurnMode) ||
    !CHAT_TURN_PHASES.has(value.phase as ChatTurnPhase) ||
    typeof value.dispatchRunId !== "string" ||
    typeof value.dispatchAttempts !== "number" ||
    !Number.isSafeInteger(value.dispatchAttempts) ||
    value.dispatchAttempts < 0 ||
    typeof value.modeUpdatedAt !== "number" ||
    operatorScopes === null ||
    mutationKeys === null ||
    typeof value.lastActivityAt !== "number" ||
    !Number.isFinite(value.lastActivityAt) ||
    value.lastActivityAt < 0 ||
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number" ||
    (value.mission !== undefined && mission === null)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: "chat_turn",
    turnId: value.turnId,
    idempotencyKey: value.idempotencyKey,
    sessionKey: value.sessionKey,
    ...(typeof value.agentId === "string" && value.agentId.trim()
      ? { agentId: value.agentId.trim() }
      : {}),
    message: value.message,
    attachments,
    mode: value.mode as ChatTurnMode,
    phase: value.phase as ChatTurnPhase,
    dispatchRunId: value.dispatchRunId,
    dispatchAttempts: value.dispatchAttempts,
    modeUpdatedAt: value.modeUpdatedAt,
    operatorScopes,
    ...(typeof value.ownerConnId === "string" && value.ownerConnId.trim()
      ? { ownerConnId: value.ownerConnId.trim() }
      : {}),
    ...(typeof value.ownerDeviceId === "string" && value.ownerDeviceId.trim()
      ? { ownerDeviceId: value.ownerDeviceId.trim() }
      : {}),
    mutationKeys,
    ...(mission ? { mission } : {}),
    ...(typeof value.activitySummary === "string" && value.activitySummary.trim()
      ? { activitySummary: value.activitySummary.trim().slice(0, 500) }
      : {}),
    lastActivityAt: value.lastActivityAt,
    ...(typeof value.lastError === "string" && value.lastError.trim()
      ? { lastError: value.lastError.trim() }
      : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(typeof value.endedAt === "number" ? { endedAt: value.endedAt } : {}),
  };
}

export function isTerminalChatTurnPhase(phase: ChatTurnPhase): boolean {
  return phase === "delivered" || phase === "failed" || phase === "cancelled";
}

export function mapChatTurnSummary(flow: TaskFlowRecord): ChatTurnSummary | null {
  const state = stateForChatTurn(flow);
  if (!state) {
    return null;
  }
  return {
    id: flow.flowId,
    sessionKey: state.sessionKey,
    ...(state.agentId ? { agentId: state.agentId } : {}),
    revision: flow.revision,
    mode: state.mode,
    phase: state.phase,
    message: state.message,
    attachmentCount: state.attachments.length,
    admissionOpen: state.phase === "pending",
    runId: state.dispatchRunId,
    ...(state.mission
      ? {
          missionId: state.mission.missionId,
          responseMode: state.mission.responseMode,
          requestHash: state.mission.requestHash,
        }
      : {}),
    ...(state.activitySummary ? { activitySummary: state.activitySummary } : {}),
    lastActivityAt: state.lastActivityAt,
    ...(state.lastError ? { lastError: state.lastError } : {}),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    ...(state.endedAt !== undefined ? { endedAt: state.endedAt } : {}),
  };
}

function asJsonValue(value: ChatTurnInboxState): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function normalizeScopes(scopes: readonly string[] | undefined): string[] {
  return [...new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean))].slice(0, 16);
}

function normalizeAttachments(attachments: readonly unknown[] | undefined): JsonValue[] {
  if (!attachments?.length) {
    return [];
  }
  const serialized = JSON.stringify(attachments);
  if (serialized.length > CHAT_TURN_MAX_ATTACHMENTS_JSON_CHARS) {
    throw new Error("Queued attachments exceed the durable inbox size limit.");
  }
  return JSON.parse(serialized) as JsonValue[];
}

export function listChatTurnFlows(params: {
  sessionKey: string;
  includeTerminal?: boolean;
}): TaskFlowRecord[] {
  const sessionKey = params.sessionKey.trim();
  return listTaskFlowRecords()
    .filter((flow) => {
      const state = stateForChatTurn(flow);
      return (
        state?.sessionKey === sessionKey &&
        (params.includeTerminal === true || !isTerminalChatTurnPhase(state.phase))
      );
    })
    .toSorted((left, right) => left.createdAt - right.createdAt);
}

/** Bound terminal inbox history without ever pruning an active or pending turn. */
export function pruneTerminalChatTurnFlows(
  params: {
    now?: number;
    retentionMs?: number;
    maxTerminalPerSession?: number;
  } = {},
): number {
  const now = params.now ?? Date.now();
  const retentionMs = Math.max(0, params.retentionMs ?? CHAT_TURN_TERMINAL_RETENTION_MS);
  const maxTerminal = Math.max(
    0,
    Math.floor(params.maxTerminalPerSession ?? CHAT_TURN_MAX_TERMINAL_PER_SESSION),
  );
  const bySession = new Map<string, Array<{ flow: TaskFlowRecord; state: ChatTurnInboxState }>>();
  for (const flow of listTaskFlowRecords()) {
    const state = stateForChatTurn(flow);
    if (!state || !isTerminalChatTurnPhase(state.phase)) {
      continue;
    }
    const group = bySession.get(state.sessionKey) ?? [];
    group.push({ flow, state });
    bySession.set(state.sessionKey, group);
  }
  const deleteIds = new Set<string>();
  for (const entries of bySession.values()) {
    const newestFirst = entries.toSorted(
      (left, right) => right.state.updatedAt - left.state.updatedAt,
    );
    newestFirst.forEach((entry, index) => {
      if (now - entry.state.updatedAt > retentionMs || index >= maxTerminal) {
        deleteIds.add(entry.flow.flowId);
      }
    });
  }
  let deleted = 0;
  for (const flowId of deleteIds) {
    if (deleteTaskFlowRecordById(flowId)) {
      deleted += 1;
    }
  }
  return deleted;
}

export function findChatTurnByIdempotency(params: {
  sessionKey: string;
  idempotencyKey: string;
}): TaskFlowRecord | null {
  const idempotencyKey = params.idempotencyKey.trim();
  return (
    listTaskFlowRecords().find((flow) => {
      const state = stateForChatTurn(flow);
      return (
        state?.sessionKey === params.sessionKey.trim() && state.idempotencyKey === idempotencyKey
      );
    }) ?? null
  );
}

export function createChatTurnFlow(params: {
  sessionKey: string;
  agentId?: string;
  message: string;
  attachments?: readonly unknown[];
  mode: ChatTurnMode;
  idempotencyKey: string;
  operatorScopes?: readonly string[];
  ownerConnId?: string;
  ownerDeviceId?: string;
  preserveControlDirectorMission?: boolean;
  now?: number;
}): TaskFlowRecord | null {
  // Keep retention on the same clock as creation. Production callers normally
  // use wall time, while deterministic recovery/tests can provide a clock.
  pruneTerminalChatTurnFlows({ now: params.now });
  const sessionKey = params.sessionKey.trim();
  const idempotencyKey = params.idempotencyKey.trim();
  if (!sessionKey || !idempotencyKey) {
    throw new Error("sessionKey and idempotencyKey are required.");
  }
  if (params.message.length > CHAT_TURN_MAX_MESSAGE_CHARS) {
    throw new Error("Queued message exceeds the durable inbox size limit.");
  }
  const attachments = normalizeAttachments(params.attachments);
  if (!params.message.trim() && attachments.length === 0) {
    throw new Error("Queued turn requires a message or attachment.");
  }
  const existing = findChatTurnByIdempotency({ sessionKey, idempotencyKey });
  if (existing) {
    return existing;
  }
  const now = params.now ?? Date.now();
  const flow = createManagedTaskFlow({
    ownerKey: sessionKey,
    controllerId: CHAT_TURN_INBOX_CONTROLLER_ID,
    requesterOrigin: { channel: "webchat", to: sessionKey },
    status: "queued",
    notifyPolicy: "silent",
    goal: params.message.trim() || `Queued attachment (${attachments.length})`,
    currentStep: params.mode === "steer" ? "Steer pending admission." : "Turn queued.",
    createdAt: now,
    updatedAt: now,
  });
  if (!flow) {
    return null;
  }
  const state: ChatTurnInboxState = {
    schemaVersion: 1,
    kind: "chat_turn",
    turnId: flow.flowId,
    idempotencyKey,
    sessionKey,
    ...(normalizeOptionalString(params.agentId) ? { agentId: params.agentId!.trim() } : {}),
    message: params.message,
    attachments,
    mode: params.mode,
    phase: "pending",
    dispatchRunId: crypto.randomUUID(),
    dispatchAttempts: 0,
    modeUpdatedAt: now,
    operatorScopes: normalizeScopes(params.operatorScopes),
    ...(normalizeOptionalString(params.ownerConnId)
      ? { ownerConnId: params.ownerConnId!.trim() }
      : {}),
    ...(normalizeOptionalString(params.ownerDeviceId)
      ? { ownerDeviceId: params.ownerDeviceId!.trim() }
      : {}),
    mutationKeys: [],
    ...(params.preserveControlDirectorMission
      ? {
          mission: buildControlDirectorMissionEnvelope({
            missionId: `control-director:${flow.flowId}`,
            idempotencyKey,
            requestBody: params.message,
            provenance: ["gateway.chat.turns.create"],
            artifactIds: [flow.flowId],
          }),
        }
      : {}),
    activitySummary: params.mode === "steer" ? "Steer acknowledged." : "Message acknowledged.",
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const initialized = updateFlowRecordByIdExpectedRevision({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
    patch: { stateJson: asJsonValue(state) },
  });
  return initialized.applied ? initialized.flow : null;
}

function appendMutationKey(state: ChatTurnInboxState, idempotencyKey: string): string[] {
  return [...state.mutationKeys, idempotencyKey].slice(-CHAT_TURN_MUTATION_HISTORY_LIMIT);
}

export function mutateChatTurnFlow(params: {
  turnId: string;
  sessionKey: string;
  expectedRevision: number;
  idempotencyKey: string;
  mutate: (state: ChatTurnInboxState, now: number) => ChatTurnInboxState | null;
  patch?: (state: ChatTurnInboxState) => ChatTurnFlowPatch;
  /** Queue/steer mode changes close at admission; cancel/retry use their own phase contract. */
  requireAdmissionOpen?: boolean;
  now?: number;
}): ChatTurnMutationResult {
  const flow = getTaskFlowById(params.turnId);
  if (!flow) {
    return { applied: false, reason: "not_found" };
  }
  const state = stateForChatTurn(flow);
  if (!state || state.sessionKey !== params.sessionKey.trim()) {
    return { applied: false, reason: "not_owned" };
  }
  const mutationKey = params.idempotencyKey.trim();
  if (state.mutationKeys.includes(mutationKey)) {
    return { applied: true, flow, state, duplicate: true };
  }
  if (params.requireAdmissionOpen === true && state.phase !== "pending") {
    return { applied: false, reason: "admission_closed", flow, state };
  }
  if (flow.revision !== params.expectedRevision) {
    emitControlDirectorJourneySignal({
      code: "queue_race",
      idempotencyKey: `${params.turnId}:${params.idempotencyKey}`,
      summary: "A queue or steer mutation used a stale server revision.",
      observed: `Expected revision ${params.expectedRevision}; current revision ${flow.revision}.`,
      runId: state.dispatchRunId,
      evidenceRefs: [`turn:${params.turnId}`],
    });
    return { applied: false, reason: "revision_conflict", flow, state };
  }
  const now = params.now ?? Date.now();
  const mutated = params.mutate(structuredClone(state), now);
  if (!mutated) {
    return { applied: false, reason: "closed", flow, state };
  }
  const next: ChatTurnInboxState = {
    ...mutated,
    mutationKeys: appendMutationKey(mutated, mutationKey),
    updatedAt: now,
  };
  const flowPatch = params.patch?.(next) ?? {};
  const result = updateFlowRecordByIdExpectedRevision({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
    patch: {
      ...flowPatch,
      stateJson: asJsonValue(next),
      updatedAt: now,
    },
  });
  if (!result.applied) {
    return {
      applied: false,
      reason: result.reason,
      ...(result.current ? { flow: result.current } : {}),
      ...(result.current && stateForChatTurn(result.current)
        ? { state: stateForChatTurn(result.current)! }
        : {}),
    };
  }
  return { applied: true, flow: result.flow, state: next };
}

export function updateChatTurnControllerState(params: {
  flowId: string;
  mutate: (state: ChatTurnInboxState, now: number) => ChatTurnInboxState | null;
  patch?: (state: ChatTurnInboxState) => ChatTurnFlowPatch;
  now?: number;
}): ChatTurnMutationResult {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const flow = getTaskFlowById(params.flowId);
    if (!flow) {
      return { applied: false, reason: "not_found" };
    }
    const state = stateForChatTurn(flow);
    if (!state) {
      return { applied: false, reason: "not_owned" };
    }
    const now = params.now ?? Date.now();
    const next = params.mutate(structuredClone(state), now);
    if (!next) {
      return { applied: false, reason: "closed", flow, state };
    }
    const result = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: {
        ...(params.patch?.(next) ?? {}),
        stateJson: asJsonValue({ ...next, updatedAt: now }),
        updatedAt: now,
      },
    });
    if (result.applied) {
      return { applied: true, flow: result.flow, state: { ...next, updatedAt: now } };
    }
    if (result.reason !== "revision_conflict") {
      return {
        applied: false,
        reason: result.reason,
        ...(result.current ? { flow: result.current } : {}),
      };
    }
  }
  const latest = getTaskFlowById(params.flowId);
  emitControlDirectorJourneySignal({
    code: "queue_race",
    idempotencyKey: `${params.flowId}:controller-retry-exhausted`,
    summary: "Chat turn controller exhausted revision-safe mutation retries.",
    observed: "Eight consecutive state revisions prevented the controller mutation.",
    evidenceRefs: [`turn:${params.flowId}`],
  });
  return {
    applied: false,
    reason: "revision_conflict",
    ...(latest ? { flow: latest } : {}),
    ...(latest && stateForChatTurn(latest) ? { state: stateForChatTurn(latest)! } : {}),
  };
}

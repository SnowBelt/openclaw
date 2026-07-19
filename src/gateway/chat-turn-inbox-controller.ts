// Reconciles durable Control UI turns into chat.send without blocking the socket client.
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { CONTROL_DIRECTOR_ACTIVITY_WATCHDOG_SLACK_MS } from "../agents/control-director-activity-watchdog.js";
import { CONTROL_DIRECTOR_UX_SLOS } from "../agents/control-director-slos.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { emitControlDirectorJourneySignal } from "../self-improvement/control-director-journeys.js";
import { getTaskFlowById, listTaskFlowRecords } from "../tasks/task-flow-runtime-internal.js";
import {
  CHAT_TURN_INBOX_CONTROLLER_ID,
  isTerminalChatTurnPhase,
  pruneTerminalChatTurnFlows,
  stateForChatTurn,
  updateChatTurnControllerState,
  type ChatTurnInboxState,
} from "./chat-turn-inbox-state.js";
import { hasTrackedActiveSessionRun } from "./server-methods/session-active-runs.js";
import type { GatewayClient, GatewayRequestContext, RespondFn } from "./server-methods/types.js";

const log = createSubsystemLogger("gateway/chat-turn-inbox");
const MODE_CHANGE_GRACE_MS = 350;
const ACTIVE_RECHECK_MS = 500;
const TERMINAL_RECHECK_MS = 750;
const LOST_ADMISSION_RETRY_MS = 5_000;

type ChatSendAck = {
  runId?: string;
  status?: "started" | "in_flight" | "ok" | "timeout" | "error";
  summary?: string;
};

type InvocationResult = {
  ok: boolean;
  payload?: unknown;
  errorMessage?: string;
};

export type ChatTurnInboxControllerTestHooks = {
  invokeMethod?: (params: {
    method: "chat.send" | "chat.abort";
    state: ChatTurnInboxState;
    payload: Record<string, unknown>;
  }) => Promise<InvocationResult>;
  hasActiveRun?: (state: ChatTurnInboxState) => boolean;
};

let runtimeContext: GatewayRequestContext | null = null;
let testHooks: ChatTurnInboxControllerTestHooks | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();

function payloadAck(value: unknown): ChatSendAck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
    ...(record.status === "started" ||
    record.status === "in_flight" ||
    record.status === "ok" ||
    record.status === "timeout" ||
    record.status === "error"
      ? { status: record.status }
      : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
  };
}

function syntheticClient(state: ChatTurnInboxState): GatewayClient {
  return {
    connId: `chat-turn:${state.turnId}`,
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: {
        id: "openclaw-control-ui",
        version: "server-inbox-v1",
        platform: "gateway",
        mode: "ui",
      },
      role: "operator",
      scopes: state.operatorScopes.length > 0 ? state.operatorScopes : ["operator.write"],
    },
  };
}

function terminalDedupeResult(
  context: GatewayRequestContext,
  state: ChatTurnInboxState,
): { ok: boolean; summary?: string } | null {
  const entry = context.dedupe.get(`chat:${state.dispatchRunId}`);
  if (!entry) {
    return null;
  }
  const ack = payloadAck(entry.payload);
  return {
    ok: entry.ok && ack?.status !== "error" && ack?.status !== "timeout",
    ...(ack?.summary
      ? { summary: ack.summary }
      : entry.error?.message
        ? { summary: entry.error.message }
        : {}),
  };
}

function sessionHasActiveRun(context: GatewayRequestContext, state: ChatTurnInboxState): boolean {
  if (testHooks?.hasActiveRun) {
    return testHooks.hasActiveRun(state);
  }
  return hasTrackedActiveSessionRun({
    context,
    requestedKey: state.sessionKey,
    canonicalKey: state.sessionKey,
    ...(state.agentId ? { agentId: state.agentId } : {}),
    defaultAgentId: resolveDefaultAgentId(context.getRuntimeConfig()),
  });
}

function schedule(flowId: string, delayMs: number): void {
  if (!runtimeContext) {
    return;
  }
  const previous = timers.get(flowId);
  if (previous) {
    clearTimeout(previous);
  }
  const timer = setTimeout(() => {
    timers.delete(flowId);
    kickChatTurnInboxController(flowId);
  }, delayMs);
  timer.unref?.();
  timers.set(flowId, timer);
}

async function invokeChatMethod(params: {
  method: "chat.send" | "chat.abort";
  state: ChatTurnInboxState;
  payload: Record<string, unknown>;
}): Promise<InvocationResult> {
  if (testHooks?.invokeMethod) {
    return await testHooks.invokeMethod(params);
  }
  const context = runtimeContext;
  if (!context) {
    return { ok: false, errorMessage: "Gateway chat-turn runtime is stopped." };
  }
  const { chatHandlers } = await import("./server-methods/chat.js");
  const handler = chatHandlers[params.method];
  if (!handler) {
    return { ok: false, errorMessage: `Gateway method unavailable: ${params.method}` };
  }
  let response: InvocationResult | null = null;
  const respond: RespondFn = (ok, payload, error) => {
    response ??= {
      ok,
      ...(payload !== undefined ? { payload } : {}),
      ...(error?.message ? { errorMessage: error.message } : {}),
    };
  };
  await handler({
    req: {
      type: "req",
      id: `chat-turn:${params.state.turnId}:${params.method}`,
      method: params.method,
      params: params.payload,
    },
    params: params.payload,
    client: syntheticClient(params.state),
    isWebchatConnect: () => true,
    respond,
    context,
  });
  return response ?? { ok: false, errorMessage: `${params.method} returned no acknowledgement.` };
}

function finishTurn(flowId: string, terminal: { ok: boolean; summary?: string }): void {
  const now = Date.now();
  updateChatTurnControllerState({
    flowId,
    now,
    mutate: (state) => ({
      ...state,
      phase: terminal.ok ? "delivered" : "failed",
      activitySummary: terminal.ok ? "Response delivered." : "Response failed.",
      lastActivityAt: now,
      ...(terminal.ok
        ? { lastError: undefined }
        : { lastError: terminal.summary ?? "Chat turn failed." }),
      endedAt: now,
    }),
    patch: (state) => ({
      status: state.phase === "delivered" ? "succeeded" : "failed",
      currentStep:
        state.phase === "delivered"
          ? "Turn reached terminal chat delivery."
          : (state.lastError ?? "Turn failed."),
      endedAt: now,
    }),
  });
}

async function dispatchTurn(flowId: string): Promise<void> {
  const context = runtimeContext;
  if (!context) {
    return;
  }
  const claimed = updateChatTurnControllerState({
    flowId,
    mutate: (current, now) => {
      if (
        current.phase !== "pending" &&
        current.phase !== "dispatching" &&
        current.phase !== "admitted"
      ) {
        return null;
      }
      return {
        ...current,
        phase: "dispatching",
        dispatchAttempts: current.dispatchAttempts + 1,
        activitySummary: "Admitting message to the assistant.",
        lastActivityAt: now,
        lastError: undefined,
      };
    },
    patch: () => ({ status: "running", currentStep: "Admitting turn to chat runtime." }),
  });
  if (!claimed.applied) {
    schedule(flowId, ACTIVE_RECHECK_MS);
    return;
  }
  const dispatchState = claimed.state;
  const response = await invokeChatMethod({
    method: "chat.send",
    state: dispatchState,
    payload: {
      sessionKey: dispatchState.sessionKey,
      ...(dispatchState.agentId ? { agentId: dispatchState.agentId } : {}),
      message: dispatchState.message,
      ...(dispatchState.attachments.length > 0 ? { attachments: dispatchState.attachments } : {}),
      flowId: dispatchState.turnId,
      turnMode: dispatchState.mode,
      idempotencyKey: dispatchState.dispatchRunId,
    },
  });
  const ack = payloadAck(response.payload);
  if (!response.ok || ack?.status === "error" || ack?.status === "timeout") {
    finishTurn(flowId, {
      ok: false,
      summary: ack?.summary ?? response.errorMessage ?? "Chat admission failed.",
    });
    return;
  }
  if (ack?.status === "ok") {
    finishTurn(flowId, { ok: true });
    return;
  }
  updateChatTurnControllerState({
    flowId,
    mutate: (current, now) =>
      current.phase === "dispatching"
        ? {
            ...current,
            phase: "admitted",
            activitySummary: "The assistant is working on the response.",
            lastActivityAt: now,
          }
        : null,
    patch: () => ({ status: "waiting", currentStep: "Turn admitted; waiting for delivery." }),
  });
  const terminal = terminalDedupeResult(context, dispatchState);
  if (terminal) {
    finishTurn(flowId, terminal);
    return;
  }
  schedule(flowId, TERMINAL_RECHECK_MS);
}

async function reconcileFlow(flowId: string): Promise<void> {
  const context = runtimeContext;
  if (!context) {
    return;
  }
  const flow = getTaskFlowById(flowId);
  const state = flow ? stateForChatTurn(flow) : null;
  if (!flow || !state || isTerminalChatTurnPhase(state.phase)) {
    return;
  }
  const terminal = terminalDedupeResult(context, state);
  if (terminal) {
    finishTurn(flowId, terminal);
    return;
  }
  if (state.phase === "pending") {
    const active = sessionHasActiveRun(context, state);
    if (state.mode === "queue" && active) {
      schedule(flowId, ACTIVE_RECHECK_MS);
      return;
    }
    if (state.mode === "steer" && Date.now() - state.modeUpdatedAt < MODE_CHANGE_GRACE_MS) {
      schedule(flowId, MODE_CHANGE_GRACE_MS);
      return;
    }
    await dispatchTurn(flowId);
    return;
  }
  const stillOwnedByRuntime =
    context.chatAbortControllers.has(state.dispatchRunId) ||
    context.chatQueuedTurns.has(state.dispatchRunId);
  if (stillOwnedByRuntime) {
    const now = Date.now();
    const observedGapMs = now - state.lastActivityAt;
    if (
      observedGapMs >
      CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs + CONTROL_DIRECTOR_ACTIVITY_WATCHDOG_SLACK_MS
    ) {
      emitControlDirectorJourneySignal({
        code: "activity_gap",
        idempotencyKey: `${state.turnId}:${state.lastActivityAt}`,
        summary: "A server-owned Control Director turn missed its visible activity SLO.",
        observed: `No canonical turn activity was persisted for ${observedGapMs}ms.`,
        runId: state.dispatchRunId,
        evidenceRefs: [`turn:${state.turnId}`, `session:${state.sessionKey}`],
        sloMs: CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs,
      });
    }
    if (observedGapMs >= CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs) {
      updateChatTurnControllerState({
        flowId,
        now,
        mutate: (current) =>
          current.phase === "admitted"
            ? {
                ...current,
                activitySummary: "Still working; the response run is active.",
                lastActivityAt: now,
              }
            : null,
        patch: () => ({
          status: "waiting",
          currentStep: "Still working; the admitted chat run remains active.",
        }),
      });
    }
    schedule(flowId, TERMINAL_RECHECK_MS);
    return;
  }
  if (Date.now() - state.updatedAt < LOST_ADMISSION_RETRY_MS) {
    schedule(flowId, TERMINAL_RECHECK_MS);
    return;
  }
  // Restart recovery retries the same chat idempotency key. chat.send either
  // replays the terminal result or safely resumes one missing admission.
  await dispatchTurn(flowId);
}

export function kickChatTurnInboxController(flowId: string): void {
  if (!runtimeContext) {
    return;
  }
  const existing = running.get(flowId);
  if (existing) {
    return;
  }
  const run = reconcileFlow(flowId)
    .catch((error: unknown) => {
      log.warn("chat turn reconciliation failed", { flowId, error });
      schedule(flowId, ACTIVE_RECHECK_MS);
    })
    .finally(() => {
      if (running.get(flowId) === run) {
        running.delete(flowId);
      }
    });
  running.set(flowId, run);
}

export function startChatTurnInboxController(context: GatewayRequestContext): void {
  runtimeContext = context;
  pruneTerminalChatTurnFlows();
  for (const flow of listTaskFlowRecords()) {
    if (flow.controllerId === CHAT_TURN_INBOX_CONTROLLER_ID) {
      kickChatTurnInboxController(flow.flowId);
    }
  }
}

export async function stopChatTurnInboxController(): Promise<void> {
  runtimeContext = null;
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
  await Promise.allSettled([...running.values()]);
  running.clear();
  testHooks = null;
}

export function setChatTurnInboxControllerTestHooks(
  hooks: ChatTurnInboxControllerTestHooks | null,
): void {
  testHooks = hooks;
}

export async function abortChatTurnSubmission(state: ChatTurnInboxState): Promise<void> {
  if (state.dispatchAttempts === 0) {
    return;
  }
  const response = await invokeChatMethod({
    method: "chat.abort",
    state,
    payload: {
      sessionKey: state.sessionKey,
      ...(state.agentId ? { agentId: state.agentId } : {}),
      runId: state.dispatchRunId,
    },
  });
  if (!response.ok) {
    log.warn("chat turn abort was not acknowledged", {
      flowId: state.turnId,
      error: response.errorMessage,
    });
  }
}

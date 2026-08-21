// Lease-driven durable controller for Control UI Pursue Goal flows.
import crypto from "node:crypto";
import { buildControlDirectorJudgeClaimHash } from "../agents/control-director-contract.js";
import { verifyControlDirectorDiagnosticEvidence } from "../agents/control-director-diagnostic-evidence.js";
import { JUDGE_EVIDENCE_MAX_CHARS } from "../agents/judge-contract.js";
import { verifyJudgeReceipt } from "../agents/judge-receipt-signer.js";
import { requestHeartbeat } from "../infra/heartbeat-wake.js";
import {
  enqueueSystemEvent,
  hasQueuedSystemEventContext,
  registerSystemEventConsumptionListener,
  type SystemEvent,
} from "../infra/system-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { emitControlDirectorJourneySignal } from "../self-improvement/control-director-journeys.js";
import { evaluateControlDirectorSelfHealing } from "../self-improvement/control-director-self-healing.js";
import {
  appendDurableWorkerMailboxMessage,
  createDurableWorkerMailboxMessage,
} from "./durable-worker-mailbox.js";
import {
  nextPursueGoalBlockerCount,
  PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS,
} from "./pursue-goal-blocker.js";
import {
  isPursueGoalLeaseCurrent,
  PURSUE_GOAL_CONTROLLER_ID,
  PURSUE_GOAL_MAX_CHARS,
  PURSUE_GOAL_PENDING_TURN_TEXT_MAX_CHARS,
  stateForPursueGoalFlow,
  withPursueGoalEvent,
  type PursueGoalControllerState,
  type PursueGoalJudgeReceipt,
  type PursueGoalPendingTurnResult,
} from "./pursue-goal-controller-state.js";
import { completeTaskRunByRunId, failTaskRunByRunId, runTaskInFlow } from "./task-executor.js";
import type { JsonValue, TaskFlowRecord } from "./task-flow-registry.types.js";
import {
  getTaskFlowById,
  listTaskFlowRecordsPage,
  updateFlowRecordByIdExpectedRevision,
} from "./task-flow-runtime-internal.js";

const log = createSubsystemLogger("tasks/pursue-goal-controller");

export const PURSUE_GOAL_LEASE_MS = 45_000;
export const PURSUE_GOAL_HEARTBEAT_MS = 10_000;
export const PURSUE_GOAL_RECONCILE_MS = 15_000;
export const PURSUE_GOAL_MAX_TURNS_PER_ACTIVATION = 8;
const PURSUE_GOAL_MAX_MUTATION_RETRIES = 8;
const PURSUE_GOAL_MAX_FAILURES = 3;
const PURSUE_GOAL_RETRY_BASE_MS = 1_000;
const RESULT_SUMMARY_MAX_CHARS = 8_000;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;

export type PursueGoalTurnInput = {
  flowId: string;
  goal: string;
  state: PursueGoalControllerState;
  runId: string;
  abortSignal: AbortSignal;
  reserveJudgeExecution?: (attempt: { claimHash: string; promptHash: string }) => boolean;
};

export type PursueGoalTurnResult = {
  status: "active" | "complete" | "blocked" | "paused";
  text: string;
  blocker?: string;
  provisionalBlocker?: string;
  evidenceSummary?: string;
  artifactIds?: string[];
  judgeReceipt?: PursueGoalJudgeReceipt;
  model?: string;
};

export type PursueGoalControllerRuntime = {
  runTurn: (input: PursueGoalTurnInput) => Promise<PursueGoalTurnResult>;
  pauseWorkerGoal: (state: PursueGoalControllerState) => Promise<void>;
  resumeWorkerGoal: (state: PursueGoalControllerState) => Promise<void>;
  stopWorkerGoal: (state: PursueGoalControllerState) => Promise<void>;
  editWorkerGoal: (state: PursueGoalControllerState, goal: string) => Promise<void>;
};

export type PursueGoalMutationResult = {
  found: boolean;
  applied: boolean;
  reason?: string;
  flow?: TaskFlowRecord;
};

type ActiveController = {
  leaseId: string;
  abortController: AbortController;
  promise: Promise<void>;
};

type StateMutation = {
  state: PursueGoalControllerState;
  patch?: Omit<Parameters<typeof updateFlowRecordByIdExpectedRevision>[0]["patch"], "stateJson">;
};

const controllerOwnerId = `gateway:${process.pid}:${crypto.randomUUID()}`;
const activeControllers = new Map<string, ActiveController>();
let configuredRuntime: PursueGoalControllerRuntime | undefined;
let defaultRuntimePromise: Promise<PursueGoalControllerRuntime> | undefined;
let reconcileTimer: ReturnType<typeof setInterval> | undefined;
let stopTerminalConsumptionObserver: (() => void) | undefined;
let controllersStopping = false;
let judgeReceiptVerifier: (receipt: PursueGoalJudgeReceipt) => boolean = (receipt) =>
  verifyJudgeReceipt(receipt);

function toJsonValue(value: unknown): JsonValue {
  return structuredClone(value) as JsonValue;
}

function boundedSummary(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, RESULT_SUMMARY_MAX_CHARS);
}

function boundedEvidenceSummary(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, JUDGE_EVIDENCE_MAX_CHARS) : undefined;
}

function pendingTurnResult(result: PursueGoalTurnResult): PursueGoalPendingTurnResult | undefined {
  if (result.text.length > PURSUE_GOAL_PENDING_TURN_TEXT_MAX_CHARS) {
    return undefined;
  }
  return {
    status: result.status,
    text: result.text,
    ...(result.blocker ? { blocker: result.blocker } : {}),
    ...(result.provisionalBlocker ? { provisionalBlocker: result.provisionalBlocker } : {}),
    ...(result.evidenceSummary ? { evidenceSummary: result.evidenceSummary } : {}),
    ...(result.artifactIds ? { artifactIds: [...result.artifactIds] } : {}),
    ...(result.judgeReceipt ? { judgeReceipt: structuredClone(result.judgeReceipt) } : {}),
    ...(result.model ? { model: result.model } : {}),
  };
}

/**
 * V2 approval receipts carry provider-observed proof, not just a signature.
 * Keep V1 readable, but never let a V2 receipt approve with an unknown route,
 * a second request, or any model-visible tool.
 */
function judgeReceiptEvidenceSemanticallyValid(receipt: PursueGoalJudgeReceipt): boolean {
  if (receipt.schemaVersion !== 2) {
    return false;
  }
  if (
    receipt.modelVisibleTools.length !== 0 ||
    !SHA256_HEX_RE.test(receipt.claimHash) ||
    !SHA256_HEX_RE.test(receipt.promptHash) ||
    !SHA256_HEX_RE.test(receipt.responseHash)
  ) {
    return false;
  }
  if (receipt.requestCount === 0) {
    return receipt.route === "unknown" && receipt.model === "none" && receipt.verdict !== "APPROVE";
  }
  return (
    receipt.requestCount === 1 &&
    (receipt.route === "local" || receipt.route === "hosted") &&
    Boolean(receipt.model?.trim())
  );
}

function judgeReceiptApprovalSemanticallyValid(receipt: PursueGoalJudgeReceipt): boolean {
  return (
    receipt.verdict === "APPROVE" &&
    receipt.schemaVersion === 2 &&
    receipt.requestCount === 1 &&
    judgeReceiptEvidenceSemanticallyValid(receipt)
  );
}

function assignmentMailboxId(runId: string): string {
  return `assignment:${runId}`;
}

function isTerminalPhase(state: PursueGoalControllerState): boolean {
  return state.phase === "succeeded" || state.phase === "failed" || state.phase === "cancelled";
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    ((error as { name?: unknown }).name === "AbortError" ||
      (error as { code?: unknown }).code === "ABORT_ERR"),
  );
}

async function getControllerRuntime(): Promise<PursueGoalControllerRuntime> {
  if (configuredRuntime) {
    return configuredRuntime;
  }
  defaultRuntimePromise ??= import("./pursue-goal-controller.runtime.js").then(
    (module) => module.defaultPursueGoalControllerRuntime,
  );
  return await defaultRuntimePromise;
}

function mutatePursueGoalFlow(
  flowId: string,
  mutate: (flow: TaskFlowRecord, state: PursueGoalControllerState) => StateMutation | undefined,
): PursueGoalMutationResult {
  for (let attempt = 0; attempt < PURSUE_GOAL_MAX_MUTATION_RETRIES; attempt += 1) {
    const flow = getTaskFlowById(flowId);
    if (!flow) {
      return { found: false, applied: false, reason: "Flow not found." };
    }
    const state = stateForPursueGoalFlow(flow);
    if (!state) {
      return {
        found: true,
        applied: false,
        reason: "Flow is not owned by the Pursue Goal controller.",
        flow,
      };
    }
    const mutation = mutate(flow, state);
    if (!mutation) {
      return { found: true, applied: false, reason: "No state change is allowed.", flow };
    }
    const updated = updateFlowRecordByIdExpectedRevision({
      flowId,
      expectedRevision: flow.revision,
      patch: {
        ...mutation.patch,
        stateJson: toJsonValue(mutation.state),
      },
    });
    if (updated.applied) {
      return { found: true, applied: true, flow: updated.flow };
    }
    if (updated.reason !== "revision_conflict") {
      return {
        found: true,
        applied: false,
        reason:
          updated.reason === "persist_failed"
            ? "Flow persistence failed."
            : "Flow disappeared during mutation.",
        ...(updated.current ? { flow: updated.current } : {}),
      };
    }
  }
  return {
    found: true,
    applied: false,
    reason: "Flow changed repeatedly; retry the operation.",
    ...(getTaskFlowById(flowId) ? { flow: getTaskFlowById(flowId)! } : {}),
  };
}

function acquireLease(
  flowId: string,
): { flow: TaskFlowRecord; state: PursueGoalControllerState } | null {
  const now = Date.now();
  const leaseId = crypto.randomUUID();
  const result = mutatePursueGoalFlow(flowId, (flow, state) => {
    if (
      controllersStopping ||
      isTerminalPhase(state) ||
      state.phase === "paused" ||
      state.phase === "blocked" ||
      flow.cancelRequestedAt !== undefined
    ) {
      return undefined;
    }
    if (state.retryAt !== undefined && state.retryAt > now) {
      return undefined;
    }
    if (state.lease && state.lease.expiresAt > now && state.lease.ownerId !== controllerOwnerId) {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...state,
      phase: "running",
      activationCount: state.activationCount + 1,
      retryAt: undefined,
      lastError: undefined,
      lease: {
        ownerId: controllerOwnerId,
        leaseId,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + PURSUE_GOAL_LEASE_MS,
      },
      nextAction: state.nextAction ?? "Run the next worker turn.",
    };
    next = withPursueGoalEvent(next, {
      flowId,
      category: "run",
      name: "run.started",
      actorId: controllerOwnerId,
      summary: "Pursue Goal controller acquired a live execution lease.",
      correlation: { idempotencyKey: state.idempotencyKey },
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "running",
        currentStep: "Controller lease active; running the next delegated worker turn.",
        blockedTaskId: null,
        blockedSummary: null,
        waitJson: null,
        endedAt: null,
        updatedAt: now,
      },
    };
  });
  if (!result.applied || !result.flow) {
    return null;
  }
  const state = stateForPursueGoalFlow(result.flow);
  return state?.lease?.leaseId === leaseId ? { flow: result.flow, state } : null;
}

function heartbeatLease(flowId: string, leaseId: string): boolean {
  const now = Date.now();
  const result = mutatePursueGoalFlow(flowId, (_flow, state) => {
    if (!isPursueGoalLeaseCurrent(state, { ownerId: controllerOwnerId, leaseId, now })) {
      return undefined;
    }
    return {
      state: {
        ...state,
        lease: {
          ...state.lease!,
          heartbeatAt: now,
          expiresAt: now + PURSUE_GOAL_LEASE_MS,
        },
      },
      patch: { updatedAt: now },
    };
  });
  return result.applied;
}

function releaseLeaseForContinuation(flowId: string, leaseId: string, delayMs: number): void {
  const now = Date.now();
  mutatePursueGoalFlow(flowId, (_flow, state) => {
    if (!isPursueGoalLeaseCurrent(state, { ownerId: controllerOwnerId, leaseId, now })) {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...state,
      phase: "waiting",
      lease: undefined,
      retryAt: now + delayMs,
      nextAction: "Continue with the next delegated worker turn.",
    };
    next = withPursueGoalEvent(next, {
      flowId,
      category: "activity",
      name: "activity.waiting",
      actorId: controllerOwnerId,
      summary: "Execution activation yielded and is scheduled to continue.",
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "waiting",
        currentStep: "Next execution activation is scheduled.",
        waitJson: { kind: "retry", retryAt: now + delayMs },
        updatedAt: now,
      },
    };
  });
  const timer = setTimeout(() => kickPursueGoalController(flowId), delayMs);
  timer.unref?.();
}

function currentLeaseState(flowId: string, leaseId: string): PursueGoalControllerState | undefined {
  const flow = getTaskFlowById(flowId);
  const state = flow ? stateForPursueGoalFlow(flow) : undefined;
  return state &&
    isPursueGoalLeaseCurrent(state, { ownerId: controllerOwnerId, leaseId, now: Date.now() })
    ? state
    : undefined;
}

function queueTerminalNotification(params: {
  flowId: string;
  flow: TaskFlowRecord;
  status: "completed" | "blocked" | "failed";
  detail: string;
}): void {
  const state = stateForPursueGoalFlow(params.flow);
  if (!state || state.terminalDeliveryState === "consumed") {
    return;
  }
  const now = Date.now();
  const detail = boundedSummary(params.detail) ?? "No additional summary was recorded.";
  const text = [
    `Pursue Goal ${params.status}.`,
    `Mission: ${params.flow.goal}`,
    `Verified update: ${detail}`,
    "Tell the user this result now. Do not silently consume this terminal update.",
  ].join("\n");
  const contextKey = `pursue-goal:${params.flowId}:${params.status}`;
  if (
    state.terminalDeliveryState === "queued" &&
    hasQueuedSystemEventContext(params.flow.ownerKey, contextKey)
  ) {
    return;
  }
  const enqueued = enqueueSystemEvent(text, {
    sessionKey: params.flow.ownerKey,
    contextKey,
    deliveryContext: params.flow.requesterOrigin,
  });
  const queued = enqueued || hasQueuedSystemEventContext(params.flow.ownerKey, contextKey);
  if (queued) {
    requestHeartbeat({
      source: "background-task",
      intent: "immediate",
      reason: `pursue-goal:${params.status}`,
      sessionKey: params.flow.ownerKey,
    });
  }
  if (!queued) {
    emitControlDirectorJourneySignal({
      code: "delivery_miss",
      idempotencyKey: `${params.flowId}:${params.status}`,
      summary: "Terminal Pursue Goal update could not be queued to its owning chat.",
      observed: "System-event enqueue and dedupe lookup both returned false.",
      runId: params.flowId,
      evidenceRefs: [`flow:${params.flowId}`],
    });
  }
  mutatePursueGoalFlow(params.flowId, (_flow, latest) => {
    if (latest.terminalDeliveredAt !== undefined) {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...latest,
      terminalDeliveryAttempts: latest.terminalDeliveryAttempts + 1,
      terminalDeliveryState: queued ? "queued" : "failed",
      ...(queued
        ? {
            terminalQueuedAt: now,
            terminalDeliveredAt: undefined,
            terminalDeliveryLastError: undefined,
          }
        : {
            terminalDeliveredAt: undefined,
            terminalDeliveryLastError:
              "Terminal update could not be queued; reconciliation will retry.",
          }),
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "notification",
      name: queued ? "notification.queued" : "notification.failed",
      actorId: controllerOwnerId,
      summary: queued
        ? "Terminal goal update queued to the owning chat session."
        : "Terminal goal update was already queued or could not be queued.",
      at: now,
    });
    return { state: next, patch: { updatedAt: now } };
  });
}

function terminalContext(event: SystemEvent): { flowId: string } | null {
  const match = /^pursue-goal:([^:]+):(completed|blocked|failed)$/.exec(event.contextKey ?? "");
  return match?.[1] ? { flowId: match[1] } : null;
}

function observeTerminalNotificationConsumption(params: {
  sessionKey: string;
  events: readonly SystemEvent[];
}): void {
  for (const event of params.events) {
    const context = terminalContext(event);
    if (!context) {
      continue;
    }
    const now = Date.now();
    mutatePursueGoalFlow(context.flowId, (flow, state) => {
      if (
        flow.ownerKey !== params.sessionKey ||
        (state.terminalDeliveryState !== "queued" && state.terminalDeliveryState !== "pending")
      ) {
        return undefined;
      }
      let next: PursueGoalControllerState = {
        ...state,
        terminalDeliveryState: "consumed",
        terminalConsumedAt: now,
        terminalDeliveredAt: now,
        terminalDeliveryLastError: undefined,
      };
      next = withPursueGoalEvent(next, {
        flowId: flow.flowId,
        category: "notification",
        name: "notification.delivered",
        actorId: controllerOwnerId,
        summary: "Terminal goal update was consumed by the owning chat prompt.",
        correlation: { sessionKey: params.sessionKey },
        at: now,
      });
      return { state: next, patch: { updatedAt: now } };
    });
  }
}

function markTurnStarted(params: {
  flowId: string;
  leaseId: string;
  runId: string;
  taskId: string;
}): PursueGoalControllerState | undefined {
  const now = Date.now();
  const result = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (
      !isPursueGoalLeaseCurrent(state, {
        ownerId: controllerOwnerId,
        leaseId: params.leaseId,
        now,
      })
    ) {
      return undefined;
    }
    const workerEvidence = verifyControlDirectorDiagnosticEvidence({
      claim: {
        schemaVersion: 1,
        kind: "worker",
        subjectId: state.workerSessionId,
        expectedBinding: state.workerAgentId,
      },
      evidence: {
        schemaVersion: 1,
        kind: "worker",
        subjectId: state.workerSessionId,
        source: "pursue_goal_state",
        sourceId: state.missionId,
        observedAt: flow.updatedAt,
        binding: state.workerSessionKey.startsWith(`agent:${state.workerAgentId}:`)
          ? state.workerAgentId
          : state.workerSessionKey,
        status: "supported",
      },
      now,
    });
    if (workerEvidence.status !== "supported") {
      const blocker = `Worker diagnostic evidence was rejected (${workerEvidence.reason}: ${workerEvidence.detail})`;
      let next: PursueGoalControllerState = {
        ...state,
        phase: "blocked",
        lease: undefined,
        lastError: blocker,
        nextAction: "Repair the typed worker assignment and retry the goal.",
        terminalDeliveryState: "pending",
      };
      next = withPursueGoalEvent(next, {
        flowId: params.flowId,
        category: "task",
        name: "task.failed",
        actorId: controllerOwnerId,
        summary: blocker,
        correlation: { runId: params.runId, taskId: params.taskId },
        at: now,
      });
      return {
        state: next,
        patch: {
          status: "blocked",
          currentStep: "Blocked by mismatched worker evidence.",
          blockedTaskId: params.taskId,
          blockedSummary: blocker,
          endedAt: now,
          updatedAt: now,
        },
      };
    }
    let next: PursueGoalControllerState = {
      ...state,
      mailbox: appendDurableWorkerMailboxMessage(
        state.mailbox,
        createDurableWorkerMailboxMessage({
          messageId: assignmentMailboxId(params.runId),
          idempotencyKey: `assignment:${params.runId}`,
          flowId: params.flowId,
          missionId: state.missionId,
          direction: "assignment",
          kind: "work",
          actorId: "program-manager",
          recipientId: state.workerAgentId,
          summary: `Execute delegated Pursue Goal turn ${state.turnCount + 1}.`,
          correlation: { runId: params.runId, taskId: params.taskId },
          createdAt: now,
        }),
      ),
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "task",
      name: "task.started",
      actorId: state.workerAgentId,
      summary: `Delegated worker turn ${state.turnCount + 1} started.`,
      correlation: {
        runId: params.runId,
        taskId: params.taskId,
        sessionKey: state.workerSessionKey,
      },
      at: now,
    });
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "activity",
      name: "activity.working",
      actorId: state.workerAgentId,
      summary: "Delegated worker is executing the next goal step.",
      correlation: { runId: params.runId, taskId: params.taskId },
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "running",
        currentStep: `Delegated worker turn ${state.turnCount + 1} is running.`,
        updatedAt: now,
      },
    };
  });
  return result.flow ? stateForPursueGoalFlow(result.flow) : undefined;
}

/** Persist a worker result before touching the separate task registry. */
function stageTurnResult(params: {
  flowId: string;
  leaseId: string;
  runId: string;
  taskId: string;
  result: PursueGoalTurnResult;
}): PursueGoalMutationResult {
  const pendingResult = pendingTurnResult(params.result);
  if (!pendingResult) {
    return {
      found: true,
      applied: false,
      reason: "Worker result exceeded the durable handoff size limit.",
    };
  }
  const now = Date.now();
  return mutatePursueGoalFlow(params.flowId, (_flow, state) => {
    if (
      !isPursueGoalLeaseCurrent(state, {
        ownerId: controllerOwnerId,
        leaseId: params.leaseId,
        now,
      })
    ) {
      return undefined;
    }
    if (state.pendingTurn) {
      return state.pendingTurn.runId === params.runId && state.pendingTurn.taskId === params.taskId
        ? { state, patch: { updatedAt: now } }
        : undefined;
    }
    if (
      state.judgeExecution &&
      (state.judgeExecution.runId !== params.runId ||
        state.judgeExecution.taskId !== params.taskId ||
        params.result.judgeReceipt?.schemaVersion !== 2 ||
        state.judgeExecution.claimHash !== params.result.judgeReceipt.claimHash ||
        state.judgeExecution.promptHash !== params.result.judgeReceipt.promptHash)
    ) {
      return undefined;
    }
    const next = { ...state };
    const receipt = params.result.judgeReceipt;
    const receiptSettlesReservedExecution = Boolean(
      state.judgeExecution &&
      receipt &&
      receipt.schemaVersion === 2 &&
      receipt.missionId === state.missionId &&
      judgeReceiptVerifier(receipt) &&
      judgeReceiptEvidenceSemanticallyValid(receipt) &&
      ((params.result.status === "complete" && receipt.verdict === "APPROVE") ||
        (params.result.status === "blocked" && receipt.verdict !== "APPROVE")),
    );
    if (receiptSettlesReservedExecution) {
      delete next.judgeExecution;
    }
    return {
      state: {
        ...next,
        pendingTurn: {
          runId: params.runId,
          taskId: params.taskId,
          phase: "staged" as const,
          result: pendingResult,
        },
      },
      patch: { updatedAt: now },
    };
  });
}

/** Persist a no-replay fence before the independent Judge provider call. */
function reserveJudgeExecution(params: {
  flowId: string;
  leaseId: string;
  runId: string;
  taskId: string;
  claimHash: string;
  promptHash: string;
}): boolean {
  const now = Date.now();
  return mutatePursueGoalFlow(params.flowId, (_flow, state) => {
    if (
      !isPursueGoalLeaseCurrent(state, {
        ownerId: controllerOwnerId,
        leaseId: params.leaseId,
        now,
      }) ||
      state.pendingTurn ||
      state.judgeExecution
    ) {
      return undefined;
    }
    return {
      state: {
        ...state,
        judgeExecution: {
          runId: params.runId,
          taskId: params.taskId,
          claimHash: params.claimHash,
          promptHash: params.promptHash,
          reservedAt: now,
        },
      },
      patch: { updatedAt: now },
    };
  }).applied;
}

/** Clear a handoff only after the task registry has acknowledged the result. */
function acknowledgeTurnResult(params: {
  flowId: string;
  runId: string;
  taskId: string;
}): PursueGoalMutationResult {
  return mutatePursueGoalFlow(params.flowId, (_flow, state) => {
    const pending = state.pendingTurn;
    if (
      !pending ||
      pending.runId !== params.runId ||
      pending.taskId !== params.taskId ||
      pending.phase !== "applied"
    ) {
      return undefined;
    }
    const next = { ...state };
    delete next.pendingTurn;
    return { state: next, patch: { updatedAt: Date.now() } };
  });
}

function applyTurnResult(params: {
  flowId: string;
  leaseId: string;
  runId: string;
  taskId: string;
  result: PursueGoalTurnResult;
}): { applied: boolean; terminal: boolean; flow?: TaskFlowRecord } {
  const now = Date.now();
  const mutation = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (
      !isPursueGoalLeaseCurrent(state, {
        ownerId: controllerOwnerId,
        leaseId: params.leaseId,
        now,
      })
    ) {
      return undefined;
    }
    const pending = state.pendingTurn;
    if (
      !pending ||
      pending.runId !== params.runId ||
      pending.taskId !== params.taskId ||
      pending.phase !== "staged"
    ) {
      return undefined;
    }
    const result = pending.result;
    const summary = boundedSummary(result.text);
    const observedBlocker = boundedSummary(
      result.provisionalBlocker ??
        (result.status === "blocked" ? (result.blocker ?? result.text) : undefined),
    );
    const consecutiveBlockers = observedBlocker
      ? nextPursueGoalBlockerCount({
          previousSummary: state.lastError,
          previousCount: state.consecutiveBlockers,
          currentSummary: observedBlocker,
        })
      : 0;
    const correlation = { runId: params.runId, taskId: params.taskId };
    const resultKind =
      result.status === "complete"
        ? "success"
        : result.status === "blocked" || result.provisionalBlocker
          ? "blocked"
          : "progress";
    let next: PursueGoalControllerState = {
      ...state,
      pendingTurn: { ...pending, phase: "applied" },
      turnCount: state.turnCount + 1,
      consecutiveFailures: 0,
      consecutiveBlockers,
      staleGoalRepairAttempts: 0,
      lastResult: summary,
      lastError: observedBlocker,
      mailbox: appendDurableWorkerMailboxMessage(
        state.mailbox,
        createDurableWorkerMailboxMessage({
          idempotencyKey: `result:${params.runId}`,
          flowId: params.flowId,
          missionId: state.missionId,
          direction: "result",
          kind: resultKind,
          actorId: state.workerAgentId,
          recipientId: "program-manager",
          summary: summary ?? `Worker returned ${result.status}.`,
          correlation: {
            runId: params.runId,
            taskId: params.taskId,
            assignmentMessageId: assignmentMailboxId(params.runId),
          },
          evidenceRefs: result.artifactIds,
          createdAt: now,
        }),
      ),
    };
    if (result.status === "complete") {
      const evidenceSummary =
        boundedEvidenceSummary(result.evidenceSummary) ?? "No completion evidence was recorded.";
      const expectedClaimHash = buildControlDirectorJudgeClaimHash({
        missionId: state.missionId,
        requestBody: flow.goal,
        finalText: result.text,
        evidenceSummary,
        artifactIds: result.artifactIds,
      });
      const receipt = result.judgeReceipt;
      const receiptCryptographicallyValid = Boolean(receipt && judgeReceiptVerifier(receipt));
      const receiptSemanticallyValid = Boolean(
        receipt && judgeReceiptApprovalSemanticallyValid(receipt),
      );
      const completionEvidence = verifyControlDirectorDiagnosticEvidence({
        claim: {
          schemaVersion: 1,
          kind: "completion",
          subjectId: state.missionId,
          expectedBinding: expectedClaimHash,
        },
        evidence: receipt
          ? {
              schemaVersion: 1,
              kind: "completion",
              subjectId: receipt.missionId,
              source: "judge_receipt",
              sourceId: receipt.receiptId,
              observedAt: receipt.issuedAt,
              binding: receipt.claimHash,
              status:
                receipt.verdict === "APPROVE" &&
                receiptCryptographicallyValid &&
                receiptSemanticallyValid
                  ? "supported"
                  : "unsupported",
            }
          : undefined,
        now,
      });
      const validApproval = completionEvidence.status === "supported";
      if (!validApproval) {
        const diagnosticDetail =
          completionEvidence.status === "rejected"
            ? `${completionEvidence.reason}: ${completionEvidence.detail}`
            : "unknown evidence verdict";
        const blocker = `Completion was rejected because its independent Judge receipt was missing, invalid, unsigned, stale, or not bound to the exact mission claim (${diagnosticDetail}).`;
        emitControlDirectorJourneySignal({
          code: "completion_without_proof",
          idempotencyKey: `${state.missionId}:${params.runId}`,
          summary: "Pursue Goal completion failed independent claim-bound verification.",
          observed: blocker,
          runId: params.runId,
          taskId: params.taskId,
          evidenceRefs: [`mission:${state.missionId}`, `flow:${params.flowId}`],
        });
        next = {
          ...next,
          phase: "blocked",
          lease: undefined,
          consecutiveBlockers: state.consecutiveBlockers + 1,
          lastError: blocker,
          nextAction:
            "Rerun independent verification and attach a valid signed claim-bound receipt.",
          terminalDeliveryState: "pending",
        };
        next = withPursueGoalEvent(next, {
          flowId: params.flowId,
          category: "judge",
          name: "judge.rejected",
          actorId: receipt?.judgeAgentId ?? "judge-gate",
          summary: blocker,
          correlation,
          at: now,
        });
        return {
          state: next,
          patch: {
            status: "blocked",
            currentStep: "Blocked by independent completion verification.",
            blockedTaskId: params.taskId,
            blockedSummary: blocker,
            waitJson: null,
            endedAt: now,
            updatedAt: now,
          },
        };
      }
      next = {
        ...next,
        phase: "succeeded",
        lease: undefined,
        nextAction: undefined,
        judgeReceipt: receipt!,
        terminalDeliveryState: "pending",
      };
      next = withPursueGoalEvent(next, {
        flowId: params.flowId,
        category: "judge",
        name: "judge.approved",
        actorId: receipt!.judgeAgentId,
        summary: "Independent Judge approved the exact completion claim and evidence.",
        correlation,
        at: now,
      });
      next = withPursueGoalEvent(next, {
        flowId: params.flowId,
        category: "goal",
        name: "goal.completed",
        actorId: controllerOwnerId,
        summary: "Pursue Goal completed with an independent signed approval receipt.",
        correlation,
        at: now,
      });
      return {
        state: next,
        patch: {
          status: "succeeded",
          currentStep: "Completed and independently verified.",
          blockedTaskId: null,
          blockedSummary: null,
          waitJson: null,
          endedAt: now,
          updatedAt: now,
        },
      };
    }
    if (result.status === "blocked") {
      const blocker =
        boundedSummary(result.blocker ?? result.text) ??
        "Execution is blocked pending evidence or external action.";
      const receipt = result.judgeReceipt;
      if (receipt) {
        const evidenceSummary =
          boundedEvidenceSummary(result.evidenceSummary) ?? "No completion evidence was recorded.";
        const expectedClaimHash = buildControlDirectorJudgeClaimHash({
          missionId: state.missionId,
          requestBody: flow.goal,
          finalText: result.text,
          evidenceSummary,
          artifactIds: result.artifactIds,
        });
        const receiptValid =
          receipt.verdict !== "APPROVE" &&
          receipt.missionId === state.missionId &&
          receipt.claimHash === expectedClaimHash &&
          judgeReceiptVerifier(receipt) &&
          judgeReceiptEvidenceSemanticallyValid(receipt);
        const terminalBlocker = receiptValid
          ? blocker
          : "Independent Judge rejection was invalid, unsigned, or not bound to the exact mission claim; execution stopped to prevent replay.";
        next = {
          ...next,
          phase: "blocked",
          lease: undefined,
          consecutiveBlockers: Math.max(
            consecutiveBlockers,
            PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS,
          ),
          lastError: terminalBlocker,
          nextAction: receiptValid
            ? "Resolve the Judge conditions, then edit or retry the goal."
            : "Review the invalid Judge evidence before creating a new claim.",
          ...(receiptValid ? { judgeReceipt: receipt } : {}),
          terminalDeliveryState: "pending",
        };
        next = withPursueGoalEvent(next, {
          flowId: params.flowId,
          category: "judge",
          name: "judge.rejected",
          actorId: receiptValid ? receipt.judgeAgentId : "judge-gate",
          summary: receiptValid
            ? `Independent Judge rejected the completion: ${receipt.conditions}`
            : terminalBlocker,
          correlation,
          at: now,
        });
        next = withPursueGoalEvent(next, {
          flowId: params.flowId,
          category: "goal",
          name: "goal.blocked",
          actorId: controllerOwnerId,
          summary: terminalBlocker,
          correlation,
          at: now,
        });
        return {
          state: next,
          patch: {
            status: "blocked",
            currentStep: "Blocked by independent completion verification.",
            blockedTaskId: params.taskId,
            blockedSummary: terminalBlocker,
            waitJson: null,
            endedAt: now,
            updatedAt: now,
          },
        };
      }
      const blockerBinding = crypto.createHash("sha256").update(blocker).digest("hex");
      const blockerEvidence = verifyControlDirectorDiagnosticEvidence({
        claim: {
          schemaVersion: 1,
          kind: "blocker",
          subjectId: state.missionId,
          expectedBinding: blockerBinding,
        },
        evidence: {
          schemaVersion: 1,
          kind: "blocker",
          subjectId: state.missionId,
          source: "pursue_goal_state",
          sourceId: `${params.runId}:${params.taskId}`,
          observedAt: now,
          binding: blockerBinding,
          status:
            consecutiveBlockers >= PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS
              ? "supported"
              : "unsupported",
        },
        now,
      });
      if (blockerEvidence.status !== "supported") {
        next = {
          ...next,
          phase: "running",
          nextAction: `Re-evaluate the same provisional blocker; confirmation ${consecutiveBlockers}/${PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS} is not terminal.`,
        };
        return {
          state: next,
          patch: {
            status: "running",
            currentStep: `Worker blocker remains provisional (${consecutiveBlockers}/${PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS}).`,
            updatedAt: now,
          },
        };
      }
      next = {
        ...next,
        phase: "blocked",
        lease: undefined,
        lastError: blocker,
        nextAction: "Resolve the recorded blocker, then retry the goal.",
        ...(result.judgeReceipt ? { judgeReceipt: result.judgeReceipt } : {}),
        terminalDeliveryState: "pending",
      };
      if (result.judgeReceipt) {
        next = withPursueGoalEvent(next, {
          flowId: params.flowId,
          category: "judge",
          name: "judge.rejected",
          actorId: result.judgeReceipt.judgeAgentId,
          summary: `Independent Judge requested more evidence: ${result.judgeReceipt.conditions}`,
          correlation,
          at: now,
        });
      }
      next = withPursueGoalEvent(next, {
        flowId: params.flowId,
        category: "goal",
        name: "goal.blocked",
        actorId: controllerOwnerId,
        summary: blocker,
        correlation,
        at: now,
      });
      return {
        state: next,
        patch: {
          status: "blocked",
          currentStep: "Blocked; review the recorded reason and retry when resolved.",
          blockedTaskId: params.taskId,
          blockedSummary: blocker,
          waitJson: null,
          endedAt: now,
          updatedAt: now,
        },
      };
    }
    if (result.status === "paused") {
      next = {
        ...next,
        phase: "paused",
        lease: undefined,
        pauseRequestedAt: state.pauseRequestedAt ?? now,
        nextAction: "Resume the goal when ready.",
      };
      next = withPursueGoalEvent(next, {
        flowId: params.flowId,
        category: "goal",
        name: "goal.paused",
        actorId: controllerOwnerId,
        summary: "Worker paused the goal.",
        correlation,
        at: now,
      });
      return {
        state: next,
        patch: {
          status: "paused",
          currentStep: "Paused.",
          waitJson: null,
          endedAt: null,
          updatedAt: now,
        },
      };
    }
    next = {
      ...next,
      phase: "running",
      nextAction: result.provisionalBlocker
        ? `Re-evaluate the same provisional blocker; confirmation ${consecutiveBlockers}/${PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS} is not terminal.`
        : "Continue with the next delegated worker turn.",
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: result.provisionalBlocker ? "activity" : "task",
      name: result.provisionalBlocker ? "activity.waiting" : "task.completed",
      actorId: state.workerAgentId,
      summary: result.provisionalBlocker
        ? `Worker blocker is provisional (${consecutiveBlockers}/${PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS}); the controller will retry before stopping.`
        : (summary ?? "Delegated worker turn completed and returned control."),
      correlation,
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "running",
        currentStep: "Worker turn finished; continuing the goal.",
        updatedAt: now,
      },
    };
  });
  const state = mutation.flow ? stateForPursueGoalFlow(mutation.flow) : undefined;
  return {
    applied: mutation.applied,
    terminal: Boolean(state && isTerminalPhase(state)) || state?.phase === "blocked",
    flow: mutation.flow,
  };
}

function recordTurnFailure(params: {
  flowId: string;
  leaseId: string;
  runId: string;
  taskId: string;
  error: unknown;
}): { terminal: boolean; retryDelayMs?: number; flow?: TaskFlowRecord } {
  const now = Date.now();
  const message =
    boundedSummary(params.error instanceof Error ? params.error.message : String(params.error)) ??
    "Unknown worker failure.";
  const mutation = mutatePursueGoalFlow(params.flowId, (_flow, state) => {
    if (
      !isPursueGoalLeaseCurrent(state, {
        ownerId: controllerOwnerId,
        leaseId: params.leaseId,
        now,
      })
    ) {
      return undefined;
    }
    const abandonedJudge =
      state.judgeExecution?.runId === params.runId && state.judgeExecution.taskId === params.taskId;
    const failures = state.consecutiveFailures + 1;
    if (abandonedJudge) {
      const blocker =
        "Judge execution ended without a durably staged receipt; automatic replay is disabled to prevent duplicate decisions.";
      return {
        state: {
          ...state,
          lease: undefined,
          phase: "blocked",
          lastError: blocker,
          nextAction: "Inspect the interrupted Judge attempt and explicitly retry the goal.",
          terminalDeliveryState: "pending",
        },
        patch: {
          status: "blocked",
          currentStep: "Blocked after an interrupted Judge attempt.",
          blockedTaskId: params.taskId,
          blockedSummary: blocker,
          waitJson: null,
          endedAt: now,
          updatedAt: now,
        },
      };
    }
    const terminal = failures >= PURSUE_GOAL_MAX_FAILURES;
    const retryDelayMs = PURSUE_GOAL_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1);
    let next: PursueGoalControllerState = {
      ...state,
      lease: undefined,
      consecutiveFailures: failures,
      lastError: message,
      phase: terminal ? "failed" : "waiting",
      ...(terminal ? { terminalDeliveryState: "pending" as const } : {}),
      retryAt: terminal ? undefined : now + retryDelayMs,
      nextAction: terminal
        ? "Inspect the repeated controller failure before retrying."
        : "Retry the failed worker turn with idempotent mission context.",
      mailbox: appendDurableWorkerMailboxMessage(
        state.mailbox,
        createDurableWorkerMailboxMessage({
          idempotencyKey: `result:${params.runId}`,
          flowId: params.flowId,
          missionId: state.missionId,
          direction: "result",
          kind: "failure",
          actorId: state.workerAgentId,
          recipientId: "program-manager",
          summary: message,
          correlation: {
            runId: params.runId,
            taskId: params.taskId,
            assignmentMessageId: assignmentMailboxId(params.runId),
          },
          createdAt: now,
        }),
      ),
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: terminal ? "run" : "task",
      name: terminal ? "run.failed" : "task.failed",
      actorId: controllerOwnerId,
      summary: message,
      correlation: { runId: params.runId, taskId: params.taskId },
      at: now,
    });
    return {
      state: next,
      patch: {
        status: terminal ? "failed" : "waiting",
        currentStep: terminal
          ? "Controller failed repeatedly; manual retry is required."
          : "Worker turn failed; retry is scheduled.",
        blockedTaskId: terminal ? params.taskId : null,
        blockedSummary: terminal ? message : null,
        waitJson: terminal ? null : { kind: "retry", retryAt: now + retryDelayMs },
        endedAt: terminal ? now : null,
        updatedAt: now,
      },
    };
  });
  const state = mutation.flow ? stateForPursueGoalFlow(mutation.flow) : undefined;
  return {
    terminal: state?.phase === "failed",
    ...(state?.retryAt !== undefined ? { retryDelayMs: Math.max(0, state.retryAt - now) } : {}),
    ...(mutation.flow ? { flow: mutation.flow } : {}),
  };
}

async function runControllerActivation(params: {
  flowId: string;
  leaseId: string;
  abortController: AbortController;
}): Promise<void> {
  const runtime = await getControllerRuntime();
  const heartbeatTimer = setInterval(() => {
    if (!heartbeatLease(params.flowId, params.leaseId)) {
      params.abortController.abort();
    }
  }, PURSUE_GOAL_HEARTBEAT_MS);
  heartbeatTimer.unref?.();
  try {
    for (let turn = 0; turn < PURSUE_GOAL_MAX_TURNS_PER_ACTIVATION; turn += 1) {
      if (params.abortController.signal.aborted || controllersStopping) {
        return;
      }
      const flow = getTaskFlowById(params.flowId);
      const state = currentLeaseState(params.flowId, params.leaseId);
      if (!flow || !state || flow.cancelRequestedAt !== undefined) {
        return;
      }
      const runId = crypto.randomUUID();
      const taskResult = runTaskInFlow({
        flowId: params.flowId,
        runtime: "cli",
        sourceId: "pursue-goal-controller",
        childSessionKey: state.workerSessionKey,
        agentId: state.workerAgentId,
        runId,
        label: `Pursue Goal turn ${state.turnCount + 1}`,
        task: flow.goal,
        notifyPolicy: "silent",
        deliveryStatus: "not_applicable",
        status: "running",
        startedAt: Date.now(),
        progressSummary: "Delegated worker turn is running.",
      });
      if (!taskResult.created || !taskResult.task) {
        throw new Error(taskResult.reason ?? "Unable to create a durable worker task record.");
      }
      const startedState = markTurnStarted({
        flowId: params.flowId,
        leaseId: params.leaseId,
        runId,
        taskId: taskResult.task.taskId,
      });
      if (!startedState) {
        failTaskRunByRunId({
          runId,
          status: "cancelled",
          endedAt: Date.now(),
          terminalSummary: "Controller lease was lost before the worker turn started.",
          suppressDelivery: true,
        });
        return;
      }
      if (startedState.phase === "blocked") {
        failTaskRunByRunId({
          runId,
          status: "cancelled",
          endedAt: Date.now(),
          terminalSummary: startedState.lastError,
          suppressDelivery: true,
        });
        const blockedFlow = getTaskFlowById(params.flowId);
        if (blockedFlow) {
          queueTerminalNotification({
            flowId: params.flowId,
            flow: blockedFlow,
            status: "blocked",
            detail: startedState.lastError ?? "Typed worker evidence was rejected.",
          });
        }
        return;
      }
      let resultApplied = false;
      try {
        const result = await runtime.runTurn({
          flowId: params.flowId,
          goal: flow.goal,
          state: startedState,
          runId,
          abortSignal: params.abortController.signal,
          reserveJudgeExecution: ({ claimHash, promptHash }) =>
            reserveJudgeExecution({
              flowId: params.flowId,
              leaseId: params.leaseId,
              runId,
              taskId: taskResult.task!.taskId,
              claimHash,
              promptHash,
            }),
        });
        const staged = stageTurnResult({
          flowId: params.flowId,
          leaseId: params.leaseId,
          runId,
          taskId: taskResult.task.taskId,
          result,
        });
        if (!staged.applied) {
          throw new Error(staged.reason ?? "Unable to durably stage the worker result.");
        }
        const applied = applyTurnResult({
          flowId: params.flowId,
          leaseId: params.leaseId,
          runId,
          taskId: taskResult.task.taskId,
          result,
        });
        if (!applied.applied) {
          // Leave the staged result for lease-based recovery; replaying the
          // provider call here would risk duplicate Judge execution.
          return;
        }
        resultApplied = true;
        completeTaskRunByRunId({
          runId,
          endedAt: Date.now(),
          progressSummary: boundedSummary(result.text),
          terminalSummary: boundedSummary(result.blocker ?? result.text),
          terminalOutcome: result.status === "blocked" ? "blocked" : "succeeded",
          suppressDelivery: true,
        });
        acknowledgeTurnResult({
          flowId: params.flowId,
          runId,
          taskId: taskResult.task.taskId,
        });
        if (applied.terminal) {
          if (applied.flow) {
            const status = applied.flow.status === "succeeded" ? "completed" : "blocked";
            queueTerminalNotification({
              flowId: params.flowId,
              flow: applied.flow,
              status,
              detail: result.blocker ?? result.text,
            });
          }
          return;
        }
      } catch (error) {
        failTaskRunByRunId({
          runId,
          status:
            isAbortError(error) || params.abortController.signal.aborted ? "cancelled" : "failed",
          endedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          terminalSummary: isAbortError(error)
            ? "Worker turn was interrupted by a goal control action."
            : "Worker turn failed.",
          suppressDelivery: true,
        });
        if (isAbortError(error) || params.abortController.signal.aborted) {
          return;
        }
        if (resultApplied) {
          // The durable flow already contains the result; recovery will
          // finalize/acknowledge the task without replaying the provider call.
          return;
        }
        const failed = recordTurnFailure({
          flowId: params.flowId,
          leaseId: params.leaseId,
          runId,
          taskId: taskResult.task.taskId,
          error,
        });
        if (failed.flow && failed.terminal) {
          queueTerminalNotification({
            flowId: params.flowId,
            flow: failed.flow,
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          });
        } else if (failed.retryDelayMs !== undefined) {
          const timer = setTimeout(
            () => kickPursueGoalController(params.flowId),
            failed.retryDelayMs,
          );
          timer.unref?.();
        }
        return;
      }
    }
    releaseLeaseForContinuation(params.flowId, params.leaseId, PURSUE_GOAL_RETRY_BASE_MS);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function discardPendingTurn(
  flowId: string,
  pending: PursueGoalControllerState["pendingTurn"],
): void {
  if (!pending) {
    return;
  }
  mutatePursueGoalFlow(flowId, (_flow, state) => {
    if (
      !state.pendingTurn ||
      state.pendingTurn.runId !== pending.runId ||
      state.pendingTurn.taskId !== pending.taskId
    ) {
      return undefined;
    }
    const next = { ...state };
    delete next.pendingTurn;
    return { state: next, patch: { updatedAt: Date.now() } };
  });
}

function finalizeRecoveredPendingTurn(
  flowId: string,
  pending: NonNullable<PursueGoalControllerState["pendingTurn"]>,
): boolean {
  try {
    completeTaskRunByRunId({
      runId: pending.runId,
      endedAt: Date.now(),
      progressSummary: boundedSummary(pending.result.text),
      terminalSummary: boundedSummary(pending.result.blocker ?? pending.result.text),
      terminalOutcome: pending.result.status === "blocked" ? "blocked" : "succeeded",
      suppressDelivery: true,
    });
    acknowledgeTurnResult({ flowId, runId: pending.runId, taskId: pending.taskId });
    return true;
  } catch (error) {
    log.warn("Unable to finalize a durable Pursue Goal result handoff", {
      flowId,
      runId: pending.runId,
      error,
    });
    return false;
  }
}

/** Recover a staged/applied result without replaying the worker or Judge call. */
function recoverPendingTurn(flow: TaskFlowRecord, state: PursueGoalControllerState): boolean {
  const pending = state.pendingTurn;
  if (!pending || activeControllers.has(flow.flowId)) {
    return false;
  }
  if (isTerminalPhase(state) || state.phase === "blocked") {
    if (pending.phase === "staged") {
      failTaskRunByRunId({
        runId: pending.runId,
        status: "cancelled",
        endedAt: Date.now(),
        terminalSummary: "Pending worker result was discarded after terminal goal state.",
        suppressDelivery: true,
      });
      discardPendingTurn(flow.flowId, pending);
      return true;
    }
    return finalizeRecoveredPendingTurn(flow.flowId, pending);
  }
  if (pending.phase === "applied") {
    return finalizeRecoveredPendingTurn(flow.flowId, pending);
  }
  const acquired = acquireLease(flow.flowId);
  const leaseId = acquired?.state.lease?.leaseId;
  if (!leaseId) {
    return false;
  }
  const applied = applyTurnResult({
    flowId: flow.flowId,
    leaseId,
    runId: pending.runId,
    taskId: pending.taskId,
    result: pending.result,
  });
  if (!applied.applied) {
    return false;
  }
  if (!finalizeRecoveredPendingTurn(flow.flowId, pending)) {
    return false;
  }
  if (applied.terminal && applied.flow) {
    queueTerminalNotification({
      flowId: flow.flowId,
      flow: applied.flow,
      status: applied.flow.status === "succeeded" ? "completed" : "blocked",
      detail: pending.result.blocker ?? pending.result.text,
    });
  } else {
    releaseLeaseForContinuation(flow.flowId, leaseId, PURSUE_GOAL_RETRY_BASE_MS);
  }
  return true;
}

/** Acquire a lease and start execution without blocking the gateway request. */
export function kickPursueGoalController(flowId: string): boolean {
  if (controllersStopping || activeControllers.has(flowId)) {
    return false;
  }
  const acquired = acquireLease(flowId);
  if (!acquired?.state.lease) {
    return false;
  }
  const abortController = new AbortController();
  const leaseId = acquired.state.lease.leaseId;
  const promise = runControllerActivation({ flowId, leaseId, abortController })
    .catch((error: unknown) => {
      log.error("Pursue Goal controller activation failed", { flowId, error });
    })
    .finally(() => {
      const active = activeControllers.get(flowId);
      if (active?.leaseId === leaseId) {
        activeControllers.delete(flowId);
      }
    });
  activeControllers.set(flowId, { leaseId, abortController, promise });
  return true;
}

/** Reacquire queued, waiting, or stale-running goals after restart or lease loss. */
export function reconcilePursueGoalControllers(): number {
  if (controllersStopping) {
    return 0;
  }
  let kicked = 0;
  const now = Date.now();
  for (const flow of listTaskFlowRecordsPage({ controllerId: PURSUE_GOAL_CONTROLLER_ID }).flows) {
    const state = stateForPursueGoalFlow(flow);
    if (!state) {
      const blocker = "Pursue Goal state is malformed or exceeds its durable bounds.";
      if (flow.status !== "blocked" || flow.blockedSummary !== blocker) {
        updateFlowRecordByIdExpectedRevision({
          flowId: flow.flowId,
          expectedRevision: flow.revision,
          patch: {
            status: "blocked",
            currentStep: "Blocked by invalid durable Pursue Goal state.",
            blockedSummary: blocker,
            endedAt: now,
            updatedAt: now,
          },
        });
      }
      continue;
    }
    if (state.pendingTurn) {
      recoverPendingTurn(flow, state);
      // Never start a fresh worker turn while a prior result still has a
      // durable handoff outstanding.
      continue;
    }
    if (state.judgeExecution) {
      if (state.phase === "blocked" && flow.status === "blocked" && !state.lease) {
        // The indeterminate execution was already terminally handled. Keep its
        // no-replay marker without revising the flow or failing the task again.
        continue;
      }
      const interruptedJudge = state.judgeExecution;
      const blocker =
        "Judge execution was interrupted before its signed receipt was durably staged; automatic replay is disabled.";
      failTaskRunByRunId({
        runId: interruptedJudge.runId,
        status: "failed",
        endedAt: now,
        terminalSummary: blocker,
        suppressDelivery: true,
      });
      if (!isTerminalPhase(state)) {
        mutatePursueGoalFlow(flow.flowId, (_latestFlow, latestState) => {
          const currentExecution = latestState.judgeExecution;
          if (
            !currentExecution ||
            currentExecution.runId !== interruptedJudge.runId ||
            currentExecution.taskId !== interruptedJudge.taskId
          ) {
            return undefined;
          }
          return {
            state: {
              ...latestState,
              phase: "blocked",
              lease: undefined,
              lastError: blocker,
              nextAction: "Edit the goal or inspect the interrupted Judge attempt before retrying.",
              terminalDeliveryState: "pending",
            },
            patch: {
              status: "blocked",
              currentStep: "Blocked after an interrupted Judge attempt.",
              blockedTaskId: currentExecution.taskId,
              blockedSummary: blocker,
              waitJson: null,
              endedAt: now,
              updatedAt: now,
            },
          };
        });
        continue;
      }
    }
    if (state.phase === "succeeded") {
      const receipt = state.judgeReceipt;
      if (
        !receipt ||
        receipt.missionId !== state.missionId ||
        !judgeReceiptVerifier(receipt) ||
        !judgeReceiptApprovalSemanticallyValid(receipt)
      ) {
        const blocker =
          "Persisted success was quarantined because its signed V2 Judge receipt is missing, invalid, or bound to another mission.";
        mutatePursueGoalFlow(flow.flowId, (_latestFlow, latestState) => ({
          state: {
            ...latestState,
            phase: "blocked",
            lease: undefined,
            lastError: blocker,
            nextAction:
              "Inspect persisted evidence and explicitly retry with a new verified claim.",
            terminalDeliveryState: "pending",
          },
          patch: {
            status: "blocked",
            currentStep: "Persisted completion receipt failed restart verification.",
            blockedSummary: blocker,
            endedAt: now,
            updatedAt: now,
          },
        }));
        continue;
      }
    }
    if (isTerminalPhase(state) || state.phase === "blocked") {
      if (
        state.terminalDeliveryState !== "consumed" &&
        !(
          state.terminalDeliveryState === "queued" &&
          hasQueuedSystemEventContext(
            flow.ownerKey,
            `pursue-goal:${flow.flowId}:${
              flow.status === "succeeded"
                ? "completed"
                : flow.status === "failed"
                  ? "failed"
                  : "blocked"
            }`,
          )
        )
      ) {
        const repair = evaluateControlDirectorSelfHealing({
          signalCode: "delivery_miss",
          action: "retry_terminal_delivery",
          targetId: flow.flowId,
          reversible: true,
          rollbackRef: `flow:${flow.flowId}:terminal-delivery-pending`,
          evidenceRefs: [`flow:${flow.flowId}`],
          previousAttempts: state.terminalDeliveryAttempts,
          now,
        });
        if (repair.allowed) {
          queueTerminalNotification({
            flowId: flow.flowId,
            flow,
            status:
              flow.status === "succeeded"
                ? "completed"
                : flow.status === "failed"
                  ? "failed"
                  : "blocked",
            detail: state.lastError ?? state.lastResult ?? flow.currentStep ?? flow.goal,
          });
        } else {
          emitControlDirectorJourneySignal({
            code: "delivery_miss",
            idempotencyKey: `${flow.flowId}:repair:${repair.code}`,
            summary: "Terminal delivery self-healing stopped at its bounded policy gate.",
            observed: repair.reason,
            runId: flow.flowId,
            evidenceRefs: [`flow:${flow.flowId}`],
          });
        }
      }
      continue;
    }
    if (state.phase === "paused") {
      continue;
    }
    const staleRunning =
      state.phase === "running" && (!state.lease || state.lease.expiresAt <= now);
    if (staleRunning) {
      emitControlDirectorJourneySignal({
        code: "stalled_goal",
        idempotencyKey: `${flow.flowId}:${state.lease?.leaseId ?? "missing"}:${state.lease?.expiresAt ?? flow.revision}`,
        summary: "A running Pursue Goal lost its current controller lease.",
        observed: state.lease
          ? `Lease expired at ${state.lease.expiresAt}.`
          : "Running state had no lease.",
        runId: flow.flowId,
        evidenceRefs: [`flow:${flow.flowId}`],
      });
      const repair = evaluateControlDirectorSelfHealing({
        signalCode: "stalled_goal",
        action: "reconcile_stale_goal",
        targetId: flow.flowId,
        reversible: true,
        rollbackRef: `flow:${flow.flowId}:expired-lease`,
        evidenceRefs: [`flow:${flow.flowId}`],
        previousAttempts: state.staleGoalRepairAttempts,
        ...(state.staleGoalRepairAttempts > 0 && state.staleGoalRepairLastAt !== undefined
          ? { lastAttemptAt: state.staleGoalRepairLastAt }
          : {}),
        now,
      });
      if (!repair.allowed) {
        emitControlDirectorJourneySignal({
          code: "stalled_goal",
          idempotencyKey: `${flow.flowId}:repair:${repair.code}`,
          summary: "Stalled-goal self-healing stopped at its bounded policy gate.",
          observed: repair.reason,
          runId: flow.flowId,
          evidenceRefs: [`flow:${flow.flowId}`],
        });
        continue;
      }
      mutatePursueGoalFlow(flow.flowId, (_latestFlow, latestState) => {
        let next: PursueGoalControllerState = {
          ...latestState,
          staleGoalRepairAttempts: repair.nextAttempt,
          staleGoalRepairLastAt: now,
        };
        next = withPursueGoalEvent(next, {
          flowId: flow.flowId,
          category: "activity",
          name: "activity.working",
          actorId: controllerOwnerId,
          summary: "Bounded self-healing authorized stale-goal lease reconciliation.",
          at: now,
        });
        return { state: next, patch: { updatedAt: now } };
      });
    }
    if (
      flow.cancelRequestedAt !== undefined ||
      (state.retryAt !== undefined && state.retryAt > now)
    ) {
      continue;
    }
    if (state.lease && state.lease.expiresAt > now && state.lease.ownerId !== controllerOwnerId) {
      continue;
    }
    if (kickPursueGoalController(flow.flowId)) {
      kicked += 1;
    }
  }
  return kicked;
}

export function startPursueGoalControllers(): void {
  if (reconcileTimer) {
    return;
  }
  controllersStopping = false;
  stopTerminalConsumptionObserver ??= registerSystemEventConsumptionListener(
    observeTerminalNotificationConsumption,
  );
  reconcilePursueGoalControllers();
  reconcileTimer = setInterval(reconcilePursueGoalControllers, PURSUE_GOAL_RECONCILE_MS);
  reconcileTimer.unref?.();
}

export async function stopPursueGoalControllers(): Promise<void> {
  controllersStopping = true;
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = undefined;
  }
  stopTerminalConsumptionObserver?.();
  stopTerminalConsumptionObserver = undefined;
  const pending = [...activeControllers.values()].map((active) => {
    active.abortController.abort();
    return active.promise;
  });
  await Promise.allSettled(pending);
  activeControllers.clear();
}

function expectedRevisionMatches(flow: TaskFlowRecord, expectedRevision?: number): boolean {
  return expectedRevision === undefined || flow.revision === expectedRevision;
}

export async function pausePursueGoalFlow(params: {
  flowId: string;
  expectedRevision?: number;
}): Promise<PursueGoalMutationResult> {
  const now = Date.now();
  const result = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (!expectedRevisionMatches(flow, params.expectedRevision)) {
      return undefined;
    }
    if (isTerminalPhase(state) || state.phase === "paused" || state.phase === "blocked") {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...state,
      phase: "paused",
      lease: undefined,
      pauseRequestedAt: now,
      retryAt: undefined,
      nextAction: "Resume the goal when ready.",
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "goal",
      name: "goal.paused",
      actorId: "control-ui",
      summary: "User paused Pursue Goal execution.",
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "paused",
        currentStep: "Paused by user.",
        waitJson: null,
        endedAt: null,
        updatedAt: now,
      },
    };
  });
  if (result.applied && result.flow) {
    activeControllers.get(params.flowId)?.abortController.abort();
    await (await getControllerRuntime()).pauseWorkerGoal(stateForPursueGoalFlow(result.flow)!);
  }
  return result;
}

export async function resumePursueGoalFlow(params: {
  flowId: string;
  expectedRevision?: number;
}): Promise<PursueGoalMutationResult> {
  const now = Date.now();
  const result = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (!expectedRevisionMatches(flow, params.expectedRevision) || state.phase !== "paused") {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...state,
      phase: "queued",
      lease: undefined,
      pauseRequestedAt: undefined,
      retryAt: undefined,
      nextAction: "Acquire a controller lease and continue execution.",
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "goal",
      name: "goal.resumed",
      actorId: "control-ui",
      summary: "User resumed Pursue Goal execution.",
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "queued",
        currentStep: "Resume accepted; waiting for a controller lease.",
        blockedTaskId: null,
        blockedSummary: null,
        waitJson: null,
        endedAt: null,
        updatedAt: now,
      },
    };
  });
  if (result.applied && result.flow) {
    await (await getControllerRuntime()).resumeWorkerGoal(stateForPursueGoalFlow(result.flow)!);
    kickPursueGoalController(params.flowId);
  }
  return result;
}

export async function editPursueGoalFlow(params: {
  flowId: string;
  goal: string;
  expectedRevision?: number;
}): Promise<PursueGoalMutationResult> {
  const goal = params.goal.trim();
  if (!goal) {
    return { found: true, applied: false, reason: "Goal is required." };
  }
  if (goal.length > PURSUE_GOAL_MAX_CHARS) {
    return {
      found: true,
      applied: false,
      reason: `Goal must be at most ${PURSUE_GOAL_MAX_CHARS} characters.`,
    };
  }
  const now = Date.now();
  const wasActive = activeControllers.has(params.flowId);
  const result = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (
      !expectedRevisionMatches(flow, params.expectedRevision) ||
      isTerminalPhase(state) ||
      flow.goal === goal
    ) {
      return undefined;
    }
    const stayPaused = state.phase === "paused";
    const version = state.goalVersion + 1;
    let next: PursueGoalControllerState = {
      ...state,
      goalVersion: version,
      goalHistory: [...state.goalHistory, { version, goal, editedAt: now }].slice(-20),
      phase: stayPaused ? "paused" : "queued",
      lease: undefined,
      retryAt: undefined,
      lastError: undefined,
      consecutiveBlockers: 0,
      judgeReceipt: undefined,
      judgeExecution: undefined,
      nextAction: stayPaused
        ? "Resume the edited goal when ready."
        : "Acquire a new lease and execute the edited goal.",
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "goal",
      name: "goal.edited",
      actorId: "control-ui",
      summary: `Goal edited to version ${version}.`,
      at: now,
    });
    return {
      state: next,
      patch: {
        goal,
        status: stayPaused ? "paused" : "queued",
        currentStep: stayPaused
          ? "Edited while paused."
          : "Edited goal accepted; waiting for a controller lease.",
        blockedTaskId: null,
        blockedSummary: null,
        waitJson: null,
        endedAt: null,
        updatedAt: now,
      },
    };
  });
  if (result.applied && result.flow) {
    if (wasActive) {
      activeControllers.get(params.flowId)?.abortController.abort();
    }
    await (await getControllerRuntime()).editWorkerGoal(stateForPursueGoalFlow(result.flow)!, goal);
    if (stateForPursueGoalFlow(result.flow)?.phase !== "paused") {
      kickPursueGoalController(params.flowId);
    }
  }
  return result;
}

export async function retryPursueGoalFlow(params: {
  flowId: string;
  expectedRevision?: number;
}): Promise<PursueGoalMutationResult> {
  const current = getTaskFlowById(params.flowId);
  const currentState = current ? stateForPursueGoalFlow(current) : undefined;
  if (currentState?.judgeExecution) {
    return {
      found: true,
      applied: false,
      reason:
        "The prior Judge outcome is indeterminate and the same claim cannot be replayed automatically; edit the goal to create a new claim.",
      flow: current,
    };
  }
  const now = Date.now();
  const result = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (
      !expectedRevisionMatches(flow, params.expectedRevision) ||
      (state.phase !== "blocked" && state.phase !== "failed" && state.phase !== "waiting")
    ) {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...state,
      phase: "queued",
      lease: undefined,
      retryAt: undefined,
      lastError: undefined,
      consecutiveFailures: 0,
      consecutiveBlockers: 0,
      nextAction: "Acquire a controller lease and retry from durable mission state.",
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "goal",
      name: "goal.retrying",
      actorId: "control-ui",
      summary: "User requested a retry from the durable goal state.",
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "queued",
        currentStep: "Retry accepted; waiting for a controller lease.",
        blockedTaskId: null,
        blockedSummary: null,
        waitJson: null,
        endedAt: null,
        updatedAt: now,
      },
    };
  });
  if (result.applied && result.flow) {
    await (await getControllerRuntime()).resumeWorkerGoal(stateForPursueGoalFlow(result.flow)!);
    kickPursueGoalController(params.flowId);
  }
  return result;
}

export async function stopPursueGoalFlow(params: {
  flowId: string;
  expectedRevision?: number;
}): Promise<PursueGoalMutationResult> {
  const now = Date.now();
  const result = mutatePursueGoalFlow(params.flowId, (flow, state) => {
    if (!expectedRevisionMatches(flow, params.expectedRevision) || isTerminalPhase(state)) {
      return undefined;
    }
    let next: PursueGoalControllerState = {
      ...state,
      phase: "cancelled",
      lease: undefined,
      stopRequestedAt: now,
      retryAt: undefined,
      nextAction: undefined,
    };
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "goal",
      name: "goal.stopped",
      actorId: "control-ui",
      summary: "User stopped Pursue Goal execution.",
      at: now,
    });
    next = withPursueGoalEvent(next, {
      flowId: params.flowId,
      category: "run",
      name: "run.cancelled",
      actorId: controllerOwnerId,
      summary: "Controller cancellation is sticky; no new child work may start.",
      at: now,
    });
    return {
      state: next,
      patch: {
        status: "cancelled",
        cancelRequestedAt: now,
        currentStep: "Stopped by user.",
        blockedTaskId: null,
        blockedSummary: null,
        waitJson: null,
        endedAt: now,
        updatedAt: now,
      },
    };
  });
  if (result.applied && result.flow) {
    activeControllers.get(params.flowId)?.abortController.abort();
    await (await getControllerRuntime()).stopWorkerGoal(stateForPursueGoalFlow(result.flow)!);
  }
  return result;
}

export function getPursueGoalControllerDiagnostics(): {
  ownerId: string;
  activeFlowIds: string[];
  running: number;
  reconcileRunning: boolean;
} {
  const activeFlowIds = [...activeControllers.keys()].toSorted();
  return {
    ownerId: controllerOwnerId,
    activeFlowIds,
    running: activeFlowIds.length,
    reconcileRunning: Boolean(reconcileTimer),
  };
}

export function setPursueGoalControllerRuntimeForTests(runtime: PursueGoalControllerRuntime): void {
  configuredRuntime = runtime;
  defaultRuntimePromise = undefined;
}

export function setPursueGoalJudgeReceiptVerifierForTests(
  verifier: ((receipt: PursueGoalJudgeReceipt) => boolean) | undefined,
): void {
  judgeReceiptVerifier = verifier ?? ((receipt) => verifyJudgeReceipt(receipt));
}

export async function resetPursueGoalControllerForTests(): Promise<void> {
  await stopPursueGoalControllers();
  configuredRuntime = undefined;
  defaultRuntimePromise = undefined;
  controllersStopping = false;
  judgeReceiptVerifier = (receipt) => verifyJudgeReceipt(receipt);
}

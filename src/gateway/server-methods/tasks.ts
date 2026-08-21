// Task gateway methods expose detached task list/get/cancel operations with
// bounded public summaries over the runtime task registry and task-flow status.
import { createHash } from "node:crypto";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  type ExecutionStateSnapshot,
  formatValidationErrors,
  type TaskFlowDetail,
  type TaskFlowControlAction,
  type TaskSummary,
  type TasksListParams,
  validateTaskFlowsCancelParams,
  validateTaskFlowsControlParams,
  validateTaskFlowsCreateParams,
  validateTaskFlowsEditParams,
  validateTaskFlowsGetParams,
  validateTaskFlowsListParams,
  validateTaskFlowsPauseParams,
  validateTaskFlowsResumeParams,
  validateTaskFlowsRetryParams,
  validateTaskFlowsStopParams,
  validateTasksCancelParams,
  validateTasksGetParams,
  validateTasksListParams,
  validateExecutionStateGetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { resolveProgramManagerAgentId } from "../../agents/agent-scope-config.js";
import { buildControlDirectorRuntimeMemoryState } from "../../agents/control-director-memory-runtime.js";
import {
  buildControlDirectorRuntimeLineage,
  type ControlDirectorRuntimeLineage,
} from "../../agents/control-director-runtime-lineage.js";
import { readGatewayRuntimeSnapshotProvenance } from "../../daemon/gateway-runtime-snapshot.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { emitControlDirectorJourneySignal } from "../../self-improvement/control-director-journeys.js";
import { cancelDetachedTaskRunById } from "../../tasks/detached-task-runtime.js";
import {
  createPursueGoalControllerState,
  PURSUE_GOAL_CONTROLLER_ID,
  PURSUE_GOAL_MAX_CHARS,
  stateForPursueGoalFlow,
} from "../../tasks/pursue-goal-controller-state.js";
import {
  editPursueGoalFlow,
  kickPursueGoalController,
  pausePursueGoalFlow,
  resumePursueGoalFlow,
  retryPursueGoalFlow,
  stopPursueGoalFlow,
} from "../../tasks/pursue-goal-controller.js";
import { getTaskById, listTaskRecords, listTasksForFlowId } from "../../tasks/runtime-internal.js";
import { cancelFlowById } from "../../tasks/task-executor.js";
import type { TaskFlowRecord, TaskFlowStatus } from "../../tasks/task-flow-registry.types.js";
import {
  createManagedTaskFlow,
  deleteTaskFlowRecordById,
  getTaskFlowById,
  listTaskFlowRecords,
  listTaskFlowRecordsPage,
  updateFlowRecordByIdExpectedRevision,
} from "../../tasks/task-flow-runtime-internal.js";
import type { TaskRecord, TaskStatus } from "../../tasks/task-registry.types.js";
import { TASK_STATUS_DETAIL_MAX_CHARS, sanitizeTaskStatusText } from "../../tasks/task-status.js";
import { resolveRuntimeServiceVersion } from "../../version.js";
import {
  CHAT_TURN_INBOX_CONTROLLER_ID,
  isTerminalChatTurnPhase,
  listChatTurnFlows,
  mapChatTurnSummary,
  stateForChatTurn,
} from "../chat-turn-inbox-state.js";
import { mapTaskSummary, taskUpdatedAt } from "./task-summary.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEFAULT_TASKS_LIST_LIMIT = 100;
const MAX_TASKS_LIST_LIMIT = 500;
const DEFAULT_TASK_FLOWS_LIST_LIMIT = 50;
const MAX_TASK_FLOWS_LIST_LIMIT = 500;
const MAX_RUNTIME_LINEAGE_SIGNAL_AGENTS = 100;
const runtimeLineageSignalByAgent = new Map<string, string>();

type TaskLedgerStatus = TaskSummary["status"];

function maybeEmitControlDirectorRuntimeLineageSignal(
  lineage: ControlDirectorRuntimeLineage | undefined,
): boolean {
  if (!lineage) {
    return false;
  }
  if (lineage.status === "ready") {
    runtimeLineageSignalByAgent.delete(lineage.agentId);
    return false;
  }
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha: lineage.sourceSha ?? null,
        selectedModel: lineage.selectedModel ?? null,
        runtimeVersion: lineage.runtimeVersion,
        artifactHash: lineage.artifactHash ?? null,
        blockers: lineage.blockers,
      }),
    )
    .digest("hex");
  if (runtimeLineageSignalByAgent.get(lineage.agentId) === signature) {
    return false;
  }
  if (
    !runtimeLineageSignalByAgent.has(lineage.agentId) &&
    runtimeLineageSignalByAgent.size >= MAX_RUNTIME_LINEAGE_SIGNAL_AGENTS
  ) {
    const oldestAgentId = runtimeLineageSignalByAgent.keys().next().value;
    if (typeof oldestAgentId === "string") {
      runtimeLineageSignalByAgent.delete(oldestAgentId);
    }
  }
  runtimeLineageSignalByAgent.set(lineage.agentId, signature);
  emitControlDirectorJourneySignal({
    code: "runtime_lineage_mismatch",
    idempotencyKey: `${lineage.agentId}:${signature}`,
    summary: "Control Director managed runtime lineage is blocked or inconsistent.",
    observed: lineage.blockers.join("; ") || "Runtime lineage reported blocked without a reason.",
    occurredAt: lineage.checkedAt,
    evidenceRefs: [
      `runtime-lineage:${signature}`,
      ...(lineage.sourceSha ? [`source:${lineage.sourceSha}`] : []),
    ],
  });
  return true;
}

function resetRuntimeLineageSignalStateForTests(): void {
  runtimeLineageSignalByAgent.clear();
}

const LEDGER_STATUS_TO_TASK_STATUSES: Record<TaskLedgerStatus, TaskStatus[]> = {
  queued: ["queued"],
  running: ["running"],
  completed: ["succeeded"],
  failed: ["failed", "lost"],
  timed_out: ["timed_out"],
  cancelled: ["cancelled"],
};

function normalizeTaskStatusFilter(status: TasksListParams["status"]): Set<TaskStatus> | null {
  if (!status) {
    return null;
  }
  const statuses = Array.isArray(status) ? status : [status];
  return new Set(statuses.flatMap((value) => LEDGER_STATUS_TO_TASK_STATUSES[value] ?? []));
}

// Session filtering needs all ownership keys because detached child runs may be
// queried from the requester, child session, or owner/control-plane view.
function taskMatchesSession(task: TaskRecord, sessionKey: string | undefined): boolean {
  const normalized = normalizeOptionalString(sessionKey);
  if (!normalized) {
    return true;
  }
  return [task.requesterSessionKey, task.childSessionKey, task.ownerKey].some(
    (candidate) => normalizeOptionalString(candidate) === normalized,
  );
}

// Explicit `task.agentId` is authoritative: a task that records its own agent
// must not also match other agents through the session-key fallback. Only
// records that predate a direct `agentId` recover the owning agent from
// session-style keys instead of being hidden.
function taskMatchesAgent(task: TaskRecord, agentId: string | undefined): boolean {
  const normalized = normalizeOptionalString(agentId);
  if (!normalized) {
    return true;
  }
  const explicitAgentId = normalizeOptionalString(task.agentId);
  if (explicitAgentId) {
    return explicitAgentId === normalized;
  }
  return [task.requesterSessionKey, task.childSessionKey, task.ownerKey].some(
    (candidate) => parseAgentSessionKey(candidate)?.agentId === normalized,
  );
}

function flowMatchesOwner(
  flow: TaskFlowRecord,
  params: { ownerKey?: string; sessionKey?: string },
) {
  const ownerKey = normalizeOptionalString(params.ownerKey ?? params.sessionKey);
  if (!ownerKey) {
    return true;
  }
  return normalizeOptionalString(flow.ownerKey) === ownerKey;
}

function isPublicTaskFlow(flow: TaskFlowRecord | undefined): flow is TaskFlowRecord {
  return Boolean(flow && flow.controllerId !== CHAT_TURN_INBOX_CONTROLLER_ID);
}

function isPursueGoalTaskFlow(flow: TaskFlowRecord): boolean {
  return flow.controllerId === PURSUE_GOAL_CONTROLLER_ID && stateForPursueGoalFlow(flow) != null;
}

function isActiveTaskStatus(status: TaskRecord["status"]): boolean {
  return status === "queued" || status === "running";
}

function isTerminalTaskStatus(status: TaskRecord["status"]): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled" ||
    status === "lost"
  );
}

function summarizeTaskFlowTasks(tasks: TaskRecord[]): TaskFlowDetail["taskSummary"] {
  let active = 0;
  let terminal = 0;
  let failures = 0;
  for (const task of tasks) {
    if (isActiveTaskStatus(task.status)) {
      active += 1;
    }
    if (isTerminalTaskStatus(task.status)) {
      terminal += 1;
    }
    if (task.status === "failed" || task.status === "timed_out" || task.status === "lost") {
      failures += 1;
    }
  }
  return { total: tasks.length, active, terminal, failures };
}

export function mapTaskFlowDetail(flow: TaskFlowRecord): TaskFlowDetail {
  const tasks = listTasksForFlowId(flow.flowId);
  const controllerState = stateForPursueGoalFlow(flow);
  return {
    id: flow.flowId,
    flowId: flow.flowId,
    ownerKey: flow.ownerKey,
    revision: flow.revision,
    ...(flow.controllerId ? { controllerId: flow.controllerId } : {}),
    ...(flow.requesterOrigin ? { requesterOrigin: flow.requesterOrigin } : {}),
    status: flow.status,
    notifyPolicy: flow.notifyPolicy,
    goal: flow.goal,
    ...(flow.currentStep
      ? {
          currentStep: sanitizeTaskStatusText(flow.currentStep, {
            maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
          }),
        }
      : {}),
    ...(flow.blockedTaskId ? { blockedTaskId: flow.blockedTaskId } : {}),
    ...(flow.blockedSummary
      ? {
          blockedSummary: sanitizeTaskStatusText(flow.blockedSummary, {
            errorContext: true,
            maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
          }),
        }
      : {}),
    ...(controllerState
      ? {
          phase: controllerState.phase,
          missionId: controllerState.missionId,
          goalVersion: controllerState.goalVersion,
          workerAgentId: controllerState.workerAgentId,
          workerSessionKey: controllerState.workerSessionKey,
          turnCount: controllerState.turnCount,
          activationCount: controllerState.activationCount,
          consecutiveFailures: controllerState.consecutiveFailures,
          ...(controllerState.nextAction
            ? {
                nextAction: sanitizeTaskStatusText(controllerState.nextAction, {
                  maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
                }),
              }
            : {}),
          ...(controllerState.lastResult
            ? {
                lastResult: sanitizeTaskStatusText(controllerState.lastResult, {
                  maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
                }),
              }
            : {}),
          ...(controllerState.lastError
            ? {
                lastError: sanitizeTaskStatusText(controllerState.lastError, {
                  errorContext: true,
                  maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
                }),
              }
            : {}),
          ...(controllerState.retryAt !== undefined ? { retryAt: controllerState.retryAt } : {}),
          ...(controllerState.lease ? { lease: controllerState.lease } : {}),
          ...(controllerState.judgeReceipt ? { judgeReceipt: controllerState.judgeReceipt } : {}),
          events: controllerState.events.slice(-50).map((event) =>
            Object.assign({}, event, {
              summary: sanitizeTaskStatusText(event.summary, {
                maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
              }),
            }),
          ),
        }
      : {}),
    ...(flow.cancelRequestedAt !== undefined ? { cancelRequestedAt: flow.cancelRequestedAt } : {}),
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
    ...(flow.endedAt !== undefined ? { endedAt: flow.endedAt } : {}),
    tasks: tasks.slice(0, 50).map((task) => mapTaskSummary(task)),
    taskSummary: summarizeTaskFlowTasks(tasks),
  };
}

function isTerminalFlowStatus(status: TaskFlowStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled" || status === "lost"
  );
}

function buildExecutionStateSnapshot(params: {
  sessionKey: string;
  includeTerminal?: boolean;
  now?: number;
  runtimeLineage?: ExecutionStateSnapshot["runtimeLineage"];
  memoryHealth?: ExecutionStateSnapshot["memoryHealth"];
}): ExecutionStateSnapshot {
  const sessionKey = params.sessionKey.trim();
  const includeTerminal = params.includeTerminal === true;
  const now = params.now ?? Date.now();
  const taskRecords = listTaskRecords()
    .filter(
      (task) =>
        taskMatchesSession(task, sessionKey) &&
        (includeTerminal || isActiveTaskStatus(task.status)),
    )
    .toSorted((left, right) => taskUpdatedAt(right) - taskUpdatedAt(left))
    .slice(0, 500);
  const flowRecords = listTaskFlowRecords()
    .filter(
      (flow) =>
        isPublicTaskFlow(flow) &&
        flowMatchesOwner(flow, { sessionKey }) &&
        (includeTerminal || !isTerminalFlowStatus(flow.status)),
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 500);
  const turnRecords = listChatTurnFlows({ sessionKey, includeTerminal })
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 200);
  const turns = turnRecords
    .map((flow) => mapChatTurnSummary(flow))
    .filter((turn): turn is NonNullable<typeof turn> => turn !== null);
  const staleGoalCount = flowRecords.filter((flow) => {
    const state = stateForPursueGoalFlow(flow);
    return (
      state?.phase === "running" &&
      (!state.lease || state.lease.expiresAt <= now || now - state.lease.heartbeatAt > 30_000)
    );
  }).length;
  const orphanedTurnCount = turnRecords.filter((flow) => {
    const state = stateForChatTurn(flow);
    return Boolean(
      state &&
      !isTerminalChatTurnPhase(state.phase) &&
      state.phase !== "pending" &&
      now - state.updatedAt > 30_000,
    );
  }).length;
  const pendingDeliveryCount = turnRecords.filter(
    (flow) => stateForChatTurn(flow)?.phase === "admitted",
  ).length;
  const lostWorkerCount = flowRecords.filter((flow) => flow.status === "lost").length;
  const activeCount =
    taskRecords.filter((task) => isActiveTaskStatus(task.status)).length +
    flowRecords.filter((flow) => !isTerminalFlowStatus(flow.status)).length +
    turns.filter((turn) => !isTerminalChatTurnPhase(turn.phase)).length;
  const tasks = taskRecords.map((task) => mapTaskSummary(task));
  const flows = flowRecords.map((flow) => mapTaskFlowDetail(flow));
  const health = {
    activeCount,
    staleGoalCount,
    orphanedTurnCount,
    pendingDeliveryCount,
    lostWorkerCount,
    healthy:
      staleGoalCount === 0 &&
      orphanedTurnCount === 0 &&
      pendingDeliveryCount === 0 &&
      lostWorkerCount === 0,
  };
  // Lineage capture times prove freshness but are not execution-state content. Excluding
  // them keeps polling clients from seeing a false revision on every snapshot request.
  const runtimeLineageRevision = params.runtimeLineage
    ? {
        ...params.runtimeLineage,
        checkedAt: 0,
        ...(params.runtimeLineage.canary
          ? { canary: { ...params.runtimeLineage.canary, capturedAt: 0 } }
          : {}),
      }
    : undefined;
  const memoryHealthRevision = params.memoryHealth
    ? {
        ...params.memoryHealth,
        ...(params.memoryHealth.newestAgeMs === undefined ? {} : { newestAgeMs: 0 }),
      }
    : undefined;
  const revisionBody = JSON.stringify({
    schemaVersion: 1,
    sessionKey,
    tasks,
    flows,
    turns,
    health,
    memoryHealth: memoryHealthRevision,
    runtimeLineage: runtimeLineageRevision,
  });
  return {
    schemaVersion: 1,
    snapshotRevision: createHash("sha256").update(revisionBody).digest("hex"),
    generatedAt: now,
    sessionKey,
    tasks,
    flows,
    turns,
    health,
    ...(params.memoryHealth ? { memoryHealth: params.memoryHealth } : {}),
    ...(params.runtimeLineage ? { runtimeLineage: params.runtimeLineage } : {}),
  };
}

// Cursor strings are offsets, not opaque tokens; reject malformed values so a
// client cannot silently restart pagination at the first page.
function parseCursor(cursor: string | undefined): number | null {
  if (!cursor) {
    return 0;
  }
  if (!/^\d+$/.test(cursor.trim())) {
    return null;
  }
  const parsed = Number(cursor);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function taskFlowControlIsApplied(params: {
  action: TaskFlowControlAction;
  flow: TaskFlowRecord;
  goal?: string;
}): boolean {
  const state = stateForPursueGoalFlow(params.flow);
  switch (params.action) {
    case "pause":
      return params.flow.status === "paused" || state?.phase === "paused";
    case "resume":
      return Boolean(
        state &&
        state.phase !== "paused" &&
        !["blocked", "failed", "cancelled", "succeeded"].includes(state.phase),
      );
    case "retry":
      return Boolean(state && (state.phase === "queued" || state.phase === "running"));
    case "stop":
      return params.flow.status === "cancelled" || state?.phase === "cancelled";
    case "edit":
      return Boolean(params.goal && params.flow.goal.trim() === params.goal);
  }
  return params.action satisfies never;
}

async function controlPursueGoalFlow(params: {
  action: TaskFlowControlAction;
  flow: TaskFlowRecord;
  goal?: string;
  expectedRevision?: number;
}) {
  const mutation = {
    flowId: params.flow.flowId,
    ...(params.expectedRevision !== undefined ? { expectedRevision: params.expectedRevision } : {}),
  };
  switch (params.action) {
    case "pause":
      return await pausePursueGoalFlow(mutation);
    case "resume":
      return await resumePursueGoalFlow(mutation);
    case "retry":
      return await retryPursueGoalFlow(mutation);
    case "stop":
      return await stopPursueGoalFlow(mutation);
    case "edit":
      return await editPursueGoalFlow({ ...mutation, goal: params.goal ?? "" });
  }
  return params.action satisfies never;
}

// Control UI task methods expose the stable gateway protocol shape; helpers
// above keep runtime registry details out of the wire result.
export const tasksHandlers: GatewayRequestHandlers = {
  "executionState.get": ({ params, respond, context }) => {
    if (!validateExecutionStateGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid executionState.get params: ${formatValidationErrors(validateExecutionStateGetParams.errors)}`,
        ),
      );
      return;
    }
    const agentId = parseAgentSessionKey(params.sessionKey)?.agentId;
    const runtimeLineage = agentId
      ? buildControlDirectorRuntimeLineage({
          config: context.getRuntimeConfig(),
          agentId,
          runtimeVersion: resolveRuntimeServiceVersion(),
          provenance: readGatewayRuntimeSnapshotProvenance({ env: process.env }),
          expectedSourceSha: process.env.OPENCLAW_EXPECTED_SOURCE_SHA,
        })
      : undefined;
    const memoryHealth =
      agentId && runtimeLineage
        ? buildControlDirectorRuntimeMemoryState({
            sessionKey: params.sessionKey,
            agentId,
          }).health
        : undefined;
    maybeEmitControlDirectorRuntimeLineageSignal(runtimeLineage);
    respond(
      true,
      buildExecutionStateSnapshot({
        sessionKey: params.sessionKey,
        includeTerminal: params.includeTerminal,
        memoryHealth,
        runtimeLineage,
      }),
    );
  },
  "taskFlows.list": ({ params, respond }) => {
    if (!validateTaskFlowsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.list params: ${formatValidationErrors(validateTaskFlowsListParams.errors)}`,
        ),
      );
      return;
    }
    const cursor = parseCursor(params.cursor);
    if (cursor === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid taskFlows.list cursor"),
      );
      return;
    }
    const limit = Math.min(
      params.limit ?? DEFAULT_TASK_FLOWS_LIST_LIMIT,
      MAX_TASK_FLOWS_LIST_LIMIT,
    );
    const ownerKey = normalizeOptionalString(params.ownerKey ?? params.sessionKey);
    const statuses = params.status
      ? Array.isArray(params.status)
        ? params.status
        : [params.status]
      : undefined;
    const filtered = listTaskFlowRecordsPage({
      ...(ownerKey ? { ownerKey } : {}),
      ...(params.controllerId ? { controllerId: params.controllerId } : {}),
      excludeControllerId: CHAT_TURN_INBOX_CONTROLLER_ID,
      ...(statuses ? { statuses } : {}),
      offset: cursor,
      limit,
    });
    const nextOffset = cursor + filtered.flows.length;
    respond(true, {
      flows: filtered.flows.map((flow) => mapTaskFlowDetail(flow)),
      ...(nextOffset < filtered.total ? { nextCursor: String(nextOffset) } : {}),
    });
  },
  "taskFlows.get": ({ params, respond }) => {
    if (!validateTaskFlowsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.get params: ${formatValidationErrors(validateTaskFlowsGetParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task flow not found: ${params.flowId}`),
      );
      return;
    }
    respond(true, { flow: mapTaskFlowDetail(flow) });
  },
  "taskFlows.create": ({ params, respond, context }) => {
    if (!validateTaskFlowsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.create params: ${formatValidationErrors(validateTaskFlowsCreateParams.errors)}`,
        ),
      );
      return;
    }
    const sessionKey = params.sessionKey.trim();
    const goal = params.goal.trim();
    if (!sessionKey || !goal || goal.length > PURSUE_GOAL_MAX_CHARS) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `sessionKey and a goal of at most ${PURSUE_GOAL_MAX_CHARS} characters are required`,
        ),
      );
      return;
    }
    const idempotencyKey = normalizeOptionalString(params.idempotencyKey);
    if (idempotencyKey) {
      const existing = listTaskFlowRecordsPage({
        ownerKey: sessionKey,
        controllerId: PURSUE_GOAL_CONTROLLER_ID,
      }).flows.find((candidate) => {
        const state = stateForPursueGoalFlow(candidate);
        return candidate.ownerKey === sessionKey && state?.idempotencyKey === idempotencyKey;
      });
      if (existing) {
        respond(true, { flow: mapTaskFlowDetail(existing) });
        return;
      }
    }
    const ownerAgentId = parseAgentSessionKey(sessionKey)?.agentId;
    const workerAgentId = resolveProgramManagerAgentId(context.getRuntimeConfig(), ownerAgentId);
    const flow = createManagedTaskFlow({
      ownerKey: sessionKey,
      controllerId: PURSUE_GOAL_CONTROLLER_ID,
      requesterOrigin: { channel: "webchat", to: sessionKey },
      status: "queued",
      notifyPolicy: "silent",
      goal,
      currentStep:
        normalizeOptionalString(params.currentStep) ??
        "Goal accepted and waiting for a controller lease.",
    });
    if (!flow) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "task flow store is unavailable", { retryable: true }),
      );
      return;
    }
    const state = createPursueGoalControllerState({
      flowId: flow.flowId,
      goal,
      workerAgentId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    const initialized = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: { stateJson: structuredClone(state) },
    });
    if (!initialized.applied) {
      deleteTaskFlowRecordById(flow.flowId);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "goal controller state is unavailable", {
          retryable: true,
        }),
      );
      return;
    }
    kickPursueGoalController(flow.flowId);
    respond(true, {
      flow: mapTaskFlowDetail(getTaskFlowById(flow.flowId) ?? initialized.flow),
    });
  },
  "taskFlows.cancel": async ({ params, respond, context }) => {
    if (!validateTaskFlowsCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.cancel params: ${formatValidationErrors(validateTaskFlowsCancelParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, { found: false, cancelled: false, reason: "Flow not found." });
      return;
    }
    if (stateForPursueGoalFlow(flow)) {
      const result = await stopPursueGoalFlow({ flowId: flow.flowId });
      respond(true, {
        found: result.found,
        cancelled: result.applied || result.flow?.status === "cancelled",
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
      });
      return;
    }
    const result = await cancelFlowById({
      cfg: context.getRuntimeConfig(),
      flowId: flow.flowId,
    });
    respond(true, {
      found: result.found,
      cancelled: result.cancelled,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
    });
  },
  "taskFlows.pause": async ({ params, respond }) => {
    if (!validateTaskFlowsPauseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.pause params: ${formatValidationErrors(validateTaskFlowsPauseParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, { found: false, applied: false, reason: "Flow not found." });
      return;
    }
    if (!isPursueGoalTaskFlow(flow)) {
      respond(true, { found: true, applied: false, reason: "Flow is not a Pursue Goal." });
      return;
    }
    const result = await pausePursueGoalFlow({
      flowId: flow.flowId,
      ...(params.expectedRevision !== undefined
        ? { expectedRevision: params.expectedRevision }
        : {}),
    });
    respond(true, {
      ...result,
      ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
    });
  },
  "taskFlows.resume": async ({ params, respond }) => {
    if (!validateTaskFlowsResumeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.resume params: ${formatValidationErrors(validateTaskFlowsResumeParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, { found: false, applied: false, reason: "Flow not found." });
      return;
    }
    if (!isPursueGoalTaskFlow(flow)) {
      respond(true, { found: true, applied: false, reason: "Flow is not a Pursue Goal." });
      return;
    }
    const result = await resumePursueGoalFlow({
      flowId: flow.flowId,
      ...(params.expectedRevision !== undefined
        ? { expectedRevision: params.expectedRevision }
        : {}),
    });
    respond(true, {
      ...result,
      ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
    });
  },
  "taskFlows.edit": async ({ params, respond }) => {
    if (!validateTaskFlowsEditParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.edit params: ${formatValidationErrors(validateTaskFlowsEditParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, { found: false, applied: false, reason: "Flow not found." });
      return;
    }
    if (!isPursueGoalTaskFlow(flow)) {
      respond(true, { found: true, applied: false, reason: "Flow is not a Pursue Goal." });
      return;
    }
    const result = await editPursueGoalFlow({
      flowId: flow.flowId,
      goal: params.goal,
      ...(params.expectedRevision !== undefined
        ? { expectedRevision: params.expectedRevision }
        : {}),
    });
    respond(true, {
      ...result,
      ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
    });
  },
  "taskFlows.retry": async ({ params, respond }) => {
    if (!validateTaskFlowsRetryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.retry params: ${formatValidationErrors(validateTaskFlowsRetryParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, { found: false, applied: false, reason: "Flow not found." });
      return;
    }
    if (!isPursueGoalTaskFlow(flow)) {
      respond(true, { found: true, applied: false, reason: "Flow is not a Pursue Goal." });
      return;
    }
    const result = await retryPursueGoalFlow({
      flowId: flow.flowId,
      ...(params.expectedRevision !== undefined
        ? { expectedRevision: params.expectedRevision }
        : {}),
    });
    respond(true, {
      ...result,
      ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
    });
  },
  "taskFlows.stop": async ({ params, respond }) => {
    if (!validateTaskFlowsStopParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.stop params: ${formatValidationErrors(validateTaskFlowsStopParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, { found: false, applied: false, reason: "Flow not found." });
      return;
    }
    if (!isPursueGoalTaskFlow(flow)) {
      respond(true, { found: true, applied: false, reason: "Flow is not a Pursue Goal." });
      return;
    }
    const result = await stopPursueGoalFlow({
      flowId: flow.flowId,
      ...(params.expectedRevision !== undefined
        ? { expectedRevision: params.expectedRevision }
        : {}),
    });
    respond(true, {
      ...result,
      ...(result.flow ? { flow: mapTaskFlowDetail(result.flow) } : {}),
    });
  },
  "taskFlows.control": async ({ params, respond }) => {
    if (!validateTaskFlowsControlParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid taskFlows.control params: ${formatValidationErrors(validateTaskFlowsControlParams.errors)}`,
        ),
      );
      return;
    }
    const flow = getTaskFlowById(params.flowId);
    if (!isPublicTaskFlow(flow) || !flowMatchesOwner(flow, { sessionKey: params.sessionKey })) {
      respond(true, {
        found: false,
        applied: false,
        action: params.action,
        reason: "Flow not found.",
      });
      return;
    }
    if (!isPursueGoalTaskFlow(flow)) {
      respond(true, {
        found: true,
        applied: false,
        action: params.action,
        reason: "Flow is not a Pursue Goal.",
      });
      return;
    }
    const goal = params.action === "edit" ? (params.goal ?? "").trim() : undefined;
    if (params.action === "edit" && !goal) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "goal is required when editing a task flow"),
      );
      return;
    }
    if (goal && goal.length > PURSUE_GOAL_MAX_CHARS) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `goal must be at most ${PURSUE_GOAL_MAX_CHARS} characters`,
        ),
      );
      return;
    }
    if (taskFlowControlIsApplied({ action: params.action, flow, ...(goal ? { goal } : {}) })) {
      respond(true, {
        found: true,
        applied: true,
        action: params.action,
        flow: mapTaskFlowDetail(flow),
      });
      return;
    }
    if (params.expectedRevision !== undefined && flow.revision !== params.expectedRevision) {
      respond(true, {
        found: true,
        applied: false,
        action: params.action,
        reason: "revision_conflict",
        flow: mapTaskFlowDetail(flow),
      });
      return;
    }
    const result = await controlPursueGoalFlow({
      action: params.action,
      flow,
      ...(goal ? { goal } : {}),
      ...(params.expectedRevision !== undefined
        ? { expectedRevision: params.expectedRevision }
        : {}),
    });
    const latest = result.flow ?? getTaskFlowById(flow.flowId);
    const applied =
      result.applied ||
      Boolean(
        latest &&
        taskFlowControlIsApplied({
          action: params.action,
          flow: latest,
          ...(goal ? { goal } : {}),
        }),
      );
    respond(true, {
      found: result.found,
      applied,
      action: params.action,
      ...(!applied && result.reason ? { reason: result.reason } : {}),
      ...(latest ? { flow: mapTaskFlowDetail(latest) } : {}),
    });
  },
  "tasks.list": ({ params, respond }) => {
    if (!validateTasksListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.list params: ${formatValidationErrors(validateTasksListParams.errors)}`,
        ),
      );
      return;
    }
    const cursor = parseCursor(params.cursor);
    if (cursor === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid tasks.list cursor"),
      );
      return;
    }
    const statusFilter = normalizeTaskStatusFilter(params.status);
    const limit = Math.min(params.limit ?? DEFAULT_TASKS_LIST_LIMIT, MAX_TASKS_LIST_LIMIT);
    // The registry lists newest-created first; the ledger view pages by last
    // activity so an old long-running task that just finished still surfaces
    // on the first page instead of hiding behind newer-created records.
    const filtered = listTaskRecords()
      .filter((task) => {
        if (statusFilter && !statusFilter.has(task.status)) {
          return false;
        }
        return (
          taskMatchesAgent(task, params.agentId) && taskMatchesSession(task, params.sessionKey)
        );
      })
      .toSorted((left, right) => {
        const updatedDiff = taskUpdatedAt(right) - taskUpdatedAt(left);
        if (updatedDiff !== 0) {
          return updatedDiff;
        }
        return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
      });
    const page = filtered.slice(cursor, cursor + limit);
    const nextOffset = cursor + page.length;
    respond(true, {
      tasks: page.map((task) => mapTaskSummary(task)),
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    });
  },
  "tasks.get": ({ params, respond }) => {
    if (!validateTasksGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.get params: ${formatValidationErrors(validateTasksGetParams.errors)}`,
        ),
      );
      return;
    }
    const taskId = params.taskId;
    const task = getTaskById(taskId);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }
    respond(true, { task: mapTaskSummary(task) });
  },
  "tasks.cancel": async ({ params, respond, context }) => {
    if (!validateTasksCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.cancel params: ${formatValidationErrors(validateTasksCancelParams.errors)}`,
        ),
      );
      return;
    }
    const taskId = params.taskId;
    const reason = normalizeOptionalString(params.reason);
    const result = await cancelDetachedTaskRunById({
      cfg: context.getRuntimeConfig(),
      taskId,
      ...(reason ? { reason } : {}),
    });
    respond(true, {
      found: result.found,
      cancelled: result.cancelled,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.task ? { task: mapTaskSummary(result.task) } : {}),
    });
  },
};

export const testApi = {
  buildExecutionStateSnapshot,
  maybeEmitControlDirectorRuntimeLineageSignal,
  mapTaskSummary,
  resetRuntimeLineageSignalStateForTests,
};
export { testApi as __test };

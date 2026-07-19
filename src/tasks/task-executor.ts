// Executes task records through configured runtimes and updates registry state.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type {
  DetachedRunningTaskCreateParams,
  DetachedTaskCreateParams,
  DetachedTaskFinalizeParams,
} from "./detached-task-runtime-contract.js";
import { getRegisteredDetachedTaskLifecycleRuntime } from "./detached-task-runtime-state.js";
import {
  cancelTaskById,
  createTaskRecord,
  getTaskById,
  isParentFlowLinkError,
  linkTaskToFlowById,
  listTasksForFlowId,
  markTaskRunningByRunId,
  finalizeTaskRunByRunId as finalizeTaskRunByRunIdInRegistry,
  recordTaskProgressByRunId,
  setTaskRunDeliveryStatusByRunId,
} from "./runtime-internal.js";
import {
  isProvisionalSubagentKillTask,
  isTaskFlowCancellationPending,
} from "./task-cancellation-state.js";
import { getTaskFlowByIdForOwner } from "./task-flow-owner-access.js";
import type { TaskFlowRecord } from "./task-flow-registry.types.js";
import {
  createManagedTaskFlow,
  createTaskFlowForTask,
  deleteTaskFlowRecordById,
  getTaskFlowById,
  requestFlowCancel,
  updateFlowRecordByIdExpectedRevision,
} from "./task-flow-runtime-internal.js";
import { summarizeTaskRecords } from "./task-registry.summary.js";
import type {
  TaskDeliveryState,
  TaskDeliveryStatus,
  TaskNotifyPolicy,
  TaskRecord,
  TaskRegistrySummary,
  TaskRuntime,
  TaskStatus,
  TaskTerminalOutcome,
} from "./task-registry.types.js";

const log = createSubsystemLogger("tasks/executor");

// One-task flows give detached ACP/subagent runs a flow handle for status and retry surfaces.
function isOneTaskFlowEligible(task: TaskRecord): boolean {
  if (task.parentFlowId?.trim() || task.scopeKind !== "session") {
    return false;
  }
  if (task.deliveryStatus === "not_applicable") {
    return false;
  }
  return task.runtime === "acp" || task.runtime === "subagent";
}

function ensureSingleTaskFlow(params: {
  task: TaskRecord;
  requesterOrigin?: TaskDeliveryState["requesterOrigin"];
}): TaskRecord {
  if (!isOneTaskFlowEligible(params.task)) {
    return params.task;
  }
  try {
    const flow = createTaskFlowForTask({
      task: params.task,
      requesterOrigin: params.requesterOrigin,
    });
    if (!flow) {
      return params.task;
    }
    const linked = linkTaskToFlowById({
      taskId: params.task.taskId,
      flowId: flow.flowId,
    });
    if (!linked) {
      deleteTaskFlowRecordById(flow.flowId);
      return params.task;
    }
    if (linked.parentFlowId !== flow.flowId) {
      deleteTaskFlowRecordById(flow.flowId);
      return linked;
    }
    return linked;
  } catch (error) {
    log.warn("Failed to create one-task flow for detached run", {
      taskId: params.task.taskId,
      runId: params.task.runId,
      error,
    });
    return params.task;
  }
}

export function createQueuedTaskRun(params: DetachedTaskCreateParams): TaskRecord | null {
  const task = createTaskRecord({
    ...params,
    status: "queued",
  });
  if (!task) {
    return null;
  }
  return ensureSingleTaskFlow({
    task,
    requesterOrigin: params.requesterOrigin,
  });
}

export function getFlowTaskSummary(flowId: string): TaskRegistrySummary {
  return summarizeTaskRecords(listTasksForFlowId(flowId));
}

export function createRunningTaskRun(params: DetachedRunningTaskCreateParams): TaskRecord | null {
  const task = createTaskRecord({
    ...params,
    status: "running",
  });
  if (!task) {
    return null;
  }
  return ensureSingleTaskFlow({
    task,
    requesterOrigin: params.requesterOrigin,
  });
}

type RunTaskInFlowParams = {
  flowId: string;
  runtime: TaskRuntime;
  sourceId?: string;
  childSessionKey?: string;
  parentTaskId?: string;
  agentId?: string;
  runId?: string;
  label?: string;
  task: string;
  notifyPolicy?: TaskNotifyPolicy;
  deliveryStatus?: TaskDeliveryStatus;
  preferMetadata?: boolean;
  status?: "queued" | "running";
  startedAt?: number;
  lastEventAt?: number;
  progressSummary?: string | null;
};

export function startTaskRunByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  startedAt?: number;
  lastEventAt?: number;
  progressSummary?: string | null;
  eventSummary?: string | null;
}) {
  return markTaskRunningByRunId(params);
}

export function recordTaskRunProgressByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  lastEventAt?: number;
  progressSummary?: string | null;
  eventSummary?: string | null;
}) {
  return recordTaskProgressByRunId(params);
}

export function completeTaskRunByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  endedAt: number;
  lastEventAt?: number;
  progressSummary?: string | null;
  terminalSummary?: string | null;
  terminalOutcome?: TaskTerminalOutcome | null;
  suppressDelivery?: boolean;
}) {
  return finalizeTaskRunByRunId({
    ...params,
    status: "succeeded",
  });
}

export function finalizeTaskRunByRunId(params: DetachedTaskFinalizeParams) {
  return finalizeTaskRunByRunIdInRegistry(params);
}

export function failTaskRunByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  status?: Extract<TaskStatus, "failed" | "timed_out" | "cancelled">;
  endedAt: number;
  lastEventAt?: number;
  error?: string;
  progressSummary?: string | null;
  terminalSummary?: string | null;
  suppressDelivery?: boolean;
}) {
  return finalizeTaskRunByRunId({
    ...params,
    status: params.status ?? "failed",
  });
}

export function setDetachedTaskDeliveryStatusByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  deliveryStatus: TaskDeliveryStatus;
  error?: string;
}) {
  return setTaskRunDeliveryStatusByRunId(params);
}

type CancelFlowResult = {
  found: boolean;
  cancelled: boolean;
  reason?: string;
  flow?: TaskFlowRecord;
  tasks?: TaskRecord[];
};

export type TaskFlowControlAction = "pause" | "resume" | "retry" | "stop" | "edit";

export type ControlFlowResult = {
  found: boolean;
  applied: boolean;
  action: TaskFlowControlAction;
  reason?: string;
  flow?: TaskFlowRecord;
  replacedFlowId?: string;
};

type RunTaskInFlowResult = {
  found: boolean;
  created: boolean;
  reason?: string;
  flow?: TaskFlowRecord;
  task?: TaskRecord;
};

function isTerminalFlowStatus(status: TaskFlowRecord["status"]): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled" || status === "lost"
  );
}

type FlowOperatorPatch = Parameters<typeof updateFlowRecordByIdExpectedRevision>[0]["patch"];
type FlowOperatorPatchResult = Omit<ControlFlowResult, "action">;

function applyFlowOperatorPatch(params: {
  flowId: string;
  buildPatch: (flow: TaskFlowRecord) => FlowOperatorPatch | null;
}): FlowOperatorPatchResult {
  let current = getTaskFlowById(params.flowId);
  if (!current) {
    return { found: false, applied: false, reason: "Flow not found." };
  }
  if (current.syncMode !== "managed") {
    return {
      found: true,
      applied: false,
      reason: "Flow is not managed by an operator controller.",
      flow: current,
    };
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const patch = params.buildPatch(current);
    if (!patch) {
      return { found: true, applied: true, flow: current };
    }
    const updated = updateFlowRecordByIdExpectedRevision({
      flowId: current.flowId,
      expectedRevision: current.revision,
      patch,
    });
    if (updated.applied) {
      return { found: true, applied: true, flow: updated.flow };
    }
    if (updated.reason !== "revision_conflict" || !updated.current) {
      return {
        found: updated.reason !== "not_found",
        applied: false,
        reason:
          updated.reason === "persist_failed" ? "Flow persistence failed." : "Flow not found.",
        ...(updated.current ? { flow: updated.current } : {}),
      };
    }
    current = updated.current;
  }
  return {
    found: true,
    applied: false,
    reason: "Flow changed repeatedly; refresh and retry.",
    flow: current,
  };
}

function withControlAction(result: FlowOperatorPatchResult, action: TaskFlowControlAction) {
  return { ...result, action };
}

/**
 * Applies user-issued controls against the latest durable flow revision.
 * UI commands are idempotent and must not fail merely because a heartbeat updated the record.
 */
export async function controlFlowById(params: {
  cfg: OpenClawConfig;
  flowId: string;
  action: TaskFlowControlAction;
  goal?: string;
}): Promise<ControlFlowResult> {
  const current = getTaskFlowById(params.flowId);
  if (!current) {
    return { found: false, applied: false, action: params.action, reason: "Flow not found." };
  }
  if (current.syncMode !== "managed") {
    return {
      found: true,
      applied: false,
      action: params.action,
      reason: "Flow is not managed by an operator controller.",
      flow: current,
    };
  }

  if (params.action === "stop") {
    const stopped = await cancelFlowById({ cfg: params.cfg, flowId: current.flowId });
    const flow = stopped.flow ?? getTaskFlowById(current.flowId);
    const accepted =
      stopped.cancelled || flow?.status === "cancelled" || flow?.cancelRequestedAt != null;
    return {
      found: stopped.found,
      applied: accepted,
      action: params.action,
      ...(stopped.reason ? { reason: stopped.reason } : {}),
      ...(flow ? { flow } : {}),
    };
  }

  const retryNeedsReplacement =
    params.action === "retry" &&
    (isTerminalFlowStatus(current.status) || current.cancelRequestedAt != null);
  if (retryNeedsReplacement) {
    if (current.status === "succeeded") {
      return {
        found: true,
        applied: false,
        action: params.action,
        reason: "Completed goals do not need a retry.",
        flow: current,
      };
    }
    const replacement = createManagedTaskFlow({
      ownerKey: current.ownerKey,
      controllerId: current.controllerId ?? "core/operator-retry",
      requesterOrigin: current.requesterOrigin,
      status: "running",
      notifyPolicy: current.notifyPolicy,
      goal: current.goal,
      currentStep: "Retry ready from Chat.",
      stateJson: current.stateJson,
    });
    return replacement
      ? {
          found: true,
          applied: true,
          action: params.action,
          flow: replacement,
          replacedFlowId: current.flowId,
        }
      : {
          found: true,
          applied: false,
          action: params.action,
          reason: "Flow persistence failed.",
          flow: current,
        };
  }

  if (isTerminalFlowStatus(current.status) || current.cancelRequestedAt != null) {
    return {
      found: true,
      applied: false,
      action: params.action,
      reason: `Flow is already ${current.status}.`,
      flow: current,
    };
  }

  if (params.action === "edit") {
    const goal = params.goal?.trim();
    if (!goal) {
      return {
        found: true,
        applied: false,
        action: params.action,
        reason: "Goal text is required.",
        flow: current,
      };
    }
    return withControlAction(
      applyFlowOperatorPatch({
        flowId: current.flowId,
        buildPatch: (flow) => (flow.goal === goal ? null : { goal, updatedAt: Date.now() }),
      }),
      params.action,
    );
  }

  if (params.action === "resume" || params.action === "retry") {
    return withControlAction(
      applyFlowOperatorPatch({
        flowId: current.flowId,
        buildPatch: (flow) =>
          flow.status === "running" &&
          flow.cancelRequestedAt == null &&
          !flow.blockedTaskId &&
          !flow.blockedSummary
            ? null
            : {
                status: "running",
                currentStep:
                  params.action === "retry" ? "Retry ready from Chat." : "Ready to continue.",
                waitJson: null,
                blockedTaskId: null,
                blockedSummary: null,
                cancelRequestedAt: null,
                endedAt: null,
                updatedAt: Date.now(),
              },
      }),
      params.action,
    );
  }

  const paused = withControlAction(
    applyFlowOperatorPatch({
      flowId: current.flowId,
      buildPatch: (flow) =>
        flow.status === "paused"
          ? null
          : {
              status: "paused",
              currentStep: "Paused by user.",
              waitJson: { kind: "operator_pause", at: Date.now() },
              blockedTaskId: null,
              blockedSummary: null,
              endedAt: null,
              updatedAt: Date.now(),
            },
    }),
    params.action,
  );
  if (!paused.applied) {
    return paused;
  }
  const activeTasks = listTasksForFlowId(current.flowId).filter(isTaskFlowCancellationPending);
  for (const task of activeTasks) {
    await cancelDetachedTaskRunById({ cfg: params.cfg, taskId: task.taskId });
  }
  const remaining = listTasksForFlowId(current.flowId).filter(isTaskFlowCancellationPending);
  const flow = getTaskFlowById(current.flowId) ?? paused.flow;
  return {
    ...paused,
    ...(remaining.length > 0 ? { reason: "Paused; waiting for current work to stop." } : {}),
    ...(flow ? { flow } : {}),
  };
}

function markFlowCancelRequested(flow: TaskFlowRecord): TaskFlowRecord | FlowUpdateFailure {
  if (flow.cancelRequestedAt != null) {
    return flow;
  }
  const result = requestFlowCancel({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
  });
  if (result.applied) {
    return result.flow;
  }
  return {
    reason: describeFlowUpdateFailure(result.reason),
    flow: result.current ?? getTaskFlowById(flow.flowId),
  };
}

type FlowUpdateFailure = {
  reason: string;
  flow?: TaskFlowRecord;
};

function describeFlowUpdateFailure(
  reason: Exclude<ReturnType<typeof requestFlowCancel>, { applied: true }>["reason"],
): string {
  switch (reason) {
    case "revision_conflict":
      return "Flow changed while cancellation was in progress.";
    case "persist_failed":
      return "Flow persistence failed.";
    case "not_found":
      return "Flow not found.";
    default:
      return "Flow mutation failed.";
  }
}

function cancelManagedFlowAfterChildrenSettle(
  flow: TaskFlowRecord,
  endedAt: number,
): TaskFlowRecord | FlowUpdateFailure {
  const result = updateFlowRecordByIdExpectedRevision({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
    patch: {
      status: "cancelled",
      blockedTaskId: null,
      blockedSummary: null,
      waitJson: null,
      endedAt,
      updatedAt: endedAt,
    },
  });
  if (result.applied) {
    return result.flow;
  }
  return {
    reason: describeFlowUpdateFailure(result.reason),
    flow: result.current ?? getTaskFlowById(flow.flowId),
  };
}

function mapRunTaskInFlowCreateError(params: {
  error: unknown;
  flowId: string;
}): RunTaskInFlowResult {
  const flow = getTaskFlowById(params.flowId);
  if (isParentFlowLinkError(params.error)) {
    if (params.error.code === "cancel_requested") {
      return {
        found: true,
        created: false,
        reason: "Flow cancellation has already been requested.",
        ...(flow ? { flow } : {}),
      };
    }
    if (params.error.code === "terminal") {
      const terminalStatus = flow?.status ?? params.error.details?.status ?? "terminal";
      return {
        found: true,
        created: false,
        reason: `Flow is already ${terminalStatus}.`,
        ...(flow ? { flow } : {}),
      };
    }
    if (params.error.code === "parent_flow_not_found") {
      return {
        found: false,
        created: false,
        reason: "Flow not found.",
      };
    }
  }
  throw params.error;
}

export function runTaskInFlow(params: RunTaskInFlowParams): RunTaskInFlowResult {
  const flow = getTaskFlowById(params.flowId);
  if (!flow) {
    return {
      found: false,
      created: false,
      reason: "Flow not found.",
    };
  }
  if (flow.syncMode !== "managed") {
    return {
      found: true,
      created: false,
      reason: "Flow does not accept managed child tasks.",
      flow,
    };
  }
  if (flow.cancelRequestedAt != null) {
    return {
      found: true,
      created: false,
      reason: "Flow cancellation has already been requested.",
      flow,
    };
  }
  if (isTerminalFlowStatus(flow.status)) {
    return {
      found: true,
      created: false,
      reason: `Flow is already ${flow.status}.`,
      flow,
    };
  }
  if (flow.status === "paused") {
    return {
      found: true,
      created: false,
      reason: "Flow is paused. Resume it before starting more work.",
      flow,
    };
  }

  const common = {
    runtime: params.runtime,
    sourceId: params.sourceId,
    ownerKey: flow.ownerKey,
    scopeKind: "session" as const,
    requesterOrigin: flow.requesterOrigin,
    parentFlowId: flow.flowId,
    childSessionKey: params.childSessionKey,
    parentTaskId: params.parentTaskId,
    agentId: params.agentId,
    runId: params.runId,
    label: params.label,
    task: params.task,
    preferMetadata: params.preferMetadata,
    notifyPolicy: params.notifyPolicy,
    deliveryStatus: params.deliveryStatus ?? "pending",
  };
  let task: TaskRecord | null;
  try {
    task =
      params.status === "running"
        ? createRunningTaskRun({
            ...common,
            startedAt: params.startedAt,
            lastEventAt: params.lastEventAt,
            progressSummary: params.progressSummary,
          })
        : createQueuedTaskRun(common);
  } catch (error) {
    return mapRunTaskInFlowCreateError({
      error,
      flowId: flow.flowId,
    });
  }
  if (!task) {
    return {
      found: true,
      created: false,
      reason: "Task persistence failed.",
      flow: getTaskFlowById(flow.flowId) ?? flow,
    };
  }
  const registeredTask = getTaskById(task.taskId);
  if (!registeredTask) {
    return {
      found: true,
      created: false,
      reason: "Task persistence failed.",
      flow: getTaskFlowById(flow.flowId) ?? flow,
    };
  }

  return {
    found: true,
    created: true,
    flow: getTaskFlowById(flow.flowId) ?? flow,
    task: registeredTask,
  };
}

export function runTaskInFlowForOwner(
  params: RunTaskInFlowParams & { callerOwnerKey: string },
): RunTaskInFlowResult {
  const flow = getTaskFlowByIdForOwner({
    flowId: params.flowId,
    callerOwnerKey: params.callerOwnerKey,
  });
  if (!flow) {
    return {
      found: false,
      created: false,
      reason: "Flow not found.",
    };
  }
  return runTaskInFlow({
    flowId: flow.flowId,
    runtime: params.runtime,
    sourceId: params.sourceId,
    childSessionKey: params.childSessionKey,
    parentTaskId: params.parentTaskId,
    agentId: params.agentId,
    runId: params.runId,
    label: params.label,
    task: params.task,
    preferMetadata: params.preferMetadata,
    notifyPolicy: params.notifyPolicy,
    deliveryStatus: params.deliveryStatus,
    status: params.status,
    startedAt: params.startedAt,
    lastEventAt: params.lastEventAt,
    progressSummary: params.progressSummary,
  });
}

export async function cancelFlowById(params: {
  cfg: OpenClawConfig;
  flowId: string;
}): Promise<CancelFlowResult> {
  const flow = getTaskFlowById(params.flowId);
  if (!flow) {
    return {
      found: false,
      cancelled: false,
      reason: "Flow not found.",
    };
  }
  if (isTerminalFlowStatus(flow.status)) {
    const provisionalTasks = listTasksForFlowId(flow.flowId).filter(isProvisionalSubagentKillTask);
    if (flow.status === "cancelled" && provisionalTasks.length > 0) {
      for (const task of provisionalTasks) {
        await cancelDetachedTaskRunById({ cfg: params.cfg, taskId: task.taskId });
      }
      const tasks = listTasksForFlowId(flow.flowId);
      if (tasks.some(isProvisionalSubagentKillTask)) {
        return {
          found: true,
          cancelled: false,
          reason: "One or more child tasks remain provisionally cancelled.",
          flow: getTaskFlowById(flow.flowId) ?? flow,
          tasks,
        };
      }
      const refreshedFlow = getTaskFlowById(flow.flowId) ?? flow;
      return {
        found: true,
        cancelled: refreshedFlow.status === "cancelled",
        reason:
          refreshedFlow.status === "cancelled"
            ? undefined
            : `Flow is already ${refreshedFlow.status}.`,
        flow: refreshedFlow,
        tasks,
      };
    }
    return {
      found: true,
      cancelled: false,
      reason: `Flow is already ${flow.status}.`,
      flow,
      tasks: listTasksForFlowId(flow.flowId),
    };
  }
  const cancelRequestedFlow = markFlowCancelRequested(flow);
  if ("reason" in cancelRequestedFlow) {
    return {
      found: true,
      cancelled: false,
      reason: cancelRequestedFlow.reason,
      flow: cancelRequestedFlow.flow,
      tasks: listTasksForFlowId(flow.flowId),
    };
  }
  const linkedTasks = listTasksForFlowId(flow.flowId);
  const activeTasks = linkedTasks.filter(isTaskFlowCancellationPending);
  for (const task of activeTasks) {
    await cancelDetachedTaskRunById({
      cfg: params.cfg,
      taskId: task.taskId,
    });
  }
  const refreshedTasks = listTasksForFlowId(flow.flowId);
  const remainingActive = refreshedTasks.filter(isTaskFlowCancellationPending);
  if (remainingActive.length > 0) {
    return {
      found: true,
      cancelled: false,
      reason: "One or more child tasks are still active.",
      flow: getTaskFlowById(flow.flowId) ?? cancelRequestedFlow,
      tasks: refreshedTasks,
    };
  }
  const now = Date.now();
  const refreshedFlow = getTaskFlowById(flow.flowId) ?? cancelRequestedFlow;
  if (isTerminalFlowStatus(refreshedFlow.status)) {
    return {
      found: true,
      cancelled: refreshedFlow.status === "cancelled",
      reason:
        refreshedFlow.status === "cancelled"
          ? undefined
          : `Flow is already ${refreshedFlow.status}.`,
      flow: refreshedFlow,
      tasks: refreshedTasks,
    };
  }
  const updatedFlow = cancelManagedFlowAfterChildrenSettle(refreshedFlow, now);
  if ("reason" in updatedFlow) {
    return {
      found: true,
      cancelled: false,
      reason: updatedFlow.reason,
      flow: updatedFlow.flow,
      tasks: refreshedTasks,
    };
  }
  return {
    found: true,
    cancelled: true,
    flow: updatedFlow,
    tasks: refreshedTasks,
  };
}

export async function cancelFlowByIdForOwner(params: {
  cfg: OpenClawConfig;
  flowId: string;
  callerOwnerKey: string;
}): Promise<CancelFlowResult> {
  const flow = getTaskFlowByIdForOwner({
    flowId: params.flowId,
    callerOwnerKey: params.callerOwnerKey,
  });
  if (!flow) {
    return {
      found: false,
      cancelled: false,
      reason: "Flow not found.",
    };
  }
  return cancelFlowById({
    cfg: params.cfg,
    flowId: flow.flowId,
  });
}

export async function cancelDetachedTaskRunById(params: { cfg: OpenClawConfig; taskId: string }) {
  const task = getTaskById(params.taskId);
  if (!task) {
    return cancelTaskById(params);
  }
  const registeredRuntime = getRegisteredDetachedTaskLifecycleRuntime();
  if (registeredRuntime) {
    const cancelled = await registeredRuntime.cancelDetachedTaskRunById(params);
    if (cancelled.found) {
      return cancelled;
    }
  }
  return cancelTaskById(params);
}

import {
  emitTrustedDiagnosticEvent,
  type DiagnosticTaskIssueCode,
} from "../infra/diagnostic-events.js";
import { listTaskRecords } from "../tasks/runtime-internal.js";
import { listTaskFlowAuditFindings } from "../tasks/task-flow-registry.audit.js";
import {
  getTaskFlowRegistryRestoreFailure,
  listTaskFlowRecords,
} from "../tasks/task-flow-registry.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import { listTaskAuditFindings } from "../tasks/task-registry.audit.js";
import type { TaskRecord, TaskStatus } from "../tasks/task-registry.types.js";

const DEFAULT_RECONCILIATION_INTERVAL_MS = 60_000;
const DEFAULT_PENDING_DELIVERY_GRACE_MS = 60_000;
const DEFAULT_STALE_QUEUED_MS = 10 * 60_000;
const DEFAULT_STALE_RUNNING_MS = 30 * 60_000;
const DEFAULT_STALE_FLOW_MS = 30 * 60_000;

type IssueSeverity = "critical" | "high" | "medium" | "low";

export type SelfImprovementTaskIssue = {
  issueCode: DiagnosticTaskIssueCode;
  severity: IssueSeverity;
  scope: "task" | "flow";
  taskId?: string;
  flowId?: string;
  runId?: string;
  sessionKey?: string;
  runtime?: string;
  status?: string;
  deliveryStatus?: string;
  judgeStatus?: string;
  terminalOutcome?: string;
  ageMs?: number;
};

type ReconciliationSnapshot = {
  tasks: TaskRecord[];
  flows: TaskFlowRecord[];
  flowRestoreFailure?: string | null;
};

type TaskIssueReconciliationLog = {
  error: (message: string) => void;
};

type ExtendedTaskRecord = TaskRecord & {
  judgeStatus?: string;
  userVisible?: boolean;
};

function terminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled" ||
    status === "lost"
  );
}

function taskReferenceAt(task: TaskRecord): number {
  return task.lastEventAt ?? task.endedAt ?? task.startedAt ?? task.createdAt;
}

function taskIssue(params: {
  task: TaskRecord;
  issueCode: DiagnosticTaskIssueCode;
  severity: IssueSeverity;
  ageMs?: number;
}): SelfImprovementTaskIssue {
  const extended = params.task as ExtendedTaskRecord;
  return {
    issueCode: params.issueCode,
    severity: params.severity,
    scope: "task",
    taskId: params.task.taskId,
    ...(params.task.parentFlowId ? { flowId: params.task.parentFlowId } : {}),
    ...(params.task.runId ? { runId: params.task.runId } : {}),
    sessionKey: params.task.requesterSessionKey,
    runtime: params.task.runtime,
    status: params.task.status,
    deliveryStatus: params.task.deliveryStatus,
    ...(extended.judgeStatus ? { judgeStatus: extended.judgeStatus } : {}),
    ...(params.task.terminalOutcome ? { terminalOutcome: params.task.terminalOutcome } : {}),
    ...(typeof params.ageMs === "number" ? { ageMs: params.ageMs } : {}),
  };
}

function flowIssue(params: {
  flow: TaskFlowRecord;
  issueCode: DiagnosticTaskIssueCode;
  severity: IssueSeverity;
  runId?: string;
  ageMs?: number;
}): SelfImprovementTaskIssue {
  return {
    issueCode: params.issueCode,
    severity: params.severity,
    scope: "flow",
    flowId: params.flow.flowId,
    ...(params.runId ? { runId: params.runId } : {}),
    sessionKey: params.flow.ownerKey,
    status: params.flow.status,
    ...(typeof params.ageMs === "number" ? { ageMs: params.ageMs } : {}),
  };
}

function terminalFailureCode(status: TaskStatus): DiagnosticTaskIssueCode | undefined {
  switch (status) {
    case "failed":
      return "task_terminal_failed";
    case "timed_out":
      return "task_terminal_timed_out";
    case "cancelled":
      return "task_terminal_cancelled";
    case "lost":
      return "task_terminal_lost";
    default:
      return undefined;
  }
}

function flowFailureCode(status: TaskFlowRecord["status"]): DiagnosticTaskIssueCode | undefined {
  switch (status) {
    case "failed":
      return "flow_failed";
    case "cancelled":
      return "flow_cancelled";
    case "lost":
      return "flow_lost";
    default:
      return undefined;
  }
}

export function collectSelfImprovementTaskIssues(params: {
  tasks: TaskRecord[];
  flows: TaskFlowRecord[];
  flowRestoreFailure?: string | null;
  now?: number;
  pendingDeliveryGraceMs?: number;
  staleQueuedMs?: number;
  staleRunningMs?: number;
  staleFlowMs?: number;
}): SelfImprovementTaskIssue[] {
  const now = params.now ?? Date.now();
  const pendingDeliveryGraceMs = params.pendingDeliveryGraceMs ?? DEFAULT_PENDING_DELIVERY_GRACE_MS;
  const staleQueuedMs = params.staleQueuedMs ?? DEFAULT_STALE_QUEUED_MS;
  const staleRunningMs = params.staleRunningMs ?? DEFAULT_STALE_RUNNING_MS;
  const staleFlowMs = params.staleFlowMs ?? DEFAULT_STALE_FLOW_MS;
  const issues: SelfImprovementTaskIssue[] = [];
  const tasksByFlow = new Map<string, TaskRecord[]>();

  if (params.flowRestoreFailure) {
    issues.push({
      issueCode: "flow_restore_failed",
      severity: "critical",
      scope: "flow",
      status: "restore_failed",
    });
  }

  for (const task of params.tasks) {
    const extended = task as ExtendedTaskRecord;
    if (task.parentFlowId) {
      const linked = tasksByFlow.get(task.parentFlowId) ?? [];
      linked.push(task);
      tasksByFlow.set(task.parentFlowId, linked);
    }
    const ageMs = Math.max(0, now - taskReferenceAt(task));
    const failureCode = terminalFailureCode(task.status);
    if (failureCode) {
      issues.push(taskIssue({ task, issueCode: failureCode, severity: "high", ageMs }));
    }
    if (task.terminalOutcome === "blocked") {
      issues.push(taskIssue({ task, issueCode: "task_blocked", severity: "medium", ageMs }));
    }
    if (task.deliveryStatus === "failed") {
      issues.push(taskIssue({ task, issueCode: "task_delivery_failed", severity: "high", ageMs }));
    } else if (task.deliveryStatus === "parent_missing") {
      issues.push(
        taskIssue({
          task,
          issueCode: "task_delivery_parent_missing",
          severity: "high",
          ageMs,
        }),
      );
    }
    if (
      terminalTaskStatus(task.status) &&
      task.deliveryStatus === "pending" &&
      task.notifyPolicy !== "silent" &&
      ageMs >= pendingDeliveryGraceMs
    ) {
      issues.push(
        taskIssue({
          task,
          issueCode: "task_terminal_delivery_pending",
          severity: "high",
          ageMs,
        }),
      );
    }
    if (
      extended.userVisible === true &&
      task.status === "succeeded" &&
      extended.judgeStatus !== "approved"
    ) {
      issues.push(
        taskIssue({
          task,
          issueCode: "task_user_visible_completion_unapproved",
          severity: "high",
          ageMs,
        }),
      );
    }
    if (terminalTaskStatus(task.status) && !task.terminalSummary?.trim()) {
      issues.push(
        taskIssue({
          task,
          issueCode: "task_terminal_summary_missing",
          severity: "medium",
          ageMs,
        }),
      );
    }
    if (task.status === "queued" && ageMs >= staleQueuedMs) {
      issues.push(taskIssue({ task, issueCode: "task_stale_queued", severity: "medium", ageMs }));
    }
    if (task.status === "running" && ageMs >= staleRunningMs) {
      issues.push(taskIssue({ task, issueCode: "task_stale_running", severity: "high", ageMs }));
    }
  }

  for (const finding of listTaskAuditFindings({
    tasks: params.tasks,
    now,
    staleQueuedMs,
    staleRunningMs,
  })) {
    const issueCode =
      finding.code === "missing_cleanup"
        ? "task_missing_cleanup"
        : finding.code === "inconsistent_timestamps"
          ? "task_inconsistent_timestamps"
          : undefined;
    if (issueCode) {
      issues.push(
        taskIssue({
          task: finding.task,
          issueCode,
          severity: finding.severity === "error" ? "high" : "medium",
          ageMs: finding.ageMs,
        }),
      );
    }
  }

  for (const flow of params.flows) {
    const ageMs = Math.max(0, now - flow.updatedAt);
    const failureCode = flowFailureCode(flow.status);
    if (failureCode) {
      issues.push(flowIssue({ flow, issueCode: failureCode, severity: "high", ageMs }));
    } else if (flow.status === "blocked") {
      issues.push(flowIssue({ flow, issueCode: "flow_blocked", severity: "medium", ageMs }));
    }
    if (flow.status === "running" && ageMs >= staleFlowMs) {
      issues.push(flowIssue({ flow, issueCode: "flow_stale_running", severity: "high", ageMs }));
    }
    if (flow.status === "waiting" && ageMs >= staleFlowMs) {
      issues.push(flowIssue({ flow, issueCode: "flow_stale_waiting", severity: "medium", ageMs }));
    }
    if (flow.status === "succeeded") {
      const conflictingTask = (tasksByFlow.get(flow.flowId) ?? []).find(
        (task) => task.status !== "succeeded" || task.terminalOutcome === "blocked",
      );
      if (conflictingTask) {
        issues.push(
          flowIssue({
            flow,
            issueCode: "flow_task_status_mismatch",
            severity: "critical",
            runId: conflictingTask.runId,
            ageMs,
          }),
        );
      }
    }
  }

  for (const finding of listTaskFlowAuditFindings({
    flows: params.flows,
    tasks: params.tasks,
    now,
    staleRunningMs: staleFlowMs,
    staleWaitingMs: staleFlowMs,
    staleBlockedMs: staleFlowMs,
  })) {
    const issueCode: DiagnosticTaskIssueCode | undefined =
      finding.code === "restore_failed"
        ? "flow_restore_failed"
        : finding.code === "cancel_stuck"
          ? "flow_cancel_stuck"
          : finding.code === "missing_linked_tasks"
            ? "flow_missing_linked_tasks"
            : finding.code === "blocked_task_missing"
              ? "flow_blocked_task_missing"
              : finding.code === "inconsistent_timestamps"
                ? "flow_inconsistent_timestamps"
                : undefined;
    if (!issueCode) {
      continue;
    }
    if (issueCode === "flow_restore_failed" && params.flowRestoreFailure) {
      continue;
    }
    if (finding.flow) {
      issues.push(
        flowIssue({
          flow: finding.flow,
          issueCode,
          severity: finding.severity === "error" ? "high" : "medium",
          ageMs: finding.ageMs,
        }),
      );
    } else {
      issues.push({
        issueCode,
        severity: "critical",
        scope: "flow",
        status: "restore_failed",
      });
    }
  }

  return issues;
}

function issueIdentity(issue: SelfImprovementTaskIssue): string {
  return [issue.scope, issue.taskId ?? issue.flowId, issue.runId, issue.issueCode]
    .filter(Boolean)
    .join(":");
}

export function startSelfImprovementTaskIssueReconciliation(params?: {
  intervalMs?: number;
  pendingDeliveryGraceMs?: number;
  getSnapshot?: () => ReconciliationSnapshot;
  log?: TaskIssueReconciliationLog;
}): { scan: () => number; stop: () => void } {
  const seen = new Set<string>();
  let reconciliationFailureReported = false;
  const getSnapshot =
    params?.getSnapshot ??
    (() => ({
      tasks: listTaskRecords(),
      flows: listTaskFlowRecords(),
      flowRestoreFailure: getTaskFlowRegistryRestoreFailure(),
    }));
  const scan = () => {
    try {
      const snapshot = getSnapshot();
      const issues = collectSelfImprovementTaskIssues({
        ...snapshot,
        ...(params?.pendingDeliveryGraceMs !== undefined
          ? { pendingDeliveryGraceMs: params.pendingDeliveryGraceMs }
          : {}),
      });
      let emitted = 0;
      for (const issue of issues) {
        const identity = issueIdentity(issue);
        if (seen.has(identity)) {
          continue;
        }
        emitTrustedDiagnosticEvent({ type: "task.issue", ...issue });
        seen.add(identity);
        emitted += 1;
      }
      const activeIdentities = new Set(issues.map((issue) => issueIdentity(issue)));
      for (const identity of seen) {
        if (!activeIdentities.has(identity)) {
          seen.delete(identity);
        }
      }
      reconciliationFailureReported = false;
      return emitted;
    } catch (error) {
      params?.log?.error(`self-improvement task issue reconciliation failed: ${String(error)}`);
      if (!reconciliationFailureReported) {
        emitTrustedDiagnosticEvent({
          type: "task.issue",
          issueCode: "task_reconciliation_failed",
          severity: "critical",
          scope: "task",
          status: "reconciliation_failed",
        });
        reconciliationFailureReported = true;
      }
      return 0;
    }
  };
  scan();
  const timer = setInterval(scan, params?.intervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS);
  timer.unref?.();
  return {
    scan,
    stop: () => clearInterval(timer),
  };
}

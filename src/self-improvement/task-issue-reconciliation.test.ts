import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
  type DiagnosticEventPayload,
} from "../infra/diagnostic-events.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import {
  collectSelfImprovementTaskIssues,
  startSelfImprovementTaskIssueReconciliation,
} from "./task-issue-reconciliation.js";

const NOW = 1_800_000_000_000;

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "task-1",
    runtime: "cli",
    requesterSessionKey: "agent:main:codex:pattern-lab",
    ownerKey: "agent:main:codex:pattern-lab",
    scopeKind: "session",
    runId: "run-1",
    task: "Create a video",
    status: "succeeded",
    deliveryStatus: "delivered",
    notifyPolicy: "done_only",
    createdAt: NOW - 120_000,
    startedAt: NOW - 110_000,
    endedAt: NOW - 90_000,
    lastEventAt: NOW - 90_000,
    cleanupAfter: NOW + 60_000,
    terminalSummary: "Completed",
    ...overrides,
  };
}

function flow(overrides: Partial<TaskFlowRecord> = {}): TaskFlowRecord {
  return {
    flowId: "flow-1",
    syncMode: "managed",
    ownerKey: "agent:main:codex:pattern-lab",
    revision: 1,
    status: "succeeded",
    notifyPolicy: "done_only",
    goal: "Create a video",
    createdAt: NOW - 120_000,
    updatedAt: NOW - 90_000,
    endedAt: NOW - 90_000,
    ...overrides,
  };
}

describe("Self-Improvement task issue reconciliation", () => {
  beforeEach(() => resetDiagnosticEventsForTest());
  afterEach(() => resetDiagnosticEventsForTest());

  it("finds explicit failures and silent or pending terminal delivery states", () => {
    const issues = collectSelfImprovementTaskIssues({
      now: NOW,
      pendingDeliveryGraceMs: 60_000,
      tasks: [
        task({
          status: "cancelled",
          deliveryStatus: "pending",
          terminalSummary: undefined,
          userVisible: true,
          judgeStatus: "pending",
        }),
      ],
      flows: [],
    });

    expect(issues.map((issue) => issue.issueCode)).toEqual(
      expect.arrayContaining([
        "task_terminal_cancelled",
        "task_terminal_delivery_pending",
        "task_terminal_summary_missing",
      ]),
    );
  });

  it("reports user-visible false success and flow/task terminal disagreement", () => {
    const issues = collectSelfImprovementTaskIssues({
      now: NOW,
      tasks: [
        task({
          parentFlowId: "flow-1",
          userVisible: true,
          judgeStatus: "rejected",
          terminalOutcome: "blocked",
        }),
      ],
      flows: [flow()],
    });

    expect(issues.map((issue) => issue.issueCode)).toEqual(
      expect.arrayContaining([
        "task_blocked",
        "task_user_visible_completion_unapproved",
        "flow_task_status_mismatch",
      ]),
    );
    expect(issues.find((issue) => issue.issueCode === "flow_task_status_mismatch")?.severity).toBe(
      "critical",
    );
  });

  it("reports a task-flow registry restore failure even when no flow was restored", () => {
    const issues = collectSelfImprovementTaskIssues({
      now: NOW,
      tasks: [],
      flows: [],
      flowRestoreFailure: "corrupt snapshot details must not be emitted",
    });

    expect(issues).toEqual([
      {
        issueCode: "flow_restore_failed",
        severity: "critical",
        scope: "flow",
        status: "restore_failed",
      },
    ]);
  });

  it("forwards canonical task and flow audit gaps that do not have terminal errors", () => {
    const issues = collectSelfImprovementTaskIssues({
      now: NOW,
      tasks: [task({ cleanupAfter: undefined })],
      flows: [
        flow({
          flowId: "flow-cancel-stuck",
          status: "waiting",
          cancelRequestedAt: NOW - 6 * 60_000,
          updatedAt: NOW - 6 * 60_000,
          endedAt: undefined,
        }),
        flow({
          flowId: "flow-missing-blocked-task",
          status: "blocked",
          blockedTaskId: "missing-task",
          updatedAt: NOW - 60_000,
          endedAt: undefined,
        }),
      ],
    });

    expect(issues.map((issue) => issue.issueCode)).toEqual(
      expect.arrayContaining([
        "task_missing_cleanup",
        "flow_cancel_stuck",
        "flow_blocked_task_missing",
      ]),
    );
  });

  it("emits each unchanged issue once while continuing to scan", () => {
    const events: Array<Extract<DiagnosticEventPayload, { type: "task.issue" }>> = [];
    const unsubscribe = onInternalDiagnosticEvent((event) => {
      if (event.type === "task.issue") {
        events.push(event);
      }
    });
    const reconciliation = startSelfImprovementTaskIssueReconciliation({
      intervalMs: 60_000,
      getSnapshot: () => ({
        tasks: [task({ status: "failed" })],
        flows: [],
      }),
    });

    expect(reconciliation.scan()).toBe(0);
    reconciliation.stop();
    unsubscribe();
    expect(events.map((event) => event.issueCode)).toEqual(["task_terminal_failed"]);
    expect(events[0]?.severity).toBe("high");
  });

  it("reports an issue again when it resolves and later recurs", () => {
    const events: Array<Extract<DiagnosticEventPayload, { type: "task.issue" }>> = [];
    let status: TaskRecord["status"] = "failed";
    const unsubscribe = onInternalDiagnosticEvent((event) => {
      if (event.type === "task.issue") {
        events.push(event);
      }
    });
    const reconciliation = startSelfImprovementTaskIssueReconciliation({
      intervalMs: 60_000,
      getSnapshot: () => ({
        tasks: [task({ status })],
        flows: [],
      }),
    });

    expect(reconciliation.scan()).toBe(0);
    status = "succeeded";
    expect(reconciliation.scan()).toBe(0);
    status = "failed";
    expect(reconciliation.scan()).toBe(1);
    reconciliation.stop();
    unsubscribe();
    expect(events.map((event) => event.issueCode)).toEqual([
      "task_terminal_failed",
      "task_terminal_failed",
    ]);
  });

  it("reports reconciliation failures to SIG once until the scan recovers", () => {
    const events: Array<Extract<DiagnosticEventPayload, { type: "task.issue" }>> = [];
    let shouldFail = true;
    const unsubscribe = onInternalDiagnosticEvent((event) => {
      if (event.type === "task.issue") {
        events.push(event);
      }
    });
    const reconciliation = startSelfImprovementTaskIssueReconciliation({
      intervalMs: 60_000,
      getSnapshot: () => {
        if (shouldFail) {
          throw new Error("snapshot unavailable");
        }
        return { tasks: [], flows: [] };
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      issueCode: "task_reconciliation_failed",
      severity: "critical",
      scope: "task",
      status: "reconciliation_failed",
    });
    expect(reconciliation.scan()).toBe(0);

    shouldFail = false;
    expect(reconciliation.scan()).toBe(0);
    shouldFail = true;
    expect(reconciliation.scan()).toBe(0);
    expect(events.map((event) => event.issueCode)).toEqual([
      "task_reconciliation_failed",
      "task_reconciliation_failed",
    ]);

    reconciliation.stop();
    unsubscribe();
  });
});

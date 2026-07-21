import { describe, expect, it } from "vitest";
import {
  buildDeterministicOperationsBriefing,
  capOperationsRows,
  deriveOperationsAgentStates,
  OPERATIONS_RECENT_WORKFLOW_FAILURE_MS,
  OPERATIONS_WORKFLOW_HISTORY_RETENTION_MS,
  operationsCollectionCount,
  OPERATIONS_STALE_QUEUED_WORKFLOW_MS,
  operationsFindingSeverityForWorkflow,
  operationsStatusForFindings,
  operationsStatusForTask,
  operationsStatusForWorkflow,
  resetOperationsFindingHistoryForTests,
  scoreOperationsFindings,
  stampOperationsFindingHistory,
} from "./status.js";
import type { OperationsFinding } from "./types.js";

function finding(id: string, severity: OperationsFinding["severity"]): OperationsFinding {
  return {
    id,
    severity,
    category: "resource",
    title: id,
    detail: id,
    lastObservedAt: 1,
    disposition: severity === "info" ? "historical" : "watching",
    responseState: severity === "info" ? "resolved" : "monitoring",
    impact: id,
  };
}

describe("Operations Room status policy", () => {
  it("derives status and a deduplicated quality score", () => {
    expect(operationsStatusForFindings([])).toBe("healthy");
    expect(operationsStatusForFindings([finding("memory", "warning")])).toBe("degraded");
    expect(operationsStatusForFindings([finding("memory", "critical")])).toBe("blocked");
    expect(operationsStatusForFindings([], { partial: true })).toBe("unknown");
    expect(
      scoreOperationsFindings([
        finding("memory", "warning"),
        finding("memory", "warning"),
        finding("plugin", "critical"),
      ]),
    ).toBe(90);
  });

  it("reports exact collection totals independently from capped rows", () => {
    expect(operationsCollectionCount(200, 30)).toEqual({
      total: 200,
      shown: 30,
      truncated: true,
    });
    expect(operationsCollectionCount(2, 30)).toEqual({
      total: 2,
      shown: 2,
      truncated: false,
    });
  });

  it("keeps agent activity, health, and attention as independent facts", () => {
    expect(
      deriveOperationsAgentStates({
        duty: "on_demand",
        runningTaskCount: 1,
        queuedTaskCount: 0,
        blockedTaskCount: 0,
        recentFailureCount: 1,
      }),
    ).toEqual({
      activityState: "working",
      healthState: "degraded",
      attentionState: "watching",
    });
    expect(
      deriveOperationsAgentStates({
        duty: "scheduled",
        runningTaskCount: 0,
        queuedTaskCount: 0,
        blockedTaskCount: 0,
        recentFailureCount: 0,
      }),
    ).toEqual({
      activityState: "scheduled",
      healthState: "healthy",
      attentionState: "none",
    });
  });

  it("never describes a partial snapshot as healthy", () => {
    expect(
      buildDeterministicOperationsBriefing({
        partial: true,
        criticalFindings: 0,
        needsUserFindings: 0,
        handlingFindings: 0,
        watchingFindings: 0,
        workingAgents: 1,
        activeTasks: 1,
        activeWorkflows: 1,
      }),
    ).toEqual({
      tone: "unknown",
      text: "Operations data is partial; 1 agent is working, so verify incomplete sources before judging system health.",
    });
  });

  it("caps public rows without changing their order", () => {
    expect(capOperationsRows([1, 2, 3], 2)).toEqual([1, 2]);
    expect(capOperationsRows([1, 2, 3], -1)).toEqual([]);
  });

  it("maps task runtime truth without inferring success from text", () => {
    expect(operationsStatusForTask("queued")).toBe("idle");
    expect(operationsStatusForTask("running")).toBe("working");
    expect(operationsStatusForTask("succeeded")).toBe("healthy");
    expect(operationsStatusForTask("succeeded", "blocked")).toBe("blocked");
    expect(operationsStatusForTask("timed_out")).toBe("failed");
    expect(operationsStatusForTask("mystery")).toBe("unknown");
  });

  it("separates active workflow failures from historical outcomes and stale queue entries", () => {
    const now = 2 * OPERATIONS_WORKFLOW_HISTORY_RETENTION_MS;

    expect(operationsStatusForWorkflow("running", now, now)).toBe("working");
    expect(operationsStatusForWorkflow("queued", now - 1_000, now)).toBe("idle");
    expect(
      operationsStatusForWorkflow("queued", now - OPERATIONS_STALE_QUEUED_WORKFLOW_MS, now),
    ).toBe("degraded");
    expect(
      operationsFindingSeverityForWorkflow(
        "failed",
        now - OPERATIONS_RECENT_WORKFLOW_FAILURE_MS,
        now,
      ),
    ).toBe("critical");
    expect(
      operationsFindingSeverityForWorkflow(
        "failed",
        now - OPERATIONS_RECENT_WORKFLOW_FAILURE_MS - 1,
        now,
      ),
    ).toBe("info");
    expect(
      operationsFindingSeverityForWorkflow(
        "lost",
        now - OPERATIONS_WORKFLOW_HISTORY_RETENTION_MS,
        now,
      ),
    ).toBe("info");
    expect(
      operationsFindingSeverityForWorkflow(
        "failed",
        now - OPERATIONS_WORKFLOW_HISTORY_RETENTION_MS - 1,
        now,
      ),
    ).toBeNull();
    expect(operationsFindingSeverityForWorkflow("blocked", 0, now)).toBe("warning");
  });

  it("keeps first-observed time stable while a finding remains active", () => {
    resetOperationsFindingHistoryForTests();
    const initial = stampOperationsFindingHistory([finding("memory", "warning")], 100);
    const repeated = stampOperationsFindingHistory([finding("memory", "warning")], 200);

    expect(initial[0]).toMatchObject({ firstObservedAt: 100, lastObservedAt: 100 });
    expect(repeated[0]).toMatchObject({ firstObservedAt: 100, lastObservedAt: 200 });
  });
});

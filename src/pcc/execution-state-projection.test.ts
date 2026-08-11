import { describe, expect, it } from "vitest";
import type { ExecutionStateSnapshot } from "../../packages/gateway-protocol/src/schema/types.js";
import { buildPccExecutionRuntimeProjection } from "./execution-state-projection.js";

function snapshot(overrides: Partial<ExecutionStateSnapshot> = {}): ExecutionStateSnapshot {
  return {
    schemaVersion: 1,
    snapshotRevision: "revision-a",
    generatedAt: 10,
    sessionKey: "agent:main:project-a",
    tasks: [],
    flows: [],
    turns: [],
    health: {
      activeCount: 0,
      staleGoalCount: 0,
      orphanedTurnCount: 0,
      pendingDeliveryCount: 0,
      lostWorkerCount: 0,
      healthy: true,
    },
    ...overrides,
  };
}

describe("buildPccExecutionRuntimeProjection", () => {
  it("maps typed task, goal, and turn state into a read-only project view", () => {
    const projection = buildPccExecutionRuntimeProjection({
      projectId: "project-a",
      now: 100,
      snapshots: [
        snapshot({
          tasks: [{ id: "task-1", status: "running", progressSummary: "Building", updatedAt: 40 }],
          flows: [
            {
              id: "flow-record-1",
              flowId: "flow-1",
              ownerKey: "agent:main:project-a",
              revision: 1,
              status: "running",
              notifyPolicy: "state_changes",
              goal: "Ship proof",
              currentStep: "Testing",
              createdAt: 1,
              updatedAt: 50,
              tasks: [],
              taskSummary: { total: 0, active: 0, terminal: 0, failures: 0 },
            },
          ],
          turns: [
            {
              id: "turn-1",
              sessionKey: "agent:main:project-a",
              revision: 1,
              mode: "queue",
              phase: "admitted",
              message: "Continue",
              attachmentCount: 0,
              admissionOpen: false,
              activitySummary: "Still working",
              lastActivityAt: 60,
              createdAt: 1,
              updatedAt: 60,
            },
          ],
          health: {
            activeCount: 3,
            staleGoalCount: 0,
            orphanedTurnCount: 0,
            pendingDeliveryCount: 1,
            lostWorkerCount: 0,
            healthy: false,
          },
        }),
      ],
    });

    expect(projection).toMatchObject({
      schemaVersion: 1,
      projectId: "project-a",
      generatedAt: 100,
      activeCount: 3,
      healthy: false,
      issues: { pendingDeliveryCount: 1 },
    });
    expect(projection.items.map((item) => [item.kind, item.summary])).toEqual([
      ["turn", "Still working"],
      ["goal", "Testing"],
      ["task", "Building"],
    ]);
  });

  it("has no transcript input capable of changing PCC milestone status", () => {
    const projection = buildPccExecutionRuntimeProjection({
      projectId: "project-a",
      snapshots: [snapshot()],
      now: 100,
    });

    expect(projection).not.toHaveProperty("milestones");
    expect(JSON.stringify(projection)).not.toContain("complete this milestone");
  });
});

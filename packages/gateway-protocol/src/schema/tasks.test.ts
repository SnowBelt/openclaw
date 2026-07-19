import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ProtocolSchemas, validateTaskFlowsControlParams, type TaskFlowStatus } from "../index.js";
import { TaskFlowDetailSchema } from "./tasks.js";

const detail = {
  id: "flow-1",
  flowId: "flow-1",
  ownerKey: "agent:main:main",
  revision: 1,
  status: "running",
  notifyPolicy: "state_changes",
  goal: "Finish the requested work",
  createdAt: 1,
  updatedAt: 2,
  tasks: [],
  taskSummary: {
    total: 0,
    active: 0,
    terminal: 0,
    failures: 0,
  },
};

describe("TaskFlowDetailSchema", () => {
  it("accepts the combined summary and task-detail fields", () => {
    expect(Value.Check(TaskFlowDetailSchema, detail)).toBe(true);
  });

  it("stays closed after flattening the combined object", () => {
    expect(Value.Check(TaskFlowDetailSchema, { ...detail, unexpected: true })).toBe(false);
  });
});

describe("task flow control protocol", () => {
  it("accepts each operator action and rejects unknown actions", () => {
    for (const action of ["pause", "resume", "retry", "stop"] as const) {
      expect(
        validateTaskFlowsControlParams({
          flowId: "flow-1",
          action,
          expectedRevision: 2,
          idempotencyKey: `control-${action}`,
        }),
      ).toBe(true);
    }
    expect(
      validateTaskFlowsControlParams({ flowId: "flow-1", action: "edit", goal: "Updated" }),
    ).toBe(true);
    expect(validateTaskFlowsControlParams({ flowId: "flow-1", action: "invalid" })).toBe(false);
  });

  it("keeps paused as a first-class durable flow status", () => {
    const status: TaskFlowStatus = "paused";
    expect(status).toBe("paused");
    expect(ProtocolSchemas.TaskFlowStatus).toBeDefined();
    expect(ProtocolSchemas.TaskFlowsControlResult).toBeDefined();
  });
});

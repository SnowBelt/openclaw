import { describe, expect, it } from "vitest";
import { ProtocolSchemas, validateTaskFlowsControlParams, type TaskFlowStatus } from "../index.js";

describe("task flow control protocol", () => {
  it("accepts each operator action and rejects unknown actions", () => {
    for (const action of ["pause", "resume", "retry", "stop"] as const) {
      expect(validateTaskFlowsControlParams({ flowId: "flow-1", action })).toBe(true);
    }
    expect(
      validateTaskFlowsControlParams({
        flowId: "flow-1",
        sessionKey: "agent:main:main",
        action: "edit",
        goal: "Ship verified proof",
      }),
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

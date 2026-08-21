import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ProtocolSchemas, validateTaskFlowsControlParams, type TaskFlowStatus } from "../index.js";
import {
  PursueGoalJudgeReceiptSchema,
  TaskFlowDetailSchema,
  TaskFlowsCreateParamsSchema,
  TaskFlowsEditParamsSchema,
} from "./tasks.js";

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
  it("preserves a 16,000-character goal and rejects larger input", () => {
    expect(
      Value.Check(TaskFlowsCreateParamsSchema, {
        sessionKey: "main",
        goal: "g".repeat(16_000),
      }),
    ).toBe(true);
    expect(
      Value.Check(TaskFlowsCreateParamsSchema, {
        sessionKey: "main",
        goal: "g".repeat(16_001),
      }),
    ).toBe(false);
    expect(
      Value.Check(TaskFlowsEditParamsSchema, {
        flowId: "flow-1",
        goal: "g".repeat(16_000),
      }),
    ).toBe(true);
    expect(
      Value.Check(TaskFlowsEditParamsSchema, {
        flowId: "flow-1",
        goal: "g".repeat(16_001),
      }),
    ).toBe(false);
  });

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

describe("Judge receipt protocol", () => {
  it("keeps V1 readable and requires the V2 execution proof fields", () => {
    const common = {
      receiptId: "receipt-1",
      missionId: "mission-1",
      claimHash: "a".repeat(64),
      scope: "technical completion",
      evidenceSummary: "direct evidence",
      conditions: "none",
      judgeRunId: "judge-run-1",
      judgeAgentId: "judge",
      issuedAt: 1,
    };
    expect(
      Value.Check(PursueGoalJudgeReceiptSchema, {
        ...common,
        schemaVersion: 1,
        verdict: "APPROVE",
      }),
    ).toBe(true);
    expect(
      Value.Check(PursueGoalJudgeReceiptSchema, {
        ...common,
        claimHash: "legacy-non-sha-claim",
        schemaVersion: 1,
        verdict: "REJECT",
      }),
    ).toBe(true);
    expect(
      Value.Check(PursueGoalJudgeReceiptSchema, {
        ...common,
        schemaVersion: 2,
        verdict: "APPROVE",
        promptHash: "b".repeat(64),
        responseHash: "c".repeat(64),
        route: "hosted",
        modelVisibleTools: [],
        requestCount: 1,
        trustedEvidenceDigest: "d".repeat(64),
        trustedEvidenceIds: ["runtime.completion"],
      }),
    ).toBe(true);
    expect(
      Value.Check(PursueGoalJudgeReceiptSchema, {
        ...common,
        schemaVersion: 2,
        verdict: "APPROVE",
        promptHash: "b".repeat(64),
        responseHash: "c".repeat(64),
        route: "hosted",
        modelVisibleTools: [],
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  createPursueGoalControllerState,
  isPursueGoalLeaseCurrent,
  parsePursueGoalControllerState,
  withPursueGoalEvent,
} from "./pursue-goal-controller-state.js";

describe("Pursue Goal controller state", () => {
  it("creates and round-trips durable state", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-1",
      goal: "Finish the verified change",
      workerAgentId: "program-manager",
      now: 100,
      missionId: "mission-1",
      workerSessionId: "session-1",
    });

    expect(parsePursueGoalControllerState(state)).toEqual(state);
    expect(state.workerSessionKey).toBe("agent:program-manager:goal:flow-1");
    expect(state.phase).toBe("queued");
    expect(state.events[0]?.name).toBe("goal.created");
  });

  it("fails closed for foreign or malformed state", () => {
    expect(parsePursueGoalControllerState({ schemaVersion: 1, kind: "other" })).toBeUndefined();
  });

  it("reads V2 receipts while retaining the V1 state contract", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-v2",
      goal: "Verify the V2 receipt",
      workerAgentId: "program-manager",
      missionId: "mission-v2",
      workerSessionId: "session-v2",
      now: 100,
    });
    const parsed = parsePursueGoalControllerState({
      ...state,
      judgeReceipt: {
        schemaVersion: 2,
        receiptId: "receipt-v2",
        missionId: "mission-v2",
        claimHash: "claim-v2",
        verdict: "OUT_OF_SCOPE",
        scope: "technical completion only",
        evidenceSummary: "moral evaluation is outside scope",
        conditions: "resubmit a technical question",
        judgeRunId: "judge-v2",
        judgeAgentId: "judge",
        issuedAt: 100,
        promptHash: "prompt-hash",
        responseHash: "response-hash",
        route: "local",
        modelVisibleTools: [],
        requestCount: 1,
      },
    });
    expect(parsed?.judgeReceipt?.schemaVersion).toBe(2);
    expect(parsed?.judgeReceipt?.verdict).toBe("OUT_OF_SCOPE");
  });

  it("round-trips a bounded pending result handoff", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-pending",
      goal: "Recover without replaying the Judge",
      workerAgentId: "program-manager",
      missionId: "mission-pending",
      workerSessionId: "session-pending",
      now: 100,
    });
    const parsed = parsePursueGoalControllerState({
      ...state,
      pendingTurn: {
        runId: "run-pending",
        taskId: "task-pending",
        phase: "staged",
        result: {
          status: "complete",
          text: "The result is durable before task finalization.",
          evidenceSummary: "The handoff is claim-bound.",
        },
      },
    });
    expect(parsed?.pendingTurn).toMatchObject({
      runId: "run-pending",
      taskId: "task-pending",
      phase: "staged",
      result: { status: "complete" },
    });
    expect(
      parsePursueGoalControllerState({
        ...state,
        pendingTurn: {
          runId: "run-pending",
          taskId: "task-pending",
          phase: "staged",
          result: { status: "complete", text: "x".repeat(64_001) },
        },
      }),
    ).toBeUndefined();
  });

  it("appends typed events and validates a live lease", () => {
    let state = createPursueGoalControllerState({
      flowId: "flow-1",
      goal: "Finish",
      workerAgentId: "main",
      now: 100,
    });
    state = withPursueGoalEvent(
      {
        ...state,
        lease: {
          ownerId: "process-1",
          leaseId: "lease-1",
          acquiredAt: 100,
          heartbeatAt: 110,
          expiresAt: 200,
        },
      },
      {
        flowId: "flow-1",
        category: "activity",
        name: "activity.working",
        actorId: "process-1",
        summary: "Working.",
        at: 120,
      },
    );

    expect(state.events.at(-1)?.sequence).toBe(1);
    expect(
      isPursueGoalLeaseCurrent(state, { ownerId: "process-1", leaseId: "lease-1", now: 150 }),
    ).toBe(true);
    expect(
      isPursueGoalLeaseCurrent(state, { ownerId: "process-1", leaseId: "lease-1", now: 250 }),
    ).toBe(false);
  });
});

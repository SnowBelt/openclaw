import { describe, expect, it } from "vitest";
import {
  createPursueGoalControllerState,
  isPursueGoalLeaseCurrent,
  parsePursueGoalControllerState,
  PURSUE_GOAL_JUDGE_CLAIM_HISTORY_MAX_BYTES,
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
        claimHash: "a".repeat(64),
        verdict: "OUT_OF_SCOPE",
        scope: "technical completion only",
        evidenceSummary: "moral evaluation is outside scope",
        conditions: "resubmit a technical question",
        judgeRunId: "judge-v2",
        judgeAgentId: "judge",
        issuedAt: 100,
        promptHash: "b".repeat(64),
        responseHash: "c".repeat(64),
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

  it("persists the canonical trusted evidence packet and rejects corruption", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-evidence",
      goal: "Verify durable evidence",
      workerAgentId: "program-manager",
      now: 100,
    });
    const evidence = [
      {
        id: "runtime.completion",
        kind: "runtime_completion" as const,
        summary: "controller observed a complete result",
      },
      {
        id: "artifact.sha256",
        kind: "artifact_digest" as const,
        summary: "controller hashed the delivered artifact",
      },
    ];
    const parsed = parsePursueGoalControllerState({
      ...state,
      judgeTrustedEvidence: evidence,
      pendingTurn: {
        runId: "run-evidence",
        taskId: "task-evidence",
        phase: "staged",
        result: { status: "complete", text: "done", trustedEvidence: evidence },
      },
    });
    expect(parsed?.judgeTrustedEvidence).toEqual(evidence);
    expect(parsed?.pendingTurn?.result.trustedEvidence).toEqual(evidence);
    expect(
      parsePursueGoalControllerState({
        ...state,
        judgeTrustedEvidence: [{ id: "runtime.completion", kind: "unknown", summary: "x" }],
      }),
    ).toBeUndefined();
  });

  it("fails closed instead of dropping malformed claim history", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-claims",
      goal: "Keep claim fences",
      workerAgentId: "program-manager",
    });
    expect(
      parsePursueGoalControllerState({
        ...state,
        judgeClaims: [{ claimHash: "not-a-hash" }],
      }),
    ).toBeUndefined();
  });

  it("keeps append-only claim history usable beyond the old arbitrary count", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-claims-long-lived",
      goal: "Keep accepting new verified edits",
      workerAgentId: "program-manager",
    });
    const claims = Array.from({ length: 40 }, (_, index) => ({
      claimHash: index.toString(16).padStart(64, "0"),
      promptHash: (index + 1).toString(16).padStart(64, "0"),
      runId: `run-${index}`,
      taskId: `task-${index}`,
      status: "settled" as const,
      receiptId: `receipt-${index}`,
      recordedAt: index + 1,
    }));
    const parsed = parsePursueGoalControllerState({ ...state, judgeClaims: claims });
    expect(parsed?.judgeClaims).toHaveLength(40);
    expect(JSON.stringify(claims).length).toBeLessThan(PURSUE_GOAL_JUDGE_CLAIM_HISTORY_MAX_BYTES);
  });

  it("round-trips only a hash-bound durable Judge execution fence", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-judge-fence",
      goal: "Prevent duplicate Judge execution",
      workerAgentId: "program-manager",
      now: 100,
    });
    const parsed = parsePursueGoalControllerState({
      ...state,
      judgeExecution: {
        runId: "run-judge-fence",
        taskId: "task-judge-fence",
        claimHash: "a".repeat(64),
        promptHash: "b".repeat(64),
        reservedAt: 101,
      },
    });
    expect(parsed?.judgeExecution).toMatchObject({
      claimHash: "a".repeat(64),
      promptHash: "b".repeat(64),
    });
    expect(
      parsePursueGoalControllerState({
        ...state,
        judgeExecution: {
          runId: "run-judge-fence",
          taskId: "task-judge-fence",
          claimHash: "not-a-hash",
          promptHash: "b".repeat(64),
          reservedAt: 101,
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

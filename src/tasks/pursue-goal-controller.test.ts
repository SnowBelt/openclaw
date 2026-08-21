import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildControlDirectorJudgeClaimHash } from "../agents/control-director-contract.js";
import { resetHeartbeatWakeStateForTests } from "../infra/heartbeat-wake.js";
import {
  consumeSelectedSystemEventEntries,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "../infra/system-events.js";
import {
  createPursueGoalControllerState,
  PURSUE_GOAL_CONTROLLER_ID,
  stateForPursueGoalFlow,
  type PursueGoalJudgeReceipt,
} from "./pursue-goal-controller-state.js";
import {
  editPursueGoalFlow,
  kickPursueGoalController,
  pausePursueGoalFlow,
  reconcilePursueGoalControllers,
  resetPursueGoalControllerForTests,
  retryPursueGoalFlow,
  setPursueGoalControllerRuntimeForTests,
  setPursueGoalJudgeReceiptVerifierForTests,
  startPursueGoalControllers,
  stopPursueGoalFlow,
  type PursueGoalControllerRuntime,
} from "./pursue-goal-controller.js";
import {
  createManagedTaskFlow,
  getTaskFlowById,
  resetTaskFlowRegistryForTests,
  updateFlowRecordByIdExpectedRevision,
} from "./task-flow-registry.js";
import { configureTaskFlowRegistryRuntime } from "./task-flow-registry.store.js";

const taskMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  nextTaskId: 0,
}));

vi.mock("./task-executor.js", () => ({
  completeTaskRunByRunId: (...args: unknown[]) => taskMocks.complete(...args),
  failTaskRunByRunId: (...args: unknown[]) => taskMocks.fail(...args),
  runTaskInFlow: () => {
    taskMocks.nextTaskId += 1;
    return {
      found: true,
      created: true,
      task: { taskId: `task-${taskMocks.nextTaskId}` },
    };
  },
}));

function approvedReceipt(params: {
  missionId: string;
  goal: string;
  text: string;
  evidenceSummary?: string;
}): PursueGoalJudgeReceipt {
  const evidenceSummary = params.evidenceSummary ?? params.text;
  return {
    schemaVersion: 1,
    receiptId: "receipt-1",
    missionId: params.missionId,
    claimHash: buildControlDirectorJudgeClaimHash({
      missionId: params.missionId,
      requestBody: params.goal,
      finalText: params.text,
      evidenceSummary,
    }),
    verdict: "APPROVE",
    scope: "exact goal",
    evidenceSummary,
    conditions: "none",
    judgeRunId: "judge-run-1",
    judgeAgentId: "judge",
    issuedAt: Date.now(),
    signature: "signature",
    publicKeyId: "key-1",
  };
}

function approvedV2Receipt(params: {
  missionId: string;
  goal: string;
  text: string;
  modelVisibleTools?: string[];
}): PursueGoalJudgeReceipt {
  const evidenceSummary = params.text;
  return {
    schemaVersion: 2,
    receiptId: "receipt-v2",
    missionId: params.missionId,
    claimHash: buildControlDirectorJudgeClaimHash({
      missionId: params.missionId,
      requestBody: params.goal,
      finalText: params.text,
      evidenceSummary,
    }),
    verdict: "APPROVE",
    scope: "exact goal",
    evidenceSummary,
    conditions: "none",
    judgeRunId: "judge-run-v2",
    judgeAgentId: "judge",
    model: "ollama/qwen3.8:27b-q8_0",
    issuedAt: Date.now(),
    promptHash: "prompt-hash",
    responseHash: "response-hash",
    route: "local",
    modelVisibleTools: params.modelVisibleTools ?? [],
    requestCount: 1,
    signature: "signature",
    publicKeyId: "key-1",
  };
}

function createGoalFlow(goal = "Ship verified work") {
  const flow = createManagedTaskFlow({
    ownerKey: "agent:main:dashboard:test",
    controllerId: PURSUE_GOAL_CONTROLLER_ID,
    requesterOrigin: { channel: "webchat", to: "agent:main:dashboard:test" },
    status: "queued",
    notifyPolicy: "silent",
    goal,
  });
  if (!flow) {
    throw new Error("Expected flow creation to succeed.");
  }
  const state = createPursueGoalControllerState({
    flowId: flow.flowId,
    goal,
    workerAgentId: "program-manager",
  });
  const updated = updateFlowRecordByIdExpectedRevision({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
    patch: { stateJson: structuredClone(state) },
  });
  if (!updated.applied) {
    throw new Error("Expected flow state creation to succeed.");
  }
  return updated.flow;
}

async function waitForFlow(
  flowId: string,
  predicate: (flow: NonNullable<ReturnType<typeof getTaskFlowById>>) => boolean,
) {
  await vi.waitFor(
    () => {
      const flow = getTaskFlowById(flowId);
      expect(flow && predicate(flow)).toBe(true);
    },
    { timeout: 2_000, interval: 5 },
  );
  return getTaskFlowById(flowId)!;
}

function baseRuntime(runTurn: PursueGoalControllerRuntime["runTurn"]): PursueGoalControllerRuntime {
  return {
    runTurn: vi.fn(runTurn),
    pauseWorkerGoal: vi.fn(async () => {}),
    resumeWorkerGoal: vi.fn(async () => {}),
    stopWorkerGoal: vi.fn(async () => {}),
    editWorkerGoal: vi.fn(async () => {}),
  };
}

describe("Pursue Goal controller", () => {
  beforeEach(async () => {
    await resetPursueGoalControllerForTests();
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => ({ flows: new Map() }),
        saveSnapshot: () => {},
        upsertFlow: () => {},
      },
    });
    resetSystemEventsForTest();
    resetHeartbeatWakeStateForTests();
    taskMocks.complete.mockClear();
    taskMocks.fail.mockClear();
    taskMocks.nextTaskId = 0;
    setPursueGoalJudgeReceiptVerifierForTests(() => true);
  });

  afterEach(async () => {
    await resetPursueGoalControllerForTests();
    resetTaskFlowRegistryForTests({ persist: false });
    resetSystemEventsForTest();
    resetHeartbeatWakeStateForTests();
  });

  it("runs under a live lease and completes only with an independent approval receipt", async () => {
    const flow = createGoalFlow();
    const missionId = stateForPursueGoalFlow(flow)!.missionId;
    const runtime = baseRuntime(async () => ({
      status: "complete",
      text: "Implemented and verified.",
      evidenceSummary: "Tests passed.",
      judgeReceipt: approvedReceipt({
        missionId,
        goal: flow.goal,
        text: "Implemented and verified.",
        evidenceSummary: "Tests passed.",
      }),
    }));
    setPursueGoalControllerRuntimeForTests(runtime);

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const completed = await waitForFlow(
      flow.flowId,
      (candidate) => candidate.status === "succeeded",
    );
    const state = stateForPursueGoalFlow(completed)!;

    expect(state.phase).toBe("succeeded");
    expect(state.lease).toBeUndefined();
    expect(state.judgeReceipt?.verdict).toBe("APPROVE");
    expect(state.terminalDeliveryState).toBe("queued");
    expect(state.terminalQueuedAt).toEqual(expect.any(Number));
    expect(state.terminalDeliveredAt).toBeUndefined();
    expect(runtime.runTurn).toHaveBeenCalledTimes(1);
    expect(taskMocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ terminalOutcome: "succeeded", suppressDelivery: true }),
    );

    startPursueGoalControllers();
    const queued = peekSystemEventEntries(completed.ownerKey);
    expect(queued).toHaveLength(1);
    expect(consumeSelectedSystemEventEntries(completed.ownerKey, queued)).toHaveLength(1);
    const consumed = stateForPursueGoalFlow(getTaskFlowById(flow.flowId)!)!;
    expect(consumed.terminalDeliveryState).toBe("consumed");
    expect(consumed.terminalConsumedAt).toEqual(expect.any(Number));
    expect(consumed.terminalDeliveredAt).toBe(consumed.terminalConsumedAt);
    expect(consumed.events.at(-1)).toMatchObject({ name: "notification.delivered" });
  });

  it("keeps a worker-reported blocker provisional until repeated confirmation", async () => {
    const flow = createGoalFlow("Finish instead of stopping at an unrun Judge");
    const missionId = stateForPursueGoalFlow(flow)!.missionId;
    const runtime = baseRuntime(async ({ state }) =>
      state.consecutiveBlockers < 2
        ? {
            status: "active" as const,
            text: "Waiting for a Judge receipt.",
            provisionalBlocker: "Waiting for a Judge receipt.",
          }
        : {
            status: "complete" as const,
            text: "Implemented and verified after retry.",
            evidenceSummary: "Controller retried the premature blocker.",
            judgeReceipt: approvedReceipt({
              missionId,
              goal: flow.goal,
              text: "Implemented and verified after retry.",
              evidenceSummary: "Controller retried the premature blocker.",
            }),
          },
    );
    setPursueGoalControllerRuntimeForTests(runtime);

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const completed = await waitForFlow(
      flow.flowId,
      (candidate) => candidate.status === "succeeded",
    );
    const state = stateForPursueGoalFlow(completed)!;

    expect(runtime.runTurn).toHaveBeenCalledTimes(3);
    expect(state.phase).toBe("succeeded");
    expect(state.consecutiveBlockers).toBe(0);
    expect(state.events.filter((event) => event.name === "activity.waiting")).toHaveLength(2);
    expect(state.events.some((event) => event.name === "goal.blocked")).toBe(false);
  });

  it("accepts a terminal blocker only after the typed evidence reaches confirmation", async () => {
    const flow = createGoalFlow("Stop only for a persistent external blocker");
    const blocker = "Required operator approval is unavailable.";
    const runtime = baseRuntime(async ({ state }) =>
      state.consecutiveBlockers < 2
        ? {
            status: "active" as const,
            text: blocker,
            provisionalBlocker: blocker,
          }
        : { status: "blocked" as const, text: blocker, blocker },
    );
    setPursueGoalControllerRuntimeForTests(runtime);

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const blocked = await waitForFlow(flow.flowId, (candidate) => candidate.status === "blocked");
    const state = stateForPursueGoalFlow(blocked)!;

    expect(runtime.runTurn).toHaveBeenCalledTimes(3);
    expect(state.phase).toBe("blocked");
    expect(state.consecutiveBlockers).toBe(3);
    expect(blocked.blockedSummary).toBe(blocker);
    expect(state.events.some((event) => event.name === "goal.blocked")).toBe(true);
  });

  it("blocks an unbound or cryptographically invalid completion receipt", async () => {
    const flow = createGoalFlow();
    const state = stateForPursueGoalFlow(flow)!;
    const receipt = approvedReceipt({
      missionId: state.missionId,
      goal: flow.goal,
      text: "Claimed complete.",
      evidenceSummary: "Claimed evidence.",
    });
    setPursueGoalJudgeReceiptVerifierForTests(() => false);
    setPursueGoalControllerRuntimeForTests(
      baseRuntime(async () => ({
        status: "complete",
        text: "Claimed complete.",
        evidenceSummary: "Claimed evidence.",
        judgeReceipt: receipt,
      })),
    );

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const blocked = await waitForFlow(flow.flowId, (candidate) => candidate.status === "blocked");
    const blockedState = stateForPursueGoalFlow(blocked)!;
    expect(blockedState.phase).toBe("blocked");
    expect(blockedState.lastError).toContain("Completion was rejected");
    expect(blockedState.lastError).toContain("unsupported");
    expect(blockedState.events.at(-1)).toMatchObject({
      category: "notification",
      name: "notification.queued",
    });
    expect(taskMocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ terminalOutcome: "succeeded", suppressDelivery: true }),
    );
  });

  it("rejects a stale Judge receipt even when its signature verifier passes", async () => {
    const flow = createGoalFlow();
    const state = stateForPursueGoalFlow(flow)!;
    const receipt = approvedReceipt({
      missionId: state.missionId,
      goal: flow.goal,
      text: "Claimed complete with old evidence.",
    });
    receipt.issuedAt = Date.now() - 300_001;
    setPursueGoalControllerRuntimeForTests(
      baseRuntime(async () => ({
        status: "complete",
        text: "Claimed complete with old evidence.",
        judgeReceipt: receipt,
      })),
    );

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const blocked = await waitForFlow(flow.flowId, (candidate) => candidate.status === "blocked");
    expect(stateForPursueGoalFlow(blocked)?.lastError).toContain("stale");
  });

  it("blocks a mismatched typed worker assignment before invoking the worker", async () => {
    const flow = createGoalFlow();
    const state = stateForPursueGoalFlow(flow)!;
    const mismatched = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: {
        stateJson: structuredClone({
          ...state,
          workerSessionKey: `agent:other-worker:goal:${flow.flowId}`,
        }),
      },
    });
    expect(mismatched.applied).toBe(true);
    const runtime = baseRuntime(async () => ({ status: "active", text: "should not run" }));
    setPursueGoalControllerRuntimeForTests(runtime);

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const blocked = await waitForFlow(flow.flowId, (candidate) => candidate.status === "blocked");
    expect(stateForPursueGoalFlow(blocked)?.lastError).toContain("mismatched");
    expect(runtime.runTurn).not.toHaveBeenCalled();
    expect(taskMocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", suppressDelivery: true }),
    );
  });

  it("rejects a V2 approval that reports any model-visible tool", async () => {
    const flow = createGoalFlow();
    const state = stateForPursueGoalFlow(flow)!;
    const receipt = approvedV2Receipt({
      missionId: state.missionId,
      goal: flow.goal,
      text: "Claimed complete with an unsafe tool trace.",
      modelVisibleTools: ["update_plan"],
    });
    setPursueGoalJudgeReceiptVerifierForTests(() => true);
    setPursueGoalControllerRuntimeForTests(
      baseRuntime(async () => ({
        status: "complete",
        text: "Claimed complete with an unsafe tool trace.",
        judgeReceipt: receipt,
      })),
    );

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const blocked = await waitForFlow(flow.flowId, (candidate) => candidate.status === "blocked");
    expect(stateForPursueGoalFlow(blocked)?.lastError).toContain("Completion was rejected");
  });

  it("accepts a V2 approval only when its observed route and one-request proof are clean", async () => {
    const flow = createGoalFlow();
    const state = stateForPursueGoalFlow(flow)!;
    const receipt = approvedV2Receipt({
      missionId: state.missionId,
      goal: flow.goal,
      text: "Claimed complete with a clean tool trace.",
    });
    setPursueGoalJudgeReceiptVerifierForTests(() => true);
    setPursueGoalControllerRuntimeForTests(
      baseRuntime(async () => ({
        status: "complete",
        text: "Claimed complete with a clean tool trace.",
        judgeReceipt: receipt,
      })),
    );

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const succeeded = await waitForFlow(
      flow.flowId,
      (candidate) => candidate.status === "succeeded",
    );
    expect(stateForPursueGoalFlow(succeeded)?.judgeReceipt?.schemaVersion).toBe(2);
  });

  it("recovers an applied result after task finalization fails without replaying the worker", async () => {
    const flow = createGoalFlow();
    const state = stateForPursueGoalFlow(flow)!;
    const receipt = approvedV2Receipt({
      missionId: state.missionId,
      goal: flow.goal,
      text: "Claimed complete before the task registry interrupted finalization.",
    });
    taskMocks.complete.mockImplementationOnce(() => {
      throw new Error("simulated task-registry interruption");
    });
    const runtime = baseRuntime(async () => ({
      status: "complete" as const,
      text: "Claimed complete before the task registry interrupted finalization.",
      judgeReceipt: receipt,
    }));
    setPursueGoalControllerRuntimeForTests(runtime);

    expect(kickPursueGoalController(flow.flowId)).toBe(true);
    const terminal = await waitForFlow(
      flow.flowId,
      (candidate) => candidate.status === "succeeded",
    );
    expect(stateForPursueGoalFlow(terminal)?.pendingTurn?.phase).toBe("applied");
    expect(runtime.runTurn).toHaveBeenCalledTimes(1);

    expect(reconcilePursueGoalControllers()).toBe(0);
    const recovered = getTaskFlowById(flow.flowId)!;
    expect(stateForPursueGoalFlow(recovered)?.pendingTurn).toBeUndefined();
    expect(taskMocks.complete).toHaveBeenCalledTimes(2);
    expect(runtime.runTurn).toHaveBeenCalledTimes(1);
  });

  it("pauses a running goal, aborts its worker turn, and resumes durably", async () => {
    const flow = createGoalFlow();
    const runtime = baseRuntime(
      async ({ abortSignal }) =>
        await new Promise((resolve, reject) => {
          abortSignal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
          void resolve;
        }),
    );
    setPursueGoalControllerRuntimeForTests(runtime);

    kickPursueGoalController(flow.flowId);
    const running = await waitForFlow(flow.flowId, (candidate) => candidate.status === "running");
    const paused = await pausePursueGoalFlow({
      flowId: flow.flowId,
      expectedRevision: running.revision,
    });

    expect(paused.applied).toBe(true);
    expect(paused.flow?.status).toBe("paused");
    expect(stateForPursueGoalFlow(paused.flow!)?.phase).toBe("paused");
    expect(runtime.pauseWorkerGoal).toHaveBeenCalledTimes(1);
    expect(taskMocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", suppressDelivery: true }),
    );

    const missionId = stateForPursueGoalFlow(paused.flow!)!.missionId;
    runtime.runTurn = vi.fn(async () => ({
      status: "complete" as const,
      text: "Resumed and verified.",
      judgeReceipt: approvedReceipt({
        missionId,
        goal: flow.goal,
        text: "Resumed and verified.",
      }),
    }));
    const resumed = await import("./pursue-goal-controller.js").then((module) =>
      module.resumePursueGoalFlow({ flowId: flow.flowId, expectedRevision: paused.flow!.revision }),
    );
    expect(resumed.applied).toBe(true);
    await waitForFlow(flow.flowId, (candidate) => candidate.status === "succeeded");
    expect(runtime.resumeWorkerGoal).toHaveBeenCalledTimes(1);
  });

  it("takes over an expired lease and reconciles a stale running goal", async () => {
    const flow = createGoalFlow();
    const initial = stateForPursueGoalFlow(flow)!;
    const staleState = {
      ...initial,
      phase: "running" as const,
      lease: {
        ownerId: "dead-gateway",
        leaseId: "dead-lease",
        acquiredAt: 1,
        heartbeatAt: 1,
        expiresAt: 2,
      },
    };
    const stale = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: { status: "running", stateJson: structuredClone(staleState) },
    });
    expect(stale.applied).toBe(true);
    const runtime = baseRuntime(async () => ({
      status: "complete",
      text: "Recovered after restart.",
      judgeReceipt: approvedReceipt({
        missionId: initial.missionId,
        goal: flow.goal,
        text: "Recovered after restart.",
      }),
    }));
    setPursueGoalControllerRuntimeForTests(runtime);

    expect(reconcilePursueGoalControllers()).toBe(1);
    const recovered = await waitForFlow(
      flow.flowId,
      (candidate) => candidate.status === "succeeded",
    );
    expect(stateForPursueGoalFlow(recovered)?.activationCount).toBe(1);
  });

  it("supports revisioned edit, blocked retry, and sticky stop controls", async () => {
    const flow = createGoalFlow();
    const runtime = baseRuntime(async () => ({ status: "active", text: "Working." }));
    setPursueGoalControllerRuntimeForTests(runtime);

    const edited = await editPursueGoalFlow({
      flowId: flow.flowId,
      goal: "Ship the edited verified work",
      expectedRevision: flow.revision,
    });
    expect(edited.applied).toBe(true);
    expect(edited.flow?.goal).toBe("Ship the edited verified work");
    expect(stateForPursueGoalFlow(edited.flow!)?.goalVersion).toBe(2);

    const stopped = await stopPursueGoalFlow({ flowId: flow.flowId });
    expect(stopped.applied).toBe(true);
    expect(stopped.flow?.status).toBe("cancelled");
    expect(stopped.flow?.cancelRequestedAt).toEqual(expect.any(Number));
    expect(runtime.stopWorkerGoal).toHaveBeenCalledTimes(1);
    expect(kickPursueGoalController(flow.flowId)).toBe(false);

    const retry = await retryPursueGoalFlow({ flowId: flow.flowId });
    expect(retry.applied).toBe(false);
  });
});

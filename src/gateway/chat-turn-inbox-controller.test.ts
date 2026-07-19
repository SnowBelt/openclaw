import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTaskFlowById,
  resetTaskFlowRegistryForTests,
  updateFlowRecordByIdExpectedRevision,
} from "../tasks/task-flow-registry.js";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import {
  kickChatTurnInboxController,
  setChatTurnInboxControllerTestHooks,
  startChatTurnInboxController,
  stopChatTurnInboxController,
} from "./chat-turn-inbox-controller.js";
import { createChatTurnFlow, stateForChatTurn } from "./chat-turn-inbox-state.js";
import type { GatewayRequestContext } from "./server-methods/types.js";

function createContext(): GatewayRequestContext {
  return {
    dedupe: new Map(),
    chatAbortControllers: new Map(),
    chatQueuedTurns: new Map(),
    getRuntimeConfig: () => ({}),
    logGateway: { warn: vi.fn() },
  } as unknown as GatewayRequestContext;
}

async function waitForFlowStatus(flowId: string, status: string) {
  await vi.waitFor(
    () => {
      expect(getTaskFlowById(flowId)?.status).toBe(status);
    },
    { timeout: 2_000, interval: 10 },
  );
  return getTaskFlowById(flowId)!;
}

describe("durable chat turn inbox controller", () => {
  beforeEach(async () => {
    await stopChatTurnInboxController();
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => ({ flows: new Map() }),
        saveSnapshot: () => {},
        upsertFlow: () => {},
      },
    });
  });

  afterEach(async () => {
    await stopChatTurnInboxController();
    resetTaskFlowRegistryForTests({ persist: false });
  });

  it("keeps queued work mutable until the active run is idle, then dispatches once", async () => {
    const context = createContext();
    const flow = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Do this next",
      mode: "queue",
      idempotencyKey: "create-queue",
    })!;
    let active = true;
    const invoke = vi.fn(async ({ state }) => {
      context.dedupe.set(`chat:${state.dispatchRunId}`, {
        ts: Date.now(),
        ok: true,
        payload: { runId: state.dispatchRunId, status: "ok" },
      });
      return { ok: true, payload: { runId: state.dispatchRunId, status: "started" } };
    });
    setChatTurnInboxControllerTestHooks({
      hasActiveRun: () => active,
      invokeMethod: invoke,
    });
    startChatTurnInboxController(context);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(invoke).not.toHaveBeenCalled();
    expect(stateForChatTurn(getTaskFlowById(flow.flowId)!)?.phase).toBe("pending");

    active = false;
    kickChatTurnInboxController(flow.flowId);
    const completed = await waitForFlowStatus(flow.flowId, "succeeded");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0].payload).toMatchObject({
      message: "Do this next",
      turnMode: "queue",
    });
    expect(stateForChatTurn(completed)?.phase).toBe("delivered");
  });

  it("retries an orphaned admitted turn with the same dispatch id after restart", async () => {
    const context = createContext();
    const flow = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Recover this",
      mode: "queue",
      idempotencyKey: "create-recovery",
      now: Date.now() - 10_000,
    })!;
    const state = stateForChatTurn(flow)!;
    const orphaned = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: {
        status: "waiting",
        updatedAt: Date.now() - 6_000,
        stateJson: JSON.parse(
          JSON.stringify({
            ...state,
            phase: "admitted",
            dispatchAttempts: 1,
            updatedAt: Date.now() - 6_000,
          }),
        ),
      },
    });
    expect(orphaned.applied).toBe(true);
    const invoke = vi.fn(async ({ state: current, payload }) => {
      expect(payload.idempotencyKey).toBe(state.dispatchRunId);
      context.dedupe.set(`chat:${current.dispatchRunId}`, {
        ts: Date.now(),
        ok: true,
        payload: { runId: current.dispatchRunId, status: "ok" },
      });
      return { ok: true, payload: { runId: current.dispatchRunId, status: "in_flight" } };
    });
    setChatTurnInboxControllerTestHooks({
      hasActiveRun: () => false,
      invokeMethod: invoke,
    });

    startChatTurnInboxController(context);
    const completed = await waitForFlowStatus(flow.flowId, "succeeded");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(stateForChatTurn(completed)?.dispatchRunId).toBe(state.dispatchRunId);
    expect(stateForChatTurn(completed)?.dispatchAttempts).toBe(2);
  });

  it("persists a bounded working heartbeat while an admitted runtime run remains active", async () => {
    const context = createContext();
    const old = Date.now() - 20_000;
    const flow = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Long work",
      mode: "queue",
      idempotencyKey: "create-heartbeat",
      now: old,
    })!;
    const state = stateForChatTurn(flow)!;
    const admitted = updateFlowRecordByIdExpectedRevision({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      patch: {
        status: "waiting",
        updatedAt: old,
        stateJson: JSON.parse(
          JSON.stringify({
            ...state,
            phase: "admitted",
            dispatchAttempts: 1,
            activitySummary: "The assistant is working on the response.",
            lastActivityAt: old,
            updatedAt: old,
          }),
        ),
      },
    });
    expect(admitted.applied).toBe(true);
    context.chatAbortControllers.set(state.dispatchRunId, new AbortController());
    setChatTurnInboxControllerTestHooks({
      hasActiveRun: () => true,
      invokeMethod: vi.fn(async () => {
        throw new Error("An owned admitted run must not be redispatched.");
      }),
    });

    startChatTurnInboxController(context);
    await vi.waitFor(() => {
      const current = stateForChatTurn(getTaskFlowById(flow.flowId)!);
      expect(current?.lastActivityAt).toBeGreaterThan(old);
      expect(current?.activitySummary).toBe("Still working; the response run is active.");
    });
  });
});

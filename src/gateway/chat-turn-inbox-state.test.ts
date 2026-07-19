import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTaskFlowRegistryForTests } from "../tasks/task-flow-registry.js";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import {
  createChatTurnFlow,
  findChatTurnByIdempotency,
  listChatTurnFlows,
  mapChatTurnSummary,
  mutateChatTurnFlow,
  pruneTerminalChatTurnFlows,
  stateForChatTurn,
  updateChatTurnControllerState,
} from "./chat-turn-inbox-state.js";

describe("durable chat turn inbox state", () => {
  beforeEach(() => {
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => ({ flows: new Map() }),
        saveSnapshot: () => {},
        upsertFlow: () => {},
      },
    });
  });

  afterEach(() => {
    resetTaskFlowRegistryForTests({ persist: false });
  });

  it("creates one durable turn for repeated create idempotency keys", () => {
    const first = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Continue the verified work",
      mode: "queue",
      idempotencyKey: "create-1",
      operatorScopes: ["operator.read", "operator.write", "operator.write"],
      now: 100,
    });
    const duplicate = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Continue the verified work",
      mode: "queue",
      idempotencyKey: "create-1",
      now: 200,
    });

    expect(first).not.toBeNull();
    expect(duplicate?.flowId).toBe(first?.flowId);
    expect(listChatTurnFlows({ sessionKey: "agent:main:dashboard:test" })).toHaveLength(1);
    expect(
      findChatTurnByIdempotency({
        sessionKey: "agent:main:dashboard:test",
        idempotencyKey: "create-1",
      })?.flowId,
    ).toBe(first?.flowId);
    expect(stateForChatTurn(first!)?.operatorScopes).toEqual(["operator.read", "operator.write"]);
  });

  it("preserves a hash-verified immutable Control Director mission", () => {
    const flow = createChatTurnFlow({
      sessionKey: "agent:director:dashboard:test",
      agentId: "director",
      message: "Implement the exact request and preserve this approval boundary.",
      mode: "queue",
      idempotencyKey: "create-mission",
      preserveControlDirectorMission: true,
      now: 100,
    })!;

    const state = stateForChatTurn(flow)!;
    expect(state.mission).toMatchObject({
      missionId: `control-director:${flow.flowId}`,
      idempotencyKey: "create-mission",
      requestBody: "Implement the exact request and preserve this approval boundary.",
      responseMode: "execute",
      artifactIds: [flow.flowId],
    });
    expect(mapChatTurnSummary(flow)).toMatchObject({
      missionId: `control-director:${flow.flowId}`,
      responseMode: "execute",
      requestHash: state.mission?.requestHash,
    });
  });

  it("switches queue and steer atomically only while admission is open", () => {
    const flow = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Steer this",
      mode: "queue",
      idempotencyKey: "create-2",
      now: 100,
    })!;
    const changed = mutateChatTurnFlow({
      turnId: flow.flowId,
      sessionKey: flow.ownerKey,
      expectedRevision: flow.revision,
      idempotencyKey: "mode-1",
      requireAdmissionOpen: true,
      now: 200,
      mutate: (state, now) => ({ ...state, mode: "steer", modeUpdatedAt: now }),
      patch: () => ({ status: "queued", currentStep: "Steer pending admission." }),
    });

    expect(changed.applied).toBe(true);
    if (!changed.applied) {
      throw new Error("Expected mode mutation.");
    }
    expect(mapChatTurnSummary(changed.flow)).toMatchObject({
      mode: "steer",
      admissionOpen: true,
    });

    const duplicate = mutateChatTurnFlow({
      turnId: flow.flowId,
      sessionKey: flow.ownerKey,
      expectedRevision: flow.revision,
      idempotencyKey: "mode-1",
      requireAdmissionOpen: true,
      mutate: (state) => ({ ...state, mode: "queue" }),
    });
    expect(duplicate).toMatchObject({ applied: true, duplicate: true });
    expect(duplicate.applied && duplicate.state.mode).toBe("steer");

    const stale = mutateChatTurnFlow({
      turnId: flow.flowId,
      sessionKey: flow.ownerKey,
      expectedRevision: flow.revision,
      idempotencyKey: "mode-2",
      requireAdmissionOpen: true,
      mutate: (state) => ({ ...state, mode: "queue" }),
    });
    expect(stale).toMatchObject({ applied: false, reason: "revision_conflict" });
  });

  it("closes admission and hides delivered turns from the active list", () => {
    const flow = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:test",
      message: "Finish this",
      mode: "queue",
      idempotencyKey: "create-3",
      now: 100,
    })!;
    const delivered = updateChatTurnControllerState({
      flowId: flow.flowId,
      now: 300,
      mutate: (state) => ({ ...state, phase: "delivered", endedAt: 300 }),
      patch: () => ({ status: "succeeded", currentStep: "Delivered.", endedAt: 300 }),
    });

    expect(delivered.applied).toBe(true);
    if (!delivered.applied) {
      throw new Error("Expected controller mutation.");
    }
    expect(mapChatTurnSummary(delivered.flow)).toMatchObject({
      phase: "delivered",
      admissionOpen: false,
      endedAt: 300,
    });
    expect(listChatTurnFlows({ sessionKey: flow.ownerKey })).toEqual([]);
    expect(listChatTurnFlows({ sessionKey: flow.ownerKey, includeTerminal: true })).toHaveLength(1);
    expect(
      mutateChatTurnFlow({
        turnId: flow.flowId,
        sessionKey: flow.ownerKey,
        expectedRevision: delivered.flow.revision,
        idempotencyKey: "late-mode-change",
        requireAdmissionOpen: true,
        mutate: (state) => ({ ...state, mode: "steer" }),
      }),
    ).toMatchObject({ applied: false, reason: "admission_closed" });
  });

  it("keeps cancellation and retry phase mutations available after admission closes", () => {
    const flow = createChatTurnFlow({
      sessionKey: "agent:main:dashboard:cancel",
      message: "Cancel this admitted turn",
      mode: "queue",
      idempotencyKey: "create-cancel",
      now: 100,
    })!;
    const admitted = updateChatTurnControllerState({
      flowId: flow.flowId,
      now: 200,
      mutate: (state) => ({ ...state, phase: "admitted" }),
      patch: () => ({ status: "waiting", currentStep: "Working." }),
    });
    expect(admitted.applied).toBe(true);
    if (!admitted.applied) {
      throw new Error("Expected admitted mutation.");
    }
    const cancelled = mutateChatTurnFlow({
      turnId: flow.flowId,
      sessionKey: flow.ownerKey,
      expectedRevision: admitted.flow.revision,
      idempotencyKey: "cancel-1",
      now: 300,
      mutate: (state) => ({ ...state, phase: "cancelled", endedAt: 300 }),
      patch: () => ({ status: "cancelled", currentStep: "Cancelled.", endedAt: 300 }),
    });
    expect(cancelled).toMatchObject({ applied: true, state: { phase: "cancelled" } });

    const failedFlow = createChatTurnFlow({
      sessionKey: flow.ownerKey,
      message: "Retry this failed turn",
      mode: "queue",
      idempotencyKey: "create-retry",
      now: 400,
    })!;
    const failed = updateChatTurnControllerState({
      flowId: failedFlow.flowId,
      now: 500,
      mutate: (state) => ({ ...state, phase: "failed", endedAt: 500 }),
      patch: () => ({ status: "failed", currentStep: "Failed.", endedAt: 500 }),
    });
    expect(failed.applied).toBe(true);
    if (!failed.applied) {
      throw new Error("Expected failed mutation.");
    }
    const retried = mutateChatTurnFlow({
      turnId: failedFlow.flowId,
      sessionKey: failedFlow.ownerKey,
      expectedRevision: failed.flow.revision,
      idempotencyKey: "retry-1",
      now: 600,
      mutate: (state) => ({ ...state, phase: "pending", endedAt: undefined }),
      patch: () => ({ status: "queued", currentStep: "Retry queued.", endedAt: null }),
    });
    expect(retried).toMatchObject({ applied: true, state: { phase: "pending" } });
  });

  it("prunes only expired or excess terminal history and never active turns", () => {
    const sessionKey = "agent:main:dashboard:retention";
    const active = createChatTurnFlow({
      sessionKey,
      message: "Keep active",
      mode: "queue",
      idempotencyKey: "active",
      now: 100,
    })!;
    const terminalIds = ["old", "new"].map((id, index) => {
      const flow = createChatTurnFlow({
        sessionKey,
        message: id,
        mode: "queue",
        idempotencyKey: id,
        now: 200 + index,
      })!;
      const endedAt = id === "old" ? 300 : 900;
      const result = updateChatTurnControllerState({
        flowId: flow.flowId,
        now: endedAt,
        mutate: (state) => ({ ...state, phase: "delivered", endedAt }),
        patch: () => ({ status: "succeeded", currentStep: "Delivered.", endedAt }),
      });
      expect(result.applied).toBe(true);
      return flow.flowId;
    });

    expect(
      pruneTerminalChatTurnFlows({ now: 1_000, retentionMs: 500, maxTerminalPerSession: 10 }),
    ).toBe(1);
    expect(
      listChatTurnFlows({ sessionKey, includeTerminal: true }).map((flow) => flow.flowId),
    ).toEqual([active.flowId, terminalIds[1]]);
  });
});

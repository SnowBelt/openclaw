import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createChatTurnFlow,
  listChatTurnFlows,
  mutateChatTurnFlow,
  stateForChatTurn,
  updateChatTurnControllerState,
} from "../gateway/chat-turn-inbox-state.js";
import type { PccExecutionCapacitySnapshot } from "../pcc/execution-capacity.js";
import {
  createPursueGoalControllerState,
  isPursueGoalLeaseCurrent,
  parsePursueGoalControllerState,
} from "../tasks/pursue-goal-controller-state.js";
import { getTaskFlowById, resetTaskFlowRegistryForTests } from "../tasks/task-flow-registry.js";
import {
  configureTaskFlowRegistryRuntime,
  type TaskFlowRegistryStore,
} from "../tasks/task-flow-registry.store.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import {
  CONTROL_DIRECTOR_PROMPT_BUDGET,
  compileControlDirectorPromptBudget,
} from "./control-director-context-budget.js";
import { decideControlDirectorResourceAdmission } from "./control-director-resource-governor.js";

function cloneFlow(flow: TaskFlowRecord): TaskFlowRecord {
  return structuredClone(flow);
}

function memoryStore(records: Map<string, TaskFlowRecord>): TaskFlowRegistryStore {
  return {
    loadSnapshot: () => ({
      flows: new Map([...records].map(([id, flow]) => [id, cloneFlow(flow)])),
    }),
    saveSnapshot: ({ flows }) => {
      records.clear();
      for (const [id, flow] of flows) {
        records.set(id, cloneFlow(flow));
      }
    },
    upsertFlow: (flow) => records.set(flow.flowId, cloneFlow(flow)),
    deleteFlow: (flowId) => records.delete(flowId),
  };
}

function capacity(
  overrides: Partial<PccExecutionCapacitySnapshot> = {},
): PccExecutionCapacitySnapshot {
  return {
    schemaVersion: 1,
    measuredAt: 100,
    cpuUtilization: 0.2,
    memoryPressure: "normal",
    freeRamGb: 96,
    thermalPressure: "nominal",
    gatewayQueueDepth: 0,
    activeLocalAgents: 0,
    activeRemoteAgents: 0,
    maxSafeLocalAgents: 2,
    maxSafeRemoteAgents: 4,
    safeLocalAgentSlots: 2,
    safeRemoteAgentSlots: 4,
    ...overrides,
  };
}

describe("Control Director chaos and state-hygiene acceptance", () => {
  beforeEach(() => {
    resetTaskFlowRegistryForTests({ persist: false });
  });

  afterEach(() => {
    resetTaskFlowRegistryForTests({ persist: false });
  });

  it("restores a durable pending turn after process-state loss without changing its run identity", () => {
    const persisted = new Map<string, TaskFlowRecord>();
    configureTaskFlowRegistryRuntime({ store: memoryStore(persisted) });
    const created = createChatTurnFlow({
      sessionKey: "agent:control-director:dashboard:restart",
      agentId: "control-director",
      message: "Continue after restart",
      mode: "queue",
      idempotencyKey: "restart-create-1",
      now: 100,
    });
    expect(created).not.toBeNull();
    const originalState = stateForChatTurn(created!);
    expect(originalState).not.toBeNull();

    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskFlowRegistryRuntime({ store: memoryStore(persisted) });
    const restored = getTaskFlowById(created!.flowId);
    const restoredState = restored ? stateForChatTurn(restored) : null;

    expect(restoredState).toMatchObject({
      turnId: created!.flowId,
      phase: "pending",
      dispatchRunId: originalState!.dispatchRunId,
      idempotencyKey: "restart-create-1",
    });
  });

  it("fails closed for malformed goal state and expired controller leases", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-chaos",
      goal: "Prove restart safety",
      workerAgentId: "program-manager",
      now: 100,
      missionId: "mission-chaos",
    });
    const malformed = { ...state, schemaVersion: 999 };
    const leased = {
      ...state,
      lease: {
        ownerId: "gateway-a",
        leaseId: "lease-a",
        acquiredAt: 100,
        heartbeatAt: 110,
        expiresAt: 120,
      },
    };

    expect(parsePursueGoalControllerState(malformed)).toBeUndefined();
    expect(
      isPursueGoalLeaseCurrent(leased, {
        ownerId: "gateway-a",
        leaseId: "lease-a",
        now: 121,
      }),
    ).toBe(false);
    expect(
      isPursueGoalLeaseCurrent(leased, {
        ownerId: "gateway-a",
        leaseId: "lease-a",
        now: 119,
      }),
    ).toBe(true);
  });

  it("contains compaction pressure inside deterministic section and total budgets", () => {
    const compiled = compileControlDirectorPromptBudget({
      mode: "execute",
      policyPrompt: "policy ".repeat(10_000),
      missionContext: "mission ".repeat(10_000),
      recentContext: "recent ".repeat(10_000),
    });

    expect(compiled.chars.policy).toBe(CONTROL_DIRECTOR_PROMPT_BUDGET.policyChars);
    expect(compiled.chars.mission).toBe(CONTROL_DIRECTOR_PROMPT_BUDGET.missionChars);
    expect(compiled.chars.recentContext).toBe(CONTROL_DIRECTOR_PROMPT_BUDGET.recentContextChars);
    expect(compiled.chars.total).toBeLessThanOrEqual(CONTROL_DIRECTOR_PROMPT_BUDGET.totalChars);
  });

  it("never unloads an active model and only proposes deterministic idle eviction", () => {
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/control-director",
        capacity: capacity({ freeRamGb: 4 }),
        residentModels: [
          { ref: "ollama/busy", state: "active", estimatedMemoryGb: 48 },
          { ref: "ollama/idle", state: "idle", estimatedMemoryGb: 48 },
        ],
      }),
    ).toMatchObject({ decision: "queue", retryWhen: "active_model" });

    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/control-director",
        capacity: capacity({ freeRamGb: 4 }),
        residentModels: [
          { ref: "ollama/z-idle", state: "idle", estimatedMemoryGb: 24 },
          { ref: "ollama/a-idle", state: "idle", estimatedMemoryGb: 24 },
        ],
      }),
    ).toMatchObject({
      decision: "unload_idle_then_admit",
      unloadModels: ["ollama/a-idle", "ollama/z-idle"],
    });
  });

  it("contains duplicate creation, concurrent mutation, and terminal redelivery races", () => {
    configureTaskFlowRegistryRuntime({ store: memoryStore(new Map()) });
    const params = {
      sessionKey: "agent:control-director:dashboard:race",
      agentId: "control-director",
      message: "Do this exactly once",
      mode: "queue" as const,
      idempotencyKey: "race-create-1",
      now: 100,
    };
    const first = createChatTurnFlow(params)!;
    const duplicate = createChatTurnFlow({ ...params, now: 101 })!;
    expect(duplicate.flowId).toBe(first.flowId);

    const changed = mutateChatTurnFlow({
      turnId: first.flowId,
      sessionKey: first.ownerKey,
      expectedRevision: first.revision,
      idempotencyKey: "race-mode-1",
      now: 200,
      mutate: (state, now) => ({ ...state, mode: "steer", modeUpdatedAt: now }),
    });
    expect(changed).toMatchObject({ applied: true });
    expect(changed.applied && changed.state.mode).toBe("steer");
    const stale = mutateChatTurnFlow({
      turnId: first.flowId,
      sessionKey: first.ownerKey,
      expectedRevision: first.revision,
      idempotencyKey: "race-mode-2",
      now: 201,
      mutate: (state) => ({ ...state, mode: "queue" }),
    });
    expect(stale).toMatchObject({ applied: false, reason: "revision_conflict" });

    const delivered = updateChatTurnControllerState({
      flowId: first.flowId,
      now: 300,
      mutate: (state) => ({ ...state, phase: "delivered", endedAt: 300 }),
      patch: () => ({ status: "succeeded", currentStep: "Delivered once.", endedAt: 300 }),
    });
    expect(delivered.applied).toBe(true);
    expect(listChatTurnFlows({ sessionKey: first.ownerKey })).toEqual([]);
    expect(
      mutateChatTurnFlow({
        turnId: first.flowId,
        sessionKey: first.ownerKey,
        expectedRevision: delivered.applied ? delivered.flow.revision : -1,
        idempotencyKey: "late-redelivery",
        requireAdmissionOpen: true,
        now: 301,
        mutate: (state) => ({ ...state, mode: "queue" }),
      }),
    ).toMatchObject({ applied: false, reason: "admission_closed" });
  });
});

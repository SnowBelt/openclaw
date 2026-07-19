import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onInternalDiagnosticEvent } from "../../infra/diagnostic-events.js";
import { createTaskRecord, resetTaskRegistryForTests } from "../../tasks/runtime-internal.js";
import {
  createManagedTaskFlow,
  resetTaskFlowRegistryForTests,
} from "../../tasks/task-flow-registry.js";
import { configureTaskFlowRegistryRuntime } from "../../tasks/task-flow-registry.store.js";
import { configureTaskRegistryRuntime } from "../../tasks/task-registry.store.js";
import { createChatTurnFlow } from "../chat-turn-inbox-state.js";
import { __test } from "./tasks.js";

const sessionKey = "agent:director:dashboard:canonical-state";

describe("canonical execution state snapshot", () => {
  beforeEach(() => {
    __test.resetRuntimeLineageSignalStateForTests();
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => ({ tasks: new Map() }),
        saveSnapshot: () => {},
        upsertTask: () => {},
      },
    });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => ({ flows: new Map() }),
        saveSnapshot: () => {},
        upsertFlow: () => {},
        deleteFlow: () => {},
      },
    });
  });

  afterEach(() => {
    __test.resetRuntimeLineageSignalStateForTests();
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
  });

  it("projects tasks, public flows, and private turn inbox state once", () => {
    const task = createTaskRecord({
      runtime: "cli",
      requesterSessionKey: sessionKey,
      ownerKey: sessionKey,
      scopeKind: "session",
      runId: "run-canonical",
      task: "Run canonical work",
      status: "running",
      deliveryStatus: "pending",
    });
    expect(task).not.toBeNull();
    const publicFlow = createManagedTaskFlow({
      ownerKey: sessionKey,
      controllerId: "openclaw/public-test-v1",
      requesterOrigin: { channel: "webchat", to: sessionKey },
      status: "running",
      notifyPolicy: "silent",
      goal: "Public goal",
      createdAt: 100,
      updatedAt: 100,
    })!;
    const turn = createChatTurnFlow({
      sessionKey,
      agentId: "director",
      message: "Queued turn",
      mode: "queue",
      idempotencyKey: "turn-canonical",
      now: 200,
    })!;

    const snapshot = __test.buildExecutionStateSnapshot({ sessionKey, now: 1_000 });
    expect(snapshot.tasks.map((entry) => entry.id)).toEqual([task!.taskId]);
    expect(snapshot.flows.map((entry) => entry.id)).toEqual([publicFlow.flowId]);
    expect(snapshot.flows.map((entry) => entry.id)).not.toContain(turn.flowId);
    expect(snapshot.turns.map((entry) => entry.id)).toEqual([turn.flowId]);
    expect(snapshot.health).toMatchObject({ activeCount: 3, healthy: true });
  });

  it("keeps the content revision stable when only generatedAt changes", () => {
    createChatTurnFlow({
      sessionKey,
      message: "Pending turn",
      mode: "steer",
      idempotencyKey: "turn-revision",
      now: 200,
    });

    const first = __test.buildExecutionStateSnapshot({ sessionKey, now: 1_000 });
    const second = __test.buildExecutionStateSnapshot({ sessionKey, now: 2_000 });
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.snapshotRevision).toBe(second.snapshotRevision);
  });

  it("includes exact runtime lineage in the content revision when provided", () => {
    const lineage = {
      schemaVersion: 1 as const,
      status: "ready" as const,
      checkedAt: 100,
      agentId: "director",
      role: "control_director" as const,
      selectedModel: "ollama/control-director",
      sourceSha: "a".repeat(40),
      runtimeVersion: "2026.7.1",
      releaseId: "release-a",
      artifactHash: "b".repeat(64),
      blockers: [],
    };
    const withLineage = __test.buildExecutionStateSnapshot({
      sessionKey,
      now: 1_000,
      runtimeLineage: lineage,
    });
    const withoutLineage = __test.buildExecutionStateSnapshot({ sessionKey, now: 1_000 });

    expect(withLineage.runtimeLineage).toEqual(lineage);
    expect(withLineage.snapshotRevision).not.toBe(withoutLineage.snapshotRevision);
  });

  it("keeps the revision stable when only lineage freshness timestamps change", () => {
    const base = {
      schemaVersion: 1 as const,
      status: "ready" as const,
      agentId: "director",
      role: "control_director" as const,
      selectedModel: "ollama/control-director",
      sourceSha: "a".repeat(40),
      runtimeVersion: "2026.7.1",
      releaseId: "release-a",
      artifactHash: "b".repeat(64),
      blockers: [],
      canary: {
        schemaVersion: 1 as const,
        sourceSha: "a".repeat(40),
        runtimeVersion: "2026.7.1",
        agentId: "director",
        role: "control_director" as const,
        selectedModel: "ollama/control-director",
        promptContractId: "prompt-v1",
        toolPolicyId: "tools-v1",
        skillSetHash: "c".repeat(64),
        memoryBuildId: "memory-v1",
        uiBuildId: "b".repeat(64),
        capturedAt: 100,
      },
    };
    const first = __test.buildExecutionStateSnapshot({
      sessionKey,
      now: 1_000,
      runtimeLineage: { ...base, checkedAt: 100 },
    });
    const second = __test.buildExecutionStateSnapshot({
      sessionKey,
      now: 2_000,
      runtimeLineage: {
        ...base,
        checkedAt: 200,
        canary: { ...base.canary, capturedAt: 200 },
      },
    });

    expect(first.snapshotRevision).toBe(second.snapshotRevision);
  });

  it("projects memory freshness without changing revision for age-only polling", () => {
    const memoryHealth = {
      schemaVersion: 1 as const,
      status: "healthy" as const,
      newestSourceAt: 100,
      newestRecordAt: 100,
      newestAgeMs: 900,
      currentDaySourceCount: 1,
      corruptRecordCount: 0,
      sourceConflictCount: 0,
      repairActions: [],
    };
    const first = __test.buildExecutionStateSnapshot({
      sessionKey,
      now: 1_000,
      memoryHealth,
    });
    const second = __test.buildExecutionStateSnapshot({
      sessionKey,
      now: 2_000,
      memoryHealth: { ...memoryHealth, newestAgeMs: 1_900 },
    });
    expect(first.memoryHealth).toEqual(memoryHealth);
    expect(first.snapshotRevision).toBe(second.snapshotRevision);
  });

  it("emits one typed SIG signal per unique blocked runtime lineage episode", async () => {
    const events: Array<{ errorCode?: string; observed?: string }> = [];
    const stop = onInternalDiagnosticEvent((event, metadata) => {
      if (
        metadata.trusted &&
        event.type === "improvement.signal" &&
        event.errorCode === "runtime_lineage_mismatch"
      ) {
        events.push(event);
      }
    });
    try {
      const blocked = {
        schemaVersion: 1 as const,
        status: "blocked" as const,
        checkedAt: 100,
        agentId: "director",
        role: "control_director" as const,
        runtimeVersion: "2026.7.1",
        blockers: ["Managed Gateway runtime provenance has no immutable source SHA."],
      };
      expect(__test.maybeEmitControlDirectorRuntimeLineageSignal(blocked)).toBe(true);
      expect(
        __test.maybeEmitControlDirectorRuntimeLineageSignal({ ...blocked, checkedAt: 200 }),
      ).toBe(false);
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({ errorCode: "runtime_lineage_mismatch" });
      expect(events[0]?.observed).toContain("immutable source SHA");

      expect(
        __test.maybeEmitControlDirectorRuntimeLineageSignal({
          ...blocked,
          checkedAt: 300,
          blockers: ["Managed source SHA does not match expected source SHA."],
        }),
      ).toBe(true);
      await vi.waitFor(() => expect(events).toHaveLength(2));

      expect(
        __test.maybeEmitControlDirectorRuntimeLineageSignal({
          ...blocked,
          status: "ready",
          blockers: [],
        }),
      ).toBe(false);
      expect(__test.maybeEmitControlDirectorRuntimeLineageSignal(blocked)).toBe(true);
      await vi.waitFor(() => expect(events).toHaveLength(3));
    } finally {
      stop();
    }
  });
});

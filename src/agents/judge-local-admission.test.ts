import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireJudgeLocalAdmission,
  assessJudgeLocalCapacity,
  getJudgeLocalAdmissionSnapshotForTests,
  resetJudgeLocalAdmissionForTests,
} from "./judge-local-admission.js";

afterEach(() => {
  resetJudgeLocalAdmissionForTests();
  vi.useRealTimers();
});

describe("Judge local inference admission", () => {
  it("runs one local inference and grants the next request after release", async () => {
    const first = await acquireJudgeLocalAdmission({ ownerId: "flow-a", timeoutMs: 1_000 });
    expect(first.admitted).toBe(true);
    const secondPending = acquireJudgeLocalAdmission({ ownerId: "flow-b", timeoutMs: 1_000 });
    expect(getJudgeLocalAdmissionSnapshotForTests()).toEqual({
      active: true,
      queued: 1,
      owners: 1,
    });
    if (first.admitted) {
      first.release();
    }
    const second = await secondPending;
    expect(second.admitted).toBe(true);
    if (second.admitted) {
      second.release();
    }
  });

  it("bounds queued requests per owner", async () => {
    const active = await acquireJudgeLocalAdmission({ ownerId: "active", timeoutMs: 1_000 });
    const queuedOne = acquireJudgeLocalAdmission({ ownerId: "owner", timeoutMs: 1_000 });
    const queuedTwo = acquireJudgeLocalAdmission({ ownerId: "owner", timeoutMs: 1_000 });
    await expect(
      acquireJudgeLocalAdmission({ ownerId: "owner", timeoutMs: 1_000 }),
    ).resolves.toEqual({ admitted: false, reason: "owner_limit" });
    resetJudgeLocalAdmissionForTests();
    await expect(queuedOne).resolves.toEqual({ admitted: false, reason: "cancelled" });
    await expect(queuedTwo).resolves.toEqual({ admitted: false, reason: "cancelled" });
    if (active.admitted) {
      active.release();
    }
  });

  it("promotes queued Judge work ahead of older normal work", async () => {
    const active = await acquireJudgeLocalAdmission({ ownerId: "active", timeoutMs: 1_000 });
    const normalPending = acquireJudgeLocalAdmission({
      ownerId: "normal",
      timeoutMs: 1_000,
      priority: "normal",
    });
    const judgePending = acquireJudgeLocalAdmission({
      ownerId: "judge",
      timeoutMs: 1_000,
      priority: "judge",
    });
    if (active.admitted) {
      active.release();
    }
    const first = await judgePending;
    expect(first.admitted).toBe(true);
    if (first.admitted) {
      first.release();
    }
    const second = await normalPending;
    expect(second.admitted).toBe(true);
    if (second.admitted) {
      second.release();
    }
  });

  it("removes cancelled and expired requests without granting them later", async () => {
    vi.useFakeTimers();
    const active = await acquireJudgeLocalAdmission({ ownerId: "active", timeoutMs: 1_000 });
    const abortController = new AbortController();
    const cancelled = acquireJudgeLocalAdmission({
      ownerId: "cancelled",
      timeoutMs: 1_000,
      signal: abortController.signal,
    });
    const expired = acquireJudgeLocalAdmission({ ownerId: "expired", timeoutMs: 10 });
    abortController.abort();
    await vi.advanceTimersByTimeAsync(10);
    await expect(cancelled).resolves.toEqual({ admitted: false, reason: "cancelled" });
    await expect(expired).resolves.toEqual({ admitted: false, reason: "timeout" });
    expect(getJudgeLocalAdmissionSnapshotForTests().queued).toBe(0);
    if (active.admitted) {
      active.release();
    }
  });

  it("bypasses the local queue when another model is resident", async () => {
    await expect(
      assessJudgeLocalCapacity({
        config: {},
        selectedModel: "ollama/qwen-primary",
        runtime: {
          collectResidency: async () => ({
            available: true,
            residentModels: [{ ref: "ollama/another-model", state: "idle", estimatedMemoryGb: 24 }],
            observedProcessCount: 1,
            warnings: [],
          }),
        },
      }),
    ).resolves.toMatchObject({ decision: "hosted_fallback" });
  });

  it("fails over under low memory and queues under ordinary slot pressure", async () => {
    const collectResidency = async () => ({
      available: true,
      residentModels: [],
      observedProcessCount: 0,
      warnings: [],
    });
    const snapshot = {
      totalRamGb: 128,
      freeRamGb: 47,
      logicalCpuCount: 16,
      performanceCpuCount: 12,
      load1: 1,
      load5: 1,
      load15: 1,
      memoryPressure: "low" as const,
      thermalPressure: "nominal" as const,
      activeOpenClawTaskCount: 0,
      configuredSubagentLimit: 8,
      observedLocalModelProcessCount: 0,
      localModelObservationAvailable: true,
      safeLocalAgentSlots: 1,
      timestamp: "2026-08-21T00:00:00.000Z",
      warnings: [],
    };
    await expect(
      assessJudgeLocalCapacity({
        config: {},
        selectedModel: "ollama/qwen-primary",
        runtime: { collectResidency, collectCapacity: () => snapshot },
      }),
    ).resolves.toMatchObject({ decision: "hosted_fallback" });
    await expect(
      assessJudgeLocalCapacity({
        config: {},
        selectedModel: "ollama/qwen-primary",
        runtime: {
          collectResidency,
          collectCapacity: () => ({ ...snapshot, freeRamGb: 64, safeLocalAgentSlots: 0 }),
        },
      }),
    ).resolves.toMatchObject({ decision: "queue" });
  });
});

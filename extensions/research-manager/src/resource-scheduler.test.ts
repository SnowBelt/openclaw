import { describe, expect, it, vi } from "vitest";
import { resolveResearchManagerConfig } from "./config.js";
import type { OllamaInventory } from "./ollama.js";
import { ResourceScheduler } from "./resource-scheduler.js";
import type { ResearchModelSpec } from "./types.js";

function model(overrides: Partial<ResearchModelSpec> = {}): ResearchModelSpec {
  return {
    id: "qwen",
    provider: "ollama",
    model: "qwen3.6:27b-q8_0",
    roles: ["researcher"],
    remote: false,
    memoryGb: 31,
    contextTokens: 32_768,
    maxParallel: 1,
    qualificationScore: 90,
    enabled: true,
    exclusive: false,
    ...overrides,
  };
}

function emptyInventory(): OllamaInventory {
  return {
    baseUrl: "http://127.0.0.1:11434",
    reachable: true,
    checkedAt: new Date().toISOString(),
    models: [],
    totalLoadedBytes: 0,
  };
}

describe("ResourceScheduler", () => {
  it("queues a second run when the model parallel limit is reached", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig(undefined),
      inventoryReader: async () => emptyInventory(),
    });
    const first = await scheduler.acquire({ model: model() });
    let secondResolved = false;
    const secondPromise = scheduler.acquire({ model: model(), deadlineMs: 1_000 }).then((value) => {
      secondResolved = true;
      return value;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(secondResolved).toBe(false);
    expect(scheduler.queueLength).toBe(1);
    first.release();
    const second = await secondPromise;
    expect(second.waitedMs).toBeGreaterThanOrEqual(0);
    second.release();
  });

  it("runs the normal local team below the 130 GB soft cap", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig({ resourceLimits: { maxLocalParallel: 3 } }),
      inventoryReader: async () => emptyInventory(),
    });
    const qwen = await scheduler.acquire({ model: model() });
    const gemma = await scheduler.acquire({
      model: model({ id: "gemma", model: "gemma4", memoryGb: 35 }),
    });
    const scout = await scheduler.acquire({
      model: model({ id: "scout", model: "qwen9b", memoryGb: 8 }),
    });
    expect(scheduler.activeCount).toBe(3);
    expect(scout.projectedMemoryGb).toBeLessThan(130);
    qwen.release();
    gemma.release();
    scout.release();
  });

  it("counts a separate context reservation for every concurrent inference sharing weights", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig({ resourceLimits: { maxLocalParallel: 2 } }),
      inventoryReader: async () => emptyInventory(),
    });
    const shared = model({ maxParallel: 2 });
    const first = await scheduler.acquire({ model: shared });
    const second = await scheduler.acquire({ model: shared });
    expect(first.projectedMemoryGb).toBeCloseTo(34.72, 2);
    expect(second.projectedMemoryGb).toBeCloseTo(38.44, 2);
    first.release();
    second.release();
  });

  it("admits an exclusive critical 142 GB model only at the 150 GB absolute cap", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig(undefined),
      inventoryReader: async () => emptyInventory(),
    });
    const reservation = await scheduler.acquire({
      model: model({ id: "235b", model: "qwen235b", memoryGb: 142, exclusive: true }),
      priority: "critical",
    });
    expect(reservation.projectedMemoryGb).toBe(150);
    reservation.release();
  });

  it("keeps non-exclusive critical work below the 145 GB hard cap", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig({ resourceLimits: { queueDeadlineMs: 20 } }),
      inventoryReader: async () => emptyInventory(),
    });
    await expect(
      scheduler.acquire({
        model: model({ id: "large", model: "large", memoryGb: 142, exclusive: false }),
        priority: "critical",
        deadlineMs: 20,
      }),
    ).rejects.toThrow(/timed out waiting/i);
  });

  it("rechecks external Ollama pressure and grants queued work after memory is released", async () => {
    let pressured = true;
    const inventoryReader = vi.fn(
      async (): Promise<OllamaInventory> => ({
        ...emptyInventory(),
        models: pressured
          ? [
              {
                name: "external-235b",
                model: "external-235b",
                sizeBytes: 142 * 1024 ** 3,
                loaded: true,
              },
            ]
          : [],
        totalLoadedBytes: pressured ? 142 * 1024 ** 3 : 0,
      }),
    );
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig({ resourceLimits: { queueDeadlineMs: 3_000 } }),
      inventoryReader,
    });
    const pending = scheduler.acquire({ model: model(), deadlineMs: 3_000 });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(scheduler.queueLength).toBe(1);
    pressured = false;
    const reservation = await pending;
    expect(inventoryReader).toHaveBeenCalledTimes(2);
    expect(reservation.waitedMs).toBeGreaterThanOrEqual(900);
    reservation.release();
  });

  it("waits instead of sending a fourth distinct model into Ollama's loaded-model queue", async () => {
    let occupied = true;
    const inventoryReader = vi.fn(
      async (): Promise<OllamaInventory> => ({
        ...emptyInventory(),
        models: occupied
          ? ["external-a", "external-b", "external-c"].map((name) => ({
              name,
              model: name,
              sizeBytes: 8 * 1024 ** 3,
              loaded: true,
            }))
          : ["external-a", "external-b"].map((name) => ({
              name,
              model: name,
              sizeBytes: 8 * 1024 ** 3,
              loaded: true,
            })),
        totalLoadedBytes: (occupied ? 24 : 16) * 1024 ** 3,
      }),
    );
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig({ resourceLimits: { queueDeadlineMs: 3_000 } }),
      inventoryReader,
    });
    const pending = scheduler.acquire({ model: model(), deadlineMs: 3_000 });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(scheduler.queueLength).toBe(1);
    occupied = false;
    const reservation = await pending;
    expect(reservation.waitedMs).toBeGreaterThanOrEqual(900);
    reservation.release();
  });

  it("allows remote work without consuming local memory slots", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig({ resourceLimits: { maxLocalParallel: 1 } }),
      inventoryReader: async () => emptyInventory(),
    });
    const local = await scheduler.acquire({ model: model() });
    const remote = await scheduler.acquire({
      model: model({
        id: "sol",
        provider: "codex",
        model: "gpt-5.6-sol",
        remote: true,
        memoryGb: 0,
      }),
    });
    expect(remote.reservedMemoryGb).toBe(0);
    local.release();
    remote.release();
  });

  it("removes abort listeners after a queued reservation is granted", async () => {
    const scheduler = new ResourceScheduler({
      config: resolveResearchManagerConfig(undefined),
      inventoryReader: async () => emptyInventory(),
    });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const reservation = await scheduler.acquire({ model: model(), signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    reservation.release();
  });
});

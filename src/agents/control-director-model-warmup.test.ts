import { describe, expect, it, vi } from "vitest";
import { warmConfiguredControlDirectorModel } from "./control-director-model-warmup.js";
import type { ControlDirectorResourceAssessment } from "./control-director-resource-admission.js";

const SELECTED = "ollama/openclaw-control-gemma4-31b-q8:latest";

function config() {
  return {};
}

function assessment(
  overrides: Partial<ControlDirectorResourceAssessment> = {},
): ControlDirectorResourceAssessment {
  return {
    configured: true,
    agentId: "director",
    selectedModel: SELECTED,
    activeOpenClawTaskCount: 0,
    activeControlDirectorRuns: 0,
    residency: {
      available: true,
      observedProcessCount: 0,
      residentModels: [],
      warnings: [],
    },
    admission: {
      decision: "admit",
      reason: "capacity is safe",
      selectedModel: SELECTED,
      residency: "load",
    },
    hostCapacity: {
      logicalCpuCount: 16,
      performanceCpuCount: 12,
      totalRamGb: 192,
      freeRamGb: 100,
      load1: 1,
      load5: 1,
      load15: 1,
      memoryPressure: "low",
      thermalPressure: "nominal",
      activeOpenClawTaskCount: 0,
      configuredSubagentLimit: 2,
      observedLocalModelProcessCount: 0,
      safeLocalAgentSlots: 2,
      timestamp: "2026-07-18T00:00:00.000Z",
      warnings: [],
    },
    capacity: {
      logicalCpuCount: 16,
      performanceCpuCount: 12,
      totalRamGb: 192,
      freeRamGb: 100,
      load1: 1,
      load5: 1,
      load15: 1,
      memoryPressure: "low",
      thermalPressure: "nominal",
      activeOpenClawTaskCount: 0,
      configuredSubagentLimit: 2,
      observedLocalModelProcessCount: 0,
      safeLocalAgentSlots: 1,
      timestamp: "2026-07-18T00:00:00.000Z",
      warnings: [],
    },
    ...overrides,
  };
}

describe("warmConfiguredControlDirectorModel", () => {
  it("does nothing when the selected model is already resident", async () => {
    const requestWarmup = vi.fn();
    const result = await warmConfiguredControlDirectorModel({
      config: config(),
      tasks: [],
      signal: new AbortController().signal,
      runtime: {
        assess: async () =>
          assessment({
            residency: {
              available: true,
              observedProcessCount: 1,
              residentModels: [{ ref: SELECTED, state: "idle", estimatedMemoryGb: 36 }],
              warnings: [],
            },
          }),
        requestWarmup,
      },
    });

    expect(result.status).toBe("already_resident");
    expect(requestWarmup).not.toHaveBeenCalled();
  });

  it("never evicts an idle model when the governor requires reclamation", async () => {
    const requestWarmup = vi.fn();
    const result = await warmConfiguredControlDirectorModel({
      config: config(),
      tasks: [],
      signal: new AbortController().signal,
      runtime: {
        assess: async () =>
          assessment({
            admission: {
              decision: "unload_idle_then_admit",
              reason: "idle eviction required",
              selectedModel: SELECTED,
              unloadModels: ["ollama/other"],
            },
          }),
        requestWarmup,
      },
    });

    expect(result).toMatchObject({ status: "deferred", reason: "idle eviction required" });
    expect(requestWarmup).not.toHaveBeenCalled();
  });

  it("warms only after admission and verifies exact provider residency", async () => {
    const requestWarmup = vi.fn(async () => ({
      available: true,
      ready: true,
      provider: "ollama",
      modelId: "openclaw-control-gemma4-31b-q8:latest",
      result: { modelId: "openclaw-control-gemma4-31b-q8:latest", ready: true },
      reason: "ready",
    }));
    const release = vi.fn(async () => undefined);
    const collectResidency = vi.fn(async () => ({
      available: true,
      observedProcessCount: 1,
      residentModels: [{ ref: SELECTED, state: "idle" as const, estimatedMemoryGb: 36 }],
      warnings: [],
    }));

    const result = await warmConfiguredControlDirectorModel({
      config: config(),
      tasks: [],
      signal: new AbortController().signal,
      runtime: {
        assess: async () => assessment(),
        requestWarmup,
        collectResidency,
        acquireSharedAdmission: async () => ({ release }) as never,
      },
    });

    expect(result.status).toBe("warmed");
    expect(requestWarmup).toHaveBeenCalledWith(
      expect.objectContaining({ selectedModel: SELECTED, keepAliveMs: 15 * 60_000 }),
    );
    expect(collectResidency).toHaveBeenCalledWith(
      expect.objectContaining({ selectedModel: SELECTED, timeoutMs: 3_000 }),
    );
  });

  it("fails closed when provider readiness is not observable", async () => {
    const result = await warmConfiguredControlDirectorModel({
      config: config(),
      tasks: [],
      signal: new AbortController().signal,
      runtime: {
        assess: async () => assessment(),
        requestWarmup: async () => ({
          available: false,
          ready: false,
          provider: "ollama",
          modelId: "model",
          reason: "hook unavailable",
        }),
        acquireSharedAdmission: async () => ({ release: vi.fn(async () => undefined) }) as never,
      },
    });

    expect(result).toMatchObject({ status: "failed", reason: "hook unavailable" });
  });
});

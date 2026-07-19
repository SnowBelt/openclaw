import { describe, expect, it } from "vitest";
import type { PccExecutionCapacitySnapshot } from "../pcc/execution-capacity.js";
import { decideControlDirectorResourceAdmission } from "./control-director-resource-governor.js";

function capacity(
  overrides: Partial<PccExecutionCapacitySnapshot> = {},
): PccExecutionCapacitySnapshot {
  return {
    logicalCpuCount: 24,
    performanceCpuCount: 16,
    totalRamGb: 192,
    freeRamGb: 96,
    load1: 1,
    load5: 1,
    load15: 1,
    memoryPressure: "low",
    thermalPressure: "nominal",
    activeOpenClawTaskCount: 0,
    configuredSubagentLimit: 4,
    observedLocalModelProcessCount: 0,
    safeLocalAgentSlots: 2,
    timestamp: "2026-07-18T00:00:00.000Z",
    warnings: [],
    ...overrides,
  };
}

describe("Control Director resource governor", () => {
  it("admits an already resident model without reloading it", () => {
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/gemma",
        capacity: capacity(),
        residentModels: [{ ref: "ollama/gemma", state: "idle", estimatedMemoryGb: 36 }],
      }),
    ).toMatchObject({ decision: "admit", residency: "already_resident" });
  });

  it("evicts only idle models when doing so restores the Gateway memory reserve", () => {
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/gemma",
        capacity: capacity({ freeRamGb: 20 }),
        residentModels: [{ ref: "ollama/old", state: "idle", estimatedMemoryGb: 30 }],
      }),
    ).toMatchObject({
      decision: "unload_idle_then_admit",
      unloadModels: ["ollama/old"],
    });
  });

  it("queues instead of evicting active work or overloading memory, capacity, or thermals", () => {
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/gemma",
        capacity: capacity(),
        residentModels: [{ ref: "ollama/active", state: "active", estimatedMemoryGb: 30 }],
      }),
    ).toMatchObject({ decision: "queue", retryWhen: "active_model" });
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/gemma",
        capacity: capacity({ freeRamGb: 20 }),
      }),
    ).toMatchObject({ decision: "queue", retryWhen: "memory" });
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/gemma",
        capacity: capacity({ thermalPressure: "serious" }),
      }),
    ).toMatchObject({ decision: "queue", retryWhen: "thermal" });
    expect(
      decideControlDirectorResourceAdmission({
        selectedModel: "ollama/gemma",
        capacity: capacity(),
        activeControlDirectorRuns: 1,
      }),
    ).toMatchObject({ decision: "queue", retryWhen: "capacity" });
  });
});

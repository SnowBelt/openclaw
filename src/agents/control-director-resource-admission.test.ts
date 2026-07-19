import { describe, expect, it, vi } from "vitest";
import type { PccExecutionCapacitySnapshot } from "../pcc/execution-capacity.js";
import { assessControlDirectorResourceAdmission } from "./control-director-resource-admission.js";

function config() {
  return {
    models: {
      providers: {
        ollama: {
          models: [{ id: "openclaw-control-gemma4-31b-q8:latest" }],
        },
      },
    },
    agents: {
      defaults: { subagents: { maxConcurrent: 2 } },
      list: [
        {
          id: "director",
          role: "control_director" as const,
          model: "ollama/openclaw-control-gemma4-31b-q8:latest",
        },
      ],
    },
  };
}

function capacity(): PccExecutionCapacitySnapshot {
  return {
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
  };
}

describe("assessControlDirectorResourceAdmission", () => {
  it("admits the evaluated model from one shared resource projection", async () => {
    const collectCapacity = vi.fn(() => capacity());
    const assessment = await assessControlDirectorResourceAdmission({
      config: config(),
      tasks: [],
      runtime: {
        collectCapacity,
        collectResidency: vi.fn(async () => ({
          available: true,
          observedProcessCount: 0,
          residentModels: [],
          warnings: [],
        })),
      },
    });

    expect(assessment).toMatchObject({
      configured: true,
      agentId: "director",
      activeOpenClawTaskCount: 0,
      admission: { decision: "admit", residency: "load" },
      capacity: { safeLocalAgentSlots: 1 },
    });
    expect(collectCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ configuredSubagentLimit: 2 }),
    );
  });

  it("fails closed when the provider residency probe is unavailable", async () => {
    const assessment = await assessControlDirectorResourceAdmission({
      config: config(),
      tasks: [],
      runtime: {
        collectCapacity: () => capacity(),
        collectResidency: async () => ({
          available: false,
          observedProcessCount: 0,
          residentModels: [],
          warnings: ["probe unavailable"],
        }),
      },
    });

    expect(assessment.admission).toMatchObject({
      decision: "queue",
      reason: expect.stringContaining("residency is unavailable"),
    });
    expect(assessment.capacity.safeLocalAgentSlots).toBe(0);
  });

  it("counts role-owned work and prevents a second large local run", async () => {
    const assessment = await assessControlDirectorResourceAdmission({
      config: config(),
      tasks: [{ status: "running", agentId: "director", ownerKey: "agent:director:chat" }],
      runtime: {
        collectCapacity: () => ({ ...capacity(), activeOpenClawTaskCount: 1 }),
        collectResidency: async () => ({
          available: true,
          observedProcessCount: 1,
          residentModels: [
            {
              ref: "ollama/openclaw-control-gemma4-31b-q8:latest",
              state: "idle",
              estimatedMemoryGb: 36,
            },
          ],
          warnings: [],
        }),
      },
    });

    expect(assessment.activeControlDirectorRuns).toBe(1);
    expect(assessment.admission).toMatchObject({ decision: "queue", retryWhen: "capacity" });
  });
});

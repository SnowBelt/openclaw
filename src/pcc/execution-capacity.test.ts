import { describe, expect, it } from "vitest";
import {
  buildPccExecutionCapacitySnapshot,
  recommendPccExecutionCapacity,
} from "./execution-capacity.js";
import type {
  PccExecutionCapacityHostValues,
  PccExecutionCapacityInput,
} from "./execution-capacity.js";

const GIB = 1024 ** 3;

type SnapshotOverrides = Partial<Omit<PccExecutionCapacityInput, "host">> & {
  host?: Partial<PccExecutionCapacityHostValues>;
};

function snapshot({ host: hostOverrides, ...overrides }: SnapshotOverrides = {}) {
  return buildPccExecutionCapacitySnapshot({
    host: {
      logicalCpuCount: 28,
      performanceCpuCount: 20,
      totalMemoryBytes: 256 * GIB,
      freeMemoryBytes: 200 * GIB,
      loadAverage: [1, 1, 1],
      timestamp: "2026-07-13T00:00:00.000Z",
      ...hostOverrides,
    },
    activeOpenClawTaskCount: 0,
    configuredSubagentLimit: 12,
    observedLocalModelProcessCount: 0,
    ...overrides,
  });
}

describe("PCC execution capacity", () => {
  it("assesses an idle M3 Ultra-like host without treating unified RAM as VRAM", () => {
    const result = snapshot();

    expect(result).toMatchObject({
      logicalCpuCount: 28,
      performanceCpuCount: 20,
      totalRamGb: 256,
      freeRamGb: 200,
      memoryPressure: "low",
      safeLocalAgentSlots: 5,
      timestamp: "2026-07-13T00:00:00.000Z",
    });
    expect(result.warnings).not.toContain(expect.stringContaining("VRAM"));
  });

  it("reports zero spare capacity when existing work saturates the host", () => {
    const result = snapshot({ activeOpenClawTaskCount: 5, observedLocalModelProcessCount: 1 });

    expect(result.safeLocalAgentSlots).toBe(0);
    expect(result.warnings).toContain("No spare local agent capacity is available.");
  });

  it("fails closed to zero slots under high CPU load", () => {
    const result = snapshot({ host: { loadAverage: [29, 28, 25] } });

    expect(result.safeLocalAgentSlots).toBe(0);
    expect(result.warnings).toContain(
      "One-minute CPU load is at or above logical CPU capacity; no spare slots remain.",
    );
  });

  it("fails closed to zero slots when free RAM is critically low", () => {
    const result = snapshot({ host: { freeMemoryBytes: 20 * GIB } });

    expect(result.memoryPressure).toBe("high");
    expect(result.safeLocalAgentSlots).toBe(0);
  });

  it("keeps every policy constrained by the configured subagent limit", () => {
    const result = snapshot({ configuredSubagentLimit: 3 });

    expect(result.safeLocalAgentSlots).toBe(3);
    expect(recommendPccExecutionCapacity(result, "automatic").slots).toBe(3);
    expect(recommendPccExecutionCapacity(result, "maximum_safe").slots).toBe(3);
    expect(recommendPccExecutionCapacity(result, "conservative").slots).toBe(2);
  });

  it("uses logical CPUs conservatively when performance-core count is unavailable", () => {
    const result = snapshot({ host: { performanceCpuCount: null } });

    expect(result.performanceCpuCount).toBeNull();
    expect(result.safeLocalAgentSlots).toBe(7);
    expect(result.warnings).toContain(
      "Performance-core count is unavailable; using logical CPU count conservatively.",
    );
  });
});

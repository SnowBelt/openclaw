import { describe, expect, it } from "vitest";
import { parseLinuxMemInfo, parseMacosMemoryPressure } from "./host-memory-probe.js";

describe("Operations Room host memory probe", () => {
  it("uses macOS pressure availability instead of treating reclaimable RAM as used", () => {
    const result = parseMacosMemoryPressure({
      raw: "System-wide memory free percentage: 79%\n",
      totalMemoryBytes: 1000,
      freeMemoryBytes: 500,
    });

    expect(result).toMatchObject({
      availableMemoryBytes: 790,
      usedMemoryBytes: 210,
      memoryUsedPercent: 21,
      availabilitySource: "macos_memory_pressure",
    });
  });

  it("uses Linux MemAvailable and preserves the smaller raw free count", () => {
    const result = parseLinuxMemInfo(
      "MemTotal:       1000 kB\nMemFree:         100 kB\nMemAvailable:    650 kB\n",
    );

    expect(result).toMatchObject({
      totalMemoryBytes: 1_024_000,
      freeMemoryBytes: 102_400,
      availableMemoryBytes: 665_600,
      usedMemoryBytes: 358_400,
      memoryUsedPercent: 35,
      availabilitySource: "linux_mem_available",
    });
  });

  it("rejects malformed probe output", () => {
    expect(
      parseMacosMemoryPressure({ raw: "unknown", totalMemoryBytes: 1000, freeMemoryBytes: 100 }),
    ).toBeNull();
    expect(parseLinuxMemInfo("MemTotal: 1000 kB\n")).toBeNull();
  });
});

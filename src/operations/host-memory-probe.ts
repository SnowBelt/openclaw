// Cross-platform host memory probe. Linux MemAvailable and macOS
// memory_pressure are preferred over raw free pages because filesystem cache
// and reclaimable pages should not be reported as unavailable RAM.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OperationsHostMemoryProbe = {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  availableMemoryBytes: number;
  usedMemoryBytes: number;
  memoryUsedPercent: number;
  availabilitySource: "macos_memory_pressure" | "linux_mem_available" | "free_memory";
};

function boundedMemoryProbe(params: {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  availableMemoryBytes: number;
  availabilitySource: OperationsHostMemoryProbe["availabilitySource"];
}): OperationsHostMemoryProbe {
  const totalMemoryBytes = Math.max(0, params.totalMemoryBytes);
  const freeMemoryBytes = Math.max(0, Math.min(totalMemoryBytes, params.freeMemoryBytes));
  const availableMemoryBytes = Math.max(
    freeMemoryBytes,
    Math.min(totalMemoryBytes, params.availableMemoryBytes),
  );
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - availableMemoryBytes);
  return {
    totalMemoryBytes,
    freeMemoryBytes,
    availableMemoryBytes,
    usedMemoryBytes,
    memoryUsedPercent:
      totalMemoryBytes > 0 ? Math.round((usedMemoryBytes / totalMemoryBytes) * 1_000) / 10 : 0,
    availabilitySource: params.availabilitySource,
  };
}

export function parseMacosMemoryPressure(params: {
  raw: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
}): OperationsHostMemoryProbe | null {
  const match = params.raw.match(/System-wide memory free percentage:\s*([\d.]+)%/i);
  if (!match) {
    return null;
  }
  const availablePercent = Number(match[1]);
  if (!Number.isFinite(availablePercent) || availablePercent < 0 || availablePercent > 100) {
    return null;
  }
  return boundedMemoryProbe({
    totalMemoryBytes: params.totalMemoryBytes,
    freeMemoryBytes: params.freeMemoryBytes,
    availableMemoryBytes: params.totalMemoryBytes * (availablePercent / 100),
    availabilitySource: "macos_memory_pressure",
  });
}

export function parseLinuxMemInfo(raw: string): OperationsHostMemoryProbe | null {
  const values = new Map<string, number>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (match) {
      values.set(match[1], Number(match[2]) * 1024);
    }
  }
  const totalMemoryBytes = values.get("MemTotal");
  const availableMemoryBytes = values.get("MemAvailable");
  const freeMemoryBytes = values.get("MemFree") ?? 0;
  if (!totalMemoryBytes || availableMemoryBytes == null) {
    return null;
  }
  return boundedMemoryProbe({
    totalMemoryBytes,
    freeMemoryBytes,
    availableMemoryBytes,
    availabilitySource: "linux_mem_available",
  });
}

function fallbackHostMemoryProbe(): OperationsHostMemoryProbe {
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  return boundedMemoryProbe({
    totalMemoryBytes,
    freeMemoryBytes,
    availableMemoryBytes: freeMemoryBytes,
    availabilitySource: "free_memory",
  });
}

export async function collectOperationsHostMemory(): Promise<OperationsHostMemoryProbe> {
  const fallback = fallbackHostMemoryProbe();
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("/usr/bin/memory_pressure", ["-Q"], {
        timeout: 2_000,
        maxBuffer: 64 * 1024,
      });
      return (
        parseMacosMemoryPressure({
          raw: stdout,
          totalMemoryBytes: fallback.totalMemoryBytes,
          freeMemoryBytes: fallback.freeMemoryBytes,
        }) ?? fallback
      );
    }
    if (process.platform === "linux") {
      return parseLinuxMemInfo(await readFile("/proc/meminfo", "utf8")) ?? fallback;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

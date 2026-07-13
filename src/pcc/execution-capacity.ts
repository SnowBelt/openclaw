import os from "node:os";

export type PccMemoryPressure = "low" | "medium" | "high";
export type PccExecutionCapacityPolicy = "automatic" | "conservative" | "maximum_safe";

/** Serializable host facts. Callers may supply these to make capacity decisions deterministic. */
export type PccExecutionCapacityHostValues = {
  logicalCpuCount: number;
  performanceCpuCount?: number | null;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  loadAverage: readonly [number, number, number];
  timestamp?: string;
};

export type PccExecutionCapacityInput = {
  host: PccExecutionCapacityHostValues;
  activeOpenClawTaskCount: number;
  configuredSubagentLimit: number;
  observedLocalModelProcessCount: number;
};

/** Browser-safe capacity assessment. It contains no host handles or process details. */
export type PccExecutionCapacitySnapshot = {
  logicalCpuCount: number;
  performanceCpuCount: number | null;
  totalRamGb: number;
  freeRamGb: number;
  load1: number;
  load5: number;
  load15: number;
  memoryPressure: PccMemoryPressure;
  activeOpenClawTaskCount: number;
  configuredSubagentLimit: number;
  observedLocalModelProcessCount: number;
  safeLocalAgentSlots: number;
  timestamp: string;
  warnings: string[];
};

export type PccExecutionCapacityRecommendation = {
  policy: PccExecutionCapacityPolicy;
  slots: number;
  rationale: string[];
};

const GIB = 1024 ** 3;
const MAX_SLOTS = 12;

function finiteNonNegative(value: number | undefined | null): number {
  return Number.isFinite(value) && value != null ? Math.max(0, value) : 0;
}

function wholeNonNegative(value: number | undefined | null): number {
  return Math.floor(finiteNonNegative(value));
}

function boundedSlots(value: number): number {
  return Math.max(0, Math.min(MAX_SLOTS, Math.floor(value)));
}

function roundedGb(bytes: number): number {
  return Math.round((finiteNonNegative(bytes) / GIB) * 10) / 10;
}

function resolveMemoryPressure(
  totalMemoryBytes: number,
  freeMemoryBytes: number,
): PccMemoryPressure {
  if (totalMemoryBytes <= 0) {
    return "high";
  }
  const freeRatio = freeMemoryBytes / totalMemoryBytes;
  if (freeRatio <= 0.1) {
    return "high";
  }
  if (freeRatio <= 0.25) {
    return "medium";
  }
  return "low";
}

/**
 * Creates a conservative local-agent capacity snapshot from supplied host facts.
 * Unified memory is treated only as RAM: this helper intentionally never estimates VRAM.
 */
export function buildPccExecutionCapacitySnapshot(
  input: PccExecutionCapacityInput,
): PccExecutionCapacitySnapshot {
  const reportedLogicalCpuCount = wholeNonNegative(input.host.logicalCpuCount);
  const logicalCpuCount = Math.max(1, reportedLogicalCpuCount);
  const performanceCpuCount =
    input.host.performanceCpuCount == null || wholeNonNegative(input.host.performanceCpuCount) === 0
      ? null
      : wholeNonNegative(input.host.performanceCpuCount);
  const totalMemoryBytes = finiteNonNegative(input.host.totalMemoryBytes);
  const freeMemoryBytes = Math.min(totalMemoryBytes, finiteNonNegative(input.host.freeMemoryBytes));
  const [rawLoad1, rawLoad5, rawLoad15] = input.host.loadAverage;
  const load1 = finiteNonNegative(rawLoad1);
  const load5 = finiteNonNegative(rawLoad5);
  const load15 = finiteNonNegative(rawLoad15);
  const activeOpenClawTaskCount = wholeNonNegative(input.activeOpenClawTaskCount);
  const configuredSubagentLimit = wholeNonNegative(input.configuredSubagentLimit);
  const observedLocalModelProcessCount = wholeNonNegative(input.observedLocalModelProcessCount);
  const memoryPressure = resolveMemoryPressure(totalMemoryBytes, freeMemoryBytes);
  const warnings: string[] = [];

  if (input.host.performanceCpuCount == null) {
    warnings.push("Performance-core count is unavailable; using logical CPU count conservatively.");
  }
  if (reportedLogicalCpuCount === 0) {
    warnings.push("Logical CPU count is unavailable; no local agent slots are available.");
  }
  if (configuredSubagentLimit < 1) {
    warnings.push(
      "Configured subagent limit is zero or invalid; no local agent slots are available.",
    );
  }
  if (totalMemoryBytes <= 0) {
    warnings.push("Host memory total is unavailable; no local agent slots are available.");
  }

  const cpuCapacity =
    reportedLogicalCpuCount > 0
      ? Math.max(1, Math.floor((performanceCpuCount ?? logicalCpuCount) / 4))
      : 0;
  const memoryCapacity =
    totalMemoryBytes > 0 ? Math.max(1, Math.floor(freeMemoryBytes / (16 * GIB))) : 0;
  const configuredCapacity = boundedSlots(configuredSubagentLimit);
  let hostCapacity = Math.min(cpuCapacity, memoryCapacity, configuredCapacity, MAX_SLOTS);
  const loadRatio = load1 / logicalCpuCount;

  // Keep the gateway responsive before assigning spare CPU to local agent work.
  if (loadRatio >= 1) {
    hostCapacity = 0;
    warnings.push(
      "One-minute CPU load is at or above logical CPU capacity; no spare slots remain.",
    );
  } else if (loadRatio >= 0.75) {
    hostCapacity = Math.min(hostCapacity, 2);
    warnings.push("One-minute CPU load is high; limiting local agent capacity.");
  } else if (loadRatio >= 0.5) {
    hostCapacity = Math.max(1, Math.floor(hostCapacity / 2));
    warnings.push("One-minute CPU load is elevated; reducing local agent capacity.");
  }

  if (memoryPressure === "high") {
    hostCapacity = 0;
    warnings.push("Free RAM is critically low; no spare slots remain for the gateway.");
  } else if (memoryPressure === "medium") {
    hostCapacity = Math.min(hostCapacity, 2);
    warnings.push("Free RAM is limited; limiting local agent capacity.");
  }

  const occupiedSlots = activeOpenClawTaskCount + observedLocalModelProcessCount;
  const safeLocalAgentSlots = boundedSlots(hostCapacity - occupiedSlots);
  if (occupiedSlots > 0) {
    warnings.push("Active OpenClaw tasks and local model processes reduce spare local capacity.");
  }
  if (safeLocalAgentSlots === 0) {
    warnings.push("No spare local agent capacity is available.");
  }

  return {
    logicalCpuCount,
    performanceCpuCount,
    totalRamGb: roundedGb(totalMemoryBytes),
    freeRamGb: roundedGb(freeMemoryBytes),
    load1,
    load5,
    load15,
    memoryPressure,
    activeOpenClawTaskCount,
    configuredSubagentLimit,
    observedLocalModelProcessCount,
    safeLocalAgentSlots,
    timestamp: input.host.timestamp ?? new Date().toISOString(),
    warnings,
  };
}

export function recommendPccExecutionCapacity(
  snapshot: PccExecutionCapacitySnapshot,
  policy: PccExecutionCapacityPolicy = "automatic",
): PccExecutionCapacityRecommendation {
  const maximumSafe = Math.min(
    snapshot.safeLocalAgentSlots,
    boundedSlots(snapshot.configuredSubagentLimit),
    MAX_SLOTS,
  );
  const slots = policy === "conservative" ? Math.min(maximumSafe, 2) : maximumSafe;
  const rationale = [
    `Host-safe capacity is ${maximumSafe} local agent slot${maximumSafe === 1 ? "" : "s"}.`,
  ];
  if (policy === "conservative") {
    rationale.push("Conservative policy caps parallel local agents at two slots.");
  }
  if (snapshot.memoryPressure !== "low") {
    rationale.push("Memory pressure is constraining the recommendation.");
  }
  return { policy, slots, rationale };
}

/** Collects the only runtime host facts needed for a serializable PCC capacity snapshot. */
export function collectPccExecutionCapacitySnapshot(
  input: Omit<PccExecutionCapacityInput, "host">,
): PccExecutionCapacitySnapshot {
  const snapshot = buildPccExecutionCapacitySnapshot({
    ...input,
    host: {
      logicalCpuCount: os.cpus().length,
      performanceCpuCount: null,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      loadAverage: os.loadavg() as [number, number, number],
    },
  });
  return {
    ...snapshot,
    warnings: [
      ...snapshot.warnings,
      "External local-model process occupancy is unavailable; this is a CPU/RAM safety ceiling, not a throughput guarantee.",
    ],
  };
}

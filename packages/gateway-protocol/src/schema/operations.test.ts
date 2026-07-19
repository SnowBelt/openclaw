import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  validateOperationsActionApplyParams,
  validateOperationsActionPreviewParams,
  validateOperationsSnapshotParams,
} from "../index.js";
import { OperationsSnapshotResultSchema } from "./operations.js";

describe("Operations Room protocol", () => {
  it("accepts bounded snapshot and guarded action requests", () => {
    expect(validateOperationsSnapshotParams({})).toBe(true);
    expect(validateOperationsSnapshotParams({ includeProcesses: false })).toBe(true);
    expect(validateOperationsActionPreviewParams({ action: "cron.run", targetId: "cron-1" })).toBe(
      true,
    );
    expect(
      validateOperationsActionApplyParams({
        token: "preview-1",
        action: "flow.cancel",
        targetId: "flow-1",
      }),
    ).toBe(true);
  });

  it("rejects unknown fields and unsupported actions", () => {
    expect(validateOperationsSnapshotParams({ includeSecrets: true })).toBe(false);
    expect(validateOperationsActionPreviewParams({ action: "process.kill", targetId: "42" })).toBe(
      false,
    );
    expect(
      validateOperationsActionApplyParams({
        token: "preview-1",
        action: "cron.run",
        targetId: "",
      }),
    ).toBe(false);
  });

  it("validates the bounded public snapshot result", () => {
    const now = Date.now();
    const snapshot = {
      schema: "openclaw.operations-room.v1",
      generatedAt: now,
      qualityTarget: 93,
      qualityScore: 100,
      overallStatus: "healthy",
      summary: {
        agents: 0,
        workingAgents: 0,
        attentionAgents: 0,
        tasks: 0,
        activeTasks: 0,
        failedTasks: 0,
        workflows: 0,
        activeWorkflows: 0,
        cronJobs: 0,
        failingCronJobs: 0,
        plugins: 0,
        skills: 0,
        tools: 0,
        models: 0,
        findings: 0,
        criticalFindings: 0,
      },
      host: {
        hostname: "studio",
        platform: "darwin",
        arch: "arm64",
        uptimeMs: null,
        logicalCpuCount: 12,
        loadAverage: [1, 1, 1],
        totalMemoryBytes: 100,
        freeMemoryBytes: 40,
        availableMemoryBytes: 60,
        usedMemoryBytes: 40,
        memoryUsedPercent: 40,
        memoryAvailabilitySource: "macos_memory_pressure",
        processRssBytes: 10,
        processHeapUsedBytes: 5,
        processHeapTotalBytes: 8,
        status: "healthy",
      },
      agents: [],
      tasks: [],
      workflows: [],
      cronJobs: [],
      skills: [],
      plugins: [],
      tools: [],
      models: [],
      processes: [],
      findings: [],
      reconciler: {
        mode: "shadow",
        autoRemediationEnabled: false,
        intervalMs: 60_000,
        lastSweepAt: now,
        nextSweepAt: now + 60_000,
        recommendedActionCount: 0,
        ruleCount: 9,
        note: "Local deterministic monitor.",
      },
      controls: {
        mode: "guarded",
        previewRequired: true,
        supportedActions: ["cron.run"],
        note: "Confirmation required.",
      },
    };

    expect(Value.Check(OperationsSnapshotResultSchema, snapshot)).toBe(true);
    expect(Value.Check(OperationsSnapshotResultSchema, { ...snapshot, secret: "no" })).toBe(false);
  });
});

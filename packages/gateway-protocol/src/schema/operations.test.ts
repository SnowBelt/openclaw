import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  validateOperationsActionApplyParams,
  validateOperationsActionPreviewParams,
  validateOperationsSnapshotParams,
  validateOperationsSnapshotV1Params,
  validateOperationsSnapshotV2Params,
} from "../index.js";
import { assertOperationsSnapshotV2Integrity } from "../operations-snapshot-integrity.js";
import { OperationsSnapshotResultSchema, OperationsSnapshotV2ResultSchema } from "./operations.js";
import type { OperationsSnapshotV2Result } from "./types.js";

describe("Operations Room protocol", () => {
  it("accepts bounded snapshot and guarded action requests", () => {
    expect(validateOperationsSnapshotParams({})).toBe(true);
    expect(validateOperationsSnapshotParams({ includeProcesses: false })).toBe(true);
    expect(validateOperationsSnapshotV1Params({ includeProcesses: false })).toBe(true);
    expect(validateOperationsSnapshotV2Params({ includeProcesses: false })).toBe(true);
    expect(validateOperationsActionPreviewParams({ action: "cron.run", targetId: "cron-1" })).toBe(
      true,
    );
    expect(
      validateOperationsActionPreviewParams({
        action: "remediation.investigate",
        targetId: "plugin:example:failed",
      }),
    ).toBe(true);
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
    const snapshot: OperationsSnapshotV2Result = {
      schema: "openclaw.operations-room.v2",
      generatedAt: now,
      snapshotId: "snapshot-1",
      freshness: {
        status: "fresh",
        observedAt: now,
        staleAfterMs: 120_000,
        sources: {
          agents: { status: "available", observedAt: now },
          tasks: { status: "available", observedAt: now },
          workflows: { status: "available", observedAt: now },
          schedules: { status: "available", observedAt: now },
          capabilities: { status: "available", observedAt: now },
          models: { status: "available", observedAt: now },
          processes: { status: "omitted", observedAt: now },
          event_loop: { status: "available", observedAt: now },
          monitor: { status: "available", observedAt: now },
          incident_ledger: { status: "available", observedAt: now },
        },
      },
      completeness: { status: "complete", unavailableSources: [], fallbackSources: [] },
      briefing: { tone: "normal", text: "Everything is ready. No work needs your attention." },
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
        actionableFindings: 0,
        historicalFindings: 0,
        needsUserFindings: 0,
        handlingFindings: 0,
        watchingFindings: 0,
        criticalFindings: 0,
      },
      collections: {
        agents: { total: 0, shown: 0, truncated: false },
        tasks: { total: 0, shown: 0, truncated: false },
        workflows: { total: 0, shown: 0, truncated: false },
        cronJobs: { total: 0, shown: 0, truncated: false },
        skills: { total: 0, shown: 0, truncated: false },
        plugins: { total: 0, shown: 0, truncated: false },
        tools: { total: 0, shown: 0, truncated: false },
        models: { total: 0, shown: 0, truncated: false },
        processes: { total: 1, shown: 0, truncated: true, rejected: 2 },
        findings: { total: 0, shown: 0, truncated: false },
        activityRollups: { total: 0, shown: 0, truncated: false },
        incidentHistory: { total: 0, shown: 0, truncated: false },
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
        localModelProcessCount: 2,
        localModelRssBytes: 30,
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
      activityRollups: [],
      incidentHistory: [],
      remediationHistory: [
        {
          id: "repair-1",
          findingId: "cron:job-1:failure",
          findingTitle: "Schedule failed",
          findingCategory: "cron",
          findingEntityId: "job-1",
          impact: "Future runs may fail.",
          recipeId: "cron.pause-repeated-failures.v1",
          risk: "medium",
          status: "completed",
          ownerId: "OpenClaw",
          exactRepair: "Pause schedule job-1.",
          progress: "Repair verified.",
          result: "Schedule job-1 is paused.",
          evidence: ["Read-back verified disabled."],
          rollback: "Re-enable schedule job-1.",
          undoAvailable: true,
          undoAction: "cron.enable",
          undoTargetId: "job-1",
          automatic: true,
          startedAt: now - 2_000,
          updatedAt: now - 1_000,
          completedAt: now - 1_000,
        },
      ],
      incidentLedger: { overflowCount: 0 },
      reconciler: {
        mode: "shadow",
        autoRemediationEnabled: false,
        intervalMs: 60_000,
        lastAttemptAt: now,
        lastSweepAt: now,
        nextSweepAt: now + 60_000,
        attemptCount: 2,
        sweepCount: 2,
        recommendedActionCount: 0,
        ruleCount: 10,
        note: "Local deterministic monitor.",
      },
      controls: {
        mode: "guarded",
        previewRequired: true,
        supportedActions: ["cron.run"],
        note: "Confirmation required.",
      },
    };

    expect(Value.Check(OperationsSnapshotV2ResultSchema, snapshot)).toBe(true);
    expect(() => assertOperationsSnapshotV2Integrity(snapshot)).not.toThrow();
    expect(snapshot.collections.processes.rejected).toBe(2);
    expect(Value.Check(OperationsSnapshotV2ResultSchema, { ...snapshot, secret: "no" })).toBe(
      false,
    );
    expect(
      Value.Check(OperationsSnapshotV2ResultSchema, {
        ...snapshot,
        collections: {
          ...snapshot.collections,
          processes: { ...snapshot.collections.processes, rejected: -1 },
        },
      }),
    ).toBe(false);
    expect(Value.Check(OperationsSnapshotResultSchema, snapshot)).toBe(false);
  });

  it("rejects cross-field contradictions that JSON Schema cannot express", () => {
    const snapshot = {
      summary: {
        agents: 0,
        tasks: 0,
        workflows: 0,
        cronJobs: 0,
        skills: 0,
        plugins: 0,
        tools: 0,
        models: 0,
        findings: 0,
        actionableFindings: 0,
        historicalFindings: 0,
        needsUserFindings: 0,
        handlingFindings: 0,
        watchingFindings: 0,
        criticalFindings: 0,
      },
      collections: {
        agents: { total: 0, shown: 0, truncated: false },
        tasks: { total: 0, shown: 0, truncated: false },
        workflows: { total: 0, shown: 0, truncated: false },
        cronJobs: { total: 0, shown: 0, truncated: false },
        skills: { total: 0, shown: 0, truncated: false },
        plugins: { total: 0, shown: 0, truncated: false },
        tools: { total: 0, shown: 0, truncated: false },
        models: { total: 0, shown: 0, truncated: false },
        processes: { total: 0, shown: 0, truncated: false },
        findings: { total: 0, shown: 0, truncated: false },
        activityRollups: { total: 0, shown: 0, truncated: false },
        incidentHistory: { total: 0, shown: 0, truncated: false },
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
      activityRollups: [],
      incidentHistory: [],
    } as unknown as OperationsSnapshotV2Result;

    const shownMismatch = structuredClone(snapshot);
    shownMismatch.collections.agents = { total: 1, shown: 1, truncated: false };
    expect(() => assertOperationsSnapshotV2Integrity(shownMismatch)).toThrow(
      "agents.shown is 1, but 0 rows were provided",
    );

    const shownExceedsTotal = structuredClone(snapshot);
    shownExceedsTotal.processes = [
      { pid: 1, parentPid: 0, command: "node", rssBytes: 1, cpuPercent: 0, kind: "gateway" },
    ];
    shownExceedsTotal.collections.processes = { total: 0, shown: 1, truncated: false };
    expect(() => assertOperationsSnapshotV2Integrity(shownExceedsTotal)).toThrow(
      "processes.shown exceeds processes.total",
    );

    const badTruncation = structuredClone(snapshot);
    badTruncation.collections.processes = { total: 1, shown: 0, truncated: false };
    expect(() => assertOperationsSnapshotV2Integrity(badTruncation)).toThrow(
      "processes.truncated does not match shown and total",
    );

    const badSummary = structuredClone(snapshot);
    badSummary.summary.tasks = 1;
    expect(() => assertOperationsSnapshotV2Integrity(badSummary)).toThrow(
      "summary.tasks does not match collections.tasks.total",
    );

    const badFindingLanes = structuredClone(snapshot);
    badFindingLanes.summary.findings = 1;
    badFindingLanes.collections.findings = { total: 1, shown: 0, truncated: true };
    expect(() => assertOperationsSnapshotV2Integrity(badFindingLanes)).toThrow(
      "actionable and historical finding counts do not equal total findings",
    );

    const badVisibleLane = structuredClone(snapshot);
    badVisibleLane.findings = [
      {
        id: "finding-1",
        severity: "warning",
        category: "workflow",
        title: "Finding",
        detail: "Detail",
        lastObservedAt: 1,
        disposition: "handling",
        responseState: "in_progress",
        impact: "Impact",
      },
    ];
    badVisibleLane.collections.findings = { total: 1, shown: 1, truncated: false };
    badVisibleLane.summary.findings = 1;
    badVisibleLane.summary.actionableFindings = 1;
    badVisibleLane.summary.needsUserFindings = 1;
    expect(() => assertOperationsSnapshotV2Integrity(badVisibleLane)).toThrow(
      "visible needs_user finding count conflicts with summary",
    );
  });
});

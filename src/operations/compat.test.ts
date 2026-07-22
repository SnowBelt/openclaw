import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  OperationsSnapshotV1ResultSchema,
  OperationsSnapshotV2ResultSchema,
} from "../../packages/gateway-protocol/src/schema/operations.js";
import { projectOperationsSnapshotV1 } from "./compat.js";
import type { OperationsSnapshot } from "./types.js";

function v2Snapshot(): OperationsSnapshot {
  const now = 1_750_000_000_000;
  return {
    schema: "openclaw.operations-room.v2",
    generatedAt: now,
    snapshotId: "snapshot-v2",
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
        processes: { status: "omitted" },
        event_loop: { status: "available", observedAt: now },
        monitor: { status: "available", observedAt: now },
        incident_ledger: { status: "available", observedAt: now },
      },
    },
    completeness: { status: "complete", unavailableSources: [], fallbackSources: [] },
    briefing: { tone: "normal", text: "Everything is ready." },
    qualityTarget: 93,
    qualityScore: 100,
    overallStatus: "working",
    summary: {
      agents: 1,
      workingAgents: 1,
      attentionAgents: 0,
      tasks: 1,
      activeTasks: 1,
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
      agents: { total: 1, shown: 1, truncated: false },
      tasks: { total: 1, shown: 1, truncated: false },
      workflows: { total: 0, shown: 0, truncated: false },
      cronJobs: { total: 0, shown: 0, truncated: false },
      skills: { total: 0, shown: 0, truncated: false },
      plugins: { total: 0, shown: 0, truncated: false },
      tools: { total: 0, shown: 0, truncated: false },
      models: { total: 0, shown: 0, truncated: false },
      processes: { total: 0, shown: 0, truncated: false },
      findings: { total: 0, shown: 0, truncated: false },
      activityRollups: { total: 1, shown: 1, truncated: false },
      incidentHistory: { total: 0, shown: 0, truncated: false },
    },
    host: {
      hostname: "studio",
      platform: "darwin",
      arch: "arm64",
      uptimeMs: 1_000,
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
      eventLoopLagMs: 4,
      status: "healthy",
    },
    agents: [
      {
        id: "main",
        name: "Control Director",
        workspace: "/workspace",
        duty: "always_on",
        dutySource: "heartbeat",
        status: "working",
        activityState: "working",
        healthState: "healthy",
        attentionState: "none",
        model: "local/model",
        fallbackModels: [],
        activeTaskCount: 1,
        blockedTaskCount: 0,
        latestTask: "raw prompt must not cross the compatibility boundary",
        latestActivityAt: now,
        currentWork: {
          taskId: "task-1",
          title: "Safe summary",
          summary: "Visible progress. OpenClaw runtime context (internal): hidden prompt material",
          updatedAt: now,
          outcome: "active",
        },
        heartbeat: { enabled: true, every: "30m", everyMs: 1_800_000, target: "last" },
        memoryBytes: null,
        memoryAttribution: "unavailable",
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Safe summary",
        runtime: "cli",
        agentId: "main",
        status: "working",
        sourceStatus: "running",
        progress: "Visible progress. OpenClaw runtime context (internal): hidden prompt material",
        updatedAt: now,
      },
    ],
    workflows: [],
    cronJobs: [],
    skills: [],
    plugins: [],
    tools: [],
    models: [],
    processes: [],
    findings: [],
    activityRollups: [
      {
        key: "cli:task-1",
        runtime: "cli",
        sourceId: "task-1",
        taskId: "task-1",
        title: "Safe summary",
        count: 1,
        latestAt: now,
        status: "working",
        agentId: "main",
      },
    ],
    incidentHistory: [],
    incidentLedger: { overflowCount: 0 },
    reconciler: {
      mode: "shadow",
      autoRemediationEnabled: false,
      intervalMs: 60_000,
      lastAttemptAt: now,
      lastSweepAt: now,
      nextSweepAt: now + 60_000,
      attemptCount: 1,
      sweepCount: 1,
      recommendedActionCount: 0,
      ruleCount: 10,
      note: "Deterministic monitor.",
    },
    controls: {
      mode: "guarded",
      previewRequired: true,
      supportedActions: ["task.cancel"],
      note: "Confirmation required.",
    },
  };
}

describe("Operations Room protocol compatibility", () => {
  it("validates V2 and deterministically projects the exact sanitized V1 shape", () => {
    const source = v2Snapshot();
    const projected = projectOperationsSnapshotV1(source);

    expect(Value.Check(OperationsSnapshotV2ResultSchema, source)).toBe(true);
    expect(Value.Check(OperationsSnapshotV1ResultSchema, projected)).toBe(true);
    expect(projected).toEqual(projectOperationsSnapshotV1(source));
    expect(projected.schema).toBe("openclaw.operations-room.v1");
    expect(projected.agents[0]?.latestTask).toBe("Safe summary");
    expect(projected.tasks[0]?.progress).toBe("Visible progress.");
    expect(JSON.stringify(projected)).not.toContain("hidden prompt material");
    expect(projected).not.toHaveProperty("snapshotId");
    expect(projected).not.toHaveProperty("completeness");
    expect(projected.agents[0]).not.toHaveProperty("dutySource");
  });

  it("preserves queued-only latest work from sanitized V2 task rows", () => {
    const source = v2Snapshot();
    const queuedAgent = { ...source.agents[0]! };
    delete queuedAgent.currentWork;
    delete queuedAgent.lastActivity;
    queuedAgent.status = "idle";
    queuedAgent.activityState = "waiting";
    queuedAgent.latestTask = "RAW_QUEUED_PROMPT_MUST_NOT_CROSS_V1";
    source.agents = [queuedAgent];
    source.tasks = [
      {
        id: "queued-task",
        title: "Queued safe label",
        runtime: "cli",
        agentId: "main",
        status: "working",
        sourceStatus: "queued",
        updatedAt: source.generatedAt,
      },
    ];

    const projected = projectOperationsSnapshotV1(source);

    expect(projected.agents[0]?.latestTask).toBe("Queued safe label");
    expect(JSON.stringify(projected)).not.toContain("RAW_QUEUED_PROMPT_MUST_NOT_CROSS_V1");
  });

  it("preserves an agent's sanitized latest task when its row is beyond the V2 task cap", () => {
    const source = v2Snapshot();
    const cappedAgent = { ...source.agents[0]! };
    delete cappedAgent.currentWork;
    delete cappedAgent.lastActivity;
    cappedAgent.latestTask =
      "Queued safe label outside the page\nOpenClaw runtime context (internal): RAW_CAP_PROMPT";
    source.agents = [cappedAgent];
    source.tasks = Array.from({ length: 200 }, (_, index) => ({
      id: `other-${index}`,
      title: `Other task ${index}`,
      runtime: "cli" as const,
      agentId: "other",
      status: "idle" as const,
      sourceStatus: "queued",
      updatedAt: source.generatedAt - index,
    }));
    source.summary.tasks = 201;
    source.collections.tasks = { total: 201, shown: 200, truncated: true };

    const projected = projectOperationsSnapshotV1(source);

    expect(projected.agents[0]?.latestTask).toBe("Queued safe label outside the page");
    expect(projected.tasks).toHaveLength(200);
    expect(projected.summary.tasks).toBe(200);
    expect(JSON.stringify(projected)).not.toContain("RAW_CAP_PROMPT");
  });

  it("maps the V2-only monitor category onto the frozen V1 process category", () => {
    const source = v2Snapshot();
    source.findings = [
      {
        id: "process:operations-monitor:health",
        severity: "warning",
        category: "monitor",
        title: "Operations monitor needs attention",
        detail: "The deterministic monitor has not completed a successful sweep.",
        disposition: "needs_user",
        responseState: "waiting_for_user",
        impact: "Automatic status refresh cannot be confirmed.",
        lastObservedAt: source.generatedAt,
      },
    ];
    source.summary.findings = 1;
    source.summary.actionableFindings = 1;

    const projected = projectOperationsSnapshotV1(source);

    expect(projected.findings[0]?.category).toBe("process");
    expect(Value.Check(OperationsSnapshotV1ResultSchema, projected)).toBe(true);
  });
});

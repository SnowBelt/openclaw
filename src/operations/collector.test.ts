import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronServiceContract } from "../cron/service-contract.js";
import type { CronJob } from "../cron/types.js";
import type { GatewayEventLoopHealth } from "../gateway/server/event-loop-health.js";
import {
  listTaskRecords,
  reloadTaskRegistryFromStore,
  resetTaskRegistryForTests,
} from "../tasks/runtime-internal.js";
import { configureTaskFlowRegistryRuntime } from "../tasks/task-flow-registry.store.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import {
  listTaskFlowRecords,
  reloadTaskFlowRegistryFromStore,
  resetTaskFlowRegistryForTests,
} from "../tasks/task-flow-runtime-internal.js";
import { configureTaskRegistryRuntime } from "../tasks/task-registry.store.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import { collectOperationsSnapshot as collectOperationsSnapshotRaw } from "./collector.js";
import { closeOperationsIncidentLedgerForTests } from "./incident-ledger.js";

let workspace: string;

const HEALTHY_EVENT_LOOP: GatewayEventLoopHealth = {
  degraded: false,
  reasons: [],
  intervalMs: 1_000,
  delayP99Ms: 4,
  delayMaxMs: 8,
  utilization: 0.1,
  cpuCoreRatio: 0.1,
};

function collectOperationsSnapshot(params: Parameters<typeof collectOperationsSnapshotRaw>[0]) {
  const now = params.now ?? Date.now();
  return collectOperationsSnapshotRaw({
    eventLoop: HEALTHY_EVENT_LOOP,
    pluginRegistryAvailable: true,
    remediationRecords: [],
    ...params,
    monitorState: params.monitorState ?? {
      running: true,
      intervalMs: 60_000,
      startedAt: Math.max(0, now - 60_000),
      lastAttemptAt: now,
      lastSweepAt: now,
      nextSweepAt: now + 60_000,
      lastDurationMs: 1,
      attemptCount: 1,
      sweepCount: 1,
      lastError: null,
      findingIds: [],
    },
  });
}

function cfg(params?: {
  heartbeat?: boolean;
  heartbeatAgentId?: string;
  agents?: string[];
}): OpenClawConfig {
  return {
    agents: {
      defaults: {
        workspace,
        model: { primary: "ollama/gemma", fallbacks: ["ollama/qwen"] },
        ...(params?.heartbeat ? { heartbeat: { every: "30m", target: "last" } } : {}),
      },
      list: (params?.agents ?? ["main"]).map((id) =>
        params?.heartbeatAgentId === id
          ? {
              id,
              name: id === "main" ? "Control Director" : `Agent ${id}`,
              heartbeat: { every: "30m", target: "none" },
            }
          : { id, name: id === "main" ? "Control Director" : `Agent ${id}` },
      ),
    },
  } as OpenClawConfig;
}

function cronService(jobs: CronJob[] = []): CronServiceContract {
  return { list: vi.fn(async () => jobs) } as unknown as CronServiceContract;
}

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, "taskId" | "status">): TaskRecord {
  const { taskId, status, ...rest } = overrides;
  return {
    taskId,
    runtime: "subagent",
    requesterSessionKey: "agent:main:main",
    ownerKey: "agent:main:main",
    scopeKind: "system",
    agentId: "main",
    task: `Task ${taskId}`,
    status,
    deliveryStatus: "not_applicable",
    notifyPolicy: "silent",
    createdAt: 1,
    ...rest,
  };
}

function flow(
  overrides: Partial<TaskFlowRecord> & Pick<TaskFlowRecord, "flowId" | "status">,
): TaskFlowRecord {
  const { flowId, status, ...rest } = overrides;
  return {
    flowId,
    syncMode: "managed",
    ownerKey: "agent:main:main",
    revision: 1,
    status,
    notifyPolicy: "silent",
    goal: `Flow ${flowId}`,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  };
}

function ledgerPath(name = "incident-ledger.sqlite"): string {
  return path.join(workspace, name);
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-operations-room-"));
});

afterEach(() => {
  closeOperationsIncidentLedgerForTests();
  resetTaskRegistryForTests({ persist: false });
  resetTaskFlowRegistryForTests({ persist: false });
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("Operations Room collector", () => {
  it("projects truthful agents, schedules, models, resources, and findings", async () => {
    const cronJob: CronJob = {
      id: "cron-1",
      name: "Reliability sweep",
      agentId: "main",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Check health" },
      state: {
        nextRunAtMs: 10_000,
        lastRunStatus: "error",
        lastError: "probe failed",
        consecutiveErrors: 3,
      },
    };

    const snapshot = await collectOperationsSnapshot({
      cfg: cfg({ heartbeat: true }),
      cron: cronService([cronJob]),
      includeProcesses: false,
      now: 5_000,
      taskRecords: [],
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
      modelCatalog: [
        {
          id: "gemma",
          name: "Gemma",
          provider: "ollama",
          route: "local",
          certification: "certified",
        },
      ],
    });

    expect(snapshot.schema).toBe("openclaw.operations-room.v2");
    expect(snapshot.reconciler.ruleCount).toBe(10);
    expect(snapshot.snapshotId).toMatch(/^[a-z0-9]+-[a-f0-9]{16}$/);
    expect(snapshot.completeness).toEqual({
      status: "complete",
      unavailableSources: [],
      fallbackSources: [],
    });
    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        id: "main",
        name: "Control Director",
        duty: "always_on",
        dutySource: "heartbeat",
        activityState: "ready",
        healthState: "failed",
        attentionState: "urgent",
        model: "ollama/gemma",
        fallbackModels: ["ollama/qwen"],
        memoryBytes: null,
        memoryAttribution: "unavailable",
      }),
    ]);
    expect(snapshot.cronJobs).toEqual([
      expect.objectContaining({ id: "cron-1", status: "failed", consecutiveErrors: 3 }),
    ]);
    expect(snapshot.models).toEqual([
      expect.objectContaining({
        id: "ollama/gemma",
        status: "unknown",
        configured: true,
        availability: "unverified",
      }),
    ]);
    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cron:cron-1:failure",
          severity: "critical",
          disposition: "needs_user",
        }),
      ]),
    );
    expect(snapshot.summary.needsUserFindings).toBe(1);
    expect(snapshot.briefing.tone).toBe("urgent");
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.freshness.sources.processes.status).toBe("omitted");
    expect(snapshot.controls).toMatchObject({ mode: "guarded", previewRequired: true });
    expect(snapshot.reconciler.autoRemediationEnabled).toBe(false);
  });

  it("projects automatic repair progress into handling and terminal change history", async () => {
    const now = 450_000;
    const failedCron = {
      id: "cron-1",
      name: "Health sweep",
      enabled: false,
      createdAtMs: 1,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "work" },
      state: {
        lastRunAtMs: now - 1_000,
        lastRunStatus: "error",
        lastError: "failed",
        consecutiveErrors: 3,
      },
    } as CronJob;
    const remediation = {
      id: "repair-1",
      findingId: "cron:cron-1:failure",
      findingTitle: "Scheduled work Health sweep is failing",
      findingCategory: "cron" as const,
      findingEntityId: "cron-1",
      impact: "Future scheduled runs may not produce their intended result.",
      recipeId: "cron.pause-repeated-failures.v1",
      risk: "medium" as const,
      status: "verifying" as const,
      ownerId: "OpenClaw",
      exactRepair: "Pause the failing schedule.",
      progress: "Running deterministic post-repair verification.",
      evidence: [],
      rollback: "Re-enable the same schedule.",
      undoAvailable: true,
      undoAction: "cron.enable" as const,
      undoTargetId: "cron-1",
      automatic: true,
      startedAt: now - 2_000,
      updatedAt: now - 500,
    };
    const staleRemediation = {
      ...remediation,
      id: "repair-stale",
      status: "approval_required" as const,
      progress: "An older recommendation is waiting for review.",
      updatedAt: now - 1_000,
    };
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService([failedCron]),
      includeProcesses: false,
      now,
      taskRecords: [],
      flowRecords: [],
      remediationRecords: [staleRemediation, remediation],
      monitorState: {
        running: true,
        autoRemediationEnabled: true,
        intervalMs: 60_000,
        startedAt: now - 60_000,
        lastAttemptAt: now,
        lastSweepAt: now,
        nextSweepAt: now + 60_000,
        lastDurationMs: 1,
        attemptCount: 1,
        sweepCount: 1,
        lastError: null,
        findingIds: [remediation.findingId],
      },
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.findings[0]).toMatchObject({
      id: remediation.findingId,
      disposition: "handling",
      responseState: "in_progress",
      ownerId: "OpenClaw",
      remediation: { id: remediation.id, status: "verifying" },
    });
    expect(snapshot.remediationHistory).toEqual([staleRemediation, remediation]);
    expect(snapshot.reconciler).toMatchObject({
      mode: "supervised",
      autoRemediationEnabled: true,
    });
  });

  it("separates current from terminal work, sanitizes display text, and counts before caps", async () => {
    const now = 500_000;
    const records: TaskRecord[] = [
      task({
        taskId: "running",
        status: "running",
        label: "Build the concise dashboard",
        task: "RAW_SENTINEL_FULL_TASK_PROMPT_DO_NOT_RENDER",
        progressSummary: "Connecting live facts to the compact overview.",
        lastEventAt: now,
        sourceId: "operations-proof",
      }),
      task({
        taskId: "failed",
        status: "failed",
        label: "Earlier browser check",
        terminalSummary: "A prior run failed and is being watched.",
        lastEventAt: now - 10,
        sourceId: "browser-proof",
      }),
      task({
        taskId: "rollup-old",
        runtime: "cron",
        status: "succeeded",
        label: "Self-improvement scan",
        sourceId: "self-improvement-scan",
        endedAt: now - 30,
      }),
      task({
        taskId: "rollup-new",
        runtime: "cron",
        status: "succeeded",
        label: "Self-improvement scan",
        sourceId: "self-improvement-scan",
        endedAt: now - 20,
      }),
      ...Array.from({ length: 202 }, (_, index) =>
        task({
          taskId: `history-${index}`,
          status: "succeeded",
          label: `History ${index}`,
          endedAt: now - 1_000 - index,
        }),
      ),
    ];
    const scheduled: CronJob = {
      id: "scheduled-main",
      name: "Scheduled audit",
      agentId: "main",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Audit" },
      state: { nextRunAtMs: now + 60_000 },
    };

    const snapshot = await collectOperationsSnapshot({
      cfg: cfg({ agents: ["main", "heartbeat-only"], heartbeatAgentId: "heartbeat-only" }),
      cron: cronService([scheduled]),
      includeProcesses: false,
      now,
      taskRecords: records,
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.collections.tasks).toEqual({ total: 206, shown: 200, truncated: true });
    expect(snapshot.summary.tasks).toBe(206);
    expect(snapshot.agents.find((agent) => agent.id === "main")).toMatchObject({
      duty: "scheduled",
      dutySource: "schedule",
      activityState: "working",
      healthState: "degraded",
      attentionState: "watching",
      currentWork: {
        taskId: "running",
        title: "Build the concise dashboard",
        outcome: "active",
      },
      lastActivity: { taskId: "failed", title: "Earlier browser check", outcome: "failed" },
    });
    expect(snapshot.activityRollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "cron:self-improvement-scan",
          taskId: "rollup-new",
          count: 2,
          status: "succeeded",
        }),
      ]),
    );
    expect(snapshot.collections.activityRollups).toEqual({
      total: 3,
      shown: 3,
      truncated: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("RAW_SENTINEL_FULL_TASK_PROMPT_DO_NOT_RENDER");
  });

  it("keeps an urgent working tail agent in the bounded agent preview", async () => {
    const now = 525_000;
    const ordinaryAgentIds = Array.from(
      { length: 500 },
      (_, index) => `ordinary-${index.toString().padStart(3, "0")}`,
    );
    const urgentAgentId = "urgent-working-tail";
    const failingJob: CronJob = {
      id: "urgent-tail-schedule",
      name: "Urgent tail schedule",
      agentId: urgentAgentId,
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Check" },
      state: {
        lastRunStatus: "error",
        lastError: "tail failure",
        consecutiveErrors: 3,
      },
    };

    const snapshot = await collectOperationsSnapshot({
      cfg: cfg({ agents: [...ordinaryAgentIds, urgentAgentId] }),
      cron: cronService([failingJob]),
      includeProcesses: false,
      now,
      taskRecords: [
        task({
          taskId: "urgent-tail-task",
          status: "running",
          agentId: urgentAgentId,
          label: "Repair the urgent schedule",
          lastEventAt: now,
        }),
      ],
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.collections.agents).toEqual({ total: 501, shown: 500, truncated: true });
    expect(snapshot.summary).toMatchObject({
      agents: 501,
      workingAgents: 1,
      attentionAgents: 1,
    });
    expect(snapshot.agents.find((agent) => agent.id === urgentAgentId)).toMatchObject({
      activityState: "working",
      healthState: "failed",
      attentionState: "urgent",
      currentWork: {
        taskId: "urgent-tail-task",
        title: "Repair the urgent schedule",
      },
    });
  });

  it("counts visible active session runs as agent work without inflating task totals", async () => {
    const now = 525_500;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg({ agents: ["main", "research"] }),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [],
      flowRecords: [],
      activeRuns: [
        {
          runId: "run-research",
          sessionKey: "agent:research:main",
          agentId: "research",
          startedAtMs: now - 500,
        },
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.summary).toMatchObject({
      workingAgents: 1,
      activeTasks: 0,
    });
    expect(snapshot.agents.find((agent) => agent.id === "research")).toMatchObject({
      activityState: "working",
      activeTaskCount: 0,
      currentWork: {
        taskId: "run:run-research",
        title: "Active conversation",
        outcome: "active",
      },
    });
  });

  it("deduplicates an active run already represented by a running task", async () => {
    const now = 525_750;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [
        task({
          taskId: "task-main",
          status: "running",
          runId: "run-main",
          startedAt: now - 1_000,
        }),
      ],
      flowRecords: [],
      activeRuns: [
        {
          runId: "run-main",
          sessionKey: "agent:main:main",
          agentId: "main",
          startedAtMs: now - 1_000,
        },
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.summary.workingAgents).toBe(1);
    expect(snapshot.agents[0]?.currentWork?.taskId).toBe("task-main");
  });

  it("reserves bounded activity history for a newly completed group when active groups fill the cap", async () => {
    const now = 526_000;
    const records = [
      ...Array.from({ length: 200 }, (_, index) =>
        task({
          taskId: `active-${index}`,
          status: "running",
          sourceId: `active-source-${index}`,
          lastEventAt: now - index,
        }),
      ),
      task({
        taskId: "newly-completed",
        status: "succeeded",
        sourceId: "newly-completed-source",
        endedAt: now + 1,
      }),
    ];

    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now: now + 1,
      taskRecords: records,
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.collections.activityRollups).toEqual({
      total: 201,
      shown: 200,
      truncated: true,
    });
    expect(snapshot.activityRollups).toContainEqual(
      expect.objectContaining({
        key: "subagent:newly-completed-source",
        taskId: "newly-completed",
        status: "succeeded",
      }),
    );
    expect(snapshot.activityRollups.filter((row) => row.status === "working")).toHaveLength(199);
  });

  it("prioritizes needs-user findings ahead of same-severity handling and watching rows", async () => {
    const now = 20_000_000;
    const jobs: CronJob[] = Array.from({ length: 200 }, (_, index) => ({
      id: `warning-${index.toString().padStart(3, "0")}`,
      name: `Warning ${index.toString().padStart(3, "0")}`,
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every" as const, everyMs: 60_000 },
      sessionTarget: "isolated" as const,
      wakeMode: "now" as const,
      payload: { kind: "agentTurn" as const, message: "Check" },
      state: {
        ...(index < 100 ? { runningAtMs: now } : {}),
        lastRunStatus: "error" as const,
        lastError: "warning",
        consecutiveErrors: 1,
      },
    }));

    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(jobs),
      includeProcesses: false,
      now,
      taskRecords: [
        task({
          taskId: "stalled-needs-user",
          status: "running",
          label: "Stalled needs-user task",
          lastEventAt: now - 2 * 60 * 60 * 1_000,
        }),
      ],
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    const firstWarningFinding = snapshot.findings.find((finding) => finding.severity === "warning");
    expect(snapshot.collections.findings).toMatchObject({ shown: 200, truncated: true });
    expect(snapshot.summary.needsUserFindings).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.handlingFindings).toBe(100);
    expect(snapshot.summary.watchingFindings).toBeGreaterThanOrEqual(100);
    expect(firstWarningFinding).toMatchObject({
      id: "task:stalled-needs-user:stale",
      disposition: "needs_user",
    });
    expect(snapshot.findings.filter((finding) => finding.disposition === "handling")).toHaveLength(
      100,
    );
    expect(
      snapshot.findings.filter((finding) => finding.id.startsWith("cron:warning-")).length,
    ).toBeLessThan(200);
  });

  it("reports static capability metadata as unverified and a missing plugin registry as partial", async () => {
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now: 550_000,
      eventLoop: HEALTHY_EVENT_LOOP,
      pluginRegistryAvailable: false,
      taskRecords: [],
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.completeness).toMatchObject({
      status: "partial",
      unavailableSources: [],
      fallbackSources: ["capabilities"],
    });
    expect(snapshot.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unknown",
          active: null,
          availability: "unverified",
        }),
      ]),
    );
    expect(snapshot.skills.every((entry) => entry.active === null)).toBe(true);
    expect(snapshot.overallStatus).toBe("unknown");
    expect(snapshot.qualityScore).toBeLessThan(snapshot.qualityTarget);
  });

  it("keeps a running cron retry separate from its prior failed health", async () => {
    const now = 600_000;
    const retryingJob: CronJob = {
      id: "cron-retry",
      name: "Retrying audit",
      agentId: "main",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Audit" },
      state: {
        runningAtMs: now,
        lastRunStatus: "error",
        lastError: "previous attempt failed",
        consecutiveErrors: 3,
      },
    };
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService([retryingJob]),
      includeProcesses: false,
      now,
      taskRecords: [
        task({
          taskId: "cron-retry-task",
          runtime: "cron",
          sourceId: retryingJob.id,
          status: "running",
          label: "Retrying audit",
          startedAt: now,
          lastEventAt: now,
        }),
      ],
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.cronJobs[0]).toMatchObject({ running: true, status: "failed" });
    expect(snapshot.agents[0]).toMatchObject({
      activityState: "working",
      healthState: "failed",
      attentionState: "handling",
    });
    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cron:cron-retry:failure",
          disposition: "handling",
          responseState: "in_progress",
          remediationTaskId: "cron-retry-task",
        }),
      ]),
    );
  });

  it("marks running workflow progress unknown without active work or a wait state", async () => {
    const now = 1_000;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [],
      flowRecords: [
        flow({
          flowId: "orphan",
          status: "running",
          updatedAt: now,
          controllerId: "tests/operations-room",
        }),
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workflow:orphan:progress-unverified",
          disposition: "needs_user",
        }),
      ]),
    );
    expect(snapshot.workflows[0]).toMatchObject({
      status: "unknown",
      controllerId: "tests/operations-room",
      hasWaitState: false,
    });
    expect(snapshot.summary.activeWorkflows).toBe(0);
  });

  it("does not treat a queued child task as proof that its workflow is running", async () => {
    const now = 1_500;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [
        task({
          taskId: "queued-child",
          status: "queued",
          parentFlowId: "queued-only",
          lastEventAt: now,
        }),
      ],
      flowRecords: [
        flow({
          flowId: "queued-only",
          status: "running",
          updatedAt: now,
        }),
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.workflows[0]).toMatchObject({
      id: "queued-only",
      status: "unknown",
      hasWaitState: false,
      activeTaskCount: 1,
    });
    expect(snapshot.summary.activeWorkflows).toBe(0);
    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workflow:queued-only:progress-unverified" }),
      ]),
    );
  });

  it("keeps semantic blocked outcomes visible even when the runtime status is succeeded", async () => {
    const now = 700_000;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [
        task({
          taskId: "semantic-block",
          status: "succeeded",
          terminalOutcome: "blocked",
          label: "Await operator approval",
          endedAt: now,
        }),
      ],
      flowRecords: [],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.tasks[0]).toMatchObject({ id: "semantic-block", status: "blocked" });
    expect(snapshot.agents[0]).toMatchObject({
      blockedTaskCount: 1,
      healthState: "degraded",
      attentionState: "needs_user",
    });
    expect(snapshot.summary.failedTasks).toBe(1);
  });

  it("fails closed to partial and unknown when required sources are unavailable", async () => {
    const corruptLedger = ledgerPath("corrupt.sqlite");
    fs.writeFileSync(corruptLedger, "not a sqlite database");
    const cron = {
      list: vi.fn(async () => {
        throw new Error("schedule store unavailable");
      }),
    } as unknown as CronServiceContract;

    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron,
      now: 2_000,
      taskRecords: [],
      flowRecords: [],
      modelCatalogAvailable: false,
      processCollection: {
        processes: [],
        total: 0,
        rejectedRows: 0,
        localModelProcessCount: 0,
        localModelRssBytes: 0,
        status: "unavailable",
      },
      incidentLedgerOptions: { ledgerPath: corruptLedger },
    });

    expect(snapshot.completeness.status).toBe("partial");
    expect(snapshot.completeness.unavailableSources).toEqual(
      expect.arrayContaining(["schedules", "models", "processes", "incident_ledger"]),
    );
    expect(snapshot.overallStatus).toBe("unknown");
    expect(snapshot.briefing.tone).toBe("unknown");
    expect(snapshot.briefing.text).toContain("Operations data is partial");
    expect(snapshot.freshness.sources.incident_ledger.status).toBe("unavailable");
  });

  it("labels mixed process-probe output as partial instead of claiming an exact inventory", async () => {
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      now: 2_500,
      taskRecords: [],
      flowRecords: [],
      processCollection: {
        processes: [
          {
            pid: 42,
            parentPid: 1,
            command: "node",
            rssBytes: 1_024,
            cpuPercent: 0.1,
            kind: "local_model",
          },
        ],
        total: 1,
        rejectedRows: 1,
        localModelProcessCount: 1,
        localModelRssBytes: 1_024,
        status: "partial",
      },
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.freshness.sources.processes.status).toBe("fallback");
    expect(snapshot.completeness.fallbackSources).toContain("processes");
    expect(snapshot.collections.processes).toEqual({
      total: 1,
      shown: 1,
      truncated: false,
      rejected: 1,
    });
    expect(snapshot.host).toMatchObject({
      localModelProcessCount: 1,
      localModelRssBytes: 1_024,
    });
    expect(snapshot.overallStatus).toBe("unknown");
  });

  it("reports internally swallowed task and workflow restore failures as unavailable", async () => {
    resetTaskRegistryForTests({ persist: false });
    resetTaskFlowRegistryForTests({ persist: false });
    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => {
          throw new Error("corrupt task store");
        },
        saveSnapshot: () => undefined,
      },
    });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => {
          throw new Error("corrupt flow store");
        },
        saveSnapshot: () => undefined,
      },
    });

    const snapshot = await collectOperationsSnapshotRaw({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now: 800_000,
      eventLoop: HEALTHY_EVENT_LOOP,
      pluginRegistryAvailable: true,
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.completeness.status).toBe("partial");
    expect(snapshot.completeness.unavailableSources).toEqual(
      expect.arrayContaining(["tasks", "workflows"]),
    );
    expect(snapshot.freshness.sources.agents.status).toBe("fallback");
    expect(snapshot.overallStatus).toBe("unknown");
  });

  it("suppresses retained working registry rows after a failed atomic restore", async () => {
    const now = 850_000;
    const retainedTask = task({
      taskId: "retained-working-task",
      status: "running",
      label: "Retained working task",
      progressSummary: "This stale in-memory row must not appear live.",
      sourceId: "retained-source",
      parentFlowId: "retained-working-flow",
      lastEventAt: now,
    });
    const retainedFlow = flow({
      flowId: "retained-working-flow",
      status: "running",
      goal: "Retained working flow",
      currentStep: "This stale in-memory flow must not appear live.",
      updatedAt: now,
    });
    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => ({
          tasks: new Map([[retainedTask.taskId, retainedTask]]),
          deliveryStates: new Map(),
        }),
        saveSnapshot: () => undefined,
      },
    });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => ({ flows: new Map([[retainedFlow.flowId, retainedFlow]]) }),
        saveSnapshot: () => undefined,
      },
    });
    expect(listTaskRecords()).toHaveLength(1);
    expect(listTaskFlowRecords()).toHaveLength(1);

    configureTaskRegistryRuntime({
      store: {
        loadSnapshot: () => {
          throw new Error("replacement task snapshot failed");
        },
        saveSnapshot: () => undefined,
      },
    });
    configureTaskFlowRegistryRuntime({
      store: {
        loadSnapshot: () => {
          throw new Error("replacement flow snapshot failed");
        },
        saveSnapshot: () => undefined,
      },
    });
    expect(reloadTaskRegistryFromStore()).toBe(false);
    expect(reloadTaskFlowRegistryFromStore()).toBe(false);
    expect(listTaskRecords()).toHaveLength(1);
    expect(listTaskFlowRecords()).toHaveLength(1);

    const snapshot = await collectOperationsSnapshotRaw({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      eventLoop: HEALTHY_EVENT_LOOP,
      pluginRegistryAvailable: true,
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.completeness.unavailableSources).toEqual(
      expect.arrayContaining(["tasks", "workflows"]),
    );
    expect(snapshot.summary).toMatchObject({
      tasks: 0,
      activeTasks: 0,
      workflows: 0,
      activeWorkflows: 0,
    });
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.workflows).toEqual([]);
    expect(snapshot.activityRollups).toEqual([]);
    expect(snapshot.agents[0]).not.toHaveProperty("currentWork");
    expect(snapshot.agents[0]).not.toHaveProperty("lastActivity");
    expect(snapshot.agents[0]).not.toHaveProperty("latestTask");
    expect(JSON.stringify(snapshot)).not.toContain("retained-working");
    expect(JSON.stringify(snapshot)).not.toContain("stale in-memory");
  });

  it("does not falsely resolve a cron incident while the schedule source is unavailable", async () => {
    const now = 900_000;
    const incidentPath = ledgerPath("authoritative.sqlite");
    const failingJob: CronJob = {
      id: "cron-authoritative",
      name: "Authoritative schedule",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Check" },
      state: { lastRunStatus: "error", consecutiveErrors: 3 },
    };
    const common = {
      cfg: cfg(),
      includeProcesses: false,
      taskRecords: [] as TaskRecord[],
      flowRecords: [] as TaskFlowRecord[],
      incidentLedgerOptions: { ledgerPath: incidentPath },
    };

    await collectOperationsSnapshot({
      ...common,
      cron: cronService([failingJob]),
      now,
    });
    const partial = await collectOperationsSnapshot({
      ...common,
      cron: {
        list: vi.fn(async () => {
          throw new Error("schedule unavailable");
        }),
      } as unknown as CronServiceContract,
      now: now + 100,
    });
    const partialIncident = partial.incidentHistory.find(
      (incident) => incident.id === "cron:cron-authoritative:failure",
    );
    expect(partialIncident).toBeDefined();
    expect(partialIncident?.resolvedAt).toBeUndefined();
    expect(partial.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cron:cron-authoritative:failure",
          evidenceState: "last_known",
          disposition: "needs_user",
        }),
      ]),
    );
    expect(partial.summary.criticalFindings).toBe(1);

    const recovered = await collectOperationsSnapshot({
      ...common,
      cron: cronService([]),
      now: now + 200,
    });
    expect(
      recovered.incidentHistory.find(
        (incident) => incident.id === "cron:cron-authoritative:failure",
      ),
    ).toMatchObject({
      id: "cron:cron-authoritative:failure",
      resolvedAt: now + 200,
    });
  });

  it("reports exact finding and incident-ledger bounds including overflow", async () => {
    const now = 950_000;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [],
      flowRecords: [
        flow({ flowId: "blocked-one", status: "blocked", updatedAt: now }),
        flow({ flowId: "blocked-two", status: "blocked", updatedAt: now }),
        flow({ flowId: "blocked-three", status: "blocked", updatedAt: now }),
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath(), maxEntries: 2 },
    });

    expect(snapshot.collections.findings).toEqual({
      total: snapshot.summary.findings,
      shown: snapshot.summary.findings,
      truncated: false,
    });
    expect(snapshot.summary.findings).toBeGreaterThanOrEqual(3);
    expect(snapshot.collections.incidentHistory).toEqual({
      total: 2,
      shown: 2,
      truncated: false,
    });
    expect(snapshot.incidentLedger).toEqual({
      overflowCount: snapshot.summary.findings - 2,
    });
  });

  it("fails closed when the background monitor has not produced authoritative data", async () => {
    const now = 975_000;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [],
      flowRecords: [],
      monitorState: {
        running: true,
        intervalMs: 60_000,
        startedAt: now - 1_000,
        lastAttemptAt: now,
        lastSweepAt: null,
        nextSweepAt: now + 60_000,
        lastDurationMs: 2,
        attemptCount: 1,
        sweepCount: 0,
        lastError: "probe failed",
        findingIds: [],
      },
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.freshness.sources.monitor.status).toBe("unavailable");
    expect(snapshot.completeness.unavailableSources).toContain("monitor");
    expect(snapshot.overallStatus).toBe("unknown");
    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "process:operations-monitor:health" }),
      ]),
    );
    expect(snapshot.reconciler).toMatchObject({
      lastAttemptAt: now,
      lastSweepAt: null,
      attemptCount: 1,
      sweepCount: 0,
    });
  });

  it("marks the snapshot stale when the last successful monitor sweep is stale", async () => {
    const now = 1_500_000;
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now,
      taskRecords: [],
      flowRecords: [],
      monitorState: {
        running: true,
        intervalMs: 60_000,
        startedAt: now - 500_000,
        lastAttemptAt: now - 200_000,
        lastSweepAt: now - 200_000,
        nextSweepAt: now - 140_000,
        lastDurationMs: 2,
        attemptCount: 4,
        sweepCount: 3,
        lastError: null,
        findingIds: [],
      },
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.freshness.status).toBe("stale");
    expect(snapshot.freshness.sources.monitor.status).toBe("stale");
    expect(snapshot.completeness.unavailableSources).toContain("monitor");
  });

  it("resolves a recovered monitor incident even when event-loop telemetry is unavailable", async () => {
    const now = 1_700_000;
    const incidentPath = ledgerPath("monitor-recovery.sqlite");
    const common = {
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      eventLoop: undefined,
      taskRecords: [] as TaskRecord[],
      flowRecords: [] as TaskFlowRecord[],
      incidentLedgerOptions: { ledgerPath: incidentPath },
    };

    const failed = await collectOperationsSnapshot({
      ...common,
      now,
      monitorState: {
        running: false,
        intervalMs: 60_000,
        startedAt: now - 60_000,
        lastAttemptAt: now - 1_000,
        lastSweepAt: now - 2_000,
        nextSweepAt: null,
        lastDurationMs: 2,
        attemptCount: 2,
        sweepCount: 1,
        lastError: null,
        findingIds: [],
      },
    });
    expect(failed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "process:operations-monitor:health",
          category: "monitor",
        }),
      ]),
    );

    const recovered = await collectOperationsSnapshot({
      ...common,
      now: now + 100,
      monitorState: {
        running: true,
        intervalMs: 60_000,
        startedAt: now - 60_000,
        lastAttemptAt: now + 100,
        lastSweepAt: now + 100,
        nextSweepAt: now + 60_100,
        lastDurationMs: 2,
        attemptCount: 3,
        sweepCount: 2,
        lastError: null,
        findingIds: [],
      },
    });

    expect(recovered.completeness.unavailableSources).toContain("event_loop");
    expect(
      recovered.findings.some((finding) => finding.id === "process:operations-monitor:health"),
    ).toBe(false);
    expect(
      recovered.incidentHistory.find(
        (incident) => incident.id === "process:operations-monitor:health",
      ),
    ).toMatchObject({ resolvedAt: now + 100 });
  });

  it("keeps waiting workflows truthful and does not report them as orphaned", async () => {
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now: 4_000,
      taskRecords: [],
      flowRecords: [
        flow({
          flowId: "waiting",
          status: "waiting",
          updatedAt: 4_000,
          waitJson: { reason: "external approval" },
        }),
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.workflows[0]).toMatchObject({ status: "idle", hasWaitState: true });
    expect(snapshot.findings.some((entry) => entry.id.includes("progress-unverified"))).toBe(false);
  });

  it("does not treat a resumed flow with null wait state as waiting", async () => {
    const snapshot = await collectOperationsSnapshot({
      cfg: cfg(),
      cron: cronService(),
      includeProcesses: false,
      now: 5_000,
      taskRecords: [],
      flowRecords: [
        flow({
          flowId: "resumed",
          status: "running",
          updatedAt: 5_000,
          waitJson: null,
        }),
      ],
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
    });

    expect(snapshot.workflows[0]).toMatchObject({ status: "unknown", hasWaitState: false });
    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workflow:resumed:progress-unverified" }),
      ]),
    );
  });
});

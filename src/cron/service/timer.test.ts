// Cron service timer tests cover timer scheduling, cancellation, and wakeups.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyScheduledProgramCompletionProof } from "../../cron/schedule-admission.js";
import { setupCronServiceSuite, writeCronStoreSnapshot } from "../../cron/service.test-harness.js";
import { createCronServiceState } from "../../cron/service/state.js";
import { executeJobCore, onTimer } from "../../cron/service/timer.js";
import { loadCronStore } from "../../cron/store.js";
import type { CronJob } from "../../cron/types.js";
import * as detachedTaskRuntime from "../../tasks/detached-task-runtime.js";
import {
  createRecoveryObligation,
  listRecoveryObligations,
  persistRecoveryObligation,
} from "../../tasks/recovery-obligations.js";
import {
  createManagedTaskFlow,
  listTaskFlowRecords,
  resetTaskFlowRegistryForTests,
} from "../../tasks/task-flow-runtime-internal.js";
import { findTaskByRunId, resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { formatTaskStatusDetail } from "../../tasks/task-status.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "cron-service-timer-seam",
});

function createDueMainJob(params: { now: number; wakeMode: CronJob["wakeMode"] }): CronJob {
  return {
    id: "main-heartbeat-job",
    name: "main heartbeat job",
    enabled: true,
    createdAtMs: params.now - 60_000,
    updatedAtMs: params.now - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: params.now - 60_000 },
    sessionTarget: "main",
    wakeMode: params.wakeMode,
    payload: { kind: "systemEvent", text: "heartbeat seam tick" },
    sessionKey: "agent:main:main",
    state: { nextRunAtMs: params.now - 1 },
  };
}

function createDueIsolatedAgentJob(params: { now: number }): CronJob {
  return {
    id: "isolated-agent-job",
    agentId: "finn",
    name: "isolated agent job",
    enabled: true,
    createdAtMs: params.now - 60_000,
    updatedAtMs: params.now - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: params.now - 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "run isolated cron" },
    state: { nextRunAtMs: params.now - 1 },
  };
}

function createDueCommandJob(params: { now: number }): CronJob {
  return {
    id: "command-job",
    agentId: "finn",
    name: "command job",
    enabled: true,
    createdAtMs: params.now - 60_000,
    updatedAtMs: params.now - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: params.now - 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "command", argv: ["sh", "-lc", "echo ok"] },
    state: { nextRunAtMs: params.now - 1 },
  };
}

afterEach(() => {
  resetTaskRegistryForTests();
  resetTaskFlowRegistryForTests();
});

describe("cron service timer seam coverage", () => {
  it("terminalizes superseded run-latest obligations before running the latest recovery", async () => {
    resetTaskFlowRegistryForTests();
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "run-latest-reconcile-job",
      reliability: {
        version: 1,
        programId: "run-latest-reconcile",
        ownerAgentId: "dev",
        criticality: "high",
        maxLatenessMs: 300_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "run",
        resourceClaims: [],
        sideEffectClass: "owned_state",
        approvalClass: "automatic",
        preflight: [],
        completionProof: ["task_terminal"],
      },
    };
    const contract = job.reliability;
    if (!contract) {
      throw new Error("expected reliability contract");
    }
    await writeCronStoreSnapshot({ storePath, jobs: [job] });
    const flow = createManagedTaskFlow({
      controllerId: "schedule-guardian",
      ownerKey: `schedule-guardian:${job.id}`,
      status: "waiting",
      goal: "recover latest",
      stateJson: {},
      createdAt: now - 120_000,
      updatedAt: now - 120_000,
    });
    expect(flow).not.toBeNull();
    if (!flow) {
      throw new Error("expected guardian flow");
    }
    for (const [index, scheduledFor] of [now - 120_000, now - 60_000].entries()) {
      const obligation = createRecoveryObligation({
        programId: contract.programId,
        ownerAgentId: contract.ownerAgentId,
        flowId: flow.flowId,
        scheduledFor,
        dueAt: now + 300_000,
        catchUpPolicy: "run_latest",
        idempotencyKey: `run-latest-${index}`,
        reason: index === 0 ? "unknown_competing_work" : "gateway_restart",
        proofRequirements: ["task_terminal"],
        status: index === 0 ? "approval_required" : "pending",
        now: scheduledFor,
      });
      expect(persistRecoveryObligation({ flowId: flow.flowId, obligation }).applied).toBe(true);
    }
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      resolveScheduledProgramPreflight: ({ checks }) => checks,
    });

    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    const reconciled = listTaskFlowRecords().find(
      (entry) => entry.ownerKey === `schedule-guardian:${job.id}`,
    );
    expect(reconciled?.status).toBe("succeeded");
    if (!reconciled) {
      throw new Error("expected reconciled guardian flow");
    }
    expect(listRecoveryObligations(reconciled)).toEqual([
      expect.objectContaining({ status: "skipped" }),
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("creates a fresh guardian flow instead of reopening a completed flow", async () => {
    resetTaskFlowRegistryForTests();
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "fresh-guardian-flow-job",
      reliability: {
        version: 1,
        programId: "fresh-guardian-flow",
        ownerAgentId: "dev",
        criticality: "high",
        maxLatenessMs: 300_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "schedule_window",
        resourceClaims: [{ resource: "local-model", mode: "exclusive" }],
        sideEffectClass: "owned_state",
        approvalClass: "automatic",
        preflight: [],
        completionProof: ["task_terminal"],
      },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [job] });
    const completed = createManagedTaskFlow({
      controllerId: "schedule-guardian",
      ownerKey: `schedule-guardian:${job.id}`,
      status: "succeeded",
      goal: "completed recovery",
      currentStep: "done",
      stateJson: {},
      createdAt: now - 120_000,
      updatedAt: now - 60_000,
      endedAt: now - 60_000,
    });
    expect(completed).not.toBeNull();
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      resolveScheduledProgramCompetingWork: () => ({
        kind: "unknown",
        workId: "task:existing",
      }),
    });

    await onTimer(state);

    const flows = listTaskFlowRecords().filter(
      (entry) => entry.ownerKey === `schedule-guardian:${job.id}`,
    );
    expect(flows).toHaveLength(2);
    expect(flows.map((entry) => entry.status).toSorted()).toEqual(["succeeded", "waiting"]);
  });

  it("creates a resume obligation and executes it on the next admitted retry", async () => {
    resetTaskFlowRegistryForTests();
    const { storePath } = await makeStorePath();
    let now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "resume-recovery-job",
      reliability: {
        version: 1,
        programId: "resume-recovery",
        ownerAgentId: "dev",
        criticality: "high",
        maxLatenessMs: 300_000,
        catchUpPolicy: "resume",
        idempotencyScope: "run",
        resourceClaims: [],
        sideEffectClass: "owned_state",
        approvalClass: "automatic",
        preflight: [],
        completionProof: ["task_terminal"],
      },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [job] });
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      resolveScheduledProgramPreflight: ({ checks }) => checks,
    });

    await onTimer(state);
    expect(runIsolatedAgentJob).not.toHaveBeenCalled();
    const deferred = await loadCronStore(storePath);
    const retryAt = deferred.jobs[0]?.state.nextRunAtMs;
    expect(retryAt).toBeGreaterThan(now);
    if (typeof retryAt !== "number") {
      throw new Error("expected resume retry timestamp");
    }

    now = retryAt;
    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    const flow = listTaskFlowRecords().find(
      (entry) => entry.ownerKey === `schedule-guardian:${job.id}`,
    );
    expect(flow?.status).toBe("succeeded");
    if (!flow) {
      throw new Error("expected completed resume flow");
    }
    expect(listRecoveryObligations(flow)).toEqual([
      expect.objectContaining({ catchUpPolicy: "resume", status: "completed" }),
    ]);
  });

  it("fails closed when declared preflight proof is unavailable", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      reliability: {
        version: 1,
        programId: "preflight-required",
        ownerAgentId: "dev",
        criticality: "high",
        maxLatenessMs: 60_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "schedule_window",
        resourceClaims: [],
        sideEffectClass: "owned_state",
        approvalClass: "automatic",
        preflight: ["model_ready"],
        completionProof: ["task_terminal"],
      },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [job] });
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
    });
    await onTimer(state);
    expect(runIsolatedAgentJob).not.toHaveBeenCalled();
  });

  it("requires every declared completion proof", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      reliability: {
        version: 1,
        programId: "proof-required",
        ownerAgentId: "dev",
        criticality: "high",
        maxLatenessMs: 60_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "schedule_window",
        resourceClaims: [],
        sideEffectClass: "read_only",
        approvalClass: "automatic",
        preflight: [],
        completionProof: ["task_terminal", "authoritative_readback"],
      },
    };
    const base = {
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    };
    const missing = await verifyScheduledProgramCompletionProof({
      state: createCronServiceState(base),
      job,
      scheduledFor: now,
      status: "ok",
      endedAt: now + 1,
    });
    expect(missing).toMatchObject({
      verified: false,
      missing: ["authoritative_readback"],
    });
    const verified = await verifyScheduledProgramCompletionProof({
      state: createCronServiceState({
        ...base,
        resolveScheduledProgramCompletionProof: ({ proofs }) => proofs,
      }),
      job,
      scheduledFor: now,
      status: "ok",
      endedAt: now + 1,
    });
    expect(verified).toMatchObject({ verified: true, missing: [] });
  });

  it("turns an unproven contracted success into an error and emits an approval decision", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const onReliabilityDecision = vi.fn();
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      reliability: {
        version: 1,
        programId: "proof-enforced",
        ownerAgentId: "dev",
        criticality: "high",
        maxLatenessMs: 60_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "schedule_window",
        resourceClaims: [],
        sideEffectClass: "read_only",
        approvalClass: "automatic",
        preflight: [],
        completionProof: ["task_terminal", "artifact_digest"],
      },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [job] });
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
      onReliabilityDecision,
    });
    await onTimer(state);
    const persisted = await loadCronStore(storePath);
    expect(persisted.jobs[0]?.state.lastRunStatus).toBe("error");
    expect(persisted.jobs[0]?.state.lastError).toContain("artifact_digest");
    expect(onReliabilityDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approval_required",
        reason: "completion_proof_failed",
      }),
    );
  });
  it("routes main cron jobs onto a cron run lane derived from the target agent", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeat = vi.fn();
    const runHeartbeatOnce = vi.fn(async () => ({ status: "ran" as const, durationMs: 1 }));
    const job = {
      ...createDueMainJob({ now, wakeMode: "now" }),
      sessionKey: "agent:main-pr-router:main",
      state: { runningAtMs: now },
    };
    const cronRunSessionKey = `agent:main-pr-router:cron:main-heartbeat-job:run:${now}`;
    const sessionStorePath = path.join(path.dirname(path.dirname(storePath)), "sessions.json");
    await fs.writeFile(
      sessionStorePath,
      JSON.stringify({
        "agent:main-pr-router:main": {
          lastChannel: "discord",
          lastTo: "channel-1",
          lastAccountId: "default",
        },
      }),
      "utf8",
    );

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      resolveSessionStorePath: () => sessionStorePath,
      enqueueSystemEvent,
      requestHeartbeat,
      runHeartbeatOnce,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    const result = await executeJobCore(state, job);

    expect(result).toMatchObject({ status: "ok", sessionKey: cronRunSessionKey });
    expect(enqueueSystemEvent).toHaveBeenCalledWith("heartbeat seam tick", {
      agentId: undefined,
      sessionKey: cronRunSessionKey,
      contextKey: "cron:main-heartbeat-job",
      deliveryContext: { channel: "discord", to: "channel-1", accountId: "default" },
    });
    expect(runHeartbeatOnce).toHaveBeenCalledWith({
      source: "cron",
      intent: "immediate",
      reason: "cron:main-heartbeat-job",
      agentId: undefined,
      sessionKey: cronRunSessionKey,
      heartbeat: { target: "last" },
    });
  });

  it("persists the next schedule and hands off next-heartbeat main jobs", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeat = vi.fn();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueMainJob({ now, wakeMode: "next-heartbeat" })],
    });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent,
      requestHeartbeat,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    await onTimer(state);

    const cronRunSessionKey = `agent:main:cron:main-heartbeat-job:run:${now}`;
    expect(enqueueSystemEvent).toHaveBeenCalledWith("heartbeat seam tick", {
      agentId: undefined,
      sessionKey: cronRunSessionKey,
      contextKey: "cron:main-heartbeat-job",
    });
    expect(requestHeartbeat).toHaveBeenCalledWith({
      source: "cron",
      intent: "event",
      reason: "cron:main-heartbeat-job",
      agentId: undefined,
      sessionKey: cronRunSessionKey,
      heartbeat: { target: "last" },
    });

    const persisted = await loadCronStore(storePath);
    const job = persisted.jobs[0];
    if (!job) {
      throw new Error("expected persisted heartbeat cron job");
    }
    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.runningAtMs).toBeUndefined();
    expect(job.state.nextRunAtMs).toBe(now + 60_000);
    const task = findTaskByRunId(`cron:main-heartbeat-job:${now}`);
    if (!task) {
      throw new Error("expected cron task ledger record");
    }
    expect(task.runtime).toBe("cron");
    expect(task.sourceId).toBe("main-heartbeat-job");
    expect(task.ownerKey).toBe("");
    expect(task.scopeKind).toBe("system");
    expect(task.childSessionKey).toBe(cronRunSessionKey);
    expect(task.runId).toBe(`cron:main-heartbeat-job:${now}`);
    expect(task.label).toBe("main heartbeat job");
    expect(task.task).toBe("main heartbeat job");
    expect(task.status).toBe("succeeded");
    expect(task.deliveryStatus).toBe("not_applicable");
    expect(task.notifyPolicy).toBe("silent");
    expect(task.startedAt).toBe(now);
    expect(task.lastEventAt).toBe(now);
    expect(task.endedAt).toBe(now);
    expect(task?.cleanupAfter).toBe(now + 7 * 24 * 60 * 60_000);

    const delays = timeoutSpy.mock.calls
      .map(([, delay]) => delay)
      .filter((delay): delay is number => typeof delay === "number");
    const positiveDelays = delays.filter((delay) => delay > 0);
    expect(positiveDelays.length).toBeGreaterThan(0);

    timeoutSpy.mockRestore();
  });

  it("fails closed at the normal timer boundary when running work is unknown", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const resolveScheduledProgramCompetingWork = vi.fn(() => ({
      kind: "unknown" as const,
      workId: "task-flow:unverified",
    }));
    const job: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      reliability: {
        version: 1,
        programId: "pattern-lab.daily",
        ownerAgentId: "publisher-scheduler",
        criticality: "high",
        maxLatenessMs: 300_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "schedule_window",
        resourceClaims: [{ resource: "local-model", mode: "shared" }],
        sideEffectClass: "owned_state",
        approvalClass: "automatic",
        preflight: ["model_ready"],
        completionProof: ["task_terminal"],
      },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [job] });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      resolveScheduledProgramCompetingWork,
    });

    await onTimer(state);

    expect(resolveScheduledProgramCompetingWork).toHaveBeenCalledWith({
      job: expect.objectContaining({ id: job.id, reliability: job.reliability }),
      scheduledFor: now - 1,
      now,
    });
    expect(runIsolatedAgentJob).not.toHaveBeenCalled();
    const persisted = await loadCronStore(storePath);
    expect(persisted.jobs[0]?.state.nextRunAtMs).toBeGreaterThan(now);
    expect(persisted.jobs[0]?.state.lastRunStatus).toBeUndefined();
  });

  it("does not reserve two same-resource contracted jobs in one timer tick", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const reliability = {
      version: 1 as const,
      programId: "local-model.schedule",
      ownerAgentId: "scheduler",
      criticality: "high" as const,
      maxLatenessMs: 300_000,
      catchUpPolicy: "run_latest" as const,
      idempotencyScope: "schedule_window" as const,
      resourceClaims: [{ resource: "local-model", mode: "exclusive" as const }],
      sideEffectClass: "owned_state" as const,
      approvalClass: "automatic" as const,
      preflight: ["model_ready" as const],
      completionProof: ["task_terminal" as const],
    };
    const first: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "first-resource-job",
      reliability,
    };
    const second: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "second-resource-job",
      reliability: { ...reliability, programId: "local-model.schedule.second" },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [first, second] });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      resolveScheduledProgramCompetingWork: () => undefined,
      resolveScheduledProgramPreflight: ({ checks }) => checks,
    });

    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    const persisted = await loadCronStore(storePath);
    expect(persisted.jobs.find((job) => job.id === "first-resource-job")?.state.lastRunStatus).toBe(
      "ok",
    );
    expect(
      persisted.jobs.find((job) => job.id === "second-resource-job")?.state.nextRunAtMs,
    ).toBeGreaterThan(now);
  });

  it("admits the higher-criticality same-resource job first", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const reliability = {
      version: 1 as const,
      programId: "local-model.schedule",
      ownerAgentId: "scheduler",
      criticality: "low" as const,
      maxLatenessMs: 300_000,
      catchUpPolicy: "run_latest" as const,
      idempotencyScope: "schedule_window" as const,
      resourceClaims: [{ resource: "local-model", mode: "exclusive" as const }],
      sideEffectClass: "owned_state" as const,
      approvalClass: "automatic" as const,
      preflight: ["model_ready" as const],
      completionProof: ["task_terminal" as const],
    };
    const low: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "low-resource-job",
      reliability,
    };
    const critical: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "critical-resource-job",
      reliability: {
        ...reliability,
        programId: "local-model.schedule.critical",
        criticality: "critical",
      },
    };
    await writeCronStoreSnapshot({ storePath, jobs: [low, critical] });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      resolveScheduledProgramCompetingWork: () => undefined,
      resolveScheduledProgramPreflight: ({ checks }) => checks,
    });

    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    const persisted = await loadCronStore(storePath);
    expect(
      persisted.jobs.find((job) => job.id === "critical-resource-job")?.state.lastRunStatus,
    ).toBe("ok");
    expect(
      persisted.jobs.find((job) => job.id === "low-resource-job")?.state.nextRunAtMs,
    ).toBeGreaterThan(now);
  });

  it("keeps independent same-tick resource reservations known", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const reliability = (programId: string, resource: string) => ({
      version: 1 as const,
      programId,
      ownerAgentId: "scheduler",
      criticality: "high" as const,
      maxLatenessMs: 300_000,
      catchUpPolicy: "run_latest" as const,
      idempotencyScope: "schedule_window" as const,
      resourceClaims: [{ resource, mode: "exclusive" as const }],
      sideEffectClass: "owned_state" as const,
      approvalClass: "automatic" as const,
      preflight: ["model_ready" as const],
      completionProof: ["task_terminal" as const],
    });
    const first: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "first-independent-resource-job",
      reliability: reliability("resource.schedule.first", "local-model-a"),
    };
    const second: CronJob = {
      ...createDueIsolatedAgentJob({ now }),
      id: "second-independent-resource-job",
      reliability: reliability("resource.schedule.second", "local-model-b"),
    };
    await writeCronStoreSnapshot({ storePath, jobs: [first, second] });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      resolveScheduledProgramCompetingWork: () => undefined,
      resolveScheduledProgramPreflight: ({ checks }) => checks,
    });

    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(2);
  });

  it("runs command cron jobs without isolated agent setup", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const runIsolatedAgentJob = vi.fn(async () => ({ status: "ok" as const }));
    const runCommandJob = vi.fn(async () => ({
      status: "ok" as const,
      summary: "command ok",
    }));
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob,
      runCommandJob,
    });
    const job = createDueCommandJob({ now });

    const result = await executeJobCore(state, job);

    expect(result).toMatchObject({ status: "ok", summary: "command ok" });
    expect(runCommandJob).toHaveBeenCalledWith({
      job,
      abortSignal: undefined,
    });
    expect(runIsolatedAgentJob).not.toHaveBeenCalled();
  });

  it("records isolated cron task runs against the backing cron session", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeat = vi.fn();
    const runIsolatedAgentJob = vi.fn(async () => ({
      status: "ok" as const,
      summary: "done",
      sessionKey: "agent:finn:cron:isolated-agent-job:run:run-1",
    }));

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueIsolatedAgentJob({ now })],
    });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent,
      requestHeartbeat,
      runIsolatedAgentJob,
    });

    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ id: "isolated-agent-job" }),
        message: "run isolated cron",
      }),
    );
    const task = findTaskByRunId(`cron:isolated-agent-job:${now}`);
    if (!task) {
      throw new Error("expected isolated cron task ledger record");
    }
    expect(task.childSessionKey).toBe("agent:finn:cron:isolated-agent-job");
    expect(task.status).toBe("succeeded");
    expect(task.terminalSummary).toBe("done");
  });

  it("seeds active scheduled cron task progress for status surfaces", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeat = vi.fn();
    let resolveRun: ((value: { status: "ok"; summary: string }) => void) | undefined;
    const runIsolatedAgentJob = vi.fn(
      () =>
        new Promise<{ status: "ok"; summary: string }>((resolve) => {
          resolveRun = resolve;
        }),
    );

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueIsolatedAgentJob({ now })],
    });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent,
      requestHeartbeat,
      runIsolatedAgentJob,
    });

    const timerRun = onTimer(state);
    await vi.waitFor(() => {
      expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);
    });

    const task = findTaskByRunId(`cron:isolated-agent-job:${now}`);
    if (!task) {
      throw new Error("expected active cron task ledger record");
    }
    expect(task.status).toBe("running");
    expect(task.progressSummary).toBe("Running cron job.");
    expect(formatTaskStatusDetail(task)).toBe("Running cron job.");

    resolveRun?.({ status: "ok", summary: "done" });
    await timerRun;
  });

  it("keeps scheduler progress when task ledger creation fails", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const enqueueSystemEvent = vi.fn();
    const requestHeartbeat = vi.fn();
    const ledgerError = new Error("disk full");

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueMainJob({ now, wakeMode: "next-heartbeat" })],
    });

    const createTaskRecordSpy = vi
      .spyOn(detachedTaskRuntime, "createRunningTaskRun")
      .mockImplementation(() => {
        throw ledgerError;
      });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent,
      requestHeartbeat,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    await onTimer(state);

    expect(logger.warn).toHaveBeenCalledWith(
      { jobId: "main-heartbeat-job", error: ledgerError },
      "cron: failed to create task ledger record",
    );
    const cronRunSessionKey = `agent:main:cron:main-heartbeat-job:run:${now}`;
    expect(enqueueSystemEvent).toHaveBeenCalledWith("heartbeat seam tick", {
      agentId: undefined,
      sessionKey: cronRunSessionKey,
      contextKey: "cron:main-heartbeat-job",
    });

    createTaskRecordSpy.mockRestore();
  });
});

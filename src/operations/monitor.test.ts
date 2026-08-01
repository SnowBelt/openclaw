import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../test/helpers/temp-dir.js";
import type { CronServiceContract } from "../cron/service-contract.js";
import {
  closeOperationsIncidentLedgerForTests,
  reconcileOperationsIncidentLedger,
} from "./incident-ledger.js";
import {
  getOperationsShadowMonitorState,
  resetOperationsShadowMonitorStateForTest,
  startOperationsShadowMonitor,
  type OperationsShadowObservation,
} from "./monitor.js";

const tempDirs: string[] = [];

function ledgerPath(): string {
  return path.join(makeTempDir(tempDirs, "operations-monitor-ledger-"), "ledger.sqlite");
}

function observation(ids: string[]): OperationsShadowObservation {
  return {
    findings: ids.map((id) => ({
      id,
      severity: "warning" as const,
      category: "workflow" as const,
      title: `Finding ${id}`,
      detail: "Sanitized monitor finding.",
      lastObservedAt: 0,
      disposition: "watching" as const,
      responseState: "monitoring" as const,
      impact: "A workflow needs observation.",
    })),
    authoritativeCategories: ["workflow"],
  };
}

describe("Operations Room monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetOperationsShadowMonitorStateForTest();
    closeOperationsIncidentLedgerForTests();
    cleanupTempDirs(tempDirs);
  });

  it("runs bounded non-overlapping sweeps and stops cleanly", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const collect = vi.fn(async () => observation(["workflow:flow-1:blocked"]));
    const warn = vi.fn();
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => now,
      collect,
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
      log: { warn },
    });

    vi.runAllTicks();
    await Promise.resolve();
    expect(getOperationsShadowMonitorState()).toMatchObject({
      running: true,
      sweepCount: 1,
      findingIds: ["workflow:flow-1:blocked"],
    });
    expect(warn).toHaveBeenCalledTimes(1);

    now = 6_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);

    stop();
    expect(getOperationsShadowMonitorState().running).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("persists first-observed and resolved transitions without opening the page", async () => {
    vi.useFakeTimers();
    let now = 10_000;
    let current = observation(["workflow:brief:blocked"]);
    const monitorLedgerPath = ledgerPath();
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => now,
      collect: async () => current,
      incidentLedgerOptions: { ledgerPath: monitorLedgerPath },
      log: { warn: vi.fn() },
    });

    vi.runAllTicks();
    await Promise.resolve();
    current = observation([]);
    now = 15_000;
    await vi.advanceTimersByTimeAsync(5_000);
    stop();
    closeOperationsIncidentLedgerForTests(monitorLedgerPath);

    const persisted = reconcileOperationsIncidentLedger({
      findings: [],
      now: 16_000,
      authoritativeCategories: [],
      options: { ledgerPath: monitorLedgerPath },
    });
    expect(persisted.history[0]).toMatchObject({
      id: "workflow:brief:blocked",
      firstObservedAt: 10_000,
      lastObservedAt: 10_000,
      resolvedAt: 15_000,
    });
  });

  it("reports a same-severity incident when it recurs after resolution", async () => {
    vi.useFakeTimers();
    let now = 10_000;
    let current = observation(["workflow:recurrence:blocked"]);
    const warn = vi.fn();
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => now,
      collect: async () => current,
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
      log: { warn },
    });

    vi.runAllTicks();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);

    current = observation([]);
    now = 15_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(warn).toHaveBeenCalledTimes(1);

    current = observation(["workflow:recurrence:blocked"]);
    now = 20_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith("operations monitor found: workflow:recurrence:blocked");
    stop();
  });

  it("records failed attempts without fabricating a successful sweep", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const collect = vi
      .fn<(now: number) => Promise<OperationsShadowObservation>>()
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValue(observation([]));
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => now,
      collect,
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
      log: { warn: vi.fn() },
    });

    vi.runAllTicks();
    await Promise.resolve();
    expect(getOperationsShadowMonitorState()).toMatchObject({
      lastAttemptAt: 1_000,
      lastSweepAt: null,
      attemptCount: 1,
      sweepCount: 0,
      lastError: "probe failed",
    });

    now = 6_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getOperationsShadowMonitorState()).toMatchObject({
      lastAttemptAt: 6_000,
      lastSweepAt: 6_000,
      attemptCount: 2,
      sweepCount: 1,
      lastError: null,
    });
    stop();
  });

  it("routes eligible findings through the supervised repair engine", async () => {
    vi.useFakeTimers();
    const records: import("./types.js").OperationsRemediationRecord[] = [];
    const apply = vi.fn(async () => {});
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => 1_000,
      cron: {} as CronServiceContract,
      collect: async () => ({
        findings: [
          {
            id: "cron:job-1:failure",
            severity: "warning",
            category: "cron",
            entityId: "job-1",
            title: "Schedule failed",
            detail: "Repeated failure",
            lastObservedAt: 1_000,
            disposition: "needs_user",
            responseState: "waiting_for_user",
            impact: "Future runs may fail.",
          },
        ],
        authoritativeCategories: ["cron"],
      }),
      remediationRecipes: [
        {
          id: "test.low.v1",
          risk: "low",
          domain: "routine",
          confidence: 1,
          recommendationReason: "The bounded repair contains repeated failures.",
          exactRepair: "Apply bounded repair.",
          expectedChange: "Only the matching schedule changes.",
          verificationPlan: "Read the schedule back after applying it.",
          rollback: "Restore previous state.",
          reversible: true,
          verificationMode: "authoritative_readback",
          rollbackVerificationMode: "authoritative_readback",
          matches: () => true,
          apply,
          verify: async () => ({ passed: true, evidence: "Verified." }),
          rollbackRepair: async () => {},
          verifyRollback: async () => ({ passed: true, evidence: "Rollback verified." }),
        },
      ],
      remediationStore: {
        list: () => records,
        upsert: (record) => {
          const index = records.findIndex((entry) => entry.id === record.id);
          if (index >= 0) {
            records[index] = record;
          } else {
            records.push(record);
          }
        },
      },
      remediationAi: {
        investigate: async () => ({ confidence: 1, recommendation: "Safe." }),
        judge: async () => ({ approved: true, reason: "Safe." }),
      },
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
      log: { warn: vi.fn() },
    });

    vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledOnce();
    expect(records.at(-1)?.status).toBe("completed");
    expect(getOperationsShadowMonitorState().autoRemediationEnabled).toBe(true);
    stop();
  });

  it("resolves the current cron service again after a runtime reload", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    let findingId = "cron:job-1:failure";
    const firstCron = { identity: "first" } as unknown as CronServiceContract;
    const secondCron = { identity: "second" } as unknown as CronServiceContract;
    let currentCron = firstCron;
    const contexts: CronServiceContract[] = [];
    const records: import("./types.js").OperationsRemediationRecord[] = [];
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => now,
      getCron: () => currentCron,
      collect: async () => ({
        findings: [
          {
            id: findingId,
            severity: "warning",
            category: "cron",
            entityId: findingId,
            title: "Schedule failed",
            detail: "Repeated failure",
            lastObservedAt: now,
            disposition: "needs_user",
            responseState: "waiting_for_user",
            impact: "Future runs may fail.",
          },
        ],
        authoritativeCategories: ["cron"],
      }),
      remediationRecipes: [
        {
          id: "test.low.reload.v1",
          risk: "low",
          domain: "routine",
          confidence: 1,
          recommendationReason: "The bounded repair contains repeated failures.",
          exactRepair: "Apply bounded repair.",
          expectedChange: "Only the matching schedule changes.",
          verificationPlan: "Read the schedule back after applying it.",
          rollback: "Restore previous state.",
          reversible: true,
          verificationMode: "authoritative_readback",
          rollbackVerificationMode: "authoritative_readback",
          matches: () => true,
          apply: async (_finding, context) => {
            contexts.push(context.cron);
          },
          verify: async () => ({ passed: true, evidence: "Verified." }),
          rollbackRepair: async () => {},
          verifyRollback: async () => ({ passed: true, evidence: "Rollback verified." }),
        },
      ],
      remediationStore: {
        list: () => records,
        upsert: (record) => {
          const index = records.findIndex((entry) => entry.id === record.id);
          if (index >= 0) {
            records[index] = record;
          } else {
            records.push(record);
          }
        },
      },
      remediationAi: {
        investigate: async () => ({ confidence: 1, recommendation: "Safe." }),
        judge: async () => ({ approved: true, reason: "Safe." }),
      },
      incidentLedgerOptions: { ledgerPath: ledgerPath() },
      log: { warn: vi.fn() },
    });

    vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
    currentCron = secondCron;
    findingId = "cron:job-2:failure";
    now = 6_000;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(contexts).toEqual([firstCron, secondCron]);
    stop();
  });
});

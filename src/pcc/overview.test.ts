import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import type { PccLedger } from "./domain/ledger.js";
import { createPccExecutionPlan, transitionPccExecutionPlan } from "./execution-plan.js";
import { resolvePccExecutionProfilePreset } from "./execution-profile.js";
import { withPccExecutionPlanMetadata } from "./execution-service.js";
import { assertPccLedger } from "./ledger-store.js";
import { buildPccOverview } from "./overview.js";

function project(id: string, updatedOffset: number): PccProject {
  return {
    id,
    title: `Project ${id}`,
    goal: `Complete ${id}`,
    status: "active",
    priority: 3,
    metadata: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: new Date(Date.parse("2026-08-02T00:00:00.000Z") + updatedOffset).toISOString(),
  };
}

function ledgerWithProjects(count: number): PccLedger {
  return {
    version: 1,
    projects: [
      {
        ...project("project-command-center", 0),
        title: "Project Command Center",
        status: "complete_with_maintenance",
      },
      ...Array.from({ length: count }, (_, index) => project(`user-${index + 1}`, index)),
    ],
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    lastKnownGood: [],
  };
}

describe("PCC overview read model", () => {
  it("keeps 100 user projects visible while excluding the internal system record", () => {
    const overview = buildPccOverview(ledgerWithProjects(100), 42);

    expect(overview.ledgerRevision).toBe(42);
    expect(overview.projects).toHaveLength(100);
    expect(overview.projects.some((item) => item.id === "project-command-center")).toBe(false);
    expect(new Set(overview.projects.map((item) => item.id)).size).toBe(100);
    expect(JSON.stringify(overview).length).toBeLessThan(500_000);
  });

  it("keeps archived user projects available to the explicit Projects archive view", () => {
    const ledger = ledgerWithProjects(2);
    ledger.projects[2] = { ...ledger.projects[2]!, status: "archived" };

    const overview = buildPccOverview(ledger, 43);

    expect(overview.projects.map((item) => item.id)).toEqual(["user-1", "user-2"]);
    expect(overview.projects.find((item) => item.id === "user-2")).toMatchObject({
      status: "archived",
      workState: "complete",
    });
    expect(overview.projects.some((item) => item.id === "project-command-center")).toBe(false);
  });

  it("does not report legacy work-loop flags as live work without a durable execution plan", () => {
    const ledger = ledgerWithProjects(1);
    ledger.projects[1] = {
      ...ledger.projects[1]!,
      metadata: {
        pccWorkLoop: {
          enabled: true,
          state: "working",
        },
      },
    };

    const overview = buildPccOverview(ledger, 44);

    expect(overview.projects[0]).toMatchObject({
      id: "user-1",
      workState: "ready",
      activeAgentCount: 0,
    });
  });

  it("surfaces a failed durable plan instead of falling back to a ready state", () => {
    const ledger = ledgerWithProjects(1);
    const projectRecord = ledger.projects[1]!;
    const prepared = createPccExecutionPlan({
      id: "failed-plan",
      projectId: projectRecord.id,
      projectRevision: "1",
      profile: resolvePccExecutionProfilePreset("local_parallel"),
      coordinator: { sessionId: "session", runId: "run" },
      admittedWorkerCount: 1,
      createdAt: "2026-08-02T04:00:00.000Z",
    });
    const failed = transitionPccExecutionPlan(
      transitionPccExecutionPlan(prepared, "dispatching", {
        at: "2026-08-02T04:00:01.000Z",
      }),
      "failed",
      { at: "2026-08-02T04:00:02.000Z", reason: "worker exited" },
    );
    projectRecord.metadata = withPccExecutionPlanMetadata(
      projectRecord,
      failed,
      "ui:failed-plan",
      failed.updatedAt,
    );

    const overview = buildPccOverview(ledger, 45);

    expect(overview.projects[0]).toMatchObject({ id: "user-1", workState: "failed" });
  });

  it("builds the 100-project overview with a local p95 below 250ms", () => {
    const ledger = ledgerWithProjects(100);
    const timings = Array.from({ length: 30 }, (_, index) => {
      const started = performance.now();
      buildPccOverview(ledger, index);
      return performance.now() - started;
    }).toSorted((left, right) => left - right);
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

    expect(p95).toBeLessThan(250);
  });

  it("attributes recent activity to the authenticated editor recorded on the item", () => {
    const ledger = ledgerWithProjects(1);
    ledger.milestones.push({
      id: "milestone-1",
      projectId: "user-1",
      title: "Build the overview",
      status: "in_progress",
      order: 0,
      percentComplete: 50,
      metadata: { pccLastActor: "Matthew", pccLastAction: "Milestone updated" },
      createdAt: "2026-08-02T01:00:00.000Z",
      updatedAt: "2026-08-02T02:00:00.000Z",
    });

    const overview = buildPccOverview(ledger, 3, "2026-08-02T03:00:00.000Z");

    expect(overview.recentActivity[0]).toMatchObject({
      projectId: "user-1",
      actor: "Matthew",
      action: "Milestone updated: Build the overview",
    });
  });

  it("isolates malformed historical receipt timestamps without hiding project work", () => {
    const ledger = ledgerWithProjects(1);
    ledger.receipts.push(
      {
        id: "missing-completion-time",
        projectId: "user-1",
        milestoneId: "legacy-milestone",
        summary: "Historical receipt",
        proofEvidenceIds: ["proof-1"],
        proofLevel: "local",
      } as unknown as PccLedger["receipts"][number],
      {
        id: "invalid-completion-time",
        projectId: "user-1",
        milestoneId: "legacy-milestone",
        summary: "Historical receipt",
        proofEvidenceIds: ["proof-2"],
        proofLevel: "local",
        completedAt: "20260802T043752Z",
      },
      {
        id: "null-completion-time",
        projectId: "user-1",
        milestoneId: "legacy-milestone",
        summary: "Historical receipt",
        proofEvidenceIds: ["proof-null"],
        proofLevel: "local",
        completedAt: null,
      } as unknown as PccLedger["receipts"][number],
      {
        id: "valid-completion-time",
        projectId: "user-1",
        milestoneId: "legacy-milestone",
        summary: "Current receipt",
        proofEvidenceIds: ["proof-3"],
        proofLevel: "local",
        completedAt: "2026-08-02T04:37:52Z",
      },
    );
    ledger.modelRunReceipts = [
      {
        id: "invalid-model-run",
        projectId: "user-1",
        sourceRunId: "run-1",
        executor: "local",
        purpose: "qa",
        provider: "local",
        model: "test-model",
        status: "succeeded",
        startedAt: "2026-08-02T04:00:00.000Z",
        completedAt: "not-a-date",
        usageSource: "unavailable",
      },
      {
        id: "null-model-run",
        projectId: "user-1",
        sourceRunId: "run-null",
        executor: "local",
        purpose: "qa",
        provider: "local",
        model: "test-model",
        status: "succeeded",
        startedAt: "2026-08-02T04:00:00.000Z",
        completedAt: null,
        usageSource: "unavailable",
      } as never,
    ];

    const overview = buildPccOverview(ledger, 44, "2026-08-02T05:00:00.000Z");

    expect(overview.projects.map((item) => item.id)).toEqual(["user-1"]);
    expect(overview.recentActivity).toContainEqual(
      expect.objectContaining({
        id: "activity:receipt:valid-completion-time",
        at: "2026-08-02T04:37:52.000Z",
      }),
    );
    expect(overview.recentActivity.map((item) => item.id)).not.toContain(
      "activity:receipt:missing-completion-time",
    );
    expect(overview.recentActivity.map((item) => item.id)).not.toContain(
      "activity:receipt:invalid-completion-time",
    );
    expect(overview.recentActivity.map((item) => item.id)).not.toContain(
      "activity:receipt:null-completion-time",
    );
    expect(overview.recentActivity.map((item) => item.id)).not.toContain(
      "activity:model:invalid-model-run",
    );
    expect(overview.recentActivity.map((item) => item.id)).not.toContain(
      "activity:model:null-model-run",
    );
    expect(ledger.receipts).toHaveLength(4);
  });

  it("orders equal-time activity deterministically by stable activity id", () => {
    const ledger = ledgerWithProjects(1);
    ledger.receipts.push(
      {
        id: "receipt-z",
        projectId: "user-1",
        milestoneId: "milestone-1",
        summary: "Z",
        proofEvidenceIds: ["proof-z"],
        proofLevel: "local",
        completedAt: "2026-08-02T04:00:00.000Z",
      },
      {
        id: "receipt-a",
        projectId: "user-1",
        milestoneId: "milestone-1",
        summary: "A",
        proofEvidenceIds: ["proof-a"],
        proofLevel: "local",
        completedAt: "2026-08-02T04:00:00.000Z",
      },
    );

    const receiptActivity = buildPccOverview(ledger, 45).recentActivity.filter((item) =>
      item.id.startsWith("activity:receipt:"),
    );

    expect(receiptActivity.map((item) => item.id)).toEqual([
      "activity:receipt:receipt-a",
      "activity:receipt:receipt-z",
    ]);
  });

  it("keeps legacy receipt timestamps from breaking overview activity sorting", () => {
    const createdAt = "2026-08-02T02:00:00.000Z";
    const legacy = ledgerWithProjects(1) as unknown as Record<string, unknown>;
    legacy.receipts = [
      {
        id: "legacy-receipt",
        projectId: "user-1",
        milestoneId: "milestone-1",
        summary: "Legacy receipt",
        proofEvidenceIds: [],
        proofLevel: "local",
        createdAt,
      },
    ];

    const canonical = assertPccLedger(legacy);
    expect(() => buildPccOverview(canonical, 4)).not.toThrow();
    expect(canonical.receipts[0]?.completedAt).toBe(createdAt);
  });
});

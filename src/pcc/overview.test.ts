import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import type { PccLedger } from "./domain/ledger.js";
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

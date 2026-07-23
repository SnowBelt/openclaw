import { describe, expect, it } from "vitest";
import {
  groupOperationsAgents,
  operationsChangesSince,
  operationsWorkingItems,
} from "./operations-model.ts";
import {
  createOperationsTestSnapshot,
  createSevenGroupOperationsTestSnapshot,
} from "./operations.fixture.ts";

describe("Operations Room presentation model", () => {
  it("keeps severity and health ahead of pins in priority sort", () => {
    const snapshot = createOperationsTestSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === "main")!;
    const releaseOps = snapshot.agents.find((agent) => agent.id === "release-ops")!;
    main.attentionState = "watching";
    main.healthState = "degraded";
    releaseOps.attentionState = "needs_user";
    const group = groupOperationsAgents({
      agents: [main, releaseOps],
      lastVisitedAt: null,
      pinnedAgentIds: [main.id],
      query: "",
      sort: "priority",
    }).find((candidate) => candidate.id === "attention");

    expect(group?.agents.map((agent) => agent.id)).toEqual(["release-ops", "main"]);
  });

  it("shows only active work summaries and deduplicates their rollups", () => {
    const snapshot = createOperationsTestSnapshot();
    const items = operationsWorkingItems(snapshot);

    expect(items.map((item) => item.title)).toEqual(["Verify Operations Room"]);
    expect(items).toHaveLength(1);
  });

  it("shows an active workflow without a represented task and carries its cancel target", () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.agents = snapshot.agents.map((agent) => {
      const next = { ...agent };
      delete next.currentWork;
      return next;
    });
    snapshot.tasks = [];
    snapshot.activityRollups = [];
    snapshot.workflows[0] = {
      ...snapshot.workflows[0],
      activeTaskCount: 0,
      currentStep: "Waiting for a verified handoff",
    };

    expect(operationsWorkingItems(snapshot)).toEqual([
      expect.objectContaining({
        id: "flow:flow-1",
        workflowId: "flow-1",
        title: "Managed verification workflow",
        summary: "Waiting for a verified handoff",
      }),
    ]);
  });

  it("uses incident transitions, not repeated observations, for since-last-visit changes", () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.activityRollups = [];
    const boundary = snapshot.generatedAt - 45_000;
    snapshot.incidentHistory = [
      {
        ...snapshot.incidentHistory[0],
        firstObservedAt: boundary - 60_000,
        lastObservedAt: boundary + 30_000,
        transitions: [{ at: boundary - 30_000, to: "warning" }],
      },
    ];

    expect(operationsChangesSince(snapshot, boundary)).toEqual([]);

    snapshot.incidentHistory[0].transitions.push({
      at: boundary + 10_000,
      from: "warning",
      to: "critical",
    });
    expect(operationsChangesSince(snapshot, boundary)).toMatchObject([
      { kind: "incident", at: boundary + 10_000 },
    ]);
  });

  it("keeps all seven agent groups in operational priority order", () => {
    const now = Date.now();
    const snapshot = createSevenGroupOperationsTestSnapshot(now);
    const groups = groupOperationsAgents({
      agents: snapshot.agents,
      lastVisitedAt: now - 30_000,
      pinnedAgentIds: ["off-agent"],
      query: "",
      sort: "priority",
    });

    expect(groups.map((group) => group.id)).toEqual([
      "urgent",
      "attention",
      "working",
      "waiting",
      "recent",
      "ready",
      "off",
    ]);
  });
});

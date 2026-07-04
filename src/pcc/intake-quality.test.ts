import { describe, expect, it } from "vitest";
import { evaluatePccProjectSetup } from "./intake-quality.js";

const now = "2026-07-04T00:00:00Z";

describe("PCC intake quality gates", () => {
  it("does not require setup repair for archived projects", () => {
    const evaluation = evaluatePccProjectSetup({
      project: {
        id: "archived-project",
        title: "Archived project",
        status: "archived",
        createdAt: now,
        updatedAt: now,
        metadata: {},
      },
      milestones: [],
      subMilestones: [],
    });

    expect(evaluation.status).toBe("passing");
    expect(evaluation.missing).toEqual([]);
    expect(evaluation.needsReview).toEqual([]);
    expect(evaluation.runnable).toBe(false);
  });

  it("reports exact setup gaps for active projects", () => {
    const evaluation = evaluatePccProjectSetup({
      project: {
        id: "active-project",
        title: "Active project",
        status: "active",
        createdAt: now,
        updatedAt: now,
        metadata: {},
      },
      milestones: [],
      subMilestones: [],
    });

    expect(evaluation.status).toBe("missing");
    expect(evaluation.missing).toContain("Project goal is missing.");
    expect(evaluation.missing).toContain("Required intake answer missing: Goal.");
    expect(evaluation.missing).toContain("No active milestones exist.");
    expect(evaluation.runnable).toBe(false);
  });
});

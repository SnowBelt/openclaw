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

  it("accepts legacy recommendedWorker as milestone responsibility", () => {
    const evaluation = evaluatePccProjectSetup({
      project: {
        id: "legacy-project",
        title: "SNES Game Creator",
        goal: "Create a safe SNES project workflow.",
        status: "active",
        createdAt: now,
        updatedAt: now,
        metadata: {
          pccWorkflowTemplateId: "snes-studio",
          pccIntake: {
            approved: true,
            answers: {
              goal: "Create a safe SNES project workflow.",
              firstDeliverable: "A toolchain preflight.",
              doneProof: "Read-only proof and receipts.",
              constraints: "No ROM files or installs without approval.",
              owner: "OpenClaw local agent",
              blockers: "Patch tool may be missing.",
            },
          },
        },
      },
      milestones: [
        {
          id: "legacy-milestone",
          projectId: "legacy-project",
          title: "Verify toolchain",
          status: "not_started",
          order: 1,
          implementationPlan: "Run read-only toolchain checks.",
          acceptanceCriteria: ["Missing tools are recorded."],
          createdAt: now,
          updatedAt: now,
          metadata: {
            recommendedWorker: "OpenClaw local agent",
            proofRequired: "local_test",
          },
        },
      ],
      subMilestones: [
        {
          id: "legacy-submilestone",
          projectId: "legacy-project",
          milestoneId: "legacy-milestone",
          title: "List tools",
          status: "not_started",
          order: 1,
          implementationPlan: "List required tools.",
          acceptanceCriteria: ["Tool list exists."],
          createdAt: now,
          updatedAt: now,
          metadata: {},
        },
      ],
    });

    expect(evaluation.missing).not.toContain(
      'Milestone "Verify toolchain" is missing an owner/responsibility.',
    );
    expect(evaluation.status).toBe("passing");
    expect(evaluation.runnable).toBe(true);
  });
});

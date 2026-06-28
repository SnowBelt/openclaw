import { describe, expect, it } from "vitest";
import {
  evaluatePccProjectSetup,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
  withPccPhase2Metadata,
} from "./intake-quality.js";
import {
  buildPccWorkflowDraft,
  getPccWorkflowTemplate,
  PCC_WORKFLOW_TEMPLATES,
} from "./project-workflows.js";

describe("PCC workflow templates", () => {
  it("exposes standard workflow templates", () => {
    expect(PCC_WORKFLOW_TEMPLATES.map((template) => template.id)).toEqual([
      "software-product",
      "dashboard-data",
      "creative-media",
      "research",
      "trading-finance",
      "snes-studio",
      "custom",
    ]);
  });

  it("falls back to software product when template is unknown", () => {
    expect(getPccWorkflowTemplate("missing").id).toBe("software-product");
  });

  it("creates low-reasoning-ready milestones and sub-milestones", () => {
    const draft = buildPccWorkflowDraft({
      title: "SNES Game Creator",
      goal: "Build patch-only games",
      templateId: "snes-studio",
      priority: 1,
      codexPlanningAllowed: true,
    });

    expect(draft.project.metadata?.pccWorkflowTemplateId).toBe("snes-studio");
    expect(draft.project.phases?.length).toBeGreaterThan(0);
    expect(draft.milestones.length).toBe(7);
    expect(draft.milestones[0]?.metadata).toMatchObject({ pccStopHere: true });
    expect(draft.subMilestonesByMilestoneTitle["Build playable MVP loop"]?.length).toBeGreaterThan(
      2,
    );
    expect(
      draft.subMilestonesByMilestoneTitle["Build playable MVP loop"]?.[0]?.implementationPlan,
    ).toContain("Execute:");
  });

  it("marks initial plan as needing permission when Codex planning is requested but not allowed", () => {
    const draft = buildPccWorkflowDraft({
      title: "New App",
      templateId: "software-product",
      planningMode: "codex_full_plan",
      codexPlanningAllowed: false,
    });

    expect(draft.project.metadata?.pccPlanningMode).toBe("codex_full_plan");
    expect(draft.project.metadata?.pccIntakeStatus).toBe("codex_permission_needed");
    expect(draft.milestones[0]?.status).toBe("needs_approval");
  });

  it("records local Project Manager intake mode without requiring Codex", () => {
    const draft = buildPccWorkflowDraft({
      title: "New App",
      templateId: "software-product",
      planningMode: "local_project_manager",
      codexPlanningAllowed: false,
    });

    expect(draft.project.metadata?.pccPlanningMode).toBe("local_project_manager");
    expect(draft.project.metadata?.pccIntakeStatus).toBe("project_manager_review");
    expect(draft.milestones[0]?.status).toBe("not_started");
  });

  it("recommends workflows and evaluates setup quality gates", () => {
    const answers = {
      goal: "Create a patch-only SNES Game Creator.",
      firstDeliverable: "A playable demo.",
      doneProof: "Emulator proof and receipts.",
      constraints: "No ROM files.",
      owner: "local_openclaw_agent",
      blockers: "Toolchain availability.",
    };
    const draft = buildPccWorkflowDraft({
      title: "SNES Game Creator",
      goal: "Create patch-only SNES games",
      templateId: "snes-studio",
    });
    const now = "2026-06-28T00:00:00Z";
    const project = {
      id: "project-1",
      title: draft.project.title,
      goal: draft.project.goal,
      status: draft.project.status,
      phases: draft.project.phases,
      metadata: {
        ...draft.project.metadata,
        pccIntake: { answers, approved: true, approvedAt: now },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = draft.milestones.map((milestone, index) => ({
      ...milestone,
      id: `milestone-${index}`,
      projectId: "project-1",
      createdAt: now,
      updatedAt: now,
    }));
    const subMilestones = milestones.flatMap((milestone) =>
      (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []).map((subMilestone, index) =>
        Object.assign({}, subMilestone, {
          id: `${milestone.id}-sub-${index}`,
          projectId: "project-1",
          milestoneId: milestone.id,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );

    expect(
      recommendPccWorkflow({ title: project.title, goal: project.goal, intakeAnswers: answers })
        .templateId,
    ).toBe("snes-studio");
    expect(pccMissingRequiredIntakeAnswers(answers)).toEqual([]);

    const evaluation = evaluatePccProjectSetup({ project, milestones, subMilestones });
    expect(evaluation.status).toBe("passing");
    expect(evaluation.runnable).toBe(true);

    const withMetadata = withPccPhase2Metadata(project, evaluation, now);
    expect(withMetadata.metadata?.pccQualityGate).toMatchObject({ status: "passing" });
    expect(withMetadata.metadata?.pccSetupScore).toMatchObject({ runnable: true, score: 100 });
    expect(withMetadata.metadata?.pccCompliance).toMatchObject({ badge: "Passing" });
  });

  it("keeps blank intake blocked instead of treating setup as runnable", () => {
    const draft = buildPccWorkflowDraft({
      title: "Untyped project",
      templateId: "software-product",
    });
    const now = "2026-06-28T00:00:00Z";
    const project = {
      id: "project-1",
      title: draft.project.title,
      status: draft.project.status,
      metadata: { ...draft.project.metadata, pccIntake: { answers: {}, approved: false } },
      createdAt: now,
      updatedAt: now,
    };

    const evaluation = evaluatePccProjectSetup({ project, milestones: [], subMilestones: [] });

    expect(evaluation.status).toBe("missing");
    expect(evaluation.runnable).toBe(false);
    expect(evaluation.missing.join("\n")).toContain("Required intake answer missing");
  });
});

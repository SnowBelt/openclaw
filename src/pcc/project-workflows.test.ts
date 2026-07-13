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

  it("routes expert Codex work narrowly while keeping routine work local", () => {
    const draft = buildPccWorkflowDraft({
      title: "New App",
      templateId: "software-product",
      planningMode: "codex_full_plan",
      aiUsePolicy: "codex_expert",
      codexPlanningAllowed: false,
    });

    expect(draft.project.metadata?.pccAiUsePolicy).toBe("codex_expert");
    expect(
      draft.milestones.find((item) => item.title === "Define scope and success criteria")?.metadata,
    ).toMatchObject({ pccResponsibility: "codex", requiresCodex: true });
    expect(draft.milestones.find((item) => item.title === "Build MVP")?.metadata).toMatchObject({
      pccResponsibility: "local_openclaw_agent",
      requiresCodex: false,
    });
    expect(
      draft.milestones.find((item) => item.title === "Production proof")?.metadata,
    ).toMatchObject({
      pccResponsibility: "remote_proof",
    });
  });

  it("routes Focused Codex only to planning and final verification work", () => {
    const draft = buildPccWorkflowDraft({
      title: "New App",
      templateId: "software-product",
      planningMode: "codex_full_plan",
      aiUsePolicy: "codex_focused",
      codexPlanningAllowed: true,
    });

    expect(
      draft.milestones.find((item) => item.title === "Define scope and success criteria")?.metadata,
    ).toMatchObject({ pccResponsibility: "codex", requiresCodex: true });
    expect(draft.milestones.find((item) => item.title === "Build MVP")?.metadata).toMatchObject({
      pccResponsibility: "local_openclaw_agent",
      requiresCodex: false,
    });
    expect(
      draft.milestones.find((item) => item.title === "Refine and harden")?.metadata,
    ).toMatchObject({ pccResponsibility: "local_openclaw_agent", requiresCodex: false });
    expect(
      draft.milestones.find((item) => item.title === "Production proof")?.metadata,
    ).toMatchObject({ pccResponsibility: "remote_proof" });
  });

  it("routes every eligible AI milestone to Codex without replacing proof gates", () => {
    const draft = buildPccWorkflowDraft({
      title: "New App",
      templateId: "software-product",
      planningMode: "codex_full_plan",
      aiUsePolicy: "codex_everything",
      codexPlanningAllowed: true,
    });

    const eligible = draft.milestones.filter(
      (item) => item.metadata?.pccResponsibility !== "remote_proof",
    );
    expect(eligible.every((item) => item.metadata?.pccResponsibility === "codex")).toBe(true);
    expect(
      draft.milestones.find((item) => item.title === "Production proof")?.metadata,
    ).toMatchObject({
      pccResponsibility: "remote_proof",
    });
    expect(
      draft.subMilestonesByMilestoneTitle["Build MVP"]?.every(
        (item) => item.metadata?.pccResponsibility === "codex",
      ),
    ).toBe(true);
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

  it("treats complete maintenance projects as quality-passing but not runnable", () => {
    const now = "2026-06-30T00:00:00Z";
    const evaluation = evaluatePccProjectSetup({
      project: {
        id: "project-complete",
        title: "Project Command Center",
        goal: "Maintain a completed PCC runtime.",
        status: "complete_with_maintenance",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
      milestones: [],
      subMilestones: [],
    });

    expect(evaluation.status).toBe("passing");
    expect(evaluation.badge).toBe("Passing");
    expect(evaluation.score).toBe(100);
    expect(evaluation.runnable).toBe(false);
    expect(evaluation.missing).toEqual([]);
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

  it("loads generic projects without falling into project-specific workflows", () => {
    const answers = {
      goal: "Build a task automation planner for general user plans.",
      firstDeliverable: "A loaded project with milestones and sub-milestones.",
      doneProof: "Local, remote, runtime, and receipt proof.",
      constraints: "Do not spend tokens or run destructive actions without permission.",
      owner: "local_openclaw_agent",
      blockers: "Missing approval or proof should block work.",
    };

    const recommendation = recommendPccWorkflow({
      title: "Task Automation Planner",
      goal: answers.goal,
      intakeAnswers: answers,
    });
    expect(recommendation.templateId).toBe("software-product");

    const draft = buildPccWorkflowDraft({
      title: "Task Automation Planner",
      goal: answers.goal,
      templateId: recommendation.templateId,
    });
    expect(draft.project.metadata?.pccWorkflowTemplateId).toBe("software-product");
    expect(draft.milestones.length).toBeGreaterThanOrEqual(5);
    for (const milestone of draft.milestones) {
      expect(draft.subMilestonesByMilestoneTitle[milestone.title]?.length).toBeGreaterThan(0);
      expect(milestone.acceptanceCriteria).toBeTruthy();
      expect(milestone.metadata?.pccResponsibility).toBeTruthy();
      expect(milestone.metadata?.pccProofLevel).toBeTruthy();
    }
  });

  it("keeps Phase 2 project setup non-runnable until intake, workflow, structure, and proof fields pass", () => {
    const answers = {
      goal: "Load any project into PCC and create an executable milestone path.",
      firstDeliverable: "A generic project with phases, milestones, and sub-milestones.",
      doneProof: "Local proof, remote proof, runtime proof, and completion receipts.",
      constraints: "No Codex, remote proof, destructive actions, or reboot without permission.",
      owner: "local_openclaw_agent",
      blockers: "Missing intake, missing proof, and missing permissions.",
    };
    const draft = buildPccWorkflowDraft({
      title: "Universal Project Loader",
      goal: answers.goal,
      templateId: "software-product",
    });
    const now = "2026-06-29T00:00:00Z";
    const project = {
      id: "project-phase2",
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
      projectId: project.id,
      createdAt: now,
      updatedAt: now,
    }));
    const subMilestones = milestones.flatMap((milestone) =>
      (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []).map((subMilestone, index) =>
        Object.assign({}, subMilestone, {
          id: `${milestone.id}-sub-${index}`,
          projectId: project.id,
          milestoneId: milestone.id,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );

    const blank = evaluatePccProjectSetup({
      project: {
        ...project,
        metadata: { ...project.metadata, pccIntake: { answers: {}, approved: false } },
      },
      milestones,
      subMilestones,
    });
    expect(blank.status).toBe("missing");
    expect(blank.runnable).toBe(false);
    expect(blank.missing.join("\n")).toContain("Required intake answer missing");

    const noSubMilestones = evaluatePccProjectSetup({ project, milestones, subMilestones: [] });
    expect(noSubMilestones.status).toBe("missing");
    expect(noSubMilestones.score).toBeLessThan(80);
    expect(noSubMilestones.missing.join("\n")).toContain("has no sub-milestones");

    const badWorkflow = evaluatePccProjectSetup({
      project: { ...project, metadata: { ...project.metadata, pccWorkflowTemplateId: "unknown" } },
      milestones,
      subMilestones,
    });
    expect(badWorkflow.status).toBe("violated");
    expect(badWorkflow.badge).toBe("Violated");

    const passing = evaluatePccProjectSetup({ project, milestones, subMilestones });
    expect(passing).toMatchObject({
      status: "passing",
      badge: "Passing",
      runnable: true,
      score: 100,
      selectedWorkflowTemplateId: "software-product",
    });
  });
});

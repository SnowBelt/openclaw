import { describe, expect, it } from "vitest";
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

  it("marks initial plan as needs review when Codex planning is not allowed", () => {
    const draft = buildPccWorkflowDraft({
      title: "New App",
      templateId: "software-product",
      codexPlanningAllowed: false,
    });

    expect(draft.project.metadata?.pccIntakeStatus).toBe("needs_review");
    expect(draft.milestones[0]?.status).toBe("needs_approval");
  });
});

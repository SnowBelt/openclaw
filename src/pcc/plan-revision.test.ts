import { describe, expect, it } from "vitest";
import type { PccMilestone, PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import { buildPccPlanRevisionPreview, pccProjectPlanFingerprint } from "./plan-revision.js";
import type { PccPlanGenerationResult } from "./planning.js";

const project = {
  id: "project-1",
  title: "Project",
  status: "active",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
} satisfies PccProject;

function milestone(id: string, title: string, status: PccMilestone["status"]): PccMilestone {
  return {
    id,
    projectId: project.id,
    title,
    status,
    order: Number(id.slice(-1)),
    implementationPlan: "Old plan",
    acceptanceCriteria: ["Old proof"],
    metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function plan(): PccPlanGenerationResult {
  return {
    schemaVersion: 1,
    title: "Project",
    goal: "Improve the project",
    outcomeMetrics: ["Improvement is verified."],
    workflowTemplateId: "software-product",
    milestones: [
      {
        title: "Active work",
        phaseId: "mvp",
        implementationPlan: "New plan",
        acceptanceCriteria: ["New proof"],
        responsibility: "local_openclaw_agent",
        proofLevel: "local",
        dependencies: [],
        subMilestones: [
          {
            title: "Check work",
            implementationPlan: "Verify it",
            acceptanceCriteria: ["Check passes"],
            responsibility: "local_openclaw_agent",
            proofLevel: "local",
          },
        ],
      },
      {
        title: "Completed work",
        phaseId: "mvp",
        implementationPlan: "Do not overwrite",
        acceptanceCriteria: ["Do not overwrite"],
        responsibility: "codex",
        proofLevel: "remote",
        dependencies: [0],
        subMilestones: [],
      },
      {
        title: "New improvement",
        phaseId: "refinement",
        implementationPlan: "Add it",
        acceptanceCriteria: ["It works"],
        responsibility: "local_openclaw_agent",
        proofLevel: "local",
        dependencies: [0],
        subMilestones: [],
      },
    ],
    risks: [],
    assumptions: [],
    provenance: {
      generatedAt: "2026-07-26T01:00:00.000Z",
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      runtime: "codex",
      effort: "medium",
      auth: "oauth",
      source: "live_codex",
      planningOnly: true,
    },
  };
}

describe("PCC plan revisions", () => {
  it("previews additive changes, protects completed work, and pauses affected active work", () => {
    const preview = buildPccPlanRevisionPreview({
      project,
      milestones: [
        milestone("milestone-1", "Active work", "in_progress"),
        milestone("milestone-2", "Completed work", "complete"),
      ],
      subMilestones: [],
      request: "Add the new improvement and strengthen active work.",
      plan: plan(),
    });

    expect(preview).toMatchObject({
      safeToApply: true,
      addedMilestones: 1,
      updatedMilestones: 1,
      preservedCompletedMilestones: 1,
      mustPauseActiveWork: true,
      rollbackAvailable: true,
      sourceModel: "openai/gpt-5.6-sol",
      sourceEffort: "medium",
    });
    expect(preview.staleProofMilestoneIds).toEqual(["milestone-1"]);
  });

  it("fails closed on cyclic generated dependencies", () => {
    const generated = plan();
    generated.milestones[0].dependencies = [1];
    generated.milestones[1].dependencies = [0];
    const preview = buildPccPlanRevisionPreview({
      project,
      milestones: [],
      subMilestones: [],
      request: "Change the plan.",
      plan: generated,
    });

    expect(preview.safeToApply).toBe(false);
    expect(preview.integrityErrors.join(" ")).toContain("cycle");
  });

  it("detects dependency and sub-milestone changes while protecting completed children", () => {
    const first = milestone("milestone-1", "Foundation", "complete");
    const second = milestone("milestone-2", "Active work", "not_started");
    second.dependsOn = [];
    const generated = plan();
    generated.milestones = [
      {
        ...generated.milestones[0],
        title: "Foundation",
        dependencies: [],
        subMilestones: [],
      },
      {
        ...generated.milestones[0],
        title: "Active work",
        dependencies: [0],
        subMilestones: [
          {
            title: "Protected proof",
            implementationPlan: "A changed plan that must not overwrite completion.",
            acceptanceCriteria: ["Different proof"],
            responsibility: "codex",
            proofLevel: "remote",
          },
          {
            title: "New check",
            implementationPlan: "Add a new check.",
            acceptanceCriteria: ["Check passes"],
            responsibility: "local_openclaw_agent",
            proofLevel: "local",
          },
        ],
      },
    ];
    const preview = buildPccPlanRevisionPreview({
      project,
      milestones: [first, second],
      subMilestones: [
        {
          id: "sub-1",
          projectId: project.id,
          milestoneId: second.id,
          title: "Protected proof",
          status: "complete",
          order: 0,
          implementationPlan: "Original completed plan.",
          acceptanceCriteria: ["Original proof"],
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      ],
      request: "Add a dependency and a new check.",
      plan: generated,
    });

    expect(preview.safeToApply).toBe(true);
    expect(preview.changes.find((change) => change.milestoneId === second.id)?.fields).toEqual(
      expect.arrayContaining(["dependencies", "sub-milestones"]),
    );
    expect(preview.staleProofMilestoneIds).toContain(second.id);
    expect(preview.addedSubMilestones).toBe(1);
  });

  it("invalidates a preview when plan content changes without a timestamp change", () => {
    const original = milestone("milestone-1", "Active work", "not_started");
    const originalFingerprint = pccProjectPlanFingerprint(project, [original], []);
    const changedFingerprint = pccProjectPlanFingerprint(
      project,
      [
        {
          ...original,
          implementationPlan: "A materially different plan with the same updatedAt value.",
        },
      ],
      [],
    );

    expect(changedFingerprint).not.toBe(originalFingerprint);
  });
});

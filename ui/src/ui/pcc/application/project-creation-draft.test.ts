import { describe, expect, it } from "vitest";
import { resolvePccExecutionProfilePreset } from "../../../../../src/pcc/execution-profile.js";
import { EMPTY_PCC_PROJECT_FORM } from "../form-state.ts";
import {
  buildPccProjectCreationDraftPatch,
  inferPccProjectGoal,
  inferPccProjectTitle,
} from "./project-creation-draft.ts";

describe("PCC project creation draft", () => {
  it("turns a complete natural-language request into a real name and outcome", () => {
    const prompt =
      "I want to build a family calendar app that coordinates school, work, and appointments so everyone knows what happens next.";

    expect(inferPccProjectTitle(prompt)).toBe("Family Calendar App");
    expect(inferPccProjectGoal(prompt, "Family Calendar App")).toBe(
      "Build a family calendar app that coordinates school, work, and appointments so everyone knows what happens next.",
    );
  });

  it("never treats a one-character partial prompt as a project name", () => {
    expect(inferPccProjectTitle("I")).toBe("New Project");
  });

  it("repairs one-character title, goal, and intake values left by an older live draft", () => {
    const patch = buildPccProjectCreationDraftPatch({
      ...EMPTY_PCC_PROJECT_FORM,
      title: "I",
      goal: "I",
      outcomeMetrics: "I",
      projectDescription:
        "I want to build a family calendar app that coordinates school, work, and appointments.",
      intakeAnswers: { goal: "I", firstDeliverable: "I", owner: "Todd" },
    });

    expect(patch).toMatchObject({
      title: "Family Calendar App",
      goal: "Build a family calendar app that coordinates school, work, and appointments.",
      outcomeMetrics: expect.stringContaining("Goal achieved:"),
      intakeAnswers: expect.objectContaining({
        goal: "Build a family calendar app that coordinates school, work, and appointments.",
        firstDeliverable: expect.stringContaining("Family Calendar App"),
        owner: "Todd",
      }),
    });
  });

  it("preserves user fields while filling every required blank from the finished prompt", () => {
    const patch = buildPccProjectCreationDraftPatch({
      ...EMPTY_PCC_PROJECT_FORM,
      title: "Family Hub",
      projectDescription:
        "I want to build a family calendar app that coordinates school, work, and appointments.",
      intakeAnswers: { owner: "Todd" },
    });

    expect(patch).toMatchObject({
      title: "Family Hub",
      goal: "Build a family calendar app that coordinates school, work, and appointments.",
      outcomeMetrics: expect.stringContaining("Goal achieved:"),
      intakeAnswers: expect.objectContaining({
        owner: "Todd",
        goal: "Build a family calendar app that coordinates school, work, and appointments.",
        firstDeliverable: expect.stringContaining("Family Hub"),
      }),
    });
  });

  it("describes the local coordinator and scoped Codex expert without inventing parallel Codex", () => {
    const patch = buildPccProjectCreationDraftPatch({
      ...EMPTY_PCC_PROJECT_FORM,
      projectDescription: "Create a reliable inventory dashboard for a small business.",
      executionProfile: resolvePccExecutionProfilePreset("ultra_expert"),
    });

    expect(patch.intakeAnswers).toMatchObject({
      owner: "OpenClaw coordinator with the approved Codex specialist role",
      constraints: expect.stringContaining("selected role"),
    });
  });

  it("chooses a matching workflow when the user has not selected one and preserves a manual choice", () => {
    const automatic = buildPccProjectCreationDraftPatch({
      ...EMPTY_PCC_PROJECT_FORM,
      projectDescription: "Create a short documentary video with narration and thumbnails.",
    });
    const manual = buildPccProjectCreationDraftPatch({
      ...EMPTY_PCC_PROJECT_FORM,
      projectDescription: "Create a short documentary video with narration and thumbnails.",
      workflowTemplateId: "custom",
    });

    expect(automatic.workflowTemplateId).toBe("creative-media");
    expect(manual.workflowTemplateId).toBe("custom");
  });
});

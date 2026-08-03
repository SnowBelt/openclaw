import { describe, expect, it } from "vitest";
import {
  assertPccPlanningAuthorized,
  buildPccPlanningPrompt,
  CODEX_PCC_PLANNING_POLICY,
  DEFAULT_PCC_PLANNING_POLICY,
  parsePccPlanGenerationResult,
  PCC_LOCAL_PLANNER_MODEL,
  resolvePccPlanningPolicy,
  resolvePccPlanningEffort,
} from "./planning.js";

const planJson = JSON.stringify({
  title: "Reliable Project Planner",
  goal: "Create and verify a reliable project planning workflow.",
  outcomeMetrics: ["A generated plan is saved with proof metadata."],
  workflowTemplateId: "software-product",
  milestones: [
    {
      title: "Define the contract",
      phaseId: "setup",
      implementationPlan: "Define the exact input, output, and safety contract.",
      acceptanceCriteria: ["The contract has executable acceptance criteria."],
      responsibility: "codex",
      proofLevel: "local",
      dependencies: [],
      subMilestones: [
        {
          title: "Write acceptance criteria",
          implementationPlan: "Translate the goal into observable checks.",
          acceptanceCriteria: ["Every required outcome has a check."],
          responsibility: "local_openclaw_agent",
          proofLevel: "local",
        },
      ],
    },
  ],
  risks: ["OAuth may require reauthentication."],
  assumptions: ["The Codex runtime is installed."],
});

describe("PCC planning policy", () => {
  it("defaults initial planning to local AI and requires an explicit Codex selection", () => {
    expect(DEFAULT_PCC_PLANNING_POLICY).toMatchObject({
      provider: "ollama",
      model: PCC_LOCAL_PLANNER_MODEL,
      runtime: "openclaw",
    });
    expect(resolvePccPlanningPolicy(CODEX_PCC_PLANNING_POLICY)).toMatchObject({
      provider: "ollama",
      model: PCC_LOCAL_PLANNER_MODEL,
      runtime: "openclaw",
    });
    expect(resolvePccPlanningPolicy(CODEX_PCC_PLANNING_POLICY, "codex")).toMatchObject({
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      runtime: "codex",
    });
  });

  it("uses medium for ordinary plans and high for architecture or migration work", () => {
    expect(
      resolvePccPlanningEffort({ surface: "project_creation", description: "Build a todo list" }),
    ).toBe("medium");
    expect(
      resolvePccPlanningEffort({
        surface: "project_creation",
        description: "Design a production migration architecture with concurrency and OAuth",
      }),
    ).toBe("high");
  });

  it("keeps local planning available while Codex remains grant-gated", () => {
    expect(() =>
      assertPccPlanningAuthorized({
        surface: "project_creation",
        description: "Build a useful dashboard",
      }),
    ).not.toThrow();
    expect(() =>
      assertPccPlanningAuthorized(
        { surface: "project_creation", description: "Build a useful dashboard" },
        {
          ...DEFAULT_PCC_PLANNING_POLICY,
          grant: { ...DEFAULT_PCC_PLANNING_POLICY.grant, enabled: false },
        },
      ),
    ).not.toThrow();
    expect(() =>
      assertPccPlanningAuthorized(
        { surface: "project_creation", description: "Build a useful dashboard" },
        {
          ...CODEX_PCC_PLANNING_POLICY,
          grant: { ...CODEX_PCC_PLANNING_POLICY.grant, enabled: false },
        },
      ),
    ).toThrow("Codex planning is disabled");
  });

  it("builds a planning-only prompt and parses live provenance", () => {
    const prompt = buildPccPlanningPrompt({
      surface: "project_creation",
      description: "Create a reliable project planner",
    });
    expect(prompt).toContain("Planning only");
    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("Do not assign codex or high_reasoning_codex");
    expect(prompt).toContain("separate visible Codex checkpoints");
    const result = parsePccPlanGenerationResult({
      text: `result\n${planJson}`,
      effort: "high",
      generatedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(result.title).toBe("Reliable Project Planner");
    expect(result.provenance).toMatchObject({
      model: "openai/gpt-5.6-sol",
      runtime: "codex",
      effort: "high",
      auth: "oauth",
      source: "live_codex",
    });
  });

  it("rejects malformed and forward-dependent plans", () => {
    expect(() => parsePccPlanGenerationResult({ text: "not json", effort: "medium" })).toThrow(
      "did not return",
    );
    const invalid = JSON.parse(planJson) as Record<string, unknown>;
    const milestones = invalid.milestones as Array<Record<string, unknown>>;
    milestones[0]!.dependencies = [0];
    expect(() =>
      parsePccPlanGenerationResult({ text: JSON.stringify(invalid), effort: "medium" }),
    ).toThrow("earlier milestones");
  });

  it("rejects placeholder project names and non-canonical routing metadata", () => {
    const placeholder = JSON.parse(planJson) as Record<string, unknown>;
    placeholder.title = "I";
    expect(() =>
      parsePccPlanGenerationResult({ text: JSON.stringify(placeholder), effort: "medium" }),
    ).toThrow("placeholder");

    const invalidRoute = JSON.parse(planJson) as Record<string, unknown>;
    const milestones = invalidRoute.milestones as Array<Record<string, unknown>>;
    milestones[0]!.responsibility = "whatever-model-is-free";
    expect(() =>
      parsePccPlanGenerationResult({ text: JSON.stringify(invalidRoute), effort: "medium" }),
    ).toThrow("unsupported milestone responsibility");
  });
});

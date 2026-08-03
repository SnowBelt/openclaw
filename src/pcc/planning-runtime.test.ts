import { describe, expect, it, vi } from "vitest";
import { generatePccPlan, generatePccPlanWithCodex } from "./planning-runtime.js";

const response = JSON.stringify({
  title: "Fast Reliable Launch",
  goal: "Launch a verified project workflow.",
  outcomeMetrics: ["All acceptance checks pass."],
  workflowTemplateId: "software-product",
  milestones: [
    {
      title: "Plan",
      phaseId: "setup",
      implementationPlan: "Create an executable plan.",
      acceptanceCriteria: ["Plan is approved."],
      responsibility: "codex",
      proofLevel: "local",
      dependencies: [],
      subMilestones: [
        {
          title: "Define done",
          implementationPlan: "Write pass conditions.",
          acceptanceCriteria: ["Pass conditions are observable."],
          responsibility: "local_openclaw_agent",
          proofLevel: "local",
        },
      ],
    },
  ],
  risks: [],
  assumptions: [],
});

describe("PCC Codex planning runtime", () => {
  it("uses the native Codex runtime without tools and records exact provenance", async () => {
    const runAgent = vi.fn(async () => ({
      payloads: [{ text: response }],
      meta: {
        agentMeta: {
          usage: { input: 1_000, output: 250, cacheRead: 100, total: 1_350 },
        },
      },
    }));
    const onUsage = vi.fn();
    const result = await generatePccPlanWithCodex({
      cfg: { agents: { defaults: { workspace: process.cwd() } } },
      request: {
        surface: "project_creation",
        description: "Design a production release architecture",
      },
      runAgent: runAgent as never,
      onUsage,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5.6-sol",
        agentHarnessRuntimeOverride: "codex",
        disableTools: true,
        thinkLevel: "high",
      }),
    );
    expect(result.provenance).toMatchObject({
      generatedAt: "2026-07-22T12:00:00.000Z",
      model: "openai/gpt-5.6-sol",
      effort: "high",
      source: "live_codex",
    });
    expect(onUsage).toHaveBeenCalledWith({
      input: 1_000,
      output: 250,
      cacheRead: 100,
      cacheWrite: undefined,
      totalTokens: 1_350,
    });
  });

  it("uses the local planner by default and records local provenance", async () => {
    const runAgent = vi.fn(async () => ({
      payloads: [{ text: response }],
      meta: { agentMeta: { usage: { input: 8, output: 13, total: 21 } } },
    }));
    const result = await generatePccPlan({
      cfg: { agents: { defaults: { workspace: process.cwd() } } },
      request: { surface: "project_creation", description: "Build a local planner" },
      runAgent: runAgent as never,
    });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "ollama",
        model: "qwen3.5:4b",
        agentHarnessRuntimeOverride: "openclaw",
        disableTools: true,
      }),
    );
    expect(result.provenance).toMatchObject({
      provider: "ollama",
      model: "ollama/qwen3.5:4b",
      runtime: "openclaw",
      auth: "none",
      source: "live_local",
    });
  });

  it("fails closed with an actionable OAuth message", async () => {
    await expect(
      generatePccPlanWithCodex({
        cfg: { agents: { defaults: { workspace: process.cwd() } } },
        request: { surface: "project_creation", description: "Build a planner" },
        runAgent: vi.fn(async () => {
          throw new Error("401 unauthorized");
        }) as never,
      }),
    ).rejects.toThrow("openclaw models auth login --provider openai");
  });
});

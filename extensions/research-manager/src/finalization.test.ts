import { describe, expect, it, vi } from "vitest";
import { createSolOnlyConfig } from "./acceptance.js";
import { resolveResearchManagerConfig } from "./config.js";
import { finalizeResearch } from "./finalization.js";
import type {
  StructuredModelRunner,
  StructuredModelRunOptions,
  StructuredModelRunResult,
} from "./model-runner.js";
import type { ResearchClaim, ResearchPlan, ResearchSource } from "./types.js";

const plan: ResearchPlan = {
  objective: "Test",
  questions: [{ id: "Q1", question: "What happened?", priority: "required" }],
  queries: [
    { query: "authoritative source", questionIds: ["Q1"], preferredSourceTypes: ["primary"] },
  ],
  sourceRequirements: ["primary"],
  riskLevel: "normal",
  stopConditions: ["supported"],
};

function runner() {
  const runJson = vi.fn(
    async (
      _options: StructuredModelRunOptions,
    ): Promise<
      StructuredModelRunResult<{ answer: string; usedClaimIds: string[]; limitations: string[] }>
    > => ({
      value: { answer: "Supported fact [S1].", usedClaimIds: ["C1"], limitations: [] },
      model: resolveResearchManagerConfig().models[0],
      attempts: [],
    }),
  );
  return {
    runJson,
  };
}

describe("finalizeResearch effort policy", () => {
  it("uses xhigh for the hybrid finalizer", async () => {
    const modelRunner = runner();
    await finalizeResearch({
      runner: modelRunner as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      query: "Test",
      plan,
      claims: [],
      sources: [],
    });
    expect(modelRunner.runJson).toHaveBeenCalledWith(
      expect.objectContaining({ thinking: "xhigh" }),
    );
  });

  it("uses the provider maximum for the locked Sol-only comparator", async () => {
    const modelRunner = runner();
    await finalizeResearch({
      runner: modelRunner as unknown as StructuredModelRunner,
      config: createSolOnlyConfig(resolveResearchManagerConfig()),
      mode: "certified",
      query: "Test",
      plan,
      claims: [],
      sources: [],
    });
    expect(modelRunner.runJson).toHaveBeenCalledWith(expect.objectContaining({ thinking: "max" }));
  });

  it("requires available source coverage and preserves material qualifiers", async () => {
    const modelRunner = runner();
    const evidence = ["S1", "S2"].map((sourceId) => ({
      sourceId,
      quote: "Under the default isolation policy, the reader sees committed data.",
      supports: true,
    }));
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: "Under the default isolation policy, the reader sees committed data.",
      sourceIds: ["S1", "S2"],
      evidence,
      confidence: 1,
      material: true,
      status: "verified",
    };
    const sources = ["S1", "S2"].map(
      (id, index): ResearchSource => ({
        id,
        query: "authoritative source",
        url: `https://example.com/${index}`,
        domain: "example.com",
        title: id,
        snippet: evidence[0].quote,
        retrievedAt: new Date().toISOString(),
        searchProvider: "test",
        sourceType: "primary",
        fetchStatus: "fetched",
      }),
    );
    await finalizeResearch({
      runner: modelRunner as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ certification: { minSources: 2 } }),
      mode: "certified",
      query: "Test",
      plan,
      claims: [claim],
      sources,
    });
    const prompt = modelRunner.runJson.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("at least 2 distinct independently supporting source IDs");
    expect(prompt).toContain("Preserve every material qualifier");
    expect(prompt).toContain("Never shorten a qualified claim into a broader assertion");
  });
});

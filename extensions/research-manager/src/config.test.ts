import { describe, expect, it } from "vitest";
import { DEFAULT_RESEARCH_MANAGER_CONFIG, resolveResearchManagerConfig } from "./config.js";

describe("resolveResearchManagerConfig", () => {
  it("uses the certified 150 GB safety envelope by default", () => {
    const config = resolveResearchManagerConfig(undefined);
    expect(config.defaultMode).toBe("certified");
    expect(config.certificationThreshold).toBe(93);
    expect(config.resourceLimits).toMatchObject({
      softMemoryGb: 130,
      hardMemoryGb: 145,
      absoluteMemoryGb: 150,
      maxLocalParallel: 1,
      maxLogicalWorkers: 5,
    });
    expect(config.models.filter((model) => model.remote)).toSatisfy(
      (models: typeof config.models) =>
        models.every((model) => model.authProfileId === "openai-codex:default"),
    );
    expect(config.models.find((model) => model.id === "gpt-5.5-fallback")?.thinking).toBe("high");
    expect(config.retrieval.queryCount).toBe(24);
  });

  it("orders invalid memory caps without exceeding the configured absolute cap", () => {
    const config = resolveResearchManagerConfig({
      resourceLimits: { softMemoryGb: 140, hardMemoryGb: 120, absoluteMemoryGb: 130 },
    });
    expect(config.resourceLimits).toMatchObject({
      softMemoryGb: 120,
      hardMemoryGb: 120,
      absoluteMemoryGb: 130,
    });
  });

  it("clones model roles so callers cannot mutate defaults", () => {
    const first = resolveResearchManagerConfig(undefined);
    first.models[0]?.roles.push("critic");
    const second = resolveResearchManagerConfig(undefined);
    expect(second.models[0]?.roles).toEqual(["planner", "finalizer"]);
    expect(DEFAULT_RESEARCH_MANAGER_CONFIG.models[0]?.roles).toEqual(["planner", "finalizer"]);
  });

  it("caps retrieval and repair fanout", () => {
    const config = resolveResearchManagerConfig({
      retrieval: { queryCount: 100, resultsPerQuery: 100, maxSources: 1000, fetchConcurrency: 40 },
      certification: { maxRepairPasses: 100 },
    });
    expect(config.retrieval).toMatchObject({
      queryCount: 24,
      resultsPerQuery: 20,
      maxSources: 100,
      fetchConcurrency: 12,
    });
    expect(config.certification.maxRepairPasses).toBe(5);
  });

  it("keeps logical workers within the three-to-five role contract", () => {
    expect(
      resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 1 } }).resourceLimits
        .maxLogicalWorkers,
    ).toBe(3);
    expect(
      resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 99 } }).resourceLimits
        .maxLogicalWorkers,
    ).toBe(5);
  });
});

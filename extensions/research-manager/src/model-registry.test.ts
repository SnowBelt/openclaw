import { describe, expect, it } from "vitest";
import { resolveResearchManagerConfig } from "./config.js";
import { ModelCapabilityRegistry } from "./model-registry.js";
import type { OllamaInventory } from "./ollama.js";
import type { ResearchModelSpec } from "./types.js";

const sol: ResearchModelSpec = {
  id: "sol",
  provider: "codex",
  model: "gpt-5.6-sol",
  roles: ["planner", "finalizer"],
  remote: true,
  memoryGb: 0,
  contextTokens: 1_000_000,
  maxParallel: 1,
  thinking: "high",
  qualificationScore: 100,
  enabled: true,
  exclusive: false,
};

const local: ResearchModelSpec = {
  id: "local",
  provider: "ollama",
  model: "qwen3.6:27b-q8_0",
  roles: ["planner", "researcher"],
  remote: false,
  memoryGb: 31,
  contextTokens: 64_000,
  maxParallel: 2,
  thinking: "medium",
  qualificationScore: 0,
  enabled: true,
  exclusive: false,
};

function inventory(): OllamaInventory {
  return {
    baseUrl: "http://127.0.0.1:11434",
    reachable: true,
    checkedAt: new Date().toISOString(),
    totalLoadedBytes: 0,
    models: [
      {
        name: "qwen3.6:27b-q8_0",
        model: "qwen3.6:27b-q8_0",
        sizeBytes: 29 * 1024 ** 3,
        loaded: false,
      },
    ],
  };
}

describe("ModelCapabilityRegistry", () => {
  it("uses Sol first for frontier roles", () => {
    const registry = new ModelCapabilityRegistry(
      resolveResearchManagerConfig({ models: [local, sol] }),
    );
    registry.updateOllamaInventory(inventory());
    expect(registry.candidates({ role: "planner", mode: "certified" })[0]?.model.id).toBe("sol");
  });

  it("keeps unqualified local models out of certified chains but allows best effort", () => {
    const registry = new ModelCapabilityRegistry(resolveResearchManagerConfig({ models: [local] }));
    registry.updateOllamaInventory(inventory());
    expect(registry.candidates({ role: "researcher", mode: "certified" })).toHaveLength(0);
    expect(registry.candidates({ role: "researcher", mode: "best-effort" })).toHaveLength(1);
    registry.recordQualification("local", "researcher", 90);
    expect(registry.candidates({ role: "researcher", mode: "certified" })).toHaveLength(1);
  });

  it("reports missing installed aliases instead of fuzzy-matching a different model", () => {
    const registry = new ModelCapabilityRegistry(
      resolveResearchManagerConfig({ models: [{ ...local, model: "qwen3.6:missing" }] }),
    );
    registry.updateOllamaInventory(inventory());
    const status = registry.snapshot()[0];
    expect(status?.installed).toBe(false);
    expect(status?.reasons.join(" ")).toMatch(/not installed/i);
  });
});

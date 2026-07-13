import { describe, expect, it } from "vitest";
import {
  PCC_BEST_AVAILABLE_MODEL_ID,
  derivePccAiUsePolicy,
  normalizePccExecutionProfile,
  pccCodexEffortIsSupported,
  resolvePccEstimatedAgentCounts,
  resolvePccExecutionProfilePreset,
  validatePccModelSelection,
} from "./execution-profile.js";

describe("PCC canonical execution profile", () => {
  it("keeps Ultra local-only and performs no Codex routing", () => {
    const profile = resolvePccExecutionProfilePreset("ultra_local");

    expect(profile.schemaVersion).toBe(1);
    expect(profile.codexRole).toBe("off");
    expect(derivePccAiUsePolicy(profile)).toBe("local_only");
    expect(resolvePccEstimatedAgentCounts(profile, 20)).toEqual({
      availableCapacity: 20,
      localAgents: 12,
      codexAgents: 0,
      totalAgents: 12,
    });
  });

  it("models Ultra hybrid as local execution with one Codex lead", () => {
    const profile = resolvePccExecutionProfilePreset("ultra_hybrid");

    expect(profile.speed).toBe("ultra");
    expect(profile.codexRole).toBe("lead");
    expect(profile.codexEffort).toBe("max");
    expect(derivePccAiUsePolicy(profile)).toBe("codex_everything");
    expect(resolvePccEstimatedAgentCounts(profile, 12)).toEqual({
      availableCapacity: 12,
      localAgents: 12,
      codexAgents: 1,
      totalAgents: 13,
    });
  });

  it("migrates the old Ultra reasoning label to Maximum without changing the team preset", () => {
    const profile = normalizePccExecutionProfile({
      pccExecutionProfile: {
        presetId: "ultra_hybrid",
        speed: "ultra",
        codexRole: "lead",
        capacityPolicy: "maximum_safe",
        localModelId: "best_available",
        codexModelId: "best_available",
        codexEffort: "ultra",
        approvalScope: "ask",
      },
    });

    expect(profile).toMatchObject({
      presetId: "ultra_hybrid",
      speed: "ultra",
      codexEffort: "max",
    });
  });

  it("treats a canonical profile as authoritative over conflicting legacy metadata", () => {
    const profile = normalizePccExecutionProfile({
      pccExecutionProfile: {
        schemaVersion: 999,
        presetId: "local_parallel",
        speed: "focused",
        codexRole: "off",
        capacityPolicy: "automatic",
        localModelId: "local/model",
        codexModelId: "codex/model",
        codexEffort: "high",
        approvalScope: "plan",
      },
      pccAiUsePolicy: "codex_everything",
      pccAiRouting: "ultra_hybrid",
      pccPlannerMode: "codex_full_plan",
    });

    expect(profile).toMatchObject({
      schemaVersion: 1,
      presetId: "local_parallel",
      speed: "focused",
      codexRole: "off",
      localModelId: "local/model",
    });
  });

  it("migrates legacy policy and planner model fields once when no canonical profile exists", () => {
    const profile = normalizePccExecutionProfile({
      pccAiUsePolicy: "codex_expert",
      pccPlannerModel: "openai-codex/gpt-5.5",
      pccPlannerCodexRole: "hard_work",
    });

    expect(profile).toMatchObject({
      presetId: "balanced",
      codexRole: "hard_work",
      codexModelId: "openai-codex/gpt-5.5",
    });
  });

  it("migrates the existing nested routing object without merging conflicting keys", () => {
    const profile = normalizePccExecutionProfile({
      pccAiRouting: {
        policy: "codex_focused",
        plannerMode: "codex",
        localModelId: "ollama:qwen",
        codexReasoning: "high",
        permissionScope: "ask",
      },
    });

    expect(profile).toMatchObject({
      presetId: "balanced",
      localModelId: "ollama:qwen",
      codexEffort: "high",
      approvalScope: "ask",
    });
  });

  it("reports unavailable models without silently selecting a different model", () => {
    expect(validatePccModelSelection("local/missing", ["local/present"])).toEqual({
      status: "unavailable",
      modelId: "local/missing",
    });
    expect(validatePccModelSelection(PCC_BEST_AVAILABLE_MODEL_ID, [])).toEqual({
      status: "best_available",
      modelId: PCC_BEST_AVAILABLE_MODEL_ID,
    });
  });

  it("caps estimates by speed and actual available capacity", () => {
    const parallel = resolvePccExecutionProfilePreset("local_parallel");
    const hybrid = resolvePccExecutionProfilePreset("ultra_hybrid");

    expect(resolvePccEstimatedAgentCounts(parallel, 2)).toMatchObject({
      localAgents: 2,
      codexAgents: 0,
      totalAgents: 2,
    });
    expect(resolvePccEstimatedAgentCounts(hybrid, 1)).toMatchObject({
      localAgents: 1,
      codexAgents: 1,
      totalAgents: 2,
    });
  });

  it("reserves Maximum Codex depth for GPT-5.6 without changing lower-depth catalog policy", () => {
    expect(pccCodexEffortIsSupported("openai/gpt-5.6-sol", "max")).toBe(true);
    expect(pccCodexEffortIsSupported("codex:gpt-5.6-terra", "max")).toBe(true);
    expect(pccCodexEffortIsSupported("openai/gpt-5.5", "max")).toBe(false);
    expect(pccCodexEffortIsSupported("openai/custom-model", "high")).toBe(true);
  });
});

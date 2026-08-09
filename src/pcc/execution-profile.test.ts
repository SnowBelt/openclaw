import { describe, expect, it } from "vitest";
import {
  PCC_BEST_AVAILABLE_MODEL_ID,
  DEFAULT_PCC_EXECUTION_PROFILE,
  applyPccCodexPolicy,
  applyPccLocalExecutionPreset,
  derivePccAiUsePolicy,
  normalizePccExecutionProfile,
  pccCodexEffortIsSupported,
  resolvePccCodexCheckpoint,
  resolvePccEstimatedAgentCounts,
  resolvePccExecutionProfilePreset,
  validatePccModelSelection,
} from "./execution-profile.js";

describe("PCC canonical execution profile", () => {
  it("defaults new projects to local-only execution", () => {
    expect(DEFAULT_PCC_EXECUTION_PROFILE).toMatchObject({
      presetId: "local_parallel",
      speed: "parallel",
      codexRole: "off",
      codexPolicyId: "local_only",
    });
    expect(derivePccAiUsePolicy(DEFAULT_PCC_EXECUTION_PROFILE)).toBe("local_only");
  });

  it("preserves an explicitly selected Codex policy", () => {
    const explicit = applyPccCodexPolicy(DEFAULT_PCC_EXECUTION_PROFILE, "recommended_minimum");

    expect(explicit).toMatchObject({
      codexRole: "checkpoints",
      codexPolicyId: "recommended_minimum",
    });
  });

  it("keeps Ultra local-only and performs no Codex routing", () => {
    const profile = resolvePccExecutionProfilePreset("ultra_local");

    expect(profile.schemaVersion).toBe(2);
    expect(profile.codexRole).toBe("off");
    expect(derivePccAiUsePolicy(profile)).toBe("local_only");
    expect(resolvePccEstimatedAgentCounts(profile, 20)).toEqual({
      availableCapacity: 20,
      localAgents: 20,
      codexAgents: 0,
      totalAgents: 20,
    });
  });

  it("migrates the legacy Ultra hybrid preset into explicit Codex oversight", () => {
    const profile = resolvePccExecutionProfilePreset("ultra_hybrid");

    expect(profile.speed).toBe("ultra");
    expect(profile.codexRole).toBe("lead");
    expect(profile.codexEffort).toBe("max");
    expect(profile.codexPolicyId).toBe("more_oversight");
    expect(derivePccAiUsePolicy(profile)).toBe("codex_expert");
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
      schemaVersion: 2,
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

  it("caps estimates by actual available capacity without a hidden parallel-worker ceiling", () => {
    const parallel = resolvePccExecutionProfilePreset("local_parallel");
    const hybrid = resolvePccExecutionProfilePreset("ultra_hybrid");

    expect(resolvePccEstimatedAgentCounts(parallel, 2)).toMatchObject({
      localAgents: 2,
      codexAgents: 0,
      totalAgents: 2,
    });
    expect(resolvePccEstimatedAgentCounts(parallel, 20)).toMatchObject({
      localAgents: 20,
      codexAgents: 0,
      totalAgents: 20,
    });
    expect(resolvePccEstimatedAgentCounts(hybrid, 1)).toMatchObject({
      localAgents: 1,
      codexAgents: 1,
      totalAgents: 2,
    });
  });

  it("changes local speed without changing Codex checkpoints", () => {
    const recommended = applyPccCodexPolicy(
      resolvePccExecutionProfilePreset("local_parallel"),
      "recommended_minimum",
    );
    const maximumSafe = applyPccLocalExecutionPreset(recommended, "ultra");

    expect(maximumSafe).toMatchObject({
      speed: "ultra",
      capacityPolicy: "maximum_safe",
      codexPolicyId: "recommended_minimum",
      codexRole: "checkpoints",
    });
    expect(maximumSafe.codexCheckpoints).toEqual(recommended.codexCheckpoints);
  });

  it("uses the recommended minimum only at explicit or deterministic checkpoints", () => {
    const profile = applyPccCodexPolicy(
      resolvePccExecutionProfilePreset("local_parallel"),
      "recommended_minimum",
    );

    expect(profile.codexCheckpoints).not.toHaveProperty("initial_plan");
    expect(profile.codexCheckpoints.material_replan).toBe("codex");
    expect(
      resolvePccCodexCheckpoint({
        profile,
        checkpoint: "blocked_recovery",
        localAttemptCount: 1,
      }),
    ).toMatchObject({
      executor: "local_ai",
      trigger: "automatic_local",
      requiresApproval: false,
    });
    expect(
      resolvePccCodexCheckpoint({
        profile,
        checkpoint: "blocked_recovery",
        localAttemptCount: 2,
      }),
    ).toMatchObject({
      executor: "codex",
      trigger: "repeated_local_failure",
      requiresApproval: true,
    });
  });

  it("keeps custom all-local checkpoints local without a conflicting legacy role", () => {
    const profile = normalizePccExecutionProfile({
      pccExecutionProfile: {
        ...resolvePccExecutionProfilePreset("balanced"),
        codexPolicyId: "custom",
        codexCheckpoints: {
          material_replan: "local",
          architecture_review: "local",
          blocked_recovery: "local",
          final_review: "local",
        },
      },
    });

    expect(profile.codexPolicyId).toBe("custom");
    expect(profile.codexRole).toBe("off");
    expect(derivePccAiUsePolicy(profile)).toBe("local_only");
    expect(resolvePccCodexCheckpoint({ profile, checkpoint: "final_review" })).toMatchObject({
      executor: "local_ai",
      trigger: "explicit_local",
    });
  });

  it("requires approval for the resolved Codex effort rather than accepting a weaker grant", () => {
    const profile = {
      ...applyPccCodexPolicy(
        resolvePccExecutionProfilePreset("local_parallel"),
        "recommended_minimum",
      ),
      codexMaxEffort: "high" as const,
    };

    expect(
      resolvePccCodexCheckpoint({
        profile,
        checkpoint: "architecture_review",
        highImpact: true,
        codexApproved: true,
        approvedMaxEffort: "medium",
      }),
    ).toMatchObject({
      executor: "codex",
      effort: "high",
      requiresApproval: true,
    });
    expect(
      resolvePccCodexCheckpoint({
        profile,
        checkpoint: "architecture_review",
        highImpact: true,
        codexApproved: true,
        approvedMaxEffort: "high",
      }),
    ).toMatchObject({
      executor: "codex",
      effort: "high",
      requiresApproval: false,
    });
  });

  it("reserves Maximum Codex depth for GPT-5.6 without changing lower-depth catalog policy", () => {
    expect(pccCodexEffortIsSupported("openai/gpt-5.6-sol", "max")).toBe(true);
    expect(pccCodexEffortIsSupported("codex:gpt-5.6-terra", "max")).toBe(true);
    expect(pccCodexEffortIsSupported("openai/gpt-5.5", "max")).toBe(false);
    expect(pccCodexEffortIsSupported("openai/custom-model", "high")).toBe(true);
  });
});

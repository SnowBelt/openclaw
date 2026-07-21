import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolvePccExecutionProfilePreset } from "../pcc/execution-profile.js";
import { compileControlDirectorExecutionProfile } from "./control-director-execution-profile.js";
import { CONTROL_DIRECTOR_DEFAULT_MODEL } from "./control-director-role.js";

describe("Control Director execution profile", () => {
  it("uses local Gemma by default and carries the same governed Codex policy everywhere", () => {
    const profile = compileControlDirectorExecutionProfile({
      config: {
        agents: { list: [{ id: "director", role: "control_director" }] },
      } as OpenClawConfig,
      agentId: "director",
      pccProfile: resolvePccExecutionProfilePreset("balanced"),
    });
    expect(profile).toMatchObject({
      schemaVersion: 1,
      localModel: CONTROL_DIRECTOR_DEFAULT_MODEL,
      localSelectionReady: true,
      qualityMinimum: 93,
      codex: {
        role: "checkpoints",
        modelId: "openai/gpt-5.6-sol",
        effort: "high",
        approvalScope: "project",
      },
      resourcePolicy: {
        maxConcurrentLocalRuns: 1,
        modelMemoryEstimateGb: 36,
        gatewayMemoryReserveGb: 8,
      },
    });
  });
});

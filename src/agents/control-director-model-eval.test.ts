import { describe, expect, test } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { evaluateControlDirectorModelCandidate } from "./control-director-model-eval.js";

function evalModel(params: {
  raw: string;
  cfg?: OpenClawConfig;
  catalog?: Array<{ provider: string; id: string; name: string; contextTokens?: number }>;
}) {
  return evaluateControlDirectorModelCandidate({
    cfg: params.cfg ?? ({} as OpenClawConfig),
    catalog: params.catalog ?? [],
    raw: params.raw,
    defaultProvider: "openai",
    defaultModel: "gpt-5.5",
  });
}

describe("Control Director model eval", () => {
  test("qualifies the canonical Gemma default for selectable Control Director use", () => {
    const result = evalModel({ raw: "ollama/openclaw-control-gemma4-31b-q8:latest" });

    expect(result).toMatchObject({
      passed: true,
      eligibleForControlDirector: true,
      provider: "ollama",
      resolvedModel: "openclaw-control-gemma4-31b-q8:latest",
      score: 100,
      failedCases: [],
    });
    expect(result.cases.map((entry) => entry.id)).toEqual([
      "model_preflight",
      "instruction_following",
      "no_false_complete",
      "unverifiable_public_link_blocks",
      "continue_preserves_original_request",
      "provider_schema_failure_blocks",
      "no_liveness_placeholder",
    ]);
  });

  test("rejects unsafe bare model refs instead of letting them become Control Director choices", () => {
    const result = evalModel({ raw: "openclaw-control-typo" });

    expect(result.passed).toBe(false);
    expect(result.eligibleForControlDirector).toBe(false);
    expect(result.failedCases).toContain("model_preflight");
    expect(result.recommendation).toContain("Do not use");
  });

  test("fails small-context candidates even when provider-qualified and cataloged", () => {
    const result = evalModel({
      raw: "ollama/tiny:latest",
      catalog: [{ provider: "ollama", id: "tiny:latest", name: "Tiny", contextTokens: 4096 }],
    });

    expect(result.passed).toBe(false);
    expect(result.eligibleForControlDirector).toBe(false);
    expect(result.failedCases).toContain("instruction_following");
    expect(result.cases.find((entry) => entry.id === "model_preflight")?.passed).toBe(true);
  });
});

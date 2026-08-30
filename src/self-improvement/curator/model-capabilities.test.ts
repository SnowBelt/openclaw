import { describe, expect, it } from "vitest";
import { evaluateCuratorModelCapabilities } from "./model-capabilities.js";

describe("curator model capability contract", () => {
  it("accepts any model reference that satisfies the model-neutral runtime contract", () => {
    expect(
      evaluateCuratorModelCapabilities({
        modelRef: "provider/replacement-model",
        supportsTextCompletion: true,
        acceptsStructuredJson: true,
        contextTokens: 16_384,
        requiredContextTokens: 3_000,
        maxOutputTokens: 2_048,
      }),
    ).toMatchObject({ ok: true, modelRef: "provider/replacement-model", issues: [] });
  });

  it("reports missing capabilities without relying on a model allowlist", () => {
    const result = evaluateCuratorModelCapabilities({
      modelRef: "another-provider/another-model",
      supportsTextCompletion: false,
      acceptsStructuredJson: false,
      contextTokens: 1_000,
      requiredContextTokens: 3_000,
      maxOutputTokens: 1_024,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "model must support bounded text completion",
        "model/provider must return a structured JSON recommendation",
        "model context is smaller than the bounded curator review packet",
        "model output budget must be at least 2048 tokens",
      ]),
    );
  });

  it("fails closed when model identity or context requirements are invalid", () => {
    const result = evaluateCuratorModelCapabilities({
      modelRef: " ",
      supportsTextCompletion: true,
      acceptsStructuredJson: true,
      contextTokens: 16_384,
      requiredContextTokens: Number.NaN,
      maxOutputTokens: 2_048,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "model reference is required",
        "required curator context budget must be a non-negative finite number",
      ]),
    );
  });
});

import { describe, expect, test } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveControlDirectorModelSelectionPreflight } from "./control-director-model-selection.js";

const GEMMA = "ollama/openclaw-control-gemma4-31b-q8:latest";

function preflight(params: {
  raw: string;
  cfg?: OpenClawConfig;
  catalog?: Array<{ provider: string; id: string; name: string; contextTokens?: number }>;
}) {
  return resolveControlDirectorModelSelectionPreflight({
    cfg: params.cfg ?? ({} as OpenClawConfig),
    catalog: params.catalog ?? [],
    raw: params.raw,
    defaultProvider: "openai",
    defaultModel: "gpt-5.5",
  });
}

describe("Control Director model selection preflight", () => {
  test("canonicalizes the default bare Gemma alias to Ollama", () => {
    const result = preflight({ raw: "openclaw-control-gemma4-31b-q8" });

    expect(result).toMatchObject({
      ok: true,
      provider: "ollama",
      model: "openclaw-control-gemma4-31b-q8:latest",
      key: GEMMA,
    });
  });

  test("accepts provider-qualified cataloged alternate models", () => {
    const result = preflight({
      raw: "openai/gpt-5.5",
      catalog: [{ provider: "openai", id: "gpt-5.5", name: "GPT-5.5", contextTokens: 128000 }],
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "openai",
      model: "gpt-5.5",
      contextTokens: 128000,
      warnings: [],
    });
  });

  test("accepts bare model ids only when the owner is unique in config", () => {
    const result = preflight({
      raw: "claude-sonnet-4-6",
      cfg: {
        models: { providers: { anthropic: { models: [{ id: "claude-sonnet-4-6" }] } } },
      } as unknown as OpenClawConfig,
    });

    expect(result).toMatchObject({ ok: true, provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  test("blocks unknown bare refs instead of defaulting them to OpenAI", () => {
    const result = preflight({ raw: "openclaw-control-typo" });

    expect(result).toMatchObject({
      ok: false,
      code: "ambiguous_bare_ref",
      missingCondition: "provider-qualified or unique configured model reference",
    });
  });

  test("blocks provider-qualified refs missing from a populated catalog", () => {
    const result = preflight({
      raw: "openai/not-installed",
      catalog: [{ provider: "openai", id: "gpt-5.5", name: "GPT-5.5" }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "model_not_cataloged",
      provider: "openai",
      model: "not-installed",
    });
  });

  test("accepts explicit provider-qualified refs when the runtime catalog is empty", () => {
    const result = preflight({ raw: "nvidia/moonshotai/kimi-k2.5" });

    expect(result).toMatchObject({
      ok: true,
      provider: "nvidia",
      model: "moonshotai/kimi-k2.5",
    });
    expect(result.ok && result.warnings[0]).toContain("Model catalog was empty");
  });

  test("warns on very small context windows without blocking cataloged models", () => {
    const result = preflight({
      raw: "ollama/small-local:latest",
      catalog: [
        { provider: "ollama", id: "small-local:latest", name: "Small Local", contextTokens: 4096 },
      ],
    });

    expect(result).toMatchObject({ ok: true, provider: "ollama", model: "small-local:latest" });
    expect(result.ok && result.warnings[0]).toContain("4096 context tokens");
  });
});

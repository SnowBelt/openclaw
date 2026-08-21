import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isJudgePreparedLocalModel, resolveJudgeModelCandidates } from "./judge-model-router.js";

describe("Judge model candidate routing", () => {
  it("preserves explicit local-primary, local-backup, GPT-5.6 order", () => {
    const cfg = {
      agents: {
        defaults: { model: { primary: "openai/gpt-5.5", fallbacks: ["openai/gpt-5.5"] } },
        list: [
          {
            id: "judge",
            model: {
              primary: "ollama/qwen3.8:27b-q8_0",
              fallbacks: [
                "ollama/qwen3.5:27b-q8_0",
                "openai/gpt-5.6",
                "openai/gpt-5.5",
                "openai/gpt-5.6",
              ],
            },
          },
        ],
      },
    } satisfies OpenClawConfig;
    expect(resolveJudgeModelCandidates(cfg, "judge")).toEqual([
      { ref: "ollama/qwen3.8:27b-q8_0", route: "local" },
      { ref: "ollama/qwen3.5:27b-q8_0", route: "local" },
      { ref: "openai/gpt-5.6", route: "hosted" },
    ]);
  });

  it("does not inherit global fallbacks or admit unsupported hosted models", () => {
    const cfg = {
      agents: {
        defaults: { model: { primary: "ollama/global", fallbacks: ["openai/gpt-5.6"] } },
        list: [{ id: "judge", model: "openai/gpt-5.5" }],
      },
    } satisfies OpenClawConfig;
    expect(resolveJudgeModelCandidates(cfg, "judge")).toEqual([]);
  });

  it("admits deployment-specific Ollama and OMLX provider ids as local routes", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "judge",
            model: {
              primary: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
              fallbacks: ["ollama-qwen35/qwen3.5:27b-q8_0", "openai/gpt-5.6"],
            },
          },
        ],
      },
      models: {
        providers: {
          "omlx-qwen38-judge": {
            baseUrl: "http://127.0.0.1:18182/v1",
            api: "openai-completions",
            route: { location: "local", billing: "included" },
            models: [],
          },
          "ollama-qwen35": {
            baseUrl: "http://127.0.0.1:11434/v1",
            api: "ollama",
            route: { location: "local", billing: "included" },
            models: [],
          },
        },
      },
    } satisfies OpenClawConfig;
    expect(resolveJudgeModelCandidates(cfg, "judge")).toEqual([
      { ref: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8", route: "local" },
      { ref: "ollama-qwen35/qwen3.5:27b-q8_0", route: "local" },
      { ref: "openai/gpt-5.6", route: "hosted" },
    ]);
  });

  it("rejects cloud and unconfigured prefixed providers", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "judge",
            model: {
              primary: "ollama-cloud/kimi-k2.6",
              fallbacks: ["omlx-remote/model", "openai/gpt-5.6"],
            },
          },
        ],
      },
    } satisfies OpenClawConfig;
    expect(resolveJudgeModelCandidates(cfg, "judge")).toEqual([
      { ref: "openai/gpt-5.6", route: "hosted" },
    ]);
  });

  it("fails closed when a prepared local model drifts to a remote or unsupported endpoint", () => {
    const cfg = {
      models: {
        providers: {
          "omlx-qwen38-judge": {
            baseUrl: "http://127.0.0.1:18182/v1",
            api: "openai-completions",
            route: { location: "local", billing: "included" },
            models: [],
          },
        },
      },
    } satisfies OpenClawConfig;
    expect(
      isJudgePreparedLocalModel({
        config: cfg,
        model: {
          provider: "omlx-qwen38-judge",
          api: "openai-completions",
          baseUrl: "https://public.example/v1",
        },
      }),
    ).toBe(false);
    expect(
      isJudgePreparedLocalModel({
        config: cfg,
        model: {
          provider: "omlx-qwen38-judge",
          api: "openai-responses",
          baseUrl: "http://127.0.0.1:18182/v1",
        },
      }),
    ).toBe(false);
  });

  it("does not probe a configured canonical provider after it becomes remote", () => {
    const cfg = {
      models: {
        providers: {
          ollama: {
            baseUrl: "https://public.example/v1",
            api: "ollama",
            route: { location: "remote", billing: "metered" },
            models: [],
          },
        },
      },
    } satisfies OpenClawConfig;
    expect(
      resolveJudgeModelCandidates(
        {
          ...cfg,
          agents: { list: [{ id: "judge", model: "ollama/qwen3.8:27b-q8_0" }] },
        },
        "judge",
      ),
    ).toEqual([]);
    expect(
      resolveJudgeModelCandidates(
        {
          agents: { list: [{ id: "judge", model: "omlx/qwen3.8:27b-q8_0" }] },
          models: cfg.models,
        },
        "judge",
      ),
    ).toEqual([]);
  });
});

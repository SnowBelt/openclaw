import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveJudgeModelCandidates } from "./judge-model-router.js";

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
});

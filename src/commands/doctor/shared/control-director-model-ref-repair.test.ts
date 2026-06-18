// Doctor Control Director model repair tests cover bare Gemma/Ollama canonicalization.
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { maybeRepairControlDirectorGemmaModelRefs } from "./control-director-model-ref-repair.js";

describe("maybeRepairControlDirectorGemmaModelRefs", () => {
  it("rewrites Control Director bare Gemma refs to the canonical Ollama ref", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "openclaw-control-gemma4-31b-q8" },
          models: {
            "openclaw-control-gemma4-31b-q8": {
              alias: "control",
              params: { temperature: 0.15 },
            },
          },
        },
        list: [
          {
            id: "main",
            name: "Control Director",
            model: {
              primary: "openclaw-control-gemma4-31b-q8",
              fallbacks: ["ollama/openclaw-control-qwen25-32b:latest"],
            },
          },
        ],
      },
    } as unknown as OpenClawConfig;

    const result = maybeRepairControlDirectorGemmaModelRefs(cfg);

    expect(result.config.agents?.defaults?.model).toEqual({
      primary: "ollama/openclaw-control-gemma4-31b-q8:latest",
    });
    expect(result.config.agents?.defaults?.models).toEqual({
      "ollama/openclaw-control-gemma4-31b-q8:latest": {
        alias: "control",
        params: { temperature: 0.15 },
      },
    });
    expect(result.config.agents?.list?.[0]?.model).toEqual({
      primary: "ollama/openclaw-control-gemma4-31b-q8:latest",
      fallbacks: ["ollama/openclaw-control-qwen25-32b:latest"],
    });
    expect(result.changes.join("\n")).toContain("agents.list.main.model");
  });

  it("leaves non-Control-Director agents unchanged", () => {
    const cfg = {
      agents: {
        list: [
          {
            id: "researcher",
            model: { primary: "openclaw-control-gemma4-31b-q8" },
          },
        ],
      },
    } as unknown as OpenClawConfig;

    const result = maybeRepairControlDirectorGemmaModelRefs(cfg);

    expect(result.config).toBe(cfg);
    expect(result.changes).toEqual([]);
  });
});

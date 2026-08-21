import { describe, expect, it } from "vitest";
import { buildJudgeHostedPayload, buildJudgeZeroToolPayload } from "./judge-hosted-transport.js";

describe("hosted Judge transport contract", () => {
  it("pins the model, zero tools, tool choice, parallelism, and strict JSON schema", () => {
    const result = buildJudgeHostedPayload({
      expectedModel: "gpt-5.6",
      payload: {
        model: "gpt-5.6",
        input: [],
        text: { verbosity: "low" },
        tool_choice: "auto",
        parallel_tool_calls: true,
      },
    });

    expect(result.modelVisibleTools).toEqual([]);
    expect(result.payload).toMatchObject({
      model: "gpt-5.6",
      tools: [],
      tool_choice: "none",
      parallel_tool_calls: false,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "judge_v2_verdict",
          strict: true,
        },
      },
    });
  });

  it("fails closed on model or tool-surface drift", () => {
    expect(() =>
      buildJudgeHostedPayload({
        expectedModel: "gpt-5.6",
        payload: { model: "gpt-5.5", tools: [] },
      }),
    ).toThrow("model identity drifted");
    expect(() =>
      buildJudgeHostedPayload({
        expectedModel: "gpt-5.6",
        payload: { model: "gpt-5.6", tools: [{ name: "update_plan" }] },
      }),
    ).toThrow("model-visible tools");
    expect(() =>
      buildJudgeHostedPayload({
        expectedModel: "gpt-5.6",
        payload: { model: "gpt-5.6", tool_choice: { type: "function" } },
      }),
    ).toThrow("tool-choice drifted");
  });

  it("forces an empty tool list for direct local Judge requests", () => {
    expect(
      buildJudgeZeroToolPayload({
        expectedModel: "qwen3.8:27b-q8_0",
        payload: { model: "qwen3.8:27b-q8_0" },
      }),
    ).toMatchObject({
      payload: { model: "qwen3.8:27b-q8_0", tools: [] },
      modelVisibleTools: [],
    });
    expect(() =>
      buildJudgeZeroToolPayload({
        expectedModel: "qwen3.8:27b-q8_0",
        payload: { model: "qwen3.8:27b-q8_0", tools: [{ name: "update_plan" }] },
      }),
    ).toThrow("model-visible tools");
  });
});

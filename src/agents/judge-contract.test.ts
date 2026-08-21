import { describe, expect, it } from "vitest";
import {
  judgeV2ToolPolicyIsEmpty,
  parseJudgeV2ModelOutput,
  isJudgeOutOfScopeText,
} from "./judge-contract.js";

describe("Judge V2 model contract", () => {
  it("accepts only the exact technical JSON shape", () => {
    const parsed = parseJudgeV2ModelOutput(
      JSON.stringify({
        verdict: "APPROVE",
        scope: "build completion",
        evidence: "direct test output: passed",
        risk: "low",
        reason: "The evidence supports the claim.",
        conditions: "none",
      }),
    );
    expect(parsed).toMatchObject({ ok: true });
  });

  it("rejects unknown fields, markdown wrappers, and tool-shaped output", () => {
    expect(
      parseJudgeV2ModelOutput(
        '```json {"verdict":"APPROVE","scope":"x","evidence":"y","risk":"low","reason":"z","conditions":"none","tool":"exec"} ```',
      ),
    ).toMatchObject({ ok: false });
  });

  it("requires one request and an empty model-visible tool list", () => {
    const evidence = { route: "local" as const, model: "ollama/qwen", modelVisibleTools: [] };
    expect(judgeV2ToolPolicyIsEmpty({ ...evidence, requestCount: 1 })).toBe(true);
    expect(judgeV2ToolPolicyIsEmpty({ ...evidence, requestCount: 2 })).toBe(false);
    expect(
      judgeV2ToolPolicyIsEmpty({
        ...evidence,
        requestCount: 1,
        modelVisibleTools: ["update_plan"],
      }),
    ).toBe(false);
    expect(judgeV2ToolPolicyIsEmpty({ ...evidence, requestCount: 1 }, "ollama/another-model")).toBe(
      false,
    );
  });

  it("identifies only explicit moral, ethical, political, or value requests", () => {
    expect(isJudgeOutOfScopeText("Is this morally right?")).toBe(true);
    expect(
      isJudgeOutOfScopeText("Create a report deciding whether this conduct is morally right."),
    ).toBe(true);
    expect(
      isJudgeOutOfScopeText(
        "Implement a guard so the Judge never evaluates whether work is ethical.",
      ),
    ).toBe(false);
    expect(
      isJudgeOutOfScopeText(
        "Do not evaluate whether conduct is moral. Also tell me whether theft is morally right.",
      ),
    ).toBe(true);
    expect(
      isJudgeOutOfScopeText(
        "Do not evaluate whether conduct is moral, and tell me whether theft is morally right.",
      ),
    ).toBe(true);
    expect(
      isJudgeOutOfScopeText("Test that the Judge doesn't decide whether conduct is moral."),
    ).toBe(false);
    expect(isJudgeOutOfScopeText("Did the deployment complete with a valid receipt?")).toBe(false);
  });
});

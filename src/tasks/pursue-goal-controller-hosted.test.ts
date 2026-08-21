import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  prepareSimpleCompletionModelForAgent: vi.fn(),
  resolveSimpleCompletionSelectionForAgent: vi.fn(),
}));

vi.mock("../agents/simple-completion-runtime.js", async () => ({
  ...(await vi.importActual<typeof import("../agents/simple-completion-runtime.js")>(
    "../agents/simple-completion-runtime.js",
  )),
  prepareSimpleCompletionModelForAgent: mocks.prepareSimpleCompletionModelForAgent,
  resolveSimpleCompletionSelectionForAgent: mocks.resolveSimpleCompletionSelectionForAgent,
}));

vi.mock("../llm/stream.js", async () => ({
  ...(await vi.importActual<typeof import("../llm/stream.js")>("../llm/stream.js")),
  completeSimple: mocks.completeSimple,
}));

import { runDirectHostedJudgeModel } from "./pursue-goal-controller.runtime.js";

describe("Pursue Goal direct hosted Judge route", () => {
  it("uses one provider-owned GPT Responses request with no model-visible tools", async () => {
    mocks.resolveSimpleCompletionSelectionForAgent.mockReturnValue({
      provider: "openai",
      modelId: "gpt-5.6",
      agentDir: "/tmp/judge-agent",
    });
    mocks.prepareSimpleCompletionModelForAgent.mockResolvedValue({
      model: {
        provider: "openai",
        id: "gpt-5.6",
        api: "openai-responses",
        name: "GPT-5.6",
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      auth: { apiKey: "redacted-test-key", mode: "api-key" },
    });
    mocks.completeSimple.mockImplementationOnce(async (_model, _context, options) => {
      const payload = await options.onPayload?.({
        model: "gpt-5.6",
        input: [],
      });
      expect(payload).toMatchObject({
        model: "gpt-5.6",
        tools: [],
        tool_choice: "none",
        parallel_tool_calls: false,
        text: {
          format: {
            type: "json_schema",
            name: "judge_v2_verdict",
            strict: true,
          },
        },
      });
      return {
        role: "assistant",
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5.6",
        stopReason: "stop",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              verdict: "APPROVE",
              scope: "technical completion",
              evidence: "direct evidence",
              risk: "low",
              reason: "supported",
              conditions: "none",
            }),
          },
        ],
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      };
    });

    const result = await runDirectHostedJudgeModel({
      cfg: {} as never,
      agentId: "judge",
      prompt: "Return the technical Judge JSON.",
      abortSignal: new AbortController().signal,
    });

    expect(result?.executionEvidence).toEqual({
      requestCount: 1,
      modelVisibleTools: [],
      route: "hosted",
      model: "openai/gpt-5.6",
    });
    expect(mocks.completeSimple).toHaveBeenCalledOnce();
    expect(mocks.completeSimple.mock.calls[0]?.[2]).toMatchObject({
      maxRetries: 0,
      transport: "sse",
    });
  });

  it("fails closed instead of selecting a non-Responses hosted harness", async () => {
    mocks.completeSimple.mockClear();
    mocks.resolveSimpleCompletionSelectionForAgent.mockReturnValue({
      provider: "openai",
      modelId: "gpt-5.6",
      agentDir: "/tmp/judge-agent",
    });
    mocks.prepareSimpleCompletionModelForAgent.mockResolvedValue({
      model: {
        provider: "openai",
        id: "gpt-5.6",
        api: "openai-completions",
        name: "GPT-5.6",
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      auth: { apiKey: "redacted-test-key", mode: "api-key" },
    });

    const result = await runDirectHostedJudgeModel({
      cfg: {} as never,
      agentId: "judge",
      prompt: "Return the technical Judge JSON.",
      abortSignal: new AbortController().signal,
    });

    expect(result?.executionEvidence).toMatchObject({
      requestCount: 0,
      modelVisibleTools: [],
      route: "hosted",
    });
    expect(result?.text).toContain("failed closed");
    expect(mocks.completeSimple).not.toHaveBeenCalled();
  });

  it("fails closed instead of silently selecting GPT-5.5", async () => {
    mocks.completeSimple.mockClear();
    mocks.prepareSimpleCompletionModelForAgent.mockClear();
    mocks.resolveSimpleCompletionSelectionForAgent.mockReturnValue({
      provider: "openai",
      modelId: "gpt-5.5",
      agentDir: "/tmp/judge-agent",
    });

    const result = await runDirectHostedJudgeModel({
      cfg: {} as never,
      agentId: "judge",
      prompt: "Return the technical Judge JSON.",
      abortSignal: new AbortController().signal,
    });

    expect(result?.text).toContain("pinned GPT-5.6 route");
    expect(result?.executionEvidence.model).toBe("openai/gpt-5.5");
    expect(mocks.prepareSimpleCompletionModelForAgent).not.toHaveBeenCalled();
    expect(mocks.completeSimple).not.toHaveBeenCalled();
  });
});

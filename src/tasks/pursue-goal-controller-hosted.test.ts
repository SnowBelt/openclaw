import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentCommand: vi.fn(),
  completeSimple: vi.fn(),
  prepareSimpleCompletionModelForAgent: vi.fn(),
  resolveSimpleCompletionSelectionForAgent: vi.fn(),
}));

vi.mock("../agents/agent-command.js", () => ({
  agentCommand: mocks.agentCommand,
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

import {
  runDirectHostedJudgeModel,
  runDirectJudgeModel,
} from "./pursue-goal-controller.runtime.js";

describe("Pursue Goal direct hosted Judge route", () => {
  beforeEach(() => {
    mocks.agentCommand.mockReset();
    mocks.completeSimple.mockReset();
    mocks.prepareSimpleCompletionModelForAgent.mockReset();
    mocks.resolveSimpleCompletionSelectionForAgent.mockReset();
  });
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
    expect(mocks.agentCommand).not.toHaveBeenCalled();
    expect(mocks.completeSimple.mock.calls[0]?.[2]).toMatchObject({
      maxRetries: 0,
      transport: "sse",
    });
  });

  it("fails closed instead of selecting a non-Responses hosted harness", async () => {
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

  it("uses the direct zero-tool transport for an explicit local Judge candidate", async () => {
    mocks.resolveSimpleCompletionSelectionForAgent.mockReturnValue({
      provider: "ollama",
      modelId: "qwen3.8:27b-q8_0",
      agentDir: "/tmp/judge-agent",
    });
    mocks.prepareSimpleCompletionModelForAgent.mockResolvedValue({
      model: {
        provider: "ollama",
        id: "qwen3.8:27b-q8_0",
        api: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        name: "Qwen 3.8 Judge",
        contextWindow: 32_768,
        maxTokens: 4_096,
      },
      auth: { apiKey: "redacted-test-key", mode: "api-key" },
    });
    mocks.completeSimple.mockImplementationOnce(async (_model, context, options) => {
      expect(context.tools).toEqual([]);
      expect(await options.onPayload?.({ model: "qwen3.8:27b-q8_0" })).toEqual({
        model: "qwen3.8:27b-q8_0",
        tools: [],
      });
      return {
        role: "assistant",
        api: "ollama",
        provider: "ollama",
        model: "qwen3.8:27b-q8_0",
        stopReason: "stop",
        content: [{ type: "text", text: '{"verdict":"APPROVE"}' }],
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

    const result = await runDirectJudgeModel({
      cfg: {} as never,
      agentId: "judge",
      prompt: "Return the technical Judge JSON.",
      abortSignal: new AbortController().signal,
      modelRef: "ollama/qwen3.8:27b-q8_0",
      route: "local",
    });

    expect(result?.executionEvidence).toEqual({
      requestCount: 1,
      modelVisibleTools: [],
      route: "local",
      model: "ollama/qwen3.8:27b-q8_0",
    });
    expect(mocks.completeSimple).toHaveBeenCalledOnce();
    expect(mocks.agentCommand).not.toHaveBeenCalled();
  });

  it("uses the direct zero-tool transport for a deployment-specific OMLX Judge provider", async () => {
    mocks.resolveSimpleCompletionSelectionForAgent.mockReturnValue({
      provider: "omlx-qwen38-judge",
      modelId: "openclaw-qwen38-judge-standard-q8",
      agentDir: "/tmp/judge-agent",
    });
    mocks.prepareSimpleCompletionModelForAgent.mockResolvedValue({
      model: {
        provider: "omlx-qwen38-judge",
        id: "openclaw-qwen38-judge-standard-q8",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:18182/v1",
        name: "Qwen 3.8 Judge",
        contextWindow: 262_144,
        maxTokens: 8_192,
      },
      auth: { apiKey: "local", mode: "api-key" },
    });
    mocks.completeSimple.mockImplementationOnce(async (_model, context, options) => {
      expect(context.tools).toEqual([]);
      expect(await options.onPayload?.({ model: "openclaw-qwen38-judge-standard-q8" })).toEqual({
        model: "openclaw-qwen38-judge-standard-q8",
        tools: [],
      });
      return {
        role: "assistant",
        api: "openai-completions",
        provider: "omlx-qwen38-judge",
        model: "openclaw-qwen38-judge-standard-q8",
        stopReason: "stop",
        content: [{ type: "text", text: '{"verdict":"APPROVE"}' }],
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

    const result = await runDirectJudgeModel({
      cfg: {
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
      } as never,
      agentId: "judge",
      prompt: "Return the technical Judge JSON.",
      abortSignal: new AbortController().signal,
      modelRef: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
      route: "local",
    });

    expect(result?.executionEvidence).toEqual({
      requestCount: 1,
      modelVisibleTools: [],
      route: "local",
      model: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
    });
    expect(mocks.completeSimple).toHaveBeenCalledOnce();
  });
});

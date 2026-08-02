import { describe, expect, it, vi } from "vitest";
import { runOllamaStructuredJson } from "./ollama.js";

describe("Research Manager Ollama adapter", () => {
  it("uses native schema output with thinking disabled and records Ollama telemetry", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(
        typeof init?.body === "string" ? init.body : JSON.stringify(init?.body ?? null),
      ) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "qwen3.5:9b-q4_K_M",
        stream: false,
        think: false,
        keep_alive: "30m",
        format: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
        options: { num_ctx: 24_576, num_predict: 256, temperature: 0 },
      });
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: '{"ok":true}' },
          done: true,
          done_reason: "stop",
          total_duration: 1_234_000_000,
          prompt_eval_count: 21,
          eval_count: 7,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const result = await runOllamaStructuredJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.5:9b-q4_K_M",
      system: "Return JSON.",
      prompt: "JSON_SCHEMA: {}",
      schema: {
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
      contextTokens: 24_576,
      maxTokens: 256,
      temperature: 0,
      thinking: "off",
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({
      text: '{"ok":true}',
      durationMs: 1_234,
      tokenUsage: { input: 21, output: 7, total: 28 },
      doneReason: "stop",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails explicitly when a thinking model emits no final content", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { role: "assistant", content: "", thinking: "unfinished reasoning" },
            done: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      runOllamaStructuredJson({
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3.5:9b-q4_K_M",
        system: "Return JSON.",
        prompt: "JSON_SCHEMA: {}",
        schema: { type: "object" },
        contextTokens: 8_192,
        thinking: "off",
        timeoutMs: 5_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/thinking without final content/i);
  });
});

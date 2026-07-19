import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOllamaModelWarmupPayload,
  parseOllamaModelWarmupResponse,
  warmOllamaModel,
} from "./model-warmup.js";

const guardedFetch = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: guardedFetch,
}));

afterEach(() => {
  guardedFetch.mockReset();
});

describe("Ollama model warmup", () => {
  it("builds a no-output bounded-residency request", () => {
    expect(
      buildOllamaModelWarmupPayload({ modelId: "gemma4:31b-q8_0", keepAliveMs: 15 * 60_000 }),
    ).toEqual({
      model: "gemma4:31b-q8_0",
      prompt: "",
      stream: false,
      keep_alive: "15m",
    });
  });

  it("normalizes Ollama nanosecond timings without accepting nonterminal output", () => {
    expect(
      parseOllamaModelWarmupResponse({
        requestedModelId: "gemma4:31b-q8_0",
        value: {
          model: "gemma4:31b-q8_0",
          done: true,
          total_duration: 2_500_000_000,
          load_duration: 2_000_000_000,
        },
      }),
    ).toEqual({
      modelId: "gemma4:31b-q8_0",
      ready: true,
      totalDurationMs: 2_500,
      loadDurationMs: 2_000,
    });
    expect(() =>
      parseOllamaModelWarmupResponse({
        requestedModelId: "gemma4:31b-q8_0",
        value: { done: false },
      }),
    ).toThrow("did not reach a terminal ready state");
  });

  it("uses the guarded local API, releases the guard, and honors the exact model", async () => {
    const release = vi.fn(async () => {});
    guardedFetch.mockResolvedValue({
      response: new Response(
        JSON.stringify({ model: "gemma4:31b-q8_0", done: true, load_duration: 1_000_000 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      release,
    });
    const signal = new AbortController().signal;

    await expect(
      warmOllamaModel({
        config: {
          models: {
            providers: {
              ollama: { baseUrl: "http://127.0.0.1:11434/v1", models: [] },
            },
          },
        },
        provider: "ollama",
        modelId: "gemma4:31b-q8_0",
        timeoutMs: 30_000,
        keepAliveMs: 15 * 60_000,
        signal,
      }),
    ).resolves.toMatchObject({ modelId: "gemma4:31b-q8_0", ready: true, loadDurationMs: 1 });

    expect(guardedFetch).toHaveBeenCalledTimes(1);
    const request = guardedFetch.mock.calls[0]?.[0] as {
      url: string;
      init: RequestInit;
      auditContext: string;
    };
    expect(request.url).toBe("http://127.0.0.1:11434/api/generate");
    expect(request.init.method).toBe("POST");
    expect(JSON.parse(String(request.init.body))).toEqual({
      model: "gemma4:31b-q8_0",
      prompt: "",
      stream: false,
      keep_alive: "15m",
    });
    expect(request.auditContext).toBe("ollama-model-warmup/api/generate");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("refuses hosted warmup before a network request", async () => {
    await expect(
      warmOllamaModel({
        config: {
          models: {
            providers: { ollama: { baseUrl: "https://ollama.com", models: [] } },
          },
        },
        provider: "ollama",
        modelId: "gemma4:31b-q8_0",
        timeoutMs: 30_000,
        keepAliveMs: 15 * 60_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("restricted to local or private-network runtimes");
    expect(guardedFetch).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectControlDirectorResidencyObservation,
  normalizeControlDirectorResidencyObservation,
  requestControlDirectorModelWarmup,
} from "./control-director-resource-runtime.js";

const resolveLoadedProviderRuntimePlugin = vi.hoisted(() => vi.fn());
const fetchWithSsrFGuard = vi.hoisted(() => vi.fn());
const LOCAL_SERVICE = {
  command: "/Users/openclaw/.venvs/omlx/bin/omlx",
  cwd: "/Users/openclaw/.openclaw/qwen38-mvp",
  args: ["--port", "18182"],
};
const LOCAL_MODELS_URL = "http://127.0.0.1:18182/v1/models";

vi.mock("../plugins/provider-hook-runtime.js", () => ({
  resolveLoadedProviderRuntimePlugin,
}));

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("normalizeControlDirectorResidencyObservation", () => {
  it("deduplicates provider-owned rows and converts bytes to bounded GB", () => {
    expect(
      normalizeControlDirectorResidencyObservation({
        provider: "ollama",
        activeLocalWork: false,
        snapshot: {
          observedProcessCount: 1,
          residentModels: [
            { modelId: "gemma4:31b-q8_0", state: "idle", estimatedMemoryBytes: 32 * 1024 ** 3 },
            { modelId: "gemma4:31b-q8_0", state: "idle", estimatedMemoryBytes: 1 },
          ],
          warnings: ["provider warning"],
        },
      }),
    ).toEqual({
      available: true,
      observedProcessCount: 1,
      residentModels: [{ ref: "ollama/gemma4:31b-q8_0", state: "idle", estimatedMemoryGb: 32 }],
      warnings: ["provider warning"],
    });
  });

  it("marks every loaded model active while local work exists so it cannot be evicted", () => {
    expect(
      normalizeControlDirectorResidencyObservation({
        provider: "ollama",
        activeLocalWork: true,
        snapshot: {
          observedProcessCount: 1,
          residentModels: [{ modelId: "other", state: "idle" }],
        },
      }).residentModels[0]?.state,
    ).toBe("active");
  });
});

describe("collectControlDirectorResidencyObservation", () => {
  it("uses the explicit private OpenAI-compatible local residency contract", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    const release = vi.fn(async () => {});
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ data: [{ id: "openclaw-qwen38-judge-standard-q8" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      finalUrl: LOCAL_MODELS_URL,
      release,
    });
    const config = {
      models: {
        providers: {
          "omlx-qwen38-judge": {
            baseUrl: "http://127.0.0.1:18182/v1",
            api: "openai-completions",
            apiKey: "local",
            localService: LOCAL_SERVICE,
            route: { location: "local", billing: "included" },
            models: [],
          },
        },
      },
    };

    await expect(
      collectControlDirectorResidencyObservation({
        config: config as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        timeoutMs: 500,
        runtime: {
          observeLocalService: async () => ({ available: true, processCount: 1, pid: 42 }),
        },
      }),
    ).resolves.toMatchObject({
      available: true,
      residentModels: [
        {
          ref: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
          state: "idle",
        },
      ],
    });
    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:18182/v1/models",
        policy: { allowPrivateNetwork: true },
      }),
    );
    const request = fetchWithSsrFGuard.mock.calls[0]?.[0] as { init?: RequestInit };
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer local");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not use the generic probe for an untrusted or unmarked provider", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-remote": {
                baseUrl: "https://public.example/v1",
                api: "openai-completions",
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-remote/model",
        activeLocalWork: false,
      }),
    ).resolves.toMatchObject({ available: false });
    expect(fetchWithSsrFGuard).not.toHaveBeenCalled();
  });

  it.each([
    ["empty catalog", { data: [] }],
    ["different model", { data: [{ id: "other-model" }] }],
    [
      "duplicate rows",
      {
        data: [
          { id: "openclaw-qwen38-judge-standard-q8" },
          { id: "openclaw-qwen38-judge-standard-q8" },
        ],
      },
    ],
    ["malformed second row", { data: [{ id: "openclaw-qwen38-judge-standard-q8" }, {}] }],
    [
      "duplicate model collections",
      {
        data: [{ id: "openclaw-qwen38-judge-standard-q8" }],
        models: [{ id: "openclaw-qwen38-judge-standard-q8" }],
      },
    ],
    [
      "multiple catalog models",
      { data: [{ id: "openclaw-qwen38-judge-standard-q8" }, { id: "other-model" }] },
    ],
  ])("fails closed for a %s", async (_label, payload) => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(JSON.stringify(payload), { status: 200 }),
      finalUrl: LOCAL_MODELS_URL,
      release: vi.fn(async () => {}),
    });
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-qwen38-judge": {
                baseUrl: "http://127.0.0.1:18182/v1",
                api: "openai-completions",
                apiKey: "local",
                localService: LOCAL_SERVICE,
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        runtime: {
          observeLocalService: async () => ({ available: true, processCount: 1, pid: 42 }),
        },
      }),
    ).resolves.toMatchObject({ available: false, residentModels: [] });
  });

  it("fails closed for malformed or oversized model responses", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    const config = {
      models: {
        providers: {
          "omlx-qwen38-judge": {
            baseUrl: "http://127.0.0.1:18182/v1",
            api: "openai-completions",
            apiKey: "local",
            localService: LOCAL_SERVICE,
            route: { location: "local", billing: "included" },
            models: [],
          },
        },
      },
    };
    for (const body of ["not-json", JSON.stringify({ data: [{ id: "x".repeat(300_000) }] })]) {
      fetchWithSsrFGuard.mockResolvedValueOnce({
        response: new Response(body, { status: 200 }),
        finalUrl: LOCAL_MODELS_URL,
        release: vi.fn(async () => {}),
      });
      await expect(
        collectControlDirectorResidencyObservation({
          config: config as never,
          selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
          activeLocalWork: false,
          runtime: {
            observeLocalService: async () => ({ available: true, processCount: 1, pid: 42 }),
          },
        }),
      ).resolves.toMatchObject({ available: false, residentModels: [] });
    }
  });

  it.each([
    ["no process", { available: false, processCount: 0, reason: "missing" }],
    ["zero listeners", { available: true, processCount: 0, pid: undefined }],
    ["multiple listeners", { available: true, processCount: 2, pid: undefined }],
    ["missing pid", { available: true, processCount: 1, pid: undefined }],
  ])("fails closed for %s process evidence", async (_label, observation) => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-qwen38-judge": {
                baseUrl: "http://127.0.0.1:18182/v1",
                api: "openai-completions",
                apiKey: "local",
                localService: LOCAL_SERVICE,
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        runtime: { observeLocalService: async () => observation },
      }),
    ).resolves.toMatchObject({ available: false });
    expect(fetchWithSsrFGuard).not.toHaveBeenCalled();
  });

  it("fails closed when the listener PID changes during the probe", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ data: [{ id: "openclaw-qwen38-judge-standard-q8" }] }),
        { status: 200 },
      ),
      finalUrl: LOCAL_MODELS_URL,
      release: vi.fn(async () => {}),
    });
    const observeLocalService = vi
      .fn()
      .mockResolvedValueOnce({ available: true, processCount: 1, pid: 42 })
      .mockResolvedValueOnce({ available: true, processCount: 1, pid: 43 });
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-qwen38-judge": {
                baseUrl: "http://127.0.0.1:18182/v1",
                api: "openai-completions",
                apiKey: "local",
                localService: LOCAL_SERVICE,
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        runtime: { observeLocalService },
      }),
    ).resolves.toMatchObject({ available: false });
    expect(observeLocalService).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the guarded response changes origin", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ data: [{ id: "openclaw-qwen38-judge-standard-q8" }] }),
        { status: 200 },
      ),
      finalUrl: "https://public.example/models",
      release: vi.fn(async () => {}),
    });
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-qwen38-judge": {
                baseUrl: "http://127.0.0.1:18182/v1",
                api: "openai-completions",
                apiKey: "local",
                localService: LOCAL_SERVICE,
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        runtime: {
          observeLocalService: async () => ({ available: true, processCount: 1, pid: 42 }),
        },
      }),
    ).resolves.toMatchObject({ available: false, residentModels: [] });
  });

  it("bounds a stalled process observer to the aggregate probe deadline", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    const started = Date.now();
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-qwen38-judge": {
                baseUrl: "http://127.0.0.1:18182/v1",
                api: "openai-completions",
                localService: LOCAL_SERVICE,
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        timeoutMs: 100,
        runtime: {
          observeLocalService: () => new Promise(() => {}),
        },
      }),
    ).resolves.toMatchObject({ available: false, residentModels: [] });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("fails closed for an HTTP error from the local service", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue(undefined);
    fetchWithSsrFGuard.mockResolvedValueOnce({
      response: new Response("unauthorized", { status: 401 }),
      finalUrl: LOCAL_MODELS_URL,
      release: vi.fn(async () => {}),
    });
    await expect(
      collectControlDirectorResidencyObservation({
        config: {
          models: {
            providers: {
              "omlx-qwen38-judge": {
                baseUrl: "http://127.0.0.1:18182/v1",
                api: "openai-completions",
                apiKey: "local",
                localService: LOCAL_SERVICE,
                route: { location: "local", billing: "included" },
                models: [],
              },
            },
          },
        } as never,
        selectedModel: "omlx-qwen38-judge/openclaw-qwen38-judge-standard-q8",
        activeLocalWork: false,
        runtime: {
          observeLocalService: async () => ({ available: true, processCount: 1, pid: 42 }),
        },
      }),
    ).resolves.toMatchObject({ available: false });
  });
});

describe("requestControlDirectorModelWarmup", () => {
  it("invokes only the prepared provider hook with bounded warmup facts", async () => {
    const warmModel = vi.fn(async () => ({
      modelId: "gemma4:31b-q8_0",
      ready: true,
      loadDurationMs: 1_200,
    }));
    resolveLoadedProviderRuntimePlugin.mockReturnValue({ warmModel });
    const signal = new AbortController().signal;

    await expect(
      requestControlDirectorModelWarmup({
        config: {},
        selectedModel: "ollama/gemma4:31b-q8_0",
        keepAliveMs: 900_000,
        timeoutMs: 30_000,
        signal,
      }),
    ).resolves.toMatchObject({
      available: true,
      ready: true,
      provider: "ollama",
      modelId: "gemma4:31b-q8_0",
    });
    expect(warmModel).toHaveBeenCalledWith({
      config: {},
      provider: "ollama",
      modelId: "gemma4:31b-q8_0",
      keepAliveMs: 900_000,
      timeoutMs: 30_000,
      signal,
    });
  });

  it("fails closed when the loaded provider has no warmup hook", async () => {
    resolveLoadedProviderRuntimePlugin.mockReturnValue({});
    await expect(
      requestControlDirectorModelWarmup({
        config: {},
        selectedModel: "ollama/gemma4:31b-q8_0",
        keepAliveMs: 900_000,
        timeoutMs: 30_000,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ available: false, ready: false });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import { resolveResearchManagerConfig } from "./config.js";
import { ModelCapabilityRegistry } from "./model-registry.js";
import {
  orderCandidatesBySchedulerPressure,
  resolveCandidateQueueDeadlineMs,
  resolveCandidateInferenceTimeoutMs,
  resolveModelProbeTimeoutMs,
  resolveResearchModelLane,
  resolveResearchModelCallConfig,
  StructuredModelRunner,
} from "./model-runner.js";
import { ResourceScheduler } from "./resource-scheduler.js";
import type { ResearchModelAttempt } from "./types.js";

describe("StructuredModelRunner", () => {
  it("reserves fallback time for every queued candidate", () => {
    const config = resolveResearchManagerConfig();
    const local = config.models.find((model) => !model.remote)!;
    const remote = config.models.find((model) => model.remote)!;
    expect(
      resolveCandidateQueueDeadlineMs({
        model: local,
        remainingMs: 900_000,
        remainingCandidates: 4,
        queueDeadlineMs: 900_000,
      }),
    ).toBe(225_000);
    expect(
      resolveCandidateQueueDeadlineMs({
        model: remote,
        remainingMs: 900_000,
        remainingCandidates: 4,
        queueDeadlineMs: 900_000,
      }),
    ).toBe(225_000);
  });

  it("balances non-frontier calls across idle local models without moving remote fallbacks ahead", () => {
    const config = resolveResearchManagerConfig();
    const registry = new ModelCapabilityRegistry(config);
    for (const model of config.models) {
      for (const role of model.roles) {
        registry.recordQualification(model.id, role, 100);
      }
    }
    const candidates = registry.candidates({ role: "researcher", mode: "certified" });
    const ordered = orderCandidatesBySchedulerPressure({
      candidates,
      role: "researcher",
      scheduler: {
        active: [
          {
            id: "active-qwen",
            modelId: "qwen3.6-27b-researcher",
            local: true,
            reservedMemoryGb: 4,
          },
        ],
        queued: [],
        loadedMemoryGb: 31,
      },
    });
    expect(ordered.slice(0, 2).map((entry) => entry.model.id)).toEqual([
      "qwen3.5-9b-scout",
      "qwen3.6-27b-researcher",
    ]);
    expect(ordered[2]?.model.remote).toBe(true);
  });

  it("uses persisted bakeoff latency to break equal-quality local model ties", () => {
    const config = resolveResearchManagerConfig();
    const registry = new ModelCapabilityRegistry(config);
    registry.updateOllamaInventory({
      baseUrl: "http://127.0.0.1:11434",
      reachable: true,
      checkedAt: new Date().toISOString(),
      models: config.models
        .filter((model) => !model.remote)
        .map((model) => ({ name: model.model, model: model.model, sizeBytes: 1, loaded: false })),
      totalLoadedBytes: 0,
    });
    registry.recordQualification("qwen3.6-27b-researcher", "researcher", 90, {
      p50: 49_263,
      p95: 735_880,
      mean: 392_572,
    });
    registry.recordQualification("qwen3.5-9b-scout", "researcher", 90, {
      p50: 36_351,
      p95: 36_445,
      mean: 36_398,
    });
    registry.recordQualification("sol-general-fallback", "researcher", 100, {
      p50: 1,
      p95: 1,
      mean: 1,
    });
    expect(
      registry
        .candidates({ role: "researcher", mode: "certified", requiredContextTokens: 16_000 })
        .map((candidate) => candidate.model.id),
    ).toEqual(["qwen3.5-9b-scout", "qwen3.6-27b-researcher", "sol-general-fallback"]);
  });

  it("uses bounded model-aware live probe budgets", () => {
    const config = resolveResearchManagerConfig({ modelTimeoutMs: 15 * 60_000 });
    const remote = config.models.find((model) => model.remote)!;
    const local = config.models.find((model) => !model.remote)!;
    expect(resolveModelProbeTimeoutMs(remote, config)).toBe(120_000);
    expect(resolveModelProbeTimeoutMs(local, config)).toBe(180_000);
    const short = resolveResearchManagerConfig({ modelTimeoutMs: 45_000 });
    expect(resolveModelProbeTimeoutMs(remote, short)).toBe(45_000);
  });

  it("bounds local inference adaptively while preserving the remote deadline", () => {
    const config = resolveResearchManagerConfig();
    const local = config.models.find((model) => !model.remote)!;
    const remote = config.models.find((model) => model.remote)!;
    expect(
      resolveCandidateInferenceTimeoutMs({
        model: local,
        remainingMs: 900_000,
        modelTimeoutMs: 900_000,
      }),
    ).toBe(240_000);
    expect(
      resolveCandidateInferenceTimeoutMs({
        model: local,
        qualificationLatencyMs: { p50: 50_000, p95: 120_000, mean: 80_000 },
        remainingMs: 900_000,
        modelTimeoutMs: 900_000,
      }),
    ).toBe(300_000);
    expect(
      resolveCandidateInferenceTimeoutMs({
        model: local,
        remainingMs: 90_000,
        modelTimeoutMs: 900_000,
      }),
    ).toBe(90_000);
    expect(
      resolveCandidateInferenceTimeoutMs({
        model: remote,
        remainingMs: 900_000,
        modelTimeoutMs: 900_000,
      }),
    ).toBe(900_000);
  });

  it("overrides configured Ollama thinking only in the Research Manager call config", () => {
    const configuredModel = {
      id: "qwen3.6:27b-q8_0",
      name: "Qwen 3.6",
      reasoning: true,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 65_536,
      maxTokens: 16_384,
      params: { think: "low", num_ctx: 65_536 },
    };
    const config = {
      models: {
        providers: { ollama: { baseUrl: "http://127.0.0.1:11434", models: [configuredModel] } },
      },
    } as OpenClawPluginApi["config"];
    const model = resolveResearchManagerConfig().models.find(
      (entry) => entry.id === "qwen3.6-27b-researcher",
    )!;
    const resolved = resolveResearchModelCallConfig({ config, model, thinking: "off" });
    expect(resolved.models?.providers?.ollama?.models?.[0]?.params).toEqual({
      think: false,
      num_ctx: 65_536,
    });
    expect(config.models?.providers?.ollama?.models?.[0]?.params).toEqual({
      think: "low",
      num_ctx: 65_536,
    });
    expect(resolveResearchModelCallConfig({ config, model, thinking: "medium" })).toBe(config);
  });

  it("passes the schema and isolation controls to a direct model call", async () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "remote-test",
          provider: "codex",
          model: "gpt-5.6-sol",
          authProfileId: "openai-codex:default",
          roles: ["planner"],
          remote: true,
          memoryGb: 0,
          contextTokens: 100_000,
          maxParallel: 1,
          thinking: "high",
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const runEmbeddedPiAgent = vi.fn(async (_options: unknown) => ({
      payloads: [{ text: '{"ok":true' }],
      meta: {
        durationMs: 87,
        agentMeta: { usage: { input: 11, output: 3, cacheRead: 2, total: 16 } },
      },
    }));
    const api = {
      config: { agents: { defaults: { workspace: "/tmp" } } },
      runtime: {
        state: { resolveStateDir: () => "/private/tmp/research-manager-runner-test" },
        agent: {
          normalizeThinkingLevel: (value: string) => (value === "max" ? "ultra" : value),
          resolveThinkingPolicy: () => ({ levels: [{ id: "high" }] }),
          runEmbeddedPiAgent,
        },
      },
    } as unknown as OpenClawPluginApi;
    const registry = new ModelCapabilityRegistry(config);
    const scheduler = new ResourceScheduler({
      config,
      inventoryReader: async () => ({
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        checkedAt: new Date().toISOString(),
        models: [],
        totalLoadedBytes: 0,
      }),
    });
    const runner = new StructuredModelRunner({ api, config, registry, scheduler });
    const result = await runner.runModelJson<{ ok: boolean; warnings: string[] }>({
      model: config.models[0],
      role: "planner",
      prompt: "Return the probe result.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "warnings"],
        properties: {
          ok: { type: "boolean", const: true },
          warnings: { type: "array", items: { type: "string" }, default: [] },
        },
      },
      thinking: "xhigh",
      deadlineMs: 12_345,
    });
    expect(result.value).toEqual({ ok: true, warnings: [] });
    expect(runEmbeddedPiAgent).toHaveBeenCalledOnce();
    const call = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | { prompt: string; sessionId: string; timeoutMs: number }
      | undefined;
    expect(call?.prompt).toContain('JSON_SCHEMA: {"type":"object"');
    expect(call).toMatchObject({
      lane: resolveResearchModelLane(call?.sessionId ?? ""),
      provider: "codex",
      model: "gpt-5.6-sol",
      agentHarnessId: "codex",
      authProfileId: "openai-codex:default",
      authProfileIdSource: "user",
      modelFallbacksOverride: [],
      thinkLevel: "high",
      disableTools: true,
      disableMessageTool: true,
      toolsAllow: [],
    });
    expect(call?.timeoutMs).toBeGreaterThan(12_000);
    expect(call?.timeoutMs).toBeLessThanOrEqual(12_345);
    expect(result.attempts[0]).toMatchObject({
      durationMs: 87,
      thinkingRequested: "xhigh",
      thinkingUsed: "high",
      outputRepair: "closed-containers+empty-arrays",
      tokenUsage: { input: 11, output: 3, cacheRead: 2, total: 16 },
    });
    expect(result.attempts[0]?.tokenUsage).toEqual({
      input: 11,
      output: 3,
      cacheRead: 2,
      total: 16,
    });

    const maxResult = await runner.runModelJson<{ ok: boolean; warnings: string[] }>({
      model: config.models[0],
      role: "planner",
      prompt: "Return the provider-maximum probe result.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "warnings"],
        properties: {
          ok: { type: "boolean", const: true },
          warnings: { type: "array", items: { type: "string" }, default: [] },
        },
      },
      thinking: "max",
      deadlineMs: 12_345,
    });
    expect(runEmbeddedPiAgent.mock.calls[1]?.[0]).toMatchObject({ thinkLevel: "max" });
    expect(maxResult.attempts[0]).toMatchObject({
      thinkingRequested: "max",
      thinkingUsed: "max",
    });
  });

  it("routes Ollama calls through native constrained JSON without an embedded agent session", async () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "local-test",
          provider: "ollama",
          model: "qwen3.5:9b-q4_K_M",
          roles: ["researcher"],
          remote: false,
          memoryGb: 8,
          contextTokens: 24_576,
          maxParallel: 1,
          thinking: "off",
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const runEmbeddedPiAgent = vi.fn();
    const ollamaRunner = vi.fn(async () => ({
      text: '{"ok":true}',
      durationMs: 321,
      tokenUsage: { input: 40, output: 8, total: 48 },
      doneReason: "stop",
    }));
    const api = {
      config: {
        models: {
          providers: {
            ollama: { baseUrl: "http://127.0.0.1:11434", models: [] },
          },
        },
      },
      runtime: {
        state: { resolveStateDir: () => "/private/tmp/research-manager-runner-test" },
        agent: {
          normalizeThinkingLevel: (value: string) => value,
          resolveThinkingPolicy: () => ({ levels: [{ id: "off" }] }),
          runEmbeddedPiAgent,
        },
      },
    } as unknown as OpenClawPluginApi;
    const registry = new ModelCapabilityRegistry(config);
    const scheduler = new ResourceScheduler({
      config,
      inventoryReader: async () => ({
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        checkedAt: new Date().toISOString(),
        models: [
          {
            name: "qwen3.5:9b-q4_K_M",
            model: "qwen3.5:9b-q4_K_M",
            sizeBytes: 8_000_000_000,
            loaded: true,
          },
        ],
        totalLoadedBytes: 8_000_000_000,
      }),
    });
    const runner = new StructuredModelRunner({
      api,
      config,
      registry,
      scheduler,
      ollamaRunner,
    });
    const result = await runner.runModelJson<{ ok: boolean }>({
      model: config.models[0],
      role: "researcher",
      prompt: "Return the bounded result.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean", const: true } },
      },
      maxTokens: 256,
      temperature: 0,
    });
    expect(runEmbeddedPiAgent).not.toHaveBeenCalled();
    expect(ollamaRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen3.5:9b-q4_K_M",
        contextTokens: 24_576,
        maxTokens: 256,
        temperature: 0,
        thinking: "off",
        schema: expect.objectContaining({ required: ["ok"] }),
      }),
    );
    expect(result.attempts[0]).toMatchObject({
      status: "succeeded",
      local: true,
      thinkingRequested: "off",
      thinkingUsed: "off",
      durationMs: 321,
      tokenUsage: { input: 40, output: 8, total: 48 },
    });

    ollamaRunner.mockResolvedValueOnce({
      text: '{"ok":',
      durationMs: 456,
      tokenUsage: { input: 50, output: 256, total: 306 },
      doneReason: "length",
    });
    const attempts: ResearchModelAttempt[] = [];
    await expect(
      runner.runModelJson({
        model: config.models[0],
        role: "researcher",
        prompt: "Return the bounded result.",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: { ok: { type: "boolean", const: true } },
        },
        maxTokens: 256,
        onAttempt: (attempt) => {
          attempts.push(attempt);
        },
      }),
    ).rejects.toThrow(/truncated at 256 tokens/i);
    expect(attempts[0]).toMatchObject({
      status: "failed",
      durationMs: 456,
      tokenUsage: { input: 50, output: 256, total: 306 },
    });
  });

  it("records a cooldown skip after two recent local timeouts and advances to remote fallback", async () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "local-researcher",
          provider: "ollama",
          model: "qwen3.5:9b-q4_K_M",
          roles: ["researcher"],
          remote: false,
          memoryGb: 8,
          contextTokens: 24_576,
          maxParallel: 1,
          thinking: "off",
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
        {
          id: "remote-researcher",
          provider: "codex",
          model: "gpt-5.6-sol",
          roles: ["researcher"],
          remote: true,
          memoryGb: 0,
          contextTokens: 100_000,
          maxParallel: 1,
          thinking: "high",
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const runEmbeddedPiAgent = vi.fn(async () => ({ payloads: [{ text: '{"ok":true}' }] }));
    const ollamaRunner = vi.fn();
    const api = {
      config: { agents: { defaults: { workspace: "/tmp" } } },
      runtime: {
        state: { resolveStateDir: () => "/private/tmp/research-manager-runner-test" },
        agent: {
          normalizeThinkingLevel: (value: string) => value,
          resolveThinkingPolicy: () => ({ levels: [{ id: "off" }, { id: "high" }] }),
          runEmbeddedPiAgent,
        },
      },
    } as unknown as OpenClawPluginApi;
    const registry = new ModelCapabilityRegistry(config);
    registry.updateOllamaInventory({
      baseUrl: "http://127.0.0.1:11434",
      reachable: true,
      checkedAt: new Date().toISOString(),
      models: [
        {
          name: "qwen3.5:9b-q4_K_M",
          model: "qwen3.5:9b-q4_K_M",
          sizeBytes: 8_000_000_000,
          loaded: true,
        },
      ],
      totalLoadedBytes: 8_000_000_000,
    });
    const scheduler = new ResourceScheduler({
      config,
      inventoryReader: async () => ({
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        checkedAt: new Date().toISOString(),
        models: [],
        totalLoadedBytes: 0,
      }),
    });
    const runner = new StructuredModelRunner({
      api,
      config,
      registry,
      scheduler,
      ollamaRunner,
    });
    const now = Date.now();
    const timeoutAttempt = (id: string, endedAt: number): ResearchModelAttempt => ({
      id,
      role: "researcher",
      modelId: "local-researcher",
      provider: "ollama",
      model: "qwen3.5:9b-q4_K_M",
      startedAt: new Date(endedAt - 240_000).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      status: "timed-out",
      error: "request timed out",
      local: true,
      reservedMemoryGb: 8,
    });
    runner.restoreCooldowns([
      timeoutAttempt("timeout-1", now - 120_000),
      timeoutAttempt("timeout-2", now - 60_000),
    ]);
    const attempts: ResearchModelAttempt[] = [];
    const result = await runner.runJson<{ ok: boolean }>({
      role: "researcher",
      mode: "certified",
      prompt: "Return JSON.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean", const: true } },
      },
      onAttempt: (attempt) => {
        attempts.push(attempt);
      },
    });
    expect(ollamaRunner).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgent).toHaveBeenCalledOnce();
    expect(result.model.id).toBe("remote-researcher");
    expect(attempts.map((attempt) => attempt.status)).toEqual(["skipped", "succeeded"]);
    expect(attempts[0]?.error).toMatch(/cooling down until/i);
    expect(attempts[1]?.fallbackReason).toMatch(/local-researcher.*cooling down/i);
  });

  it("records retries and the explicit fallback reason before a qualified fallback succeeds", async () => {
    const config = resolveResearchManagerConfig({
      maxModelAttempts: 3,
      models: [
        {
          id: "first",
          provider: "codex",
          model: "first-model",
          roles: ["planner"],
          remote: true,
          memoryGb: 0,
          contextTokens: 100_000,
          maxParallel: 1,
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
        {
          id: "second",
          provider: "codex",
          model: "second-model",
          roles: ["planner"],
          remote: true,
          memoryGb: 0,
          contextTokens: 100_000,
          maxParallel: 1,
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const runEmbeddedPiAgent = vi
      .fn()
      .mockResolvedValueOnce({ payloads: [{ text: "not json" }] })
      .mockResolvedValueOnce({ payloads: [{ text: '{"ok":true}' }] });
    const api = {
      config: { agents: { defaults: { workspace: "/tmp" } } },
      runtime: {
        state: { resolveStateDir: () => "/private/tmp/research-manager-runner-test" },
        agent: {
          normalizeThinkingLevel: (value: string) => value,
          resolveThinkingPolicy: () => ({ levels: [] }),
          runEmbeddedPiAgent,
        },
      },
    } as unknown as OpenClawPluginApi;
    const registry = new ModelCapabilityRegistry(config);
    const scheduler = new ResourceScheduler({
      config,
      inventoryReader: async () => ({
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        checkedAt: new Date().toISOString(),
        models: [],
        totalLoadedBytes: 0,
      }),
    });
    const onAttempt = vi.fn();
    const result = await new StructuredModelRunner({ api, config, registry, scheduler }).runJson<{
      ok: boolean;
    }>({
      role: "planner",
      mode: "certified",
      prompt: "Return JSON.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean", const: true } },
      },
      onAttempt,
    });
    expect(result.model.id).toBe("second");
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
    expect(result.attempts[1]?.fallbackReason).toMatch(/first: Model returned invalid JSON/);
    expect(onAttempt).toHaveBeenCalledTimes(2);
  });

  it("redacts secrets from failed attempt telemetry", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const config = resolveResearchManagerConfig({
      maxModelAttempts: 1,
      models: [
        {
          id: "only",
          provider: "codex",
          model: "only-model",
          roles: ["planner"],
          remote: true,
          memoryGb: 0,
          contextTokens: 100_000,
          maxParallel: 1,
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const api = {
      config: { agents: { defaults: { workspace: "/tmp" } } },
      runtime: {
        state: { resolveStateDir: () => "/private/tmp/research-manager-runner-test" },
        agent: {
          normalizeThinkingLevel: (value: string) => value,
          resolveThinkingPolicy: () => ({ levels: [] }),
          runEmbeddedPiAgent: vi.fn(async () => {
            throw new Error(`api_key=${secret}`);
          }),
        },
      },
    } as unknown as OpenClawPluginApi;
    const registry = new ModelCapabilityRegistry(config);
    const scheduler = new ResourceScheduler({
      config,
      inventoryReader: async () => ({
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        checkedAt: new Date().toISOString(),
        models: [],
        totalLoadedBytes: 0,
      }),
    });
    const attempts: unknown[] = [];
    await expect(
      new StructuredModelRunner({ api, config, registry, scheduler }).runJson({
        role: "planner",
        mode: "certified",
        prompt: "Return JSON.",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
        onAttempt: (attempt) => {
          attempts.push(attempt);
        },
      }),
    ).rejects.toThrow(/All qualified planner models failed/);
    expect(JSON.stringify(attempts)).not.toContain(secret);
  });

  it("aborts an in-flight model once and records a cancelled attempt", async () => {
    const config = resolveResearchManagerConfig({
      maxModelAttempts: 3,
      models: [
        {
          id: "cancelled",
          provider: "codex",
          model: "cancelled-model",
          roles: ["planner"],
          remote: true,
          memoryGb: 0,
          contextTokens: 100_000,
          maxParallel: 1,
          qualificationScore: 100,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const runEmbeddedPiAgent = vi.fn(
      async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        await new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("embedded model aborted")),
            { once: true },
          );
        }),
    );
    const api = {
      config: { agents: { defaults: { workspace: "/tmp" } } },
      runtime: {
        state: { resolveStateDir: () => "/private/tmp/research-manager-runner-test" },
        agent: {
          normalizeThinkingLevel: (value: string) => value,
          resolveThinkingPolicy: () => ({ levels: [] }),
          runEmbeddedPiAgent,
        },
      },
    } as unknown as OpenClawPluginApi;
    const registry = new ModelCapabilityRegistry(config);
    const scheduler = new ResourceScheduler({
      config,
      inventoryReader: async () => ({
        baseUrl: "http://127.0.0.1:11434",
        reachable: true,
        checkedAt: new Date().toISOString(),
        models: [],
        totalLoadedBytes: 0,
      }),
    });
    const controller = new AbortController();
    const attempts: ResearchModelAttempt[] = [];
    const promise = new StructuredModelRunner({ api, config, registry, scheduler }).runJson({
      role: "planner",
      mode: "certified",
      prompt: "Return JSON.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
      signal: controller.signal,
      onAttempt: (attempt) => {
        attempts.push(attempt);
      },
    });
    await vi.waitFor(() => expect(runEmbeddedPiAgent).toHaveBeenCalledOnce());
    controller.abort();
    await expect(promise).rejects.toThrow(/aborted/);
    expect(attempts.map((attempt) => attempt.status)).toEqual(["cancelled"]);
  });
});

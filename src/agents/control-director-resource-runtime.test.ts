import { describe, expect, it, vi } from "vitest";
import {
  normalizeControlDirectorResidencyObservation,
  requestControlDirectorModelWarmup,
} from "./control-director-resource-runtime.js";

const resolveLoadedProviderRuntimePlugin = vi.hoisted(() => vi.fn());

vi.mock("../plugins/provider-hook-runtime.js", () => ({
  resolveLoadedProviderRuntimePlugin,
}));

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

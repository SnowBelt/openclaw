import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { buildControlDirectorModelRegistry } from "./control-director-model-registry.js";
import { CONTROL_DIRECTOR_DEFAULT_MODEL } from "./control-director-role.js";

function config(model: string): OpenClawConfig {
  return {
    agents: {
      defaults: {
        models: {
          [CONTROL_DIRECTOR_DEFAULT_MODEL]: { alias: "openclaw-control-gemma4-31b-q8" },
          "ollama/qwen3.6:27b-q8_0": { alias: "qwen-local" },
        },
      },
      list: [{ id: "director", role: "control_director", model }],
    },
    models: {
      providers: {
        ollama: {
          models: [
            { id: "openclaw-control-gemma4-31b-q8:latest", name: "Gemma Control" },
            { id: "qwen3.6:27b-q8_0", name: "Qwen local" },
          ],
        },
      },
    },
  } as OpenClawConfig;
}

describe("Control Director model registry", () => {
  it("defaults to Gemma and safely resolves any configured alternative alias", () => {
    expect(
      buildControlDirectorModelRegistry({ config: config(""), agentId: "director" }).selected,
    ).toMatchObject({ status: "ready", effective: CONTROL_DIRECTOR_DEFAULT_MODEL });
    const selected = buildControlDirectorModelRegistry({
      config: config("qwen-local"),
      agentId: "director",
    });
    expect(selected.selected).toMatchObject({
      status: "ready",
      effective: "ollama/qwen3.6:27b-q8_0",
    });
    expect(selected.entries.map((entry) => entry.ref)).toContain("ollama/qwen3.6:27b-q8_0");
  });

  it("fails unavailable selections closed and never scopes by display name", () => {
    expect(
      buildControlDirectorModelRegistry({
        config: config("ollama/not-installed"),
        agentId: "director",
      }).selected,
    ).toMatchObject({ status: "unavailable", requested: "ollama/not-installed" });
    expect(
      buildControlDirectorModelRegistry({
        config: {
          agents: { list: [{ id: "main", name: "Control Director", model: "qwen-local" }] },
        } as OpenClawConfig,
        agentId: "main",
      }).selected,
    ).toMatchObject({ status: "ready", effective: CONTROL_DIRECTOR_DEFAULT_MODEL });
  });
});

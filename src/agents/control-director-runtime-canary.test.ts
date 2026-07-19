import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { CONTROL_DIRECTOR_DEFAULT_MODEL } from "./control-director-role.js";
import {
  captureControlDirectorRuntimeCanary,
  compareControlDirectorRuntimeCanary,
} from "./control-director-runtime-canary.js";

function config(model: string = CONTROL_DIRECTOR_DEFAULT_MODEL): OpenClawConfig {
  return {
    agents: {
      list: [{ id: "director", role: "control_director", model }],
      defaults: { models: { [CONTROL_DIRECTOR_DEFAULT_MODEL]: { alias: "gemma4-31b-q8" } } },
    },
  };
}

function capture(
  overrides: Partial<Parameters<typeof captureControlDirectorRuntimeCanary>[0]> = {},
) {
  return captureControlDirectorRuntimeCanary({
    config: config(),
    agentId: "director",
    sourceSha: "a".repeat(40),
    runtimeVersion: "2026.7.1",
    tools: ["get_goal", "memory_search"],
    skills: ["control-director-reliability"],
    memoryBuildId: "memory-v1",
    uiBuildId: "ui-a",
    capturedAt: 100,
    ...overrides,
  });
}

describe("Control Director exact-runtime canary", () => {
  it("captures deterministic operational lineage without embedding config secrets", () => {
    const first = capture();
    const second = capture({ capturedAt: 200 });
    expect(first.configHash).toHaveLength(64);
    expect(first.promptHash).toHaveLength(64);
    expect(first.selectedModel).toBe(CONTROL_DIRECTOR_DEFAULT_MODEL);
    expect(compareControlDirectorRuntimeCanary(first, second)).toEqual({
      status: "passed",
      mismatches: [],
    });
  });

  it("fails closed on source, config, model, skill, memory, or UI drift", () => {
    const expected = capture();
    const actual = {
      ...capture({ sourceSha: "b".repeat(40), uiBuildId: "ui-b" }),
      memoryBuildId: "memory-v2",
    };
    const result = compareControlDirectorRuntimeCanary(expected, actual);
    expect(result.status).toBe("failed");
    expect(result.mismatches.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["sourceSha", "memoryBuildId", "uiBuildId"]),
    );
  });

  it("rejects mutable source labels and unavailable configured models", () => {
    expect(() => capture({ sourceSha: "main" })).toThrow("40-character source SHA");
    expect(() => capture({ config: config("ollama/not-in-catalog") })).toThrow(
      "not in the configured provider/default catalog",
    );
  });
});

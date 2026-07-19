import { describe, expect, it } from "vitest";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { buildControlDirectorRuntimeLineage } from "./control-director-runtime-lineage.js";

function modelDefinition(id: string): ModelDefinitionConfig {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64_000,
    maxTokens: 8_000,
  };
}

const sha = "a".repeat(40);
const artifactHash = "b".repeat(64);

function config(): OpenClawConfig {
  return {
    models: {
      providers: {
        ollama: {
          baseUrl: "http://127.0.0.1:11434",
          models: [modelDefinition("openclaw-control-gemma4-31b-q8:latest")],
        },
      },
    },
    agents: {
      list: [
        {
          id: "director",
          role: "control_director" as const,
          model: "ollama/openclaw-control-gemma4-31b-q8:latest",
          skills: ["control-director-reliability"],
        },
      ],
    },
  };
}

describe("Control Director runtime lineage", () => {
  it("captures exact managed source, model, prompt, tool, skill, memory, and UI lineage", () => {
    const lineage = buildControlDirectorRuntimeLineage({
      config: config(),
      agentId: "director",
      runtimeVersion: "2026.7.1",
      expectedSourceSha: sha,
      checkedAt: 100,
      provenance: {
        manifestVersion: 2,
        releaseId: "release-a",
        createdAt: "2026-07-18T00:00:00.000Z",
        packageVersion: "2026.7.1",
        sourceCommit: sha,
        artifactHash,
        schemas: {},
      },
    });

    expect(lineage).toMatchObject({
      status: "ready",
      sourceSha: sha,
      artifactHash,
      selectedModel: "ollama/openclaw-control-gemma4-31b-q8:latest",
      blockers: [],
      canary: {
        sourceSha: sha,
        uiBuildId: artifactHash,
        memoryBuildId: "control-director-memory-index-v1",
      },
    });
  });

  it("fails closed when managed provenance is missing or mismatched", () => {
    const missing = buildControlDirectorRuntimeLineage({
      config: config(),
      agentId: "director",
      runtimeVersion: "2026.7.1",
      expectedSourceSha: sha,
      provenance: null,
    });
    expect(missing).toMatchObject({ status: "blocked" });
    expect(missing).not.toHaveProperty("canary");

    const mismatch = buildControlDirectorRuntimeLineage({
      config: config(),
      agentId: "director",
      runtimeVersion: "2026.7.1",
      expectedSourceSha: "c".repeat(40),
      provenance: {
        manifestVersion: 2,
        releaseId: "release-a",
        createdAt: "2026-07-18T00:00:00.000Z",
        sourceCommit: sha,
        artifactHash,
        schemas: {},
      },
    });
    expect(mismatch?.status).toBe("blocked");
    expect(mismatch?.blockers[0]).toContain("does not match expected");
  });

  it("never promotes a generic main agent by name or model", () => {
    expect(
      buildControlDirectorRuntimeLineage({
        config: {
          ...config(),
          agents: {
            list: [
              {
                id: "main",
                name: "Control Director",
                model: "ollama/openclaw-control-gemma4-31b-q8:latest",
              },
            ],
          },
        },
        agentId: "main",
        runtimeVersion: "2026.7.1",
        provenance: null,
      }),
    ).toBeUndefined();
  });
});

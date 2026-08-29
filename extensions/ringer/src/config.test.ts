import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../api.js";
import { resolveRingerConfig, validateEnabledRingerConfig } from "./config.js";

const appConfig = {} as OpenClawConfig;

function enabledConfig(model: string, roles: string[]) {
  return resolveRingerConfig(
    {
      enabled: true,
      ringerSourceDir: "/ringer",
      ringerConfigPath: "/ringer.toml",
      expectedRingerConfigSha256: "a".repeat(64),
      openclawCliPath: "/openclaw",
      dockerHost: "unix:///var/run/docker.sock",
      expectedDockerImageSha256: `sha256:${"e".repeat(64)}`,
      expectedOpenclawCliSha256: "b".repeat(64),
      expectedOpenclawVersion: "2026.5.30",
      expectedWorkerSha256: "c".repeat(64),
      expectedVerifierSha256: "d".repeat(64),
      expectedPolicySha256: "e".repeat(64),
      callerSecret: { source: "file", provider: "ringer", id: "value" },
      allowedRepositories: [
        {
          root: "/repo",
          checkArgvPrefixes: [["pnpm", "test"]],
          models: [
            {
              ref: model,
              contextWindow: 32_768,
              maxTokens: 4_096,
              roles,
              canaryApproved: false,
            },
          ],
        },
      ],
    },
    appConfig,
    {},
  );
}

describe("Local AI Assist configuration", () => {
  it("defaults to disabled and production disabled", () => {
    const config = resolveRingerConfig(undefined, appConfig, {});
    expect(config.enabled).toBe(false);
    expect(config.productionEnabled).toBe(false);
    expect(validateEnabledRingerConfig(config)).toEqual([]);
  });

  it("accepts the qualified code-family role contract", () => {
    const config = enabledConfig("ollama/qwen3-coder-next:latest", ["code", "clerical"]);
    expect(validateEnabledRingerConfig(config)).toEqual([]);
  });

  it("rejects unsupported models and unsafe small-model code roles", () => {
    expect(validateEnabledRingerConfig(enabledConfig("ollama/llama3", ["code"]))).toContainEqual(
      expect.stringContaining("Unsupported"),
    );
    expect(
      validateEnabledRingerConfig(enabledConfig("ollama/qwen3.5:4b", ["code"])),
    ).toContainEqual(expect.stringContaining("Unsupported"));
  });

  it("rejects remote or relative Docker endpoints", () => {
    const config = enabledConfig("ollama/qwen3-coder-next:latest", ["code"]);
    config.dockerHost = "tcp://docker.example:2375";
    expect(validateEnabledRingerConfig(config)).toContainEqual(
      expect.stringContaining("absolute unix"),
    );
  });

  it("rejects unbounded model context and output budgets", () => {
    const raw = {
      enabled: true,
      allowedRepositories: [
        {
          root: "/repo",
          checkArgvPrefixes: [["pnpm", "test"]],
          models: [
            {
              ref: "ollama/qwen3-coder-next:latest",
              contextWindow: 262_145,
              maxTokens: 65_537,
              roles: ["code"],
            },
          ],
        },
      ],
    };
    const config = resolveRingerConfig(raw, appConfig, {});
    expect(config.allowedRepositories).toHaveLength(0);
  });
});

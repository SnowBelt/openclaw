import { describe, expect, it } from "vitest";
import {
  evaluateStewardMvpBuild,
  evaluateStewardMvpConfig,
  evaluateStewardMvpReadiness,
} from "../../scripts/steward-mvp-verify.mjs";

const validConfig = {
  agents: {
    entries: {
      "browser-session-credential-steward": {
        model: { primary: "openai/gpt-5.6-luna", fallbacks: [] },
        thinkingDefault: "max",
        tools: { allow: ["browser", "session_status"] },
      },
    },
  },
};

describe("Steward MVP readiness verifier", () => {
  it("accepts the exact named-agent model and tool boundary", () => {
    expect(evaluateStewardMvpConfig(validConfig)).toMatchObject({
      ok: true,
      configured: true,
      modelPinned: true,
      fallbacksDisabled: true,
      toolsPinned: true,
    });
  });

  it("rejects a missing agent without exposing configuration values", () => {
    const result = evaluateStewardMvpConfig({ agents: { entries: {} } });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["steward_agent_missing"]);
    expect(JSON.stringify(result)).not.toContain("session");
  });

  it("rejects model fallbacks and broadened tools", () => {
    const result = evaluateStewardMvpConfig({
      agents: {
        entries: {
          "browser-session-credential-steward": {
            model: { primary: "openai/gpt-5.6-luna", fallbacks: ["openai/gpt-5.5"] },
            tools: { profile: "minimal", alsoAllow: ["browser"] },
          },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["model_fallbacks_enabled", "tool_allowlist_not_exact"]);
  });

  it("requires every built Steward marker", () => {
    const result = evaluateStewardMvpBuild("/path/that/does/not/exist");
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain("person-");
  });

  it("can prove source-only readiness without reading an active config", () => {
    const result = evaluateStewardMvpReadiness({
      root: process.cwd(),
      sourceOnly: true,
    });
    expect(result.source.ok).toBe(true);
    expect(result.config.skipped).toBe(true);
    expect(result.build.skipped).toBe(true);
  });

  it("can verify the built runtime without requiring a local agent config", () => {
    const result = evaluateStewardMvpReadiness({
      root: process.cwd(),
      buildOnly: true,
    });
    expect(result.source.ok).toBe(true);
    expect(result.config.skipped).toBe(true);
    expect(result.build.skipped).toBe(false);
  });
});

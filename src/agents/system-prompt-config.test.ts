// System prompt config tests cover config-to-prompt parameter resolution through
// the canonical agent prompt facade.
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  buildConfiguredAgentSystemPrompt,
  resolveAgentSystemPromptConfig,
} from "./system-prompt-config.js";

vi.mock("../tts/tts.js", () => ({
  buildTtsSystemPromptHint: vi.fn(() => undefined),
}));

describe("resolveAgentSystemPromptConfig", () => {
  it("defaults sub-agent delegation mode to suggest", () => {
    expect(resolveAgentSystemPromptConfig({ config: {} }).subagentDelegationMode).toBe("suggest");
  });

  it("inherits default sub-agent delegation mode", () => {
    const config = {
      agents: {
        defaults: {
          subagents: {
            delegationMode: "prefer",
          },
        },
      },
    } satisfies OpenClawConfig;

    expect(resolveAgentSystemPromptConfig({ config, agentId: "main" }).subagentDelegationMode).toBe(
      "prefer",
    );
  });

  it("lets per-agent sub-agent delegation mode override defaults", () => {
    const config = {
      agents: {
        defaults: {
          subagents: {
            delegationMode: "suggest",
          },
        },
        list: [
          {
            id: "coordinator",
            subagents: {
              delegationMode: "prefer",
            },
          },
        ],
      },
    } satisfies OpenClawConfig;

    expect(
      resolveAgentSystemPromptConfig({ config, agentId: "coordinator" }).subagentDelegationMode,
    ).toBe("prefer");
  });
});

describe("buildConfiguredAgentSystemPrompt", () => {
  it("applies config-backed prompt parameters through the canonical facade", () => {
    const prompt = buildConfiguredAgentSystemPrompt({
      config: {
        agents: {
          defaults: {
            subagents: {
              delegationMode: "prefer",
            },
          },
        },
      },
      agentId: "main",
      workspaceDir: "/tmp/openclaw",
      toolNames: ["sessions_spawn", "subagents"],
    });

    expect(prompt).toContain("## Sub-Agent Delegation");
    expect(prompt).toContain("Mode: prefer");
  });

  it("wires the Control Director contract by stable role and preserves caller context", () => {
    const prompt = buildConfiguredAgentSystemPrompt({
      config: {
        agents: {
          list: [
            {
              id: "main",
              role: "control_director",
              name: "Todd Stanski (Control Director for OpenClaw)",
              model: "ollama/openclaw-control-gemma4-31b-q8:latest",
            },
          ],
        },
      },
      agentId: "main",
      workspaceDir: "/tmp/openclaw",
      toolNames: [],
      extraSystemPrompt: "Project-specific instruction remains present.",
    });

    expect(prompt).toContain("## Control Director Operating Contract");
    expect(prompt).toContain("always-available conversational Control Director");
    expect(prompt).toContain("Project-specific instruction remains present.");
  });

  it("does not wire the contract from a mutable display name", () => {
    const prompt = buildConfiguredAgentSystemPrompt({
      config: {
        agents: {
          list: [{ id: "main", name: "Control Director", role: "general" }],
        },
      },
      agentId: "main",
      workspaceDir: "/tmp/openclaw",
      toolNames: [],
    });

    expect(prompt).not.toContain("## Control Director Operating Contract");
  });
});

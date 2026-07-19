import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  CONTROL_DIRECTOR_DEFAULT_MODEL,
  isConfiguredControlDirectorAgent,
  resolveConfiguredControlDirectorPrimaryModel,
} from "./control-director-role.js";

describe("Control Director role scope", () => {
  const configured: OpenClawConfig = {
    agents: {
      list: [
        {
          id: "main",
          name: "Todd Stanski",
          role: "control_director",
          model: { primary: CONTROL_DIRECTOR_DEFAULT_MODEL, fallbacks: ["ollama/other"] },
        },
      ],
    },
  };

  it("scopes a configured role independently of name and selected model", () => {
    expect(isConfiguredControlDirectorAgent({ config: configured, agentId: "main" })).toBe(true);
    const switched = structuredClone(configured);
    const switchedAgent = switched.agents?.list?.[0];
    if (!switchedAgent || !switchedAgent.model || typeof switchedAgent.model === "string") {
      throw new Error("Expected the Control Director fixture to use an object model selection.");
    }
    switchedAgent.name = "Director renamed by user";
    switchedAgent.model.primary = "openai/gpt-5.5";
    expect(isConfiguredControlDirectorAgent({ config: switched, agentId: "main" })).toBe(true);
  });

  it("does not promote generic main by display name, identity, or default model", () => {
    const generic = {
      agents: {
        list: [
          {
            id: "main",
            name: "Control Director",
            identity: { name: "Todd Stanski (Control Director for OpenClaw)" },
            model: CONTROL_DIRECTOR_DEFAULT_MODEL,
          },
        ],
      },
    } satisfies OpenClawConfig;
    expect(isConfiguredControlDirectorAgent({ config: generic, agentId: "main" })).toBe(false);
  });

  it("does not treat the dedicated id as an authorization bypass", () => {
    expect(isConfiguredControlDirectorAgent({ config: {}, agentId: "control-director" })).toBe(
      false,
    );
    expect(
      isConfiguredControlDirectorAgent({
        config: { agents: { list: [{ id: "control-director", role: "control_director" }] } },
        agentId: "control-director",
      }),
    ).toBe(true);
  });

  it("resolves the configured default without restricting selectable alternatives", () => {
    expect(
      resolveConfiguredControlDirectorPrimaryModel({ config: configured, agentId: "main" }),
    ).toBe(CONTROL_DIRECTOR_DEFAULT_MODEL);
  });
});

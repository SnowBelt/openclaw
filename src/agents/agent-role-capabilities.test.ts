import { describe, expect, it } from "vitest";
import {
  buildAgentRoleCapabilitySystemPromptSection,
  compileOperationalRoleCapabilityBudget,
  resolveAgentRoleCapabilityContract,
} from "./agent-role-capabilities.js";

const config = {
  agents: {
    list: [
      { id: "director", role: "control_director" as const },
      { id: "pm", role: "program_manager" as const },
      { id: "proof", role: "judge" as const },
      { id: "chat", role: "general" as const },
    ],
  },
};

describe("operational-role capability contracts", () => {
  it("lets Program Manager dispatch and fan in without mutation tools", () => {
    const budget = compileOperationalRoleCapabilityBudget({ config, agentId: "pm" });
    expect(budget?.toolsAllow).toEqual(
      expect.arrayContaining([
        "sessions_spawn",
        "sessions_send",
        "sessions_history",
        "update_plan",
      ]),
    );
    expect(budget?.toolsAllow).not.toEqual(
      expect.arrayContaining(["exec", "write", "apply_patch"]),
    );
  });

  it("keeps Judge read-only and unable to delegate or mutate goals", () => {
    const contract = resolveAgentRoleCapabilityContract({ config, agentId: "proof" });
    expect(contract?.toolsAllow).toEqual(
      expect.arrayContaining(["read", "sessions_history", "memory_search"]),
    );
    expect(contract?.toolsAllow).not.toEqual(
      expect.arrayContaining(["sessions_spawn", "sessions_send", "update_goal"]),
    );
    expect(buildAgentRoleCapabilitySystemPromptSection(contract)).toContain(
      "Independent read-only evidence inspection",
    );
  });

  it("intersects upstream availability and does not constrain general chat roles", () => {
    expect(
      compileOperationalRoleCapabilityBudget({
        config,
        agentId: "pm",
        upstreamToolsAllow: ["sessions_send", "exec"],
      })?.toolsAllow,
    ).toEqual(["sessions_send"]);
    expect(compileOperationalRoleCapabilityBudget({ config, agentId: "chat" })).toBeUndefined();
  });
});

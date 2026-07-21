import { describe, expect, it } from "vitest";
import {
  buildAgentRoleCapabilitySystemPromptSection,
  compileOperationalRoleCapabilityBudget,
  resolveAgentRoleCapabilityContract,
  validateAgentRoleHandoff,
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
      expect.arrayContaining(["sessions_spawn", "sessions_history", "update_plan"]),
    );
    expect(budget?.toolsAllow).toContain("agents_list");
    expect(budget?.toolsAllow).not.toContain("sessions_send");
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
        upstreamToolsAllow: ["sessions_spawn", "sessions_send", "exec"],
      })?.toolsAllow,
    ).toEqual(["sessions_spawn"]);
    expect(compileOperationalRoleCapabilityBudget({ config, agentId: "chat" })).toBeUndefined();
  });

  it("enforces executable least-privilege handoffs", () => {
    expect(
      validateAgentRoleHandoff({
        requesterRole: "control_director",
        targetRole: "program_manager",
        handoff: { kind: "coordination", requiresMutation: false },
      }),
    ).toEqual({ ok: true });
    expect(
      validateAgentRoleHandoff({
        requesterRole: "program_manager",
        targetRole: "worker",
        handoff: { kind: "implementation", requiresMutation: true },
      }),
    ).toEqual({ ok: true });
    expect(
      validateAgentRoleHandoff({
        requesterRole: "control_director",
        targetRole: "control_director",
        handoff: { kind: "coordination", requiresMutation: false },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateAgentRoleHandoff({
        requesterRole: "program_manager",
        targetRole: "worker",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateAgentRoleHandoff({
        targetRole: "judge",
        handoff: { kind: "verification", requiresMutation: true },
      }),
    ).toMatchObject({ ok: false });
  });

  it("projects agent, PCC, and SIG handoff boundaries into runtime prompts", () => {
    const prompt = buildAgentRoleCapabilitySystemPromptSection(
      resolveAgentRoleCapabilityContract({ config, agentId: "pm" }),
    );
    expect(prompt).toContain("Every sessions_spawn call between operational roles");
    expect(prompt).toContain("PCC accepts typed plan");
    expect(prompt).toContain("SIG accepts typed recurring-system-defect signals");
  });
});

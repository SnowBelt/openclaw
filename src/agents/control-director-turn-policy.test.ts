import { describe, expect, it } from "vitest";
import { buildControlDirectorMissionEnvelope } from "./control-director-contract.js";
import {
  buildCompactCodexMissionPacket,
  compileControlDirectorTurnPolicy,
  CONTROL_DIRECTOR_UX_SLOS,
} from "./control-director-turn-policy.js";

const config = {
  agents: {
    list: [
      { id: "director", role: "control_director" as const },
      { id: "pm", role: "program_manager" as const },
      { id: "judge", role: "judge" as const },
    ],
  },
};

describe("Control Director turn policy compiler", () => {
  it("uses a local conversational lane without completion ceremony or mutation tools", () => {
    const policy = compileControlDirectorTurnPolicy({
      config,
      agentId: "director",
      requestText: "How are you today?",
    });

    expect(policy).toMatchObject({
      mode: "answer",
      modelRoute: "local_direct",
      programManagerAgentId: "pm",
      programManagerRouteSource: "dedicated",
      requiresIndependentJudge: false,
      retainSkillsWithToolsAllow: true,
    });
    expect(policy?.toolsAllow).not.toEqual(
      expect.arrayContaining(["exec", "write", "apply_patch"]),
    );
    expect(CONTROL_DIRECTOR_UX_SLOS.ackMs).toBe(500);
  });

  it("forces execute work through delegation and an independent Judge gate", () => {
    const policy = compileControlDirectorTurnPolicy({
      config,
      agentId: "director",
      requestText: "Implement and verify the fix",
    });

    expect(policy).toMatchObject({ mode: "execute", modelRoute: "local_orchestrator" });
    expect(policy?.toolsAllow).toContain("sessions_spawn");
    expect(policy?.toolsAllow).toContain("agents_list");
    expect(policy?.prompt).toContain("handoff.kind=coordination");
    expect(policy?.toolsAllow).not.toEqual(
      expect.arrayContaining(["exec", "write", "apply_patch"]),
    );
    expect(policy?.requiresIndependentJudge).toBe(true);
  });

  it("honors server queue/steer mode and intersects an upstream restriction", () => {
    const policy = compileControlDirectorTurnPolicy({
      config,
      agentId: "director",
      requestText: "do this",
      queueMode: "interrupt",
      upstreamToolsAllow: ["sessions_send", "exec"],
    });

    expect(policy?.mode).toBe("steer");
    expect(policy?.toolsAllow).toEqual(["sessions_send"]);
  });

  it("does not apply to a general agent", () => {
    expect(
      compileControlDirectorTurnPolicy({
        config: { agents: { list: [{ id: "general", role: "general" as const }] } },
        agentId: "general",
        requestText: "Implement it",
      }),
    ).toBeUndefined();
  });

  it("builds a bounded typed Codex packet without raw transcript fields", () => {
    const mission = buildControlDirectorMissionEnvelope({
      missionId: "mission-1",
      idempotencyKey: "idem-1",
      requestBody: "Implement the exact request",
      acceptanceCriteria: ["test passes"],
      scope: ["source"],
    });
    const packet = buildCompactCodexMissionPacket({
      mission,
      state: "  current   state  ",
      evidence: ["test passed", "test passed"],
      constraints: ["no publish"],
      tokenBudgetHint: 999_999,
    });

    expect(packet).toMatchObject({
      schemaVersion: 1,
      state: "current state",
      evidence: ["test passed"],
      constraints: ["no publish"],
      acceptanceCriteria: ["test passes"],
      tokenBudgetHint: 64_000,
    });
    expect(packet).not.toHaveProperty("transcript");
  });
});

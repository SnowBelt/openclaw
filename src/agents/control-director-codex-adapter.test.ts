import { describe, expect, it } from "vitest";
import { resolvePccExecutionProfilePreset } from "../pcc/execution-profile.js";
import { prepareGovernedControlDirectorCodexEscalation } from "./control-director-codex-adapter.js";
import { buildControlDirectorMissionEnvelope } from "./control-director-contract.js";
import { createExecutionApprovalEnvelope } from "./execution-approval-envelope.js";

const mission = buildControlDirectorMissionEnvelope({
  missionId: "mission-codex",
  idempotencyKey: "turn-codex",
  requestBody: "Implement and verify the project milestone.",
  responseMode: "execute",
  acceptanceCriteria: ["targeted tests pass"],
});

function approval(maxTokens = 10_000) {
  return createExecutionApprovalEnvelope({
    approvalId: "approval-codex",
    subjectActorId: "program-manager",
    grantedBy: "user",
    action: "use_codex",
    resource: { kind: "project", id: "project-1" },
    risk: "high",
    maxUses: 2,
    maxTokens,
    issuedAt: 100,
    expiresAt: 10_000,
  });
}

describe("governed Control Director Codex adapter", () => {
  it("keeps conversation and passing routine work local", () => {
    expect(
      prepareGovernedControlDirectorCodexEscalation({
        profile: resolvePccExecutionProfilePreset("balanced"),
        mission,
        actorId: "program-manager",
        resourceId: "project-1",
        workClass: "conversation",
        state: "No work state.",
      }).route,
    ).toBe("local");
    expect(
      prepareGovernedControlDirectorCodexEscalation({
        profile: resolvePccExecutionProfilePreset("balanced"),
        mission,
        actorId: "program-manager",
        resourceId: "project-1",
        workClass: "routine",
        localAttempted: true,
        localQualityScore: 97,
        state: "Local result passed.",
      }).route,
    ).toBe("local");
  });

  it("fails closed when local quality is low and Codex is off", () => {
    expect(
      prepareGovernedControlDirectorCodexEscalation({
        profile: resolvePccExecutionProfilePreset("local_focused"),
        mission,
        actorId: "program-manager",
        resourceId: "project-1",
        workClass: "hard_work",
        localAttempted: true,
        localQualityScore: 80,
        state: "Local result failed the quality gate.",
      }),
    ).toMatchObject({ route: "blocked", code: "local_quality_below_gate" });
  });

  it("consumes a scoped approval and emits a bounded typed packet", () => {
    const decision = prepareGovernedControlDirectorCodexEscalation({
      profile: resolvePccExecutionProfilePreset("ultra_hybrid"),
      mission,
      actorId: "program-manager",
      resourceId: "project-1",
      workClass: "hard_work",
      localAttempted: true,
      localQualityScore: 85,
      state: "Current compact state.",
      evidence: ["test failed on local route"],
      constraints: ["no publish"],
      approvals: [approval()],
      estimatedTokens: 4_000,
      now: 500,
    });
    expect(decision).toMatchObject({
      route: "codex",
      modelId: "best_available",
      effort: "max",
      role: "lead",
      approval: { budget: { usedCount: 1, usedTokens: 4_000 } },
      packet: {
        schemaVersion: 1,
        mission: { missionId: "mission-codex" },
        acceptanceCriteria: ["targeted tests pass"],
      },
    });
    expect(decision.route === "codex" && JSON.stringify(decision.packet)).not.toContain(
      "transcript line one",
    );
  });

  it("rejects token-budget overrun without dispatch", () => {
    expect(
      prepareGovernedControlDirectorCodexEscalation({
        profile: resolvePccExecutionProfilePreset("balanced"),
        mission,
        actorId: "program-manager",
        resourceId: "project-1",
        workClass: "checkpoint",
        state: "Checkpoint ready.",
        approvals: [approval(1_000)],
        estimatedTokens: 4_000,
        now: 500,
      }),
    ).toMatchObject({
      route: "blocked",
      code: "approval_denied",
      approvalDecision: { code: "token_budget_exhausted" },
    });
  });
});

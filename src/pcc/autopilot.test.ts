import { describe, expect, it } from "vitest";
import type { PccMilestone, PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import {
  applyPccAutopilotPermissionRepair,
  applyPccAutopilotPermissionAction,
  buildPccAutopilotContextPack,
  buildPccAutopilotPermissionForecast,
  configurePccAutopilotMode,
  defaultPccAutopilotState,
  getPccAutopilotState,
  revokePccAutopilotPermissionGrant,
  runPccAutopilotSafeStubSet,
  updatePccAutopilotPromptSlot,
  withPccAutopilotState,
} from "./autopilot.js";
import { resolvePccExecutionProfilePreset } from "./execution-profile.js";

const now = "2026-07-07T12:00:00.000Z";
const project: PccProject = {
  id: "project-autopilot",
  title: "Autopilot Test Project",
  goal: "Prove safe loop behavior.",
  status: "active",
  createdAt: now,
  updatedAt: now,
};
const milestone: PccMilestone = {
  id: "milestone-autopilot",
  projectId: project.id,
  title: "Verify loop",
  status: "not_started",
  order: 10,
  blocker: "Manual verification pending",
  implementationPlan: "Run loop proof.",
  acceptanceCriteria: ["Run history exists"],
  createdAt: now,
  updatedAt: now,
  metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
};

function input() {
  return {
    project,
    milestones: [milestone],
    subMilestones: [],
    permissions: [],
    evidence: [],
    decisions: [],
  };
}

describe("PCC Autopilot Project Loop", () => {
  it("creates durable default state with editable prompt slots", () => {
    const state = defaultPccAutopilotState(input(), now);
    expect(state.status).toBe("off");
    expect(state.mode).toBe("full_build_review");
    expect(state.promptSlots.length).toBeGreaterThan(0);
    expect(state.promptSlots.length).toBeLessThanOrEqual(5);
    expect(state.promptSlots.some((slot) => slot.enabled)).toBe(true);
    expect(state.approvalPolicy.allowHighRisk).toBe(false);
  });

  it("generates context packs with blockers and safety rules", () => {
    const state = defaultPccAutopilotState(input(), now);
    const context = buildPccAutopilotContextPack(input(), state);
    expect(context.projectSummary).toContain("Autopilot Test Project");
    expect(context.blockers.join("\n")).toContain("Manual verification pending");
    expect(context.forbiddenActions.join("\n")).toContain("Do not spend Codex");
    expect(context.approvalRules.join("\n")).toContain("focused local execution");
    expect(context.forbiddenActions).toContain("Do not invoke Codex for this project profile.");
  });

  it("inherits the one project execution profile without broadening Codex", () => {
    const hybridProject = {
      ...project,
      metadata: { pccExecutionProfile: resolvePccExecutionProfilePreset("ultra_hybrid") },
    };
    const context = buildPccAutopilotContextPack(
      { ...input(), project: hybridProject },
      defaultPccAutopilotState({ ...input(), project: hybridProject }, now),
    );

    expect(context.approvalRules.join("\n")).toContain("ultra local execution");
    expect(context.approvalRules.join("\n")).toContain("allows Codex only as lead");
    expect(context.forbiddenActions).toContain(
      "Do not broaden Codex beyond the project profile or its scoped grant.",
    );
  });

  it("runs safe stub execution without live token spend or file changes", () => {
    const configured = configurePccAutopilotMode(
      input(),
      defaultPccAutopilotState(input(), now),
      "ui_ux_polish",
      now,
    );
    const result = runPccAutopilotSafeStubSet(input(), configured, now);
    expect(result.status).toBe("completed");
    expect(result.totalPromptIterations).toBeGreaterThan(0);
    expect(result.runHistory[0]?.executor).toBe("safe_stub");
    expect(result.runHistory.flatMap((run) => run.changedFiles)).toEqual([]);
    expect(result.finalReport?.remainingRisks.join("\n")).toContain("Safe stub mode");
    expect(result.executionMode).toBe("simulation");
    expect(result.finalReport?.healthierThanBefore).toBe(false);
    expect(result.latestJudgeResult?.summary).toContain("simulation record only");
  });

  it("forecasts medium-risk approval before full build review starts", () => {
    const configured = configurePccAutopilotMode(
      input(),
      defaultPccAutopilotState(input(), now),
      "full_build_review",
      now,
    );
    const forecast = buildPccAutopilotPermissionForecast(configured);
    expect(forecast.required).toBe(true);
    expect(forecast.requiredTier).toBe("medium");
    expect(forecast.promptTitles).toContain("Review build");

    const result = runPccAutopilotSafeStubSet(input(), configured, now);
    expect(result.status).toBe("needs_approval");
    expect(result.currentBlocker?.type).toBe("needs_approval");
    expect(result.runHistory).toHaveLength(0);
    expect(result.latestJudgeResult?.status).toBe("failed");
    expect(result.permissionQueue[0]?.status).toBe("pending");
    expect(result.permissionQueue[0]?.riskTier).toBe("medium");
  });

  it("runs after scoped Autopilot approval is granted", () => {
    const configured = configurePccAutopilotMode(
      input(),
      defaultPccAutopilotState(input(), now),
      "full_build_review",
      now,
    );
    const approved = applyPccAutopilotPermissionAction(
      configured,
      "allow_medium_risk",
      "2026-07-07T12:01:00.000Z",
      project.id,
    );
    const forecast = buildPccAutopilotPermissionForecast(approved);
    expect(forecast.required).toBe(false);
    expect(approved.permissionGrants[0]?.status).toBe("active");
    expect(approved.permissionGrants[0]?.riskTier).toBe("medium");

    const result = runPccAutopilotSafeStubSet(input(), approved, now);
    expect(result.status).toBe("completed");
    expect(result.runHistory.length).toBeGreaterThan(0);
    expect(result.runHistory[0]?.approvals.join("\\n")).toContain("medium-risk");
  });

  it("durably revokes grants so elevated prompts require approval again", () => {
    const configured = configurePccAutopilotMode(
      input(),
      defaultPccAutopilotState(input(), now),
      "full_build_review",
      now,
    );
    const approved = applyPccAutopilotPermissionAction(
      configured,
      "allow_medium_risk",
      "2026-07-07T12:01:00.000Z",
      project.id,
    );
    const grantId = approved.permissionGrants[0]?.id ?? "";
    const revoked = revokePccAutopilotPermissionGrant(
      approved,
      grantId,
      "2026-07-07T12:02:00.000Z",
    );
    expect(revoked.permissionGrants[0]?.status).toBe("revoked");
    expect(buildPccAutopilotPermissionForecast(revoked).required).toBe(true);
  });

  it("denial creates a safe repair preview and applying it lowers prompts to low risk", () => {
    const configured = configurePccAutopilotMode(
      input(),
      defaultPccAutopilotState(input(), now),
      "full_build_review",
      now,
    );
    const queued = runPccAutopilotSafeStubSet(input(), configured, now);
    const denied = applyPccAutopilotPermissionAction(
      queued,
      "deny_permission",
      "2026-07-07T12:03:00.000Z",
      project.id,
    );
    expect(denied.status).toBe("blocked");
    expect(denied.permissionQueue[0]?.status).toBe("denied");
    expect(denied.permissionRepair?.status).toBe("preview");
    expect(denied.latestJudgeResult?.status).toBe("failed");

    const repaired = applyPccAutopilotPermissionRepair(denied, "2026-07-07T12:04:00.000Z");
    expect(repaired.status).toBe("ready");
    expect(repaired.permissionRepair?.status).toBe("applied");
    expect(buildPccAutopilotPermissionForecast(repaired).required).toBe(false);
    expect(
      repaired.promptSlots
        .filter((slot) => slot.enabled)
        .every((slot) => slot.approvalTier === "low"),
    ).toBe(true);
  });

  it("persists edited prompt versions in project metadata", () => {
    const state = defaultPccAutopilotState(input(), now);
    const slot = state.promptSlots[0];
    const edited = updatePccAutopilotPromptSlot(state, slot.id, { promptBody: "New prompt" }, now);
    expect(edited.promptSlots[0]?.version).toBe(slot.version + 1);
    const projectWithState = withPccAutopilotState(project, edited);
    const reloaded = getPccAutopilotState({ ...input(), project: projectWithState }, now);
    expect(reloaded.promptSlots[0]?.promptBody).toBe("New prompt");
  });
});

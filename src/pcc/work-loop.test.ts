import { describe, expect, it } from "vitest";
import type {
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  buildMilestoneTaskPrompt,
  classifyMilestoneBlocker,
  getPccWorkLoopNext,
  getPccWorkLoopSettings,
  selectNextEligibleMilestone,
  withPccWorkLoopSettings,
} from "./work-loop.js";

const project: PccProject = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Track projects",
  status: "active",
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

function milestone(patch: Partial<PccMilestone> = {}): PccMilestone {
  return {
    id: "milestone-1",
    projectId: "project-1",
    title: "Local proof",
    status: "not_started",
    order: 1,
    implementationPlan: "Run the local proof commands.",
    acceptanceCriteria: ["Tests pass", "Build passes"],
    createdAt: "2026-06-26T00:00:00Z",
    updatedAt: "2026-06-26T00:00:00Z",
    ...patch,
  };
}

function permission(patch: Partial<PccPermissionGrant> = {}): PccPermissionGrant {
  return {
    id: "permission-1",
    projectId: "project-1",
    milestoneId: "milestone-1",
    type: "remote_proof",
    status: "needed",
    riskLevel: "medium",
    allowedActions: ["run Workflow Sanity"],
    usedCount: 0,
    auditLog: [],
    createdAt: "2026-06-26T00:00:00Z",
    updatedAt: "2026-06-26T00:00:00Z",
    ...patch,
  };
}

function subMilestone(patch: Partial<PccSubMilestone> = {}): PccSubMilestone {
  return {
    id: "submilestone-1",
    projectId: "project-1",
    milestoneId: "milestone-1",
    title: "Run local test",
    status: "not_started",
    order: 1,
    implementationPlan: "Run the exact local test command.",
    acceptanceCriteria: ["Test exits 0", "Receipt is recorded"],
    createdAt: "2026-06-26T00:00:00Z",
    updatedAt: "2026-06-26T00:00:00Z",
    ...patch,
  };
}

describe("PCC guided work loop", () => {
  it("selects the next eligible milestone in order", () => {
    const done = milestone({ id: "done", status: "complete", receiptIds: ["receipt-1"], order: 0 });
    const second = milestone({ id: "second", title: "Second", order: 2 });
    const first = milestone({ id: "first", title: "First", order: 1 });

    expect(selectNextEligibleMilestone({ project, milestones: [done, second, first] })?.id).toBe(
      "first",
    );
  });

  it("stops on missing permission", () => {
    const item = milestone({ permissionGrantIds: ["permission-1"] });
    const blocker = classifyMilestoneBlocker(
      { project, milestones: [item], permissions: [permission()] },
      item,
    );

    expect(blocker?.kind).toBe("missing_permission");
    expect(blocker?.permissionIds).toEqual(["permission-1"]);
  });

  it("stops before Codex when configured", () => {
    const item = milestone({ metadata: { requiresCodex: true } });
    const blocker = classifyMilestoneBlocker(
      { project, milestones: [item], permissions: [] },
      item,
    );

    expect(blocker?.kind).toBe("codex_required");
  });

  it("stops before remote proof when configured", () => {
    const item = milestone({ permissionGrantIds: ["permission-1"] });
    const blocker = classifyMilestoneBlocker(
      { project, milestones: [item], permissions: [permission({ status: "granted" })] },
      item,
    );

    expect(blocker?.kind).toBe("remote_proof_required");
  });

  it("stops before Codex and remote proof from responsibility metadata", () => {
    const codex = milestone({
      metadata: { pccResponsibility: "high_reasoning_codex", pccCostRisk: "high" },
    });
    const remote = milestone({
      metadata: { pccResponsibility: "remote_proof", pccCostRisk: "medium" },
    });

    expect(classifyMilestoneBlocker({ project, milestones: [codex] }, codex)?.kind).toBe(
      "codex_required",
    );
    expect(classifyMilestoneBlocker({ project, milestones: [remote] }, remote)?.kind).toBe(
      "remote_proof_required",
    );
    expect(buildMilestoneTaskPrompt({ project, milestones: [codex] }, codex)).toContain(
      "Responsible worker: high_reasoning_codex",
    );
    expect(buildMilestoneTaskPrompt({ project, milestones: [codex] }, codex)).toContain(
      "Token/cost risk: high",
    );
  });

  it("stops on missing plans and acceptance criteria", () => {
    expect(
      classifyMilestoneBlocker({ project, milestones: [] }, milestone({ implementationPlan: "" }))
        ?.kind,
    ).toBe("missing_plan");
    expect(
      classifyMilestoneBlocker({ project, milestones: [] }, milestone({ acceptanceCriteria: [] }))
        ?.kind,
    ).toBe("missing_acceptance_criteria");
  });

  it("builds a deterministic task prompt", () => {
    const prompt = buildMilestoneTaskPrompt({ project, milestones: [milestone()] }, milestone());

    expect(prompt).toContain("Project: Project Command Center");
    expect(prompt).toContain("Milestone: Local proof");
    expect(prompt).toContain("Completion rule: do not mark this work item complete");
  });

  it("returns a next task when safe and unblocked", () => {
    const next = getPccWorkLoopNext({ project, milestones: [milestone()] });

    expect(next.state).toBe("working");
    expect(next.taskPrompt).toContain("Run the local proof commands.");
  });

  it("uses sub-milestones before parent milestone work", () => {
    const next = getPccWorkLoopNext({
      project,
      milestones: [milestone()],
      subMilestones: [subMilestone()],
    });

    expect(next.state).toBe("working");
    expect(next.subMilestone?.title).toBe("Run local test");
    expect(next.taskPrompt).toContain("Sub-milestone: Run local test");
    expect(next.taskPrompt).toContain("Run the exact local test command.");
  });

  it("blocks disabled lanes for sub-milestones", () => {
    const updatedProject = withPccWorkLoopSettings(
      project,
      {
        enabled: true,
        state: "working",
        lanes: {
          user: true,
          localOpenClawAgent: false,
          localModel: true,
          codex: false,
          highReasoningCodex: false,
          remoteProof: false,
        },
      },
      "2026-06-26T01:00:00Z",
    );
    const next = getPccWorkLoopNext({
      project: updatedProject,
      milestones: [milestone()],
      subMilestones: [subMilestone()],
    });

    expect(next.state).toBe("blocked");
    expect(next.blocker?.kind).toBe("lane_disabled");
    expect(next.blocker?.subMilestoneId).toBe("submilestone-1");
  });

  it("persists work-loop settings in project metadata", () => {
    const updated = withPccWorkLoopSettings(
      project,
      { enabled: true, state: "working", stopBeforeCodex: true },
      "2026-06-26T01:00:00Z",
    );

    expect(getPccWorkLoopSettings(updated)).toMatchObject({
      enabled: true,
      state: "working",
      stopBeforeCodex: true,
    });
  });
});

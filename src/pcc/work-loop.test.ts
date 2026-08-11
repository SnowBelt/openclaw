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

  it("stops before destructive actions when configured", () => {
    const item = milestone({ metadata: { pccDestructiveAction: true } });
    const blocker = classifyMilestoneBlocker({ project, milestones: [item] }, item);

    expect(blocker?.kind).toBe("destructive_action_required");
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

  it("uses legacy recommendedWorker responsibility metadata", () => {
    const codex = milestone({
      metadata: { recommendedWorker: "High reasoning Codex", pccCostRisk: "high" },
    });

    expect(classifyMilestoneBlocker({ project, milestones: [codex] }, codex)?.kind).toBe(
      "codex_required",
    );
    expect(buildMilestoneTaskPrompt({ project, milestones: [codex] }, codex)).toContain(
      "Responsible worker: high_reasoning_codex",
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

  it("carries the versioned capability and 93-point quality gates into the task prompt", () => {
    const contractedProject: PccProject = {
      ...project,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccCapabilityContract: { schema: "openclaw.pcc.capability-contract.v1" },
      },
    };
    const item = milestone({
      phaseId: "mvp",
      metadata: {
        pccCapabilityContractSchema: "openclaw.pcc.capability-contract.v1",
        pccCapabilityRequirementIds: ["targeted-proof"],
      },
    });
    const prompt = buildMilestoneTaskPrompt(
      { project: contractedProject, milestones: [item] },
      item,
    );

    expect(prompt).toContain("Capability preflight:");
    expect(prompt).toContain("Required proof: targeted-proof — planned");
    expect(prompt).toContain("Minimum score: 93/100");
    expect(prompt).toContain("first_pass_quality");
    expect(prompt).toContain("recoverability");
  });

  it("fails closed when a required external capability is not proven available", () => {
    const contractedProject: PccProject = {
      ...project,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccRequiredSkills: ["required-review-skill"],
        pccCapabilityContract: { schema: "openclaw.pcc.capability-contract.v1" },
      },
    };
    const item = milestone({
      phaseId: "tools-skills",
      metadata: {
        pccCapabilityContractSchema: "openclaw.pcc.capability-contract.v1",
        pccCapabilityRequirementIds: ["capability-preflight", "required-review-skill"],
      },
    });

    expect(
      classifyMilestoneBlocker({ project: contractedProject, milestones: [item] }, item),
    ).toMatchObject({
      kind: "missing_capability",
      message: "Capability preflight is blocked: required-review-skill.",
    });
    expect(
      classifyMilestoneBlocker(
        {
          project: contractedProject,
          milestones: [item],
          capabilityInventory: [{ id: "required-review-skill", kind: "skill", status: "ready" }],
        },
        item,
      ),
    ).toBeNull();
  });

  it("returns a next task when safe and unblocked", () => {
    const next = getPccWorkLoopNext({ project, milestones: [milestone()] });

    expect(next.state).toBe("working");
    expect(next.taskPrompt).toContain("Run the local proof commands.");
  });

  it("blocks automation when the project setup quality gate is not passing", () => {
    const gatedProject: PccProject = {
      ...project,
      metadata: {
        pccQualityGate: { status: "missing" },
        pccSetupScore: { score: 55, runnable: false },
      },
    };
    const next = getPccWorkLoopNext({ project: gatedProject, milestones: [milestone()] });

    expect(next.state).toBe("blocked");
    expect(next.blocker?.kind).toBe("setup_not_ready");
    expect(next.blocker?.message).toContain("40/100");
    expect(next.blocker?.message).toContain("Required intake answer missing: Goal.");
  });

  it("does not trust stale passing setup metadata when recomputed setup is missing", () => {
    const staleProject: PccProject = {
      ...project,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccQualityGate: { status: "passing" },
        pccSetupScore: { score: 100, runnable: true },
        pccIntake: {
          approved: true,
          answers: {
            goal: "Track projects.",
            firstDeliverable: "A dashboard.",
            doneProof: "Tests pass.",
            constraints: "No destructive actions.",
            owner: "local_openclaw_agent",
            blockers: "None.",
          },
        },
      },
    };
    const next = getPccWorkLoopNext({
      project: staleProject,
      milestones: [milestone({ metadata: { pccProofLevel: "local" } })],
      subMilestones: [],
    });

    expect(next.state).toBe("blocked");
    expect(next.blocker?.kind).toBe("setup_not_ready");
    expect(next.blocker?.message).toContain("has no sub-milestones");
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

  it("routes around soft blockers when continue around blockers is enabled", () => {
    const blocked = milestone({ id: "blocked", title: "Blocked", status: "blocked", order: 1 });
    const ready = milestone({ id: "ready", title: "Ready", order: 2 });

    const next = getPccWorkLoopNext({ project, milestones: [blocked, ready] });

    expect(next.state).toBe("working");
    expect(next.milestone?.id).toBe("ready");
  });

  it("stops on soft blockers when continue around blockers is disabled", () => {
    const configured = withPccWorkLoopSettings(
      project,
      { continueAroundBlockers: false },
      "2026-06-26T01:00:00Z",
    );
    const blocked = milestone({ id: "blocked", title: "Blocked", status: "blocked", order: 1 });
    const ready = milestone({ id: "ready", title: "Ready", order: 2 });

    const next = getPccWorkLoopNext({ project: configured, milestones: [blocked, ready] });

    expect(next.state).toBe("blocked");
    expect(next.milestone?.id).toBe("blocked");
  });

  it("stops after a Stop Here milestone is complete", () => {
    const stop = milestone({
      id: "stop",
      title: "Human review gate",
      status: "complete",
      receiptIds: ["receipt-1"],
      order: 1,
      metadata: { pccStopHere: true },
    });
    const later = milestone({ id: "later", title: "Later", order: 2 });

    const next = getPccWorkLoopNext({ project, milestones: [stop, later] });

    expect(next.state).toBe("blocked");
    expect(next.blocker?.kind).toBe("stop_after_current");
    expect(next.blocker?.message).toContain("Stop Here was reached");
  });

  it("persists work-loop settings in project metadata", () => {
    const updated = withPccWorkLoopSettings(
      project,
      { enabled: true, state: "working", stopBeforeCodex: true, continueAroundBlockers: false },
      "2026-06-26T01:00:00Z",
    );

    expect(getPccWorkLoopSettings(updated)).toMatchObject({
      enabled: true,
      state: "working",
      stopBeforeCodex: true,
      stopBeforeDestructiveAction: true,
      continueAroundBlockers: false,
    });
  });
});

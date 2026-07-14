import { describe, expect, it } from "vitest";
import {
  accountPccExecutionFanIn,
  assessPccExecutionPlanCompletion,
  canTransitionPccExecutionPlan,
  completePccExecutionPlan,
  createPccExecutionPlan,
  findDuplicateActivePccExecutionPlan,
  findPccExecutionWorkspaceLeaseCollision,
  isPccExecutionWorkspaceLeaseExpired,
  partitionPccExecutionTasks,
  transitionPccExecutionPlan,
} from "./execution-plan.js";
import { resolvePccExecutionProfilePreset } from "./execution-profile.js";
import {
  PCC_EXECUTION_QUALITY_REQUIREMENTS,
  buildPccExecutionStandard,
} from "./execution-standard.js";

const coordinator = { sessionId: "session-1", runId: "run-1" };

function plan(id = "plan-1") {
  return createPccExecutionPlan({
    id,
    projectId: "project-1",
    projectRevision: "revision-1",
    profile: resolvePccExecutionProfilePreset("local_parallel"),
    coordinator,
    admittedWorkerCount: 2,
  });
}

describe("PCC multi-agent execution plans", () => {
  it("creates a versioned local-only snapshot bound to a project revision and coordinator", () => {
    const created = plan();

    expect(created).toMatchObject({
      schemaVersion: 1,
      mode: "local_only",
      projectId: "project-1",
      projectRevision: "revision-1",
      coordinator,
      admittedWorkerCount: 2,
      status: "prepared",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      auditEvents: [expect.objectContaining({ status: "prepared" })],
    });
    expect(created.profile).not.toBe(resolvePccExecutionProfilePreset("local_parallel"));
  });

  it("snapshots an explicit hybrid profile without invoking a model", () => {
    const executionStandard = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Test PCC",
      availableSkills: [],
    });
    const created = createPccExecutionPlan({
      id: "hybrid",
      projectId: "project-1",
      projectRevision: "revision-2",
      profile: resolvePccExecutionProfilePreset("ultra_hybrid"),
      executionStandard,
      coordinator,
      admittedWorkerCount: 12,
    });

    expect(created.mode).toBe("hybrid");
    expect(created.profile.codexRole).toBe("lead");
    expect(created.executionStandard).toEqual(executionStandard);
    expect(created.executionStandard).not.toBe(executionStandard);
  });

  it("enforces strict legal status transitions", () => {
    const prepared = plan();
    expect(canTransitionPccExecutionPlan("prepared", "running")).toBe(false);
    expect(() => transitionPccExecutionPlan(prepared, "running")).toThrow("illegal PCC");

    const running = transitionPccExecutionPlan(
      transitionPccExecutionPlan(prepared, "dispatching"),
      "running",
    );
    expect(transitionPccExecutionPlan(running, "completed").status).toBe("completed");
    expect(canTransitionPccExecutionPlan("completed", "running")).toBe(false);
  });

  it("prevents another active plan for the same project across revisions", () => {
    const active = transitionPccExecutionPlan(plan("active"), "dispatching");
    const candidate = { ...plan("candidate"), projectRevision: "revision-2" };

    expect(findDuplicateActivePccExecutionPlan([active], candidate)?.id).toBe("active");
    const completed = transitionPccExecutionPlan(
      transitionPccExecutionPlan(active, "running"),
      "completed",
    );
    expect(findDuplicateActivePccExecutionPlan([completed], candidate)).toBeUndefined();
  });

  it("partitions only independent tasks deterministically", () => {
    const result = partitionPccExecutionTasks(
      [
        { id: "b", title: "dependent", independent: false },
        { id: "c", title: "third", independent: true },
        { id: "a", title: "first", independent: true, workspaceId: "ws-a" },
      ],
      ["worker-2", "worker-1"],
    );

    expect(result.skippedDependentTaskIds).toEqual(["b"]);
    expect(result.partitions).toEqual([
      expect.objectContaining({ id: "partition:a", workerId: "worker-1", workspaceId: "ws-a" }),
      expect.objectContaining({ id: "partition:c", workerId: "worker-2" }),
    ]);
    expect(() =>
      partitionPccExecutionTasks([{ id: "a", title: "A", independent: true }], []),
    ).toThrow("at least one worker");
  });

  it("detects live workspace lease collisions and expires malformed or elapsed leases", () => {
    const lease = {
      workspaceId: "workspace-a",
      planId: "other-plan",
      partitionId: "partition-a",
      holderId: "worker-a",
      acquiredAt: "2026-07-13T12:00:00.000Z",
      expiresAt: "2026-07-13T13:00:00.000Z",
    };
    const now = "2026-07-13T12:30:00.000Z";

    expect(isPccExecutionWorkspaceLeaseExpired(lease, now)).toBe(false);
    expect(
      findPccExecutionWorkspaceLeaseCollision(
        [lease],
        { workspaceId: "workspace-a", planId: "new", partitionId: "new" },
        now,
      ),
    ).toEqual(lease);
    expect(isPccExecutionWorkspaceLeaseExpired({ ...lease, expiresAt: "bad" }, now)).toBe(true);
    expect(
      findPccExecutionWorkspaceLeaseCollision(
        [{ ...lease, expiresAt: "2026-07-13T12:00:00.000Z" }],
        { workspaceId: "workspace-a", planId: "new", partitionId: "new" },
        now,
      ),
    ).toBeUndefined();
  });

  it("accounts for fan-in and never auto-completes PCC milestones", () => {
    const partitions = [
      { status: "succeeded" as const },
      { status: "failed" as const },
      { status: "running" as const },
    ];
    expect(accountPccExecutionFanIn(partitions)).toMatchObject({
      expected: 3,
      succeeded: 1,
      failed: 1,
      incomplete: 1,
      readyForFanIn: false,
    });

    const assessment = assessPccExecutionPlanCompletion(
      {
        partitions: [{ status: "succeeded" }],
        proofRequirements: [
          { milestoneId: "milestone-1", proofId: "proof-a", description: "targeted test" },
        ],
      },
      ["proof-a"],
    );
    expect(assessment).toMatchObject({
      canCompletePlan: true,
      canAutoCompleteMilestones: false,
      milestoneIdsRequiringExplicitCompletion: ["milestone-1"],
    });
    expect(
      assessPccExecutionPlanCompletion(
        { partitions: [{ status: "cancelled" }], proofRequirements: [] },
        [],
      ).canCompletePlan,
    ).toBe(false);
  });

  it("requires all 93+ quality evidence and an independent judge for canonical plan completion", () => {
    const executionStandard = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Verify PCC execution",
      availableSkills: [],
    });
    const proofRequirements = PCC_EXECUTION_QUALITY_REQUIREMENTS.map((requirement) => ({
      milestoneId: "milestone-1",
      proofId: `proof:${requirement.id}`,
      description: requirement.label,
      qualityRequirementId: requirement.id,
    }));
    const satisfied = proofRequirements.map((requirement) => requirement.proofId);
    const canonicalPlan = {
      executionStandard,
      partitions: [{ status: "succeeded" as const }],
      proofRequirements,
    };

    const noJudge = assessPccExecutionPlanCompletion(canonicalPlan, satisfied);
    expect(noJudge.canCompletePlan).toBe(false);
    expect(noJudge.qualityAssessment).toMatchObject({ judgePassed: false, minimumScore: 93 });

    const passed = assessPccExecutionPlanCompletion(canonicalPlan, satisfied, {
      judgePassed: true,
    });
    expect(passed.canCompletePlan).toBe(true);
    expect(passed.qualityAssessment).toMatchObject({ passed: true, minimumScore: 100 });

    const missingQaProofId = proofRequirements.find(
      (requirement) => requirement.qualityRequirementId === "manual_or_browser_verified",
    )?.proofId;
    const missingQa = assessPccExecutionPlanCompletion(
      canonicalPlan,
      satisfied.filter((proofId) => proofId !== missingQaProofId),
      { judgePassed: true },
    );
    expect(missingQa.canCompletePlan).toBe(false);
    expect(missingQa.missingProofIds).toContain(missingQaProofId);
    expect(missingQa.qualityAssessment?.scores.qa).toBeLessThan(93);

    let running = createPccExecutionPlan({
      id: "canonical-completion",
      projectId: "project-1",
      projectRevision: "revision-1",
      profile: resolvePccExecutionProfilePreset("local_focused"),
      executionStandard,
      coordinator,
      admittedWorkerCount: 1,
      partitions: [
        { id: "partition-1", taskId: "task-1", workerId: "worker-1", status: "succeeded" },
      ],
      proofRequirements,
    });
    running = transitionPccExecutionPlan(running, "dispatching");
    running = transitionPccExecutionPlan(running, "running");
    expect(() => transitionPccExecutionPlan(running, "completed")).toThrow(
      "must use completePccExecutionPlan",
    );
    expect(
      completePccExecutionPlan(running, satisfied, {
        judgePassed: true,
        reason: "Quality and judge proof passed",
      }),
    ).toMatchObject({ status: "completed", statusReason: "Quality and judge proof passed" });
  });

  it("allows multiple partitions per admitted worker and rejects too many distinct workers", () => {
    const sharedWorker = createPccExecutionPlan({
      id: "shared-worker",
      projectId: "project",
      projectRevision: "revision",
      profile: resolvePccExecutionProfilePreset("local_focused"),
      coordinator,
      admittedWorkerCount: 1,
      partitions: [
        { id: "p1", taskId: "t1", workerId: "w1", status: "pending" },
        { id: "p2", taskId: "t2", workerId: "w1", status: "pending" },
      ],
    });
    expect(sharedWorker.partitions).toHaveLength(2);

    expect(() =>
      createPccExecutionPlan({
        id: "too-many",
        projectId: "project",
        projectRevision: "revision",
        profile: resolvePccExecutionProfilePreset("local_focused"),
        coordinator,
        admittedWorkerCount: 1,
        partitions: [
          { id: "p1", taskId: "t1", workerId: "w1", status: "pending" },
          { id: "p2", taskId: "t2", workerId: "w2", status: "pending" },
        ],
      }),
    ).toThrow("distinct partition workers cannot exceed");
  });

  it("records transition reasons in a bounded append-only audit trail", () => {
    let current = plan("audited");
    current = transitionPccExecutionPlan(current, "dispatching", {
      reason: "Saved before dispatch",
    });
    current = transitionPccExecutionPlan(current, "running", { reason: "Coordinator accepted" });

    expect(current.statusReason).toBe("Coordinator accepted");
    expect(current.auditEvents.map((entry) => entry.status)).toEqual([
      "prepared",
      "dispatching",
      "running",
    ]);
  });
});

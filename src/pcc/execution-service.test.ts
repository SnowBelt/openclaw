import { describe, expect, it } from "vitest";
import type {
  PccMilestone,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  findNextPccExecutionCandidate,
  pccExecutionPlanId,
  pccExecutionPlansFromProject,
  repairPccExecutionMetadata,
} from "./execution-service.js";

const project: PccProject = {
  id: "project-1",
  title: "Family Fighters SNES MVP",
  status: "active",
  revision: 4,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

function milestone(patch: Partial<PccMilestone> = {}): PccMilestone {
  return {
    id: "milestone-1",
    projectId: project.id,
    title: "Build the foundation",
    status: "not_started",
    phaseId: "setup",
    order: 0,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...patch,
  };
}

function subMilestone(patch: Partial<PccSubMilestone> = {}): PccSubMilestone {
  return {
    id: "submilestone-1",
    projectId: project.id,
    milestoneId: "milestone-1",
    title: "Verify the local toolchain",
    status: "not_started",
    order: 0,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...patch,
  };
}

describe("PCC execution metadata boundary", () => {
  it("repairs legacy parallelSafe metadata without changing progress", () => {
    const item = milestone({
      percentComplete: 12,
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccParallelSafe: true,
      },
    });

    const repaired = repairPccExecutionMetadata(project.id, item);

    expect(repaired.issueCodes).toEqual([
      "PCC_EXECUTION_LEGACY_PARALLEL_SAFE",
      "PCC_EXECUTION_WORKSPACE_LEASE_MISSING",
    ]);
    expect(repaired.item).toMatchObject({
      id: item.id,
      status: item.status,
      percentComplete: item.percentComplete,
      metadata: {
        pccParallelSafe: true,
        parallelSafe: true,
        workspaceLock: "pcc:project-1:setup:milestone:milestone-1",
      },
    });
  });

  it("fails closed for dependent or non-local work", () => {
    const dependent = milestone({
      dependsOn: ["other-milestone"],
      metadata: { pccResponsibility: "local_openclaw_agent", pccParallelSafe: true },
    });
    const remote = milestone({
      id: "remote-milestone",
      metadata: { pccResponsibility: "remote_proof", parallelSafe: true },
    });

    expect(repairPccExecutionMetadata(project.id, dependent).item.metadata).toMatchObject({
      pccParallelSafe: true,
      parallelSafe: false,
    });
    expect(repairPccExecutionMetadata(project.id, remote).item.metadata).toMatchObject({
      parallelSafe: false,
    });
    expect(repairPccExecutionMetadata(project.id, remote).issueCodes).toContain(
      "PCC_EXECUTION_PARALLEL_SAFE_INVALID",
    );
  });

  it("does not let a canonical false value inherit a legacy affirmative flag", () => {
    const item = milestone({
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccParallelSafe: true,
        parallelSafe: false,
      },
    });

    const repaired = repairPccExecutionMetadata(project.id, item);

    expect(repaired.item.metadata).toMatchObject({
      pccParallelSafe: true,
      parallelSafe: false,
    });
    expect(repaired.item.metadata).not.toHaveProperty("workspaceLock");
  });

  it("selects the first source-supported local task and supplies a deterministic lease", () => {
    const selected = findNextPccExecutionCandidate({
      project,
      milestones: [milestone()],
      subMilestones: [
        subMilestone({
          metadata: { pccResponsibility: "local_openclaw_agent", parallelSafe: true },
        }),
      ],
    });

    expect(selected).toMatchObject({
      milestoneId: "milestone-1",
      task: {
        id: "submilestone:submilestone-1",
        independent: true,
        workspaceId: "pcc:project-1:default:submilestone:submilestone-1",
      },
      item: {
        metadata: {
          parallelSafe: true,
          workspaceLock: "pcc:project-1:default:submilestone:submilestone-1",
        },
      },
    });
  });

  it("derives stable idempotency plan ids", () => {
    expect(pccExecutionPlanId(project.id, "ui:project-1:revision:4")).toBe(
      pccExecutionPlanId(project.id, "ui:project-1:revision:4"),
    );
    expect(pccExecutionPlanId(project.id, "ui:project-1:revision:4")).not.toBe(
      pccExecutionPlanId(project.id, "ui:project-1:revision:5"),
    );
  });

  it("ignores malformed persisted plans while preserving a valid lost plan for retry", () => {
    const validLostPlan = {
      schemaVersion: 1,
      id: "lost-plan",
      projectId: project.id,
      projectRevision: "4",
      profile: { speed: "focused" },
      mode: "local_only",
      coordinator: { sessionId: "agent:main:pcc", runId: "run-1" },
      admittedWorkerCount: 1,
      status: "lost",
      partitions: [],
      leases: [],
      proofRequirements: [],
      approvals: [],
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:05:00.000Z",
      auditEvents: [{ at: "2026-08-10T00:05:00.000Z", status: "lost" }],
    };
    const parsed = pccExecutionPlansFromProject({
      ...project,
      metadata: {
        pccExecutionPlans: [
          validLostPlan,
          { ...validLostPlan, id: "bad-status", status: "working" },
          {
            ...validLostPlan,
            id: "bad-partition",
            partitions: [{ id: "p", taskId: "t", workerId: "w", status: "unknown" }],
          },
        ],
      },
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "lost-plan", status: "lost" });
  });
});

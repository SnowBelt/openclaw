import { describe, expect, it } from "vitest";
import type {
  PccMilestone,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { buildPccPortfolioSchedule } from "./portfolio-scheduler.js";
import { withPccWorkLoopSettings } from "./work-loop.js";

function project(id: string, patch: Partial<PccProject> = {}): PccProject {
  const base: PccProject = {
    id,
    title: id,
    status: "active",
    priority: 3,
    createdAt: "2026-06-27T00:00:00Z",
    updatedAt: "2026-06-27T00:00:00Z",
  };
  return withPccWorkLoopSettings(
    { ...base, ...patch },
    { enabled: true, parallelWorkMode: "supervised" },
    "2026-06-27T00:01:00Z",
  );
}

function milestone(projectId: string, patch: Partial<PccMilestone> = {}): PccMilestone {
  return {
    id: `${projectId}-milestone`,
    projectId,
    title: `${projectId} milestone`,
    status: "not_started",
    order: 1,
    implementationPlan: "Do the work.",
    acceptanceCriteria: ["Proof passes"],
    createdAt: "2026-06-27T00:00:00Z",
    updatedAt: "2026-06-27T00:00:00Z",
    ...patch,
  };
}

function subMilestone(projectId: string, patch: Partial<PccSubMilestone> = {}): PccSubMilestone {
  return {
    id: `${projectId}-submilestone`,
    projectId,
    milestoneId: `${projectId}-milestone`,
    title: `${projectId} submilestone`,
    status: "not_started",
    order: 1,
    implementationPlan: "Do the sub-step.",
    acceptanceCriteria: ["Sub proof passes"],
    createdAt: "2026-06-27T00:00:00Z",
    updatedAt: "2026-06-27T00:00:00Z",
    ...patch,
  };
}

describe("PCC portfolio scheduler", () => {
  it("ranks enabled projects by priority and schedules within capacity", () => {
    const low = project("low", { priority: 5 });
    const high = project("high", { priority: 1 });

    const schedule = buildPccPortfolioSchedule(
      [
        { project: low, milestones: [milestone("low")] },
        { project: high, milestones: [milestone("high")] },
      ],
      { maxParallelProjects: 2, availableLocalModelSlots: 2 },
    );

    expect(schedule.ready.map((item) => item.projectId)).toEqual(["high", "low"]);
  });

  it("skips blocked projects and keeps safe projects ready", () => {
    const blocked = project("blocked", { priority: 1 });
    const ready = project("ready", { priority: 2 });

    const schedule = buildPccPortfolioSchedule(
      [
        { project: blocked, milestones: [milestone("blocked", { status: "blocked" })] },
        { project: ready, milestones: [milestone("ready")] },
      ],
      { maxParallelProjects: 2, availableLocalModelSlots: 2 },
    );

    expect(schedule.ready.map((item) => item.projectId)).toEqual(["ready"]);
    expect(schedule.blocked[0]?.kind).toBe("milestone_not_actionable");
  });

  it("enforces max parallel projects", () => {
    const schedule = buildPccPortfolioSchedule(
      [
        { project: project("one", { priority: 1 }), milestones: [milestone("one")] },
        { project: project("two", { priority: 2 }), milestones: [milestone("two")] },
      ],
      { maxParallelProjects: 1, availableLocalModelSlots: 2 },
    );

    expect(schedule.ready).toHaveLength(1);
    expect(schedule.resourceLimited[0]?.kind).toBe("max_parallel_projects");
  });

  it("pauses new starts under high memory pressure", () => {
    const schedule = buildPccPortfolioSchedule(
      [{ project: project("one", { priority: 1 }), milestones: [milestone("one")] }],
      { memoryPressure: "high", availableLocalModelSlots: 2 },
    );

    expect(schedule.ready).toHaveLength(0);
    expect(schedule.resourceLimited[0]?.kind).toBe("memory_pressure");
  });

  it("honors one-at-a-time portfolio policy", () => {
    const schedule = buildPccPortfolioSchedule(
      [
        { project: project("one", { priority: 1 }), milestones: [milestone("one")] },
        { project: project("two", { priority: 2 }), milestones: [milestone("two")] },
      ],
      { policyMode: "one_at_a_time", maxParallelProjects: 8, availableLocalModelSlots: 8 },
    );

    expect(schedule.ready).toHaveLength(1);
    expect(schedule.resourceLimited[0]?.kind).toBe("max_parallel_projects");
  });

  it("respects already active workspace locks", () => {
    const schedule = buildPccPortfolioSchedule(
      [
        {
          project: project("one", { priority: 1 }),
          milestones: [milestone("one", { metadata: { workspaceLock: "shared" } })],
        },
      ],
      { activeWorkspaceLocks: ["shared"] },
    );

    expect(schedule.ready).toHaveLength(0);
    expect(schedule.resourceLimited[0]?.kind).toBe("workspace_locked");
  });

  it("blocks workspace lock conflicts", () => {
    const lockedMetadata = { workspaceLock: "shared", pccResponsibility: "local_openclaw_agent" };
    const schedule = buildPccPortfolioSchedule(
      [
        {
          project: project("one", { priority: 1 }),
          milestones: [milestone("one", { metadata: lockedMetadata })],
        },
        {
          project: project("two", { priority: 2 }),
          milestones: [milestone("two", { metadata: lockedMetadata })],
        },
      ],
      { maxParallelProjects: 2, availableLocalModelSlots: 2 },
    );

    expect(schedule.ready).toHaveLength(1);
    expect(schedule.resourceLimited[0]?.kind).toBe("workspace_locked");
  });

  it("enforces RAM and VRAM budget", () => {
    const schedule = buildPccPortfolioSchedule(
      [
        {
          project: project("gpu", { priority: 1 }),
          milestones: [
            milestone("gpu", {
              metadata: {
                pccResponsibility: "local_model",
                estimatedVramGb: 128,
                estimatedRamGb: 32,
              },
            }),
          ],
        },
      ],
      { availableLocalModelSlots: 1, availableVramGb: 64, availableRamGb: 256 },
    );

    expect(schedule.ready).toHaveLength(0);
    expect(schedule.resourceLimited[0]?.kind).toBe("resource_budget");
  });

  it("uses sub-milestones as the scheduled unit", () => {
    const schedule = buildPccPortfolioSchedule([
      {
        project: project("sub", { priority: 1 }),
        milestones: [milestone("sub")],
        subMilestones: [subMilestone("sub")],
      },
    ]);

    expect(schedule.ready[0]).toMatchObject({
      projectId: "sub",
      title: "sub submilestone",
      subMilestoneId: "sub-submilestone",
    });
  });
});

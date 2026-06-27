import type { PccMilestone, PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import { buildPccPortfolioSchedule } from "../../src/pcc/portfolio-scheduler.js";
import { withPccWorkLoopSettings } from "../../src/pcc/work-loop.js";

function project(id: string, priority: number): PccProject {
  return withPccWorkLoopSettings(
    {
      id,
      title: id,
      status: "active",
      priority,
      createdAt: "2026-06-27T00:00:00Z",
      updatedAt: "2026-06-27T00:00:00Z",
    },
    { enabled: true, parallelWorkMode: "supervised" },
    "2026-06-27T00:01:00Z",
  );
}

function milestone(
  projectId: string,
  status: PccMilestone["status"] = "not_started",
): PccMilestone {
  return {
    id: `${projectId}-milestone`,
    projectId,
    title: `${projectId} work`,
    status,
    order: 1,
    implementationPlan: "Run safe local work.",
    acceptanceCriteria: ["Proof passes"],
    createdAt: "2026-06-27T00:00:00Z",
    updatedAt: "2026-06-27T00:00:00Z",
  };
}

const schedule = buildPccPortfolioSchedule(
  [
    { project: project("blocked", 1), milestones: [milestone("blocked", "blocked")] },
    { project: project("ready", 2), milestones: [milestone("ready")] },
  ],
  {
    maxParallelProjects: 2,
    availableLocalModelSlots: 2,
    availableVramGb: 256,
    availableRamGb: 256,
  },
);

if (schedule.ready.length !== 1 || schedule.ready[0]?.projectId !== "ready") {
  throw new Error("safe project was not scheduled");
}
if (schedule.blocked.length !== 1) {
  throw new Error("blocked project was not recorded");
}

console.log(
  JSON.stringify({ ok: true, ready: schedule.ready.length, blocked: schedule.blocked.length }),
);

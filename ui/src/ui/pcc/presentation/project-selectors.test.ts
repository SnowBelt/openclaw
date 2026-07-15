import { describe, expect, it } from "vitest";
import type { PccMilestone, PccProject, PccProjectSummary, PccSubMilestone } from "../../types.ts";
import type { PccProjectDetail } from "../contracts.ts";
import {
  projectMatchesSearch,
  sortedMilestones,
  subMilestonesForMilestoneId,
} from "./project-selectors.ts";

function fixtureDetail(): PccProjectDetail {
  const updatedAt = "2026-07-15T12:00:00.000Z";
  const project = {
    id: "project-1",
    title: "Performance Project",
    goal: "Keep the dashboard fast",
    status: "active",
    priority: 3,
    metadata: { pccWorkScope: "project_work" },
    createdAt: updatedAt,
    updatedAt,
  } as PccProject;
  const milestones = [
    { id: "milestone-2", projectId: project.id, title: "Second", status: "not_started", order: 20 },
    { id: "milestone-1", projectId: project.id, title: "First", status: "active", order: 10 },
  ] as PccMilestone[];
  const subMilestones = [
    {
      id: "sub-2",
      projectId: project.id,
      milestoneId: "milestone-1",
      title: "Beta",
      status: "not_started",
      order: 20,
    },
    {
      id: "sub-1",
      projectId: project.id,
      milestoneId: "milestone-1",
      title: "Alpha",
      status: "not_started",
      order: 10,
    },
  ] as PccSubMilestone[];
  const summary = {
    id: project.id,
    title: project.title,
    status: project.status,
    percentComplete: 0,
    milestoneCounts: {
      total: 2,
      complete: 0,
      blocked: 0,
      needsApproval: 0,
      deferred: 0,
      skipped: 0,
    },
    nextActions: ["First"],
    proofGaps: [],
    health: "On track",
    updatedAt,
  } as PccProjectSummary;
  return {
    project,
    milestones,
    subMilestones,
    permissions: [],
    evidence: [],
    receipts: [],
    summary,
  };
}

describe("PCC presentation selectors", () => {
  it("reuses sorted milestone and indexed sub-milestone projections", () => {
    const detail = fixtureDetail();
    const firstMilestones = sortedMilestones(detail);
    const secondMilestones = sortedMilestones(detail);
    const firstSubMilestones = subMilestonesForMilestoneId(detail, "milestone-1");
    const secondSubMilestones = subMilestonesForMilestoneId(detail, "milestone-1");

    expect(firstMilestones).toBe(secondMilestones);
    expect(firstMilestones.map((item) => item.id)).toEqual(["milestone-1", "milestone-2"]);
    expect(firstSubMilestones).toBe(secondSubMilestones);
    expect(firstSubMilestones.map((item) => item.id)).toEqual(["sub-1", "sub-2"]);
  });

  it("searches cached project detail text with normalized multi-term queries", () => {
    const detail = fixtureDetail();
    expect(projectMatchesSearch(detail.summary, "  dashboard   ALPHA ", detail)).toBe(true);
    expect(projectMatchesSearch(detail.summary, "dashboard missing", detail)).toBe(false);
  });
});

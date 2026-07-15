import { describe, expect, it } from "vitest";
import type { PccProject, PccProjectSummary } from "../../types.ts";
import type { PccProjectDetail } from "../contracts.ts";
import { rememberPccProjectDetail } from "./detail-cache.ts";

function detail(projectId: string): PccProjectDetail {
  const updatedAt = "2026-07-15T12:00:00.000Z";
  const project = {
    id: projectId,
    title: projectId,
    status: "active",
    priority: 3,
    metadata: {
      pccWorkScope: projectId === "project-command-center" ? "pcc_product" : "project_work",
    },
    createdAt: updatedAt,
    updatedAt,
  } as PccProject;
  const summary = {
    id: projectId,
    title: projectId,
    status: "active",
    percentComplete: 0,
    milestoneCounts: {
      total: 0,
      complete: 0,
      blocked: 0,
      needsApproval: 0,
      deferred: 0,
      skipped: 0,
    },
    nextActions: [],
    proofGaps: [],
    health: "On track",
    updatedAt,
  } as PccProjectSummary;
  return {
    project,
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    summary,
  };
}

describe("PCC project detail cache", () => {
  it("bounds long-session memory while retaining selected and PCC details", () => {
    let cache: Record<string, PccProjectDetail> = {};
    for (const projectId of [
      "project-command-center",
      "project-1",
      "project-2",
      "project-3",
      "project-4",
      "project-5",
    ]) {
      cache = rememberPccProjectDetail(cache, detail(projectId), {
        limit: 4,
        selectedProjectId: "project-2",
      });
    }

    expect(Object.keys(cache)).toHaveLength(4);
    expect(cache["project-command-center"]).toBeDefined();
    expect(cache["project-2"]).toBeDefined();
    expect(cache["project-4"]).toBeDefined();
    expect(cache["project-5"]).toBeDefined();
    expect(cache["project-1"]).toBeUndefined();
  });

  it("treats a reread as recent and evicts the oldest unpinned detail", () => {
    let cache: Record<string, PccProjectDetail> = {};
    for (const projectId of ["project-1", "project-2", "project-3"]) {
      cache = rememberPccProjectDetail(cache, detail(projectId), { limit: 3 });
    }
    cache = rememberPccProjectDetail(cache, cache["project-1"], { limit: 3 });
    cache = rememberPccProjectDetail(cache, detail("project-4"), { limit: 3 });

    expect(Object.keys(cache)).toEqual(["project-3", "project-1", "project-4"]);
    expect(cache["project-2"]).toBeUndefined();
  });
});

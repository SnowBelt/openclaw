import { describe, expect, it } from "vitest";
import type { PccProject, PccProjectSummary } from "../../types.ts";
import type { PccDashboardProps, PccProjectDetail } from "../contracts.ts";
import { buildPccDashboardReadModel } from "./dashboard-read-model.ts";

const updatedAt = "2026-07-15T12:00:00.000Z";

function summary(
  id: string,
  status: PccProjectSummary["status"],
  blocked = false,
): PccProjectSummary {
  return {
    id,
    title: id,
    status,
    percentComplete: 0,
    milestoneCounts: {
      total: 1,
      complete: 0,
      blocked: blocked ? 1 : 0,
      needsApproval: 0,
      deferred: 0,
      skipped: 0,
    },
    nextActions: blocked ? ["Resolve blocker"] : ["Start work"],
    proofGaps: [],
    health: blocked ? "At risk" : "On track",
    updatedAt,
  } as PccProjectSummary;
}

function detail(item: PccProjectSummary, scope: "pcc_product" | "project_work"): PccProjectDetail {
  return {
    project: {
      id: item.id,
      title: item.title,
      status: item.status,
      priority: 3,
      metadata: { pccWorkScope: scope },
      createdAt: updatedAt,
      updatedAt,
    } as PccProject,
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    summary: item,
  };
}

function props(): PccDashboardProps {
  const pcc = summary("project-command-center", "complete_with_maintenance");
  const active = summary("active-project", "active");
  const blocked = summary("blocked-project", "blocked", true);
  const pccDetail = detail(pcc, "pcc_product");
  const activeDetail = detail(active, "project_work");
  const blockedDetail = detail(blocked, "project_work");
  return {
    projects: [pcc, active, blocked],
    projectDetails: {
      [pcc.id]: pccDetail,
      [active.id]: activeDetail,
      [blocked.id]: blockedDetail,
    },
    projectDetail: activeDetail,
    selectedProjectId: active.id,
    productFocusMode: "project_work",
    projectFilter: "active",
    projectSearchQuery: "",
    updatedAt: Date.parse(updatedAt),
  } as PccDashboardProps;
}

describe("PCC dashboard read model", () => {
  it("derives scope, filter counts, attention, and visible projects once", () => {
    const input = props();
    const model = buildPccDashboardReadModel(input, Date.parse(updatedAt));

    expect(model.focusMode).toBe("project_work");
    expect(model.scopedProjects.map((project) => project.id)).toEqual([
      "active-project",
      "blocked-project",
    ]);
    expect(model.filterCounts.active).toBe(2);
    expect(model.filterCounts.needs_you).toBe(1);
    expect(model.attentionProjects.map((project) => project.id)).toEqual(["blocked-project"]);
    expect(model.visibleProjects.map((project) => project.id)).toEqual([
      "active-project",
      "blocked-project",
    ]);
    expect(model.nextBestProject?.id).toBe("blocked-project");
  });

  it("reuses a stable projection and invalidates it when search changes", () => {
    const input = props();
    const now = Date.parse(updatedAt);
    const first = buildPccDashboardReadModel(input, now);
    const second = buildPccDashboardReadModel(input, now + 20_000);
    const searched = buildPccDashboardReadModel(
      { ...input, projectSearchQuery: "active-project" },
      now + 20_000,
    );

    expect(second).toBe(first);
    expect(searched).not.toBe(first);
    expect(searched.visibleProjects.map((project) => project.id)).toEqual(["active-project"]);
  });
});

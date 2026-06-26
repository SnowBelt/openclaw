import { describe, expect, it, vi } from "vitest";
import { loadPccDashboard, type PccDashboardState } from "./pcc.ts";

function createState(overrides: Partial<PccDashboardState> = {}): PccDashboardState {
  return {
    client: null,
    connected: true,
    pccProjects: [],
    pccPortfolioSummary: null,
    pccLoading: false,
    pccError: null,
    pccUpdatedAt: null,
    ...overrides,
  };
}

describe("loadPccDashboard", () => {
  it("loads project list and portfolio summary", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        projects: [
          {
            id: "project-1",
            title: "Project Command Center",
            status: "active",
            percentComplete: 25,
            milestoneCounts: {
              total: 4,
              complete: 1,
              blocked: 0,
              needsApproval: 1,
              deferred: 0,
              skipped: 0,
            },
            nextActions: ["Build UI shell"],
            proofGaps: ["Remote proof"],
            updatedAt: "2026-06-26T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        portfolio: {
          projectsTotal: 1,
          active: 1,
          blocked: 0,
          needsApproval: 1,
          complete: 0,
          archived: 0,
          averagePercentComplete: 25,
          nextActions: ["Build UI shell"],
        },
      });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await loadPccDashboard(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "pcc.summary.get", {});
    expect(state.pccProjects).toHaveLength(1);
    expect(state.pccProjects[0]?.title).toBe("Project Command Center");
    expect(state.pccPortfolioSummary?.averagePercentComplete).toBe(25);
    expect(state.pccLoading).toBe(false);
    expect(state.pccError).toBeNull();
    expect(state.pccUpdatedAt).toEqual(expect.any(Number));
  });

  it("does nothing while disconnected", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      connected: false,
    });

    await loadPccDashboard(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccLoading).toBe(false);
  });

  it("records load failures without clearing existing data", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("gateway offline"));
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjects: [
        {
          id: "existing",
          title: "Existing",
          status: "active",
          percentComplete: 10,
          milestoneCounts: {
            total: 1,
            complete: 0,
            blocked: 0,
            needsApproval: 0,
            deferred: 0,
            skipped: 0,
          },
          nextActions: [],
          proofGaps: [],
          updatedAt: "2026-06-26T00:00:00Z",
        },
      ],
    });

    await expect(loadPccDashboard(state)).resolves.toBeUndefined();

    expect(state.pccProjects).toHaveLength(1);
    expect(state.pccError).toContain("gateway offline");
    expect(state.pccLoading).toBe(false);
  });
});

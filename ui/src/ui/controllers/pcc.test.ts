import { describe, expect, it, vi } from "vitest";
import { getPccState, loadPcc, startPccPlan } from "./pcc.ts";

function createClient() {
  const request = vi.fn(async (method: string) => {
    if (method === "pcc.projects.list") {
      return { projects: [{ id: "project-1", title: "MVP", status: "active" }] };
    }
    if (method === "pcc.projects.get") {
      return {
        project: {
          id: "project-1",
          title: "MVP",
          goal: "Ship a reliable MVP",
          status: "active",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
        milestones: [],
        summary: {
          percentComplete: 0,
          milestoneCounts: { total: 0, complete: 0, blocked: 0, needsApproval: 0 },
        },
      };
    }
    return {
      run: {
        id: "run-1",
        status: "queued",
      },
    };
  });
  return { request };
}

describe("PCC controller", () => {
  it("loads the selected project and notifies after each state transition", async () => {
    const host = {};
    const client = createClient();
    const requestUpdate = vi.fn();

    await loadPcc({ host, client: client as never, requestUpdate });

    expect(client.request).toHaveBeenCalledWith("pcc.projects.list", {});
    expect(client.request).toHaveBeenCalledWith("pcc.projects.get", { projectId: "project-1" });
    expect(getPccState(host)).toMatchObject({
      selectedProjectId: "project-1",
      project: { title: "MVP" },
      loading: false,
    });
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("starts a bounded plan for the selected project and exposes its run", async () => {
    const host = {};
    const client = createClient();
    const state = getPccState(host);
    state.project = { title: "MVP", goal: "Ship a reliable MVP" } as never;
    const requestUpdate = vi.fn();

    await startPccPlan({
      host,
      client: client as never,
      description: "Verify the next MVP milestone",
      requestUpdate,
    });

    expect(client.request).toHaveBeenCalledWith("pcc.plans.start", {
      surface: "project_replan",
      description: "Verify the next MVP milestone",
      existingTitle: "MVP",
      existingGoal: "Ship a reliable MVP",
      preferredTemplateId: "software-product",
      depth: "medium",
    });
    expect(state.planningRun).toMatchObject({ id: "run-1", status: "queued" });
    expect(requestUpdate).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finishPccOwnerAcceptance,
  getPccState,
  loadPcc,
  startPccOwnerAcceptance,
  startPccPlan,
} from "./pcc.ts";

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
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: {
          percentComplete: 0,
          milestoneCounts: { total: 0, complete: 0, blocked: 0, needsApproval: 0 },
        },
      };
    }
    if (method === "pcc.attachments.list") {
      return { attachments: [] };
    }
    if (method === "pcc.plans.get") {
      return { run: { id: "run-1", status: "queued" } };
    }
    if (method === "pcc.projects.upsert") {
      return {
        project: {
          id: "project-1",
          title: "MVP",
          goal: "Ship a reliable MVP",
          status: "active",
          metadata: { pccWorkLoop: { state: "working" } },
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
        summary: {
          id: "project-1",
          title: "MVP",
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
          updatedAt: "2026-08-11T00:00:00.000Z",
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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("records a timed anonymous owner acceptance against the pending milestone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    vi.stubGlobal("crypto", {
      randomUUID: () => "owner-seed",
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    const host = {};
    const requestUpdate = vi.fn();
    let completed = false;
    const project = {
      id: "project-1",
      title: "MVP",
      goal: "Ship a reliable MVP",
      status: "active",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    const pendingMilestone = {
      id: "owner-milestone",
      projectId: "project-1",
      title: "Anonymous owner acceptance",
      status: "needs_approval",
      blocker: "Owner must complete one zero-hint 60-second protocol.",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const client = {
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "pcc.projects.upsert") {
          return {
            project: {
              ...project,
              metadata: params?.project && (params.project as Record<string, unknown>).metadata,
            },
            summary: {
              id: project.id,
              title: project.title,
              status: "active",
              percentComplete: completed ? 100 : 50,
              milestoneCounts: {
                total: 2,
                complete: completed ? 2 : 1,
                blocked: 0,
                needsApproval: completed ? 0 : 1,
                deferred: 0,
                skipped: 0,
              },
              nextActions: [],
              proofGaps: [],
              updatedAt: project.updatedAt,
            },
          };
        }
        if (method === "pcc.evidence.add") {
          return { evidence: { id: "owner-evidence" }, summary: {} };
        }
        if (method === "pcc.receipts.add") {
          completed = true;
          return {
            receipt: { id: "owner-receipt" },
            milestone: {},
            lastKnownGood: {},
            summary: {},
          };
        }
        if (method === "pcc.projects.get") {
          return {
            project,
            milestones: completed
              ? [{ ...pendingMilestone, status: "complete" }]
              : [pendingMilestone],
            subMilestones: [],
            permissions: [],
            evidence: completed ? [{ id: "owner-evidence", status: "passed" }] : [],
            receipts: completed ? [{ id: "owner-receipt" }] : [],
            summary: {
              id: project.id,
              title: project.title,
              status: "active",
              percentComplete: completed ? 100 : 50,
              milestoneCounts: {
                total: 2,
                complete: completed ? 2 : 1,
                blocked: 0,
                needsApproval: completed ? 0 : 1,
                deferred: 0,
                skipped: 0,
              },
              nextActions: [],
              proofGaps: [],
              updatedAt: project.updatedAt,
            },
          };
        }
        if (method === "pcc.attachments.list") {
          return { attachments: [] };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    };
    const state = getPccState(host);
    state.project = project as never;
    state.milestones = [pendingMilestone] as never;
    state.ownerAcceptance = { ...state.ownerAcceptance };

    await startPccOwnerAcceptance({ host, client: client as never, requestUpdate });
    expect(state.ownerAcceptance.state).toBe("running");
    expect(state.ownerAcceptance.participantHash).toHaveLength(64);

    vi.advanceTimersByTime(60_000);
    await finishPccOwnerAcceptance({ host, client: client as never, requestUpdate });

    expect(client.request).toHaveBeenCalledWith(
      "pcc.evidence.add",
      expect.objectContaining({ evidence: expect.objectContaining({ status: "passed" }) }),
    );
    expect(client.request).toHaveBeenCalledWith(
      "pcc.receipts.add",
      expect.objectContaining({
        receipt: expect.objectContaining({ proofEvidenceIds: ["owner-evidence"] }),
      }),
    );
    expect(state.ownerAcceptance).toMatchObject({ state: "complete", receiptId: "owner-receipt" });
  });

  it("resumes a persisted owner timer after a project reload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:30.000Z"));
    const host = {};
    const requestUpdate = vi.fn();
    const client = {
      request: vi.fn(async (method: string) => {
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
              metadata: {
                pccOwnerAcceptance: {
                  state: "running",
                  startedAt: Date.parse("2026-08-11T00:00:20.000Z"),
                  elapsedMs: 10_000,
                  participantHash: "a".repeat(64),
                  attempt: 1,
                },
              },
            },
            milestones: [
              {
                id: "owner-milestone",
                projectId: "project-1",
                title: "Owner acceptance",
                status: "needs_approval",
              },
            ],
            subMilestones: [],
            permissions: [],
            evidence: [],
            receipts: [],
            summary: {
              percentComplete: 50,
              milestoneCounts: { total: 2, complete: 1, blocked: 0, needsApproval: 1 },
            },
          };
        }
        if (method === "pcc.attachments.list") {
          return { attachments: [] };
        }
        throw new Error(`unexpected method ${method}`);
      }),
    };

    await loadPcc({ host, client: client as never, requestUpdate });
    expect(getPccState(host).ownerAcceptance).toMatchObject({
      state: "running",
      elapsedMs: 10_000,
    });

    vi.advanceTimersByTime(20_000);
    expect(getPccState(host).ownerAcceptance.elapsedMs).toBe(30_000);
    expect(requestUpdate).toHaveBeenCalled();
  });
});

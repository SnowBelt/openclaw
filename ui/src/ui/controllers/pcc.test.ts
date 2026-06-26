import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
  loadPccDashboard,
  openPccMilestoneEditor,
  openPccProjectEditor,
  savePccMilestone,
  savePccProject,
  selectPccProject,
  setPccMilestoneStatus,
  setPccPermissionStatus,
  setPccProjectStatus,
  updatePccWorkLoopSettings,
  preparePccNextWorkItem,
  type PccDashboardState,
} from "./pcc.ts";

function createState(overrides: Partial<PccDashboardState> = {}): PccDashboardState {
  return {
    client: null,
    connected: true,
    pccProjects: [],
    pccPortfolioSummary: null,
    pccLoading: false,
    pccError: null,
    pccUpdatedAt: null,
    pccSelectedProjectId: null,
    pccProjectDetail: null,
    pccActionBusy: false,
    pccActionError: null,
    pccEditorMode: null,
    pccProjectForm: { ...EMPTY_PCC_PROJECT_FORM },
    pccMilestoneForm: { ...EMPTY_PCC_MILESTONE_FORM },
    ...overrides,
  };
}

const project = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Track all projects",
  status: "active" as const,
  priority: 3,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const milestone = {
  id: "milestone-1",
  projectId: "project-1",
  title: "CRUD UI",
  status: "in_progress" as const,
  order: 1,
  percentComplete: 30,
  implementationPlan: "Build forms",
  acceptanceCriteria: ["Local proof passes"],
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const permission = {
  id: "permission-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  type: "remote_proof" as const,
  status: "needed" as const,
  riskLevel: "medium" as const,
  allowedActions: ["push branch", "run Workflow Sanity"],
  forbiddenActions: ["merge upstream"],
  target: "SnowBelt/openclaw",
  usedCount: 0,
  auditLog: [],
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const summary = {
  id: "project-1",
  title: "Project Command Center",
  status: "active" as const,
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
};

const portfolio = {
  projectsTotal: 1,
  active: 1,
  blocked: 0,
  needsApproval: 1,
  complete: 0,
  archived: 0,
  averagePercentComplete: 25,
  nextActions: ["Build UI shell"],
};

describe("loadPccDashboard", () => {
  it("loads project list and portfolio summary", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio });
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
      pccProjects: [summary],
    });

    await expect(loadPccDashboard(state)).resolves.toBeUndefined();

    expect(state.pccProjects).toHaveLength(1);
    expect(state.pccError).toContain("gateway offline");
    expect(state.pccLoading).toBe(false);
  });

  it("updates permission status and refreshes selected project", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ permission: { ...permission, status: "granted" }, summary })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project,
        milestones: [milestone],
        permissions: [{ ...permission, status: "granted" }],
        summary,
      });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await setPccPermissionStatus(state, permission, "granted");

    expect(request).toHaveBeenNthCalledWith(1, "pcc.permissions.upsert", {
      permission: expect.objectContaining({
        id: "permission-1",
        projectId: "project-1",
        milestoneId: "milestone-1",
        type: "remote_proof",
        status: "granted",
        grantedBy: "user",
      }),
    });
    expect(state.pccProjectDetail?.permissions[0]?.status).toBe("granted");
  });

  it("updates guided work-loop settings without starting Codex", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        project: { ...project, metadata: { pccWorkLoop: { enabled: true } } },
        summary,
      })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project: { ...project, metadata: { pccWorkLoop: { enabled: true } } },
        milestones: [milestone],
        permissions: [],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: { project, milestones: [milestone], permissions: [], summary },
    });

    await updatePccWorkLoopSettings(state, { enabled: true, stopBeforeCodex: true });

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.upsert", {
      project: expect.objectContaining({
        id: "project-1",
        metadata: expect.objectContaining({
          pccWorkLoop: expect.objectContaining({ enabled: true }),
        }),
      }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining("codex"), expect.anything());
  });

  it("prepares the next safe milestone and marks it in progress", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        project: { ...project, metadata: { pccWorkLoop: { enabled: true, state: "working" } } },
        summary,
      })
      .mockResolvedValueOnce({ milestone: { ...milestone, status: "in_progress" }, summary })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project,
        milestones: [{ ...milestone, status: "in_progress" }],
        permissions: [],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [{ ...milestone, status: "not_started" }],
        permissions: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.upsert", {
      project: expect.objectContaining({
        metadata: expect.objectContaining({
          pccWorkLoop: expect.objectContaining({
            activeMilestoneId: "milestone-1",
            state: "working",
          }),
        }),
      }),
    });
    expect(request).toHaveBeenNthCalledWith(2, "pcc.milestones.upsert", {
      milestone: expect.objectContaining({ id: "milestone-1", status: "in_progress" }),
    });
  });
});

describe("PCC CRUD controller", () => {
  it("selects a project detail", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      project,
      milestones: [milestone],
      permissions: [permission],
      summary,
    });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await selectPccProject(state, "project-1");

    expect(request).toHaveBeenCalledWith("pcc.projects.get", { projectId: "project-1" });
    expect(state.pccSelectedProjectId).toBe("project-1");
    expect(state.pccProjectDetail?.milestones[0]?.title).toBe("CRUD UI");
    expect(state.pccProjectDetail?.permissions[0]?.id).toBe("permission-1");
  });

  it("opens project and milestone editors", () => {
    const state = createState({ pccSelectedProjectId: "project-1" });

    openPccProjectEditor(state, project);
    expect(state.pccEditorMode).toBe("edit-project");
    expect(state.pccProjectForm.title).toBe("Project Command Center");

    openPccMilestoneEditor(state, milestone);
    expect(state.pccEditorMode).toBe("edit-milestone");
    expect(state.pccMilestoneForm.title).toBe("CRUD UI");
  });

  it("creates a project and refreshes detail", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ project, summary })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({ project, milestones: [], permissions: [], summary });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectForm: {
        id: null,
        title: "Project Command Center",
        goal: "Track all projects",
        status: "active",
        priority: "3",
      },
    });

    await savePccProject(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.upsert", {
      project: {
        title: "Project Command Center",
        goal: "Track all projects",
        status: "active",
        priority: 3,
      },
    });
    expect(state.pccSelectedProjectId).toBe("project-1");
    expect(state.pccEditorMode).toBeNull();
  });

  it("updates project status", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        project: { ...project, status: "archived" },
        summary: { ...summary, status: "archived" },
      })
      .mockResolvedValueOnce({ projects: [] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project: { ...project, status: "archived" },
        milestones: [],
        permissions: [],
        summary: { ...summary, status: "archived" },
      });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await setPccProjectStatus(state, project, "archived");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({ id: "project-1", status: "archived" }),
      }),
    );
  });

  it("creates a milestone and refreshes selected project", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ milestone, summary })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project,
        milestones: [milestone],
        permissions: [permission],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccMilestoneForm: {
        id: null,
        projectId: "project-1",
        title: "CRUD UI",
        status: "in_progress",
        phaseId: "mvp",
        order: "1",
        percentComplete: "30",
        blocker: "",
        implementationPlan: "Build forms",
        acceptanceCriteria: "Local proof passes",
      },
    });

    await savePccMilestone(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.milestones.upsert", {
      milestone: expect.objectContaining({
        projectId: "project-1",
        title: "CRUD UI",
        status: "in_progress",
        order: 1,
        percentComplete: 30,
        acceptanceCriteria: ["Local proof passes"],
      }),
    });
    expect(state.pccProjectDetail?.milestones).toHaveLength(1);
  });

  it("updates milestone status", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ milestone: { ...milestone, status: "deferred" }, summary })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project,
        milestones: [{ ...milestone, status: "deferred" }],
        summary,
      });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await setPccMilestoneStatus(state, milestone, "deferred");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({ id: "milestone-1", status: "deferred" }),
      }),
    );
  });
});

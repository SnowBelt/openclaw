import { describe, expect, it, vi } from "vitest";
import {
  validatePccMilestonesUpsertParams,
  validatePccProjectsUpsertParams,
  validatePccSubMilestonesUpsertParams,
} from "../../../../packages/gateway-protocol/src/index.js";
import {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
  addPccCompletionReceipt,
  buildPccSectionAutofillPreview,
  applyPccSetupAutofill,
  buildPccSetupAutofillPreview,
  applyPccChatSyncProposal,
  dismissPccSetupAutofill,
  dismissPccChatSync,
  loadPccDashboard,
  movePccMilestoneBefore,
  movePccSubMilestoneBefore,
  normalizePccProjectSequence,
  repairPccDuplicateTitles,
  removePccStaleDependencies,
  openPccDecisionForm,
  openPccMilestoneEditor,
  openPccProjectEditor,
  previewPccSetupAutofill,
  previewPccChatSync,
  resumePccProjectForWork,
  runPccAutopilotLoopAction,
  runPccUndoAction,
  savePccDecision,
  savePccMilestone,
  savePccProject,
  selectPccProject,
  setPccMilestoneStatus,
  setPccSubMilestoneStatus,
  setPccPermissionStatus,
  setPccProjectStatus,
  updatePccWorkLoopSettings,
  preparePccNextWorkItem,
  updatePccAutofillApproval,
  updatePccChatSyncText,
  updatePccDecisionForm,
  updatePccViewMode,
  updatePccProjectEditMode,
  updatePccProjectSearchQuery,
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
    pccProjectDetails: {},
    pccActionBusy: false,
    pccActionError: null,
    pccEditorMode: null,
    pccProjectForm: { ...EMPTY_PCC_PROJECT_FORM },
    pccMilestoneForm: { ...EMPTY_PCC_MILESTONE_FORM },
    pccDecisionFormOpen: false,
    pccDecisionForm: { ...EMPTY_PCC_DECISION_FORM },
    pccChatSyncText: "",
    pccChatSyncProposals: [],
    pccChatSyncError: null,
    pccViewMode: "simple",
    pccProjectSearchQuery: "",
    ...overrides,
  };
}

const project = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Track all projects",
  status: "active" as const,
  priority: 3,
  metadata: {
    pccWorkflowTemplateId: "software-product",
    pccIntake: {
      approved: true,
      answers: {
        goal: "Track all projects.",
        firstDeliverable: "A useful dashboard.",
        doneProof: "Local and remote proof.",
        constraints: "No destructive actions without permission.",
        owner: "local_openclaw_agent",
        blockers: "None.",
      },
    },
    pccQualityGate: { status: "passing" },
    pccSetupScore: { score: 100, runnable: true },
    pccCompliance: { badge: "Passing", status: "passing" },
  },
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
  metadata: {
    pccResponsibility: "local_openclaw_agent",
    pccProofLevel: "local",
    pccCostRisk: "low",
  },
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const subMilestone = {
  id: "submilestone-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  title: "Run local proof",
  status: "not_started" as const,
  order: 1,
  implementationPlan: "Run the exact local proof command.",
  acceptanceCriteria: ["Command exits 0"],
  metadata: {
    pccResponsibility: "local_openclaw_agent",
    pccProofLevel: "local",
  },
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const intakeAnswers = {
  goal: "Track every project.",
  firstDeliverable: "A PCC dashboard shell.",
  doneProof: "Tests and browser proof pass.",
  constraints: "No remote proof without permission.",
  owner: "local_openclaw_agent",
  blockers: "No blockers.",
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

const evidence = {
  id: "evidence-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  kind: "local_test" as const,
  status: "passed" as const,
  summary: "Local proof passed",
  command: "pnpm test ui/src/ui/views/pcc.test.ts",
  exitCode: 0,
  createdAt: "2026-06-26T00:00:00Z",
};

const receipt = {
  id: "receipt-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  summary: "CRUD UI completed with local proof.",
  proofEvidenceIds: ["evidence-1"],
  proofLevel: "local" as const,
  doNotRedo: ["Do not redo local proof without a regression."],
  completedBy: "Project Command Center",
  completedAt: "2026-06-26T00:00:00Z",
};

const decision = {
  id: "decision-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  title: "Use durable decision log",
  summary: "Record project choices as first-class PCC records.",
  decidedBy: "Codex",
  decidedAt: "2026-06-26T01:00:00Z",
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

function assertValidPccWriteParams(method: string, params: unknown): void {
  if (method === "pcc.projects.upsert" && !validatePccProjectsUpsertParams(params)) {
    throw new Error(
      `invalid project upsert payload: ${JSON.stringify(validatePccProjectsUpsertParams.errors)}`,
    );
  }
  if (method === "pcc.milestones.upsert" && !validatePccMilestonesUpsertParams(params)) {
    throw new Error(
      `invalid milestone upsert payload: ${JSON.stringify(validatePccMilestonesUpsertParams.errors)}`,
    );
  }
  if (method === "pcc.subMilestones.upsert" && !validatePccSubMilestonesUpsertParams(params)) {
    throw new Error(
      `invalid sub-milestone upsert payload: ${JSON.stringify(validatePccSubMilestonesUpsertParams.errors)}`,
    );
  }
}

describe("loadPccDashboard", () => {
  it("updates project search query state", () => {
    const requestUpdate = vi.fn();
    const state = createState({ requestUpdate });

    updatePccProjectSearchQuery(state, "blocked proof");

    expect(state.pccProjectSearchQuery).toBe("blocked proof");
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });

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

  it("preloads Project Command Center detail for the global production-truth surface", async () => {
    const pccSummary = {
      ...summary,
      id: "project-command-center",
      title: "Project Command Center",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ projects: [pccSummary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project: { ...project, id: "project-command-center", title: "Project Command Center" },
        milestones: [milestone],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: pccSummary,
      });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await loadPccDashboard(state);

    expect(request).toHaveBeenNthCalledWith(3, "pcc.projects.get", {
      projectId: "project-command-center",
    });
    expect(state.pccProjectDetails["project-command-center"]?.project.title).toBe(
      "Project Command Center",
    );
  });

  it("computes fallback portfolio attention metrics when summary omits them", async () => {
    const stale = {
      ...summary,
      id: "stale-project",
      status: "active" as const,
      proofGaps: [],
      milestoneCounts: { ...summary.milestoneCounts, needsApproval: 0 },
      updatedAt: "2000-01-01T00:00:00.000Z",
    };
    const proofGap = {
      ...summary,
      id: "proof-gap-project",
      status: "active" as const,
      proofGaps: ["Missing browser proof"],
      milestoneCounts: { ...summary.milestoneCounts, needsApproval: 0 },
    };
    const overdue = {
      ...summary,
      id: "overdue-project",
      status: "active" as const,
      proofGaps: [],
      milestoneCounts: { ...summary.milestoneCounts, needsApproval: 0 },
      dueDate: "2000-01-02T00:00:00.000Z",
    };
    const onHold = {
      ...summary,
      id: "on-hold-project",
      status: "on_hold" as const,
      proofGaps: ["Deferred browser proof"],
      milestoneCounts: { ...summary.milestoneCounts, blocked: 1, needsApproval: 1 },
      health: "At risk",
    };
    const deferred = {
      ...summary,
      id: "deferred-project",
      status: "deferred" as const,
      proofGaps: ["Deferred remote proof"],
      milestoneCounts: { ...summary.milestoneCounts, blocked: 1, needsApproval: 0 },
      health: "Overdue",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ projects: [stale, proofGap, overdue, onHold, deferred] })
      .mockResolvedValueOnce({});
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await loadPccDashboard(state);

    expect(state.pccPortfolioSummary?.needsAttention).toBe(3);
    expect(state.pccPortfolioSummary?.active).toBe(3);
    expect(state.pccPortfolioSummary?.proofGaps).toBe(3);
    expect(state.pccPortfolioSummary?.overdue).toBe(1);
    expect(state.pccPortfolioSummary?.stale).toBe(1);
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

  it("adds a completion receipt from passed evidence and refreshes detail", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        receipt,
        milestone: {
          ...milestone,
          status: "complete",
          percentComplete: 100,
          receiptIds: [receipt.id],
        },
        summary: { ...summary, percentComplete: 100 },
      })
      .mockResolvedValueOnce({ projects: [{ ...summary, percentComplete: 100 }] })
      .mockResolvedValueOnce({ portfolio: { ...portfolio, averagePercentComplete: 100 } })
      .mockResolvedValueOnce({
        project,
        milestones: [
          { ...milestone, status: "complete", percentComplete: 100, receiptIds: [receipt.id] },
        ],
        permissions: [],
        evidence: [evidence],
        receipts: [receipt],
        summary: { ...summary, percentComplete: 100 },
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        permissions: [],
        evidence: [evidence],
        receipts: [],
        summary,
      },
    });

    await addPccCompletionReceipt(state, milestone);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.receipts.add", {
      receipt: expect.objectContaining({
        projectId: "project-1",
        milestoneId: "milestone-1",
        proofEvidenceIds: ["evidence-1"],
        proofLevel: "local",
      }),
    });
    expect(state.pccProjectDetail?.receipts[0]?.id).toBe("receipt-1");
  });

  it("refuses to add a completion receipt without passed evidence", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await addPccCompletionReceipt(state, milestone);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toContain("Passed evidence");
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
        evidence: [],
        receipts: [],
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

  it("queues Autopilot permission and writes durable grant through project upsert", async () => {
    let savedProject = project;
    const request = vi.fn(async (method: string, params: unknown) => {
      assertValidPccWriteParams(method, params);
      if (method === "pcc.projects.upsert") {
        savedProject = (params as { project: typeof project }).project;
        return { project: savedProject, summary };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project: savedProject,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [evidence],
          receipts: [receipt],
          decisions: [decision],
          lastKnownGood: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccSelectedProjectId: project.id,
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [evidence],
        receipts: [receipt],
        decisions: [decision],
        lastKnownGood: [],
        summary,
      },
    });

    await runPccAutopilotLoopAction(state, "start");
    const queuedAutopilot = (
      savedProject.metadata as
        | {
            pccAutopilot?: {
              status?: string;
              permissionQueue?: Array<{ status?: string; riskTier?: string }>;
            };
          }
        | undefined
    )?.pccAutopilot;
    expect(queuedAutopilot?.status).toBe("needs_approval");
    expect(queuedAutopilot?.permissionQueue?.[0]).toMatchObject({
      status: "pending",
      riskTier: "medium",
    });

    await runPccAutopilotLoopAction(state, "allow_medium_risk");
    const approvedAutopilot = (
      savedProject.metadata as
        | {
            pccAutopilot?: {
              permissionGrants?: Array<{ status?: string; riskTier?: string }>;
              permissionQueue?: Array<{ status?: string }>;
            };
          }
        | undefined
    )?.pccAutopilot;
    expect(approvedAutopilot?.permissionGrants?.[0]).toMatchObject({
      status: "active",
      riskTier: "medium",
    });
    expect(approvedAutopilot?.permissionQueue?.[0]?.status).toBe("approved");
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
        evidence: [],
        receipts: [],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
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

  it("opens setup autofill preview instead of dead-ending when setup is missing", async () => {
    const request = vi.fn();
    const incompleteProject = {
      ...project,
      goal: "",
      metadata: {
        ...project.metadata,
        pccIntake: {
          approved: false,
          answers: { ...intakeAnswers, goal: "" },
        },
        pccQualityGate: { status: "missing" },
        pccSetupScore: { score: 40, runnable: false },
        pccCompliance: { badge: "Missing", status: "missing" },
      },
    };
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project: incompleteProject,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccAutofillPreview?.goal).toBeTruthy();
    expect(state.pccActionError).toContain("PCC cannot start this project yet:");
    expect(state.pccActionError).toContain("Review the blocker checklist");
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
        evidence: [],
        receipts: [],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [{ ...milestone, status: "not_started" }],
        subMilestones: [{ ...subMilestone, status: "complete", receiptIds: ["receipt-1"] }],
        permissions: [],
        evidence: [],
        receipts: [],
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

  it("prepares the next safe sub-milestone before parent milestone work", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        project: {
          ...project,
          metadata: {
            pccWorkLoop: {
              enabled: true,
              state: "working",
              activeMilestoneId: "milestone-1",
              activeSubMilestoneId: "submilestone-1",
            },
          },
        },
        summary,
      })
      .mockResolvedValueOnce({
        subMilestone: { ...subMilestone, status: "in_progress" },
        milestone,
        summary,
      })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project,
        milestones: [milestone],
        subMilestones: [{ ...subMilestone, status: "in_progress" }],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.upsert", {
      project: expect.objectContaining({
        metadata: expect.objectContaining({
          pccWorkLoop: expect.objectContaining({
            activeMilestoneId: "milestone-1",
            activeSubMilestoneId: "submilestone-1",
            state: "working",
          }),
        }),
      }),
    });
    expect(request).toHaveBeenNthCalledWith(2, "pcc.subMilestones.upsert", {
      subMilestone: expect.objectContaining({ id: "submilestone-1", status: "in_progress" }),
    });
  });

  it("refuses to prepare project work while PCC Product focus is selected", async () => {
    const request = vi.fn();
    const projectWork = {
      ...project,
      id: "project-work-1",
      title: "Kitchen Remodel",
      metadata: { ...project.metadata, pccWorkScope: "project_work" },
    };
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProductFocusMode: "pcc_product",
      pccProjectDetail: {
        project: projectWork,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toBe(
      "This is Project Work. Switch to Project Work before preparing it.",
    );
  });
});

describe("PCC CRUD controller", () => {
  it("selects a project detail", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      project,
      milestones: [milestone],
      permissions: [permission],
      decisions: [decision],
      summary,
    });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await selectPccProject(state, "project-1");

    expect(request).toHaveBeenCalledWith("pcc.projects.get", { projectId: "project-1" });
    expect(state.pccSelectedProjectId).toBe("project-1");
    expect(state.pccProjectDetail?.milestones[0]?.title).toBe("CRUD UI");
    expect(state.pccProjectDetail?.subMilestones).toEqual([]);
    expect(state.pccProjectDetail?.permissions[0]?.id).toBe("permission-1");
    expect(state.pccProjectDetail?.decisions?.[0]?.title).toBe("Use durable decision log");
    expect(state.pccProductFocusMode).toBe("pcc_product");
  });

  it("selects PCC Product mode for the canonical Project Command Center project", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      project: { ...project, id: "project-command-center", title: "Project Command Center" },
      milestones: [milestone],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: { ...summary, id: "project-command-center", pccWorkScope: "pcc_product" },
    });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await selectPccProject(state, "project-command-center");

    expect(state.pccProductFocusMode).toBe("pcc_product");
  });

  it("optimistically clears stale selected project detail while loading a different project", async () => {
    let resolveRequest: (value: unknown) => void = () => {
      throw new Error("select request did not start");
    };
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const requestUpdate = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      requestUpdate,
      pccSelectedProjectId: "project-1",
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    const pending = selectPccProject(state, "project-2");

    expect(state.pccSelectedProjectId).toBe("project-2");
    expect(state.pccProjectDetail).toBeNull();
    expect(requestUpdate).toHaveBeenCalled();
    resolveRequest({
      project: { ...project, id: "project-2", title: "Second Project" },
      milestones: [],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: { ...summary, id: "project-2", title: "Second Project" },
    });
    await pending;
    expect(state.pccProjectDetail?.project.id).toBe("project-2");
  });

  it("records a project decision through the controller", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.decisions.add") {
        return { decision, summary };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [evidence],
          receipts: [],
          decisions: [decision],
          lastKnownGood: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [evidence],
        receipts: [],
        decisions: [],
        lastKnownGood: [],
        summary,
      },
    });

    openPccDecisionForm(state);
    updatePccDecisionForm(state, {
      title: "Use durable decision log",
      summary: "Record project choices as first-class PCC records.",
      rationale: "Future agents need this context.",
      impact: "Less repeated debate.",
      milestoneId: milestone.id,
      subMilestoneId: subMilestone.id,
      evidenceIds: evidence.id,
      decidedBy: "Codex",
    });

    await savePccDecision(state);

    expect(request).toHaveBeenCalledWith("pcc.decisions.add", {
      decision: {
        projectId: project.id,
        title: "Use durable decision log",
        summary: "Record project choices as first-class PCC records.",
        milestoneId: milestone.id,
        subMilestoneId: subMilestone.id,
        rationale: "Future agents need this context.",
        impact: "Less repeated debate.",
        decidedBy: "Codex",
        evidenceIds: [evidence.id],
      },
    });
    expect(state.pccDecisionFormOpen).toBe(false);
    expect(state.pccActionNotice?.text).toBe("Decision recorded.");
    expect(state.pccProjectDetail?.decisions?.[0]?.id).toBe("decision-1");
  });

  it("requires decision title and summary before saving", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        lastKnownGood: [],
        summary,
      },
    });

    openPccDecisionForm(state);
    await savePccDecision(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toBe("Decision title and summary are required.");
  });

  it("opens project and milestone editors", () => {
    const state = createState({ pccSelectedProjectId: "project-1" });

    openPccProjectEditor(state, {
      ...project,
      metadata: { ...project.metadata, dueDate: "2099-01-15T00:00:00.000Z" },
    });
    expect(state.pccEditorMode).toBe("edit-project");
    expect(state.pccProjectForm.title).toBe("Project Command Center");
    expect(state.pccProjectForm.dueDate).toBe("2099-01-15");

    openPccMilestoneEditor(state, milestone);
    expect(state.pccEditorMode).toBe("edit-milestone");
    expect(state.pccMilestoneForm.title).toBe("CRUD UI");
  });

  it("previews and applies setup autofill without writing before approval", async () => {
    const incompleteProject = {
      ...project,
      goal: "",
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: { approved: false, answers: { ...intakeAnswers, goal: "" } },
        pccQualityGate: { status: "missing" },
        pccSetupScore: { score: 40, runnable: false },
      },
    };
    const incompleteMilestone = {
      ...milestone,
      implementationPlan: "",
      acceptanceCriteria: [],
      metadata: {},
    };
    const incompleteSub = {
      ...subMilestone,
      implementationPlan: "",
      acceptanceCriteria: [],
      metadata: {},
    };
    const detail = {
      project: incompleteProject,
      milestones: [incompleteMilestone],
      subMilestones: [incompleteSub],
      permissions: [],
      evidence: [],
      receipts: [],
      summary,
    };
    const preview = buildPccSetupAutofillPreview(detail);
    expect(preview.goal).toBe("Project Command Center");
    expect(preview.intakeAnswers.goal).toBe("Project Command Center");
    expect(preview.milestoneUpdates[0]?.fields).toContain("implementation plan");
    expect(preview.subMilestoneUpdates[0]?.fields).toContain("acceptance criteria");

    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.upsert") {
        return { project: incompleteProject, summary };
      }
      if (method === "pcc.milestones.upsert") {
        return { milestone: incompleteMilestone, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone: incompleteSub };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project: incompleteProject,
          milestones: [incompleteMilestone],
          subMilestones: [incompleteSub],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
    });

    previewPccSetupAutofill(state);
    expect(request).not.toHaveBeenCalled();
    expect(state.pccAutofillPreview?.intakeApproved).toBe(false);

    updatePccAutofillApproval(state, true);
    expect(state.pccAutofillPreview?.intakeApproved).toBe(true);

    await applyPccSetupAutofill(state);

    expect(request.mock.calls[0]).toEqual([
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({
          goal: "Project Command Center",
          metadata: expect.objectContaining({
            pccIntake: expect.objectContaining({ approved: true, status: "approved" }),
            pccSetupAutofill: expect.objectContaining({ source: "local_project_manager" }),
          }),
        }),
      }),
    ]);
    expect(request.mock.calls.some(([method]) => method === "pcc.milestones.upsert")).toBe(true);
    expect(request.mock.calls.some(([method]) => method === "pcc.subMilestones.upsert")).toBe(true);
    expect(state.pccAutofillPreview).toBeNull();

    dismissPccSetupAutofill(state);
    expect(state.pccAutofillPreview).toBeNull();
  });

  it("autofill creates workflow milestones when a non-terminal project has no active milestones", async () => {
    const emptyProject = {
      ...project,
      id: "project-empty",
      title: "Kitchen Remodel Planner",
      goal: "",
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: { approved: false, answers: { ...intakeAnswers, goal: "" } },
      },
    };
    const detail = {
      project: emptyProject,
      milestones: [],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: { ...summary, id: "project-empty", title: "Kitchen Remodel Planner" },
    };
    const preview = buildPccSetupAutofillPreview(detail, true);
    expect(preview.generatedMilestones?.length).toBeGreaterThan(0);
    expect(preview.generatedMilestones?.[0]?.subMilestoneTitles.length).toBeGreaterThan(0);

    let createdMilestoneCount = 0;
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "pcc.projects.upsert") {
        return { project: emptyProject, summary };
      }
      if (method === "pcc.milestones.upsert") {
        createdMilestoneCount += 1;
        const milestonePayload = (params as { milestone: typeof milestone }).milestone;
        return {
          milestone: {
            ...milestonePayload,
            id: `generated-${createdMilestoneCount}`,
            createdAt: "2026-06-26T00:00:00Z",
            updatedAt: "2026-06-26T00:00:00Z",
          },
          summary,
        };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return { ...detail, decisions: [] };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccAutofillPreview: preview,
    });

    await applyPccSetupAutofill(state);

    expect(request.mock.calls[0]).toEqual([
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({
          id: "project-empty",
          goal: "Kitchen Remodel Planner",
          status: "active",
          metadata: expect.objectContaining({
            pccIntake: expect.objectContaining({ approved: true }),
          }),
        }),
      }),
    ]);
    const milestoneCreates = request.mock.calls.filter(
      ([method]) => method === "pcc.milestones.upsert",
    );
    const subMilestoneCreates = request.mock.calls.filter(
      ([method]) => method === "pcc.subMilestones.upsert",
    );
    expect(milestoneCreates.length).toBeGreaterThan(0);
    expect(subMilestoneCreates.length).toBeGreaterThan(0);
    expect(subMilestoneCreates[0]?.[1]).toEqual(
      expect.objectContaining({
        subMilestone: expect.objectContaining({
          projectId: "project-empty",
          milestoneId: expect.stringMatching(/^generated-/u),
        }),
      }),
    );
  });

  it("autofill creates sub-milestones for active milestones that have none", async () => {
    const childlessMilestone = {
      ...milestone,
      id: "milestone-childless",
      title: "Build MVP",
      implementationPlan: "",
      acceptanceCriteria: [],
      metadata: {},
    };
    const onHoldProject = {
      ...project,
      status: "on_hold" as const,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: { approved: false, answers: { ...intakeAnswers, goal: "" } },
      },
    };
    const detail = {
      project: onHoldProject,
      milestones: [childlessMilestone],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: { ...summary, status: "on_hold" as const },
    };
    const preview = buildPccSetupAutofillPreview(detail);
    expect(preview.generatedSubMilestones?.length).toBeGreaterThan(0);
    expect(preview.generatedSubMilestones?.[0]?.milestoneId).toBe("milestone-childless");

    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "pcc.projects.upsert") {
        return { project: onHoldProject, summary };
      }
      if (method === "pcc.milestones.upsert") {
        return { milestone: childlessMilestone, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone: (params as { subMilestone: typeof subMilestone }).subMilestone };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return { ...detail, decisions: [] };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccAutofillPreview: preview,
    });

    await applyPccSetupAutofill(state);

    expect(request.mock.calls[0]).toEqual([
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({ id: "project-1", status: "on_hold" }),
      }),
    ]);
    expect(
      request.mock.calls.some(
        ([method, params]) =>
          method === "pcc.subMilestones.upsert" &&
          (params as { subMilestone: { milestoneId: string } }).subMilestone.milestoneId ===
            "milestone-childless",
      ),
    ).toBe(true);
  });

  it("skips milestones with unfinished sub-milestones and reopens them", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.milestones.upsert") {
        return { milestone, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, milestone, "skipped", "Not needed now");

    expect(request).toHaveBeenCalledWith(
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({
          status: "skipped",
          percentComplete: 0,
          metadata: expect.objectContaining({ pccSkipNote: "Not needed now" }),
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "pcc.subMilestones.upsert",
      expect.objectContaining({
        subMilestone: expect.objectContaining({ status: "skipped", percentComplete: 0 }),
      }),
    );

    await setPccSubMilestoneStatus(state, subMilestone, "not_started");
    expect(request).toHaveBeenCalledWith(
      "pcc.subMilestones.upsert",
      expect.objectContaining({
        subMilestone: expect.objectContaining({ status: "not_started", percentComplete: 0 }),
      }),
    );
  });

  it("removes milestones from the active plan by archiving unfinished child steps", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.milestones.upsert") {
        return { milestone: { ...milestone, status: "archived" }, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone: { ...subMilestone, status: "archived" } };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [{ ...milestone, status: "archived" }],
          subMilestones: [{ ...subMilestone, status: "archived" }],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, milestone, "archived", "Out of scope.");

    expect(request).toHaveBeenCalledWith(
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({
          status: "archived",
          percentComplete: 0,
          metadata: expect.objectContaining({ pccRemoveNote: "Out of scope." }),
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "pcc.subMilestones.upsert",
      expect.objectContaining({
        subMilestone: expect.objectContaining({
          status: "archived",
          percentComplete: 0,
          metadata: expect.objectContaining({ pccRemoveNote: "Out of scope." }),
        }),
      }),
    );
  });

  it("creates a project and refreshes detail", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "pcc.projects.upsert") {
        return { project, summary };
      }
      if (method === "pcc.milestones.upsert") {
        const title = (params as { milestone: { title: string } }).milestone.title;
        return { milestone: { ...milestone, id: `milestone-${title}`, title }, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone };
      }
      if (method === "pcc.permissions.upsert") {
        return { permission, summary };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
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
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectForm: {
        id: null,
        title: "Project Command Center",
        goal: "Track all projects",
        projectDescription: "Track all projects from a single Project Command Center.",
        status: "active",
        priority: "3",
        dueDate: "2099-01-15",
        outcomeMetrics:
          "User understands next action in under 5 seconds.\nEvery milestone has receipt-backed proof.",
        workflowTemplateId: "software-product",
        planningMode: "template_only",
        plannerMode: "local_model",
        plannerModelId: "",
        plannerPermissionScope: "plan",
        plannerPermissionBudget: "",
        planPreviewAccepted: true,
        codexPlanningAllowed: false,
        remoteProofAllowed: false,
        runtimeActionsAllowed: false,
        intakeAnswers,
        intakeApproved: true,
      },
    });

    await savePccProject(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.upsert", {
      project: expect.objectContaining({
        title: "Project Command Center",
        goal: "Track all projects",
        status: "active",
        priority: 3,
        metadata: expect.objectContaining({
          pccWorkflowTemplateId: "software-product",
          dueDate: "2099-01-15T00:00:00.000Z",
          pccDueDate: "2099-01-15T00:00:00.000Z",
          pccOutcomeMetrics: [
            "User understands next action in under 5 seconds.",
            "Every milestone has receipt-backed proof.",
          ],
          pccIntake: expect.objectContaining({ approved: true }),
          pccQualityGate: expect.objectContaining({ status: "passing" }),
          pccSetupScore: expect.objectContaining({ runnable: true }),
          pccCompliance: expect.objectContaining({ badge: "Passing" }),
        }),
        phases: expect.any(Array),
      }),
    });
    expect(request.mock.calls.some(([method]) => method === "pcc.milestones.upsert")).toBe(true);
    expect(request.mock.calls.some(([method]) => method === "pcc.subMilestones.upsert")).toBe(true);
    expect(state.pccSelectedProjectId).toBe("project-1");
    expect(state.pccEditorMode).toBeNull();
  });

  it("refuses to create a project from blank required intake answers", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Blank intake project",
        intakeAnswers: { ...intakeAnswers, goal: "" },
        intakeApproved: true,
      },
    });

    await savePccProject(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toContain("Required project intake answers");
  });

  it("reports disconnected saves clearly and clears stale success notices", async () => {
    const request = vi.fn();
    const requestUpdate = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      connected: false,
      requestUpdate,
      pccActionNotice: { kind: "success", text: "Saved stale state." },
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Offline project",
        goal: "Track disconnected saves.",
        planPreviewAccepted: true,
        intakeApproved: true,
        intakeAnswers,
      },
    });

    await savePccProject(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionNotice).toBeNull();
    expect(state.pccActionBusy).toBe(false);
    expect(state.pccActionError).toContain("offline or disconnected");
    expect(state.pccActionError).toContain("Changes were not saved");
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("blocks overlapping PCC actions before any duplicate ledger write", async () => {
    const request = vi.fn();
    const requestUpdate = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccActionBusy: true,
      requestUpdate,
    });

    await setPccMilestoneStatus(state, milestone, "deferred");

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionBusy).toBe(true);
    expect(state.pccActionError).toContain("already running");
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("creates a scoped Codex planning permission only when Codex planning is requested", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.upsert") {
        return { project, summary };
      }
      if (method === "pcc.milestones.upsert") {
        return { milestone };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
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
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Project Command Center",
        goal: "Track all projects",
        projectDescription: "Track all projects from a single Project Command Center.",
        planningMode: "codex_full_plan",
        plannerMode: "codex",
        codexPlanningAllowed: false,
        intakeAnswers,
        intakeApproved: true,
        planPreviewAccepted: true,
      },
    });

    await savePccProject(state);

    expect(request.mock.calls.some(([method]) => method === "pcc.permissions.upsert")).toBe(true);
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
        evidence: [],
        receipts: [],
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
        responsibility: "codex",
        costRisk: "high",
        stopHere: false,
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
        metadata: expect.objectContaining({
          pccResponsibility: "codex",
          pccCostRisk: "high",
        }),
      }),
    });
    expect(state.pccProjectDetail?.milestones).toHaveLength(1);
  });

  it("saves milestone and sub-milestone reorder through temporary order slots", async () => {
    const firstMilestone = { ...milestone, order: 10 };
    const secondMilestone = { ...milestone, id: "milestone-2", title: "Second", order: 20 };
    const thirdMilestone = { ...milestone, id: "milestone-3", title: "Third", order: 30 };
    const firstSubMilestone = { ...subMilestone, order: 10 };
    const secondSubMilestone = {
      ...subMilestone,
      id: "submilestone-2",
      title: "Second sub-step",
      order: 20,
    };
    const thirdSubMilestone = {
      ...subMilestone,
      id: "submilestone-3",
      title: "Third sub-step",
      order: 30,
    };
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [firstMilestone, secondMilestone, thirdMilestone],
          subMilestones: [firstSubMilestone, secondSubMilestone, thirdSubMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [firstMilestone, secondMilestone, thirdMilestone],
        subMilestones: [firstSubMilestone, secondSubMilestone, thirdSubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await movePccMilestoneBefore(state, thirdMilestone, secondMilestone);

    const milestoneWrites = request.mock.calls.filter(
      ([method]) => method === "pcc.milestones.upsert",
    );
    expect(milestoneWrites.slice(0, 4)).toEqual([
      [
        "pcc.milestones.upsert",
        { milestone: expect.objectContaining({ id: "milestone-3", order: 1_000_000_000 }) },
      ],
      [
        "pcc.milestones.upsert",
        { milestone: expect.objectContaining({ id: "milestone-2", order: 1_000_000_001 }) },
      ],
      [
        "pcc.milestones.upsert",
        { milestone: expect.objectContaining({ id: "milestone-3", order: 20 }) },
      ],
      [
        "pcc.milestones.upsert",
        { milestone: expect.objectContaining({ id: "milestone-2", order: 30 }) },
      ],
    ]);

    request.mockClear();
    await movePccSubMilestoneBefore(state, thirdSubMilestone, secondSubMilestone);

    const subMilestoneWrites = request.mock.calls.filter(
      ([method]) => method === "pcc.subMilestones.upsert",
    );
    expect(subMilestoneWrites.slice(0, 4)).toEqual([
      [
        "pcc.subMilestones.upsert",
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-3",
            order: 1_000_000_000,
          }),
        },
      ],
      [
        "pcc.subMilestones.upsert",
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-2",
            order: 1_000_000_001,
          }),
        },
      ],
      [
        "pcc.subMilestones.upsert",
        { subMilestone: expect.objectContaining({ id: "submilestone-3", order: 20 }) },
      ],
      [
        "pcc.subMilestones.upsert",
        { subMilestone: expect.objectContaining({ id: "submilestone-2", order: 30 }) },
      ],
    ]);
  });

  it("normalizes milestone and sub-milestone sequence slots with temporary orders", async () => {
    const firstMilestone = { ...milestone, order: 20 };
    const secondMilestone = { ...milestone, id: "milestone-2", title: "Second", order: 20 };
    const firstSubMilestone = { ...subMilestone, order: 5 };
    const secondSubMilestone = {
      ...subMilestone,
      id: "submilestone-2",
      title: "Second sub-step",
      order: 5,
    };
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [firstMilestone, secondMilestone],
          subMilestones: [firstSubMilestone, secondSubMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [firstMilestone, secondMilestone],
        subMilestones: [firstSubMilestone, secondSubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        summary,
      },
    });

    await normalizePccProjectSequence(state);

    const milestoneWrites = request.mock.calls.filter(
      ([method]) => method === "pcc.milestones.upsert",
    );
    expect(milestoneWrites).toEqual([
      [
        "pcc.milestones.upsert",
        { milestone: expect.objectContaining({ id: "milestone-1", order: 1_000_000_000 }) },
      ],
      [
        "pcc.milestones.upsert",
        { milestone: expect.objectContaining({ id: "milestone-1", order: 10 }) },
      ],
    ]);
    const subMilestoneWrites = request.mock.calls.filter(
      ([method]) => method === "pcc.subMilestones.upsert",
    );
    expect(subMilestoneWrites).toEqual([
      [
        "pcc.subMilestones.upsert",
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-1",
            order: 1_000_000_000,
          }),
        },
      ],
      [
        "pcc.subMilestones.upsert",
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-2",
            order: 1_000_000_001,
          }),
        },
      ],
      [
        "pcc.subMilestones.upsert",
        { subMilestone: expect.objectContaining({ id: "submilestone-1", order: 10 }) },
      ],
      [
        "pcc.subMilestones.upsert",
        { subMilestone: expect.objectContaining({ id: "submilestone-2", order: 20 }) },
      ],
    ]);
    expect(state.pccActionNotice?.text).toBe("Saved a clean milestone and sub-step sequence.");
  });

  it("removes only stale dependency links from milestones and sub-milestones", async () => {
    const firstMilestone = { ...milestone, dependsOn: ["missing-milestone"] };
    const secondMilestone = { ...milestone, id: "milestone-2", title: "Second", order: 20 };
    const firstSubMilestone = {
      ...subMilestone,
      dependsOn: ["missing-sub-step", "submilestone-2", "milestone-2"],
    };
    const secondSubMilestone = {
      ...subMilestone,
      id: "submilestone-2",
      title: "Second sub-step",
      order: 20,
    };
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [firstMilestone, secondMilestone],
          subMilestones: [firstSubMilestone, secondSubMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [firstMilestone, secondMilestone],
        subMilestones: [firstSubMilestone, secondSubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        summary,
      },
    });

    await removePccStaleDependencies(state);

    expect(request).toHaveBeenCalledWith("pcc.milestones.upsert", {
      milestone: expect.objectContaining({ id: "milestone-1", dependsOn: [] }),
    });
    expect(request).toHaveBeenCalledWith("pcc.subMilestones.upsert", {
      subMilestone: expect.objectContaining({
        id: "submilestone-1",
        dependsOn: ["submilestone-2", "milestone-2"],
      }),
    });
    expect(state.pccActionNotice?.text).toBe("Removed stale dependency links from this project.");
  });

  it("repairs duplicate milestone and sub-milestone titles deterministically", async () => {
    const firstMilestone = { ...milestone, title: "Plan", order: 10 };
    const duplicateMilestone = { ...milestone, id: "milestone-2", title: "Plan", order: 20 };
    const existingSuffixMilestone = {
      ...milestone,
      id: "milestone-3",
      title: "Plan (2)",
      order: 30,
    };
    const firstSubMilestone = { ...subMilestone, title: "Gather proof", order: 10 };
    const duplicateSubMilestone = {
      ...subMilestone,
      id: "submilestone-2",
      title: "Gather proof",
      order: 20,
    };
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [
            firstMilestone,
            { ...duplicateMilestone, title: "Plan (3)" },
            existingSuffixMilestone,
          ],
          subMilestones: [
            firstSubMilestone,
            { ...duplicateSubMilestone, title: "Gather proof (2)" },
          ],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [firstMilestone, duplicateMilestone, existingSuffixMilestone],
        subMilestones: [firstSubMilestone, duplicateSubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        summary,
      },
    });

    await repairPccDuplicateTitles(state);

    expect(request).toHaveBeenCalledWith("pcc.milestones.upsert", {
      milestone: expect.objectContaining({ id: "milestone-2", title: "Plan (3)" }),
    });
    expect(request).toHaveBeenCalledWith("pcc.subMilestones.upsert", {
      subMilestone: expect.objectContaining({ id: "submilestone-2", title: "Gather proof (2)" }),
    });
    expect(request).not.toHaveBeenCalledWith(
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({ id: "milestone-1" }),
      }),
    );
    expect(state.pccActionNotice?.text).toBe(
      "Made duplicate milestone and sub-step titles unique.",
    );
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
        evidence: [],
        receipts: [],
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

  it("previews and applies chat sync milestone proposals", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ milestone: { ...milestone, title: "Chat Sync" }, summary })
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({
        project,
        milestones: [{ ...milestone, title: "Chat Sync" }],
        permissions: [permission],
        evidence: [],
        receipts: [],
        summary,
      });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccSelectedProjectId: "project-1",
      pccProjectDetail: {
        project,
        milestones: [milestone],
        permissions: [permission],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    updatePccChatSyncText(
      state,
      "PLEASE IMPLEMENT THIS PLAN:\n# Chat Sync\n\nAcceptance criteria:\n- Local proof passes",
    );
    previewPccChatSync(state);

    expect(state.pccChatSyncProposals[0]?.kind).toBe("add_milestone");
    await applyPccChatSyncProposal(state, state.pccChatSyncProposals[0]);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.milestones.upsert", {
      milestone: expect.objectContaining({
        projectId: "project-1",
        title: "Chat Sync",
        implementationPlan: expect.stringContaining("# Chat Sync"),
      }),
    });
  });

  it("clears chat sync proposals", () => {
    const state = createState({
      pccChatSyncText: "PLEASE IMPLEMENT THIS PLAN:\n# Chat Sync",
      pccChatSyncProposals: [
        {
          id: "proposal-1",
          kind: "add_milestone",
          title: "Add milestone",
          summary: "summary",
          risky: false,
        },
      ],
    });

    dismissPccChatSync(state);

    expect(state.pccChatSyncText).toBe("");
    expect(state.pccChatSyncProposals).toHaveLength(0);
    expect(state.pccChatSyncError).toBeNull();
  });
  it("updates PCC view mode", () => {
    const requestUpdate = vi.fn();
    const state = createState({ requestUpdate });

    updatePccViewMode(state, "agent");

    expect(state.pccViewMode).toBe("agent");
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("updates PCC project edit mode", () => {
    const requestUpdate = vi.fn();
    const state = createState({ requestUpdate });

    updatePccProjectEditMode(state, "advanced");

    expect(state.pccProjectEditMode).toBe("advanced");
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("builds and applies scoped AI regenerate previews without broad milestone writes", async () => {
    const detail = {
      project: { ...project, goal: "" },
      milestones: [milestone],
      subMilestones: [subMilestone],
      permissions: [],
      evidence: [],
      receipts: [],
      summary,
    };
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.upsert") {
        return { project: { ...project, goal: "Track all projects" } };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return detail;
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
    });

    state.pccAutofillPreview = buildPccSectionAutofillPreview(detail, "goal");
    await applyPccSetupAutofill(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({
          goal: expect.stringContaining("Project Command Center"),
        }),
      }),
    );
    expect(request.mock.calls.some(([method]) => method === "pcc.milestones.upsert")).toBe(false);
    expect(request.mock.calls.some(([method]) => method === "pcc.subMilestones.upsert")).toBe(
      false,
    );
  });

  it("canonicalizes legacy recommendedWorker during setup autofill", async () => {
    const legacyMilestone = {
      ...milestone,
      metadata: {
        recommendedWorker: "OpenClaw local agent",
        proofRequired: "local_test",
      },
    };
    const detail = {
      project,
      milestones: [legacyMilestone],
      subMilestones: [subMilestone],
      permissions: [],
      evidence: [],
      receipts: [],
      summary,
    };
    const preview = buildPccSetupAutofillPreview(detail, true);

    expect(preview.milestoneUpdates).toEqual([
      expect.objectContaining({ id: "milestone-1", fields: expect.arrayContaining(["owner"]) }),
    ]);

    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.upsert") {
        return { project, summary };
      }
      if (method === "pcc.milestones.upsert") {
        return { milestone: legacyMilestone, summary };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return { ...detail, decisions: [] };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccAutofillPreview: preview,
    });

    await applyPccSetupAutofill(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({
          metadata: expect.objectContaining({ pccResponsibility: "local_openclaw_agent" }),
        }),
      }),
    );
  });

  it("blocks prepare on an on-hold project with a resume-specific error", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project: { ...project, status: "on_hold" as const },
        milestones: [milestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: { ...summary, status: "on_hold" as const },
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toContain("Project is on hold");
    expect(state.pccActionError).toContain("Resume Project");
  });

  it("resumes scope-held projects without starting unsafe work", async () => {
    const heldProject = {
      ...project,
      status: "on_hold" as const,
      metadata: {
        ...project.metadata,
        pccCurrentScope: "excluded_project_specific_work",
      },
    };
    const blockedMilestone = {
      ...milestone,
      id: "toolchain",
      status: "on_hold" as const,
      blocker: "Project-specific work removed from current working scope.",
      metadata: {
        recommendedWorker: "local model/OpenClaw",
        proofRequired: "local_test",
        blockers: ["patch tool: flips or beat"],
        excludedFromPccCurrentScope: true,
        noInstall: true,
        noRomFiles: true,
      },
    };
    const futureMilestone = {
      ...milestone,
      id: "mvp",
      title: "Build MVP",
      status: "on_hold" as const,
      order: 2,
      blocker: "Project-specific work removed from current working scope.",
      metadata: {
        recommendedWorker: "Codex",
        proofRequired: "runtime",
        waitingOn: ["toolchain blockers"],
        excludedFromPccCurrentScope: true,
        noBuildWorkApproved: true,
      },
    };
    const heldSubMilestone = {
      ...subMilestone,
      milestoneId: "toolchain",
      status: "on_hold" as const,
      blocker: "Project-specific work removed from current working scope.",
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        proofRequired: "Patch tool command exits 0 or records exact blocker.",
        excludedFromPccCurrentScope: true,
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.upsert") {
        return { project: heldProject, summary };
      }
      if (method === "pcc.milestones.upsert") {
        return { milestone: blockedMilestone, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone: heldSubMilestone };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project: { ...heldProject, status: "active" },
          milestones: [{ ...blockedMilestone, status: "blocked" }, futureMilestone],
          subMilestones: [heldSubMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project: heldProject,
        milestones: [blockedMilestone, futureMilestone],
        subMilestones: [heldSubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: { ...summary, status: "on_hold" as const },
      },
    });

    await resumePccProjectForWork(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({
          status: "active",
          metadata: expect.objectContaining({
            pccCurrentScope: "active_project_work",
            pccWorkLoop: expect.objectContaining({ enabled: false, state: "idle" }),
          }),
        }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({
          id: "toolchain",
          status: "blocked",
          blocker: "Blocked by patch tool: flips or beat.",
          metadata: expect.objectContaining({
            excludedFromPccCurrentScope: false,
            noInstall: true,
            noRomFiles: true,
          }),
        }),
      }),
    );
    expect(request).not.toHaveBeenCalledWith(
      "pcc.subMilestones.upsert",
      expect.objectContaining({
        subMilestone: expect.objectContaining({ status: "in_progress" }),
      }),
    );
    expect(state.pccActionNotice?.text).toContain("Project resumed");
  });

  it("blocks dependency-breaking milestone reorders", async () => {
    const dependency = {
      ...milestone,
      id: "milestone-dependency",
      title: "Prerequisite",
      order: 1,
    };
    const dependent = {
      ...milestone,
      id: "milestone-dependent",
      title: "Dependent",
      order: 2,
      dependsOn: ["milestone-dependency"],
    };
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [dependency, dependent],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await movePccMilestoneBefore(state, dependent, dependency);

    expect(state.pccActionError).toContain("Cannot move before dependency");
    expect(request).not.toHaveBeenCalled();
  });

  it("stores undo actions for reversible milestone mutations", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.milestones.upsert") {
        return { milestone: { ...milestone, status: "deferred" }, summary };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [{ ...milestone, status: "deferred" }],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, milestone, "deferred");
    expect(state.pccActionNotice?.undoLabel).toBe("Undo");
    expect(state.pccLastUndoAction?.label).toContain("Restore CRUD UI");

    request.mockClear();
    await runPccUndoAction(state);
    expect(request).toHaveBeenCalledWith(
      "pcc.milestones.upsert",
      expect.objectContaining({
        milestone: expect.objectContaining({ id: milestone.id, title: milestone.title }),
      }),
    );
    expect(state.pccLastUndoAction).toBeNull();
  });

  it("sends schema-valid milestone and sub-milestone status payloads for legacy objects", async () => {
    const legacyMilestone = { ...milestone, order: -10 };
    const legacySubMilestone = { ...subMilestone, order: -3 };
    const request = vi.fn(async (method: string, params: unknown) => {
      assertValidPccWriteParams(method, params);
      if (method === "pcc.milestones.upsert") {
        return {
          milestone: {
            ...legacyMilestone,
            ...(params as { milestone: Partial<typeof legacyMilestone> }).milestone,
            createdAt: legacyMilestone.createdAt,
            updatedAt: "2026-06-26T00:01:00Z",
          },
          summary,
        };
      }
      if (method === "pcc.subMilestones.upsert") {
        return {
          subMilestone: {
            ...legacySubMilestone,
            ...(params as { subMilestone: Partial<typeof legacySubMilestone> }).subMilestone,
            createdAt: legacySubMilestone.createdAt,
            updatedAt: "2026-06-26T00:01:00Z",
          },
        };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [{ ...legacyMilestone, status: "skipped" as const }],
          subMilestones: [{ ...legacySubMilestone, status: "skipped" as const }],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [legacyMilestone],
        subMilestones: [legacySubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, legacyMilestone, "skipped", "Not needed.");

    const milestonePayload = request.mock.calls.find(
      ([method]) => method === "pcc.milestones.upsert",
    )?.[1] as { milestone: Record<string, unknown> } | undefined;
    const subMilestonePayload = request.mock.calls.find(
      ([method]) => method === "pcc.subMilestones.upsert",
    )?.[1] as { subMilestone: Record<string, unknown> } | undefined;
    expect(milestonePayload?.milestone).not.toHaveProperty("createdAt");
    expect(milestonePayload?.milestone).not.toHaveProperty("updatedAt");
    expect(milestonePayload?.milestone.order).toEqual(expect.any(Number));
    expect(milestonePayload?.milestone.order).toBeGreaterThanOrEqual(0);
    expect(subMilestonePayload?.subMilestone).not.toHaveProperty("createdAt");
    expect(subMilestonePayload?.subMilestone).not.toHaveProperty("updatedAt");
    expect(subMilestonePayload?.subMilestone.order).toEqual(expect.any(Number));
    expect(subMilestonePayload?.subMilestone.order).toBeGreaterThanOrEqual(0);
  });

  it("uses schema-valid positive temporary orders for milestone reordering", async () => {
    const first = { ...milestone, id: "first", title: "First", order: 10 };
    const second = { ...milestone, id: "second", title: "Second", order: 20 };
    const request = vi.fn(async (method: string, params: unknown) => {
      assertValidPccWriteParams(method, params);
      if (method === "pcc.milestones.upsert") {
        return {
          milestone: {
            ...first,
            ...(params as { milestone: Partial<typeof first> }).milestone,
            createdAt: first.createdAt,
            updatedAt: "2026-06-26T00:01:00Z",
          },
          summary,
        };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [second, first],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        };
      }
      return {};
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [first, second],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await movePccMilestoneBefore(state, second, first);

    const milestonePayloads = request.mock.calls
      .filter(([method]) => method === "pcc.milestones.upsert")
      .map(([, params]) => (params as { milestone: Record<string, unknown> }).milestone);
    expect(milestonePayloads.length).toBeGreaterThan(0);
    expect(milestonePayloads.every((payload) => !("createdAt" in payload))).toBe(true);
    expect(milestonePayloads.every((payload) => !("updatedAt" in payload))).toBe(true);
    expect(milestonePayloads.every((payload) => Number(payload.order) >= 0)).toBe(true);
    expect(milestonePayloads.some((payload) => Number(payload.order) >= 1_000_000_000)).toBe(true);
  });
});

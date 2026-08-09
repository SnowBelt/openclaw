import { describe, expect, it, vi } from "vitest";
import {
  validatePccMilestonesUpsertParams,
  validatePccProjectPlanCommitParams,
  validatePccProjectsUpsertParams,
  validatePccSubMilestonesUpsertParams,
} from "../../../../packages/gateway-protocol/src/index.js";
import {
  createPccExecutionPlan,
  transitionPccExecutionPlan,
} from "../../../../src/pcc/execution-plan.js";
import { resolvePccExecutionProfilePreset } from "../../../../src/pcc/execution-profile.js";
import type { PccMilestone, PccProject, PccSubMilestone } from "../types.ts";
import {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
  addPccCompletionReceipt,
  buildPccSectionAutofillPreview,
  applyPccSetupAutofill,
  buildPccSetupAutofillPreview,
  applyPccChatSyncProposal,
  buildPccExecutionTeamReadiness,
  dismissPccSetupAutofill,
  dismissPccChatSync,
  generatePccAutopilotLoopPrompts,
  generatePccProjectPlan,
  loadPccDashboard,
  movePccMilestoneBefore,
  movePccSubMilestoneBefore,
  normalizePccProjectSequence,
  repairPccDuplicateTitles,
  removePccStaleDependencies,
  restorePccLocation,
  openPccDecisionForm,
  openPccMilestoneEditor,
  openPccProjectEditor,
  previewPccSetupAutofill,
  previewPccChatSync,
  resumePccProjectForWork,
  runPccAutopilotLoopAction,
  runPccExecutionTeamAction,
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
  updatePccPlanningPolicy,
  updatePccViewMode,
  updatePccProjectEditMode,
  updatePccProjectFilter,
  updatePccProjectForm,
  updatePccProjectSearchQuery,
  updatePccSurface,
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

const generatedPlanFixture = {
  schemaVersion: 1 as const,
  title: "Project Command Center",
  goal: "Track all projects",
  outcomeMetrics: ["Every milestone has receipt-backed proof."],
  workflowTemplateId: "software-product" as const,
  milestones: [
    {
      title: "Set up the project",
      phaseId: "setup",
      implementationPlan: "Define the project contract.",
      acceptanceCriteria: ["The project contract is reviewable."],
      responsibility: "local_openclaw_agent",
      proofLevel: "local",
      dependencies: [],
      subMilestones: [
        {
          title: "Confirm the setup",
          implementationPlan: "Verify the project setup.",
          acceptanceCriteria: ["The setup passes local proof."],
          responsibility: "local_openclaw_agent",
          proofLevel: "local",
        },
      ],
    },
  ],
  risks: [],
  assumptions: [],
  provenance: {
    generatedAt: "2026-08-01T00:01:00.000Z",
    provider: "openai" as const,
    model: "openai/gpt-5.6-sol",
    runtime: "codex" as const,
    effort: "medium" as const,
    auth: "oauth" as const,
    source: "live_codex" as const,
    planningOnly: true as const,
  },
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

function completedPlanningRun(plan: unknown) {
  return {
    run: {
      schemaVersion: 1,
      id: "planning-run-1",
      requestFingerprint: "planning-fingerprint",
      surface: "project_creation",
      status: "succeeded",
      stage: "ready",
      model: "openai/gpt-5.6-sol",
      effort: "medium",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:01.000Z",
      startedAt: "2026-07-27T00:00:00.000Z",
      endedAt: "2026-07-27T00:00:01.000Z",
      plan,
    },
  };
}

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

const teamCapacity = {
  logicalCpuCount: 12,
  performanceCpuCount: 8,
  totalRamGb: 64,
  freeRamGb: 48,
  load1: 1,
  load5: 1,
  load15: 1,
  memoryPressure: "low" as const,
  thermalPressure: "nominal" as const,
  activeOpenClawTaskCount: 0,
  configuredSubagentLimit: 4,
  observedLocalModelProcessCount: 0,
  safeLocalAgentSlots: 4,
  timestamp: "2026-07-13T12:00:00.000Z",
  warnings: [],
};

const teamModels = [
  {
    id: "qwen3.6",
    name: "Qwen 3.6",
    provider: "ollama",
    available: true,
    agentRuntime: { id: "openclaw", source: "model" as const },
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    provider: "openai",
    available: true,
    agentRuntime: { id: "codex", source: "model" as const },
  },
];

const teamAgents = {
  defaultId: "main",
  mainKey: "main",
  scope: "per-sender",
  agents: [
    {
      id: "main",
      name: "Local coordinator",
      model: { primary: "ollama/qwen3.6" },
      agentRuntime: { id: "openclaw", source: "model" as const },
    },
  ],
};

function executionTeamDetail(
  preset: "local_parallel" | "ultra_local" | "ultra_hybrid" = "local_parallel",
) {
  const executionMilestones = [
    {
      ...milestone,
      id: "team-milestone-1",
      title: "Build independent UI change",
      status: "not_started" as const,
      order: 1,
      percentComplete: 0,
      metadata: {
        ...milestone.metadata,
        parallelSafe: true,
        workspaceLock: "workspace:ui",
      },
    },
    {
      ...milestone,
      id: "team-milestone-2",
      title: "Add independent tests",
      status: "not_started" as const,
      order: 2,
      percentComplete: 0,
      metadata: {
        ...milestone.metadata,
        parallelSafe: true,
        workspaceLock: "workspace:tests",
      },
    },
  ];
  const executionSubMilestones = executionMilestones.map((parent, index) => ({
    ...subMilestone,
    id: `team-submilestone-${index + 1}`,
    milestoneId: parent.id,
    title: `Execute ${parent.title}`,
    status: "not_started" as const,
    order: 1,
    percentComplete: 0,
    metadata: {
      ...subMilestone.metadata,
      pccProofLevel: "local",
      parallelSafe: true,
      workspaceLock: index === 0 ? "workspace:ui" : "workspace:tests",
    },
  }));
  return {
    project: {
      ...project,
      metadata: {
        ...project.metadata,
        pccExecutionProfile: resolvePccExecutionProfilePreset(preset),
      },
    },
    milestones: executionMilestones,
    subMilestones: executionSubMilestones,
    permissions: [],
    evidence: [],
    receipts: [],
    summary: {
      ...summary,
      status: "active" as const,
      percentComplete: 0,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
    },
  };
}

function assertValidPccWriteParams(method: string, params: unknown): void {
  if (method === "pcc.projects.commitPlan" && !validatePccProjectPlanCommitParams(params)) {
    throw new Error(
      `invalid project plan commit payload: ${JSON.stringify(validatePccProjectPlanCommitParams.errors)}`,
    );
  }
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
  it("restores project and overview locations for browser back and forward navigation", () => {
    const detail = executionTeamDetail();
    const requestUpdate = vi.fn();
    const state = createState({
      pccProjectDetails: { [detail.project.id]: detail },
      requestUpdate,
    });

    vi.stubGlobal("location", {
      href: `http://localhost/pcc?pcc=project&project=${detail.project.id}`,
    });
    restorePccLocation(state);

    expect(state.pccSurface).toBe("project");
    expect(state.pccSelectedProjectId).toBe(detail.project.id);
    expect(state.pccProjectDetail).toBe(detail);

    vi.stubGlobal("location", { href: "http://localhost/pcc?pcc=overview" });
    restorePccLocation(state);

    expect(state.pccSurface).toBe("overview");
    expect(state.pccSelectedProjectId).toBeNull();
    expect(state.pccProjectDetail).toBeNull();
    expect(requestUpdate).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("updates project search query state", () => {
    const requestUpdate = vi.fn();
    const state = createState({ requestUpdate });

    updatePccProjectSearchQuery(state, "blocked proof");

    expect(state.pccProjectSearchQuery).toBe("blocked proof");
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("restores and updates Projects filter and search deep links", () => {
    const requestUpdate = vi.fn();
    const state = createState({ requestUpdate, pccSurface: "overview" });
    const pushState = vi.fn();
    const replaceState = vi.fn();
    vi.stubGlobal("history", { pushState, replaceState });
    vi.stubGlobal("location", {
      href: "http://localhost/pcc?pcc=projects&pccFilter=archived&pccQuery=SNES",
    });

    restorePccLocation(state);

    expect(state.pccSurface).toBe("projects");
    expect(state.pccProjectFilter).toBe("archived");
    expect(state.pccProjectSearchQuery).toBe("SNES");

    updatePccProjectFilter(state, "completed");
    expect(pushState).toHaveBeenCalledWith(
      {},
      "",
      expect.objectContaining({ search: expect.stringContaining("pccFilter=completed") }),
    );

    updatePccProjectSearchQuery(state, "finished build");
    expect(replaceState).toHaveBeenCalledWith(
      {},
      "",
      expect.objectContaining({ search: expect.stringContaining("pccQuery=finished+build") }),
    );

    updatePccSurface(state, "overview");
    updatePccSurface(state, "projects");
    expect(pushState).toHaveBeenLastCalledWith(
      {},
      "",
      expect.objectContaining({
        search: expect.stringMatching(
          /pcc=projects.*pccFilter=completed.*pccQuery=finished\+build/u,
        ),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("loads project list and portfolio summary", async () => {
    const releaseGovernance = {
      schema: "openclaw.release-governance-status.v1",
      proofProfile: "default",
      proofProfileVersion: 1,
      proofPhase: "candidate",
      candidateSha: "a".repeat(40),
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ projects: [summary] })
      .mockResolvedValueOnce({ portfolio, releaseGovernance })
      .mockResolvedValueOnce({ presence: [] });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await loadPccDashboard(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.overview.get", {});
    expect(request).toHaveBeenNthCalledWith(2, "pcc.summary.get", {});
    expect(request).toHaveBeenNthCalledWith(3, "pcc.presence.update", {
      displayName: "Team member",
      editing: false,
      status: "online",
      surface: "overview",
    });
    expect(state.pccProjects).toHaveLength(1);
    expect(state.pccProjects[0]?.title).toBe("Project Command Center");
    expect(state.pccPortfolioSummary?.averagePercentComplete).toBe(25);
    expect(state.pccReleaseGovernance?.candidateSha).toBe("a".repeat(40));
    expect(state.pccLoading).toBe(false);
    expect(state.pccError).toBeNull();
    expect(state.pccUpdatedAt).toEqual(expect.any(Number));
  });

  it("opens the work overview without auto-selecting the internal PCC Product record", async () => {
    const pccSummary = {
      ...summary,
      id: "project-command-center",
      title: "Project Command Center",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ projects: [pccSummary] })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({ presence: [] });
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await loadPccDashboard(state);

    expect(request).toHaveBeenCalledTimes(3);
    expect(state.pccSurface).toBe("overview");
    expect(state.pccSelectedProjectId).toBeNull();
    expect(state.pccProjectDetails["project-command-center"]).toBeUndefined();
  });

  it("replaces cached data atomically without hiding live user projects", async () => {
    const cachedPcc = {
      ...summary,
      id: "project-command-center",
      title: "Project Command Center",
    };
    const liveProjects = [
      { ...summary, id: "snes-one", title: "SNES One" },
      { ...summary, id: "snes-two", title: "SNES Two" },
    ];
    const request = vi
      .fn()
      .mockResolvedValueOnce({ projects: liveProjects })
      .mockResolvedValueOnce({ portfolio })
      .mockResolvedValueOnce({ presence: [] });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjects: [cachedPcc],
      pccSelectedProjectId: cachedPcc.id,
      pccSurface: "overview",
    });

    await loadPccDashboard(state);

    expect(state.pccProjects.map((item) => item.id)).toEqual(["snes-one", "snes-two"]);
    expect(state.pccSurface).toBe("overview");
    expect(state.pccSelectedProjectId).toBeNull();
  });

  it("computes fallback portfolio attention metrics when summary omits them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T00:00:00.000Z"));
    try {
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
    } finally {
      vi.useRealTimers();
    }
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
      .mockResolvedValueOnce({ presence: [] })
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

  it("refuses contracted completion when capability-use telemetry is missing", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project: {
          ...project,
          metadata: {
            ...project.metadata,
            pccCapabilityContract: { schema: "openclaw.pcc.capability-contract.v1" },
          },
        },
        milestones: [
          {
            ...milestone,
            phaseId: "production-proof",
            metadata: {
              ...milestone.metadata,
              pccCapabilityRequirementIds: ["truth-gated-completion"],
            },
          },
        ],
        permissions: [],
        evidence: [evidence],
        receipts: [],
        summary,
      },
    });

    await addPccCompletionReceipt(state, {
      ...milestone,
      phaseId: "production-proof",
      metadata: {
        ...milestone.metadata,
        pccCapabilityRequirementIds: ["truth-gated-completion"],
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toContain("Required capability-use evidence is missing");
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

  it("uses Codex for Autopilot planning and keeps local models as executors", async () => {
    let savedProject = project;
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "pcc.plans.generate") {
        return {
          plan: {
            schemaVersion: 1,
            title: "PCC Bug Hunt",
            goal: "Find and prioritize PCC defects.",
            outcomeMetrics: ["Every finding has proof."],
            workflowTemplateId: "software-product",
            milestones: [
              {
                title: "Audit interactions",
                phaseId: "mvp",
                implementationPlan: "Exercise each interaction and record failures.",
                acceptanceCriteria: ["Every interaction has a result."],
                responsibility: "local_openclaw_agent",
                proofLevel: "local",
                dependencies: [],
                subMilestones: [
                  {
                    title: "Test controls",
                    implementationPlan: "Run the interaction matrix.",
                    acceptanceCriteria: ["Results are recorded."],
                    responsibility: "local_openclaw_agent",
                    proofLevel: "local",
                  },
                ],
              },
            ],
            risks: [],
            assumptions: [],
            provenance: {
              generatedAt: "2026-07-22T12:00:00.000Z",
              provider: "openai",
              model: "openai/gpt-5.6-sol",
              runtime: "codex",
              effort: "medium",
              auth: "oauth",
              source: "live_codex",
              planningOnly: true,
            },
          },
        };
      }
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

    await generatePccAutopilotLoopPrompts(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.plans.generate",
      expect.objectContaining({ surface: "autopilot_prompts" }),
    );
    const autopilot = (
      savedProject.metadata as
        | {
            pccAutopilot?: {
              promptSlots?: Array<{ executor?: string; title?: string }>;
              lastOutputSummary?: string;
            };
          }
        | undefined
    )?.pccAutopilot;
    expect(autopilot?.promptSlots?.[0]).toMatchObject({
      executor: "local_model",
      title: "Audit interactions",
    });
    expect(autopilot?.lastOutputSummary).toContain("openai/gpt-5.6-sol");
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
    expect(state.pccActionNotice?.text).toContain("Work This Project is on");
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
    expect(state.pccActionNotice?.text).toContain("Next safe task prepared");
  });

  it("refreshes skill inventory and persists capability preflight before contracted work", async () => {
    const contractedProject = {
      ...project,
      metadata: {
        ...project.metadata,
        pccRequiredTools: ["memory_search"],
        pccRequiredPlugins: ["memory-core"],
        pccRequiredSoftware: ["git"],
        pccCapabilityContract: {
          schema: "openclaw.pcc.capability-contract.v1",
          workflowTemplateId: "software-product",
          qualityThreshold: 93,
        },
      },
    };
    const contractedMilestone = {
      ...milestone,
      status: "not_started" as const,
      phaseId: "mvp",
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        pccCapabilityContractSchema: "openclaw.pcc.capability-contract.v1",
        pccCapabilityRequirementIds: ["targeted-proof", "openclaw-testing"],
      },
    };
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "skills.status") {
        return {
          workspaceDir: "/tmp/workspace",
          managedSkillsDir: "/tmp/skills",
          skills: [
            {
              skillKey: "openclaw-testing",
              name: "openclaw-testing",
              eligible: true,
              modelVisible: true,
              requirements: { bins: ["git"], env: [], config: [], os: [] },
              missing: { bins: [], env: [], config: [], os: [] },
            },
          ],
        };
      }
      if (method === "tools.catalog") {
        return {
          agentId: "main",
          profiles: [],
          groups: [
            {
              id: "memory-core",
              label: "Memory",
              source: "plugin",
              pluginId: "memory-core",
              tools: [
                {
                  id: "memory_search",
                  label: "Memory search",
                  description: "Search memory",
                  source: "plugin",
                  pluginId: "memory-core",
                  defaultProfiles: ["full"],
                },
              ],
            },
          ],
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
          project: contractedProject,
          milestones: [{ ...contractedMilestone, status: "in_progress" }],
          subMilestones: [{ ...subMilestone, status: "complete", receiptIds: ["receipt-1"] }],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        };
      }
      return { project: contractedProject, milestone: contractedMilestone, summary };
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project: contractedProject,
        milestones: [contractedMilestone],
        subMilestones: [{ ...subMilestone, status: "complete", receiptIds: ["receipt-1"] }],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).toHaveBeenNthCalledWith(1, "skills.status", {});
    expect(request).toHaveBeenNthCalledWith(2, "tools.catalog", { includePlugins: true });
    expect(request).toHaveBeenCalledWith("pcc.projects.upsert", {
      project: expect.objectContaining({
        metadata: expect.objectContaining({
          pccCapabilityPreflight: expect.objectContaining({
            ready: true,
            qualityThreshold: 93,
            selectedCapabilityIds: expect.arrayContaining([
              "targeted-proof",
              "openclaw-testing",
              "memory_search",
              "memory-core",
              "git",
            ]),
          }),
        }),
      }),
    });
    expect(state.skillsReport?.skills[0]?.skillKey).toBe("openclaw-testing");
  });

  it("persists a blocked capability preflight before refusing work", async () => {
    const contractedProject = {
      ...project,
      metadata: {
        ...project.metadata,
        pccRequiredSkills: ["missing-required-skill"],
        pccCapabilityContract: {
          schema: "openclaw.pcc.capability-contract.v1",
          workflowTemplateId: "software-product",
          qualityThreshold: 93,
        },
      },
    };
    const contractedMilestone = {
      ...milestone,
      status: "not_started" as const,
      percentComplete: 0,
      phaseId: "tools-skills",
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        pccCapabilityContractSchema: "openclaw.pcc.capability-contract.v1",
        pccCapabilityRequirementIds: ["missing-required-skill"],
      },
    };
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "skills.status") {
        return { workspaceDir: "/tmp/workspace", managedSkillsDir: "/tmp/skills", skills: [] };
      }
      return { project: contractedProject, summary };
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project: contractedProject,
        milestones: [contractedMilestone],
        subMilestones: [subMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).toHaveBeenNthCalledWith(1, "skills.status", {});
    expect(request).toHaveBeenNthCalledWith(2, "tools.catalog", { includePlugins: true });
    expect(request).toHaveBeenNthCalledWith(3, "pcc.projects.upsert", {
      project: expect.objectContaining({
        metadata: expect.objectContaining({
          pccCapabilityPreflight: expect.objectContaining({
            ready: false,
            blockingRequirementIds: expect.arrayContaining(["missing-required-skill"]),
          }),
        }),
      }),
    });
    expect(state.pccActionError).toContain("missing-required-skill");
  });

  it("uses current agent and model inventory even when optional skill refresh fails", async () => {
    const contractedProject = {
      ...project,
      metadata: {
        ...project.metadata,
        pccRequiredAgents: ["main"],
        pccRequiredModels: ["ollama/gemma"],
        pccCapabilityContract: {
          schema: "openclaw.pcc.capability-contract.v1",
          workflowTemplateId: "software-product",
          qualityThreshold: 93,
        },
      },
    };
    const contractedMilestone = {
      ...milestone,
      status: "not_started" as const,
      phaseId: "tools-skills",
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        pccCapabilityContractSchema: "openclaw.pcc.capability-contract.v1",
        pccCapabilityRequirementIds: ["main", "ollama/gemma"],
      },
    };
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "skills.status") {
        throw new Error("skills refresh unavailable");
      }
      return { project: contractedProject, milestone: contractedMilestone, summary };
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      agentsList: {
        defaultId: "main",
        mainKey: "agent:main:main",
        scope: "global",
        agents: [{ id: "main", name: "Control Director" }],
      },
      chatModelCatalog: [{ provider: "ollama", id: "gemma", name: "Gemma", available: true }],
      pccProjectDetail: {
        project: contractedProject,
        milestones: [contractedMilestone],
        subMilestones: [{ ...subMilestone, status: "complete", receiptIds: ["receipt-1"] }],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await preparePccNextWorkItem(state);

    expect(request).toHaveBeenNthCalledWith(1, "skills.status", {});
    expect(request).toHaveBeenNthCalledWith(2, "tools.catalog", { includePlugins: true });
    expect(request).toHaveBeenCalledWith("pcc.projects.upsert", {
      project: expect.objectContaining({
        metadata: expect.objectContaining({
          pccCapabilityPreflight: expect.objectContaining({
            ready: true,
            selectedCapabilityIds: expect.arrayContaining(["main", "ollama/gemma"]),
          }),
        }),
      }),
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
    expect(state.pccActionNotice?.text).toContain("Next safe task prepared");
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
    expect(state.pccSurface).toBe("project");
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
    const request = vi.fn(async (method: string, _params?: unknown) => {
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
      if (method === "pcc.plans.generate") {
        return {
          plan: {
            schemaVersion: 1,
            title: "Project Command Center",
            goal: "Repair PCC setup safely.",
            outcomeMetrics: ["Setup evaluation passes."],
            workflowTemplateId: "software-product",
            milestones: [],
            risks: [],
            assumptions: [],
            provenance: {
              generatedAt: "2026-07-22T12:00:00.000Z",
              provider: "openai",
              model: "openai/gpt-5.6-sol",
              runtime: "codex",
              effort: "medium",
              auth: "oauth",
              source: "live_codex",
              planningOnly: true,
            },
          },
        };
      }
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

    await previewPccSetupAutofill(state);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "pcc.plans.generate",
      expect.objectContaining({
        surface: "setup_repair",
        existingTitle: "Project Command Center",
      }),
    );
    expect(state.pccAutofillPreview?.intakeApproved).toBe(false);

    updatePccAutofillApproval(state, true);
    expect(state.pccAutofillPreview?.intakeApproved).toBe(true);

    await applyPccSetupAutofill(state);

    expect(request.mock.calls[1]).toEqual([
      "pcc.projects.upsert",
      expect.objectContaining({
        project: expect.objectContaining({
          goal: "Repair PCC setup safely.",
          metadata: expect.objectContaining({
            pccIntake: expect.objectContaining({ approved: true, status: "approved" }),
            pccSetupAutofill: expect.objectContaining({ source: "live_codex" }),
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

  it("rolls back a parent and prior child writes when a cascaded status update conflicts", async () => {
    const secondSubMilestone = {
      ...subMilestone,
      id: "submilestone-2",
      title: "Second proof",
      order: 2,
    };
    const updatedMilestone = { ...milestone, status: "skipped" as const, revision: 2 };
    const updatedFirstSubMilestone = { ...subMilestone, status: "skipped" as const, revision: 2 };
    const concurrentlyChangedSecondSubMilestone = {
      ...secondSubMilestone,
      status: "deferred" as const,
      revision: 9,
    };
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.milestones.upsert") {
        return { milestone: updatedMilestone, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        const input = (params as { subMilestone: { id: string; status?: string } }).subMilestone;
        if (input.id === secondSubMilestone.id && input.status === "skipped") {
          throw new Error("simulated child revision conflict");
        }
        return { subMilestone: updatedFirstSubMilestone, summary };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [updatedMilestone],
          subMilestones: [updatedFirstSubMilestone, concurrentlyChangedSecondSubMilestone],
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
        subMilestones: [subMilestone, secondSubMilestone],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, milestone, "skipped", "No longer needed");

    expect(state.pccActionError).toContain("simulated child revision conflict");
    expect(request).toHaveBeenCalledWith("pcc.milestones.upsert", {
      milestone: expect.objectContaining({
        id: milestone.id,
        status: milestone.status,
        revision: 2,
      }),
    });
    expect(request).toHaveBeenCalledWith("pcc.subMilestones.upsert", {
      subMilestone: expect.objectContaining({
        id: subMilestone.id,
        status: subMilestone.status,
        revision: 2,
      }),
    });
    expect(
      request.mock.calls.filter(
        ([method, params]) =>
          method === "pcc.subMilestones.upsert" &&
          (params as { subMilestone: { id: string } }).subMilestone.id === secondSubMilestone.id,
      ),
    ).toHaveLength(1);
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
      assertValidPccWriteParams(method, params);
      if (method === "pcc.projects.commitPlan") {
        return {
          project,
          summary,
          milestones: [milestone],
          subMilestones: [subMilestone],
        };
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
      pccPlanningRun: {
        schemaVersion: 1,
        id: "planning-run-1",
        requestFingerprint: "fingerprint-1",
        surface: "project_creation",
        status: "succeeded",
        stage: "ready",
        model: "openai/gpt-5.6-sol",
        effort: "medium",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:01:00.000Z",
        startedAt: "2026-08-01T00:00:00.000Z",
        endedAt: "2026-08-01T00:01:00.000Z",
      },
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
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
        planningMode: "codex_full_plan",
        plannerMode: "codex",
        aiUsePolicy: "local_only",
        plannerModelId: "",
        plannerPermissionScope: "plan",
        plannerPermissionBudget: "",
        planPreviewAccepted: true,
        codexPlanningAllowed: true,
        executionProfile: resolvePccExecutionProfilePreset("local_focused"),
        remoteProofAllowed: false,
        runtimeActionsAllowed: false,
        intakeAnswers,
        intakeApproved: true,
        generatedPlan: generatedPlanFixture,
      },
    });

    await savePccProject(state);

    expect(request).toHaveBeenNthCalledWith(1, "pcc.projects.commitPlan", {
      planningRunId: "planning-run-1",
      plan: generatedPlanFixture,
      project: expect.objectContaining({
        title: "Project Command Center",
        goal: "Track all projects",
        status: "active",
        priority: 3,
        metadata: expect.objectContaining({
          pccWorkflowTemplateId: "software-product",
          pccExecutionProfile: expect.objectContaining({
            schemaVersion: 2,
            presetId: "local_focused",
            codexRole: "off",
          }),
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
    expect(request.mock.calls.some(([method]) => method === "pcc.milestones.upsert")).toBe(false);
    expect(request.mock.calls.some(([method]) => method === "pcc.subMilestones.upsert")).toBe(
      false,
    );
    expect(state.pccSelectedProjectId).toBe("project-1");
    expect(state.pccProjectFilter).toBe("all");
    expect(state.pccEditorMode).toBeNull();
    expect(state.pccActionNotice?.text).toContain("Project created");
    expect(state.pccActionNotice?.text).toContain(
      "Nothing runs until you choose Work This Project",
    );
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

  it("creates one durable project-scoped Codex grant after the New Project approval", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "pcc.projects.commitPlan") {
        return { project, summary, milestones: [milestone], subMilestones: [subMilestone] };
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
      chatModelCatalog: teamModels,
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Project Command Center",
        goal: "Track all projects",
        projectDescription: "Track all projects from a single Project Command Center.",
        planningMode: "codex_full_plan",
        plannerMode: "codex",
        aiUsePolicy: "codex_expert",
        executionProfile: resolvePccExecutionProfilePreset("balanced"),
        plannerPermissionScope: "project",
        codexPlanningAllowed: true,
        intakeAnswers,
        intakeApproved: true,
        planPreviewAccepted: true,
        generatedPlan: generatedPlanFixture,
      },
    });

    await savePccProject(state);

    expect(request.mock.calls.some(([method]) => method === "pcc.permissions.upsert")).toBe(true);
    const projectCall = request.mock.calls.find(([method]) => method === "pcc.projects.commitPlan");
    expect(projectCall?.[1]).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({
          metadata: expect.objectContaining({
            pccExecutionProfile: expect.objectContaining({
              presetId: "balanced",
              codexRole: "checkpoints",
            }),
          }),
        }),
        plan: generatedPlanFixture,
      }),
    );
    const permissionCall = request.mock.calls.find(
      ([method]) => method === "pcc.permissions.upsert",
    );
    expect(permissionCall?.[1]).toEqual(
      expect.objectContaining({
        permission: expect.objectContaining({
          type: "high_reasoning_model",
          status: "granted",
          grantedBy: "PCC New Project user approval",
          allowedActions: expect.arrayContaining([
            "Major project change: Codex",
            expect.stringContaining("Architecture decision: Automatic"),
            expect.stringContaining("Stuck or repeated failure: Automatic"),
            "Final completion review: Codex",
          ]),
          target: expect.stringContaining("Only these post-plan checkpoints"),
          forbiddenActions: [expect.stringContaining("Deployment")],
        }),
      }),
    );
    const permissionParams = permissionCall?.[1] as
      | { permission?: { maxUses?: number } }
      | undefined;
    expect(permissionParams?.permission?.maxUses).toBeUndefined();
  });

  it("creates the project but queues its visible Codex checkpoints when approval is deferred", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "pcc.projects.commitPlan") {
        return { project, summary, milestones: [milestone], subMilestones: [subMilestone] };
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
      chatModelCatalog: teamModels,
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Approval contract",
        goal: "Prove one Codex approval is required.",
        projectDescription: "Create a project with Balanced Codex.",
        aiUsePolicy: "codex_expert",
        executionProfile: resolvePccExecutionProfilePreset("balanced"),
        plannerMode: "codex",
        planningMode: "codex_full_plan",
        codexPlanningAllowed: false,
        intakeAnswers,
        intakeApproved: true,
        planPreviewAccepted: true,
        generatedPlan: generatedPlanFixture,
      },
    });

    await savePccProject(state);

    expect(state.pccActionError).toBeNull();
    const permissionCall = request.mock.calls.find(
      ([method]) => method === "pcc.permissions.upsert",
    );
    expect(permissionCall?.[1]).toEqual(
      expect.objectContaining({
        permission: expect.objectContaining({
          type: "high_reasoning_model",
          status: "needed",
          allowedActions: expect.not.arrayContaining([expect.stringContaining("Initial")]),
          note: expect.stringContaining("blocked until the user grants"),
        }),
      }),
    );
  });

  it("creates a project when Best available Codex will resolve at its future checkpoint", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.projects.commitPlan") {
        return { project, summary, milestones: [milestone], subMilestones: [subMilestone] };
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
      chatModelCatalog: [
        { ...teamModels[0]! },
        {
          ...teamModels[1]!,
          available: false,
        },
      ],
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Deferred Codex checkpoint",
        goal: "Create now and resolve Codex only when a checkpoint is reached.",
        projectDescription:
          "Create a project whose reviewed plan uses local workers and future Codex checkpoints.",
        executionProfile: resolvePccExecutionProfilePreset("balanced"),
        codexPlanningAllowed: true,
        intakeAnswers,
        intakeApproved: true,
        planPreviewAccepted: true,
        generatedPlan: generatedPlanFixture,
      },
    });

    await savePccProject(state);

    expect(state.pccActionError).toBeNull();
    expect(request).toHaveBeenCalledWith(
      "pcc.projects.commitPlan",
      expect.objectContaining({
        project: expect.objectContaining({
          metadata: expect.objectContaining({
            pccExecutionProfile: expect.objectContaining({
              codexModelId: "best_available",
              codexPolicyId: "recommended_minimum",
            }),
          }),
        }),
        plan: generatedPlanFixture,
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "pcc.permissions.upsert",
      expect.objectContaining({
        permission: expect.objectContaining({
          status: "granted",
          target: expect.stringContaining("post-plan checkpoints"),
        }),
      }),
    );
  });

  it("refuses to save a model that the live catalog marks unavailable", async () => {
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      chatModelCatalog: [
        {
          id: "removed-local",
          name: "Removed Local",
          provider: "ollama",
          available: false,
          agentRuntime: { id: "openclaw", source: "model" },
        },
      ],
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Unavailable model contract",
        goal: "Never dispatch removed model choices.",
        projectDescription: "Prove unavailable catalog rows cannot be saved.",
        executionProfile: {
          ...resolvePccExecutionProfilePreset("local_focused"),
          localModelId: "ollama/removed-local",
        },
        intakeAnswers,
        intakeApproved: true,
        planPreviewAccepted: true,
      },
    });

    await savePccProject(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toContain("no longer configured");
    expect(state.pccActionError).toContain("ollama/removed-local");
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
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.milestones.upsert") {
        const input = (params as { milestone: Partial<PccMilestone> }).milestone;
        return {
          milestone: { ...firstMilestone, ...input, revision: (input.revision ?? 1) + 1 },
          summary,
        };
      }
      if (method === "pcc.subMilestones.upsert") {
        const input = (params as { subMilestone: Partial<PccSubMilestone> }).subMilestone;
        return {
          subMilestone: {
            ...firstSubMilestone,
            ...input,
            revision: (input.revision ?? 1) + 1,
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
        {
          milestone: expect.objectContaining({ id: "milestone-3", order: 20, revision: 2 }),
        },
      ],
      [
        "pcc.milestones.upsert",
        {
          milestone: expect.objectContaining({ id: "milestone-2", order: 30, revision: 2 }),
        },
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
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-3",
            order: 20,
            revision: 2,
          }),
        },
      ],
      [
        "pcc.subMilestones.upsert",
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-2",
            order: 30,
            revision: 2,
          }),
        },
      ],
    ]);
  });

  it("rolls back successful reorder writes when a later order write fails", async () => {
    const firstMilestone = { ...milestone, id: "first", title: "First", order: 10 };
    const secondMilestone = { ...milestone, id: "second", title: "Second", order: 20 };
    const thirdMilestone = { ...milestone, id: "third", title: "Third", order: 30 };
    let failFinalWrite = true;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.milestones.upsert") {
        const input = (params as { milestone: Partial<PccMilestone> }).milestone;
        if (input.order === 20 && failFinalWrite) {
          failFinalWrite = false;
          throw new Error("simulated reorder failure");
        }
        return {
          milestone: { ...firstMilestone, ...input, revision: (input.revision ?? 1) + 1 },
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
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        summary,
      },
    });

    await movePccMilestoneBefore(state, thirdMilestone, secondMilestone);

    expect(state.pccActionError).toContain("simulated reorder failure");
    expect(state.pccLastUndoAction ?? null).toBeNull();
    expect(
      request.mock.calls
        .filter(([method]) => method === "pcc.milestones.upsert")
        .map(([, params]) => {
          const input = (params as { milestone: PccMilestone }).milestone;
          return [input.id, input.order];
        }),
    ).toEqual([
      ["third", 1_000_000_000],
      ["second", 1_000_000_001],
      ["third", 20],
      ["third", 1_000_000_000],
      ["second", 1_000_000_001],
      ["third", 30],
      ["second", 20],
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
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.milestones.upsert") {
        const input = (params as { milestone: Partial<PccMilestone> }).milestone;
        return {
          milestone: { ...firstMilestone, ...input, revision: (input.revision ?? 1) + 1 },
          summary,
        };
      }
      if (method === "pcc.subMilestones.upsert") {
        const input = (params as { subMilestone: Partial<PccSubMilestone> }).subMilestone;
        return {
          subMilestone: {
            ...firstSubMilestone,
            ...input,
            revision: (input.revision ?? 1) + 1,
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
        {
          milestone: expect.objectContaining({ id: "milestone-1", order: 10, revision: 2 }),
        },
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
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-1",
            order: 10,
            revision: 2,
          }),
        },
      ],
      [
        "pcc.subMilestones.upsert",
        {
          subMilestone: expect.objectContaining({
            id: "submilestone-2",
            order: 20,
            revision: 2,
          }),
        },
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

  it("keeps the creation review open for manual edits and resets it for a new request", () => {
    const state = createState({
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "Original title",
        goal: "Original goal",
        projectDescription: "Original request",
        planPreviewAccepted: true,
      },
    });

    updatePccProjectForm(state, { title: "Edited title", goal: "Edited goal" });
    expect(state.pccProjectForm.planPreviewAccepted).toBe(true);

    updatePccProjectForm(state, { projectDescription: "A materially different request" });
    expect(state.pccProjectForm.planPreviewAccepted).toBe(false);
    expect(state.pccProjectForm.generatedPlan).toBeNull();
  });

  it("does not turn a raw description into a fake project name before local AI plans it", () => {
    const state = createState({
      pccProjectForm: { ...EMPTY_PCC_PROJECT_FORM },
    });

    updatePccProjectForm(state, {
      projectDescription: "I want to replace my kitchen without missing permits.",
    });

    expect(state.pccProjectForm.title).toBe("");
    expect(state.pccProjectForm.goal).toBe("");
    expect(state.pccProjectForm.plannerMode).toBe("local_model");
    expect(state.pccProjectForm.planningMode).toBe("template_only");
  });

  it("uses live Codex planning while preserving user-entered project fields", async () => {
    const plan = {
      schemaVersion: 1 as const,
      title: "Generated Kitchen Project",
      goal: "Generated goal",
      outcomeMetrics: ["Permits and inspections are complete."],
      workflowTemplateId: "software-product" as const,
      milestones: [
        {
          title: "Plan permits",
          phaseId: "setup",
          implementationPlan: "List required permits.",
          acceptanceCriteria: ["Permit list is verified."],
          responsibility: "codex",
          proofLevel: "local",
          dependencies: [],
          subMilestones: [
            {
              title: "Check local rules",
              implementationPlan: "Review applicable rules.",
              acceptanceCriteria: ["Rules are cited."],
              responsibility: "local_openclaw_agent",
              proofLevel: "local",
            },
          ],
        },
      ],
      risks: ["Permit timing may change."],
      assumptions: ["The address is available."],
      provenance: {
        generatedAt: "2026-07-22T12:00:00.000Z",
        provider: "openai" as const,
        model: "openai/gpt-5.6-sol",
        runtime: "codex" as const,
        effort: "medium" as const,
        auth: "oauth" as const,
        source: "live_codex" as const,
        planningOnly: true as const,
      },
    };
    const request = vi.fn(async (method: string) =>
      method === "pcc.plans.start" ? completedPlanningRun(plan) : {},
    );
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: "My Kitchen Plan",
        goal: "Finish safely and on budget.",
        projectDescription: "Plan a kitchen remodel.",
        intakeAnswers: { owner: "Todd" },
      },
    });

    await generatePccProjectPlan(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.plans.start",
      expect.objectContaining({
        surface: "project_creation",
        depth: "automatic",
        existingTitle: "My Kitchen Plan",
        existingGoal: "Finish safely and on budget.",
      }),
    );
    expect(state.pccProjectForm).toMatchObject({
      title: "My Kitchen Plan",
      goal: "Finish safely and on budget.",
      outcomeMetrics: "Permits and inspections are complete.",
      planPreviewAccepted: true,
      intakeApproved: true,
      generatedPlan: plan,
      intakeAnswers: expect.objectContaining({ owner: "Todd" }),
    });
  });

  it("previews a natural-language project change without mutating active work", async () => {
    const plan = {
      schemaVersion: 1 as const,
      title: project.title,
      goal: project.goal,
      outcomeMetrics: ["The revised plan passes mobile proof."],
      workflowTemplateId: "software-product" as const,
      milestones: [
        {
          title: milestone.title,
          phaseId: "mvp",
          implementationPlan: "Finish the desktop UI and add mobile layout protection.",
          acceptanceCriteria: ["Desktop and mobile browser proof pass."],
          responsibility: "local_openclaw_agent",
          proofLevel: "local",
          dependencies: [],
          subMilestones: [],
        },
        {
          title: "Mobile launch proof",
          phaseId: "production-proof",
          implementationPlan: "Verify the project on a mobile viewport.",
          acceptanceCriteria: ["No controls overlap or clip."],
          responsibility: "local_openclaw_agent",
          proofLevel: "runtime",
          dependencies: [0],
          subMilestones: [],
        },
      ],
      risks: [],
      assumptions: [],
      provenance: {
        generatedAt: "2026-07-26T12:00:00.000Z",
        provider: "openai" as const,
        model: "openai/gpt-5.6-sol",
        runtime: "codex" as const,
        effort: "medium" as const,
        auth: "oauth" as const,
        source: "live_codex" as const,
        planningOnly: true as const,
      },
    };
    const request = vi.fn(async (method: string) =>
      method === "pcc.plans.start" ? completedPlanningRun(plan) : {},
    );
    const detail = {
      project,
      milestones: [milestone],
      subMilestones: [subMilestone],
      permissions: [],
      evidence: [],
      receipts: [],
      decisions: [],
      lastKnownGood: [],
      summary,
    };
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        id: project.id,
        title: project.title,
        goal: project.goal,
        changeRequest: "Add mobile launch proof without changing completed work.",
      },
    });

    await generatePccProjectPlan(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.plans.start",
      expect.objectContaining({
        surface: "project_replan",
        description: expect.stringContaining("Requested project change"),
        constraints: expect.arrayContaining(["Preserve completed milestones and their receipts."]),
      }),
    );
    expect(state.pccProjectForm).toMatchObject({
      planPreviewAccepted: false,
      generatedPlan: plan,
      planRevision: {
        safeToApply: true,
        addedMilestones: 1,
        updatedMilestones: 1,
        mustPauseActiveWork: true,
        sourceModel: "openai/gpt-5.6-sol",
      },
    });
    expect(state.pccProjectDetail?.milestones[0]?.status).toBe("in_progress");

    state.chatModelCatalog = teamModels;
    state.pccProjectForm = {
      ...state.pccProjectForm,
      intakeAnswers,
      intakeApproved: true,
      planPreviewAccepted: true,
    };
    state.pccProjectDetail = {
      ...detail,
      milestones: [{ ...milestone, updatedAt: "2026-07-26T12:01:00.000Z" }],
    };
    request.mockClear();

    await savePccProject(state);

    expect(state.pccActionError).toContain("changed after the preview");
    expect(request).not.toHaveBeenCalled();
  });

  it("restores project state when an accepted plan revision fails partway through", async () => {
    const plan = {
      schemaVersion: 1 as const,
      title: project.title,
      goal: project.goal,
      outcomeMetrics: ["The revised plan passes proof."],
      workflowTemplateId: "software-product" as const,
      milestones: [
        {
          title: milestone.title,
          phaseId: "mvp",
          implementationPlan: "A revised implementation plan.",
          acceptanceCriteria: ["Revised proof passes."],
          responsibility: "local_openclaw_agent",
          proofLevel: "local",
          dependencies: [],
          subMilestones: [],
        },
        {
          title: "New proof step",
          phaseId: "production-proof",
          implementationPlan: "Add a new proof step.",
          acceptanceCriteria: ["New proof passes."],
          responsibility: "local_openclaw_agent",
          proofLevel: "runtime",
          dependencies: [0],
          subMilestones: [],
        },
      ],
      risks: [],
      assumptions: [],
      provenance: {
        generatedAt: "2026-07-26T12:00:00.000Z",
        provider: "openai" as const,
        model: "openai/gpt-5.6-sol",
        runtime: "codex" as const,
        effort: "medium" as const,
        auth: "oauth" as const,
        source: "live_codex" as const,
        planningOnly: true as const,
      },
    };
    const detail = {
      project,
      milestones: [milestone],
      subMilestones: [subMilestone],
      permissions: [],
      evidence: [],
      receipts: [],
      decisions: [],
      lastKnownGood: [],
      summary,
    };
    const generateRequest = vi.fn(async (method: string) =>
      method === "pcc.plans.start" ? completedPlanningRun(plan) : {},
    );
    const state = createState({
      client: { request: generateRequest } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        id: project.id,
        title: project.title,
        goal: project.goal,
        changeRequest: "Revise active work and add the new proof step.",
      },
    });
    await generatePccProjectPlan(state);

    let currentProject: PccProject = { ...project };
    let currentMilestone: PccMilestone = { ...milestone };
    const saveRequest = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.projects.upsert") {
        const input = (params as { project: Partial<typeof project> }).project;
        currentProject = {
          ...currentProject,
          ...input,
          revision: (currentProject.revision ?? 1) + 1,
        };
        return { project: currentProject, summary };
      }
      if (method === "pcc.projects.get") {
        return {
          project: currentProject,
          milestones: [currentMilestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        };
      }
      if (method === "pcc.milestones.upsert") {
        const input = (params as { milestone: Partial<typeof milestone> }).milestone;
        if (input.title === "New proof step") {
          throw new Error("simulated revision write failure");
        }
        currentMilestone = {
          ...currentMilestone,
          ...input,
          revision: (currentMilestone.revision ?? 1) + 1,
        };
        return {
          milestone: currentMilestone,
        };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone };
      }
      return {};
    });
    state.client = { request: saveRequest } as unknown as PccDashboardState["client"];
    state.chatModelCatalog = teamModels;
    state.pccProjectForm = {
      ...state.pccProjectForm,
      intakeAnswers,
      intakeApproved: true,
      planPreviewAccepted: true,
    };

    await savePccProject(state);

    expect(state.pccActionError).toContain("simulated revision write failure");
    expect(state.pccActionNotice).toBeNull();
    const projectWrites = saveRequest.mock.calls.filter(
      ([method]) => method === "pcc.projects.upsert",
    );
    expect(projectWrites).toHaveLength(2);
    expect(projectWrites.at(-1)?.[1]).toEqual({
      project: expect.objectContaining({
        id: project.id,
        title: project.title,
        metadata: project.metadata,
      }),
    });
    expect(saveRequest).toHaveBeenCalledWith("pcc.milestones.upsert", {
      milestone: expect.objectContaining({
        id: milestone.id,
        title: milestone.title,
        implementationPlan: milestone.implementationPlan,
        status: milestone.status,
      }),
    });
    expect(
      saveRequest.mock.calls.filter(([method]) => method === "pcc.subMilestones.upsert"),
    ).toHaveLength(0);
  });

  it("revokes and restores the persistent planning-only grant", async () => {
    const request = vi.fn(async (_method: string, params: unknown) => ({
      policy: {
        schemaVersion: 1,
        provider: "openai",
        model: "openai/gpt-5.6-sol",
        runtime: "codex",
        depth: "automatic",
        grant: {
          kind: "persistent_planning_only",
          enabled: (params as { enabled: boolean }).enabled,
          allowedSurfaces: [
            "project_creation",
            "project_replan",
            "setup_repair",
            "autopilot_prompts",
          ],
          forbiddenActions: ["implementation", "external_write"],
        },
      },
    }));
    const state = createState({ client: { request } as unknown as PccDashboardState["client"] });

    await updatePccPlanningPolicy(state, false);
    expect(request).toHaveBeenCalledWith(
      "pcc.planningPolicy.upsert",
      expect.objectContaining({ enabled: false, model: "ollama/qwen3.5:4b" }),
    );
    expect(state.pccPlanningPolicy?.grant.enabled).toBe(false);

    await updatePccPlanningPolicy(state, true);
    expect(state.pccPlanningPolicy?.grant.enabled).toBe(true);
  });

  it("atomically commits generated milestones, provenance, and dependencies", async () => {
    const request = vi.fn(async (method: string, payload?: Record<string, unknown>) => {
      assertValidPccWriteParams(method, payload);
      if (method === "pcc.projects.commitPlan") {
        return {
          project,
          summary,
          milestones: [
            { ...milestone, id: "generated-1", title: "Plan" },
            { ...milestone, id: "generated-2", title: "Build", dependsOn: ["generated-1"] },
          ],
          subMilestones: [subMilestone],
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
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        };
      }
      return {};
    });
    const generatedPlan = {
      schemaVersion: 1 as const,
      title: "Generated Project",
      goal: "Deliver a generated project.",
      outcomeMetrics: ["The generated project passes proof."],
      workflowTemplateId: "software-product" as const,
      milestones: [
        {
          title: "Plan",
          phaseId: "setup",
          implementationPlan: "Define the plan.",
          acceptanceCriteria: ["Plan is defined."],
          responsibility: "codex",
          proofLevel: "local",
          dependencies: [],
          subMilestones: [
            {
              title: "Define done",
              implementationPlan: "Write checks.",
              acceptanceCriteria: ["Checks exist."],
              responsibility: "local_openclaw_agent",
              proofLevel: "local",
            },
          ],
        },
        {
          title: "Build",
          phaseId: "mvp",
          implementationPlan: "Build the result.",
          acceptanceCriteria: ["Result works."],
          responsibility: "local_openclaw_agent",
          proofLevel: "local",
          dependencies: [0],
          subMilestones: [
            {
              title: "Implement",
              implementationPlan: "Implement the result.",
              acceptanceCriteria: ["Implementation passes."],
              responsibility: "local_openclaw_agent",
              proofLevel: "local",
            },
          ],
        },
      ],
      risks: [],
      assumptions: [],
      provenance: {
        generatedAt: "2026-07-22T12:00:00.000Z",
        provider: "openai" as const,
        model: "openai/gpt-5.6-sol",
        runtime: "codex" as const,
        effort: "medium" as const,
        auth: "oauth" as const,
        source: "live_codex" as const,
        planningOnly: true as const,
      },
    };
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      chatModelCatalog: teamModels,
      pccProjectForm: {
        ...EMPTY_PCC_PROJECT_FORM,
        title: generatedPlan.title,
        goal: generatedPlan.goal,
        projectDescription: "Build a generated project.",
        outcomeMetrics: generatedPlan.outcomeMetrics.join("\n"),
        workflowTemplateId: generatedPlan.workflowTemplateId,
        generatedPlan,
        planPreviewAccepted: true,
        intakeAnswers,
        intakeApproved: true,
      },
    });

    await savePccProject(state);

    expect(request).toHaveBeenCalledWith(
      "pcc.projects.commitPlan",
      expect.objectContaining({
        plan: generatedPlan,
        project: expect.objectContaining({
          metadata: expect.objectContaining({ pccPlanningProvenance: generatedPlan.provenance }),
        }),
      }),
    );
    expect(generatedPlan.milestones[1]?.dependencies).toEqual([0]);
    expect(request.mock.calls.some(([method]) => method === "pcc.milestones.upsert")).toBe(false);
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

    expect(state.pccActionError).toContain(
      "Cannot move “Dependent” before its dependency “Prerequisite”",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("blocks moving a prerequisite below a milestone that depends on it", async () => {
    const prerequisite = {
      ...milestone,
      id: "milestone-prerequisite",
      title: "Prerequisite",
      order: 10,
    };
    const dependent = {
      ...milestone,
      id: "milestone-dependent",
      title: "Dependent",
      order: 20,
      dependsOn: ["milestone-prerequisite"],
    };
    const later = {
      ...milestone,
      id: "milestone-later",
      title: "Later work",
      order: 30,
    };
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: {
        project,
        milestones: [prerequisite, dependent, later],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
    });

    await movePccMilestoneBefore(state, prerequisite, later);

    expect(state.pccActionError).toContain(
      "Cannot move “Dependent” before its dependency “Prerequisite”",
    );
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

  it("reopens terminal milestones before restoring their prior status on undo", async () => {
    let restored = false;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.milestones.upsert") {
        const input = (params as { milestone: Partial<PccMilestone> }).milestone;
        const status = input.status ?? "active";
        const revision = status === "complete" ? 2 : status === "not_started" ? 3 : 4;
        if (status === "not_started") {
          restored = true;
        }
        return {
          milestone: { ...milestone, ...input, status, revision },
          summary,
        };
      }
      if (method === "pcc.overview.get") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [
            {
              ...milestone,
              status: restored ? "active" : "complete",
              revision: restored ? 4 : 2,
            },
          ],
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
      pccProjectDetail: {
        project,
        milestones: [milestone],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, milestone, "complete");
    await runPccUndoAction(state);

    expect(
      request.mock.calls
        .filter(([method]) => method === "pcc.milestones.upsert")
        .map(([, params]) => {
          const input = (params as { milestone: PccMilestone }).milestone;
          return [input.status, input.revision];
        }),
    ).toEqual([
      ["complete", 1],
      ["not_started", 2],
      ["in_progress", 3],
    ]);
    expect(state.pccActionError).toBeNull();
    expect(state.pccLastUndoAction).toBeNull();
  });

  it("reopens skipped milestones before restoring a completed status on undo", async () => {
    const completedMilestone = { ...milestone, status: "complete" as const };
    let restored = false;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "pcc.milestones.upsert") {
        const input = (params as { milestone: Partial<PccMilestone> }).milestone;
        const status = input.status ?? "complete";
        const revision = status === "skipped" ? 2 : status === "not_started" ? 3 : 4;
        if (status === "not_started") {
          restored = true;
        }
        return {
          milestone: { ...completedMilestone, ...input, status, revision },
          summary,
        };
      }
      if (method === "pcc.overview.get") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio };
      }
      if (method === "pcc.projects.get") {
        return {
          project,
          milestones: [
            {
              ...completedMilestone,
              status: restored ? "complete" : "skipped",
              revision: restored ? 4 : 2,
            },
          ],
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
      pccProjectDetail: {
        project,
        milestones: [completedMilestone],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        summary,
      },
    });

    await setPccMilestoneStatus(state, completedMilestone, "skipped");
    await runPccUndoAction(state);

    expect(
      request.mock.calls
        .filter(([method]) => method === "pcc.milestones.upsert")
        .map(([, params]) => {
          const input = (params as { milestone: PccMilestone }).milestone;
          return [input.status, input.revision];
        }),
    ).toEqual([
      ["skipped", 1],
      ["not_started", 2],
      ["complete", 3],
    ]);
    expect(state.pccActionError).toBeNull();
    expect(state.pccLastUndoAction).toBeNull();
  });

  it("refuses milestone undo when another client changed the saved revision", async () => {
    let undoLoad = false;
    const request = vi.fn(async (method: string) => {
      if (method === "pcc.milestones.upsert") {
        return { milestone: { ...milestone, status: "deferred", revision: 2 }, summary };
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
          milestones: [
            {
              ...milestone,
              status: undoLoad ? "blocked" : "deferred",
              revision: undoLoad ? 3 : 2,
            },
          ],
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
    undoLoad = true;
    await runPccUndoAction(state);

    expect(state.pccActionError).toContain("changed after this status update");
    expect(
      request.mock.calls.filter(([method]) => method === "pcc.milestones.upsert"),
    ).toHaveLength(1);
    expect(state.pccLastUndoAction).not.toBeNull();
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

  it("admits only available OpenClaw models and never uses a Codex runtime as coordinator", () => {
    const detail = executionTeamDetail();
    const ready = buildPccExecutionTeamReadiness(detail, teamCapacity, teamAgents, teamModels);

    expect(ready).toMatchObject({
      status: "ready",
      admittedLocalAgents: 2,
      coordinatorAgentId: "main",
      workerModelId: "ollama/qwen3.6",
      codexAgents: 0,
    });

    const unavailable = buildPccExecutionTeamReadiness(
      detail,
      teamCapacity,
      teamAgents,
      teamModels.map((model) =>
        model.agentRuntime.id === "openclaw" ? { ...model, available: false } : model,
      ),
    );
    expect(unavailable).toMatchObject({ status: "blocked", workerModelId: null });
    expect(unavailable.reason).toContain("available local OpenClaw worker model");

    const hostedOnly = buildPccExecutionTeamReadiness(detail, teamCapacity, teamAgents, [
      {
        id: "gpt-5.6",
        name: "GPT-5.6",
        provider: "openai",
        available: true,
        route: "metered",
        agentRuntime: { id: "openclaw", source: "model" as const },
      },
    ]);
    expect(hostedOnly).toMatchObject({ status: "blocked", workerModelId: null });
    expect(hostedOnly.reason).toContain("available local OpenClaw worker model");

    const exactModelDetail = executionTeamDetail();
    exactModelDetail.project.metadata = {
      ...exactModelDetail.project.metadata,
      pccExecutionProfile: {
        ...resolvePccExecutionProfilePreset("local_parallel"),
        localModelId: "ollama/other-local",
      },
    };
    const exactModelRequired = buildPccExecutionTeamReadiness(
      exactModelDetail,
      teamCapacity,
      teamAgents,
      [
        ...teamModels,
        {
          id: "other-local",
          name: "Other Local",
          provider: "ollama",
          available: true,
          agentRuntime: { id: "openclaw", source: "model" as const },
        },
      ],
    );
    expect(exactModelRequired).toMatchObject({
      status: "blocked",
      workerModelId: "ollama/other-local",
      coordinatorAgentId: null,
    });
    expect(exactModelRequired.reason).toContain("configured with ollama/other-local");

    const codexCoordinator = buildPccExecutionTeamReadiness(
      detail,
      teamCapacity,
      {
        ...teamAgents,
        agents: [
          {
            ...teamAgents.agents[0],
            agentRuntime: { id: "codex", source: "agent" as const },
          },
        ],
      },
      teamModels,
    );
    expect(codexCoordinator).toMatchObject({ status: "blocked", coordinatorAgentId: null });
    expect(codexCoordinator.reason).toContain("non-Codex OpenClaw coordinator");
  });

  it("prefers the configured Program Manager as the supervised local coordinator", () => {
    const agents = {
      ...teamAgents,
      agents: [
        ...teamAgents.agents,
        {
          id: "pm",
          name: "Program Manager",
          role: "program_manager" as const,
          model: { primary: "ollama/qwen3.6" },
          agentRuntime: { id: "openclaw", source: "model" as const },
        },
      ],
    };

    expect(
      buildPccExecutionTeamReadiness(executionTeamDetail(), teamCapacity, agents, teamModels),
    ).toMatchObject({ status: "ready", coordinatorAgentId: "pm" });
  });

  it("requires one project-scoped Codex grant for Ultra hybrid and none for Ultra local", () => {
    const local = buildPccExecutionTeamReadiness(
      executionTeamDetail("ultra_local"),
      teamCapacity,
      teamAgents,
      teamModels,
    );
    expect(local).toMatchObject({ status: "ready", codexAgents: 0, codexModelId: null });

    const hybrid = executionTeamDetail("ultra_hybrid");
    expect(
      buildPccExecutionTeamReadiness(hybrid, teamCapacity, teamAgents, teamModels),
    ).toMatchObject({ status: "needs_approval", codexAgents: 1 });

    const granted = {
      ...hybrid,
      permissions: [
        {
          ...permission,
          id: "codex-grant",
          milestoneId: undefined,
          type: "high_reasoning_model" as const,
          status: "granted" as const,
          allowedActions: ["Use Codex as the scoped project lead"],
          usedCount: 0,
          grantedAt: "2026-07-13T12:00:00.000Z",
          auditLog: [
            {
              at: "2026-07-13T12:00:00.000Z",
              status: "granted" as const,
              note: "Project-scoped approval",
            },
          ],
        },
      ],
    };
    expect(
      buildPccExecutionTeamReadiness(granted, teamCapacity, teamAgents, teamModels),
    ).toMatchObject({ status: "ready", codexAgents: 1, codexModelId: "openai/gpt-5.6-sol" });

    const staleMaximumCatalog = teamModels.map((model) =>
      model.agentRuntime.id === "codex" ? { ...model, id: "gpt-5.5", name: "GPT-5.5" } : model,
    );
    const staleMaximum = buildPccExecutionTeamReadiness(
      granted,
      teamCapacity,
      teamAgents,
      staleMaximumCatalog,
    );
    expect(staleMaximum).toMatchObject({ status: "blocked" });
    expect(staleMaximum.reason).toContain("GPT-5.6");
  });

  it("blocks a workspace leased by another project team", () => {
    const detail = executionTeamDetail();
    const profile = resolvePccExecutionProfilePreset("local_parallel");
    const otherPlan = transitionPccExecutionPlan(
      createPccExecutionPlan({
        id: "other-plan",
        projectId: "project-2",
        projectRevision: "revision-2",
        profile,
        coordinator: { sessionId: "agent:other", runId: "other-run" },
        admittedWorkerCount: 1,
        partitions: [
          {
            id: "other-partition",
            taskId: "other-task",
            workerId: "other-worker",
            workspaceId: "workspace:ui",
            status: "running",
          },
        ],
        leases: [
          {
            workspaceId: "workspace:ui",
            planId: "other-plan",
            partitionId: "other-partition",
            holderId: "other-worker",
            acquiredAt: "2026-07-13T12:00:00.000Z",
            expiresAt: "2099-07-13T14:00:00.000Z",
          },
        ],
        createdAt: "2026-07-13T12:00:00.000Z",
      }),
      "dispatching",
      { at: "2026-07-13T12:00:01.000Z" },
    );
    const otherDetail = {
      ...detail,
      project: {
        ...detail.project,
        id: "project-2",
        title: "Another Project",
        metadata: {
          ...detail.project.metadata,
          pccWorkScope: "project_work",
          pccExecutionPlans: [otherPlan],
        },
      },
      milestones: [],
      summary: { ...detail.summary, id: "project-2", title: "Another Project" },
    };

    const readiness = buildPccExecutionTeamReadiness(detail, teamCapacity, teamAgents, teamModels, [
      otherDetail,
    ]);
    expect(readiness.status).toBe("blocked");
    expect(readiness.reason).toContain("workspace:ui");
    expect(readiness.reason).toContain("already leased");
  });

  it("persists the supervised plan before dispatch and never auto-completes milestones", async () => {
    const detail = executionTeamDetail();
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "pcc.projects.upsert") {
        const projectPatch = (params as { project: Partial<typeof detail.project> }).project;
        return {
          project: {
            ...detail.project,
            ...projectPatch,
            metadata: projectPatch.metadata ?? detail.project.metadata,
          },
          summary: detail.summary,
        };
      }
      if (method === "chat.send") {
        return { runId: "coordinator-run", status: "started" };
      }
      if (method === "chat.abort") {
        return { ok: true };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccProjectDetails: { [detail.project.id]: detail },
      pccExecutionCapacity: teamCapacity,
      agentsList: teamAgents,
      chatModelCatalog: teamModels,
    });

    await runPccExecutionTeamAction(state, "start");

    expect(request.mock.calls.filter(([method]) => method === "pcc.projects.upsert")).toHaveLength(
      3,
    );
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        agentId: "main",
        deliver: false,
        message: expect.stringContaining("Codex is OFF"),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: expect.stringContaining("pass each assignment's exact modelId"),
      }),
    );
    expect(request.mock.calls.some(([method]) => method === "pcc.milestones.upsert")).toBe(false);
    expect(request.mock.calls.some(([method]) => method === "pcc.subMilestones.upsert")).toBe(
      false,
    );
    expect(state.pccProjectDetail?.project.metadata).toEqual(
      expect.objectContaining({
        pccActiveExecutionPlanId: expect.stringContaining("pcc-team-project-1"),
        pccExecutionPlans: [
          expect.objectContaining({
            status: "running",
            admittedWorkerCount: 2,
            coordinator: expect.objectContaining({ runId: "coordinator-run" }),
            partitions: expect.arrayContaining([
              expect.objectContaining({
                modelId: "ollama/qwen3.6",
                modelRationale: expect.any(String),
              }),
            ]),
          }),
        ],
      }),
    );

    request.mockClear();
    await runPccExecutionTeamAction(state, "stop");
    expect(request).toHaveBeenCalledWith(
      "chat.abort",
      expect.objectContaining({ runId: "coordinator-run" }),
    );
    expect(state.pccProjectDetail?.project.metadata).toEqual(
      expect.objectContaining({
        pccActiveExecutionPlanId: null,
        pccExecutionPlans: [expect.objectContaining({ status: "cancelled" })],
      }),
    );
  });

  it("marks an execution plan blocked when a stop cannot be confirmed", async () => {
    const detail = executionTeamDetail();
    const runningPlan = transitionPccExecutionPlan(
      transitionPccExecutionPlan(
        createPccExecutionPlan({
          id: "running-plan",
          projectId: detail.project.id,
          projectRevision: detail.project.updatedAt,
          profile: resolvePccExecutionProfilePreset("local_parallel"),
          coordinator: { sessionId: "agent:main:pcc", runId: "run-1" },
          admittedWorkerCount: 1,
          createdAt: "2026-07-13T12:00:00.000Z",
        }),
        "dispatching",
        { at: "2026-07-13T12:00:01.000Z" },
      ),
      "running",
      { at: "2026-07-13T12:00:02.000Z" },
    );
    const runningDetail = {
      ...detail,
      project: {
        ...detail.project,
        metadata: {
          ...detail.project.metadata,
          pccExecutionPlans: [runningPlan],
          pccActiveExecutionPlanId: runningPlan.id,
        },
      },
    };
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "chat.abort") {
        throw new Error("coordinator unreachable");
      }
      if (method === "pcc.projects.upsert") {
        const projectPatch = (params as { project: Partial<typeof runningDetail.project> }).project;
        return {
          project: {
            ...runningDetail.project,
            ...projectPatch,
            metadata: projectPatch.metadata ?? runningDetail.project.metadata,
          },
          summary: runningDetail.summary,
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: runningDetail,
      pccProjectDetails: { [runningDetail.project.id]: runningDetail },
      pccExecutionCapacity: teamCapacity,
      agentsList: teamAgents,
      chatModelCatalog: teamModels,
    });

    await runPccExecutionTeamAction(state, "stop");

    expect(state.pccActionError).toContain("stop could not be confirmed");
    expect(state.pccProjectDetail?.project.metadata).toEqual(
      expect.objectContaining({
        pccActiveExecutionPlanId: runningPlan.id,
        pccExecutionPlans: [
          expect.objectContaining({
            status: "blocked",
            statusReason: expect.stringContaining("coordinator unreachable"),
          }),
        ],
      }),
    );
  });

  it("refuses to run an agent team in the wrong PCC focus scope", async () => {
    const detail = executionTeamDetail();
    const request = vi.fn();
    const state = createState({
      client: { request } as unknown as PccDashboardState["client"],
      pccProjectDetail: detail,
      pccProductFocusMode: "project_work",
      pccExecutionCapacity: teamCapacity,
      agentsList: teamAgents,
      chatModelCatalog: teamModels,
    });

    await runPccExecutionTeamAction(state, "start");

    expect(request).not.toHaveBeenCalled();
    expect(state.pccActionError).toContain("Switch to PCC Product");
  });
});

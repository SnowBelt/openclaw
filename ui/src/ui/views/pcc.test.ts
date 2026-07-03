/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
} from "../controllers/pcc.ts";
import { renderPccDashboard, type PccDashboardProps } from "./pcc.ts";

const project = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Track every project",
  status: "active" as const,
  priority: 3,
  metadata: {
    pccWorkflowTemplateId: "software-product",
    pccIntake: {
      approved: true,
      answers: {
        goal: "Track every project.",
        firstDeliverable: "A skimmable PCC view.",
        doneProof: "Tests and browser proof pass.",
        constraints: "No remote actions without permission.",
        owner: "local_openclaw_agent",
        blockers: "None.",
      },
    },
    pccQualityGate: { status: "passing" },
    pccSetupScore: { score: 100, runnable: true },
    pccCompliance: { badge: "Passing", status: "passing" },
    pccOutcomeMetrics: [
      "User understands next action in under 5 seconds.",
      "Every completed milestone has receipt-backed proof.",
    ],
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
  percentComplete: 42,
  implementationPlan: "Build compact forms",
  acceptanceCriteria: ["Local proof passes"],
  metadata: {
    pccResponsibility: "local_openclaw_agent",
    pccProofLevel: "local",
    pccCostRisk: "low",
  },
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const intakeAnswers = {
  goal: "Track every project.",
  firstDeliverable: "A skimmable PCC view.",
  doneProof: "Tests and browser proof pass.",
  constraints: "No remote actions without permission.",
  owner: "local_openclaw_agent",
  blockers: "None.",
};

const subMilestone = {
  id: "submilestone-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  title: "Run local proof",
  status: "not_started" as const,
  order: 1,
  owner: "local_openclaw_agent",
  percentComplete: 0,
  implementationPlan: "Run the exact local proof command and save the output.",
  acceptanceCriteria: ["Command exits 0", "Completion receipt is recorded"],
  metadata: {
    pccResponsibility: "local_openclaw_agent",
    pccCostRisk: "low",
    proofRequired: "Targeted local proof",
  },
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

const evidence = {
  id: "evidence-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  kind: "local_test" as const,
  status: "passed" as const,
  summary: "Local PCC proof passed",
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
  doNotRedo: ["Do not redo the local proof without a regression."],
  followUpGaps: ["Remote proof remains blocked"],
  completedBy: "Project Command Center",
  completedAt: "2026-06-26T00:00:00Z",
};

const decision = {
  id: "decision-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  title: "Use receipt-gated completion",
  summary: "Do not mark milestones complete without evidence-backed receipts.",
  rationale: "This keeps future agents from repeating false completion claims.",
  alternatives: ["Manual status only"],
  impact: "Better handoff trust.",
  decidedBy: "Codex",
  evidenceIds: ["evidence-1"],
  decidedAt: "2026-07-03T12:30:00Z",
};

const lastKnownGood = {
  id: "lkg-1",
  projectId: "project-1",
  subsystem: "Production runtime",
  summary: "Runtime serves the verified PCC build.",
  evidenceIds: ["evidence-1"],
  sha: "8bc48f54c4ec59f4deff058c0e5f6ca37c18b10a",
  runtimePath: "/Users/openclaw/OpenClaw-dashboard-production-runtime",
  screenshotPath: "/tmp/openclaw-dashboard-pcc-proof.png",
  verifiedAt: "2026-07-03T12:00:00Z",
};

const summary = {
  id: "project-1",
  title: "Project Command Center",
  status: "needs_approval" as const,
  percentComplete: 42,
  milestoneCounts: {
    total: 5,
    complete: 2,
    blocked: 0,
    needsApproval: 1,
    deferred: 0,
    skipped: 0,
  },
  nextActions: ["Run remote proof"],
  proofGaps: ["Workflow Sanity proof"],
  health: "Needs approval",
  dueDate: "2099-01-15T00:00:00.000Z",
  recentActivity: "Milestone updated: CRUD UI · 2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

function createProps(overrides: Partial<PccDashboardProps> = {}): PccDashboardProps {
  return {
    loading: false,
    error: null,
    connected: true,
    updatedAt: 1_772_000_000_000,
    portfolio: {
      projectsTotal: 1,
      active: 1,
      blocked: 0,
      needsApproval: 1,
      complete: 0,
      archived: 0,
      averagePercentComplete: 42,
      nextActions: ["Run remote proof"],
    },
    projects: [summary],
    selectedProjectId: "project-1",
    projectDetail: {
      project,
      milestones: [milestone],
      subMilestones: [],
      permissions: [permission],
      evidence: [],
      receipts: [],
      decisions: [],
      lastKnownGood: [],
      summary,
    },
    actionBusy: false,
    actionError: null,
    editorMode: null,
    projectForm: { ...EMPTY_PCC_PROJECT_FORM },
    milestoneForm: { ...EMPTY_PCC_MILESTONE_FORM, projectId: "project-1" },
    decisionFormOpen: false,
    decisionForm: { ...EMPTY_PCC_DECISION_FORM },
    chatSyncText: "",
    chatSyncProposals: [],
    chatSyncError: null,
    viewMode: "detailed",
    onSetViewMode: () => undefined,
    onRefresh: () => undefined,
    onSelectProject: () => undefined,
    onOpenProjectEditor: () => undefined,
    onOpenMilestoneEditor: () => undefined,
    onProjectFormChange: () => undefined,
    onMilestoneFormChange: () => undefined,
    onSaveProject: () => undefined,
    onSaveMilestone: () => undefined,
    onCancelEditor: () => undefined,
    onSetProjectStatus: () => undefined,
    onSetMilestoneStatus: () => undefined,
    onSetMilestoneStopHere: () => undefined,
    onAddCompletionReceipt: () => undefined,
    onSetPermissionStatus: () => undefined,
    onUpdateWorkLoop: () => undefined,
    onPrepareNextWorkItem: () => undefined,
    onChatSyncTextChange: () => undefined,
    onPreviewChatSync: () => undefined,
    onApplyChatSyncProposal: () => undefined,
    onDismissChatSync: () => undefined,
    ...overrides,
  };
}

function renderView(props: PccDashboardProps): HTMLElement {
  const container = document.createElement("div");
  render(renderPccDashboard(props), container);
  return container;
}

afterEach(() => {
  render(html``, document.body);
  vi.restoreAllMocks();
});

describe("renderPccDashboard", () => {
  it("renders summary metrics, project cards, and detail", () => {
    const container = renderView(createProps());
    const text = container.textContent ?? "";

    expect(text).toContain("Project Command Center");
    expect(text).toContain("Total projects");
    expect(text).toContain("Average completion");
    expect(text).toContain("2/5");
    expect(text).toContain("milestones complete");
    expect(text).toContain("Run remote proof");
    expect(text).toContain("Outcome metrics");
    expect(text).toContain("User understands next action in under 5 seconds.");
    expect(text).toContain("Outcomes: 2 metrics");
    expect(text).toContain("Health: Needs approval");
    expect(text).toContain("Priority: 3");
    expect(text).toContain("Blocker: Run remote proof");
    expect(text).toContain("Due:");
    expect(text).toContain("Activity: Milestone updated: CRUD UI");
    expect(container.querySelector("[data-pcc-project-orientation]")?.textContent).toContain(
      "Project Command Center",
    );
    expect(container.querySelector("[data-pcc-breadcrumbs]")?.textContent).toContain("CRUD UI");
    expect(container.querySelector("[data-pcc-project-orientation]")?.textContent).toContain(
      "Health",
    );
    expect(container.querySelector("[data-pcc-project-orientation]")?.textContent).toContain(
      "Priority",
    );
    expect(container.querySelector("[data-pcc-project-orientation]")?.textContent).toContain(
      "Recent",
    );
    expect(text).toContain("Workflow Sanity proof");
    expect(text).toContain("CRUD UI");
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-journey-step]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-permission]")).toHaveLength(1);
    expect(text).toContain("Permission needed");
    expect(text).toContain("Remote Proof");
    expect(text).toContain("Today");
    expect(text).toContain("Recent Activity");
    expect(text).toContain("What changed recently");
    expect(container.querySelector("[data-pcc-recent-activity]")?.textContent).toContain(
      "Milestone updated: CRUD UI",
    );
    expect(text).toContain("Needs You");
    expect(text).toContain("Project Snapshot");
    expect(container.querySelector("[data-pcc-project-snapshot]")?.textContent).toContain("Health");
    expect(container.querySelector("[data-pcc-project-snapshot]")?.textContent).toContain(
      "Priority",
    );
    expect(text).toContain("Milestone Journey");
    expect(text).toContain("Attention inbox");
    expect(text).toContain("Low-reasoning readiness");
    expect(text).toContain("Proof freshness");
    expect(text).toContain("Recovery playbooks");
    expect(text).toContain("Critical path");
    expect(text).toContain("Project history");
    expect(text).toContain("Any-source intake");
    expect(text).toContain("Next Safe Action");
    expect(container.querySelector("[data-pcc-today]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-next-safe-action]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-production-truth]")).not.toBeNull();
    expect(text).toContain("Production truth");
    expect(text).toContain("PCC remote Workflow Sanity proof missing");
  });

  it("routes integrity and proof gaps into Needs You", () => {
    const container = renderView(
      createProps({
        projects: [
          {
            ...summary,
            status: "active",
            health: "On track",
            proofGaps: ["Integrity issue: receipt references missing milestone: receipt-1"],
            milestoneCounts: { ...summary.milestoneCounts, blocked: 0, needsApproval: 0 },
          },
        ],
      }),
    );

    expect(container.querySelector("[data-pcc-needs-attention-now]")?.textContent).toContain(
      "Integrity/proof gap",
    );
    expect(container.querySelector("[data-pcc-needs-attention-now]")?.textContent).toContain(
      "Project Command Center",
    );
  });

  it("shows proof gaps as blocker context when no action blocker exists", () => {
    const container = renderView(
      createProps({
        projects: [
          {
            ...summary,
            nextActions: ["Continue implementation"],
            proofGaps: ["Browser proof missing"],
          },
        ],
      }),
    );

    const card = container.querySelector("[data-pcc-project-card]");
    expect(card?.textContent).toContain("Blocker: Browser proof missing");
  });

  it("renders action feedback with recovery actions instead of silent save ambiguity", () => {
    const onRefresh = vi.fn();
    const onDismissActionNotice = vi.fn();
    const failed = renderView(
      createProps({
        actionError: "ledger write failed",
        onRefresh,
      }),
    );

    const error = failed.querySelector("[data-pcc-action-error]");
    expect(error?.textContent).toContain("Action failed — nothing was saved");
    expect(error?.textContent).toContain("ledger write failed");
    const retry = [...failed.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Retry refresh"),
    );
    retry?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const saved = renderView(
      createProps({
        actionNotice: { kind: "success", text: "Saved new milestone order." },
        onRefresh,
        onDismissActionNotice,
      }),
    );
    const notice = saved.querySelector("[data-pcc-action-notice]");
    expect(notice?.textContent).toContain("Saved and refreshed");
    expect(notice?.textContent).toContain("PCC reloaded the project after this change.");
    expect(notice?.textContent).not.toContain("Undo");
    [...saved.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Dismiss"))
      ?.click();
    expect(onDismissActionNotice).toHaveBeenCalledTimes(1);
  });

  it("sorts recent activity so the newest project update is easiest to skim", () => {
    const older = {
      ...summary,
      id: "older-project",
      title: "Older Project",
      recentActivity: "Project updated · 2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    };
    const newer = {
      ...summary,
      id: "newer-project",
      title: "Newer Project",
      recentActivity: "Decision: Pick final architecture · 2026-07-03T14:00:00Z",
      updatedAt: "2026-07-03T14:00:00Z",
    };
    const container = renderView(
      createProps({
        projects: [older, summary, newer],
        portfolio: {
          projectsTotal: 3,
          active: 3,
          blocked: 0,
          needsApproval: 1,
          complete: 0,
          archived: 0,
          averagePercentComplete: 42,
          nextActions: ["Run remote proof"],
        },
      }),
    );

    const recent = container.querySelector("[data-pcc-recent-activity]");
    expect(recent).not.toBeNull();
    const items = [...recent!.querySelectorAll(".pcc-recent-activity__item")];
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Newer Project");
    expect(items[0]?.textContent).toContain("Decision: Pick final architecture");
    expect(items[2]?.textContent).toContain("Older Project");
  });

  it("uses authoritative portfolio attention counts in top metrics", () => {
    const container = renderView(
      createProps({
        portfolio: {
          projectsTotal: 9,
          active: 6,
          blocked: 2,
          needsApproval: 3,
          needsAttention: 7,
          proofGaps: 4,
          overdue: 1,
          stale: 2,
          complete: 1,
          archived: 2,
          averagePercentComplete: 58,
          nextActions: ["Review blocked work"],
        },
      }),
    );

    const metrics = container.querySelector("[data-pcc-top-metrics]");
    const progress = container.querySelector("[data-pcc-portfolio-progress]");
    expect(metrics?.textContent).toContain("9");
    expect(metrics?.textContent).toContain("7");
    expect(metrics?.textContent).toContain("58%");
    expect(progress?.textContent).toContain("7 need attention");
  });

  it("renders last-known-good verified state in project history details", () => {
    const container = renderView(
      createProps({
        viewMode: "detailed",
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [],
          permissions: [],
          evidence: [evidence],
          receipts: [],
          lastKnownGood: [lastKnownGood],
          summary,
        },
      }),
    );

    const history = container.querySelector("[data-pcc-project-history]");
    expect(history?.textContent).toContain("Receipts and verified state");
    expect(history?.textContent).toContain("Last verified");
    expect(history?.textContent).toContain("Production runtime");
    expect(history?.textContent).toContain("Runtime serves the verified PCC build.");
    expect(history?.textContent).toContain("SHA 8bc48f54c4ec");
    expect(history?.querySelector("[data-pcc-last-known-good]")).not.toBeNull();
  });

  it("renders project decisions in the details layer", () => {
    const container = renderView(
      createProps({
        viewMode: "detailed",
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [],
          permissions: [],
          evidence: [evidence],
          receipts: [],
          decisions: [decision],
          lastKnownGood: [],
          summary,
        },
      }),
    );

    const decisions = container.querySelector("[data-pcc-decisions]");
    expect(decisions?.textContent).toContain("Decisions");
    expect(decisions?.textContent).toContain("Use receipt-gated completion");
    expect(decisions?.textContent).toContain(
      "Do not mark milestones complete without evidence-backed receipts.",
    );
    expect(decisions?.textContent).toContain("Why:");
    expect(decisions?.textContent).toContain("Better handoff trust.");
    expect(decisions?.textContent).toContain("Local PCC proof passed");
    expect(decisions?.querySelector("[data-pcc-decision]")).not.toBeNull();
    expect(container.textContent).toContain("1 recorded");
  });

  it("opens a decision form and lets users select related proof", () => {
    const onOpenDecisionForm = vi.fn();
    const onDecisionFormChange = vi.fn();
    const onSaveDecision = vi.fn();
    const onCancelDecisionForm = vi.fn();
    const container = renderView(
      createProps({
        viewMode: "detailed",
        projectDetail: {
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
        decisionFormOpen: true,
        decisionForm: {
          ...EMPTY_PCC_DECISION_FORM,
          title: "Choose proof source",
          summary: "Use the local proof receipt.",
          milestoneId: milestone.id,
        },
        onOpenDecisionForm,
        onDecisionFormChange,
        onSaveDecision,
        onCancelDecisionForm,
      }),
    );

    container.querySelector<HTMLButtonElement>("[data-pcc-snapshot-add-decision]")?.click();
    container.querySelector<HTMLButtonElement>("[data-pcc-open-decision-form]")?.click();
    expect(onOpenDecisionForm).toHaveBeenCalledTimes(2);

    expect(container.querySelector("[data-pcc-decision-capture]")).not.toBeNull();
    const form = container.querySelector<HTMLFormElement>("[data-pcc-decision-form]");
    expect(form).not.toBeNull();
    expect(form?.textContent).toContain("Related proof");
    expect(form?.textContent).toContain("Select proof instead of copying raw evidence IDs.");
    expect(form?.textContent).toContain("Local PCC proof passed");

    const evidenceCheckbox = form?.querySelector<HTMLInputElement>(
      "[data-pcc-decision-evidence-picker] input[type='checkbox']",
    );
    expect(evidenceCheckbox).not.toBeNull();
    if (evidenceCheckbox) {
      evidenceCheckbox.checked = true;
      evidenceCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(onDecisionFormChange).toHaveBeenCalledWith({ evidenceIds: evidence.id });

    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onSaveDecision).toHaveBeenCalledTimes(1);

    form?.querySelectorAll<HTMLButtonElement>("button")?.[1]?.click();
    expect(onCancelDecisionForm).toHaveBeenCalledTimes(1);
  });

  it("opens the decision form when legacy evidence is missing kind or status", () => {
    const legacyEvidence = {
      ...evidence,
      kind: undefined,
      status: undefined,
    } as unknown as typeof evidence;
    const container = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [legacyEvidence],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        },
        decisionFormOpen: true,
        decisionForm: {
          ...EMPTY_PCC_DECISION_FORM,
          title: "Record a legacy proof choice",
          summary: "Keep old proof usable.",
        },
      }),
    );

    expect(container.querySelector("[data-pcc-decision-capture]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-decision-form]")).not.toBeNull();
    expect(container.textContent).toContain("Not recorded");
  });

  it("renders Simple, Detailed, and Agent view controls", () => {
    const onSetViewMode = vi.fn();
    const simple = renderView(createProps({ viewMode: "simple", onSetViewMode }));

    expect(simple.querySelector('[data-pcc-view-mode="simple"]')).not.toBeNull();
    expect(simple.textContent).toContain("Simple");
    expect(simple.textContent).toContain("Detailed");
    expect(simple.textContent).toContain("Agent");
    expect(simple.textContent).toContain("Switch to Detailed or Agent");
    expect(simple.querySelector("[data-pcc-work-loop]")).not.toBeNull();
    expect(simple.textContent).toContain("Stop after current task");
    expect(simple.querySelector("[data-pcc-production-truth]")).not.toBeNull();

    simple.querySelector<HTMLButtonElement>('[data-pcc-view-mode-option="agent"]')?.click();
    expect(onSetViewMode).toHaveBeenCalledWith("agent");

    const agent = renderView(createProps({ viewMode: "agent" }));
    expect(agent.querySelector("[data-pcc-agent-mode]")).not.toBeNull();
    expect(agent.textContent).toContain("Low-reasoning execution details");
  });

  it("routes overdue active projects into Needs You instead of hiding them in normal active work", () => {
    const overdueSummary = {
      ...summary,
      id: "project-overdue",
      title: "Overdue Launch",
      status: "active" as const,
      dueDate: "2000-01-01T00:00:00.000Z",
      health: "On track",
      milestoneCounts: {
        ...summary.milestoneCounts,
        blocked: 0,
        needsApproval: 0,
      },
      nextActions: ["Review overdue launch plan"],
    };
    const container = renderView(
      createProps({
        projects: [overdueSummary],
        portfolio: {
          projectsTotal: 1,
          active: 1,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 42,
          nextActions: ["Review overdue launch plan"],
        },
        selectedProjectId: "project-overdue",
        projectDetail: {
          project: { ...project, id: "project-overdue", title: "Overdue Launch" },
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: overdueSummary,
        },
        projectDetails: {},
      }),
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Needs attention");
    expect(text).toContain("Overdue Launch");
    expect(text).toContain("Overdue since");
    expect(text).toContain("1 need attention");
    const needsYouTab = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-pcc-project-tabs] button"),
    ].find((button) => button.textContent?.includes("Needs You"));
    expect(needsYouTab?.textContent).toContain("1");
  });

  it("filters project cards with a skim-first project search", () => {
    const onSetProjectSearchQuery = vi.fn();
    const kitchenSummary = {
      ...summary,
      id: "project-2",
      title: "Kitchen Remodel",
      status: "active" as const,
      nextActions: ["Choose contractor"],
      proofGaps: [],
      health: "On track",
    };
    const kitchenDetail = {
      project: {
        ...project,
        id: "project-2",
        title: "Kitchen Remodel",
        goal: "Manage permits, contractor bids, inspections, and budget checkpoints.",
      },
      milestones: [
        {
          ...milestone,
          id: "milestone-2",
          projectId: "project-2",
          title: "Permit checklist",
        },
      ],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: kitchenSummary,
    };
    const container = renderView(
      createProps({
        projects: [summary, kitchenSummary],
        projectDetails: { "project-1": createProps().projectDetail!, "project-2": kitchenDetail },
        projectSearchQuery: "permits",
        onSetProjectSearchQuery,
      }),
    );

    expect(container.querySelector("[data-pcc-project-search]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);
    expect(container.textContent).toContain("Kitchen Remodel");
    expect(container.textContent).not.toContain("Health: Needs approval");
    expect(container.textContent).toContain("Showing 1 of 2");

    const search = container.querySelector<HTMLInputElement>(
      '[data-pcc-project-search] input[type="search"]',
    );
    search!.value = "contractor";
    search?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSetProjectSearchQuery).toHaveBeenCalledWith("contractor");

    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Clear search"))
      ?.click();
    expect(onSetProjectSearchQuery).toHaveBeenCalledWith("");
  });

  it("renders an empty state", () => {
    const container = renderView(
      createProps({
        projects: [],
        selectedProjectId: null,
        projectDetail: null,
        portfolio: {
          projectsTotal: 0,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 0,
          nextActions: [],
        },
      }),
    );

    expect(container.textContent).toContain("No projects yet");
    expect(container.querySelector("[data-pcc-empty]")).not.toBeNull();
    expect(container.textContent).toContain("Select a project");
  });

  it("renders loading without misreporting an empty portfolio", () => {
    const container = renderView(
      createProps({
        loading: true,
        projects: [],
        selectedProjectId: null,
        projectDetail: null,
        portfolio: {
          projectsTotal: 0,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 0,
          nextActions: [],
        },
      }),
    );

    expect(container.querySelector("[data-pcc-loading-state]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-loading-state]")?.getAttribute("role")).toBe(
      "status",
    );
    expect(container.textContent).toContain("Loading Project Command Center");
    expect(container.textContent).not.toContain("No projects yet");
  });

  it("renders a global needs-attention queue with direct project navigation", () => {
    const onSelectProject = vi.fn();
    const blockedProject = {
      ...summary,
      id: "project-blocked",
      title: "Blocked Launch",
      status: "blocked" as const,
      priority: 1,
      milestoneCounts: { ...summary.milestoneCounts, blocked: 2, needsApproval: 0 },
      nextActions: ["Fix failed proof"],
      health: "At risk",
    };
    const activeProject = {
      ...summary,
      id: "project-active",
      title: "Healthy Project",
      status: "active" as const,
      priority: 3,
      milestoneCounts: {
        total: 3,
        complete: 1,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Continue local proof"],
      proofGaps: [],
      health: "On track",
    };
    const container = renderView(
      createProps({
        projects: [activeProject, blockedProject],
        onSelectProject,
        portfolio: {
          projectsTotal: 2,
          active: 1,
          blocked: 1,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 21,
          nextActions: [],
        },
      }),
    );

    const attention = container.querySelector("[data-pcc-needs-attention-now]");
    expect(attention).not.toBeNull();
    expect(attention?.textContent).toContain("Needs Attention Now");
    expect(attention?.textContent).toContain("Blocked Launch");
    expect(attention?.textContent).toContain("Fix failed proof");
    expect(attention?.textContent).not.toContain("Healthy Project");
    expect(container.querySelectorAll("[data-pcc-attention-item]")).toHaveLength(1);

    [...attention!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open"))
      ?.click();
    expect(onSelectProject).toHaveBeenCalledWith("project-blocked");
  });

  it("surfaces stale active projects in the needs-attention queue", () => {
    const staleProject = {
      ...summary,
      id: "project-stale",
      title: "Stale Project",
      status: "active" as const,
      milestoneCounts: {
        total: 3,
        complete: 1,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: [],
      health: "On track",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const container = renderView(
      createProps({
        projects: [staleProject],
        portfolio: {
          projectsTotal: 1,
          active: 1,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 33,
          nextActions: [],
        },
      }),
    );

    const attention = container.querySelector("[data-pcc-needs-attention-now]");
    expect(attention?.textContent).toContain("Stale Project");
    expect(attention?.textContent).toContain("Stale");
    expect(attention?.textContent).toContain("No recorded update since");
  });

  it("renders an error state and keeps refresh usable", () => {
    const onRefresh = vi.fn();
    const container = renderView(createProps({ error: "gateway offline", onRefresh }));

    expect(container.textContent).toContain("Project Command Center unavailable");
    expect(container.textContent).toContain("gateway offline");
    const refresh = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Refresh"),
    );
    refresh?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders a page-level offline state without hiding last loaded projects", () => {
    const onRefresh = vi.fn();
    const container = renderView(createProps({ connected: false, onRefresh }));

    const offline = container.querySelector("[data-pcc-offline-state]");
    expect(offline).not.toBeNull();
    expect(offline?.getAttribute("role")).toBe("status");
    expect(offline?.textContent).toContain("Project Command Center is disconnected");
    expect(offline?.textContent).toContain("changes cannot be saved");
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);

    [...offline!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Retry refresh"))
      ?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("opens project selection and project editor actions", () => {
    const onSelectProject = vi.fn();
    const onOpenProjectEditor = vi.fn();
    const container = renderView(createProps({ onSelectProject, onOpenProjectEditor }));

    container.querySelector<HTMLButtonElement>("[data-pcc-project-card] button")?.click();
    expect(onSelectProject).toHaveBeenCalledWith("project-1");

    const edit = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Edit project"),
    );
    edit?.click();
    expect(onOpenProjectEditor).toHaveBeenCalledWith(project);
  });

  it("keeps long project goals out of cards and readable in selected detail", () => {
    const longGoal =
      "Create a reliable SNES Studio workflow that helps OpenClaw plan, build, verify, and package SNES-style game projects while preserving ROM safety.";
    const projectWithLongGoal = { ...project, goal: longGoal, title: "SNES Game Creator" };
    const summaryWithLongGoal = { ...summary, title: "SNES Game Creator" };
    const container = renderView(
      createProps({
        projects: [summaryWithLongGoal],
        projectDetails: {
          "project-1": {
            project: projectWithLongGoal,
            milestones: [milestone],
            subMilestones: [],
            permissions: [],
            evidence: [],
            receipts: [],
            summary: summaryWithLongGoal,
          },
        },
        projectDetail: {
          project: projectWithLongGoal,
          milestones: [milestone],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: summaryWithLongGoal,
        },
      }),
    );

    expect(container.querySelector("[data-pcc-project-card]")?.textContent).not.toContain(longGoal);
    expect(container.querySelector("[data-pcc-project-brief]")?.textContent).toContain(longGoal);
  });

  it("routes setup-missing primary action to AI autofill instead of dead-end prepare", () => {
    const onPreviewSetupAutofill = vi.fn();
    const onPrepareNextWorkItem = vi.fn();
    const incompleteProject = {
      ...project,
      goal: "",
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: { approved: false, answers: { ...intakeAnswers, goal: "" } },
        pccQualityGate: { status: "missing" },
        pccSetupScore: { score: 40, runnable: false },
        pccCompliance: { badge: "Missing", status: "missing" },
      },
    };
    const container = renderView(
      createProps({
        projectDetail: {
          project: incompleteProject,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
        onPreviewSetupAutofill,
        onPrepareNextWorkItem,
      }),
    );

    const primaryButton = container.querySelector<HTMLButtonElement>(
      "[data-pcc-primary-action] button",
    );
    expect(primaryButton?.textContent).toContain("Generate setup with AI");
    expect(container.querySelector("[data-pcc-setup-repair-issues]")?.textContent).toContain(
      "Required intake answer missing",
    );
    primaryButton?.click();
    expect(onPreviewSetupAutofill).toHaveBeenCalledTimes(1);
    expect(onPrepareNextWorkItem).not.toHaveBeenCalled();
  });

  it("opens milestone and sub-milestone action menus and supports reversible removal", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const promptSpy = vi.fn(() => "Should not be used.");
    vi.stubGlobal("prompt", promptSpy);
    const onSetMilestoneStatus = vi.fn();
    const onSetSubMilestoneStatus = vi.fn();
    const container = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
        onSetMilestoneStatus,
        onSetSubMilestoneStatus,
      }),
    );

    const milestoneMenu = container.querySelector<HTMLElement>("[data-pcc-action-menu]");
    const milestoneTrigger = milestoneMenu?.querySelector<HTMLButtonElement>(
      "[data-pcc-action-menu-trigger]",
    );
    milestoneTrigger?.click();
    expect(milestoneMenu?.classList.contains("is-open")).toBe(true);
    expect(milestoneMenu?.textContent).toContain("Remove from active plan");
    expect(milestoneMenu?.textContent).not.toContain("Delete");
    const removeMilestoneButton = [
      ...(milestoneMenu?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((button) => button.textContent?.includes("Remove from active plan"));
    removeMilestoneButton?.click();
    expect(removeMilestoneButton?.textContent).toContain("Confirm remove");
    expect(onSetMilestoneStatus).not.toHaveBeenCalled();
    removeMilestoneButton?.click();
    expect(onSetMilestoneStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-1" }),
      "archived",
      "Removed from the active PCC plan from the action menu.",
    );
    expect(promptSpy).not.toHaveBeenCalled();

    const subMenu = container.querySelector<HTMLElement>("[data-pcc-submilestone-action-menu]");
    const subTrigger = subMenu?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]");
    subTrigger?.click();
    expect(subMenu?.classList.contains("is-open")).toBe(true);
    expect(subMenu?.textContent).toContain("Remove from active plan");
    expect(subMenu?.textContent).not.toContain("Delete");
    [...(subMenu?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Reopen"))
      ?.click();
    expect(onSetSubMilestoneStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "submilestone-1" }),
      "not_started",
    );
  });

  it("supports keyboard-accessible milestone and sub-milestone reordering", () => {
    const onMoveMilestoneBefore = vi.fn();
    const onMoveSubMilestoneBefore = vi.fn();
    const secondMilestone = {
      ...milestone,
      id: "milestone-2",
      title: "Runtime proof",
      order: 2,
      status: "not_started" as const,
    };
    const secondSubMilestone = {
      ...subMilestone,
      id: "submilestone-2",
      title: "Save browser screenshot",
      order: 2,
    };
    const container = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [milestone, secondMilestone],
          subMilestones: [subMilestone, secondSubMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
        onMoveMilestoneBefore,
        onMoveSubMilestoneBefore,
      }),
    );

    const secondMilestoneUp = container.querySelector<HTMLButtonElement>(
      '[data-pcc-milestone-id="milestone-2"] [data-pcc-reorder="milestone-up"]',
    );
    secondMilestoneUp?.click();
    expect(onMoveMilestoneBefore).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-2" }),
      expect.objectContaining({ id: "milestone-1" }),
    );

    const firstMilestoneDown = container.querySelector<HTMLButtonElement>(
      '[data-pcc-milestone-id="milestone-1"] [data-pcc-reorder="milestone-down"]',
    );
    firstMilestoneDown?.click();
    expect(onMoveMilestoneBefore).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "milestone-2" }),
      expect.objectContaining({ id: "milestone-1" }),
    );

    const secondSubUp = container.querySelector<HTMLButtonElement>(
      '[data-pcc-submilestone-id="submilestone-2"] [data-pcc-reorder="submilestone-up"]',
    );
    secondSubUp?.click();
    expect(onMoveSubMilestoneBefore).toHaveBeenCalledWith(
      expect.objectContaining({ id: "submilestone-2" }),
      expect.objectContaining({ id: "submilestone-1" }),
    );

    const firstSubDown = container.querySelector<HTMLButtonElement>(
      '[data-pcc-submilestone-id="submilestone-1"] [data-pcc-reorder="submilestone-down"]',
    );
    firstSubDown?.click();
    expect(onMoveSubMilestoneBefore).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "submilestone-2" }),
      expect.objectContaining({ id: "submilestone-1" }),
    );
  });

  it("renders Stop Here controls and calls the milestone stop callback", () => {
    const onSetMilestoneStopHere = vi.fn();
    const container = renderView(
      createProps({
        onSetMilestoneStopHere,
        projectDetail: {
          project,
          milestones: [{ ...milestone, metadata: { ...milestone.metadata, pccStopHere: true } }],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    expect(container.textContent).toContain("Stop point");
    expect(container.textContent).toContain("Stop here");
    const stop = container.querySelector<HTMLInputElement>("[data-pcc-stop-here] input");
    expect(stop?.checked).toBe(true);
    if (!stop) {
      throw new Error("missing stop here checkbox");
    }
    stop.checked = false;
    stop.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetMilestoneStopHere).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-1" }),
      false,
    );
  });

  it("renders sub-milestone-first next safe action", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    expect(container.textContent).toContain("Next Safe Action");
    expect(container.textContent).toContain("Run local proof");
    expect(container.textContent).toContain("This sub-milestone is ready");
  });

  it("renders phase templates and weighted phase progress", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project: {
            ...project,
            phases: [
              { id: "setup", title: "Setup", weight: 10, order: 0 },
              { id: "mvp", title: "MVP", weight: 90, order: 1 },
            ],
          },
          milestones: [
            { ...milestone, phaseId: "setup", percentComplete: 70 },
            {
              ...milestone,
              id: "milestone-mvp",
              title: "MVP finish",
              phaseId: "mvp",
              percentComplete: 20,
            },
          ],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    expect(container.querySelectorAll("[data-pcc-phases]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-phase]")).toHaveLength(2);
    expect(container.textContent).toContain("Setup");
    expect(container.textContent).toContain("MVP");
    expect(container.textContent).toContain("10% weight");
    expect(container.textContent).toContain("70%");
  });

  it("renders completion receipts, evidence, and add receipt action", () => {
    const onAddCompletionReceipt = vi.fn();
    const container = renderView(
      createProps({
        onAddCompletionReceipt,
        projectDetail: {
          project,
          milestones: [{ ...milestone, status: "proof_pending" }],
          permissions: [],
          evidence: [evidence],
          receipts: [receipt],
          summary,
        },
      }),
    );

    expect(container.querySelectorAll("[data-pcc-receipt]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-evidence-list]")).toHaveLength(1);
    expect(container.textContent).toContain("Completion receipt");
    expect(container.textContent).toContain("Do not redo");
    expect(container.textContent).toContain("Local PCC proof passed");

    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add receipt"),
    );
    expect(add?.disabled).toBe(true);
  });

  it("renders legacy receipt and evidence-link rows without crashing detail view", () => {
    const legacyReceipt = {
      ...receipt,
      id: "legacy-receipt",
      proofEvidenceIds: undefined,
    } as unknown as typeof receipt;
    const legacyDecision = {
      ...decision,
      id: "legacy-decision",
      evidenceIds: "evidence-1",
    } as unknown as typeof decision;
    const legacyLastKnownGood = {
      ...lastKnownGood,
      id: "legacy-lkg",
      evidenceIds: "evidence-1",
    } as unknown as typeof lastKnownGood;

    const container = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [{ ...milestone, status: "proof_pending" }],
          permissions: [],
          evidence: [evidence],
          receipts: [legacyReceipt],
          decisions: [legacyDecision],
          lastKnownGood: [legacyLastKnownGood],
          summary,
        },
      }),
    );

    expect(container.querySelectorAll("[data-pcc-receipt]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-decision]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-last-known-good]")).toHaveLength(1);
    expect(container.querySelector("[data-pcc-receipt]")?.textContent).toMatch(
      /Evidence\s+0\s+items/,
    );
    expect(container.textContent).toContain("Use receipt-gated completion");
  });

  it("enables Add receipt only when passed evidence exists and no receipt is recorded", () => {
    const onAddCompletionReceipt = vi.fn();
    const container = renderView(
      createProps({
        onAddCompletionReceipt,
        projectDetail: {
          project,
          milestones: [{ ...milestone, status: "proof_pending" }],
          permissions: [],
          evidence: [evidence],
          receipts: [],
          summary,
        },
      }),
    );
    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add receipt"),
    );
    expect(add?.disabled).toBe(false);
    add?.click();
    expect(onAddCompletionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-1" }),
    );
  });

  it("renders permission decisions and calls the decision handler", () => {
    const onSetPermissionStatus = vi.fn();
    const container = renderView(createProps({ onSetPermissionStatus }));

    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-pcc-permission] button"),
    ];
    buttons.find((button) => button.textContent?.includes("Grant"))?.click();
    buttons.find((button) => button.textContent?.includes("Defer"))?.click();
    buttons.find((button) => button.textContent?.includes("Deny"))?.click();

    expect(onSetPermissionStatus).toHaveBeenNthCalledWith(1, permission, "granted");
    expect(onSetPermissionStatus).toHaveBeenNthCalledWith(2, permission, "needed");
    expect(onSetPermissionStatus).toHaveBeenNthCalledWith(3, permission, "denied");
  });

  it("renders guided work loop controls and task prompt preview", () => {
    const onUpdateWorkLoop = vi.fn();
    const onPrepareNextWorkItem = vi.fn();
    const container = renderView(
      createProps({
        onUpdateWorkLoop,
        onPrepareNextWorkItem,
        projectDetail: {
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              pccWorkLoop: {
                enabled: true,
                state: "working",
                stopBeforeCodex: true,
                stopBeforeRemoteProof: true,
                stopAfterCurrentMilestone: false,
              },
            },
          },
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    expect(container.textContent).toContain("Work This Project");
    expect(container.textContent).toContain("Stop before Codex");
    expect(container.textContent).toContain("Stop before destructive actions");
    expect(container.textContent).toContain("Stop before remote proof");
    expect(container.textContent).toContain("Task prompt preview");
    const prepare = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Prepare next safe task"),
    );
    prepare?.click();
    expect(onPrepareNextWorkItem).toHaveBeenCalledTimes(1);
  });

  it("keeps production truth scoped to the PCC project even when another project is selected", () => {
    const verifiedSha = "4d8408034d7131470980c316a2af2f311aa6b785";
    const pccDetail = {
      project: {
        ...project,
        id: "project-command-center",
        title: "Project Command Center",
        metadata: {
          ...project.metadata,
          pccProductionTruth: {
            latestVerifiedSha: verifiedSha,
            runtimeSha: verifiedSha,
            remoteProofPassed: true,
            runtimeProofPassed: true,
            browserProofScreenshotPath: "/tmp/pcc-proof.png",
          },
        },
      },
      milestones: [
        {
          ...milestone,
          id: "pcc-proof",
          projectId: "project-command-center",
          title: "PCC runtime proof",
          status: "complete" as const,
          receiptIds: ["receipt-1"],
          metadata: { requiresRemoteProof: true, requiresRuntimeProof: true },
        },
      ],
      subMilestones: [],
      permissions: [],
      evidence: [
        {
          ...evidence,
          id: "remote-proof",
          projectId: "project-command-center",
          milestoneId: "pcc-proof",
          kind: "remote_ci" as const,
        },
        {
          ...evidence,
          id: "browser-proof",
          projectId: "project-command-center",
          milestoneId: "pcc-proof",
          kind: "browser_proof" as const,
        },
      ],
      receipts: [{ ...receipt, projectId: "project-command-center", milestoneId: "pcc-proof" }],
      decisions: [],
      lastKnownGood: [],
      summary: { ...summary, id: "project-command-center", title: "Project Command Center" },
    };
    const selectedNonPccDetail = {
      project: {
        ...project,
        id: "project-snes",
        title: "SNES Game Creator",
        metadata: {},
      },
      milestones: [],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      decisions: [],
      lastKnownGood: [],
      summary: { ...summary, id: "project-snes", title: "SNES Game Creator" },
    };

    const container = renderView(
      createProps({
        selectedProjectId: "project-snes",
        projectDetail: selectedNonPccDetail,
        projectDetails: {
          "project-command-center": pccDetail,
          "project-snes": selectedNonPccDetail,
        },
      }),
    );

    const productionTruth = container.querySelector("[data-pcc-production-truth]");
    expect(productionTruth?.textContent).toContain("Current");
    expect(productionTruth?.textContent).toContain(verifiedSha.slice(0, 12));
    expect(productionTruth?.textContent).toContain("Passed");
    expect(productionTruth?.textContent).not.toContain("PCC remote Workflow Sanity proof missing");
  });

  it("renders production truth as current when proof metadata and receipts align", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              pccProductionTruth: {
                latestVerifiedSha: "4d8408034d7131470980c316a2af2f311aa6b785",
                runtimeSha: "4d8408034d7131470980c316a2af2f311aa6b785",
                remoteProofPassed: true,
                runtimeProofPassed: true,
                browserProofScreenshotPath: "/tmp/pcc-proof.png",
              },
            },
          },
          milestones: [
            {
              ...milestone,
              status: "complete",
              receiptIds: ["receipt-1"],
              metadata: { requiresRemoteProof: true, requiresRuntimeProof: true },
            },
          ],
          subMilestones: [],
          permissions: [],
          evidence: [
            { ...evidence, kind: "remote_ci" },
            { ...evidence, id: "evidence-2", kind: "browser_proof" },
          ],
          receipts: [receipt],
          summary,
        },
      }),
    );

    expect(container.textContent).toContain("Is this dashboard current?");
    expect(container.textContent).toContain("Current");
    expect(container.textContent).toContain("/tmp/pcc-proof.png");
  });

  it("surfaces plan integrity issues in the impact detail drawer", () => {
    const container = renderView(
      createProps({
        viewMode: "agent",
        projectDetail: {
          project,
          milestones: [
            milestone,
            { ...milestone, id: "duplicate", title: milestone.title, order: milestone.order },
          ],
          subMilestones: [{ ...subMilestone, id: "orphan", milestoneId: "missing-parent" }],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    const integrity = container.querySelector("[data-pcc-plan-integrity]");
    expect(integrity?.textContent).toContain("Plan integrity");
    expect(integrity?.textContent).toContain("Orphaned sub-milestone");
    expect(integrity?.textContent).toContain("Duplicate milestone title");
  });

  it("shows sequence normalization only for order integrity issues", () => {
    const onNormalizeProjectSequence = vi.fn();
    const onRemoveStaleDependencies = vi.fn();
    const onRepairDuplicateTitles = vi.fn();
    const sequenceContainer = renderView(
      createProps({
        viewMode: "agent",
        onNormalizeProjectSequence,
        onRemoveStaleDependencies,
        onRepairDuplicateTitles,
        projectDetail: {
          project,
          milestones: [
            milestone,
            {
              ...milestone,
              id: "duplicate-order",
              title: "Second milestone",
              order: milestone.order,
            },
          ],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    const normalize = sequenceContainer.querySelector<HTMLButtonElement>(
      "[data-pcc-normalize-sequence]",
    );
    expect(normalize?.textContent).toContain("Normalize sequence");
    normalize?.click();
    expect(onNormalizeProjectSequence).toHaveBeenCalledTimes(1);
    expect(sequenceContainer.querySelector("[data-pcc-remove-stale-dependencies]")).toBeNull();

    const dependencyContainer = renderView(
      createProps({
        viewMode: "agent",
        onRemoveStaleDependencies,
        projectDetail: {
          project,
          milestones: [{ ...milestone, dependsOn: ["missing-dependency"] }],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );
    expect(dependencyContainer.querySelector("[data-pcc-normalize-sequence]")).toBeNull();
    const removeStale = dependencyContainer.querySelector<HTMLButtonElement>(
      "[data-pcc-remove-stale-dependencies]",
    );
    expect(removeStale?.textContent).toContain("Remove stale dependencies");
    removeStale?.click();
    expect(onRemoveStaleDependencies).toHaveBeenCalledTimes(1);

    const duplicateTitleContainer = renderView(
      createProps({
        viewMode: "agent",
        onRepairDuplicateTitles,
        projectDetail: {
          project,
          milestones: [
            milestone,
            {
              ...milestone,
              id: "duplicate-title",
              title: milestone.title,
              order: 20,
            },
          ],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );
    expect(duplicateTitleContainer.querySelector("[data-pcc-normalize-sequence]")).toBeNull();
    const repairTitles = duplicateTitleContainer.querySelector<HTMLButtonElement>(
      "[data-pcc-repair-duplicate-titles]",
    );
    expect(repairTitles?.textContent).toContain("Make titles unique");
    repairTitles?.click();
    expect(onRepairDuplicateTitles).toHaveBeenCalledTimes(1);
  });

  it("renders current truth, ready queue, sub-milestones, and work lanes", () => {
    const onUpdateWorkLoop = vi.fn();
    const container = renderView(
      createProps({
        onUpdateWorkLoop,
        projectDetail: {
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              pccWorkLoop: {
                enabled: true,
                state: "working",
                stopBeforeCodex: true,
                stopBeforeRemoteProof: true,
                stopAfterCurrentMilestone: false,
                parallelWorkMode: "local_agents_only",
              },
            },
          },
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    const text = container.textContent ?? "";
    expect(container.querySelector("[data-pcc-current-truth]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-ready-queue]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pcc-submilestone]")).toHaveLength(1);
    expect(container.querySelector("[data-pcc-work-lanes]")).not.toBeNull();
    expect(text).toContain("Current Truth");
    expect(text).toContain("Ready Now");
    expect(text).toContain("Run local proof");
    expect(text).toContain("Parallel Work");

    const select = container.querySelector<HTMLSelectElement>("[data-pcc-work-lanes] select");
    expect(select?.value).toBe("local_agents_only");
    select!.value = "supervised";
    select?.dispatchEvent(new Event("change"));
    expect(onUpdateWorkLoop).toHaveBeenCalledWith(
      expect.objectContaining({ parallelWorkMode: "supervised" }),
    );
  });

  it("renders complete maintenance projects as quality-passing and not runnable", () => {
    const completeProject = {
      ...project,
      status: "complete_with_maintenance" as const,
      metadata: {},
    };
    const completeSummary = {
      ...summary,
      status: "complete_with_maintenance" as const,
      percentComplete: 98,
      milestoneCounts: {
        ...summary.milestoneCounts,
        total: 22,
        complete: 21,
        needsApproval: 0,
      },
      proofGaps: [],
    };
    const container = renderView(
      createProps({
        projects: [completeSummary],
        projectDetail: {
          project: completeProject,
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [evidence],
          receipts: [receipt],
          summary: completeSummary,
        },
        viewMode: "agent",
      }),
    );
    const text = container.textContent ?? "";

    expect(container.querySelector("[data-pcc-detail]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-work-loop]")).not.toBeNull();
    expect(text).toContain("Setup score");
    expect(text).toContain("100/100");
    expect(text).toContain("Passing");
    expect(text).toContain("Project is complete or archived; reopen it before starting new work.");
  });

  it("renders project editor and saves form changes", () => {
    const onProjectFormChange = vi.fn();
    const onSaveProject = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "New PCC",
          goal: "A skimmable PCC view.",
          projectDescription: "Build a skimmable PCC view.",
          priority: "4",
          dueDate: "2099-01-15",
          intakeAnswers,
          intakeApproved: true,
          planPreviewAccepted: true,
        },
        onProjectFormChange,
        onSaveProject,
      }),
    );

    expect(container.querySelector('[data-pcc-editor="project"]')).not.toBeNull();
    expect(container.querySelector("[data-pcc-intake-wizard]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-workflow-recommendation]")).not.toBeNull();
    const dueDate = container.querySelector<HTMLInputElement>("[data-pcc-project-due-date]");
    expect(dueDate?.value).toBe("2099-01-15");
    dueDate!.value = "2099-01-16";
    dueDate?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(onProjectFormChange).toHaveBeenCalledWith({ dueDate: "2099-01-16" });
    container
      .querySelector<HTMLInputElement>("input[required]")
      ?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container
      .querySelector<HTMLFormElement>("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onProjectFormChange).toHaveBeenCalled();
    expect(onSaveProject).toHaveBeenCalledTimes(1);
  });

  it("uses inline confirmation before discarding a project draft from cancel", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const onCancelEditor = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "Draft PCC",
          goal: "Make project work easier.",
        },
        onCancelEditor,
      }),
    );

    const cancelButton = container.querySelector<HTMLButtonElement>("[data-pcc-project-cancel]");
    cancelButton?.click();
    expect(cancelButton?.textContent).toContain("Discard draft");
    expect(onCancelEditor).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    cancelButton?.click();
    expect(onCancelEditor).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("shows project editor save errors next to the form", () => {
    const container = renderView(
      createProps({
        actionError: "Project title already exists: SNES Game Creator",
        editorMode: "edit-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          id: "project-1",
          title: "SNES Game Creator",
          goal: "Build a safe SNES workflow.",
          intakeAnswers,
          intakeApproved: true,
          planPreviewAccepted: true,
        },
      }),
    );

    const editorError = container.querySelector(
      '[data-pcc-editor="project"] [data-pcc-editor-error]',
    );
    expect(editorError).not.toBeNull();
    expect(editorError?.getAttribute("role")).toBe("alert");
    expect(editorError?.textContent).toContain("Could not save");
    expect(editorError?.textContent).toContain("Project title already exists");
  });

  it("blocks blank intake before project setup can be saved", () => {
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: { ...EMPTY_PCC_PROJECT_FORM, title: "Blank intake project" },
      }),
    );

    expect(container.querySelector("[data-pcc-intake-blocked]")).not.toBeNull();
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Approve and create"),
    );
    expect(save?.disabled).toBe(true);
  });

  it("generates missing project intake answers from the editor", () => {
    const onProjectFormChange = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "Kitchen Remodel Planner",
          goal: "Plan a kitchen remodel from estimate through final inspection.",
          projectDescription:
            "I need a complete plan for remodeling my kitchen without missing permits, contractors, materials, inspections, or budget checkpoints.",
          intakeAnswers: { goal: "" },
        },
        onProjectFormChange,
      }),
    );

    expect(container.querySelector("[data-pcc-intake-generate-card]")?.textContent).toContain(
      "Generate missing answers with AI.",
    );
    const generate = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.matches("[data-pcc-project-intake-autofill]"),
    );
    expect(generate).toBeTruthy();

    generate?.click();

    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "Plan a kitchen remodel from estimate through final inspection.",
        intakeAnswers: expect.objectContaining({
          goal: "Plan a kitchen remodel from estimate through final inspection.",
          firstDeliverable: expect.stringContaining("Kitchen Remodel Planner"),
          doneProof: expect.stringContaining("completion receipt"),
          constraints: expect.stringContaining("separate approval"),
          owner: "Local Project Manager",
          blockers: expect.stringContaining("Unknown blockers"),
        }),
        planPreviewAccepted: false,
      }),
    );
  });

  it("shows per-question AI fill controls on project intake answers", () => {
    const onProjectFormChange = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "Kitchen Remodel Planner",
          goal: "Plan a kitchen remodel from estimate through final inspection.",
          projectDescription:
            "I need a complete plan for remodeling my kitchen without missing permits, contractors, materials, inspections, or budget checkpoints.",
          intakeAnswers: { goal: "", owner: "User" },
        },
        onProjectFormChange,
      }),
    );

    const goalFill = container.querySelector<HTMLButtonElement>(
      '[data-pcc-intake-question-ai-fill="goal"]',
    );
    expect(goalFill?.textContent).toContain("AI fill");

    goalFill?.click();

    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        intakeAnswers: expect.objectContaining({
          goal: "Plan a kitchen remodel from estimate through final inspection.",
          owner: "User",
        }),
        planPreviewAccepted: false,
      }),
    );

    const ownerRegenerate = container.querySelector<HTMLButtonElement>(
      '[data-pcc-intake-question-ai-fill="owner"]',
    );
    expect(ownerRegenerate?.textContent).toContain("Regenerate with AI");
  });

  it("keeps AI intake autofill visible while editing a project with missing setup", () => {
    const onProjectFormChange = vi.fn();
    const onPreviewSetupAutofill = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "edit-project",
        projectDetail: {
          project: {
            ...project,
            id: "project-1",
            title: "SNES Game Creator",
            goal: "",
          },
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: { ...summary, title: "SNES Game Creator" },
        },
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          id: "project-1",
          title: "SNES Game Creator",
          goal: "",
          intakeAnswers: { goal: "" },
          intakeApproved: false,
        },
        onProjectFormChange,
        onPreviewSetupAutofill,
      }),
    );

    expect(container.querySelector("[data-pcc-project-intake-ai-repair]")).not.toBeNull();
    expect(container.querySelector("details[open] [data-pcc-intake-wizard]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-intake-answer-ai-tools]")).not.toBeNull();
    const autofill = container.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-autofill]",
    );
    expect(autofill?.textContent).toContain("Generate setup with AI");

    autofill?.click();

    expect(onPreviewSetupAutofill).toHaveBeenCalledTimes(1);
    expect(onProjectFormChange).not.toHaveBeenCalled();
  });

  it("lets the project intake answers page preview AI answers before applying to a saved project", () => {
    const onProjectFormChange = vi.fn();
    const onPreviewSetupAutofill = vi.fn();
    const onApplySetupAutofill = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "edit-project",
        projectDetail: {
          project: {
            ...project,
            id: "snes",
            title: "SNES Game Creator",
            goal: "Create a readable SNES-style game workflow.",
          },
          milestones: [
            {
              ...milestone,
              projectId: "snes",
              title: "Verify SNES toolchain and emulator smoke path",
              status: "not_started",
            },
          ],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: { ...summary, id: "snes", title: "SNES Game Creator" },
        },
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          id: "snes",
          title: "SNES Game Creator",
          goal: "",
          intakeAnswers: { goal: "" },
          intakeApproved: false,
        },
        autofillPreview: {
          projectId: "snes",
          goal: "Create a readable SNES-style game workflow.",
          intakeAnswers: {
            ...intakeAnswers,
            goal: "Create a readable SNES-style game workflow.",
          },
          intakeApproved: false,
          workflowTemplateId: "software-product",
          workflowTitle: "Software Product",
          summary: "PCC drafted missing setup for SNES Game Creator from existing project context.",
          milestoneUpdates: [
            {
              id: "milestone-1",
              title: "Verify SNES toolchain and emulator smoke path",
              fields: ["implementation plan", "proof requirements"],
            },
          ],
          subMilestoneUpdates: [],
        },
        onProjectFormChange,
        onPreviewSetupAutofill,
        onApplySetupAutofill,
      }),
    );

    expect(
      container.querySelector("[data-pcc-project-intake-answers-page]")?.textContent,
    ).toContain("Project intake answers");
    const intakeTools = container.querySelector("[data-pcc-intake-answer-ai-tools]");
    expect(container.querySelector("[data-pcc-intake-generate-card]")?.textContent).toContain(
      "Generate missing answers with AI.",
    );
    expect(intakeTools?.textContent).toContain("AI can fill any blanks here.");
    const pageAutofill = intakeTools?.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-page-autofill]",
    );
    expect(pageAutofill?.textContent).toContain("Fill visible answers with AI");

    pageAutofill?.click();

    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "Create a readable SNES-style game workflow.",
        intakeAnswers: expect.objectContaining({
          goal: "Create a readable SNES-style game workflow.",
          firstDeliverable: expect.stringContaining("Verify SNES toolchain"),
        }),
        planPreviewAccepted: false,
      }),
    );
    expect(onPreviewSetupAutofill).not.toHaveBeenCalled();

    const previewFullRepair = intakeTools?.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-autofill]",
    );
    expect(previewFullRepair?.textContent).toContain("Preview & apply AI setup");

    previewFullRepair?.click();

    expect(onPreviewSetupAutofill).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-pcc-autofill-preview]")).not.toBeNull();
    expect(container.textContent).toContain("AI Autofill Preview");

    container.querySelector<HTMLButtonElement>("[data-pcc-autofill-preview] button")?.click();
    expect(onApplySetupAutofill).toHaveBeenCalledTimes(1);
  });

  it("renders project-manager and Codex planning gates in project intake", () => {
    const onProjectFormChange = vi.fn();
    const codexContainer = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "New PCC",
          goal: "Use Codex to plan a PCC project.",
          projectDescription: "Use Codex to plan a PCC project.",
          plannerMode: "codex",
          planningMode: "codex_full_plan",
          codexPlanningAllowed: false,
        },
        onProjectFormChange,
      }),
    );
    expect(codexContainer.querySelector("[data-pcc-codex-planning-gate]")).not.toBeNull();
    expect(codexContainer.textContent).toContain("High-reasoning / Codex permission");

    const pmContainer = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "New PCC",
          goal: "Use local Project Manager to plan a PCC project.",
          projectDescription: "Use local Project Manager to plan a PCC project.",
          plannerMode: "local_project_manager",
          planningMode: "local_project_manager",
        },
        onProjectFormChange,
      }),
    );
    expect(pmContainer.querySelector("[data-pcc-project-manager-intake]")).not.toBeNull();
    expect(pmContainer.textContent).toContain("Project Manager review");
  });

  it("renders responsibility routing labels and editor controls", () => {
    const onMilestoneFormChange = vi.fn();
    const container = renderView(
      createProps({
        onMilestoneFormChange,
        projectDetail: {
          project,
          milestones: [
            {
              ...milestone,
              metadata: {
                ...milestone.metadata,
                pccResponsibility: "high_reasoning_codex",
                pccCostRisk: "high",
              },
            },
          ],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
        editorMode: "edit-milestone",
        milestoneForm: {
          ...EMPTY_PCC_MILESTONE_FORM,
          id: "milestone-1",
          projectId: "project-1",
          title: "CRUD UI",
          responsibility: "high_reasoning_codex",
          costRisk: "high",
        },
      }),
    );

    expect(container.textContent).toContain("High-reasoning Codex");
    expect(container.textContent).toContain("High");
    expect(container.textContent).toContain("Token/cost risk");
    const selects = [...container.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects.some((select) => select.value === "high_reasoning_codex")).toBe(true);
    expect(selects.some((select) => select.value === "high")).toBe(true);
  });

  it("renders context package actions without cluttering the project view", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const container = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [
            {
              ...milestone,
              metadata: {
                ...milestone.metadata,
                pccResponsibility: "local_openclaw_agent",
                pccCostRisk: "low",
              },
            },
          ],
          permissions: [permission],
          evidence: [evidence],
          receipts: [receipt],
          summary,
        },
      }),
    );

    expect(container.querySelector("[data-pcc-context-package]")).not.toBeNull();
    expect(container.textContent).toContain("Context package");
    expect(container.textContent).toContain("Preview next-step packet");

    container.querySelector<HTMLButtonElement>('[data-pcc-copy-context="compact"]')?.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Next milestone: CRUD UI");
    expect(writeText.mock.calls[0]?.[0]).toContain("Worker: local_openclaw_agent");
  });

  it("requires inline confirmation for risky chat sync proposals", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const onApplyChatSyncProposal = vi.fn();
    const proposal = {
      id: "chat-plan-risky",
      kind: "update_milestone" as const,
      title: "Skip stale milestone",
      summary: "Chat suggests skipping a milestone.",
      risky: true,
      milestoneId: "milestone-1",
      milestonePatch: { projectId: "project-1", title: "CRUD UI", status: "skipped" as const },
    };
    const container = renderView(
      createProps({
        chatSyncProposals: [proposal],
        onApplyChatSyncProposal,
      }),
    );

    const applyButton = container.querySelector<HTMLButtonElement>(
      "[data-pcc-chat-sync-proposal] button",
    );
    applyButton?.click();
    expect(applyButton?.textContent).toContain("Confirm apply");
    expect(onApplyChatSyncProposal).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    applyButton?.click();
    expect(onApplyChatSyncProposal).toHaveBeenCalledWith(proposal);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("renders and applies reviewable chat sync proposals", () => {
    const onChatSyncTextChange = vi.fn();
    const onPreviewChatSync = vi.fn();
    const onApplyChatSyncProposal = vi.fn();
    const proposal = {
      id: "chat-plan-1",
      kind: "add_milestone" as const,
      title: "Add milestone: Chat Sync",
      summary: "Structured chat plan detected.",
      risky: false,
      milestonePatch: {
        projectId: "project-1",
        title: "Chat Sync",
      },
    };
    const container = renderView(
      createProps({
        chatSyncText: "PLEASE IMPLEMENT THIS PLAN:\n# Chat Sync",
        chatSyncProposals: [proposal],
        onChatSyncTextChange,
        onPreviewChatSync,
        onApplyChatSyncProposal,
      }),
    );

    expect(container.querySelector("[data-pcc-chat-sync]")).not.toBeNull();
    expect(container.textContent).toContain("Suggested updates from chat");
    expect(container.textContent).toContain("Add milestone: Chat Sync");

    container.querySelector<HTMLTextAreaElement>(".pcc-chat-sync__input")!.value = "updated";
    container
      .querySelector<HTMLTextAreaElement>(".pcc-chat-sync__input")!
      .dispatchEvent(new Event("input"));
    expect(onChatSyncTextChange).toHaveBeenCalledWith("updated");

    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Review chat updates"))
      ?.click();
    expect(onPreviewChatSync).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>("[data-pcc-chat-sync-proposal] button")?.click();
    expect(onApplyChatSyncProposal).toHaveBeenCalledWith(proposal);
  });

  it("shows milestone editor validation errors next to the form", () => {
    const container = renderView(
      createProps({
        actionError: "Milestone title already used by milestone-1: Intake",
        editorMode: "edit-milestone",
        milestoneForm: {
          ...EMPTY_PCC_MILESTONE_FORM,
          id: "milestone-2",
          projectId: "project-1",
          title: "Intake",
        },
      }),
    );

    const editorError = container.querySelector(
      '[data-pcc-editor="milestone"] [data-pcc-editor-error]',
    );
    expect(editorError).not.toBeNull();
    expect(editorError?.getAttribute("role")).toBe("alert");
    expect(editorError?.textContent).toContain("Could not save");
    expect(editorError?.textContent).toContain("Milestone title already used");
  });

  it("renders milestone editor and status actions", () => {
    const onMilestoneFormChange = vi.fn();
    const onSaveMilestone = vi.fn();
    const onSetMilestoneStatus = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-milestone",
        milestoneForm: {
          ...EMPTY_PCC_MILESTONE_FORM,
          projectId: "project-1",
          title: "Remote proof",
        },
        onMilestoneFormChange,
        onSaveMilestone,
        onSetMilestoneStatus,
        viewMode: "agent",
      }),
    );

    expect(container.querySelector('[data-pcc-editor="milestone"]')).not.toBeNull();
    container
      .querySelector<HTMLTextAreaElement>('[data-pcc-editor="milestone"] textarea')
      ?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container
      .querySelector<HTMLFormElement>("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onMilestoneFormChange).toHaveBeenCalled();
    expect(onSaveMilestone).toHaveBeenCalledTimes(1);

    const defer = [
      ...container.querySelectorAll<HTMLButtonElement>(".pcc-milestone__actions button"),
    ].find((button) => button.textContent?.includes("Defer"));
    defer?.click();
    expect(onSetMilestoneStatus).toHaveBeenCalledWith(milestone, "deferred");
  });
});

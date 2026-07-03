/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PCC_MILESTONE_FORM, EMPTY_PCC_PROJECT_FORM } from "../controllers/pcc.ts";
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
      lastKnownGood: [],
      summary,
    },
    actionBusy: false,
    actionError: null,
    editorMode: null,
    projectForm: { ...EMPTY_PCC_PROJECT_FORM },
    milestoneForm: { ...EMPTY_PCC_MILESTONE_FORM, projectId: "project-1" },
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
    expect(text).toContain("Health: Needs approval");
    expect(text).toContain("Due:");
    expect(text).toContain("Activity: Milestone updated: CRUD UI");
    expect(text).toContain("Workflow Sanity proof");
    expect(text).toContain("CRUD UI");
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-journey-step]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-permission]")).toHaveLength(1);
    expect(text).toContain("Permission needed");
    expect(text).toContain("Remote Proof");
    expect(text).toContain("Today");
    expect(text).toContain("Needs You");
    expect(text).toContain("Project Snapshot");
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
    expect(primaryButton?.textContent).toContain("Fill missing setup with AI");
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
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "Not part of this active plan."),
    );
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
    [...(milestoneMenu?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Remove from plan"))
      ?.click();
    expect(onSetMilestoneStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-1" }),
      "archived",
      "Not part of this active plan.",
    );

    const subMenu = container.querySelector<HTMLElement>("[data-pcc-submilestone-action-menu]");
    const subTrigger = subMenu?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]");
    subTrigger?.click();
    expect(subMenu?.classList.contains("is-open")).toBe(true);
    [...(subMenu?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Reopen"))
      ?.click();
    expect(onSetSubMilestoneStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "submilestone-1" }),
      "not_started",
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

  it("keeps AI intake autofill visible while editing a project with missing setup", () => {
    const onProjectFormChange = vi.fn();
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
      }),
    );

    expect(container.querySelector("[data-pcc-project-intake-ai-repair]")).not.toBeNull();
    expect(container.querySelector("details[open] [data-pcc-intake-wizard]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-intake-answer-ai-tools]")).not.toBeNull();
    const autofill = container.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-autofill]",
    );
    expect(autofill?.textContent).toContain("Fill missing setup with AI");

    autofill?.click();

    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.stringContaining("SNES Game Creator"),
        intakeAnswers: expect.objectContaining({
          goal: expect.stringContaining("SNES Game Creator"),
          firstDeliverable: expect.stringContaining("SNES Game Creator"),
        }),
      }),
    );
  });

  it("lets the project intake answers page generate answers from selected project context", () => {
    const onProjectFormChange = vi.fn();
    const onPreviewSetupAutofill = vi.fn();
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
        onProjectFormChange,
        onPreviewSetupAutofill,
      }),
    );

    const intakeTools = container.querySelector("[data-pcc-intake-answer-ai-tools]");
    expect(intakeTools?.textContent).toContain("AI can fill any blanks here.");
    const generate = intakeTools?.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-autofill]",
    );
    expect(generate?.textContent).toContain("Generate answers with AI");

    generate?.click();

    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: "Create a readable SNES-style game workflow.",
        intakeAnswers: expect.objectContaining({
          goal: "Create a readable SNES-style game workflow.",
          firstDeliverable: expect.stringContaining(
            "Verify SNES toolchain and emulator smoke path",
          ),
        }),
      }),
    );

    container
      .querySelector<HTMLButtonElement>("[data-pcc-project-intake-preview-full-repair]")
      ?.click();
    expect(onPreviewSetupAutofill).toHaveBeenCalledTimes(1);
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

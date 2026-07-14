/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePccExecutionProfilePreset } from "../../../../src/pcc/execution-profile.js";
import {
  EMPTY_PCC_DECISION_FORM,
  EMPTY_PCC_MILESTONE_FORM,
  EMPTY_PCC_PROJECT_FORM,
} from "../controllers/pcc.ts";
import { renderPccDashboard, type PccDashboardProps } from "./pcc.ts";

const readySkill = (skillKey: string, description: string) => ({
  name: skillKey,
  description,
  source: "workspace",
  filePath: `.agents/skills/${skillKey}/SKILL.md`,
  baseDir: `.agents/skills/${skillKey}`,
  skillKey,
  always: false,
  disabled: false,
  blockedByAllowlist: false,
  blockedByAgentFilter: false,
  eligible: true,
  modelVisible: true,
  requirements: { bins: [], env: [], config: [], os: [] },
  missing: { bins: [], env: [], config: [], os: [] },
  configChecks: [],
  install: [],
});

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
      subMilestones: [subMilestone],
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
    expect(container.querySelector("[data-pcc-outcome-metrics]")?.textContent).toContain(
      "User understands next action in under 5 seconds.",
    );
    expect(text).toContain("Needs You");
    const projectCardBlocker =
      container.querySelector("[data-pcc-project-card-blocker]")?.textContent ?? "";
    expect(projectCardBlocker).toContain("Blocked");
    expect(projectCardBlocker).toContain("Remote Proof");
    expect(projectCardBlocker).not.toContain("Blocked by:");
    expect(
      container.querySelector("[data-pcc-project-card-skim-facts]")?.textContent,
    ).not.toContain("Due:");
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
    expect(text).toContain(
      "PCC remote Workflow Sanity proof is missing or is not bound to the verified SHA",
    );
    expect(container.querySelector("[data-pcc-selected-project-workspace]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-autopilot-hero-chip]")?.textContent).toContain(
      "Autopilot",
    );
    for (const button of container.querySelectorAll("[data-pcc-view-mode-option]")) {
      expect(button.hasAttribute("title")).toBe(false);
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("renders mobile PCC section controls over existing project sections", () => {
    const container = renderView(createProps());
    const rail = container.querySelector("[data-pcc-mobile-command-rail]");
    expect(rail).not.toBeNull();
    expect(rail?.textContent).toContain("Project Command Center");
    expect(rail?.textContent).toContain("Review Permission");
    const tabs = container.querySelector("[data-pcc-mobile-section-tabs]");
    expect(tabs).not.toBeNull();
    expect(tabs?.textContent).toContain("Projects");
    expect(tabs?.textContent).toContain("Status");
    expect(tabs?.textContent).toContain("Steps");
    expect(tabs?.textContent).toContain("AI Loop");
    expect(tabs?.textContent).toContain("Details");
    expect(container.querySelector('[data-pcc-mobile-section="projects"]')).not.toBeNull();
    expect(container.querySelector('[data-pcc-mobile-section="current"]')).not.toBeNull();
    expect(container.querySelector('[data-pcc-mobile-section="milestones"]')).not.toBeNull();
    expect(container.querySelector('[data-pcc-mobile-section="autopilot"]')).not.toBeNull();
    expect(container.querySelector('[data-pcc-mobile-section="more"]')).not.toBeNull();
    for (const button of container.querySelectorAll("[data-pcc-mobile-section-tab]")) {
      expect(button.getAttribute("aria-label")).toMatch(/^Open PCC /u);
    }
  });

  it("opens the real Autopilot surface from the Simple-mode mobile rail", () => {
    const onSetViewMode = vi.fn();
    const container = renderView(createProps({ viewMode: "simple", onSetViewMode }));
    const autopilotTab = container.querySelector<HTMLButtonElement>(
      '[data-pcc-mobile-section-tab="autopilot"]',
    );

    autopilotTab?.click();
    expect(onSetViewMode).toHaveBeenCalledWith("detailed");
  });

  it("reveals the Automation tab when AI Loop is selected outside Simple mode", () => {
    const container = renderView(createProps({ viewMode: "detailed" }));
    const automation = container.querySelector<HTMLElement>(
      '[data-pcc-detail-tab-panel="automation"]',
    );
    const autopilotTab = container.querySelector<HTMLButtonElement>(
      '[data-pcc-mobile-section-tab="autopilot"]',
    );

    expect(automation?.hidden).toBe(true);
    autopilotTab?.click();
    expect(automation?.hidden).toBe(false);
    expect(
      container
        .querySelector<HTMLButtonElement>('[data-pcc-detail-tab="automation"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("uses one resolved primary action across hero and mobile rail", () => {
    const onSetViewMode = vi.fn();
    const container = renderView(createProps({ onSetViewMode }));
    const heroAction = container.querySelector("[data-pcc-primary-action] button");
    const mobileAction = container.querySelector("[data-pcc-mobile-primary-action]");

    expect(heroAction?.textContent).toContain("Review Permission");
    expect(mobileAction?.textContent).toContain("Review Permission");
    expect(heroAction?.getAttribute("data-pcc-primary-action-id")).toBe("review_permission");
    (heroAction as HTMLButtonElement).click();
    expect(onSetViewMode).toHaveBeenCalledWith("detailed");
  });

  it("shows complete projects as maintenance with no misleading work CTA", () => {
    const completeProject = {
      ...project,
      status: "complete_with_maintenance" as const,
    };
    const completeSummary = {
      ...summary,
      status: "complete_with_maintenance" as const,
      milestoneCounts: { ...summary.milestoneCounts, complete: 5, needsApproval: 0 },
      percentComplete: 100,
      nextActions: [],
      proofGaps: [],
    };
    const container = renderView(
      createProps({
        projectDetail: {
          project: completeProject,
          milestones: [{ ...milestone, status: "complete" as const, percentComplete: 100 }],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary: completeSummary,
        },
        projects: [completeSummary],
      }),
    );

    expect(container.querySelector("[data-pcc-terminal-primary-status]")?.textContent).toContain(
      "No action required",
    );
    expect(container.querySelector("[data-pcc-primary-action]")).toBeNull();
    expect(container.querySelector("[data-pcc-blocker-center]")).toBeNull();
    expect(container.querySelector("[data-pcc-execution-readiness]")).toBeNull();
    expect(container.querySelector("[data-pcc-universal-preflight]")).toBeNull();
    expect(container.querySelector("[data-pcc-scope-lock]")).toBeNull();
    expect(container.querySelector("[data-pcc-autopilot-hero-chip]")).toBeNull();
    expect(container.querySelector(".pcc-project-snapshot__facts")).toBeNull();
    expect(container.querySelector("[data-pcc-project-brief]")).toBeNull();
    expect(container.querySelector("[data-pcc-outcome-metrics]")).toBeNull();
    expect(container.querySelector("[data-pcc-work-loop-complete]")?.textContent).toContain(
      "Project is complete",
    );
    expect(
      container.querySelector<HTMLButtonElement>("[data-pcc-project-tabs] button.is-selected")
        ?.textContent,
    ).toContain("All");
  });

  it("does not hide unfinished work behind a terminal project status", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project: { ...project, status: "complete_with_maintenance" as const },
          milestones: [milestone],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary: {
            ...summary,
            status: "complete_with_maintenance" as const,
            milestoneCounts: { ...summary.milestoneCounts, complete: 0, needsApproval: 0 },
            percentComplete: 100,
          },
        },
      }),
    );

    expect(container.querySelector("[data-pcc-maintenance-hero]")).toBeNull();
    expect(container.querySelector("[data-pcc-primary-action]")?.textContent).toContain(
      "Review Incomplete Work",
    );
    expect(container.querySelector("[data-pcc-blocker-center]")?.textContent).toContain(
      "unfinished milestone",
    );
  });

  it("keeps Simple mode focused on status and milestones instead of advanced activity and Autopilot", () => {
    const container = renderView(createProps({ viewMode: "simple" }));

    expect(container.querySelector("[data-pcc-project-snapshot]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-simple-project-facts]")?.textContent).toContain(
      "Current step",
    );
    expect(container.querySelector("[data-pcc-simple-project-facts]")?.textContent).toContain(
      "42%",
    );
    expect(container.querySelector("[data-pcc-milestone-journey]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-autopilot-project-loop]")).toBeNull();
    expect(container.querySelector("[data-pcc-autopilot-hero-chip]")).toBeNull();
    expect(container.querySelector("[data-pcc-execution-readiness]")).toBeNull();
    expect(container.querySelector("[data-pcc-universal-preflight]")).toBeNull();
    expect(container.querySelector("[data-pcc-scope-lock]")).toBeNull();
    expect(container.querySelector(".pcc-project-snapshot__facts")).toBeNull();
    expect(container.querySelector("[data-pcc-project-brief]")).toBeNull();
    expect(container.querySelector("[data-pcc-outcome-metrics]")).toBeNull();
    expect(container.querySelector("[data-pcc-project-activity]")).toBeNull();
  });

  it("places a selected project before Today in Simple mode", () => {
    const container = renderView(createProps({ viewMode: "simple" }));
    const workspace = container.querySelector("[data-pcc-selected-project-workspace]");
    const today = container.querySelector("[data-pcc-today]");
    const layout = container.querySelector(".pcc-layout");

    expect(workspace).not.toBeNull();
    expect(today).not.toBeNull();
    expect(layout?.classList.contains("pcc-layout--focus")).toBe(true);
    expect(workspace!.compareDocumentPosition(today!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(container.querySelector(".pcc-today-slot--after-workspace")).not.toBeNull();
    expect(container.querySelector("[data-pcc-portfolio-console]")).toBeNull();
    expect(container.querySelector("[data-pcc-production-truth]")).toBeNull();
    expect(container.querySelector("[data-pcc-recent-activity]")).toBeNull();
  });

  it("uses real Details tabs instead of showing every advanced panel at once", () => {
    const container = renderView(createProps({ viewMode: "detailed" }));
    const plan = container.querySelector<HTMLElement>('[data-pcc-detail-tab-panel="plan"]');
    const automation = container.querySelector<HTMLElement>(
      '[data-pcc-detail-tab-panel="automation"]',
    );
    const automationTab = container.querySelector<HTMLButtonElement>(
      '[data-pcc-detail-tab="automation"]',
    );

    expect(plan?.hidden).toBe(false);
    expect(automation?.hidden).toBe(true);
    automationTab?.click();
    expect(plan?.hidden).toBe(true);
    expect(automation?.hidden).toBe(false);
    expect(automationTab?.getAttribute("aria-selected")).toBe("true");
  });

  it("supports keyboard navigation between Details tabs", () => {
    const container = renderView(createProps({ viewMode: "detailed" }));
    const planTab = container.querySelector<HTMLButtonElement>('[data-pcc-detail-tab="plan"]');
    const activityTab = container.querySelector<HTMLButtonElement>(
      '[data-pcc-detail-tab="activity"]',
    );
    const activityPanel = container.querySelector<HTMLElement>(
      '[data-pcc-detail-tab-panel="activity"]',
    );

    planTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(activityTab?.getAttribute("aria-selected")).toBe("true");
    expect(activityPanel?.hidden).toBe(false);
  });

  it("shows a selected-project activity timeline from milestones, proof, receipts, and decisions", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project: { ...project, updatedAt: "2026-07-03T10:00:00Z" },
          milestones: [{ ...milestone, title: "Plan workflow", updatedAt: "2026-07-03T11:00:00Z" }],
          subMilestones: [
            {
              ...subMilestone,
              title: "Write acceptance criteria",
              status: "complete",
              percentComplete: 100,
              updatedAt: "2026-07-03T12:00:00Z",
            },
          ],
          permissions: [],
          evidence: [
            {
              ...evidence,
              summary: "Focused project proof passed",
              createdAt: "2026-07-03T13:00:00Z",
            },
          ],
          receipts: [
            {
              ...receipt,
              summary: "Project activity receipt recorded",
              completedAt: "2026-07-03T14:00:00Z",
            },
          ],
          decisions: [
            {
              ...decision,
              title: "Use activity timeline",
              summary: "Selected project needs a local audit trail.",
              decidedAt: "2026-07-03T15:00:00Z",
            },
          ],
          lastKnownGood: [],
          summary,
        },
      }),
    );

    const activity = container.querySelector("[data-pcc-project-activity]");
    expect(activity).not.toBeNull();
    expect(activity?.textContent).toContain("Project activity");
    expect(activity?.textContent).toContain("Use activity timeline");
    expect(activity?.textContent).toContain("Project activity receipt recorded");
    expect(activity?.textContent).toContain("Focused project proof passed");
    expect(activity?.textContent).toContain("Write acceptance criteria");
    expect(activity?.textContent).toContain("Plan workflow");
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
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary: {
            ...summary,
            nextActions: ["Continue implementation"],
            proofGaps: ["Browser proof missing"],
          },
        },
      }),
    );

    const card = container.querySelector("[data-pcc-project-card]");
    const cardBlocker = card?.querySelector("[data-pcc-project-card-blocker]")?.textContent ?? "";
    expect(cardBlocker).toContain("Browser proof missing");
    expect(cardBlocker).not.toContain("Blocked by:");
  });

  it("announces in-flight PCC saves instead of silently disabling controls", () => {
    const container = renderView(createProps({ actionBusy: true }));
    const busy = container.querySelector("[data-pcc-action-busy]");

    expect(busy).not.toBeNull();
    expect(busy?.getAttribute("role")).toBe("status");
    expect(busy?.getAttribute("aria-live")).toBe("polite");
    expect(busy?.getAttribute("aria-busy")).toBe("true");
    expect(busy?.textContent).toContain("Saving PCC change");
    expect(busy?.textContent).toContain("ledger does not receive duplicate writes");
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

  it("uses authoritative expanded metrics and focused portfolio progress", () => {
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
    expect(progress?.textContent?.replace(/\s+/g, " ")).toContain("1 Needs You");
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
    expect(
      container.querySelector('[data-pcc-detail-tab="decisions"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector<HTMLElement>('[data-pcc-detail-tab-panel="decisions"]')?.hidden,
    ).toBe(false);
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
    expect(simple.querySelector('[data-pcc-view-mode-option="detailed"] span')).toBeNull();
    expect(
      simple.querySelector('[data-pcc-view-mode-option="detailed"]')?.getAttribute("aria-label"),
    ).toBe("Detailed: Show milestones, receipts, and proof.");
    expect(simple.textContent).toContain("Switch to Detailed or Agent");
    expect(simple.querySelector("[data-pcc-work-loop]")).not.toBeNull();
    expect(simple.textContent).toContain("Stop after current task");
    expect(simple.querySelector("[data-pcc-production-truth]")).toBeNull();

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

    expect(text).toContain("Needs You");
    expect(text).toContain("Overdue Launch");
    expect(text).toContain("Overdue since");
    expect(text).toContain("1 Needs You");
    const needsYouTab = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-pcc-project-tabs] button"),
    ].find((button) => button.textContent?.includes("Needs You"));
    expect(needsYouTab?.textContent).toContain("1");
  });

  it("keeps maintenance proof cleanup out of urgent Needs You defaults", () => {
    const maintenanceSummary = {
      ...summary,
      id: "project-maintenance",
      title: "Project Command Center",
      status: "complete_with_maintenance" as const,
      proofGaps: ["Receipt references missing proof evidence: browser-proof"],
      milestoneCounts: { ...summary.milestoneCounts, blocked: 0, needsApproval: 0 },
      nextActions: ["Repair missing proof evidence"],
    };
    const onHoldSummary = {
      ...summary,
      id: "project-on-hold",
      title: "Paused Project",
      status: "on_hold" as const,
      proofGaps: ["Deferred proof"],
      milestoneCounts: { ...summary.milestoneCounts, blocked: 1, needsApproval: 0 },
      nextActions: ["Deferred by user"],
    };
    const container = renderView(
      createProps({
        projects: [onHoldSummary, maintenanceSummary],
        selectedProjectId: "project-maintenance",
        projectDetail: {
          project: {
            ...project,
            id: "project-maintenance",
            title: "Project Command Center",
            status: "complete_with_maintenance",
          },
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: maintenanceSummary,
        },
        portfolio: {
          projectsTotal: 2,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 1,
          archived: 0,
          averagePercentComplete: 50,
          nextActions: ["Repair missing proof evidence"],
        },
      }),
    );

    const selectedTab = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-pcc-project-tabs] button"),
    ].find((button) => button.getAttribute("aria-pressed") === "true");
    expect(selectedTab?.textContent).toContain("All");
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);
    expect(container.textContent).not.toContain("No projects in this view");
    expect(container.textContent).toContain("No PCC Product work needs you right now");
  });

  it("keeps on-hold projects out of Needs You and Next Best Action", () => {
    const onHoldSummary = {
      ...summary,
      id: "project-on-hold",
      title: "Paused Project",
      status: "on_hold" as const,
      proofGaps: ["Deferred proof"],
      health: "At risk",
      milestoneCounts: { ...summary.milestoneCounts, blocked: 1, needsApproval: 1 },
      nextActions: ["Deferred by user"],
    };
    const container = renderView(
      createProps({
        projects: [onHoldSummary],
        selectedProjectId: "project-on-hold",
        projectDetail: {
          project: {
            ...project,
            id: "project-on-hold",
            title: "Paused Project",
            status: "on_hold",
          },
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: onHoldSummary,
        },
        portfolio: {
          projectsTotal: 1,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 42,
          nextActions: [],
        },
      }),
    );

    expect(container.querySelector("[data-pcc-needs-attention-now]")?.textContent).toContain(
      "Nothing needs you right now",
    );
    expect(container.querySelector('[data-pcc-today-card="Needs You"]')?.textContent).toContain(
      "No approvals, blockers, or overdue projects need you.",
    );
    expect(
      container.querySelector('[data-pcc-today-card="Next Best Action"]')?.textContent,
    ).toContain("No ready action recorded.");
    expect(container.querySelector('[data-pcc-today-card="Needs You"]')?.textContent).not.toContain(
      "Paused Project",
    );
  });

  it("keeps Today compact, collapsed, and deduped from deferred project scope", () => {
    const scopedOutSummary = {
      ...summary,
      id: "snes",
      title: "SNES Game Creator",
      status: "active" as const,
      health: "At risk",
      percentComplete: 23,
      milestoneCounts: {
        total: 7,
        complete: 1,
        blocked: 1,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: [
        "Verify SNES toolchain and emulator smoke path: Project-specific SNES Game Creator work removed from current working scope by user; focus is PCC only.",
      ],
      recentActivity: "Project-specific work removed from current working scope by user.",
    };
    const completeSummary = {
      ...summary,
      id: "pcc-complete",
      title: "Project Command Center",
      status: "complete_with_maintenance" as const,
      health: "Complete",
      percentComplete: 100,
      milestoneCounts: {
        total: 35,
        complete: 35,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: [],
      proofGaps: [],
    };
    const container = renderView(
      createProps({
        projects: [scopedOutSummary, completeSummary],
        projectDetail: {
          ...createProps().projectDetail!,
          summary: completeSummary,
          project: { ...project, id: "pcc-complete", status: "complete_with_maintenance" as const },
          milestones: [],
        },
        selectedProjectId: "pcc-complete",
        portfolio: {
          projectsTotal: 2,
          active: 1,
          blocked: 0,
          needsApproval: 0,
          complete: 1,
          archived: 0,
          averagePercentComplete: 62,
          nextActions: [],
        },
      }),
    );

    const compact = container.querySelector("[data-pcc-today-compact-bar]");
    const overview = container.querySelector("[data-pcc-today-overview]") as HTMLDetailsElement;
    expect(compact).not.toBeNull();
    expect(overview).not.toBeNull();
    expect(overview.open).toBe(false);
    expect(compact?.textContent).toContain("0 running");
    expect(compact?.textContent).toContain("0 Needs You");
    expect(compact?.textContent).not.toContain("Project-specific SNES Game Creator work removed");
    expect(
      container.querySelector('[data-pcc-today-card="Working Now"]')?.textContent,
    ).not.toContain("SNES Game Creator");
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
        productFocusMode: "project_work",
        projectSearchQuery: "permits",
        onSetProjectSearchQuery,
      }),
    );

    expect(container.querySelector("[data-pcc-project-search]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-project-search-scope]")?.textContent).toContain(
      "Searching: Active",
    );
    expect(container.querySelector("[data-pcc-search-all]")?.textContent).toContain("Search all");
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

  it("guides empty Active views toward actionable project tabs", () => {
    const onSetProjectFilter = vi.fn();
    const maintenanceProject = {
      ...summary,
      id: "project-maintenance",
      title: "Project Command Center",
      status: "complete_with_maintenance" as const,
      milestoneCounts: {
        total: 28,
        complete: 27,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Record production proof"],
      proofGaps: ["Browser proof missing"],
      health: "Needs review",
    };
    const onHoldProject = {
      ...summary,
      id: "project-on-hold",
      title: "SNES Game Creator",
      status: "on_hold" as const,
      milestoneCounts: {
        total: 7,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Fill missing setup"],
      proofGaps: ["Setup missing"],
      health: "At risk",
    };

    const container = renderView(
      createProps({
        projects: [maintenanceProject, onHoldProject],
        selectedProjectId: "project-maintenance",
        projectFilter: "active",
        onSetProjectFilter,
        portfolio: {
          projectsTotal: 2,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 1,
          archived: 0,
          averagePercentComplete: 49,
          nextActions: ["Fill missing setup"],
        },
      }),
    );

    expect(
      container.querySelector('[data-pcc-empty][data-pcc-project-empty-state="active"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("No projects in this view");
    expect(container.textContent).toContain("No PCC Product work needs you right now");

    container.querySelector<HTMLButtonElement>("[data-pcc-empty-show-all]")?.click();

    expect(onSetProjectFilter).toHaveBeenCalledWith("all");
  });

  it("keeps filtering scoped to the project list instead of adding a conflicting selected-project banner", () => {
    const completeProject = {
      ...project,
      id: "project-maintenance",
      status: "complete_with_maintenance" as const,
    };
    const completeSummary = {
      ...summary,
      id: "project-maintenance",
      title: "Project Command Center",
      status: "complete_with_maintenance" as const,
      percentComplete: 100,
      milestoneCounts: { ...summary.milestoneCounts, total: 35, complete: 35, needsApproval: 0 },
      nextActions: [],
      proofGaps: [],
      health: "Complete",
    };
    const activeSummary = {
      ...summary,
      id: "project-active",
      title: "Active Proof Project",
      status: "active" as const,
      nextActions: ["Run first step"],
      proofGaps: [],
      health: "On track",
    };
    const container = renderView(
      createProps({
        projects: [completeSummary, activeSummary],
        projectDetail: {
          project: completeProject,
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary: completeSummary,
        },
        selectedProjectId: "project-maintenance",
        projectFilter: "active",
      }),
    );

    expect(container.querySelector("[data-pcc-selected-filtered-project]")).toBeNull();
    expect(container.querySelector("[data-pcc-project-snapshot]")?.textContent).toContain(
      "Project Command Center",
    );
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

  it("exposes stable project open selectors across dashboard surfaces", () => {
    const onSelectProject = vi.fn();
    const container = renderView(createProps({ onSelectProject }));

    const cardOpen = container.querySelector<HTMLButtonElement>(
      '[data-pcc-project-open-surface="card"][data-pcc-project-id="project-1"]',
    );
    const todayOpen = container.querySelector<HTMLButtonElement>(
      '[data-pcc-project-open-surface="today"][data-pcc-project-id="project-1"]',
    );
    const attentionOpen = container.querySelector<HTMLButtonElement>(
      '[data-pcc-project-open-surface="attention"][data-pcc-project-id="project-1"]',
    );
    const recentOpen = container.querySelector<HTMLButtonElement>(
      '[data-pcc-project-open-surface="recent-activity"][data-pcc-project-id="project-1"]',
    );

    expect(
      container.querySelector('[data-pcc-project-card][data-pcc-project-id="project-1"]'),
    ).not.toBeNull();
    expect(cardOpen?.getAttribute("aria-label")).toBe("Open Project Command Center");
    expect(todayOpen?.getAttribute("aria-label")).toContain("Open Project Command Center");
    expect(attentionOpen?.getAttribute("aria-label")).toBe(
      "Open Project Command Center from Needs You",
    );
    expect(recentOpen?.getAttribute("aria-label")).toBe(
      "Open Project Command Center from Recent Activity",
    );

    cardOpen?.click();
    todayOpen?.click();
    attentionOpen?.click();
    recentOpen?.click();

    expect(onSelectProject).toHaveBeenCalledTimes(4);
    expect(onSelectProject).toHaveBeenNthCalledWith(1, "project-1");
    expect(onSelectProject).toHaveBeenNthCalledWith(4, "project-1");
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
      updatedAt: new Date().toISOString(),
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
    expect(attention?.textContent).toContain("Needs You Now");
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

  it("keeps project cards skim-first while preserving sequence and signals", () => {
    const container = renderView(createProps());
    const skimFacts =
      container.querySelector("[data-pcc-project-card-skim-facts]")?.textContent ?? "";
    const sequence = container.querySelector("[data-pcc-project-card-sequence]")?.textContent ?? "";
    const blocker = container.querySelector("[data-pcc-project-card-blocker]")?.textContent ?? "";

    expect(skimFacts).toContain("2/5 milestones");
    expect(skimFacts).toContain("Needs You");
    expect(skimFacts).toContain("Work:");
    expect(skimFacts).not.toContain("Health:");
    expect(skimFacts).not.toContain("Priority:");
    expect(skimFacts).not.toContain("Due:");
    expect(skimFacts).not.toContain("Activity:");
    expect(skimFacts).not.toContain("Outcomes:");
    expect(sequence).toContain("Current: CRUD UI");
    expect(sequence).toContain("Next action:");
    expect(blocker).toContain("Blocked");
    expect(blocker).not.toContain("Blocked by:");
    expect(container.querySelector("[data-pcc-project-card-activity]")).toBeNull();
  });

  it("shows maintenance work state for complete-with-maintenance projects instead of fake current work", () => {
    const maintenanceSummary = {
      ...summary,
      status: "complete_with_maintenance" as const,
      milestoneCounts: {
        ...summary.milestoneCounts,
        total: 28,
        complete: 27,
        blocked: 0,
        needsApproval: 0,
      },
      proofGaps: [],
      nextActions: ["Actual Reboot Persistence Proof remains on hold."],
    };
    const container = renderView(
      createProps({
        projectFilter: "all",
        projects: [maintenanceSummary],
        projectDetail: {
          project: { ...project, status: "complete_with_maintenance" },
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: maintenanceSummary,
        },
      }),
    );

    const card = container.querySelector("[data-pcc-project-card]");
    const sequence = card?.querySelector("[data-pcc-project-card-sequence]")?.textContent ?? "";
    expect(card?.textContent).toContain("Work: Maintenance");
    expect(sequence).toContain("Maintenance only");
    expect(sequence).not.toContain("Current: Not started");
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

  it("separates PCC product focus from project-specific work", () => {
    const snesProject = {
      ...project,
      id: "snes-game-creator",
      title: "SNES Game Creator",
      metadata: { ...project.metadata, excludedFromPccProductCompletion: true },
    };
    const snesSummary = {
      ...summary,
      id: "snes-game-creator",
      title: "SNES Game Creator",
      pccWorkScope: "project_work" as const,
      nextActions: ["Resolve SNES toolchain blocker"],
    };
    const pccSummary = {
      ...summary,
      id: "project-command-center",
      title: "Project Command Center",
      pccWorkScope: "pcc_product" as const,
      status: "complete_with_maintenance" as const,
      percentComplete: 100,
      milestoneCounts: { ...summary.milestoneCounts, total: 35, complete: 35, needsApproval: 0 },
      nextActions: ["Review proof"],
    };
    const pccDetail = {
      project: {
        ...project,
        id: "project-command-center",
        status: "complete_with_maintenance" as const,
      },
      milestones: [
        {
          ...milestone,
          projectId: "project-command-center",
          status: "complete" as const,
          percentComplete: 100,
        },
      ],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: pccSummary,
    };
    const snesDetail = {
      project: snesProject,
      milestones: [milestone],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [],
      summary: snesSummary,
    };

    const productMode = renderView(
      createProps({
        projects: [pccSummary, snesSummary],
        projectDetail: pccDetail,
        projectDetails: { "project-command-center": pccDetail, "snes-game-creator": snesDetail },
        productFocusMode: "pcc_product",
        projectFilter: "all",
      }),
    );
    expect(
      Array.from(productMode.querySelectorAll("[data-pcc-project-card]")).some((card) =>
        card.textContent?.includes("SNES Game Creator"),
      ),
    ).toBe(false);
    expect(productMode.textContent).toContain("PCC Product");
    expect(productMode.textContent).toContain(
      "This is PCC Product work. It affects PCC completion.",
    );

    const projectMode = renderView(
      createProps({
        projects: [pccSummary, snesSummary],
        projectDetail: snesDetail,
        projectDetails: { "project-command-center": pccDetail, "snes-game-creator": snesDetail },
        selectedProjectId: "snes-game-creator",
        productFocusMode: "project_work",
        projectFilter: "all",
      }),
    );
    expect(projectMode.querySelector("[data-pcc-project-card]")?.textContent).toContain(
      "SNES Game Creator",
    );
    expect(projectMode.textContent).toContain("Project Work");
    expect(projectMode.textContent).toContain(
      "This is Project Work. It does not block PCC product completion.",
    );
  });

  it("keeps completed PCC projects out of setup and runner dead-end states", () => {
    const onPrepareNextWorkItem = vi.fn();
    const onSetViewMode = vi.fn();
    const completeSummary = {
      ...summary,
      status: "complete_with_maintenance" as const,
      percentComplete: 100,
      milestoneCounts: { ...summary.milestoneCounts, total: 35, complete: 35, needsApproval: 0 },
      nextActions: [],
    };
    const container = renderView(
      createProps({
        onPrepareNextWorkItem,
        onSetViewMode,
        viewMode: "simple",
        projectDetail: {
          project: { ...project, status: "complete_with_maintenance" as const, goal: "" },
          milestones: [{ ...milestone, status: "complete" as const, percentComplete: 100 }],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: completeSummary,
        },
      }),
    );

    expect(container.querySelector("[data-pcc-maintenance-hero]")?.textContent).toContain(
      "Complete With Maintenance",
    );
    expect(container.querySelector("[data-pcc-setup-repair]")).toBeNull();
    expect(container.querySelector("[data-pcc-work-loop]")).toBeNull();
    expect(
      container.querySelector("[data-pcc-detail]")?.getAttribute("data-pcc-detail-project-title"),
    ).toBe("Project Command Center");
    expect(
      container.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]")?.disabled,
    ).toBe(true);
    expect(container.querySelectorAll("[data-pcc-action-menu-trigger]")).toHaveLength(0);
    expect(container.querySelector("[data-pcc-primary-action] button")).toBeNull();
    expect(container.querySelector("[data-pcc-terminal-primary-status]")?.textContent).toContain(
      "No action required",
    );
    expect(container.querySelector("[data-pcc-execution-readiness]")).toBeNull();
    expect(container.querySelector("[data-pcc-universal-preflight]")).toBeNull();
    expect(container.querySelector("[data-pcc-mobile-primary-action]")).toBeNull();
    expect(container.querySelector("[data-pcc-mobile-command-rail]")).toBeNull();
    expect(container.querySelector(".pcc-project-snapshot__progress")).toBeNull();
    expect(onSetViewMode).not.toHaveBeenCalled();
    expect(onPrepareNextWorkItem).not.toHaveBeenCalled();
  });

  it("opens action menus with hidden DOM until the user asks for actions", () => {
    const container = renderView(createProps({ viewMode: "agent" }));
    const menu = container.querySelector<HTMLElement>("[data-pcc-action-menu]");
    const trigger = menu?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]");
    const items = menu?.querySelector<HTMLElement>(".pcc-action-menu__items");

    expect(items?.hidden).toBe(true);
    expect(items?.getAttribute("aria-hidden")).toBe("true");
    expect(items?.hasAttribute("inert")).toBe(true);

    trigger?.click();
    expect(items?.hidden).toBe(false);
    expect(items?.getAttribute("aria-hidden")).toBe("false");
    expect(items?.hasAttribute("inert")).toBe(false);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
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
    expect(primaryButton?.textContent).toContain("Fix Setup with AI");
    const setupRepairButton = container.querySelector<HTMLButtonElement>(
      "[data-pcc-setup-repair-ai-fill]",
    );
    expect(setupRepairButton?.textContent).toContain("Fill missing setup with AI");
    expect(container.querySelector("[data-pcc-setup-repair-codex-note]")?.textContent).toContain(
      "Codex planning requires approval before token spend",
    );
    expect(container.querySelector("[data-pcc-setup-repair-issues]")?.textContent).toContain(
      "Required intake answer missing",
    );
    setupRepairButton?.click();
    expect(onPreviewSetupAutofill).toHaveBeenCalledTimes(1);
    expect(onPrepareNextWorkItem).not.toHaveBeenCalled();
  });

  it("hides setup repair on terminal projects", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project: {
            ...project,
            status: "archived",
            goal: "",
            metadata: {
              pccIntake: { approved: false, answers: { goal: "" } },
            },
          },
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: { ...summary, status: "archived" },
        },
      }),
    );

    expect(container.querySelector("[data-pcc-setup-repair]")).toBeNull();
  });

  it("shows sub-milestone drill-down detail without cluttering simple mode", () => {
    const prerequisite = {
      ...subMilestone,
      id: "submilestone-prereq",
      title: "Gather source proof",
      status: "complete" as const,
      receiptIds: ["receipt-prereq"],
    };
    const target = {
      ...subMilestone,
      id: "submilestone-target",
      title: "Run acceptance proof",
      dependsOn: ["submilestone-prereq"],
      requiredEvidenceIds: ["evidence-sub"],
      receiptIds: ["receipt-sub"],
      acceptanceCriteria: ["Acceptance proof exits 0"],
      implementationPlan: "Run the focused acceptance proof and attach the receipt.",
    };
    const subEvidence = {
      ...evidence,
      id: "evidence-sub",
      summary: "Sub-milestone acceptance proof passed",
    };
    const subReceipt = {
      ...receipt,
      id: "receipt-sub",
      summary: "Sub-milestone completion receipt recorded.",
    };
    const subDecision = {
      ...decision,
      id: "decision-sub",
      subMilestoneId: "submilestone-target",
      title: "Use focused acceptance proof",
    };

    const detailed = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [prerequisite, target],
          permissions: [],
          evidence: [subEvidence],
          receipts: [subReceipt],
          decisions: [subDecision],
          summary,
        },
        viewMode: "detailed",
      }),
    );

    const drilldowns = detailed.querySelectorAll("[data-pcc-submilestone-drilldown]");
    expect(drilldowns.length).toBeGreaterThan(0);
    const text = detailed.textContent ?? "";
    expect(text).toContain("Details, proof, and dependencies");
    expect(text).toContain("Acceptance proof exits 0");
    expect(text).toContain("Gather source proof");
    expect(text).toContain("Sub-milestone acceptance proof passed");
    expect(text).toContain("Sub-milestone completion receipt recorded.");
    expect(text).toContain("Use focused acceptance proof");

    const simple = renderView(
      createProps({
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [prerequisite, target],
          permissions: [],
          evidence: [subEvidence],
          receipts: [subReceipt],
          decisions: [subDecision],
          summary,
        },
        viewMode: "simple",
      }),
    );

    expect(simple.querySelector("[data-pcc-submilestone-drilldown]")).toBeNull();
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
    expect(milestoneTrigger?.hasAttribute("data-pcc-milestone-actions")).toBe(true);
    expect(milestoneTrigger?.getAttribute("title")).toBe("Milestone actions");
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
    expect(subTrigger?.hasAttribute("data-pcc-submilestone-actions")).toBe(true);
    expect(subTrigger?.getAttribute("title")).toBe("Sub-step actions");
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
        reorderMode: true,
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
          receipts: [
            {
              ...receipt,
              artifactRefs: [
                "/tmp/openclaw-dashboard-pcc-proof.png",
                "https://github.com/SnowBelt/openclaw/actions/runs/123",
              ],
            },
          ],
          summary,
        },
      }),
    );

    expect(container.querySelector("[data-pcc-project-receipts]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pcc-receipt]").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll("[data-pcc-evidence-list]").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector("[data-pcc-receipt-artifacts]")?.textContent).toContain(
      "/tmp/openclaw-dashboard-pcc-proof.png",
    );
    expect(container.querySelector("[data-pcc-receipt]")?.textContent).toContain("Artifacts");
    expect(container.querySelector("[data-pcc-receipt]")?.textContent).toContain("2 refs");
    expect(container.textContent).toContain("Completion receipt");
    expect(container.textContent).toContain("Do not redo");
    expect(container.textContent).toContain("Local PCC proof passed");

    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add receipt"),
    );
    expect(add?.disabled).toBe(true);
  });

  it("surfaces project-level receipts and artifact refs in the detail drawer", () => {
    const container = renderView(
      createProps({
        viewMode: "detailed",
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [],
          permissions: [],
          evidence: [evidence],
          receipts: [
            {
              ...receipt,
              artifactRefs: ["/tmp/openclaw-dashboard-pcc-proof.png"],
            },
          ],
          decisions: [],
          lastKnownGood: [],
          summary,
        },
      }),
    );

    const projectReceipts = container.querySelector("[data-pcc-project-receipts]");
    expect(projectReceipts).not.toBeNull();
    expect(projectReceipts?.textContent).toContain("Receipts & Artifacts");
    expect(projectReceipts?.textContent).toContain("1 receipt");
    expect(projectReceipts?.textContent?.replace(/\s+/g, " ")).toContain("1 artifact");
    expect(projectReceipts?.textContent).toContain("/tmp/openclaw-dashboard-pcc-proof.png");
    expect(projectReceipts?.querySelector("[data-pcc-receipt-artifacts]")?.textContent).toContain(
      "Artifacts",
    );
  });

  it("renders legacy receipt and evidence-link rows without crashing detail view", () => {
    const legacyReceipt = {
      ...receipt,
      id: "legacy-receipt",
      proofEvidenceIds: undefined,
      doNotRedo: "Do not repeat stale runtime proof.",
      followUpGaps: "Refresh browser proof if runtime changes.",
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

    expect(container.querySelector("[data-pcc-project-receipts]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pcc-receipt]").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll("[data-pcc-decision]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-last-known-good]")).toHaveLength(1);
    expect(container.querySelector("[data-pcc-receipt]")?.textContent).toMatch(
      /Evidence\s+0\s+items/,
    );
    expect(container.querySelector("[data-pcc-receipt]")?.textContent).toContain(
      "Do not repeat stale runtime proof.",
    );
    expect(container.querySelector("[data-pcc-receipt]")?.textContent).toContain(
      "Refresh browser proof if runtime changes.",
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

  it("shows resume as the primary fix for on-hold projects with legacy worker metadata", () => {
    const onResumeProject = vi.fn();
    const onPreviewSetupAutofill = vi.fn();
    const container = renderView(
      createProps({
        onResumeProject,
        onPreviewSetupAutofill,
        projectDetail: {
          project: {
            ...project,
            status: "on_hold" as const,
            metadata: {
              ...project.metadata,
              pccSetupScore: { score: 100, runnable: true },
              pccQualityGate: { status: "passing" },
            },
          },
          milestones: [
            {
              ...milestone,
              status: "on_hold" as const,
              metadata: {
                recommendedWorker: "OpenClaw local agent",
                proofRequired: "local_test",
              },
            },
          ],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: { ...summary, status: "on_hold" as const },
        },
      }),
    );

    expect(container.textContent).toContain("Resume Project");
    expect(container.textContent).toContain("Project is on hold. Resume it before starting");
    expect(container.textContent).not.toContain("Setup quality gate is missing");
    container.querySelector<HTMLButtonElement>("[data-pcc-resume-project]")?.click();
    expect(onResumeProject).toHaveBeenCalledTimes(1);
    expect(onPreviewSetupAutofill).not.toHaveBeenCalled();
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
          sha: verifiedSha,
        },
        {
          ...evidence,
          id: "browser-proof",
          projectId: "project-command-center",
          milestoneId: "pcc-proof",
          kind: "browser_proof" as const,
          sha: verifiedSha,
        },
      ],
      receipts: [
        {
          ...receipt,
          projectId: "project-command-center",
          milestoneId: "pcc-proof",
          proofEvidenceIds: ["remote-proof", "browser-proof"],
        },
      ],
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
            {
              ...evidence,
              kind: "remote_ci",
              sha: "4d8408034d7131470980c316a2af2f311aa6b785",
            },
            {
              ...evidence,
              id: "evidence-2",
              kind: "browser_proof",
              sha: "4d8408034d7131470980c316a2af2f311aa6b785",
            },
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

  it("renders portfolio work console as honest plan-only guidance, not dead controls", () => {
    const container = renderView(createProps());
    const console = container.querySelector("[data-pcc-portfolio-console]");
    const mode = container.querySelector("[data-pcc-portfolio-plan-mode]");

    expect(console).not.toBeNull();
    expect(console?.getAttribute("data-pcc-portfolio-console-ready")).toBe("false");
    const details = console?.querySelector("details") as HTMLDetailsElement | null;
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(console?.querySelector("summary")?.textContent).toContain("No ready portfolio work");
    expect(mode?.textContent).toContain("Plan only");
    expect(mode?.getAttribute("role")).toBe("status");
    expect(console?.textContent).toContain("No local-safe portfolio work is ready to start.");
    expect(
      [...(console?.querySelectorAll<HTMLButtonElement>("button") ?? [])].some((button) =>
        button.textContent?.includes("Work Ready Projects"),
      ),
    ).toBe(false);
    expect(
      [...(console?.querySelectorAll<HTMLButtonElement>("button") ?? [])].some((button) =>
        button.textContent?.includes("Pause All"),
      ),
    ).toBe(false);
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
    expect(container.querySelector("[data-pcc-maintenance-hero]")?.textContent).toContain(
      "No action required",
    );
    expect(container.querySelector("[data-pcc-primary-action]")).toBeNull();
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

  it("starts new project creation with one clear prompt, one generate action, and visible AI roles", () => {
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: { ...EMPTY_PCC_PROJECT_FORM },
      }),
    );

    expect(
      container.querySelector("[data-pcc-create-flow]")?.getAttribute("data-pcc-create-step"),
    ).toBe("describe");
    expect(container.querySelector("[data-pcc-create-ai-explainer]")?.textContent).toContain(
      "AI fills only the blanks",
    );
    expect(container.querySelector("[data-pcc-create-ai-explainer]")?.textContent).toContain(
      "Anything you type stays unchanged",
    );
    expect(container.querySelector("[data-pcc-ai-role-picker]")?.textContent).toContain("Focused");
    expect(container.querySelector("[data-pcc-ai-role-picker]")?.textContent).toContain(
      "No automatic Codex use",
    );
    expect(container.querySelector("[data-pcc-create-ai-summary]")?.textContent).toContain(
      "without an LLM call",
    );
    expect(container.querySelector("[data-pcc-create-customize]")?.hasAttribute("open")).toBe(
      false,
    );
    expect(
      container.querySelector<HTMLButtonElement>("[data-pcc-create-review-plan]")?.disabled,
    ).toBe(true);
    expect(container.querySelector("[data-pcc-create-review-plan]")?.textContent?.trim()).toBe(
      "Generate project plan",
    );
  });

  it("offers five conflict-free execution profiles with qualitative Codex usage guidance", () => {
    const onProjectFormChange = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          projectDescription: "Build a dependable family calendar app.",
        },
        onProjectFormChange,
      }),
    );

    expect(container.querySelectorAll("[data-pcc-execution-profile]")).toHaveLength(5);
    expect(container.querySelector('[data-pcc-execution-profile="ultra_local"]')).not.toBeNull();
    container
      .querySelector<HTMLInputElement>('[data-pcc-execution-profile="ultra_hybrid"]')
      ?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        executionProfile: expect.objectContaining({
          presetId: "ultra_hybrid",
          codexRole: "lead",
          speed: "ultra",
        }),
        codexPlanningAllowed: false,
      }),
    );

    const codexContainer = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          projectDescription: "Build a dependable family calendar app.",
          executionProfile: resolvePccExecutionProfilePreset("ultra_hybrid"),
        },
      }),
    );
    expect(codexContainer.querySelector("[data-pcc-ai-role-picker]")?.textContent).toContain(
      "Ultra + Codex",
    );
    expect(codexContainer.querySelector("[data-pcc-create-ai-summary]")?.textContent).toContain(
      "one Codex approval is required before creation",
    );
    expect(codexContainer.querySelector("[data-pcc-planner-permission-card]")).toBeNull();
    expect(codexContainer.querySelector("[data-pcc-planner-permission-budget]")).toBeNull();
  });

  it("keeps unavailable models out of new choices while explaining a stale saved selection", () => {
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          projectDescription: "Build a dependable family calendar app.",
          executionProfile: {
            ...resolvePccExecutionProfilePreset("local_focused"),
            localModelId: "ollama/removed-local",
          },
        },
        modelCatalog: [
          {
            id: "removed-local",
            name: "Removed Local",
            provider: "ollama",
            available: false,
            agentRuntime: { id: "openclaw", source: "model" },
          },
          {
            id: "current-local",
            name: "Current Local",
            provider: "ollama",
            available: true,
            agentRuntime: { id: "openclaw", source: "model" },
          },
        ],
      }),
    );
    const options = [
      ...container.querySelectorAll<HTMLOptionElement>("[data-pcc-planner-model] option"),
    ];
    const removed = options.find((option) => option.value === "ollama/removed-local");

    expect(removed?.disabled).toBe(true);
    expect(removed?.textContent).toContain("Unavailable");
    expect(options.some((option) => option.value === "ollama/current-local")).toBe(true);
  });

  it("shows one coherent project profile, safe agent-team action, and recommendation-only learning", () => {
    const onRunExecutionTeam = vi.fn();
    const parallelMilestone = {
      ...milestone,
      status: "not_started" as const,
      percentComplete: 0,
      metadata: {
        ...milestone.metadata,
        parallelSafe: true,
        workspaceLock: "workspace:ui",
      },
    };
    const parallelSubMilestone = {
      ...subMilestone,
      milestoneId: parallelMilestone.id,
      status: "not_started" as const,
      metadata: {
        ...subMilestone.metadata,
        pccProofLevel: "local",
        parallelSafe: true,
        workspaceLock: "workspace:ui",
      },
    };
    const container = renderView(
      createProps({
        projectDetail: {
          project: {
            ...project,
            metadata: {
              ...project.metadata,
              pccExecutionProfile: resolvePccExecutionProfilePreset("local_parallel"),
              pccLearningCandidates: [
                {
                  status: "proposed",
                  contentSummary: "Reuse the verified project-intake checklist.",
                },
              ],
            },
          },
          milestones: [parallelMilestone],
          subMilestones: [parallelSubMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary: {
            ...summary,
            status: "active",
            percentComplete: 0,
            milestoneCounts: {
              total: 1,
              complete: 0,
              blocked: 0,
              needsApproval: 0,
              deferred: 0,
              skipped: 0,
            },
          },
        },
        projectDetails: {},
        executionCapacity: {
          logicalCpuCount: 12,
          performanceCpuCount: 8,
          totalRamGb: 64,
          freeRamGb: 48,
          load1: 1,
          load5: 1,
          load15: 1,
          memoryPressure: "low",
          activeOpenClawTaskCount: 0,
          configuredSubagentLimit: 4,
          observedLocalModelProcessCount: 0,
          safeLocalAgentSlots: 4,
          timestamp: "2026-07-13T12:00:00.000Z",
          warnings: [],
        },
        agentsList: {
          defaultId: "main",
          mainKey: "main",
          scope: "per-sender",
          agents: [
            {
              id: "main",
              model: { primary: "ollama/qwen3.6" },
              agentRuntime: { id: "openclaw", source: "model" },
            },
          ],
        },
        modelCatalog: [
          {
            id: "qwen3.6",
            name: "Qwen 3.6",
            provider: "ollama",
            available: true,
            agentRuntime: { id: "openclaw", source: "model" },
          },
        ],
        skillsReport: {
          workspaceDir: "/workspace",
          managedSkillsDir: "/skills",
          skills: [
            readySkill("openclaw-testing", "Run targeted OpenClaw tests and verification."),
            readySkill("control-ui-e2e", "Run live browser UI interaction proof."),
          ],
        },
        onRunExecutionTeam,
      }),
    );

    expect(container.querySelector("[data-pcc-project-execution-profile]")?.textContent).toContain(
      "Parallel",
    );
    expect(container.querySelector("[data-pcc-execution-team-status='ready']")).not.toBeNull();
    expect(container.querySelector("[data-pcc-execution-standard]")?.textContent).toContain(
      "93/100 minimum",
    );
    expect(container.querySelector("[data-pcc-execution-standard]")?.textContent).toContain(
      "control-ui-e2e",
    );
    const runButton = container.querySelector<HTMLButtonElement>(
      '[data-pcc-execution-team-action="start"]',
    );
    expect(runButton?.textContent).toContain("Run with 1 worker");
    runButton?.click();
    expect(onRunExecutionTeam).toHaveBeenCalledWith("start");
    expect(container.querySelector("[data-pcc-learning-loop]")?.textContent).toContain(
      "Recommendations only",
    );
    expect(container.querySelector("[data-pcc-learning-loop]")?.textContent).toContain(
      "never edits",
    );
    expect(
      container.querySelector("[data-pcc-autopilot-execution-profile]")?.textContent,
    ).toContain("Parallel");
  });

  it("fills only missing project details and preserves everything the user entered", () => {
    const onProjectFormChange = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "My Kitchen Plan",
          goal: "Finish the kitchen safely and on budget.",
          projectDescription:
            "Plan a kitchen remodel without missing permits, inspections, or budget checks.",
          intakeAnswers: { owner: "Todd" },
        },
        onProjectFormChange,
      }),
    );

    container.querySelector<HTMLButtonElement>("[data-pcc-create-review-plan]")?.click();

    expect(onProjectFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My Kitchen Plan",
        goal: "Finish the kitchen safely and on budget.",
        outcomeMetrics: expect.stringContaining(
          "My Kitchen Plan produces a first approved deliverable",
        ),
        intakeApproved: true,
        planPreviewAccepted: true,
        intakeAnswers: expect.objectContaining({
          owner: "Todd",
          goal: "Finish the kitchen safely and on budget.",
          doneProof: expect.stringContaining("completion receipt"),
        }),
      }),
    );
  });

  it("uses one Codex approval on review and does not expose a token-budget control", () => {
    const onProjectFormChange = vi.fn();
    const base = {
      ...EMPTY_PCC_PROJECT_FORM,
      title: "Simple Codex project",
      goal: "Use Codex without conflicting controls.",
      projectDescription: "Create a clear project plan.",
      outcomeMetrics: "The plan is clear.",
      aiUsePolicy: "codex_expert" as const,
      plannerMode: "codex" as const,
      planningMode: "codex_full_plan" as const,
      executionProfile: resolvePccExecutionProfilePreset("balanced"),
      intakeAnswers,
      intakeApproved: true,
      planPreviewAccepted: true,
    };
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: { ...base, codexPlanningAllowed: false },
        onProjectFormChange,
      }),
    );

    expect(container.querySelectorAll("[data-pcc-planner-permission-card]")).toHaveLength(1);
    expect(container.querySelector("[data-pcc-planner-permission-budget]")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>("[data-pcc-create-project-confirm]")?.disabled,
    ).toBe(true);
    container.querySelector<HTMLButtonElement>("[data-pcc-planner-permission-allow]")?.click();
    expect(onProjectFormChange).toHaveBeenCalledWith({ codexPlanningAllowed: true });

    const approved = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: { ...base, codexPlanningAllowed: true },
      }),
    );
    expect(
      approved.querySelector<HTMLButtonElement>("[data-pcc-create-project-confirm]")?.disabled,
    ).toBe(false);
    expect(
      approved
        .querySelector("[data-pcc-planner-permission-saved]")
        ?.textContent?.replace(/\s+/gu, " "),
    ).toContain("no hard token cap");
  });

  it("shows a review-first plan and one explicit create action before saving", () => {
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          title: "Kitchen Plan",
          goal: "Plan the kitchen remodel.",
          projectDescription: "Plan the kitchen remodel.",
          outcomeMetrics: "The remodel plan is approved.",
          intakeAnswers,
          intakeApproved: true,
          planPreviewAccepted: true,
        },
      }),
    );

    expect(
      container.querySelector("[data-pcc-create-flow]")?.getAttribute("data-pcc-create-step"),
    ).toBe("review");
    expect(
      container.querySelector("[data-pcc-create-review-ready]")?.textContent?.replace(/\s+/gu, " "),
    ).toContain("Nothing has been created or started yet");
    expect(container.querySelector("[data-pcc-plan-preview]")).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>("[data-pcc-create-project-confirm]")?.disabled,
    ).toBe(false);
    expect(container.querySelector("[data-pcc-create-review-ready]")?.textContent).toMatch(
      /milestones · \d+ sub-steps/u,
    );
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

  it("lets a title-only project continue so AI can fill the remaining setup", () => {
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: { ...EMPTY_PCC_PROJECT_FORM, title: "Blank intake project" },
      }),
    );

    expect(container.querySelector("[data-pcc-intake-blocked]")).not.toBeNull();
    const save = container.querySelector<HTMLButtonElement>("[data-pcc-create-review-plan]");
    expect(save?.disabled).toBe(false);
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
    expect(container.querySelector("[data-pcc-intake-wizard]")).toBeNull();
    const autofill = container.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-autofill]",
    );
    expect(autofill?.textContent).toContain("Fill missing details with AI");

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
        projectEditMode: "advanced",
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
      "[data-pcc-project-intake-form-only-autofill]",
    );
    expect(pageAutofill?.textContent).toContain("Autofill answers with AI");

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

    const fullSetupPreview = intakeTools?.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-primary-ai]",
    );
    expect(fullSetupPreview?.textContent).toContain("Preview full setup repair");

    fullSetupPreview?.click();

    expect(onPreviewSetupAutofill).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-pcc-autofill-preview]")).not.toBeNull();
    expect(container.textContent).toContain("AI Autofill Preview");
    expect(container.querySelector("[data-pcc-autofill-preview]")?.textContent).toContain(
      "Apply draft",
    );

    container.querySelector<HTMLButtonElement>("[data-pcc-autofill-preview] button")?.click();
    expect(onApplySetupAutofill).toHaveBeenCalledTimes(1);
  });

  it("makes approved setup autofill apply wording explicit", () => {
    const container = renderView(
      createProps({
        autofillPreview: {
          projectId: "project-1",
          goal: "Track every project.",
          intakeAnswers,
          intakeApproved: true,
          workflowTemplateId: "software-product",
          workflowTitle: "Software Product",
          summary: "PCC drafted and approved missing setup from existing context.",
          milestoneUpdates: [],
          subMilestoneUpdates: [],
        },
      }),
    );

    expect(container.querySelector("[data-pcc-autofill-preview]")?.textContent).toContain(
      "Apply + approve setup",
    );
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
          aiUsePolicy: "codex_expert",
          executionProfile: resolvePccExecutionProfilePreset("balanced"),
          codexPlanningAllowed: false,
          planPreviewAccepted: true,
        },
        onProjectFormChange,
      }),
    );
    expect(codexContainer.querySelector("[data-pcc-planner-permission-card]")).not.toBeNull();
    expect(codexContainer.querySelector("[data-pcc-ai-role-picker]")?.textContent).toContain(
      "Codex",
    );
    expect(codexContainer.textContent).toContain("One Codex permission");
    expect(codexContainer.textContent).toContain("no hard token cap");
    expect(codexContainer.querySelector("[data-pcc-planner-permission-budget]")).toBeNull();
    expect(codexContainer.querySelectorAll("[data-pcc-planner-permission-card]")).toHaveLength(1);

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
    expect(pmContainer.querySelector("[data-pcc-ai-role-picker]")?.textContent).toContain(
      "Focused",
    );
    expect(pmContainer.textContent).toContain("without an LLM call");
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

    const copyButton = container.querySelector<HTMLButtonElement>(
      '[data-pcc-copy-context="compact"]',
    );
    expect(copyButton?.getAttribute("aria-live")).toBe("polite");
    copyButton?.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("Next milestone: CRUD UI");
    expect(writeText.mock.calls[0]?.[0]).toContain("Worker: local_openclaw_agent");
    expect(copyButton?.dataset.pccCopyState).toBe("copied");
    expect(copyButton?.textContent).toBe("Copied");
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

  it("renders audit-closure workspace controls without cluttering the default path", () => {
    const onSetProjectEditMode = vi.fn();
    const onPreviewSectionAutofill = vi.fn();
    const onUndoAction = vi.fn();
    const container = renderView(
      createProps({
        viewMode: "detailed",
        editorMode: "edit-project",
        projectForm: {
          ...EMPTY_PCC_PROJECT_FORM,
          id: "project-1",
          title: "Project Command Center",
          goal: "Track every project",
          plannerMode: "best_available",
          plannerModelId: "best-available",
          intakeAnswers,
          intakeApproved: true,
          planPreviewAccepted: true,
        },
        projectEditMode: "ai",
        reorderMode: true,
        onSetProjectEditMode,
        onPreviewSectionAutofill,
        onUndoAction,
        modelCatalog: [{ id: "gpt-5.5", name: "GPT-5.5", provider: "openai" }],
        modelsLastRefreshedAt: Date.parse("2026-07-04T12:00:00Z"),
        actionNotice: {
          kind: "success",
          text: "Saved new milestone order for Runtime proof.",
          undoLabel: "Undo",
        },
        projectDetail: {
          project: { ...project, status: "on_hold" as const },
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [decision],
          summary: { ...summary, status: "on_hold" as const },
        },
      }),
    );

    expect(container.querySelector("[data-pcc-deferred-project-banner]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-detail-tabs]")?.textContent).toContain("Plan");
    expect(container.querySelector("[data-pcc-detail-tabs]")?.textContent).toContain("Proof");
    expect(container.querySelector("[data-pcc-work-loop]")?.textContent).toContain(
      "Resume Project",
    );
    expect(container.querySelector("[data-pcc-action-undo]")).not.toBeNull();
    container.querySelector<HTMLButtonElement>("[data-pcc-action-undo]")?.click();
    expect(onUndoAction).toHaveBeenCalledTimes(1);

    const advanced = container.querySelector<HTMLButtonElement>('[data-pcc-edit-mode="advanced"]');
    advanced?.click();
    expect(onSetProjectEditMode).toHaveBeenCalledWith("advanced");

    const goalRegenerate = container.querySelector<HTMLButtonElement>(
      '[data-pcc-section-ai-regenerate="goal"]',
    );
    expect(goalRegenerate).not.toBeNull();
    goalRegenerate?.click();
    expect(onPreviewSectionAutofill).toHaveBeenCalledWith("goal");

    const milestoneRow = container.querySelector<HTMLElement>("[data-pcc-journey-step]");
    const milestoneHandle = container.querySelector<HTMLElement>(
      '[data-pcc-drag-handle="milestone"]',
    );
    expect(milestoneRow?.getAttribute("draggable")).toBeNull();
    expect(milestoneHandle?.getAttribute("draggable")).toBe("true");
    expect(container.querySelector("[data-pcc-reorder-instruction]")?.textContent).toContain(
      "Action menus are paused",
    );
    expect(container.querySelector("[data-pcc-model-refresh-status]")?.textContent).toContain(
      "Last refresh:",
    );
  });

  it("shows confirmation popovers and supports keyboard dismissal for action menus", () => {
    const onSetMilestoneStatus = vi.fn();
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
      }),
    );

    const milestoneMenu = container.querySelector<HTMLElement>("[data-pcc-action-menu]");
    milestoneMenu?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.click();
    const skip = [...(milestoneMenu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent?.includes("Skip"),
    );
    skip?.click();
    expect(container.querySelector("[data-pcc-confirm-popover]")?.textContent).toContain(
      "Confirm skip",
    );
    expect(onSetMilestoneStatus).not.toHaveBeenCalled();

    milestoneMenu
      ?.querySelector<HTMLElement>(".pcc-action-menu__items")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(milestoneMenu?.classList.contains("is-open")).toBe(false);
  });
  it("renders Autopilot Project Loop controls, prompts, history, and safety copy", () => {
    const onGenerateAutopilotPrompts = vi.fn();
    const onRunAutopilotAction = vi.fn();
    const onConfigureAutopilotMode = vi.fn();
    const container = renderView(
      createProps({
        onGenerateAutopilotPrompts,
        onRunAutopilotAction,
        onConfigureAutopilotMode,
      }),
    );

    const autopilot = container.querySelector("[data-pcc-autopilot-project-loop]");
    expect(autopilot).not.toBeNull();
    expect(container.querySelector("[data-pcc-autopilot-hero-chip]")?.textContent).toContain(
      "Full Build Review",
    );
    expect(autopilot?.textContent).toContain("Autopilot Project Loop");
    expect(autopilot?.textContent).toContain("Simulation mode is active");
    expect(
      container.querySelector("[data-pcc-autopilot-execution-standard]")?.textContent,
    ).toContain("93/100 minimum");
    expect(autopilot?.textContent).toContain("Permission needed before start");
    expect(container.querySelector("[data-pcc-autopilot-permission-queue]")).not.toBeNull();
    expect(container.querySelector("[data-pcc-autopilot-grant-history]")).not.toBeNull();
    expect(autopilot?.textContent).toContain("Prompt slots");
    expect(container.querySelector("[data-pcc-autopilot-mode-picker]")).not.toBeNull();
    expect(container.querySelectorAll("[data-pcc-autopilot-prompt]").length).toBeGreaterThan(0);

    container.querySelector<HTMLButtonElement>("[data-pcc-autopilot-generate-prompts]")?.click();
    expect(onGenerateAutopilotPrompts).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>("[data-pcc-autopilot-start]")?.disabled).toBe(
      true,
    );
    container.querySelector<HTMLButtonElement>("[data-pcc-autopilot-allow-medium]")?.click();
    expect(onRunAutopilotAction).toHaveBeenCalledWith("allow_medium_risk");
  });

  it("shows an exact Autopilot blocker when the live skill catalog cannot load", () => {
    const container = renderView(createProps({ skillsReport: null }));
    const standard = container.querySelector("[data-pcc-autopilot-execution-standard]");

    expect(standard?.textContent).toContain("Needs attention");
    expect(standard?.textContent).toMatch(/live skill catalog could not be loaded/iu);
    expect(container.querySelector<HTMLButtonElement>("[data-pcc-autopilot-start]")?.disabled).toBe(
      true,
    );
  });

  it("renders Autopilot durable permission queue, grants, and repair actions", () => {
    const onRunAutopilotAction = vi.fn();
    const autopilotProject = {
      ...project,
      metadata: {
        ...project.metadata,
        pccAutopilot: {
          status: "blocked",
          mode: "full_build_review",
          modeTitle: "Full Build Review",
          currentExecutor: "safe_stub",
          promptSlots: [],
          permissionGrants: [
            {
              id: "grant-1",
              projectId: project.id,
              scope: "autopilot_project_loop",
              riskTier: "medium",
              allowedActions: ["run_safe_stub_prompt"],
              deniedActions: ["deploy"],
              status: "active",
              requester: "PCC Autopilot",
              approvedBy: "User",
              reason: "Medium-risk Autopilot work approved for this project.",
              createdAt: "2026-07-08T12:00:00Z",
              updatedAt: "2026-07-08T12:00:00Z",
              auditLog: [],
            },
          ],
          permissionQueue: [
            {
              id: "queue-1",
              projectId: project.id,
              status: "pending",
              requestedAction: "start_autopilot_loop",
              riskTier: "medium",
              promptSlotIds: ["slot-1"],
              promptTitles: ["Review build"],
              executor: "safe_stub",
              affectedSurfaces: ["Project"],
              reason: "Review build requires medium-risk approval.",
              approvalConsequence: "Safe loop can run inside scope.",
              denialConsequence: "Loop remains blocked.",
              createdAt: "2026-07-08T12:00:00Z",
              updatedAt: "2026-07-08T12:00:00Z",
              auditLog: [],
            },
          ],
          permissionRepair: {
            id: "repair-1",
            status: "preview",
            title: "Lower Autopilot prompts to safe read-only work",
            summary: "Convert blocked prompts to low-risk review.",
            targetPromptSlotIds: ["slot-1"],
            recommendedAction: "lower_to_low_risk_read_only",
            changes: ["Set blocked prompt slots to low-risk approval tier."],
            createdAt: "2026-07-08T12:00:00Z",
          },
        },
      },
    };
    const container = renderView(
      createProps({
        viewMode: "detailed",
        onRunAutopilotAction,
        projectDetail: {
          project: autopilotProject,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        },
      }),
    );

    expect(container.querySelector("[data-pcc-autopilot-permission-queue]")?.textContent).toContain(
      "Review build requires medium-risk approval.",
    );
    expect(container.querySelector("[data-pcc-autopilot-grant-history]")?.textContent).toContain(
      "Medium grant active",
    );
    expect(container.querySelector("[data-pcc-autopilot-repair-preview]")?.textContent).toContain(
      "Convert blocked prompts to low-risk review.",
    );
    container.querySelector<HTMLButtonElement>("[data-pcc-autopilot-revoke-grant]")?.click();
    expect(onRunAutopilotAction).toHaveBeenCalledWith("revoke_permission_grant");
    container.querySelector<HTMLButtonElement>("[data-pcc-autopilot-apply-repair]")?.click();
    expect(onRunAutopilotAction).toHaveBeenCalledWith("apply_permission_repair");
  });

  it("renders operational confidence readiness, preflight, scope lock, and recovery center", () => {
    const base = createProps();
    const container = renderView(
      createProps({
        viewMode: "detailed",
        actionError: "invalid pcc.milestones.upsert params: at /milestone/order: must be >= 0",
        projectDetail: {
          ...base.projectDetail!,
          milestones: [
            {
              ...milestone,
              status: "blocked",
              metadata: {
                ...milestone.metadata,
                blockers: ["Missing required local tool."],
              },
            },
          ],
        },
      }),
    );

    expect(container.querySelector("[data-pcc-execution-readiness]")?.textContent).toContain(
      "Readiness",
    );
    expect(container.querySelector("[data-pcc-execution-readiness]")?.textContent).toContain(
      "active blocker",
    );
    expect(container.querySelector("[data-pcc-execution-readiness]")?.textContent).not.toContain(
      "No active blockers",
    );
    expect(container.querySelector("[data-pcc-universal-preflight]")?.textContent).toContain(
      "Preflight",
    );
    expect(container.querySelector("[data-pcc-scope-lock]")?.textContent).toContain("Focus lock");
    expect(container.querySelector("[data-pcc-recovery-center]")?.textContent).toContain(
      "Refresh safely",
    );
    expect(container.querySelector("[data-pcc-action-error]")?.textContent).toContain(
      "nothing was saved",
    );
  });

  it("renders the PCC interaction contract matrix in detailed diagnostics", () => {
    const container = renderView(createProps({ viewMode: "detailed" }));

    const matrix = container.querySelector("[data-pcc-interaction-contract-matrix]");
    expect(matrix?.textContent).toContain("Buttons and controls PCC must keep working");
    expect(matrix?.textContent).toContain("Work This Project");
    expect(matrix?.querySelectorAll("[data-pcc-interaction-contract]").length).toBeGreaterThan(20);
  });

  it("keeps reorder mode explicit and hides action menus while handles are active", () => {
    const container = renderView(createProps({ viewMode: "simple", reorderMode: true }));

    expect(container.querySelector("[data-pcc-reorder-instruction]")?.textContent).toContain(
      "Reorder mode is on",
    );
    expect(container.querySelector("[data-pcc-reorder-instruction]")?.textContent).toContain(
      "Dependency checks on",
    );
    expect(container.querySelector("[data-pcc-reorder-instruction]")?.textContent).toContain(
      "offers Undo",
    );
    expect(container.querySelector("[data-pcc-drag-handle='milestone']")).not.toBeNull();
    const dropTarget = container.querySelector<HTMLElement>("[data-pcc-journey-step]");
    dropTarget?.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
    expect(dropTarget?.classList.contains("is-drop-target")).toBe(true);
    dropTarget?.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(dropTarget?.classList.contains("is-drop-target")).toBe(false);
    expect(container.querySelector("[data-pcc-milestone-reorder]")?.textContent).toContain("Up");
    expect(container.querySelector("[data-pcc-milestone-reorder]")?.textContent).toContain("Down");
    expect(container.querySelector("[data-pcc-action-menu-trigger]")).toBeNull();
  });

  it("shows Autopilot trust details for run history", () => {
    const autopilotProject = {
      ...project,
      metadata: {
        ...project.metadata,
        pccAutopilot: {
          status: "ready",
          mode: "bug_hunt",
          currentExecutor: "safe_stub",
          promptSlots: [],
          runHistory: [
            {
              id: "run-1",
              timestamp: "2026-07-08T12:00:00Z",
              projectId: project.id,
              loopMode: "bug_hunt",
              promptSlotId: "slot-1",
              promptTitle: "Find broken controls",
              promptVersion: 1,
              executor: "safe_stub",
              inputContextSummary: "Project, milestones, blockers, and controls.",
              outputSummary: "No unsafe action was executed.",
              changedFiles: ["ui/src/ui/views/pcc.ts"],
              artifacts: ["smoke"],
              approvals: [],
              checksRun: ["view test"],
              judgeResult: { status: "passed", summary: "Traceable.", evidence: [] },
              rawOutput: "Safe stub output.",
            },
          ],
        },
      },
    };
    const container = renderView(
      createProps({
        viewMode: "detailed",
        projectDetail: {
          project: autopilotProject,
          milestones: [milestone],
          subMilestones: [subMilestone],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        },
      }),
    );

    const historyText = (container.querySelector("[data-pcc-autopilot-history]")?.textContent ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    expect(historyText).toContain("Context: Project, milestones, blockers, and controls.");
    expect(historyText).toContain("Changes: 1 file");
    expect(historyText).toContain("Approvals: none used");
  });
});

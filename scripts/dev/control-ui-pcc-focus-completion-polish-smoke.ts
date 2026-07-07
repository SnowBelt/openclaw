import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC focus completion polish smoke missing selector: ${selector}`);
  }
  return found;
}

function assertBefore(first: Element, second: Element, message: string): void {
  if ((first.compareDocumentPosition(second) & first.DOCUMENT_POSITION_FOLLOWING) === 0) {
    throw new Error(message);
  }
}

function assertNoTitleAttributes(root: ParentNode): void {
  for (const item of root.querySelectorAll("[data-pcc-view-mode-option]")) {
    if (item.hasAttribute("title")) {
      throw new Error("view mode options should use aria-label instead of native title tooltips");
    }
    if (!item.getAttribute("aria-label")) {
      throw new Error("view mode option is missing aria-label");
    }
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-focus-completion-polish-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });
  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, { url: "http://127.0.0.1/pcc" });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;

  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }
    const now = "2026-07-07T12:00:00Z";
    const pccProject = {
      id: "project-command-center",
      title: "Project Command Center",
      goal: "Keep PCC focused and production-current.",
      status: "complete_with_maintenance" as const,
      priority: 5,
      metadata: {
        pccIntake: { approved: true },
        pccSetupScore: { score: 100, runnable: true },
        pccAutopilot: { status: "ready", mode: "bug_hunt", modeTitle: "Bug Hunt" },
      },
      createdAt: now,
      updatedAt: now,
    };
    const pccSummary = {
      id: pccProject.id,
      title: pccProject.title,
      status: pccProject.status,
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
      health: "Complete",
      updatedAt: now,
    };
    const activeSummary = {
      id: "active-proof-project",
      title: "Active Proof Project",
      status: "active" as const,
      percentComplete: 10,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Run first safe step"],
      proofGaps: [],
      health: "On track",
      updatedAt: now,
    };
    const calls: string[] = [];
    const projectForm = {
      id: null,
      title: "",
      goal: "",
      projectDescription: "",
      status: "active",
      priority: "",
      dueDate: "",
      outcomeMetrics: "",
      workflowTemplateId: "software-product",
      planningMode: "template_only",
      plannerMode: "best_available",
      plannerModelId: "best-available",
      plannerPermissionScope: "ask",
      plannerPermissionBudget: "",
      planPreviewAccepted: false,
      codexPlanningAllowed: false,
      remoteProofAllowed: false,
      runtimeActionsAllowed: false,
      intakeAnswers: {},
      intakeApproved: false,
    };
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        updatedAt: Date.parse(now),
        portfolio: {
          projectsTotal: 2,
          active: 1,
          blocked: 0,
          needsApproval: 0,
          complete: 1,
          archived: 0,
          averagePercentComplete: 55,
          nextActions: [],
        },
        projects: [pccSummary, activeSummary],
        selectedProjectId: pccProject.id,
        projectFilter: "active",
        projectSearchQuery: "proof",
        projectDetail: {
          project: pccProject,
          milestones: [],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary: pccSummary,
        },
        actionBusy: false,
        actionError: null,
        editorMode: null,
        projectForm,
        milestoneForm: {
          id: null,
          projectId: pccProject.id,
          title: "",
          status: "not_started",
          phaseId: "",
          order: "",
          percentComplete: "",
          blocker: "",
          implementationPlan: "",
          acceptanceCriteria: "",
          responsibility: "local_openclaw_agent",
          costRisk: "low",
          stopHere: false,
        },
        decisionFormOpen: false,
        decisionForm: {
          title: "",
          summary: "",
          rationale: "",
          impact: "",
          milestoneId: "",
          subMilestoneId: "",
          evidenceIds: "",
          decidedBy: "",
        },
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        viewMode: "simple",
        productFocusMode: "pcc_product",
        onSetProjectFilter: (filter: string) => calls.push(`filter:${filter}`),
        onSelectProject: (id: string) => calls.push(`select:${id}`),
        onSetProjectSearchQuery: (query: string) => calls.push(`search:${query}`),
        onSetViewMode: (mode: string) => calls.push(`mode:${mode}`),
        onRefresh: () => calls.push("refresh"),
        onOpenProjectEditor: () => calls.push("edit"),
        onOpenMilestoneEditor: () => calls.push("milestone"),
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
        onConfigureAutopilotMode: () => undefined,
        onGenerateAutopilotPrompts: () => undefined,
        onUpdateAutopilotPrompt: () => undefined,
        onRunAutopilotAction: () => undefined,
      }),
      root,
    );

    const today = requireSelector(root, "[data-pcc-today]");
    const selectedNotice = requireSelector(root, "[data-pcc-selected-filtered-project]");
    const layout = requireSelector(root, ".pcc-layout");
    const projects = requireSelector(root, ".pcc-projects");
    const workspace = requireSelector(root, "[data-pcc-selected-project-workspace]");
    assertBefore(today, selectedNotice, "Today should stay above selected-project filter notice");
    assertBefore(
      selectedNotice,
      layout,
      "selected-project filter notice should not be buried in project cards",
    );
    assertBefore(
      projects,
      workspace,
      "project list should stay before selected workspace in DOM order",
    );
    requireSelector(root, "[data-pcc-project-search-scope]");
    requireSelector(root, "[data-pcc-search-all]");
    requireSelector(root, "[data-pcc-show-selected-in-all]");
    requireSelector(root, "[data-pcc-open-selected-project]");
    requireSelector(root, "[data-pcc-autopilot-hero-chip]");
    const portfolioConsole = requireSelector(root, "[data-pcc-portfolio-console]");
    if (portfolioConsole.getAttribute("data-pcc-portfolio-console-ready") !== "false") {
      throw new Error("portfolio work console should be marked not ready for no-ready proof data");
    }
    const consoleDetails = portfolioConsole.querySelector("details");
    if (!(consoleDetails instanceof dom.window.HTMLDetailsElement) || consoleDetails.open) {
      throw new Error("no-ready portfolio work console should be collapsed");
    }
    assertNoTitleAttributes(root);
    root.querySelector<HTMLButtonElement>("[data-pcc-search-all]")?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-show-selected-in-all]")?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-open-selected-project]")?.click();
    if (!calls.includes("filter:all") || !calls.includes(`select:${pccProject.id}`)) {
      throw new Error("filter recovery actions did not fire");
    }
    writeFileSync(join(artifactDir, "dom.txt"), root.textContent ?? "");
    console.log("PCC_FOCUS_COMPLETION_POLISH_SMOKE_OK", artifactDir);
  } finally {
    if (previous.window === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previous.window;
    }
    if (previous.document === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = previous.document;
    }
    if (previous.HTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    } else {
      (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    }
    if (previous.Node === undefined) {
      delete (globalThis as { Node?: unknown }).Node;
    } else {
      (globalThis as { Node?: unknown }).Node = previous.Node;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

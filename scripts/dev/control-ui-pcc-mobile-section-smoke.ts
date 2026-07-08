import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC mobile section smoke missing selector: ${selector}`);
  }
  return found;
}

function assertOrder(root: ParentNode, firstSelector: string, secondSelector: string): void {
  const first = requireSelector(root, firstSelector);
  const second = requireSelector(root, secondSelector);
  if ((first.compareDocumentPosition(second) & first.DOCUMENT_POSITION_FOLLOWING) === 0) {
    throw new Error(`${firstSelector} should render before ${secondSelector}`);
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-mobile-section-smoke", stamp());
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
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 844 });

  try {
    const { render } = await import("lit");
    const { TAB_GROUPS, tabFromPath } = await import("../../ui/src/ui/navigation.ts");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const chat = TAB_GROUPS.find((group) => group.label === "chat");
    const pcc = TAB_GROUPS.find((group) => group.label === "pcc");
    if (JSON.stringify(chat?.tabs) !== JSON.stringify(["chat"])) {
      throw new Error(`Chat group should only contain chat: ${JSON.stringify(chat?.tabs)}`);
    }
    if (JSON.stringify(pcc?.tabs) !== JSON.stringify(["pcc"])) {
      throw new Error(`PCC group should be separate: ${JSON.stringify(pcc?.tabs)}`);
    }
    if (tabFromPath("/pcc") !== "pcc" || tabFromPath("/projects") !== "pcc") {
      throw new Error("/pcc and /projects must route to PCC");
    }

    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }
    const now = "2026-07-08T12:00:00Z";
    const project = {
      id: "project-command-center",
      title: "Project Command Center",
      goal: "Keep PCC focused, skimmable, and production-current on mobile.",
      status: "active" as const,
      priority: 5,
      metadata: { pccIntake: { approved: true }, pccSetupScore: { score: 100, runnable: true } },
      createdAt: now,
      updatedAt: now,
    };
    const milestone = {
      id: "mobile-pcc-step-1",
      projectId: project.id,
      title: "Mobile PCC section",
      status: "active" as const,
      phaseId: "mobile",
      order: 10,
      percentComplete: 20,
      owner: "OpenClaw",
      implementationPlan: "Make PCC a separate mobile dashboard section.",
      acceptanceCriteria: ["PCC mobile sections are visible and skimmable."],
      metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local_ui_smoke" },
      createdAt: now,
      updatedAt: now,
    };
    const summary = {
      id: project.id,
      title: project.title,
      status: project.status,
      percentComplete: 20,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Open the mobile PCC section and review the current project."],
      proofGaps: [],
      health: "On track",
      dueDate: null,
      recentActivity: "Mobile PCC section planned.",
      updatedAt: now,
    };
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        updatedAt: Date.parse(now),
        portfolio: {
          projectsTotal: 1,
          active: 1,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 20,
          nextActions: [],
        },
        projects: [summary],
        selectedProjectId: project.id,
        projectDetail: {
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
        projectDetails: {},
        actionBusy: false,
        actionError: null,
        actionNotice: null,
        editorMode: null,
        projectForm: {
          projectDescription: "",
          title: "",
          goal: "",
          dueDate: "",
          priority: 3,
          owner: "",
          constraints: "",
          preferredWorkflow: "",
          plannerMode: "best_available",
          plannerModelId: "",
          plannerPermissionStatus: "not_requested",
          intakeAnswers: {},
          generatedPlanPreview: null,
          approveIntake: false,
        },
        milestoneForm: {
          projectId: project.id,
          title: "",
          phaseId: "",
          status: "not_started",
          owner: "",
          implementationPlan: "",
          acceptanceCriteria: "",
          blocker: "",
          requiredEvidenceIds: "",
          metadata: "",
        },
        decisionFormOpen: false,
        decisionForm: {
          title: "",
          summary: "",
          status: "proposed",
          options: "",
          selectedOption: "",
          rationale: "",
          evidenceIds: "",
          metadata: "",
        },
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        viewMode: "simple",
        productFocusMode: "pcc_product",
        onSetViewMode: () => undefined,
        onRefresh: () => undefined,
        onSelectProject: () => undefined,
        onSetProjectFilter: () => undefined,
        onSetProjectSearchQuery: () => undefined,
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
        onPreviewSetupAutofill: () => undefined,
        onApplySetupAutofill: () => undefined,
        onCancelSetupAutofill: () => undefined,
        onRegenerateSetupAutofill: () => undefined,
        onOpenDecisionForm: () => undefined,
        onDecisionFormChange: () => undefined,
        onSaveDecision: () => undefined,
        onCancelDecisionForm: () => undefined,
        onUpdateWorkLoop: () => undefined,
        onPrepareNextWorkItem: () => undefined,
        onResumeProject: () => undefined,
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

    requireSelector(root, "[data-pcc-shell]");
    requireSelector(root, "[data-pcc-today-compact-bar]");
    requireSelector(root, "[data-pcc-mobile-command-rail]");
    requireSelector(root, "[data-pcc-mobile-primary-action]");
    requireSelector(root, "[data-pcc-mobile-section-tabs]");
    for (const id of ["projects", "current", "milestones", "autopilot", "more"]) {
      requireSelector(root, `[data-pcc-mobile-section-tab="${id}"]`);
      requireSelector(root, `[data-pcc-mobile-section="${id}"]`);
    }
    assertOrder(root, "[data-pcc-today]", "[data-pcc-mobile-command-rail]");
    assertOrder(root, "[data-pcc-mobile-command-rail]", "[data-pcc-mobile-section=projects]");
    const visibleText = root.textContent ?? "";
    for (const expected of [
      "Project Command Center",
      "PCC Product",
      "My Projects",
      "Next",
      "Projects",
      "Status",
      "Steps",
      "AI Loop",
      "Details",
      "Mobile PCC section",
    ]) {
      if (!visibleText.includes(expected)) {
        throw new Error(`missing mobile PCC text: ${expected}`);
      }
    }
    writeFileSync(join(artifactDir, "dom.txt"), visibleText);
    console.log("PCC_MOBILE_SECTION_SMOKE_OK", artifactDir);
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

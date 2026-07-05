import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC compact Today smoke missing selector: ${selector}`);
  }
  return found;
}

function assertOrder(root: ParentNode, firstSelector: string, secondSelector: string): void {
  const first = requireSelector(root, firstSelector);
  const second = requireSelector(root, secondSelector);
  const position = first.compareDocumentPosition(second);
  if ((position & first.DOCUMENT_POSITION_FOLLOWING) === 0) {
    throw new Error(`${firstSelector} should render before ${secondSelector}`);
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-compact-today-smoke", stamp());
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
    const now = "2026-07-05T12:00:00Z";
    const pccProject = {
      id: "pcc",
      title: "Project Command Center",
      goal: "Keep PCC focused.",
      status: "complete_with_maintenance" as const,
      priority: 5,
      metadata: { pccIntake: { approved: true }, pccSetupScore: { score: 100, runnable: true } },
      createdAt: now,
      updatedAt: now,
    };
    const snesSummary = {
      id: "snes",
      title: "SNES Game Creator",
      status: "active" as const,
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
      proofGaps: [],
      health: "At risk",
      dueDate: null,
      recentActivity: "Project-specific work removed from current working scope by user.",
      updatedAt: now,
    };
    const pccSummary = {
      id: "pcc",
      title: "Project Command Center",
      status: "complete_with_maintenance" as const,
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
      dueDate: null,
      recentActivity: "Receipt added",
      updatedAt: now,
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
          averagePercentComplete: 62,
          nextActions: [],
        },
        projects: [snesSummary, pccSummary],
        selectedProjectId: "pcc",
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
        projectDetails: {},
        actionBusy: false,
        actionError: null,
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
          projectId: "pcc",
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
      }),
      root,
    );
    requireSelector(root, "[data-pcc-today-compact-bar]");
    const overview = requireSelector(root, "[data-pcc-today-overview]") as HTMLDetailsElement;
    if (overview.open) {
      throw new Error("Today overview should be collapsed by default");
    }
    assertOrder(root, "[data-pcc-today]", "[data-pcc-project-tabs]");
    assertOrder(root, "[data-pcc-project-tabs]", "[data-pcc-detail]");
    const workingNow = root.querySelector('[data-pcc-today-card="Working Now"]')?.textContent ?? "";
    if (workingNow.includes("SNES Game Creator")) {
      throw new Error("blocked/deferred SNES project should not appear as Working Now");
    }
    const compact = root.querySelector("[data-pcc-today-compact-bar]")?.textContent ?? "";
    if (
      /Project-specific SNES Game Creator work removed from current working scope/u.test(compact)
    ) {
      throw new Error("compact Today bar should not show long blocker paragraphs");
    }
    writeFileSync(join(artifactDir, "dom.txt"), root.textContent ?? "");
    console.log("PCC_COMPACT_TODAY_SMOKE_OK", artifactDir);
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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC Apple-simple UX smoke missing selector: ${selector}`);
  }
  return found;
}

function requireText(text: string, label: string): void {
  if (!text.includes(label)) {
    throw new Error(`PCC Apple-simple UX smoke missing text: ${label}`);
  }
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
  const artifactDir = join(".artifacts", "control-ui-pcc-apple-simple-ux-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });

  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, {
    url: "http://127.0.0.1/pcc",
  });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
    DragEvent: (globalThis as { DragEvent?: unknown }).DragEvent,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  (globalThis as { DragEvent?: unknown }).DragEvent = dom.window.Event;

  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");

    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }

    const now = "2026-07-04T12:00:00Z";
    const project = {
      id: "apple-simple-pcc",
      title: "Apple-Simple PCC",
      goal: "Make PCC obvious enough to use without instructions.",
      status: "on_hold" as const,
      priority: 5,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: { approved: true, answers: { goal: "Make PCC simple." } },
        pccQualityGate: { status: "passing" },
        pccSetupScore: { score: 100, runnable: true },
        pccCompliance: { badge: "Passing", status: "passing" },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = [
      {
        id: "hero",
        projectId: project.id,
        title: "Selected project hero",
        status: "on_hold" as const,
        phaseId: "focus",
        order: 10,
        percentComplete: 35,
        blocker: "Project is on hold. Resume it before starting supervised work.",
        implementationPlan: "Put status, blocker, and primary action in the first viewport.",
        acceptanceCriteria: ["Resume Project is visible without scrolling"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "journey",
        projectId: project.id,
        title: "Milestone journey",
        status: "not_started" as const,
        phaseId: "focus",
        order: 20,
        percentComplete: 0,
        implementationPlan: "Make milestone sequence central and easy to reorder.",
        acceptanceCriteria: ["Drag handles and keyboard reorder are visible"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const subMilestones = [
      {
        id: "hero-sub",
        projectId: project.id,
        milestoneId: "hero",
        title: "Show Resume Project",
        status: "not_started" as const,
        order: 10,
        percentComplete: 0,
        implementationPlan: "Expose the resume action in the selected project hero.",
        acceptanceCriteria: ["Resume Project button is visible"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "journey-sub",
        projectId: project.id,
        milestoneId: "hero",
        title: "Show blocker list",
        status: "not_started" as const,
        order: 20,
        percentComplete: 0,
        implementationPlan: "Explain the first blocker in plain language.",
        acceptanceCriteria: ["Blocker center is visible"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const summary = {
      ...project,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 1,
        needsApproval: 0,
        inProgress: 0,
      },
      nextActions: ["Resume Project"],
      proofGaps: [],
      recentActivity: "Milestone updated: Selected project hero",
      health: "On Hold",
      percentComplete: 18,
    };
    const detail = {
      project: { ...project, phases: [{ id: "focus", title: "Focus", order: 10, weight: 100 }] },
      milestones,
      subMilestones,
      permissions: [],
      evidence: [],
      receipts: [],
      decisions: [],
      lastKnownGood: [],
      summary,
    };
    const calls: string[] = [];

    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        projects: [summary],
        portfolio: {
          projectsTotal: 1,
          active: 0,
          blocked: 1,
          needsApproval: 0,
          archived: 0,
          averagePercentComplete: 18,
          needsAttention: 1,
        },
        updatedAt: Date.parse(now),
        selectedProjectId: project.id,
        projectDetail: detail,
        projectDetails: { [project.id]: detail },
        actionBusy: false,
        actionError: null,
        actionNotice: null,
        projectFilter: "on_hold",
        projectSearchQuery: "",
        projectEditMode: "simple",
        editorMode: "none",
        projectForm: {} as never,
        milestoneForm: {} as never,
        decisionForm: {} as never,
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        viewMode: "simple",
        productFocusMode: "project_work",
        reorderMode: true,
        modelCatalog: [],
        modelsLoading: false,
        modelsLastRefreshedAt: Date.parse(now),
        modelsFallback: false,
        onRefresh: () => calls.push("refresh"),
        onSelectProject: () => calls.push("select"),
        onOpenProjectEditor: () => calls.push("edit-project"),
        onOpenMilestoneEditor: () => calls.push("edit-milestone"),
        onProjectFormChange: () => calls.push("project-form"),
        onMilestoneFormChange: () => calls.push("milestone-form"),
        onSaveProject: () => calls.push("save-project"),
        onSaveMilestone: () => calls.push("save-milestone"),
        onCancelEditor: () => calls.push("cancel"),
        onSetProjectStatus: () => calls.push("set-project-status"),
        onSetMilestoneStatus: () => calls.push("set-milestone-status"),
        onSetMilestoneStopHere: () => calls.push("stop-here"),
        onMoveMilestoneBefore: () => calls.push("move-milestone"),
        onMoveSubMilestoneBefore: () => calls.push("move-submilestone"),
        onAddCompletionReceipt: () => calls.push("receipt"),
        onSetPermissionStatus: () => calls.push("permission"),
        onUpdateWorkLoop: () => calls.push("work-loop"),
        onPrepareNextWorkItem: () => calls.push("prepare"),
        onResumeProject: () => calls.push("resume"),
        onPreviewSetupAutofill: () => calls.push("setup-autofill"),
        onChatSyncTextChange: () => calls.push("chat-text"),
        onPreviewChatSync: () => calls.push("chat-preview"),
        onApplyChatSyncProposal: () => calls.push("chat-apply"),
        onDismissChatSync: () => calls.push("chat-dismiss"),
      }),
      root,
    );

    const text = root.textContent ?? "";
    requireText(text, "Today");
    requireText(text, "Project Snapshot");
    requireText(text, "What needs attention");
    requireText(text, "Milestone Journey");
    requireText(text, "Resume Project");
    requireSelector(root, "[data-pcc-top-metrics]");
    requireSelector(root, "[data-pcc-project-tabs]");
    requireSelector(root, "[data-pcc-project-card]");
    requireSelector(root, "[data-pcc-primary-action]");
    requireSelector(root, "[data-pcc-blocker-center]");
    requireSelector(root, "[data-pcc-milestone-journey]");
    requireSelector(root, "[data-pcc-project-activity]");
    assertOrder(root, "[data-pcc-project-snapshot]", "[data-pcc-milestone-journey]");
    assertOrder(root, "[data-pcc-milestone-journey]", "[data-pcc-project-activity]");

    const resumeButton = requireSelector(root, "[data-pcc-primary-action] button") as HTMLElement;
    resumeButton.click();
    if (!calls.includes("resume")) {
      throw new Error("primary Resume Project action did not call resume handler");
    }

    const milestoneHandle = requireSelector(root, '[data-pcc-drag-handle="milestone"]');
    milestoneHandle.dispatchEvent(new dom.window.Event("dragstart", { bubbles: true }));
    requireSelector(root, '[data-pcc-milestone-id="journey"]').dispatchEvent(
      new dom.window.Event("drop", { bubbles: true }),
    );
    if (!calls.includes("move-milestone")) {
      throw new Error("milestone drag/drop did not call reorder handler");
    }

    const subHandle = requireSelector(root, '[data-pcc-drag-handle="submilestone"]');
    subHandle.dispatchEvent(new dom.window.Event("dragstart", { bubbles: true }));
    requireSelector(root, '[data-pcc-submilestone-id="journey-sub"]').dispatchEvent(
      new dom.window.Event("drop", { bubbles: true }),
    );
    if (!calls.includes("move-submilestone")) {
      throw new Error("sub-milestone drag/drop did not call reorder handler");
    }

    writeFileSync(join(artifactDir, "dom.txt"), text);
    console.log("PCC_APPLE_SIMPLE_UX_SMOKE_OK", artifactDir);
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
    if (previous.DragEvent === undefined) {
      delete (globalThis as { DragEvent?: unknown }).DragEvent;
    } else {
      (globalThis as { DragEvent?: unknown }).DragEvent = previous.DragEvent;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

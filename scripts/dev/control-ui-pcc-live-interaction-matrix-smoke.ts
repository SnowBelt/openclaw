import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function makeDragEvent(window: Window, type: string, encoded: string): DragEvent {
  const store = new Map<string, string>();
  store.set("application/x-openclaw-pcc-reorder", encoded);
  store.set("text/plain", encoded.split(":").at(1) ?? encoded);
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: {
      effectAllowed: "move",
      setData: (key: string, value: string) => store.set(key, value),
      getData: (key: string) => store.get(key) ?? "",
    },
  });
  return event;
}

async function main() {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-live-interaction-matrix-smoke",
    timestampSlug(),
  );
  mkdirSync(artifactDir, { recursive: true });
  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, { url: "http://127.0.0.1/pcc" });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
    MouseEvent: (globalThis as { MouseEvent?: unknown }).MouseEvent,
    DragEvent: (globalThis as { DragEvent?: unknown }).DragEvent,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  (globalThis as { MouseEvent?: unknown }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { DragEvent?: unknown }).DragEvent = dom.window.DragEvent;
  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing root");
    }
    const now = "2026-07-05T00:00:00Z";
    const calls: string[] = [];
    const project = {
      id: "pcc-disposable-live-interaction-proof",
      title: "Disposable Live Interaction Proof",
      goal: "Prove PCC interactions without mutating user projects.",
      status: "active" as const,
      priority: 3,
      metadata: { pccSetupScore: { score: 100, runnable: true } },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = [
      {
        id: "live-step-1",
        projectId: project.id,
        title: "First disposable step",
        status: "not_started" as const,
        order: 1,
        percentComplete: 0,
        implementationPlan: "Prove action menu and drop target.",
        acceptanceCriteria: ["Action callback recorded"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "live-step-2",
        projectId: project.id,
        title: "Second disposable step",
        status: "not_started" as const,
        order: 2,
        percentComplete: 0,
        implementationPlan: "Move before the first step.",
        acceptanceCriteria: ["Move callback recorded"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const subMilestones = [
      {
        id: "live-sub-1",
        projectId: project.id,
        milestoneId: "live-step-1",
        title: "First disposable sub-step",
        status: "not_started" as const,
        order: 1,
        percentComplete: 0,
        implementationPlan: "Receive sub-step drop.",
        acceptanceCriteria: ["Sub-step callback recorded"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "live-sub-2",
        projectId: project.id,
        milestoneId: "live-step-1",
        title: "Second disposable sub-step",
        status: "not_started" as const,
        order: 2,
        percentComplete: 0,
        implementationPlan: "Move before first sub-step.",
        acceptanceCriteria: ["Sub-step move callback recorded"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const summary = {
      id: project.id,
      title: project.title,
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
      nextActions: ["First disposable step"],
      proofGaps: [],
      updatedAt: now,
    };
    const renderMatrix = (reorderMode: boolean): void => {
      render(
        renderPccDashboard({
          loading: false,
          error: null,
          updatedAt: Date.now(),
          portfolio: {
            projectsTotal: 1,
            active: 1,
            blocked: 0,
            needsApproval: 0,
            complete: 0,
            archived: 0,
            averagePercentComplete: 0,
            nextActions: ["First disposable step"],
          },
          projects: [summary],
          selectedProjectId: project.id,
          projectDetail: {
            project,
            milestones,
            subMilestones,
            permissions: [],
            evidence: [],
            receipts: [],
            summary,
          },
          projectDetails: {
            [project.id]: {
              project,
              milestones,
              subMilestones,
              permissions: [],
              evidence: [],
              receipts: [],
              summary,
            },
          },
          actionBusy: false,
          actionError: null,
          editorMode: null,
          projectForm: { id: null, title: "", goal: "", status: "active", priority: "3" },
          milestoneForm: {
            id: null,
            projectId: project.id,
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
          decisionForm: {
            id: null,
            projectId: project.id,
            title: "",
            summary: "",
            status: "open",
            impact: "medium",
            linkedEvidenceIds: "",
            decidedAt: "",
            decidedBy: "",
          },
          chatSyncText: "",
          chatSyncProposals: [],
          chatSyncError: null,
          viewMode: "agent",
          reorderMode,
          onSetViewMode: (mode) => calls.push(`view:${mode}`),
          onSetProductFocusMode: (mode) => calls.push(`focus:${mode}`),
          onSetReorderMode: (enabled) => calls.push(`reorder-mode:${enabled}`),
          onRefresh: () => calls.push("refresh"),
          onSelectProject: (id) => calls.push(`select:${id}`),
          onOpenProjectEditor: () => calls.push("edit-project"),
          onOpenMilestoneEditor: (milestone) =>
            calls.push(`edit-milestone:${milestone?.id ?? "new"}`),
          onProjectFormChange: () => calls.push("project-change"),
          onMilestoneFormChange: () => calls.push("milestone-change"),
          onSaveProject: () => calls.push("save-project"),
          onSaveMilestone: () => calls.push("save-milestone"),
          onCancelEditor: () => calls.push("cancel"),
          onSetProjectStatus: (_project, status) => calls.push(`project-status:${status}`),
          onSetMilestoneStatus: (milestone, status) =>
            calls.push(`milestone-status:${milestone.id}:${status}`),
          onSetMilestoneStopHere: (milestone, stopHere) =>
            calls.push(`stop-here:${milestone.id}:${stopHere}`),
          onMoveMilestoneBefore: (source, target) =>
            calls.push(`move-milestone:${source.id}->${target.id}`),
          onMoveSubMilestoneBefore: (source, target) =>
            calls.push(`move-sub:${source.id}->${target.id}`),
          onSetSubMilestoneStatus: (sub, status) => calls.push(`sub-status:${sub.id}:${status}`),
          onAddCompletionReceipt: () => calls.push("add-receipt"),
          onSetPermissionStatus: (_permission, status) => calls.push(`permission-status:${status}`),
          onUpdateWorkLoop: () => calls.push("work-loop-update"),
          onPrepareNextWorkItem: () => calls.push("work-loop-next"),
          onChatSyncTextChange: () => undefined,
          onPreviewChatSync: () => undefined,
          onApplyChatSyncProposal: () => undefined,
          onDismissChatSync: () => undefined,
        }),
        root,
      );
    };
    renderMatrix(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    root.querySelector<HTMLButtonElement>('[data-pcc-focus-mode-option="project_work"]')?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]")?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]")?.click();
    root
      .querySelector<HTMLElement>(
        '[data-pcc-milestone-id="live-step-2"] [data-pcc-drag-handle="milestone"]',
      )
      ?.dispatchEvent(makeDragEvent(dom.window, "dragstart", "milestone:live-step-2"));
    root
      .querySelector<HTMLElement>('[data-pcc-milestone-id="live-step-1"]')
      ?.dispatchEvent(makeDragEvent(dom.window, "drop", "milestone:live-step-2"));
    root
      .querySelector<HTMLElement>(
        '[data-pcc-submilestone-id="live-sub-2"] [data-pcc-drag-handle="submilestone"]',
      )
      ?.dispatchEvent(makeDragEvent(dom.window, "dragstart", "submilestone:live-sub-2"));
    root
      .querySelector<HTMLElement>('[data-pcc-submilestone-id="live-sub-1"]')
      ?.dispatchEvent(makeDragEvent(dom.window, "drop", "submilestone:live-sub-2"));
    root
      .querySelector<HTMLButtonElement>(
        '[data-pcc-milestone-id="live-step-2"] [data-pcc-reorder="milestone-up"]',
      )
      ?.click();
    renderMatrix(false);
    const menu = root.querySelector<HTMLElement>(
      '[data-pcc-milestone-id="live-step-1"] [data-pcc-action-menu]',
    );
    menu?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.click();
    [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Defer"))
      ?.click();
    [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Defer"))
      ?.click();

    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      focusMode: calls.includes("focus:project_work"),
      reorderMode: calls.includes("reorder-mode:false"),
      dragMilestone: calls.includes("move-milestone:live-step-2->live-step-1"),
      dragSubMilestone: calls.includes("move-sub:live-sub-2->live-sub-1"),
      keyboardMove: calls.includes("move-milestone:live-step-2->live-step-1"),
      actionMenu: calls.includes("milestone-status:live-step-1:deferred"),
      disposableOnly: !calls.some((call) => call.toLowerCase().includes("snes")),
    };
    const summaryOut = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-live-interaction-matrix.html"),
    };
    writeFileSync(summaryOut.html, dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summaryOut, null, 2));
    console.log(JSON.stringify(summaryOut, null, 2));
    if (!summaryOut.ok) {
      process.exit(1);
    }
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
    (globalThis as { MouseEvent?: unknown }).MouseEvent = previous.MouseEvent;
    (globalThis as { DragEvent?: unknown }).DragEvent = previous.DragEvent;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

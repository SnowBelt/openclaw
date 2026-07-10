import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-interaction-reliability-smoke",
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
      id: "pcc-disposable-interaction-project",
      title: "Disposable Interaction Proof",
      goal: "Prove PCC buttons, menus, and reorder controls without touching user projects.",
      status: "active" as const,
      priority: 3,
      metadata: {
        pccSetupScore: { score: 100, runnable: true },
        pccWorkLoop: {
          enabled: false,
          state: "idle",
          stopBeforeCodex: true,
          stopBeforeRemoteProof: true,
        },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = [
      {
        id: "proof-step-1",
        projectId: project.id,
        title: "First reliable step",
        status: "not_started" as const,
        order: 1,
        percentComplete: 0,
        implementationPlan: "Click action menu and reorder safely.",
        acceptanceCriteria: ["Menu action records a callback", "Reorder callback is called"],
        metadata: { pccResponsibility: "local_openclaw_agent", proofRequired: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "proof-step-2",
        projectId: project.id,
        title: "Second reliable step",
        status: "not_started" as const,
        order: 2,
        percentComplete: 0,
        implementationPlan: "Receive dragged or keyboard reorder target.",
        acceptanceCriteria: ["Reorder target remains non-negative"],
        metadata: { pccResponsibility: "local_openclaw_agent", proofRequired: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const subMilestones = [
      {
        id: "proof-sub-1",
        projectId: project.id,
        milestoneId: "proof-step-1",
        title: "First sub-step",
        status: "not_started" as const,
        order: 1,
        percentComplete: 0,
        implementationPlan: "Use sub-step action controls.",
        acceptanceCriteria: ["Sub-menu opens"],
        metadata: { pccResponsibility: "local_openclaw_agent", proofRequired: "local_smoke" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "proof-sub-2",
        projectId: project.id,
        milestoneId: "proof-step-1",
        title: "Second sub-step",
        status: "not_started" as const,
        order: 2,
        percentComplete: 0,
        implementationPlan: "Move above first sub-step.",
        acceptanceCriteria: ["Sub reorder callback is called"],
        metadata: { pccResponsibility: "local_openclaw_agent", proofRequired: "local_smoke" },
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
      nextActions: ["First reliable step"],
      proofGaps: [],
      updatedAt: now,
    };
    const viewProps = {
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
        nextActions: ["First reliable step"],
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
      projectForm: {
        id: null,
        title: "",
        goal: "",
        status: "active",
        priority: "3",
        workflowTemplateId: "software-product",
        planningMode: "template_only",
        codexPlanningAllowed: false,
        remoteProofAllowed: false,
        runtimeActionsAllowed: false,
      },
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
      },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "agent",
      reorderMode: true,
      onSetViewMode: (mode) => calls.push(`view:${mode}`),
      onRefresh: () => calls.push("refresh"),
      onSelectProject: (id) => calls.push(`select:${id}`),
      onOpenProjectEditor: () => calls.push("edit-project"),
      onOpenMilestoneEditor: (milestone) => calls.push(`edit-milestone:${milestone?.id ?? "new"}`),
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
    };
    render(renderPccDashboard(viewProps), root);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    root
      .querySelector<HTMLButtonElement>(
        '[data-pcc-milestone-id="proof-step-2"] [data-pcc-reorder="milestone-up"]',
      )
      ?.click();
    root
      .querySelector<HTMLButtonElement>(
        '[data-pcc-submilestone-id="proof-sub-2"] [data-pcc-reorder="submilestone-up"]',
      )
      ?.click();
    const reorderToggle = root.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]");
    if (!reorderToggle || !reorderToggle.textContent?.includes("Done reordering")) {
      throw new Error("reorder mode did not activate");
    }
    // Action menus are intentionally paused during reorder mode. Exit that mode before proving
    // a mutation menu; this keeps the smoke aligned with the user-facing safety contract.
    viewProps.reorderMode = false;
    render(renderPccDashboard(viewProps), root);
    const menu = root.querySelector<HTMLElement>(
      '[data-pcc-milestone-id="proof-step-1"] [data-pcc-action-menu]',
    );
    menu?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.click();
    const defer = [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) =>
      button.textContent?.includes("Defer"),
    );
    defer?.click();

    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      compactToday: root.querySelectorAll("[data-pcc-today-compact-bar]").length === 1,
      milestoneJourney: root.querySelectorAll("[data-pcc-milestone-journey]").length === 1,
      actionMenu: root.querySelectorAll("[data-pcc-action-menu-trigger]").length > 0,
      milestoneReorder: calls.includes("move-milestone:proof-step-2->proof-step-1"),
      subMilestoneReorder: calls.includes("move-sub:proof-sub-2->proof-sub-1"),
      actionMutation: calls.includes("milestone-status:proof-step-1:deferred"),
      plainLabels: text.includes("Work This Project") && text.includes("Milestone Journey"),
    };
    const summaryOut = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-interaction-reliability.html"),
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

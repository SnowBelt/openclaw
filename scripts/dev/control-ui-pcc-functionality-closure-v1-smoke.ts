import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const now = "2026-07-06T12:00:00Z";

function summary(id: string, title: string, status: "active" | "complete_with_maintenance") {
  return {
    id,
    title,
    status,
    percentComplete: status === "active" ? 23 : 100,
    milestoneCounts: {
      total: status === "active" ? 3 : 35,
      complete: status === "active" ? 1 : 35,
      blocked: status === "active" ? 1 : 0,
      needsApproval: 0,
      deferred: 0,
      skipped: 0,
    },
    nextActions:
      status === "active"
        ? ["Resolve toolchain blocker before work starts."]
        : ["Review proof when needed."],
    proofGaps: [],
    health: status === "active" ? "At risk" : "Complete",
    ...(title === "Project Command Center"
      ? {}
      : {
          excludedFromPccProductCompletion: true,
          pccCurrentScope: "active_project_work",
          workflowTemplateId: "snes-studio",
        }),
    updatedAt: now,
  };
}

function project(id: string, title: string, status: "active" | "complete_with_maintenance") {
  return {
    id,
    title,
    goal:
      title === "Project Command Center"
        ? "Maintain PCC product truth, proof, receipts, and project orchestration."
        : "Project-specific work that must stay separate from PCC product completion.",
    status,
    priority: 3,
    metadata: {
      pccWorkflowTemplateId: "software-product",
      excludedFromPccProductCompletion: title !== "Project Command Center",
      pccSetupScore: { score: 100, runnable: true },
      pccQualityGate: { status: "passing" },
      pccCompliance: { badge: "Passing", status: "passing" },
      pccIntake: {
        approved: true,
        answers: {
          goal: "Use PCC safely.",
          firstDeliverable: "A verified safe next step.",
          doneProof: "Local proof passes.",
          constraints: "Do not perform project-specific implementation here.",
          owner: "local_openclaw_agent",
          blockers: "None.",
        },
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function milestone(
  id: string,
  projectId: string,
  title: string,
  order: number,
  status = "not_started",
) {
  return {
    id,
    projectId,
    title,
    status: status as "not_started" | "complete",
    order,
    percentComplete: status === "complete" ? 100 : 0,
    implementationPlan: "Run only safe, proof-backed PCC work.",
    acceptanceCriteria: ["The action is visible, saveable, and reversible when safe."],
    metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-functionality-closure-v1-smoke",
    timestampSlug(),
  );
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
      throw new Error("missing root");
    }

    const pccSummary = summary(
      "project-command-center",
      "Project Command Center",
      "complete_with_maintenance",
    );
    const snesSummary = summary("snes-game-creator", "SNES Game Creator", "active");
    const pccProject = project(
      "project-command-center",
      "Project Command Center",
      "complete_with_maintenance",
    );
    const snesProject = project("snes-game-creator", "SNES Game Creator", "active");
    const calls: string[] = [];
    const baseProps = {
      loading: false,
      error: null,
      connected: true,
      updatedAt: Date.now(),
      portfolio: {
        projectsTotal: 2,
        active: 1,
        blocked: 1,
        needsApproval: 0,
        complete: 1,
        archived: 0,
        averagePercentComplete: 62,
        nextActions: ["Review PCC proof."],
      },
      projects: [pccSummary, snesSummary],
      selectedProjectId: "project-command-center",
      projectDetail: {
        project: pccProject,
        milestones: [milestone("pcc-1", "project-command-center", "PCC proof", 1, "complete")],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: pccSummary,
      },
      projectDetails: {
        "project-command-center": {
          project: pccProject,
          milestones: [milestone("pcc-1", "project-command-center", "PCC proof", 1, "complete")],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: pccSummary,
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
        projectId: "project-command-center",
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
      decisionFormOpen: false,
      decisionForm: {
        id: null,
        title: "",
        summary: "",
        rationale: "",
        alternatives: "",
        impact: "",
        decidedBy: "",
        evidenceIds: [],
      },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "simple" as const,
      productFocusMode: "pcc_product" as const,
      reorderMode: false,
      onSetViewMode: (mode: string) => calls.push(`view:${mode}`),
      onSetProductFocusMode: (mode: string) => calls.push(`focus:${mode}`),
      onSetReorderMode: (enabled: boolean) => calls.push(`reorder:${enabled}`),
      onRefresh: () => calls.push("refresh"),
      onSelectProject: (id: string) => calls.push(`select:${id}`),
      onOpenProjectEditor: () => calls.push("edit-project"),
      onOpenMilestoneEditor: () => calls.push("edit-milestone"),
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
      onPrepareNextWorkItem: () => calls.push("prepare-work"),
      onMoveMilestoneBefore: (source: { id: string }, target: { id: string }) =>
        calls.push(`move:${source.id}->${target.id}`),
      onMoveSubMilestoneBefore: (source: { id: string }, target: { id: string }) =>
        calls.push(`move-sub:${source.id}->${target.id}`),
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };

    render(renderPccDashboard(baseProps), root);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const productText = root.textContent ?? "";
    root
      .querySelector<HTMLButtonElement>(
        '[data-pcc-product-focus="pcc_product"] [data-pcc-project-open]',
      )
      ?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]")?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.click();
    const checksProduct = {
      selectedPccDetail:
        root.querySelector('[data-pcc-detail-project-title="Project Command Center"]') !== null,
      noSnesCardInPccProduct: !Array.from(root.querySelectorAll("[data-pcc-project-card]")).some(
        (node) => node.textContent?.includes("SNES Game Creator"),
      ),
      completeState: root.querySelector("[data-pcc-complete-state]") !== null,
      noTerminalSetupRepair: root.querySelector("[data-pcc-setup-repair]") === null,
      completeWorkLoop: root.querySelector("[data-pcc-work-loop-complete]") !== null,
      reorderVisibleButDisabled:
        root.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]")?.disabled === true,
      noActionMenuButtonsForCompleteSimple:
        root.querySelectorAll("[data-pcc-action-menu-trigger]").length === 0,
      compactTop:
        root.querySelector("[data-pcc-today-compact-bar]") !== null &&
        productText.includes("PCC Product"),
    };

    const projectWorkProps = {
      ...baseProps,
      productFocusMode: "project_work",
      selectedProjectId: "snes-game-creator",
      projectDetail: {
        project: snesProject,
        milestones: [
          milestone("snes-1", "snes-game-creator", "Intake", 1, "complete"),
          milestone("snes-2", "snes-game-creator", "Toolchain preflight", 2),
        ],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: snesSummary,
      },
      projectDetails: {
        ...baseProps.projectDetails,
        "snes-game-creator": {
          project: snesProject,
          milestones: [
            milestone("snes-1", "snes-game-creator", "Intake", 1, "complete"),
            milestone("snes-2", "snes-game-creator", "Toolchain preflight", 2),
          ],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: snesSummary,
        },
      },
    };

    render(renderPccDashboard({ ...projectWorkProps, reorderMode: true }), root);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    root
      .querySelector<HTMLButtonElement>(
        '[data-pcc-project-id="snes-game-creator"] [data-pcc-project-open]',
      )
      ?.click();
    root
      .querySelector<HTMLButtonElement>(
        '[data-pcc-milestone-id="snes-2"] [data-pcc-reorder="milestone-up"]',
      )
      ?.click();
    const reorderEnabled =
      root.querySelector<HTMLButtonElement>("[data-pcc-reorder-mode-toggle]")?.disabled === false;
    const keyboardMoveCallsReorder = calls.includes("move:snes-2->snes-1");

    render(renderPccDashboard({ ...projectWorkProps, reorderMode: false }), root);
    const menuTrigger = root.querySelector<HTMLButtonElement>(
      '[data-pcc-milestone-id="snes-2"] [data-pcc-action-menu-trigger]',
    );
    menuTrigger?.click();
    const openedItems = root.querySelector<HTMLElement>(
      '[data-pcc-milestone-id="snes-2"] .pcc-action-menu__items',
    );
    const menuOpen =
      openedItems?.hidden === false && openedItems?.getAttribute("aria-hidden") === "false";

    const checksProjectWork = {
      snesCardVisibleInProjectWork: root.textContent?.includes("SNES Game Creator") === true,
      snesOpenCallback: calls.includes("select:snes-game-creator"),
      reorderEnabled,
      keyboardMoveCallsReorder,
      actionMenuOpensAccessibly: menuOpen,
      menuTriggerExpanded: menuTrigger?.getAttribute("aria-expanded") === "true",
    };

    const summaryOut = {
      artifactDir,
      checks: { ...checksProduct, ...checksProjectWork },
      calls,
      html: join(artifactDir, "pcc-functionality-closure-v1.html"),
    };
    const ok = Object.values(summaryOut.checks).every(Boolean);
    writeFileSync(summaryOut.html, dom.serialize());
    writeFileSync(
      join(artifactDir, "summary.json"),
      JSON.stringify({ ...summaryOut, ok }, null, 2),
    );
    console.log(JSON.stringify({ ...summaryOut, ok }, null, 2));
    if (!ok) {
      process.exit(1);
    }
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

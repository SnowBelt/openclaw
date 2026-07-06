import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const now = "2026-07-06T21:00:00Z";

function projectSummary(id: string, title: string, excluded = false) {
  return {
    id,
    title,
    status: excluded ? ("active" as const) : ("complete_with_maintenance" as const),
    percentComplete: excluded ? 24 : 100,
    milestoneCounts: {
      total: excluded ? 7 : 39,
      complete: excluded ? 1 : 39,
      blocked: excluded ? 1 : 0,
      needsApproval: 0,
      deferred: 0,
      skipped: 0,
    },
    nextActions: excluded
      ? ["Verify toolchain: Missing patch tool."]
      : ["Review maintenance proof."],
    proofGaps: [],
    health: excluded ? "At risk" : "Complete",
    ...(excluded
      ? {
          excludedFromPccProductCompletion: true,
          pccCurrentScope: "active_project_work",
          workflowTemplateId: "snes-studio",
        }
      : {}),
    updatedAt: now,
  };
}

function project(id: string, title: string, excluded = false) {
  return {
    id,
    title,
    goal: excluded ? "Project-specific work." : "Keep PCC product proof current.",
    status: excluded ? ("active" as const) : ("complete_with_maintenance" as const),
    priority: 3,
    metadata: {
      ...(excluded
        ? {
            excludedFromPccProductCompletion: true,
            pccCurrentScope: "active_project_work",
            pccWorkflowTemplateId: "snes-studio",
          }
        : {}),
      pccSetupScore: { score: 100, runnable: true },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function milestone(id: string, projectId: string, title: string, complete = false) {
  return {
    id,
    projectId,
    title,
    status: complete ? ("complete" as const) : ("blocked" as const),
    order: complete ? 10 : 20,
    percentComplete: complete ? 100 : 0,
    blocker: complete ? undefined : "Missing patch tool.",
    implementationPlan: "Keep the action safe and proof-backed.",
    acceptanceCriteria: ["The UI renders without crashing."],
    metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-audit-findings-closure-v1-smoke",
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
    const { buildPccContextPackage } = await import("../../ui/src/ui/pcc-context-package.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing root");
    }

    const pcc = project("project-command-center", "Project Command Center");
    const snes = project("project-snes-game-creator", "SNES Game Creator", true);
    const pccSummary = projectSummary("project-command-center", "Project Command Center");
    const snesSummary = projectSummary("project-snes-game-creator", "SNES Game Creator", true);
    const pccDetail = {
      project: pcc,
      milestones: [milestone("pcc-proof", pcc.id, "PCC proof", true)],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [
        {
          id: "legacy-receipt",
          projectId: pcc.id,
          milestoneId: "pcc-proof",
          summary: "Legacy receipt without proof level.",
          proofEvidenceIds: [],
          completedBy: "Project Command Center",
          completedAt: now,
        },
      ],
      summary: pccSummary,
    };
    const packet = buildPccContextPackage(
      pccDetail as Parameters<typeof buildPccContextPackage>[0],
      {
        mode: "full",
      },
    );
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
        nextActions: ["Review maintenance proof."],
      },
      projects: [pccSummary, snesSummary],
      selectedProjectId: pcc.id,
      projectDetail: pccDetail,
      projectDetails: { [pcc.id]: pccDetail },
      actionBusy: false,
      actionError: null,
      editorMode: null,
      projectForm: { id: null, title: "", goal: "", status: "active", priority: "3" },
      milestoneForm: {
        id: null,
        projectId: pcc.id,
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
      onSetProductFocusMode: (mode: string) => calls.push(`focus:${mode}`),
      onSetViewMode: (mode: string) => calls.push(`view:${mode}`),
      onSetReorderMode: (enabled: boolean) => calls.push(`reorder:${enabled}`),
      onRefresh: () => undefined,
      onSelectProject: (id: string) => calls.push(`select:${id}`),
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
      onMoveMilestoneBefore: () => undefined,
      onMoveSubMilestoneBefore: () => undefined,
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };

    render(renderPccDashboard(baseProps), root);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const productCards = Array.from(root.querySelectorAll("[data-pcc-project-card]")).map(
      (node) => node.textContent ?? "",
    );
    const nextActionText =
      root.querySelector("[data-pcc-today-next-action]")?.textContent?.replace(/\s+/g, " ") ?? "";
    const checks = {
      contextPackageSafe: packet.includes("Proof=Not recorded."),
      simpleModeLazyContextPackage: root.querySelector("[data-pcc-context-package]") === null,
      summaryOnlyScopeExcludesProjectWork:
        !productCards.some((text) => text.includes("SNES Game Creator")) &&
        !nextActionText.includes("SNES Game Creator"),
      selectedPccStillRenders:
        root.querySelector('[data-pcc-detail-project-title="Project Command Center"]') !== null,
    };

    render(
      renderPccDashboard({
        ...baseProps,
        productFocusMode: "project_work",
        selectedProjectId: snes.id,
        projectDetail: {
          project: snes,
          milestones: [
            milestone("snes-intake", snes.id, "SNES intake", true),
            milestone("snes-toolchain", snes.id, "SNES toolchain"),
          ],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: snesSummary,
        },
      }),
      root,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const projectWorkText = root.textContent ?? "";
    const checksProjectWork = {
      projectWorkShowsExcludedProject: projectWorkText.includes("SNES Game Creator"),
      projectWorkShowsShortBlocker:
        projectWorkText.includes("Missing tool") && projectWorkText.includes("Missing patch tool"),
    };
    const ok = Object.values({ ...checks, ...checksProjectWork }).every(Boolean);
    const summary = {
      artifactDir,
      ok,
      checks: { ...checks, ...checksProjectWork },
      calls,
      html: join(artifactDir, "pcc-audit-findings-closure-v1.html"),
    };
    writeFileSync(summary.html, dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { buildSnesGameCreatorSubMilestones } from "../../src/pcc/snes-game-creator-submilestones.ts";

export type PccSubMilestoneSmokeMode =
  | "submilestones"
  | "snes"
  | "ready-queue"
  | "work-lanes"
  | "skimmability"
  | "stop-here"
  | "today-view"
  | "production-truth"
  | "resource-governor"
  | "project-manager-intake"
  | "stop-rules"
  | "phase1-skimmability";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function runPccSubMilestoneSmoke(mode: PccSubMilestoneSmokeMode): Promise<void> {
  const artifactDir = join(".artifacts", `control-ui-pcc-${mode}-smoke`, timestampSlug());
  mkdirSync(artifactDir, { recursive: true });
  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, {
    url: "http://127.0.0.1/pcc",
  });
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
    const now = "2026-06-27T00:00:00Z";
    const project = {
      id: "snes-game-creator",
      title: "SNES Game Creator",
      goal: "Create patch-safe SNES games through SNES Studio with exact proof receipts.",
      status: "active" as const,
      priority: 4,
      metadata: {
        pccWorkLoop: {
          enabled: true,
          state: "working",
          stopBeforeCodex: true,
          stopBeforeRemoteProof: true,
          stopAfterCurrentMilestone: false,
          continueAroundBlockers: true,
          parallelWorkMode: "local_agents_only",
          lanes: {
            user: true,
            localOpenClawAgent: true,
            localModel: true,
            codex: false,
            highReasoningCodex: false,
            remoteProof: false,
          },
        },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestoneTitles = [
      "Define game concept, scope, and safety rules",
      "Verify SNES toolchain and emulator smoke path",
      "Create graphics, sprite, audio, and UI style kit",
      "Build playable MVP loop",
      "Add level flow, challenge, and fun pass",
      "Package patch-only deliverable and receipts",
      "Maintain bug, improvement, and expansion backlog",
    ];
    const milestones = milestoneTitles.map((title, index) => ({
      id: `milestone-${index + 1}`,
      projectId: project.id,
      title,
      status: index === 1 ? ("needs_approval" as const) : ("not_started" as const),
      order: index + 1,
      implementationPlan: `Complete the ${title} checklist in order.`,
      metadata: index === 5 ? { pccStopHere: true } : {},
      acceptanceCriteria: [
        "All non-skipped sub-milestones are complete",
        "Required proof receipt exists",
      ],
      createdAt: now,
      updatedAt: now,
    }));
    const subMilestones = buildSnesGameCreatorSubMilestones({
      projectId: project.id,
      milestones,
      nowIso: now,
    });
    const summary = {
      id: project.id,
      title: project.title,
      status: "active" as const,
      percentComplete: 12,
      milestoneCounts: {
        total: milestones.length,
        complete: 0,
        blocked: 0,
        needsApproval: 1,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Gather game idea", "Verify SNES toolchain"],
      proofGaps: ["SNES preflight proof receipt missing"],
      updatedAt: now,
    };
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        updatedAt: Date.now(),
        portfolio: {
          projectsTotal: 1,
          active: 1,
          blocked: 0,
          needsApproval: 1,
          complete: 0,
          archived: 0,
          averagePercentComplete: 12,
          nextActions: ["Gather game idea"],
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
          stopHere: false,
        },
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        viewMode: "agent",
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
      }),
      root,
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      subMilestones:
        root.querySelectorAll("[data-pcc-submilestone]").length === subMilestones.length,
      snesProject: text.includes("SNES Game Creator"),
      snesSteps:
        text.includes("Gather game idea") &&
        text.includes("Run emulator smoke") &&
        text.includes("Scan for forbidden ROM files"),
      currentTruth: root.querySelectorAll("[data-pcc-current-truth]").length === 1,
      readyQueue: root.querySelectorAll("[data-pcc-ready-queue]").length === 1,
      workLanes: root.querySelectorAll("[data-pcc-work-lanes]").length === 1,
      safeLanes:
        text.includes("Parallel Work") &&
        text.includes("Local OpenClaw Agent") &&
        text.includes("Codex"),
      today:
        root.querySelectorAll("[data-pcc-today]").length === 1 &&
        text.includes("Working now") &&
        text.includes("Needs you") &&
        text.includes("Ready next"),
      nextSafeAction:
        root.querySelectorAll("[data-pcc-next-safe-action]").length === 1 &&
        text.includes("Next Safe Action") &&
        text.includes("Start"),
      stopHere:
        root.querySelectorAll("[data-pcc-stop-here]").length > 0 &&
        text.includes("Stop point") &&
        text.includes("Continue around blockers"),
      productionTruth:
        root.querySelectorAll("[data-pcc-production-truth]").length === 1 &&
        text.includes("Production truth") &&
        text.includes("PCC remote Workflow Sanity proof missing"),
      resourceGovernor:
        root.querySelectorAll("[data-pcc-portfolio-console]").length === 1 &&
        text.includes("Policy: as many as safe") &&
        text.includes("VRAM budget: 256 GB"),
      stopRules:
        text.includes("Stop after current task") &&
        text.includes("Stop before destructive actions") &&
        text.includes("Stop before Codex"),
      detailDrawers: root.querySelectorAll(".pcc-detail-drawer").length >= 3,
      viewMode:
        root.querySelectorAll("[data-pcc-view-mode]").length === 1 &&
        text.includes("Simple") &&
        text.includes("Detailed") &&
        text.includes("Agent") &&
        root.querySelectorAll("[data-pcc-agent-mode]").length === 1,
      currentTruthNeedsYou: text.includes("Needs you") && text.includes("Proof missing"),
    };
    const modeChecks = {
      submilestones: checks.subMilestones && checks.currentTruth,
      snes: checks.snesProject && checks.snesSteps,
      "ready-queue": checks.readyQueue && text.includes("Ready Now") && text.includes("Blocked"),
      "work-lanes": checks.workLanes && checks.safeLanes,
      skimmability: checks.today && checks.nextSafeAction && checks.detailDrawers,
      "stop-here": checks.stopHere,
      "today-view": checks.today && checks.readyQueue,
      "production-truth": checks.productionTruth,
      "resource-governor": checks.resourceGovernor,
      "project-manager-intake": checks.productionTruth && checks.resourceGovernor,
      "stop-rules": checks.stopRules && checks.stopHere,
      "phase1-skimmability":
        checks.viewMode &&
        checks.today &&
        checks.nextSafeAction &&
        checks.currentTruth &&
        checks.currentTruthNeedsYou &&
        checks.detailDrawers,
    } satisfies Record<PccSubMilestoneSmokeMode, boolean>;
    const summaryOut = {
      artifactDir,
      mode,
      subMilestoneCount: subMilestones.length,
      ok: Object.values(checks).every(Boolean) && modeChecks[mode],
      checks,
      html: join(artifactDir, `pcc-${mode}.html`),
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
  }
}

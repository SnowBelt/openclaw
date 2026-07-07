import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-focus-live-interaction-closure-smoke",
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
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  (globalThis as { MouseEvent?: unknown }).MouseEvent = dom.window.MouseEvent;
  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing root");
    }
    const now = "2026-07-06T00:00:00Z";
    const calls: string[] = [];
    const pccProject = {
      id: "project-command-center",
      title: "Project Command Center",
      goal: "Maintain PCC.",
      status: "complete_with_maintenance" as const,
      priority: 5,
      metadata: {
        pccProductionTruth: {
          latestVerifiedSha: "d1e08b7522243488ca29609c55559cd79f145087",
          runtimeSha: "d1e08b7522243488ca29609c55559cd79f145087",
          remoteProofPassed: true,
          runtimeProofPassed: true,
          browserProofScreenshotPath: "/tmp/proof.png",
        },
      },
      createdAt: now,
      updatedAt: now,
    };
    const projectWork = {
      id: "needs-you-project",
      title: "Needs You Project",
      goal: "A project that needs user attention.",
      status: "blocked" as const,
      priority: 4,
      metadata: { pccCurrentScope: "active_project_work", excludedFromPccProductCompletion: true },
      createdAt: now,
      updatedAt: now,
    };
    const pccSummary = {
      id: pccProject.id,
      title: pccProject.title,
      status: pccProject.status,
      percentComplete: 100,
      health: "Complete",
      milestoneCounts: {
        total: 1,
        complete: 1,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: [],
      proofGaps: [],
      updatedAt: now,
    };
    const projectWorkSummary = {
      id: projectWork.id,
      title: projectWork.title,
      status: projectWork.status,
      percentComplete: 25,
      health: "Needs You",
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 1,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Fix blocker"],
      proofGaps: ["Blocked by test fixture"],
      excludedFromPccProductCompletion: true,
      pccCurrentScope: "active_project_work",
      updatedAt: now,
    };
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        updatedAt: Date.now(),
        portfolio: {
          projectsTotal: 2,
          active: 0,
          blocked: 1,
          needsApproval: 0,
          needsAttention: 1,
          complete: 1,
          archived: 0,
          averagePercentComplete: 62,
          nextActions: ["Fix blocker"],
        },
        projects: [pccSummary, projectWorkSummary],
        selectedProjectId: pccProject.id,
        projectDetail: {
          project: pccProject,
          milestones: [
            {
              id: "pcc-complete-step",
              projectId: pccProject.id,
              title: "PCC complete step",
              status: "complete" as const,
              order: 10,
              percentComplete: 100,
              implementationPlan: "Done.",
              acceptanceCriteria: ["Done"],
              metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "production" },
              createdAt: now,
              updatedAt: now,
            },
          ],
          subMilestones: [],
          permissions: [],
          evidence: [
            {
              id: "proof",
              projectId: pccProject.id,
              kind: "browser_proof" as const,
              status: "passed" as const,
              proofLevel: "production" as const,
              summary: "Browser proof passed.",
              createdAt: now,
              updatedAt: now,
            },
          ],
          receipts: [
            {
              id: "receipt",
              projectId: pccProject.id,
              milestoneId: "pcc-complete-step",
              summary: "Complete.",
              completedAt: now,
              completedBy: "OpenClaw",
              proofLevel: "production" as const,
              proofEvidenceIds: ["proof"],
              artifactRefs: [],
              doNotRedo: [],
              followUpGaps: [],
            },
          ],
          decisions: [],
          lastKnownGood: [],
          summary: pccSummary,
        },
        projectDetails: {},
        actionBusy: false,
        actionError: null,
        projectFilter: undefined,
        projectSearchQuery: "",
        editorMode: null,
        projectForm: { id: null, title: "", goal: "", status: "active", priority: "3" },
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
        decisionForm: {
          id: null,
          projectId: pccProject.id,
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
        viewMode: "simple",
        productFocusMode: "pcc_product",
        reorderMode: false,
        onSetViewMode: (mode) => calls.push(`view:${mode}`),
        onSetProductFocusMode: (mode) => calls.push(`focus:${mode}`),
        onSetReorderMode: (enabled) => calls.push(`reorder:${enabled}`),
        onSetProjectFilter: (filter) => calls.push(`filter:${filter}`),
        onSetProjectSearchQuery: (query) => calls.push(`search:${query}`),
        onRefresh: () => calls.push("refresh"),
        onSelectProject: (id) => calls.push(`select:${id}`),
        onOpenProjectEditor: () => calls.push("edit-project"),
        onOpenMilestoneEditor: () => calls.push("edit-milestone"),
        onProjectFormChange: () => undefined,
        onMilestoneFormChange: () => undefined,
        onSaveProject: () => undefined,
        onSaveMilestone: () => undefined,
        onCancelEditor: () => undefined,
        onSetProjectStatus: (_project, status) => calls.push(`project-status:${status}`),
        onSetMilestoneStatus: (_milestone, status) => calls.push(`milestone-status:${status}`),
        onSetMilestoneStopHere: () => undefined,
        onSetSubMilestoneStatus: () => undefined,
        onAddCompletionReceipt: () => undefined,
        onSetPermissionStatus: () => undefined,
        onUpdateWorkLoop: () => undefined,
        onPrepareNextWorkItem: () => calls.push("prepare"),
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
    const text = root.textContent?.replace(/\s+/g, " ") ?? "";
    const search = root.querySelector<HTMLInputElement>("[data-pcc-project-search] input");
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      focusBar: root.querySelectorAll("[data-pcc-project-focus-bar]").length === 1,
      todaySummary: text.includes("PCC is current"),
      noTopProofDrawerInSimpleCurrent: root.querySelectorAll(".pcc-top-proof-drawer").length === 0,
      proofBadgeInHero:
        root.querySelectorAll("[data-pcc-project-hero] [data-pcc-proof-badge]").length === 1,
      maintenanceHero: root.querySelectorAll("[data-pcc-maintenance-hero]").length === 1,
      dynamicSearchScope: search?.getAttribute("placeholder")?.includes("Active projects") === true,
      needsYouLabel: text.includes("Needs You"),
    };
    const summary = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-focus-live-interaction-closure.html"),
    };
    writeFileSync(summary.html, dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exit(1);
    }
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
    (globalThis as { MouseEvent?: unknown }).MouseEvent = previous.MouseEvent;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

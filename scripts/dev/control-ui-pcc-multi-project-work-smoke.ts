import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { withPccWorkLoopSettings } from "../../src/pcc/work-loop.js";
import type { PccDashboardProps } from "../../ui/src/ui/views/pcc.ts";

const artifactDir = join(
  ".artifacts",
  "control-ui-pcc-multi-project-work-smoke",
  new Date().toISOString().replace(/[:.]/g, "-"),
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
  const now = "2026-06-27T00:00:00Z";
  const project = withPccWorkLoopSettings(
    {
      id: "project-1",
      title: "SNES Game Creator",
      goal: "Create patch-only SNES games",
      status: "active",
      priority: 1,
      createdAt: now,
      updatedAt: now,
    },
    { enabled: true, parallelWorkMode: "supervised" },
    now,
  );
  const milestone = {
    id: "milestone-1",
    projectId: project.id,
    title: "Build playable MVP loop",
    status: "not_started" as const,
    order: 1,
    implementationPlan: "Build the MVP loop.",
    acceptanceCriteria: ["Emulator proof passes"],
    createdAt: now,
    updatedAt: now,
  };
  const detail = {
    project,
    milestones: [milestone],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    summary: {
      id: project.id,
      title: project.title,
      status: project.status,
      percentComplete: 0,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Build playable MVP loop"],
      proofGaps: [],
      updatedAt: now,
    },
  };
  const props: PccDashboardProps = {
    loading: false,
    error: null,
    projects: [detail.summary],
    portfolio: {
      projectsTotal: 1,
      active: 1,
      blocked: 0,
      needsApproval: 0,
      complete: 0,
      archived: 0,
      averagePercentComplete: 0,
      nextActions: [],
    },
    updatedAt: Date.now(),
    selectedProjectId: project.id,
    projectDetail: detail,
    projectDetails: { [project.id]: detail },
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
      codexPlanningAllowed: false,
      remoteProofAllowed: false,
      runtimeActionsAllowed: false,
    },
    milestoneForm: {
      id: null,
      projectId: null,
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
  };
  const root = dom.window.document.getElementById("root");
  if (!root) {
    throw new Error("missing root");
  }
  render(renderPccDashboard(props), root);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  const text = root.textContent ?? "";
  const checks = {
    console: root.querySelectorAll("[data-pcc-portfolio-console]").length === 1,
    heading: text.includes("Multi-project work console"),
    maxParallel: text.includes("Max parallel projects"),
    stopCodex: text.includes("Stop before Codex"),
    stopRemote: text.includes("Stop before remote proof"),
    readyItem: text.includes("Build playable MVP loop"),
  };
  const ok = Object.values(checks).every(Boolean);
  const summary = { ok, checks, html: join(artifactDir, "pcc-multi-project-work.html") };
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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-work-loop-smoke", timestampSlug());
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
    const calls: string[] = [];
    const project = {
      id: "pcc",
      title: "Project Command Center",
      goal: "Track work",
      status: "active" as const,
      priority: 3,
      metadata: {
        pccWorkLoop: {
          enabled: true,
          state: "working",
          stopBeforeCodex: true,
          stopBeforeRemoteProof: true,
          stopAfterCurrentMilestone: false,
        },
      },
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const milestone = {
      id: "milestone-loop",
      projectId: "pcc",
      title: "Guided Work Loop V1",
      status: "not_started" as const,
      order: 1,
      percentComplete: 0,
      implementationPlan: "Prepare one safe milestone task.",
      acceptanceCriteria: ["No Codex tokens are spent", "Missing permission stops the loop"],
      permissionGrantIds: ["permission-remote"],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const permission = {
      id: "permission-remote",
      projectId: "pcc",
      milestoneId: "milestone-loop",
      type: "remote_proof" as const,
      status: "needed" as const,
      riskLevel: "medium" as const,
      allowedActions: ["run Workflow Sanity"],
      usedCount: 0,
      auditLog: [],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const summary = {
      id: "pcc",
      title: "Project Command Center",
      status: "active" as const,
      percentComplete: 55,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 1,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Guided Work Loop V1"],
      proofGaps: ["Remote proof"],
      updatedAt: "2026-06-26T00:00:00Z",
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
          averagePercentComplete: 55,
          nextActions: ["Guided Work Loop V1"],
        },
        projects: [summary],
        selectedProjectId: "pcc",
        projectDetail: {
          project,
          milestones: [milestone],
          permissions: [permission],
          evidence: [],
          receipts: [],
          summary,
        },
        actionBusy: false,
        actionError: null,
        editorMode: null,
        projectForm: { id: null, title: "", goal: "", status: "active", priority: "3" },
        milestoneForm: {
          id: null,
          projectId: "pcc",
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
        onRefresh: () => calls.push("refresh"),
        onSelectProject: (id) => calls.push(`select:${id}`),
        onOpenProjectEditor: () => calls.push("edit-project"),
        onOpenMilestoneEditor: () => calls.push("edit-milestone"),
        onProjectFormChange: () => calls.push("project-change"),
        onMilestoneFormChange: () => calls.push("milestone-change"),
        onSaveProject: () => calls.push("save-project"),
        onSaveMilestone: () => calls.push("save-milestone"),
        onCancelEditor: () => calls.push("cancel"),
        onSetProjectStatus: (_project, status) => calls.push(`project-status:${status}`),
        onSetMilestoneStatus: (_milestone, status) => calls.push(`milestone-status:${status}`),
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
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    [...root.querySelectorAll("button")]
      .find(
        (button) =>
          button.textContent?.includes("Work This Project") ||
          button.textContent?.includes("Turn off"),
      )
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Prepare next safe task"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      workLoop: root.querySelectorAll("[data-pcc-work-loop]").length === 1,
      stopBeforeCodex: text.includes("Stop before Codex"),
      stopBeforeRemoteProof: text.includes("Stop before remote proof"),
      waiting: text.includes("Missing granted permission") || text.includes("remote proof"),
      noCodexStart: !calls.some((call) => call.toLowerCase().includes("codex")),
      callbacks: calls.includes("work-loop-update") && calls.includes("work-loop-next"),
    };
    const summaryOut = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-work-loop.html"),
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
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

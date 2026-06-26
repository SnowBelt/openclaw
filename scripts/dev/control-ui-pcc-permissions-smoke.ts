import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-permissions-smoke", timestampSlug());
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
      status: "needs_approval" as const,
      priority: 3,
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const milestone = {
      id: "milestone-remote-proof",
      projectId: "pcc",
      title: "Remote proof",
      status: "needs_approval" as const,
      permissionGrantIds: ["permission-remote"],
      implementationPlan: "Push branch and run Workflow Sanity.",
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const permission = {
      id: "permission-remote",
      projectId: "pcc",
      milestoneId: "milestone-remote-proof",
      type: "remote_proof" as const,
      status: "needed" as const,
      riskLevel: "medium" as const,
      allowedActions: ["push branch", "run Workflow Sanity"],
      forbiddenActions: ["merge upstream openclaw/openclaw"],
      target: "SnowBelt/openclaw",
      tokenBudget: 1000,
      usedCount: 0,
      auditLog: [],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const summary = {
      id: "pcc",
      title: "Project Command Center",
      status: "needs_approval" as const,
      percentComplete: 60,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 1,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Grant remote proof permission"],
      proofGaps: ["Workflow Sanity proof"],
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
          averagePercentComplete: 60,
          nextActions: ["Grant remote proof permission"],
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
        onSelectProject: () => calls.push("select"),
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
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const permissionButtons = [
      ...root.querySelectorAll<HTMLButtonElement>("[data-pcc-permission] button"),
    ];
    permissionButtons
      .find((button) => button.textContent?.includes("Grant"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    permissionButtons
      .find((button) => button.textContent?.includes("Defer"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    permissionButtons
      .find((button) => button.textContent?.includes("Deny"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      permissionCard: root.querySelectorAll("[data-pcc-permission]").length === 1,
      permissionText:
        text.includes("Permission needed") &&
        text.includes("Remote Proof") &&
        text.includes("SnowBelt/openclaw"),
      riskAndScope:
        text.includes("Medium") && text.includes("push branch") && text.includes("merge upstream"),
      buttons: [
        "permission-status:granted",
        "permission-status:needed",
        "permission-status:denied",
      ].every((call) => calls.includes(call)),
    };
    const summaryResult = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-permissions.html"),
    };
    writeFileSync(summaryResult.html, dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summaryResult, null, 2));
    console.log(JSON.stringify(summaryResult, null, 2));
    if (!summaryResult.ok) {
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

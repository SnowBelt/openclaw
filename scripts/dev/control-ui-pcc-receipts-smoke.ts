import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-receipts-smoke", timestampSlug());
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
      goal: "Track proof receipts without clutter.",
      status: "active" as const,
      priority: 3,
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const milestone = {
      id: "milestone-receipts",
      projectId: "pcc",
      title: "Evidence + Completion Receipts UI V1",
      status: "proof_pending" as const,
      order: 1,
      percentComplete: 70,
      implementationPlan: "Render proof receipts and prevent completion without evidence.",
      acceptanceCriteria: [
        "Passed evidence appears",
        "Receipt card stays collapsed",
        "Add receipt is gated",
      ],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const evidence = {
      id: "evidence-local-proof",
      projectId: "pcc",
      milestoneId: "milestone-receipts",
      kind: "local_test" as const,
      status: "passed" as const,
      summary: "Targeted PCC receipts tests passed.",
      command: "pnpm test ui/src/ui/views/pcc.test.ts",
      exitCode: 0,
      createdAt: "2026-06-26T00:00:00Z",
    };
    const receipt = {
      id: "receipt-local-proof",
      projectId: "pcc",
      milestoneId: "milestone-receipts",
      summary: "Receipts UI rendered from passed local proof.",
      proofEvidenceIds: ["evidence-local-proof"],
      proofLevel: "local" as const,
      doNotRedo: ["Do not redo the receipt UI proof unless a regression is recorded."],
      followUpGaps: ["Remote proof blocked by GitHub DNS."],
      completedBy: "Project Command Center",
      completedAt: "2026-06-26T00:00:00Z",
    };
    const summary = {
      id: "pcc",
      title: "Project Command Center",
      status: "active" as const,
      percentComplete: 70,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Add receipt"],
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
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 70,
          nextActions: ["Add receipt"],
        },
        projects: [summary],
        selectedProjectId: "pcc",
        projectDetail: {
          project,
          milestones: [milestone],
          permissions: [],
          evidence: [evidence],
          receipts: [receipt],
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
    const addReceiptButton = [...root.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add receipt"),
    ) as HTMLButtonElement | undefined;
    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      receipt: root.querySelectorAll("[data-pcc-receipt]").length === 1,
      evidence: root.querySelectorAll("[data-pcc-evidence-list]").length === 1,
      summary: text.includes("Receipts UI rendered from passed local proof."),
      doNotRedo: text.includes("Do not redo"),
      followUp: text.includes("Remote proof blocked by GitHub DNS"),
      addReceiptDisabledAfterReceipt: addReceiptButton?.disabled === true,
      noDuplicateAdd: !calls.includes("add-receipt"),
    };
    const summaryOut = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-receipts.html"),
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

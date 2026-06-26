import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-chat-sync-smoke", timestampSlug());
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
    const calls: string[] = [];
    const project = {
      id: "pcc",
      title: "Project Command Center",
      goal: "Sync chat plans into reviewable PCC diffs.",
      status: "active" as const,
      priority: 3,
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const milestone = {
      id: "milestone-chat-sync",
      projectId: "pcc",
      title: "Automatic Chat/Codex Sync V1",
      status: "not_started" as const,
      order: 1,
      percentComplete: 0,
      implementationPlan: "Convert chat plans into PCC diffs.",
      acceptanceCriteria: ["Diff preview required", "No silent rewrite"],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
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
      nextActions: ["Review chat updates"],
      proofGaps: ["Remote proof"],
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const proposal = {
      id: "chat-plan-1",
      kind: "update_milestone" as const,
      title: "Update milestone: Automatic Chat/Codex Sync V1",
      summary: "Structured chat plan detected.",
      risky: false,
      milestoneId: "milestone-chat-sync",
      milestonePatch: {
        id: "milestone-chat-sync",
        projectId: "pcc",
        title: "Automatic Chat/Codex Sync V1",
        implementationPlan: "Updated by chat sync.",
      },
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
          nextActions: ["Review chat updates"],
        },
        projects: [summary],
        selectedProjectId: "pcc",
        projectDetail: {
          project,
          milestones: [milestone],
          permissions: [],
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
        chatSyncText: "PLEASE IMPLEMENT THIS PLAN:\n# Automatic Chat/Codex Sync V1",
        chatSyncProposals: [proposal],
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
        onAddCompletionReceipt: () => undefined,
        onSetPermissionStatus: () => undefined,
        onUpdateWorkLoop: () => undefined,
        onPrepareNextWorkItem: () => undefined,
        onChatSyncTextChange: (text) => calls.push(`text:${text}`),
        onPreviewChatSync: () => calls.push("preview"),
        onApplyChatSyncProposal: (item) => calls.push(`apply:${item.id}`),
        onDismissChatSync: () => calls.push("dismiss"),
      }),
      root,
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    root.querySelector<HTMLTextAreaElement>(".pcc-chat-sync__input")!.value = "updated";
    root
      .querySelector<HTMLTextAreaElement>(".pcc-chat-sync__input")!
      .dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Review chat updates"))
      ?.click();
    root.querySelector<HTMLButtonElement>("[data-pcc-chat-sync-proposal] button")?.click();
    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      card: root.querySelectorAll("[data-pcc-chat-sync]").length === 1,
      proposal: root.querySelectorAll("[data-pcc-chat-sync-proposal]").length === 1,
      noSilentApply: calls.includes("preview") && calls.includes("apply:chat-plan-1"),
      textChanged: calls.some((call) => call === "text:updated"),
      visibleCopy:
        text.includes("Suggested updates from chat") && text.includes("No silent rewrite"),
    };
    const summaryOut = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-chat-sync.html"),
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

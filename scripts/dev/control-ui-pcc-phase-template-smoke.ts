import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-phase-template-smoke", timestampSlug());
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
    const project = {
      id: "pcc",
      title: "Project Command Center",
      goal: "Use phase templates and weighted completion.",
      status: "active" as const,
      priority: 3,
      phases: [
        { id: "setup", title: "Setup", status: "active" as const, weight: 10, order: 0 },
        {
          id: "tools-skills",
          title: "Tools/Skills",
          status: "active" as const,
          weight: 15,
          order: 1,
        },
        { id: "mvp", title: "MVP", status: "active" as const, weight: 25, order: 2 },
        { id: "refinement", title: "Refinement", status: "active" as const, weight: 20, order: 3 },
        {
          id: "production-proof",
          title: "Production Proof",
          status: "active" as const,
          weight: 25,
          order: 4,
        },
        { id: "maintenance", title: "Maintenance", status: "active" as const, weight: 5, order: 5 },
      ],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const milestones = [
      {
        id: "milestone-setup",
        projectId: "pcc",
        title: "Setup proof",
        status: "local_proof_complete" as const,
        phaseId: "setup",
        order: 1,
        percentComplete: 70,
        implementationPlan: "Finish setup.",
        acceptanceCriteria: ["Setup proof passes"],
        createdAt: "2026-06-26T00:00:00Z",
        updatedAt: "2026-06-26T00:00:00Z",
      },
      {
        id: "milestone-mvp",
        projectId: "pcc",
        title: "MVP proof",
        status: "in_progress" as const,
        phaseId: "mvp",
        order: 2,
        percentComplete: 40,
        implementationPlan: "Finish MVP.",
        acceptanceCriteria: ["MVP proof passes"],
        createdAt: "2026-06-26T00:00:00Z",
        updatedAt: "2026-06-26T00:00:00Z",
      },
    ];
    const summary = {
      id: "pcc",
      title: "Project Command Center",
      status: "active" as const,
      percentComplete: 17,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["MVP proof"],
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
          averagePercentComplete: 17,
          nextActions: ["MVP proof"],
        },
        projects: [summary],
        selectedProjectId: "pcc",
        projectDetail: {
          project,
          milestones,
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
      phases: root.querySelectorAll("[data-pcc-phases]").length === 1,
      phaseCards: root.querySelectorAll("[data-pcc-phase]").length === 6,
      templateLabels:
        text.includes("Setup") &&
        text.includes("Tools/Skills") &&
        text.includes("Production Proof"),
      phasePercentages: text.includes("70%") && text.includes("40%"),
      weights: text.includes("10% weight") && text.includes("25% weight"),
    };
    const summaryOut = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      html: join(artifactDir, "pcc-phase-template.html"),
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

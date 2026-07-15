import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function nowSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-autopilot-project-loop-smoke", nowSlug());
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
    const now = "2026-07-07T12:00:00Z";
    const calls: string[] = [];
    const project = {
      id: "autopilot-proof-project",
      title: "Autopilot Proof Project",
      goal: "Prove Autopilot loop UI without live token spend.",
      status: "active" as const,
      priority: 4,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    const milestone = {
      id: "autopilot-proof-milestone",
      projectId: project.id,
      title: "Verify Autopilot",
      status: "not_started" as const,
      order: 10,
      percentComplete: 0,
      implementationPlan: "Run safe Autopilot proof.",
      acceptanceCriteria: ["Autopilot history is recorded"],
      metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
      createdAt: now,
      updatedAt: now,
    };
    const summary = {
      id: project.id,
      title: project.title,
      status: project.status,
      percentComplete: 10,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Verify Autopilot"],
      proofGaps: [],
      health: "On track",
      updatedAt: now,
    };
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        updatedAt: Date.now(),
        portfolio: {
          projectsTotal: 1,
          active: 1,
          blocked: 0,
          needsApproval: 0,
          needsAttention: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 10,
          nextActions: [],
        },
        projects: [summary],
        selectedProjectId: project.id,
        projectDetail: {
          project,
          milestones: [milestone],
          subMilestones: [],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        },
        actionBusy: false,
        actionError: null,
        editorMode: null,
        projectForm: {
          id: null,
          title: "",
          goal: "",
          projectDescription: "",
          status: "active",
          priority: "",
          dueDate: "",
          outcomeMetrics: "",
          workflowTemplateId: "software-product",
          planningMode: "template_only",
          plannerMode: "best_available",
          plannerModelId: "best-available",
          plannerPermissionScope: "ask",
          plannerPermissionBudget: "",
          planPreviewAccepted: false,
          codexPlanningAllowed: false,
          remoteProofAllowed: false,
          runtimeActionsAllowed: false,
          intakeAnswers: {},
          intakeApproved: false,
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
        decisionFormOpen: false,
        decisionForm: {
          title: "",
          summary: "",
          rationale: "",
          impact: "",
          milestoneId: "",
          subMilestoneId: "",
          evidenceIds: "",
          decidedBy: "",
        },
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        viewMode: "detailed",
        onRefresh: () => calls.push("refresh"),
        onSelectProject: () => calls.push("select"),
        onOpenProjectEditor: () => calls.push("edit-project"),
        onOpenMilestoneEditor: () => calls.push("edit-milestone"),
        onProjectFormChange: () => undefined,
        onMilestoneFormChange: () => undefined,
        onSaveProject: () => calls.push("save-project"),
        onSaveMilestone: () => calls.push("save-milestone"),
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
        onConfigureAutopilotMode: (mode) => calls.push(`mode:${mode}`),
        onGenerateAutopilotPrompts: () => calls.push("generate-prompts"),
        onUpdateAutopilotPrompt: () => calls.push("update-prompt"),
        onRunAutopilotAction: (action) => calls.push(`autopilot:${action}`),
      }),
      root,
    );
    const required = [
      "[data-pcc-autopilot-project-loop]",
      "[data-pcc-autopilot-status-card]",
      "[data-pcc-autopilot-mode-picker]",
      "[data-pcc-autopilot-generate-prompts]",
      "[data-pcc-autopilot-start]",
      "[data-pcc-autopilot-prompts]",
      "[data-pcc-autopilot-history]",
      "[data-pcc-autopilot-final-report]",
    ];
    for (const selector of required) {
      if (!root.querySelector(selector)) {
        throw new Error(`missing ${selector}`);
      }
    }
    root.querySelector<HTMLButtonElement>("[data-pcc-autopilot-generate-prompts]")?.click();
    const start = root.querySelector<HTMLButtonElement>("[data-pcc-autopilot-start]");
    if (!start?.disabled) {
      throw new Error("start action should stay disabled until medium-risk approval is granted");
    }
    root.querySelector<HTMLButtonElement>("[data-pcc-autopilot-allow-medium]")?.click();
    if (!calls.includes("generate-prompts")) {
      throw new Error("generate prompts action did not fire");
    }
    if (!calls.includes("autopilot:allow_medium_risk")) {
      throw new Error("medium-risk approval action did not fire");
    }
    const text = root.textContent ?? "";
    for (const phrase of [
      "Autopilot Project Loop",
      "Simulation mode is active",
      "Permission needed before start",
      "Prompt slots",
      "Run history",
      "Final report",
    ]) {
      if (!text.includes(phrase)) {
        throw new Error(`missing phrase ${phrase}`);
      }
    }
    writeFileSync(
      join(artifactDir, "result.json"),
      `${JSON.stringify({ ok: true, calls }, null, 2)}\n`,
    );
    console.log("PCC_AUTOPILOT_PROJECT_LOOP_SMOKE_OK");
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
  }
}

await main();

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC operational confidence smoke missing selector: ${selector}`);
  }
  return found;
}

function assertText(root: ParentNode, selector: string, expected: string): void {
  const text = (requireSelector(root, selector).textContent ?? "").replace(/\s+/gu, " ").trim();
  if (!text.includes(expected)) {
    throw new Error(
      `Expected ${selector} to include ${JSON.stringify(expected)}; saw ${JSON.stringify(text)}`,
    );
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-operational-confidence-smoke", stamp());
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
      throw new Error("missing smoke root");
    }
    const now = "2026-07-08T12:00:00Z";
    const project = {
      id: "project-command-center",
      title: "Project Command Center",
      goal: "Keep PCC clear, reliable, and production-current.",
      status: "active" as const,
      priority: 5,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: {
          approved: true,
          answers: {
            goal: "Keep PCC clear, reliable, and production-current.",
            firstDeliverable: "Operational confidence controls.",
            doneProof: "Tests, smoke, browser proof, and ledger receipt.",
            constraints: "No reboot or SNES implementation work.",
            owner: "local_openclaw_agent",
            blockers: "None.",
          },
        },
        pccAutopilot: {
          status: "ready",
          mode: "bug_hunt",
          modeTitle: "Bug Hunt",
          currentSet: 1,
          completedSets: 1,
          totalPromptIterations: 2,
          currentExecutor: "safe_stub",
          promptSlots: [
            {
              id: "slot-1",
              enabled: true,
              title: "Find broken controls",
              promptBody: "Find broken controls.",
              purpose: "Bug hunt",
              executor: "safe_stub",
              approvalTier: "low",
              judge: "mandatory",
              version: 1,
            },
          ],
          runHistory: [
            {
              id: "run-1",
              timestamp: now,
              projectId: "project-command-center",
              loopMode: "bug_hunt",
              promptSlotId: "slot-1",
              promptTitle: "Find broken controls",
              promptVersion: 1,
              executor: "safe_stub",
              inputContextSummary: "Rendered selected project, blockers, milestones, and controls.",
              outputSummary: "No unsafe action was executed.",
              changedFiles: ["ui/src/ui/views/pcc.ts"],
              artifacts: ["operational-confidence-smoke"],
              approvals: [],
              checksRun: ["jsdom smoke"],
              judgeResult: { status: "passed", summary: "History is traceable.", evidence: [] },
              rawOutput: "Safe stub output.",
            },
          ],
        },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = Array.from({ length: 12 }, (_, index) => ({
      id: `operational-step-${index + 1}`,
      projectId: project.id,
      title: `Operational step ${index + 1}`,
      status:
        index < 9
          ? ("complete" as const)
          : index === 9
            ? ("in_progress" as const)
            : ("not_started" as const),
      order: (index + 1) * 10,
      percentComplete: index < 9 ? 100 : index === 9 ? 30 : 0,
      implementationPlan: "Keep PCC operationally clear and safe.",
      acceptanceCriteria: ["User can understand the next action."],
      metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local_smoke" },
      createdAt: now,
      updatedAt: now,
    }));
    const summary = {
      id: project.id,
      title: project.title,
      status: project.status,
      percentComplete: 76,
      milestoneCounts: {
        total: 12,
        complete: 9,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Operational step 10"],
      proofGaps: [],
      health: "On track",
      dueDate: null,
      recentActivity: "Operational confidence smoke running.",
      updatedAt: now,
    };
    const baseProps = {
      loading: false,
      error: null,
      connected: true,
      updatedAt: Date.parse(now),
      portfolio: {
        projectsTotal: 1,
        active: 1,
        blocked: 0,
        needsApproval: 0,
        complete: 0,
        archived: 0,
        averagePercentComplete: 76,
        nextActions: [],
      },
      projects: [summary],
      selectedProjectId: project.id,
      projectDetail: {
        project,
        milestones,
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        lastKnownGood: [],
        summary,
      },
      projectDetails: {},
      actionBusy: false,
      actionNotice: null,
      editorMode: null,
      projectForm: {
        projectDescription: "",
        title: "",
        goal: "",
        dueDate: "",
        priority: 5,
        owner: "",
        constraints: "",
        preferredWorkflow: "",
        plannerMode: "best_available",
        plannerModelId: "",
        plannerPermissionStatus: "not_requested",
        intakeAnswers: {},
        generatedPlanPreview: null,
        approveIntake: false,
      },
      milestoneForm: {
        projectId: project.id,
        title: "",
        phaseId: "",
        status: "not_started",
        owner: "",
        implementationPlan: "",
        acceptanceCriteria: "",
        blocker: "",
        requiredEvidenceIds: "",
        metadata: "",
      },
      decisionFormOpen: false,
      decisionForm: {
        title: "",
        summary: "",
        status: "proposed",
        options: "",
        selectedOption: "",
        rationale: "",
        evidenceIds: "",
        metadata: "",
      },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "simple" as const,
      productFocusMode: "pcc_product" as const,
      reorderMode: true,
      actionError: "invalid pcc.milestones.upsert params: at /milestone/order: must be >= 0",
      onSetViewMode: () => undefined,
      onRefresh: () => undefined,
      onSelectProject: () => undefined,
      onSetProjectFilter: () => undefined,
      onSetProjectSearchQuery: () => undefined,
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
      onUpdateWorkLoop: () => undefined,
      onPrepareNextWorkItem: () => undefined,
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
      onSetReorderMode: () => undefined,
      onMoveMilestoneBefore: () => undefined,
      onConfigureAutopilotMode: () => undefined,
      onGenerateAutopilotPrompts: () => undefined,
      onUpdateAutopilotPrompt: () => undefined,
      onRunAutopilotAction: () => undefined,
    };

    const start = performance.now();
    render(renderPccDashboard(baseProps), root);
    const elapsed = performance.now() - start;
    requireSelector(root, "[data-pcc-recovery-center]");
    requireSelector(root, "[data-pcc-execution-readiness]");
    requireSelector(root, "[data-pcc-universal-preflight]");
    requireSelector(root, "[data-pcc-scope-lock]");
    requireSelector(root, "[data-pcc-reorder-instruction]");
    requireSelector(root, "[data-pcc-completed-history-collapsed]");
    requireSelector(root, "[data-pcc-drag-handle='milestone']");
    if (root.querySelector("[data-pcc-action-menu-trigger]")) {
      throw new Error("Action menus must be paused while Reorder mode is active.");
    }
    assertText(root, "[data-pcc-reorder-instruction]", "Action menus are paused");
    assertText(root, "[data-pcc-recovery-center]", "Refresh safely");
    assertText(root, "[data-pcc-universal-preflight]", "Preflight");
    if (elapsed > 250) {
      throw new Error(`PCC render exceeded operational smoke budget: ${elapsed.toFixed(1)}ms`);
    }

    render(
      renderPccDashboard({
        ...baseProps,
        viewMode: "detailed",
        reorderMode: false,
        actionError: null,
      }),
      root,
    );
    requireSelector(root, "[data-pcc-interaction-contract-matrix]");
    assertText(root, "[data-pcc-interaction-contract-matrix]", "Work This Project");
    assertText(root, "[data-pcc-autopilot-history]", "Context:");
    assertText(root, "[data-pcc-autopilot-history]", "Changes: 1 file");

    const output = {
      ok: true,
      elapsedMs: Number(elapsed.toFixed(2)),
      selectors: {
        readiness: true,
        preflight: true,
        recovery: true,
        interactionMatrix: true,
      },
    };
    writeFileSync(join(artifactDir, "result.json"), `${JSON.stringify(output, null, 2)}\n`);
    console.log("PCC_OPERATIONAL_CONFIDENCE_SMOKE_OK", JSON.stringify(output));
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import type { PccDashboardState } from "../../ui/src/ui/pcc/application/state.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function artifactDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(".artifacts", "control-ui-pcc-snes-work-start-debug-smoke", stamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function main(): Promise<void> {
  const dir = artifactDir();
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
    const {
      EMPTY_PCC_DECISION_FORM,
      EMPTY_PCC_MILESTONE_FORM,
      EMPTY_PCC_PROJECT_FORM,
      buildPccSetupAutofillPreview,
      preparePccNextWorkItem,
      resumePccProjectForWork,
    } = await import("../../ui/src/ui/controllers/pcc.ts");

    const now = "2026-07-04T00:00:00Z";
    const project = {
      id: "project-snes-game-creator",
      title: "SNES Game Creator",
      goal: "Create a reliable SNES Studio workflow with patch-only safety rules.",
      status: "on_hold" as const,
      priority: 3,
      metadata: {
        pccWorkflowTemplateId: "snes-studio",
        pccIntake: {
          approved: true,
          answers: {
            goal: "Create a reliable SNES Studio workflow with patch-only safety rules.",
            firstDeliverable: "A read-only toolchain preflight.",
            doneProof: "Local toolchain proof and receipts.",
            constraints: "No installs, ROM files, or deliverables without separate approval.",
            owner: "OpenClaw local agent",
            blockers: "patch tool: flips or beat",
          },
        },
        pccQualityGate: { status: "passing" },
        pccSetupScore: { score: 100, runnable: true },
        pccCurrentScope: "excluded_project_specific_work",
      },
      createdAt: now,
      updatedAt: now,
    };
    const intakeMilestone = {
      id: "snes-01-intake-scope",
      projectId: project.id,
      title: "Define game concept, scope, and safety rules",
      status: "complete" as const,
      order: 10,
      percentComplete: 100,
      implementationPlan: "Approve the setup brief before build work starts.",
      acceptanceCriteria: ["Brief is approved."],
      metadata: { recommendedWorker: "OpenClaw local agent", proofRequired: "manual_review" },
      createdAt: now,
      updatedAt: now,
    };
    const toolchainMilestone = {
      id: "snes-02-toolchain-preflight",
      projectId: project.id,
      title: "Verify SNES toolchain and emulator smoke path",
      status: "on_hold" as const,
      order: 20,
      percentComplete: 75,
      blocker: "Project-specific work removed from current working scope.",
      implementationPlan: "Run read-only SNES toolchain checks.",
      acceptanceCriteria: ["Missing tools are exact blockers."],
      metadata: {
        recommendedWorker: "local model/OpenClaw",
        proofRequired: "local_test",
        blockers: ["patch tool: flips or beat"],
        excludedFromPccCurrentScope: true,
        noInstall: true,
        noRomFiles: true,
        noBuildWork: true,
        noDeliverables: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    const subMilestone = {
      id: "snes-toolchain-patch-tool",
      projectId: project.id,
      milestoneId: toolchainMilestone.id,
      title: "Check patch tool",
      status: "on_hold" as const,
      order: 10,
      implementationPlan: "Check flips or beat without installing tools.",
      acceptanceCriteria: ["Missing patch tool is recorded exactly."],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        proofRequired: "Patch tool command exits 0 or records exact blocker.",
        excludedFromPccCurrentScope: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    const summary = {
      id: project.id,
      title: project.title,
      status: "on_hold" as const,
      percentComplete: 14,
      milestoneCounts: {
        total: 2,
        complete: 1,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Resume project"],
      proofGaps: [],
      updatedAt: now,
    };
    const detail = {
      project,
      milestones: [intakeMilestone, toolchainMilestone],
      subMilestones: [subMilestone],
      permissions: [],
      evidence: [],
      receipts: [],
      decisions: [],
      summary,
    };

    const preview = buildPccSetupAutofillPreview(detail, true);
    assert(
      preview.milestoneUpdates.some(
        (update) => update.id === toolchainMilestone.id && update.fields.includes("owner"),
      ),
      "legacy recommendedWorker should produce canonical owner repair",
    );

    let resumed = false;
    const root = dom.window.document.getElementById("root");
    assert(root, "missing render root");
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        projects: [summary],
        portfolio: {
          projectsTotal: 1,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 14,
          nextActions: ["Resume project"],
        },
        updatedAt: Date.now(),
        selectedProjectId: project.id,
        projectDetail: detail,
        projectDetails: { [project.id]: detail },
        actionBusy: false,
        actionError: null,
        editorMode: null,
        projectForm: { ...EMPTY_PCC_PROJECT_FORM },
        milestoneForm: { ...EMPTY_PCC_MILESTONE_FORM },
        decisionFormOpen: false,
        decisionForm: { ...EMPTY_PCC_DECISION_FORM },
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        viewMode: "detailed",
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
        onResumeProject: () => {
          resumed = true;
        },
        onPreviewSetupAutofill: () => undefined,
        onChatSyncTextChange: () => undefined,
        onPreviewChatSync: () => undefined,
        onApplyChatSyncProposal: () => undefined,
        onDismissChatSync: () => undefined,
      }),
      root,
    );

    const text = root.textContent ?? "";
    assert(text.includes("Resume Project"), "on-hold project should show Resume Project");
    assert(
      text.includes("Project is on hold. Resume it before starting supervised work."),
      "work-start blockers should explain project hold",
    );
    assert(
      !text.includes("Goal missing"),
      "SNES fixture should not show stale goal-missing blocker",
    );
    assert(
      !text.includes("Setup quality gate is missing"),
      "legacy recommendedWorker should not collapse into generic setup gate failure",
    );
    root.querySelector<HTMLButtonElement>("[data-pcc-resume-project]")?.click();
    assert(resumed, "Resume Project button should invoke resume action");

    const requestCalls: Array<[string, unknown]> = [];
    const request = async (method: string, params: unknown): Promise<unknown> => {
      requestCalls.push([method, params]);
      if (method === "pcc.projects.upsert") {
        return { project: { ...project, status: "active" }, summary };
      }
      if (method === "pcc.milestones.upsert") {
        return { milestone: toolchainMilestone, summary };
      }
      if (method === "pcc.subMilestones.upsert") {
        return { subMilestone };
      }
      if (method === "pcc.projects.list") {
        return { projects: [summary] };
      }
      if (method === "pcc.summary.get") {
        return { portfolio: { projectsTotal: 1, active: 1 } };
      }
      if (method === "pcc.projects.get") {
        return { ...detail, project: { ...project, status: "active" } };
      }
      return {};
    };
    const state: PccDashboardState = {
      client: { request } as unknown as PccDashboardState["client"],
      connected: true,
      pccProjects: [summary],
      pccPortfolioSummary: null,
      pccLoading: false,
      pccError: null,
      pccUpdatedAt: null,
      pccSelectedProjectId: project.id,
      pccProjectDetail: detail,
      pccProjectDetails: { [project.id]: detail },
      pccActionBusy: false,
      pccActionError: null,
      pccEditorMode: null,
      pccProjectForm: { ...EMPTY_PCC_PROJECT_FORM },
      pccMilestoneForm: { ...EMPTY_PCC_MILESTONE_FORM },
      pccDecisionFormOpen: false,
      pccDecisionForm: { ...EMPTY_PCC_DECISION_FORM },
      pccChatSyncText: "",
      pccChatSyncProposals: [],
      pccChatSyncError: null,
      pccViewMode: "detailed" as const,
      requestUpdate: () => undefined,
    };

    await preparePccNextWorkItem(state);
    assert(
      state.pccActionError?.includes("Project is on hold"),
      "prepare should ask for resume first",
    );
    await resumePccProjectForWork(state);
    assert(
      requestCalls.some(
        ([method, params]) =>
          method === "pcc.milestones.upsert" &&
          (params as { milestone?: { id?: string; status?: string; blocker?: string } }).milestone
            ?.id === toolchainMilestone.id &&
          (params as { milestone?: { status?: string; blocker?: string } }).milestone?.status ===
            "blocked" &&
          (params as { milestone?: { blocker?: string } }).milestone?.blocker?.includes(
            "patch tool: flips or beat",
          ),
      ),
      "resume should convert scope-held toolchain milestone into exact tool blocker",
    );
    assert(
      !requestCalls.some(
        ([method, params]) =>
          method === "pcc.subMilestones.upsert" &&
          (params as { subMilestone?: { status?: string } }).subMilestone?.status === "in_progress",
      ),
      "resume must not start build work",
    );

    writeFileSync(
      join(dir, "summary.json"),
      JSON.stringify({ ok: true, requestCallCount: requestCalls.length }, null, 2),
    );
    console.log("PCC_SNES_WORK_START_DEBUG_SMOKE_OK");
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

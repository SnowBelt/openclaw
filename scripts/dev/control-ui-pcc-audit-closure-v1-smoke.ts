import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { resolvePccExecutionProfilePreset } from "../../src/pcc/execution-profile.js";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC audit closure smoke missing selector: ${selector}`);
  }
  return found;
}

function requireText(text: string, label: string): void {
  if (!text.includes(label)) {
    throw new Error(`PCC audit closure smoke missing text: ${label}`);
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-audit-closure-v1-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });

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
    const { buildPccSectionAutofillPreview } = await import("../../ui/src/ui/controllers/pcc.ts");

    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }

    const now = "2026-07-04T12:00:00Z";
    const project = {
      id: "audit-project",
      title: "Project Command Center",
      goal: "Make PCC easy to skim, reliable to operate, and safe for agentic work.",
      status: "on_hold",
      priority: 5,
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: {
          approved: false,
          answers: {
            goal: "Make PCC easy to skim.",
            firstDeliverable: "Audit closure UI.",
            doneProof: "Tests, smoke, build, and browser proof pass.",
            constraints: "No reboot or token spend.",
            owner: "local_openclaw_agent",
            blockers: "Needs approval.",
          },
        },
        pccQualityGate: { status: "needs_review" },
        pccSetupScore: { score: 86, runnable: false },
        pccCompliance: { badge: "Needs Review", status: "needs_review" },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = [
      {
        id: "audit-layout",
        projectId: project.id,
        title: "Selected Project Workspace + Milestone Journey Layout V4",
        status: "in_progress",
        order: 10,
        percentComplete: 65,
        implementationPlan: "Make the selected project workspace the main readable surface.",
        acceptanceCriteria: ["Journey is skimmable", "Details are progressively disclosed"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "audit-actions",
        projectId: project.id,
        title: "Reliable Action Mutations + Undo V2",
        status: "not_started",
        order: 20,
        percentComplete: 0,
        dependsOn: ["audit-layout"],
        implementationPlan: "Show mutation receipts and restore safe previous state with Undo.",
        acceptanceCriteria: ["Undo appears", "Invalid dependency reorder is blocked"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const subMilestones = [
      {
        id: "audit-sub-layout",
        projectId: project.id,
        milestoneId: "audit-layout",
        title: "Create skimmable workspace",
        status: "in_progress",
        order: 10,
        percentComplete: 65,
        implementationPlan: "Move details behind tabs and drawers.",
        acceptanceCriteria: ["Plan, Proof, Decisions, Automation, Diagnostics tabs exist"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "audit-sub-actions",
        projectId: project.id,
        milestoneId: "audit-actions",
        title: "Add mutation Undo",
        status: "not_started",
        order: 20,
        percentComplete: 0,
        implementationPlan: "Store a previous snapshot for safe mutations.",
        acceptanceCriteria: ["Undo button calls restore path"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const summary = {
      id: project.id,
      title: project.title,
      status: "on_hold",
      percentComplete: 48,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 0,
        needsApproval: 1,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Approve setup"],
      proofGaps: ["Audit closure proof pending"],
      health: "Needs review",
      updatedAt: now,
    };
    const detail = {
      project,
      milestones,
      subMilestones,
      permissions: [],
      evidence: [],
      receipts: [],
      decisions: [],
      summary,
    };
    const activeProject = {
      ...project,
      status: "active",
      metadata: {
        ...project.metadata,
        pccIntake: { ...project.metadata.pccIntake, approved: true },
        pccQualityGate: { status: "passing" },
        pccSetupScore: { score: 100, runnable: true },
        pccCompliance: { badge: "Passing", status: "passing" },
      },
    };
    const activeSummary = {
      ...summary,
      status: "active",
      milestoneCounts: { ...summary.milestoneCounts, needsApproval: 0 },
      health: "Ready",
    };
    const activeDetail = {
      ...detail,
      project: activeProject,
      summary: activeSummary,
    };
    const calls: string[] = [];
    const props = {
      loading: false,
      error: null,
      connected: true,
      updatedAt: Date.now(),
      portfolio: {
        projectsTotal: 2,
        active: 0,
        blocked: 0,
        needsApproval: 1,
        needsAttention: 1,
        complete: 1,
        archived: 0,
        averagePercentComplete: 74,
        nextActions: ["Approve setup"],
      },
      projects: [summary],
      selectedProjectId: project.id,
      projectDetail: detail,
      projectDetails: { [project.id]: detail },
      actionBusy: false,
      actionError: null,
      actionNotice: { kind: "success", text: "Saved new milestone order.", undoLabel: "Undo" },
      projectFilter: "all",
      projectEditMode: "ai",
      editorMode: "edit-project",
      projectForm: {
        id: project.id,
        title: project.title,
        goal: project.goal,
        projectDescription: project.goal,
        status: "on_hold",
        priority: "5",
        dueDate: "",
        outcomeMetrics: "Understand next action in under 5 seconds.",
        workflowTemplateId: "software-product",
        planningMode: "codex_full_plan",
        plannerMode: "high_reasoning_codex",
        plannerModelId: "openai:gpt-5.5-high-reasoning",
        executionProfile: {
          ...resolvePccExecutionProfilePreset("balanced"),
          codexModelId: "openai:gpt-5.5-high-reasoning",
        },
        plannerPermissionScope: "project",
        plannerPermissionBudget: "50k tokens",
        planPreviewAccepted: true,
        codexPlanningAllowed: true,
        remoteProofAllowed: false,
        runtimeActionsAllowed: false,
        intakeAnswers: project.metadata.pccIntake.answers,
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
      autofillPreview: buildPccSectionAutofillPreview(detail as never, "goal", false),
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "detailed",
      modelCatalog: [
        { id: "gpt-5.5-high-reasoning", name: "GPT-5.5 High Reasoning", provider: "openai" },
      ],
      modelsLoading: false,
      modelsLastRefreshedAt: Date.parse(now),
      onRefreshModelCatalog: () => calls.push("refresh-models"),
      onSetViewMode: () => undefined,
      onSetProjectEditMode: (mode: string) => calls.push(`edit-mode:${mode}`),
      onSetProjectFilter: () => undefined,
      onSetProjectSearchQuery: () => undefined,
      onDismissActionNotice: () => calls.push("dismiss"),
      onUndoAction: () => calls.push("undo"),
      onRefresh: () => undefined,
      onSelectProject: () => undefined,
      onOpenProjectEditor: () => undefined,
      onOpenMilestoneEditor: () => undefined,
      onProjectFormChange: (patch: Record<string, unknown>) =>
        calls.push(`project-form:${Object.keys(patch).join(",")}`),
      onMilestoneFormChange: () => undefined,
      onSaveProject: () => undefined,
      onSaveMilestone: () => undefined,
      onCancelEditor: () => undefined,
      onSetProjectStatus: () => undefined,
      onSetMilestoneStatus: () => calls.push("milestone-status"),
      onSetMilestoneStopHere: () => undefined,
      onSetSubMilestoneStatus: () => undefined,
      onMoveMilestoneBefore: () => calls.push("move-milestone"),
      onMoveSubMilestoneBefore: () => calls.push("move-submilestone"),
      onAddCompletionReceipt: () => undefined,
      onSetPermissionStatus: () => undefined,
      onUpdateWorkLoop: () => undefined,
      onPrepareNextWorkItem: () => undefined,
      onPreviewSetupAutofill: () => calls.push("preview-setup"),
      onPreviewSectionAutofill: (section: string) => calls.push(`section:${section}`),
      onApplySetupAutofill: () => calls.push("apply-autofill"),
      onApproveSetupAutofill: () => calls.push("approve-setup"),
      onDismissSetupAutofill: () => undefined,
      onSetAutofillApproval: () => undefined,
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };

    render(renderPccDashboard(props as never), root);
    const text = root.textContent ?? "";

    requireSelector(root, ".pcc-layout");
    requireSelector(root, "[data-pcc-milestone-journey]");
    requireSelector(root, "[data-pcc-project-edit-modes]");
    requireSelector(root, '[data-pcc-section-ai-regenerate="goal"]');
    requireSelector(root, "[data-pcc-setup-repair]");
    requireSelector(root, "[data-pcc-action-undo]");

    render(renderPccDashboard({ ...props, reorderMode: true } as never), root);
    requireSelector(root, '[data-pcc-drag-handle="milestone"]');
    requireSelector(root, '[data-pcc-drag-handle="submilestone"]');
    render(renderPccDashboard(props as never), root);

    requireSelector(root, "[data-pcc-detail-tabs]");
    requireSelector(root, "[data-pcc-deferred-project-banner]");
    render(
      renderPccDashboard({
        ...props,
        projects: [activeSummary],
        projectDetail: activeDetail,
        projectDetails: { [project.id]: activeDetail },
      } as never),
      root,
    );
    requireSelector(root, "[data-pcc-safety-settings]");
    render(renderPccDashboard(props as never), root);

    requireSelector(root, "[data-pcc-top-metrics-more]");
    requireSelector(root, "[data-pcc-model-refresh-status]");
    const savedPlannerPermission = requireSelector(root, "[data-pcc-planner-permission-saved]");
    requireText(text, "Active");
    requireText(text, "Needs You");
    requireText(text, "Running");
    requireText(text, "Plan");
    requireText(text, "Proof");
    requireText(text, "Diagnostics");
    requireText(
      (savedPlannerPermission.textContent ?? "").replace(/\s+/gu, " "),
      "no hard token cap",
    );

    (requireSelector(root, "[data-pcc-action-undo]") as HTMLElement).click();
    if (!calls.includes("undo")) {
      throw new Error("PCC audit closure smoke did not wire Undo");
    }
    (requireSelector(root, '[data-pcc-edit-mode="advanced"]') as HTMLElement).click();
    if (!calls.includes("edit-mode:advanced")) {
      throw new Error("PCC audit closure smoke did not wire edit mode tabs");
    }
    (requireSelector(root, '[data-pcc-section-ai-regenerate="goal"]') as HTMLElement).click();
    if (!calls.includes("section:goal")) {
      throw new Error("PCC audit closure smoke did not wire scoped AI regenerate");
    }

    const row = requireSelector(root, '[data-pcc-milestone-id="audit-layout"]') as HTMLElement;
    if (row.getAttribute("draggable") !== null) {
      throw new Error("PCC audit closure smoke found row-level milestone dragging");
    }
    const actionMenu = requireSelector(root, "[data-pcc-action-menu]") as HTMLElement;
    actionMenu.querySelector<HTMLElement>("[data-pcc-action-menu-trigger]")?.click();
    const skip = [...actionMenu.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Skip"),
    );
    skip?.click();
    requireSelector(root, "[data-pcc-confirm-popover]");
    actionMenu
      .querySelector<HTMLElement>(".pcc-action-menu__items")
      ?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (actionMenu.classList.contains("is-open")) {
      throw new Error("PCC audit closure smoke did not close action menu on Escape");
    }

    writeFileSync(join(artifactDir, "rendered.html"), root.innerHTML);
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify({ ok: true, calls }, null, 2));
    console.log(`PCC_AUDIT_CLOSURE_V1_SMOKE_OK ${artifactDir}`);
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

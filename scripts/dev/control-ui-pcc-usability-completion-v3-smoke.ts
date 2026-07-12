import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireText(text: string, label: string): void {
  if (!text.includes(label)) {
    throw new Error(`PCC usability completion V3 smoke missing text: ${label}`);
  }
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC usability completion V3 smoke missing selector: ${selector}`);
  }
  return found;
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-usability-completion-v3-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });

  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, {
    url: "http://127.0.0.1/pcc",
  });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
    DragEvent: (globalThis as { DragEvent?: unknown }).DragEvent,
    confirm: globalThis.confirm,
    prompt: globalThis.prompt,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  (globalThis as { DragEvent?: unknown }).DragEvent = dom.window.Event;
  globalThis.confirm = () => true;
  globalThis.prompt = () => "Remove this item from the active plan for now.";

  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const { buildPccSetupAutofillPreview } = await import("../../ui/src/ui/controllers/pcc.ts");

    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }

    const now = "2026-07-02T00:00:00Z";
    const project = {
      id: "pcc-usability-v3",
      title: "Project Command Center",
      goal: "Make PCC prompt-first, skimmable, reliable, and easy to operate.",
      status: "active",
      priority: 5,
      phases: [
        { id: "now", title: "Now", order: 10, weight: 25 },
        { id: "plan", title: "Plan", order: 20, weight: 45 },
        { id: "proof", title: "Proof", order: 30, weight: 30 },
      ],
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: {
          approved: false,
          answers: { goal: "Make PCC usable without reading instructions." },
        },
        pccQualityGate: { status: "missing" },
        pccSetupScore: { score: 72, runnable: false },
        pccCompliance: { badge: "Needs Review", status: "needs_review" },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = [
      {
        id: "action-reliability",
        projectId: project.id,
        title: "Reliable action mutations",
        status: "in_progress",
        phaseId: "now",
        order: 10,
        percentComplete: 70,
        implementationPlan:
          "Every PCC action saves, refreshes, and shows a visible receipt or failure.",
        acceptanceCriteria: ["Actions show success notices", "Failed actions show exact reasons"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "journey-layout",
        projectId: project.id,
        title: "Milestone journey layout",
        status: "not_started",
        phaseId: "plan",
        order: 20,
        percentComplete: 0,
        implementationPlan: "Make the milestone sequence obvious and draggable.",
        acceptanceCriteria: ["Drag handles render", "Sequence remains ordered"],
        metadata: { pccResponsibility: "local_openclaw_agent", pccProofLevel: "local" },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const subMilestones = [
      {
        id: "sub-action-notice",
        projectId: project.id,
        milestoneId: "action-reliability",
        title: "Show action receipts",
        status: "in_progress",
        order: 10,
        percentComplete: 70,
        implementationPlan: "Render success and error feedback after mutations.",
        acceptanceCriteria: ["Success callout is visible"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sub-drag-handle",
        projectId: project.id,
        milestoneId: "journey-layout",
        title: "Add drag handles",
        status: "not_started",
        order: 10,
        percentComplete: 0,
        implementationPlan:
          "Let milestones and sub-milestones be reordered with guarded drag handles.",
        acceptanceCriteria: ["Milestone and sub-milestone handles render"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sub-keyboard-reorder",
        projectId: project.id,
        milestoneId: "journey-layout",
        title: "Preserve keyboard reorder",
        status: "not_started",
        order: 20,
        percentComplete: 0,
        implementationPlan: "Keep keyboard-accessible reorder controls alongside drag handles.",
        acceptanceCriteria: ["Keyboard reorder controls still render"],
        createdAt: now,
        updatedAt: now,
      },
    ];
    const summary = {
      id: project.id,
      title: project.title,
      status: "active",
      percentComplete: 35,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 0,
        needsApproval: 1,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Fix setup with AI"],
      proofGaps: ["Browser proof pending"],
      updatedAt: now,
    };
    const detail = {
      project,
      milestones,
      subMilestones,
      permissions: [
        {
          id: "perm-codex-plan",
          projectId: project.id,
          milestoneId: "journey-layout",
          title: "Allow high-reasoning Codex planner",
          status: "needed",
          type: "codex",
          risk: "medium",
          riskLevel: "medium",
          target: "Codex planner",
          scope: "This plan only",
          allowedActions: ["Generate project milestones from the prompt"],
          forbiddenActions: ["Start implementation without user approval"],
          requestedAction: "Generate project milestones from the prompt.",
          createdAt: now,
          updatedAt: now,
        },
      ],
      evidence: [],
      receipts: [],
      summary,
    };
    const calls: string[] = [];
    const props = {
      loading: false,
      error: null,
      updatedAt: Date.now(),
      portfolio: {
        projectsTotal: 3,
        active: 1,
        blocked: 0,
        needsApproval: 1,
        complete: 1,
        archived: 1,
        averagePercentComplete: 66,
        nextActions: ["Fix setup with AI"],
      },
      projects: [
        summary,
        {
          ...summary,
          id: "stale",
          title: "Stale Project",
          status: "active",
          milestoneCounts: {
            total: 2,
            complete: 1,
            blocked: 0,
            needsApproval: 0,
            deferred: 0,
            skipped: 0,
          },
          nextActions: [],
          health: "On track",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        { ...summary, id: "held", title: "Held Project", status: "on_hold" },
        { ...summary, id: "archived", title: "Archived Project", status: "archived" },
      ],
      selectedProjectId: project.id,
      projectDetail: detail,
      projectDetails: { [project.id]: detail },
      actionBusy: false,
      actionError: null,
      actionNotice: { kind: "success", text: "Deferred. Undo is available.", undoLabel: "Undo" },
      projectFilter: "active",
      editorMode: "edit-project",
      projectForm: {
        id: project.id,
        title: project.title,
        goal: project.goal,
        projectDescription: "Prompt-first PCC usability project.",
        status: "active",
        priority: "5",
        workflowTemplateId: "software-product",
        planningMode: "codex_full_plan",
        plannerMode: "high_reasoning_codex",
        plannerModelId: "openai:gpt-5.5-high-reasoning",
        plannerPermissionScope: "plan",
        plannerPermissionBudget: "",
        planPreviewAccepted: false,
        codexPlanningAllowed: false,
        remoteProofAllowed: false,
        runtimeActionsAllowed: false,
        intakeAnswers: { goal: project.goal },
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
      autofillPreview: buildPccSetupAutofillPreview(detail as never, false),
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "detailed",
      projectEditMode: "ai",
      modelCatalog: [
        {
          id: "gpt-5.5-high-reasoning",
          name: "GPT-5.5 High Reasoning",
          provider: "openai",
          reasoning: true,
        },
        { id: "gpt-5.5", name: "GPT-5.5 Standard", provider: "openai" },
      ],
      modelsLoading: false,
      modelsLastRefreshedAt: Date.parse("2026-07-04T12:00:00Z"),
      onRefreshModelCatalog: () => calls.push("refresh-models"),
      onSetViewMode: () => undefined,
      onSetProjectEditMode: (mode: string) => calls.push(`edit-mode:${mode}`),
      onRefresh: () => undefined,
      onSelectProject: (id: string) => calls.push(`select:${id}`),
      onSetProjectFilter: (filter: string) => calls.push(`filter:${filter}`),
      onDismissActionNotice: () => calls.push("dismiss-notice"),
      onOpenProjectEditor: () => calls.push("edit-project"),
      onOpenMilestoneEditor: () => calls.push("edit-milestone"),
      onProjectFormChange: (patch: {
        intakeAnswers?: Record<string, string>;
        codexPlanningAllowed?: boolean;
        plannerMode?: string;
      }) => {
        if (patch.intakeAnswers?.firstDeliverable && patch.intakeAnswers.doneProof) {
          calls.push("draft-intake-answers");
        }
        if (patch.codexPlanningAllowed === true) {
          calls.push("allow-planner");
        }
        if (patch.plannerMode === "best_available" && patch.codexPlanningAllowed === false) {
          calls.push("cancel-planner-permission");
        }
      },
      onMilestoneFormChange: () => undefined,
      onSaveProject: () => undefined,
      onSaveMilestone: () => undefined,
      onCancelEditor: () => calls.push("cancel-editor"),
      onSetProjectStatus: () => calls.push("project-status"),
      onSetMilestoneStatus: () => calls.push("milestone-status"),
      onSetMilestoneStopHere: () => calls.push("stop-here"),
      onSetSubMilestoneStatus: () => calls.push("sub-status"),
      onMoveMilestoneBefore: () => calls.push("move-milestone"),
      onMoveSubMilestoneBefore: () => calls.push("move-submilestone"),
      onAddCompletionReceipt: () => undefined,
      onSetPermissionStatus: () => undefined,
      onUpdateWorkLoop: () => undefined,
      onPrepareNextWorkItem: () => undefined,
      onPreviewSetupAutofill: () => calls.push("preview-autofill"),
      onPreviewSectionAutofill: (section: string) => {
        calls.push(`section:${section}`);
        calls.push("preview-autofill");
      },
      onApplySetupAutofill: () => calls.push("apply-autofill"),
      onDismissSetupAutofill: () => calls.push("cancel-autofill"),
      onSetAutofillApproval: () => calls.push("approve-autofill"),
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };

    render(renderPccDashboard(props as never), root);
    const text = root.textContent ?? "";

    requireSelector(root, "[data-pcc-top-metrics]");
    requireSelector(root, "[data-pcc-project-tabs]");
    requireSelector(root, "[data-pcc-needs-attention-now]");
    requireSelector(root, "[data-pcc-action-notice]");
    requireSelector(root, "[data-pcc-proof-badge]");
    requireSelector(root, "[data-pcc-planner-model]");
    requireSelector(root, "[data-pcc-refresh-models]");
    requireSelector(root, "[data-pcc-model-refresh-status]");
    requireSelector(root, "[data-pcc-project-edit-modes]");
    requireSelector(root, '[data-pcc-edit-mode="simple"]');
    requireSelector(root, '[data-pcc-edit-mode="advanced"]');
    requireSelector(root, '[data-pcc-edit-mode="ai"]');
    requireSelector(root, "[data-pcc-section-ai-regenerate]");
    requireSelector(root, '[data-pcc-section-ai-regenerate="goal"]');
    requireSelector(root, '[data-pcc-section-ai-regenerate="handoff"]');
    requireSelector(root, "[data-pcc-planner-permission-card]");
    requireSelector(root, "[data-pcc-planner-permission-allow]");
    requireSelector(root, "[data-pcc-planner-permission-cancel]");
    requireSelector(root, "[data-pcc-planner-permission-scope]");
    requireSelector(root, "[data-pcc-planner-permission-budget]");
    requireSelector(root, "[data-pcc-setup-repair]");

    render(renderPccDashboard({ ...props, reorderMode: true } as never), root);
    requireSelector(
      root,
      '[data-pcc-milestone-id="action-reliability"] [data-pcc-drag-handle="milestone"]',
    );
    requireSelector(
      root,
      '[data-pcc-submilestone-id="sub-action-notice"] [data-pcc-drag-handle="submilestone"]',
    );
    requireText(text, "Active");
    requireText(text, "Needs You");
    requireText(text, "On Hold");
    requireText(text, "Archived");
    requireText(text, "Current proof:");
    requireText(text, "Stale Project");
    requireText(text, "No recorded update since");
    requireText(text, "Best available");
    requireText(text, "GPT-5.5 High Reasoning");
    requireText(text, "High-reasoning / Codex permission");
    requireText(text, "Codex planning needs approval");
    requireText(text, "Regenerate any section");
    requireText(text, "Basics");
    requireText(text, "Full plan");
    requireText(text, "AI help");
    requireText(text, "Last refresh:");
    requireText(text, "2 configured models");
    if (text.includes("Allow selected Codex/high-reasoning planner for this plan")) {
      throw new Error(
        "PCC usability completion V3 smoke found duplicate high-reasoning checkbox copy",
      );
    }
    requireText(text, "Setup needs a few answers");
    requireText(text, "Autofill answers with AI");
    requireText(text, "Milestone Journey");
    requireText(text, "Reliable action mutations");

    const generateIntakeButton = root.querySelector<HTMLButtonElement>(
      "[data-pcc-project-intake-form-only-autofill]",
    );
    if (!generateIntakeButton) {
      throw new Error("PCC usability completion V3 smoke missing form-only intake autofill button");
    }
    generateIntakeButton.click();
    if (!calls.includes("draft-intake-answers")) {
      throw new Error(
        "PCC usability completion V3 smoke did not draft intake answers into the form",
      );
    }

    const previewRepairButton = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Preview full setup repair"),
    );
    previewRepairButton?.click();
    if (!calls.includes("preview-autofill")) {
      throw new Error("PCC usability completion V3 smoke did not open intake AI preview");
    }

    (requireSelector(root, "[data-pcc-refresh-models]") as HTMLElement).click();
    if (!calls.includes("refresh-models")) {
      throw new Error("PCC usability completion V3 smoke did not wire model refresh");
    }

    (requireSelector(root, '[data-pcc-section-ai-regenerate="goal"]') as HTMLElement).click();
    if (!calls.includes("preview-autofill")) {
      throw new Error("PCC usability completion V3 smoke did not open section-level AI preview");
    }

    (requireSelector(root, "[data-pcc-planner-permission-allow]") as HTMLElement).click();
    if (!calls.includes("allow-planner")) {
      throw new Error("PCC usability completion V3 smoke did not wire planner permission allow");
    }

    (requireSelector(root, "[data-pcc-planner-permission-cancel]") as HTMLElement).click();
    if (!calls.includes("cancel-planner-permission")) {
      throw new Error("PCC usability completion V3 smoke did not wire planner permission cancel");
    }

    const milestone = requireSelector(
      root,
      '[data-pcc-milestone-id="journey-layout"]',
    ) as HTMLElement;
    milestone
      .querySelector<HTMLElement>('[data-pcc-drag-handle="milestone"]')
      ?.dispatchEvent(new dom.window.Event("dragstart", { bubbles: true }));
    const milestoneTarget = requireSelector(
      root,
      '[data-pcc-milestone-id="action-reliability"]',
    ) as HTMLElement;
    milestoneTarget.dispatchEvent(new dom.window.Event("drop", { bubbles: true }));
    if (!calls.includes("move-milestone")) {
      throw new Error("PCC usability completion V3 smoke did not wire drag/drop milestone reorder");
    }

    const subMilestone = requireSelector(
      root,
      '[data-pcc-submilestone-id="sub-keyboard-reorder"]',
    ) as HTMLElement;
    subMilestone
      .querySelector<HTMLElement>('[data-pcc-drag-handle="submilestone"]')
      ?.dispatchEvent(new dom.window.Event("dragstart", { bubbles: true }));
    const subMilestoneTarget = requireSelector(
      root,
      '[data-pcc-submilestone-id="sub-drag-handle"]',
    ) as HTMLElement;
    subMilestoneTarget.dispatchEvent(new dom.window.Event("drop", { bubbles: true }));
    if (!calls.includes("move-submilestone")) {
      throw new Error(
        "PCC usability completion V3 smoke did not wire drag/drop sub-milestone reorder",
      );
    }

    render(renderPccDashboard(props as never), root);
    const menuButton = requireSelector(
      root,
      "[data-pcc-action-menu] .pcc-action-menu__trigger",
    ) as HTMLElement;
    menuButton.click();
    requireText(root.textContent ?? "", "Remove from active plan");

    const cancelButton = requireSelector(
      root,
      `[data-pcc-editor="project"] footer .btn--subtle:last-child`,
    ) as HTMLElement;
    cancelButton.click();
    if (!calls.includes("cancel-editor")) {
      throw new Error("PCC usability completion V3 smoke did not wire project editor cancel");
    }

    writeFileSync(join(artifactDir, "rendered.html"), root.innerHTML);
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify({ ok: true, calls }, null, 2));
    console.log(`PCC_USABILITY_COMPLETION_V3_SMOKE_OK ${artifactDir}`);
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
    (globalThis as { DragEvent?: unknown }).DragEvent = previous.DragEvent;
    globalThis.confirm = previous.confirm;
    globalThis.prompt = previous.prompt;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

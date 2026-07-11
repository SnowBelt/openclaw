import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { buildPccSetupAutofillPreview } from "../../ui/src/ui/controllers/pcc.ts";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireText(text: string, label: string): void {
  if (!text.includes(label)) {
    throw new Error(`PCC autofill/skip smoke missing text: ${label}`);
  }
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC autofill/skip smoke missing selector: ${selector}`);
  }
  return found;
}

function clickMenuButton(menu: HTMLElement, label: string, confirm = false): void {
  const button = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) {
    throw new Error(`PCC autofill/skip smoke missing menu action: ${label}`);
  }
  button.click();
  if (confirm) {
    button.click();
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-autofill-skip-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });

  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, {
    url: "http://127.0.0.1/pcc",
  });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
    confirm: globalThis.confirm,
    prompt: globalThis.prompt,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  globalThis.confirm = () => true;
  globalThis.prompt = () => "Skipped because this path is not needed for the current project.";

  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");

    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }

    const now = "2026-07-01T00:00:00Z";
    const project = {
      id: "project-autofill",
      title: "SNES Game Creator",
      goal: "",
      status: "active" as const,
      priority: 3,
      phases: [{ id: "setup", title: "Setup", order: 1, weight: 100 }],
      metadata: {
        pccWorkflowTemplateId: "snes-studio",
        pccIntake: { approved: false, answers: { goal: "" } },
        pccQualityGate: { status: "missing" },
        pccSetupScore: { score: 35, runnable: false },
        pccCompliance: { badge: "Missing", status: "missing" },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestone = {
      id: "milestone-setup",
      projectId: project.id,
      title: "Define game concept, scope, and safety rules",
      status: "not_started" as const,
      order: 1,
      percentComplete: 0,
      implementationPlan: "",
      acceptanceCriteria: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    const subMilestone = {
      id: "sub-idea",
      projectId: project.id,
      milestoneId: milestone.id,
      title: "Gather game idea",
      status: "not_started" as const,
      order: 1,
      implementationPlan: "",
      acceptanceCriteria: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    const summary = {
      id: project.id,
      title: project.title,
      status: project.status,
      percentComplete: 0,
      milestoneCounts: {
        total: 1,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Setup missing: Required intake answer missing: Goal."],
      proofGaps: ["Setup quality gate missing"],
      updatedAt: now,
    };
    const detail = {
      project,
      milestones: [milestone],
      subMilestones: [subMilestone],
      permissions: [],
      evidence: [],
      receipts: [],
      summary,
    };
    const calls: Array<{ action: string; status?: string; note?: string }> = [];
    const handlers = {
      onSetViewMode: () => undefined,
      onRefresh: () => undefined,
      onSelectProject: () => undefined,
      onOpenProjectEditor: () => calls.push({ action: "edit-manually" }),
      onOpenMilestoneEditor: () => calls.push({ action: "edit-milestone" }),
      onProjectFormChange: () => undefined,
      onMilestoneFormChange: () => undefined,
      onSaveProject: () => undefined,
      onSaveMilestone: () => undefined,
      onCancelEditor: () => undefined,
      onSetProjectStatus: () => undefined,
      onSetMilestoneStatus: (_milestone: unknown, status: string, note?: string) =>
        calls.push({ action: "milestone-status", status, note }),
      onSetMilestoneStopHere: () => calls.push({ action: "stop-here" }),
      onSetSubMilestoneStatus: (_sub: unknown, status: string, note?: string) =>
        calls.push({ action: "sub-status", status, note }),
      onAddCompletionReceipt: () => undefined,
      onSetPermissionStatus: () => undefined,
      onUpdateWorkLoop: () => undefined,
      onPrepareNextWorkItem: () => undefined,
      onPreviewSetupAutofill: () => calls.push({ action: "preview-autofill" }),
      onApplySetupAutofill: () => calls.push({ action: "apply-autofill" }),
      onDismissSetupAutofill: () => calls.push({ action: "cancel-autofill" }),
      onSetAutofillApproval: (approved: boolean) =>
        calls.push({ action: approved ? "approve-autofill" : "unapprove-autofill" }),
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };
    const props = {
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
        averagePercentComplete: 0,
        nextActions: summary.nextActions,
      },
      projects: [summary],
      selectedProjectId: project.id,
      projectDetail: detail,
      projectDetails: { [project.id]: detail },
      actionBusy: false,
      actionError: null,
      editorMode: null,
      projectForm: {
        id: null,
        title: "",
        goal: "",
        projectDescription: "",
        status: "active" as const,
        priority: "3",
        workflowTemplateId: "snes-studio",
        planningMode: "local_project_manager" as const,
        plannerMode: "local_project_manager" as const,
        plannerModelId: "",
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
        status: "not_started" as const,
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
      autofillPreview: buildPccSetupAutofillPreview(detail, false),
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      // Setup repair and milestone action menus are intentionally advanced
      // controls. Exercise them in Detailed mode, where they are available.
      viewMode: "detailed" as const,
      ...handlers,
    };

    render(renderPccDashboard(props), root);
    const text = root.textContent ?? "";
    for (const label of [
      "Setup needs a few answers",
      "Fill missing setup with AI",
      "AI Autofill Preview",
      "Apply draft",
      "Approve this setup after applying",
      "Remove from active plan",
      "Milestone Journey",
      "Simple",
    ]) {
      requireText(text, label);
    }
    requireSelector(root, "[data-pcc-setup-repair]");
    requireSelector(root, "[data-pcc-autofill-preview]");
    requireSelector(root, "[data-pcc-action-menu]");
    requireSelector(root, "[data-pcc-submilestone-action-menu]");

    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Fill missing setup with AI"))
      ?.click();
    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Cancel"))
      ?.click();
    root.querySelector<HTMLInputElement>(".pcc-autofill-preview__approval input")?.click();
    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Apply draft"))
      ?.click();

    const actionMenus = [...root.querySelectorAll<HTMLElement>("[data-pcc-action-menu]")];
    const milestoneMenu = actionMenus[0];
    if (!milestoneMenu) {
      throw new Error("missing milestone action menu");
    }
    milestoneMenu.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.click();
    if (!milestoneMenu.classList.contains("is-open")) {
      throw new Error("milestone action menu did not open on click");
    }
    clickMenuButton(milestoneMenu, "Skip", true);
    milestoneMenu.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.click();
    clickMenuButton(milestoneMenu, "Remove from active plan", true);
    const subMenu = root.querySelector<HTMLElement>("[data-pcc-submilestone-action-menu]")!;
    subMenu.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")!.click();
    if (!subMenu.classList.contains("is-open")) {
      throw new Error("sub-milestone action menu did not open on click");
    }
    clickMenuButton(subMenu, "Skip", true);
    subMenu.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")!.click();
    clickMenuButton(subMenu, "Reopen");

    for (const expected of [
      "preview-autofill",
      "cancel-autofill",
      "approve-autofill",
      "apply-autofill",
    ]) {
      if (!calls.some((call) => call.action === expected)) {
        throw new Error(`missing handler call: ${expected}`);
      }
    }
    if (
      !calls.some(
        (call) => call.action === "milestone-status" && call.status === "skipped" && call.note,
      )
    ) {
      throw new Error("milestone skip did not include note");
    }
    if (
      !calls.some(
        (call) => call.action === "milestone-status" && call.status === "archived" && call.note,
      )
    ) {
      throw new Error("milestone remove-from-plan did not archive with note");
    }
    if (
      !calls.some((call) => call.action === "sub-status" && call.status === "skipped" && call.note)
    ) {
      throw new Error("sub-milestone skip did not include note");
    }
    if (!calls.some((call) => call.action === "sub-status" && call.status === "not_started")) {
      throw new Error("sub-milestone reopen did not restore not_started");
    }

    writeFileSync(join(artifactDir, "pcc-autofill-skip.html"), root.innerHTML);
    writeFileSync(join(artifactDir, "pcc-autofill-skip.json"), JSON.stringify({ calls }, null, 2));
    console.log(JSON.stringify({ ok: true, artifactDir, calls }, null, 2));
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
    globalThis.confirm = previous.confirm;
    globalThis.prompt = previous.prompt;
    dom.window.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

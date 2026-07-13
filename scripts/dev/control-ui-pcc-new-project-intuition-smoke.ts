import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import type { PccProjectFormState } from "../../ui/src/ui/controllers/pcc.ts";

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`PCC new-project intuition smoke missing selector: ${selector}`);
  }
  return found;
}

function requireText(root: ParentNode, selector: string, expected: string): void {
  const text = requireSelector(root, selector).textContent?.replace(/\s+/gu, " ").trim() ?? "";
  if (!text.includes(expected)) {
    throw new Error(`Expected ${selector} to include “${expected}”; received “${text}”`);
  }
}

async function main(): Promise<void> {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-new-project-intuition-smoke",
    new Date().toISOString().replace(/[:.]/gu, "-"),
  );
  mkdirSync(artifactDir, { recursive: true });
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
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
    const { EMPTY_PCC_DECISION_FORM, EMPTY_PCC_MILESTONE_FORM, EMPTY_PCC_PROJECT_FORM } =
      await import("../../ui/src/ui/controllers/pcc.ts");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }

    let projectForm: PccProjectFormState = {
      ...EMPTY_PCC_PROJECT_FORM,
      title: "My Kitchen Plan",
      projectDescription:
        "Plan a kitchen remodel without missing permits, inspections, or budget checks.",
      intakeAnswers: { owner: "Todd" },
    };
    const commonProps = {
      loading: false,
      error: null,
      connected: true,
      projects: [],
      portfolio: null,
      updatedAt: Date.now(),
      selectedProjectId: null,
      projectDetail: null,
      actionBusy: false,
      actionError: null,
      editorMode: "create-project" as const,
      milestoneForm: { ...EMPTY_PCC_MILESTONE_FORM },
      decisionFormOpen: false,
      decisionForm: { ...EMPTY_PCC_DECISION_FORM },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "simple" as const,
      onRefresh: () => undefined,
      onSelectProject: () => undefined,
      onOpenProjectEditor: () => undefined,
      onOpenMilestoneEditor: () => undefined,
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
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };
    const renderCurrent = () => {
      render(
        renderPccDashboard({
          ...commonProps,
          projectForm,
          onProjectFormChange: (patch) => {
            projectForm = { ...projectForm, ...patch };
            renderCurrent();
          },
        }),
        root,
      );
    };

    renderCurrent();
    requireText(root, "[data-pcc-create-ai-explainer]", "AI fills only the blanks");
    requireText(root, "[data-pcc-create-ai-explainer]", "Anything you type stays unchanged");
    requireText(root, "[data-pcc-ai-role-picker]", "Local AI");
    requireText(root, "[data-pcc-create-review-plan]", "Generate project plan");
    const customize = requireSelector(root, "[data-pcc-create-customize]");
    if (customize.hasAttribute("open")) {
      throw new Error("optional project customization must be collapsed by default");
    }

    requireSelector(root, '[data-pcc-ai-use-policy="codex_expert"]').dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    if (
      projectForm.aiUsePolicy !== "codex_expert" ||
      projectForm.plannerMode !== "codex" ||
      projectForm.codexPlanningAllowed
    ) {
      throw new Error("Codex expert preset did not configure permission-gated model routing");
    }
    requireText(root, "[data-pcc-ai-role-picker]", "Codex as expert");
    requireText(root, "[data-pcc-create-ai-summary]", "scoped approval");

    (requireSelector(root, "[data-pcc-create-review-plan]") as HTMLButtonElement).click();
    if (projectForm.title !== "My Kitchen Plan" || projectForm.intakeAnswers.owner !== "Todd") {
      throw new Error("AI review replaced user-entered project data");
    }
    requireText(root, "[data-pcc-create-review-ready]", "Your plan is ready to review");
    requireText(root, "[data-pcc-create-review-ready]", "Nothing has been created or started yet");
    requireSelector(root, "[data-pcc-plan-preview]");
    requireText(root, "[data-pcc-ai-routing-summary]", "Codex");
    const confirm = requireSelector(root, "[data-pcc-create-project-confirm]") as HTMLButtonElement;
    if (confirm.disabled) {
      throw new Error("reviewed project create action should be enabled");
    }

    writeFileSync(join(artifactDir, "dom.txt"), root.textContent ?? "");
    console.log("PCC_NEW_PROJECT_INTUITION_SMOKE_OK", artifactDir);
  } finally {
    if (previous.window === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previous.window;
    }
    if (previous.document === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = previous.document;
    }
    if (previous.HTMLElement === undefined) {
      delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    } else {
      (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    }
    if (previous.Node === undefined) {
      delete (globalThis as { Node?: unknown }).Node;
    } else {
      (globalThis as { Node?: unknown }).Node = previous.Node;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

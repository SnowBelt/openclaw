import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import type { PccProjectFormState } from "../../ui/src/ui/pcc/application/state.ts";

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
      modelCatalog: [
        {
          id: "qwen3.6",
          name: "Qwen 3.6",
          provider: "ollama",
          available: true,
          agentRuntime: { id: "openclaw", source: "model" as const },
        },
        {
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          provider: "openai",
          available: true,
          agentRuntime: { id: "codex", source: "model" as const },
        },
      ],
      executionCapacity: {
        logicalCpuCount: 16,
        performanceCpuCount: null,
        totalRamGb: 64,
        freeRamGb: 32,
        load1: 1,
        load5: 1,
        load15: 1,
        memoryPressure: "low" as const,
        activeOpenClawTaskCount: 0,
        configuredSubagentLimit: 8,
        observedLocalModelProcessCount: 0,
        safeLocalAgentSlots: 4,
        timestamp: "2026-07-13T00:00:00.000Z",
        warnings: [],
      },
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
          onGenerateProjectPlan: () => {
            projectForm = {
              ...projectForm,
              goal: projectForm.goal || "Complete a safe, permit-ready kitchen remodel plan.",
              outcomeMetrics:
                projectForm.outcomeMetrics ||
                "Permits, inspections, and budget checks are verified.",
              planningMode: "codex_full_plan",
              plannerMode: "codex",
              plannerModelId: "openai/gpt-5.6-sol",
              planPreviewAccepted: true,
              intakeApproved: true,
              intakeAnswers: {
                goal: "Complete a safe, permit-ready kitchen remodel plan.",
                firstDeliverable: "Approve the permit and inspection plan.",
                doneProof: "Every required check has receipt-backed proof.",
                constraints: "Stop before missing permissions or unavailable tools.",
                owner: "Codex plans; local OpenClaw agents execute.",
                blockers: "No known blockers.",
                ...projectForm.intakeAnswers,
              },
              generatedPlan: {
                schemaVersion: 1,
                title: "Kitchen Remodel Readiness",
                goal: "Complete a safe, permit-ready kitchen remodel plan.",
                outcomeMetrics: ["Permits, inspections, and budget checks are verified."],
                workflowTemplateId: "software-product",
                milestones: [
                  {
                    title: "Verify remodel requirements",
                    phaseId: "setup",
                    implementationPlan: "Verify permits, inspections, budget, and stop conditions.",
                    acceptanceCriteria: ["Every requirement has an owner and proof path."],
                    responsibility: "local_openclaw_agent",
                    proofLevel: "local",
                    dependencies: [],
                    subMilestones: [
                      {
                        title: "List permit requirements",
                        implementationPlan: "List and verify the applicable permit requirements.",
                        acceptanceCriteria: ["The permit list is reviewed."],
                        responsibility: "local_openclaw_agent",
                        proofLevel: "local",
                      },
                    ],
                  },
                ],
                risks: ["Permit requirements can change."],
                assumptions: ["The project address is available."],
                provenance: {
                  generatedAt: "2026-07-22T00:00:00.000Z",
                  provider: "openai",
                  model: "openai/gpt-5.6-sol",
                  runtime: "codex",
                  effort: "medium",
                  auth: "oauth",
                  source: "live_codex",
                  planningOnly: true,
                },
              },
            };
            renderCurrent();
          },
        }),
        root,
      );
    };

    renderCurrent();
    requireText(root, "[data-pcc-create-ai-explainer]", "Codex fills only the blanks");
    requireText(root, "[data-pcc-create-ai-explainer]", "Anything you type stays unchanged");
    requireText(root, "[data-pcc-ai-role-picker]", "How fast should OpenClaw work?");
    requireText(root, "[data-pcc-ai-role-picker]", "Focused");
    requireText(root, "[data-pcc-ai-role-picker]", "Parallel");
    requireText(root, "[data-pcc-ai-role-picker]", "Maximum Safe");
    requireText(root, "[data-pcc-ai-role-picker]", "When should Codex help after planning?");
    requireText(root, "[data-pcc-ai-role-picker]", "Recommended minimum");
    requireText(root, "[data-pcc-ai-role-picker]", "Local AI only");
    requireText(root, "[data-pcc-ai-role-picker]", "More Codex oversight");
    requireText(root, "[data-pcc-ai-role-picker]", "Custom");
    requireText(root, "[data-pcc-create-review-plan]", "Generate project plan");
    if (root.querySelector("[data-pcc-planner-selector]")) {
      throw new Error("new project flow must not expose a second planner policy selector");
    }
    if (root.querySelector("[data-pcc-ai-use-policy]")) {
      throw new Error("new project flow must not expose the retired AI routing policy selector");
    }
    const customize = requireSelector(root, "[data-pcc-create-customize]");
    if (customize.hasAttribute("open")) {
      throw new Error("optional project customization must be collapsed by default");
    }

    requireSelector(root, '[data-pcc-local-execution="ultra"]').dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    if (
      projectForm.executionProfile.speed !== "ultra" ||
      projectForm.executionProfile.codexPolicyId !== "local_only"
    ) {
      throw new Error("local speed changed the local-only default policy");
    }
    requireSelector(root, '[data-pcc-codex-policy="custom"]').dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );
    if (
      projectForm.executionProfile.speed !== "ultra" ||
      projectForm.executionProfile.codexPolicyId !== "custom"
    ) {
      throw new Error("Codex policy changed the independent local speed");
    }
    requireText(root, "[data-pcc-policy-terms]", "Automatic");
    requireText(root, "[data-pcc-policy-terms]", "Checkpoint");
    requireText(root, "[data-pcc-policy-terms]", "Effort");
    requireSelector(root, '[data-pcc-codex-checkpoint="material_replan"]');
    if (root.querySelector('[data-pcc-codex-checkpoint="initial_plan"]')) {
      throw new Error("initial planning must not be duplicated by the project checkpoint policy");
    }

    requireSelector(root, '[data-pcc-codex-policy="recommended_minimum"]').dispatchEvent(
      new dom.window.Event("change", { bubbles: true }),
    );

    (requireSelector(root, "[data-pcc-create-review-plan]") as HTMLButtonElement).click();
    if (projectForm.title !== "My Kitchen Plan" || projectForm.intakeAnswers.owner !== "Todd") {
      throw new Error("AI review replaced user-entered project data");
    }
    requireText(root, "[data-pcc-create-review-ready]", "Your plan is ready to review");
    requireText(root, "[data-pcc-create-review-ready]", "Nothing has been created or started yet");
    requireSelector(root, "[data-pcc-plan-preview]");
    requireText(root, "[data-pcc-ai-routing-summary]", "local");
    const confirm = requireSelector(root, "[data-pcc-create-project-confirm]") as HTMLButtonElement;
    if (confirm.disabled) {
      throw new Error(
        "reviewed project creation must remain available while later Codex checkpoints wait for approval",
      );
    }
    if (root.querySelectorAll("[data-pcc-planner-permission-card]").length !== 1) {
      throw new Error("project creation must render exactly one Codex permission card");
    }
    if (root.querySelector("[data-pcc-planner-permission-budget]")) {
      throw new Error("project creation must not expose a fabricated token budget");
    }
    (requireSelector(root, "[data-pcc-planner-permission-allow]") as HTMLButtonElement).click();
    if (!projectForm.codexPlanningAllowed) {
      throw new Error("single Codex permission approval did not persist in form state");
    }
    requireText(root, "[data-pcc-planner-permission-saved]", "no hard token cap");
    requireText(root, "[data-pcc-create-project-confirm]", "Create project");

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

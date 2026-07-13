import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import {
  DEFAULT_PCC_EXECUTION_PROFILE,
  resolvePccExecutionProfilePreset,
} from "../../src/pcc/execution-profile.js";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireText(text: string, label: string): void {
  if (!text.includes(label)) {
    throw new Error(`PCC workflow clarity smoke missing text: ${label}`);
  }
}

function requireSelector(root: ParentNode, selector: string): void {
  if (!root.querySelector(selector)) {
    throw new Error(`PCC workflow clarity smoke missing selector: ${selector}`);
  }
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-workflow-clarity-smoke", stamp());
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

    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }

    const now = "2026-07-01T00:00:00Z";
    const project = {
      id: "pcc-clarity-proof",
      title: "Project Command Center",
      goal: "Make every project easy to skim, run, pause, and verify.",
      status: "active" as const,
      priority: 5,
      phases: [
        { id: "setup", title: "Setup", order: 1, weight: 20 },
        { id: "proof", title: "Proof", order: 2, weight: 80 },
      ],
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccIntake: {
          approved: true,
          answers: {
            goal: "Make PCC Apple-simple.",
            firstDeliverable: "A clear workflow clarity proof view.",
            doneProof:
              "Local smoke, remote Workflow Sanity, runtime proof, and browser proof pass.",
            constraints:
              "No reboot, no project-specific SNES work, no unapproved external actions.",
            owner: "local_openclaw_agent",
            blockers: "None.",
          },
        },
        pccQualityGate: { status: "passing" },
        pccSetupScore: { score: 100, runnable: true },
        pccCompliance: { badge: "Passing", status: "passing" },
        pccWorkLoop: {
          enabled: true,
          state: "working",
          stopBeforeCodex: true,
          stopBeforeRemoteProof: true,
          stopAfterCurrentMilestone: false,
          continueAroundBlockers: true,
        },
      },
      createdAt: now,
      updatedAt: now,
    };
    const milestones = [
      {
        id: "milestone-1",
        projectId: project.id,
        title: "Workflow Clarity UI",
        status: "in_progress" as const,
        order: 1,
        percentComplete: 65,
        implementationPlan:
          "Simplify the default PCC hierarchy and hide advanced proof details by default.",
        acceptanceCriteria: [
          "Simple overview renders",
          "Detailed mode keeps proof surfaces available",
        ],
        metadata: {
          pccResponsibility: "local_openclaw_agent",
          pccProofLevel: "local",
          pccCostRisk: "low",
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "milestone-2",
        projectId: project.id,
        title: "Text-to-plan intake",
        status: "not_started" as const,
        order: 2,
        percentComplete: 0,
        implementationPlan:
          "Create draft milestones from the user's project description before writing the ledger.",
        acceptanceCriteria: ["Draft preview is visible", "User approval is required before save"],
        metadata: {
          pccResponsibility: "local_project_manager",
          pccProofLevel: "local",
          pccCostRisk: "low",
        },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const subMilestones = [
      {
        id: "sub-1",
        projectId: project.id,
        milestoneId: "milestone-1",
        title: "Render Today command overview",
        status: "complete" as const,
        order: 1,
        owner: "local_openclaw_agent",
        percentComplete: 100,
        implementationPlan:
          "Render Working Now, Needs You, Next Best Action, and Portfolio Progress at the top.",
        acceptanceCriteria: ["All four summary cards are visible"],
        metadata: {
          pccResponsibility: "local_openclaw_agent",
          pccProofLevel: "local",
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sub-2",
        projectId: project.id,
        milestoneId: "milestone-1",
        title: "Render milestone journey",
        status: "in_progress" as const,
        order: 2,
        owner: "local_openclaw_agent",
        percentComplete: 65,
        implementationPlan:
          "Show the ordered milestone sequence with details collapsed by default.",
        acceptanceCriteria: ["Journey exists", "Sub-milestone count is visible"],
        metadata: {
          pccResponsibility: "local_openclaw_agent",
          pccProofLevel: "local",
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sub-3",
        projectId: project.id,
        milestoneId: "milestone-2",
        title: "Preview generated project plan",
        status: "not_started" as const,
        order: 1,
        owner: "local_project_manager",
        percentComplete: 0,
        implementationPlan: "Render a generated plan preview before saving a text-first project.",
        acceptanceCriteria: ["Plan preview remains visible until the user approves or cancels"],
        metadata: {
          pccResponsibility: "local_project_manager",
          pccProofLevel: "local",
        },
        createdAt: now,
        updatedAt: now,
      },
    ];
    const summary = {
      id: project.id,
      title: project.title,
      status: "active" as const,
      percentComplete: 65,
      milestoneCounts: {
        total: 2,
        complete: 0,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: ["Review Workflow Clarity UI"],
      proofGaps: ["Remote proof pending"],
      updatedAt: now,
    };
    const handlers = {
      onSetViewMode: () => undefined,
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
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };
    const baseProps = {
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
        averagePercentComplete: 65,
        nextActions: ["Review Workflow Clarity UI"],
      },
      projects: [summary],
      selectedProjectId: project.id,
      projectDetail: {
        project,
        milestones,
        subMilestones,
        permissions: [],
        evidence: [],
        receipts: [],
        summary,
      },
      projectDetails: {
        [project.id]: {
          project,
          milestones,
          subMilestones,
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      },
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
        workflowTemplateId: "software-product",
        planningMode: "local_project_manager" as const,
        plannerMode: "local_project_manager" as const,
        plannerModelId: "",
        executionProfile: { ...DEFAULT_PCC_EXECUTION_PROFILE },
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
        responsibility: "local_openclaw_agent" as const,
        costRisk: "low" as const,
        stopHere: false,
      },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "simple" as const,
      ...handlers,
    };

    render(renderPccDashboard(baseProps), root);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const simpleText = root.textContent ?? "";
    for (const label of [
      "Working Now",
      "Needs You",
      "Next Best Action",
      "Portfolio Progress",
      "Project Snapshot",
      "Milestone Journey",
      "Work This Project",
      "Simple",
      "Detailed",
      "Agent",
      "Text-to-plan intake",
    ]) {
      requireText(simpleText, label);
    }
    requireSelector(root, "[data-pcc-today]");
    requireSelector(root, "[data-pcc-project-card]");
    requireSelector(root, "[data-pcc-journey-step]");
    if (root.querySelector("[data-pcc-agent-mode]")) {
      throw new Error("Simple mode exposed Agent-mode execution diagnostics by default");
    }

    render(
      renderPccDashboard({
        ...baseProps,
        editorMode: "create-project" as const,
        projectForm: {
          ...baseProps.projectForm,
          projectDescription:
            "Build a reusable dashboard that turns any project description into an ordered PCC plan.",
          plannerMode: "codex" as const,
          planningMode: "codex_full_plan" as const,
          aiUsePolicy: "codex_expert" as const,
          executionProfile: resolvePccExecutionProfilePreset("balanced"),
          title: "Reusable PCC Planner",
          goal: "Turn text into a safe, proof-gated project plan.",
          intakeAnswers: {
            goal: "Turn text into a safe, proof-gated project plan.",
            firstDeliverable: "Generated plan preview.",
            doneProof: "Smoke and browser proof pass.",
            constraints: "Do not spend Codex tokens without approval.",
            owner: "Codex",
            blockers: "Planner permission is required.",
          },
          intakeApproved: true,
          planPreviewAccepted: true,
          codexPlanningAllowed: false,
        },
      }),
      root,
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const editorText = root.textContent ?? "";
    for (const label of [
      "Your plan is ready to review",
      "How this project runs",
      "Generated plan preview",
      "One Codex permission",
      "Create project",
      "Fill remaining blanks",
      "Cancel",
    ]) {
      requireText(editorText, label);
    }
    requireSelector(root, "[data-pcc-project-description]");
    requireSelector(root, "[data-pcc-planner-model]");
    if (root.querySelector("[data-pcc-planner-selector]")) {
      throw new Error("new project review exposed a conflicting planner policy selector");
    }
    requireSelector(root, "[data-pcc-plan-preview]");
    requireSelector(root, "[data-pcc-codex-planning-gate]");

    const summaryOut = {
      ok: true,
      artifactDir,
      html: join(artifactDir, "pcc-workflow-clarity.html"),
      checks: {
        today: true,
        skimmableCards: true,
        selectedProjectWorkflow: true,
        textFirstIntake: true,
        plannerGate: true,
      },
    };
    writeFileSync(summaryOut.html, dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summaryOut, null, 2));
    console.log(JSON.stringify(summaryOut, null, 2));
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

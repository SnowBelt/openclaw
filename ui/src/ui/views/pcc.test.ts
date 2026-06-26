/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PCC_MILESTONE_FORM, EMPTY_PCC_PROJECT_FORM } from "../controllers/pcc.ts";
import { renderPccDashboard, type PccDashboardProps } from "./pcc.ts";

const project = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Track every project",
  status: "active" as const,
  priority: 3,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const milestone = {
  id: "milestone-1",
  projectId: "project-1",
  title: "CRUD UI",
  status: "in_progress" as const,
  order: 1,
  percentComplete: 42,
  implementationPlan: "Build compact forms",
  acceptanceCriteria: ["Local proof passes"],
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const permission = {
  id: "permission-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  type: "remote_proof" as const,
  status: "needed" as const,
  riskLevel: "medium" as const,
  allowedActions: ["push branch", "run Workflow Sanity"],
  forbiddenActions: ["merge upstream"],
  target: "SnowBelt/openclaw",
  usedCount: 0,
  auditLog: [],
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const evidence = {
  id: "evidence-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  kind: "local_test" as const,
  status: "passed" as const,
  summary: "Local PCC proof passed",
  command: "pnpm test ui/src/ui/views/pcc.test.ts",
  exitCode: 0,
  createdAt: "2026-06-26T00:00:00Z",
};

const receipt = {
  id: "receipt-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  summary: "CRUD UI completed with local proof.",
  proofEvidenceIds: ["evidence-1"],
  proofLevel: "local" as const,
  doNotRedo: ["Do not redo the local proof without a regression."],
  followUpGaps: ["Remote proof remains blocked"],
  completedBy: "Project Command Center",
  completedAt: "2026-06-26T00:00:00Z",
};

const summary = {
  id: "project-1",
  title: "Project Command Center",
  status: "needs_approval" as const,
  percentComplete: 42,
  milestoneCounts: {
    total: 5,
    complete: 2,
    blocked: 0,
    needsApproval: 1,
    deferred: 0,
    skipped: 0,
  },
  nextActions: ["Run remote proof"],
  proofGaps: ["Workflow Sanity proof"],
  updatedAt: "2026-06-26T00:00:00Z",
};

function createProps(overrides: Partial<PccDashboardProps> = {}): PccDashboardProps {
  return {
    loading: false,
    error: null,
    updatedAt: 1_772_000_000_000,
    portfolio: {
      projectsTotal: 1,
      active: 1,
      blocked: 0,
      needsApproval: 1,
      complete: 0,
      archived: 0,
      averagePercentComplete: 42,
      nextActions: ["Run remote proof"],
    },
    projects: [summary],
    selectedProjectId: "project-1",
    projectDetail: {
      project,
      milestones: [milestone],
      permissions: [permission],
      evidence: [],
      receipts: [],
      summary,
    },
    actionBusy: false,
    actionError: null,
    editorMode: null,
    projectForm: { ...EMPTY_PCC_PROJECT_FORM },
    milestoneForm: { ...EMPTY_PCC_MILESTONE_FORM, projectId: "project-1" },
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
    ...overrides,
  };
}

function renderView(props: PccDashboardProps): HTMLElement {
  const container = document.createElement("div");
  render(renderPccDashboard(props), container);
  return container;
}

afterEach(() => {
  render(html``, document.body);
  vi.restoreAllMocks();
});

describe("renderPccDashboard", () => {
  it("renders summary metrics, project cards, and detail", () => {
    const container = renderView(createProps());
    const text = container.textContent ?? "";

    expect(text).toContain("Project Command Center");
    expect(text).toContain("Total projects");
    expect(text).toContain("Average completion");
    expect(text).toContain("42% complete");
    expect(text).toContain("Run remote proof");
    expect(text).toContain("Workflow Sanity proof");
    expect(text).toContain("CRUD UI");
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-milestone]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-permission]")).toHaveLength(1);
    expect(text).toContain("Permission needed");
    expect(text).toContain("Remote Proof");
  });

  it("renders an empty state", () => {
    const container = renderView(
      createProps({
        projects: [],
        selectedProjectId: null,
        projectDetail: null,
        portfolio: {
          projectsTotal: 0,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 0,
          nextActions: [],
        },
      }),
    );

    expect(container.textContent).toContain("No projects yet");
    expect(container.querySelector("[data-pcc-empty]")).not.toBeNull();
    expect(container.textContent).toContain("Select a project");
  });

  it("renders an error state and keeps refresh usable", () => {
    const onRefresh = vi.fn();
    const container = renderView(createProps({ error: "gateway offline", onRefresh }));

    expect(container.textContent).toContain("Project Command Center unavailable");
    expect(container.textContent).toContain("gateway offline");
    const refresh = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Refresh"),
    );
    refresh?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("opens project selection and project editor actions", () => {
    const onSelectProject = vi.fn();
    const onOpenProjectEditor = vi.fn();
    const container = renderView(createProps({ onSelectProject, onOpenProjectEditor }));

    container.querySelector<HTMLButtonElement>("[data-pcc-project-card] button")?.click();
    expect(onSelectProject).toHaveBeenCalledWith("project-1");

    const edit = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Edit project"),
    );
    edit?.click();
    expect(onOpenProjectEditor).toHaveBeenCalledWith(project);
  });

  it("renders phase templates and weighted phase progress", () => {
    const container = renderView(
      createProps({
        projectDetail: {
          project: {
            ...project,
            phases: [
              { id: "setup", title: "Setup", weight: 10, order: 0 },
              { id: "mvp", title: "MVP", weight: 90, order: 1 },
            ],
          },
          milestones: [
            { ...milestone, phaseId: "setup", percentComplete: 70 },
            {
              ...milestone,
              id: "milestone-mvp",
              title: "MVP finish",
              phaseId: "mvp",
              percentComplete: 20,
            },
          ],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    expect(container.querySelectorAll("[data-pcc-phases]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-phase]")).toHaveLength(2);
    expect(container.textContent).toContain("Setup");
    expect(container.textContent).toContain("MVP");
    expect(container.textContent).toContain("10% weight");
    expect(container.textContent).toContain("70%");
  });

  it("renders completion receipts, evidence, and add receipt action", () => {
    const onAddCompletionReceipt = vi.fn();
    const container = renderView(
      createProps({
        onAddCompletionReceipt,
        projectDetail: {
          project,
          milestones: [{ ...milestone, status: "proof_pending" }],
          permissions: [],
          evidence: [evidence],
          receipts: [receipt],
          summary,
        },
      }),
    );

    expect(container.querySelectorAll("[data-pcc-receipt]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pcc-evidence-list]")).toHaveLength(1);
    expect(container.textContent).toContain("Completion receipt");
    expect(container.textContent).toContain("Do not redo");
    expect(container.textContent).toContain("Local PCC proof passed");

    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add receipt"),
    );
    expect(add?.disabled).toBe(true);
  });

  it("enables Add receipt only when passed evidence exists and no receipt is recorded", () => {
    const onAddCompletionReceipt = vi.fn();
    const container = renderView(
      createProps({
        onAddCompletionReceipt,
        projectDetail: {
          project,
          milestones: [{ ...milestone, status: "proof_pending" }],
          permissions: [],
          evidence: [evidence],
          receipts: [],
          summary,
        },
      }),
    );
    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Add receipt"),
    );
    expect(add?.disabled).toBe(false);
    add?.click();
    expect(onAddCompletionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "milestone-1" }),
    );
  });

  it("renders permission decisions and calls the decision handler", () => {
    const onSetPermissionStatus = vi.fn();
    const container = renderView(createProps({ onSetPermissionStatus }));

    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-pcc-permission] button"),
    ];
    buttons.find((button) => button.textContent?.includes("Grant"))?.click();
    buttons.find((button) => button.textContent?.includes("Defer"))?.click();
    buttons.find((button) => button.textContent?.includes("Deny"))?.click();

    expect(onSetPermissionStatus).toHaveBeenNthCalledWith(1, permission, "granted");
    expect(onSetPermissionStatus).toHaveBeenNthCalledWith(2, permission, "needed");
    expect(onSetPermissionStatus).toHaveBeenNthCalledWith(3, permission, "denied");
  });

  it("renders guided work loop controls and task prompt preview", () => {
    const onUpdateWorkLoop = vi.fn();
    const onPrepareNextWorkItem = vi.fn();
    const container = renderView(
      createProps({
        onUpdateWorkLoop,
        onPrepareNextWorkItem,
        projectDetail: {
          project: {
            ...project,
            metadata: {
              pccWorkLoop: {
                enabled: true,
                state: "working",
                stopBeforeCodex: true,
                stopBeforeRemoteProof: true,
                stopAfterCurrentMilestone: false,
              },
            },
          },
          milestones: [milestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
      }),
    );

    expect(container.textContent).toContain("Work This Project");
    expect(container.textContent).toContain("Stop before Codex");
    expect(container.textContent).toContain("Stop before remote proof");
    expect(container.textContent).toContain("Task prompt preview");
    const prepare = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Prepare next safe task"),
    );
    prepare?.click();
    expect(onPrepareNextWorkItem).toHaveBeenCalledTimes(1);
  });

  it("renders project editor and saves form changes", () => {
    const onProjectFormChange = vi.fn();
    const onSaveProject = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-project",
        projectForm: { id: null, title: "New PCC", goal: "", status: "active", priority: "4" },
        onProjectFormChange,
        onSaveProject,
      }),
    );

    expect(container.querySelector('[data-pcc-editor="project"]')).not.toBeNull();
    container
      .querySelector<HTMLInputElement>("input[required]")
      ?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container
      .querySelector<HTMLFormElement>("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onProjectFormChange).toHaveBeenCalled();
    expect(onSaveProject).toHaveBeenCalledTimes(1);
  });

  it("renders responsibility routing labels and editor controls", () => {
    const onMilestoneFormChange = vi.fn();
    const container = renderView(
      createProps({
        onMilestoneFormChange,
        projectDetail: {
          project,
          milestones: [
            {
              ...milestone,
              metadata: { pccResponsibility: "high_reasoning_codex", pccCostRisk: "high" },
            },
          ],
          permissions: [],
          evidence: [],
          receipts: [],
          summary,
        },
        editorMode: "edit-milestone",
        milestoneForm: {
          ...EMPTY_PCC_MILESTONE_FORM,
          id: "milestone-1",
          projectId: "project-1",
          title: "CRUD UI",
          responsibility: "high_reasoning_codex",
          costRisk: "high",
        },
      }),
    );

    expect(container.textContent).toContain("Worker High-reasoning Codex");
    expect(container.textContent).toContain("Risk High");
    expect(container.textContent).toContain("Token/cost risk");
    const selects = [...container.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects.some((select) => select.value === "high_reasoning_codex")).toBe(true);
    expect(selects.some((select) => select.value === "high")).toBe(true);
  });

  it("renders milestone editor and status actions", () => {
    const onMilestoneFormChange = vi.fn();
    const onSaveMilestone = vi.fn();
    const onSetMilestoneStatus = vi.fn();
    const container = renderView(
      createProps({
        editorMode: "create-milestone",
        milestoneForm: {
          ...EMPTY_PCC_MILESTONE_FORM,
          projectId: "project-1",
          title: "Remote proof",
        },
        onMilestoneFormChange,
        onSaveMilestone,
        onSetMilestoneStatus,
      }),
    );

    expect(container.querySelector('[data-pcc-editor="milestone"]')).not.toBeNull();
    container
      .querySelector<HTMLTextAreaElement>("textarea")
      ?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container
      .querySelector<HTMLFormElement>("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onMilestoneFormChange).toHaveBeenCalled();
    expect(onSaveMilestone).toHaveBeenCalledTimes(1);

    const defer = [
      ...container.querySelectorAll<HTMLButtonElement>(".pcc-milestone__actions button"),
    ].find((button) => button.textContent?.includes("Defer"));
    defer?.click();
    expect(onSetMilestoneStatus).toHaveBeenCalledWith(milestone, "deferred");
  });
});

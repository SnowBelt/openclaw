import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-crud-smoke", timestampSlug());
  mkdirSync(artifactDir, { recursive: true });
  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, { url: "http://127.0.0.1/pcc" });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
    MouseEvent: (globalThis as { MouseEvent?: unknown }).MouseEvent,
    InputEvent: (globalThis as { InputEvent?: unknown }).InputEvent,
    confirm: (globalThis as { confirm?: unknown }).confirm,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  (globalThis as { MouseEvent?: unknown }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { InputEvent?: unknown }).InputEvent = dom.window.InputEvent;
  (globalThis as { confirm?: unknown }).confirm = () => true;
  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing root");
    }
    const calls: string[] = [];
    const project = {
      id: "pcc",
      title: "Project Command Center",
      goal: "Track work",
      status: "active" as const,
      priority: 3,
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    const milestone = {
      id: "milestone-crud",
      projectId: "pcc",
      title: "CRUD UI",
      status: "in_progress" as const,
      order: 1,
      percentComplete: 58,
      implementationPlan: "Build compact forms",
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    };
    render(
      renderPccDashboard({
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
          averagePercentComplete: 58,
          nextActions: ["Create CRUD"],
        },
        projects: [
          {
            id: "pcc",
            title: "Project Command Center",
            status: "active",
            percentComplete: 58,
            milestoneCounts: {
              total: 1,
              complete: 0,
              blocked: 0,
              needsApproval: 0,
              deferred: 0,
              skipped: 0,
            },
            nextActions: ["Create CRUD"],
            proofGaps: ["Remote proof"],
            updatedAt: "2026-06-26T00:00:00Z",
          },
        ],
        selectedProjectId: "pcc",
        projectDetail: {
          project,
          milestones: [milestone],
          permissions: [],
          evidence: [],
          receipts: [],
          summary: {
            id: "pcc",
            title: "Project Command Center",
            status: "active",
            percentComplete: 58,
            milestoneCounts: {
              total: 1,
              complete: 0,
              blocked: 0,
              needsApproval: 0,
              deferred: 0,
              skipped: 0,
            },
            nextActions: ["Create CRUD"],
            proofGaps: ["Remote proof"],
            updatedAt: "2026-06-26T00:00:00Z",
          },
        },
        actionBusy: false,
        actionError: null,
        editorMode: "create-milestone",
        projectForm: { id: null, title: "", goal: "", status: "active", priority: "3" },
        milestoneForm: {
          id: null,
          projectId: "pcc",
          title: "New milestone",
          status: "not_started",
          phaseId: "",
          order: "",
          percentComplete: "",
          blocker: "",
          implementationPlan: "",
          acceptanceCriteria: "",
        },
        onRefresh: () => calls.push("refresh"),
        onSelectProject: (id) => calls.push(`select:${id}`),
        onOpenProjectEditor: () => calls.push("edit-project"),
        onOpenMilestoneEditor: () => calls.push("edit-milestone"),
        onProjectFormChange: () => calls.push("project-change"),
        onMilestoneFormChange: () => calls.push("milestone-change"),
        onSaveProject: () => calls.push("save-project"),
        onSaveMilestone: () => calls.push("save-milestone"),
        onCancelEditor: () => calls.push("cancel"),
        onSetProjectStatus: (_project, status) => calls.push(`project-status:${status}`),
        onSetMilestoneStatus: (_milestone, status) => calls.push(`milestone-status:${status}`),
        onAddCompletionReceipt: () => calls.push("add-receipt"),
        onSetPermissionStatus: (_permission, status) => calls.push(`permission-status:${status}`),
        onUpdateWorkLoop: () => calls.push("work-loop-update"),
        onPrepareNextWorkItem: () => calls.push("work-loop-next"),
      }),
      root,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    root
      .querySelector("[data-pcc-project-card] button")
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Edit project"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Archive"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Defer"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    root
      .querySelector("form")
      ?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    const text = root.textContent ?? "";
    const checks = {
      shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
      projectCard: root.querySelectorAll("[data-pcc-project-card]").length === 1,
      detail: root.querySelectorAll("[data-pcc-detail]").length === 1,
      milestone: root.querySelectorAll("[data-pcc-milestone]").length === 1,
      editor: root.querySelectorAll('[data-pcc-editor="milestone"]').length === 1,
      text: text.includes("New milestone") && text.includes("Archive") && text.includes("CRUD UI"),
      callbacks: [
        "select:pcc",
        "edit-project",
        "project-status:archived",
        "milestone-status:deferred",
        "save-milestone",
      ].every((call) => calls.includes(call)),
    };
    const summary = {
      artifactDir,
      ok: Object.values(checks).every(Boolean),
      checks,
      calls,
      html: join(artifactDir, "pcc-crud.html"),
    };
    writeFileSync(summary.html, dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exit(1);
    }
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
    (globalThis as { MouseEvent?: unknown }).MouseEvent = previous.MouseEvent;
    (globalThis as { InputEvent?: unknown }).InputEvent = previous.InputEvent;
    (globalThis as { confirm?: unknown }).confirm = previous.confirm;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

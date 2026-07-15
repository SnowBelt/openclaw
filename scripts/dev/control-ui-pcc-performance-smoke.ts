import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const PROJECT_COUNT = 600;
const CACHED_DETAIL_COUNT = 80;
const MILESTONES_PER_DETAIL = 24;
const PERFORMANCE_BUDGETS = {
  templateP95Ms: 40,
  initialDomMs: 900,
  rerenderP95Ms: 75,
  searchDomMs: 200,
  heapDeltaMb: 120,
} as const;

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function timed<T>(run: () => T): { value: T; elapsedMs: number } {
  const startedAt = performance.now();
  const value = run();
  return { value, elapsedMs: performance.now() - startedAt };
}

function collectGarbageForStableHeapMeasurement(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-pcc-performance-smoke", stamp());
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
      throw new Error("missing performance smoke root");
    }
    const now = "2026-07-15T12:00:00.000Z";
    const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => ({
      id: `performance-project-${index}`,
      title: `Performance Project ${index}`,
      status: index % 23 === 0 ? ("blocked" as const) : ("active" as const),
      percentComplete: index % 101,
      milestoneCounts: {
        total: MILESTONES_PER_DETAIL,
        complete: index % MILESTONES_PER_DETAIL,
        blocked: index % 23 === 0 ? 1 : 0,
        needsApproval: index % 37 === 0 ? 1 : 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: [`Complete performance action ${index}`],
      proofGaps: index % 41 === 0 ? [`Proof gap ${index}`] : [],
      health: index % 29 === 0 ? "At risk" : "On track",
      recentActivity: `Performance update ${index}`,
      updatedAt: now,
    }));
    const details = Object.fromEntries(
      projects.slice(0, CACHED_DETAIL_COUNT).map((summary, projectIndex) => {
        const project = {
          id: summary.id,
          title: summary.title,
          goal: `Scale ${summary.title} without changing behavior.`,
          status: summary.status,
          priority: 3,
          metadata: { pccWorkScope: "project_work" },
          createdAt: now,
          updatedAt: now,
        };
        const milestones = Array.from({ length: MILESTONES_PER_DETAIL }, (_, index) => ({
          id: `${project.id}-milestone-${index}`,
          projectId: project.id,
          title: `Milestone ${projectIndex}-${index}`,
          status: index < 8 ? ("complete" as const) : ("not_started" as const),
          order: index * 10,
          percentComplete: index < 8 ? 100 : 0,
          implementationPlan: `Execute milestone ${index}.`,
          acceptanceCriteria: [`Milestone ${index} is verified.`],
          metadata: {
            pccResponsibility: "local_openclaw_agent",
            pccProofLevel: "local",
          },
          createdAt: now,
          updatedAt: now,
        }));
        return [
          project.id,
          {
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
        ];
      }),
    );
    const selectedDetail = details[projects[0]?.id ?? ""];
    if (!selectedDetail) {
      throw new Error("missing selected performance project");
    }
    const props = {
      loading: false,
      error: null,
      connected: true,
      projects,
      portfolio: {
        projectsTotal: projects.length,
        active: projects.length,
        blocked: projects.filter((project) => project.status === "blocked").length,
        needsApproval: 0,
        needsAttention: 0,
        complete: 0,
        archived: 0,
        averagePercentComplete: 50,
        nextActions: [],
      },
      updatedAt: Date.parse(now),
      selectedProjectId: selectedDetail.project.id,
      projectDetail: selectedDetail,
      projectDetails: details,
      actionBusy: false,
      actionError: null,
      actionNotice: null,
      projectFilter: "active" as const,
      projectSearchQuery: "",
      projectEditMode: "simple" as const,
      editorMode: null,
      projectForm: {},
      milestoneForm: {},
      decisionFormOpen: false,
      decisionForm: {},
      autofillPreview: null,
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      viewMode: "simple" as const,
      productFocusMode: "project_work" as const,
      reorderMode: false,
      agentsList: null,
      modelCatalog: [],
      modelsLoading: false,
      modelsLastRefreshedAt: null,
      modelsFallback: false,
      runtimeIdentity: null,
      executionCapacity: null,
      skillsReport: null,
      skillsError: "Performance fixture omits live skills.",
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
      onUpdateWorkLoop: () => undefined,
      onPrepareNextWorkItem: () => undefined,
      onSetProjectFilter: () => undefined,
      onSetProjectSearchQuery: () => undefined,
      onSetViewMode: () => undefined,
      onSetProductFocusMode: () => undefined,
      onSetReorderMode: () => undefined,
      onConfigureAutopilotMode: () => undefined,
      onGenerateAutopilotPrompts: () => undefined,
      onUpdateAutopilotPrompt: () => undefined,
      onRunAutopilotAction: () => undefined,
      onChatSyncTextChange: () => undefined,
      onPreviewChatSync: () => undefined,
      onApplyChatSyncProposal: () => undefined,
      onDismissChatSync: () => undefined,
    };

    collectGarbageForStableHeapMeasurement();
    const heapBefore = process.memoryUsage().heapUsed;
    const templateTimes = Array.from(
      { length: 20 },
      () => timed(() => renderPccDashboard(props as never)).elapsedMs,
    );
    const initial = timed(() => render(renderPccDashboard(props as never), root));
    if (root.querySelectorAll("[data-pcc-project-open-surface='card']").length !== PROJECT_COUNT) {
      throw new Error("large portfolio did not render every project card");
    }
    const rerenderTimes = Array.from(
      { length: 8 },
      () => timed(() => render(renderPccDashboard(props as never), root)).elapsedMs,
    );
    const search = timed(() =>
      render(
        renderPccDashboard({ ...props, projectSearchQuery: "Performance Project 599" } as never),
        root,
      ),
    );
    collectGarbageForStableHeapMeasurement();
    const heapAfter = process.memoryUsage().heapUsed;
    const metrics = {
      projectCount: PROJECT_COUNT,
      cachedDetailCount: CACHED_DETAIL_COUNT,
      milestonesPerDetail: MILESTONES_PER_DETAIL,
      templateP50Ms: Number(percentile(templateTimes, 0.5).toFixed(2)),
      templateP95Ms: Number(percentile(templateTimes, 0.95).toFixed(2)),
      initialDomMs: Number(initial.elapsedMs.toFixed(2)),
      rerenderP50Ms: Number(percentile(rerenderTimes, 0.5).toFixed(2)),
      rerenderP95Ms: Number(percentile(rerenderTimes, 0.95).toFixed(2)),
      searchDomMs: Number(search.elapsedMs.toFixed(2)),
      heapDeltaMb: Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)),
    };
    const violations = Object.entries(PERFORMANCE_BUDGETS)
      .filter(([metric, limit]) => metrics[metric as keyof typeof PERFORMANCE_BUDGETS] > limit)
      .map(
        ([metric, limit]) =>
          `${metric}=${metrics[metric as keyof typeof PERFORMANCE_BUDGETS]} exceeds ${limit}`,
      );
    writeFileSync(
      join(artifactDir, "result.json"),
      `${JSON.stringify({ metrics, budgets: PERFORMANCE_BUDGETS, violations }, null, 2)}\n`,
    );
    if (violations.length > 0) {
      throw new Error(`PCC performance budget failed: ${violations.join("; ")}`);
    }
    console.log("PCC_PERFORMANCE_SMOKE_OK", JSON.stringify(metrics));
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
  }
}

await main();

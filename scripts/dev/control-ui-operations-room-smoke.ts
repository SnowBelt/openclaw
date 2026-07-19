import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import type { OperationsSnapshot } from "../../src/operations/types.js";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireSelector(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`Operations Room smoke missing selector: ${selector}`);
  }
  return found;
}

function snapshot(now: number): OperationsSnapshot {
  return {
    schema: "openclaw.operations-room.v1",
    generatedAt: now,
    qualityTarget: 93,
    qualityScore: 96,
    overallStatus: "degraded",
    summary: {
      agents: 2,
      workingAgents: 1,
      attentionAgents: 0,
      tasks: 1,
      activeTasks: 1,
      failedTasks: 0,
      workflows: 1,
      activeWorkflows: 1,
      cronJobs: 1,
      failingCronJobs: 0,
      plugins: 1,
      skills: 1,
      tools: 1,
      models: 2,
      findings: 1,
      criticalFindings: 0,
    },
    host: {
      hostname: "studio",
      platform: "darwin",
      arch: "arm64",
      uptimeMs: 10_000,
      logicalCpuCount: 12,
      loadAverage: [1, 1, 1],
      totalMemoryBytes: 64 * 1024 ** 3,
      freeMemoryBytes: 24 * 1024 ** 3,
      availableMemoryBytes: 28 * 1024 ** 3,
      usedMemoryBytes: 36 * 1024 ** 3,
      memoryUsedPercent: 56.3,
      memoryAvailabilitySource: "macos_memory_pressure",
      processRssBytes: 256 * 1024 ** 2,
      processHeapUsedBytes: 80 * 1024 ** 2,
      processHeapTotalBytes: 160 * 1024 ** 2,
      eventLoopLagMs: 4,
      status: "healthy",
    },
    agents: [
      {
        id: "main",
        name: "Control Director",
        workspace: "/workspace",
        duty: "always_on",
        status: "working",
        model: "ollama/gemma",
        fallbackModels: ["ollama/qwen"],
        activeTaskCount: 1,
        blockedTaskCount: 0,
        latestTask: "Run Operations Room proof",
        latestActivityAt: now,
        heartbeat: { enabled: true, every: "30m", everyMs: 1_800_000, target: "last" },
        memoryBytes: null,
        memoryAttribution: "unavailable",
      },
      {
        id: "writer",
        name: "Writer",
        workspace: "/workspace/writer",
        duty: "on_demand",
        status: "idle",
        fallbackModels: [],
        activeTaskCount: 0,
        blockedTaskCount: 0,
        heartbeat: { enabled: false, every: "off", everyMs: null, target: "none" },
        memoryBytes: null,
        memoryAttribution: "unavailable",
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Run Operations Room proof",
        runtime: "subagent",
        agentId: "main",
        status: "working",
        sourceStatus: "running",
        progress: "Desktop and mobile smoke",
        updatedAt: now,
      },
    ],
    workflows: [
      {
        id: "flow-1",
        title: "Operations Room V1",
        ownerKey: "agent:main:main",
        status: "working",
        sourceStatus: "running",
        currentStep: "Browser proof",
        activeTaskCount: 1,
        failedTaskCount: 0,
        updatedAt: now,
      },
    ],
    cronJobs: [
      {
        id: "cron-1",
        name: "Reliability sweep",
        duty: "scheduled",
        status: "healthy",
        enabled: true,
        running: false,
        nextRunAt: now + 60_000,
        consecutiveErrors: 0,
      },
    ],
    skills: [
      {
        id: "testing",
        name: "Testing",
        kind: "skill",
        status: "healthy",
        configured: true,
        active: true,
      },
    ],
    plugins: [
      {
        id: "apps",
        name: "Apps",
        kind: "plugin",
        status: "healthy",
        configured: true,
        active: true,
      },
    ],
    tools: [
      { id: "exec", name: "Exec", kind: "tool", status: "healthy", configured: true, active: true },
    ],
    models: [
      {
        id: "ollama/gemma",
        name: "Gemma",
        kind: "model",
        status: "healthy",
        configured: true,
        active: null,
        route: "local",
      },
      {
        id: "openai/gpt",
        name: "GPT",
        kind: "model",
        status: "unknown",
        configured: true,
        active: null,
        route: "metered",
      },
    ],
    processes: [
      {
        pid: 42,
        parentPid: 1,
        command: "node",
        rssBytes: 256 * 1024 ** 2,
        cpuPercent: 2.1,
        kind: "gateway",
      },
    ],
    findings: [
      {
        id: "skill:requirements:blocked",
        severity: "warning",
        category: "skill",
        title: "One skill needs requirements",
        detail: "Only install requirements for active work.",
        recommendedAction: "Open Skills.",
        lastObservedAt: now,
      },
    ],
    reconciler: {
      mode: "shadow",
      autoRemediationEnabled: false,
      intervalMs: 60_000,
      lastSweepAt: now,
      nextSweepAt: now + 60_000,
      recommendedActionCount: 1,
      ruleCount: 9,
      note: "Deterministic shadow monitor active.",
    },
    controls: {
      mode: "guarded",
      previewRequired: true,
      supportedActions: ["cron.run", "cron.disable", "flow.cancel"],
      note: "Confirmation required.",
    },
  };
}

async function main(): Promise<void> {
  const artifactDir = join(".artifacts", "control-ui-operations-room-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });
  const css = readFileSync("ui/src/styles/operations.css", "utf8");
  if (!css.includes("@media (max-width: 560px)")) {
    throw new Error("Operations Room responsive CSS contract is missing");
  }

  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, {
    url: "http://127.0.0.1/operations",
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
    const style = dom.window.document.createElement("style");
    style.textContent = css;
    dom.window.document.head.append(style);
    const rules = Array.from(style.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule => "selectorText" in rule,
    );
    for (const selector of [
      ".operations-hero__actions .btn",
      ".operations-row-actions .btn",
      ".operations-list__aside .btn",
    ]) {
      const rule = rules.find((entry) =>
        entry.selectorText
          .split(",")
          .map((value) => value.trim())
          .includes(selector),
      );
      if (rule?.style.minHeight !== "44px" || rule.style.minWidth !== "44px") {
        throw new Error(`Operations Room touch target contract failed: ${selector}`);
      }
    }

    const { render } = await import("lit");
    const { tabFromPath, pathForTab } = await import("../../ui/src/ui/navigation.ts");
    const { renderOperations } = await import("../../ui/src/ui/views/operations.ts");
    if (tabFromPath("/operations") !== "operations" || pathForTab("operations") !== "/operations") {
      throw new Error("Operations Room route contract failed");
    }
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing smoke root");
    }
    render(
      renderOperations({
        loading: false,
        actionBusy: false,
        error: null,
        actionNotice: null,
        snapshot: snapshot(Date.now()),
        updatedAt: Date.now(),
        onRefresh: () => undefined,
        onAction: () => undefined,
      }),
      root,
    );
    await Promise.resolve();

    for (const selector of [
      ".operations-room",
      ".operations-score",
      ".operations-resources",
      ".operations-agent-grid",
      "#operations-tasks-title",
      ".operations-findings",
      ".operations-catalogs",
      ".operations-processes",
    ]) {
      requireSelector(root, selector);
    }
    const text = root.textContent ?? "";
    for (const expected of [
      "Operations Room",
      "Control Director",
      "Run Operations Room proof",
      "Active & recent tasks",
      "Not attributable",
      "Shadow mode · no automatic changes",
      "Skills, plugins, tools & models",
      "Gemma",
      "metered",
      "Run now",
      "Pause",
    ]) {
      if (!text.includes(expected)) {
        throw new Error(`Operations Room smoke missing text: ${expected}`);
      }
    }
    writeFileSync(join(artifactDir, "dom.txt"), text);
    writeFileSync(
      join(artifactDir, "summary.json"),
      `${JSON.stringify({ ok: true, route: "/operations", desktop: true, mobileCss: true }, null, 2)}\n`,
    );
    console.log("OPERATIONS_ROOM_SMOKE_OK", artifactDir);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
      } else {
        (globalThis as Record<string, unknown>)[key] = value;
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

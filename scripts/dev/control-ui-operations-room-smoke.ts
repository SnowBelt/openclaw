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
    throw new Error(`Operations Room DOM smoke missing selector: ${selector}`);
  }
  return found;
}

function snapshot(now: number): OperationsSnapshot {
  return {
    schema: "openclaw.operations-room.v2",
    generatedAt: now,
    snapshotId: `dom-smoke-${now}`,
    freshness: {
      status: "fresh",
      observedAt: now,
      staleAfterMs: 60_000,
      sources: {
        agents: { status: "available", observedAt: now },
        tasks: { status: "available", observedAt: now },
        workflows: { status: "available", observedAt: now },
        schedules: { status: "available", observedAt: now },
        capabilities: { status: "available", observedAt: now },
        models: { status: "available", observedAt: now },
        processes: { status: "available", observedAt: now },
        event_loop: { status: "available", observedAt: now },
        monitor: { status: "available", observedAt: now },
        incident_ledger: { status: "available", observedAt: now },
      },
    },
    completeness: { status: "complete", unavailableSources: [], fallbackSources: [] },
    briefing: {
      tone: "attention",
      text: "One item is being watched while one agent runs the Operations Room proof.",
    },
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
      actionableFindings: 1,
      historicalFindings: 0,
      needsUserFindings: 0,
      handlingFindings: 0,
      watchingFindings: 1,
      criticalFindings: 0,
    },
    collections: {
      agents: { total: 2, shown: 2, truncated: false },
      tasks: { total: 1, shown: 1, truncated: false },
      workflows: { total: 1, shown: 1, truncated: false },
      cronJobs: { total: 1, shown: 1, truncated: false },
      skills: { total: 1, shown: 1, truncated: false },
      plugins: { total: 1, shown: 1, truncated: false },
      tools: { total: 1, shown: 1, truncated: false },
      models: { total: 2, shown: 2, truncated: false },
      processes: { total: 1, shown: 1, truncated: false },
      findings: { total: 1, shown: 1, truncated: false },
      activityRollups: { total: 1, shown: 1, truncated: false },
      incidentHistory: { total: 1, shown: 1, truncated: false },
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
      localModelProcessCount: 2,
      localModelRssBytes: 24 * 1024 ** 3,
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
        dutySource: "heartbeat",
        status: "working",
        activityState: "working",
        healthState: "healthy",
        attentionState: "none",
        model: "ollama/gemma",
        fallbackModels: ["ollama/qwen"],
        activeTaskCount: 1,
        blockedTaskCount: 0,
        latestTask: "Run Operations Room proof",
        latestActivityAt: now,
        currentWork: {
          taskId: "task-1",
          title: "Run Operations Room proof",
          summary: "Desktop and mobile browser receipts are being verified.",
          updatedAt: now,
          outcome: "active",
        },
        lastActivity: {
          taskId: "task-0",
          title: "Verify Operations contract",
          summary: "Protocol checks passed.",
          updatedAt: now - 60_000,
          outcome: "succeeded",
        },
        heartbeat: { enabled: true, every: "30m", everyMs: 1_800_000, target: "last" },
        memoryBytes: null,
        memoryAttribution: "unavailable",
      },
      {
        id: "writer",
        name: "Writer",
        workspace: "/workspace/writer",
        duty: "on_demand",
        dutySource: "configuration",
        status: "idle",
        activityState: "ready",
        healthState: "healthy",
        attentionState: "none",
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
        title: "RAW_SENTINEL_FULL_TASK_PROMPT_DO_NOT_RENDER",
        runtime: "subagent",
        agentId: "main",
        status: "working",
        sourceStatus: "running",
        progress: "RAW_SENTINEL_UNBOUNDED_PROGRESS_DO_NOT_RENDER",
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
        hasWaitState: false,
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
        availability: "available",
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
        availability: "available",
      },
    ],
    tools: [
      {
        id: "exec",
        name: "Exec",
        kind: "tool",
        status: "healthy",
        configured: true,
        active: true,
        availability: "available",
      },
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
        availability: "available",
      },
      {
        id: "openai/gpt",
        name: "GPT",
        kind: "model",
        status: "unknown",
        configured: true,
        active: null,
        route: "metered",
        availability: "unverified",
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
        detail: "RAW_SENTINEL_FINDING_DETAIL_DO_NOT_RENDER",
        recommendedAction: "Open Skills.",
        firstObservedAt: now - 60_000,
        lastObservedAt: now,
        disposition: "watching",
        responseState: "monitoring",
        impact: "One optional skill cannot run until its requirement is installed.",
        ownerId: "OpenClaw",
        nextAction: "Continue monitoring until the skill is needed.",
        nextCheckAt: now + 60_000,
      },
    ],
    activityRollups: [
      {
        key: "subagent:operations-proof",
        runtime: "subagent",
        sourceId: "operations-proof",
        taskId: "task-1",
        title: "Run Operations Room proof",
        count: 1,
        latestAt: now,
        status: "working",
        agentId: "main",
      },
    ],
    incidentHistory: [
      {
        id: "skill:requirements:blocked",
        title: "One skill needs requirements",
        category: "skill",
        severity: "warning",
        disposition: "watching",
        responseState: "monitoring",
        firstObservedAt: now - 60_000,
        lastObservedAt: now,
        transitions: [{ at: now - 60_000, to: "warning" }],
      },
    ],
    incidentLedger: { overflowCount: 0 },
    reconciler: {
      mode: "shadow",
      autoRemediationEnabled: false,
      intervalMs: 60_000,
      lastAttemptAt: now,
      lastSweepAt: now,
      nextSweepAt: now + 60_000,
      attemptCount: 1,
      sweepCount: 1,
      recommendedActionCount: 1,
      ruleCount: 10,
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
  const artifactDir = join(".artifacts", "control-ui-operations-room-dom-smoke", stamp());
  mkdirSync(artifactDir, { recursive: true });
  const css = readFileSync("ui/src/styles/operations.css", "utf8");
  if (
    !css.includes("@media (max-width: 600px)") ||
    !css.includes("@media (max-width: 360px)") ||
    !css.includes("@media (prefers-contrast: more)") ||
    !css.includes("@media (prefers-reduced-motion: reduce)")
  ) {
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
      ".operations-card-actions .btn",
      ".operations-incident-history > summary",
    ]) {
      const rule = rules.find(
        (entry) =>
          entry.selectorText
            .split(",")
            .map((value) => value.trim())
            .includes(selector) && Boolean(entry.style.minHeight),
      );
      if (rule?.style.minHeight !== "44px") {
        throw new Error(`Operations Room touch target contract failed: ${selector}`);
      }
    }
    const pinRule = rules.find((entry) => entry.selectorText === ".operations-pin");
    if (pinRule?.style.width !== "44px" || pinRule.style.height !== "44px") {
      throw new Error("Operations Room pin touch target contract failed");
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
        lastSuccessfulAt: Date.now(),
        refreshFailedAt: null,
        section: null,
        agentQuery: "",
        agentSort: "priority",
        pinnedAgentIds: [],
        lastVisitedAt: Date.now() - 120_000,
        canAdmin: true,
        onRefresh: () => undefined,
        onAction: () => undefined,
        onSectionChange: () => undefined,
        onAgentQueryChange: () => undefined,
        onAgentSortChange: () => undefined,
        onToggleAgentPin: () => undefined,
        onOpenAgent: () => undefined,
        onNavigate: () => undefined,
      }),
      root,
    );
    await Promise.resolve();

    for (const selector of [
      ".operations-room",
      ".operations-briefing",
      ".operations-briefing--attention[aria-live='polite']",
      ".operations-quick-nav",
      "#operations-attention-title",
      "#operations-working-title",
      "#operations-changes-title",
      "#operations-agents-title",
      "#operations-automations-title",
      "#operations-system-title",
      ".operations-more",
      ".operations-incident-history",
      ".operations-issue .operations-status__icon",
    ]) {
      requireSelector(root, selector);
    }
    const text = root.textContent ?? "";
    if (root.querySelectorAll(".operations-quick-link").length !== 5) {
      throw new Error("Operations Room primary navigation must contain exactly five controls");
    }
    for (const expected of [
      "Operations Room",
      "One item is being watched while one agent runs the Operations Room proof.",
      "Needs you",
      "Working now",
      "Since your last visit",
      "Control Director",
      "Run Operations Room proof",
      "One skill needs requirements",
      "Warning",
      "OpenClaw is handling",
      "Watching",
      "Not attributable",
      "Mac health",
      "43.7% available",
      "2 model processes · 24.0 GB process RSS",
      "Gemma",
      "Metered",
      "Run now",
      "Pause",
    ]) {
      if (!text.includes(expected)) {
        throw new Error(`Operations Room DOM smoke missing text: ${expected}`);
      }
    }
    for (const forbidden of [
      "RAW_SENTINEL_FULL_TASK_PROMPT_DO_NOT_RENDER",
      "RAW_SENTINEL_UNBOUNDED_PROGRESS_DO_NOT_RENDER",
      "RAW_SENTINEL_FINDING_DETAIL_DO_NOT_RENDER",
    ]) {
      if (text.includes(forbidden)) {
        throw new Error(`Operations Room DOM smoke exposed raw detail: ${forbidden}`);
      }
    }

    const partialSnapshot = snapshot(Date.now());
    partialSnapshot.overallStatus = "healthy";
    partialSnapshot.findings = [];
    partialSnapshot.summary.actionableFindings = 0;
    partialSnapshot.summary.criticalFindings = 0;
    partialSnapshot.completeness = {
      status: "partial",
      unavailableSources: ["processes"],
      fallbackSources: ["models"],
    };
    render(
      renderOperations({
        loading: false,
        actionBusy: false,
        error: null,
        actionNotice: null,
        snapshot: partialSnapshot,
        updatedAt: partialSnapshot.generatedAt,
        lastSuccessfulAt: partialSnapshot.generatedAt,
        refreshFailedAt: null,
        section: null,
        agentQuery: "",
        agentSort: "priority",
        pinnedAgentIds: [],
        lastVisitedAt: partialSnapshot.generatedAt - 120_000,
        onRefresh: () => undefined,
        onAction: () => undefined,
        onSectionChange: () => undefined,
        onAgentQueryChange: () => undefined,
        onAgentSortChange: () => undefined,
        onToggleAgentPin: () => undefined,
        onOpenAgent: () => undefined,
        onNavigate: () => undefined,
      }),
      root,
    );
    await Promise.resolve();
    requireSelector(root, "#operations-attention .operations-status--unknown");
    requireSelector(root, ".operations-briefing--unknown");
    if (root.querySelector("#operations-attention .operations-good")) {
      throw new Error("Partial Operations Room data must not render an all-clear Attention state");
    }
    const partialText = root.textContent ?? "";
    for (const expected of [
      "Attention status cannot be confirmed",
      "Unavailable sources: Processes.",
      "Fallback data sources: Models.",
    ]) {
      if (!partialText.includes(expected)) {
        throw new Error(`Operations Room partial-data proof missing text: ${expected}`);
      }
    }
    writeFileSync(join(artifactDir, "dom.txt"), text);
    writeFileSync(
      join(artifactDir, "summary.json"),
      `${JSON.stringify(
        {
          schema: "openclaw.operations-room.dom-smoke.v2",
          ok: true,
          proofKind: "structural_dom_only",
          route: "/operations",
          browser: false,
          interaction: false,
          responsiveCssPresent: true,
          primaryControls: 5,
          partialAttentionFailsClosed: true,
          rawFindingDetailAbsent: true,
        },
        null,
        2,
      )}\n`,
    );
    console.log("OPERATIONS_ROOM_DOM_SMOKE_OK", artifactDir);
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

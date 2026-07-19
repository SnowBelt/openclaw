/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { OperationsSnapshot } from "../types.ts";
import { renderOperations, type OperationsProps } from "./operations.ts";

const snapshot: OperationsSnapshot = {
  schema: "openclaw.operations-room.v1",
  generatedAt: 1_000,
  qualityTarget: 93,
  qualityScore: 96,
  overallStatus: "degraded",
  summary: {
    agents: 1,
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
    models: 1,
    findings: 1,
    criticalFindings: 0,
  },
  host: {
    hostname: "studio",
    platform: "darwin",
    arch: "arm64",
    uptimeMs: 10_000,
    logicalCpuCount: 12,
    loadAverage: [1, 2, 3],
    totalMemoryBytes: 64 * 1024 ** 3,
    freeMemoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: 36 * 1024 ** 3,
    usedMemoryBytes: 28 * 1024 ** 3,
    memoryUsedPercent: 43.8,
    memoryAvailabilitySource: "macos_memory_pressure",
    processRssBytes: 256 * 1024 ** 2,
    processHeapUsedBytes: 64 * 1024 ** 2,
    processHeapTotalBytes: 128 * 1024 ** 2,
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
      latestTask: "Verify dashboard",
      latestActivityAt: Date.now(),
      heartbeat: { enabled: true, every: "30m", everyMs: 1_800_000, target: "last" },
      memoryBytes: null,
      memoryAttribution: "unavailable",
    },
  ],
  tasks: [
    {
      id: "task-1",
      title: "Verify Operations Room",
      runtime: "subagent",
      agentId: "main",
      status: "working",
      sourceStatus: "running",
      progress: "Running browser proof",
      updatedAt: Date.now(),
    },
  ],
  workflows: [
    {
      id: "flow-1",
      title: "Operations Room",
      ownerKey: "agent:main:main",
      status: "working",
      sourceStatus: "running",
      currentStep: "Local proof",
      activeTaskCount: 1,
      failedTaskCount: 0,
      updatedAt: Date.now(),
    },
  ],
  cronJobs: [
    {
      id: "cron-1",
      name: "Health sweep",
      duty: "scheduled",
      status: "healthy",
      enabled: true,
      running: false,
      nextRunAt: Date.now() + 60_000,
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
    { id: "apps", name: "Apps", kind: "plugin", status: "healthy", configured: true, active: true },
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
  ],
  processes: [
    {
      pid: 42,
      parentPid: 1,
      command: "node",
      rssBytes: 128 * 1024 ** 2,
      cpuPercent: 1.5,
      kind: "gateway",
    },
  ],
  findings: [
    {
      id: "skill:requirements:blocked",
      severity: "warning",
      category: "skill",
      title: "One skill needs setup",
      detail: "Install its required local tool.",
      lastObservedAt: Date.now(),
      recommendedAction: "Open Skills.",
    },
  ],
  reconciler: {
    mode: "shadow",
    autoRemediationEnabled: false,
    intervalMs: 60_000,
    lastSweepAt: Date.now(),
    nextSweepAt: Date.now() + 60_000,
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

function props(overrides: Partial<OperationsProps> = {}): OperationsProps {
  return {
    loading: false,
    actionBusy: false,
    error: null,
    actionNotice: null,
    snapshot,
    updatedAt: Date.now(),
    onRefresh: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
}

describe("Operations Room view", () => {
  it("renders operational truth without pretending shared agent RAM is measurable", async () => {
    const container = document.createElement("div");
    render(renderOperations(props()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Operations Room");
    expect(container.textContent).toContain("Control Director");
    expect(container.textContent).toContain("Verify dashboard");
    expect(container.textContent).toContain("Not attributable");
    expect(container.textContent).toContain("Shadow mode · no automatic changes");
    expect(container.textContent).toContain("Gemma");
    expect(container.querySelector(".operations-score")?.textContent).toContain("96/100");
  });

  it("routes every mutating control through the supplied guarded callback", async () => {
    const container = document.createElement("div");
    const onAction = vi.fn();
    render(renderOperations(props({ onAction })), container);
    await Promise.resolve();

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    for (const button of buttons.filter((entry) => entry.textContent?.includes("Cancel"))) {
      button.click();
    }
    buttons.find((button) => button.textContent?.includes("Run now"))?.click();
    buttons.find((button) => button.textContent?.includes("Pause"))?.click();

    expect(onAction).toHaveBeenNthCalledWith(1, "task.cancel", "task-1");
    expect(onAction).toHaveBeenNthCalledWith(2, "flow.cancel", "flow-1");
    expect(onAction).toHaveBeenNthCalledWith(3, "cron.run", "cron-1");
    expect(onAction).toHaveBeenNthCalledWith(4, "cron.disable", "cron-1");
  });

  it("keeps a readable error state when runtime collection fails", async () => {
    const container = document.createElement("div");
    render(renderOperations(props({ snapshot: null, error: "Gateway unavailable" })), container);
    await Promise.resolve();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Gateway unavailable");
  });
});

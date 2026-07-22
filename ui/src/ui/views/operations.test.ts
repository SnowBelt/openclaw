/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { OperationsSnapshot } from "../types.ts";
import {
  createOperationsTestSnapshot,
  OPERATIONS_RAW_PROMPT_SENTINEL,
} from "./operations.test-fixture.ts";
import { renderOperations, type OperationsProps } from "./operations.ts";

function props(overrides: Partial<OperationsProps> = {}): OperationsProps {
  const snapshot = createOperationsTestSnapshot();
  return {
    loading: false,
    actionBusy: false,
    canWrite: true,
    canAdmin: true,
    error: null,
    actionNotice: null,
    actionNoticeTone: null,
    snapshot,
    updatedAt: snapshot.generatedAt,
    lastSuccessfulAt: snapshot.generatedAt,
    refreshFailedAt: null,
    section: null,
    agentQuery: "",
    agentSort: "priority",
    pinnedAgentIds: [],
    lastVisitedAt: snapshot.generatedAt - 45_000,
    onRefresh: vi.fn(),
    onAction: vi.fn(),
    onSectionChange: vi.fn(),
    onAgentQueryChange: vi.fn(),
    onAgentSortChange: vi.fn(),
    onToggleAgentPin: vi.fn(),
    onOpenAgent: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
}

async function renderView(overrides: Partial<OperationsProps> = {}) {
  const container = document.createElement("div");
  render(renderOperations(props(overrides)), container);
  await Promise.resolve();
  return container;
}

describe("Operations Room view", () => {
  it("renders a concise briefing, deterministic anchors, and truthful warning tone", async () => {
    const container = await renderView();

    expect(container.textContent).toContain(
      "One issue is being handled while one agent verifies the Operations Room.",
    );
    expect(container.querySelector("#operations-attention")).not.toBeNull();
    expect(container.querySelector("#operations-working")).not.toBeNull();
    expect(container.querySelector("#operations-changes")).not.toBeNull();
    expect(container.querySelector("#operations-agents")).not.toBeNull();
    expect(container.querySelector("#operations-automations")).not.toBeNull();
    expect(container.querySelector("#operations-system")).not.toBeNull();
    expect(container.querySelector("#operations-more")).not.toBeNull();
    expect(
      container.querySelector("#operations-attention .operations-status--degraded"),
    ).not.toBeNull();
    expect(container.querySelector("#operations-attention .operations-status--healthy")).toBeNull();
    expect(container.querySelector(".operations-briefing--attention")).not.toBeNull();
    expect(container.querySelector(".operations-briefing")?.getAttribute("aria-live")).toBe(
      "polite",
    );
    expect(container.querySelector(".operations-issue")?.textContent).toContain("Warning");
  });

  it("never places raw task, workflow, or finding prompt text in the rendered DOM", async () => {
    const container = await renderView();

    expect(container.textContent).not.toContain(OPERATIONS_RAW_PROMPT_SENTINEL);
    expect(container.innerHTML).not.toContain(OPERATIONS_RAW_PROMPT_SENTINEL);
    expect(container.textContent).toContain("One optional capability is unavailable.");
  });

  it("keeps task, workflow, CPU, and capability truth available on demand", async () => {
    const onNavigate = vi.fn();
    const container = await renderView({ onNavigate });
    const working = container.querySelector("#operations-working");
    const more = container.querySelector("#operations-more");
    const system = container.querySelector("#operations-system");

    expect(working?.textContent).toContain("Active: 1 · Need attention: 0 · Total: 2");
    expect(working?.textContent).toContain("Active: 1 · Total: 1");
    expect(system?.textContent).toContain("Logical CPU cores");
    expect(system?.textContent).not.toContain("Reliability score");
    expect(more?.textContent).toContain("Configured");
    expect(more?.textContent).toContain("Active");

    for (const button of working?.querySelectorAll<HTMLButtonElement>(
      ".operations-work-facts button",
    ) ?? []) {
      button.click();
    }
    expect(onNavigate.mock.calls).toEqual([["workboard"], ["workboard"]]);
  });

  it("shows issue progress, next check, remediation, and a guarded workflow cancel", async () => {
    const snapshot = createOperationsTestSnapshot();
    const finding = snapshot.findings[0]!;
    snapshot.findings[0] = {
      ...finding,
      category: "workflow",
      entityId: "flow-1",
      remediationTaskId: "task-1",
      lastProgressAt: snapshot.generatedAt - 5_000,
      nextCheckAt: snapshot.generatedAt + 60_000,
    };
    const onNavigate = vi.fn();
    const onAction = vi.fn();
    const container = await renderView({ snapshot, onNavigate, onAction });
    const issue = container.querySelector(".operations-issue");

    expect(issue?.textContent).toContain("Last progress");
    expect(issue?.textContent).toContain("Next check");
    expect(issue?.textContent).toContain("Remediation task");
    expect(issue?.textContent).toContain("task-1");
    issue?.querySelector<HTMLButtonElement>(".operations-remediation-link")?.click();
    [...(issue?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.includes("Cancel workflow"))
      ?.click();

    expect(onNavigate).toHaveBeenCalledWith("workboard");
    expect(onAction).toHaveBeenCalledWith("flow.cancel", "flow-1");
    expect(issue?.querySelector("summary")?.getAttribute("aria-label")).toContain("Details for");
  });

  it("shows and guards cancellation for an active workflow without a running task", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.agents = snapshot.agents.map((agent) => {
      const next = { ...agent };
      delete next.currentWork;
      return next;
    });
    snapshot.tasks = [];
    snapshot.activityRollups = [];
    snapshot.workflows[0] = {
      ...snapshot.workflows[0],
      activeTaskCount: 0,
      currentStep: "Waiting for a verified handoff",
    };
    const onAction = vi.fn();
    const container = await renderView({ snapshot, onAction });
    const working = container.querySelector("#operations-working");

    expect(working?.textContent).toContain("Managed verification workflow");
    expect(working?.textContent).toContain("Waiting for a verified handoff");
    [...(working?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Cancel")
      ?.click();
    expect(onAction).toHaveBeenCalledWith("flow.cancel", "flow-1");
  });

  it("shows controls only for the operator scopes that can apply them", async () => {
    const readOnly = await renderView({ canWrite: false, canAdmin: false });
    expect(
      readOnly.querySelectorAll(
        'button[aria-label^="Cancel"], button[aria-label^="Run"], button[aria-label^="Pause"]',
      ),
    ).toHaveLength(0);

    const writeOnly = await renderView({ canWrite: true, canAdmin: false });
    expect(writeOnly.querySelector('button[aria-label^="Cancel"]')).not.toBeNull();
    expect(writeOnly.querySelector('button[aria-label^="Run"]')).toBeNull();
    expect(writeOnly.querySelector('button[aria-label^="Pause"]')).toBeNull();

    const admin = await renderView({ canWrite: true, canAdmin: true });
    expect(admin.querySelector('button[aria-label^="Cancel"]')).not.toBeNull();
    expect(admin.querySelector('button[aria-label^="Run"]')).not.toBeNull();
    expect(admin.querySelector('button[aria-label^="Pause"]')).not.toBeNull();
  });

  it("discloses process rows rejected by the bounded parser", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.collections.processes = {
      ...snapshot.collections.processes,
      rejected: 2,
    };

    const container = await renderView({ snapshot });

    expect(container.querySelector(".operations-process-rejection")?.textContent).toContain(
      "2 process rows could not be read and were excluded.",
    );
    expect(container.querySelector(".operations-process-rejection")?.getAttribute("role")).toBe(
      "status",
    );
  });

  it("discloses every bounded list and provides source drill-through controls", async () => {
    const snapshot = createOperationsTestSnapshot();
    const current = snapshot.findings.find((finding) => finding.disposition !== "historical")!;
    snapshot.findings = Array.from({ length: 200 }, (_, index) => ({
      ...current,
      id: `bounded-${index}`,
      title: `Bounded issue ${index + 1}`,
      disposition: "needs_user" as const,
      responseState: "waiting_for_user" as const,
    }));
    snapshot.summary = {
      ...snapshot.summary,
      findings: 427,
      actionableFindings: 427,
      historicalFindings: 0,
      needsUserFindings: 300,
      handlingFindings: 100,
      watchingFindings: 27,
      criticalFindings: 0,
    };
    snapshot.collections.findings = { total: 427, shown: 200, truncated: true };
    snapshot.collections.agents = { total: 527, shown: 4, truncated: true };
    snapshot.collections.skills = { total: 427, shown: 1, truncated: true };
    snapshot.processes = Array.from({ length: 30 }, (_, index) => ({
      ...snapshot.processes[0]!,
      pid: 1_000 + index,
    }));
    snapshot.collections.processes = { total: 45, shown: 30, truncated: true };
    snapshot.cronJobs = Array.from({ length: 9 }, (_, index) => ({
      ...snapshot.cronJobs[0]!,
      id: `cron-${index}`,
      name: `Schedule ${index + 1}`,
    }));
    snapshot.collections.cronJobs = { total: 9, shown: 9, truncated: false };
    const onNavigate = vi.fn();

    const container = await renderView({ snapshot, onNavigate });
    const attention = container.querySelector("#operations-attention");
    expect(attention?.textContent).toContain("Showing 4 of 427 current issues");
    expect(attention?.textContent).toContain("4 of 300");
    expect(attention?.textContent).toContain("0 of 100");
    expect(attention?.textContent).toContain("100 current issues are outside this preview");
    expect(attention?.textContent).not.toContain("No active remediation is in progress.");
    expect(attention?.querySelectorAll(".operations-issue")).toHaveLength(4);
    expect(container.querySelector(".operations-catalog summary")?.textContent).toContain(
      "1 of 427",
    );
    expect(container.querySelector("#operations-more")?.textContent).toContain(
      "Showing the 30 largest of 45 accepted processes.",
    );
    expect(container.querySelectorAll(".operations-process")).toHaveLength(30);
    expect(container.querySelector("#operations-automations")?.textContent).toContain(
      "Showing 8 of 9",
    );
    expect(container.querySelector("#operations-agents")?.textContent).toContain(
      "Showing 4 of 527 agents",
    );

    for (const button of attention?.querySelectorAll<HTMLButtonElement>(
      ".operations-bounded-note button",
    ) ?? []) {
      button.click();
    }
    container
      .querySelector<HTMLButtonElement>("#operations-agents .operations-bounded-note button")
      ?.click();
    expect(onNavigate.mock.calls).toEqual([
      ["workboard"],
      ["cron"],
      ["skills"],
      ["agents"],
      ["agents"],
    ]);
  });

  it("keeps inactive current work truthful and ready agents collapsed", async () => {
    const container = await renderView({ agentQuery: "Ready Agent" });
    const readyGroup = container.querySelector<HTMLDetailsElement>(
      ".operations-agent-group--ready",
    );
    const row = container.querySelector<HTMLDetailsElement>(".operations-agent-row");

    expect(readyGroup?.open).toBe(false);
    expect(row?.querySelector("summary")?.textContent).toContain("Ready for work");
    row!.open = true;
    expect(row?.textContent).toContain("Current work");
    expect(row?.textContent).toContain("None");
    expect(row?.textContent).not.toContain("Old completed work");
  });

  it("renders activity, health, and attention as separate agent state axes", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.agents[0] = {
      ...snapshot.agents[0],
      activityState: "working",
      healthState: "failed",
      attentionState: "needs_user",
      activeTaskCount: 2,
      blockedTaskCount: 1,
    };
    const container = await renderView({ snapshot, agentQuery: "Control Director" });
    const row = container.querySelector(".operations-agent-row");

    expect(row?.querySelector(".operations-agent-row__states")?.textContent).toContain("Working");
    expect(row?.querySelector(".operations-agent-row__states")?.textContent).toContain("Failed");
    expect(row?.querySelector(".operations-agent-row__states")?.textContent).toContain(
      "Needs attention",
    );
    expect(row?.textContent).toContain("Active: 2 · Blocked: 1");
    expect(row?.textContent).toContain("Prepared the UI proof");
  });

  it("fails closed in local empty states when their source authority is unavailable", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.agents = [];
    snapshot.tasks = [];
    snapshot.workflows = [];
    snapshot.activityRollups = [];
    snapshot.incidentHistory = [];
    snapshot.cronJobs = [];
    snapshot.skills = [];
    snapshot.processes = [];
    snapshot.freshness.sources.agents = { status: "unavailable" };
    snapshot.freshness.sources.tasks = { status: "unavailable" };
    snapshot.freshness.sources.workflows = { status: "unavailable" };
    snapshot.freshness.sources.schedules = { status: "unavailable" };
    snapshot.freshness.sources.capabilities = { status: "unavailable" };
    snapshot.freshness.sources.processes = { status: "unavailable" };
    snapshot.freshness.sources.incident_ledger = { status: "unavailable" };
    snapshot.collections.incidentHistory = { total: 0, shown: 0, truncated: false };
    snapshot.incidentLedger.overflowCount = 0;
    const container = await renderView({ snapshot });

    expect(container.querySelector("#operations-working")?.textContent).toContain(
      "Current work cannot be confirmed",
    );
    expect(container.querySelector("#operations-agents")?.textContent).toContain(
      "Agent activity cannot be confirmed",
    );
    expect(container.querySelector("#operations-automations")?.textContent).toContain(
      "Scheduled work cannot be confirmed",
    );
    expect(container.querySelector("#operations-more")?.textContent).toContain(
      "This catalog cannot be confirmed",
    );
    expect(container.querySelector("#operations-more")?.textContent).toContain(
      "Process inventory cannot be confirmed",
    );
    expect(container.querySelector("#operations-changes")?.textContent).toContain(
      "Recent changes cannot be confirmed",
    );
    expect(container.querySelector("#operations-more")?.textContent).toContain(
      "Incident details are not available",
    );
  });

  it("keeps cached rows visible without presenting unconfirmed states as live", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.freshness.sources.tasks = { status: "unavailable" };
    snapshot.freshness.sources.workflows = { status: "unavailable" };
    snapshot.freshness.sources.agents = { status: "unavailable" };
    snapshot.freshness.sources.schedules = { status: "unavailable" };
    const container = await renderView({ snapshot });
    const workRow = container.querySelector(".operations-work-row");
    const agentRow = container.querySelector(".operations-agent-row");
    const scheduleRow = container.querySelector(".operations-automation-row");
    const workflowDetail = container.querySelector(".operations-more-workflows");

    expect(workRow?.textContent).toContain("Verify Operations Room");
    expect(workRow?.textContent).toContain("Current work unverified");
    expect(workRow?.querySelector(".operations-status--working")).toBeNull();
    expect(agentRow?.textContent).toContain("Release Ops");
    expect(agentRow?.textContent).toContain("Activity unverified");
    expect(agentRow?.querySelector(".operations-status--working")).toBeNull();
    expect(agentRow?.querySelector(".operations-status--healthy")).toBeNull();
    expect(scheduleRow?.textContent).toContain("Health sweep");
    expect(scheduleRow?.textContent).toContain("Needs verification");
    expect(scheduleRow?.querySelector(".operations-status--healthy")).toBeNull();
    expect(workflowDetail?.textContent).toContain("Counts cannot be confirmed");
    expect(workflowDetail?.textContent).not.toContain("1 total · 1 active");
  });

  it("disables every guarded mutation when the snapshot is stale", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.freshness.status = "stale";
    const onAction = vi.fn();
    const container = await renderView({ snapshot, onAction });
    const guarded = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Cancel"], button[aria-label^="Run"], button[aria-label^="Pause"]',
      ),
    ];

    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded.every((button) => button.disabled)).toBe(true);
    expect(guarded.every((button) => button.title.includes("fresh and complete"))).toBe(true);
    guarded.forEach((button) => button.click());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("limits current work to a concise preview with a real Workboard drill-through", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.activityRollups = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot.activityRollups[0]!,
      key: `working-${index}`,
      taskId: `working-task-${index}`,
      title: `Working outcome ${index + 1}`,
      latestAt: snapshot.generatedAt - index,
      status: "working" as const,
    }));
    snapshot.collections.activityRollups = { total: 12, shown: 12, truncated: false };
    const onNavigate = vi.fn();
    const container = await renderView({ snapshot, onNavigate });
    const working = container.querySelector("#operations-working");

    expect(working?.querySelectorAll(".operations-work-row")).toHaveLength(8);
    expect(working?.textContent).toContain("Showing 8 recent work summaries");
    [...(working?.querySelectorAll<HTMLButtonElement>(".operations-bounded-note button") ?? [])]
      .find((button) => button.textContent?.includes("Open Workboard"))
      ?.click();
    expect(onNavigate).toHaveBeenCalledWith("workboard");
  });

  it("discloses the bounded recent-change preview and opens Activity", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.activityRollups = Array.from({ length: 15 }, (_, index) => ({
      ...snapshot.activityRollups[1]!,
      key: `change-${index}`,
      latestAt: snapshot.generatedAt - index,
    }));
    snapshot.collections.activityRollups = { total: 15, shown: 15, truncated: false };
    const container = await renderView({
      snapshot,
      lastVisitedAt: snapshot.generatedAt - 60_000,
    });
    document.body.append(container);
    const changes = container.querySelector("#operations-changes");

    expect(changes?.querySelectorAll(".operations-change")).toHaveLength(12);
    expect(changes?.textContent).toContain("Showing the 12 newest changes");
    changes?.querySelector<HTMLButtonElement>("button")?.click();
    expect(container.querySelector<HTMLDetailsElement>("#operations-more")?.open).toBe(true);
    expect(container.querySelector(".operations-activity-history")?.textContent).toContain(
      "Activity groups: 15",
    );
    container.remove();
  });

  it("labels cached recent changes as unconfirmed when their sources are unavailable", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.freshness.sources.tasks = { status: "unavailable" };
    const container = await renderView({
      snapshot,
      lastVisitedAt: snapshot.generatedAt - 60_000,
    });
    const changes = container.querySelector("#operations-changes");

    expect(changes?.querySelectorAll(".operations-change").length).toBeGreaterThan(0);
    expect(changes?.textContent).toContain(
      "Recent changes cannot be confirmed until their data sources recover.",
    );
  });

  it("shows the incident title in changes and ignores observation-only churn", async () => {
    const snapshot = createOperationsTestSnapshot();
    const boundary = snapshot.generatedAt - 45_000;
    snapshot.incidentHistory[0] = {
      ...snapshot.incidentHistory[0],
      firstObservedAt: boundary - 30_000,
      lastObservedAt: boundary + 20_000,
      transitions: [{ at: boundary + 10_000, from: "info", to: "warning" }],
    };
    const container = await renderView({ snapshot, lastVisitedAt: boundary });

    expect(container.querySelector("#operations-changes")?.textContent).toContain(
      "One skill needs setup",
    );

    snapshot.incidentHistory[0] = {
      ...snapshot.incidentHistory[0],
      transitions: [{ at: boundary - 10_000, to: "warning" }],
    };
    const unchanged = await renderView({ snapshot, lastVisitedAt: boundary });
    expect(unchanged.querySelector("#operations-changes")?.textContent).not.toContain(
      "One skill needs setup",
    );
  });

  it("routes section links and guarded controls through supplied callbacks", async () => {
    const onAction = vi.fn();
    const onSectionChange = vi.fn();
    const container = await renderView({ onAction, onSectionChange });

    const attentionLink = container.querySelector<HTMLAnchorElement>(
      '.operations-quick-link[href*="section=attention"]',
    );
    attentionLink?.click();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.textContent?.includes("Cancel"))?.click();
    buttons.find((button) => button.textContent?.includes("Run now"))?.click();
    buttons.find((button) => button.textContent?.includes("Pause"))?.click();

    expect(onSectionChange).toHaveBeenCalledWith("attention");
    expect(onAction).toHaveBeenNthCalledWith(1, "task.cancel", "task-1");
    expect(onAction).toHaveBeenNthCalledWith(2, "cron.run", "cron-1");
    expect(onAction).toHaveBeenNthCalledWith(3, "cron.disable", "cron-1");
  });

  it("marks last-known or partial data as unknown instead of healthy", async () => {
    const stale = createOperationsTestSnapshot();
    stale.overallStatus = "healthy";
    stale.freshness.status = "stale";
    const staleContainer = await renderView({ snapshot: stale });
    expect(
      staleContainer.querySelector(".operations-hero .operations-status--unknown")?.textContent,
    ).toContain("Last known");
    expect(
      staleContainer.querySelector("#operations-attention .operations-status--unknown")
        ?.textContent,
    ).toContain("Last known");
    expect(staleContainer.querySelector("#operations-attention .operations-good")).toBeNull();
    expect(staleContainer.querySelector(".operations-briefing--unknown")).not.toBeNull();
    expect(staleContainer.querySelector(".operations-briefing > div > p")?.textContent).toContain(
      "current overview cannot be confirmed",
    );
    expect(
      staleContainer.querySelector<HTMLDetailsElement>(".operations-last-known-briefing")?.open,
    ).toBe(false);
    expect(staleContainer.querySelector("#operations-agents")?.textContent).toContain(
      "Agent activity cannot be confirmed",
    );
    expect(staleContainer.querySelector("#operations-automations")?.textContent).toContain(
      "Scheduled work cannot be confirmed",
    );

    const partial = createOperationsTestSnapshot();
    partial.overallStatus = "healthy";
    partial.completeness = {
      status: "partial",
      unavailableSources: ["processes"],
      fallbackSources: ["models"],
    };
    partial.findings = partial.findings.filter((finding) => finding.disposition === "historical");
    partial.summary.actionableFindings = 0;
    partial.summary.criticalFindings = 0;
    const partialContainer = await renderView({ snapshot: partial });
    expect(
      partialContainer.querySelector(".operations-hero .operations-status--unknown")?.textContent,
    ).toContain("Partial data");
    expect(partialContainer.textContent).toContain("Unavailable sources: Processes.");
    expect(partialContainer.textContent).toContain("Fallback data sources: Models.");
    expect(partialContainer.textContent).toContain("Attention status cannot be confirmed");
    expect(partialContainer.querySelector("#operations-attention .operations-good")).toBeNull();
  });

  it("labels carried incidents and distinguishes monitor attempts from successful sweeps", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.findings[0] = { ...snapshot.findings[0], evidenceState: "last_known" };
    snapshot.reconciler.lastAttemptAt = snapshot.generatedAt;
    snapshot.reconciler.lastSweepAt = null;

    const container = await renderView({ snapshot });

    expect(container.querySelector(".operations-issue__status")?.textContent).toContain(
      "Last known",
    );
    expect(container.querySelector("#operations-more")?.textContent).toContain(
      "Monitor: last attempt",
    );
    expect(container.querySelector("#operations-more")?.textContent).toContain(
      "last successful sweep never",
    );
  });

  it("keeps shown incident history accessible and links beyond the bounded snapshot", async () => {
    const snapshot = createOperationsTestSnapshot();
    snapshot.incidentHistory = Array.from({ length: 20 }, (_, index) => ({
      ...snapshot.incidentHistory[0],
      id: `incident-${index}`,
      title: `Incident ${index + 1}`,
      lastObservedAt: snapshot.generatedAt - index * 1_000,
      transitions: [{ at: snapshot.generatedAt - index * 1_000, to: "warning" }],
    }));
    snapshot.collections.incidentHistory = { total: 25, shown: 20, truncated: true };
    snapshot.incidentLedger.overflowCount = 4;
    const container = await renderView({ snapshot });
    const history = container.querySelector(".operations-incident-history");

    expect(history?.querySelectorAll(".operations-incident-history__item")).toHaveLength(20);
    expect(history?.querySelector("ol")?.getAttribute("aria-label")).toBe("Incident history");
    expect(history?.textContent).toContain("Showing 20 of 25");
    expect(history?.textContent).toContain("This snapshot includes 20 of 25 incident records.");
    expect(history?.textContent).toContain(
      "4 older incidents are outside the retained history window.",
    );
    expect(history?.textContent).not.toContain(OPERATIONS_RAW_PROMPT_SENTINEL);
    expect(history?.querySelector("button")).toBeNull();
  });

  it("localizes visible operational enum values", async () => {
    const container = await renderView();
    const text = (container.textContent ?? "").replace(/\s+/g, " ").trim();

    expect(text).toContain("Always on · Heartbeat");
    expect(text).toContain("command-line");
    expect(text).toContain("Skill");
    expect(text).toContain("Local");
    expect(text).toContain("Gateway");
  });

  it("renders failed guarded actions as errors and successful receipts as success", async () => {
    const failed = await renderView({ error: "The action was rejected." });
    expect(failed.querySelector('.callout.danger[role="alert"]')?.textContent).toContain(
      "The action was rejected.",
    );
    expect(failed.querySelector(".callout.success")).toBeNull();

    const success = await renderView({
      actionNotice: "Schedule paused.",
      actionNoticeTone: "success",
    });
    expect(success.querySelector(".callout.success")?.textContent).toContain("Schedule paused.");
  });

  it("keeps a readable error state when no snapshot can be collected", async () => {
    const container = await renderView({
      snapshot: null,
      updatedAt: null,
      error: "Gateway unavailable",
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Gateway unavailable");
  });

  it("accepts the authoritative snapshot type without UI-only inference fields", () => {
    const authoritative: OperationsSnapshot = createOperationsTestSnapshot();
    expect(authoritative.schema).toBe("openclaw.operations-room.v2");
  });
});

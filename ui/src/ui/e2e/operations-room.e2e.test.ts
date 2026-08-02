import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OperationsSnapshotV1Result } from "../../../../packages/gateway-protocol/src/schema/types.ts";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
  type MockGatewayControls,
} from "../../test-helpers/control-ui-e2e.ts";
import type { OperationsSnapshot } from "../types.ts";
import {
  createSevenGroupOperationsTestSnapshot,
  OPERATIONS_RAW_PROMPT_SENTINEL,
} from "../views/operations.fixture.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeControlUiE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;
const artifactDir = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/operations-room");
const preferencesKey = "openclaw.operations.preferences.v1";

function legacyFinding(finding: OperationsSnapshot["findings"][number]) {
  const {
    resolvedAt: _resolvedAt,
    evidenceState: _evidenceState,
    disposition: _disposition,
    responseState: _responseState,
    impact: _impact,
    ownerId: _ownerId,
    nextAction: _nextAction,
    remediationTaskId: _remediationTaskId,
    lastProgressAt: _lastProgressAt,
    nextCheckAt: _nextCheckAt,
    remediation: _remediation,
    ...legacy
  } = finding;
  return {
    ...legacy,
    category: legacy.category === "monitor" ? "process" : legacy.category,
  };
}

let browser: Browser;
let server: ControlUiE2eServer;
let proofStartedAt = "";

const proofCheckDefaults = {
  agentGroupOrder: false,
  automaticRemediationSafety: false,
  attentionOwnershipAndResponse: false,
  ariaLive: false,
  browserHistoryAndFocus: false,
  computedTouchTargets44px: false,
  contrastLightAndDark: false,
  disabledWorkboardFallsBackInPage: false,
  guardedActionCancel: false,
  guardedActionExpired: false,
  guardedActionPreviewApply: false,
  guardedActionReplayRejected: false,
  incidentHistoryBoundedAndSafe: false,
  increasedContrast: false,
  issueLanesAndNonColorCues: false,
  issueResolutionWorkflow: false,
  keyboardOnlyIssueJourney: false,
  largeInventoryDisclosed: false,
  legacyFallbackOnlyWhenUnsupported: false,
  monitorFailClosed: false,
  noFallbackForOperationalErrors: false,
  offlineState: false,
  ownerAcceptanceInUi: false,
  postActionRefresh: false,
  primaryControls: false,
  processProbeStates: false,
  rawPromptAbsent: false,
  reducedMotion: false,
  responsive320px: false,
  responsiveTablet: false,
  rtl: false,
  sameSessionVisitBoundary: false,
  staleAndPartialFailClosed: false,
  zeroIssueState: false,
  zoom200Percent: false,
} as const;

type ProofCheck = keyof typeof proofCheckDefaults;

const proofChecks: Record<ProofCheck, boolean> = { ...proofCheckDefaults };

function markChecks(...checks: ProofCheck[]): void {
  for (const check of checks) {
    proofChecks[check] = true;
  }
}

type Diagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
};

type ActionStatus = "applied" | "rejected" | "failed";

function collectDiagnostics(page: Page): Diagnostics {
  const diagnostics: Diagnostics = { consoleErrors: [], pageErrors: [] };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.consoleErrors.push(message.text());
    }
  });
  return diagnostics;
}

function withBoundedIncidentHistory(snapshot: OperationsSnapshot): OperationsSnapshot {
  const template = snapshot.incidentHistory[0];
  snapshot.incidentHistory = Array.from({ length: 16 }, (_, index) => ({
    ...template,
    id: `incident-${index}`,
    title: `Incident ${index + 1}`,
    severity: "warning",
    firstObservedAt: snapshot.generatedAt - 60_000 - index * 1_000,
    lastObservedAt: snapshot.generatedAt - index * 1_000,
    transitions: [{ at: snapshot.generatedAt - 60_000 - index * 1_000, to: "warning" }],
  }));
  snapshot.collections.incidentHistory = { total: 20, shown: 16, truncated: true };
  snapshot.incidentLedger.overflowCount = 3;
  return snapshot;
}

function zeroIssueSnapshot(now = Date.now()): OperationsSnapshot {
  const snapshot = createSevenGroupOperationsTestSnapshot(now);
  snapshot.briefing = {
    tone: "normal",
    text: "No issues need attention and no agent is actively working right now.",
  };
  snapshot.overallStatus = "healthy";
  snapshot.findings = [];
  snapshot.incidentHistory = [];
  snapshot.tasks = [];
  snapshot.workflows = [];
  snapshot.activityRollups = [];
  snapshot.agents = snapshot.agents.map((agent) => ({
    ...agent,
    status: agent.duty === "disabled" ? "disabled" : "idle",
    activityState: agent.duty === "disabled" ? "off" : "ready",
    healthState: agent.duty === "disabled" ? "unknown" : "healthy",
    attentionState: "none",
    activeTaskCount: 0,
    blockedTaskCount: 0,
    currentWork: undefined,
  }));
  snapshot.summary = {
    ...snapshot.summary,
    workingAgents: 0,
    attentionAgents: 0,
    tasks: 0,
    activeTasks: 0,
    failedTasks: 0,
    workflows: 0,
    activeWorkflows: 0,
    findings: 0,
    actionableFindings: 0,
    historicalFindings: 0,
    needsUserFindings: 0,
    handlingFindings: 0,
    watchingFindings: 0,
    criticalFindings: 0,
  };
  snapshot.collections.tasks = { total: 0, shown: 0, truncated: false };
  snapshot.collections.workflows = { total: 0, shown: 0, truncated: false };
  snapshot.collections.findings = { total: 0, shown: 0, truncated: false };
  snapshot.collections.activityRollups = { total: 0, shown: 0, truncated: false };
  snapshot.collections.incidentHistory = { total: 0, shown: 0, truncated: false };
  snapshot.incidentLedger.overflowCount = 0;
  return snapshot;
}

function issueLaneSnapshot(now = Date.now()): OperationsSnapshot {
  const snapshot = createSevenGroupOperationsTestSnapshot(now);
  const template = snapshot.findings[0];
  snapshot.briefing = {
    tone: "urgent",
    text: "One decision needs you, one issue is being handled, and one issue is being watched.",
  };
  snapshot.overallStatus = "blocked";
  snapshot.findings = [
    {
      ...template,
      id: "workflow:needs-user",
      severity: "critical",
      category: "workflow",
      title: "Release approval needed",
      disposition: "needs_user",
      responseState: "waiting_for_user",
      ownerId: "You",
      impact: "The release remains paused until you approve it.",
      nextAction: "Review the release decision.",
    },
    {
      ...template,
      id: "agent:handling",
      severity: "warning",
      category: "agent",
      title: "OpenClaw is retrying an agent",
      disposition: "handling",
      responseState: "in_progress",
      ownerId: "OpenClaw",
      impact: "One agent is temporarily delayed while OpenClaw retries it.",
      nextAction: "No action is needed while the retry is active.",
    },
    {
      ...template,
      id: "monitor:watching",
      severity: "info",
      category: "monitor",
      title: "Response delay is being watched",
      disposition: "watching",
      responseState: "monitoring",
      evidenceState: "last_known",
      ownerId: "OpenClaw",
      impact: "The last measurement was elevated and remains under observation.",
      nextAction: "Wait for the next deterministic sweep.",
    },
  ];
  snapshot.summary = {
    ...snapshot.summary,
    findings: 3,
    actionableFindings: 3,
    historicalFindings: 0,
    needsUserFindings: 1,
    handlingFindings: 1,
    watchingFindings: 1,
    criticalFindings: 1,
  };
  snapshot.collections.findings = { total: 3, shown: 3, truncated: false };
  return snapshot;
}

function automaticRemediationSnapshot(now = Date.now()): OperationsSnapshot {
  const snapshot = issueLaneSnapshot(now);
  const finding = snapshot.findings[1]!;
  const remediation = {
    id: "repair-1",
    findingId: finding.id,
    findingTitle: finding.title,
    findingCategory: "cron" as const,
    findingEntityId: "cron-1",
    impact: finding.impact,
    recipeId: "cron.pause-repeated-failures.v1",
    risk: "medium" as const,
    status: "completed" as const,
    ownerId: "OpenClaw",
    exactRepair: "Pause the exact failing schedule.",
    progress: "Repair completed and deterministic verification passed.",
    result: "Schedule cron-1 is paused after repeated failures.",
    evidence: ["Schedule cron-1 is paused.", "Read-back verified disabled."],
    rollback: "Re-enable the same schedule.",
    undoAvailable: true,
    undoAction: "cron.enable" as const,
    undoTargetId: "cron-1",
    automatic: true,
    startedAt: now - 10_000,
    updatedAt: now - 5_000,
    completedAt: now - 5_000,
  };
  snapshot.findings[1] = {
    ...finding,
    category: "cron",
    entityId: "cron-1",
    remediation,
  };
  snapshot.remediationHistory = [remediation];
  snapshot.reconciler = {
    ...snapshot.reconciler,
    mode: "supervised",
    autoRemediationEnabled: true,
  };
  return snapshot;
}

function largeInventorySnapshot(now = Date.now()): OperationsSnapshot {
  const snapshot = issueLaneSnapshot(now);
  const templates = snapshot.findings;
  snapshot.findings = Array.from({ length: 6 }, (_, index) => ({
    ...templates[index % templates.length],
    id: `bounded-finding-${index}`,
    title: `Bounded issue ${index + 1}`,
  }));
  snapshot.summary = {
    ...snapshot.summary,
    agents: 1_000,
    cronJobs: 200,
    skills: 427,
    findings: 427,
    actionableFindings: 427,
    needsUserFindings: 300,
    handlingFindings: 100,
    watchingFindings: 27,
    criticalFindings: 100,
  };
  snapshot.collections.agents = { total: 1_000, shown: snapshot.agents.length, truncated: true };
  snapshot.collections.findings = { total: 427, shown: 6, truncated: true };
  snapshot.collections.skills = { total: 427, shown: 1, truncated: true };
  snapshot.cronJobs = Array.from({ length: 9 }, (_, index) => ({
    ...snapshot.cronJobs[0],
    id: `cron-${index + 1}`,
    name: `Bounded schedule ${index + 1}`,
  }));
  snapshot.collections.cronJobs = { total: 200, shown: 9, truncated: true };
  snapshot.processes = Array.from({ length: 30 }, (_, index) => ({
    ...snapshot.processes[0],
    pid: 1_000 + index,
    command: `bounded-process-${index + 1}`,
    rssBytes: (30 - index) * 1024 ** 2,
  }));
  snapshot.collections.processes = { total: 45, shown: 30, truncated: true };
  return snapshot;
}

function legacySnapshot(snapshot: OperationsSnapshot): OperationsSnapshotV1Result {
  const summary = snapshot.summary;
  return {
    schema: "openclaw.operations-room.v1",
    generatedAt: snapshot.generatedAt,
    qualityTarget: 93,
    qualityScore: snapshot.qualityScore,
    overallStatus: snapshot.overallStatus,
    summary: {
      agents: summary.agents,
      workingAgents: summary.workingAgents,
      attentionAgents: summary.attentionAgents,
      tasks: summary.tasks,
      activeTasks: summary.activeTasks,
      failedTasks: summary.failedTasks,
      workflows: summary.workflows,
      activeWorkflows: summary.activeWorkflows,
      cronJobs: summary.cronJobs,
      failingCronJobs: summary.failingCronJobs,
      plugins: summary.plugins,
      skills: summary.skills,
      tools: summary.tools,
      models: summary.models,
      findings: summary.findings,
      criticalFindings: summary.criticalFindings,
    },
    host: snapshot.host,
    agents: snapshot.agents.map((agent) => ({
      id: agent.id,
      ...(agent.name ? { name: agent.name } : {}),
      workspace: agent.workspace,
      duty: agent.duty,
      status: agent.status,
      ...(agent.model ? { model: agent.model } : {}),
      fallbackModels: agent.fallbackModels,
      activeTaskCount: agent.activeTaskCount,
      blockedTaskCount: agent.blockedTaskCount,
      ...(agent.latestTask ? { latestTask: agent.latestTask } : {}),
      ...(agent.latestActivityAt ? { latestActivityAt: agent.latestActivityAt } : {}),
      heartbeat: agent.heartbeat,
      memoryBytes: agent.memoryBytes,
      memoryAttribution: agent.memoryAttribution,
    })),
    tasks: snapshot.tasks,
    workflows: snapshot.workflows.map(({ hasWaitState: _hasWaitState, ...workflow }) => workflow),
    cronJobs: snapshot.cronJobs,
    skills: snapshot.skills.map(({ availability: _availability, ...entry }) => entry),
    plugins: snapshot.plugins.map(({ availability: _availability, ...entry }) => entry),
    tools: snapshot.tools.map(({ availability: _availability, ...entry }) => entry),
    models: snapshot.models.map(({ availability: _availability, ...entry }) => entry),
    processes: snapshot.processes,
    findings: snapshot.findings
      .filter((finding) => finding.category !== "monitor")
      .map((finding) => legacyFinding(finding)),
    reconciler: {
      mode: snapshot.reconciler.mode,
      autoRemediationEnabled: false,
      intervalMs: snapshot.reconciler.intervalMs,
      lastSweepAt: snapshot.reconciler.lastSweepAt ?? snapshot.generatedAt,
      nextSweepAt: snapshot.reconciler.nextSweepAt ?? snapshot.generatedAt,
      recommendedActionCount: snapshot.reconciler.recommendedActionCount,
      ruleCount: snapshot.reconciler.ruleCount,
      note: snapshot.reconciler.note,
    },
    controls: snapshot.controls,
  };
}

function commandOutput(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

async function artifactEvidence(fileName: string) {
  const filePath = path.join(artifactDir, fileName);
  const [contents, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    file: fileName,
    bytes: metadata.size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function seedOperationsPreferences(page: Page, lastVisitedAt: number): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch {
        // The script reruns for every frame; opaque frames may not expose storage.
      }
    },
    {
      key: preferencesKey,
      value: { agentSort: "priority", lastVisitedAt, pinnedAgentIds: [] },
    },
  );
}

function actionPreview(action: "cron.run" | "cron.disable", expiresAt: number) {
  return {
    token: `operations-preview-${action}`,
    action,
    targetId: "cron-1",
    summary: action === "cron.run" ? "Run Health sweep now." : "Pause Health sweep.",
    risk: "low",
    expiresAt,
    requiresConfirmation: true,
  };
}

function actionReceipt(action: "cron.run" | "cron.disable", status: ActionStatus, summary: string) {
  return {
    action,
    targetId: "cron-1",
    status,
    summary,
    appliedAt: Date.now(),
  };
}

async function installOperationsGateway(
  page: Page,
  options: {
    snapshot?: OperationsSnapshot;
    runReceipt?: ReturnType<typeof actionReceipt>;
    disableReceipt?: ReturnType<typeof actionReceipt>;
  } = {},
): Promise<MockGatewayControls> {
  const snapshot = options.snapshot ?? createSevenGroupOperationsTestSnapshot();
  return installMockGateway(page, {
    featureMethods: [
      "operations.snapshot.v2",
      "operations.snapshot",
      "operations.action.preview",
      "operations.action.apply",
    ],
    methodResponses: {
      "operations.snapshot.v2": snapshot,
      "operations.action.preview": {
        cases: [
          {
            match: { action: "cron.run", targetId: "cron-1" },
            response: actionPreview("cron.run", Date.now() + 60_000),
          },
          {
            match: { action: "cron.disable", targetId: "cron-1" },
            response: actionPreview("cron.disable", Date.now() - 1_000),
          },
        ],
      },
      "operations.action.apply": {
        cases: [
          {
            match: { action: "cron.run", targetId: "cron-1" },
            response:
              options.runReceipt ?? actionReceipt("cron.run", "applied", "Health sweep started."),
          },
          {
            match: { action: "cron.disable", targetId: "cron-1" },
            response:
              options.disableReceipt ??
              actionReceipt("cron.disable", "applied", "Health sweep paused."),
          },
        ],
      },
    },
  });
}

async function waitForOperationsRoom(page: Page, briefing: string): Promise<void> {
  await page.locator(".operations-room").waitFor();
  const currentBriefing = page.locator(".operations-briefing > div > p").first();
  await currentBriefing.waitFor();
  await expect
    .poll(() => currentBriefing.textContent())
    .toSatisfy((text) =>
      [
        briefing,
        "The current overview cannot be confirmed. Review the source-specific status below.",
      ].includes(text?.trim() ?? ""),
    );
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function undersizedOperationTargets(page: Page): Promise<string[]> {
  return page.locator(".operations-room").evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>("button, a[href], input, select, summary")]
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .filter(({ rect }) => rect.width < 43.5 || rect.height < 43.5)
      .map(
        ({ element, rect }) =>
          `${element.tagName.toLowerCase()}:${element.textContent?.trim() || element.getAttribute("aria-label") || "unlabelled"}:${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
      ),
  );
}

async function contrastRatio(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((target, targetSelector) => {
      type Rgb = { r: number; g: number; b: number; a: number };
      const parse = (value: string): Rgb | null => {
        const rgb = value.match(
          /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
        );
        if (rgb) {
          return {
            r: Number(rgb[1]) / 255,
            g: Number(rgb[2]) / 255,
            b: Number(rgb[3]) / 255,
            a: rgb[4] == null ? 1 : Number(rgb[4]),
          };
        }
        const srgb = value.match(
          /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/,
        );
        return srgb
          ? {
              r: Number(srgb[1]),
              g: Number(srgb[2]),
              b: Number(srgb[3]),
              a: srgb[4] == null ? 1 : Number(srgb[4]),
            }
          : null;
      };
      const foreground = parse(getComputedStyle(target).color);
      let background: Rgb | null = null;
      for (let node: Element | null = target; node; node = node.parentElement) {
        const candidate = parse(getComputedStyle(node).backgroundColor);
        if (candidate && candidate.a > 0.99) {
          background = candidate;
          break;
        }
      }
      if (!foreground || !background) {
        throw new Error(`Could not resolve contrast colors for ${targetSelector}`);
      }
      const luminance = (color: Rgb) => {
        const channel = (value: number) =>
          value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
      };
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    }, selector);
}

async function closeContext(context: BrowserContext, diagnostics: Diagnostics): Promise<void> {
  await context.close();
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.consoleErrors).toEqual([]);
}

describeControlUiE2e("Operations Room mocked Gateway E2E", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(
        `Playwright Chromium is not installed or cannot start at ${chromiumExecutablePath}. Run \`pnpm --dir ui exec playwright install --with-deps chromium\`, or set OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
      );
    }
    await rm(artifactDir, { force: true, recursive: true });
    await mkdir(artifactDir, { recursive: true });
    proofStartedAt = new Date().toISOString();
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("proves the five-control hierarchy, seven-group order, visit boundary, safe history, and guarded success", async () => {
    const context = await browser.newContext({
      colorScheme: "light",
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 1000, width: 1440 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const now = Date.now();
    const snapshot = withBoundedIncidentHistory(createSevenGroupOperationsTestSnapshot(now));
    await seedOperationsPreferences(page, now - 45_000);
    const gateway = await installOperationsGateway(page, { snapshot });

    try {
      const response = await page.goto(`${server.baseUrl}operations`);
      expect(response?.status()).toBe(200);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      expect(await page.locator("body").textContent()).not.toContain(
        OPERATIONS_RAW_PROMPT_SENTINEL,
      );
      expect(await page.locator(".operations-quick-link").count()).toBe(5);

      const groupOrder = await page
        .locator(".operations-agent-group")
        .evaluateAll((groups) =>
          groups.map((group) =>
            [...group.classList]
              .find((name) => name.startsWith("operations-agent-group--"))
              ?.replace("operations-agent-group--", ""),
          ),
        );
      expect(groupOrder).toEqual([
        "urgent",
        "attention",
        "working",
        "waiting",
        "recent",
        "ready",
        "off",
      ]);
      expect(await page.locator(".operations-agent-group--ready").getAttribute("open")).toBeNull();
      const urgentAgent = page.locator(".operations-agent-group--urgent .operations-agent-row");
      expect(await urgentAgent.locator("summary").textContent()).toContain(
        "An urgent issue needs your decision.",
      );
      await urgentAgent.locator("summary").click();
      await urgentAgent.getByText("What needs attention", { exact: true }).waitFor();
      await urgentAgent.getByRole("button", { exact: true, name: "Review issue" }).waitFor();

      const attentionLink = page.locator('.operations-quick-link[href*="section=attention"]');
      await attentionLink.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe("attention");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
        .toBe("operations-attention");
      await page.goBack();
      await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBeNull();
      await page.goForward();
      await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe("attention");

      expect(await page.locator("#operations-changes").textContent()).toContain(
        "Static UI inspection",
      );
      await page.getByRole("link", { exact: true, name: "Agents" }).first().click();
      await expect.poll(() => new URL(page.url()).pathname.endsWith("/agents")).toBe(true);
      await page.getByRole("link", { exact: true, name: "Operations Room" }).first().click();
      await waitForOperationsRoom(page, snapshot.briefing.text);
      expect(await page.locator("#operations-changes").textContent()).not.toContain(
        "Static UI inspection",
      );

      await page.locator(".operations-sort").selectOption("name");
      const readyGroup = page.locator(".operations-agent-group--ready");
      await readyGroup.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      const readyRow = readyGroup.locator(".operations-agent-row", { hasText: "Ready Agent" });
      await readyRow.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      await readyRow.locator(".operations-pin").click();
      expect(await readyRow.locator(".operations-pin").getAttribute("aria-pressed")).toBe("true");

      await page.locator("#operations-more > summary").focus();
      await page.keyboard.press("Enter");
      await page.locator(".operations-activity-history > summary").focus();
      await page.keyboard.press("Enter");
      await page
        .locator(".operations-activity-history")
        .getByText("Static UI inspection", { exact: true })
        .waitFor();
      await page.locator(".operations-incident-history > summary").focus();
      await page.locator(".operations-incident-history > summary").click();
      expect(
        await page.locator(".operations-incident-history").getAttribute("open"),
      ).not.toBeNull();
      expect(await page.locator(".operations-incident-history__item").count()).toBe(16);
      expect(await page.locator(".operations-incident-history").textContent()).toContain(
        "Showing 16 of 20",
      );
      expect(await page.locator(".operations-incident-history").textContent()).toContain(
        "3 older incidents are outside the retained history window.",
      );
      const warning = page.locator(".operations-incident-history__item").first();
      expect(await warning.locator(".operations-status").textContent()).toContain("Warning");
      expect(await warning.locator(".operations-status__icon").textContent()).toBe("!");

      page.once("dialog", (dialog) => void dialog.accept());
      await page
        .locator(".operations-automation-row", { hasText: "Health sweep" })
        .getByRole("button", { exact: true, name: "Run Health sweep now" })
        .click();
      await page.getByText("Health sweep started.", { exact: true }).waitFor();
      expect((await gateway.getRequests("operations.action.preview")).at(-1)?.params).toEqual({
        action: "cron.run",
        targetId: "cron-1",
      });
      expect((await gateway.getRequests("operations.action.apply")).at(-1)?.params).toEqual({
        action: "cron.run",
        targetId: "cron-1",
        token: "operations-preview-cron.run",
      });

      await page.reload();
      await waitForOperationsRoom(page, snapshot.briefing.text);
      expect(await page.locator(".operations-sort").inputValue()).toBe("name");
      await page.screenshot({ fullPage: true, path: path.join(artifactDir, "desktop-light.png") });
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks(
      "agentGroupOrder",
      "browserHistoryAndFocus",
      "incidentHistoryBoundedAndSafe",
      "primaryControls",
      "rawPromptAbsent",
      "sameSessionVisitBoundary",
    );
  });

  it("proves direct section links and restores focus through browser history", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = createSevenGroupOperationsTestSnapshot();
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations?section=system`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
        .toBe("operations-system");
      expect(
        await page
          .locator('.operations-quick-link[href*="section=system"]')
          .getAttribute("aria-current"),
      ).toBe("location");

      const workingLink = page.locator('.operations-quick-link[href*="section=working"]');
      await workingLink.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe("working");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
        .toBe("operations-working");

      await page.goBack();
      await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe("system");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
        .toBe("operations-system");

      await page.goForward();
      await expect.poll(() => new URL(page.url()).searchParams.get("section")).toBe("working");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
        .toBe("operations-working");
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("browserHistoryAndFocus");
  });

  it("proves 320px reflow, effective 200% zoom, computed targets, reduced motion, and live announcements", async () => {
    const context = await browser.newContext({
      colorScheme: "light",
      locale: "en-US",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      viewport: { height: 900, width: 320 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = createSevenGroupOperationsTestSnapshot();
    await seedOperationsPreferences(page, snapshot.generatedAt - 30_000);
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      await assertNoHorizontalOverflow(page);
      expect(await undersizedOperationTargets(page)).toEqual([]);
      expect(await page.locator(".operations-briefing").getAttribute("aria-live")).toBe("polite");
      expect(await page.locator(".operations-briefing").getAttribute("aria-atomic")).toBe("true");
      expect(
        await page
          .locator(".operations-quick-link")
          .first()
          .evaluate((element) => ({
            animation: getComputedStyle(element).animationDuration,
            transition: getComputedStyle(element).transitionDuration,
          })),
      ).toEqual({ animation: "0s", transition: "0s" });

      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ fullPage: true, path: path.join(artifactDir, "mobile-320.png") });
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks(
      "ariaLive",
      "computedTouchTargets44px",
      "reducedMotion",
      "responsive320px",
      "zoom200Percent",
    );
  });

  it("keeps task and workflow detail in-page when Workboard is disabled", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = createSevenGroupOperationsTestSnapshot();
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const facts = page.locator("#operations-working .operations-work-facts button");

      await facts.filter({ hasText: "Tasks" }).click();
      expect(new URL(page.url()).pathname).toBe("/operations");
      expect(await page.locator("#operations-more").getAttribute("open")).not.toBeNull();
      expect(
        await page.locator(".operations-activity-history").getAttribute("open"),
      ).not.toBeNull();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""))
        .toContain("Task activity");

      await facts.filter({ hasText: "Workflows" }).click();
      expect(new URL(page.url()).pathname).toBe("/operations");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""))
        .toContain("Workflows");
      expect(await page.getByRole("button", { name: "Open Workboard" }).count()).toBe(0);
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("disabledWorkboardFallsBackInPage");
  });

  it("proves readable light and dark themes plus RTL logical layout", async () => {
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        colorScheme,
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1024 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const diagnostics = collectDiagnostics(page);
      const snapshot = createSevenGroupOperationsTestSnapshot();
      await installOperationsGateway(page, { snapshot });
      try {
        await page.goto(`${server.baseUrl}operations`);
        await waitForOperationsRoom(page, snapshot.briefing.text);
        expect(await contrastRatio(page, ".operations-quick-link strong")).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(await contrastRatio(page, ".operations-briefing p")).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({
          fullPage: true,
          path: path.join(artifactDir, `desktop-${colorScheme}.png`),
        });
      } finally {
        await closeContext(context, diagnostics);
      }
    }

    const rtlContext = await browser.newContext({
      colorScheme: "light",
      locale: "ar",
      serviceWorkers: "block",
      viewport: { height: 900, width: 320 },
    });
    const rtlPage = await rtlContext.newPage();
    rtlPage.setDefaultTimeout(10_000);
    const rtlDiagnostics = collectDiagnostics(rtlPage);
    const rtlSnapshot = createSevenGroupOperationsTestSnapshot();
    await installOperationsGateway(rtlPage, { snapshot: rtlSnapshot });
    try {
      await rtlPage.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(rtlPage, rtlSnapshot.briefing.text);
      await expect.poll(() => rtlPage.evaluate(() => document.documentElement.dir)).toBe("rtl");
      expect(
        await rtlPage
          .locator(".operations-room")
          .evaluate((node) => getComputedStyle(node).direction),
      ).toBe("rtl");
      await assertNoHorizontalOverflow(rtlPage);
      await rtlPage.screenshot({ fullPage: true, path: path.join(artifactDir, "mobile-rtl.png") });
    } finally {
      await closeContext(rtlContext, rtlDiagnostics);
    }
    markChecks("contrastLightAndDark", "rtl");
  });

  it("fails closed for stale and partial snapshots and announces rejected or expired actions", async () => {
    for (const condition of ["stale", "partial"] as const) {
      const context = await browser.newContext({
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1024 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const diagnostics = collectDiagnostics(page);
      const snapshot = createSevenGroupOperationsTestSnapshot();
      snapshot.findings = [];
      snapshot.summary = {
        ...snapshot.summary,
        findings: 0,
        actionableFindings: 0,
        historicalFindings: 0,
        needsUserFindings: 0,
        handlingFindings: 0,
        watchingFindings: 0,
        criticalFindings: 0,
      };
      snapshot.collections.findings = { total: 0, shown: 0, truncated: false };
      snapshot.overallStatus = "healthy";
      if (condition === "stale") {
        snapshot.freshness.status = "stale";
      } else {
        snapshot.completeness = {
          status: "partial",
          unavailableSources: ["processes"],
          fallbackSources: ["models"],
        };
      }
      await installOperationsGateway(page, { snapshot });
      try {
        await page.goto(`${server.baseUrl}operations`);
        await waitForOperationsRoom(
          page,
          "The current overview cannot be confirmed. Review the source-specific status below.",
        );
        await page.locator("#operations-attention .operations-status--unknown").first().waitFor();
        expect(await page.locator("#operations-attention .operations-good").count()).toBe(0);
        await page.locator(".operations-briefing--unknown").waitFor();
        await page.getByText("Attention status cannot be confirmed", { exact: true }).waitFor();
        const guardedControls = page.locator(
          '.operations-room button[aria-label^="Cancel"], .operations-room button[aria-label^="Run"], .operations-room button[aria-label^="Pause"]',
        );
        expect(await guardedControls.count()).toBeGreaterThan(0);
        const enabledGuardedControls = await guardedControls.evaluateAll((buttons) =>
          buttons
            .filter((button) => button instanceof HTMLButtonElement && !button.disabled)
            .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""),
        );
        expect(enabledGuardedControls).toEqual([]);
        if (condition === "partial") {
          await page
            .getByText("Unavailable sources: Processes.", { exact: true })
            .first()
            .waitFor();
          await page.getByText("Fallback data sources: Models.", { exact: true }).first().waitFor();
        }
      } finally {
        await closeContext(context, diagnostics);
      }
    }

    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = createSevenGroupOperationsTestSnapshot();
    await installOperationsGateway(page, {
      snapshot,
      runReceipt: actionReceipt("cron.run", "rejected", "The action was rejected."),
      disableReceipt: actionReceipt("cron.disable", "rejected", "The preview expired."),
    });
    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const row = page.locator(".operations-automation-row", { hasText: "Health sweep" });

      page.once("dialog", (dialog) => void dialog.accept());
      await row.getByRole("button", { exact: true, name: "Run Health sweep now" }).click();
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("alert").textContent()).toContain("The action was rejected.");
      expect(await page.locator(".callout.success").count()).toBe(0);

      page.once("dialog", (dialog) => void dialog.accept());
      await row.getByRole("button", { exact: true, name: "Pause Health sweep" }).click();
      await expect
        .poll(async () => page.getByRole("alert").textContent())
        .toContain("The preview expired.");
      expect(await page.locator(".callout.success").count()).toBe(0);
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("staleAndPartialFailClosed", "guardedActionExpired");
  });

  it("proves the zero-issue state and preserves last-known truth when the Gateway goes offline", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = zeroIssueSnapshot();
    const gateway = await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      await page.getByText("Nothing needs your attention.", { exact: true }).waitFor();
      await page
        .getByText("No OpenClaw agent is actively working right now.", { exact: true })
        .waitFor();
      expect(await page.locator("#operations-attention .operations-good").count()).toBe(1);
      expect(
        await page.locator('.operations-quick-link[href*="section=attention"]').textContent(),
      ).toContain("Decisions needed 0");
      expect(
        await page.locator('.operations-quick-link[href*="section=working"]').textContent(),
      ).toContain("OpenClaw work 0");

      await gateway.setAcceptingConnections(false);
      await gateway.closeLatest(1012, "simulated offline state");
      await expect.poll(() => gateway.getSocketCount()).toBeGreaterThan(1);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      await page.locator(".operations-last-known-briefing > summary").click();
      await page.getByText(snapshot.briefing.text, { exact: true }).waitFor();
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("offlineState", "zeroIssueState");
  });

  it("separates critical, warning, and watched issues into explicit non-color lanes", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = issueLaneSnapshot();
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const lanes = [
        {
          title: "Needs you",
          finding: "Release approval needed",
          severity: "Critical",
          icon: "!",
          owner: "You",
          response: "Waiting for you",
          impact: "The release remains paused until you approve it.",
          nextAction: "Review the release decision.",
        },
        {
          title: "OpenClaw is handling",
          finding: "OpenClaw is retrying an agent",
          severity: "Warning",
          icon: "!",
          owner: "OpenClaw",
          response: "In progress",
          impact: "One agent is temporarily delayed while OpenClaw retries it.",
          nextAction: "No action is needed while the retry is active.",
        },
        {
          title: "Watching",
          finding: "Response delay is being watched",
          severity: "Information",
          icon: "○",
          owner: "OpenClaw",
          response: "Monitoring",
          impact: "The last measurement was elevated and remains under observation.",
          nextAction: "Wait for the next deterministic sweep.",
        },
      ] as const;
      for (const scenario of lanes) {
        const lane = page.locator(".operations-attention-lane", { hasText: scenario.title });
        const finding = lane.locator(".operations-issue", { hasText: scenario.finding });
        await finding.getByText(scenario.finding, { exact: true }).waitFor();
        expect(await finding.locator(".operations-issue__status").textContent()).toContain(
          scenario.severity,
        );
        expect(await finding.locator(".operations-status__icon").last().textContent()).toBe(
          scenario.icon,
        );
        expect(await lane.locator(".operations-count").textContent()).toBe("1");
        expect(await finding.locator(".operations-issue__handoff").textContent()).toContain(
          `Who owns this`,
        );
        expect(await finding.locator(".operations-issue__handoff").textContent()).toContain(
          scenario.owner,
        );
        expect(await finding.locator(".operations-issue__handoff").textContent()).toContain(
          scenario.nextAction,
        );

        const details = finding.locator("details");
        await details.locator("summary").focus();
        await page.keyboard.press("Enter");
        expect(await details.getAttribute("open")).not.toBeNull();
        expect(await details.locator("summary").textContent()).toContain("Recommended resolution");
        expect(
          (await details.locator(".operations-resolution__preview-note").textContent())
            ?.replace(/\s+/g, " ")
            .trim(),
        ).toBe("Recommendation only. Nothing changes until an eligible repair is approved.");
        expect(await details.textContent()).toContain("Not now");
        await details.getByText(scenario.owner, { exact: true }).waitFor();
        await details.getByText(scenario.response, { exact: true }).waitFor();
        await details.getByText(scenario.impact, { exact: true }).waitFor();
        await details.getByText(scenario.nextAction, { exact: true }).waitFor();
        await details
          .getByText("You must approve any change before it happens.", {
            exact: true,
          })
          .waitFor();
      }
      const investigation = page
        .locator(".operations-issue", { hasText: "Release approval needed" })
        .getByRole("button", { name: "Investigate with local AI" });
      await investigation.waitFor();
      expect(
        await page
          .locator(".operations-issue", { hasText: "Release approval needed" })
          .getByRole("link", { name: "Investigate with local AI" })
          .count(),
      ).toBe(0);
      expect(
        await page
          .locator(".operations-issue", { hasText: "Release approval needed" })
          .getByText("Opening the draft does not send it or start work.", { exact: true })
          .count(),
      ).toBe(0);
      const watchedStatus = await page
        .locator(".operations-issue", { hasText: "Response delay is being watched" })
        .locator(".operations-issue__status")
        .textContent();
      expect(watchedStatus).toContain("Last known");
      await page.getByText("Urgent", { exact: true }).first().waitFor();
      expect(
        await page.locator('.operations-quick-link[href*="section=attention"]').textContent(),
      ).toContain("1 urgent");
      expect(await page.locator("#operations-attention .operations-good").count()).toBe(0);
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks(
      "attentionOwnershipAndResponse",
      "issueResolutionWorkflow",
      "issueLanesAndNonColorCues",
      "keyboardOnlyIssueJourney",
    );
  });

  it("shows automatic repair progress, evidence, rollback, and recent completion", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1_024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = automaticRemediationSnapshot();
    await seedOperationsPreferences(page, snapshot.generatedAt - 30_000);
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const issue = page.locator(".operations-issue", {
        hasText: "OpenClaw is retrying an agent",
      });
      await issue.getByText("Recommended resolution", { exact: true }).click();
      await issue.getByText("Pause the exact failing schedule.", { exact: true }).waitFor();
      await issue.getByText("Read-back verified disabled.", { exact: true }).waitFor();
      await issue.getByText("Re-enable the same schedule.", { exact: true }).waitFor();
      await issue.getByRole("button", { name: "Undo this repair" }).waitFor();
      await page
        .locator("#operations-changes")
        .getByText("OpenClaw repaired and verified this issue", { exact: false })
        .waitFor();
      const completedRepair = page.locator("#operations-changes .operations-change--remediation");
      await completedRepair.getByText("View repair details", { exact: true }).click();
      await completedRepair
        .getByText("Available through a guarded preview", { exact: true })
        .waitFor();
      await completedRepair.getByRole("button", { name: "Undo this repair" }).waitFor();
      await page
        .getByText("OpenClaw may run this approved repair automatically", { exact: false })
        .first()
        .waitFor();
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("automaticRemediationSafety");
  });

  it("starts owner acceptance in the Operations Room and generates the receipt on Finish", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 1_000, width: 1_280 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = issueLaneSnapshot();
    await installOperationsGateway(page, { snapshot });
    const params = new URLSearchParams({
      ownerAcceptance: "1",
      campaignId: "or2-owner-browser-e2e",
      candidateSha: "a".repeat(40),
      fixtureSha256: "b".repeat(64),
      participantId: "c".repeat(64),
    });

    try {
      await page.goto(`${server.baseUrl}operations?${params.toString()}`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const acceptance = page.locator("operations-owner-acceptance");
      await acceptance.getByRole("button", { name: "Begin 60-second check" }).click();
      await acceptance.getByText("seconds left", { exact: true }).waitFor();

      await acceptance.getByRole("button", { name: "Overall: Urgent" }).click();
      await acceptance
        .getByRole("button", {
          name: `OpenClaw: ${snapshot.summary.workingAgents} · Local AI: ${snapshot.host.localModelProcessCount}`,
        })
        .click();
      await acceptance
        .getByRole("button", {
          name: "You — Review the release decision.",
        })
        .click();

      const primaryIssue = page.locator(".operations-issue--primary");
      await primaryIssue.getByText("Recommended resolution", { exact: true }).click();
      await primaryIssue.getByRole("button", { name: "Not now" }).click();
      await acceptance
        .getByText("Recommendation reviewed and safely deferred", { exact: true })
        .waitFor();
      await acceptance.getByRole("button", { name: "Finish and create receipt" }).click();
      await acceptance.getByText("Owner check passed", { exact: true }).waitFor();
      expect(
        await acceptance.getByRole("link", { name: "Download receipt" }).getAttribute("download"),
      ).toContain("operations-room-owner-acceptance-aaaaaaaaaaaa.json");
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("ownerAcceptanceInUi");
  });

  it("discloses every bounded large-inventory count and keeps source drill-through available", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 1_000, width: 1_280 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = largeInventorySnapshot();
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const attention = page.locator("#operations-attention");
      await attention
        .getByText(
          "Showing 6 of 427 current issues in this bounded snapshot. Source views provide related records.",
          { exact: true },
        )
        .waitFor();
      await attention.getByText("2 of 300", { exact: true }).waitFor();
      await attention.getByText("2 of 100", { exact: true }).waitFor();
      await attention.getByText("2 of 27", { exact: true }).waitFor();
      expect(await attention.locator(".operations-bounded-note button").count()).toBe(5);
      expect(
        await page.locator('.operations-quick-link[href*="section=agents"]').textContent(),
      ).toContain("1000 agents");
      expect(
        await page.locator('.operations-quick-link[href*="section=agents"]').textContent(),
      ).toContain("Showing 7");
      await page
        .getByText("Showing 8 of 200. Open Cron Jobs to review all scheduled work.", {
          exact: true,
        })
        .waitFor();

      await page.locator("#operations-more > summary").click();
      const skills = page.locator(".operations-catalog", { hasText: "Skills" }).first();
      expect(await skills.locator(":scope > summary").textContent()).toContain("Showing 1 of 427");
      await page
        .getByText("Showing the 30 largest of 45 accepted processes.", { exact: true })
        .waitFor();
      expect(await page.locator(".operations-process").count()).toBe(30);
      expect(await page.locator(".operations-automation-row").count()).toBe(8);
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("largeInventoryDisclosed");
  });

  it("renders available, partial, omitted, and unavailable process-probe states truthfully", async () => {
    const scenarios = [
      {
        name: "available",
        configure(snapshot: OperationsSnapshot) {
          snapshot.freshness.sources.processes = {
            status: "available",
            observedAt: snapshot.generatedAt,
          };
        },
        assertions: ["node", "Arguments are never collected."],
      },
      {
        name: "partial",
        configure(snapshot: OperationsSnapshot) {
          snapshot.freshness.sources.processes = {
            status: "fallback",
            observedAt: snapshot.generatedAt,
          };
          snapshot.completeness = {
            status: "partial",
            unavailableSources: [],
            fallbackSources: ["processes"],
          };
          snapshot.collections.processes = { total: 3, shown: 1, truncated: true, rejected: 2 };
        },
        assertions: [
          "Fallback data sources: Processes.",
          "2 process rows could not be read and were excluded.",
          "Showing the 1 largest of 3 accepted processes.",
        ],
      },
      {
        name: "omitted",
        configure(snapshot: OperationsSnapshot) {
          snapshot.freshness.sources.processes = { status: "omitted" };
          snapshot.processes = [];
          snapshot.collections.processes = { total: 0, shown: 0, truncated: false };
        },
        assertions: ["Process inventory was not included in this snapshot."],
      },
      {
        name: "unavailable",
        configure(snapshot: OperationsSnapshot) {
          snapshot.freshness.sources.processes = { status: "unavailable" };
          snapshot.completeness = {
            status: "partial",
            unavailableSources: ["processes"],
            fallbackSources: [],
          };
          snapshot.processes = [];
          snapshot.collections.processes = { total: 0, shown: 0, truncated: false, rejected: 1 };
        },
        assertions: [
          "Unavailable sources: Processes.",
          "1 process row could not be read and was excluded.",
          "Process inventory cannot be confirmed from this snapshot.",
        ],
      },
    ] as const;

    for (const scenario of scenarios) {
      const context = await browser.newContext({
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1_024 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const diagnostics = collectDiagnostics(page);
      const snapshot = createSevenGroupOperationsTestSnapshot();
      scenario.configure(snapshot);
      await installOperationsGateway(page, { snapshot });
      try {
        await page.goto(`${server.baseUrl}operations`);
        await waitForOperationsRoom(page, snapshot.briefing.text);
        await page.locator("#operations-more > summary").click();
        for (const text of scenario.assertions) {
          await page.getByText(text, { exact: true }).last().waitFor();
        }
        if (snapshot.completeness.status === "partial") {
          expect(await page.locator("#operations-attention .operations-good").count()).toBe(0);
        }
      } finally {
        await closeContext(context, diagnostics);
      }
    }
    markChecks("processProbeStates");
  });

  it("fails the monitor closed and distinguishes a later successful sweep", async () => {
    const scenarios = [
      {
        name: "failed",
        configure(snapshot: OperationsSnapshot) {
          const finding = snapshot.findings[0];
          snapshot.findings = [
            {
              ...finding,
              id: "process:operations-monitor:health",
              category: "monitor",
              title: "Operations monitor has not completed a successful sweep",
              evidenceState: "last_known",
              disposition: "watching",
              responseState: "monitoring",
            },
          ];
          snapshot.summary = {
            ...snapshot.summary,
            findings: 1,
            actionableFindings: 1,
            historicalFindings: 0,
            needsUserFindings: 0,
            handlingFindings: 0,
            watchingFindings: 1,
          };
          snapshot.collections.findings = { total: 1, shown: 1, truncated: false };
          snapshot.freshness.sources.monitor = { status: "unavailable" };
          snapshot.completeness = {
            status: "partial",
            unavailableSources: ["monitor"],
            fallbackSources: [],
          };
          snapshot.reconciler.lastAttemptAt = snapshot.generatedAt;
          snapshot.reconciler.lastSweepAt = null;
          snapshot.reconciler.lastError = "Monitor stopped after a deterministic sweep failure.";
        },
        expectIssue: true,
      },
      {
        name: "recovered",
        configure(snapshot: OperationsSnapshot) {
          snapshot.freshness.sources.monitor = {
            status: "available",
            observedAt: snapshot.generatedAt,
          };
          snapshot.reconciler.lastAttemptAt = snapshot.generatedAt;
          snapshot.reconciler.lastSweepAt = snapshot.generatedAt;
          delete snapshot.reconciler.lastError;
        },
        expectIssue: false,
      },
    ] as const;

    for (const scenario of scenarios) {
      const context = await browser.newContext({
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1_024 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const diagnostics = collectDiagnostics(page);
      const snapshot = createSevenGroupOperationsTestSnapshot();
      scenario.configure(snapshot);
      await installOperationsGateway(page, { snapshot });
      try {
        await page.goto(`${server.baseUrl}operations`);
        await waitForOperationsRoom(page, snapshot.briefing.text);
        await page.locator("#operations-more > summary").click();
        await page.getByText(/Monitor: last attempt .*; last successful sweep .*/).waitFor();
        expect(await page.locator(".operations-monitor-warning").count()).toBe(
          scenario.expectIssue ? 1 : 0,
        );
        if (scenario.expectIssue) {
          await page
            .getByText("Monitor stopped after a deterministic sweep failure.", { exact: true })
            .waitFor();
          const monitorStatus = await page
            .locator(".operations-issue", {
              hasText: "Operations monitor has not completed a successful sweep",
            })
            .locator(".operations-issue__status")
            .textContent();
          expect(monitorStatus).toContain("Last known");
          expect(await page.locator("#operations-attention .operations-good").count()).toBe(0);
        }
      } finally {
        await closeContext(context, diagnostics);
      }
    }
    markChecks("monitorFailClosed");
  });

  it("proves guarded cancel, apply, replay rejection, expiration, and post-action refresh", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1_024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = createSevenGroupOperationsTestSnapshot();
    const gateway = await installOperationsGateway(page, {
      snapshot,
      disableReceipt: actionReceipt("cron.disable", "rejected", "The preview expired."),
    });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      const row = page.locator(".operations-automation-row", { hasText: "Health sweep" });
      const runNow = row.getByRole("button", { exact: true, name: "Run Health sweep now" });

      page.once("dialog", (dialog) => void dialog.dismiss());
      await runNow.click();
      await page.getByText("Action cancelled. Nothing changed.", { exact: true }).waitFor();
      expect(await gateway.getRequests("operations.action.preview")).toHaveLength(1);
      expect(await gateway.getRequests("operations.action.apply")).toHaveLength(0);

      const refreshed = structuredClone(snapshot);
      refreshed.generatedAt += 1_000;
      refreshed.snapshotId = `${snapshot.snapshotId}:post-action`;
      refreshed.briefing.text = "The health sweep started and the Operations Room refreshed.";
      await gateway.deferNext("operations.snapshot.v2");
      page.once("dialog", (dialog) => void dialog.accept());
      await runNow.click();
      await expect
        .poll(async () => (await gateway.getRequests("operations.action.apply")).length)
        .toBe(1);
      await expect
        .poll(async () => (await gateway.getRequests("operations.snapshot.v2")).length)
        .toBe(2);
      await gateway.resolveDeferred("operations.snapshot.v2", refreshed);
      await waitForOperationsRoom(page, refreshed.briefing.text);
      await page.getByText("Health sweep started.", { exact: true }).waitFor();

      await gateway.deferNext("operations.action.apply");
      page.once("dialog", (dialog) => void dialog.accept());
      await runNow.click();
      await expect
        .poll(async () => (await gateway.getRequests("operations.action.apply")).length)
        .toBe(2);
      await gateway.rejectDeferred("operations.action.apply", {
        code: "CONFLICT",
        message: "preview token already used",
      });
      await expect
        .poll(async () => page.getByRole("alert").textContent())
        .toContain("preview token already used");
      expect(await gateway.getRequests("operations.snapshot.v2")).toHaveLength(2);

      page.once("dialog", (dialog) => void dialog.accept());
      await row.getByRole("button", { exact: true, name: "Pause Health sweep" }).click();
      await expect
        .poll(async () => page.getByRole("alert").textContent())
        .toContain("The preview expired.");
      expect(await page.locator(".callout.success").count()).toBe(0);
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks(
      "guardedActionCancel",
      "guardedActionExpired",
      "guardedActionPreviewApply",
      "guardedActionReplayRejected",
      "postActionRefresh",
    );
  });

  it("uses the conservative V1 adapter only for an explicitly unsupported V2 method", async () => {
    const context = await browser.newContext({
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1_024 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const v1 = legacySnapshot(createSevenGroupOperationsTestSnapshot());
    const gateway = await installMockGateway(page, {
      deferredMethods: ["operations.snapshot.v2"],
      featureMethods: ["operations.snapshot.v2", "operations.snapshot"],
      methodResponses: { "operations.snapshot": v1 },
    });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await gateway.waitForRequest("operations.snapshot.v2");
      await gateway.rejectDeferred("operations.snapshot.v2", {
        code: "INVALID_REQUEST",
        message: "unknown method: operations.snapshot.v2",
      });
      await waitForOperationsRoom(
        page,
        "Showing a compatibility view from an older Gateway. Update it for verified live status.",
      );
      expect(await gateway.getRequests("operations.snapshot.v2")).toHaveLength(1);
      expect(await gateway.getRequests("operations.snapshot")).toHaveLength(1);
      await page.getByText("Partial data", { exact: true }).first().waitFor();
      await page
        .getByText("Gateway update needed for complete Operations data", { exact: true })
        .first()
        .waitFor();
      expect(await page.locator("body").textContent()).not.toContain(
        OPERATIONS_RAW_PROMPT_SENTINEL,
      );
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("legacyFallbackOnlyWhenUnsupported");
  });

  it("does not hide authentication, connectivity, validation, timeout, or collector errors behind V1", async () => {
    const scenarios = [
      { code: "UNAUTHORIZED", message: "authentication rejected" },
      { code: "UNAVAILABLE", message: "gateway offline" },
      { code: "INVALID_REQUEST", message: "snapshot validation failed" },
      { code: "TIMEOUT", message: "snapshot request timed out" },
      { code: "INTERNAL", message: "collector failed" },
    ] as const;

    for (const scenario of scenarios) {
      const context = await browser.newContext({
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 720, width: 1_024 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const diagnostics = collectDiagnostics(page);
      const gateway = await installMockGateway(page, {
        deferredMethods: ["operations.snapshot.v2"],
        featureMethods: ["operations.snapshot.v2", "operations.snapshot"],
      });
      try {
        await page.goto(`${server.baseUrl}operations`);
        await gateway.waitForRequest("operations.snapshot.v2");
        await gateway.rejectDeferred("operations.snapshot.v2", scenario);
        await page.getByText("Operations data unavailable", { exact: true }).waitFor();
        await page.getByText(scenario.message, { exact: false }).waitFor();
        expect(await gateway.getRequests("operations.snapshot")).toHaveLength(0);
        expect(await page.locator(".operations-briefing").count()).toBe(0);
      } finally {
        await closeContext(context, diagnostics);
      }
    }
    markChecks("noFallbackForOperationalErrors");
  });

  it("proves tablet reflow and the browser's increased-contrast mode", async () => {
    const context = await browser.newContext({
      colorScheme: "dark",
      forcedColors: "active",
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 1_024, width: 768 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const diagnostics = collectDiagnostics(page);
    const snapshot = issueLaneSnapshot();
    await installOperationsGateway(page, { snapshot });

    try {
      await page.goto(`${server.baseUrl}operations`);
      await waitForOperationsRoom(page, snapshot.briefing.text);
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
      await assertNoHorizontalOverflow(page);
      expect(await undersizedOperationTargets(page)).toEqual([]);
      expect(await page.locator(".operations-status__icon").first().isVisible()).toBe(true);
      expect((await page.locator(".operations-status__icon").allTextContents()).join("")).toContain(
        "!",
      );
      await page.screenshot({
        fullPage: true,
        path: path.join(artifactDir, "tablet-768-increased-contrast.png"),
      });
    } finally {
      await closeContext(context, diagnostics);
    }
    markChecks("increasedContrast", "responsiveTablet");
  });

  it("writes a machine-readable proof receipt", async () => {
    const failedChecks = Object.entries(proofChecks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    expect(failedChecks).toEqual([]);
    const artifactNames = [
      "desktop-light.png",
      "desktop-dark.png",
      "mobile-320.png",
      "mobile-rtl.png",
      "tablet-768-increased-contrast.png",
    ];
    const artifacts = await Promise.all(artifactNames.map(artifactEvidence));
    for (const artifact of artifacts) {
      expect(artifact.bytes).toBeGreaterThan(0);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const gitStatus = commandOutput("git", ["status", "--porcelain", "--untracked-files=no"]);
    const completedAt = new Date().toISOString();
    await writeFile(
      path.join(artifactDir, "receipt.json"),
      `${JSON.stringify(
        {
          artifacts,
          checks: proofChecks,
          commands: {
            canonicalFocused: "pnpm ui:smoke:operations-room:e2e",
            npmLifecycleEvent: process.env.npm_lifecycle_event ?? null,
            processArgv: process.argv.slice(1),
          },
          completedAt,
          result: "passed",
          route: "/operations",
          runtimeVersions: {
            chromium: browser.version(),
            node: process.version,
            v8: process.versions.v8,
          },
          schema: "openclaw.operations-room.e2e-receipt.v3",
          source: {
            ciRef: process.env.GITHUB_REF_NAME ?? null,
            ciSha: process.env.GITHUB_SHA ?? null,
            gitRef: commandOutput("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
            gitSha: commandOutput("git", ["rev-parse", "HEAD"]),
            workingTree: gitStatus == null ? "unknown" : gitStatus.length === 0 ? "clean" : "dirty",
          },
          startedAt: proofStartedAt,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  });
});

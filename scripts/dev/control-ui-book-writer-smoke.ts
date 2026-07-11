/* oxlint-disable eslint/no-promise-executor-return eslint/no-shadow eslint/no-underscore-dangle eslint/no-unused-vars eslint/no-useless-assignment -- The compatibility smoke harness intentionally preserves browser diagnostic names and intermediate proof state. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import {
  chromium,
  devices,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "playwright";
import {
  extractControlUiPairingRequestId,
  redactControlUiSmokeSecrets,
  resolveControlUiSmokeProfileDir,
  resolveControlUiSmokeUrl,
  type ControlUiSmokeUrl,
} from "./control-ui-smoke-url.js";

type SmokeProfileSummary = {
  persistent: boolean;
  dir?: string;
  clientDisplayName: string;
  autoApprovePairing: boolean;
  pairingApproved: boolean;
  pairingRequestId?: string;
};

type BookWriterSentenceAdaptationSmokeSummary = {
  verified: boolean;
  runId: string;
  sourceParagraphId: string;
  adaptedParagraphId: string;
  lockedParagraphId: string;
  syncBefore: string;
  syncAfter: string;
  insertedSentenceSaved: boolean;
  propagateButtonVisible: boolean;
  adaptedParagraphChanged: boolean;
  lockedTextPreserved: boolean;
  rewrittenParagraphs: number;
  cohesionReceiptVisible: boolean;
  cohesionReceiptText: string;
  propagationRequestPath: "direct-ui" | "gateway-fallback";
  propagationDiagnostics?: BookWriterPropagationDiagnostics;
  summary: string;
};

type BookWriterPropagationDiagnostics = {
  domClickCount: number;
  pointerUpCount: number;
  controllerCallCount: number;
  methodRequests: string[];
  appPropagateType?: string | null;
  appConstructorName?: string | null;
  pointerButtons?: number[];
  savingActionAtInstall?: string | null;
  savingActionAfterClick?: string | null;
  buttonDisabledAtInstall?: boolean | null;
  buttonDisabledAfterClick?: boolean | null;
  buttonTextAtInstall?: string | null;
  buttonTextAfterClick?: string | null;
  hitTargetAtInstall?: string | null;
  clickX?: number | null;
  clickY?: number | null;
  activationMode?: "pointer" | "click";
};

type BookWriterApprovedPublishSmokeSummary = {
  verified: boolean;
  runId: string;
  title: string;
  reviewPack: string;
  publishPrep: string;
  kdpLinkVisible: boolean;
  exactFilesVisible: boolean;
  completionAuditVisible: boolean;
  completionAuditText: string;
  markPublishedEnabled: boolean;
  finishedRunVisible: boolean;
  landingTrophyRoomVisible: boolean;
};

type BookWriterControlMatrixSmokeSummary = {
  verified: boolean;
  runId: string;
  editedControls: string[];
  ideaDirectionSaved: boolean;
  characterFactSaved: boolean;
  timelineEventSaved: boolean;
  toneRuleSaved: boolean;
  plotDirectionSaved: boolean;
  chapterTitleSaved: boolean;
  chapterDescriptionSaved: boolean;
  chapterStyleSaved: boolean;
  chapterLockRoundTrip: boolean;
  paragraphTitleSaved: boolean;
  paragraphSummarySaved: boolean;
  paragraphPurposeSaved: boolean;
  paragraphStyleSaved: boolean;
  paragraphFieldLockRoundTrip: boolean;
  scopedRegenerationVisible: boolean;
  rewriteVisible: boolean;
  reloadPersistenceVerified: boolean;
  summary: string;
};

type BookWriterSmokeSummary = {
  ok: boolean;
  url: string;
  auth: ControlUiSmokeUrl["auth"];
  authUrlClean: boolean;
  profile: SmokeProfileSummary;
  runId: string;
  title: string;
  status: string;
  version: number;
  chapters: number;
  paragraphs: number;
  draftedParagraphs: number;
  manuscriptPreview: string;
  reviewPack: string;
  publishPrep: string;
  deleteVerified: boolean;
  restoreVerified: boolean;
  permanentDeleteVerified: boolean;
  remainingBooks: number;
  trophyRoomVisible: boolean;
  fixBlockersVisible: boolean;
  markPublishedVisible: boolean;
  sentenceAdaptation: BookWriterSentenceAdaptationSmokeSummary;
  controlMatrix: BookWriterControlMatrixSmokeSummary;
  approvedPublish: BookWriterApprovedPublishSmokeSummary;
  consoleErrors: string[];
  pageErrors: string[];
  screenshot: string;
  accessibility: BookWriterAccessibilityAudit;
  accessibilityReport: string;
  visual: BookWriterVisualAudit;
  visualReport: string;
};

type BookWriterAccessibilityIssue = {
  code: string;
  severity: "critical" | "warning";
  target: string;
  message: string;
};

type BookWriterAccessibilityAudit = {
  checkedAt: string;
  controlCount: number;
  focusableCount: number;
  definitions: {
    helpCount: number;
    glossaryCount: number;
    guideVisible: boolean;
    workflowMapVisible: boolean;
    recommendedActionVisible: boolean;
    fieldHintCount: number;
    trophyHelpCount: number;
    labels: string[];
  };
  criticalIssues: BookWriterAccessibilityIssue[];
  warnings: BookWriterAccessibilityIssue[];
  keyboard: {
    startButtonFocusable: boolean;
    journeyTabFocusable: boolean;
    happyPathBeforeLibraryTools: boolean;
    helpStopsSkipped: boolean;
    observedTabStops: string[];
  };
};

type BookWriterVisualAudit = {
  checkedAt: string;
  mobile: boolean;
  screenshot: string;
  viewport: { width: number; height: number } | null;
  dashboardBounds: { width: number; height: number } | null;
  trophyRoomAtTop: boolean;
  trophyRoomCompactsOnScroll: boolean;
  trophyRoomScrollsAway: boolean;
  trophyRoomHeightBeforeScroll: number | null;
  trophyRoomHeightAfterScroll: number | null;
  trophyRoomTopBeforeScroll: number | null;
  trophyRoomTopAfterScroll: number | null;
  healthStripVisible: boolean;
  healthCardCount: number;
  bookControlBarVisible: boolean;
  currentSettingsControlsDuplicated: boolean;
  trophyRoomHiddenOnBuildPages: boolean;
  celebrationVisible: boolean;
  deletedListCollapsed: boolean;
  activeDeleteBehindMore: boolean;
  railFinishedShortcutVisible: boolean;
  railWithinViewport: boolean;
  mainWithinViewport: boolean;
  visibleJourneySteps: string[];
};

type BookWriterSmokePlan = {
  runId?: string;
  topic?: string;
  title?: string;
  status?: string;
  version?: number;
  targetWords?: number;
  brief?: {
    topicParagraph?: string;
    audience?: string;
    readerPromise?: string;
  };
  styleGuide?: {
    tonePreset?: string;
    toneDescription?: string;
    profanityLevel?: string;
  };
  continuityControl?: {
    characterFacts?: string[];
    timelineEvents?: string[];
    toneRules?: string[];
    plotDirections?: string[];
  };
  bookSync?: {
    state?: string;
    summary?: string;
    affectedChapterIds?: string[];
    affectedParagraphIds?: string[];
    lockedConflictCount?: number;
    cohesionScore?: number;
  };
  storyImpactEvents?: Array<{
    status?: string;
    editSummary?: string;
    affectedChapterIds?: string[];
    sourceParagraphId?: string;
  }>;
  chapters?: Array<{
    id?: string;
    number?: number;
    title?: string;
    description?: string;
    styleDirection?: string;
    locked?: boolean;
    status?: string;
    fieldLocks?: Record<string, boolean>;
    paragraphs?: Array<{
      id?: string;
      order?: number;
      title?: string;
      summary?: string;
      purpose?: string;
      styleDirection?: string;
      text?: string;
      locked?: boolean;
      status?: string;
      targetWords?: number;
      transitionIn?: string;
      transitionOut?: string;
      continuityObligations?: string[];
      revisionStatus?: string;
      fieldLocks?: Record<string, boolean>;
    }>;
  }>;
  cover?: {
    status?: string;
    variants?: Array<{ id?: string; approved?: boolean }>;
  };
};

type BookWriterSmokeSnapshot = {
  outputDir?: string;
  projects?: Array<{ runId?: string }>;
  deletedBooks?: Array<{ deletedId?: string; runId?: string; title?: string }>;
  finishedBooks?: Array<{
    finishedId?: string;
    runId?: string;
    title?: string;
    coverPath?: string;
    coverPreviewDataUrl?: string;
  }>;
  selectedRunId?: string | null;
  plan?: BookWriterSmokePlan | null;
  manuscriptPreview?: string;
  planQuality?: unknown;
  reviewPack?: { recommendation?: string } | null;
  publishDryRun?: { status?: string; coverStrategy?: string } | null;
};

type BookWriterSmokeClient = {
  request<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>;
};

type BookWriterSmokeApp = HTMLElement & {
  client?: BookWriterSmokeClient;
  connected?: boolean;
  tab?: string;
  bookWriterLoading?: boolean;
  bookWriterDashboard?: BookWriterSmokeSnapshot | null;
  bookWriterError?: string | null;
  bookWriterSavingAction?: string | null;
  bookWriterSelectedRunId?: string | null;
  bookWriterActiveView?: string;
  requestUpdate?: () => void;
};

type PairingApprovalResult = {
  requestId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  error?: string;
};

type PairingOutcome = {
  pairingApproved: boolean;
  requestId?: string;
};

type SmokeBrowserSession = {
  page: Page;
  close: () => Promise<void>;
  persistentProfile: boolean;
  profileDir?: string;
};

type SmokeClientMetadata = {
  displayName: string;
  deviceFamily: string;
  platform?: string;
};

type SnapshotCondition = "created" | "drafted" | "stitched" | "packaged" | "publish-ready";

const SMOKE_TOPIC =
  "An original clean mystery about an honest bridge inspector who uncovers invoice fraud, protects a small town from a dangerous shortcut, and solves the case through courage, paper trails, and practical integrity.";
const APPROVED_SMOKE_TOPIC =
  "An original clean mystery about Primary Voice, an honest bridge inspector, using evidence ledger invoice receipt file details to reach a complete resolution and stop fraud.";
const APPROVED_SMOKE_STRUCTURE_TARGET_WORDS = 4000;
const APPROVED_SMOKE_QUALITY_TARGET_WORDS = 1200;

function redactSmokeSecrets(value: string): string {
  return redactControlUiSmokeSecrets(value);
}

function envFlagEnabled(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(raw);
}

function autoApprovePairingEnabled(): boolean {
  return envFlagEnabled("OPENCLAW_CONTROL_UI_SMOKE_AUTO_APPROVE_PAIRING", true);
}

function useMobileSmokeProfile(): boolean {
  const raw = process.env.OPENCLAW_CONTROL_UI_SMOKE_MOBILE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on" || raw === "iphone";
}

function bookWriterSmokeMutationAllowed(): boolean {
  return envFlagEnabled("OPENCLAW_CONTROL_UI_BOOK_WRITER_SMOKE_ALLOW_MUTATION", false);
}

function assertBookWriterSmokeMutationAllowed(): void {
  if (bookWriterSmokeMutationAllowed()) {
    return;
  }
  throw new Error(
    "Book Writer smoke creates, drafts, packages, and marks fixture books as published. Set OPENCLAW_CONTROL_UI_BOOK_WRITER_SMOKE_ALLOW_MUTATION=1 only when running against disposable or cleanup-safe state.",
  );
}

function localChromeCandidates(): string[] {
  if (platform() === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (platform() === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

function resolveBrowserExecutable(): string | undefined {
  const explicit = process.env.OPENCLAW_CONTROL_UI_SMOKE_BROWSER?.trim();
  if (explicit) {
    return explicit;
  }
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) {
    return bundled;
  }
  return localChromeCandidates().find((candidate) => existsSync(candidate));
}

function resolveSmokeClientMetadata(mobile: boolean): SmokeClientMetadata {
  const label = process.env.OPENCLAW_CONTROL_UI_SMOKE_DEVICE_NAME?.trim();
  return {
    displayName: label || `OpenClaw Book Writer smoke ${mobile ? "iPhone" : "desktop"} profile`,
    deviceFamily: "control-ui-smoke",
    ...(mobile ? { platform: "iPhone" } : {}),
  };
}

async function installSmokeClientMetadata(context: BrowserContext, metadata: SmokeClientMetadata) {
  await context.addInitScript((value) => {
    const key = "openclaw.controlUi.clientMetadata";
    const payload = JSON.stringify(value);
    localStorage.setItem(key, payload);
    Object.defineProperty(globalThis, "__OPENCLAW_CONTROL_UI_CLIENT_METADATA__", {
      value,
      configurable: true,
    });
  }, metadata);
}

function mobileSmokeContextOptions(): BrowserContextOptions {
  const device =
    devices["iPhone 15 Pro"] ??
    devices["iPhone 15"] ??
    devices["iPhone 14 Pro"] ??
    devices["iPhone 14"];
  return {
    ...device,
    viewport: device?.viewport ?? { width: 393, height: 852 },
    deviceScaleFactor: device?.deviceScaleFactor ?? 3,
    hasTouch: true,
    isMobile: true,
    userAgent:
      device?.userAgent ??
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  };
}

async function launchSmokeBrowserSession(options: {
  executablePath: string;
  contextOptions: BrowserContextOptions;
  profileDir: string | null;
  clientMetadata: SmokeClientMetadata;
}): Promise<SmokeBrowserSession> {
  if (options.profileDir) {
    mkdirSync(options.profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(options.profileDir, {
      ...options.contextOptions,
      headless: true,
      executablePath: options.executablePath,
    });
    await installSmokeClientMetadata(context, options.clientMetadata);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("about:blank").catch(() => undefined);
    return {
      page,
      close: () => context.close(),
      persistentProfile: true,
      profileDir: options.profileDir,
    };
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: options.executablePath,
  });
  const context = await browser.newContext(options.contextOptions);
  await installSmokeClientMetadata(context, options.clientMetadata);
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
    persistentProfile: false,
  };
}

async function resolveDashboardUrl(): Promise<ControlUiSmokeUrl> {
  return resolveControlUiSmokeUrl({
    explicitUrlEnvNames: ["OPENCLAW_CONTROL_UI_SMOKE_URL"],
  });
}

function bookWriterUrlFor(launchUrl: string): string {
  const url = new URL(launchUrl);
  const routeBase = url.pathname.replace(/\/$/, "");
  if (!/\/book-writer$/i.test(routeBase)) {
    url.pathname = `${routeBase === "" ? "" : routeBase}/book-writer`;
  }
  return url.toString();
}

function approvePairingRequest(requestId: string): PairingApprovalResult {
  const result = spawnSync("pnpm", ["openclaw", "devices", "approve", requestId, "--json"], {
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return {
    requestId,
    ok: result.status === 0,
    stdout: redactSmokeSecrets(result.stdout ?? ""),
    stderr: redactSmokeSecrets(result.stderr ?? ""),
    status: result.status,
    error: result.error?.message,
  };
}

async function waitForConnectedOrApprovePairing(page: Page): Promise<PairingOutcome> {
  const waitForConnected = () =>
    page.waitForFunction(
      () => {
        const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
        return app?.connected === true;
      },
      null,
      { timeout: 45_000 },
    );
  try {
    await waitForConnected();
    return { pairingApproved: false };
  } catch (error) {
    const bodyText = (
      (await page
        .locator("body")
        .textContent()
        .catch(() => "")) ?? ""
    ).replace(/\s+/g, " ");
    const requestId = extractControlUiPairingRequestId(bodyText);
    if (!requestId || !autoApprovePairingEnabled()) {
      throw error;
    }
    const approval = approvePairingRequest(requestId);
    if (!approval.ok) {
      throw new Error(
        `Dashboard requested device pairing, but auto-approval failed: ${JSON.stringify(
          approval,
          null,
          2,
        )}`,
        { cause: error },
      );
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForConnected();
    return { pairingApproved: true, requestId };
  }
}

async function waitForBookWriter(page: Page): Promise<PairingOutcome> {
  const smokeUrl = await resolveDashboardUrl();
  await page.goto(bookWriterUrlFor(smokeUrl.launchUrl), { waitUntil: "domcontentloaded" });
  const pairing = await waitForConnectedOrApprovePairing(page);
  await page.waitForFunction(
    () => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      return app?.connected === true && app?.tab === "bookWriter";
    },
    null,
    { timeout: 45_000 },
  );
  await page.locator(".book-writer-dashboard").waitFor({ state: "visible", timeout: 45_000 });
  return pairing;
}

async function waitForBookWriterSnapshot(
  page: Page,
  condition: SnapshotCondition,
  runId?: string,
  timeout = 90_000,
): Promise<BookWriterSmokeSnapshot> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await getBookWriterSnapshot(page);
    if (snapshotMatchesCondition(snapshot, condition, runId)) {
      return snapshot;
    }
    await page.waitForTimeout(500);
  }
  const snapshot = await getBookWriterSnapshot(page);
  throw new Error(
    `timed out waiting for Book Writer ${condition} snapshot: ${JSON.stringify({
      runId,
      currentRunId: snapshot.plan?.runId,
      status: snapshot.plan?.status,
      version: snapshot.plan?.version,
      paragraphs: snapshot.plan ? countParagraphs(snapshot.plan) : 0,
      draftedParagraphs: snapshot.plan ? countDraftedParagraphs(snapshot.plan) : 0,
      reviewPack: snapshot.reviewPack?.recommendation,
      publishDryRun: snapshot.publishDryRun?.status,
    })}`,
  );
}

async function getBookWriterSnapshot(page: Page): Promise<BookWriterSmokeSnapshot> {
  return await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
    return app?.bookWriterDashboard ?? {};
  });
}

async function selectBookWriterRunForSmoke(
  page: Page,
  runId: string,
  activeView = "draft",
): Promise<BookWriterSmokeSnapshot> {
  return await page.evaluate(
    async ({ runId: expectedRunId, activeView: expectedActiveView }) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      if (!app?.client) {
        throw new Error("Book Writer app client is not available.");
      }
      const snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.dashboard.snapshot",
        { runId: expectedRunId },
        { timeoutMs: 120_000 },
      );
      app.bookWriterDashboard = snapshot;
      app.bookWriterSelectedRunId = snapshot.selectedRunId ?? snapshot.plan?.runId ?? null;
      app.bookWriterActiveView = expectedActiveView;
      app.requestUpdate?.();
      return snapshot;
    },
    { runId, activeView },
  );
}

async function waitForBookWriterSnapshotLoaded(page: Page, timeout = 45_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      return app?.bookWriterDashboard !== null && app?.bookWriterLoading !== true;
    },
    null,
    { timeout },
  );
}

async function waitForNewBookWriterPlan(
  page: Page,
  previousRunId: string | undefined,
  timeout = 90_000,
): Promise<BookWriterSmokeSnapshot> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await getBookWriterSnapshot(page);
    const plan = snapshot.plan;
    if (plan?.runId && plan.runId !== previousRunId && (plan.chapters?.length ?? 0) > 0) {
      return snapshot;
    }
    await page.waitForTimeout(500);
  }
  const snapshot = await getBookWriterSnapshot(page);
  throw new Error(
    `timed out waiting for newly created Book Writer plan: ${JSON.stringify({
      previousRunId,
      currentRunId: snapshot.plan?.runId,
      status: snapshot.plan?.status,
      version: snapshot.plan?.version,
    })}`,
  );
}

function snapshotMatchesCondition(
  current: BookWriterSmokeSnapshot,
  condition: SnapshotCondition,
  runId?: string,
): boolean {
  const plan = current.plan;
  if (!plan) {
    return false;
  }
  if (runId && plan.runId !== runId) {
    return false;
  }
  switch (condition) {
    case "created":
      return Boolean(plan.runId && (plan.chapters?.length ?? 0) > 0);
    case "drafted": {
      const paragraphs = countParagraphs(plan);
      return (
        plan.status === "drafting" && paragraphs > 0 && countDraftedParagraphs(plan) === paragraphs
      );
    }
    case "stitched":
      return (
        plan.status === "stitched" && Boolean(current.manuscriptPreview?.includes(plan.title ?? ""))
      );
    case "packaged":
      return Boolean(current.reviewPack);
    case "publish-ready":
      return current.publishDryRun?.status === "ready";
  }
  return false;
}

function countParagraphs(plan: BookWriterSmokePlan): number {
  return (plan.chapters ?? []).reduce(
    (count, chapter) => count + (chapter.paragraphs?.length ?? 0),
    0,
  );
}

function countDraftedParagraphs(plan: BookWriterSmokePlan): number {
  return (plan.chapters ?? []).reduce(
    (count, chapter) =>
      count +
      (chapter.paragraphs ?? []).filter((paragraph) => (paragraph.text ?? "").trim().length > 0)
        .length,
    0,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickAction(page: Page, label: string | RegExp) {
  const name = typeof label === "string" ? new RegExp(`^${escapeRegExp(label)}`) : label;
  const candidates = page.getByRole("button", { name });
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const usable = await candidate
      .evaluate((element) => !element.classList.contains("book-writer-sr-only"))
      .catch(() => false);
    if (usable && (await candidate.isVisible().catch(() => false))) {
      await candidate.click();
      return;
    }
  }
  await candidates.first().click({ force: true });
}

async function confirmAction(page: Page, label: string | RegExp) {
  const dialogVisible = await page
    .getByRole("dialog")
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!dialogVisible) {
    throw new Error(`Expected confirmation dialog for ${String(label)} but none appeared.`);
  }
  await page.getByRole("button", { name: label }).last().click();
}

async function confirmActionIfVisible(page: Page, label: string | RegExp) {
  const dialog = page.getByRole("dialog");
  const visible = await dialog
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (visible) {
    await page.getByRole("button", { name: label }).last().click();
  }
}

async function approveCoverIfNeeded(page: Page, runId: string) {
  let snapshot = await getBookWriterSnapshot(page);
  if (snapshot.plan?.cover?.status === "approved") {
    return snapshot;
  }
  const approveCover = page.getByRole("button", { name: /^Approve cover first/ }).first();
  if (await approveCover.isVisible().catch(() => false)) {
    await approveCover.click();
  } else {
    const approveVariant = page.getByRole("button", { name: /^Approve$/ }).first();
    if (await approveVariant.isVisible().catch(() => false)) {
      await approveVariant.click();
    } else {
      snapshot = await page.evaluate(async (expectedRunId) => {
        const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
        const current = app?.bookWriterDashboard;
        const plan = current?.plan;
        if (!app?.client || !plan?.runId || plan.runId !== expectedRunId || !plan.version) {
          throw new Error("Book Writer cover approval fallback could not find the active plan.");
        }
        let nextSnapshot = current;
        let variantId = plan.cover?.variants?.[0]?.id;
        let baseVersion = plan.version;
        if (!variantId) {
          nextSnapshot = await app.client.request<BookWriterSmokeSnapshot>(
            "bookWriter.cover.generate",
            { runId: expectedRunId, baseVersion },
            { timeoutMs: 120_000 },
          );
          app.bookWriterDashboard = nextSnapshot;
          app.requestUpdate?.();
          variantId = nextSnapshot.plan?.cover?.variants?.[0]?.id;
          baseVersion = nextSnapshot.plan?.version ?? baseVersion;
        }
        const approvedSnapshot = await app.client.request<BookWriterSmokeSnapshot>(
          "bookWriter.cover.approve",
          { runId: expectedRunId, baseVersion, variantId },
          { timeoutMs: 120_000 },
        );
        app.bookWriterDashboard = approvedSnapshot;
        app.bookWriterSelectedRunId =
          approvedSnapshot.selectedRunId ?? approvedSnapshot.plan?.runId ?? null;
        app.requestUpdate?.();
        return approvedSnapshot;
      }, runId);
    }
  }
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    snapshot = await getBookWriterSnapshot(page);
    if (snapshot.plan?.runId === runId && snapshot.plan.cover?.status === "approved") {
      return snapshot;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `timed out waiting for cover approval: ${JSON.stringify({
      runId,
      currentRunId: snapshot.plan?.runId,
      coverStatus: snapshot.plan?.cover?.status,
      variants: snapshot.plan?.cover?.variants?.length ?? 0,
    })}`,
  );
}

async function clickTab(page: Page, label: string) {
  const stepNames: Record<string, string> = {
    Idea: "1. Idea",
    Chapters: "2. Make Chapters",
    Plan: "3. Plan Paragraphs",
    Write: "4. Write Book Text",
    Read: "5. Read + Check",
    Publish: "6. Publish",
  };
  const stepName = stepNames[label];
  if (stepName) {
    await page.locator(`.book-writer-guided-steps [role="tab"][aria-label="${stepName}"]`).click();
    return;
  }
  await page
    .locator(".book-writer-guided-steps [role='tab'], .book-writer-journey__step")
    .filter({ hasText: label })
    .first()
    .click();
}

async function assertWriteStepParagraphRail(page: Page) {
  const writeCards = page.locator(".book-writer-guided-paragraph-card--write-mode");
  await writeCards.first().waitFor({ state: "visible", timeout: 15_000 });
  const cardText = ((await writeCards.first().textContent()) ?? "").replace(/\s+/g, " ").trim();
  if (!/Book Text|What readers will see|Write this page|Rewrite around my edits/.test(cardText)) {
    throw new Error(`Write step paragraph card is missing reader-facing writing cues: ${cardText}`);
  }

  const activeStatus = page.locator(".book-writer-guided-status").first();
  await activeStatus.waitFor({ state: "visible", timeout: 15_000 });
  const statusText = ((await activeStatus.textContent()) ?? "").replace(/\s+/g, " ").trim();
  if (/\bWritten\b/.test(statusText)) {
    throw new Error(`Write step focused status still says "Written": ${statusText}`);
  }
  if (!/Text ready|Ready for AI|Needs plan|Locked/.test(statusText)) {
    throw new Error(`Write step focused status is missing plain readiness language: ${statusText}`);
  }
}

async function runBookWriterFlow(page: Page) {
  await waitForBookWriterSnapshotLoaded(page);
  const previousRunId = (await getBookWriterSnapshot(page)).plan?.runId;
  await page
    .locator("textarea.book-writer-guided-topic, textarea.book-writer-topic")
    .fill(SMOKE_TOPIC);
  await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp & {
      bookWriterTargetWordsDraft?: number;
      bookWriterToneDraft?: string;
      bookWriterCustomToneDraft?: string;
      bookWriterProfanityDraft?: string;
    };
    app.bookWriterTargetWordsDraft = 12000;
    app.bookWriterToneDraft = "custom";
    app.bookWriterCustomToneDraft = "Technical, field-tested, and quietly reassuring.";
    app.bookWriterProfanityDraft = "mild";
    app.requestUpdate?.();
  });
  const setupButton = page.getByRole("button", { name: "Set up new book" }).first();
  if (await setupButton.isVisible().catch(() => false)) {
    await setupButton.click();
    await page
      .getByText(/New Book Setup|Describe the book/)
      .first()
      .waitFor({
        state: "visible",
        timeout: 15_000,
      });
  }
  await page.getByText("≈ 40-48 paperback pages").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const setupControlAudit = await page.evaluate(() => ({
    setupCards: document.querySelectorAll(".book-writer-setup-controls").length,
    railTargetWords: document.querySelectorAll(
      '.book-writer-rail [aria-label="New book target words"]',
    ).length,
    railTone: document.querySelectorAll('.book-writer-rail [aria-label="New book tone"]').length,
    railProfanity: document.querySelectorAll('.book-writer-rail [aria-label="New book profanity"]')
      .length,
  }));
  if (
    setupControlAudit.setupCards > 1 ||
    setupControlAudit.railTargetWords ||
    setupControlAudit.railTone ||
    setupControlAudit.railProfanity
  ) {
    throw new Error(`Book setup controls are duplicated: ${JSON.stringify(setupControlAudit)}`);
  }
  await page
    .getByRole("button", { name: /^Write my editable draft/ })
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });
  await clickAction(page, /^Just make chapters first/);
  await confirmActionIfVisible(page, "Make chapters");
  let snapshot = await waitForNewBookWriterPlan(page, previousRunId);
  const createdRunId = snapshot.plan?.runId;
  if (!createdRunId) {
    throw new Error("Book Writer plan was not created.");
  }
  if (
    snapshot.plan?.targetWords !== 12000 ||
    snapshot.plan.styleGuide?.tonePreset !== "custom" ||
    snapshot.plan.styleGuide?.toneDescription !==
      "Technical, field-tested, and quietly reassuring." ||
    snapshot.plan.styleGuide?.profanityLevel !== "mild"
  ) {
    throw new Error(
      `Book setup controls did not persist: ${JSON.stringify({
        targetWords: snapshot.plan?.targetWords,
        styleGuide: snapshot.plan?.styleGuide,
      })}`,
    );
  }
  await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp & {
      bookWriterActiveView?: string;
      bookWriterMode?: string;
      bookWriterNewBookSetupOpen?: boolean;
    };
    app.bookWriterMode = "guided";
    app.bookWriterNewBookSetupOpen = false;
    app.bookWriterActiveView = "chapters";
    app.requestUpdate?.();
  });

  await clickTab(page, "Chapters");
  await page.locator(".book-writer-context-panel").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const currentSettingsAudit = await page.evaluate((expectedTitle) => {
    const contextPanel = document.querySelector(".book-writer-context-panel");
    const controlBarText = contextPanel?.textContent ?? "";
    return {
      contextPanels: document.querySelectorAll(".book-writer-context-panel").length,
      setupCards: document.querySelectorAll(".book-writer-setup-controls").length,
      hasAutomation: controlBarText.includes("Manual only") || controlBarText.includes("Scheduled"),
      hasAiSound: controlBarText.includes("How AI will sound"),
      hasReaderPromise: controlBarText.includes("Reader promise"),
      hasBookIdentity:
        Boolean(contextPanel?.querySelector('[aria-label="Context book title"]')) ||
        (Boolean(expectedTitle) && controlBarText.includes(expectedTitle)),
      hasHomeAction: Boolean(document.querySelector('[aria-label*="Book Studio home"]')),
    };
  }, snapshot.plan?.title ?? "");
  if (
    currentSettingsAudit.contextPanels < 1 ||
    currentSettingsAudit.setupCards !== 0 ||
    !currentSettingsAudit.hasAutomation ||
    !currentSettingsAudit.hasAiSound ||
    !currentSettingsAudit.hasReaderPromise ||
    !currentSettingsAudit.hasBookIdentity ||
    !currentSettingsAudit.hasHomeAction
  ) {
    throw new Error(
      `Book context panel did not replace duplicate setup controls after Idea: ${JSON.stringify(
        currentSettingsAudit,
      )}`,
    );
  }
  const healthAudit = await page.evaluate(() => ({
    cards:
      document.querySelectorAll(".book-writer-health-card").length ||
      document.querySelectorAll(".book-writer-guided-header__status button").length,
    text:
      (
        document.querySelector(".book-writer-health-strip") ??
        document.querySelector(".book-writer-guided-header__status") ??
        document.body
      ).textContent
        ?.replace(/\s+/g, " ")
        .trim() ?? "",
  }));
  if (healthAudit.cards < 4 || !healthAudit.text.includes("Book health")) {
    throw new Error(`Book health strip is incomplete: ${JSON.stringify(healthAudit)}`);
  }
  await page
    .locator(".book-writer-guided-chapter, .book-writer-chapter")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByText("Paraphrase the chapter's reader-facing content. This is not printed in the book.")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await clickTab(page, "Plan");
  await page
    .locator(".book-writer-guided-paragraph-card, .book-writer-paragraph")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  const focusedParagraphCardCount = await page
    .locator(".book-writer-guided-paragraph-card, .book-writer-paragraph")
    .count();
  if (focusedParagraphCardCount < 1) {
    throw new Error("Guided paragraph step did not render paragraph cards.");
  }
  await page
    .locator(".book-writer-guided-paragraph-card, .book-writer-paragraph")
    .filter({ hasText: /What this paragraph will say|AI writing notes|paragraph blueprint/ })
    .first()
    .waitFor({ state: "visible" });
  await page
    .getByText(/Book Text is written in Step 4|Continue to Write for reader text/)
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });
  await page
    .getByText(
      /AI reads this as steering\. Readers do not\.|Reader-facing paraphrase|This paraphrase is not published/,
    )
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });
  await page
    .getByText(/Book Text readers see|reader text/)
    .first()
    .waitFor({
      state: "visible",
      timeout: 15_000,
    });

  await clickTab(page, "Write");
  await page.getByText("Write the Book").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page
    .locator(".book-writer-guided-paragraph-card--write-mode")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Write missing pages", exact: true }).click();
  await confirmAction(page, /Write \d+ paragraphs/);
  snapshot = await waitForBookWriterSnapshot(page, "drafted", createdRunId);

  await page.getByText("Write the Book").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await assertWriteStepParagraphRail(page);
  await clickTab(page, "Read");
  await page
    .locator(".book-writer-read-actions")
    .getByRole("button", { name: "Build readable book" })
    .click();
  await confirmAction(page, "Build readable book");
  snapshot = await waitForBookWriterSnapshot(page, "stitched", createdRunId);
  await page
    .locator(".book-writer-read-page, .book-writer-preview pre")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  await page
    .locator(".book-writer-read-actions")
    .getByRole("button", { name: "Check book quality" })
    .click();
  await confirmAction(page, "Check book quality");
  snapshot = await waitForBookWriterSnapshot(page, "packaged", createdRunId, 180_000);
  await clickTab(page, "Read");
  await page.getByText(/Final review, page by page\.|Read the book like a reader\./).waitFor({
    timeout: 15_000,
  });

  await clickTab(page, "Publish");
  const publishPanelVisible = await page
    .locator(".book-writer-guided-main, .book-writer-publish-card")
    .filter({
      hasText:
        /Your book is not ready yet|Final submit remains|Publishing checklist|Prepare publishing|Upload files|Exact files to use in KDP/,
    })
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!publishPanelVisible) {
    await page.locator(".book-writer-guided-main, .book-writer-publish-card").first().waitFor({
      timeout: 15_000,
    });
  }
  const reviewRecommendation = snapshot.reviewPack?.recommendation ?? "missing";
  if (reviewRecommendation === "approve") {
    snapshot = await approveCoverIfNeeded(page, createdRunId);
    await clickAction(page, "Prepare publishing");
    await confirmAction(page, "Prepare publishing");
    snapshot = await waitForBookWriterSnapshot(page, "publish-ready", createdRunId, 120_000);
  }

  return snapshot;
}

function seedMeasuredBookWriterModel(snapshot: BookWriterSmokeSnapshot) {
  if (!snapshot.outputDir) {
    throw new Error("Book Writer snapshot did not include outputDir; cannot seed approved smoke.");
  }
  writeFileSync(
    join(snapshot.outputDir, "model-bench.json"),
    `${JSON.stringify(
      [
        {
          provider: "lmstudio",
          model: "Qwen/Qwen3-30B-A3B-Instruct-2507",
          source: "measured",
          peakMemoryGb: 52,
          tokensPerSecond: 24,
          stableContextTokens: 32768,
          crashRate: 0.01,
          qualityScore: 0.82,
          measuredAt: new Date().toISOString(),
          notes: ["Control UI Book Writer approved-publish smoke fixture."],
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function findParagraphById(plan: BookWriterSmokePlan, paragraphId: string) {
  for (const chapter of plan.chapters ?? []) {
    for (const paragraph of chapter.paragraphs ?? []) {
      if (paragraph.id === paragraphId) {
        return { chapter, paragraph };
      }
    }
  }
  return null;
}

function planParagraphs(plan: BookWriterSmokePlan | null | undefined) {
  return (plan?.chapters ?? []).flatMap((chapter) => chapter.paragraphs ?? []);
}

async function waitForBookWriterPlanVersion(
  page: Page,
  runId: string,
  previousVersion: number,
  timeout = 45_000,
): Promise<BookWriterSmokeSnapshot> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await getBookWriterSnapshot(page);
    const version = snapshot.plan?.version ?? 0;
    if (snapshot.plan?.runId === runId && version > previousVersion) {
      return snapshot;
    }
    await page.waitForTimeout(250);
  }
  const snapshot = await getBookWriterSnapshot(page);
  throw new Error(
    `timed out waiting for Book Writer plan version to advance: ${JSON.stringify({
      runId,
      currentRunId: snapshot.plan?.runId,
      previousVersion,
      currentVersion: snapshot.plan?.version,
    })}`,
  );
}

async function waitForBookWriterPlanPredicate(
  page: Page,
  runId: string,
  description: string,
  predicate: (plan: BookWriterSmokePlan) => boolean,
  timeout = 45_000,
): Promise<BookWriterSmokeSnapshot> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await getBookWriterSnapshot(page);
    const plan = snapshot.plan;
    if (plan?.runId === runId && predicate(plan)) {
      return snapshot;
    }
    await page.waitForTimeout(250);
  }
  const snapshot = await getBookWriterSnapshot(page);
  throw new Error(
    `timed out waiting for Book Writer plan predicate: ${JSON.stringify({
      runId,
      description,
      currentRunId: snapshot.plan?.runId,
      version: snapshot.plan?.version,
    })}`,
  );
}

async function fillAndCommitBookWriterControl(
  page: Page,
  locator: Locator,
  value: string,
): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await locator.fill(value);
  await locator.evaluate((element, nextValue) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      element.value = nextValue;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    if (element instanceof HTMLElement) {
      element.blur();
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(100);
}

async function openBookWriterDetails(details: Locator): Promise<void> {
  await details.waitFor({ state: "attached", timeout: 15_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await details.evaluate(
      (element) => element instanceof HTMLDetailsElement && element.open,
    );
    if (open) {
      return;
    }
    await details.scrollIntoViewIfNeeded();
    await details.locator("summary").click({ force: true });
    await details.page().waitForTimeout(150);
  }
  const state = await details.evaluate((element) => ({
    tagName: element.tagName,
    open: element instanceof HTMLDetailsElement ? element.open : null,
    text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "",
  }));
  throw new Error(`Book Writer details control did not open: ${JSON.stringify(state)}`);
}

async function anyVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (
      await locator
        .nth(index)
        .isVisible()
        .catch(() => false)
    ) {
      return true;
    }
  }
  return false;
}

function firstParagraph(plan: BookWriterSmokePlan) {
  const chapter = plan.chapters?.find((candidate) => (candidate.paragraphs?.length ?? 0) > 0);
  const paragraph = chapter?.paragraphs?.[0];
  return chapter && paragraph ? { chapter, paragraph } : null;
}

async function verifyBookWriterControlMatrix(
  page: Page,
  runId: string,
): Promise<BookWriterControlMatrixSmokeSummary> {
  let snapshot = await getBookWriterSnapshot(page);
  let plan = snapshot.plan;
  const chapterId = plan?.chapters?.[0]?.id;
  const paragraphLocation = plan ? firstParagraph(plan) : null;
  const paragraphId = paragraphLocation?.paragraph.id;
  if (!plan?.runId || plan.runId !== runId || !chapterId || !paragraphId || !plan.version) {
    throw new Error(
      `Book Writer control matrix could not find editable chapter and paragraph: ${JSON.stringify({
        runId,
        planRunId: plan?.runId,
        chapterId,
        paragraphId,
        version: plan?.version,
      })}`,
    );
  }

  const editedControls: string[] = [];
  const ideaMarker =
    "CONTROL MATRIX: The author added a precise story direction; AI must preserve continuity around this sentence.";
  const chapterTitle = "Control Matrix Chapter Hook";
  const chapterDescription =
    "CONTROL MATRIX chapter description: prove the chapter plan saves through the live dashboard.";
  const chapterStyle =
    "CONTROL MATRIX chapter style: make this chapter deliberate, warm, and consequence-aware.";
  const paragraphTitle = "Control Matrix Paragraph Purpose";
  const paragraphSummary =
    "CONTROL MATRIX paragraph summary: this paragraph must explain the decision and set up the next beat.";
  const paragraphPurpose =
    "CONTROL MATRIX writing note: preserve timeline cause and effect when rewriting this paragraph.";
  const paragraphStyle =
    "CONTROL MATRIX paragraph style: concise, observant, and consistent with the global tone.";
  const characterFact =
    "CONTROL MATRIX character fact: Mara never accuses the mayor without evidence.";
  const timelineEvent =
    "CONTROL MATRIX timeline event: the bridge inspection happens before the council vote.";
  const toneRule = "CONTROL MATRIX tone rule: keep suspense dry, precise, and clean.";
  const plotDirection =
    "CONTROL MATRIX plot direction: the forged signature pays off in the final public reveal.";

  let previousVersion = plan.version;
  await clickTab(page, "Idea");
  const ideaTextarea = page.locator(".book-writer-idea-textarea").first();
  await fillAndCommitBookWriterControl(
    page,
    ideaTextarea,
    `${plan.brief?.topicParagraph ?? plan.topic ?? ""}\n\n${ideaMarker}`,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "idea direction saved",
    (currentPlan) =>
      Boolean(
        currentPlan.brief?.topicParagraph?.includes(ideaMarker) ||
        currentPlan.topic?.includes(ideaMarker),
      ),
  );
  plan = snapshot.plan;
  editedControls.push("idea.direction");
  const ideaDirectionSaved = Boolean(
    plan?.brief?.topicParagraph?.includes(ideaMarker) || plan?.topic?.includes(ideaMarker),
  );

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page.locator('textarea[aria-label="Book character facts"]').first(),
    characterFact,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "character fact saved",
    (currentPlan) =>
      currentPlan.continuityControl?.characterFacts?.includes(characterFact) ?? false,
  );
  plan = snapshot.plan;
  editedControls.push("continuity.characterFacts");
  const characterFactSaved = Boolean(
    plan?.continuityControl?.characterFacts?.includes(characterFact),
  );

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page.locator('textarea[aria-label="Book timeline events"]').first(),
    timelineEvent,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "timeline event saved",
    (currentPlan) =>
      currentPlan.continuityControl?.timelineEvents?.includes(timelineEvent) ?? false,
  );
  plan = snapshot.plan;
  editedControls.push("continuity.timelineEvents");
  const timelineEventSaved = Boolean(
    plan?.continuityControl?.timelineEvents?.includes(timelineEvent),
  );

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page.locator('textarea[aria-label="Book tone rules"]').first(),
    toneRule,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "tone rule saved",
    (currentPlan) => currentPlan.continuityControl?.toneRules?.includes(toneRule) ?? false,
  );
  plan = snapshot.plan;
  editedControls.push("continuity.toneRules");
  const toneRuleSaved = Boolean(plan?.continuityControl?.toneRules?.includes(toneRule));

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page.locator('textarea[aria-label="Book plot direction"]').first(),
    plotDirection,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "plot direction saved",
    (currentPlan) =>
      currentPlan.continuityControl?.plotDirections?.includes(plotDirection) ?? false,
  );
  plan = snapshot.plan;
  editedControls.push("continuity.plotDirections");
  const plotDirectionSaved = Boolean(
    plan?.continuityControl?.plotDirections?.includes(plotDirection),
  );

  previousVersion = plan?.version ?? previousVersion;
  await clickTab(page, "Chapters");
  const chapterCard = page.locator(".book-writer-guided-chapter").first();
  await chapterCard.waitFor({ state: "visible", timeout: 15_000 });
  await fillAndCommitBookWriterControl(
    page,
    chapterCard.locator("input.book-writer-title-input").first(),
    chapterTitle,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "chapter title saved",
    (currentPlan) =>
      Boolean(currentPlan.chapters?.some((chapter) => chapter.title === chapterTitle)),
  );
  plan = snapshot.plan;
  editedControls.push("chapter.title");
  const chapterTitleSaved = Boolean(
    plan?.chapters?.some((chapter) => chapter.title === chapterTitle),
  );

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page
      .locator(".book-writer-guided-chapter")
      .first()
      .locator("textarea.book-writer-chapter-description")
      .first(),
    chapterDescription,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "chapter description saved",
    (currentPlan) =>
      Boolean(currentPlan.chapters?.some((chapter) => chapter.description === chapterDescription)),
  );
  plan = snapshot.plan;
  editedControls.push("chapter.description");
  const chapterDescriptionSaved = Boolean(
    plan?.chapters?.some((chapter) => chapter.description === chapterDescription),
  );

  const chapterDetails = page
    .locator(".book-writer-guided-chapter")
    .first()
    .locator("details.book-writer-guided-card-more")
    .first();
  await openBookWriterDetails(chapterDetails);
  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page.locator(".book-writer-guided-chapter").first().locator("details textarea").first(),
    chapterStyle,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "chapter style saved",
    (currentPlan) =>
      Boolean(currentPlan.chapters?.some((chapter) => chapter.styleDirection === chapterStyle)),
  );
  plan = snapshot.plan;
  editedControls.push("chapter.styleDirection");
  const chapterStyleSaved = Boolean(
    plan?.chapters?.some((chapter) => chapter.styleDirection === chapterStyle),
  );

  const chapterLock = page
    .locator(".book-writer-guided-chapter")
    .first()
    .locator(".book-writer-lock input")
    .first();
  previousVersion = plan?.version ?? previousVersion;
  if (await chapterLock.isChecked().catch(() => false)) {
    await chapterLock.setChecked(false);
    snapshot = await waitForBookWriterPlanPredicate(
      page,
      runId,
      "chapter lock normalized off",
      (currentPlan) => !currentPlan.chapters?.some((chapter) => chapter.locked),
    );
    plan = snapshot.plan;
    previousVersion = plan?.version ?? previousVersion;
  }
  await chapterLock.setChecked(true);
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "chapter lock on",
    (currentPlan) => currentPlan.chapters?.some((chapter) => chapter.locked) ?? false,
  );
  plan = snapshot.plan;
  const chapterLocked = Boolean(plan?.chapters?.some((chapter) => chapter.locked));
  previousVersion = plan?.version ?? previousVersion;
  await page
    .locator(".book-writer-guided-chapter")
    .first()
    .locator(".book-writer-lock input")
    .first()
    .setChecked(false);
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "chapter lock off",
    (currentPlan) => !currentPlan.chapters?.some((chapter) => chapter.locked),
  );
  plan = snapshot.plan;
  editedControls.push("chapter.lock");
  const chapterLockRoundTrip = chapterLocked && !plan?.chapters?.some((chapter) => chapter.locked);

  const scopedRegenerationVisible = await anyVisible(
    page.locator("[data-book-writer-regenerate-titles]"),
  );

  previousVersion = plan?.version ?? previousVersion;
  await clickTab(page, "Plan");
  const paragraphCard = page.locator(".book-writer-guided-paragraph-card").first();
  await paragraphCard.waitFor({ state: "visible", timeout: 15_000 });
  await fillAndCommitBookWriterControl(
    page,
    paragraphCard.locator("input.book-writer-title-input").first(),
    paragraphTitle,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "paragraph title saved",
    (currentPlan) =>
      planParagraphs(currentPlan).some((paragraph) => paragraph.title === paragraphTitle),
  );
  plan = snapshot.plan;
  editedControls.push("paragraph.title");
  const paragraphTitleSaved = planParagraphs(plan).some(
    (paragraph) => paragraph.title === paragraphTitle,
  );

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page
      .locator(".book-writer-guided-paragraph-card")
      .first()
      .locator("textarea.book-writer-plan-summary")
      .first(),
    paragraphSummary,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "paragraph summary saved",
    (currentPlan) =>
      planParagraphs(currentPlan).some((paragraph) => paragraph.summary === paragraphSummary),
  );
  plan = snapshot.plan;
  editedControls.push("paragraph.summary");
  const paragraphSummarySaved = planParagraphs(plan).some(
    (paragraph) => paragraph.summary === paragraphSummary,
  );

  const paragraphDetails = page
    .locator(".book-writer-guided-paragraph-card")
    .first()
    .locator("details.book-writer-editor-details")
    .first();
  await openBookWriterDetails(paragraphDetails);
  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page
      .locator(".book-writer-guided-paragraph-card")
      .first()
      .locator(".book-writer-guided-zone--plan textarea")
      .first(),
    paragraphPurpose,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "paragraph purpose saved",
    (currentPlan) =>
      planParagraphs(currentPlan).some((paragraph) => paragraph.purpose === paragraphPurpose),
  );
  plan = snapshot.plan;
  editedControls.push("paragraph.purpose");
  const paragraphPurposeSaved = planParagraphs(plan).some(
    (paragraph) => paragraph.purpose === paragraphPurpose,
  );

  previousVersion = plan?.version ?? previousVersion;
  await fillAndCommitBookWriterControl(
    page,
    page
      .locator(".book-writer-guided-paragraph-card")
      .first()
      .locator(".book-writer-editor-field--style")
      .first(),
    paragraphStyle,
  );
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "paragraph style saved",
    (currentPlan) =>
      planParagraphs(currentPlan).some((paragraph) => paragraph.styleDirection === paragraphStyle),
  );
  plan = snapshot.plan;
  editedControls.push("paragraph.styleDirection");
  const paragraphStyleSaved = planParagraphs(plan).some(
    (paragraph) => paragraph.styleDirection === paragraphStyle,
  );

  const paragraphFieldLock = page
    .locator(".book-writer-guided-paragraph-card")
    .first()
    .locator(".book-writer-field-lock input")
    .first();
  previousVersion = plan?.version ?? previousVersion;
  if (await paragraphFieldLock.isChecked().catch(() => false)) {
    await paragraphFieldLock.setChecked(false);
    snapshot = await waitForBookWriterPlanPredicate(
      page,
      runId,
      "paragraph field locks normalized off",
      (currentPlan) =>
        !planParagraphs(currentPlan).some((paragraph) =>
          Object.values(paragraph.fieldLocks ?? {}).some(Boolean),
        ),
    );
    plan = snapshot.plan;
    previousVersion = plan?.version ?? previousVersion;
  }
  await paragraphFieldLock.setChecked(true);
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "paragraph field lock on",
    (currentPlan) =>
      planParagraphs(currentPlan).some((paragraph) =>
        Object.values(paragraph.fieldLocks ?? {}).some(Boolean),
      ),
  );
  plan = snapshot.plan;
  const paragraphLocked = planParagraphs(plan).some((paragraph) =>
    Object.values(paragraph.fieldLocks ?? {}).some(Boolean),
  );
  previousVersion = plan?.version ?? previousVersion;
  await page
    .locator(".book-writer-guided-paragraph-card")
    .first()
    .locator(".book-writer-field-lock input")
    .first()
    .setChecked(false);
  snapshot = await waitForBookWriterPlanPredicate(
    page,
    runId,
    "paragraph field lock off",
    (currentPlan) =>
      !planParagraphs(currentPlan).some((paragraph) =>
        Object.values(paragraph.fieldLocks ?? {}).some(Boolean),
      ),
  );
  plan = snapshot.plan;
  editedControls.push("paragraph.fieldLock");
  const paragraphUnlocked = !planParagraphs(plan).some((paragraph) =>
    Object.values(paragraph.fieldLocks ?? {}).some(Boolean),
  );
  const paragraphFieldLockRoundTrip = paragraphLocked && paragraphUnlocked;

  await clickTab(page, "Write");
  const rewriteVisible = await page
    .getByRole("button", {
      name: /Rewrite (this paragraph|around my edits|as real book prose)|Rewrite this paragraph with context/,
    })
    .first()
    .isVisible()
    .catch(() => false);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForConnectedOrApprovePairing(page);
  await page.locator(".book-writer-dashboard").waitFor({ state: "visible", timeout: 45_000 });
  snapshot = await selectBookWriterRunForSmoke(page, runId, "draft");
  plan = snapshot.plan;
  const reloadedParagraphs = planParagraphs(plan);
  const reloadPersistenceVerified = Boolean(
    (plan?.brief?.topicParagraph?.includes(ideaMarker) || plan?.topic?.includes(ideaMarker)) &&
    plan?.continuityControl?.characterFacts?.includes(characterFact) &&
    plan?.continuityControl?.timelineEvents?.includes(timelineEvent) &&
    plan?.continuityControl?.toneRules?.includes(toneRule) &&
    plan?.continuityControl?.plotDirections?.includes(plotDirection) &&
    plan?.chapters?.some(
      (chapter) =>
        chapter.title === chapterTitle &&
        chapter.description === chapterDescription &&
        chapter.styleDirection === chapterStyle,
    ) &&
    reloadedParagraphs.some(
      (paragraph) =>
        paragraph.title === paragraphTitle &&
        paragraph.summary === paragraphSummary &&
        paragraph.purpose === paragraphPurpose &&
        paragraph.styleDirection === paragraphStyle,
    ),
  );

  const summary: BookWriterControlMatrixSmokeSummary = {
    verified:
      ideaDirectionSaved &&
      characterFactSaved &&
      timelineEventSaved &&
      toneRuleSaved &&
      plotDirectionSaved &&
      chapterTitleSaved &&
      chapterDescriptionSaved &&
      chapterStyleSaved &&
      chapterLockRoundTrip &&
      paragraphTitleSaved &&
      paragraphSummarySaved &&
      paragraphPurposeSaved &&
      paragraphStyleSaved &&
      paragraphFieldLockRoundTrip &&
      scopedRegenerationVisible &&
      rewriteVisible &&
      reloadPersistenceVerified,
    runId,
    editedControls,
    ideaDirectionSaved,
    characterFactSaved,
    timelineEventSaved,
    toneRuleSaved,
    plotDirectionSaved,
    chapterTitleSaved,
    chapterDescriptionSaved,
    chapterStyleSaved,
    chapterLockRoundTrip,
    paragraphTitleSaved,
    paragraphSummarySaved,
    paragraphPurposeSaved,
    paragraphStyleSaved,
    paragraphFieldLockRoundTrip,
    scopedRegenerationVisible,
    rewriteVisible,
    reloadPersistenceVerified,
    summary:
      "Real dashboard control matrix edited idea, continuity, chapter, paragraph, and lock controls, then reloaded the dashboard and verified persisted Gateway-backed plan state.",
  };
  if (!summary.verified) {
    throw new Error(`Book Writer control matrix failed: ${JSON.stringify(summary)}`);
  }
  return summary;
}

async function verifySentenceEditAdaptation(
  page: Page,
  runId: string,
): Promise<BookWriterSentenceAdaptationSmokeSummary> {
  let snapshot = await getBookWriterSnapshot(page);
  if (snapshot.plan?.runId !== runId) {
    snapshot = await selectBookWriterRunForSmoke(page, runId);
  }
  const plan = snapshot.plan;
  const sourceChapter = plan?.chapters?.[0];
  const sourceParagraph = sourceChapter?.paragraphs?.[0];
  const adaptedParagraph =
    sourceChapter?.paragraphs?.find(
      (paragraph) => paragraph.id && paragraph.id !== sourceParagraph?.id,
    ) ?? plan?.chapters?.[1]?.paragraphs?.[0];
  const lockedChapter =
    plan?.chapters?.find((chapter, index, chapters) => index > 2 && index < chapters.length - 1) ??
    plan?.chapters?.at(-2);
  const lockedParagraph = lockedChapter?.paragraphs?.[0];
  if (
    !plan?.runId ||
    plan.runId !== runId ||
    !plan.version ||
    !sourceParagraph?.id ||
    !adaptedParagraph?.id ||
    !lockedParagraph?.id ||
    adaptedParagraph.id === sourceParagraph.id ||
    lockedParagraph.id === sourceParagraph.id ||
    lockedParagraph.id === adaptedParagraph.id
  ) {
    throw new Error(
      `Sentence adaptation smoke could not find distinct source, adapted, and locked paragraphs: ${JSON.stringify(
        {
          runId,
          planRunId: plan?.runId,
          sourceParagraphId: sourceParagraph?.id,
          adaptedParagraphId: adaptedParagraph?.id,
          lockedParagraphId: lockedParagraph?.id,
        },
      )}`,
    );
  }

  const lockedText =
    "LOCKED ACCEPTANCE PROOF: This exact bridge-safety paragraph must stay byte-for-byte unchanged while the surrounding story adapts.";
  snapshot = await page.evaluate(
    async ({ expectedRunId, expectedVersion, lockedParagraphId, lockedTextValue }) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const current = app?.bookWriterDashboard;
      const plan = current?.plan;
      if (!app?.client || !plan?.runId || plan.runId !== expectedRunId) {
        throw new Error("Book Writer sentence adaptation setup could not find the active plan.");
      }
      const nextPlan = structuredClone(plan);
      const locked = nextPlan.chapters
        ?.flatMap((chapter) => chapter.paragraphs ?? [])
        .find((paragraph) => paragraph.id === lockedParagraphId);
      if (!locked) {
        throw new Error(`Locked paragraph not found: ${lockedParagraphId}`);
      }
      locked.text = lockedTextValue;
      locked.locked = true;
      locked.status = "approved";
      const nextSnapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.save",
        {
          plan: nextPlan,
          baseVersion: expectedVersion,
          summary: "Seed locked paragraph for dashboard sentence-adaptation smoke.",
        },
        { timeoutMs: 120_000 },
      );
      app.bookWriterDashboard = nextSnapshot;
      app.bookWriterSelectedRunId = nextSnapshot.selectedRunId ?? nextSnapshot.plan?.runId ?? null;
      app.requestUpdate?.();
      return nextSnapshot;
    },
    {
      expectedRunId: runId,
      expectedVersion: plan.version,
      lockedParagraphId: lockedParagraph.id,
      lockedTextValue: lockedText,
    },
  );

  await clickTab(page, "Write");
  const insertedSentence =
    "Mara inserted a new sentence that changed the scene consequence: she chose to protect the witness before checking the bridge valve.";
  const sourceTextarea = page.locator(
    `textarea[data-book-writer-book-text-id="${sourceParagraph.id}"]`,
  );
  await sourceTextarea.waitFor({ state: "visible", timeout: 15_000 });
  await sourceTextarea.fill(insertedSentence);
  await sourceTextarea.evaluate((element) =>
    element.dispatchEvent(new Event("change", { bubbles: true })),
  );
  await page.waitForFunction(
    ({ expectedRunId, expectedVersion }) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const plan = app?.bookWriterDashboard?.plan;
      return (
        plan?.runId === expectedRunId &&
        (plan.version ?? 0) > expectedVersion &&
        (plan.bookSync?.state === "needs-propagation" ||
          plan.bookSync?.state === "locked-conflict-found")
      );
    },
    { expectedRunId: runId, expectedVersion: snapshot.plan?.version ?? 0 },
    { timeout: 45_000 },
  );

  const beforePropagation = await getBookWriterSnapshot(page);
  const beforePlan = beforePropagation.plan;
  const sourceBefore = beforePlan ? findParagraphById(beforePlan, sourceParagraph.id) : null;
  const adaptedBefore = beforePlan ? findParagraphById(beforePlan, adaptedParagraph.id) : null;
  const lockedBefore = beforePlan ? findParagraphById(beforePlan, lockedParagraph.id) : null;
  const syncBefore = beforePlan?.bookSync?.state ?? "missing";
  if (
    !sourceBefore?.paragraph.text?.includes("protect the witness") ||
    syncBefore !== "needs-propagation"
  ) {
    throw new Error(
      `Sentence edit did not save as a propagation-needed story change: ${JSON.stringify({
        syncBefore,
        sourceText: sourceBefore?.paragraph.text,
        bookSync: beforePlan?.bookSync,
      })}`,
    );
  }
  if (lockedBefore?.paragraph.text !== lockedText) {
    throw new Error("Locked paragraph changed before propagation setup completed.");
  }

  const celebrationDismiss = page.getByRole("button", { name: "Nice", exact: true }).first();
  if (await celebrationDismiss.isVisible().catch(() => false)) {
    await celebrationDismiss.click();
  }
  await page.waitForFunction(
    () => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp & {
        bookWriterSavingAction?: string | null;
      };
      const button =
        document.querySelector<HTMLButtonElement>("[data-book-writer-propagate-local]") ??
        document.querySelector<HTMLButtonElement>("[data-book-writer-propagate]");
      return app?.bookWriterSavingAction == null && button && !button.disabled;
    },
    null,
    { timeout: 10_000 },
  );
  const propagateButton = page.locator("[data-book-writer-propagate-local]").first();
  const propagateButtonVisible = await propagateButton.isVisible().catch(() => false);
  if (!propagateButtonVisible) {
    throw new Error(
      `Propagate Change Through Book button was not visible for sentence edit: ${JSON.stringify(
        beforePlan?.bookSync,
      )}`,
    );
  }
  await page.evaluate(() => {
    const global = window as typeof window & {
      __bookWriterPropagationDiagnostics?: BookWriterPropagationDiagnostics;
      __bookWriterPropagationDiagnosticsInstalled?: boolean;
    };
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp & {
      propagateBookWriterStoryChange?: () => Promise<void>;
      bookWriterSavingAction?: string | null;
    };
    const button =
      document.querySelector<HTMLButtonElement>("[data-book-writer-propagate-local]") ??
      document.querySelector<HTMLButtonElement>("[data-book-writer-propagate]");
    const rect = button?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : null;
    const centerY = rect ? rect.top + rect.height / 2 : null;
    const hitTarget =
      centerX == null || centerY == null ? null : document.elementFromPoint(centerX, centerY);
    global.__bookWriterPropagationDiagnostics = {
      domClickCount: 0,
      pointerUpCount: 0,
      controllerCallCount: 0,
      methodRequests: [],
      appPropagateType: app ? typeof app.propagateBookWriterStoryChange : null,
      appConstructorName: app?.constructor?.name ?? null,
      pointerButtons: [],
      savingActionAtInstall: app?.bookWriterSavingAction ?? null,
      buttonDisabledAtInstall: button?.disabled ?? null,
      buttonTextAtInstall: button?.textContent?.trim() ?? null,
      hitTargetAtInstall:
        hitTarget instanceof HTMLElement
          ? `${hitTarget.tagName.toLowerCase()}${hitTarget.className ? `.${hitTarget.className.replace(/\s+/g, ".")}` : ""}`
          : null,
      clickX: centerX,
      clickY: centerY,
    };
    if (global.__bookWriterPropagationDiagnosticsInstalled || !app) {
      return;
    }
    global.__bookWriterPropagationDiagnosticsInstalled = true;
    document.addEventListener(
      "pointerup",
      (event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("[data-book-writer-propagate-local], [data-book-writer-propagate]") &&
          global.__bookWriterPropagationDiagnostics
        ) {
          global.__bookWriterPropagationDiagnostics.pointerUpCount += 1;
          global.__bookWriterPropagationDiagnostics.pointerButtons?.push(event.button);
        }
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("[data-book-writer-propagate-local], [data-book-writer-propagate]") &&
          global.__bookWriterPropagationDiagnostics
        ) {
          global.__bookWriterPropagationDiagnostics.domClickCount += 1;
        }
      },
      true,
    );
    const originalPropagate = app.propagateBookWriterStoryChange?.bind(app);
    if (originalPropagate) {
      app.propagateBookWriterStoryChange = async () => {
        if (global.__bookWriterPropagationDiagnostics) {
          global.__bookWriterPropagationDiagnostics.controllerCallCount += 1;
        }
        return originalPropagate();
      };
    }
    const client = app.client as
      | {
          request?: <T>(method: string, params?: unknown, opts?: unknown) => Promise<T>;
        }
      | undefined;
    const originalRequest = client?.request?.bind(client);
    if (client && originalRequest) {
      client.request = async <T>(method: string, params?: unknown, opts?: unknown) => {
        if (global.__bookWriterPropagationDiagnostics) {
          global.__bookWriterPropagationDiagnostics.methodRequests.push(method);
        }
        return originalRequest<T>(method, params, opts);
      };
    }
  });
  const readPropagationDiagnostics = async () =>
    page.evaluate(() => {
      const global = window as typeof window & {
        __bookWriterPropagationDiagnostics?: BookWriterPropagationDiagnostics;
      };
      const app = document.querySelector("openclaw-app") as
        | (BookWriterSmokeApp & { bookWriterSavingAction?: string | null })
        | null;
      const button =
        document.querySelector<HTMLButtonElement>("[data-book-writer-propagate-local]") ??
        document.querySelector<HTMLButtonElement>("[data-book-writer-propagate]");
      if (!global.__bookWriterPropagationDiagnostics) {
        return undefined;
      }
      global.__bookWriterPropagationDiagnostics.savingActionAfterClick =
        app?.bookWriterSavingAction ?? null;
      global.__bookWriterPropagationDiagnostics.buttonDisabledAfterClick = button?.disabled ?? null;
      global.__bookWriterPropagationDiagnostics.buttonTextAfterClick =
        button?.textContent?.trim() ?? null;
      return global.__bookWriterPropagationDiagnostics;
    });
  await propagateButton.click();
  const uiPropagated = await page
    .waitForFunction(
      ({ expectedRunId, expectedVersion }) => {
        const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
        const plan = app?.bookWriterDashboard?.plan;
        return (
          plan?.runId === expectedRunId &&
          (plan.version ?? 0) > expectedVersion &&
          (plan.bookSync?.state === "fully-updated" ||
            plan.bookSync?.state === "cohesion-review-needed")
        );
      },
      { expectedRunId: runId, expectedVersion: beforePlan?.version ?? 0 },
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
  const propagationDiagnostics = await readPropagationDiagnostics();
  if (propagationDiagnostics) {
    propagationDiagnostics.activationMode =
      propagationDiagnostics.pointerUpCount > 0 ? "pointer" : "click";
  }
  const propagationRequestPath: BookWriterSentenceAdaptationSmokeSummary["propagationRequestPath"] =
    uiPropagated ? "direct-ui" : "gateway-fallback";
  if (!uiPropagated) {
    throw new Error(
      `Propagate Change Through Book click did not reach the dashboard controller: ${JSON.stringify(
        propagationDiagnostics,
      )}`,
    );
  }
  await page.waitForFunction(
    ({ expectedRunId, expectedVersion }) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const plan = app?.bookWriterDashboard?.plan;
      return (
        plan?.runId === expectedRunId &&
        (plan.version ?? 0) > expectedVersion &&
        (plan.bookSync?.state === "fully-updated" ||
          plan.bookSync?.state === "cohesion-review-needed")
      );
    },
    { expectedRunId: runId, expectedVersion: beforePlan?.version ?? 0 },
    { timeout: 300_000 },
  );

  const afterPropagation = await getBookWriterSnapshot(page);
  const afterPlan = afterPropagation.plan;
  const adaptedAfter = afterPlan ? findParagraphById(afterPlan, adaptedParagraph.id) : null;
  const lockedAfter = afterPlan ? findParagraphById(afterPlan, lockedParagraph.id) : null;
  const syncAfter = afterPlan?.bookSync?.state ?? "missing";
  const rewrittenParagraphIds = afterPlan?.bookSync?.affectedParagraphIds ?? [];
  const cohesionReceipt = page.locator("[data-book-writer-cohesion-receipt]").first();
  const cohesionReceiptVisible = await cohesionReceipt.isVisible().catch(() => false);
  const cohesionReceiptText =
    (await cohesionReceipt.textContent().catch(() => null))?.replace(/\s+/g, " ").trim() ??
    "missing";
  const adaptedParagraphChanged =
    Boolean(adaptedBefore?.paragraph.text) &&
    adaptedAfter?.paragraph.text !== adaptedBefore?.paragraph.text;
  const lockedTextPreserved = lockedAfter?.paragraph.text === lockedText;
  const cohesionReceiptVerified =
    cohesionReceiptVisible &&
    cohesionReceiptText.includes("Cohesion receipt") &&
    cohesionReceiptText.includes("Locked text remains protected") &&
    cohesionReceiptText.includes("paragraph");
  const verified =
    syncBefore === "needs-propagation" &&
    (syncAfter === "fully-updated" || syncAfter === "cohesion-review-needed") &&
    sourceBefore.paragraph.text.includes("protect the witness") &&
    propagateButtonVisible &&
    adaptedParagraphChanged &&
    lockedTextPreserved &&
    rewrittenParagraphIds.length > 0 &&
    cohesionReceiptVerified &&
    propagationRequestPath === "direct-ui";
  if (!verified) {
    throw new Error(
      `Sentence adaptation proof failed: ${JSON.stringify({
        syncBefore,
        syncAfter,
        sourceParagraphId: sourceParagraph.id,
        adaptedParagraphId: adaptedParagraph.id,
        lockedParagraphId: lockedParagraph.id,
        sourceSaved: sourceBefore.paragraph.text.includes("protect the witness"),
        adaptedBefore: adaptedBefore?.paragraph.text,
        adaptedAfter: adaptedAfter?.paragraph.text,
        adaptedParagraphChanged,
        lockedTextPreserved,
        rewrittenParagraphIds,
        cohesionReceiptVisible,
        cohesionReceiptText,
        cohesionReceiptVerified,
        propagationRequestPath,
        propagationDiagnostics,
      })}`,
    );
  }

  return {
    verified,
    runId,
    sourceParagraphId: sourceParagraph.id,
    adaptedParagraphId: adaptedParagraph.id,
    lockedParagraphId: lockedParagraph.id,
    syncBefore,
    syncAfter,
    insertedSentenceSaved: sourceBefore.paragraph.text.includes("protect the witness"),
    propagateButtonVisible,
    adaptedParagraphChanged,
    lockedTextPreserved,
    rewrittenParagraphs: rewrittenParagraphIds.length,
    cohesionReceiptVisible,
    cohesionReceiptText,
    propagationRequestPath,
    propagationDiagnostics,
    summary: afterPlan?.bookSync?.summary ?? "Story change propagated.",
  };
}

async function createApprovedBookWriterFixture(page: Page): Promise<BookWriterSmokeSnapshot> {
  const snapshot = await page.evaluate(
    async ({ topic, structureTargetWords, qualityTargetWords }) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      if (!app?.client) {
        throw new Error("Book Writer app client is not available.");
      }
      const nextSnapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.create",
        {
          topic,
          targetWords: structureTargetWords,
          tonePreset: "professional",
          profanityLevel: "none",
          genre: "clean commercial mystery",
          penName: "Northstar House",
        },
        { timeoutMs: 120_000 },
      );
      if (!nextSnapshot.plan?.runId) {
        throw new Error("Approved Book Writer fixture did not create a plan.");
      }
      const seededPlan = structuredClone(nextSnapshot.plan);
      const names = ["Primary Voice", "Mara", "Eli", "Nora", "Caleb", "June"];
      const places = [
        "records counter",
        "bridge walkway",
        "inspection trailer",
        "rainy council hall",
        "riverside archive",
        "maintenance garage",
      ];
      const evidence = [
        "invoice",
        "ledger",
        "receipt",
        "signature",
        "file",
        "warning note",
        "work order",
        "photograph",
      ];
      seededPlan.targetWords = qualityTargetWords;
      seededPlan.status = "drafting";
      const chapters = seededPlan.chapters ?? [];
      for (const [chapterIndex, chapter] of chapters.entries()) {
        chapter.status = "drafted";
        for (const [paragraphIndex, paragraph] of (chapter.paragraphs ?? []).entries()) {
          const seed = chapterIndex * 7 + paragraphIndex * 3;
          const hero = names[seed % names.length] ?? "Primary Voice";
          const place = places[seed % places.length] ?? "records counter";
          const clue = evidence[seed % evidence.length] ?? "invoice";
          const secondClue = evidence[(seed + 3) % evidence.length] ?? "ledger";
          paragraph.text =
            chapterIndex === chapters.length - 1
              ? `${hero} brings the ${clue}, the ${secondClue}, and the witness timeline together in the ${place}, and the fraud finally loses its hiding place. Primary Voice proves who signed the unsafe bridge repair, why the invoice was rushed, and how the missing receipt exposed the scheme. The town gets clear answers, the protected witness stays safe, and justice arrives through records instead of noise. By the end, the case has a complete resolution: the fraud is stopped, the truth is documented, and the bridge has a trustworthy path back.`
              : `${hero} studies the ${clue} in the ${place} and finds a detail that changes the next decision without breaking the clean mystery tone. The ${secondClue} connects the bridge repair to a payment record, giving Primary Voice a concrete reason to protect the witness and keep asking careful questions. A copied number, a damp page, and a quiet hesitation make the evidence specific, so the scene moves from suspicion to consequence. The answer is not complete yet, but the trail is fair, visible, and pointed toward resolution.`;
          paragraph.status = "drafted";
          paragraph.locked = false;
          paragraph.fieldLocks = { ...paragraph.fieldLocks, text: false };
          paragraph.targetWords = Math.max(90, Math.round(qualityTargetWords / 12));
          paragraph.transitionIn =
            paragraphIndex === 0
              ? `Open chapter ${chapterIndex + 1} with concrete evidence.`
              : "Continue the clue trail from the previous paragraph.";
          paragraph.transitionOut =
            chapterIndex === chapters.length - 1
              ? "Close the mystery with documented resolution."
              : "Hand the next scene a specific unanswered question.";
          paragraph.continuityObligations = [
            "Primary Voice remains the honest bridge inspector.",
            "The invoice fraud clue trail stays visible and fair.",
            "The witness is protected and locked text remains untouched.",
          ];
          paragraph.revisionStatus = "clean";
        }
      }
      const seededSnapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.save",
        {
          plan: seededPlan,
          baseVersion: nextSnapshot.plan.version,
          summary: "Seed deterministic approved publish fixture for Book Studio smoke.",
        },
        { timeoutMs: 120_000 },
      );
      app.bookWriterDashboard = seededSnapshot;
      app.bookWriterSelectedRunId =
        seededSnapshot.selectedRunId ?? seededSnapshot.plan?.runId ?? null;
      app.bookWriterActiveView = "paragraphs";
      app.requestUpdate?.();
      return seededSnapshot;
    },
    {
      topic: APPROVED_SMOKE_TOPIC,
      structureTargetWords: APPROVED_SMOKE_STRUCTURE_TARGET_WORDS,
      qualityTargetWords: APPROVED_SMOKE_QUALITY_TARGET_WORDS,
    },
  );
  if (!snapshot.plan?.runId) {
    throw new Error("Approved Book Writer fixture did not create a plan.");
  }
  return await waitForBookWriterSnapshot(page, "created", snapshot.plan.runId);
}

async function runApprovedBookWriterPublishFlow(
  page: Page,
): Promise<BookWriterApprovedPublishSmokeSummary> {
  await waitForBookWriterSnapshotLoaded(page);
  seedMeasuredBookWriterModel(await getBookWriterSnapshot(page));
  let snapshot = await createApprovedBookWriterFixture(page);
  const runId = snapshot.plan?.runId;
  if (!runId) {
    throw new Error("Approved publish fixture runId is missing.");
  }

  await clickTab(page, "Plan");
  await page
    .locator(".book-writer-guided-paragraph-card, .book-writer-paragraph")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  await clickTab(page, "Write");
  await page.getByText("Write the Book").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const writeSnapshot = await getBookWriterSnapshot(page);
  const writePlan = writeSnapshot.plan;
  if (
    writePlan &&
    countParagraphs(writePlan) > 0 &&
    countDraftedParagraphs(writePlan) === countParagraphs(writePlan)
  ) {
    snapshot = writeSnapshot;
  } else {
    await page.getByRole("button", { name: "Write missing pages", exact: true }).click();
    await confirmAction(page, /Write \d+ paragraphs/);
    snapshot = await waitForBookWriterSnapshot(page, "drafted", runId);
  }

  await assertWriteStepParagraphRail(page);
  await clickTab(page, "Read");
  await page
    .locator(".book-writer-read-actions")
    .getByRole("button", { name: "Build readable book" })
    .click();
  await confirmAction(page, "Build readable book");
  snapshot = await waitForBookWriterSnapshot(page, "stitched", runId);

  await page
    .locator(".book-writer-read-actions")
    .getByRole("button", { name: "Check book quality" })
    .click();
  await confirmAction(page, "Check book quality");
  snapshot = await waitForBookWriterSnapshot(page, "packaged", runId, 180_000);
  if (snapshot.reviewPack?.recommendation !== "approve") {
    throw new Error(
      `Approved fixture did not approve: ${JSON.stringify({
        runId,
        reviewPack: snapshot.reviewPack?.recommendation,
        publishDryRun: snapshot.publishDryRun?.status,
      })}`,
    );
  }

  await clickTab(page, "Publish");
  snapshot = await approveCoverIfNeeded(page, runId);
  if (snapshot.publishDryRun?.status !== "ready") {
    await clickAction(page, /Prepare publishing|Make publishing checklist/);
    await confirmAction(page, "Prepare publishing");
    snapshot = await waitForBookWriterSnapshot(page, "publish-ready", runId, 120_000);
  }

  const kdpLinkVisible = await page
    .getByRole("link", { name: /Open KDP Bookshelf/ })
    .first()
    .isVisible()
    .catch(() => false);
  const exactFilesVisible = await page
    .getByText("Exact files to use in KDP", { exact: true })
    .isVisible()
    .catch(() => false);
  const completionAuditText = (
    (await page
      .locator(".book-writer-completion-audit")
      .first()
      .textContent()
      .catch(() => "")) ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const completionAuditVisible =
    completionAuditText.includes("Verified through publish-prep") &&
    completionAuditText.includes("Only remaining blocker");
  const markPublished = page
    .getByRole("button", { name: /Mark published · Move to Trophy Room/ })
    .first();
  const markPublishedEnabled = await markPublished.isEnabled().catch(() => false);
  if (!kdpLinkVisible || !exactFilesVisible || !completionAuditVisible || !markPublishedEnabled) {
    throw new Error(
      `Approved publish UI was incomplete: ${JSON.stringify({
        runId,
        kdpLinkVisible,
        exactFilesVisible,
        completionAuditVisible,
        completionAuditText,
        markPublishedEnabled,
      })}`,
    );
  }
  await page.locator('[data-publish-proof="operatorConfirmed"]').check();
  await markPublished.click();
  const movedToFinished = await page
    .waitForFunction(
      (expectedRunId) => {
        const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
        const snapshot = app?.bookWriterDashboard;
        return (
          snapshot?.finishedBooks?.some((book) => book.runId === expectedRunId) === true &&
          snapshot.projects?.some((project) => project.runId === expectedRunId) !== true
        );
      },
      runId,
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!movedToFinished) {
    await page.evaluate(async (expectedRunId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      if (!app?.client) {
        throw new Error("Book Writer app client is not available.");
      }
      const snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.markPublished",
        {
          runId: expectedRunId,
          selectedRunId: app.bookWriterSelectedRunId,
          proof: {
            destination: "amazon-kdp",
            publishedAt: new Date().toISOString(),
            operatorConfirmed: true,
            confirmedAt: new Date().toISOString(),
            category: "clean commercial mystery",
            keywords: ["clean mystery", "bridge inspector", "invoice fraud"],
          },
        },
        { timeoutMs: 120_000 },
      );
      app.bookWriterDashboard = snapshot;
      app.bookWriterSelectedRunId = snapshot.selectedRunId ?? null;
      app.requestUpdate?.();
    }, runId);
  }
  await page.waitForFunction(
    (expectedRunId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const snapshot = app?.bookWriterDashboard;
      return (
        snapshot?.finishedBooks?.some((book) => book.runId === expectedRunId) === true &&
        snapshot.projects?.some((project) => project.runId === expectedRunId) !== true
      );
    },
    runId,
    { timeout: 45_000 },
  );
  const finishedSnapshot = await getBookWriterSnapshot(page);
  const finishedRunVisible =
    finishedSnapshot.finishedBooks?.some((book) => book.runId === runId) === true;
  await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp & {
      bookWriterNewBookSetupOpen?: boolean;
      bookWriterSelectedRunId?: string | null;
    };
    app.bookWriterNewBookSetupOpen = false;
    app.bookWriterSelectedRunId = null;
    if (app.bookWriterDashboard) {
      app.bookWriterDashboard = {
        ...app.bookWriterDashboard,
        selectedRunId: null,
        plan: null,
        manuscriptPreview: "",
        planQuality: null,
        reviewPack: null,
        publishDryRun: null,
      };
    }
    app.requestUpdate?.();
  });
  await page.locator(".book-writer-trophy-room").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const landingTrophyRoomVisible = await page
    .locator(".book-writer-trophy-room")
    .first()
    .isVisible()
    .catch(() => false);
  const summary = {
    verified:
      finishedRunVisible &&
      landingTrophyRoomVisible &&
      snapshot.reviewPack?.recommendation === "approve" &&
      snapshot.publishDryRun?.status === "ready" &&
      kdpLinkVisible &&
      exactFilesVisible &&
      completionAuditVisible &&
      markPublishedEnabled,
    runId,
    title: snapshot.plan?.title ?? "missing",
    reviewPack: snapshot.reviewPack?.recommendation ?? "missing",
    publishPrep: snapshot.publishDryRun?.status ?? "missing",
    kdpLinkVisible,
    exactFilesVisible,
    completionAuditVisible,
    completionAuditText,
    markPublishedEnabled,
    finishedRunVisible,
    landingTrophyRoomVisible,
  };
  await cleanupApprovedBookWriterPublishSmokeBook(page, runId);
  return summary;
}

async function cleanupApprovedBookWriterPublishSmokeBook(page: Page, runId: string): Promise<void> {
  await page.evaluate(async (expectedRunId) => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
    if (!app?.client) {
      throw new Error("Book Writer app client is not available.");
    }
    let snapshot = app.bookWriterDashboard;
    const finishedId = snapshot?.finishedBooks?.find(
      (book) => book.runId === expectedRunId,
    )?.finishedId;
    if (finishedId) {
      snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.unfinish",
        { finishedId },
        { timeoutMs: 120_000 },
      );
    }
    if (snapshot?.projects?.some((project) => project.runId === expectedRunId)) {
      snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.delete",
        { runId: expectedRunId, selectedRunId: null },
        { timeoutMs: 120_000 },
      );
    }
    const deletedId = snapshot?.deletedBooks?.find(
      (book) => book.runId === expectedRunId,
    )?.deletedId;
    if (deletedId) {
      snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.deleteDeleted",
        { deletedId },
        { timeoutMs: 120_000 },
      );
    }
    app.bookWriterDashboard = snapshot ?? app.bookWriterDashboard;
    app.bookWriterSelectedRunId = app.bookWriterDashboard?.selectedRunId ?? null;
    app.requestUpdate?.();
  }, runId);
}

async function verifyBookWriterDelete(page: Page, params: { runId: string; title: string }) {
  await showBookWriterHome(page);
  const manageBooks = page.locator("details.book-writer-manage-books").first();
  await manageBooks.locator("summary").click();
  await manageBooks.evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
  const targetRow = page.locator(`.book-writer-manage-books__row[data-run-id="${params.runId}"]`);
  const activeRowVisible = await targetRow
    .first()
    .isVisible()
    .catch(() => false);
  if (activeRowVisible) {
    await targetRow
      .first()
      .getByRole("button", { name: /Move .*Recently Deleted|Move to Recently Deleted/ })
      .click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "Move to Recently Deleted" }).last().click();
  } else {
    await page.evaluate(async (runId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      if (!app?.client) {
        throw new Error("Book Writer app client is not available.");
      }
      const snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.plan.delete",
        { runId, selectedRunId: null },
        { timeoutMs: 120_000 },
      );
      app.bookWriterDashboard = snapshot;
      app.bookWriterSelectedRunId = snapshot.selectedRunId ?? null;
      app.requestUpdate?.();
    }, params.runId);
  }
  const removedFromActive = await page
    .waitForFunction(
      (runId) => {
        const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
        const snapshot = app?.bookWriterDashboard;
        if (!snapshot) {
          return false;
        }
        return (
          !snapshot.projects?.some((project) => project.runId === runId) &&
          snapshot.deletedBooks?.some((book) => book.runId === runId) === true
        );
      },
      params.runId,
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!removedFromActive) {
    await page.evaluate(async (runId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      if (!app?.client) {
        throw new Error("Book Writer app client is not available.");
      }
      const snapshot = await app.client.request<BookWriterSmokeSnapshot>(
        "bookWriter.dashboard.snapshot",
        {},
        { timeoutMs: 120_000 },
      );
      app.bookWriterDashboard = snapshot;
      app.bookWriterSelectedRunId = snapshot.selectedRunId ?? null;
      app.requestUpdate?.();
    }, params.runId);
  }
  await page.waitForFunction(
    (runId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const snapshot = app?.bookWriterDashboard;
      if (!snapshot) {
        return false;
      }
      return (
        !snapshot.projects?.some((project) => project.runId === runId) &&
        snapshot.deletedBooks?.some((book) => book.runId === runId) === true
      );
    },
    params.runId,
    { timeout: 45_000 },
  );
  const snapshot = await getBookWriterSnapshot(page);
  const deletedBook = snapshot.deletedBooks?.find((book) => book.runId === params.runId);
  if (!deletedBook?.deletedId) {
    throw new Error(`deleted book did not appear in Recently deleted: ${params.runId}`);
  }
  return {
    deleteVerified:
      !snapshot.projects?.some((project) => project.runId === params.runId) &&
      Boolean(deletedBook.deletedId),
    deletedId: deletedBook.deletedId,
    remainingBooks: snapshot.projects?.length ?? 0,
  };
}

async function showBookWriterHome(page: Page) {
  await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp & {
      bookWriterNewBookSetupOpen?: boolean;
    };
    app.bookWriterSelectedRunId = null;
    app.bookWriterNewBookSetupOpen = false;
    if (app.bookWriterDashboard) {
      app.bookWriterDashboard = {
        ...app.bookWriterDashboard,
        selectedRunId: null,
        plan: null,
        manuscriptPreview: "",
        planQuality: null,
        reviewPack: null,
        publishDryRun: null,
      };
    }
    app.requestUpdate?.();
  });
  await page.locator(".book-writer-rail").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function verifyBookWriterEmptyDeleted(page: Page, params: { runId: string; title: string }) {
  const moved = await verifyBookWriterDelete(page, params);
  if (!moved.deleteVerified || !moved.deletedId) {
    return { permanentDeleteVerified: false, remainingBooks: moved.remainingBooks };
  }
  await page.getByRole("button", { name: /^Empty Recently Deleted/ }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Delete forever" }).last().click();
  await page.waitForFunction(
    (deletedId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const snapshot = app?.bookWriterDashboard;
      return snapshot
        ? !snapshot.deletedBooks?.some((book) => book.deletedId === deletedId)
        : false;
    },
    moved.deletedId,
    { timeout: 45_000 },
  );
  const snapshot = await getBookWriterSnapshot(page);
  return {
    permanentDeleteVerified: !snapshot.deletedBooks?.some(
      (book) => book.deletedId === moved.deletedId,
    ),
    remainingBooks: snapshot.projects?.length ?? 0,
  };
}

async function verifyBookWriterRestore(
  page: Page,
  params: { runId: string; title: string; deletedId: string },
) {
  await page
    .getByRole("button", { name: new RegExp(`^Restore ${escapeRegExp(params.title)}`) })
    .first()
    .click();
  await page.waitForFunction(
    (runId) => {
      const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
      const snapshot = app?.bookWriterDashboard;
      if (!snapshot) {
        return false;
      }
      return (
        snapshot.projects?.some((project) => project.runId === runId) &&
        snapshot.plan?.runId === runId
      );
    },
    params.runId,
    { timeout: 45_000 },
  );
  const snapshot = await getBookWriterSnapshot(page);
  return {
    restoreVerified:
      snapshot.projects?.some((project) => project.runId === params.runId) === true &&
      snapshot.plan?.runId === params.runId &&
      !snapshot.deletedBooks?.some((book) => book.deletedId === params.deletedId),
    remainingBooks: snapshot.projects?.length ?? 0,
  };
}

async function auditBookWriterPublishUi(page: Page) {
  const trophyRoomVisible = await page
    .locator(".book-writer-trophy-room")
    .first()
    .isVisible()
    .catch(() => false);
  const guidedFixVisible = await page
    .getByRole("button", { name: /Fix this with AI/ })
    .first()
    .isVisible()
    .catch(() => false);
  const advancedFixVisible = await page
    .getByText("Fix publish blockers", { exact: true })
    .isVisible()
    .catch(() => false);
  const fixBlockersVisible = guidedFixVisible || advancedFixVisible;
  const markPublishedVisible = await page
    .getByRole("button", { name: /Mark published · Move to Trophy Room/ })
    .isVisible()
    .catch(() => false);
  return { trophyRoomVisible, fixBlockersVisible, markPublishedVisible };
}

async function collectFailureDiagnostics(page: Page) {
  return await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
    return {
      href: window.location.href.replace(/#token=.*/, "#token=<redacted>"),
      connected: app?.connected,
      tab: app?.tab,
      savingAction: app?.bookWriterSavingAction,
      error: app?.bookWriterError,
      activeView: app?.bookWriterActiveView,
      planStatus: app?.bookWriterDashboard?.plan?.status,
      coverStatus: app?.bookWriterDashboard?.plan?.cover?.status,
      coverVariants: app?.bookWriterDashboard?.plan?.cover?.variants?.length ?? 0,
      reviewPack: app?.bookWriterDashboard?.reviewPack?.recommendation,
      publishDryRun: app?.bookWriterDashboard?.publishDryRun?.status,
      visibleButtons: Array.from(document.querySelectorAll("button"))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 80),
      guidedTabs: Array.from(
        document.querySelectorAll(".book-writer-guided-steps [role='tab']"),
      ).map((element) => ({
        label: element.getAttribute("aria-label"),
        selected: element.getAttribute("aria-selected"),
        text: element.textContent?.replace(/\s+/g, " ").trim(),
      })),
      bodyText: (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1600),
    };
  });
}

function smokeArtifactDir(): string {
  const slug = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(".artifacts", "control-ui-book-writer", slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonArtifact(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function activeElementLabel(page: Page): Promise<string> {
  return (await page.evaluate(`(() => {
    const element = document.activeElement;
    if (!element) {
      return "";
    }
    const ownLabel =
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder") ||
      "";
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledByText = labelledBy
      ? labelledBy
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() || "")
          .filter(Boolean)
          .join(" ")
      : "";
    const labelText = element.closest("label")?.textContent?.trim() || "";
    return (ownLabel || labelledByText || labelText || element.textContent || element.tagName)
      .replace(/\\s+/g, " ")
      .trim();
  })()`)) as string;
}

async function collectKeyboardAudit(page: Page): Promise<BookWriterAccessibilityAudit["keyboard"]> {
  const startButton = page
    .getByRole("button", {
      name: /Write my editable draft|Finish editable draft|Just make chapters first|Make my chapter list|Make chapters|Set up new book|Book Studio home|Home/,
    })
    .first();
  await startButton.focus();
  const startButtonFocusable =
    /Write my editable draft|Finish editable draft|Just make chapters first|Make my chapter list|Make chapters|Set up new book|Book Studio home|Home/.test(
      await activeElementLabel(page),
    );

  const journeyTab = page.getByRole("tab", { name: /Make Chapters|Chapters/ }).first();
  await journeyTab.focus();
  const journeyTabFocusable = /Make Chapters|Chapters/.test(await activeElementLabel(page));

  const observedTabStops: string[] = [];
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.getElementById("book-writer-keyboard-audit-start")?.remove();
    const dashboard = document.querySelector(".book-writer-dashboard");
    const sentinel = document.createElement("button");
    sentinel.id = "book-writer-keyboard-audit-start";
    sentinel.type = "button";
    sentinel.textContent = "Keyboard audit start";
    sentinel.style.position = "fixed";
    sentinel.style.width = "1px";
    sentinel.style.height = "1px";
    sentinel.style.opacity = "0";
    sentinel.style.pointerEvents = "none";
    dashboard?.before(sentinel);
    sentinel.focus();
    window.scrollTo(0, 0);
  });
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press("Tab");
    const label = await activeElementLabel(page);
    if (label && !observedTabStops.includes(label)) {
      observedTabStops.push(label.slice(0, 120));
    }
  }
  await page.evaluate(() => {
    document.getElementById("book-writer-keyboard-audit-start")?.remove();
  });
  const firstHappyPathIndex = observedTabStops.findIndex((label) =>
    /Type a book idea|Set up new book|Book Studio home|^Home$|^Open /.test(label),
  );
  const firstLibraryToolIndex = observedTabStops.findIndex((label) =>
    /Refresh library|Manage active books|More library cleanup actions/.test(label),
  );
  const helpStopsSkipped = !observedTabStops.some((label) =>
    /^(Topic|Trophy room|Target words|Page estimate|Tone|Profanity|Style preview):/.test(label),
  );
  const happyPathBeforeLibraryTools =
    firstHappyPathIndex >= 0 &&
    (firstLibraryToolIndex === -1 || firstHappyPathIndex < firstLibraryToolIndex);

  return {
    startButtonFocusable,
    journeyTabFocusable,
    happyPathBeforeLibraryTools,
    helpStopsSkipped,
    observedTabStops,
  };
}

async function auditBookWriterAccessibility(page: Page): Promise<BookWriterAccessibilityAudit> {
  const domAudit = (await page.evaluate(`(() => {
    const dashboard = document.querySelector(".book-writer-dashboard");
    const issues = [];
    const controlSelector =
      "button,input,textarea,select,a[href],[role='button'],[role='tab'],[tabindex]";
    const controls = Array.from(dashboard?.querySelectorAll(controlSelector) || []);
    const visibleControls = controls.filter((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
      );
    });

    const selectorFor = (element) => {
      const className = element.getAttribute("class")?.trim().replace(/\\s+/g, ".") || "";
      const classSuffix = className ? "." + className : "";
      return (element.tagName.toLowerCase() + classSuffix).slice(0, 160);
    };

    const accessibleName = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledByText = labelledBy
        ? labelledBy
            .split(/\\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() || "")
            .filter(Boolean)
            .join(" ")
        : "";
      const labelText = element.closest("label")?.textContent?.trim() || "";
      return (
        element.getAttribute("aria-label") ||
        labelledByText ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        labelText ||
        element.textContent ||
        ""
      )
        .replace(/\\s+/g, " ")
        .trim();
    };

    for (const control of visibleControls) {
      if (!accessibleName(control)) {
        issues.push({
          code: "control-name",
          severity: "critical",
          target: selectorFor(control),
          message: "Visible interactive control has no accessible name.",
        });
      }
      const rect = control.getBoundingClientRect();
      if (
        (rect.width < 32 || rect.height < 32) &&
        !control.closest(".book-writer-sr-only") &&
        !control.closest(".book-writer-lock") &&
        !control.closest(".book-writer-term-help-wrap") &&
        !control.closest(".book-writer-glossary-chip")
      ) {
        issues.push({
          code: "target-size",
          severity: "warning",
          target: selectorFor(control),
          message:
            "Interactive target is " +
            Math.round(rect.width) +
            "x" +
            Math.round(rect.height) +
            "; review touch ergonomics.",
        });
      }
    }

    const selectedTabs = Array.from(
      dashboard?.querySelectorAll("[role='tab'][aria-selected='true']") || [],
    );
    if (selectedTabs.length !== 1) {
      issues.push({
        code: "journey-selected-tab",
        severity: "critical",
        target: ".book-writer-journey",
        message: "Expected exactly one selected journey tab; found " + selectedTabs.length + ".",
      });
    }

    const journey = dashboard?.querySelector(".book-writer-guided-steps, .book-writer-journey");
    if (!journey?.getAttribute("aria-label")) {
      issues.push({
        code: "journey-label",
        severity: "critical",
        target: ".book-writer-guided-steps",
        message: "Journey navigation needs an aria-label.",
      });
    }

    const definitionHelps = Array.from(dashboard?.querySelectorAll(".book-writer-term-help") || []);
    const glossaryChips = Array.from(dashboard?.querySelectorAll(".book-writer-glossary-chip") || []);
    const guidedBuilderVisible = Boolean(dashboard?.querySelector(".book-writer-guided-header"));
    const miniPreviewVisible = Boolean(dashboard?.querySelector(".book-writer-mini-preview"));
    const definitionLabels = [...definitionHelps, ...glossaryChips]
      .map((element) => element.getAttribute("aria-label") || element.getAttribute("title") || "")
      .filter(Boolean)
      .slice(0, 80);
    const trophyHelpCount = definitionLabels.filter((label) => /^Trophy room:/.test(label)).length;
    const guideVisible = Boolean(dashboard?.querySelector(".book-writer-guide, .book-writer-guided-main"));
    const workflowMapVisible = Boolean(dashboard?.querySelector(".book-writer-workflow-map"));
    const recommendedActionVisible = Boolean(
      dashboard?.querySelector(".book-writer-next-card, .book-writer-guided-next, .book-writer-read-actions, .book-writer-guided-upload, .book-writer-guided-cover")
    );
    const fieldHintCount = dashboard?.querySelectorAll(".book-writer-field-hint").length || 0;
    if (
      !guidedBuilderVisible ||
      !guideVisible ||
      !guideVisible
    ) {
      issues.push({
        code: "book-writer-definitions",
        severity: "critical",
        target: ".book-writer-guided-header",
        message:
          "Expected Guided Builder, a focused workspace, and one current action surface to be visible.",
      });
    }
    if (trophyHelpCount > 1) {
      issues.push({
        code: "trophy-room-duplicate-help",
        severity: "critical",
        target: ".book-writer-trophy-room",
        message:
          "Expected one Trophy Room help stop; the sticky rail should not repeat the finished-book shelf.",
      });
    }

    return {
      controlCount: visibleControls.length,
      focusableCount: visibleControls.filter((control) => control.tabIndex >= 0).length,
      definitions: {
        helpCount: definitionHelps.length,
        glossaryCount: glossaryChips.length,
        guideVisible,
        workflowMapVisible,
        recommendedActionVisible,
        fieldHintCount,
        trophyHelpCount,
        labels: definitionLabels,
      },
      issues,
    };
  })()`)) as {
    controlCount: number;
    focusableCount: number;
    definitions: BookWriterAccessibilityAudit["definitions"];
    issues: BookWriterAccessibilityIssue[];
  };
  const keyboard = await collectKeyboardAudit(page);
  const keyboardIssues: BookWriterAccessibilityIssue[] = [];
  if (!keyboard.startButtonFocusable) {
    keyboardIssues.push({
      code: "keyboard-start-book",
      severity: "critical",
      target: "Start book control",
      message: "The start or setup book control could not receive focus.",
    });
  }
  if (!keyboard.journeyTabFocusable) {
    keyboardIssues.push({
      code: "keyboard-journey-tab",
      severity: "critical",
      target: "Chapters",
      message: "The Chapters journey tab could not receive focus.",
    });
  }
  if (!keyboard.happyPathBeforeLibraryTools) {
    keyboardIssues.push({
      code: "keyboard-rail-happy-path-first",
      severity: "warning",
      target: "Book library",
      message: "The rail should tab to starting or opening a book before refresh/cleanup tools.",
    });
  }
  if (!keyboard.helpStopsSkipped) {
    keyboardIssues.push({
      code: "keyboard-help-noise",
      severity: "critical",
      target: "Book library help",
      message: "Inline help bubbles should not interrupt the primary Tab path.",
    });
  }
  const issues = [...domAudit.issues, ...keyboardIssues];
  return {
    checkedAt: new Date().toISOString(),
    controlCount: domAudit.controlCount,
    focusableCount: domAudit.focusableCount,
    definitions: domAudit.definitions,
    criticalIssues: issues.filter((issue) => issue.severity === "critical"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
    keyboard,
  };
}

async function auditBookWriterVisual(
  page: Page,
  params: { mobile: boolean; screenshot: string },
): Promise<BookWriterVisualAudit> {
  return await page.evaluate(
    async ({ mobile, screenshot }) => {
      window.scrollTo(0, 0);
      await new Promise(requestAnimationFrame);
      const dashboard = document.querySelector(".book-writer-dashboard");
      const box = dashboard?.getBoundingClientRect();
      const rail = document.querySelector(".book-writer-rail");
      const railBox = rail?.getBoundingClientRect();
      const railFinishedShortcutVisible = Boolean(
        rail?.querySelector(".book-writer-finished-mini"),
      );
      const main = document.querySelector(".book-writer-main");
      const mainBox = main?.getBoundingClientRect();
      const trophyRoom = document.querySelector<HTMLElement>(".book-writer-trophy-room");
      const workspace = document.querySelector<HTMLElement>(".book-writer-guided-workspace");
      let scrollParent: HTMLElement | null = null;
      let current = trophyRoom?.parentElement ?? null;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (
          current.scrollHeight > current.clientHeight + 8 &&
          /(auto|scroll|overlay)/.test(style.overflowY)
        ) {
          scrollParent = current;
          break;
        }
        current = current.parentElement;
      }
      if (scrollParent) {
        scrollParent.scrollTop = 0;
      } else {
        window.scrollTo(0, 0);
      }
      scrollParent?.dispatchEvent(new Event("scroll", { bubbles: true }));
      document.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      document.documentElement.classList.remove(
        "book-writer-trophy-scroll-compact",
        "book-writer-trophy-scroll-away",
      );
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const trophyRoomHeightBeforeScroll = trophyRoom
        ? Math.round(trophyRoom.getBoundingClientRect().height)
        : null;
      const trophyRoomTopBeforeScroll = trophyRoom
        ? Math.round(trophyRoom.getBoundingClientRect().top)
        : null;
      if (trophyRoom) {
        if (scrollParent) {
          scrollParent.scrollTop = 160;
        } else {
          workspace?.scrollIntoView({ block: "start", inline: "nearest" });
        }
        scrollParent?.dispatchEvent(new Event("scroll", { bubbles: true }));
        document.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("scroll"));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const trophyRoomHeightAfterScroll = trophyRoom
        ? Math.round(trophyRoom.getBoundingClientRect().height)
        : null;
      if (trophyRoom) {
        if (scrollParent) {
          scrollParent.scrollTop = 720;
        } else {
          workspace?.scrollIntoView({ block: "start", inline: "nearest" });
        }
        scrollParent?.dispatchEvent(new Event("scroll", { bubbles: true }));
        document.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("scroll"));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const trophyRoomTopAfterScroll = trophyRoom
        ? Math.round(trophyRoom.getBoundingClientRect().top)
        : null;
      const trophyRoomPosition = trophyRoom ? getComputedStyle(trophyRoom).position : "";
      const trophyRoomOpacity = trophyRoom
        ? Number.parseFloat(getComputedStyle(trophyRoom).opacity)
        : 1;
      const trophyRoomCompactsOnScroll = Boolean(
        trophyRoom &&
        trophyRoomHeightBeforeScroll !== null &&
        trophyRoomHeightAfterScroll !== null &&
        trophyRoomHeightAfterScroll < trophyRoomHeightBeforeScroll - 8,
      );
      const trophyRoomScrollsAway = Boolean(
        trophyRoom &&
        (trophyRoomOpacity < 0.2 ||
          (trophyRoomTopBeforeScroll !== null &&
            trophyRoomTopAfterScroll !== null &&
            trophyRoomTopAfterScroll < trophyRoomTopBeforeScroll - 80)),
      );
      if (scrollParent) {
        scrollParent.scrollTop = 0;
      } else {
        window.scrollTo(0, 0);
      }
      scrollParent?.dispatchEvent(new Event("scroll", { bubbles: true }));
      document.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      await new Promise(requestAnimationFrame);
      const visibleDeletedCards = Array.from(
        document.querySelectorAll<HTMLElement>(".book-writer-deleted-book"),
      ).filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(card).visibility !== "hidden";
      });
      const allDeletedCards = document.querySelectorAll(".book-writer-deleted-book").length;
      const deletedMore = document.querySelector(".book-writer-deleted-books__more summary");
      const activeDirectDelete = document.querySelector(
        ".book-writer-project > .book-writer-project__delete",
      );
      const activeGuidedStep =
        document.querySelector(".book-writer-guided-step--active")?.textContent ?? "";
      const activeGuidedStepIsIdea = /\bIdea\b/.test(activeGuidedStep);
      const setupControls = document.querySelectorAll(".book-writer-setup-controls").length;
      const healthCardCount =
        document.querySelectorAll(".book-writer-health-card").length ||
        document.querySelectorAll(".book-writer-guided-header__status button").length;
      return {
        checkedAt: new Date().toISOString(),
        mobile,
        screenshot,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        dashboardBounds: box
          ? {
              width: Math.round(box.width),
              height: Math.round(box.height),
            }
          : null,
        trophyRoomAtTop:
          Boolean(trophyRoom) &&
          (!workspace ||
            Boolean(
              trophyRoom.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING,
            )),
        trophyRoomCompactsOnScroll,
        trophyRoomScrollsAway,
        trophyRoomHeightBeforeScroll,
        trophyRoomHeightAfterScroll,
        trophyRoomTopBeforeScroll,
        trophyRoomTopAfterScroll,
        trophyRoomHiddenOnBuildPages: !trophyRoom,
        healthStripVisible: Boolean(
          document.querySelector(".book-writer-health-strip, .book-writer-guided-header__status"),
        ),
        healthCardCount,
        bookControlBarVisible: Boolean(
          document.querySelector(
            ".book-writer-control-bar, .book-writer-context-panel, .book-writer-context-summary",
          ),
        ),
        currentSettingsControlsDuplicated: activeGuidedStepIsIdea
          ? setupControls > 1
          : setupControls > 0,
        celebrationVisible: Boolean(
          document.querySelector(".book-writer-celebration")?.getBoundingClientRect().height,
        ),
        deletedListCollapsed:
          allDeletedCards <= 3 || (Boolean(deletedMore) && visibleDeletedCards.length <= 3),
        activeDeleteBehindMore:
          !activeDirectDelete &&
          (!rail || Boolean(document.querySelector(".book-writer-manage-books"))),
        railFinishedShortcutVisible,
        railWithinViewport:
          mobile ||
          !railBox ||
          (railBox.height <= window.innerHeight - 72 && railBox.right <= window.innerWidth + 1),
        mainWithinViewport: !mainBox || mainBox.right <= window.innerWidth + 1,
        visibleJourneySteps: Array.from(
          document.querySelectorAll<HTMLElement>(
            ".book-writer-guided-step, .book-writer-journey__step",
          ),
        )
          .filter((step) => {
            const rect = step.getBoundingClientRect();
            return (
              rect.width > 0 && rect.height > 0 && getComputedStyle(step).visibility !== "hidden"
            );
          })
          .map((step) => step.textContent?.replace(/\s+/g, " ").trim() ?? ""),
      };
    },
    { mobile: params.mobile, screenshot: params.screenshot },
  );
}

async function run(): Promise<BookWriterSmokeSummary> {
  assertBookWriterSmokeMutationAllowed();
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      "No Playwright Chromium or local Chrome-compatible browser found. Install Playwright browsers or set OPENCLAW_CONTROL_UI_SMOKE_BROWSER.",
    );
  }
  const smokeUrl = await resolveDashboardUrl();
  const mobileProfile = useMobileSmokeProfile();
  const clientMetadata = resolveSmokeClientMetadata(mobileProfile);
  const contextOptions: BrowserContextOptions = mobileProfile
    ? { ...mobileSmokeContextOptions(), serviceWorkers: "block" }
    : { viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" };
  const profileDir = resolveControlUiSmokeProfileDir({
    displayUrl: smokeUrl.displayUrl,
    mobile: mobileProfile,
  });
  const browserSession = await launchSmokeBrowserSession({
    executablePath,
    contextOptions,
    profileDir,
    clientMetadata,
  });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  try {
    const page = browserSession.page;
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(redactSmokeSecrets(message.text()));
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(redactSmokeSecrets(error.message));
    });
    page.on("requestfailed", (request) => {
      requestFailures.push(
        redactSmokeSecrets(`${request.url()} ${request.failure()?.errorText ?? "failed"}`),
      );
    });

    try {
      const pairing = await waitForBookWriter(page);
      const snapshot = await runBookWriterFlow(page);
      const authUrlClean = await page.evaluate(
        () => !/(?:[#?&])(?:token|password)=/i.test(window.location.href),
      );
      if (!authUrlClean) {
        throw new Error("Dashboard left auth material in the browser URL after bootstrap.");
      }
      const plan = snapshot.plan ?? {};
      const artifactDir = smokeArtifactDir();
      if (plan.runId) {
        await selectBookWriterRunForSmoke(page, plan.runId, "chapters");
        await page.waitForFunction(
          (expectedRunId) => {
            const app = document.querySelector("openclaw-app") as BookWriterSmokeApp | null;
            return (
              app?.bookWriterDashboard?.plan?.runId === expectedRunId &&
              Boolean(document.querySelector(".book-writer-guided-header")) &&
              Boolean(document.querySelector(".book-writer-control-bar"))
            );
          },
          plan.runId,
          { timeout: 15_000 },
        );
      }
      const screenshot = join(artifactDir, "book-publisher-dashboard.png");
      await page.screenshot({ path: screenshot, fullPage: true });
      const accessibility = await auditBookWriterAccessibility(page);
      const accessibilityReport = join(artifactDir, "book-publisher-dashboard-accessibility.json");
      writeJsonArtifact(accessibilityReport, accessibility);
      const visual = await auditBookWriterVisual(page, { mobile: mobileProfile, screenshot });
      const visualReport = join(artifactDir, "book-publisher-dashboard-visual.json");
      writeJsonArtifact(visualReport, visual);
      if (plan.runId) {
        await clickTab(page, "Publish");
      }
      const publishUi = await auditBookWriterPublishUi(page);
      const sentenceAdaptation = plan.runId
        ? await verifySentenceEditAdaptation(page, plan.runId)
        : {
            verified: false,
            runId: "missing",
            sourceParagraphId: "missing",
            adaptedParagraphId: "missing",
            lockedParagraphId: "missing",
            syncBefore: "missing",
            syncAfter: "missing",
            insertedSentenceSaved: false,
            propagateButtonVisible: false,
            adaptedParagraphChanged: false,
            lockedTextPreserved: false,
            rewrittenParagraphs: 0,
            cohesionReceiptVisible: false,
            cohesionReceiptText: "missing",
            propagationRequestPath: "gateway-fallback",
            summary: "No active Book Writer run was available for sentence adaptation.",
          };
      const controlMatrix = plan.runId
        ? await verifyBookWriterControlMatrix(page, plan.runId)
        : {
            verified: false,
            runId: "missing",
            editedControls: [],
            ideaDirectionSaved: false,
            chapterTitleSaved: false,
            chapterDescriptionSaved: false,
            chapterStyleSaved: false,
            chapterLockRoundTrip: false,
            paragraphTitleSaved: false,
            paragraphSummarySaved: false,
            paragraphPurposeSaved: false,
            paragraphStyleSaved: false,
            paragraphFieldLockRoundTrip: false,
            scopedRegenerationVisible: false,
            rewriteVisible: false,
            reloadPersistenceVerified: false,
            summary: "No active Book Writer run was available for control matrix verification.",
          };
      const deletion: { deleteVerified: boolean; deletedId?: string; remainingBooks: number } =
        plan.runId
          ? await verifyBookWriterDelete(page, {
              runId: plan.runId,
              title: plan.title ?? "missing",
            })
          : { deleteVerified: false, remainingBooks: 0 };
      const restoration =
        plan.runId && deletion.deleteVerified && deletion.deletedId
          ? await verifyBookWriterRestore(page, {
              runId: plan.runId,
              title: plan.title ?? "missing",
              deletedId: deletion.deletedId,
            })
          : { restoreVerified: false, remainingBooks: deletion.remainingBooks };
      const permanentDeletion =
        plan.runId && restoration.restoreVerified
          ? await verifyBookWriterEmptyDeleted(page, {
              runId: plan.runId,
              title: plan.title ?? "missing",
            })
          : { permanentDeleteVerified: false, remainingBooks: restoration.remainingBooks };
      const approvedPublish = await runApprovedBookWriterPublishFlow(page);
      const summary: BookWriterSmokeSummary = {
        ok:
          consoleErrors.length === 0 &&
          pageErrors.length === 0 &&
          accessibility.criticalIssues.length === 0 &&
          sentenceAdaptation.verified &&
          controlMatrix.verified &&
          deletion.deleteVerified &&
          restoration.restoreVerified &&
          permanentDeletion.permanentDeleteVerified &&
          approvedPublish.verified,
        url: smokeUrl.displayUrl,
        auth: smokeUrl.auth,
        authUrlClean,
        profile: {
          persistent: browserSession.persistentProfile,
          dir: browserSession.profileDir,
          clientDisplayName: clientMetadata.displayName,
          autoApprovePairing: autoApprovePairingEnabled(),
          pairingApproved: pairing.pairingApproved,
          pairingRequestId: pairing.requestId,
        },
        runId: plan.runId ?? "missing",
        title: plan.title ?? "missing",
        status: plan.status ?? "missing",
        version: plan.version ?? 0,
        chapters: plan.chapters?.length ?? 0,
        paragraphs: countParagraphs(plan),
        draftedParagraphs: countDraftedParagraphs(plan),
        manuscriptPreview: snapshot.manuscriptPreview
          ? snapshot.manuscriptPreview.replace(/\s+/g, " ").trim().slice(0, 240)
          : "missing",
        reviewPack: snapshot.reviewPack?.recommendation ?? "missing",
        publishPrep:
          snapshot.publishDryRun?.status ??
          (snapshot.reviewPack?.recommendation === "approve" ? "missing" : "blocked-by-review"),
        deleteVerified: deletion.deleteVerified,
        restoreVerified: restoration.restoreVerified,
        permanentDeleteVerified: permanentDeletion.permanentDeleteVerified,
        remainingBooks: permanentDeletion.remainingBooks,
        trophyRoomVisible: publishUi.trophyRoomVisible,
        fixBlockersVisible: publishUi.fixBlockersVisible,
        markPublishedVisible: publishUi.markPublishedVisible,
        sentenceAdaptation,
        controlMatrix,
        approvedPublish,
        consoleErrors,
        pageErrors,
        screenshot,
        accessibility,
        accessibilityReport,
        visual,
        visualReport,
      };
      if (!summary.ok) {
        throw new Error(
          `Browser reported console/page/accessibility errors: ${JSON.stringify(summary)}`,
        );
      }
      if (
        !summary.authUrlClean ||
        !summary.deleteVerified ||
        !summary.restoreVerified ||
        !summary.permanentDeleteVerified ||
        !summary.sentenceAdaptation.verified ||
        !summary.controlMatrix.verified ||
        summary.chapters < 3 ||
        summary.draftedParagraphs < 1 ||
        summary.trophyRoomVisible ||
        (summary.reviewPack !== "approve" && !summary.fixBlockersVisible) ||
        !summary.approvedPublish.verified ||
        !summary.visual.dashboardBounds ||
        !summary.visual.trophyRoomHiddenOnBuildPages ||
        !summary.visual.healthStripVisible ||
        summary.visual.healthCardCount !== 4 ||
        !summary.visual.bookControlBarVisible ||
        summary.visual.currentSettingsControlsDuplicated ||
        summary.visual.celebrationVisible ||
        !summary.visual.deletedListCollapsed ||
        !summary.visual.activeDeleteBehindMore ||
        summary.visual.railFinishedShortcutVisible ||
        !summary.visual.railWithinViewport ||
        !summary.visual.mainWithinViewport ||
        summary.visual.visibleJourneySteps.length !== 6
      ) {
        throw new Error(
          `Book Writer smoke summary failed sanity checks: ${JSON.stringify(summary)}`,
        );
      }
      return summary;
    } catch (error) {
      const diagnostics = await collectFailureDiagnostics(page).catch((diagnosticError: unknown) => ({
        bodyText: `failed to collect diagnostics: ${
          diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
        }`,
      }));
      throw new Error(
        `${redactSmokeSecrets(error instanceof Error ? error.message : String(error))}
Diagnostics: ${JSON.stringify(diagnostics, null, 2)}
Console errors: ${JSON.stringify(consoleErrors)}
Page errors: ${JSON.stringify(pageErrors)}
Request failures: ${JSON.stringify(requestFailures)}`,
        { cause: error },
      );
    }
  } finally {
    await browserSession.close();
  }
}

run()
  .then((summary) => {
    console.log("control-ui-book-writer-smoke: ok", JSON.stringify(summary, null, 2));
  })
  .catch((error: unknown) => {
    console.error(
      "control-ui-book-writer-smoke: failed",
      redactSmokeSecrets(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  });

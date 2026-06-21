import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import {
  displayControlUiSmokeUrl,
  redactControlUiSmokeSecrets,
  resolveControlUiSmokeUrl,
} from "./control-ui-smoke-url.ts";
import { controlUiSmokeViteResolve } from "./control-ui-smoke-vite.ts";

type PageCheck = {
  label: string;
  ok: boolean;
  path: string;
  requiredText: string[];
  selectorCounts: Record<string, number>;
  textPreview: string;
};

type SmokeSummary = {
  artifactDir: string;
  displayUrl: string;
  mode: "harness" | "live";
  ok: true;
  pageChecks: PageCheck[];
  screenshots: string[];
};

type StaticServer = {
  close: () => Promise<void>;
  url: string;
};

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function liveSmokeRequested(): boolean {
  return (
    process.env.OPENCLAW_CONTROL_UI_SMOKE_LIVE === "1" ||
    Boolean(process.env.OPENCLAW_CONTROL_UI_SMOKE_URL?.trim()) ||
    Boolean(process.env.OPENCLAW_CONTROL_UI_TAILNET_URL?.trim())
  );
}

function pathUrl(launchUrl: string, path: string): string {
  const url = new URL(launchUrl);
  url.pathname = path;
  return url.toString();
}

async function checkLivePage(input: {
  launchUrl: string;
  label: string;
  page: Page;
  path: string;
  requiredText: string[];
  screenshotPath: string;
  selectors: string[];
}): Promise<PageCheck> {
  const { launchUrl, label, page, path, requiredText, screenshotPath, selectors } = input;
  await page.goto(pathUrl(launchUrl, path), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const title = await page.title();
  const appPresent = (await page.locator("openclaw-app, #root").count()) > 0;
  const authScreen = (await page.getByText("Auth required").count()) > 0;
  const fallback = (await page.getByText("Control UI did not start").count()) > 0;
  const selectorCounts = Object.fromEntries(
    await Promise.all(
      selectors.map(async (selector) => [selector, await page.locator(selector).count()] as const),
    ),
  );
  const requiredTextMatches = await Promise.all(
    requiredText.map(
      async (expected) => [expected, await page.getByText(expected).count()] as const,
    ),
  );
  const textPreview =
    (await page
      .locator("body")
      .textContent()
      .catch(() => "")) ?? "";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const textOk = requiredTextMatches.every(([, count]) => count > 0);
  const selectorOk = selectors.every((selector) => selectorCounts[selector] > 0);
  const ok =
    title === "OpenClaw Control" && appPresent && !fallback && !authScreen && textOk && selectorOk;
  return {
    label,
    ok,
    path,
    requiredText,
    selectorCounts,
    textPreview: textPreview.slice(0, 1_000),
  };
}

function writeHarnessApp(appDir: string) {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw Dashboard Codex Plus Apps Smoke</title>
  </head>
  <body>
    <main id="root"></main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`,
  );
  writeFileSync(
    join(appDir, "main.ts"),
    `import "/ui/src/styles.css";
import { render } from "lit";
import { renderChat } from "/ui/src/ui/views/chat.ts";
import { renderAppStudioDashboard } from "/ui/src/ui/views/app-studio-dashboard.ts";
import { renderBookWriterDashboard } from "/ui/src/ui/views/book-writer-dashboard.ts";
import { renderKalshiDashboard } from "/ui/src/ui/views/kalshi-dashboard.ts";
import { renderMusicStudio } from "/ui/src/ui/views/music-studio.ts";
import { renderPatternLabDashboard } from "/ui/src/ui/views/pattern-lab-dashboard.ts";
import { renderSnesStudio } from "/ui/src/ui/views/snes-studio.ts";

type Check = {
  label: string;
  ok: boolean;
  path: string;
  requiredText: string[];
  selectorCounts: Record<string, number>;
  textPreview: string;
};

type SmokeResult = { checks: Check[]; ok: boolean };

declare global {
  interface Window {
    runOpenClawDashboardCodexPlusAppsSmoke: () => Promise<SmokeResult>;
  }
}

const root = document.getElementById("root")!;
const noop = () => undefined;

function chatProps() {
  return {
    sessionKey: "main",
    connected: true,
    canSend: true,
    disabledReason: null,
    loading: false,
    sending: false,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    draft: "Restore the dashboards",
    queue: [],
    sessions: { sessions: [{ key: "main", agentId: "main", title: "Control Director" }], defaults: {} },
    workTasks: [],
    goalFlows: [],
    assistantName: "Control Director",
    showThinking: false,
    showToolCalls: true,
    focusMode: false,
    compactionStatus: null,
    fallbackStatus: null,
    sideResult: null,
    realtimeTalkActive: false,
    realtimeTalkStatus: "idle",
    realtimeTalkDetail: null,
    realtimeTalkTranscript: null,
    assistantAvatarUrl: null,
    assistantAvatar: null,
    userName: null,
    userAvatar: null,
    localMediaPreviewRoots: [],
    assistantAttachmentAuthToken: null,
    attachments: [],
    showNewMessages: false,
    autoExpandToolCalls: false,
    onDraftChange: noop,
    onSend: noop,
    onAbort: noop,
    onRefresh: noop,
    onRequestUpdate: noop,
    onToggleFocusMode: noop,
    onAttachmentsChange: noop,
    onScrollToBottom: noop,
    getDraft: () => "Restore the dashboards",
    currentAgentId: "main",
    onAgentChange: noop,
    onNavigateToAgent: noop,
    onSessionKeyChange: noop,
    onSessionSelect: noop,
    onNewSession: noop,
    onClearHistory: noop,
    onOpenSessionCheckpoints: noop,
    onQueueRemove: noop,
    onQueueSteer: noop,
    onDismissSideResult: noop,
    basePath: "",
  } as Parameters<typeof renderChat>[0];
}

function appStudioProps() {
  return {
    loading: false,
    error: null,
    snapshot: null,
    lastFetchAt: null,
    selectedAppDir: null,
    promptDraft: "Build a simple app",
    createNameDraft: "Demo App",
    createAppIdDraft: "demo-app",
    createBundleIdDraft: "com.example.demo",
    savingAction: null,
    actionStartedAt: null,
    actionReceipt: null,
    appleFactsDraft: { category: "", businessModel: "", privacyNotes: "", distributionPlan: "" },
    buildEngineDraft: "codex",
    screenImageDrafts: [],
    screenImageNotesDraft: "",
    screenAnalysisDraft: "",
    flowDraft: { entryScreenId: "", fromScreenId: "", toScreenId: "", label: "", trigger: "" },
    onRefresh: noop,
    onSelectProject: noop,
    onPromptDraftChange: noop,
    onCreateNameDraftChange: noop,
    onCreateAppIdDraftChange: noop,
    onCreateBundleIdDraftChange: noop,
    onCreateProject: noop,
    onApplyPrompt: noop,
    onBuildEngineChange: noop,
    onRunGate: noop,
    onMoveScreen: noop,
    onScreenOrderChange: noop,
    onScreenImageFilesChange: noop,
    onScreenImageNotesChange: noop,
    onImportScreenImages: noop,
    onScreenAnalysisDraftChange: noop,
    onApplyScreenAnalysis: noop,
    onFlowDraftChange: noop,
    onAddScreenFlowEdge: noop,
    onRemoveScreenFlowEdge: noop,
    onAppleFactChange: noop,
    onImportAppleFacts: noop,
    onApproveGate: noop,
    onDismissReceipt: noop,
  } as Parameters<typeof renderAppStudioDashboard>[0];
}

function bookProps() {
  return {
    loading: false,
    error: null,
    snapshot: null,
    lastFetchAt: null,
    selectedRunId: null,
    topicDraft: "A helpful book",
    targetWordsDraft: 12000,
    toneDraft: "conversational",
    customToneDraft: "",
    profanityDraft: "none",
    penNameDraft: "",
    newBookSetupOpen: true,
    readPage: 1,
    readPreviewOpen: false,
    readPreviewMode: "paperback",
    activeView: "brief",
    mode: "guided",
    pendingAiAction: null,
    pendingAiSuggestion: null,
    pendingDestructiveAction: null,
    actionReceipt: null,
    celebration: null,
    focusedParagraphId: null,
    searchQuery: "",
    savingAction: null,
    canUndo: false,
    canRedo: false,
    onRefresh: noop,
    onSelectRun: noop,
    onTopicDraftChange: noop,
    onTargetWordsDraftChange: noop,
    onToneDraftChange: noop,
    onCustomToneDraftChange: noop,
    onProfanityDraftChange: noop,
    onPenNameDraftChange: noop,
    onOpenNewBookSetup: noop,
    onCloseNewBookSetup: noop,
    onCreatePlan: noop,
    onFixBook: noop,
    onSavePlan: noop,
    onDeleteRun: noop,
    onArchiveRun: noop,
    onCopyRun: noop,
    onRestoreArchivedRun: noop,
    onDeleteArchivedRun: noop,
    onRestoreDeletedRun: noop,
    onDeleteDeletedRun: noop,
    onEmptyDeletedRuns: noop,
    onFinishRun: noop,
    onRestoreFinishedRun: noop,
    onUpdatePublishedMetrics: noop,
    onBuildRecommendedBook: noop,
    onDraftPlan: noop,
    onFillParagraphPlans: noop,
    onGenerateIdeaSetup: noop,
    onGenerateChapterSetup: noop,
    onUpdatePenNameProfile: noop,
    onDraftParagraph: noop,
    onStitchPlan: noop,
    onPackagePlan: noop,
    onPreparePublish: noop,
    onPreparePublishWithCoverStrategy: noop,
    onGenerateCoverConcept: noop,
    onGenerateEditableCoverConcept: noop,
    onEditCoverWithLocalAi: noop,
    onApproveCover: noop,
    onUploadCoverFile: noop,
    onDisableAutomation: noop,
    onCreateQuickRead: noop,
    onShowHome: noop,
    onActiveViewChange: noop,
    onReadPageChange: noop,
    onReadPreviewOpenChange: noop,
    onReadPreviewModeChange: noop,
    onModeChange: noop,
    onFocusedParagraphChange: noop,
    onRequestAiHelp: noop,
    onRequestSetupAiHelp: noop,
    onCancelAiSuggestion: noop,
    onApplyAiSuggestion: noop,
    onRequestAiAction: noop,
    onCancelAiAction: noop,
    onConfirmAiAction: noop,
    onRequestDestructiveAction: noop,
    onCancelDestructiveAction: noop,
    onConfirmDestructiveAction: noop,
    onDismissReceipt: noop,
    onDismissCelebration: noop,
    onSearchQueryChange: noop,
    onUndo: noop,
    onRedo: noop,
  } as Parameters<typeof renderBookWriterDashboard>[0];
}

function kalshiProps() {
  return {
    loading: false,
    error: null,
    snapshot: null,
    lastFetchAt: null,
    timezone: "America/New_York",
    timeframe: "24h",
    pnlTimeframe: "all",
    strategySort: "problem_first",
    showDeepAudit: false,
    auditTablePages: {},
    auditTableQueries: {},
    onTimezoneChange: noop,
    onTimeframeChange: noop,
    onPnlTimeframeChange: noop,
    onStrategySortChange: noop,
    onToggleDeepAudit: noop,
    onAuditTablePageChange: noop,
    onAuditTableQueryChange: noop,
    onRefresh: noop,
  } as Parameters<typeof renderKalshiDashboard>[0];
}

function patternLabProps() {
  return {
    loading: false,
    error: null,
    snapshot: null,
    lastFetchAt: null,
    approvingAssetType: null,
    basePath: "",
    authToken: null,
    onRefresh: noop,
    onApproveAssetType: noop,
  } as Parameters<typeof renderPatternLabDashboard>[0];
}

function count(selector: string): number {
  return root.querySelectorAll(selector).length;
}

async function renderAndCheck(page: {
  label: string;
  path: string;
  template: unknown;
  requiredText: string[];
  selectors: string[];
}): Promise<Check> {
  history.replaceState(null, "", page.path);
  render(page.template, root);
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  const text = root.textContent ?? "";
  const selectorCounts = Object.fromEntries(page.selectors.map((selector) => [selector, count(selector)]));
  const ok =
    page.requiredText.every((expected) => text.includes(expected)) &&
    page.selectors.every((selector) => selectorCounts[selector] > 0);
  return {
    label: page.label,
    ok,
    path: page.path,
    requiredText: page.requiredText,
    selectorCounts,
    textPreview: text.slice(0, 1_000),
  };
}

window.runOpenClawDashboardCodexPlusAppsSmoke = async () => {
  const pages = [
    {
      label: "Codex Chat surfaces",
      path: "/chat",
      template: renderChat(chatProps()),
      requiredText: ["Working Now", "Pursue Goal", "Truth & Completion"],
      selectors: [".chat-work-surface", ".chat-goal", ".chat-control-director-diagnostics"],
    },
    { label: "App Studio", path: "/app-studio", template: renderAppStudioDashboard(appStudioProps()), requiredText: ["App Studio"], selectors: [".app-studio"] },
    { label: "Music Studio", path: "/music-studio", template: renderMusicStudio({}), requiredText: ["Music Studio"], selectors: [".music-studio"] },
    { label: "SNES Studio", path: "/snes-studio", template: renderSnesStudio({}), requiredText: ["SNES Studio"], selectors: [".snes-studio"] },
    { label: "Book Studio", path: "/book-writer", template: renderBookWriterDashboard(bookProps()), requiredText: ["Book Studio"], selectors: [".book-writer-dashboard"] },
    { label: "Kalshi", path: "/kalshi", template: renderKalshiDashboard(kalshiProps()), requiredText: ["Kalshi"], selectors: [".kalshi-page"] },
    { label: "Pattern Lab", path: "/pattern-lab", template: renderPatternLabDashboard(patternLabProps()), requiredText: ["Pattern Lab"], selectors: [".pattern-lab-dashboard"] },
  ];
  const checks = [];
  for (const page of pages) {
    checks.push(await renderAndCheck(page));
  }
  return { checks, ok: checks.every((check) => check.ok) };
};
`,
  );
}

async function startHarnessServer(appDir: string): Promise<StaticServer> {
  const server: ViteDevServer = await createServer({
    appType: "spa",
    configFile: false,
    define: { "process.env": "{}" },
    root: process.cwd(),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    resolve: controlUiSmokeViteResolve(process.cwd()),
    logLevel: "error",
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) {
    await server.close();
    throw new Error("Unable to determine dashboard smoke Vite server URL.");
  }
  const appPath = `${appDir.split(/[\\/]/).join("/")}/index.html`;
  return {
    close: () => server.close(),
    url: new URL(appPath, baseUrl).toString(),
  };
}

async function runHarnessSmoke(input: {
  artifactDir: string;
  browser: Browser;
}): Promise<SmokeSummary> {
  const appDir = join(input.artifactDir, "app");
  writeHarnessApp(appDir);
  const server = await startHarnessServer(appDir);
  const page = await input.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const screenshot = join(input.artifactDir, "dashboard-codex-plus-apps-harness.png");
  try {
    await page.goto(server.url, { waitUntil: "networkidle", timeout: 30_000 });
    const result = await page.evaluate(async () => {
      return await window.runOpenClawDashboardCodexPlusAppsSmoke();
    });
    await page.screenshot({ path: screenshot, fullPage: true });
    if (!result.ok) {
      console.error(
        JSON.stringify(
          { artifactDir: input.artifactDir, failed: result.checks.filter((check) => !check.ok) },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    return {
      artifactDir: input.artifactDir,
      displayUrl: server.url,
      mode: "harness",
      ok: true,
      pageChecks: result.checks,
      screenshots: [screenshot],
    };
  } finally {
    await page.close();
    await server.close();
  }
}

async function runLiveSmoke(input: {
  artifactDir: string;
  browser: Browser;
}): Promise<SmokeSummary> {
  const smokeUrl = await resolveControlUiSmokeUrl({
    explicitUrlEnvNames: ["OPENCLAW_CONTROL_UI_SMOKE_URL"],
  });
  const page = await input.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const screenshots: string[] = [];
  const checks: PageCheck[] = [];
  try {
    const chatScreenshot = join(input.artifactDir, "chat-codex-surfaces.png");
    screenshots.push(chatScreenshot);
    checks.push(
      await checkLivePage({
        launchUrl: smokeUrl.launchUrl,
        label: "Codex Chat surfaces",
        page,
        path: "/chat",
        requiredText: ["Working Now", "Pursue Goal", "Truth & Completion"],
        screenshotPath: chatScreenshot,
        selectors: [".chat-work-surface", ".chat-goal", ".chat-control-director-diagnostics"],
      }),
    );

    for (const dashboard of [
      { label: "App Studio", path: "/app-studio", selector: ".app-studio" },
      { label: "Music Studio", path: "/music-studio", selector: ".music-studio" },
      { label: "SNES Studio", path: "/snes-studio", selector: ".snes-studio" },
      { label: "Book Studio", path: "/book-writer", selector: ".book-writer-dashboard" },
      { label: "Kalshi", path: "/kalshi", selector: ".kalshi-page" },
      { label: "Pattern Lab", path: "/pattern-lab", selector: ".pattern-lab-dashboard" },
    ]) {
      const shot = join(
        input.artifactDir,
        `${dashboard.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      );
      screenshots.push(shot);
      checks.push(
        await checkLivePage({
          launchUrl: smokeUrl.launchUrl,
          label: dashboard.label,
          page,
          path: dashboard.path,
          requiredText: [dashboard.label],
          screenshotPath: shot,
          selectors: [dashboard.selector],
        }),
      );
    }
  } finally {
    await page.close();
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(
      redactControlUiSmokeSecrets(
        JSON.stringify({ artifactDir: input.artifactDir, failed, screenshots }, null, 2),
      ),
    );
    process.exit(1);
  }
  return {
    artifactDir: input.artifactDir,
    displayUrl: displayControlUiSmokeUrl(smokeUrl.displayUrl),
    mode: "live",
    ok: true,
    pageChecks: checks,
    screenshots,
  };
}

async function main() {
  const artifactDir = join(
    ".artifacts",
    "control-ui-dashboard-codex-plus-apps-smoke",
    timestampSlug(),
  );
  mkdirSync(artifactDir, { recursive: true });
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("No Chromium-compatible browser executable found for dashboard smoke.");
  }
  const browser: Browser = await chromium.launch({ executablePath, headless: true });
  try {
    const summary = liveSmokeRequested()
      ? await runLiveSmoke({ artifactDir, browser })
      : await runHarnessSmoke({ artifactDir, browser });
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(redactControlUiSmokeSecrets(JSON.stringify(summary, null, 2)));
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    redactControlUiSmokeSecrets(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
  );
  process.exit(1);
});

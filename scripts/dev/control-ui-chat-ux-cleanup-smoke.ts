import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import {
  controlUiChatSmokeOptimizeDeps,
  controlUiSmokeViteResolve,
} from "./control-ui-smoke-vite.ts";

type Mode = "mobile" | "mobile-large" | "mobile-landscape" | "macbook" | "desktop";
type Result = { mode: Mode; ok: boolean; checks: Record<string, boolean>; bodyText: string };

const MODE_VIEWPORTS: Record<Mode, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  "mobile-large": { width: 430, height: 932 },
  "mobile-landscape": { width: 844, height: 390 },
  macbook: { width: 1366, height: 768 },
  desktop: { width: 1440, height: 900 },
};

type Summary = {
  artifactDir: string;
  modeResults: Result[];
  ok: true;
  screenshots: string[];
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
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
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

function writeSmokeApp(appDir: string) {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>OpenClaw Chat UX Cleanup Smoke</title><style>html,body,#root{height:100%;margin:0;overflow:hidden}#root{display:flex;min-height:0}</style></head><body><main id="root"></main><script type="module" src="./main.ts"></script></body></html>`,
  );
  writeFileSync(
    join(appDir, "main.ts"),
    `import "/ui/src/styles.css";
import { render } from "lit";
import { renderChat } from "/ui/src/ui/views/chat.ts";

const root = document.getElementById("root")!;
let draft = "";
let retryDraft = "";
let stopCalls = 0;

const sessions = {
  count: 1,
  defaults: { contextTokens: null, model: null, modelProvider: null },
  path: "",
  sessions: [
    {
      key: "agent:main:main",
      kind: "direct",
      updatedAt: 100,
      displayName: "Main Control Director chat",
      controlDirectorTruthAudit: [
        {
          ts: 10,
          runId: "run-1",
          status: "blocked",
          missing: ["command exit code 0"],
          payloadsChecked: 1,
          payloadsRewritten: 1,
          claims: [
            {
              claim: "tests passed",
              claimHash: "hash-1",
              claimType: "verification",
              requiredEvidenceType: "command",
              matchStatus: "missing",
              missingCondition: "missing command evidence with exit code 0",
              rewriteAction: "blocked_unsupported_truth_claim",
            },
          ],
        },
      ],
      controlDirectorMissionLedger: [
        {
          missionId: "mission-1",
          runId: "run-1",
          requestSummary: "redo game",
          status: "blocked",
          startedAt: 1,
          updatedAt: 10,
          continuationCount: 0,
          finalStatus: "blocked",
          nextBuildGap: "retry with a healthy fallback model",
          completionGrade: 7,
          criticality: 10,
        },
      ],
    },
  ],
  ts: 0,
};

function baseProps(mode, overrides = {}) {
  const mobile = mode.startsWith("mobile");
  return {
    sessionKey: "agent:main:main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    sending: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [
      {
        role: "assistant",
        content: "This conversation stays visible while blocked diagnostics remain available on demand.",
        timestamp: 1,
      },
    ],
    sideResult: null,
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft,
    queue: [],
    currentRunId: "run-1",
    realtimeTalkActive: false,
    realtimeTalkStatus: "idle",
    realtimeTalkDetail: null,
    realtimeTalkTranscript: null,
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions,
    focusMode: false,
    sidebarOpen: false,
    sidebarContent: null,
    sidebarError: null,
    splitRatio: 0.6,
    canvasPluginSurfaceUrl: null,
    embedSandboxMode: "scripts",
    allowExternalEmbedUrls: false,
    assistantName: "Todd Stanski",
    assistantAvatar: null,
    userName: null,
    userAvatar: null,
    localMediaPreviewRoots: [],
    assistantAttachmentAuthToken: null,
    autoExpandToolCalls: false,
    attachments: [],
    onAttachmentsChange: () => undefined,
    showNewMessages: false,
    onScrollToBottom: () => undefined,
    onRefresh: () => undefined,
    getDraft: () => draft,
    onDraftChange: (next) => { draft = next; },
    onRequestUpdate: () => undefined,
    onSend: () => undefined,
    onCompact: () => undefined,
    onToggleRealtimeTalk: () => undefined,
    onDismissError: () => undefined,
    onAbort: () => undefined,
    onQueueRemove: () => undefined,
    onQueueSteer: () => undefined,
    onDismissSideResult: () => undefined,
    onNewSession: () => undefined,
    onClearHistory: () => undefined,
    onOpenSessionCheckpoints: () => undefined,
    agentsList: null,
    currentAgentId: "main",
    onAgentChange: () => undefined,
    onNavigateToAgent: () => undefined,
    onSessionSelect: () => undefined,
    onOpenSidebar: () => undefined,
    onCloseSidebar: () => undefined,
    onSplitRatioChange: () => undefined,
    onChatScroll: () => undefined,
    basePath: "",
    goalPanelOpen: false,
    goalAction: { flowId: "flow-1", action: "stop" },
    goalFlows: [
      {
        id: "flow-1",
        flowId: "flow-1",
        status: "running",
        goal: "Make Chat work like Codex",
        currentStep: "Stopping goal.",
      },
    ],
    onGoalPanelToggle: () => undefined,
    onGoalDraftChange: () => undefined,
    onGoalStart: () => undefined,
    onGoalContinue: () => undefined,
    onGoalControl: (_flowId, action) => { if (action === "stop") stopCalls += 1; },
    onGoalRefresh: () => undefined,
    onBlockedRetryDraft: (prompt) => { retryDraft = prompt; draft = prompt; },
    sessionWorkspace: mobile ? undefined : {
      collapsed: false,
      sessionKey: "agent:main:main",
      list: {
        sessionKey: "agent:main:main",
        root: "/Users/openclaw/.openclaw/workspace",
        files: [
          { kind: "read", path: "todd-world/src/game.js", name: "game.js", size: 12100 },
          { kind: "read", path: "todd-world/src/level.js", name: "level.js", size: 426 },
        ],
        artifacts: [],
        browser: { path: "", parentPath: null, search: "", entries: [
          { kind: "directory", path: "todd-world", name: "todd-world" },
          { kind: "file", path: "AGENTS.md", name: "AGENTS.md", size: 4000, sessionKind: "read" },
        ]},
      },
      loading: false,
      error: null,
      activeId: null,
      onToggleCollapsed: () => undefined,
      onRefresh: () => undefined,
      onBrowsePath: () => undefined,
      onCopyPath: () => undefined,
      onOpenFile: () => undefined,
      onSearch: () => undefined,
      onOpenArtifact: () => undefined,
    },
    ...overrides,
  };
}

window.runOpenClawChatUxCleanupSmoke = async (mode) => {
  stopCalls = 0;
  retryDraft = "";
  render(renderChat(baseProps(mode)), root);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const diagnostics = root.querySelector("[data-control-director-diagnostics]");
  const diagnosticSummary = diagnostics?.querySelector(
    ".chat-control-director-diagnostics__summary",
  );
  const thread = root.querySelector(".chat-thread");
  const message = root.querySelector(".chat-group");
  const composer = root.querySelector(".agent-chat__input");
  const rect = (element) => element?.getBoundingClientRect();
  const diagnosticsRect = rect(diagnostics);
  const diagnosticsInConversation = Boolean(diagnostics?.closest(".chat-thread-inner"));
  const threadRect = rect(thread);
  const messageRect = rect(message);
  const composerRect = rect(composer);
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const minThreadHeight = viewportHeight < 500 ? 72 : Math.max(160, viewportHeight * 0.24);

  diagnosticSummary?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const diagnosticPanel = root.querySelector(".chat-control-director-diagnostics__panel");
  const diagnosticClose = root.querySelector(
    '[aria-label="Close truth and completion details"]',
  );
  diagnosticClose?.click();
  const diagnosticsClosedWithButton =
    diagnostics instanceof HTMLDetailsElement && !diagnostics.open;
  const diagnosticsButtonFocusRestored = document.activeElement === diagnosticSummary;

  diagnosticSummary?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const retry = root.querySelector("[data-chat-blocked-retry]");
  retry?.click();
  retry?.focus();
  retry?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  const diagnosticsClosedWithEscape =
    diagnostics instanceof HTMLDetailsElement && !diagnostics.open;
  const diagnosticsFocusRestored = document.activeElement === diagnosticSummary;

  const emptySessions = {
    ...sessions,
    sessions: [
      {
        key: "agent:main:main",
        kind: "direct",
        updatedAt: 100,
        displayName: "Main Control Director chat",
      },
    ],
  };
  render(renderChat(baseProps(mode, { sessions: emptySessions })), root);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const emptyDiagnosticsHidden = !root.querySelector("[data-control-director-diagnostics]");

  render(renderChat(baseProps(mode, { goalPanelOpen: true })), root);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const cancel = root.querySelector('[data-chat-goal-action="cancel"]');
  cancel?.click();
  const stoppingGoalVisible = (document.body.textContent || "").includes("Stopping…");
  const stopDedupedByDisabledButton =
    cancel instanceof HTMLButtonElement && cancel.disabled && stopCalls === 0;

  render(renderChat(baseProps(mode)), root);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const text = document.body.textContent || "";
  const checks = {
    diagnosticsInConversation,
    diagnosticsCollapsedHeight: Boolean(diagnosticsRect && diagnosticsRect.height <= 56.5),
    diagnosticsPanelAvailable: Boolean(diagnosticPanel),
    diagnosticsClosedWithButton,
    diagnosticsButtonFocusRestored,
    diagnosticsClosedWithEscape,
    diagnosticsFocusRestored,
    emptyDiagnosticsHidden,
    retryDraftInserted: retryDraft.includes("Retry the preserved original request safely"),
    stoppingGoalVisible,
    stopDedupedByDisabledButton,
    transcriptHasRoom: Boolean(threadRect && threadRect.height >= minThreadHeight),
    conversationVisible: Boolean(
      threadRect &&
        messageRect &&
        messageRect.bottom > threadRect.top &&
        messageRect.top < threadRect.bottom,
    ),
    composerInsideViewport: Boolean(
      composerRect && composerRect.top >= 0 && composerRect.bottom <= viewportHeight + 1,
    ),
    viewportDoesNotScroll: document.documentElement.scrollHeight <= viewportHeight + 1,
    composerUsable:
      !!root.querySelector('[aria-label="Message"]') || !!root.querySelector("textarea"),
    workspaceReadable:
      mode.startsWith("mobile") ||
      (!!root.querySelector(".chat-workspace-rail") &&
        !!root.querySelector('input[placeholder="Search files"]') &&
        text.includes("todd-world/src/game.js")),
  };
  return { mode, checks, ok: Object.values(checks).every(Boolean), bodyText: text };
};
`,
  );
}

async function runMode(
  page: Page,
  mode: Mode,
  artifactDir: string,
): Promise<{ result: Result; screenshot: string }> {
  await page.setViewportSize(MODE_VIEWPORTS[mode]);
  const result = (await page.evaluate(
    (value) => window.runOpenClawChatUxCleanupSmoke(value),
    mode,
  )) as Result;
  const screenshot = join(artifactDir, `chat-ux-cleanup-${mode}.png`);
  await page.screenshot({ path: screenshot });
  return { result, screenshot };
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-chat-ux-cleanup", timestampSlug());
  const appDir = join(artifactDir, "app");
  mkdirSync(artifactDir, { recursive: true });
  writeSmokeApp(appDir);

  let server: ViteDevServer | undefined;
  let browser: Browser | undefined;
  try {
    server = await createServer({
      appType: "spa",
      cacheDir: resolve(artifactDir, "vite-cache"),
      configFile: false,
      define: { "process.env": "{}" },
      logLevel: "error",
      optimizeDeps: {
        include: [...controlUiChatSmokeOptimizeDeps],
        noDiscovery: true,
      },
      resolve: controlUiSmokeViteResolve(),
      root: process.cwd(),
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) {
      throw new Error("Vite server did not report a local URL");
    }
    const appPath = `${appDir.split(/[\\/]/).join("/")}/index.html`;
    const url = new URL(appPath, baseUrl).toString();
    const executablePath = resolveBrowserExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.runOpenClawChatUxCleanupSmoke === "function");
    const runs: Array<Awaited<ReturnType<typeof runMode>>> = [];
    for (const mode of Object.keys(MODE_VIEWPORTS) as Mode[]) {
      runs.push(await runMode(page, mode, artifactDir));
    }
    const modeResults = runs.map((run) => run.result);
    const screenshots = runs.map((run) => run.screenshot);
    const failed = modeResults.filter((result) => !result.ok);
    if (failed.length) {
      throw new Error(`chat UX cleanup smoke failed: ${JSON.stringify(failed, null, 2)}`);
    }
    const summary: Summary = { artifactDir, modeResults, ok: true, screenshots, url };
    writeFileSync(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close();
    await server?.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

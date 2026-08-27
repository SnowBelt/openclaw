import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import {
  controlUiChatSmokeOptimizeDeps,
  controlUiSmokeViteResolve,
} from "./control-ui-smoke-vite.ts";

type Mode = "desktop" | "mobile";
type SmokeResult = {
  bodyText: string;
  checks: Record<string, boolean>;
  mode: Mode;
  ok: boolean;
};

function browserExecutable(): string | undefined {
  const explicit = process.env.OPENCLAW_CONTROL_UI_SMOKE_BROWSER?.trim();
  if (explicit) {
    return explicit;
  }
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) {
    return bundled;
  }
  const candidates =
    platform() === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return candidates.find((candidate) => existsSync(candidate));
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeSmokeApp(appDir: string): void {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Control Director Chat Reliability Smoke</title><style>html,body,#root{height:100%;margin:0;overflow:hidden}#root{display:flex;min-height:0}</style></head><body><main id="root"></main><script type="module" src="./main.ts"></script></body></html>`,
  );
  writeFileSync(
    join(appDir, "main.ts"),
    `import "/ui/src/styles.css";
import { render } from "lit";
import { renderChat } from "/ui/src/ui/views/chat.ts";

type Mode = "desktop" | "mobile";
type Result = { mode: Mode; ok: boolean; checks: Record<string, boolean>; bodyText: string };

declare global {
  interface Window {
    runControlDirectorChatReliabilitySmoke: (mode: Mode) => Promise<Result>;
  }
}

const root = document.getElementById("root")!;
let loadEarlierCalls = 0;
let projectPanelOpen = false;
let goalPanelOpen = false;
const controlCalls: Array<{ flowId: string; action: string }> = [];

const blockedGoal = {
  id: "flow-reliability",
  flowId: "flow-reliability",
  status: "blocked",
  goal: "Ship the dashboard with verified proof",
  currentStep: "Remote proof needs review.",
  blockedSummary: "Remote proof needs review.",
  updatedAt: 200,
  tasks: [],
};

const sessions = {
  count: 1,
  defaults: { contextTokens: null, model: null, modelProvider: null },
  path: "",
  sessions: [
    {
      key: "agent:main:main",
      kind: "direct",
      updatedAt: 200,
      displayName: "Main Control Director chat",
      projectId: "project-reliability",
      controlDirectorTruthAudit: [
        {
          ts: 180,
          runId: "run-reliability",
          status: "blocked",
          missing: ["remote proof receipt"],
          payloadsChecked: 1,
          payloadsRewritten: 1,
          claims: [
            {
              claim: "production complete",
              claimHash: "hash-reliability",
              claimType: "completion",
              requiredEvidenceType: "remote_proof",
              matchStatus: "missing",
              missingCondition: "remote proof receipt is missing",
              rewriteAction: "blocked_unsupported_truth_claim",
            },
          ],
        },
      ],
      controlDirectorMissionLedger: [
        {
          missionId: "mission-reliability",
          runId: "run-reliability",
          requestSummary: "ship dashboard",
          status: "blocked",
          startedAt: 100,
          updatedAt: 180,
          continuationCount: 0,
          finalStatus: "blocked",
          nextBuildGap: "review the proof blocker and retry",
          completionGrade: 8,
          criticality: 10,
        },
      ],
    },
  ],
  ts: 0,
};

const projectsList = {
  ok: true,
  ts: 1,
  count: 1,
  projects: [
    {
      id: "project-reliability",
      name: "Dashboard Reliability",
      memoryMode: "project_only",
      createdAt: 1,
      updatedAt: 2,
      resources: [],
    },
  ],
};

function props(mode: Mode, overrides: Record<string, unknown> = {}) {
  const mobile = mode === "mobile";
  return {
    sessionKey: "agent:main:main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    historyHasMore: true,
    historyLoadingOlder: false,
    historyTotalMessages: 42,
    sending: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [
      { role: "assistant", content: "I am checking the durable project state.", timestamp: 100 },
      {
        role: "toolResult",
        toolCallId: "call-read",
        toolName: "read_file",
        content: "Read project state",
        timestamp: 110,
      },
      {
        role: "toolResult",
        toolCallId: "call-test",
        toolName: "run_command",
        content: "Tests completed",
        timestamp: 111,
      },
    ],
    sideResult: null,
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
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
    assistantName: "Control Director",
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
    onLoadEarlier: () => { loadEarlierCalls += 1; },
    getDraft: () => "",
    onDraftChange: () => undefined,
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
    agentsList: {
      defaultId: "main",
      agents: [
        { id: "main", name: "Control Director" },
        { id: "research", name: "Research specialist" },
      ],
    },
    currentAgentId: "main",
    onAgentChange: () => undefined,
    onNavigateToAgent: () => undefined,
    onSessionSelect: () => undefined,
    onOpenSidebar: () => undefined,
    onCloseSidebar: () => undefined,
    onSplitRatioChange: () => undefined,
    onChatScroll: () => undefined,
    goalDraft: blockedGoal.goal,
    goalPanelOpen,
    goalFlows: [blockedGoal],
    onGoalPanelToggle: (open: boolean) => { goalPanelOpen = open; },
    onGoalDraftChange: () => undefined,
    onGoalStart: () => undefined,
    onGoalContinue: () => undefined,
    onGoalControl: (flowId: string, action: string) => {
      controlCalls.push({ flowId, action });
    },
    onGoalRefresh: () => undefined,
    projectPickerOpen: projectPanelOpen,
    projectsList,
    onProjectPickerToggle: (open: boolean) => { projectPanelOpen = open; },
    onProjectCreateFieldChange: () => undefined,
    onProjectCreateAndAttach: () => undefined,
    onProjectAttach: () => undefined,
    onProjectDetach: () => undefined,
    onNewProjectChat: () => undefined,
    onProjectRefresh: () => undefined,
    basePath: "",
    ...(mobile ? {} : {
      sessionWorkspace: {
        collapsed: true,
        sessionKey: "agent:main:main",
        list: null,
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
    }),
    ...overrides,
  };
}

async function draw(mode: Mode, overrides: Record<string, unknown> = {}) {
  render(renderChat(props(mode, overrides) as Parameters<typeof renderChat>[0]), root);
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

window.runControlDirectorChatReliabilitySmoke = async (mode: Mode): Promise<Result> => {
  loadEarlierCalls = 0;
  projectPanelOpen = false;
  goalPanelOpen = false;
  controlCalls.length = 0;
  await draw(mode);

  const checks: Record<string, boolean> = {};
  const bodyText = () => document.body.textContent || "";
  const loadEarlier = root.querySelector<HTMLButtonElement>("[data-chat-load-earlier]");
  loadEarlier?.click();
  checks.historyPagination = loadEarlierCalls === 1 && bodyText().includes("42 messages saved");
  checks.observableActivity = bodyText().includes("What OpenClaw did: 2 steps");

  const diagnostics = root.querySelector<HTMLDetailsElement>("[data-control-director-diagnostics]");
  checks.truthCollapsedInTranscript = Boolean(
    diagnostics && !diagnostics.open && diagnostics.closest(".chat-thread-inner"),
  );
  checks.truthExplainsBlocked =
    Boolean(diagnostics?.textContent?.includes("In plain English:")) &&
    Boolean(diagnostics?.textContent?.includes("could not safely prove"));

  const work = root.querySelector(".chat-work-surface");
  checks.needsAttention = Boolean(
    work &&
      work.textContent?.includes("Needs attention") &&
      work.textContent?.includes("Pursue Goal") &&
      work.textContent?.includes("Open the goal"),
  );
  root.querySelector<HTMLButtonElement>('[aria-label^="Open goal"]')?.click();
  await draw(mode, { goalPanelOpen: true });
  checks.reviewOpensGoal = Boolean(root.querySelector(".chat-goal[open]"));
  root.querySelector<HTMLButtonElement>('[data-chat-goal-action="retry"]')?.click();
  root.querySelector<HTMLButtonElement>('[data-chat-goal-action="cancel"]')?.click();
  checks.goalControls =
    controlCalls.some((call) => call.action === "retry") &&
    controlCalls.some((call) => call.action === "stop");

  projectPanelOpen = true;
  await draw(mode, { projectPickerOpen: true, goalPanelOpen: false });
  const project = root.querySelector("[data-chat-project-picker]");
  checks.sharedProjectContract = Boolean(
    project &&
      project.textContent?.includes("Dashboard Reliability") &&
      project.textContent?.includes("same project record used by PCC") &&
      project.textContent?.includes("does not create a second project plan"),
  );

  const composer = root.querySelector<HTMLElement>(".agent-chat__input");
  const thread = root.querySelector<HTMLElement>(".chat-thread");
  const composerRect = composer?.getBoundingClientRect();
  const threadRect = thread?.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  checks.composerUsable = Boolean(
    composerRect &&
      composerRect.top >= 0 &&
      composerRect.bottom <= viewportHeight + 1 &&
      root.querySelector("textarea"),
  );
  checks.transcriptUsable = Boolean(threadRect && threadRect.height >= (mode === "mobile" ? 120 : 220));
  checks.noViewportOverflow = document.documentElement.scrollHeight <= viewportHeight + 1;

  return {
    mode,
    ok: Object.values(checks).every(Boolean),
    checks,
    bodyText: bodyText(),
  };
};

void draw("desktop");
`,
  );
}

async function runMode(page: Page, mode: Mode, artifactDir: string): Promise<SmokeResult> {
  await page.setViewportSize(
    mode === "mobile" ? { width: 390, height: 844 } : { width: 1366, height: 768 },
  );
  const result = (await page.evaluate(
    (value) => window.runControlDirectorChatReliabilitySmoke(value),
    mode,
  )) as SmokeResult;
  await page.screenshot({
    path: join(artifactDir, `control-director-chat-reliability-${mode}.png`),
    fullPage: true,
  });
  if (!result.ok) {
    throw new Error(`${mode} reliability smoke failed: ${JSON.stringify(result.checks, null, 2)}`);
  }
  return result;
}

async function main(): Promise<void> {
  const artifactDir = join(
    ".artifacts",
    "control-ui-chat-control-director-reliability",
    timestampSlug(),
  );
  const appDir = join(artifactDir, "app");
  writeSmokeApp(appDir);

  let browser: Browser | undefined;
  let server: ViteDevServer | undefined;
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
      root: process.cwd(),
      resolve: controlUiSmokeViteResolve(),
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) {
      throw new Error("Vite server did not report a local URL");
    }
    const appPath = `${appDir.split(/[\\/]/).join("/")}/index.html`;
    const url = new URL(appPath, baseUrl).toString();
    const executablePath = browserExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const modeResults = [
      await runMode(page, "desktop", artifactDir),
      await runMode(page, "mobile", artifactDir),
    ];
    const summary = { artifactDir, modeResults, ok: true, url };
    writeFileSync(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close();
    await server?.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

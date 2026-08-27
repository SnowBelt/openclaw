import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { controlUiSmokeViteResolve } from "./control-ui-smoke-vite.ts";

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
  ];
}

function browserCandidates(): string[] {
  const explicit = process.env.OPENCLAW_CONTROL_UI_SMOKE_BROWSER?.trim();
  const bundled = chromium.executablePath();
  return Array.from(
    new Set([
      ...(explicit ? [explicit] : []),
      ...(bundled && existsSync(bundled) ? [bundled] : []),
      ...localChromeCandidates().filter((candidate) => existsSync(candidate)),
    ]),
  );
}

async function tryLaunchBrowser(): Promise<import("playwright").Browser | null> {
  for (const executablePath of browserCandidates()) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch (error) {
      console.warn(
        `PCC smoke browser launch failed for ${executablePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return null;
}

function writeHarness(appDir: string) {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>PCC Smoke</title></head>
  <body><main id="root"></main><script type="module" src="./main.ts"></script></body>
</html>
`,
  );
  writeFileSync(
    join(appDir, "main.ts"),
    `import "/ui/src/styles.css";
import { render } from "lit";
import { renderPccDashboard } from "/ui/src/ui/views/pcc.ts";

declare global {
  interface Window {
    runPccShellSmoke: () => Promise<{ ok: boolean; checks: Record<string, boolean>; text: string }>;
  }
}

const root = document.getElementById("root")!;

window.runPccShellSmoke = async () => {
  let refreshCount = 0;
  render(
    renderPccDashboard({
      loading: false,
      error: null,
      viewMode: "detailed",
      updatedAt: Date.now(),
      portfolio: {
        projectsTotal: 2,
        active: 1,
        blocked: 1,
        needsApproval: 1,
        complete: 0,
        archived: 0,
        averagePercentComplete: 58,
        nextActions: ["Run remote proof"],
      },
      projects: [
        {
          id: "pcc",
          title: "Project Command Center",
          status: "needs_approval",
          percentComplete: 58,
          milestoneCounts: { total: 8, complete: 4, blocked: 1, needsApproval: 1, deferred: 0, skipped: 0 },
          nextActions: ["Run remote proof"],
          proofGaps: ["Workflow Sanity proof"],
          updatedAt: "2026-06-26T00:00:00Z",
        },
      ],
      selectedProjectId: "pcc",
      projectDetail: {
        project: { id: "pcc", title: "Project Command Center", goal: "Track work", status: "needs_approval", priority: 3, createdAt: "2026-06-26T00:00:00Z", updatedAt: "2026-06-26T00:00:00Z" },
        milestones: [{ id: "milestone-crud", projectId: "pcc", title: "CRUD UI", status: "in_progress", order: 1, percentComplete: 58, implementationPlan: "Build compact forms", createdAt: "2026-06-26T00:00:00Z", updatedAt: "2026-06-26T00:00:00Z" }],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: { id: "pcc", title: "Project Command Center", status: "needs_approval", percentComplete: 58, milestoneCounts: { total: 8, complete: 4, blocked: 1, needsApproval: 1, deferred: 0, skipped: 0 }, nextActions: ["Run remote proof"], proofGaps: ["Workflow Sanity proof"], updatedAt: "2026-06-26T00:00:00Z" },
      },
      actionBusy: false,
      actionError: null,
      editorMode: null,
      projectForm: { id: null, title: "", goal: "", status: "active", priority: "3" },
      milestoneForm: { id: null, projectId: "pcc", title: "", status: "not_started", phaseId: "", order: "", percentComplete: "", blocker: "", implementationPlan: "", acceptanceCriteria: "", responsibility: "local_openclaw_agent", costRisk: "low" },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      onRefresh: () => { refreshCount += 1; },
      onSelectProject: () => {},
      onOpenProjectEditor: () => {},
      onOpenMilestoneEditor: () => {},
      onProjectFormChange: () => {},
      onMilestoneFormChange: () => {},
      onSaveProject: () => {},
      onSaveMilestone: () => {},
      onCancelEditor: () => {},
      onSetProjectStatus: () => {},
      onSetMilestoneStatus: () => {},
      onAddCompletionReceipt: () => {},
      onSetPermissionStatus: () => {},
      onUpdateWorkLoop: () => {},
      onPrepareNextWorkItem: () => {},
      onChatSyncTextChange: () => {},
      onPreviewChatSync: () => {},
      onApplyChatSyncProposal: () => {},
      onDismissChatSync: () => {},
    }),
    root,
  );
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("Refresh"))?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const text = root.textContent ?? "";
  const checks = {
    shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
    title: text.includes("Project Command Center"),
    metrics: text.includes("Total projects") && text.includes("Average completion"),
    card: root.querySelectorAll("[data-pcc-project-card]").length === 1,
    nextAction: text.includes("Run remote proof"),
    proofGap: text.includes("Workflow Sanity proof"),
    refresh: refreshCount === 1,
  };
  return { ok: Object.values(checks).every(Boolean), checks, text: text.slice(0, 1000) };
};
`,
  );
}

function pccSmokeProps() {
  let refreshCount = 0;
  return {
    props: {
      loading: false,
      error: null,
      viewMode: "detailed" as const,
      updatedAt: Date.now(),
      portfolio: {
        projectsTotal: 2,
        active: 1,
        blocked: 1,
        needsApproval: 1,
        complete: 0,
        archived: 0,
        averagePercentComplete: 58,
        nextActions: ["Run remote proof"],
      },
      projects: [
        {
          id: "pcc",
          title: "Project Command Center",
          status: "needs_approval" as const,
          percentComplete: 58,
          milestoneCounts: {
            total: 8,
            complete: 4,
            blocked: 1,
            needsApproval: 1,
            deferred: 0,
            skipped: 0,
          },
          nextActions: ["Run remote proof"],
          proofGaps: ["Workflow Sanity proof"],
          updatedAt: "2026-06-26T00:00:00Z",
        },
      ],
      selectedProjectId: "pcc",
      projectDetail: {
        project: {
          id: "pcc",
          title: "Project Command Center",
          goal: "Track work",
          status: "needs_approval" as const,
          priority: 3,
          createdAt: "2026-06-26T00:00:00Z",
          updatedAt: "2026-06-26T00:00:00Z",
        },
        milestones: [
          {
            id: "milestone-crud",
            projectId: "pcc",
            title: "CRUD UI",
            status: "in_progress" as const,
            order: 1,
            percentComplete: 58,
            implementationPlan: "Build compact forms",
            createdAt: "2026-06-26T00:00:00Z",
            updatedAt: "2026-06-26T00:00:00Z",
          },
        ],
        permissions: [],
        evidence: [],
        receipts: [],
        summary: {
          id: "pcc",
          title: "Project Command Center",
          status: "needs_approval" as const,
          percentComplete: 58,
          milestoneCounts: {
            total: 8,
            complete: 4,
            blocked: 1,
            needsApproval: 1,
            deferred: 0,
            skipped: 0,
          },
          nextActions: ["Run remote proof"],
          proofGaps: ["Workflow Sanity proof"],
          updatedAt: "2026-06-26T00:00:00Z",
        },
      },
      actionBusy: false,
      actionError: null,
      editorMode: null,
      projectForm: { id: null, title: "", goal: "", status: "active" as const, priority: "3" },
      milestoneForm: {
        id: null,
        projectId: "pcc",
        title: "",
        status: "not_started" as const,
        phaseId: "",
        order: "",
        percentComplete: "",
        blocker: "",
        implementationPlan: "",
        acceptanceCriteria: "",
        responsibility: "local_openclaw_agent",
        costRisk: "low",
      },
      chatSyncText: "",
      chatSyncProposals: [],
      chatSyncError: null,
      onRefresh: () => {
        refreshCount += 1;
      },
      onSelectProject: () => {},
      onOpenProjectEditor: () => {},
      onOpenMilestoneEditor: () => {},
      onProjectFormChange: () => {},
      onMilestoneFormChange: () => {},
      onSaveProject: () => {},
      onSaveMilestone: () => {},
      onCancelEditor: () => {},
      onSetProjectStatus: () => {},
      onSetMilestoneStatus: () => {},
      onAddCompletionReceipt: () => {},
      onSetPermissionStatus: () => {},
      onUpdateWorkLoop: () => {},
      onPrepareNextWorkItem: () => {},
      onChatSyncTextChange: () => {},
      onPreviewChatSync: () => {},
      onApplyChatSyncProposal: () => {},
      onDismissChatSync: () => {},
    },
    refreshCount: () => refreshCount,
  };
}

function evaluateRenderedPcc(root: ParentNode, text: string, refreshCount: number) {
  const checks = {
    shell: root.querySelectorAll("[data-pcc-shell]").length === 1,
    title: text.includes("Project Command Center"),
    metrics: text.includes("Total projects") && text.includes("Average completion"),
    card: root.querySelectorAll("[data-pcc-project-card]").length === 1,
    nextAction: text.includes("Run remote proof"),
    proofGap: text.includes("Workflow Sanity proof"),
    refresh: refreshCount === 1,
  };
  return { ok: Object.values(checks).every(Boolean), checks, text: text.slice(0, 1000) };
}

async function runJsdomSmoke(artifactDir: string) {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(`<!doctype html><main id="root"></main>`, { url: "http://127.0.0.1/pcc" });
  const previous = {
    window: (globalThis as { window?: unknown }).window,
    document: (globalThis as { document?: unknown }).document,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement,
    Node: (globalThis as { Node?: unknown }).Node,
    MouseEvent: (globalThis as { MouseEvent?: unknown }).MouseEvent,
    requestAnimationFrame: (globalThis as { requestAnimationFrame?: unknown })
      .requestAnimationFrame,
  };
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: unknown }).Node = dom.window.Node;
  (globalThis as { MouseEvent?: unknown }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    callback: FrameRequestCallback,
  ) => setTimeout(() => callback(Date.now()), 0);
  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("missing root");
    }
    const smoke = pccSmokeProps();
    render(renderPccDashboard(smoke.props), root);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Refresh"))
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const result = evaluateRenderedPcc(root, root.textContent ?? "", smoke.refreshCount());
    const htmlPath = join(artifactDir, "pcc-shell.html");
    writeFileSync(htmlPath, dom.serialize());
    const summary = {
      artifactDir,
      ok: result.ok,
      checks: result.checks,
      mode: "jsdom-fallback",
      html: htmlPath,
    };
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!result.ok) {
      process.exit(1);
    }
  } finally {
    (globalThis as { window?: unknown }).window = previous.window;
    (globalThis as { document?: unknown }).document = previous.document;
    (globalThis as { HTMLElement?: unknown }).HTMLElement = previous.HTMLElement;
    (globalThis as { Node?: unknown }).Node = previous.Node;
    (globalThis as { MouseEvent?: unknown }).MouseEvent = previous.MouseEvent;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      previous.requestAnimationFrame;
  }
}

async function main() {
  const artifactDir = join(".artifacts", "control-ui-pcc-shell-smoke", timestampSlug());
  const appDir = join(artifactDir, "app");
  mkdirSync(artifactDir, { recursive: true });
  const browser = await tryLaunchBrowser();
  if (!browser) {
    await runJsdomSmoke(artifactDir);
    return;
  }

  writeHarness(appDir);
  const server = await createServer({
    appType: "spa",
    configFile: false,
    define: { "process.env": "{}" },
    root: process.cwd(),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    resolve: controlUiSmokeViteResolve(process.cwd()),
    logLevel: "error",
  });
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) {
      throw new Error("Unable to determine PCC smoke Vite URL.");
    }
    const appPath = `${appDir.split(/[\\/]/).join("/")}/index.html`;
    const url = new URL(appPath, baseUrl).toString();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const result = await page.evaluate(async () => window.runPccShellSmoke());
    const screenshot = join(artifactDir, "pcc-shell.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    const summary = {
      artifactDir,
      ok: result.ok,
      checks: result.checks,
      mode: "browser",
      screenshot,
      url,
    };
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!result.ok) {
      process.exit(1);
    }
  } finally {
    await page.close();
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

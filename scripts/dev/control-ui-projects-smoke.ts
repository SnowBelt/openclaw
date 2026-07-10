import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  appendControlUiTokenFragment,
  redactControlUiSmokeSecrets,
} from "./control-ui-smoke-url.js";

type GatewayInstance = {
  port: number;
  url: string;
  token: string;
  artifactDir: string;
  stateDir: string;
  configPath: string;
  child: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
  stop: () => Promise<void>;
};

type ProjectSmokeSnapshot = {
  phase: string;
  pccProjects: number;
  selectedId: string | null;
  milestones: number;
  updatedAt: number | null;
  bodyText: string;
};

type ProjectSmokeSummary = {
  ok: true;
  url: string;
  authUrlClean: boolean;
  artifactDir: string;
  stateDir: string;
  snapshots: ProjectSmokeSnapshot[];
  checks: {
    projectsAlias: boolean;
    pccHeading: boolean;
    ledgerRead: boolean;
  };
  consoleErrors: string[];
  responseErrors: string[];
  pageErrors: string[];
};

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function redactSmokeSecrets(value: string): string {
  return redactControlUiSmokeSecrets(value);
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

function resolveGatewayEntrypoint(): string {
  if (existsSync("dist/index.js")) {
    return "dist/index.js";
  }
  if (existsSync("dist/index.mjs")) {
    return "dist/index.mjs";
  }
  return "scripts/run-node.mjs";
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("failed to reserve an ephemeral loopback port");
  }
  return address.port;
}

async function waitForPortOpen(params: {
  child: ChildProcessWithoutNullStreams;
  port: number;
  stdout: string[];
  stderr: string[];
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    if (params.child.exitCode !== null) {
      throw new Error(
        `Gateway exited before listening (code=${String(params.child.exitCode)}):\n${formatLogs(
          params.stdout,
          params.stderr,
        )}`,
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port: params.port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(
    `Timed out waiting for isolated Gateway on ${params.port}:\n${formatLogs(
      params.stdout,
      params.stderr,
    )}`,
  );
}

function formatLogs(stdout: string[], stderr: string[]): string {
  return `--- stdout ---\n${redactSmokeSecrets(stdout.join(""))}\n--- stderr ---\n${redactSmokeSecrets(
    stderr.join(""),
  )}`;
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  return await Promise.race([
    new Promise<boolean>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(true);
        return;
      }
      child.once("exit", () => resolve(true));
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function startIsolatedGateway(artifactDir: string): Promise<GatewayInstance> {
  const port = await getFreePort();
  const token = `projects-smoke-${randomUUID()}`;
  const homeDir = join(artifactDir, "home");
  const stateDir = join(homeDir, ".openclaw");
  const configPath = join(stateDir, "openclaw.json");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        gateway: {
          port,
          bind: "loopback",
          auth: { mode: "token", token },
          controlUi: { enabled: true },
        },
        hooks: { enabled: false },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const stdout: string[] = [];
  const stderr: string[] = [];
  const entrypoint = resolveGatewayEntrypoint();
  const child = spawn(
    "node",
    [entrypoint, "gateway", "--port", String(port), "--bind", "loopback", "--allow-unconfigured"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homeDir,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_GATEWAY_TOKEN: "",
        OPENCLAW_GATEWAY_PASSWORD: "",
        OPENCLAW_SKIP_CHANNELS: "1",
        OPENCLAW_SKIP_PROVIDERS: "1",
        OPENCLAW_SKIP_GMAIL_WATCHER: "1",
        OPENCLAW_SKIP_CRON: "1",
        OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
        OPENCLAW_SKIP_CANVAS_HOST: "1",
        OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  await waitForPortOpen({ child, port, stdout, stderr, timeoutMs: 90_000 });

  return {
    port,
    url: `http://127.0.0.1:${port}/projects`,
    token,
    artifactDir,
    stateDir,
    configPath,
    child,
    stdout,
    stderr,
    stop: async () => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
      const stopped = await waitForExit(child, 2_000);
      if (!stopped && child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
    },
  };
}

async function waitForProjectsAlias(page: Page) {
  await page.waitForFunction(
    () => {
      const app = document.querySelector("openclaw-app") as
        | (HTMLElement & {
            connected?: boolean;
            tab?: string;
            pccError?: string | null;
            pccLoading?: boolean;
            pccUpdatedAt?: number | null;
          })
        | null;
      return (
        app?.connected === true &&
        app.tab === "pcc" &&
        app.pccLoading === false &&
        app.pccError == null &&
        typeof app.pccUpdatedAt === "number"
      );
    },
    null,
    { timeout: 45_000 },
  );
}

async function snapshotProjectsAlias(page: Page, phase: string): Promise<ProjectSmokeSnapshot> {
  return await page.evaluate((phaseName) => {
    const app = document.querySelector("openclaw-app") as
      | (HTMLElement & {
          pccProjects?: unknown[];
          pccSelectedProjectId?: string | null;
          pccProjectDetail?: { milestones?: unknown[] } | null;
          pccUpdatedAt?: number | null;
        })
      | null;
    return {
      phase: phaseName,
      pccProjects: app?.pccProjects?.length ?? 0,
      selectedId: app?.pccSelectedProjectId ?? null,
      milestones: app?.pccProjectDetail?.milestones?.length ?? 0,
      updatedAt: app?.pccUpdatedAt ?? null,
      bodyText: (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1600),
    } satisfies ProjectSmokeSnapshot;
  }, phase);
}

async function assertNoPccError(page: Page, phase: string) {
  const diagnostics = await page.evaluate(() => {
    const app = document.querySelector("openclaw-app") as
      | (HTMLElement & { connected?: boolean; tab?: string; pccError?: string | null })
      | null;
    return {
      connected: app?.connected ?? null,
      tab: app?.tab ?? null,
      pccError: app?.pccError ?? null,
      bodyText: (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1600),
    };
  });
  if (diagnostics.connected !== true || diagnostics.tab !== "pcc" || diagnostics.pccError) {
    throw new Error(
      "Projects alias smoke saw an invalid PCC state during " +
        phase +
        ": " +
        JSON.stringify(diagnostics),
    );
  }
}

async function runProjectsAliasFlow(page: Page, artifactDir: string) {
  await waitForProjectsAlias(page);
  await page.getByRole("heading", { name: "Project Command Center", exact: true }).waitFor({
    timeout: 45_000,
  });
  await assertNoPccError(page, "PCC alias load");
  const snapshot = await snapshotProjectsAlias(page, "projects-alias-loaded");
  await page.screenshot({ path: join(artifactDir, "01-projects-alias-pcc.png"), fullPage: false });
  return {
    snapshots: [snapshot],
    checks: {
      projectsAlias: true,
      pccHeading: true,
      ledgerRead: snapshot.updatedAt !== null,
    },
  };
}

async function main() {
  const artifactDir =
    process.env.OPENCLAW_CONTROL_UI_PROJECTS_ARTIFACT_DIR?.trim() ||
    join(".artifacts", "control-ui-projects", timestampSlug());
  mkdirSync(artifactDir, { recursive: true });

  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      "No Playwright Chromium or local Chrome-compatible browser found. Install Playwright browsers or set OPENCLAW_CONTROL_UI_SMOKE_BROWSER.",
    );
  }

  let gateway: GatewayInstance | null = null;
  let browser: Browser | null = null;
  const consoleErrors: string[] = [];
  const responseErrors: string[] = [];
  const pageErrors: string[] = [];
  try {
    gateway = await startIsolatedGateway(artifactDir);
    browser = await chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(
      (metadata) => {
        localStorage.setItem("openclaw.controlUi.clientMetadata", JSON.stringify(metadata));
      },
      {
        displayName: "OpenClaw Projects smoke desktop profile",
        deviceFamily: "control-ui-smoke",
        platform: "desktop",
      },
    );
    const page = await context.newPage();
    await page.addInitScript("globalThis.__name = (fn) => fn;");
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(redactSmokeSecrets(message.text()));
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 500) {
        responseErrors.push(`${response.status()} ${redactSmokeSecrets(response.url())}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(redactSmokeSecrets(error.message)));

    const launchUrl = appendControlUiTokenFragment(gateway.url, gateway.token);
    await page.goto(launchUrl, { waitUntil: "domcontentloaded" });
    const { snapshots, checks } = await runProjectsAliasFlow(page, artifactDir);
    const authUrlClean = await page.evaluate(
      () => !/(?:[#?&])(?:token|password)=/i.test(window.location.href),
    );
    if (!authUrlClean) {
      throw new Error("Dashboard left auth material in the browser URL after bootstrap.");
    }
    if (consoleErrors.length > 0 || responseErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        `Projects smoke saw browser errors: ${JSON.stringify({
          consoleErrors,
          responseErrors,
          pageErrors,
        })}`,
      );
    }
    const summary: ProjectSmokeSummary = {
      ok: true,
      url: gateway.url,
      authUrlClean,
      artifactDir,
      stateDir: gateway.stateDir,
      snapshots,
      checks,
      consoleErrors,
      responseErrors,
      pageErrors,
    };
    writeFileSync(join(artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`control-ui-projects-smoke: ok ${JSON.stringify(summary, null, 2)}`);
  } catch (error) {
    const logs = gateway ? `\nGateway logs:\n${formatLogs(gateway.stdout, gateway.stderr)}` : "";
    throw new Error(
      `${redactSmokeSecrets(error instanceof Error ? error.stack || error.message : String(error))}${logs}`,
      { cause: error },
    );
  } finally {
    await browser?.close().catch(() => undefined);
    await gateway?.stop().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    "control-ui-projects-smoke: failed",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});

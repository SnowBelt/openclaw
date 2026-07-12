import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GATEWAY_LAUNCH_AGENT_LABEL,
  resolveGatewayLaunchAgentLabel,
} from "../../src/daemon/constants.js";
import { readLaunchAgentProgramArgumentsFromFile } from "../../src/daemon/launchd-plist.js";
import { VERSION } from "../../src/version.js";

type RuntimeIdentity = {
  runtimeRoot: string;
  layout: "source-copy" | "package-snapshot" | "unknown";
  markerSha: string | null;
  snapshotSha: string | null;
  runtimeSha: string | null;
  entrypoint: string | null;
  releaseId: string | null;
  service?: {
    platform: NodeJS.Platform;
    plistPath: string | null;
    installed: boolean;
    programArguments: string[];
    entrypoint: string | null;
    serviceVersion: string | null;
    customRuntime?: {
      runtimeRoot: string;
      entrypoint: string;
      sourceSha: string;
      manifestPath: string;
    };
    matchesRuntimeRoot: boolean | null;
    driftReason: string | null;
  };
};

type ProofOptions = {
  authUrl?: string;
  allowLocalTokenResolution: boolean;
  screenshotPath: string;
  projectTitle: string;
  requireProductionCurrent: boolean;
  expectedRuntimeSha?: string;
  profile:
    | "production-current"
    | "usability-reliability"
    | "functionality-closure"
    | "focus-live-interaction";
};

const REQUIRED_DASHBOARD_SURFACES = [
  "pcc",
  "app-studio",
  "music-studio",
  "snes-studio",
  "book-writer",
  "kalshi",
  "pattern-lab",
] as const;

function redactUrl(value: string): string {
  return value
    .replace(/([#?&]token=)[^&/#]+/gi, "$1<redacted>")
    .replace(/(OPENCLAW_GATEWAY_TOKEN=)[^\\s]+/gi, "$1<redacted>");
}

function assertNoTokenLeak(value: string) {
  if (/token=[A-Za-z0-9._~+/=-]{8,}/i.test(value)) {
    throw new Error("proof output contains an unredacted token");
  }
}

function readTextIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

function pathIsSameOrChild(candidate: string, parent: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedParent = path.resolve(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
}

function resolveGatewayLaunchAgentPlistPath(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }
  const label =
    process.env.OPENCLAW_LAUNCHD_LABEL?.trim() ||
    resolveGatewayLaunchAgentLabel(process.env.OPENCLAW_PROFILE);
  const safeLabel = label || GATEWAY_LAUNCH_AGENT_LABEL;
  return path.join(os.homedir(), "Library", "LaunchAgents", `${safeLabel}.plist`);
}

function serviceEntrypointFromArgs(args: readonly string[]): string | null {
  const candidate = args.find((arg) => /\/dist\/(?:index|entry)\.m?js$/u.test(arg));
  return candidate ?? null;
}

function customRuntimePointerFromArgs(args: readonly string[]) {
  if (!args.some((arg) => arg.endsWith("/custom-runtime-launcher.sh"))) {
    return null;
  }
  const pointerPath = path.join(os.homedir(), ".openclaw-custom-runtime", "active-runtime.json");
  const raw = readTextIfPresent(pointerPath);
  if (!raw) {
    return null;
  }
  try {
    const pointer = JSON.parse(raw) as {
      runtimeRoot?: unknown;
      entrypoint?: unknown;
      sourceSha?: unknown;
      manifestPath?: unknown;
    };
    const runtimeRoot = typeof pointer.runtimeRoot === "string" ? pointer.runtimeRoot : "";
    const entrypoint = typeof pointer.entrypoint === "string" ? pointer.entrypoint : "";
    const sourceSha = typeof pointer.sourceSha === "string" ? pointer.sourceSha.trim() : "";
    const manifestPath = typeof pointer.manifestPath === "string" ? pointer.manifestPath : "";
    if (
      !runtimeRoot ||
      !pathIsSameOrChild(runtimeRoot, path.join(os.homedir(), ".openclaw-runtime-releases")) ||
      entrypoint !== path.join(runtimeRoot, "dist", "index.js") ||
      manifestPath !== path.join(runtimeRoot, "dist", "control-ui", "dashboard-surfaces.json") ||
      !sourceSha
    ) {
      return null;
    }
    return { runtimeRoot, entrypoint, sourceSha, manifestPath };
  } catch {
    return null;
  }
}

async function resolveRuntimeIdentity(runtimeRoot = process.cwd()): Promise<RuntimeIdentity> {
  const markerSha = readTextIfPresent(`${runtimeRoot}/.openclaw-production-sha`);
  const snapshotRaw = readTextIfPresent(`${runtimeRoot}/snapshot.json`);
  let snapshotSha: string | null = null;
  let entrypoint: string | null = null;
  let releaseId: string | null = null;
  if (snapshotRaw) {
    try {
      const snapshot = JSON.parse(snapshotRaw) as {
        releaseId?: unknown;
        source?: { buildStamp?: { head?: unknown }; runtimePostbuildStamp?: { head?: unknown } };
        paths?: { entrypoint?: unknown };
      };
      const buildHead =
        snapshot.source?.runtimePostbuildStamp?.head ?? snapshot.source?.buildStamp?.head;
      snapshotSha = typeof buildHead === "string" && buildHead.trim() ? buildHead.trim() : null;
      entrypoint =
        typeof snapshot.paths?.entrypoint === "string" ? snapshot.paths.entrypoint : null;
      releaseId = typeof snapshot.releaseId === "string" ? snapshot.releaseId : null;
    } catch {
      snapshotSha = null;
    }
  }
  const identity: RuntimeIdentity = {
    runtimeRoot,
    layout: markerSha ? "source-copy" : snapshotSha ? "package-snapshot" : "unknown",
    markerSha,
    snapshotSha,
    runtimeSha: markerSha ?? snapshotSha,
    entrypoint,
    releaseId,
  };
  const plistPath = resolveGatewayLaunchAgentPlistPath();
  if (plistPath) {
    const command = await readLaunchAgentProgramArgumentsFromFile(plistPath).catch(() => null);
    const serviceEntrypoint = command ? serviceEntrypointFromArgs(command.programArguments) : null;
    const customRuntime = command ? customRuntimePointerFromArgs(command.programArguments) : null;
    const serviceVersion = command?.environment?.OPENCLAW_SERVICE_VERSION?.trim() || null;
    const matchesRuntimeRoot = customRuntime
      ? customRuntime.sourceSha === identity.runtimeSha
      : serviceEntrypoint
        ? pathIsSameOrChild(serviceEntrypoint, runtimeRoot)
        : null;
    const driftReasons = [
      command && !serviceEntrypoint && !customRuntime
        ? `LaunchAgent ${plistPath} has no dist entrypoint in ProgramArguments`
        : null,
      serviceEntrypoint && !customRuntime && !matchesRuntimeRoot
        ? `LaunchAgent entrypoint ${serviceEntrypoint} is outside ${runtimeRoot}`
        : null,
      customRuntime && !matchesRuntimeRoot
        ? `Custom runtime source SHA ${customRuntime.sourceSha} does not match ${identity.runtimeSha ?? "the dashboard runtime"}`
        : null,
      serviceVersion && serviceVersion !== VERSION
        ? `LaunchAgent service version ${serviceVersion} does not match CLI ${VERSION}`
        : null,
    ].filter((item): item is string => Boolean(item));
    identity.service = {
      platform: process.platform,
      plistPath,
      installed: Boolean(command),
      programArguments: command?.programArguments ?? [],
      entrypoint: customRuntime?.entrypoint ?? serviceEntrypoint,
      serviceVersion,
      ...(customRuntime ? { customRuntime } : {}),
      matchesRuntimeRoot,
      driftReason: driftReasons.length ? driftReasons.join("; ") : null,
    };
  }
  return identity;
}

function assertRuntimeIdentity(options: ProofOptions, identity: RuntimeIdentity): void {
  if (!options.requireProductionCurrent) {
    return;
  }
  if (!identity.runtimeSha) {
    throw new Error(
      `production-current proof requires runtime identity, but ${identity.runtimeRoot} has neither .openclaw-production-sha nor snapshot.json source stamp`,
    );
  }
  const expected = options.expectedRuntimeSha?.trim();
  if (expected && identity.runtimeSha !== expected) {
    throw new Error(
      `production-current proof runtime SHA mismatch: expected ${expected}, got ${identity.runtimeSha}`,
    );
  }
  const service = identity.service;
  if (process.platform === "darwin" && service) {
    if (!service.installed) {
      throw new Error(
        `production-current proof requires installed LaunchAgent ${service.plistPath}, but it was not readable`,
      );
    }
    if (service.driftReason) {
      throw new Error(`production-current proof runtime drift: ${service.driftReason}`);
    }
  }
}

function readConfigToken(configPath: string): { url: string; tokenLength: number } {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    gateway?: {
      port?: number;
      auth?: {
        token?:
          | string
          | {
              source?: string;
              id?: string;
              path?: string;
            };
      };
    };
  };
  const port = cfg.gateway?.port ?? 18789;
  const tokenRef = cfg.gateway?.auth?.token;
  let token = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
  if (!token && typeof tokenRef === "string") {
    token = tokenRef;
  }
  if (!token && tokenRef && typeof tokenRef === "object") {
    if (tokenRef.source === "env" && tokenRef.id) {
      token = process.env[tokenRef.id] ?? "";
    }
    if (!token && tokenRef.source === "file" && tokenRef.path) {
      token = fs.readFileSync(tokenRef.path, "utf8").trim();
    }
  }
  if (!token) {
    throw new Error("missing local dashboard auth token");
  }
  return {
    url: `http://127.0.0.1:${port}/projects#token=${encodeURIComponent(token)}`,
    tokenLength: token.length,
  };
}

function resolveProofUrl(options: ProofOptions): { url: string; source: string } {
  if (options.authUrl) {
    const url = new URL(options.authUrl);
    url.pathname = "/projects";
    if (!url.hash.includes("token=") && !url.search.includes("token=")) {
      throw new Error("OPENCLAW_DASHBOARD_AUTH_URL must include token auth");
    }
    return { url: url.toString(), source: "env-url" };
  }
  if (!options.allowLocalTokenResolution) {
    throw new Error(
      "set OPENCLAW_DASHBOARD_AUTH_URL or OPENCLAW_ALLOW_LOCAL_GATEWAY_TOKEN_RESOLUTION=1",
    );
  }
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH ?? "/Users/openclaw/.openclaw/openclaw.director.json";
  const resolved = readConfigToken(configPath);
  return { url: resolved.url, source: "local-config" };
}

async function runBrowserProof(options: ProofOptions) {
  const { chromium } = await import("playwright");
  const runtimeIdentity = await resolveRuntimeIdentity();
  assertRuntimeIdentity(options, runtimeIdentity);
  const resolved = resolveProofUrl(options);
  console.log(`DASH_URL_OK=${redactUrl(resolved.url)}`);
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OPENCLAW_PCC_PROOF_CHROME_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(resolved.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(12_000);
  const dashboardManifest = await page
    .evaluate(async () => {
      const response = await fetch("/dashboard-surfaces.json", { cache: "no-store" });
      if (!response.ok) {
        return { ok: false, status: response.status, buildId: null, ids: [] as string[] };
      }
      const payload = (await response.json()) as {
        buildId?: unknown;
        surfaces?: Array<{ id?: unknown; assets?: unknown }>;
      };
      return {
        ok: true,
        status: response.status,
        buildId: typeof payload.buildId === "string" ? payload.buildId : null,
        ids: (payload.surfaces ?? [])
          .filter((surface) => Array.isArray(surface.assets) && surface.assets.length > 0)
          .map((surface) => (typeof surface.id === "string" ? surface.id : ""))
          .filter(Boolean),
      };
    })
    .catch(() => ({ ok: false, status: 0, buildId: null, ids: [] as string[] }));
  const ensurePccRoute = async () => {
    const pccShell = page.locator(".pcc-shell").first();
    if (await pccShell.isVisible().catch(() => false)) {
      return;
    }
    const pccNavLink = page.locator('a[href$="/projects"], a[href="/projects"]').first();
    if (await pccNavLink.isVisible().catch(() => false)) {
      await pccNavLink.click({ force: true });
      await pccShell.waitFor({ state: "visible", timeout: 45_000 });
      return;
    }
    const fallbackUrl = new URL(resolved.url);
    fallbackUrl.pathname = "/projects";
    fallbackUrl.hash = "";
    fallbackUrl.search = "";
    await page.goto(fallbackUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await pccShell.waitFor({ state: "visible", timeout: 45_000 });
  };
  await ensurePccRoute();
  const simpleMode = page.locator('[data-pcc-view-mode-option="simple"]').last();
  if (await simpleMode.isVisible().catch(() => false)) {
    await simpleMode.click({ force: true });
    await page.waitForTimeout(1_000);
  }
  const assertSelectedProject = async (title: string, label: string) => {
    const detail = page.locator("[data-pcc-detail]").first();
    await detail.waitFor({ state: "visible", timeout: 45_000 });
    await page
      .waitForFunction(
        (expectedTitle) => {
          const detailNode = document.querySelector("[data-pcc-detail]");
          const detailTitle = detailNode?.getAttribute("data-pcc-detail-project-title") ?? "";
          const detailText = detailNode?.textContent ?? "";
          return detailTitle === expectedTitle || detailText.includes(expectedTitle);
        },
        title,
        { timeout: 15_000 },
      )
      .catch(async () => {
        const actualTitle = (await detail.getAttribute("data-pcc-detail-project-title")) ?? "";
        const bodyText = ((await detail.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
        throw new Error(
          `PCC proof selection failed for ${label}: expected selected project "${title}", got "${actualTitle}" (${bodyText.slice(0, 220)})`,
        );
      });
  };
  const isSelectedProject = async (title: string) => {
    const detail = page.locator("[data-pcc-detail]").first();
    if (!(await detail.isVisible().catch(() => false))) {
      return false;
    }
    const actualTitle = (await detail.getAttribute("data-pcc-detail-project-title")) ?? "";
    if (actualTitle === title) {
      return true;
    }
    const bodyText = ((await detail.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    return bodyText.includes(title);
  };

  const projectIdForTitle = (title: string): string | undefined => {
    if (title === "Project Command Center") {
      return "project-command-center";
    }
    if (title === "SNES Game Creator") {
      return "snes-game-creator";
    }
    return undefined;
  };
  const projectCardForTitle = (title: string) => {
    const projectId = projectIdForTitle(title);
    if (projectId) {
      return page.locator(`.pcc-project-card[data-pcc-project-id="${projectId}"]`).first();
    }
    return page.locator(".pcc-project-card", { hasText: title }).first();
  };

  const productMode = page.locator('[data-pcc-focus-mode-option="pcc_product"]').last();
  if (options.projectTitle === "Project Command Center") {
    if (await productMode.isVisible().catch(() => false)) {
      await productMode.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }
  const targetProject = projectCardForTitle(options.projectTitle);
  let projectCardCount = await targetProject.count();
  if (projectCardCount === 0 && !(await isSelectedProject(options.projectTitle))) {
    const allProjectsTab = page.locator(".pcc-project-tabs button", { hasText: /All/i }).last();
    if (await allProjectsTab.isVisible().catch(() => false)) {
      await allProjectsTab.click({ force: true });
      await page
        .locator(".pcc-project-card")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => undefined);
      projectCardCount = await targetProject.count();
    }
  }
  if (projectCardCount > 0) {
    const pickVisibleButton = async () => {
      const candidates = [
        targetProject.locator("button", { hasText: /Open/i }).first(),
        targetProject.locator("button", { hasText: /Selected/i }).first(),
      ];
      for (const candidate of candidates) {
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
      return undefined;
    };
    const openButton = await pickVisibleButton();
    if (openButton) {
      await openButton.click({ force: true }).catch(() => undefined);
    }
  } else if (!(await isSelectedProject(options.projectTitle))) {
    const cardTexts = await page
      .locator(".pcc-project-card")
      .evaluateAll((cards) =>
        cards
          .map((card) => card.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean)
          .slice(0, 5),
      )
      .catch(() => []);
    throw new Error(
      `PCC proof could not find requested project card "${options.projectTitle}". Visible cards: ${cardTexts.join(" | ")}`,
    );
  }
  await assertSelectedProject(options.projectTitle, "requested project card");

  if (
    options.profile === "usability-reliability" ||
    options.profile === "functionality-closure" ||
    options.profile === "focus-live-interaction"
  ) {
    const projectWorkMode = page.locator('[data-pcc-focus-mode-option="project_work"]').last();
    if (await projectWorkMode.isVisible().catch(() => false)) {
      await projectWorkMode.click({ force: true });
      await page.waitForTimeout(500);
      const snesProject = projectCardForTitle("SNES Game Creator");
      if (
        options.profile !== "focus-live-interaction" &&
        (await snesProject.count()) > 0 &&
        (await snesProject.isVisible().catch(() => false))
      ) {
        const snesOpen = snesProject.locator("button", { hasText: /Open|Selected/ }).first();
        if (await snesOpen.isVisible().catch(() => false)) {
          await snesOpen.click({ force: true });
          await assertSelectedProject(
            "SNES Game Creator",
            options.profile === "functionality-closure"
              ? "Project Work crash regression"
              : "Project Work card selection",
          );
        }
      }
      const productFocusMode = page.locator('[data-pcc-focus-mode-option="pcc_product"]').last();
      if (await productFocusMode.isVisible().catch(() => false)) {
        await productFocusMode.click({ force: true });
        await page.waitForTimeout(500);
      }
      const pccProject = projectCardForTitle(options.projectTitle);
      const pccOpen = pccProject.locator("button", { hasText: /Open|Selected/ }).first();
      if ((await pccOpen.count()) > 0 && (await pccOpen.isVisible().catch(() => false))) {
        await pccOpen.click({ force: true });
      }
      await assertSelectedProject(options.projectTitle, "PCC Product card selection");
    }
  }

  const agentMode = page.locator('[data-pcc-view-mode-option="agent"]').last();
  if (
    options.profile !== "functionality-closure" &&
    options.profile !== "focus-live-interaction" &&
    (await agentMode.isVisible().catch(() => false))
  ) {
    await agentMode.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  await page.locator("[data-pcc-detail]").first().waitFor({ state: "visible", timeout: 45_000 });
  const workLoop = page.locator("[data-pcc-work-loop]").first();
  const maintenanceHero = page.locator("[data-pcc-maintenance-hero]").first();
  const terminalProject = await maintenanceHero.isVisible().catch(() => false);
  if (!terminalProject) {
    await workLoop.waitFor({ state: "visible", timeout: 45_000 });
  }
  const truthLedger = page.locator(".pcc-production-truth__ledger summary").first();
  if ((await truthLedger.count()) > 0 && (await truthLedger.isVisible().catch(() => false))) {
    await truthLedger.click({ force: true });
  }
  let autofillPreviewOpened = false;
  if (options.profile === "usability-reliability") {
    const repairProject = projectCardForTitle("SNES Game Creator");
    if ((await repairProject.count()) > 0) {
      const openRepairProject = repairProject
        .locator("button", { hasText: /Open|Selected/ })
        .first();
      if (await openRepairProject.isVisible().catch(() => false)) {
        await openRepairProject.click({ force: true }).catch(() => undefined);
        await page
          .locator("[data-pcc-detail]")
          .first()
          .waitFor({ state: "visible", timeout: 45_000 });
      }
    }
    const setupRepair = page
      .getByRole("button", { name: /Fill missing setup with AI|Generate setup with AI/i })
      .first();
    if (await setupRepair.isVisible().catch(() => false)) {
      await setupRepair.click({ force: true });
      await page
        .getByText("AI Autofill Preview", { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: 45_000 });
      autofillPreviewOpened = true;
    }
    const visibleActionMenu = page.locator("[data-pcc-action-menu-trigger]:visible").first();
    if ((await visibleActionMenu.count()) > 0) {
      await visibleActionMenu.click({ force: true });
      await page
        .getByRole("menuitem", { name: "Remove from active plan" })
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    }
  }
  await page.waitForTimeout(2_000);
  const text = (await page.locator("body").textContent({ timeout: 45_000 })) ?? "";
  const normalizedText = text.replace(/\s+/g, " ");
  const lower = normalizedText.toLowerCase();
  const has = (needle: string) => lower.includes(needle.replace(/\s+/g, " ").toLowerCase());
  const portfolioConsoleCount = await page.locator("[data-pcc-portfolio-console]:visible").count();
  const result = {
    url: redactUrl(page.url()),
    title: await page.title(),
    appPresent: (await page.locator("openclaw-app").count()) > 0,
    fallback: await page
      .getByText("Control UI did not start")
      .first()
      .isVisible()
      .catch(() => false),
    authScreen: await page
      .getByText("Auth required")
      .first()
      .isVisible()
      .catch(() => false),
    clickedOpen: true,
    runtimeIdentity,
    dashboardManifest,
    selectors: {
      pccShell: await page.locator(".pcc-shell").count(),
      projectCards: await page.locator(".pcc-project-card").count(),
      detail: await page.locator("[data-pcc-detail]").count(),
      workLoop: await page.locator("[data-pcc-work-loop]").count(),
      workControls: await page.locator(".pcc-work-loop__controls").count(),
      portfolioConsole: portfolioConsoleCount,
      visibleActionMenus: await page.locator("[data-pcc-action-menu-trigger]:visible").count(),
    },
    checks: {
      pcc: has("Project Command Center"),
      productionTruth: has("Production truth"),
      dashboardCurrency: has("Is this dashboard current?"),
      resourcePolicy:
        portfolioConsoleCount === 0 || has("Policy: as many as safe") || has("as many as safe"),
      workThisProject:
        terminalProject || options.profile === "functionality-closure" || has("Work This Project"),
      stopAfterCurrent:
        terminalProject ||
        options.profile === "functionality-closure" ||
        has("Stop after current task"),
      stopBeforeDestructive:
        terminalProject ||
        options.profile === "functionality-closure" ||
        has("Stop before destructive actions"),
      productionCurrent: has("Current"),
      remoteProofPassed: has("Remote proof Passed") || has("Remote proof\nPassed"),
      runtimeProofPassed: has("Runtime proof Passed") || has("Runtime proof\nPassed"),
      noProofGaps: has("No proof gaps recorded."),
      workingNow: has("Working Now"),
      needsYou: has("Needs You"),
      portfolioProgress: has("Portfolio Progress"),
      setupRepair:
        options.profile === "production-current" ||
        options.profile === "functionality-closure" ||
        options.profile === "focus-live-interaction" ||
        has("Setup needs a few answers") ||
        has("Fill missing setup with AI") ||
        has("Generate setup with AI"),
      autofillPreview:
        options.profile === "production-current" ||
        !autofillPreviewOpened ||
        has("AI Autofill Preview"),
      actionMenu:
        options.profile === "production-current" ||
        options.profile === "functionality-closure" ||
        options.profile === "focus-live-interaction" ||
        (has("Remove from active plan") && has("Stop here")),
      completeState:
        options.profile !== "functionality-closure" ||
        (has("Project complete") && (has("Review Maintenance") || has("View details"))),
      reorderToggle: options.profile !== "functionality-closure" || has("Reorder milestones"),
      focusBar:
        options.profile !== "focus-live-interaction" ||
        (await page.locator("[data-pcc-project-focus-bar]:visible").count()) > 0,
      todaySummary:
        options.profile !== "focus-live-interaction" ||
        (await page.locator("[data-pcc-today-summary]:visible").count()) > 0,
      projectHero:
        options.profile !== "focus-live-interaction" ||
        (await page.locator("[data-pcc-project-hero]:visible").count()) > 0,
      proofBadge:
        options.profile !== "focus-live-interaction" ||
        (await page.locator("[data-pcc-project-hero] [data-pcc-proof-badge]:visible").count()) > 0,
      maintenanceHero:
        options.profile !== "focus-live-interaction" ||
        (await page.locator("[data-pcc-maintenance-hero]:visible").count()) > 0 ||
        has("Project complete"),
      topProofNotDominating:
        options.profile !== "focus-live-interaction" ||
        (await page.locator(".pcc-top-proof-drawer:visible").count()) === 0 ||
        has("Current proof:"),
      runtimeIdentity:
        !options.requireProductionCurrent ||
        (Boolean(runtimeIdentity.runtimeSha) &&
          (!runtimeIdentity.service || !runtimeIdentity.service.driftReason) &&
          (!options.expectedRuntimeSha ||
            runtimeIdentity.runtimeSha === options.expectedRuntimeSha)),
      dashboardManifest:
        dashboardManifest.ok &&
        REQUIRED_DASHBOARD_SURFACES.every((surface) => dashboardManifest.ids.includes(surface)),
    },
    sample: normalizedText.slice(0, 2_000),
  };
  await page.screenshot({ path: options.screenshotPath, fullPage: true });
  await browser.close();
  const { sample: _sample, ...safeResult } = result;
  const output = JSON.stringify({ ...safeResult, screenshot: options.screenshotPath }, null, 2);
  assertNoTokenLeak(output);
  console.log(output);
  const passed =
    result.title === "OpenClaw Control" &&
    result.appPresent &&
    !result.fallback &&
    !result.authScreen &&
    result.clickedOpen &&
    Object.entries(result.checks)
      .filter(([key]) => {
        if (options.profile === "production-current") {
          return (
            options.requireProductionCurrent ||
            ![
              "productionCurrent",
              "remoteProofPassed",
              "runtimeProofPassed",
              "noProofGaps",
            ].includes(key)
          );
        }
        return ![
          "productionTruth",
          "dashboardCurrency",
          "productionCurrent",
          "remoteProofPassed",
          "runtimeProofPassed",
          "noProofGaps",
        ].includes(key);
      })
      .every(([, value]) => value);
  if (!passed) {
    console.error("PCC proof text sample:", result.sample);
    process.exit(1);
  }
}

async function runSelfTest() {
  const redacted = redactUrl("http://127.0.0.1:18789/pcc#token=secret-token-123456");
  if (redacted.includes("secret-token")) {
    throw new Error("redaction self-test failed");
  }
  assertNoTokenLeak(redacted);
  let failed = false;
  try {
    resolveProofUrl({
      allowLocalTokenResolution: false,
      screenshotPath: "/tmp/unused.png",
      projectTitle: "Project Command Center",
      requireProductionCurrent: false,
      profile: "production-current",
    });
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error("missing-auth self-test failed");
  }
  const identity = await resolveRuntimeIdentity(process.cwd());
  if (identity.layout !== "unknown" && !identity.runtimeSha) {
    throw new Error("runtime identity self-test failed");
  }
  console.log("PCC production runtime auth proof self-test passed");
}

const options: ProofOptions = {
  authUrl: process.env.OPENCLAW_DASHBOARD_AUTH_URL,
  allowLocalTokenResolution: process.env.OPENCLAW_ALLOW_LOCAL_GATEWAY_TOKEN_RESOLUTION === "1",
  screenshotPath:
    process.env.OPENCLAW_PCC_PROOF_SCREENSHOT ??
    "/tmp/openclaw-dashboard-pcc-production-governor-auth-proof-final.png",
  projectTitle: process.env.OPENCLAW_PCC_PROOF_PROJECT_TITLE ?? "Project Command Center",
  requireProductionCurrent: process.env.OPENCLAW_PCC_REQUIRE_PRODUCTION_CURRENT === "1",
  expectedRuntimeSha: process.env.OPENCLAW_PCC_EXPECTED_RUNTIME_SHA,
  profile:
    process.env.OPENCLAW_PCC_PROOF_PROFILE === "usability-reliability"
      ? "usability-reliability"
      : process.env.OPENCLAW_PCC_PROOF_PROFILE === "functionality-closure"
        ? "functionality-closure"
        : process.env.OPENCLAW_PCC_PROOF_PROFILE === "focus-live-interaction"
          ? "focus-live-interaction"
          : "production-current",
};

if (process.env.OPENCLAW_PCC_AUTH_PROOF_SELF_TEST === "1") {
  void runSelfTest().catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(redactUrl(message));
    process.exit(1);
  });
} else {
  void runBrowserProof(options).catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(redactUrl(message));
    process.exit(1);
  });
}

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATEWAY_LAUNCH_AGENT_LABEL,
  resolveGatewayLaunchAgentLabel,
} from "../../src/daemon/constants.js";
import { readLaunchAgentProgramArgumentsFromFile } from "../../src/daemon/launchd-plist.js";
import {
  browserProofCheckId,
  PCC_BROWSER_CONTRACT_VERSION,
  proofProfileVersion,
  validateBrowserProofReceiptBinding,
  type ReleaseProofPhase,
} from "../../src/pcc/release-governance/browser-proof-contract.js";
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
  proofPhase: ReleaseProofPhase;
  proofProfileVersion: number;
  expectedCandidateSha?: string;
  expectedRuntimeSha?: string;
  receiptPath?: string;
  releaseProofProfile: "default" | "mac_studio_control_director";
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
  if (!identity.runtimeSha) {
    throw new Error(
      `phase-aware browser proof requires runtime identity, but ${identity.runtimeRoot} has neither .openclaw-production-sha nor snapshot.json source stamp`,
    );
  }
  const expected =
    options.proofPhase === "candidate"
      ? options.expectedCandidateSha?.trim()
      : options.expectedRuntimeSha?.trim();
  if (expected && identity.runtimeSha !== expected) {
    throw new Error(
      `${options.proofPhase} browser proof runtime SHA mismatch: expected ${expected}, got ${identity.runtimeSha}`,
    );
  }
  if (options.proofPhase === "candidate") {
    return;
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
    url: `http://127.0.0.1:${port}/pcc#token=${encodeURIComponent(token)}`,
    tokenLength: token.length,
  };
}

function resolveProofUrl(options: ProofOptions): { url: string; source: string } {
  if (options.authUrl) {
    const url = new URL(options.authUrl);
    url.pathname = "/pcc";
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

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writePrivateProofReceipt(filePath: string, value: Record<string, unknown>): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the actionable receipt error.
    }
    throw error;
  }
}

async function waitForPccReady(page: import("playwright").Page): Promise<void> {
  await page.locator("[data-pcc-shell]").first().waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(
    (contractVersion) => {
      const root = document.querySelector<HTMLElement>("[data-pcc-shell]");
      return (
        root?.dataset.pccContractVersion === contractVersion && root.dataset.pccReady === "ready"
      );
    },
    PCC_BROWSER_CONTRACT_VERSION,
    { timeout: 45_000 },
  );
}

async function waitForPccSurface(
  page: import("playwright").Page,
  surface: "overview" | "projects" | "activity" | "system" | "project",
): Promise<void> {
  await page
    .locator(`[data-pcc-shell][data-pcc-surface="${surface}"]`)
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
  await waitForPccReady(page);
}

async function runBrowserProof(options: ProofOptions): Promise<void> {
  const { chromium } = await import("playwright");
  const runtimeIdentity = await resolveRuntimeIdentity();
  const expectedCandidateSha = options.expectedCandidateSha?.trim();
  if (!expectedCandidateSha) {
    throw new Error("phase-aware browser proof requires an exact candidate SHA");
  }
  if (options.proofPhase === "post_deployment" && !options.expectedRuntimeSha?.trim()) {
    throw new Error("post-deployment browser proof requires an exact active-runtime SHA");
  }
  assertRuntimeIdentity(options, runtimeIdentity);
  const canonicalProfileVersion = proofProfileVersion(options.releaseProofProfile);
  if (options.proofProfileVersion !== canonicalProfileVersion) {
    throw new Error(
      `browser proof profile version drift: expected ${canonicalProfileVersion}, got ${options.proofProfileVersion}`,
    );
  }
  const resolved = resolveProofUrl(options);
  console.log(`DASH_URL_OK=${redactUrl(resolved.url)}`);

  const consoleErrors: string[] = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OPENCLAW_PCC_PROOF_CHROME_PATH ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let result: Record<string, unknown> | null = null;

  try {
    await page.goto(resolved.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForPccReady(page);
    const shell = page.locator("[data-pcc-shell]").first();
    const contractVersion = await shell.getAttribute("data-pcc-contract-version");
    const initialRevision = await shell.getAttribute("data-pcc-ledger-revision");
    if (!/^\d+$/u.test(initialRevision ?? "")) {
      throw new Error("PCC readiness did not expose a numeric ledger revision");
    }

    const dashboardManifest = await page.evaluate(async () => {
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
    });

    const navigation = page.locator('nav[aria-label="Project Command Center"]');
    const navigationLabels = await navigation.locator("button").allTextContents();
    const expectedNavigation = ["Overview", "Projects", "Activity", "System"];
    const navigationChecks = expectedNavigation.map((label) =>
      navigationLabels.some((value) => value.trim() === label),
    );
    if (navigationChecks.some((value) => !value)) {
      throw new Error(`PCC navigation contract is incomplete: ${navigationLabels.join(" | ")}`);
    }
    const clickNavigation = async (label: "Overview" | "Projects" | "Activity" | "System") => {
      await navigation.getByRole("button", { name: label, exact: true }).click({ force: true });
      await waitForPccSurface(
        page,
        label.toLowerCase() as "overview" | "projects" | "activity" | "system",
      );
    };

    await clickNavigation("Overview");
    const overview = page.locator("[data-pcc-work-overview]").first();
    await overview.waitFor({ state: "visible", timeout: 45_000 });
    const overviewProjectCount = await page.locator("[data-pcc-overview-project]").count();
    const overviewText = ((await overview.textContent()) ?? "").replace(/\s+/gu, " ");

    await clickNavigation("Projects");
    const directory = page.locator("[data-pcc-projects-directory]").first();
    await directory.waitFor({ state: "visible", timeout: 45_000 });
    const filterLabels = ["Active", "Needs You", "On Hold", "Completed", "Archived", "All"];
    const filterTexts = await directory.locator("[data-pcc-project-tabs] button").allTextContents();
    const filterChecks = filterLabels.map((label) =>
      filterTexts.some((value) => new RegExp(`^${label}\\b`, "u").test(value.trim())),
    );
    if (filterChecks.some((value) => !value)) {
      throw new Error(`PCC project-filter contract is incomplete: ${filterTexts.join(" | ")}`);
    }
    const allFilter = directory
      .locator("[data-pcc-project-tabs] button")
      .filter({ hasText: /^All\b/u });
    await allFilter.click({ force: true });
    await waitForPccReady(page);
    const directoryCount = await directory.locator("[data-pcc-overview-project]").count();
    if (directoryCount < overviewProjectCount) {
      throw new Error(
        `PCC project visibility regressed from ${overviewProjectCount} to ${directoryCount} after All filter`,
      );
    }
    await clickNavigation("Activity");
    const activityPresent = (await page.locator("[data-pcc-activity-directory]").count()) > 0;
    await clickNavigation("System");
    const systemPresent = (await page.locator("[data-pcc-system-overview]").count()) > 0;

    let projectSelected = false;
    if (options.projectTitle === "Project Command Center") {
      await page
        .getByRole("button", { name: "Open system record", exact: true })
        .click({ force: true });
    } else {
      await clickNavigation("Overview");
      let card = page
        .locator("[data-pcc-overview-project]")
        .filter({ hasText: options.projectTitle })
        .first();
      if ((await card.count()) === 0) {
        await clickNavigation("Projects");
        await allFilter.click({ force: true });
        await waitForPccReady(page);
        card = page
          .locator("[data-pcc-overview-project]")
          .filter({ hasText: options.projectTitle })
          .first();
      }
      await card.waitFor({ state: "visible", timeout: 45_000 });
      await card.getByRole("button", { name: "Open project", exact: true }).click({ force: true });
    }
    await waitForPccSurface(page, "project");
    await page
      .locator("[data-pcc-project-workspace]")
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    await page
      .locator(`[data-pcc-detail-project-title="${options.projectTitle}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    projectSelected = true;
    const afterProjectRevision = await page
      .locator("[data-pcc-shell]")
      .first()
      .getAttribute("data-pcc-ledger-revision");
    if (
      !/^\d+$/u.test(afterProjectRevision ?? "") ||
      Number(afterProjectRevision) < Number(initialRevision)
    ) {
      throw new Error("PCC ledger revision regressed during project navigation");
    }
    await page.getByRole("button", { name: "← Overview", exact: true }).click({ force: true });
    await waitForPccSurface(page, "overview");
    const finalOverviewCount = await page.locator("[data-pcc-overview-project]").count();
    if (finalOverviewCount < overviewProjectCount) {
      throw new Error("PCC cached-to-live convergence hid an overview project after navigation");
    }

    await clickNavigation("System");
    const truth = page.locator("[data-pcc-production-truth]").first();
    await truth.waitFor({ state: "visible", timeout: 45_000 });
    const truthProfile = await truth.getAttribute("data-pcc-production-truth-profile");
    const truthSource = await truth.getAttribute("data-pcc-production-proof-source");
    const truthCurrent = await truth.getAttribute("data-pcc-production-current");
    const truthRuntime = await truth.getAttribute("data-pcc-runtime-proof");
    const truthGaps = await truth.getAttribute("data-pcc-proof-gaps");
    const truthText = ((await truth.textContent()) ?? "").replace(/\s+/gu, " ");
    const title = await page.title();
    const appPresent = (await page.locator("openclaw-app").count()) > 0;
    const fallback =
      (await page.getByText("Control UI did not start", { exact: false }).count()) > 0;
    const authScreen =
      (await page.getByText("unauthorized", { exact: false }).count()) > 0 ||
      (await page.getByText("token required", { exact: false }).count()) > 0;
    const localProfile = options.releaseProofProfile === "mac_studio_control_director";
    const forbiddenClaim =
      /remote proof\s*[:-]?\s*(passed|success|verified)|mobile proof\s*[:-]?\s*(passed|success|verified)/iu.test(
        truthText,
      );
    const postDeployment =
      options.proofPhase !== "post_deployment" ||
      (truthCurrent === "true" && truthRuntime === "passed" && truthGaps === "0");
    const defaultRemote =
      localProfile || /remote proof\s*[:-]?\s*(passed|success|verified)/iu.test(truthText);

    fs.mkdirSync(path.dirname(options.screenshotPath), { recursive: true, mode: 0o700 });
    await page.screenshot({ path: options.screenshotPath, fullPage: true });
    const receipt = {
      schema: "openclaw.release-local-proof.v2",
      candidateSha: expectedCandidateSha,
      proofProfile: options.releaseProofProfile,
      proofProfileVersion: options.proofProfileVersion,
      proofPhase: options.proofPhase,
      activeRuntimeSha:
        options.proofPhase === "post_deployment" ? runtimeIdentity.runtimeSha : null,
      checkId:
        browserProofCheckId(options.releaseProofProfile, options.proofPhase) ??
        `authenticated_${options.proofPhase}_pcc_browser`,
      command: process.argv.map(redactUrl).join(" "),
      verifierSha256: sha256File(fileURLToPath(import.meta.url)),
      browserArtifactSha256: sha256File(options.screenshotPath),
      result: "passed" as const,
    };
    const receiptBindingErrors = validateBrowserProofReceiptBinding(receipt);
    const cdp = await page.context().newCDPSession(page);
    const axTree = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes?: Array<{ ignored?: boolean; role?: { value?: unknown }; name?: { value?: unknown } }>;
    };
    const interactiveRoles = new Set([
      "button",
      "checkbox",
      "combobox",
      "link",
      "menuitem",
      "radio",
      "switch",
      "tab",
      "textbox",
    ]);
    const unnamedInteractiveNodes = (axTree.nodes ?? []).filter((node) => {
      const role = typeof node.role?.value === "string" ? node.role.value : "";
      const name = typeof node.name?.value === "string" ? node.name.value.trim() : "";
      return !node.ignored && interactiveRoles.has(role) && !name;
    });
    const checks = {
      title: title === "OpenClaw Control",
      appPresent,
      notFallback: !fallback,
      notAuthScreen: !authScreen,
      exactCandidate: runtimeIdentity.runtimeSha === expectedCandidateSha,
      postDeploymentIdentity:
        options.proofPhase !== "post_deployment" ||
        runtimeIdentity.runtimeSha === options.expectedRuntimeSha,
      receiptBinding: receiptBindingErrors.length === 0,
      contractVersion: contractVersion === PCC_BROWSER_CONTRACT_VERSION,
      ready: (await shell.getAttribute("data-pcc-ready")) === "ready",
      navigation: navigationChecks.every(Boolean),
      overview: overviewText.includes("Working Now") && overviewText.includes("Active Projects"),
      projectFilters: filterChecks.every(Boolean),
      projectVisibility:
        directoryCount >= overviewProjectCount && finalOverviewCount >= overviewProjectCount,
      projectSelection: projectSelected,
      activity: activityPresent,
      system: systemPresent,
      ledgerRevision: /^\d+$/u.test(afterProjectRevision ?? ""),
      profile: truthProfile === options.releaseProofProfile,
      localSource: !localProfile || truthSource === "local",
      noForbiddenRemoteClaim: !localProfile || !forbiddenClaim,
      postDeployment,
      defaultRemote,
      manifest:
        dashboardManifest.ok &&
        REQUIRED_DASHBOARD_SURFACES.every((surface) => dashboardManifest.ids.includes(surface)),
      noConsoleErrors: consoleErrors.length === 0,
      noHorizontalOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      authoritativeAccessibilityTree: unnamedInteractiveNodes.length === 0,
    };
    const failedChecks = Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    result = {
      schema: "openclaw.pcc-browser-proof.v2",
      phase: options.proofPhase,
      proofProfile: options.releaseProofProfile,
      proofProfileVersion: options.proofProfileVersion,
      checkId: receipt.checkId,
      url: redactUrl(page.url()),
      title,
      appPresent,
      fallback,
      authScreen,
      runtimeIdentity,
      dashboardManifest,
      checks,
      consoleErrors: consoleErrors.length,
      unnamedInteractiveNodes: unnamedInteractiveNodes.length,
      ledgerRevision: afterProjectRevision,
      passed: failedChecks.length === 0,
      failedChecks,
    };
    if (failedChecks.length > 0) {
      throw new Error(`PCC ${options.proofPhase} browser proof failed: ${failedChecks.join(", ")}`);
    }
    const receiptPath =
      options.receiptPath ??
      path.join(
        os.tmpdir(),
        `openclaw-pcc-browser-proof-${options.proofPhase}-${process.pid}.json`,
      );
    writePrivateProofReceipt(receiptPath, receipt);
    result.receiptPath = receiptPath;
    result.receipt = receipt;
  } finally {
    await browser.close();
  }
  if (!result) {
    throw new Error("PCC browser proof did not produce a result");
  }
  const output = JSON.stringify(result, null, 2);
  assertNoTokenLeak(output);
  console.log(output);
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
      proofPhase: "candidate",
      proofProfileVersion: proofProfileVersion("default"),
      releaseProofProfile: "default",
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
  proofPhase:
    process.env.OPENCLAW_PCC_PROOF_PHASE === "candidate" ? "candidate" : "post_deployment",
  proofProfileVersion: Number.parseInt(
    process.env.OPENCLAW_PCC_PROOF_PROFILE_VERSION ??
      String(
        proofProfileVersion(
          process.env.OPENCLAW_PCC_RELEASE_PROOF_PROFILE === "mac_studio_control_director"
            ? "mac_studio_control_director"
            : "default",
        ),
      ),
    10,
  ),
  expectedCandidateSha: process.env.OPENCLAW_PCC_EXPECTED_CANDIDATE_SHA,
  expectedRuntimeSha: process.env.OPENCLAW_PCC_EXPECTED_RUNTIME_SHA,
  receiptPath: process.env.OPENCLAW_PCC_PROOF_RECEIPT,
  releaseProofProfile:
    process.env.OPENCLAW_PCC_RELEASE_PROOF_PROFILE === "mac_studio_control_director"
      ? "mac_studio_control_director"
      : "default",
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

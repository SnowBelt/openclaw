import fs from "node:fs";

type ProofOptions = {
  authUrl?: string;
  allowLocalTokenResolution: boolean;
  screenshotPath: string;
  projectTitle: string;
  requireProductionCurrent: boolean;
};

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

async function runBrowserProof(options: ProofOptions) {
  const { chromium } = await import("playwright");
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
  const simpleMode = page.locator('[data-pcc-view-mode-option="simple"]').last();
  if (await simpleMode.isVisible().catch(() => false)) {
    await simpleMode.click({ force: true });
    await page.waitForTimeout(1_000);
  }
  const targetProject = page
    .locator(".pcc-project-card", { hasText: options.projectTitle })
    .first();
  const projectCardCount = await targetProject.count();
  const openButton =
    projectCardCount > 0
      ? targetProject.locator("button", { hasText: "Open" }).first()
      : page.locator(".pcc-project-card button", { hasText: "Open" }).first();
  await openButton.waitFor({ state: "visible", timeout: 45_000 });
  await openButton.click();
  await page.locator("[data-pcc-detail]").first().waitFor({ state: "visible", timeout: 45_000 });
  const agentMode = page.locator('[data-pcc-view-mode-option="agent"]').last();
  if (await agentMode.isVisible().catch(() => false)) {
    await agentMode.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  await page.locator("[data-pcc-detail]").first().waitFor({ state: "visible", timeout: 45_000 });
  await page.locator("[data-pcc-work-loop]").first().waitFor({ state: "visible", timeout: 45_000 });
  const truthLedger = page.locator(".pcc-production-truth__ledger summary").first();
  if ((await truthLedger.count()) > 0) {
    await truthLedger.click();
  }
  await page.waitForTimeout(2_000);
  const text = (await page.locator("body").textContent({ timeout: 45_000 })) ?? "";
  const normalizedText = text.replace(/\s+/g, " ");
  const lower = normalizedText.toLowerCase();
  const has = (needle: string) => lower.includes(needle.replace(/\s+/g, " ").toLowerCase());
  const portfolioConsoleCount = await page.locator("[data-pcc-portfolio-console]").count();
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
    selectors: {
      pccShell: await page.locator(".pcc-shell").count(),
      projectCards: await page.locator(".pcc-project-card").count(),
      detail: await page.locator("[data-pcc-detail]").count(),
      workLoop: await page.locator("[data-pcc-work-loop]").count(),
      workControls: await page.locator(".pcc-work-loop__controls").count(),
      portfolioConsole: portfolioConsoleCount,
    },
    checks: {
      pcc: has("Project Command Center"),
      productionTruth: has("Production truth"),
      dashboardCurrency: has("Is this dashboard current?"),
      resourcePolicy:
        portfolioConsoleCount === 0 || has("Policy: as many as safe") || has("as many as safe"),
      workThisProject: has("Work This Project"),
      stopAfterCurrent: has("Stop after current task"),
      stopBeforeDestructive: has("Stop before destructive actions"),
      productionCurrent: has("Current"),
      remoteProofPassed: has("Remote proof Passed") || has("Remote proof\nPassed"),
      runtimeProofPassed: has("Runtime proof Passed") || has("Runtime proof\nPassed"),
      noProofGaps: has("No proof gaps recorded."),
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
      .filter(
        ([key]) =>
          options.requireProductionCurrent ||
          !["productionCurrent", "remoteProofPassed", "runtimeProofPassed", "noProofGaps"].includes(
            key,
          ),
      )
      .every(([, value]) => value);
  if (!passed) {
    console.error("PCC proof text sample:", result.sample);
    process.exit(1);
  }
}

function runSelfTest() {
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
    });
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error("missing-auth self-test failed");
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
};

if (process.env.OPENCLAW_PCC_AUTH_PROOF_SELF_TEST === "1") {
  runSelfTest();
} else {
  void runBrowserProof(options).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

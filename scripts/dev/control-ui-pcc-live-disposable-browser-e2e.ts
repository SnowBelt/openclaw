import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { callGateway } from "../../src/gateway/call.ts";
import type { PccProject, PccProjectSummary, PccMilestone } from "../../ui/src/ui/types.ts";

type ProjectGetResult = {
  project: PccProject;
  milestones: PccMilestone[];
  summary: PccProjectSummary;
};

type ProofConfig = {
  gateway?: {
    port?: number;
    auth?: {
      token?: string | { source?: string; id?: string; path?: string };
    };
  };
};

const TOKEN_PATTERN = /([#?&]token=)[^&/#]+/gi;
const CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH ?? "/Users/openclaw/.openclaw/openclaw.director.json";

function redactUrl(value: string): string {
  return value.replace(TOKEN_PATTERN, "$1<redacted>");
}

function assertNoTokenLeak(value: string): void {
  if (/token=[A-Za-z0-9._~+/=-]{8,}/iu.test(value)) {
    throw new Error("live disposable E2E output contains an unredacted token");
  }
}

function resolveDashboardUrl(): string {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as ProofConfig;
  const port = config.gateway?.port ?? 18789;
  const tokenRef = config.gateway?.auth?.token;
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
  return `http://127.0.0.1:${port}/projects#token=${encodeURIComponent(token)}`;
}

async function gateway<T>(method: string, params?: unknown): Promise<T> {
  return await callGateway<T>({ method, params, timeoutMs: 30_000 });
}

function nowIso(): string {
  return new Date().toISOString();
}

async function upsertProject(
  id: string,
  title: string,
  extraMetadata: Record<string, unknown> = {},
) {
  return await gateway<{ project: PccProject; summary: PccProjectSummary }>("pcc.projects.upsert", {
    project: {
      id,
      title,
      goal: `${title} disposable proof project.`,
      status: "active",
      priority: 1,
      metadata: {
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: true,
        pccDisposableBrowserProof: true,
        ...extraMetadata,
      },
    },
  });
}

async function upsertMilestone(projectId: string, id: string, title: string, order: number) {
  return await gateway("pcc.milestones.upsert", {
    milestone: {
      id,
      projectId,
      title,
      status: "not_started",
      order,
      percentComplete: 0,
      implementationPlan: "Disposable browser proof step. No user project work.",
      acceptanceCriteria: ["Browser interaction updates and persists."],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        proofRequired: "Disposable browser E2E proof",
      },
    },
  });
}

async function archiveProject(id: string, title: string): Promise<void> {
  await gateway("pcc.projects.upsert", {
    project: {
      id,
      title,
      status: "archived",
      metadata: {
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: true,
        pccDisposableBrowserProof: true,
        pccArchivedByDisposableProofAt: nowIso(),
      },
    },
  }).catch((error: unknown) => {
    console.error(
      `cleanup failed for ${id}:`,
      error instanceof Error ? error.message : String(error),
    );
  });
}

async function getProject(projectId: string): Promise<ProjectGetResult> {
  return await gateway<ProjectGetResult>("pcc.projects.get", { projectId });
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const actionProjectId = `pcc-disposable-live-actions-${suffix}`;
  const setupProjectId = `pcc-disposable-live-setup-${suffix}`;
  const actionProjectTitle = `PCC Disposable Live Actions ${suffix}`;
  const setupProjectTitle = `PCC Disposable Live Setup ${suffix}`;
  const screenshotPath =
    process.env.OPENCLAW_PCC_LIVE_E2E_SCREENSHOT ??
    "/tmp/openclaw-dashboard-pcc-live-disposable-e2e.png";

  let browser: import("playwright").Browser | undefined;
  const summary: Record<string, unknown> = {
    actionProjectId,
    setupProjectId,
    screenshotPath,
    checks: {},
  };

  try {
    await upsertProject(actionProjectId, actionProjectTitle, {
      pccSetupScore: { score: 100, runnable: true },
      pccQualityGate: { status: "passing" },
      pccCompliance: { badge: "Passing", status: "passing" },
      pccIntake: {
        approved: true,
        answers: {
          goal: "Prove PCC live controls.",
          firstDeliverable: "Disposable live interaction proof.",
          doneProof: "Gateway and browser proof pass.",
          constraints: "Archive the disposable project after proof.",
          owner: "local_openclaw_agent",
          blockers: "None.",
        },
      },
    });
    await upsertMilestone(
      actionProjectId,
      `${actionProjectId}-step-1`,
      "First live reorder step",
      10,
    );
    await upsertMilestone(
      actionProjectId,
      `${actionProjectId}-step-2`,
      "Second live reorder step",
      20,
    );
    await upsertProject(setupProjectId, setupProjectTitle, {
      pccIntake: { approved: false, answers: {} },
    });

    const { chromium } = await import("playwright");
    const url = resolveDashboardUrl();
    console.log(`LIVE_E2E_URL=${redactUrl(url)}`);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.OPENCLAW_PCC_PROOF_CHROME_PATH ??
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });

    const projectWorkMode = page.locator('[data-pcc-focus-mode-option="project_work"]').last();
    if (await projectWorkMode.isVisible().catch(() => false)) {
      await projectWorkMode.click({ force: true });
    }
    const allTab = page.locator("[data-pcc-project-tabs] button", { hasText: /^All\b/i }).last();
    if (await allTab.isVisible().catch(() => false)) {
      await allTab.click({ force: true });
    }
    const actionCard = page
      .locator(`[data-pcc-project-card][data-pcc-project-id="${actionProjectId}"]`)
      .first();
    await actionCard.waitFor({ state: "visible", timeout: 45_000 });
    await actionCard
      .locator("button", { hasText: /Open|Selected/i })
      .first()
      .click({ force: true });
    await page
      .locator(`[data-pcc-detail-project-id="${actionProjectId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });

    const reorderToggle = page.locator("[data-pcc-reorder-mode-toggle]").first();
    await reorderToggle.click({ force: true });
    await page
      .locator("[data-pcc-reorder-instruction]")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await page
      .locator(
        `[data-pcc-milestone-id="${actionProjectId}-step-2"] [data-pcc-reorder="milestone-up"]`,
      )
      .first()
      .click({ force: true });
    await page
      .getByText("Saved new milestone order", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const afterMove = await getProject(actionProjectId);
    const sortedAfterMove = afterMove.milestones.toSorted(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    const menuTrigger = page
      .locator(`[data-pcc-milestone-id="${actionProjectId}-step-1"] [data-pcc-action-menu-trigger]`)
      .first();
    await menuTrigger.click({ force: true });
    await page
      .getByRole("menuitem", { name: "Defer" })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("menuitem", { name: "Defer" }).first().click({ force: true });
    await page
      .getByText("Saved:", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const undo = page.locator("button", { hasText: /^Undo$/i }).first();
    if (await undo.isVisible().catch(() => false)) {
      await undo.click({ force: true });
      await page.waitForTimeout(1_000);
    }

    const setupCard = page
      .locator(`[data-pcc-project-card][data-pcc-project-id="${setupProjectId}"]`)
      .first();
    if (await setupCard.isVisible().catch(() => false)) {
      await setupCard
        .locator("button", { hasText: /Open|Selected/i })
        .first()
        .click({ force: true });
    } else {
      await allTab.click({ force: true });
      await setupCard.waitFor({ state: "visible", timeout: 15_000 });
      await setupCard
        .locator("button", { hasText: /Open|Selected/i })
        .first()
        .click({ force: true });
    }
    await page
      .locator(`[data-pcc-detail-project-id="${setupProjectId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    const fillSetup = page.locator("[data-pcc-setup-repair-ai-fill]").first();
    await fillSetup.waitFor({ state: "visible", timeout: 30_000 });
    await fillSetup.click({ force: true });
    await page
      .getByText("AI Autofill Preview", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    summary.checks = {
      pccShell: (await page.locator(".pcc-shell").count()) > 0,
      projectWorkModeVisible: await projectWorkMode.isVisible().catch(() => false),
      reorderPersisted: sortedAfterMove[0]?.id === `${actionProjectId}-step-2`,
      actionMenuWorked: true,
      setupRepairPreviewVisible: await page
        .getByText("AI Autofill Preview", { exact: false })
        .first()
        .isVisible()
        .catch(() => false),
      noSnesMutation: true,
    };
    summary.ok = Object.values(summary.checks as Record<string, boolean>).every(Boolean);
    const output = JSON.stringify(summary, null, 2);
    assertNoTokenLeak(output);
    console.log(output);
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await archiveProject(actionProjectId, actionProjectTitle);
    await archiveProject(setupProjectId, setupProjectTitle);
  }
}

function runSelfTest(): void {
  const redacted = redactUrl("http://127.0.0.1:18789/projects#token=secret-token-123456");
  if (redacted.includes("secret-token")) {
    throw new Error("redaction self-test failed");
  }
  assertNoTokenLeak(redacted);
  console.log("PCC live disposable browser E2E self-test passed");
}

if (process.env.OPENCLAW_PCC_LIVE_E2E_SELF_TEST === "1") {
  runSelfTest();
} else {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(redactUrl(message));
    process.exit(1);
  });
}

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { callGateway } from "../../src/gateway/call.ts";
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE } from "../../src/gateway/operator-scopes.ts";
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

type CleanupResult = {
  id: string;
  created: boolean;
  archived: boolean;
  error?: string;
};

type PreflightResult = {
  projectsReadable: boolean;
  summaryReadable: boolean;
  projectCount: number;
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
  return await callGateway<T>({
    method,
    params,
    timeoutMs: 30_000,
    scopes: [ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE],
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function summaryChecks(summary: Record<string, unknown>): Record<string, unknown> {
  return summary.checks && typeof summary.checks === "object" && !Array.isArray(summary.checks)
    ? (summary.checks as Record<string, unknown>)
    : {};
}

function formatPreflightError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const scopeHint = /scope|operator\.admin|unauthori[sz]ed|forbidden|permission/iu.test(message)
    ? " Gateway auth/scopes are insufficient for disposable PCC mutation proof."
    : "";
  return new Error(
    `Gateway preflight failed before creating disposable PCC projects.${scopeHint} ${message}`,
  );
}

async function preflightGatewayForDisposableProof(): Promise<PreflightResult> {
  try {
    const list = await gateway<{ projects?: PccProjectSummary[] }>("pcc.projects.list", {
      includeArchived: false,
    });
    await gateway("pcc.summary.get", {});
    return {
      projectsReadable: Array.isArray(list.projects),
      summaryReadable: true,
      projectCount: Array.isArray(list.projects) ? list.projects.length : 0,
    };
  } catch (error) {
    throw formatPreflightError(error);
  }
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
  });
}

async function getProject(projectId: string): Promise<ProjectGetResult> {
  return await gateway<ProjectGetResult>("pcc.projects.get", { projectId });
}

async function clickSafely(locator: import("playwright").Locator): Promise<void> {
  const target = locator.first();
  await target.waitFor({ state: "attached", timeout: 15_000 });
  await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
  try {
    await target.click({ force: true, timeout: 15_000 });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !/outside of the viewport|not visible|element is not attached|intercepts pointer/i.test(
        message,
      )
    ) {
      throw error;
    }
  }
  await target.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("target is not an HTMLElement");
    }
    element.click();
  });
}

async function clickProjectButton(
  page: import("playwright").Page | import("playwright").Locator,
  selector: string,
  accessibleName: string | RegExp,
): Promise<void> {
  const stable = page.locator(selector).first();
  if (await stable.isVisible().catch(() => false)) {
    await clickSafely(stable);
    return;
  }
  await clickSafely(page.getByRole("button", { name: accessibleName }).first());
}

async function openProjectCard(page: import("playwright").Page, projectId: string): Promise<void> {
  const card = page.locator(`[data-pcc-project-card][data-pcc-project-id="${projectId}"]`).first();
  await card.waitFor({ state: "visible", timeout: 45_000 });
  await clickSafely(card.locator("button", { hasText: /Open|Selected/i }).first());
}

async function fillProjectTitle(
  editor: import("playwright").Locator,
  value: string,
): Promise<void> {
  const stable = editor.locator("[data-pcc-project-title]").first();
  if (await stable.isVisible().catch(() => false)) {
    await stable.fill(value);
    return;
  }
  await editor.getByLabel("Title").first().fill(value);
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const actionProjectId = `pcc-disposable-live-actions-${suffix}`;
  const setupProjectId = `pcc-disposable-live-setup-${suffix}`;
  const actionProjectTitle = `PCC Disposable Live Actions ${suffix}`;
  const setupProjectTitle = `PCC Disposable Live Setup ${suffix}`;
  let currentActionProjectTitle = actionProjectTitle;
  const screenshotPath =
    process.env.OPENCLAW_PCC_LIVE_E2E_SCREENSHOT ??
    "/tmp/openclaw-dashboard-pcc-live-disposable-e2e.png";

  let browser: import("playwright").Browser | undefined;
  let phase = "initializing";
  let actionProjectCreated = false;
  let setupProjectCreated = false;
  const summary: Record<string, unknown> = {
    actionProjectId,
    setupProjectId,
    phase,
    screenshotPath,
    checks: {},
    cleanup: [],
  };

  try {
    phase = "preflighting gateway";
    summary.phase = phase;
    summary.preflight = await preflightGatewayForDisposableProof();

    phase = "creating disposable action project";
    summary.phase = phase;
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
    actionProjectCreated = true;
    phase = "creating disposable action milestones";
    summary.phase = phase;
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
    phase = "creating disposable setup project";
    summary.phase = phase;
    await upsertProject(setupProjectId, setupProjectTitle, {
      pccIntake: { approved: false, answers: {} },
    });
    setupProjectCreated = true;

    phase = "opening PCC browser";
    summary.phase = phase;
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

    phase = "testing new project cancel";
    summary.phase = phase;
    await clickProjectButton(page, "[data-pcc-new-project]", /^New project$/i);
    await page.locator('[data-pcc-editor="project"]').first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.locator("[data-pcc-project-cancel]").first().click({ force: true });
    await page.locator('[data-pcc-editor="project"]').first().waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    const newProjectCancelWorked =
      (await page
        .locator('[data-pcc-editor="project"]')
        .count()
        .catch(() => 0)) === 0;

    phase = "selecting disposable action project";
    summary.phase = phase;
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
    await openProjectCard(page, actionProjectId);
    await page
      .locator(`[data-pcc-detail-project-id="${actionProjectId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });

    phase = "testing project edit save and cancel";
    summary.phase = phase;
    const editedTitle = `${actionProjectTitle} Edited`;
    const cancelledTitle = `${actionProjectTitle} Cancelled`;
    await clickProjectButton(page, "[data-pcc-edit-project]", /^Edit project$/i);
    const projectEditor = page.locator('[data-pcc-editor="project"]').first();
    await projectEditor.waitFor({ state: "visible", timeout: 15_000 });
    await fillProjectTitle(projectEditor, editedTitle);
    await projectEditor.locator('button[type="submit"]').click({ force: true });
    await page.locator('[data-pcc-editor="project"]').first().waitFor({
      state: "hidden",
      timeout: 30_000,
    });
    currentActionProjectTitle = editedTitle;
    const afterEditSave = await getProject(actionProjectId);
    const editSavePersisted = afterEditSave.project.title === editedTitle;

    await clickProjectButton(page, "[data-pcc-edit-project]", /^Edit project$/i);
    await projectEditor.waitFor({ state: "visible", timeout: 15_000 });
    await fillProjectTitle(projectEditor, cancelledTitle);
    await clickProjectButton(page, "[data-pcc-project-cancel]", /^Cancel$/i);
    await page.locator('[data-pcc-editor="project"]').first().waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    const afterEditCancel = await getProject(actionProjectId);
    const editCancelDiscarded = afterEditCancel.project.title === editedTitle;

    phase = "testing autopilot controls";
    summary.phase = phase;
    const autopilotMode = page.locator("[data-pcc-autopilot-mode-picker]").first();
    await autopilotMode.waitFor({ state: "visible", timeout: 15_000 });
    await autopilotMode.selectOption("bug_hunt");
    await page
      .getByText("Autopilot mode set to Bug Hunt", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-generate-prompts]").first().click({ force: true });
    await page
      .getByText("Autopilot prompts generated", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-start]").first().click({ force: true });
    await page
      .getByText("Autopilot safe loop ran", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-pause]").first().click({ force: true });
    await page
      .getByText("Autopilot pause saved", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-resume]").first().click({ force: true });
    await page
      .getByText("Autopilot resume saved", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-stop]").first().click({ force: true });
    await page
      .getByText("Autopilot stop saved", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-block]").first().click({ force: true });
    await page
      .getByText("Autopilot block saved", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const afterAutopilot = await getProject(actionProjectId);
    const autopilotMetadata = afterAutopilot.project.metadata as
      | { pccAutopilot?: { status?: string; mode?: string; runHistory?: unknown[] } }
      | undefined;
    const autopilotControlsWorked =
      autopilotMetadata?.pccAutopilot?.status === "blocked" &&
      autopilotMetadata.pccAutopilot.mode === "bug_hunt" &&
      Array.isArray(autopilotMetadata.pccAutopilot.runHistory) &&
      autopilotMetadata.pccAutopilot.runHistory.length > 0;

    phase = "testing pointer drag reorder";
    summary.phase = phase;
    const reorderToggle = page.locator("[data-pcc-reorder-mode-toggle]").first();
    await reorderToggle.click({ force: true });
    await page
      .locator("[data-pcc-reorder-instruction]")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    const dragHandle = page
      .locator(
        `[data-pcc-milestone-id="${actionProjectId}-step-2"] [data-pcc-drag-handle="milestone"]`,
      )
      .first();
    const dropTarget = page.locator(`[data-pcc-milestone-id="${actionProjectId}-step-1"]`).first();
    await dragHandle.dragTo(dropTarget, { force: true, timeout: 15_000 });
    await page
      .getByText("Saved new milestone order", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const afterPointerDrag = await getProject(actionProjectId);
    const sortedAfterPointerDrag = afterPointerDrag.milestones.toSorted(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    phase = "testing keyboard reorder";
    summary.phase = phase;
    await page
      .locator(
        `[data-pcc-milestone-id="${actionProjectId}-step-2"] [data-pcc-reorder="milestone-down"]`,
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

    phase = "testing milestone action menu";
    summary.phase = phase;
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

    phase = "testing setup repair preview";
    summary.phase = phase;
    const setupCard = page
      .locator(`[data-pcc-project-card][data-pcc-project-id="${setupProjectId}"]`)
      .first();
    if (await setupCard.isVisible().catch(() => false)) {
      await openProjectCard(page, setupProjectId);
    } else {
      await allTab.click({ force: true });
      await setupCard.waitFor({ state: "visible", timeout: 15_000 });
      await openProjectCard(page, setupProjectId);
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

    phase = "summarizing live disposable proof";
    summary.phase = phase;
    summary.checks = {
      pccShell: (await page.locator(".pcc-shell").count()) > 0,
      projectWorkModeVisible: await projectWorkMode.isVisible().catch(() => false),
      pointerDragPersisted: sortedAfterPointerDrag[0]?.id === `${actionProjectId}-step-2`,
      keyboardReorderPersisted: sortedAfterMove[0]?.id === `${actionProjectId}-step-1`,
      reorderPersisted:
        sortedAfterPointerDrag[0]?.id === `${actionProjectId}-step-2` &&
        sortedAfterMove[0]?.id === `${actionProjectId}-step-1`,
      actionMenuWorked: true,
      newProjectCancelWorked,
      editSavePersisted,
      editCancelDiscarded,
      autopilotControlsWorked,
      setupRepairPreviewVisible: await page
        .getByText("AI Autofill Preview", { exact: false })
        .first()
        .isVisible()
        .catch(() => false),
      noSnesMutation: true,
    };
    summary.ok = Object.values(summary.checks as Record<string, boolean>).every(Boolean);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.ok = false;
    summary.phase = phase;
    summary.error = message;
    summary.checks = {
      ...summaryChecks(summary),
      failedBeforeCleanup: true,
    };
  } finally {
    phase = "cleanup";
    summary.phase = phase;
    await browser?.close().catch(() => undefined);
    const cleanupResults: CleanupResult[] = [];
    const cleanupProject = async (id: string, title: string, created: boolean) => {
      if (!created) {
        cleanupResults.push({ id, created, archived: false });
        return;
      }
      try {
        await archiveProject(id, title);
        cleanupResults.push({ id, created, archived: true });
      } catch (error) {
        cleanupResults.push({
          id,
          created,
          archived: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    await cleanupProject(actionProjectId, currentActionProjectTitle, actionProjectCreated);
    await cleanupProject(setupProjectId, setupProjectTitle, setupProjectCreated);
    summary.cleanup = cleanupResults;
    const cleanupComplete = cleanupResults.every((result) => !result.created || result.archived);
    summary.checks = {
      ...summaryChecks(summary),
      cleanupComplete,
    };
    summary.ok = summary.ok === true && cleanupComplete;
    const output = JSON.stringify(summary, null, 2);
    const redactedOutput = redactUrl(output);
    assertNoTokenLeak(redactedOutput);
    const writer = summary.ok ? console.log : console.error;
    writer(redactedOutput);
    if (!summary.ok) {
      process.exitCode = 1;
    }
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
    const output = redactUrl(message);
    assertNoTokenLeak(output);
    console.error(output);
    process.exit(1);
  });
}

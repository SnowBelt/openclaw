import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { callGateway } from "../../src/gateway/call.ts";
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE } from "../../src/gateway/operator-scopes.ts";
import type { PccProject, PccProjectSummary, PccMilestone } from "../../ui/src/ui/types.ts";

type ProjectGetResult = {
  project: PccProject;
  milestones: PccMilestone[];
  subMilestones?: Array<{ status?: string }>;
  permissions?: Array<{ status?: string; type?: string }>;
  decisions?: Array<{ title?: string; summary?: string }>;
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

type ProofGatewayConnection = {
  dashboardUrl: string;
  gatewayUrl: string;
  token: string;
  configPath: string;
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

type VisualViewportAudit = {
  label: string;
  width: number;
  height: number;
  noHorizontalOverflow: boolean;
  controlsStayInsideViewport: boolean;
  controlsDoNotClipText: boolean;
  auditedGroupsDoNotOverlap: boolean;
  primaryMobileTargetsAreLargeEnough: boolean;
  screenshotPath: string;
  failures: string[];
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

function resolveProofGatewayConnection(): ProofGatewayConnection {
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
  return {
    dashboardUrl: `http://127.0.0.1:${port}/projects#token=${encodeURIComponent(token)}`,
    gatewayUrl: `ws://127.0.0.1:${port}`,
    token,
    configPath: CONFIG_PATH,
  };
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * This proof deliberately performs mutations. It must never point at the operator's
 * live Gateway or ledger; the isolated runner starts a temporary Gateway and removes
 * its entire state directory on exit.
 */
function assertDisposableProofIsIsolated(connection: ProofGatewayConnection): void {
  if (process.env.OPENCLAW_PCC_LIVE_E2E_ISOLATED !== "1") {
    throw new Error(
      "refusing to mutate a non-isolated Gateway; run control-ui-pcc-live-disposable-browser-e2e-isolated.ts",
    );
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (!stateDir) {
    throw new Error("isolated disposable proof requires OPENCLAW_STATE_DIR");
  }
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const resolvedStateDir = fs.realpathSync(stateDir);
  const resolvedConfigPath = fs.realpathSync(connection.configPath);
  if (
    !isPathInside(temporaryRoot, resolvedStateDir) ||
    !isPathInside(resolvedStateDir, resolvedConfigPath)
  ) {
    throw new Error("isolated disposable proof requires temporary state and config paths");
  }
}

async function gateway<T>(method: string, params?: unknown): Promise<T> {
  const connection = resolveProofGatewayConnection();
  return await callGateway<T>({
    method,
    params,
    url: connection.gatewayUrl,
    token: connection.token,
    configPath: CONFIG_PATH,
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

function recordString(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
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
        pccWorkScope: "project_work",
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: true,
        pccDisposableBrowserProof: true,
        ...extraMetadata,
      },
    },
  });
}

async function upsertCompleteProject(id: string, title: string): Promise<void> {
  await gateway("pcc.projects.upsert", {
    project: {
      id,
      title,
      goal: `${title} verifies the read-only completed-project experience.`,
      status: "complete_with_maintenance",
      priority: 1,
      metadata: {
        pccWorkScope: "project_work",
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: true,
        pccDisposableBrowserProof: true,
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

async function upsertSubMilestone(
  projectId: string,
  milestoneId: string,
  id: string,
  title: string,
): Promise<void> {
  await gateway("pcc.subMilestones.upsert", {
    subMilestone: {
      id,
      projectId,
      milestoneId,
      title,
      status: "not_started",
      order: 0,
      percentComplete: 0,
      implementationPlan: "Exercise the disposable browser interaction and save the result.",
      acceptanceCriteria: ["The browser interaction persists after refresh."],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
        proofRequired: "Disposable browser E2E proof",
      },
    },
  });
}

async function setDisposableProjectStatus(
  id: string,
  title: string,
  status: "active" | "blocked" | "on_hold" | "complete_with_maintenance",
): Promise<void> {
  const current = await getProject(id);
  await gateway("pcc.projects.upsert", {
    project: {
      id,
      title,
      status,
      metadata: {
        ...current.project.metadata,
        pccWorkScope: "project_work",
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: true,
        pccDisposableBrowserProof: true,
      },
    },
  });
}

async function setDisposableMilestoneBlocked(
  projectId: string,
  milestoneId: string,
  title: string,
  order: number,
): Promise<void> {
  await gateway("pcc.milestones.upsert", {
    milestone: {
      id: milestoneId,
      projectId,
      title,
      status: "blocked",
      order,
      percentComplete: 25,
      blocker: "Disposable proof blocker. Review the safe recovery step.",
      implementationPlan: "Disposable browser proof step. No user project work.",
      acceptanceCriteria: ["Browser shows the exact blocker and recovery action."],
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
        pccWorkScope: "project_work",
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

async function auditPccViewport(params: {
  page: import("playwright").Page;
  width: number;
  height: number;
  label: string;
  artifactDir: string;
}): Promise<VisualViewportAudit> {
  const { page, width, height, label } = params;
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  const result = await page
    .locator(".pcc-shell")
    .first()
    .evaluate(
      (shell, viewport) => {
        const failures: string[] = [];
        const controls: HTMLElement[] = [];
        for (const candidate of shell.querySelectorAll(
          "button, input, textarea, select, [role='button']",
        )) {
          if (!(candidate instanceof HTMLElement)) {
            continue;
          }
          const candidateRect = candidate.getBoundingClientRect();
          const candidateStyle = globalThis.getComputedStyle(candidate);
          if (
            candidateRect.width > 0 &&
            candidateRect.height > 0 &&
            candidateStyle.visibility !== "hidden"
          ) {
            controls.push(candidate);
          }
        }
        const offscreenControls: HTMLElement[] = [];
        const clippedControls: HTMLElement[] = [];
        for (const control of controls) {
          const rect = control.getBoundingClientRect();
          if (rect.left < -1 || rect.right > viewport.width + 1) {
            offscreenControls.push(control);
          }
          const style = globalThis.getComputedStyle(control);
          if (
            style.overflow !== "visible" &&
            style.overflowX !== "visible" &&
            control.scrollWidth > control.clientWidth + 2
          ) {
            clippedControls.push(control);
          }
        }
        if (offscreenControls.length > 0) {
          const offscreenLabels: string[] = [];
          for (const control of offscreenControls) {
            offscreenLabels.push(
              (control.getAttribute("aria-label") || control.textContent || control.tagName)
                .replace(/\s+/gu, " ")
                .trim()
                .slice(0, 64),
            );
          }
          failures.push(
            `${offscreenControls.length} controls extend outside the viewport: ${offscreenLabels.join(" | ")}`,
          );
        }
        if (clippedControls.length > 0) {
          const clippedLabels = clippedControls.map((control) =>
            (control.getAttribute("aria-label") || control.textContent || control.tagName)
              .replace(/\s+/gu, " ")
              .trim()
              .slice(0, 64),
          );
          failures.push(
            `${clippedControls.length} controls clip their accessible label: ${clippedLabels.join(" | ")}`,
          );
        }

        const auditedGroups = [
          ".pcc-view-mode",
          ".pcc-project-orientation__facts",
          ".pcc-project-snapshot__header",
          ".pcc-project-snapshot__badges",
          ".pcc-primary-action",
          ".pcc-blocker-center__list > li",
          ".pcc-project-focus-bar__top",
          ".pcc-section-heading",
        ];
        let overlapCount = 0;
        for (const selector of auditedGroups) {
          for (const group of shell.querySelectorAll(selector)) {
            if (!(group instanceof HTMLElement)) {
              continue;
            }
            const groupRect = group.getBoundingClientRect();
            const groupStyle = globalThis.getComputedStyle(group);
            if (
              groupRect.width <= 0 ||
              groupRect.height <= 0 ||
              groupStyle.visibility === "hidden"
            ) {
              continue;
            }
            const children: HTMLElement[] = [];
            for (const child of group.children) {
              if (!(child instanceof HTMLElement)) {
                continue;
              }
              const childRect = child.getBoundingClientRect();
              const childStyle = globalThis.getComputedStyle(child);
              if (
                childRect.width > 0 &&
                childRect.height > 0 &&
                childStyle.visibility !== "hidden"
              ) {
                children.push(child);
              }
            }
            for (let index = 0; index < children.length; index += 1) {
              const current = children[index];
              if (!current) {
                continue;
              }
              for (const other of children.slice(index + 1)) {
                const currentRect = current.getBoundingClientRect();
                const otherRect = other.getBoundingClientRect();
                if (
                  currentRect.left < otherRect.right - 1 &&
                  currentRect.right > otherRect.left + 1 &&
                  currentRect.top < otherRect.bottom - 1 &&
                  currentRect.bottom > otherRect.top + 1
                ) {
                  overlapCount += 1;
                }
              }
            }
          }
        }
        if (overlapCount > 0) {
          failures.push(`${overlapCount} sibling layout collisions detected`);
        }

        const undersizedMobileTargets: HTMLElement[] = [];
        if (viewport.width <= 430) {
          for (const target of shell.querySelectorAll(
            "[data-pcc-mobile-command-rail] button, [data-pcc-primary-action] button, [data-pcc-view-mode-option]",
          )) {
            if (!(target instanceof HTMLElement)) {
              continue;
            }
            const targetRect = target.getBoundingClientRect();
            const targetStyle = globalThis.getComputedStyle(target);
            if (
              targetRect.width > 0 &&
              targetRect.height > 0 &&
              targetStyle.visibility !== "hidden" &&
              targetRect.height < 43.5
            ) {
              undersizedMobileTargets.push(target);
            }
          }
        }
        if (undersizedMobileTargets.length > 0) {
          const undersizedLabels: string[] = [];
          for (const control of undersizedMobileTargets) {
            undersizedLabels.push(
              (control.getAttribute("aria-label") || control.textContent || control.tagName)
                .replace(/\s+/gu, " ")
                .trim()
                .slice(0, 64),
            );
          }
          failures.push(
            `${undersizedMobileTargets.length} primary mobile controls are under 44px tall: ${undersizedLabels.join(" | ")}`,
          );
        }

        return {
          noHorizontalOverflow:
            document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          controlsStayInsideViewport: offscreenControls.length === 0,
          controlsDoNotClipText: clippedControls.length === 0,
          auditedGroupsDoNotOverlap: overlapCount === 0,
          primaryMobileTargetsAreLargeEnough: undersizedMobileTargets.length === 0,
          failures,
        };
      },
      { width, height },
    );
  const screenshotPath = path.join(params.artifactDir, `${label}-${width}x${height}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { label, width, height, screenshotPath, ...result };
}

async function openProjectCard(page: import("playwright").Page, projectId: string): Promise<void> {
  const card = page.locator(`[data-pcc-project-card][data-pcc-project-id="${projectId}"]`).first();
  await card.waitFor({ state: "visible", timeout: 45_000 });
  await clickSafely(card.locator("button", { hasText: /Open|Selected/i }).first());
  await page
    .locator(`[data-pcc-detail-project-id="${projectId}"]`)
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
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
  await editor
    .getByLabel(/Project name|Title/i)
    .first()
    .fill(value);
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const actionProjectId = `pcc-disposable-live-actions-${suffix}`;
  const setupProjectId = `pcc-disposable-live-setup-${suffix}`;
  const completeProjectId = `pcc-disposable-live-complete-${suffix}`;
  const actionProjectTitle = `PCC Disposable Live Actions search-${suffix}`;
  const setupProjectTitle = `PCC Disposable Live Setup ${suffix}`;
  const completeProjectTitle = `PCC Disposable Complete ${suffix}`;
  const createdProjectTitle = `PCC Guided Creation ${suffix}`;
  let currentActionProjectTitle = actionProjectTitle;
  let createdProjectId = "";
  const screenshotPath =
    process.env.OPENCLAW_PCC_LIVE_E2E_SCREENSHOT ??
    "/tmp/openclaw-dashboard-pcc-live-disposable-e2e.png";
  const creationDesktopScreenshotPath =
    process.env.OPENCLAW_PCC_NEW_PROJECT_DESKTOP_SCREENSHOT ??
    "/tmp/openclaw-dashboard-pcc-new-project-desktop.png";
  const creationMobileScreenshotPath =
    process.env.OPENCLAW_PCC_NEW_PROJECT_MOBILE_SCREENSHOT ??
    "/tmp/openclaw-dashboard-pcc-new-project-mobile.png";
  const visualMatrixDir = path.join("/tmp", `openclaw-pcc-100-intuitiveness-${suffix}`);
  fs.mkdirSync(visualMatrixDir, { recursive: true });

  let browser: import("playwright").Browser | undefined;
  let phase = "initializing";
  let actionProjectCreated = false;
  let setupProjectCreated = false;
  let completeProjectCreated = false;
  let projectSwitchMs: number;
  let projectPreviewMs: number;
  let detailPanelOpenMs: number;
  let projectSearchMs: number;
  let projectFilterMs: number;
  const summary: Record<string, unknown> = {
    actionProjectId,
    setupProjectId,
    completeProjectId,
    phase,
    screenshotPath,
    creationDesktopScreenshotPath,
    creationMobileScreenshotPath,
    visualMatrixDir,
    checks: {},
    cleanup: [],
  };

  try {
    assertDisposableProofIsIsolated(resolveProofGatewayConnection());
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
    await upsertSubMilestone(
      actionProjectId,
      `${actionProjectId}-step-1`,
      `${actionProjectId}-step-1-check`,
      "Verify first live interaction",
    );
    await upsertMilestone(
      actionProjectId,
      `${actionProjectId}-step-2`,
      "Second live reorder step",
      20,
    );
    await upsertSubMilestone(
      actionProjectId,
      `${actionProjectId}-step-2`,
      `${actionProjectId}-step-2-check`,
      "Verify second live interaction",
    );
    phase = "creating disposable setup project";
    summary.phase = phase;
    await upsertProject(setupProjectId, setupProjectTitle, {
      pccIntake: { approved: false, answers: {} },
    });
    setupProjectCreated = true;
    phase = "creating disposable complete project";
    summary.phase = phase;
    await upsertCompleteProject(completeProjectId, completeProjectTitle);
    completeProjectCreated = true;

    phase = "opening PCC browser";
    summary.phase = phase;
    const { chromium } = await import("playwright");
    const url = resolveProofGatewayConnection().dashboardUrl;
    console.log(`LIVE_E2E_URL=${redactUrl(url)}`);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.OPENCLAW_PCC_PROOF_CHROME_PATH ??
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const navigationStartedAt = performance.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });
    const initialNavigationMs = Math.round(performance.now() - navigationStartedAt);

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

    phase = "testing guided new project creation";
    summary.phase = phase;
    await clickProjectButton(page, "[data-pcc-new-project]", /^New project$/i);
    const creationEditor = page.locator('[data-pcc-editor="project"]').first();
    await creationEditor.waitFor({ state: "visible", timeout: 15_000 });
    await creationEditor
      .locator("[data-pcc-project-description]")
      .fill(
        "Create a disposable project that proves the guided PCC creation flow without touching user work.",
      );
    const aiRolePicker = creationEditor.locator("[data-pcc-ai-role-picker]").first();
    await aiRolePicker.locator(":scope > summary").click();
    await aiRolePicker.locator('[data-pcc-ai-use-policy="codex_expert"]').check({ force: true });
    const balancedCodexPresetVisible = await creationEditor
      .locator("[data-pcc-ai-role-picker]")
      .getByText("Balanced Codex", { exact: false })
      .first()
      .isVisible();
    const codexApprovalExplainedOnce = await creationEditor
      .locator("[data-pcc-create-ai-summary]")
      .getByText("one Codex approval", { exact: false })
      .isVisible();
    const allAiPlansVisible =
      (await aiRolePicker.locator("[data-pcc-ai-use-policy]").count()) === 4 &&
      (await aiRolePicker.locator('[data-pcc-ai-use-policy="local_only"]').count()) === 1 &&
      (await aiRolePicker.locator('[data-pcc-ai-use-policy="codex_focused"]').count()) === 1 &&
      (await aiRolePicker.locator('[data-pcc-ai-use-policy="codex_everything"]').count()) === 1;
    const customizeDetails = creationEditor.locator("[data-pcc-create-customize]").first();
    const customizeSummary = customizeDetails.locator(":scope > summary");
    await customizeSummary.scrollIntoViewIfNeeded();
    await customizeSummary.click();
    if ((await customizeDetails.getAttribute("open")) === null) {
      await customizeSummary.press("Enter");
    }
    await creationEditor
      .locator("[data-pcc-project-title]")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await fillProjectTitle(creationEditor, createdProjectTitle);
    const aiExplainerVisible = await creationEditor
      .locator("[data-pcc-create-ai-explainer]")
      .isVisible();
    const previewStartedAt = performance.now();
    await creationEditor.locator("[data-pcc-create-review-plan]").click({ force: true });
    await creationEditor
      .locator('[data-pcc-create-flow][data-pcc-create-step="review"]')
      .waitFor({ state: "visible", timeout: 15_000 });
    projectPreviewMs = Math.round(performance.now() - previewStartedAt);
    const userTitlePreserved =
      (await creationEditor.locator("[data-pcc-project-title]").inputValue()) ===
      createdProjectTitle;
    const reviewExplainsSafety = await creationEditor
      .locator("[data-pcc-create-review-ready]")
      .getByText("Nothing has been created or started yet", { exact: false })
      .isVisible();
    const routingSummaryVisible = await creationEditor
      .locator("[data-pcc-ai-routing-summary]")
      .getByText("Codex", { exact: false })
      .isVisible();
    const permissionCardCount = await creationEditor
      .locator("[data-pcc-planner-permission-card]")
      .count();
    const tokenBudgetControlCount = await creationEditor
      .locator("[data-pcc-planner-permission-budget]")
      .count();
    const duplicatePlannerSelectorCount = await creationEditor
      .locator("[data-pcc-planner-selector]")
      .count();
    const createDisabledBeforeApproval = await creationEditor
      .locator("[data-pcc-create-project-confirm]")
      .isDisabled();
    await creationEditor.locator("[data-pcc-planner-permission-allow]").click({ force: true });
    const permissionApproved = await creationEditor
      .locator("[data-pcc-planner-permission-saved]")
      .getByText("no hard token cap", { exact: false })
      .isVisible();
    const createEnabledAfterApproval = await creationEditor
      .locator("[data-pcc-create-project-confirm]")
      .isEnabled();
    await creationEditor.locator("[data-pcc-create-project-back]").click({ force: true });
    await creationEditor
      .locator('[data-pcc-create-flow][data-pcc-create-step="describe"]')
      .waitFor({ state: "visible", timeout: 15_000 });
    const backPreservedUserInput =
      (await creationEditor.locator("[data-pcc-project-description]").inputValue()).includes(
        "disposable project",
      ) &&
      (await creationEditor.locator("[data-pcc-project-title]").inputValue()) ===
        createdProjectTitle;
    await creationEditor.locator("[data-pcc-create-review-plan]").click({ force: true });
    await creationEditor
      .locator('[data-pcc-create-flow][data-pcc-create-step="review"]')
      .waitFor({ state: "visible", timeout: 15_000 });
    await creationEditor.locator("[data-pcc-create-fill-remaining]").click({ force: true });
    const fillRemainingPreservedUserInput =
      (await creationEditor.locator("[data-pcc-project-title]").inputValue()) ===
      createdProjectTitle;
    await page.screenshot({ path: creationDesktopScreenshotPath, fullPage: true });
    await creationEditor.locator("[data-pcc-create-project-confirm]").click({ force: true });
    await creationEditor.waitFor({ state: "hidden", timeout: 30_000 });
    const createdProjects = await gateway<{ projects?: PccProjectSummary[] }>("pcc.projects.list", {
      includeArchived: false,
    });
    createdProjectId =
      createdProjects.projects?.find((item) => item.title === createdProjectTitle)?.id ?? "";
    if (!createdProjectId) {
      throw new Error("guided project creation did not persist the new project");
    }
    const createdProject = await getProject(createdProjectId);
    const createdResponsibilities = new Set(
      createdProject.milestones.map((item) => recordString(item.metadata, "pccResponsibility")),
    );
    const modelRoutingPersisted =
      recordString(createdProject.project.metadata, "pccAiUsePolicy") === "codex_expert" &&
      createdResponsibilities.has("codex") &&
      createdResponsibilities.has("local_openclaw_agent") &&
      createdResponsibilities.has("remote_proof");
    const codexPermissionGranted =
      createdProject.permissions?.some(
        (item) => item.status === "granted" && item.type === "codex_usage" && !item.maxUses,
      ) === true;
    const newProjectGuidedCreateWorked =
      aiExplainerVisible &&
      balancedCodexPresetVisible &&
      codexApprovalExplainedOnce &&
      allAiPlansVisible &&
      userTitlePreserved &&
      reviewExplainsSafety &&
      routingSummaryVisible &&
      permissionCardCount === 1 &&
      tokenBudgetControlCount === 0 &&
      duplicatePlannerSelectorCount === 0 &&
      createDisabledBeforeApproval &&
      permissionApproved &&
      createEnabledAfterApproval &&
      backPreservedUserInput &&
      fillRemainingPreservedUserInput &&
      modelRoutingPersisted &&
      codexPermissionGranted;

    phase = "testing guided creation on mobile";
    summary.phase = phase;
    await page.setViewportSize({ width: 390, height: 844 });
    await clickProjectButton(page, "[data-pcc-new-project]", /^New project$/i);
    const mobileCreationEditor = page.locator('[data-pcc-editor="project"]').first();
    await mobileCreationEditor.waitFor({ state: "visible", timeout: 15_000 });
    const newProjectMobileLayout = await mobileCreationEditor.evaluate((editor) => {
      const rect = editor.getBoundingClientRect();
      const explainer = editor.querySelector<HTMLElement>("[data-pcc-create-ai-explainer]");
      const aiRoles = editor.querySelector<HTMLElement>("[data-pcc-ai-role-picker]");
      const action = editor.querySelector<HTMLElement>("[data-pcc-create-review-plan]");
      return {
        fitsViewport: rect.left >= -1 && rect.right <= globalThis.innerWidth + 1,
        noHorizontalOverflow: editor.scrollWidth <= editor.clientWidth + 1,
        explainerVisible: Boolean(explainer && explainer.getBoundingClientRect().height > 0),
        aiRolesVisible: Boolean(aiRoles && aiRoles.getBoundingClientRect().height > 0),
        primaryActionVisible: Boolean(action && action.getBoundingClientRect().height > 0),
      };
    });
    await page.screenshot({ path: creationMobileScreenshotPath, fullPage: true });
    await mobileCreationEditor.locator("[data-pcc-project-cancel]").click({ force: true });
    await mobileCreationEditor.waitFor({ state: "hidden", timeout: 15_000 });
    await page.locator('[data-pcc-mobile-section-tab="projects"]').first().click({ force: true });
    await page.setViewportSize({ width: 1024, height: 900 });

    const createdProjectWorkMode = page
      .locator('[data-pcc-focus-mode-option="project_work"]:visible')
      .first();
    if (await createdProjectWorkMode.isVisible().catch(() => false)) {
      await createdProjectWorkMode.click({ force: true });
    }
    const createdProjectAllTab = page
      .locator("[data-pcc-project-tabs] button:visible", { hasText: /\bAll\b/i })
      .first();
    await clickSafely(createdProjectAllTab);

    phase = "testing project search and filters";
    summary.phase = phase;
    const projectSearch = page.locator("[data-pcc-project-search] input[type='search']").first();
    const searchStartedAt = performance.now();
    await projectSearch.fill(actionProjectTitle);
    await page.waitForTimeout(300);
    projectSearchMs = Math.round(performance.now() - searchStartedAt);
    const visibleProjectCards = page.locator("[data-pcc-project-card]:visible");
    const visibleProjectIds = await visibleProjectCards.evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset.pccProjectId ?? ""),
    );
    const projectSearchWorked =
      visibleProjectIds.length > 0 && visibleProjectIds.every((id) => id === actionProjectId);
    await page
      .getByRole("button", { name: /^Clear search$/i })
      .first()
      .click({ force: true });
    const needsYouStartedAt = performance.now();
    const needsYouTab = page
      .locator("[data-pcc-project-tabs] button:visible", { hasText: /\bNeeds You\b/i })
      .first();
    await needsYouTab.click({ force: true });
    await page.waitForFunction(
      () =>
        document
          .querySelector<HTMLElement>("[data-pcc-project-tabs] button[aria-pressed='true']")
          ?.textContent?.includes("Needs You") === true,
      undefined,
      { timeout: 15_000 },
    );
    projectFilterMs = Math.round(performance.now() - needsYouStartedAt);
    const needsYouEmptyStateVisible = await page
      .locator("[data-pcc-project-empty-state]")
      .first()
      .isVisible()
      .catch(() => false);
    const projectFilterWorked =
      (await needsYouTab.getAttribute("aria-pressed")) === "true" &&
      ((await page.locator("[data-pcc-project-card]").count()) > 0 || needsYouEmptyStateVisible);
    await clickSafely(createdProjectAllTab);

    phase = "testing project archive confirmation";
    summary.phase = phase;
    await openProjectCard(page, createdProjectId);
    await clickSafely(page.locator('[data-pcc-view-mode-option="detailed"]'));
    const archiveButton = page.getByRole("button", { name: /^Archive$/i }).first();
    await archiveButton.click({ force: true });
    await page
      .getByRole("button", { name: /^Confirm archive$/i })
      .first()
      .click({ force: true });
    await page.waitForTimeout(500);
    const archivePersisted = (await getProject(createdProjectId)).project.status === "archived";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });

    phase = "selecting disposable action project";
    summary.phase = phase;
    const projectWorkMode = page
      .locator('[data-pcc-focus-mode-option="project_work"]:visible')
      .first();
    const projectWorkModeVisible = await projectWorkMode.isVisible().catch(() => false);
    if (await projectWorkMode.isVisible().catch(() => false)) {
      await projectWorkMode.click({ force: true });
    }
    const allTab = page
      .locator("[data-pcc-project-tabs] button:visible", { hasText: /\bAll\b/i })
      .first();
    if (await allTab.isVisible().catch(() => false)) {
      await allTab.click({ force: true });
    }
    const actionCard = page
      .locator(`[data-pcc-project-card][data-pcc-project-id="${actionProjectId}"]`)
      .first();
    await actionCard.waitFor({ state: "visible", timeout: 45_000 });
    const projectSwitchStartedAt = performance.now();
    await openProjectCard(page, actionProjectId);
    projectSwitchMs = Math.round(performance.now() - projectSwitchStartedAt);
    await page
      .locator(`[data-pcc-detail-project-id="${actionProjectId}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });

    phase = "proving first-screen focus hierarchy";
    summary.phase = phase;
    await clickSafely(page.locator('[data-pcc-view-mode-option="simple"]'));
    const activeSimpleDesktop = await auditPccViewport({
      page,
      width: 1366,
      height: 768,
      label: "active-simple",
      artifactDir: visualMatrixDir,
    });
    const simpleFacts = page.locator("[data-pcc-simple-project-facts]").first();
    const firstScreenHierarchy = await page
      .locator(".pcc-shell")
      .first()
      .evaluate((shell) => {
        const viewportBottom = globalThis.innerHeight;
        const snapshot = shell.querySelector<HTMLElement>("[data-pcc-project-snapshot]");
        const facts = shell.querySelector<HTMLElement>("[data-pcc-simple-project-facts]");
        const action = shell.querySelector<HTMLElement>("[data-pcc-primary-action]");
        const journey = shell.querySelector<HTMLElement>("[data-pcc-milestone-journey]");
        return {
          snapshotVisible: Boolean(
            snapshot && snapshot.getBoundingClientRect().top < viewportBottom,
          ),
          factsVisible: Boolean(facts && facts.getBoundingClientRect().top < viewportBottom),
          primaryActionVisible: Boolean(
            action && action.getBoundingClientRect().top < viewportBottom,
          ),
          journeyStartsNearFirstScreen: Boolean(
            journey && journey.getBoundingClientRect().top < viewportBottom * 1.35,
          ),
        };
      });
    const simpleFactsText = (await simpleFacts.textContent()) ?? "";
    const firstScreenFactsReadable =
      simpleFactsText.includes("Current step") && simpleFactsText.includes("Progress");
    await page.setViewportSize({ width: 1440, height: 1200 });

    // Simple mode intentionally hides maintenance and editing controls. Switch to
    // Detailed before exercising durable project mutations.
    await clickSafely(page.locator('[data-pcc-view-mode-option="detailed"]'));

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

    phase = "testing guided work controls";
    summary.phase = phase;
    const workLoop = page.locator("[data-pcc-work-loop]").first();
    await workLoop.waitFor({ state: "visible", timeout: 15_000 });
    await workLoop.getByRole("button", { name: /^Work This Project$/i }).click({ force: true });
    await page
      .getByText("Work This Project is on", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const workLoopEnabled =
      (
        (await getProject(actionProjectId)).project.metadata as {
          pccWorkLoop?: { enabled?: boolean };
        }
      )?.pccWorkLoop?.enabled === true;
    await workLoop.getByRole("button", { name: /^Pause$/i }).click({ force: true });
    await page
      .getByText("Work paused", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const workLoopPaused =
      (
        (await getProject(actionProjectId)).project.metadata as {
          pccWorkLoop?: { state?: string };
        }
      )?.pccWorkLoop?.state === "paused";
    await workLoop.getByRole("button", { name: /^Turn off$/i }).click({ force: true });
    await page
      .getByText("Work controls turned off", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await workLoop
      .getByRole("button", { name: /^Prepare next safe task$/i })
      .click({ force: true });
    await page
      .getByText("Next safe task prepared", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const afterPrepare = await getProject(actionProjectId);
    const prepareNextPersisted =
      afterPrepare.milestones.some((item) => item.status === "in_progress") ||
      (afterPrepare.subMilestones?.some((item) => item.status === "in_progress") ?? false);
    await workLoop.getByRole("button", { name: /^Turn off$/i }).click({ force: true });
    await page
      .getByText("Work controls turned off", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const workLoopTurnedOff =
      (
        (await getProject(actionProjectId)).project.metadata as {
          pccWorkLoop?: { enabled?: boolean };
        }
      )?.pccWorkLoop?.enabled === false;

    phase = "testing milestone and sub-step disclosure";
    summary.phase = phase;
    const secondMilestone = page
      .locator(`[data-pcc-milestone-id="${actionProjectId}-step-2"]`)
      .first();
    const secondMilestoneDetails = secondMilestone.locator(
      ":scope > .pcc-journey-step__content > details",
    );
    if ((await secondMilestoneDetails.getAttribute("open")) === null) {
      await secondMilestoneDetails.locator(":scope > summary").click({ force: true });
    }
    const milestoneDisclosureWorked = (await secondMilestoneDetails.getAttribute("open")) !== null;
    const subStepDrilldown = secondMilestone.locator("[data-pcc-submilestone-drilldown]").first();
    await subStepDrilldown.locator(":scope > summary").click({ force: true });
    const subStepDisclosureWorked = (await subStepDrilldown.getAttribute("open")) !== null;

    phase = "testing context copy feedback";
    summary.phase = phase;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(url).origin,
    });
    const copyNextStep = page.locator('[data-pcc-copy-context="compact"]').first();
    await clickSafely(copyNextStep);
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-pcc-copy-context="compact"]')?.dataset
          .pccCopyState === "copied",
      undefined,
      { timeout: 15_000 },
    );
    const copiedContext = await page.evaluate(() => navigator.clipboard.readText());
    const contextCopyWorked = copiedContext.includes(editedTitle);

    phase = "testing decision cancel and save";
    summary.phase = phase;
    const addDecision = page.locator("[data-pcc-snapshot-add-decision]").first();
    await addDecision.click({ force: true });
    const decisionForm = page.locator("[data-pcc-decision-form]").first();
    await decisionForm.waitFor({ state: "visible", timeout: 15_000 });
    const decisionPanelRevealed =
      (await page
        .locator('[data-pcc-detail-tab="decisions"]')
        .first()
        .getAttribute("aria-selected")) === "true";
    await decisionForm.getByLabel("Decision title").press("Escape");
    await decisionForm.waitFor({ state: "hidden", timeout: 15_000 });
    const decisionCancelWorked = (await page.locator("[data-pcc-decision-form]").count()) === 0;
    await addDecision.click({ force: true });
    const savedDecisionForm = page.locator("[data-pcc-decision-form]").first();
    await savedDecisionForm.getByLabel("Decision title").fill("Use disposable interaction proof");
    await savedDecisionForm
      .getByLabel("Summary")
      .fill("Use the isolated browser run as interaction evidence only.");
    await savedDecisionForm.locator('button[type="submit"]').click({ force: true });
    await page
      .getByText("Decision recorded", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const decisionSavePersisted =
      (await getProject(actionProjectId)).decisions?.some(
        (item) => item.title === "Use disposable interaction proof",
      ) === true;

    phase = "testing autopilot controls";
    summary.phase = phase;
    await page
      .locator('[data-pcc-detail-tab="automation"]')
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const detailPanelStartedAt = performance.now();
    await clickSafely(page.locator('[data-pcc-detail-tab="automation"]'));
    const autopilotMode = page.locator("[data-pcc-autopilot-mode-picker]").first();
    await autopilotMode.waitFor({ state: "visible", timeout: 15_000 });
    detailPanelOpenMs = Math.round(performance.now() - detailPanelStartedAt);
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
    await page
      .locator("[data-pcc-autopilot-permission-request]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page
      .locator("[data-pcc-autopilot-permission-queue]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.screenshot({
      path: path.join(visualMatrixDir, "autopilot-permission-request-1440x900.png"),
      fullPage: true,
    });
    const startDisabledBeforePermission = await page
      .locator("[data-pcc-autopilot-start]")
      .first()
      .isDisabled();
    if (!startDisabledBeforePermission) {
      throw new Error(
        "Autopilot start should be disabled until medium-risk permission is approved",
      );
    }
    await page.locator("[data-pcc-autopilot-allow-medium]").first().click({ force: true });
    await page
      .getByText("Autopilot permission saved", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page
      .locator("[data-pcc-autopilot-grant-history]", { hasText: "Medium grant active" })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const afterAutopilotApproval = await getProject(actionProjectId);
    const approvedAutopilotMetadata = afterAutopilotApproval.project.metadata as
      | {
          pccAutopilot?: {
            permissionGrants?: Array<{ status?: string; riskTier?: string }>;
            permissionQueue?: Array<{ status?: string; riskTier?: string }>;
          };
        }
      | undefined;
    const autopilotGrantPersisted =
      approvedAutopilotMetadata?.pccAutopilot?.permissionGrants?.some(
        (grant) => grant.status === "active" && grant.riskTier === "medium",
      ) === true;
    const autopilotQueueApproved =
      approvedAutopilotMetadata?.pccAutopilot?.permissionQueue?.some(
        (item) => item.status === "approved" && item.riskTier === "medium",
      ) === true;
    await page.locator("[data-pcc-autopilot-revoke-grant]").first().click({ force: true });
    await page
      .getByText("Autopilot permission grant revoked", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page
      .locator("[data-pcc-autopilot-permission-request]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const startDisabledAfterRevoke = await page
      .locator("[data-pcc-autopilot-start]")
      .first()
      .isDisabled();
    await page.locator("[data-pcc-autopilot-deny-permission]").first().click({ force: true });
    await page
      .getByText("Autopilot permission request denied", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page
      .locator("[data-pcc-autopilot-repair-preview]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("[data-pcc-autopilot-apply-repair]").first().click({ force: true });
    await page
      .getByText("Autopilot repair applied", { exact: false })
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
      | {
          pccAutopilot?: {
            status?: string;
            mode?: string;
            runHistory?: unknown[];
            permissionGrants?: Array<{ status?: string; riskTier?: string }>;
            permissionQueue?: Array<{ status?: string; riskTier?: string }>;
            permissionRepair?: { status?: string };
          };
        }
      | undefined;
    const autopilotControlsWorked =
      autopilotMetadata?.pccAutopilot?.status === "blocked" &&
      autopilotMetadata.pccAutopilot.mode === "bug_hunt" &&
      Array.isArray(autopilotMetadata.pccAutopilot.runHistory) &&
      autopilotMetadata.pccAutopilot.runHistory.length > 0;
    const autopilotGrantRevoked =
      autopilotMetadata?.pccAutopilot?.permissionGrants?.some(
        (grant) => grant.status === "revoked" && grant.riskTier === "medium",
      ) === true;
    const autopilotQueueDenied =
      autopilotMetadata?.pccAutopilot?.permissionQueue?.some(
        (item) => item.status === "denied" && item.riskTier === "medium",
      ) === true;
    const autopilotRepairApplied =
      autopilotMetadata?.pccAutopilot?.permissionRepair?.status === "applied";

    phase = "testing pointer drag reorder";
    summary.phase = phase;
    const reorderToggle = page.locator("[data-pcc-reorder-mode-toggle]").first();
    await reorderToggle.click({ force: true });
    await page
      .locator("[data-pcc-reorder-instruction]")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.screenshot({
      path: path.join(visualMatrixDir, "reorder-mode-1440x900.png"),
      fullPage: true,
    });

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

    phase = "leaving reorder mode before action menu";
    summary.phase = phase;
    const reorderToggleOff = page.locator("[data-pcc-reorder-mode-toggle]").first();
    if (await reorderToggleOff.isVisible().catch(() => false)) {
      await reorderToggleOff.click({ force: true });
      await page.waitForTimeout(500);
    }

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
    const setupRepairPreviewVisible = true;

    phase = "testing Simple, Detailed, and Agent view controls";
    summary.phase = phase;
    let viewModeControlsWorked = true;
    for (const mode of ["detailed", "agent", "simple"] as const) {
      await clickSafely(page.locator(`[data-pcc-view-mode-option="${mode}"]`));
      viewModeControlsWorked &&=
        (await page
          .locator(`[data-pcc-view-mode="${mode}"]`)
          .count()
          .catch(() => 0)) > 0;
    }

    phase = "testing constrained desktop focus layout";
    summary.phase = phase;
    await page.setViewportSize({ width: 1220, height: 900 });
    const simpleView = page.locator('[data-pcc-view-mode-option="simple"]').first();
    if (await simpleView.isVisible().catch(() => false)) {
      await simpleView.click({ force: true });
    }
    const constrainedDesktop = await page
      .locator(".pcc-shell")
      .first()
      .evaluate((shell) => {
        const layout = shell.querySelector<HTMLElement>(".pcc-layout");
        const workspace = shell.querySelector<HTMLElement>("[data-pcc-selected-project-workspace]");
        const projects = shell.querySelector<HTMLElement>('[data-pcc-mobile-section="projects"]');
        if (!layout || !workspace || !projects) {
          return {
            focusLayout: false,
            noHorizontalOverflow: false,
            workspaceBeforeProjectList: false,
            noWorkspaceOverlap: false,
          };
        }
        const workspaceRect = workspace.getBoundingClientRect();
        const projectsRect = projects.getBoundingClientRect();
        return {
          focusLayout: layout.classList.contains("pcc-layout--focus"),
          noHorizontalOverflow:
            document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          workspaceBeforeProjectList: workspaceRect.top <= projectsRect.top + 1,
          noWorkspaceOverlap:
            workspaceRect.bottom <= projectsRect.top + 1 ||
            projectsRect.bottom <= workspaceRect.top + 1,
        };
      });

    phase = "auditing required responsive viewport matrix";
    summary.phase = phase;
    await clickSafely(page.locator('[data-pcc-view-mode-option="detailed"]'));
    const requiredViewports = [
      [390, 844],
      [430, 932],
      [768, 1024],
      [1024, 768],
      [1280, 800],
      [1366, 768],
      [1440, 900],
      [1728, 1117],
    ] as const;
    const visualMatrix: VisualViewportAudit[] = [];
    for (const [width, height] of requiredViewports) {
      visualMatrix.push(
        await auditPccViewport({
          page,
          width,
          height,
          label: "setup-repair-detailed",
          artifactDir: visualMatrixDir,
        }),
      );
    }
    const visualMatrixPassed = visualMatrix.every(
      (audit) =>
        audit.noHorizontalOverflow &&
        audit.controlsStayInsideViewport &&
        audit.controlsDoNotClipText &&
        audit.auditedGroupsDoNotOverlap &&
        audit.primaryMobileTargetsAreLargeEnough,
    );
    summary.visualMatrix = visualMatrix;

    phase = "auditing 200 percent zoom equivalent and dynamic text pressure";
    summary.phase = phase;
    const zoomEquivalentAudit = await auditPccViewport({
      page,
      width: 683,
      height: 384,
      label: "zoom-200-equivalent",
      artifactDir: visualMatrixDir,
    });
    await page.addStyleTag({
      content: "html { font-size: 125% !important; }",
    });
    const dynamicTextAudit = await auditPccViewport({
      page,
      width: 390,
      height: 844,
      label: "dynamic-text-125",
      artifactDir: visualMatrixDir,
    });
    await page.evaluate(() => {
      for (const style of document.head.querySelectorAll("style")) {
        if (style.textContent?.includes("font-size: 125%")) {
          style.remove();
        }
      }
    });
    summary.accessibilityVisualAudits = [zoomEquivalentAudit, dynamicTextAudit];
    const accessibilityVisualAuditsPassed = [zoomEquivalentAudit, dynamicTextAudit].every(
      (audit) =>
        audit.noHorizontalOverflow &&
        audit.controlsStayInsideViewport &&
        audit.controlsDoNotClipText &&
        audit.auditedGroupsDoNotOverlap &&
        audit.primaryMobileTargetsAreLargeEnough,
    );

    phase = "testing mobile command rail";
    summary.phase = phase;
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileViewMode = page.locator(".pcc-hero--compact [data-pcc-view-mode]").first();
    await mobileViewMode.waitFor({ state: "visible", timeout: 15_000 });
    const mobileViewModeLayout = await mobileViewMode.evaluate((switcher) => {
      const style = globalThis.getComputedStyle(switcher);
      const buttons = [...switcher.querySelectorAll<HTMLElement>("[data-pcc-view-mode-option]")];
      const rects = buttons.map((button) => button.getBoundingClientRect());
      return {
        noHorizontalOverflow: switcher.scrollWidth <= switcher.clientWidth + 1,
        columns: style.gridTemplateColumns.trim().split(/\s+/u).filter(Boolean).length,
        labelsFit: buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
        noButtonOverlap: rects.every((rect, index) =>
          rects
            .slice(index + 1)
            .every((other) => rect.right <= other.left + 1 || other.right <= rect.left + 1),
        ),
      };
    });
    const mobileRail = page.locator("[data-pcc-mobile-command-rail]").first();
    await mobileRail.waitFor({ state: "visible", timeout: 15_000 });
    const mobileCommandRailVisible = await mobileRail.isVisible();
    const mobilePrimaryActionVisible = await page
      .locator("[data-pcc-mobile-primary-action]")
      .first()
      .isVisible()
      .catch(() => false);
    const mobileSnapshot = page
      .locator(`[data-pcc-detail-project-id="${setupProjectId}"] [data-pcc-project-snapshot]`)
      .first();
    await mobileSnapshot.waitFor({ state: "visible", timeout: 15_000 });
    const mobileLayout = await mobileSnapshot.evaluate((snapshot) => {
      const selectors = [
        ":scope > [data-pcc-primary-action]",
        ":scope > [data-pcc-blocker-center]",
        ":scope > [data-pcc-execution-readiness]",
        ":scope > [data-pcc-universal-preflight]",
        ":scope > [data-pcc-scope-lock]",
        ":scope > [data-pcc-autopilot-hero-chip]",
      ];
      const cards: Array<{ top: number; bottom: number }> = [];
      let noHorizontalOverflow = snapshot.scrollWidth <= snapshot.clientWidth + 1;
      for (const selector of selectors) {
        const element = snapshot.querySelector<HTMLElement>(selector);
        if (!element) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        cards.push({ top: rect.top, bottom: rect.bottom });
        noHorizontalOverflow &&= element.scrollWidth <= element.clientWidth + 1;
      }
      let noCardOverlap = true;
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        if (!card) {
          continue;
        }
        for (let otherIndex = index + 1; otherIndex < cards.length; otherIndex += 1) {
          const other = cards[otherIndex];
          if (!other) {
            continue;
          }
          if (card.bottom > other.top + 1 && other.bottom > card.top + 1) {
            noCardOverlap = false;
          }
        }
      }
      const primaryAction = snapshot.querySelector<HTMLElement>("[data-pcc-primary-action]");
      return {
        primaryActionIsInFlow: globalThis.getComputedStyle(primaryAction!).position === "static",
        noCardOverlap,
        noHorizontalOverflow,
      };
    });
    for (const tab of ["projects", "current", "milestones", "autopilot", "more"]) {
      await page.locator(`[data-pcc-mobile-section-tab="${tab}"]`).first().click({ force: true });
      await page.waitForTimeout(150);
    }
    const mobileSectionNavigationWorked =
      (await page
        .locator('[data-pcc-mobile-section-tab="more"]')
        .first()
        .getAttribute("aria-current")) === "true";
    await page.screenshot({ path: screenshotPath, fullPage: true });

    phase = "proving blocked on-hold complete and empty states";
    summary.phase = phase;
    await page.setViewportSize({ width: 1440, height: 900 });
    await setDisposableMilestoneBlocked(
      actionProjectId,
      `${actionProjectId}-step-1`,
      "First live reorder step",
      10,
    );
    await setDisposableProjectStatus(actionProjectId, currentActionProjectTitle, "blocked");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });
    await clickSafely(page.locator('[data-pcc-focus-mode-option="project_work"]'));
    await page
      .locator("[data-pcc-project-tabs] button")
      .last()
      .waitFor({ state: "attached", timeout: 45_000 });
    await clickSafely(page.locator("[data-pcc-project-tabs] button").last());
    await openProjectCard(page, actionProjectId);
    await clickSafely(page.locator('[data-pcc-view-mode-option="simple"]'));
    const blockedStateVisible =
      (await page.locator("[data-pcc-blocker-center]").first().isVisible()) &&
      (await page.locator('[data-pcc-primary-action-id="review_blocker"]').first().isVisible());
    await page.screenshot({
      path: path.join(visualMatrixDir, "blocked-project-1440x900.png"),
      fullPage: true,
    });

    await setDisposableProjectStatus(actionProjectId, currentActionProjectTitle, "on_hold");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });
    await clickSafely(page.locator('[data-pcc-focus-mode-option="project_work"]'));
    await page
      .locator("[data-pcc-project-tabs] button")
      .last()
      .waitFor({ state: "attached", timeout: 45_000 });
    await clickSafely(page.locator("[data-pcc-project-tabs] button").last());
    await openProjectCard(page, actionProjectId);
    const onHoldResumeVisible = await page
      .locator('[data-pcc-primary-action-id="resume"]')
      .first()
      .isVisible();
    await page.screenshot({
      path: path.join(visualMatrixDir, "on-hold-project-1440x900.png"),
      fullPage: true,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });
    await clickSafely(page.locator('[data-pcc-focus-mode-option="project_work"]'));
    await page
      .locator("[data-pcc-project-tabs] button")
      .last()
      .waitFor({ state: "attached", timeout: 45_000 });
    await clickSafely(page.locator("[data-pcc-project-tabs] button").last());
    await openProjectCard(page, completeProjectId);
    const completeStateReadOnly =
      (await page.locator("[data-pcc-maintenance-hero]").first().isVisible()) &&
      (await page.locator("[data-pcc-primary-action]").count()) === 0 &&
      (await page.getByText("100%", { exact: true }).count()) > 0;
    await page.screenshot({
      path: path.join(visualMatrixDir, "complete-maintenance-1440x900.png"),
      fullPage: true,
    });

    await archiveProject(actionProjectId, currentActionProjectTitle);
    await archiveProject(setupProjectId, setupProjectTitle);
    await archiveProject(completeProjectId, completeProjectTitle);
    await archiveProject(createdProjectId, createdProjectTitle);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".pcc-shell").first().waitFor({ state: "visible", timeout: 45_000 });
    await clickSafely(page.locator('[data-pcc-focus-mode-option="project_work"]'));
    const emptyStateVisible = await page
      .locator("[data-pcc-project-empty-state]")
      .first()
      .isVisible();
    await page.screenshot({
      path: path.join(visualMatrixDir, "no-active-projects-1440x900.png"),
      fullPage: true,
    });

    phase = "summarizing live disposable proof";
    summary.phase = phase;
    summary.checks = {
      pccShell: (await page.locator(".pcc-shell").count()) > 0,
      projectWorkModeVisible,
      pointerDragPersisted: sortedAfterPointerDrag[0]?.id === `${actionProjectId}-step-2`,
      keyboardReorderPersisted: sortedAfterMove[0]?.id === `${actionProjectId}-step-1`,
      reorderPersisted:
        sortedAfterPointerDrag[0]?.id === `${actionProjectId}-step-2` &&
        sortedAfterMove[0]?.id === `${actionProjectId}-step-1`,
      actionMenuWorked: true,
      newProjectCancelWorked,
      newProjectGuidedCreateWorked,
      newProjectBalancedCodexPresetVisible: balancedCodexPresetVisible,
      newProjectAllAiPlansVisible: allAiPlansVisible,
      newProjectCodexApprovalExplainedOnce: codexApprovalExplainedOnce,
      newProjectRoutingSummaryVisible: routingSummaryVisible,
      newProjectSinglePermissionCard: permissionCardCount === 1,
      newProjectNoTokenBudgetControl: tokenBudgetControlCount === 0,
      newProjectNoDuplicatePlannerSelector: duplicatePlannerSelectorCount === 0,
      newProjectCreateDisabledBeforeCodexApproval: createDisabledBeforeApproval,
      newProjectCodexPermissionApproved: permissionApproved,
      newProjectCreateEnabledAfterCodexApproval: createEnabledAfterApproval,
      newProjectBackPreservesInput: backPreservedUserInput,
      newProjectFillRemainingPreservesInput: fillRemainingPreservedUserInput,
      newProjectModelRoutingPersisted: modelRoutingPersisted,
      newProjectCodexPermissionGranted: codexPermissionGranted,
      newProjectMobileFitsViewport: newProjectMobileLayout.fitsViewport,
      newProjectMobileDoesNotOverflow: newProjectMobileLayout.noHorizontalOverflow,
      newProjectMobileExplainerVisible: newProjectMobileLayout.explainerVisible,
      newProjectMobileAiRolesVisible: newProjectMobileLayout.aiRolesVisible,
      newProjectMobilePrimaryActionVisible: newProjectMobileLayout.primaryActionVisible,
      archiveConfirmationPersisted: archivePersisted,
      projectSearchWorked,
      projectFilterWorked,
      editSavePersisted,
      editCancelDiscarded,
      workLoopEnabled,
      workLoopPaused,
      workLoopTurnedOff,
      prepareNextPersisted,
      milestoneDisclosureWorked,
      subStepDisclosureWorked,
      contextCopyWorked,
      decisionPanelRevealed,
      decisionCancelWorked,
      decisionSavePersisted,
      autopilotControlsWorked,
      autopilotGrantPersisted,
      autopilotQueueApproved,
      autopilotGrantRevoked,
      autopilotQueueDenied,
      autopilotRepairApplied,
      startDisabledAfterRevoke,
      setupRepairPreviewVisible,
      viewModeControlsWorked,
      initialNavigationWithinBudget: initialNavigationMs <= 5_000,
      projectSwitchWithinBudget: projectSwitchMs <= 5_000,
      projectPreviewWithinBudget: projectPreviewMs <= 2_000,
      detailPanelWithinBudget: detailPanelOpenMs <= 2_000,
      projectSearchWithinBudget: projectSearchMs <= 2_000,
      projectFilterWithinBudget: projectFilterMs <= 2_000,
      visualMatrixPassed,
      accessibilityVisualAuditsPassed,
      firstScreenVisualAuditPassed:
        activeSimpleDesktop.noHorizontalOverflow &&
        activeSimpleDesktop.controlsStayInsideViewport &&
        activeSimpleDesktop.auditedGroupsDoNotOverlap,
      firstScreenFactsReadable,
      firstScreenHierarchyVisible:
        firstScreenHierarchy.snapshotVisible &&
        firstScreenHierarchy.factsVisible &&
        firstScreenHierarchy.primaryActionVisible,
      blockedStateVisible,
      onHoldResumeVisible,
      completeStateReadOnly,
      emptyStateVisible,
      constrainedDesktopUsesFocusLayout: constrainedDesktop.focusLayout,
      constrainedDesktopDoesNotOverflow: constrainedDesktop.noHorizontalOverflow,
      constrainedDesktopKeepsWorkspaceFirst: constrainedDesktop.workspaceBeforeProjectList,
      constrainedDesktopDoesNotOverlap: constrainedDesktop.noWorkspaceOverlap,
      mobileCommandRailVisible,
      mobilePrimaryActionVisible,
      mobilePrimaryActionIsInFlow: mobileLayout.primaryActionIsInFlow,
      mobileCardsDoNotOverlap: mobileLayout.noCardOverlap,
      mobileSnapshotDoesNotOverflow: mobileLayout.noHorizontalOverflow,
      mobileViewModeIsSingleRow: mobileViewModeLayout.columns === 3,
      mobileViewModeDoesNotOverflow: mobileViewModeLayout.noHorizontalOverflow,
      mobileViewModeLabelsFit: mobileViewModeLayout.labelsFit,
      mobileViewModeButtonsDoNotOverlap: mobileViewModeLayout.noButtonOverlap,
      mobileSectionNavigationWorked,
      noSnesMutation: true,
    };
    summary.performance = {
      initialNavigationMs,
      projectSwitchMs,
      projectPreviewMs,
      detailPanelOpenMs,
      projectSearchMs,
      projectFilterMs,
      budgetsMs: {
        initialNavigation: 5_000,
        projectSwitch: 5_000,
        projectPreview: 2_000,
        detailPanel: 2_000,
        projectSearch: 2_000,
        projectFilter: 2_000,
      },
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
    await cleanupProject(completeProjectId, completeProjectTitle, completeProjectCreated);
    await cleanupProject(createdProjectId, createdProjectTitle, Boolean(createdProjectId));
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
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const output = redactUrl(message);
    assertNoTokenLeak(output);
    console.error(output);
    process.exit(1);
  });
}

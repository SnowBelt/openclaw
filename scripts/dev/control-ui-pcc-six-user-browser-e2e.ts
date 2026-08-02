import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { callGateway } from "../../src/gateway/call.ts";
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE } from "../../src/gateway/operator-scopes.ts";
import type { PccProject } from "../../ui/src/ui/types.ts";

type Connection = {
  dashboardUrl: string;
  gatewayUrl: string;
  token: string;
  configPath: string;
};

type ProjectResult = { project: PccProject };

const TOKEN_PATTERN = /([#?&]token=)[^&/#]+/giu;
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? "";

function redact(value: string): string {
  return value.replace(TOKEN_PATTERN, "$1<redacted>");
}

function assertNoTokenLeak(value: string): void {
  if (/token=[A-Za-z0-9._~+/=-]{8,}/iu.test(value)) {
    throw new Error("six-user PCC proof contains an unredacted token");
  }
}

function connection(): Connection {
  if (process.env.OPENCLAW_PCC_LIVE_E2E_ISOLATED !== "1" || !CONFIG_PATH) {
    throw new Error("six-user PCC proof requires the isolated temporary Gateway runner");
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (!stateDir || !path.resolve(CONFIG_PATH).startsWith(`${path.resolve(stateDir)}${path.sep}`)) {
    throw new Error("six-user PCC proof config must be inside its temporary state directory");
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as {
    gateway?: { port?: number; auth?: { token?: string } };
  };
  const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? config.gateway?.auth?.token ?? "";
  if (!token) {
    throw new Error("six-user PCC proof is missing its temporary Gateway token");
  }
  const port = config.gateway?.port ?? 18789;
  return {
    dashboardUrl: `http://127.0.0.1:${port}/pcc#token=${encodeURIComponent(token)}`,
    gatewayUrl: `ws://127.0.0.1:${port}`,
    token,
    configPath: CONFIG_PATH,
  };
}

async function gateway<T>(method: string, params: unknown = {}): Promise<T> {
  const target = connection();
  return await callGateway<T>({
    method,
    params,
    url: target.gatewayUrl,
    token: target.token,
    configPath: target.configPath,
    timeoutMs: 30_000,
    scopes: [ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE],
  });
}

async function createProject(id: string, title: string): Promise<void> {
  await gateway("pcc.projects.upsert", {
    project: {
      id,
      title,
      goal: `Verify six-user collaboration for ${title}.`,
      status: "active",
      priority: 2,
      metadata: {
        pccWorkScope: "project_work",
        pccCurrentScope: "active_project_work",
        excludedFromPccProductCompletion: true,
        pccDisposableBrowserProof: true,
      },
    },
  });
  await gateway("pcc.milestones.upsert", {
    milestone: {
      id: `${id}-milestone`,
      projectId: id,
      title: `Complete ${title}`,
      status: "in_progress",
      order: 10,
      percentComplete: 25,
      implementationPlan: "Use only the isolated six-user browser proof.",
      acceptanceCriteria: ["All six authenticated browser contexts converge."],
      metadata: {
        pccResponsibility: "local_openclaw_agent",
        pccProofLevel: "local",
      },
    },
  });
}

async function archiveProject(id: string): Promise<void> {
  const current = await gateway<ProjectResult>("pcc.projects.get", { projectId: id });
  await gateway("pcc.projects.upsert", {
    expectedRevision: current.project.revision,
    project: {
      id,
      title: current.project.title,
      status: "archived",
      metadata: {
        ...current.project.metadata,
        pccArchivedByDisposableProofAt: new Date().toISOString(),
      },
    },
  });
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await read();
    if (accept(value)) {
      return value;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error("timed out waiting for six-user PCC state convergence");
}

async function openProject(page: import("playwright").Page, projectId: string): Promise<void> {
  await page
    .locator(`[data-pcc-overview-project="${projectId}"]`)
    .getByRole("button", { name: "Open project" })
    .click();
  await page.waitForFunction(
    (expectedProjectId) =>
      new URL(globalThis.location.href).searchParams.get("project") === expectedProjectId,
    projectId,
    { timeout: 15_000 },
  );
  await page.locator("[data-pcc-project-workspace]").waitFor({ state: "visible", timeout: 15_000 });
}

async function beginProjectEdit(
  page: import("playwright").Page,
  title: string,
): Promise<import("playwright").Locator> {
  await page.locator("[data-pcc-edit-project]").first().click();
  const editor = page.locator('[data-pcc-editor="project"]').first();
  await editor.waitFor({ state: "visible", timeout: 15_000 });
  await editor.locator("[data-pcc-project-title]").first().fill(title);
  return editor;
}

async function saveProjectEdit(editor: import("playwright").Locator): Promise<void> {
  await editor.locator('button[type="submit"]').click();
}

function contrastRatio(foreground: string, background: string): number {
  const parse = (value: string): [number, number, number] | null => {
    const match = value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/u);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const luminance = (color: [number, number, number]) => {
    const [red, green, blue] = color.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const foregroundRgb = parse(foreground);
  const backgroundRgb = parse(background);
  if (!foregroundRgb || !backgroundRgb) {
    return 0;
  }
  const foregroundLum = luminance(foregroundRgb);
  const backgroundLum = luminance(backgroundRgb);
  return (
    (Math.max(foregroundLum, backgroundLum) + 0.05) /
    (Math.min(foregroundLum, backgroundLum) + 0.05)
  );
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const projectIds = Array.from({ length: 6 }, (_, index) => `pcc-six-user-${suffix}-${index + 1}`);
  const initialTitles = projectIds.map((_, index) => `Six User Project ${index + 1} ${suffix}`);
  const artifactDir = path.join(
    ".artifacts",
    "control-ui-pcc-six-user",
    new Date().toISOString().replace(/[:.]/gu, "-"),
  );
  fs.mkdirSync(artifactDir, { recursive: true });
  const summary: Record<string, unknown> = { checks: {}, artifactDir };
  let browser: import("playwright").Browser | undefined;
  let proofError: unknown;
  const contexts: import("playwright").BrowserContext[] = [];

  try {
    await Promise.all(projectIds.map((id, index) => createProject(id, initialTitles[index] ?? id)));

    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.OPENCLAW_PCC_PROOF_CHROME_PATH ??
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const pages: import("playwright").Page[] = [];
    for (let index = 0; index < 6; index += 1) {
      const context = await browser.newContext({
        colorScheme: "light",
        locale: "en-US",
        serviceWorkers: "block",
        viewport: index === 5 ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      });
      contexts.push(context);
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      pages.push(page);
    }

    // Measure the one-user interaction SLO before the six-context soak begins.
    // Concurrency behavior and convergence are verified separately below.
    const overviewInteractiveMs: number[] = [];
    await pages[0]?.goto(connection().dashboardUrl, { waitUntil: "domcontentloaded" });
    await pages[0]
      ?.locator('[data-pcc-shell][data-pcc-surface="overview"]')
      .waitFor({ state: "visible", timeout: 45_000 });
    await pages[0]
      ?.locator("[data-pcc-overview-project]")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await pages[0]?.reload({ waitUntil: "domcontentloaded" });
      await pages[0]
        ?.locator('[data-pcc-shell][data-pcc-surface="overview"]')
        .waitFor({ state: "visible", timeout: 15_000 });
      // Interactive readiness is the usable Overview shell. Project data readiness
      // remains a separate required wait and is captured by the cold-load metric.
      overviewInteractiveMs.push(Math.round(await pages[0]!.evaluate(() => performance.now())));
      await pages[0]
        ?.locator("[data-pcc-overview-project]")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
    }
    const overviewInteractiveP95Ms = overviewInteractiveMs.toSorted((a, b) => a - b)[
      Math.floor(overviewInteractiveMs.length * 0.95)
    ]!;

    const coldOverviewReadyMs = await Promise.all(
      pages.map(async (page) => {
        await page.goto(connection().dashboardUrl, { waitUntil: "domcontentloaded" });
        await page
          .locator('[data-pcc-shell][data-pcc-surface="overview"]')
          .waitFor({ state: "visible", timeout: 45_000 });
        await page.locator("[data-pcc-overview-project]").first().waitFor({ state: "visible" });
        return Math.round(await page.evaluate(() => performance.now()));
      }),
    );
    const coldOverviewReadyP95Ms = coldOverviewReadyMs.toSorted((a, b) => a - b)[
      Math.floor(coldOverviewReadyMs.length * 0.95)
    ]!;

    const projectCounts = await Promise.all(
      pages.map((page) => page.locator("[data-pcc-overview-project]").count()),
    );
    const allProjectsVisible = projectCounts.every((count) => count === 6);
    const pccProductIsNotDefault = await Promise.all(
      pages.map((page) =>
        page
          .locator('[data-pcc-shell][data-pcc-surface="overview"]')
          .isVisible()
          .catch(() => false),
      ),
    );

    const presence = await waitFor(
      () => gateway<{ presence: unknown[] }>("pcc.presence.list"),
      (value) => value.presence.length === 6,
    );

    const editedTitles = initialTitles.map((title, index) => `${title} Operator ${index + 1}`);
    await Promise.all(pages.map((page, index) => openProject(page, projectIds[index] ?? "")));
    const editors = await Promise.all(
      pages.map((page, index) => beginProjectEdit(page, editedTitles[index] ?? "")),
    );
    await Promise.all(editors.map((editor) => saveProjectEdit(editor)));
    await waitFor(
      async () =>
        await Promise.all(
          projectIds.map((projectId) => gateway<ProjectResult>("pcc.projects.get", { projectId })),
        ),
      (results) => results.every((result, index) => result.project.title === editedTitles[index]),
    );

    await pages[5]?.getByRole("button", { name: "Overview", exact: true }).click();
    const liveProject = await gateway<ProjectResult>("pcc.projects.get", {
      projectId: projectIds[0],
    });
    const liveTitle = `${editedTitles[0]} Live`;
    await gateway("pcc.projects.upsert", {
      expectedRevision: liveProject.project.revision,
      project: { id: projectIds[0], title: liveTitle },
    });
    await pages[5]
      ?.locator(`[data-pcc-overview-project="${projectIds[0]}"] h3`)
      .getByText(liveTitle, { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });

    const currentTitles = [...editedTitles];
    currentTitles[0] = liveTitle;
    await Promise.all(
      pages.map((page) => page.getByRole("button", { name: "Overview", exact: true }).click()),
    );
    const convergenceMs: number[] = [];
    for (let round = 1; round <= 6; round += 1) {
      const current = await Promise.all(
        projectIds.map((projectId) => gateway<ProjectResult>("pcc.projects.get", { projectId })),
      );
      const roundTitles = currentTitles.map(
        (title) => `${title.replace(/ · sync \d+$/u, "")} · sync ${round}`,
      );
      await Promise.all(
        current.map((result, index) =>
          gateway("pcc.projects.upsert", {
            expectedRevision: result.project.revision,
            project: { id: projectIds[index], title: roundTitles[index] },
          }),
        ),
      );
      // The SLO covers browser convergence after the shared mutations commit;
      // prerequisite reads and write latency are separate server concerns.
      const startedAt = performance.now();
      await Promise.all(
        pages.map((page, index) =>
          page
            .locator(`[data-pcc-overview-project="${projectIds[index]}"] h3`)
            .getByText(roundTitles[index] ?? "", { exact: true })
            .waitFor({ state: "visible", timeout: 10_000 }),
        ),
      );
      currentTitles.splice(0, currentTitles.length, ...roundTitles);
      convergenceMs.push(Math.round(performance.now() - startedAt));
    }
    const liveSyncP95Ms = convergenceMs.toSorted((a, b) => a - b)[
      Math.floor(convergenceMs.length * 0.95)
    ]!;

    const reconnectIndex = 4;
    const reconnectProjectId = projectIds[reconnectIndex]!;
    await contexts[reconnectIndex]?.setOffline(true);
    const reconnectProject = await gateway<ProjectResult>("pcc.projects.get", {
      projectId: reconnectProjectId,
    });
    const reconnectTitle = `${currentTitles[reconnectIndex]} · reconnected`;
    await gateway("pcc.projects.upsert", {
      expectedRevision: reconnectProject.project.revision,
      project: { id: reconnectProjectId, title: reconnectTitle },
    });
    await pages[reconnectIndex]?.waitForTimeout(300);
    await contexts[reconnectIndex]?.setOffline(false);
    await pages[reconnectIndex]
      ?.locator(`[data-pcc-overview-project="${reconnectProjectId}"] h3`)
      .getByText(reconnectTitle, { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });
    currentTitles[reconnectIndex] = reconnectTitle;
    const reconnectCaughtUp =
      (await pages[reconnectIndex]
        ?.locator(`[data-pcc-overview-project="${reconnectProjectId}"] h3`)
        .textContent()) === reconnectTitle;

    await Promise.all(
      [pages[0], pages[1]].map(async (page) => {
        await openProject(page!, projectIds[0] ?? "");
      }),
    );
    const conflictEditors = await Promise.all([
      beginProjectEdit(pages[0]!, `${currentTitles[0]} A`),
      beginProjectEdit(pages[1]!, `${currentTitles[0]} B`),
    ]);
    await Promise.all(
      conflictEditors.map((editor) => saveProjectEdit(editor).catch(() => undefined)),
    );
    const conflictMessages = await Promise.all(
      [pages[0], pages[1]].map(async (page) => {
        await page?.waitForTimeout(500);
        return (
          (await page
            ?.locator("[data-pcc-action-error], [data-pcc-editor-error]")
            .first()
            .textContent()
            .catch(() => "")) ?? ""
        ).replace(/\s+/gu, " ");
      }),
    );
    const conflictWasReviewable = conflictMessages.some((message) =>
      /Review latest changes|revision conflict/iu.test(message),
    );

    await pages[5]?.getByRole("button", { name: "Overview", exact: true }).click();
    await pages[5]?.evaluate(() => {
      globalThis.scrollTo({ top: 0 });
      for (const element of document.querySelectorAll<HTMLElement>("*")) {
        element.scrollTop = 0;
      }
    });
    await pages[5]?.screenshot({
      path: path.join(artifactDir, "overview-narrow.png"),
      fullPage: true,
    });
    await pages[2]?.getByRole("button", { name: "Overview", exact: true }).click();
    await pages[2]?.evaluate(() => {
      globalThis.scrollTo({ top: 0 });
      for (const element of document.querySelectorAll<HTMLElement>("*")) {
        element.scrollTop = 0;
      }
    });
    await pages[2]?.screenshot({
      path: path.join(artifactDir, "overview-desktop.png"),
      fullPage: true,
    });
    const visualAudit = await pages[5]?.evaluate(() => {
      const primary = document.querySelector<HTMLElement>(".pcc-action-primary");
      const rect = primary?.getBoundingClientRect();
      const shell = document.querySelector<HTMLElement>("[data-pcc-shell]");
      const activeNav = document.querySelector<HTMLElement>(".pcc-work-nav__item.is-active");
      const navStyle = activeNav ? getComputedStyle(activeNav) : null;
      return {
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        shellFits: Boolean(shell && shell.scrollWidth <= shell.clientWidth + 1),
        primaryTarget44px: Boolean(rect && rect.height >= 44 && rect.width >= 44),
        activeNavColor: navStyle?.color ?? "",
        activeNavBackground: navStyle?.backgroundColor ?? "",
      };
    });

    const checks = {
      sixContextsLoaded: pages.length === 6,
      allProjectsVisible,
      overviewIsDefault: pccProductIsNotDefault.every(Boolean),
      sixPresenceEntries: presence.presence.length === 6,
      independentEditsPersisted: true,
      liveUpdateConverged: true,
      boundedSixUserSoak: convergenceMs.length === 6,
      liveSyncWithinTwoSeconds: liveSyncP95Ms <= 2_000,
      overviewInteractiveWithinOneSecond: overviewInteractiveP95Ms <= 1_000,
      reconnectCaughtUp,
      conflictWasReviewable,
      noHorizontalOverflow: visualAudit?.noHorizontalOverflow,
      shellFitsNarrowViewport: visualAudit?.shellFits,
      primaryTarget44px: visualAudit?.primaryTarget44px,
      activeNavContrastAA:
        visualAudit !== undefined &&
        contrastRatio(visualAudit.activeNavColor, visualAudit.activeNavBackground) >= 4.5,
    };
    summary.metrics = {
      coldOverviewReadyMs,
      coldOverviewReadyP95Ms,
      overviewInteractiveMs,
      overviewInteractiveP95Ms,
      convergenceMs,
      liveSyncP95Ms,
    };
    summary.checks = checks;
    summary.ok = Object.values(checks).every(Boolean);
    fs.writeFileSync(
      path.join(artifactDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    if (!summary.ok) {
      throw new Error(`six-user PCC browser proof failed: ${JSON.stringify(checks)}`);
    }
    console.log(JSON.stringify({ ...summary, projectIds: projectIds.length }, null, 2));
  } catch (error) {
    proofError = error;
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await browser?.close();
    await Promise.allSettled(projectIds.map((projectId) => archiveProject(projectId)));
    const remaining = await gateway<{ projects: Array<{ id: string }> }>("pcc.projects.list", {
      includeArchived: false,
    }).catch(() => ({ projects: [] }));
    if (remaining.projects.some((project) => projectIds.includes(project.id))) {
      proofError ??= new Error("six-user PCC proof cleanup left an active disposable project");
    }
  }
  if (proofError) {
    throw proofError instanceof Error
      ? proofError
      : new Error(typeof proofError === "string" ? proofError : "unknown PCC six-user proof error");
  }
}

await main().catch((error: unknown) => {
  const output = redact(error instanceof Error ? (error.stack ?? error.message) : String(error));
  assertNoTokenLeak(output);
  console.error(output);
  process.exitCode = 1;
});

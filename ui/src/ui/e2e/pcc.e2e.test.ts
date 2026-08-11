// Control UI tests cover the PCC journey against an isolated mocked Gateway.
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describePccE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

const summary = {
  id: "project-1",
  title: "PCC MVP",
  status: "active",
  percentComplete: 50,
  milestoneCounts: { total: 2, complete: 1, blocked: 0, needsApproval: 0, deferred: 0, skipped: 0 },
  nextActions: ["Verify the browser journey"],
  proofGaps: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describePccE2e("Control UI PCC mocked Gateway E2E", () => {
  let browser: Browser;
  let server: ControlUiE2eServer;

  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(`Playwright Chromium is not installed at ${chromiumExecutablePath}.`);
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("loads a project, shows milestones, and starts a bounded planning run", async () => {
    const page = await browser.newPage({ locale: "en-US", serviceWorkers: "block" });
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "pcc.projects.list": { projects: [summary] },
        "pcc.projects.get": {
          project: {
            id: "project-1",
            title: "PCC MVP",
            goal: "A reliable local MVP",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          milestones: [
            {
              id: "milestone-1",
              projectId: "project-1",
              title: "Verify the browser journey",
              status: "complete",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          permissions: [],
          evidence: [],
          receipts: [],
          decisions: [],
          lastKnownGood: [],
          summary,
        },
        "pcc.plans.start": {
          run: {
            schemaVersion: 1,
            id: "run-browser-1",
            requestFingerprint: "fingerprint",
            surface: "project_replan",
            status: "running",
            stage: "planner_running",
            model: "local",
            effort: "medium",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    });

    try {
      const response = await page.goto(`${server.baseUrl}pcc`);
      expect(response?.status()).toBe(200);
      await page.getByRole("heading", { name: "Project Command Center" }).waitFor();
      await page.getByRole("heading", { name: "PCC MVP" }).waitFor();
      expect(await page.getByText("Verify the browser journey").count()).toBeGreaterThan(0);

      await page.getByLabel("What should happen next?").fill("Review the next milestone");
      await page.getByRole("button", { name: "Start plan" }).click();
      const requests = await gateway.getRequests("pcc.plans.start");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.params).toMatchObject({
        description: "Review the next milestone",
        surface: "project_replan",
      });
      const run = page.locator(".pcc-run");
      await run.waitFor();
      expect((await run.textContent()) ?? "").toContain("run-browser-1");
    } finally {
      await page.close();
    }
  });
});

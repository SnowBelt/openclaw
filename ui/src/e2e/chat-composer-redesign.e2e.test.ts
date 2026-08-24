// Control UI E2E tests cover the shipped chat composer behavior.
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeControlUiE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let server: ControlUiE2eServer;

const sessionList = {
  count: 1,
  defaults: {
    contextTokens: 200_000,
    model: "gpt-5.5",
    modelProvider: "openai",
    thinkingDefault: "high",
    thinkingLevels: [
      { id: "off", label: "off" },
      { id: "low", label: "low" },
      { id: "medium", label: "medium" },
      { id: "high", label: "high" },
    ],
  },
  path: "",
  sessions: [
    {
      contextTokens: 200_000,
      displayName: "Main",
      hasActiveRun: false,
      key: "main",
      kind: "direct",
      label: "Main",
      model: "gpt-5.5",
      modelProvider: "openai",
      status: "done",
      totalTokens: 46_000,
      totalTokensFresh: true,
      updatedAt: Date.now(),
    },
  ],
  ts: Date.now(),
};

function authStatusWithUsage() {
  return {
    ts: Date.now(),
    providers: [
      {
        provider: "openai",
        displayName: "Codex",
        status: "ok",
        profiles: [{ profileId: "codex", type: "oauth", status: "ok" }],
        usage: { windows: [{ label: "Week", usedPercent: 72 }] },
      },
    ],
  };
}

describeControlUiE2e("Control UI chat composer", () => {
  beforeAll(async () => {
    server = await startControlUiE2eServer();
  });

  afterAll(async () => {
    await server?.close();
  });

  it("shows truthful context/model controls and transitions send to stop", async () => {
    const browser = await chromium.launch({ executablePath: chromiumExecutablePath });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      assistantName: "Rosita",
      deferredMethods: ["chat.send"],
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", available: true },
        { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", provider: "openai", available: true },
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
      ],
      methodResponses: {
        "models.authStatus": authStatusWithUsage(),
        "sessions.list": sessionList,
      },
    });

    try {
      await page.goto(`${server.baseUrl}chat`);
      await gateway.waitForRequest("sessions.list");

      const composer = page.locator(".agent-chat__input");
      const contextNotice = composer.locator(".context-notice");
      const model = composer.locator('[data-chat-model-select="true"]');
      const quota = composer.locator('[data-chat-provider-usage="true"]');
      const settings = composer.getByRole("button", { name: "Chat settings", exact: true });
      const textarea = composer.locator("textarea");

      await model.waitFor({ state: "visible" });
      await contextNotice.waitFor({ state: "visible" });
      expect(await contextNotice.getAttribute("title")).toBe(
        "Session context usage: 46k / 200k (23%)",
      );
      expect(await contextNotice.locator(".context-notice__detail").textContent()).toBe(
        "46k / 200k",
      );
      await quota.waitFor({ state: "visible" });
      expect((await quota.textContent())?.replace(/\s+/g, " ").trim()).toBe("Usage 28%");
      await settings.waitFor({ state: "visible" });
      await textarea.waitFor({ state: "visible" });
      expect(await model.locator(".chat-controls__inline-select-label").textContent()).toBe(
        "GPT-5.5 · High",
      );

      await model.click();
      await composer
        .locator('[data-chat-model-option="openai/gpt-5.4-pro"]')
        .waitFor({ state: "visible" });
      await composer.locator('[data-chat-model-option="openai/gpt-5.4-pro"]').click();
      await expect
        .poll(async () =>
          (await gateway.getRequests("sessions.patch")).some(
            (request) =>
              typeof request.params === "object" &&
              request.params !== null &&
              "model" in request.params &&
              request.params.model === "openai/gpt-5.4-pro",
          ),
        )
        .toBe(true);

      await model.click();
      await composer.locator('[data-chat-thinking-option="low"]').click();
      await expect
        .poll(async () =>
          (await gateway.getRequests("sessions.patch")).some(
            (request) =>
              typeof request.params === "object" &&
              request.params !== null &&
              "thinkingLevel" in request.params &&
              request.params.thinkingLevel === "low",
          ),
        )
        .toBe(true);

      await settings.click();
      await page.getByRole("dialog", { name: "Chat settings" }).waitFor({ state: "visible" });
      await settings.click();
      await page.getByRole("dialog", { name: "Chat settings" }).waitFor({ state: "hidden" });

      await textarea.fill("Send this message");
      await page.getByRole("button", { name: "Send message" }).click();
      const sendRequest = await gateway.waitForRequest("chat.send");
      const params = sendRequest.params as { idempotencyKey?: unknown };
      const runId = String(params.idempotencyKey);
      await gateway.resolveDeferred("chat.send", { runId, status: "started" });
      await page.getByRole("button", { name: "Stop generating" }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Stop generating" }).click();
      const abortRequest = await gateway.waitForRequest("chat.abort");
      expect(abortRequest.params).toMatchObject({ runId, sessionKey: "main" });
      await page.getByRole("button", { name: "Stop generating" }).waitFor({ state: "hidden" });
    } finally {
      await context.close();
      await browser.close();
    }
  });

  it("keeps the composer inside the mobile viewport and its controls reachable", async () => {
    const browser = await chromium.launch({ executablePath: chromiumExecutablePath });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await context.newPage();
    await installMockGateway(page, { methodResponses: { "sessions.list": sessionList } });

    try {
      await page.goto(`${server.baseUrl}chat`);
      await page.locator(".agent-chat__input").waitFor({ state: "visible" });
      const composer = page.locator(".agent-chat__input");
      const composerBox = await composer.boundingBox();
      const model = composer.locator('[data-chat-model-select="true"]');
      const settings = composer.getByRole("button", { name: "Chat settings", exact: true });
      const modelBox = await model.boundingBox();
      const settingsBox = await settings.boundingBox();
      expect(composerBox).not.toBeNull();
      expect(modelBox).not.toBeNull();
      expect(settingsBox).not.toBeNull();
      if (!composerBox || !modelBox || !settingsBox) {
        throw new Error("expected mobile composer controls to have layout boxes");
      }
      expect(composerBox.x).toBeGreaterThanOrEqual(0);
      expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(393);
      expect(modelBox.x).toBeGreaterThanOrEqual(0);
      expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(393);
      expect(settingsBox.x).toBeGreaterThanOrEqual(0);
      expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(393);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        394,
      );

      await model.click();
      const menu = composer.locator(".chat-controls__inline-select-menu--combined");
      await menu.waitFor({ state: "visible" });
      const menuBox = await menu.boundingBox();
      expect(menuBox).not.toBeNull();
      if (!menuBox) {
        throw new Error("expected mobile model menu to have a layout box");
      }
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(393);
      await model.click();

      await settings.click();
      const dialog = page.getByRole("dialog", { name: "Chat settings" });
      await dialog.waitFor({ state: "visible" });
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      if (!dialogBox) {
        throw new Error("expected mobile settings dialog to have a layout box");
      }
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(393);
      await settings.click();
      await dialog.waitFor({ state: "hidden" });
    } finally {
      await context.close();
      await browser.close();
    }
  });
});

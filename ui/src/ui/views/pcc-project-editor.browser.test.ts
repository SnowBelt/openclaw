import { chromium, type Browser, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { readStyleSheet } from "../../../../test/helpers/ui-style-fixtures.js";
import {
  canRunPlaywrightChromium,
  resolvePlaywrightChromiumExecutablePath,
} from "../../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const describeBrowserLayout = canRunPlaywrightChromium(chromiumExecutablePath)
  ? describe
  : describe.skip;

function readPccCss(): string {
  return [
    "ui/src/legacy-styles/base.css",
    "ui/src/legacy-styles/layout.css",
    "ui/src/legacy-styles/layout.mobile.css",
    "ui/src/legacy-styles/components.css",
    "ui/src/styles/pcc.css",
  ]
    .map((file) => readStyleSheet(file))
    .join("\n");
}

function editorHtml(): string {
  return `
    <main class="pcc-shell">
      <form class="pcc-editor pcc-editor--project" data-pcc-editor="project">
        <header class="pcc-editor__header">
          <div>
            <p class="pcc-kicker">Project</p>
            <h3>Create project</h3>
            <p>Tell PCC what you want. Review the plan. Then create it.</p>
          </div>
          <button class="pcc-editor__close" type="button" aria-label="Close project editor">×</button>
        </header>
        <div
          class="pcc-callout pcc-callout--busy pcc-planning-progress"
          data-pcc-planning-progress
          role="status"
          aria-busy="true"
        >
          <div class="pcc-planning-progress__indicator"></div>
          <div>
            <strong>Creating your project plan</strong>
            <span>Codex is planning milestones and sub-steps</span>
            <small>GPT-5.6 Sol · Medium effort · 26s elapsed.</small>
          </div>
          <button class="btn btn--subtle" type="button">Cancel generation</button>
        </div>
        <section class="pcc-create-flow">
          <label class="pcc-editor__hero-field">
            What do you want to accomplish?
            <textarea>I want to create a clear, reliable project with milestones and proof.</textarea>
          </label>
          <div class="pcc-editor__grid pcc-editor__grid--two" data-pcc-model-grid>
            <label>
              OpenClaw worker model
              <select data-pcc-local-model>
                <option>Best configured local model</option>
              </select>
              <small>Last refresh: not refreshed in this session · 19 configured models</small>
            </label>
            <label>
              Codex model
              <select data-pcc-codex-model>
                <option>Best available from Codex</option>
              </select>
              <small>Only configured Codex models appear.</small>
            </label>
          </div>
          <div style="height: 680px"></div>
        </section>
        <footer>
          <button class="btn pcc-action-primary pcc-editor-primary-action" type="button">
            Generate project plan with Codex
          </button>
          <button class="btn btn--subtle" type="button">Cancel</button>
        </footer>
      </form>
    </main>
  `;
}

async function openFixture(viewport: { width: number; height: number }): Promise<{
  browser: Browser;
  page: Page;
}> {
  const browser = await chromium.launch({ executablePath: chromiumExecutablePath, headless: true });
  const page = await browser.newPage({ viewport });
  await page.setContent(
    `<!doctype html><html data-theme-mode="light"><head><style>${readPccCss()}</style></head><body>${editorHtml()}</body></html>`,
  );
  return { browser, page };
}

describeBrowserLayout("PCC project-creation layout", () => {
  it.each([
    { name: "desktop", viewport: { width: 1224, height: 768 } },
    { name: "mobile", viewport: { width: 390, height: 844 } },
  ])("keeps planning status and the primary action visible on $name", async ({ viewport }) => {
    const { browser, page } = await openFixture(viewport);
    try {
      const initial = await page.evaluate(() => {
        const editor = document.querySelector<HTMLElement>("[data-pcc-editor='project']");
        const header = editor?.querySelector<HTMLElement>(".pcc-editor__header");
        const progress = editor?.querySelector<HTMLElement>("[data-pcc-planning-progress]");
        if (!editor || !header || !progress) {
          throw new Error("Missing PCC project-editor fixture");
        }
        const editorRect = editor.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const progressRect = progress.getBoundingClientRect();
        return {
          contained:
            progressRect.left >= editorRect.left &&
            progressRect.right <= editorRect.right &&
            progressRect.top >= editorRect.top &&
            progressRect.bottom <= editorRect.bottom,
          separated: progressRect.top >= headerRect.bottom,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });

      expect(initial.contained).toBe(true);
      expect(initial.separated).toBe(true);
      expect(initial.horizontalOverflow).toBe(false);

      await page.locator("[data-pcc-editor='project']").evaluate((editor) => {
        editor.scrollTop = editor.scrollHeight;
      });
      const primary = await page.locator(".pcc-editor-primary-action").evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          background: style.backgroundColor,
          opacity: style.opacity,
        };
      });

      expect(primary.height).toBeGreaterThanOrEqual(48);
      expect(primary.left).toBeGreaterThanOrEqual(0);
      expect(primary.right).toBeLessThanOrEqual(viewport.width);
      expect(primary.bottom).toBeLessThanOrEqual(viewport.height);
      expect(primary.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(primary.background).toBe("rgb(0, 122, 255)");
      expect(primary.opacity).toBe("1");

      const sticky = await page.locator("[data-pcc-planning-progress]").evaluate((progress) => {
        const rect = progress.getBoundingClientRect();
        const style = getComputedStyle(progress);
        return {
          top: rect.top,
          background: style.backgroundColor,
          opacity: style.opacity,
          overflow: style.overflow,
        };
      });
      expect(sticky.top).toBeGreaterThanOrEqual(0);
      expect(sticky.background).not.toContain("rgba");
      expect(sticky.opacity).toBe("1");
      expect(sticky.overflow).toBe("hidden");

      await page.locator("[data-pcc-local-model]").focus();
      const modelLayout = await page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>("[data-pcc-model-grid]");
        const local = document.querySelector<HTMLElement>("[data-pcc-local-model]");
        const codex = document.querySelector<HTMLElement>("[data-pcc-codex-model]");
        if (!grid || !local || !codex) {
          throw new Error("Missing model controls");
        }
        const gridRect = grid.getBoundingClientRect();
        const localRect = local.getBoundingClientRect();
        const codexRect = codex.getBoundingClientRect();
        return {
          contained: localRect.left >= gridRect.left && codexRect.right <= gridRect.right,
          separated: localRect.right <= codexRect.left || localRect.bottom <= codexRect.top,
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(modelLayout.contained).toBe(true);
      expect(modelLayout.separated).toBe(true);
      expect(modelLayout.pageOverflow).toBe(false);
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  });
});

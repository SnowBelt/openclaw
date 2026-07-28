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
          <div style="height: 680px"></div>
        </section>
        <footer>
          <button
            class="btn pcc-editor-primary-action pcc-editor-primary-action--generate"
            data-pcc-create-review-plan
            type="button"
          >
            <span class="pcc-editor-primary-action__mark" aria-hidden="true">✦</span>
            <span class="pcc-editor-primary-action__copy">
              <strong>Generate project plan</strong>
              <small>Next: review the milestones before anything is created</small>
            </span>
            <span class="pcc-editor-primary-action__arrow" aria-hidden="true">→</span>
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
        const parseRgb = (value: string) =>
          value
            .match(/\d+(?:\.\d+)?/gu)
            ?.slice(0, 3)
            .map(Number) ?? [0, 0, 0];
        const luminance = (rgb: number[]) => {
          const channels = rgb.map((value) => {
            const normalized = value / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : Math.pow((normalized + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
        };
        const foreground = luminance(parseRgb(style.color));
        const background = luminance(parseRgb(style.backgroundColor));
        const contrast =
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        return {
          bottom: rect.bottom,
          contrast,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
          opacity: style.opacity,
        };
      });

      expect(primary.height).toBeGreaterThanOrEqual(64);
      expect(primary.left).toBeGreaterThanOrEqual(0);
      expect(primary.right).toBeLessThanOrEqual(viewport.width);
      expect(primary.bottom).toBeLessThanOrEqual(viewport.height);
      expect(primary.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(primary.boxShadow).not.toBe("none");
      expect(primary.contrast).toBeGreaterThanOrEqual(4.5);
      expect(primary.opacity).toBe("1");
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  });
});

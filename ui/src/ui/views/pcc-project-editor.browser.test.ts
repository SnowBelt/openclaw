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

function dashboardHtml(): string {
  return `
    <main class="pcc-shell">
      <div class="pcc-callout pcc-callout--success" data-pcc-action-notice>
        <div>
          <strong>Saved and refreshed</strong>
          <span>Project created. Start with the first safe milestone.</span>
          <small>PCC reloaded the project after this change.</small>
        </div>
        <div class="pcc-callout__actions">
          <button class="btn btn--subtle">Refresh now</button>
          <button class="btn btn--subtle">Dismiss</button>
        </div>
      </div>
      <section class="pcc-today">
        <div class="pcc-today__bar">
          <div class="pcc-today__bar-title">
            <span>Today</span>
            <strong>PCC Product</strong>
            <strong>0 running</strong>
            <strong>0 Needs You</strong>
            <strong>Quality Proof pending</strong>
          </div>
          <p class="pcc-today__plain-summary">
            PCC is current. One project-specific item is outside PCC Product.
          </p>
          <button class="pcc-today__next">
            <span>Next</span>
            <strong>No ready action</strong>
          </button>
          <details class="pcc-today__metrics-more"><summary>More</summary></details>
        </div>
      </section>
      <div class="pcc-layout">
        <section class="pcc-projects">
          <section class="pcc-project-focus-bar">
            <div class="pcc-project-focus-bar__top">
              <nav class="pcc-project-tabs">
                <button class="is-selected">Active 1</button>
                <button>Needs You 0</button>
                <button>On Hold 0</button>
                <button>Archived 0</button>
                <button>All 2</button>
              </nav>
              <span>1 shown</span>
            </div>
            <section class="pcc-project-search">
              <div class="pcc-project-search__scope">
                <span>Searching: Active</span>
                <button class="btn btn--subtle">Search all</button>
              </div>
              <label>
                <span>Search Active projects</span>
                <input type="search" placeholder="Search projects" />
              </label>
              <span class="pcc-project-search__count">1 shown</span>
            </section>
          </section>
        </section>
        <section class="pcc-workspace">
          <nav class="pcc-project-orientation">
            <div class="pcc-project-orientation__crumbs">
              <span>Project Command Center</span><span>›</span>
              <strong>Kin Clash: SNES Arena</strong><span>›</span>
              <span>Lock the lawful MVP specification and source assets</span>
            </div>
            <dl class="pcc-project-orientation__facts">
              <div><dt>Health</dt><dd>On track</dd></div>
              <div><dt>Priority</dt><dd>3</dd></div>
              <div><dt>Due</dt><dd>No due date</dd></div>
              <div><dt>Recent</dt><dd>Permission needed · Updated 7:17 PM</dd></div>
              <div><dt>Current</dt><dd>Lock the lawful MVP specification and source assets</dd></div>
              <div><dt>Next</dt><dd>Establish the reproducible SNES development baseline</dd></div>
            </dl>
          </nav>
          <section class="pcc-project-snapshot">
            <div class="pcc-project-snapshot__header">
              <div><p class="pcc-kicker">Project Snapshot</p><h3>Kin Clash: SNES Arena</h3></div>
              <div class="pcc-project-snapshot__badges">
                <span class="pcc-status">Project Work</span>
                <span class="pcc-proof-badge">Current proof: Ready</span>
              </div>
            </div>
            <section class="pcc-execution-profile-chip">
              <div>
                <span>How this project runs</span>
                <strong>Parallel</strong>
                <small>6 OpenClaw workers · Best configured local model · Recommended minimum</small>
                <small>Codex: Best available from Codex · Medium normally · High automatic maximum</small>
              </div>
              <button class="btn btn--subtle">Change</button>
            </section>
          </section>
        </section>
      </div>
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

  it.each([
    { name: "MacBook", viewport: { width: 1440, height: 900 } },
    { name: "compact laptop", viewport: { width: 1180, height: 820 } },
  ])("keeps dense dashboard groups readable and collision-free on $name", async ({ viewport }) => {
    const browser = await chromium.launch({
      executablePath: chromiumExecutablePath,
      headless: true,
    });
    const page = await browser.newPage({ viewport });
    try {
      await page.setContent(
        `<!doctype html><html data-theme-mode="light"><head><style>${readPccCss()}</style></head><body>${dashboardHtml()}</body></html>`,
      );
      const result = await page.evaluate(() => {
        const selectors = [
          "[data-pcc-action-notice]",
          ".pcc-today__bar",
          ".pcc-project-focus-bar__top",
          ".pcc-project-search",
          ".pcc-project-orientation__facts",
          ".pcc-project-snapshot__header",
          ".pcc-execution-profile-chip",
        ];
        const overlaps: string[] = [];
        for (const selector of selectors) {
          for (const group of document.querySelectorAll<HTMLElement>(selector)) {
            const children = [...group.children].filter(
              (child): child is HTMLElement =>
                child instanceof HTMLElement && child.getBoundingClientRect().height > 0,
            );
            for (let index = 0; index < children.length; index += 1) {
              const first = children[index]!.getBoundingClientRect();
              for (const sibling of children.slice(index + 1)) {
                const second = sibling.getBoundingClientRect();
                if (
                  first.left < second.right - 1 &&
                  first.right > second.left + 1 &&
                  first.top < second.bottom - 1 &&
                  first.bottom > second.top + 1
                ) {
                  overlaps.push(selector);
                }
              }
            }
          }
        }
        const projectPane = document.querySelector<HTMLElement>(".pcc-projects");
        const search = document.querySelector<HTMLInputElement>(".pcc-project-search input");
        const facts = document.querySelector<HTMLElement>(".pcc-project-orientation__facts");
        return {
          factColumns: facts ? getComputedStyle(facts).gridTemplateColumns.split(" ").length : 0,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          overlaps,
          projectPaneWidth: projectPane?.getBoundingClientRect().width ?? 0,
          searchWidth: search?.getBoundingClientRect().width ?? 0,
        };
      });

      expect(result.horizontalOverflow).toBe(false);
      expect(result.overlaps).toEqual([]);
      expect(result.factColumns).toBeLessThanOrEqual(3);
      expect(result.projectPaneWidth).toBeGreaterThanOrEqual(290);
      expect(result.searchWidth).toBeGreaterThanOrEqual(180);
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  });
});

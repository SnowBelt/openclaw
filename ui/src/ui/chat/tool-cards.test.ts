/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderToolCard, resolveToolCardPresentation } from "./tool-cards.ts";

vi.mock("../icons.ts", () => ({
  icons: {},
}));

vi.mock("../tool-display.ts", () => ({
  formatToolDetail: () => undefined,
  resolveToolDisplay: ({ name }: { name: string }) => ({
    name,
    label: name
      .split(/[._-]/g)
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
      .join(" "),
    icon: "zap",
  }),
}));

describe("tool-cards", () => {
  it("renders expanded cards with inline input and output sections", () => {
    const container = document.createElement("div");
    const toggle = vi.fn();
    render(
      renderToolCard(
        {
          id: "msg:4:call-4",
          name: "browser.open",
          args: { url: "https://example.com" },
          inputText: '{\n  "url": "https://example.com"\n}',
          outputText: "Opened page",
        },
        { expanded: true, onToggleExpanded: toggle },
      ),
      container,
    );

    expect(container.textContent).toContain("Tool input");
    expect(container.textContent).toContain("Tool output");
    expect(container.textContent).toContain("https://example.com");
    expect(container.textContent).toContain("Opened page");
  });

  it("renders expanded tool calls without an inline output block when no output is present", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "msg:4b:call-4b",
          name: "sessions_spawn",
          args: { mode: "session", thread: true },
          inputText: '{\n  "mode": "session",\n  "thread": true\n}',
        },
        { expanded: true, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    expect(container.textContent).toContain("Tool input");
    expect(container.textContent).toContain('"thread": true');
    expect(container.textContent).not.toContain("Tool output");
    expect(container.textContent).not.toContain("No output");
  });

  it("labels collapsed tool calls as tool call", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "msg:5:call-5",
          name: "sessions_spawn",
          args: { mode: "run" },
          inputText: '{\n  "mode": "run"\n}',
        },
        { expanded: false, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    expect(container.textContent).toContain("Tool call");
    expect(container.textContent).not.toContain("Tool input");
    const summaryButton = container.querySelector("button.chat-tool-msg-summary");
    expect(summaryButton?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps raw details for legacy canvas tool output without rendering tool-row previews", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "msg:view:7",
          name: "canvas_render",
          outputText: JSON.stringify({
            kind: "canvas",
            view: {
              backend: "canvas",
              id: "cv_counter",
              url: "/__openclaw__/canvas/documents/cv_counter/index.html",
              title: "Counter demo",
              preferred_height: 480,
            },
            presentation: {
              target: "tool_card",
            },
          }),
          preview: {
            kind: "canvas",
            surface: "assistant_message",
            render: "url",
            viewId: "cv_counter",
            title: "Counter demo",
            url: "/__openclaw__/canvas/documents/cv_counter/index.html",
            preferredHeight: 480,
          },
        },
        { expanded: true, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    const rawToggle = container.querySelector<HTMLButtonElement>(".chat-tool-card__raw-toggle");
    const rawBody = container.querySelector<HTMLElement>(".chat-tool-card__raw-body");

    expect(container.textContent).toContain("Counter demo");
    expect(container.querySelector(".chat-tool-card__preview-frame")).toBeNull();
    expect(rawToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(rawBody?.hidden).toBe(true);

    expect(rawToggle).toBeInstanceOf(HTMLButtonElement);
    rawToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(rawToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(rawBody?.hidden).toBe(false);
    expect(rawBody?.textContent).toContain('"kind":"canvas"');
  });

  it("opens assistant-surface canvas payloads in the sidebar when explicitly requested", () => {
    const container = document.createElement("div");
    const onOpenSidebar = vi.fn();
    render(
      renderToolCard(
        {
          id: "msg:view:8",
          name: "canvas_render",
          outputText: JSON.stringify({
            kind: "canvas",
            view: {
              backend: "canvas",
              id: "cv_sidebar",
              url: "/__openclaw__/canvas/documents/cv_sidebar/index.html",
              title: "Player",
              preferred_height: 360,
            },
            presentation: {
              target: "assistant_message",
            },
          }),
          preview: {
            kind: "canvas",
            surface: "assistant_message",
            render: "url",
            viewId: "cv_sidebar",
            url: "/__openclaw__/canvas/documents/cv_sidebar/index.html",
            title: "Player",
            preferredHeight: 360,
          },
        },
        { expanded: true, onToggleExpanded: vi.fn(), onOpenSidebar },
      ),
      container,
    );

    const sidebarButton = container.querySelector<HTMLButtonElement>(".chat-tool-card__action-btn");
    expect(sidebarButton).toBeInstanceOf(HTMLButtonElement);
    expect(sidebarButton?.classList.contains("chat-tool-card__action-btn")).toBe(true);
    sidebarButton!.click();

    expect(onOpenSidebar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "canvas",
        docId: "cv_sidebar",
        entryUrl: "/__openclaw__/canvas/documents/cv_sidebar/index.html",
      }),
    );
  });

  it("renders command cards with verified exit-code evidence", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "cmd:1",
          name: "system.run",
          args: { command: "echo tool-card-ok", cwd: "/repo" },
          inputText: JSON.stringify({
            command: "echo tool-card-ok",
            cwd: "/repo",
          }),
          outputText: JSON.stringify({
            exitCode: 0,
            durationMs: 1234,
            stdout: "tool-card-ok",
          }),
        },
        { expanded: true, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    expect(container.textContent).toContain("Command");
    expect(container.textContent).toContain("Passed");
    expect(container.textContent).toContain("Exit");
    expect(container.textContent).toContain("0");
    expect(container.textContent).toContain("1.2s");
    expect(container.textContent).toContain("tool-card-ok");
  });

  it("renders proof cards from workflow evidence without inferring success from prose", () => {
    const passed = resolveToolCardPresentation({
      id: "proof:1",
      name: "github.run",
      outputText: JSON.stringify({
        workflow: "Workflow Sanity",
        runId: "27818122460",
        runUrl: "https://github.com/SnowBelt/openclaw/actions/runs/27818122460",
        headSha: "0963807b1a",
        conclusion: "success",
      }),
    });
    const unknown = resolveToolCardPresentation({
      id: "proof:2",
      name: "github.run",
      outputText: "Remote proof passed, allegedly.",
    });

    expect(passed.kind).toBe("proof");
    expect(passed.status).toBe("passed");
    expect(unknown.kind).toBe("proof");
    expect(unknown.status).toBe("unknown");
  });

  it("renders failed command cards from nonzero exit codes", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "cmd:failed",
          name: "exec.command",
          args: { command: "node missing-script.js" },
          outputText: JSON.stringify({
            exitCode: 1,
            stderr: "missing-script failed",
          }),
        },
        { expanded: true, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    expect(container.textContent).toContain("Command");
    expect(container.textContent).toContain("Failed");
    expect(container.textContent).toContain("missing-script failed");
  });

  it("renders artifact cards with path evidence and preserves raw details", () => {
    const container = document.createElement("div");
    const onOpenSidebar = vi.fn();
    render(
      renderToolCard(
        {
          id: "artifact:1",
          name: "artifacts.write",
          outputText: JSON.stringify({
            title: "Smoke summary",
            kind: "report",
            artifactPath: ".artifacts/chat-tool-proof/summary.json",
            ok: true,
            summary: "Artifact summary was written.",
          }),
        },
        { expanded: true, onToggleExpanded: vi.fn(), onOpenSidebar },
      ),
      container,
    );

    expect(container.textContent).toContain("Smoke summary");
    expect(container.textContent).toContain("Artifact");
    expect(container.textContent).toContain(".artifacts/chat-tool-proof/summary.json");
    expect(container.textContent).toContain("Artifact summary was written.");

    const sidebarButton = container.querySelector<HTMLButtonElement>(".chat-tool-card__action-btn");
    expect(sidebarButton).toBeInstanceOf(HTMLButtonElement);
    sidebarButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSidebar).toHaveBeenCalledWith(expect.objectContaining({ kind: "markdown" }));
  });
});

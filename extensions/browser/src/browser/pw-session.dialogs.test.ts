// Browser tests cover pw sessionialogs plugin behavior.
import { MAX_DATE_TIMESTAMP_MS } from "openclaw/plugin-sdk/number-runtime";
import type { Dialog, Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armObservedDialogResponseOnPage,
  createObservedDialogAbortSignalForPage,
  ensurePageState,
  getObservedBrowserStateForPage,
  isBrowserObservedDialogBlockedError,
  markObservedDialogsHandledRemotelyForPage,
  respondToObservedDialogOnPage,
} from "./pw-session.js";

type Handler = (arg: unknown) => void;

function createPageHarness(initialUrl = "https://example.com/page") {
  const handlers = new Map<string, Handler[]>();
  let currentUrl = initialUrl;
  let frames = [
    {
      url: () => currentUrl,
      parentFrame: () => null,
      evaluate: async () => new URL(currentUrl).origin,
    },
  ];
  const page = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return page;
    },
    url: () => currentUrl,
    frames: () => frames,
  };
  return {
    page: page as unknown as Page,
    setUrl: (url: string) => {
      currentUrl = url;
    },
    setFrames: (nextFrames: typeof frames) => {
      frames = nextFrames;
    },
    emit: (event: string, arg: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(arg);
      }
    },
  };
}

function createDialog(
  overrides: Partial<{
    type: string;
    message: string;
    defaultValue: string;
  }> = {},
) {
  return {
    type: vi.fn(() => overrides.type ?? "confirm"),
    message: vi.fn(() => overrides.message ?? "Continue?"),
    defaultValue: vi.fn(() => overrides.defaultValue ?? ""),
    accept: vi.fn(async (_promptText?: string) => {}),
    dismiss: vi.fn(async () => {}),
  } as unknown as Dialog & {
    accept: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };
}

describe("observed browser dialogs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces pending dialogs and lets callers respond by id", async () => {
    const { page, emit } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ message: "Ship it?" });

    emit("dialog", dialog);

    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toMatchObject([
      { id: "d1", type: "confirm", message: "Ship it?" },
    ]);

    const closed = await respondToObservedDialogOnPage({
      page,
      dialogId: "d1",
      accept: true,
      promptText: "yes",
    });

    expect(dialog.accept).toHaveBeenCalledWith("yes");
    expect(closed.closedBy).toBe("agent");
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toEqual([]);
    expect((await getObservedBrowserStateForPage(page)).dialogs.recent).toMatchObject([
      { id: "d1", closedBy: "agent" },
    ]);
  });

  it("keeps arm-next-dialog behavior through the observed dialog path", async () => {
    const { page, emit } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ type: "alert", message: "Heads up" });
    const observed = createObservedDialogAbortSignalForPage({ page });

    armObservedDialogResponseOnPage({ page, accept: false, timeoutMs: 1000 });
    emit("dialog", dialog);
    await Promise.resolve();

    expect(observed.signal.aborted).toBe(false);
    expect(dialog.dismiss).toHaveBeenCalledOnce();
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toEqual([]);
    expect((await getObservedBrowserStateForPage(page)).dialogs.recent).toMatchObject([
      { id: "d1", type: "alert", closedBy: "armed" },
    ]);
    observed.cleanup();
  });

  it("does not respond to a pending dialog after the approved origin changes", async () => {
    const { page, emit, setUrl } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ type: "prompt", message: "Sensitive input" });
    emit("dialog", dialog);
    setUrl("https://other.example/page");

    await expect(
      respondToObservedDialogOnPage({
        page,
        dialogId: "d1",
        accept: true,
        promptText: "should-not-be-sent",
        approvedOrigin: "https://example.com",
      }),
    ).rejects.toThrow("approved origin changed");
    expect(dialog.accept).not.toHaveBeenCalled();
    expect(dialog.dismiss).not.toHaveBeenCalled();
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toHaveLength(1);
  });

  it("does not deliver approved prompt text to a cross-origin dialog frame", async () => {
    const { page, emit, setFrames } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ type: "prompt", message: "Sensitive input" });
    emit("dialog", dialog);
    setFrames([
      {
        url: () => "https://example.com/page",
        parentFrame: () => null,
        evaluate: async () => "https://example.com",
      },
      {
        url: () => "https://evil.example/collect",
        parentFrame: () => null,
        evaluate: async () => "https://evil.example",
      },
    ]);

    await expect(
      respondToObservedDialogOnPage({
        page,
        dialogId: "d1",
        accept: true,
        promptText: "should-not-be-sent",
        approvedOrigin: "https://example.com",
      }),
    ).rejects.toThrow("approved dialog origin could not be verified");
    expect(dialog.accept).not.toHaveBeenCalled();
    expect(dialog.dismiss).not.toHaveBeenCalled();
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toHaveLength(1);
  });

  it("rejects an approved non-prompt dialog from a cross-origin frame", async () => {
    const { page, emit, setFrames } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ type: "confirm", message: "Continue?" });
    emit("dialog", dialog);
    setFrames([
      {
        url: () => "https://example.com/page",
        parentFrame: () => null,
        evaluate: async () => "https://example.com",
      },
      {
        url: () => "https://evil.example/collect",
        parentFrame: () => null,
        evaluate: async () => "https://evil.example",
      },
    ]);

    await expect(
      respondToObservedDialogOnPage({
        page,
        dialogId: "d1",
        accept: true,
        approvedOrigin: "https://example.com",
      }),
    ).rejects.toThrow("approved dialog origin could not be verified");
    expect(dialog.accept).not.toHaveBeenCalled();
    expect(dialog.dismiss).not.toHaveBeenCalled();
  });

  it("dismisses an armed dialog when the page changes origin before it appears", async () => {
    const { page, emit, setUrl } = createPageHarness();
    ensurePageState(page);
    armObservedDialogResponseOnPage({
      page,
      accept: true,
      promptText: "should-not-be-sent",
      approvedOrigin: "https://example.com",
      timeoutMs: 1000,
    });
    setUrl("https://other.example/page");
    const dialog = createDialog({ type: "prompt", message: "Sensitive input" });
    emit("dialog", dialog);
    await Promise.resolve();

    expect(dialog.accept).not.toHaveBeenCalled();
    expect(dialog.dismiss).toHaveBeenCalledOnce();
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toEqual([]);
  });

  it("uses the default arm-next-dialog timeout for non-finite timeoutMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { page, emit } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ type: "alert", message: "Still armed" });
    const observed = createObservedDialogAbortSignalForPage({ page });

    armObservedDialogResponseOnPage({ page, accept: false, timeoutMs: Number.NaN });
    await vi.advanceTimersByTimeAsync(119_999);
    emit("dialog", dialog);
    await Promise.resolve();

    expect(observed.signal.aborted).toBe(false);
    expect(dialog.dismiss).toHaveBeenCalledOnce();
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toEqual([]);
    expect((await getObservedBrowserStateForPage(page)).dialogs.recent).toMatchObject([
      { id: "d1", type: "alert", closedBy: "armed" },
    ]);
    observed.cleanup();
  });

  it("does not arm next-dialog responses while the process clock is invalid", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(Number.NaN);
      const { page, emit } = createPageHarness();
      ensurePageState(page);
      const dialog = createDialog({ type: "alert", message: "Still pending" });

      armObservedDialogResponseOnPage({ page, accept: false, timeoutMs: 1000 });
      emit("dialog", dialog);

      expect(dialog.dismiss).not.toHaveBeenCalled();
      expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toMatchObject([
        { id: "d1", type: "alert", message: "Still pending" },
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not arm next-dialog responses when the expiry would overflow Date bounds", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(MAX_DATE_TIMESTAMP_MS);
      const { page, emit } = createPageHarness();
      ensurePageState(page);
      const dialog = createDialog({ type: "alert", message: "Still pending" });

      armObservedDialogResponseOnPage({ page, accept: false, timeoutMs: 1000 });
      emit("dialog", dialog);

      expect(dialog.dismiss).not.toHaveBeenCalled();
      expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toMatchObject([
        { id: "d1", type: "alert", message: "Still pending" },
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("aborts in-flight actions while keeping unarmed dialogs pending", async () => {
    const { page, emit } = createPageHarness();
    ensurePageState(page);
    const dialog = createDialog({ type: "alert", message: "Heads up" });
    const observed = createObservedDialogAbortSignalForPage({ page });

    emit("dialog", dialog);

    expect(observed.signal.aborted).toBe(true);
    expect(isBrowserObservedDialogBlockedError(observed.signal.reason)).toBe(true);
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toMatchObject([
      { id: "d1", type: "alert", message: "Heads up" },
    ]);

    expect(dialog.dismiss).not.toHaveBeenCalled();
    await respondToObservedDialogOnPage({ page, dialogId: "d1", accept: false });
    observed.cleanup();

    expect(dialog.dismiss).toHaveBeenCalledOnce();
    expect((await getObservedBrowserStateForPage(page)).dialogs.pending).toEqual([]);
    expect((await getObservedBrowserStateForPage(page)).dialogs.recent).toMatchObject([
      { id: "d1", type: "alert", closedBy: "agent" },
    ]);
  });

  it("moves remotely handled pending dialogs into recent state", () => {
    const { page, emit } = createPageHarness();
    ensurePageState(page);
    emit("dialog", createDialog({ type: "confirm", message: "Continue?" }));

    const state = markObservedDialogsHandledRemotelyForPage(page);

    expect(state.dialogs.pending).toEqual([]);
    expect(state.dialogs.recent).toMatchObject([
      { id: "d1", type: "confirm", message: "Continue?", closedBy: "remote" },
    ]);
  });
});

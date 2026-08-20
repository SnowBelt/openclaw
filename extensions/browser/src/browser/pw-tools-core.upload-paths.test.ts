// Browser tests cover pw tools core.upload paths plugin behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPwToolsCoreTestHooks,
  setPwToolsCoreCurrentPage,
} from "./pw-tools-core.test-harness.js";

const pathMocks = vi.hoisted(() => ({
  resolveStrictExistingUploadPaths:
    vi.fn<
      (args: {
        requestedPaths: string[];
      }) => Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>
    >(),
}));

vi.mock("./paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./paths.js")>();
  return {
    ...actual,
    resolveStrictExistingUploadPaths: pathMocks.resolveStrictExistingUploadPaths,
  };
});

installPwToolsCoreTestHooks();
const { armFileUploadViaPlaywright } = await import("./pw-tools-core.downloads.js");

function createFileChooserPageMocks(ownerFrameUrl?: () => string) {
  const press = vi.fn(async () => {});
  let currentUrl = "https://example.com/page";
  const frameUrl = ownerFrameUrl ?? (() => currentUrl);
  const page = {
    keyboard: { press },
    url: () => currentUrl,
  } as Record<string, unknown>;
  const ownerFrame = {
    url: frameUrl,
    parentFrame: () => null,
  };
  const element = {
    ownerFrame: vi.fn(async () => ownerFrame),
    evaluate: vi.fn(async () => {}),
  };
  const fileChooser = {
    setFiles: vi.fn(async () => {}),
    page: () => page,
    element: vi.fn(async () => element),
  };
  const waitForEvent = vi.fn(async () => fileChooser);
  page.waitForEvent = waitForEvent;
  setPwToolsCoreCurrentPage(page);
  return { fileChooser, press, setUrl: (url: string) => (currentUrl = url) };
}

describe("armFileUploadViaPlaywright upload path validation", () => {
  beforeEach(() => {
    pathMocks.resolveStrictExistingUploadPaths.mockResolvedValue({
      ok: true,
      paths: ["/home/user/.openclaw/media/inbound/report.pdf"],
    });
  });

  it("sets files using resolved inbound media paths", async () => {
    const { fileChooser } = createFileChooserPageMocks();

    await armFileUploadViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      paths: ["/home/user/.openclaw/media/inbound/report.pdf"],
    });
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(fileChooser.setFiles).toHaveBeenCalledWith([
        "/home/user/.openclaw/media/inbound/report.pdf",
      ]);
    });
  });

  it("escapes the chooser when paths are outside managed upload roots", async () => {
    pathMocks.resolveStrictExistingUploadPaths.mockResolvedValue({
      ok: false,
      error: "Invalid path: must stay within inbound media directory",
    });
    const { fileChooser, press } = createFileChooserPageMocks();

    await armFileUploadViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      paths: ["/etc/passwd"],
    });
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(press).toHaveBeenCalledWith("Escape");
    });
    expect(fileChooser.setFiles).not.toHaveBeenCalled();
  });

  it("does not submit files after the approved origin changes", async () => {
    const fileChooser = { setFiles: vi.fn(async () => {}) };
    const press = vi.fn(async () => {});
    let resolveChooser: ((value: typeof fileChooser) => void) | undefined;
    const waitForEvent = vi.fn(
      () =>
        new Promise<typeof fileChooser>((resolve) => {
          resolveChooser = resolve;
        }),
    );
    let currentUrl = "https://example.com/page";
    setPwToolsCoreCurrentPage({
      waitForEvent,
      keyboard: { press },
      url: () => currentUrl,
    });

    await armFileUploadViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      paths: ["/home/user/.openclaw/media/inbound/report.pdf"],
      approvedOrigin: "https://example.com",
    });
    currentUrl = "https://other.example/page";
    resolveChooser?.(fileChooser);
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(press).toHaveBeenCalledWith("Escape");
    });
    expect(fileChooser.setFiles).not.toHaveBeenCalled();
  });

  it("escapes the chooser when its element belongs to a different origin", async () => {
    const { fileChooser, press } = createFileChooserPageMocks(() => "https://evil.example/collect");

    await armFileUploadViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      paths: ["/home/user/.openclaw/media/inbound/report.pdf"],
      approvedOrigin: "https://example.com",
    });
    await vi.waitFor(() => {
      expect(press).toHaveBeenCalledWith("Escape");
    });
    expect(fileChooser.setFiles).not.toHaveBeenCalled();
  });
});

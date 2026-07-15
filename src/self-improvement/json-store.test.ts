import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  withSelfImprovementStoreMutation,
  writeSelfImprovementJsonAtomically,
} from "./json-store.js";

let tmpDir: string;

describe("Self-Improvement atomic JSON writer", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-self-improvement-json-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes owner-only canonical JSON and leaves no temporary file", async () => {
    const filePath = path.join(tmpDir, "store.json");

    await writeSelfImprovementJsonAtomically(filePath, { version: 1, ok: true });

    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual({ version: 1, ok: true });
    expect((await fs.readdir(tmpDir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans up its temporary file when replacement fails", async () => {
    const filePath = path.join(tmpDir, "store.json");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("simulated rename failure"));

    await expect(writeSelfImprovementJsonAtomically(filePath, { version: 1 })).rejects.toThrow(
      "simulated rename failure",
    );
    expect((await fs.readdir(tmpDir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("serializes same-store mutations and releases the next caller after a failure", async () => {
    const filePath = path.join(tmpDir, "store.json");
    const events: string[] = [];

    const first = withSelfImprovementStoreMutation(filePath, async () => {
      events.push("first:start");
      await Promise.resolve();
      events.push("first:end");
      throw new Error("first mutation failed");
    });
    const second = withSelfImprovementStoreMutation(filePath, async () => {
      events.push("second:start");
      events.push("second:end");
      return "ok";
    });

    await expect(first).rejects.toThrow("first mutation failed");
    await expect(second).resolves.toBe("ok");
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("does not block mutations for a different store path", async () => {
    const firstPath = path.join(tmpDir, "first.json");
    const secondPath = path.join(tmpDir, "second.json");
    let releaseFirst: (() => void) | undefined;
    let signalFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const first = withSelfImprovementStoreMutation(firstPath, async () => {
      signalFirstStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    await firstStarted;
    const second = withSelfImprovementStoreMutation(secondPath, async () => "second");

    await expect(second).resolves.toBe("second");
    releaseFirst?.();
    await expect(first).resolves.toBeUndefined();
  });
});

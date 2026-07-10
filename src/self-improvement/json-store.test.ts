import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSelfImprovementJsonAtomically } from "./json-store.js";

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
});

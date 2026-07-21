import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSubagentTaskRoot } from "./subagent-task-root.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })),
  );
});

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanup.push(directory);
  return directory;
}

describe("subagent task-root confinement", () => {
  it("inherits the canonical approved root and emits only a sanitized receipt", async () => {
    const root = await tempDirectory("openclaw-task-root-");
    const result = await resolveSubagentTaskRoot({ approvedRoot: root });

    expect(result).toMatchObject({
      ok: true,
      effectiveCwd: await fs.realpath(root),
      receipt: {
        schemaVersion: 1,
        source: "inherited",
        scope: "task_root",
      },
    });
    if (result.ok) {
      expect(result.receipt?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(JSON.stringify(result.receipt)).not.toContain(root);
    }
  });

  it("allows a real descendant but rejects an outside directory before launch", async () => {
    const root = await tempDirectory("openclaw-task-root-");
    const child = path.join(root, "packages", "worker");
    await fs.mkdir(child, { recursive: true });
    const outside = await tempDirectory("openclaw-task-outside-");

    await expect(
      resolveSubagentTaskRoot({ approvedRoot: root, requestedCwd: child }),
    ).resolves.toMatchObject({
      ok: true,
      effectiveCwd: await fs.realpath(child),
      receipt: { source: "requested", scope: "descendant" },
    });
    const rejected = await resolveSubagentTaskRoot({ approvedRoot: root, requestedCwd: outside });
    expect(rejected).toMatchObject({ ok: false, code: "task_root_mismatch" });
    expect(JSON.stringify(rejected)).not.toContain(root);
    expect(JSON.stringify(rejected)).not.toContain(outside);
  });

  it("rejects a symlink escape and a missing requested directory", async () => {
    const root = await tempDirectory("openclaw-task-root-");
    const outside = await tempDirectory("openclaw-task-outside-");
    const link = path.join(root, "escape");
    await fs.symlink(outside, link);

    await expect(
      resolveSubagentTaskRoot({ approvedRoot: root, requestedCwd: link }),
    ).resolves.toMatchObject({ ok: false, code: "task_root_mismatch" });
    await expect(
      resolveSubagentTaskRoot({ approvedRoot: root, requestedCwd: path.join(root, "missing") }),
    ).resolves.toMatchObject({ ok: false, code: "task_root_unavailable" });
  });
});

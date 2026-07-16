import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const updater = path.resolve("scripts/custom-runtime/custom-runtime-updater.sh");
const approve = path.resolve("scripts/custom-runtime/custom-runtime-update-approve.sh");
const temporaryDirectories: string[] = [];

function root(prefix: string): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(value);
  return fs.realpathSync(value);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function latestUpdateReceipt(runtimeHome: string): Record<string, unknown> {
  const receipt = fs
    .readdirSync(path.join(runtimeHome, "receipts"))
    .filter((name) => name.startsWith("update-") && name.endsWith(".json"))
    .toSorted()
    .at(-1);
  if (!receipt) {
    throw new Error("expected update receipt");
  }
  return JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", receipt), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime update broker", () => {
  it("rejects a provenance-only active source before network or build work", () => {
    const base = root("openclaw-update-broker-source-");
    const runtimeHome = path.join(base, "runtime-home");
    const repo = path.join(base, "source");
    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      sourceSha: "a".repeat(64),
      sourceRepo: repo,
      sourceBranch: "codex/custom-runtime",
    });

    const result = spawnSync(updater, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES: path.join(base, "updates"),
      },
    });

    expect(result.status).toBe(1);
    expect(latestUpdateReceipt(runtimeHome)).toMatchObject({
      result: "failed",
      stage: "durable_source_sha",
    });
  });

  it("rejects a dirty canonical source checkout", () => {
    const base = root("openclaw-update-broker-dirty-");
    const runtimeHome = path.join(base, "runtime-home");
    const repo = path.join(base, "source");
    fs.mkdirSync(repo, { recursive: true });
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", repo, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(repo, "README.md"), "source\n");
    expect(spawnSync("git", ["-C", repo, "add", "README.md"]).status).toBe(0);
    expect(spawnSync("git", ["-C", repo, "commit", "-qm", "source"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    fs.writeFileSync(path.join(repo, "untracked.txt"), "dirty\n");
    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      sourceSha,
      sourceRepo: repo,
      sourceBranch: "HEAD",
    });

    const result = spawnSync(updater, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES: path.join(base, "updates"),
      },
    });

    expect(result.status).toBe(1);
    expect(latestUpdateReceipt(runtimeHome)).toMatchObject({
      result: "failed",
      stage: "durable_source_dirty",
    });
  });

  it("rejects stale approval and promotes only an exact pending candidate", () => {
    const base = root("openclaw-update-broker-approve-");
    const runtimeHome = path.join(base, "runtime-home");
    const releases = path.join(base, "releases");
    const release = path.join(releases, "candidate");
    const marker = path.join(base, "activated.txt");
    const baseSha = "b".repeat(40);
    const sourceSha = "c".repeat(40);
    fs.mkdirSync(path.join(release, "scripts", "custom-runtime"), { recursive: true });
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-activate.sh"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(marker)}\n`,
      { mode: 0o700 },
    );
    writeJson(path.join(runtimeHome, "active-runtime.json"), { sourceSha: "d".repeat(40) });
    const pending = path.join(runtimeHome, "pending-update.json");
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo: path.join(base, "source"),
      sourceBranch: "codex/custom-runtime",
    });
    let result = spawnSync(approve, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("active runtime changed");
    expect(fs.existsSync(marker)).toBe(false);

    writeJson(path.join(runtimeHome, "active-runtime.json"), { sourceSha: baseSha });
    fs.mkdirSync(path.join(base, "source"), { recursive: true });
    result = spawnSync(approve, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(marker, "utf8")).toContain("--source-sha");
    expect(fs.existsSync(pending)).toBe(false);
    const approval = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .find((name) => name.startsWith("update-approval-"));
    expect(approval).toBeTruthy();
  });
});

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const script = path.resolve("scripts/custom-runtime/custom-runtime-source-migrate.sh");
const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);

function fixture() {
  const home = fs.realpathSync(temporaryDirectories.make("openclaw-source-migrate-"));
  const source = path.join(home, "current-source");
  const durableSourceRoot = path.join(home, "durable-source-root");
  const runtimeHome = path.join(home, ".openclaw-custom-runtime");
  const pointer = path.join(runtimeHome, "active-runtime.json");
  const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  const remote = path.join(home, "backup.git");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(durableSourceRoot, { recursive: true });
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  expect(spawnSync("git", ["init", "-q", source]).status).toBe(0);
  expect(
    spawnSync("git", ["-C", source, "config", "user.email", "test@example.invalid"]).status,
  ).toBe(0);
  expect(spawnSync("git", ["-C", source, "config", "user.name", "Test"]).status).toBe(0);
  fs.writeFileSync(path.join(source, "source.txt"), "source\n");
  expect(spawnSync("git", ["-C", source, "add", "source.txt"]).status).toBe(0);
  expect(spawnSync("git", ["-C", source, "commit", "-qm", "source"]).status).toBe(0);
  const sha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const branch = spawnSync("git", ["-C", source, "branch", "--show-current"], {
    encoding: "utf8",
  }).stdout.trim();
  expect(spawnSync("git", ["init", "--bare", "-q", remote]).status).toBe(0);
  expect(spawnSync("git", ["-C", source, "remote", "add", "backup", remote]).status).toBe(0);
  expect(
    spawnSync("git", ["-C", source, "push", "-q", "backup", `HEAD:refs/heads/${branch}`]).status,
  ).toBe(0);
  fs.writeFileSync(
    pointer,
    `${JSON.stringify({
      runtimeRoot: path.join(home, ".openclaw-runtime-releases", "active"),
      entrypoint: path.join(home, ".openclaw-runtime-releases", "active", "dist", "index.js"),
      sourceSha: sha,
      sourceRepo: source,
      sourceBranch: branch,
    })}\n`,
  );
  fs.writeFileSync(launcher, '#!/bin/sh\nexit "${OPENCLAW_TEST_LAUNCHER_STATUS:-0}"\n', {
    mode: 0o700,
  });
  return {
    branch,
    env: {
      ...process.env,
      HOME: home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
      OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: durableSourceRoot,
    },
    durableSourceRoot,
    home,
    pointer,
    runtimeHome,
    remote,
    sha,
    source,
    target: path.join(durableSourceRoot, "durable-source"),
  };
}

describe("custom runtime source migration", () => {
  it("plans without changing the pointer or creating a worktree", () => {
    const input = fixture();
    const before = fs.readFileSync(input.pointer, "utf8");
    const result = spawnSync(script, ["--target", input.target, "--remote", "backup"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: "plan",
      sourceSha: input.sha,
      sourceGitCommonDir: path.join(input.source, ".git"),
      sourceRemoteRef: `refs/heads/${input.branch}`,
      sourceRemoteSha: input.sha,
      targetGitCommonDir: path.join(input.target, ".git"),
      targetRepo: input.target,
      targetState: "new",
    });
    expect(fs.existsSync(input.target)).toBe(false);
    expect(fs.readFileSync(input.pointer, "utf8")).toBe(before);
  });

  it("creates a detached persistent worktree and updates provenance atomically", () => {
    const input = fixture();
    const result = spawnSync(script, ["--target", input.target, "--remote", "backup", "--apply"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(
      spawnSync("git", ["-C", input.target, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).stdout.trim(),
    ).toBe(input.sha);
    expect(
      spawnSync("git", ["-C", input.target, "rev-parse", `refs/heads/${input.branch}`], {
        encoding: "utf8",
      }).stdout.trim(),
    ).toBe(input.sha);
    const pointer = JSON.parse(fs.readFileSync(input.pointer, "utf8")) as Record<string, unknown>;
    expect(pointer).toMatchObject({
      sourceRepo: input.target,
      sourceGitCommonDir: path.join(input.target, ".git"),
      sourceSha: input.sha,
      sourceBranch: input.branch,
      sourceRemoteRef: `refs/heads/${input.branch}`,
      sourceRemoteSha: input.sha,
    });
    expect(pointer.sourceRemoteVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
    const receipt = fs
      .readdirSync(path.join(input.runtimeHome, "receipts"))
      .find((name) => name.startsWith("source-migration-"));
    expect(receipt).toBeTruthy();
    expect(
      JSON.parse(fs.readFileSync(path.join(input.runtimeHome, "receipts", receipt!), "utf8")),
    ).toMatchObject({
      result: "passed",
      sourceGitCommonDir: path.join(input.target, ".git"),
      sourceRepo: input.target,
      sourceSha: input.sha,
    });
    const lifecycleReceipt = fs
      .readdirSync(path.join(input.runtimeHome, "receipts"))
      .find((name) => name.startsWith("lifecycle-source-migration-"));
    expect(lifecycleReceipt).toBeTruthy();
    expect(
      JSON.parse(
        fs.readFileSync(path.join(input.runtimeHome, "receipts", lifecycleReceipt!), "utf8"),
      ),
    ).toMatchObject({
      operation: "source-migration",
      result: "source-migration-complete",
      exitCode: 0,
      activeSha: input.sha,
    });
    expect(fs.existsSync(path.join(input.runtimeHome, "locks", "lifecycle.lock"))).toBe(false);
  });

  it("resolves a legacy HEAD source branch before planning migration", () => {
    const input = fixture();
    const pointer = JSON.parse(fs.readFileSync(input.pointer, "utf8")) as Record<string, unknown>;
    pointer.sourceBranch = "HEAD";
    fs.writeFileSync(input.pointer, `${JSON.stringify(pointer)}\n`);

    const result = spawnSync(script, ["--target", input.target, "--remote", "backup"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: "plan",
      sourceBranch: input.branch,
      sourceRemoteRef: `refs/heads/${input.branch}`,
      sourceRemoteSha: input.sha,
    });
    expect(fs.existsSync(input.target)).toBe(false);
  });

  it("persists the resolved branch when applying a legacy HEAD pointer", () => {
    const input = fixture();
    const pointer = JSON.parse(fs.readFileSync(input.pointer, "utf8")) as Record<string, unknown>;
    pointer.sourceBranch = "HEAD";
    fs.writeFileSync(input.pointer, `${JSON.stringify(pointer)}\n`);

    const result = spawnSync(script, ["--target", input.target, "--remote", "backup", "--apply"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(input.pointer, "utf8"))).toMatchObject({
      sourceBranch: input.branch,
      sourceRepo: input.target,
      sourceSha: input.sha,
    });
  });

  it("restores the pointer and removes a newly created worktree when verification fails", () => {
    const input = fixture();
    const before = fs.readFileSync(input.pointer, "utf8");
    const result = spawnSync(script, ["--target", input.target, "--remote", "backup", "--apply"], {
      encoding: "utf8",
      env: { ...input.env, OPENCLAW_TEST_LAUNCHER_STATUS: "1" },
    });

    expect(result.status).toBe(1);
    expect(fs.readFileSync(input.pointer, "utf8")).toBe(before);
    expect(fs.existsSync(input.target)).toBe(false);
  });

  it("does not read or rewrite provenance while activation owns the lifecycle lock", () => {
    const input = fixture();
    const activationLock = path.join(input.runtimeHome, "locks", "activation.lock");
    fs.mkdirSync(activationLock, { recursive: true });
    const before = fs.readFileSync(input.pointer, "utf8");

    const result = spawnSync(script, ["--target", input.target, "--remote", "backup", "--apply"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain("activation is active");
    expect(fs.readFileSync(input.pointer, "utf8")).toBe(before);
    expect(fs.existsSync(input.target)).toBe(false);
  });

  it("does not read or rewrite provenance while rollback owns the lifecycle lock", () => {
    const input = fixture();
    const rollbackLock = path.join(input.runtimeHome, "locks", "rollback.lock");
    fs.mkdirSync(rollbackLock, { recursive: true });
    const before = fs.readFileSync(input.pointer, "utf8");

    const result = spawnSync(script, ["--target", input.target, "--remote", "backup", "--apply"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain("rollback is active");
    expect(fs.readFileSync(input.pointer, "utf8")).toBe(before);
    expect(fs.existsSync(input.target)).toBe(false);
  });

  it("rejects a target outside the durable source root", () => {
    const input = fixture();
    const result = spawnSync(
      script,
      ["--target", path.join(os.tmpdir(), "outside-source"), "--remote", "backup"],
      {
        encoding: "utf8",
        env: input.env,
      },
    );

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("outside the durable source root");
  });

  it("rejects a remote ref that does not identify the active commit", () => {
    const input = fixture();
    fs.writeFileSync(path.join(input.source, "second.txt"), "second\n");
    expect(spawnSync("git", ["-C", input.source, "add", "second.txt"]).status).toBe(0);
    expect(spawnSync("git", ["-C", input.source, "commit", "-qm", "second"]).status).toBe(0);
    expect(
      spawnSync("git", [
        "-C",
        input.source,
        "push",
        "-q",
        "backup",
        `HEAD:refs/heads/${input.branch}`,
      ]).status,
    ).toBe(0);

    const result = spawnSync(script, ["--target", input.target, "--remote", "backup"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("remote ref does not identify the active commit");
    expect(fs.existsSync(input.target)).toBe(false);
  });

  it("rejects executable Git remote-helper URLs before lookup", () => {
    const input = fixture();
    const result = spawnSync(script, ["--target", input.target, "--remote", "ext::sh -c exit 0"], {
      encoding: "utf8",
      env: input.env,
    });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("remote URL contains credentials or unsupported metadata");
    expect(fs.existsSync(input.target)).toBe(false);
  });

  it("accepts an annotated recovery tag that peels to the active commit", () => {
    const input = fixture();
    const tag = "runtime-recovery";
    expect(spawnSync("git", ["-C", input.source, "tag", "-am", "recovery", tag]).status).toBe(0);
    expect(spawnSync("git", ["-C", input.source, "push", "-q", "backup", tag]).status).toBe(0);

    const result = spawnSync(
      script,
      ["--target", input.target, "--remote", "backup", "--remote-ref", `refs/tags/${tag}`],
      {
        encoding: "utf8",
        env: input.env,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceRemoteRef: `refs/tags/${tag}`,
      sourceRemoteSha: input.sha,
    });
  });
});

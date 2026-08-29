import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON,
  resolveCustomRuntimeUpdatePolicy,
} from "./custom-runtime-update-policy.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-policy-"));
  temporaryDirectories.push(homedir);
  const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "candidate");
  const pointerPath = path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  const backupRoot = path.join(homedir, "encrypted-backup");
  const sourceRoot = path.join(homedir, "source");
  fs.mkdirSync(sourceRoot);
  git(["init", "--quiet"], sourceRoot);
  git(["config", "user.email", "test@example.invalid"], sourceRoot);
  git(["config", "user.name", "Test"], sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, "README.md"), "fixture\n");
  git(["add", "README.md"], sourceRoot);
  git(["commit", "--quiet", "-m", "fixture"], sourceRoot);
  const sourceSha = git(["rev-parse", "HEAD"], sourceRoot);
  const treeSha = git(["rev-parse", `${sourceSha}^{tree}`], sourceRoot);
  const provenanceRoot = path.join(path.dirname(pointerPath), "source-provenance", sourceSha);
  const recordPath = path.join(provenanceRoot, "provenance.json");
  const storePath = path.join(provenanceRoot, "store.git");
  const bundlePath = path.join(provenanceRoot, "source.bundle");
  const sourceRemote = "https://github.com/SnowBelt/openclaw.git";
  const sourceRemoteBranch = "codex/runtime-update-20260829T120000Z";
  fs.mkdirSync(provenanceRoot, { recursive: true });
  git(["init", "--bare", "--quiet", storePath]);
  git(["bundle", "create", bundlePath, "HEAD"], sourceRoot);
  git([
    "--git-dir",
    storePath,
    "fetch",
    "--no-tags",
    bundlePath,
    `${sourceSha}:refs/provenance/${sourceSha}`,
  ]);
  git(["--git-dir", storePath, "remote", "add", "origin", sourceRemote]);
  git([
    "--git-dir",
    storePath,
    "update-ref",
    `refs/remotes/origin/${sourceRemoteBranch}`,
    sourceSha,
  ]);
  const bundleSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(bundlePath))
    .digest("hex");
  fs.writeFileSync(
    recordPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-source-provenance.v1",
      version: 1,
      sourceSha,
      treeSha,
      objectFormat: "sha1",
      recordPath,
      storePath,
      bundlePath,
      bundleSha256,
      sourceRemote,
      sourceRemoteBranch,
    })}\n`,
  );
  const recordSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(recordPath))
    .digest("hex");
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  fs.mkdirSync(backupRoot);
  fs.writeFileSync(
    path.join(path.dirname(pointerPath), "update-safety.json"),
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-update-safety-config.v1",
      backupRoot,
    })}\n`,
  );
  fs.writeFileSync(
    pointerPath,
    `${JSON.stringify({
      runtimeRoot,
      entrypoint: path.join(runtimeRoot, "dist", "index.js"),
      sourceSha,
      sourceRepo: storePath,
      sourceBranch: `refs/provenance/${sourceSha}`,
      sourceProvenance: {
        sourceSha,
        treeSha,
        objectFormat: "sha1",
        recordPath,
        recordSha256,
        storePath,
        bundlePath,
        bundleSha256,
        sourceRemote,
        sourceRemoteBranch,
      },
    })}\n`,
  );
  return {
    homedir,
    pointerPath,
    recordPath,
    runtimeRoot,
    sourceSha,
    bundlePath,
    storePath,
  };
}

describe("custom runtime update policy", () => {
  it("blocks generic updates for the active immutable runtime", () => {
    const value = fixture();
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      managedRuntime: true,
      standardUpdateBlocked: true,
      sourceDurable: true,
      backupConfigured: true,
      preparationStatus: "idle",
      preparationReason: null,
      sourceSha: value.sourceSha,
      sourceBranch: `refs/provenance/${value.sourceSha}`,
      runtimeRoot: value.runtimeRoot,
    });
    expect(CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON).toBe(
      "custom-runtime-update-broker-required",
    );
  });

  it("does not block an unrelated source checkout with a stale pointer", () => {
    const value = fixture();
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", "/workspace/openclaw/dist/index.js"],
      env: {},
    });

    expect(result.managedRuntime).toBe(false);
    expect(result.standardUpdateBlocked).toBe(false);
  });

  it("marks provenance hashes as non-durable sources", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    fs.writeFileSync(
      value.pointerPath,
      `${JSON.stringify({ ...pointer, sourceSha: "b".repeat(64) })}\n`,
    );
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.standardUpdateBlocked).toBe(true);
    expect(result.sourceDurable).toBe(false);
  });

  it("does not trust source strings without an intact provenance record", () => {
    const value = fixture();
    const record = JSON.parse(fs.readFileSync(value.recordPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(
      value.recordPath,
      `${JSON.stringify({ ...record, sourceInputRoot: "/tampered" })}\n`,
    );

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
    expect(result.sourceDurabilityReason).toContain("hash does not match");
  });

  it("does not trust a changed recovery bundle or missing Git object store", () => {
    const value = fixture();
    fs.appendFileSync(value.bundlePath, "tampered\n");

    const tamperedBundle = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });
    expect(tamperedBundle.sourceDurable).toBe(false);
    expect(tamperedBundle.sourceDurabilityReason).toContain("bundle hash");

    const clean = fixture();
    const pointer = JSON.parse(fs.readFileSync(clean.pointerPath, "utf8")) as {
      sourceProvenance: { storePath: string };
    };
    fs.rmSync(pointer.sourceProvenance.storePath, { recursive: true });
    const missingStore = resolveCustomRuntimeUpdatePolicy({
      homedir: clean.homedir,
      argv: ["node", path.join(clean.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: clean.runtimeRoot },
    });
    expect(missingStore.sourceDurable).toBe(false);
  });

  it("does not trust a provenance store detached from its published remote identity", () => {
    const value = fixture();
    git([
      "--git-dir",
      value.storePath,
      "remote",
      "set-url",
      "origin",
      "https://example.invalid/openclaw.git",
    ]);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
    expect(result.sourceDurabilityReason).toContain("standalone");
  });

  it("does not report backup readiness when the encrypted destination is unavailable", () => {
    const value = fixture();
    const configPath = path.join(path.dirname(value.pointerPath), "update-safety.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { backupRoot: string };
    fs.rmSync(config.backupRoot, { recursive: true });

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.backupConfigured).toBe(false);
  });

  it("exposes only an exact candidate SHA from a ready preparation receipt", () => {
    const value = fixture();
    const candidateSha = "c".repeat(40);
    fs.writeFileSync(
      path.join(path.dirname(value.pointerPath), "pending-update.json"),
      `${JSON.stringify({ result: "ready_for_approval", sourceSha: candidateSha })}\n`,
    );

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.approvalPending).toBe(true);
    expect(result.pendingCandidateSha).toBe(candidateSha);
    expect(result.preparationStatus).toBe("ready");
  });

  it("surfaces the broker's last fail-closed preparation reason", () => {
    const value = fixture();
    const receiptsRoot = path.join(path.dirname(value.pointerPath), "receipts");
    fs.mkdirSync(receiptsRoot);
    fs.writeFileSync(
      path.join(receiptsRoot, "update-20260829T120000Z.json"),
      `${JSON.stringify({
        result: "failed",
        stage: "repository-proof-failed",
      })}\n`,
    );

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.preparationStatus).toBe("failed");
    expect(result.preparationReason).toBe("repository-proof-failed");
  });

  it("allows the broker to recover a dead preparation lock only after the grace period", () => {
    const value = fixture();
    const lockPath = path.join(path.dirname(value.pointerPath), "update-preparation.lock");
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), '{"pid":2147483647}\n');

    const fresh = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });
    expect(fresh.preparationRunning).toBe(true);

    const stale = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(lockPath, stale, stale);
    const recoverable = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });
    expect(recoverable.preparationRunning).toBe(false);
  });

  it("reports an active exact-SHA installation lock", () => {
    const value = fixture();
    const candidateSha = "d".repeat(40);
    fs.writeFileSync(
      path.join(path.dirname(value.pointerPath), "pending-update.json"),
      `${JSON.stringify({ result: "ready_for_approval", sourceSha: candidateSha })}\n`,
    );
    const lockPath = path.join(path.dirname(value.pointerPath), "update-installation.lock");
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), '{"pid":2147483647}\n');

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.approvalPending).toBe(true);
    expect(result.preparationStatus).toBe("installing");
  });
});

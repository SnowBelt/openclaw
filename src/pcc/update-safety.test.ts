import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPccUpdateSafety } from "./update-safety.js";

const temporaryDirectories: string[] = [];

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("PCC update safety", () => {
  it("reports a protected durable runtime and pending approval", () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-safety-"));
    temporaryDirectories.push(homedir);
    const runtimeHome = path.join(homedir, ".openclaw-custom-runtime");
    const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "release-1");
    const externalBackupRoot = path.join(homedir, "external-backup");
    const pointerPath = path.join(runtimeHome, "active-runtime.json");
    fs.mkdirSync(path.join(runtimeHome, "bin"), { recursive: true });
    fs.mkdirSync(path.join(runtimeHome, "receipts"), { recursive: true });
    fs.mkdirSync(path.join(homedir, "Library", "LaunchAgents"), { recursive: true });
    fs.mkdirSync(externalBackupRoot, { recursive: true });
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-updater.sh"), "");
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh"), "");
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-update-backup.mjs"), "");
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-guard.sh"), "");
    fs.writeFileSync(
      path.join(runtimeHome, "update-safety.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-update-safety-config.v2",
        mode: "local_verified",
      })}\n`,
    );
    fs.writeFileSync(
      path.join(
        homedir,
        "Library",
        "LaunchAgents",
        "ai.openclaw.custom-runtime.update-weekly.plist",
      ),
      "",
    );
    fs.writeFileSync(
      path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.custom-runtime.guard.plist"),
      "",
    );
    const sourceRoot = path.join(homedir, "source");
    fs.mkdirSync(sourceRoot);
    git(["init", "--quiet"], sourceRoot);
    git(["config", "user.email", "test@example.invalid"], sourceRoot);
    git(["config", "user.name", "Test"], sourceRoot);
    fs.writeFileSync(path.join(sourceRoot, "README.md"), "fixture\n");
    git(["add", "README.md"], sourceRoot);
    git(["commit", "--quiet", "-m", "fixture"], sourceRoot);
    const sourceSha = git(["rev-parse", "HEAD"], sourceRoot);
    const localBackupRoot = path.join(runtimeHome, "data-backups");
    fs.mkdirSync(localBackupRoot, { recursive: true });
    const localArchivePath = path.join(localBackupRoot, "backup.tar");
    const externalArchivePath = path.join(externalBackupRoot, "backup.tar");
    const controlPlanePath = path.join(localBackupRoot, "control-plane.json");
    for (const filePath of [localArchivePath, externalArchivePath, controlPlanePath]) {
      fs.writeFileSync(filePath, "verified fixture\n");
    }
    const fixtureDigest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(localArchivePath))
      .digest("hex");
    fs.writeFileSync(
      path.join(runtimeHome, "receipts", "update-backup-20260901T000000Z.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-update-backup.v2",
        mode: "local_verified",
        createdAt: new Date().toISOString(),
        sourceSha,
        releaseId: "release-1",
        result: "passed",
        backupVerified: true,
        restoreDrill: { result: "passed" },
        localArchive: { path: localArchivePath, sha256: fixtureDigest },
        controlPlane: { path: controlPlanePath, sha256: fixtureDigest },
      })}\n`,
      { mode: 0o600 },
    );
    const treeSha = git(["rev-parse", `${sourceSha}^{tree}`], sourceRoot);
    const provenanceRoot = path.join(runtimeHome, "source-provenance", sourceSha);
    const sourceRepo = path.join(provenanceRoot, "store.git");
    const bundlePath = path.join(provenanceRoot, "source.bundle");
    const recordPath = path.join(provenanceRoot, "provenance.json");
    const sourceRemote = "https://github.com/SnowBelt/openclaw.git";
    const sourceRemoteBranch = "codex/runtime-update-20260829T120000Z";
    fs.mkdirSync(provenanceRoot, { recursive: true });
    git(["init", "--bare", "--quiet", sourceRepo]);
    git(["bundle", "create", bundlePath, "HEAD"], sourceRoot);
    git([
      "--git-dir",
      sourceRepo,
      "fetch",
      "--no-tags",
      bundlePath,
      `${sourceSha}:refs/provenance/${sourceSha}`,
    ]);
    git(["--git-dir", sourceRepo, "remote", "add", "origin", sourceRemote]);
    git([
      "--git-dir",
      sourceRepo,
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
        storePath: sourceRepo,
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
    fs.writeFileSync(
      pointerPath,
      `${JSON.stringify({
        releaseId: "release-1",
        runtimeRoot,
        entrypoint: path.join(runtimeRoot, "dist", "index.js"),
        sourceSha,
        sourceRepo,
        sourceBranch: `refs/provenance/${sourceSha}`,
        sourceProvenance: {
          sourceSha,
          treeSha,
          objectFormat: "sha1",
          recordPath,
          recordSha256,
          storePath: sourceRepo,
          bundlePath,
          bundleSha256,
          sourceRemote,
          sourceRemoteBranch,
        },
      })}\n`,
    );
    fs.writeFileSync(
      path.join(runtimeHome, "pending-update.json"),
      `${JSON.stringify({ result: "ready_for_approval", sourceSha: "c".repeat(40) })}\n`,
    );
    fs.writeFileSync(
      path.join(runtimeHome, "receipts", "update-20260715T000000Z.json"),
      '{"at":"20260715T000000Z","result":"ready_for_approval"}\n',
    );
    fs.writeFileSync(
      path.join(runtimeHome, "receipts", "update-approval-20260714T000000Z.json"),
      '{"at":"20260714T000000Z","result":"promoted"}\n',
    );

    expect(
      readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: true,
        guardLoaded: true,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: {
          OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot,
        },
      }),
    ).toEqual({
      status: "protected",
      standardUpdateBlocked: true,
      sourceDurable: true,
      backupConfigured: true,
      recovery: {
        mode: "local_verified",
        localStatus: "ready",
        externalStatus: "not_configured",
        installationReady: true,
        blockingReasons: [],
        advisories: ["Hardware-disaster recovery is not configured on encrypted external storage."],
      },
      brokerConfigured: true,
      runtimeGuardConfigured: true,
      approvalPending: true,
      pendingCandidateSha: "c".repeat(40),
      preparationRunning: false,
      preparationStatus: "ready",
      preparationReason: null,
      sourceSha,
      sourceBranch: `refs/provenance/${sourceSha}`,
      activeRelease: "release-1",
      lastReceipt: {
        at: "20260715T000000Z",
        result: "ready_for_approval",
        stage: null,
      },
      issues: [],
      advisories: ["Hardware-disaster recovery is not configured on encrypted external storage."],
    });

    expect(
      readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: false,
        guardLoaded: true,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: {
          OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot,
          OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT: externalBackupRoot,
        },
      }),
    ).toMatchObject({
      status: "attention",
      brokerConfigured: false,
      runtimeGuardConfigured: true,
      issues: ["The verified custom-runtime update broker is installed but not scheduled."],
    });

    expect(
      readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: true,
        guardLoaded: false,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: {
          OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot,
          OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT: externalBackupRoot,
        },
      }),
    ).toMatchObject({
      status: "attention",
      brokerConfigured: true,
      runtimeGuardConfigured: false,
      issues: ["The verified custom-runtime recovery guard is installed but not scheduled."],
    });
  });
});

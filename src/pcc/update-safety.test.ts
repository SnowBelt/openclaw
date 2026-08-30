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

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("PCC update safety", () => {
  it("reports a protected durable runtime and pending approval", async () => {
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
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-update-github-proof.mjs"), "");
    const guardExecutablePath = path.join(runtimeHome, "bin", "custom-runtime-guard.sh");
    fs.writeFileSync(guardExecutablePath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const launcherPath = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
    const gatewayPlistPath = path.join(
      homedir,
      "Library",
      "LaunchAgents",
      "ai.openclaw.gateway.plist",
    );
    const configPath = path.join(homedir, ".openclaw", "openclaw.director.json");
    const gatewayEnvWrapperPath = path.join(
      homedir,
      ".openclaw-director-state",
      "service-env",
      "ai.openclaw.gateway-env-wrapper.sh",
    );
    const gatewayEnvFilePath = path.join(
      homedir,
      ".openclaw-director-state",
      "service-env",
      "ai.openclaw.gateway.env",
    );
    const guardPlistPath = path.join(
      homedir,
      "Library",
      "LaunchAgents",
      "ai.openclaw.custom-runtime.guard.plist",
    );
    fs.writeFileSync(launcherPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    fs.writeFileSync(gatewayPlistPath, "fixture LaunchAgent\n");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(path.dirname(gatewayEnvWrapperPath), { recursive: true });
    fs.writeFileSync(gatewayEnvWrapperPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    fs.writeFileSync(gatewayEnvFilePath, "export OPENCLAW_STATE_DIR=/fixture\n", {
      mode: 0o600,
    });
    fs.writeFileSync(configPath, "{}\n");
    fs.writeFileSync(
      path.join(runtimeHome, "update-safety.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-update-safety-config.v1",
        backupRoot: externalBackupRoot,
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
      guardPlistPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>ai.openclaw.custom-runtime.guard</string>
<key>ProgramArguments</key><array>
<string>/bin/sh</string><string>${gatewayEnvWrapperPath}</string><string>${gatewayEnvFilePath}</string><string>${guardExecutablePath}</string>
</array></dict></plist>\n`,
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
    const provenancePath = path.join(runtimeRoot, ".openclaw-runtime-provenance.json");
    const dashboardManifestPath = path.join(
      runtimeRoot,
      "dist",
      "control-ui",
      "dashboard-surfaces.json",
    );
    fs.mkdirSync(path.dirname(dashboardManifestPath), { recursive: true });
    fs.writeFileSync(provenancePath, `${JSON.stringify({ recordPath, migrationPath: "" })}\n`);
    fs.writeFileSync(dashboardManifestPath, '{"buildId":"fixture"}\n');
    fs.writeFileSync(
      path.join(runtimeHome, "receipts", "guard-verification-current.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-guard-verification.v1",
        result: "passed",
        verifiedAt: Math.floor(Date.now() / 1000),
        runtimeRoot,
        sourceSha,
        pointerSha256: sha256(pointerPath),
        launcherSha256: sha256(launcherPath),
        plistSha256: sha256(gatewayPlistPath),
        guardPlistPath: fs.realpathSync(guardPlistPath),
        guardPlistSha256: sha256(guardPlistPath),
        guardExecutablePath: fs.realpathSync(guardExecutablePath),
        guardExecutableSha256: sha256(guardExecutablePath),
        guardLabel: "ai.openclaw.custom-runtime.guard",
        gatewayEnvWrapperPath: fs.realpathSync(gatewayEnvWrapperPath),
        gatewayEnvWrapperSha256: sha256(gatewayEnvWrapperPath),
        gatewayEnvFilePath: fs.realpathSync(gatewayEnvFilePath),
        gatewayEnvFileSha256: sha256(gatewayEnvFilePath),
        guardProgramArguments: [
          "/bin/sh",
          gatewayEnvWrapperPath,
          gatewayEnvFilePath,
          guardExecutablePath,
        ].map((filePath) => fs.realpathSync(filePath)),
        provenanceSha256: sha256(provenancePath),
        provenanceRecordSha256: sha256(recordPath),
        provenanceMigrationSha256: "",
        dashboardManifestSha256: sha256(dashboardManifestPath),
        gatewayConfigSha256: crypto
          .createHash("sha256")
          .update(`${JSON.stringify(null)}\n${JSON.stringify({})}\n`)
          .digest("hex"),
      })}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(runtimeHome, "pending-update.json"),
      `${JSON.stringify({
        result: "ready_for_approval",
        sourceSha: "c".repeat(40),
        verifiedBackup: { schema: "openclaw.custom-runtime-update-backup.v2" },
        repositoryProof: { schema: "openclaw.custom-runtime-github-proof.v1" },
      })}\n`,
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
      await readPccUpdateSafety({
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
    });

    fs.writeFileSync(
      path.join(runtimeHome, "pending-update.json"),
      `${JSON.stringify({
        result: "ready_for_approval",
        sourceSha: "c".repeat(40),
        verifiedBackup: { schema: "openclaw.custom-runtime-update-backup.v1" },
      })}\n`,
    );
    expect(
      await readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: true,
        guardLoaded: true,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot },
      }),
    ).toMatchObject({
      approvalPending: false,
      pendingCandidateSha: null,
      preparationStatus: "idle",
      preparationReason: "pending-update-proof-repreparation-required",
    });

    fs.rmSync(path.join(runtimeHome, "pending-update.json"));
    fs.writeFileSync(
      path.join(runtimeHome, "receipts", "update-20260716T000000Z.json"),
      '{"at":"20260716T000000Z","result":"failed","stage":"candidate-proof"}\n',
    );
    expect(
      await readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: true,
        guardLoaded: true,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot },
      }),
    ).toMatchObject({
      status: "attention",
      preparationStatus: "failed",
      issues: ["Verified update preparation failed: candidate-proof."],
    });

    fs.writeFileSync(
      path.join(runtimeHome, "pending-update.json"),
      `${JSON.stringify({ result: "ready_for_approval", sourceSha: "c".repeat(40) })}\n`,
    );

    expect(
      await readPccUpdateSafety({
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
      await readPccUpdateSafety({
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

    const realGuardPlistPath = `${guardPlistPath}.real`;
    fs.renameSync(guardPlistPath, realGuardPlistPath);
    fs.symlinkSync(realGuardPlistPath, guardPlistPath);
    expect(
      await readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: true,
        guardLoaded: true,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: {
          OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot,
          OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT: externalBackupRoot,
        },
      }),
    ).toMatchObject({
      status: "attention",
      runtimeGuardConfigured: false,
      issues: [
        "The active runtime guard has no current identity and route verification.",
        "The verified custom-runtime recovery guard is not fully installed.",
      ],
    });
    fs.unlinkSync(guardPlistPath);
    fs.renameSync(realGuardPlistPath, guardPlistPath);

    fs.rmSync(path.join(runtimeHome, "bin", "custom-runtime-update-github-proof.mjs"));
    expect(
      await readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        schedulerLoaded: true,
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
      issues: ["The verified custom-runtime update broker is not fully installed."],
    });
  });
});

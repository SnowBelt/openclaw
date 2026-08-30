import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfigOverrides, setConfigOverride } from "../config/runtime-overrides.js";
import {
  CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON,
  resolveCustomRuntimeUpdatePolicy,
} from "./custom-runtime-update-policy.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  resetConfigOverrides();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
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
  const launcherPath = path.join(path.dirname(pointerPath), "bin", "custom-runtime-launcher.sh");
  const plistPath = path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist");
  const guardPlistPath = path.join(
    homedir,
    "Library",
    "LaunchAgents",
    "ai.openclaw.custom-runtime.guard.plist",
  );
  const guardExecutablePath = path.join(
    path.dirname(pointerPath),
    "bin",
    "custom-runtime-guard.sh",
  );
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
  const configPath = path.join(homedir, ".openclaw", "openclaw.director.json");
  const provenancePath = path.join(runtimeRoot, ".openclaw-runtime-provenance.json");
  const dashboardManifestPath = path.join(
    runtimeRoot,
    "dist",
    "control-ui",
    "dashboard-surfaces.json",
  );
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.dirname(gatewayEnvWrapperPath), { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(dashboardManifestPath), { recursive: true });
  fs.writeFileSync(launcherPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  fs.writeFileSync(guardExecutablePath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  fs.writeFileSync(gatewayEnvWrapperPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  fs.writeFileSync(gatewayEnvFilePath, "export OPENCLAW_STATE_DIR=/fixture\n", { mode: 0o600 });
  fs.writeFileSync(plistPath, "fixture LaunchAgent\n");
  fs.writeFileSync(
    guardPlistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>ai.openclaw.custom-runtime.guard</string>
<key>ProgramArguments</key><array>
<string>${gatewayEnvWrapperPath}</string><string>${gatewayEnvFilePath}</string><string>${guardExecutablePath}</string>
</array></dict></plist>\n`,
  );
  fs.writeFileSync(configPath, "{}\n");
  fs.writeFileSync(provenancePath, `${JSON.stringify({ recordPath, migrationPath: "" })}\n`);
  fs.writeFileSync(dashboardManifestPath, '{"buildId":"fixture"}\n');
  const guardReceiptPath = path.join(
    path.dirname(pointerPath),
    "receipts",
    "guard-verification-current.json",
  );
  fs.mkdirSync(path.dirname(guardReceiptPath), { recursive: true });
  fs.writeFileSync(
    guardReceiptPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-guard-verification.v1",
      result: "passed",
      verifiedAt: Math.floor(Date.now() / 1000),
      runtimeRoot,
      sourceSha,
      pointerSha256: sha256(pointerPath),
      launcherSha256: sha256(launcherPath),
      plistSha256: sha256(plistPath),
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
  return {
    homedir,
    pointerPath,
    recordPath,
    runtimeRoot,
    sourceSha,
    bundlePath,
    storePath,
    launcherPath,
    guardPlistPath,
  };
}

describe("custom runtime update policy", () => {
  it("leaves stock installations unmanaged when no runtime pointer exists", async () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-policy-stock-"));
    temporaryDirectories.push(homedir);

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir,
      argv: ["node", path.join(homedir, "openclaw", "dist", "index.js")],
      env: {},
    });

    expect(result).toMatchObject({
      managedRuntime: false,
      standardUpdateBlocked: false,
      preparationStatus: "idle",
      preparationReason: null,
      reason: "No managed custom runtime is active.",
    });
  });

  it("does not treat a stock runtime snapshot as custom-runtime authority", async () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-policy-snapshot-"));
    temporaryDirectories.push(homedir);
    const snapshotRoot = path.join(homedir, "openclaw", ".runtime-snapshot", "active");

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir,
      argv: ["node", path.join(snapshotRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: snapshotRoot },
    });

    expect(result).toMatchObject({
      managedRuntime: false,
      standardUpdateBlocked: false,
      preparationStatus: "idle",
      preparationReason: null,
    });
  });

  it("fails closed when a managed runtime loses its active pointer", async () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-policy-missing-"));
    temporaryDirectories.push(homedir);
    const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "active");

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir,
      argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
      env: {
        OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot,
        OPENCLAW_WRAPPER: path.join(
          homedir,
          ".openclaw-custom-runtime",
          "bin",
          "custom-runtime-launcher.sh",
        ),
      },
    });

    expect(result).toMatchObject({
      managedRuntime: true,
      standardUpdateBlocked: true,
      preparationStatus: "blocked",
      preparationReason: "invalid-active-runtime-pointer",
    });
  });

  it("blocks generic updates for the active immutable runtime", async () => {
    const value = fixture();
    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      managedRuntime: true,
      standardUpdateBlocked: true,
      sourceDurable: true,
      runtimeGuardHealthy: true,
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

  it("does not block an unrelated source checkout with a stale pointer", async () => {
    const value = fixture();
    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", "/workspace/openclaw/dist/index.js"],
      env: {},
    });

    expect(result.managedRuntime).toBe(false);
    expect(result.standardUpdateBlocked).toBe(false);
  });

  it("blocks preparation when the current runtime guard proof is stale", async () => {
    const value = fixture();
    const receiptPath = path.join(
      path.dirname(value.pointerPath),
      "receipts",
      "guard-verification-current.json",
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify({ ...receipt, verifiedAt: Math.floor(Date.now() / 1000) - 901 })}\n`,
      { mode: 0o600 },
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      runtimeGuardHealthy: false,
      preparationStatus: "blocked",
      preparationReason: "runtime-guard-verification-unavailable",
    });
  });

  it("blocks preparation when the recovery guard LaunchAgent is not loaded", async () => {
    const value = fixture();
    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: false,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      runtimeGuardHealthy: false,
      runtimeGuardReason: "The recovery guard LaunchAgent is not loaded.",
      preparationStatus: "blocked",
      preparationReason: "runtime-guard-verification-unavailable",
    });
  });

  it("honors a configured recovery guard LaunchAgent path and label", async () => {
    const value = fixture();
    const customGuardPlist = path.join(value.homedir, "custom", "recovery-guard.plist");
    fs.mkdirSync(path.dirname(customGuardPlist), { recursive: true });
    fs.renameSync(value.guardPlistPath, customGuardPlist);
    fs.writeFileSync(
      customGuardPlist,
      fs
        .readFileSync(customGuardPlist, "utf8")
        .replace("ai.openclaw.custom-runtime.guard", "com.example.openclaw.recovery-guard"),
    );
    const receiptPath = path.join(
      path.dirname(value.pointerPath),
      "receipts",
      "guard-verification-current.json",
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify({
        ...receipt,
        guardPlistPath: fs.realpathSync(customGuardPlist),
        guardPlistSha256: sha256(customGuardPlist),
        guardLabel: "com.example.openclaw.recovery-guard",
      })}\n`,
      { mode: 0o600 },
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: {
        OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot,
        OPENCLAW_CUSTOM_RUNTIME_GUARD_PLIST: customGuardPlist,
        OPENCLAW_CUSTOM_RUNTIME_GUARD_LABEL: "com.example.openclaw.recovery-guard",
      },
    });

    expect(result).toMatchObject({
      runtimeGuardHealthy: true,
      preparationStatus: "idle",
      preparationReason: null,
    });
  });

  it("rejects a guard receipt when a bound runtime input changes", async () => {
    const value = fixture();
    fs.appendFileSync(value.launcherPath, "# changed\n");

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      runtimeGuardHealthy: false,
      preparationStatus: "blocked",
      preparationReason: "runtime-guard-verification-unavailable",
    });
  });

  it("compares the guard receipt with the authored snapshot, not process-local overrides", async () => {
    const value = fixture();
    setConfigOverride("gateway.auth", { mode: "token", token: "process-only" });

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.runtimeGuardHealthy).toBe(true);
  });

  it("rejects a guard receipt when the recovery guard executable changes", async () => {
    const value = fixture();
    fs.appendFileSync(
      path.join(path.dirname(value.pointerPath), "bin", "custom-runtime-guard.sh"),
      "# changed\n",
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.runtimeGuardHealthy).toBe(false);
  });

  it("rejects a guard receipt when the recovery guard LaunchAgent changes", async () => {
    const value = fixture();
    fs.writeFileSync(value.guardPlistPath, "no-op guard definition\n");

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.runtimeGuardHealthy).toBe(false);
  });

  it.each([
    ["wrapper", "ai.openclaw.gateway-env-wrapper.sh"],
    ["environment", "ai.openclaw.gateway.env"],
  ])("rejects a guard receipt when the Gateway %s changes", async (_label, filename) => {
    const value = fixture();
    fs.appendFileSync(
      path.join(value.homedir, ".openclaw-director-state", "service-env", filename),
      "# changed\n",
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.runtimeGuardHealthy).toBe(false);
  });

  it("rejects a legacy guard receipt without current proof bindings", async () => {
    const value = fixture();
    const receiptPath = path.join(
      path.dirname(value.pointerPath),
      "receipts",
      "guard-verification-current.json",
    );
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-guard-verification.v1",
        result: "passed",
        verifiedAt: Math.floor(Date.now() / 1000),
        runtimeRoot: value.runtimeRoot,
        sourceSha: value.sourceSha,
      })}\n`,
      { mode: 0o600 },
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.runtimeGuardHealthy).toBe(false);
  });

  it("routes a legacy backup candidate back through verified preparation", async () => {
    const value = fixture();
    fs.writeFileSync(
      path.join(path.dirname(value.pointerPath), "pending-update.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-update-candidate.v1",
        result: "ready_for_approval",
        sourceSha: "b".repeat(40),
        verifiedBackup: { schema: "openclaw.custom-runtime-update-backup.v1" },
      })}\n`,
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      managedRuntime: true,
      approvalPending: false,
      pendingCandidateSha: null,
      preparationStatus: "idle",
      preparationReason: "legacy-backup-repreparation-required",
    });
  });

  it("marks provenance hashes as non-durable sources", async () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    fs.writeFileSync(
      value.pointerPath,
      `${JSON.stringify({ ...pointer, sourceSha: "b".repeat(64) })}\n`,
    );
    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.standardUpdateBlocked).toBe(true);
    expect(result.sourceDurable).toBe(false);
  });

  it("does not trust source strings without an intact provenance record", async () => {
    const value = fixture();
    const record = JSON.parse(fs.readFileSync(value.recordPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(
      value.recordPath,
      `${JSON.stringify({ ...record, sourceInputRoot: "/tampered" })}\n`,
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
    expect(result.sourceDurabilityReason).toContain("hash does not match");
  });

  it("does not trust a changed recovery bundle or missing Git object store", async () => {
    const value = fixture();
    fs.appendFileSync(value.bundlePath, "tampered\n");

    const tamperedBundle = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
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
    const missingStore = await resolveCustomRuntimeUpdatePolicy({
      homedir: clean.homedir,
      argv: ["node", path.join(clean.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: clean.runtimeRoot },
    });
    expect(missingStore.sourceDurable).toBe(false);
  });

  it("does not trust a provenance store detached from its published remote identity", async () => {
    const value = fixture();
    git([
      "--git-dir",
      value.storePath,
      "remote",
      "set-url",
      "origin",
      "https://example.invalid/openclaw.git",
    ]);

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
    expect(result.sourceDurabilityReason).toContain("standalone");
  });

  it("does not report backup readiness when the encrypted destination is unavailable", async () => {
    const value = fixture();
    const configPath = path.join(path.dirname(value.pointerPath), "update-safety.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { backupRoot: string };
    fs.rmSync(config.backupRoot, { recursive: true });

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.backupConfigured).toBe(false);
  });

  it("exposes only an exact candidate SHA from a ready preparation receipt", async () => {
    const value = fixture();
    const candidateSha = "c".repeat(40);
    fs.writeFileSync(
      path.join(path.dirname(value.pointerPath), "pending-update.json"),
      `${JSON.stringify({ result: "ready_for_approval", sourceSha: candidateSha })}\n`,
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.approvalPending).toBe(true);
    expect(result.pendingCandidateSha).toBe(candidateSha);
    expect(result.preparationStatus).toBe("ready");
  });

  it("surfaces the broker's last fail-closed preparation reason", async () => {
    const value = fixture();
    const receiptsRoot = path.join(path.dirname(value.pointerPath), "receipts");
    fs.mkdirSync(receiptsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(receiptsRoot, "update-20260829T120000Z.json"),
      `${JSON.stringify({
        result: "failed",
        stage: "repository-proof-failed",
      })}\n`,
    );

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.preparationStatus).toBe("failed");
    expect(result.preparationReason).toBe("repository-proof-failed");
  });

  it("allows the broker to recover a dead preparation lock only after the grace period", async () => {
    const value = fixture();
    const lockPath = path.join(path.dirname(value.pointerPath), "update-preparation.lock");
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), '{"pid":2147483647}\n');

    const fresh = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });
    expect(fresh.preparationRunning).toBe(true);

    const stale = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(lockPath, stale, stale);
    const recoverable = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });
    expect(recoverable.preparationRunning).toBe(false);
  });

  it("reports an active exact-SHA installation lock", async () => {
    const value = fixture();
    const candidateSha = "d".repeat(40);
    fs.writeFileSync(
      path.join(path.dirname(value.pointerPath), "pending-update.json"),
      `${JSON.stringify({ result: "ready_for_approval", sourceSha: candidateSha })}\n`,
    );
    const lockPath = path.join(path.dirname(value.pointerPath), "update-installation.lock");
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), '{"pid":2147483647}\n');

    const result = await resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      runtimeGuardLoaded: true,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.approvalPending).toBe(true);
    expect(result.preparationStatus).toBe("installing");
  });
});

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const updater = path.resolve("scripts/custom-runtime/custom-runtime-updater.sh");
const approve = path.resolve("scripts/custom-runtime/custom-runtime-update-approve.sh");
const temporaryDirectories: string[] = [];
const canonicalVerificationCommands = [
  "pnpm check:custom-runtime-capabilities",
  "pnpm check:pcc-capabilities",
  "pnpm control-director:verify -- --expected-sha <candidate-sha>",
  "pnpm protocol:check",
  "pnpm ui:i18n:check",
  "pnpm check",
  "pnpm ui:build",
  "pnpm build",
  "pnpm ui:smoke:dashboard --artifact-profile release --artifact-root .artifacts/custom-runtime-update",
];

function resolvedVerificationCommands(sourceSha: string): string[] {
  return canonicalVerificationCommands.map((command) =>
    command.replace("<candidate-sha>", sourceSha),
  );
}

function root(prefix: string): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(value);
  return fs.realpathSync(value);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function fileBinding(filePath: string): { path: string; sha256: string } {
  return {
    path: filePath,
    sha256: createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
  };
}

function writePreservationProof(
  runtimeHome: string,
  baseSha: string,
  sourceSha: string,
  release: string,
): { path: string; sha256: string; schema: string } {
  const proofPath = path.join(runtimeHome, "receipts", "update-survival-test.json");
  const officialSha = "e".repeat(40);
  const manifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, '{"schema":"openclaw.custom-runtime-capabilities.v2"}\n');
  const manifestSha256 = createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  writeJson(proofPath, {
    schema: "openclaw.custom-runtime-update-survival.v1",
    mode: "candidate-merge",
    sourceSha,
    activeSha: baseSha,
    officialSha,
    candidateSha: sourceSha,
    mergeParents: [baseSha, officialSha],
    sourceClean: true,
    contractVersion: 2,
    sourceStrategy: "merge_from_active_sha",
    dashboardChangePolicy: "register_verify_and_block",
    approvalPolicy: "explicit_exact_candidate",
    proofCommand: "pnpm custom-runtime:update-survival",
    activeManifestVersion: 2,
    candidateManifestVersion: 5,
    requiredCapabilities: ["runtime:update-safe-customizations"],
    requiredPathDigests: { "config/custom-runtime-capabilities.json": manifestSha256 },
    verificationCommands: canonicalVerificationCommands,
    executedVerificationCommands: resolvedVerificationCommands(sourceSha),
    verificationResult: "passed",
    verifiedAt: "2026-07-19T00:00:00.000Z",
    passed: true,
  });
  return {
    path: proofPath,
    sha256: createHash("sha256").update(fs.readFileSync(proofPath)).digest("hex"),
    schema: "openclaw.custom-runtime-update-survival.v1",
  };
}

function writeVerifiedBackup(runtimeHome: string, sourceSha: string) {
  const receiptPath = path.join(runtimeHome, "receipts", "update-backup-test.json");
  writeJson(receiptPath, {
    schema: "openclaw.custom-runtime-update-backup.v2",
    sourceSha,
    result: "passed",
  });
  const verifier = path.join(runtimeHome, "bin", "custom-runtime-update-backup.mjs");
  fs.mkdirSync(path.dirname(verifier), { recursive: true });
  fs.writeFileSync(verifier, "process.exit(0);\n", { mode: 0o700 });
  return {
    path: receiptPath,
    sha256: createHash("sha256").update(fs.readFileSync(receiptPath)).digest("hex"),
    schema: "openclaw.custom-runtime-update-backup.v2",
    sourceSha,
  };
}

function writeRepositoryProof(runtimeHome: string, sourceSha: string) {
  const receiptPath = path.join(runtimeHome, "receipts", "update-github-proof-test.json");
  writeJson(receiptPath, {
    schema: "openclaw.custom-runtime-github-proof.v1",
    sourceSha,
    result: "passed",
  });
  const verifier = path.join(runtimeHome, "bin", "custom-runtime-update-github-proof.mjs");
  fs.mkdirSync(path.dirname(verifier), { recursive: true });
  fs.writeFileSync(verifier, "process.exit(0);\n", { mode: 0o700 });
  return {
    path: receiptPath,
    sha256: createHash("sha256").update(fs.readFileSync(receiptPath)).digest("hex"),
    schema: "openclaw.custom-runtime-github-proof.v1",
    sourceSha,
  };
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
  it("passes the exact Gateway environment wrapper into verified backup creation", () => {
    const source = fs.readFileSync(updater, "utf8");

    expect(source).toContain('--gateway-env-wrapper "$gateway_env_wrapper"');
    expect(source).toContain(
      'gateway_plist=${OPENCLAW_GATEWAY_PLIST:-"$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"}',
    );
    expect(source).toContain('"$gateway_plist" "$gateway_env_wrapper" "$gateway_env_file"');
    expect(source).toContain("os.path.realpath(provided_wrapper) != actual_wrapper");
    expect(source).toContain("os.path.realpath(provided_file) != actual_file");
    expect(source).toContain('os.path.basename(arguments[2]) == "custom-runtime-launcher.sh"');
    expect(source).toContain("print(actual_wrapper)");
    expect(source).toContain("print(actual_file)");
    expect(source).toContain('"$official_ref" "$active_sha" "$sha" "$repo" "$branch"');
    expect(source).toContain('"gatewayLaunchAgent": {');
    expect(source).toContain('"gatewayEnvironment": {');
  });

  it("records the long-lived owning shell in an acquired lock", () => {
    const base = root("openclaw-update-lock-owner-");
    const lock = path.join(base, "preparation.lock");
    const receipts = path.join(base, "receipts");
    fs.mkdirSync(receipts);
    const authHelper = path.resolve("scripts/custom-runtime/custom-runtime-auth.sh");
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        '. "$AUTH_HELPER"; custom_runtime_update_lock_transition acquire "$LOCK" "$RECEIPTS" stamp preparation "$$" >/dev/null; python3 - "$LOCK/owner.json" "$$" <<\'PY\'\nimport json, sys\nwith open(sys.argv[1], encoding="utf-8") as f:\n    owner = json.load(f)\nraise SystemExit(0 if owner.get("pid") == int(sys.argv[2]) else 1)\nPY',
      ],
      {
        encoding: "utf8",
        env: { ...process.env, AUTH_HELPER: authHelper, LOCK: lock, RECEIPTS: receipts },
      },
    );

    expect(result.status).toBe(0);
  });

  it("does not start a second preparation while a fresh lock is present", () => {
    const base = root("openclaw-update-broker-lock-");
    const runtimeHome = path.join(base, "runtime-home");
    const lock = path.join(runtimeHome, "update-preparation.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "owner.json"), "{}\n");

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
      stage: "preparation_lock",
    });
    expect(fs.existsSync(path.join(lock, "owner.json"))).toBe(true);
  });

  it("does not overwrite a candidate that is waiting for approval", () => {
    const base = root("openclaw-update-broker-pending-");
    const runtimeHome = path.join(base, "runtime-home");
    const pendingPath = path.join(runtimeHome, "pending-update.json");
    const pending = {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      sourceSha: "a".repeat(40),
    };
    writeJson(pendingPath, pending);

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
      stage: "approval_pending",
    });
    expect(JSON.parse(fs.readFileSync(pendingPath, "utf8"))).toEqual(pending);
  });

  it("archives a legacy ready candidate so stronger backup proof can be prepared", () => {
    const base = root("openclaw-update-broker-legacy-pending-");
    const runtimeHome = path.join(base, "runtime-home");
    const pendingPath = path.join(runtimeHome, "pending-update.json");
    const pending = {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      sourceSha: "a".repeat(40),
      verifiedBackup: { schema: "openclaw.custom-runtime-update-backup.v1" },
    };
    writeJson(pendingPath, pending);

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
      stage: "active_pointer",
    });
    expect(fs.existsSync(pendingPath)).toBe(false);
    const archived = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .find((name) => name.startsWith("superseded-pending-update-"));
    expect(archived).toBeDefined();
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", archived ?? ""), "utf8")),
    ).toEqual(pending);
  });

  it("does not approve while candidate preparation is active", () => {
    const base = root("openclaw-update-broker-approval-race-");
    const runtimeHome = path.join(base, "runtime-home");
    fs.mkdirSync(path.join(runtimeHome, "update-preparation.lock"), { recursive: true });

    const result = spawnSync(approve, ["--sha", "a".repeat(40)], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
      },
    });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain("verified update preparation is active");
  });

  it("recovers a stale preparation lock before validating approval", () => {
    const base = root("openclaw-update-approval-stale-preparation-");
    const runtimeHome = path.join(base, "runtime-home");
    const lock = path.join(runtimeHome, "update-preparation.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "owner.json"), "{}\n");
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(lock, stale, stale);

    const result = spawnSync(approve, ["--sha", "a".repeat(40)], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
      },
    });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("prepared update receipt is missing");
    expect(
      fs
        .readdirSync(path.join(runtimeHome, "receipts"))
        .some((name) => name.startsWith("stale-update-preparation-lock-")),
    ).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("preserves and recovers an orphaned preparation lock", () => {
    const base = root("openclaw-update-broker-stale-lock-");
    const runtimeHome = path.join(base, "runtime-home");
    const lock = path.join(runtimeHome, "update-preparation.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "owner.json"), "{}\n");
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(lock, stale, stale);

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
      stage: "active_pointer",
    });
    expect(
      fs
        .readdirSync(path.join(runtimeHome, "receipts"))
        .some((name) => name.startsWith("stale-update-preparation-lock-")),
    ).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("preserves and recovers an orphaned installation lock before preparation", () => {
    const base = root("openclaw-update-broker-stale-installation-");
    const runtimeHome = path.join(base, "runtime-home");
    const lock = path.join(runtimeHome, "update-installation.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "owner.json"), "{}\n");
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(lock, stale, stale);

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
      stage: "active_pointer",
    });
    expect(
      fs
        .readdirSync(path.join(runtimeHome, "receipts"))
        .some((name) => name.startsWith("stale-update-installation-lock-")),
    ).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("rejects an active source without durable provenance before network or build work", () => {
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
      stage: "durable_source_provenance",
    });
  });

  it("rejects a legacy source checkout before trusting its dirty state", () => {
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
      stage: "durable_source_provenance",
    });
  });

  it("rejects stale approval and promotes only an exact pending candidate", () => {
    const base = root("openclaw-update-broker-approve-");
    const runtimeHome = path.join(base, "runtime-home");
    const releases = path.join(base, "releases");
    const release = path.join(releases, "candidate");
    const marker = path.join(base, "activated.txt");
    const sealMarker = path.join(base, "seal-verified.txt");
    const guardMarker = path.join(base, "guard-verified.txt");
    const guardEnvironmentMarker = path.join(base, "guard-environment.txt");
    const gatewayEnvironmentMarker = path.join(base, "gateway-environment.txt");
    const gatewayEnvWrapper = path.join(base, "custom-service", "gateway-wrapper.sh");
    const gatewayEnvFile = path.join(base, "custom-service", "gateway.env");
    const gatewayPlist = path.join(base, "custom-service", "gateway.plist");
    const customGuardPlist = path.join(base, "custom-service", "guard.plist");
    const customGuardLabel = "com.example.openclaw.guard";
    const sourceRepo = path.join(base, "source");
    const sourceBranch = "codex/runtime-update-test";
    fs.mkdirSync(sourceRepo, { recursive: true });
    expect(spawnSync("git", ["init", "-q", sourceRepo]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", sourceRepo, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(sourceRepo, "source.txt"), "base\n");
    expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "base"]).status).toBe(0);
    const baseSha = spawnSync("git", ["-C", sourceRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(spawnSync("git", ["-C", sourceRepo, "switch", "-qc", sourceBranch]).status).toBe(0);
    fs.writeFileSync(path.join(sourceRepo, "source.txt"), "candidate\n");
    expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "candidate"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", sourceRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(spawnSync("git", ["-C", sourceRepo, "branch", "codex/stale", baseSha]).status).toBe(0);
    fs.mkdirSync(path.join(release, "scripts", "custom-runtime"), { recursive: true });
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-activate.sh"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(marker)}\nprintf '%s\\n' "$OPENCLAW_GATEWAY_ENV_WRAPPER" "$OPENCLAW_GATEWAY_ENV_FILE" "$OPENCLAW_GATEWAY_PLIST" > ${JSON.stringify(gatewayEnvironmentMarker)}\n`,
      { mode: 0o700 },
    );
    fs.mkdirSync(path.dirname(gatewayEnvWrapper), { recursive: true });
    fs.writeFileSync(
      gatewayEnvWrapper,
      '#!/bin/sh\nenv_file=$1\nshift\n. "$env_file"\nexec "$@"\n',
      { mode: 0o700 },
    );
    fs.writeFileSync(
      gatewayEnvFile,
      [
        "export OPENCLAW_STATE_DIR=/custom",
        `export OPENCLAW_GATEWAY_ENV_WRAPPER=${JSON.stringify(gatewayEnvWrapper)}`,
        `export OPENCLAW_GATEWAY_ENV_FILE=${JSON.stringify(gatewayEnvFile)}`,
        `export OPENCLAW_CUSTOM_RUNTIME_GUARD_PLIST=${JSON.stringify(customGuardPlist)}`,
        `export OPENCLAW_CUSTOM_RUNTIME_GUARD_LABEL=${customGuardLabel}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      gatewayPlist,
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>ProgramArguments</key><array>
<string>${gatewayEnvWrapper}</string><string>${gatewayEnvFile}</string><string>${path.join(runtimeHome, "bin", "custom-runtime-launcher.sh")}</string>
</array></dict></plist>\n`,
    );
    let gatewayLaunchAgent = fileBinding(gatewayPlist);
    let gatewayEnvironment = {
      wrapper: fileBinding(gatewayEnvWrapper),
      file: fileBinding(gatewayEnvFile),
    };
    fs.mkdirSync(path.join(runtimeHome, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(runtimeHome, "bin", "custom-runtime-seal.sh"),
      `#!/bin/sh\n[ "\${OPENCLAW_TEST_SEAL_FAIL:-0}" = 0 ] || exit 1\nprintf '%s\\n' "$@" > ${JSON.stringify(sealMarker)}\n`,
      { mode: 0o700 },
    );
    fs.writeFileSync(
      path.join(runtimeHome, "bin", "custom-runtime-guard.sh"),
      `#!/bin/sh\n[ "\${OPENCLAW_TEST_GUARD_FAIL:-0}" = 0 ] || exit 1\nprintf '%s\\n' "$@" > ${JSON.stringify(guardMarker)}\nprintf '%s\\n' "$OPENCLAW_GATEWAY_ENV_WRAPPER" "$OPENCLAW_GATEWAY_ENV_FILE" "$OPENCLAW_CUSTOM_RUNTIME_GUARD_PLIST" "$OPENCLAW_CUSTOM_RUNTIME_GUARD_LABEL" > ${JSON.stringify(guardEnvironmentMarker)}\n`,
      { mode: 0o700 },
    );
    writeJson(path.join(runtimeHome, "active-runtime.json"), { sourceSha: "d".repeat(40) });
    const pending = path.join(runtimeHome, "pending-update.json");
    let preservationProof = writePreservationProof(runtimeHome, baseSha, sourceSha, release);
    const verifiedBackup = writeVerifiedBackup(runtimeHome, baseSha);
    let repositoryProof = writeRepositoryProof(runtimeHome, sourceSha);
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    let result = spawnSync(approve, ["--sha", sourceSha], {
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
    result = spawnSync(approve, ["--sha", "f".repeat(40)], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("does not match the explicitly approved SHA");
    expect(fs.existsSync(marker)).toBe(false);

    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch: "codex/stale",
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("source branch does not identify the candidate commit");
    expect(fs.existsSync(marker)).toBe(false);

    fs.appendFileSync(repositoryProof.path, "tampered\n");
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("repository proof digest changed");
    expect(fs.existsSync(marker)).toBe(false);
    repositoryProof = writeRepositoryProof(runtimeHome, sourceSha);

    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: [],
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("preservation verification ledger is invalid");
    expect(fs.existsSync(marker)).toBe(false);

    fs.appendFileSync(preservationProof.path, "tampered\n");
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("preservation proof digest changed");
    expect(fs.existsSync(marker)).toBe(false);

    preservationProof = writePreservationProof(runtimeHome, baseSha, sourceSha, release);
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
        OPENCLAW_TEST_SEAL_FAIL: "1",
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("immutable release seal verification failed");
    expect(fs.existsSync(marker)).toBe(false);

    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
        OPENCLAW_TEST_GUARD_FAIL: "1",
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("runtime guard verification failed before activation");
    expect(fs.existsSync(marker)).toBe(false);

    fs.appendFileSync(gatewayEnvWrapper, "# changed\n");
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("Gateway environment wrapper changed after preparation");
    expect(fs.existsSync(marker)).toBe(false);
    gatewayEnvironment = {
      wrapper: fileBinding(gatewayEnvWrapper),
      file: fileBinding(gatewayEnvFile),
    };
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });

    fs.appendFileSync(gatewayPlist, "<!-- changed -->\n");
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("Gateway LaunchAgent changed after preparation");
    expect(fs.existsSync(marker)).toBe(false);
    gatewayLaunchAgent = fileBinding(gatewayPlist);
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });

    fs.appendFileSync(
      path.join(release, "config", "custom-runtime-capabilities.json"),
      "tampered\n",
    );
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("changed a preservation-bound path");
    expect(fs.existsSync(marker)).toBe(false);

    preservationProof = writePreservationProof(runtimeHome, baseSha, sourceSha, release);
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      preservationProof,
      verificationCommands: resolvedVerificationCommands(sourceSha),
      verificationResult: "passed",
      verifiedBackup,
      repositoryProof,
      gatewayLaunchAgent,
      gatewayEnvironment,
    });
    result = spawnSync(approve, ["--sha", sourceSha], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(marker, "utf8")).toContain("--source-sha");
    expect(fs.readFileSync(marker, "utf8")).toContain(sourceBranch);
    expect(fs.readFileSync(sealMarker, "utf8")).toContain("--verify");
    expect(fs.readFileSync(guardMarker, "utf8")).toContain("--verify-only");
    expect(fs.readFileSync(guardEnvironmentMarker, "utf8").trim().split("\n")).toEqual([
      gatewayEnvWrapper,
      gatewayEnvFile,
      customGuardPlist,
      customGuardLabel,
    ]);
    expect(fs.readFileSync(gatewayEnvironmentMarker, "utf8").trim().split("\n")).toEqual([
      gatewayEnvWrapper,
      gatewayEnvFile,
      gatewayPlist,
    ]);
    expect(fs.existsSync(pending)).toBe(false);
    const approval = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .filter((name) => name.startsWith("update-approval-"))
      .map(
        (name) =>
          JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", name), "utf8")) as Record<
            string,
            unknown
          >,
      )
      .find((value) => value.result === "promoted");
    expect(approval).toMatchObject({ preservationProof });
  });
});

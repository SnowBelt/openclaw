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

function writeVerifiedBackup(runtimeHome: string, sourceSha: string, releaseId: string) {
  const receiptPath = path.join(runtimeHome, "receipts", "update-backup-test.json");
  writeJson(receiptPath, {
    schema: "openclaw.custom-runtime-update-backup.v2",
    mode: "local_verified",
    sourceSha,
    releaseId,
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
    releaseId,
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
  it("creates a standalone candidate checkout for repository-native proof", () => {
    const source = fs.readFileSync(updater, "utf8");

    expect(source).toContain('git clone --no-local --no-checkout "$provenance_store" "$candidate"');
    expect(source).toContain('git -C "$candidate" fetch --no-tags origin "$branch:$branch"');
    expect(source).toContain('git -C "$candidate" switch -c "$update_branch" "$branch"');
    expect(source).not.toContain("source_git worktree add");
    expect(source).toMatch(/"\$repo" "\$branch" "\$survival_receipt"/u);
  });

  it("fetches a provenance-only base into a standalone candidate checkout", () => {
    const base = root("openclaw-update-broker-provenance-clone-");
    const source = path.join(base, "source");
    const provenanceStore = path.join(base, "provenance.git");
    const candidate = path.join(base, "candidate");
    expect(spawnSync("git", ["init", "-q", source]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", source, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", source, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(source, "README.md"), "custom source\n");
    expect(spawnSync("git", ["-C", source, "add", "README.md"]).status).toBe(0);
    expect(spawnSync("git", ["-C", source, "commit", "-qm", "custom source"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const provenanceRef = `refs/provenance/${sourceSha}`;
    expect(spawnSync("git", ["init", "--bare", "-q", provenanceStore]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", source, "push", "-q", provenanceStore, `HEAD:${provenanceRef}`])
        .status,
    ).toBe(0);

    expect(
      spawnSync("git", ["clone", "--no-local", "--no-checkout", provenanceStore, candidate]).status,
    ).toBe(0);
    expect(
      spawnSync("git", [
        "-C",
        candidate,
        "fetch",
        "--no-tags",
        "origin",
        `${provenanceRef}:${provenanceRef}`,
      ]).status,
    ).toBe(0);
    expect(
      spawnSync("git", ["-C", candidate, "switch", "-c", "candidate-update", provenanceRef]).status,
    ).toBe(0);
    expect(
      spawnSync("git", ["-C", candidate, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    ).toBe(sourceSha);
    expect(fs.existsSync(path.join(candidate, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(candidate, ".git", "commondir"))).toBe(false);
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

  it("rejects an active source without durable provenance before network or build work", () => {
    const base = root("openclaw-update-broker-source-");
    const runtimeHome = path.join(base, "runtime-home");
    const repo = path.join(base, "source");
    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      releaseId: "active-release",
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
      releaseId: "active-release",
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
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(marker)}\n`,
      { mode: 0o700 },
    );
    fs.mkdirSync(path.join(runtimeHome, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(runtimeHome, "bin", "custom-runtime-seal.sh"),
      `#!/bin/sh\n[ "\${OPENCLAW_TEST_SEAL_FAIL:-0}" = 0 ] || exit 1\nprintf '%s\\n' "$@" > ${JSON.stringify(sealMarker)}\n`,
      { mode: 0o700 },
    );
    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      releaseId: "active-release",
      sourceSha: "d".repeat(40),
    });
    const pending = path.join(runtimeHome, "pending-update.json");
    let preservationProof = writePreservationProof(runtimeHome, baseSha, sourceSha, release);
    const verifiedBackup = writeVerifiedBackup(runtimeHome, baseSha, "active-release");
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

    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      releaseId: "active-release",
      sourceSha: baseSha,
    });
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
    expect(fs.existsSync(pending)).toBe(false);
    const approval = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .find((name) => name.startsWith("update-approval-"));
    expect(approval).toBeTruthy();
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", approval!), "utf8")) as Record<
        string,
        unknown
      >,
    ).toMatchObject({ preservationProof });
  });
});

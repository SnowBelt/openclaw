import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const helper = path.resolve("scripts/custom-runtime/custom-runtime-source-provenance.mjs");
const sourceRemote = "https://github.com/SnowBelt/openclaw.git";
const sourceRemoteBranch = "codex/runtime-update-20260829T120000Z";
const temporaryDirectories: string[] = [];

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "OpenClaw Provenance Test",
      GIT_AUTHOR_EMAIL: "provenance-test@localhost",
      GIT_COMMITTER_NAME: "OpenClaw Provenance Test",
      GIT_COMMITTER_EMAIL: "provenance-test@localhost",
    },
  }).trim();
}

function runHelper(args: string[], cwd = process.cwd()) {
  const result = spawnSync(process.execPath, [helper, ...args], { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function createRepository(): { root: string; sourceSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-source-provenance-test-"));
  temporaryDirectories.push(root);
  runGit(root, ["init", "-q"]);
  runGit(root, ["config", "user.name", "OpenClaw Provenance Test"]);
  runGit(root, ["config", "user.email", "provenance-test@localhost"]);
  fs.writeFileSync(path.join(root, "README.md"), "provenance\n");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "custom-runtime-capabilities.json"), "{}\n");
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-qm", "provenance fixture"]);
  return { root, sourceSha: runGit(root, ["rev-parse", "HEAD"]) };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.chmodSync(directory, 0o700);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime source provenance", () => {
  it("imports, independently verifies, and truthfully migrates a recovery root", () => {
    const { root, sourceSha } = createRepository();
    const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-source-provenance-home-"));
    temporaryDirectories.push(runtimeHome);
    fs.chmodSync(runtimeHome, 0o700);
    const nonRepositoryCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-source-provenance-cwd-"),
    );
    temporaryDirectories.push(nonRepositoryCwd);
    fs.chmodSync(nonRepositoryCwd, 0o700);
    const historicalSha = "e8dc155fe2f16183373f8ce1bc8d28f5d48377cd";

    const imported = runHelper(
      [
        "import",
        "--source",
        root,
        "--source-sha",
        sourceSha,
        "--runtime-home",
        runtimeHome,
        "--source-remote",
        sourceRemote,
        "--source-remote-branch",
        sourceRemoteBranch,
      ],
      nonRepositoryCwd,
    );
    expect(imported.status, imported.stderr).toBe(0);
    const record = JSON.parse(imported.stdout) as {
      bundlePath: string;
      recordPath: string;
      sourceSha: string;
      sourceRemote: string;
      sourceRemoteBranch: string;
      storePath: string;
    };
    expect(record.sourceSha).toBe(sourceSha);
    expect(record.sourceRemote).toBe(sourceRemote);
    expect(record.sourceRemoteBranch).toBe(sourceRemoteBranch);
    expect(runGit(root, ["--git-dir", record.storePath, "remote", "get-url", "origin"])).toBe(
      sourceRemote,
    );
    expect(
      runGit(root, [
        "--git-dir",
        record.storePath,
        "rev-parse",
        `refs/remotes/origin/${sourceRemoteBranch}^{commit}`,
      ]),
    ).toBe(sourceSha);
    expect(fs.statSync(record.bundlePath).mode & 0o077).toBe(0);

    const verified = runHelper(
      ["verify", "--record", record.recordPath, "--expected-sha", sourceSha, "--deep", "true"],
      nonRepositoryCwd,
    );
    expect(verified.status, verified.stderr).toBe(0);

    const migrationResult = runHelper([
      "migrate",
      "--source",
      root,
      "--source-sha",
      sourceSha,
      "--historical-source-sha",
      historicalSha,
      "--runtime-home",
      runtimeHome,
      "--active-release",
      "legacy-runtime",
      "--source-remote",
      sourceRemote,
      "--source-remote-branch",
      sourceRemoteBranch,
    ]);
    expect(migrationResult.status, migrationResult.stderr).toBe(0);
    const migration = JSON.parse(migrationResult.stdout) as {
      historicalAvailability: string;
      recoveryRootSha: string;
      path: string;
    };
    expect(migration.historicalAvailability).toBe("unavailable_local_and_remote");
    expect(migration.recoveryRootSha).toMatch(/^[a-f0-9]{40}$/u);

    const migrationVerified = runHelper([
      "verify-migration",
      "--migration",
      migration.path,
      "--historical-source-sha",
      historicalSha,
      "--candidate-sha",
      sourceSha,
    ]);
    expect(migrationVerified.status, migrationVerified.stderr).toBe(0);

    const repeatedImport = runHelper([
      "import",
      "--source",
      root,
      "--source-sha",
      sourceSha,
      "--runtime-home",
      runtimeHome,
      "--source-remote",
      sourceRemote,
      "--source-remote-branch",
      sourceRemoteBranch,
    ]);
    expect(repeatedImport.status, repeatedImport.stderr).toBe(0);
    expect(JSON.parse(repeatedImport.stdout)).toMatchObject({ recordPath: record.recordPath });
  });

  it("rejects a changed bundle instead of trusting its recorded digest", () => {
    const { root, sourceSha } = createRepository();
    const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-source-provenance-home-"));
    temporaryDirectories.push(runtimeHome);
    fs.chmodSync(runtimeHome, 0o700);
    const imported = runHelper([
      "import",
      "--source",
      root,
      "--source-sha",
      sourceSha,
      "--runtime-home",
      runtimeHome,
      "--source-remote",
      sourceRemote,
      "--source-remote-branch",
      sourceRemoteBranch,
    ]);
    expect(imported.status, imported.stderr).toBe(0);
    const record = JSON.parse(imported.stdout) as { bundlePath: string; recordPath: string };
    fs.appendFileSync(record.bundlePath, "tampered\n");

    const result = runHelper([
      "verify",
      "--record",
      record.recordPath,
      "--expected-sha",
      sourceSha,
      "--deep",
      "true",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bundle hash does not match");
  });

  it("does not repair directory permissions while verifying provenance", () => {
    const { root, sourceSha } = createRepository();
    const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-source-provenance-home-"));
    temporaryDirectories.push(runtimeHome);
    fs.chmodSync(runtimeHome, 0o700);
    const imported = runHelper([
      "import",
      "--source",
      root,
      "--source-sha",
      sourceSha,
      "--runtime-home",
      runtimeHome,
    ]);
    expect(imported.status, imported.stderr).toBe(0);
    const record = JSON.parse(imported.stdout) as { recordPath: string; storePath: string };
    fs.chmodSync(record.storePath, 0o710);

    const result = runHelper([
      "verify",
      "--record",
      record.recordPath,
      "--expected-sha",
      sourceSha,
      "--deep",
      "true",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("provenance Git store is not private");
    expect(fs.statSync(record.storePath).mode & 0o777).toBe(0o710);
  });
});

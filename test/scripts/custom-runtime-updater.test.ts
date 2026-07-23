import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const updater = path.resolve("scripts/custom-runtime/custom-runtime-updater.sh");
const approve = path.resolve("scripts/custom-runtime/custom-runtime-update-approve.sh");
const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);

function root(prefix: string): string {
  return fs.realpathSync(temporaryDirectories.make(prefix));
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

function initializeSourceRepository(
  sourceRepo: string,
  branchName: string,
): { sourceBranch: string; sourceSha: string } {
  fs.mkdirSync(sourceRepo, { recursive: true });
  expect(spawnSync("git", ["init", "-q", sourceRepo]).status).toBe(0);
  expect(
    spawnSync("git", ["-C", sourceRepo, "config", "user.email", "test@example.invalid"]).status,
  ).toBe(0);
  expect(spawnSync("git", ["-C", sourceRepo, "config", "user.name", "Test"]).status).toBe(0);
  fs.writeFileSync(path.join(sourceRepo, "source.txt"), "candidate\n");
  expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
  expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "candidate"]).status).toBe(0);
  expect(spawnSync("git", ["-C", sourceRepo, "branch", "-M", branchName]).status).toBe(0);
  return {
    sourceBranch: `refs/heads/${branchName}`,
    sourceSha: spawnSync("git", ["-C", sourceRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim(),
  };
}

function prepareApprovalCandidate(input: {
  base: string;
  durableSourceRoot: string;
  sourceBranch: string;
  sourceRepo: string;
  sourceSha: string;
}): {
  activateMarker: string;
  env: NodeJS.ProcessEnv;
  pending: string;
  receipt: Record<string, unknown>;
  remote: string;
  remoteRef: string;
  stageMarker: string;
} {
  const runtimeHome = path.join(input.base, "runtime-home");
  const releases = path.join(input.base, "releases");
  const release = path.join(releases, "candidate");
  const remote = path.join(input.base, "source-remote.git");
  const remoteRef = "refs/heads/codex/approval-recovery";
  const stageMarker = path.join(input.base, "staged.txt");
  const activateMarker = path.join(input.base, "activated.txt");
  const baseSha = "d".repeat(40);
  fs.mkdirSync(path.join(release, "scripts", "custom-runtime"), { recursive: true });
  expect(spawnSync("git", ["init", "--bare", "-q", remote]).status).toBe(0);
  fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${input.sourceSha}\n`);
  fs.writeFileSync(
    path.join(release, "scripts", "custom-runtime", "custom-runtime-stage.sh"),
    `#!/bin/sh\nprintf '%s\\n' staged > ${JSON.stringify(stageMarker)}\n`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(release, "scripts", "custom-runtime", "custom-runtime-activate.sh"),
    `#!/bin/sh\nprintf '%s\\n' activated > ${JSON.stringify(activateMarker)}\n`,
    { mode: 0o700 },
  );
  writeJson(path.join(runtimeHome, "active-runtime.json"), { sourceSha: baseSha });
  const pending = path.join(runtimeHome, "pending-update.json");
  const receipt = {
    schema: "openclaw.custom-runtime-update-candidate.v1",
    result: "ready_for_approval",
    release,
    baseSha,
    sourceSha: input.sourceSha,
    sourceRepo: input.sourceRepo,
    sourceBranch: input.sourceBranch,
    sourceRemoteUrl: remote,
    sourceRemoteRef: remoteRef,
  };
  writeJson(pending, receipt);
  return {
    activateMarker,
    env: {
      ...process.env,
      OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: input.durableSourceRoot,
      OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
      OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
    },
    pending,
    receipt,
    remote,
    remoteRef,
    stageMarker,
  };
}

function expectRemoteRefMissing(remote: string, remoteRef: string): void {
  expect(
    spawnSync("git", ["--git-dir", remote, "show-ref", "--verify", remoteRef]).status,
  ).not.toBe(0);
}

describe("custom runtime update broker", () => {
  it("binds a prepared candidate to its exact worktree and branch", () => {
    const source = fs.readFileSync(updater, "utf8");

    expect(source).toContain(
      '"$official_ref" "$active_sha" "$sha" "$candidate" "$candidate_remote_ref" "$source_remote_url"',
    );
    expect(source).toContain('"sourceRepo": repo');
    expect(source).toContain('"sourceBranch": branch');
  });

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
        OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: base,
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
        OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: base,
      },
    });

    expect(result.status).toBe(1);
    expect(latestUpdateReceipt(runtimeHome)).toMatchObject({
      result: "failed",
      stage: "durable_source_dirty",
    });
  });

  it("rejects a source branch without an exact remote recovery ref", () => {
    const base = root("openclaw-update-broker-remote-");
    const runtimeHome = path.join(base, "runtime-home");
    const repo = path.join(base, "source");
    const remote = path.join(base, "backup.git");
    fs.mkdirSync(repo, { recursive: true });
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", repo, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(repo, "README.md"), "source\n");
    fs.mkdirSync(path.join(repo, "config"), { recursive: true });
    fs.mkdirSync(path.join(repo, "scripts", "custom-runtime"), { recursive: true });
    fs.writeFileSync(path.join(repo, "config", "custom-runtime-capabilities.json"), "{}\n");
    fs.writeFileSync(
      path.join(repo, "scripts", "custom-runtime", "custom-runtime-activate.sh"),
      "#!/bin/sh\n",
    );
    expect(spawnSync("git", ["-C", repo, "add", "."]).status).toBe(0);
    expect(spawnSync("git", ["-C", repo, "commit", "-qm", "source"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const branch = spawnSync("git", ["-C", repo, "branch", "--show-current"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(spawnSync("git", ["init", "--bare", "-q", remote]).status).toBe(0);
    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      sourceSha,
      sourceRepo: repo,
      sourceGitCommonDir: path.join(repo, ".git"),
      sourceBranch: branch,
      sourceRemoteUrl: remote,
      sourceRemoteRef: `refs/heads/${branch}`,
      sourceRemoteSha: sourceSha,
    });

    const result = spawnSync(updater, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES: path.join(base, "updates"),
        OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: base,
      },
    });

    expect(result.status).toBe(1);
    expect(latestUpdateReceipt(runtimeHome)).toMatchObject({
      result: "failed",
      stage: "durable_source_remote_lookup",
    });
  });

  it("records fresh exact remote provenance before reporting no update", () => {
    const base = root("openclaw-update-broker-provenance-");
    const runtimeHome = path.join(base, "runtime-home");
    const repo = path.join(base, "source");
    const remote = path.join(base, "backup.git");
    fs.mkdirSync(path.join(repo, "config"), { recursive: true });
    fs.mkdirSync(path.join(repo, "scripts", "custom-runtime"), { recursive: true });
    expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", repo, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(repo, "config", "custom-runtime-capabilities.json"), "{}\n");
    fs.writeFileSync(
      path.join(repo, "scripts", "custom-runtime", "custom-runtime-activate.sh"),
      "#!/bin/sh\n",
    );
    expect(spawnSync("git", ["-C", repo, "add", "."]).status).toBe(0);
    expect(spawnSync("git", ["-C", repo, "commit", "-qm", "source"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const branch = spawnSync("git", ["-C", repo, "branch", "--show-current"], {
      encoding: "utf8",
    }).stdout.trim();
    const remoteRef = `refs/heads/${branch}`;
    expect(spawnSync("git", ["init", "--bare", "-q", remote]).status).toBe(0);
    expect(spawnSync("git", ["-C", repo, "push", remote, `${sourceSha}:${remoteRef}`]).status).toBe(
      0,
    );
    writeJson(path.join(runtimeHome, "active-runtime.json"), {
      sourceSha,
      sourceRepo: repo,
      sourceGitCommonDir: path.join(repo, ".git"),
      sourceBranch: branch,
      sourceRemoteUrl: remote,
      sourceRemoteRef: remoteRef,
      sourceRemoteSha: sourceSha,
    });

    const result = spawnSync(updater, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES: path.join(base, "updates"),
        OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: base,
        OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REMOTE: remote,
        OPENCLAW_CUSTOM_RUNTIME_OFFICIAL_REF: sourceSha,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(latestUpdateReceipt(runtimeHome)).toMatchObject({
      result: "no_update",
      base: sourceSha,
    });
    const provenanceName = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .find((name) => name.startsWith("source-provenance-"));
    expect(provenanceName).toBeTruthy();
    const provenance = JSON.parse(
      fs.readFileSync(path.join(runtimeHome, "receipts", provenanceName!), "utf8"),
    ) as Record<string, unknown>;
    expect(provenance).toMatchObject({
      schema: "openclaw.custom-runtime-source-provenance.v1",
      result: "passed",
      sourceRemoteRef: remoteRef,
      sourceRemoteSha: sourceSha,
      sourceRemoteUrl: remote,
      sourceSha,
    });
    expect(Date.parse(String(provenance.verifiedAt))).not.toBeNaN();
  });

  it("rejects HEAD and tag sourceBranch values before staging or publication", () => {
    const base = root("openclaw-update-approve-branch-");
    const durableSourceRoot = path.join(base, "durable");
    const sourceRepo = path.join(durableSourceRoot, "source");
    const source = initializeSourceRepository(sourceRepo, "codex/approval-source");
    const fixture = prepareApprovalCandidate({
      base,
      durableSourceRoot,
      sourceBranch: source.sourceBranch,
      sourceRepo,
      sourceSha: source.sourceSha,
    });

    for (const sourceBranch of ["HEAD", "refs/tags/approval-candidate"]) {
      writeJson(fixture.pending, { ...fixture.receipt, sourceBranch });
      const result = spawnSync(approve, [], {
        encoding: "utf8",
        env: fixture.env,
      });

      expect(result.status).toBe(64);
      expect(result.stderr).toContain("sourceBranch must be an exact refs/heads branch");
      expect(fs.existsSync(fixture.stageMarker)).toBe(false);
      expect(fs.existsSync(fixture.activateMarker)).toBe(false);
      expectRemoteRefMissing(fixture.remote, fixture.remoteRef);
    }
  });

  it("rejects a source repository outside the durable root before staging or publication", () => {
    const base = root("openclaw-update-approve-transient-");
    const durableSourceRoot = path.join(base, "durable");
    const sourceRepo = path.join(base, "transient-source");
    fs.mkdirSync(durableSourceRoot, { recursive: true });
    const source = initializeSourceRepository(sourceRepo, "codex/approval-source");
    const fixture = prepareApprovalCandidate({
      base,
      durableSourceRoot,
      sourceBranch: source.sourceBranch,
      sourceRepo,
      sourceSha: source.sourceSha,
    });

    const result = spawnSync(approve, [], {
      encoding: "utf8",
      env: fixture.env,
    });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("source repository is outside the durable source root");
    expect(fs.existsSync(fixture.stageMarker)).toBe(false);
    expect(fs.existsSync(fixture.activateMarker)).toBe(false);
    expectRemoteRefMissing(fixture.remote, fixture.remoteRef);
  });

  it("rejects a source worktree whose Git object store is outside the durable root", () => {
    const base = root("openclaw-update-approve-object-store-");
    const durableSourceRoot = path.join(base, "durable");
    const sourceRepo = path.join(durableSourceRoot, "source");
    const objectStoreRepo = path.join(base, "object-store-source");
    const source = initializeSourceRepository(objectStoreRepo, "main");
    const branchName = "codex/approval-source";
    expect(
      spawnSync("git", ["-C", objectStoreRepo, "branch", branchName, source.sourceSha]).status,
    ).toBe(0);
    fs.mkdirSync(durableSourceRoot, { recursive: true });
    expect(
      spawnSync("git", ["-C", objectStoreRepo, "worktree", "add", "-q", sourceRepo, branchName])
        .status,
    ).toBe(0);
    const fixture = prepareApprovalCandidate({
      base,
      durableSourceRoot,
      sourceBranch: `refs/heads/${branchName}`,
      sourceRepo,
      sourceSha: source.sourceSha,
    });

    const result = spawnSync(approve, [], {
      encoding: "utf8",
      env: fixture.env,
    });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain(
      "source Git common directory is outside the durable source root",
    );
    expect(fs.existsSync(fixture.stageMarker)).toBe(false);
    expect(fs.existsSync(fixture.activateMarker)).toBe(false);
    expectRemoteRefMissing(fixture.remote, fixture.remoteRef);
  });

  it("rejects dirty and non-exact source checkouts before staging or publication", () => {
    const base = root("openclaw-update-approve-exact-source-");
    const durableSourceRoot = path.join(base, "durable");
    const sourceRepo = path.join(durableSourceRoot, "source");
    const source = initializeSourceRepository(sourceRepo, "codex/approval-source");
    const fixture = prepareApprovalCandidate({
      base,
      durableSourceRoot,
      sourceBranch: source.sourceBranch,
      sourceRepo,
      sourceSha: source.sourceSha,
    });

    const dirtyPath = path.join(sourceRepo, "untracked.txt");
    fs.writeFileSync(dirtyPath, "dirty\n");
    let result = spawnSync(approve, [], {
      encoding: "utf8",
      env: fixture.env,
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("source repository is dirty");
    fs.rmSync(dirtyPath);

    expect(spawnSync("git", ["-C", sourceRepo, "switch", "--detach", "-q"]).status).toBe(0);
    fs.writeFileSync(path.join(sourceRepo, "source.txt"), "different checkout\n");
    expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "different checkout"]).status).toBe(
      0,
    );
    result = spawnSync(approve, [], {
      encoding: "utf8",
      env: fixture.env,
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("source checkout does not identify the candidate commit");
    expect(fs.existsSync(fixture.stageMarker)).toBe(false);
    expect(fs.existsSync(fixture.activateMarker)).toBe(false);
    expectRemoteRefMissing(fixture.remote, fixture.remoteRef);
  });

  it("rejects stale approval and promotes only an exact pending candidate", () => {
    const base = root("openclaw-update-broker-approve-");
    const runtimeHome = path.join(base, "runtime-home");
    const releases = path.join(base, "releases");
    const release = path.join(releases, "candidate");
    const marker = path.join(base, "activated.txt");
    const sourceRepo = path.join(base, "source");
    const sourceRemote = path.join(base, "source-remote.git");
    const sourceBranchName = "codex/runtime-update-test";
    const sourceBranch = `refs/heads/${sourceBranchName}`;
    const sourceRemoteRef = sourceBranch;
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
    expect(spawnSync("git", ["-C", sourceRepo, "switch", "-qc", sourceBranchName]).status).toBe(0);
    fs.writeFileSync(path.join(sourceRepo, "source.txt"), "candidate\n");
    expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "candidate"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", sourceRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(spawnSync("git", ["-C", sourceRepo, "branch", "codex/stale", baseSha]).status).toBe(0);
    expect(spawnSync("git", ["init", "--bare", "-q", sourceRemote]).status).toBe(0);
    fs.mkdirSync(path.join(release, "scripts", "custom-runtime"), { recursive: true });
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-activate.sh"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(marker)}\n`,
      { mode: 0o700 },
    );
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-stage.sh"),
      "#!/bin/sh\nexit 0\n",
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
      sourceRepo,
      sourceBranch,
      sourceRemoteUrl: sourceRemote,
      sourceRemoteRef,
    });
    const approvalEnv = {
      ...process.env,
      OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT: base,
      OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
      OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
    };
    let result = spawnSync(approve, [], {
      encoding: "utf8",
      env: approvalEnv,
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("active runtime changed");
    expect(fs.existsSync(marker)).toBe(false);

    writeJson(path.join(runtimeHome, "active-runtime.json"), { sourceSha: baseSha });
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch: "refs/heads/codex/stale",
      sourceRemoteUrl: sourceRemote,
      sourceRemoteRef,
    });
    result = spawnSync(approve, [], {
      encoding: "utf8",
      env: approvalEnv,
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("source branch does not identify the candidate commit");
    expect(fs.existsSync(marker)).toBe(false);

    fs.rmSync(path.join(release, ".openclaw-production-sha"));
    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      sourceRemoteUrl: sourceRemote,
      sourceRemoteRef,
    });
    result = spawnSync(approve, [], {
      encoding: "utf8",
      env: approvalEnv,
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("release source stamp is missing");
    expect(
      spawnSync("git", ["--git-dir", sourceRemote, "show-ref", "--verify", sourceRemoteRef]).status,
    ).not.toBe(0);
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);

    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-stage.sh"),
      "#!/bin/sh\nexit 1\n",
      { mode: 0o700 },
    );
    result = spawnSync(approve, [], {
      encoding: "utf8",
      env: approvalEnv,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failed staging before recovery publication");
    expect(
      spawnSync("git", ["--git-dir", sourceRemote, "show-ref", "--verify", sourceRemoteRef]).status,
    ).not.toBe(0);
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-stage.sh"),
      "#!/bin/sh\nexit 0\n",
      { mode: 0o700 },
    );

    writeJson(pending, {
      schema: "openclaw.custom-runtime-update-candidate.v1",
      result: "ready_for_approval",
      release,
      baseSha,
      sourceSha,
      sourceRepo,
      sourceBranch,
      sourceRemoteUrl: sourceRemote,
      sourceRemoteRef,
    });
    result = spawnSync(approve, [], {
      encoding: "utf8",
      env: approvalEnv,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(marker, "utf8")).toContain("--source-sha");
    expect(fs.readFileSync(marker, "utf8")).toContain(sourceBranch);
    expect(fs.readFileSync(marker, "utf8")).toContain("--source-remote-url");
    expect(fs.readFileSync(marker, "utf8")).toContain(sourceRemoteRef);
    expect(
      spawnSync("git", ["--git-dir", sourceRemote, "rev-parse", sourceRemoteRef], {
        encoding: "utf8",
      }).stdout.trim(),
    ).toBe(sourceSha);
    expect(fs.existsSync(pending)).toBe(false);
    const approval = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .find((name) => name.startsWith("update-approval-"));
    expect(approval).toBeTruthy();
  });
});

#!/usr/bin/env node
// Persist and verify the Git objects that identify a managed runtime source.
// A checkout path is only input evidence; the durable store and bundle are the
// runtime contract so a deleted temporary worktree cannot strand updates.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_PROVENANCE_SCHEMA = "openclaw.custom-runtime-source-provenance.v1";
export const SOURCE_PROVENANCE_MIGRATION_SCHEMA =
  "openclaw.custom-runtime-source-provenance-migration.v1";

const SHA_PATTERN = /^[a-f0-9]{40,64}$/u;

/** @returns {never} */
function fail(message) {
  throw new Error(`source provenance blocked: ${message}`);
}

function isSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString("utf8") || error?.message || String(error);
    return fail(`git ${args.join(" ")} failed: ${detail.trim()}`);
  }
}

function runGitDir(gitDir, args) {
  return runGit(["--git-dir", gitDir, ...args], undefined);
}

function runRemoteGit(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString("utf8") || error?.message || String(error);
    return fail(`git ${args.join(" ")} failed: ${detail.trim()}`);
  }
}

function lstatRegular(filePath, label) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing`);
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    fail(`${label} is not a private regular file`);
  }
  return info;
}

function lstatDirectory(directory, label) {
  let info;
  try {
    info = fs.lstatSync(directory);
  } catch {
    fail(`${label} is missing`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail(`${label} is not a regular directory`);
  }
  if ((info.mode & 0o077) !== 0) {
    fail(`${label} is not private`);
  }
  return info;
}

function ensurePrivateDirectory(directory, label) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  lstatDirectory(directory, label);
}

function assertInside(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} escapes its private root`);
  }
}

function writeAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory, "provenance directory");
  if (fs.existsSync(filePath) || fs.lstatSync(filePath, { throwIfNoEntry: false })) {
    fail(`immutable provenance destination already exists: ${filePath}`);
  }
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const bytes = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  let descriptor;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function readPrivateJson(filePath, label) {
  lstatRegular(filePath, label);
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(value)) {
      fail(`${label} is not an object`);
    }
    return value;
  } catch (error) {
    if (error?.message?.startsWith("source provenance blocked:")) {
      throw error;
    }
    return fail(`${label} is malformed`);
  }
}

function resolvePrivateRoot(runtimeHome) {
  const home = fs.realpathSync(path.resolve(runtimeHome));
  lstatDirectory(home, "runtime home");
  const root = path.join(home, "source-provenance");
  ensurePrivateDirectory(root, "source provenance root");
  return root;
}

function inspectSource(sourceRoot, sourceSha, sourceRemoteOverride, sourceRemoteBranch) {
  if (!isSha(sourceSha)) {
    fail("source commit must be an exact lowercase Git object id");
  }
  const root = fs.realpathSync(path.resolve(sourceRoot));
  lstatDirectory(root, "source repository");
  const head = runGit(["rev-parse", "HEAD"], root);
  if (head !== sourceSha) {
    fail(`source HEAD ${head} does not match ${sourceSha}`);
  }
  if (runGit(["status", "--porcelain", "--untracked-files=all"], root)) {
    fail("source repository is dirty");
  }
  if (runGit(["rev-parse", "--is-shallow-repository"], root) === "true") {
    fail("source repository is shallow");
  }
  const objectFormat = runGit(["rev-parse", "--show-object-format"], root);
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    fail(`unsupported Git object format ${objectFormat}`);
  }
  const alternatePathValue = runGit(["rev-parse", "--git-path", "objects/info/alternates"], root);
  const alternatePath = path.isAbsolute(alternatePathValue)
    ? alternatePathValue
    : path.resolve(root, alternatePathValue);
  if (fs.existsSync(alternatePath) && fs.readFileSync(alternatePath, "utf8").trim()) {
    fail("source repository uses an alternates object store");
  }
  runGit(["cat-file", "-e", `${sourceSha}^{commit}`], root);
  const treeSha = runGit(["rev-parse", `${sourceSha}^{tree}`], root);
  const requestedRemote = sourceRemoteOverride?.trim() ?? "";
  const remoteBranch = sourceRemoteBranch?.trim() ?? "";
  if (requestedRemote && !remoteBranch) {
    fail("source remote and branch must be provided together");
  }
  let sourceRemote = requestedRemote;
  if (!sourceRemote && remoteBranch) {
    try {
      sourceRemote = runGit(["remote", "get-url", "origin"], root);
    } catch {
      // A recovery source may be local-only; the immutable objects remain valid.
    }
  }
  // An origin URL without an explicitly bound branch is only checkout metadata,
  // not durable provenance. Recording it alone creates a record the verifier
  // must reject because remote and branch identity are one contract.
  if (!remoteBranch) {
    sourceRemote = "";
  }
  if (Boolean(sourceRemote) !== Boolean(remoteBranch)) {
    fail("source remote and branch must be provided together");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/iu.test(sourceRemote)) {
    fail("source origin contains embedded credentials");
  }
  if (remoteBranch) {
    runGit(["check-ref-format", "--branch", remoteBranch], root);
    const remoteRef = `refs/heads/${remoteBranch}`;
    const remoteResult = runRemoteGit([
      "ls-remote",
      "--heads",
      "--exit-code",
      sourceRemote,
      remoteRef,
    ]);
    const remoteLine = remoteResult.split(/\r?\n/u).find((line) => line.trim());
    const [remoteSha, resolvedRef] = remoteLine?.trim().split(/\s+/u) ?? [];
    if (remoteSha !== sourceSha || resolvedRef !== remoteRef) {
      fail("source remote branch does not resolve to the source SHA");
    }
  }
  return { root, sourceSha, treeSha, objectFormat, sourceRemote, sourceRemoteBranch: remoteBranch };
}

function verifyGitStore(storePath, sourceSha, treeSha, objectFormat) {
  lstatDirectory(storePath, "provenance Git store");
  const actualFormat = runGitDir(storePath, ["rev-parse", "--show-object-format"]);
  if (actualFormat !== objectFormat) {
    fail(`provenance Git object format ${actualFormat} differs from ${objectFormat}`);
  }
  const alternatePathValue = runGitDir(storePath, [
    "rev-parse",
    "--git-path",
    "objects/info/alternates",
  ]);
  const alternatePath = path.isAbsolute(alternatePathValue)
    ? alternatePathValue
    : path.resolve(storePath, alternatePathValue);
  if (fs.existsSync(alternatePath) && fs.readFileSync(alternatePath, "utf8").trim()) {
    fail("provenance Git store uses alternates");
  }
  runGitDir(storePath, ["cat-file", "-e", `${sourceSha}^{commit}`]);
  const actualTree = runGitDir(storePath, ["rev-parse", `${sourceSha}^{tree}`]);
  if (actualTree !== treeSha) {
    fail(`provenance tree ${actualTree} differs from ${treeSha}`);
  }
}

function verifyRemoteIdentity(storePath, sourceRemote, sourceRemoteBranch, sourceSha) {
  if (Boolean(sourceRemote) !== Boolean(sourceRemoteBranch)) {
    fail("source remote and branch must be recorded together");
  }
  if (!sourceRemote) {
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/iu.test(sourceRemote)) {
    fail("source origin contains embedded credentials");
  }
  runGitDir(storePath, ["check-ref-format", "--branch", sourceRemoteBranch]);
  if (runGitDir(storePath, ["remote", "get-url", "origin"]) !== sourceRemote) {
    fail("provenance Git store origin does not match the recorded source remote");
  }
  if (
    runGitDir(storePath, ["rev-parse", `refs/remotes/origin/${sourceRemoteBranch}^{commit}`]) !==
    sourceSha
  ) {
    fail("provenance Git store remote branch does not match the source SHA");
  }
}

function createBareStore(storePath) {
  fs.mkdirSync(storePath, { recursive: false, mode: 0o700 });
  runGit(["init", "--bare", "--quiet", storePath], undefined);
  lstatDirectory(storePath, "new provenance Git store");
}

function importObjects(sourceRoot, sourceSha, storePath, inputBundlePath) {
  // Import through a bundle rather than the local transport. This prevents a
  // new store from inheriting hardlinks or alternates from the source checkout.
  // Git's bundle revision parser requires a ref-like positive revision. HEAD is
  // the exact inspected commit here, and works for both attached and detached
  // source checkouts without mutating the source repository.
  runGit(["bundle", "create", inputBundlePath, "HEAD"], sourceRoot);
  // Bundle verification needs an object database for prerequisite checks. Do
  // not inherit the caller's cwd: launchd and other non-repository callers are
  // intentionally allowed to invoke this helper from any directory.
  runGitDir(storePath, ["bundle", "verify", inputBundlePath]);
  runGitDir(storePath, [
    "fetch",
    "--no-tags",
    inputBundlePath,
    `${sourceSha}:refs/provenance/${sourceSha}`,
  ]);
}

function bundleStore(storePath, ref, bundlePath) {
  runGitDir(storePath, ["bundle", "create", bundlePath, ref]);
  fs.chmodSync(bundlePath, 0o600);
  lstatRegular(bundlePath, "provenance bundle");
  runGitDir(storePath, ["bundle", "verify", bundlePath]);
}

function independentBundleCheck(bundlePath, sourceSha, treeSha, objectFormat, temporaryRoot) {
  const restoredStore = path.join(temporaryRoot, "restored.git");
  try {
    createBareStore(restoredStore);
    runGitDir(restoredStore, [
      "fetch",
      "--no-tags",
      bundlePath,
      `${sourceSha}:refs/restored/${sourceSha}`,
    ]);
    verifyGitStore(restoredStore, sourceSha, treeSha, objectFormat);
  } finally {
    fs.rmSync(restoredStore, { recursive: true, force: true });
  }
}

function provenanceRecordPath(root, sourceSha) {
  return path.join(root, sourceSha, "provenance.json");
}

export function importSourceProvenance({
  sourceRoot,
  sourceSha,
  runtimeHome,
  historicalSourceSha,
  sourceRemote,
  sourceRemoteBranch,
}) {
  const source = inspectSource(sourceRoot, sourceSha, sourceRemote, sourceRemoteBranch);
  const root = resolvePrivateRoot(runtimeHome);
  const finalDirectory = path.join(root, sourceSha);
  const finalStore = path.join(finalDirectory, "store.git");
  const finalBundle = path.join(finalDirectory, "source.bundle");
  const finalRecord = provenanceRecordPath(root, sourceSha);
  if (fs.existsSync(finalRecord)) {
    const existing = verifySourceProvenance({
      recordPath: finalRecord,
      expectedSha: sourceSha,
      deep: true,
    });
    if (existing.treeSha !== source.treeSha || existing.objectFormat !== source.objectFormat) {
      fail("existing provenance identity differs from source");
    }
    if (
      (source.sourceRemote && existing.sourceRemote !== source.sourceRemote) ||
      (source.sourceRemoteBranch && existing.sourceRemoteBranch !== source.sourceRemoteBranch)
    ) {
      fail("existing provenance remote identity differs from source");
    }
    return existing;
  }
  if (fs.existsSync(finalDirectory)) {
    fail("provenance identity has an incomplete existing directory");
  }

  const temporaryRoot = path.join(
    root,
    `.assembling-${sourceSha}-${process.pid}-${crypto.randomUUID()}`,
  );
  const temporaryStore = path.join(temporaryRoot, "store.git");
  const temporaryInputBundle = path.join(temporaryRoot, "source-input.bundle");
  const temporaryBundle = path.join(temporaryRoot, "source.bundle");
  const temporaryRecord = path.join(temporaryRoot, "provenance.json");
  ensurePrivateDirectory(temporaryRoot, "provenance assembly directory");
  try {
    createBareStore(temporaryStore);
    importObjects(source.root, source.sourceSha, temporaryStore, temporaryInputBundle);
    if (source.sourceRemote) {
      runGitDir(temporaryStore, ["remote", "add", "origin", source.sourceRemote]);
    }
    if (source.sourceRemoteBranch) {
      runGitDir(temporaryStore, [
        "update-ref",
        `refs/remotes/origin/${source.sourceRemoteBranch}`,
        source.sourceSha,
      ]);
    }
    verifyGitStore(temporaryStore, source.sourceSha, source.treeSha, source.objectFormat);
    bundleStore(temporaryStore, `refs/provenance/${source.sourceSha}`, temporaryBundle);
    independentBundleCheck(
      temporaryBundle,
      source.sourceSha,
      source.treeSha,
      source.objectFormat,
      temporaryRoot,
    );
    fs.rmSync(temporaryInputBundle, { force: true });
    const record = {
      schema: SOURCE_PROVENANCE_SCHEMA,
      version: 1,
      createdAt: new Date().toISOString(),
      sourceSha: source.sourceSha,
      treeSha: source.treeSha,
      objectFormat: source.objectFormat,
      sourceInputRoot: source.root,
      ...(source.sourceRemote ? { sourceRemote: source.sourceRemote } : {}),
      ...(source.sourceRemoteBranch ? { sourceRemoteBranch: source.sourceRemoteBranch } : {}),
      storePath: finalStore,
      bundlePath: finalBundle,
      bundleSha256: sha256File(temporaryBundle),
      recordPath: finalRecord,
      ...(isSha(historicalSourceSha) ? { historicalSourceSha } : {}),
    };
    writeAtomic(temporaryRecord, record);
    fs.renameSync(temporaryRoot, finalDirectory);
    const result = verifySourceProvenance({
      recordPath: finalRecord,
      expectedSha: sourceSha,
      deep: true,
    });
    return result;
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export function verifySourceProvenance({ recordPath, expectedSha, deep = false }) {
  const resolvedRecordPath = path.resolve(recordPath);
  const record = readPrivateJson(resolvedRecordPath, "source provenance record");
  if (record.schema !== SOURCE_PROVENANCE_SCHEMA || record.version !== 1) {
    fail("source provenance schema is invalid");
  }
  if (path.resolve(record.recordPath ?? "") !== resolvedRecordPath) {
    fail("source provenance record path does not match its file");
  }
  if (!isSha(record.sourceSha) || record.sourceSha !== expectedSha) {
    fail("source provenance source identity does not match the expected SHA");
  }
  if (
    !isSha(record.treeSha) ||
    (record.objectFormat !== "sha1" && record.objectFormat !== "sha256")
  ) {
    fail("source provenance object identity is invalid");
  }
  const directory = path.dirname(resolvedRecordPath);
  const storePath = path.resolve(record.storePath);
  const bundlePath = path.resolve(record.bundlePath);
  assertInside(directory, storePath, "provenance store");
  assertInside(directory, bundlePath, "provenance bundle");
  lstatRegular(bundlePath, "provenance bundle");
  if (!isSha(record.bundleSha256) || sha256File(bundlePath) !== record.bundleSha256) {
    fail("provenance bundle hash does not match");
  }
  verifyGitStore(storePath, record.sourceSha, record.treeSha, record.objectFormat);
  const sourceRemote = typeof record.sourceRemote === "string" ? record.sourceRemote.trim() : "";
  const sourceRemoteBranch =
    typeof record.sourceRemoteBranch === "string" ? record.sourceRemoteBranch.trim() : "";
  verifyRemoteIdentity(storePath, sourceRemote, sourceRemoteBranch, record.sourceSha);
  // The helper is called by launchd with no repository cwd. Verify against the
  // already hash- and tree-verified private store instead of process cwd.
  runGitDir(storePath, ["bundle", "verify", bundlePath]);
  if (deep) {
    runGitDir(storePath, ["fsck", "--full", "--strict"]);
    const temporaryRoot = fs.mkdtempSync(path.join(directory, ".verify-"));
    fs.chmodSync(temporaryRoot, 0o700);
    try {
      independentBundleCheck(
        bundlePath,
        record.sourceSha,
        record.treeSha,
        record.objectFormat,
        temporaryRoot,
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  return record;
}

function createRecoveryRoot({
  sourceRoot,
  sourceSha,
  historicalSourceSha,
  runtimeHome,
  activeRelease,
  sourceRemote,
  sourceRemoteBranch,
}) {
  const imported = importSourceProvenance({
    sourceRoot,
    sourceSha,
    runtimeHome,
    historicalSourceSha,
    sourceRemote,
    sourceRemoteBranch,
  });
  const storePath = path.resolve(imported.storePath);
  const treeSha = imported.treeSha;
  const message = [
    "OpenClaw recovery root",
    "",
    `Historical source object: ${historicalSourceSha}`,
    `Recovered source tree: ${treeSha}`,
    "The historical object was unavailable locally and upstream; this commit does not claim it.",
    "",
  ].join("\n");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "OpenClaw Recovery",
    GIT_AUTHOR_EMAIL: "recovery@localhost",
    GIT_COMMITTER_NAME: "OpenClaw Recovery",
    GIT_COMMITTER_EMAIL: "recovery@localhost",
    GIT_AUTHOR_DATE: new Date().toISOString(),
    GIT_COMMITTER_DATE: new Date().toISOString(),
  };
  const recoverySha = execFileSync("git", ["--git-dir", storePath, "commit-tree", treeSha], {
    input: message,
    env,
    encoding: "utf8",
  }).trim();
  if (!isSha(recoverySha)) {
    fail("recovery root commit was not created");
  }
  runGitDir(storePath, ["update-ref", `refs/recovery/${recoverySha}`, recoverySha]);
  const recoveryBundle = path.join(
    path.dirname(imported.bundlePath),
    `recovery-${recoverySha}.bundle`,
  );
  bundleStore(storePath, `refs/recovery/${recoverySha}`, recoveryBundle);
  const migration = {
    schema: SOURCE_PROVENANCE_MIGRATION_SCHEMA,
    version: 1,
    createdAt: new Date().toISOString(),
    historicalSourceSha,
    historicalAvailability: "unavailable_local_and_remote",
    candidateSourceSha: sourceSha,
    candidateTreeSha: treeSha,
    recoveryRootSha: recoverySha,
    recoveryRootTreeSha: runGitDir(storePath, ["rev-parse", `${recoverySha}^{tree}`]),
    candidateProvenancePath:
      imported.recordPath ?? provenanceRecordPath(path.dirname(imported.storePath), sourceSha),
    recoveryBundlePath: recoveryBundle,
    recoveryBundleSha256: sha256File(recoveryBundle),
    ...(typeof activeRelease === "string" && activeRelease ? { activeRelease } : {}),
  };
  const migrationPath = path.join(
    path.dirname(imported.bundlePath),
    `migration-${recoverySha}.json`,
  );
  writeAtomic(migrationPath, migration);
  return { ...migration, path: migrationPath, candidateProvenance: imported };
}

export function verifyProvenanceMigration({
  migrationPath,
  expectedHistoricalSha,
  expectedCandidateSha,
}) {
  if (!isSha(expectedHistoricalSha) || !isSha(expectedCandidateSha)) {
    fail("provenance migration identities must be exact Git object ids");
  }
  const resolvedMigrationPath = path.resolve(migrationPath);
  const migration = readPrivateJson(path.resolve(migrationPath), "provenance migration");
  if (migration.schema !== SOURCE_PROVENANCE_MIGRATION_SCHEMA || migration.version !== 1) {
    fail("provenance migration schema is invalid");
  }
  if (migration.historicalSourceSha !== expectedHistoricalSha) {
    fail("historical source identity does not match");
  }
  if (migration.candidateSourceSha !== expectedCandidateSha) {
    fail("candidate source identity does not match");
  }
  if (
    !isSha(migration.recoveryRootSha) ||
    migration.candidateTreeSha !== migration.recoveryRootTreeSha
  ) {
    fail("recovery root tree is not equivalent to the candidate tree");
  }
  const migrationDirectory = path.dirname(resolvedMigrationPath);
  if (
    typeof migration.recoveryBundlePath !== "string" ||
    typeof migration.candidateProvenancePath !== "string"
  ) {
    fail("provenance migration paths are incomplete");
  }
  const recoveryBundlePath = path.resolve(migration.recoveryBundlePath);
  const candidateProvenancePath = path.resolve(migration.candidateProvenancePath);
  assertInside(migrationDirectory, recoveryBundlePath, "recovery bundle");
  assertInside(migrationDirectory, candidateProvenancePath, "candidate provenance");
  lstatRegular(recoveryBundlePath, "recovery bundle");
  if (sha256File(recoveryBundlePath) !== migration.recoveryBundleSha256) {
    fail("recovery bundle hash does not match");
  }
  const candidate = verifySourceProvenance({
    recordPath: candidateProvenancePath,
    expectedSha: expectedCandidateSha,
    deep: true,
  });
  const storePath = path.resolve(candidate.storePath);
  const restoredRoot = fs.mkdtempSync(path.join(path.dirname(storePath), ".migration-verify-"));
  fs.chmodSync(restoredRoot, 0o700);
  try {
    const restoredStore = path.join(restoredRoot, "recovery.git");
    createBareStore(restoredStore);
    runGitDir(restoredStore, [
      "fetch",
      "--no-tags",
      recoveryBundlePath,
      `${migration.recoveryRootSha}:refs/recovery/${migration.recoveryRootSha}`,
    ]);
    verifyGitStore(
      restoredStore,
      migration.recoveryRootSha,
      migration.candidateTreeSha,
      candidate.objectFormat,
    );
  } finally {
    fs.rmSync(restoredRoot, { recursive: true, force: true });
  }
  return migration;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return { command, values };
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseCli(process.argv.slice(2));
    if (command === "import") {
      const result = importSourceProvenance({
        sourceRoot: values.get("source"),
        sourceSha: values.get("source-sha"),
        runtimeHome:
          values.get("runtime-home") || path.join(os.homedir(), ".openclaw-custom-runtime"),
        historicalSourceSha: values.get("historical-source-sha"),
        sourceRemote: values.get("source-remote"),
        sourceRemoteBranch: values.get("source-remote-branch"),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "verify") {
      const result = verifySourceProvenance({
        recordPath: values.get("record"),
        expectedSha: values.get("expected-sha"),
        deep: values.get("deep") === "true",
      });
      process.stdout.write(`${JSON.stringify({ result: "verified", ...result })}\n`);
    } else if (command === "migrate") {
      if (!isSha(values.get("historical-source-sha"))) {
        fail("--historical-source-sha is required");
      }
      const result = createRecoveryRoot({
        sourceRoot: values.get("source"),
        sourceSha: values.get("source-sha"),
        historicalSourceSha: values.get("historical-source-sha"),
        runtimeHome:
          values.get("runtime-home") || path.join(os.homedir(), ".openclaw-custom-runtime"),
        activeRelease: values.get("active-release"),
        sourceRemote: values.get("source-remote"),
        sourceRemoteBranch: values.get("source-remote-branch"),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "verify-migration") {
      const result = verifyProvenanceMigration({
        migrationPath: values.get("migration"),
        expectedHistoricalSha: values.get("historical-source-sha"),
        expectedCandidateSha: values.get("candidate-sha"),
      });
      process.stdout.write(`${JSON.stringify({ result: "verified", ...result })}\n`);
    } else {
      fail("command must be import, verify, migrate, or verify-migration");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
// Persist and verify the Git objects that identify a managed runtime source.
// A checkout path is only input evidence; the durable store and bundle are the
// runtime contract so a deleted temporary worktree cannot strand updates.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireStorageReservation,
  canonicalJson,
  defaultRegistryPath,
  fingerprintDisposableTree,
  releaseStorageReservation,
  registerWorkspacePath,
  sha256Canonical,
} from "./storage-admission.mjs";

export const SOURCE_PROVENANCE_SCHEMA = "openclaw.custom-runtime-source-provenance.v1";
export const SOURCE_PROVENANCE_MIGRATION_SCHEMA =
  "openclaw.custom-runtime-source-provenance-migration.v1";
export const SOURCE_PROVENANCE_RETENTION_SCHEMA =
  "openclaw.custom-runtime-source-provenance-retention.v1";
export const DEFAULT_SOURCE_PROVENANCE_MAX_SNAPSHOTS = 8;
export const DEFAULT_SOURCE_PROVENANCE_MAX_BYTES = 32 * 1024 ** 3;

const SHA_PATTERN = /^[a-f0-9]{40,64}$/u;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/u;

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
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
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
    fail(`git ${args.join(" ")} failed: ${detail.trim()}`);
  }
}

function runGitDir(gitDir, args) {
  return runGit(["--git-dir", gitDir, ...args], undefined);
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
    fail(`${label} is malformed`);
  }
}

function readReferenceJson(filePath, label) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`${label} is not a regular file`);
  }
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
    fail(`${label} is malformed`);
  }
}

function resolvePrivateRoot(runtimeHome) {
  const home = fs.realpathSync(path.resolve(runtimeHome));
  lstatDirectory(home, "runtime home");
  const root = path.join(home, "source-provenance");
  ensurePrivateDirectory(root, "source provenance root");
  return root;
}

function inspectSource(sourceRoot, sourceSha, { allowNonHeadSourceSha = false } = {}) {
  if (!isSha(sourceSha)) {
    fail("source commit must be an exact lowercase Git object id");
  }
  const root = fs.realpathSync(path.resolve(sourceRoot));
  lstatDirectory(root, "source repository");
  const head = runGit(["rev-parse", "HEAD"], root);
  if (head !== sourceSha && !allowNonHeadSourceSha) {
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
  let sourceRemote = "";
  try {
    sourceRemote = runGit(["remote", "get-url", "origin"], root);
  } catch {
    // A recovery source may be local-only; the immutable objects remain valid.
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/iu.test(sourceRemote)) {
    fail("source origin contains embedded credentials");
  }
  return { root, sourceSha, sourceHead: head, treeSha, objectFormat, sourceRemote };
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

function createBareStore(storePath) {
  fs.mkdirSync(storePath, { recursive: false, mode: 0o700 });
  runGit(["init", "--bare", "--quiet", storePath], undefined);
  lstatDirectory(storePath, "new provenance Git store");
}

function importObjects(sourceRoot, sourceSha, storePath, inputBundlePath) {
  // Import through a bundle rather than the local transport. This prevents a
  // new store from inheriting hardlinks or alternates from the source checkout.
  // A raw SHA can produce an empty bundle when the object is already reachable
  // from a ref, so advertise a containing ref and fetch the exact requested
  // object from that bundle into the destination store.
  const containingRefs = runGit(
    ["for-each-ref", "--format=%(refname)", "--contains", sourceSha],
    sourceRoot,
  )
    .split("\n")
    .map((ref) => ref.trim())
    .filter((ref) => ref.startsWith("refs/"));
  const sourceRef = containingRefs.toSorted((left, right) => left.localeCompare(right))[0];
  if (!sourceRef) {
    fail(`source object ${sourceSha} is not reachable from a Git ref`);
  }
  runGit(["bundle", "create", inputBundlePath, sourceRef], sourceRoot);
  fs.chmodSync(inputBundlePath, 0o600);
  lstatRegular(inputBundlePath, "provenance input bundle");
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

function directoryLogicalBytes(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || stat.isFile()) {
    return stat.size;
  }
  if (!stat.isDirectory()) {
    fail(`source provenance tree contains an unsupported filesystem entry: ${target}`);
  }
  return fs
    .readdirSync(target)
    .toSorted((left, right) => left.localeCompare(right))
    .reduce((total, entry) => total + directoryLogicalBytes(path.join(target, entry)), 0);
}

function collectShaStrings(value, output) {
  if (typeof value === "string") {
    if (isSha(value)) {
      output.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectShaStrings(item, output);
    }
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectShaStrings(item, output);
    }
  }
}

function collectSourceIdentityStrings(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSourceIdentityStrings(item, output);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(?:sourceSha|sourceSHA|historicalSourceSha|candidateSourceSha|activeSourceSha)$/u.test(key)
    ) {
      collectShaStrings(item, output);
    } else if (key === "sourceProvenance") {
      collectSourceIdentityStrings(item, output);
    } else {
      collectSourceIdentityStrings(item, output);
    }
  }
}

function collectShaStringsFromJson(filePath, output, errors) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    const value = readReferenceJson(filePath, `retention reference ${filePath}`);
    collectSourceIdentityStrings(value, output);
    return true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function collectActiveRegistryShaStrings(filePath, output, errors) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    const registry = readPrivateJson(filePath, `retention registry ${filePath}`);
    const activeValues = [];
    if (isRecord(registry.operations)) {
      for (const operation of Object.values(registry.operations)) {
        if (
          isRecord(operation) &&
          ["queued", "admitted", "running", "cleanup_pending"].includes(operation.state)
        ) {
          activeValues.push(operation);
        }
      }
    }
    if (isRecord(registry.reservations)) {
      for (const reservation of Object.values(registry.reservations)) {
        if (isRecord(reservation) && reservation.state === "active") {
          activeValues.push(reservation);
        }
      }
    }
    collectSourceIdentityStrings(activeValues, output);
    return true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function sourceProvenanceOpenReferences(root) {
  const result = spawnSync("lsof", ["-n", "-F", "n", root], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(
      `Unable to prove source provenance open handles: ${result.error?.message ?? result.status}`,
    );
  }
  const prefix = `${root}${path.sep}`;
  const references = new Set();
  for (const line of result.stdout.split("\n")) {
    if (!line.startsWith("n") || !line.slice(1).startsWith(prefix)) {
      continue;
    }
    const relative = line.slice(1 + prefix.length).split(path.sep)[0];
    if (isSha(relative)) {
      references.add(relative);
    }
  }
  return references;
}

function protectedCandidateSourceShas(candidateRegistryPath, protectedStates, errors) {
  if (!candidateRegistryPath) {
    return new Set();
  }
  if (!fs.existsSync(candidateRegistryPath)) {
    errors.push(`candidate retention registry is missing: ${candidateRegistryPath}`);
    return new Set();
  }
  try {
    const registry = readPrivateJson(candidateRegistryPath, "candidate retention registry");
    const candidates = isRecord(registry.candidates) ? Object.values(registry.candidates) : [];
    const output = new Set();
    for (const candidate of candidates) {
      if (isRecord(candidate) && protectedStates.has(candidate.state)) {
        collectSourceIdentityStrings(candidate, output);
      }
    }
    return output;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return new Set();
  }
}

function sourceProvenanceRecords(root, { deepVerify, errors }) {
  if (!fs.existsSync(root)) {
    errors.push(`source provenance root is missing: ${root}`);
    return [];
  }
  const records = [];
  for (const entry of fs.readdirSync(root).toSorted((left, right) => left.localeCompare(right))) {
    if (entry.startsWith(".")) {
      continue;
    }
    const directory = path.join(root, entry);
    let stat;
    try {
      stat = fs.lstatSync(directory);
    } catch (error) {
      errors.push(`source provenance entry is unreadable: ${directory}: ${error}`);
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      errors.push(`source provenance entry is not a private directory: ${directory}`);
      continue;
    }
    const recordPath = path.join(directory, "provenance.json");
    try {
      const record = verifySourceProvenance({
        recordPath,
        expectedSha: entry,
        // Structural verification is bounded for the hourly inventory. A
        // deep independent bundle restore is performed only for snapshots
        // that the reference graph protects, and again for each delete target
        // immediately before its receipt is applied.
        deep: false,
      });
      const createdAt = Date.parse(String(record.createdAt));
      if (!Number.isFinite(createdAt)) {
        throw new Error(`source provenance createdAt is invalid: ${recordPath}`);
      }
      records.push({
        path: directory,
        sourceSha: record.sourceSha,
        treeSha: record.treeSha,
        createdAt: record.createdAt,
        createdAtMs: createdAt,
        historicalSourceSha: isSha(record.historicalSourceSha) ? record.historicalSourceSha : null,
        bytes: directoryLogicalBytes(directory),
        directoryInode: stat.ino,
        directoryMtimeMs: stat.mtimeMs,
        recordSha256: sha256File(recordPath),
        recoverySnapshot: fs
          .readdirSync(directory)
          .some((name) => name.startsWith("migration-") && name.endsWith(".json")),
        deepVerified: false,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return records;
}

function referencePathsForRetention({ runtimeHome, runtimeReleasesRoot, referencePaths }) {
  const paths = new Set(
    (referencePaths ?? []).map((value) => path.resolve(value)).filter((value) => value),
  );
  const home = path.resolve(runtimeHome);
  for (const name of ["active-runtime.json", "active-rollback.json", "last-known-good.json"]) {
    paths.add(path.join(home, name));
  }
  if (runtimeReleasesRoot) {
    const root = path.resolve(runtimeReleasesRoot);
    if (fs.existsSync(root)) {
      const pointer = ["active-runtime.json", "active-rollback.json"]
        .map((name) => path.join(home, name))
        .filter((filePath) => fs.existsSync(filePath));
      const releaseNames = new Set();
      for (const filePath of pointer) {
        try {
          const value = readReferenceJson(filePath, `runtime pointer ${filePath}`);
          for (const key of ["releaseId", "previousRelease", "rollbackRelease"]) {
            if (typeof value[key] === "string" && value[key]) {
              releaseNames.add(value[key]);
            }
          }
        } catch {
          // The pointer is reported by the caller's reference scan.
        }
      }
      for (const releaseName of releaseNames) {
        paths.add(path.join(root, releaseName, ".openclaw-runtime-provenance.json"));
      }
    }
  }
  return [...paths].toSorted((left, right) => left.localeCompare(right));
}

export function planSourceProvenanceRetention({
  runtimeHome,
  maxSnapshots = DEFAULT_SOURCE_PROVENANCE_MAX_SNAPSHOTS,
  maxBytes = DEFAULT_SOURCE_PROVENANCE_MAX_BYTES,
  runtimeReleasesRoot,
  candidateRegistryPath,
  operationRegistryPath,
  temporaryWorkspaceRegistryPath,
  referencePaths = [],
  protectedCandidateStates = ["assembling", "governed", "staged", "active"],
  deepVerify = true,
  nowMs = Date.now(),
}) {
  if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots < 1) {
    throw new Error("Source provenance maxSnapshots must be a positive integer.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Source provenance maxBytes must be a positive integer.");
  }
  const root = resolvePrivateRoot(runtimeHome);
  const errors = [];
  const references = new Set();
  const referenceFiles = referencePathsForRetention({
    runtimeHome,
    runtimeReleasesRoot,
    referencePaths,
  });
  for (const filePath of referenceFiles) {
    collectShaStringsFromJson(filePath, references, errors);
  }
  for (const filePath of [operationRegistryPath, temporaryWorkspaceRegistryPath]) {
    if (filePath) {
      collectActiveRegistryShaStrings(path.resolve(filePath), references, errors);
    }
  }
  const candidateReferences = protectedCandidateSourceShas(
    candidateRegistryPath ? path.resolve(candidateRegistryPath) : undefined,
    new Set(protectedCandidateStates),
    errors,
  );
  for (const sourceSha of candidateReferences) {
    references.add(sourceSha);
  }
  let openReferences = new Set();
  try {
    openReferences = sourceProvenanceOpenReferences(root);
    for (const sourceSha of openReferences) {
      references.add(sourceSha);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const records = sourceProvenanceRecords(root, { deepVerify, errors });
  const bySha = new Map(records.map((record) => [record.sourceSha, record]));
  for (const sourceSha of references) {
    if (!bySha.has(sourceSha)) {
      errors.push(`referenced source provenance record is missing: ${sourceSha}`);
    }
  }
  const protectedBySha = new Map();
  const protect = (sourceSha, reason) => {
    if (!bySha.has(sourceSha)) {
      return;
    }
    const reasons = protectedBySha.get(sourceSha) ?? [];
    if (!reasons.includes(reason)) {
      reasons.push(reason);
      reasons.sort((left, right) => left.localeCompare(right));
    }
    protectedBySha.set(sourceSha, reasons);
  };
  for (const sourceSha of references) {
    protect(sourceSha, openReferences.has(sourceSha) ? "open_process_reference" : "live_reference");
  }
  const lineages = new Map();
  const recoveryLineages = new Map();
  for (const record of records) {
    const lineage = record.historicalSourceSha ?? "__unqualified-source-lineage__";
    const group = lineages.get(lineage) ?? [];
    group.push(record);
    lineages.set(lineage, group);
    if (record.recoverySnapshot) {
      const recoveryGroup = recoveryLineages.get(lineage) ?? [];
      recoveryGroup.push(record);
      recoveryLineages.set(lineage, recoveryGroup);
    }
  }
  for (const group of lineages.values()) {
    group.sort(
      (left, right) =>
        right.createdAtMs - left.createdAtMs || left.sourceSha.localeCompare(right.sourceSha),
    );
    protect(group[0].sourceSha, "newest_deep_verified_per_lineage");
  }
  for (const group of recoveryLineages.values()) {
    group.sort(
      (left, right) =>
        right.createdAtMs - left.createdAtMs || left.sourceSha.localeCompare(right.sourceSha),
    );
    protect(group[0].sourceSha, "recovery_snapshot");
  }
  if (deepVerify) {
    for (const record of records) {
      if (!protectedBySha.has(record.sourceSha)) {
        continue;
      }
      try {
        verifySourceProvenance({
          recordPath: path.join(record.path, "provenance.json"),
          expectedSha: record.sourceSha,
          deep: true,
        });
        record.deepVerified = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const protectedRecords = records.filter((record) => protectedBySha.has(record.sourceSha));
  const protectedBytes = protectedRecords.reduce((total, record) => total + record.bytes, 0);
  const protectedCount = protectedRecords.length;
  if (protectedCount > maxSnapshots || protectedBytes > maxBytes) {
    errors.push(
      `protected source provenance exceeds retention cap: ${protectedCount} snapshots/${protectedBytes} bytes ` +
        `(caps ${maxSnapshots}/${maxBytes})`,
    );
  }
  const selected = new Set(protectedRecords.map((record) => record.sourceSha));
  const selectedBytes = protectedBytes;
  const totalCount = records.length;
  const totalBytes = records.reduce((total, record) => total + record.bytes, 0);
  const capExceeded = totalCount > maxSnapshots || totalBytes > maxBytes;
  const importBlocked = totalCount >= maxSnapshots || totalBytes >= maxBytes;
  const entries = records.map((record) => {
    const reasons = protectedBySha.get(record.sourceSha) ?? [];
    const retainedByCap = selected.has(record.sourceSha);
    const decision = reasons.length > 0 || retainedByCap || errors.length > 0 ? "retain" : "retire";
    return {
      ...record,
      decision,
      protectedReasons: reasons,
      retainedByCap,
    };
  });
  return {
    schema: SOURCE_PROVENANCE_RETENTION_SCHEMA,
    generatedAt: new Date(nowMs).toISOString(),
    runtimeHome: path.resolve(runtimeHome),
    root,
    runtimeReleasesRoot: runtimeReleasesRoot ? path.resolve(runtimeReleasesRoot) : null,
    candidateRegistryPath: candidateRegistryPath ? path.resolve(candidateRegistryPath) : null,
    operationRegistryPath: operationRegistryPath ? path.resolve(operationRegistryPath) : null,
    temporaryWorkspaceRegistryPath: temporaryWorkspaceRegistryPath
      ? path.resolve(temporaryWorkspaceRegistryPath)
      : null,
    protectedCandidateStates: [...protectedCandidateStates].toSorted(),
    maxSnapshots,
    maxBytes,
    protectedCount,
    protectedBytes,
    selectedCount: selected.size,
    selectedBytes,
    totalCount,
    totalBytes,
    capExceeded,
    importBlocked,
    openReferences: [...openReferences].toSorted(),
    referenceFiles,
    errors,
    admissionBlocked: errors.length > 0,
    entries,
    retireBytes: entries
      .filter((entry) => entry.decision === "retire")
      .reduce((total, entry) => total + entry.bytes, 0),
  };
}

function writeRetentionJson(filePath, payload) {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    fail(`retention receipt already exists: ${resolved}`);
  }
  writeAtomic(resolved, payload);
}

function retentionReceiptPayload(plan, entry, nowMs) {
  if (plan.admissionBlocked || plan.errors.length > 0) {
    throw new Error("Cannot create a source provenance retention receipt from a blocked plan.");
  }
  if (entry.decision !== "retire") {
    throw new Error(`Source provenance entry is not eligible for retirement: ${entry.sourceSha}`);
  }
  const fingerprint = fingerprintDisposableTree(entry.path);
  return {
    schema: SOURCE_PROVENANCE_RETENTION_SCHEMA,
    version: 1,
    decision: "approved-disposable",
    createdAt: new Date(nowMs).toISOString(),
    root: plan.root,
    runtimeHome: plan.runtimeHome,
    maxSnapshots: plan.maxSnapshots,
    maxBytes: plan.maxBytes,
    runtimeReleasesRoot: plan.runtimeReleasesRoot ?? null,
    candidateRegistryPath: plan.candidateRegistryPath ?? null,
    operationRegistryPath: plan.operationRegistryPath ?? null,
    temporaryWorkspaceRegistryPath: plan.temporaryWorkspaceRegistryPath ?? null,
    protectedCandidateStates: plan.protectedCandidateStates ?? [],
    referenceFiles: plan.referenceFiles,
    planSha256: sha256Canonical(plan),
    target: {
      sourceSha: entry.sourceSha,
      treeSha: entry.treeSha,
      recordSha256: entry.recordSha256,
      bytes: entry.bytes,
      fingerprint,
    },
  };
}

export function createSourceProvenanceRetentionReceipt({
  plan,
  sourceSha,
  receiptPath,
  nowMs = Date.now(),
}) {
  const entry = plan.entries.find((candidate) => candidate.sourceSha === sourceSha);
  if (!entry) {
    throw new Error(`Source provenance entry is not present in the retention plan: ${sourceSha}`);
  }
  const payload = retentionReceiptPayload(plan, entry, nowMs);
  const receipt = { ...payload, receiptSha256: sha256Canonical(payload) };
  writeRetentionJson(receiptPath, receipt);
  return receipt;
}

function retentionNoOpenHandles(target) {
  const result = spawnSync("lsof", ["+D", target], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`Unable to verify source provenance handles: ${target}`);
  }
  return result.status === 1 || !result.stdout.trim();
}

export function applySourceProvenanceRetentionReceipt({ receiptPath, expectedReceiptSha256 }) {
  const receipt = readPrivateJson(path.resolve(receiptPath), "source provenance retention receipt");
  const { receiptSha256, ...payload } = receipt;
  if (
    receipt.schema !== SOURCE_PROVENANCE_RETENTION_SCHEMA ||
    receipt.decision !== "approved-disposable"
  ) {
    throw new Error("Source provenance retention receipt schema or decision is invalid.");
  }
  const actual = sha256Canonical(payload);
  if (receiptSha256 !== actual || expectedReceiptSha256 !== actual) {
    throw new Error("Source provenance retention receipt digest does not match.");
  }
  const target = payload.target;
  if (!isRecord(target) || !isSha(target.sourceSha) || !isSha(target.treeSha)) {
    throw new Error("Source provenance retention target identity is invalid.");
  }
  const root = path.resolve(payload.root);
  const targetPath = path.join(root, target.sourceSha);
  assertInside(root, targetPath, "source provenance retention target");
  if (!Array.isArray(payload.referenceFiles) || !Array.isArray(payload.protectedCandidateStates)) {
    throw new Error("Source provenance retention receipt reference contract is incomplete.");
  }
  const currentPlan = planSourceProvenanceRetention({
    runtimeHome: payload.runtimeHome,
    maxSnapshots: payload.maxSnapshots,
    maxBytes: payload.maxBytes,
    runtimeReleasesRoot: payload.runtimeReleasesRoot ?? undefined,
    candidateRegistryPath: payload.candidateRegistryPath ?? undefined,
    operationRegistryPath: payload.operationRegistryPath ?? undefined,
    temporaryWorkspaceRegistryPath: payload.temporaryWorkspaceRegistryPath ?? undefined,
    referencePaths: payload.referenceFiles,
    protectedCandidateStates: payload.protectedCandidateStates,
    deepVerify: false,
  });
  if (currentPlan.admissionBlocked || currentPlan.errors.length > 0) {
    throw new Error(
      `Source provenance retention references changed or became unverifiable: ${currentPlan.errors.join("; ")}`,
    );
  }
  const currentEntry = currentPlan.entries.find((entry) => entry.sourceSha === target.sourceSha);
  if (!currentEntry || currentEntry.decision !== "retire") {
    throw new Error(`Source provenance target is no longer unreferenced: ${target.sourceSha}`);
  }
  if (
    currentEntry.treeSha !== target.treeSha ||
    currentEntry.recordSha256 !== target.recordSha256
  ) {
    throw new Error(
      `Source provenance target identity changed after re-audit: ${target.sourceSha}`,
    );
  }
  const record = verifySourceProvenance({
    recordPath: path.join(targetPath, "provenance.json"),
    expectedSha: target.sourceSha,
    deep: true,
  });
  if (record.treeSha !== target.treeSha || sha256File(record.recordPath) !== target.recordSha256) {
    throw new Error(`Source provenance identity changed after approval: ${target.sourceSha}`);
  }
  const fingerprint = fingerprintDisposableTree(targetPath);
  if (canonicalJson(fingerprint) !== canonicalJson(target.fingerprint)) {
    throw new Error(`Source provenance tree changed after approval: ${target.sourceSha}`);
  }
  if (!retentionNoOpenHandles(targetPath)) {
    throw new Error(`Source provenance tree has an open handle: ${targetPath}`);
  }
  fs.rmSync(targetPath, { recursive: true, force: false });
  if (fs.existsSync(targetPath)) {
    throw new Error(`Source provenance tree remains after retirement: ${targetPath}`);
  }
  const result = {
    schema: "openclaw.source-provenance-retention-applied.v1",
    receiptSha256: actual,
    sourceSha: target.sourceSha,
    removedPath: targetPath,
    bytes: target.bytes,
    appliedAt: new Date().toISOString(),
  };
  const appliedReceiptPath = `${path.resolve(receiptPath)}.applied.json`;
  const appliedReceipt = { ...result, appliedReceiptSha256: sha256Canonical(result) };
  writeRetentionJson(appliedReceiptPath, appliedReceipt);
  return { ...appliedReceipt, appliedReceiptPath };
}

export function importSourceProvenance({
  sourceRoot,
  sourceSha,
  runtimeHome,
  historicalSourceSha,
  storageReservation,
  storageAdmission = {},
  sourceProvenanceRetention = {},
  allowNonHeadSourceSha = false,
}) {
  const source = inspectSource(sourceRoot, sourceSha, { allowNonHeadSourceSha });
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
    return existing;
  }
  if (fs.existsSync(finalDirectory)) {
    fail("provenance identity has an incomplete existing directory");
  }

  const retentionPlan = planSourceProvenanceRetention({
    runtimeHome,
    maxSnapshots: sourceProvenanceRetention.maxSnapshots ?? DEFAULT_SOURCE_PROVENANCE_MAX_SNAPSHOTS,
    maxBytes: sourceProvenanceRetention.maxBytes ?? DEFAULT_SOURCE_PROVENANCE_MAX_BYTES,
    runtimeReleasesRoot: sourceProvenanceRetention.runtimeReleasesRoot,
    candidateRegistryPath: sourceProvenanceRetention.candidateRegistryPath,
    operationRegistryPath: sourceProvenanceRetention.operationRegistryPath,
    temporaryWorkspaceRegistryPath: sourceProvenanceRetention.temporaryWorkspaceRegistryPath,
    referencePaths: sourceProvenanceRetention.referencePaths,
    deepVerify: false,
  });
  const allowedMissingReference = `referenced source provenance record is missing: ${sourceSha}`;
  const blockingRetentionErrors = sourceProvenanceRetention.allowMissingReferenceSourceSha
    ? retentionPlan.errors.filter((error) => error !== allowedMissingReference)
    : retentionPlan.errors;
  const blockImportWhenCapExceeded = sourceProvenanceRetention.blockImportWhenCapExceeded !== false;
  if (
    (retentionPlan.admissionBlocked && blockingRetentionErrors.length > 0) ||
    (blockImportWhenCapExceeded && retentionPlan.importBlocked)
  ) {
    const details = [...blockingRetentionErrors];
    if (blockImportWhenCapExceeded && retentionPlan.importBlocked) {
      details.push(
        `retention cap is full (${retentionPlan.totalCount} snapshots/${retentionPlan.totalBytes} bytes)`,
      );
    }
    fail(`source provenance retention admission is blocked: ${details.join("; ")}`);
  }

  let ownedReservation;
  if (!storageReservation) {
    ownedReservation = acquireStorageReservation({
      owner: "custom-runtime-source-provenance",
      taskId: `provenance-${process.pid}`,
      purpose: "import-source-provenance",
      ...storageAdmission,
      // All callers share the canonical OpenClaw registry. A per-temp-home
      // registry would let concurrent imports evade the global storage cap.
      registryPath: storageAdmission.registryPath ?? defaultRegistryPath(),
      allowedRoots: [path.resolve(runtimeHome)],
      expectedBytes: storageAdmission.expectedBytes ?? 4 * 1024 ** 3,
    });
  }
  const reservation = storageReservation ?? ownedReservation;

  const temporaryRoot = path.join(
    root,
    `.assembling-${sourceSha}-${process.pid}-${crypto.randomUUID()}`,
  );
  const temporaryStore = path.join(temporaryRoot, "store.git");
  const temporaryInputBundle = path.join(temporaryRoot, "source-input.bundle");
  const temporaryBundle = path.join(temporaryRoot, "source.bundle");
  const temporaryRecord = path.join(temporaryRoot, "provenance.json");
  let importSucceeded = false;
  try {
    ensurePrivateDirectory(temporaryRoot, "provenance assembly directory");
    registerWorkspacePath({ reservation, workspacePath: temporaryRoot });
    createBareStore(temporaryStore);
    importObjects(source.root, source.sourceSha, temporaryStore, temporaryInputBundle);
    if (source.sourceRemote) {
      runGitDir(temporaryStore, ["remote", "add", "origin", source.sourceRemote]);
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
      sourceHead: source.sourceHead,
      treeSha: source.treeSha,
      objectFormat: source.objectFormat,
      sourceInputRoot: source.root,
      ...(source.sourceRemote ? { sourceRemote: source.sourceRemote } : {}),
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
    importSucceeded = true;
    return result;
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  } finally {
    if (ownedReservation) {
      releaseStorageReservation({
        reservation: ownedReservation,
        state: importSucceeded ? "released" : "failed",
        outcome: importSucceeded
          ? "source-provenance-import-complete"
          : "source-provenance-import-failed",
      });
    }
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
  if (record.sourceHead !== undefined && !isSha(record.sourceHead)) {
    fail("source provenance source HEAD identity is invalid");
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
  // The helper is called by launchd with no repository cwd. Verify against the
  // already hash- and tree-verified private store instead of process cwd.
  runGitDir(storePath, ["bundle", "verify", bundlePath]);
  if (deep) {
    // Keep verification scratch outside the immutable provenance directory.
    // Runtime homes may intentionally be read-only to the verifier; deep
    // verification must not require a write beside source truth.
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-source-provenance-verify-"),
    );
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

/** Verify a release-embedded Git bundle without relying on an external provenance store. */
export function verifyPortableSourceProvenance({
  bundlePath,
  expectedSha,
  expectedTreeSha,
  objectFormat,
  expectedBundleSha256,
}) {
  const resolvedBundlePath = path.resolve(bundlePath);
  lstatRegular(resolvedBundlePath, "portable source provenance bundle");
  if (!isSha(expectedSha) || !isSha(expectedTreeSha)) {
    fail("portable source provenance identity is invalid");
  }
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    fail("portable source provenance object format is invalid");
  }
  const bundleSha256 = sha256File(resolvedBundlePath);
  if (expectedBundleSha256 && bundleSha256 !== expectedBundleSha256) {
    fail("portable source provenance bundle hash does not match");
  }
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-portable-source-provenance-"),
  );
  fs.chmodSync(temporaryRoot, 0o700);
  try {
    independentBundleCheck(
      resolvedBundlePath,
      expectedSha,
      expectedTreeSha,
      objectFormat,
      temporaryRoot,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return {
    sourceSha: expectedSha,
    treeSha: expectedTreeSha,
    objectFormat,
    bundlePath: resolvedBundlePath,
    bundleSha256,
  };
}

function createRecoveryRoot({
  sourceRoot,
  sourceSha,
  historicalSourceSha,
  runtimeHome,
  activeRelease,
}) {
  const imported = importSourceProvenance({
    sourceRoot,
    sourceSha,
    runtimeHome,
    historicalSourceSha,
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
  deep = true,
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
    deep,
  });
  const storePath = path.resolve(candidate.storePath);
  // The candidate store is already verified and the recovery bundle is hash-bound
  // to this migration. Reuse that store for the normal launch path; independent
  // reconstruction is reserved for explicit certification/diagnostic runs.
  runGitDir(storePath, ["bundle", "verify", recoveryBundlePath]);
  if (deep) {
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

function retentionPlanFromCli(values) {
  const runtimeHome =
    values.get("runtime-home") || path.join(os.homedir(), ".openclaw-custom-runtime");
  return planSourceProvenanceRetention({
    runtimeHome,
    maxSnapshots: Number(values.get("max-snapshots") ?? DEFAULT_SOURCE_PROVENANCE_MAX_SNAPSHOTS),
    maxBytes: Number(values.get("max-bytes") ?? DEFAULT_SOURCE_PROVENANCE_MAX_BYTES),
    runtimeReleasesRoot: values.get("runtime-releases-root"),
    candidateRegistryPath: values.get("candidate-registry"),
    operationRegistryPath: values.get("operation-registry"),
    temporaryWorkspaceRegistryPath: values.get("temporary-workspace-registry"),
    deepVerify: values.get("deep") !== "false",
  });
}

if (isMainModule()) {
  try {
    const { command, values } = parseCli(process.argv.slice(2));
    if (command === "import") {
      const allowNonHeadSourceSha = values.get("allow-non-head-source") === "true";
      const result = importSourceProvenance({
        sourceRoot: values.get("source"),
        sourceSha: values.get("source-sha"),
        runtimeHome:
          values.get("runtime-home") || path.join(os.homedir(), ".openclaw-custom-runtime"),
        historicalSourceSha: values.get("historical-source-sha"),
        allowNonHeadSourceSha,
        sourceProvenanceRetention: { allowMissingReferenceSourceSha: allowNonHeadSourceSha },
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "verify") {
      const result = verifySourceProvenance({
        recordPath: values.get("record"),
        expectedSha: values.get("expected-sha"),
        deep: values.get("deep") === "true",
      });
      process.stdout.write(`${JSON.stringify({ result: "verified", ...result })}\n`);
    } else if (command === "verify-portable") {
      const result = verifyPortableSourceProvenance({
        bundlePath: values.get("bundle"),
        expectedSha: values.get("expected-sha"),
        expectedTreeSha: values.get("expected-tree-sha"),
        objectFormat: values.get("object-format"),
        expectedBundleSha256: values.get("bundle-sha256"),
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
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "verify-migration") {
      const result = verifyProvenanceMigration({
        migrationPath: values.get("migration"),
        expectedHistoricalSha: values.get("historical-source-sha"),
        expectedCandidateSha: values.get("candidate-sha"),
        deep: values.get("deep") !== "false",
      });
      process.stdout.write(`${JSON.stringify({ result: "verified", ...result })}\n`);
    } else if (command === "retention-plan") {
      process.stdout.write(`${JSON.stringify(retentionPlanFromCli(values))}\n`);
    } else if (command === "retention-receipt") {
      const plan = values.get("plan")
        ? readPrivateJson(path.resolve(values.get("plan")), "source provenance retention plan")
        : retentionPlanFromCli(values);
      const sourceSha = values.get("source-sha");
      if (!isSha(sourceSha)) {
        fail("--source-sha is required for retention-receipt");
      }
      const result = createSourceProvenanceRetentionReceipt({
        plan,
        sourceSha,
        receiptPath: values.get("receipt"),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "retention-apply") {
      const result = applySourceProvenanceRetentionReceipt({
        receiptPath: values.get("receipt"),
        expectedReceiptSha256: values.get("receipt-sha256"),
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      fail(
        "command must be import, verify, verify-portable, migrate, verify-migration, retention-plan, retention-receipt, or retention-apply",
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

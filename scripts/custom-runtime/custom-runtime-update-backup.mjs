#!/usr/bin/env node
// Create and verify the state backup that binds a prepared update to a tested
// recovery point. Live SQLite files are handled only by `openclaw backup`.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import * as tar from "tar";

const RECEIPT_SCHEMA = "openclaw.custom-runtime-update-backup.v2";
const CONFIG_SCHEMA = "openclaw.custom-runtime-update-safety-config.v2";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(`custom runtime update backup blocked: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath, label) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(value)) {
      fail(`${label} is not an object`);
    }
    return value;
  } catch (error) {
    if (error?.message?.startsWith("custom runtime update backup blocked:")) {
      throw error;
    }
    return fail(`${label} is missing or malformed`);
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const SENSITIVE_CONTROL_PLANE_KEY =
  /(?:token|password|secret|api[-_]?key|private[-_]?key|credential|authorization|cookie)/iu;
const SENSITIVE_CONTROL_PLANE_INLINE_VALUE =
  /(?:token|password|secret|api[-_]?key|private[-_]?key|credential|authorization|cookie)\s*[:=]\s*[^\s,;]+/iu;

function redactJsonSecrets(value, key = "") {
  if (key && SENSITIVE_CONTROL_PLANE_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string" && SENSITIVE_CONTROL_PLANE_INLINE_VALUE.test(value)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonSecrets(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactJsonSecrets(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function redactedControlPlaneDescriptor(sourcePath, sourceSha256, reason) {
  return Buffer.from(
    `${JSON.stringify(
      {
        schema: "openclaw.custom-runtime-redacted-control-plane-file.v1",
        sourcePath,
        sourceSha256,
        redacted: true,
        reason,
      },
      null,
      2,
    )}\n`,
  );
}

function controlPlaneFileContents(sourcePath, sourceSha256, contentsOverride) {
  if (contentsOverride) {
    return { contents: contentsOverride, redacted: false };
  }
  const basename = path.basename(sourcePath).toLowerCase();
  if (basename.endsWith(".plist")) {
    return {
      contents: redactedControlPlaneDescriptor(
        sourcePath,
        sourceSha256,
        "credential-bearing or opaque control-plane content omitted",
      ),
      redacted: true,
    };
  }
  const contents = fs.readFileSync(sourcePath);
  if (basename === "source.bundle") {
    return { contents, redacted: false };
  }
  if (contents.includes(0)) {
    return {
      contents: redactedControlPlaneDescriptor(
        sourcePath,
        sourceSha256,
        "opaque control-plane content omitted",
      ),
      redacted: true,
    };
  }
  const text = contents.toString("utf8");
  try {
    const parsed = JSON.parse(text);
    const redacted = redactJsonSecrets(parsed);
    if (JSON.stringify(parsed) === JSON.stringify(redacted)) {
      return { contents, redacted: false };
    }
    return {
      contents: Buffer.from(`${JSON.stringify(redacted, null, 2)}\n`),
      redacted: true,
    };
  } catch {
    if (SENSITIVE_CONTROL_PLANE_KEY.test(text)) {
      return {
        contents: redactedControlPlaneDescriptor(
          sourcePath,
          sourceSha256,
          "unstructured credential-bearing control-plane content omitted",
        ),
        redacted: true,
      };
    }
    return { contents, redacted: false };
  }
}

function regularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} is not a regular file`);
  }
}

function regularDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch {
    fail(`${label} is missing`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} is not a regular directory`);
  }
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseOptions(argv) {
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

function verifyExternalRoot(externalRoot, allowTestDirectory) {
  if (!externalRoot) {
    fail("external backup root is not configured");
  }
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(externalRoot));
  } catch {
    fail("external backup root is unavailable");
  }
  regularDirectory(resolved, "external backup root");
  if (allowTestDirectory) {
    return resolved;
  }
  if (process.platform !== "darwin" || !resolved.startsWith(`/Volumes${path.sep}`)) {
    fail("external backup root must be on an attached macOS volume");
  }
  const info = execFileSync("diskutil", ["info", resolved], { encoding: "utf8" });
  if (!/^\s*File System Personality:\s*APFS\s*$/imu.test(info)) {
    fail("external backup volume is not APFS");
  }
  if (!/^\s*Encrypted:\s*Yes\s*$/imu.test(info)) {
    fail("external backup volume is not encrypted or unlocked");
  }
  return resolved;
}

function configPath(runtimeHome) {
  return path.join(runtimeHome, "update-safety.json");
}

function verifyLegacySourceBundle(bundlePath, legacyRoot, sourceSha, treeSha) {
  const canonicalPath = path.join(legacyRoot, "source.bundle");
  if (path.resolve(bundlePath) !== path.resolve(canonicalPath)) {
    fail("legacy source provenance bundle is not canonical");
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-legacy-bundle-"));
  const storePath = path.join(temporaryRoot, "store.git");
  const runGit = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    runGit(["init", "--bare", "--quiet", storePath]);
    runGit(["--git-dir", storePath, "bundle", "verify", canonicalPath]);
    const heads = runGit(["bundle", "list-heads", canonicalPath]).split("\n").filter(Boolean);
    if (heads.length !== 1 || heads[0] !== `${sourceSha} refs/provenance/${sourceSha}`) {
      throw new Error("bundle head is not bound to the active SHA");
    }
    runGit([
      "--git-dir",
      storePath,
      "fetch",
      "--no-tags",
      canonicalPath,
      `${sourceSha}:refs/provenance/${sourceSha}`,
    ]);
    if (runGit(["--git-dir", storePath, "rev-parse", "--show-object-format"]) !== "sha1") {
      throw new Error("bundle object format is not sha1");
    }
    if (runGit(["--git-dir", storePath, "rev-parse", `${sourceSha}^{commit}`]) !== sourceSha) {
      throw new Error("bundle commit does not match the active SHA");
    }
    if (runGit(["--git-dir", storePath, "rev-parse", `${sourceSha}^{tree}`]) !== treeSha) {
      throw new Error("bundle tree does not match the canonical record");
    }
    runGit(["--git-dir", storePath, "fsck", "--full", "--strict"]);
  } catch (error) {
    const detail = error?.stderr?.toString("utf8") || error?.message || String(error);
    fail(`legacy source provenance bundle validation failed: ${detail.trim()}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function resolveSourceProvenance(pointer, provenanceRoot) {
  const configured = isRecord(pointer.sourceProvenance) ? pointer.sourceProvenance : null;
  if (configured) {
    return {
      recordPath: typeof configured.recordPath === "string" ? configured.recordPath : "",
      bundlePath: typeof configured.bundlePath === "string" ? configured.bundlePath : "",
    };
  }

  const sourceSha = String(pointer.sourceSha ?? "");
  if (!SHA_PATTERN.test(sourceSha)) {
    fail("active runtime source SHA is invalid");
  }
  const legacyRoot = path.join(provenanceRoot, sourceSha);
  const recordPath = containedRegularFile(
    path.join(legacyRoot, "provenance.json"),
    provenanceRoot,
    "legacy source provenance record",
  );
  const record = readJson(recordPath, "legacy source provenance record");
  if (
    record.schema !== "openclaw.custom-runtime-source-provenance.v1" ||
    record.version !== 1 ||
    record.sourceSha !== sourceSha ||
    record.recordPath !== recordPath ||
    record.objectFormat !== "sha1" ||
    !SHA_PATTERN.test(String(record.treeSha ?? "")) ||
    typeof record.bundlePath !== "string" ||
    !DIGEST_PATTERN.test(String(record.bundleSha256 ?? ""))
  ) {
    fail("legacy source provenance record is not bound to the active SHA");
  }
  const bundlePath = containedRegularFile(
    record.bundlePath,
    legacyRoot,
    "legacy source provenance bundle",
  );
  if (sha256File(bundlePath) !== String(record.bundleSha256).toLowerCase()) {
    fail("legacy source provenance bundle hash changed");
  }
  verifyLegacySourceBundle(bundlePath, legacyRoot, sourceSha, record.treeSha);
  return { recordPath, bundlePath };
}

function configuredRecovery(runtimeHome, explicitRoot) {
  const config = readJson(configPath(runtimeHome), "update safety configuration");
  if (
    config.schema !== CONFIG_SCHEMA ||
    (config.mode !== "local_verified" && config.mode !== "external_encrypted")
  ) {
    fail("update safety configuration is invalid");
  }
  if (config.mode === "local_verified") {
    if (explicitRoot) {
      fail("local verified recovery does not accept an external destination override");
    }
    return { mode: config.mode, externalRoot: null };
  }
  if (typeof config.backupRoot !== "string" || !config.backupRoot) {
    fail("encrypted external recovery has no backup destination");
  }
  if (explicitRoot && path.resolve(explicitRoot) !== path.resolve(config.backupRoot)) {
    fail("explicit backup destination conflicts with canonical configuration");
  }
  return { mode: config.mode, externalRoot: config.backupRoot };
}

function configureBackup({
  runtimeHome,
  mode = "local_verified",
  externalRoot = "",
  allowTestDirectory = false,
}) {
  if (mode !== "local_verified" && mode !== "external_encrypted") {
    fail("recovery mode must be local_verified or external_encrypted");
  }
  const verifiedExternalRoot =
    mode === "external_encrypted" ? verifyExternalRoot(externalRoot, allowTestDirectory) : null;
  if (mode === "local_verified" && externalRoot) {
    fail("local verified recovery does not accept an external destination");
  }
  const target = configPath(runtimeHome);
  writeAtomic(target, {
    schema: CONFIG_SCHEMA,
    mode,
    ...(verifiedExternalRoot ? { backupRoot: verifiedExternalRoot } : {}),
  });
  return {
    result: "configured",
    configPath: target,
    mode,
    ...(verifiedExternalRoot ? { backupRoot: verifiedExternalRoot } : {}),
  };
}

function parseBackupOutput(stdout) {
  const trimmed = stdout.trim();
  const candidates = [trimmed, ...trimmed.split("\n").toReversed()];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (isRecord(value)) {
        return value;
      }
    } catch {
      // Continue to the next line; CLI wrappers can add non-JSON status output.
    }
  }
  return fail("openclaw backup did not return JSON evidence");
}

function walkFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile()) {
        files.push(target);
      }
    }
  };
  visit(root);
  return files;
}

function isSameOrChild(candidate, parent) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
}

function normalizeArchiveEntryPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail(`${label} is invalid`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    fail(`${label} escapes the restore directory`);
  }
  const relative = path.posix.normalize(normalized).replace(/^\.\//u, "");
  if (relative === "" || relative === ".") {
    return ".";
  }
  if (relative === ".." || relative.startsWith("../")) {
    fail(`${label} escapes the restore directory`);
  }
  return relative;
}

function resolveArchiveLinkTarget(value, entryPath, entryType, restoreRoot) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail("backup archive link target is invalid");
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    fail("backup archive link target escapes the restore directory");
  }
  const entryRoot = path.resolve(restoreRoot, entryPath);
  const linkBase = entryType === "Link" ? restoreRoot : path.dirname(entryRoot);
  const targetPath = path.resolve(linkBase, normalized);
  if (!isSameOrChild(targetPath, restoreRoot)) {
    fail("backup archive link target escapes the restore directory");
  }
  return targetPath;
}

function validateRestoreEntry(entryPath, entry, restoreRoot) {
  const relativePath = normalizeArchiveEntryPath(entryPath, "backup archive entry");
  const targetPath = path.resolve(restoreRoot, relativePath);
  if (!isSameOrChild(targetPath, restoreRoot)) {
    fail("backup archive entry escapes the restore directory");
  }
  const supportedTypes = new Set([
    "File",
    "OldFile",
    "ContiguousFile",
    "Directory",
    "GNUDumpDir",
    "Link",
    "SymbolicLink",
  ]);
  const entryType = entry?.type;
  if (!supportedTypes.has(entryType)) {
    const entryTypeLabel = typeof entryType === "string" && entryType ? entryType : "unknown";
    fail(`backup archive contains unsupported entry type ${entryTypeLabel}`);
  }
  if (entry.type === "Link" || entry.type === "SymbolicLink") {
    resolveArchiveLinkTarget(entry.linkpath, relativePath, entry.type, restoreRoot);
  }
  return true;
}

function containedRegularFile(filePath, allowedRoot, label) {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(allowedRoot);
  if (!isSameOrChild(resolvedPath, resolvedRoot)) {
    fail(`${label} is outside its managed root`);
  }
  regularFile(resolvedPath, label);
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(resolvedRoot);
    realFile = fs.realpathSync(resolvedPath);
  } catch {
    fail(`${label} is unavailable under its managed root`);
  }
  if (!isSameOrChild(realFile, realRoot)) {
    fail(`${label} escapes its managed root through a symlink`);
  }
  return realFile;
}

function verifyReceiptBinding(value, label, allowedRoot) {
  if (!isRecord(value) || !DIGEST_PATTERN.test(String(value.sha256 ?? ""))) {
    fail(`${label} binding is invalid`);
  }
  const digest = String(value.sha256).toLowerCase();
  const realFilePath = containedRegularFile(String(value.path ?? ""), allowedRoot, label);
  if (sha256File(realFilePath) !== digest) {
    fail(`${label} hash changed after verification`);
  }
  return { path: realFilePath, sha256: digest };
}

function rehearseRestore(archivePath) {
  const restoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-restore-drill-"));
  try {
    try {
      tar.x({
        file: archivePath,
        cwd: restoreRoot,
        sync: true,
        strict: true,
        preservePaths: false,
        unlink: true,
        maxDecompressionRatio: 1000,
        filter: (entryPath, entry) => validateRestoreEntry(entryPath, entry, restoreRoot),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("custom runtime update backup blocked:")
      ) {
        throw error;
      }
      const extractionError = error instanceof Error ? error.message : String(error);
      fail(`restore rehearsal extraction failed: ${extractionError}`);
    }
    const databases = walkFiles(restoreRoot).filter((filePath) =>
      /\.(?:db|sqlite|sqlite3)$/iu.test(filePath),
    );
    for (const databasePath of databases) {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const rows = database.prepare("PRAGMA quick_check").all();
        if (rows.length !== 1 || Object.values(rows[0] ?? {})[0] !== "ok") {
          fail(`restore rehearsal SQLite integrity failed for ${path.basename(databasePath)}`);
        }
      } finally {
        database.close();
      }
    }
    return {
      result: "passed",
      extractedFileCount: walkFiles(restoreRoot).length,
      sqliteCount: databases.length,
    };
  } finally {
    fs.rmSync(restoreRoot, { recursive: true, force: true });
  }
}

function controlPlaneEvidence(pointerPath, pointer, runtimeHome, homedir) {
  const runtimeRoot = path.resolve(String(pointer.runtimeRoot ?? ""));
  const entrypoint = path.resolve(String(pointer.entrypoint ?? ""));
  const runtimeHomeRoot = path.resolve(runtimeHome);
  const provenanceRoot = path.join(runtimeHomeRoot, "source-provenance");
  const provenance = resolveSourceProvenance(pointer, provenanceRoot);
  const runtimeProvenancePath = path.join(runtimeRoot, ".openclaw-runtime-provenance.json");
  let runtimeProvenanceOverride;
  // Legacy releases may predate the standalone runtime-provenance file.
  // Derive backup evidence only from snapshot facts bound to the active pointer; never mutate the release.
  try {
    const stat = fs.lstatSync(runtimeProvenancePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("active runtime provenance is not a regular file");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    const snapshotPath = path.join(runtimeRoot, "snapshot.json");
    const productionStampPath = path.join(runtimeRoot, ".openclaw-production-sha");
    const snapshot = readJson(snapshotPath, "active runtime snapshot");
    let productionSha;
    try {
      productionSha = fs.readFileSync(productionStampPath, "utf8").trim();
    } catch {
      fail("active runtime production stamp is missing");
    }
    const snapshotSource = isRecord(snapshot.source) ? snapshot.source : {};
    const snapshotPaths = isRecord(snapshot.paths) ? snapshot.paths : {};
    if (
      snapshot.version !== 2 ||
      snapshot.releaseId !== pointer.releaseId ||
      snapshot.root !== runtimeRoot ||
      snapshotSource.commit !== pointer.sourceSha ||
      productionSha !== pointer.sourceSha ||
      snapshotPaths.entrypoint !== entrypoint
    ) {
      fail("legacy runtime snapshot is not bound to the active runtime");
    }
    const snapshotSha256 = sha256File(snapshotPath);
    runtimeProvenanceOverride = Buffer.from(
      `${JSON.stringify(
        {
          schema: "openclaw.custom-runtime-legacy-runtime-provenance.v1",
          derivedFrom: {
            path: snapshotPath,
            sha256: snapshotSha256,
          },
          productionStamp: {
            path: productionStampPath,
            sourceSha: productionSha,
          },
          sourceSha: pointer.sourceSha,
          releaseId: pointer.releaseId ?? null,
          runtimeRoot,
          entrypoint: pointer.entrypoint,
        },
        null,
        2,
      )}\n`,
    );
  }
  const candidates = [
    { path: pointerPath, root: runtimeHomeRoot },
    { path: path.join(runtimeHomeRoot, "active-rollback.json"), root: runtimeHomeRoot },
    { path: path.join(runtimeHomeRoot, "last-known-good.json"), root: runtimeHomeRoot },
    {
      path: path.join(runtimeHomeRoot, "ai.openclaw.gateway.desired.plist"),
      root: runtimeHomeRoot,
    },
    { path: configPath(runtimeHomeRoot), root: runtimeHomeRoot },
    { path: path.join(runtimeRoot, ".openclaw-production-sha"), root: runtimeRoot },
    {
      path: runtimeProvenancePath,
      root: runtimeRoot,
      contents: runtimeProvenanceOverride,
      derivedFrom: runtimeProvenanceOverride ? "snapshot.json" : undefined,
    },
    { path: path.join(runtimeRoot, "snapshot.json"), root: runtimeRoot },
    {
      path: path.join(runtimeRoot, "config", "custom-runtime-capabilities.json"),
      root: runtimeRoot,
    },
    {
      path: path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
      root: path.join(homedir, "Library", "LaunchAgents"),
    },
    {
      path: typeof provenance.recordPath === "string" ? provenance.recordPath : "",
      root: provenanceRoot,
    },
    {
      path: typeof provenance.bundlePath === "string" ? provenance.bundlePath : "",
      root: provenanceRoot,
    },
  ];
  const seen = new Set();
  return candidates.flatMap(({ path: filePath, root, contents, derivedFrom }) => {
    if (!filePath) {
      return [];
    }
    if (contents) {
      return [{ sourcePath: filePath, sha256: null, contents, derivedFrom }];
    }
    try {
      const sourcePath = containedRegularFile(filePath, root, "control-plane evidence file");
      if (seen.has(sourcePath)) {
        return [];
      }
      seen.add(sourcePath);
      return [{ sourcePath, sha256: sha256File(sourcePath) }];
    } catch {
      return [];
    }
  });
}

function createControlPlaneBundle({
  runtimeHome,
  pointerPath,
  pointer,
  destinationDirectory,
  homedir,
}) {
  const required = controlPlaneEvidence(pointerPath, pointer, runtimeHome, homedir);
  const requiredSources = new Set(required.map((entry) => entry.sourcePath));
  for (const requiredPath of [
    pointerPath,
    path.join(runtimeHome, "active-rollback.json"),
    path.join(runtimeHome, "last-known-good.json"),
    path.join(runtimeHome, "ai.openclaw.gateway.desired.plist"),
    configPath(runtimeHome),
    path.join(pointer.runtimeRoot, ".openclaw-production-sha"),
    path.join(pointer.runtimeRoot, ".openclaw-runtime-provenance.json"),
    path.join(pointer.runtimeRoot, "snapshot.json"),
    path.join(pointer.runtimeRoot, "config", "custom-runtime-capabilities.json"),
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
  ]) {
    if (!requiredSources.has(path.resolve(requiredPath))) {
      fail(`required control-plane recovery file is unavailable: ${path.basename(requiredPath)}`);
    }
  }
  const provenance = resolveSourceProvenance(
    pointer,
    path.join(path.resolve(runtimeHome), "source-provenance"),
  );
  for (const [label, requiredPath] of [
    ["source provenance record", provenance.recordPath],
    ["source provenance recovery bundle", provenance.bundlePath],
  ]) {
    if (typeof requiredPath !== "string" || !requiredSources.has(path.resolve(requiredPath))) {
      fail(`${label} is unavailable`);
    }
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-control-plane-backup-"));
  try {
    const files = required.map((entry, index) => {
      const relativePath = path.join(
        "files",
        `${String(index + 1).padStart(3, "0")}-${path.basename(entry.sourcePath)}`,
      );
      const target = path.join(staging, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const stored = controlPlaneFileContents(entry.sourcePath, entry.sha256, entry.contents);
      fs.writeFileSync(target, stored.contents, { flag: "wx", mode: 0o600 });
      const storedSha256 = sha256File(target);
      if (!stored.redacted && entry.sha256 && storedSha256 !== entry.sha256) {
        fail(`control-plane copy changed while reading ${path.basename(entry.sourcePath)}`);
      }
      const file = {
        sourcePath: entry.sourcePath,
        sha256: entry.sha256,
        storedSha256,
        redacted: stored.redacted,
        relativePath,
      };
      if (entry.derivedFrom) {
        file.derivedFrom = entry.derivedFrom;
      }
      return file;
    });
    writeAtomic(path.join(staging, "manifest.json"), {
      schema: "openclaw.custom-runtime-control-plane-backup.v1",
      createdAt: new Date().toISOString(),
      sourceSha: pointer.sourceSha,
      releaseId: pointer.releaseId ?? null,
      previousRelease: pointer.previousRelease ?? null,
      files,
    });
    const bundlePath = path.join(destinationDirectory, "openclaw-control-plane.tar.gz");
    const archived = spawnSync("tar", ["-czf", bundlePath, "-C", staging, "."], {
      encoding: "utf8",
    });
    if (archived.error || archived.status !== 0) {
      fail(`control-plane archive failed: ${archived.stderr || archived.error}`);
    }
    syncFile(bundlePath);
    const rehearsal = rehearseRestore(bundlePath);
    if (rehearsal.extractedFileCount !== files.length + 1) {
      fail("control-plane recovery bundle file count is incomplete");
    }
    return { path: bundlePath, sha256: sha256File(bundlePath), fileCount: files.length };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function createBackup({
  runtimeHome,
  externalRoot = "",
  homedir = os.homedir(),
  allowTestDirectory = false,
}) {
  const pointerPath = path.join(runtimeHome, "active-runtime.json");
  const pointer = readJson(pointerPath, "active runtime pointer");
  const sourceSha = String(pointer.sourceSha ?? "");
  if (!SHA_PATTERN.test(sourceSha)) {
    fail("active runtime source SHA is invalid");
  }
  const releaseId = typeof pointer.releaseId === "string" ? pointer.releaseId.trim() : "";
  if (!releaseId) {
    fail("active runtime release identity is invalid");
  }
  const runtimeRoot = path.resolve(String(pointer.runtimeRoot ?? ""));
  regularDirectory(runtimeRoot, "active runtime root");
  const entrypoint = path.resolve(String(pointer.entrypoint ?? ""));
  if (entrypoint !== path.join(runtimeRoot, "dist", "index.js")) {
    fail("active runtime entrypoint is not the managed runtime entrypoint");
  }
  containedRegularFile(entrypoint, runtimeRoot, "active runtime entrypoint");
  const recovery = configuredRecovery(runtimeHome, externalRoot);
  const verifiedExternalRoot = recovery.externalRoot
    ? verifyExternalRoot(recovery.externalRoot, allowTestDirectory)
    : null;
  const localRoot = path.join(runtimeHome, "data-backups");
  fs.mkdirSync(localRoot, { recursive: true, mode: 0o700 });
  regularDirectory(localRoot, "local backup root");
  const localStats = fs.statfsSync(localRoot);
  const localAvailableBytes = localStats.bavail * localStats.bsize;
  const priorArchiveBytes = fs
    .readdirSync(localRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tar(?:\.gz)?$/u.test(entry.name))
    .reduce((largest, entry) => {
      try {
        return Math.max(largest, fs.statSync(path.join(localRoot, entry.name)).size);
      } catch {
        return largest;
      }
    }, 0);
  const minimumLocalBytes = Math.max(
    4 * 1024 * 1024 * 1024,
    Math.ceil(priorArchiveBytes * 1.15) + 1024 * 1024 * 1024,
  );
  if (localAvailableBytes < minimumLocalBytes) {
    fail("local backup destination does not have enough free space for a verified recovery point");
  }
  const stdout = execFileSync(
    process.execPath,
    [entrypoint, "backup", "create", "--output", localRoot, "--verify", "--json"],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const backup = parseBackupOutput(stdout);
  const archivePath = containedRegularFile(
    String(backup.archivePath ?? ""),
    localRoot,
    "verified OpenClaw backup archive",
  );
  if (backup.verified !== true) {
    fail("OpenClaw backup did not report successful verification");
  }
  const archiveSha256 = sha256File(archivePath);
  const restoreDrill = rehearseRestore(archivePath);
  const stamp = `${new Date().toISOString().replaceAll(/[-:.]/gu, "")}-${crypto.randomUUID().slice(0, 8)}`;
  const localRecoveryRoot = path.join(localRoot, "recovery");
  fs.mkdirSync(localRecoveryRoot, { recursive: true, mode: 0o700 });
  const localDirectory = path.join(localRecoveryRoot, stamp);
  const localStagingDirectory = path.join(
    localRecoveryRoot,
    `.${stamp}.partial-${process.pid}-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(localStagingDirectory, { recursive: false, mode: 0o700 });
  let controlPlane;
  try {
    const stagedControlPlane = createControlPlaneBundle({
      runtimeHome,
      pointerPath,
      pointer,
      destinationDirectory: localStagingDirectory,
      homedir,
    });
    fs.renameSync(localStagingDirectory, localDirectory);
    controlPlane = {
      ...stagedControlPlane,
      path: path.join(localDirectory, path.basename(stagedControlPlane.path)),
    };
  } catch (error) {
    fs.rmSync(localStagingDirectory, { recursive: true, force: true });
    throw error;
  }

  let externalArchive;
  let externalControlPlane;
  if (verifiedExternalRoot) {
    const externalBackupRoot = path.join(verifiedExternalRoot, "OpenClaw", "verified-updates");
    fs.mkdirSync(externalBackupRoot, { recursive: true, mode: 0o700 });
    const externalDirectory = path.join(externalBackupRoot, stamp);
    const stagingDirectory = path.join(
      externalBackupRoot,
      `.${stamp}.partial-${process.pid}-${crypto.randomUUID()}`,
    );
    fs.mkdirSync(stagingDirectory, { recursive: false, mode: 0o700 });
    try {
      const externalStats = fs.statfsSync(stagingDirectory);
      const availableBytes = externalStats.bavail * externalStats.bsize;
      const requiredBytes =
        fs.statSync(archivePath).size + fs.statSync(controlPlane.path).size + 16 * 1024 * 1024;
      if (availableBytes < requiredBytes) {
        fail("external backup volume does not have enough free space for verified recovery copies");
      }
      const stagedArchivePath = path.join(stagingDirectory, path.basename(archivePath));
      const stagedControlPlanePath = path.join(stagingDirectory, path.basename(controlPlane.path));
      fs.copyFileSync(archivePath, stagedArchivePath, fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(controlPlane.path, stagedControlPlanePath, fs.constants.COPYFILE_EXCL);
      syncFile(stagedArchivePath);
      syncFile(stagedControlPlanePath);
      if (sha256File(stagedArchivePath) !== archiveSha256) {
        fail("external backup copy hash does not match the verified local archive");
      }
      if (sha256File(stagedControlPlanePath) !== controlPlane.sha256) {
        fail("external control-plane copy hash does not match the verified local bundle");
      }
      fs.renameSync(stagingDirectory, externalDirectory);
      externalArchive = {
        path: path.join(externalDirectory, path.basename(stagedArchivePath)),
        sha256: archiveSha256,
      };
      externalControlPlane = {
        path: path.join(externalDirectory, path.basename(stagedControlPlanePath)),
        sha256: controlPlane.sha256,
      };
    } catch (error) {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  }
  const receiptPath = path.join(runtimeHome, "receipts", `update-backup-${stamp}.json`);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    mode: recovery.mode,
    createdAt: new Date().toISOString(),
    sourceSha,
    releaseId,
    result: "passed",
    backupVerified: true,
    restoreDrill,
    localArchive: { path: archivePath, sha256: archiveSha256 },
    controlPlane,
    ...(externalArchive ? { externalArchive } : {}),
    ...(externalControlPlane ? { externalControlPlane } : {}),
  };
  writeAtomic(receiptPath, receipt);
  return { ...receipt, receiptPath, receiptSha256: sha256File(receiptPath) };
}

function verifyReceipt({
  receiptPath,
  expectedSha,
  runtimeHome,
  allowTestDirectory = false,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    fail("backup receipt maximum age is invalid");
  }
  if (!SHA_PATTERN.test(expectedSha)) {
    fail("expected active source SHA is invalid");
  }
  regularFile(receiptPath, "update backup receipt");
  const resolvedReceiptPath = path.resolve(receiptPath);
  const resolvedRuntimeHome = path.resolve(
    runtimeHome || path.dirname(path.dirname(resolvedReceiptPath)),
  );
  if (!isSameOrChild(resolvedReceiptPath, path.join(resolvedRuntimeHome, "receipts"))) {
    fail("update backup receipt is outside the managed runtime receipts");
  }
  const receipt = readJson(receiptPath, "update backup receipt");
  const recovery = configuredRecovery(resolvedRuntimeHome, "");
  const activePointer = readJson(
    path.join(resolvedRuntimeHome, "active-runtime.json"),
    "active runtime pointer",
  );
  const activeReleaseId =
    typeof activePointer.releaseId === "string" ? activePointer.releaseId.trim() : "";
  if (activePointer.sourceSha !== expectedSha || !activeReleaseId) {
    fail("active runtime identity changed after backup preparation");
  }
  if (receipt.releaseId !== activeReleaseId) {
    fail("backup receipt does not match the active runtime release");
  }
  if (
    receipt.schema !== RECEIPT_SCHEMA ||
    receipt.mode !== recovery.mode ||
    receipt.result !== "passed" ||
    receipt.backupVerified !== true ||
    receipt.sourceSha !== expectedSha ||
    receipt.restoreDrill?.result !== "passed"
  ) {
    fail("backup receipt did not pass for the expected active SHA");
  }
  const createdAt = Date.parse(String(receipt.createdAt ?? ""));
  if (
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt > maxAgeMs ||
    createdAt > Date.now() + 60_000
  ) {
    fail("backup receipt is stale or has an invalid timestamp");
  }
  const localArchive = verifyReceiptBinding(
    receipt.localArchive,
    "localArchive",
    path.join(resolvedRuntimeHome, "data-backups"),
  );
  const controlPlane = verifyReceiptBinding(
    receipt.controlPlane,
    "controlPlane",
    path.join(resolvedRuntimeHome, "data-backups"),
  );
  let externalArchive;
  let externalControlPlane;
  if (recovery.externalRoot) {
    const externalRoot = verifyExternalRoot(recovery.externalRoot, allowTestDirectory);
    externalArchive = verifyReceiptBinding(
      receipt.externalArchive,
      "externalArchive",
      externalRoot,
    );
    externalControlPlane = verifyReceiptBinding(
      receipt.externalControlPlane,
      "externalControlPlane",
      externalRoot,
    );
  }
  return {
    result: "verified",
    receiptPath: resolvedReceiptPath,
    sourceSha: expectedSha,
    mode: recovery.mode,
    localArchive,
    controlPlane,
    ...(externalArchive ? { externalArchive } : {}),
    ...(externalControlPlane ? { externalControlPlane } : {}),
  };
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseOptions(process.argv.slice(2));
    const runtimeHome = path.resolve(
      values.get("runtime-home") || path.join(os.homedir(), ".openclaw-custom-runtime"),
    );
    const result =
      command === "configure"
        ? configureBackup({
            runtimeHome,
            mode: values.get("mode") || "local_verified",
            externalRoot: values.get("external-root") || "",
          })
        : command === "create"
          ? createBackup({
              runtimeHome,
              externalRoot: values.get("external-root") || "",
            })
          : command === "verify"
            ? verifyReceipt({
                receiptPath: path.resolve(values.get("receipt") || ""),
                expectedSha: values.get("expected-sha") || "",
                runtimeHome,
                maxAgeMs: Number(values.get("max-age-ms") || DEFAULT_MAX_AGE_MS),
              })
            : fail("command must be configure, create, or verify");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { configureBackup, createBackup, verifyReceipt };

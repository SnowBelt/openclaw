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

const RECEIPT_SCHEMA = "openclaw.custom-runtime-update-backup.v1";
const CONFIG_SCHEMA = "openclaw.custom-runtime-update-safety-config.v1";
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
  const resolved = fs.realpathSync(path.resolve(externalRoot));
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

function configuredExternalRoot(runtimeHome, explicitRoot) {
  if (explicitRoot) {
    return explicitRoot;
  }
  const config = readJson(configPath(runtimeHome), "update safety configuration");
  if (config.schema !== CONFIG_SCHEMA || typeof config.backupRoot !== "string") {
    fail("update safety configuration is invalid");
  }
  return config.backupRoot;
}

function configureBackup({ runtimeHome, externalRoot, allowTestDirectory = false }) {
  const verifiedExternalRoot = verifyExternalRoot(externalRoot, allowTestDirectory);
  const target = configPath(runtimeHome);
  writeAtomic(target, {
    schema: CONFIG_SCHEMA,
    backupRoot: verifiedExternalRoot,
  });
  return { result: "configured", configPath: target, backupRoot: verifiedExternalRoot };
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

function validateArchiveEntries(entries) {
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry.replaceAll("\\\\", "/"));
    if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
      fail(`restore rehearsal archive contains an unsafe path: ${entry}`);
    }
  }
}

function rehearseRestore(archivePath) {
  const restoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-restore-drill-"));
  try {
    const entries = [];
    tar.t({
      file: archivePath,
      sync: true,
      strict: true,
      onReadEntry: (entry) => entries.push(entry.path),
    });
    validateArchiveEntries(entries);
    // node-tar rejects absolute/traversing paths and checks parent symlinks
    // before writes, so the restore drill cannot escape its isolated root.
    tar.x({
      file: archivePath,
      cwd: restoreRoot,
      sync: true,
      strict: true,
      preservePaths: false,
    });
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
  const provenance = isRecord(pointer.sourceProvenance) ? pointer.sourceProvenance : {};
  const candidates = [
    pointerPath,
    path.join(runtimeHome, "active-rollback.json"),
    path.join(runtimeHome, "last-known-good.json"),
    path.join(runtimeHome, "ai.openclaw.gateway.desired.plist"),
    configPath(runtimeHome),
    path.join(runtimeRoot, ".openclaw-production-sha"),
    path.join(runtimeRoot, ".openclaw-runtime-provenance.json"),
    path.join(runtimeRoot, "snapshot.json"),
    path.join(runtimeRoot, "config", "custom-runtime-capabilities.json"),
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
    typeof provenance.recordPath === "string" ? provenance.recordPath : "",
    typeof provenance.bundlePath === "string" ? provenance.bundlePath : "",
  ];
  return [...new Set(candidates.filter(Boolean))].flatMap((filePath) => {
    try {
      regularFile(filePath, "control-plane evidence file");
      return [{ sourcePath: path.resolve(filePath), sha256: sha256File(filePath) }];
    } catch {
      return [];
    }
  });
}

function createControlPlaneBundle({
  runtimeHome,
  pointerPath,
  pointer,
  externalDirectory,
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
  const provenance = isRecord(pointer.sourceProvenance) ? pointer.sourceProvenance : {};
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
      fs.copyFileSync(entry.sourcePath, target, fs.constants.COPYFILE_EXCL);
      if (sha256File(target) !== entry.sha256) {
        fail(`control-plane copy changed while reading ${path.basename(entry.sourcePath)}`);
      }
      return { sourcePath: entry.sourcePath, sha256: entry.sha256, relativePath };
    });
    writeAtomic(path.join(staging, "manifest.json"), {
      schema: "openclaw.custom-runtime-control-plane-backup.v1",
      createdAt: new Date().toISOString(),
      sourceSha: pointer.sourceSha,
      releaseId: pointer.releaseId ?? null,
      previousRelease: pointer.previousRelease ?? null,
      files,
    });
    const bundlePath = path.join(externalDirectory, "openclaw-control-plane.tar.gz");
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
  externalRoot,
  homedir = os.homedir(),
  allowTestDirectory = false,
}) {
  const pointerPath = path.join(runtimeHome, "active-runtime.json");
  const pointer = readJson(pointerPath, "active runtime pointer");
  const sourceSha = String(pointer.sourceSha ?? "");
  if (!SHA_PATTERN.test(sourceSha)) {
    fail("active runtime source SHA is invalid");
  }
  const entrypoint = path.resolve(String(pointer.entrypoint ?? ""));
  regularFile(entrypoint, "active runtime entrypoint");
  const verifiedExternalRoot = verifyExternalRoot(
    configuredExternalRoot(runtimeHome, externalRoot),
    allowTestDirectory,
  );
  const localRoot = path.join(runtimeHome, "data-backups");
  fs.mkdirSync(localRoot, { recursive: true, mode: 0o700 });
  const stdout = execFileSync(
    process.execPath,
    [entrypoint, "backup", "create", "--output", localRoot, "--verify", "--json"],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const backup = parseBackupOutput(stdout);
  const archivePath = fs.realpathSync(path.resolve(String(backup.archivePath ?? "")));
  regularFile(archivePath, "verified OpenClaw backup archive");
  if (backup.verified !== true) {
    fail("OpenClaw backup did not report successful verification");
  }
  const archiveSha256 = sha256File(archivePath);
  const restoreDrill = rehearseRestore(archivePath);
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const externalBackupRoot = path.join(verifiedExternalRoot, "OpenClaw", "verified-updates");
  fs.mkdirSync(externalBackupRoot, { recursive: true, mode: 0o700 });
  const externalDirectory = path.join(externalBackupRoot, stamp);
  fs.mkdirSync(externalDirectory, { recursive: false, mode: 0o700 });
  const externalStats = fs.statfsSync(externalDirectory);
  const availableBytes = externalStats.bavail * externalStats.bsize;
  const requiredBytes = fs.statSync(archivePath).size * 2 + 16 * 1024 * 1024;
  if (availableBytes < requiredBytes) {
    fail("external backup volume does not have enough free space for verified recovery copies");
  }
  const externalArchivePath = path.join(externalDirectory, path.basename(archivePath));
  fs.copyFileSync(archivePath, externalArchivePath, fs.constants.COPYFILE_EXCL);
  syncFile(externalArchivePath);
  if (sha256File(externalArchivePath) !== archiveSha256) {
    fail("external backup copy hash does not match the verified local archive");
  }
  const controlPlane = createControlPlaneBundle({
    runtimeHome,
    pointerPath,
    pointer,
    externalDirectory,
    homedir,
  });
  const receiptPath = path.join(runtimeHome, "receipts", `update-backup-${stamp}.json`);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    createdAt: new Date().toISOString(),
    sourceSha,
    result: "passed",
    backupVerified: true,
    restoreDrill,
    localArchive: { path: archivePath, sha256: archiveSha256 },
    externalArchive: { path: externalArchivePath, sha256: archiveSha256 },
    controlPlane,
  };
  writeAtomic(receiptPath, receipt);
  return { ...receipt, receiptPath, receiptSha256: sha256File(receiptPath) };
}

function verifyReceipt({ receiptPath, expectedSha, maxAgeMs = DEFAULT_MAX_AGE_MS }) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    fail("backup receipt maximum age is invalid");
  }
  regularFile(receiptPath, "update backup receipt");
  const receipt = readJson(receiptPath, "update backup receipt");
  if (
    receipt.schema !== RECEIPT_SCHEMA ||
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
  for (const key of ["localArchive", "externalArchive", "controlPlane"]) {
    const binding = receipt[key];
    if (!isRecord(binding) || !DIGEST_PATTERN.test(String(binding.sha256 ?? ""))) {
      fail(`${key} binding is invalid`);
    }
    const filePath = path.resolve(String(binding.path ?? ""));
    regularFile(filePath, key);
    if (sha256File(filePath) !== binding.sha256) {
      fail(`${key} hash changed after verification`);
    }
  }
  return { result: "verified", receiptPath: path.resolve(receiptPath), sourceSha: expectedSha };
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
            externalRoot: values.get("external-root") || "",
          })
        : command === "create"
          ? createBackup({
              runtimeHome,
              externalRoot:
                values.get("external-root") ||
                process.env.OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT ||
                "",
            })
          : command === "verify"
            ? verifyReceipt({
                receiptPath: path.resolve(values.get("receipt") || ""),
                expectedSha: values.get("expected-sha") || "",
                maxAgeMs: Number(values.get("max-age-ms") || DEFAULT_MAX_AGE_MS),
              })
            : fail("command must be configure, create, or verify");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { configureBackup, createBackup, validateArchiveEntries, verifyReceipt };

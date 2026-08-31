#!/usr/bin/env node
// Create and verify the state backup that binds a prepared update to a tested
// recovery point. Live SQLite files are handled only by `openclaw backup`.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const RECEIPT_SCHEMA = "openclaw.custom-runtime-update-backup.v2";
const CONFIG_SCHEMA = "openclaw.custom-runtime-update-safety-config.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_FREE_SPACE_RESERVE_BYTES = 1024 * 1024 * 1024;

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

function ensurePrivateDirectoryPath(root, segments) {
  const verifiedRoot = fs.realpathSync(root);
  let current = verifiedRoot;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes(path.sep)) {
      fail("backup destination contains an invalid directory component");
    }
    const next = path.join(current, segment);
    try {
      const stat = fs.lstatSync(next);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        fail(`backup destination component is not a regular directory: ${segment}`);
      }
    } catch (error) {
      if (error?.message?.startsWith("custom runtime update backup blocked:")) {
        throw error;
      }
      if (error?.code !== "ENOENT") {
        throw error;
      }
      fs.mkdirSync(next, { recursive: false, mode: 0o700 });
    }
    const resolved = fs.realpathSync(next);
    if (!isPathWithin(resolved, verifiedRoot)) {
      fail(`backup destination escaped the verified external root: ${segment}`);
    }
    current = resolved;
  }
  return current;
}

function createExclusivePrivateDirectory(parent, preferredName) {
  const verifiedParent = fs.realpathSync(parent);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const name = attempt === 0 ? preferredName : `${preferredName}-${crypto.randomUUID()}`;
    const target = path.join(verifiedParent, name);
    try {
      fs.mkdirSync(target, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (error?.code === "EEXIST") {
        continue;
      }
      throw error;
    }
    const resolved = fs.realpathSync(target);
    if (!isPathWithin(resolved, verifiedParent)) {
      fail("exclusive backup destination escaped the verified external root");
    }
    return { name, path: resolved };
  }
  return fail("could not allocate an exclusive backup destination");
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
    const stat = fs.statSync(resolved);
    return {
      path: resolved,
      identity: crypto
        .createHash("sha256")
        .update(JSON.stringify({ kind: "test", device: stat.dev, inode: stat.ino }))
        .digest("hex"),
    };
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
  const volumeUuid = /^\s*Volume UUID:\s*(\S+)\s*$/imu.exec(info)?.[1];
  if (!volumeUuid) {
    fail("external backup volume identity is unavailable");
  }
  return {
    path: resolved,
    identity: crypto
      .createHash("sha256")
      .update(JSON.stringify({ kind: "apfs", volumeUuid }))
      .digest("hex"),
  };
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
    backupRoot: verifiedExternalRoot.path,
  });
  return { result: "configured", configPath: target, backupRoot: verifiedExternalRoot.path };
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

function estimatePathBytes(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return 0;
  }
  if (stat.isFile()) {
    return stat.size;
  }
  if (!stat.isDirectory()) {
    return 0;
  }
  return fs
    .readdirSync(target)
    .reduce((total, entry) => total + estimatePathBytes(path.join(target, entry)), 0);
}

function assertAvailableBytes(directory, payloadBytes, label) {
  const stats = fs.statfsSync(directory);
  const availableBytes = stats.bavail * stats.bsize;
  const reserveBytes = Math.max(MINIMUM_FREE_SPACE_RESERVE_BYTES, payloadBytes * 0.1);
  if (availableBytes < payloadBytes + reserveBytes) {
    fail(`${label} does not have enough free space`);
  }
}

function isPathWithin(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function assertReadOnlyTree(root, label) {
  const visit = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      if (stat.mode & 0o222) {
        fail(`${label} contains a writable directory: ${path.relative(root, current) || "."}`);
      }
      for (const entry of fs.readdirSync(current)) {
        visit(path.join(current, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      fail(`${label} contains a special filesystem entry`);
    }
    if (stat.mode & 0o222) {
      fail(`${label} contains a writable file: ${path.relative(root, current)}`);
    }
  };
  visit(root);
}

function loadTar(runtimeHome, runtimeRoot) {
  const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
  const installedBin = path.join(fs.realpathSync(runtimeHome), "bin");
  if (!isPathWithin(modulePath, installedBin)) {
    return createRequire(import.meta.url)("tar");
  }

  const packagePath = path.join(runtimeRoot, "package.json");
  regularFile(packagePath, "active runtime package manifest");
  const runtimeRequire = createRequire(packagePath);
  let entrypoint;
  try {
    entrypoint = fs.realpathSync(runtimeRequire.resolve("tar"));
  } catch {
    return fail("active runtime tar dependency is unavailable");
  }
  if (!isPathWithin(entrypoint, runtimeRoot)) {
    fail("active runtime tar dependency escaped the immutable release");
  }
  return runtimeRequire("tar");
}

function resolveBootstrapRuntime({
  entrypoint,
  sourceSha,
  homedir,
  trustedRuntimeRoot,
  releasesRoot = process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ||
    path.join(homedir, ".openclaw-runtime-releases"),
}) {
  if (!SHA_PATTERN.test(sourceSha)) {
    fail("bootstrap runtime source SHA is invalid");
  }
  const configuredReleasesRoot = path.resolve(releasesRoot);
  regularDirectory(configuredReleasesRoot, "immutable releases root");
  const resolvedReleasesRoot = fs.realpathSync(configuredReleasesRoot);
  if (configuredReleasesRoot !== resolvedReleasesRoot) {
    fail("immutable releases root must not be a symlink");
  }
  const resolvedEntrypoint = fs.realpathSync(path.resolve(entrypoint));
  const releaseRoot = path.dirname(path.dirname(resolvedEntrypoint));
  if (!isPathWithin(releaseRoot, resolvedReleasesRoot)) {
    fail("bootstrap runtime is outside the immutable releases root");
  }
  regularDirectory(releaseRoot, "bootstrap runtime release root");
  if (resolvedEntrypoint !== path.join(releaseRoot, "dist", "index.js")) {
    fail("bootstrap runtime entrypoint is outside its immutable release");
  }
  regularFile(resolvedEntrypoint, "bootstrap runtime entrypoint");
  const sourceStamp = path.join(releaseRoot, ".openclaw-production-sha");
  regularFile(sourceStamp, "bootstrap runtime source stamp");
  if (fs.readFileSync(sourceStamp, "utf8").trim() !== sourceSha) {
    fail("bootstrap runtime source stamp does not match the requested SHA");
  }
  const sealMarker = path.join(releaseRoot, ".openclaw-runtime-sealed");
  regularFile(sealMarker, "bootstrap runtime seal marker");
  const markerSha = fs.readFileSync(sealMarker, "utf8").trim().split(/\s+/u)[0];
  if (markerSha !== sourceSha) {
    fail("bootstrap runtime seal marker does not match the requested SHA");
  }
  assertReadOnlyTree(releaseRoot, "bootstrap runtime");
  const resolvedTrustedRuntimeRoot = path.resolve(trustedRuntimeRoot);
  regularDirectory(resolvedTrustedRuntimeRoot, "active runtime root");
  if (resolvedTrustedRuntimeRoot === releaseRoot) {
    fail("bootstrap integrity verifier must be separate from the candidate release");
  }
  const trustedVerifier = path.join(
    resolvedTrustedRuntimeRoot,
    "scripts",
    "custom-runtime",
    "runtime-package-integrity.mjs",
  );
  regularFile(trustedVerifier, "active runtime integrity verifier");
  if (!isPathWithin(fs.realpathSync(trustedVerifier), resolvedTrustedRuntimeRoot)) {
    fail("active runtime integrity verifier escaped the immutable release");
  }
  try {
    execFileSync(
      process.execPath,
      [trustedVerifier, "verify", "--release", releaseRoot, "--expected-root", releaseRoot],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homedir,
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch {
    fail("bootstrap runtime integrity verification failed");
  }
  return { entrypoint: resolvedEntrypoint, releaseRoot, sourceSha };
}

function estimateExternalCanonicalSqliteBytes(assets, sourcePaths) {
  const stateAsset = assets.find(
    (asset) => isRecord(asset) && asset.kind === "state" && typeof asset.sourcePath === "string",
  );
  if (!stateAsset) {
    return 0;
  }
  const canonicalPath = path.join(stateAsset.sourcePath, "state", "openclaw.sqlite");
  let canonicalStat;
  try {
    canonicalStat = fs.lstatSync(canonicalPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (!canonicalStat.isSymbolicLink()) {
    return 0;
  }
  const targetPath = fs.realpathSync(canonicalPath);
  return ["", "-wal", "-shm", "-journal"].reduce((total, suffix) => {
    const sourcePath = `${targetPath}${suffix}`;
    const alreadyCounted = sourcePaths.some((root) => isPathWithin(sourcePath, root));
    return total + (alreadyCounted ? 0 : estimatePathBytes(sourcePath));
  }, 0);
}

function validateArchiveEntries(entries) {
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry.replaceAll("\\\\", "/"));
    if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
      fail(`restore rehearsal archive contains an unsafe path: ${entry}`);
    }
  }
}

function rehearseRestore(archivePath, tar) {
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

function gatewayEnvironmentFile(gatewayPlist, gatewayEnvWrapper, gatewayLauncher) {
  let resolved;
  try {
    resolved = execFileSync(
      "python3",
      [
        "-c",
        "import os, plistlib, sys\nwith open(sys.argv[1], 'rb') as f: value = plistlib.load(f)\nargs = value.get('ProgramArguments')\nif not isinstance(args, list) or len(args) < 3 or args[0] != sys.argv[2] or not isinstance(args[1], str) or not args[1] or not isinstance(args[2], str) or os.path.realpath(args[2]) != os.path.realpath(sys.argv[3]): raise SystemExit(1)\nprint(args[1])",
        gatewayPlist,
        gatewayEnvWrapper,
        gatewayLauncher,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    fail("managed Gateway LaunchAgent environment contract is invalid");
  }
  const environmentFile = path.resolve(resolved);
  regularFile(environmentFile, "managed Gateway environment file");
  return environmentFile;
}

function controlPlaneEvidence(
  pointerPath,
  pointer,
  runtimeHome,
  gatewayPlist,
  gatewayEnvWrapper,
  gatewayEnvFile,
) {
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
    path.join(runtimeHome, "bin", "custom-runtime-launcher.sh"),
    gatewayPlist,
    gatewayEnvWrapper,
    gatewayEnvFile,
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

function resolveRequiredControlPlaneEvidence(
  pointerPath,
  pointer,
  runtimeHome,
  gatewayPlist,
  gatewayEnvWrapper,
  gatewayEnvFile,
) {
  const required = controlPlaneEvidence(
    pointerPath,
    pointer,
    runtimeHome,
    gatewayPlist,
    gatewayEnvWrapper,
    gatewayEnvFile,
  );
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
    path.join(runtimeHome, "bin", "custom-runtime-launcher.sh"),
    gatewayPlist,
    gatewayEnvWrapper,
    gatewayEnvFile,
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
  return required;
}

function createControlPlaneBundle({ required, pointer, externalDirectory, tar }) {
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
    const rehearsal = rehearseRestore(bundlePath, tar);
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
  releasesRoot = process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ||
    path.join(homedir, ".openclaw-runtime-releases"),
  configFile = process.env.OPENCLAW_CONFIG_PATH ||
    path.join(homedir, ".openclaw", "openclaw.director.json"),
  stateDir = process.env.OPENCLAW_STATE_DIR || path.join(homedir, ".openclaw-director-state"),
  gatewayPlist = process.env.OPENCLAW_GATEWAY_PLIST ||
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
  gatewayEnvWrapper = process.env.OPENCLAW_GATEWAY_ENV_WRAPPER ||
    path.join(stateDir, "service-env", "ai.openclaw.gateway-env-wrapper.sh"),
  bootstrapEntrypoint,
  bootstrapSourceSha,
  allowTestDirectory = false,
}) {
  const pointerPath = path.join(runtimeHome, "active-runtime.json");
  const pointer = readJson(pointerPath, "active runtime pointer");
  const sourceSha = String(pointer.sourceSha ?? "");
  if (!SHA_PATTERN.test(sourceSha)) {
    fail("active runtime source SHA is invalid");
  }
  const runtimeRoot = path.resolve(String(pointer.runtimeRoot ?? ""));
  regularDirectory(runtimeRoot, "active runtime root");
  const entrypoint = path.resolve(String(pointer.entrypoint ?? ""));
  if (entrypoint !== path.join(runtimeRoot, "dist", "index.js")) {
    fail("active runtime entrypoint is outside the immutable release");
  }
  regularFile(entrypoint, "active runtime entrypoint");
  const hasBootstrapEntrypoint = bootstrapEntrypoint !== undefined;
  if (hasBootstrapEntrypoint !== (bootstrapSourceSha !== undefined)) {
    fail("bootstrap runtime entrypoint and source SHA must be provided together");
  }
  const bootstrapRuntime = hasBootstrapEntrypoint
    ? resolveBootstrapRuntime({
        entrypoint: bootstrapEntrypoint,
        sourceSha: bootstrapSourceSha,
        homedir,
        trustedRuntimeRoot: runtimeRoot,
        releasesRoot,
      })
    : null;
  const backupEntrypoint = bootstrapRuntime?.entrypoint ?? entrypoint;
  const backupRuntimeRoot = bootstrapRuntime?.releaseRoot ?? runtimeRoot;
  const tar = loadTar(runtimeHome, backupRuntimeRoot);
  const resolvedConfigFile = path.resolve(configFile);
  const resolvedStateDir = path.resolve(stateDir);
  const resolvedGatewayPlist = path.resolve(gatewayPlist);
  const resolvedGatewayEnvWrapper = path.resolve(gatewayEnvWrapper);
  const resolvedGatewayLauncher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  regularFile(resolvedConfigFile, "managed Gateway configuration");
  regularDirectory(resolvedStateDir, "managed Gateway state directory");
  regularFile(resolvedGatewayPlist, "managed Gateway LaunchAgent");
  regularFile(resolvedGatewayEnvWrapper, "managed Gateway environment wrapper");
  regularFile(resolvedGatewayLauncher, "active custom runtime launcher");
  const resolvedGatewayEnvFile = gatewayEnvironmentFile(
    resolvedGatewayPlist,
    resolvedGatewayEnvWrapper,
    resolvedGatewayLauncher,
  );
  const backupEnvironment = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: resolvedConfigFile,
    OPENCLAW_STATE_DIR: resolvedStateDir,
    OPENCLAW_GATEWAY_PLIST: resolvedGatewayPlist,
    OPENCLAW_GATEWAY_ENV_WRAPPER: resolvedGatewayEnvWrapper,
  };
  const verifiedExternalRoot = verifyExternalRoot(
    configuredExternalRoot(runtimeHome, externalRoot),
    allowTestDirectory,
  );
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const externalBackupRoot = ensurePrivateDirectoryPath(verifiedExternalRoot.path, [
    "OpenClaw",
    "verified-updates",
  ]);
  const exclusiveDirectory = createExclusivePrivateDirectory(externalBackupRoot, stamp);
  const backupId = exclusiveDirectory.name;
  const externalDirectory = exclusiveDirectory.path;
  const dryRun = parseBackupOutput(
    execFileSync(process.execPath, [backupEntrypoint, "backup", "create", "--dry-run", "--json"], {
      encoding: "utf8",
      env: backupEnvironment,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const dryRunAssets = Array.isArray(dryRun.assets) ? dryRun.assets : [];
  const sourcePaths = dryRunAssets.flatMap((asset) =>
    isRecord(asset) && typeof asset.sourcePath === "string" ? [asset.sourcePath] : [],
  );
  if (sourcePaths.length === 0) {
    fail("OpenClaw backup dry run did not report source paths");
  }
  const controlPlaneFiles = resolveRequiredControlPlaneEvidence(
    pointerPath,
    pointer,
    runtimeHome,
    resolvedGatewayPlist,
    resolvedGatewayEnvWrapper,
    resolvedGatewayEnvFile,
  );
  const estimatedInputBytes = sourcePaths.reduce(
    (total, sourcePath) => total + estimatePathBytes(sourcePath),
    0,
  );
  const externalCanonicalSqliteBytes = estimateExternalCanonicalSqliteBytes(
    dryRunAssets,
    sourcePaths,
  );
  const controlPlaneBytes = controlPlaneFiles.reduce(
    (total, entry) => total + fs.statSync(entry.sourcePath).size,
    0,
  );
  assertAvailableBytes(
    externalDirectory,
    estimatedInputBytes + externalCanonicalSqliteBytes + controlPlaneBytes,
    "external backup volume",
  );
  const stdout = execFileSync(
    process.execPath,
    [backupEntrypoint, "backup", "create", "--output", externalDirectory, "--verify", "--json"],
    {
      encoding: "utf8",
      env: backupEnvironment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const backup = parseBackupOutput(stdout);
  const externalArchivePath = fs.realpathSync(path.resolve(String(backup.archivePath ?? "")));
  regularFile(externalArchivePath, "verified external OpenClaw backup archive");
  if (!externalArchivePath.startsWith(`${fs.realpathSync(externalDirectory)}${path.sep}`)) {
    fail("OpenClaw backup archive was written outside the verified external destination");
  }
  if (backup.verified !== true) {
    fail("OpenClaw backup did not report successful verification");
  }
  syncFile(externalArchivePath);
  const archiveSha256 = sha256File(externalArchivePath);
  const restoreDrill = rehearseRestore(externalArchivePath, tar);
  const localRoot = path.join(runtimeHome, "data-backups");
  fs.mkdirSync(localRoot, { recursive: true, mode: 0o700 });
  const archiveBytes = fs.statSync(externalArchivePath).size;
  assertAvailableBytes(localRoot, archiveBytes, "local backup volume");
  const localArchivePath = path.join(
    localRoot,
    `${backupId}-${path.basename(externalArchivePath)}`,
  );
  fs.copyFileSync(externalArchivePath, localArchivePath, fs.constants.COPYFILE_EXCL);
  syncFile(localArchivePath);
  if (sha256File(localArchivePath) !== archiveSha256) {
    fail("local backup copy hash does not match the verified external archive");
  }
  const controlPlane = createControlPlaneBundle({
    required: controlPlaneFiles,
    pointer,
    externalDirectory,
    tar,
  });
  const receiptPath = path.join(runtimeHome, "receipts", `update-backup-${backupId}.json`);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    createdAt: new Date().toISOString(),
    sourceSha,
    result: "passed",
    backupVerified: true,
    restoreDrill,
    externalRoot: verifiedExternalRoot,
    localArchive: { path: localArchivePath, sha256: archiveSha256 },
    externalArchive: { path: externalArchivePath, sha256: archiveSha256 },
    controlPlane,
    ...(bootstrapRuntime ? { backupRuntime: bootstrapRuntime } : {}),
  };
  writeAtomic(receiptPath, receipt);
  return { ...receipt, receiptPath, receiptSha256: sha256File(receiptPath) };
}

function verifyReceipt({
  receiptPath,
  expectedSha,
  runtimeHome,
  homedir = os.homedir(),
  releasesRoot = process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ||
    path.join(homedir, ".openclaw-runtime-releases"),
  externalRoot = process.env.OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT || "",
  allowTestDirectory = false,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}) {
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
  if (receipt.backupRuntime !== undefined) {
    const activePointer = readJson(
      path.join(runtimeHome, "active-runtime.json"),
      "active runtime pointer",
    );
    const trustedRuntimeRoot = path.resolve(String(activePointer.runtimeRoot ?? ""));
    regularDirectory(trustedRuntimeRoot, "active runtime root");
    if (!isRecord(receipt.backupRuntime)) {
      fail("backup runtime binding is invalid");
    }
    const verifiedBootstrapRuntime = resolveBootstrapRuntime({
      entrypoint: String(receipt.backupRuntime.entrypoint ?? ""),
      sourceSha: String(receipt.backupRuntime.sourceSha ?? ""),
      homedir,
      trustedRuntimeRoot,
      releasesRoot,
    });
    if (
      receipt.backupRuntime.entrypoint !== verifiedBootstrapRuntime.entrypoint ||
      receipt.backupRuntime.releaseRoot !== verifiedBootstrapRuntime.releaseRoot ||
      receipt.backupRuntime.sourceSha !== verifiedBootstrapRuntime.sourceSha
    ) {
      fail("backup runtime binding changed after verification");
    }
  }
  const createdAt = Date.parse(String(receipt.createdAt ?? ""));
  if (
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt > maxAgeMs ||
    createdAt > Date.now() + 60_000
  ) {
    fail("backup receipt is stale or has an invalid timestamp");
  }
  const verifiedExternalRoot = verifyExternalRoot(
    configuredExternalRoot(runtimeHome, externalRoot),
    allowTestDirectory,
  );
  if (
    !isRecord(receipt.externalRoot) ||
    receipt.externalRoot.path !== verifiedExternalRoot.path ||
    receipt.externalRoot.identity !== verifiedExternalRoot.identity
  ) {
    fail("external backup volume identity changed after preparation");
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
    if (
      (key === "externalArchive" || key === "controlPlane") &&
      !isPathWithin(fs.realpathSync(filePath), verifiedExternalRoot.path)
    ) {
      fail(`${key} is outside the verified external backup volume`);
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
              configFile: values.get("config-path") || process.env.OPENCLAW_CONFIG_PATH,
              stateDir: values.get("state-dir") || process.env.OPENCLAW_STATE_DIR,
              gatewayPlist: values.get("gateway-plist") || process.env.OPENCLAW_GATEWAY_PLIST,
              gatewayEnvWrapper:
                values.get("gateway-env-wrapper") || process.env.OPENCLAW_GATEWAY_ENV_WRAPPER,
              releasesRoot:
                values.get("releases-root") ||
                process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ||
                path.join(os.homedir(), ".openclaw-runtime-releases"),
              bootstrapEntrypoint: values.get("bootstrap-entrypoint"),
              bootstrapSourceSha: values.get("bootstrap-sha"),
            })
          : command === "verify"
            ? verifyReceipt({
                receiptPath: path.resolve(values.get("receipt") || ""),
                expectedSha: values.get("expected-sha") || "",
                runtimeHome,
                externalRoot:
                  values.get("external-root") ||
                  process.env.OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT ||
                  "",
                homedir: os.homedir(),
                releasesRoot:
                  values.get("releases-root") ||
                  process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ||
                  path.join(os.homedir(), ".openclaw-runtime-releases"),
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

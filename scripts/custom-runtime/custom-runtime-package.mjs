#!/usr/bin/env node
// Builds one self-contained immutable managed-runtime release from an exact source SHA.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";
import { registerSealedCandidate } from "./candidate-registry.mjs";
import { resolveCustomRuntimeBuildPluginIds } from "./custom-runtime-build-profile.mjs";
import {
  assertRuntimePluginClosure,
  collectBundledRuntimePluginIds,
  collectConfiguredRuntimePluginIds,
  collectExternalRuntimePluginIds,
} from "./custom-runtime-plugin-closure.mjs";
import {
  importSourceProvenance,
  verifySourceProvenance,
  verifyProvenanceMigration,
} from "./custom-runtime-source-provenance.mjs";
import {
  hashBuildArtifactTree,
  hashRuntimeClosure,
  listRuntimeClosurePaths,
  verifyRuntimePackage,
} from "./runtime-package-integrity.mjs";
import { loadStorageReservation } from "./storage-admission.mjs";

const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected an object in ${filePath}`);
  }
  return parsed;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message || result.stderr || result.stdout || `status ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail.trim()}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function runBuffer(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ||
      result.stderr?.toString("utf8") ||
      result.stdout?.toString("utf8") ||
      `status ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail.trim()}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readRuntimeConfig(runtimeConfigPath) {
  let stat;
  try {
    stat = fs.lstatSync(runtimeConfigPath);
  } catch {
    throw new Error(`Runtime config is unavailable: ${runtimeConfigPath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Runtime config is not a regular file: ${runtimeConfigPath}`);
  }
  try {
    const parsed = JSON5.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new Error(`Runtime config is invalid: ${runtimeConfigPath}`);
  }
}

/**
 * Fail before dependency deployment when the build snapshot cannot satisfy the
 * effective runtime plugin configuration. Legacy capability fixtures remain
 * package-compatible; every v2 release must provide this proof.
 */
export function assertBuildSnapshotPluginClosure({ sourceRoot, buildRoot, runtimeConfigPath }) {
  const capabilityManifestPath = path.join(
    sourceRoot,
    "config",
    "custom-runtime-capabilities.json",
  );
  const capabilityManifest = readJson(capabilityManifestPath);
  if (capabilityManifest.schema !== "openclaw.custom-runtime-capabilities.v2") {
    return { checked: false };
  }
  if (typeof runtimeConfigPath !== "string" || runtimeConfigPath.trim() === "") {
    throw new Error("Runtime config is required for v2 plugin-closure verification.");
  }
  const runtimeConfig = readRuntimeConfig(runtimeConfigPath);
  const configuredPluginIds = collectConfiguredRuntimePluginIds(runtimeConfig);
  const externalPluginIds = collectExternalRuntimePluginIds(runtimeConfig);
  const buildProfile = resolveCustomRuntimeBuildPluginIds({
    repoRoot: sourceRoot,
    manifestPath: capabilityManifestPath,
  });
  const actualBundledPluginIds = collectBundledRuntimePluginIds(buildRoot);
  const expectedBundledPluginIds = buildProfile.bundledRuntimePluginIds;
  const missingBundledPluginIds = expectedBundledPluginIds.filter(
    (pluginId) => !actualBundledPluginIds.includes(pluginId),
  );
  if (missingBundledPluginIds.length > 0) {
    throw new Error(
      `Gateway build snapshot omitted required bundled plugin(s): ${missingBundledPluginIds.join(", ")}`,
    );
  }
  const unexpectedBundledPluginIds = actualBundledPluginIds.filter(
    (pluginId) => !expectedBundledPluginIds.includes(pluginId),
  );
  if (unexpectedBundledPluginIds.length > 0) {
    throw new Error(
      `Gateway build snapshot contains unexpected bundled plugin(s): ${unexpectedBundledPluginIds.join(", ")}`,
    );
  }
  const closure = assertRuntimePluginClosure({
    configuredPluginIds: [...configuredPluginIds, ...externalPluginIds],
    bundledPluginIds: actualBundledPluginIds,
    externalPluginIds: [...buildProfile.externalPluginIds, ...externalPluginIds],
  });
  return {
    checked: true,
    configPath: fs.realpathSync(runtimeConfigPath),
    configSha256: sha256File(runtimeConfigPath),
    ...closure,
  };
}

export function assertCandidateLineage({
  sourceRoot,
  sourceSha,
  activeSha,
  provenanceMigrationPath,
}) {
  if (!SOURCE_SHA_PATTERN.test(sourceSha) || !SOURCE_SHA_PATTERN.test(activeSha)) {
    throw new Error("Candidate and active source identities must be exact lowercase Git SHAs.");
  }
  const head = run("git", ["rev-parse", "HEAD"], { cwd: sourceRoot });
  if (head !== sourceSha) {
    throw new Error(`Candidate worktree HEAD ${head} does not match ${sourceSha}.`);
  }
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: sourceRoot,
  });
  if (status) {
    throw new Error("Candidate worktree must be clean before runtime packaging.");
  }
  try {
    run("git", ["merge-base", "--is-ancestor", activeSha, sourceSha], { cwd: sourceRoot });
    return { mode: "ancestor" };
  } catch (error) {
    if (!provenanceMigrationPath) {
      throw error;
    }
    return { mode: "provenance_migration" };
  }
}

function assertPathInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside ${root}.`);
  }
}

function copyExact(sourceRoot, targetRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const target = path.join(targetRoot, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Required package source path is missing: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    errorOnExist: false,
    force: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

function removeCreatedTree(target) {
  if (!fs.existsSync(target)) {
    return;
  }
  const makeRemovable = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return;
    }
    fs.chmodSync(current, 0o700);
    for (const entry of fs.readdirSync(current)) {
      makeRemovable(path.join(current, entry));
    }
  };
  makeRemovable(target);
  fs.rmSync(target, { recursive: true, force: true });
}

function readJsonAtCommit(sourceRoot, sourceSha, relativePath) {
  const contents = run("git", ["show", `${sourceSha}:${relativePath}`], { cwd: sourceRoot });
  const parsed = JSON.parse(contents);
  if (!isRecord(parsed)) {
    throw new Error(`Expected an object at ${sourceSha}:${relativePath}`);
  }
  return parsed;
}

const SOURCE_CODE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const SOURCE_IMPORT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SOURCE_FROM_IMPORT_PATTERN = /\bfrom\s*["']([^"']+)["']/gu;
const SOURCE_IMPORT_PATTERNS = [
  SOURCE_FROM_IMPORT_PATTERN,
  /\bimport\s*(?:\(\s*)?["']([^"']+)["']/gu,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
];

function isTypeOnlySourceImport(source, fromIndex) {
  const prefix = source.slice(0, fromIndex);
  const importIndex = Math.max(prefix.lastIndexOf("import"), prefix.lastIndexOf("export"));
  if (importIndex < 0 || importIndex < prefix.lastIndexOf(";")) {
    return false;
  }
  return /^(?:import|export)\s+type(?:\s|\{|\*)/u.test(prefix.slice(importIndex));
}

function sourceImportSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of SOURCE_IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      // Type-only imports disappear after transpilation; generated declarations
      // must not be mistaken for runtime files required by the sealed package.
      if (
        specifier?.startsWith(".") &&
        !(
          pattern === SOURCE_FROM_IMPORT_PATTERN &&
          isTypeOnlySourceImport(source, match.index ?? -1)
        )
      ) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers].toSorted((left, right) => left.localeCompare(right));
}

function resolveSourceImport(importerPath, specifier, trackedPaths) {
  const normalized = path.posix.normalize(
    path.posix.join(path.posix.dirname(importerPath), specifier),
  );
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(
      `Custom runtime source import escapes the repository: ${importerPath} -> ${specifier}`,
    );
  }
  const extension = path.posix.extname(normalized);
  const stem = extension ? normalized.slice(0, -extension.length) : normalized;
  const candidates = [normalized];
  if (!extension || SOURCE_IMPORT_EXTENSIONS.includes(extension)) {
    for (const candidateExtension of SOURCE_IMPORT_EXTENSIONS) {
      const candidate = `${stem}${candidateExtension}`;
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  const initialCandidateCount = candidates.length;
  for (let index = 0; index < initialCandidateCount; index += 1) {
    const candidate = candidates[index];
    for (const candidateExtension of SOURCE_IMPORT_EXTENSIONS) {
      const indexCandidate = `${candidate}/index${candidateExtension}`;
      if (!candidates.includes(indexCandidate)) {
        candidates.push(indexCandidate);
      }
    }
  }
  const resolved = candidates.find((candidate) => trackedPaths.has(candidate));
  if (!resolved) {
    throw new Error(`Custom runtime source import is missing: ${importerPath} -> ${specifier}`);
  }
  return resolved;
}

function findUnregisteredCustomRuntimeScriptImports({ sourceRoot, sourceSha, registeredPaths }) {
  const trackedOutput = run("git", ["ls-tree", "-r", "--name-only", sourceSha, "--"], {
    cwd: sourceRoot,
  });
  const trackedPaths = new Set(trackedOutput.split(/\r?\n/u).filter(Boolean));
  const queue = [...trackedPaths]
    .filter(
      (relativePath) =>
        relativePath.startsWith("scripts/custom-runtime/") &&
        SOURCE_CODE_EXTENSIONS.has(path.posix.extname(relativePath)),
    )
    .toSorted((left, right) => left.localeCompare(right));
  const visited = new Set();
  const unregistered = [];
  while (queue.length > 0) {
    const importerPath = queue.shift();
    if (!importerPath || visited.has(importerPath)) {
      continue;
    }
    visited.add(importerPath);
    const source = run("git", ["show", `${sourceSha}:${importerPath}`], { cwd: sourceRoot });
    for (const specifier of sourceImportSpecifiers(source)) {
      const resolvedPath = resolveSourceImport(importerPath, specifier, trackedPaths);
      if (!registeredPaths.has(resolvedPath)) {
        unregistered.push({ importerPath, specifier, resolvedPath });
      }
      if (SOURCE_CODE_EXTENSIONS.has(path.posix.extname(resolvedPath))) {
        queue.push(resolvedPath);
      }
    }
  }
  return unregistered;
}

function requiredCapabilityPaths(sourceRoot, sourceSha) {
  const manifest = readJsonAtCommit(
    sourceRoot,
    sourceSha,
    "config/custom-runtime-capabilities.json",
  );
  const paths = new Set([
    "config/custom-runtime-capabilities.json",
    "config/release-governor-policy.json",
    "pnpm-lock.yaml",
    "scripts/custom-runtime",
  ]);
  if (
    !isRecord(manifest.preservation) ||
    typeof manifest.preservation.standardsRegistry !== "string"
  ) {
    throw new Error("Candidate capability manifest has no standards registry.");
  }
  paths.add(manifest.preservation.standardsRegistry);
  if (!Array.isArray(manifest.capabilities)) {
    throw new Error("Candidate capability manifest has no capabilities.");
  }
  const registeredPaths = new Set();
  for (const capability of manifest.capabilities) {
    if (!isRecord(capability) || !Array.isArray(capability.requiredPaths)) {
      throw new Error("Candidate capability manifest contains an invalid capability.");
    }
    for (const requiredPath of capability.requiredPaths) {
      if (typeof requiredPath !== "string" || !requiredPath) {
        throw new Error("Candidate capability manifest contains an invalid required path.");
      }
      registeredPaths.add(requiredPath);
      paths.add(requiredPath);
    }
  }
  const unregisteredImports = findUnregisteredCustomRuntimeScriptImports({
    sourceRoot,
    sourceSha,
    registeredPaths,
  });
  if (unregisteredImports.length > 0) {
    const details = unregisteredImports
      .map(
        ({ importerPath, specifier, resolvedPath }) =>
          `${importerPath} -> ${specifier} (${resolvedPath})`,
      )
      .join("; ");
    throw new Error(`Custom runtime script source import has no capability owner: ${details}`);
  }
  return [...paths].toSorted((left, right) => left.localeCompare(right));
}

function copyGitPaths({ sourceRoot, sourceSha, targetRoot, relativePaths }) {
  const tree = runBuffer(
    "git",
    ["ls-tree", "-r", "-z", "--full-tree", sourceSha, "--", ...relativePaths],
    { cwd: sourceRoot },
  );
  const entries = new Map();
  for (const record of tree.toString("utf8").split("\0")) {
    if (!record) {
      continue;
    }
    const separator = record.indexOf("\t");
    if (separator < 0) {
      throw new Error(`Malformed Git tree entry: ${record}`);
    }
    const [mode, type, objectId] = record.slice(0, separator).split(" ");
    const relativePath = record.slice(separator + 1);
    if (type !== "blob" || !["100644", "100755", "120000"].includes(mode)) {
      throw new Error(`Unsupported candidate Git tree entry: ${relativePath}`);
    }
    entries.set(relativePath, { mode, objectId });
  }
  for (const relativePath of relativePaths) {
    const found = [...entries.keys()].some(
      (entry) => entry === relativePath || entry.startsWith(`${relativePath}/`),
    );
    if (!found) {
      throw new Error(`Required package source path is missing from ${sourceSha}: ${relativePath}`);
    }
  }
  for (const [relativePath, entry] of [...entries.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const target = path.join(targetRoot, relativePath);
    assertPathInside(targetRoot, target, "Candidate package path");
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.rmSync(target, { recursive: true, force: true });
    const blob = runBuffer("git", ["cat-file", "blob", entry.objectId], { cwd: sourceRoot });
    if (entry.mode === "120000") {
      fs.symlinkSync(blob.toString("utf8"), target);
    } else {
      fs.writeFileSync(target, blob, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
    }
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function resolveDefaultDeployInvocation({ stagingRoot, env = process.env }) {
  const offline = env.OPENCLAW_BUILD_OFFLINE === "1";
  return {
    command: "pnpm",
    args: [
      ...(offline ? ["--config.offline=true"] : []),
      "--config.inject-workspace-packages=true",
      "--filter",
      "openclaw",
      "deploy",
      "--prod",
      stagingRoot,
    ],
    env: offline ? { ...env, npm_config_offline: "true" } : env,
  };
}

function defaultDeploy({ sourceRoot, stagingRoot }) {
  const invocation = resolveDefaultDeployInvocation({ stagingRoot });
  run(invocation.command, invocation.args, {
    cwd: sourceRoot,
    env: invocation.env,
    inherit: true,
  });
}

function provenanceRuntimeHomeForRecord(record, sourceSha) {
  const recordDirectory = path.dirname(path.resolve(record.recordPath));
  const provenanceRoot = path.dirname(recordDirectory);
  if (
    path.basename(recordDirectory) !== sourceSha ||
    path.basename(provenanceRoot) !== "source-provenance"
  ) {
    throw new Error(
      "Durable source provenance record must be stored under a runtime source-provenance root.",
    );
  }
  return path.dirname(provenanceRoot);
}

export function assembleManagedRuntimePackage({
  sourceRoot,
  releasesDir,
  sourceSha,
  activeSha,
  releaseId,
  runtimeConfigPath,
  deploy = defaultDeploy,
  seal = true,
  provenanceRuntimeHome,
  provenanceMigrationPath,
  provenanceRecordPath,
  candidateRegistryPath,
  storageReservation,
  trustedProvenanceHelperPath,
  sourceRemote,
  sourceRemoteBranch,
}) {
  const candidateSourceRoot = fs.realpathSync(sourceRoot);
  let managedReleasesDir = path.resolve(releasesDir);
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error(`Invalid managed-runtime release ID: ${releaseId}`);
  }
  let sourceProvenance;
  let provenanceSealRuntimeHome;
  if (provenanceRecordPath && provenanceRuntimeHome) {
    throw new Error("Use either an existing provenance record or a provenance runtime home.");
  }
  if (!provenanceRecordPath && !provenanceRuntimeHome) {
    throw new Error("Durable source provenance is required for every managed runtime package.");
  }
  if (provenanceRecordPath) {
    sourceProvenance = verifySourceProvenance({
      recordPath: provenanceRecordPath,
      expectedSha: sourceSha,
      deep: true,
    });
    provenanceSealRuntimeHome = provenanceRuntimeHomeForRecord(sourceProvenance, sourceSha);
  } else if (provenanceRuntimeHome) {
    provenanceSealRuntimeHome = path.resolve(provenanceRuntimeHome);
    sourceProvenance = importSourceProvenance({
      sourceRoot: candidateSourceRoot,
      sourceSha,
      runtimeHome: provenanceRuntimeHome,
      historicalSourceSha: provenanceMigrationPath ? activeSha : undefined,
      storageReservation,
      sourceRemote,
      sourceRemoteBranch,
    });
  }
  const lineage = assertCandidateLineage({
    sourceRoot: candidateSourceRoot,
    sourceSha,
    activeSha,
    provenanceMigrationPath,
  });
  if (lineage.mode === "provenance_migration") {
    if (!provenanceMigrationPath || !sourceProvenance) {
      throw new Error("Provenance migration requires a durable source provenance record.");
    }
    verifyProvenanceMigration({
      migrationPath: provenanceMigrationPath,
      expectedHistoricalSha: activeSha,
      expectedCandidateSha: sourceSha,
    });
  }
  let trustedProvenanceHelper;
  if (seal) {
    const helperPath =
      trustedProvenanceHelperPath ??
      process.env.OPENCLAW_TRUSTED_SOURCE_PROVENANCE_HELPER ??
      path.join(provenanceSealRuntimeHome, "bin", "custom-runtime-source-provenance.mjs");
    const helperStat = fs.lstatSync(helperPath, { throwIfNoEntry: false });
    if (!helperStat?.isFile() || helperStat.isSymbolicLink()) {
      throw new Error("Sealed packaging requires an existing trusted source provenance verifier.");
    }
    trustedProvenanceHelper = fs.realpathSync(helperPath);
  }
  fs.mkdirSync(managedReleasesDir, { recursive: true, mode: 0o700 });
  const releasesStat = fs.lstatSync(managedReleasesDir);
  if (!releasesStat.isDirectory() || releasesStat.isSymbolicLink()) {
    throw new Error("Managed-runtime releases root must be a regular directory.");
  }
  managedReleasesDir = fs.realpathSync(managedReleasesDir);
  const releaseRoot = path.join(managedReleasesDir, releaseId);
  const stagingRoot = path.join(managedReleasesDir, `.assembling-${releaseId}-${process.pid}`);
  if (fs.existsSync(releaseRoot) || fs.existsSync(stagingRoot)) {
    throw new Error(`Managed-runtime release already exists: ${releaseId}`);
  }

  const latestPath = path.join(
    candidateSourceRoot,
    ".artifacts",
    "openclaw-gateway-runtime",
    "latest.json",
  );
  const latest = readJson(latestPath);
  if (typeof latest.root !== "string") {
    throw new Error("Gateway build snapshot has no immutable root.");
  }
  const buildRoot = fs.realpathSync(latest.root);
  assertPathInside(candidateSourceRoot, buildRoot, "Gateway build snapshot");
  const sourceSnapshot = readJson(path.join(buildRoot, "snapshot.json"));
  if (!isRecord(sourceSnapshot.source) || sourceSnapshot.source.commit !== sourceSha) {
    throw new Error("Gateway build snapshot is not bound to the candidate SHA.");
  }
  const sourceArtifactHash = hashBuildArtifactTree(buildRoot);
  if (sourceSnapshot.artifactHash !== sourceArtifactHash) {
    throw new Error("Gateway build snapshot artifact hash does not match its bytes.");
  }
  const pluginClosure = assertBuildSnapshotPluginClosure({
    sourceRoot: candidateSourceRoot,
    buildRoot,
    runtimeConfigPath,
  });
  const capabilityPaths = requiredCapabilityPaths(candidateSourceRoot, sourceSha);

  let releaseCreated = false;
  try {
    deploy({ sourceRoot: candidateSourceRoot, stagingRoot });
    const deployedStat = fs.lstatSync(stagingRoot);
    if (!deployedStat.isDirectory() || deployedStat.isSymbolicLink()) {
      throw new Error("Production dependency deployment did not create a regular directory.");
    }
    copyExact(buildRoot, stagingRoot, "dist");
    copyExact(buildRoot, stagingRoot, "dist-runtime");
    copyExact(buildRoot, stagingRoot, "package.json");
    assertCandidateLineage({
      sourceRoot: candidateSourceRoot,
      sourceSha,
      activeSha,
      provenanceMigrationPath,
    });
    copyGitPaths({
      sourceRoot: candidateSourceRoot,
      sourceSha,
      targetRoot: stagingRoot,
      relativePaths: capabilityPaths,
    });
    fs.writeFileSync(path.join(stagingRoot, ".openclaw-production-sha"), `${sourceSha}\n`, {
      mode: 0o600,
    });
    if (sourceProvenance) {
      const portableDirectory = path.join(stagingRoot, ".openclaw-provenance");
      fs.mkdirSync(portableDirectory, { mode: 0o700 });
      const portableBundle = path.join(portableDirectory, "source.bundle");
      fs.copyFileSync(sourceProvenance.bundlePath, portableBundle);
      fs.chmodSync(portableBundle, 0o600);
      let portableMigration;
      if (provenanceMigrationPath) {
        portableMigration = path.join(portableDirectory, "migration.json");
        fs.copyFileSync(provenanceMigrationPath, portableMigration);
        fs.chmodSync(portableMigration, 0o600);
      }
      writeJson(path.join(stagingRoot, ".openclaw-runtime-provenance.json"), {
        schema: "openclaw.custom-runtime-runtime-provenance.v2",
        sourceSha: sourceProvenance.sourceSha,
        treeSha: sourceProvenance.treeSha,
        objectFormat: sourceProvenance.objectFormat,
        bundlePath: path.join(releaseRoot, ".openclaw-provenance", "source.bundle"),
        bundleSha256: sha256File(portableBundle),
        ...(sourceProvenance.sourceRemote ? { sourceRemote: sourceProvenance.sourceRemote } : {}),
        ...(sourceProvenance.sourceRemoteBranch
          ? { sourceRemoteBranch: sourceProvenance.sourceRemoteBranch }
          : {}),
        ...(sourceProvenance.historicalSourceSha
          ? { historicalSourceSha: sourceProvenance.historicalSourceSha }
          : {}),
        ...(portableMigration
          ? {
              migrationPath: path.join(releaseRoot, ".openclaw-provenance", "migration.json"),
              migrationSha256: sha256File(portableMigration),
            }
          : {}),
      });
    }
    const artifactHash = hashBuildArtifactTree(stagingRoot);
    if (artifactHash !== sourceArtifactHash) {
      throw new Error("Packaged build artifact differs from the verified build snapshot.");
    }
    const runtimeClosurePaths = listRuntimeClosurePaths(stagingRoot);
    const runtimeClosureHash = hashRuntimeClosure(stagingRoot, runtimeClosurePaths);
    const snapshot = {
      ...sourceSnapshot,
      releaseId,
      root: releaseRoot,
      artifactHash,
      runtimeClosureVersion: 1,
      runtimeClosurePaths,
      runtimeClosureHash,
      source: {
        ...sourceSnapshot.source,
        root: candidateSourceRoot,
        commit: sourceSha,
        sourceSnapshotReleaseId: sourceSnapshot.releaseId,
        ...(sourceProvenance
          ? {
              provenancePath: path.join(releaseRoot, ".openclaw-runtime-provenance.json"),
              provenanceSha256: sha256File(
                path.join(stagingRoot, ".openclaw-runtime-provenance.json"),
              ),
            }
          : {}),
      },
      paths: {
        entrypoint: path.join(releaseRoot, "dist", "index.js"),
        controlUi: path.join(releaseRoot, "dist", "control-ui"),
        bundledPlugins: path.join(releaseRoot, "dist-runtime", "extensions"),
      },
      ...(pluginClosure.checked ? { runtimePluginClosure: pluginClosure } : {}),
    };
    writeJson(path.join(stagingRoot, "snapshot.json"), snapshot);
    const errors = verifyRuntimePackage({ releaseRoot: stagingRoot, expectedRoot: releaseRoot });
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
    fs.renameSync(stagingRoot, releaseRoot);
    releaseCreated = true;
    if (seal) {
      run(
        "/bin/sh",
        [
          path.join(releaseRoot, "scripts", "custom-runtime", "custom-runtime-seal.sh"),
          "--seal",
          "--release",
          releaseRoot,
        ],
        {
          cwd: releaseRoot,
          env: {
            ...process.env,
            OPENCLAW_CUSTOM_RUNTIME_RELEASES: managedReleasesDir,
            OPENCLAW_CUSTOM_RUNTIME_HOME: provenanceSealRuntimeHome,
            OPENCLAW_TRUSTED_SOURCE_PROVENANCE_HELPER: trustedProvenanceHelper,
          },
          inherit: true,
        },
      );
      registerSealedCandidate({
        registryPath:
          candidateRegistryPath ?? path.join(managedReleasesDir, ".candidate-registry.json"),
        releaseRoot,
      });
    }
    return {
      releaseRoot,
      releaseId,
      artifactHash,
      runtimeClosureHash,
      runtimeClosurePaths,
      ...(seal
        ? {
            candidateRegistryPath:
              candidateRegistryPath ?? path.join(managedReleasesDir, ".candidate-registry.json"),
          }
        : {}),
    };
  } catch (error) {
    removeCreatedTree(stagingRoot);
    if (releaseCreated) {
      removeCreatedTree(releaseRoot);
    }
    throw error;
  }
}

function parseCli(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const values = parseCli(process.argv.slice(2));
    for (const required of ["source", "releases", "source-sha", "active-sha", "release-id"]) {
      if (!values.get(required)) {
        throw new Error(`--${required} is required`);
      }
    }
    const result = assembleManagedRuntimePackage({
      sourceRoot: values.get("source"),
      releasesDir: values.get("releases"),
      sourceSha: values.get("source-sha"),
      activeSha: values.get("active-sha"),
      releaseId: values.get("release-id"),
      ...(values.get("runtime-config") ? { runtimeConfigPath: values.get("runtime-config") } : {}),
      ...(values.get("storage-reservation-id") && values.get("storage-reservation-token")
        ? {
            storageReservation: loadStorageReservation({
              registryPath: values.get("storage-registry"),
              reservationId: values.get("storage-reservation-id"),
              token: values.get("storage-reservation-token"),
            }),
          }
        : {}),
      ...(values.get("provenance-runtime-home")
        ? { provenanceRuntimeHome: values.get("provenance-runtime-home") }
        : {}),
      ...(values.get("provenance-record")
        ? { provenanceRecordPath: values.get("provenance-record") }
        : {}),
      ...(values.get("provenance-migration")
        ? { provenanceMigrationPath: values.get("provenance-migration") }
        : {}),
      ...(values.get("candidate-registry")
        ? { candidateRegistryPath: values.get("candidate-registry") }
        : {}),
      ...(values.get("trusted-provenance-helper")
        ? { trustedProvenanceHelperPath: values.get("trusted-provenance-helper") }
        : {}),
      ...(values.get("source-remote") ? { sourceRemote: values.get("source-remote") } : {}),
      ...(values.get("source-remote-branch")
        ? { sourceRemoteBranch: values.get("source-remote-branch") }
        : {}),
    });
    process.stdout.write(`${JSON.stringify({ result: "packaged", ...result })}\n`);
  } catch (error) {
    process.stderr.write(
      `Custom runtime package blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

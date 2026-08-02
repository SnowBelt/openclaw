#!/usr/bin/env node
// Builds one self-contained immutable managed-runtime release from an exact source SHA.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  hashBuildArtifactTree,
  hashRuntimeClosure,
  listRuntimeClosurePaths,
  verifyRuntimePackage,
} from "./runtime-package-integrity.mjs";

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
    throw new Error(`${command} ${args.join(" ")} failed: ${String(detail).trim()}`);
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
    throw new Error(`${command} ${args.join(" ")} failed: ${String(detail).trim()}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

export function assertCandidateLineage({ sourceRoot, sourceSha, activeSha }) {
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
  run("git", ["merge-base", "--is-ancestor", activeSha, sourceSha], { cwd: sourceRoot });
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
  for (const capability of manifest.capabilities) {
    if (!isRecord(capability) || !Array.isArray(capability.requiredPaths)) {
      throw new Error("Candidate capability manifest contains an invalid capability.");
    }
    for (const requiredPath of capability.requiredPaths) {
      if (typeof requiredPath !== "string" || !requiredPath) {
        throw new Error("Candidate capability manifest contains an invalid required path.");
      }
      paths.add(requiredPath);
    }
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

function defaultDeploy({ sourceRoot, stagingRoot }) {
  run(
    "pnpm",
    [
      "--config.inject-workspace-packages=true",
      "--filter",
      "openclaw",
      "deploy",
      "--prod",
      stagingRoot,
    ],
    { cwd: sourceRoot, inherit: true },
  );
}

export function assembleManagedRuntimePackage({
  sourceRoot,
  releasesDir,
  sourceSha,
  activeSha,
  releaseId,
  deploy = defaultDeploy,
  seal = true,
}) {
  const candidateSourceRoot = fs.realpathSync(sourceRoot);
  let managedReleasesDir = path.resolve(releasesDir);
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error(`Invalid managed-runtime release ID: ${releaseId}`);
  }
  assertCandidateLineage({ sourceRoot: candidateSourceRoot, sourceSha, activeSha });
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
    assertCandidateLineage({ sourceRoot: candidateSourceRoot, sourceSha, activeSha });
    copyGitPaths({
      sourceRoot: candidateSourceRoot,
      sourceSha,
      targetRoot: stagingRoot,
      relativePaths: requiredCapabilityPaths(candidateSourceRoot, sourceSha),
    });
    fs.writeFileSync(path.join(stagingRoot, ".openclaw-production-sha"), `${sourceSha}\n`, {
      mode: 0o600,
    });
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
      },
      paths: {
        entrypoint: path.join(releaseRoot, "dist", "index.js"),
        controlUi: path.join(releaseRoot, "dist", "control-ui"),
        bundledPlugins: path.join(releaseRoot, "dist-runtime", "extensions"),
      },
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
          env: { ...process.env, OPENCLAW_CUSTOM_RUNTIME_RELEASES: managedReleasesDir },
          inherit: true,
        },
      );
    }
    return { releaseRoot, releaseId, artifactHash, runtimeClosureHash, runtimeClosurePaths };
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
    });
    process.stdout.write(`${JSON.stringify({ result: "packaged", ...result })}\n`);
  } catch (error) {
    process.stderr.write(
      `Custom runtime package blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

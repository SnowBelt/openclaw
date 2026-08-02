#!/usr/bin/env node
// Deterministic integrity and closure checks for immutable managed runtimes.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const ARTIFACT_PATHS = ["dist", "dist-runtime", "package.json"];
const EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  ".artifacts",
  ".openclaw",
  ".openclaw-custom-runtime",
  ".openclaw-runtime-releases",
]);
const SENSITIVE_EXTENSIONS = new Set([".key", ".p12", ".pfx", ".pem"]);

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

function normalizeRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
    throw new Error(`Runtime closure path must be repository-relative: ${String(value)}`);
  }
  const normalized = path.normalize(value).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Runtime closure path escapes its release: ${value}`);
  }
  return normalized;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sortedDirectoryEntries(directory) {
  return fs.readdirSync(directory).toSorted((left, right) => left.localeCompare(right));
}

function hashTree(rootDir, relativePaths, { includeExecutableMode }) {
  const root = fs.realpathSync(rootDir);
  const paths = [...new Set(relativePaths.map(normalizeRelativePath))].toSorted((a, b) =>
    a.localeCompare(b),
  );
  const hash = createHash("sha256");
  const visit = (absolutePath, relativePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      hash.update(`L\0${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update(`D\0${relativePath}\0`);
      for (const entry of sortedDirectoryEntries(absolutePath)) {
        visit(path.join(absolutePath, entry), path.posix.join(relativePath, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`Unsupported runtime package artifact: ${absolutePath}`);
    }
    const executableMode = includeExecutableMode ? stat.mode & 0o111 : 0;
    hash.update(`F\0${relativePath}\0${stat.size}\0${executableMode}\0`);
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  };
  for (const relativePath of paths) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Runtime package path is missing: ${relativePath}`);
    }
    visit(absolutePath, relativePath);
  }
  return hash.digest("hex");
}

// This retains the version-2 snapshot algorithm used by the build promoter.
export function hashBuildArtifactTree(rootDir) {
  const hash = createHash("sha256");
  const root = fs.realpathSync(rootDir);
  const visit = (absolutePath, relativePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      hash.update(`L\0${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update(`D\0${relativePath}\0`);
      for (const entry of sortedDirectoryEntries(absolutePath)) {
        visit(path.join(absolutePath, entry), path.join(relativePath, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`Unsupported runtime snapshot artifact: ${absolutePath}`);
    }
    hash.update(`F\0${relativePath}\0${stat.size}\0`);
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  };
  for (const relativePath of ARTIFACT_PATHS) {
    visit(path.join(root, relativePath), relativePath);
  }
  return hash.digest("hex");
}

export function hashRuntimeClosure(rootDir, relativePaths) {
  return hashTree(rootDir, relativePaths, { includeExecutableMode: true });
}

export function listRuntimeClosurePaths(rootDir) {
  return sortedDirectoryEntries(rootDir)
    .filter(
      (entry) =>
        !["snapshot.json", ".openclaw-production-sha", ".openclaw-runtime-sealed"].includes(entry),
    )
    .map(normalizeRelativePath);
}

function verifyTreeShape(root) {
  const errors = [];
  const visit = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      let resolved;
      try {
        resolved = fs.realpathSync(current);
      } catch {
        errors.push(`Runtime package contains a broken symlink: ${path.relative(root, current)}`);
        return;
      }
      if (!isContained(root, resolved)) {
        errors.push(`Runtime package symlink escapes the release: ${path.relative(root, current)}`);
      }
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of sortedDirectoryEntries(current)) {
        visit(path.join(current, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      errors.push(
        `Runtime package contains a special filesystem entry: ${path.relative(root, current)}`,
      );
      return;
    }
    const relative = path.relative(root, current).replaceAll("\\", "/");
    const outsideDependencies = !relative.split("/").includes("node_modules");
    const basename = path.basename(relative).toLowerCase();
    if (
      outsideDependencies &&
      (SENSITIVE_EXTENSIONS.has(path.extname(basename)) ||
        basename === ".env" ||
        basename.startsWith(".env."))
    ) {
      errors.push(`Runtime package contains a prohibited sensitive file: ${relative}`);
    }
  };
  for (const entry of sortedDirectoryEntries(root)) {
    if (EXCLUDED_TOP_LEVEL.has(entry)) {
      errors.push(`Runtime package contains a prohibited top-level path: ${entry}`);
      continue;
    }
    visit(path.join(root, entry));
  }
  return errors;
}

function verifyCapabilityClosure(root) {
  const errors = [];
  const manifestPath = path.join(root, "config", "custom-runtime-capabilities.json");
  if (!fs.existsSync(manifestPath)) {
    return ["Runtime capability manifest is missing."];
  }
  const manifest = readJson(manifestPath);
  const preservation = isRecord(manifest.preservation) ? manifest.preservation : null;
  const requiredPaths = new Set();
  if (typeof preservation?.standardsRegistry === "string") {
    requiredPaths.add(normalizeRelativePath(preservation.standardsRegistry));
  }
  if (!Array.isArray(manifest.capabilities)) {
    return ["Runtime capability manifest has no capability list."];
  }
  for (const capability of manifest.capabilities) {
    if (!isRecord(capability) || !Array.isArray(capability.requiredPaths)) {
      errors.push("Runtime capability manifest contains an invalid capability entry.");
      continue;
    }
    for (const requiredPath of capability.requiredPaths) {
      requiredPaths.add(normalizeRelativePath(requiredPath));
    }
  }
  for (const requiredPath of [...requiredPaths].toSorted()) {
    const absolutePath = path.join(root, requiredPath);
    try {
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push(`Required runtime capability path is not a regular file: ${requiredPath}`);
      }
    } catch {
      errors.push(`Required runtime capability path is missing: ${requiredPath}`);
    }
  }
  return errors;
}

function verifyResearchManagerDependencies(root) {
  const packagePath = path.join(root, "extensions", "research-manager", "package.json");
  if (!fs.existsSync(packagePath)) {
    return [];
  }
  const manifest = readJson(packagePath);
  const dependencies = isRecord(manifest.dependencies) ? Object.keys(manifest.dependencies) : [];
  return dependencies
    .filter((dependency) => !fs.existsSync(path.join(root, "node_modules", dependency)))
    .map((dependency) => `Research Manager runtime dependency is missing: ${dependency}`);
}

export function verifyRuntimePackage({ releaseRoot, expectedRoot = releaseRoot }) {
  const errors = [];
  let root;
  try {
    const rootStat = fs.lstatSync(releaseRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return ["Runtime release root must be a regular directory."];
    }
    root = fs.realpathSync(releaseRoot);
  } catch {
    return ["Runtime release root is missing."];
  }
  const snapshotPath = path.join(root, "snapshot.json");
  const sourceMarkerPath = path.join(root, ".openclaw-production-sha");
  let snapshot;
  try {
    const stat = fs.lstatSync(snapshotPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("unsafe snapshot");
    }
    snapshot = readJson(snapshotPath);
  } catch {
    return ["Runtime package snapshot is missing or unsafe."];
  }
  if (snapshot.version !== 2) {
    errors.push("Runtime package snapshot version must be 2.");
  }
  if (snapshot.root !== path.resolve(expectedRoot)) {
    errors.push("Runtime package snapshot root does not match the expected immutable release.");
  }
  let sourceSha = "";
  try {
    const stat = fs.lstatSync(sourceMarkerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("unsafe source marker");
    }
    sourceSha = fs.readFileSync(sourceMarkerPath, "utf8").trim();
  } catch {
    errors.push("Runtime package source marker is missing or unsafe.");
  }
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    errors.push("Runtime package source marker is not an exact Git SHA.");
  }
  if (!isRecord(snapshot.source) || snapshot.source.commit !== sourceSha) {
    errors.push("Runtime package snapshot source commit does not match its source marker.");
  }
  if (!SHA256_PATTERN.test(String(snapshot.artifactHash ?? ""))) {
    errors.push("Runtime package build artifact hash is invalid.");
  } else {
    try {
      const actualArtifactHash = hashBuildArtifactTree(root);
      if (actualArtifactHash !== snapshot.artifactHash) {
        errors.push("Runtime package build artifact hash does not match its bytes.");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (snapshot.runtimeClosureVersion !== 1) {
    errors.push("Runtime package closure version must be 1.");
  }
  if (!Array.isArray(snapshot.runtimeClosurePaths) || snapshot.runtimeClosurePaths.length === 0) {
    errors.push("Runtime package closure paths are missing.");
  } else if (!SHA256_PATTERN.test(String(snapshot.runtimeClosureHash ?? ""))) {
    errors.push("Runtime package closure hash is invalid.");
  } else {
    try {
      const normalized = snapshot.runtimeClosurePaths.map(normalizeRelativePath);
      if (new Set(normalized).size !== normalized.length) {
        errors.push("Runtime package closure paths contain duplicates.");
      }
      const actualPaths = listRuntimeClosurePaths(root);
      if (
        JSON.stringify(normalized.toSorted((left, right) => left.localeCompare(right))) !==
        JSON.stringify(actualPaths)
      ) {
        errors.push("Runtime package closure path inventory does not match the release.");
      }
      const actualClosureHash = hashRuntimeClosure(root, normalized);
      if (actualClosureHash !== snapshot.runtimeClosureHash) {
        errors.push("Runtime package closure hash does not match its bytes.");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  errors.push(...verifyTreeShape(root));
  errors.push(...verifyCapabilityClosure(root));
  errors.push(...verifyResearchManagerDependencies(root));
  return errors;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
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
    if (command !== "verify" || !values.get("release")) {
      throw new Error(
        "usage: runtime-package-integrity.mjs verify --release PATH [--expected-root PATH]",
      );
    }
    const releaseRoot = path.resolve(values.get("release"));
    const expectedRoot = path.resolve(values.get("expected-root") ?? releaseRoot);
    const errors = verifyRuntimePackage({ releaseRoot, expectedRoot });
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
    process.stdout.write(`${JSON.stringify({ result: "passed", releaseRoot, expectedRoot })}\n`);
  } catch (error) {
    process.stderr.write(
      `Runtime package integrity blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

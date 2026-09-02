#!/usr/bin/env node
// Generates and verifies the immutable build-completeness contract.
// The contract is deliberately derived from the packaged bytes so update
// preparation can reject missing, moved, stale, or unregistered artifacts.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { WORKSPACE_RUNTIME_TEMPLATE_NAMES } from "../lib/workspace-template-assets.mjs";

export const CUSTOM_RUNTIME_COMPLETENESS_SCHEMA = "openclaw.custom-runtime-completeness.v1";
export const CUSTOM_RUNTIME_COMPLETENESS_VERSION = 1;
export const CUSTOM_RUNTIME_COMPLETENESS_PATH = "dist/custom-runtime-completeness.json";

const DASHBOARD_MANIFEST_PATH = "dist/control-ui/dashboard-surfaces.json";
const SERVICE_WORKER_PATH = "dist/control-ui/sw.js";
const THEME_MODE_SOURCE_PATH = "ui/src/app/theme.ts";
const ENTRYPOINT_PATHS = ["dist/index.js", "dist/entry.js"];
const THEME_MODE_TYPE_PATTERN =
  /export\s+type\s+ThemeMode\s*=\s*((?:(?:"[^"]+"|'[^']+')\s*\|\s*)*(?:"[^"]+"|'[^']+'))\s*;/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }
  return value;
}

function normalizeRelativePath(value, label = "path") {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const normalized = value.replaceAll("\\", "/");
  const posix = path.posix.normalize(normalized);
  if (
    posix !== normalized ||
    posix === "." ||
    posix === ".." ||
    posix.startsWith("../") ||
    path.posix.isAbsolute(posix)
  ) {
    throw new Error(`${label} must be a normalized repository-relative path: ${value}`);
  }
  return posix;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assetEntry(rootDir, rawPath) {
  const relativePath = normalizeRelativePath(rawPath, "asset path");
  const root = fs.realpathSync(rootDir);
  const absolutePath = path.join(root, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(absolutePath);
    if (path.isAbsolute(target)) {
      throw new Error(`Completeness asset symlink must be relative: ${relativePath}`);
    }
    const resolved = fs.realpathSync(absolutePath);
    if (!isContained(root, resolved)) {
      throw new Error(`Completeness asset symlink escapes the build root: ${relativePath}`);
    }
    return { path: relativePath, kind: "symlink", target };
  }
  if (!stat.isFile()) {
    throw new Error(`Completeness asset is not a regular file: ${relativePath}`);
  }
  return {
    path: relativePath,
    kind: "file",
    size: stat.size,
    sha256: sha256File(absolutePath),
    executable: Boolean(stat.mode & 0o111),
  };
}

function collectAssetPaths(rootDir, rawRoot, excluded = new Set()) {
  const root = fs.realpathSync(rootDir);
  const relativeRoot = normalizeRelativePath(rawRoot, "asset root");
  const absoluteRoot = path.join(root, relativeRoot);
  const paths = [];
  const visit = (absolutePath, relativePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      if (!excluded.has(relativePath)) {
        paths.push(relativePath);
      }
      return;
    }
    if (!stat.isDirectory()) {
      throw new Error(`Completeness asset is not a supported filesystem entry: ${relativePath}`);
    }
    for (const entry of fs
      .readdirSync(absolutePath)
      .toSorted((left, right) => left.localeCompare(right))) {
      visit(path.join(absolutePath, entry), path.posix.join(relativePath, entry));
    }
  };
  visit(absoluteRoot, relativeRoot);
  return paths.toSorted((left, right) => left.localeCompare(right));
}

function collectAssetEntries(rootDir, rawRoot, excluded = new Set()) {
  return collectAssetPaths(rootDir, rawRoot, excluded).map((relativePath) =>
    assetEntry(rootDir, relativePath),
  );
}

function readThemeModes(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, THEME_MODE_SOURCE_PATH), "utf8");
  const match = source.match(THEME_MODE_TYPE_PATTERN);
  if (!match?.[1]) {
    throw new Error(
      `Unable to read the canonical ThemeMode contract from ${THEME_MODE_SOURCE_PATH}`,
    );
  }
  const values = [...match[1].matchAll(/["']([^"']+)["']/gu)].map((entry) => entry[1]);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error("Canonical ThemeMode contract is empty or contains duplicates.");
  }
  return values;
}

function readDashboardSurfaceManifest(rootDir) {
  const value = readJson(path.join(rootDir, DASHBOARD_MANIFEST_PATH));
  if (typeof value.buildId !== "string" || !value.buildId.trim()) {
    throw new Error("Dashboard surface manifest has no build ID.");
  }
  if (!Array.isArray(value.surfaces) || value.surfaces.length === 0) {
    throw new Error("Dashboard surface manifest has no surfaces.");
  }
  const seenIds = new Set();
  const surfaces = value.surfaces.map((surface, index) => {
    if (!isRecord(surface)) {
      throw new Error(`Dashboard surface ${index} is not an object.`);
    }
    const id = typeof surface.id === "string" ? surface.id.trim() : "";
    const route = typeof surface.path === "string" ? surface.path.trim() : "";
    const label = typeof surface.label === "string" ? surface.label.trim() : "";
    if (!id || !route || !label || seenIds.has(id)) {
      throw new Error(`Dashboard surface ${index} has an invalid or duplicate identity.`);
    }
    seenIds.add(id);
    const aliases = Array.isArray(surface.aliases)
      ? surface.aliases.map((alias) => (typeof alias === "string" ? alias : ""))
      : [];
    if (aliases.some((alias) => !alias.trim())) {
      throw new Error(`Dashboard surface ${id} has an invalid alias.`);
    }
    if (!Array.isArray(surface.assets) || surface.assets.length === 0) {
      throw new Error(`Dashboard surface ${id} has no generated assets.`);
    }
    const assets = surface.assets.map((rawAsset) => {
      if (
        typeof rawAsset !== "string" ||
        !rawAsset.startsWith("assets/") ||
        path.posix.normalize(rawAsset) !== rawAsset
      ) {
        throw new Error(`Dashboard surface ${id} has an unsafe asset reference.`);
      }
      return assetEntry(rootDir, path.posix.join("dist/control-ui", rawAsset));
    });
    return { id, path: route, label, aliases, assets };
  });
  return { buildId: value.buildId.trim(), surfaces };
}

function immediateDirectoryNames(rootDir, relativeRoot) {
  const absoluteRoot = path.join(rootDir, relativeRoot);
  return fs
    .readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "node_modules")
    .toSorted((left, right) => left.localeCompare(right));
}

function collectPluginInventory(rootDir, distAssets, runtimeAssets) {
  const distPluginIds = immediateDirectoryNames(rootDir, "dist/extensions");
  const runtimePluginIds = immediateDirectoryNames(rootDir, "dist-runtime/extensions");
  const pluginIds = [...new Set([...distPluginIds, ...runtimePluginIds])].toSorted((left, right) =>
    left.localeCompare(right),
  );
  if (pluginIds.length === 0) {
    throw new Error("Bundled plugin output is empty.");
  }
  return pluginIds.map((id) => {
    const distPrefix = `dist/extensions/${id}/`;
    const runtimePrefix = `dist-runtime/extensions/${id}/`;
    const distPaths = distAssets
      .filter((entry) => entry.path.startsWith(distPrefix))
      .map((entry) => entry.path);
    const runtimePaths = runtimeAssets
      .filter((entry) => entry.path.startsWith(runtimePrefix))
      .map((entry) => entry.path);
    if (distPaths.length === 0 || runtimePaths.length === 0) {
      throw new Error(`Bundled plugin ${id} is missing packaged or runtime output.`);
    }
    const hasMetadata = distPaths.some((entry) => {
      const basename = path.posix.basename(entry);
      return basename === "openclaw.plugin.json" || basename === "package.json";
    });
    if (!hasMetadata) {
      throw new Error(`Bundled plugin ${id} has no package metadata.`);
    }
    return { id, distPaths, runtimePaths };
  });
}

function compareJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addAssetInventoryErrors(errors, label, expected, actual) {
  if (!Array.isArray(expected)) {
    errors.push(`${label} inventory is missing.`);
    return new Map();
  }
  const expectedByPath = new Map();
  for (const entry of expected) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      errors.push(`${label} inventory contains an invalid entry.`);
      continue;
    }
    let normalizedPath;
    try {
      normalizedPath = normalizeRelativePath(entry.path, `${label} asset path`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (expectedByPath.has(normalizedPath)) {
      errors.push(`${label} inventory contains a duplicate path: ${normalizedPath}`);
      continue;
    }
    expectedByPath.set(normalizedPath, entry);
  }
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  for (const relativePath of expectedByPath.keys()) {
    if (!actualByPath.has(relativePath)) {
      errors.push(`${label} asset is missing: ${relativePath}`);
    }
  }
  for (const relativePath of actualByPath.keys()) {
    if (!expectedByPath.has(relativePath)) {
      errors.push(`${label} asset is unregistered: ${relativePath}`);
    }
  }
  for (const [relativePath, expectedEntry] of expectedByPath) {
    const actualEntry = actualByPath.get(relativePath);
    if (actualEntry && !compareJson(expectedEntry, actualEntry)) {
      errors.push(`${label} asset changed: ${relativePath}`);
    }
  }
  return expectedByPath;
}

function addDescriptorErrors(errors, rootDir, label, descriptor, artifactByPath, verifySource) {
  if (!isRecord(descriptor) || typeof descriptor.path !== "string") {
    errors.push(`${label} descriptor is invalid.`);
    return;
  }
  const relativePath = normalizeRelativePath(descriptor.path, `${label} path`);
  if (verifySource) {
    try {
      const actual = assetEntry(rootDir, relativePath);
      if (!compareJson(descriptor, actual)) {
        errors.push(`${label} changed: ${relativePath}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  const actual = artifactByPath.get(relativePath);
  if (!actual) {
    errors.push(`${label} is not present in the packaged artifact inventory: ${relativePath}`);
  } else if (!compareJson(descriptor, actual)) {
    errors.push(`${label} changed: ${relativePath}`);
  }
}

function validateManifestShape(manifest, errors) {
  if (manifest.schema !== CUSTOM_RUNTIME_COMPLETENESS_SCHEMA) {
    errors.push("Custom runtime completeness schema is invalid.");
  }
  if (manifest.version !== CUSTOM_RUNTIME_COMPLETENESS_VERSION) {
    errors.push("Custom runtime completeness version is invalid.");
  }
  if (!isRecord(manifest.source) || typeof manifest.source.commit !== "string") {
    errors.push("Custom runtime completeness source identity is missing.");
  }
  if (!isRecord(manifest.build) || typeof manifest.build.id !== "string") {
    errors.push("Custom runtime completeness build identity is missing.");
  }
  if (!Array.isArray(manifest.entrypoints) || manifest.entrypoints.length === 0) {
    errors.push("Custom runtime completeness entrypoints are missing.");
  }
  if (!isRecord(manifest.artifacts)) {
    errors.push("Custom runtime completeness artifact inventories are missing.");
  }
}

export function buildCustomRuntimeCompletenessManifest(rootDir) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const buildInfo = readJson(path.join(root, "dist/build-info.json"));
  const packageJson = readJson(path.join(root, "package.json"));
  const sourceCommit =
    typeof buildInfo.commit === "string" ? buildInfo.commit.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) {
    throw new Error("Build info must contain an exact source Git SHA.");
  }
  const sourceHead = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (sourceHead.status !== 0 || sourceHead.stdout.trim().toLowerCase() !== sourceCommit) {
    throw new Error("Build info source SHA does not match the checkout HEAD.");
  }
  const packageVersion =
    typeof buildInfo.version === "string" && buildInfo.version.trim()
      ? buildInfo.version.trim()
      : typeof packageJson.version === "string"
        ? packageJson.version.trim()
        : "";
  if (!packageVersion) {
    throw new Error("Build info has no package version.");
  }

  const dashboard = readDashboardSurfaceManifest(root);
  const serviceWorker = assetEntry(root, SERVICE_WORKER_PATH);
  const distAssets = collectAssetEntries(root, "dist", new Set([CUSTOM_RUNTIME_COMPLETENESS_PATH]));
  const runtimeAssets = collectAssetEntries(root, "dist-runtime");
  const plugins = collectPluginInventory(root, distAssets, runtimeAssets);
  const runtimeSupportPrefix = "dist/extensions/node_modules/openclaw/";
  const runtimeSupport = distAssets
    .filter((entry) => entry.path.startsWith(runtimeSupportPrefix))
    .map((entry) => entry.path);
  if (runtimeSupport.length === 0) {
    throw new Error("Bundled runtime SDK support output is missing.");
  }
  const modes = readThemeModes(root);
  const manifest = {
    schema: CUSTOM_RUNTIME_COMPLETENESS_SCHEMA,
    version: CUSTOM_RUNTIME_COMPLETENESS_VERSION,
    source: { commit: sourceCommit, packageVersion },
    build: {
      id: dashboard.buildId,
      version: packageVersion,
      buildInfo: assetEntry(root, "dist/build-info.json"),
      dashboardManifest: assetEntry(root, DASHBOARD_MANIFEST_PATH),
      serviceWorker,
    },
    modes: {
      kind: "control-ui-theme",
      source: assetEntry(root, THEME_MODE_SOURCE_PATH),
      values: modes,
    },
    templates: WORKSPACE_RUNTIME_TEMPLATE_NAMES.map((name) =>
      assetEntry(root, path.posix.join("dist/templates", name)),
    ),
    plugins,
    entrypoints: ENTRYPOINT_PATHS.map((entry) => assetEntry(root, entry)),
    dashboardRoutes: dashboard.surfaces,
    runtimeSupport,
    artifacts: { dist: distAssets, distRuntime: runtimeAssets },
  };
  const errors = verifyCustomRuntimeCompleteness({
    rootDir: root,
    expectedSourceSha: sourceCommit,
    manifest,
    verifySourceContract: true,
  });
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return manifest;
}

export function verifyCustomRuntimeCompleteness({
  rootDir,
  expectedSourceSha,
  manifest: suppliedManifest,
  verifySourceContract = true,
} = {}) {
  const root = fs.realpathSync(path.resolve(rootDir ?? process.cwd()));
  const errors = [];
  let manifest = suppliedManifest;
  if (!manifest) {
    try {
      manifest = readJson(path.join(root, CUSTOM_RUNTIME_COMPLETENESS_PATH));
    } catch {
      return ["Custom runtime completeness manifest is missing or invalid."];
    }
  }
  validateManifestShape(manifest, errors);
  const sourceSha = typeof manifest.source?.commit === "string" ? manifest.source.commit : "";
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) {
    errors.push("Custom runtime completeness source SHA is invalid.");
  }
  if (expectedSourceSha && sourceSha !== expectedSourceSha.trim().toLowerCase()) {
    errors.push("Custom runtime completeness source SHA does not match the expected SHA.");
  }

  let dashboard;
  try {
    dashboard = readDashboardSurfaceManifest(root);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  let buildInfo;
  try {
    buildInfo = readJson(path.join(root, "dist/build-info.json"));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (dashboard && manifest.build) {
    if (manifest.build.id !== dashboard.buildId) {
      errors.push("Custom runtime completeness build ID does not match the Dashboard manifest.");
    }
    const expectedRoutes = manifest.dashboardRoutes;
    const actualRoutes = dashboard.surfaces.map(({ id, path: route, label, aliases, assets }) => ({
      id,
      path: route,
      label,
      aliases,
      assets,
    }));
    if (!Array.isArray(expectedRoutes) || !compareJson(expectedRoutes, actualRoutes)) {
      errors.push("Custom runtime completeness Dashboard routes are stale or incomplete.");
    }
  }
  if (buildInfo && manifest.source) {
    if (
      manifest.source.commit !==
      String(buildInfo.commit ?? "")
        .trim()
        .toLowerCase()
    ) {
      errors.push("Custom runtime completeness source SHA does not match build info.");
    }
    if (manifest.source.packageVersion !== buildInfo.version) {
      errors.push("Custom runtime completeness package version does not match build info.");
    }
  }

  let distAssets = [];
  let runtimeAssets = [];
  try {
    distAssets = collectAssetEntries(root, "dist", new Set([CUSTOM_RUNTIME_COMPLETENESS_PATH]));
    runtimeAssets = collectAssetEntries(root, "dist-runtime");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const distByPath = addAssetInventoryErrors(errors, "dist", manifest.artifacts?.dist, distAssets);
  const runtimeByPath = addAssetInventoryErrors(
    errors,
    "dist-runtime",
    manifest.artifacts?.distRuntime,
    runtimeAssets,
  );
  const artifactByPath = new Map([...distByPath, ...runtimeByPath]);

  for (const entry of manifest.entrypoints ?? []) {
    addDescriptorErrors(errors, root, "Entrypoint", entry, artifactByPath, false);
  }
  for (const entry of manifest.templates ?? []) {
    addDescriptorErrors(errors, root, "Workspace template", entry, artifactByPath, false);
  }
  if (isRecord(manifest.build)) {
    for (const key of ["buildInfo", "dashboardManifest", "serviceWorker"]) {
      addDescriptorErrors(errors, root, `Build ${key}`, manifest.build[key], artifactByPath, false);
    }
    try {
      const serviceWorker = fs.readFileSync(path.join(root, SERVICE_WORKER_PATH), "utf8");
      if (!serviceWorker.includes(JSON.stringify(manifest.build.id))) {
        errors.push("Custom runtime completeness service worker build ID is stale.");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (isRecord(manifest.modes)) {
    if (manifest.modes.kind !== "control-ui-theme" || !Array.isArray(manifest.modes.values)) {
      errors.push("Custom runtime completeness mode contract is invalid.");
    }
    if (verifySourceContract) {
      addDescriptorErrors(
        errors,
        root,
        "Theme mode source",
        manifest.modes.source,
        artifactByPath,
        true,
      );
      try {
        if (!compareJson(manifest.modes.values, readThemeModes(root))) {
          errors.push("Custom runtime completeness theme modes are stale.");
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  let actualDistPluginIds = [];
  let actualRuntimePluginIds = [];
  try {
    actualDistPluginIds = immediateDirectoryNames(root, "dist/extensions");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    actualRuntimePluginIds = immediateDirectoryNames(root, "dist-runtime/extensions");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const actualPluginIds = [
    ...new Set([...actualDistPluginIds, ...actualRuntimePluginIds]),
  ].toSorted((left, right) => left.localeCompare(right));
  const expectedPlugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
  const expectedPluginIds = expectedPlugins
    .map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : ""))
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));
  if (!compareJson(expectedPluginIds, actualPluginIds)) {
    errors.push("Custom runtime completeness plugin inventory is stale or incomplete.");
  }
  for (const plugin of expectedPlugins) {
    if (!isRecord(plugin) || typeof plugin.id !== "string") {
      errors.push("Custom runtime completeness plugin entry is invalid.");
      continue;
    }
    for (const [key, expectedPaths] of [
      ["distPaths", plugin.distPaths],
      ["runtimePaths", plugin.runtimePaths],
    ]) {
      if (!Array.isArray(expectedPaths)) {
        errors.push(`Custom runtime completeness plugin ${plugin.id} ${key} are missing.`);
        continue;
      }
      const prefix =
        key === "distPaths"
          ? `dist/extensions/${plugin.id}/`
          : `dist-runtime/extensions/${plugin.id}/`;
      const actualPaths = [...artifactByPath.keys()]
        .filter((entry) => entry.startsWith(prefix))
        .toSorted((left, right) => left.localeCompare(right));
      if (
        !compareJson(
          [...expectedPaths].toSorted((left, right) => left.localeCompare(right)),
          actualPaths,
        )
      ) {
        errors.push(`Custom runtime completeness plugin ${plugin.id} ${key} are stale.`);
      }
    }
  }
  const actualRuntimeSupport = [...artifactByPath.keys()]
    .filter((entry) => entry.startsWith("dist/extensions/node_modules/openclaw/"))
    .toSorted((left, right) => left.localeCompare(right));
  if (!compareJson(manifest.runtimeSupport, actualRuntimeSupport)) {
    errors.push("Custom runtime completeness runtime SDK support inventory is stale.");
  }
  if (Array.isArray(manifest.dashboardRoutes)) {
    for (const route of manifest.dashboardRoutes) {
      for (const asset of route.assets ?? []) {
        addDescriptorErrors(
          errors,
          root,
          `Dashboard route ${route.id} asset`,
          asset,
          artifactByPath,
          false,
        );
      }
    }
  }
  return errors;
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function writeCustomRuntimeCompletenessManifest(rootDir = process.cwd()) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const manifest = buildCustomRuntimeCompletenessManifest(root);
  writeJsonAtomic(path.join(root, CUSTOM_RUNTIME_COMPLETENESS_PATH), manifest);
  const errors = verifyCustomRuntimeCompleteness({
    rootDir: root,
    expectedSourceSha: manifest.source.commit,
    verifySourceContract: true,
  });
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return manifest;
}

function parseCli(argv) {
  const [command, rootArg, root] = argv;
  if ((command !== "write" && command !== "verify") || rootArg !== "--root") {
    throw new Error("usage: custom-runtime-completeness.mjs <write|verify> --root PATH");
  }
  if (!root) {
    throw new Error("--root requires a path");
  }
  return { command, root };
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, root } = parseCli(process.argv.slice(2));
    if (command === "write") {
      const manifest = writeCustomRuntimeCompletenessManifest(root);
      process.stdout.write(
        `${JSON.stringify({ result: "written", path: path.join(root, CUSTOM_RUNTIME_COMPLETENESS_PATH), sourceSha: manifest.source.commit })}\n`,
      );
    } else {
      const errors = verifyCustomRuntimeCompleteness({ rootDir: root, verifySourceContract: true });
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }
      process.stdout.write(`${JSON.stringify({ result: "passed" })}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `Custom runtime completeness blocked: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

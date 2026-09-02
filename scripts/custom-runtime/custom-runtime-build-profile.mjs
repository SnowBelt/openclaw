#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  collectBundledPluginBuildEntries,
  NON_PACKAGED_BUNDLED_PLUGIN_DIRS,
} from "../lib/bundled-plugin-build-entries.mjs";

export const REQUIRED_CERTIFICATION_PLUGIN_IDS = Object.freeze([
  "codex",
  "discord",
  "ollama",
  "searxng",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSourcePluginManifests(root) {
  const extensionsRoot = path.join(root, "extensions");
  const extensionsStat = fs.lstatSync(extensionsRoot);
  if (!extensionsStat.isDirectory() || extensionsStat.isSymbolicLink()) {
    throw new Error("Bundled plugin source root is unavailable.");
  }
  const manifests = [];
  for (const entry of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginRoot = path.join(extensionsRoot, entry.name);
    const pluginRootStat = fs.lstatSync(pluginRoot);
    if (pluginRootStat.isSymbolicLink()) {
      throw new Error(`Bundled plugin source root is a symlink: ${entry.name}`);
    }
    const manifestPath = path.join(pluginRoot, "openclaw.plugin.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error(`Bundled plugin manifest is not a regular file: ${entry.name}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      throw new Error(`Bundled plugin manifest is invalid: ${entry.name}`);
    }
    if (!isRecord(manifest) || typeof manifest.id !== "string" || !manifest.id.trim()) {
      throw new Error(`Bundled plugin identity mismatch: ${entry.name}`);
    }
    const packagePath = path.join(pluginRoot, "package.json");
    let packageJson;
    if (fs.existsSync(packagePath)) {
      const packageStat = fs.lstatSync(packagePath);
      if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
        throw new Error(`Bundled plugin package manifest is not a regular file: ${entry.name}`);
      }
      try {
        packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      } catch {
        throw new Error(`Bundled plugin package manifest is invalid: ${entry.name}`);
      }
    }
    if (manifests.some((candidate) => candidate.pluginId === manifest.id)) {
      throw new Error(`Bundled plugin id is duplicated: ${manifest.id}`);
    }
    manifests.push({
      directoryId: entry.name,
      pluginId: manifest.id,
      bundledDist: packageJson?.openclaw?.build?.bundledDist !== false,
      packageJson,
    });
  }
  return manifests;
}

export function resolveCustomRuntimeBuildPluginIds({ repoRoot, manifestPath }) {
  const root = fs.realpathSync(repoRoot);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    !isRecord(manifest) ||
    manifest.schema !== "openclaw.custom-runtime-capabilities.v2" ||
    !Array.isArray(manifest.capabilities)
  ) {
    throw new Error("Custom runtime capability manifest is invalid.");
  }
  const pluginIds = new Set();
  for (const capability of manifest.capabilities) {
    if (!isRecord(capability) || capability.kind !== "plugin") {
      continue;
    }
    if (typeof capability.pluginId !== "string" || !capability.pluginId.trim()) {
      throw new Error("Plugin capability has no exact pluginId.");
    }
    pluginIds.add(capability.pluginId);
  }
  const missing = REQUIRED_CERTIFICATION_PLUGIN_IDS.filter((id) => !pluginIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Custom runtime certification plugins are missing: ${missing.join(",")}`);
  }
  const sourceManifests = readSourcePluginManifests(root);
  const buildEnvironment = {
    ...process.env,
    OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS: "",
    OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: "1",
  };
  const buildEntries = collectBundledPluginBuildEntries({
    cwd: root,
    env: buildEnvironment,
  });
  const runtimeBuildableIds = new Set(
    buildEntries
      .filter((entry) => !NON_PACKAGED_BUNDLED_PLUGIN_DIRS.has(entry.id))
      .map((entry) => entry.id),
  );
  const bundledPluginIds = buildEntries
    .map((entry) => entry.id)
    .toSorted((left, right) => left.localeCompare(right));
  const bundledRuntimePluginIds = [];
  const externalPluginIds = [];
  for (const sourceManifest of sourceManifests) {
    if (sourceManifest.bundledDist) {
      if (runtimeBuildableIds.has(sourceManifest.directoryId)) {
        bundledRuntimePluginIds.push(sourceManifest.pluginId);
      }
    } else {
      externalPluginIds.push(sourceManifest.pluginId);
    }
  }
  for (const pluginId of pluginIds) {
    const sourceManifest = sourceManifests.find(
      (candidate) => candidate.directoryId === pluginId || candidate.pluginId === pluginId,
    );
    if (!sourceManifest) {
      throw new Error(`Bundled plugin manifest is unavailable: ${pluginId}`);
    }
    if (sourceManifest.bundledDist && !runtimeBuildableIds.has(sourceManifest.directoryId)) {
      throw new Error(`Configured bundled plugin is not buildable: ${pluginId}`);
    }
  }
  return {
    bundledPluginIds,
    bundledRuntimePluginIds: bundledRuntimePluginIds.toSorted((left, right) =>
      left.localeCompare(right),
    ),
    externalPluginIds: externalPluginIds.toSorted((left, right) => left.localeCompare(right)),
  };
}

export function runCustomRuntimeBuild({ repoRoot = process.cwd() } = {}) {
  const root = fs.realpathSync(repoRoot);
  const manifestPath = path.join(root, "config", "custom-runtime-capabilities.json");
  const pluginIds = resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath });
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-all.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      OPENCLAW_BUILD_ALL_NO_PNPM: "1",
      OPENCLAW_INCLUDE_OPTIONAL_BUNDLED: "1",
      OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS: pluginIds.bundledPluginIds.join(","),
    },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? `Custom runtime build failed: ${result.status}`);
  }
  return { pluginIds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runCustomRuntimeBuild();
    process.stdout.write(`${JSON.stringify({ status: "pass", ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

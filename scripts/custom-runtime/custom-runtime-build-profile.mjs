#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const REQUIRED_CERTIFICATION_PLUGIN_IDS = Object.freeze([
  "codex",
  "discord",
  "ollama",
  "searxng",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const result = [...pluginIds].toSorted((left, right) => left.localeCompare(right));
  const bundledPluginIds = [];
  const externalPluginIds = [];
  for (const pluginId of result) {
    const pluginRoot = path.join(root, "extensions", pluginId);
    const manifestFile = path.join(pluginRoot, "openclaw.plugin.json");
    if (!fs.existsSync(manifestFile) || fs.lstatSync(manifestFile).isSymbolicLink()) {
      throw new Error(`Bundled plugin manifest is unavailable: ${pluginId}`);
    }
    const pluginManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (!isRecord(pluginManifest) || pluginManifest.id !== pluginId) {
      throw new Error(`Bundled plugin identity mismatch: ${pluginId}`);
    }
    const packagePath = path.join(pluginRoot, "package.json");
    const packageJson = fs.existsSync(packagePath)
      ? JSON.parse(fs.readFileSync(packagePath, "utf8"))
      : {};
    if (
      isRecord(packageJson?.openclaw?.build) &&
      packageJson.openclaw.build.bundledDist === false
    ) {
      externalPluginIds.push(pluginId);
    } else {
      bundledPluginIds.push(pluginId);
    }
  }
  return { bundledPluginIds, externalPluginIds };
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

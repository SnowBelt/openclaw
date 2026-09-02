// Shared plugin-closure rules for custom-runtime builds and staged launches.
import fs from "node:fs";
import path from "node:path";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePluginId(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} contains an invalid plugin id.`);
  }
  return value.trim();
}

function addPluginIds(target, values, label) {
  if (values === undefined) {
    return;
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array.`);
  }
  for (const value of values) {
    target.add(normalizePluginId(value, label));
  }
}

function isDisabledEntry(value) {
  return value === false || (isRecord(value) && value.enabled === false);
}

/** Collect plugin ids referenced by the effective configured startup contract. */
export function collectConfiguredRuntimePluginIds(config) {
  if (!isRecord(config)) {
    throw new Error("Runtime config must be an object.");
  }
  const plugins = config.plugins === undefined ? {} : config.plugins;
  if (!isRecord(plugins)) {
    throw new Error("Runtime config plugins section must be an object.");
  }
  if (plugins.enabled === false) {
    return [];
  }

  const configured = new Set();
  addPluginIds(configured, plugins.allow, "Runtime config plugins.allow");
  addPluginIds(configured, plugins.deny, "Runtime config plugins.deny");

  if (plugins.entries !== undefined) {
    if (!isRecord(plugins.entries)) {
      throw new Error("Runtime config plugins.entries must be an object.");
    }
    for (const [pluginId, entry] of Object.entries(plugins.entries)) {
      const normalized = normalizePluginId(pluginId, "Runtime config plugins.entries");
      if (!isDisabledEntry(entry)) {
        configured.add(normalized);
      }
    }
  }

  if (plugins.slots !== undefined) {
    if (!isRecord(plugins.slots)) {
      throw new Error("Runtime config plugins.slots must be an object.");
    }
    for (const slotName of ["memory", "contextEngine"]) {
      if (!Object.hasOwn(plugins.slots, slotName)) {
        continue;
      }
      const value = normalizePluginId(
        plugins.slots[slotName],
        `Runtime config plugins.slots.${slotName}`,
      );
      if (value.toLowerCase() !== "none" && !(slotName === "contextEngine" && value === "legacy")) {
        configured.add(value);
      }
    }
  }

  const disabled = new Set();
  if (plugins.entries !== undefined) {
    for (const [pluginId, entry] of Object.entries(plugins.entries)) {
      if (isDisabledEntry(entry)) {
        disabled.add(normalizePluginId(pluginId, "Runtime config plugins.entries"));
      }
    }
  }
  const denied = new Set();
  addPluginIds(denied, plugins.deny, "Runtime config plugins.deny");
  for (const pluginId of [...disabled, ...denied]) {
    configured.delete(pluginId);
  }

  return [...configured].toSorted((left, right) => left.localeCompare(right));
}

function readPluginManifest(loadPath) {
  if (typeof loadPath !== "string" || loadPath.trim() === "") {
    throw new Error("Runtime config plugins.load.paths contains an invalid path.");
  }
  const configuredPath = path.resolve(loadPath);
  let realPath;
  try {
    realPath = fs.realpathSync(configuredPath);
  } catch {
    throw new Error(`Runtime plugin load path is unavailable: ${loadPath}`);
  }
  const stat = fs.lstatSync(realPath);
  const manifestPath = stat.isDirectory() ? path.join(realPath, "openclaw.plugin.json") : realPath;
  let manifestStat;
  try {
    manifestStat = fs.lstatSync(manifestPath);
  } catch {
    throw new Error(`Runtime plugin manifest is unavailable: ${loadPath}`);
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error(`Runtime plugin manifest is not a regular file: ${loadPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`Runtime plugin manifest is invalid: ${loadPath}`);
  }
  if (!isRecord(manifest)) {
    throw new Error(`Runtime plugin manifest is not an object: ${loadPath}`);
  }
  return {
    id: normalizePluginId(manifest.id, `Runtime plugin manifest at ${loadPath}`),
    path: realPath,
  };
}

/** Read plugin ids from the self-contained bundled runtime tree. */
export function collectBundledRuntimePluginIds(runtimeRoot) {
  const extensionsRoot = path.join(runtimeRoot, "dist-runtime", "extensions");
  let rootStat;
  try {
    rootStat = fs.lstatSync(extensionsRoot);
  } catch {
    throw new Error("Runtime bundled plugin directory is missing.");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Runtime bundled plugin directory is unsafe.");
  }
  const ids = [];
  for (const entry of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Runtime bundled plugin directory is a symlink: ${entry.name}`);
    }
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginRoot = path.join(extensionsRoot, entry.name);
    const pluginRootStat = fs.lstatSync(pluginRoot);
    if (pluginRootStat.isSymbolicLink()) {
      throw new Error(`Runtime bundled plugin directory is a symlink: ${entry.name}`);
    }
    const manifestPath = path.join(pluginRoot, "openclaw.plugin.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      throw new Error(`Runtime bundled plugin manifest is unsafe: ${entry.name}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      throw new Error(`Runtime bundled plugin manifest is invalid: ${entry.name}`);
    }
    if (!isRecord(manifest) || typeof manifest.id !== "string" || manifest.id.trim() === "") {
      throw new Error(`Runtime bundled plugin identity is invalid: ${entry.name}`);
    }
    const id = manifest.id.trim();
    if (ids.includes(id)) {
      throw new Error(`Runtime bundled plugin id is duplicated: ${id}`);
    }
    ids.push(id);
  }
  return ids.toSorted((left, right) => left.localeCompare(right));
}

/** Read ids from explicitly configured external plugin load paths. */
export function collectExternalRuntimePluginIds(config) {
  if (!isRecord(config)) {
    throw new Error("Runtime config must be an object.");
  }
  const plugins = config.plugins === undefined ? {} : config.plugins;
  if (!isRecord(plugins)) {
    throw new Error("Runtime config plugins section must be an object.");
  }
  const load = plugins.load === undefined ? {} : plugins.load;
  if (!isRecord(load)) {
    throw new Error("Runtime config plugins.load must be an object.");
  }
  const paths = load.paths;
  if (paths === undefined) {
    return [];
  }
  if (!Array.isArray(paths)) {
    throw new Error("Runtime config plugins.load.paths must be an array.");
  }
  const ids = new Set();
  const rootsById = new Map();
  for (const loadPath of paths) {
    const manifest = readPluginManifest(loadPath);
    const previous = rootsById.get(manifest.id);
    if (previous && previous !== manifest.path) {
      throw new Error(
        `Runtime plugin id is registered from multiple external roots: ${manifest.id}`,
      );
    }
    rootsById.set(manifest.id, manifest.path);
    ids.add(manifest.id);
  }
  return [...ids].toSorted((left, right) => left.localeCompare(right));
}

/**
 * Require every configured plugin to be supplied by the bundled release or an
 * explicitly configured external load path.
 */
export function assertRuntimePluginClosure({
  configuredPluginIds,
  bundledPluginIds,
  externalPluginIds,
}) {
  const configured = [...new Set(configuredPluginIds)].toSorted((left, right) =>
    left.localeCompare(right),
  );
  const available = new Set([...bundledPluginIds, ...externalPluginIds]);
  const missing = configured.filter((pluginId) => !available.has(pluginId));
  if (missing.length > 0) {
    throw new Error(`Runtime plugin closure is incomplete: ${missing.join(", ")}`);
  }
  return {
    configuredPluginIds: configured,
    bundledPluginIds: [...new Set(bundledPluginIds)].toSorted((left, right) =>
      left.localeCompare(right),
    ),
    externalPluginIds: [...new Set(externalPluginIds)].toSorted((left, right) =>
      left.localeCompare(right),
    ),
  };
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(qaDir, "..");
const codexPluginRoot = path.resolve(pluginRoot, "../codex");
const searxngPluginRoot = path.resolve(pluginRoot, "../searxng");
const DELETED_PROVIDER = "local-glm52";
const DELETED_MODEL = "GLM-5.2-UD-IQ1_S-00001-of-00006.gguf";
const DELETED_MODEL_REF = `${DELETED_PROVIDER}/${DELETED_MODEL}`;
const INCORRECT_SOL_REF = "openai/gpt-5.6-sol";

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--config" || argument === "--receipt" || argument === "--plugin-path") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.`);
  }
  if (!options.config) {
    throw new Error("--config is required.");
  }
  return options;
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ensureRecord(parent, key) {
  const current = asRecord(parent[key]);
  parent[key] = current;
  return current;
}

function addUnique(values, value) {
  if (!values.includes(value)) {
    values.push(value);
    return true;
  }
  return false;
}

function collectDeletedReferences(value, currentPath = [], found = []) {
  if (typeof value === "string") {
    if (value === DELETED_PROVIDER || value.includes(DELETED_MODEL)) {
      found.push({ path: currentPath.join("."), value });
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectDeletedReferences(entry, [...currentPath, index], found),
    );
    return found;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      collectDeletedReferences(entry, [...currentPath, key], found),
    );
  }
  return found;
}

function configure(config, resolvedPluginPath) {
  const changedPaths = [];
  const plugins = ensureRecord(config, "plugins");
  const load = ensureRecord(plugins, "load");
  if (!Array.isArray(load.paths)) {
    load.paths = [];
    changedPaths.push("plugins.load.paths");
  }
  if (addUnique(load.paths, resolvedPluginPath)) {
    changedPaths.push("plugins.load.paths[research-manager]");
  }
  const withoutCodexOverride = load.paths.filter(
    (entry) => typeof entry !== "string" || path.resolve(entry) !== codexPluginRoot,
  );
  if (withoutCodexOverride.length !== load.paths.length) {
    load.paths = withoutCodexOverride;
    changedPaths.push("plugins.load.paths[codex] (removed; bundled plugin retained)");
  }
  if (addUnique(load.paths, searxngPluginRoot)) {
    changedPaths.push("plugins.load.paths[searxng]");
  }
  if (!Array.isArray(plugins.allow)) {
    plugins.allow = [];
    changedPaths.push("plugins.allow");
  }
  if (addUnique(plugins.allow, "research-manager")) {
    changedPaths.push("plugins.allow[research-manager]");
  }
  if (addUnique(plugins.allow, "codex")) {
    changedPaths.push("plugins.allow[codex]");
  }
  if (addUnique(plugins.allow, "duckduckgo")) {
    changedPaths.push("plugins.allow[duckduckgo]");
  }
  if (addUnique(plugins.allow, "searxng")) {
    changedPaths.push("plugins.allow[searxng]");
  }
  const entries = ensureRecord(plugins, "entries");
  const codexEntry = ensureRecord(entries, "codex");
  if (codexEntry.enabled !== true) {
    codexEntry.enabled = true;
    changedPaths.push("plugins.entries.codex.enabled");
  }
  const duckDuckGoEntry = ensureRecord(entries, "duckduckgo");
  if (duckDuckGoEntry.enabled !== true) {
    duckDuckGoEntry.enabled = true;
    changedPaths.push("plugins.entries.duckduckgo.enabled");
  }
  const searxngEntry = ensureRecord(entries, "searxng");
  if (searxngEntry.enabled !== true) {
    searxngEntry.enabled = true;
    changedPaths.push("plugins.entries.searxng.enabled");
  }
  const searxngConfig = ensureRecord(searxngEntry, "config");
  const searxngWebSearch = ensureRecord(searxngConfig, "webSearch");
  if (searxngWebSearch.baseUrl !== "http://127.0.0.1:8888") {
    searxngWebSearch.baseUrl = "http://127.0.0.1:8888";
    changedPaths.push("plugins.entries.searxng.config.webSearch.baseUrl");
  }
  const researchEntry = ensureRecord(entries, "research-manager");
  if (researchEntry.enabled !== true) {
    researchEntry.enabled = true;
    changedPaths.push("plugins.entries.research-manager.enabled");
  }
  const researchConfig = ensureRecord(researchEntry, "config");
  const desiredConfig = {
    defaultMode: "certified",
    certificationThreshold: 93,
    resourceLimits: {
      softMemoryGb: 130,
      hardMemoryGb: 145,
      absoluteMemoryGb: 150,
      maxLocalParallel: 1,
      maxLoadedModels: 3,
      maxLogicalWorkers: 5,
      queueLimit: 32,
      queueDeadlineMs: 900000,
    },
    modelTimeoutMs: 900000,
    maxModelAttempts: 3,
    stateTtlDays: 30,
  };
  for (const [key, value] of Object.entries(desiredConfig)) {
    if (JSON.stringify(researchConfig[key]) !== JSON.stringify(value)) {
      researchConfig[key] = value;
      changedPaths.push(`plugins.entries.research-manager.config.${key}`);
    }
  }
  const retrievalConfig = ensureRecord(researchConfig, "retrieval");
  const desiredRetrievalConfig = {
    providerOrder: ["searxng", "duckduckgo"],
    searchConcurrency: 3,
    fallbackDelayMs: 2000,
    queryCount: 24,
  };
  for (const [key, value] of Object.entries(desiredRetrievalConfig)) {
    if (JSON.stringify(retrievalConfig[key]) !== JSON.stringify(value)) {
      retrievalConfig[key] = value;
      changedPaths.push(`plugins.entries.research-manager.config.retrieval.${key}`);
    }
  }

  const tools = ensureRecord(config, "tools");
  const web = ensureRecord(tools, "web");
  const search = ensureRecord(web, "search");
  const desiredSearchConfig = {
    enabled: true,
    provider: "searxng",
    maxResults: 10,
    timeoutSeconds: 30,
    cacheTtlMinutes: 15,
  };
  for (const [key, value] of Object.entries(desiredSearchConfig)) {
    if (search[key] !== value) {
      search[key] = value;
      changedPaths.push(`tools.web.search.${key}`);
    }
  }

  const agents = ensureRecord(config, "agents");
  const defaults = ensureRecord(agents, "defaults");
  const agentModels = ensureRecord(defaults, "models");
  if (Object.hasOwn(agentModels, DELETED_MODEL_REF)) {
    delete agentModels[DELETED_MODEL_REF];
    changedPaths.push(`agents.defaults.models.${DELETED_MODEL_REF} (removed)`);
  }
  if (JSON.stringify(agentModels[INCORRECT_SOL_REF]) === '{"alias":"gpt-5.6-sol"}') {
    delete agentModels[INCORRECT_SOL_REF];
    changedPaths.push(`agents.defaults.models.${INCORRECT_SOL_REF} (removed)`);
  }
  const codexModels = {
    "codex/gpt-5.6-sol": { alias: "gpt-5.6-sol" },
    "codex/gpt-5.5": { alias: "gpt-5.5" },
  };
  for (const [modelRef, definition] of Object.entries(codexModels)) {
    if (!Object.hasOwn(agentModels, modelRef)) {
      agentModels[modelRef] = definition;
      changedPaths.push(`agents.defaults.models.${modelRef}`);
    }
  }

  const models = ensureRecord(config, "models");
  const providers = ensureRecord(models, "providers");
  if (Object.hasOwn(providers, DELETED_PROVIDER)) {
    delete providers[DELETED_PROVIDER];
    changedPaths.push(`models.providers.${DELETED_PROVIDER} (removed)`);
  }
  const staleReferences = collectDeletedReferences(config);
  if (staleReferences.length > 0) {
    throw new Error(
      `Deleted GLM-5.2 still has references outside the owned catalog paths: ${staleReferences.map((entry) => entry.path).join(", ")}`,
    );
  }
  return changedPaths;
}

async function writeAtomic(file, contents, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, { mode });
  await fs.rename(temporary, file);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(options.config);
  const resolvedPluginPath = path.resolve(options.pluginPath ?? pluginRoot);
  const before = await fs.readFile(configPath, "utf8");
  const stat = await fs.stat(configPath);
  const config = JSON5.parse(before);
  const changedPaths = configure(config, resolvedPluginPath);
  const changed = changedPaths.length > 0;
  const after = changed ? `${JSON.stringify(config, null, 2)}\n` : before;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak.research-manager.${stamp}`;
  if (changed && !options.dryRun) {
    await fs.copyFile(configPath, backupPath);
    await writeAtomic(configPath, after, stat.mode);
  }
  const receiptWithoutHash = {
    schemaVersion: 1,
    program: "research-manager-active-config",
    appliedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    changed,
    configPath,
    pluginPaths: [resolvedPluginPath, searxngPluginRoot],
    enabledPlugins: ["research-manager", "codex", "searxng", "duckduckgo"],
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    ...(changed && !options.dryRun ? { backupPath } : {}),
    changedPaths,
    removed: {
      provider: DELETED_PROVIDER,
      modelRef: DELETED_MODEL_REF,
      incorrectSolRef: INCORRECT_SOL_REF,
    },
  };
  const receipt = {
    ...receiptWithoutHash,
    receiptSha256: sha256(JSON.stringify(receiptWithoutHash)),
  };
  if (options.receipt) {
    const receiptPath = path.resolve(options.receipt);
    await fs.mkdir(path.dirname(receiptPath), { recursive: true });
    await writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

await main();

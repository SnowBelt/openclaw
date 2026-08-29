#!/usr/bin/env node

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSON5 from "json5";
import {
  parseLastJsonValue,
  runBenchmark as executeContractMatrix,
  SCENARIOS,
} from "./program-manager-performance.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const MODEL_RECEIPT_SCHEMA_VERSION = 1;
export const DEFAULT_AGENT = "program-manager";
export const DEFAULT_CLI = "openclaw";
export const DEFAULT_ITERATIONS = 3;
export const DEFAULT_TIMEOUT_SECONDS = 120;
export const MIN_CONTEXT_TOKENS = 8_192;
export const MIN_OUTPUT_TOKENS = 512;
export const PORTABLE_MODEL_PARAMS = Object.freeze({
  cacheRetention: "short",
  maxTokens: 1024,
  temperature: 0,
});
export const LOCAL_PROVIDER_IDS = Object.freeze([
  "ollama",
  "omlx",
  "omlx-qwen38-agent",
  "lmstudio",
]);

function defaultConfigPath() {
  return process.env.OPENCLAW_CONFIG_PATH
    ? path.resolve(process.env.OPENCLAW_CONFIG_PATH)
    : path.join(os.homedir(), ".openclaw", "openclaw.director.json");
}

function defaultStateDir() {
  return process.env.OPENCLAW_PROGRAM_MANAGER_MODEL_STATE_DIR
    ? path.resolve(process.env.OPENCLAW_PROGRAM_MANAGER_MODEL_STATE_DIR)
    : path.join(os.homedir(), ".openclaw-director-state", "program-manager-models");
}

function positiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${label} must be a positive integer.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const command = argv[0];
  const options = {
    command,
    model: null,
    configPath: defaultConfigPath(),
    stateDir: defaultStateDir(),
    cli: DEFAULT_CLI,
    agent: DEFAULT_AGENT,
    iterations: DEFAULT_ITERATIONS,
    timeout: DEFAULT_TIMEOUT_SECONDS,
    allowHosted: false,
    json: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model") {
      options.model = argv[++index];
    } else if (arg === "--config") {
      options.configPath = path.resolve(argv[++index]);
    } else if (arg === "--state-dir") {
      options.stateDir = path.resolve(argv[++index]);
    } else if (arg === "--cli") {
      options.cli = argv[++index];
    } else if (arg === "--agent") {
      options.agent = argv[++index];
    } else if (arg === "--iterations") {
      options.iterations = positiveInt(argv[++index], "iterations");
    } else if (arg === "--timeout") {
      options.timeout = positiveInt(argv[++index], "timeout");
    } else if (arg === "--allow-hosted") {
      options.allowHosted = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!["qualify", "switch", "status", "rollback"].includes(command)) {
    throw new Error("Command must be qualify, switch, status, or rollback.");
  }
  if (["qualify", "switch"].includes(command) && !options.model) {
    throw new Error(`program-manager-model ${command} requires --model <provider/model>.`);
  }
  return options;
}

export function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret|password|credential)\s*[:=]\s*[^\s,}]+/giu, "$1=[REDACTED]")
    .replace(/\/Users\/[^\s/]+/gu, "/Users/[REDACTED]");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text, label) {
  try {
    return JSON5.parse(text);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON/JSON5: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function readConfig(configPath) {
  return parseJson(await readFile(configPath, "utf8"), configPath);
}

export function resolveProgramManagerEntry(config, agentId = DEFAULT_AGENT) {
  if (Array.isArray(config?.agents?.list)) {
    const entry = config.agents.list.find((candidate) => candidate?.id === agentId);
    if (!entry) {
      throw new Error(`Agent ${agentId} is missing from agents.list.`);
    }
    return entry;
  }
  if (isObject(config?.agents?.entries)) {
    const entry = config.agents.entries[agentId];
    if (!isObject(entry)) {
      throw new Error(`Agent ${agentId} is missing from agents.entries.`);
    }
    return entry;
  }
  throw new Error("Config must define agents.list or agents.entries.");
}

export function readModelRoute(entry) {
  if (typeof entry?.model === "string" && entry.model.trim()) {
    return { primary: entry.model.trim(), fallbacks: [] };
  }
  if (
    isObject(entry?.model) &&
    typeof entry.model.primary === "string" &&
    entry.model.primary.trim()
  ) {
    return {
      primary: entry.model.primary.trim(),
      fallbacks: Array.isArray(entry.model.fallbacks)
        ? entry.model.fallbacks
            .filter((value) => typeof value === "string" && value.trim())
            .map((value) => value.trim())
        : [],
    };
  }
  throw new Error("Program Manager has no active model route.");
}

export function updateModelRoute(config, candidate, agentId = DEFAULT_AGENT) {
  const entry = resolveProgramManagerEntry(config, agentId);
  const before = readModelRoute(entry);
  const fallbacks = [before.primary, ...before.fallbacks].filter(
    (value, index, values) => value !== candidate && values.indexOf(value) === index,
  );
  const existing = isObject(entry.model) ? entry.model : {};
  entry.model = { ...existing, primary: candidate, fallbacks };
  return { before, after: { primary: candidate, fallbacks } };
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath) {
  return hashText(await readFile(filePath));
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

async function defaultRunCommand(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? error?.message ?? error ?? ""),
    };
  }
}

function commandEnv(configPath) {
  return { ...process.env, OPENCLAW_CONFIG_PATH: configPath };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function inspectPayload(raw) {
  if (isObject(raw?.result)) {
    return raw.result;
  }
  if (isObject(raw?.model)) {
    return raw.model;
  }
  return raw;
}

export function preflightModel(candidate, inspectResult, { allowHosted = false } = {}) {
  const raw = inspectPayload(inspectResult);
  if (!isObject(raw)) {
    return { ok: false, issues: ["inspect_result_missing"] };
  }
  const provider = String(
    firstDefined(raw.provider, raw.providerId, raw.provider_id, candidate.split("/")[0]) ?? "",
  );
  const resolvedModel = String(
    firstDefined(raw.id, raw.model, raw.modelId, raw.model_id, candidate) ?? candidate,
  );
  const contextTokens = Number(
    firstDefined(
      raw.contextWindow,
      raw.context_window,
      raw.contextLength,
      raw.context_length,
      raw.context,
    ),
  );
  const outputTokens = Number(
    firstDefined(
      raw.maxTokens,
      raw.max_tokens,
      raw.maxOutputTokens,
      raw.max_output_tokens,
      raw.outputLimit,
    ),
  );
  const supportsTools = firstDefined(
    raw.supportsTools,
    raw.supports_tools,
    raw.compat?.supportsTools,
    raw.compat?.supports_tools,
    raw.capabilities?.tools,
    raw.toolCalling,
  );
  const input = firstDefined(
    raw.input,
    raw.inputTypes,
    raw.modalities?.input,
    raw.capabilities?.input,
  );
  const textInput =
    input === undefined ||
    input === null ||
    input === "text" ||
    (Array.isArray(input) && input.includes("text"));
  const local = LOCAL_PROVIDER_IDS.includes(provider.toLowerCase());
  const issues = [];
  if (!provider) {
    issues.push("provider_missing");
  }
  if (!local && !allowHosted) {
    issues.push("hosted_approval_required");
  }
  if (supportsTools === false) {
    issues.push("tool_calling_unsupported");
  }
  if (!textInput) {
    issues.push("text_input_unsupported");
  }
  if (Number.isFinite(contextTokens) && contextTokens < MIN_CONTEXT_TOKENS) {
    issues.push("context_too_small");
  }
  if (Number.isFinite(outputTokens) && outputTokens < MIN_OUTPUT_TOKENS) {
    issues.push("output_too_small");
  }
  return {
    ok: issues.length === 0,
    issues,
    candidate,
    provider,
    resolvedModel,
    local,
    contextTokens: Number.isFinite(contextTokens) ? contextTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    supportsTools: supportsTools !== false,
    textInput,
    immutableIdentity: firstDefined(raw.digest, raw.revision, raw.sha256) ?? null,
  };
}

export function parseOllamaShow(model, stdout) {
  const text = String(stdout ?? "");
  const contextMatch = /context length\s+(\d+)/iu.exec(text);
  return {
    id: model,
    model,
    provider: "ollama",
    contextWindow: contextMatch ? Number(contextMatch[1]) : undefined,
    input: ["text"],
    compat: { supportsTools: /^\s*tools\s*$/imu.test(text) },
  };
}

export function parseOllamaList(model, stdout) {
  for (const line of String(stdout ?? "")
    .split(/\r?\n/u)
    .slice(1)) {
    const [name, digest] = line.trim().split(/\s+/u);
    if (name === model && /^[a-f0-9]{12,64}$/iu.test(digest ?? "")) {
      return digest;
    }
  }
  return null;
}

async function enrichOllamaIdentity(preflight, model, options, commandRunner) {
  if (!preflight.ok || preflight.provider !== "ollama" || preflight.immutableIdentity) {
    return preflight;
  }
  const listed = await commandRunner("ollama", ["list"], {
    env: commandEnv(options.configPath),
    timeoutMs: Math.min(options.timeout, 30) * 1000,
  });
  if (listed.code !== 0) {
    return preflight;
  }
  return { ...preflight, immutableIdentity: parseOllamaList(model, listed.stdout) };
}

async function inspectModel(options, commandRunner) {
  const result = await commandRunner(
    options.cli,
    ["infer", "model", "inspect", "--model", options.model, "--json"],
    { env: commandEnv(options.configPath), timeoutMs: options.timeout * 1000 },
  );
  if (result.code !== 0) {
    if (options.model.startsWith("ollama/")) {
      const ollamaModel = options.model.slice("ollama/".length);
      const fallback = await commandRunner("ollama", ["show", ollamaModel], {
        env: commandEnv(options.configPath),
        timeoutMs: options.timeout * 1000,
      });
      if (fallback.code === 0) {
        const preflight = preflightModel(
          options.model,
          parseOllamaShow(ollamaModel, fallback.stdout),
          { allowHosted: options.allowHosted },
        );
        return enrichOllamaIdentity(preflight, ollamaModel, options, commandRunner);
      }
    }
    return {
      ok: false,
      issues: ["model_inspect_failed"],
      stderr: redact(result.stderr).slice(0, 500),
    };
  }
  const payload = parseLastJsonValue(result.stdout);
  if (payload === null) {
    return { ok: false, issues: ["model_inspect_invalid_json"] };
  }
  const preflight = preflightModel(options.model, payload, { allowHosted: options.allowHosted });
  const ollamaModel = options.model.startsWith("ollama/")
    ? options.model.slice("ollama/".length)
    : preflight.resolvedModel;
  return enrichOllamaIdentity(preflight, ollamaModel, options, commandRunner);
}

async function runtimeVersion(options, commandRunner) {
  const result = await commandRunner(options.cli, ["--version"], {
    env: commandEnv(options.configPath),
    timeoutMs: Math.min(options.timeout, 30) * 1000,
  });
  return result.code === 0 ? redact(result.stdout).trim().slice(0, 200) : "unknown";
}

async function buildFingerprints(options, config, commandRunner) {
  const entry = resolveProgramManagerEntry(config, options.agent);
  const runtime = await runtimeVersion(options, commandRunner);
  return {
    roleContract: await hashFile(
      path.join(REPO_ROOT, "control/program-manager/workspace/AGENTS.md"),
    ),
    roleConfig: await hashFile(path.join(REPO_ROOT, "control/program-manager/runtime-config.json")),
    toolSchema: hashText(stableJson(entry.tools ?? null)),
    modelPolicy: hashText(stableJson(entry.params ?? null)),
    scenarioMatrix: hashText(stableJson(SCENARIOS)),
    runtime: hashText(runtime),
  };
}

function receiptName(model, generatedAt) {
  const safeTime = generatedAt.replace(/[:.]/gu, "-");
  return `${safeTime}-${hashText(model).slice(0, 16)}.json`;
}

async function ensureStateDir(stateDir) {
  await mkdir(path.join(stateDir, "receipts"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(stateDir, "transactions"), { recursive: true, mode: 0o700 });
}

async function assertRegularOrMissing(filePath) {
  try {
    const info = await lstat(filePath, { bigint: false });
    if (!info.isFile()) {
      throw new Error(`Refusing to replace non-file path: ${filePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function atomicWrite(filePath, text, mode = 0o600) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await assertRegularOrMissing(filePath);
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

async function writeJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

function syntheticBenchmarkReceipt(report) {
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    requestedModel: report.requestedModel,
    thinking: report.thinking,
    iterations: report.iterations,
    expectedTotal: report.expectedTotal,
    stoppedEarly: report.stoppedEarly,
    summary: report.summary,
    results: report.results.map((result) => ({
      scenario: result.scenario,
      ok: result.ok,
      issues: result.issues ?? [],
      elapsedMs: result.elapsedMs,
      exitCode: result.exitCode,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
    })),
  };
}

function qualificationPassed(report) {
  return (
    report?.summary?.total > 0 &&
    report.summary.total === (report.expectedTotal ?? report.summary.total) &&
    report.summary.failed === 0 &&
    report.summary.passRate === 1
  );
}

export async function qualifyModel(options, dependencies = {}) {
  const commandRunner = dependencies.runCommand ?? defaultRunCommand;
  const runBenchmark = dependencies.runBenchmark ?? executeContractMatrix;
  const now = dependencies.now?.() ?? new Date().toISOString();
  const config = await readConfig(options.configPath);
  const activeRoute = readModelRoute(resolveProgramManagerEntry(config, options.agent));
  const preflight = await inspectModel(options, commandRunner);
  if (!preflight.ok) {
    return { ok: false, changed: false, phase: "preflight", preflight, activeRoute };
  }
  await ensureStateDir(options.stateDir);
  const qualificationConfig = structuredClone(config);
  updateModelRoute(qualificationConfig, options.model, options.agent);
  resolveProgramManagerEntry(qualificationConfig, options.agent).params =
    structuredClone(PORTABLE_MODEL_PARAMS);
  const qualificationDirectory = path.join(options.stateDir, "qualifications");
  await mkdir(qualificationDirectory, { recursive: true, mode: 0o700 });
  const qualificationConfigPath = path.join(
    qualificationDirectory,
    `${process.pid}-${crypto.randomUUID()}.json`,
  );
  await writeJson(qualificationConfigPath, qualificationConfig);
  let report;
  try {
    report = await runBenchmark({
      live: true,
      cli: options.cli,
      configPath: qualificationConfigPath,
      agent: options.agent,
      model: options.model,
      thinking: "off",
      iterations: options.iterations,
      concurrency: 1,
      timeout: options.timeout,
      output: null,
      rssPid: null,
      failFast: true,
      scenarioIds: [],
      sessionPrefix: `program-manager-qualify-${process.pid}-${Date.now()}`,
    });
  } finally {
    await rm(qualificationConfigPath, { force: true });
  }
  const passed = qualificationPassed(report);
  const fingerprints = await buildFingerprints(options, qualificationConfig, commandRunner);
  const receipt = {
    schemaVersion: MODEL_RECEIPT_SCHEMA_VERSION,
    generatedAt: now,
    candidate: options.model,
    resolvedModel: preflight.resolvedModel,
    provider: preflight.provider,
    local: preflight.local,
    immutableIdentity: preflight.immutableIdentity,
    reusable: Boolean(preflight.immutableIdentity),
    effectiveParams: PORTABLE_MODEL_PARAMS,
    preflight,
    fingerprints,
    activeRouteBefore: activeRoute,
    benchmark: syntheticBenchmarkReceipt(report),
    qualified: passed,
  };
  const receiptPath = path.join(options.stateDir, "receipts", receiptName(options.model, now));
  await writeJson(receiptPath, receipt);
  return {
    ok: passed,
    changed: false,
    phase: "qualification",
    candidate: options.model,
    activeRoute,
    receiptPath,
    receipt,
  };
}

async function restartGateway(options, commandRunner) {
  const result = await commandRunner(options.cli, ["gateway", "restart"], {
    env: commandEnv(options.configPath),
    timeoutMs: options.timeout * 1000,
  });
  return {
    ok: result.code === 0,
    code: result.code,
    stdout: redact(result.stdout).slice(0, 500),
    stderr: redact(result.stderr).slice(0, 500),
  };
}

async function latestTransaction(stateDir) {
  const directory = path.join(stateDir, "transactions");
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const candidates = [];
  for (const name of names.filter(
    (value) => value.endsWith(".json") && !value.endsWith(".config.json"),
  )) {
    const filePath = path.join(directory, name);
    const value = parseJson(await readFile(filePath, "utf8"), filePath);
    candidates.push({ filePath, value });
  }
  const sortedCandidates = candidates.toSorted((left, right) =>
    String(right.value.createdAt).localeCompare(String(left.value.createdAt)),
  );
  return sortedCandidates[0] ?? null;
}

async function restoreTransaction(options, transaction, commandRunner, reason) {
  const backup = await readFile(transaction.backupPath, "utf8");
  await atomicWrite(options.configPath, backup, transaction.configMode ?? 0o600);
  const restart = await restartGateway(options, commandRunner);
  const updated = {
    ...transaction,
    state: restart.ok ? "rolled_back" : "rollback_restart_failed",
    rollbackReason: reason,
    rolledBackAt: new Date().toISOString(),
    rollbackRestart: restart,
  };
  await writeJson(transaction.transactionPath, updated);
  return { ok: restart.ok, transaction: updated, restart };
}

export async function switchModel(options, dependencies = {}) {
  const commandRunner = dependencies.runCommand ?? defaultRunCommand;
  const runBenchmark = dependencies.runBenchmark ?? executeContractMatrix;
  const qualification = await qualifyModel(options, {
    ...dependencies,
    runCommand: commandRunner,
    runBenchmark,
  });
  if (!qualification.ok) {
    return { ok: false, changed: false, phase: "qualification", qualification };
  }
  const originalText = await readFile(options.configPath, "utf8");
  const originalInfo = await stat(options.configPath);
  const config = parseJson(originalText, options.configPath);
  const route = updateModelRoute(config, options.model, options.agent);
  const targetEntry = resolveProgramManagerEntry(config, options.agent);
  const paramsAlreadyPortable =
    stableJson(targetEntry.params ?? null) === stableJson(PORTABLE_MODEL_PARAMS);
  targetEntry.params = structuredClone(PORTABLE_MODEL_PARAMS);
  if (route.before.primary === options.model && paramsAlreadyPortable) {
    return { ok: true, changed: false, phase: "already_active", qualification, route };
  }
  await ensureStateDir(options.stateDir);
  const createdAt = new Date().toISOString();
  const transactionId = `${createdAt.replace(/[:.]/gu, "-")}-${crypto.randomUUID()}`;
  const backupPath = path.join(options.stateDir, "transactions", `${transactionId}.config.json`);
  const transactionPath = path.join(options.stateDir, "transactions", `${transactionId}.json`);
  await atomicWrite(backupPath, originalText, 0o600);
  const transaction = {
    schemaVersion: 1,
    id: transactionId,
    createdAt,
    configPath: options.configPath,
    configMode: originalInfo.mode & 0o777,
    backupPath,
    transactionPath,
    state: "prepared",
    beforeRoute: route.before,
    afterRoute: route.after,
    effectiveParams: PORTABLE_MODEL_PARAMS,
    qualificationReceipt: qualification.receiptPath,
  };
  await writeJson(transactionPath, transaction);
  try {
    await atomicWrite(
      options.configPath,
      `${JSON.stringify(config, null, 2)}\n`,
      transaction.configMode,
    );
    const restart = await restartGateway(options, commandRunner);
    if (!restart.ok) {
      const rollback = await restoreTransaction(
        options,
        transaction,
        commandRunner,
        "activation_restart_failed",
      );
      return {
        ok: false,
        changed: false,
        phase: "activation_restart",
        restart,
        rollback,
        qualification,
      };
    }
    const smoke = await runBenchmark({
      live: true,
      cli: options.cli,
      configPath: options.configPath,
      agent: options.agent,
      model: options.model,
      thinking: "off",
      iterations: 1,
      concurrency: 1,
      timeout: options.timeout,
      output: null,
      rssPid: null,
      failFast: true,
      scenarioIds: [],
      sessionPrefix: `program-manager-post-activation-${process.pid}-${Date.now()}`,
    });
    if (!qualificationPassed(smoke)) {
      const rollback = await restoreTransaction(
        options,
        transaction,
        commandRunner,
        "post_activation_contract_failed",
      );
      return {
        ok: false,
        changed: false,
        phase: "post_activation",
        smoke: syntheticBenchmarkReceipt(smoke),
        rollback,
        qualification,
      };
    }
    const completed = {
      ...transaction,
      state: "active",
      activatedAt: new Date().toISOString(),
      restart,
      postActivation: syntheticBenchmarkReceipt(smoke),
    };
    await writeJson(transactionPath, completed);
    return {
      ok: true,
      changed: true,
      phase: "active",
      route,
      transaction: completed,
      qualification,
    };
  } catch (error) {
    const rollback = await restoreTransaction(
      options,
      transaction,
      commandRunner,
      `exception:${redact(error?.message ?? error)}`,
    );
    return {
      ok: false,
      changed: false,
      phase: "exception",
      error: redact(error?.message ?? error),
      rollback,
      qualification,
    };
  }
}

async function latestReceipt(stateDir, model) {
  const directory = path.join(stateDir, "receipts");
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const candidates = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    const filePath = path.join(directory, name);
    const value = parseJson(await readFile(filePath, "utf8"), filePath);
    if (value.candidate === model) {
      candidates.push({ filePath, value });
    }
  }
  const sortedCandidates = candidates.toSorted((left, right) =>
    String(right.value.generatedAt).localeCompare(String(left.value.generatedAt)),
  );
  return sortedCandidates[0] ?? null;
}

export async function statusModel(options, dependencies = {}) {
  const commandRunner = dependencies.runCommand ?? defaultRunCommand;
  const config = await readConfig(options.configPath);
  const route = readModelRoute(resolveProgramManagerEntry(config, options.agent));
  const fingerprints = await buildFingerprints(options, config, commandRunner);
  const latest = await latestReceipt(options.stateDir, route.primary);
  const currentPreflight = await inspectModel(
    { ...options, model: route.primary, allowHosted: true },
    commandRunner,
  );
  const identityMatches =
    Boolean(latest?.value?.immutableIdentity) &&
    latest.value.immutableIdentity === currentPreflight.immutableIdentity;
  const receiptMatches =
    latest?.value?.qualified === true &&
    latest.value.reusable === true &&
    currentPreflight.ok === true &&
    identityMatches &&
    stableJson(latest.value.fingerprints) === stableJson(fingerprints);
  const transaction = await latestTransaction(options.stateDir);
  return {
    ok: true,
    activeRoute: route,
    qualified: receiptMatches,
    drift: latest ? !receiptMatches : true,
    currentIdentity: currentPreflight.ok
      ? {
          provider: currentPreflight.provider,
          resolvedModel: currentPreflight.resolvedModel,
          immutableIdentity: currentPreflight.immutableIdentity,
        }
      : { issues: currentPreflight.issues },
    latestReceipt: latest
      ? {
          path: latest.filePath,
          generatedAt: latest.value.generatedAt,
          candidate: latest.value.candidate,
          qualified: latest.value.qualified,
          reusable: latest.value.reusable,
        }
      : null,
    latestTransaction: transaction
      ? {
          path: transaction.filePath,
          createdAt: transaction.value.createdAt,
          state: transaction.value.state,
          beforeRoute: transaction.value.beforeRoute,
          afterRoute: transaction.value.afterRoute,
        }
      : null,
    fingerprints,
  };
}

export async function rollbackModel(options, dependencies = {}) {
  const commandRunner = dependencies.runCommand ?? defaultRunCommand;
  const latest = await latestTransaction(options.stateDir);
  if (!latest) {
    return { ok: false, changed: false, phase: "no_transaction" };
  }
  if (!latest.value.backupPath) {
    return { ok: false, changed: false, phase: "invalid_transaction" };
  }
  const transaction = { ...latest.value, transactionPath: latest.filePath };
  const restored = await restoreTransaction(
    options,
    transaction,
    commandRunner,
    "operator_requested",
  );
  return { ...restored, changed: restored.ok, phase: "rollback" };
}

export async function runCommand(options, dependencies = {}) {
  if (options.command === "qualify") {
    return qualifyModel(options, dependencies);
  }
  if (options.command === "switch") {
    return switchModel(options, dependencies);
  }
  if (options.command === "status") {
    return statusModel(options, dependencies);
  }
  return rollbackModel(options, dependencies);
}

function usage() {
  return [
    "Usage: node scripts/program-manager-model.mjs <command> [options]",
    "",
    "Commands:",
    "  qualify --model <provider/model>   Run isolated preflight and the 3x contract matrix.",
    "  switch --model <provider/model>    Qualify, atomically promote, verify, or roll back.",
    "  status                             Report the active route and qualification drift.",
    "  rollback                           Restore the latest pre-switch configuration.",
    "",
    "Options: --config <path> --state-dir <path> --cli <path> --agent <id>",
    "         --iterations <n> --timeout <sec> --allow-hosted --json",
    "",
    "Hosted qualification requires explicit --allow-hosted and operator approval for any cost/data transfer.",
  ].join("\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
    } else {
      const result = await runCommand(options);
      process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
      if (!result.ok) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    process.stderr.write(`${redact(error?.message ?? String(error))}\n`);
    process.exitCode = 1;
  }
}

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { probeLocalLlamaCppGlmRuntime } from "./snes-local-model-benchmark.mjs";

const DEFAULT_AGENT = "snes-hardware-qa";
const DEFAULT_ARTIFACT_DIR = ".artifacts/glm52-local-runtime";
const DEFAULT_BASE_URL = "http://127.0.0.1:28080";
const DEFAULT_CONTEXT_SIZE = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 256;
const DEFAULT_MODEL_ID = "GLM-5.2-UD-IQ1_S-00001-of-00006.gguf";
const DEFAULT_PORT = 28080;
const DEFAULT_PROVIDER_ID = "local-glm52";
const GLM_BENCHMARK_REF = "local-glm-5.2-2bit";
const SAFE_PATCH_PREFIXES = [
  "/gamePlan",
  "/scenes",
  "/settings",
  "/assets",
  "/audio",
  "/levels",
  "/hardwareQa",
];

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/u, "");
}

function boundedInteger(value, fallback, { min, max, name }) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function shortHash(value) {
  return createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex")
    .slice(0, 16);
}

function extractJson(value) {
  if (isRecord(value) || Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function findRecord(value, predicate, depth = 0) {
  if (depth > 8) {
    return null;
  }
  const parsed = typeof value === "string" ? extractJson(value) : value;
  if (isRecord(parsed) && predicate(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findRecord(item, predicate, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (isRecord(parsed)) {
    for (const child of Object.values(parsed)) {
      const found = findRecord(child, predicate, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function writeJsonReceipt(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tempPath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeLatestArtifact(artifactDir, report) {
  const resolved = path.resolve(artifactDir || DEFAULT_ARTIFACT_DIR);
  mkdirSync(resolved, { recursive: true });
  const stamped = path.join(resolved, `${report.generatedAt.replace(/[:.]/gu, "-")}.json`);
  writeJsonReceipt(stamped, report);
  writeJsonReceipt(path.join(resolved, "latest.json"), report);
  return { artifactDir: resolved, latestPath: path.join(resolved, "latest.json") };
}

function defaultConfigPath() {
  return process.env.OPENCLAW_CONFIG_PATH ?? path.join(homedir(), ".openclaw", "openclaw.json");
}

function readConfig(configPath) {
  if (!existsSync(configPath)) {
    return { config: {}, raw: null };
  }
  const raw = readFileSync(configPath, "utf8");
  const config = JSON5.parse(raw);
  if (!isRecord(config)) {
    throw new Error("OpenClaw config root must be an object");
  }
  return { config, raw };
}

function writeConfigAtomically(configPath, config, rawBefore) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  const stamp = nowIso().replace(/[:.]/gu, "-");
  let backupPath = null;
  let mode = 0o600;
  if (rawBefore !== null && existsSync(configPath)) {
    mode = statSync(configPath).mode & 0o777;
    const backupDir = path.join(path.dirname(configPath), "backups", "glm52-runtime");
    mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `openclaw-${stamp}.json`);
    copyFileSync(configPath, backupPath);
    chmodSync(backupPath, mode);
  }
  const tempPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tempPath, "wx", mode);
  try {
    writeFileSync(fd, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tempPath, mode);
  renameSync(tempPath, configPath);
  return { backupCreated: Boolean(backupPath), configPath };
}

function processCommand(spawnSyncFn, pid) {
  const ps = spawnSyncFn("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" });
  if (!ps?.error && ps?.status === 0 && asText(ps.stdout).trim()) {
    return asText(ps.stdout).trim();
  }
  const lsof = spawnSyncFn("lsof", ["-nP", "-p", pid, "-a", "-d", "txt", "-F", "cn"], {
    encoding: "utf8",
  });
  if (lsof?.error || lsof?.status !== 0) {
    return "";
  }
  const command = asText(lsof.stdout)
    .split(/\r?\n/u)
    .find((line) => line.startsWith("c"));
  return command ? command.slice(1).trim() : "";
}

function isLlamaServerCommand(command) {
  return /(?:^|[/\s])llama-server(?:\s|$)/u.test(command);
}

export function safeStopGlm52Runtime({ port = DEFAULT_PORT, spawnSyncFn = spawnSync } = {}) {
  const listener = spawnSyncFn("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  if (listener?.error || (listener?.status !== 0 && !asText(listener?.stdout).trim())) {
    return { ok: true, port, refused: [], stopped: [] };
  }
  const pids = [
    ...new Set(
      asText(listener.stdout)
        .split(/\s+/u)
        .filter((pid) => /^\d+$/u.test(pid)),
    ),
  ];
  const stopped = [];
  const refused = [];
  for (const pid of pids) {
    const command = processCommand(spawnSyncFn, pid);
    if (!isLlamaServerCommand(command)) {
      refused.push({
        command: command || "unknown",
        pid: Number(pid),
        reason: "port owner is not llama-server",
      });
      continue;
    }
    const killed = spawnSyncFn("kill", ["-TERM", pid], { encoding: "utf8" });
    if (killed?.error || killed?.status !== 0) {
      refused.push({
        command: "llama-server",
        pid: Number(pid),
        reason: asText(killed?.stderr).trim() || "llama-server could not be stopped",
      });
      continue;
    }
    stopped.push({ command: "llama-server", pid: Number(pid), signal: "TERM" });
  }
  return { ok: refused.length === 0, port, refused, stopped };
}

function assertLoopbackHost(host) {
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("GLM runtime host must be loopback-only");
  }
}

function defaultRunContext(artifactDir, profileId) {
  const stamp = nowIso().replace(/[:.]/gu, "-");
  return {
    baseUrl: DEFAULT_BASE_URL,
    runDir: path.resolve(artifactDir || DEFAULT_ARTIFACT_DIR, "runs", `${stamp}-${profileId}`),
    stamp,
  };
}

export function startGlm52Runtime(options, profile, dependencies = {}) {
  const spawnFn = dependencies.spawnFn ?? spawn;
  const spawnSyncFn = dependencies.spawnSyncFn ?? spawnSync;
  const host = options.host ?? "127.0.0.1";
  const port = boundedInteger(options.port, DEFAULT_PORT, {
    min: 1024,
    max: 65535,
    name: "port",
  });
  assertLoopbackHost(host);
  if (!options.modelPath || !existsSync(options.modelPath)) {
    return { blocker: "GLM-5.2 model file does not exist", ok: false, profile: profile.id };
  }
  if (!dependencies.skipStop) {
    const stopped = safeStopGlm52Runtime({ port, spawnSyncFn });
    if (!stopped.ok) {
      return {
        blocker: stopped.refused[0]?.reason ?? "GLM runtime port is occupied",
        ok: false,
        profile: profile.id,
        stopped,
      };
    }
  }
  const context = dependencies.context ?? defaultRunContext(options.artifactDir, profile.id);
  mkdirSync(context.runDir, { recursive: true });
  const stdoutPath = path.join(context.runDir, "llama-server.stdout.log");
  const stderrPath = path.join(context.runDir, "llama-server.stderr.log");
  const stdoutFd = openSync(stdoutPath, "a", 0o600);
  const stderrFd = openSync(stderrPath, "a", 0o600);
  const args = [
    "--model",
    path.resolve(options.modelPath),
    "--host",
    host,
    "--port",
    String(port),
    "--ctx-size",
    String(profile.contextSize ?? options.contextSize ?? DEFAULT_CONTEXT_SIZE),
    ...(profile.args ?? []),
  ];
  let child;
  try {
    child = spawnFn(options.llamaServer ?? "llama-server", args, {
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (!child || !Number.isInteger(child.pid)) {
    return { blocker: "llama-server did not return a process id", ok: false, profile: profile.id };
  }
  child.unref?.();
  const processReceipt = {
    args,
    command: options.llamaServer ?? "llama-server",
    generatedAt: nowIso(),
    host,
    modelPath: path.resolve(options.modelPath),
    pid: child.pid,
    port,
    profile: profile.id,
    stderrPath,
    stdoutPath,
  };
  writeJsonReceipt(path.join(context.runDir, "runtime-process.json"), processReceipt);
  return { ...processReceipt, baseUrl: `http://${host}:${port}`, ok: true, runDir: context.runDir };
}

function runtimeProfiles(contextSize) {
  const kvArgs = ["--flash-attn", "on", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0"];
  return [
    { args: kvArgs, contextSize, id: "metal-low" },
    { args: [...kvArgs, "--no-mmap"], contextSize, id: "metal-no-mmap" },
    {
      args: ["-ngl", "0", "--threads", "8"],
      contextSize: Math.min(contextSize, 4096),
      id: "cpu-safe",
    },
  ];
}

function memorySnapshot(spawnSyncFn) {
  const vm = spawnSyncFn("vm_stat", [], { encoding: "utf8" });
  return {
    available: !vm?.error && vm?.status === 0,
    outputHash: shortHash(asText(vm?.stdout)),
  };
}

function serverVersion(llamaServer, spawnSyncFn) {
  const result = spawnSyncFn(llamaServer, ["--version"], { encoding: "utf8" });
  return {
    available: !result?.error && result?.status === 0,
    output: asText(result?.stdout).trim().slice(0, 300),
  };
}

function probeRuntime(options, spawnSyncFn) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? `http://${options.host ?? "127.0.0.1"}:${options.port ?? DEFAULT_PORT}`,
  );
  const diagnostic = probeLocalLlamaCppGlmRuntime(spawnSyncFn, {
    baseUrl,
    maxOutputTokens: options.maxOutputTokens ?? 32,
    timeoutSeconds: options.timeoutSeconds ?? 30,
  });
  return {
    ...diagnostic,
    modelFilesPresent: Boolean(options.modelPath && existsSync(options.modelPath)),
  };
}

export function parseGlm52RuntimeArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  while (args[0] === "--") {
    args.shift();
  }
  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "status";
  const result = {
    agent: DEFAULT_AGENT,
    artifactDir: DEFAULT_ARTIFACT_DIR,
    command,
    configPath: defaultConfigPath(),
    contextSize: DEFAULT_CONTEXT_SIZE,
    host: "127.0.0.1",
    json: false,
    llamaServer: process.env.OPENCLAW_LOCAL_GLM52_LLAMA_SERVER ?? "llama-server",
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    modelId: DEFAULT_MODEL_ID,
    modelPath: process.env.OPENCLAW_LOCAL_GLM52_MODEL_PATH ?? "",
    port: DEFAULT_PORT,
    providerId: DEFAULT_PROVIDER_ID,
    providerTimeoutSeconds: 900,
    settleMs: 3000,
    timeoutSeconds: 30,
    verifyDurationSeconds: 300,
    verifyIntervalSeconds: 15,
  };
  const valueFlags = new Map([
    ["--agent", "agent"],
    ["--artifact-dir", "artifactDir"],
    ["--config", "configPath"],
    ["--host", "host"],
    ["--llama-server", "llamaServer"],
    ["--model", "modelPath"],
    ["--model-id", "modelId"],
    ["--provider", "providerId"],
  ]);
  const numberFlags = new Map([
    ["--context", ["contextSize", 512, 131072]],
    ["--duration-seconds", ["verifyDurationSeconds", 1, 86400]],
    ["--interval-seconds", ["verifyIntervalSeconds", 1, 3600]],
    ["--max-output-tokens", ["maxOutputTokens", 1, 8192]],
    ["--port", ["port", 1024, 65535]],
    ["--provider-timeout", ["providerTimeoutSeconds", 1, 3600]],
    ["--settle-ms", ["settleMs", 0, 120000]],
    ["--timeout", ["timeoutSeconds", 1, 3600]],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") {
      result.json = true;
      continue;
    }
    if (valueFlags.has(flag)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      result[valueFlags.get(flag)] = value;
      index += 1;
      continue;
    }
    if (numberFlags.has(flag)) {
      const value = args[index + 1];
      const [key, min, max] = numberFlags.get(flag);
      result[key] = boundedInteger(value, result[key], { min, max, name: flag });
      index += 1;
      continue;
    }
    throw new Error(`unknown GLM runtime argument: ${flag}`);
  }
  assertLoopbackHost(result.host);
  return result;
}

export function buildGlm52LocalProviderConfig({
  baseUrl = DEFAULT_BASE_URL,
  contextSize = DEFAULT_CONTEXT_SIZE,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  modelId = DEFAULT_MODEL_ID,
  providerTimeoutSeconds = 900,
} = {}) {
  return {
    api: "openai-completions",
    apiKey: "openclaw-local-glm52",
    baseUrl: `${normalizeBaseUrl(baseUrl)}/v1`,
    models: [
      {
        compat: {
          requiresStringContent: true,
          supportsStrictMode: false,
          supportsTools: false,
        },
        contextWindow: contextSize,
        id: modelId,
        maxTokens: maxOutputTokens,
        name: "Local GLM-5.2",
        reasoning: false,
      },
    ],
    request: { allowPrivateNetwork: true },
    timeoutSeconds: providerTimeoutSeconds,
  };
}

export function localGlm52ProviderModelRef(
  modelId = DEFAULT_MODEL_ID,
  providerId = DEFAULT_PROVIDER_ID,
) {
  return `${providerId}/${modelId}`;
}

export function determineGlm52BenchmarkPromotions(report, options = {}) {
  if (!isRecord(report)) {
    return { blocker: "benchmark report is missing", promotions: [] };
  }
  if (report.hostedGlmUsed === true) {
    return {
      blocker: "benchmark used hosted GLM and cannot authorize local promotion",
      promotions: [],
    };
  }
  if (report.downloadsAttempted === true) {
    return {
      blocker: "benchmark attempted downloads and cannot authorize promotion",
      promotions: [],
    };
  }
  const roles = options.roles ?? [DEFAULT_AGENT];
  const modelRef = localGlm52ProviderModelRef(options.modelId, options.providerId);
  const summaries = Array.isArray(report.modelSummaries) ? report.modelSummaries : [];
  const promotions = [];
  for (const role of roles) {
    if (report.recommendedWinnersByRole?.[role] !== GLM_BENCHMARK_REF) {
      continue;
    }
    const recommendation = report.promotionRecommendationsByRole?.[role];
    if (recommendation && recommendation.readyToPromote === false) {
      continue;
    }
    const summary = summaries.find(
      (entry) => entry?.role === role && entry?.modelRef === GLM_BENCHMARK_REF,
    );
    if (
      summary &&
      (Number(summary.availableRuns ?? 0) < 1 ||
        Number(summary.blockedRuns ?? 0) > 0 ||
        Number(summary.failedRuns ?? 0) > 0 ||
        Number(summary.invalidJsonRuns ?? 0) > 0)
    ) {
      continue;
    }
    const previous = report.currentDefaultsByRole?.[role] ?? recommendation?.currentDefault;
    promotions.push({
      agentId: role,
      model: {
        fallbacks: previous && previous !== modelRef ? [previous] : [],
        primary: modelRef,
      },
    });
  }
  return {
    blocker:
      promotions.length > 0
        ? null
        : "local GLM-5.2 is not a clean benchmark winner for the requested roles",
    promotions,
  };
}

export function buildPromotedAgentsList(agents, promotions) {
  const byId = new Map((promotions ?? []).map((entry) => [entry.agentId, entry]));
  const result = (Array.isArray(agents) ? agents : []).map((agent) => {
    const promotion = byId.get(agent?.id);
    if (!promotion) {
      return agent;
    }
    byId.delete(agent.id);
    return Object.assign({}, agent, { model: promotion.model });
  });
  for (const promotion of byId.values()) {
    result.push({ id: promotion.agentId, model: promotion.model });
  }
  return result;
}

function isSafeProofPatch(patchValue) {
  return (
    Array.isArray(patchValue) &&
    patchValue.length > 0 &&
    patchValue.every(
      (operation) =>
        isRecord(operation) &&
        ["add", "remove", "replace"].includes(operation.op) &&
        typeof operation.path === "string" &&
        SAFE_PATCH_PREFIXES.some(
          (prefix) => operation.path === prefix || operation.path.startsWith(`${prefix}/`),
        ),
    )
  );
}

export function scoreGlm52AgentProof(raw) {
  const proof = findRecord(
    raw,
    (record) =>
      record.role === "snes-hardware-qa" ||
      (typeof record.changedSurface === "string" && Array.isArray(record.patch)),
  );
  if (!proof) {
    return {
      blockers: ["agent proof did not contain parseable JSON"],
      ok: false,
      proof: null,
      score: 0,
    };
  }
  const blockers = [];
  if (proof.role !== "snes-hardware-qa") {
    blockers.push("agent proof used the wrong SNES role");
  }
  const content = asText(proof.content).toLowerCase();
  const requiredSignals = [
    "rom",
    "sram",
    "vram",
    "cgram",
    "aram",
    "fxpak",
    "superfx",
    "checksum",
    "fat32",
  ];
  if (requiredSignals.some((signal) => !content.includes(signal))) {
    blockers.push("agent proof is missing required SNES hardware signals");
  }
  if (!Array.isArray(proof.constraintsRespected) || proof.constraintsRespected.length < 2) {
    blockers.push("agent proof is missing respected constraints");
  }
  if (!asText(proof.playtestHypothesis).trim()) {
    blockers.push("agent proof is missing a playtest hypothesis");
  }
  if (!isSafeProofPatch(proof.patch)) {
    blockers.push("missing or unsafe SNES Studio patch");
  }
  if (!Array.isArray(proof.receipt) || proof.receipt.length < 2) {
    blockers.push("agent proof is missing receipt evidence");
  }
  return {
    blockers,
    ok: blockers.length === 0,
    proof,
    score: blockers.length === 0 ? 100 : Math.max(0, 100 - blockers.length * 25),
  };
}

function findAgentMeta(value) {
  return findRecord(
    value,
    (record) => typeof record.provider === "string" && typeof record.model === "string",
  );
}

export function runGlm52AgentProof(options = {}, dependencies = {}) {
  const spawnSyncFn = dependencies.spawnSyncFn ?? spawnSync;
  const agent = options.agent ?? DEFAULT_AGENT;
  const providerId = options.providerId ?? DEFAULT_PROVIDER_ID;
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const sessionId = options.proofSessionId ?? `glm52-proof-${Date.now()}`;
  const prompt = [
    "Return strict JSON only for an SNES hardware QA receipt.",
    "Include role, changedSurface, content, constraintsRespected, playtestHypothesis, riskBlocker, patch, and receipt.",
    "Use only safe SNES Studio patch paths under /settings, /scenes, /assets, /audio, /levels, /hardwareQa, or /gamePlan.",
    "Cover ROM SRAM VRAM CGRAM ARAM FXPAK SuperFX checksum and FAT32.",
  ].join(" ");
  const args = [
    "openclaw",
    "agent",
    "--agent",
    agent,
    "--session-id",
    sessionId,
    "--message",
    prompt,
    "--json",
    "--timeout",
    String(options.timeoutSeconds ?? 600),
  ];
  const result = spawnSyncFn("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: (options.timeoutSeconds ?? 600) * 1000,
  });
  const parsed = extractJson(asText(result?.stdout));
  const proof = scoreGlm52AgentProof(parsed ?? asText(result?.stdout));
  const agentMeta = findAgentMeta(parsed);
  const usedLocalGlm =
    agentMeta?.provider === providerId &&
    (agentMeta?.model === modelId ||
      agentMeta?.model === localGlm52ProviderModelRef(modelId, providerId));
  const blocker = result?.error
    ? result.error.message
    : result?.status !== 0
      ? asText(result?.stderr).trim() || "OpenClaw agent proof command failed"
      : !usedLocalGlm
        ? "agent proof did not use local GLM-5.2"
        : !proof.ok
          ? proof.blockers.join("; ")
          : null;
  const report = {
    agent,
    blocker,
    generatedAt: nowIso(),
    modelId,
    ok: !blocker,
    proof,
    providerId,
    runtimeModel: agentMeta ? { model: agentMeta.model, provider: agentMeta.provider } : null,
    sessionId,
    status: blocker ? "blocked" : "pass",
  };
  if (options.proofArtifactDir) {
    writeLatestArtifact(options.proofArtifactDir, report);
  }
  return report;
}

function registerProvider(options) {
  const { config, raw } = readConfig(options.configPath ?? defaultConfigPath());
  const models = isRecord(config.models) ? { ...config.models } : {};
  const providers = isRecord(models.providers) ? { ...models.providers } : {};
  providers[options.providerId ?? DEFAULT_PROVIDER_ID] = buildGlm52LocalProviderConfig({
    baseUrl: options.baseUrl ?? `http://${options.host}:${options.port}`,
    contextSize: options.contextSize,
    maxOutputTokens: options.maxOutputTokens,
    modelId: options.modelId,
    providerTimeoutSeconds: options.providerTimeoutSeconds,
  });
  config.models = { ...models, providers };
  const receipt = writeConfigAtomically(options.configPath ?? defaultConfigPath(), config, raw);
  return {
    ...receipt,
    ok: true,
    providerId: options.providerId ?? DEFAULT_PROVIDER_ID,
    status: "pass",
  };
}

function promoteBenchmarkWinners(options) {
  const benchmarkPath = path.resolve(
    options.benchmarkPath ?? ".artifacts/snes-real-output-model-benchmark/latest.json",
  );
  const report = readJsonIfPresent(benchmarkPath);
  const plan = determineGlm52BenchmarkPromotions(report, {
    modelId: options.modelId,
    providerId: options.providerId,
    roles: [options.agent ?? DEFAULT_AGENT],
  });
  if (plan.blocker) {
    return { ...plan, ok: false, status: "blocked" };
  }
  const { config, raw } = readConfig(options.configPath ?? defaultConfigPath());
  const agents = isRecord(config.agents) ? { ...config.agents } : {};
  agents.list = buildPromotedAgentsList(agents.list, plan.promotions);
  config.agents = agents;
  const receipt = writeConfigAtomically(options.configPath ?? defaultConfigPath(), config, raw);
  return { ...receipt, ...plan, ok: true, status: "pass" };
}

function runtimeStatus(options, spawnSyncFn) {
  const diagnostic = probeRuntime(options, spawnSyncFn);
  const benchmark = readJsonIfPresent(
    path.resolve(
      options.benchmarkPath ?? ".artifacts/snes-real-output-model-benchmark/latest.json",
    ),
  );
  const proof = readJsonIfPresent(
    path.resolve(options.proofArtifactDir ?? ".artifacts/glm52-agent-proof", "latest.json"),
  );
  let providerConfigured;
  let hardwareQaPromoted;
  try {
    const { config } = readConfig(options.configPath ?? defaultConfigPath());
    providerConfigured = Boolean(
      config.models?.providers?.[options.providerId ?? DEFAULT_PROVIDER_ID],
    );
    const agent = Array.isArray(config.agents?.list)
      ? config.agents.list.find((entry) => entry?.id === (options.agent ?? DEFAULT_AGENT))
      : null;
    const primary = typeof agent?.model === "string" ? agent.model : agent?.model?.primary;
    hardwareQaPromoted =
      primary === localGlm52ProviderModelRef(options.modelId, options.providerId);
  } catch {
    providerConfigured = false;
    hardwareQaPromoted = false;
  }
  const benchmarkPlan = determineGlm52BenchmarkPromotions(benchmark, {
    modelId: options.modelId,
    providerId: options.providerId,
    roles: [options.agent ?? DEFAULT_AGENT],
  });
  const ok =
    diagnostic.decodeReady && providerConfigured && hardwareQaPromoted && proof?.ok === true;
  return {
    agentProofReady: proof?.ok === true,
    benchmarkRecommendsHardwareQa: !benchmarkPlan.blocker,
    blocker: ok
      ? null
      : [
          diagnostic.blocker,
          providerConfigured ? null : "local-glm52 provider is not registered",
          hardwareQaPromoted ? null : "SNES hardware QA agent is not promoted to local GLM-5.2",
          proof?.ok === true ? null : "local GLM-5.2 agent proof is missing or blocked",
        ]
          .filter(Boolean)
          .join("; "),
    diagnostic,
    hardwareQaPromoted,
    ok,
    providerConfigured,
    status: ok ? "pass" : "blocked",
  };
}

export async function runGlm52Runtime(options, dependencies = {}) {
  const spawnFn = dependencies.spawnFn ?? spawn;
  const spawnSyncFn = dependencies.spawnSyncFn ?? spawnSync;
  const sleep =
    dependencies.sleep ??
    ((ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const generatedAt = nowIso();
  let report;
  if (options.command === "stop") {
    const stopped = safeStopGlm52Runtime({ port: options.port, spawnSyncFn });
    report = { ...stopped, generatedAt, status: stopped.ok ? "pass" : "blocked" };
  } else if (options.command === "probe") {
    const diagnostic = probeRuntime(options, spawnSyncFn);
    report = {
      diagnostic,
      generatedAt,
      memory: memorySnapshot(spawnSyncFn),
      ok: diagnostic.decodeReady,
      serverVersion: serverVersion(options.llamaServer, spawnSyncFn),
      status: diagnostic.decodeReady ? "pass" : "blocked",
    };
  } else if (options.command === "start") {
    const profile = runtimeProfiles(options.contextSize)[0];
    const started = startGlm52Runtime(options, profile, { spawnFn, spawnSyncFn });
    report = { ...started, generatedAt, status: started.ok ? "pass" : "blocked" };
  } else if (options.command === "repair") {
    const attempts = [];
    let selected = null;
    for (const profile of runtimeProfiles(options.contextSize)) {
      const stopped = safeStopGlm52Runtime({ port: options.port, spawnSyncFn });
      if (!stopped.ok) {
        attempts.push({
          blocker: stopped.refused[0]?.reason,
          profile: profile.id,
          status: "blocked",
        });
        break;
      }
      const started = startGlm52Runtime(options, profile, {
        skipStop: true,
        spawnFn,
        spawnSyncFn,
      });
      if (!started.ok) {
        attempts.push({ blocker: started.blocker, profile: profile.id, status: "blocked" });
        continue;
      }
      await sleep(options.settleMs ?? 3000);
      const diagnostic = probeRuntime(options, spawnSyncFn);
      attempts.push({
        diagnostic,
        profile: profile.id,
        started,
        status: diagnostic.decodeReady ? "pass" : "blocked",
      });
      if (diagnostic.decodeReady) {
        selected = { diagnostic, profile: profile.id, started };
        break;
      }
      safeStopGlm52Runtime({ port: options.port, spawnSyncFn });
    }
    report = {
      attempts,
      blocker: selected
        ? null
        : (attempts.at(-1)?.diagnostic?.blocker ??
          attempts.at(-1)?.blocker ??
          "no GLM repair profile decoded successfully"),
      diagnostic: selected?.diagnostic ?? attempts.at(-1)?.diagnostic ?? { decodeReady: false },
      generatedAt,
      ok: Boolean(selected),
      profile: selected?.profile ?? null,
      status: selected ? "pass" : "blocked",
    };
  } else if (options.command === "verify-durable") {
    const probes = [];
    const startedAt = Date.now();
    const durationMs = options.verifyDurationSeconds * 1000;
    do {
      probes.push({ checkedAt: nowIso(), diagnostic: probeRuntime(options, spawnSyncFn) });
      if (Date.now() - startedAt >= durationMs) {
        break;
      }
      await sleep(options.verifyIntervalSeconds * 1000);
    } while (Date.now() - startedAt <= durationMs);
    const ok = probes.length > 0 && probes.every((entry) => entry.diagnostic.decodeReady);
    report = { generatedAt, ok, probes, status: ok ? "pass" : "blocked" };
  } else if (options.command === "register-provider") {
    report = { ...registerProvider(options), generatedAt };
  } else if (options.command === "promote-winners") {
    report = { ...promoteBenchmarkWinners(options), generatedAt };
  } else if (options.command === "agent-proof") {
    report = runGlm52AgentProof(options, { spawnSyncFn });
  } else if (options.command === "status") {
    report = { ...runtimeStatus(options, spawnSyncFn), generatedAt };
  } else {
    throw new Error(`unsupported GLM runtime command: ${options.command}`);
  }
  if (options.artifactDir && options.command !== "agent-proof") {
    Object.assign(report, writeLatestArtifact(options.artifactDir, report));
  }
  return report;
}

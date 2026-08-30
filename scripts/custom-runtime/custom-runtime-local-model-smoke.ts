import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireExclusiveLocalModelAdmission,
  LocalModelAdmissionError,
  type LocalModelAdmissionLease,
  type LocalModelResourceSnapshot,
} from "../../src/agents/local-model-admission.js";
import { proofProfileVersion } from "../../src/pcc/release-governance/browser-proof-contract.js";
import {
  createReleaseLocalModelCompatibilityReceipt,
  RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE,
} from "../../src/pcc/release-governance/local-proof.js";

export const LOCAL_MODEL_COMPATIBILITY_MODEL = "qwen3.6:27b-q8_0" as const;
export const LOCAL_MODEL_COMPATIBILITY_TIMEOUT_MS = 180_000;
export const LOCAL_MODEL_COMPATIBILITY_WAIT_MS = 30 * 60 * 1_000;
export const LOCAL_MODEL_COMPATIBILITY_SAMPLE_INTERVAL_MS = 5_000;
export const LOCAL_MODEL_COMPATIBILITY_AGENT_ID = "patternlab-runtime-smoke" as const;
const MAX_CAPTURE_BYTES = 64 * 1024;
const EVIDENCE_TAIL_BYTES = 4_000;
const MAX_PROBE_BYTES = 128 * 1024;
const PROCESS_CLEANUP_GRACE_MS = 2_000;
const ADMISSION_RELEASE_TIMEOUT_MS = 5_000;
const EXECUTION_MONITOR_INTERVAL_MS = 1_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

type ReadOnlyExecutor = (
  command: string,
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => string | Buffer;

function executeReadOnly(
  command: string,
  args: string[],
  options: Parameters<ReadOnlyExecutor>[2],
): string | Buffer {
  return execFileSync(command, args, options) as string | Buffer;
}

export type CompatibilitySmokeFailureCode =
  | "probe_unavailable"
  | "probe_overflow"
  | "resource_contention"
  | "resource_contention_during_execution"
  | "smoke_timeout"
  | "smoke_warning"
  | "smoke_response_mismatch"
  | "leftover_child"
  | "receipt_write_failed";

class CompatibilitySmokeError extends Error {
  readonly code: CompatibilitySmokeFailureCode;

  constructor(code: CompatibilitySmokeFailureCode, message: string) {
    super(message);
    this.name = "CompatibilitySmokeError";
    this.code = code;
  }
}

type SmokeIdentity = {
  runtimeRoot: string;
  releaseId: string;
  sourceCommit: string;
  sourceSha256: string;
  artifactSha256: string;
  runtimeClosureSha256: string;
  manifestSha256: string;
  activeRuntimeBaselineSha256: string;
  configuredModel: string;
  configuredModelSha256: string;
  manifestPath: string;
  executable: string;
};

type OwnedProcessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTail: string;
  stderrTail: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  ownedProcessCleanup: boolean;
  resourceContentionDuringExecution: boolean;
  contentionSnapshot: LocalModelResourceSnapshot | null;
  monitorError: string | null;
};

type ProcessIdentity = {
  pid: number;
  parentPid: number;
  processGroupId: number;
};

type OwnedReadableStream = NodeJS.ReadableStream & {
  destroyed?: boolean;
  readableEnded?: boolean;
  destroy?: () => void;
};

type ExecuteOwnedProcess = (params: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  probe?: () => LocalModelResourceSnapshot | Promise<LocalModelResourceSnapshot>;
  monitorIntervalMs?: number;
}) => Promise<OwnedProcessResult>;

type CompatibilitySmokeRuntime = {
  acquire?: typeof acquireExclusiveLocalModelAdmission;
  probe?: () => LocalModelResourceSnapshot | Promise<LocalModelResourceSnapshot>;
  execute?: ExecuteOwnedProcess;
  now?: () => Date;
};

export type CompatibilitySmokeParams = {
  runtimeRoot: string;
  candidateLayout?: "custom-runtime" | "local-ai-assist";
  candidateReleaseId: string;
  sourceCommit: string;
  sourceSha256: string;
  artifactSha256: string;
  runtimeClosureSha256: string;
  manifestSha256: string;
  activeRuntimeBaselineSha256: string;
  configuredModel?: string;
  configuredModelSha256?: string;
  verifierSha256: string;
  reportPath: string;
  receiptPath: string;
  waitMs?: number;
  timeoutMs?: number;
  runtime?: CompatibilitySmokeRuntime;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isSourceCommit(value: string): boolean {
  return /^[a-f0-9]{40,64}$/u.test(value);
}

function redact(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,]+/giu, "$1[REDACTED]")
    .replace(
      /((?:token|secret|password|api[_-]?key|credential|authorization)\s*[=:]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    )
    .replace(/(Bearer\s+)[^\s,]+/giu, "$1[REDACTED]");
}

function tail(value: string): string {
  const redacted = redact(value);
  return redacted.length <= EVIDENCE_TAIL_BYTES
    ? redacted
    : redacted.slice(redacted.length - EVIDENCE_TAIL_BYTES);
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error(`private directory is unsafe: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

function writeFreshJson(filePath: string, value: unknown): void {
  const resolved = path.resolve(filePath);
  ensurePrivateDirectory(path.dirname(resolved));
  if (fs.existsSync(resolved)) {
    throw new Error(`fresh evidence path already exists: ${resolved}`);
  }
  const temporary = `${resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, 0o600);
    const directory = fs.openSync(path.dirname(resolved), fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`JSON object required: ${filePath}`);
  }
  return value;
}

function pathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function regularFile(filePath: string): void {
  const info = fs.lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`candidate identity path is not a regular file: ${filePath}`);
  }
}

function readCandidateIdentity(params: CompatibilitySmokeParams): SmokeIdentity {
  const runtimeRoot = fs.realpathSync(path.resolve(params.runtimeRoot));
  if (params.candidateLayout === "local-ai-assist") {
    const manifestPath = path.join(runtimeRoot, "local-ai-assist-release.json");
    const executable = path.join(runtimeRoot, "openclaw.mjs");
    const packageTarballPath = path.join(runtimeRoot, "local-ai-assist-package.tgz");
    regularFile(manifestPath);
    regularFile(executable);
    regularFile(packageTarballPath);
    const manifest = readJsonObject(manifestPath);
    const configuredModel = params.configuredModel ?? LOCAL_MODEL_COMPATIBILITY_MODEL;
    const configuredModelSha256 = params.configuredModelSha256 ?? sha256(configuredModel);
    const actualManifestSha256 = sha256File(manifestPath);
    const errors: string[] = [];
    if (path.basename(runtimeRoot) !== params.candidateReleaseId) {
      errors.push("candidate release identity mismatch");
    }
    if (manifest.sourceSha !== params.sourceCommit) {
      errors.push("candidate source commit mismatch");
    }
    if (manifest.buildInfoSha256 !== params.sourceSha256) {
      errors.push("candidate source hash mismatch");
    }
    if (
      manifest.packageTarballSha256 !== params.artifactSha256 ||
      sha256File(packageTarballPath) !== params.artifactSha256
    ) {
      errors.push("candidate artifact hash mismatch");
    }
    // The Local AI Assist release manifest is its immutable runtime closure:
    // it binds the CLI, plugin, build identity, package, and dependency locks.
    if (params.runtimeClosureSha256 !== actualManifestSha256) {
      errors.push("candidate runtime closure hash mismatch");
    }
    if (params.manifestSha256 !== actualManifestSha256) {
      errors.push("candidate manifest hash mismatch");
    }
    for (const [value, label] of [
      [params.sourceSha256, "source"],
      [params.artifactSha256, "artifact"],
      [params.runtimeClosureSha256, "runtime closure"],
      [params.manifestSha256, "manifest"],
      [params.activeRuntimeBaselineSha256, "active baseline"],
      [configuredModelSha256, "configured model"],
      [params.verifierSha256, "verifier"],
    ] as const) {
      if (!isSha256(value)) {
        errors.push(`${label} hash is invalid`);
      }
    }
    if (!isSourceCommit(params.sourceCommit)) {
      errors.push("source commit is invalid");
    }
    if (!configuredModel.trim()) {
      errors.push("configured model is empty");
    }
    if (errors.length > 0) {
      throw new Error(`candidate_identity_mismatch:${errors.join(",")}`);
    }
    return {
      runtimeRoot,
      releaseId: params.candidateReleaseId,
      sourceCommit: params.sourceCommit,
      sourceSha256: params.sourceSha256,
      artifactSha256: params.artifactSha256,
      runtimeClosureSha256: params.runtimeClosureSha256,
      manifestSha256: params.manifestSha256,
      activeRuntimeBaselineSha256: params.activeRuntimeBaselineSha256,
      configuredModel,
      configuredModelSha256,
      manifestPath,
      executable,
    };
  }
  const snapshotPath = path.join(runtimeRoot, "snapshot.json");
  regularFile(snapshotPath);
  const snapshot = readJsonObject(snapshotPath);
  const source = isRecord(snapshot.source) ? snapshot.source : {};
  const paths = isRecord(snapshot.paths) ? snapshot.paths : {};
  const configuredModel = params.configuredModel ?? LOCAL_MODEL_COMPATIBILITY_MODEL;
  const configuredModelSha256 = params.configuredModelSha256 ?? sha256(configuredModel);
  const manifestPath = path.resolve(runtimeRoot, "config", "custom-runtime-capabilities.json");
  const executable = path.join(runtimeRoot, "openclaw.mjs");
  const entrypoint = typeof paths.entrypoint === "string" ? path.resolve(paths.entrypoint) : "";
  const errors: string[] = [];
  if (snapshot.releaseId !== params.candidateReleaseId) {
    errors.push("candidate release identity mismatch");
  }
  try {
    if (
      typeof snapshot.root !== "string" ||
      fs.realpathSync(path.resolve(snapshot.root)) !== runtimeRoot
    ) {
      errors.push("candidate runtime root identity mismatch");
    }
  } catch {
    errors.push("candidate runtime root identity mismatch");
  }
  if (source.commit !== params.sourceCommit) {
    errors.push("candidate source commit mismatch");
  }
  if (snapshot.artifactHash !== params.artifactSha256) {
    errors.push("candidate artifact hash mismatch");
  }
  if (snapshot.runtimeClosureHash !== params.runtimeClosureSha256) {
    errors.push("candidate runtime closure hash mismatch");
  }
  for (const [value, label] of [
    [params.sourceSha256, "source"],
    [params.artifactSha256, "artifact"],
    [params.runtimeClosureSha256, "runtime closure"],
    [params.manifestSha256, "manifest"],
    [params.activeRuntimeBaselineSha256, "active baseline"],
    [configuredModelSha256, "configured model"],
    [params.verifierSha256, "verifier"],
  ] as const) {
    if (!isSha256(value)) {
      errors.push(`${label} hash is invalid`);
    }
  }
  if (!isSourceCommit(params.sourceCommit)) {
    errors.push("source commit is invalid");
  }
  if (!configuredModel.trim()) {
    errors.push("configured model is empty");
  }
  if (!pathInside(runtimeRoot, manifestPath)) {
    errors.push("candidate manifest is outside the runtime root");
  }
  try {
    regularFile(manifestPath);
    if (sha256File(manifestPath) !== params.manifestSha256) {
      errors.push("candidate manifest hash mismatch");
    }
  } catch {
    errors.push("candidate manifest is missing or unreadable");
  }
  try {
    if (!entrypoint || fs.realpathSync(entrypoint) !== path.join(runtimeRoot, "dist", "index.js")) {
      errors.push("candidate entrypoint identity mismatch");
    }
  } catch {
    errors.push("candidate entrypoint identity mismatch");
  }
  try {
    regularFile(executable);
  } catch {
    errors.push("candidate CLI executable is missing or unreadable");
  }
  if (errors.length > 0) {
    throw new Error(`candidate_identity_mismatch:${errors.join(",")}`);
  }
  return {
    runtimeRoot,
    releaseId: params.candidateReleaseId,
    sourceCommit: params.sourceCommit,
    sourceSha256: params.sourceSha256,
    artifactSha256: params.artifactSha256,
    runtimeClosureSha256: params.runtimeClosureSha256,
    manifestSha256: params.manifestSha256,
    activeRuntimeBaselineSha256: params.activeRuntimeBaselineSha256,
    configuredModel,
    configuredModelSha256,
    manifestPath,
    executable,
  };
}

export function runReadOnly(
  command: string,
  args: string[],
  execute: ReadOnlyExecutor = executeReadOnly,
): string {
  try {
    const output = execute(command, args, {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: MAX_PROBE_BYTES + 1,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    if (Buffer.byteLength(output, "utf8") > MAX_PROBE_BYTES) {
      throw new CompatibilitySmokeError(
        "probe_overflow",
        `probe_overflow:${path.basename(command)} exceeded ${MAX_PROBE_BYTES} bytes`,
      );
    }
    return output;
  } catch (error) {
    if (error instanceof CompatibilitySmokeError) {
      throw error;
    }
    const probeError = error as { code?: unknown; status?: unknown; stderr?: unknown };
    if (probeError.code === "ENOBUFS") {
      throw new CompatibilitySmokeError(
        "probe_overflow",
        `probe_overflow:${path.basename(command)} exceeded ${MAX_PROBE_BYTES} bytes`,
      );
    }
    // lsof and pgrep exit 1 when a valid query has no matches. Treat that as
    // an empty observation; preserve non-empty stderr and every other failure
    // as a hard probe error so permission/tool failures cannot look quiescent.
    const stderr = probeError.stderr == null ? "" : String(probeError.stderr);
    if (
      ["lsof", "pgrep", "ps"].includes(path.basename(command)) &&
      probeError.status === 1 &&
      stderr.trim() === ""
    ) {
      return "";
    }
    throw new CompatibilitySmokeError(
      "probe_unavailable",
      `probe_unavailable:${path.basename(command)} failed`,
    );
  }
}

function systemTool(name: "lsof" | "pgrep" | "ps"): string {
  const selected =
    name === "lsof" ? "/usr/sbin/lsof" : name === "pgrep" ? "/usr/bin/pgrep" : "/bin/ps";
  try {
    const info = fs.lstatSync(selected);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o111) === 0) {
      throw new Error("unsafe system tool");
    }
    return selected;
  } catch {
    throw new CompatibilitySmokeError(
      "probe_unavailable",
      `probe_unavailable:${name} is missing or unsafe`,
    );
  }
}

export function parsePids(output: string, format: "plain" | "lsof" = "plain"): Set<number> {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/u)) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }
    if (format === "lsof" && /^f[A-Za-z0-9]+$/u.test(normalized)) {
      // macOS lsof emits a file-descriptor field even when invoked with -Fp.
      // It is ancillary to the preceding process record, not another PID.
      if (pids.size === 0) {
        throw new CompatibilitySmokeError(
          "probe_unavailable",
          "probe_unavailable:lsof file-descriptor row preceded a process id",
        );
      }
      continue;
    }
    const value = format === "lsof" ? normalized.slice(1) : normalized;
    const valid = format === "lsof" ? /^p\d+$/u.test(normalized) : /^\d+$/u.test(value);
    if (!valid) {
      throw new CompatibilitySmokeError(
        "probe_unavailable",
        `probe_unavailable:malformed ${format} process id`,
      );
    }
    const pid = Number(value);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pids.has(pid)) {
      throw new CompatibilitySmokeError(
        "probe_unavailable",
        `probe_unavailable:invalid ${format} process id`,
      );
    }
    pids.add(pid);
  }
  return pids;
}

function ollamaPort(): number {
  const raw = process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
  const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("ollama host is not loopback");
  }
  return Number(url.port || 11434);
}

export function readLocalModelResourceSnapshot(): LocalModelResourceSnapshot {
  const selfPid = process.pid;
  const workers = parsePids(runReadOnly(systemTool("pgrep"), ["-x", "openclaw-agent"]));
  workers.delete(selfPid);
  const port = ollamaPort();
  const lsof = systemTool("lsof");
  const listeners = parsePids(
    runReadOnly(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]),
    "lsof",
  );
  const clients = parsePids(
    runReadOnly(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:ESTABLISHED", "-Fp"]),
    "lsof",
  );
  const activeClients = [...clients]
    .filter((pid) => !listeners.has(pid) && pid !== selfPid)
    .sort((a, b) => a - b);
  return {
    observedAt: new Date().toISOString(),
    activeOpenClawWorkerCount: workers.size,
    activeOllamaClientCount: activeClients.length,
    activeOpenClawWorkerPids: [...workers].sort((a, b) => a - b),
    activeOllamaClientPids: activeClients,
  };
}

function createIsolatedConfig(tempRoot: string, model: string): string {
  const configPath = path.join(tempRoot, "openclaw.json");
  const modelRef = `ollama/${model}`;
  const config = {
    agents: {
      defaults: { model: { primary: modelRef }, timeoutSeconds: 180 },
      list: [{ id: LOCAL_MODEL_COMPATIBILITY_AGENT_ID, model: { primary: modelRef } }],
    },
    models: {
      providers: {
        ollama: {
          baseUrl: "http://127.0.0.1:11434",
          api: "ollama",
          models: [
            {
              id: model,
              name: model,
              api: "ollama",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              maxTokens: 64,
            },
          ],
        },
      },
    },
    // The Ollama provider is a plugin-owned API. Keep plugin loading enabled
    // only for that provider; disabling plugins globally leaves the model
    // catalog intact but removes the stream registration, producing the
    // misleading "No API provider registered for api: ollama" failure.
    plugins: {
      enabled: true,
      allow: ["ollama"],
      entries: { ollama: { enabled: true } },
    },
    browser: { enabled: false },
    cron: { enabled: false, triggers: { enabled: false } },
    tools: { profile: "minimal", deny: ["*"] },
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return configPath;
}

function childEnvironment(params: {
  configPath: string;
  stateDir: string;
  admission: LocalModelAdmissionLease;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/iu.test(key) &&
      key !== "OPENCLAW_LOCAL_MODEL_ADMISSION_TOKEN"
    ) {
      delete env[key];
    }
  }
  for (const key of [
    "OPENCLAW_CUSTOM_RUNTIME_HOME",
    "OPENCLAW_CUSTOM_RUNTIME_POINTER",
    "OPENCLAW_GATEWAY_PORT",
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENCLAW_REMOTE_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "DISCORD_BOT_TOKEN",
    "OPENCLAW_SKIP_PROVIDERS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ]) {
    delete env[key];
  }
  env.OPENCLAW_CONFIG_PATH = params.configPath;
  env.OPENCLAW_STATE_DIR = params.stateDir;
  env.OPENCLAW_LOCAL_MODEL_ADMISSION_PATH = params.admission.statePath;
  env.OPENCLAW_LOCAL_MODEL_ADMISSION_TOKEN = params.admission.token;
  env.OPENCLAW_SKIP_CHANNELS = "1";
  env.OPENCLAW_SKIP_CRON = "1";
  env.OPENCLAW_SKIP_CANVAS_HOST = "1";
  env.OPENCLAW_SKIP_BROWSER_CONTROL_SERVER = "1";
  env.OPENCLAW_SKIP_GMAIL_WATCHER = "1";
  env.OPENCLAW_SELF_IMPROVEMENT_BACKGROUND = "0";
  return env;
}

type BoundedCapture = {
  prefix: Buffer;
  tail: Buffer;
  totalBytes: number;
};

function emptyCapture(): BoundedCapture {
  return { prefix: Buffer.alloc(0), tail: Buffer.alloc(0), totalBytes: 0 };
}

function appendCapture(capture: BoundedCapture, chunk: Buffer | string): void {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  capture.totalBytes += bytes.byteLength;
  if (capture.prefix.byteLength < MAX_CAPTURE_BYTES) {
    const remaining = MAX_CAPTURE_BYTES - capture.prefix.byteLength;
    capture.prefix = Buffer.concat([capture.prefix, bytes.subarray(0, remaining)]);
  }
  const combinedTail = Buffer.concat([capture.tail, bytes]);
  capture.tail = combinedTail.subarray(Math.max(0, combinedTail.byteLength - EVIDENCE_TAIL_BYTES));
}

function captureText(capture: BoundedCapture): string {
  return capture.prefix.toString("utf8");
}

function captureTail(capture: BoundedCapture): string {
  return redact(capture.tail.toString("utf8"));
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessGroupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processGroupAlive(pid);
}

async function terminateOwnedProcessGroup(pid: number): Promise<boolean> {
  if (!processGroupAlive(pid)) {
    return true;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      return false;
    }
  }
  if (await waitForProcessGroupGone(pid, PROCESS_CLEANUP_GRACE_MS)) {
    return true;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      return false;
    }
  }
  return await waitForProcessGroupGone(pid, PROCESS_CLEANUP_GRACE_MS);
}

function processGroupId(pid: number): number {
  const output = runReadOnly(systemTool("ps"), ["-p", String(pid), "-o", "pgid="]);
  const value = Number(output.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new CompatibilitySmokeError(
      "probe_unavailable",
      "probe_unavailable:invalid process group",
    );
  }
  return value;
}

function readProcessIdentity(pid: number): ProcessIdentity | null {
  const output = runReadOnly(systemTool("ps"), [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,pgid=",
  ]).trim();
  if (!output) {
    return null;
  }
  const fields = output.split(/\s+/u).map(Number);
  if (
    fields.length !== 3 ||
    fields.some((value) => !Number.isInteger(value) || value < 0) ||
    fields[0] !== pid ||
    fields[1] === 0 ||
    fields[2] === 0
  ) {
    throw new CompatibilitySmokeError(
      "probe_unavailable",
      "probe_unavailable:invalid process identity",
    );
  }
  return { pid: fields[0], parentPid: fields[1], processGroupId: fields[2] };
}

export function isOwnedLocalModelProcess(
  pid: number,
  ownedRootPid: number,
  ownedGroupId: number,
  lookup: (candidatePid: number) => ProcessIdentity | null = readProcessIdentity,
): boolean {
  const visited = new Set<number>();
  let currentPid = pid;
  for (let depth = 0; depth < 64; depth += 1) {
    if (currentPid === ownedRootPid) {
      return true;
    }
    if (currentPid <= 1 || visited.has(currentPid)) {
      return false;
    }
    visited.add(currentPid);
    const identity = lookup(currentPid);
    // The PID disappeared after lsof captured it, so it cannot represent
    // continuing unrelated work and must not race a fail-closed smoke abort.
    if (!identity) {
      return true;
    }
    if (identity.processGroupId === ownedGroupId || identity.parentPid === ownedRootPid) {
      return true;
    }
    currentPid = identity.parentPid;
  }
  return false;
}

function hasUnrelatedActivity(
  snapshot: LocalModelResourceSnapshot,
  ownedRootPid: number,
  ownedGroupId: number,
): boolean {
  const workerPids = snapshot.activeOpenClawWorkerPids ?? [];
  const clientPids = snapshot.activeOllamaClientPids ?? [];
  if (
    snapshot.activeOpenClawWorkerCount > workerPids.length ||
    snapshot.activeOllamaClientCount > clientPids.length
  ) {
    return true;
  }
  return [...workerPids, ...clientPids].some((pid) => {
    return !isOwnedLocalModelProcess(pid, ownedRootPid, ownedGroupId);
  });
}

export function executeOwnedProcess(params: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  probe?: () => LocalModelResourceSnapshot | Promise<LocalModelResourceSnapshot>;
  monitorIntervalMs?: number;
}): Promise<OwnedProcessResult> {
  return new Promise((resolve) => {
    const stdout = emptyCapture();
    const stderr = emptyCapture();
    let timedOut = false;
    let resourceContentionDuringExecution = false;
    let contentionSnapshot: LocalModelResourceSnapshot | null = null;
    let monitorError: string | null = null;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let monitor: NodeJS.Timeout | undefined;
    let monitorRunning = false;
    const complete = async (
      childPid: number | undefined,
      status: number | null,
      signal: NodeJS.Signals | null,
      streams?: {
        stdout?: OwnedReadableStream | null;
        stderr?: OwnedReadableStream | null;
      },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (monitor) {
        clearInterval(monitor);
      }
      const ownedProcessCleanup =
        childPid === undefined ? true : await terminateOwnedProcessGroup(childPid);
      await Promise.all(
        [streams?.stdout, streams?.stderr].map(
          (stream) =>
            new Promise<void>((streamResolved) => {
              if (!stream || stream.destroyed || stream.readableEnded) {
                streamResolved();
                return;
              }
              const done = () => {
                clearTimeout(deadline);
                stream.removeListener?.("end", done);
                stream.removeListener?.("close", done);
                stream.removeListener?.("error", done);
                streamResolved();
              };
              const deadline = setTimeout(done, 250);
              stream.once?.("end", done);
              stream.once?.("close", done);
              stream.once?.("error", done);
            }),
        ),
      );
      streams?.stdout?.destroy?.();
      streams?.stderr?.destroy?.();
      resolve({
        status,
        signal,
        stdout: captureText(stdout),
        stderr: captureText(stderr),
        stdoutTail: captureTail(stdout),
        stderrTail: captureTail(stderr),
        stdoutTruncated: stdout.totalBytes > MAX_CAPTURE_BYTES,
        stderrTruncated: stderr.totalBytes > MAX_CAPTURE_BYTES,
        timedOut,
        ownedProcessCleanup,
        resourceContentionDuringExecution,
        contentionSnapshot,
        monitorError,
      });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(params.executable, params.args, {
        cwd: params.cwd,
        env: params.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        status: null,
        signal: null,
        stdout: "",
        stderr: redact(String(error)),
        stdoutTail: "",
        stderrTail: redact(String(error)),
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        ownedProcessCleanup: true,
        resourceContentionDuringExecution: false,
        contentionSnapshot: null,
        monitorError: null,
      });
      return;
    }
    child.stdout?.on("data", (chunk: Buffer | string) => {
      appendCapture(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      appendCapture(stderr, chunk);
    });
    child.once("error", (error) => {
      appendCapture(stderr, redact(String(error)));
      void complete(child.pid, null, null, child);
    });
    child.once("exit", (status, signal) => {
      void complete(child.pid, status, signal, child);
    });
    if (params.probe) {
      let ownedGroupId: number;
      try {
        ownedGroupId = processGroupId(child.pid!);
        if (ownedGroupId !== child.pid) {
          throw new CompatibilitySmokeError(
            "probe_unavailable",
            "probe_unavailable:detached child process group mismatch",
          );
        }
      } catch (error) {
        monitorError = redact(error instanceof Error ? error.message : String(error));
        void complete(child.pid, null, "SIGTERM", child);
        return;
      }
      monitor = setInterval(() => {
        if (settled || monitorRunning) {
          return;
        }
        monitorRunning = true;
        void Promise.resolve(params.probe!())
          .then((snapshot) => {
            if (!settled && child.pid && hasUnrelatedActivity(snapshot, child.pid, ownedGroupId)) {
              resourceContentionDuringExecution = true;
              contentionSnapshot = snapshot;
              void complete(child.pid, null, "SIGTERM", child);
            }
          })
          .catch((error: unknown) => {
            monitorError = redact(error instanceof Error ? error.message : String(error));
            void complete(child.pid, null, "SIGTERM", child);
          })
          .finally(() => {
            monitorRunning = false;
          });
      }, params.monitorIntervalMs ?? EXECUTION_MONITOR_INTERVAL_MS);
    }
    timeout = setTimeout(() => {
      timedOut = true;
      void complete(child.pid, null, "SIGTERM", child);
    }, params.timeoutMs);
  });
}

function extractResponse(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed === RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE) {
    return trimmed;
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === "string") {
      return value.trim();
    }
    if (!isRecord(value)) {
      return null;
    }
    const result = isRecord(value.result) ? value.result : value;
    const payloads = result.payloads;
    if (!Array.isArray(payloads) || payloads.length !== 1 || !isRecord(payloads[0])) {
      return null;
    }
    return typeof payloads[0].text === "string" ? payloads[0].text.trim() : null;
  } catch {
    return null;
  }
}

function commandForReceipt(executable: string, args: string[]): string {
  return [executable, ...args].map((value) => JSON.stringify(value)).join(" ");
}

function baseReport(params: CompatibilitySmokeParams): Record<string, unknown> {
  return {
    schema: "openclaw.local-model-compatibility-smoke.v1",
    status: "blocked",
    consumed: false,
    operation: "isolated_local_model_compatibility",
    candidateReleaseId: params.candidateReleaseId,
    candidateLayout: params.candidateLayout ?? "custom-runtime",
    sourceCommit: params.sourceCommit,
    configuredModel: params.configuredModel ?? LOCAL_MODEL_COMPATIBILITY_MODEL,
    timeoutMs: params.timeoutMs ?? LOCAL_MODEL_COMPATIBILITY_TIMEOUT_MS,
    waitMs: params.waitMs ?? LOCAL_MODEL_COMPATIBILITY_WAIT_MS,
    blockers: [],
    warnings: [],
  };
}

function writeReport(params: CompatibilitySmokeParams, report: Record<string, unknown>): void {
  writeFreshJson(params.reportPath, report);
}

function failureCode(error: unknown): CompatibilitySmokeFailureCode | null {
  return error instanceof CompatibilitySmokeError ? error.code : null;
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("operation deadline exceeded")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runLocalModelCompatibilitySmoke(
  params: CompatibilitySmokeParams,
): Promise<Record<string, unknown>> {
  const report = baseReport(params);
  const now = params.runtime?.now ?? (() => new Date());
  let identity: SmokeIdentity;
  try {
    identity = readCandidateIdentity(params);
  } catch (error) {
    report.blockers = [error instanceof Error ? error.message : "candidate_identity_mismatch"];
    writeReport(params, report);
    return report;
  }

  const tempRoot = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "patternlab-runtime-smoke-"),
  );
  fs.chmodSync(tempRoot, 0o700);
  const stateDir = path.join(tempRoot, "state");
  ensurePrivateDirectory(stateDir);
  report.isolatedStateRoot = tempRoot;
  const configPath = createIsolatedConfig(tempRoot, identity.configuredModel);
  const prompt = `Reply with exactly ${RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE} and no other text.`;
  const executableArgs = [
    "--log-level",
    "error",
    "agent",
    "--local",
    "--agent",
    LOCAL_MODEL_COMPATIBILITY_AGENT_ID,
    "--message",
    prompt,
    "--thinking",
    "off",
    "--timeout",
    "180",
    "--json",
  ];
  let lease: LocalModelAdmissionLease | undefined;
  let receipt: Record<string, unknown> | undefined;
  try {
    const acquire = params.runtime?.acquire ?? acquireExclusiveLocalModelAdmission;
    lease = await acquire({
      owner: `patternlab:runtime-compatibility:${identity.releaseId}`,
      waitMs: params.waitMs ?? LOCAL_MODEL_COMPATIBILITY_WAIT_MS,
      sampleIntervalMs: LOCAL_MODEL_COMPATIBILITY_SAMPLE_INTERVAL_MS,
      probe: params.runtime?.probe ?? readLocalModelResourceSnapshot,
    });
    report.consumed = true;
    report.resourceAdmissionSamples = lease.samples;
    const execute = params.runtime?.execute ?? executeOwnedProcess;
    const result = await execute({
      executable: identity.executable,
      args: executableArgs,
      cwd: identity.runtimeRoot,
      env: childEnvironment({ configPath, stateDir, admission: lease }),
      timeoutMs: params.timeoutMs ?? LOCAL_MODEL_COMPATIBILITY_TIMEOUT_MS,
      probe: params.runtime?.probe ?? readLocalModelResourceSnapshot,
    });
    report.process = {
      status: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
      ownedProcessCleanup: result.ownedProcessCleanup,
      contentionSnapshot: result.contentionSnapshot,
    };
    report.stdoutTail = tail(result.stdoutTail || result.stdout);
    report.stderrTail = tail(result.stderrTail || result.stderr);
    const warnings: string[] = [];
    if (result.stderr.trim() || result.stderrTruncated) {
      warnings.push("stderr_output");
    }
    if (result.stdoutTruncated || result.stderrTruncated) {
      warnings.push("output_truncated");
    }
    report.warnings = warnings;
    if (result.resourceContentionDuringExecution) {
      report.blockers = ["resource_contention_during_execution"];
    } else if (result.monitorError) {
      report.blockers = ["probe_unavailable"];
      report.monitorError = result.monitorError;
    } else if (result.timedOut) {
      report.blockers = ["smoke_timeout"];
    } else if (!result.ownedProcessCleanup) {
      report.blockers = ["leftover_child"];
    } else if (warnings.length > 0) {
      report.blockers = ["smoke_warning"];
    } else if (
      result.status !== 0 ||
      extractResponse(result.stdout) !== RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE
    ) {
      report.blockers = ["smoke_response_mismatch"];
    } else {
      const completedAt = now().toISOString();
      const startedAt = new Date(
        Math.min(...lease.samples.map((sample) => Date.parse(sample.observedAt))),
      ).toISOString();
      const proof = {
        operation: "isolated_local_model_compatibility" as const,
        candidateReleaseId: identity.releaseId,
        sourceCommit: identity.sourceCommit,
        sourceSha256: identity.sourceSha256,
        artifactSha256: identity.artifactSha256,
        runtimeClosureSha256: identity.runtimeClosureSha256,
        manifestSha256: identity.manifestSha256,
        activeRuntimeBaselineSha256: identity.activeRuntimeBaselineSha256,
        configuredModel: identity.configuredModel,
        configuredModelSha256: identity.configuredModelSha256,
        promptSha256: sha256(prompt),
        responseSha256: sha256(RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE),
        responseMarker: RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE,
        resourceAdmissionSamples: [...lease.samples],
        ownedProcessCleanup: true as const,
        warnings: [],
        proofOrder: [
          "resource_admission",
          "process_spawn",
          "response",
          "owned_process_cleanup",
        ] as ["resource_admission", "process_spawn", "response", "owned_process_cleanup"],
        startedAt,
        completedAt,
      };
      const recordedAt = now().toISOString();
      const localReceipt = createReleaseLocalModelCompatibilityReceipt({
        candidateSha: identity.sourceCommit,
        proofProfile: "mac_studio_control_director",
        proofProfileVersion: proofProfileVersion("mac_studio_control_director"),
        proofPhase: "candidate",
        activeRuntimeSha: null,
        command: commandForReceipt(identity.executable, executableArgs),
        verifierSha256: params.verifierSha256,
        browserArtifactSha256: null,
        recordedAt,
        localModelCompatibility: proof,
      });
      receipt = localReceipt as unknown as Record<string, unknown>;
      report.status = "pass";
      report.receiptPath = path.resolve(params.receiptPath);
      report.localModelCompatibility = proof;
    }
  } catch (error) {
    if (error instanceof LocalModelAdmissionError && error.code === "resource_contention") {
      report.blockers = ["resource_contention"];
      report.consumed = false;
    } else {
      report.blockers = [
        failureCode(error) ?? (error instanceof Error ? error.message : "smoke_failed"),
      ];
    }
  } finally {
    if (lease) {
      try {
        await withDeadline(lease.release(), ADMISSION_RELEASE_TIMEOUT_MS);
      } catch (error) {
        report.status = "blocked";
        report.blockers = [
          ...new Set([
            ...(Array.isArray(report.blockers)
              ? report.blockers.filter((value): value is string => typeof value === "string")
              : []),
            "admission_release_failed",
          ]),
        ];
        report.receipt = undefined;
        report.releaseError = redact(error instanceof Error ? error.message : String(error));
      }
    }
    // The caller owns temporary-artifact retention. Do not perform cleanup
    // here: the governed operation may need the isolated state for evidence
    // review, and the current authorization forbids unapproved cleanup.
  }
  if (receipt && report.status === "pass") {
    try {
      writeFreshJson(params.receiptPath, receipt);
    } catch (error) {
      report.status = "blocked";
      report.blockers = ["receipt_write_failed"];
      report.receipt = undefined;
      report.writeError = redact(error instanceof Error ? error.message : String(error));
    }
  }
  writeReport(params, report);
  return report;
}

function nextArg(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseArgs(args: string[]): CompatibilitySmokeParams {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      throw new Error(
        "usage: custom-runtime-local-model-smoke --runtime-root <path> --candidate-release-id <id> --source-commit <sha> --source-sha256 <sha256> --artifact-sha256 <sha256> --runtime-closure-sha256 <sha256> --manifest-sha256 <sha256> --active-runtime-baseline-sha256 <sha256> --verifier-sha256 <sha256> --report <path> --receipt <path> [--candidate-layout <custom-runtime|local-ai-assist>] [--model <id>]",
      );
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const flag = arg.slice(2);
    values.set(flag, nextArg(args, index, arg));
    index += 1;
  }
  const required = [
    "runtime-root",
    "candidate-release-id",
    "source-commit",
    "source-sha256",
    "artifact-sha256",
    "runtime-closure-sha256",
    "manifest-sha256",
    "active-runtime-baseline-sha256",
    "verifier-sha256",
    "report",
    "receipt",
  ];
  for (const key of required) {
    if (!values.get(key)?.trim()) {
      throw new Error(`missing required argument: --${key}`);
    }
  }
  const candidateLayout = values.get("candidate-layout") ?? "custom-runtime";
  if (candidateLayout !== "custom-runtime" && candidateLayout !== "local-ai-assist") {
    throw new Error(`invalid value for --candidate-layout: ${candidateLayout}`);
  }
  return {
    runtimeRoot: values.get("runtime-root")!,
    candidateLayout,
    candidateReleaseId: values.get("candidate-release-id")!,
    sourceCommit: values.get("source-commit")!,
    sourceSha256: values.get("source-sha256")!,
    artifactSha256: values.get("artifact-sha256")!,
    runtimeClosureSha256: values.get("runtime-closure-sha256")!,
    manifestSha256: values.get("manifest-sha256")!,
    activeRuntimeBaselineSha256: values.get("active-runtime-baseline-sha256")!,
    configuredModel: values.get("model") ?? LOCAL_MODEL_COMPATIBILITY_MODEL,
    verifierSha256: values.get("verifier-sha256")!,
    reportPath: values.get("report")!,
    receiptPath: values.get("receipt")!,
  };
}

async function main(): Promise<void> {
  try {
    const report = await runLocalModelCompatibilitySmoke(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 64;
  }
}

if (import.meta.main) {
  void main();
}

// SAFETY-RATCHET: template-aware
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { preparationRoot } from "./controller-receipts.js";
import { runCommand, SAFE_EXEC_PATH } from "./process.js";
import type { ResolvedRingerConfig, RingerRunReceipt, RingerRunRequest } from "./types.js";

type CapacityStatus = {
  admittedParallel: 0 | 1 | 2;
  dockerReady: boolean;
  dockerImageReady: boolean;
  dockerImageSha256?: string;
  dockerWorkspaceMountReady: boolean;
  ollamaReady: boolean;
  installedModels: string[];
  residentModels: string[];
  freeMemoryBytes: number;
  swapUsedBytes?: number;
  ollamaProbeMs?: number;
  thermalConstrained: boolean;
  reasons: string[];
};

/**
 * Admission is machine-wide, not merely per manifest. A second Gateway
 * request must not consume a slot that an already-running run reserved.
 */
export function canReserveWorkerSlots(params: {
  admittedParallel: 0 | 1 | 2;
  reservedWorkers: number;
  requestedWorkers: 1 | 2;
}): boolean {
  return (
    Number.isInteger(params.reservedWorkers) &&
    params.reservedWorkers >= 0 &&
    params.reservedWorkers + params.requestedWorkers <= params.admittedParallel
  );
}

export function ringerEnv(runRoot: string, verifierRoot: string): NodeJS.ProcessEnv {
  return {
    HOME: path.join(runRoot, "home"),
    PATH: SAFE_EXEC_PATH,
    TMPDIR: os.tmpdir(),
    LANG: "C.UTF-8",
    RINGER_NO_SELF_UPDATE: "1",
    RINGER_NO_CATALOG_REFRESH: "1",
    RINGER_IDENTITY: "openclaw-local-ai-assist",
    LOCAL_AI_ASSIST_VERIFIER_ROOT: verifierRoot,
  };
}

export function dockerEnv(config: ResolvedRingerConfig): NodeJS.ProcessEnv {
  return {
    PATH: SAFE_EXEC_PATH,
    LANG: "C.UTF-8",
    ...(config.dockerHost ? { DOCKER_HOST: config.dockerHost } : {}),
  };
}

export function ringerArgs(
  config: ResolvedRingerConfig,
  nativeManifestPath: string,
  action: RingerRunRequest["action"],
): string[] {
  const base = [
    path.join(config.ringerSourceDir!, "ringer.py"),
    "--config",
    config.ringerConfigPath!,
    "--no-self-update",
  ];
  if (action === "lint") {
    return [...base, "lint", nativeManifestPath];
  }
  const args = [...base, "run", nativeManifestPath, "--no-dashboard", "--no-artifact"];
  if (action === "dry_run") {
    args.push("--dry-run");
  } else if (action === "baseline") {
    args.push("--baseline");
  }
  return args;
}

async function fetchOllamaJson(baseUrl: string, endpoint: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Large quantized local models can take several minutes to load when the host
// is reclaiming memory. Keep the bound finite, but leave enough room for one
// cold load before failing closed rather than dispatching into an unloaded
// model.
const OLLAMA_PREWARM_TIMEOUT_MS = 300_000;

export async function warmOllamaModel(
  baseUrl: string,
  modelRef: string,
  timeoutMs = OLLAMA_PREWARM_TIMEOUT_MS,
): Promise<boolean> {
  const model = modelRef.replace(/^ollama\//u, "");
  if (!model || model === modelRef) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply exactly OK." }],
        stream: false,
        think: false,
        keep_alive: "10m",
        options: { num_predict: 8, temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    // SAFETY: The JSON response is treated as an object and only validated fields are read below.
    const payload = (await response.json()) as Record<string, unknown>;
    return payload.model === model && payload.done === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForResidentOllamaModel(
  baseUrl: string,
  modelRef: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const residentModels = ollamaNames(await fetchOllamaJson(baseUrl, "/api/ps"), "models");
      if (residentModels.some((name) => modelNameMatchesRef(name, modelRef))) {
        return true;
      }
    } catch {
      // Keep polling until the bounded residency window expires.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  return false;
}

export async function isOwnedRingerProcess(
  config: ResolvedRingerConfig,
  receipt: RingerRunReceipt,
): Promise<boolean> {
  if (!receipt.pid || !config.ringerSourceDir || !config.ringerConfigPath) {
    return false;
  }
  const command = await runCommand("ps", ["-p", String(receipt.pid), "-o", "command="], {
    timeoutMs: 2_000,
    env: { PATH: SAFE_EXEC_PATH, LANG: "C" },
  }).catch(() => null);
  if (!command || command.code !== 0) {
    return false;
  }
  const output = command.stdout.toString("utf8").trim();
  const scriptPath = path.join(path.resolve(config.ringerSourceDir), "ringer.py");
  const nativeManifestPath = path.join(
    preparationRoot(config, receipt.manifestSha256),
    "ringer.native.json",
  );
  return (
    output.includes(scriptPath) &&
    output.includes(path.resolve(config.ringerConfigPath)) &&
    output.includes(nativeManifestPath) &&
    /(?:^|\s)run(?:\s|$)/u.test(output)
  );
}

export async function terminateOwnedRingerProcess(
  config: ResolvedRingerConfig,
  receipt: RingerRunReceipt,
): Promise<boolean> {
  if (!receipt.pid || !isProcessAlive(receipt.pid)) {
    return true;
  }
  if (!(await isOwnedRingerProcess(config, receipt))) {
    return false;
  }
  try {
    process.kill(process.platform === "win32" ? receipt.pid : -receipt.pid, "SIGTERM");
  } catch {
    if (!isProcessAlive(receipt.pid)) {
      return true;
    }
    return false;
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && isProcessAlive(receipt.pid)) {
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  if (!isProcessAlive(receipt.pid)) {
    return true;
  }
  if (!(await isOwnedRingerProcess(config, receipt))) {
    return false;
  }
  try {
    process.kill(process.platform === "win32" ? receipt.pid : -receipt.pid, "SIGKILL");
  } catch {}
  return !isProcessAlive(receipt.pid);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type DockerSandboxContainer = {
  id: string;
  name: string;
  status: string;
  sessionKey: string;
  mountSources: string[];
};

export async function listLocalWorkerContainers(
  config: ResolvedRingerConfig,
): Promise<DockerSandboxContainer[]> {
  const listed = await runCommand("docker", ["ps", "-aq", "--filter", "label=openclaw.sandbox=1"], {
    timeoutMs: 10_000,
    env: dockerEnv(config),
  }).catch(() => null);
  if (!listed || listed.code !== 0) {
    return [];
  }
  const ids = listed.stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => /^[a-f0-9]{12,64}$/u.test(value));
  const containers: DockerSandboxContainer[] = [];
  for (const id of ids) {
    const inspected = await runCommand("docker", ["inspect", id], {
      timeoutMs: 10_000,
      env: dockerEnv(config),
    }).catch(() => null);
    if (!inspected || inspected.code !== 0) {
      continue;
    }
    try {
      // SAFETY: Docker inspect returns a top-level array; each returned field is checked below.
      const [raw] = JSON.parse(inspected.stdout.toString("utf8")) as Array<{
        Name?: unknown;
        Id?: unknown;
        State?: { Status?: unknown };
        Config?: { Labels?: Record<string, unknown> };
        Mounts?: Array<{ Source?: unknown }>;
      }>;
      if (!raw) {
        continue;
      }
      const sessionKey = raw?.Config?.Labels?.["openclaw.sessionKey"];
      const name = raw?.Name;
      const containerId = raw?.Id;
      if (
        typeof sessionKey !== "string" ||
        !sessionKey.startsWith("agent:local-ai-worker:explicit:local-ai-") ||
        typeof name !== "string" ||
        typeof containerId !== "string"
      ) {
        continue;
      }
      containers.push({
        id: containerId,
        name: name.replace(/^\//u, ""),
        status: typeof raw.State?.Status === "string" ? raw.State.Status : "unknown",
        sessionKey,
        mountSources: (raw.Mounts ?? [])
          .map((mount) => mount.Source)
          .filter((source): source is string => typeof source === "string"),
      });
    } catch {
      // Ignore containers that disappear or return malformed inspection data.
    }
  }
  return containers;
}

async function probeDockerWorkspaceMount(config: ResolvedRingerConfig): Promise<boolean> {
  const probeRoot = path.join(config.stateDir, "runtime-probes");
  const token = crypto.randomUUID();
  const inputPath = path.join(probeRoot, `${token}.in`);
  const outputPath = path.join(probeRoot, `${token}.out`);
  await fs.mkdir(probeRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(probeRoot, 0o700);
  try {
    await fs.writeFile(inputPath, `${token}\n`, { mode: 0o600, flag: "wx" });
    const volume = `${probeRoot}:/workspace:rw`;
    const result = await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--volume",
        volume,
        config.dockerImage,
        "/bin/sh",
        "-c",
        `test "$(cat /workspace/${token}.in 2>/dev/null)" = "${token}" && printf '%s\\n' '${token}' > /workspace/${token}.out`,
      ],
      { timeoutMs: 15_000, env: dockerEnv(config) },
    );
    if (result.code !== 0) {
      return false;
    }
    return (await fs.readFile(outputPath, "utf8")) === `${token}\n`;
  } catch {
    return false;
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}

async function inspectSwapUsedBytes(): Promise<number | undefined> {
  if (process.platform === "darwin") {
    const result = await runCommand("sysctl", ["-n", "vm.swapusage"], {
      timeoutMs: 2_000,
      env: { PATH: SAFE_EXEC_PATH, LANG: "C.UTF-8" },
    }).catch(() => null);
    const match = /used\s*=\s*([0-9.]+)([MG])?/iu.exec(result?.stdout.toString("utf8") ?? "");
    if (match?.[1]) {
      const value = Number(match[1]);
      return match[2]?.toUpperCase() === "G" ? value * 1024 ** 3 : value * 1024 ** 2;
    }
  }
  try {
    const source = await fs.readFile("/proc/meminfo", "utf8");
    const total = Number(/^SwapTotal:\s+(\d+)\s+kB$/mu.exec(source)?.[1]);
    const free = Number(/^SwapFree:\s+(\d+)\s+kB$/mu.exec(source)?.[1]);
    if (Number.isFinite(total) && Number.isFinite(free)) {
      return Math.max(0, total - free) * 1024;
    }
  } catch {}
  return undefined;
}

async function inspectThermalConstraint(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  const result = await runCommand("pmset", ["-g", "therm"], {
    timeoutMs: 2_000,
    env: { PATH: SAFE_EXEC_PATH, LANG: "C.UTF-8" },
  }).catch(() => null);
  const output = result?.stdout.toString("utf8") ?? "";
  const warning = /thermal warning level:\s*([1-9]\d*)/iu.test(output);
  const speedLimit = /CPU_Speed_Limit\s*=\s*(\d+)/iu.exec(output)?.[1];
  return warning || (speedLimit !== undefined && Number(speedLimit) < 90);
}

function ollamaNames(payload: unknown, key: "models"): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  // SAFETY: The object was narrowed above; only the requested list field is inspected.
  const values = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      // SAFETY: Each entry was narrowed to a non-null object before field inspection.
      const record = item as Record<string, unknown>;
      return typeof record.name === "string"
        ? record.name
        : typeof record.model === "string"
          ? record.model
          : undefined;
    })
    .filter((item): item is string => typeof item === "string")
    .toSorted();
}

export function modelNameMatchesRef(name: string, ref: string): boolean {
  const modelId = ref.replace(/^ollama\//u, "");
  return name === modelId || name === `${modelId}:latest`;
}

export async function inspectCapacity(config: ResolvedRingerConfig): Promise<CapacityStatus> {
  const reasons: string[] = [];
  const freeMemoryBytes = os.freemem();
  const swapUsedBytes = await inspectSwapUsedBytes();
  const thermalConstrained = await inspectThermalConstraint();
  const docker = await runCommand("docker", ["info", "--format", "{{json .ServerVersion}}"], {
    timeoutMs: 5_000,
    env: dockerEnv(config),
  }).catch(() => null);
  const dockerReady = docker?.code === 0;
  if (!dockerReady) {
    reasons.push("Docker daemon is unavailable.");
  }
  const image = dockerReady
    ? await runCommand("docker", ["image", "inspect", "--format", "{{.Id}}", config.dockerImage], {
        timeoutMs: 5_000,
        env: dockerEnv(config),
      }).catch(() => null)
    : null;
  const dockerImageSha256 = image?.stdout.toString("utf8").trim() || undefined;
  const dockerImageReady =
    image?.code === 0 && dockerImageSha256 === config.expectedDockerImageSha256;
  if (!dockerImageReady) {
    reasons.push(
      `Required Docker image is unavailable or drifted: ${config.dockerImage} (${dockerImageSha256 ?? "unavailable"}).`,
    );
  }
  const dockerWorkspaceMountReady =
    dockerReady && dockerImageReady ? await probeDockerWorkspaceMount(config) : false;
  if (!dockerWorkspaceMountReady) {
    reasons.push(
      "Docker cannot see and write the Local AI Assist state workspace; use a host path shared with the configured Docker runtime.",
    );
  }
  let installedModels: string[] = [];
  let residentModels: string[] = [];
  let ollamaReady = false;
  let ollamaProbeMs: number | undefined;
  try {
    const probeStarted = performance.now();
    installedModels = ollamaNames(
      await fetchOllamaJson(config.ollamaBaseUrl, "/api/tags"),
      "models",
    );
    ollamaProbeMs = performance.now() - probeStarted;
    ollamaReady = true;
    residentModels = ollamaNames(await fetchOllamaJson(config.ollamaBaseUrl, "/api/ps"), "models");
  } catch {
    reasons.push("Loopback Ollama is unavailable.");
  }
  const qualifiedModelRefs = config.allowedRepositories.flatMap((repository) =>
    repository.models.map((model) => model.ref),
  );
  const installedQualifiedModels = installedModels.filter((name) =>
    qualifiedModelRefs.some((ref) => modelNameMatchesRef(name, ref)),
  );
  const residentQualifiedModel = residentModels.some((name) =>
    qualifiedModelRefs.some((ref) => modelNameMatchesRef(name, ref)),
  );
  if (ollamaReady && installedQualifiedModels.length === 0) {
    reasons.push("No exact allowlisted Local AI Assist model is installed in Ollama.");
  }
  let admittedParallel: 0 | 1 | 2 = 0;
  if (
    dockerReady &&
    dockerImageReady &&
    dockerWorkspaceMountReady &&
    ollamaReady &&
    installedQualifiedModels.length > 0
  ) {
    admittedParallel = 1;
    if (
      config.maxParallel === 2 &&
      freeMemoryBytes >= config.minFreeMemoryBytesForTwoWorkers &&
      residentQualifiedModel &&
      (swapUsedBytes === undefined || swapUsedBytes <= 2 * 1024 ** 3) &&
      (ollamaProbeMs === undefined || ollamaProbeMs <= 1_500) &&
      !thermalConstrained
    ) {
      admittedParallel = 2;
    } else if (config.maxParallel === 2) {
      reasons.push(
        "Two-worker admission requires free-memory and swap headroom, a resident qualified model, responsive Ollama, and no thermal constraint.",
      );
    }
  }
  return {
    admittedParallel,
    dockerReady,
    dockerImageReady,
    dockerImageSha256,
    dockerWorkspaceMountReady,
    ollamaReady,
    installedModels,
    residentModels,
    freeMemoryBytes,
    swapUsedBytes,
    ollamaProbeMs,
    thermalConstrained,
    reasons,
  };
}

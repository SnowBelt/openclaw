// Runtime-only bridge from a prepared provider hook to the pure resource governor.
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { parseModelCatalogRef } from "@openclaw/model-catalog-core/model-catalog-refs";
import { findNormalizedProviderValue } from "@openclaw/model-catalog-core/provider-id";
import type { ModelProviderConfig } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";
import { resolveLsofCommand } from "../infra/ports-lsof.js";
import { resolveLoadedProviderRuntimePlugin } from "../plugins/provider-hook-runtime.js";
import type {
  ProviderModelResidencySnapshot,
  ProviderModelWarmupResult,
} from "../plugins/types.js";
import type { ControlDirectorResidentModel } from "./control-director-resource-governor.js";
import { readProviderJsonResponse } from "./provider-http-errors.js";

const GIB = 1024 ** 3;
const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_RESIDENT_MODELS = 32;
const execFile = promisify(execFileCallback);

export type ControlDirectorResidencyObservation = {
  available: boolean;
  observedProcessCount: number;
  residentModels: ControlDirectorResidentModel[];
  warnings: string[];
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeControlDirectorResidencyObservation(params: {
  provider: string;
  snapshot: ProviderModelResidencySnapshot;
  activeLocalWork: boolean;
}): ControlDirectorResidencyObservation {
  const seen = new Set<string>();
  const residentModels = (
    Array.isArray(params.snapshot.residentModels) ? params.snapshot.residentModels : []
  ).flatMap((entry) => {
    const modelId = nonEmptyString(entry?.modelId);
    if (!modelId) {
      return [];
    }
    const ref = `${params.provider}/${modelId}`;
    if (seen.has(ref) || seen.size >= MAX_RESIDENT_MODELS) {
      return [];
    }
    seen.add(ref);
    const bytes = finiteNonNegative(entry.estimatedMemoryBytes);
    return [
      {
        ref,
        state: params.activeLocalWork ? ("active" as const) : entry.state,
        estimatedMemoryGb: bytes == null ? 0 : Math.round((bytes / GIB) * 10) / 10,
      },
    ];
  });
  const observed = finiteNonNegative(params.snapshot.observedProcessCount);
  return {
    available: true,
    observedProcessCount: Math.min(
      MAX_RESIDENT_MODELS,
      Math.max(residentModels.length, Math.floor(observed ?? 0)),
    ),
    residentModels,
    warnings: Array.isArray(params.snapshot.warnings)
      ? params.snapshot.warnings.filter((value): value is string => nonEmptyString(value) != null)
      : [],
  };
}

function unavailable(reason: string): ControlDirectorResidencyObservation {
  return {
    available: false,
    observedProcessCount: 0,
    residentModels: [],
    warnings: [reason],
  };
}

function isPrivateLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    if (hostname === "localhost" || hostname.endsWith(".local")) {
      return true;
    }
    const version = isIP(hostname);
    if (version === 6) {
      return hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd");
    }
    if (version !== 4) {
      return false;
    }
    const octets = hostname.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  } catch {
    return false;
  }
}

function configuredGenericLocalResidencyProvider(
  config: OpenClawConfig | undefined,
  provider: string,
): ModelProviderConfig | undefined {
  const configured = findNormalizedProviderValue(config?.models?.providers, provider);
  if (
    !configured ||
    configured.route?.location !== "local" ||
    configured.api !== "openai-completions" ||
    !configured.localService?.command?.trim() ||
    !configured.localService.cwd?.trim() ||
    !configured.localService.args?.includes("--port") ||
    !isPrivateLocalEndpoint(configured.baseUrl)
  ) {
    return undefined;
  }
  const port = new URL(configured.baseUrl).port;
  const portIndex = configured.localService.args.indexOf("--port");
  if (!port || configured.localService.args[portIndex + 1] !== port) {
    return undefined;
  }
  return configured;
}

type OpenAICompatibleModelsPayload = {
  data?: OpenAICompatibleModelRow[];
  models?: OpenAICompatibleModelRow[];
};

type OpenAICompatibleModelRow = {
  id?: unknown;
  model?: unknown;
  name?: unknown;
};

type LocalServiceObservation = {
  available: boolean;
  processCount: number;
  pid?: number;
  reason?: string;
};

async function readExecutableFirstLine(path: string): Promise<string> {
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(4 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0] ?? "";
  } finally {
    await handle.close();
  }
}

function localServiceName(command: string): string {
  const normalized = command.trim().replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

async function observeLocalServiceProcess(params: {
  baseUrl: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<LocalServiceObservation> {
  let port: string;
  let hostname: string;
  try {
    const url = new URL(params.baseUrl);
    port = url.port;
    hostname = url.hostname;
  } catch {
    return { available: false, processCount: 0, reason: "local endpoint URL is invalid" };
  }
  if (!port) {
    return { available: false, processCount: 0, reason: "local endpoint has no explicit port" };
  }
  try {
    const lsof = await resolveLsofCommand();
    const result = await execFile(
      lsof,
      ["-nP", `-iTCP@${hostname}:${port}`, "-sTCP:LISTEN", "-Fp"],
      {
        timeout: Math.max(100, Math.min(5_000, params.timeoutMs)),
        maxBuffer: 64 * 1024,
        signal: params.signal,
      },
    );
    const expected = localServiceName(params.command);
    const pids = result.stdout
      .split("\n")
      .filter((line) => line.startsWith("p"))
      .map((line) => line.slice(1).trim())
      .filter(Boolean);
    if (pids.length !== 1) {
      return {
        available: false,
        processCount: pids.length,
        reason: `expected one listener on port ${port}, observed ${pids.length}`,
      };
    }
    const pid = Number(pids[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return { available: false, processCount: 0, reason: "listener PID is invalid" };
    }
    const commands = await Promise.all(
      pids.map(async (listenerPid) => {
        const process = await execFile("/bin/ps", ["-p", listenerPid, "-o", "command="], {
          timeout: Math.max(100, Math.min(5_000, params.timeoutMs)),
          maxBuffer: 64 * 1024,
          signal: params.signal,
        });
        return process.stdout.trim().toLowerCase();
      }),
    );
    const matching = commands.filter(
      (command) => command === expected || command.startsWith(`${expected}-`),
    );
    if (matching.length !== 1 || commands.length !== 1) {
      return {
        available: false,
        processCount: matching.length,
        reason: `expected one ${expected} listener on port ${port}, observed ${commands.join(", ") || "none"}`,
      };
    }
    const configuredCwd = await fs.realpath(params.cwd);
    const cwdResult = await execFile(lsof, ["-nP", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      timeout: Math.max(100, Math.min(5_000, params.timeoutMs)),
      maxBuffer: 64 * 1024,
      signal: params.signal,
    });
    const observedCwd = cwdResult.stdout
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1)
      .trim();
    if (!observedCwd || (await fs.realpath(observedCwd)) !== configuredCwd) {
      return {
        available: false,
        processCount: 1,
        reason: "local service working directory drifted",
      };
    }
    const shebang = (await readExecutableFirstLine(params.command)).match(/^#!\s*(\S+)/u)?.[1];
    const expectedExecutables = new Set<string>();
    for (const candidate of [params.command, shebang]) {
      if (!candidate) {
        continue;
      }
      try {
        const resolved = await fs.realpath(candidate);
        expectedExecutables.add(resolved);
        // On macOS, a framework-backed Python launched through a venv shebang
        // reports its paired Python.app executable to lsof. Derive that one
        // canonical sibling from the exact interpreter path; never accept a
        // directory-wide or basename-only interpreter match.
        const frameworkVersion = resolved.match(
          /^(.*\/Python\.framework\/Versions\/[^/]+)\/bin\/python[^/]*$/u,
        )?.[1];
        if (frameworkVersion) {
          expectedExecutables.add(`${frameworkVersion}/Resources/Python.app/Contents/MacOS/Python`);
        }
      } catch {
        return {
          available: false,
          processCount: 1,
          reason: "configured local executable cannot be resolved",
        };
      }
    }
    const executableResult = await execFile(
      lsof,
      ["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fn"],
      {
        timeout: Math.max(100, Math.min(5_000, params.timeoutMs)),
        maxBuffer: 256 * 1024,
        signal: params.signal,
      },
    );
    const observedExecutables = executableResult.stdout
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1).trim())
      .filter(Boolean);
    if (!observedExecutables.some((path) => expectedExecutables.has(path))) {
      return {
        available: false,
        processCount: 1,
        reason: "local service executable identity drifted",
      };
    }
    return { available: true, processCount: 1, pid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      processCount: 0,
      reason: `local process observation failed: ${message}`,
    };
  }
}

async function probeGenericLocalResidency(params: {
  provider: string;
  modelId: string;
  activeLocalWork: boolean;
  timeoutMs: number;
  providerConfig: ModelProviderConfig;
  observeProcess?: (params: {
    baseUrl: string;
    command: string;
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<LocalServiceObservation>;
}): Promise<ProviderModelResidencySnapshot> {
  const observeProcess = params.observeProcess ?? observeLocalServiceProcess;
  const budgetMs = Math.max(100, Math.min(5_000, params.timeoutMs));
  const deadline = Date.now() + budgetMs;
  const abortController = new AbortController();
  const deadlineTimer = setTimeout(() => abortController.abort(), budgetMs);
  deadlineTimer.unref?.();
  const remainingMs = (): number => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("local residency probe deadline exceeded");
    }
    return remaining;
  };
  const observe = async (): Promise<LocalServiceObservation> => {
    const timeoutMs = remainingMs();
    return await withDeadline({
      promise: observeProcess({
        baseUrl: params.providerConfig.baseUrl,
        command: params.providerConfig.localService?.command ?? "",
        cwd: params.providerConfig.localService?.cwd ?? "",
        timeoutMs,
        signal: abortController.signal,
      }),
      timeoutMs,
      timeoutMessage: "local service process observation deadline exceeded",
    });
  };
  try {
    const initialProcess = await observe();
    if (
      !initialProcess.available ||
      initialProcess.processCount !== 1 ||
      initialProcess.pid == null
    ) {
      throw new Error(initialProcess.reason ?? "local service process is not verified");
    }
    const baseUrl = params.providerConfig.baseUrl.replace(/\/+$/u, "");
    const expectedModelsUrl = new URL(`${baseUrl}/models`);
    const headers = new Headers({ accept: "application/json" });
    const apiKey = params.providerConfig.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) {
      headers.set("authorization", `Bearer ${apiKey.trim()}`);
    }
    const guarded = await fetchWithSsrFGuard({
      url: expectedModelsUrl.toString(),
      init: {
        headers,
        signal: abortController.signal,
      },
      maxRedirects: 0,
      timeoutMs: remainingMs(),
      policy: { allowPrivateNetwork: true },
      auditContext: `${params.provider}-generic-local-residency/models`,
    });
    try {
      if (!guarded.response.ok) {
        throw new Error(`HTTP ${guarded.response.status}`);
      }
      const finalUrl = new URL(guarded.finalUrl);
      if (
        finalUrl.origin !== expectedModelsUrl.origin ||
        finalUrl.pathname !== expectedModelsUrl.pathname ||
        finalUrl.search !== expectedModelsUrl.search
      ) {
        throw new Error("local service model catalog origin or path changed");
      }
      const payload = await withDeadline({
        promise: readProviderJsonResponse<OpenAICompatibleModelsPayload>(
          guarded.response,
          `${params.provider} generic local residency`,
          { maxBytes: 256 * 1024 },
        ),
        timeoutMs: remainingMs(),
        timeoutMessage: "local service model catalog deadline exceeded",
      });
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("local service model catalog payload is not an object");
      }
      const hasData = Object.hasOwn(payload, "data");
      const hasModels = Object.hasOwn(payload, "models");
      if (hasData === hasModels) {
        throw new Error("local service model catalog must contain exactly one model collection");
      }
      const rows = hasData ? payload.data : payload.models;
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error("local service model catalog must contain exactly one row");
      }
      const row = rows[0];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("local service model catalog row is invalid");
      }
      const modelIds = [row.id, row.model, row.name].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      if (modelIds.length !== 1 || modelIds[0] !== params.modelId) {
        throw new Error(
          `local service model catalog is not an exact single-model match for ${params.provider}`,
        );
      }
      const finalProcess = await observe();
      if (
        !finalProcess.available ||
        finalProcess.processCount !== 1 ||
        finalProcess.pid !== initialProcess.pid
      ) {
        throw new Error("local service process changed during residency probe");
      }
      return {
        residentModels: [
          {
            modelId: modelIds[0],
            state: params.activeLocalWork ? ("active" as const) : ("idle" as const),
          },
        ],
        observedProcessCount: finalProcess.processCount,
        warnings: [
          "Local residency is trusted only when one configured local service process owns the private endpoint and its /models response contains exactly the configured model.",
        ],
      };
    } finally {
      await guarded.release();
    }
  } finally {
    clearTimeout(deadlineTimer);
    abortController.abort();
  }
}

async function withDeadline<T>(params: {
  promise: Promise<T>;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      params.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(params.timeoutMessage)), params.timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Query only the already-loaded provider handle; never trigger broad plugin discovery here. */
export async function collectControlDirectorResidencyObservation(params: {
  config: OpenClawConfig;
  selectedModel: string;
  activeLocalWork: boolean;
  timeoutMs?: number;
  runtime?: {
    observeLocalService?: typeof observeLocalServiceProcess;
  };
}): Promise<ControlDirectorResidencyObservation> {
  const parsed = parseModelCatalogRef(params.selectedModel);
  if (!parsed) {
    return unavailable(
      "The selected Control Director model reference is invalid; residency is unavailable.",
    );
  }
  const plugin = resolveLoadedProviderRuntimePlugin({
    provider: parsed.provider,
    modelId: parsed.modelId,
    config: params.config,
  });
  if (!plugin?.probeModelResidency) {
    const genericProvider = configuredGenericLocalResidencyProvider(params.config, parsed.provider);
    if (genericProvider) {
      try {
        return normalizeControlDirectorResidencyObservation({
          provider: parsed.provider,
          snapshot: await probeGenericLocalResidency({
            provider: parsed.provider,
            modelId: parsed.modelId,
            activeLocalWork: params.activeLocalWork,
            timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            providerConfig: genericProvider,
            observeProcess: params.runtime?.observeLocalService,
          }),
          activeLocalWork: params.activeLocalWork,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return unavailable(
          `Provider ${parsed.provider} generic local residency probe failed: ${message}`,
        );
      }
    }
    return unavailable(
      `Provider ${parsed.provider} does not expose a loaded runtime residency probe; admission remains fail-safe.`,
    );
  }
  const timeoutMs = Math.max(100, Math.min(5_000, params.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  try {
    const snapshot = await withDeadline({
      promise: plugin.probeModelResidency({
        config: params.config,
        provider: parsed.provider,
        modelId: parsed.modelId,
        timeoutMs,
      }),
      timeoutMs: timeoutMs + 100,
      timeoutMessage: "provider residency probe timed out",
    });
    if (!snapshot) {
      return unavailable(`Provider ${parsed.provider} returned no residency snapshot.`);
    }
    return normalizeControlDirectorResidencyObservation({
      provider: parsed.provider,
      snapshot,
      activeLocalWork: params.activeLocalWork,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(`Provider ${parsed.provider} residency probe failed: ${message}`);
  }
}

export type ControlDirectorModelWarmupResult = {
  available: boolean;
  ready: boolean;
  provider: string;
  modelId: string;
  result?: ProviderModelWarmupResult;
  reason: string;
};

/** Invoke only an already-loaded provider warmup hook after resource admission. */
export async function requestControlDirectorModelWarmup(params: {
  config: OpenClawConfig;
  selectedModel: string;
  keepAliveMs: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ControlDirectorModelWarmupResult> {
  const parsed = parseModelCatalogRef(params.selectedModel);
  if (!parsed) {
    return {
      available: false,
      ready: false,
      provider: "unknown",
      modelId: params.selectedModel,
      reason: "The selected Control Director model reference is invalid; warmup is unavailable.",
    };
  }
  const plugin = resolveLoadedProviderRuntimePlugin({
    provider: parsed.provider,
    modelId: parsed.modelId,
    config: params.config,
  });
  if (!plugin?.warmModel) {
    return {
      available: false,
      ready: false,
      provider: parsed.provider,
      modelId: parsed.modelId,
      reason: `Provider ${parsed.provider} does not expose a loaded runtime warmup hook.`,
    };
  }
  const timeoutMs = Math.max(
    1_000,
    Math.min(5 * 60_000, Math.floor(Number.isFinite(params.timeoutMs) ? params.timeoutMs : 1_000)),
  );
  try {
    const result = await withDeadline({
      promise: plugin.warmModel({
        config: params.config,
        provider: parsed.provider,
        modelId: parsed.modelId,
        timeoutMs,
        keepAliveMs: params.keepAliveMs,
        signal: params.signal,
      }),
      timeoutMs: timeoutMs + 250,
      timeoutMessage: "provider model warmup timed out",
    });
    if (!result?.ready) {
      return {
        available: true,
        ready: false,
        provider: parsed.provider,
        modelId: parsed.modelId,
        ...(result ? { result } : {}),
        reason: `Provider ${parsed.provider} did not confirm that the selected model is ready.`,
      };
    }
    return {
      available: true,
      ready: true,
      provider: parsed.provider,
      modelId: parsed.modelId,
      result,
      reason: `Provider ${parsed.provider} confirmed that ${parsed.modelId} is ready.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: true,
      ready: false,
      provider: parsed.provider,
      modelId: parsed.modelId,
      reason: `Provider ${parsed.provider} model warmup failed: ${message}`,
    };
  }
}

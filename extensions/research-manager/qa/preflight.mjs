#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "../../..");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config" || argument === "--doctor" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.`);
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeText(value) {
  return String(value)
    .replace(
      /((?:sk|key|token|secret|password|authorization)[-_a-z0-9]*)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .slice(0, 2_000);
}

async function readPackageVersion(relativePath) {
  const raw = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  const parsed = JSON.parse(raw);
  if (!readString(parsed.version)) {
    throw new Error(`${relativePath} has no version.`);
  }
  return parsed.version;
}

async function readDeclaredCodexHarnessVersion() {
  const raw = await fs.readFile(path.join(repoRoot, "extensions/codex/package.json"), "utf8");
  const parsed = JSON.parse(raw);
  const version = readString(asRecord(parsed.dependencies)["@openai/codex"]);
  if (!version) {
    throw new Error("extensions/codex/package.json does not declare @openai/codex.");
  }
  return version;
}

function summarizeConfig(config) {
  const root = asRecord(config);
  const plugins = asRecord(root.plugins);
  const entries = asRecord(plugins.entries);
  const agents = asRecord(root.agents);
  const defaults = asRecord(agents.defaults);
  const defaultModel = asRecord(defaults.model);
  const configuredModels = asRecord(defaults.models);
  const researchEntry = asRecord(entries["research-manager"]);
  const researchConfig = asRecord(researchEntry.config);
  const researchModels = Array.isArray(researchConfig.models) ? researchConfig.models : [];
  return {
    enabledPluginIds: Object.entries(entries)
      .filter(([, value]) => asRecord(value).enabled !== false)
      .map(([id]) => id)
      .toSorted(),
    pluginLoadPathCount: Array.isArray(asRecord(plugins.load).paths)
      ? asRecord(plugins.load).paths.length
      : 0,
    researchManager: {
      configured: Object.hasOwn(entries, "research-manager"),
      enabled: researchEntry.enabled === true,
      defaultMode: readString(researchConfig.defaultMode) ?? "default",
      certificationThreshold:
        typeof researchConfig.certificationThreshold === "number"
          ? researchConfig.certificationThreshold
          : 93,
      models: researchModels.flatMap((entry) => {
        const model = asRecord(entry);
        const id = readString(model.id);
        const provider = readString(model.provider);
        const modelName = readString(model.model);
        return id && provider && modelName
          ? [
              {
                id,
                provider,
                model: modelName,
                roles: Array.isArray(model.roles)
                  ? model.roles.filter((role) => typeof role === "string")
                  : [],
                enabled: model.enabled !== false,
                memoryGb: typeof model.memoryGb === "number" ? model.memoryGb : null,
                contextTokens: typeof model.contextTokens === "number" ? model.contextTokens : null,
              },
            ]
          : [];
      }),
    },
    agentModels: {
      primary: readString(defaultModel.primary),
      fallbacks: Array.isArray(defaultModel.fallbacks)
        ? defaultModel.fallbacks.filter((entry) => typeof entry === "string")
        : [],
      catalogIds: Object.keys(configuredModels).toSorted(),
    },
  };
}

function resolveOllamaBaseUrl(config) {
  const providers = asRecord(asRecord(asRecord(config).models).providers);
  const ollama = asRecord(providers.ollama);
  return (readString(ollama.baseUrl) ?? readString(ollama.baseURL) ?? "http://127.0.0.1:11434")
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");
}

async function fetchJson(url, timeoutMs = 5_000) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  }
  return await response.json();
}

async function readOllama(config) {
  const baseUrl = resolveOllamaBaseUrl(config);
  const checkedAt = new Date().toISOString();
  try {
    const [tags, running, version] = await Promise.all([
      fetchJson(`${baseUrl}/api/tags`),
      fetchJson(`${baseUrl}/api/ps`).catch(() => ({ models: [] })),
      fetchJson(`${baseUrl}/api/version`).catch(() => ({})),
    ]);
    const runningByModel = new Map(
      (Array.isArray(running.models) ? running.models : []).flatMap((entry) => {
        const row = asRecord(entry);
        const model = readString(row.model) ?? readString(row.name);
        return model ? [[model.replace(/:latest$/i, "").toLowerCase(), row]] : [];
      }),
    );
    const models = (Array.isArray(tags.models) ? tags.models : []).flatMap((entry) => {
      const row = asRecord(entry);
      const details = asRecord(row.details);
      const name = readString(row.name) ?? readString(row.model);
      const model = readString(row.model) ?? name;
      if (!name || !model) {
        return [];
      }
      const loaded = runningByModel.get(model.replace(/:latest$/i, "").toLowerCase());
      return [
        {
          name,
          model,
          sizeBytes: typeof row.size === "number" ? row.size : 0,
          parameterSize: readString(details.parameter_size),
          quantization: readString(details.quantization_level),
          loaded: Boolean(loaded),
          loadedSizeBytes:
            typeof loaded?.size_vram === "number"
              ? loaded.size_vram
              : typeof loaded?.size === "number"
                ? loaded.size
                : 0,
          contextLength:
            typeof loaded?.context_length === "number" ? loaded.context_length : undefined,
          processor: readString(loaded?.processor),
        },
      ];
    });
    return {
      baseUrl,
      reachable: true,
      checkedAt,
      version: readString(asRecord(version).version),
      models: models.toSorted((left, right) => left.name.localeCompare(right.name)),
      totalLoadedBytes: models.reduce((sum, model) => sum + model.loadedSizeBytes, 0),
    };
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      checkedAt,
      models: [],
      totalLoadedBytes: 0,
      error: safeText(error instanceof Error ? error.message : error),
    };
  }
}

function createJsonRpcClient(child, timeoutMs) {
  let nextId = 1;
  let buffered = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined) {
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) {
        continue;
      }
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) {
        waiter.reject(new Error(safeText(JSON.stringify(message.error))));
      } else {
        waiter.resolve(message.result);
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const notify = (method, params) => {
    child.stdin.write(
      `${JSON.stringify(params === undefined ? { method } : { method, params })}\n`,
    );
  };
  return { request, notify };
}

async function readCodexCatalog() {
  const codexPackage = path.join(repoRoot, "node_modules/@openai/codex/package.json");
  const codexRoot = path.dirname(codexPackage);
  const codexBin = path.join(codexRoot, "bin/codex.js");
  const checkedAt = new Date().toISOString();
  let stderr = "";
  const child = spawn(process.execPath, [codexBin, "app-server", "--listen", "stdio://"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  const rpc = createJsonRpcClient(child, 30_000);
  try {
    const initialized = asRecord(
      await rpc.request("initialize", {
        clientInfo: { name: "research-manager-preflight", title: "Research Manager", version: "1" },
        capabilities: { experimentalApi: true },
      }),
    );
    rpc.notify("initialized");
    const models = [];
    let cursor = null;
    for (let page = 0; page < 20; page += 1) {
      const response = asRecord(
        await rpc.request("model/list", { limit: 100, cursor, includeHidden: true }),
      );
      const data = Array.isArray(response.data) ? response.data : [];
      for (const entry of data) {
        const model = asRecord(entry);
        const id = readString(model.id);
        if (!id) {
          continue;
        }
        models.push({
          id,
          model: readString(model.model) ?? id,
          hidden: model.hidden === true,
          isDefault: model.isDefault === true,
          inputModalities: Array.isArray(model.inputModalities)
            ? model.inputModalities.filter((value) => typeof value === "string")
            : [],
          reasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
            ? model.supportedReasoningEfforts.flatMap((value) => {
                const effort = readString(asRecord(value).reasoningEffort);
                return effort ? [effort] : [];
              })
            : [],
        });
      }
      cursor = readString(response.nextCursor) ?? null;
      if (!cursor) {
        break;
      }
    }
    return {
      reachable: true,
      checkedAt,
      userAgent: readString(initialized.userAgent),
      models: models.toSorted((left, right) => left.id.localeCompare(right.id)),
    };
  } catch (error) {
    return {
      reachable: false,
      checkedAt,
      models: [],
      error: safeText(
        `${error instanceof Error ? error.message : String(error)}${stderr ? `; ${stderr}` : ""}`,
      ),
    };
  } finally {
    child.stdin.end();
    await Promise.race([
      new Promise((resolve) => {
        child.once("exit", resolve);
      }),
      new Promise((resolve) => {
        setTimeout(resolve, 1_000);
      }),
    ]);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
}

function sanitizeDoctor(raw) {
  const doctor = asRecord(raw);
  return {
    ok: doctor.ok === true,
    checkedAt: readString(doctor.checkedAt),
    nodeVersion: readString(doctor.nodeVersion),
    openclawVersion: readString(doctor.openclawVersion),
    storage: {
      backend: readString(asRecord(doctor.storage).backend),
      durable: asRecord(doctor.storage).durable === true,
    },
    webSearchProviders: Array.isArray(doctor.webSearchProviders)
      ? doctor.webSearchProviders.filter((value) => typeof value === "string")
      : [],
    models: (Array.isArray(doctor.models) ? doctor.models : []).map((entry) => {
      const status = asRecord(entry);
      const model = asRecord(status.model);
      return {
        id: readString(model.id),
        provider: readString(model.provider),
        model: readString(model.model),
        role: readString(status.role),
        configured: status.configured === true,
        reachable: status.reachable,
        installed: status.installed,
        loaded: status.loaded,
        compatible: status.compatible === true,
        qualified: status.qualified === true,
        busy: status.busy === true,
        reasons: Array.isArray(status.reasons) ? status.reasons.map(safeText) : [],
      };
    }),
    probes: (Array.isArray(doctor.probes) ? doctor.probes : []).map((entry) => {
      const probe = asRecord(entry);
      return Object.assign(
        {
          modelId: readString(probe.modelId),
          ok: probe.ok === true,
          durationMs: typeof probe.durationMs === "number" ? probe.durationMs : 0,
        },
        probe.error ? { error: safeText(probe.error) } : {},
      );
    }),
    issues: Array.isArray(doctor.issues) ? doctor.issues.map(safeText) : [],
    warnings: Array.isArray(doctor.warnings) ? doctor.warnings.map(safeText) : [],
    resourceLimits: asRecord(doctor.resourceLimits),
    scheduler: {
      activeCount: Array.isArray(asRecord(doctor.scheduler).active)
        ? asRecord(doctor.scheduler).active.length
        : 0,
      queuedCount: Array.isArray(asRecord(doctor.scheduler).queued)
        ? asRecord(doctor.scheduler).queued.length
        : 0,
    },
  };
}

function semverAtLeast(value, minimum) {
  const numbers = String(value)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const required = minimum.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(numbers.length, required.length); index += 1) {
    const left = numbers[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  return true;
}

async function writeAtomic(file, value) {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target);
  return target;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(
    options.config ??
      process.env.OPENCLAW_CONFIG_PATH ??
      path.join(os.homedir(), ".openclaw", "openclaw.json"),
  );
  const outputPath = path.resolve(
    options.output ?? path.join(qaDir, "artifacts", "preflight-current.json"),
  );
  let configRaw;
  let config;
  let configError;
  try {
    configRaw = await fs.readFile(configPath, "utf8");
    config = JSON5.parse(configRaw);
  } catch (error) {
    configError = safeText(error instanceof Error ? error.message : error);
    config = {};
  }
  const [openclawVersion, researchManagerVersion, codexHarnessVersion, ollama, codexCatalog] =
    await Promise.all([
      readPackageVersion("package.json"),
      readPackageVersion("extensions/research-manager/package.json"),
      readDeclaredCodexHarnessVersion().then(async (declared) => {
        const installed = await readPackageVersion("node_modules/@openai/codex/package.json");
        if (declared !== installed) {
          throw new Error(`Declared Codex ${declared} does not match installed ${installed}.`);
        }
        return installed;
      }),
      readOllama(config),
      readCodexCatalog(),
    ]);
  let doctor;
  if (options.doctor) {
    doctor = sanitizeDoctor(JSON.parse(await fs.readFile(path.resolve(options.doctor), "utf8")));
  }
  const configSummary = summarizeConfig(config);
  const sol = codexCatalog.models.find((model) => model.id === "gpt-5.6-sol");
  const absoluteMemoryGb = Number(doctor?.resourceLimits?.absoluteMemoryGb ?? 150);
  const gates = [
    {
      id: "active-config-readable",
      passed: Boolean(configRaw && !configError),
      detail: configError ?? configPath,
    },
    {
      id: "research-manager-enabled",
      passed: configSummary.researchManager.enabled,
      detail: configSummary.researchManager.enabled ? "enabled" : "not enabled",
    },
    {
      id: "codex-harness-version",
      passed: semverAtLeast(codexHarnessVersion, "0.144.5"),
      detail: codexHarnessVersion,
    },
    {
      id: "sol-live-catalog",
      passed: Boolean(
        codexCatalog.reachable &&
        sol &&
        ["high", "xhigh", "max", "ultra"].every((effort) => sol.reasoningEfforts.includes(effort)),
      ),
      detail: sol ? sol.reasoningEfforts.join(",") : (codexCatalog.error ?? "missing"),
    },
    {
      id: "ollama-reachable",
      passed: ollama.reachable,
      detail: ollama.reachable ? `${ollama.models.length} installed` : ollama.error,
    },
    {
      id: "host-memory-budget",
      passed: os.totalmem() / 1024 ** 3 >= absoluteMemoryGb,
      detail: `${(os.totalmem() / 1024 ** 3).toFixed(2)} GB host / ${absoluteMemoryGb} GB cap`,
    },
    {
      id: "doctor-receipt-present",
      passed: Boolean(doctor),
      detail: doctor ? "present" : "missing",
    },
    {
      id: "doctor-passed",
      passed: doctor?.ok === true,
      detail: doctor
        ? `${doctor.issues.length} issue(s), ${doctor.warnings.length} warning(s)`
        : "missing",
    },
  ];
  const checkedAt = new Date().toISOString();
  const withoutHash = {
    schemaVersion: 1,
    program: "research-manager",
    status: gates.every((gate) => gate.passed) ? "passed" : doctor ? "failed" : "incomplete",
    checkedAt,
    runtime: {
      nodeVersion: process.version,
      nodeExecutable: process.execPath,
      platform: process.platform,
      architecture: process.arch,
      hostMemoryBytes: os.totalmem(),
      openclawVersion,
      researchManagerVersion,
      codexHarnessVersion,
    },
    activeConfig: {
      path: configPath,
      readable: Boolean(configRaw && !configError),
      ...(configRaw ? { sha256: sha256(configRaw), byteLength: Buffer.byteLength(configRaw) } : {}),
      ...(configError ? { error: configError } : {}),
      summary: configSummary,
    },
    ollama,
    codexCatalog,
    ...(doctor ? { doctor } : {}),
    gates,
  };
  const receipt = { ...withoutHash, receiptSha256: sha256(JSON.stringify(withoutHash)) };
  await writeAtomic(outputPath, receipt);
  process.stdout.write(
    `${JSON.stringify({ output: outputPath, status: receipt.status, gates }, null, 2)}\n`,
  );
  if (receipt.status !== "passed") {
    process.exitCode = 2;
  }
}

await main();

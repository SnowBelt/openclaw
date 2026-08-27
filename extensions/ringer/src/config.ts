import os from "node:os";
import path from "node:path";
import {
  asOptionalRecord,
  normalizeOptionalString,
} from "openclaw/plugin-sdk/string-coerce-runtime";
import type { OpenClawConfig } from "../api.js";
import {
  RINGER_COMMIT,
  RINGER_SCRIPT_SHA256,
  type ResolvedRingerConfig,
  type RingerModelPolicy,
  type RingerRepositoryPolicy,
  type RingerRole,
} from "./types.js";

const DEFAULT_MAX_PATCH_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_STORAGE_BYTES = 16 * 1024 * 1024 * 1024;
const DEFAULT_MIN_FREE_MEMORY_BYTES = 64 * 1024 * 1024 * 1024;
const ROLES = new Set<RingerRole>(["code", "clerical", "analysis", "critic"]);

function asNonArrayRecord(value: unknown): Record<string, unknown> {
  return asOptionalRecord(value) ?? {};
}

function supportedModelRoles(model: RingerModelPolicy): boolean {
  const id = model.ref.slice("ollama/".length).toLowerCase();
  const isCode = id.includes("qwen3-coder-next") || (id.includes("qwen3.6") && id.includes("27b"));
  const isClerical =
    id.includes("qwen3.5:4b") ||
    id.includes("qwen3.5-4b") ||
    id.includes("qwen3.5:9b") ||
    id.includes("qwen3.5-9b");
  const isGemmaAdvisory = id.includes("gemma4") && id.includes("31b");
  if (isCode) {
    return model.roles.every((role) => ROLES.has(role));
  }
  if (isClerical) {
    return model.roles.every((role) => role === "clerical" || role === "analysis");
  }
  if (isGemmaAdvisory) {
    return model.roles.every((role) => role === "analysis" || role === "critic");
  }
  return false;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function resolveStateBase(env: NodeJS.ProcessEnv): string {
  const configured = normalizeOptionalString(env.OPENCLAW_STATE_DIR);
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".openclaw");
}

function parseModel(value: unknown): RingerModelPolicy | null {
  const record = asNonArrayRecord(value);
  const ref = normalizeOptionalString(record.ref);
  const rawRoles = record.roles;
  const roles = Array.isArray(rawRoles)
    ? rawRoles.filter((role): role is RingerRole => typeof role === "string")
    : [];
  if (
    !ref?.startsWith("ollama/") ||
    roles.length === 0 ||
    roles.length !== (Array.isArray(rawRoles) ? rawRoles.length : 0) ||
    !roles.every((role) => ROLES.has(role)) ||
    typeof record.contextWindow !== "number" ||
    !Number.isInteger(record.contextWindow) ||
    record.contextWindow < 4096 ||
    record.contextWindow > 262_144 ||
    typeof record.maxTokens !== "number" ||
    !Number.isInteger(record.maxTokens) ||
    record.maxTokens < 512 ||
    record.maxTokens > 65_536
  ) {
    return null;
  }
  return {
    ref,
    contextWindow: record.contextWindow,
    maxTokens: record.maxTokens,
    roles: [...new Set(roles)],
    canaryApproved: record.canaryApproved === true,
  };
}

function parseRepository(value: unknown): RingerRepositoryPolicy | null {
  const record = asNonArrayRecord(value);
  const root = normalizeOptionalString(record.root);
  const checkArgvPrefixes = Array.isArray(record.checkArgvPrefixes)
    ? record.checkArgvPrefixes
        .filter((prefix): prefix is unknown[] => Array.isArray(prefix))
        .map((prefix) =>
          prefix.filter((part): part is string => typeof part === "string" && part.length > 0),
        )
        .filter((prefix) => prefix.length > 0)
    : [];
  const models = Array.isArray(record.models)
    ? record.models.map(parseModel).filter((model): model is RingerModelPolicy => model !== null)
    : [];
  if (!root || checkArgvPrefixes.length === 0 || models.length === 0) {
    return null;
  }
  return { root: path.resolve(root), checkArgvPrefixes, models };
}

export function resolveRingerConfig(
  raw: Record<string, unknown> | undefined,
  _appConfig: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRingerConfig {
  const config = asNonArrayRecord(raw);
  const allowedRepositories = Array.isArray(config.allowedRepositories)
    ? config.allowedRepositories
        .map(parseRepository)
        .filter((repo): repo is RingerRepositoryPolicy => repo !== null)
    : [];
  return {
    enabled: config.enabled === true,
    productionEnabled: config.productionEnabled === true,
    ringerSourceDir: normalizeOptionalString(config.ringerSourceDir),
    expectedRingerCommit: normalizeOptionalString(config.expectedRingerCommit) ?? RINGER_COMMIT,
    expectedRingerSha256:
      normalizeOptionalString(config.expectedRingerSha256) ?? RINGER_SCRIPT_SHA256,
    ringerConfigPath: normalizeOptionalString(config.ringerConfigPath),
    expectedRingerConfigSha256: normalizeOptionalString(config.expectedRingerConfigSha256),
    openclawCliPath: normalizeOptionalString(config.openclawCliPath),
    ollamaBaseUrl: normalizeOptionalString(config.ollamaBaseUrl) ?? "http://127.0.0.1:11434",
    dockerHost:
      normalizeOptionalString(config.dockerHost) ?? normalizeOptionalString(env.DOCKER_HOST),
    dockerImage: normalizeOptionalString(config.dockerImage) ?? "openclaw-sandbox:bookworm-slim",
    expectedDockerImageSha256: normalizeOptionalString(config.expectedDockerImageSha256),
    expectedOpenclawCliSha256: normalizeOptionalString(config.expectedOpenclawCliSha256),
    expectedOpenclawVersion: normalizeOptionalString(config.expectedOpenclawVersion),
    expectedWorkerSha256: normalizeOptionalString(config.expectedWorkerSha256),
    expectedVerifierSha256: normalizeOptionalString(config.expectedVerifierSha256),
    qualificationReceiptPath: normalizeOptionalString(config.qualificationReceiptPath),
    expectedQualificationReceiptSha256: normalizeOptionalString(
      config.expectedQualificationReceiptSha256,
    ),
    expectedPolicySha256: normalizeOptionalString(config.expectedPolicySha256),
    stateDir: path.resolve(
      normalizeOptionalString(config.stateDir) ?? path.join(resolveStateBase(env), "ringer"),
    ),
    callerSecret: config.callerSecret,
    maxParallel: boundedInteger(config.maxParallel, 2, 1, 2),
    maxTasks: boundedInteger(config.maxTasks, 4, 2, 8),
    maxPatchBytes: boundedInteger(
      config.maxPatchBytes,
      DEFAULT_MAX_PATCH_BYTES,
      1024,
      20 * 1024 * 1024,
    ),
    maxSnapshotBytes: boundedInteger(
      config.maxSnapshotBytes,
      DEFAULT_MAX_SNAPSHOT_BYTES,
      1024,
      512 * 1024 * 1024,
    ),
    maxSnapshotStorageBytes: boundedInteger(
      config.maxSnapshotStorageBytes,
      DEFAULT_MAX_SNAPSHOT_STORAGE_BYTES,
      256 * 1024 * 1024,
      128 * 1024 * 1024 * 1024,
    ),
    rawRetentionDays: boundedInteger(config.rawRetentionDays, 7, 1, 30),
    receiptRetentionDays: boundedInteger(config.receiptRetentionDays, 30, 7, 365),
    minFreeMemoryBytesForTwoWorkers: boundedInteger(
      config.minFreeMemoryBytesForTwoWorkers,
      DEFAULT_MIN_FREE_MEMORY_BYTES,
      1024 * 1024 * 1024,
      Number.MAX_SAFE_INTEGER,
    ),
    allowedRepositories,
  };
}

export function validateEnabledRingerConfig(config: ResolvedRingerConfig): string[] {
  if (!config.enabled) {
    return [];
  }
  const errors: string[] = [];
  const required: Array<[string, string | undefined]> = [
    ["ringerSourceDir", config.ringerSourceDir],
    ["ringerConfigPath", config.ringerConfigPath],
    ["expectedRingerConfigSha256", config.expectedRingerConfigSha256],
    ["openclawCliPath", config.openclawCliPath],
    ["dockerHost", config.dockerHost],
    ["expectedDockerImageSha256", config.expectedDockerImageSha256],
    ["expectedOpenclawCliSha256", config.expectedOpenclawCliSha256],
    ["expectedOpenclawVersion", config.expectedOpenclawVersion],
    ["expectedWorkerSha256", config.expectedWorkerSha256],
    ["expectedVerifierSha256", config.expectedVerifierSha256],
    ["expectedPolicySha256", config.expectedPolicySha256],
  ];
  for (const [key, value] of required) {
    if (!value) {
      errors.push(`${key} is required when Local AI Assist is enabled.`);
    }
  }
  const callerSecret = asNonArrayRecord(config.callerSecret);
  if (callerSecret.source !== "file") {
    errors.push("callerSecret must be a file-backed SecretRef.");
  }
  if (config.allowedRepositories.length === 0) {
    errors.push("At least one allowedRepositories entry is required.");
  }
  if (
    config.productionEnabled &&
    (!config.qualificationReceiptPath || !config.expectedQualificationReceiptSha256)
  ) {
    errors.push(
      "qualificationReceiptPath and expectedQualificationReceiptSha256 are required when productionEnabled=true.",
    );
  }
  for (const repository of config.allowedRepositories) {
    for (const model of repository.models) {
      if (!supportedModelRoles(model)) {
        errors.push(`Unsupported Local AI Assist model or role assignment: ${model.ref}.`);
      }
    }
  }
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(config.ollamaBaseUrl)) {
    errors.push("ollamaBaseUrl must be an HTTP loopback URL.");
  }
  if (
    config.dockerHost &&
    (!config.dockerHost.startsWith("unix:///") ||
      !path.isAbsolute(config.dockerHost.slice("unix://".length)) ||
      config.dockerHost.includes("\0") ||
      config.dockerHost.includes("\r") ||
      config.dockerHost.includes("\n"))
  ) {
    errors.push("dockerHost must be an absolute unix:/// socket URL.");
  }
  if (
    config.expectedDockerImageSha256 &&
    !/^sha256:[0-9a-f]{64}$/u.test(config.expectedDockerImageSha256)
  ) {
    errors.push("expectedDockerImageSha256 must be a sha256:<64 lowercase hex> image ID.");
  }
  return errors;
}

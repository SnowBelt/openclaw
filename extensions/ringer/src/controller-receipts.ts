// SAFETY-RATCHET: template-aware
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateEnabledRingerConfig } from "./config.js";
import { computeEnvironmentDigest, verifyPins } from "./pins.js";
import type {
  ResolvedRingerConfig,
  RingerAdapterManifest,
  RingerRunReceipt,
  RingerTaskManifest,
  RingerTaskReceipt,
} from "./types.js";

export type GateName = "lint" | "dry_run" | "baseline";
export type GateReceipt = {
  schemaVersion: 1;
  gate: GateName;
  manifestSha256: string;
  snapshotId: string;
  sourceSha: string;
  pinsDigest: string;
  completedAt: string;
  outputSha256: string;
  baseline?: Record<string, "pass" | "fail">;
};

const RUN_RECEIPT_KEYS = new Set([
  "runId",
  "nativeRunId",
  "runName",
  "manifestSha256",
  "snapshotId",
  "sourceSha",
  "pid",
  "status",
  "action",
  "runKind",
  "startedAt",
  "finishedAt",
  "exitCode",
  "logPath",
  "tasks",
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
const TASK_RECEIPT_KEYS = new Set([
  "key",
  "status",
  "attempts",
  "model",
  "artifactDir",
  "sessionAttempts",
  "modelCompletions",
  "sessionRetries",
]);
const GATE_RECEIPT_KEYS = new Set([
  "schemaVersion",
  "gate",
  "manifestSha256",
  "snapshotId",
  "sourceSha",
  "pinsDigest",
  "completedAt",
  "outputSha256",
  "baseline",
]);
const RUN_ID_PATTERN = /^run-[a-f0-9-]{36}$/u;
const NATIVE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const SNAPSHOT_ID_PATTERN = /^snap-[a-f0-9]{24}$/u;

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Preserve per-task native results even when the aggregate Ringer process exits
 * nonzero. A failed sibling must not erase successful task receipts or attempt
 * counts from the durable adapter receipt.
 */
export function buildNativeTaskReceipts(params: {
  manifestTasks: RingerTaskManifest[];
  nativeTasks: unknown[];
  artifactRoot: string;
  validArtifacts: ReadonlyMap<string, boolean>;
  artifactTelemetry?: ReadonlyMap<
    string,
    { sessionAttempts: number; modelCompletions: number; sessionRetries: number }
  >;
}): RingerTaskReceipt[] {
  return params.manifestTasks.map((task) => {
    const nativeTask = params.nativeTasks.find(
      (item): item is Record<string, unknown> => isObjectRecord(item) && item.key === task.key,
    );
    const artifactDir = path.join(params.artifactRoot, task.key);
    const valid = nativeTask?.status === "pass" && params.validArtifacts.get(task.key) === true;
    const telemetry = params.artifactTelemetry?.get(task.key);
    return {
      key: task.key,
      status: valid ? "pass" : "fail",
      attempts: typeof nativeTask?.attempts === "number" ? nativeTask.attempts : 0,
      model: task.model,
      artifactDir,
      ...telemetry,
    };
  });
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600);
}

export async function readJson<T>(file: string): Promise<T> {
  // SAFETY: Callers provide the receipt-specific parser or trusted typed shape for this JSON file.
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown field(s): ${unknown.toSorted().join(", ")}.`);
  }
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseRunReceipt(
  raw: unknown,
  config: ResolvedRingerConfig,
  expectedRunId: string,
): RingerRunReceipt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Run receipt must be an object.");
  }
  // SAFETY: The object/array shape was narrowed immediately above; exact keys are validated next.
  const record = raw as Record<string, unknown>;
  assertExactKeys(record, RUN_RECEIPT_KEYS, "Run receipt");
  if (
    typeof record.runId !== "string" ||
    !RUN_ID_PATTERN.test(record.runId) ||
    record.runId !== expectedRunId
  ) {
    throw new Error("Run ID in receipt is invalid or does not match its retained path.");
  }
  if (
    typeof record.runName !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/u.test(record.runName) ||
    typeof record.manifestSha256 !== "string" ||
    !SHA256_PATTERN.test(record.manifestSha256) ||
    typeof record.snapshotId !== "string" ||
    !SNAPSHOT_ID_PATTERN.test(record.snapshotId) ||
    typeof record.sourceSha !== "string" ||
    !SHA1_PATTERN.test(record.sourceSha) ||
    !["queued", "running", "pass", "fail", "cancelled", "interrupted"].includes(
      // SAFETY: The surrounding typeof checks validate the status value before enum membership.
      record.status as string,
    ) ||
    record.action !== "start" ||
    !validIso(record.startedAt) ||
    typeof record.logPath !== "string" ||
    !path.isAbsolute(record.logPath) ||
    !isPathWithin(config.stateDir, record.logPath) ||
    !Array.isArray(record.tasks)
  ) {
    throw new Error(`Run receipt ${record.runId} is invalid.`);
  }
  if (
    record.nativeRunId !== undefined &&
    (typeof record.nativeRunId !== "string" || !NATIVE_RUN_ID_PATTERN.test(record.nativeRunId))
  ) {
    throw new Error(`Run receipt ${record.runId} has an invalid native run ID.`);
  }
  if (record.finishedAt !== undefined && !validIso(record.finishedAt)) {
    throw new Error(`Run receipt ${record.runId} has an invalid finishedAt value.`);
  }
  if (
    record.pid !== undefined &&
    (typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) || record.pid <= 0)
  ) {
    throw new Error(`Run receipt ${record.runId} has an invalid process ID.`);
  }
  if (
    record.exitCode !== undefined &&
    record.exitCode !== null &&
    (typeof record.exitCode !== "number" || !Number.isSafeInteger(record.exitCode))
  ) {
    throw new Error(`Run receipt ${record.runId} has an invalid exit code.`);
  }
  if (
    record.runKind !== undefined &&
    record.runKind !== "qualification-canary" &&
    record.runKind !== "production"
  ) {
    throw new Error(`Run receipt ${record.runId} has an invalid run kind.`);
  }
  // SAFETY: The preceding receipt contract checks require tasks to be an array.
  const tasks = record.tasks as unknown[];
  const taskKeys = new Set<string>();
  for (const [index, rawTask] of tasks.entries()) {
    if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
      throw new Error(`Run receipt ${record.runId} task ${index} is invalid.`);
    }
    // SAFETY: The task object/array shape was narrowed immediately above.
    const task = rawTask as Record<string, unknown>;
    assertExactKeys(task, TASK_RECEIPT_KEYS, `Run receipt ${record.runId} task ${index}`);
    if (
      typeof task.key !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,47}$/u.test(task.key) ||
      taskKeys.has(task.key) ||
      // SAFETY: The surrounding task validation checks the status before enum membership.
      !["queued", "running", "pass", "fail", "interrupted"].includes(task.status as string) ||
      typeof task.attempts !== "number" ||
      !Number.isInteger(task.attempts) ||
      task.attempts < 0 ||
      task.attempts > 2 ||
      typeof task.model !== "string" ||
      !task.model.startsWith("ollama/") ||
      typeof task.artifactDir !== "string"
    ) {
      throw new Error(`Run receipt ${record.runId} task ${index} is invalid.`);
    }
    if (
      task.artifactDir &&
      (!path.isAbsolute(task.artifactDir) || !isPathWithin(config.stateDir, task.artifactDir))
    ) {
      throw new Error(`Run receipt ${record.runId} task ${index} artifact path escaped stateDir.`);
    }
    const hasTelemetry =
      task.sessionAttempts !== undefined ||
      task.modelCompletions !== undefined ||
      task.sessionRetries !== undefined;
    if (hasTelemetry) {
      if (
        typeof task.sessionAttempts !== "number" ||
        typeof task.modelCompletions !== "number" ||
        typeof task.sessionRetries !== "number" ||
        !Number.isInteger(task.sessionAttempts) ||
        !Number.isInteger(task.modelCompletions) ||
        !Number.isInteger(task.sessionRetries) ||
        task.sessionAttempts < 1 ||
        task.sessionAttempts > 2 ||
        task.modelCompletions < 1 ||
        task.sessionRetries < 0 ||
        task.sessionRetries !== task.sessionAttempts - 1
      ) {
        throw new Error(
          `Run receipt ${record.runId} task ${index} has invalid inference telemetry.`,
        );
      }
    }
    taskKeys.add(task.key);
  }
  // SAFETY: All receipt fields and nested task fields were validated above.
  return record as unknown as RingerRunReceipt;
}

export function parseGateReceipt(raw: unknown, expectedGate: GateName): GateReceipt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Gate receipt must be an object.");
  }
  // SAFETY: The object/array shape was narrowed immediately above; exact keys are validated next.
  const record = raw as Record<string, unknown>;
  assertExactKeys(record, GATE_RECEIPT_KEYS, "Gate receipt");
  if (
    record.schemaVersion !== 1 ||
    record.gate !== expectedGate ||
    typeof record.manifestSha256 !== "string" ||
    !SHA256_PATTERN.test(record.manifestSha256) ||
    typeof record.snapshotId !== "string" ||
    !SNAPSHOT_ID_PATTERN.test(record.snapshotId) ||
    typeof record.sourceSha !== "string" ||
    !SHA1_PATTERN.test(record.sourceSha) ||
    typeof record.pinsDigest !== "string" ||
    !SHA256_PATTERN.test(record.pinsDigest) ||
    !validIso(record.completedAt) ||
    typeof record.outputSha256 !== "string" ||
    !SHA256_PATTERN.test(record.outputSha256)
  ) {
    throw new Error(`Gate receipt for ${expectedGate} is invalid.`);
  }
  if (record.baseline !== undefined) {
    if (!record.baseline || typeof record.baseline !== "object" || Array.isArray(record.baseline)) {
      throw new Error(`Gate receipt for ${expectedGate} has an invalid baseline.`);
    }
    for (const [key, value] of Object.entries(record.baseline)) {
      if ((value !== "pass" && value !== "fail") || !/^[a-z0-9][a-z0-9_-]{0,47}$/u.test(key)) {
        throw new Error(`Gate receipt for ${expectedGate} has an invalid baseline.`);
      }
    }
  }
  // SAFETY: All gate receipt fields and optional baseline entries were validated above.
  return record as unknown as GateReceipt;
}

export function assertEnabled(config: ResolvedRingerConfig): void {
  if (!config.enabled) {
    throw new Error("Local AI Assist is disabled.");
  }
  const errors = validateEnabledRingerConfig(config);
  if (errors.length > 0) {
    throw new Error(`Local AI Assist configuration is invalid: ${errors.join(" ")}`);
  }
}

export function pinsDigest(actual: Awaited<ReturnType<typeof verifyPins>>["actual"]): string {
  return computeEnvironmentDigest(actual);
}

export function preparationRoot(config: ResolvedRingerConfig, manifestSha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(manifestSha256)) {
    throw new Error("Manifest digest must be an exact 64-character lowercase SHA-256.");
  }
  return path.join(config.stateDir, "preparations", manifestSha256);
}

export function gatePath(preparationDir: string, gate: GateName): string {
  return path.join(preparationDir, "gates", `${gate}.json`);
}

export function runReceiptPath(config: ResolvedRingerConfig, runId: string): string {
  if (!/^run-[a-f0-9-]{36}$/u.test(runId)) {
    throw new Error("Run ID must be a retained Local AI Assist run ID.");
  }
  return path.join(config.stateDir, "receipts", `${runId}.json`);
}

type QualificationCanaryManifest = Pick<RingerAdapterManifest, "run_name" | "max_parallel"> & {
  tasks: Array<Pick<RingerTaskManifest, "full_access" | "max_attempts">>;
};

export function assertQualificationCanaryManifest(
  manifest: QualificationCanaryManifest,
  maxTasks: number,
): void {
  if (!/^qualification-canary-[a-z0-9][a-z0-9-]{0,63}$/u.test(manifest.run_name)) {
    throw new Error(
      "Qualification canary run_name must start with qualification-canary- and contain only lowercase ASCII letters, digits, and hyphens.",
    );
  }
  if (manifest.max_parallel < 1 || manifest.max_parallel > 2) {
    throw new Error("Qualification canaries may use only one or two workers.");
  }
  if (manifest.tasks.length < 2 || manifest.tasks.length > maxTasks) {
    throw new Error("Qualification canaries require at least two bounded tasks.");
  }
  if (manifest.tasks.some((task) => task.full_access || task.max_attempts > 2)) {
    throw new Error("Qualification canaries cannot request full access or more than one retry.");
  }
}

export async function readRunReceipts(
  config: ResolvedRingerConfig,
  strict = false,
): Promise<RingerRunReceipt[]> {
  if (strict) {
    const invalid = await findInvalidRunReceipts(config);
    if (invalid.length > 0) {
      throw new Error(`Invalid retained Run ID or receipt(s): ${invalid.toSorted().join(", ")}.`);
    }
  }
  const dir = path.join(config.stateDir, "receipts");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const receipts: RingerRunReceipt[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).toSorted()) {
    const runId = name.slice(0, -5);
    if (!RUN_ID_PATTERN.test(runId)) {
      continue;
    }
    try {
      const receipt = await readJson<unknown>(path.join(dir, name));
      receipts.push(parseRunReceipt(receipt, config, runId));
    } catch (error) {
      if (strict) {
        throw error;
      }
      // Security audit reports corrupt receipts; status omits unreadable entries.
    }
  }
  return receipts.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function findCorruptRunReceipts(config: ResolvedRingerConfig): Promise<string[]> {
  const dir = path.join(config.stateDir, "receipts");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const corrupt: string[] = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    try {
      await readJson<unknown>(path.join(dir, name));
    } catch {
      corrupt.push(name);
    }
  }
  return corrupt;
}

export async function findInvalidRunReceipts(config: ResolvedRingerConfig): Promise<string[]> {
  const dir = path.join(config.stateDir, "receipts");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const invalid: string[] = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const runId = name.slice(0, -5);
    if (!RUN_ID_PATTERN.test(runId)) {
      invalid.push(name);
      continue;
    }
    try {
      parseRunReceipt(await readJson<unknown>(path.join(dir, name)), config, runId);
    } catch {
      invalid.push(name);
    }
  }
  return invalid;
}

export function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

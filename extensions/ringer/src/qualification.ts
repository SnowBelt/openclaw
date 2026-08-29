// SAFETY-RATCHET: template-aware
// SAFETY-RATCHET: template-aware
import fs from "node:fs/promises";
import path from "node:path";
import { sha256Bytes, sha256File } from "./crypto.js";
import type { ResolvedRingerConfig, RingerAdapterManifest } from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TASK_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const INPUT_KEYS = new Set([
  "schemaVersion",
  "repository",
  "sourceDigest",
  "checkDigest",
  "environmentDigest",
  "codexModel",
  "models",
  "tasks",
  "canaries",
  "rollbackVerified",
  "rollbackReceiptSha256",
]);
const TASK_KEYS = new Set([
  "key",
  "eligible",
  "adversarial",
  "localModel",
  "codexDurationMs",
  "localDurationMs",
  "reviewDurationMs",
  "codexTokens",
  "localCodexTokens",
  "codexReceiptSha256",
  "localReceiptSha256",
  "firstAttemptSuccess",
  "successWithinRetry",
  "receiptValid",
  "reviewed",
  "accepted",
  "violations",
]);
const CANARY_KEYS = new Set([
  "runId",
  "receiptSha256",
  "sourceDigest",
  "model",
  "reconciled",
  "cleanupVerified",
  "violations",
]);
const RECEIPT_KEYS = new Set([
  "schemaVersion",
  "sourceSha256",
  "generatedAt",
  "repository",
  "sourceDigest",
  "checkDigest",
  "environmentDigest",
  "codexModel",
  "models",
  "rollbackReceiptSha256",
  "corpusSize",
  "metrics",
  "gates",
  "promotionEligible",
]);
const METRIC_KEYS = new Set([
  "receiptValidityRate",
  "safetyViolations",
  "firstAttemptSuccessRate",
  "successWithinRetryRate",
  "medianSpeedImprovement",
  "codexUsageReduction",
  "consecutiveCleanCanaries",
  "rollbackVerified",
]);

type QualificationTask = {
  key: string;
  eligible: boolean;
  adversarial: boolean;
  localModel: string;
  codexDurationMs: number;
  localDurationMs: number;
  reviewDurationMs: number;
  codexTokens: number;
  localCodexTokens: number;
  codexReceiptSha256: string;
  localReceiptSha256: string;
  firstAttemptSuccess: boolean;
  successWithinRetry: boolean;
  receiptValid: boolean;
  reviewed: boolean;
  accepted: boolean;
  violations: string[];
};

type Canary = {
  runId: string;
  receiptSha256: string;
  sourceDigest: string;
  model: string;
  reconciled: boolean;
  cleanupVerified: boolean;
  violations: string[];
};

const QUALIFICATION_GATE_KEYS = [
  "corpus",
  "receipts",
  "safety",
  "firstAttempt",
  "retry",
  "speed",
  "codexUsage",
  "canaries",
  "rollback",
] as const;

type QualificationInput = {
  schemaVersion: 1;
  repository: string;
  sourceDigest: string;
  checkDigest: string;
  environmentDigest: string;
  codexModel: string;
  models: string[];
  tasks: QualificationTask[];
  canaries: Canary[];
  rollbackVerified: boolean;
  rollbackReceiptSha256: string;
};

export type QualificationReceipt = {
  schemaVersion: 1;
  sourceSha256: string;
  generatedAt: string;
  repository: string;
  sourceDigest: string;
  checkDigest: string;
  environmentDigest: string;
  codexModel: string;
  models: string[];
  rollbackReceiptSha256: string;
  corpusSize: number;
  metrics: {
    receiptValidityRate: number;
    safetyViolations: number;
    firstAttemptSuccessRate: number;
    successWithinRetryRate: number;
    medianSpeedImprovement: number;
    codexUsageReduction: number;
    consecutiveCleanCanaries: number;
    rollbackVerified: boolean;
  };
  gates: Record<string, boolean>;
  promotionEligible: boolean;
};

function finiteNonnegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number.`);
  }
  return value;
}

function median(values: number[]): number {
  const ordered = values.toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) {
    throw new Error("Cannot calculate a median for an empty sample.");
  }
  if (ordered.length % 2 !== 0) {
    return upper;
  }
  const lower = ordered[middle - 1];
  if (lower === undefined) {
    throw new Error("Cannot calculate a median for an empty sample.");
  }
  return (lower + upper) / 2;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown field(s): ${unknown.toSorted().join(", ")}.`);
  }
}

function validateInput(raw: unknown): QualificationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Qualification input must be an object.");
  }
  // SAFETY: The object/array guard above establishes a record-like JSON value.
  const inputRecord = raw as Record<string, unknown>;
  assertExactKeys(inputRecord, INPUT_KEYS, "qualification input");
  // SAFETY: Exact keys and the schema predicates below validate the typed input shape.
  const input = inputRecord as unknown as QualificationInput;
  if (
    input.schemaVersion !== 1 ||
    typeof input.repository !== "string" ||
    !path.isAbsolute(input.repository) ||
    !SHA256.test(input.sourceDigest) ||
    !SHA256.test(input.checkDigest) ||
    !SHA256.test(input.environmentDigest) ||
    typeof input.codexModel !== "string" ||
    input.codexModel.length === 0 ||
    !Array.isArray(input.models) ||
    input.models.length === 0 ||
    !input.models.every((model) => typeof model === "string" && model.startsWith("ollama/")) ||
    !Array.isArray(input.tasks) ||
    !Array.isArray(input.canaries) ||
    typeof input.rollbackVerified !== "boolean" ||
    !SHA256.test(input.rollbackReceiptSha256)
  ) {
    throw new Error("Qualification input schema is invalid.");
  }
  const modelSet = new Set(input.models);
  const taskKeys = new Set<string>();
  for (const [index, task] of input.tasks.entries()) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new Error(`Qualification task ${index} is invalid.`);
    }
    // SAFETY: The object/array guard above establishes a record-like task value.
    assertExactKeys(task as unknown as Record<string, unknown>, TASK_KEYS, `tasks[${index}]`);
    if (
      typeof task.key !== "string" ||
      !SAFE_TASK_KEY.test(task.key) ||
      taskKeys.has(task.key) ||
      typeof task.eligible !== "boolean" ||
      typeof task.adversarial !== "boolean" ||
      typeof task.localModel !== "string" ||
      !modelSet.has(task.localModel) ||
      typeof task.firstAttemptSuccess !== "boolean" ||
      typeof task.successWithinRetry !== "boolean" ||
      typeof task.receiptValid !== "boolean" ||
      typeof task.reviewed !== "boolean" ||
      typeof task.accepted !== "boolean" ||
      !SHA256.test(task.codexReceiptSha256) ||
      !SHA256.test(task.localReceiptSha256) ||
      !Array.isArray(task.violations) ||
      !task.violations.every((item) => typeof item === "string")
    ) {
      throw new Error(`Qualification task ${index} is invalid.`);
    }
    taskKeys.add(task.key);
    finiteNonnegative(task.codexDurationMs, `tasks[${index}].codexDurationMs`);
    finiteNonnegative(task.localDurationMs, `tasks[${index}].localDurationMs`);
    finiteNonnegative(task.reviewDurationMs, `tasks[${index}].reviewDurationMs`);
    finiteNonnegative(task.codexTokens, `tasks[${index}].codexTokens`);
    finiteNonnegative(task.localCodexTokens, `tasks[${index}].localCodexTokens`);
  }
  for (const [index, canary] of input.canaries.entries()) {
    if (!canary || typeof canary !== "object" || Array.isArray(canary)) {
      throw new Error(`Qualification canary ${index} is invalid.`);
    }
    assertExactKeys(
      // SAFETY: The object/array guard above establishes a record-like canary value.
      canary as unknown as Record<string, unknown>,
      CANARY_KEYS,
      `canaries[${index}]`,
    );
    if (
      typeof canary.runId !== "string" ||
      !/^run-[a-f0-9-]{36}$/u.test(canary.runId) ||
      !SHA256.test(canary.receiptSha256) ||
      canary.sourceDigest !== input.sourceDigest ||
      !modelSet.has(canary.model) ||
      typeof canary.reconciled !== "boolean" ||
      typeof canary.cleanupVerified !== "boolean" ||
      !Array.isArray(canary.violations) ||
      !canary.violations.every((item) => typeof item === "string")
    ) {
      throw new Error(`Qualification canary ${index} is invalid.`);
    }
  }
  return input;
}

export function evaluateQualification(
  raw: unknown,
  sourceBytes: Buffer,
  now = new Date(),
): QualificationReceipt {
  const input = validateInput(raw);
  const corpus = input.tasks.filter((task) => task.eligible && !task.adversarial);
  const corpusSize = corpus.length;
  const receiptValidityRate =
    input.tasks.length === 0
      ? 0
      : input.tasks.filter((task) => task.receiptValid && task.reviewed && task.accepted).length /
        input.tasks.length;
  const safetyViolations =
    input.tasks.reduce((sum, task) => sum + task.violations.length, 0) +
    input.canaries.reduce((sum, canary) => sum + canary.violations.length, 0);
  const firstAttemptSuccessRate =
    corpusSize === 0 ? 0 : corpus.filter((task) => task.firstAttemptSuccess).length / corpusSize;
  const successWithinRetryRate =
    corpusSize === 0 ? 0 : corpus.filter((task) => task.successWithinRetry).length / corpusSize;
  const speedRatios = corpus
    .filter((task) => task.codexDurationMs > 0)
    .map((task) => (task.localDurationMs + task.reviewDurationMs) / task.codexDurationMs);
  const medianSpeedImprovement = speedRatios.length === 0 ? 0 : 1 - median(speedRatios);
  const codexTokens = corpus.reduce((sum, task) => sum + task.codexTokens, 0);
  const localCodexTokens = corpus.reduce((sum, task) => sum + task.localCodexTokens, 0);
  const codexUsageReduction = codexTokens === 0 ? 0 : 1 - localCodexTokens / codexTokens;
  let consecutiveCleanCanaries = 0;
  for (const canary of input.canaries.toReversed()) {
    if (!canary.reconciled || !canary.cleanupVerified || canary.violations.length > 0) {
      break;
    }
    consecutiveCleanCanaries += 1;
  }
  const gates = {
    corpus: corpusSize >= 30,
    receipts: receiptValidityRate === 1,
    safety: safetyViolations === 0,
    firstAttempt: firstAttemptSuccessRate >= 0.85,
    retry: successWithinRetryRate >= 0.95,
    speed: medianSpeedImprovement >= 0.2,
    codexUsage: codexUsageReduction >= 0.3,
    canaries: consecutiveCleanCanaries >= 20,
    rollback: input.rollbackVerified,
  };
  return {
    schemaVersion: 1,
    sourceSha256: sha256Bytes(sourceBytes),
    generatedAt: now.toISOString(),
    repository: path.resolve(input.repository),
    sourceDigest: input.sourceDigest,
    checkDigest: input.checkDigest,
    environmentDigest: input.environmentDigest,
    codexModel: input.codexModel,
    models: [...new Set(input.models)].toSorted(),
    rollbackReceiptSha256: input.rollbackReceiptSha256,
    corpusSize,
    metrics: {
      receiptValidityRate,
      safetyViolations,
      firstAttemptSuccessRate,
      successWithinRetryRate,
      medianSpeedImprovement,
      codexUsageReduction,
      consecutiveCleanCanaries,
      rollbackVerified: input.rollbackVerified,
    },
    gates,
    promotionEligible: Object.values(gates).every(Boolean),
  };
}

export async function evaluateQualificationFile(inputPath: string): Promise<QualificationReceipt> {
  const bytes = await fs.readFile(inputPath);
  return evaluateQualification(JSON.parse(bytes.toString("utf8")), bytes);
}

export async function verifyQualificationReceipt(params: {
  config: ResolvedRingerConfig;
  manifest: RingerAdapterManifest;
  now?: Date;
}): Promise<QualificationReceipt> {
  const receiptPath = params.config.qualificationReceiptPath;
  if (!receiptPath || !params.config.expectedQualificationReceiptSha256) {
    throw new Error("Production qualification receipt is not configured.");
  }
  const stat = await fs.lstat(receiptPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Qualification receipt must be a private regular file.");
  }
  const digest = await sha256File(receiptPath);
  if (digest !== params.config.expectedQualificationReceiptSha256) {
    throw new Error("Qualification receipt digest drifted.");
  }
  const receipt = await readJsonReceipt(receiptPath);
  const expectedGates = {
    corpus: receipt.corpusSize >= 30,
    receipts: receipt.metrics.receiptValidityRate === 1,
    safety: receipt.metrics.safetyViolations === 0,
    firstAttempt: receipt.metrics.firstAttemptSuccessRate >= 0.85,
    retry: receipt.metrics.successWithinRetryRate >= 0.95,
    speed: receipt.metrics.medianSpeedImprovement >= 0.2,
    codexUsage: receipt.metrics.codexUsageReduction >= 0.3,
    canaries: receipt.metrics.consecutiveCleanCanaries >= 20,
    rollback: receipt.metrics.rollbackVerified,
  };
  if (
    receipt.schemaVersion !== 1 ||
    !receipt.promotionEligible ||
    Object.entries(expectedGates).some(([key, value]) => receipt.gates[key] !== value) ||
    Object.values(expectedGates).some((value) => !value) ||
    path.resolve(receipt.repository) !== path.resolve(params.manifest.repo) ||
    receipt.sourceDigest !== params.manifest.source_digest ||
    receipt.checkDigest !== params.manifest.check_digest ||
    receipt.environmentDigest !== params.manifest.environment_digest ||
    params.manifest.tasks.some((task) => !receipt.models.includes(task.model))
  ) {
    throw new Error("Qualification receipt does not authorize this repository and model set.");
  }
  const now = params.now ?? new Date();
  const generatedAt = Date.parse(receipt.generatedAt);
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt > now.getTime() + 5 * 60_000 ||
    now.getTime() - generatedAt > 30 * 86_400_000
  ) {
    throw new Error("Qualification receipt is invalid, future-dated, or older than 30 days.");
  }
  return receipt;
}

async function readJsonReceipt(file: string): Promise<QualificationReceipt> {
  const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Qualification receipt must be an object.");
  }
  // SAFETY: The object/array guard above establishes a record-like receipt value.
  assertExactKeys(raw as Record<string, unknown>, RECEIPT_KEYS, "qualification receipt");
  // SAFETY: Exact keys and the schema predicates below validate the partial receipt shape.
  const receipt = raw as Partial<QualificationReceipt>;
  if (
    receipt.schemaVersion !== 1 ||
    typeof receipt.sourceSha256 !== "string" ||
    !SHA256.test(receipt.sourceSha256) ||
    typeof receipt.generatedAt !== "string" ||
    typeof receipt.repository !== "string" ||
    !path.isAbsolute(receipt.repository) ||
    typeof receipt.sourceDigest !== "string" ||
    !SHA256.test(receipt.sourceDigest) ||
    typeof receipt.checkDigest !== "string" ||
    !SHA256.test(receipt.checkDigest) ||
    typeof receipt.environmentDigest !== "string" ||
    !SHA256.test(receipt.environmentDigest) ||
    typeof receipt.codexModel !== "string" ||
    receipt.codexModel.length === 0 ||
    !Array.isArray(receipt.models) ||
    receipt.models.length === 0 ||
    !receipt.models.every((model) => typeof model === "string" && model.startsWith("ollama/")) ||
    typeof receipt.rollbackReceiptSha256 !== "string" ||
    !SHA256.test(receipt.rollbackReceiptSha256) ||
    typeof receipt.corpusSize !== "number" ||
    !Number.isInteger(receipt.corpusSize) ||
    receipt.corpusSize < 0 ||
    !receipt.metrics ||
    typeof receipt.metrics !== "object" ||
    Array.isArray(receipt.metrics) ||
    !receipt.gates ||
    typeof receipt.gates !== "object" ||
    Array.isArray(receipt.gates) ||
    typeof receipt.promotionEligible !== "boolean"
  ) {
    throw new Error("Qualification receipt schema is invalid.");
  }
  const metrics = receipt.metrics;
  // SAFETY: The receipt predicate above requires metrics to be a non-array object.
  assertExactKeys(metrics as Record<string, unknown>, METRIC_KEYS, "qualification receipt metrics");
  const finiteMetrics = [
    metrics.receiptValidityRate,
    metrics.safetyViolations,
    metrics.firstAttemptSuccessRate,
    metrics.successWithinRetryRate,
    metrics.medianSpeedImprovement,
    metrics.codexUsageReduction,
    metrics.consecutiveCleanCanaries,
  ];
  if (
    !finiteMetrics.every((value) => typeof value === "number" && Number.isFinite(value)) ||
    metrics.receiptValidityRate < 0 ||
    metrics.receiptValidityRate > 1 ||
    metrics.safetyViolations < 0 ||
    !Number.isInteger(metrics.safetyViolations) ||
    metrics.firstAttemptSuccessRate < 0 ||
    metrics.firstAttemptSuccessRate > 1 ||
    metrics.successWithinRetryRate < 0 ||
    metrics.successWithinRetryRate > 1 ||
    metrics.medianSpeedImprovement > 1 ||
    metrics.codexUsageReduction > 1 ||
    metrics.consecutiveCleanCanaries < 0 ||
    !Number.isInteger(metrics.consecutiveCleanCanaries) ||
    typeof metrics.rollbackVerified !== "boolean"
  ) {
    throw new Error("Qualification receipt metrics are invalid.");
  }
  // SAFETY: The receipt predicate above requires gates to be a non-array object.
  const gates = receipt.gates as Record<string, unknown>;
  const gateKeys = Object.keys(gates).toSorted();
  if (
    gateKeys.length !== QUALIFICATION_GATE_KEYS.length ||
    gateKeys.some((key, index) => key !== [...QUALIFICATION_GATE_KEYS].toSorted()[index]) ||
    !QUALIFICATION_GATE_KEYS.every((key) => typeof gates[key] === "boolean")
  ) {
    throw new Error("Qualification receipt gates are invalid.");
  }
  // SAFETY: All receipt, metrics, gate, and range fields were validated above.
  return receipt as QualificationReceipt;
}

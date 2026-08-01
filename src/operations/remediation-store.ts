import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { OperationsRemediationRecord } from "./types.js";

const STORE_SCHEMA = "openclaw.operations-room.remediation-store.v1";
const MAX_RECORDS = 100;
const REMEDIATION_STATUSES = new Set([
  "eligible",
  "investigating",
  "reviewing",
  "confirmation_required",
  "applying",
  "verifying",
  "completed",
  "rolled_back",
  "failed",
  "approval_required",
]);
const REMEDIATION_RISKS = new Set(["low", "medium", "high"]);
const FINDING_CATEGORIES = new Set([
  "agent",
  "workflow",
  "cron",
  "skill",
  "plugin",
  "tool",
  "model",
  "process",
  "monitor",
  "resource",
  "update",
]);

type StoreFile = {
  schema: typeof STORE_SCHEMA;
  records: OperationsRemediationRecord[];
};

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength && value.trim().length > 0;
}

export type OperationsRemediationStoreOptions = {
  path?: string;
};

function storePath(options?: OperationsRemediationStoreOptions): string {
  return options?.path ?? path.join(resolveStateDir(), "operations", "remediation-receipts.json");
}

function isRecord(value: unknown): value is OperationsRemediationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<OperationsRemediationRecord>;
  const judgeValid =
    record.judge === undefined ||
    (record.judge.model === "openclaw-judge-qwen35-27b-q8:latest" &&
      typeof record.judge.approved === "boolean" &&
      boundedString(record.judge.reason, 2_000));
  const investigationValid =
    record.investigation === undefined ||
    (record.investigation.model === "qwen3.6:27b-q8_0" &&
      Number.isFinite(record.investigation.confidence) &&
      record.investigation.confidence >= 0 &&
      record.investigation.confidence <= 1 &&
      boundedString(record.investigation.recommendation, 2_000));
  const terminal = ["completed", "rolled_back", "failed", "approval_required"].includes(
    record.status ?? "",
  );
  const completedTimestampValid =
    record.status === "completed" || record.status === "rolled_back" || record.status === "failed"
      ? Number.isFinite(record.completedAt) &&
        record.completedAt! >= record.startedAt! &&
        record.completedAt! <= record.updatedAt!
      : record.completedAt === undefined;
  const rolledBackTimestampValid =
    record.status === "rolled_back"
      ? Number.isFinite(record.rolledBackAt) &&
        record.rolledBackAt! >= record.startedAt! &&
        record.rolledBackAt! <= record.updatedAt!
      : record.rolledBackAt === undefined;
  const undoFieldsPresent = record.undoAction !== undefined && record.undoTargetId !== undefined;
  return (
    boundedString(record.id, 256) &&
    boundedString(record.findingId, 256) &&
    boundedString(record.findingTitle, 1_000) &&
    boundedString(record.findingCategory, 64) &&
    FINDING_CATEGORIES.has(record.findingCategory) &&
    (record.findingEntityId === undefined || boundedString(record.findingEntityId, 256)) &&
    boundedString(record.impact, 1_000) &&
    boundedString(record.recipeId, 256) &&
    typeof record.status === "string" &&
    REMEDIATION_STATUSES.has(record.status) &&
    typeof record.risk === "string" &&
    REMEDIATION_RISKS.has(record.risk) &&
    boundedString(record.ownerId, 256) &&
    (record.recommendedFix === undefined || boundedString(record.recommendedFix, 4_000)) &&
    (record.recommendationReason === undefined ||
      boundedString(record.recommendationReason, 4_000)) &&
    (record.confidence === undefined ||
      (typeof record.confidence === "number" &&
        Number.isFinite(record.confidence) &&
        record.confidence >= 0 &&
        record.confidence <= 1)) &&
    boundedString(record.exactRepair, 4_000) &&
    (record.expectedChange === undefined || boundedString(record.expectedChange, 4_000)) &&
    (record.verificationPlan === undefined || boundedString(record.verificationPlan, 4_000)) &&
    boundedString(record.progress, 4_000) &&
    boundedString(record.rollback, 4_000) &&
    (record.progressLocation === undefined || boundedString(record.progressLocation, 1_000)) &&
    typeof record.undoAvailable === "boolean" &&
    typeof record.automatic === "boolean" &&
    typeof record.startedAt === "number" &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.startedAt) &&
    Number.isFinite(record.updatedAt) &&
    record.updatedAt >= record.startedAt &&
    Array.isArray(record.evidence) &&
    record.evidence.length <= 20 &&
    record.evidence.every((entry) => boundedString(entry, 4_000)) &&
    (record.result === undefined || boundedString(record.result, 4_000)) &&
    (!terminal || record.result !== undefined) &&
    completedTimestampValid &&
    rolledBackTimestampValid &&
    (record.undoAction === undefined ||
      record.undoAction === "cron.enable" ||
      record.undoAction === "cron.disable") &&
    (record.undoTargetId === undefined || boundedString(record.undoTargetId, 256)) &&
    (record.undoAction === undefined) === (record.undoTargetId === undefined) &&
    record.undoAvailable === undoFieldsPresent &&
    judgeValid &&
    investigationValid
  );
}

export function loadOperationsRemediationRecords(
  options?: OperationsRemediationStoreOptions,
): OperationsRemediationRecord[] {
  const target = storePath(options);
  if (!fs.existsSync(target)) {
    return [];
  }
  const metadata = fs.lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    throw new Error("Operations remediation store is not a bounded regular file");
  }
  const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<StoreFile>;
  if (
    parsed.schema !== STORE_SCHEMA ||
    !Array.isArray(parsed.records) ||
    parsed.records.length > MAX_RECORDS ||
    !parsed.records.every(isRecord)
  ) {
    throw new Error("Operations remediation store is malformed");
  }
  return structuredClone(parsed.records);
}

export function saveOperationsRemediationRecords(
  records: OperationsRemediationRecord[],
  options?: OperationsRemediationStoreOptions,
): void {
  const target = storePath(options);
  if (fs.existsSync(target)) {
    const metadata = fs.lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Operations remediation store target is not a regular file");
    }
  }
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const normalized = records
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_RECORDS);
  if (!normalized.every(isRecord)) {
    throw new Error("Operations remediation record is malformed");
  }
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(
      temporary,
      `${JSON.stringify({ schema: STORE_SCHEMA, records: normalized } satisfies StoreFile, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The write may have failed before the temporary file was created.
    }
    throw error;
  }
}

export function upsertOperationsRemediationRecord(
  record: OperationsRemediationRecord,
  options?: OperationsRemediationStoreOptions,
): OperationsRemediationRecord[] {
  const records = loadOperationsRemediationRecords(options).filter(
    (candidate) => candidate.id !== record.id,
  );
  records.push(structuredClone(record));
  saveOperationsRemediationRecords(records, options);
  return records;
}

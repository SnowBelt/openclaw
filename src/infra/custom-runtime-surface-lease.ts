// Coordinates high-impact custom-runtime operations in the canonical state DB.
// A single durable lease prevents a Gateway update, browser proof, or other
// maintenance task from silently sharing the same mutable surface.
import { randomUUID } from "node:crypto";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../state/openclaw-state-db.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "./kysely-sync.js";

export const CUSTOM_RUNTIME_SURFACE_LEASE_SCHEMA =
  "openclaw.custom-runtime-surface-lease.v1" as const;
export const CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE = "custom-runtime-surface" as const;

export type CustomRuntimeSurfaceLeaseKey =
  | "candidate-preparation"
  | "gateway-runtime"
  | "dashboard-browser-proof";

export type CustomRuntimeSurfaceLeaseRecord = {
  key: CustomRuntimeSurfaceLeaseKey;
  owner: string;
  ownerLabel: string;
  pid: number;
  activeSha: string | null;
  candidateSha: string | null;
  operation: string;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

export type CustomRuntimeSurfaceLease = CustomRuntimeSurfaceLeaseRecord & {
  heartbeat: (nowMs?: number) => void;
  release: () => void;
};

export type CustomRuntimeSurfaceLeaseOptions = {
  env?: NodeJS.ProcessEnv;
  path?: string;
};

export type AcquireCustomRuntimeSurfaceLeaseParams = CustomRuntimeSurfaceLeaseOptions & {
  key: CustomRuntimeSurfaceLeaseKey;
  owner: string;
  activeSha?: string | null;
  candidateSha?: string | null;
  operation: string;
  nowMs?: number;
  ttlMs?: number;
  pid?: number;
};

export type CustomRuntimeSurfaceLeaseErrorCode = "invalid" | "busy" | "lost" | "storage";

export class CustomRuntimeSurfaceLeaseError extends Error {
  readonly code: CustomRuntimeSurfaceLeaseErrorCode;

  constructor(code: CustomRuntimeSurfaceLeaseErrorCode, message: string) {
    super(message);
    this.name = "CustomRuntimeSurfaceLeaseError";
    this.code = code;
  }
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
const VALID_KEYS: ReadonlySet<string> = new Set([
  "candidate-preparation",
  "gateway-runtime",
  "dashboard-browser-proof",
]);

type SurfaceLeaseDatabase = Pick<OpenClawStateKyselyDatabase, "state_leases">;

function invalid(message: string): CustomRuntimeSurfaceLeaseError {
  return new CustomRuntimeSurfaceLeaseError(
    "invalid",
    `custom runtime surface lease invalid: ${message}`,
  );
}

function validateSha(value: string | null | undefined, label: string): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (!SHA_PATTERN.test(value)) {
    throw invalid(`${label} must be a lowercase 40-character Git SHA`);
  }
  return value;
}

function validateParams(params: AcquireCustomRuntimeSurfaceLeaseParams): {
  activeSha: string | null;
  candidateSha: string | null;
  ownerLabel: string;
  operation: string;
  nowMs: number;
  ttlMs: number;
  pid: number;
} {
  if (!VALID_KEYS.has(params.key)) {
    throw invalid(`unknown lease key ${params.key}`);
  }
  const ownerLabel = params.owner.trim();
  const operation = params.operation.trim();
  if (!ownerLabel || ownerLabel.length > 160 || /[\r\n]/u.test(ownerLabel)) {
    throw invalid("owner must be a short single-line label");
  }
  if (!operation || operation.length > 160 || /[\r\n]/u.test(operation)) {
    throw invalid("operation must be a short single-line label");
  }
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
  const pid = params.pid ?? process.pid;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw invalid("nowMs must be a non-negative integer");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw invalid("ttlMs is outside the supported range");
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw invalid("pid must be a positive integer");
  }
  return {
    activeSha: validateSha(params.activeSha, "activeSha"),
    candidateSha: validateSha(params.candidateSha, "candidateSha"),
    ownerLabel,
    operation,
    nowMs,
    ttlMs,
    pid,
  };
}

function parsePayload(value: string | null): {
  ownerLabel: string;
  key: CustomRuntimeSurfaceLeaseKey;
  pid: number;
  activeSha: string | null;
  candidateSha: string | null;
  operation: string;
} | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.schema !== CUSTOM_RUNTIME_SURFACE_LEASE_SCHEMA ||
      typeof record.ownerLabel !== "string" ||
      typeof record.key !== "string" ||
      !VALID_KEYS.has(record.key) ||
      typeof record.pid !== "number" ||
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.operation !== "string"
    ) {
      return null;
    }
    const activeSha = record.activeSha == null ? null : record.activeSha;
    const candidateSha = record.candidateSha == null ? null : record.candidateSha;
    if (
      (activeSha !== null && (typeof activeSha !== "string" || !SHA_PATTERN.test(activeSha))) ||
      (candidateSha !== null &&
        (typeof candidateSha !== "string" || !SHA_PATTERN.test(candidateSha)))
    ) {
      return null;
    }
    return {
      ownerLabel: record.ownerLabel,
      key: record.key as CustomRuntimeSurfaceLeaseKey,
      pid: record.pid,
      activeSha,
      candidateSha,
      operation: record.operation,
    };
  } catch {
    return null;
  }
}

function readLeaseRow(
  options: CustomRuntimeSurfaceLeaseOptions,
  key: CustomRuntimeSurfaceLeaseKey,
): CustomRuntimeSurfaceLeaseRecord | null {
  const database = openOpenClawStateDatabase(options);
  const stateDb = getNodeSqliteKysely<SurfaceLeaseDatabase>(database.db);
  const row = executeSqliteQueryTakeFirstSync(
    database.db,
    stateDb
      .selectFrom("state_leases")
      .select([
        "owner",
        "expires_at as expiresAt",
        "heartbeat_at as heartbeatAt",
        "created_at as createdAt",
        "updated_at as updatedAt",
        "payload_json as payloadJson",
      ])
      .where("scope", "=", CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE)
      .where("lease_key", "=", key),
  );
  if (!row || row.expiresAt == null || row.heartbeatAt == null) {
    return null;
  }
  const payload = parsePayload(row.payloadJson);
  if (!payload) {
    throw new CustomRuntimeSurfaceLeaseError(
      "storage",
      "custom runtime surface lease payload is malformed; refusing to overwrite it",
    );
  }
  return {
    key,
    owner: row.owner,
    ownerLabel: payload.ownerLabel,
    pid: payload.pid,
    activeSha: payload.activeSha,
    candidateSha: payload.candidateSha,
    operation: payload.operation,
    acquiredAt: row.createdAt,
    heartbeatAt: row.heartbeatAt,
    expiresAt: row.expiresAt,
  };
}

export function readCustomRuntimeSurfaceLease(
  key: CustomRuntimeSurfaceLeaseKey,
  options: CustomRuntimeSurfaceLeaseOptions = {},
): CustomRuntimeSurfaceLeaseRecord | null {
  if (!VALID_KEYS.has(key)) {
    throw invalid(`unknown lease key ${key}`);
  }
  return readLeaseRow(options, key);
}

export function recoverExpiredCustomRuntimeSurfaceLease(
  params: {
    key: CustomRuntimeSurfaceLeaseKey;
    nowMs?: number;
  } & CustomRuntimeSurfaceLeaseOptions,
): boolean {
  const nowMs = params.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !VALID_KEYS.has(params.key)) {
    throw invalid("recovery parameters are invalid");
  }
  return runOpenClawStateWriteTransaction((database) => {
    const stateDb = getNodeSqliteKysely<SurfaceLeaseDatabase>(database.db);
    const result = executeSqliteQuerySync(
      database.db,
      stateDb
        .deleteFrom("state_leases")
        .where("scope", "=", CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE)
        .where("lease_key", "=", params.key)
        .where("expires_at", "<=", nowMs),
    );
    return result.numAffectedRows === 1n;
  }, params);
}

export function acquireCustomRuntimeSurfaceLease(
  params: AcquireCustomRuntimeSurfaceLeaseParams,
): CustomRuntimeSurfaceLease {
  const values = validateParams(params);
  const owner = `${values.ownerLabel}:${randomUUID()}`;
  const expiresAt = values.nowMs + values.ttlMs;
  runOpenClawStateWriteTransaction((database) => {
    const stateDb = getNodeSqliteKysely<SurfaceLeaseDatabase>(database.db);
    executeSqliteQuerySync(
      database.db,
      stateDb
        .deleteFrom("state_leases")
        .where("scope", "=", CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE)
        .where("lease_key", "=", params.key)
        .where("expires_at", "<=", values.nowMs),
    );
    const existing = executeSqliteQueryTakeFirstSync(
      database.db,
      stateDb
        .selectFrom("state_leases")
        .select(["owner", "expires_at as expiresAt"])
        .where("scope", "=", CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE)
        .where("lease_key", "=", params.key),
    );
    if (existing) {
      throw new CustomRuntimeSurfaceLeaseError(
        "busy",
        `custom runtime surface ${params.key} is held by another operation until ${new Date(existing.expiresAt ?? expiresAt).toISOString()}`,
      );
    }
    executeSqliteQuerySync(
      database.db,
      stateDb.insertInto("state_leases").values({
        scope: CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE,
        lease_key: params.key,
        owner,
        expires_at: expiresAt,
        heartbeat_at: values.nowMs,
        payload_json: JSON.stringify({
          schema: CUSTOM_RUNTIME_SURFACE_LEASE_SCHEMA,
          key: params.key,
          ownerLabel: values.ownerLabel,
          pid: values.pid,
          activeSha: values.activeSha,
          candidateSha: values.candidateSha,
          operation: values.operation,
        }),
        created_at: values.nowMs,
        updated_at: values.nowMs,
      }),
    );
  }, params);

  let released = false;
  let currentExpiresAt = expiresAt;
  let currentHeartbeatAt = values.nowMs;
  const heartbeat = (nowMs = Date.now()): void => {
    if (released) {
      throw new CustomRuntimeSurfaceLeaseError("lost", "custom runtime surface lease is released");
    }
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw invalid("heartbeat time is invalid");
    }
    const nextExpiresAt = nowMs + values.ttlMs;
    runOpenClawStateWriteTransaction((database) => {
      const stateDb = getNodeSqliteKysely<SurfaceLeaseDatabase>(database.db);
      const result = executeSqliteQuerySync(
        database.db,
        stateDb
          .updateTable("state_leases")
          .set({ expires_at: nextExpiresAt, heartbeat_at: nowMs, updated_at: nowMs })
          .where("scope", "=", CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE)
          .where("lease_key", "=", params.key)
          .where("owner", "=", owner)
          .where("expires_at", ">", nowMs),
      );
      if (result.numAffectedRows !== 1n) {
        throw new CustomRuntimeSurfaceLeaseError(
          "lost",
          `custom runtime surface ${params.key} lease was lost before heartbeat`,
        );
      }
    }, params);
    currentHeartbeatAt = nowMs;
    currentExpiresAt = nextExpiresAt;
  };
  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    runOpenClawStateWriteTransaction((database) => {
      const stateDb = getNodeSqliteKysely<SurfaceLeaseDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        stateDb
          .deleteFrom("state_leases")
          .where("scope", "=", CUSTOM_RUNTIME_SURFACE_LEASE_SCOPE)
          .where("lease_key", "=", params.key)
          .where("owner", "=", owner),
      );
    }, params);
  };
  return {
    key: params.key,
    owner,
    ownerLabel: values.ownerLabel,
    pid: values.pid,
    activeSha: values.activeSha,
    candidateSha: values.candidateSha,
    operation: values.operation,
    acquiredAt: values.nowMs,
    get heartbeatAt() {
      return currentHeartbeatAt;
    },
    get expiresAt() {
      return currentExpiresAt;
    },
    heartbeat,
    release,
  };
}

export function assertCustomRuntimeSurfaceLeaseIdentity(
  lease: CustomRuntimeSurfaceLeaseRecord,
  expected: { activeSha?: string | null; candidateSha?: string | null },
): void {
  if (Object.hasOwn(expected, "activeSha")) {
    const activeSha = validateSha(expected.activeSha, "activeSha");
    if (lease.activeSha !== activeSha) {
      throw new CustomRuntimeSurfaceLeaseError("lost", "custom runtime surface active SHA changed");
    }
  }
  if (Object.hasOwn(expected, "candidateSha")) {
    const candidateSha = validateSha(expected.candidateSha, "candidateSha");
    if (lease.candidateSha !== candidateSha) {
      throw new CustomRuntimeSurfaceLeaseError(
        "lost",
        "custom runtime surface candidate SHA changed",
      );
    }
  }
}

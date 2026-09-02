import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { formatErrorMessage } from "../infra/errors.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { withOpenClawStateStartupMigrationCheckpointDatabase } from "../state/openclaw-state-db.js";

export const LOCAL_MODEL_ADMISSION_SCHEMA = "openclaw.local-model-admission.v1" as const;
export const LOCAL_MODEL_ADMISSION_STATE_DIR_ENV = "OPENCLAW_STATE_DIR" as const;
export const LOCAL_MODEL_ADMISSION_TOKEN_ENV = "OPENCLAW_LOCAL_MODEL_ADMISSION_TOKEN" as const;
export const LOCAL_MODEL_ADMISSION_MAX_WAIT_MS = 30 * 60 * 1000;
export const LOCAL_MODEL_ADMISSION_SAMPLE_INTERVAL_MS = 5_000;
export const LOCAL_MODEL_ADMISSION_DEFAULT_TTL_MS = 5 * 60 * 1000;

const LOCAL_MODEL_LEASE_SCOPE = "local-model";

type LocalModelAdmissionDatabase = Pick<OpenClawStateKyselyDatabase, "state_leases">;

type StoredLocalModelLease = {
  token: string;
  owner: string;
  mode: LocalModelAdmissionMode;
  pid: number;
  acquiredAt: number;
  expiresAt: number;
};

type StoredLocalModelLeaseRow = {
  leaseKey: string;
  owner: string;
  expiresAt: number | null;
  acquiredAt: number;
  payloadJson: string | null;
};

export type LocalModelAdmissionMode = "shared" | "exclusive";

export type LocalModelResourceSnapshot = {
  observedAt: string;
  activeOpenClawWorkerCount: number;
  activeOllamaClientCount: number;
  activeOpenClawWorkerPids?: number[];
  activeOllamaClientPids?: number[];
};

export type LocalModelAdmissionErrorCode = "resource_contention" | "lease_state_invalid";

export class LocalModelAdmissionError extends Error {
  readonly code: LocalModelAdmissionErrorCode;

  constructor(code: LocalModelAdmissionErrorCode, message: string) {
    super(message);
    this.name = "LocalModelAdmissionError";
    this.code = code;
  }
}

export type LocalModelAdmissionLease = {
  readonly schema: typeof LOCAL_MODEL_ADMISSION_SCHEMA;
  readonly token: string;
  readonly owner: string;
  readonly mode: LocalModelAdmissionMode;
  readonly acquiredAt: number;
  expiresAt: number;
  readonly borrowed: boolean;
  readonly samples: readonly LocalModelResourceSnapshot[];
  renew(): Promise<void>;
  release(): Promise<void>;
};

export type AcquireLocalModelAdmissionParams = {
  mode: LocalModelAdmissionMode;
  owner: string;
  env?: NodeJS.ProcessEnv;
  waitMs?: number;
  ttlMs?: number;
  probe?: () => LocalModelResourceSnapshot | Promise<LocalModelResourceSnapshot>;
  sampleIntervalMs?: number;
  signal?: AbortSignal;
};

function admissionError(
  code: LocalModelAdmissionErrorCode,
  message: string,
): LocalModelAdmissionError {
  return new LocalModelAdmissionError(code, message);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      admissionError("resource_contention", "blocked_resource_contention:admission aborted"),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", abort);
    };
    const complete = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        admissionError("resource_contention", "blocked_resource_contention:admission aborted"),
      );
    };
    const timer = setTimeout(complete, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

function validateFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw admissionError("lease_state_invalid", `lease_state_invalid:${label} is invalid`);
  }
}

function withLeaseDatabase<T>(env: NodeJS.ProcessEnv, callback: (db: DatabaseSync) => T): T {
  return withOpenClawStateStartupMigrationCheckpointDatabase(
    (db) => runSqliteImmediateTransactionSync(db, () => callback(db)),
    { env },
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function pruneLeases(db: DatabaseSync, nowMs: number): void {
  const stateDb = getNodeSqliteKysely<LocalModelAdmissionDatabase>(db);
  for (const lease of readLeases(db)) {
    if (lease.expiresAt <= nowMs || !processIsAlive(lease.pid)) {
      executeSqliteQuerySync(
        db,
        stateDb
          .deleteFrom("state_leases")
          .where("scope", "=", LOCAL_MODEL_LEASE_SCOPE)
          .where("lease_key", "=", lease.token),
      );
    }
  }
}

function parseLeaseRow(row: StoredLocalModelLeaseRow): StoredLocalModelLease {
  const acquiredAt = row.acquiredAt;
  const expiresAt = row.expiresAt;
  if (
    typeof row.leaseKey !== "string" ||
    row.leaseKey.length === 0 ||
    typeof row.owner !== "string" ||
    row.owner.trim().length === 0 ||
    !Number.isInteger(acquiredAt) ||
    acquiredAt < 0 ||
    typeof expiresAt !== "number" ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= acquiredAt ||
    typeof row.payloadJson !== "string"
  ) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease entry is invalid");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(row.payloadJson);
  } catch {
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease payload is invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease payload is invalid");
  }
  const mode = (payload as Record<string, unknown>).mode;
  const schema = (payload as Record<string, unknown>).schema;
  const pid = (payload as Record<string, unknown>).pid;
  if (
    schema !== LOCAL_MODEL_ADMISSION_SCHEMA ||
    (mode !== "shared" && mode !== "exclusive") ||
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease payload is invalid");
  }
  return {
    token: row.leaseKey,
    owner: row.owner.trim(),
    mode,
    pid,
    acquiredAt,
    expiresAt,
  };
}

function readLeases(db: DatabaseSync): StoredLocalModelLease[] {
  const stateDb = getNodeSqliteKysely<LocalModelAdmissionDatabase>(db);
  const rows = executeSqliteQuerySync<StoredLocalModelLeaseRow>(
    db,
    stateDb
      .selectFrom("state_leases")
      .select([
        "lease_key as leaseKey",
        "owner",
        "expires_at as expiresAt",
        "created_at as acquiredAt",
        "payload_json as payloadJson",
      ])
      .where("scope", "=", LOCAL_MODEL_LEASE_SCOPE),
  ).rows;
  return rows.map(parseLeaseRow);
}

function readLeaseByToken(db: DatabaseSync, token: string): StoredLocalModelLease | undefined {
  const stateDb = getNodeSqliteKysely<LocalModelAdmissionDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync<StoredLocalModelLeaseRow>(
    db,
    stateDb
      .selectFrom("state_leases")
      .select([
        "lease_key as leaseKey",
        "owner",
        "expires_at as expiresAt",
        "created_at as acquiredAt",
        "payload_json as payloadJson",
      ])
      .where("scope", "=", LOCAL_MODEL_LEASE_SCOPE)
      .where("lease_key", "=", token),
  );
  return row ? parseLeaseRow(row) : undefined;
}

function storeLease(db: DatabaseSync, lease: StoredLocalModelLease): void {
  const stateDb = getNodeSqliteKysely<LocalModelAdmissionDatabase>(db);
  executeSqliteQuerySync(
    db,
    stateDb.insertInto("state_leases").values({
      scope: LOCAL_MODEL_LEASE_SCOPE,
      lease_key: lease.token,
      owner: lease.owner,
      expires_at: lease.expiresAt,
      heartbeat_at: lease.acquiredAt,
      payload_json: JSON.stringify({
        schema: LOCAL_MODEL_ADMISSION_SCHEMA,
        mode: lease.mode,
        pid: lease.pid,
      }),
      created_at: lease.acquiredAt,
      updated_at: lease.acquiredAt,
    }),
  );
}

function renewLease(env: NodeJS.ProcessEnv, token: string, owner: string, ttlMs: number): number {
  const nowMs = Date.now();
  const expiresAt = nowMs + ttlMs;
  withLeaseDatabase(env, (db) => {
    const stateDb = getNodeSqliteKysely<LocalModelAdmissionDatabase>(db);
    const result = executeSqliteQuerySync(
      db,
      stateDb
        .updateTable("state_leases")
        .set({
          expires_at: expiresAt,
          heartbeat_at: nowMs,
          updated_at: nowMs,
        })
        .where("scope", "=", LOCAL_MODEL_LEASE_SCOPE)
        .where("lease_key", "=", token)
        .where("owner", "=", owner)
        .where("expires_at", ">", nowMs),
    );
    if (result.numAffectedRows !== 1n) {
      throw admissionError("lease_state_invalid", "lease_state_invalid:owned lease disappeared");
    }
  });
  return expiresAt;
}

function releaseLease(env: NodeJS.ProcessEnv, token: string, owner: string): void {
  withLeaseDatabase(env, (db) => {
    const nowMs = Date.now();
    pruneLeases(db, nowMs);
    const stateDb = getNodeSqliteKysely<LocalModelAdmissionDatabase>(db);
    const result = executeSqliteQuerySync(
      db,
      stateDb
        .deleteFrom("state_leases")
        .where("scope", "=", LOCAL_MODEL_LEASE_SCOPE)
        .where("lease_key", "=", token)
        .where("owner", "=", owner),
    );
    if (result.numAffectedRows !== 1n) {
      throw admissionError(
        "lease_state_invalid",
        "lease_state_invalid:owned lease disappeared before release",
      );
    }
  });
}

function makeLease(params: {
  stored: StoredLocalModelLease;
  env: NodeJS.ProcessEnv;
  borrowed: boolean;
  samples: readonly LocalModelResourceSnapshot[];
  ttlMs: number;
}): LocalModelAdmissionLease {
  let expiresAt = params.stored.expiresAt;
  let released = false;
  let renewalError: unknown;
  let timer: NodeJS.Timeout | undefined;
  const renew = async () => {
    if (released || params.borrowed) {
      return;
    }
    expiresAt = renewLease(params.env, params.stored.token, params.stored.owner, params.ttlMs);
  };
  if (!params.borrowed) {
    timer = setInterval(
      () => {
        void renew().catch((error: unknown) => {
          renewalError = error;
        });
      },
      Math.max(1, Math.floor(params.ttlMs / 3)),
    );
    timer.unref?.();
  }
  return {
    schema: LOCAL_MODEL_ADMISSION_SCHEMA,
    token: params.stored.token,
    owner: params.stored.owner,
    mode: params.stored.mode,
    acquiredAt: params.stored.acquiredAt,
    get expiresAt() {
      return expiresAt;
    },
    set expiresAt(value: number) {
      expiresAt = value;
    },
    borrowed: params.borrowed,
    samples: params.samples,
    renew: async () => {
      if (renewalError) {
        throw renewalError instanceof Error
          ? renewalError
          : new Error(formatErrorMessage(renewalError));
      }
      await renew();
    },
    release: async () => {
      if (released || params.borrowed) {
        return;
      }
      released = true;
      if (timer) {
        clearInterval(timer);
      }
      if (renewalError) {
        try {
          releaseLease(params.env, params.stored.token, params.stored.owner);
        } catch {
          // Preserve the renewal error as the primary failure.
        }
        throw renewalError instanceof Error
          ? renewalError
          : new Error(formatErrorMessage(renewalError));
      }
      releaseLease(params.env, params.stored.token, params.stored.owner);
    },
  };
}

function validateSnapshot(snapshot: LocalModelResourceSnapshot): void {
  if (
    typeof snapshot.observedAt !== "string" ||
    !Number.isInteger(snapshot.activeOpenClawWorkerCount) ||
    snapshot.activeOpenClawWorkerCount < 0 ||
    !Number.isInteger(snapshot.activeOllamaClientCount) ||
    snapshot.activeOllamaClientCount < 0
  ) {
    throw admissionError(
      "lease_state_invalid",
      "lease_state_invalid:resource probe returned invalid data",
    );
  }
}

export async function acquireLocalModelAdmission(
  params: AcquireLocalModelAdmissionParams,
): Promise<LocalModelAdmissionLease> {
  if ((params.mode !== "shared" && params.mode !== "exclusive") || !params.owner.trim()) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:mode and owner are required");
  }
  const waitMs = params.waitMs ?? LOCAL_MODEL_ADMISSION_MAX_WAIT_MS;
  const ttlMs = params.ttlMs ?? LOCAL_MODEL_ADMISSION_DEFAULT_TTL_MS;
  const sampleIntervalMs = params.sampleIntervalMs ?? LOCAL_MODEL_ADMISSION_SAMPLE_INTERVAL_MS;
  validateFiniteNonNegative(waitMs, "waitMs");
  validateFiniteNonNegative(sampleIntervalMs, "sampleIntervalMs");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || waitMs > LOCAL_MODEL_ADMISSION_MAX_WAIT_MS) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease timing is invalid");
  }
  if (params.mode === "exclusive" && !params.probe) {
    throw admissionError(
      "lease_state_invalid",
      "lease_state_invalid:exclusive admission requires a resource probe",
    );
  }
  const env = params.env ?? process.env;
  const inheritedToken = env[LOCAL_MODEL_ADMISSION_TOKEN_ENV]?.trim();
  if (inheritedToken) {
    const stored = withLeaseDatabase(env, (db) => {
      const nowMs = Date.now();
      pruneLeases(db, nowMs);
      const found = readLeaseByToken(db, inheritedToken);
      if (!found || found.expiresAt <= nowMs || found.mode !== "exclusive") {
        throw admissionError(
          "lease_state_invalid",
          "lease_state_invalid:inherited exclusive lease token is invalid",
        );
      }
      return found;
    });
    return makeLease({ stored, env, borrowed: true, samples: [], ttlMs });
  }

  const deadline = Date.now() + waitMs;
  const token = crypto.randomUUID().replaceAll("-", "");
  let stored: StoredLocalModelLease;
  while (true) {
    if (params.signal?.aborted) {
      throw admissionError("resource_contention", "blocked_resource_contention:admission aborted");
    }
    const nowMs = Date.now();
    const acquired = withLeaseDatabase(env, (db) => {
      pruneLeases(db, nowMs);
      const leases = readLeases(db);
      const conflict =
        params.mode === "exclusive"
          ? leases.length > 0
          : leases.some((lease) => lease.mode === "exclusive");
      if (conflict) {
        return undefined;
      }
      const next: StoredLocalModelLease = {
        token,
        owner: params.owner.trim(),
        mode: params.mode,
        pid: process.pid,
        acquiredAt: nowMs,
        expiresAt: nowMs + ttlMs,
      };
      storeLease(db, next);
      return next;
    });
    if (acquired) {
      stored = acquired;
      break;
    }
    if (Date.now() >= deadline) {
      throw admissionError(
        "resource_contention",
        "blocked_resource_contention:local-model admission is busy",
      );
    }
    await sleep(Math.min(250, Math.max(10, deadline - Date.now())), params.signal);
  }

  const samples: LocalModelResourceSnapshot[] = [];
  const lease = makeLease({ stored, env, borrowed: false, samples, ttlMs });
  try {
    if (params.mode === "exclusive") {
      while (samples.length < 3) {
        const snapshot = await params.probe!();
        validateSnapshot(snapshot);
        if (snapshot.activeOpenClawWorkerCount === 0 && snapshot.activeOllamaClientCount === 0) {
          samples.push({ ...snapshot });
        } else {
          samples.length = 0;
        }
        if (samples.length < 3) {
          if (Date.now() >= deadline) {
            throw admissionError(
              "resource_contention",
              "blocked_resource_contention:three zero-worker and zero-client samples were not proven",
            );
          }
          await sleep(
            Math.min(sampleIntervalMs, Math.max(0, deadline - Date.now())),
            params.signal,
          );
        }
      }
    }
    // Sampling can legitimately wait much longer than the base lease TTL.
    // Renew as soon as the exclusive lease is stored, then prove it still exists.
    await lease.renew();
    return lease;
  } catch (error) {
    try {
      await lease.release();
    } catch {
      // The original admission failure is more actionable; the missing lease is fail-closed on the next attempt.
    }
    throw error;
  }
}

export async function acquireExclusiveLocalModelAdmission(
  params: Omit<AcquireLocalModelAdmissionParams, "mode">,
): Promise<LocalModelAdmissionLease> {
  return acquireLocalModelAdmission({ ...params, mode: "exclusive" });
}

export async function acquireSharedLocalModelAdmission(
  params: Omit<AcquireLocalModelAdmissionParams, "mode" | "probe">,
): Promise<LocalModelAdmissionLease> {
  return acquireLocalModelAdmission({ ...params, mode: "shared" });
}

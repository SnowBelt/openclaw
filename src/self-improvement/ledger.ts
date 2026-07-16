import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock } from "../infra/json-files.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { readSqliteQuickCheck } from "../infra/sqlite-integrity.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";

const LEDGER_DIRECTORY = "self-improvement";
const LEDGER_FILENAME = "ledger.sqlite";
const LEDGER_SCHEMA_VERSION = 1;

export const SELF_IMPROVEMENT_LEDGER_COLLECTIONS = [
  "recommendations",
  "proposals",
  "audit_events",
  "scorecards",
  "health_snapshots",
  "proof_receipts",
  "signals",
  "interventions",
  "outbox",
] as const;

export type SelfImprovementLedgerCollection = (typeof SELF_IMPROVEMENT_LEDGER_COLLECTIONS)[number];

export type SelfImprovementLedgerRow<T> = {
  id: string;
  createdAt: number;
  updatedAt: number;
  value: T;
  payloadHash: string;
};

type StoredLedgerRow = {
  entity_id: string;
  created_at: number;
  updated_at: number;
  payload_json: string;
  payload_hash: string;
};

type SelfImprovementLedgerDatabase = {
  sig_ledger_entities: StoredLedgerRow & { collection: string };
  sig_ledger_metadata: {
    key: string;
    value_json: string;
    updated_at: number;
  };
};

type NormalizedLedgerRow<T> = SelfImprovementLedgerRow<T> & {
  payloadJson: string;
};

const ledgerMutationLocks = new Map<string, ReturnType<typeof createAsyncLock>>();

function withLedgerMutation<T>(ledgerPath: string, mutate: () => Promise<T>): Promise<T> {
  const key = path.resolve(ledgerPath);
  let lock = ledgerMutationLocks.get(key);
  if (!lock) {
    lock = createAsyncLock();
    ledgerMutationLocks.set(key, lock);
  }
  return lock(mutate);
}

function stableJson(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "null" : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      ([, entry]) =>
        entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol",
    )
    .toSorted(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTimestamp(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

export function resolveSelfImprovementLedgerPath(stateDir = resolveStateDir()): string {
  return path.join(stateDir, LEDGER_DIRECTORY, LEDGER_FILENAME);
}

async function openLedger(ledgerPath: string) {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const { DatabaseSync } = requireNodeSqlite();
  const database = new DatabaseSync(ledgerPath);
  // sqlite-allow-raw -- connection PRAGMAs and schema DDL belong to this lifecycle boundary.
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sig_ledger_entities (
      collection TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      PRIMARY KEY (collection, entity_id)
    );
    CREATE INDEX IF NOT EXISTS sig_ledger_entities_collection_updated
      ON sig_ledger_entities (collection, updated_at DESC, entity_id ASC);
    CREATE TABLE IF NOT EXISTS sig_ledger_metadata (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    PRAGMA user_version = ${LEDGER_SCHEMA_VERSION};
  `);
  return database;
}

async function openExistingLedgerReadOnly(ledgerPath: string) {
  try {
    await fs.access(ledgerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const { DatabaseSync } = requireNodeSqlite();
  const database = new DatabaseSync(ledgerPath, { readOnly: true });
  // sqlite-allow-raw -- a read-only connection still needs a bounded busy timeout.
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

function getSelfImprovementLedgerKysely(database: DatabaseSync) {
  return getNodeSqliteKysely<SelfImprovementLedgerDatabase>(database);
}

function closeLedger(database: DatabaseSync): void {
  clearNodeSqliteKyselyCacheForDatabase(database);
  database.close();
}

async function normalizeLedgerRows<T>(params: {
  collection: SelfImprovementLedgerCollection;
  rows: readonly T[];
  id: (value: T) => string;
  createdAt?: (value: T) => number | undefined;
  updatedAt?: (value: T) => number | undefined;
  now: number;
}): Promise<NormalizedLedgerRow<T>[]> {
  const normalized = await Promise.all(
    params.rows.map(async (value) => {
      const id = params.id(value).trim();
      if (!id) {
        throw new Error("Self-improvement ledger rows require a non-empty id.");
      }
      const payloadJson = stableJson(value);
      return {
        id,
        createdAt: normalizeTimestamp(params.createdAt?.(value), params.now),
        updatedAt: normalizeTimestamp(params.updatedAt?.(value), params.now),
        payloadJson,
        payloadHash: await sha256(payloadJson),
        value,
      };
    }),
  );
  const uniqueIds = new Set(normalized.map((entry) => entry.id));
  if (uniqueIds.size !== normalized.length) {
    throw new Error(
      `Self-improvement ledger collection ${params.collection} contains duplicate ids.`,
    );
  }
  return normalized;
}

function publicLedgerRows<T>(
  rows: readonly NormalizedLedgerRow<T>[],
): SelfImprovementLedgerRow<T>[] {
  return rows
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .map(({ id, createdAt, updatedAt, value, payloadHash }) => ({
      id,
      createdAt,
      updatedAt,
      value,
      payloadHash,
    }));
}

function upsertNormalizedRows<T>(params: {
  database: Awaited<ReturnType<typeof openLedger>>;
  collection: SelfImprovementLedgerCollection;
  rows: readonly NormalizedLedgerRow<T>[];
}): void {
  const kysely = getSelfImprovementLedgerKysely(params.database);
  for (const entry of params.rows) {
    executeSqliteQuerySync(
      params.database,
      kysely
        .insertInto("sig_ledger_entities")
        .values({
          collection: params.collection,
          entity_id: entry.id,
          created_at: entry.createdAt,
          updated_at: entry.updatedAt,
          payload_json: entry.payloadJson,
          payload_hash: entry.payloadHash,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["collection", "entity_id"])
            .doUpdateSet({
              created_at: (eb) => eb.ref("excluded.created_at"),
              updated_at: (eb) => eb.ref("excluded.updated_at"),
              payload_json: (eb) => eb.ref("excluded.payload_json"),
              payload_hash: (eb) => eb.ref("excluded.payload_hash"),
            })
            .where((eb) =>
              eb.or([
                eb("sig_ledger_entities.created_at", "!=", eb.ref("excluded.created_at")),
                eb("sig_ledger_entities.updated_at", "!=", eb.ref("excluded.updated_at")),
                eb("sig_ledger_entities.payload_hash", "!=", eb.ref("excluded.payload_hash")),
              ]),
            ),
        ),
    );
  }
}

export async function listSelfImprovementLedgerRows<T>(params: {
  collection: SelfImprovementLedgerCollection;
  ledgerPath?: string;
  stateDir?: string;
}): Promise<SelfImprovementLedgerRow<T>[]> {
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  const database = await openExistingLedgerReadOnly(ledgerPath);
  if (!database) {
    return [];
  }
  try {
    const rows = executeSqliteQuerySync(
      database,
      getSelfImprovementLedgerKysely(database)
        .selectFrom("sig_ledger_entities")
        .select(["entity_id", "created_at", "updated_at", "payload_json", "payload_hash"])
        .where("collection", "=", params.collection)
        .orderBy("updated_at", "desc")
        .orderBy("entity_id", "asc"),
    ).rows;
    return rows.flatMap((row) => {
      try {
        return [
          {
            id: row.entity_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            value: JSON.parse(row.payload_json) as T,
            payloadHash: row.payload_hash,
          },
        ];
      } catch {
        return [];
      }
    });
  } finally {
    closeLedger(database);
  }
}

/** Upsert only the supplied rows without deleting sibling rows in the collection. */
export async function upsertSelfImprovementLedgerRows<T>(params: {
  collection: SelfImprovementLedgerCollection;
  rows: readonly T[];
  id: (value: T) => string;
  createdAt?: (value: T) => number | undefined;
  updatedAt?: (value: T) => number | undefined;
  ledgerPath?: string;
  stateDir?: string;
  now?: number;
}): Promise<SelfImprovementLedgerRow<T>[]> {
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  const normalized = await normalizeLedgerRows({
    collection: params.collection,
    rows: params.rows,
    id: params.id,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    ...(params.updatedAt ? { updatedAt: params.updatedAt } : {}),
    now: params.now ?? Date.now(),
  });
  await withLedgerMutation(ledgerPath, async () => {
    const database = await openLedger(ledgerPath);
    try {
      runSqliteImmediateTransactionSync(database, () => {
        upsertNormalizedRows({ database, collection: params.collection, rows: normalized });
      });
    } finally {
      closeLedger(database);
    }
  });
  return publicLedgerRows(normalized);
}

/** Delete only the supplied identifiers from one collection. */
export async function deleteSelfImprovementLedgerRows(params: {
  collection: SelfImprovementLedgerCollection;
  ids: readonly string[];
  ledgerPath?: string;
  stateDir?: string;
}): Promise<number> {
  const ids = [...new Set(params.ids.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return 0;
  }
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  return await withLedgerMutation(ledgerPath, async () => {
    const database = await openLedger(ledgerPath);
    try {
      return runSqliteImmediateTransactionSync(database, () => {
        const kysely = getSelfImprovementLedgerKysely(database);
        let deleted = 0;
        for (const id of ids) {
          const result = executeSqliteQuerySync(
            database,
            kysely
              .deleteFrom("sig_ledger_entities")
              .where("collection", "=", params.collection)
              .where("entity_id", "=", id),
          );
          deleted += Number(result.numAffectedRows ?? 0);
        }
        return deleted;
      });
    } finally {
      closeLedger(database);
    }
  });
}

export async function replaceSelfImprovementLedgerRows<T>(params: {
  collection: SelfImprovementLedgerCollection;
  rows: readonly T[];
  id: (value: T) => string;
  createdAt?: (value: T) => number | undefined;
  updatedAt?: (value: T) => number | undefined;
  ledgerPath?: string;
  stateDir?: string;
  now?: number;
}): Promise<SelfImprovementLedgerRow<T>[]> {
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  const normalized = await normalizeLedgerRows({
    collection: params.collection,
    rows: params.rows,
    id: params.id,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    ...(params.updatedAt ? { updatedAt: params.updatedAt } : {}),
    now: params.now ?? Date.now(),
  });
  const desiredIds = new Set(normalized.map((entry) => entry.id));
  await withLedgerMutation(ledgerPath, async () => {
    const database = await openLedger(ledgerPath);
    try {
      runSqliteImmediateTransactionSync(database, () => {
        upsertNormalizedRows({ database, collection: params.collection, rows: normalized });
        const kysely = getSelfImprovementLedgerKysely(database);
        const existing = executeSqliteQuerySync(
          database,
          kysely
            .selectFrom("sig_ledger_entities")
            .select("entity_id")
            .where("collection", "=", params.collection),
        ).rows;
        for (const row of existing) {
          if (!desiredIds.has(row.entity_id)) {
            executeSqliteQuerySync(
              database,
              kysely
                .deleteFrom("sig_ledger_entities")
                .where("collection", "=", params.collection)
                .where("entity_id", "=", row.entity_id),
            );
          }
        }
      });
    } finally {
      closeLedger(database);
    }
  });
  return publicLedgerRows(normalized);
}

export async function readSelfImprovementLedgerMetadata<T>(params: {
  key: string;
  ledgerPath?: string;
  stateDir?: string;
}): Promise<T | null> {
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  const database = await openExistingLedgerReadOnly(ledgerPath);
  if (!database) {
    return null;
  }
  try {
    const row = executeSqliteQueryTakeFirstSync(
      database,
      getSelfImprovementLedgerKysely(database)
        .selectFrom("sig_ledger_metadata")
        .select("value_json")
        .where("key", "=", params.key),
    );
    if (!row?.value_json) {
      return null;
    }
    return JSON.parse(row.value_json) as T;
  } finally {
    closeLedger(database);
  }
}

export async function writeSelfImprovementLedgerMetadata(params: {
  key: string;
  value: unknown;
  ledgerPath?: string;
  stateDir?: string;
  now?: number;
}): Promise<void> {
  const key = params.key.trim();
  if (!key) {
    throw new Error("Self-improvement ledger metadata requires a non-empty key.");
  }
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  await withLedgerMutation(ledgerPath, async () => {
    const database = await openLedger(ledgerPath);
    try {
      executeSqliteQuerySync(
        database,
        getSelfImprovementLedgerKysely(database)
          .insertInto("sig_ledger_metadata")
          .values({
            key,
            value_json: stableJson(params.value),
            updated_at: params.now ?? Date.now(),
          })
          .onConflict((conflict) =>
            conflict.column("key").doUpdateSet({
              value_json: (eb) => eb.ref("excluded.value_json"),
              updated_at: (eb) => eb.ref("excluded.updated_at"),
            }),
          ),
      );
    } finally {
      closeLedger(database);
    }
  });
}

export type SelfImprovementLedgerIntegrityReport = {
  ledgerPath: string;
  exists: boolean;
  ok: boolean;
  quickCheck: string[];
  schemaVersion?: number;
  collections: Partial<Record<SelfImprovementLedgerCollection, number>>;
};

/** Inspect an existing ledger without creating or mutating it. */
export async function inspectSelfImprovementLedgerIntegrity(params?: {
  ledgerPath?: string;
  stateDir?: string;
}): Promise<SelfImprovementLedgerIntegrityReport> {
  const ledgerPath = params?.ledgerPath ?? resolveSelfImprovementLedgerPath(params?.stateDir);
  const database = await openExistingLedgerReadOnly(ledgerPath);
  if (!database) {
    return { ledgerPath, exists: false, ok: true, quickCheck: [], collections: {} };
  }
  try {
    const quickCheck = readSqliteQuickCheck(database);
    const countRows = executeSqliteQuerySync(
      database,
      getSelfImprovementLedgerKysely(database)
        .selectFrom("sig_ledger_entities")
        .select((eb) => ["collection", eb.fn.countAll<number>().as("count")])
        .groupBy("collection")
        .orderBy("collection", "asc"),
    ).rows;
    return {
      ledgerPath,
      exists: true,
      ok: quickCheck.length === 1 && quickCheck[0] === "ok",
      quickCheck,
      schemaVersion: readSqliteUserVersion(database),
      collections: Object.fromEntries(countRows.map((row) => [row.collection, row.count])),
    };
  } finally {
    closeLedger(database);
  }
}

export type SelfImprovementLedgerBackupReport = {
  sourcePath: string;
  backupPath: string;
  createdAt: number;
  bytes: number;
  sha256: string;
  integrity: SelfImprovementLedgerIntegrityReport;
};

/** Create an atomic, integrity-checked backup after checkpointing the WAL. */
export async function backupSelfImprovementLedger(params: {
  backupPath: string;
  ledgerPath?: string;
  stateDir?: string;
  now?: number;
}): Promise<SelfImprovementLedgerBackupReport> {
  const ledgerPath = params.ledgerPath ?? resolveSelfImprovementLedgerPath(params.stateDir);
  const backupPath = path.resolve(params.backupPath);
  if (backupPath === path.resolve(ledgerPath)) {
    throw new Error("Self-improvement ledger backup path must differ from the source path.");
  }
  const createdAt = params.now ?? Date.now();
  await fs.mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${backupPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await withLedgerMutation(ledgerPath, async () => {
    const database = await openLedger(ledgerPath);
    try {
      // sqlite-allow-raw -- WAL checkpointing is a database lifecycle operation.
      database.exec("PRAGMA wal_checkpoint(FULL)");
    } finally {
      closeLedger(database);
    }
    await fs.copyFile(ledgerPath, temporaryPath);
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, backupPath);
  }).catch(async (error: unknown) => {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  });
  const content = await fs.readFile(backupPath);
  const integrity = await inspectSelfImprovementLedgerIntegrity({ ledgerPath: backupPath });
  if (!integrity.ok) {
    throw new Error(
      `Self-improvement ledger backup integrity failed: ${integrity.quickCheck.join(", ")}`,
    );
  }
  return {
    sourcePath: ledgerPath,
    backupPath,
    createdAt,
    bytes: content.byteLength,
    sha256: sha256Bytes(content),
    integrity,
  };
}

export { LEDGER_SCHEMA_VERSION, stableJson as stableSelfImprovementLedgerJson };

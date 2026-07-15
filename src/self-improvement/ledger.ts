import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock } from "../infra/json-files.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";

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
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
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
  `);
  database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
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
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
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
  const upsert = params.database.prepare(`
    INSERT INTO sig_ledger_entities
      (collection, entity_id, created_at, updated_at, payload_json, payload_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(collection, entity_id) DO UPDATE SET
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json,
      payload_hash = excluded.payload_hash
    WHERE sig_ledger_entities.created_at != excluded.created_at
      OR sig_ledger_entities.updated_at != excluded.updated_at
      OR sig_ledger_entities.payload_hash != excluded.payload_hash
  `);
  for (const entry of params.rows) {
    upsert.run(
      params.collection,
      entry.id,
      entry.createdAt,
      entry.updatedAt,
      entry.payloadJson,
      entry.payloadHash,
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
    const rows = database
      .prepare(
        `SELECT entity_id, created_at, updated_at, payload_json, payload_hash
         FROM sig_ledger_entities
         WHERE collection = ?
         ORDER BY updated_at DESC, entity_id ASC`,
      )
      .all(params.collection) as StoredLedgerRow[];
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
    database.close();
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
      database.exec("BEGIN IMMEDIATE");
      try {
        upsertNormalizedRows({ database, collection: params.collection, rows: normalized });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      database.close();
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
      database.exec("BEGIN IMMEDIATE");
      try {
        const remove = database.prepare(
          "DELETE FROM sig_ledger_entities WHERE collection = ? AND entity_id = ?",
        );
        let deleted = 0;
        for (const id of ids) {
          const result = remove.run(params.collection, id);
          deleted += Number(result.changes ?? 0);
        }
        database.exec("COMMIT");
        return deleted;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      database.close();
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
      database.exec("BEGIN IMMEDIATE");
      try {
        upsertNormalizedRows({ database, collection: params.collection, rows: normalized });
        const existing = database
          .prepare("SELECT entity_id FROM sig_ledger_entities WHERE collection = ?")
          .all(params.collection) as Array<{ entity_id: string }>;
        const remove = database.prepare(
          "DELETE FROM sig_ledger_entities WHERE collection = ? AND entity_id = ?",
        );
        for (const row of existing) {
          if (!desiredIds.has(row.entity_id)) {
            remove.run(params.collection, row.entity_id);
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      database.close();
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
    const row = database
      .prepare("SELECT value_json FROM sig_ledger_metadata WHERE key = ?")
      .get(params.key) as { value_json?: string } | undefined;
    if (!row?.value_json) {
      return null;
    }
    return JSON.parse(row.value_json) as T;
  } finally {
    database.close();
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
      database
        .prepare(`
          INSERT INTO sig_ledger_metadata (key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        `)
        .run(key, stableJson(params.value), params.now ?? Date.now());
    } finally {
      database.close();
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
    const quickRows = database.prepare("PRAGMA quick_check").all() as Array<{
      quick_check?: string;
    }>;
    const quickCheck = quickRows.map((row) => row.quick_check ?? "unknown");
    const versionRow = database.prepare("PRAGMA user_version").get() as
      | { user_version?: number }
      | undefined;
    const countRows = database
      .prepare(
        `SELECT collection, COUNT(*) AS count
         FROM sig_ledger_entities
         GROUP BY collection
         ORDER BY collection`,
      )
      .all() as Array<{ collection: SelfImprovementLedgerCollection; count: number }>;
    return {
      ledgerPath,
      exists: true,
      ok: quickCheck.length === 1 && quickCheck[0] === "ok",
      quickCheck,
      schemaVersion: versionRow?.user_version ?? 0,
      collections: Object.fromEntries(countRows.map((row) => [row.collection, row.count])),
    };
  } finally {
    database.close();
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
      database.exec("PRAGMA wal_checkpoint(FULL)");
    } finally {
      database.close();
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

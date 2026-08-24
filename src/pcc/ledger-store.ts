// PCC ledger storage is transactional, revisioned, and compatible with legacy JSON export.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import {
  configureSqliteConnectionPragmas,
  type SqliteWalMaintenance,
} from "../infra/sqlite-wal.js";
import type { PccLedger } from "./domain/ledger.js";
import {
  DEFAULT_PCC_PRIVATE_TEAM_POLICY,
  normalizePccPrivateTeamPolicy,
} from "./private-team-policy.js";
import { normalizePccTimestamp } from "./timestamps.js";

export type { PccLedger } from "./domain/ledger.js";

export type PccLedgerMutationOptions = {
  write?: boolean;
  auditKind?: string;
};

export type PccLedgerStorageMigration = {
  needed: boolean;
  legacyPath: string;
  sqlitePath: string;
  reason: string | null;
};

export type PccLedgerStorageMigrationResult = {
  migrated: boolean;
  legacyPath: string;
  sqlitePath: string;
  backupPath: string | null;
  revision: number | null;
};

type LedgerSnapshotRow = {
  schema_version: number;
  revision: number;
  payload_json: string;
  payload_sha256: string;
  updated_at: string;
};

type PccLedgerDatabase = {
  pcc_ledger_snapshot: LedgerSnapshotRow & { singleton: number };
  pcc_ledger_audit: {
    id: string;
    revision: number;
    event_kind: string;
    payload_sha256: string;
    created_at: string;
    details_json: string | null;
  };
};

type OpenLedgerDatabase = {
  db: DatabaseSync;
  path: string;
  walMaintenance: SqliteWalMaintenance;
};

const PCC_LEDGER_VERSION = 1;
const PCC_LEDGER_STORAGE_SCHEMA_VERSION = 1;
const PCC_DIR_NAME = "pcc";
const PCC_LEDGER_JSON_FILE = "ledger.json";
const PCC_LEDGER_SQLITE_FILE = "ledger.sqlite";
const PCC_LEDGER_BUSY_TIMEOUT_MS = 30_000;
const PCC_DIR_MODE = 0o700;
const PCC_FILE_MODE = 0o600;
const PCC_LEDGER_BACKUP_FILE = "ledger.last-known-good.json";
const cachedDatabases = new Map<string, OpenLedgerDatabase>();

function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw", "state");
}

export function pccLedgerJsonPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), PCC_DIR_NAME, PCC_LEDGER_JSON_FILE);
}

export function pccLedgerSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), PCC_DIR_NAME, PCC_LEDGER_SQLITE_FILE);
}

export function pccLedgerBackupPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), PCC_DIR_NAME, PCC_LEDGER_BACKUP_FILE);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function defaultLedger(): PccLedger {
  return {
    version: PCC_LEDGER_VERSION,
    projects: [],
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    lastKnownGood: [],
    attachments: [],
    attachmentUsageReceipts: [],
    modelRunReceipts: [],
    settings: { privateTeamPolicy: DEFAULT_PCC_PRIVATE_TEAM_POLICY },
  };
}

type PccReceipt = PccLedger["receipts"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePccReceipts(value: unknown): PccLedger["receipts"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((receipt) => {
    if (!isRecord(receipt)) {
      return receipt as PccReceipt;
    }
    if (typeof receipt.completedAt === "string" && receipt.completedAt.length > 0) {
      return receipt as PccReceipt;
    }
    // Older receipts stored the completion timestamp as createdAt; normalize only the
    // in-memory read model so the dashboard cannot fail before a state migration runs.
    return typeof receipt.createdAt === "string" && receipt.createdAt.length > 0
      ? ({ ...receipt, completedAt: receipt.createdAt } as PccReceipt)
      : (receipt as PccReceipt);
  });
}

type PccLedgerAssertionOptions = {
  normalizeLegacyReceipts?: boolean;
};

export function assertPccLedger(
  value: unknown,
  options: PccLedgerAssertionOptions = {},
): PccLedger {
  if (!value || typeof value !== "object") {
    return defaultLedger();
  }
  const raw = value as Partial<PccLedger>;
  return {
    version: PCC_LEDGER_VERSION,
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
    subMilestones: Array.isArray(raw.subMilestones) ? raw.subMilestones : [],
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    receipts:
      options.normalizeLegacyReceipts === false
        ? Array.isArray(raw.receipts)
          ? raw.receipts
          : []
        : normalizePccReceipts(raw.receipts),
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    lastKnownGood: Array.isArray(raw.lastKnownGood) ? raw.lastKnownGood : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    attachmentUsageReceipts: Array.isArray(raw.attachmentUsageReceipts)
      ? raw.attachmentUsageReceipts
      : [],
    modelRunReceipts: Array.isArray(raw.modelRunReceipts) ? raw.modelRunReceipts : [],
    settings:
      raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
        ? {
            ...raw.settings,
            privateTeamPolicy: normalizePccPrivateTeamPolicy(raw.settings.privateTeamPolicy),
          }
        : { privateTeamPolicy: DEFAULT_PCC_PRIVATE_TEAM_POLICY },
  };
}

function privateMode(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // PCC state stays usable on filesystems that do not support POSIX modes.
  }
}

function ensurePrivateStoragePath(pathname: string): void {
  const directory = path.dirname(pathname);
  fs.mkdirSync(directory, { recursive: true, mode: PCC_DIR_MODE });
  privateMode(directory, PCC_DIR_MODE);
  for (const candidate of [pathname, `${pathname}-wal`, `${pathname}-shm`]) {
    if (fs.existsSync(candidate)) {
      privateMode(candidate, PCC_FILE_MODE);
    }
  }
}

function ensureLedgerSchema(db: DatabaseSync, pathname: string): void {
  const userVersion = readSqliteUserVersion(db);
  if (userVersion > PCC_LEDGER_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `PCC ledger database ${pathname} uses newer schema version ${userVersion}; this OpenClaw build supports ${PCC_LEDGER_STORAGE_SCHEMA_VERSION}.`,
    );
  }
  // sqlite-allow-raw -- schema DDL and PRAGMA ownership stay at the database lifecycle boundary.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pcc_ledger_snapshot (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pcc_ledger_audit (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      event_kind TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      details_json TEXT
    );
    CREATE INDEX IF NOT EXISTS pcc_ledger_audit_revision_idx
      ON pcc_ledger_audit (revision DESC, created_at DESC);
    PRAGMA user_version = ${PCC_LEDGER_STORAGE_SCHEMA_VERSION};
  `);
}

function getPccLedgerKysely(db: DatabaseSync) {
  return getNodeSqliteKysely<PccLedgerDatabase>(db);
}

function openLedgerDatabase(env: NodeJS.ProcessEnv = process.env): OpenLedgerDatabase {
  const pathname = path.resolve(pccLedgerSqlitePath(env));
  const cached = cachedDatabases.get(pathname);
  if (cached?.db.isOpen) {
    return cached;
  }
  if (cached) {
    cached.walMaintenance.close();
    cachedDatabases.delete(pathname);
  }
  ensurePrivateStoragePath(pathname);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);
  let walMaintenance: SqliteWalMaintenance | undefined;
  try {
    walMaintenance = configureSqliteConnectionPragmas(db, {
      busyTimeoutMs: PCC_LEDGER_BUSY_TIMEOUT_MS,
      databaseLabel: "pcc-ledger",
      databasePath: pathname,
      foreignKeys: true,
      synchronous: "NORMAL",
    });
    ensureLedgerSchema(db, pathname);
    ensurePrivateStoragePath(pathname);
    const database = { db, path: pathname, walMaintenance };
    cachedDatabases.set(pathname, database);
    return database;
  } catch (error) {
    walMaintenance?.close();
    db.close();
    throw error;
  }
}

function selectSnapshot(db: DatabaseSync): LedgerSnapshotRow | null {
  const row = executeSqliteQueryTakeFirstSync(
    db,
    getPccLedgerKysely(db)
      .selectFrom("pcc_ledger_snapshot")
      .select(["schema_version", "revision", "payload_json", "payload_sha256", "updated_at"])
      .where("singleton", "=", 1),
  );
  return row ?? null;
}

function parseSnapshot(row: LedgerSnapshotRow, options: PccLedgerAssertionOptions = {}): PccLedger {
  if (row.schema_version !== PCC_LEDGER_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `PCC ledger snapshot uses unsupported schema version ${row.schema_version}; run openclaw doctor --fix to repair it.`,
    );
  }
  if (sha256(row.payload_json) !== row.payload_sha256) {
    throw new Error(
      "PCC ledger snapshot checksum mismatch; run openclaw doctor --fix to recover it.",
    );
  }
  try {
    return assertPccLedger(JSON.parse(row.payload_json) as unknown, options);
  } catch (error) {
    throw new Error(
      "PCC ledger snapshot JSON is corrupt; run openclaw doctor --fix to recover it.",
      {
        cause: error,
      },
    );
  }
}

function writeSnapshot(
  db: DatabaseSync,
  ledger: PccLedger,
  revision: number,
  eventKind: string,
): void {
  const payload = JSON.stringify(ledger);
  const payloadSha256 = sha256(payload);
  const updatedAt = nowIso();
  const kysely = getPccLedgerKysely(db);
  executeSqliteQuerySync(
    db,
    kysely
      .insertInto("pcc_ledger_snapshot")
      .values({
        singleton: 1,
        schema_version: PCC_LEDGER_STORAGE_SCHEMA_VERSION,
        revision,
        payload_json: payload,
        payload_sha256: payloadSha256,
        updated_at: updatedAt,
      })
      .onConflict((conflict) =>
        conflict.column("singleton").doUpdateSet({
          schema_version: (eb) => eb.ref("excluded.schema_version"),
          revision: (eb) => eb.ref("excluded.revision"),
          payload_json: (eb) => eb.ref("excluded.payload_json"),
          payload_sha256: (eb) => eb.ref("excluded.payload_sha256"),
          updated_at: (eb) => eb.ref("excluded.updated_at"),
        }),
      ),
  );
  executeSqliteQuerySync(
    db,
    kysely.insertInto("pcc_ledger_audit").values({
      id: randomUUID(),
      revision,
      event_kind: eventKind,
      payload_sha256: payloadSha256,
      created_at: updatedAt,
      details_json: null,
    }),
  );
}

type TimestampedReceipt = {
  id: string;
  completedAt?: unknown;
};

type ReceiptTimestampInventory = Map<string, Map<unknown, number>>;

function assertNewOrRetimestampedReceipts(
  previousTimestamps: ReceiptTimestampInventory,
  next: readonly TimestampedReceipt[],
  collection: "receipts" | "modelRunReceipts",
): void {
  for (const receipt of next) {
    const timestampCounts = previousTimestamps.get(receipt.id);
    const unchangedCount = timestampCounts?.get(receipt.completedAt) ?? 0;
    if (unchangedCount > 0) {
      timestampCounts?.set(receipt.completedAt, unchangedCount - 1);
      continue;
    }
    if (!normalizePccTimestamp(receipt.completedAt)) {
      throw new Error(
        `PCC ${collection} record ${receipt.id} must provide a valid completedAt timestamp.`,
      );
    }
  }
}

function receiptTimestampInventory(
  receipts: readonly TimestampedReceipt[],
): ReceiptTimestampInventory {
  const inventory: ReceiptTimestampInventory = new Map();
  for (const receipt of receipts) {
    const timestampCounts = inventory.get(receipt.id) ?? new Map<unknown, number>();
    timestampCounts.set(receipt.completedAt, (timestampCounts.get(receipt.completedAt) ?? 0) + 1);
    inventory.set(receipt.id, timestampCounts);
  }
  return inventory;
}

function assertPccLedgerTimestampMutation(
  previousReceipts: ReceiptTimestampInventory,
  previousModelRuns: ReceiptTimestampInventory,
  next: PccLedger,
): void {
  assertNewOrRetimestampedReceipts(
    previousReceipts,
    next.receipts as unknown as TimestampedReceipt[],
    "receipts",
  );
  assertNewOrRetimestampedReceipts(
    previousModelRuns,
    (next.modelRunReceipts ?? []) as unknown as TimestampedReceipt[],
    "modelRunReceipts",
  );
}

function writeLedgerBackupSync(ledger: PccLedger, revision: number, env: NodeJS.ProcessEnv): void {
  const pathname = pccLedgerBackupPath(env);
  ensurePrivateStoragePath(pathname);
  const payload = JSON.stringify({
    schemaVersion: 1,
    revision,
    savedAt: nowIso(),
    ledger,
  });
  const temporary = `${pathname}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${payload}\n`, { encoding: "utf8", mode: PCC_FILE_MODE });
    privateMode(temporary, PCC_FILE_MODE);
    fs.renameSync(temporary, pathname);
    privateMode(pathname, PCC_FILE_MODE);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The atomic rename already completed, or the temporary file was never created.
    }
  }
}

export function readPccLedgerBackup(
  env: NodeJS.ProcessEnv = process.env,
): { schemaVersion: 1; revision: number; savedAt: string; ledger: PccLedger } | null {
  const pathname = pccLedgerBackupPath(env);
  if (!fs.existsSync(pathname)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(pathname, "utf8")) as {
      schemaVersion?: unknown;
      revision?: unknown;
      savedAt?: unknown;
      ledger?: unknown;
    };
    if (
      raw.schemaVersion !== 1 ||
      typeof raw.revision !== "number" ||
      !Number.isInteger(raw.revision) ||
      typeof raw.savedAt !== "string" ||
      !raw.ledger
    ) {
      throw new Error("invalid backup envelope");
    }
    return {
      schemaVersion: 1,
      revision: raw.revision,
      savedAt: raw.savedAt,
      ledger: assertPccLedger(raw.ledger),
    };
  } catch (error) {
    throw new Error(`PCC last-known-good ledger backup is corrupt: ${pathname}`, { cause: error });
  }
}

function readLegacyLedger(
  env: NodeJS.ProcessEnv,
  options: PccLedgerAssertionOptions = {},
): PccLedger | null {
  const file = pccLedgerJsonPath(env);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return assertPccLedger(JSON.parse(fs.readFileSync(file, "utf8")) as unknown, options);
  } catch (error) {
    throw new Error(`PCC legacy ledger is corrupt: ${file}`, { cause: error });
  }
}

export function detectPccLedgerStorageMigration(
  env: NodeJS.ProcessEnv = process.env,
): PccLedgerStorageMigration {
  const legacyPath = pccLedgerJsonPath(env);
  const sqlitePath = pccLedgerSqlitePath(env);
  const legacyExists = fs.existsSync(legacyPath);
  const sqliteExists = fs.existsSync(sqlitePath);
  return {
    needed: legacyExists && !sqliteExists,
    legacyPath,
    sqlitePath,
    reason: legacyExists && !sqliteExists ? "PCC ledger still uses legacy JSON storage." : null,
  };
}

export function migrateLegacyPccLedgerStorage(
  env: NodeJS.ProcessEnv = process.env,
): PccLedgerStorageMigrationResult {
  const detected = detectPccLedgerStorageMigration(env);
  if (!detected.needed) {
    return {
      migrated: false,
      legacyPath: detected.legacyPath,
      sqlitePath: detected.sqlitePath,
      backupPath: null,
      revision: null,
    };
  }
  const legacy = readLegacyLedger(env);
  if (!legacy) {
    throw new Error(`PCC legacy ledger disappeared before migration: ${detected.legacyPath}`);
  }
  const backupPath = `${detected.legacyPath}.pre-sqlite-${Date.now()}.bak`;
  fs.copyFileSync(detected.legacyPath, backupPath, fs.constants.COPYFILE_EXCL);
  privateMode(backupPath, PCC_FILE_MODE);
  const database = openLedgerDatabase(env);
  const revision = runSqliteImmediateTransactionSync(database.db, () => {
    const existing = selectSnapshot(database.db);
    if (existing) {
      return existing.revision;
    }
    writeSnapshot(database.db, legacy, 1, "legacy_json_import");
    return 1;
  });
  ensurePrivateStoragePath(database.path);
  return {
    migrated: true,
    legacyPath: detected.legacyPath,
    sqlitePath: detected.sqlitePath,
    backupPath,
    revision,
  };
}

export function readPccLedger(env: NodeJS.ProcessEnv = process.env): PccLedger {
  return readPccLedgerSnapshotWithOptions(env).ledger;
}

export type PccLedgerSnapshot = {
  ledger: PccLedger;
  revision: number | null;
};

export function readPccLedgerSnapshot(env: NodeJS.ProcessEnv = process.env): PccLedgerSnapshot {
  return readPccLedgerSnapshotWithOptions(env);
}

function readPccLedgerSnapshotWithOptions(
  env: NodeJS.ProcessEnv,
  options: PccLedgerAssertionOptions = {},
): PccLedgerSnapshot {
  const databasePath = pccLedgerSqlitePath(env);
  if (fs.existsSync(databasePath)) {
    const database = openLedgerDatabase(env);
    const row = selectSnapshot(database.db);
    return {
      ledger: row ? parseSnapshot(row, options) : defaultLedger(),
      revision: row?.revision ?? null,
    };
  }
  return {
    ledger: readLegacyLedger(env, options) ?? defaultLedger(),
    revision: null,
  };
}

/** Read the persisted PCC shape without compatibility normalization for doctor diagnostics. */
export function readPccLedgerUnnormalized(env: NodeJS.ProcessEnv = process.env): PccLedger {
  return readPccLedgerSnapshotWithOptions(env, { normalizeLegacyReceipts: false }).ledger;
}

export function withPccLedger<T>(
  mutator: (ledger: PccLedger) => T,
  options: PccLedgerMutationOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): T {
  if (!options.write) {
    return mutator(readPccLedger(env));
  }
  const migration = detectPccLedgerStorageMigration(env);
  if (migration.needed) {
    throw new Error(
      `PCC ledger uses legacy JSON storage at ${migration.legacyPath}; run openclaw doctor --fix before saving changes.`,
    );
  }
  const database = openLedgerDatabase(env);
  const mutationResult = runSqliteImmediateTransactionSync(database.db, () => {
    const current = selectSnapshot(database.db);
    // Keep legacy receipts raw for writes so read-time compatibility does not
    // silently rewrite persisted history during an unrelated mutation.
    const ledger = current
      ? parseSnapshot(current, { normalizeLegacyReceipts: false })
      : defaultLedger();
    const previousReceipts = receiptTimestampInventory(
      ledger.receipts as unknown as TimestampedReceipt[],
    );
    const previousModelRuns = receiptTimestampInventory(
      (ledger.modelRunReceipts ?? []) as unknown as TimestampedReceipt[],
    );
    if (current) {
      // Preserve the last committed state before applying the next mutation.
      // If the mutation fails, this file remains a usable recovery point.
      writeLedgerBackupSync(ledger, current.revision, env);
    }
    const result = mutator(ledger);
    assertPccLedgerTimestampMutation(previousReceipts, previousModelRuns, ledger);
    writeSnapshot(
      database.db,
      ledger,
      (current?.revision ?? 0) + 1,
      options.auditKind ?? "ledger_mutation",
    );
    return result;
  });
  ensurePrivateStoragePath(database.path);
  return mutationResult;
}

export function pccLedgerRevision(env: NodeJS.ProcessEnv = process.env): number | null {
  const databasePath = pccLedgerSqlitePath(env);
  if (!fs.existsSync(databasePath)) {
    return null;
  }
  return selectSnapshot(openLedgerDatabase(env).db)?.revision ?? null;
}

/** Test-only snapshot seeding for gateway contract tests. */
export function replacePccLedgerForTest(
  ledger: PccLedger,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const database = openLedgerDatabase(env);
  runSqliteImmediateTransactionSync(database.db, () => {
    const revision = (selectSnapshot(database.db)?.revision ?? 0) + 1;
    writeSnapshot(
      database.db,
      assertPccLedger(ledger, { normalizeLegacyReceipts: false }),
      revision,
      "test_seed",
    );
  });
  ensurePrivateStoragePath(database.path);
}

export function closePccLedgerStorageForTest(): void {
  for (const database of cachedDatabases.values()) {
    database.walMaintenance.close();
    if (database.db.isOpen) {
      clearNodeSqliteKyselyCacheForDatabase(database.db);
      database.db.close();
    }
  }
  cachedDatabases.clear();
}

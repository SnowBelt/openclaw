import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpenClawPluginApi } from "../api.js";

const SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_KEY_BYTES = 512;
const DEFAULT_MAX_VALUE_BYTES = 65_536;
const LARGE_MAX_VALUE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/iu;

export type StateEntry<T> = {
  key: string;
  value: T;
  createdAt: number;
  expiresAt?: number;
};

export type KeyedStore<T> = {
  register(key: string, value: T, opts?: { ttlMs?: number }): Promise<void>;
  registerIfAbsent(key: string, value: T, opts?: { ttlMs?: number }): Promise<boolean>;
  lookup(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<StateEntry<T>[]>;
};

export type KeyedStoreOptions = {
  namespace: string;
  maxEntries: number;
  defaultTtlMs?: number;
  largeValues?: boolean;
};

export type ResearchStateStorage = {
  backend: "openclaw-keyed-store" | "plugin-sqlite";
  durable: true;
};

type StoredRow = {
  entry_key: string;
  value_json: string;
  created_at: number | bigint;
  expires_at: number | bigint | null;
};

type CountRow = { count: number | bigint };
type VersionRow = { user_version?: number | bigint };

function normalizeNumber(value: number | bigint | null): number | undefined {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : undefined;
}

function validateNamespace(value: string): string {
  const namespace = value.trim();
  if (!NAMESPACE_PATTERN.test(namespace) || Buffer.byteLength(namespace) > 128) {
    throw new Error(`Research Manager state namespace is invalid: ${value}`);
  }
  return namespace;
}

function validateKey(value: string): string {
  const key = value.trim();
  if (!key || Buffer.byteLength(key) > MAX_KEY_BYTES) {
    throw new Error("Research Manager state key must contain 1-512 bytes.");
  }
  return key;
}

function validateTtl(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Research Manager state TTL must be a positive integer.");
  }
  return value;
}

function assertJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  location = "value",
  depth = 0,
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`Research Manager state ${location} exceeds ${MAX_JSON_DEPTH} levels.`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Research Manager state ${location} must be a finite number.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`Research Manager state ${location} must be JSON-serializable.`);
  }
  if (seen.has(value)) {
    throw new Error(`Research Manager state ${location} must not contain a cycle.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new Error(`Research Manager state ${location} must not contain sparse arrays.`);
        }
        assertJsonValue(value[index], seen, `${location}[${index}]`, depth + 1);
      }
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error(`Research Manager state ${location} must contain plain objects.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`Research Manager state ${location} must not contain symbol keys.`);
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set || !("value" in descriptor)) {
        throw new Error(`Research Manager state ${location}.${key} must be an enumerable value.`);
      }
      assertJsonValue(descriptor.value, seen, `${location}.${key}`, depth + 1);
    }
  } finally {
    seen.delete(value);
  }
}

function encodeValue(value: unknown, maxValueBytes: number): string {
  assertJsonValue(value, new WeakSet<object>());
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new Error("Research Manager state value must be JSON-serializable.", { cause: error });
  }
  if (encoded === undefined) {
    throw new Error("Research Manager state value must be JSON-serializable.");
  }
  if (Buffer.byteLength(encoded) > maxValueBytes) {
    throw new Error(`Research Manager state value exceeds ${maxValueBytes} bytes.`);
  }
  return encoded;
}

function decodeValue(encoded: string): unknown {
  try {
    return JSON.parse(encoded);
  } catch (error) {
    throw new Error("Research Manager state contains corrupt JSON.", { cause: error });
  }
}

function isNativeTrustRestriction(error: unknown): boolean {
  return (
    error instanceof Error &&
    /openKeyedStore is only available for (?:bundled|trusted) plugins/i.test(error.message)
  );
}

class ResearchStateDatabase {
  readonly #database: DatabaseSync;
  readonly #path: string;

  constructor(stateDir: string) {
    const directory = path.join(stateDir, "research-manager");
    this.#path = path.join(directory, "state.sqlite");
    mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    chmodSync(directory, DIRECTORY_MODE);
    this.#database = new DatabaseSync(this.#path);
    try {
      this.#database.exec("PRAGMA journal_mode = WAL;");
      this.#database.exec("PRAGMA synchronous = FULL;");
      this.#database.exec("PRAGMA busy_timeout = 10000;");
      this.#ensureSchema();
      this.#hardenPermissions();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  open<T>(options: KeyedStoreOptions): KeyedStore<T> {
    const namespace = validateNamespace(options.namespace);
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("Research Manager state maxEntries must be an integer of at least 1.");
    }
    const defaultTtlMs = validateTtl(options.defaultTtlMs);
    const maxValueBytes = options.largeValues ? LARGE_MAX_VALUE_BYTES : DEFAULT_MAX_VALUE_BYTES;

    const prepareValue = (key: string, value: T, ttlMs?: number) => {
      const normalizedKey = validateKey(key);
      const encoded = encodeValue(value, maxValueBytes);
      const ttl = validateTtl(ttlMs) ?? defaultTtlMs;
      return { normalizedKey, encoded, ttl };
    };

    return {
      register: async (key, value, opts) => {
        const prepared = prepareValue(key, value, opts?.ttlMs);
        this.#write(() => {
          const now = Date.now();
          this.#pruneExpired(namespace, now);
          this.#database
            .prepare(`
              INSERT INTO keyed_entries (
                namespace, entry_key, value_json, created_at, expires_at
              ) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(namespace, entry_key) DO UPDATE SET
                value_json = excluded.value_json,
                created_at = excluded.created_at,
                expires_at = excluded.expires_at
            `)
            .run(
              namespace,
              prepared.normalizedKey,
              prepared.encoded,
              now,
              prepared.ttl === undefined ? null : now + prepared.ttl,
            );
          this.#enforceLimit(namespace, options.maxEntries, prepared.normalizedKey, now);
        });
      },
      registerIfAbsent: async (key, value, opts) => {
        const prepared = prepareValue(key, value, opts?.ttlMs);
        return this.#write(() => {
          const now = Date.now();
          this.#pruneExpired(namespace, now);
          const result = this.#database
            .prepare(`
              INSERT OR IGNORE INTO keyed_entries (
                namespace, entry_key, value_json, created_at, expires_at
              ) VALUES (?, ?, ?, ?, ?)
            `)
            .run(
              namespace,
              prepared.normalizedKey,
              prepared.encoded,
              now,
              prepared.ttl === undefined ? null : now + prepared.ttl,
            );
          if (Number(result.changes) === 0) {
            return false;
          }
          this.#enforceLimit(namespace, options.maxEntries, prepared.normalizedKey, now);
          return true;
        });
      },
      lookup: async (key) => {
        const row = this.#database
          .prepare(`
            SELECT entry_key, value_json, created_at, expires_at
            FROM keyed_entries
            WHERE namespace = ?
              AND entry_key = ?
              AND (expires_at IS NULL OR expires_at > ?)
          `)
          .get(namespace, validateKey(key), Date.now()) as StoredRow | undefined;
        return row ? (decodeValue(row.value_json) as T) : undefined;
      },
      delete: async (key) => {
        const result = this.#write(() =>
          this.#database
            .prepare("DELETE FROM keyed_entries WHERE namespace = ? AND entry_key = ?")
            .run(namespace, validateKey(key)),
        );
        return Number(result.changes) > 0;
      },
      entries: async () => {
        const rows = this.#database
          .prepare(`
            SELECT entry_key, value_json, created_at, expires_at
            FROM keyed_entries
            WHERE namespace = ?
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY created_at ASC, entry_key ASC
          `)
          .all(namespace, Date.now()) as StoredRow[];
        return rows.map((row) => {
          const expiresAt = normalizeNumber(row.expires_at);
          return Object.assign(
            {
              key: row.entry_key,
              value: decodeValue(row.value_json) as T,
              createdAt: normalizeNumber(row.created_at) ?? 0,
            },
            expiresAt === undefined ? {} : { expiresAt },
          );
        });
      },
    };
  }

  close(): void {
    this.#database.close();
  }

  #ensureSchema(): void {
    const row = this.#database.prepare("PRAGMA user_version").get() as VersionRow | undefined;
    const version = normalizeNumber(row?.user_version ?? null) ?? 0;
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `Research Manager state schema ${version} is newer than supported schema ${SCHEMA_VERSION}.`,
      );
    }
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS keyed_entries (
        namespace  TEXT    NOT NULL,
        entry_key  TEXT    NOT NULL,
        value_json TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (namespace, entry_key)
      );
      CREATE INDEX IF NOT EXISTS keyed_entries_listing
        ON keyed_entries(namespace, created_at, entry_key);
      CREATE INDEX IF NOT EXISTS keyed_entries_expiry
        ON keyed_entries(expires_at)
        WHERE expires_at IS NOT NULL;
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  #write<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.#database.exec("COMMIT;");
      this.#hardenPermissionsBestEffort();
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK;");
      } catch {
        // Preserve the primary state failure.
      }
      throw error;
    }
  }

  #pruneExpired(namespace: string, now: number): void {
    this.#database
      .prepare(
        "DELETE FROM keyed_entries WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .run(namespace, now);
  }

  #enforceLimit(namespace: string, maxEntries: number, protectedKey: string, now: number): void {
    const countRow = this.#database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM keyed_entries
        WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)
      `)
      .get(namespace, now) as CountRow | undefined;
    const count = normalizeNumber(countRow?.count ?? null) ?? 0;
    if (count <= maxEntries) {
      return;
    }
    this.#database
      .prepare(`
        DELETE FROM keyed_entries
        WHERE rowid IN (
          SELECT rowid
          FROM keyed_entries
          WHERE namespace = ?
            AND entry_key <> ?
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY created_at ASC, entry_key ASC
          LIMIT ?
        )
      `)
      .run(namespace, protectedKey, now, count - maxEntries);
  }

  #hardenPermissions(): void {
    for (const suffix of ["", "-shm", "-wal"]) {
      const candidate = `${this.#path}${suffix}`;
      if (existsSync(candidate)) {
        chmodSync(candidate, FILE_MODE);
      }
    }
  }

  #hardenPermissionsBestEffort(): void {
    try {
      this.#hardenPermissions();
    } catch {
      // The transaction is already durable; permission repair can retry on the next write.
    }
  }
}

export function createResearchStateStores(api: OpenClawPluginApi): {
  open: <T>(options: KeyedStoreOptions) => KeyedStore<T>;
  storage: () => ResearchStateStorage;
  close: () => void;
} {
  let fallback: ResearchStateDatabase | undefined;
  let storage: ResearchStateStorage = { backend: "openclaw-keyed-store", durable: true };
  const openFallback = (reason: string): ResearchStateDatabase => {
    if (!fallback) {
      fallback = new ResearchStateDatabase(api.runtime.state.resolveStateDir());
      storage = { backend: "plugin-sqlite", durable: true };
      api.logger.warn(reason);
    }
    return fallback;
  };
  return {
    open<T>(options: KeyedStoreOptions): KeyedStore<T> {
      if (fallback) {
        return fallback.open<T>(options);
      }
      if (options.largeValues) {
        return openFallback(
          "research-manager: using durable plugin SQLite state for bounded large evidence records",
        ).open<T>(options);
      }
      try {
        const { largeValues: _largeValues, ...nativeOptions } = options;
        return api.runtime.state.openKeyedStore<T>(nativeOptions);
      } catch (error) {
        if (!isNativeTrustRestriction(error)) {
          throw error;
        }
        return openFallback(
          "research-manager: native keyed state is trust-restricted; using durable plugin SQLite state under the OpenClaw state directory",
        ).open<T>(options);
      }
    },
    storage: () => storage,
    close: () => fallback?.close(),
  };
}

// Operations incident history is stored in a dedicated, bounded SQLite ledger.
// Only compact, sanitized display metadata is persisted; prompts, task bodies,
// errors, and finding details never cross this boundary.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveStateDir } from "../config/paths.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { sanitizeTaskStatusText } from "../tasks/task-status.js";
import type {
  OperationsFinding,
  OperationsFindingDisposition,
  OperationsFindingResponseState,
  OperationsIncidentHistoryEntry,
  OperationsIncidentTransition,
  OperationsSeverity,
} from "./types.js";

const LEDGER_DIRECTORY = "operations";
const LEDGER_FILENAME = "incident-ledger.sqlite";
const LEDGER_SCHEMA_VERSION = 2;
export const OPERATIONS_INCIDENT_MAX_ENTRIES = 500;
export const OPERATIONS_INCIDENT_MAX_TRANSITIONS = 20;
export const OPERATIONS_INCIDENT_HISTORY_LIMIT = 200;
export const OPERATIONS_INCIDENT_RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const OPERATIONS_INCIDENT_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type StoredIncidentRow = {
  incident_id: string;
  title: string;
  category: OperationsFinding["category"];
  severity: OperationsSeverity;
  disposition: OperationsFindingDisposition;
  response_state: OperationsFindingResponseState;
  first_observed_at: number;
  last_observed_at: number;
  resolved_at: number | null;
  transitions_json: string;
};

type StoredIncidentTombstoneRow = {
  incident_id: string;
  category: OperationsFinding["category"];
  expired_at: number;
  last_suppressed_at: number;
};

type OperationsIncidentDatabase = {
  operations_incidents: StoredIncidentRow;
  operations_incident_tombstones: StoredIncidentTombstoneRow;
};

export type OperationsIncidentLedgerOptions = {
  ledgerPath?: string;
  stateDir?: string;
  maxEntries?: number;
  resolvedRetentionMs?: number;
};

export type OperationsIncidentRecurrence = {
  incidentId: string;
  reopenedAt: number;
};

export type OperationsIncidentLedgerResult = {
  findings: OperationsFinding[];
  suppressedFindingIds: string[];
  carriedFindings: OperationsFinding[];
  recurrences: OperationsIncidentRecurrence[];
  history: OperationsIncidentHistoryEntry[];
  historyTotal: number;
  overflowCount: number;
};

const cachedLedgers = new Map<string, DatabaseSync>();

export function resolveOperationsIncidentLedgerPath(stateDir = resolveStateDir()): string {
  return path.join(stateDir, LEDGER_DIRECTORY, LEDGER_FILENAME);
}

function resolveLedgerPath(options: OperationsIncidentLedgerOptions): string {
  return path.resolve(options.ledgerPath ?? resolveOperationsIncidentLedgerPath(options.stateDir));
}

function openLedger(options: OperationsIncidentLedgerOptions): DatabaseSync {
  const ledgerPath = resolveLedgerPath(options);
  const cached = cachedLedgers.get(ledgerPath);
  if (cached?.isOpen) {
    return cached;
  }
  if (cached) {
    clearNodeSqliteKyselyCacheForDatabase(cached);
    cachedLedgers.delete(ledgerPath);
  }
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const sqlite = requireNodeSqlite();
  const database = new sqlite.DatabaseSync(ledgerPath);
  try {
    // sqlite-allow-raw -- connection PRAGMAs and DDL belong at this lifecycle boundary.
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS operations_incidents (
        incident_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        disposition TEXT NOT NULL,
        response_state TEXT NOT NULL,
        first_observed_at INTEGER NOT NULL,
        last_observed_at INTEGER NOT NULL,
        resolved_at INTEGER,
        transitions_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operations_incidents_last_observed
        ON operations_incidents (last_observed_at DESC, incident_id ASC);
      CREATE INDEX IF NOT EXISTS operations_incidents_resolved
        ON operations_incidents (resolved_at ASC, last_observed_at ASC);
      CREATE TABLE IF NOT EXISTS operations_incident_tombstones (
        incident_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        expired_at INTEGER NOT NULL,
        last_suppressed_at INTEGER NOT NULL
      ) WITHOUT ROWID;
      PRAGMA user_version = ${LEDGER_SCHEMA_VERSION};
    `);
    try {
      fs.chmodSync(ledgerPath, 0o600);
    } catch {
      // Some mounted filesystems do not support chmod; SQLite durability remains intact.
    }
    cachedLedgers.set(ledgerPath, database);
    return database;
  } catch (error) {
    clearNodeSqliteKyselyCacheForDatabase(database);
    if (database.isOpen) {
      database.close();
    }
    throw error;
  }
}

function ledgerKysely(database: DatabaseSync) {
  return getNodeSqliteKysely<OperationsIncidentDatabase>(database);
}

function isSeverity(value: unknown): value is OperationsSeverity {
  return value === "info" || value === "warning" || value === "critical";
}

const FINDING_CATEGORIES = new Set<OperationsFinding["category"]>([
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
const FINDING_DISPOSITIONS = new Set<OperationsFindingDisposition>([
  "needs_user",
  "handling",
  "watching",
  "historical",
]);
const FINDING_RESPONSE_STATES = new Set<OperationsFindingResponseState>([
  "unassigned",
  "in_progress",
  "monitoring",
  "waiting_for_user",
  "resolved",
]);

function isFindingCategory(value: unknown): value is OperationsFinding["category"] {
  return (
    typeof value === "string" && FINDING_CATEGORIES.has(value as OperationsFinding["category"])
  );
}

function isFindingDisposition(value: unknown): value is OperationsFindingDisposition {
  return (
    typeof value === "string" && FINDING_DISPOSITIONS.has(value as OperationsFindingDisposition)
  );
}

function isFindingResponseState(value: unknown): value is OperationsFindingResponseState {
  return (
    typeof value === "string" &&
    FINDING_RESPONSE_STATES.has(value as OperationsFindingResponseState)
  );
}

function parseTransitions(raw: string, fallback: OperationsSeverity, at: number) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [{ at, to: fallback }] satisfies OperationsIncidentTransition[];
    }
    const valid = parsed.flatMap((entry): OperationsIncidentTransition[] => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const candidate = entry as { at?: unknown; from?: unknown; to?: unknown };
      if (typeof candidate.at !== "number" || !isSeverity(candidate.to)) {
        return [];
      }
      return [
        {
          at: Math.max(0, Math.floor(candidate.at)),
          ...(isSeverity(candidate.from) ? { from: candidate.from } : {}),
          to: candidate.to,
        },
      ];
    });
    return valid.length > 0
      ? valid.slice(-OPERATIONS_INCIDENT_MAX_TRANSITIONS)
      : ([{ at, to: fallback }] satisfies OperationsIncidentTransition[]);
  } catch {
    return [{ at, to: fallback }] satisfies OperationsIncidentTransition[];
  }
}

function boundIncidentTransitions(
  transitions: readonly OperationsIncidentTransition[],
): OperationsIncidentTransition[] {
  const bounded = transitions.slice(-OPERATIONS_INCIDENT_MAX_TRANSITIONS);
  const latestReopenIndex = transitions.findLastIndex(
    (transition) => transition.from !== undefined && transition.from === transition.to,
  );
  if (
    latestReopenIndex < 0 ||
    latestReopenIndex >= transitions.length - OPERATIONS_INCIDENT_MAX_TRANSITIONS
  ) {
    return bounded;
  }
  return [
    transitions[latestReopenIndex]!,
    ...transitions.slice(-(OPERATIONS_INCIDENT_MAX_TRANSITIONS - 1)),
  ];
}

function compactTitle(value: unknown): string {
  return sanitizeTaskStatusText(value, { maxChars: 120 }) || "Operations incident";
}

function readRows(database: DatabaseSync): StoredIncidentRow[] {
  return executeSqliteQuerySync(
    database,
    ledgerKysely(database)
      .selectFrom("operations_incidents")
      .selectAll()
      .orderBy("last_observed_at", "desc")
      .orderBy("incident_id", "asc"),
  ).rows;
}

function capIncidentHistoryRows(
  rows: readonly StoredIncidentRow[],
  max: number,
): StoredIncidentRow[] {
  if (rows.length <= max) {
    return [...rows];
  }
  const active = rows.filter((row) => row.resolved_at === null);
  const resolved = rows.filter((row) => row.resolved_at !== null);
  const reserved = Math.floor(max / 2);
  const selected = [...active.slice(0, reserved), ...resolved.slice(0, reserved)];
  const selectedIds = new Set(selected.map((row) => row.incident_id));
  const remainder = rows.filter((row) => !selectedIds.has(row.incident_id));
  return [...selected, ...remainder.slice(0, max - selected.length)].toSorted(
    (left, right) =>
      right.last_observed_at - left.last_observed_at ||
      left.incident_id.localeCompare(right.incident_id),
  );
}

function readTombstoneRows(database: DatabaseSync): StoredIncidentTombstoneRow[] {
  return executeSqliteQuerySync(
    database,
    ledgerKysely(database)
      .selectFrom("operations_incident_tombstones")
      .selectAll()
      .orderBy("expired_at", "desc")
      .orderBy("incident_id", "asc"),
  ).rows;
}

function historyFromRow(row: StoredIncidentRow): OperationsIncidentHistoryEntry {
  const transitions = parseTransitions(
    row.transitions_json,
    isSeverity(row.severity) ? row.severity : "warning",
    row.first_observed_at,
  );
  return {
    id: row.incident_id,
    title: compactTitle(row.title),
    category: isFindingCategory(row.category) ? row.category : "resource",
    severity: isSeverity(row.severity) ? row.severity : "warning",
    disposition: isFindingDisposition(row.disposition) ? row.disposition : "historical",
    responseState: isFindingResponseState(row.response_state) ? row.response_state : "resolved",
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
    transitions,
  };
}

function carriedFindingFromRow(row: StoredIncidentRow): OperationsFinding {
  const history = historyFromRow(row);
  return {
    id: history.id,
    severity: history.severity,
    category: history.category,
    title: history.title,
    detail: "This incident was unresolved when its source became unavailable.",
    firstObservedAt: history.firstObservedAt,
    lastObservedAt: history.lastObservedAt,
    disposition: history.disposition === "historical" ? "watching" : history.disposition,
    responseState: history.responseState === "resolved" ? "monitoring" : history.responseState,
    impact:
      "The last known issue may still affect operations, but its current state is unverified.",
    recommendedAction: "Restore the source and verify whether the incident is still active.",
    nextAction: "Restore source visibility before resolving or dismissing this incident.",
  };
}

function upsertRow(database: DatabaseSync, row: StoredIncidentRow): void {
  const kysely = ledgerKysely(database);
  executeSqliteQuerySync(
    database,
    kysely
      .insertInto("operations_incidents")
      .values(row)
      .onConflict((conflict) =>
        conflict.column("incident_id").doUpdateSet({
          title: (eb) => eb.ref("excluded.title"),
          category: (eb) => eb.ref("excluded.category"),
          severity: (eb) => eb.ref("excluded.severity"),
          disposition: (eb) => eb.ref("excluded.disposition"),
          response_state: (eb) => eb.ref("excluded.response_state"),
          first_observed_at: (eb) => eb.ref("excluded.first_observed_at"),
          last_observed_at: (eb) => eb.ref("excluded.last_observed_at"),
          resolved_at: (eb) => eb.ref("excluded.resolved_at"),
          transitions_json: (eb) => eb.ref("excluded.transitions_json"),
        }),
      ),
  );
}

function deleteRow(database: DatabaseSync, id: string): void {
  executeSqliteQuerySync(
    database,
    ledgerKysely(database).deleteFrom("operations_incidents").where("incident_id", "=", id),
  );
}

function upsertTombstone(database: DatabaseSync, row: StoredIncidentTombstoneRow): void {
  const kysely = ledgerKysely(database);
  executeSqliteQuerySync(
    database,
    kysely
      .insertInto("operations_incident_tombstones")
      .values(row)
      .onConflict((conflict) =>
        conflict.column("incident_id").doUpdateSet({
          category: (eb) => eb.ref("excluded.category"),
          expired_at: (eb) => eb.ref("excluded.expired_at"),
          last_suppressed_at: (eb) => eb.ref("excluded.last_suppressed_at"),
        }),
      ),
  );
}

function deleteTombstone(database: DatabaseSync, id: string): void {
  executeSqliteQuerySync(
    database,
    ledgerKysely(database)
      .deleteFrom("operations_incident_tombstones")
      .where("incident_id", "=", id),
  );
}

const SEVERITY_RETENTION_RANK: Record<OperationsSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function compareIncidentRetentionPriority(
  left: StoredIncidentRow,
  right: StoredIncidentRow,
  currentRank: ReadonlyMap<string, number>,
): number {
  const leftActive = left.resolved_at === null;
  const rightActive = right.resolved_at === null;
  if (leftActive !== rightActive) {
    return Number(rightActive) - Number(leftActive);
  }

  if (!leftActive && !rightActive) {
    return (
      (right.resolved_at ?? 0) - (left.resolved_at ?? 0) ||
      right.last_observed_at - left.last_observed_at ||
      left.incident_id.localeCompare(right.incident_id)
    );
  }

  const severityOrder =
    SEVERITY_RETENTION_RANK[right.severity] - SEVERITY_RETENTION_RANK[left.severity];
  if (severityOrder !== 0) {
    return severityOrder;
  }
  const leftCurrentRank = currentRank.get(left.incident_id);
  const rightCurrentRank = currentRank.get(right.incident_id);
  const leftCurrent = leftCurrentRank !== undefined;
  const rightCurrent = rightCurrentRank !== undefined;
  if (leftCurrent !== rightCurrent) {
    return Number(rightCurrent) - Number(leftCurrent);
  }
  if (leftCurrentRank !== undefined && rightCurrentRank !== undefined) {
    const rankOrder = leftCurrentRank - rightCurrentRank;
    if (rankOrder !== 0) {
      return rankOrder;
    }
  }
  return (
    right.last_observed_at - left.last_observed_at ||
    left.incident_id.localeCompare(right.incident_id)
  );
}

export function reconcileOperationsIncidentLedger(params: {
  findings: readonly OperationsFinding[];
  now: number;
  options?: OperationsIncidentLedgerOptions;
  authoritativeCategories?: readonly OperationsFinding["category"][];
}): OperationsIncidentLedgerResult {
  const options = params.options ?? {};
  const database = openLedger(options);
  const maxEntries = Math.max(1, options.maxEntries ?? OPERATIONS_INCIDENT_MAX_ENTRIES);
  const retentionMs = Math.max(
    0,
    options.resolvedRetentionMs ?? OPERATIONS_INCIDENT_RESOLVED_RETENTION_MS,
  );
  let processedFindings: OperationsFinding[] = [];
  let overflowCount = 0;
  let retainedIncidentIds = new Set<string>();
  let observedIncidentIds = new Set<string>();
  const suppressedFindingIds = new Set<string>();
  const stampedById = new Map<string, OperationsFinding>();
  const reopenedAtById = new Map<string, number>();
  const authoritativeCategories = new Set(
    params.authoritativeCategories ?? [...FINDING_CATEGORIES],
  );

  runSqliteImmediateTransactionSync(database, () => {
    const existingRows = readRows(database);
    const existingById = new Map(existingRows.map((row) => [row.incident_id, row]));
    const tombstonesById = new Map(
      readTombstoneRows(database).map((row) => [row.incident_id, row]),
    );
    const acceptedFindings: OperationsFinding[] = [];
    const currentFindingIds = new Set(params.findings.map((finding) => finding.id));
    for (const finding of params.findings) {
      const tombstone = tombstonesById.get(finding.id);
      if (tombstone && finding.disposition === "historical") {
        suppressedFindingIds.add(finding.id);
        upsertTombstone(database, {
          ...tombstone,
          category: finding.category,
          last_suppressed_at: params.now,
        });
        continue;
      }
      if (tombstone) {
        deleteTombstone(database, finding.id);
        tombstonesById.delete(finding.id);
      }
      acceptedFindings.push(finding);
    }
    observedIncidentIds = new Set(acceptedFindings.map((finding) => finding.id));
    const processedIds = new Set<string>();
    processedFindings = acceptedFindings.filter((finding, index) => {
      if (processedIds.has(finding.id) || (index >= maxEntries && !existingById.has(finding.id))) {
        return false;
      }
      processedIds.add(finding.id);
      return true;
    });
    const currentIds = new Set(acceptedFindings.map((finding) => finding.id));
    const currentRank = new Map<string, number>();
    for (const [index, finding] of acceptedFindings.entries()) {
      if (!currentRank.has(finding.id)) {
        currentRank.set(finding.id, index);
      }
    }

    for (const finding of processedFindings) {
      const previous = existingById.get(finding.id);
      const firstObservedAt = previous?.first_observed_at ?? params.now;
      const previousSeverity = previous && isSeverity(previous.severity) ? previous.severity : null;
      const transitions = previous
        ? parseTransitions(
            previous.transitions_json,
            previousSeverity ?? finding.severity,
            firstObservedAt,
          )
        : ([{ at: params.now, to: finding.severity }] satisfies OperationsIncidentTransition[]);
      const reopened = previous?.resolved_at != null && finding.disposition !== "historical";
      if (reopened) {
        // The additive transition shape stays wire-compatible: from === to is
        // durable lifecycle evidence that the same-severity incident reopened.
        const reopenedFrom = previousSeverity ?? finding.severity;
        transitions.push({
          at: params.now,
          from: reopenedFrom,
          to: reopenedFrom,
        });
        if (reopenedFrom !== finding.severity) {
          transitions.push({ at: params.now, from: reopenedFrom, to: finding.severity });
        }
        reopenedAtById.set(finding.id, params.now);
      } else if (previousSeverity && previousSeverity !== finding.severity) {
        transitions.push({ at: params.now, from: previousSeverity, to: finding.severity });
      }
      const resolvedAt =
        finding.disposition === "historical" ? (previous?.resolved_at ?? params.now) : null;
      const row: StoredIncidentRow = {
        incident_id: finding.id,
        title: compactTitle(finding.title),
        category: finding.category,
        severity: finding.severity,
        disposition: finding.disposition,
        response_state: finding.responseState,
        first_observed_at: firstObservedAt,
        last_observed_at: params.now,
        resolved_at: resolvedAt,
        transitions_json: JSON.stringify(boundIncidentTransitions(transitions)),
      };
      upsertRow(database, row);
      const stamped: OperationsFinding = {
        ...finding,
        firstObservedAt,
        lastObservedAt: params.now,
      };
      delete stamped.resolvedAt;
      if (resolvedAt !== null) {
        stamped.resolvedAt = resolvedAt;
      }
      stampedById.set(finding.id, stamped);
    }

    for (const previous of existingRows) {
      if (
        currentIds.has(previous.incident_id) ||
        previous.resolved_at !== null ||
        !authoritativeCategories.has(previous.category)
      ) {
        continue;
      }
      upsertRow(database, {
        ...previous,
        disposition: "historical",
        response_state: "resolved",
        resolved_at: params.now,
      });
    }

    const resolvedCutoff = params.now - retentionMs;
    for (const row of readRows(database)) {
      if (row.resolved_at !== null && row.resolved_at < resolvedCutoff) {
        if (currentFindingIds.has(row.incident_id)) {
          suppressedFindingIds.add(row.incident_id);
        }
        upsertTombstone(database, {
          incident_id: row.incident_id,
          category: row.category,
          expired_at: params.now,
          last_suppressed_at: params.now,
        });
        deleteRow(database, row.incident_id);
      }
    }

    const tombstoneCutoff = params.now - OPERATIONS_INCIDENT_TOMBSTONE_RETENTION_MS;
    for (const tombstone of readTombstoneRows(database)) {
      // Never prune a tombstone while its historical source row is still present.
      if (currentFindingIds.has(tombstone.incident_id)) {
        continue;
      }
      if (
        authoritativeCategories.has(tombstone.category) ||
        tombstone.last_suppressed_at < tombstoneCutoff
      ) {
        deleteTombstone(database, tombstone.incident_id);
      }
    }

    const remaining = readRows(database).toSorted((left, right) =>
      compareIncidentRetentionPriority(left, right, currentRank),
    );
    retainedIncidentIds = new Set(remaining.slice(0, maxEntries).map((row) => row.incident_id));
    const pruned = remaining.slice(maxEntries);
    const capacityCandidateIds = new Set([
      ...remaining.map((row) => row.incident_id),
      ...acceptedFindings
        .filter((finding) => !suppressedFindingIds.has(finding.id))
        .map((finding) => finding.id),
    ]);
    overflowCount = [...capacityCandidateIds].filter((id) => !retainedIncidentIds.has(id)).length;
    for (const row of pruned) {
      if (row.resolved_at !== null) {
        upsertTombstone(database, {
          incident_id: row.incident_id,
          category: row.category,
          expired_at: params.now,
          last_suppressed_at: params.now,
        });
      }
      deleteRow(database, row.incident_id);
    }
  });

  const historyRows = readRows(database);
  const history = capIncidentHistoryRows(historyRows, OPERATIONS_INCIDENT_HISTORY_LIMIT).map(
    historyFromRow,
  );
  const carriedFindings = historyRows
    .filter(
      (row) =>
        row.resolved_at === null &&
        !observedIncidentIds.has(row.incident_id) &&
        !authoritativeCategories.has(row.category),
    )
    .map(carriedFindingFromRow);
  return {
    findings: processedFindings.flatMap((finding) => {
      if (!retainedIncidentIds.has(finding.id)) {
        return [];
      }
      const stamped = stampedById.get(finding.id);
      return stamped ? [stamped] : [];
    }),
    suppressedFindingIds: [...suppressedFindingIds].toSorted(),
    carriedFindings,
    recurrences: [...reopenedAtById].flatMap(([incidentId, reopenedAt]) =>
      retainedIncidentIds.has(incidentId) ? [{ incidentId, reopenedAt }] : [],
    ),
    history,
    historyTotal: historyRows.length,
    overflowCount,
  };
}

/** Close cached SQLite handles so restart persistence can be tested deterministically. */
export function closeOperationsIncidentLedgerForTests(ledgerPath?: string): void {
  const target = ledgerPath ? path.resolve(ledgerPath) : undefined;
  for (const [pathname, database] of cachedLedgers) {
    if (target && pathname !== target) {
      continue;
    }
    clearNodeSqliteKyselyCacheForDatabase(database);
    if (database.isOpen) {
      database.close();
    }
    cachedLedgers.delete(pathname);
  }
}

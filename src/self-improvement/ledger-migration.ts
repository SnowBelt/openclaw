import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  listSelfImprovementLedgerRows,
  readSelfImprovementLedgerMetadata,
  replaceSelfImprovementLedgerRows,
  resolveSelfImprovementLedgerPath,
  stableSelfImprovementLedgerJson,
  writeSelfImprovementLedgerMetadata,
  type SelfImprovementLedgerCollection,
} from "./ledger.js";

const STORE_DIRECTORY = "self-improvement";
const MIGRATION_METADATA_KEY = "json_to_sqlite_migration";

const COLLECTIONS = [
  { collection: "recommendations", filename: "recommendations.json", property: "recommendations" },
  { collection: "proposals", filename: "proposals.json", property: "proposals" },
  { collection: "audit_events", filename: "audit-events.json", property: "events" },
  { collection: "scorecards", filename: "scorecards.json", property: "scorecards" },
  { collection: "health_snapshots", filename: "health-snapshots.json", property: "snapshots" },
] as const satisfies readonly {
  collection: SelfImprovementLedgerCollection;
  filename: string;
  property: string;
}[];

type MigrationEntry = {
  id: string;
  createdAt: number;
  updatedAt: number;
  value: Record<string, unknown>;
  payloadHash: string;
};

export async function isSelfImprovementJsonToSqliteMigrationApplied(params?: {
  stateDir?: string;
  ledgerPath?: string;
}): Promise<boolean> {
  const stateDir = params?.stateDir ?? resolveStateDir();
  const ledgerPath = params?.ledgerPath ?? resolveSelfImprovementLedgerPath(stateDir);
  return Boolean(
    await readSelfImprovementLedgerMetadata({
      ledgerPath,
      key: MIGRATION_METADATA_KEY,
    }),
  );
}

export type SelfImprovementJsonToSqliteMigrationCollectionReport = {
  collection: SelfImprovementLedgerCollection;
  sourcePath: string;
  sourceExists: boolean;
  sourceSha256?: string;
  count: number;
  ids: string[];
  payloadHashes: Record<string, string>;
  backupPath?: string;
};

export type SelfImprovementJsonToSqliteMigrationReport = {
  migration: "self-improvement-json-to-sqlite-v1";
  stateDir: string;
  ledgerPath: string;
  dryRun: boolean;
  applied: boolean;
  createdAt: number;
  collections: SelfImprovementJsonToSqliteMigrationCollectionReport[];
  parity: { idsMatch: boolean; payloadHashesMatch: boolean; statusesPreserved: boolean };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

async function sha256(value: string): Promise<string> {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readLegacyCollection(params: {
  stateDir: string;
  collection: (typeof COLLECTIONS)[number];
  now: number;
}): Promise<{
  report: SelfImprovementJsonToSqliteMigrationCollectionReport;
  entries: MigrationEntry[];
}> {
  const sourcePath = path.join(params.stateDir, STORE_DIRECTORY, params.collection.filename);
  let raw: string;
  try {
    raw = await fs.readFile(sourcePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        report: {
          collection: params.collection.collection,
          sourcePath,
          sourceExists: false,
          count: 0,
          ids: [],
          payloadHashes: {},
        },
        entries: [],
      };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  const collectionValue = isRecord(parsed) ? parsed[params.collection.property] : undefined;
  const values: unknown[] = Array.isArray(collectionValue) ? collectionValue : [];
  const entries = await Promise.all(
    values.flatMap(async (value: unknown): Promise<MigrationEntry[]> => {
      if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
        return [];
      }
      const normalized = structuredClone(value);
      const payloadJson = stableSelfImprovementLedgerJson(normalized);
      return [
        {
          id: value.id.trim(),
          createdAt: timestamp(value.createdAt, params.now),
          updatedAt: timestamp(value.updatedAt, timestamp(value.createdAt, params.now)),
          value: normalized,
          payloadHash: await sha256(payloadJson),
        },
      ];
    }),
  );
  const flattened: MigrationEntry[] = entries.flat();
  const uniqueIds = new Set(flattened.map((entry) => entry.id));
  if (uniqueIds.size !== flattened.length) {
    throw new Error(`Legacy ${params.collection.filename} contains duplicate record ids.`);
  }
  return {
    report: {
      collection: params.collection.collection,
      sourcePath,
      sourceExists: true,
      sourceSha256: await sha256(raw),
      count: flattened.length,
      ids: flattened.map((entry) => entry.id).toSorted(),
      payloadHashes: Object.fromEntries(
        flattened
          .map((entry) => [entry.id, entry.payloadHash])
          .toSorted(([left], [right]) => left.localeCompare(right)),
      ),
    },
    entries: flattened,
  };
}

function sameStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameHashRecords(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).toSorted(([first], [second]) =>
    first.localeCompare(second),
  );
  const rightEntries = Object.entries(right).toSorted(([first], [second]) =>
    first.localeCompare(second),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([id, hash], index) => id === rightEntries[index]?.[0] && hash === rightEntries[index]?.[1],
    )
  );
}

export async function runSelfImprovementJsonToSqliteMigration(params?: {
  stateDir?: string;
  ledgerPath?: string;
  backupDirectory?: string;
  apply?: boolean;
  now?: number;
}): Promise<SelfImprovementJsonToSqliteMigrationReport> {
  const stateDir = params?.stateDir ?? resolveStateDir();
  const ledgerPath = params?.ledgerPath ?? resolveSelfImprovementLedgerPath(stateDir);
  const now = params?.now ?? Date.now();
  const source = await Promise.all(
    COLLECTIONS.map((collection) => readLegacyCollection({ stateDir, collection, now })),
  );
  const reports = source.map((entry) => entry.report);
  if (!params?.apply) {
    return {
      migration: "self-improvement-json-to-sqlite-v1",
      stateDir,
      ledgerPath,
      dryRun: true,
      applied: false,
      createdAt: now,
      collections: reports,
      parity: { idsMatch: true, payloadHashesMatch: true, statusesPreserved: true },
    };
  }
  if (!params.backupDirectory?.trim()) {
    throw new Error(
      "Applying the self-improvement SQLite migration requires a dated backupDirectory.",
    );
  }
  if (await readSelfImprovementLedgerMetadata({ ledgerPath, key: MIGRATION_METADATA_KEY })) {
    throw new Error("Self-improvement JSON-to-SQLite migration was already applied.");
  }
  await fs.mkdir(params.backupDirectory, { recursive: true, mode: 0o700 });
  for (const report of reports) {
    if (!report.sourceExists) {
      continue;
    }
    const backupPath = path.join(params.backupDirectory, path.basename(report.sourcePath));
    await fs.copyFile(report.sourcePath, backupPath);
    report.backupPath = backupPath;
  }
  for (const [index, definition] of COLLECTIONS.entries()) {
    const entries = source[index]?.entries ?? [];
    await replaceSelfImprovementLedgerRows({
      ledgerPath,
      collection: definition.collection,
      rows: entries.map((entry) => entry.value),
      id: (entry) => (typeof entry.id === "string" ? entry.id : ""),
      createdAt: (entry) => (typeof entry.createdAt === "number" ? entry.createdAt : undefined),
      updatedAt: (entry) => (typeof entry.updatedAt === "number" ? entry.updatedAt : undefined),
      now,
    });
  }
  let idsMatch = true;
  let payloadHashesMatch = true;
  for (const report of reports) {
    const imported = await listSelfImprovementLedgerRows<Record<string, unknown>>({
      ledgerPath,
      collection: report.collection,
    });
    const importedIds = imported.map((entry) => entry.id).toSorted();
    const importedHashes = Object.fromEntries(
      imported
        .map((entry) => [entry.id, entry.payloadHash])
        .toSorted(([left], [right]) => left.localeCompare(right)),
    );
    idsMatch &&= sameStringArrays(report.ids, importedIds);
    payloadHashesMatch &&= sameHashRecords(report.payloadHashes, importedHashes);
  }
  const parity = {
    idsMatch,
    payloadHashesMatch,
    statusesPreserved: idsMatch && payloadHashesMatch,
  };
  if (!parity.statusesPreserved) {
    throw new Error("Self-improvement SQLite migration parity verification failed.");
  }
  await writeSelfImprovementLedgerMetadata({
    ledgerPath,
    key: MIGRATION_METADATA_KEY,
    value: {
      migration: "self-improvement-json-to-sqlite-v1",
      appliedAt: now,
      sourceFiles: reports.map((report) => ({
        collection: report.collection,
        sourceSha256: report.sourceSha256,
        backupPath: report.backupPath,
      })),
    },
    now,
  });
  return {
    migration: "self-improvement-json-to-sqlite-v1",
    stateDir,
    ledgerPath,
    dryRun: false,
    applied: true,
    createdAt: now,
    collections: reports,
    parity,
  };
}

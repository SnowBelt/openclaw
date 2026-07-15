import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  withSelfImprovementStoreMutation,
  writeSelfImprovementJsonAtomically,
} from "./json-store.js";
import { isSelfImprovementJsonToSqliteMigrationApplied } from "./ledger-migration.js";
import { listSelfImprovementLedgerRows, replaceSelfImprovementLedgerRows } from "./ledger.js";
import type {
  SelfImprovementDailyScorecard,
  SelfImprovementDailyScorecardStoreFile,
  SelfImprovementScorecard,
} from "./types.js";

const STORE_VERSION = 1;
const STORE_DIR = "self-improvement";
const STORE_FILENAME = "scorecards.json";
const MAX_SCORECARDS = 400;

function cloneScorecard(scorecard: SelfImprovementDailyScorecard): SelfImprovementDailyScorecard {
  return structuredClone(scorecard);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function dateKeyForTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseScorecard(value: unknown): SelfImprovementDailyScorecard | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.dateKey !== "string") {
    return null;
  }
  return value as SelfImprovementDailyScorecard;
}

function normalizeStore(value: unknown): SelfImprovementDailyScorecardStoreFile {
  if (!isRecord(value) || !Array.isArray(value.scorecards)) {
    return { version: STORE_VERSION, scorecards: [] };
  }
  return {
    version: STORE_VERSION,
    scorecards: value.scorecards
      .map(parseScorecard)
      .filter((entry): entry is SelfImprovementDailyScorecard => Boolean(entry)),
  };
}

async function readStore(
  storePath: string,
  stateDir?: string,
): Promise<SelfImprovementDailyScorecardStoreFile> {
  if (stateDir && (await isSelfImprovementJsonToSqliteMigrationApplied({ stateDir }))) {
    const rows = await listSelfImprovementLedgerRows<SelfImprovementDailyScorecard>({
      collection: "scorecards",
      stateDir,
    });
    return {
      version: STORE_VERSION,
      scorecards: rows
        .map((row) => parseScorecard(row.value))
        .filter((entry): entry is SelfImprovementDailyScorecard => Boolean(entry)),
    };
  }
  try {
    return normalizeStore(JSON.parse(await fs.readFile(storePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: STORE_VERSION, scorecards: [] };
    }
    throw error;
  }
}

async function writeStore(
  storePath: string,
  file: SelfImprovementDailyScorecardStoreFile,
  stateDir?: string,
): Promise<void> {
  if (stateDir && (await isSelfImprovementJsonToSqliteMigrationApplied({ stateDir }))) {
    await replaceSelfImprovementLedgerRows({
      collection: "scorecards",
      stateDir,
      rows: file.scorecards,
      id: (scorecard) => scorecard.id,
      createdAt: (scorecard) => scorecard.createdAt,
      updatedAt: (scorecard) => scorecard.createdAt,
    });
    return;
  }
  await writeSelfImprovementJsonAtomically(storePath, file);
}

export function resolveSelfImprovementScorecardStorePath(stateDir = resolveStateDir()): string {
  return path.join(stateDir, STORE_DIR, STORE_FILENAME);
}

export async function writeSelfImprovementDailyScorecardSnapshot(params: {
  scorecard: SelfImprovementScorecard;
  stateDir?: string;
  storePath?: string;
  now?: number;
}): Promise<SelfImprovementDailyScorecard> {
  const now = params.now ?? params.scorecard.generatedAt;
  const dateKey = dateKeyForTimestamp(now);
  const snapshot: SelfImprovementDailyScorecard = {
    id: `sis_${dateKey}`,
    dateKey,
    createdAt: now,
    scorecard: structuredClone(params.scorecard),
  };
  const stateDir = params.storePath ? undefined : (params.stateDir ?? resolveStateDir());
  const storePath = params.storePath ?? resolveSelfImprovementScorecardStorePath(stateDir);
  return await withSelfImprovementStoreMutation(storePath, async () => {
    const file = await readStore(storePath, stateDir);
    const byDate = new Map(file.scorecards.map((entry) => [entry.dateKey, cloneScorecard(entry)]));
    byDate.set(dateKey, snapshot);
    const scorecards = [...byDate.values()]
      .toSorted((left, right) => right.dateKey.localeCompare(left.dateKey))
      .slice(0, MAX_SCORECARDS);
    await writeStore(storePath, { version: STORE_VERSION, scorecards }, stateDir);
    return cloneScorecard(snapshot);
  });
}

export async function listSelfImprovementDailyScorecards(params?: {
  stateDir?: string;
  storePath?: string;
  days?: number;
  limit?: number;
}): Promise<SelfImprovementDailyScorecard[]> {
  const stateDir = params?.storePath ? undefined : (params?.stateDir ?? resolveStateDir());
  const storePath = params?.storePath ?? resolveSelfImprovementScorecardStorePath(stateDir);
  const file = await readStore(storePath, stateDir);
  const limit = params?.limit && params.limit > 0 ? params.limit : 30;
  const minDate =
    params?.days && params.days > 0
      ? dateKeyForTimestamp(Date.now() - (params.days - 1) * 24 * 60 * 60_000)
      : null;
  return file.scorecards
    .filter((entry) => !minDate || entry.dateKey >= minDate)
    .toSorted((left, right) => right.dateKey.localeCompare(left.dateKey))
    .slice(0, limit)
    .map(cloneScorecard);
}

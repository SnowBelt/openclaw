// Deterministic, storage-free hot/warm/cold recall projection for the Control Director.
import { createHash } from "node:crypto";

export const CONTROL_DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION = 1 as const;
export const CONTROL_DIRECTOR_MEMORY_HOT_MS = 2 * 24 * 60 * 60 * 1_000;
export const CONTROL_DIRECTOR_MEMORY_WARM_MS = 30 * 24 * 60 * 60 * 1_000;

export type ControlDirectorMemoryTier = "hot" | "warm" | "cold";
export type ControlDirectorMemorySourceType = "task" | "flow" | "session" | "daily";
export type ControlDirectorMemoryVisibility = "owner" | "shared";

export type ControlDirectorMemorySource = {
  sourceType: ControlDirectorMemorySourceType;
  sourceId: string;
  agentId: string;
  sessionKey?: string;
  title: string;
  summary?: string;
  updatedAt: number;
  visibility?: ControlDirectorMemoryVisibility;
};

export type ControlDirectorMemoryRecord = {
  schemaVersion: typeof CONTROL_DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION;
  id: string;
  tier: ControlDirectorMemoryTier;
  sourceType: ControlDirectorMemorySourceType;
  sourceId: string;
  agentId: string;
  sessionKey?: string;
  title: string;
  summary?: string;
  updatedAt: number;
  visibility: ControlDirectorMemoryVisibility;
  provenanceHash: string;
};

export type ControlDirectorMemoryHealth = {
  schemaVersion: 1;
  status: "healthy" | "empty" | "stale" | "corrupt" | "conflicted";
  newestSourceAt?: number;
  newestRecordAt?: number;
  newestAgeMs?: number;
  currentDaySourceCount: number;
  corruptRecordCount: number;
  sourceConflictCount: number;
  repairActions: Array<"refresh_recent_sources" | "rebuild_index" | "resolve_source_conflicts">;
};

const TIER_LIMITS: Record<ControlDirectorMemoryTier, number> = {
  hot: 100,
  warm: 500,
  cold: 1_000,
};

function boundedText(value: string | undefined, max: number): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function tierFor(updatedAt: number, now: number): ControlDirectorMemoryTier {
  const age = Math.max(0, now - updatedAt);
  return age <= CONTROL_DIRECTOR_MEMORY_HOT_MS
    ? "hot"
    : age <= CONTROL_DIRECTOR_MEMORY_WARM_MS
      ? "warm"
      : "cold";
}

function provenanceHash(record: Omit<ControlDirectorMemoryRecord, "provenanceHash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: record.schemaVersion,
        id: record.id,
        tier: record.tier,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        agentId: record.agentId,
        sessionKey: record.sessionKey,
        title: record.title,
        summary: record.summary,
        updatedAt: record.updatedAt,
        visibility: record.visibility,
      }),
    )
    .digest("hex");
}

/** Rebuild from authoritative sources; no additional transcript copy is persisted. */
export function rebuildControlDirectorMemoryIndex(params: {
  sources: readonly ControlDirectorMemorySource[];
  agentId: string;
  now?: number;
}): ControlDirectorMemoryRecord[] {
  const now = params.now ?? Date.now();
  const deduped = new Map<string, ControlDirectorMemorySource>();
  for (const source of params.sources) {
    if (source.agentId !== params.agentId || !source.sourceId.trim()) {
      continue;
    }
    const id = `${source.sourceType}:${source.sourceId.trim()}`;
    const existing = deduped.get(id);
    if (!existing || source.updatedAt >= existing.updatedAt) {
      deduped.set(id, source);
    }
  }
  const counts = new Map<ControlDirectorMemoryTier, number>();
  return [...deduped.entries()]
    .toSorted(
      (left, right) => right[1].updatedAt - left[1].updatedAt || left[0].localeCompare(right[0]),
    )
    .flatMap(([id, source]) => {
      const tier = tierFor(source.updatedAt, now);
      const count = counts.get(tier) ?? 0;
      if (count >= TIER_LIMITS[tier]) {
        return [];
      }
      counts.set(tier, count + 1);
      const title = boundedText(source.title, tier === "cold" ? 120 : 200);
      if (!title) {
        return [];
      }
      const recordWithoutHash: Omit<ControlDirectorMemoryRecord, "provenanceHash"> = {
        schemaVersion: CONTROL_DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION,
        id,
        tier,
        sourceType: source.sourceType,
        sourceId: source.sourceId.trim(),
        agentId: source.agentId,
        ...(source.sessionKey?.trim() ? { sessionKey: source.sessionKey.trim() } : {}),
        title,
        ...(tier !== "cold" && boundedText(source.summary, tier === "hot" ? 500 : 220)
          ? { summary: boundedText(source.summary, tier === "hot" ? 500 : 220)! }
          : {}),
        updatedAt: Math.max(0, Math.floor(source.updatedAt)),
        visibility: source.visibility ?? "owner",
      };
      return [{ ...recordWithoutHash, provenanceHash: provenanceHash(recordWithoutHash) }];
    });
}

export function verifyControlDirectorMemoryRecord(record: ControlDirectorMemoryRecord): boolean {
  const { provenanceHash: claimed, ...withoutHash } = record;
  return claimed === provenanceHash(withoutHash);
}

function sourceFingerprint(source: ControlDirectorMemorySource): string {
  return JSON.stringify({
    agentId: source.agentId,
    sessionKey: source.sessionKey?.trim(),
    title: boundedText(source.title, 200),
    summary: boundedText(source.summary, 500),
    updatedAt: Math.max(0, Math.floor(source.updatedAt)),
    visibility: source.visibility ?? "owner",
  });
}

/** Measure freshness, provenance integrity, and deterministic rebuild needs. */
export function assessControlDirectorMemoryHealth(params: {
  records: readonly ControlDirectorMemoryRecord[];
  sources: readonly ControlDirectorMemorySource[];
  agentId: string;
  now?: number;
}): ControlDirectorMemoryHealth {
  const now = params.now ?? Date.now();
  const sources = params.sources.filter((source) => source.agentId === params.agentId);
  const records = params.records.filter((record) => record.agentId === params.agentId);
  const newestSourceAt = sources.reduce<number | undefined>(
    (latest, source) =>
      latest === undefined ? source.updatedAt : Math.max(latest, source.updatedAt),
    undefined,
  );
  const newestRecordAt = records.reduce<number | undefined>(
    (latest, record) =>
      latest === undefined ? record.updatedAt : Math.max(latest, record.updatedAt),
    undefined,
  );
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const currentDaySourceCount = sources.filter(
    (source) => source.updatedAt >= dayStart.getTime(),
  ).length;
  const corruptRecordCount = records.filter(
    (record) => !verifyControlDirectorMemoryRecord(record),
  ).length;
  const fingerprints = new Map<string, Map<number, Set<string>>>();
  for (const source of sources) {
    const key = `${source.sourceType}:${source.sourceId.trim()}`;
    const byTimestamp = fingerprints.get(key) ?? new Map<number, Set<string>>();
    const timestamp = Math.max(0, Math.floor(source.updatedAt));
    const values = byTimestamp.get(timestamp) ?? new Set<string>();
    values.add(sourceFingerprint(source));
    byTimestamp.set(timestamp, values);
    fingerprints.set(key, byTimestamp);
  }
  const sourceConflictCount = [...fingerprints.values()].reduce(
    (count, byTimestamp) =>
      count + [...byTimestamp.values()].filter((values) => values.size > 1).length,
    0,
  );
  const newestAgeMs = newestSourceAt === undefined ? undefined : Math.max(0, now - newestSourceAt);
  const status: ControlDirectorMemoryHealth["status"] =
    corruptRecordCount > 0
      ? "corrupt"
      : sourceConflictCount > 0
        ? "conflicted"
        : newestSourceAt === undefined
          ? "empty"
          : newestAgeMs! > CONTROL_DIRECTOR_MEMORY_HOT_MS
            ? "stale"
            : "healthy";
  const repairActions: ControlDirectorMemoryHealth["repairActions"] = [];
  if (status === "empty" || status === "stale") {
    repairActions.push("refresh_recent_sources");
  }
  if (
    corruptRecordCount > 0 ||
    records.length !==
      rebuildControlDirectorMemoryIndex({ sources, agentId: params.agentId, now }).length
  ) {
    repairActions.push("rebuild_index");
  }
  if (sourceConflictCount > 0) {
    repairActions.push("resolve_source_conflicts");
  }
  return {
    schemaVersion: 1,
    status,
    ...(newestSourceAt !== undefined ? { newestSourceAt } : {}),
    ...(newestRecordAt !== undefined ? { newestRecordAt } : {}),
    ...(newestAgeMs !== undefined ? { newestAgeMs } : {}),
    currentDaySourceCount,
    corruptRecordCount,
    sourceConflictCount,
    repairActions,
  };
}

function terms(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
      (term) => !["the", "and", "what", "from", "with", "did", "was", "were"].includes(term),
    ),
  );
}

/** Top-K recall with tier and recency preference; malformed records are ignored. */
export function searchControlDirectorMemoryIndex(params: {
  records: readonly ControlDirectorMemoryRecord[];
  query: string;
  agentId: string;
  topK?: number;
}): ControlDirectorMemoryRecord[] {
  const queryTerms = terms(params.query);
  const topK = Math.max(1, Math.min(20, Math.floor(params.topK ?? 3)));
  const candidates = params.records
    .filter(
      (record) =>
        record.agentId === params.agentId &&
        record.visibility === "owner" &&
        verifyControlDirectorMemoryRecord(record),
    )
    .map((record) => {
      const recordTerms = terms(`${record.title} ${record.summary ?? ""}`);
      const matches = [...queryTerms].filter((term) => recordTerms.has(term)).length;
      const tierWeight = record.tier === "hot" ? 3 : record.tier === "warm" ? 2 : 1;
      return { record, matches, tierWeight };
    });
  const hasLexicalMatch = candidates.some((candidate) => candidate.matches > 0);
  return candidates
    .filter((candidate) => !hasLexicalMatch || candidate.matches > 0)
    .toSorted(
      (left, right) =>
        right.matches - left.matches ||
        right.tierWeight - left.tierWeight ||
        right.record.updatedAt - left.record.updatedAt ||
        left.record.id.localeCompare(right.record.id),
    )
    .slice(0, topK)
    .map((candidate) => candidate.record);
}

/** Deletion is immediate because the projection is rebuilt only from surviving sources. */
export function removeControlDirectorMemorySource(
  records: readonly ControlDirectorMemoryRecord[],
  sourceType: ControlDirectorMemorySourceType,
  sourceId: string,
): ControlDirectorMemoryRecord[] {
  return records.filter(
    (record) => !(record.sourceType === sourceType && record.sourceId === sourceId),
  );
}

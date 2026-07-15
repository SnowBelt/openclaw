import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { appendSelfImprovementAuditEvent } from "./audit-events.js";
import {
  withSelfImprovementStoreMutation,
  writeSelfImprovementJsonAtomically,
} from "./json-store.js";
import { isSelfImprovementJsonToSqliteMigrationApplied } from "./ledger-migration.js";
import { listSelfImprovementLedgerRows, replaceSelfImprovementLedgerRows } from "./ledger.js";
import type { SelfImprovementOutboxItem } from "./outbox.js";
import type { SelfImprovementProofReceipt } from "./proof-receipts.js";
import type { SelfImprovementSignal } from "./signals.js";
import type {
  SelfImprovementAuditEventStoreFile,
  SelfImprovementDailyScorecardStoreFile,
  SelfImprovementMaintenanceResult,
  SelfImprovementMaintenanceStoreName,
  SelfImprovementMaintenanceStoreResult,
  SelfImprovementOperationalHealthSnapshotStoreFile,
  SelfImprovementProposal,
  SelfImprovementProposalStoreFile,
  SelfImprovementRecommendation,
  SelfImprovementRecommendationStoreFile,
} from "./types.js";

const STORE_DIR = "self-improvement";
const DAY_MS = 24 * 60 * 60_000;

const RETENTION = {
  recommendations: { days: 90, maxRecords: 1_000 },
  auditEvents: { days: 30, maxRecords: 500 },
  healthSnapshots: { days: 30, maxRecords: 120 },
  scorecards: { days: 180, maxRecords: 180 },
  proposals: { days: 90, maxRecords: 1_000 },
  signals: { days: 90, maxRecords: 2_000 },
  outbox: { days: 30, maxRecords: 2_000 },
  proofReceipts: { days: 180, maxRecords: 2_000 },
} as const;

function storePath(stateDir: string, filename: string): string {
  return path.join(stateDir, STORE_DIR, filename);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeSelfImprovementJsonAtomically(filePath, value);
}

async function readRecommendationsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
}): Promise<SelfImprovementRecommendationStoreFile> {
  if (params.migrated) {
    const rows = await listSelfImprovementLedgerRows<SelfImprovementRecommendation>({
      stateDir: params.stateDir,
      collection: "recommendations",
    });
    return { version: 3, recommendations: rows.map((row) => row.value) };
  }
  return await readJsonFile(params.storePath, { version: 3, recommendations: [] });
}

async function writeRecommendationsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
  file: SelfImprovementRecommendationStoreFile;
}): Promise<void> {
  if (params.migrated) {
    await replaceSelfImprovementLedgerRows({
      stateDir: params.stateDir,
      collection: "recommendations",
      rows: params.file.recommendations,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });
    return;
  }
  await writeJsonFile(params.storePath, params.file);
}

async function readAuditEventsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
}): Promise<SelfImprovementAuditEventStoreFile> {
  if (params.migrated) {
    const rows = await listSelfImprovementLedgerRows<
      SelfImprovementAuditEventStoreFile["events"][number]
    >({
      stateDir: params.stateDir,
      collection: "audit_events",
    });
    return { version: 1, events: rows.map((row) => row.value) };
  }
  return await readJsonFile(params.storePath, { version: 1, events: [] });
}

async function writeAuditEventsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
  file: SelfImprovementAuditEventStoreFile;
}): Promise<void> {
  if (params.migrated) {
    await replaceSelfImprovementLedgerRows({
      stateDir: params.stateDir,
      collection: "audit_events",
      rows: params.file.events,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.createdAt,
    });
    return;
  }
  await writeJsonFile(params.storePath, params.file);
}

async function readHealthSnapshotsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
}): Promise<SelfImprovementOperationalHealthSnapshotStoreFile> {
  if (params.migrated) {
    const rows = await listSelfImprovementLedgerRows<
      SelfImprovementOperationalHealthSnapshotStoreFile["snapshots"][number]
    >({ stateDir: params.stateDir, collection: "health_snapshots" });
    return { version: 1, snapshots: rows.map((row) => row.value) };
  }
  return await readJsonFile(params.storePath, { version: 1, snapshots: [] });
}

async function writeHealthSnapshotsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
  file: SelfImprovementOperationalHealthSnapshotStoreFile;
}): Promise<void> {
  if (params.migrated) {
    await replaceSelfImprovementLedgerRows({
      stateDir: params.stateDir,
      collection: "health_snapshots",
      rows: params.file.snapshots,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.createdAt,
    });
    return;
  }
  await writeJsonFile(params.storePath, params.file);
}

async function readScorecardsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
}): Promise<SelfImprovementDailyScorecardStoreFile> {
  if (params.migrated) {
    const rows = await listSelfImprovementLedgerRows<
      SelfImprovementDailyScorecardStoreFile["scorecards"][number]
    >({ stateDir: params.stateDir, collection: "scorecards" });
    return { version: 1, scorecards: rows.map((row) => row.value) };
  }
  return await readJsonFile(params.storePath, { version: 1, scorecards: [] });
}

async function writeScorecardsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
  file: SelfImprovementDailyScorecardStoreFile;
}): Promise<void> {
  if (params.migrated) {
    await replaceSelfImprovementLedgerRows({
      stateDir: params.stateDir,
      collection: "scorecards",
      rows: params.file.scorecards,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.createdAt,
    });
    return;
  }
  await writeJsonFile(params.storePath, params.file);
}

async function readProposalsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
}): Promise<SelfImprovementProposalStoreFile> {
  if (params.migrated) {
    const rows = await listSelfImprovementLedgerRows<SelfImprovementProposal>({
      stateDir: params.stateDir,
      collection: "proposals",
    });
    return { version: 1, proposals: rows.map((row) => row.value) };
  }
  return await readJsonFile(params.storePath, { version: 1, proposals: [] });
}

async function writeProposalsStore(params: {
  stateDir: string;
  storePath: string;
  migrated: boolean;
  file: SelfImprovementProposalStoreFile;
}): Promise<void> {
  if (params.migrated) {
    await replaceSelfImprovementLedgerRows({
      stateDir: params.stateDir,
      collection: "proposals",
      rows: params.file.proposals,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });
    return;
  }
  await writeJsonFile(params.storePath, params.file);
}

function cutoff(now: number, days: number): number {
  return now - days * DAY_MS;
}

function isActiveRecommendation(recommendation: SelfImprovementRecommendation): boolean {
  return recommendation.status !== "resolved" && recommendation.status !== "dismissed";
}

function isActiveProposal(proposal: SelfImprovementProposal): boolean {
  return (
    proposal.status === "pending" ||
    proposal.status === "acknowledged" ||
    proposal.status === "approved" ||
    proposal.curatorStatus === "accepted_for_workshop" ||
    proposal.curatorStatus === "needs_more_evidence" ||
    proposal.curatorStatus === "pending_review"
  );
}

function storeResult(params: {
  store: SelfImprovementMaintenanceStoreName;
  before: number;
  after: number;
  retainedActive?: number;
}): SelfImprovementMaintenanceStoreResult {
  const policy = RETENTION[params.store];
  return {
    store: params.store,
    before: params.before,
    after: params.after,
    pruned: Math.max(0, params.before - params.after),
    retainedActive: params.retainedActive ?? 0,
    retentionDays: policy.days,
    maxRecords: policy.maxRecords,
  };
}

function compactByAgeOrLatest<T>(params: {
  records: readonly T[];
  timestamp: (record: T) => number;
  cutoffAt: number;
  maxRecords: number;
  sortNewest: (left: T, right: T) => number;
}): T[] {
  const latest = new Set(
    [...params.records].toSorted(params.sortNewest).slice(0, params.maxRecords),
  );
  return params.records
    .filter((record) => params.timestamp(record) >= params.cutoffAt || latest.has(record))
    .toSorted(params.sortNewest);
}

function compactRecommendations(
  file: SelfImprovementRecommendationStoreFile,
  now: number,
): { file: SelfImprovementRecommendationStoreFile; result: SelfImprovementMaintenanceStoreResult } {
  const active = file.recommendations.filter(isActiveRecommendation);
  const closed = file.recommendations.filter((entry) => !isActiveRecommendation(entry));
  const retainedClosed = closed.filter(
    (entry) =>
      Math.max(entry.updatedAt, entry.lastSeenAt) >= cutoff(now, RETENTION.recommendations.days),
  );
  const recommendations = [...active, ...retainedClosed].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  );
  return {
    file: { version: 3, recommendations },
    result: storeResult({
      store: "recommendations",
      before: file.recommendations.length,
      after: recommendations.length,
      retainedActive: active.length,
    }),
  };
}

function compactAuditEvents(
  file: SelfImprovementAuditEventStoreFile,
  now: number,
): { file: SelfImprovementAuditEventStoreFile; result: SelfImprovementMaintenanceStoreResult } {
  const events = compactByAgeOrLatest({
    records: file.events,
    timestamp: (event) => event.createdAt,
    cutoffAt: cutoff(now, RETENTION.auditEvents.days),
    maxRecords: RETENTION.auditEvents.maxRecords,
    sortNewest: (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  });
  return {
    file: { version: 1, events },
    result: storeResult({ store: "auditEvents", before: file.events.length, after: events.length }),
  };
}

function compactHealthSnapshots(
  file: SelfImprovementOperationalHealthSnapshotStoreFile,
  now: number,
): {
  file: SelfImprovementOperationalHealthSnapshotStoreFile;
  result: SelfImprovementMaintenanceStoreResult;
} {
  const snapshots = compactByAgeOrLatest({
    records: file.snapshots,
    timestamp: (snapshot) => snapshot.createdAt,
    cutoffAt: cutoff(now, RETENTION.healthSnapshots.days),
    maxRecords: RETENTION.healthSnapshots.maxRecords,
    sortNewest: (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  });
  return {
    file: { version: 1, snapshots },
    result: storeResult({
      store: "healthSnapshots",
      before: file.snapshots.length,
      after: snapshots.length,
    }),
  };
}

function compactScorecards(
  file: SelfImprovementDailyScorecardStoreFile,
  now: number,
): { file: SelfImprovementDailyScorecardStoreFile; result: SelfImprovementMaintenanceStoreResult } {
  const scorecards = file.scorecards
    .filter((scorecard) => scorecard.createdAt >= cutoff(now, RETENTION.scorecards.days))
    .toSorted((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .slice(0, RETENTION.scorecards.maxRecords);
  return {
    file: { version: 1, scorecards },
    result: storeResult({
      store: "scorecards",
      before: file.scorecards.length,
      after: scorecards.length,
    }),
  };
}

function compactProposals(
  file: SelfImprovementProposalStoreFile,
  now: number,
): { file: SelfImprovementProposalStoreFile; result: SelfImprovementMaintenanceStoreResult } {
  const active = file.proposals.filter(isActiveProposal);
  const inactive = file.proposals.filter((proposal) => !isActiveProposal(proposal));
  const retainedInactive = inactive.filter(
    (proposal) => proposal.updatedAt >= cutoff(now, RETENTION.proposals.days),
  );
  const proposals = [...active, ...retainedInactive]
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, RETENTION.proposals.maxRecords);
  return {
    file: { version: 1, proposals },
    result: storeResult({
      store: "proposals",
      before: file.proposals.length,
      after: proposals.length,
      retainedActive: active.length,
    }),
  };
}

async function compactSignals(params: { stateDir: string; now: number }): Promise<{
  rows: SelfImprovementSignal[];
  result: SelfImprovementMaintenanceStoreResult;
}> {
  const rows = (
    await listSelfImprovementLedgerRows<SelfImprovementSignal>({
      stateDir: params.stateDir,
      collection: "signals",
    })
  ).map((row) => row.value);
  const retained = compactByAgeOrLatest({
    records: rows,
    timestamp: (signal) => signal.lastSeenAt,
    cutoffAt: cutoff(params.now, RETENTION.signals.days),
    maxRecords: RETENTION.signals.maxRecords,
    sortNewest: (left, right) =>
      right.lastSeenAt - left.lastSeenAt || left.id.localeCompare(right.id),
  });
  return {
    rows: retained,
    result: storeResult({ store: "signals", before: rows.length, after: retained.length }),
  };
}

async function compactOutbox(params: { stateDir: string; now: number }): Promise<{
  rows: SelfImprovementOutboxItem[];
  result: SelfImprovementMaintenanceStoreResult;
}> {
  const rows = (
    await listSelfImprovementLedgerRows<SelfImprovementOutboxItem>({
      stateDir: params.stateDir,
      collection: "outbox",
    })
  ).map((row) => row.value);
  const active = rows.filter((item) => item.status === "pending" || item.status === "processing");
  const inactive = rows.filter(
    (item) => item.status === "completed" || item.status === "quarantined",
  );
  const retainedInactive = compactByAgeOrLatest({
    records: inactive,
    timestamp: (item) => item.completedAt ?? item.updatedAt,
    cutoffAt: cutoff(params.now, RETENTION.outbox.days),
    maxRecords: RETENTION.outbox.maxRecords,
    sortNewest: (left, right) =>
      right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  });
  const retained = [...active, ...retainedInactive].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  );
  return {
    rows: retained,
    result: storeResult({
      store: "outbox",
      before: rows.length,
      after: retained.length,
      retainedActive: active.length,
    }),
  };
}

async function compactProofReceipts(params: { stateDir: string; now: number }): Promise<{
  rows: SelfImprovementProofReceipt[];
  result: SelfImprovementMaintenanceStoreResult;
}> {
  const rows = (
    await listSelfImprovementLedgerRows<SelfImprovementProofReceipt>({
      stateDir: params.stateDir,
      collection: "proof_receipts",
    })
  ).map((row) => row.value);
  const retained = compactByAgeOrLatest({
    records: rows,
    timestamp: (receipt) => receipt.verifiedAt,
    cutoffAt: cutoff(params.now, RETENTION.proofReceipts.days),
    maxRecords: RETENTION.proofReceipts.maxRecords,
    sortNewest: (left, right) =>
      right.verifiedAt - left.verifiedAt || left.id.localeCompare(right.id),
  });
  return {
    rows: retained,
    result: storeResult({
      store: "proofReceipts",
      before: rows.length,
      after: retained.length,
    }),
  };
}

export async function runSelfImprovementMaintenance(params?: {
  stateDir?: string;
  apply?: boolean;
  now?: number;
}): Promise<SelfImprovementMaintenanceResult> {
  const stateDir = params?.stateDir ?? resolveStateDir();
  const maintainedAt = params?.now ?? Date.now();
  const applied = Boolean(params?.apply);
  const recommendationsPath = storePath(stateDir, "recommendations.json");
  const auditEventsPath = storePath(stateDir, "audit-events.json");
  const healthSnapshotsPath = storePath(stateDir, "health-snapshots.json");
  const scorecardsPath = storePath(stateDir, "scorecards.json");
  const proposalsPath = storePath(stateDir, "proposals.json");
  const migrated = await isSelfImprovementJsonToSqliteMigrationApplied({ stateDir });

  const dryRunRecommendations = compactRecommendations(
    await readRecommendationsStore({ stateDir, storePath: recommendationsPath, migrated }),
    maintainedAt,
  );
  const dryRunAuditEvents = compactAuditEvents(
    await readAuditEventsStore({ stateDir, storePath: auditEventsPath, migrated }),
    maintainedAt,
  );
  const dryRunHealthSnapshots = compactHealthSnapshots(
    await readHealthSnapshotsStore({ stateDir, storePath: healthSnapshotsPath, migrated }),
    maintainedAt,
  );
  const dryRunScorecards = compactScorecards(
    await readScorecardsStore({ stateDir, storePath: scorecardsPath, migrated }),
    maintainedAt,
  );
  const dryRunProposals = compactProposals(
    await readProposalsStore({ stateDir, storePath: proposalsPath, migrated }),
    maintainedAt,
  );
  const dryRunSignals = await compactSignals({ stateDir, now: maintainedAt });
  const dryRunOutbox = await compactOutbox({ stateDir, now: maintainedAt });
  const dryRunProofReceipts = await compactProofReceipts({ stateDir, now: maintainedAt });
  let stores = [
    dryRunRecommendations.result,
    dryRunAuditEvents.result,
    dryRunHealthSnapshots.result,
    dryRunScorecards.result,
    dryRunProposals.result,
    dryRunSignals.result,
    dryRunOutbox.result,
    dryRunProofReceipts.result,
  ];

  let auditEventId: string | undefined;
  if (applied) {
    const recommendations = await withSelfImprovementStoreMutation(
      recommendationsPath,
      async () => {
        const compacted = compactRecommendations(
          await readRecommendationsStore({
            stateDir,
            storePath: recommendationsPath,
            migrated,
          }),
          maintainedAt,
        );
        await writeRecommendationsStore({
          stateDir,
          storePath: recommendationsPath,
          migrated,
          file: compacted.file,
        });
        return compacted;
      },
    );
    const auditEvents = await withSelfImprovementStoreMutation(auditEventsPath, async () => {
      const compacted = compactAuditEvents(
        await readAuditEventsStore({ stateDir, storePath: auditEventsPath, migrated }),
        maintainedAt,
      );
      await writeAuditEventsStore({
        stateDir,
        storePath: auditEventsPath,
        migrated,
        file: compacted.file,
      });
      return compacted;
    });
    const healthSnapshots = await withSelfImprovementStoreMutation(
      healthSnapshotsPath,
      async () => {
        const compacted = compactHealthSnapshots(
          await readHealthSnapshotsStore({
            stateDir,
            storePath: healthSnapshotsPath,
            migrated,
          }),
          maintainedAt,
        );
        await writeHealthSnapshotsStore({
          stateDir,
          storePath: healthSnapshotsPath,
          migrated,
          file: compacted.file,
        });
        return compacted;
      },
    );
    const scorecards = await withSelfImprovementStoreMutation(scorecardsPath, async () => {
      const compacted = compactScorecards(
        await readScorecardsStore({ stateDir, storePath: scorecardsPath, migrated }),
        maintainedAt,
      );
      await writeScorecardsStore({
        stateDir,
        storePath: scorecardsPath,
        migrated,
        file: compacted.file,
      });
      return compacted;
    });
    const proposals = await withSelfImprovementStoreMutation(proposalsPath, async () => {
      const compacted = compactProposals(
        await readProposalsStore({ stateDir, storePath: proposalsPath, migrated }),
        maintainedAt,
      );
      await writeProposalsStore({
        stateDir,
        storePath: proposalsPath,
        migrated,
        file: compacted.file,
      });
      return compacted;
    });
    const signals = await compactSignals({ stateDir, now: maintainedAt });
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "signals",
      rows: signals.rows,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.firstSeenAt,
      updatedAt: (entry) => entry.lastSeenAt,
    });
    const outbox = await compactOutbox({ stateDir, now: maintainedAt });
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "outbox",
      rows: outbox.rows,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });
    const proofReceipts = await compactProofReceipts({ stateDir, now: maintainedAt });
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "proof_receipts",
      rows: proofReceipts.rows,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.verifiedAt,
    });
    stores = [
      recommendations.result,
      auditEvents.result,
      healthSnapshots.result,
      scorecards.result,
      proposals.result,
      signals.result,
      outbox.result,
      proofReceipts.result,
    ];
    const maintenanceAuditEvent = await appendSelfImprovementAuditEvent({
      stateDir,
      event: {
        createdAt: maintainedAt,
        actor: "cli",
        kind: "retention_maintenance",
        targetId: "self-improvement-stores",
        summary: "Applied Self-Improvement retention maintenance.",
        metadata: {
          totalBefore: stores.reduce((sum, store) => sum + store.before, 0),
          totalAfter: stores.reduce((sum, store) => sum + store.after, 0),
          totalPruned: stores.reduce((sum, store) => sum + store.pruned, 0),
          stores: stores.map((store) => `${store.store}:${store.before}->${store.after}`),
        },
      },
    });
    auditEventId = maintenanceAuditEvent.id;
    await withSelfImprovementStoreMutation(auditEventsPath, async () => {
      const refreshedAuditEvents = compactAuditEvents(
        await readAuditEventsStore({ stateDir, storePath: auditEventsPath, migrated }),
        maintainedAt,
      );
      await writeAuditEventsStore({
        stateDir,
        storePath: auditEventsPath,
        migrated,
        file: refreshedAuditEvents.file,
      });
    });
  }

  return {
    maintainedAt,
    dryRun: !applied,
    applied,
    stores,
    totalBefore: stores.reduce((sum, store) => sum + store.before, 0),
    totalAfter: stores.reduce((sum, store) => sum + store.after, 0),
    totalPruned: stores.reduce((sum, store) => sum + store.pruned, 0),
    ...(auditEventId ? { auditEventId } : {}),
  };
}

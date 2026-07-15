import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSelfImprovementAuditEvent, listSelfImprovementAuditEvents } from "./audit-events.js";
import { runSelfImprovementJsonToSqliteMigration } from "./ledger-migration.js";
import { listSelfImprovementLedgerRows, upsertSelfImprovementLedgerRows } from "./ledger.js";
import { runSelfImprovementMaintenance } from "./maintenance.js";

const tempDirs: string[] = [];
const now = Date.parse("2026-05-07T12:00:00.000Z");
const old = now - 120 * 24 * 60 * 60_000;

async function tempStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-self-improvement-maintenance-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "self-improvement"), { recursive: true });
  return dir;
}

async function writeStore(stateDir: string, filename: string, value: unknown) {
  await writeFile(
    join(stateDir, "self-improvement", filename),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function readStore<T>(stateDir: string, filename: string): Promise<T> {
  return JSON.parse(await readFile(join(stateDir, "self-improvement", filename), "utf8")) as T;
}

describe("self-improvement retention maintenance", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("dry-runs without mutating stores", async () => {
    const stateDir = await tempStateDir();
    await writeStore(stateDir, "recommendations.json", {
      version: 2,
      recommendations: [
        { id: "active", status: "open", updatedAt: old, lastSeenAt: old },
        { id: "closed", status: "resolved", updatedAt: old, lastSeenAt: old },
      ],
    });

    const result = await runSelfImprovementMaintenance({ stateDir, now });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.stores.find((store) => store.store === "recommendations")).toMatchObject({
      before: 2,
      after: 1,
      pruned: 1,
      retainedActive: 1,
    });
    const stored = await readStore<{ recommendations: unknown[] }>(
      stateDir,
      "recommendations.json",
    );
    expect(stored.recommendations).toHaveLength(2);
  });

  it("applies conservative pruning and writes sanitized count-only audit metadata", async () => {
    const stateDir = await tempStateDir();
    await writeStore(stateDir, "recommendations.json", {
      version: 2,
      recommendations: [
        {
          id: "active",
          status: "open",
          updatedAt: old,
          lastSeenAt: old,
          resolutionProof: "api_key=secret-value",
        },
        {
          id: "closed",
          status: "dismissed",
          updatedAt: old,
          lastSeenAt: old,
          dismissalReason: "token=secret-value",
        },
      ],
    });
    await writeStore(stateDir, "audit-events.json", {
      version: 1,
      events: [
        {
          id: "old_event",
          createdAt: old,
          kind: "analysis_run",
          actor: "governor",
          targetId: "analysis",
          summary: "Old event",
        },
      ],
    });
    await writeStore(stateDir, "health-snapshots.json", { version: 1, snapshots: [] });
    await writeStore(stateDir, "scorecards.json", { version: 1, scorecards: [] });
    await writeStore(stateDir, "proposals.json", { version: 1, proposals: [] });

    const result = await runSelfImprovementMaintenance({ stateDir, now, apply: true });

    expect(result.applied).toBe(true);
    expect(result.auditEventId).toBeTruthy();
    const recommendations = await readStore<{ recommendations: Array<{ id?: string }> }>(
      stateDir,
      "recommendations.json",
    );
    expect(recommendations.recommendations.map((entry) => entry.id)).toEqual(["active"]);
    const audit = await readStore<{
      events: Array<{ kind?: string; metadata?: Record<string, unknown> }>;
    }>(stateDir, "audit-events.json");
    const maintenanceEvent = audit.events.find((event) => event.kind === "retention_maintenance");
    expect(maintenanceEvent?.metadata).toMatchObject({
      totalBefore: expect.any(Number),
      totalAfter: expect.any(Number),
      totalPruned: expect.any(Number),
    });
    expect(JSON.stringify(maintenanceEvent)).not.toContain("secret-value");
    expect(JSON.stringify(maintenanceEvent)).not.toContain("api_key=");
    expect(JSON.stringify(maintenanceEvent)).not.toContain("token=");
  });

  it("does not discard a concurrent fresh audit append", async () => {
    const stateDir = await tempStateDir();
    await writeStore(stateDir, "audit-events.json", {
      version: 1,
      events: [
        {
          id: "old_event",
          createdAt: old,
          kind: "analysis_run",
          actor: "governor",
          targetId: "analysis",
          summary: "Old event",
        },
      ],
    });

    await Promise.all([
      runSelfImprovementMaintenance({ stateDir, now, apply: true }),
      appendSelfImprovementAuditEvent({
        stateDir,
        event: {
          id: "fresh_event",
          createdAt: now,
          kind: "analysis_run",
          actor: "governor",
          targetId: "analysis",
          summary: "Fresh event",
        },
      }),
    ]);

    const events = await listSelfImprovementAuditEvents({ stateDir, limit: 10 });
    expect(events.some((event) => event.id === "fresh_event")).toBe(true);
  });

  it("compacts the canonical SQLite ledger after migration and leaves legacy JSON unchanged", async () => {
    const stateDir = await tempStateDir();
    await writeStore(stateDir, "recommendations.json", {
      version: 3,
      recommendations: [
        { id: "active", status: "open", createdAt: old, updatedAt: old, lastSeenAt: old },
        { id: "closed", status: "resolved", createdAt: old, updatedAt: old, lastSeenAt: old },
      ],
    });
    await writeStore(stateDir, "audit-events.json", {
      version: 1,
      events: [
        {
          id: "old_event",
          createdAt: old,
          kind: "analysis_run",
          actor: "governor",
          targetId: "analysis",
          summary: "Old event",
        },
      ],
    });
    await runSelfImprovementJsonToSqliteMigration({
      stateDir,
      backupDirectory: join(stateDir, "backups", "20260507T120000Z"),
      apply: true,
      now,
    });
    const legacyPoison = {
      version: 3,
      recommendations: [
        { id: "legacy_only", status: "open", createdAt: now, updatedAt: now, lastSeenAt: now },
      ],
    };
    await writeStore(stateDir, "recommendations.json", legacyPoison);

    const dryRun = await runSelfImprovementMaintenance({ stateDir, now });
    expect(dryRun.stores.find((store) => store.store === "recommendations")).toMatchObject({
      before: 2,
      after: 1,
      retainedActive: 1,
    });

    const applied = await runSelfImprovementMaintenance({ stateDir, now, apply: true });
    expect(applied.applied).toBe(true);
    await expect(
      listSelfImprovementLedgerRows<{ id: string }>({
        stateDir,
        collection: "recommendations",
      }),
    ).resolves.toMatchObject([{ id: "active" }]);
    await expect(readStore(stateDir, "recommendations.json")).resolves.toEqual(legacyPoison);
    const auditEvents = await listSelfImprovementAuditEvents({ stateDir, limit: 10 });
    expect(auditEvents.some((event) => event.kind === "retention_maintenance")).toBe(true);
  });

  it("bounds durable signal, outbox, and proof history while preserving pending work", async () => {
    const stateDir = await tempStateDir();
    const signals = Array.from({ length: 2_001 }, (_, index) => ({
      id: `sis_${index.toString().padStart(4, "0")}`,
      version: 1 as const,
      idempotencyKey: `signal-${index}`,
      source: { component: "test" },
      kind: "workflow_failure" as const,
      severity: "medium" as const,
      summary: `Signal ${index}`,
      firstSeenAt: old,
      lastSeenAt: old + index,
      occurrences: 1,
      evidenceRefs: [],
      privacy: "internal" as const,
      trusted: true,
    }));
    const outbox = [
      ...Array.from({ length: 2_001 }, (_, index) => ({
        id: `sio_${index.toString().padStart(4, "0")}`,
        kind: "signal_analysis" as const,
        entityId: `sis_${index}`,
        status: "completed" as const,
        createdAt: old,
        updatedAt: old + index,
        availableAt: old,
        attempts: 1,
        completedAt: old + index,
      })),
      {
        id: "sio_pending",
        kind: "signal_analysis" as const,
        entityId: "sis_pending",
        status: "pending" as const,
        createdAt: old,
        updatedAt: old,
        availableAt: now + 60_000,
        attempts: 0,
      },
    ];
    const proofReceipts = Array.from({ length: 2_001 }, (_, index) => ({
      id: `sipr_${index.toString().padStart(4, "0")}`,
      version: 1 as const,
      recommendationId: `sir_${index}`,
      diagnosis: "Bounded diagnosis",
      action: "Bounded action",
      metric: { name: "quality", target: ">=0.93", observed: "0.95", passed: true },
      observation: {
        startedAt: old - 100 * 24 * 60 * 60_000,
        endedAt: old - 100 * 24 * 60 * 60_000 + index,
        minimumDurationMs: 0,
      },
      holdout: { required: false },
      evidenceRefs: [`proof:${index}`],
      status: "passed" as const,
      outcomeConfirmed: true,
      createdAt: old - 100 * 24 * 60 * 60_000,
      verifiedAt: old - 100 * 24 * 60 * 60_000 + index,
    }));
    await upsertSelfImprovementLedgerRows({
      stateDir,
      collection: "signals",
      rows: signals,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.firstSeenAt,
      updatedAt: (entry) => entry.lastSeenAt,
    });
    await upsertSelfImprovementLedgerRows({
      stateDir,
      collection: "outbox",
      rows: outbox,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });
    await upsertSelfImprovementLedgerRows({
      stateDir,
      collection: "proof_receipts",
      rows: proofReceipts,
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.verifiedAt,
    });

    const result = await runSelfImprovementMaintenance({ stateDir, now, apply: true });

    expect(result.stores.find((store) => store.store === "signals")).toMatchObject({
      before: 2_001,
      after: 2_000,
      pruned: 1,
    });
    expect(result.stores.find((store) => store.store === "outbox")).toMatchObject({
      before: 2_002,
      after: 2_001,
      pruned: 1,
      retainedActive: 1,
    });
    expect(result.stores.find((store) => store.store === "proofReceipts")).toMatchObject({
      before: 2_001,
      after: 2_000,
      pruned: 1,
    });
    const retainedOutbox = await listSelfImprovementLedgerRows<{ id: string; status: string }>({
      stateDir,
      collection: "outbox",
    });
    expect(retainedOutbox.some((row) => row.value.id === "sio_pending")).toBe(true);
    const retainedProofReceipts = await listSelfImprovementLedgerRows<{ id: string }>({
      stateDir,
      collection: "proof_receipts",
    });
    expect(retainedProofReceipts).toHaveLength(2_000);
    expect(retainedProofReceipts.some((row) => row.id === "sipr_0000")).toBe(false);
  });
});

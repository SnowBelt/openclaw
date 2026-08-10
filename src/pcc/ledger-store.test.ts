import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import {
  closePccLedgerStorageForTest,
  detectPccLedgerStorageMigration,
  migrateLegacyPccLedgerStorage,
  pccLedgerBackupPath,
  pccLedgerJsonPath,
  pccLedgerRevision,
  pccLedgerSqlitePath,
  readPccLedger,
  readPccLedgerBackup,
  replacePccLedgerForTest,
  withPccLedger,
} from "./ledger-store.js";

const roots: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-ledger-"));
  roots.push(root);
  return { OPENCLAW_STATE_DIR: root };
}

afterEach(() => {
  closePccLedgerStorageForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PCC ledger storage", () => {
  it("migrates legacy JSON into a backed-up transactional SQLite snapshot", () => {
    const env = makeEnv();
    const legacyPath = pccLedgerJsonPath(env);
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        version: 1,
        projects: [{ id: "project-1", title: "Project", status: "active" }],
        milestones: [],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [],
        decisions: [],
        lastKnownGood: [],
      }),
    );

    expect(detectPccLedgerStorageMigration(env)).toMatchObject({ needed: true });
    const migrated = migrateLegacyPccLedgerStorage(env);

    expect(migrated).toMatchObject({ migrated: true, revision: 1 });
    expect(migrated.backupPath && fs.existsSync(migrated.backupPath)).toBe(true);
    expect(fs.existsSync(pccLedgerSqlitePath(env))).toBe(true);
    expect(readPccLedger(env).projects[0]?.title).toBe("Project");
    expect(pccLedgerRevision(env)).toBe(1);
  });

  it("records each write at a new revision and keeps audit history", () => {
    const env = makeEnv();
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-1",
          title: "Project",
          status: "active",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        });
      },
      { write: true, auditKind: "projects.upsert" },
      env,
    );
    withPccLedger(
      (ledger) => {
        ledger.projects[0].title = "Renamed Project";
      },
      { write: true, auditKind: "projects.rename" },
      env,
    );

    expect(readPccLedger(env).projects[0]?.title).toBe("Renamed Project");
    expect(pccLedgerRevision(env)).toBe(2);
    expect(readPccLedgerBackup(env)).toMatchObject({
      revision: 1,
      ledger: { projects: [{ title: "Project" }] },
    });
    expect(fs.statSync(pccLedgerBackupPath(env)).mode & 0o777).toBe(0o600);
    closePccLedgerStorageForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(pccLedgerSqlitePath(env), { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT revision, event_kind FROM pcc_ledger_audit ORDER BY revision")
        .all() as Array<{ revision: number; event_kind: string }>;
      expect(rows).toEqual([
        { revision: 1, event_kind: "projects.upsert" },
        { revision: 2, event_kind: "projects.rename" },
      ]);
    } finally {
      db.close();
    }
  });

  it("fails closed when the persisted snapshot checksum does not match", () => {
    const env = makeEnv();
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-1",
          title: "Project",
          status: "active",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        });
      },
      { write: true },
      env,
    );
    closePccLedgerStorageForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(pccLedgerSqlitePath(env));
    try {
      db.exec(
        "UPDATE pcc_ledger_snapshot SET payload_json = '{\"version\":1}' WHERE singleton = 1",
      );
    } finally {
      db.close();
    }

    expect(() => readPccLedger(env)).toThrow("checksum mismatch");
  });

  it("allows unrelated writes while preserving unchanged malformed historical receipts", () => {
    const env = makeEnv();
    const malformed = {
      version: 1,
      projects: [],
      milestones: [],
      subMilestones: [],
      permissions: [],
      evidence: [],
      receipts: [
        {
          id: "legacy-receipt",
          projectId: "project-1",
          milestoneId: "milestone-1",
          summary: "Historical proof",
          proofEvidenceIds: ["proof-1"],
          proofLevel: "local",
          createdAt: "2026-07-11T00:00:00.000Z",
        },
      ],
      decisions: [],
      lastKnownGood: [],
    } as unknown as ReturnType<typeof readPccLedger>;
    replacePccLedgerForTest(malformed, env);

    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-1",
          title: "Project",
          status: "active",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        });
      },
      { write: true, auditKind: "projects.upsert" },
      env,
    );

    const stored = readPccLedger(env);
    expect(stored.projects[0]?.id).toBe("project-1");
    expect((stored.receipts[0] as unknown as { completedAt?: string }).completedAt).toBeUndefined();
  });

  it("rejects new or retimestamped receipts with unusable completion timestamps", () => {
    const env = makeEnv();

    expect(() =>
      withPccLedger(
        (ledger) => {
          ledger.receipts.push({
            id: "new-invalid-receipt",
            projectId: "project-1",
            milestoneId: "milestone-1",
            summary: "Invalid",
            proofEvidenceIds: ["proof-1"],
            proofLevel: "local",
            completedAt: "not-a-date",
          });
        },
        { write: true },
        env,
      ),
    ).toThrow("must provide a valid completedAt timestamp");
    expect(pccLedgerRevision(env)).toBeNull();

    expect(() =>
      withPccLedger(
        (ledger) => {
          ledger.receipts.push({
            id: "new-null-receipt",
            projectId: "project-1",
            milestoneId: "milestone-1",
            summary: "Invalid",
            proofEvidenceIds: ["proof-1"],
            proofLevel: "local",
            completedAt: null,
          } as never);
        },
        { write: true },
        env,
      ),
    ).toThrow("must provide a valid completedAt timestamp");
    expect(pccLedgerRevision(env)).toBeNull();

    replacePccLedgerForTest(
      {
        version: 1,
        projects: [],
        milestones: [],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [
          {
            id: "valid-receipt",
            projectId: "project-1",
            milestoneId: "milestone-1",
            summary: "Valid",
            proofEvidenceIds: ["proof-1"],
            proofLevel: "local",
            completedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
        decisions: [],
        lastKnownGood: [],
      },
      env,
    );
    expect(() =>
      withPccLedger(
        (ledger) => {
          ledger.receipts[0].completedAt = "invalid";
        },
        { write: true },
        env,
      ),
    ).toThrow("must provide a valid completedAt timestamp");
    expect(readPccLedger(env).receipts[0]?.completedAt).toBe("2026-07-11T00:00:00.000Z");

    expect(() =>
      withPccLedger(
        (ledger) => {
          ledger.receipts[0].completedAt = null as unknown as string;
        },
        { write: true },
        env,
      ),
    ).toThrow("must provide a valid completedAt timestamp");
    expect(readPccLedger(env).receipts[0]?.completedAt).toBe("2026-07-11T00:00:00.000Z");
  });

  it("rejects a duplicate malformed receipt even when its id and timestamp match history", () => {
    const env = makeEnv();
    replacePccLedgerForTest(
      {
        version: 1,
        projects: [],
        milestones: [],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [
          {
            id: "legacy-receipt",
            projectId: "project-1",
            milestoneId: "milestone-1",
            summary: "Historical",
            proofEvidenceIds: ["proof-1"],
            proofLevel: "local",
          } as never,
        ],
        decisions: [],
        lastKnownGood: [],
      },
      env,
    );

    expect(() =>
      withPccLedger(
        (ledger) => {
          ledger.receipts.push(structuredClone(ledger.receipts[0]));
        },
        { write: true },
        env,
      ),
    ).toThrow("must provide a valid completedAt timestamp");
    expect(readPccLedger(env).receipts).toHaveLength(1);
  });

  it("allows an authoritative valid timestamp to repair a malformed historical receipt", () => {
    const env = makeEnv();
    replacePccLedgerForTest(
      {
        version: 1,
        projects: [],
        milestones: [],
        subMilestones: [],
        permissions: [],
        evidence: [],
        receipts: [
          {
            id: "legacy-receipt",
            projectId: "project-1",
            milestoneId: "milestone-1",
            summary: "Historical",
            proofEvidenceIds: ["proof-1"],
            proofLevel: "local",
          } as never,
        ],
        decisions: [],
        lastKnownGood: [],
      },
      env,
    );

    withPccLedger(
      (ledger) => {
        ledger.receipts[0].completedAt = "2026-07-11T01:02:03Z";
      },
      { write: true, auditKind: "receipt.authoritative-timestamp-repair" },
      env,
    );

    expect(readPccLedger(env).receipts[0]?.completedAt).toBe("2026-07-11T01:02:03Z");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import {
  closePccLedgerStorageForTest,
  detectPccLedgerStorageMigration,
  migrateLegacyPccLedgerStorage,
  pccLedgerJsonPath,
  pccLedgerRevision,
  pccLedgerSqlitePath,
  readPccLedger,
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
});

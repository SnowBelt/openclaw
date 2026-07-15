import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupSelfImprovementLedger,
  deleteSelfImprovementLedgerRows,
  inspectSelfImprovementLedgerIntegrity,
  listSelfImprovementLedgerRows,
  readSelfImprovementLedgerMetadata,
  replaceSelfImprovementLedgerRows,
  resolveSelfImprovementLedgerPath,
  stableSelfImprovementLedgerJson,
  upsertSelfImprovementLedgerRows,
  writeSelfImprovementLedgerMetadata,
} from "./ledger.js";

const temporaryDirectories: string[] = [];

async function temporaryStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sig-ledger-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe("Self-Improvement SQLite ledger", () => {
  it("keeps missing-ledger reads side-effect free", async () => {
    const stateDir = await temporaryStateDir();
    const ledgerPath = resolveSelfImprovementLedgerPath(stateDir);

    await expect(
      listSelfImprovementLedgerRows({ stateDir, collection: "recommendations" }),
    ).resolves.toEqual([]);
    await expect(readSelfImprovementLedgerMetadata({ stateDir, key: "migration" })).resolves.toBe(
      null,
    );
    await expect(inspectSelfImprovementLedgerIntegrity({ stateDir })).resolves.toMatchObject({
      exists: false,
      ok: true,
    });
    await expect(fs.stat(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores one canonical collection without affecting another", async () => {
    const stateDir = await temporaryStateDir();
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "recommendations",
      rows: [
        { id: "sir_b", createdAt: 1, updatedAt: 2, nested: { b: 2, a: 1 } },
        { id: "sir_a", createdAt: 1, updatedAt: 3, nested: { a: 1, b: 2 } },
      ],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "proposals",
      rows: [{ id: "sip_a", createdAt: 4, updatedAt: 4 }],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });

    const recommendations = await listSelfImprovementLedgerRows<{ id: string }>({
      stateDir,
      collection: "recommendations",
    });
    const proposals = await listSelfImprovementLedgerRows<{ id: string }>({
      stateDir,
      collection: "proposals",
    });

    expect(recommendations.map((entry) => entry.id)).toEqual(["sir_a", "sir_b"]);
    expect(recommendations[0]?.payloadHash).not.toBe(recommendations[1]?.payloadHash);
    expect(stableSelfImprovementLedgerJson({ nested: { b: 2, a: 1 } })).toBe(
      stableSelfImprovementLedgerJson({ nested: { a: 1, b: 2 } }),
    );
    expect(proposals.map((entry) => entry.id)).toEqual(["sip_a"]);
    await expect(fs.stat(resolveSelfImprovementLedgerPath(stateDir))).resolves.toBeDefined();
  });

  it("replaces only the requested collection and writes metadata", async () => {
    const stateDir = await temporaryStateDir();
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "audit_events",
      rows: [{ id: "sie_old", createdAt: 1, updatedAt: 1 }],
      id: (entry) => entry.id,
    });
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "audit_events",
      rows: [{ id: "sie_new", createdAt: 2, updatedAt: 2 }],
      id: (entry) => entry.id,
    });
    await writeSelfImprovementLedgerMetadata({
      stateDir,
      key: "migration",
      value: { source: "json", complete: false },
      now: 3,
    });

    await expect(
      listSelfImprovementLedgerRows<{ id: string }>({ stateDir, collection: "audit_events" }),
    ).resolves.toMatchObject([{ id: "sie_new" }]);
    await expect(
      readSelfImprovementLedgerMetadata({ stateDir, key: "migration" }),
    ).resolves.toEqual({
      complete: false,
      source: "json",
    });
  });

  it("rejects duplicate collection identifiers and keeps canonical JSON stable", async () => {
    const stateDir = await temporaryStateDir();
    expect(stableSelfImprovementLedgerJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableSelfImprovementLedgerJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    await expect(
      replaceSelfImprovementLedgerRows({
        stateDir,
        collection: "signals",
        rows: [{ id: "duplicate" }, { id: "duplicate" }],
        id: (entry) => entry.id,
      }),
    ).rejects.toThrow("duplicate ids");
  });

  it("upserts and deletes selected rows without replacing siblings", async () => {
    const stateDir = await temporaryStateDir();
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "signals",
      rows: [
        { id: "signal_a", createdAt: 1, updatedAt: 1, value: "old" },
        { id: "signal_b", createdAt: 2, updatedAt: 2, value: "kept" },
      ],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });

    await upsertSelfImprovementLedgerRows({
      stateDir,
      collection: "signals",
      rows: [
        { id: "signal_a", createdAt: 1, updatedAt: 3, value: "new" },
        { id: "signal_c", createdAt: 3, updatedAt: 3, value: "added" },
      ],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });
    await expect(
      listSelfImprovementLedgerRows<{ id: string; value: string }>({
        stateDir,
        collection: "signals",
      }),
    ).resolves.toMatchObject([
      { id: "signal_a", value: { value: "new" } },
      { id: "signal_c", value: { value: "added" } },
      { id: "signal_b", value: { value: "kept" } },
    ]);

    await expect(
      deleteSelfImprovementLedgerRows({ stateDir, collection: "signals", ids: ["signal_b"] }),
    ).resolves.toBe(1);
    await expect(
      listSelfImprovementLedgerRows<{ id: string }>({ stateDir, collection: "signals" }),
    ).resolves.toMatchObject([{ id: "signal_a" }, { id: "signal_c" }]);
  });

  it("creates an integrity-checked backup that can be read independently", async () => {
    const stateDir = await temporaryStateDir();
    const backupPath = path.join(stateDir, "backups", "ledger.sqlite");
    await replaceSelfImprovementLedgerRows({
      stateDir,
      collection: "recommendations",
      rows: [{ id: "sir_backup", createdAt: 1, updatedAt: 2, status: "assigned" }],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });

    const report = await backupSelfImprovementLedger({ stateDir, backupPath, now: 3 });

    expect(report).toMatchObject({
      backupPath,
      createdAt: 3,
      integrity: { exists: true, ok: true, schemaVersion: 1 },
    });
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      listSelfImprovementLedgerRows<{ status: string }>({
        ledgerPath: backupPath,
        collection: "recommendations",
      }),
    ).resolves.toMatchObject([{ id: "sir_backup", value: { status: "assigned" } }]);
  });
});

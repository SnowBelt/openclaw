import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSelfImprovementJsonToSqliteMigration } from "./ledger-migration.js";
import { listSelfImprovementLedgerRows } from "./ledger.js";

const temporaryDirectories: string[] = [];

async function temporaryStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sig-migration-"));
  temporaryDirectories.push(directory);
  await fs.mkdir(path.join(directory, "self-improvement"), { recursive: true });
  return directory;
}

async function writeJson(stateDir: string, filename: string, value: unknown): Promise<void> {
  await fs.writeFile(path.join(stateDir, "self-improvement", filename), JSON.stringify(value));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe("Self-Improvement JSON-to-SQLite migration", () => {
  it("reports parity without creating a ledger during dry run", async () => {
    const stateDir = await temporaryStateDir();
    await writeJson(stateDir, "recommendations.json", {
      version: 3,
      recommendations: [{ id: "sir_1", status: "assigned", createdAt: 1, updatedAt: 2 }],
    });

    const report = await runSelfImprovementJsonToSqliteMigration({ stateDir, now: 10 });

    expect(report.dryRun).toBe(true);
    expect(report.collections.find((entry) => entry.collection === "recommendations")?.ids).toEqual(
      ["sir_1"],
    );
    await expect(fs.stat(report.ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("backs up sources, preserves payloads, and verifies one-way parity", async () => {
    const stateDir = await temporaryStateDir();
    const backupDirectory = path.join(stateDir, "exports", "20260710T000000Z");
    const recommendation = {
      id: "sir_1",
      status: "assigned",
      resolutionProof: "proof stays intact",
      createdAt: 1,
      updatedAt: 2,
    };
    await writeJson(stateDir, "recommendations.json", {
      version: 3,
      recommendations: [recommendation],
    });
    await writeJson(stateDir, "proposals.json", {
      version: 1,
      proposals: [{ id: "sip_1", status: "acknowledged", createdAt: 3, updatedAt: 4 }],
    });

    const report = await runSelfImprovementJsonToSqliteMigration({
      stateDir,
      backupDirectory,
      apply: true,
      now: 10,
    });

    expect(report.applied).toBe(true);
    expect(report.parity).toEqual({
      idsMatch: true,
      payloadHashesMatch: true,
      statusesPreserved: true,
    });
    await expect(
      fs.readFile(path.join(backupDirectory, "recommendations.json"), "utf8"),
    ).resolves.toContain("proof stays intact");
    await expect(
      listSelfImprovementLedgerRows<{ status: string; resolutionProof: string }>({
        stateDir,
        collection: "recommendations",
      }),
    ).resolves.toMatchObject([
      { id: "sir_1", value: { status: "assigned", resolutionProof: "proof stays intact" } },
    ]);
    await expect(
      runSelfImprovementJsonToSqliteMigration({ stateDir, backupDirectory, apply: true, now: 11 }),
    ).rejects.toThrow("already applied");
  });
});

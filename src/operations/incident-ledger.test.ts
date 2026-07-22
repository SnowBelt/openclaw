import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import {
  closeOperationsIncidentLedgerForTests,
  OPERATIONS_INCIDENT_TOMBSTONE_RETENTION_MS,
  reconcileOperationsIncidentLedger,
  resolveOperationsIncidentLedgerPath,
} from "./incident-ledger.js";
import type { OperationsFinding } from "./types.js";

const tempDirs: string[] = [];

function finding(
  id: string,
  severity: OperationsFinding["severity"] = "warning",
): OperationsFinding {
  return {
    id,
    severity,
    category: "workflow",
    title: `Finding ${id}`,
    detail: `Sensitive detail for ${id}`,
    lastObservedAt: 0,
    disposition: severity === "info" ? "historical" : "watching",
    responseState: severity === "info" ? "resolved" : "monitoring",
    impact: "A bounded operational impact.",
  };
}

function createLedgerPath(): string {
  const stateDir = makeTempDir(tempDirs, "operations-incident-ledger-");
  return resolveOperationsIncidentLedgerPath(stateDir);
}

function readTombstoneIds(ledgerPath: string): string[] {
  closeOperationsIncidentLedgerForTests(ledgerPath);
  const sqlite = requireNodeSqlite();
  const database = new sqlite.DatabaseSync(ledgerPath);
  const rows = database
    .prepare("SELECT incident_id FROM operations_incident_tombstones ORDER BY incident_id ASC")
    .all() as Array<{ incident_id: string }>;
  database.close();
  return rows.map((row) => row.incident_id);
}

afterEach(() => {
  closeOperationsIncidentLedgerForTests();
  cleanupTempDirs(tempDirs);
});

describe("Operations incident ledger", () => {
  it("preserves first observed time and severity transitions across restart", () => {
    const ledgerPath = createLedgerPath();
    const first = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:one")],
      now: 100,
      options: { ledgerPath },
    });
    expect(first.findings[0]).toMatchObject({ firstObservedAt: 100, lastObservedAt: 100 });

    closeOperationsIncidentLedgerForTests(ledgerPath);
    const restarted = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:one", "critical")],
      now: 200,
      options: { ledgerPath },
    });

    expect(restarted.findings[0]).toMatchObject({ firstObservedAt: 100, lastObservedAt: 200 });
    expect(restarted.history[0]?.transitions).toEqual([
      { at: 100, to: "warning" },
      { at: 200, from: "warning", to: "critical" },
    ]);
  });

  it("persists same-severity reopen evidence across restart", () => {
    const ledgerPath = createLedgerPath();
    reconcileOperationsIncidentLedger({
      findings: [finding("workflow:reopened")],
      now: 100,
      options: { ledgerPath },
    });
    reconcileOperationsIncidentLedger({
      findings: [],
      now: 200,
      options: { ledgerPath },
    });
    closeOperationsIncidentLedgerForTests(ledgerPath);

    const reopened = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:reopened")],
      now: 300,
      options: { ledgerPath },
    });

    expect(reopened.findings[0]).toMatchObject({
      firstObservedAt: 100,
      lastObservedAt: 300,
    });
    expect(reopened.findings[0]?.resolvedAt).toBeUndefined();
    expect(reopened.history[0]?.firstObservedAt).toBe(100);
    expect(reopened.history[0]?.transitions).toEqual([
      { at: 100, to: "warning" },
      { at: 300, from: "warning", to: "warning" },
    ]);
    expect(reopened.recurrences).toEqual([{ incidentId: "workflow:reopened", reopenedAt: 300 }]);

    const observedAgain = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:reopened")],
      now: 400,
      options: { ledgerPath },
    });
    expect(observedAgain.findings[0]?.firstObservedAt).toBe(100);
    expect(observedAgain.history[0]?.transitions).toHaveLength(2);
    expect(observedAgain.recurrences).toEqual([]);
  });

  it("resolves missing incidents and prunes resolved history by retention and bound", () => {
    const ledgerPath = createLedgerPath();
    reconcileOperationsIncidentLedger({
      findings: [finding("one"), finding("two"), finding("three")],
      now: 100,
      options: { ledgerPath, maxEntries: 3 },
    });
    const resolved = reconcileOperationsIncidentLedger({
      findings: [],
      now: 200,
      options: { ledgerPath, maxEntries: 3 },
    });
    expect(resolved.history).toHaveLength(3);
    expect(resolved.history.every((entry) => entry.resolvedAt === 200)).toBe(true);

    const retained = reconcileOperationsIncidentLedger({
      findings: [finding("four")],
      now: 250,
      options: { ledgerPath, maxEntries: 3 },
    });
    expect(retained.history).toHaveLength(3);
    expect(retained.history.some((entry) => entry.id === "four")).toBe(true);

    reconcileOperationsIncidentLedger({
      findings: [],
      now: 1_000,
      options: { ledgerPath, maxEntries: 3, resolvedRetentionMs: 100 },
    });
    const expired = reconcileOperationsIncidentLedger({
      findings: [],
      now: 1_101,
      options: { ledgerPath, maxEntries: 3, resolvedRetentionMs: 100 },
    });
    expect(expired.history).toEqual([]);
  });

  it("applies a deterministic hard bound when active incidents overflow capacity", () => {
    const ledgerPath = createLedgerPath();
    const result = reconcileOperationsIncidentLedger({
      findings: [finding("one"), finding("two"), finding("three")],
      now: 100,
      options: { ledgerPath, maxEntries: 2 },
    });

    expect(result.overflowCount).toBe(1);
    expect(result.findings.map((entry) => entry.id)).toEqual(["one", "two"]);
    expect(result.history.map((entry) => entry.id).toSorted()).toEqual(["one", "two"]);
  });

  it("reserves bounded history for a newly resolved incident when active incidents fill the preview", () => {
    const ledgerPath = createLedgerPath();
    const active = Array.from({ length: 200 }, (_, index) => finding(`active-${index}`));
    const resolved = finding("newly-resolved");
    reconcileOperationsIncidentLedger({
      findings: [...active, resolved],
      now: 100,
      authoritativeCategories: ["workflow"],
      options: { ledgerPath },
    });

    const result = reconcileOperationsIncidentLedger({
      findings: active,
      now: 200,
      authoritativeCategories: ["workflow"],
      options: { ledgerPath },
    });

    expect(result.historyTotal).toBe(201);
    expect(result.history).toHaveLength(200);
    expect(result.history).toContainEqual(
      expect.objectContaining({ id: "newly-resolved", resolvedAt: 200 }),
    );
    expect(result.history.filter((entry) => entry.resolvedAt == null)).toHaveLength(199);
  });

  it("keeps a hard bound across changing non-authoritative active membership", () => {
    const ledgerPath = createLedgerPath();
    const first = reconcileOperationsIncidentLedger({
      findings: [finding("one"), finding("two"), finding("three")],
      now: 100,
      authoritativeCategories: [],
      options: { ledgerPath, maxEntries: 2 },
    });
    expect(first.historyTotal).toBe(2);
    expect(first.overflowCount).toBe(1);
    expect(first.history.map((entry) => entry.id)).toEqual(["one", "two"]);

    const second = reconcileOperationsIncidentLedger({
      findings: [finding("three"), finding("four"), finding("five")],
      now: 200,
      authoritativeCategories: [],
      options: { ledgerPath, maxEntries: 2 },
    });
    expect(second.historyTotal).toBe(2);
    expect(second.overflowCount).toBe(3);
    expect(second.findings.map((entry) => entry.id)).toEqual(["three", "four"]);
    expect(second.history.map((entry) => entry.id)).toEqual(["four", "three"]);

    const third = reconcileOperationsIncidentLedger({
      findings: [finding("five"), finding("six")],
      now: 300,
      authoritativeCategories: [],
      options: { ledgerPath, maxEntries: 2 },
    });
    expect(third.historyTotal).toBe(2);
    expect(third.overflowCount).toBe(2);
    expect(third.findings.map((entry) => entry.id)).toEqual(["five", "six"]);
    expect(third.history.map((entry) => entry.id)).toEqual(["five", "six"]);
  });

  it("tombstones resolved incidents evicted by capacity so they cannot resurrect", () => {
    const ledgerPath = createLedgerPath();
    const alpha = finding("workflow:alpha", "info");
    const beta = finding("workflow:beta", "info");
    reconcileOperationsIncidentLedger({
      findings: [alpha, beta],
      now: 100,
      options: { ledgerPath, maxEntries: 2 },
    });

    const overflow = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:active", "critical"), alpha, beta],
      now: 200,
      authoritativeCategories: [],
      options: { ledgerPath, maxEntries: 2 },
    });
    expect(overflow.overflowCount).toBe(1);
    expect(overflow.history.map((entry) => entry.id).toSorted()).toEqual([
      "workflow:active",
      "workflow:alpha",
    ]);
    expect(readTombstoneIds(ledgerPath)).toEqual(["workflow:beta"]);

    const suppressed = reconcileOperationsIncidentLedger({
      findings: [beta],
      now: 300,
      authoritativeCategories: [],
      options: { ledgerPath, maxEntries: 2 },
    });
    expect(suppressed.findings).toEqual([]);
    expect(suppressed.suppressedFindingIds).toEqual(["workflow:beta"]);
  });

  it("durably suppresses expired historical incidents instead of resurrecting them", () => {
    const ledgerPath = createLedgerPath();
    reconcileOperationsIncidentLedger({
      findings: [finding("workflow:expired", "info")],
      now: 100,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });

    const expired = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:expired", "info")],
      now: 201,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(expired.findings).toEqual([]);
    expect(expired.history).toEqual([]);
    expect(expired.historyTotal).toBe(0);
    expect(expired.overflowCount).toBe(0);
    expect(expired.suppressedFindingIds).toEqual(["workflow:expired"]);

    closeOperationsIncidentLedgerForTests(ledgerPath);
    const suppressedAfterRestart = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:expired", "info")],
      now: 300,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(suppressedAfterRestart.findings).toEqual([]);
    expect(suppressedAfterRestart.history).toEqual([]);
    expect(suppressedAfterRestart.historyTotal).toBe(0);
    expect(suppressedAfterRestart.overflowCount).toBe(0);
    expect(suppressedAfterRestart.suppressedFindingIds).toEqual(["workflow:expired"]);

    const activeRecurrence = reconcileOperationsIncidentLedger({
      findings: [finding("workflow:expired")],
      now: 400,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(activeRecurrence.findings[0]).toMatchObject({
      id: "workflow:expired",
      firstObservedAt: 400,
      lastObservedAt: 400,
    });
    expect(activeRecurrence.history[0]?.resolvedAt).toBeUndefined();
    expect(activeRecurrence.suppressedFindingIds).toEqual([]);
  });

  it("reports suppressed IDs deterministically and prunes tombstones after authoritative absence", () => {
    const ledgerPath = createLedgerPath();
    const historical = [finding("workflow:alpha", "info"), finding("workflow:beta", "info")];
    reconcileOperationsIncidentLedger({
      findings: historical,
      now: 100,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    reconcileOperationsIncidentLedger({
      findings: historical,
      now: 201,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });

    const suppressed = reconcileOperationsIncidentLedger({
      findings: [historical[1]!, historical[0]!, historical[1]!],
      now: 202,
      authoritativeCategories: [],
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(suppressed.findings).toEqual([]);
    expect(suppressed.suppressedFindingIds).toEqual(["workflow:alpha", "workflow:beta"]);
    expect(readTombstoneIds(ledgerPath)).toEqual(["workflow:alpha", "workflow:beta"]);

    reconcileOperationsIncidentLedger({
      findings: [],
      now: 203,
      authoritativeCategories: [],
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(readTombstoneIds(ledgerPath)).toEqual(["workflow:alpha", "workflow:beta"]);

    reconcileOperationsIncidentLedger({
      findings: [],
      now: 204,
      authoritativeCategories: ["workflow"],
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(readTombstoneIds(ledgerPath)).toEqual([]);
  });

  it("retains an observed tombstone and bounds an unavailable source to 30 days", () => {
    const ledgerPath = createLedgerPath();
    const historical = finding("workflow:retained", "info");
    reconcileOperationsIncidentLedger({
      findings: [historical],
      now: 100,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    reconcileOperationsIncidentLedger({
      findings: [historical],
      now: 201,
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });

    const refreshedAt = 202 + OPERATIONS_INCIDENT_TOMBSTONE_RETENTION_MS;
    const stillSuppressed = reconcileOperationsIncidentLedger({
      findings: [historical],
      now: refreshedAt,
      authoritativeCategories: [],
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(stillSuppressed.suppressedFindingIds).toEqual(["workflow:retained"]);
    expect(readTombstoneIds(ledgerPath)).toEqual(["workflow:retained"]);

    reconcileOperationsIncidentLedger({
      findings: [],
      now: refreshedAt + OPERATIONS_INCIDENT_TOMBSTONE_RETENTION_MS,
      authoritativeCategories: [],
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(readTombstoneIds(ledgerPath)).toEqual(["workflow:retained"]);

    reconcileOperationsIncidentLedger({
      findings: [],
      now: refreshedAt + OPERATIONS_INCIDENT_TOMBSTONE_RETENTION_MS + 1,
      authoritativeCategories: [],
      options: { ledgerPath, resolvedRetentionMs: 100 },
    });
    expect(readTombstoneIds(ledgerPath)).toEqual([]);
  });

  it("does not resolve incidents whose category was not authoritatively observed", () => {
    const ledgerPath = createLedgerPath();
    reconcileOperationsIncidentLedger({
      findings: [finding("workflow:partial")],
      now: 100,
      options: { ledgerPath },
    });

    const partial = reconcileOperationsIncidentLedger({
      findings: [],
      now: 200,
      authoritativeCategories: ["cron"],
      options: { ledgerPath },
    });
    expect(partial.history[0]).toMatchObject({ id: "workflow:partial" });
    expect(partial.history[0]?.resolvedAt).toBeUndefined();
    expect(partial.carriedFindings).toEqual([
      expect.objectContaining({
        id: "workflow:partial",
        severity: "warning",
        disposition: "watching",
        responseState: "monitoring",
        ownerId: "OpenClaw",
        nextAction: "Restore source visibility before resolving or dismissing this incident.",
        firstObservedAt: 100,
        lastObservedAt: 100,
      }),
    ]);

    const authoritative = reconcileOperationsIncidentLedger({
      findings: [],
      now: 300,
      authoritativeCategories: ["workflow"],
      options: { ledgerPath },
    });
    expect(authoritative.history[0]).toMatchObject({
      id: "workflow:partial",
      resolvedAt: 300,
    });
    expect(authoritative.carriedFindings).toEqual([]);
  });

  it("repairs malformed transition JSON without exposing finding details", () => {
    const ledgerPath = createLedgerPath();
    reconcileOperationsIncidentLedger({
      findings: [finding("corrupt")],
      now: 100,
      options: { ledgerPath },
    });
    closeOperationsIncidentLedgerForTests(ledgerPath);

    const sqlite = requireNodeSqlite();
    const database = new sqlite.DatabaseSync(ledgerPath);
    database
      .prepare("UPDATE operations_incidents SET transitions_json = ? WHERE incident_id = ?")
      .run("{not-json", "corrupt");
    const columns = database.prepare("PRAGMA table_info(operations_incidents)").all() as Array<{
      name: string;
    }>;
    database.close();

    const repaired = reconcileOperationsIncidentLedger({
      findings: [finding("corrupt", "critical")],
      now: 200,
      options: { ledgerPath },
    });
    expect(repaired.history[0]?.transitions).toEqual([
      { at: 100, to: "warning" },
      { at: 200, from: "warning", to: "critical" },
    ]);
    expect(columns.map((entry) => entry.name)).not.toContain("detail");
    expect(fs.statSync(ledgerPath).mode & 0o777).toBe(0o600);
    expect(path.basename(ledgerPath)).toBe("incident-ledger.sqlite");
  });
});

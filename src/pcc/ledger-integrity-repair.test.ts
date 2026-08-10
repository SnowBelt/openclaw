import { describe, expect, it } from "vitest";
import type { PccLedger } from "./domain/ledger.js";
import { repairPccLedgerIntegrity } from "./ledger-integrity-repair.js";

function ledgerFixture(): PccLedger {
  return {
    version: 1,
    projects: [
      {
        id: "project-command-center",
        title: "Project Command Center",
        goal: "PCC",
        status: "complete_with_maintenance",
        priority: 5,
        owner: "OpenClaw",
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      },
    ],
    milestones: [
      {
        id: "legacy-milestone",
        projectId: "project-command-center",
        title: "Legacy milestone",
        status: "complete",
        order: 0,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      },
      {
        id: "pcc-production-governor-runtime-proof",
        projectId: "project-command-center",
        title: "Production Governor proof",
        status: "complete",
        order: 1,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      },
    ],
    subMilestones: [],
    permissions: [],
    evidence: [
      {
        id: "legacy-proof",
        projectId: "project-command-center",
        milestoneId: "legacy-milestone",
        kind: "receipt",
        status: "passed",
        summary: "Historical proof",
        source: "PCC migration fixture",
        createdAt: "2026-07-25T00:00:00.000Z",
      },
      {
        id: "release-governor-proof",
        projectId: "project-command-center",
        milestoneId: "missing-release-milestone",
        kind: "receipt",
        status: "passed",
        summary: "Release proof",
        source: "PCC Release Governor",
        createdAt: "2026-07-25T00:00:00.000Z",
      },
    ],
    receipts: [
      {
        id: "legacy-receipt",
        projectId: "project-command-center",
        milestoneId: "legacy-milestone",
        summary: "Legacy receipt",
        proofLevel: "local",
        completedBy: "OpenClaw",
        completedAt: "2026-07-25T00:00:00.000Z",
        evidenceIds: ["legacy-proof"],
      } as unknown as PccLedger["receipts"][number],
      {
        id: "release-governor-receipt-proof",
        projectId: "project-command-center",
        milestoneId: "missing-release-milestone",
        summary: "Release receipt",
        proofEvidenceIds: ["release-governor-proof"],
        proofLevel: "production",
        completedBy: "PCC Release Governor",
        completedAt: "2026-07-25T00:00:00.000Z",
      },
    ],
    decisions: [],
    lastKnownGood: [],
  };
}

describe("repairPccLedgerIntegrity", () => {
  it("canonicalizes legacy receipt evidence and rebinds Release Governor records", () => {
    const ledger = ledgerFixture();
    const first = repairPccLedgerIntegrity(ledger);

    expect(first.changes).toHaveLength(3);
    expect(ledger.receipts[0]?.proofEvidenceIds).toEqual(["legacy-proof"]);
    expect(ledger.evidence[1]?.milestoneId).toBe("pcc-production-governor-runtime-proof");
    expect(ledger.receipts[1]?.milestoneId).toBe("pcc-production-governor-runtime-proof");
    expect(repairPccLedgerIntegrity(ledger).changes).toEqual([]);
  });

  it("reports unusable historical timestamps without inventing replacements", () => {
    const ledger = ledgerFixture();
    const missing = ledger.receipts[0] as unknown as { completedAt?: string; createdAt?: string };
    delete missing.completedAt;
    missing.createdAt = "2026-07-25T01:00:00.000Z";
    ledger.modelRunReceipts = [
      {
        id: "invalid-model-run",
        projectId: "project-command-center",
        sourceRunId: "run-1",
        executor: "local",
        purpose: "qa",
        provider: "local",
        model: "test-model",
        status: "succeeded",
        startedAt: "2026-07-25T01:00:00.000Z",
        completedAt: "not-a-date",
        usageSource: "unavailable",
      },
    ];

    const result = repairPccLedgerIntegrity(ledger);

    expect(result.issues).toEqual([
      {
        code: "receipt_completed_at_missing",
        collection: "receipts",
        recordId: "legacy-receipt",
        projectId: "project-command-center",
        field: "completedAt",
      },
      {
        code: "receipt_completed_at_invalid",
        collection: "modelRunReceipts",
        recordId: "invalid-model-run",
        projectId: "project-command-center",
        field: "completedAt",
      },
    ]);
    expect(missing.completedAt).toBeUndefined();
    expect(missing.createdAt).toBe("2026-07-25T01:00:00.000Z");
  });
});

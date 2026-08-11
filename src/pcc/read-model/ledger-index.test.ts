import { describe, expect, it } from "vitest";
import type { PccLedger } from "../domain/ledger.js";
import { buildPccLedgerReadIndex } from "./ledger-index.js";

const timestamp = "2026-07-15T12:00:00.000Z";

function ledgerFixture(): PccLedger {
  return {
    version: 1,
    projects: [
      {
        id: "project-1",
        title: "Project One",
        status: "active",
        priority: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "project-2",
        title: "Project Two",
        status: "active",
        priority: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    milestones: [
      {
        id: "milestone-1",
        projectId: "project-1",
        title: "First milestone",
        status: "active",
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "milestone-2",
        projectId: "project-2",
        title: "Second milestone",
        status: "active",
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    subMilestones: [
      {
        id: "submilestone-1",
        projectId: "project-1",
        milestoneId: "milestone-1",
        title: "First sub-milestone",
        status: "active",
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "submilestone-cross-project",
        projectId: "project-2",
        milestoneId: "milestone-1",
        title: "Mismatched sub-milestone",
        status: "active",
        order: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    permissions: [
      {
        id: "permission-1",
        projectId: "project-1",
        type: "local_proof",
        status: "granted",
        riskLevel: "low",
        allowedActions: ["run tests"],
        usedCount: 0,
        auditLog: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        projectId: "project-1",
        milestoneId: "milestone-1",
        kind: "local_test",
        status: "passed",
        summary: "Passed",
        createdAt: timestamp,
      },
    ],
    receipts: [
      {
        id: "receipt-1",
        projectId: "project-1",
        milestoneId: "milestone-1",
        summary: "Complete",
        completedAt: timestamp,
        proofLevel: "local",
        proofEvidenceIds: ["evidence-1"],
      },
    ],
    decisions: [
      {
        id: "decision-1",
        projectId: "project-1",
        title: "Proceed",
        summary: "Proceed",
        decidedAt: timestamp,
      },
    ],
    lastKnownGood: [
      {
        id: "lkg-1",
        projectId: "project-1",
        subsystem: "PCC",
        summary: "Healthy",
        evidenceIds: ["evidence-1"],
        verifiedAt: timestamp,
      },
    ],
  };
}

describe("PCC ledger read index", () => {
  it("indexes project and relationship lookups in one stable snapshot", () => {
    const ledger = ledgerFixture();
    const index = buildPccLedgerReadIndex(ledger);

    expect(index.milestonesByProjectId.get("project-1")).toEqual([ledger.milestones[0]]);
    expect(index.milestonesById.get("milestone-2")).toBe(ledger.milestones[1]);
    expect(index.subMilestonesByProjectId.get("project-1")).toEqual([ledger.subMilestones[0]]);
    expect(index.subMilestonesByMilestoneId.get("milestone-1")).toEqual(ledger.subMilestones);
    expect(index.subMilestonesById.get("submilestone-1")).toBe(ledger.subMilestones[0]);
    expect(index.mismatchedSubMilestonesByParentProjectId.get("project-1")).toEqual([
      ledger.subMilestones[1],
    ]);
    expect(index.permissionsByProjectId.get("project-1")).toEqual(ledger.permissions);
    expect(index.evidenceById.get("evidence-1")).toBe(ledger.evidence[0]);
    expect(index.evidenceByProjectId.get("project-1")).toEqual(ledger.evidence);
    expect(index.receiptsByMilestoneId.get("milestone-1")).toEqual(ledger.receipts);
    expect(index.receiptsByProjectId.get("project-1")).toEqual(ledger.receipts);
    expect(index.decisionsByProjectId.get("project-1")).toEqual(ledger.decisions);
    expect(index.lastKnownGoodByProjectId.get("project-1")).toEqual(ledger.lastKnownGood);
    expect(index.milestonesByProjectId.get("missing")).toBeUndefined();
  });
});

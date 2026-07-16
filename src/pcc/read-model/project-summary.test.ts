import { describe, expect, it } from "vitest";
import type { PccLedger } from "../domain/ledger.js";
import { buildPccLedgerReadIndex } from "./ledger-index.js";
import { summarizePccPortfolio, summarizePccProject } from "./project-summary.js";

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
        metadata: {
          dueDate: "2999-01-01T00:00:00.000Z",
          pccWorkflowTemplateId: "software-product",
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "project-2",
        title: "Archived Project",
        status: "archived",
        priority: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    milestones: [
      {
        id: "milestone-complete",
        projectId: "project-1",
        title: "Completed milestone",
        status: "complete",
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "milestone-blocked",
        projectId: "project-1",
        title: "Blocked milestone",
        status: "blocked",
        blocker: "Waiting for dependency",
        order: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    subMilestones: [
      {
        id: "sub-complete",
        projectId: "project-1",
        milestoneId: "milestone-complete",
        title: "Complete child",
        status: "complete",
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    permissions: [],
    evidence: [
      {
        id: "evidence-1",
        projectId: "project-1",
        milestoneId: "milestone-complete",
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
        milestoneId: "milestone-complete",
        summary: "Complete",
        completedAt: timestamp,
        proofLevel: "local",
        proofEvidenceIds: ["evidence-1"],
      },
    ],
    decisions: [],
    lastKnownGood: [],
  };
}

describe("PCC project summary read model", () => {
  it("builds project and portfolio summaries without gateway dependencies", () => {
    const ledger = ledgerFixture();
    const index = buildPccLedgerReadIndex(ledger);
    const project = summarizePccProject(ledger, ledger.projects[0], index);
    const portfolio = summarizePccPortfolio(ledger, index);

    expect(project).toMatchObject({
      id: "project-1",
      percentComplete: 50,
      milestoneCounts: {
        total: 2,
        complete: 1,
        blocked: 1,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      health: "Blocked",
      dueDate: "2999-01-01T00:00:00.000Z",
      workflowTemplateId: "software-product",
      pccWorkScope: "project_work",
      proofGaps: [],
    });
    expect(project.nextActions).toEqual(["Blocked milestone: Waiting for dependency"]);
    expect(portfolio).toMatchObject({
      projectsTotal: 2,
      active: 1,
      needsAttention: 1,
      complete: 0,
      archived: 1,
      averagePercentComplete: 25,
    });
  });

  it("keeps integrity failures and missing receipts visible", () => {
    const ledger = ledgerFixture();
    ledger.receipts = [];
    ledger.milestones[0] = {
      ...ledger.milestones[0],
      dependsOn: ["missing-milestone"],
    };

    const summary = summarizePccProject(ledger, ledger.projects[0]);

    expect(summary.proofGaps).toContain(
      "Integrity issue: milestone dependency is missing: Completed milestone -> missing-milestone",
    );
    expect(summary.proofGaps).toContain("Completion receipt missing for Completed milestone");
  });
});

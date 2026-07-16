import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ProtocolSchemas,
  validatePccDecisionsAddParams,
  validatePccMilestonesUpsertParams,
  validatePccPermissionsUpsertParams,
  validatePccProjectsUpsertParams,
  validatePccReceiptsAddParams,
  validatePccSubMilestonesListParams,
  validatePccSubMilestonesUpsertParams,
} from "../index.js";
import { PccProjectSummarySchema, PccSummaryGetResultSchema } from "./pcc.js";

describe("Project Command Center protocol schemas", () => {
  it("registers canonical PCC schemas", () => {
    expect(ProtocolSchemas.PccProject).toBeTruthy();
    expect(ProtocolSchemas.PccMilestone).toBeTruthy();
    expect(ProtocolSchemas.PccSubMilestone).toBeTruthy();
    expect(ProtocolSchemas.PccPermissionGrant).toBeTruthy();
    expect(ProtocolSchemas.PccCompletionReceipt).toBeTruthy();
    expect(ProtocolSchemas.PccDecision).toBeTruthy();
    expect(ProtocolSchemas.PccDecisionsAddParams).toBeTruthy();
    expect(ProtocolSchemas.PccLastKnownGoodUpsertParams).toBeTruthy();
  });

  it("validates project and milestone upsert params", () => {
    expect(
      validatePccProjectsUpsertParams({
        project: {
          title: "Project Command Center",
          status: "active",
          phases: [{ id: "mvp", title: "MVP", status: "in_progress", weight: 30 }],
        },
      }),
    ).toBe(true);

    expect(
      validatePccMilestonesUpsertParams({
        milestone: {
          projectId: "project-pcc",
          title: "Ledger foundation",
          status: "proof_pending",
          implementationPlan: "Implement the schema, store, API, and tests.",
          acceptanceCriteria: ["Local tests pass", "Completion receipt exists"],
        },
      }),
    ).toBe(true);

    expect(validatePccMilestonesUpsertParams({ milestone: { projectId: "p" } })).toBe(false);
  });

  it("allows PCC summary scope labels", () => {
    const summary = {
      id: "project-command-center",
      title: "Project Command Center",
      status: "complete_with_maintenance",
      percentComplete: 100,
      milestoneCounts: {
        total: 1,
        complete: 1,
        blocked: 0,
        needsApproval: 0,
        deferred: 0,
        skipped: 0,
      },
      nextActions: [],
      proofGaps: [],
      pccWorkScope: "pcc_product",
      updatedAt: "2026-07-08T00:00:00.000Z",
    };

    expect(Value.Check(PccProjectSummarySchema, summary)).toBe(true);
  });

  it("validates the Release Governor summary surface", () => {
    expect(
      Value.Check(PccSummaryGetResultSchema, {
        portfolio: {
          projectsTotal: 0,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 0,
          nextActions: [],
        },
        releaseGovernance: {
          schema: "openclaw.release-governance-status.v1",
          policyVersion: 1,
          candidateSha: "a".repeat(40),
          activeRuntimeSha: "b".repeat(40),
          riskLevel: "P1",
          protectedPaths: [],
          capabilityDiff: [],
          checks: [],
          approvalStatus: "none",
          approvalScope: null,
          reviews: [],
          rollbackTarget: "b".repeat(40),
          decision: "escalate",
          evidenceReceiptHash: null,
          evidencePath: null,
          exactBlocker: "Explicit approval is required.",
          approvalWording: "Approve exact candidate SHA.",
          updatedAt: "2026-07-15T12:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("validates sub-milestone list and upsert params", () => {
    expect(
      validatePccSubMilestonesListParams({
        projectId: "project-pcc",
        milestoneId: "milestone-ledger",
      }),
    ).toBe(true);

    expect(
      validatePccSubMilestonesUpsertParams({
        subMilestone: {
          projectId: "project-pcc",
          milestoneId: "milestone-ledger",
          title: "Run targeted proof",
          status: "not_started",
          owner: "local_openclaw_agent",
          percentComplete: 0,
          dependsOn: [],
          implementationPlan: "Run the exact local proof commands.",
          acceptanceCriteria: ["Targeted tests pass", "Receipt is recorded"],
          requiredEvidenceIds: ["evidence-local-test"],
          permissionGrantIds: [],
          receiptIds: [],
          metadata: {
            pccResponsibility: "local_openclaw_agent",
            proofRequired: "local targeted proof",
          },
        },
      }),
    ).toBe(true);

    expect(
      validatePccSubMilestonesUpsertParams({
        subMilestone: {
          projectId: "project-pcc",
          title: "Missing parent milestone",
        },
      }),
    ).toBe(false);
  });

  it("keeps permission grants bounded and closed", () => {
    expect(
      validatePccPermissionsUpsertParams({
        permission: {
          projectId: "project-pcc",
          type: "remote_proof",
          status: "granted",
          riskLevel: "medium",
          allowedActions: ["push scoped branch", "run workflow sanity"],
          forbiddenActions: ["merge upstream main"],
          tokenBudget: 100000,
        },
      }),
    ).toBe(true);

    expect(
      validatePccPermissionsUpsertParams({
        permission: {
          projectId: "project-pcc",
          type: "unknown_permission",
        },
      }),
    ).toBe(false);
  });

  it("validates project decisions", () => {
    expect(
      validatePccDecisionsAddParams({
        decision: {
          projectId: "project-pcc",
          milestoneId: "milestone-ledger",
          title: "Use receipt-gated completion",
          summary: "Milestones only become complete after evidence-backed receipts exist.",
          rationale: "This prevents false completion claims.",
          alternatives: ["Manual status only"],
          impact: "Improves future handoff trust.",
          decidedBy: "Codex",
          evidenceIds: ["evidence-local-test"],
        },
      }),
    ).toBe(true);

    expect(
      validatePccDecisionsAddParams({
        decision: {
          projectId: "project-pcc",
          summary: "missing title",
        },
      }),
    ).toBe(false);
  });

  it("requires completion receipts to identify proof evidence", () => {
    expect(
      validatePccReceiptsAddParams({
        receipt: {
          projectId: "project-pcc",
          milestoneId: "milestone-ledger",
          summary: "Ledger foundation was verified locally.",
          proofEvidenceIds: ["evidence-test"],
          proofLevel: "local",
          doNotRedo: ["Do not replace the ledger with raw prose parsing."],
        },
      }),
    ).toBe(true);

    expect(
      validatePccReceiptsAddParams({
        receipt: {
          projectId: "project-pcc",
          milestoneId: "milestone-ledger",
          summary: "missing evidence ids",
          proofEvidenceIds: [],
        },
      }),
    ).toBe(false);
  });
});

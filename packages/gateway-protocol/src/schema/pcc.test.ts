import { describe, expect, it } from "vitest";
import {
  ProtocolSchemas,
  validatePccMilestonesUpsertParams,
  validatePccPermissionsUpsertParams,
  validatePccProjectsUpsertParams,
  validatePccReceiptsAddParams,
} from "../index.js";

describe("Project Command Center protocol schemas", () => {
  it("registers canonical PCC schemas", () => {
    expect(ProtocolSchemas.PccProject).toBeTruthy();
    expect(ProtocolSchemas.PccMilestone).toBeTruthy();
    expect(ProtocolSchemas.PccPermissionGrant).toBeTruthy();
    expect(ProtocolSchemas.PccCompletionReceipt).toBeTruthy();
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

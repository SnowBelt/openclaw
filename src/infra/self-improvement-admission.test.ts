import { describe, expect, it } from "vitest";
import {
  evaluateSelfImprovementAdmissionTransition,
  type SelfImprovementAdmissionContract,
  validateSelfImprovementAdmissionContract,
} from "./self-improvement-admission.js";

function contract(
  overrides: Partial<SelfImprovementAdmissionContract> = {},
): SelfImprovementAdmissionContract {
  return {
    version: 1,
    componentId: "example-plugin",
    owner: "plugin-owner",
    expectedOutcome: "Failures create bounded evidence-bound recommendations.",
    slo: { metric: "signal coverage", target: ">=95%", windowMs: 86_400_000 },
    proofRequirements: ["targeted test", "bounded holdout"],
    rollback: "Disable the signal adapter and restore the prior runtime.",
    retentionDays: 90,
    privacy: "internal",
    capabilities: ["diagnostic-runtime"],
    autonomyTier: "recommend",
    ...overrides,
  };
}

describe("Self-Improvement component admission", () => {
  it("accepts a complete versioned contract", () => {
    expect(validateSelfImprovementAdmissionContract(contract())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects missing proof, rollback, or bounded autonomy", () => {
    expect(
      validateSelfImprovementAdmissionContract(
        contract({
          proofRequirements: [],
          rollback: "",
          autonomyTier: "approved_administrative" as "recommend",
        }),
      ),
    ).toMatchObject({ valid: false });
  });

  it("enforces shadow, dry-run, canary, active, and rollback gates", () => {
    const value = contract();
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: value,
        from: "shadow",
        to: "dry_run",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: value,
        from: "dry_run",
        to: "canary",
      }),
    ).toMatchObject({ allowed: false });
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: value,
        from: "dry_run",
        to: "canary",
        proofPassed: true,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: value,
        from: "canary",
        to: "active",
        proofPassed: true,
      }),
    ).toMatchObject({ allowed: false });
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: value,
        from: "canary",
        to: "active",
        proofPassed: true,
        rollbackVerified: true,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: value,
        from: "active",
        to: "rolled_back",
        rollbackVerified: true,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("prevents direct shadow-to-active promotion", () => {
    expect(
      evaluateSelfImprovementAdmissionTransition({
        contract: contract(),
        from: "shadow",
        to: "active",
        proofPassed: true,
        rollbackVerified: true,
      }),
    ).toMatchObject({ allowed: false });
  });
});

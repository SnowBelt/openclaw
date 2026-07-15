import { describe, expect, it } from "vitest";
import { assertSelfImprovementAutonomy, evaluateSelfImprovementAutonomy } from "./autonomy.js";

describe("Self-Improvement autonomy tiers", () => {
  it("defaults to recommendation-only work", () => {
    expect(evaluateSelfImprovementAutonomy({ operation: "create_recommendation" })).toMatchObject({
      allowed: true,
      tier: "recommend",
    });
    expect(evaluateSelfImprovementAutonomy({ operation: "update_record_status" })).toMatchObject({
      allowed: false,
      tier: "recommend",
    });
  });

  it("requires explicit approval for administrative changes", () => {
    expect(
      evaluateSelfImprovementAutonomy({
        tier: "approved_administrative",
        operation: "attach_proof",
      }),
    ).toMatchObject({ allowed: false, requiresExplicitApproval: true });
    expect(
      evaluateSelfImprovementAutonomy({
        tier: "approved_administrative",
        operation: "attach_proof",
        explicitApproval: true,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("requires both approval and isolation for bounded checks", () => {
    expect(
      evaluateSelfImprovementAutonomy({
        tier: "bounded_sandbox",
        operation: "run_bounded_test",
        explicitApproval: true,
      }),
    ).toMatchObject({ allowed: false, requiresSandbox: true });
    expect(
      evaluateSelfImprovementAutonomy({
        tier: "bounded_sandbox",
        operation: "run_bounded_test",
        explicitApproval: true,
        sandboxed: true,
      }),
    ).toMatchObject({ allowed: true });
  });

  it.each([
    "modify_source",
    "modify_config",
    "write_memory_or_skill",
    "access_credentials",
    "release_or_github",
    "external_write",
    "funds_or_trading",
  ] as const)("never grants %s to SIG", (operation) => {
    expect(
      evaluateSelfImprovementAutonomy({
        tier: "approved_administrative",
        operation,
        explicitApproval: true,
        sandboxed: true,
      }),
    ).toMatchObject({ allowed: false });
    expect(() =>
      assertSelfImprovementAutonomy({
        tier: "approved_administrative",
        operation,
        explicitApproval: true,
      }),
    ).toThrow("Self-Improvement autonomy denied");
  });
});

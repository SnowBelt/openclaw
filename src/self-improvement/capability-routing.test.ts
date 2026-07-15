import { describe, expect, it } from "vitest";
import { resolveSelfImprovementCapabilityRoutingDecision } from "./capability-routing.js";

describe("Self-Improvement capability routing", () => {
  it("recommends only the first missed direct capability", () => {
    expect(
      resolveSelfImprovementCapabilityRoutingDecision({
        considered: ["browser", "browser", "qa"],
        selected: ["browser"],
        missed: ["dashboard-smoke", "full-catalog"],
        fallback: ["manual"],
      }),
    ).toMatchObject({
      considered: ["browser", "qa"],
      recommended: ["dashboard-smoke"],
      rationale: expect.stringContaining("first missed capability"),
    });
  });

  it("reuses one successful capability instead of the full considered catalog", () => {
    expect(
      resolveSelfImprovementCapabilityRoutingDecision({
        considered: ["qa", "browser", "logs"],
        selected: ["qa", "browser"],
        missed: [],
        fallback: [],
      })?.recommended,
    ).toEqual(["qa"]);
  });

  it("returns no decision when routing evidence is absent", () => {
    expect(resolveSelfImprovementCapabilityRoutingDecision(undefined)).toBeUndefined();
  });
});

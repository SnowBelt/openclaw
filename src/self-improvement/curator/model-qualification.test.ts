import { describe, expect, it } from "vitest";
import {
  CURATOR_MODEL_QUALIFICATION_SCENARIO_IDS,
  evaluateCuratorModelQualification,
  type CuratorModelQualificationObservation,
} from "./model-qualification.js";

function observation(
  scenario: CuratorModelQualificationObservation["scenario"],
  overrides: Partial<CuratorModelQualificationObservation> = {},
): CuratorModelQualificationObservation {
  return {
    scenario,
    modelRef: "replaceable/provider-model",
    trace: { proposalReads: 1, decisionWrites: 1, forbiddenOperations: [] },
    decisionStatus: "accepted_for_workshop",
    privacy: "shared_safe",
    evidenceClassified: true,
    approvalGated: true,
    privateContentDisclosed: false,
    ...overrides,
  };
}

describe("curator model qualification", () => {
  it("requires the same behavioral contract for every replacement model", () => {
    const observations = [
      observation("bounded-review"),
      observation("insufficient-evidence", { decisionStatus: "needs_more_evidence" }),
      observation("sensitive-evidence", {
        decisionStatus: "rejected",
        privacy: "blocked_sensitive",
      }),
      observation("replacement-model", { modelRef: "different-provider/different-model" }),
    ];
    expect(evaluateCuratorModelQualification(observations)).toEqual({
      ok: true,
      missingScenarios: [],
      issues: [],
    });
  });

  it("fails closed on missing scenarios and forbidden calls", () => {
    const result = evaluateCuratorModelQualification([
      observation("bounded-review", {
        trace: { proposalReads: 1, decisionWrites: 1, forbiddenOperations: ["write"] },
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.missingScenarios).toEqual(
      expect.arrayContaining(CURATOR_MODEL_QUALIFICATION_SCENARIO_IDS.slice(1)),
    );
    expect(result.issues).toContain(
      "bounded-review: forbidden curator operation was attempted: write",
    );
  });
});

import { describe, expect, it } from "vitest";
import { parseCuratorModelRecommendation } from "./model-adapter.js";
import type { CuratorReviewPacket } from "./privacy.js";

const packet: CuratorReviewPacket = {
  proposalId: "sip_adapter",
  revision: 1,
  title: "Adapter proposal",
  summary: "Bounded summary.",
  sourceRecommendationIds: ["sir_adapter"],
  requiredEvidence: ["Current proof."],
  safetyNotes: ["No writes."],
  approvalRequired: true,
  testsRequired: false,
};

function validRecommendation(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "accepted_for_workshop",
    evidence: [{ sourceClass: "instruction", sourceRef: "sir_adapter" }],
    confidence: "high",
    freshness: "current",
    privacy: "shared_safe",
    contradiction: false,
    reason: "Evidence is bounded and current.",
    nextAction: "Keep approval external.",
    ...overrides,
  });
}

describe("curator model adapter parser", () => {
  it("accepts the strict model-neutral recommendation schema", () => {
    expect(parseCuratorModelRecommendation(validRecommendation(), packet)).toMatchObject({
      status: "accepted_for_workshop",
      evidence: [{ sourceClass: "instruction", sourceRef: "sir_adapter" }],
    });
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["unknown status", validRecommendation({ status: "promoted" })],
    ["unknown field", validRecommendation({ toolCalls: ["write"] })],
    [
      "out-of-packet source",
      validRecommendation({ evidence: [{ sourceClass: "instruction", sourceRef: "private" }] }),
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseCuratorModelRecommendation(value, packet)).toThrow();
  });
});

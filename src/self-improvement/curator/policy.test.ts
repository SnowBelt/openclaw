import { describe, expect, it } from "vitest";
import type { SelfImprovementCurationReview, SelfImprovementProposal } from "../types.js";
import {
  hasCompleteCurationReview,
  isLegalCuratorTransition,
  proposalContainsSensitiveMarker,
  validateCuratorDecision,
} from "./policy.js";

const review: SelfImprovementCurationReview = {
  evidence: [{ sourceClass: "instruction", sourceRef: "policy-test" }],
  confidence: "high",
  freshness: "current",
  privacy: "shared_safe",
  contradiction: false,
  reason: "The cited evidence is current and consistent.",
  nextAction: "Keep the workshop draft pending approval.",
  reviewedAt: 1,
};

function proposal(overrides: Partial<SelfImprovementProposal> = {}): SelfImprovementProposal {
  return {
    id: "sip_policy",
    createdAt: 1,
    updatedAt: 1,
    status: "pending",
    kind: "memory_skill",
    groupId: "group_policy",
    groupKey: "knowledge_hygiene:policy",
    title: "Policy proposal",
    summary: "A bounded policy proposal.",
    route: {
      role: "memory_curator",
      targetAgentId: "memory-knowledge-curator",
      targetAgentLabel: "Memory & Knowledge Curator",
      reason: "Memory review.",
    },
    sourceRecommendationIds: ["sir_policy"],
    recommendedAction: "Review the cited evidence.",
    requiredEvidence: ["Cited evidence."],
    safetyNotes: ["No direct writes."],
    approvalRequired: true,
    testsRequired: false,
    analysisMode: "deterministic",
    ...overrides,
  };
}

describe("curator policy", () => {
  it("recognizes complete reviews and permits a proven workshop decision", () => {
    expect(hasCompleteCurationReview(review)).toBe(true);
    expect(
      validateCuratorDecision({
        existing: proposal(),
        nextStatus: "accepted_for_workshop",
        review,
        proof: "Policy test proof.",
      }),
    ).toEqual({ ok: true, review });
  });

  it("keeps transitions explicit and blocks unsafe or incomplete decisions", () => {
    expect(isLegalCuratorTransition("pending_review", "promoted")).toBe(false);
    expect(isLegalCuratorTransition("accepted_for_workshop", "promoted")).toBe(true);

    expect(
      validateCuratorDecision({
        existing: proposal(),
        nextStatus: "accepted_for_workshop",
        review: { ...review, freshness: "stale_risk" },
        proof: "Stale proof.",
      }),
    ).toMatchObject({ ok: false, failure: { code: "unsafe_review" } });

    expect(
      validateCuratorDecision({
        existing: proposal(),
        nextStatus: "accepted_for_workshop",
        review: { ...review, privacy: "private_reference_only" },
        proof: "Private-reference proof.",
      }),
    ).toMatchObject({ ok: false, failure: { code: "unsafe_review" } });

    expect(
      validateCuratorDecision({
        existing: proposal({ approvalRequired: false }),
        nextStatus: "accepted_for_workshop",
        review,
        proof: "Ungated proof.",
      }),
    ).toMatchObject({ ok: false, failure: { code: "unsafe_review" } });

    expect(
      validateCuratorDecision({
        existing: proposal(),
        nextStatus: "rejected",
        review,
      }),
    ).toMatchObject({ ok: false, failure: { code: "missing_reason" } });
  });

  it("rejects non-curator proposals and redacted sensitive markers", () => {
    expect(
      validateCuratorDecision({
        existing: proposal({ kind: "implementation" }),
        nextStatus: "rejected",
        review,
        reason: "Not owned by the curator.",
      }),
    ).toMatchObject({ ok: false, failure: { code: "not_memory_skill" } });

    const sensitive = proposal({ summary: "token=[redacted]" });
    expect(proposalContainsSensitiveMarker(sensitive)).toBe(true);
    expect(
      validateCuratorDecision({
        existing: sensitive,
        nextStatus: "accepted_for_workshop",
        review,
        proof: "Sensitive test proof.",
      }),
    ).toMatchObject({ ok: false, failure: { code: "sensitive_marker" } });
  });
});

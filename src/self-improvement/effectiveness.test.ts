import { describe, expect, it } from "vitest";
import { buildSelfImprovementEffectivenessDimension } from "./effectiveness.js";
import type { SelfImprovementOutboxItem } from "./outbox.js";
import type { SelfImprovementSignal } from "./signals.js";
import type { SelfImprovementRecommendation } from "./types.js";

const now = 100_000;

function signal(overrides: Partial<SelfImprovementSignal> = {}): SelfImprovementSignal {
  return {
    id: "sis_1",
    version: 1,
    idempotencyKey: "failure-1",
    source: { component: "test" },
    kind: "failure",
    severity: "medium",
    summary: "A bounded test failure occurred.",
    firstSeenAt: now - 1_000,
    lastSeenAt: now - 1_000,
    occurrences: 1,
    evidenceRefs: [],
    privacy: "internal",
    capabilityRouting: { considered: ["qa"], selected: ["qa"], missed: [], fallback: [] },
    trusted: true,
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<SelfImprovementRecommendation> = {},
): SelfImprovementRecommendation {
  return {
    id: "sir_1",
    fingerprint: "fingerprint",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    status: "assigned",
    title: "Signal recommendation",
    summary: "Summary",
    category: "task_reliability",
    severity: "medium",
    criticality: "medium",
    priority: "medium",
    impact: "medium",
    effort: "small",
    confidence: 0.92,
    groupKey: "signal",
    groupTitle: "Signal",
    recurrenceCount: 1,
    source: { kind: "workflow", label: "Signal", runId: "signal:sis_1" },
    route: {
      role: "qa",
      targetAgentId: "qa",
      targetAgentLabel: "QA",
      reason: "Verification",
    },
    recommendedAction: "Verify.",
    requiredEvidence: ["Proof"],
    safety: {
      mode: "recommendation_only",
      mutationAllowed: false,
      requiresApproval: true,
      requiresTests: true,
      blockedActions: ["direct mutation"],
    },
    analysis: {
      mode: "deterministic",
      summary: "Analysis",
      generatedAt: now,
      confidence: 0.92,
      evidenceCount: 1,
      safetyNotes: [],
    },
    evidence: ["Signal sis_1"],
    ...overrides,
  };
}

function completedOutbox(): SelfImprovementOutboxItem {
  return {
    id: "sio_1",
    kind: "signal_analysis",
    entityId: "sis_1",
    status: "completed",
    createdAt: now - 1_000,
    updatedAt: now,
    availableAt: now - 1_000,
    attempts: 1,
    completedAt: now,
  };
}

describe("Self-Improvement effectiveness scorecard", () => {
  it("is neutral and ready before the first actionable signal", () => {
    const result = buildSelfImprovementEffectivenessDimension({
      signals: [],
      recommendations: [],
      outbox: [],
      now,
    });
    expect(result).toMatchObject({ status: "ready", score: 100, blockers: [] });
  });

  it("scores a causal, routed, deduplicated signal path at the quality target", () => {
    const result = buildSelfImprovementEffectivenessDimension({
      signals: [signal()],
      recommendations: [recommendation()],
      outbox: [completedOutbox()],
      now,
    });
    expect(result).toMatchObject({ status: "ready", score: 100, blockers: [] });
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        { key: "signalCoverage", label: "Signal coverage %", value: 100 },
        { key: "routingAccuracy", label: "Routing accuracy %", value: 100 },
        { key: "safetyViolations", label: "Safety violations", value: 0 },
      ]),
    );
  });

  it("degrades duplicate and low-confidence recommendations that escape quarantine", () => {
    const result = buildSelfImprovementEffectivenessDimension({
      signals: [signal()],
      recommendations: [
        recommendation({ confidence: 0.68, status: "open" }),
        recommendation({ id: "sir_duplicate", fingerprint: "duplicate" }),
      ],
      outbox: [completedOutbox()],
      now,
    });
    expect(result.status).toBe("degraded");
    expect(result.blockers.join(" ")).toContain("Duplicate causal recommendation rate");
    expect(result.blockers.join(" ")).toContain("escaped quarantine");
  });
});

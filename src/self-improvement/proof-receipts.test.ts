import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveSelfImprovementRecommendationActionability } from "./actionability.js";
import {
  listSelfImprovementProofReceipts,
  recordSelfImprovementProofReceipt,
} from "./proof-receipts.js";
import {
  getSelfImprovementRecommendation,
  updateSelfImprovementRecommendationStatus,
  upsertSelfImprovementRecommendations,
} from "./store.js";
import type { SelfImprovementRecommendation } from "./types.js";

let stateDir: string;
const now = Date.parse("2026-07-13T12:00:00.000Z");

function recommendation(
  overrides: Partial<SelfImprovementRecommendation> = {},
): SelfImprovementRecommendation {
  return {
    id: "sir_outcome_proof",
    fingerprint: "outcome-proof-fingerprint",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    status: "assigned",
    title: "Prevent recurring workflow failure",
    summary: "Verify that the workflow remains healthy after the corrective action.",
    category: "task_reliability",
    severity: "high",
    criticality: "high",
    priority: "high",
    impact: "high",
    effort: "medium",
    confidence: 0.92,
    groupKey: "task_reliability:workflow:proof",
    groupTitle: "Prevent recurring workflow failure",
    recurrenceCount: 1,
    source: { kind: "workflow", label: "Proof signal", runId: "signal:sis_proof" },
    route: {
      role: "builder",
      targetAgentId: "codex",
      targetAgentLabel: "Builder Agent",
      reason: "Implementation verification.",
    },
    assignedTargetAgentId: "codex",
    recommendedAction: "Run the holdout and attach an outcome proof receipt.",
    requiredEvidence: ["Targeted smoke", "Holdout observation"],
    safety: {
      mode: "recommendation_only",
      mutationAllowed: false,
      requiresApproval: true,
      requiresTests: true,
      blockedActions: ["no direct merge, push, or release"],
    },
    analysis: {
      mode: "deterministic",
      summary: "Evidence-bound recommendation analysis.",
      generatedAt: now,
      confidence: 0.92,
      promptVersion: "self-improvement-deterministic-v1",
      evidenceCount: 1,
      safetyNotes: ["Recommendation-only."],
    },
    outcomeProofRequired: true,
    evidence: ["signal:sis_proof"],
    observedEvidenceKeys: ["old-evidence"],
    lastNovelEvidenceAt: now,
    ...overrides,
  };
}

function proofInput(
  overrides: {
    signalId?: string;
    metricPassed?: boolean;
    endedAt?: number;
    holdoutPassed?: boolean;
    evidenceRefs?: string[];
  } = {},
) {
  return {
    recommendationId: "sir_outcome_proof",
    signalId: overrides.signalId ?? "sis_proof",
    diagnosis: "The workflow failed because the expected guard did not run.",
    action: "Enable the guard and run the bounded holdout smoke.",
    metric: {
      name: "workflow success rate",
      baseline: "0.70",
      target: ">=0.95",
      observed: overrides.metricPassed === false ? "0.80" : "1.00",
      unit: "ratio",
      passed: overrides.metricPassed ?? true,
    },
    observation: {
      startedAt: now,
      endedAt: overrides.endedAt ?? now + 60_000,
      minimumDurationMs: 60_000,
    },
    holdout: { required: true, passed: overrides.holdoutPassed ?? true },
    evidenceRefs: overrides.evidenceRefs ?? ["work/self-improvement/proof.json"],
  };
}

describe("Self-Improvement outcome proof receipts", () => {
  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sig-proof-"));
    await upsertSelfImprovementRecommendations({
      stateDir,
      recommendations: [recommendation()],
    });
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("blocks resolution until a matching outcome and holdout receipt passes", async () => {
    await expect(
      updateSelfImprovementRecommendationStatus({
        stateDir,
        id: "sir_outcome_proof",
        status: "resolved",
      }),
    ).rejects.toThrow("requires a confirmed outcome proof receipt");

    const failed = await recordSelfImprovementProofReceipt({
      stateDir,
      input: proofInput({ metricPassed: false, holdoutPassed: false }),
      now: now + 60_000,
    });
    expect(failed).toMatchObject({ status: "failed", outcomeConfirmed: false });
    const blocked = await getSelfImprovementRecommendation({ stateDir, id: "sir_outcome_proof" });
    expect(blocked).toMatchObject({
      proofReceiptId: failed.id,
      proofOutcomeState: "failed",
    });
    expect(deriveSelfImprovementRecommendationActionability(blocked!, now + 60_000)).toMatchObject({
      proofState: "missing",
      closureState: "blocked",
    });

    const passed = await recordSelfImprovementProofReceipt({
      stateDir,
      input: proofInput(),
      now: now + 120_000,
    });
    expect(passed).toMatchObject({ status: "passed", outcomeConfirmed: true });
    const ready = await getSelfImprovementRecommendation({ stateDir, id: "sir_outcome_proof" });
    expect(ready).toMatchObject({
      proofReceiptId: passed.id,
      proofOutcomeState: "confirmed",
      resolutionProofState: "current",
    });
    expect(deriveSelfImprovementRecommendationActionability(ready!, now + 120_000)).toMatchObject({
      proofState: "attached",
      closureState: "ready_to_resolve",
    });

    await expect(
      updateSelfImprovementRecommendationStatus({
        stateDir,
        id: "sir_outcome_proof",
        status: "resolved",
        now: now + 180_000,
      }),
    ).resolves.toMatchObject({ status: "resolved" });
    await expect(
      listSelfImprovementProofReceipts({ stateDir, recommendationId: "sir_outcome_proof" }),
    ).resolves.toHaveLength(2);
  });

  it("rejects proof linked to a different causal signal", async () => {
    await expect(
      recordSelfImprovementProofReceipt({
        stateDir,
        input: proofInput({ signalId: "sis_other" }),
      }),
    ).rejects.toThrow("does not match sis_proof");
  });

  it("marks confirmed proof stale and reopens the same causal recommendation on recurrence", async () => {
    await recordSelfImprovementProofReceipt({ stateDir, input: proofInput() });
    await updateSelfImprovementRecommendationStatus({
      stateDir,
      id: "sir_outcome_proof",
      status: "resolved",
      now: now + 180_000,
    });

    const result = await upsertSelfImprovementRecommendations({
      stateDir,
      recommendations: [
        recommendation({
          updatedAt: now + 240_000,
          lastSeenAt: now + 240_000,
          observedEvidenceKeys: ["old-evidence", "new-evidence"],
        }),
      ],
    });

    expect(result).toMatchObject({ reopened: 1 });
    expect(result.recommendations[0]).toMatchObject({
      status: "reopened",
      resolutionProofState: "stale",
      proofOutcomeState: "stale",
    });
  });
});

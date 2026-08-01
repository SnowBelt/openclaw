import crypto from "node:crypto";
import type { OperationsFinding, OperationsRemediationRecord } from "../types.js";
import type { OperationsRemediationAiReview, OperationsRemediationStore } from "./contracts.js";
import { boundedRemediationText } from "./text.js";

export async function createAdvisoryRemediationRecommendation<Context>(params: {
  finding: OperationsFinding;
  ai: OperationsRemediationAiReview<Context>;
  store: OperationsRemediationStore;
  now: () => number;
}): Promise<OperationsRemediationRecord | null> {
  if (!params.ai.recommend || !params.ai.judgeRecommendation) {
    return null;
  }
  const startedAt = params.now();
  const proposal = await params.ai.recommend({ finding: params.finding });
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
    throw new Error("Local recommendation confidence is invalid");
  }
  const judge = await params.ai.judgeRecommendation({
    finding: params.finding,
    recommendation: proposal,
  });
  const record: OperationsRemediationRecord = {
    id: crypto.randomUUID(),
    findingId: params.finding.id,
    findingTitle: boundedRemediationText(params.finding.title, 1_000, "Operations issue"),
    findingCategory: params.finding.category,
    ...(params.finding.entityId ? { findingEntityId: params.finding.entityId } : {}),
    impact: boundedRemediationText(
      params.finding.impact,
      1_000,
      "Operational impact is unavailable.",
    ),
    recipeId: "local-ai.recommendation.v1",
    risk: proposal.risk,
    status: "approval_required",
    ownerId: "OpenClaw",
    recommendedFix: boundedRemediationText(
      proposal.recommendedFix,
      4_000,
      "Investigate the issue before changing anything.",
    ),
    recommendationReason: boundedRemediationText(
      proposal.reason,
      4_000,
      "Local investigation identified this as the safest next step.",
    ),
    confidence: proposal.confidence,
    exactRepair: boundedRemediationText(
      proposal.recommendedFix,
      4_000,
      "No executable repair is approved.",
    ),
    expectedChange: boundedRemediationText(
      proposal.expectedChange,
      4_000,
      "No change occurs until an approved repair recipe exists.",
    ),
    verificationPlan: boundedRemediationText(
      proposal.verificationPlan,
      4_000,
      "Verify the affected authoritative source after an approved repair.",
    ),
    progress: judge.approved
      ? "Local investigation and independent safety review produced a recommendation; an approved executable recipe is still required."
      : "Independent safety review rejected automatic execution; Codex review is required.",
    result: "No automatic change was made.",
    evidence: [],
    rollback: boundedRemediationText(
      proposal.rollback,
      4_000,
      "No change is authorized until a verified rollback plan exists.",
    ),
    progressLocation:
      "Progress appears here while work runs and under Since your last visit when it finishes.",
    undoAvailable: false,
    automatic: false,
    startedAt,
    updatedAt: params.now(),
    judge: {
      model: "openclaw-judge-qwen35-27b-q8:latest",
      approved: judge.approved,
      reason: boundedRemediationText(
        judge.reason,
        2_000,
        "Independent safety review returned no reason.",
      ),
    },
    investigation: {
      model: "qwen3.6:27b-q8_0",
      confidence: proposal.confidence,
      recommendation: boundedRemediationText(
        proposal.recommendedFix,
        2_000,
        "Local investigation returned no safe recommendation.",
      ),
    },
  };
  params.store.upsert(record);
  return record;
}

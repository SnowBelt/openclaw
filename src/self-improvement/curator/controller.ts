import crypto from "node:crypto";
import type { SelfImprovementCurationReview, SelfImprovementProposal } from "../types.js";
import type { CuratorDecisionStatus } from "./contract.js";
import type { CuratorModelAdapter, CuratorModelRecommendation } from "./model-adapter.js";
import type { CuratorProposalRepository } from "./ports.js";
import { createCuratorReviewPacket, proposalContainsPrivateContent } from "./privacy.js";
import {
  CuratorPolicyError,
  CuratorProposalNotFoundError,
  createCuratorService,
} from "./service.js";

const CONTROLLER_VERSION = 1;
const MAX_MODEL_ATTEMPTS = 2;

export type CuratorControllerTrace = {
  proposalReads: number;
  decisionWrites: number;
  forbiddenOperations: string[];
};

export type CuratorReviewReceipt = {
  proposalId: string;
  status: CuratorDecisionStatus;
  modelRef: string;
  modelAttempts: number;
  modelAccepted: boolean;
  usedFallback: boolean;
  privacy: SelfImprovementCurationReview["privacy"];
  evidenceClassified: boolean;
  approvalGated: boolean;
  privateContentDisclosed: false;
  trace: CuratorControllerTrace;
};

function baseEvidence(proposal: SelfImprovementProposal) {
  return [
    {
      sourceClass: "instruction" as const,
      sourceRef: proposal.sourceRecommendationIds[0] ?? proposal.id,
      observedAt: proposal.updatedAt,
    },
  ];
}

function deterministicReview(params: {
  proposal: SelfImprovementProposal;
  status: CuratorDecisionStatus;
  privacy?: SelfImprovementCurationReview["privacy"];
  reason: string;
  nextAction: string;
  now: number;
}): SelfImprovementCurationReview {
  return {
    evidence: baseEvidence(params.proposal),
    confidence: params.status === "accepted_for_workshop" ? "medium" : "low",
    freshness: params.status === "accepted_for_workshop" ? "current" : "unknown",
    privacy: params.privacy ?? "shared_safe",
    contradiction: false,
    reason: params.reason,
    nextAction: params.nextAction,
    reviewedAt: params.now,
  };
}

function normalizeRecommendation(params: {
  proposal: SelfImprovementProposal;
  recommendation: CuratorModelRecommendation;
  now: number;
}): { status: CuratorDecisionStatus; review: SelfImprovementCurationReview } {
  const recommendation = params.recommendation;
  const safeAcceptance =
    recommendation.status === "accepted_for_workshop" &&
    recommendation.confidence !== "low" &&
    recommendation.freshness === "current" &&
    recommendation.privacy === "shared_safe" &&
    !recommendation.contradiction &&
    params.proposal.approvalRequired;
  const status =
    recommendation.status === "accepted_for_workshop" && !safeAcceptance
      ? "needs_more_evidence"
      : recommendation.status;
  return {
    status,
    review: {
      evidence: recommendation.evidence.map((entry) => ({
        ...entry,
        observedAt: params.proposal.updatedAt,
      })),
      confidence: recommendation.confidence,
      freshness: recommendation.freshness,
      privacy: recommendation.privacy,
      contradiction: recommendation.contradiction,
      reason:
        status === recommendation.status
          ? recommendation.reason
          : "The advisory recommendation did not satisfy the fail-closed workshop policy.",
      nextAction:
        status === recommendation.status
          ? recommendation.nextAction
          : "Provide current, shared-safe, non-contradictory evidence for another review.",
      reviewedAt: params.now,
    },
  };
}

function proposalIsDuplicate(proposal: SelfImprovementProposal): boolean {
  return /\bduplicate\b/i.test(proposal.dismissalReason ?? "");
}

function decisionProof(params: {
  proposal: SelfImprovementProposal;
  status: CuratorDecisionStatus;
  modelRef: string;
}): string {
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        controllerVersion: CONTROLLER_VERSION,
        proposalId: params.proposal.id,
        revision: params.proposal.updatedAt,
        status: params.status,
        modelRef: params.modelRef,
      }),
    )
    .digest("hex");
  return `curator-controller:v${CONTROLLER_VERSION}:sha256:${digest}`;
}

export function createCuratorReviewController(params: {
  repository: CuratorProposalRepository;
  model: CuratorModelAdapter;
  now?: () => number;
}) {
  const service = createCuratorService({ repository: params.repository });
  const now = params.now ?? Date.now;

  return {
    review: async (proposalId: string): Promise<CuratorReviewReceipt> => {
      const trace: CuratorControllerTrace = {
        proposalReads: 0,
        decisionWrites: 0,
        forbiddenOperations: [],
      };
      trace.proposalReads += 1;
      const proposal = await params.repository.get(proposalId);
      if (!proposal) {
        throw new CuratorProposalNotFoundError(proposalId);
      }
      if ((proposal.curatorStatus ?? "pending_review") !== "pending_review") {
        throw new CuratorPolicyError("illegal_transition", "proposal is not pending review");
      }

      const reviewedAt = now();
      let status: CuratorDecisionStatus;
      let review: SelfImprovementCurationReview;
      let modelRef = "controller/deterministic";
      let modelAttempts = 0;
      let modelAccepted = false;
      let usedFallback = false;

      if (proposalContainsPrivateContent(proposal)) {
        status = "rejected";
        review = deterministicReview({
          proposal,
          status,
          privacy: "blocked_sensitive",
          reason:
            "The proposal contains sensitive or private evidence and cannot enter shared review.",
          nextAction: "Rewrite the proposal using non-sensitive source references only.",
          now: reviewedAt,
        });
      } else if (proposalIsDuplicate(proposal)) {
        status = "superseded";
        review = deterministicReview({
          proposal,
          status,
          reason: "The proposal is recorded as a duplicate of an existing review item.",
          nextAction: "Continue only with the canonical proposal.",
          now: reviewedAt,
        });
      } else if (
        proposal.sourceRecommendationIds.length === 0 ||
        proposal.requiredEvidence.length === 0 ||
        !proposal.approvalRequired
      ) {
        status = "needs_more_evidence";
        review = deterministicReview({
          proposal,
          status,
          reason: "The proposal lacks bounded evidence references or an explicit approval gate.",
          nextAction: "Add cited evidence and preserve explicit approval before another review.",
          now: reviewedAt,
        });
      } else {
        const packet = createCuratorReviewPacket(proposal);
        let lastIssue: string | undefined;
        let result: Awaited<ReturnType<CuratorModelAdapter["recommend"]>> | undefined;
        for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt += 1) {
          modelAttempts = attempt;
          try {
            result = await params.model.recommend({ packet, repairIssue: lastIssue });
            break;
          } catch (error) {
            lastIssue = error instanceof Error ? error.message : "invalid recommendation";
          }
        }
        if (result) {
          modelRef = result.modelRef;
          const normalized = normalizeRecommendation({
            proposal,
            recommendation: result.recommendation,
            now: reviewedAt,
          });
          status = normalized.status;
          review = normalized.review;
          modelAccepted = true;
        } else {
          usedFallback = true;
          status = "needs_more_evidence";
          review = deterministicReview({
            proposal,
            status,
            reason: "The advisory model did not return a valid bounded recommendation.",
            nextAction: "Retry with a qualified model or complete a manual reviewer-only decision.",
            now: reviewedAt,
          });
        }
      }

      const proof = decisionProof({ proposal, status, modelRef });
      trace.decisionWrites += 1;
      await service.decidePrepared(proposal, {
        id: proposal.id,
        curatorStatus: status,
        curationReview: review,
        proof,
        reason: review.reason,
        now: reviewedAt,
      });
      return {
        proposalId: proposal.id,
        status,
        modelRef,
        modelAttempts,
        modelAccepted,
        usedFallback,
        privacy: review.privacy,
        evidenceClassified: review.evidence.length > 0,
        approvalGated: proposal.approvalRequired,
        privateContentDisclosed: false,
        trace,
      };
    },
  };
}

export type CuratorReviewController = ReturnType<typeof createCuratorReviewController>;

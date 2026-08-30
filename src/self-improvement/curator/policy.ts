import type {
  SelfImprovementCurationReview,
  SelfImprovementCuratorStatus,
  SelfImprovementProposal,
} from "../types.js";
import {
  CURATOR_CONFIDENCE_VALUES,
  CURATOR_FRESHNESS_VALUES,
  CURATOR_MAX_EVIDENCE_REFERENCES,
  CURATOR_PRIVACY_VALUES,
  CURATOR_SOURCE_CLASS_VALUES,
} from "./contract.js";

const SENSITIVE_MARKER_PATTERN =
  /\[redacted(?:-token)?\]|\b(?:api[_-]?key|token|secret|password)\s*=\s*\[redacted\]/i;

function isCuratorSourceClass(
  value: unknown,
): value is (typeof CURATOR_SOURCE_CLASS_VALUES)[number] {
  return CURATOR_SOURCE_CLASS_VALUES.some((entry) => entry === value);
}

export type CuratorPolicyFailure = {
  code:
    | "not_memory_skill"
    | "illegal_transition"
    | "incomplete_review"
    | "unsafe_review"
    | "missing_proof"
    | "missing_workshop"
    | "missing_reason"
    | "sensitive_marker";
  message: string;
};

export type CuratorDecisionPolicyInput = {
  existing: SelfImprovementProposal;
  nextStatus: SelfImprovementCuratorStatus;
  review: unknown;
  proof?: string;
  reason?: string;
  workshopProposalId?: string;
  workshopProposalStatus?: SelfImprovementProposal["workshopProposalStatus"];
};

export type CuratorDecisionPolicyResult =
  | { ok: true; review: SelfImprovementCurationReview | undefined }
  | { ok: false; failure: CuratorPolicyFailure };

export function isLegalCuratorTransition(
  current: SelfImprovementCuratorStatus,
  next: SelfImprovementCuratorStatus,
): boolean {
  if (current === "promoted") {
    return next === "promoted";
  }
  if (next === "promoted") {
    return current === "accepted_for_workshop";
  }
  if (current === "rejected" || current === "superseded") {
    return next === "pending_review" || next === current;
  }
  return true;
}

export function hasCompleteCurationReview(
  review: unknown,
): review is SelfImprovementCurationReview {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return false;
  }
  const value = review as Partial<SelfImprovementCurationReview>;
  const evidence = value.evidence;
  return (
    Array.isArray(evidence) &&
    evidence.length > 0 &&
    evidence.length <= CURATOR_MAX_EVIDENCE_REFERENCES &&
    evidence.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      const candidate = entry as {
        sourceClass?: unknown;
        sourceRef?: unknown;
        observedAt?: unknown;
      };
      return (
        isCuratorSourceClass(candidate.sourceClass) &&
        typeof candidate.sourceRef === "string" &&
        candidate.sourceRef.trim().length > 0 &&
        (candidate.observedAt === undefined ||
          (typeof candidate.observedAt === "number" &&
            Number.isFinite(candidate.observedAt) &&
            candidate.observedAt >= 0))
      );
    }) &&
    typeof value.confidence === "string" &&
    CURATOR_CONFIDENCE_VALUES.includes(value.confidence) &&
    typeof value.freshness === "string" &&
    CURATOR_FRESHNESS_VALUES.includes(value.freshness) &&
    typeof value.privacy === "string" &&
    CURATOR_PRIVACY_VALUES.includes(value.privacy) &&
    typeof value.contradiction === "boolean" &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    typeof value.nextAction === "string" &&
    value.nextAction.trim().length > 0 &&
    typeof value.reviewedAt === "number" &&
    Number.isFinite(value.reviewedAt) &&
    value.reviewedAt >= 0
  );
}

export function proposalContainsSensitiveMarker(proposal: {
  title?: string;
  summary?: string;
  recommendedAction?: string;
  requiredEvidence?: readonly string[];
  safetyNotes?: readonly string[];
}): boolean {
  const text = [
    proposal.title,
    proposal.summary,
    proposal.recommendedAction,
    ...(proposal.requiredEvidence ?? []),
    ...(proposal.safetyNotes ?? []),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
  return SENSITIVE_MARKER_PATTERN.test(text);
}

export function validateCuratorDecision(
  input: CuratorDecisionPolicyInput,
): CuratorDecisionPolicyResult {
  if (input.existing.kind !== "memory_skill") {
    return {
      ok: false,
      failure: {
        code: "not_memory_skill",
        message: "curator updates are only allowed for memory_skill proposals",
      },
    };
  }

  const currentStatus = input.existing.curatorStatus ?? "pending_review";
  if (!isLegalCuratorTransition(currentStatus, input.nextStatus)) {
    return {
      ok: false,
      failure: {
        code: "illegal_transition",
        message: `illegal curator transition from ${currentStatus} to ${input.nextStatus}`,
      },
    };
  }

  const review = input.review ?? input.existing.curationReview;
  if (
    (input.nextStatus === "accepted_for_workshop" || input.nextStatus === "promoted") &&
    !hasCompleteCurationReview(review)
  ) {
    return {
      ok: false,
      failure: {
        code: "incomplete_review",
        message:
          "structured provenance, confidence, freshness, privacy, contradiction, reason, and next action are required before workshop acceptance or promotion",
      },
    };
  }

  if (
    input.nextStatus === "accepted_for_workshop" &&
    hasCompleteCurationReview(review) &&
    (review.contradiction ||
      review.freshness !== "current" ||
      review.privacy !== "shared_safe" ||
      review.confidence === "low" ||
      !input.existing.approvalRequired)
  ) {
    return {
      ok: false,
      failure: {
        code: "unsafe_review",
        message:
          "workshop acceptance rejects stale-risk, private, contradictory, low-confidence, or ungated evidence; current shared-safe proof and an approval gate are required",
      },
    };
  }

  const hasProof = Boolean(
    input.proof?.trim() ||
    (input.nextStatus === "promoted"
      ? input.existing.promotionProof?.trim()
      : input.existing.curatorProof?.trim()),
  );
  if (
    (input.nextStatus === "accepted_for_workshop" || input.nextStatus === "promoted") &&
    !hasProof
  ) {
    return {
      ok: false,
      failure: {
        code: "missing_proof",
        message: "curator proof is required before accepting or promoting memory/skill proposals",
      },
    };
  }

  const workshopProposalId = input.workshopProposalId?.trim() || input.existing.workshopProposalId;
  const workshopProposalStatus =
    input.workshopProposalStatus ?? input.existing.workshopProposalStatus ?? "pending";
  if (
    input.nextStatus === "promoted" &&
    (!workshopProposalId || workshopProposalStatus !== "applied")
  ) {
    return {
      ok: false,
      failure: {
        code: "missing_workshop",
        message:
          "an applied Skill Workshop proposal link is required before promotion proof can close a curator proposal",
      },
    };
  }

  const hasReason = Boolean(input.reason?.trim() || input.existing.curatorReason?.trim());
  if (
    (input.nextStatus === "rejected" ||
      input.nextStatus === "needs_more_evidence" ||
      input.nextStatus === "superseded") &&
    !hasReason
  ) {
    return {
      ok: false,
      failure: {
        code: "missing_reason",
        message:
          "a curator reason is required before rejecting, superseding, or requesting more evidence",
      },
    };
  }

  if (
    (input.nextStatus === "accepted_for_workshop" || input.nextStatus === "promoted") &&
    proposalContainsSensitiveMarker(input.existing)
  ) {
    return {
      ok: false,
      failure: {
        code: "sensitive_marker",
        message:
          "curator proposal still contains redacted sensitive markers and must be rewritten before workshop acceptance",
      },
    };
  }

  return {
    ok: true,
    review: hasCompleteCurationReview(review) ? review : undefined,
  };
}

import { evaluateReleaseApproval } from "./approval.js";
import type {
  ReleaseApprovalEvaluation,
  ReleaseCandidateFacts,
  ReleaseChangeClassification,
  ReleaseCheck,
  ReleaseGovernorPolicy,
  ReleaseHealthDecision,
  ReleaseOperation,
  ReleasePolicyDecision,
  ReleaseReview,
  ReleaseReviewRole,
} from "./contracts.js";

export function requiredReleaseReviewRoles(params: {
  operation: ReleaseOperation;
  classification: ReleaseChangeClassification;
  scopeCoordinationMaterial: boolean;
}): ReleaseReviewRole[] {
  const roles = new Set<ReleaseReviewRole>(["release_governor", "judge"]);
  if (["promotion", "restart", "rollback", "finalize"].includes(params.operation)) {
    roles.add("telemetry_evaluation_analyst");
  }
  if (
    params.classification.riskLevel === "P0" ||
    params.classification.riskLevel === "P1" ||
    params.classification.protectedPaths.length > 0
  ) {
    roles.add("control_director");
  }
  if (params.scopeCoordinationMaterial) {
    roles.add("program_manager");
  }
  return [...roles];
}

function approvalWording(facts: ReleaseCandidateFacts, operation: ReleaseOperation): string {
  const destination = facts.destination ?? "local-only runtime state";
  const disclosure = facts.externalDisclosure
    ? `I understand this will disclose updated workspace code at exact SHA ${facts.candidateSha} from branch ${facts.branch} in repository ${facts.repository} to the externally hosted destination ${destination}, which the execution environment cannot independently verify as trusted. Despite that disclosure risk, `
    : `For project ${facts.project}, `;
  return `${disclosure}I explicitly approve the ${operation} operation for exact SHA ${facts.candidateSha}, the required exact-SHA CI workflow, verified immutable deployment, Gateway restart when applicable, desktop/mobile browser proof with token redaction, and PCC ledger evidence/receipt update. Do not reboot the Mac Studio, modify SNES Game Creator work, spend money or tokens, trade live funds, alter credentials, add destinations, or perform destructive actions unless separately approved.`;
}

function evaluateRequiredChecks(
  requiredIds: readonly string[],
  checks: readonly ReleaseCheck[],
): { blockers: string[]; warnings: string[] } {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const blockers: string[] = [];
  for (const id of requiredIds) {
    const check = byId.get(id);
    if (!check) {
      blockers.push(`Required check ${id} is missing.`);
    } else if (check.status !== "passed") {
      blockers.push(`Required check ${id} is ${check.status}: ${check.summary}`);
    }
  }
  const warnings = checks
    .filter((check) => !requiredIds.includes(check.id) && check.status !== "passed")
    .map((check) => `Optional check ${check.id} is ${check.status}: ${check.summary}`);
  return { blockers, warnings };
}

function evaluateReviews(params: {
  required: readonly ReleaseReviewRole[];
  reviews: readonly ReleaseReview[];
  confidenceThreshold: number;
}): string[] {
  const blockers: string[] = [];
  const selected: ReleaseReview[] = [];
  for (const role of params.required) {
    const review = params.reviews
      .filter((candidate) => candidate.role === role)
      .toSorted((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))[0];
    if (!review) {
      blockers.push(`Required ${role} review is missing.`);
      continue;
    }
    selected.push(review);
    if (review.decision !== "approve") {
      blockers.push(`Required ${role} review decided ${review.decision}: ${review.summary}`);
    } else if (review.confidence < params.confidenceThreshold) {
      blockers.push(
        `Required ${role} review confidence ${review.confidence} is below ${params.confidenceThreshold}.`,
      );
    }
  }
  const reviewerRoles = new Map<string, ReleaseReviewRole[]>();
  for (const review of selected) {
    const roles = reviewerRoles.get(review.reviewerId) ?? [];
    roles.push(review.role);
    reviewerRoles.set(review.reviewerId, roles);
  }
  for (const [reviewerId, roles] of reviewerRoles) {
    if (roles.length > 1) {
      blockers.push(
        `Required reviews are not independent: ${reviewerId} submitted ${roles.join(", ")}.`,
      );
    }
  }
  return blockers;
}

export function decideReleasePolicy(params: {
  policy: ReleaseGovernorPolicy;
  operation: ReleaseOperation;
  facts: ReleaseCandidateFacts;
  classification: ReleaseChangeClassification;
  checks: readonly ReleaseCheck[];
  reviews: readonly ReleaseReview[];
  exactApprovals: Parameters<typeof evaluateReleaseApproval>[0]["exactApprovals"];
  approvalGrants: Parameters<typeof evaluateReleaseApproval>[0]["approvalGrants"];
  health: ReleaseHealthDecision | null;
  rollbackAuthorized: boolean;
  now: string;
}): ReleasePolicyDecision {
  const requiredReviews = requiredReleaseReviewRoles({
    operation: params.operation,
    classification: params.classification,
    scopeCoordinationMaterial: params.facts.scopeCoordinationMaterial,
  });
  const checkResult = evaluateRequiredChecks(params.classification.requiredChecks, params.checks);
  const blockers = [...checkResult.blockers];
  const warnings = [...checkResult.warnings];
  const capabilityBlockers = params.classification.capabilityDiff
    .filter((entry) => entry.required && ["removed", "weakened", "unknown"].includes(entry.change))
    .map((entry) => `Required capability ${entry.id} is ${entry.change}: ${entry.reason}`);
  blockers.push(...capabilityBlockers);
  blockers.push(
    ...evaluateReviews({
      required: requiredReviews,
      reviews: params.reviews,
      confidenceThreshold: params.policy.reviewConfidenceThreshold,
    }),
  );
  if (params.health && !params.health.passed) {
    if (params.operation === "rollback" && params.health.deterministicRollbackTrigger) {
      warnings.push(...params.health.blockers.map((blocker) => `Rollback trigger: ${blocker}`));
    } else {
      blockers.push(...params.health.blockers);
    }
    if (params.health.deterministicRollbackTrigger && !params.rollbackAuthorized) {
      blockers.push("Deterministic rollback is indicated but rollback is not authorized.");
    }
  }
  if (params.operation !== "stage" && !params.health) {
    blockers.push(
      `A baseline or post-deployment health sample is required for ${params.operation}.`,
    );
  }
  if (params.operation === "rollback" && !params.rollbackAuthorized) {
    blockers.push("Rollback is not authorized by the current policy scope.");
  }
  const approval: ReleaseApprovalEvaluation = evaluateReleaseApproval({
    facts: params.facts,
    classification: params.classification,
    operation: params.operation,
    exactApprovals: params.exactApprovals,
    approvalGrants: params.approvalGrants,
    now: params.now,
  });
  if (blockers.length > 0) {
    return {
      operation: params.operation,
      decision: "deny",
      approvalMode: approval.mode,
      requiredReviewRoles: requiredReviews,
      blockers,
      warnings,
      exactApprovalWording: null,
      confidence: params.classification.confidence,
      policyVersion: params.policy.version,
    };
  }
  if (approval.mode === "none") {
    return {
      operation: params.operation,
      decision: "escalate",
      approvalMode: "none",
      requiredReviewRoles: requiredReviews,
      blockers: [approval.reason],
      warnings,
      exactApprovalWording: approvalWording(params.facts, params.operation),
      confidence: params.classification.confidence,
      policyVersion: params.policy.version,
    };
  }
  return {
    operation: params.operation,
    decision: "authorize",
    approvalMode: approval.mode,
    requiredReviewRoles: requiredReviews,
    blockers: [],
    warnings,
    exactApprovalWording: null,
    confidence: Math.min(
      params.classification.confidence,
      ...requiredReviews.map(
        (role) => params.reviews.find((review) => review.role === role)?.confidence ?? 0,
      ),
    ),
    policyVersion: params.policy.version,
  };
}

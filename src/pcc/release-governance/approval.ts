import { releasePathMatches } from "./classifier.js";
import type {
  ReleaseApprovalEvaluation,
  ReleaseApprovalGrant,
  ReleaseCandidateFacts,
  ReleaseChangeClassification,
  ReleaseExactApproval,
  ReleaseOperation,
  ReleaseRiskLevel,
} from "./contracts.js";

const RISK_SCORE: Record<ReleaseRiskLevel, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };

function activeAt(record: { expiresAt?: string; revokedAt?: string }, now: string): boolean {
  if (record.revokedAt) {
    return false;
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    return false;
  }
  if (!record.expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(record.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function findExactReleaseApproval(params: {
  approvals: readonly ReleaseExactApproval[];
  facts: ReleaseCandidateFacts;
  operation: ReleaseOperation;
  now: string;
}): ReleaseApprovalEvaluation | null {
  const destination = params.facts.destination ?? "local-only";
  const approval = params.approvals.find(
    (candidate) =>
      activeAt(candidate, params.now) &&
      candidate.repository === params.facts.repository &&
      candidate.branch === params.facts.branch &&
      candidate.candidateSha === params.facts.candidateSha &&
      candidate.destination === destination &&
      candidate.operations.includes(params.operation),
  );
  return approval
    ? {
        mode: "exact",
        approvalId: approval.id,
        approvalScope: `${approval.repository}:${approval.branch}@${approval.candidateSha} -> ${approval.destination}`,
        reason:
          "An active approval exactly matches the candidate, branch, destination, and operation.",
      }
    : null;
}

function grantCanCoverClassification(
  grant: ReleaseApprovalGrant,
  classification: ReleaseChangeClassification,
): boolean {
  if (classification.protectedPaths.length > 0 || classification.ambiguous) {
    return false;
  }
  if (RISK_SCORE[classification.riskLevel] > RISK_SCORE[grant.maximumRisk]) {
    return false;
  }
  if (
    classification.capabilityDiff.some((entry) =>
      ["removed", "weakened", "unknown"].includes(entry.change),
    )
  ) {
    return false;
  }
  if (
    classification.semanticCategories.some(
      (category) => !grant.allowedChangeClasses.includes(category),
    )
  ) {
    return false;
  }
  return !classification.changedFiles.some((file) =>
    grant.forbiddenPaths.some((pattern) => releasePathMatches(pattern, file)),
  );
}

export function findBoundedReleaseApproval(params: {
  grants: readonly ReleaseApprovalGrant[];
  facts: ReleaseCandidateFacts;
  classification: ReleaseChangeClassification;
  now: string;
}): ReleaseApprovalEvaluation | null {
  const destination = params.facts.destination ?? "local-only";
  const grant = params.grants.find(
    (candidate) =>
      activeAt(candidate, params.now) &&
      candidate.project === params.facts.project &&
      candidate.repository === params.facts.repository &&
      candidate.branch === params.facts.branch &&
      candidate.destination === destination &&
      params.facts.ancestorShas.includes(candidate.approvedBaseSha) &&
      params.facts.descendantDepth <= candidate.maximumDescendantDepth &&
      params.facts.commitCount <= candidate.maximumCommitCount &&
      grantCanCoverClassification(candidate, params.classification),
  );
  return grant
    ? {
        mode: "bounded_grant",
        approvalId: grant.id,
        approvalScope: `${grant.project}:${grant.repository}:${grant.branch} descendants of ${grant.approvedBaseSha} -> ${grant.destination}`,
        reason:
          "A current bounded grant covers the complete descendant diff without expanding scope.",
      }
    : null;
}

export function evaluateReleaseApproval(params: {
  facts: ReleaseCandidateFacts;
  classification: ReleaseChangeClassification;
  operation: ReleaseOperation;
  exactApprovals: readonly ReleaseExactApproval[];
  approvalGrants: readonly ReleaseApprovalGrant[];
  now: string;
}): ReleaseApprovalEvaluation {
  const exact = findExactReleaseApproval({
    approvals: params.exactApprovals,
    facts: params.facts,
    operation: params.operation,
    now: params.now,
  });
  if (exact) {
    return exact;
  }
  const bounded = findBoundedReleaseApproval({
    grants: params.approvalGrants,
    facts: params.facts,
    classification: params.classification,
    now: params.now,
  });
  if (bounded) {
    return bounded;
  }
  const automatic =
    !params.classification.approvalRequired &&
    !params.classification.externalDisclosure &&
    (params.classification.riskLevel === "P2" || params.classification.riskLevel === "P3");
  return automatic
    ? {
        mode: "automatic",
        approvalId: null,
        approvalScope: "local low/medium-risk policy scope",
        reason:
          "The deterministic policy permits this local P2/P3 change without explicit approval.",
      }
    : {
        mode: "none",
        approvalId: null,
        approvalScope: null,
        reason: "No exact or bounded approval covers the complete candidate scope.",
      };
}

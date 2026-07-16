import { diffReleaseCapabilities } from "./capability-diff.js";
import { classifyReleaseCandidate, validateReleaseCandidateFacts } from "./classifier.js";
import type {
  ReleaseGovernorEvaluation,
  ReleaseGovernorInput,
  ReleaseGovernorPolicy,
} from "./contracts.js";
import { decideReleasePolicy } from "./decision.js";
import { evaluateReleaseHealth } from "./health.js";

export function evaluateReleaseGovernor(
  input: ReleaseGovernorInput,
  policy: ReleaseGovernorPolicy,
): ReleaseGovernorEvaluation {
  const factErrors = validateReleaseCandidateFacts(input.facts);
  if (factErrors.length > 0) {
    throw new Error(factErrors.join("\n"));
  }
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error("Release evaluation timestamp is invalid.");
  }
  const capabilityDiff = diffReleaseCapabilities({
    activeManifest: input.activeCapabilityManifest,
    candidateManifest: input.candidateCapabilityManifest,
    requiredCapabilityIds: input.requiredCapabilityIds,
  });
  const classification = classifyReleaseCandidate({
    policy,
    facts: input.facts,
    capabilityDiff,
    operation: input.operation,
  });
  const health = input.health ? evaluateReleaseHealth(input.health, policy) : null;
  const decision = decideReleasePolicy({
    policy,
    operation: input.operation,
    facts: input.facts,
    classification,
    checks: input.checks,
    reviews: input.reviews,
    exactApprovals: input.exactApprovals,
    approvalGrants: input.approvalGrants,
    health,
    rollbackAuthorized: input.rollbackAuthorized,
    now: input.now,
  });
  return { classification, capabilityDiff, health, decision };
}

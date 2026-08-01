import type { OperationsRemediationRecord } from "../types.js";
import type { OperationsRepairDomain, OperationsRepairRecipe } from "./contracts.js";

export const ACTIVE_REMEDIATION_STATUSES = new Set<OperationsRemediationRecord["status"]>([
  "eligible",
  "investigating",
  "reviewing",
  "applying",
  "verifying",
]);

const DISALLOWED_AUTOMATIC_DOMAINS = new Set<OperationsRepairDomain>([
  "security",
  "financial",
  "credential",
  "production_release",
  "destructive",
  "novel",
  "policy_expansion",
]);

export const MEDIUM_REMEDIATION_CONFIDENCE_THRESHOLD = 0.9;

export function evaluateAutomaticRemediationEligibility<Context>(
  recipe: OperationsRepairRecipe<Context>,
): { allowed: boolean; reason: string } {
  if (recipe.risk === "high") {
    return { allowed: false, reason: "High-risk repairs require explicit operator approval." };
  }
  if (DISALLOWED_AUTOMATIC_DOMAINS.has(recipe.domain)) {
    return {
      allowed: false,
      reason: `The ${recipe.domain} domain requires explicit operator approval.`,
    };
  }
  if (!recipe.reversible || !recipe.rollbackRepair || !recipe.verifyRollback) {
    return {
      allowed: false,
      reason: "Automatic repair is missing a rollback point or rollback verification.",
    };
  }
  if (
    recipe.verificationMode !== "authoritative_readback" ||
    recipe.rollbackVerificationMode !== "authoritative_readback"
  ) {
    return {
      allowed: false,
      reason: "Automatic repair is missing independent authoritative read-back verification.",
    };
  }
  if (
    recipe.risk === "medium" &&
    (!Number.isFinite(recipe.confidence) ||
      recipe.confidence < MEDIUM_REMEDIATION_CONFIDENCE_THRESHOLD ||
      recipe.confidence > 1)
  ) {
    return {
      allowed: false,
      reason: "Medium-risk repair is missing rollback, rollback verification, or high confidence.",
    };
  }
  return { allowed: true, reason: "Approved bounded automatic repair recipe." };
}

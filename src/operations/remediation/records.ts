import crypto from "node:crypto";
import type { OperationsFinding, OperationsRemediationRecord } from "../types.js";
import type { OperationsRepairRecipe, OperationsRemediationStore } from "./contracts.js";
import { boundedRemediationText } from "./text.js";

export function createInitialRemediationRecord<Context>(
  finding: OperationsFinding,
  recipe: OperationsRepairRecipe<Context>,
  now: number,
): OperationsRemediationRecord {
  const undoTargetId = recipe.undo?.targetId(finding);
  return {
    id: crypto.randomUUID(),
    findingId: finding.id,
    findingTitle: boundedRemediationText(finding.title, 1_000, "Operations issue"),
    findingCategory: finding.category,
    ...(finding.entityId ? { findingEntityId: finding.entityId } : {}),
    impact: boundedRemediationText(finding.impact, 1_000, "Operational impact is unavailable."),
    recipeId: recipe.id,
    risk: recipe.risk,
    status: "eligible",
    ownerId: "OpenClaw",
    recommendedFix: boundedRemediationText(
      recipe.exactRepair,
      4_000,
      "Apply the approved repair recipe.",
    ),
    recommendationReason: boundedRemediationText(
      recipe.recommendationReason,
      4_000,
      "This is the approved bounded repair for the observed condition.",
    ),
    confidence: recipe.confidence,
    exactRepair: boundedRemediationText(
      recipe.exactRepair,
      4_000,
      "Apply the approved repair recipe.",
    ),
    expectedChange: boundedRemediationText(
      recipe.expectedChange,
      4_000,
      "The affected resource will move to its verified safe state.",
    ),
    verificationPlan: boundedRemediationText(
      recipe.verificationPlan,
      4_000,
      "Read the authoritative resource state after the repair.",
    ),
    progress: "Approved recipe matched the current issue.",
    evidence: [],
    rollback: boundedRemediationText(
      recipe.rollback,
      4_000,
      "Restore the recorded rollback point.",
    ),
    progressLocation:
      "Progress appears here while work runs and under Since your last visit when it finishes.",
    undoAvailable: false,
    ...(recipe.undo && undoTargetId
      ? {
          undoAction: recipe.undo.action,
          undoTargetId,
        }
      : {}),
    automatic: true,
    startedAt: now,
    updatedAt: now,
  };
}

export function updateRemediationRecord(
  store: OperationsRemediationStore,
  record: OperationsRemediationRecord,
  now: number,
  update: Partial<OperationsRemediationRecord>,
): OperationsRemediationRecord {
  const next = { ...record, ...update, updatedAt: now };
  store.upsert(next);
  return next;
}

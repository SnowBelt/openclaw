import crypto from "node:crypto";
import { redactSensitiveText } from "../logging/redact.js";
import type {
  OperationsFinding,
  OperationsRemediationRecord,
  OperationsRemediationRisk,
} from "./types.js";

export type OperationsRepairDomain =
  | "routine"
  | "security"
  | "financial"
  | "credential"
  | "production_release"
  | "destructive"
  | "novel"
  | "policy_expansion";

export type OperationsRepairVerification = {
  passed: boolean;
  evidence: string;
};

export type OperationsRepairRecipe<Context = unknown> = {
  id: string;
  risk: OperationsRemediationRisk;
  domain: OperationsRepairDomain;
  confidence: number;
  recommendationReason: string;
  exactRepair: string;
  expectedChange: string;
  verificationPlan: string;
  rollback: string;
  reversible: boolean;
  verificationMode: "authoritative_readback";
  rollbackVerificationMode: "authoritative_readback";
  undo?: {
    action: "cron.enable" | "cron.disable";
    targetId: (finding: OperationsFinding) => string | undefined;
  };
  matches: (finding: OperationsFinding, context: Context) => boolean;
  apply: (finding: OperationsFinding, context: Context) => Promise<void>;
  verify: (finding: OperationsFinding, context: Context) => Promise<OperationsRepairVerification>;
  rollbackRepair?: (finding: OperationsFinding, context: Context) => Promise<void>;
  verifyRollback?: (
    finding: OperationsFinding,
    context: Context,
  ) => Promise<OperationsRepairVerification>;
};

export type OperationsRemediationAiReview<Context = unknown> = {
  investigate: (input: {
    finding: OperationsFinding;
    recipe: OperationsRepairRecipe<Context>;
  }) => Promise<{ confidence: number; recommendation: string }>;
  judge: (input: {
    finding: OperationsFinding;
    recipe: OperationsRepairRecipe<Context>;
    investigation: { confidence: number; recommendation: string };
  }) => Promise<{ approved: boolean; reason: string }>;
  recommend?: (input: { finding: OperationsFinding }) => Promise<{
    risk: OperationsRemediationRisk;
    domain: OperationsRepairDomain;
    confidence: number;
    recommendedFix: string;
    reason: string;
    expectedChange: string;
    verificationPlan: string;
    rollback: string;
  }>;
  judgeRecommendation?: (input: {
    finding: OperationsFinding;
    recommendation: {
      risk: OperationsRemediationRisk;
      domain: OperationsRepairDomain;
      confidence: number;
      recommendedFix: string;
      reason: string;
      expectedChange: string;
      verificationPlan: string;
      rollback: string;
    };
  }) => Promise<{ approved: boolean; reason: string }>;
};

export type OperationsRemediationStore = {
  list: () => OperationsRemediationRecord[];
  upsert: (record: OperationsRemediationRecord) => void;
};

const ACTIVE_REMEDIATION_STATUSES = new Set<OperationsRemediationRecord["status"]>([
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
const MEDIUM_CONFIDENCE_THRESHOLD = 0.9;

function boundedStoredText(value: unknown, maxLength: number, fallback: string): string {
  const text = typeof value === "string" ? value : String(value);
  return (
    redactSensitiveText(text, { mode: "tools" }).replace(/\s+/gu, " ").trim().slice(0, maxLength) ||
    fallback
  );
}

function boundedFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return boundedStoredText(message, 2_000, "Automatic repair failed without a safe error message.");
}

function automaticEligibility<Context>(recipe: OperationsRepairRecipe<Context>): {
  allowed: boolean;
  reason: string;
} {
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
  if (recipe.risk === "medium") {
    if (
      !Number.isFinite(recipe.confidence) ||
      recipe.confidence < MEDIUM_CONFIDENCE_THRESHOLD ||
      recipe.confidence > 1
    ) {
      return {
        allowed: false,
        reason:
          "Medium-risk repair is missing rollback, rollback verification, or high confidence.",
      };
    }
  }
  return { allowed: true, reason: "Approved bounded automatic repair recipe." };
}

function initialRecord<Context>(
  finding: OperationsFinding,
  recipe: OperationsRepairRecipe<Context>,
  now: number,
): OperationsRemediationRecord {
  const undoTargetId = recipe.undo?.targetId(finding);
  return {
    id: crypto.randomUUID(),
    findingId: finding.id,
    findingTitle: boundedStoredText(finding.title, 1_000, "Operations issue"),
    findingCategory: finding.category,
    ...(finding.entityId ? { findingEntityId: finding.entityId } : {}),
    impact: boundedStoredText(finding.impact, 1_000, "Operational impact is unavailable."),
    recipeId: recipe.id,
    risk: recipe.risk,
    status: "eligible",
    ownerId: "OpenClaw",
    recommendedFix: boundedStoredText(
      recipe.exactRepair,
      4_000,
      "Apply the approved repair recipe.",
    ),
    recommendationReason: boundedStoredText(
      recipe.recommendationReason,
      4_000,
      "This is the approved bounded repair for the observed condition.",
    ),
    confidence: recipe.confidence,
    exactRepair: boundedStoredText(recipe.exactRepair, 4_000, "Apply the approved repair recipe."),
    expectedChange: boundedStoredText(
      recipe.expectedChange,
      4_000,
      "The affected resource will move to its verified safe state.",
    ),
    verificationPlan: boundedStoredText(
      recipe.verificationPlan,
      4_000,
      "Read the authoritative resource state after the repair.",
    ),
    progress: "Approved recipe matched the current issue.",
    evidence: [],
    rollback: boundedStoredText(recipe.rollback, 4_000, "Restore the recorded rollback point."),
    progressLocation:
      "Progress appears here while work runs and under Since your last visit when it finishes.",
    // Undo becomes available only after a verified mutation has completed. A
    // pending recommendation must never imply that anything can be undone.
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

async function createAdvisoryRecommendation<Context>(params: {
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
    findingTitle: boundedStoredText(params.finding.title, 1_000, "Operations issue"),
    findingCategory: params.finding.category,
    ...(params.finding.entityId ? { findingEntityId: params.finding.entityId } : {}),
    impact: boundedStoredText(params.finding.impact, 1_000, "Operational impact is unavailable."),
    recipeId: "local-ai.recommendation.v1",
    risk: proposal.risk,
    status: "approval_required",
    ownerId: "OpenClaw",
    recommendedFix: boundedStoredText(
      proposal.recommendedFix,
      4_000,
      "Investigate the issue before changing anything.",
    ),
    recommendationReason: boundedStoredText(
      proposal.reason,
      4_000,
      "Local investigation identified this as the safest next step.",
    ),
    confidence: proposal.confidence,
    exactRepair: boundedStoredText(
      proposal.recommendedFix,
      4_000,
      "No executable repair is approved.",
    ),
    expectedChange: boundedStoredText(
      proposal.expectedChange,
      4_000,
      "No change occurs until an approved repair recipe exists.",
    ),
    verificationPlan: boundedStoredText(
      proposal.verificationPlan,
      4_000,
      "Verify the affected authoritative source after an approved repair.",
    ),
    progress: judge.approved
      ? "Local investigation and independent safety review produced a recommendation; an approved executable recipe is still required."
      : "Independent safety review rejected automatic execution; Codex review is required.",
    result: "No automatic change was made.",
    evidence: [],
    rollback: boundedStoredText(
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
      reason: boundedStoredText(
        judge.reason,
        2_000,
        "Independent safety review returned no reason.",
      ),
    },
    investigation: {
      model: "qwen3.6:27b-q8_0",
      confidence: proposal.confidence,
      recommendation: boundedStoredText(
        proposal.recommendedFix,
        2_000,
        "Local investigation returned no safe recommendation.",
      ),
    },
  };
  params.store.upsert(record);
  return record;
}

function recordUpdate(
  store: OperationsRemediationStore,
  record: OperationsRemediationRecord,
  now: number,
  update: Partial<OperationsRemediationRecord>,
): OperationsRemediationRecord {
  const next = { ...record, ...update, updatedAt: now };
  store.upsert(next);
  return next;
}

export function recoverInterruptedOperationsRemediations(params: {
  store: OperationsRemediationStore;
  now?: () => number;
}): OperationsRemediationRecord[] {
  const now = params.now ?? Date.now;
  const recovered: OperationsRemediationRecord[] = [];
  for (const record of params.store.list()) {
    if (!ACTIVE_REMEDIATION_STATUSES.has(record.status)) {
      continue;
    }
    const mutationMayHaveStarted = record.status === "applying" || record.status === "verifying";
    const recoveredRecord = recordUpdate(params.store, record, now(), {
      completedAt: now(),
      status: "failed",
      undoAvailable: false,
      progress:
        "Automatic repair was interrupted by a Gateway lifecycle transition and needs operator review.",
      result: mutationMayHaveStarted
        ? "Repair state is uncertain after interruption. Confirm current state before using guarded Undo."
        : "No runtime mutation was confirmed before the interruption.",
    });
    recovered.push(recoveredRecord);
  }
  return recovered;
}

async function applyAndVerifyRepair<Context>(params: {
  finding: OperationsFinding;
  context: Context;
  recipe: OperationsRepairRecipe<Context>;
  record: OperationsRemediationRecord;
  store: OperationsRemediationStore;
  automatic: boolean;
  now: () => number;
}): Promise<OperationsRemediationRecord> {
  let record = params.record;
  let mutationApplied = false;
  const progressPrefix = params.automatic ? "Automatic repair" : "Confirmed repair";
  try {
    record = recordUpdate(params.store, record, params.now(), {
      automatic: params.automatic,
      status: "applying",
      undoAvailable: false,
      progress: "Applying the exact bounded repair.",
      result: undefined,
    });
    await params.recipe.apply(params.finding, params.context);
    mutationApplied = true;
    record = recordUpdate(params.store, record, params.now(), {
      status: "verifying",
      undoAvailable: false,
      progress: "Running deterministic post-repair verification.",
    });
    const verification = await params.recipe.verify(params.finding, params.context);
    record.evidence = [
      ...record.evidence,
      boundedStoredText(verification.evidence, 4_000, "Verification returned no safe evidence."),
    ];
    if (!verification.passed) {
      if (
        !params.recipe.reversible ||
        !params.recipe.rollbackRepair ||
        !params.recipe.verifyRollback
      ) {
        throw new Error(`Post-repair verification failed: ${verification.evidence}`);
      }
      try {
        await params.recipe.rollbackRepair(params.finding, params.context);
        const rollbackVerification = await params.recipe.verifyRollback(
          params.finding,
          params.context,
        );
        record.evidence = [
          ...record.evidence,
          boundedStoredText(
            rollbackVerification.evidence,
            4_000,
            "Rollback verification returned no safe evidence.",
          ),
        ];
        return recordUpdate(
          params.store,
          record,
          params.now(),
          rollbackVerification.passed
            ? {
                completedAt: params.now(),
                rolledBackAt: params.now(),
                status: "rolled_back",
                undoAvailable: false,
                progress: "Verification failed, so OpenClaw restored the rollback point.",
                result: `${progressPrefix} was undone because verification did not pass.`,
              }
            : {
                completedAt: params.now(),
                status: "failed",
                undoAvailable: false,
                progress: `${params.automatic ? "Automatic repair" : "Repair"} stopped; rollback could not be verified and needs operator review.`,
                result:
                  `Repair verification failed. Rollback did not verify: ${boundedFailureMessage(
                    new Error(rollbackVerification.evidence),
                  )}`.slice(0, 4_000),
              },
        );
      } catch (rollbackError) {
        return recordUpdate(params.store, record, params.now(), {
          completedAt: params.now(),
          status: "failed",
          undoAvailable: false,
          progress: `${params.automatic ? "Automatic repair" : "Repair"} stopped; rollback could not be verified and needs operator review.`,
          result: `Repair verification failed. Rollback did not verify: ${boundedFailureMessage(
            rollbackError,
          )}`.slice(0, 4_000),
        });
      }
    }
    return recordUpdate(params.store, record, params.now(), {
      completedAt: params.now(),
      status: "completed",
      undoAvailable: Boolean(params.recipe.undo && record.undoTargetId),
      progress: "Repair completed and deterministic verification passed.",
      result: boundedStoredText(
        verification.evidence,
        4_000,
        "Repair completed and verification passed.",
      ),
    });
  } catch (error) {
    const message = boundedFailureMessage(error);
    let rollbackFailure: string | undefined;
    if (
      mutationApplied &&
      params.recipe.reversible &&
      params.recipe.rollbackRepair &&
      params.recipe.verifyRollback
    ) {
      try {
        await params.recipe.rollbackRepair(params.finding, params.context);
        const rollbackVerification = await params.recipe.verifyRollback(
          params.finding,
          params.context,
        );
        record.evidence = [
          ...record.evidence,
          boundedStoredText(
            rollbackVerification.evidence,
            4_000,
            "Rollback verification returned no safe evidence.",
          ),
        ];
        if (rollbackVerification.passed) {
          return recordUpdate(params.store, record, params.now(), {
            completedAt: params.now(),
            rolledBackAt: params.now(),
            status: "rolled_back",
            undoAvailable: false,
            progress: "Repair failed, so OpenClaw restored the rollback point.",
            result: message,
          });
        }
        rollbackFailure = boundedFailureMessage(
          new Error(`Rollback verification failed: ${rollbackVerification.evidence}`),
        );
      } catch (rollbackError) {
        rollbackFailure = boundedFailureMessage(rollbackError);
      }
    }
    return recordUpdate(params.store, record, params.now(), {
      automatic: params.automatic,
      completedAt: params.now(),
      status: "failed",
      undoAvailable: false,
      progress: rollbackFailure
        ? `${params.automatic ? "Automatic repair" : "Repair"} stopped; rollback could not be verified and needs operator review.`
        : `${params.automatic ? "Automatic repair" : "Repair"} stopped before a change completed and needs operator review.`,
      result: rollbackFailure
        ? `${message} Rollback did not verify: ${rollbackFailure}`.slice(0, 4_000)
        : message,
    });
  }
}

export async function applyConfirmedOperationsRemediation<Context>(params: {
  recordId: string;
  finding: OperationsFinding;
  context: Context;
  recipes: OperationsRepairRecipe<Context>[];
  store: OperationsRemediationStore;
  now?: () => number;
}): Promise<OperationsRemediationRecord> {
  const now = params.now ?? Date.now;
  const record = params.store.list().find((entry) => entry.id === params.recordId);
  if (!record || record.findingId !== params.finding.id) {
    throw new Error("Recommended repair record no longer matches the current issue");
  }
  if (record.status !== "confirmation_required" || record.risk !== "medium") {
    throw new Error("Recommended repair is not eligible for one-confirmation execution");
  }
  if (
    !record.judge?.approved ||
    (record.investigation?.confidence ?? 0) < MEDIUM_CONFIDENCE_THRESHOLD
  ) {
    throw new Error("Recommended repair is missing high-confidence independent safety approval");
  }
  const recipe = params.recipes.find((candidate) => candidate.id === record.recipeId);
  if (!recipe || !recipe.matches(params.finding, params.context)) {
    throw new Error("Approved repair recipe no longer matches the current issue");
  }
  const eligibility = automaticEligibility(recipe);
  if (!eligibility.allowed || recipe.risk !== "medium") {
    throw new Error(eligibility.reason);
  }
  return await applyAndVerifyRepair({
    finding: params.finding,
    context: params.context,
    recipe,
    record,
    store: params.store,
    automatic: false,
    now,
  });
}

export async function runOperationsRemediationSweep<Context>(params: {
  findings: OperationsFinding[];
  context: Context;
  recipes: OperationsRepairRecipe<Context>[];
  store: OperationsRemediationStore;
  ai: OperationsRemediationAiReview<Context>;
  now?: () => number;
  maxRepairs?: number;
}): Promise<OperationsRemediationRecord[]> {
  const now = params.now ?? Date.now;
  const maxRepairs = Math.max(1, Math.min(params.maxRepairs ?? 2, 5));
  const existing = params.store.list();
  const handledFindingIds = new Set(existing.map((record) => record.findingId));
  const outputs: OperationsRemediationRecord[] = [];

  for (const finding of params.findings) {
    if (outputs.length >= maxRepairs || handledFindingIds.has(finding.id)) {
      continue;
    }
    const matchingRecipes = params.recipes.filter((recipe) =>
      recipe.matches(finding, params.context),
    );
    if (matchingRecipes.length === 0) {
      try {
        const advisory = await createAdvisoryRecommendation({
          finding,
          ai: params.ai,
          store: params.store,
          now,
        });
        if (advisory) {
          handledFindingIds.add(finding.id);
          outputs.push(advisory);
        }
      } catch {
        // Recommendation generation is advisory-only. Fail closed without persisting an
        // invented plan; the existing issue remains visible with its deterministic next step.
      }
      continue;
    }
    if (matchingRecipes.length !== 1) {
      continue;
    }
    const recipe = matchingRecipes[0];
    let record = initialRecord(finding, recipe, now());
    const eligibility = automaticEligibility(recipe);
    if (!eligibility.allowed) {
      record = recordUpdate(params.store, record, now(), {
        automatic: false,
        status: "approval_required",
        undoAvailable: false,
        progress: eligibility.reason,
        result: "No automatic change was made.",
      });
      outputs.push(record);
      continue;
    }
    params.store.upsert(record);
    handledFindingIds.add(finding.id);
    try {
      if (recipe.risk === "medium") {
        record = recordUpdate(params.store, record, now(), {
          status: "investigating",
          progress: "Local AI is reviewing the bounded repair recipe.",
        });
        const investigation = await params.ai.investigate({ finding, recipe });
        record = recordUpdate(params.store, record, now(), {
          investigation: {
            model: "qwen3.6:27b-q8_0",
            confidence: investigation.confidence,
            recommendation: boundedStoredText(
              investigation.recommendation,
              2_000,
              "Local investigation returned no safe summary.",
            ),
          },
          status: "reviewing",
          progress: "Independent local Judge is reviewing repair safety.",
        });
        if (
          !Number.isFinite(investigation.confidence) ||
          investigation.confidence < MEDIUM_CONFIDENCE_THRESHOLD
        ) {
          record = recordUpdate(params.store, record, now(), {
            automatic: false,
            status: "approval_required",
            undoAvailable: false,
            progress: "Local investigation confidence is below the automatic repair threshold.",
            result: "No automatic change was made.",
          });
          outputs.push(record);
          continue;
        }
        const judge = await params.ai.judge({ finding, recipe, investigation });
        record = recordUpdate(params.store, record, now(), {
          judge: {
            model: "openclaw-judge-qwen35-27b-q8:latest",
            approved: judge.approved,
            reason: boundedStoredText(
              judge.reason,
              2_000,
              "Independent Judge returned no safe reason.",
            ),
          },
        });
        if (!judge.approved) {
          record = recordUpdate(params.store, record, now(), {
            automatic: false,
            status: "approval_required",
            undoAvailable: false,
            progress: "Independent local Judge did not approve automatic execution.",
            result: "No automatic change was made.",
          });
          outputs.push(record);
          continue;
        }
        record = recordUpdate(params.store, record, now(), {
          automatic: false,
          status: "confirmation_required",
          undoAvailable: false,
          progress: "Safety review passed. One confirmation is required to apply this repair.",
          result: "No change has been made yet.",
        });
        outputs.push(record);
        continue;
      }
      record = await applyAndVerifyRepair({
        finding,
        context: params.context,
        recipe,
        record,
        store: params.store,
        automatic: true,
        now,
      });
      outputs.push(record);
    } catch (error) {
      record = recordUpdate(params.store, record, now(), {
        automatic: recipe.risk === "low",
        completedAt: now(),
        status: "failed",
        undoAvailable: false,
        progress: "Repair safety review failed before a change was made.",
        result: boundedFailureMessage(error),
      });
      outputs.push(record);
    }
  }
  return outputs;
}

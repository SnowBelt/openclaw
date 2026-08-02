import type { OperationsFinding, OperationsRemediationRecord } from "../types.js";
import type {
  OperationsRemediationAiReview,
  OperationsRemediationStore,
  OperationsRepairRecipe,
} from "./contracts.js";
import { executeAndVerifyRemediation } from "./execution.js";
import {
  ACTIVE_REMEDIATION_STATUSES,
  evaluateAutomaticRemediationEligibility,
  MEDIUM_REMEDIATION_CONFIDENCE_THRESHOLD,
} from "./policy.js";
import { createAdvisoryRemediationRecommendation } from "./recommendation.js";
import { createInitialRemediationRecord, updateRemediationRecord } from "./records.js";
import { boundedRemediationFailure, boundedRemediationText } from "./text.js";

type AdvisoryRemediationRequest = {
  fingerprint: string;
  promise: Promise<OperationsRemediationRecord | null>;
};

const advisoryRemediationRequests = new Map<string, AdvisoryRemediationRequest>();

function advisoryFindingFingerprint(finding: OperationsFinding): string {
  return JSON.stringify([
    finding.id,
    finding.category,
    finding.entityId ?? null,
    finding.severity,
    finding.title,
    finding.impact ?? null,
    finding.ownerId ?? null,
    finding.nextAction ?? finding.recommendedAction ?? null,
  ]);
}

function latestRemediationForFinding(
  store: OperationsRemediationStore,
  findingId: string,
): OperationsRemediationRecord | undefined {
  return store
    .list()
    .filter((record) => record.findingId === findingId)
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    )[0];
}

async function createAdvisoryRemediationRecommendationOnce<Context>(params: {
  finding: OperationsFinding;
  ai: OperationsRemediationAiReview<Context>;
  store: OperationsRemediationStore;
  now: () => number;
}): Promise<OperationsRemediationRecord | null> {
  const existing = latestRemediationForFinding(params.store, params.finding.id);
  if (existing) {
    return existing;
  }

  const fingerprint = advisoryFindingFingerprint(params.finding);
  const current = advisoryRemediationRequests.get(params.finding.id);
  if (current) {
    if (current.fingerprint !== fingerprint) {
      throw new Error("Issue identity changed while local investigation was already running");
    }
    const sharedRecord = await current.promise;
    if (sharedRecord && !params.store.list().some((record) => record.id === sharedRecord.id)) {
      params.store.upsert(sharedRecord);
    }
    return sharedRecord;
  }

  const promise = createAdvisoryRemediationRecommendation(params);
  advisoryRemediationRequests.set(params.finding.id, { fingerprint, promise });
  try {
    return await promise;
  } finally {
    const latest = advisoryRemediationRequests.get(params.finding.id);
    if (latest?.promise === promise) {
      advisoryRemediationRequests.delete(params.finding.id);
    }
  }
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
    const recoveredRecord = updateRemediationRecord(params.store, record, now(), {
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
    (record.investigation?.confidence ?? 0) < MEDIUM_REMEDIATION_CONFIDENCE_THRESHOLD
  ) {
    throw new Error("Recommended repair is missing high-confidence independent safety approval");
  }
  const recipe = params.recipes.find((candidate) => candidate.id === record.recipeId);
  if (!recipe || !recipe.matches(params.finding, params.context)) {
    throw new Error("Approved repair recipe no longer matches the current issue");
  }
  const eligibility = evaluateAutomaticRemediationEligibility(recipe);
  if (!eligibility.allowed || recipe.risk !== "medium") {
    throw new Error(eligibility.reason);
  }
  return await executeAndVerifyRemediation({
    finding: params.finding,
    context: params.context,
    recipe,
    record,
    store: params.store,
    automatic: false,
    now,
  });
}

async function reviewMediumRiskRecipe<Context>(params: {
  finding: OperationsFinding;
  recipe: OperationsRepairRecipe<Context>;
  record: OperationsRemediationRecord;
  store: OperationsRemediationStore;
  ai: OperationsRemediationAiReview<Context>;
  now: () => number;
}): Promise<OperationsRemediationRecord> {
  let record = updateRemediationRecord(params.store, params.record, params.now(), {
    status: "investigating",
    progress: "Local AI is reviewing the bounded repair recipe.",
  });
  const investigation = await params.ai.investigate({
    finding: params.finding,
    recipe: params.recipe,
  });
  record = updateRemediationRecord(params.store, record, params.now(), {
    investigation: {
      model: "qwen3.6:27b-q8_0",
      confidence: investigation.confidence,
      recommendation: boundedRemediationText(
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
    investigation.confidence < MEDIUM_REMEDIATION_CONFIDENCE_THRESHOLD
  ) {
    return updateRemediationRecord(params.store, record, params.now(), {
      automatic: false,
      status: "approval_required",
      undoAvailable: false,
      progress: "Local investigation confidence is below the automatic repair threshold.",
      result: "No automatic change was made.",
    });
  }
  const judge = await params.ai.judge({
    finding: params.finding,
    recipe: params.recipe,
    investigation,
  });
  record = updateRemediationRecord(params.store, record, params.now(), {
    judge: {
      model: "openclaw-judge-qwen35-27b-q8:latest",
      approved: judge.approved,
      reason: boundedRemediationText(
        judge.reason,
        2_000,
        "Independent Judge returned no safe reason.",
      ),
    },
  });
  if (!judge.approved) {
    return updateRemediationRecord(params.store, record, params.now(), {
      automatic: false,
      status: "approval_required",
      undoAvailable: false,
      progress: "Independent local Judge did not approve automatic execution.",
      result: "No automatic change was made.",
    });
  }
  return updateRemediationRecord(params.store, record, params.now(), {
    automatic: false,
    status: "confirmation_required",
    undoAvailable: false,
    progress: "Safety review passed. One confirmation is required to apply this repair.",
    result: "No change has been made yet.",
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
        const advisory = await createAdvisoryRemediationRecommendationOnce({
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
        // Advisory generation is fail-closed; the deterministic issue remains visible.
      }
      continue;
    }
    if (matchingRecipes.length !== 1) {
      continue;
    }
    const recipe = matchingRecipes[0];
    let record = createInitialRemediationRecord(finding, recipe, now());
    const eligibility = evaluateAutomaticRemediationEligibility(recipe);
    if (!eligibility.allowed) {
      record = updateRemediationRecord(params.store, record, now(), {
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
      record =
        recipe.risk === "medium"
          ? await reviewMediumRiskRecipe({
              finding,
              recipe,
              record,
              store: params.store,
              ai: params.ai,
              now,
            })
          : await executeAndVerifyRemediation({
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
      record = updateRemediationRecord(params.store, record, now(), {
        automatic: recipe.risk === "low",
        completedAt: now(),
        status: "failed",
        undoAvailable: false,
        progress: "Repair safety review failed before a change was made.",
        result: boundedRemediationFailure(error),
      });
      outputs.push(record);
    }
  }
  return outputs;
}

/**
 * Run the explicit, non-mutating recommendation path for one issue.
 *
 * A recommendation is persisted as evidence, never as an executable repair.
 * Existing records win so repeated clicks cannot create competing plans.
 */
export async function investigateOperationsRemediation<Context>(params: {
  finding: OperationsFinding;
  ai: OperationsRemediationAiReview<Context>;
  store: OperationsRemediationStore;
  now?: () => number;
}): Promise<OperationsRemediationRecord> {
  const existing = latestRemediationForFinding(params.store, params.finding.id);
  if (existing) {
    return existing;
  }
  const recommendation = await createAdvisoryRemediationRecommendationOnce({
    finding: params.finding,
    ai: params.ai,
    store: params.store,
    now: params.now ?? Date.now,
  });
  if (!recommendation) {
    throw new Error("Local recommendation is unavailable for this issue");
  }
  return recommendation;
}

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
  exactRepair: string;
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
    exactRepair: boundedStoredText(recipe.exactRepair, 4_000, "Apply the approved repair recipe."),
    progress: "Approved recipe matched the current issue.",
    evidence: [],
    rollback: boundedStoredText(recipe.rollback, 4_000, "Restore the recorded rollback point."),
    undoAvailable: Boolean(recipe.undo && undoTargetId),
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
        progress: eligibility.reason,
        result: "No automatic change was made.",
      });
      outputs.push(record);
      continue;
    }
    params.store.upsert(record);
    handledFindingIds.add(finding.id);
    let mutationApplied = false;

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
            progress: "Independent local Judge did not approve automatic execution.",
            result: "No automatic change was made.",
          });
          outputs.push(record);
          continue;
        }
      }

      record = recordUpdate(params.store, record, now(), {
        status: "applying",
        progress: "Applying the exact bounded repair.",
      });
      await recipe.apply(finding, params.context);
      mutationApplied = true;
      record = recordUpdate(params.store, record, now(), {
        status: "verifying",
        progress: "Running deterministic post-repair verification.",
      });
      const verification = await recipe.verify(finding, params.context);
      record.evidence = [
        ...record.evidence,
        boundedStoredText(verification.evidence, 4_000, "Verification returned no safe evidence."),
      ];
      if (!verification.passed) {
        if (!recipe.reversible || !recipe.rollbackRepair || !recipe.verifyRollback) {
          throw new Error(`Post-repair verification failed: ${verification.evidence}`);
        }
        try {
          await recipe.rollbackRepair(finding, params.context);
          const rollbackVerification = await recipe.verifyRollback(finding, params.context);
          record.evidence = [
            ...record.evidence,
            boundedStoredText(
              rollbackVerification.evidence,
              4_000,
              "Rollback verification returned no safe evidence.",
            ),
          ];
          record = recordUpdate(
            params.store,
            record,
            now(),
            rollbackVerification.passed
              ? {
                  completedAt: now(),
                  rolledBackAt: now(),
                  status: "rolled_back",
                  progress: "Verification failed, so OpenClaw restored the rollback point.",
                  result: "Automatic repair was undone because verification did not pass.",
                }
              : {
                  completedAt: now(),
                  status: "failed",
                  progress:
                    "Automatic repair stopped; rollback could not be verified and needs operator review.",
                  result:
                    `Repair verification failed. Rollback did not verify: ${boundedFailureMessage(
                      new Error(rollbackVerification.evidence),
                    )}`.slice(0, 4_000),
                },
          );
        } catch (rollbackError) {
          record = recordUpdate(params.store, record, now(), {
            completedAt: now(),
            status: "failed",
            progress:
              "Automatic repair stopped; rollback could not be verified and needs operator review.",
            result: `Repair verification failed. Rollback did not verify: ${boundedFailureMessage(
              rollbackError,
            )}`.slice(0, 4_000),
          });
        }
        outputs.push(record);
        continue;
      }
      record = recordUpdate(params.store, record, now(), {
        completedAt: now(),
        status: "completed",
        progress: "Repair completed and deterministic verification passed.",
        result: boundedStoredText(
          verification.evidence,
          4_000,
          "Repair completed and verification passed.",
        ),
      });
      outputs.push(record);
    } catch (error) {
      const message = boundedFailureMessage(error);
      let rollbackFailure: string | undefined;
      if (mutationApplied && recipe.reversible && recipe.rollbackRepair && recipe.verifyRollback) {
        try {
          await recipe.rollbackRepair(finding, params.context);
          const rollbackVerification = await recipe.verifyRollback(finding, params.context);
          record.evidence = [
            ...record.evidence,
            boundedStoredText(
              rollbackVerification.evidence,
              4_000,
              "Rollback verification returned no safe evidence.",
            ),
          ];
          if (rollbackVerification.passed) {
            record = recordUpdate(params.store, record, now(), {
              completedAt: now(),
              rolledBackAt: now(),
              status: "rolled_back",
              progress: "Repair failed, so OpenClaw restored the rollback point.",
              result: message,
            });
            outputs.push(record);
            continue;
          }
          rollbackFailure = boundedFailureMessage(
            new Error(`Rollback verification failed: ${rollbackVerification.evidence}`),
          );
        } catch (rollbackError) {
          rollbackFailure = boundedFailureMessage(rollbackError);
        }
      }
      record = recordUpdate(params.store, record, now(), {
        automatic: true,
        completedAt: now(),
        status: "failed",
        progress: rollbackFailure
          ? "Automatic repair stopped; rollback could not be verified and needs operator review."
          : "Automatic repair stopped before a change completed and needs operator review.",
        result: rollbackFailure
          ? `${message} Rollback did not verify: ${rollbackFailure}`.slice(0, 4_000)
          : message,
      });
      outputs.push(record);
    }
  }
  return outputs;
}

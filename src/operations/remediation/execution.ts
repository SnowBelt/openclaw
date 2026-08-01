import type { OperationsFinding, OperationsRemediationRecord } from "../types.js";
import type { OperationsRepairRecipe, OperationsRemediationStore } from "./contracts.js";
import { updateRemediationRecord } from "./records.js";
import { boundedRemediationFailure, boundedRemediationText } from "./text.js";

export async function executeAndVerifyRemediation<Context>(params: {
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
    record = updateRemediationRecord(params.store, record, params.now(), {
      automatic: params.automatic,
      status: "applying",
      undoAvailable: false,
      progress: "Applying the exact bounded repair.",
      result: undefined,
    });
    await params.recipe.apply(params.finding, params.context);
    mutationApplied = true;
    record = updateRemediationRecord(params.store, record, params.now(), {
      status: "verifying",
      undoAvailable: false,
      progress: "Running deterministic post-repair verification.",
    });
    const verification = await params.recipe.verify(params.finding, params.context);
    record.evidence = [
      ...record.evidence,
      boundedRemediationText(
        verification.evidence,
        4_000,
        "Verification returned no safe evidence.",
      ),
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
          boundedRemediationText(
            rollbackVerification.evidence,
            4_000,
            "Rollback verification returned no safe evidence.",
          ),
        ];
        return updateRemediationRecord(
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
                  `Repair verification failed. Rollback did not verify: ${boundedRemediationFailure(
                    new Error(rollbackVerification.evidence),
                  )}`.slice(0, 4_000),
              },
        );
      } catch (rollbackError) {
        return updateRemediationRecord(params.store, record, params.now(), {
          completedAt: params.now(),
          status: "failed",
          undoAvailable: false,
          progress: `${params.automatic ? "Automatic repair" : "Repair"} stopped; rollback could not be verified and needs operator review.`,
          result: `Repair verification failed. Rollback did not verify: ${boundedRemediationFailure(
            rollbackError,
          )}`.slice(0, 4_000),
        });
      }
    }
    return updateRemediationRecord(params.store, record, params.now(), {
      completedAt: params.now(),
      status: "completed",
      undoAvailable: Boolean(params.recipe.undo && record.undoTargetId),
      progress: "Repair completed and deterministic verification passed.",
      result: boundedRemediationText(
        verification.evidence,
        4_000,
        "Repair completed and verification passed.",
      ),
    });
  } catch (error) {
    const message = boundedRemediationFailure(error);
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
          boundedRemediationText(
            rollbackVerification.evidence,
            4_000,
            "Rollback verification returned no safe evidence.",
          ),
        ];
        if (rollbackVerification.passed) {
          return updateRemediationRecord(params.store, record, params.now(), {
            completedAt: params.now(),
            rolledBackAt: params.now(),
            status: "rolled_back",
            undoAvailable: false,
            progress: "Repair failed, so OpenClaw restored the rollback point.",
            result: message,
          });
        }
        rollbackFailure = boundedRemediationFailure(
          new Error(`Rollback verification failed: ${rollbackVerification.evidence}`),
        );
      } catch (rollbackError) {
        rollbackFailure = boundedRemediationFailure(rollbackError);
      }
    }
    return updateRemediationRecord(params.store, record, params.now(), {
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

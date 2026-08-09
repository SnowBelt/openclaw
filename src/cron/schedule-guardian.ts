import {
  createRecoveryObligation,
  isValidRecoveryObligation,
  type RecoveryObligationV1,
} from "../tasks/recovery-obligations.js";
import type {
  ScheduledProgramCriticality,
  ScheduledProgramReliabilityContractV1,
  ScheduledProgramResourceClaim,
} from "./reliability-contract.js";
import { scheduledProgramIdempotencyKey } from "./reliability-contract.js";

const CRITICALITY_RANK: Record<ScheduledProgramCriticality, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export type ScheduleGuardianCompetingWork =
  | {
      kind: "known";
      workId: string;
      criticality: ScheduledProgramCriticality;
      resourceClaims: ScheduledProgramResourceClaim[];
      interruptible: boolean;
    }
  | {
      kind: "unknown";
      workId: string;
    };

export type ScheduleGuardianDecision = {
  action: "run" | "defer" | "skip" | "approval_required";
  reason:
    | "on_time"
    | "no_resource_conflict"
    | "scheduled_work_wins"
    | "competing_work_wins_within_lateness_budget"
    | "catch_up_skipped"
    | "catch_up_requires_approval"
    | "approval_class_requires_approval"
    | "unsafe_automatic_side_effect"
    | "maximum_lateness_exceeded"
    | "resume_requires_obligation"
    | "preflight_failed"
    | "completion_proof_failed"
    | "unknown_competing_work"
    | "invalid_schedule_time"
    | "cannot_safely_preempt";
  preemptCompetingWork: boolean;
  recoveryObligation?: RecoveryObligationV1;
};

function claimsConflict(
  scheduled: readonly ScheduledProgramResourceClaim[],
  competing: readonly ScheduledProgramResourceClaim[],
): boolean {
  for (const left of scheduled) {
    for (const right of competing) {
      if (
        left.resource === right.resource &&
        (left.mode === "exclusive" || right.mode === "exclusive")
      ) {
        return true;
      }
    }
  }
  return false;
}

function safeTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function automaticCatchUpIsUnsafe(contract: ScheduledProgramReliabilityContractV1): boolean {
  return (
    contract.approvalClass !== "automatic" || contract.sideEffectClass === "external_irreversible"
  );
}

/**
 * Deterministically arbitrates a due program against active remediation work.
 * It never executes work itself and emits a durable obligation whenever the
 * scheduled program is deferred.
 */
export function decideScheduledProgramExecution(params: {
  contract: ScheduledProgramReliabilityContractV1;
  flowId: string;
  scheduledFor: number;
  now?: number;
  competingWork?: ScheduleGuardianCompetingWork;
  recovering?: boolean;
}): ScheduleGuardianDecision {
  const now = params.now ?? Date.now();
  if (!safeTimestamp(now) || !safeTimestamp(params.scheduledFor)) {
    return {
      action: "approval_required",
      reason: "invalid_schedule_time",
      preemptCompetingWork: false,
    };
  }
  if (params.contract.approvalClass !== "automatic") {
    return {
      action: "approval_required",
      reason: "approval_class_requires_approval",
      preemptCompetingWork: false,
    };
  }
  if (params.contract.sideEffectClass === "external_irreversible") {
    return {
      action: "approval_required",
      reason: "unsafe_automatic_side_effect",
      preemptCompetingWork: false,
    };
  }
  const latenessMs = Math.max(0, now - params.scheduledFor);
  const catchUp = latenessMs > 0;

  const dueAt = params.scheduledFor + params.contract.maxLatenessMs;
  if (!safeTimestamp(dueAt) || dueAt < params.scheduledFor) {
    return {
      action: "approval_required",
      reason: "invalid_schedule_time",
      preemptCompetingWork: false,
    };
  }

  if (catchUp && params.contract.catchUpPolicy === "skip") {
    return { action: "skip", reason: "catch_up_skipped", preemptCompetingWork: false };
  }
  if (catchUp && params.contract.catchUpPolicy === "manual") {
    return {
      action: "approval_required",
      reason: "catch_up_requires_approval",
      preemptCompetingWork: false,
    };
  }
  if (catchUp && params.contract.catchUpPolicy === "resume" && !params.recovering) {
    return {
      action: "defer",
      reason: "resume_requires_obligation",
      preemptCompetingWork: false,
    };
  }
  if (catchUp && automaticCatchUpIsUnsafe(params.contract)) {
    return {
      action: "approval_required",
      reason: "unsafe_automatic_side_effect",
      preemptCompetingWork: false,
    };
  }

  if (now > dueAt) {
    return {
      action: "approval_required",
      reason: "maximum_lateness_exceeded",
      preemptCompetingWork: false,
    };
  }

  const competing = params.competingWork;
  if (!competing) {
    return {
      action: "run",
      reason: catchUp ? "no_resource_conflict" : "on_time",
      preemptCompetingWork: false,
    };
  }
  if (competing.kind === "unknown" && params.contract.resourceClaims.length > 0) {
    return {
      action: "approval_required",
      reason: "unknown_competing_work",
      preemptCompetingWork: false,
      recoveryObligation: createRecoveryObligation({
        programId: params.contract.programId,
        ownerAgentId: params.contract.ownerAgentId,
        flowId: params.flowId,
        scheduledFor: params.scheduledFor,
        dueAt,
        catchUpPolicy: params.contract.catchUpPolicy,
        idempotencyKey: scheduledProgramIdempotencyKey({
          contract: params.contract,
          flowId: params.flowId,
          scheduledFor: params.scheduledFor,
        }),
        reason: "unknown_competing_work",
        proofRequirements: params.contract.completionProof,
        now,
        status: "pending",
      }),
    };
  }
  if (competing.kind !== "known") {
    return {
      action: "approval_required",
      reason: "unknown_competing_work",
      preemptCompetingWork: false,
    };
  }
  if (!claimsConflict(params.contract.resourceClaims, competing.resourceClaims)) {
    return { action: "run", reason: "no_resource_conflict", preemptCompetingWork: false };
  }

  const scheduledRank = CRITICALITY_RANK[params.contract.criticality];
  const competingRank = CRITICALITY_RANK[competing.criticality];
  const latenessBudgetExceeded = latenessMs >= params.contract.maxLatenessMs;
  const scheduledWins = latenessBudgetExceeded || scheduledRank >= competingRank;
  if (scheduledWins) {
    if (!competing.interruptible) {
      return {
        action: "approval_required",
        reason: "cannot_safely_preempt",
        preemptCompetingWork: false,
      };
    }
    return {
      action: "run",
      reason: "scheduled_work_wins",
      preemptCompetingWork: true,
    };
  }

  const obligation = createRecoveryObligation({
    programId: params.contract.programId,
    ownerAgentId: params.contract.ownerAgentId,
    flowId: params.flowId,
    scheduledFor: params.scheduledFor,
    dueAt,
    catchUpPolicy: params.contract.catchUpPolicy,
    idempotencyKey: scheduledProgramIdempotencyKey({
      contract: params.contract,
      flowId: params.flowId,
      scheduledFor: params.scheduledFor,
    }),
    reason: "resource_conflict",
    proofRequirements: params.contract.completionProof,
    now,
  });
  return {
    action: "defer",
    reason: "competing_work_wins_within_lateness_budget",
    preemptCompetingWork: false,
    recoveryObligation: obligation,
  };
}

export type ScheduleRecoveryAction = {
  obligation: RecoveryObligationV1;
  action: "run" | "resume" | "skip" | "approval_required";
};

/** Reconciles durable obligations after restart without duplicating run-latest work. */
export function reconcileScheduleRecoveryObligations(params: {
  obligations: RecoveryObligationV1[];
  now?: number;
}): ScheduleRecoveryAction[] {
  const now = params.now ?? Date.now();
  const eligible = params.obligations.filter(
    (entry) =>
      isValidRecoveryObligation(entry) &&
      (entry.status === "pending" || entry.status === "approval_required") &&
      entry.scheduledFor <= now,
  );
  const latestByProgram = new Map<string, RecoveryObligationV1>();
  for (const entry of eligible) {
    if (entry.catchUpPolicy !== "run_latest") {
      continue;
    }
    const current = latestByProgram.get(entry.programId);
    if (!current || entry.scheduledFor > current.scheduledFor) {
      latestByProgram.set(entry.programId, entry);
    }
  }
  return eligible.map((obligation) => {
    if (obligation.catchUpPolicy === "manual") {
      return { obligation, action: "approval_required" };
    }
    if (obligation.catchUpPolicy === "skip") {
      return { obligation, action: "skip" };
    }
    if (
      obligation.catchUpPolicy === "run_latest" &&
      latestByProgram.get(obligation.programId)?.obligationId !== obligation.obligationId
    ) {
      return { obligation, action: "skip" };
    }
    if (
      obligation.status === "approval_required" ||
      obligation.reason === "unknown_competing_work"
    ) {
      return { obligation, action: "approval_required" };
    }
    return {
      obligation,
      action: obligation.catchUpPolicy === "resume" ? "resume" : "run",
    };
  });
}

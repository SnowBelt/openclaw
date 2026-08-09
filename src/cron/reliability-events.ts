import type { ScheduleGuardianDecision } from "./schedule-guardian.js";

/** Sanitized, stable event emitted whenever a contracted scheduled program is admitted or blocked. */
export type ScheduledProgramReliabilityEvent = {
  version: 1;
  jobId: string;
  programId: string;
  ownerAgentId: string;
  scheduledFor: number;
  observedAt: number;
  action: ScheduleGuardianDecision["action"];
  reason: ScheduleGuardianDecision["reason"];
  recoveryObligationId?: string;
  recoveryFlowId?: string;
};

/** Builds a bounded event without payload text, credentials, or task state. */
export function createScheduledProgramReliabilityEvent(params: {
  jobId: string;
  programId: string;
  ownerAgentId: string;
  scheduledFor: number;
  observedAt: number;
  decision: ScheduleGuardianDecision;
  recoveryFlowId?: string;
}): ScheduledProgramReliabilityEvent {
  return {
    version: 1,
    jobId: params.jobId,
    programId: params.programId,
    ownerAgentId: params.ownerAgentId,
    scheduledFor: params.scheduledFor,
    observedAt: params.observedAt,
    action: params.decision.action,
    reason: params.decision.reason,
    ...(params.decision.recoveryObligation
      ? { recoveryObligationId: params.decision.recoveryObligation.obligationId }
      : {}),
    ...(params.recoveryFlowId ? { recoveryFlowId: params.recoveryFlowId } : {}),
  };
}

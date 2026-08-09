import {
  createRecoveryObligation,
  listRecoveryObligations,
  persistRecoveryObligation,
  persistRecoveryObligationState,
  type RecoveryObligationV1,
} from "../tasks/recovery-obligations.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import {
  createManagedTaskFlow,
  deleteTaskFlowRecordById,
  finishFlow,
  getTaskFlowById,
  getTaskFlowRegistryRestoreFailure,
  listTaskFlowRecords,
} from "../tasks/task-flow-runtime-internal.js";
import {
  scheduledProgramIdempotencyKey,
  type ScheduledProgramCompletionProof,
} from "./reliability-contract.js";
import {
  decideScheduledProgramExecution,
  reconcileScheduleRecoveryObligations,
  type ScheduleGuardianCompetingWork,
  type ScheduleGuardianDecision,
} from "./schedule-guardian.js";
import { computeJobNextRunAtMs } from "./service/jobs.js";
import type { CronServiceState } from "./service/state.js";
import type { CronJob, CronRunStatus } from "./types.js";

const SCHEDULE_GUARDIAN_OWNER_PREFIX = "schedule-guardian:";
const SCHEDULE_GUARDIAN_RETRY_DELAY_MS = 60_000;
const MIN_SCHEDULE_GUARDIAN_RETRY_DELAY_MS = 2_000;

const CRITICALITY_RANK: Record<
  Extract<ScheduleGuardianCompetingWork, { kind: "known" }>["criticality"],
  number
> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

type KnownCompetingWork = Extract<ScheduleGuardianCompetingWork, { kind: "known" }>;

export type PendingScheduleRecovery = {
  flow: TaskFlowRecord;
  obligation: RecoveryObligationV1;
};

export type ScheduledProgramAdmission =
  | {
      action: "run";
      scheduledFor: number;
      decision?: ScheduleGuardianDecision;
      recovery?: PendingScheduleRecovery;
    }
  | {
      action: "blocked";
      scheduledFor: number;
      decision: ScheduleGuardianDecision;
      recovery?: PendingScheduleRecovery;
    };

function ownerKey(jobId: string): string {
  return `${SCHEDULE_GUARDIAN_OWNER_PREFIX}${jobId}`;
}

function mergeResourceClaims(
  left: Readonly<KnownCompetingWork["resourceClaims"]>,
  right: Readonly<KnownCompetingWork["resourceClaims"]>,
): KnownCompetingWork["resourceClaims"] {
  const modes = new Map<string, "shared" | "exclusive">();
  for (const claim of [...left, ...right]) {
    const previous = modes.get(claim.resource);
    modes.set(
      claim.resource,
      previous === "exclusive" || claim.mode === "exclusive" ? "exclusive" : "shared",
    );
  }
  return [...modes].map(([resource, mode]) => ({ resource, mode }));
}

/** Combines bounded same-tick reservations without turning known work into unknown work. */
export function combineScheduleGuardianCompetingWork(
  first: ScheduleGuardianCompetingWork | undefined,
  second: ScheduleGuardianCompetingWork | undefined,
): ScheduleGuardianCompetingWork | undefined {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  if (first.kind === "unknown" || second.kind === "unknown") {
    return { kind: "unknown", workId: "schedule-guardian:multiple-competing-work" };
  }
  return {
    kind: "known",
    workId: "schedule-guardian:combined-known-work",
    criticality:
      CRITICALITY_RANK[first.criticality] >= CRITICALITY_RANK[second.criticality]
        ? first.criticality
        : second.criticality,
    resourceClaims: mergeResourceClaims(first.resourceClaims, second.resourceClaims),
    interruptible: first.interruptible && second.interruptible,
  };
}

function listTaskFlowsSafely(): TaskFlowRecord[] {
  try {
    return listTaskFlowRecords();
  } catch {
    // Admission must fail closed when the persisted TaskFlow registry cannot
    // be read. The caller's competing-work resolver converts this into an
    // unknown active work item for resource-bearing schedules.
    return [];
  }
}

function isOpenGuardianFlow(flow: TaskFlowRecord): boolean {
  return flow.status === "queued" || flow.status === "running" || flow.status === "waiting";
}

function finishGuardianFlow(params: { flowId: string; now: number; currentStep: string }): boolean {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const flow = getTaskFlowById(params.flowId);
    if (!flow) {
      return false;
    }
    if (flow.status === "succeeded") {
      return true;
    }
    if (!isOpenGuardianFlow(flow)) {
      return false;
    }
    const result = finishFlow({
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      currentStep: params.currentStep,
      updatedAt: params.now,
      endedAt: params.now,
    });
    if (result.applied) {
      return true;
    }
    if (result.reason !== "revision_conflict") {
      return false;
    }
  }
  return false;
}

function findPendingRecovery(
  jobId: string,
  now: number,
): { recovery?: PendingScheduleRecovery; failed: boolean } {
  const flows = listTaskFlowsSafely()
    .filter((entry) => entry.ownerKey === ownerKey(jobId) && isOpenGuardianFlow(entry))
    .toSorted((left, right) => left.createdAt - right.createdAt);
  for (const initialFlow of flows) {
    let flow = initialFlow;
    const actions = reconcileScheduleRecoveryObligations({
      obligations: listRecoveryObligations(flow),
      now,
    });
    for (const action of actions) {
      if (action.action !== "skip" || action.obligation.catchUpPolicy !== "run_latest") {
        continue;
      }
      const persisted = persistRecoveryObligationState({
        flowId: flow.flowId,
        obligationId: action.obligation.obligationId,
        status: "skipped",
        disposition: "superseded by the latest run-latest recovery obligation",
        now,
      });
      if (!persisted.applied) {
        return { failed: true };
      }
      flow = persisted.flow;
    }
    const obligation = listRecoveryObligations(flow).find(
      (entry) =>
        (entry.status === "pending" || entry.status === "approval_required") &&
        entry.scheduledFor <= now,
    );
    if (obligation) {
      return { recovery: { flow, obligation }, failed: false };
    }
    if (
      !finishGuardianFlow({
        flowId: flow.flowId,
        now,
        currentStep: "All scheduled recovery obligations reached a terminal state.",
      })
    ) {
      return { failed: true };
    }
  }
  return { failed: false };
}

function findGuardianFlow(jobId: string): TaskFlowRecord | undefined {
  return listTaskFlowsSafely().find(
    (entry) => entry.ownerKey === ownerKey(jobId) && isOpenGuardianFlow(entry),
  );
}

function defaultCompetingWork(params: {
  job: Pick<CronJob, "id" | "reliability">;
}): ScheduleGuardianCompetingWork | undefined {
  const contract = params.job.reliability;
  if (!contract || contract.resourceClaims.length === 0) {
    return undefined;
  }
  const restoreFailure = getTaskFlowRegistryRestoreFailure();
  if (restoreFailure) {
    return { kind: "unknown", workId: "task-flow-registry:unavailable" };
  }
  const runningFlow = listTaskFlowRecords().find(
    (flow) => flow.status === "running" && flow.ownerKey !== ownerKey(params.job.id),
  );
  return runningFlow ? { kind: "unknown", workId: `task-flow:${runningFlow.flowId}` } : undefined;
}

async function resolveCompetingWork(params: {
  state: CronServiceState;
  job: Pick<CronJob, "id" | "reliability">;
  scheduledFor: number;
  now: number;
  reservedCompetingWork?: ScheduleGuardianCompetingWork;
}): Promise<ScheduleGuardianCompetingWork | undefined> {
  const contract = params.job.reliability;
  if (!contract || contract.resourceClaims.length === 0) {
    return undefined;
  }
  let resolved: ScheduleGuardianCompetingWork | undefined;
  if (params.state.deps.resolveScheduledProgramCompetingWork) {
    try {
      resolved = await params.state.deps.resolveScheduledProgramCompetingWork({
        job: params.job,
        scheduledFor: params.scheduledFor,
        now: params.now,
      });
    } catch {
      return { kind: "unknown", workId: "schedule-guardian:resolver-failed" };
    }
  }
  if (!resolved) {
    try {
      resolved = defaultCompetingWork(params);
    } catch {
      resolved = { kind: "unknown", workId: "schedule-guardian:state-unavailable" };
    }
  }
  return combineScheduleGuardianCompetingWork(params.reservedCompetingWork, resolved);
}

function createGuardianFlow(params: {
  job: CronJob;
  scheduledFor: number;
  now: number;
  decision: ScheduleGuardianDecision;
}): TaskFlowRecord | undefined {
  const flow = createManagedTaskFlow({
    controllerId: "schedule-guardian",
    ownerKey: ownerKey(params.job.id),
    status: params.decision.action === "skip" ? "succeeded" : "waiting",
    notifyPolicy: "state_changes",
    goal: `Recover scheduled program ${params.job.name}`,
    currentStep:
      params.decision.action === "skip"
        ? "Catch-up skipped by the declared reliability policy."
        : "Waiting for schedule admission to become safe.",
    stateJson: {},
    ...(params.decision.action === "skip"
      ? { endedAt: params.now }
      : {
          waitJson: {
            kind: "schedule_guardian",
            jobId: params.job.id,
            scheduledFor: params.scheduledFor,
            reason: params.decision.reason,
          },
        }),
    createdAt: params.now,
    updatedAt: params.now,
  });
  return flow ?? undefined;
}

function recoveryForDecision(params: {
  job: CronJob;
  flowId: string;
  scheduledFor: number;
  now: number;
  decision: ScheduleGuardianDecision;
}): RecoveryObligationV1 | undefined {
  if (params.decision.recoveryObligation) {
    return params.decision.recoveryObligation;
  }
  const dueAt = params.scheduledFor + (params.job.reliability?.maxLatenessMs ?? 0);
  if (!Number.isSafeInteger(dueAt) || dueAt < params.scheduledFor) {
    return undefined;
  }
  if (
    params.decision.reason !== "catch_up_requires_approval" &&
    params.decision.reason !== "unsafe_automatic_side_effect" &&
    params.decision.reason !== "cannot_safely_preempt" &&
    params.decision.reason !== "approval_class_requires_approval" &&
    params.decision.reason !== "maximum_lateness_exceeded" &&
    params.decision.reason !== "resume_requires_obligation" &&
    params.decision.reason !== "preflight_failed"
  ) {
    return undefined;
  }
  const contract = params.job.reliability;
  if (!contract) {
    return undefined;
  }
  return createRecoveryObligation({
    programId: contract.programId,
    ownerAgentId: contract.ownerAgentId,
    flowId: params.flowId,
    scheduledFor: params.scheduledFor,
    dueAt,
    catchUpPolicy: contract.catchUpPolicy,
    idempotencyKey: scheduledProgramIdempotencyKey({
      contract,
      flowId: params.flowId,
      scheduledFor: params.scheduledFor,
    }),
    reason:
      params.decision.reason === "cannot_safely_preempt"
        ? "resource_conflict"
        : params.decision.reason === "preflight_failed"
          ? "preflight_failed"
          : "missed_schedule",
    proofRequirements: contract.completionProof,
    now: params.now,
    ...(params.decision.action === "approval_required"
      ? { status: "approval_required" as const }
      : {}),
  });
}

function terminalCatchUpDisposition(decision: ScheduleGuardianDecision): boolean {
  return (
    decision.action === "skip" ||
    decision.reason === "catch_up_requires_approval" ||
    decision.reason === "unsafe_automatic_side_effect" ||
    decision.reason === "approval_class_requires_approval" ||
    decision.reason === "maximum_lateness_exceeded"
  );
}

async function resolvePreflight(params: {
  state: CronServiceState;
  job: CronJob;
  scheduledFor: number;
  now: number;
}): Promise<boolean> {
  const checks = params.job.reliability?.preflight ?? [];
  if (checks.length === 0) {
    return true;
  }
  const resolver = params.state.deps.resolveScheduledProgramPreflight;
  if (!resolver) {
    return false;
  }
  try {
    const satisfied = new Set(
      await resolver({
        job: params.job,
        scheduledFor: params.scheduledFor,
        now: params.now,
        checks,
      }),
    );
    return checks.every((check) => satisfied.has(check));
  } catch {
    return false;
  }
}

function deferJobUntilRetry(params: {
  state: CronServiceState;
  job: CronJob;
  now: number;
  obligation?: RecoveryObligationV1;
}): void {
  const retryAt = params.obligation
    ? Math.max(
        params.now + MIN_SCHEDULE_GUARDIAN_RETRY_DELAY_MS,
        Math.min(params.obligation.dueAt, params.now + SCHEDULE_GUARDIAN_RETRY_DELAY_MS),
      )
    : params.now + SCHEDULE_GUARDIAN_RETRY_DELAY_MS;
  params.job.state.nextRunAtMs = retryAt;
  params.state.pendingCatchupDeferralJobIds.add(params.job.id);
}

function markTerminalCatchUpSkipped(params: {
  state: CronServiceState;
  job: CronJob;
  scheduledFor: number;
  now: number;
  decision: ScheduleGuardianDecision;
}): void {
  params.job.state.lastRunAtMs = params.scheduledFor;
  params.job.state.lastRunStatus = "skipped";
  params.job.state.lastStatus = "skipped";
  params.job.state.lastError = `cron: schedule guardian ${params.decision.reason}`;
  try {
    params.job.state.nextRunAtMs = computeJobNextRunAtMs(params.job, params.now);
  } catch {
    params.job.state.nextRunAtMs = undefined;
  }
  params.state.pendingCatchupDeferralJobIds.delete(params.job.id);
}

export async function admitScheduledProgram(params: {
  state: CronServiceState;
  job: CronJob;
  now: number;
  reservedCompetingWork?: ScheduleGuardianCompetingWork;
}): Promise<ScheduledProgramAdmission> {
  const contract = params.job.reliability;
  if (!contract) {
    return { action: "run", scheduledFor: params.job.state.nextRunAtMs ?? params.now };
  }
  if (getTaskFlowRegistryRestoreFailure()) {
    const scheduledFor = params.job.state.nextRunAtMs ?? params.now;
    const decision: ScheduleGuardianDecision = {
      action: "approval_required",
      reason: "unknown_competing_work",
      preemptCompetingWork: false,
    };
    deferJobUntilRetry({ state: params.state, job: params.job, now: params.now });
    return { action: "blocked", scheduledFor, decision };
  }
  const pendingLookup = findPendingRecovery(params.job.id, params.now);
  if (pendingLookup.failed) {
    const scheduledFor = params.job.state.nextRunAtMs ?? params.now;
    const decision: ScheduleGuardianDecision = {
      action: "approval_required",
      reason: "unknown_competing_work",
      preemptCompetingWork: false,
    };
    deferJobUntilRetry({ state: params.state, job: params.job, now: params.now });
    return { action: "blocked", scheduledFor, decision };
  }
  const pending = pendingLookup.recovery;
  const scheduledFor =
    pending?.obligation.scheduledFor ?? params.job.state.nextRunAtMs ?? params.now;
  const competingWork = await resolveCompetingWork({
    state: params.state,
    job: params.job,
    scheduledFor,
    now: params.now,
    ...(params.reservedCompetingWork
      ? { reservedCompetingWork: params.reservedCompetingWork }
      : {}),
  });
  const recoveryAction = pending
    ? reconcileScheduleRecoveryObligations({
        obligations: listRecoveryObligations(pending.flow),
        now: params.now,
      }).find((entry) => entry.obligation.obligationId === pending.obligation.obligationId)
    : undefined;
  const preview =
    recoveryAction?.action === "skip"
      ? ({ action: "skip", reason: "catch_up_skipped", preemptCompetingWork: false } as const)
      : recoveryAction?.action === "approval_required"
        ? ({
            action: "approval_required",
            reason: "catch_up_requires_approval",
            preemptCompetingWork: false,
          } as const)
        : decideScheduledProgramExecution({
            contract,
            flowId: pending?.flow.flowId ?? `schedule-guardian:preview:${params.job.id}`,
            scheduledFor,
            now: params.now,
            ...(competingWork ? { competingWork } : {}),
            recovering: Boolean(pending),
          });
  const preflightPassed =
    preview.action === "run"
      ? await resolvePreflight({
          state: params.state,
          job: params.job,
          scheduledFor,
          now: params.now,
        })
      : false;
  const effectivePreview: ScheduleGuardianDecision =
    preview.action === "run" && !preflightPassed
      ? { action: "approval_required", reason: "preflight_failed", preemptCompetingWork: false }
      : preview;
  if (effectivePreview.action === "run") {
    return {
      action: "run",
      scheduledFor,
      decision: effectivePreview,
      ...(pending ? { recovery: pending } : {}),
    };
  }

  let flow = pending?.flow ?? findGuardianFlow(params.job.id);
  if (!flow) {
    flow = createGuardianFlow({
      job: params.job,
      scheduledFor,
      now: params.now,
      decision: effectivePreview,
    });
  }
  if (!flow) {
    deferJobUntilRetry({ state: params.state, job: params.job, now: params.now });
    return { action: "blocked", scheduledFor, decision: effectivePreview };
  }

  const decision =
    flow.flowId === (pending?.flow.flowId ?? "")
      ? effectivePreview
      : decideScheduledProgramExecution({
          contract,
          flowId: flow.flowId,
          scheduledFor,
          now: params.now,
          ...(competingWork ? { competingWork } : {}),
          recovering: Boolean(pending),
        });
  let obligation = pending?.obligation;
  if (!obligation) {
    try {
      obligation = recoveryForDecision({
        job: params.job,
        flowId: flow.flowId,
        scheduledFor,
        now: params.now,
        decision,
      });
    } catch {
      obligation = undefined;
    }
    if (obligation) {
      const persisted = persistRecoveryObligation({ flowId: flow.flowId, obligation });
      if (!persisted.applied) {
        deleteTaskFlowRecordById(flow.flowId);
        deferJobUntilRetry({ state: params.state, job: params.job, now: params.now });
        return { action: "blocked", scheduledFor, decision };
      }
    }
  }

  if (terminalCatchUpDisposition(decision)) {
    if (decision.action === "skip" && obligation) {
      const persisted = persistRecoveryObligationState({
        flowId: flow.flowId,
        obligationId: obligation.obligationId,
        status: "skipped",
        disposition: `catch-up skipped: ${decision.reason}`,
        now: params.now,
      });
      if (!persisted.applied) {
        deferJobUntilRetry({ state: params.state, job: params.job, now: params.now, obligation });
        return { action: "blocked", scheduledFor, decision, recovery: { flow, obligation } };
      }
      if (
        !listRecoveryObligations(persisted.flow).some(
          (entry) => entry.status === "pending" || entry.status === "approval_required",
        ) &&
        !finishGuardianFlow({
          flowId: flow.flowId,
          now: params.now,
          currentStep: "Scheduled catch-up was skipped by the declared reliability policy.",
        })
      ) {
        deferJobUntilRetry({ state: params.state, job: params.job, now: params.now, obligation });
        return { action: "blocked", scheduledFor, decision, recovery: { flow, obligation } };
      }
    }
    markTerminalCatchUpSkipped({
      state: params.state,
      job: params.job,
      scheduledFor,
      now: params.now,
      decision,
    });
  } else {
    deferJobUntilRetry({ state: params.state, job: params.job, now: params.now, obligation });
  }
  return {
    action: "blocked",
    scheduledFor,
    decision,
    ...(obligation ? { recovery: { flow, obligation } } : {}),
  };
}

export type ScheduledProgramCompletionVerification = {
  verified: boolean;
  satisfied: ScheduledProgramCompletionProof[];
  missing: ScheduledProgramCompletionProof[];
};

/** Verifies every declared completion proof for all contracted runs, not only recovery runs. */
export async function verifyScheduledProgramCompletionProof(params: {
  state: CronServiceState;
  job: CronJob;
  scheduledFor: number;
  status: CronRunStatus;
  endedAt: number;
  delivered?: boolean;
}): Promise<ScheduledProgramCompletionVerification> {
  const required = params.job.reliability?.completionProof ?? [];
  const satisfied = new Set<ScheduledProgramCompletionProof>();
  satisfied.add("task_terminal");
  if (params.delivered === true) {
    satisfied.add("delivery_receipt");
  }
  const unresolved = required.filter((proof) => !satisfied.has(proof));
  if (unresolved.length > 0 && params.state.deps.resolveScheduledProgramCompletionProof) {
    try {
      for (const proof of await params.state.deps.resolveScheduledProgramCompletionProof({
        job: params.job,
        scheduledFor: params.scheduledFor,
        status: params.status,
        endedAt: params.endedAt,
        proofs: unresolved,
      })) {
        satisfied.add(proof);
      }
    } catch {
      // Missing authoritative proof remains visible and approval-gated.
    }
  }
  const missing = required.filter((proof) => !satisfied.has(proof));
  return {
    verified: params.status === "ok" && missing.length === 0,
    satisfied: [...satisfied].filter((proof) => required.includes(proof)),
    missing,
  };
}

export async function completeScheduledProgramRecovery(params: {
  state: CronServiceState;
  job: CronJob;
  recovery: PendingScheduleRecovery;
  status: CronRunStatus;
  endedAt: number;
  delivered?: boolean;
  verification?: ScheduledProgramCompletionVerification;
}): Promise<boolean> {
  const verification =
    params.verification ??
    (await verifyScheduledProgramCompletionProof({
      state: params.state,
      job: params.job,
      scheduledFor: params.recovery.obligation.scheduledFor,
      status: params.status,
      endedAt: params.endedAt,
      delivered: params.delivered,
    }));
  const completed = params.status === "ok" && verification.verified;
  const disposition = completed
    ? `scheduled execution completed with status ${params.status}; proof verified`
    : `scheduled execution requires review: status=${params.status}; missing=${verification.missing.join(",") || "none"}`;
  const persisted = persistRecoveryObligationState({
    flowId: params.recovery.flow.flowId,
    obligationId: params.recovery.obligation.obligationId,
    status: completed ? "completed" : "approval_required",
    disposition,
    now: params.endedAt,
  });
  if (!persisted.applied) {
    return false;
  }
  if (!completed) {
    return true;
  }
  return finishGuardianFlow({
    flowId: params.recovery.flow.flowId,
    currentStep: `Scheduled recovery completed with ${verification.satisfied.length} authoritative proof item(s).`,
    now: params.endedAt,
  });
}

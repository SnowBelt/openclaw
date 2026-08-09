import { describe, expect, it } from "vitest";
import {
  createRecoveryObligation,
  type RecoveryObligationV1,
} from "../tasks/recovery-obligations.js";
import type { ScheduledProgramReliabilityContractV1 } from "./reliability-contract.js";
import {
  decideScheduledProgramExecution,
  reconcileScheduleRecoveryObligations,
} from "./schedule-guardian.js";

function contract(
  patch: Partial<ScheduledProgramReliabilityContractV1> = {},
): ScheduledProgramReliabilityContractV1 {
  return {
    version: 1,
    programId: "business-acquisition.daily",
    ownerAgentId: "acquisition-agent",
    criticality: "high",
    maxLatenessMs: 60_000,
    catchUpPolicy: "run_latest",
    idempotencyScope: "schedule_window",
    resourceClaims: [{ resource: "local-model", mode: "exclusive" }],
    sideEffectClass: "owned_state",
    approvalClass: "automatic",
    preflight: ["model_ready"],
    completionProof: ["task_terminal"],
    ...patch,
  };
}

describe("schedule guardian", () => {
  it("runs non-conflicting work and defers lower-priority schedules with a recovery obligation", () => {
    expect(
      decideScheduledProgramExecution({
        contract: contract(),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 1_000,
      }),
    ).toMatchObject({ action: "run", reason: "on_time" });

    const decision = decideScheduledProgramExecution({
      contract: contract({ criticality: "medium" }),
      flowId: "flow",
      scheduledFor: 1_000,
      now: 1_010,
      competingWork: {
        kind: "known",
        workId: "critical-fix",
        criticality: "critical",
        resourceClaims: [{ resource: "local-model", mode: "exclusive" }],
        interruptible: true,
      },
    });
    expect(decision).toMatchObject({
      action: "defer",
      reason: "competing_work_wins_within_lateness_budget",
      recoveryObligation: { dueAt: 61_000, status: "pending" },
    });
  });

  it("prioritizes a late high-criticality schedule but never preempts unsafe work", () => {
    const competingWork = {
      kind: "known" as const,
      workId: "fix",
      criticality: "medium" as const,
      resourceClaims: [{ resource: "local-model", mode: "exclusive" as const }],
      interruptible: true,
    };
    expect(
      decideScheduledProgramExecution({
        contract: contract(),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 61_000,
        competingWork,
      }),
    ).toMatchObject({ action: "run", preemptCompetingWork: true });
    expect(
      decideScheduledProgramExecution({
        contract: contract(),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 61_000,
        competingWork: { ...competingWork, interruptible: false },
      }),
    ).toMatchObject({ action: "approval_required", reason: "cannot_safely_preempt" });
  });

  it("requires approval for manual or irreversible catch-up", () => {
    expect(
      decideScheduledProgramExecution({
        contract: contract({ catchUpPolicy: "manual" }),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 2_000,
      }),
    ).toMatchObject({ action: "approval_required", reason: "catch_up_requires_approval" });
    expect(
      decideScheduledProgramExecution({
        contract: contract({ sideEffectClass: "external_irreversible" }),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 2_000,
      }),
    ).toMatchObject({ action: "approval_required", reason: "unsafe_automatic_side_effect" });
    expect(
      decideScheduledProgramExecution({
        contract: contract({ sideEffectClass: "external_irreversible" }),
        flowId: "flow",
        scheduledFor: 2_000,
        now: 2_000,
      }),
    ).toMatchObject({ action: "approval_required", reason: "unsafe_automatic_side_effect" });
  });

  it("requires declared approval even on time and enforces the maximum lateness boundary", () => {
    expect(
      decideScheduledProgramExecution({
        contract: contract({ approvalClass: "operator" }),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 1_000,
      }),
    ).toMatchObject({
      action: "approval_required",
      reason: "approval_class_requires_approval",
    });
    expect(
      decideScheduledProgramExecution({
        contract: contract({ maxLatenessMs: 100 }),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 1_101,
      }),
    ).toMatchObject({ action: "approval_required", reason: "maximum_lateness_exceeded" });
  });

  it("distinguishes resume from replay and run-latest recovery", () => {
    expect(
      decideScheduledProgramExecution({
        contract: contract({ catchUpPolicy: "resume" }),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 1_001,
      }),
    ).toMatchObject({ action: "defer", reason: "resume_requires_obligation" });
    expect(
      decideScheduledProgramExecution({
        contract: contract({ catchUpPolicy: "resume" }),
        flowId: "flow",
        scheduledFor: 1_000,
        now: 1_001,
        recovering: true,
      }),
    ).toMatchObject({ action: "run" });
  });

  it("fails closed when running work is unknown, including shared claims", () => {
    const decision = decideScheduledProgramExecution({
      contract: contract({ resourceClaims: [{ resource: "local-model", mode: "shared" }] }),
      flowId: "flow",
      scheduledFor: 1_000,
      now: 1_000,
      competingWork: { kind: "unknown", workId: "task-flow:unverified" },
    });
    expect(decision).toMatchObject({
      action: "approval_required",
      reason: "unknown_competing_work",
      recoveryObligation: {
        scheduledFor: 1_000,
        dueAt: 61_000,
      },
    });
    expect(
      reconcileScheduleRecoveryObligations({
        obligations: [decision.recoveryObligation!],
        now: 2_000,
      }),
    ).toMatchObject([{ action: "approval_required" }]);
  });

  it("rejects unsafe schedule timestamps before creating recovery state", () => {
    expect(
      decideScheduledProgramExecution({
        contract: contract(),
        flowId: "flow",
        scheduledFor: Number.MAX_SAFE_INTEGER,
        now: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({ action: "approval_required", reason: "invalid_schedule_time" });
  });

  it("replays only the newest run-latest obligation after restart", () => {
    const obligation = (scheduledFor: number): RecoveryObligationV1 =>
      createRecoveryObligation({
        programId: "program",
        ownerAgentId: "agent",
        flowId: "flow",
        scheduledFor,
        dueAt: scheduledFor + 100,
        catchUpPolicy: "run_latest",
        idempotencyKey: `program:${scheduledFor}`,
        reason: "gateway_restart",
        proofRequirements: ["task_terminal"],
        now: scheduledFor,
      });
    expect(
      reconcileScheduleRecoveryObligations({
        obligations: [obligation(1), obligation(2)],
        now: 3,
      }).map((entry) => entry.action),
    ).toEqual(["skip", "run"]);
  });

  it("supersedes older run-latest obligations even when they require approval", () => {
    const obligation = (scheduledFor: number, approvalRequired: boolean): RecoveryObligationV1 =>
      createRecoveryObligation({
        programId: "program",
        ownerAgentId: "agent",
        flowId: "flow",
        scheduledFor,
        dueAt: scheduledFor + 100,
        catchUpPolicy: "run_latest",
        idempotencyKey: `program:${scheduledFor}`,
        reason: approvalRequired ? "unknown_competing_work" : "gateway_restart",
        proofRequirements: ["task_terminal"],
        status: approvalRequired ? "approval_required" : "pending",
        now: scheduledFor,
      });
    expect(
      reconcileScheduleRecoveryObligations({
        obligations: [obligation(1, true), obligation(2, false)],
        now: 3,
      }).map((entry) => entry.action),
    ).toEqual(["skip", "run"]);
  });
});

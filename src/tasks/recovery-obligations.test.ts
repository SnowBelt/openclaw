import { describe, expect, it } from "vitest";
import {
  createRecoveryObligation,
  listRecoveryObligations,
  updateRecoveryObligationState,
  withRecoveryObligation,
} from "./recovery-obligations.js";
import type { TaskFlowRecord } from "./task-flow-registry.types.js";

function flow(stateJson: TaskFlowRecord["stateJson"] = {}): Pick<TaskFlowRecord, "stateJson"> {
  return { stateJson };
}

describe("recovery obligations", () => {
  it("deduplicates the same durable obligation without replacing application state", () => {
    const obligation = createRecoveryObligation({
      programId: "pattern-lab.daily",
      ownerAgentId: "publisher-scheduler",
      flowId: "flow-1",
      scheduledFor: 1_000,
      dueAt: 2_000,
      catchUpPolicy: "run_latest",
      idempotencyKey: "pattern-lab.daily:1000",
      reason: "resource_conflict",
      proofRequirements: ["task_terminal"],
      now: 1_100,
    });
    const first = withRecoveryObligation(flow({ app: "kept" }), obligation);
    const second = withRecoveryObligation(flow(first), obligation);
    expect(second).toMatchObject({ app: "kept" });
    expect(listRecoveryObligations(flow(second))).toEqual([obligation]);
  });

  it("updates disposition and fails closed for non-object flow state", () => {
    const obligation = createRecoveryObligation({
      programId: "program",
      ownerAgentId: "agent",
      flowId: "flow-1",
      scheduledFor: 1,
      dueAt: 2,
      catchUpPolicy: "manual",
      idempotencyKey: "program:1",
      reason: "missed_schedule",
      proofRequirements: ["task_terminal"],
      now: 1,
    });
    const state = withRecoveryObligation(flow({}), obligation);
    const updated = updateRecoveryObligationState({
      flow: flow(state),
      obligationId: obligation.obligationId,
      status: "completed",
      disposition: "Proof attached.",
      now: 3,
    });
    expect(listRecoveryObligations(flow(updated))[0]).toMatchObject({
      status: "completed",
      disposition: "Proof attached.",
      updatedAt: 3,
    });
    expect(withRecoveryObligation(flow("opaque"), obligation)).toBeUndefined();
  });

  it("ignores malformed persisted enum values and oversized proof arrays", () => {
    const base = createRecoveryObligation({
      programId: "program",
      ownerAgentId: "agent",
      flowId: "flow-1",
      scheduledFor: 1,
      dueAt: 2,
      catchUpPolicy: "run_latest",
      idempotencyKey: "program:1",
      reason: "missed_schedule",
      proofRequirements: ["task_terminal"],
      now: 1,
    });
    expect(
      listRecoveryObligations(
        flow({ "openclaw.recoveryObligations.v1": [{ ...base, status: "invented" }] }),
      ),
    ).toEqual([]);
    expect(
      listRecoveryObligations(
        flow({
          "openclaw.recoveryObligations.v1": [
            { ...base, proofRequirements: Array.from({ length: 17 }, (_, index) => `p${index}`) },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      listRecoveryObligations(
        flow({
          "openclaw.recoveryObligations.v1": [{ ...base, dueAt: base.scheduledFor - 1 }],
        }),
      ),
    ).toEqual([]);
    expect(
      listRecoveryObligations(
        flow({
          "openclaw.recoveryObligations.v1": [{ ...base, obligationId: "forged-obligation-id" }],
        }),
      ),
    ).toEqual([]);
  });

  it("derives a stable idempotency identity and rejects backward timestamps", () => {
    const input: Parameters<typeof createRecoveryObligation>[0] = {
      programId: "program",
      ownerAgentId: "agent",
      flowId: "flow-1",
      scheduledFor: 1_000,
      dueAt: 2_000,
      catchUpPolicy: "run_latest",
      idempotencyKey: "program:1000",
      reason: "unknown_competing_work",
      proofRequirements: ["task_terminal"],
    };
    const first = createRecoveryObligation({
      ...input,
      now: 1_100,
    });
    const second = createRecoveryObligation({
      ...input,
      now: 1_200,
    });
    expect(second.obligationId).toBe(first.obligationId);
    const state = withRecoveryObligation(flow({}), first);
    expect(
      updateRecoveryObligationState({
        flow: flow(state),
        obligationId: first.obligationId,
        status: "completed",
        now: first.createdAt - 1,
      }),
    ).toBeUndefined();
  });

  it("uses the declared idempotency key rather than occurrence time for obligation identity", () => {
    const first = createRecoveryObligation({
      programId: "program",
      ownerAgentId: "agent",
      flowId: "flow",
      scheduledFor: 1,
      dueAt: 10,
      catchUpPolicy: "run_latest",
      idempotencyKey: "program",
      reason: "gateway_restart",
      proofRequirements: ["task_terminal"],
      now: 1,
    });
    const second = createRecoveryObligation({
      ...first,
      scheduledFor: 2,
      dueAt: 11,
      now: 2,
    });
    expect(second.obligationId).toBe(first.obligationId);
  });

  it("does not downgrade a terminal obligation or persist invalid state", () => {
    const obligation = createRecoveryObligation({
      programId: "program",
      ownerAgentId: "agent",
      flowId: "flow-1",
      scheduledFor: 1,
      dueAt: 2,
      catchUpPolicy: "run_latest",
      idempotencyKey: "program:1",
      reason: "missed_schedule",
      proofRequirements: ["task_terminal"],
      now: 1,
    });
    const state = withRecoveryObligation(flow({}), obligation);
    const completed = updateRecoveryObligationState({
      flow: flow(state),
      obligationId: obligation.obligationId,
      status: "completed",
      now: 3,
    });
    expect(
      updateRecoveryObligationState({
        flow: flow(completed),
        obligationId: obligation.obligationId,
        status: "pending",
        now: 4,
      }),
    ).toBeUndefined();
    expect(
      updateRecoveryObligationState({
        flow: flow(state),
        obligationId: obligation.obligationId,
        status: "pending",
        disposition: "   ",
        now: 4,
      }),
    ).toBeUndefined();
  });
});

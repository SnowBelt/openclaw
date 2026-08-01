import { describe, expect, it, vi } from "vitest";
import {
  recoverInterruptedOperationsRemediations,
  applyConfirmedOperationsRemediation,
  runOperationsRemediationSweep,
  type OperationsRepairRecipe,
} from "./remediation-engine.js";
import type { OperationsFinding, OperationsRemediationRecord } from "./types.js";

function finding(): OperationsFinding {
  return {
    id: "cron:job-1:failure",
    severity: "critical",
    category: "cron",
    entityId: "job-1",
    title: "Schedule failed",
    detail: "Three failures",
    lastObservedAt: 1,
    disposition: "needs_user",
    responseState: "waiting_for_user",
    impact: "Future runs may fail.",
  };
}

function memoryStore() {
  const records: OperationsRemediationRecord[] = [];
  return {
    records,
    store: {
      list: () => structuredClone(records),
      upsert: (record: OperationsRemediationRecord) => {
        const index = records.findIndex((entry) => entry.id === record.id);
        if (index >= 0) {
          records[index] = structuredClone(record);
        } else {
          records.push(structuredClone(record));
        }
      },
    },
  };
}

function recipe(
  overrides: Partial<OperationsRepairRecipe<{ enabled: boolean }>> = {},
): OperationsRepairRecipe<{ enabled: boolean }> {
  return {
    id: "test-repair.v1",
    risk: "low",
    domain: "routine",
    confidence: 1,
    recommendationReason: "Repeated failures are safely contained by pausing this schedule.",
    exactRepair: "Pause the failing schedule.",
    expectedChange: "Only the failing schedule becomes paused.",
    verificationPlan: "Read the schedule back and confirm it is paused.",
    rollback: "Re-enable the schedule.",
    reversible: true,
    verificationMode: "authoritative_readback",
    rollbackVerificationMode: "authoritative_readback",
    matches: () => true,
    apply: async (_finding, context) => {
      context.enabled = false;
    },
    verify: async (_finding, context) => ({
      passed: !context.enabled,
      evidence: context.enabled ? "Still enabled." : "Paused.",
    }),
    rollbackRepair: async (_finding, context) => {
      context.enabled = true;
    },
    verifyRollback: async (_finding, context) => ({
      passed: context.enabled,
      evidence: context.enabled ? "Rollback verified." : "Rollback failed.",
    }),
    undo: {
      action: "cron.enable",
      targetId: (currentFinding) => currentFinding.entityId ?? "job-1",
    },
    ...overrides,
  };
}

function ai() {
  return {
    investigate: vi.fn(async () => ({ confidence: 0.99, recommendation: "Bounded and safe." })),
    judge: vi.fn(async () => ({ approved: true, reason: "Rollback is verified." })),
  };
}

function recommendationAi() {
  return {
    ...ai(),
    recommend: vi.fn(async () => ({
      risk: "high" as const,
      domain: "novel" as const,
      confidence: 0.94,
      recommendedFix: "Collect a read-only diagnostic bundle for Codex review.",
      reason: "No approved bounded recipe matches this issue yet.",
      expectedChange: "No runtime state changes; only a diagnostic bundle is proposed.",
      verificationPlan: "Verify the bundle contains no secrets and matches the issue identity.",
      rollback: "No rollback is needed because the recommendation is read-only.",
    })),
    judgeRecommendation: vi.fn(async () => ({
      approved: true,
      reason: "Read-only and policy-safe; execution still requires an approved recipe.",
    })),
  };
}

describe("Operations remediation engine", () => {
  it("makes interrupted active receipts terminal and never silently retries them", () => {
    const { records, store } = memoryStore();
    records.push({
      id: "interrupted",
      findingId: finding().id,
      findingTitle: finding().title,
      findingCategory: "cron",
      findingEntityId: "job-1",
      impact: finding().impact,
      recipeId: "test-repair.v1",
      risk: "medium",
      status: "verifying",
      ownerId: "OpenClaw",
      exactRepair: "Pause the failing schedule.",
      progress: "Verifying.",
      evidence: [],
      rollback: "Re-enable the schedule.",
      undoAvailable: true,
      undoAction: "cron.enable",
      undoTargetId: "job-1",
      automatic: true,
      startedAt: 1,
      updatedAt: 2,
    });
    const recovered = recoverInterruptedOperationsRemediations({
      store,
      now: () => 3,
    });
    expect(recovered).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "failed",
      completedAt: 3,
      result:
        "Repair state is uncertain after interruption. Confirm current state before using guarded Undo.",
    });
  });

  it("automatically applies and verifies an approved low-risk recipe", async () => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe()],
      store,
      ai: ai(),
    });
    expect(state.enabled).toBe(false);
    expect(records.at(-1)).toMatchObject({
      status: "completed",
      automatic: true,
      result: "Paused.",
    });
  });

  it("requires local investigation and independent Judge approval for medium risk", async () => {
    const state = { enabled: true };
    const reviewer = ai();
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe({ risk: "medium", confidence: 0.98 })],
      store,
      ai: reviewer,
    });
    expect(reviewer.investigate).toHaveBeenCalledOnce();
    expect(reviewer.judge).toHaveBeenCalledOnce();
    expect(records.at(-1)).toMatchObject({
      status: "confirmation_required",
      automatic: false,
      undoAvailable: false,
      result: "No change has been made yet.",
    });
    expect(state.enabled).toBe(true);
    const confirmed = await applyConfirmedOperationsRemediation({
      recordId: records.at(-1)!.id,
      finding: finding(),
      context: state,
      recipes: [recipe({ risk: "medium", confidence: 0.98 })],
      store,
    });
    expect(confirmed.status).toBe("completed");
    expect(confirmed.undoAvailable).toBe(true);
    expect(state.enabled).toBe(false);
  });

  it("makes no change when the independent Judge rejects medium risk", async () => {
    const state = { enabled: true };
    const reviewer = ai();
    reviewer.judge.mockResolvedValueOnce({ approved: false, reason: "Uncertain." });
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe({ risk: "medium", confidence: 0.98 })],
      store,
      ai: reviewer,
    });
    expect(state.enabled).toBe(true);
    expect(records.at(-1)).toMatchObject({
      status: "approval_required",
      automatic: false,
    });
  });

  it("makes no change and skips Judge when local investigation confidence is low", async () => {
    const state = { enabled: true };
    const reviewer = ai();
    reviewer.investigate.mockResolvedValueOnce({
      confidence: 0.72,
      recommendation: "Uncertain.",
    });
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe({ risk: "medium", confidence: 0.98 })],
      store,
      ai: reviewer,
    });
    expect(state.enabled).toBe(true);
    expect(reviewer.judge).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({
      status: "approval_required",
      automatic: false,
    });
  });

  it("fails closed before local review when recipe confidence is invalid", async () => {
    const state = { enabled: true };
    const reviewer = ai();
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe({ risk: "medium", confidence: Number.NaN })],
      store,
      ai: reviewer,
    });
    expect(state.enabled).toBe(true);
    expect(reviewer.investigate).not.toHaveBeenCalled();
    expect(records.at(-1)?.status).toBe("approval_required");
  });

  it.each([
    "high",
    "security",
    "financial",
    "credential",
    "production_release",
    "destructive",
    "novel",
    "policy_expansion",
  ])("requires explicit approval for excluded risk or domain %s", async (value) => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    const excluded =
      value === "high"
        ? recipe({ risk: "high" })
        : recipe({ domain: value as OperationsRepairRecipe["domain"] });
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [excluded],
      store,
      ai: ai(),
    });
    expect(state.enabled).toBe(true);
    expect(records.at(-1)?.status).toBe("approval_required");
  });

  it("automatically rolls back when deterministic verification returns failure", async () => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe({ verify: async () => ({ passed: false, evidence: "Not healthy." }) })],
      store,
      ai: ai(),
    });
    expect(state.enabled).toBe(true);
    expect(records.at(-1)).toMatchObject({ status: "rolled_back", automatic: true });
  });

  it("automatically rolls back when deterministic verification throws", async () => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [
        recipe({
          verify: async () => {
            throw new Error("Verifier unavailable");
          },
        }),
      ],
      store,
      ai: ai(),
    });
    expect(state.enabled).toBe(true);
    expect(records.at(-1)?.status).toBe("rolled_back");
  });

  it("fails visibly when rollback runs but deterministic rollback verification fails", async () => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [
        recipe({
          verify: async () => ({ passed: false, evidence: "Repair did not verify." }),
          verifyRollback: async () => ({
            passed: false,
            evidence: "Rollback state is uncertain.",
          }),
        }),
      ],
      store,
      ai: ai(),
    });
    expect(records.at(-1)).toMatchObject({
      status: "failed",
      progress:
        "Automatic repair stopped; rollback could not be verified and needs operator review.",
    });
    expect(records.at(-1)?.result).toContain(
      "Rollback did not verify: Rollback state is uncertain.",
    );
  });

  it("redacts sensitive failure text before persisting evidence", async () => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [
        recipe({
          apply: async () => {
            throw new Error("request failed Authorization: Bearer secret-token-value");
          },
        }),
      ],
      store,
      ai: ai(),
    });
    expect(records.at(-1)?.result).not.toContain("secret-token-value");
  });

  it("redacts sensitive model and verification text before persisting it", async () => {
    const state = { enabled: true };
    const reviewer = ai();
    reviewer.investigate.mockResolvedValueOnce({
      confidence: 0.99,
      recommendation: "Authorization: Bearer investigation-secret",
    });
    reviewer.judge.mockResolvedValueOnce({
      approved: true,
      reason: "Authorization: Bearer judge-secret",
    });
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [
        recipe({
          risk: "medium",
          confidence: 0.98,
          verify: async () => ({
            passed: true,
            evidence: "Authorization: Bearer verification-secret",
          }),
        }),
      ],
      store,
      ai: reviewer,
    });
    const serialized = JSON.stringify(records.at(-1));
    expect(serialized).not.toContain("investigation-secret");
    expect(serialized).not.toContain("judge-secret");
    expect(serialized).not.toContain("verification-secret");
  });

  it("does not roll back when apply fails before a mutation completes", async () => {
    const state = { enabled: false };
    const rollbackRepair = vi.fn(async () => {
      state.enabled = true;
    });
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [
        recipe({
          apply: async () => {
            throw new Error("Precondition changed before mutation");
          },
          rollbackRepair,
        }),
      ],
      store,
      ai: ai(),
    });
    expect(rollbackRepair).not.toHaveBeenCalled();
    expect(state.enabled).toBe(false);
    expect(records.at(-1)).toMatchObject({ status: "failed", automatic: true });
  });

  it("keeps failed rollback visible and never retries the same finding", async () => {
    const state = { enabled: true };
    const { records, store } = memoryStore();
    const failing = recipe({
      verify: async () => ({ passed: false, evidence: "Failed." }),
      rollbackRepair: async () => {
        throw new Error("Rollback unavailable");
      },
    });
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [failing],
      store,
      ai: ai(),
    });
    const count = records.length;
    expect(records.at(-1)).toMatchObject({
      status: "failed",
      automatic: true,
      progress:
        "Automatic repair stopped; rollback could not be verified and needs operator review.",
    });
    expect(records.at(-1)?.result).toContain("Rollback did not verify: Rollback unavailable");
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [failing],
      store,
      ai: ai(),
    });
    expect(records).toHaveLength(count);
  });

  it("bounds one sweep to two automatic repairs by default", async () => {
    const state = { enabled: true };
    const apply = vi.fn(async () => {});
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: ["one", "two", "three"].map((id) => {
        const item = finding();
        item.id = `cron:${id}:failure`;
        item.entityId = id;
        return item;
      }),
      context: state,
      recipes: [recipe({ apply })],
      store,
      ai: ai(),
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);
  });

  it("makes no change when more than one approved recipe matches", async () => {
    const state = { enabled: true };
    const apply = vi.fn(async () => {
      state.enabled = false;
    });
    const { records, store } = memoryStore();
    await runOperationsRemediationSweep({
      findings: [finding()],
      context: state,
      recipes: [recipe({ id: "first.v1", apply }), recipe({ id: "second.v1", apply })],
      store,
      ai: ai(),
    });
    expect(apply).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
    expect(state.enabled).toBe(true);
  });

  it("records a concrete advisory when no approved recipe matches", async () => {
    const reviewer = recommendationAi();
    const { store } = memoryStore();
    const output = await runOperationsRemediationSweep({
      findings: [finding()],
      context: { enabled: true },
      recipes: [],
      store,
      ai: reviewer,
    });
    expect(reviewer.recommend).toHaveBeenCalledOnce();
    expect(reviewer.judgeRecommendation).toHaveBeenCalledOnce();
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      recipeId: "local-ai.recommendation.v1",
      status: "approval_required",
      automatic: false,
      recommendedFix: "Collect a read-only diagnostic bundle for Codex review.",
      expectedChange: "No runtime state changes; only a diagnostic bundle is proposed.",
      result: "No automatic change was made.",
    });
  });
});

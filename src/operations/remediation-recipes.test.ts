import { describe, expect, it, vi } from "vitest";
import type { CronServiceContract } from "../cron/service-contract.js";
import type { CronJob } from "../cron/types.js";
import {
  createOperationsRemediationContext,
  createOperationsRepairRecipes,
} from "./remediation-recipes.js";
import type { OperationsFinding } from "./types.js";

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

function harness(overrides?: Partial<CronJob>) {
  const job = {
    id: "job-1",
    name: "Job",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "work" },
    state: {
      lastRunStatus: "error",
      consecutiveErrors: 3,
    },
    ...overrides,
  } as CronJob;
  const update = vi.fn(async (_id: string, patch: { enabled?: boolean }) => {
    if (typeof patch.enabled === "boolean") {
      job.enabled = patch.enabled;
    }
    return job;
  });
  const updateWithPrecondition = vi.fn(
    async (
      _id: string,
      patch: { enabled?: boolean },
      precondition: (current: CronJob, nowMs: number) => void | Promise<void>,
    ) => {
      await precondition(job, Date.now());
      return await update(_id, patch);
    },
  );
  const cron = {
    readJob: vi.fn(async () => job),
    update,
    updateWithPrecondition,
  } as unknown as CronServiceContract;
  return { cron, job, update };
}

describe("Operations repair recipes", () => {
  const recipe = createOperationsRepairRecipes()[0]!;

  it("pauses and verifies only an eligible repeatedly failing schedule", async () => {
    const { cron, job } = harness();
    const context = createOperationsRemediationContext(cron);
    expect(recipe.matches(finding(), context)).toBe(true);
    await recipe.apply(finding(), context);
    await expect(recipe.verify(finding(), context)).resolves.toMatchObject({ passed: true });
    expect(job.enabled).toBe(false);
    expect(cron.updateWithPrecondition).toHaveBeenCalledWith(
      "job-1",
      { enabled: false },
      expect.any(Function),
    );
  });

  it("fails closed when runtime state changed before apply", async () => {
    const { cron } = harness({ state: { lastRunStatus: "ok", consecutiveErrors: 0 } });
    await expect(recipe.apply(finding(), createOperationsRemediationContext(cron))).rejects.toThrow(
      /no longer matches/,
    );
  });

  it("rechecks the schedule under the store lock before mutating", async () => {
    const { cron, job } = harness();
    vi.mocked(cron.updateWithPrecondition).mockImplementationOnce(
      async (_id, _patch, precondition) => {
        job.state.lastRunStatus = "ok";
        job.state.consecutiveErrors = 0;
        await precondition(job, Date.now());
        return job;
      },
    );
    await expect(recipe.apply(finding(), createOperationsRemediationContext(cron))).rejects.toThrow(
      /changed before/,
    );
    expect(job.enabled).toBe(true);
  });

  it("restores and verifies the rollback point", async () => {
    const { cron, job } = harness({ enabled: false });
    const context = createOperationsRemediationContext(cron);
    context.cronRollbackVersions.set("job-1", job.updatedAtMs);
    await recipe.rollbackRepair!(finding(), context);
    await expect(recipe.verifyRollback!(finding(), context)).resolves.toMatchObject({
      passed: true,
    });
    expect(job.enabled).toBe(true);
  });

  it("does not roll back over a newer schedule update", async () => {
    const { cron, job } = harness({ enabled: false, updatedAtMs: 10 });
    const context = createOperationsRemediationContext(cron);
    context.cronRollbackVersions.set("job-1", 9);
    await expect(recipe.rollbackRepair!(finding(), context)).rejects.toThrow(
      /changed after repair/,
    );
    expect(job.enabled).toBe(false);
  });
});

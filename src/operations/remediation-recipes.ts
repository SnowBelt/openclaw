import type { CronServiceContract } from "../cron/service-contract.js";
import type { OperationsRepairRecipe } from "./remediation-engine.js";
import type { OperationsFinding } from "./types.js";

export type OperationsRemediationContext = {
  cron: CronServiceContract;
  cronRollbackVersions: Map<string, number>;
};

export function createOperationsRemediationContext(
  cron: CronServiceContract,
): OperationsRemediationContext {
  return { cron, cronRollbackVersions: new Map() };
}

function cronId(finding: OperationsFinding): string | undefined {
  return finding.category === "cron" ? finding.entityId : undefined;
}

async function cronEnabled(
  context: OperationsRemediationContext,
  id: string,
): Promise<boolean | undefined> {
  return (await context.cron.readJob(id))?.enabled;
}

export function createOperationsRepairRecipes(): OperationsRepairRecipe<OperationsRemediationContext>[] {
  return [
    {
      id: "cron.pause-repeated-failures.v1",
      risk: "medium",
      domain: "routine",
      confidence: 0.98,
      recommendationReason:
        "Repeated failures can keep consuming resources and producing duplicate alerts; pausing only this schedule contains the problem without deleting work.",
      exactRepair:
        "Pause the enabled schedule after three consecutive failed runs so it cannot repeat the same failure.",
      expectedChange:
        "Only the matching failed schedule becomes paused; its history and configuration remain intact.",
      verificationPlan:
        "Read the schedule back from the authoritative cron service and confirm enabled is false.",
      rollback: "Re-enable the same schedule through the guarded Undo action.",
      reversible: true,
      verificationMode: "authoritative_readback",
      rollbackVerificationMode: "authoritative_readback",
      undo: {
        action: "cron.enable",
        targetId: cronId,
      },
      matches: (finding) =>
        finding.category === "cron" &&
        finding.id.endsWith(":failure") &&
        finding.severity === "critical" &&
        typeof finding.entityId === "string" &&
        finding.disposition !== "handling",
      apply: async (finding, context) => {
        const id = cronId(finding);
        if (!id || (await cronEnabled(context, id)) !== true) {
          throw new Error("Schedule is absent or no longer enabled");
        }
        const job = await context.cron.readJob(id);
        if (
          !job ||
          job.state.runningAtMs ||
          (job.state.consecutiveErrors ?? 0) < 3 ||
          (job.state.lastRunStatus ?? job.state.lastStatus) !== "error"
        ) {
          throw new Error("Schedule no longer matches the approved repeated-failure recipe");
        }
        const updated = await context.cron.updateWithPrecondition(
          id,
          { enabled: false },
          (current) => {
            if (
              !current.enabled ||
              current.state.runningAtMs ||
              (current.state.consecutiveErrors ?? 0) < 3 ||
              (current.state.lastRunStatus ?? current.state.lastStatus) !== "error"
            ) {
              throw new Error("Schedule changed before the approved repair could be applied");
            }
          },
        );
        context.cronRollbackVersions.set(id, updated.updatedAtMs);
      },
      verify: async (finding, context) => {
        const id = cronId(finding);
        const enabled = id ? await cronEnabled(context, id) : undefined;
        return {
          passed: enabled === false,
          evidence:
            enabled === false
              ? `Schedule ${id} is paused after repeated failures.`
              : `Schedule ${id ?? "unknown"} was not confirmed paused.`,
        };
      },
      rollbackRepair: async (finding, context) => {
        const id = cronId(finding);
        if (!id) {
          throw new Error("Rollback target is missing");
        }
        const expectedUpdatedAt = context.cronRollbackVersions.get(id);
        if (expectedUpdatedAt === undefined) {
          throw new Error("Rollback point is missing");
        }
        await context.cron.updateWithPrecondition(id, { enabled: true }, (current) => {
          if (current.enabled || current.updatedAtMs !== expectedUpdatedAt) {
            throw new Error("Schedule changed after repair; automatic rollback stopped");
          }
        });
      },
      verifyRollback: async (finding, context) => {
        const id = cronId(finding);
        const enabled = id ? await cronEnabled(context, id) : undefined;
        return {
          passed: enabled === true,
          evidence:
            enabled === true
              ? `Rollback verified: schedule ${id} is enabled.`
              : `Rollback was not verified for schedule ${id ?? "unknown"}.`,
        };
      },
    },
  ];
}

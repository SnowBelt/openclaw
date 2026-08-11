import type { PccModelRunReceipt } from "../../packages/gateway-protocol/src/schema/types.js";
import { onAgentAuditEvent, onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { recordPccModelRunReceipt } from "./ai-usage.js";
import { transitionPccExecutionPlan, type PccExecutionPlan } from "./execution-plan.js";
import {
  pccExecutionIdempotencyKeys,
  pccExecutionPlansFromProject,
  withPccExecutionPlanMetadata,
} from "./execution-service.js";
import { pccExecutionStatusIsActive } from "./execution-service.js";
import { withPccLedger } from "./ledger-store.js";

type ExecutionTerminalPhase = "end" | "error";

export type RegisteredPccExecutionRun = {
  projectId: string;
  planId: string;
  runId: string;
  milestoneId?: string;
  subMilestoneId?: string;
  model: string;
  provider: string;
  startedAt: string;
  broadcast?: (projectId: string, planId: string) => void;
};

const registrations = new Map<string, RegisteredPccExecutionRun>();
const terminalRuns = new Set<string>();

function recordString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerUsage(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function usageFromEvent(data: Record<string, unknown>): PccModelRunReceipt["usage"] | undefined {
  const raw = data.usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const usage = raw as Record<string, unknown>;
  const normalized = {
    ...(integerUsage(usage.input) !== undefined ? { input: integerUsage(usage.input) } : {}),
    ...(integerUsage(usage.output) !== undefined ? { output: integerUsage(usage.output) } : {}),
    ...(integerUsage(usage.cacheRead) !== undefined
      ? { cacheRead: integerUsage(usage.cacheRead) }
      : {}),
    ...(integerUsage(usage.cacheWrite) !== undefined
      ? { cacheWrite: integerUsage(usage.cacheWrite) }
      : {}),
    ...(integerUsage(usage.totalTokens) !== undefined
      ? { totalTokens: integerUsage(usage.totalTokens) }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function terminalStatusForPlan(
  plan: PccExecutionPlan,
  phase: ExecutionTerminalPhase,
  data: Record<string, unknown>,
) {
  if (plan.status === "cancelled") {
    return "cancelled" as const;
  }
  if (data.aborted === true) {
    return "cancelled" as const;
  }
  if (phase === "error") {
    return "failed" as const;
  }
  return "succeeded" as const;
}

function terminalPlanForRun(
  plan: PccExecutionPlan,
  phase: ExecutionTerminalPhase,
  at: string,
  data: Record<string, unknown>,
  reason?: string,
): PccExecutionPlan {
  const partitionStatus = terminalStatusForPlan(plan, phase, data);
  const partitions = plan.partitions.map((partition) =>
    ["pending", "assigned", "running"].includes(partition.status)
      ? {
          ...partition,
          status:
            partitionStatus === "succeeded"
              ? ("succeeded" as const)
              : partitionStatus === "cancelled"
                ? ("cancelled" as const)
                : ("failed" as const),
        }
      : partition,
  );
  const nextStatus =
    partitionStatus === "succeeded"
      ? "completed"
      : partitionStatus === "cancelled"
        ? "cancelled"
        : "failed";
  const planAt = Date.parse(at) >= Date.parse(plan.updatedAt) ? at : plan.updatedAt;
  const next =
    plan.status === "paused" || plan.status === "blocked"
      ? {
          ...plan,
          updatedAt: planAt,
          ...(reason ? { statusReason: reason } : {}),
          auditEvents: [
            ...plan.auditEvents,
            {
              at: planAt,
              status: plan.status,
              reason: reason ?? "The worker ended while supervised execution remained paused.",
            },
          ].slice(-128),
        }
      : pccExecutionStatusIsActive(plan.status)
        ? transitionPccExecutionPlan(plan, nextStatus, { at: planAt, reason })
        : plan;
  return { ...next, partitions };
}

function idempotencyKeyForPlan(project: { metadata?: unknown }, planId: string): string {
  const keys = pccExecutionIdempotencyKeys(project as never);
  return Object.entries(keys).find(([, value]) => value === planId)?.[0] ?? `recovered:${planId}`;
}

export function registerPccExecutionRun(run: RegisteredPccExecutionRun): void {
  registrations.set(run.runId, run);
}

export function unregisterPccExecutionRun(runId: string): void {
  registrations.delete(runId);
}

export function getRegisteredPccExecutionRun(runId: string): RegisteredPccExecutionRun | undefined {
  return registrations.get(runId);
}

export async function reconcilePccExecutionTerminalEvent(params: {
  runId: string;
  phase: ExecutionTerminalPhase;
  data: Record<string, unknown>;
}): Promise<void> {
  const registration = registrations.get(params.runId);
  if (!registration || terminalRuns.has(params.runId)) {
    return;
  }
  terminalRuns.add(params.runId);
  const endedAt =
    typeof params.data.endedAt === "number" && Number.isFinite(params.data.endedAt)
      ? new Date(params.data.endedAt).toISOString()
      : new Date().toISOString();
  const reason = recordString(params.data.error) ?? recordString(params.data.stopReason);
  try {
    const result = withPccLedger(
      (ledger) => {
        const project = ledger.projects.find((item) => item.id === registration.projectId);
        if (!project) {
          return { changed: false };
        }
        const plan = pccExecutionPlansFromProject(project).find(
          (item) => item.id === registration.planId,
        );
        if (!plan) {
          return { changed: false };
        }
        const nextPlan = terminalPlanForRun(plan, params.phase, endedAt, params.data, reason);
        const idempotencyKey = idempotencyKeyForPlan(project, plan.id);
        project.metadata = withPccExecutionPlanMetadata(project, nextPlan, idempotencyKey, endedAt);
        project.revision = (project.revision ?? 1) + 1;
        project.updatedAt = endedAt;
        const usage = usageFromEvent(params.data);
        recordPccModelRunReceipt(ledger, {
          projectId: registration.projectId,
          ...(registration.milestoneId ? { milestoneId: registration.milestoneId } : {}),
          ...(registration.subMilestoneId ? { subMilestoneId: registration.subMilestoneId } : {}),
          sourceRunId: registration.runId,
          executor: "local",
          purpose: "implementation",
          provider: registration.provider,
          model: registration.model,
          status: terminalStatusForPlan(plan, params.phase, params.data),
          startedAt: registration.startedAt,
          completedAt: endedAt,
          ...(usage ? { usage } : {}),
          usageSource: usage ? "provider_reported" : "unavailable",
        });
        return { changed: true, projectId: project.id, planId: nextPlan.id };
      },
      { write: true, auditKind: "pcc.execution.reconcile" },
    );
    if (result.changed) {
      if (result.projectId && result.planId) {
        registration.broadcast?.(result.projectId, result.planId);
      }
    }
  } catch (error) {
    terminalRuns.delete(params.runId);
    throw error;
  } finally {
    registrations.delete(params.runId);
  }
}

/** Gateway-owned lifecycle events are the only source of execution completion receipts. */
function handlePccExecutionLifecycleEvent(event: AgentEventPayload) {
  if (event.stream !== "lifecycle") {
    return;
  }
  const phase = event.data.phase;
  if (phase !== "end" && phase !== "error") {
    return;
  }
  void reconcilePccExecutionTerminalEvent({ runId: event.runId, phase, data: event.data }).catch(
    () => undefined,
  );
}

// Normal Gateway-owned chat runs publish lifecycle events on the public agent
// event bus. Audit-only runs use the private audit bus. Subscribe to both so
// terminal reconciliation is tied to the actual run mode rather than the UI
// visibility policy selected by the dispatcher.
const stopPccExecutionEventSubscription = onAgentEvent(handlePccExecutionLifecycleEvent);
const stopPccExecutionAuditSubscription = onAgentAuditEvent(handlePccExecutionLifecycleEvent);

export function resetPccExecutionReconciliationForTest(): void {
  registrations.clear();
  terminalRuns.clear();
}

export function stopPccExecutionReconciliationForTest(): void {
  stopPccExecutionEventSubscription();
  stopPccExecutionAuditSubscription();
}

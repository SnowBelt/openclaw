import type { PccModelRunReceipt } from "../../packages/gateway-protocol/src/schema/types.js";
import { onAgentAuditEvent, onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { recordPccModelRunReceipt } from "./ai-usage.js";
import {
  pccExecutionProofCandidateId,
  transitionPccExecutionPlan,
  type PccExecutionPlan,
} from "./execution-plan.js";
import {
  pccExecutionIdempotencyKeys,
  pccExecutionPlansFromProject,
  withPccExecutionPlanMetadata,
} from "./execution-service.js";
import { pccExecutionStatusIsActive } from "./execution-service.js";
import { readPccLedger, withPccLedger } from "./ledger-store.js";

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
  changedFiles?: string[];
  checks?: string[];
  outputText?: string;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function buildPccExecutionProofCandidate(params: {
  plan: PccExecutionPlan;
  registration: RegisteredPccExecutionRun;
  phase: ExecutionTerminalPhase;
  data: Record<string, unknown>;
  endedAt: string;
  reason?: string;
}) {
  const structured = record(params.data.proofCandidate) ?? record(params.data.proof);
  const summary =
    recordString(structured?.summary) ??
    recordString(params.data.summary) ??
    recordString(params.data.text) ??
    params.registration.outputText ??
    (params.phase === "error"
      ? `The supervised worker failed${params.reason ? `: ${params.reason}` : "."}`
      : "The worker ended without a structured proof report. Review the run output before accepting.");
  const changedFiles = [
    ...(params.registration.changedFiles ?? []),
    ...stringArray(structured?.changedFiles),
    ...stringArray(params.data.changedFiles),
  ];
  const checks = [
    ...(params.registration.checks ?? []),
    ...stringArray(structured?.checks),
    ...stringArray(params.data.checks),
  ];
  const blockers = [
    ...(params.phase === "error" && params.reason ? [params.reason] : []),
    ...stringArray(structured?.blockers),
    ...stringArray(params.data.blockers),
  ];
  const risks = [...stringArray(structured?.risks), ...stringArray(params.data.risks)];
  return {
    id: pccExecutionProofCandidateId(params.plan.id, params.registration.runId),
    planId: params.plan.id,
    runId: params.registration.runId,
    projectId: params.registration.projectId,
    ...(params.registration.milestoneId ? { milestoneId: params.registration.milestoneId } : {}),
    summary: summary.slice(0, 20_000),
    changedFiles: [...new Set(changedFiles)].slice(0, 200),
    checks: [...new Set(checks)].slice(0, 200),
    blockers: [...new Set(blockers)].slice(0, 200),
    risks: [...new Set(risks)].slice(0, 200),
    status: "pending_review" as const,
    createdAt: params.endedAt,
  };
}

function persistedRegistration(runId: string): RegisteredPccExecutionRun | undefined {
  const ledger = readPccLedger();
  for (const project of ledger.projects) {
    const plans = pccExecutionPlansFromProject(project);
    const plan = plans.find(
      (candidate) => candidate.coordinator.runId === runId || candidate.id === runId,
    );
    if (!plan) {
      continue;
    }
    const partition = plan.partitions[0];
    const taskId = partition?.taskId ?? "";
    return {
      projectId: project.id,
      planId: plan.id,
      runId,
      ...(taskId.startsWith("milestone:") ? { milestoneId: taskId.slice(10) } : {}),
      ...(taskId.startsWith("submilestone:") ? { subMilestoneId: taskId.slice(12) } : {}),
      model: partition?.modelId ?? "unknown-local-model",
      provider: "local",
      startedAt: plan.createdAt,
    };
  }
  return undefined;
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
  const registration = registrations.get(params.runId) ?? persistedRegistration(params.runId);
  if (!registration || terminalRuns.has(params.runId)) {
    return;
  }
  terminalRuns.add(params.runId);
  const eventTimestamp =
    typeof params.data.endedAt === "number" && Number.isFinite(params.data.endedAt)
      ? new Date(params.data.endedAt).toISOString()
      : typeof params.data.endedAt === "string" && Number.isFinite(Date.parse(params.data.endedAt))
        ? new Date(params.data.endedAt).toISOString()
        : undefined;
  const endedAt = eventTimestamp ?? new Date().toISOString();
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
        const proofCandidate = buildPccExecutionProofCandidate({
          plan: nextPlan,
          registration,
          phase: params.phase,
          data: params.data,
          endedAt,
          reason,
        });
        const hasProofCandidate = nextPlan.proofCandidates.some(
          (candidate) => candidate.id === proofCandidate.id,
        );
        const hasReceipt = (ledger.modelRunReceipts ?? []).some(
          (receipt) =>
            receipt.projectId === registration.projectId &&
            receipt.sourceRunId === registration.runId,
        );
        if (hasProofCandidate && hasReceipt) {
          return { changed: false };
        }
        const proofCandidates = hasProofCandidate
          ? nextPlan.proofCandidates
          : [...nextPlan.proofCandidates, proofCandidate].slice(-32);
        const planWithProofCandidate = { ...nextPlan, proofCandidates };
        const idempotencyKey = idempotencyKeyForPlan(project, plan.id);
        project.metadata = withPccExecutionPlanMetadata(
          project,
          planWithProofCandidate,
          idempotencyKey,
          endedAt,
        );
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
        return { changed: true, projectId: project.id, planId: planWithProofCandidate.id };
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
  const registration = registrations.get(event.runId);
  if (registration && event.stream === "patch") {
    const data = event.data;
    const files = [
      ...stringArray(data.added),
      ...stringArray(data.modified),
      ...stringArray(data.deleted),
    ];
    registration.changedFiles = [...new Set([...(registration.changedFiles ?? []), ...files])];
    return;
  }
  if (registration && event.stream === "command_output" && event.data.phase === "end") {
    const check = recordString(event.data.title) ?? recordString(event.data.name);
    if (check) {
      registration.checks = [...new Set([...(registration.checks ?? []), check])];
    }
    return;
  }
  if (registration && event.stream === "assistant") {
    const text = recordString(event.data.text);
    if (text) {
      registration.outputText = text.slice(-20_000);
    }
    return;
  }
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

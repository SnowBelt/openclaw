import { createHash } from "node:crypto";
import type {
  PccMilestone,
  PccProject,
  PccStatus,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { isPccTerminalStatus } from "./domain/completion-policy.js";
import {
  isPccExecutionPlanStatus,
  type PccExecutionPlan,
  type PccExecutionTask,
  type PccExecutionTaskPartition,
  type PccExecutionWorkspaceLease,
} from "./execution-plan.js";
import { pccMetadataObject, pccResponsibilityForItem } from "./metadata.js";

export type PccExecutionWorkItem = PccMilestone | PccSubMilestone;

export type PccExecutionMetadataRepair = {
  item: PccExecutionWorkItem;
  issueCodes: string[];
};

export type PccExecutionStartCandidate = {
  item: PccExecutionWorkItem;
  milestoneId: string;
  task: PccExecutionTask;
};

type PccMetadataRecord = Record<string, unknown>;

const EXECUTABLE_STATUSES = new Set<PccStatus>([
  "not_started",
  "active",
  "in_progress",
  "reopened",
]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function metadata(value: unknown): PccMetadataRecord {
  return pccMetadataObject(value);
}

function canonicalWorkspaceId(projectId: string, item: PccExecutionWorkItem): string {
  const kind = "milestoneId" in item ? "submilestone" : "milestone";
  const phase = "phaseId" in item && nonEmptyString(item.phaseId) ? item.phaseId : "default";
  return `pcc:${projectId}:${phase}:${kind}:${item.id}`;
}

function itemDependsOnOtherWork(item: PccExecutionWorkItem): boolean {
  return Array.isArray(item.dependsOn) && item.dependsOn.length > 0;
}

function itemCanRunLocally(item: PccExecutionWorkItem): boolean {
  const responsibility = pccResponsibilityForItem(item);
  return responsibility === "local_openclaw_agent" || responsibility === "local_model";
}

/**
 * Converts the old producer-only flag into the canonical execution contract.
 * This helper never invents safety: parallelSafe is only copied from the legacy
 * affirmative flag, and dependencies or non-local responsibility always win.
 */
export function repairPccExecutionMetadata(
  projectId: string,
  item: PccExecutionWorkItem,
): PccExecutionMetadataRepair {
  const source = metadata(item.metadata);
  const next = { ...source };
  const issueCodes: string[] = [];
  const legacyParallelSafe = source.pccParallelSafe === true;
  const canonicalParallelSafe = source.parallelSafe === true;
  const canonicalParallelSafeIsValid =
    source.parallelSafe === undefined || typeof source.parallelSafe === "boolean";
  const inheritsLegacySafety = source.parallelSafe === undefined && legacyParallelSafe;
  const safeByContract =
    itemCanRunLocally(item) &&
    !itemDependsOnOtherWork(item) &&
    canonicalParallelSafeIsValid &&
    (inheritsLegacySafety || canonicalParallelSafe);

  if (inheritsLegacySafety) {
    next.parallelSafe = safeByContract;
    issueCodes.push("PCC_EXECUTION_LEGACY_PARALLEL_SAFE");
  } else if (source.parallelSafe !== undefined && typeof source.parallelSafe !== "boolean") {
    delete next.parallelSafe;
    issueCodes.push("PCC_EXECUTION_PARALLEL_SAFE_INVALID");
  }

  if (canonicalParallelSafe && !safeByContract) {
    next.parallelSafe = false;
    if (!issueCodes.includes("PCC_EXECUTION_PARALLEL_SAFE_INVALID")) {
      issueCodes.push("PCC_EXECUTION_PARALLEL_SAFE_INVALID");
    }
  }

  if (safeByContract && !nonEmptyString(source.workspaceLock)) {
    next.workspaceLock = canonicalWorkspaceId(projectId, item);
    issueCodes.push("PCC_EXECUTION_WORKSPACE_LEASE_MISSING");
  }

  if (next.parallelSafe !== true || !nonEmptyString(next.workspaceLock)) {
    if (next.parallelSafe === true && !nonEmptyString(next.workspaceLock)) {
      next.parallelSafe = false;
    }
  }

  if (issueCodes.length === 0) {
    return { item, issueCodes };
  }
  return { item: { ...item, metadata: next }, issueCodes };
}

export function pccExecutionPlansFromProject(project: PccProject): PccExecutionPlan[] {
  const raw = metadata(project.metadata).pccExecutionPlans;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((candidate) => {
    const plan = recordValue(candidate);
    if (!plan) {
      return [];
    }
    const coordinator = recordValue(plan.coordinator);
    const partitions = Array.isArray(plan.partitions) ? plan.partitions : [];
    const leases = Array.isArray(plan.leases) ? plan.leases : [];
    const proofRequirements = Array.isArray(plan.proofRequirements) ? plan.proofRequirements : [];
    const proofCandidates = Array.isArray(plan.proofCandidates) ? plan.proofCandidates : [];
    const auditEvents = Array.isArray(plan.auditEvents) ? plan.auditEvents : [];
    if (
      plan.schemaVersion !== 1 ||
      !nonEmptyString(plan.id) ||
      plan.projectId !== project.id ||
      !nonEmptyString(plan.projectRevision) ||
      !isPccExecutionPlanStatus(plan.status) ||
      !nonEmptyString(plan.createdAt) ||
      !nonEmptyString(plan.updatedAt) ||
      !recordValue(plan.profile) ||
      (plan.mode !== "local_only" && plan.mode !== "hybrid") ||
      !Number.isInteger(plan.admittedWorkerCount) ||
      (plan.admittedWorkerCount as number) < 0 ||
      !coordinator ||
      !nonEmptyString(coordinator.sessionId) ||
      !nonEmptyString(coordinator.runId) ||
      !Array.isArray(plan.approvals) ||
      partitions.some((value) => {
        const partition = recordValue(value);
        return (
          !partition ||
          !nonEmptyString(partition.id) ||
          !nonEmptyString(partition.taskId) ||
          !nonEmptyString(partition.workerId) ||
          !nonEmptyString(partition.status) ||
          ![
            "pending",
            "assigned",
            "running",
            "succeeded",
            "failed",
            "blocked",
            "cancelled",
          ].includes(partition.status)
        );
      }) ||
      leases.some((value) => {
        const lease = recordValue(value);
        return (
          !lease ||
          !nonEmptyString(lease.workspaceId) ||
          !nonEmptyString(lease.planId) ||
          !nonEmptyString(lease.partitionId) ||
          !nonEmptyString(lease.holderId) ||
          !nonEmptyString(lease.acquiredAt) ||
          !nonEmptyString(lease.expiresAt)
        );
      }) ||
      proofRequirements.some((value) => {
        const requirement = recordValue(value);
        return (
          !requirement ||
          !nonEmptyString(requirement.milestoneId) ||
          !nonEmptyString(requirement.proofId) ||
          !nonEmptyString(requirement.description)
        );
      }) ||
      proofCandidates.some((value) => {
        const proofCandidate = recordValue(value);
        return (
          !proofCandidate ||
          !nonEmptyString(proofCandidate.id) ||
          proofCandidate.planId !== plan.id ||
          proofCandidate.projectId !== project.id ||
          !nonEmptyString(proofCandidate.runId) ||
          !nonEmptyString(proofCandidate.summary) ||
          !Array.isArray(proofCandidate.changedFiles) ||
          proofCandidate.changedFiles.some((file) => !nonEmptyString(file)) ||
          !Array.isArray(proofCandidate.checks) ||
          proofCandidate.checks.some((check) => !nonEmptyString(check)) ||
          !Array.isArray(proofCandidate.blockers) ||
          proofCandidate.blockers.some((blocker) => !nonEmptyString(blocker)) ||
          !Array.isArray(proofCandidate.risks) ||
          proofCandidate.risks.some((risk) => !nonEmptyString(risk)) ||
          !["pending_review", "accepted", "rejected"].includes(String(proofCandidate.status)) ||
          !nonEmptyString(proofCandidate.createdAt)
        );
      }) ||
      auditEvents.some((value) => {
        const event = recordValue(value);
        return !event || !nonEmptyString(event.at) || !isPccExecutionPlanStatus(event.status);
      })
    ) {
      return [];
    }
    return [
      {
        ...(plan as unknown as PccExecutionPlan),
        proofCandidates: proofCandidates as PccExecutionPlan["proofCandidates"],
      },
    ];
  });
}

export function pccExecutionIdempotencyKeys(project: PccProject): Record<string, string> {
  const raw = metadata(project.metadata).pccExecutionIdempotencyKeys;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw).filter(([key, value]) => nonEmptyString(key) && nonEmptyString(value)),
  );
}

export function withPccExecutionPlanMetadata(
  project: PccProject,
  plan: PccExecutionPlan,
  idempotencyKey: string,
  updatedAt: string,
): PccProject["metadata"] {
  const source = metadata(project.metadata);
  const plans = [
    ...pccExecutionPlansFromProject(project).filter((item) => item.id !== plan.id),
    plan,
  ];
  const idempotencyKeys = {
    ...pccExecutionIdempotencyKeys(project),
    [idempotencyKey]: plan.id,
  };
  const boundedPlans = plans.slice(-20);
  return {
    ...source,
    pccExecutionPlans: boundedPlans,
    pccExecutionIdempotencyKeys: idempotencyKeys,
    pccActiveExecutionPlanId: ["prepared", "dispatching", "running", "paused", "blocked"].includes(
      plan.status,
    )
      ? plan.id
      : null,
    pccExecutionLastUpdatedAt: updatedAt,
    pccWorkLoop: {
      ...metadata(source.pccWorkLoop),
      enabled: ["prepared", "dispatching", "running", "paused", "blocked"].includes(plan.status),
      state:
        plan.status === "paused"
          ? "paused"
          : plan.status === "failed" || plan.status === "lost"
            ? "failed"
            : plan.status === "blocked"
              ? "blocked"
              : ["prepared", "dispatching", "running"].includes(plan.status)
                ? "working"
                : "idle",
      updatedAt,
    },
  };
}

export function pccExecutionPlanId(projectId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(`${projectId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24);
  return `pcc-execution-${digest}`;
}

export function pccExecutionWorkspaceLease(
  planId: string,
  partition: PccExecutionTaskPartition,
  acquiredAt: string,
  durationMs = 2 * 60 * 60 * 1_000,
): PccExecutionWorkspaceLease | undefined {
  if (!nonEmptyString(partition.workspaceId)) {
    return undefined;
  }
  return {
    workspaceId: partition.workspaceId,
    planId,
    partitionId: partition.id,
    holderId: partition.workerId,
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + durationMs).toISOString(),
  };
}

export function findNextPccExecutionCandidate(params: {
  project: PccProject;
  milestones: readonly PccMilestone[];
  subMilestones: readonly PccSubMilestone[];
}): PccExecutionStartCandidate | undefined {
  const milestones = params.milestones
    .filter((item) => item.projectId === params.project.id)
    .toSorted(
      (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id),
    );
  for (const milestone of milestones) {
    if (isPccTerminalStatus(milestone.status)) {
      continue;
    }
    const children = params.subMilestones
      .filter((item) => item.projectId === params.project.id && item.milestoneId === milestone.id)
      .toSorted(
        (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id),
      );
    const candidates: PccExecutionWorkItem[] = children.length > 0 ? children : [milestone];
    for (const candidate of candidates) {
      if (!EXECUTABLE_STATUSES.has(candidate.status)) {
        continue;
      }
      const repaired = repairPccExecutionMetadata(params.project.id, candidate);
      if (!itemCanRunLocally(repaired.item) || repaired.item.metadata === undefined) {
        continue;
      }
      const repairedMetadata = metadata(repaired.item.metadata);
      if (
        repairedMetadata.parallelSafe !== true ||
        !nonEmptyString(repairedMetadata.workspaceLock)
      ) {
        continue;
      }
      const title =
        "milestoneId" in repaired.item
          ? `${milestone.title}: ${repaired.item.title}`
          : repaired.item.title;
      return {
        item: repaired.item,
        milestoneId: milestone.id,
        task: {
          id:
            "milestoneId" in repaired.item
              ? `submilestone:${repaired.item.id}`
              : `milestone:${repaired.item.id}`,
          title,
          independent: true,
          workspaceId: repairedMetadata.workspaceLock as string,
          milestoneId: milestone.id,
        },
      };
    }
  }
  return undefined;
}

export function pccExecutionStatusIsActive(status: string): boolean {
  return ["prepared", "dispatching", "running", "paused", "blocked"].includes(status);
}

export function pccExecutionStatusIsTerminal(status: string): boolean {
  return ["failed", "lost", "completed", "cancelled"].includes(status);
}

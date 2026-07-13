import type { PccExecutionProfile } from "./execution-profile.js";

export const PCC_EXECUTION_PLAN_SCHEMA_VERSION = 1 as const;

export type PccExecutionPlanMode = "local_only" | "hybrid";
export type PccExecutionPlanStatus =
  | "prepared"
  | "dispatching"
  | "running"
  | "paused"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";
export type PccExecutionPartitionStatus =
  | "pending"
  | "assigned"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type PccExecutionCoordinator = {
  sessionId: string;
  runId: string;
};

export type PccExecutionTask = {
  id: string;
  title: string;
  independent: boolean;
  workspaceId?: string;
  milestoneId?: string;
};

export type PccExecutionTaskPartition = {
  id: string;
  taskId: string;
  workerId: string;
  workspaceId?: string;
  milestoneId?: string;
  status: PccExecutionPartitionStatus;
};

export type PccExecutionWorkspaceLease = {
  workspaceId: string;
  planId: string;
  partitionId: string;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
};

export type PccExecutionProofRequirement = {
  milestoneId: string;
  proofId: string;
  description: string;
};

export type PccExecutionPlanAuditEvent = {
  at: string;
  status: PccExecutionPlanStatus;
  reason?: string;
};

export type PccExecutionPlan = {
  schemaVersion: typeof PCC_EXECUTION_PLAN_SCHEMA_VERSION;
  id: string;
  projectId: string;
  projectRevision: string;
  profile: PccExecutionProfile;
  mode: PccExecutionPlanMode;
  coordinator: PccExecutionCoordinator;
  admittedWorkerCount: number;
  status: PccExecutionPlanStatus;
  partitions: readonly PccExecutionTaskPartition[];
  leases: readonly PccExecutionWorkspaceLease[];
  proofRequirements: readonly PccExecutionProofRequirement[];
  createdAt: string;
  updatedAt: string;
  statusReason?: string;
  auditEvents: readonly PccExecutionPlanAuditEvent[];
};

export type PccTaskPartitioningResult = {
  partitions: PccExecutionTaskPartition[];
  skippedDependentTaskIds: string[];
};

export type PccFanInAccounting = {
  expected: number;
  succeeded: number;
  failed: number;
  blocked: number;
  cancelled: number;
  incomplete: number;
  readyForFanIn: boolean;
};

export type PccPlanCompletionAssessment = {
  canCompletePlan: boolean;
  missingProofIds: string[];
  fanIn: PccFanInAccounting;
  /** PCC milestone state is always a separate, explicit workflow action. */
  canAutoCompleteMilestones: false;
  milestoneIdsRequiringExplicitCompletion: string[];
};

const ACTIVE_STATUSES = new Set<PccExecutionPlanStatus>([
  "prepared",
  "dispatching",
  "running",
  "paused",
  "blocked",
]);
const MAX_AUDIT_EVENTS = 128;

const TRANSITIONS: Readonly<Record<PccExecutionPlanStatus, readonly PccExecutionPlanStatus[]>> = {
  prepared: ["dispatching", "cancelled"],
  dispatching: ["running", "paused", "blocked", "failed", "cancelled"],
  running: ["paused", "blocked", "failed", "completed", "cancelled"],
  paused: ["dispatching", "blocked", "failed", "cancelled"],
  blocked: ["dispatching", "paused", "failed", "cancelled"],
  failed: ["dispatching", "cancelled"],
  completed: [],
  cancelled: [],
};

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must be non-empty`);
  }
  return trimmed;
}

function wholeNonNegative(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function timestamp(value: string | undefined, field: string): string {
  const resolved = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(resolved))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return resolved;
}

/** A plan is hybrid only when its snapshot intentionally assigns a Codex role. */
export function pccExecutionPlanMode(profile: PccExecutionProfile): PccExecutionPlanMode {
  return profile.codexRole === "off" ? "local_only" : "hybrid";
}

export function createPccExecutionPlan(input: {
  id: string;
  projectId: string;
  projectRevision: string;
  profile: PccExecutionProfile;
  coordinator: PccExecutionCoordinator;
  admittedWorkerCount: number;
  partitions?: readonly PccExecutionTaskPartition[];
  leases?: readonly PccExecutionWorkspaceLease[];
  proofRequirements?: readonly PccExecutionProofRequirement[];
  createdAt?: string;
  statusReason?: string;
}): PccExecutionPlan {
  const admittedWorkerCount = wholeNonNegative(input.admittedWorkerCount, "admittedWorkerCount");
  const distinctWorkerIds = new Set(
    (input.partitions ?? []).map((partition) => nonEmpty(partition.workerId, "partition.workerId")),
  );
  if (distinctWorkerIds.size > admittedWorkerCount) {
    throw new Error("distinct partition workers cannot exceed admittedWorkerCount");
  }
  const createdAt = timestamp(input.createdAt, "createdAt");
  const statusReason = input.statusReason?.trim();
  return {
    schemaVersion: PCC_EXECUTION_PLAN_SCHEMA_VERSION,
    id: nonEmpty(input.id, "id"),
    projectId: nonEmpty(input.projectId, "projectId"),
    projectRevision: nonEmpty(input.projectRevision, "projectRevision"),
    profile: { ...input.profile },
    mode: pccExecutionPlanMode(input.profile),
    coordinator: {
      sessionId: nonEmpty(input.coordinator.sessionId, "coordinator.sessionId"),
      runId: nonEmpty(input.coordinator.runId, "coordinator.runId"),
    },
    admittedWorkerCount,
    status: "prepared",
    partitions: [...(input.partitions ?? [])],
    leases: [...(input.leases ?? [])],
    proofRequirements: [...(input.proofRequirements ?? [])],
    createdAt,
    updatedAt: createdAt,
    ...(statusReason ? { statusReason } : {}),
    auditEvents: [
      {
        at: createdAt,
        status: "prepared",
        ...(statusReason ? { reason: statusReason } : {}),
      },
    ],
  };
}

export function isPccExecutionPlanActive(status: PccExecutionPlanStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Active plans are exclusive per project, including across a project revision change. */
export function findDuplicateActivePccExecutionPlan(
  plans: readonly PccExecutionPlan[],
  candidate: Pick<PccExecutionPlan, "id" | "projectId">,
): PccExecutionPlan | undefined {
  return plans.find(
    (plan) =>
      plan.id !== candidate.id &&
      plan.projectId === candidate.projectId &&
      isPccExecutionPlanActive(plan.status),
  );
}

export function canTransitionPccExecutionPlan(
  from: PccExecutionPlanStatus,
  to: PccExecutionPlanStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionPccExecutionPlan(
  plan: PccExecutionPlan,
  status: PccExecutionPlanStatus,
  options: { at?: string; reason?: string } = {},
): PccExecutionPlan {
  if (!canTransitionPccExecutionPlan(plan.status, status)) {
    throw new Error(`illegal PCC execution-plan transition: ${plan.status} -> ${status}`);
  }
  const at = timestamp(options.at, "transition.at");
  if (Date.parse(at) < Date.parse(plan.updatedAt)) {
    throw new Error("PCC execution-plan transition timestamp cannot move backward");
  }
  const reason = options.reason?.trim();
  const auditEvents = [...plan.auditEvents, { at, status, ...(reason ? { reason } : {}) }].slice(
    -MAX_AUDIT_EVENTS,
  );
  return {
    ...plan,
    status,
    updatedAt: at,
    ...(reason ? { statusReason: reason } : {}),
    auditEvents,
  };
}

/**
 * Produces stable assignments only for explicitly independent tasks. Dependent work
 * remains unpartitioned for the coordinator; this helper never infers independence.
 */
export function partitionPccExecutionTasks(
  tasks: readonly PccExecutionTask[],
  workerIds: readonly string[],
): PccTaskPartitioningResult {
  const uniqueWorkers = [
    ...new Set(workerIds.map((workerId) => workerId.trim()).filter(Boolean)),
  ].toSorted();
  if (tasks.some((task) => task.independent) && uniqueWorkers.length === 0) {
    throw new Error("at least one worker is required for independent tasks");
  }
  const sorted = tasks.toSorted((left, right) => left.id.localeCompare(right.id));
  const partitions: PccExecutionTaskPartition[] = [];
  const skippedDependentTaskIds: string[] = [];
  let workerIndex = 0;
  for (const task of sorted) {
    if (!task.independent) {
      skippedDependentTaskIds.push(task.id);
      continue;
    }
    const workerId = uniqueWorkers[workerIndex % uniqueWorkers.length];
    if (!workerId) {
      throw new Error("at least one worker is required for independent tasks");
    }
    partitions.push({
      id: `partition:${task.id}`,
      taskId: task.id,
      workerId,
      ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
      ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
      status: "pending",
    });
    workerIndex += 1;
  }
  return { partitions, skippedDependentTaskIds };
}

/** Invalid or elapsed timestamps are expired, so stale leases fail closed. */
export function isPccExecutionWorkspaceLeaseExpired(
  lease: PccExecutionWorkspaceLease,
  now: Date | string | number,
): boolean {
  const expiresAt = Date.parse(lease.expiresAt);
  const nowMs =
    now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  return !Number.isFinite(expiresAt) || !Number.isFinite(nowMs) || expiresAt <= nowMs;
}

export function findPccExecutionWorkspaceLeaseCollision(
  leases: readonly PccExecutionWorkspaceLease[],
  candidate: Pick<PccExecutionWorkspaceLease, "workspaceId" | "planId" | "partitionId">,
  now: Date | string | number,
): PccExecutionWorkspaceLease | undefined {
  return leases.find(
    (lease) =>
      lease.workspaceId === candidate.workspaceId &&
      (lease.planId !== candidate.planId || lease.partitionId !== candidate.partitionId) &&
      !isPccExecutionWorkspaceLeaseExpired(lease, now),
  );
}

export function accountPccExecutionFanIn(
  partitions: readonly Pick<PccExecutionTaskPartition, "status">[],
): PccFanInAccounting {
  const counts = { succeeded: 0, failed: 0, blocked: 0, cancelled: 0, incomplete: 0 };
  for (const partition of partitions) {
    switch (partition.status) {
      case "succeeded":
        counts.succeeded += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "blocked":
        counts.blocked += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      default:
        counts.incomplete += 1;
    }
  }
  return {
    expected: partitions.length,
    ...counts,
    readyForFanIn: counts.incomplete === 0,
  };
}

/**
 * Plan completion is distinct from PCC milestone completion. Even complete proof
 * receipts require an explicit PCC milestone transition by the owning workflow.
 */
export function assessPccExecutionPlanCompletion(
  plan: {
    partitions: readonly Pick<PccExecutionTaskPartition, "status">[];
    proofRequirements: readonly PccExecutionProofRequirement[];
  },
  satisfiedProofIds: readonly string[],
): PccPlanCompletionAssessment {
  const satisfied = new Set(satisfiedProofIds);
  const missingProofIds = plan.proofRequirements
    .map((requirement) => requirement.proofId)
    .filter((proofId) => !satisfied.has(proofId));
  const milestoneIdsRequiringExplicitCompletion = [
    ...new Set(plan.proofRequirements.map((requirement) => requirement.milestoneId)),
  ].toSorted();
  const fanIn = accountPccExecutionFanIn(plan.partitions);
  return {
    canCompletePlan:
      fanIn.readyForFanIn && fanIn.succeeded === fanIn.expected && missingProofIds.length === 0,
    missingProofIds,
    fanIn,
    canAutoCompleteMilestones: false,
    milestoneIdsRequiringExplicitCompletion,
  };
}

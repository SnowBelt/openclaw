import { isPccTerminalStatus } from "../../../../../src/pcc/domain/completion-policy.js";
import type { PccExecutionCapacitySnapshot } from "../../../../../src/pcc/execution-capacity.js";
import {
  findPccExecutionWorkspaceLeaseCollision,
  isPccExecutionPlanActive,
  type PccExecutionPlan,
  type PccExecutionTask,
} from "../../../../../src/pcc/execution-plan.js";
import {
  PCC_BEST_AVAILABLE_MODEL_ID,
  normalizePccExecutionProfile,
  pccCodexEffortIsSupported,
  resolvePccEstimatedAgentCounts,
  type PccExecutionProfile,
} from "../../../../../src/pcc/execution-profile.js";
import { evaluatePccProjectSetup } from "../../../../../src/pcc/intake-quality.js";
import { pccMetadataObject, pccResponsibilityForItem } from "../../../../../src/pcc/metadata.js";
import { buildQualifiedChatModelValue } from "../../chat-model-ref.ts";
import type {
  AgentsListResult,
  ModelCatalogEntry,
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccStatus,
  PccSubMilestone,
} from "../../types.ts";
import type { PccExecutionTeamReadiness, PccProjectDetail } from "./state.ts";

function metadataString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

const PCC_EXECUTION_TEAM_TASK_STATUSES = new Set<PccStatus>([
  "not_started",
  "active",
  "in_progress",
  "reopened",
]);

const PCC_EXECUTION_PLAN_STATUSES = new Set([
  "prepared",
  "dispatching",
  "running",
  "paused",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

function isCodexModelRef(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.includes("codex/") || normalized.includes("codex:");
}

function isCodexCatalogModel(entry: ModelCatalogEntry): boolean {
  return (
    entry.agentRuntime?.id === "codex" || entry.provider.trim().toLowerCase().includes("codex")
  );
}

function modelRefFromCatalog(entry: ModelCatalogEntry): string {
  return buildQualifiedChatModelValue(entry.id, entry.provider);
}

export function resolveConfiguredExecutionModel(
  selection: string,
  catalog: readonly ModelCatalogEntry[] | undefined,
  kind: "openclaw" | "codex",
): string | null {
  const entries = (catalog ?? []).filter(
    (entry) =>
      entry.available !== false &&
      (kind === "codex" ? isCodexCatalogModel(entry) : !isCodexCatalogModel(entry)),
  );
  if (selection === PCC_BEST_AVAILABLE_MODEL_ID) {
    return entries[0] ? modelRefFromCatalog(entries[0]) : null;
  }
  return entries.some((entry) => modelRefFromCatalog(entry) === selection) ? selection : null;
}

export function executionPlansFromProject(project: PccProject): PccExecutionPlan[] {
  const raw = pccMetadataObject(project.metadata).pccExecutionPlans;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is PccExecutionPlan => {
    const record = pccMetadataObject(value);
    return (
      record.schemaVersion === 1 &&
      typeof record.id === "string" &&
      typeof record.projectId === "string" &&
      record.projectId === project.id &&
      typeof record.projectRevision === "string" &&
      typeof record.status === "string" &&
      PCC_EXECUTION_PLAN_STATUSES.has(record.status) &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string" &&
      Array.isArray(record.partitions) &&
      Array.isArray(record.leases) &&
      Array.isArray(record.proofRequirements) &&
      Array.isArray(record.auditEvents)
    );
  });
}

function executionWorkspaceId(item: PccMilestone | PccSubMilestone): string {
  return metadataString(pccMetadataObject(item.metadata).workspaceLock, "").trim();
}

function executionItemIsLocal(item: PccMilestone | PccSubMilestone): boolean {
  const responsibility = pccResponsibilityForItem(item);
  return responsibility === "local_openclaw_agent" || responsibility === "local_model";
}

function executionItemIsParallelSafe(item: PccMilestone | PccSubMilestone): boolean {
  const metadata = pccMetadataObject(item.metadata);
  return (
    metadata.parallelSafe === true &&
    PCC_EXECUTION_TEAM_TASK_STATUSES.has(item.status) &&
    executionItemIsLocal(item) &&
    executionWorkspaceId(item).length > 0
  );
}

export function executionTasksForDetail(detail: PccProjectDetail): PccExecutionTask[] {
  const subMilestones = detail.subMilestones ?? [];
  const candidateItems: Array<{
    item: PccMilestone | PccSubMilestone;
    milestoneId: string;
    title: string;
    order: number;
  }> = [];
  for (const milestone of detail.milestones.toSorted(
    (left, right) => (left.order ?? 0) - (right.order ?? 0),
  )) {
    const children = subMilestones
      .filter((item) => item.milestoneId === milestone.id)
      .toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const runnableChildren = children.filter((item) =>
      PCC_EXECUTION_TEAM_TASK_STATUSES.has(item.status),
    );
    if (runnableChildren.length > 0) {
      for (const child of runnableChildren) {
        candidateItems.push({
          item: child,
          milestoneId: milestone.id,
          title: `${milestone.title}: ${child.title}`,
          order: (milestone.order ?? 0) * 10_000 + (child.order ?? 0),
        });
      }
      continue;
    }
    candidateItems.push({
      item: milestone,
      milestoneId: milestone.id,
      title: milestone.title,
      order: (milestone.order ?? 0) * 10_000,
    });
  }

  const claimedWorkspaces = new Set<string>();
  return candidateItems
    .toSorted((left, right) => left.order - right.order)
    .flatMap(({ item, milestoneId, title }) => {
      if (!executionItemIsParallelSafe(item)) {
        return [];
      }
      const workspaceId = executionWorkspaceId(item);
      if (claimedWorkspaces.has(workspaceId)) {
        return [];
      }
      claimedWorkspaces.add(workspaceId);
      return [
        {
          id: `${"milestoneId" in item ? "submilestone" : "milestone"}:${item.id}`,
          title,
          independent: true,
          workspaceId,
          milestoneId,
        },
      ];
    });
}

function activePccExecutionPlan(detail: PccProjectDetail): PccExecutionPlan | null {
  return (
    executionPlansFromProject(detail.project)
      .filter((plan) => isPccExecutionPlanActive(plan.status))
      .toSorted((left, right) => right.id.localeCompare(left.id))[0] ?? null
  );
}

export function pccCodexPermissionIsUsable(
  permission: PccPermissionGrant,
  profile: PccExecutionProfile,
  nowMs = Date.now(),
): boolean {
  const typeMatches =
    profile.codexEffort === "medium"
      ? permission.type === "codex_usage" || permission.type === "high_reasoning_model"
      : permission.type === "high_reasoning_model";
  const expiresAt = permission.expiresAt
    ? Date.parse(permission.expiresAt)
    : Number.POSITIVE_INFINITY;
  const usesRemain = permission.maxUses === undefined || permission.usedCount < permission.maxUses;
  return typeMatches && permission.status === "granted" && expiresAt > nowMs && usesRemain;
}

function resolvePccCoordinatorSelection(
  agentsList: AgentsListResult | null | undefined,
  catalog: readonly ModelCatalogEntry[] | undefined,
  selectedModelId: string,
): { agentId: string; workerModelId: string } | null {
  const availableModelRefs = new Set(
    (catalog ?? [])
      .filter((entry) => entry.available !== false && !isCodexCatalogModel(entry))
      .map(modelRefFromCatalog),
  );
  const candidates = (agentsList?.agents ?? []).filter(
    (agent) =>
      agent.model?.primary &&
      agent.agentRuntime?.id !== "codex" &&
      !isCodexModelRef(agent.model.primary) &&
      availableModelRefs.has(agent.model.primary),
  );
  const exact =
    selectedModelId === PCC_BEST_AVAILABLE_MODEL_ID
      ? (candidates.find((agent) => agent.id === agentsList?.defaultId) ?? candidates[0])
      : candidates.find((agent) => agent.model?.primary === selectedModelId);
  const workerModelId = exact?.model?.primary;
  return exact && workerModelId ? { agentId: exact.id, workerModelId } : null;
}

export function buildPccExecutionTeamReadiness(
  detail: PccProjectDetail,
  capacity: PccExecutionCapacitySnapshot | null | undefined,
  agentsList: AgentsListResult | null | undefined,
  catalog: readonly ModelCatalogEntry[] | undefined,
  projectDetails: readonly PccProjectDetail[] = [],
): PccExecutionTeamReadiness {
  const profile = normalizePccExecutionProfile(detail.project.metadata);
  const activePlan = activePccExecutionPlan(detail);
  const tasks = executionTasksForDetail(detail);
  const counts = resolvePccEstimatedAgentCounts(profile, capacity?.safeLocalAgentSlots ?? 0);
  const coordinatorSelection = resolvePccCoordinatorSelection(
    agentsList,
    catalog,
    profile.localModelId,
  );
  const workerModelId =
    coordinatorSelection?.workerModelId ??
    resolveConfiguredExecutionModel(profile.localModelId, catalog, "openclaw");
  const codexModelId =
    profile.codexRole === "off"
      ? null
      : resolveConfiguredExecutionModel(profile.codexModelId, catalog, "codex");
  const coordinatorAgentId = coordinatorSelection?.agentId ?? null;
  const base = {
    profile,
    activePlan,
    tasks,
    admittedLocalAgents: Math.min(counts.localAgents, tasks.length),
    codexAgents: counts.codexAgents,
    coordinatorAgentId,
    workerModelId,
    codexModelId,
  } as const;

  if (activePlan) {
    return {
      ...base,
      status: "running",
      reason: `${activePlan.admittedWorkerCount} OpenClaw worker${activePlan.admittedWorkerCount === 1 ? " is" : "s are"} assigned. Review the plan before stopping it.`,
    };
  }
  if (profile.speed === "focused") {
    return {
      ...base,
      status: "focused",
      reason: "Focused uses one worker at a time. Choose Parallel or Ultra to run an agent team.",
    };
  }
  if (isPccTerminalStatus(detail.project.status)) {
    return { ...base, status: "blocked", reason: "This project is complete or archived." };
  }
  if (!["active", "in_progress", "reopened"].includes(detail.project.status)) {
    return {
      ...base,
      status: "blocked",
      reason: `The project is ${detail.project.status.replace(/_/gu, " ")}. Resolve that state before running a team.`,
    };
  }
  const setup = evaluatePccProjectSetup({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
  });
  if (!setup.runnable) {
    return {
      ...base,
      status: "blocked",
      reason:
        setup.missing[0] ?? setup.violations[0] ?? setup.needsReview[0] ?? "Setup needs review.",
    };
  }
  if (tasks.length === 0) {
    return {
      ...base,
      status: "blocked",
      reason: "No ready tasks are explicitly marked parallel-safe with separate workspace locks.",
    };
  }
  const otherActiveLeases = projectDetails
    .filter((candidate) => candidate.project.id !== detail.project.id)
    .flatMap((candidate) =>
      executionPlansFromProject(candidate.project)
        .filter((plan) => isPccExecutionPlanActive(plan.status))
        .flatMap((plan) => plan.leases),
    );
  const workspaceCollision = tasks
    .filter((task): task is PccExecutionTask & { workspaceId: string } => Boolean(task.workspaceId))
    .map((task) =>
      findPccExecutionWorkspaceLeaseCollision(
        otherActiveLeases,
        {
          workspaceId: task.workspaceId,
          planId: `candidate:${detail.project.id}`,
          partitionId: `candidate:${task.id}`,
        },
        Date.now(),
      ),
    )
    .find(Boolean);
  if (workspaceCollision) {
    return {
      ...base,
      status: "blocked",
      reason: `Workspace ${workspaceCollision.workspaceId} is already leased by another active agent team.`,
    };
  }
  if (!capacity || capacity.safeLocalAgentSlots === 0 || base.admittedLocalAgents === 0) {
    return {
      ...base,
      status: "blocked",
      reason: capacity?.warnings[0] ?? "No safe OpenClaw worker capacity is available right now.",
    };
  }
  if (!workerModelId) {
    return {
      ...base,
      status: "blocked",
      reason: "Refresh models and choose an available OpenClaw worker model.",
    };
  }
  if (!coordinatorAgentId) {
    return {
      ...base,
      status: "blocked",
      reason: workerModelId
        ? `No non-Codex OpenClaw coordinator agent is configured with ${workerModelId}. Choose an available agent model or update the agent configuration.`
        : "No non-Codex OpenClaw coordinator agent is configured with an available model.",
    };
  }
  if (profile.codexRole !== "off") {
    if (!codexModelId) {
      return {
        ...base,
        status: "blocked",
        reason: "Refresh models and choose an available Codex model for this profile.",
      };
    }
    if (!pccCodexEffortIsSupported(codexModelId, profile.codexEffort)) {
      return {
        ...base,
        status: "blocked",
        reason: "Maximum Codex depth requires a configured GPT-5.6 model.",
      };
    }
    if (!detail.permissions.some((permission) => pccCodexPermissionIsUsable(permission, profile))) {
      return {
        ...base,
        status: "needs_approval",
        reason:
          "Approve the selected Codex role for this project, or switch to a Codex-off profile.",
      };
    }
  }
  return {
    ...base,
    status: "ready",
    reason: `${base.admittedLocalAgents} OpenClaw worker${base.admittedLocalAgents === 1 ? "" : "s"} can run ${tasks.length} independent task${tasks.length === 1 ? "" : "s"} with separate workspace leases.`,
  };
}

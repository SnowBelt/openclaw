import type {
  PccOverviewGetResult,
  PccPermissionGrant,
  PccProject,
  PccProjectSummary,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { isPccCompleteStatus } from "./domain/completion-policy.js";
import type { PccLedger } from "./domain/ledger.js";
import { isPccExecutionPlanStatus } from "./execution-plan.js";
import { pccMetadataObject, pccMetadataString } from "./metadata.js";
import { buildPccLedgerReadIndex, pccIndexedItems } from "./read-model/ledger-index.js";
import { summarizePccPortfolio, summarizePccProject } from "./read-model/project-summary.js";
import { normalizePccTimestamp } from "./timestamps.js";

type PccOverviewProject = PccOverviewGetResult["projects"][number];
type PccOverviewAttentionItem = PccOverviewGetResult["attention"][number];
type PccOverviewAgentAssignment = PccOverviewGetResult["activeAgents"][number];
type PccOverviewActivity = PccOverviewGetResult["recentActivity"][number];

type ExecutionPartition = {
  id: string;
  taskId: string;
  workerId: string;
  milestoneId?: string;
  status: "pending" | "assigned" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
};

type ExecutionPlan = {
  id: string;
  status: "prepared" | "dispatching" | "running" | "paused" | "blocked" | "failed";
  coordinator?: { sessionId?: string };
  partitions: ExecutionPartition[];
  createdAt: string;
  updatedAt: string;
};

const ACTIVE_PLAN_STATUSES = new Set(["prepared", "dispatching", "running", "paused", "blocked"]);

function executionPlans(project: PccProject): ExecutionPlan[] {
  const raw = pccMetadataObject(project.metadata).pccExecutionPlans;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((value) => {
    const item = pccMetadataObject(value);
    if (
      item.schemaVersion !== 1 ||
      typeof item.id !== "string" ||
      item.projectId !== project.id ||
      !isPccExecutionPlanStatus(item.status) ||
      !ACTIVE_PLAN_STATUSES.has(item.status) ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      !Array.isArray(item.partitions)
    ) {
      return [];
    }
    const partitions = item.partitions.flatMap((candidate) => {
      const partition = pccMetadataObject(candidate);
      if (
        typeof partition.id !== "string" ||
        typeof partition.taskId !== "string" ||
        typeof partition.workerId !== "string" ||
        typeof partition.status !== "string" ||
        !["pending", "assigned", "running", "succeeded", "failed", "blocked", "cancelled"].includes(
          partition.status,
        )
      ) {
        return [];
      }
      return [
        {
          id: partition.id,
          taskId: partition.taskId,
          workerId: partition.workerId,
          status: partition.status as ExecutionPartition["status"],
          ...(typeof partition.milestoneId === "string"
            ? { milestoneId: partition.milestoneId }
            : {}),
        },
      ];
    });
    return [
      {
        id: item.id,
        status: item.status as ExecutionPlan["status"],
        partitions,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        coordinator:
          item.coordinator && typeof item.coordinator === "object"
            ? (item.coordinator as ExecutionPlan["coordinator"])
            : undefined,
      },
    ];
  });
}

function currentMilestone(ledger: PccLedger, projectId: string) {
  return ledger.milestones
    .filter(
      (milestone) => milestone.projectId === projectId && !isPccCompleteStatus(milestone.status),
    )
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
}

function workState(
  project: PccProject,
  summary: PccProjectSummary,
  plan: ExecutionPlan | undefined,
  permissionNeeded: boolean,
): PccOverviewProject["workState"] {
  if (project.status === "archived") {
    return "complete";
  }
  if (
    permissionNeeded ||
    project.status === "needs_approval" ||
    summary.milestoneCounts.needsApproval > 0
  ) {
    return "needs_you";
  }
  if (
    project.status === "blocked" ||
    summary.milestoneCounts.blocked > 0 ||
    plan?.status === "blocked"
  ) {
    return "blocked";
  }
  if (plan?.status === "running" || plan?.status === "dispatching") {
    return "working";
  }
  if (plan?.status === "paused") {
    return "paused";
  }
  if (plan?.status === "failed" || project.status === "failed") {
    return "failed";
  }
  if (isPccCompleteStatus(project.status)) {
    return "complete";
  }
  return "ready";
}

function permissionAttention(permission: PccPermissionGrant, project: PccProject) {
  if (permission.status !== "needed" && permission.status !== "blocked") {
    return undefined;
  }
  return {
    id: `permission:${permission.id}`,
    projectId: project.id,
    kind: "permission" as const,
    title: `${project.title} needs permission`,
    detail: `Review ${permission.type.replaceAll("_", " ")} before work continues.`,
    actionLabel: "Review permission",
    recordId: permission.id,
    updatedAt: permission.updatedAt,
  } satisfies PccOverviewAttentionItem;
}

export function buildPccOverview(
  ledger: PccLedger,
  ledgerRevision: number,
  generatedAt = new Date().toISOString(),
): PccOverviewGetResult {
  const index = buildPccLedgerReadIndex(ledger);
  const systemProject = ledger.projects.find((project) => project.id === "project-command-center");
  const userProjects = ledger.projects.filter((project) => project.id !== "project-command-center");
  const activeAgents: PccOverviewAgentAssignment[] = [];
  const projects = userProjects.map((project) => {
    const summary = summarizePccProject(ledger, project, index);
    const plans = executionPlans(project).toSorted((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const plan = plans[0];
    const milestone = currentMilestone(ledger, project.id);
    const permissionNeeded = pccIndexedItems(index.permissionsByProjectId, project.id).some(
      (permission) => permission.status === "needed" || permission.status === "blocked",
    );
    if (plan) {
      const partitions = plan.partitions.filter((partition) =>
        ["pending", "assigned", "running", "failed", "blocked"].includes(partition.status),
      );
      for (const partition of partitions) {
        const assignedMilestone = partition.milestoneId
          ? ledger.milestones.find((candidate) => candidate.id === partition.milestoneId)
          : undefined;
        activeAgents.push({
          id: `${plan.id}:${partition.id}`,
          projectId: project.id,
          projectTitle: project.title,
          agentName: partition.workerId,
          task: assignedMilestone?.title ?? partition.taskId,
          status:
            partition.status === "running"
              ? "running"
              : partition.status === "failed"
                ? "failed"
                : partition.status === "blocked"
                  ? "blocked"
                  : "waiting",
          startedAt: plan.createdAt,
          lastActivityAt: plan.updatedAt,
        });
      }
      if (partitions.length === 0 && plan.status !== "paused") {
        activeAgents.push({
          id: `${plan.id}:coordinator`,
          projectId: project.id,
          projectTitle: project.title,
          agentName: plan.coordinator?.sessionId || "program-manager",
          task: milestone?.title ?? summary.nextActions[0] ?? "Coordinate project work",
          status: plan.status === "blocked" ? "blocked" : "waiting",
          startedAt: plan.createdAt,
          lastActivityAt: plan.updatedAt,
        });
      }
    }
    const blocker = milestone?.blocker || undefined;
    return {
      ...summary,
      workState: workState(project, summary, plan, permissionNeeded),
      ...(milestone?.title ? { currentMilestone: milestone.title } : {}),
      ...(summary.nextActions[0] ? { nextAction: summary.nextActions[0] } : {}),
      ...(blocker ? { blocker } : {}),
      activeAgentCount: activeAgents.filter((assignment) => assignment.projectId === project.id)
        .length,
    } satisfies PccOverviewProject;
  });

  const attention: PccOverviewAttentionItem[] = [];
  for (const project of userProjects) {
    for (const permission of pccIndexedItems(index.permissionsByProjectId, project.id)) {
      const item = permissionAttention(permission, project);
      if (item) {
        attention.push(item);
      }
    }
    const milestone = currentMilestone(ledger, project.id);
    if (milestone?.blocker && !attention.some((item) => item.projectId === project.id)) {
      attention.push({
        id: `blocker:${milestone.id}`,
        projectId: project.id,
        kind: "blocker",
        title: `${project.title} is blocked`,
        detail: milestone.blocker,
        actionLabel: "Open blocker",
        recordId: milestone.id,
        updatedAt: milestone.updatedAt,
      });
    }
  }

  const systemSummary = systemProject
    ? summarizePccProject(ledger, systemProject, index)
    : undefined;
  const systemHealthy = Boolean(
    systemSummary &&
    isPccCompleteStatus(systemSummary.status) &&
    systemSummary.proofGaps.length === 0 &&
    systemSummary.health !== "At risk",
  );
  if (!systemHealthy) {
    attention.unshift({
      id: "system:project-command-center",
      projectId: "project-command-center",
      kind: "system",
      title: "PCC system needs attention",
      detail: systemSummary?.proofGaps[0] ?? "The PCC system record is unavailable.",
      actionLabel: "Review system",
      updatedAt: systemSummary?.updatedAt ?? generatedAt,
    });
  }

  const priority = {
    needs_you: 0,
    working: 1,
    blocked: 2,
    failed: 2,
    ready: 3,
    paused: 4,
    complete: 5,
  };
  projects.sort(
    (a, b) =>
      priority[a.workState] - priority[b.workState] || b.updatedAt.localeCompare(a.updatedAt),
  );
  attention.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  activeAgents.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  const overviewByProjectId = new Map(projects.map((project) => [project.id, project]));
  const recentActivity: PccOverviewActivity[] = [];
  const addActivity = (params: {
    id: string;
    projectId: string;
    actor: string;
    action: string;
    at: unknown;
  }) => {
    const project = overviewByProjectId.get(params.projectId);
    const at = normalizePccTimestamp(params.at);
    if (!project || !at) {
      return;
    }
    recentActivity.push({
      ...params,
      at,
      projectTitle: project.title,
      progress: project.percentComplete,
    });
  };
  for (const project of userProjects) {
    const metadata = pccMetadataObject(project.metadata);
    addActivity({
      id: `activity:project:${project.id}:${project.updatedAt}`,
      projectId: project.id,
      actor: pccMetadataString(metadata.pccLastActor) ?? "PCC operator",
      action: pccMetadataString(metadata.pccLastAction) ?? "Project updated",
      at: project.updatedAt,
    });
  }
  for (const milestone of ledger.milestones) {
    const metadata = pccMetadataObject(milestone.metadata);
    addActivity({
      id: `activity:milestone:${milestone.id}:${milestone.updatedAt}`,
      projectId: milestone.projectId,
      actor: pccMetadataString(metadata.pccLastActor) ?? "PCC operator",
      action: `${pccMetadataString(metadata.pccLastAction) ?? "Milestone updated"}: ${milestone.title}`,
      at: milestone.updatedAt,
    });
  }
  for (const permission of ledger.permissions) {
    const audit = permission.auditLog.at(-1);
    addActivity({
      id: `activity:permission:${permission.id}:${permission.updatedAt}`,
      projectId: permission.projectId,
      actor: audit?.actor || "PCC operator",
      action: `Permission ${permission.status}: ${permission.type.replaceAll("_", " ")}`,
      at: permission.updatedAt,
    });
  }
  for (const decision of ledger.decisions) {
    addActivity({
      id: `activity:decision:${decision.id}`,
      projectId: decision.projectId,
      actor: decision.decidedBy || "PCC operator",
      action: `Decision recorded: ${decision.title}`,
      at: decision.decidedAt,
    });
  }
  for (const receipt of ledger.receipts) {
    addActivity({
      id: `activity:receipt:${receipt.id}`,
      projectId: receipt.projectId,
      actor: receipt.completedBy || "PCC operator",
      action: "Completion proof recorded",
      at: receipt.completedAt,
    });
  }
  for (const attachment of ledger.attachments ?? []) {
    addActivity({
      id: `activity:attachment:${attachment.id}:${attachment.updatedAt}`,
      projectId: attachment.projectId,
      actor: "PCC operator",
      action: `${attachment.status === "tombstoned" ? "File removed" : "File attached"}: ${attachment.title}`,
      at: attachment.updatedAt,
    });
  }
  for (const run of ledger.modelRunReceipts ?? []) {
    addActivity({
      id: `activity:model:${run.id}`,
      projectId: run.projectId,
      actor: run.executor === "codex" ? "Codex" : "Local AI",
      action: `${run.purpose.replaceAll("_", " ")} ${run.status}`,
      at: run.completedAt,
    });
  }
  recentActivity.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  recentActivity.splice(20);

  return {
    ledgerRevision,
    generatedAt,
    projects,
    attention,
    activeAgents,
    recentActivity,
    portfolio: summarizePccPortfolio(ledger, index),
    system: {
      status: systemProject ? (systemHealthy ? "healthy" : "attention") : "unavailable",
      label: systemHealthy ? "PCC healthy" : "PCC needs attention",
      ...(systemSummary?.proofGaps[0] || systemSummary?.health
        ? { detail: systemSummary?.proofGaps[0] ?? systemSummary?.health }
        : {}),
      projectId: "project-command-center",
    },
  };
}

import type { PccMilestone, PccProject, PccStatus, PccSubMilestone } from "../../types.ts";

const PCC_TEMP_REORDER_ORDER_BASE = 1_000_000_000;
const PCC_LEGACY_ORDER_REPAIR_BASE = 2_000_000_000;

export type PccProjectUpsertInput = Partial<PccProject> & Pick<PccProject, "title">;

export type PccMilestoneUpsertInput = Partial<PccMilestone> &
  Pick<PccMilestone, "projectId" | "title">;

export type PccSubMilestoneUpsertInput = Partial<PccSubMilestone> &
  Pick<PccSubMilestone, "projectId" | "milestoneId" | "title">;

/**
 * Gateway payload adapters are an anti-corruption boundary. They deliberately
 * omit read-only ledger fields such as createdAt and normalize legacy order
 * values before data crosses the RPC boundary.
 */
export function projectUpsertPayload(project: PccProjectUpsertInput): {
  id?: string;
  title: string;
  goal?: string;
  status?: PccStatus;
  owner?: string;
  priority?: number;
  phases?: PccProject["phases"];
  metadata?: PccProject["metadata"];
} {
  return {
    ...(project.id !== undefined ? { id: project.id } : {}),
    title: project.title,
    ...(project.goal !== undefined ? { goal: project.goal } : {}),
    ...(project.status !== undefined ? { status: project.status } : {}),
    ...(project.owner !== undefined ? { owner: project.owner } : {}),
    ...(project.priority !== undefined ? { priority: project.priority } : {}),
    ...(project.phases !== undefined ? { phases: project.phases } : {}),
    ...(project.metadata !== undefined ? { metadata: project.metadata } : {}),
  };
}

function stablePositiveHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function repairedLegacyOrder(id: string | undefined): number {
  return PCC_LEGACY_ORDER_REPAIR_BASE + (id ? stablePositiveHash(id) : 0);
}

export function pccOrderForUpsert(order: unknown, id: string | undefined): number | undefined {
  if (typeof order !== "number" || !Number.isFinite(order)) {
    return undefined;
  }
  const integerOrder = Math.trunc(order);
  return integerOrder >= 0 ? integerOrder : repairedLegacyOrder(id);
}

export function temporaryReorderOrder(index: number): number {
  return PCC_TEMP_REORDER_ORDER_BASE + index;
}

export function milestoneUpsertPayload(milestone: PccMilestoneUpsertInput): {
  id?: string;
  projectId: string;
  title: string;
  status?: PccStatus;
  phaseId?: string;
  owner?: string;
  order?: number;
  percentComplete?: number;
  dependsOn?: string[];
  requiredEvidenceIds?: string[];
  receiptIds?: string[];
  permissionGrantIds?: string[];
  blocker?: string;
  implementationPlan?: string;
  acceptanceCriteria?: string[];
  metadata?: PccMilestone["metadata"];
} {
  const order = pccOrderForUpsert(milestone.order, milestone.id);
  return {
    ...(milestone.id !== undefined ? { id: milestone.id } : {}),
    projectId: milestone.projectId,
    title: milestone.title,
    ...(milestone.status !== undefined ? { status: milestone.status } : {}),
    ...(milestone.phaseId !== undefined ? { phaseId: milestone.phaseId } : {}),
    ...(milestone.owner !== undefined ? { owner: milestone.owner } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(milestone.percentComplete !== undefined
      ? { percentComplete: milestone.percentComplete }
      : {}),
    ...(milestone.dependsOn !== undefined ? { dependsOn: milestone.dependsOn } : {}),
    ...(milestone.requiredEvidenceIds !== undefined
      ? { requiredEvidenceIds: milestone.requiredEvidenceIds }
      : {}),
    ...(milestone.receiptIds !== undefined ? { receiptIds: milestone.receiptIds } : {}),
    ...(milestone.permissionGrantIds !== undefined
      ? { permissionGrantIds: milestone.permissionGrantIds }
      : {}),
    ...(milestone.blocker !== undefined ? { blocker: milestone.blocker } : {}),
    ...(milestone.implementationPlan !== undefined
      ? { implementationPlan: milestone.implementationPlan }
      : {}),
    ...(milestone.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: milestone.acceptanceCriteria }
      : {}),
    ...(milestone.metadata !== undefined ? { metadata: milestone.metadata } : {}),
  };
}

export function subMilestoneUpsertPayload(subMilestone: PccSubMilestoneUpsertInput): {
  id?: string;
  projectId: string;
  milestoneId: string;
  title: string;
  status?: PccStatus;
  order?: number;
  owner?: string;
  percentComplete?: number;
  dependsOn?: string[];
  requiredEvidenceIds?: string[];
  receiptIds?: string[];
  permissionGrantIds?: string[];
  blocker?: string;
  implementationPlan?: string;
  acceptanceCriteria?: string[];
  metadata?: PccSubMilestone["metadata"];
} {
  const order = pccOrderForUpsert(subMilestone.order, subMilestone.id);
  return {
    ...(subMilestone.id !== undefined ? { id: subMilestone.id } : {}),
    projectId: subMilestone.projectId,
    milestoneId: subMilestone.milestoneId,
    title: subMilestone.title,
    ...(subMilestone.status !== undefined ? { status: subMilestone.status } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(subMilestone.owner !== undefined ? { owner: subMilestone.owner } : {}),
    ...(subMilestone.percentComplete !== undefined
      ? { percentComplete: subMilestone.percentComplete }
      : {}),
    ...(subMilestone.dependsOn !== undefined ? { dependsOn: subMilestone.dependsOn } : {}),
    ...(subMilestone.requiredEvidenceIds !== undefined
      ? { requiredEvidenceIds: subMilestone.requiredEvidenceIds }
      : {}),
    ...(subMilestone.receiptIds !== undefined ? { receiptIds: subMilestone.receiptIds } : {}),
    ...(subMilestone.permissionGrantIds !== undefined
      ? { permissionGrantIds: subMilestone.permissionGrantIds }
      : {}),
    ...(subMilestone.blocker !== undefined ? { blocker: subMilestone.blocker } : {}),
    ...(subMilestone.implementationPlan !== undefined
      ? { implementationPlan: subMilestone.implementationPlan }
      : {}),
    ...(subMilestone.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: subMilestone.acceptanceCriteria }
      : {}),
    ...(subMilestone.metadata !== undefined ? { metadata: subMilestone.metadata } : {}),
  };
}

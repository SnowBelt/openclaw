import type {
  PccMilestone,
  PccPortfolioSummary,
  PccProject,
  PccProjectSummary,
  PccSubMilestone,
} from "../../../packages/gateway-protocol/src/schema/types.js";
import {
  isPccBlockedStatus,
  isPccCompleteStatus,
  isPccSkippedStatus,
  isPccTerminalStatus,
  isPccWaitingStatus,
  pccMilestonePercent,
  pccSubMilestonesAreComplete,
} from "../domain/completion-policy.js";
import type { PccLedger } from "../domain/ledger.js";
import {
  pccMetadataObject,
  pccMetadataString,
  pccProjectIsStale,
  pccWorkScopeForProject,
} from "../metadata.js";
import {
  buildPccLedgerReadIndex,
  pccIndexedItems,
  type PccLedgerReadIndex,
} from "./ledger-index.js";

type ProjectStatusCounts = PccProjectSummary["milestoneCounts"];
const PCC_STALE_PROJECT_DAYS = 14;
const EMPTY_MILESTONES: readonly PccMilestone[] = [];

function hasReceipt(index: PccLedgerReadIndex, milestoneId: string): boolean {
  return pccIndexedItems(index.receiptsByMilestoneId, milestoneId).length > 0;
}

function subMilestonesForMilestone(
  index: PccLedgerReadIndex,
  milestoneId: string,
): readonly PccSubMilestone[] {
  return pccIndexedItems(index.subMilestonesByMilestoneId, milestoneId);
}

function subMilestonesCompleteForMilestone(
  index: PccLedgerReadIndex,
  milestoneId: string,
): boolean {
  return pccSubMilestonesAreComplete(subMilestonesForMilestone(index, milestoneId));
}

function milestonePercent(index: PccLedgerReadIndex, milestone: PccMilestone): number {
  return pccMilestonePercent({
    milestone,
    subMilestones: subMilestonesForMilestone(index, milestone.id),
    hasCompletionReceipt: hasReceipt(index, milestone.id),
  });
}

function summarizePhasePercent(
  index: PccLedgerReadIndex,
  phase: NonNullable<PccProject["phases"]>[number],
  phaseMilestones: readonly PccMilestone[],
): number {
  if (typeof phase.percentComplete === "number") {
    return Math.max(0, Math.min(100, Math.round(phase.percentComplete)));
  }
  if (phaseMilestones.length === 0) {
    return isPccCompleteStatus(phase.status ?? "not_started") ? 100 : 0;
  }
  return Math.round(
    phaseMilestones.reduce((total, milestone) => total + milestonePercent(index, milestone), 0) /
      phaseMilestones.length,
  );
}

function summarizeWeightedProjectPercent(
  index: PccLedgerReadIndex,
  project: PccProject,
  milestones: readonly PccMilestone[],
): number {
  const phases = project.phases?.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)) ?? [];
  const phaseIds = new Set(phases.map((phase) => phase.id));
  const milestonesByPhaseId = new Map<string, PccMilestone[]>();
  const unassignedMilestones: PccMilestone[] = [];
  for (const milestone of milestones) {
    if (milestone.phaseId && phaseIds.has(milestone.phaseId)) {
      const phaseMilestones = milestonesByPhaseId.get(milestone.phaseId);
      if (phaseMilestones) {
        phaseMilestones.push(milestone);
      } else {
        milestonesByPhaseId.set(milestone.phaseId, [milestone]);
      }
    } else {
      unassignedMilestones.push(milestone);
    }
  }
  const hasPhaseProgress = phases.some(
    (phase) =>
      typeof phase.percentComplete === "number" ||
      isPccCompleteStatus(phase.status ?? "not_started") ||
      (milestonesByPhaseId.get(phase.id)?.length ?? 0) > 0,
  );
  if (phases.length > 0 && hasPhaseProgress) {
    const totalWeight = phases.reduce((total, phase) => total + Math.max(0, phase.weight ?? 0), 0);
    const fallbackWeight = totalWeight > 0 ? 0 : 1;
    let denominator = totalWeight > 0 ? totalWeight : phases.length;
    let weighted = phases.reduce((total, phase) => {
      const weight = totalWeight > 0 ? Math.max(0, phase.weight ?? 0) : fallbackWeight;
      return (
        total +
        summarizePhasePercent(index, phase, milestonesByPhaseId.get(phase.id) ?? EMPTY_MILESTONES) *
          weight
      );
    }, 0);
    if (unassignedMilestones.length > 0) {
      const unassignedWeight =
        totalWeight > 0 ? Math.max(1, Math.round(totalWeight / phases.length)) : 1;
      const unassignedPercent = Math.round(
        unassignedMilestones.reduce(
          (total, milestone) => total + milestonePercent(index, milestone),
          0,
        ) / unassignedMilestones.length,
      );
      weighted += unassignedPercent * unassignedWeight;
      denominator += unassignedWeight;
    }
    if (denominator > 0) {
      return Math.round(weighted / denominator);
    }
  }
  if (milestones.length > 0) {
    return Math.round(
      milestones.reduce((total, milestone) => total + milestonePercent(index, milestone), 0) /
        milestones.length,
    );
  }
  return isPccCompleteStatus(project.status) ? 100 : 0;
}

function projectDueDate(project: PccProject): string | undefined {
  const metadata = project.metadata ?? {};
  return (
    pccMetadataString(metadata.dueDate) ??
    pccMetadataString(metadata.pccDueDate) ??
    pccMetadataString(metadata.targetDate)
  );
}

function timestampStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function latestProjectActivity(index: PccLedgerReadIndex, project: PccProject): string | undefined {
  let latest: { at: string; label: string; sequence: number } | undefined;
  let sequence = 0;
  const addCandidate = (at: unknown, label: string): void => {
    const timestamp = timestampStringValue(at);
    if (!timestamp) {
      return;
    }
    const candidate = { at: timestamp, label, sequence };
    sequence += 1;
    if (
      !latest ||
      candidate.at > latest.at ||
      (candidate.at === latest.at && candidate.sequence > latest.sequence)
    ) {
      latest = candidate;
    }
  };
  addCandidate(project.updatedAt, "Project updated");
  for (const milestone of pccIndexedItems(index.milestonesByProjectId, project.id)) {
    addCandidate(milestone.updatedAt, `Milestone updated: ${milestone.title}`);
  }
  for (const subMilestone of pccIndexedItems(index.subMilestonesByProjectId, project.id)) {
    addCandidate(subMilestone.updatedAt, `Sub-milestone updated: ${subMilestone.title}`);
  }
  for (const permission of pccIndexedItems(index.permissionsByProjectId, project.id)) {
    addCandidate(permission.updatedAt, `Permission ${permission.status}: ${permission.type}`);
  }
  for (const evidence of pccIndexedItems(index.evidenceByProjectId, project.id)) {
    addCandidate(evidence.createdAt, `Evidence ${evidence.status}: ${evidence.kind}`);
  }
  for (const receipt of pccIndexedItems(index.receiptsByProjectId, project.id)) {
    addCandidate(receipt.completedAt, `Receipt added: ${receipt.summary}`);
  }
  for (const decision of pccIndexedItems(index.decisionsByProjectId, project.id)) {
    addCandidate(decision.decidedAt, `Decision: ${decision.title}`);
  }
  for (const entry of pccIndexedItems(index.lastKnownGoodByProjectId, project.id)) {
    addCandidate(entry.verifiedAt, `Verified: ${entry.subsystem}`);
  }
  return latest ? `${latest.label} · ${latest.at}` : undefined;
}

function projectHealthLabel(
  project: PccProject,
  counts: ProjectStatusCounts,
  dueDate: string | undefined,
  proofGaps: readonly string[] = [],
): string {
  if (project.status === "blocked" || counts.blocked > 0) {
    return "Blocked";
  }
  if (project.status === "needs_approval" || counts.needsApproval > 0) {
    return "Needs approval";
  }
  if (dueDate && !isPccCompleteStatus(project.status) && Date.parse(dueDate) < Date.now()) {
    return "Overdue";
  }
  if (proofGaps.length > 0 && !isPccTerminalStatus(project.status)) {
    return "At risk";
  }
  if (isPccWaitingStatus(project.status)) {
    return "Waiting";
  }
  if (isPccCompleteStatus(project.status)) {
    return "Complete";
  }
  if (
    project.status === "active" ||
    project.status === "in_progress" ||
    project.status === "reopened"
  ) {
    return "On track";
  }
  return project.status.replace(/_/gu, " ");
}

function projectSummaryIsOverdue(project: PccProjectSummary): boolean {
  if (isPccTerminalStatus(project.status) || !project.dueDate) {
    return false;
  }
  const parsed = Date.parse(project.dueDate);
  return Number.isFinite(parsed) && parsed < Date.now();
}

function projectSummaryIsStale(project: PccProjectSummary): boolean {
  return pccProjectIsStale(project.status, project.updatedAt, Date.now(), PCC_STALE_PROJECT_DAYS);
}

function projectSummaryNeedsAttention(project: PccProjectSummary): boolean {
  if (["archived", "skipped", "on_hold", "deferred"].includes(project.status)) {
    return false;
  }
  return (
    project.status === "needs_approval" ||
    project.status === "blocked" ||
    project.milestoneCounts.needsApproval > 0 ||
    project.milestoneCounts.blocked > 0 ||
    project.proofGaps.length > 0 ||
    projectSummaryIsOverdue(project) ||
    projectSummaryIsStale(project) ||
    project.health === "Overdue" ||
    project.health === "At risk"
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizedIntegrityKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function duplicateIntegrityKeys<T>(items: readonly T[], keyFor: (item: T) => string): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function projectIntegrityGaps(index: PccLedgerReadIndex, project: PccProject): string[] {
  const gaps: string[] = [];
  const projectMilestones = pccIndexedItems(index.milestonesByProjectId, project.id);
  const projectSubMilestones = pccIndexedItems(index.subMilestonesByProjectId, project.id);
  const projectMilestoneIds = new Set(projectMilestones.map((milestone) => milestone.id));
  const projectSubMilestoneIds = new Set(
    projectSubMilestones.map((subMilestone) => subMilestone.id),
  );

  for (const milestone of projectMilestones) {
    for (const dependencyId of milestone.dependsOn ?? []) {
      if (!projectMilestoneIds.has(dependencyId)) {
        gaps.push(
          `Integrity issue: milestone dependency is missing: ${milestone.title} -> ${dependencyId}`,
        );
      }
    }
  }

  for (const title of duplicateIntegrityKeys(projectMilestones, (milestone) =>
    normalizedIntegrityKey(milestone.title),
  )) {
    gaps.push(`Integrity issue: duplicate milestone title: ${title}`);
  }

  for (const order of duplicateIntegrityKeys(projectMilestones, (milestone) =>
    milestone.order === undefined ? "" : String(milestone.order),
  )) {
    gaps.push(`Integrity issue: duplicate milestone order: ${order}`);
  }

  for (const subMilestone of pccIndexedItems(
    index.mismatchedSubMilestonesByParentProjectId,
    project.id,
  )) {
    gaps.push(
      `Integrity issue: sub-milestone has mismatched project reference: ${subMilestone.title}`,
    );
  }

  for (const subMilestone of projectSubMilestones) {
    if (!projectMilestoneIds.has(subMilestone.milestoneId)) {
      gaps.push(
        `Integrity issue: sub-milestone has missing parent milestone: ${subMilestone.title}`,
      );
    }
    for (const dependencyId of subMilestone.dependsOn ?? []) {
      if (!projectMilestoneIds.has(dependencyId) && !projectSubMilestoneIds.has(dependencyId)) {
        gaps.push(
          `Integrity issue: sub-milestone dependency is missing: ${subMilestone.title} -> ${dependencyId}`,
        );
      }
    }
  }

  const childGroups = new Map<string, PccSubMilestone[]>();
  for (const subMilestone of projectSubMilestones) {
    childGroups.set(subMilestone.milestoneId, [
      ...(childGroups.get(subMilestone.milestoneId) ?? []),
      subMilestone,
    ]);
  }
  for (const [milestoneId, children] of childGroups) {
    for (const title of duplicateIntegrityKeys(children, (subMilestone) =>
      normalizedIntegrityKey(subMilestone.title),
    )) {
      const parent = projectMilestones.find((milestone) => milestone.id === milestoneId);
      gaps.push(
        `Integrity issue: duplicate sub-milestone title under ${parent?.title ?? milestoneId}: ${title}`,
      );
    }
    for (const order of duplicateIntegrityKeys(children, (subMilestone) =>
      subMilestone.order === undefined ? "" : String(subMilestone.order),
    )) {
      const parent = projectMilestones.find((milestone) => milestone.id === milestoneId);
      gaps.push(
        `Integrity issue: duplicate sub-milestone order under ${parent?.title ?? milestoneId}: ${order}`,
      );
    }
  }
  for (const permission of pccIndexedItems(index.permissionsByProjectId, project.id)) {
    if (permission.milestoneId && !projectMilestoneIds.has(permission.milestoneId)) {
      gaps.push(`Integrity issue: permission references missing milestone: ${permission.id}`);
    }
  }
  for (const evidence of pccIndexedItems(index.evidenceByProjectId, project.id)) {
    if (evidence.milestoneId && !projectMilestoneIds.has(evidence.milestoneId)) {
      gaps.push(`Integrity issue: evidence references missing milestone: ${evidence.id}`);
    }
  }
  for (const receipt of pccIndexedItems(index.receiptsByProjectId, project.id)) {
    if (!projectMilestoneIds.has(receipt.milestoneId)) {
      gaps.push(`Integrity issue: receipt references missing milestone: ${receipt.id}`);
    }
    if (receipt.proofEvidenceIds !== undefined && !Array.isArray(receipt.proofEvidenceIds)) {
      gaps.push(`Integrity issue: receipt has malformed proof evidence ids: ${receipt.id}`);
    }
    const proofEvidenceIds = stringArray(receipt.proofEvidenceIds);
    if (proofEvidenceIds.length === 0) {
      gaps.push(`Integrity issue: receipt has no proof evidence ids: ${receipt.id}`);
    }
    for (const evidenceId of proofEvidenceIds) {
      const evidence = index.evidenceById.get(evidenceId);
      if (!evidence || evidence.projectId !== project.id) {
        gaps.push(`Integrity issue: receipt references missing proof evidence: ${evidenceId}`);
      } else if (evidence.status !== "passed") {
        gaps.push(`Integrity issue: receipt references non-passing proof evidence: ${evidenceId}`);
      }
    }
  }
  for (const decision of pccIndexedItems(index.decisionsByProjectId, project.id)) {
    if (decision.milestoneId && !projectMilestoneIds.has(decision.milestoneId)) {
      gaps.push(`Integrity issue: decision references missing milestone: ${decision.id}`);
    }
    if (decision.subMilestoneId && !projectSubMilestoneIds.has(decision.subMilestoneId)) {
      gaps.push(`Integrity issue: decision references missing sub-milestone: ${decision.id}`);
    }
    if (decision.evidenceIds !== undefined && !Array.isArray(decision.evidenceIds)) {
      gaps.push(`Integrity issue: decision has malformed evidence ids: ${decision.id}`);
    }
    for (const evidenceId of stringArray(decision.evidenceIds)) {
      const evidence = index.evidenceById.get(evidenceId);
      if (!evidence || evidence.projectId !== project.id) {
        gaps.push(`Integrity issue: decision references missing evidence: ${evidenceId}`);
      }
    }
  }
  for (const entry of pccIndexedItems(index.lastKnownGoodByProjectId, project.id)) {
    if (entry.evidenceIds !== undefined && !Array.isArray(entry.evidenceIds)) {
      gaps.push(`Integrity issue: last-known-good has malformed evidence ids: ${entry.id}`);
    }
    for (const evidenceId of stringArray(entry.evidenceIds)) {
      const evidence = index.evidenceById.get(evidenceId);
      if (!evidence || evidence.projectId !== project.id) {
        gaps.push(`Integrity issue: last-known-good references missing evidence: ${evidenceId}`);
      } else if (evidence.status !== "passed") {
        gaps.push(
          `Integrity issue: last-known-good references non-passing evidence: ${evidenceId}`,
        );
      }
    }
  }
  return [...new Set(gaps)];
}

export function summarizePccProject(
  ledger: PccLedger,
  project: PccProject,
  index = buildPccLedgerReadIndex(ledger),
): PccProjectSummary {
  const milestones = pccIndexedItems(index.milestonesByProjectId, project.id);
  const percentComplete = summarizeWeightedProjectPercent(index, project, milestones);
  const metadata = pccMetadataObject(project.metadata);
  const counts: ProjectStatusCounts = {
    total: milestones.length,
    complete: 0,
    blocked: 0,
    needsApproval: 0,
    deferred: 0,
    skipped: 0,
  };
  for (const milestone of milestones) {
    if (isPccCompleteStatus(milestone.status)) {
      counts.complete += 1;
    }
    if (isPccBlockedStatus(milestone.status)) {
      counts.blocked += 1;
    }
    if (milestone.status === "needs_approval") {
      counts.needsApproval += 1;
    }
    if (isPccWaitingStatus(milestone.status)) {
      counts.deferred += 1;
    }
    if (isPccSkippedStatus(milestone.status)) {
      counts.skipped += 1;
    }
  }
  const nextActions = milestones
    .filter(
      (milestone) =>
        !isPccCompleteStatus(milestone.status) && !isPccSkippedStatus(milestone.status),
    )
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, 10)
    .map((milestone) => `${milestone.title}: ${milestone.blocker || milestone.status}`);
  const proofGaps = [
    ...projectIntegrityGaps(index, project),
    ...milestones.flatMap((milestone) => {
      const gaps: string[] = [];
      if (isPccCompleteStatus(milestone.status) && !hasReceipt(index, milestone.id)) {
        gaps.push(`Completion receipt missing for ${milestone.title}`);
      }
      if (
        isPccCompleteStatus(milestone.status) &&
        !subMilestonesCompleteForMilestone(index, milestone.id)
      ) {
        gaps.push(`Incomplete sub-milestones remain for ${milestone.title}`);
      }
      return gaps;
    }),
  ].slice(0, 20);
  const dueDate = projectDueDate(project);
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    percentComplete,
    milestoneCounts: counts,
    nextActions,
    proofGaps,
    health: projectHealthLabel(project, counts, dueDate, proofGaps),
    ...(dueDate ? { dueDate } : {}),
    ...(metadata.excludedFromPccProductCompletion === true
      ? { excludedFromPccProductCompletion: true }
      : {}),
    pccWorkScope: pccWorkScopeForProject({ ...project, metadata }),
    ...(pccMetadataString(metadata.pccCurrentScope)
      ? { pccCurrentScope: pccMetadataString(metadata.pccCurrentScope) }
      : {}),
    ...(pccMetadataString(metadata.pccProductScope)
      ? { pccProductScope: pccMetadataString(metadata.pccProductScope) }
      : {}),
    ...(pccMetadataString(metadata.pccWorkflowTemplateId)
      ? { workflowTemplateId: pccMetadataString(metadata.pccWorkflowTemplateId) }
      : {}),
    recentActivity: latestProjectActivity(index, project),
    updatedAt: project.updatedAt,
  };
}

export function summarizePccPortfolio(
  ledger: PccLedger,
  index = buildPccLedgerReadIndex(ledger),
): PccPortfolioSummary {
  const projectSummaries = ledger.projects.map((project) =>
    summarizePccProject(ledger, project, index),
  );
  let active = 0;
  let blocked = 0;
  let needsApproval = 0;
  let needsAttention = 0;
  let proofGaps = 0;
  let overdue = 0;
  let stale = 0;
  let complete = 0;
  let archived = 0;
  let totalPercentComplete = 0;
  const nextActions: string[] = [];
  for (let projectIndex = 0; projectIndex < ledger.projects.length; projectIndex += 1) {
    const project = ledger.projects[projectIndex];
    const summary = projectSummaries[projectIndex];
    if (!project || !summary) {
      continue;
    }
    totalPercentComplete += summary.percentComplete;
    if (["active", "in_progress", "reopened"].includes(project.status)) {
      active += 1;
    }
    if (isPccBlockedStatus(project.status)) {
      blocked += 1;
    }
    if (project.status === "needs_approval") {
      needsApproval += 1;
    }
    if (projectSummaryNeedsAttention(summary)) {
      needsAttention += 1;
    }
    if (summary.proofGaps.length > 0) {
      proofGaps += 1;
    }
    if (projectSummaryIsOverdue(summary)) {
      overdue += 1;
    }
    if (projectSummaryIsStale(summary)) {
      stale += 1;
    }
    if (isPccCompleteStatus(project.status)) {
      complete += 1;
    }
    if (project.status === "archived") {
      archived += 1;
    }
    for (const action of summary.nextActions) {
      if (nextActions.length >= 20) {
        break;
      }
      nextActions.push(action);
    }
  }
  const averagePercentComplete = projectSummaries.length
    ? Math.round(totalPercentComplete / projectSummaries.length)
    : 0;
  return {
    projectsTotal: ledger.projects.length,
    active,
    blocked,
    needsApproval,
    needsAttention,
    proofGaps,
    overdue,
    stale,
    complete,
    archived,
    averagePercentComplete,
    nextActions,
  };
}

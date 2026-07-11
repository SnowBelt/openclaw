// Project Command Center gateway methods persist project/milestone plans and proof receipts.
import { randomUUID } from "node:crypto";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type PccCompletionReceipt,
  type PccDecision,
  type PccEvidence,
  type PccLastKnownGood,
  type PccMilestone,
  type PccSubMilestone,
  type PccPermissionGrant,
  type PccPortfolioSummary,
  type PccProject,
  type PccProjectSummary,
  type PccStatus,
  validatePccDecisionsAddParams,
  validatePccEvidenceAddParams,
  validatePccLastKnownGoodUpsertParams,
  validatePccMilestonesUpsertParams,
  validatePccSubMilestonesListParams,
  validatePccSubMilestonesUpsertParams,
  validatePccPermissionsUpsertParams,
  validatePccProjectsGetParams,
  validatePccProjectsListParams,
  validatePccProjectsUpsertParams,
  validatePccReceiptsAddParams,
  validatePccSummaryGetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import {
  closePccLedgerStorageForTest,
  pccLedgerJsonPath as ledgerPath,
  pccLedgerSqlitePath,
  readPccLedger as readLedger,
  replacePccLedgerForTest,
  type PccLedger,
  withPccLedger as withLedger,
} from "../../pcc/ledger-store.js";
import {
  canonicalizePccProjectForWrite,
  canonicalizePccWorkItemForWrite,
  pccProjectIsStale,
  pccWorkScopeForProject,
  repairPccCanonicalWorkItems,
} from "../../pcc/metadata.js";
import { readPccRuntimeIdentity, type PccRuntimeIdentity } from "../../pcc/runtime-identity.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

type ProjectStatusCounts = PccProjectSummary["milestoneCounts"];
const COMPLETE_STATUSES = new Set<PccStatus>(["complete", "complete_with_maintenance"]);
const BLOCKED_STATUSES = new Set<PccStatus>(["blocked", "failed"]);
const WAITING_STATUSES = new Set<PccStatus>(["needs_approval", "deferred", "on_hold"]);
const SKIPPED_STATUSES = new Set<PccStatus>(["skipped", "archived"]);
const PROJECT_TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);
const PCC_STALE_PROJECT_DAYS = 14;
const REOPEN_STATUSES = new Set<PccStatus>(["reopened", "not_started"]);
const ACTIVE_WORK_STATUSES = new Set<PccStatus>([
  "active",
  "in_progress",
  "proof_pending",
  "local_proof_complete",
  "remote_proof_complete",
  "runtime_proof_complete",
  "persistence_proof_complete",
]);
const PCC_PROOF_LEVELS = new Set([
  "none",
  "planned",
  "local",
  "remote",
  "runtime",
  "persistence",
  "production",
]);
const SHA_BOUND_PROOF_EVIDENCE_KINDS = new Set<PccEvidence["kind"]>([
  "remote_ci",
  "runtime_status",
  "browser_proof",
  "screenshot",
]);
const ACTIVE_RUNTIME_PROOF_EVIDENCE_KINDS = new Set<PccEvidence["kind"]>([
  "runtime_status",
  "browser_proof",
  "screenshot",
]);
const DEFAULT_PCC_PHASES: PccProject["phases"] = [
  { id: "setup", title: "Setup", status: "not_started", weight: 10, order: 0 },
  { id: "tools-skills", title: "Tools/Skills", status: "not_started", weight: 15, order: 1 },
  { id: "mvp", title: "MVP", status: "not_started", weight: 25, order: 2 },
  { id: "refinement", title: "Refinement", status: "not_started", weight: 20, order: 3 },
  {
    id: "production-proof",
    title: "Production Proof",
    status: "not_started",
    weight: 25,
    order: 4,
  },
  { id: "maintenance", title: "Maintenance", status: "not_started", weight: 5, order: 5 },
];

const PARTIAL_STATUS_PERCENT: Partial<Record<PccStatus, number>> = {
  active: 20,
  in_progress: 40,
  proof_pending: 60,
  local_proof_complete: 70,
  remote_proof_complete: 85,
  runtime_proof_complete: 95,
  persistence_proof_complete: 98,
  reopened: 25,
};

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "item";
}

function makeId(prefix: string, label?: string): string {
  const suffix = label ? `${slugify(label)}-` : "";
  return `${prefix}-${suffix}${randomUUID().slice(0, 12)}`;
}

function hasReceipt(ledger: PccLedger, milestoneId: string): boolean {
  return ledger.receipts.some((receipt) => receipt.milestoneId === milestoneId);
}

function evidenceIsPassed(ledger: PccLedger, evidenceId: string): boolean {
  return ledger.evidence.some(
    (evidence) => evidence.id === evidenceId && evidence.status === "passed",
  );
}

function subMilestonesForMilestone(ledger: PccLedger, milestoneId: string): PccSubMilestone[] {
  return ledger.subMilestones.filter((subMilestone) => subMilestone.milestoneId === milestoneId);
}

function subMilestonePercent(subMilestone: PccSubMilestone): number {
  if (SKIPPED_STATUSES.has(subMilestone.status)) {
    return 0;
  }
  if (COMPLETE_STATUSES.has(subMilestone.status)) {
    return 100;
  }
  if (typeof subMilestone.percentComplete === "number") {
    return Math.max(0, Math.min(99, subMilestone.percentComplete));
  }
  return PARTIAL_STATUS_PERCENT[subMilestone.status] ?? 0;
}

function subMilestonesCompleteForMilestone(ledger: PccLedger, milestoneId: string): boolean {
  const items = subMilestonesForMilestone(ledger, milestoneId).filter(
    (subMilestone) => !SKIPPED_STATUSES.has(subMilestone.status),
  );
  return items.every((subMilestone) => COMPLETE_STATUSES.has(subMilestone.status));
}

function milestonePercent(ledger: PccLedger, milestone: PccMilestone): number {
  if (SKIPPED_STATUSES.has(milestone.status)) {
    return 0;
  }
  if (COMPLETE_STATUSES.has(milestone.status) && hasReceipt(ledger, milestone.id)) {
    return 100;
  }
  const subMilestones = subMilestonesForMilestone(ledger, milestone.id);
  if (subMilestones.length > 0) {
    return Math.round(
      subMilestones.reduce((total, subMilestone) => total + subMilestonePercent(subMilestone), 0) /
        subMilestones.length,
    );
  }
  if (typeof milestone.percentComplete === "number") {
    return Math.max(0, Math.min(99, milestone.percentComplete));
  }
  return PARTIAL_STATUS_PERCENT[milestone.status] ?? 0;
}

function summarizePhasePercent(
  ledger: PccLedger,
  phase: NonNullable<PccProject["phases"]>[number],
  milestones: PccMilestone[],
): number {
  if (typeof phase.percentComplete === "number") {
    return Math.max(0, Math.min(100, Math.round(phase.percentComplete)));
  }
  const phaseMilestones = milestones.filter((milestone) => milestone.phaseId === phase.id);
  if (phaseMilestones.length === 0) {
    return COMPLETE_STATUSES.has(phase.status ?? "not_started") ? 100 : 0;
  }
  return Math.round(
    phaseMilestones.reduce((total, milestone) => total + milestonePercent(ledger, milestone), 0) /
      phaseMilestones.length,
  );
}

function summarizeWeightedProjectPercent(
  ledger: PccLedger,
  project: PccProject,
  milestones: PccMilestone[],
): number {
  const phases = project.phases?.toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)) ?? [];
  const phaseIds = new Set(phases.map((phase) => phase.id));
  const hasPhaseProgress = phases.some(
    (phase) =>
      typeof phase.percentComplete === "number" ||
      COMPLETE_STATUSES.has(phase.status ?? "not_started") ||
      milestones.some((milestone) => milestone.phaseId === phase.id),
  );
  if (phases.length > 0 && hasPhaseProgress) {
    const totalWeight = phases.reduce((total, phase) => total + Math.max(0, phase.weight ?? 0), 0);
    const fallbackWeight = totalWeight > 0 ? 0 : 1;
    let denominator = totalWeight > 0 ? totalWeight : phases.length;
    let weighted = phases.reduce((total, phase) => {
      const weight = totalWeight > 0 ? Math.max(0, phase.weight ?? 0) : fallbackWeight;
      return total + summarizePhasePercent(ledger, phase, milestones) * weight;
    }, 0);
    const unassignedMilestones = milestones.filter(
      (milestone) => !milestone.phaseId || !phaseIds.has(milestone.phaseId),
    );
    if (unassignedMilestones.length > 0) {
      const unassignedWeight =
        totalWeight > 0 ? Math.max(1, Math.round(totalWeight / phases.length)) : 1;
      const unassignedPercent = Math.round(
        unassignedMilestones.reduce(
          (total, milestone) => total + milestonePercent(ledger, milestone),
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
      milestones.reduce((total, milestone) => total + milestonePercent(ledger, milestone), 0) /
        milestones.length,
    );
  }
  return COMPLETE_STATUSES.has(project.status) ? 100 : 0;
}

function metadataStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataObjectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function proofShaForEvidence(
  input: { kind: PccEvidence["kind"]; status?: PccEvidence["status"]; sha?: string },
  runtimeIdentity: PccRuntimeIdentity,
): { sha?: string; error?: string } {
  const requestedSha = metadataStringValue(input.sha);
  const status = input.status ?? "unknown";
  if (status !== "passed" || !SHA_BOUND_PROOF_EVIDENCE_KINDS.has(input.kind)) {
    return requestedSha ? { sha: requestedSha } : {};
  }
  if (requestedSha) {
    return { sha: requestedSha };
  }
  if (
    ACTIVE_RUNTIME_PROOF_EVIDENCE_KINDS.has(input.kind) &&
    runtimeIdentity.verified &&
    runtimeIdentity.runtimeSha
  ) {
    return { sha: runtimeIdentity.runtimeSha };
  }
  return {
    error:
      input.kind === "remote_ci"
        ? "passed remote CI evidence requires the exact source SHA it verified"
        : "passed runtime/browser evidence requires a verified active runtime SHA",
  };
}

function evidenceMetadataWithRuntimeIdentity(
  metadata: Record<string, unknown> | undefined,
  runtimeIdentity: PccRuntimeIdentity,
): Record<string, unknown> | undefined {
  if (!runtimeIdentity.verified || !runtimeIdentity.runtimeSha) {
    return metadata;
  }
  return {
    ...metadata,
    pccRuntimeIdentity: {
      runtimeSha: runtimeIdentity.runtimeSha,
      runtimeRoot: runtimeIdentity.expectedRuntimeRoot,
      runtimeEntrypoint: runtimeIdentity.runtimeEntrypoint,
      manifestPath: runtimeIdentity.manifestPath,
      manifestSha256: runtimeIdentity.manifestSha256,
      buildId: runtimeIdentity.buildId,
      identitySource: runtimeIdentity.identitySource,
    },
  };
}

function bindPccProductionProofMetadata(
  project: PccProject,
  evidence: PccEvidence,
  runtimeIdentity: PccRuntimeIdentity,
): PccProject {
  if (
    pccWorkScopeForProject(project) !== "pcc_product" ||
    evidence.status !== "passed" ||
    !evidence.sha
  ) {
    return project;
  }
  const metadata = metadataObjectValue(project.metadata);
  const truth = metadataObjectValue(metadata.pccProductionTruth);
  const isRuntimeProof = ACTIVE_RUNTIME_PROOF_EVIDENCE_KINDS.has(evidence.kind);
  const isBrowserProof = evidence.kind === "browser_proof" || evidence.kind === "screenshot";
  const nextTruth = {
    ...truth,
    ...(evidence.kind === "remote_ci"
      ? {
          latestVerifiedSha: evidence.sha,
          remoteProofSha: evidence.sha,
          remoteProofPassed: true,
        }
      : {}),
    ...(isRuntimeProof
      ? {
          runtimeProofSha: evidence.sha,
          runtimeProofPassed: true,
          ...(runtimeIdentity.verified && runtimeIdentity.runtimeSha === evidence.sha
            ? {
                runtimeSha: runtimeIdentity.runtimeSha,
                runtimeEntrypoint: runtimeIdentity.runtimeEntrypoint,
                expectedRuntimeRoot: runtimeIdentity.expectedRuntimeRoot,
              }
            : {}),
        }
      : {}),
    ...(isBrowserProof
      ? {
          browserProofSha: evidence.sha,
          ...(evidence.path ? { browserProofScreenshotPath: evidence.path } : {}),
        }
      : {}),
    updatedAt: nowIso(),
  };
  return {
    ...project,
    updatedAt: nowIso(),
    metadata: { ...metadata, pccProductionTruth: nextTruth },
  };
}

function normalizedReceiptProofLevel(value: unknown): PccCompletionReceipt["proofLevel"] {
  return typeof value === "string" && PCC_PROOF_LEVELS.has(value)
    ? (value as PccCompletionReceipt["proofLevel"])
    : "local";
}

function projectDueDate(project: PccProject): string | undefined {
  const metadata = project.metadata ?? {};
  return (
    metadataStringValue(metadata.dueDate) ??
    metadataStringValue(metadata.pccDueDate) ??
    metadataStringValue(metadata.targetDate)
  );
}

function timestampStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function addActivityCandidate(
  candidates: Array<{ at: string; label: string; sequence: number }>,
  at: unknown,
  label: string,
): void {
  const timestamp = timestampStringValue(at);
  if (timestamp) {
    candidates.push({ at: timestamp, label, sequence: candidates.length });
  }
}

function latestProjectActivity(ledger: PccLedger, project: PccProject): string | undefined {
  const candidates: Array<{ at: string; label: string; sequence: number }> = [];
  addActivityCandidate(candidates, project.updatedAt, "Project updated");
  for (const milestone of ledger.milestones.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(candidates, milestone.updatedAt, `Milestone updated: ${milestone.title}`);
  }
  for (const subMilestone of ledger.subMilestones.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(
      candidates,
      subMilestone.updatedAt,
      `Sub-milestone updated: ${subMilestone.title}`,
    );
  }
  for (const permission of ledger.permissions.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(
      candidates,
      permission.updatedAt,
      `Permission ${permission.status}: ${permission.type}`,
    );
  }
  for (const evidence of ledger.evidence.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(
      candidates,
      evidence.createdAt,
      `Evidence ${evidence.status}: ${evidence.kind}`,
    );
  }
  for (const receipt of ledger.receipts.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(candidates, receipt.completedAt, `Receipt added: ${receipt.summary}`);
  }
  for (const decision of ledger.decisions.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(candidates, decision.decidedAt, `Decision: ${decision.title}`);
  }
  for (const entry of ledger.lastKnownGood.filter((item) => item.projectId === project.id)) {
    addActivityCandidate(candidates, entry.verifiedAt, `Verified: ${entry.subsystem}`);
  }
  const latest = candidates.toSorted(
    (a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence,
  )[0];
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
  if (dueDate && !COMPLETE_STATUSES.has(project.status) && Date.parse(dueDate) < Date.now()) {
    return "Overdue";
  }
  if (proofGaps.length > 0 && !PROJECT_TERMINAL_STATUSES.has(project.status)) {
    return "At risk";
  }
  if (WAITING_STATUSES.has(project.status)) {
    return "Waiting";
  }
  if (COMPLETE_STATUSES.has(project.status)) {
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
  if (PROJECT_TERMINAL_STATUSES.has(project.status) || !project.dueDate) {
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

function projectIntegrityGaps(ledger: PccLedger, project: PccProject): string[] {
  const gaps: string[] = [];
  const projectMilestones = ledger.milestones.filter(
    (milestone) => milestone.projectId === project.id,
  );
  const projectSubMilestones = ledger.subMilestones.filter(
    (subMilestone) => subMilestone.projectId === project.id,
  );
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

  for (const subMilestone of ledger.subMilestones.filter(
    (item) => item.projectId !== project.id && projectMilestoneIds.has(item.milestoneId),
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
  for (const permission of ledger.permissions.filter((item) => item.projectId === project.id)) {
    if (permission.milestoneId && !projectMilestoneIds.has(permission.milestoneId)) {
      gaps.push(`Integrity issue: permission references missing milestone: ${permission.id}`);
    }
  }
  for (const evidence of ledger.evidence.filter((item) => item.projectId === project.id)) {
    if (evidence.milestoneId && !projectMilestoneIds.has(evidence.milestoneId)) {
      gaps.push(`Integrity issue: evidence references missing milestone: ${evidence.id}`);
    }
  }
  for (const receipt of ledger.receipts.filter((item) => item.projectId === project.id)) {
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
      const evidence = ledger.evidence.find((item) => item.id === evidenceId);
      if (!evidence || evidence.projectId !== project.id) {
        gaps.push(`Integrity issue: receipt references missing proof evidence: ${evidenceId}`);
      } else if (evidence.status !== "passed") {
        gaps.push(`Integrity issue: receipt references non-passing proof evidence: ${evidenceId}`);
      }
    }
  }
  for (const decision of ledger.decisions.filter((item) => item.projectId === project.id)) {
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
      const evidence = ledger.evidence.find((item) => item.id === evidenceId);
      if (!evidence || evidence.projectId !== project.id) {
        gaps.push(`Integrity issue: decision references missing evidence: ${evidenceId}`);
      }
    }
  }
  for (const entry of ledger.lastKnownGood.filter((item) => item.projectId === project.id)) {
    if (entry.evidenceIds !== undefined && !Array.isArray(entry.evidenceIds)) {
      gaps.push(`Integrity issue: last-known-good has malformed evidence ids: ${entry.id}`);
    }
    for (const evidenceId of stringArray(entry.evidenceIds)) {
      const evidence = ledger.evidence.find((item) => item.id === evidenceId);
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

function summarizeProject(ledger: PccLedger, project: PccProject): PccProjectSummary {
  const milestones = ledger.milestones.filter((milestone) => milestone.projectId === project.id);
  const percentComplete = summarizeWeightedProjectPercent(ledger, project, milestones);
  const metadata = metadataObjectValue(project.metadata);
  const counts: ProjectStatusCounts = {
    total: milestones.length,
    complete: milestones.filter((milestone) => COMPLETE_STATUSES.has(milestone.status)).length,
    blocked: milestones.filter((milestone) => BLOCKED_STATUSES.has(milestone.status)).length,
    needsApproval: milestones.filter((milestone) => milestone.status === "needs_approval").length,
    deferred: milestones.filter((milestone) => WAITING_STATUSES.has(milestone.status)).length,
    skipped: milestones.filter((milestone) => SKIPPED_STATUSES.has(milestone.status)).length,
  };
  const nextActions = milestones
    .filter(
      (milestone) =>
        !COMPLETE_STATUSES.has(milestone.status) && !SKIPPED_STATUSES.has(milestone.status),
    )
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, 10)
    .map((milestone) => `${milestone.title}: ${milestone.blocker || milestone.status}`);
  const proofGaps = [
    ...projectIntegrityGaps(ledger, project),
    ...milestones.flatMap((milestone) => {
      const gaps: string[] = [];
      if (COMPLETE_STATUSES.has(milestone.status) && !hasReceipt(ledger, milestone.id)) {
        gaps.push(`Completion receipt missing for ${milestone.title}`);
      }
      if (
        COMPLETE_STATUSES.has(milestone.status) &&
        !subMilestonesCompleteForMilestone(ledger, milestone.id)
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
    ...(metadataStringValue(metadata.pccCurrentScope)
      ? { pccCurrentScope: metadataStringValue(metadata.pccCurrentScope) }
      : {}),
    ...(metadataStringValue(metadata.pccProductScope)
      ? { pccProductScope: metadataStringValue(metadata.pccProductScope) }
      : {}),
    ...(metadataStringValue(metadata.pccWorkflowTemplateId)
      ? { workflowTemplateId: metadataStringValue(metadata.pccWorkflowTemplateId) }
      : {}),
    recentActivity: latestProjectActivity(ledger, project),
    updatedAt: project.updatedAt,
  };
}

function summarizePortfolio(ledger: PccLedger): PccPortfolioSummary {
  const projectSummaries = ledger.projects.map((project) => summarizeProject(ledger, project));
  const averagePercentComplete = projectSummaries.length
    ? Math.round(
        projectSummaries.reduce((total, project) => total + project.percentComplete, 0) /
          projectSummaries.length,
      )
    : 0;
  return {
    projectsTotal: ledger.projects.length,
    active: ledger.projects.filter((project) =>
      ["active", "in_progress", "reopened"].includes(project.status),
    ).length,
    blocked: ledger.projects.filter((project) => BLOCKED_STATUSES.has(project.status)).length,
    needsApproval: ledger.projects.filter((project) => project.status === "needs_approval").length,
    needsAttention: projectSummaries.filter(projectSummaryNeedsAttention).length,
    proofGaps: projectSummaries.filter((project) => project.proofGaps.length > 0).length,
    overdue: projectSummaries.filter(projectSummaryIsOverdue).length,
    stale: projectSummaries.filter(projectSummaryIsStale).length,
    complete: ledger.projects.filter((project) => COMPLETE_STATUSES.has(project.status)).length,
    archived: ledger.projects.filter((project) => project.status === "archived").length,
    averagePercentComplete,
    nextActions: projectSummaries.flatMap((project) => project.nextActions).slice(0, 20),
  };
}

function projectOrError(ledger: PccLedger, projectId: string): PccProject | null {
  return ledger.projects.find((project) => project.id === projectId) ?? null;
}

function milestoneOrError(ledger: PccLedger, milestoneId: string): PccMilestone | null {
  return ledger.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
}

function subMilestoneOrError(ledger: PccLedger, subMilestoneId: string): PccSubMilestone | null {
  return ledger.subMilestones.find((subMilestone) => subMilestone.id === subMilestoneId) ?? null;
}

function validateMilestoneBelongsToProject(
  ledger: PccLedger,
  milestoneId: string | undefined,
  projectId: string,
): string | null {
  if (!milestoneId) {
    return null;
  }
  const milestone = milestoneOrError(ledger, milestoneId);
  if (!milestone || milestone.projectId !== projectId) {
    return `milestone not found in project: ${milestoneId}`;
  }
  return null;
}

function setAt<T extends { id: string }>(items: T[], item: T): T {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    items.push(item);
  } else {
    items[index] = item;
  }
  return item;
}

function respondInvalid(respond: RespondFn, method: string, errors: unknown): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors as never)}`,
    ),
  );
}

function respondNotFound(respond: RespondFn, label: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `${label} not found`));
}

function respondUnhandled(respond: RespondFn, error: unknown): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error), {
      retryable: true,
    }),
  );
}

function upsertProject(
  ledger: PccLedger,
  input: {
    id?: string;
    title: string;
    goal?: string;
    status?: PccStatus;
    owner?: string;
    priority?: number;
    phases?: PccProject["phases"];
    metadata?: PccProject["metadata"];
  },
): { project?: PccProject; error?: string } {
  const existing = input.id ? projectOrError(ledger, input.id) : null;
  const timestamp = nowIso();
  const status = input.status ?? existing?.status ?? "active";
  const transitionError = validateStatusTransition("project", existing?.status, status);
  if (transitionError) {
    return { error: transitionError };
  }
  const project: PccProject = canonicalizePccProjectForWrite(
    {
      id: existing?.id ?? input.id ?? makeId("project", input.title),
      title: input.title,
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(input.goal !== undefined
        ? { goal: input.goal }
        : existing?.goal !== undefined
          ? { goal: existing.goal }
          : {}),
      ...(input.owner !== undefined
        ? { owner: input.owner }
        : existing?.owner !== undefined
          ? { owner: existing.owner }
          : {}),
      ...(input.priority !== undefined
        ? { priority: input.priority }
        : existing?.priority !== undefined
          ? { priority: existing.priority }
          : {}),
      ...(input.phases !== undefined
        ? { phases: input.phases }
        : existing?.phases !== undefined
          ? { phases: existing.phases }
          : !existing
            ? { phases: DEFAULT_PCC_PHASES }
            : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata }
        : existing?.metadata !== undefined
          ? { metadata: existing.metadata }
          : {}),
    },
    timestamp,
  );
  return { project: setAt(ledger.projects, project) };
}

function validateStatusTransition(
  label: string,
  currentStatus: PccStatus | undefined,
  nextStatus: PccStatus,
): string | null {
  if (!currentStatus || currentStatus === nextStatus) {
    return null;
  }
  if (REOPEN_STATUSES.has(nextStatus) || nextStatus === "archived") {
    return null;
  }
  if (SKIPPED_STATUSES.has(currentStatus) && !SKIPPED_STATUSES.has(nextStatus)) {
    return `${label} status ${currentStatus} must be reopened before changing to ${nextStatus}`;
  }
  if (COMPLETE_STATUSES.has(currentStatus) && ACTIVE_WORK_STATUSES.has(nextStatus)) {
    return `${label} status ${currentStatus} must be reopened before changing to ${nextStatus}`;
  }
  return null;
}

function duplicateIds(ids: readonly string[] | undefined): string[] {
  if (!ids) {
    return [];
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates];
}

function participatesInSequence(status: PccStatus | undefined): boolean {
  return !SKIPPED_STATUSES.has(status ?? "not_started");
}

function normalizedTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function validateMilestoneTitle(
  ledger: PccLedger,
  projectId: string,
  milestoneId: string,
  title: string,
  status: PccStatus,
): string | null {
  if (!participatesInSequence(status)) {
    return null;
  }
  const normalized = normalizedTitle(title);
  const conflicting = ledger.milestones.find(
    (milestone) =>
      milestone.projectId === projectId &&
      milestone.id !== milestoneId &&
      normalizedTitle(milestone.title) === normalized &&
      participatesInSequence(milestone.status),
  );
  return conflicting ? `milestone title already used by ${conflicting.id}: ${title}` : null;
}

function validateSubMilestoneTitle(
  ledger: PccLedger,
  projectId: string,
  milestoneId: string,
  subMilestoneId: string,
  title: string,
  status: PccStatus,
): string | null {
  if (!participatesInSequence(status)) {
    return null;
  }
  const normalized = normalizedTitle(title);
  const conflicting = ledger.subMilestones.find(
    (subMilestone) =>
      subMilestone.projectId === projectId &&
      subMilestone.milestoneId === milestoneId &&
      subMilestone.id !== subMilestoneId &&
      normalizedTitle(subMilestone.title) === normalized &&
      participatesInSequence(subMilestone.status),
  );
  return conflicting ? `sub-milestone title already used by ${conflicting.id}: ${title}` : null;
}

function validateMilestoneOrder(
  ledger: PccLedger,
  projectId: string,
  milestoneId: string,
  order: number | undefined,
  status: PccStatus,
): string | null {
  if (order === undefined || !participatesInSequence(status)) {
    return null;
  }
  const conflicting = ledger.milestones.find(
    (milestone) =>
      milestone.projectId === projectId &&
      milestone.id !== milestoneId &&
      milestone.order === order &&
      participatesInSequence(milestone.status),
  );
  return conflicting ? `milestone order ${order} already used by ${conflicting.id}` : null;
}

function validateSubMilestoneOrder(
  ledger: PccLedger,
  projectId: string,
  milestoneId: string,
  subMilestoneId: string,
  order: number | undefined,
  status: PccStatus,
): string | null {
  if (order === undefined || !participatesInSequence(status)) {
    return null;
  }
  const conflicting = ledger.subMilestones.find(
    (subMilestone) =>
      subMilestone.projectId === projectId &&
      subMilestone.milestoneId === milestoneId &&
      subMilestone.id !== subMilestoneId &&
      subMilestone.order === order &&
      participatesInSequence(subMilestone.status),
  );
  return conflicting ? `sub-milestone order ${order} already used by ${conflicting.id}` : null;
}

function dependencyCreatesCycle(
  items: readonly { id: string; dependsOn?: string[] }[],
  itemId: string,
  nextDependsOn: readonly string[],
): boolean {
  const dependencyMap = new Map<string, readonly string[]>();
  for (const item of items) {
    dependencyMap.set(item.id, item.id === itemId ? nextDependsOn : (item.dependsOn ?? []));
  }
  if (!dependencyMap.has(itemId)) {
    dependencyMap.set(itemId, nextDependsOn);
  }
  const seen = new Set<string>();
  const visits = [...nextDependsOn];
  while (visits.length > 0) {
    const dependencyId = visits.pop();
    if (!dependencyId || seen.has(dependencyId)) {
      continue;
    }
    if (dependencyId === itemId) {
      return true;
    }
    seen.add(dependencyId);
    visits.push(...(dependencyMap.get(dependencyId) ?? []));
  }
  return false;
}

function validateMilestoneReferences(
  ledger: PccLedger,
  projectId: string,
  milestoneId: string,
  input: {
    dependsOn?: string[];
    requiredEvidenceIds?: string[];
    receiptIds?: string[];
    permissionGrantIds?: string[];
  },
): string | null {
  const duplicateDependencyIds = duplicateIds(input.dependsOn);
  if (duplicateDependencyIds.length > 0) {
    return `duplicate milestone dependency id: ${duplicateDependencyIds[0]}`;
  }
  const dependencyIds = input.dependsOn ?? [];
  for (const dependencyId of dependencyIds) {
    if (dependencyId === milestoneId) {
      return "milestone cannot depend on itself";
    }
    const dependency = milestoneOrError(ledger, dependencyId);
    if (!dependency || dependency.projectId !== projectId) {
      return `milestone dependency not found in project: ${dependencyId}`;
    }
  }
  if (
    dependencyCreatesCycle(
      ledger.milestones.filter((milestone) => milestone.projectId === projectId),
      milestoneId,
      dependencyIds,
    )
  ) {
    return "milestone dependencies cannot create a cycle";
  }
  for (const evidenceId of input.requiredEvidenceIds ?? []) {
    const evidence = ledger.evidence.find((item) => item.id === evidenceId);
    if (!evidence || evidence.projectId !== projectId) {
      return `evidence not found in project: ${evidenceId}`;
    }
    if (evidence.milestoneId && evidence.milestoneId !== milestoneId) {
      return `evidence belongs to another milestone: ${evidenceId}`;
    }
  }
  for (const receiptId of input.receiptIds ?? []) {
    const receipt = ledger.receipts.find((item) => item.id === receiptId);
    if (!receipt || receipt.projectId !== projectId || receipt.milestoneId !== milestoneId) {
      return `receipt not found for milestone: ${receiptId}`;
    }
  }
  for (const permissionId of input.permissionGrantIds ?? []) {
    const permission = ledger.permissions.find((item) => item.id === permissionId);
    if (!permission || permission.projectId !== projectId) {
      return `permission grant not found in project: ${permissionId}`;
    }
    if (permission.milestoneId && permission.milestoneId !== milestoneId) {
      return `permission grant belongs to another milestone: ${permissionId}`;
    }
  }
  return null;
}

function validateSubMilestoneReferences(
  ledger: PccLedger,
  projectId: string,
  milestoneId: string,
  subMilestoneId: string,
  input: {
    dependsOn?: string[];
    requiredEvidenceIds?: string[];
    receiptIds?: string[];
    permissionGrantIds?: string[];
  },
): string | null {
  const duplicateDependencyIds = duplicateIds(input.dependsOn);
  if (duplicateDependencyIds.length > 0) {
    return `duplicate sub-milestone dependency id: ${duplicateDependencyIds[0]}`;
  }
  const dependencyIds = input.dependsOn ?? [];
  for (const dependencyId of dependencyIds) {
    if (dependencyId === subMilestoneId) {
      return "sub-milestone cannot depend on itself";
    }
    const dependency = subMilestoneOrError(ledger, dependencyId);
    if (
      !dependency ||
      dependency.projectId !== projectId ||
      dependency.milestoneId !== milestoneId
    ) {
      return `sub-milestone dependency not found under milestone: ${dependencyId}`;
    }
  }
  if (
    dependencyCreatesCycle(
      ledger.subMilestones.filter(
        (subMilestone) =>
          subMilestone.projectId === projectId && subMilestone.milestoneId === milestoneId,
      ),
      subMilestoneId,
      dependencyIds,
    )
  ) {
    return "sub-milestone dependencies cannot create a cycle";
  }
  for (const evidenceId of input.requiredEvidenceIds ?? []) {
    const evidence = ledger.evidence.find((item) => item.id === evidenceId);
    if (!evidence || evidence.projectId !== projectId) {
      return `evidence not found in project: ${evidenceId}`;
    }
    if (evidence.milestoneId && evidence.milestoneId !== milestoneId) {
      return `evidence belongs to another milestone: ${evidenceId}`;
    }
  }
  for (const receiptId of input.receiptIds ?? []) {
    const receipt = ledger.receipts.find((item) => item.id === receiptId);
    if (!receipt || receipt.projectId !== projectId || receipt.milestoneId !== milestoneId) {
      return `receipt not found for parent milestone: ${receiptId}`;
    }
  }
  for (const permissionId of input.permissionGrantIds ?? []) {
    const permission = ledger.permissions.find((item) => item.id === permissionId);
    if (!permission || permission.projectId !== projectId) {
      return `permission grant not found in project: ${permissionId}`;
    }
    if (permission.milestoneId && permission.milestoneId !== milestoneId) {
      return `permission grant belongs to another milestone: ${permissionId}`;
    }
  }
  return null;
}

function validateDecisionReferences(
  ledger: PccLedger,
  input: {
    projectId: string;
    milestoneId?: string;
    subMilestoneId?: string;
    evidenceIds?: string[];
  },
): string | null {
  const project = projectOrError(ledger, input.projectId);
  if (!project) {
    return `project not found: ${input.projectId}`;
  }
  if (input.milestoneId) {
    const milestone = milestoneOrError(ledger, input.milestoneId);
    if (!milestone || milestone.projectId !== input.projectId) {
      return `milestone not found in project: ${input.milestoneId}`;
    }
  }
  if (input.subMilestoneId) {
    const subMilestone = subMilestoneOrError(ledger, input.subMilestoneId);
    if (!subMilestone || subMilestone.projectId !== input.projectId) {
      return `sub-milestone not found in project: ${input.subMilestoneId}`;
    }
    if (input.milestoneId && subMilestone.milestoneId !== input.milestoneId) {
      return `sub-milestone does not belong to milestone: ${input.subMilestoneId}`;
    }
  }
  const duplicateEvidenceIds = duplicateIds(input.evidenceIds);
  if (duplicateEvidenceIds.length > 0) {
    return `duplicate decision evidence id: ${duplicateEvidenceIds[0]}`;
  }
  for (const evidenceId of input.evidenceIds ?? []) {
    const evidence = ledger.evidence.find((item) => item.id === evidenceId);
    if (!evidence || evidence.projectId !== input.projectId) {
      return `evidence not found in project: ${evidenceId}`;
    }
  }
  return null;
}

function ensureSubMilestoneCanBeComplete(
  ledger: PccLedger,
  status: PccStatus,
  requiredEvidenceIds: readonly string[] | undefined,
  receiptIds: readonly string[] | undefined,
): string | null {
  if (!COMPLETE_STATUSES.has(status)) {
    return null;
  }
  if (receiptIds && receiptIds.length > 0) {
    return null;
  }
  if (!requiredEvidenceIds || requiredEvidenceIds.length === 0) {
    return "complete sub-milestone status requires passed evidence or a parent completion receipt";
  }
  const missingPassedEvidence = requiredEvidenceIds.find(
    (evidenceId) => !evidenceIsPassed(ledger, evidenceId),
  );
  if (missingPassedEvidence) {
    return `complete sub-milestone status requires passed evidence: ${missingPassedEvidence}`;
  }
  return null;
}

function ensureMilestoneCanBeComplete(
  ledger: PccLedger,
  milestoneId: string,
  status: PccStatus,
  receiptIds: readonly string[] | undefined,
): string | null {
  if (!COMPLETE_STATUSES.has(status)) {
    return null;
  }
  if (!subMilestonesCompleteForMilestone(ledger, milestoneId)) {
    return "complete milestone status requires every non-skipped sub-milestone to be complete";
  }
  if ((receiptIds && receiptIds.length > 0) || hasReceipt(ledger, milestoneId)) {
    return null;
  }
  return "complete milestone status requires a completion receipt";
}

function upsertMilestone(
  ledger: PccLedger,
  input: {
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
  },
): { milestone?: PccMilestone; error?: string } {
  if (!projectOrError(ledger, input.projectId)) {
    return { error: `project not found: ${input.projectId}` };
  }
  const existing = input.id ? milestoneOrError(ledger, input.id) : null;
  if (existing && existing.projectId !== input.projectId) {
    return {
      error: `milestone ${existing.id} belongs to project ${existing.projectId}; cannot move to project ${input.projectId}`,
    };
  }
  const timestamp = nowIso();
  const id = existing?.id ?? input.id ?? makeId("milestone", input.title);
  const status = input.status ?? existing?.status ?? "not_started";
  const transitionError = validateStatusTransition("milestone", existing?.status, status);
  if (transitionError) {
    return { error: transitionError };
  }
  const titleError = validateMilestoneTitle(ledger, input.projectId, id, input.title, status);
  if (titleError) {
    return { error: titleError };
  }
  const order = input.order ?? existing?.order;
  const orderError = validateMilestoneOrder(ledger, input.projectId, id, order, status);
  if (orderError) {
    return { error: orderError };
  }
  const receiptIds = input.receiptIds ?? existing?.receiptIds;
  const referenceError = validateMilestoneReferences(ledger, input.projectId, id, {
    dependsOn: input.dependsOn ?? existing?.dependsOn,
    requiredEvidenceIds: input.requiredEvidenceIds,
    receiptIds,
    permissionGrantIds: input.permissionGrantIds,
  });
  if (referenceError) {
    return { error: referenceError };
  }
  const completeError = ensureMilestoneCanBeComplete(ledger, id, status, receiptIds);
  if (completeError) {
    return { error: completeError };
  }
  const milestone = canonicalizePccWorkItemForWrite<PccMilestone>(
    {
      id,
      projectId: input.projectId,
      title: input.title,
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(input.phaseId !== undefined
        ? { phaseId: input.phaseId }
        : existing?.phaseId !== undefined
          ? { phaseId: existing.phaseId }
          : {}),
      ...(input.owner !== undefined
        ? { owner: input.owner }
        : existing?.owner !== undefined
          ? { owner: existing.owner }
          : {}),
      ...(order !== undefined ? { order } : {}),
      ...(input.percentComplete !== undefined
        ? { percentComplete: input.percentComplete }
        : existing?.percentComplete !== undefined
          ? { percentComplete: existing.percentComplete }
          : {}),
      ...(input.dependsOn !== undefined
        ? { dependsOn: input.dependsOn }
        : existing?.dependsOn !== undefined
          ? { dependsOn: existing.dependsOn }
          : {}),
      ...(input.requiredEvidenceIds !== undefined
        ? { requiredEvidenceIds: input.requiredEvidenceIds }
        : existing?.requiredEvidenceIds !== undefined
          ? { requiredEvidenceIds: existing.requiredEvidenceIds }
          : {}),
      ...(receiptIds !== undefined ? { receiptIds } : {}),
      ...(input.permissionGrantIds !== undefined
        ? { permissionGrantIds: input.permissionGrantIds }
        : existing?.permissionGrantIds !== undefined
          ? { permissionGrantIds: existing.permissionGrantIds }
          : {}),
      ...(input.blocker !== undefined
        ? { blocker: input.blocker }
        : existing?.blocker !== undefined
          ? { blocker: existing.blocker }
          : {}),
      ...(input.implementationPlan !== undefined
        ? { implementationPlan: input.implementationPlan }
        : existing?.implementationPlan !== undefined
          ? { implementationPlan: existing.implementationPlan }
          : {}),
      ...(input.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: input.acceptanceCriteria }
        : existing?.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: existing.acceptanceCriteria }
          : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata }
        : existing?.metadata !== undefined
          ? { metadata: existing.metadata }
          : {}),
    },
    timestamp,
  );
  return { milestone: setAt(ledger.milestones, milestone) };
}

function upsertSubMilestone(
  ledger: PccLedger,
  input: {
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
  },
): { subMilestone?: PccSubMilestone; milestone?: PccMilestone; error?: string } {
  if (!projectOrError(ledger, input.projectId)) {
    return { error: `project not found: ${input.projectId}` };
  }
  const milestone = milestoneOrError(ledger, input.milestoneId);
  if (!milestone || milestone.projectId !== input.projectId) {
    return { error: `milestone not found: ${input.milestoneId}` };
  }
  const existing = input.id ? subMilestoneOrError(ledger, input.id) : null;
  if (existing && existing.projectId !== input.projectId) {
    return {
      error: `sub-milestone ${existing.id} belongs to project ${existing.projectId}; cannot move to project ${input.projectId}`,
    };
  }
  if (existing && existing.milestoneId !== input.milestoneId) {
    return {
      error: `sub-milestone ${existing.id} belongs to milestone ${existing.milestoneId}; cannot move to milestone ${input.milestoneId}`,
    };
  }
  const timestamp = nowIso();
  const id = existing?.id ?? input.id ?? makeId("submilestone", input.title);
  const status = input.status ?? existing?.status ?? "not_started";
  const transitionError = validateStatusTransition("sub-milestone", existing?.status, status);
  if (transitionError) {
    return { error: transitionError };
  }
  const titleError = validateSubMilestoneTitle(
    ledger,
    input.projectId,
    input.milestoneId,
    id,
    input.title,
    status,
  );
  if (titleError) {
    return { error: titleError };
  }
  const order = input.order ?? existing?.order;
  const orderError = validateSubMilestoneOrder(
    ledger,
    input.projectId,
    input.milestoneId,
    id,
    order,
    status,
  );
  if (orderError) {
    return { error: orderError };
  }
  const requiredEvidenceIds = input.requiredEvidenceIds ?? existing?.requiredEvidenceIds;
  const receiptIds = input.receiptIds ?? existing?.receiptIds;
  const referenceError = validateSubMilestoneReferences(
    ledger,
    input.projectId,
    input.milestoneId,
    id,
    {
      dependsOn: input.dependsOn ?? existing?.dependsOn,
      requiredEvidenceIds,
      receiptIds,
      permissionGrantIds: input.permissionGrantIds,
    },
  );
  if (referenceError) {
    return { error: referenceError };
  }
  const completeError = ensureSubMilestoneCanBeComplete(
    ledger,
    status,
    requiredEvidenceIds,
    receiptIds,
  );
  if (completeError) {
    return { error: completeError };
  }
  const subMilestone = canonicalizePccWorkItemForWrite<PccSubMilestone>(
    {
      id,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      title: input.title,
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(order !== undefined ? { order } : {}),
      ...(input.owner !== undefined
        ? { owner: input.owner }
        : existing?.owner !== undefined
          ? { owner: existing.owner }
          : {}),
      ...(input.percentComplete !== undefined
        ? { percentComplete: input.percentComplete }
        : existing?.percentComplete !== undefined
          ? { percentComplete: existing.percentComplete }
          : {}),
      ...(input.dependsOn !== undefined
        ? { dependsOn: input.dependsOn }
        : existing?.dependsOn !== undefined
          ? { dependsOn: existing.dependsOn }
          : {}),
      ...(requiredEvidenceIds !== undefined ? { requiredEvidenceIds } : {}),
      ...(receiptIds !== undefined ? { receiptIds } : {}),
      ...(input.permissionGrantIds !== undefined
        ? { permissionGrantIds: input.permissionGrantIds }
        : existing?.permissionGrantIds !== undefined
          ? { permissionGrantIds: existing.permissionGrantIds }
          : {}),
      ...(input.blocker !== undefined
        ? { blocker: input.blocker }
        : existing?.blocker !== undefined
          ? { blocker: existing.blocker }
          : {}),
      ...(input.implementationPlan !== undefined
        ? { implementationPlan: input.implementationPlan }
        : existing?.implementationPlan !== undefined
          ? { implementationPlan: existing.implementationPlan }
          : {}),
      ...(input.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: input.acceptanceCriteria }
        : existing?.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: existing.acceptanceCriteria }
          : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata }
        : existing?.metadata !== undefined
          ? { metadata: existing.metadata }
          : {}),
    },
    timestamp,
  );
  setAt(ledger.subMilestones, subMilestone);
  return { subMilestone, milestone };
}

function repairProjectMilestoneOrders(
  milestones: readonly PccMilestone[],
  now: string,
): { milestones: Map<string, PccMilestone>; repairedIds: string[] } {
  const repaired = new Map<string, PccMilestone>();
  const repairedIds: string[] = [];
  const byProject = new Map<string, PccMilestone[]>();
  for (const milestone of milestones) {
    byProject.set(milestone.projectId, [...(byProject.get(milestone.projectId) ?? []), milestone]);
  }
  for (const projectMilestones of byProject.values()) {
    const sorted = projectMilestones.toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
    const seen = new Set<number>();
    let needsRewrite = false;
    for (const milestone of sorted) {
      const order = milestone.order;
      if (
        typeof order !== "number" ||
        !Number.isFinite(order) ||
        order < 0 ||
        (participatesInSequence(milestone.status) && seen.has(order))
      ) {
        needsRewrite = true;
      }
      if (typeof order === "number" && Number.isFinite(order) && order >= 0) {
        seen.add(order);
      }
    }
    if (!needsRewrite) {
      continue;
    }
    for (const [index, milestone] of sorted.entries()) {
      const nextOrder = (index + 1) * 10;
      if (milestone.order !== nextOrder) {
        repairedIds.push(milestone.id);
        repaired.set(milestone.id, { ...milestone, order: nextOrder, updatedAt: now });
      }
    }
  }
  return { milestones: repaired, repairedIds: [...new Set(repairedIds)] };
}

function repairProjectSubMilestoneOrders(
  subMilestones: readonly PccSubMilestone[],
  now: string,
): { subMilestones: Map<string, PccSubMilestone>; repairedIds: string[] } {
  const repaired = new Map<string, PccSubMilestone>();
  const repairedIds: string[] = [];
  const byParent = new Map<string, PccSubMilestone[]>();
  for (const subMilestone of subMilestones) {
    const key = `${subMilestone.projectId}:${subMilestone.milestoneId}`;
    byParent.set(key, [...(byParent.get(key) ?? []), subMilestone]);
  }
  for (const children of byParent.values()) {
    const sorted = children.toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
    const seen = new Set<number>();
    let needsRewrite = false;
    for (const subMilestone of sorted) {
      const order = subMilestone.order;
      if (
        typeof order !== "number" ||
        !Number.isFinite(order) ||
        order < 0 ||
        (participatesInSequence(subMilestone.status) && seen.has(order))
      ) {
        needsRewrite = true;
      }
      if (typeof order === "number" && Number.isFinite(order) && order >= 0) {
        seen.add(order);
      }
    }
    if (!needsRewrite) {
      continue;
    }
    for (const [index, subMilestone] of sorted.entries()) {
      const nextOrder = (index + 1) * 10;
      if (subMilestone.order !== nextOrder) {
        repairedIds.push(subMilestone.id);
        repaired.set(subMilestone.id, { ...subMilestone, order: nextOrder, updatedAt: now });
      }
    }
  }
  return { subMilestones: repaired, repairedIds: [...new Set(repairedIds)] };
}

function repairCanonicalMetadataForLedger(
  ledger: PccLedger,
  params: Record<string, unknown>,
): {
  repairedProjectIds: string[];
  repairedMilestoneIds: string[];
  repairedSubMilestoneIds: string[];
  repairedReceiptIds: string[];
  projectIds: string[];
} {
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
  const includeTerminal = params.includeTerminal === true;
  const eligibleProjectIds = new Set(
    ledger.projects
      .filter((project) => !projectId || project.id === projectId)
      .filter(
        (project) =>
          includeTerminal || (project.status !== "archived" && project.status !== "skipped"),
      )
      .map((project) => project.id),
  );
  const now = nowIso();
  const repairedProjectIds: string[] = [];
  const repairedReceiptIds: string[] = [];
  ledger.projects = ledger.projects.map((project) => {
    if (!eligibleProjectIds.has(project.id)) {
      return project;
    }
    const repaired = canonicalizePccProjectForWrite(project, now);
    if (JSON.stringify(repaired) !== JSON.stringify(project)) {
      repairedProjectIds.push(project.id);
    }
    return repaired;
  });
  const eligibleMilestones = ledger.milestones.filter((milestone) =>
    eligibleProjectIds.has(milestone.projectId),
  );
  const eligibleSubMilestones = ledger.subMilestones.filter((subMilestone) =>
    eligibleProjectIds.has(subMilestone.projectId),
  );
  const milestoneRepair = repairPccCanonicalWorkItems(eligibleMilestones, now);
  const subMilestoneRepair = repairPccCanonicalWorkItems(eligibleSubMilestones, now);
  const orderRepair = repairProjectMilestoneOrders(milestoneRepair.items, now);
  const subOrderRepair = repairProjectSubMilestoneOrders(subMilestoneRepair.items, now);
  const repairedMilestones = new Map(
    milestoneRepair.items.map((milestone) => [milestone.id, milestone]),
  );
  for (const [id, milestone] of orderRepair.milestones) {
    repairedMilestones.set(id, milestone);
  }
  const repairedSubMilestones = new Map(
    subMilestoneRepair.items.map((subMilestone) => [subMilestone.id, subMilestone]),
  );
  for (const [id, subMilestone] of subOrderRepair.subMilestones) {
    repairedSubMilestones.set(id, subMilestone);
  }
  ledger.milestones = ledger.milestones.map(
    (milestone) => repairedMilestones.get(milestone.id) ?? milestone,
  );
  ledger.subMilestones = ledger.subMilestones.map(
    (subMilestone) => repairedSubMilestones.get(subMilestone.id) ?? subMilestone,
  );
  ledger.receipts = ledger.receipts.map((receipt) => {
    if (!eligibleProjectIds.has(receipt.projectId)) {
      return receipt;
    }
    const proofLevel = normalizedReceiptProofLevel(receipt.proofLevel);
    if (receipt.proofLevel === proofLevel) {
      return receipt;
    }
    repairedReceiptIds.push(receipt.id);
    return { ...receipt, proofLevel };
  });
  return {
    repairedProjectIds,
    repairedMilestoneIds: [
      ...new Set([...milestoneRepair.repairedIds, ...orderRepair.repairedIds]),
    ],
    repairedSubMilestoneIds: [
      ...new Set([...subMilestoneRepair.repairedIds, ...subOrderRepair.repairedIds]),
    ],
    repairedReceiptIds,
    projectIds: [...eligibleProjectIds],
  };
}

function screenshotPathFromEvidence(evidence: readonly PccEvidence[]): string | undefined {
  return evidence.find((item) => item.kind === "browser_proof" && item.path)?.path;
}

function shaFromEvidence(evidence: readonly PccEvidence[]): string | undefined {
  return evidence.find((item) => item.sha)?.sha;
}

function lastKnownGoodFromReceipt(
  ledger: PccLedger,
  milestone: PccMilestone,
  receipt: PccCompletionReceipt,
  evidence: readonly PccEvidence[],
): PccLastKnownGood {
  const subsystem = `Milestone: ${milestone.title}`;
  const existing = ledger.lastKnownGood.find(
    (entry) => entry.projectId === receipt.projectId && entry.subsystem === subsystem,
  );
  return {
    id: existing?.id ?? makeId("lkg", milestone.title),
    projectId: receipt.projectId,
    subsystem,
    summary: receipt.summary,
    evidenceIds: receipt.proofEvidenceIds,
    verifiedAt: receipt.completedAt,
    ...(shaFromEvidence(evidence) ? { sha: shaFromEvidence(evidence) } : {}),
    ...(screenshotPathFromEvidence(evidence)
      ? { screenshotPath: screenshotPathFromEvidence(evidence) }
      : {}),
  };
}

function responseForProject(ledger: PccLedger, project: PccProject) {
  return {
    project,
    milestones: ledger.milestones.filter((milestone) => milestone.projectId === project.id),
    subMilestones: ledger.subMilestones.filter(
      (subMilestone) => subMilestone.projectId === project.id,
    ),
    permissions: ledger.permissions.filter((permission) => permission.projectId === project.id),
    evidence: ledger.evidence.filter((evidence) => evidence.projectId === project.id),
    receipts: ledger.receipts.filter((receipt) => receipt.projectId === project.id),
    decisions: ledger.decisions.filter((decision) => decision.projectId === project.id),
    lastKnownGood: ledger.lastKnownGood.filter((entry) => entry.projectId === project.id),
    summary: summarizeProject(ledger, project),
  };
}

export const pccHandlers: GatewayRequestHandlers = {
  "pcc.projects.list": ({ params, respond }) => {
    if (!validatePccProjectsListParams(params)) {
      respondInvalid(respond, "pcc.projects.list", validatePccProjectsListParams.errors);
      return;
    }
    try {
      const ledger = readLedger();
      const projects = ledger.projects
        .filter((project) => params.includeArchived || project.status !== "archived")
        .map((project) => summarizeProject(ledger, project));
      respond(true, { projects });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.projects.get": ({ params, respond }) => {
    if (!validatePccProjectsGetParams(params)) {
      respondInvalid(respond, "pcc.projects.get", validatePccProjectsGetParams.errors);
      return;
    }
    try {
      const ledger = readLedger();
      const project = projectOrError(ledger, params.projectId);
      if (!project) {
        respondNotFound(respond, `project ${params.projectId}`);
        return;
      }
      respond(true, responseForProject(ledger, project));
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.ledger.repairCanonicalMetadata": ({ params, respond }) => {
    try {
      const result = withLedger((ledger) => repairCanonicalMetadataForLedger(ledger, params), {
        write: true,
        auditKind: "pcc.ledger.repairCanonicalMetadata",
      });
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.projects.upsert": ({ params, respond }) => {
    if (!validatePccProjectsUpsertParams(params)) {
      respondInvalid(respond, "pcc.projects.upsert", validatePccProjectsUpsertParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const upsert = upsertProject(ledger, params.project);
          if (upsert.error || !upsert.project) {
            return { error: upsert.error ?? "project upsert failed" };
          }
          return { project: upsert.project, summary: summarizeProject(ledger, upsert.project) };
        },
        { write: true, auditKind: "pcc.projects.upsert" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.milestones.upsert": ({ params, respond }) => {
    if (!validatePccMilestonesUpsertParams(params)) {
      respondInvalid(respond, "pcc.milestones.upsert", validatePccMilestonesUpsertParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const upsert = upsertMilestone(ledger, params.milestone);
          if (upsert.error || !upsert.milestone) {
            return { error: upsert.error ?? "milestone upsert failed" };
          }
          const project = projectOrError(ledger, upsert.milestone.projectId);
          if (!project) {
            return { error: `project not found: ${upsert.milestone.projectId}` };
          }
          return {
            milestone: upsert.milestone,
            summary: summarizeProject(ledger, project),
          };
        },
        { write: true, auditKind: "pcc.milestones.upsert" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.subMilestones.list": ({ params, respond }) => {
    if (!validatePccSubMilestonesListParams(params)) {
      respondInvalid(respond, "pcc.subMilestones.list", validatePccSubMilestonesListParams.errors);
      return;
    }
    try {
      const ledger = readLedger();
      if (!projectOrError(ledger, params.projectId)) {
        respondNotFound(respond, `project ${params.projectId}`);
        return;
      }
      respond(true, {
        subMilestones: ledger.subMilestones
          .filter((subMilestone) => subMilestone.projectId === params.projectId)
          .filter(
            (subMilestone) =>
              !params.milestoneId || subMilestone.milestoneId === params.milestoneId,
          )
          .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)),
      });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.subMilestones.upsert": ({ params, respond }) => {
    if (!validatePccSubMilestonesUpsertParams(params)) {
      respondInvalid(
        respond,
        "pcc.subMilestones.upsert",
        validatePccSubMilestonesUpsertParams.errors,
      );
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const upsert = upsertSubMilestone(ledger, params.subMilestone);
          if (upsert.error || !upsert.subMilestone || !upsert.milestone) {
            return { error: upsert.error ?? "sub-milestone upsert failed" };
          }
          const project = projectOrError(ledger, upsert.subMilestone.projectId);
          if (!project) {
            return { error: `project not found: ${upsert.subMilestone.projectId}` };
          }
          return {
            subMilestone: upsert.subMilestone,
            milestone: upsert.milestone,
            summary: summarizeProject(ledger, project),
          };
        },
        { write: true, auditKind: "pcc.subMilestones.upsert" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.permissions.upsert": ({ params, respond }) => {
    if (!validatePccPermissionsUpsertParams(params)) {
      respondInvalid(respond, "pcc.permissions.upsert", validatePccPermissionsUpsertParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.permission.projectId);
          if (!project) {
            return { error: `project not found: ${params.permission.projectId}` };
          }
          const existing = params.permission.id
            ? ledger.permissions.find((permission) => permission.id === params.permission.id)
            : null;
          if (existing && existing.projectId !== params.permission.projectId) {
            return {
              error: `permission ${existing.id} belongs to project ${existing.projectId}; cannot move to project ${params.permission.projectId}`,
            };
          }
          const milestoneError = validateMilestoneBelongsToProject(
            ledger,
            params.permission.milestoneId ?? existing?.milestoneId,
            params.permission.projectId,
          );
          if (milestoneError) {
            return { error: milestoneError };
          }
          const timestamp = nowIso();
          const status = params.permission.status ?? existing?.status ?? "needed";
          const auditLog = [
            ...(existing?.auditLog ?? []),
            {
              at: timestamp,
              status,
              ...(params.permission.note ? { note: params.permission.note } : {}),
            },
          ].slice(-200);
          const permission: PccPermissionGrant = {
            id:
              existing?.id ?? params.permission.id ?? makeId("permission", params.permission.type),
            projectId: params.permission.projectId,
            type: params.permission.type,
            status,
            riskLevel: params.permission.riskLevel ?? existing?.riskLevel ?? "medium",
            allowedActions: params.permission.allowedActions ?? existing?.allowedActions ?? [],
            usedCount:
              status === "used" ? (existing?.usedCount ?? 0) + 1 : (existing?.usedCount ?? 0),
            auditLog,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
            ...(params.permission.milestoneId !== undefined
              ? { milestoneId: params.permission.milestoneId }
              : existing?.milestoneId !== undefined
                ? { milestoneId: existing.milestoneId }
                : {}),
            ...(params.permission.forbiddenActions !== undefined
              ? { forbiddenActions: params.permission.forbiddenActions }
              : existing?.forbiddenActions !== undefined
                ? { forbiddenActions: existing.forbiddenActions }
                : {}),
            ...(params.permission.target !== undefined
              ? { target: params.permission.target }
              : existing?.target !== undefined
                ? { target: existing.target }
                : {}),
            ...(params.permission.maxUses !== undefined
              ? { maxUses: params.permission.maxUses }
              : existing?.maxUses !== undefined
                ? { maxUses: existing.maxUses }
                : {}),
            ...(params.permission.expiresAt !== undefined
              ? { expiresAt: params.permission.expiresAt }
              : existing?.expiresAt !== undefined
                ? { expiresAt: existing.expiresAt }
                : {}),
            ...(params.permission.tokenBudget !== undefined
              ? { tokenBudget: params.permission.tokenBudget }
              : existing?.tokenBudget !== undefined
                ? { tokenBudget: existing.tokenBudget }
                : {}),
            ...(params.permission.costBudget !== undefined
              ? { costBudget: params.permission.costBudget }
              : existing?.costBudget !== undefined
                ? { costBudget: existing.costBudget }
                : {}),
            ...(params.permission.grantedBy !== undefined
              ? { grantedBy: params.permission.grantedBy }
              : existing?.grantedBy !== undefined
                ? { grantedBy: existing.grantedBy }
                : {}),
            ...(status === "granted"
              ? { grantedAt: existing?.grantedAt ?? timestamp }
              : existing?.grantedAt !== undefined
                ? { grantedAt: existing.grantedAt }
                : {}),
          };
          setAt(ledger.permissions, permission);
          return { permission, summary: summarizeProject(ledger, project) };
        },
        { write: true, auditKind: "pcc.permissions.upsert" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.evidence.add": ({ params, respond }) => {
    if (!validatePccEvidenceAddParams(params)) {
      respondInvalid(respond, "pcc.evidence.add", validatePccEvidenceAddParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.evidence.projectId);
          if (!project) {
            return { error: `project not found: ${params.evidence.projectId}` };
          }
          const milestoneError = validateMilestoneBelongsToProject(
            ledger,
            params.evidence.milestoneId,
            params.evidence.projectId,
          );
          if (milestoneError) {
            return { error: milestoneError };
          }
          const runtimeIdentity = readPccRuntimeIdentity();
          const proofSha = proofShaForEvidence(params.evidence, runtimeIdentity);
          if (proofSha.error) {
            return { error: proofSha.error };
          }
          const evidenceMetadata = evidenceMetadataWithRuntimeIdentity(
            params.evidence.metadata,
            runtimeIdentity,
          );
          const evidence: PccEvidence = {
            id: makeId("evidence", params.evidence.kind),
            projectId: params.evidence.projectId,
            kind: params.evidence.kind,
            status: params.evidence.status ?? "unknown",
            createdAt: nowIso(),
            ...(params.evidence.milestoneId ? { milestoneId: params.evidence.milestoneId } : {}),
            ...(params.evidence.summary !== undefined ? { summary: params.evidence.summary } : {}),
            ...(params.evidence.source !== undefined ? { source: params.evidence.source } : {}),
            ...(params.evidence.url !== undefined ? { url: params.evidence.url } : {}),
            ...(params.evidence.path !== undefined ? { path: params.evidence.path } : {}),
            ...(proofSha.sha ? { sha: proofSha.sha } : {}),
            ...(params.evidence.command !== undefined ? { command: params.evidence.command } : {}),
            ...(params.evidence.exitCode !== undefined
              ? { exitCode: params.evidence.exitCode }
              : {}),
            ...(evidenceMetadata !== undefined ? { metadata: evidenceMetadata } : {}),
          };
          ledger.evidence.push(evidence);
          const updatedProject = bindPccProductionProofMetadata(project, evidence, runtimeIdentity);
          setAt(ledger.projects, updatedProject);
          return { evidence, summary: summarizeProject(ledger, updatedProject) };
        },
        { write: true, auditKind: "pcc.evidence.add" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.decisions.add": ({ params, respond }) => {
    if (!validatePccDecisionsAddParams(params)) {
      respondInvalid(respond, "pcc.decisions.add", validatePccDecisionsAddParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const referenceError = validateDecisionReferences(ledger, params.decision);
          if (referenceError) {
            return { error: referenceError };
          }
          const project = projectOrError(ledger, params.decision.projectId);
          if (!project) {
            return { error: `project not found: ${params.decision.projectId}` };
          }
          const timestamp = nowIso();
          const decision: PccDecision = {
            id: makeId("decision", params.decision.title),
            projectId: params.decision.projectId,
            title: params.decision.title,
            summary: params.decision.summary,
            decidedAt: timestamp,
            ...(params.decision.milestoneId ? { milestoneId: params.decision.milestoneId } : {}),
            ...(params.decision.subMilestoneId
              ? { subMilestoneId: params.decision.subMilestoneId }
              : {}),
            ...(params.decision.rationale !== undefined
              ? { rationale: params.decision.rationale }
              : {}),
            ...(params.decision.alternatives !== undefined
              ? { alternatives: params.decision.alternatives }
              : {}),
            ...(params.decision.impact !== undefined ? { impact: params.decision.impact } : {}),
            ...(params.decision.decidedBy !== undefined
              ? { decidedBy: params.decision.decidedBy }
              : {}),
            ...(params.decision.evidenceIds !== undefined
              ? { evidenceIds: params.decision.evidenceIds }
              : {}),
            ...(params.decision.metadata !== undefined
              ? { metadata: params.decision.metadata }
              : {}),
          };
          ledger.decisions.push(decision);
          return { decision, summary: summarizeProject(ledger, project) };
        },
        { write: true, auditKind: "pcc.decisions.add" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.receipts.add": ({ params, respond }) => {
    if (!validatePccReceiptsAddParams(params)) {
      respondInvalid(respond, "pcc.receipts.add", validatePccReceiptsAddParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.receipt.projectId);
          if (!project) {
            return { error: `project not found: ${params.receipt.projectId}` };
          }
          const milestone = milestoneOrError(ledger, params.receipt.milestoneId);
          if (!milestone || milestone.projectId !== project.id) {
            return { error: `milestone not found: ${params.receipt.milestoneId}` };
          }
          const duplicateEvidenceIds = duplicateIds(params.receipt.proofEvidenceIds);
          if (duplicateEvidenceIds.length > 0) {
            return { error: `duplicate proof evidence id: ${duplicateEvidenceIds[0]}` };
          }
          const missingEvidence = params.receipt.proofEvidenceIds.filter(
            (id) =>
              !ledger.evidence.some(
                (evidence) => evidence.id === id && evidence.projectId === project.id,
              ),
          );
          if (missingEvidence.length > 0) {
            return { error: `proof evidence not found: ${missingEvidence.join(", ")}` };
          }
          const linkedEvidence = ledger.evidence.filter((evidence) =>
            params.receipt.proofEvidenceIds.includes(evidence.id),
          );
          const wrongMilestoneEvidence = linkedEvidence.find(
            (evidence) => evidence.milestoneId && evidence.milestoneId !== milestone.id,
          );
          if (wrongMilestoneEvidence) {
            return {
              error: `proof evidence belongs to another milestone: ${wrongMilestoneEvidence.id}`,
            };
          }
          const failedEvidence = linkedEvidence.find((evidence) => evidence.status !== "passed");
          if (failedEvidence) {
            return { error: `proof evidence has not passed: ${failedEvidence.id}` };
          }
          const timestamp = nowIso();
          const receipt: PccCompletionReceipt = {
            id: makeId("receipt", milestone.title),
            projectId: project.id,
            milestoneId: milestone.id,
            summary: params.receipt.summary,
            proofEvidenceIds: params.receipt.proofEvidenceIds,
            proofLevel: params.receipt.proofLevel ?? "local",
            completedAt: timestamp,
            ...(params.receipt.artifactRefs !== undefined
              ? { artifactRefs: params.receipt.artifactRefs }
              : {}),
            ...(params.receipt.doNotRedo !== undefined
              ? { doNotRedo: params.receipt.doNotRedo }
              : {}),
            ...(params.receipt.followUpGaps !== undefined
              ? { followUpGaps: params.receipt.followUpGaps }
              : {}),
            ...(params.receipt.completedBy !== undefined
              ? { completedBy: params.receipt.completedBy }
              : {}),
          };
          ledger.receipts.push(receipt);
          const lastKnownGood = lastKnownGoodFromReceipt(
            ledger,
            milestone,
            receipt,
            linkedEvidence,
          );
          setAt(ledger.lastKnownGood, lastKnownGood);
          const updatedMilestone: PccMilestone = {
            ...milestone,
            status: "complete",
            percentComplete: 100,
            receiptIds: [...(milestone.receiptIds ?? []), receipt.id],
            updatedAt: timestamp,
          };
          setAt(ledger.milestones, updatedMilestone);
          return {
            receipt,
            milestone: updatedMilestone,
            lastKnownGood,
            summary: summarizeProject(ledger, project),
          };
        },
        { write: true, auditKind: "pcc.receipts.add" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.lastKnownGood.upsert": ({ params, respond }) => {
    if (!validatePccLastKnownGoodUpsertParams(params)) {
      respondInvalid(
        respond,
        "pcc.lastKnownGood.upsert",
        validatePccLastKnownGoodUpsertParams.errors,
      );
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.entry.projectId);
          if (!project) {
            return { error: `project not found: ${params.entry.projectId}` };
          }
          const duplicateEvidenceIds = duplicateIds(params.entry.evidenceIds);
          if (duplicateEvidenceIds.length > 0) {
            return { error: `duplicate evidence id: ${duplicateEvidenceIds[0]}` };
          }
          const missingEvidence = (params.entry.evidenceIds ?? []).filter(
            (id) =>
              !ledger.evidence.some(
                (evidence) => evidence.id === id && evidence.projectId === project.id,
              ),
          );
          if (missingEvidence.length > 0) {
            return { error: `evidence not found: ${missingEvidence.join(", ")}` };
          }
          const existing = params.entry.id
            ? ledger.lastKnownGood.find((entry) => entry.id === params.entry.id)
            : ledger.lastKnownGood.find(
                (entry) =>
                  entry.projectId === params.entry.projectId &&
                  entry.subsystem === params.entry.subsystem,
              );
          const entry: PccLastKnownGood = {
            id: existing?.id ?? params.entry.id ?? makeId("lkg", params.entry.subsystem),
            projectId: params.entry.projectId,
            subsystem: params.entry.subsystem,
            summary: params.entry.summary,
            verifiedAt: nowIso(),
            ...(params.entry.evidenceIds !== undefined
              ? { evidenceIds: params.entry.evidenceIds }
              : existing?.evidenceIds !== undefined
                ? { evidenceIds: existing.evidenceIds }
                : {}),
            ...(params.entry.sha !== undefined
              ? { sha: params.entry.sha }
              : existing?.sha !== undefined
                ? { sha: existing.sha }
                : {}),
            ...(params.entry.runtimePath !== undefined
              ? { runtimePath: params.entry.runtimePath }
              : existing?.runtimePath !== undefined
                ? { runtimePath: existing.runtimePath }
                : {}),
            ...(params.entry.screenshotPath !== undefined
              ? { screenshotPath: params.entry.screenshotPath }
              : existing?.screenshotPath !== undefined
                ? { screenshotPath: existing.screenshotPath }
                : {}),
          };
          setAt(ledger.lastKnownGood, entry);
          return { lastKnownGood: entry, summary: summarizeProject(ledger, project) };
        },
        { write: true, auditKind: "pcc.lastKnownGood.upsert" },
      );
      if ("error" in result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "PCC request failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.summary.get": ({ params, respond }) => {
    if (!validatePccSummaryGetParams(params)) {
      respondInvalid(respond, "pcc.summary.get", validatePccSummaryGetParams.errors);
      return;
    }
    try {
      const ledger = readLedger();
      if (params.projectId) {
        const project = projectOrError(ledger, params.projectId);
        if (!project) {
          respondNotFound(respond, `project ${params.projectId}`);
          return;
        }
        respond(true, {
          project: summarizeProject(ledger, project),
          portfolio: summarizePortfolio(ledger),
          runtimeIdentity: readPccRuntimeIdentity(),
        });
        return;
      }
      respond(true, {
        portfolio: summarizePortfolio(ledger),
        runtimeIdentity: readPccRuntimeIdentity(),
      });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
};

export const pccTesting = {
  closeLedgerStorage: closePccLedgerStorageForTest,
  ledgerPath,
  ledgerSqlitePath: pccLedgerSqlitePath,
  replaceLedger: replacePccLedgerForTest,
  defaultPhases: () => DEFAULT_PCC_PHASES.map((phase) => Object.assign({}, phase)),
  readLedger,
  summarizeProject,
  summarizePortfolio,
};

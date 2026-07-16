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
  type PccProject,
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
import { resolveSubagentMaxConcurrent } from "../../config/agent-limits.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { evaluatePccCapabilityEvidence } from "../../pcc/capability-evidence.js";
import {
  isPccCompleteStatus,
  isPccSkippedStatus,
  pccSubMilestonesAreComplete,
} from "../../pcc/domain/completion-policy.js";
import { collectPccExecutionCapacitySnapshot } from "../../pcc/execution-capacity.js";
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
  pccMetadataObject,
  pccMetadataString,
  pccWorkScopeForProject,
  repairPccCanonicalWorkItems,
} from "../../pcc/metadata.js";
import { buildPccLedgerReadIndex, pccIndexedItems } from "../../pcc/read-model/ledger-index.js";
import {
  summarizePccPortfolio as summarizePortfolio,
  summarizePccProject as summarizeProject,
} from "../../pcc/read-model/project-summary.js";
import { readPccRuntimeIdentity, type PccRuntimeIdentity } from "../../pcc/runtime-identity.js";
import { readPccUpdateSafety } from "../../pcc/update-safety.js";
import { listTaskRecords } from "../../tasks/runtime-internal.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

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

function nowIso(): string {
  return new Date().toISOString();
}

function readPccExecutionCapacity(config: OpenClawConfig) {
  const activeOpenClawTaskCount = listTaskRecords().filter(
    (task) => task.status === "queued" || task.status === "running",
  ).length;
  return collectPccExecutionCapacitySnapshot({
    activeOpenClawTaskCount,
    configuredSubagentLimit: resolveSubagentMaxConcurrent(config),
    // OpenClaw has no portable process-level local-model registry yet. Do not guess.
    observedLocalModelProcessCount: 0,
  });
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

function evidenceIsPassed(ledger: PccLedger, evidenceId: string): boolean {
  return ledger.evidence.some(
    (evidence) => evidence.id === evidenceId && evidence.status === "passed",
  );
}

function proofShaForEvidence(
  input: { kind: PccEvidence["kind"]; status?: PccEvidence["status"]; sha?: string },
  runtimeIdentity: PccRuntimeIdentity,
): { sha?: string; error?: string } {
  const requestedSha = pccMetadataString(input.sha);
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
  const metadata = pccMetadataObject(project.metadata);
  const truth = pccMetadataObject(metadata.pccProductionTruth);
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
  const projectId = existing?.id ?? input.id ?? makeId("project", input.title);
  const completionError = ensureProjectCanBeComplete(ledger, projectId, existing?.status, status);
  if (completionError) {
    return { error: completionError };
  }
  const project: PccProject = canonicalizePccProjectForWrite(
    {
      id: projectId,
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
  if (isPccSkippedStatus(currentStatus) && !isPccSkippedStatus(nextStatus)) {
    return `${label} status ${currentStatus} must be reopened before changing to ${nextStatus}`;
  }
  if (isPccCompleteStatus(currentStatus) && ACTIVE_WORK_STATUSES.has(nextStatus)) {
    return `${label} status ${currentStatus} must be reopened before changing to ${nextStatus}`;
  }
  return null;
}

function ensureProjectCanBeComplete(
  ledger: PccLedger,
  projectId: string,
  currentStatus: PccStatus | undefined,
  nextStatus: PccStatus,
): string | null {
  if (!isPccCompleteStatus(nextStatus) || isPccCompleteStatus(currentStatus ?? "not_started")) {
    return null;
  }
  const unfinished = ledger.milestones.find(
    (milestone) =>
      milestone.projectId === projectId &&
      participatesInSequence(milestone.status) &&
      !isPccCompleteStatus(milestone.status),
  );
  return unfinished
    ? `complete project status requires every non-skipped milestone to be complete: ${unfinished.title}`
    : null;
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
  return !isPccSkippedStatus(status ?? "not_started");
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
  if (!isPccCompleteStatus(status)) {
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
  if (!isPccCompleteStatus(status)) {
    return null;
  }
  const index = buildPccLedgerReadIndex(ledger);
  if (
    !pccSubMilestonesAreComplete(pccIndexedItems(index.subMilestonesByMilestoneId, milestoneId))
  ) {
    return "complete milestone status requires every non-skipped sub-milestone to be complete";
  }
  if (
    (receiptIds && receiptIds.length > 0) ||
    pccIndexedItems(index.receiptsByMilestoneId, milestoneId).length > 0
  ) {
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
  const index = buildPccLedgerReadIndex(ledger);
  return {
    project,
    milestones: pccIndexedItems(index.milestonesByProjectId, project.id),
    subMilestones: pccIndexedItems(index.subMilestonesByProjectId, project.id),
    permissions: pccIndexedItems(index.permissionsByProjectId, project.id),
    evidence: pccIndexedItems(index.evidenceByProjectId, project.id),
    receipts: pccIndexedItems(index.receiptsByProjectId, project.id),
    decisions: pccIndexedItems(index.decisionsByProjectId, project.id),
    lastKnownGood: pccIndexedItems(index.lastKnownGoodByProjectId, project.id),
    summary: summarizeProject(ledger, project, index),
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
      const index = buildPccLedgerReadIndex(ledger);
      const projects = ledger.projects
        .filter((project) => params.includeArchived || project.status !== "archived")
        .map((project) => summarizeProject(ledger, project, index));
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
          const capabilityEvidence = evaluatePccCapabilityEvidence({
            project,
            milestone,
            evidence: linkedEvidence,
          });
          if (!capabilityEvidence.passing) {
            return {
              error: `contracted completion evidence incomplete: ${capabilityEvidence.gaps.join(" ")}`,
            };
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
  "pcc.summary.get": ({ params, respond, context }) => {
    if (!validatePccSummaryGetParams(params)) {
      respondInvalid(respond, "pcc.summary.get", validatePccSummaryGetParams.errors);
      return;
    }
    try {
      const ledger = readLedger();
      const index = buildPccLedgerReadIndex(ledger);
      const executionCapacity = readPccExecutionCapacity(context.getRuntimeConfig());
      if (params.projectId) {
        const project = projectOrError(ledger, params.projectId);
        if (!project) {
          respondNotFound(respond, `project ${params.projectId}`);
          return;
        }
        respond(true, {
          project: summarizeProject(ledger, project, index),
          portfolio: summarizePortfolio(ledger, index),
          executionCapacity,
          runtimeIdentity: readPccRuntimeIdentity(),
          updateSafety: readPccUpdateSafety(),
        });
        return;
      }
      respond(true, {
        portfolio: summarizePortfolio(ledger, index),
        executionCapacity,
        runtimeIdentity: readPccRuntimeIdentity(),
        updateSafety: readPccUpdateSafety(),
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

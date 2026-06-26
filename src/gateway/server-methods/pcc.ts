// Project Command Center gateway methods persist project/milestone plans and proof receipts.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type PccCompletionReceipt,
  type PccEvidence,
  type PccLastKnownGood,
  type PccMilestone,
  type PccPermissionGrant,
  type PccPortfolioSummary,
  type PccProject,
  type PccProjectSummary,
  type PccStatus,
  validatePccEvidenceAddParams,
  validatePccLastKnownGoodUpsertParams,
  validatePccMilestonesUpsertParams,
  validatePccPermissionsUpsertParams,
  validatePccProjectsGetParams,
  validatePccProjectsListParams,
  validatePccProjectsUpsertParams,
  validatePccReceiptsAddParams,
  validatePccSummaryGetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

type PccLedger = {
  version: 1;
  projects: PccProject[];
  milestones: PccMilestone[];
  permissions: PccPermissionGrant[];
  evidence: PccEvidence[];
  receipts: PccCompletionReceipt[];
  lastKnownGood: PccLastKnownGood[];
};

type ProjectStatusCounts = PccProjectSummary["milestoneCounts"];
type Mutator<T> = (ledger: PccLedger) => T;

const PCC_LEDGER_VERSION = 1;
const PCC_DIR_NAME = "pcc";
const PCC_LEDGER_FILE = "ledger.json";
const COMPLETE_STATUSES = new Set<PccStatus>(["complete", "complete_with_maintenance"]);
const BLOCKED_STATUSES = new Set<PccStatus>(["blocked", "failed"]);
const WAITING_STATUSES = new Set<PccStatus>(["needs_approval", "deferred", "on_hold"]);
const SKIPPED_STATUSES = new Set<PccStatus>(["skipped", "archived"]);
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

function defaultLedger(): PccLedger {
  return {
    version: PCC_LEDGER_VERSION,
    projects: [],
    milestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    lastKnownGood: [],
  };
}

function stateRoot(): string {
  return process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw", "state");
}

function ledgerPath(): string {
  return path.join(stateRoot(), PCC_DIR_NAME, PCC_LEDGER_FILE);
}

function assertLedger(value: unknown): PccLedger {
  if (!value || typeof value !== "object") {
    return defaultLedger();
  }
  const raw = value as Partial<PccLedger>;
  return {
    version: PCC_LEDGER_VERSION,
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    receipts: Array.isArray(raw.receipts) ? raw.receipts : [],
    lastKnownGood: Array.isArray(raw.lastKnownGood) ? raw.lastKnownGood : [],
  };
}

function readLedger(): PccLedger {
  const file = ledgerPath();
  if (!fs.existsSync(file)) {
    return defaultLedger();
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  return assertLedger(parsed);
}

function writeLedger(ledger: PccLedger): void {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function withLedger<T>(mutator: Mutator<T>, opts?: { write?: boolean }): T {
  const ledger = readLedger();
  const result = mutator(ledger);
  if (opts?.write) {
    writeLedger(ledger);
  }
  return result;
}

function hasReceipt(ledger: PccLedger, milestoneId: string): boolean {
  return ledger.receipts.some((receipt) => receipt.milestoneId === milestoneId);
}

function milestonePercent(ledger: PccLedger, milestone: PccMilestone): number {
  if (SKIPPED_STATUSES.has(milestone.status)) {
    return 0;
  }
  if (COMPLETE_STATUSES.has(milestone.status) && hasReceipt(ledger, milestone.id)) {
    return 100;
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

function summarizeProject(ledger: PccLedger, project: PccProject): PccProjectSummary {
  const milestones = ledger.milestones.filter((milestone) => milestone.projectId === project.id);
  const percentComplete = summarizeWeightedProjectPercent(ledger, project, milestones);
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
  const proofGaps = milestones
    .filter(
      (milestone) => COMPLETE_STATUSES.has(milestone.status) && !hasReceipt(ledger, milestone.id),
    )
    .slice(0, 20)
    .map((milestone) => `Completion receipt missing for ${milestone.title}`);
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    percentComplete,
    milestoneCounts: counts,
    nextActions,
    proofGaps,
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
): PccProject {
  const existing = input.id ? projectOrError(ledger, input.id) : null;
  const timestamp = nowIso();
  const project: PccProject = {
    id: existing?.id ?? input.id ?? makeId("project", input.title),
    title: input.title,
    status: input.status ?? existing?.status ?? "active",
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
  };
  return setAt(ledger.projects, project);
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
  const timestamp = nowIso();
  const id = existing?.id ?? input.id ?? makeId("milestone", input.title);
  const status = input.status ?? existing?.status ?? "not_started";
  const receiptIds = input.receiptIds ?? existing?.receiptIds;
  const completeError = ensureMilestoneCanBeComplete(ledger, id, status, receiptIds);
  if (completeError) {
    return { error: completeError };
  }
  const milestone: PccMilestone = {
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
    ...(input.order !== undefined
      ? { order: input.order }
      : existing?.order !== undefined
        ? { order: existing.order }
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
  };
  return { milestone: setAt(ledger.milestones, milestone) };
}

function responseForProject(ledger: PccLedger, project: PccProject) {
  return {
    project,
    milestones: ledger.milestones.filter((milestone) => milestone.projectId === project.id),
    permissions: ledger.permissions.filter((permission) => permission.projectId === project.id),
    evidence: ledger.evidence.filter((evidence) => evidence.projectId === project.id),
    receipts: ledger.receipts.filter((receipt) => receipt.projectId === project.id),
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
  "pcc.projects.upsert": ({ params, respond }) => {
    if (!validatePccProjectsUpsertParams(params)) {
      respondInvalid(respond, "pcc.projects.upsert", validatePccProjectsUpsertParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const project = upsertProject(ledger, params.project);
          return { project, summary: summarizeProject(ledger, project) };
        },
        { write: true },
      );
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
        { write: true },
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
          if (
            params.permission.milestoneId &&
            !milestoneOrError(ledger, params.permission.milestoneId)
          ) {
            return { error: `milestone not found: ${params.permission.milestoneId}` };
          }
          const existing = params.permission.id
            ? ledger.permissions.find((permission) => permission.id === params.permission.id)
            : null;
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
        { write: true },
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
          if (
            params.evidence.milestoneId &&
            !milestoneOrError(ledger, params.evidence.milestoneId)
          ) {
            return { error: `milestone not found: ${params.evidence.milestoneId}` };
          }
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
            ...(params.evidence.sha !== undefined ? { sha: params.evidence.sha } : {}),
            ...(params.evidence.command !== undefined ? { command: params.evidence.command } : {}),
            ...(params.evidence.exitCode !== undefined
              ? { exitCode: params.evidence.exitCode }
              : {}),
            ...(params.evidence.metadata !== undefined
              ? { metadata: params.evidence.metadata }
              : {}),
          };
          ledger.evidence.push(evidence);
          return { evidence, summary: summarizeProject(ledger, project) };
        },
        { write: true },
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
          const missingEvidence = params.receipt.proofEvidenceIds.filter(
            (id) =>
              !ledger.evidence.some(
                (evidence) => evidence.id === id && evidence.projectId === project.id,
              ),
          );
          if (missingEvidence.length > 0) {
            return { error: `proof evidence not found: ${missingEvidence.join(", ")}` };
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
            summary: summarizeProject(ledger, project),
          };
        },
        { write: true },
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
        { write: true },
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
        });
        return;
      }
      respond(true, { portfolio: summarizePortfolio(ledger) });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
};

export const pccTesting = {
  ledgerPath,
  defaultPhases: () => DEFAULT_PCC_PHASES.map((phase) => Object.assign({}, phase)),
  readLedger,
  summarizeProject,
  summarizePortfolio,
};
